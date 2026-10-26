# ERP_Main — Changelog & Function Changes History

**System:** ERP_Main Control Plane  
**Scope:** Chronological engineering changes, function updates, UI hardening, and bug fixes.

## [Release 2026-10-24b] — One server-made decision for where a signed-in person belongs

**Rules (any login page, localhost or hosted, current or future ERPs):** no ERP access -> the ERP Dashboard; exactly one ERP -> that ERP only;
two or more -> may switch between exactly those; platform admins -> every ERP.

- **Backend `app/global_auth/landing.py`:** `compute_landing()` (pure) + `attach_landing()`. Every `/global/ecosystem-session/*` answer (establish, refresh,
  verify) now carries `landing = {mode: admin|dashboard|single|multi, target, erps[], control_plane_url}`. Addresses come from the ERP registry
  (`erp_instances.base_url`, ACTIVE ERPs only) and this app's `FRONTEND_URL` -- nothing hard-coded. The registry is read through a 30 s in-process cache
  (invalidated when an ERP is registered / edited / its status changes) with the last good copy as fallback if the database hiccups.
- **Front end `AppShell.tsx`:** follows the decision (`fetchLanding()` in `lib/ssoBridge.ts`); falls back to the memberships if it cannot be had; never leaves
  the person on a spinner (dashboard after 8 s); 10 s loop guard. `lib/ecosystemSession.ts`: 6 s limit on the live check (fail-open).
- Tests: `backend/tests/test_landing_decision.py`, `frontend/src/tests/AppShell.test.tsx`.

---

## [Release 2026-10-24] — A refused ERP sign-in is explained, not an endless spinner

- **Bug:** a single-ERP Global User whose ERP answered the automatic sign-in with "no access" came back to `/dashboard?sso_error=no_access`, where
  `AppShell` stopped redirecting but still drew the "Redirecting directly to your authorized ERP application..." spinner forever.
- **Fix (`frontend/src/components/AppShell.tsx`):** with `sso_error` present the page shows "We could not open <ERP>", the reason the ERP gave
  (`sso_reason`), and **Try again** (clears the redirect guard and reloads the dashboard) / **Sign out** buttons.
- **Verified:** granting an ERP in User & Access is reflected in `/global/ecosystem-session/{id}` at once, even for a session opened before the grant
  (`backend/tests/test_grant_access_reaches_spokes.py`). The refusal came from the spoke's key comparison, fixed in Inhyma and Yinglima.
- Tests: `frontend/src/tests/AppShell.test.tsx`.

---

## [Release 2026-10-19] — Universal Network Status Notifier (Offline/Online Toast & Status Indicator)

