# Multi-ERP Platform Architecture — Phase 1 Audit & Preparation

> **Phase:** 1 of N — AUDIT → UNDERSTAND → MAP → DOCUMENT → PREPARE
> **Status:** No production code changed. This document is the deliverable.
> **Scope audited:** `Yinglima_ERP/` (the only repo with real content — see §0)
> **Method:** Every claim below was verified directly against source in this
> upload (models, dependencies, routers, migrations), not inferred from
> naming conventions or assumed from the brief.

---

## 0. What Actually Exists in This Upload

The zip contains three top-level folders:

| Folder | Contents |
|---|---|
| `Yinglima_ERP/` | A complete, mature, production FastAPI + React ERP. 53 Alembic migrations, full test suite, live `.env`, `doc/SYSTEM_DOCUMENTATION.md` (662 lines, current as of Sept 7 2026), `AGENTS.md` living-doc policy. |
| `ERP_Main/` | **Empty.** No files. |
| `Inhyma_ERP/` | **Empty.** No files. |

So Phase 1's real job is auditing **one** existing system (Yinglima) that will
become one spoke of the future hub-and-spoke architecture. `ERP_Main` and
`Inhyma_ERP` are architectural placeholders with nothing to preserve or break —
Phase 1 concerns itself entirely with understanding Yinglima well enough that
Phase 2+ can build around it safely.

Yinglima already maintains its own living architecture document at
`Yinglima_ERP/doc/SYSTEM_DOCUMENTATION.md`, kept current by a mandatory policy
in `AGENTS.md` ("update the doc whenever features/schemas/endpoints change").
I read it in full and spot-checked its claims against the actual code below —
it is accurate everywhere I checked. This document does not restate that file;
it focuses on the multi-ERP-specific questions the brief asked (identity,
org/ERP boundary, RBAC scope, federation seams) that the existing doc doesn't
need to answer today.

---

## 1. Current Yinglima Architecture (Verified Summary)

- **Backend:** FastAPI (Python), async SQLAlchemy 2.0, Alembic migrations (53
  applied), strict onion layering: `routes → services → repositories → DB`.
- **Frontend:** React 18 + TypeScript + Vite SPA, vanilla CSS design system,
  native WebSocket client with reconnect.
- **Persistence:** PostgreSQL (asyncpg) / SQLite (aiosqlite) via one
  `DATABASE_URL`. No sharding, no per-tenant database.
- **Background work:** In-process asyncio worker + DB-backed job queue
  (`app/queue/`) — explicitly documented as **not** requiring Redis/RabbitMQ/
  Celery. A separate IMAP polling daemon runs every 60s for inbound supplier
  email (`app/inquiries/email_inbound_worker.py`).
- **Cache:** Dual-backend (`InMemoryCacheBackend` with LRU, or Redis) behind
  one interface (`app/cache/`); Redis is optional infrastructure, not a hard
  dependency today.
- **Realtime:** WebSocket manager (`app/events/manager.py`) broadcasts
  `RECORD_CREATED/UPDATED/DELETED` to connected clients.
- 26 backend modules registered under `app/api/v1/router.py`: health, auth,
  users, rbac, positions, reporting, leadership, queue, cache, audit, trash,
  search, organizations, countries/states/cities, currencies, uom, hsn,
  brands, product categories/subcategories, products, company_list,
  supplier_types, buyer_types, suppliers, buyers, inquiries, public_quotes,
  planning, events.

## 2. Authentication — Current Flow (Verified)

**File:** `app/auth/security.py`, `app/auth/service.py`,
`app/auth/dependencies.py`, `app/auth/models.py`.

- **Password hashing:** Argon2id via `argon2-cffi`'s `PasswordHasher` with
  library defaults (documented as deliberately not hardcoded, so a future
  argon2-cffi upgrade raises cost parameters without a code change).
  `needs_rehash()` supports transparent upgrade of old hashes on next login.
- **Tokens:** Dual JWT (HMAC via `PyJWT`). Access token: 15 min default,
  carries `sub` (user UUID), `jti`, `iat`, `exp`, `iss`, `type`, and a `perms`
  claim (permission codes baked in at issuance as a read-optimization —
  **not** a second source of truth; still originates from the DB per
  request). Refresh token: 7 days, `type=refresh`, single-use, tracked/
  rotated in a DB table.
- **Session tracking:** `Session` model in `app/auth/models.py` records IP,
  user agent, device metadata per login; sessions can be listed and revoked
  (`GET/DELETE /auth/sessions`).
