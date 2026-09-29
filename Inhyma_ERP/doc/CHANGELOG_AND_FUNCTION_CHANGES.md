# Inhyma_ERP — Changelog & Function Changes History

**System:** Inhyma_ERP (India Distribution)  
**Scope:** Functional updates, schema migrations, UI hardening, and bug fixes.

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
  - Added dedicated cascading tests in [`LeadsPage.test.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/pages/__tests__/LeadsPage.test.tsx) and [`CompaniesCascadingAddress.test.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/pages/__tests__/CompaniesCascadingAddress.test.tsx). Full test suite (338/338 tests across 44 files) passing 100% green.

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
