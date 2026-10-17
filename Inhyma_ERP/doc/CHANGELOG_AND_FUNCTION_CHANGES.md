# Inhyma_ERP — Changelog & Function Changes History

**System:** Inhyma_ERP (India Distribution)  
**Scope:** Functional updates, schema migrations, UI hardening, and bug fixes.

## [Release 2026-10-16] — Product Master Multi-View Navigation, Inventory DB Integrity, Server-Authoritative Stock Adjustments & E2E Testing Protocol

### 1. Product Master Multi-View Navigation & Warning Elimination
- **Navigation Tabs Restored in [`frontend/src/pages/masters/Products.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/pages/masters/Products.tsx):**
  - Restored the `.master-view-nav` tab strip directly below the breadcrumb bar, enabling seamless switching between:
    1. **`📦 Product Master` (`catalog`):** Main product catalog grid with filters, column pinning, inline stock info, and bulk actions.
    2. **`⚙️ Machine-Spares Universal View` (`universal-view`):** Machine-wise spare parts breakdown showing linked parts, compatibility notes, and dedicated link modal (`/masters/products/machine-spares/universal-view`).
    3. **`📐 Dimensions & Weights Report` (`dimensions-report`):** Package-level breakdown for multi-box products, displaying Length, Width, Height, CBM, Net Weight, Gross Weight, with CSV and XLSX export triggers.
  - Eliminated the TypeScript/IDE warning: `'setActiveMasterView' is declared but its value is never read`.
- **Real-Time Duplicate Prevention Guard (`ProductNameSuggestions`):**
  - Integrated real-time query searching active product catalog names as the operator types, displaying an instant suggestion dropdown to prevent duplicate SKU entries.
- **Dimensional CBM Auto-Calculation:**
  - Enforced read-only packaging unit CBM calculated dynamically from millimeter inputs:
    $$\text{CBM} = \frac{L \times W \times H}{1,000,000}$$

### 2. Inventory Core Engine, Database Integrity & Concurrency Hardening
- **Schema Migration (`m9c0d1e2f3a4_inventory_integrity_and_indexes.py`):**
  - Created unique constraint index `uq_product_stocks_product_id` on `product_stocks(product_id)` to prevent duplicate inventory records per product.
  - Added performance index on `product_stocks(brand)`.
  - Added `adjustment_dt` (`Date` column) on `stock_adjustments` for indexed date range filtering.
- **Concurrency & Advisory Locks in [`stock_service.py`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/backend/app/inventory/stock_service.py):**
  - Added PostgreSQL session transaction advisory lock (`pg_advisory_xact_lock`) around stock row initialization.
  - Implemented nested transaction rollback (`begin_nested()`) to recover gracefully from concurrent insert collisions.
  - Defined `NON_WAREHOUSE_COLUMNS = {"reorder_level", "moq"}` to ensure reorder metadata fields are never erroneously summed into physical stock totals.
- **Server-Authoritative Stock Adjustments in [`routes.py`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/backend/app/inventory/routes.py):**
  - Completely excised legacy in-memory mock fallbacks; all stock adjustment listings and creations execute against real database transactions.
  - Added atomic stock reversal when a stock adjustment is deleted (soft-deleted), ensuring quantities are refunded back to the warehouse immediately.
- **Stock Adjustment Pages Hardening ([`StockAdjustmentPage.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/pages/StockAdjustmentPage.tsx), [`AddAdjustmentOrderPage.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/pages/AddAdjustmentOrderPage.tsx)):**
  - Removed local-storage offline bypassing; forms enforce server-side validation and optimistic feedback.
  - Auto-complete company extraction for client names in stock adjustments.

### 3. Universal Column Ascending & Descending Sorting
- **Inhyma Standard Header Sorting ([`SortHeader.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/components/SortHeader.tsx)):**
  - Implemented universal ascending (`▲`) and descending (`▼`) sorting component across Inhyma module tables.
  - Applied across Product Master, Product Stock, Stock Adjustment, Stock Transfer, Companies, and Sales Process list views.
- **TypeScript Type Safety & Sorting Accessor Harmonization:**
  - Standardized model-field accessors in table sorting pipelines to achieve strict 0-error TypeScript compilation (`tsc --noEmit`):
    - **Industrial Zones ([`IndustrialZonesPage.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/pages/IndustrialZonesPage.tsx)):** Aligned sort key to `potential_machine_categories` on `IndustrialZoneItem`.
    - **Proforma Invoices ([`ProformaInvoicesPage.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/pages/ProformaInvoicesPage.tsx)):** Corrected numeric sorting accessors to canonical model fields `amount_inc_gst` and `discount`.
    - **Discount Payments ([`DiscountPaymentsPage.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/pages/sales/DiscountPaymentsPage.tsx)):** Standardized contact person fallback using `a.contact_person_name || a.contact_name || ""`.
    - **Sales Process List ([`SaleProcessList.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/pages/sales/SaleProcessList.tsx)):** Updated PO column sort to `a.po ? String(a.po) : ""` and Amount sort to `includingGst ? (a.amount_inc_gst ?? a.total_amount) : (a.amount_exc_gst ?? a.total_basic ?? a.total_amount)`.

### 4. Technical Tasks & Company Geography Integration
- **Migrations `k7a8b9c0d1e2` & `l8b9c0d1e2f3`:**
  - Added scale, payment tracking, and technician call log infrastructure in `backend/app/technical_tasks`.
  - Linked companies to District master records (`district_id`) with 4-tier cascading address selector: Country ➔ State ➔ District ➔ City.
  - Created standalone pages [`TechnicalCallLogsPage.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/pages/technicalTasks/TechnicalCallLogsPage.tsx) and [`TechnicalTaskMonthlySummary.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/pages/technicalTasks/TechnicalTaskMonthlySummary.tsx).

### 5. Unified System Testing Specification & Dependency Roadmap
- Documented the strict 6-stage operational test sequence:
  1. **Master Foundation:** Billing Company ➔ Warehouses ➔ Taxes ➔ Product Master (CBM/MOQ) ➔ Suppliers ➔ Buyers.
  2. **Inward Purchase:** Local Purchase (Confirm triggers physical stock) & Import Purchase (Transit stock allocation & dual landing cost).
  3. **Inventory Management:** 15-column stock table, `(i)` reservation / PO popup, container inwarding via Stock Transfer (`Receive to Main WH`), and Stock Adjustment (+IN / -OUT).
  4. **Sales Cycle:** Proforma Invoice (Min Price alert, negative stock check) ➔ Confirmed SO (physical stock deduction) ➔ Accounts Confirmation (Tally Invoice, E-Way Bill).
  5. **Logistics & Gate Pass:** Transport configuration (Godown/Door, To Pay/Paid) ➔ Gate Pass generation ➔ LR upload with photo attachments.
  6. **Reorder & Settlement:** Tally Re-order Level calculations & Discount Payment under-invoicing settlement.

---

## [Release 2026-10-14] — Seed First-Install Guards, Inbound Email DB Deduplication & Handover Account Protection

### 1. Database-Backed Bootstrap Seed Guards (`BOOTSTRAP_FORCE_RESET`)
- **First-Install Protection in [`scripts/seed.py`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/backend/scripts/seed.py):**
  - Added guard counting existing users (`select(func.count()).select_from(User)`); if users exist and `BOOTSTRAP_FORCE_RESET` is not set, seeding leaves existing admin passwords, status, memberships, and role assignments completely untouched.
  - Prevents automated container restarts or CI/CD redeployments from overwriting operator password changes or re-activating suspended/soft-deleted users.
  - Emergency one-off reset enabled strictly when `BOOTSTRAP_FORCE_RESET=true` (or `1`, `yes`) is explicitly provided in the environment.
  - Country and geography seeding in [`seed_china_geo.py`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/backend/scripts/seed_china_geo.py) skips redundant insertion if master records already exist.

### 2. Persistent Inbound Email Deduplication
- **Atomic Database Claim in [`email_inbound_worker.py`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/backend/app/inquiries/email_inbound_worker.py):**
  - Replaced volatile local JSON file tracking with dedicated database table `email_inbound_processed (message_id TEXT PRIMARY KEY, processed_at TIMESTAMP)`.
  - Atomically claims incoming message IDs via `INSERT INTO email_inbound_processed ... ON CONFLICT (message_id) DO NOTHING`.
  - Prevents duplicate quotation creation, repeat AI token consumption, and ghost quotations when containers restart or when multiple workers poll the mailbox.
  - Includes baseline initialisation routine marking pre-existing mail (>30 minutes old) as processed on first deployment.

