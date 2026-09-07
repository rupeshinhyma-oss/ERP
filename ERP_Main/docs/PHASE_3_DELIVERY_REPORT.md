# Multi-ERP Platform — Phase 3 Delivery Report

> **Phase:** 3 of N — Global Identity, ERP Membership, Secure Control
> Plane, Real Inhyma Onboarding
> **Status:** Complete. All 59 ERP_Main tests passing (13 preserved from
> Phase 2 + 46 new). Yinglima 89/89 passing, Inhyma 91/91 passing
> (same 2 tests excluded as every prior phase, for the same pre-existing,
> unrelated reason — see §24/§25).
> **Absolute rules honored:** no database merge, no cross-database FK, no
> local user/RBAC/password replaced or centralized, `organization_id`
> untouched, `ERP_KEY` never treated as authentication, no auto-merge by
> email/phone/name, no SSO implemented.

---

## 1. Current-State Findings Before Phase 3

Inspected the existing implementation before writing anything, per the
brief's own instruction:

- ERP_Main's Phase 2 registry (`erp_registry/` — models, schemas,
  repository, service, routes, dependencies) was exactly as the brief
  described it: `ErpInstance`/`ErpModule`, no authentication anywhere,
  13 passing tests. Confirmed by running them before any change.
- Yinglima's router (`app/api/v1/router.py`) registers 26 feature-module
  routers; no `tasks` or `notifications`.
- Inhyma's router registers the same 26, plus `tasks_router` and
  `notifications_router` — **confirmed live in the current router file
  itself**, not inferred from migration history (the brief specifically
  warned migration history alone can't be trusted here, since Inhyma's
  migration set does contain older tasks-related entries from before
  changes were made).
- Inhyma had no `ERP_KEY`/`ERP_DISPLAY_NAME` at all (Phase 2 only touched
  Yinglima, correctly, since Inhyma was empty then).
- ERP_Main's `scripts/seed_registry.py` still registered Inhyma as an
  `INACTIVE` "placeholder... not yet integrated" — accurate wording when
  written, stale now that Inhyma is real code.

## 2. Remaining Phase 1/2 Gaps Discovered (and Closed This Phase)

1. Inhyma's `ERP_KEY`/`ERP_DISPLAY_NAME` — closed (§9).
2. `erp_registry`'s mutation endpoints were completely unauthenticated —
   closed (§13, §15).
3. Seed script's Inhyma description was outdated — closed (§11).

No other Phase 1/2 gaps were found; Phase 2's actual registry code
(`models.py`/`service.py`/`schemas.py`) needed no changes and none were
made — reused exactly as-is per the brief's "do not rebuild" instruction.

## 3. Files Created

### `ERP_Main/backend/` — five new modules, one new migration, five new test files

```
app/platform_auth/      __init__.py, models.py, security.py, schemas.py,
                         repository.py, service.py, dependencies.py, routes.py
app/global_audit/       __init__.py, models.py, repository.py, service.py,
                         dependencies.py, schemas.py, routes.py
app/service_identity/   __init__.py, models.py, security.py, schemas.py,
                         repository.py, service.py, dependencies.py, routes.py
app/global_users/       __init__.py, models.py, schemas.py, repository.py,
                         service.py, dependencies.py, routes.py
app/erp_memberships/    __init__.py, models.py, schemas.py, repository.py,
                         service.py, dependencies.py, routes.py

alembic/versions/0002_phase3_global_identity.py

tests/test_platform_auth.py
tests/test_global_users.py
tests/test_erp_memberships.py
tests/test_service_identity.py
```

## 4. Files Modified