- **Token blacklist:** `TokenBlacklist` model — used for immediate
  revocation (e.g. force-logout) ahead of a token's natural expiry.
- **Password history:** `PasswordHistory` model prevents password reuse.
- **Current-user resolution:** `get_current_user()` in
  `app/auth/dependencies.py` is **the single dependency** every protected
  route ultimately depends on (directly or via `require_permission()`).
  It resolves `CurrentUser` from the `Authorization: Bearer` header via
  `AuthService.verify_access_token()`, and additionally enforces a global
  "must change password" gate (blocking all routes except
  change-password/logout/profile/refresh) independent of RBAC.
- **Soft-deleted-account immunity:** both the login path and
  `verify_access_token()` explicitly reject soft-deleted users, so a revoked
  account can't authenticate even with a still-valid in-flight token.
- **Storage on the client:** plain `localStorage` (`erp_access_token`,
  `erp_refresh_token`, cached profile) — see `frontend/src/lib/auth.ts`. Not
  httpOnly cookies. This matters for future ERP-switching UX (Step 13):
  today nothing prevents a script from reading the token, and there is no
  cross-subdomain cookie to piggyback SSO on — a future SSO handoff will need
  its own explicit token-exchange step, not "just share the cookie."
- **No self-registration endpoint.** The only way to create a user is
  `POST /users` (admin-permission-gated) or the bootstrap `scripts/seed.py`.
  This matters directly for Step 6 (future dual creation paths).

**Nothing here needs to change for Phase 1**, and nothing was changed.

## 3. User Model — Current Shape (Verified)

**File:** `app/users/models.py`.

Key facts, all confirmed by reading the model source and its docstrings:

- Single `User` table, UUID primary key (`UUIDPrimaryKeyMixin`), soft-delete
  (`SoftDeleteMixin`), optimistic concurrency (`VersionMixin`).
- **`Employee` was already merged into `User`.** The codebase's own docstring
  explains this: there used to be a separate `Employee` table for
  workforce-only records; it was merged back into `User` because the
  up-front "is this a User or an Employee?" decision created more friction
  than value. This is directly relevant precedent for how the *next* merge
  (local User ↔ Global User) should be designed: the lesson recorded in the
  code is "avoid making people pick between two record types up front."
- **Login is optional per user**, not a separate entity: `has_login: bool`.
  When `False`, `username/email/phone/password_hash` are all `NULL` and
  every auth check treats the row as unable to authenticate — independent of
  `status`/`is_active`. Workforce members with no ERP access (drivers,
  factory workers, consultants) are ordinary `User` rows with
  `has_login=False`.
- **No `organization_id` on `User` at all.** There is no tenant/company
  foreign key on the user table — see §4, this is because Yinglima is
  explicitly single-tenant.
- Self-referential FKs: `manager_id`, `created_by`, `updated_by` all point
  back to `users.id`.
- `UserStatus` enum (PENDING/ACTIVE/INACTIVE/SUSPENDED/LOCKED/
  PASSWORD_CHANGE_REQUIRED) is independent of `is_active` (boolean) and of
  `has_login` — three orthogonal gates, all enforced together in
  `User.can_login`.

**Where the local user ID is used:** as the FK target of `manager_id`,
`created_by`, `updated_by` on `User` itself; as `deleted_by` on every
soft-deletable table (via `SoftDeleteMixin`); as `user_id` on `UserRole`,
`UserPermission`, `Session`, `EmployeePositionAssignment`,
`EmployeeReportingRelationship`, `DepartmentLeadershipAssignment`, and the
audit log's actor field. **This is a wide, deep fan-out.** The brief's
concern (Step 3) about not casually replacing the local user ID is well
founded — a global-identity layer must wrap the existing UUID, not replace
it, exactly as the brief specifies in its target design
(`Global User → Yinglima Local User → existing relationships`).

## 4. Organization / Company / Branch — Current Meaning (Verified, Important)

This is the single most important disambiguation this audit produced,
because the brief explicitly warned `organization_id` might not mean what it
looks like it means — and here, it genuinely doesn't.

**Two unrelated concepts currently share vocabulary that looks the same:**

1. **`app/organizations/models.py` → `Organization` table.** This is *this
   ERP's own single company profile* (legal name, GST/PAN, address,
   currency, timezone). The model's own docstring is explicit: *"This ERP is
   single-company only (no multi-tenancy) — the service layer enforces that
   at most one row ever exists."* There is no `organization_id` FK anywhere
   pointing at this table. It's a settings singleton, not a tenant boundary.

