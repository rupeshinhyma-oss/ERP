# Yinglima_ERP — API Design & Endpoints Specification

**Service Base URL:** `http://localhost:8001/api/v1`  
**Authentication Scheme:** Bearer JWT (HS256) & Tokenized Portal URLs  
**Standard Response Envelope:** `{ "success": true, "data": ..., "meta": ..., "error": null }`

---

## 1. Suppliers & Vendor Management (`/suppliers`)

| Method | Endpoint URI | Description | Permission Gate |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/suppliers` | List paginated Chinese suppliers with ratings and search | `supplier.view` |
| `POST` | `/api/v1/suppliers` | Create supplier profile with WeChat, tax, and bank accounts | `supplier.create` |
| `GET` | `/api/v1/suppliers/{id}` | Inspect detailed supplier record and media attachments | `supplier.view` |
| `PATCH` | `/api/v1/suppliers/{id}` | Update supplier profile, factory location, or credit terms | `supplier.update` |
| `DELETE`| `/api/v1/suppliers/{id}` | Soft-delete supplier profile | `supplier.delete` |
| `POST` | `/api/v1/suppliers/{id}/media` | Upload factory visit photo/video to Supabase Storage | `supplier.update` |

---

## 2. Inquiries, RFQs & Quotations (`/inquiries`)

| Method | Endpoint URI | Description | Permission Gate |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/inquiries` | List RFQ inquiries with stage status and consignments | `inquiry.view` |
| `POST` | `/api/v1/inquiries` | Create new RFQ inquiry for multi-vendor sourcing | `inquiry.create` |
| `GET` | `/api/v1/inquiries/{id}` | Inspect inquiry items, quotes matrix, and email thread | `inquiry.view` |
| `POST` | `/api/v1/inquiries/{id}/quotations` | Manually enter supplier quote | `inquiry.update` |
| `GET` | `/api/v1/inquiries/{id}/matrix` | Quotation comparison matrix comparing MOQ, price, lead time | `inquiry.view` |
| `POST` | `/api/v1/inquiries/{id}/send-rfq` | Dispatch automated RFQ emails to selected vendors | `inquiry.update` |

---

## 3. Public Vendor Quotation Portal (`/portal`)

| Method | Endpoint URI | Description | Auth Required |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/portal/quote/{token}` | Load RFQ specifications for external supplier | Tokenized URL |
| `POST` | `/api/v1/portal/quote/{token}` | Submit vendor pricing, lead time, and PDF attachment | Tokenized URL |

---

## 4. Master Shipment Planning Sheets (`/planning`)

| Method | Endpoint URI | Description | Permission Gate |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/planning/sheets` | List container planning workbooks | `planning.view` |
| `POST` | `/api/v1/planning/sheets` | Create new container shipment planning workbook | `planning.create` |
| `GET` | `/api/v1/planning/sheets/{id}` | Retrieve dynamic sheet rows, columns, and CBM sums | `planning.view` |
| `PATCH` | `/api/v1/planning/cells` | Batch cell update with optimistic concurrency | `planning.update` |

---

## 5. Spoke Governance & Internal Identity Provisioning (`/internal/users`)

Machine-to-machine internal service endpoints invoked by `ERP_Main` over authenticated HTTP channels (Bearer Token with `X-ERP-Key` / HMAC token validation).

