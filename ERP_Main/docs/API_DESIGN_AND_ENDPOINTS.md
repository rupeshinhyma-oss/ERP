# ERP_Main — API Design & Endpoints Specification

**Service Base URL:** `http://localhost:8000/api/v1`  
**Authentication Scheme:** Bearer JWT (RS256 / HS256) & HTTP-Only Session Cookies  
**Standard Response Envelope:** `{ "success": true, "data": ..., "meta": ..., "error": null }`

---

## 1. Authentication & Session Authority

| Method | Endpoint URI | Description | Auth Required |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/v1/global/auth/login` | Platform admin login. Opens ONE session; returns `access_token` and `session_id` (the token carries it as `sid`) | Public |
| `POST` | `/api/v1/global/user-auth/login` | Global user login. Opens ONE session; returns `access_token` and `session_id` | Public |
| `POST` | `/api/v1/global/auth/logout` | Sign out THIS admin session everywhere it was used | Admin token |
| `POST` | `/api/v1/global/user-auth/logout` | Sign out THIS user session everywhere it was used | User token |
| `POST` | `/api/v1/global/auth/sign-out-everywhere` | Explicit: end EVERY session of this admin account | Admin token |
| `POST` | `/api/v1/global/user-auth/sign-out-everywhere` | Explicit: end EVERY session of this user account | User token |
| `POST` | `/api/v1/global/ecosystem-session/establish` | Establish or read a central session (password, or a live `existing_session_id`) | Credentials / live session |
| `GET` | `/api/v1/global/ecosystem-session/{session_id}` | Live verification of a central session and its allowed ERPs | Public / Spoke |
| `POST` | `/api/v1/global/ecosystem-session/exchange` | Exchange a verified central session for a dashboard token **bound to that session** | Session ID + Email |
| `POST` | `/api/v1/global/ecosystem-session/{session_id}/revoke` | Sign out that ONE session everywhere (the session id is the secret) | Session ID |

### 1.1 Session model: one login = one session id (`sid`)
- **Every login opens exactly one central session** (a `global_sessions` row). Its UUID is the `sid`. It is placed in **every token issued during that login**: the ERP_Main token (`sid` claim for admins, `jti` for global users) and each ERP's access and refresh tokens (`sid` claim). The browser keeps the same id in `localStorage` (`Auth.getSessionId()`) and mirrors it in the shared `ihm_ecosystem_session` cookie.
- **Where a session starts.** Dashboard login (`/global/auth/login`, `/global/user-auth/login`) returns `session_id`. An ERP login (`/auth/login`) calls ERP_Main `POST /internal/sessions/open` *after* it verified the password itself and gets the session id back (`session_mode: "central"`). Switching ERPs (`/auth/sso-handover`) **reuses** the central session of the login that clicked Switch, so the dashboard and every ERP of one login share one `sid`.
- **Two logins are two sessions.** The same account on two devices, or two different accounts, have different `sid`s and never affect each other.
- **Normal sign-out ends exactly one session.** Logout anywhere (dashboard or any ERP) revokes that `sid`: the central row and cached copy, then every ERP the person may use is told (`POST /internal/sessions/{sid}/revoke`; admin: all ACTIVE ERPs, user: ERPs with an ACTIVE membership). In each ERP the `sid` is stored in `token_blacklist` (`jti = "sid:<sid>"`), so all access *and* refresh tokens of that session stop working at once and that session's WebSockets are closed. Idempotent: signing out twice, or an unknown session, is not an error.
- **"Sign out everywhere" is a separate, explicit action** (see 1.2). It is never triggered by a normal logout.

### 1.2 Sign out everywhere (explicit)
`POST /api/v1/global/auth/sign-out-everywhere` (platform admin) and `POST /api/v1/global/user-auth/sign-out-everywhere` (global user). Revokes **every** session of the account on every device, stamps `platform_admins.tokens_revoked_before` (which also invalidates admin tokens issued before sessions existed, i.e. without a `sid`) and force-logs the person out of all of their ERPs (`POST /internal/users/{email}/logout` on each ERP). Response: `{ "status": "signed_out_everywhere", "email": "...", "dashboard_sessions_revoked": N, "admin_tokens_invalidated": true|false }`. There is no UI button yet.

### 1.3 Service-to-service contracts
All use the shared per-ERP service credential: `Authorization: Bearer <credential>` and `X-ERP-Key: <erp key>`.

| Hosted by | Endpoint | Purpose |
| :--- | :--- | :--- |
| ERP_Main | `POST /api/v1/internal/sessions/open` body `{ "email" }` | An ERP verified a password; open the ONE central session of this login. `403` if the person has no ACTIVE access grant for the calling ERP, `404` if unknown. The ERP then issues a local-only session (see 1.4). |
| ERP_Main | `POST /api/v1/internal/sessions/{sid}/signout` | An ERP reports a logout; ERP_Main ends that session everywhere. |
| ERP_Main | `POST /api/v1/internal/users/password` | An ERP reports a password change; ERP_Main stores it and pushes it to the person's other ERPs. |
| each ERP | `POST /api/v1/internal/sessions/{sid}/revoke` | ERP_Main ends one session in this ERP. |
| each ERP | `POST /api/v1/internal/users/{id-or-email}/logout` | Force-logout every session of one person (used by "sign out everywhere", disabling a user, removing access). |

### 1.4 Fallbacks and error handling (reliability rules)
| Situation | Behaviour |
| :--- | :--- |
| ERP_Main unreachable (or refuses) when someone logs into an ERP | The login **still succeeds**. Tokens carry a local id `loc-<uuid>` and the reply says `"session_mode": "local"`. Works inside that ERP; switching ERPs is refused with a clear message until the person signs in again. Logout of a local session works without ERP_Main. |
| A sign-out message to an ERP is lost (ERP down, network) | Each ERP also asks ERP_Main about central sessions it sees (`central_session_state`, cached 45 s) and ends a revoked one itself, durably. Worst case about 45 seconds. |
| ERP_Main unreachable while an ERP checks a session | **Fail-open** (answer "unknown", re-check after 15 s): an outage never logs everybody out. Switching ERPs (the handover) **fails closed**: it needs ERP_Main to verify the session and answers "Could not confirm your session with ERP_Main. Please try again in a moment." |
| Several worker processes | The database is the truth: a revocation made by another worker is honoured on the next re-validation (about 10 s cache). |
| Admin token issued before sessions existed (no `sid`) | Still accepted; it can only be ended with sign-out-everywhere (`tokens_revoked_before`). |
| Browser arrives with a handover ticket | A fresh ticket **always wins** over a saved session: stale or foreign saved state is cleared and the ticket exchanged. All components that ask on the same page load (App, AppShell, Login, AuthCallback, React dev double-run) **share one exchange**. |
| The control plane is unreachable during a handover | The ERP answers **503** (retryable), not 401. The browser retries only temporary failures (network, 5xx) after 0.7 s, 2.5 s and 6 s while the page shows a progress state ("Signing you in..."). After the last retry the login page says the service is temporarily unavailable; the person's session and shared cookie are kept, so the next attempt works. |
| A handover is refused (4xx) | Final, never retried. **401**: "Your session has ended" and that central session is forgotten. **403**: "You do not have access to this ERP" and the person is sent to an ERP they can use (or the dashboard if its address is configured). No redirect to a made-up address is ever built. |
| Clicking Switch in the ERP switcher | The switcher checks first (`planSwitch`): the target address must be configured, the sign-in must be a central session (not ERP-only) and not ended. Otherwise it shows the reason inside the menu instead of leaving the page. Opening the menu also wakes sleeping peer services. |
| Watching for a session ended elsewhere | Each open tab checks its central session immediately when it opens, when it regains focus/visibility, then every 30 s (visible) or 2 min (hidden). An ERP's own 401 also signs the person out, so this is not the only safety net. |
| Logging out one login in a browser that holds another login | Only the cookie that belongs to the signed-out `sid` is removed; the logout marker is keyed by that `sid`; a cross-tab LOGOUT message without a matching `sid` is ignored. |

### 1.5 Corrections to earlier versions of this document
These paths were documented but **do not exist** in the code; the real ones are listed in the table above: `POST /api/v1/auth/sign-out-everywhere`, `POST /api/v1/auth/internal/sync-password`, `POST /api/v1/auth/internal/revoke-user-tokens`, and the column name `admin_tokens_revoked_before` (the real column is `platform_admins.tokens_revoked_before`).

### Ecosystem Session Verification Contract (`GET /api/v1/global/ecosystem-session/{session_id}`)

To avoid spurious "false logout" loops during inter-ERP switching or control-plane server restarts, this endpoint enforces a 3-way disambiguated status contract:

1. **Active & Valid Session (`HTTP 200`):**
   ```json
   {
     "success": true,
     "data": {
       "valid": true,
       "session": {
         "session_id": "c138f...-...",
         "user_id": "00000000-0000-0000-0000-000000000001",
         "email": "admin@inhyma.com",
         "role": "super_admin",
         "accessible_erps": ["erp-01", "erp-02", "inhyma", "yinglima"],
         "primary_erp": "erp-01",
         "expires_at": "2026-10-17T10:00:00Z"
       },
       "revoked": false,
       "notFound": false
     }
   }
   ```

2. **Session Not Found / Expired (`HTTP 200`):**
   - Returned when the session ID does not match any active in-memory or persisted DB record (e.g. wiped after backend restart or invalid cookie).
   - **Crucial Invariant:** Returns `revoked: false` and `notFound: true`.
   - Spoke frontends and background watchers treat `notFound` as an ignorable state, retaining the local authenticated session rather than triggering an aggressive `FORCE_LOGOUT` purge.
   ```json
   {
     "success": true,
     "data": {
       "valid": false,
       "session": null,
       "revoked": false,
       "notFound": true,
       "reason": "Session not found"
     }
   }
   ```

3. **Explicitly Revoked Session (`HTTP 200`):**
   - Returned ONLY when a user actively clicks "Logout" or an administrator revokes the session.
   - Sets `revoked: true` and `notFound: false`.
   - All spoke ERP instances immediately invalidate local JWTs, clear storage, and redirect the user to `/login`.
   ```json
   {
     "success": true,
     "data": {
       "valid": false,
       "session": null,
       "revoked": true,
       "notFound": false,
       "reason": "Session explicitly revoked by user logout"
     }
   }
   ```

---

## 2. Global Identity & Access Governance (`/global/users`)

| Method | Endpoint URI | Description | Permission Gate |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/global/users` | List paginated global identities with ERP access badges | `users.read` |
| `POST` | `/api/v1/global/users` | Create global user and provision initial spoke access | `users.create` |
| `GET` | `/api/v1/global/users/{id}` | Inspect detailed global user profile & linked memberships | `users.read` |
| `PATCH` | `/api/v1/global/users/{id}` | Update user attributes, roles, and ERP access grants | `users.update` |
| `DELETE`| `/api/v1/global/users/{id}` | Soft-delete global user and trigger spoke deprovisioning | `users.delete` |
| `POST` | `/api/v1/global/users/{id}/reset-password` | Issue administrative password reset | `users.manage` |