2. **`app/masters/company_list/models.py` → `MasterCompany` table
   (`master_companies`).** This is a *reference/lookup list* of group
   operating companies (e.g. "Inhyma", "FNB Solution") with a JSON `branches`
   column (`[{"id": ..., "name": "Mumbai", "code_prefix": "INM"}, ...]`).
   **This** is what `organization_id` foreign keys actually point to
   throughout the codebase — confirmed by grep: every `organization_id`
   column in the system (on `Product`, and as a request-time parameter
   throughout `app/planning/service.py`) is `ForeignKey("master_companies.id")`,
   used purely to scope which planning sheet / product list a record belongs
   to. It has **no relationship whatsoever to authentication, RBAC, or
   tenancy** — it's a business-data classification value, most heavily used
   inside the Master Shipment Planning module to pick which org/branch's
   grid a row lives on.

**Conclusion for the future architecture:** the brief's instruction — *"Do
NOT assume `organization_id` = ERP ID... they are NOT automatically the same
thing"* — is correct and necessary here. Neither existing sense of
"organization" is a tenant boundary or an ERP boundary today:

- `Organization` (singleton) is really "the ERP's own company profile,"
  conceptually closer to future **ERP instance configuration** than to a
  membership boundary.
- `MasterCompany` (list) is a **business-data lookup value**, unrelated to
  who can log in or what they can do, and must be left alone entirely.

The future `ERP_INSTANCE` identifier (Step 10) must be a **new, separate**
concept — it must not reuse either table, and definitely must not rename or
repurpose `organization_id` on `Product`/`Planning`, which is protected
business logic per the brief's own preservation list.

## 5. RBAC — Current Shape (Verified)

**File:** `app/rbac/models.py`, `app/rbac/dependencies.py`.

- `Permission`: flat table of fine-grained codes (e.g. `user.create`),
  grouped by `module`/`page`/`action`/`scope` for display only — the `code`
  string is the actual authorization unit.
- `Role`: doubles as an **organizational department** (post-merge, same as
  the Employee/User merge pattern above) — carries both permission grants
  (`RolePermission`) and org-chart nesting (`parent_department_id`,
  `DepartmentHierarchy` for multi-parent DAGs with server-side cycle
  detection). A department does **not** inherit its parent's permissions —
  nesting is purely organizational, permissions are purely per-role.
- `UserRole`: many-to-many, carries `assignment_type` (PRIMARY/SECONDARY/
  TEMPORARY/PROJECT/ACTING), `is_primary`, effective date ranges.
- `UserPermission`: per-user ALLOW/DENY overrides layered on top of role
  grants.
- **Effective permissions** = `(⋃ role permissions ∪ direct grants) \ direct
  denies`, computed at request time (not just at login) and cached per-user
  in `permissions:<user_id>` cache namespace, invalidated explicitly on any
  RBAC mutation.
- **`super_admin` bypasses all checks** — hardcoded role-name check in
  `require_super_admin()`, not a permission code.
- **Enforcement is single-chokepoint:** `require_permission()` /
  `require_any_permission()` in `app/rbac/dependencies.py` are the only
  functions used to gate routes; every protected endpoint depends on one of
  these (which themselves depend on `get_current_user`).

**Global vs. local permissions today: there is no such distinction.** Every
permission, every role, and `super_admin` itself are all scoped to this one
ERP instance — there is currently no concept of a permission or role that
means something across ERP boundaries. This is expected (Yinglima predates
the multi-ERP concept) and is squarely in the brief's **ADD** category, not
**MODIFY** — nothing here needs to change, a new orthogonal layer needs to
be introduced above it (Global Permissions / ERP Membership, per Steps 5 and
12).

## 6. User Creation — All Current Entry Points (Verified)

- `POST /api/v1/users` — the only creation endpoint. Admin-permission-gated
  (`user.create`). No public self-registration route exists anywhere in
  `app/users/routes.py` or `app/auth/routes.py`.
- `backend/scripts/seed.py` — bootstrap/seed script, direct DB writes.
- No import/bulk-user-creation flow was found (bulk import exists for
  Suppliers and Buyers, not for Users).

This is a narrow surface — good news for Phase 2. The brief's future dual
creation flow (ERP_Main-initiated vs. Yinglima-initiated) has exactly one
existing code path to wrap, not several scattered ones.