### 3. SSO Handover Local Account Status Enforcement
- **Account State Validation in [`auth/routes.py`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/backend/app/auth/routes.py):**
  - If a user is deleted (`deleted_at IS NOT NULL`), inactive (`is_active=False`), or login-prohibited (`can_login=False`) in Inhyma's local database, incoming SSO handover now raises `401 Unauthorized` ("This account was deleted or disabled in this ERP. Ask an administrator to restore it.") rather than silently re-activating the account.
  - Added environment switch `SSO_HANDOVER_AUTO_PROVISION=false` to reject provisioning when an account does not already exist locally.

---

## [Release 2026-10-14] — Resilient Central Federation, DNS Winsock Isolation & Live Diagnostics

### 1. Multi-URL Discovery & IPv4 Outbound Enforcement
- **Dynamic Candidate Resolution in [`federation/erp_main_client.py`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/backend/app/federation/erp_main_client.py):**
  - Implemented `erp_main_api_base_urls()` combining `ERP_MAIN_URL`, `ERP_MAIN_API_BASE_URL`, `ERP_MAIN_ISSUER`, and `ERP_MAIN_JWKS_URL`.
  - In production, skips localhost defaults if remote candidates exist.
  - Outbound HTTP client enforces IPv4 transport (`local_address="0.0.0.0"`) via `_client_for_erp_main()`, preventing broken AAAA IPv6 resolution attempts on cloud environments (Render) that lack outbound IPv6 routing.

### 2. Sleeping Instance Wake-Up Budget & Stale Session Resilience
- **Exponential Retry Backoff:**
  - Extended handover verification timeout to **40 seconds** (`SSO_HANDOVER_VERIFY_TIMEOUT_SECONDS = 40.0`), allowing sleeping free-tier control plane instances to boot.
  - Implemented retry loop with progressive backoff (0.6s to 5.0s) for retryable HTTP errors (429, 500, 502, 503, 504) and network timeouts. Definite codes (200, 404) terminate immediately.
- **Stale Session Tolerance (`SSO_HANDOVER_STALE_OK_SECONDS`):**
  - In the event of temporary ERP_Main downtime, sessions previously verified as active within the last 900 seconds (15 minutes) are accepted from local memory cache and flagged `_from_cache: True`.

### 3. Live Federation Health Probing Endpoint
- **Inspection Route in [`api/v1/health.py`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/backend/app/api/v1/health.py):**
  - Added `GET /api/v1/health/federation` endpoint reporting live reachability, latency in milliseconds, environment key, configuration validation problems, and last session verification diagnostics without exposing service credentials.
  - Added startup configuration check in [`core/config.py`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/backend/app/core/config.py) logging explicit errors if production endpoints point to localhost or missing credentials.

### 4. Winsock DNS Resilience Scoping
- **Platform-Gated Socket Interception in [`core/dns_resilience.py`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/backend/app/core/dns_resilience.py):**
  - Restricted socket resolution monkeypatching strictly to Windows systems (`sys.platform.startswith("win")`), preventing harmful side-effects on Linux/Docker production hosts.
  - Keyed internal resolution cache by complete socket tuple `(host, family, type, proto, flags)` with port adaptation helper `_with_port()`.

---

## [Release 2026-10-14] — Database-Backed Organization Branding & Storage Quota Protection

### 1. Database-Backed Logo Source of Truth
- **Versioned Public Endpoint in [`organizations/routes.py`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/backend/app/organizations/routes.py):**
  - When `logo_data` exists in the database, `/organizations/public` now serves a versioned, immutable URL `/api/v1/organizations/logo?v={sha1}`.
  - Solves the problem where transient server file paths stored in `logo_url` were lost upon container restart or deployment on ephemeral filesystems.
  - Implemented loop-prevention check on `/api/v1/organizations/logo` to avoid redirecting back to itself.