---

## 3. Platform Roles & Scoped Authorization (`/global/roles`)

| Method | Endpoint URI | Description | Permission Gate |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/global/roles` | List system platform roles | `roles.read` |
| `POST` | `/api/v1/global/roles` | Create custom platform role | `roles.create` |
| `GET` | `/api/v1/global/roles/{id}` | Inspect role details and permission matrix | `roles.read` |
| `PATCH` | `/api/v1/global/roles/{id}` | Update role permissions and description | `roles.update` |
| `DELETE`| `/api/v1/global/roles/{id}` | Delete unassigned custom role | `roles.delete` |
| `GET` | `/api/v1/global/permissions` | Catalog of all system platform permissions | `roles.read` |

---

## 4. ERP Registry & Spoke Discovery (`/global/registry`)

| Method | Endpoint URI | Description | Permission Gate |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/global/registry` | List registered spoke ERP nodes (URL, key, status) | `registry.read` |
| `POST` | `/api/v1/global/registry` | Register new spoke ERP instance | `registry.manage` |
| `GET` | `/api/v1/global/registry/{id}` | Inspect spoke ERP health, metrics, and configuration | `registry.read` |
| `PATCH` | `/api/v1/global/registry/{id}` | Update spoke endpoints or public certificates | `registry.manage` |
| `DELETE`| `/api/v1/global/registry/{id}` | De-register spoke node | `registry.manage` |