## 7. Events / Queue / Cache — Local vs. Federation-Ready (Verified)

| System | Current implementation | Distributed today? | Fit for federation reuse |
|---|---|---|---|
| WebSocket events (`app/events/`) | In-process `ConnectionManager`, broadcasts to connected sockets only | No — single-process | Good outbox trigger point; not itself a transport for cross-ERP events |
| Queue (`app/queue/`) | DB-backed (`queue_jobs` table), asyncio poller, explicitly "no external broker required" (own module docstring) | No | **Best existing seam for a Transactional Outbox** — same pattern the brief's federation design (Step 16) calls for |
| Cache (`app/cache/`) | Pluggable backend: in-memory LRU or Redis, behind one interface | Optional (Redis) | Fine as-is; no changes needed |
| Inbound email worker | Standalone asyncio daemon polling IMAP every 60s | N/A | Unrelated to federation; do not touch |

**Recommendation carried into Phase 2 planning (not implemented now):** the
existing `app/queue/` module is architecturally the closest match to the
brief's proposed `federation/outbox/` — it already is a DB-backed,
polled, retryable job table. Rather than building a parallel outbox
mechanism, Phase 2 should evaluate registering federation-sync jobs as a new
job *type* in the existing queue (`queue/registry.py` already documents how
future modules register handlers) instead of introducing new infrastructure.
This is a recommendation for later, not a decision made now.

## 8. Database — Relationship Map (Key Tables, Verified)

```
users (UUID PK)
 ├─ manager_id      → users.id (self, SET NULL)
 ├─ created_by      → users.id (self, SET NULL)
 ├─ updated_by      → users.id (self, SET NULL)
 └─ deleted_by      → (via SoftDeleteMixin, no FK constraint declared, UUID only)

roles (UUID PK)                          [doubles as "department"]
 ├─ parent_department_id → roles.id (self, SET NULL)
 ├─ role_permissions     → permissions.id (M2M, CASCADE)
 └─ department_hierarchy → roles.id × roles.id (M2M, multi-parent DAG)

user_roles         : user_id → users.id, role_id → roles.id (M2M)
user_permissions    : user_id → users.id, permission_id → permissions.id (ALLOW/DENY)
sessions            : user_id → users.id
employee_position_assignments : user_id → users.id, position_id → positions.id
employee_reporting_relationships : employee_id / manager_employee_id → users.id
department_leadership_assignments : department_id → roles.id, employee_id → users.id

organizations        : singleton, no FKs in
master_companies      : referenced by products.organization_id (SET NULL),
                        and by planning module's organization_id/branch_id
                        (branch is a JSON sub-object of MasterCompany.branches,
                        not a separate table)

products.organization_id  → master_companies.id  (SET NULL) — business data
                             classification, NOT tenancy
buyers / suppliers / inquiries / planning_* : no organization_id at all —
                             single global pool of business data
```

**No table in the system currently has a tenant-scoping column.** Every
business table (buyers, suppliers, products, inquiries, planning) is a
single flat global pool, scoped only by soft-delete state and (for planning/
products only) the `master_companies` business classification described
above. This is consistent with Yinglima being one ERP instance serving one
company's operations — exactly what the brief expects to preserve.

## 9. KEEP / MODIFY / ADD / DEPRECATE / REMOVE

### KEEP (verified untouched, must remain exactly as-is)
- All 26 registered business/infra modules and their routes, services,
  repositories, models — Buyers, Suppliers, Products (+ masters), Inventory/
  Planning, Inquiries/RFQ, Reports, Search, Notifications, Trash, Audit,
  Organizations, Org Structure/Positions/Reporting, RBAC, Users, Auth, Cache,
  Queue, Events.