| Method | Endpoint URI | Description | Auth Required |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/v1/internal/users/check` | Inspect whether a user already exists locally by email or username | Internal Service Bearer |
| `POST` | `/api/v1/internal/users/provision` | Provision minimal local account or reactivate previously deactivated account | Internal Service Bearer |
| `POST` | `/api/v1/internal/users/{id}/access` | Block (`allow_login: false`) or restore (`allow_login: true`) local authentication | Internal Service Bearer |
| `POST` | `/api/v1/internal/users/{id}/deprovision` | Soft-delete user and revoke all active sessions upon ERP_Main deprovisioning | Internal Service Bearer |
| `DELETE`| `/api/v1/internal/users/{id}` | Idempotent alias for user deprovisioning | Internal Service Bearer |
| `POST` | `/api/v1/internal/users/{id}/logout` | Force logout local user and broadcast WebSocket `FORCE_LOGOUT` upon ecosystem logout | Internal Service Bearer |

---

## 6. Authentication, SSO Handover & Identity Federation (`/auth`, `/users`, `/organizations`)

| Method | Endpoint URI | Description | Auth Required |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/v1/auth/login` | Local credential authentication returning token pair & profile | Public |
| `POST` | `/api/v1/auth/sso-handover` | Authenticate incoming SSO handover token with mandatory live central session verification against ERP_Main | Public / Handover Token |
| `POST` | `/api/v1/auth/change-password` | Update current user's password and asynchronously push to ERP_Main | Authenticated |
| `POST` | `/api/v1/users/{id}/reset-password` | Administrative password reset and automatic fanout push to ERP_Main | `user.manage` |
| `PATCH` | `/api/v1/users/{id}` | Update user attributes; email is locked to central control plane | `user.update` |
| `GET` | `/api/v1/organizations/public` | Unauthenticated public branding endpoint returning company name, legal name, and logo | Public |
| `GET` | `/api/v1/organizations/logo` | Stream high-resolution database-persisted logo image with version hashing (`?v={sha1}`) | Public |
| `GET` | `/api/v1/health/federation` | Run live diagnostics & latency ping against ERP_Main central registry | Super Admin / Authenticated |

---

## 7. Session-Scoped Tokens and Per-Session Revocation

- Login (`POST /api/v1/auth/login`), refresh and SSO handover replies include `session_id` and `session_mode` (`"central"`: ERP_Main knows the session, switching ERPs works; `"local"`: this ERP only, used when ERP_Main was unreachable at login).
- Every access and refresh token carries `sid`. `POST /api/v1/auth/logout` revokes the token's session here and reports it to ERP_Main, which ends it everywhere that login was used. Other logins of the same person keep working.
- `POST /api/v1/internal/sessions/{session_id}/revoke` (service credential: `Authorization: Bearer <credential>`): called by ERP_Main to end one session. Idempotent. All tokens of that session stop working and its live WebSockets are closed.
- A token without `sid` (issued before this release) keeps working and can only be ended with the per-user force logout (`POST /api/v1/internal/users/{id-or-email}/logout`).
- Safety net: the ERP asks ERP_Main about central sessions at most every 45 seconds and ends a revoked one itself; if ERP_Main is unreachable the session is kept (fail-open).
- `POST /api/v1/auth/sso-handover` Status Contracts:
  - **401 Unauthorized**: Handover ticket signature invalid, expired, central session revoked, or the local user account is deactivated/deleted (`is_active=False` or `deleted_at IS NOT NULL`). Rejection message: `"Account is inactive or disabled on this ERP instance"`.
  - **403 Forbidden**: User lacks authorization for this ERP or `SSO_HANDOVER_AUTO_PROVISION=false` blocks unauthorized creation.
  - **503 Service Unavailable** (`EcosystemSessionUnavailable`): ERP_Main central control plane cannot be reached, and no cached session exists. The client should retry with exponential backoff (0.7s, 2.5s, 6.0s).
  - **900s Stale Session Cache Fallback**: If ERP_Main is temporarily unreachable but the session was verified within the last 900 seconds (15 minutes), the spoke accepts the session with `session["_from_cache"] = True`.

---

## 8. Federation Diagnostics & Branding Endpoints

### 8.1. Central Federation Diagnostics (`GET /api/v1/health/federation`)
- Diagnostic probe executing real-time round-trip latency and connectivity checks against candidate central control plane URLs (`erp_main_api_base_urls()`).
- Returns:
  ```json
  {
    "status": "healthy",
    "reachable_url": "https://erp-main-backend.onrender.com",
    "latency_ms": 142.5,
    "candidates_tested": [
      "https://erp-main-backend.onrender.com",
      "https://central.inhyma.com"
    ],
    "dns_resilience_mode": "windows_gated",
    "timestamp": "2026-10-14T17:40:00Z"
  }
  ```

### 8.2. Versioned Organization Logo (`GET /api/v1/organizations/logo?v={sha1}`)
- Streams high-resolution organization logo binary data directly from PostgreSQL (`organizations.logo_data`).
- HTTP Response Headers:
  - `Content-Type: image/png` (or image/jpeg)
  - `Cache-Control: public, max-age=86400, immutable`
  - `ETag: "{sha1}"`
- Guaranteed immediate cache invalidation via unique `?v={sha1}` query parameters upon organization settings updates.