| File | Change |
|---|---|
| `ERP_Main/backend/app/core/config.py` | Added platform-admin JWT settings, service-credential pepper, and an extended `validate_production_secrets()` covering both plus a CORS-wildcard check. |
| `ERP_Main/backend/app/core/exceptions.py` | Added `UnauthorizedException`/`ForbiddenException` (the module's own Phase 2 docstring said these were deferred until ERP_Main had auth). |
| `ERP_Main/backend/app/erp_registry/routes.py` | Every mutating route now depends on `require_platform_admin`; every mutation now calls `GlobalAuditService.record(...)`. Read routes (`GET`) deliberately left open — documented rationale in the module docstring. No model/schema/service file in this package was touched. |
| `ERP_Main/backend/app/api/v1/router.py` | Registers the five new routers. |
| `ERP_Main/backend/app/main.py` | Calls `settings.validate_production_secrets()` at startup; CORS methods/headers changed from wildcard to an explicit list (Step 53). |
| `ERP_Main/backend/alembic/env.py` | Imports the five new model modules so autogenerate/`Base.metadata` sees them. |
| `ERP_Main/backend/requirements.txt` | Added `argon2-cffi`, `pyjwt` (both already implicitly available via the shared environment, now explicitly declared). |
| `ERP_Main/backend/scripts/seed_registry.py` | Rewritten: registers/reconciles Inhyma as a real ERP (still `INACTIVE`, with accurate metadata — see §11), declares capabilities from a router-derived list, idempotent on re-run. |
| `ERP_Main/backend/tests/conftest.py` | Added `admin_client`/`super_admin_client` fixtures (bootstrap a platform admin and authenticate). |
| `ERP_Main/backend/tests/test_erp_registry.py` | Every original Phase 2 assertion preserved unchanged; calling client changed from `client` to `admin_client` for mutations (now correctly required); two new authorization-boundary tests added. |
| `Inhyma_ERP/backend/app/core/config.py` | Added `ERP_KEY = "inhyma"` / `ERP_DISPLAY_NAME = "Inhyma ERP"` block (21 lines), identical pattern to Yinglima's Phase 2 addition. |
| `Inhyma_ERP/backend/.env.example` | Added matching `ERP_KEY=inhyma` / `ERP_DISPLAY_NAME=Inhyma ERP` documentation lines. |

**Yinglima_ERP was not modified at all this phase** (confirmed: `git diff
-w --stat` shows the same 28-line, 2-file diff from Phase 2, nothing
new).

## 5. ERP_Main Migration Added

`0002_phase3_global_identity.py`, `down_revision = "0001"`. Creates
`platform_admins`, `global_users`, `erp_memberships`,
`erp_service_credentials`, `global_audit_logs`. Does not alter a single
column on `erp_instances`/`erp_modules` — `0001` was never opened for
editing. Verified end-to-end: ran `alembic upgrade head` against a real
SQLite file (both revisions apply cleanly in order), then `alembic
downgrade 0001` (removes exactly the 5 new tables, leaves the Phase 2
pair completely intact) — both confirmed by inspecting `sqlite_master`
directly, not just trusting Alembic's own success message.

## 6. Final GlobalUser Schema

```
global_users
├── id                    UUID, PK
├── display_name          VARCHAR(200)
├── primary_email         VARCHAR(255), UNIQUE
├── status                ENUM(ACTIVE|SUSPENDED|DISABLED), default ACTIVE
├── external_identity_id  VARCHAR(255), nullable — reserved for a future
│                          OIDC/federation phase; unused by anything today
├── metadata_json         JSON, nullable — non-secret only
├── created_at / updated_at
```

Deliberately thin, per Step 6: no employee fields, no local User copy,
no organization/branch reference. `PENDING` status was considered and
NOT added — nothing in Phase 3's actual workflow needs an
invitation/bootstrap state for a GlobalUser itself (memberships have
their own `PENDING`, which is where that concept actually belongs).

## 7. Final ERPMembership Schema

```
erp_memberships
├── id                UUID, PK
├── global_user_id    UUID, FK -> global_users.id (CASCADE)
├── erp_instance_id   UUID, FK -> erp_instances.id (CASCADE)
├── local_user_id     VARCHAR(255) -- NOT a FK into any ERP's database
├── status            ENUM(PENDING|ACTIVE|SUSPENDED|REVOKED), default PENDING
├── linked_at          TIMESTAMPTZ
├── verified_at        TIMESTAMPTZ, nullable
├── last_seen_at       TIMESTAMPTZ, nullable
├── metadata_json      JSON, nullable
├── created_at / updated_at
│
UNIQUE(global_user_id, erp_instance_id)   -- one membership per ERP per person
UNIQUE(erp_instance_id, local_user_id)    -- one Global User per local account
```

**`local_user_id` type decision (Step 10), documented in the model's own
docstring:** a bounded string (`String(255)`), not a UUID column, even
though both Yinglima's and Inhyma's `User.id` are UUIDs today —
confirmed by inspecting both. Chosen because (a) a string safely holds
any future ERP's identifier scheme, not just UUIDs, and (b) this is
explicitly not a SQL foreign key into any ERP's own database, so there
is no correctness benefit to a stricter type, only a future flexibility
cost.

Both uniqueness constraints from Step 11 are enforced at the database
level (not just service-layer checks), so they hold under concurrent
requests too.

## 8. ERP Registry Schema Changes

**None.** `ErpInstance` and `ErpModule` are byte-for-byte unchanged from
Phase 2. This was a deliberate decision (documented in Phase 2's own
`models.py`/`service.py` docstrings, re-confirmed at the start of this
phase) — nothing about Phase 3's requirements needed a new field on
either table.

## 9. Yinglima ERP Identity Integration

Unchanged from Phase 2 — `ERP_KEY = "yinglima"` / `ERP_DISPLAY_NAME =
"Yinglima ERP"` in `app/core/config.py`, still read by nothing, still
purely configuration. Re-verified this phase: config loads correctly,
332 routes register (identical count to before Phase 3), 89/89 safe
regression tests pass.

## 10. Inhyma ERP Identity Integration

New this phase. Added the identical pattern to Yinglima's:
`ERP_KEY = "inhyma"` / `ERP_DISPLAY_NAME = "Inhyma ERP"` in
`app/core/config.py`, plus the matching `.env.example` documentation
block. Verified: `Settings` loads correctly, resolves `ERP_KEY ==
"inhyma"`. Read by nothing in Inhyma's own codebase — inert
configuration, exactly like Yinglima's, reserved for a future
integration point.

## 11. Updated Yinglima Capability Registration

Via the rewritten seed script, derived from Yinglima's actual current
`app/api/v1/router.py`: `buyers`, `suppliers`, `products`, `inquiries`,
`planning`, `organizations` — same 6 as Phase 2 (nothing changed in
Yinglima's router this phase, so nothing changed in its declared
capabilities either).

## 12. Updated Inhyma Capability Registration

New this phase, derived from Inhyma's actual current router (verified by
reading the file directly, listed in §1): the same 6 shared capabilities
plus `notifications` and `tasks` — both confirmed as live, registered
routers in Inhyma's codebase today, not assumed from migration history.
Inhyma's registry entry: `status = INACTIVE` with accurate, current
metadata (see §29 rationale below) replacing the old "future placeholder"
wording.