- Existing Argon2id + dual-JWT authentication implementation.
- Existing `User` table, its UUID PK, and every existing FK pointing at it.
- Existing `organization_id` on `Product`/Planning (it means "group operating
  company from `master_companies`," not "tenant" — leave its meaning alone).
- Existing RBAC engine, permission codes, and enforcement chokepoints
  (`require_permission`, `require_any_permission`, `require_super_admin`).
- Existing DB-backed queue/cache/WebSocket infrastructure.
- The living-documentation policy in `AGENTS.md` and
  `doc/SYSTEM_DOCUMENTATION.md` — Phase 2+ work on Yinglima should keep
  following it.

### MODIFY (small, additive touch points identified for later phases — none made now)
- `get_current_user()` (`app/auth/dependencies.py`): eventual insertion
  point for validating an ERP_Main-issued SSO token/claim alongside the
  existing local JWT — additive, not a replacement of local JWT validation.
- User creation flow (`POST /users`, `scripts/seed.py`): eventual second
  entry path for users created via ERP_Main → Yinglima membership, per
  brief Step 6. The single existing endpoint is a narrow, well-contained
  surface to extend.
- Permission model (`app/rbac/models.py` `Permission`): eventually needs a
  parallel *Global Permission* concept (Step 5) — additive new table(s), not
  a change to `Permission`/`Role` themselves.

### ADD (new, does not touch existing modules)
- ERP identity constant/config value (Step 10) — e.g. `ERP_ID=yinglima` in
  settings, used only by future federation/SSO code, never substituted for
  `organization_id`.
- Global User ↔ Local User linkage table (Step 11) — new table,
  `global_user_id ↔ yinglima_user_id`, no changes to `users` table itself.
- ERP Membership concept (Step 12) — lives in ERP_Main once it exists; from
  Yinglima's side, only a thin client/adapter is ever needed.
- Federation adapter directories (Step 16) — new, isolated code under
  `backend/app/federation/` (or similar), integrating with the existing
  `app/queue/` job registry rather than duplicating it.
- Global Permission table + Global Audit hooks — new, additive.

### DEPRECATE
- None identified. Nothing in the audited codebase is obsolete; every
  module traced back to live routes registered in `router.py`.

### REMOVE
- None identified, and none should be removed without further proof of
  disuse — consistent with the brief's conservatism requirement. No
  candidates surfaced during this audit.

## 10. Control Plane / Data Plane Separation (Documented, Not Implemented)

**Control plane** (future ERP_Main touches only these, per brief Step 14):
login/identity, global membership, ERP registry, module registry, global
config, health, global audit, global admin.

**Data plane** (must stay 100% local to Yinglima, unaffected by ERP_Main
availability): everything else — all 26 modules listed in §1, in full.

Given §2's finding (client stores JWTs in `localStorage`, no shared cookie
domain), the cleanest future control-plane touch point really is limited to
the login moment: ERP_Main issues an SSO artifact once, Yinglima's existing
`get_current_user()` validates local JWTs on every subsequent request as it
does today. This naturally satisfies Step 15 (no ERP_Main call on every
business API request) without new design — it's what the current
token-based, statelessly-verified auth already gives us for free.

## 11. One-ERP vs. Multi-ERP Login (Documented, Not Implemented)

Flows exactly as specified in the brief (Steps 13):

- **Single-membership user:** ERP_Main authenticates → checks membership →
  finds exactly one ERP → issues Yinglima session → redirects straight into
  Yinglima, bypassing any ERP_Main dashboard.
- **Multi-membership user:** ERP_Main authenticates → shows a global
  dashboard/switcher → user picks an ERP → issues that ERP's session.
- **Global Super Admin:** always lands in ERP_Main regardless of membership
  count.

Nothing in Yinglima's current auth needs to differ between these cases —
from Yinglima's point of view, every case ends the same way: it receives one
valid session/token and calls its existing `get_current_user()`. The branching
logic lives entirely in ERP_Main, which doesn't exist yet.

## 12. Risks Discovered

1. **No self-registration path exists**, and no email-verification flow
   exists on the User model despite `UserStatus` having a `PENDING` state —
   worth confirming with the team before assuming ERP_Main can rely on any
   existing "invite" mechanics; today it would be building on an admin-only
   creation path.
2. **`localStorage` token storage** means there is no existing browser-level
   mechanism (shared cookie, etc.) to piggyback ERP-switching on — SSO will
   need an explicit token-exchange redirect, not a shared-session trick.
   Flagging this now so Phase 2 doesn't assume infrastructure that isn't
   there.
3. **The word "organization" is heavily overloaded** in the existing
   codebase (see §4) across two unrelated meanings, neither of which is a
   tenant boundary. Any Phase 2 engineer (human or AI) skimming for
   "organization_id" without reading this section is likely to wire the new
   ERP identity concept to the wrong existing table. This is the single
   highest-risk misunderstanding this audit exists to prevent.
4. **RBAC has no "global" tier at all today** — every one of the 5 audit
   steps that assume a Global/Local permission split will require genuinely
   new tables, not a relabeling of existing ones.
