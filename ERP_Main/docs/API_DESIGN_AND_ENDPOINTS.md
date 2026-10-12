# ERP_Main — API Design & Endpoints Specification

**Service Base URL:** `http://localhost:8000/api/v1`  
**Authentication Scheme:** Bearer JWT (RS256 / HS256) & HTTP-Only Session Cookies  
**Standard Response Envelope:** `{ "success": true, "data": ..., "meta": ..., "error": null }`

---

## 1. Authentication & Session Authority

| Method | Endpoint URI | Description | Auth Required |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/v1/auth/login` | Authenticate credentials and issue central JWT token pair | Public |
| `POST` | `/api/v1/auth/refresh` | Rotate single-use refresh token | Refresh Token |
| `POST` | `/api/v1/auth/logout` | Revoke local session and blacklist tokens | Authenticated |
| `POST` | `/api/v1/auth/sign-out-everywhere` | Global session invalidation: revokes tokens centrally & fans out token revocation across all spokes | Authenticated |
| `POST` | `/api/v1/auth/internal/sync-password` | Inbound service endpoint for spoke ERPs to synchronize password changes centrally into `global_users` and fan out to other spokes | Service Key (`X-Service-Key`) |
| `GET` | `/api/v1/auth/me` | Fetch active user profile and effective platform roles | Authenticated |
| `POST` | `/api/v1/global/ecosystem-session/establish` | Establishes cross-subdomain ecosystem session cookie (`ihm_ecosystem_session`) | Authenticated |
| `GET` | `/api/v1/global/ecosystem-session/{session_id}` | Live DB verification of central ecosystem session & allowed ERPs | Public / Spoke |
| `POST` | `/api/v1/global/ecosystem-session/exchange` | Exchange verified central session for authenticated user token | Session ID + Email |
| `POST` | `/api/v1/global/ecosystem-session/{session_id}/revoke` | Revoke central ecosystem session across all ERPs | Authenticated |

### 1.1 Global Sign-Out Everywhere Specification (`POST /api/v1/auth/sign-out-everywhere`)
- **Trigger:** Initiated by user clicking "Sign out everywhere" or by administrator from `/access/users`.
- **Central Action:**
  - Deletes all database records matching the user's ID in `global_sessions`.
  - Clears `ihm_ecosystem_session` cookie; sets `ihm_ecosystem_logged_out=<session_id>`.
  - If user is a `PlatformAdmin`, advances `platform_admins.admin_tokens_revoked_before = datetime.now(timezone.utc)`.
- **Spoke Fanout (`fanout_signout_to_spokes`):**
  - Issues concurrent HTTP requests to all registered spoke nodes:
    `POST {spoke_url}/api/v1/auth/internal/revoke-user-tokens`
  - Payload: `{ "user_id": "<uuid>", "email": "user@example.com", "username": "username" }`
  - Header: `X-Service-Key: <internal_service_key>`
- **Response (`HTTP 200`):**
  ```json
  {
    "success": true,
    "message": "Signed out from all devices and spoke ERP instances.",
    "revoked_spokes": ["inhyma", "yinglima"]
  }
  ```

### 1.2 Inbound Spoke Password Sync Specification (`POST /api/v1/auth/internal/sync-password`)
- **Trigger:** Dispatched by a spoke ERP backend whenever a user updates or resets their password locally.
- **Payload:**
  ```json
  {
    "origin_erp": "inhyma",
    "email": "user@example.com",
    "username": "user123",
    "new_password_hash": "$argon2id$v=19$m=65536,t=3,p=4$..."
  }
  ```
- **Central Processing:**
  - Authenticates caller using `X-Service-Key` or spoke bearer credential.
  - Updates `global_users.password_hash` where `lower(primary_email) = lower(:email)` or `username = :username`.
  - Identifies all active `erp_memberships` for this user excluding `origin_erp`.
  - Asynchronously fans out the updated password to each other active spoke node via `push_password_to_spoke`.
- **Response (`HTTP 200`):**
  ```json
  {
    "success": true,
    "message": "Password synchronized centrally and propagated to peer spokes.",
    "fanned_out_to": ["yinglima"]
  }
  ```

### 1.3 Spoke Token Revocation Contract (`POST /api/v1/auth/internal/revoke-user-tokens`)
- **Endpoint Location:** Hosted by spoke backends (`Inhyma_ERP`, `Yinglima_ERP`).
- **Authentication:** `X-Service-Key` (internal microservice secret).
- **Multi-Identifier Matching:**
  - Resolves target user by matching any provided identifier: `id`, `user_id`, `email`, or `username`.
- **Action:**
  - Revokes all active refresh tokens in spoke `refresh_tokens` table.
  - Sets user-level token invalidation timestamp (`tokens_revoked_before = now()`).
  - Broadcasts WebSocket event `FORCE_LOGOUT` (`code: 4001`) to connected user browser sessions.

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