---

## 5. OIDC Federation Authority & Single Sign-On

| Method | Endpoint URI | Description | Auth Required |
| :--- | :--- | :--- | :--- |
| `GET` | `/.well-known/openid-configuration` | OpenID Connect discovery metadata document | Public |
| `GET` | `/.well-known/jwks.json` | JSON Web Key Set containing active RS256 public keys | Public |
| `GET` | `/api/v1/oidc/authorize` | OIDC authorization endpoint for relying-party login | Authenticated |
| `POST` | `/api/v1/oidc/token` | Exchange authorization code for signed identity tokens | Client Credentials |
| `GET` | `/api/v1/oidc/userinfo` | Return claims for the authenticated subject | OIDC Bearer Token |
| `POST` | `/api/v1/global/sso/handover` | Generate one-time short-lived SSO switching token | Authenticated |

---

## 6. Projections, Global Search & Export Engine

| Method | Endpoint URI | Description | Permission Gate |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/v1/projections/ingest` | Ingest transactional outbox event payload from spoke | Internal Service Key |
| `GET` | `/api/v1/projections/search` | Federated full-text search across all ERP projections | `search.read` |
| `POST` | `/api/v1/exports/create` | Queue background asynchronous CSV/XLSX export job | `exports.create` |
| `GET` | `/api/v1/exports/status/{id}` | Inspect status and download signed artifact URL | `exports.read` |

---

## 7. Internal Spoke Federation & Password Synchronization (`/internal`)

| Method | Endpoint URI | Description | Auth Required |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/v1/internal/users/password` | Ingest password changed on a spoke ERP, update central credentials, and fan out to active spoke memberships | Internal Service Bearer + `X-ERP-Key` |
| `GET` | `/api/v1/internal/memberships/by-local-user/{local_user_id}` | Query central membership metadata linked to a local spoke user record | Internal Service Bearer + `X-ERP-Key` |