### 2. Frontend LocalStorage Quota Safeguard
- **Exception Protection in [`brand.ts`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/lib/brand.ts) & [`Organization.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/pages/Organization.tsx):**
  - Wrapped `localStorage` and `sessionStorage` caching in `try/catch` handlers. High-resolution base64 logo data exceeding browser storage quotas no longer crashes the application shell.
  - Standardized resolution priority to prefer database `logo_data` over `logo_url`.

---

## [Release 2026-10-14] — Universal Filter Button UI Standardization Across All Modules

### 1. Unified Visual & Behavioral Filter Standard (Companies Benchmark)
- **Reference Benchmark:** Standardized all module filter toggle buttons across Inhyma to strictly match the styling, dimensions, and interaction pattern of the [Companies](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/pages/Companies.tsx#L5628) filter toggle button.
- **Color Palette & State Invariance:**
  - Standard background: `#556987` (solid slate/navy).
  - Hover background: `#475569`.
  - Active/Open state: `#556987` (retains the exact base color when active or panel is expanded, preventing unintended bright-blue or accent state switches).
  - Text & Icon color: `#ffffff`.
- **Dimensions & Box Model:**
  - Padding: `8px 14px`.
  - Border radius: `6px`.
  - Border: `none`.
  - Box Shadow: `0 2px 4px rgba(0, 0, 0, 0.1)`.
  - Display: `inline-flex; align-items: center; justify-content: center; cursor: pointer`.
  - Auto-sizing: Removed all hardcoded `width`, `height`, `min-width`, and `min-height` constraints (such as `38px x 38px`, `38px x 35px`, or `min-width: 36px`) across all module stylesheets, preventing awkward squarish distortion.
- **Icon Standard:**
  - Embedded 16×16px SVG funnel icon (`viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"` with `<polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />`).
- **Clean Badge-Less Surface:**
  - Removed internal counter badges (`activeFilterCount`, `reorder-filter-badge`, `stock-filter-badge`, etc.) and indicator dots from the filter toggle buttons, maintaining an identical, clean rectangular footprint matching Companies.
- **Default State Invariant:**
  - All filter drawers and collapsible panels remain strictly **off by default** (`useState(false)`) across all pages, ensuring clean initial view loads.

### 2. Stylesheets & Module Scope
- **Global & Module Stylesheets Updated:**
  - `style.css`: Enforced universal `.btn-filter-toggle`, `.btn-filter`, `.tech-btn-filter`, `.reorder-btn-filter`, `.stock-btn-filter`, `.transfer-btn-filter`, `.adjustment-btn-filter`, `.deleted-orders-btn-filter` with `!important` color, auto dimensions, and `.active` state locks.
  - `deletedOrders.css`: Standardized `.deleted-orders-btn-filter` (`#556987`, padding `8px 14px`, removed `36px` dimensions).
  - `productReorder.css`: Standardized `.reorder-btn-filter` (`#556987`, padding `8px 14px`, removed `38px` dimensions).
  - `productStock.css`: Standardized `.stock-btn-filter` (`#556987`, padding `8px 14px`, removed `38px` dimensions).
  - `stockAdjustment.css`: Standardized `.adjustment-btn-filter` (`#556987`, padding `8px 14px`, removed `38px` dimensions).
  - `stockTransfer.css`: Standardized `.transfer-btn-filter` (`#556987`, padding `8px 14px`, removed `38px` dimensions).
  - `technicalTasks.css`: Standardized `.page-technical-tasks .tech-btn-filter` (`#556987`, padding `8px 14px`, removed `38px x 35px` dimensions).
- **Modules Verified & Harmonized:**
  - Contact: `Companies.tsx`, `Suppliers.tsx`, `AgentsPage.tsx`, `FollowUpsPage.tsx`, `IndustrialZonesPage.tsx`, `LeadsPage.tsx`.
  - Inventory: `ProductStockPage.tsx`, `StockAdjustmentPage.tsx`, `StockTransferPage.tsx`, `ProductReorderPage.tsx`, `PriceListPage.tsx`, `masters/Products.tsx`.
  - Sales & Orders: `sales/SaleProcessList.tsx`, `sales/DiscountPaymentsPage.tsx`, `ProformaInvoicesPage.tsx`, `DeletedOrdersPage.tsx`.
  - Tasks & Engineering: `technicalTasks/TechnicalTasksPage.tsx`.
  - Core Masters: `components/MasterPage.tsx` (all generic master catalogs).
- **TypeScript & Build Integrity:**
  - Removed unused filter counter declarations (`activeFilterCount` / `activeFiltersCount`) across 7 files to adhere strictly to `noUnusedLocals` in `tsconfig.json`.
  - Wired in-memory date range filtering (`appliedOrderDateRange`, `appliedExpDeliveryDateRange`) into `DeletedOrdersPage.tsx`.
  - Full Vite build verification passed with 0 errors; 25/25 unit & integration tests passing.

---

## [Release 2026-10-14] — Session-Scoped Tokens (one login = one session id)

- Access and refresh tokens carry a `sid` claim (`auth/security.py`). `AuthService._issue_token_pair` binds both tokens to one session id; refresh keeps it. `TokenResponse` gains `session_id` and `session_mode` (`"central"` or `"local"`).
- **Login** opens the login's central session via ERP_Main (`federation/erp_main_client.open_central_session`) only *after* the password is verified. If ERP_Main cannot be reached or refuses, the login still succeeds with a local session id `loc-<uuid>`.
- **SSO handover** issues tokens carrying the verified central `sid`.
- **Per-session revocation:** `AuthService.revoke_session` stores `sid:<sid>` in `token_blacklist` (cached), closes that session's WebSockets (`ConnectionManager.disconnect_session`). `verify_access_token` and `refresh` reject a revoked `sid` and, for central sessions, ask ERP_Main at most every 45 s (`central_session_state`, fail-open) so a lost message cannot leave a session alive.
- **New endpoint:** `POST /api/v1/internal/sessions/{sid}/revoke` (service credential). `POST /auth/logout` now revokes the token's session and reports it to ERP_Main (`push_session_signout_to_erp_main`); it no longer signs the person out of their other logins.
- **Frontend:** the login page uses the session id from the login reply; a fresh handover always replaces a saved session; no stored default-admin login; scoped cookie clearing; visible reason when an automatic sign-in fails.
- **Reliability hardening:** when ERP_Main cannot be reached during a handover the ERP now answers **503** (`EcosystemSessionUnavailable`) instead of 401, so the browser retries instead of treating it as "session ended"; the login's central call uses short timeouts (connect 1.5 s, read 3 s) so a login never hangs. Browser: one shared handover exchange per arrival, retries 0.7/2.5/6 s, per-status messages, "Signing you in..." state, a switcher that validates before navigating (and no longer declares hooks after an early return), and a watcher that checks immediately then every 30 s / 2 min (was 2.5 s).
- **Tests:** `test_session_scoped_tokens.py`; frontend `ssoHandoverSession.test.ts`.

## [Release 2026-10-10] — Cross-Ecosystem Single Sign-Out (SLO), M2M Force Logout API & WebSocket Disconnect

### 1. Internal Machine-to-Machine Force-Logout API
- **Endpoint Implementation in [`internal_users.py`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/backend/app/api/v1/internal_users.py):**
  - Added `POST /api/v1/internal/users/{identifier}/logout` guarded by `internal_service_dep` HMAC authentication.
  - Accepts local UUID or email/username prefix to resolve the user record.
  - Invokes `auth_service.force_logout_user(user.id)`, invalidating active sessions and recording a revocation timestamp to blacklist bearer tokens.
  - Emits real-time `FORCE_LOGOUT` frame across live WebSocket channels (`ws_manager.disconnect_user(str(user.id))`) to instantly disconnect open browser sessions.
- **Unit Test Coverage:**
  - Added `test_internal_logout_endpoint_works` in [`test_internal_users_foreign_keys.py`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/backend/tests/test_internal_users_foreign_keys.py).

### 2. Multi-Origin Browser Session Invalidation & Shared Cookie Logout
- **Cross-Port Cookie Synchronization in [`ecosystemSession.ts`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/lib/ecosystemSession.ts):**
  - Sets `ihm_ecosystem_logged_out=1` cookie on logout across domain `localhost` and configured subdomains with root path `/`.
  - Added `isExplicitlyLoggedOut()` helper checking both `sessionStorage` and the shared cookie marker.
  - Clears `ihm_ecosystem_logged_out` on fresh logins via `setEcosystemCookie()`.
- **Fast Watcher & App Lifecycle Defense:**
  - Configured `initEcosystemSessionWatcher()` to poll every 2.5 seconds and trigger on window focus and visibility changes.
  - In [`AppShell.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/components/AppShell.tsx), verified `isExplicitlyLoggedOut()` on mount and immediately purged local auth state (`Auth.clear()`) if any other ecosystem tab or app logged out.
  - In [`ssoBridge.ts`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/lib/ssoBridge.ts), updated `isExplicitLogout` to use `isExplicitlyLoggedOut()`, preventing automatic SSO re-authentication after a user explicitly logged out.

---

## [Release 2026-10-10] — Spoke 403 Loop Elimination, Address Bar Query Sanitization & Cross-ERP Failover Redirection

### 1. Spoke ERP 403 Loop Prevention & Failover Cross-ERP Redirection
- **Immediate Address Bar Query Sanitization in [`ssoBridge.ts`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/lib/ssoBridge.ts):**
  - In `processIncomingSsoHandover()`, stripped `sso_handover` from `window.location.search` immediately upon parsing via `window.history.replaceState`. Prevents re-submitting rejected tickets on browser refreshes or navigation changes.
- **Failover Cross-ERP Redirection on 403 Forbidden:**
  - When backend `POST /api/v1/auth/sso-handover` responds with 403 (e.g. user granted only Yinglima attempts to access Inhyma), the `catch` block clears stale credentials (`Auth.clear()`) and inspects the active central session.
  - Automatically redirects users to their granted spoke ERP (e.g. Yinglima at `http://localhost:5173/dashboard?sso_handover=...`) or the official central control plane (`http://localhost:5170/dashboard`), avoiding endless 403 exception retries.
- **AppShell & App Lifecycle Loop Defense:**
  - In [`AppShell.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/components/AppShell.tsx), sanitized `location.search` when redirecting to `/login` to ensure rejected handover parameters are not carried into login route state.
  - In [`App.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/App.tsx), added `ssoProcessedRef = useRef(false)` guard preventing repeated invocations across component re-renders.

### 2. Auto-Activation on Central SSO Handover & Eviction Guard
- **Verified Account Auto-Activation in [`auth/routes.py`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/backend/app/auth/routes.py):**
  - In `sso_handover_login`, when central verification confirms the user is authorized for Inhyma, any existing account marked inactive or soft-deleted is automatically restored (`deleted_at = None`, `is_active = True`, `status = UserStatus.ACTIVE`). Unregistered users are auto-provisioned on the fly. Eliminates 403 errors when central permissions are restored.
- **Central Verification Before Eviction in [`AppShell.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/components/AppShell.tsx):**
  - Gated the logged-in access check behind `verifyCentralEcosystemSession`. Prevents stale localhost browser cookies from evicting newly authenticated users and eliminates multi-tab redirect loops.
- **Failover SSO Error Signaling in [`ssoBridge.ts`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/lib/ssoBridge.ts):**
  - Appended `?sso_error=handover_failed` when redirecting back to the control plane, allowing ERP_Main to halt automated bouncing and retain the user on the control plane dashboard.

---

## [Release 2026-10-10] — Production HTTPS Mixed Content Elimination, Supabase PgBouncer Statement Cache Auto-Disable & Bi-Directional Password Sync Federation

### 1. Production Origin Security, Dynamic SSO Routing & User Isolation
- **`isLocalhost()` Security Interceptor:**
  - In [`ecosystemSession.ts`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/lib/ecosystemSession.ts) and [`ssoBridge.ts`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/lib/ssoBridge.ts), wrapped all `http://localhost:*` fallback URLs with `isLocalhost()` guards.
  - In production HTTPS deployments (e.g. Render, Cloudflare, custom domains), insecure `http://` calls to ports `:8000`, `:8001`, `:8002`, `:5170`, `:5173`, and `:5174` are suppressed, eliminating browser Mixed Content blocking errors (`Blocked loading mixed active content`).
- **Dynamic SSO Route Handling (`routeForCentralSession`):**
  - Added `routeForCentralSession` and `createSsoHandoverUrlFromSession` in [`ssoBridge.ts`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/lib/ssoBridge.ts) to handle multi-ERP routing directly from central session data.
  - Users with 0 granted spoke ERPs (e.g. `User A`, `User B`, `User C`, `User D` with `allowed_erps = ["control-plane"]`) or $\ge 2$ spoke ERPs are automatically redirected to `http://localhost:5170/dashboard`.
  - Users with exactly 1 other spoke ERP are redirected to their assigned ERP dashboard.
- **User Isolation Guard:**
  - In `processIncomingSsoHandover()`, if the incoming ticket or cookie email differs from the local cached profile, `Auth.clear()` runs immediately to enforce strict account isolation and avoid session leakage across logins.
  - Direct navigation to Inhyma routes (`/dashboard`) by unassigned users triggers an automatic bounce to `http://localhost:5170/dashboard`.

### 2. Dual-Path Centralized Spoke Login (`Login.tsx`)
- **Central Session Routing & Graceful SSO Fallback in [`Login.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/pages/Login.tsx):**
  - Updated the login workflow to perform local authentication while concurrently establishing the central ecosystem session with `ERP_Main`.
  - Supports flexible user lookup by canonical email, display name (e.g. `User A`), or username prefix.
  - If a user is not authorized for Inhyma (including zero-grant users), `routeForCentralSession` immediately redirects them via SSO handover to the official central dashboard (`http://localhost:5170/dashboard`) or their designated spoke ERP rather than throwing an unhandled error.
  - If a user's password was changed on another ERP and has not yet synced locally, the verified central session logs them in via SSO handover, preventing user lockouts.
  - Fails closed: if the user's central session is reported revoked or inactive, login is rejected immediately.

### 3. Bi-Directional Password Synchronization with ERP_Main
- **Password Fanout Client [`erp_main_client.py`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/backend/app/federation/erp_main_client.py):**
  - Added `push_password_to_erp_main(email, new_password)` transmitting password changes to `ERP_Main` via `POST /internal/users/password` using internal service credentials.
- **Route Interceptors:**
  - Hooked into `change_password` in [`auth/routes.py`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/backend/app/auth/routes.py) and `reset_password` in [`users/routes.py`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/backend/app/users/routes.py).
  - Automatically pushes password updates to ERP_Main so they propagate across the entire multi-ERP ecosystem without raising into or interrupting the local caller.
- **Automated Test Suite:**
  - Added [`test_password_sync_to_erp_main.py`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/backend/tests/test_password_sync_to_erp_main.py).

### 4. SSO Handover Central Verification Guard
- **Fail-Closed Session Confirmation in [`auth/routes.py`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/backend/app/auth/routes.py):**
  - Integrated `verify_ecosystem_session(session_id)` from [`erp_main_client.py`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/backend/app/federation/erp_main_client.py) into `sso_handover_login`.
  - When `SSO_HANDOVER_REQUIRE_CENTRAL_VERIFICATION` is enabled, the backend verifies the central session against ERP_Main's live database before generating local tokens.
  - Ensures tokens constructed client-side cannot bypass access governance, and immediately rejects revoked or suspended accounts.
- **Automated Test Suite:**
  - Added [`test_sso_handover_central_verification.py`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/backend/tests/test_sso_handover_central_verification.py).

### 5. Central Identity Protection on Local Profile Edits
- **Email Modification Lock in [`users/routes.py`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/backend/app/users/routes.py):**
  - Implemented `enforce_central_identity(user_service, user_id, payload)`.
  - Form re-submissions containing the existing email are permitted, but attempting to modify an email address locally throws `ForbiddenException("A user's email is managed centrally. Please change it from the ERP_Main Control Panel.")`, preventing broken SSO identity mappings.

### 6. Database Connection Hardening for Supabase Transaction Pooler (PgBouncer)
- **Prepared Statement Cache Auto-Disable:**
  - In [`app/database/engine.py`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/backend/app/database/engine.py), implemented `_statement_cache_must_be_disabled()`.
  - Auto-detects port 6543 / PgBouncer connection strings and disables asyncpg's prepared statement cache (`statement_cache_size=0`), preventing `DuplicatePreparedStatementError`.

### 7. Python Virtualenv Interpreter Resolution in `server.py`
- Fixed Windows virtual environment symlink resolution by using `sys.executable` directly rather than `Path(sys.executable).resolve()`.

---

## [Release 2026-10-06] — Purchase Order Modules, Database-Driven Workflow Engine, Proforma Invoice Extensions & Company Specification Upgrades

### 1. Purchase Module — Local Purchase Management (`/purchase/local-orders`)
- **Backend Architecture & Routes (`app/purchase/local_routes.py`):**
  - Implemented complete CRUD, server-side pagination, search across invoice number/supplier/warehouse, date filters (`date_from`, `date_to`), and status tabs.
  - **Dynamic Expense Factor Costing Engine (`app/purchase/costing.py`):** Computes `total_expenses = packing_forwarding + transport + offloading` and calculates `loading_percent = (total_expenses / basic_amount) * 100`. Each line item computes `expense_per_unit = round(unit_rate * (loading_percent / 100), 2)` and `unit_landing_value = unit_rate + expense_per_unit`.
  - **Automated Stock-In Application:** Transitioning a local purchase to `confirmed` status automatically updates warehouse physical inventory (`app/inventory/stock_service.py` / `move_stock`) and marks `stock_applied = True`.
  - **Database Migration (`l1a2b3c4d5e9_create_purchase_tables.py`):** Creates `local_purchases` and `local_purchase_items` with supplier foreign key links, invoice details, expenses breakdown, and versioning.
- **Frontend Interface (`LocalPurchasePage.tsx`):**
  - Interactive table with status counters (`all`, `pending`, `confirmed`), search bar, item limit selector, and dynamic sorting indicators.
  - **Dynamic Masters Lookups:** Replaced hardcoded dropdowns with live API lookups for active suppliers (`/suppliers`), physical warehouses (`/masters/warehouses`), and units of measurement (`/masters/uom`).
  - Integrated typeahead search with datalist `<datalist id="local-supplier-options">` and canonical supplier name normalization.
  - Line-item table automatically renders UOM unit badges and performs live recalculations of landing rates as expenses change.
  - Full A4 PDF generation integration (`localPurchasePdf.ts`, `LocalPurchasePdfPage.tsx`).

### 2. Purchase Module — Import Purchase Consignments (`/purchase/import-orders`)
- **Backend Architecture & Routes (`app/purchase/import_routes.py`):**
  - Consignment tracking with exchange rate (`conversion_rate`), customs valuation rate (`customs_conversion_rate`), import duty percentage, and CBM volumetric calculations.
  - **Dual Landing Valuation Matrix:** Computes landing rate on both Value Basis (`VB`) and CBM Volume Basis (`CB`), including `landing_diff = unit_landing_cb - unit_landing_vb`.
  - **Live Preview Endpoint (`POST /purchase/import-orders/preview`):** Provides instant recalculation of CBM, duty, and landing expenses while the user types in the creation/edit drawer.
  - **Multi-Date Range Filtering:** Supports server-side and client-side filtering across three distinct date ranges: **Expected Arrival Date Range**, **ETD Origin Date Range**, and **ETA Port Date Range**, with presets (Today, Yesterday, Last 7 Days, This Month, Custom).
  - **Ordered Status Warehouse Restriction:** Automatically hides physical destination warehouses during the `pending` phase, ensuring consignments still in transit can only be routed to non-physical / transit holding locations (e.g. `Mumbai Ordered`, `Ahmedabad Ordered`, `Indore Ordered`).
- **Frontend Interface (`ImportPurchasePage.tsx`):**
  - Full consignment management with status tabs (`all`, `pending`, `confirmed`, `received`, `closed`).
  - Searchable supplier input with datalist (`<datalist id="import-supplier-options">`) and validation requiring selection from the supplier master.
  - Interactive table showing Consignment No., Ordered Date, Invoice Date, Supplier, Warehouse, Total USD, Total INR, and landing totals.
  - Detailed side drawer and modal view showing breakdown of shipping line charges, CFS charges, clearing transport, stamp duty, insurance, freight, and misc remarks.
  - Import Purchase PDF generator (`importPurchasePdf.ts`, `ImportPurchasePdfPage.tsx`).

### 3. Database-Driven Workflow Rules Engine & Resilience Fallbacks
- **Architecture (`app/common/workflow.py`):**
  - Workflow transitions, editable rules, deletable permissions, and initial statuses are stored dynamically in the `meta` column of the `option_lists` table (`group_key` = `purchase.local.status`, `purchase.import.status`, `proforma.status`).
  - Replaces hardcoded transition constants with configurable data rules: `next`, `admin_only_to`, `perm_to`, `reason_required_to`, `edit`, `delete`, and `stock_in`.
- **Alembic Seeding Migrations:**
  - `m1a2b3c4d5ea_seed_purchase_rules.py`: Seeds status groups and workflow options for Local and Import Purchases.
  - `k1a2b3c4d5e8_seed_proforma_rules.py`: Seeds status rules, commercial defaults, and numbering rules for Proforma Invoices.
- **Alembic Version Desynchronization Resolution:**
  - Identified and resolved invalid revision identifier `'g1a2b3c4d5e8'` in the database's `alembic_version` table.
  - Successfully upgraded database to head revision `m1a2b3c4d5ea` (and subsequent `o1a2b3c4d5ec`), restoring full schema alignment across Supabase PostgreSQL.
- **Client & Server Fallback Resilience:**
  - Added `FALLBACK_RULES` dictionary in `app/common/workflow.py` and `DEFAULT_LOCAL_PURCHASE_RULES` / `DEFAULT_IMPORT_PURCHASE_RULES` in `frontend/src/lib/workflowRules.ts` to ensure endpoints and pages never fail if database rules are momentarily unseeded.

### 4. Extended Company Profile Specification Upgrades
- **Database Migrations (`n1a2b3c4d5eb_extend_company_profile.py`, `o1a2b3c4d5ec_seed_company_option_lists.py`):**
  - Added new columns to `companies`: `monthly_turnover`, `potential_business_per_month`, `direct_import_from_china`, `monthly_import_volume`, `products_needed_for_imports`.
  - Added new columns to `company_contacts`: `birth_date` and `anniversary_date`.
  - Seeded option list groups for `company.business_type`, `company.business_category`, `company.monthly_turnover`, `company.potential_business_per_month`, `company.direct_import_from_china`, and `company.monthly_import_volume`.
- **Backend Validation & Conditional Constraints (`app/companies/schemas.py`, `models.py`):**
  - **Direct Import from China Cluster:** Strictly restricted to companies where `company_type` (Business Type) is `B2B`.
  - **Import Volume & Products:** Restricted to when `direct_import_from_china == "Yes"`.
  - **Potential Reason:** Mandatory when `potential == "no"`.
  - **Potential Business per Month:** Allowed only when `potential == "yes"`.
  - **Contact Birth Date & Anniversary Date:** Validated and stored on sub-contacts.
- **Frontend Enhancements (`Companies.tsx`, `companyFields.ts`):**
  - Dynamic conditional rendering of Monthly Turnover (when Business Type is selected), Potential Reason (when Potential = No), and Potential Business per Month (when Potential = Yes).
  - Dedicated Section 2b: **Direct Import from China** with automatic field clearing (`clearInapplicableCompanyFields`) when prerequisites change.
  - Birth Date and Anniversary Date pickers on Company Sub-Contacts with automated age calculation (`computeAge`).

### 5. Supplier Directory — Mandatory Calling Number
- **Backend Enforcement (`app/suppliers/schemas.py`, `repository.py`, `service.py`):**
  - Made `contact_calling_number` a mandatory field (`min_length=1`) on supplier creation.
  - Added validator `_validate_calling_not_blanked` ensuring updates cannot wipe or blank the calling number.
- **Frontend Validation (`Suppliers.tsx`):**
  - Added required red asterisk (`*`) to the Calling Number field in both quick and full supplier creation drawers.
  - Client-side pre-submission validation flags empty calling numbers immediately with `Calling number is required.`.

### 6. RBAC & Workflow Permission Seeds
- **Scripts (`scripts/seed_purchase_permissions.py`, `scripts/seed.py`):**
  - Created and granted permissions: `proforma.approve` (Approve proforma invoices), `localpurchase.update` (Edit pending local purchases), `localpurchase.confirm` (Confirm local purchases & add stock).
  - Added these permissions directly to `BOOTSTRAP_PERMISSIONS` in `scripts/seed.py`.

---



### 1. Quotation Portal URL Parametrization
- **Eliminated Hardcoded LAN Fallback:** In [`routes.py:1052`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/backend/app/inquiries/routes.py#L1052), replaced the hardcoded `192.168.1.23:5173` LAN IP fallback with `(request.headers.get("origin") or getattr(settings, "FRONTEND_URL", "http://localhost:5174")).rstrip("/")`. Automated RFQ quotation email links now resolve dynamically to the live production domain.
- **Fixed Session Name Bug:** In [`routes.py:1566`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/backend/app/inquiries/routes.py#L1566), corrected `db=db` to `db=session` in `_publish_inquiry_post_commit_event`.

### 2. Central Control Plane Dynamic Navigation & SSO Handover
- **Decoupled User Management Link:** In [`Users.tsx:990`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/pages/Users.tsx#L990), replaced hardcoded `http://localhost:5170/access/users` with dynamic URL resolution from `getEcosystemErps()` / `VITE_CONTROL_PLANE_URL`.
- **SSO Handover Integration:** Wrapped the button link with `createSsoHandoverUrl` so operators navigating to the Central Dashboard are seamlessly authenticated.

### 3. Multi-ERP Ecosystem & Session Synchronization
- **Configurable Spoke & Control Plane URLs:** Updated [`ssoBridge.ts`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/lib/ssoBridge.ts) to read `VITE_CONTROL_PLANE_URL`, `VITE_CONTROL_PLANE_API_URL`, `VITE_YINGLIMA_URL`, `VITE_INHYMA_URL`, and `VITE_API_ORIGIN`.
- **Cross-Subdomain SSO Cookies:** Updated [`ecosystemSession.ts`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/lib/ecosystemSession.ts) to support `VITE_CENTRAL_AUTH_API` and `VITE_COOKIE_DOMAIN` (e.g. `.yourcompany.com`).
- **Pydantic Settings:** Added `BACKEND_URL` and `FRONTEND_URL` to the `Settings` class in [`config.py`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/backend/app/core/config.py).

### 4. Cloud Infrastructure Assets
- **Docker & Nginx:** Added [`frontend/Dockerfile`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/Dockerfile) and [`frontend/nginx.conf`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/nginx.conf) with SPA fallback rewrites and asset caching.
- **Render Blueprint:** Added [`render.yaml`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/render.yaml) for 1-click Render web service and static site provisioning.
- **Dynamic Port Binding:** Updated [`backend/Dockerfile`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/backend/Dockerfile) to dynamically bind to `${PORT:-8002}`.
- **Compose Orchestration:** Added [`docker-compose.prod.yml`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/docker-compose.prod.yml).

## [Release 2026-10-10] — Real-Time Provisioning Synchronization & Soft-Deleted User Restoration
- **Re-Granting Restoration:** Updated `POST /api/v1/internal/users/provision` in [`internal_users.py`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/backend/app/api/v1/internal_users.py) to look up users by email regardless of `deleted_at`. When access is restored in ERP_Main, any soft-deleted user is reactivated (`deleted_at = None`, `is_active = True`, `status = ACTIVE`) and their password updated if provided.
- **Dynamic List Filtering:** Soft-deleted users are omitted from active user queries (`/users`), while restored users immediately reappear upon being granted access.

---

## [Release 2026-10-10 Part 2] — Ecosystem Session Reliability, Cross-ERP Switching & False Logout Elimination

### 1. Root Cause Resolution for False Logouts and Switch Loops
- **Session Revocation Disambiguation:** In [`ecosystemSession.ts`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/lib/ecosystemSession.ts), the `ihm_ecosystem_logged_out` cookie was previously written as a generic `"1"`, causing newly established sessions to be flagged as revoked.
- **Session-ID Keyed Revocation:** `clearEcosystemCookie(sessionId)` now records the exact revoked session ID inside `ihm_ecosystem_logged_out`. `isExplicitlyLoggedOut(currentSessionId)` only flags revocation if the cookie's recorded ID matches the current active session.
- **SSO Handover Exemption:** Added immediate exemption for incoming SSO handover navigation (`sso_handover` query param in URL) ensuring switching users are never rejected as logged out.
- **Cross-Domain/Port Cleansing:** Added `clearCookieEverywhere` and `setCookieEverywhere` covering host-only, `localhost`, `127.0.0.1`, current hostname, and `VITE_COOKIE_DOMAIN`.

### 2. Multi-Tab Session Synchronization & Polling Loop Hardening
- **Watcher Polling Loop Fix:** Removed redundant calls to `clearEcosystemCookie()` inside periodic polling, preventing perpetual renewal of the 60-second logout window.
- **Tab Focus Stale State Recovery:** Window `focus` events purge stale tab-scoped `ihm_explicit_logout` flags when an active local session exists.

### 3. Switcher Fallbacks & Local Login Session Recovery
- **Switch Failure Fallback:** Wrapped `handleSwitch` in [`EcosystemSwitcher.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/components/EcosystemSwitcher.tsx) in try/catch blocks with direct navigation fallback.
- **Local Login Fallback Session:** In [`Login.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/pages/Login.tsx), local login automatically establishes a fallback ecosystem session cookie if central control plane communication is degraded.

### 4. Backend Multi-Identifier & Role-Based Authorization
- **Comprehensive Key Resolution:** In [`routes.py`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/backend/app/auth/routes.py), `sso_handover_login` matches against all known Inhyma identifiers (`inhyma`, `erp-01`, and dynamic `settings.ERP_KEY`), eliminating 403 Forbidden false rejections when central permissions use machine keys or friendly names.
- **Central Authority & Super Admin Exemption:** Central role verification honors `central.get("role") == "super_admin"` with ecosystem-wide access, preventing super admins or users with valid grants from getting trapped in redirect loops.

---

## [Release 2026-10-03] — Unique Navigation Icons, Machine Identifiers & Dynamic Company Branding from ERP Settings

### 1. Unique Navigation Icons across All 39 Sidebar Routes
- **Complete Visual Icon Differentiation:** Every navigation entry across all 7 sidebar sections (`DASHBOARD`, `OPERATIONS`, `LOGISTICS`, `PROCUREMENT & SOURCING`, `MASTERS`, `ADMINISTRATION`, `SETTINGS`) was upgraded to use a dedicated, semantically matched SVG icon in [`icons.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/components/icons.tsx) and mapped in [`nav.ts`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/lib/nav.ts). Zero icons are duplicated or shared.
- **Automated Regression Guard:** Added [`NavIconsUniqueness.test.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/pages/__tests__/NavIconsUniqueness.test.tsx) asserting 100% unique icon keys across all top-level and sub-navigation routes.

### 2. Backend Machine Identifiers (`erp-01` and `erp-02`)
- **Machine Identification Contract:** Added `ERP_INSTANCE_ID = "erp-01"` in [`config.py`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/backend/app/core/config.py) for backend routing, heartbeat checks, and machine-to-machine federation, eliminating reliance on hardcoded human company names.
- **Public Branding Endpoint (`GET /organizations/public`):** Added in [`organizations/routes.py`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/backend/app/organizations/routes.py) returning `{ company_name, legal_name, logo_url, erp_id }` without requiring user authentication.

### 3. Dynamic Human-Facing Branding from ERP Settings
- **Dynamic Brand Resolver:** Updated [`brand.ts`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/lib/brand.ts) and [`nav.ts`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/lib/nav.ts) to default to generic `"ERP"` and dynamically resolve the active company name from `GET /organizations/public`, persisting to `localStorage` (`erp_org_company_name`) for 0ms flicker-free hydration.
- **Document & PDF Generation:** Updated all official document generators ([`localPurchasePdf.ts`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/lib/localPurchasePdf.ts), [`importPurchasePdf.ts`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/lib/importPurchasePdf.ts), [`proformaInvoicePdf.ts`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/lib/proformaInvoicePdf.ts), [`salesOrderPdf.ts`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/lib/salesOrderPdf.ts), [`stockTransferPdf.ts`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/lib/stockTransferPdf.ts), [`stockAdjustmentPdf.ts`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/lib/stockAdjustmentPdf.ts)) to call `getCachedBrandName()`, ensuring company name changes made in **ERP Settings -> Company Name** instantly reflect on generated PDFs.
- **Cross-ERP Switcher:** Updated [`EcosystemSwitcher.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/components/EcosystemSwitcher.tsx) and [`ssoBridge.ts`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/lib/ssoBridge.ts) to dynamically resolve peer ERP company names from peer `/organizations/public` endpoints.
- **Automated Regression Suite:** Added [`brandResolution.test.ts`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/lib/__tests__/brandResolution.test.ts) covering public resolution, reactivity, subscriber notification, and machine ID mappings.

---

## [Release 2026-09-29] — Renamed Organization Settings to ERP Settings

### 1. Sidebar & Navigation Update
- **Sidebar & Title Rename**: Renamed `"Organization Settings"` to `"ERP Settings"` in sidebar items, navigation configuration, and document title helper.
- **Route Alias**: Added `/erp-settings` route alias alongside `/organization` in [App.tsx](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/App.tsx) for backward and forward URL compatibility.
- **Page Header & Breadcrumbs**: Updated heading to `ERP Settings` and breadcrumb trail to `["Settings", "ERP Settings"]` in [Organization.tsx](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/pages/Organization.tsx).
- **Files Modified**:
  - Frontend: [`nav.ts`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/lib/nav.ts), [`Organization.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/pages/Organization.tsx), [`App.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/App.tsx), [`index.html`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/index.html), [`brand.ts`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/lib/brand.ts), [`icons.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/components/icons.tsx), [`style.css`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/styles/style.css).
  - Documentation: [`MODULES_AND_FEATURES_TEST_MANUAL.md`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/MODULES_AND_FEATURES_TEST_MANUAL.md).

---

## [Release 2026-09-29] — Extended Company Intelligence, Cascading Geography & Form Hardening

### 1. Extended Company Profile Intelligence
- **New Attributes Added:**
  - `pincode`: 6-digit postal code.
  - `district_id`: Foreign key linked to `districts.id`.
  - `company_category`: Categorization (Manufacturer, Trader, OEM, Service).
  - `product_manufacture_or_supply`: In-depth goods manufactured or supplied.
  - `machines_buying_from`: Competitor/vendor machinery intelligence.
  - `spares_buying_from`: Competitor/vendor spare parts intelligence.
  - `products_interested`: Target demand and product interest areas.
  - `gst_registration_date`: Tax registration date.
  - `age_of_company`: Operational tenure in years.
  - `social_media`: Dynamic JSON matrix `[{"platform": "LinkedIn", "url": "https://..."}, ...]`.
- **Files Modified:**
  - Backend: [`schemas.py`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/backend/app/companies/schemas.py), [`models.py`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/backend/app/companies/models.py), [`repository.py`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/backend/app/companies/repository.py), [`routes.py`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/backend/app/companies/routes.py).
  - Frontend: [`Companies.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/pages/Companies.tsx) (integrated full drawer fields and interactive social media repeater).

### 2. Cascading Geographic Address Resolution
- **Cascade Rules:** State ➔ District ➔ City hierarchy enforced in UI and API.
- **Backend Lookups:** Enhanced `CityLookupRead` with `state_id` and `district_id` in [`masters/cities/schemas.py`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/backend/app/masters/cities/schemas.py).
- **Auto-Persistence:** Custom cities dynamically created by users persist with parent `state_id` and `district_id`.

### 3. Global Autocomplete & Autofill Blocker System
- **File Added:** [`Inhyma_ERP/frontend/src/lib/autocompleteBlocker.ts`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/lib/autocompleteBlocker.ts).
- **Suppression Engine:** Continuous DOM `MutationObserver` + capture-phase `focusin` event interceptor. Permanently eliminates floating black tooltip bubbles (e.g. `ABC packaging` over `Company Name *`) and password manager heuristic prompts.
- **Explicit Drawer Inputs:** Added `autoComplete="off"` to all 14 quick drawer inputs in `Companies.tsx`.

### 4. Wheel Scroll Value Lockout & Spin-Button Removal
- **Document Wheel Listener:** Added passive `wheel` listener in [`main.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/main.tsx) blurring `input[type="number"]` when scrolled.
- **CSS Spin-Button Removal:** Updated [`style.css`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/styles/style.css) with `-webkit-outer-spin-button` suppression and `-moz-appearance: textfield`.

### 5. Typeahead Company Name Autocomplete & Auto-Fill Extraction
- **Overview:** When a user types into the `Company Name *` field in the "Add Company" quick drawer or full modal drawer, an interactive dropdown extracts and displays matching company names from the ecosystem based on the typed letters.
- **Backend Lookup API:** Added `GET /api/v1/companies/lookup?q={query}&limit={n}` in [`Inhyma_ERP/backend/app/companies/routes.py`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/backend/app/companies/routes.py). It queries non-deleted companies case-insensitively (`company_name.ilike(f"%{q}%")`) and returns company metadata (tax ID, area, district, city, state, contacts, website, sales person).
- **Frontend Autocomplete Component:** Implemented `CompanyNameAutocomplete` in [`Inhyma_ERP/frontend/src/pages/Companies.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/pages/Companies.tsx):
  - **Instant Local Search:** Matches against preloaded in-memory company records with 0ms latency.
  - **Debounced Remote Search:** 150ms debounced queries against `GET /companies/lookup` for ecosystem-wide matches.
  - **Matched Character Highlighting:** Highlights typed letter matches in vivid deep blue (`#0061f2`) over a soft blue tag background (`#e0f2fe`).
  - **Secondary Metadata Preview:** Displays GST number, Area, District, and Business Type badge in suggestion dropdown.
  - **Keyboard Navigation:** Full support for `ArrowDown`, `ArrowUp`, `Enter` to select, and `Escape` to dismiss.
  - **Automatic Form Population:** Selecting an existing company auto-populates `company_name` and backfills related fields (`company_type`, `tax_id_number`, `area`, `state_id`, `district`, `city_id`, `contact_*`, `primary_website`, etc.).
  - **New Company Graceful Fallback:** If no existing match is found, clearly displays "No existing company matching ... Will be created as a new company profile."
- **Unit & Integration Tests:** Added tests in [`Inhyma_ERP/backend/tests/test_companies.py`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/backend/tests/test_companies.py) verifying lookup execution, query term filtering, and null safety.

### 6. Client Name Typeahead Extraction in Stock Adjustment Orders (Stock IN & Stock OUT)
- **Overview:** Added typeahead company extraction to the `Client Name` field inside Adjustment Order creation (`/adjustment/addEdit` and `/stock-adjustment` quick drawer) for both **Stock IN** and **Stock OUT**.
- **Component Created:** [`ClientNameAutocomplete.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/components/ClientNameAutocomplete.tsx)
  - Features exact visual replica of ERP reference format: `Company Name | Contact Person | Phone Number`.
  - Immediate dropdown presentation on input focus/click with preloaded ecosystem companies.
  - Typeahead letter extraction with highlighted matching characters (`#0061f2` on `#e0f2fe`).
  - Keyboard navigation (`ArrowDown`, `ArrowUp`, `Enter`, `Escape`) and outside-click dismissal.
  - Seamless integration in [`AddAdjustmentOrderPage.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/pages/AddAdjustmentOrderPage.tsx) and [`StockAdjustmentPage.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/pages/StockAdjustmentPage.tsx).
  - Freeform custom client name fallback support with `➕ Use "[name]" as custom client name`.
- **Automated Tests:** Added test coverage in [`AddAdjustmentOrderPage.test.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/pages/__tests__/AddAdjustmentOrderPage.test.tsx) verifying letter extraction, option selection, and Stock IN / Stock OUT retention.

### 7. Leads Inquiries Management (`/lead/list`) & Companies UI Design Alignment
- **Overview:** Implemented the full Leads module matching the production ERP reference at `erp.inhymasolutions.com/lead/list` and fully aligned with the **Companies module visual design system and architecture**. Includes inquiry intake, sales allocation, priority sorting, search, 10-field dynamic list-based extraction filtering, letter-based company typeahead autocomplete, single soft-delete, and bulk deletion.
- **Frontend Implementation:**
  - **Component Created & Refactored:** [`LeadsPage.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/pages/LeadsPage.tsx)
  - **Companies Module Visual Design System Alignment:**
    * **Page Container & Header:** Built inside `<AppShell activeKey="leads" pageClassName="page-suppliers">` with `<main className="page">`, `<Breadcrumb trail={["Leads"]} />`, `.page-header` with subtitle, and `.page-header-actions`.
    * **Header Action Buttons:**
      - Filter toggle button (`#0061f2` when open, `#475569` when closed) with funnel icon.
      - `+ QUICK ADD` button using `.btn-quick-add` (`#ffffff` background, `1px solid #0061f2`, `#0061f2` text).
      - `+ ADD NEW` button using `.btn-add-new` (`#0061f2` background, white text).
      - `DELETE` bulk action button (`#10b981` default, `#dc2626` when rows selected).
    * **Filter Options Card (.card):** Wrapped in standard `.card` with `Filter Options` header, `Reset Filters` (`#f1f5f9` button) and `Search` (`#eab308` button), housing all 10 filter fields in a responsive 3-column grid with dynamic list-based option extraction.
    * **Data Table Card (.card):**
      - Toolbar starting directly with `50 v Items/Page` selector and search input with clear `×` button (redundant status tabs removed to match reference UI).
      - **Interactive Column Sorting Across Every Column:** 3-state sorting (Ascending `▲` -> Descending `▼` -> Reset) matching Companies module visual indicators (`#0284c7` badges with `#e0f2fe` backgrounds when active, subtle `↕` cues when inactive).
      - `.table-scroll` container with responsive `table` (`border-collapse: separate; border-spacing: 0`), clean hover states, clickable blue company links (`#0061f2`), priority pills, and `.chip` badges.
    * **SideDrawer Detail Inspection:** Clicking any Company Name opens `<SideDrawer>` with `<DetailFieldGrid>` displaying full lead profile information, geographic hierarchy, requirements, address, designation, and contact details matching the Companies module inspection pattern.
    * **Add Lead Drawer (1:1 with Production Screenshot & Form Hardening):** Re-architected the Add/Edit Lead drawer matching production reference `media_1790675832944.png` with pixel-perfect alignment:
      1. `Lead Source *`: Upgraded to a typable `Combobox` component with dropdown toggle chevron (`#lead-source-select-toggle`), real-time option filtering, custom text entry, and preloaded master lead sources.
      2. `Company Name *` with `Add Company` link: Symmetrically aligned header line with `ClientNameAutocomplete` (`Search Company Name` placeholder) styled to standard 38px input height and focus ring.
      3. `Address`: Full-width text input with 38px height.
      4. `Area` and `State *`: 2-column balanced grid (`gridTemplateColumns: "1fr 1fr"`, `gap: "16px"`) with custom SVG dropdown arrow.
      5. `District` and `City`: 2-column balanced grid with cascading options and standardized select styling.
      6. `Contact Person`, `Designation`, and `Priority`: 3-column balanced grid (`gridTemplateColumns: "1fr 1fr 1fr"`, `gap: "16px"`). Standardized Priority radio container to `height: 38px`, vertically centering `A ○  B ●  C ○` with the adjacent input fields.
      7. `Contact Number` and `Email`: 2-column balanced grid.
      8. `Clients Requirements`: Full-width textarea with `minHeight: 90px` and responsive resizing.
      9. Full-width blue `Submit` action button (`#0061f2`, `height: 42px`).
    * **Shimmer Skeleton Loading Rows:** Implemented `<LeadsTableSkeletonRows count={8} />` replacing spinners with smooth CSS shimmer placeholders across all 13 table columns during data loading.
  - **Navigation Integration:** Added `LEAD` section with `Leads` (`/lead/list`) in [`nav.ts`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/lib/nav.ts) and added `IconClipboard` in [`icons.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/components/icons.tsx).
  - **Router Registration:** Registered `/lead/list` and backward-compatible redirects (`/leads`, `/lead`, `/leads/list`) in [`App.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/App.tsx).
  - **Unit Test Suite:** [`LeadsPage.test.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/pages/__tests__/LeadsPage.test.tsx) with 12 comprehensive tests covering page title, actions, 13 columns, empty state, filter panel toggling, dynamic list extraction, skeleton shimmer loading, Add Lead drawer fields, typable Lead Source combobox, and real-time column sorting (all 12 passing; full frontend suite 337/337 passing across 44 files).
- **Backend Implementation:**
  - **Model:** [`Lead`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/backend/app/leads/models.py) in `app.leads.models` with `company_name`, `business_type`, `source`, `address`, `area`, `city`, `district`, `state`, `contact_person`, `designation`, `contact_phone`, `contact_email`, `priority`, `requirements`, `allotted_to`, `created_by`, `lead_status`, `notes`, `is_deleted`.
  - **Schemas:** [`schemas.py`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/backend/app/leads/schemas.py) (`LeadCreate`, `LeadUpdate`, `LeadRead`, `LeadBulkDeleteRequest`).
  - **Repository & Service:** [`repository.py`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/backend/app/leads/repository.py) and [`service.py`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/backend/app/leads/service.py) supporting pagination, search across fields, multi-attribute filtering, and bulk soft-delete.
  - **Routes:** [`routes.py`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/backend/app/leads/routes.py) registered at `/api/v1/leads` and `/api/v1/lead` in [`router.py`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/backend/app/api/v1/router.py).
### 8. Typable Cascading Address Comboboxes (State ➔ District ➔ City) Across Leads & Companies (Quick Add & Add New)
- **Workflow Architecture:**
  - Strict hierarchical dependency based on Masters tables:
    * **State:** Populated from `/masters/states?status=active`.
    * **District:** Filtered dynamically based on selected State via `/masters/districts/lookup?state_id={state_id}`.
    * **City:** Filtered dynamically based on selected District via `/masters/cities/lookup?district_id={district_id}&state_id={state_id}`.
  - **Dynamic State Reset Handling:**
    * Selecting or changing a State automatically clears `district` and `city`, enables the District combobox, and keeps City disabled with placeholder "Select District First".
    * Selecting or changing a District automatically clears `city` and enables the City combobox.
    * If State is unselected, District is disabled with placeholder "Select State First".
- **Typable Combobox Interface:**
  - Upgraded State, District, and City from native `<select>` dropdowns to typable, searchable `Combobox` (and `SelectWithSearch`) components.
  - Users can both type freely to filter options instantaneously or click the dropdown toggle chevron to browse options.
  - Symmetrical styling: Standardized 38px height, 18px label lines, `#cbd5e1` borders, `#f8fafc` disabled background with `#94a3b8` muted text.
- **Modules Covered:**
  - **Leads Module (`LeadsPage.tsx`):**
    * Add / Edit Lead Drawer `State *` (`#lead-state-select`), `District` (`#lead-district-select`), and `City` (`#lead-city-select`).
  - **Companies Module (`Companies.tsx`):**
    * Quick Add Drawer `State *` (`#quick_state_id`), `District` (`#quick_district`), and `City` (`#quick_city_id`).
    * Add New Full Modal/Drawer `State *` (`#state_id`), `District` (`#district_id`), and `City` (`#city_id`).
- **Automated Tests:**
  - Added dedicated cascading tests in [`LeadsPage.test.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/pages/__tests__/LeadsPage.test.tsx) and [`CompaniesCascadingAddress.test.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/pages/__tests__/CompaniesCascadingAddress.test.tsx). Full test suite passing 100% green.

### 9. Follow Ups Management (`/follow-up/list`) & Companies UI Design Alignment
- **Overview:** Implemented the complete Follow Ups telecalling logs and inquiry management module matching the production ERP reference at `erp.inhymasolutions.com/follow-up/list` and fully aligned with the **Companies and Leads visual design system and architecture**. Includes interaction logging, client follow-up classifications, scheduled inquiry logs, 12-control responsive 4x3 filter panel, 13-column interactive table with 3-state sorting, shimmer skeleton loading, SideDrawer profile inspector, and Add/Edit drawer with client typeahead autocomplete and strict State ➔ District ➔ City cascading comboboxes.
- **Frontend Implementation (`FollowUpsPage.tsx`):**
  - **Page Layout & Header:** Built inside `<AppShell activeKey="call-logs-follow-up">` with `<Breadcrumb trail={["Follow Ups"]} />`, `.page-header` with title "Follow Ups" and subtitle "Telecalling interaction logs, client follow-up classifications, and scheduled inquiry logs."
  - **Action Buttons:**
    * **Filter Toggle Button:** `#btn-toggle-filter`, `#0061f2` blue square button with funnel icon to toggle the 12-field filter card.
    * **Add New Button:** `#btn-add-follow-up`, `#0061f2` button with `+ ADD NEW` to slide open the Follow Up creation drawer.
    * **Bulk Delete Button:** `#btn-bulk-delete`, emerald green `#10b981` button displaying dynamic selected count `DELETE (N)` with trash can icon.
  - **4x3 Responsive Filter Card (12 Controls):**
    * Controls: `Added Date` (date picker), `Call Type` (dropdown), `Marketing Person` (dropdown), `Business Type` (dropdown), `State` (dropdown), `District` (dropdown), `City` (dropdown), `Current Status` (dropdown), `Category` (dropdown), `Client Grade` (dropdown), `Potential Type` (dropdown), `Business Category` (dropdown).
    * Action Bar: Right-aligned `Reset` (`#64748b` gray) and `Search` (`#f59e0b` amber/gold) buttons.
  - **13 Table Columns:**
    * `Checkbox`, `Sr. No.`, `Company Name`, `Contact Person`, `Type / Grade`, `Area / City`, `District / State`, `Current Status`, `Feedback`, `Call Category`, `Followup Date`, `Added On`, `Action`.
  - **Skeleton Shimmer Loading:**
    * `<FollowUpsTableSkeletonRows count={8} />` rendering 8 animated shimmer rows matching the exact 13-column layout during data fetching.
  - **3-State Column Sorting:**
    * Clicking any header toggles: Ascending `▲` ➔ Descending `▼` ➔ Reset default order.
  - **SideDrawer Profile Inspector:**
    * Clicking any `Company Name` slides out the right-side `<SideDrawer>` displaying company details, interaction summary, classification badges, address hierarchy, and quick edit action.
  - **Add / Edit Follow Up Drawer:**
    * Integrates `ClientNameAutocomplete` with letter extraction and prefill.
    * Masters cascading address resolution: State ➔ District ➔ City with typable `Combobox` controls and auto-reset of child selections when parent changes.
- **Backend Architecture (`app/follow_ups`):**
  - **Database Model:** `FollowUp` table in [`models.py`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/backend/app/follow_ups/models.py) with full audit columns (`created_at`, `updated_at`, `deleted_at`).
  - **Schemas & DTOs:** [`schemas.py`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/backend/app/follow_ups/schemas.py) for Create, Update, Read, and Filter parameters.
  - **Repository & Service:** [`repository.py`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/backend/app/follow_ups/repository.py) and [`service.py`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/backend/app/follow_ups/service.py) with soft-delete filtering and pagination.
  - **API Endpoints:** Registered under `/api/v1/follow-ups` and `/api/v1/follow-up` in [`routes.py`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/backend/app/follow_ups/routes.py).
- **Automated Verification:**
  - 12 comprehensive unit and integration tests in [`FollowUpsPage.test.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/pages/__tests__/FollowUpsPage.test.tsx) passing 100%.
  - 11 backend tests in [`test_follow_ups.py`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/backend/tests/test_follow_ups.py) and related suites passing 100%.
  - All 350 frontend tests across 45 files passing 100%.
  - Clean production build (`tsc -b && vite build`) with zero TypeScript errors.

---

## [Release 2026-09-26] — Spoke Deprovisioning & Ecosystem Switcher Synchronization

### 1. Internal Deprovisioning Endpoint
- **File Added:** [`Inhyma_ERP/backend/app/api/v1/internal_users.py`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/backend/app/api/v1/internal_users.py).
- Implemented `POST /api/v1/internal/users/{id}/deprovision` to revoke active sessions and set `deleted_at = NOW()`, `is_active = False`.
- Added soft-delete filtering in `UserRepository.search()` to ensure deprovisioned users disappear from `/users`.

### 2. Spoke User Management Cleanup
- Removed local password reset and forced logout buttons from spoke UI, centralizing user governance in `ERP_Main`.

### 3. Proactive Ecosystem Session Sync
- Updated topbar `EcosystemSwitcher.tsx` to call `establishCentralEcosystemSession` on mount, ensuring newly assigned permissions reflect without full re-login.

---

## [Prior Releases] — Core Modules & PDF Engines
- **Stock Adjustment & Order PDF Module:** Implemented Left-sliding drawer, dual-calendar date range popover, and A4 PDF generation engine.
- **Technical Tasks Module:** Service call triage with 5 status tabs, warranty inspection, and technician dispatching.
- **Product Stock Module:** 3-group summary cards with crimson badges, live inventory ledger, and warehouse filtering.
