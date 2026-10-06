# Yinglima_ERP — Changelog & Function Changes History

**System:** Yinglima_ERP (China Procurement)  
**Scope:** Functional updates, schema changes, UI hardening, and bug fixes.

## [Release 2026-10-05] — Commercial Invoice (CI) 16-Column Costing Engine & Local Purchase Supplier Sourcing

### 1. Supplier & Purchase Price Source of Truth (Confirmed Local Purchase)
- **Primary Sourcing from Confirmed Local Purchase History:**
  - For Sale Process orders (`/sale/process/new` & `SaleProcessForm.tsx`), the **Supplier** and **Unit Price (RMB) Including VAT** are pulled directly from the **latest Confirmed Local Purchase order** for that product (`LocalPurchaseItem` joined to `LocalPurchase`).
  - Fallback logic: If the item has not yet been ordered via Local Purchase, the system queries preferred quotations in `supplier_product_links` (`Product Prices`), followed by `standard_cost` from Product Master.
  - Visual verification: Added `[✓ Local Purchase]` badge next to the supplier name in both the form and detail modal tables.

### 2. Dynamic HSN Refund VAT & Product Master Real-Value Sync
- **HSN Database Real-Value Migration:**
  - Standardized all 144 active HSN codes in `hsn_codes` table to `gst_percent = 18.00%` and `refund_vat_percent = 13.00%`.
  - Synced all 3,546 products in `products` table with their linked HSN's `13.00%` Refund VAT.
- **Dynamic Formula for Price Excluding VAT:**
  - Plain English formula: `Unit Price Excluding VAT = Unit Price Including VAT / (1 + (HSN Refund VAT% / 100))`.
  - For standard 13.00% VAT, `¥113.00 Incl. VAT` dynamically yields `¥100.00 Excl. VAT`.

### 3. Full 16-Column Commercial Invoice Engine (Exact Excel Spreadsheet Replica)
- Matches Yinglima's official export commercial invoice spreadsheet (`doc/Yinglima_CI_Inhyma_YL-EXP2026-54.xlsx`):
  1. `SR.NO` — Sequential item number.
  2. `SUPPLIER` — Sourced from Confirmed Local Purchase history with `[✓ Local Purchase]` badge.
  3. `DESCRIPTION` — Product Name & Code.
  4. `CHINA HS CODE` — Official China export HS Code.
  5. `QUANTITY` — Number of units planned in consignment.
  6. `UNIT PRICE (RMB) INCL. VAT` — Factory purchase rate from Local Purchase invoice.
  7. `UNIT PRICE (RMB) EXCL. VAT` — Price without VAT (`Price Incl. VAT / (1 + Refund VAT%)`).
  8. `PROFIT %` — Profit margin (default 3.00%, editable).
  9. `PRICE WITH PROFIT (RMB)` — `Price Excl. VAT * (1 + (Profit% / 100))`.
  10. `FOB PRICE (USD)` — `Price With Profit (RMB) / USD Exchange Rate (6.70)`.
  11. `TOTAL CBM (M³)` — `Packaging CBM / Packaging Qty * Planned Qty`.
  12. `FREIGHT/UNIT (USD)` — `Total Container Freight / Container CBM * Item CBM / Qty`.
  13. `CFR PRICE/UNIT (USD)` — `FOB Price (USD) + Freight/Unit (USD)`.
  14. `TOTAL AMOUNT CFR (USD)` — `Quantity * CFR Price/Unit (USD)`.
  15. `TOTAL SUPPLIER AMOUNT (RMB)` — `Quantity * Unit Price (RMB) Incl. VAT`.
  16. `REMARKS` — Packing notes or consignment instructions.

### 4. Database Schema & Backend Trade Engine Extensions
- **`sales_orders` Table:**
  - Added `ocean_freight_usd`, `local_charges_coc_usd`, `usd_exchange_rate`, `profit_percent`, `total_container_cbm`.
- **`sales_order_items` Table:**
  - Added `supplier_id`, `supplier_name`, `unit_price_rmb_with_vat`, `unit_price_rmb_ex_vat`, `profit_percent`, `fob_price_usd`, `freight_unit_usd`, `cfr_price_usd`, `cbm_per_unit`, `total_cbm`, `total_supplier_amount_rmb`.