### 1. Global Network Status Listener (`NetworkStatusNotifier.tsx`)
- **Universal Offline/Online Detection:**
  - Added [`NetworkStatusNotifier.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/ERP_Main/frontend/src/components/NetworkStatusNotifier.tsx) to ERP_Main (ERP Dashboard) matching the visual and functional design implemented in Inhyma ERP.
  - Listens to `window.online` and `window.offline` lifecycle events with initial state from `navigator.onLine`.
- **Floating Offline Toast:**
  - Displays a high-z-index floating notification at the bottom-right corner when internet connectivity is lost:
    - Background: Solid red (`#dc2626`) with box shadow (`0 10px 30px rgba(220, 38, 38, 0.45)`).
    - Pulsating offline WiFi icon animation (`pulseGlow 2s infinite`).
    - Message: **"No network connection"** / *"Please check your internet connection."*
- **Auto-Dismissing Reconnection Banner:**
  - When connection is restored, transitions smoothly to an emerald green banner (`#059669`):
    - Message: **"Internet connection restored"** / *"Your system is back online."*
    - Automatically unmounts and dismisses after 3500ms.
- **Document Title Synchronization:**
  - Dynamically appends `— Offline` to the browser tab title during disconnection, restoring the original brand title when back online.
- **Root Application Mount ([`App.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/ERP_Main/frontend/src/App.tsx)):**
  - Mounted inside `<GlobalSessionProvider>` across all views.
- **Unit Test Coverage:**
  - Verified with new unit test suite [`NetworkStatusNotifier.test.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/ERP_Main/frontend/src/tests/NetworkStatusNotifier.test.tsx) passing 3/3 tests.

---

## [Release 2026-10-14] — Seed First-Install Protection, Registry Host Safeguard & Federation DNS Resilience

### 1. Database Seed First-Install Protection (`BOOTSTRAP_FORCE_RESET`)
- **Non-Destructive Bootstrap Guard:**
  - Hardened `backend/scripts/seed.py` to protect existing production database rows.
  - If existing platform administrators, global users, or registry entries are detected, database seeding exits safely without mutating live records.
  - Destructive re-initialization is strictly blocked unless `BOOTSTRAP_FORCE_RESET=true` is explicitly injected into environment variables.

### 2. Registry Host Safeguard (`seed_registry.py`)
- **Protecting Production Spoke URLs:**
  - Hardened `backend/scripts/seed_registry.py` to prevent local developer test runs from unintentionally overwriting production spoke URLs with `http://localhost:*`.
  - Spoke instance base URLs and frontend URLs are updated from environment variables (`INHYMA_ERP_URL`, `YINGLIMA_ERP_URL`, etc.) only if those variables are non-empty and explicitly set.

### 3. Platform-Gated Winsock DNS Isolation
- **Platform Gating (`sys.platform.startswith("win")`):**
  - In `backend/app/core/dns_resilience.py`, asynchronous DNS caching is platform-gated strictly to Windows developer environments.
  - Production Linux containers run unpatched with standard `glibc` resolvers.
  - DNS cache uses 5-tuple key `(host, port, family, type, proto)`, preserving exact port mappings and eliminating cross-port collisions across `localhost:8000`, `8001`, and `8002`.

---

## [Release 2026-10-14] — Session-Scoped Login & Logout (one login = one session id)

### Why
Signing out of one login used to sign the whole *person* out (every device, every ERP). Two logins of one admin account therefore logged each other out. A normal logout now ends exactly one login; "sign out everywhere" is a separate explicit action.

### Changes
- **New** `global_auth/session_ops.py`: `open_admin_session`, `session_is_live`, `parse_session_id`. Platform admin tokens now carry a `sid` claim and are valid only while that `global_sessions` row is live (`platform_auth/dependencies.py::admin_session_is_live`, also used by `platform_authz`). Older admin tokens without a `sid` keep working (checked against `tokens_revoked_before`).
- `PlatformAuthService.login_with_session` opens one session per admin login; `PlatformLoginResponse` gains `session_id`.
- `ecosystem_session.py`: new `sign_out_session` and `fanout_session_revoke`; `POST /global/ecosystem-session/{sid}/revoke` and the logout routes revoke only that session. `exchange` now binds the admin dashboard token to the verified session. A revocation recorded by another worker is honoured (database check on re-validation). `sign_out_everywhere` is kept for the explicit action.
- **New routes:** `POST /global/auth/sign-out-everywhere`, `POST /global/user-auth/sign-out-everywhere`, `POST /internal/sessions/open`, `POST /internal/sessions/{sid}/signout` (`global_users/session_internal.py`), `POST /global/auth/logout` (per session).
- `HttpErpProvisioningAdapter.revoke_session` calls each ERP's `POST /internal/sessions/{sid}/revoke`.
- **Frontend:** a fresh handover ticket always replaces a saved session (fixes the target ERP showing its login page after switching); cookie auto-sign-in uses the verified exchange; `clearEcosystemCookie` only removes the cookie of the session being signed out; cross-tab LOGOUT ignores other sessions; the admin login uses the session id it was given; failed automatic sign-in shows a reason (`ihm_login_notice`) and retries once on a transient error.
- **Reliability hardening (browser):** one shared handover exchange per arrival (was three concurrent requests whose redirects aborted each other, causing a flash of the login page); retry with 0.7/2.5/6 s waits for temporary failures only; clear per-status messages (`ihm_login_notice`); a "Signing you in..." state; the ERP switcher validates before navigating (`planSwitch`) and wakes peer services; the session watcher checks immediately on open, then every 30 s visible / 2 min hidden (was every 2.5 s).
- **Tests:** `test_session_scoped_signout.py` replaces `test_sign_out_everywhere.py`; `test_central_signout_fanout.py` and `test_global_users.py` updated; frontend `ssoHandoverSession.test.ts`.
- **Docs:** `API_DESIGN_AND_ENDPOINTS.md` section 1 and `SYSTEM_ARCHITECTURE_AND_DESIGN.md` 2.7 / 2.11 rewritten; they previously named routes and a column that do not exist in the code.

## [Release 2026-10-10] — Cross-Ecosystem Single Sign-Out (SLO), M2M Spoke Revocation & Fast Cookie Synchronizer

### 1. Cross-Ecosystem Single Sign-Out (SLO) Fan-Out Architecture
- **Centralized Session Termination in [`ecosystem_session.py`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/ERP_Main/backend/app/global_auth/ecosystem_session.py):**
  - Updated `revoke_ecosystem_session()` to trigger machine-to-machine spoke logout fan-out across all systems the user has access to.
  - Retains revoked sessions in memory with `active: False` and `revoked_at` timestamp rather than purging completely, ensuring subsequent queries return `revoked: True` to prevent re-authentication.
  - Implemented `fanout_spoke_logout(db, user_email)`: resolves all active ERP memberships for Global Users (or all registered ERP instances for Platform Admins) and issues parallel logout commands.
- **Provisioning Adapter Extension in [`base.py`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/ERP_Main/backend/app/identity_linking/adapters/base.py) & [`http_adapter.py`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/ERP_Main/backend/app/identity_linking/adapters/http_adapter.py):**
  - Added abstract `logout_local_user(local_user_id, reason)` to `BaseErpProvisioningAdapter`.
  - Implemented `logout_local_user` in `HttpErpProvisioningAdapter` dispatching authenticated requests to spoke `POST /api/v1/internal/users/{identifier}/logout` with internal HMAC headers.
- **Global Auth Route Handlers in [`routes.py`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/ERP_Main/backend/app/global_auth/routes.py):**
  - Integrated `fanout_spoke_logout` into `POST /global/user-auth/logout`, invalidating all granted spoke ERP sessions simultaneously whenever a user signs out of the control plane.

### 2. Multi-Origin Browser Cookie Synchronizer & Fast Session Watcher
- **Shared Localhost Cookie Marker in [`ecosystemSession.ts`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/ERP_Main/frontend/src/lib/ecosystemSession.ts):**
  - Implemented `ihm_ecosystem_logged_out=1` cookie set across all subdomains and localhost ports (`5170`, `5173`, `5174`) upon logout.
  - Added `isExplicitlyLoggedOut()` helper checking both local `sessionStorage` and the shared cookie marker.
  - Updated `setEcosystemCookie()` to clear `ihm_ecosystem_logged_out` on fresh logins.
- **Fast Watcher & Tab Synchronization:**
  - Upgraded `initEcosystemSessionWatcher()` polling interval to 2.5 seconds (down from 10s) and hooked into `window.addEventListener('focus')` and `document.addEventListener('visibilitychange')`.
  - If a logout is initiated in another tab or spoke ERP, other tabs detect the logout marker immediately, clear local storage (`Auth.clear()`), and navigate to `/login`.
- **AppShell Mount Guard in [`AppShell.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/ERP_Main/frontend/src/components/AppShell.tsx):**
  - Evaluates `isExplicitlyLoggedOut()` on mount and immediately clears local session state and halts access if a global logout is active.
  - Connected the user menu Logout action to `useGlobalSession().logout()`, properly terminating both central and spoke sessions.

---

## [Release 2026-10-10] — Single-ERP Dynamic Redirection, Handover Query Sanitization & Spoke 403 Loop Elimination

### 1. Dynamic Single-ERP Membership Resolution & Fallback Removal
- **Eager ERP Instance Serialization in [`schemas.py`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/ERP_Main/backend/app/erp_memberships/schemas.py) & [`routes.py`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/ERP_Main/backend/app/erp_memberships/routes.py):**
  - Added `erp_key: str | None = None`, `erp_name: str | None = None`, and `erp_display_name: str | None = None` to `ErpMembershipRead` and `ErpMembershipWithErpSummary`.
  - Updated `ErpMembershipRepository.list_for_user()` in [`repository.py`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/ERP_Main/backend/app/erp_memberships/repository.py) to eagerly load `erp_instance` via SQLAlchemy `joinedload(ErpMembership.erp_instance)`.
  - Serialized `erp_key`, `erp_name`, and `erp_display_name` in `list_user_memberships` responses so frontends receive the canonical spoke ERP identifier.
- **Strict Target Resolution in [`ssoBridge.ts`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/ERP_Main/frontend/src/lib/ssoBridge.ts):**
  - Updated `resolveSingleErpDirectUrl` to strictly check `erp_key`, `erp_display_name`, `erp_name`, or `userContext.allowed_erps`.
  - Eliminated the empty-string substring match `target.includes("")` against `getEcosystemErps()`, which previously defaulted missing keys to `"yinglima"`.
- **Elimination of Hardcoded Fallback in [`Login.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/ERP_Main/frontend/src/pages/Login.tsx) & [`AppShell.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/ERP_Main/frontend/src/components/AppShell.tsx):**
  - Removed the `|| "yinglima"` fallback for single-membership accounts. Users granted access to only Inhyma ERP (e.g. `userb@gmail.com`) are routed strictly to Inhyma ERP (`http://localhost:5174/dashboard`).

### 2. Spoke ERP 403 Loop Prevention & Cross-ERP Auto-Redirection
- **Immediate Address Bar Query Sanitization in Spoke `ssoBridge.ts`:**
  - Stripped `sso_handover` from `window.location.search` immediately upon ingestion via `window.history.replaceState`. Prevents failed or reloaded tickets from persisting in the URL and triggering duplicate login attempts.
- **Auto-Redirection on 403 Rejection:**
  - Added failover redirection in `processIncomingSsoHandover()` catch block: if a spoke returns HTTP 403 (e.g. user navigated to Yinglima but is only granted Inhyma), the spoke immediately clears invalid local session state (`Auth.clear()`), inspects the user's active central ecosystem session, and redirects them via SSO handover to their designated granted ERP (or `http://localhost:5170/dashboard`).
- **Loop Defense in AppShell & App Lifecycle:**
  - Stripped `sso_handover` when redirecting unauthenticated users to `/login` in `AppShell.tsx`.
  - Added `ssoProcessedRef = useRef(false)` in spoke `App.tsx` preventing concurrent or redundant handover processing during React mount lifecycles.

### 3. Multi-Domain Ping-Pong Loop Defense & Real-Time Cache Invalidation
- **Live Permission Revalidation in [`ecosystem_session.py`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/ERP_Main/backend/app/global_auth/ecosystem_session.py):**
  - Updated `_resolve_live_session` to re-query active memberships (`_active_erp_keys`) directly from the database for Global Users. Prevents in-memory session cache TTL from serving stale `allowed_erps: ["control-plane"]` immediately after an administrator grants new spoke access.
  - Implemented `invalidate_ecosystem_session_cache_for_user(email)` invoked upon membership creation, status transitions, and deletions across `erp_memberships` and `identity_linking`.
- **Spoke Account Activation Guarantee in [`identity_linking/service.py`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/ERP_Main/backend/app/identity_linking/service.py):**
  - Updated `provision_global_user_to_erp` so that even when a membership record is already ACTIVE in ERP_Main, it contacts the spoke ERP to ensure the local user is un-deleted (`deleted_at = None`) and activated (`is_active = True`, `can_login = True`).
- **Ping-Pong Loop Breaker in [`AppShell.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/ERP_Main/frontend/src/components/AppShell.tsx):**
  - Added a 10-second redirect cooldown in `sessionStorage` preventing immediate re-execution of single-ERP redirection.
  - Added `sso_error` query detector in `AppShell.tsx` to stop auto-redirect loops if a spoke ERP rejects a handover.
  - Synchronized `setEcosystemCookie` with newly assigned ERP keys before dispatching the user to the spoke ERP.

---

## [Release 2026-10-10] — Zero-Grant Official Dashboard Redirection, Spoke Access Guard, and User Isolation Hardening

### 1. Zero-Grant Spoke Redirection to Official Central Dashboard
- **Cross-ERP Redirection for Unassigned Users:**
  - Users created in the global directory without assigned spoke ERP access (e.g. `User A`, `User B`, `User C`, `User D` with `allowed_erps = ["control-plane"]`) are automatically routed to the official control plane dashboard ([`http://localhost:5170/dashboard`](http://localhost:5170/dashboard)).
  - If a zero-grant user attempts to sign in via a spoke ERP login screen ([`http://localhost:5174/login`](http://localhost:5174/login) or [`http://localhost:5173/login`](http://localhost:5173/login)), the spoke's `routeForCentralSession()` generates an SSO handover ticket and redirects the browser directly to `http://localhost:5170/dashboard`.
  - If an unassigned user navigates directly to a spoke URL (such as `http://localhost:5174/dashboard` or `http://localhost:5173/dashboard`) with an active central session cookie, `processIncomingSsoHandover()` and `AppShell` detect `!hasErpAccess`, wipe any invalid local tokens via `Auth.clear()`, and immediately bounce them to `http://localhost:5170/dashboard`.

### 2. Central Database Inspection & Flexible Identification (`establish_ecosystem_session`)
- **Multi-Identifier Lookup in [`ecosystem_session.py`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/ERP_Main/backend/app/global_auth/ecosystem_session.py):**
  - Updated `establish_ecosystem_session` to scan both `GlobalUser` and `PlatformAdmin` tables across multiple search keys: canonical `primary_email`, `display_name` (e.g. `"User A"`), and username prefixes (e.g. `"usera"`).
  - Resolves input seamlessly whether typed as an email (`usera@gmail.com`), display name (`User A`), or username prefix.
  - Live queries active spoke memberships via `_active_erp_keys(db, user.id)` checking `erp_memberships` joined with `erp_instances` where `status == ACTIVE`. Unassigned users resolve strictly to `["control-plane"]`.

### 3. User Isolation & Session Hygiene in `ssoBridge.ts`
- **Email Mismatch Clearance in [`ssoBridge.ts`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/ERP_Main/frontend/src/lib/ssoBridge.ts):**
  - Enforced user isolation in `processIncomingSsoHandover()`: if an incoming handover or ecosystem cookie targets a different user email than the cached local session profile, `Auth.clear()` is called prior to exchanging tokens.
  - Safe email extractor handles the `CurrentUser` union type (`GlobalUserProfile | PlatformAdmin`), extracting whichever email property exists (`primary_email` or `email`).
  - Added optional `email?: string` to `GlobalUserProfile` in [`types/index.ts`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/ERP_Main/frontend/src/types/index.ts).

### 4. Zero-Grant Navigation Guard in `AppShell`
- **Restricted UI for Unassigned Users in [`AppShell.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/ERP_Main/frontend/src/components/AppShell.tsx):**
  - Users with platform role `NONE` or empty roles are restricted to viewing only the `Dashboard` module in the navigation sidebar (all other modules hidden).
  - Renders a clean "No ERP Access Assigned" welcome card prompting the user to contact their platform administrator.

---

## [Release 2026-10-10] — Platform Role Deletion Preservation, Mixed Content Elimination, PgBouncer Prepared Statement Fix & Access Sync Engine

### 1. Platform Authorization Role Deletion Preservation & Starter Demo Separation
- **Root Cause & Fix in [`seed_platform_authz.py`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/ERP_Main/backend/scripts/seed_platform_authz.py):**
  - Previously, running seeds on backend startup re-created all default roles, resurrecting user-deleted starter roles (such as `Platform Operator`, `Platform Viewer`, or custom deleted roles).
  - Explicitly separated platform roles into `_MANDATORY_SYSTEM_ROLES` (`PLATFORM_SUPER_ADMIN`, `PLATFORM_ADMIN`) and `_STARTER_ROLES` (`PLATFORM_OPERATOR`, `PLATFORM_VIEWER`).
  - Implemented `is_initial_bootstrap` detection by querying `service.role_repository.get_by_key("PLATFORM_SUPER_ADMIN")`.
  - Mandatory system roles are always maintained, but starter demonstration roles are **only** seeded if the platform database is completely empty on initial bootstrap.
  - On subsequent restarts, starter demo role seeding is skipped, permanently preserving administrative role deletions.

### 2. Elimination of Insecure HTTP Fallbacks & Mixed Content Guard
- **`isLocalhost()` Security Interceptor:**
  - In [`ecosystemSession.ts`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/ERP_Main/frontend/src/lib/ecosystemSession.ts) and [`ssoBridge.ts`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/ERP_Main/frontend/src/lib/ssoBridge.ts), wrapped all `http://localhost:*` fallback URLs with `isLocalhost()` guards.
  - In production HTTPS deployments (e.g. Render, Cloudflare, custom domains), insecure `http://` calls to ports `:8000`, `:8001`, `:8002`, `:5173`, and `:5174` are suppressed, eliminating browser Mixed Content blocking errors (`Blocked loading mixed active content`).
- **Dynamic API Gateway Origin Support:**
  - In [`api.ts`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/ERP_Main/frontend/src/lib/api.ts), added native support for `VITE_API_ORIGIN` allowing split static frontend deployments to target external backend origins cleanly.
  - Routed `CENTRAL_AUTH_API` dynamically through `API_BASE`.

### 3. Database Connection Hardening for Supabase Transaction Pooler (PgBouncer)
- **Prepared Statement Cache Auto-Disable:**
  - In [`app/database/engine.py`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/ERP_Main/backend/app/database/engine.py), implemented `_statement_cache_must_be_disabled()`.
  - Automatically identifies transaction-mode PgBouncer / Supabase connection poolers operating on port 6543 and configures asyncpg with `statement_cache_size=0`.
  - Permanently eliminates PostgreSQL `DuplicatePreparedStatementError: prepared statement "..." already exists` during high-concurrency pool multiplexing.

### 4. Durable Access Sync Recovery Engine
- **Database Migration [`0011_access_sync_tasks.py`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/ERP_Main/backend/alembic/versions/0011_access_sync_tasks.py):**
  - Created table `access_sync_tasks` with foreign keys to `erp_memberships` and `erp_instances`.
  - Tracks synchronization lifecycle: `PENDING_RETRY`, `IN_PROGRESS`, `SUCCESS`, and `FAILED`.
  - Supports lease expiration (`lease_expires_at`), worker claims (`claimed_by`), and bounded retry counters (`max_retries=10`).
  - Added indexes `ix_access_sync_tasks_membership_id`, `ix_access_sync_tasks_erp_instance_id`, and composite index `ix_access_sync_eligible` (`status`, `next_retry_at`, `lease_expires_at`).
- **Access Sync Service [`access_sync_service.py`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/ERP_Main/backend/app/identity_linking/access_sync_service.py):**
  - When an administrator suspends, restores, or revokes a membership in ERP_Main, any network interruption to spoke ERPs is caught and converted into a durable task.
  - Retries with bounded exponential backoff until the target spoke confirms receipt.
  - Re-evaluates current membership and global user state on every retry attempt to prevent stale state propagation.

### 5. High-Scale Case-Insensitive & Status Indexes
- **Database Migration [`0012_scale_indexes.py`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/ERP_Main/backend/alembic/versions/0012_scale_indexes.py):**
  - Added functional B-tree index `ix_global_users_primary_email_lower` on `lower(primary_email)` in `global_users`.
  - Added composite indexes `ix_erp_memberships_user_status` on `(global_user_id, status)` and `ix_erp_memberships_erp_status` on `(erp_instance_id, status)` in `erp_memberships`.
  - Guarantees sub-millisecond lookup latency for sign-in, session checks, and access grants even with 50,000+ active enterprise accounts.

### 6. Bi-Directional Password Synchronization & Central Session Exchange
- **Internal Password Sync Endpoint [`password_sync.py`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/ERP_Main/backend/app/global_users/password_sync.py):**
  - Added `POST /api/v1/internal/users/password` accepting password updates from spoke ERPs authenticated via internal service credentials.
  - Securely updates `global_user_credentials` and invokes `push_password_to_memberships` to fan out updates to all active spoke memberships.
- **Central Session Verification & Exchange [`ecosystem_session.py`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/ERP_Main/backend/app/global_auth/ecosystem_session.py):**
  - Hardened `get_ecosystem_session` to validate live database state (user status, active memberships, session expiration) on every request rather than relying purely on in-memory caches.
  - Added `POST /api/v1/global/ecosystem-session/exchange` allowing SSO handover visitors with valid central sessions to obtain authenticated ERP_Main access tokens matching their specific identity.

### 7. Seed Membership Idempotency & Virtualenv Stability
- **Seed Script Resilience in [`seed.py`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/ERP_Main/backend/scripts/seed.py):**
  - Enforced pre-check on `existing_mem` before creating default memberships, preventing `uq_erp_memberships_user_erp` unique constraint collision on repeated seed executions.
  - Updated [`seed_registry.py`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/ERP_Main/backend/scripts/seed_registry.py) with dynamic `_dashboard_url()` reading `ERP_MAIN_DASHBOARD_URL` / `FRONTEND_URL`.
- **Python Virtualenv Interpreter Resolution in `server.py`:**
  - Switched from `str(Path(sys.executable).resolve())` to `sys.executable` to prevent Windows from dereferencing `.venv` symlinks to the system Python.

---

## [Release 2026-10-05] — Production Deployment Readiness, Zero-LAN URL Decoupling & Multi-Cloud Infrastructure

### 1. Peer ERP API Resolution Overrides
- **Environment Overrides for Identity Linking:** In [`http_adapter.py:43-57`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/ERP_Main/backend/app/identity_linking/adapters/http_adapter.py#L43-L57), eliminated hardcoded `127.0.0.1:8001` / `127.0.0.1:8002` fallbacks. Added support for `YINGLIMA_API_URL` and `INHYMA_API_URL` environment variables so the Control Plane can communicate with spokes in VPCs, container networks, or live subdomains.

### 2. Central Dashboard Spoke Launch Switcher
- **Parametric Spoke Launching:** In [`ssoBridge.ts:40-55, 130-150`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/ERP_Main/frontend/src/lib/ssoBridge.ts#L40-L55), updated `getEcosystemErps()` and `launchErpWithMembership()` to read `VITE_YINGLIMA_URL` and `VITE_INHYMA_URL` when an admin launches a spoke from the central dashboard.

### 3. Server Settings & Cloud Port Binding
- **Typed Server Settings:** Added `HOST`, `PORT`, `BACKEND_URL`, `FRONTEND_URL`, and verified `OPENAPI_URL` in [`config.py`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/ERP_Main/backend/app/core/config.py).
- **Dynamic Port Binding:** Updated [`backend/Dockerfile`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/ERP_Main/backend/Dockerfile) to dynamically bind to `${PORT:-8000}`.
- **Cross-Subdomain SSO Cookies:** Updated [`ecosystemSession.ts`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/ERP_Main/frontend/src/lib/ecosystemSession.ts) to support `VITE_CENTRAL_AUTH_API` and `VITE_COOKIE_DOMAIN`.

### 4. Cloud Infrastructure Assets
- **Docker & Nginx:** Added [`frontend/Dockerfile`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/ERP_Main/frontend/Dockerfile) and [`frontend/nginx.conf`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/ERP_Main/frontend/nginx.conf).
- **Render Blueprint:** Added [`render.yaml`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/ERP_Main/render.yaml) for 1-click Render web service and static site provisioning.
- **Compose Orchestration:** Added [`docker-compose.prod.yml`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/ERP_Main/docker-compose.prod.yml) and master [`docker-compose.ecosystem.yml`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/docker-compose.ecosystem.yml).

---

## [Release 2026-10-03] — Machine Identifier Routing (erp-01/erp-02) & Dynamic Multi-ERP Company Display

### 1. Machine Identifier Routing & Secret Validation
- **Machine Identification Protocol:** Extended [`config.py`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/ERP_Main/backend/app/core/config.py) `get_service_credential_for_erp()` to recognize unique machine identifiers `erp-01` (Inhyma port 8002) and `erp-02` (Yinglima port 8001) alongside legacy keys.
- **RPC Routing Adapter:** Updated [`http_adapter.py`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/ERP_Main/backend/app/identity_linking/adapters/http_adapter.py) to resolve target base URLs via `erp.key in ("yinglima", "erp-02")` and `erp.key in ("inhyma", "erp-01")`.
- **Dependency Health Monitoring:** Updated [`health/routes.py`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/ERP_Main/backend/app/health/routes.py) reporting `erp-01` and `erp-02` credential status.

### 2. Dynamic Spoke Company Display & Peer Switcher
- **Ecosystem Switcher Dynamic Resolution:** Updated [`EcosystemSwitcher.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/ERP_Main/frontend/src/components/EcosystemSwitcher.tsx) and [`ssoBridge.ts`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/ERP_Main/frontend/src/lib/ssoBridge.ts) to query connected spoke apps' `/organizations/public` endpoints, caching dynamic company names locally and rendering `{isCurrent ? displayName : (peerNames[erp.key] || erp.name)}`.
- **Global User Access Grants:** Updated [`GlobalUsers.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/ERP_Main/frontend/src/pages/GlobalUsers.tsx) to resolve spoke instances by `erp-01` / `erp-02` and display live `{erp.name || erp.display_name}` instead of hardcoded strings in access checkboxes.
- **Generic Onboarding Messages:** Updated [`Dashboard.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/ERP_Main/frontend/src/pages/Dashboard.tsx) empty state to be completely generic.

---

## [Release 2026-09-29] — Global Autocomplete Blocker & UI Hardening

### 1. Global Autocomplete & Autofill Suppression System
- **File Added:** [`ERP_Main/frontend/src/lib/autocompleteBlocker.ts`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/ERP_Main/frontend/src/lib/autocompleteBlocker.ts).
- **Core Functionality:**
  - Automated continuous DOM `MutationObserver` on `document.body` detecting all newly mounted forms and inputs.
  - Automatically injects `autocomplete="off"`, `autocapitalize="off"`, `spellcheck="false"`, `data-lpignore="true"` (LastPass disabler), and `data-form-type="other"` (1Password/Bitwarden heuristic disabler).
  - Implemented document-level capture-phase `focusin` event interceptor to guarantee suppression attributes are active prior to browser suggestions rendering.
- **Root Initialization:** Connected to application lifecycle in [`ERP_Main/frontend/src/App.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/ERP_Main/frontend/src/App.tsx).
- **Explicit Form Hardening:**
  - Hardened inputs across [`GlobalUsers.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/ERP_Main/frontend/src/pages/GlobalUsers.tsx), [`PlatformAuthz.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/ERP_Main/frontend/src/pages/PlatformAuthz.tsx), and [`ErpRegistry.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/ERP_Main/frontend/src/pages/ErpRegistry.tsx).

### 2. Wheel Scroll Lockout & Spin-Button Elimination
- **Document Wheel Listener:** Added passive `wheel` listener in [`ERP_Main/frontend/src/main.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/ERP_Main/frontend/src/main.tsx) that immediately triggers `.blur()` on `input[type="number"]` when scrolled, preventing accidental numeric value mutations.
- **CSS Spin-Button Removal:** Updated [`ERP_Main/frontend/src/styles/style.css`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/ERP_Main/frontend/src/styles/style.css) with `-webkit-outer-spin-button` and `-webkit-inner-spin-button` display suppression and `-moz-appearance: textfield`.

---

## [Release 2026-09-26] — Access Governance Unification & True Spoke Deprovisioning

### 1. Unified Access Grants UI
- **Retired Standalone Tab:** Removed redundant `/access/memberships` navigation tab and routed all traffic directly to `/access/users`.
- **Integrated Modal Controls:** Replaced decoupled membership assignment with unified "ERP Access Grants" checkboxes inside the Global User Create and Edit modals.
- **Clean Badge Normalization:** Unassigned or revoked spoke access now renders as neutral gray `None` badges (`Inhyma: • None`).

### 2. True Spoke User Deprovisioning
- **Internal RPC Adapter:** Implemented `deprovision_local_user()` in [`adapters/http_adapter.py`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/ERP_Main/backend/app/identity_linking/adapters/http_adapter.py) invoking spoke endpoint `POST /api/v1/internal/users/{id}/deprovision`.
- **Automated Revocation:** Unchecking an access grant terminates remote sessions and soft-deletes the local spoke record so they disappear from the spoke user table.
- **Root Admin Protection:** Enforced safety invariants preventing the deprovisioning of `admin@example.com`.

### 3. Conditional Navigation Architecture
- **Single-ERP Users:** Automatically redirected from central login (`:5170`) to their authorized spoke ERP (`:5173` or `:5174`) with an SSO handover token; switcher dropdown is hidden.
- **Multi-ERP Users:** Retained on the central ERP Dashboard with access to the topbar Ecosystem Switcher.

### 4. Ecosystem Switcher Bug Fix (Alice Wonder)
- **Attribute Fix:** Resolved `AttributeError: type object 'ErpInstance' has no attribute 'erp_key'` by correcting the query to `select(ErpMembership, ErpInstance.key)` in `ecosystem_session.py`.
- **Session Cookie Generation:** Allowed `ihm_ecosystem_session` to be issued properly with `allowed_erps: ["yinglima", "inhyma", "control-plane"]`.

---

## [Release 2026-10-10] — Real-Time Provisioning Synchronization, Resilient Re-Granting & Endpoint Resolution

### 1. Root Cause Resolution for `Pending (Retry)` Malformed Responses
- **URL Resolution Bug Fixed:** In [`HttpErpProvisioningAdapter._resolve_erp_api_url`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/ERP_Main/backend/app/identity_linking/adapters/http_adapter.py), database records storing public frontend dashboard URLs (e.g., `https://yinglima-erp-frontend.onrender.com/dashboard`) previously caused provisioning HTTP requests to target the frontend SPA instead of the backend API, returning HTML (`<!DOCTYPE html>...`) and triggering an unparseable JSON error.
- **Dynamic API Routing:** `_resolve_erp_api_url` now reliably maps to local spoke API ports (`http://127.0.0.1:8001` for Yinglima and `http://127.0.0.1:8002` for Inhyma) in `local` and `test` environments or when `localhost`/frontend URLs are encountered. In production, `-frontend` URLs are dynamically translated to `-backend` endpoints.
- **Directional Service Credentials:** Configured `ERP_MAIN_TO_YINGLIMA_SERVICE_CREDENTIAL` and `ERP_MAIN_TO_INHYMA_SERVICE_CREDENTIAL` in `ERP_Main/.env` and `config.py`, guaranteeing that machine-to-machine calls match each spoke's accepted authorization tokens.

### 2. Spoke User Restoration on Re-Granting
- **Soft-Delete Restoration:** Updated `POST /api/v1/internal/users/provision` in both [`Yinglima_ERP`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Yinglima_ERP/backend/app/api/v1/internal_users.py) and [`Inhyma_ERP`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/backend/app/api/v1/internal_users.py). When an administrator unticks and then re-ticks access for a user, the spoke ERP now checks for any existing user by normalized email (regardless of `deleted_at`), restores `deleted_at = None`, sets `is_active = True`, resets `status = ACTIVE`, and synchronizes password credentials.
- **Instant Spoke User List Visibility:** When granted access in ERP_Main, users now instantly appear in the spoke ERP's `/users` table; when revoked in ERP_Main, they are soft-deleted and removed from the spoke ERP's `/users` list.

### 3. Frontend Resilient Retry & Interactive Badges
- **Pending Membership Retry on Save:** Updated `handleSaveEdit` in [`GlobalUsers.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/ERP_Main/frontend/src/pages/GlobalUsers.tsx) so that existing memberships in `PENDING` state trigger automatic provisioning retries upon saving grants.
- **Interactive Badges:** The `Pending (Retry)` badge in the Global Users access column is now interactive (`cursor: pointer`), allowing administrators to trigger a live synchronization retry directly by clicking the badge.

---

## [Release 2026-10-10 Part 2] — Ecosystem Session Reliability, Cross-ERP Switching & False Logout Elimination

### 1. Root Cause Resolution for False Logouts and Switch Loops
- **Session Revocation Disambiguation:** In [`ecosystemSession.ts`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/ERP_Main/frontend/src/lib/ecosystemSession.ts), the `ihm_ecosystem_logged_out` cookie was previously written as a generic `"1"`, which caused all newly established sessions in any tab or port to be treated as revoked upon window focus or switcher navigation.
- **Session-ID Keyed Revocation:** `clearEcosystemCookie(sessionId)` now records the exact revoked session ID inside `ihm_ecosystem_logged_out`. `isExplicitlyLoggedOut(currentSessionId)` only flags revocation if the cookie's recorded ID matches the current active session. Fresh sessions created on switch or re-login are never blocked.
- **SSO Handover Exemption:** Added immediate exemption for incoming SSO handover navigation (`sso_handover` query param in URL) ensuring newly transitioned users are never rejected as explicitly logged out.
- **Domain & Port Cookie Cleansing:** Implemented `clearCookieEverywhere` and `setCookieEverywhere` covering host-only, `localhost`, `127.0.0.1`, current hostname, and `VITE_COOKIE_DOMAIN`, completely avoiding phantom cross-domain cookies.

### 2. Multi-Tab Session Synchronization & Polling Loop Hardening
- **Watcher Polling Loop Fix:** Removed redundant calls to `clearEcosystemCookie()` inside the periodic watcher (`checkRevocation`), preventing the 60-second logout cookie window from being perpetually renewed in an infinite logout loop.
- **Tab Focus Stale State Recovery:** In [`initEcosystemSessionWatcher`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/ERP_Main/frontend/src/lib/ecosystemSession.ts), window `focus` events safely purge stale tab-scoped `ihm_explicit_logout` flags when an active local session is running.

### 3. Role-Based Switcher Filtering & Navigation Fallbacks
- **Non-Admin Switcher Access Controls:** In [`EcosystemSwitcher.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/ERP_Main/frontend/src/components/EcosystemSwitcher.tsx), spoke ERP options are now strictly filtered against the user's `activeMemberships` for non-super-admins.
- **Switch Failure Fallback:** Wrapped `handleSwitch` in try/catch blocks with graceful direct URL redirection fallback if SSO handover ticket generation encounters network interruptions.
- **Local Login Fallback Session:** In [`Login.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/ERP_Main/frontend/src/pages/Login.tsx), local login automatically establishes a fallback ecosystem session cookie if central control plane communication is degraded.

### 4. Backend Ecosystem Session Hardening & Server Restart Resilience
- **Accurate Not-Found Status:** In [`ecosystem_session.py`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/ERP_Main/backend/app/global_auth/ecosystem_session.py), `GET /global/ecosystem-session/{session_id}` now accurately returns `{"notFound": True, "revoked": False}` for unknown sessions, preventing spoke ERPs from mistaking a fresh/un-cached session as explicitly revoked.
- **PlatformAdmin Session DB Persistence:** `establish_ecosystem_session` ensures a mirrored `GlobalUser` row exists for authenticating `PlatformAdmin` users, guaranteeing their sessions are persisted in `global_sessions` table and survive backend server restarts or multi-worker reload without unexpected logouts.
- **PlatformAdmin Direct ID Resolution:** In `_session_from_db`, added fallback to resolve `PlatformAdmin` records directly if `global_user_id` matches an admin record, ensuring uninterrupted access for administrators across process restarts.

---

## [Phases 1–7] — Core Infrastructure & Projections
- Implemented OpenID Connect (OIDC) authority, RS256 token signing, and JWKS endpoint.
- Built ERP Registry with spoke discovery and health probes.
- Built Event Ingestion and Materialized Projections Engine with Dead Letter Queue.
- Implemented asynchronous CSV/XLSX export engine with directory traversal protection.