## 13. ERP_Main Authentication Implementation

`app.platform_auth` — human control-plane administrators.
- `PlatformAdmin` model: email (unique), display_name, Argon2id
  `password_hash`, `role` (`SUPER_ADMIN`/`PLATFORM_ADMIN`), `is_active`.
- Login (`POST /global/auth/login`) issues a JWT signed with
  `PLATFORM_JWT_SECRET_KEY` — a signing secret completely separate from
  any local ERP's own JWT secret, so a platform-admin token can never be
  confused with or verified against Yinglima's/Inhyma's own tokens.
  60-minute default expiry (deliberately short-lived; no refresh-token
  dance built, since this is a low-traffic admin console, not a
  high-frequency API — documented trade-off in `config.py`).
- Identical error message/response shape for "no such admin" and "wrong
  password," mirroring Yinglima's own login endpoint's anti-enumeration
  pattern.
- Bootstrap path (`bootstrap_first_admin`, used only by a script, never
  an HTTP route) creates the very first admin when zero exist; every
  subsequent admin creation requires an authenticated SUPER_ADMIN caller.

## 14. ERP_Main Authorization Implementation

Two fixed tiers, no general RBAC (Step 20's own explicit ceiling):
`require_platform_admin` (any active admin, either role) is the floor
every mutating route depends on; `require_super_admin` additionally
gates admin-account creation and service-credential issuance/rotation/
revocation. `erp_registry`'s `GET` routes remain open by deliberate,
documented choice (registry metadata only, no secrets/business data).
`global_users`/`erp_memberships` reads are NOT open — personal data about
real humans gets the same protection as writes.

## 15. ERP Service Authentication Implementation

`app.service_identity` — machine-to-machine, for ERP backends calling
ERP_Main. Bearer format: `<credential_identifier>.<secret>`.
`credential_identifier` is a public, indexed lookup key;
`secret` is never stored — only `hash_service_secret()`'s Argon2id
output (peppered with `SERVICE_CREDENTIAL_PEPPER`, a server-side value
distinct from `PLATFORM_JWT_SECRET_KEY`, enforced by a startup check)
is persisted. `require_erp_service` is the sole way anything in this
codebase establishes "which ERP is this machine caller" — never trusts a
UUID/key taken from the request path alone (verified by
`test_credential_for_wrong_erp_rejected`, which proves a valid credential
for ERP A is rejected when the path names ERP B).

## 16. Credential Rotation Strategy

`POST /global/erps/{id}/credentials/rotate` issues a brand-new credential
without touching any existing one — both remain valid simultaneously
(verified by `test_rotation_issues_new_credential_without_revoking_old`).
The operator deploys the new credential, confirms it works, then calls
`POST /global/erps/{id}/credentials/{credential_id}/revoke` on the old
one. No credential is ever hard-deleted — `revoked_at` is set and the row
remains for audit history. ERP identity (`key`, internal `id`) never
changes as part of rotation.

## 17. Heartbeat Implementation

`POST /global/erps/{id}/heartbeat`, gated by `require_erp_service`.
Accepts only `version`/`environment`/`deployment_id` — no business data,
confirmed by the schema itself having no other fields. Updates
`last_seen_at` (and version/environment if provided) but **never**
touches `status` (Step 49 — verified by `test_heartbeat_never_changes_status`).
A DECOMMISSIONED ERP's own valid credential is rejected for heartbeat
purposes (verified). Every heartbeat is recorded to the global audit log
with `actor_type = ERP_SERVICE`.

## 18. Local-User Verification Mechanism

**Not built this phase**, and this is a deliberate scope decision, not an
oversight: Step 36's internal verification endpoint would need to be
added inside Yinglima's and Inhyma's own codebases (a genuinely new
local-ERP change, which Step 62 says should stay small and the brief's
Step 16 treats as optional — "if secure ERP-service verification is
available"). Instead, every `ErpMembership` starts `PENDING`, and a
platform admin explicitly calls `POST /global/memberships/{id}/verify`
once they've confirmed the local account out-of-band. This satisfies
Step 16's hard requirement ("do not pretend unverified local user IDs
are confirmed identities") without inventing a verification contract
that no local ERP has committed to yet. Future phases can wire automatic
verification into this exact same `verify()` method's call site without
changing its contract.

## 19. Global Audit Implementation

`app.global_audit` — append-only `global_audit_logs` table, no
update/delete method exists anywhere in its `service.py`. Every event
type from Step 41's list is defined and every service in this phase
actually calls `record(...)` at the relevant point: ERP registration/
update/status-change/decommission, credential create/rotate/revoke,
Global User create/update/suspend, membership create/verify/suspend/
restore/revoke, module (capability) declaration, platform-admin creation
and login success/failure, and heartbeat. `actor_type` distinguishes
`HUMAN_ADMIN`/`ERP_SERVICE`/`SYSTEM` (Step 42). Read-only API
(`GET /global/audit`, platform-admin gated, filterable by event type/
target) — no `POST` route exists, since a log writable over HTTP
wouldn't be a trustworthy log.

## 20. API Endpoints Added

```
POST   /global/auth/login
GET    /global/auth/me
POST   /global/auth/admins                                   (SUPER_ADMIN)

POST   /global/erps/{id}/credentials                          (admin)
POST   /global/erps/{id}/credentials/rotate                   (admin)
GET    /global/erps/{id}/credentials                          (admin)
POST   /global/erps/{id}/credentials/{credential_id}/revoke   (admin)
POST   /global/erps/{id}/heartbeat                            (service credential)

POST   /global/users                                          (admin)
GET    /global/users                                          (admin)
GET    /global/users/{id}                                     (admin)
PATCH  /global/users/{id}                                     (admin)
PATCH  /global/users/{id}/status                               (admin)

POST   /global/users/{id}/memberships/{erp_id}                (admin)
GET    /global/users/{id}/memberships                          (admin)
GET    /global/erps/{id}/members                                (admin)
GET    /global/memberships/{id}
POST   /global/memberships/{id}/verify
POST   /global/memberships/{id}/suspend
POST   /global/memberships/{id}/restore
POST   /global/memberships/{id}/revoke

GET    /global/audit                                           (admin)
```

Plus Phase 2's existing `/global/erps*` routes, now auth-protected on
every mutation (§4).

## 21. Frontend Additions

**None.** Step 51 scopes frontend work to "if ERP_Main still has no
frontend and Phase 3 includes UI work" — no UI work was requested or
attempted; ERP_Main remains backend-only.

## 22. Existing ERP Registry Tests and Results

All 13 original Phase 2 tests preserved with every original assertion
intact (`test_erp_registry.py`), updated only to call `admin_client`
instead of unauthenticated `client` for mutations — the correct
consequence of adding authorization, not a weakening (Step 55). Plus 2
new authorization-boundary tests. **15/15 passing.**

## 23. New Phase 3 Tests and Results

| File | Count | Result |
|---|---|---|
| `test_platform_auth.py` | 7 | ✅ all passing |
| `test_global_users.py` | 10 | ✅ all passing |
| `test_erp_memberships.py` | 14 | ✅ all passing |
| `test_service_identity.py` | 13 | ✅ all passing |
| **Total new** | **44** | |
| **Grand total (ERP_Main)** | **59** | ✅ all passing |

## 24. Yinglima Regression-Test Results

**89/89 passing.** Same 2 exclusions as every prior phase
(`test_public_rfq.py`, `test_health.py`) — both explicitly require a live,
network-reachable external PostgreSQL instance per their own docstrings;
confirmed pre-existing and unrelated to this phase (nothing Phase 3
touches is anywhere near auth/DB-connection code in Yinglima, since
Yinglima itself was not modified at all).

## 25. Inhyma Regression-Test Results

**91/91 passing.** Same 2 exclusions, same pre-existing reason. Route
count (383) and test count identical to the prior audit — the one-line
`ERP_KEY` config addition changed nothing observable in Inhyma's own
behavior, confirmed directly.

## 26. Security Findings

1. **Real, closed:** ERP Registry mutation endpoints were completely
   open in Phase 2 (by design, per that phase's own scope) — now closed
   behind `require_platform_admin`, with every mutation audited.
2. **Real, closed:** no ERP-to-ERP service authentication existed at
   all — now exists, with peppered Argon2id-hashed credentials, never
   stored in plaintext, never re-exposed after issuance.
3. **Real, mitigated:** CORS was configured with wildcard
   methods/headers alongside `allow_credentials=True` — tightened to an
   explicit list; a production-boot check now also rejects a literal
   `"*"` origin with credentials enabled.
4. **Flagged, not fixed (out of this phase's scope):** both Yinglima's
   and Inhyma's `.env.example` files contain live-looking Supabase
   `DATABASE_URL` values rather than placeholders — flagged in the Phase
   2 report already, still present, still not touched here since
   rewriting someone else's existing secrets file is outside "extend
   safely, don't rebuild what exists."
5. **No secret was ever printed, logged, or committed to documentation**
   during this work — verified by grepping this report and all source
   files for anything resembling a real credential; none present.

## 27. Secret/Configuration Cleanup Performed

- Added `PLATFORM_JWT_SECRET_KEY` and `SERVICE_CREDENTIAL_PEPPER` to
  `ERP_Main`'s `.env.example`-equivalent (its `Settings` defaults) using
  the same clearly-fake `CHANGE-ME-IN-PRODUCTION` convention Yinglima
  already uses, paired with a startup-time production check that refuses
  to boot with either placeholder still in place, or with the two values
  equal to each other.
- No existing secret in any `.env`/`.env.example` was rewritten or
  rotated — only new, additive keys were introduced.

## 28. Backward Compatibility Verification

- Yinglima: unmodified this phase; 89/89 regression tests pass; 332
  routes (unchanged count).
- Inhyma: only its own `ERP_KEY` config addition (mirrors Yinglima's
  pattern exactly); 91/91 regression tests pass; 383 routes (unchanged
  count).
- ERP_Main: every original Phase 2 registry behavior preserved
  (uniqueness, decommission-not-delete, module idempotency,
  key-immutability) — same assertions, now correctly requiring
  authentication to reach them.
- Neither local ERP's login, refresh, logout, or session behavior was
  touched in any way (Step 39) — no code in `app.auth` in either repo
  was opened.

## 29. Future ERP Onboarding Procedure

Documented, matching Step 31/63 exactly, and now backed by real working
code rather than a plan:

1. Deploy ERP #N's own application with its own `ERP_KEY`/
   `ERP_DISPLAY_NAME` in its own config (same pattern as Yinglima/Inhyma).
2. `POST /global/erps` (platform-admin authenticated) to register it —
   `status = INACTIVE` until ready.
3. `POST /global/erps/{id}/credentials` to issue its service credential.
4. `POST /global/erps/{id}/modules` (one call per capability) to declare
   what it supports — data-driven, no code branch anywhere reads a
   specific `erp_key`.
5. ERP #N's own backend calls `POST /global/erps/{id}/heartbeat` with its
   service credential once deployed and configured.
6. `PATCH /global/erps/{id}/status` to `ACTIVE` once genuinely ready for
   platform interaction (an explicit admin decision, never automatic).
7. `POST /global/users/{user_id}/memberships/{id}` to link Global Users
   to ERP #N's local accounts, same as any existing ERP.

No change to `GlobalUser`, `ErpMembership`, or any existing route's
contract is required for this — verified structurally, since nothing in
any service layer branches on a specific `erp_key`/`erp_id` value.

## 30. Remaining Risks / Technical Debt

1. Local-user verification is manual (§18) — a platform admin's word,
   not an automated check against the local ERP. Acceptable for Phase 3's
   stated scope; a real risk if relied on at larger scale without Phase
   4 building the Step 36 internal endpoint.
2. `.env.example` secret hygiene issue (§26.4) remains unaddressed,
   carried over from Phase 2's report.
3. Platform-admin session tokens have no refresh mechanism — an admin's
   session simply expires after 60 minutes and they log in again. Fine
   for a low-traffic console; would need revisiting if ERP_Main's admin
   UI becomes a daily-driver tool for many operators.
4. No rate limiting on `/global/auth/login` — Yinglima has its own
   login rate limiter; ERP_Main's does not yet. Worth adding before any
   internet-facing deployment.
5. Inhyma's `INACTIVE` status is a snapshot judgment as of this report
   (§10/§12) — it should be revisited the moment Inhyma gets a real
   deployment configuration, not left stale the way the old "placeholder"
   wording was.

## 31. Exact Recommended Phase 4 Scope

1. Full SSO / OIDC federation — explicitly NOT this phase, per Step 40,
   and not attempted.
2. Automatic local-user verification (Step 36's internal endpoint, built
   inside Yinglima's and Inhyma's own codebases this time, service-
   credential-authenticated).
3. ERP-switcher frontend (Step 51/52) — a real UI reading
   `GET /global/users/{id}/memberships` to show which ERPs a logged-in
   platform user can open, initially just linking to each ERP's existing
   login page (no seamless auth yet).
4. Rate limiting on ERP_Main's own login endpoint.
5. A genuine ERP #3 onboarding, to prove out §29's procedure against
   something that isn't Yinglima or Inhyma.
6. Revisit Inhyma's registry status once it has a real deployment.