- **API Endpoints:**
  - `GET /api/v1/sales/products/{product_id}/costing-info`: returns complete costing payload with Local Purchase supplier.
  - `GET /api/v1/sales/orders/{id}/trade-details`: returns all 16 CI columns with container costing metrics.
  - `GET /api/v1/sales/orders/{id}/trade-documents/excel`: generates official 16-column Excel spreadsheet.

### 5. Frontend UI Upgrades in Sale Process Form & Detail Modal
- **`SaleProcessForm.tsx`:**
  - Sourcing from Local Purchase when extracting consignments or adding individual items.
  - Added Container & Export Freight panel (Ocean freight, local COC charges, USD rate, profit %, container CBM).
  - Added toggle `[ 📊 Costing & Supplier Columns (Active) ]` to display all 16 calculation columns inline.
- **`SaleProcessDetailModal.tsx`:**
  - Added CI View Mode toggle: `[ 📊 Full Costing & Supplier Engine (16 Columns - Excel Replica) ]` vs `[ 📄 Standard Customer CI (7 Columns) ]`.
  - Added Freight and Costing KPI cards above invoice (Ocean freight, COC charges, total freight, rate/CBM, exchange rate, profit margin, total supplier payable).

---

## [Release 2026-10-05] — Production Deployment Readiness, Zero-LAN URL Decoupling & Multi-Cloud Infrastructure