5. **Queue module already looks like a partial outbox** — a real risk in
   Phase 2 is someone building a *second*, parallel outbox mechanism instead
   of registering as a job type in the existing `app/queue/registry.py`.

## 13. Database Changes That Will Eventually Be Required (Not Made Now)

- New table: ERP registry (in ERP_Main once built) — not in Yinglima.
- New table: Global User ↔ Local User link, keyed by Yinglima's existing
  `users.id` (no change to that column's type or constraints).
- New table(s): ERP Membership (lives in ERP_Main; Yinglima needs no schema
  change for this).
- New table(s): Global Permission, Global Role (separate from `rbac.Role`/
  `Permission` — additive, no migration touching existing RBAC tables).
- Possibly: a nullable `global_user_id` reference column added to `users` in
  a later phase, once ERP_Main exists — explicitly **not** a Phase 1 or even
  early-Phase-2 change; noted here only because Step 11 asks for it to be
  anticipated.

## 14. Authentication Changes That Will Eventually Be Required (Not Made Now)

- Extend `get_current_user()` to optionally accept an ERP_Main-issued
  token/claim for the SSO handoff moment, while continuing to validate
  Yinglima's own JWTs exactly as today for all subsequent requests.
- Define (in ERP_Main, not here) the token-exchange contract: what ERP_Main
  hands Yinglima at hand-off time, and how Yinglima turns that into a normal
  local session without a network round-trip on every request.

## 15. User-Management Changes That Will Eventually Be Required (Not Made Now)

- Add a second creation path into the existing single `POST /users` flow:
  accept an optional external Global User reference at creation time,
  without changing the endpoint's existing required fields or behavior for
  admin-created local users.
- Decide (Phase 2 design question, not answered here) what happens when a
  Yinglima-created user is later linked to a Global User retroactively —
  the brief's Step 6 diagram implies this needs to be possible in both
  directions.

## 16. Federation Integration Points

- `app/queue/registry.py` — recommended home for a future
  `federation_outbox` job type, reusing the existing polling worker instead
  of building a new one.
- `app/events/manager.py` — reasonable place to also emit a local event
  precisely at the same moments the outbox would enqueue a federation
  message, keeping the two concerns cleanly separate.
- No existing code should ever call another ERP's database directly — none
  currently does, and none should be added to.

## 17. Recommended Order for Phase 2 Onward

1. Stand up `ERP_Main` as a genuinely separate, empty-today codebase with
   its own DB — global identity, ERP registry, membership tables only.
   Zero changes to Yinglima in this step.
2. Define the token-exchange contract between ERP_Main and Yinglima (design
   doc only), validated against Yinglima's real `get_current_user()`
   signature from §2 — no code yet.
3. Add the Global User ↔ Local User link table to Yinglima (additive
   migration #54), with no behavior change until something actually reads
   it.
4. Wire `get_current_user()` to accept the new SSO artifact as an
   additional, optional path — existing local-JWT path must keep working
   unchanged for anyone not yet migrated.
5. Extend `POST /users` with the optional Global User linkage field.
6. Only after 1–5 are stable: begin the federation outbox as a new queue job
   type (§16), starting with one low-risk, one-directional sync case before
   attempting bidirectional conflict handling.

---

## 18. Final Safety Check (Phase 1 Exit Criteria)

- [x] Existing Yinglima features are intact — nothing was modified.
- [x] Existing business logic is unchanged.
- [x] Existing organization behavior (both senses, see §4) is unchanged.
- [x] Existing local user IDs remain exactly as they are.
- [x] Existing APIs still work — none touched.
- [x] Existing frontend still works — none touched.
- [x] No direct ERP-to-ERP database dependency exists or was introduced —
      none existed before (there being only one ERP), none added.
- [x] ERP identity is documented as separate from both existing
      "organization" meanings (§4), not yet implemented.
- [x] Global identity is documented as separate from local identity (§11 of
      the source brief maps directly to §3/§13 here), not yet implemented.
- [x] Global permissions are documented as separate from local ERP
      permissions (§5), not yet implemented.
- [x] ERP_Main is treated purely as a future control plane (§10) — it has no
      code today, so nothing to mistakenly turn into a business ERP.
- [x] Yinglima remains fully independent — no coupling introduced.
- [x] No refactoring was performed anywhere in this phase.
- [x] No working code was deleted.
- [x] No performance overhead was introduced (no code changed at all).
