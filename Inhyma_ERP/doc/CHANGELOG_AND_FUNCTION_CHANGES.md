# Inhyma_ERP — Changelog & Function Changes History

**System:** Inhyma_ERP (India Distribution)  
**Scope:** Functional updates, schema migrations, UI hardening, and bug fixes.

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