### 1. Quotation Portal URL Parametrization
- **Eliminated Hardcoded LAN Fallback:** In [`routes.py:1057`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Yinglima_ERP/backend/app/inquiries/routes.py#L1057), replaced the hardcoded `192.168.1.23:5173` LAN IP fallback with `(request.headers.get("origin") or getattr(settings, "FRONTEND_URL", "http://localhost:5173")).rstrip("/")`. Automated RFQ quotation email links now resolve dynamically to the live production domain.

### 2. Central Control Plane Dynamic Navigation & SSO Handover
- **Decoupled User Management Link:** In [`Users.tsx:990`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Yinglima_ERP/frontend/src/pages/Users.tsx#L990), replaced hardcoded `http://localhost:5170/access/users` with dynamic URL resolution from `getEcosystemErps()` / `VITE_CONTROL_PLANE_URL`.
- **SSO Handover Integration:** Wrapped the button link with `createSsoHandoverUrl` so operators navigating to the Central Dashboard are seamlessly authenticated.

### 3. Multi-ERP Ecosystem & Session Synchronization
- **Configurable Spoke & Control Plane URLs:** Updated [`ssoBridge.ts`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Yinglima_ERP/frontend/src/lib/ssoBridge.ts) to read `VITE_CONTROL_PLANE_URL`, `VITE_CONTROL_PLANE_API_URL`, `VITE_YINGLIMA_URL`, `VITE_INHYMA_URL`, and `VITE_API_ORIGIN`.
- **Cross-Subdomain SSO Cookies:** Updated [`ecosystemSession.ts`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Yinglima_ERP/frontend/src/lib/ecosystemSession.ts) to support `VITE_CENTRAL_AUTH_API` and `VITE_COOKIE_DOMAIN`.
- **Pydantic Settings:** Added `BACKEND_URL` and `FRONTEND_URL` to the `Settings` class in [`config.py`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Yinglima_ERP/backend/app/core/config.py).

### 4. Cloud Infrastructure Assets
- **Docker & Nginx:** Added [`frontend/Dockerfile`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Yinglima_ERP/frontend/Dockerfile) and [`frontend/nginx.conf`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Yinglima_ERP/frontend/nginx.conf) with SPA fallback rewrites and asset caching.
- **Render Blueprint:** Added [`render.yaml`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Yinglima_ERP/render.yaml) for 1-click Render web service and static site provisioning.
- **Dynamic Port Binding:** Updated [`backend/Dockerfile`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Yinglima_ERP/backend/Dockerfile) to dynamically bind to `${PORT:-8001}`.
- **Compose Orchestration:** Added [`docker-compose.prod.yml`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Yinglima_ERP/docker-compose.prod.yml).

---

## [Release 2026-10-03] — Machine Identifiers & Dynamic Company Branding from ERP Settings

### 1. Backend Machine Identifiers (`erp-01` and `erp-02`)
- **Machine Identification Contract:** Added `ERP_INSTANCE_ID = "erp-02"` in [`config.py`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Yinglima_ERP/backend/app/core/config.py) for backend routing, heartbeat checks, and machine-to-machine federation.
- **Public Branding Endpoint (`GET /organizations/public`):** Added in [`organizations/routes.py`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Yinglima_ERP/backend/app/organizations/routes.py) returning `{ company_name, legal_name, logo_url, erp_id }` unauthenticated.

### 2. Dynamic Human-Facing Branding from ERP Settings
- **Dynamic Brand Resolver:** Updated [`brand.ts`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Yinglima_ERP/frontend/src/lib/brand.ts) and [`nav.ts`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Yinglima_ERP/frontend/src/lib/nav.ts) to default to generic `"ERP"` and dynamically resolve the active company name from `GET /organizations/public`, persisting to `localStorage` (`erp_org_company_name`) for 0ms flicker-free hydration.
- **Dynamic Forms & Portals:**
  - [`PublicSupplierQuotePage.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Yinglima_ERP/frontend/src/pages/PublicSupplierQuotePage.tsx): RFQ title and footer dynamically display the resolved organization name.
  - [`SaleProcessForm.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Yinglima_ERP/frontend/src/pages/sales/SaleProcessForm.tsx): Organization name state defaults to `getCachedBrandName()`.
  - [`Users.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Yinglima_ERP/frontend/src/pages/Users.tsx): Replaced static naming with generic subtitle.
- **Cross-ERP Switcher:** Updated [`EcosystemSwitcher.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Yinglima_ERP/frontend/src/components/EcosystemSwitcher.tsx) and [`ssoBridge.ts`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Yinglima_ERP/frontend/src/lib/ssoBridge.ts) to dynamically resolve peer ERP company names from peer `/organizations/public` endpoints.
- **Automated Regression Suite:** Added [`brandResolution.test.ts`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Yinglima_ERP/frontend/src/lib/__tests__/brandResolution.test.ts).

---

## [Release 2026-09-30] — Dual-Mode Master Import & Safe Update Engine

### 1. Dual-Mode Excel/CSV Import ("Add New" vs "Update Existing")
- **Interactive Action Switcher (`ImportWizard.tsx`, `MasterPage.tsx`):**
  - **➕ Add New Records Only (Create):** Strictly inserts new records; skips matching entries to prevent accidental duplicates.
  - **✏️ Update / Modify Existing Records (Safe Enrichment):** Matches existing records by unique code or name and updates filled columns.
  - **Zero Data Loss Guarantee:** Empty or blank cells in the uploaded spreadsheet are completely ignored and will **never** overwrite or erase existing database values.
- **Full Masters Coverage:** Enabled across Product Master (`/masters/products`) and all System Masters (`uom`, `currencies`, `countries`, `states`, `cities`, `brands`, `hsn`, `product-categories`, `product-sub-categories`, `buyer-types`, `supplier-types`, `company-list`).
- **Automated Verification Suite:** Verified via [`tests/test_dual_mode_master_import.py`](file:///d:/Om%20work1/ERP/Yinglima_ERP/backend/tests/test_dual_mode_master_import.py) with 100% pass rate.

---

## [Release 2026-09-29] — Supplier Multi-Media Links, Company Autocomplete & Gallery Fixes

### 1. Supplier Multi-Media & Inspection Links (`visit_media`)
- **File Added:** `VideoTagInput` in [`Yinglima_ERP/frontend/src/components/fields.tsx`](file:///d:/Om%20work1/ERP/Yinglima_ERP/frontend/src/components/fields.tsx) integrated into [`Suppliers.tsx`](file:///d:/Om%20work1/ERP/Yinglima_ERP/frontend/src/pages/Suppliers.tsx).
- Supports multiple links (comma/Enter separated) with smart icon pills (YouTube `▶️`, Google Drive `📁`, OneDrive `📂`, Video `🎥`).
- Clickable pills open directly in a new tab (`target="_blank"`).

### 2. Company Name Typeahead, Suggestion & Enter Key Support
- Enhanced [`SearchableDropdown.tsx`](file:///d:/Om%20work1/ERP/Yinglima_ERP/frontend/src/components/SearchableDropdown.tsx) with `sublabel` support to show supplier types (`manufacturer`, `dealer / trader`) next to suggestions.
- Suggestions cleanly grouped under `EXISTING SIMILAR SUPPLIERS`.
- Dynamic `Use "<Typed>" (New)` option with `↵ Enter` keyboard badge.
- Full keyboard navigation: pressing `Enter` or clicking immediately accepts custom name and closes dropdown.
- Exact duplicate prevention (`⛔ Supplier already exists`) strictly enforced.

### 3. Product Gallery & Media Deletion Persistence
- Fixed photo deletion persistence in PostgreSQL without cascade or reference validation errors.
- Added image error fallbacks for unavailable cloud storage.

---

## [Release 2026-09-29] — Global Autocomplete Blocker & Ecosystem Form Hardening

### 1. Global Autocomplete & Autofill Blocker System
- **File Added:** [`Yinglima_ERP/frontend/src/lib/autocompleteBlocker.ts`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Yinglima_ERP/frontend/src/lib/autocompleteBlocker.ts).
- **Core Functionality:**
  - Automated continuous DOM `MutationObserver` on `document.body` detecting all newly mounted forms and inputs.
  - Automatically injects `autocomplete="off"`, `autocapitalize="off"`, `spellcheck="false"`, `data-lpignore="true"` (LastPass disabler), and `data-form-type="other"` (1Password/Bitwarden heuristic disabler).
  - Implemented document-level capture-phase `focusin` event interceptor to guarantee suppression attributes are active prior to browser suggestions rendering.
- **Root Initialization:** Connected to application lifecycle in [`Yinglima_ERP/frontend/src/App.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Yinglima_ERP/frontend/src/App.tsx).

### 2. Wheel Scroll Lockout & Spin-Button Elimination
- Preserved existing passive wheel blur listener and CSS spin-button suppression, ensuring alignment across all 3 ERP frontends.

---

## [Release 2026-09-26] — Spoke Deprovisioning & Ecosystem Switcher Synchronization

### 1. Internal Deprovisioning Endpoint
- **File Added:** [`Yinglima_ERP/backend/app/api/v1/internal_users.py`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Yinglima_ERP/backend/app/api/v1/internal_users.py).
- Implemented `POST /api/v1/internal/users/{id}/deprovision` to revoke active sessions and set `deleted_at = NOW()`, `is_active = False`.
- Added soft-delete filtering in `UserRepository.search()` to ensure deprovisioned users disappear from `/users`.

### 2. Spoke User Management Cleanup
- Removed local password reset and forced logout buttons from spoke UI, centralizing user governance in `ERP_Main`.

### 3. Proactive Ecosystem Session Sync & SSO Identity Preservation
- Updated topbar `EcosystemSwitcher.tsx` to call `establishCentralEcosystemSession` on mount, ensuring newly assigned permissions reflect without full re-login.
- Updated `ssoBridge.ts` to read `Auth.getProfile()?.email` and `first_name` so switching users switch under their own identity without falling back to admin.

---

## [Prior Releases] — Core Procurement & Planning Engine
- **Inbound IMAP Poller & AI Extractor:** Bidirectional mailbox poller inspecting `INBOX` and `[Gmail]/Sent Mail`. First supplier reply triggers GPT extraction; subsequent replies bypass AI for zero wasted API costs.
- **Master Shipment Planning Sheets:** Dynamic spreadsheet grid with automated CBM optimization for 20GP, 40GP, 40HQ, and 45HQ shipping containers.
- **Supabase Media Storage:** Cloud persistent storage for supplier visit photos and quotation attachments.
