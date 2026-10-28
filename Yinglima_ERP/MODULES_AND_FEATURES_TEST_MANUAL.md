# Enterprise ERP — Complete Modules, Features & Testing Specification Manual



> **Document Type:** Master Regression Testing Specification & Feature Catalog  

> **Location:** Root Workspace (`/MODULES_AND_FEATURES_TEST_MANUAL.md`)  

> **Purpose:** Exhaustive reference catalog detailing every single module, page layout, table column, action button, modal window, drawer, form tab, and form field across the entire ERP. Designed for developers, QA testers, and autonomous AI agents to execute manual and automated regression tests before and after code changes.  

> **Strict Policy:** When developing or modifying features, no existing module, form, or field listed in this document may be removed, broken, or regressed.  

> **Last Updated:** September 16, 2026 (Added End-to-End Granular RBAC Permissions for Inquiries, Product Prices & Local Purchases) (Synchronized with Version 1.1.0 & Local Purchases Domestic Procurement Engine, Universal Live Duplicate Blockers & 100% Fluid Layout Standard)



---



## Table of Contents



1. [Executive Testing Principles & Rules of Engagement](#1-executive-testing-principles--rules-of-engagement)

2. [Master Navigation Sitemap](#2-master-navigation-sitemap)

3. [DASHBOARD Module](#3-dashboard-module)

4. [CONTACT: Suppliers Module](#4-contact-suppliers-module)

5. [CONTACT: Buyers Module](#5-contact-buyers-module)

6. [INVENTORY: Product Master Module](#6-inventory-product-master-module)

7. [INVENTORY: Product Gallery Module](#7-inventory-product-gallery-module)

7.1. [INVENTORY: Product Price Directory Module](#71-inventory-product-price-directory-module)

7.2. [INVENTORY: Stock Movement (Inward & Outward Register & Live Inventory Ledger)](#72-inventory-stock-movement-inward--outward-register--live-inventory-ledger)

8. [INVENTORY: Categories Master Module](#8-inventory-categories-master-module)

9. [INVENTORY: Sub Categories Master Module](#9-inventory-sub-categories-master-module)

10. [INVENTORY: Brands Master Module](#10-inventory-brands-master-module)

11. [INVENTORY: Supplier Types Master Module](#11-inventory-supplier-types-master-module)

12. [INVENTORY: Buyer Types Master Module](#12-inventory-buyer-types-master-module)

12.1. [PURCHASE: Local Purchase Module](#121-purchase-local-purchase-module)

13. [SALE: Inquiries & Proforma Workflow Module](#13-sale-inquiries--proforma-workflow-module)

13.1. [SALE: Sale Process Order Management & Official Export Trade Documents Module](#131-sale-sale-process-order-management--official-export-trade-documents-module)

14. [PLANNING: Master Shipment Planning Grid Module](#14-planning-master-shipment-planning-grid-module)

15. [USER MANAGEMENT: Users Module](#15-user-management-users-module)

16. [USER MANAGEMENT: Departments & Permissions (RBAC) Module](#16-user-management-departments--permissions-rbac-module)

17. [CONFIGURATIONS: HSN Codes Master Module](#17-configurations-hsn-codes-master-module)

18. [CONFIGURATIONS: Geography Masters (Countries, Provinces, Cities)](#18-configurations-geography-masters-countries-provinces-cities)

19. [CONFIGURATIONS: Currencies Master Module](#19-configurations-currencies-master-module)

20. [CONFIGURATIONS: Units of Measurement (UOM) Master Module](#20-configurations-units-of-measurement-uom-master-module)

21. [CONFIGURATIONS: Organization Settings & Company List](#21-configurations-organization-settings--company-list)

22. [GOVERNANCE: Audit Log Module](#22-governance-audit-log-module)

23. [GOVERNANCE: Trash & Recovery (Recycle Bin) Module](#23-governance-trash--recovery-recycle-bin-module)

24. [USER ACCOUNT: Profile, Security & Active Sessions](#24-user-account-profile-security--active-sessions)

25. [AUTHENTICATION: Login & Session Recovery](#25-authentication-login--session-recovery)

26. [EXTERNAL PORTAL: Public Supplier Quotation Submission Portal](#26-external-portal-public-supplier-quotation-submission-portal)

27. [TOPBAR: Universal Search & Record Deep-Linking](#27-topbar-universal-search--record-deep-linking)

28. [USER MANAGEMENT: Unified Person & Workforce Architecture (Employee-to-User Merge)](#28-user-management-unified-person--workforce-architecture-employee-to-user-merge)

29. [USER MANAGEMENT: Unified Departments & Organizational Units (Department-to-Role Merge)](#29-user-management-unified-departments--organizational-units-department-to-role-merge)

30. [USER MANAGEMENT: Positions Module](#30-user-management-positions-module)

31. [USER MANAGEMENT: Organization Chart Module](#31-user-management-organization-chart-module)

32. [AI Subagent Autonomous Testing Prompt Template](#32-ai-subagent-autonomous-testing-prompt-template)
33. [Universal Import & Deduplication Test Suite (`testingimportfile/`)](#33-universal-import--deduplication-test-suite-testingimportfile)
34. [Local Purchases & Domestic Procurement Engine (`/purchase/local`)](#34-local-purchases--domestic-procurement-engine-purchaselocal)
35. [Sale Process & Export Trade Documents Engine (`/sale/process`)](#35-sale-process--export-trade-documents-engine-saleprocess)
36. [Notification & Automation Rules System (`/settings/notifications`)](#36-notification--automation-rules-system-settingsnotifications)
37. [Shipment Planning Master Grid & Formula Engine (`/planning`)](#37-shipment-planning-master-grid--formula-engine-planning)
38. [Stock Movement (Inward & Outward Register & Live Inventory Ledger) (`/inventory/stock-movements`)](#38-stock-movement-inward--outward-register--live-inventory-ledger-inventorystock-movements)
39. [Multi-Tier Planning & Sales Hierarchy Extraction Engine (`/sale/process/new`)](#39-multi-tier-planning--sales-hierarchy-extraction-engine-saleprocessnew)
40. [Module-by-Module RBAC & Dynamic Permission Enforcement (Part 1)](#40-module-by-module-rbac--dynamic-permission-enforcement-part-1)
41. [Cross-ERP Product Master Lifecycle & Inactivation Synchronization (`/masters/products`)](#41-cross-erp-product-master-lifecycle--inactivation-synchronization-mastersproducts)
42. [MULTI-ERP FEDERATION: Ecosystem SSO Bridge, Canonical Keys & Dynamic Registry Routing](#42-multi-erp-federation-ecosystem-sso-bridge-canonical-keys--dynamic-registry-routing)



---



## 1. Executive Testing Principles & Rules of Engagement



1. **Zero Feature Loss Guarantee**: Whenever AI or human engineers add or edit code, this checklist must be tested to ensure existing buttons, fields, validation rules, popovers, and drawers continue to render and function.

2. **Form Completeness**: Every form must retain all specified fields, dropdown data loaders, maskings (e.g. phone country codes), and conditional locks (e.g. 1-way status lock from `New` $\rightarrow$ `Existing`).

3. **Data Integrity**: Soft-deletion must always move records to Trash (`/trash`) and never physically purge rows from active tables.

4. **Optimistic Locking & Concurrency**: Modifying entities must send and check `version` increments to avoid dirty concurrent overwrites.

5. **Universal Fluid Responsive Auto-Fit**: All top-level page views, tables, cards, and drawers must use 100% fluid auto-fit layouts (`width: 100%`, `max-width: 100%`, `box-sizing: border-box`). When browser zoom is zoomed out (50%, 67%, 80%) or zoomed in (110%, 125%, 150%), the entire screen width is utilized edge-to-edge with zero dead white space on the sides and seamless responsive column expansion.

6. **Unified In-App Confirmation Modal Standard**: All destructive actions (delete product items, quotations, invoices, sales orders, master records, media, sheets, columns, or permanent trash purge) must use the application's unified in-app confirmation modal (`frontend/src/lib/confirm.tsx`). Native browser `window.confirm()` or unstyled popup dialogs are strictly prohibited across all modules.



---



## 2. Master Navigation Sitemap



| Sidebar Section | Navigation Label | Sub-Menu / Type | Route Path | Active Key | Icon Key | Required Permission |

| :--- | :--- | :--- | :--- | :--- | :--- | :--- |

| **DASHBOARD** | Dashboard | Direct | `/dashboard` | `dashboard` | `dashboard` | Public Authenticated |

| **CONTACT** | Suppliers | Direct | `/suppliers` | `suppliers` | `factory` | `supplier.view` |

| **CONTACT** | Buyers | Direct | `/buyers` | `buyers` | `shoppingBag` | `buyer.view` |

| **INVENTORY** | Product Master | Direct | `/masters/products` | `masters-products` | `box` | `product.view` |

| **INVENTORY** | Product Prices | Direct | `/inventory/product-prices` | `product-prices` | `coins` | `product.view` |

| **INVENTORY** | Product Gallery | Direct | `/product-gallery` | `product-gallery` | `image` | `productgallery.view` |

| **INVENTORY** | Stock Movement | Direct | `/inventory/stock-movements` | `stock-movement` | `truck` | Public Authenticated |

| **PURCHASE** | Local Purchase | Direct | `/purchase/local` | `local-purchases` | `shoppingCart` | `purchase.view` |

| **SALE** | Inquiries | Direct | `/inquiries` | `inquiries` | `fileText` | Public Authenticated / `inquiry.view` |

| **PLANNING** | Shipment Planning | Direct | `/planning` | `planning` | `truck` | `planning.view` |

| **USER MANAGEMENT** | Users | Direct | `/users` | `users` | `user` | `user.view` |

| **USER MANAGEMENT** | Positions | Direct | `/positions` | `positions` | `briefcase` | `position.view` |

| **USER MANAGEMENT** | Departments & Permissions | Direct | `/rbac` | `rbac` | `shield` | `roles_permissions.view` |

| **SETTINGS** | **Masters ▾** | **Accordion Parent** | *(Collapsible)* | `masters-group` | `masters` | Dynamic based on children |

| *SETTINGS / Masters* | Cities | Sub-Item | `/masters/cities` | `masters-cities` | — | `city.view` |

| *SETTINGS / Masters* | Provinces | Sub-Item | `/masters/states` | `masters-states` | — | `state.view` |

| *SETTINGS / Masters* | Countries | Sub-Item | `/masters/countries` | `masters-countries` | — | `country.view` |

| *SETTINGS / Masters* | Currencies | Sub-Item | `/masters/currencies` | `masters-currencies` | — | `currency.view` |

| *SETTINGS / Masters* | Units of Measurement | Sub-Item | `/masters/uom` | `masters-uom` | — | `uom.view` |

| *SETTINGS / Masters* | HSN Codes | Sub-Item | `/masters/hsn` | `masters-hsn` | — | `hsn.view` |

| *SETTINGS / Masters* | Categories | Sub-Item | `/masters/categories` | `masters-categories` | — | `category.view` |

| *SETTINGS / Masters* | Sub Categories | Sub-Item | `/masters/subcategories` | `masters-subcategories` | — | `subcategory.view` |

| *SETTINGS / Masters* | Brands | Sub-Item | `/masters/brands` | `masters-brands` | — | `brand.view` |

| *SETTINGS / Masters* | Supplier Types | Sub-Item | `/masters/supplier-types` | `masters-supplier-types` | — | `suppliertype.view` |

| *SETTINGS / Masters* | Buyer Types | Sub-Item | `/masters/buyer-types` | `masters-buyer-types` | — | `buyertype.view` |

| *SETTINGS / Masters* | Organization List | Sub-Item | `/masters/company-list` | `masters-company-list` | — | `organizationlist.view` |

| **SETTINGS** | Organization Settings | Direct | `/organization` | `organization` | `settings` | `organization.manage` |

| **SETTINGS** | Audit Log | Direct | `/audit` | `audit` | `clock` | `audit.view` |

| **SETTINGS** | Trash | Direct | `/trash` | `trash` | `trash` | `trash.view` |



### Sidebar Accordion Navigation Test Checklist

- [ ] Verify `Masters ▾` renders in the `SETTINGS` group with a right-chevron `>` and person-plus icon.

- [ ] Verify clicking `Masters` smoothly expands all 12 nested master links, rotating chevron to `∨`.

- [ ] Verify clicking on any master sub-item (e.g., `Cities`) routes correctly and renders that master page.

- [ ] Verify active master sub-item displays highlighted background (`#e0edff`) and bold `#0061f2` text.

- [ ] Verify the parent `Masters` item retains `.active-parent` blue styling while any child is active.

- [ ] Verify reloading the page or deep-linking to any master page (e.g., `/masters/hsn`) automatically keeps `Masters` expanded on load.

- [ ] Verify collapsing the entire sidebar via `≡` hides sub-items cleanly and uncollapses when `Masters` icon is clicked.

- [ ] Verify `Product Master`, `Product Gallery`, `Suppliers`, `Buyers`, and `Inquiries` remain directly visible as primary top-level menu items.





---



## 3. DASHBOARD Module



- **Route:** `/dashboard`

- **Purpose:** Primary landing screen upon successful login.



### Visual Elements & Layout

1. **Top Greeting:** `Welcome To {User Full Name / Username}` (e.g. `Welcome To Rupesh Malla` or `Welcome To Admin`).

2. **Top Navigation Bar:**

   - Universal Global Search Input: `Search entire ERP (e.g. company, users, products...)`

   - Notification Bell Icon (`🔔`)

   - User Profile Badge with initials (e.g. `AD Admin ⌵`) displaying dropdown with:

     - 👤 **My Profile** (`/profile`)

     - ⚙️ **Organization Settings** (`/organization`)

     - 🚪 **Logout** (`POST /api/v1/auth/logout` $\rightarrow$ redirects to `/login`)



### Test Cases

- [ ] Verify logging in redirects directly to `/dashboard`.

- [ ] Verify the user's name is dynamically extracted from `authContext` and displayed in the heading.

- [ ] Verify clicking the profile menu and selecting "My Profile" navigates to `/profile`.

- [ ] Verify clicking "Logout" clears session tokens and redirects to `/login`.



---



## 4. CONTACT: Suppliers Module



- **Route:** `/suppliers`

- **Purpose:** Comprehensive vendor directory, sourcing management, factory visit logs, and public quote token dispatching.



### 4.1. Screen Layout & Header Actions

1. **Breadcrumb:** `Dashboard / Supplier Profiles`

2. **Page Title & Subtitle:** `Supplier Profiles — Supplier directory, contacts, product categories, and sourcing status.`

3. **Top Action Buttons:**

   - 🔍 **Filter Button (Funnel Icon):** Toggles advanced filter drawer.

   - ⚡ **`+ QUICK ADD` Button:** Opens lightweight creation modal.

   - ➕ **`+ ADD NEW` Button:** Opens full multi-tab supplier profile creation modal.

   - 📥 **`Imp / Exp ⌵` Dropdown:**

     - `Import Excel / CSV` (opens Import Wizard)

     - `Download Sample Template` (downloads `suppliers_sample.csv`)

     - `Export Filtered Data` (downloads `.csv` of current query)

   - ⚡ **`Bulk Actions ⌵` Dropdown:**

     - `Activate Selected`

     - `Deactivate Selected`

     - `Delete Selected` (soft-deletes selected rows with confirmation prompt)

4. **Tabs:**

   - **Active Tab:** Displays active vendors (`is_active = true`).
   - **Inactive Tab:** Displays deactivated vendors (`is_active = false`).
   - **Test Verification — Cache Isolation on Tab Switch:**
     - Navigate to `/suppliers` (Active Tab displays all active vendors, e.g. 44 records).
     - Click **Inactive** tab. Verify the table clears immediately (`setRows([])`), requests `?is_active=false`, and renders strictly inactive suppliers (e.g. `LT1`, 1 record). Verify active vendors do NOT linger or display on the Inactive tab.
     - Click back to **Active** tab. Verify the table returns to displaying active vendors.
   - **Test Verification — Universal Active-Only Dropdowns:**
     - Verify downstream dropdowns across `/purchases/local`, `/sales/process`, `/inquiries`, `/planning`, and `/inventory/product-prices` strictly fetch and render active records (`status=active` / `is_active=true`). Deactivated suppliers or buyers must never be selectable for new transactions.

5. **Toolbar Row:**

   - **Items/Page Dropdown:** `10`, `25`, `50`, `100`, `250`.

   - **📌 Freeze Columns Button:** Opens column pin popover menu (Left / Right / Unpin).

   - **Search Input:** `Search company, country, contact, city, phone...` (live debounced search with `✕` clear button, and numeric Sr. No. jump support).
     - **Test Verification — Phone Number Formats:**
       - Search raw unformatted phone digits (e.g. `9561914519` or `+919561914519` or `13800138000`). Verify that suppliers matching formatted numbers (e.g. `+91 9561914519`, `+86 138-0013-8000`) are immediately returned.
       - Verify secondary contact phone numbers and WeChat IDs in `supplier_contacts` match correctly.
     - **Test Verification — Geography & City Matching:**
       - Search city name (e.g. `Wenzhou`, `Foshan`) or country name (`China`). Verify all matching suppliers are returned.
     - **Test Verification — Contacts & Products:**
       - Search secondary contact name (e.g. `Chen Wei`, `Prathamesh Bangar`) or product code. Verify matching suppliers display.



### 4.2. Suppliers Table Columns

1. **Checkbox Column:** Select all / select individual rows.

2. **SR. NO.:** Sequential row index with sorting indicator.

3. **COMPANY NAME:** Clickable company title opening the Detail Side Drawer.

4. **PRODUCT CATEGORY:** Category badge with `+N` expander popover.

5. **KEY STRENGTH SUB-CATEGORY:** Sub-category badges with popover.

6. **PRODUCTS SUPPLIED:** Linked product names with popover.

7. **SECONDARY PRODUCTS:** Truncated text cell with view popover.

8. **COUNTRY:** Country name.

9. **STATE / PROVINCE:** Province / State name.

10. **CITY:** City name.

11. **SUPPLIER TYPE:** Manufacturer, Trader, Wholesaler, Agent badge.

12. **CURRENT STATUS:** `New` / `Existing` status badge (inline editable if permitted).

13. **SUPPLIER GRADE:** `A` / `B` / `C` / `Premium` (inline editable dropdown).

14. **POTENTIAL:** `Yes` / `No` / `High` / `Medium` (inline editable dropdown).

15. **ACTIONS:**

    - 👁️ **View / Detail Drawer**

    - ✏️ **Edit Supplier**

    - 🔗 **Copy Public Quote Portal Link**

    - 🗑️ **Delete Supplier** (Soft-delete protected if Status is `Existing` or Potential is `Yes`)



---



### 4.3. Suppliers "+ QUICK ADD" Modal

Opens a focused single-screen modal for rapid vendor entry.



#### Fields in Quick Add Form:

| Field Label | Field Name | Type | Options / Source | Mandatory | Default / Notes |

| :--- | :--- | :--- | :--- | :--- | :--- |

| **Company Name** | `company_name` | Text / Typeahead | — | **YES** | Auto Title-cased; typeahead substring suggestions, instant red warning banner on duplicate match, strict hard-stop submission blocker |

| **Product Category** | `category_ids` | Multi-Select Dropdown | `/masters/product-categories` | No | Searchable multi-panel with checkboxes |

| **Key Strength Sub-Category** | `sub_category_ids` | Multi-Select Dropdown | `/masters/product-sub-categories` | No | Dynamically filtered by chosen Category |

| **Products Supplied** | `product_ids` | Multi-Select Dropdown | `/masters/products` | No | Searchable multi-panel linking products directly to supplier |

| **Country** | `country_id` | Select Dropdown | `/masters/countries` | **YES** | Defaults to **China** (`+86`) |

| **State / Province** | `state_id` | Select Dropdown | `/masters/states` | **YES** | Scoped to Country; supports custom text typing |

| **City** | `city_id` | Select Dropdown | `/masters/cities` | **YES** | Scoped to State; supports custom text typing |

| **Contact Person Name** | `contact_full_name` | Text | — | No | Primary representative |

| **Designation** | `contact_designation` | Text | — | No | e.g. Sales Manager, CEO |

| **Calling Number** | `contact_calling_number`| Phone with Country Code | Auto country prefix | No | Validates 7–15 digits |

| **WhatsApp Number** | `contact_whatsapp_number`| Phone with Country Code| "Same as Calling" checkbox | No | Auto-copies from Calling Number |

| **WeChat Number** | `contact_wechat_number` | Text | "Same as Calling" checkbox | No | WeChat ID / phone |

| **Email(s)** | `emails` | Tag / Multi-Email Input | — | No | Enter email + press Enter or comma |

| **Supplier Type** | `supplier_type` | Select Dropdown | `/masters/supplier-types` | No | Manufacturer / Trader / etc. |

| **Current Status** | `current_status` | Select Dropdown | `New`, `Existing` | No | Defaults to `New` |



- **Actions:** `Cancel`, `Save Supplier`, `Save & Open Full Profile`.



---



### 4.4. Suppliers "+ ADD NEW" / Full Edit Modal

Multi-tab comprehensive modal for vendor master lifecycle.



#### Tab 1: 👤 First Data Form (Basic Profile)

- **Company Name** (*Required*): Searchable dropdown with typeahead suggestions + strict global company name uniqueness (independent of city) and hard-stop blocker preventing duplicate saves.

- **Product Category (multiple)**: Multi-select searchable panel from Product Categories Master.

- **Key Strength Sub-Category (multiple)**: Multi-select searchable panel from Sub-Categories Master.

- **Products Supplied (multiple)**: Multi-select searchable panel with typeahead directly linking products from Product Master.

- **Brand / Factory Description**: Text Area for capabilities, factory size, machinery.

- **Supplier Type**: Dropdown from Supplier Types Master.

- **Geography Selection**:

  - **Country** (*Required*): Dropdown (loads country dial code).

  - **State / Province** (*Required*): Scoped dropdown + custom input toggle.

  - **City** (*Required*): Scoped dropdown + custom input toggle.

  - **Town / Industrial Zone**: Specific industrial area or town name.

  - **Address**: Detailed factory / office street address.

- **Websites**:

  - **Primary Website**: Validated URL field.

  - **Secondary Website / Alibaba Store**: Validated URL field.

- **Tax Identification**:

  - **Tax ID / GST / Unified Social Credit Code**: Vendor business registration code.

- **Sourcing & Pipeline Metrics**:

  - **Current Status**: `New` vs `Existing` (1-way lock: cannot revert from `Existing` to `New`).

  - **Supplier Grade**: `Grade A`, `Grade B`, `Grade C`, `Premium`.

  - **Potential**: `Yes` vs `No`.

  - **Potential Reason**: Explanatory text area if Potential is selected.

- **Factory / Office Visit Record**:

  - **Visited Factory / Office**: Radio/Select `Yes` / `No`.

  - **Visit Remarks**: Notes from physical plant inspection.

  - **Visit Photos / Media Upload**: Multi-file uploader supporting **Supabase Storage** (`supplier-media` bucket) with local disk fallback (`uploads/suppliers/`) served statically by FastAPI (`/uploads/suppliers/`), complete with preview thumbnails and delete action.

  - **Visit Video URL**: Link to factory inspection video (YouTube, Youku, Cloud Storage).

- **Overall Remarks**: General procurement notes.



#### Tab 2: 📇 Contacts Sub-Panel

Manage complete vendor team directory:

- **`+ Add New` Button**: Opens portal-mounted right-side drawer modal (`createPortal` to `document.body` with `backdropFadeIn` and `slideInRight` smooth animations, `useBodyScrollLock`, and `Esc` key listener) with:

  - **Salutation**: `Mr`, `Mr.`, `Mrs.`, `Ms.`

  - **Person Name** (*Required*): Full name with auto-focus and native validation.

  - **Set as Primary Contact**: Checkbox card (`★ Set as Primary Contact (Reflects into Supplier Profile)`). Automatically checked for the supplier's first contact or when Profile contact details are unset.

  - **Designation**: Role / title.

  - **Handling Territory**: e.g., local, Export India, Export Africa, Export Global.

  - **Calling Number**: Phone input with country dial code prefix indicator.

  - **WhatsApp Number**: With "Same As Calling" sync checkbox.

  - **WeChat ID / Number**: With "Same As Calling" sync checkbox.

  - **Email Address**: Direct email.

  - **Country**: Country dropdown with automatic dial code resolution.

  - **Footer Actions**: Pinned `Cancel` and full-width `Submit` button properly bound to form ID.

- **Two-Way Profile Synchronization Engine:**

  - Adding or editing a primary contact immediately synchronizes with the `Profile` tab's `Primary Contact Information` section (`contact_full_name`, `contact_designation`, `contact_calling_number`, `contact_whatsapp_number`, `contact_wechat_number`, and `emails`).

  - Switching back to the Profile tab shows the updated contact details immediately with zero latency.

  - If a supplier previously had contacts in `supplier_contacts` but empty profile fields, opening the edit modal automatically hydrates the Profile form from the primary contact.

- **Contacts Table**:

  - **Primary Badge**: Displays prominent blue `★ Primary` badge on the designated primary contact. Secondary contacts display `Secondary`.

  - **★ Make Primary Action**: Secondary contacts feature a 1-click `★ Make Primary` button. Clicking promotes that contact to primary, demotes previous primary, updates the backend `Supplier` row, and syncs the Profile tab and list table in real time.

  - **Delete Guard**: Primary contact is protected from direct deletion (`Delete` button hidden/blocked with ConflictException protection); users must designate another contact as primary first before deleting.

  - **Actions**: `★ Make Primary` (for secondary), `✏️ Edit`, and `🗑️ Delete` (for secondary).



#### Tab 3: 📦 Products & Categories

- **Product Categories**: Multi-select panel.

- **Key Strength Sub-Categories**: Multi-select panel scoped to categories.

- **Products Supplied**: Multi-select product picker.

- **Secondary Products Description**: Text area for custom/ancillary items.



### 4.5. Supplier Detail Side Drawer

- **Header:** Company name, status badge, grade badge, potential badge, and public quote share link.

- **Sections:** Identity, Geography, Contact Persons Grid, Sourcing Status, Factory Visit Photos Gallery, Notes.



### Test Cases

- [ ] Open `/suppliers` and confirm active list loads.

- [ ] Click `+ QUICK ADD`, fill Company Name, Country, State, City and save. Verify record appears in table.

- [ ] Click `+ ADD NEW`, navigate all 3 tabs, upload factory visit photo, add contact person, and save.

- [ ] Test Country Dial Code Auto-Update: Change Country (e.g. China -> India) and verify Calling Number, WhatsApp Number, and WeChat Number dialing codes automatically update (e.g. `+86` -> `+91`) while resetting Province/City dropdowns.

- [ ] Test Strict Duplicate Company Name Blocker: Enter an existing supplier name (e.g. "Test 55"). Verify live red alert banner (⛔) appears beneath field. Click Save and verify submission is strictly blocked, focusing the input field. Verify backend rejects duplicate creates/renames with HTTP 409 Conflict.

- [ ] Test 1-Way Status Lock: Change status to `Existing`, save, edit again and verify `New` cannot be chosen.

- [ ] Verify Active vs. Inactive Tabs & Filter Parity: Confirm default `/suppliers` view displays only active suppliers (44). Confirm clicking the "Inactive Suppliers" tab displays inactive vendors (e.g. `LT1`). Verify `GET /api/v1/suppliers?status=active` returns only active vendors.

- [ ] Test Lightweight Dropdown Lookup (`/api/v1/suppliers/lookup`): Verify `GET /api/v1/suppliers/lookup` returns ultra-lean `{ id, company_name, brand_description, supplier_type }` (~4.4 KB) with zero inactive vendors. In Local Purchase creation (`/purchases/local/new`), confirm supplier combobox lists all active suppliers instantly without displaying inactive vendors (`LT1`).

- [ ] Verify soft-delete moves vendor to `/trash`.



---



## 5. CONTACT: Buyers Module



- **Route:** `/buyers`

- **Purpose:** Client/buyer directory, multi-contact management, credit limits, addresses, and inquiry linkage.



### 5.1. Screen Layout & Header Actions

1. **Breadcrumb:** `Dashboard / Buyer (Client) Profiles`

2. **Header Actions:**

   - 🔍 **Filter Button (Funnel Icon):** Advanced filter drawer.

   - ➕ **`+ ADD BUYER` Button:** Opens buyer creation modal.

   - 📥 **`Imp / Exp ⌵` Dropdown:** Import CSV/XLSX, Download Sample Template, Export Filtered CSV.

   - ⚡ **`Bulk Actions ⌵` Dropdown:** Bulk Activate, Bulk Deactivate, Bulk Delete.

3. **Tabs:** `Active` vs `Inactive`.

4. **Toolbar:** Items/Page (`10`, `25`, `50`, `100`, `250`), 📌 Freeze Columns popover, Live Search Input.



### 5.2. Buyers Table Columns

1. **Checkbox:** Select row.

2. **SR. NO.:** Row counter with sort.

3. **COMPANY NAME:** Clickable title opening Buyer Detail Side Drawer.

4. **BUYER TYPE:** Dynamic type badge from Buyer Types master (e.g. End User, Trader, Distributor).

5. **PRODUCT CATEGORIES:** Category badge with `+N` expander popover.

6. **PRODUCT SUB CATEGORIES:** Sub-category badges with popover.

7. **COUNTRY:** Country name.

8. **CITY:** City name.

9. **CURRENT STATUS:** `New` / `Existing` (1-way status lock).

10. **BUYER GRADE:** `A`, `B`, `C`, `Premium`.

11. **POTENTIAL:** `Yes` / `No`.

12. **PRIMARY CONTACT:** Name & Phone.

13. **ACTIONS:** View Drawer (`👁️`), Edit (`✏️`), Delete (`🗑️`).



### 5.3. Buyers "+ ADD BUYER" / Edit Modal

#### Tab 1: 👤 Profile (Basic Info & Pipeline)

- **Company Name** (*Required*): Auto title-cased + duplicate alert checking.

- **Buyer Type**: Dropdown from `/masters/buyer-types`.

- **Product Range & Interest**:

  - **Product Categories**: Searchable multi-select panel.

  - **Product Sub Categories**: Searchable multi-select panel.

  - **Product Range Description**: Text Area for specific machinery or commodity needs.

  - **Currently Buying From**: Competing supplier or region description.

- **Location Details**:

  - **Country** (*Required*): Dropdown selector.

  - **City**: City text/selector.

  - **Address**: Registered billing address.

- **Primary Contact Person**:

  - **Salutation**: `Mr.`, `Ms.`, `Mrs.`, `Dr.`

  - **Contact Person Name**: Full name.

  - **Designation**: Title.

  - **Calling Number**: Phone with country dial code.

  - **WhatsApp Number**: With "Same as Calling" toggle.

  - **Email(s)**: Multi-email tag input.

- **Commercial & Sourcing Attributes**:

  - **Tax ID / GST Number**: Tax registration ID.

  - **Website**: Validated URL.

  - **Current Status**: `New` vs `Existing` (1-way status lock).

  - **Buyer Grade**: `Grade A`, `Grade B`, `Grade C`, `Premium`.

  - **Potential**: `Yes` vs `No`.

  - **Potential Reason**: Explanatory remarks if Potential is active.

  - **Overall Remarks**: General business comments.



#### Tab 2: 📇 Contacts Management

- Multi-contact person manager with full CRUD: Name, Salutation, Designation, Calling Number, WhatsApp Number, Email. Auto-synced with Primary Contact.



### 5.4. Buyers Bulk Import Workspace & 3-Way Duplicate Detection

- **Import View:** Dedicated full-page import workflow modeled on Supplier Import via `Imp / Exp ⌵` -> `Import`.

- **Upload Support:** Drag-and-drop or file selector for `.xlsx`, `.xls`, and `.csv` files (up to 5,000 rows, 8 MB).

- **Template Download:** Instant `📥 Download Sample CSV Template` button generating sample with all 23 business fields matching `doc/buyerclient.txt`.

- **Wizard Modal:** 4-step wizard with auto-matched column headers, fuzzy synonyms, live preview, and chunked uploads.

- **True 3-Way Duplicate Prevention (Note 66 in `buyerclient.txt`):**

  - **In-File Duplicate Check:** Prevents duplicate company names in the same import file.

  - **Company Name Uniqueness:** Strictly enforces case-insensitive uniqueness on `Company Name` against the database even when phone numbers are empty or different.

  - **Phone Collision Detection:** Cross-checks `Calling Number` and `WhatsApp Number` against both phone fields of all existing buyers ($\ge 6$ digits, stripping non-digit characters).

  - **Real-Time Client Warnings:** Inline field warning badges display live while typing in the Add/Edit form, blocking save if any of the three vectors collides.

  - **Safe Self-Update:** `exclude_id` ensures updating an existing buyer does not trigger self-collision.



### Test Cases

- [ ] Create Buyer with Company Name, Country, Calling Number, and save.

- [ ] Attempt to create a second buyer with the same Company Name (even with different or empty phone numbers) and verify duplicate conflict is raised.

- [ ] Attempt to create a buyer with a different Company Name but the same Calling Number or WhatsApp Number as an existing buyer, and verify duplicate conflict is raised with the conflicting buyer's name.

- [ ] Attempt to use an existing buyer's Calling Number as a new buyer's WhatsApp Number, and verify cross-phone duplicate detection blocks it.

- [ ] Edit an existing buyer without changing phone/name, save, and verify `exclude_id` allows save without self-duplicate conflict.

- [ ] Verify deleting a buyer with status `Existing` or potential `Yes` is blocked by protection dialog.

- [ ] Click `Imp / Exp ⌵` -> `Import` to open the dedicated Buyer Import workspace.

- [ ] Download Sample CSV template and verify all 23 headers match `doc/buyerclient.txt`.

- [ ] Upload sample file and verify 3-way duplicate check prevents duplicate company names or phone numbers.

- [ ] Master Data Imports: Download sample CSV from each master module (Brands, Categories, Sub-Categories, Buyer Types, Supplier Types, UOM, HSN, Countries, States, Cities, Currencies, Company List), upload directly, and verify all rows import with 100% success and no header/code mismatches.



---



## 6. INVENTORY: Product Master Module



- **Route:** `/masters/products`

- **Purpose:** Centralized product catalog, dynamic specifications builder, CBM packaging calculations, photo gallery uploader, and ReportLab PDF datasheet generation.



### 6.1. Product Master Table Columns

1. **Checkbox:** Row selector.

2. **SR. NO.:** Sequential number.

3. **IMAGE:** Thumbnail preview with click-to-expand lightbox.

4. **PRODUCT CODE:** Unique SKU / Item code.

5. **PRODUCT NAME (TALLY):** Official internal accounting name.

6. **INVOICE NAME:** Commercial description used on billing documents.

7. **CATEGORY / SUB-CATEGORY:** Hierarchy badges.

8. **BRAND:** Manufacturer brand name.

9. **PRIMARY SUPPLIER:** Sourcing vendor name (auto-synced with Supplier Master & Shipment Planning).

10. **HSN / SAC:** Customs code with VAT Refund rate indicator.

11. **PRIMARY UOM:** Base unit (e.g. PCS, SET, KG).

12. **PACKAGING CBM:** Calculated volume ($L \times W \times H / 1,000,000$).

13. **STATUS:** `Active` / `Inactive` badge.

14. **ACTIONS:** View Detail Drawer, Edit Product, Download PDF Datasheet, Delete.

- **Search Verification — Product Deep Search:**
  - Search code with spaces or missing dashes (e.g. `DAR 00099` matches `DAR-00099`).
  - Search name with space variations (e.g. `GF 100` matches `GF100 Granular Filler`).
  - Search linked Category name, Sub-Category name, Brand name, HSN code, or Primary/Quoting Supplier name. Verify all matching products return immediately.



### 6.3. Add / Edit Product Form Fields

- **Basic Details:**

  - **Product Code**: Auto-generated or manual SKU.

  - **Product Name (Tally / Internal)** (*Required*): Primary product title.

  - **Product Name (Invoice / Export)**: Commercial description.

  - **Barcode / EAN / UPC**: Barcode number.

- **Classification, Sourcing & Taxonomy (Balanced 4-Column Responsive Layout):**

  - **Brand**: Dropdown from `/masters/brands`.

  - **Category** (*Required*): Dropdown from `/masters/product-categories`.

  - **Sub-Category** (*Required*): Dynamically filtered by chosen Category.

  - **Primary Supplier** (*Optional*): Sourcing vendor dropdown from `/suppliers`. Automatically synchronizes with `supplier_product_links`, establishes primary vendor assignment, and populates the `Supplier Name` and `City` columns in the Shipment Planning grid.

  - **HSN Code** (*Required*): Dropdown from `/masters/hsn` (auto-fills Refund VAT %).

  - **Refund VAT %**: Auto-filled from HSN or custom override.

  - **Organization** (*Multi-select*): Multi-tenant company ownership selector (spans 2 columns).

  - **Branches / Operating Locations**: Dependent branch selection scoped to selected organization(s).

- **Units & Conversions:**

  - **Primary Unit of Measurement (UOM)** (*Required*): Base unit.

  - **Secondary UOM**: Alternative packaging unit.

  - **Conversion Factor**: e.g., $1 \text{ BOX} = 24 \text{ PCS}$.

- **Packaging & Dimensions (CBM Engine):**

  - **Packaging Quantity**: Items per master carton.

  - **Net Weight (kg)** & **Gross Weight (kg)**.

  - **Length (cm)**, **Width (cm)**, **Height (cm)**.

  - **Packaging Unit CBM**: Auto-computed live read-only display ($L \times W \times H / 1,000,000$).

- **Commercial & Regulatory:**

  - **Color** & **Material**.

  - **Standard Purchase Cost** & **Standard Selling Price**.

  - **Minimum Order Quantity (MOQ)** & **Reorder Level**.

  - **Refund VAT %**: Auto-filled from HSN or custom override.

  - **License / Certificate Required**: Checkbox & description for regulatory certifications (e.g. CE, ISO, BIS).

  - **Is Purchasable** (`true`/`false`) & **Is Sellable** (`true`/`false`).

- **Dynamic Technical Specifications Builder:**

  - Key-Value attribute table (e.g. `Voltage: 380V`, `Power: 4.5kW`, `Speed: 120 pcs/min`).

- **Cloud Media & Photo Upload:**

  - Multi-image uploader supporting **Supabase Storage** (`product-images` bucket) with automatic local filesystem fallback (`uploads/products/`) served statically by FastAPI (`/uploads/products/`), ensuring zero broken images even in air-gapped deployments.



### 6.4. Deduplication Engine (Manual Entry & Bulk Import Parity with Supplier Master)

- **Manual Entry (`SearchableDropdown` with Substring Suggestions)**:

  - When typing into **Product Name (As per Tally)**, an autocomplete suggestion dropdown appears right below the field.

  - Searches across **any part of the name** (substring / keyword match, not just prefix, identical to Tally and Supplier Master).

  - Includes clear `✕` button to wipe text, and clicking a suggestion auto-fills the name.

- **Instant Visual Duplicate Warning for Product Name**:

  - If the entered name matches an existing product in Product Master (case-insensitive, ignoring extra spaces/hyphens, excluding current product ID if editing):

    - Shows a bold red warning directly beneath the field:  

      `⚠️ Product "[Product Name]" already exists!`

- **Instant Visual Duplicate Warning for Product Code**:

  - If the entered **Product Code** matches an existing code in Product Master:

    - Shows a bold red warning directly beneath the code field:  

      `⚠️ Product Code "[Code]" already exists (used by "[Product Name]")!`

- **Hard-Stop Form Submission Blocker**:

  - The form strictly **blocks saving** in `validateForm` and `toPayload` if either the Product Name or Product Code matches an existing record.

- **Bulk Import Duplicate Protection**:

  - **In-File Collision Check**: Rejects the file if multiple rows in the same spreadsheet have the same Product Name or Product Code (`seen_names` and `seen_codes`).

  - **Database Collision Check**: Blocks import for any row whose Product Name or Product Code already exists in the database.



### Test Cases

- [ ] Create a product, enter Length: `100`, Width: `50`, Height: `40`. Verify CBM calculates to `0.200000`.

- [ ] Select HSN code with 13% Refund VAT and confirm Refund VAT % field auto-populates with `13`.

- [ ] Create or import a product leaving Purchase VAT % and Refund VAT % blank; verify the product automatically inherits both tax rates from the selected HSN code (`HsnCode.purchase_vat_percent` and `HsnCode.refund_vat_percent`).

- [ ] Select a Primary Supplier from the dropdown, save the product, and verify the supplier's name appears in the Product Master table, detail drawer, Shipment Planning grid (`Supplier Name` & `City`), and Supplier Master ("Products Supplied").

- [ ] Verify that the Product Add/Edit form does not display the redundant `Status` select dropdown (new products default to `active`, edits preserve current status).

- [ ] Select multiple rows in Product Master table on the **Active** tab, click `Bulk Actions ⌵` -> `Bulk Inactive`:

  - Verify all selected items deactivate in a single fast batch request (`POST /api/v1/masters/products/bulk-deactivate`).

  - Verify that the deactivated rows **immediately cut off (disappear)** from the Active table view without needing to click another tab.

  - Verify that the table automatically refreshes in the background, updating the total record count and loading the next page items.

- [ ] Switch to the **Inactive** tab, select rows, and click `Bulk Actions ⌵` -> `Bulk Activate`:

  - Verify all selected items reactivate in a single fast batch request (`POST /api/v1/masters/products/bulk-activate`).

  - Verify that the reactivated rows **immediately cut off (disappear)** from the Inactive table view and appear on the Active tab without manual page reloads.

- [ ] Verify identical instant cut-off behavior across all other master modules (Categories, SubCategories, Brands, Suppliers, Buyers, Users, etc.).

- [ ] Click "Download PDF Datasheet" (`GET /api/v1/products/{id}/datasheet-pdf`) and verify ReportLab PDF generates.

- [ ] Open `/masters/products` and verify the table loads in **< 300 ms** with light-list payload optimization (response size reduced from ~352 KB down to ~69 KB with image media omitted by default; images stream on demand via `<LazyProductImages>`), standard pagination (`Showing 1-50`), and zero 500 error banners.

- [ ] Navigate through pages (`Next`, `Page 2`, `Page 3`) and verify 50 products render reliably per page.

- [ ] Filter by Category, Sub-Category, or Brand using the top filter dropdowns; confirm the table updates immediately and reactively upon selection with matching filtered count (no redundant Search button needed; `hideFilterSearchButton={true}`).

- [ ] Click the `[Reset]` button in the top filter bar; verify Category, Sub Category, and Brand dropdowns reset to "All", search query is cleared, and table resets to Page 1 with all active products.

- [ ] Test Comprehensive Server Search: Search by Product Code (`DAR-01849`), Product Name (`Ink Cup`), Brand Name (`Supreme`), or Category; confirm matching items display instantly without proxy timeout.

- [ ] In Add Product modal, type part of an existing product name into Product Name (As per Tally). Verify substring suggestions appear in a dropdown list matching any part of the name (e.g. typing "sealer" finds "FR900 MSH Band Sealer").

- [ ] Type or select an exact existing product name into Product Name (As per Tally). Verify bold red warning appears directly beneath: `⚠️ Product "[Name]" already exists!` and clicking Save blocks submission.

- [ ] In Add Product modal, type an existing Product Code. Verify bold red warning appears directly beneath: `⚠️ Product Code "[Code]" already exists (used by "[Name]")!` and clicking Save blocks submission.

- [ ] Edit an existing product without changing its name or code. Verify no duplicate warning appears and product saves successfully.

- [ ] Import an Excel/CSV file containing duplicate product names or codes; verify batch rejection with clear duplicate collision error.

- [ ] **Cross-ERP Sync (`Organization = Inhyma`):**

  - Create a new product in Yinglima with `Organization` containing `Inhyma`.

  - Verify that the product is immediately created in Inhyma ERP's Product Master with status `ACTIVE`.

  - Confirm missing Category, SubCategory, Brand, or UOM are auto-provisioned in Inhyma without breaking foreign keys.

- [ ] **Cross-ERP Update Sync:**

  - Update product attributes in Yinglima (e.g. `product_name`, `length_cm`, `weight`).

  - Verify that changes are reflected in Inhyma Product Master.

- [ ] **One-Way Deactivation & Soft Deletion Cascade:**

  - Deactivate the product in Yinglima (`POST /masters/products/{id}/deactivate`).

  - Verify that the product status in Inhyma automatically changes to `inactive` (`status = 'INACTIVE'`).

  - Reactivate the product in Yinglima. Verify Inhyma product updates to `active`.

  - Delete a product in Yinglima (`DELETE /masters/products/{id}`).

  - Verify that the product in Inhyma is automatically soft-deleted (`deleted_at` timestamp populated) and immediately disappears from Inhyma's active Product Master table.

- [ ] **Strict One-Way Non-Reversal Validation:**

  - Deactivate or delete a product directly in Inhyma ERP.

  - Verify that the Yinglima product remains unaffected and stays `active`.

  - Create or edit a product directly in Inhyma ERP. Verify no event or record is pushed to Yinglima.

- [ ] **Inhyma Organization Scoping & Domestic Spare Parts Exclusion Verification:**

  - Open Inhyma ERP Product Master (`localhost:5174/product/list`).

  - Verify the list strictly displays the 873 products originating from Yinglima ERP.

  - Confirm that all 935 domestic Indian spare parts (`INH-xxxxx`) and non-Inhyma organizations (Darsh Impex, FNB Solution) are completely hidden/filtered out of the view.

  - Query Inhyma ERP database directly and verify zero data loss: Darsh Impex (652 items), FNB Solution (769 items), and native domestic spare parts (935 items) remain 100% intact, active, and untouched in the database with all historical transactions valid.

- [ ] **Bulk Initial Reconciliation Verification (`sync_all_inhyma_products.py`):**

  - Run reconciliation script: `python backend/scripts/sync_all_inhyma_products.py`.

  - Confirm all 873 products assigned to Inhyma in Yinglima ERP are reconciled in Inhyma ERP (319 new products inserted, 554 existing products updated with CBM, weight, UOM, and classifications).

- [ ] **Product Master Edit Foreign Key Resilience:**

  - Open an existing product containing unassigned or non-existent supplier links (or edit HSN, Sub-Category, and change Status to Inactive).

  - Click Save. Confirm the form saves with 200 OK without any "An unexpected error occurred" banner.

  - Verify that the updated HSN, Sub-Category, and Inactive status are persisted in Yinglima DB and synced to Inhyma DB.





---



## 7. INVENTORY: Product Gallery Module



- **Route:** `/product-gallery`

- **Purpose:** Visual media center for browsing all product photos and supplier factory inspection photos/videos.



### Visual Elements & Actions

1. **View Tabs:**

   - 📦 **Product Catalog Media Tab:** Visual card grid of all products with image galleries.

   - 🏭 **Supplier Factory Media Tab:** Visual card grid of vendor factory inspection photos & videos.

2. **Filters & Search:** Category, Sub-Category, Supplier, Country, Status, and Keyword search.

3. **Product Media Card:**

   - Cover Photo thumbnail with total photo count badge (e.g. `🖼️ 6 Photos`).

   - Product Name, SKU code, Category badge, and Primary Supplier name.

   - Action: Click opens **Lightbox Carousel**.

4. **Lightbox Carousel Modal:**

   - High-resolution image preview with Next (`❯`) / Previous (`❮`) navigation.

   - Zoom in / Zoom out controls.

   - 💾 **Download Current Photo** button.

   - 📦 **Download All Media (ZIP / Batch)** button.

   - ✏️ **Quick Edit Product** button (opens side drawer).



### Test Cases

- [ ] Open `/product-gallery` and verify that the page loads cleanly in < 1 second without any HTTP 500 error on `/masters/products?has_images=true`.

- [ ] Verify that products possessing image attachments render their cover cards with correct photo counts in the Product Catalog Media tab.

- [ ] Test the backend endpoint `GET /api/v1/masters/products?has_images=true` and confirm HTTP 200 OK with correct total record count.

- [ ] Test the backend endpoint `GET /api/v1/masters/products?has_images=false` and confirm HTTP 200 OK without scalar/array JSON errors.

- [ ] Click on a product card in `/product-gallery` and confirm the Lightbox Carousel opens with full-resolution photo preview, zoom controls, and next/prev navigation.



---



## 7.1. INVENTORY: Product Price Directory Module



- **Route:** `/inventory/product-prices` (Aliases: `/product-prices`, `/masters/product-prices`)

- **Active Key:** `product-prices`

- **Icon:** `coins`

- **Required Permissions:** `product.view` (read), `product.update` (assign / inline edit), `product.export` (export), `product.import` (import)

- **Purpose:** Procurement and sales pricing catalog showing lowest supplier quote per product, inline price updating, expandable vendor price comparisons, and universal bulk Excel import/export.



### Visual Elements & Actions

1. **Header & Summary:**

   - Heading: `Product Price Directory`

   - Total Counter Badge: `N Products`

   - Action Buttons: Filter Toggle Funnel button (`filterOpen` toggle styled `#0061f2` when active, `#475569` when closed), `📥 Export ▾` dropdown (`📊 Export to Excel (.xlsx)` with corporate navy header and auto-filters + `📄 Export to CSV (.csv)` with UTF-8 BOM, filter-aware up to 50,000 catalog items), `🔄 Refresh` (Bulk import option removed permanently).

2. **Expandable Top Filter Box (matching Products Master):**

   - Toggled open/closed by the header funnel button.

   - **Category Filter Dropdown:** `All` or specific category from `/masters/product-categories`.

   - **Sub-Category Filter Dropdown:** `All` or dynamically scoped sub-category from `/masters/product-sub-categories`.

   - **Brand Filter Dropdown:** `All` or specific brand from `/masters/brands`.

   - **Pricing Status Dropdown:** `All`, `Priced Items Only`, `Unpriced Items Only`.

   - **Action Buttons:** `[Reset]` (grey `#64748b` - resets all filters and search) and `[Search]` (amber `#f59e0b` - triggers filter execution).

3. **Table Card Toolbar:**

   - **Items/Page Selector & Frozen Columns Tool:** `10`, `50`, `100` items per page selector alongside `📌 Freeze Columns` toggle button in the yellow page toolbar box, enabling horizontal scroll while keeping Sr No and Product columns locked on the left.

   - **Search Catalog Input:** Debounced (300ms) multi-attribute search matching product code, product name, Tally alias, barcode, or vendor company name with `🔍` icon and instant `✕` clear button.

   - **Live Exchange Rate Engine:** Automatic multi-currency conversion supporting USD, CNY/RMB, EUR, and INR with database persistence in `currency_rates`.

3. **Main Table Columns:**

   - **Sr. No.:** Global 1-indexed running number across pages `((page - 1) * pageSize + idx + 1)`.

   - **Product Name & Code:**

     - Product photo thumbnail.

     - Product Name: Clickable link opening `Product Detail SideDrawer`.

     - Product Code Badge (e.g. `DAR-01758`).

     - Barcode (if present).

   - **Category & Brand:** Category name, Brand name, and UOM code.

   - **Best Price (Quote):**

     - Formatted currency badge (e.g. `¥ 125.00` or `$ 16.50`).

     - **Inline Editing:** Clicking/double-clicking turns badge into an inline number input. Pressing `Enter` or clicking `✓` automatically commits changes via `PATCH /api/v1/inventory/product-prices/{link_id}` with optimistic UI update. `Esc` cancels.

     - Unpriced state: Amber button `+ Add Price` opening the Assign Quote modal.

   - **Primary Supplier:**

     - Lowest-price vendor name.

     - Expandable Accordion Badge: `[ N Suppliers ▾ ]` toggling the comparison sub-table.

     - Unpriced state: `—` with `+ Assign` button.

   - **Actions:**

     - `+ Quote` button (opens quick modal to link another supplier to this product).

     - `Compare ▾` / `Close ▴` toggle button.

4. **Option 1 Expandable Sub-Table Comparison (Accordion & 0ms Hover Pre-Fetching):**

   - **Hover Pre-Fetching Engine:** Moving the cursor over any product table row (`<tr>`), supplier count badge `[ N Suppliers ▾ ]`, `+ Assign`, `+ Quote`, or `Compare ▾` button automatically triggers background pre-fetching (`prefetchProductSuppliers`) 200–300ms before click, caching quote data in React state.

   - **0ms Instant Accordion Toggle:** Clicking `Compare ▾` or `[ N Suppliers ▾ ]` opens immediately (0ms) without waiting for server network latency or showing a loading spinner. If `supplier_count === 0`, it opens in 0ms with zero backend network requests.

   - Sub-table columns:

     - `Supplier Name`: Vendor company name, primary calling number (`📞`), WeChat ID (`💬`), and `BEST` green badge on lowest bidder.

     - `Location`: City, Province, Country.

     - `Quoted Price`: Formatted price, inline editable with click and auto-save!

     - `Currency`: CNY, USD, EUR, INR.

     - `MOQ`: Minimum Order Quantity (e.g. `50 pcs`).

     - `Notes / Terms`: Procurement remarks.

     - `Updated`: Formatted quotation date.

     - `Actions`: `🗑️` Delete quote button with confirmation prompt (optimistically removes row and recalculates best price in 0ms).

   - **Inline Quick-Add Row (`+ Add Another Supplier Quote:`):**

     - Supplier select dropdown + Unit Price input + Currency dropdown + MOQ input + `Save Quote` button.

     - **0ms Optimistic Sub-Table Injection:** Instantly appends the new quote to the sub-table, sorts ASC, updates the main row's best price badge and supplier count in 0ms, clears inputs immediately, and synchronizes with server in the background.

5. **Modal: Assign / Add Supplier Quote (Clean New Quote Entry & 0ms Optimistic UI):**

   - **Context-Aware Dynamic Header & Clean Form:** When clicking `+ Quote` on a product that already has quotes, the modal title dynamically reads **"+ Add New Supplier Quotation"** and opens with **clean, blank inputs** (Supplier dropdown blank, Unit Price blank) ready for entering the next vendor's quotation without confusing pre-fills.

   - **Current Benchmark Quote Banner:** When quotes already exist on a product, a green benchmark summary card renders prominently at the top of the modal (*"Current Lowest Benchmark: ¥ 150.00 (via Darsh Impex) • 1 Quote on file"*), giving the procurement user immediate comparison context.

   - **Smart Supplier Duplicate / Update Notice:** If a supplier that has already quoted is selected in the dropdown, an amber notification immediately displays (*"ℹ️ Darsh Impex already has a quote on file (¥ 150.00). Entering a new price will update their quotation."*), and the button adapts to *"Update Supplier Quote"*. If a new vendor is selected, the button displays *"+ Add Supplier Quote"*.

   - **Instant 0ms Optimistic Save:** Submitting a valid quotation closes the modal immediately (0ms), renders a green success toast, updates the main product row (new best price, currency, primary vendor, and incremented supplier count), updates open sub-table quotes in memory, and performs background server sync with graceful rollback on error.

6. **Modal: Bulk Import Product Prices:**

   - Sample template link: `📥 Download Sample Price Template (.xlsx)`.

   - Drag & drop or click-to-browse `.xlsx` file upload.

   - Live import summary box: `✅ Created: N`, `🔄 Updated: N`, `❌ Failed: N`, with detailed error list and row numbers for invalid entries.

7. **Product Detail SideDrawer:**

   - Slides in from right upon clicking product name or code.

   - High-resolution photo, Tally Name, Brand, Category, Sub-Category, HSN Code, UOM, Packaging Quantity, Refund VAT %, Packaging Net/Gross Weight, Dimensions (L x W x H cm), auto-computed Packaging Unit CBM, License Warning banner, and Technical Specifications.

8. **Granular RBAC Action Button & Feature Permissions:**

   - **product_price.view:** Controls access to the Product Price Directory page, catalog product listing, and the Compare ▾ accordion comparison table.

   - **product_price.export:** Controls visibility of the header 📥 Export ▾ dropdown button (Excel and CSV download).

   - **product_price.import:** Controls visibility of the 📥 Bulk Import button and modal.

   - **product_price.create:** Controls visibility of the + Quote button under Actions, the + Assign button on unlinked products, and the sub-table + Add Another Supplier Quote: inline entry drawer.

   - **product_price.update:** Controls click-to-edit inline pricing (main row best price badge and sub-table quoted price), rendering clean read-only currency text without pencil icons or pointer cursors when absent.

   - **product_price.delete:** Controls visibility of the 🗑️ delete quote button within the comparison sub-table.



### Test Checklist for Quality Assurance

- [ ] **Table Render**: Verify all 3,500+ products load smoothly under 1.5s with Sr. No., Product Name & Code, Category & Brand, Best Price, Primary Supplier, and Actions.

- [ ] **Search Filter**: Type a product code (e.g. `DAR-01758`) or partial product name &rarr; verify table filters instantly.

- [ ] **Category & Brand Filters**: Select a Category &rarr; verify Sub-Category dropdown auto-scopes &rarr; select a Brand &rarr; verify rows reflect selection.

- [ ] **Pricing Status Filter**: Filter by `Priced Items Only` &rarr; verify only rows with quotes display; filter by `Unpriced Items Only` &rarr; verify rows show `+ Add Price`.

- [ ] **Product Detail Drawer**: Click any product name or code &rarr; verify `SideDrawer` opens with full specs, dimensions, weights, CBM, and photo.

- [ ] **Assign Modal 0ms Optimistic Save**: Click `+ Add Price` or `+ Quote` &rarr; select vendor, enter `125.00`, click Save &rarr; verify modal closes immediately (0ms), price badge and supplier update instantly on the main row without waiting for full catalog reload.

- [ ] **Assign Modal Quick-Clear `✕`**: In the supplier search combobox, type any query or non-existent supplier &rarr; verify `✕` cross button appears inside the input &rarr; click `✕` &rarr; verify text and selection clear instantly, input stays focused, and full supplier list is restored.

- [ ] **Modal Default Preference Checkbox (Safe Off)**: Click `+ Add Price` or `+ Quote` &rarr; verify `⭐ Set as Preferred Supplier for this product` checkbox defaults to **UNCHECKED (`false`)**, guaranteeing that entering a new quotation never alters vendor preference automatically.

- [ ] **Lowest Price vs. Preferred Supplier Separation**: Enter a new quotation with a price lower than all existing quotes (e.g. `¥ 5.00` when benchmark is `¥ 12.00`) with `"Set as Preferred"` unchecked &rarr; save quote &rarr; verify:
  - Sub-table tags the new quote with green **`LOWEST`** badge.
  - Action button for that quote remains **`⭐ Set Preferred`** (NOT automatically set as preferred).
  - Main row "Best Price (Quote)" displays `¥ 5.00`.
  - Main row "Supplier Brand" displays the supplier name **WITHOUT** any `⭐ Preferred` badge.

- [ ] **Manual Preferred Supplier Designation & Unset**:
  - In the sub-table, click **`⭐ Set Preferred`** on any vendor quote &rarr; verify the badge updates to gold **`⭐ PREFERRED`**, the button changes to **`⭐ Preferred (Unset)`**, and main row displays `⭐ Preferred`.
  - Click **`⭐ Preferred (Unset)`** &rarr; verify preference is immediately cleared (`products.supplier_id = null`), the gold badge disappears, the button reverts to **`⭐ Set Preferred`**, and main row "Supplier Brand" displays without `⭐ Preferred`.

- [ ] **Inline Edit Main Row (0ms)**: Click on the price badge `¥ 125.00` &rarr; enter `130.00`, press `Enter` &rarr; verify price badge and sub-table quote update immediately with success banner.

- [ ] **Hover Pre-fetching & Instant Compare**: Hover cursor over a product row or `Compare ▾` button for 200ms &rarr; click `Compare ▾` &rarr; verify sub-table opens in 0ms with zero loading delay or spinner.

- [ ] **Zero Supplier 0ms Open**: Click `Compare ▾` on an unpriced item with 0 suppliers &rarr; verify sub-table opens immediately with empty quotes table and quick-add row with zero backend network requests.

- [ ] **Sub-Table Inline Quick-Add (0ms)**: Select a 2nd supplier, enter `110.00`, click `Save Quote` &rarr; verify sub-table immediately injects the new quote with `BEST` badge, supplier count increases to `2 Suppliers`, and main row best price drops to `¥ 110.00` without waiting for network roundtrip.

- [ ] **Sub-Table Delete Quote (0ms)**: Click `🗑️` on a quote &rarr; confirm prompt &rarr; verify quote removed immediately and best price recalculates in 0ms.

- [ ] **Excel & CSV Export**: Click `📊 Export Excel` and `📄 Export CSV` &rarr; verify downloaded files contain all columns and valid data.

- [ ] **Bulk Import & Template**: Open `Bulk Import Prices` modal &rarr; click `Download Sample Price Template` &rarr; verify `.xlsx` template downloads with headers and examples &rarr; upload file &rarr; verify import summary.



---



## 7.2. INVENTORY: Stock Movement (Inward & Outward Register & Live Inventory Ledger)



- **Route:** `/inventory/stock-movements` (aliases: `/stock`, `/stock-movements`)

- **Purpose:** Full warehouse inventory tracking of physical stock receipts (Inward +), shipments to clients (Outward -), and real-time inventory ledger (Kardex).



### Visual Elements & Layout

1. **Top KPI Metrics Summary Cards:**

   - 📥 **Total Inward Received:** Displays total confirmed incoming quantity in units across all inbound shipments.

   - 📤 **Total Outward Dispatched:** Displays total confirmed dispatched quantity in units across all buyer dispatches.

   - 📊 **Net Current Warehouse Stock:** Real-time calculated live stock balance (+Inward - Outward).

2. **Navigation Tabs:**

   - `📥 Inward Register`: Chronological incoming receipt records with supplier, reference challan, vehicle, total quantity, status, and detail view.

   - `📤 Outward Register`: Chronological dispatch records with buyer, reference challan, container/vehicle, total quantity, status, and detail view.

   - `📊 Current Stock Ledger`: Item-by-item live balance table (Product Name, SKU, Total Inward, Total Outward, Current Stock, Status Badge, and "View Kardex" button).

3. **Action Buttons & Automated Workflow Banners:**

   - **Pure Audit Ledger Consolidation:** Both manual `+ New Inward Entry` and `+ New Outward Entry` buttons are completely removed from `/inventory/stock-movements` to eliminate duplicate entries and unverified stock adjustments.

   - **Inward Automated Workflow Notice Banner:** In the `📥 Inward Register` tab, an informational banner guides the user: *"Inward Stock movements are automatically generated directly from Local Purchases. To inward incoming goods, open Local Purchase and click [📦 Inward Stock]."* with a direct navigation button **`[📦 Go to Local Purchase →]`**.

   - **Outward Automated Workflow Notice Banner:** In the `📤 Outward Register` tab, an informational banner guides the user: *"Outward Stock movements are automatically generated directly from Sales Process orders upon dispatch. To dispatch goods and reduce stock, open Sale Process and click [📤 Outward / Dispatch Stock]."* with a direct navigation button **`[📤 Go to Sale Process →]`**.



### Test Cases: Inward Stock-In Workflow (Initiated from Local Purchase)

- [ ] **Automated Inward from Local Purchase:** Navigate to `/purchase/local` &rarr; locate a purchase order in `Confirmed` status &rarr; click **`[📦 Inward Stock]`** &rarr; verify `LocalPurchaseInwardModal.tsx` opens pre-filled with supplier, invoice number, line items, and quantities defaulting to 100% accepted (`damaged_qty = 0`).

- [ ] **Damaged & Accepted Quantity Calculation:** On an inward item with 50 expected qty, enter `48` received and `2` damaged &rarr; verify accepted net quantity calculates as `48` units.

- [ ] **Confirm Inward & Auto-Movement Creation:** Click `Confirm Inward Receipt` &rarr; verify `POST /api/v1/purchases/local/{purchase_id}/inward` succeeds &rarr; verify status updates to `Inwarded` &rarr; verify inward slip link (`INW-YYYY-XXXX`) appears &rarr; verify inward movement record is visible in `/inventory/stock-movements` Inward Register.

- [ ] **Duplicate Inward Prevention:** Verify `[📦 Inward Stock]` button is replaced with `● Inwarded` badge &rarr; verify row action menu displays `✓ Inwarded: {slip}` &rarr; verify duplicate inward attempts are strictly blocked.

- [ ] **Direct Link to Local Purchase:** In `/inventory/stock-movements` Inward Register tab, click `[📦 Go to Local Purchase →]` &rarr; verify instant routing to `/purchase/local`.



### Test Cases: Outward Stock-Out Workflow (Initiated from Sale Process)

- [ ] **Automated Outward from Sale Process:** Navigate to `/sale/process` &rarr; locate an approved sale order (`admin_approved` or `sales_confirmed`) &rarr; click **`[📤 Outward / Dispatch Stock]`** in the Status column or action kebab menu (`⋮`).

- [ ] **Pre-filled Dispatch Verification Modal:** Verify `SaleProcessOutwardModal.tsx` opens pre-filled with buyer name, order number, consignment code, container number, transporter, vehicle number, and item lines.

- [ ] **Confirm Dispatch & Live Stock Deduction:** Click `Confirm Outward Dispatch` &rarr; verify `POST /api/v1/sales/orders/{id}/dispatch` succeeds &rarr; verify order status updates to `Dispatched` (`● DISPATCHED` purple badge) &rarr; verify linked outward voucher `Outward: OUT-YYYY-XXXX` is displayed with a clickable link to Stock Movements &rarr; verify live inventory deduction in Current Stock Ledger.

- [ ] **Strict Outward Blocking on Insufficient Stock (Anti-Negative Stock):**

  - For any sale order item where requested dispatch quantity exceeds available warehouse stock (e.g. Requested: 100, Available: 40):
  - In `SaleProcessOutwardModal`, line items show available stock badge and alert if stock is insufficient.
  - Submitting or dispatching an order with insufficient warehouse stock strictly blocks the operation.
  - Backend API `POST /api/v1/sales/orders/{id}/dispatch` and `POST /api/v1/sales/orders/{id}/status` immediately abort the transaction with HTTP 400 Bad Request.
  - Error message strictly returns: `"Insufficient stock in warehouse (Available: X, Requested: Y) for '<Item>'. Outward dispatch blocked to prevent negative inventory."`.
  - Frontend renders a prominent red error toast displaying the exact available vs requested units.
  - Warehouse stock is NOT deducted and order status is NOT changed to dispatched.

- [ ] **Direct Link to Sale Process:** In `/inventory/stock-movements` Outward Register tab, click `[📤 Go to Sale Process →]` &rarr; verify instant routing to `/sale/process`.



### Test Cases: Live Stock Balance, Kardex History & Deletion

- [ ] **0-Item Clean Initial State (No Ghost Rows):** Click `+ New Inward Entry` or `+ New Outward Entry` &rarr; verify modal opens in 1-Click Extract mode with **`2. GOODS LINE ITEMS (0 items)`** and displays centered empty-state banner (*"No purchase bill / sale order selected yet..."*) with **zero ghost rows**, and bottom counter shows `Total Items: 0 | Total Net Qty: 0`.

- [ ] **Cascading Clear `✕` on Order Search Combobox:** Extract any purchase bill or sale order &rarr; click `✕` in the search input &rarr; verify search query, selected order, party names, and all line items wipe immediately, returning table to `0 items` and empty-state banner.

- [ ] **Submit Button Locked on 0 Items:** While `items.length === 0`, verify the `Confirm & Record` button is disabled with gray styling (`#94a3b8`) and tooltip (*"Select a purchase bill / sale order or add line items first"*).

- [ ] **Mode Switch Row Management:** Switch to `✍️ Direct Manual Entry` &rarr; verify table automatically provides 1 clean item row ready for input &rarr; switch back to `⚡ 1-Click Extract` &rarr; verify table resets cleanly to 0 items.

- [ ] **Stock Balance Verification:** Switch to `📊 Current Stock Ledger` tab &rarr; search for the SKU received and dispatched &rarr; verify:

  $$\text{Current In-Stock} = \text{Total Inward Qty} - \text{Total Outward Qty}$$

- [ ] **Kardex Transaction Ledger:** Click `📊 View Kardex` on any product row &rarr; verify modal displays complete chronological transaction history with running balance after each transaction.

- [ ] **Movement Cancellation:** In Inward or Outward register, click `Cancel` on a confirmed movement &rarr; confirm prompt &rarr; verify status updates to `CANCELLED` and stock balance recalculates immediately.

- [ ] **Movement Deletion:** In Inward or Outward register, click `Delete` on a movement &rarr; confirm prompt *"Are you sure you want to permanently delete movement ...?"* &rarr; verify movement is removed from register, deleted via `DELETE /api/v1/stock/movements/{id}`, and stock balances update in 0ms.

- [ ] **Inward Cancellation & Deletion Safeguard:** Attempt to cancel or delete an inward movement whose items have already been dispatched &rarr; verify operation is rejected with `BadRequestException` to prevent driving stock into deficit.



---



## 8. INVENTORY: Categories Master Module



- **Route:** `/masters/categories`

- **Table Columns:** SR. NO., Category Name, Category Code, Description, Status, Actions (Edit, Delete).

- **Add / Edit Form Fields:**

  - **Category Name** (*Required*): Title-cased name.

  - **Category Code**: Unique uppercase code (e.g. `MACH`, `PKG`).

  - **Description**: Text area.

  - **Status**: `Active` / `Inactive`.



---



## 9. INVENTORY: Sub Categories Master Module



- **Route:** `/masters/subcategories`

- **Table Columns:** SR. NO., Sub Category Name, Parent Category Name, Code, Description, Status, Actions.

- **Add / Edit Form Fields:**

  - **Parent Category** (*Required*): Dropdown from Categories Master.

  - **Sub Category Name** (*Required*): Title-cased name.

  - **Sub Category Code**: Unique code.

  - **Description**: Text area.

  - **Status**: `Active` / `Inactive`.
- **Top Filter Toolbar:** Category Filter using `SearchableFilterDropdown` (`All Categories`) with pinned `Search / Type here...` search box and 0ms live filtering. Orange Search button removed; reactive filtering on selection; Reset button aligned in straight line.



---



## 10. INVENTORY: Brands Master Module



- **Route:** `/masters/brands`

- **Add / Edit Form Fields:** Brand Name (*Required*), Brand Code, Manufacturer / Country Description, Status (`Active`/`Inactive`).



---



## 11. INVENTORY: Supplier Types Master Module



- **Route:** `/masters/supplier-types`

- **Add / Edit Form Fields:** Supplier Type Name (*Required*, e.g. Manufacturer, Trader, OEM, Authorized Distributor), Code, Description, Status.



---



## 12. INVENTORY: Buyer Types Master Module



- **Route:** `/masters/buyer-types`

- **Add / Edit Form Fields:** Buyer Type Name (*Required*, e.g. Wholesaler, Retailer, Direct Importer, Institutional Client), Code, Description, Status.



---



## 12.1. PURCHASE: Local Purchase Module



- **Route:** `/purchase/local` (List View), `/purchase/local/new` (Add New Order), `/purchase/local/:id/edit` (Edit Order), `/local-purchase` (Direct Alias)

- **Active Key:** `local-purchases`

- **Icon:** `shoppingCart`

- **Required Permissions:** `local_purchase.view` (read), `local_purchase.create` (create), `local_purchase.update` (edit), `local_purchase.inward` (inward to warehouse), `local_purchase.delete` (delete), `local_purchase.export` (export)

- **Purpose:** Domestic procurement lifecycle management for Chinese factory orders and domestic vendor billing. Features cascading Organization & Branch dropdowns, single "Invoice Total Value with VAT" input in RMB (¥ CNY) / INR / USD, Value-Based (VB) landing expense distribution across line items, AI & Regex Dual-Mode Bill Document Extraction (PDF/Excel), and real-time Smart Financial Reconciliation alerts.



### 12.1.1. Visual Elements & Actions (List View `/purchase/local`)

1. **Header & Summary Cards / Top KPIs:**

   - Heading: `Local Purchases`

   - Subtitle: `Domestic procurement, factory invoices, landing costs & bill extractions`

   - Top KPI Stat Cards:

     - **Total Purchases:** Total domestic purchase records count.

     - **Total Landing Value:** Sum of `(Invoice Total + Total Expenses)` displayed in RMB (`¥`).

     - **Total Expenses Disbursed:** Total domestic logistics, packing, transport & offloading expenses.

2. **Action Bar & Global Controls (Top Right Header):**

   - **Filter Toggle Button (`btn-header-filter`):** Placed in the top action bar to the left of `+ Add Local Purchase`. Corporate slate background (`#475569`, transitions to primary blue `#0061f2` when toggled open or active filters > 0), white funnel SVG icon (`⏚`), and red active filter counter badge (`#ef4444`). Aligned with Products Master design standard.

   - **`+ Add Local Purchase` Button:** Blue primary button (`#0061f2`) routing to `/purchase/local/new`.

   - **`Export ▾` Dropdown (`btn-imp-exp`):** Vibrant orange button (`#f59e0b`, white text `#ffffff`, `fontWeight: 700`, `borderRadius: 6px`, `border: none`, `boxShadow: 0 2px 4px rgba(245, 158, 11, 0.25)`).

     - `📊 Export to Excel (.xlsx)`: Corporate navy `#1E3A8A` header, white bold text, auto-fit column widths, and proper currency format.

     - `📄 Export to CSV (.csv)`: UTF-8 with BOM encoding for seamless Excel import.

3. **Expandable Filter Card (Positioned Above Table Card):**

   - Expandable card situated immediately between Top KPI Stat Cards and Data Table Card.

   - **Supplier Dropdown:** Filter by domestic vendor from `/suppliers`.

   - **Status Dropdown:** Filter by `Confirmed`, `Inwarded`, `Pending`, `Cancelled`.

   - **Date Range:** `From Date` and `To Date` datepicker inputs.

   - **`✕ Reset Filters` Button:** Appears when any filter is active to clear all filters in one click.

4. **Table Card Toolbar:**

   - **Items/Page Selector (Left):** `20`, `50`, `100`, `200` rows per page.

   - **Live Debounced Search Input (Right):** Real-time search matching Invoice Number, Supplier Company Name, Organization Name, or Product Name with `🔍` icon and `✕` clear button.

5. **Main Table Columns:**

   - **Sr. No.:** Global 1-indexed sequential running number across paginated results `((page - 1) * pageSize + index + 1)`.

   - **Invoice No & Date:**

     - Clickable blue invoice number text. Clicking opens the **Local Purchase Details Preview Modal** (without redirecting to edit mode).

     - Subtitle showing formatted invoice date (`YYYY-MM-DD`).

   - **Organization & Branch:**

     - Organization company name.

     - Sub-badge displaying the assigned operational branch location.

   - **Supplier:** Supplier company name with link/indicator.

   - **Invoice Total (with VAT):** Formatted total invoice value with currency symbol (e.g. `¥ 45,000.00`).

   - **Total Expenses:** Sum of domestic landing expenses (`Packaging + Transport + Offloading + Other`).

   - **Total Landing Value:** `Invoice Total + Total Expenses` with bold emphasis.

   - **Status:** Color-coded status badge & Inward action:

     - `Draft`: Slate / Neutral grey (`#64748B`)

     - `Confirmed`: Action button **`[📦 Inward Stock]`** rendering inline (gated by `local_purchase.inward` permission) to trigger the Inward modal, or blue badge (`#2563EB`).

     - `Inwarded`: Emerald Green (`#059669`) badge (`● Inwarded`) with a direct clickable link to the generated inward voucher (`INW-YYYY-XXXX`).

     - `Cancelled`: Rose Red (`#DC2626`)

   - **Actions:** Kebab menu (`⋮`) containing:

     - `👁️ View Details`: Opens the **Local Purchase Details Preview Modal**.

     - `📦 Inward to Warehouse`: Triggers `LocalPurchaseInwardModal.tsx` (gated by `local_purchase.inward` permission; available for Confirmed purchases; displays `✓ Inwarded: {slip}` when completed).

     - `✏️ Edit`: Opens `/purchase/local/{id}/edit` (gated by `local_purchase.update`).

     - `🗑️ Delete`: Triggers confirmation modal and soft-deletes the purchase order (gated by `local_purchase.delete`).

     - **Smart Dropup Positioning:** The menu automatically opens upwards (`bottom: 100%`) when on bottom rows to prevent container overflow, vertical scrollbars, or clipping. Closes automatically on outside click.

6. **Local Purchase Details Preview Modal (`LocalPurchaseDetailModal.tsx`):**

   - **Trigger:** Clicking the blue invoice number link or selecting `👁️ View Details` from the action menu.

   - **Modal Header:** Title `Local Purchase Details` with status badge and close `✕` button.

   - **Order Detail (Card 1):** Created timestamp, Created By user, and active currency.

   - **From (Supplier):** Supplier name and domestic vendor role.

   - **To (Receiving Location):** Organization name and receiving branch badge (`📍 [Branch]`).

   - **Quick Details Strip:** Receiving Warehouse, Invoice No, Invoice Date, Bill Document download link (`📥 Download File`), Basic Items Total, and Gross Invoice Total with VAT.

   - **Expenses Card:** Itemized Packing, Transport, Offloading, Other Misc, Total All Expenses, and `% Loading Expense (VB)`.

   - **Product Summary Table:** Consignment rows with product code badge, HSN, quantity, unit rate, basic total, expense per unit, unit landing rate (VB), line landing total, and grand total footer.

   - **Remarks Box:** Factory delivery notes / remarks if present on the purchase.

   - **Actions:** `[✏️ Edit Local Purchase]` button (navigates to `/purchase/local/:id/edit`) and `[Close]` button.



---



### 12.1.2. Add / Edit Local Purchase Order Form (`/purchase/local/new` & `/purchase/local/:id/edit`)



1. **Breadcrumb Navigation:** `Purchase` &rarr; `Local Purchase` &rarr; `New Local Purchase` (or `Edit Local Purchase`).

2. **100% Fluid Full-Width Responsive Layout (Product Master Standard):**

   - Renders across 100% width (`width: 100%`, `boxSizing: 'border-box'`) without rigid max-width clamps, ensuring seamless full-screen scaling at any browser zoom level (e.g. 80%, 90%, 100%, 125%) and across all monitor resolutions without dead whitespace on the sides.

   - **Card 1 Row 1:** 5 responsive auto-adjusting columns (`repeat(auto-fit, minmax(200px, 1fr))`) cleanly aligning Organization List, Operating Branch, Supplier, Invoice No, and Invoice Date.

   - **Card 1 Row 2:** 2 clean, proportional fluid columns (`minmax(280px, 1fr) minmax(360px, 1.4fr)`): Invoice Total Value with VAT (RMB ¥), and Bill Document Upload + Extract Bill Data.

3. **Top Validation Error Banner (Product Master Visual Style):**

   - **Render Trigger:** When the user clicks `[Submit Local Purchase]` and one or more mandatory fields, line items, or financial reconciliation fail validation (`Object.keys(errors).length > 0`).

   - **Visual Styling:** Premium prominent red alert container (`#fef2f2`, border `1.5px solid #ef4444`, text `#991b1b`, border radius `8px`, shadow `0 2px 8px rgba(239,68,68,0.08)`).

   - **Header:** `❌ Please correct the following errors before submitting:` in bold `#991b1b`.

   - **Itemized Error List:** Bulleted list displaying all active validation failures (e.g. `Organization is required.`, `Operating Branch is required.`, `Unit Rate must be greater than 0 for all items...`, `Invoice total does not match calculated items total with VAT...`).

   - **Auto-Scroll & Dynamic Error Clearance:** Automatically scrolls the window smoothly to the top (`window.scrollTo({ top: 0, behavior: 'smooth' })`) on failed submission so the user immediately sees what needs correction. Changing Organization, Branch, or Supplier automatically resets `submitAttempted` and clears all stale errors. In addition, editing Unit Rates, Invoice Number, or Invoice Total dynamically clears active field and reconciliation errors in real time.

4. **Card 1: Procurement & Organization Details:**

   - **Organization List * (`company_id`):** Mandatory dropdown sourced from `master_companies` via `/masters/company-list/lookup`.

     - Selecting an organization cascades and populates operating branches.

     - Dynamically controls and unlocks Card 3 Product Search.

     - **Switch Protection:** If items exist in the table, changing Organization triggers a confirmation prompt: *"Changing the Organization will clear previously added line items, as products are strictly scoped to the chosen organization. Proceed?"*. If confirmed, existing items are cleanly cleared.

   - **Branch * (`branch_name`):** Mandatory dropdown dynamically populated with branch locations belonging to the chosen organization.

   - **Supplier * (`supplier_id`):** Mandatory searchable vendor selector querying Supplier Master (`/suppliers/lookup`).

   - **Invoice Number * (`invoice_no`):** Unique invoice identifier string (e.g., `INV-2026-CH-089`).

   - **Invoice Date * (`invoice_date`):** Date picker for invoice date (defaults to current date).

   - **Fixed Domestic Currency:** Standardized to Chinese RMB (`¥`) for all local purchases (no redundant dropdown required).

   - **Invoice Total Value with VAT * (`invoice_total_value`):** Single consolidated financial input field for the total vendor invoice amount in RMB (¥) including domestic VAT. Strictly reconciled against line items with VAT ($\Delta \le 0.05$).

   - **Unconditional Reconciliation Policy:** Status dropdown provides two options: Confirmed (default) and Inwarded. When Inwarded is selected, the Warehouse Inward Stock Receipt card opens directly on the form. Submission strictly requires exact invoice balancing ($\Delta \le 0.05$) to safeguard accounting integrity and prevent unbalanced inventory ledger postings.

   - **Product Master Visual Style Field Cues:**

     - Invalid empty inputs display bold red borders (`1.5px solid #ef4444`), soft red background tint (`#fff5f5`), and focus glow (`boxShadow: 0 0 0 3px rgba(239,68,68,0.15)`).

     - Sub-field warning labels: `▲ [Field] is required` rendered in bold `#ef4444` directly underneath the input.

     - Real-time error clearing: Field errors clear automatically as soon as the user selects or types a value.

5. **Card 2: AI & Dual-Mode Bill Data Extraction Engine:**

   - **Upload Zone:** Drag & drop or browse file input accepting `.pdf`, `.xlsx`, `.xls`, `.csv` vendor bill files.

   - **`⚡ Extract Bill Data` Action Button:** Sends document to `POST /api/v1/purchases/local/extract-bill`.

   - **Extraction Engine Workflow:**

     - **Excel Parser:** Uses `openpyxl` / `csv` to extract invoice number, invoice date, supplier name, currency, total value, and consignment rows (`Product Name`, `Quantity`, `Unit Price`, `HSN Code`, `VAT %`).

     - **PDF Parser:** Uses `pypdf` to extract raw text, followed by OpenAI GPT-4o-mini structured JSON extraction (with regex fallback if API key is not configured or network fails).

     - **Fuzzy Product & Supplier Resolution:** Extracted product names are matched against the Product Master (`/masters/products`) to resolve `product_id`, `product_code`, `hsn_code`, and `uom`. Extracted supplier name is fuzzy-matched against Supplier Master.

     - **Auto-Populate:** Upon extraction, the form's invoice number, date, supplier, currency, invoice total, and product line items table are instantly filled for user review.

6. **Card 3: PRODUCT SEARCH (Branch & Consignment Scoped & Locked Workflow):**

   - **Locked State (No Branch & Consignment Selected):**

     - When `!planningColumnId`, the search input is strictly disabled (`disabled={!planningColumnId}`).

     - Renders a dashed gray border (`1.5px dashed #cbd5e1`), soft slate background (`#f8fafc`), and guidance placeholder: `🔒 Select Branch & Consignment in Card 1 above first to search planned container products...`.

     - Header guidance text displays `🔒 Please select Branch & Consignment in Card 1 first to search planned products`.

   - **Unlocked State (Branch & Consignment Selected):**

     - Border switches to solid `#3b82f6` (focused `#0061f2`) and placeholder updates to `Search planned products in Consignment [Code] (Name, Code, Supplier)...`.

     - Header subtitle displays: `📦 Showing planned products for Consignment "[Code]" (N items)`.

   - **Strict Container Planning Scoping (`consignmentRawItems`):**

     - Product dropdown displays **only the products planned in the selected container column** (`/purchases/local/consignments/{colId}/items`).

     - Global master products from unassociated containers/branches do not appear.

     - Real-time client-side search across planned container items by product name, model/product code, or supplier name.

   - **Supplier Prioritization:**

     - When a supplier is selected in Card 1, items matching that vendor display a prominent `✓ Selected Supplier` badge and are automatically sorted to the top of the search dropdown.

   - **Planned Quantity & Blank Unit Rate Click-to-Add:**

     - Dropdown rows display: Product Name, Product Code badge, `📦 Planned Qty: [quantity]`, `🏭 Supplier: [name]`, `HSN: [code]`, `VAT: [rate]%`.

     - Clicking any planned product immediately appends it to Card 4 with its planned container quantity (`prod.quantity`) and blank unit rate `""` (placeholder `0.00`) ready for direct supplier invoice entry.

     - If the product is already in the table, an informative toast alerts the user (`"[Name]" is already in the items table (Row #N)`).

     - Auto-clears the search input and closes the dropdown.

7. **Card 4: PRODUCT ITEM Consignment Table:**

   - **Header Display:** Renders dynamic count badge `PRODUCT ITEM (N) *` and currency label. Catalog products are added via Card 3 `PRODUCT SEARCH`.

   - **Table Columns:**

     - `#`: Sequential 1-indexed row number.

     - `Product Name`: Displays product name in bold (`#0f172a`) with a gray bordered `product_code` badge.

     - `HSN Code`: Editable input pre-filled from master.

     - `Qty`: Number input (`min="0.01"`, `step="0.01"`, bold right-aligned).

     - `Unit Rate`: Number input (`step="0.01"`, bold right-aligned in purchase currency).

       - **Mandatory Positive Rate (`> 0`):** Entering `0` or leaving rate empty highlights the cell with a red border (`2px solid #ef4444`), soft red background (`#fff5f5`), and warning label `▲ Rate > 0 req.`.

       - Direct typing automatically strips leading zeros so the user does not need to backspace.

     - `VAT %`: Tax rate input (strictly defaults to HSN Master `purchase_vat_percent`, falling back to Product Master `purchase_vat_percent`, or `0.00%`).

     - `Item Total`: Auto-computed basic total (`Qty × Unit Rate`).

     - `Expense Per Unit`: Auto-computed value-based proportional landing expense.

     - `Unit Landing Rate (VB)`: Auto-computed (`Unit Rate + Expense Per Unit`).

     - `Total Landing Rate (VB)`: Auto-computed (`Qty × Unit Landing Rate`).

     - `Action`: Red `🗑️` delete icon to remove row.

   - **Grand Totals Table Footer:** Sticky footer calculating total quantity, basic items total, total expenses disbursed, and grand total landing cost.

8. **Card 5: Value-Based (VB) Landing Expense Distribution Engine:**

   - Four distinct expense input fields (in purchase currency):

     - `Packaging Charges`

     - `Transport / Freight Charges`

     - `Loading / Offloading Charges`

     - `Other Misc / Custom Charges`

   - **Auto-Computed Summary:** Displays `Total Landing Expenses = Packaging + Transport + Offloading + Other`.

   - **Value-Based (VB) Mathematical Formula:**

     Expenses are distributed proportionally across consignment line items based on basic product value:

     $$\text{Line Basic} = \text{Quantity} \times \text{Unit Price}$$

     $$\text{Total Basic} = \sum \text{Line Basic}$$

     $$\text{Expense Ratio} = \frac{\text{Total Landing Expenses}}{\text{Total Basic}}$$

     $$\text{Landing Rate / Unit} = \text{Unit Price} \times (1 + \text{Expense Ratio})$$

     $$\text{Line Landing Cost} = \text{Quantity} \times \text{Landing Rate / Unit}$$

9. **Card 6: Smart Financial Reconciliation & Grand Totals:**

   - **Live Financial Comparison:** Calculates discrepancy $\Delta = |\text{Invoice Total Value} - \text{Line Items Gross Total with VAT}|$.

   - **Color-Coded Visual States:**

     - **Green Banner (`#f0fdf4`, border `#86efac`):** `✅ Invoice Total Matches Line Items Perfectly` displayed when $\Delta \le 0.05$.

     - **Red Banner (`#fef2f2`, border `2px solid #ef4444`):** Displayed whenever $\Delta > 0.05$. Renders unconditional hard-stop blocker alert: `⛔ Discrepancy Detected: Entered invoice total differs from items total with VAT by [diff]. Adjust line items or invoice total to match before submitting.` and strictly blocks submission.

     - **Blue Banner (`#eff6ff`, border `#3b82f6`):** Helpful prompt before invoice total value is entered.

10. **Card 7: Remarks & Delivery Notes:**

    - Textarea for supplier payment terms, factory delivery instructions, or inspection notes.

11. **Form Actions:**

    - `[Cancel]`: Returns to `/purchase/local` without saving.

    - `[Submit Local Purchase]`: Audits client validations, verifies non-zero unit rates and strict financial reconciliation ($\Delta \le 0.05$), persists purchase order and line items, displays success toast, and redirects to list view.



---



### 12.1.3. Test Checklist for Quality Assurance



- [ ] **TC-LP-01: Locked Product Search without Organization:**

  - Navigate to `/purchase/local/new`.

  - Leave `Organization List` unselected in Card 1.

  - In Card 3, verify `PRODUCT SEARCH` input is completely disabled with dashed border (`#f59e0b`), soft amber background, and placeholder `🔒 Select an Organization in Card 1 to enable product search & add items`.

  - Verify user cannot type or search any products before selecting an organization.

- [ ] **TC-LP-02: Organization Switching Item Clear Confirmation:**

  - Select an Organization (e.g. `Darsh Impex`) and choose an Operating Branch.

  - Add 2 products to the consignment table.

  - In Card 1, select a different Organization (e.g. `Inhyma`).

  - Verify browser confirmation dialog appears: *"Changing the Organization will clear previously added line items, as products are strictly scoped to the chosen organization. Proceed?"*.

  - Click `Cancel` &rarr; verify existing line items remain intact and Organization selection does not change.

  - Switch Organization again and click `OK` &rarr; verify line items are cleared and operating branch dropdown resets.

- [ ] **TC-LP-03: Product Master Visual Style Validation on Submit:**

  - On `/purchase/local/new`, leave all Card 1 fields blank and click `[Submit Local Purchase]`.

  - Verify page smoothly auto-scrolls to top (`window.scrollTo({ top: 0, behavior: 'smooth' })`).

  - Verify top red alert banner displays: `❌ Please correct the following errors before submitting:` with itemized bullet points.

  - Verify invalid fields in Card 1 display bold red borders (`1.5px solid #ef4444`), soft red backgrounds (`#fff5f5`), and warning labels `▲ [Field] is required`.

  - Select an Organization &rarr; verify Organization red border and warning label clear immediately.

  - Select an Operating Branch &rarr; verify Branch error clears immediately.

  - Fill Supplier, Invoice No, Invoice Date, and Invoice Total &rarr; verify all respective errors clear in real time.

- [ ] **TC-LP-04: Strict Multi-Tenant Organization Product Scoping:**

  - Select `Test Group` in Card 1 Organization List.

  - Focus `PRODUCT SEARCH` &rarr; verify search results only display products strictly belonging to `Test Group` (or associated with its organization ID).

  - Verify products belonging solely to `Inhyma` or unassigned products (null organization) NEVER appear.

  - Select `Inhyma` in Card 1 &rarr; verify search dropdown only presents Inhyma's products.

- [ ] **TC-LP-05: Mandatory Positive Unit Rate Validation:**

  - Select Organization, Branch, Supplier, and fill invoice header details.

  - Click `+ Add Blank Row` or add a catalog product and set `Unit Rate = 0`.

  - Click `[Submit Local Purchase]`.

  - Verify form submission is rejected.

  - Verify the invalid row's Unit Rate cell displays a red border (`2px solid #ef4444`), soft red background, and `▲ Rate > 0 req.` warning.

  - Verify top red alert banner reports: `Unit Rate must be greater than 0 for all items. Please check row(s): #1...`.

  - Direct typing into Unit Rate replaces the zero cleanly without manual backspacing.

  - Enter Unit Rate = `150.00` &rarr; verify red cell border and warning disappear.

- [ ] **TC-LP-06: Unconditional Financial Reconciliation Discrepancy Hard-Stop:**

  - Add 1 line item: Qty = `10`, Unit Rate = `100.00`, VAT = `13%` (Line Total with VAT = `¥ 1,130.00`).

  - Enter `Invoice Total Value with VAT = 1130.00`.

  - Verify Card 6 renders Green Banner: `✅ Invoice Total Matches Line Items Perfectly`.

  - Change `Invoice Total Value with VAT = 1200.00` (discrepancy = `¥ 70.00`).

  - Verify Card 6 turns Red with blocker alert: `⛔ Discrepancy Detected: Entered invoice total differs from items total with VAT by ¥ 70.00. Adjust line items or invoice total to match before submitting.`.

  - Click `[Submit Local Purchase]` &rarr; verify form submission is strictly blocked and top error banner flags: `Invoice total (¥ 1200.00) does not match calculated items total with VAT (¥ 1130.00). Difference: ¥ 70.00.`.

  - Adjust Invoice Total to `1130.00` (matching line items) &rarr; verify banner turns green and submit succeeds.

- [ ] **TC-LP-07: Value-Based Landing Cost Distribution:**

  - In Landing Expenses, enter Transport = `¥ 200.00`, Offloading = `¥ 50.00` (Total Expenses = `¥ 250.00`).

  - Add Line Item 1: Qty = 10, Unit Price = 100 (Basic = 1,000).

  - Add Line Item 2: Qty = 5, Unit Price = 200 (Basic = 1,000).

  - Total Basic = 2,000. Expense Ratio = 250 / 2,000 = 12.5%.

  - Verify Line Item 1 Landing Rate = `112.50 / unit`, Line Landing Cost = `¥ 1,125.00`.

  - Verify Line Item 2 Landing Rate = `225.00 / unit`, Line Landing Cost = `¥ 1,125.00`.

  - Verify Total Landing Cost = `(Item Total with VAT) + Total Expenses`.

- [ ] **TC-LP-08: Bill File Data Extraction (PDF & Excel):**

  - Upload a sample invoice file (PDF or Excel).

  - Click `⚡ Extract Bill Data` &rarr; verify invoice fields and item rows extract and auto-populate into the form.

- [ ] **TC-LP-09: Create, Edit & Delete Flow:**

  - Complete form and click `[Submit Local Purchase]` &rarr; verify record saves and appears in list table.

  - Click invoice link or `✏️ Edit` kebab action &rarr; verify edit form loads with saved data &rarr; update a field &rarr; save &rarr; verify changes persist.

  - In list table, click kebab menu `⋮` &rarr; `🗑️ Delete Purchase` &rarr; confirm modal &rarr; verify record is soft-deleted.

- [ ] **TC-LP-10: Corporate Excel & CSV Export:**

  - Click `📥 Export ▾` &rarr; `📊 Export to Excel (.xlsx)` &rarr; verify `.xlsx` downloads with navy `#1E3A8A` header and complete purchase data.

  - Click `📥 Export ▾` &rarr; `📄 Export to CSV (.csv)` &rarr; verify `.csv` downloads with UTF-8 BOM encoding.

- [ ] **TC-LP-11: Consignment Product Supplier Filtering:**

  - Navigate to `/purchase/local/new`.

  - Select Organization `Inhyma` & Branch `Inhyma Mumbai (INM)`.

  - Select Consignment `Mum 48` (which contains 28 container items across multiple suppliers).

  - Verify that when no supplier is selected, the system indicates that Consignment `Mum 48` contains items across multiple suppliers and prompts to select a supplier.

  - Select Supplier `Dingye (Soontrue)` &rarr; verify exactly the 5 items belonging to Dingye populate the items table with planned quantities, and the banner shows `📦 5 planned item(s) for Dingye (Soontrue) from Consignment Mum 48`.

  - Switch Supplier to `YUjun` &rarr; verify the items table automatically updates to show strictly the 7 items belonging to YUjun from Mum 48, and the banner updates to `📦 7 planned item(s) for YUjun from Consignment Mum 48`.

  - Select a Supplier with no products in Mum 48 &rarr; verify the table sets items to 0 and displays `ℹ️ 0 planned items for [Supplier] in Consignment Mum 48`.

- [ ] **TC-LP-12: Local Purchase Domestic VAT Rate Source Resolution (HSN Purchase VAT %):**

  - Navigate to `/purchase/local/new`.

  - Select Organization `Inhyma`, Branch `Inhyma Mumbai (INM)`, and Supplier `Prathamesh Packaging PVT LTD`.

  - Select Consignment `Mum 48`.

  - Product `Carton boxes for band sealer without thermocol` (`PROD-MUM-0002`) auto-loads with Qty `48`.

  - Verify `VAT %` column strictly resolves to `0.00%` (derived from HSN `8422.a247` `purchase_vat_percent` or Product `purchase_vat_percent`).

  - Verify the VAT % does **NOT** mistakenly default to Indian GST (`18.00%`) or China Export Refund VAT (`13.00%`).

  - Search and add any product via Card 3 `PRODUCT SEARCH` &rarr; verify `VAT %` resolves from its HSN `purchase_vat_percent` (falling back to product `purchase_vat_percent`, defaulting to `0%`).

- [ ] **TC-LP-13: Instant Organization Loading & Decoupled Consignments Lookup Performance:**

  - Navigate to `/purchase/local/new`.

  - Verify the `Organization *` dropdown label renders immediately with zero `⏳ Loading...` text.

  - Verify the dropdown is clickable and searchable immediately upon navigation (0ms cached, ~15ms initial fetch).

  - Add a new organization in Organization Master (`/masters/company-list`) &rarr; navigate back to `/purchase/local/new` &rarr; verify the newly created organization appears in the Organization dropdown list automatically.

  - Verify consignments lookup loads asynchronously in the background via single-batch query without blocking or freezing Organization selection.

- [ ] **TC-LP-14: Instant 0ms Blue Link Opening, In-Memory SWR Caching & Live Post-Edit Detail Synchronization:**

  - Navigate to `/purchase/local`.
  - Click on any blue invoice link (e.g. `LP-YLM/2026/0102`).
  - Verify the Detail Modal (`LocalPurchaseDetailModal.tsx`) opens instantaneously at **0ms** without an obstructing screen-blanking spinner.
  - Close the modal, click `✏️ Edit` on `LP-YLM/2026/0102`, and navigate to `/purchase/local/:id/edit`.
  - Click `← BACK TO LIST` &rarr; verify the list table, KPI summary cards, and pagination render at **0ms** from memory without any full-page reload or spinner flicker.
  - Return to edit mode (`/purchase/local/:id/edit`), change a value (e.g. update notes/remarks or modify line item quantities/rates), and click `[Save Changes]`.
  - Verify success toast appears and automatically navigates back to `/purchase/local`.
  - Immediately click the blue invoice number link again.
  - Verify the modal paints at **0ms** displaying the **freshly updated data** (new values, line items, and financial totals) with zero stale lag.

- [ ] **TC-LP-15: Warehouse Inward Modal Damaged Quantity Placeholder & Input Ergonomics:**

  - On `/purchase/local`, click `[📦 Inward Stock]` for any confirmed purchase (e.g. `LP-YLM/2026/0102`).
  - In the modal (`LocalPurchaseInwardModal.tsx`), observe the `DAMAGED` column input: verify it displays a faint gray placeholder `0` instead of a persistent literal value `0`.
  - Click into the `DAMAGED` input: verify the box is empty and does not append to an existing `0`.
  - Type `10`: verify the input cleanly displays `10` (does NOT become `100`).
  - Verify the `RECEIVED *` column automatically adjusts from `25` down to `15` (`quantity = expected - damaged`).
  - Click into the input again: verify the value `10` is automatically highlighted via `onFocus` auto-select.
  - Type `5`: verify the value replaces `10` with `5`, and `RECEIVED` adjusts to `20`.
- [ ] **TC-SYS-01: System-Wide Master Data 0ms Instant Edit Modal & Navigation Caching:**

  - Navigate to `/masters/products` (or Brands, Categories, HSN, UOM, Cities, etc.).
  - Observe the table: once loaded, navigate away to Dashboard and click back to `/masters/products`.
  - Verify the product master table renders at **0ms** from `masterListCache` without displaying the 6-row skeleton loader.
  - Click `✏️ Edit` on any product row.
  - Verify the edit modal opens **immediately at 0ms** without freezing or delaying for 500ms.
  - Verify fields are instantly populated with the row's data while deeper specs stream in the background.

- [ ] **TC-SYS-02: Zero-Lag Blue Links & Instant Tab Switching across Prices, Planning, Inquiries, and Users:**

  - Navigate to `/product-prices`: click any blue product name link &rarr; verify the Product Detail Drawer slides open at **0ms** immediately.
  - Navigate to `/planning`: click between "Sheet 1" and "Sheet 2" tabs &rarr; verify the sheet grid switches at **0ms** without turning into a loading spinner.
  - Navigate to `/inquiries`: click between Company &rarr; Consignments &rarr; Inquiry Items &rarr; verify each view renders at **0ms** from SWR cache with zero skeleton flashes.
  - Navigate to `/users`: click any user's name &rarr; verify the User Detail drawer opens at **0ms** immediately with user profile info, with secondary metrics resolving concurrently in the background.
  - Navigate to `/stock/movements`: switch between "Inward", "Outward", and "Live Balances" &rarr; verify tables switch at **0ms** without skeleton reloading.

---



## 13. SALE: Inquiries & Proforma Workflow Module



- **Route:** `/inquiries`

- **Purpose:** End-to-end 3-layer RFQ and Quotation management lifecycle:

  $$\text{Layer 1: Buyer Summary Directory} \longrightarrow \text{Layer 2: Buyer Consignments (FB1, FB2...)} \longrightarrow \text{Layer 3: Inquiry Line Items, RFQs \& Quotation Matrix}$$



### 13.1. Layer 1: Buyer Inquiries Directory

- **Summary Cards / Top KPIs (Interactive Filters):**

  - **Pending RFQs:** Count of items awaiting supplier quotes. Clickable &rarr; sets tab to `Pending`.

  - **Approved Quotes:** Count of line items with approved supplier pricing. Clickable &rarr; sets tab to `Approved`.

  - **Ongoing Inquiries:** Active buyer consignments currently in negotiation. Clickable &rarr; sets tab to `Ongoing`.

  - **Completed Consignments:** Successfully ordered / fulfilled consignments. Clickable &rarr; sets tab to `Completed`.

  - **Total Order Value:** Sum of all active consignment line items. Clickable &rarr; sets tab to `All`.

- **Lifecycle Filter Tabs (Matching Product Master Pattern):**

  - Positioned directly above the company table: `All (N)`, `Pending (N)`, `Ongoing (N)`, `Approved (N)`, `Completed (N)`.

  - Active tab highlighted with blue underline (`2.5px solid #0061f2`) and active text color.

- **Top Actions & Bulk Operations:**

  - 🟢 **`Bulk Actions (N) ▾` Button & Dropdown Menu:**

    - Positioned in the top-right header alongside `+ ADD NEW`.

    - Shows `Select 1 or more items from list first` tooltip if 0 selected.

    - Turns vibrant green (`#10b981`) with active count `(N)` when $\ge 1$ company is selected via checkboxes.

    - **`🗑️ Bulk Delete ({N})`**: Deletes all consignments across selected buyer companies safely into Trash with confirmation prompt.

  - ➕ **`+ ADD NEW` Button:** Opens the `QuickInquiryDrawer`.

- **Buyer Directory Table Columns:**

  1. **Checkbox:** Master select all in header; individual checkboxes per buyer row.

  2. **BUYER COMPANY NAME:** Clickable buyer title drilling down to Layer 2 Consignments.

  3. **CONSIGNMENT CODES:** Tag pills of consignment codes (e.g. `📦 FB1`, `📦 FB2`).

  4. **STATUS BADGE:** `Pending`, `Partial Approved`, `Fully Approved`.

  5. **TOTAL CBM:** Sum of CBM for this company's consignments.

  6. **TOTAL WEIGHT:** Total kilograms.

  7. **UPDATED DATE:** Timestamp of latest update.

  8. **ACTIONS:** `👁️ View`, `✏️ Edit`, `🗑️ Delete`.

- **Top Actions Details:**

  - ⚡ **`+ Quick Add Inquiry` Drawer:**

    - **Buyer Company** (*Required*): Searchable dropdown from `/buyers`.

    - **Consignment Code** (*Required*): Dropdown of existing codes or type new (e.g. `FB1`). Automatically cross-references existing codes to reuse matching IDs and prevent `HTTP 409 Conflict` errors.

    - **Inline Error Alert Banner**: Displays red contextual alert banner inside the drawer for immediate feedback on validation failures or conflict warnings.

    - **Non-Destructive Item Editing**: When modifying an existing consignment, updates existing items in-place via `PATCH /{inquiry_id}/items/{item_id}` and appends new rows via `POST /items/bulk`, safely preserving existing quotation records, RFQs, and WeChat/Email chat histories.

    - **Product Item** (*Required*): Type-ahead search with Product Code + Name + Category from Product Master.

    - **Quantity** (*Required*): Number input.

    - **Target Price**: Buyer's budgeted price.

    - **Brand Preference**: Preferred manufacturer/brand.

    - **Product Specs Remarks**: Custom technical or packaging requirements.

    - **Action Buttons:** `Cancel`, `Save Item`, `Save & Add Another Item`.

  - ➕ **`+ Add Item` Modal:**

    - **Buyer Company**: Scoped to current buyer context.

    - **Consignment Code** (*Required*): Scoped strictly to the selected buyer.

    - **Product Name** (*Required*): Auto-resolves and displays dynamic Unit of Measurement (e.g. `PCS`, `SET`, `KG`, `METER`) next to the Quantity input label.

    - **Quantity** (*Required*): Number input (> 0).

    - **Brand Preference & Remarks**: Optional text fields.

    - **Status**: `Proposed` or `Approved`.

  - ➕ **`+ New Consignment` Modal:**

    - **Buyer Company** (*Required*): Select buyer.

    - **Consignment Code** (*Required*): e.g. `FB1`, `FB2`, `MUM-2026-AUG`.

    - **Target Delivery Date**: Date picker.

    - **Consignment Remarks / Notes**: Text area.



---



### 13.2. Layer 2: Consignments View (Inside a Buyer)

- **Top Header & Navigation:**

  - `← All Companies` breadcrumb back button.

  - Heading: `{Buyer Company Name} — Consignments`.

  - 🟢 **`Bulk Actions (N) ▾` Button:** Top-right action bar beside `+ Add Inquiry Item`.

    - Active when $\ge 1$ consignment checkbox is selected.

    - **`🗑️ Bulk Delete ({N})`**: Deletes selected consignments and child items safely into Trash with confirmation prompt.

  - ➕ **`+ Add Inquiry Item` Button:** Opens `AddItemModal`.

- **Lifecycle Filter Tabs & Search Bar:**

  - Tabs: `All (N)`, `Proposed (N)`, `Partial Approved (N)`, `Fully Approved (N)`.

  - Live search input: `Search consignment code…`.

- **Consignments Table Columns:**

  1. **Checkbox:** Master select-all checkbox in `th`; row checkbox in each `td`.

  2. **CONSIGNMENT CODE:** Clickable title (e.g. `FB1`, `FB2`) drilling down to Layer 3 Line Items.

  3. **STATUS:** `badge-gray` (Proposed), `badge-yellow` (Partial Approved), `badge-green` (Fully Approved).

  4. **TOTAL CBM:** Sum of CBM.

  5. **TOTAL WEIGHT:** Sum of weight (kg).

  6. **UPDATED:** Date of latest update.

  7. **ACTION:** `View` (drills into Layer 3), `Delete` (moves to Trash).



---



### 13.3. Layer 3: Inquiry Line Items, RFQs & Quotation Matrix

- **Top Navigation:**

  - `← Back to Consignments` button.

  - Breadcrumb: `Inquiries / {Buyer Name} / {Consignment Code}`.

- **Toolbar Actions:**

  - ➕ **`+ Add Line Item` Button & Modal:**

    - Product picker (loads SKU, image, category), Quantity, Primary UOM, Target Price, Brand Preference, Remarks.

  - ➕ **`+ Add Line Item` Button & Modal:**

    - Product picker (loads SKU, image, category), Quantity, Primary UOM, Target Price, Brand Preference, Remarks.

  - 🔄 **`Imp / Exp ▾` Button & Dropdown Menu (Unified Import/Export):**

    - **UI Placement**: Top-right action bar in Layer 3 beside `← Back` and `+ Add Item`.

    - **Dropdown Options**:

      - 📄 **SAMPLE FILE**: Downloads standardized sample CSV (`Sample_Inquiry_Items_Template.csv`) pre-populated with realistic machine/spare part data.

      - 📥 **IMPORT**: Navigates to the dedicated `Import Inquiry Products` full-page interface.

      - 📤 **EXPORT**: Exports all consignment line items to Excel (`.xlsx`) with enriched quotation metrics, UOM, and statuses.

  - 📥 **`Import Inquiry Products` Dedicated Page & Column Mapping Wizard:**

    - **Page Layout**:

      - Breadcrumb: `Inquiries > {Buyer Name} > #{Consignment Code} > Import Products`.

      - Header with `← BACK` navigation button.

      - Drag-and-drop file selector supporting `.csv`, `.xlsx`, and `.xls` (Max 8 MB, up to 5,000 rows).

      - `📥 Download Sample CSV Template` button.

      - **Validation Guidelines & Notes Card**: Explains mandatory fields (`Product Name` or `Product Code`, `Quantity`), positive quantity requirement, auto-assigned UOM from Product Master, automated license flagging in red, and status defaulting to `Proposed`.

      - Action buttons: `Cancel` and `Import`.

    - **Interactive Column Mapping Modal (`WizardModal`)**:

      - Client-side pre-parsing via SheetJS / PapaParse.

      - Dynamic synonyms matching (e.g. `Item Name` $\rightarrow$ `Product Name`, `Qty` $\rightarrow$ `Quantity`, `SKU` $\rightarrow$ `Product Code`) with green `MATCHED` badges.

      - First 5 rows live preview table for visual verification.

      - Progressive chunked upload to `POST /api/v1/inquiries/{inquiry_id}/items/import`.

    - **Results Summary Panel**:

      - Displays total rows, created count, failed count, and row-by-row error diagnostics with exact spreadsheet row numbers.

      - Automatically recomputes consignment rollups (Total CBM, Weight, Status) and updates the workspace in real-time.

  - ⚡ **`+ Bulk Add Items` Button & Modal:**

    - Multi-row product picker from Product Master with live search. Check multiple products and enter quantities simultaneously.

  - 📤 **`Dispatch Bulk RFQs` Button & Modal:**

    - **Select Suppliers**: Multi-select supplier picker filtered by relevant product categories or all suppliers.

    - **Isolated 1-on-1 Supplier Dispatch**: The backend partitions recipients per supplier so each vendor receives an isolated, private email. Competitor email addresses are never bundled or exposed in `To:`.

    - **Guaranteed `Reply-To` Header**: Enforces `Reply-To: Yinglima Procurement Team <om1inhyma@gmail.com>` on all outbound emails, ensuring supplier replies route cleanly back to the automated AI ingestion inbox.

    - **Per-Supplier Timeline Logging**: Logs separate outbound `InquiryMessage` timeline entries for each recipient supplier (`supplier_id = sup.id`).

    - **Dispatch Channels**: Select `Email (IMAP/SMTP)` and/or `Tencent WeCom / WeChat`.

    - **RFQ Custom Subject & Message**: Pre-filled template with line item details and specifications.

    - **Expected Due Date**: Quotation submission deadline.

    - **Auto Token Generator**: Generates unique public quote tokens (`/quote/:token`) for each supplier.

  - 📊 **`Quotation Matrix Comparison` Button & Modal:**

    - Displays all received supplier quotes side-by-side per line item.

    - **Columns**: Supplier Name, Unit Price, Currency, Lead Time (Days), MOQ, Payment Terms, Incoterms (FOB/CIF/EXW), Total Calculated Cost.

    - **Highlights**: 🟢 **Lowest Unit Price** (green badge), 🟡 **Fastest Lead Time** (yellow badge).

    - **Decision Actions**:

      - `✔ Approve Quote`: Marks quote as `Approved`, sets line item status to `Approved`, updates consignment KPI.

      - `✖ Reject Quote`: Marks quote as `Rejected`.

  - ➕ **`+ Add Manual Quote` Button & Modal:**

    - Supplier picker, Unit Price, Currency (`USD`, `CNY`, `INR`, `EUR`), Lead Time (Days), MOQ, Incoterms, Payment Terms, Quotation Sheet Upload to **Supabase Storage**.

  - 🖼️ **`Quote Documents Gallery` Side Drawer:**

    - Displays all vendor PDF quotation sheets, Excel specs, and technical drawings.

    - In-drawer preview, zoom, and direct download links.

  - 💬 **`Two-Way Communication Timeline & Interactive Email Composer` (Emails Tab):**

    - Chronological feed of all inbound/outbound emails and WeChat messages for this consignment / product.

    - **Supplier Thread Filter & Company Resolution**: Dropdown automatically maps recipient/sender email addresses to their official supplier company names (e.g. mapping `om2inhyma@gmail.com` -> `Yinglima Packaging Machinery Co., Ltd.`), deduplicates suppliers so company names and emails are never split, and cleanly isolates communication threads per vendor.

    - **Accurate AI Auto-Extraction & Discussion Badges**:

      - **Initial Quotation Reply**: On the first incoming quotation message from a supplier for an item, AI extracts commercial pricing and terms, creating `QT-AUTO-XX` in the Quotation Matrix. Displays: `✨ Auto-Parsed with AI & Recorded in Quotation Matrix (QT-AUTO-XX • $Price)`.

      - **Subsequent Sales / Negotiation Chatter**: Once the initial quote exists, subsequent conversations between the sales team and supplier (discounts, delivery questions, terms) bypass AI extraction completely (0 OpenAI tokens). Displays: `💬 Inbound Discussion / Negotiation Thread` (or `💬 Supplier WeChat Discussion`).

      - **Multi-Product RFQ Routing**: When an RFQ contains multiple products (e.g. Band Sealer & Ink Roll), the inbound worker checks message bodies first to ensure quotes for secondary items route to their respective line items without colliding or being blocked by the first item's quote.

      - **Multi-Supplier & Cross-Consignment Isolation**: Supplier A, B, and C replies remain strictly isolated side-by-side in the Quotation Matrix, and quotes for identical products in different consignments (e.g. FB1 vs INH1) never cross-leak.

      - **WeCom / WeChat Intelligent Inbound Matching**:

        - **Consignment Code Detection**: Auto-detects tagged tags like `[#YG7]`, `#YG7`, or `YG7` in message text.

        - **Product Code Auto-Resolution**: When a supplier replies without quoting the consignment tag, the webhook auto-matches line items via product codes present in the reply (e.g. `#DAR-01849` -> automatically matches the inquiry containing that item).

        - **Outbound Recipient Correlation**: If neither code is explicitly typed, matches the reply to the most recent outbound RFQ sent to the supplier's WeCom UserID / mobile number.

        - **Supplier Signature Matching**: Auto-maps the supplier entity if the company name appears in the message signature (e.g. *Wenzhou Brother Machinery Co., Ltd.*).

        - **Instant AI Quotation Parsing**: Automatically generates `QT-AUTO-XX` with unit price, currency, quantity, and payment/delivery terms, and logs the discussion in the WeChat Messages timeline.

    - **Interactive Inline Email Composer (Gmail/Figma-Style)**:

      - Embedded directly at the bottom of the Email timeline.

      - **"To:" Recipient Field**: Quick dropdown of suppliers or free-text comma-separated email entry.

      - **"Subject:" Field**: Auto-prefilled with context tag `Re: [#ConsignmentCode] ProductName (#SKU) - Inquiry Follow-up`.

      - **"Message Body" Textarea**: Clean, spacious multiline composer for typing replies/messages.

      - **"📎 Attach File"**: Supabase Storage file/PDF uploader.

      - **Action Toolbar**: Primary blue **`✈️ Send Email`** button with async SMTP dispatch + Discard button.

    - **Smart Hybrid Real-Time & Fallback Sync**: Primary live updates arrive instantly via WebSocket (sub-second zero-latency display), backed by a gentle 15-second visibility-aware fallback poll that automatically pauses when the browser tab is hidden and refreshes immediately upon window focus to eliminate network congestion and CPU overhead.

  - 📋 **`Bulk Tally Entry Post` Button:** Select multiple line items and mark them as `Tally Entry Posted` in one batch operation.

- **Line Items Table Columns:**

  1. **Checkbox:** Select row for bulk RFQ dispatch or bulk Tally posting.

  2. **SR. NO.:** Sequential item index.

  3. **PRODUCT DETAILS:** Thumbnail photo + SKU code + Product Title + Category badge.

  4. **QUANTITY & UOM:** e.g. `500 PCS`, `24 SETS`.

  5. **TARGET PRICE:** Buyer's budget.

  6. **BRAND PREFERENCE:** Preferred brand name.

  7. **SPECIFICATIONS / REMARKS:** Popover with full technical notes.

  8. **RECEIVED QUOTES BADGE:** e.g. `3 Quotes` (Click opens Quotation Matrix modal directly).

  9. **TALLY STATUS:** Clickable toggle badge (`Tally Posted` in green vs `Pending Tally` in gray).

  10. **ACTIONS:** `Edit Item`, `Delete Item`, `Dispatch Single RFQ`, `Add Manual Quote`.



### Test Cases for Inquiries Module

- [ ] In Layer 1, click `+ Quick Add Inquiry`, select Buyer, enter Consignment `FB1`, pick Product, enter Quantity `100`, save. Verify item is created.

- [ ] Drill down to Layer 2 and Layer 3, click `Dispatch Bulk RFQs`, select 2 suppliers, dispatch. Verify RFQ records are generated with public tokens, verify each supplier receives an isolated 1-on-1 email without competitor emails in `To:`, and verify distinct `InquiryMessage` entries are created per supplier.

- [ ] In the RFQ dispatch drawer, when selecting the WeChat channel, verify the backend validates Tencent's response code (`errcode: 0` vs rejection). Verify the service resolves both Chinese (`+86`) and Indian (`+91`) mobile numbers, as well as direct WeCom UserIDs.

- [ ] Send an RFQ to a supplier, simulate/receive an email reply containing a unit price with spaces in the consignment code (e.g. `[SEA 1]`) and product codes (e.g. `#FNB-02391`), and verify that `email_inbound_worker` accurately maps to the matching consignment line item, extracts the quote via OpenAI, populates `quantity`, and generates a quotation row in the Quotations tab.

- [ ] Simulate or receive an incoming WeChat reply from a supplier; verify `/api/v1/inquiries/wechat/callback` parses the reply, extracts unit price and terms via AI, and automatically creates or updates the quotation row with real-time WebSocket broadcast.

- [ ] Switch to the **Emails** tab in Layer 3, verify the timeline displays historical RFQs and replies.

- [ ] In the **Inline Email Composer** at the bottom of the Emails tab, select a supplier from the dropdown, type a message body, and click `✈️ Send Email`. Verify the email is dispatched via SMTP and instantly appears in the conversation thread with the `Outbound Email ↗` badge.

- [ ] Switch to the **WeChat Messages** tab in Layer 3, verify the timeline displays all incoming and outgoing WeChat messages with timestamps and badges (`WeChat Inbound ↙` vs `Outbound WeChat ↗`).

- [ ] In the **WeChat Direct Reply Composer** at the bottom of the WeChat tab, verify the `To:` field auto-populates with the supplier's WeChat contact (e.g. `ChenXianNing` or `13736331731`), or select a supplier from the dropdown.

- [ ] Click a quick negotiation prompt pill (e.g. `+ Can you offer a discount for bulk quantity?`), type any additional instructions in the text area, and click `Send to WeChat 💬`. Verify the message is dispatched live to the supplier's WeCom/WeChat mobile app via Tencent API, a green success alert displays, and the reply immediately appears in the timeline with the `Outbound WeChat ↗` badge and the salesperson's name.

- [ ] Open Public Quote Portal (`/quote/:token`) for a supplier, submit unit price `¥4500` with PDF quote sheet upload.

- [ ] Return to Layer 3 Items view, verify Received Quotes badge updates to `1 Quote`.

- [ ] Open Quotation Matrix Comparison modal, verify Lowest Price is highlighted in green, click `Approve Quote`, verify status turns to `Approved`.

- [ ] Click Tally Status toggle badge on a line item, verify it toggles between `Pending Tally` and `Tally Posted` instantly.

- [ ] In Layer 3 Items view, click the **Export** button on the top-right toolbar. Select **Excel Spreadsheet (XLSX)** from the dropdown. Verify browser downloads `Inquiry_{Code}_{Date}.xlsx`. Open the file and verify columns (`Sr No`, `Product Code`, `Product Name`, `Quantity`, `UOM`, `Best Quote Price`, `Selected Supplier`, etc.) match active items.

- [ ] In Layer 3 Items view, click the **Export** button and select **CSV Delimited (CSV)**. Verify browser downloads `Inquiry_{Code}_{Date}.csv` and file opens cleanly in Excel without character encoding issues.

- [ ] Open a consignment with 0 items. Verify the **Export** button is disabled with tooltip `"No items to export"`.

- [ ] **TC-INQ-08: Smart Focus & Product Master Search Type-Ahead Resolution:**

  - Click `+ ADD NEW` to open `Create Quick Inquiry` drawer.

  - In `Product Line Items`, select any product (e.g. `FR400 Band Sealer MSH (DAR-00063)`).

  - Place cursor into the product field (or click on it) &rarr; verify the dropdown opens smoothly displaying all active products, highlighting the current selection with a green checkmark (`✓`), and **does NOT display "No matches."**.

  - Type or paste a product name or SKU into the field &rarr; verify matching products filter accurately.

  - Paste a composite label string with parentheses e.g. `(DAR-00063)` &rarr; verify the product is matched and selectable.



---



## 13.1. SALE: Sale Process Order Management & Official Export Trade Documents Module



- **Route:** `/sale/process` (List View), `/sale/process/new` (Add New Order), `/sale/process/:id/edit` (Edit Order)

- **Active Key:** `sale-process`

- **Icon:** `clipboardList`

- **Required Permissions:** `sales.view` (read), `sales.create` (create), `sales.edit` (update), `sales.delete` (delete), `sales.export` (export)

- **Purpose:** End-to-end sales lifecycle management for cross-border export orders from Chinese factory consignments to Indian buyers. Converts approved Shipment Planning consignments into finalized sales orders, manages delivery and container tracking, and auto-generates official customs-compliant trade documents: **Commercial Invoice (CI)** and **Packing List (PL)** matching `doc/Yinglima_CI_Inhyma_YL-EXP2026-54.xlsx`.



### 13.1.1. Visual Elements & Actions (List View `/sale/process`)

1. **Header & Summary Cards / Top KPIs:**

   - Heading: `Sale Process Orders`

   - Subtitle: `Consignment tracking, cross-border sales orders, commercial invoices & packing lists`

   - Top KPI Stat Cards:

     - **Total Orders:** Total sales orders count.

     - **Total Order Value:** Sum of all sales orders in RMB (`¥`) and USD (`$`).

     - **Dispatched Orders:** Orders currently in transit with BL / Container numbers.

     - **Pending Orders:** Orders awaiting final sales confirmation or admin approval.

2. **Action Bar & Global Controls (Products Master Alignment):**

   - **`🌪️ Filter Toggle` Button:** Compact dark slate square button (`#475569`, toggles to `#0061f2` when active) featuring the standardized filter funnel SVG icon, matching Products Master design, with active filter badge indicator.

   - **`+ Create Sale Process` Button:** Primary blue action button (`#0061f2`, text `#ffffff`) routing to `/sale/process/new`.

   - **`Export` Button:** Vibrant amber/orange button (`#f59e0b`, text `#ffffff`, `fontWeight: 700`, `border: none`) matching Products Master `Imp / Exp ▾` visual hierarchy, downloading filtered sales orders in Excel (`.xlsx`).

3. **Table Card Toolbar:**

   - **Items/Page Selector:** `10`, `25`, `50`, `100` items per page.

   - **Search Input:** Debounced search matching Order No, Consignment Code, Buyer Name, Container No, BL No, or LR No.

4. **Main Table Columns:**

   - **Sr. No.:** Global 1-indexed sequential running number across paginated results.

   - **Order No & Date:** Formatted order number with date badge.

   - **Consignment Code:** Extracted shipment consignment code (e.g. `Muminhyma 1`, `FB1`, `SEA 1`).

   - **Buyer Name & Branch:** Buyer company name and receiving delivery location.

   - **Total Quantity:** Total units/packages across line items.

   - **Total Amount:** Currency-formatted order value with symbol.

   - **Container / BL / LR Info:** Container number, Bill of Lading, and Lorry Receipt tracking.

   - **Status Badge:** Workflow state:

     - `Pending`: Amber badge (`#fef3c7`, text `#b45309`)

     - `Sales Confirmed`: Tech blue (`#e0f2fe`, text `#0369a1`). Displays interactive **`[📤 Outward / Dispatch Stock]`** button.

     - `Admin Approved`: Emerald green (`#dcfce7`, text `#15803d`). Displays interactive **`[📤 Outward / Dispatch Stock]`** button.

     - `Dispatched`: Purple (`#f3e8ff`, text `#7e22ce`). Displays `● DISPATCHED` badge and clickable link to linked outward stock movement slip: **`Outward: OUT-YYYY-XXXX ↗`**.

     - `LR Received / Complete`: Indigo (`#ede9fe`, text `#4338ca`)

     - `Cancelled`: Red (`#ffe4e6`, text `#be123c`)

   - **Actions:** Kebab menu (`⋮`) containing:

     - `👁️ View Details & Trade Documents`: Opens **Sale Process Detail & Commercial Invoice Modal**.

     - `📤 Outward / Dispatch Stock`: Interactive dispatch action (visible when status is `admin_approved` or `sales_confirmed`), opening `SaleProcessOutwardModal`.

     - `✏️ Edit Order`: Opens edit form.

     - `🗑️ Delete Order`: Soft-deletes order.



### 13.1.2. Sale Process Detail & Trade Document Modal (`SaleProcessDetailModal.tsx`)

- **Trigger:** Clicking Order No link or selecting `👁️ View Details` from the row kebab menu.

- **Top Modal Bar:**

  - Order title with status badge and consignment code.

  - Fixed-header protection (`flexShrink: 0`, `alignItems: "flex-start"`) preventing top bar from getting pushed off-screen.

- **3-Tab Navigation Bar:**

  1. `📋 Order Overview`: Standard ERP view with line items, basic landing rates, and workflow status transitions (`Pending` -> `Sales Confirmed` -> `Admin Approved` -> `Dispatched` -> `LR Complete`).

  2. `📄 Commercial Invoice (CI)`: Formatted preview of the official Commercial Invoice matching the exact corporate typography, borders, and ICBC bank remittance card.

  3. `📦 Packing List (PL)`: Formatted preview of the official Packing List with package carton breakdowns, weight summaries, and measurement details.

- **Action Toolbar:**

  - **`📥 Download Excel (.xlsx)` Button:** One-click download of the official dual-sheet `.xlsx` workbook generated via openpyxl. Uses active JWT token (`Auth.getAccessToken()`). Contains Sheet 1 `CI` and Sheet 2 `Packing List` with live formulas (`=SUM(...)`, `=E*F`), number formatting, borders, and embedded company seal + signature images.

  - **`🖨️ Print / Save PDF` Button:** Triggers browser print dialog using an **isolated print iframe engine**. Automatically eliminates multi-page overlap and repeating headers:

    - **Page 1:** Clean letterhead, invoice metadata, shipper/recipient cards, and first 10 items.

    - **Page 2:** Column headers repeat automatically via `<thead>`, followed cleanly by items 11 to 27, yellow totals row, ICBC bank details, and official company stamp + signature.

    - **Zero Overlap:** Complete isolation guarantees no elements are drawn on top of each other.

- **Warehouse Outward Stock Dispatch Integration:**

  - Card 3 displays linked stock movement voucher: **`📤 Outward Voucher: OUT-YYYY-XXXX ↗`** with deep-link navigation to `/inventory/stock-movements?search=OUT-YYYY-XXXX`.

  - Workflow transition toolbar includes interactive **`📤 Outward / Dispatch Stock`** action button opening `SaleProcessOutwardModal.tsx`.

  - Dispatches goods atomically, updates status to `Dispatched`, records `stock_movement_id` and `stock_movement_number`, and reduces warehouse stock ledger balances.

  - Strict shortage check blocks negative stock with explicit error: `"Insufficient stock in warehouse (Available: X, Requested: Y)"`.



### 13.1.3. New / Edit Order Form Architecture (`SaleProcessForm.tsx`) — 3-Level Planning Hierarchy

- **Header & Layout:** Full fluid layout with quick back navigation, active Order ID badge (when editing), and Cancel / Save action bar.

- **Card 1: Customer, Sheet & Planning Consignment Integration (3-Level Cascade):**

  - **Level 1 — Customer / Entity Combobox:**

    - Live search combobox partitioning options into:

      - `🏢 INTERNAL ORGANIZATIONS`: Lists all registered master companies (e.g. Inhyma, Darsh Impex, FNB Solution, One Stop, Yinglima).

      - `👤 BUYERS`: Lists all registered buyer entities (e.g. Om Packaging, Prathamesh Packaging).

    - When selecting an organization, sets `buyer_id = null`, `organization_id = org.id`, allowing internal orders and branch consignment transfers.

    - When selecting a buyer, sets `buyer_id = buyer.id`.

  - **Level 2 — Planning Sheet / Branch Combobox (New Field):**

    - Unlocks automatically upon Level 1 entity selection.

    - Dynamically queries all active planning sheets and filters strictly to sheets matching the selected entity (by foreign key or canonical sheet name prefix, e.g., `Inhyma Mumbai`, `Inhyma Ahmedabad`, `Inhyma  Indore`, `inhyma chennai` for Inhyma; or `Om Packaging - Mulund` for Om Packaging).

  - **Level 3 — Planning Consignment Column Combobox:**

    - Unlocks automatically upon Level 2 sheet selection.

    - Queries `/api/v1/sales/planning-consignments?sheet_id=...` and restricts options strictly to consignment columns belonging to that selected sheet (e.g. `Mum 48`, `Mum 49`, `GJ14`, etc.).

    - Selecting a consignment column immediately auto-loads all planned items with planned quantity > 0, unit rates, CBM, and remarks.

    - Includes manual `Auto-Load Planned Products` button with loading spinner for instant re-synchronization.

  - **Order Metadata Grid (Row 2):**

    - `Order Date`: ISO date picker.

    - `Delivery Date`: Target delivery/arrival date picker.

    - `Currency`: Currency selector (`USD`, `RMB`, `INR`).

    - `Status`: Order lifecycle state badge and select dropdown (`Pending`, `Sales Confirmed`, `Admin Approved`, `Dispatched`, `LR Complete`, `Cancelled`).

- **Card 2: Ordered Items & Spares Specification:**

  - Table of products with code, name, UOM, planned quantity, rate, amount, CBM, and remarks.

  - **Spares Highlighting:** Non-spare products render on standard clean table rows. Spare parts are automatically highlighted with light-orange background tint (`#fff7ed` / `#fffaf5`) and a non-clickable light-orange pill (`⚙️ Spare Part`).

  - **`+ Add Spare from Master` Modal:** Dynamically queries `/masters/products?is_spare=true`, filtering strictly to categories and subcategories matching "spare". Complete machines are strictly excluded.

- **Card 3: Logistics & Transport Details:**

  - `Transporter Name`: Freight forwarder or logistics company.

  - `LR / Tracking No`: Lorry receipt or tracking number.

  - `LR Date`: Shipment dispatch / LR issue date.

  - `Container No`: 11-character ocean container number (e.g. `MSKU1234567`).

  - `Bill of Lading (BL) No`: Sea waybill / BL identifier.

  - `Port of Loading (POL)`: Origin port (e.g. `Ningbo`, `Shanghai`, `Shenzhen`).

  - `Port of Discharge (POD)`: Destination port (e.g. `Nhava Sheva (JNPT)`, `Mundra`, `Chennai`).

- **Card 4: Financial Costing Summary:**

  - Summary cards showing Total Quantity, Total CBM, Subtotal, Net Sourcing Cost, Estimated VAT Refund, and Net Profit Margin.



### Test Cases for Sale Process Module

- [ ] **TC-SP-01: Order Creation from Consignment:**

  - Create a new Sale Process Order selecting an active Shipment Planning consignment & buyer. Verify all items, quantities, and rates import accurately.

- [ ] **TC-SP-02: Status Workflow Progression:**

  - Open Order Details modal. Click `Confirm Sales Order` &rarr; verify status turns `Sales Confirmed`. Click `Approve Order` &rarr; verify status turns `Admin Approved`. Click `Dispatch Order` &rarr; enter BL No & Container No &rarr; verify status turns `Dispatched`.

- [ ] **TC-SP-03: Dual-Sheet Excel Trade Document Download:**

  - In detail modal, click `📥 Download Excel (.xlsx)`.

  - Verify browser downloads `Yinglima_CI_PL_{consignment_code}.xlsx`.

  - Open in Excel: Verify Sheet 1 is `CI` and Sheet 2 is `Packing List`. Verify live formulas (`=SUM(...)`, `=E*F`), proper column widths, number formats (`$#,##0.00`), and official company seal + signature images.

- [ ] **TC-SP-04: Isolated Multi-Page Print Preview (Commercial Invoice):**

  - Select `📄 Commercial Invoice (CI)` tab and click `🖨️ Print / Save PDF`.

  - Verify print dialog displays Page 1 and Page 2 without any element overlap.

  - Verify Page 1 shows letterhead, invoice metadata, and rows 1–10.

  - Verify Page 2 repeats the items table header, displays remaining rows, yellow total row, ICBC bank card, truth declaration, and company stamp + signature.

- [ ] **TC-SP-05: Isolated Multi-Page Print Preview (Packing List):**

  - Select `📦 Packing List (PL)` tab and click `🖨️ Print / Save PDF`.

  - Verify Packing List prints cleanly with carton package breakdowns, net/gross weights, and CBM totals.

- [ ] **TC-SP-06: Modal Viewport Top Bar Integrity:**

  - Open the modal on a 1366x768 resolution or zoomed display. Scroll down the items table.

  - Verify the modal header (`Sale Process Order: ...`, tabs, buttons) remains fully visible and is never pushed off the top edge of the screen.

- [ ] **TC-SP-07: 3-Level Hierarchy Selector & Consignment Product Auto-Load (`/sale/process/new`):**

  - Navigate to `/sale/process/new`.

  - In **Step 1 (Customer / Entity)**, select an organization (e.g., `Inhyma`) or buyer (e.g., `Om Packaging`).

  - Verify **Step 2 (Planning Sheet / Branch)** unlocks and only lists sheets belonging to the selected entity (e.g., `Inhyma Mumbai`, `Inhyma Ahmedabad`, `Inhyma  Indore`, `inhyma chennai` for Inhyma; or `Om Packaging - Mulund` for Om Packaging).

  - Select a sheet (e.g., `Inhyma Mumbai`).

  - Verify **Step 3 (Planning Consignment Column)** unlocks and displays strictly the consignment columns configured in that sheet (e.g., `Mum 48`, `Mum 49`, etc.).

  - Select a consignment column. Verify all line items with planned quantity > 0 automatically populate into the Order Items table with planned unit rates, CBM, and remarks.

- [ ] **TC-SP-08: Internal Organization Order Creation (Nullable Buyer ID):**

  - Create and save a new Sale Process Order selecting an Internal Organization (`🏢 INTERNAL ORGANIZATIONS`) without picking any external buyer.

  - Save the order.

  - Verify the order is successfully persisted without foreign key constraint errors (`sales_orders.buyer_id` is nullable).

  - Open the saved order in edit mode (`/sale/process/:id/edit`). Verify the selected entity, sheet, consignment code, and line items load accurately.

- [ ] **TC-SP-09: Products Master Toolbar UI Alignment (Filter Funnel & Orange Export):**

  - Navigate to `/sale/process`.

  - Verify the filter button is a compact dark slate square button (`#475569`) with white funnel SVG icon matching Products Master.

  - Click the funnel button &rarr; verify it turns blue (`#0061f2`) and smoothly expands the collapsible filter drawer.

  - Apply any filter (e.g. Buyer or Consignment) &rarr; verify the red active count badge displays the number of active filters.

  - Verify the **Export** button renders in vibrant amber/orange (`#f59e0b`, `color: #ffffff`, `fontWeight: 700`, `border: none`) matching the Products Master `Imp / Exp ▾` visual hierarchy.

  - Click **Export** &rarr; verify it triggers Excel export with `Exporting...` loading feedback and success toast.

- [ ] **TC-SP-10: Spares Catalog Isolation & Light-Orange Line Item Highlighting (`/sale/process/new`):**

  - Click **`+ Add Spare from Master`** in `/sale/process/new` or edit form.

  - Verify the modal only displays spare products (e.g. `bogal Spares`, `JN spares`, `Yujun Spares`, `Hoofeng Spares`, `Yuangkan Spares`, etc.) matching spare categories/subcategories. Verify that machines (e.g. `GF100 Granular Filler`, `FR400 Band Sealer MSH`) never appear in the list.

  - Type a keyword into the modal search bar (e.g. `spares` or `roller`) &rarr; verify search results filter strictly within the spare catalog.

  - Click **`+ Add Spare`** on any spare item &rarr; verify the modal closes and the item is appended to the Planned Line Items table.

  - In the Planned Line Items table:

    - Verify that spare rows render with a clean **light-orange background** (`#fff7ed` / `#fffaf5`) and a subtle light-orange border.

    - Verify that next to the spare item name, a clean non-clickable badge **`Spare Part`** is displayed in light orange.

    - Verify that clickable emoji toggle buttons (`🚜 Machine` / `⚙️ Spare`) are completely removed from all rows.

    - Verify that non-spare machine items render with a standard clean white / alternating row with zero button clutter.

- [ ] **TC-SP-11: Responsive Layout & Zero-Overflow Hardening (100% Zoom / Multi-Resolution):**

  - Open /sale/process/new in Google Chrome at 100% browser zoom on a standard screen/laptop resolution.

  - Select a Customer/Entity (e.g. Om Packaging).

  - Select a Planning Sheet (e.g. Om Packaging - Mulund).

  - Select a Consignment Column with a long name (e.g. Mum 1 (Om Packaging - Mulund • 1 items • 56 pcs)).

  - **Boundary Verification:** Inspect the right edge of Card 1 ('Consignment & Buyer Identification'):

    - Verify that the ⚡ Auto-Load button remains completely within the card container boundaries.

    - Verify that the button does not get pushed off-screen or cut off (no ⚡ Au... overflow).

    - Verify that the combobox text cleanly truncates with an ellipsis (...) if the column track narrows, and hover tooltip reveals the complete metadata string.

    - Verify that zooming between 90%, 100%, 110%, and 125% retains smooth responsive wrapping without card spillover.



---



## 14. PLANNING: Master Shipment Planning Grid Module



- **Route:** `/planning`

- **Purpose:** Interactive spreadsheet-like shipment planning workbook for branch logistics, dynamic column configuration, container CBM optimization, and audit logging.



### 14.1. Workbook Features & Sheet Architecture

1. **Branch Sheet Tabs & Universal Entity Filtering:**

   - Multi-tab navigation across enterprise branches (e.g. `Mum Branch`, `MP Branch`, `GJ Branch`, `CN Central`).

   - 🏢 / 👤 **Searchable Entity Selector (`Entity: All Entities (Organizations & Buyers)`):**

     - Allows selecting a specific internal organization (`Inhyma`, `One Stop`, `F&B`, etc.) or buyer (`Prathamesh Packaging`, `Om Packaging`, `Darsh Impex`, etc.).

     - Selecting **`All Entities (Organizations & Buyers)`** shows tabs for all 12+ sheets across the entire company.

     - **Sheet Tab Navigation Hardening:** In `All Entities` mode, clicking any tab (e.g. `One Stop`, `Mumbai`, `Chennai`, `dubaidarsh`) directly opens that sheet, updates the active tab state, and loads its grid without resetting or snapping back to Inhyma.

   - ➕ **`+ Add New Sheet` Button & Modal:**

     - **Sheet Name** (*Required*): e.g. `TN Branch`.

     - **Associated Branch / Organization**: Dropdown selector.

     - **Group Label Prefix** (*Required*): e.g. `Mum`, `TN`, `CN` (customizes all column group numbering and headers for this sheet).

   - **Sheet Actions Menu:** `Rename Sheet`, `Duplicate Sheet`, `Delete Sheet`.



2. **Top Grid Toolbar Actions:**

   - 🔍 **Organization-Wide Cross-Branch Search Bar:** Dynamic top search bar with animated SVG search icon, live branch scan across all sheets of the active organization (e.g. `Inhyma Mumbai`, `Inhyma Ahmedabad`, `Inhyma Indore`), match count pills, item previews, and instant one-click branch switching.

   - 🔍 **Grid Search Input:** Live cell search highlighting matching cells across all rows and columns.

   - 🎚️ **Density Toggle:** `Compact` (high-density ERP spreadsheet) vs `Comfortable`.

   - ➕ **`+ Add Row` Button & Modal:**

     - Select Product from Product Master (auto-fills Category, Sub-Category, UOM, and CBM specs).

     - Enter Initial Target Quantity.

   - ➕ **`+ Add Column` Button & Modal:**

     - **Column Header Title** (*Required*): e.g. `Mum 1`, `Mum 1 Remarks`, `Supplier Name`, `Inspection Date`.

     - **Data Type**: `TEXT`, `NUMBER`, `DATE`, `BOOLEAN_YN` (Yes/No toggle).

     - **Source Type**:

       - `MANUAL`: Free data input by planning officers.

       - `LINKED_LOOKUP`: Pulls dynamic attributes from Product Master, Supplier Master, or Buyer Master.

       - `AGGREGATE`: Live calculation (`SUM`, `AVG`, `MIN`, `MAX`, `COUNT`) of selected column ranges.

       - `FORMULA_CALCULATION`: Custom mathematical formula (e.g. `[Qty] * [Unit CBM]`).

     - **Default Width (px)**: Resizable width stored server-side.

   - 📌 **`Freeze & Hide Columns` Manager Drawer:**

     - List of all sheet columns with visibility checkboxes.

     - Left-pin, Right-pin, and Unpin controls with persistent localStorage caching.

   - 📜 **`Audit History & Change Log` Side Drawer:**

     - Immutable trail recording every single cell edit, column creation/deletion, and row mutation with Timestamp, User Initials, Old Value, and New Value.

   - 📦 **`Container Optimization & CBM Calculator` Button & Modal:**

     - Opens container load calculation panel.

   - 📥 **`Import / Export Workbook`:**

     - `Export to Excel (.xlsx)` with complete cell styling and formulas.

     - `Import from Excel (.xlsx)` with column mapping.



3. **Dynamic Spreadsheet Grid Layout:**

   - **Row Grouping:** Automatically groups line items by Product Sub-Category with collapsible group summary rows showing sub-total quantities and total volume.

   - **Column Drag-and-Drop Resizing:** Grab column border to resize; persisted to database via `PlanningColumn.width_px`.

   - **Column Groups & Cascading Logic:**

     - Group-numbered series (e.g. `Mum 1`, `Mum 1 Remarks`, `NO. OF PKG MUM1`, `TOTAL WEIGHT MUM1`, `TOTAL CBM MUM1`).

     - Deleting or hiding a group column cascades cleanly to all related package, weight, and remark group columns.

   - **Special `Approval Date` Column:**

      - Interactive eye icon (`👁️`) on each cell displaying full chronological history of who approved the date and when.

    - **Excel-Style Column Header Filtering & Live Server Search:**

      - Filter funnel icon (`Y`) on every column header (including `ITEM`, `TEST(Y/N)`, `APPROVAL DATE`, and dynamic columns).

      - **Live Filter Popover**: Queries `/api/v1/planning/sheets/{id}/filter-values` across the entire sheet dataset (1384+ items) rather than only the currently loaded browser page.

      - **Instant Search Box**: Real-time debounced text search inside the popover dynamically matches and returns items from the whole database, even for unrendered or newly added Product Master items.

      - **Checkbox Selection**: Multi-select checkboxes with `(Select All)` and `Clear` controls, exact item frequency counts `(N)`, and full name tooltips.

      - **Server-Side Application**: Applying filters queries the database with server-side ILIKE and IN matching, updating the grid pagination and footer count (`Showing 1-N of Total`).

    - **Inline Cell Editing & CRM Status Swatch:**

      - Single-click or double-click to edit cell values inline.

      - Hover over any cell to display the **Status Swatch Picker**:

        - 🔴 **Red Swatch:** Requirement Raised

        - 🔵 **Blue Swatch:** Ordered to Manufacturer

        - 🟢 **Green Swatch:** Purchased / In Transit

        - 🎨 **Custom Color Swatches:** Admin-defined operational status tags.

      - Real-time WebSocket broadcasting sends cell updates to all connected users, preventing concurrent edit overwrites.



4. **Container CBM Optimization Engine:**

    - Computes total loaded volume in cubic meters ($m^3$) and gross weight ($kg$) live across all planned item rows:

      $$\text{Total CBM} = \sum (\text{Row Quantity} \times \text{Product Packaging Unit CBM})$$

      $$\text{Total Weight} = \sum (\text{Row Quantity} \times \text{Product Packaging Gross Weight})$$

    - **Container Preset Specifications:**

      - **20FT Standard Container:** Max $28.00 \text{ CBM} / 21,500 \text{ kg}$

      - **40FT Standard Container:** Max $58.00 \text{ CBM} / 26,000 \text{ kg}$

      - **40FT High Cube (HC) Container:** Max $68.00 \text{ CBM} / 26,000 \text{ kg}$

      - **LCL (Less than Container Load)**

    - **Visual Load Meter:**

      - Percentage filled gauge: 🟢 Optimal ($< 95\%$), 🟡 Near Capacity ($95–100\%$), 🔴 Overloaded ($> 100\%$).

      - Multi-container distribution recommendations (e.g. `Requires 2 x 40FT HC + 1 x 20FT Container`).



### Test Cases for Shipment Planning Module

- [ ] Open `/planning`, switch between branch sheet tabs, verify active sheet grid renders with default Inhyma organization.

- [ ] Type an item query (e.g. `FR900` or `DKX4540`) into the top **Organization-Wide Search Bar**. Verify it live-filters the active branch sheet (`Inhyma Mumbai`) and opens the cross-branch results dropdown.

- [ ] In the search dropdown, verify it displays match counts across all branches of the active organization (e.g. `Inhyma Mumbai`, `Inhyma Ahmedabad`, `Inhyma Indore`).

- [ ] Click `Switch to Branch →` or click an item under another branch (e.g. `Inhyma Ahmedabad`). Verify active tab switches to `Inhyma Ahmedabad` with the filter applied immediately.

- [ ] Click the clear icon (`✕`) in the top search bar. Verify active sheet filter clears and the full sheet is restored.

- [ ] Click filter funnel on `ITEM` column, verify filter popover opens with distinct items across all rows in the workbook.

- [ ] Paste a product name (e.g. `GF1000FD Granular Filler` or unrendered item) into `Search items...` in filter popover. Verify matching item appears in the list with count.

- [ ] Select matching item, click `Apply`. Verify the grid updates and displays only the matching product with accurate footer count.

- [ ] Click filter funnel again, click `Reset` or `Clear All Filters`. Verify all 1384+ items render again.

- [ ] Click `+ Add Column`, create column `Test Number` with type `NUMBER` and source `MANUAL`. Verify column appears in grid.

- [ ] Edit a cell in the grid, change value, click off, verify cell value persists on reload.

- [ ] Hover over a cell, click the status swatch, select Green (`Purchased`). Verify cell displays green status tag.

- [ ] Click the `Approval Date` column eye icon, verify approval history drawer/popover opens.

- [ ] Click `Container Optimization Calculator`, verify total CBM and weight compute accurately against 20FT / 40FT / 40FT HC container capacity limits.

- [ ] Open `History & Change Log` drawer, verify the cell edits and column additions are logged with timestamps and user names.

- [ ] **TC-PLAN-01: Canonical Column Structure & Absence of Duplicate Manual Columns:**

  - Open `/planning` and navigate across organization sheets (`Inhyma Mumbai`, `Inhyma Ahmedabad`, `Inhyma  Indore`, `inhyma chennai`) and buyer sheets (`Om Packaging - Mulund`, `Darsh Impex Mumbai - Mulund`).

  - Verify every sheet strictly renders canonical column ordering:

    1. Approval / System headers (`TEST(Y/N)`, `APPROVAL DATE`).

    2. Consignment quantity & remarks pairs (`<Label> <N>`, `<Label><N> Remarks`).

    3. Shared linked specification block (`Brand of Supplier`, `City`, `PKG QTY`, `UNIT WEIGHT/PKG (KG)`, `CBM/PKG (KG)`).

    4. Group calculation formulas (`NO. OF PKG <LABEL><N>`, `TOTAL WEIGHT <LABEL><N>`, `TOTAL CBM <LABEL><N>`).

    5. Status flag (`TALLY ENTRY POSTED (Y/N)`).

  - Verify that `Inhyma Mumbai` does NOT contain redundant manual duplicate columns for `PKG QTY`, `UNIT WEIGHT/PKG (KG)`, `CBM/PKG (KG)`, or `Supplier City` at the end of the sheet.

- [ ] **TC-PLAN-02: Hyphenated & Leading-Zero Consignment Group Parsing (MP -06, GJ14):**

  - Switch to `Inhyma  Indore` (`/planning`).

  - Verify `MP -06` correctly displays its companion formula columns: `NO. OF PKG MP6`, `TOTAL WEIGHT MP6`, and `TOTAL CBM MP6`.

  - Enter a test quantity in `MP -06` (e.g., `100`).

  - Verify `NO. OF PKG MP6` evaluates as $100 / [\text{PKG QTY}]$, `TOTAL WEIGHT MP6` evaluates as $[\text{NO. OF PKG}] \times [\text{UNIT WEIGHT}]$, and `TOTAL CBM MP6` evaluates as $[\text{NO. OF PKG}] \times [\text{CBM/PKG}]$ in real time.

- [ ] **TC-PLAN-03: Next Group Atomic Creation Without Spec Duplication:**

  - On any sheet (e.g. `Inhyma Mumbai`), click **`+ Next Mum`** (or `+ Next <Label>`).

  - Verify the new consignment column group (e.g. `Mum 51`, `Mum51 Remarks`, `NO. OF PKG MUM51`, `TOTAL WEIGHT MUM51`, `TOTAL CBM MUM51`) is atomically created.

  - Verify that the 5 shared specification columns (`Brand of Supplier`, `City`, `PKG QTY`, `UNIT WEIGHT/PKG (KG)`, `CBM/PKG (KG)`) remain single, linked lookup columns and are NOT duplicated.

- [ ] **TC-PLAN-04: Packaging Specifications Backfill & Read-Time Product Prefetch:**

  - Navigate to `/planning` and open `Inhyma Mumbai`.

  - Locate any product row with planned consignment quantity (e.g., Row 1 `Carton boxes for band sealer without thermocol`, with `Mum 48 = 48`).

  - Verify that `PKG QTY`, `UNIT WEIGHT/PKG (KG)`, and `CBM/PKG (KG)` display exact values from Product Master (`1.000`, `898.000`, `65.000000`).

  - Verify that companion formulas calculate immediately: `NO. OF PKG MUM48 = 48.0`, `TOTAL WEIGHT MUM48 = 43104.0`, `TOTAL CBM MUM48 = 3120.0`.

- [ ] **TC-PLAN-05: First Column ("ITEM") Excel-Style Drag-to-Resize & Server Persistence:**

  - Navigate to `/planning` and open any branch sheet (e.g. `Inhyma Mumbai`).

  - Hover the cursor over the right boundary line of the first column header (`ITEM`).

  - Verify the cursor transforms into `col-resize` with a 5px interactive drag zone and active blue highlight (`#2563EB`) on mousedown.

  - Click and drag horizontally to widen the column (e.g. from default 240px to 380px).

  - Verify that the entire column (header `<th>`, all row cells `<td class="item-col-cell">`, and skeleton rows) expands buttery smooth in real time without lag.

  - Verify that subsequent frozen columns (`TEST(Y/N)`, `APPROVAL DATE`, user-pinned columns) automatically push outward smoothly and recalculate their sticky left offsets without overlapping.

  - Release the drag handle; verify network activity fires `PATCH /api/v1/planning/sheets/{sheet_id}/item-width` with `{ width_px: 380 }`.

  - Reload the page; verify the custom 380px width remains persisted from `planning_sheets.item_width_px`.

  - Drag the column narrower (e.g. to 160px), reload the page, and verify the 160px width is preserved.

- [ ] **TC-PLAN-06: Entity Selection & Empty-State Sheet Creation for Buyers:**

  - Navigate to `/planning`.

  - Click the **Entity** filter dropdown.

  - Select a buyer that does not have an existing sheet (e.g. `QA Automated Buyer 1792732947`).

  - **Verify Entity Switching:**
    - The Entity trigger displays `👤 [Buyer Name]`.
    - The previous sheet (`Om Packaging - Mulund`) and table rows are immediately cleared.
    - The page title updates to `Shipment Planning / [Buyer Name]`.
    - The URL updates without stale `?sheet=...` parameters, preventing any bounce-back to the previous entity.

  - **Verify Empty-State Card:**
    - A dedicated card displays with icon, title *"No Planning Sheet Found for [Buyer Name]"*, and a prominent button: **`[ + Create Planning Sheet for [Buyer Name] ]`**.

  - **Verify 1-Click Sheet Creation:**
    - Click **`[ + Create Planning Sheet for [Buyer Name] ]`**.
    - The *Add Sheet (Branch Tab)* modal opens with **Buyer Profile** selected, the target buyer pre-selected, and the branch location field populated with `"Main"`.
    - Click `Create Sheet`.
    - The sheet creates, the new tab appears, and the planning grid loads immediately for the buyer.

- [ ] **TC-PLAN-07: Status Picker Double-Click Protection & History Deduplication:**
  - Navigate to `/planning`.
  - Enter a quantity (e.g. `50`) on an empty consignment cell (e.g. `Mum 1`).
  - Verify that the cell auto-assigns the blue status tag (`🔵 Ordered to Manufacturer`).
  - Click the eye icon (`👁️`) on the item row to open the **Cell Change History** popover.
  - Verify two distinct entries are displayed:
    1. `🔵 Ordered to Manufacturer` (Status Color Tag).
    2. `✏️ (empty) -> 50` (Quantity Number Value).
  - Click on the cell status dot to open the **Status Picker** popover.
  - Rapidly double-click or spam-click the red tag (`🔴 Requirement`).
  - **Verify Immediate Dismissal & Lockout:**
    - The popover closes instantly on the first click.
    - All picker buttons disable upon click, preventing duplicate network triggers.
    - In-flight cell request guard (`pendingStatusCellsRef`) ignores duplicate calls for the same cell.
  - Open the **Cell Change History** popover again.
  - **Verify Single Change Entry:**
    - Verify that only **ONE** `🔴 Requirement` entry is logged.
    - Verify that no duplicate identical status records exist for the same timestamp.

---



## 15. USER MANAGEMENT: Users Module



- **Route:** `/users` (also aliased from `/employees`)

- **Purpose:** Complete enterprise person directory for both login-enabled staff and workforce personnel without system access, HR profiles, positions held, reporting hierarchy, and password governance.



### 15.1. Users Table Columns

1. **Checkbox:** Row selector.

2. **SR. NO.:** Index.

3. **EMPLOYEE NAME & AVATAR:** Initials circle + Full Name.

4. **USERNAME:** System login ID (or placeholder for workforce members with `has_login=False`).

5. **EMAIL:** Official corporate email (null for `has_login=False`).

6. **DEPARTMENT / ROLE:** Assigned role/department badges (e.g. `Sales`, `Procurement`, `Admin`).

7. **REPORTING MANAGER:** Manager's full name.

8. **STATUS:** `ACTIVE`, `INACTIVE`, `SUSPENDED`, `LOCKED`, `PASSWORD_CHANGE_REQUIRED`.

9. **ACTIONS:**

   - 👁️ **View Profile Drawer:**

     - HR Profile details (contact, gender, DOB, joining date, address, emergency contact, notes)

     - **Section 6.5: Positions & Reporting Structure:**

       - **Positions:** Badges of all held positions (e.g. `Sales Manager (Primary)`, loaded dynamically via `/positions/holders-for-user/{id}`)

       - **Reports To:** Listing of all managers by relationship type (e.g. `PRIMARY REPORTING: manager id ...`)

       - **Direct Reports:** Listing of direct subordinate personnel (e.g. `PRIMARY REPORTING: employee id ...`)

     - **Section 7: Active Login Sessions:** Lists active device sessions with remote revocation (for accounts with `has_login=True`).

   - ✏️ **Edit Profile:** Opens unified profile drawer, now integrating basic identity details, contact information, employment profile, position assignments, and **Department & Role Assignments** (consolidating the previously separate "Manage Departments" action into one unified interface).

   - 🔑 Reset Password (generates temporary password for login-enabled users)

   - 🔑 Direct Permission Overrides (`🔑 Edit permissions`)

   - ⏸️ **Deactivate User:** Immediately deactivates the user account (`status=INACTIVE`, `is_active=False`), revokes all active device sessions, and prevents login or access token usage. Available for all accounts that are not already inactive (including Active, Password Change Required, Pending, and Locked).

   - ▶️ **Activate User:** Restores an inactive account to `ACTIVE` (`is_active=True`), immediately restoring the ability to log in.

   - ⚡ **Unsuspend Account:** Restores a suspended user back to active status.

   - 🔓 **Unlock Account:** Clears temporary failed-login lockout.

   - 🚪 **Force Logout:** Immediately and forcibly logs out the user across all devices in real time. Sets a revocation timestamp, disconnects live WebSockets, terminates active sessions, and immediately invalidates in-flight access tokens so any ongoing user activity instantly triggers session expiry and redirects them to the login page.

   - 🚫 **Permanent Removal of User Deletion:** User deletion is completely removed from the UI and disabled backend-wide (`DELETE /users/{id}` returns 400 Bad Request) to maintain transactional integrity, foreign key relations, and audit history.



### 15.1.1. Multi-Select & Collective Bulk Deactivation

- **Select All Checkbox (Header):** Selects or deselects all visible user accounts across the current page.

- **Row Checkboxes:** Click to select individual user accounts for collective action.

- **Collective Action Bar & Buttons:**

  - Whenever 1 or more user accounts are selected:

    - **Header Collective Deactivate:** An amber `Deactivate Selected (N)` button appears in the page header actions alongside `+ Create User Account`.

    - **Toolbar Selection Bar:** Renders count pill `N users selected` + `⏸️ Deactivate (N)` amber button + `Deselect all` link.

  - **Account Safety & Protection Guards:**

    - Automatically guards the administrator's currently authenticated account: attempting to collective-deactivate self is excluded with notification.

    - Automatically guards `super_admin` accounts: attempting to collective-deactivate Super Administrators is excluded.

    - Automatically skips accounts that are already inactive.

    - Displays confirmation dialog indicating total accounts to be deactivated and any skipped accounts.

    - Executes batch deactivation via `POST /users/{id}/deactivate` using `Promise.allSettled`, immediately setting account status to `Inactive`, terminating sessions, and clearing selection.



### 15.2. Add / Edit User Form Fields

- **Login Credentials Toggle:**

  - **Give this person ERP login access (`has_login`)** (*Checkbox, default checked*).

  - Uncheck for workforce records with no login (e.g. factory worker, driver, temporary labor, consultant) -- Username, Email, Phone, and Password become optional/disabled.

- **Account Identity (when `has_login=True`):**

  - **First Name** (*Required*), **Middle Name**, **Last Name** (*Optional*).

  - **Display Name** (*Required*): Shown throughout the system in place of raw username.

  - **Position** (*Optional, not red-marked*): Dropdown placed alongside Display Name, dynamically extracted from active positions in the Positions catalog (`/positions/all`). When selected, establishes an initial primary position assignment for the user.

  - **Username** (*Optional*): If left blank, derived automatically from email.

  - **Work Email** (*Required if has_login=True*).

  - **Mobile Number** (*Required if has_login=True*): Phone number with country dial code.

  - **Password** (*Required if has_login=True*): Initial temporary password field equipped with an integrated **Eye toggle button** (`👁️` / `👁️‍🗨️`) allowing the administrator to preview or conceal the plaintext password before submitting.

- **HR & Employment Profile:**

  - **Employee Code**: Unique staff ID (e.g. `EMP-1042`).

  - **Gender**: `Male`, `Female`, `Other`.

  - **Date of Birth** & **Date of Joining**: Date pickers.

  - **Employment Type**: `Full Time`, `Part Time`, `Contract`, `Intern`.

  - **Employment Status**: `Active`, `Inactive`, `On Leave`, `Terminated`, `Resigned`.

  - **Assign Initial Department**: Dropdown of available department roles (defaults to `-- Default: User (System) --`).

    - **Default "User" Assignment:** If left unselected or if no department is specified, the system automatically assigns the individual to the default system **"User"** role (both for login users and workforce records).

    - Selecting a department triggers automatic detection of that department's manager.

  - **Assign Reporting Manager**: Dropdown placed directly beneath "Assign Initial Department".

    - **Automatic Manager Auto-Wiring:** When an initial department is selected, the system immediately queries `/api/v1/users/department-manager/{role_id}` and automatically pre-fills that department's designated manager with a helpful blue confirmation badge.

    - **Manual Override:** The administrator can change or clear the manager to any other user or `-- None (No Manager) --` as needed.

  - **Drawer Usability & Scroll Bar:** The Create User Account modal features a responsive vertical scroll container with a styled scrollbar and sticky bottom footer (`Cancel` and `Create User Account` action buttons), ensuring all inputs remain comfortably accessible on viewports of all heights.



### 15.3. One-Time Temporary Password Modal

- When creating a user or resetting a password, the system generates a secure temporary password.

- Displays password in a highlighted box with a **`📋 Copy Password`** button.



### 15.4. Edit User Profile & HR Details Drawer

- **Drawer Layout & Usability:** Side-drawer overlay with full viewport height (`calc(100vh - 60px)`), smooth vertical scroll container (`flex: 1`, `overflowY: auto`), and a pinned sticky footer (`.form-actions`).

- **Footer Action Buttons:** `Cancel` (secondary outline button) and `Save Changes` (primary blue button) pinned neatly at the bottom with fixed height (38px), aligned horizontally to the right without vertical distortion.

- **Sections Included:**

  - **Basic & Identity Details:** First Name, Middle Name, Last Name, Username (*Required*), Display Name, Employee Code.

  - **Contact Information:** Work Email (*Required*), Mobile / Phone Number (*Required*), Emergency Contact.

  - **Employment & HR Profile:**

    - **Reporting Manager & Position:** Side-by-side dropdown selectors. The **Position** dropdown is dynamically populated from active positions in `/positions/all` and automatically pre-selected with the employee's current primary position assignment. Selecting a new position or `-- None (No Position) --` updates the assignment atomically upon clicking `Save Changes`.

    - **Gender & Employment Type:** `Gender` (`Male`, `Female`, `Other`, `Prefer Not to Say`) and `Employment Type` (`Full Time`, `Part Time`, `Contract`, `Intern`, `Temporary`).

    - **Employment Status & Dates:** `Employment Status` (`Active`, `Inactive`, `On Leave`, `Terminated`, `Resigned`), `Date of Joining`, and `Date of Birth`.

  - **Address & Location Details:** Street Address, City, State / Province, Country, Postal / PIN Code.

  - **Internal Administrator Notes:** Free-form text area for administrative annotations.

  - **Department & Role Assignments (Integrated):**

    - Displays active department/role memberships with badges, primary indicator (`PRIMARY`), assignment types (`PRIMARY`, `SECONDARY`, `TEMPORARY`, `PROJECT`, `ACTING`), and remove action (`×`).

    - Inline selector to add new departments with role dropdown, assignment type, and effective dates.

    - Synchronizes changes immediately upon addition or removal without closing the drawer, eliminating the need for a separate modal.



### 15.1.2. Cross-ERP User Federation, Password Synchronization & Sign-Out Everywhere

- **Central Control Plane Sync (`ERP_Main`):**

  - Users created or updated in `ERP_Main` with access to Yinglima are provisioned via `POST /api/v1/internal/users/sync`.

  - Unchecking Yinglima access in `ERP_Main` soft-deletes the local user record (`is_active=False`, `deleted_at=now()`) and revokes all active sessions.

- **Bi-Directional Password Synchronization:**

  - Password changes initiated in Yinglima (`POST /users/{id}/reset-password` or `/auth/change-password`) asynchronously push the updated Argon2id hash to `ERP_Main` (`POST /api/v1/auth/internal/sync-password`), which then fans out to peer spokes (e.g. Inhyma).

  - Outbound calls fail silently if `ERP_Main` is unreachable, with the Durable Access Sync Engine handling queued synchronizations.

- **Global Sign-Out Everywhere Fanout:**

  - When `ERP_Main` issues a global signout fanout, Yinglima receives `POST /api/v1/auth/internal/revoke-user-tokens`.

  - **Multi-Identifier Matching:** Accurately locates local user by `id`, `user_id`, `email`, or `username`.

  - Instantly revokes all active refresh tokens and pushes WebSocket `FORCE_LOGOUT` (`code 4001`) to connected browser sessions.



### 15.5. Test Cases for Users Module

- [ ] Open `/users`, verify User Accounts & Passwords table loads with search bar, status dropdown filter, and `+ Create User Account` button.

- [ ] Verify each row has a checkbox and the table header has a `select-all-checkbox`.

- [ ] Check multiple user checkboxes. Verify:

  - Header actions render an amber **`Deactivate Selected (N)`** button.

  - Toolbar renders a selection indicator: `N users selected` with a **`⏸️ Deactivate (N)`** button and a **`Deselect all`** link.

- [ ] Click `Deselect all`. Verify all checkboxes are cleared and the bulk deactivate buttons disappear.

- [ ] Check a selection that includes your own authenticated account or a `super_admin`. Click `Deactivate Selected`. Verify:

  - Confirmation modal pops up warning that own account and Super Admin accounts cannot be deactivated and will be skipped.

  - Remaining eligible accounts are deactivated (`status=Inactive`, `is_active=False`) and active sessions terminated in real-time.

- [ ] **Deactivation Login Block**: Verify that any deactivated user cannot log in at `/login`, receiving an immediate `403 Forbidden: Account is inactive or locked.` and cannot authenticate.

- [ ] **Real-Time Force Logout**: Click `🚪 Force Logout` on an active user account. Verify:

  - User's active session is terminated in the database.

  - User's active browser tabs receive a real-time WebSocket disconnect (`code 4001`) and are immediately redirected to `/login`.

  - In-flight access tokens are invalidated via cache timestamp check (`auth_force_logout:{user_id}`).

- [ ] **Cross-ERP Sign-Out Everywhere**: When sign-out everywhere is triggered from `ERP_Main`, verify Yinglima's `POST /api/v1/auth/internal/revoke-user-tokens` receives the call, matches the user via multi-identifier resolution, revokes tokens, and logs the user out.

- [ ] **Bi-Directional Password Sync**: Change a user's password locally in Yinglima. Verify that `ERP_Main` receives the update via `POST /api/v1/auth/internal/sync-password` and propagates it to Inhyma without errors.

- [ ] Click `✏️ Edit Profile` on a user row. Verify:

  - Drawer opens with identity, HR attributes, and dynamically populated **Position** dropdown.

  - **Department & Role Assignments** section is displayed directly inside the drawer.

  - Adding or removing departments updates the user's role assignments immediately with live table sync.



---



## 16. USER MANAGEMENT: Departments & Permissions (RBAC) Module



- **Route:** `/rbac`

- **Purpose:** Department role definitions, organizational hierarchy nesting, department managers, permission matrices, and user reassignment.



### 16.1. Departments Table

- **Columns:** Checkbox, Sr. No., Department Name, Created Date, Actions.

- **Header Actions:** `+ ADD NEW DEPARTMENT`, `Bulk Delete`.



### 16.2. Department View / Edit Modal

- **Department Name** (*Required*): Title (reserved system roles like `super_admin` are protected).

- **Department Code**: Optional short organizational code (e.g. `SALES`). Purely organizational labeling.

- **Parent Departments Section (in Department Details):**

  - Displays all currently assigned parent departments as removable badge tags (`🏢 Department Name (CODE) [×]`).

  - Dropdown selector (`-- Add another parent department --`) with eligible roles (excluding self, active children, active parents, and system admin) + `+ Add Parent` button.

  - Immediately unlinks or adds parents with live real-time sync. Supports **multiple parent departments** per department.

- **Description**: Text area.

- **Department Managers Section:**

  - Select user to designate as **Department Manager**.

  - Roster displays manager with `⭐ MANAGER` badge.

  - **`🔑 Edit permissions` Button:** Opens per-user direct permission override drawer to grant manager extra elevated privileges without altering base role.

  - Setting a manager automatically updates reporting hierarchy for department members.

- **Department Members Section ("Users in this Department"):**

  - Add / remove employees assigned to this department with real-time membership counts.

- **Child Departments Card (directly beneath "Users in this Department"):**

  - Dedicated card in the left column displaying all sub-departments that report to or are nested under the active department.

  - **Header Badge:** Displays active count of connected sub-departments (e.g. `2 sub-departments`).

  - **Add Child Selector:** Dropdown `Select child department to add...` + `+ Add` button.

  - **Child Department Row:**

    - Green initial icon + Department Name + Code badge.

    - Member count badge (`👤 X members`).

    - `View` button: Directly navigates to and opens that child department.

    - `Remove` button: Unlinks the child department from this parent.

    - Clean empty state when no child departments are connected.

- **Bidirectional Live Auto-Sync:** Connecting a child department under a parent (e.g. Sales under Operations) immediately updates both departments' rosters so Operations lists Sales as a child, and Sales lists Operations as a parent.

- **DAG Cycle Detection:** Server-side validation prevents circular hierarchies (e.g. A -> B -> A or A -> B -> C -> A) and returns HTTP 409 Conflict with an alert.

- **Permission Matrix Grid:**

  - Grouped by module cards: `Dashboard`, `Contact`, `Inventory`, `Inquiries & Quotations`, `Product Prices`, `Local Purchase`, `Sale`, `Planning`, `User Management`, `Configurations`, `Audit`, `Trash`.

  - `Select All` / `Deselect All` toggles per module card.

  - Granular operation checkboxes:

    - **Inquiries & Quotations (`inquiry.*`):** View, Create, Update, Delete, Approve Quotation, Export Line Items, Import Line Items, Send Messages (Email/WeChat).

    - **Product Prices (`product_price.*`):** View, Create, Update, Delete, Export, Import.

    - **Local Purchase (`local_purchase.*`):** View, Create, Update, Delete, Export / Print.

    - **Sale Process (`sale_process.*`):** View, Create, Update, Approve / Status Workflow, Delete, Export (Excel & Trade Documents).

    - **Stock Movements (`stock_movement.*`):** View, Create (Inward / Outward), Cancel / Reverse, Delete.

    - **Notification Rules (`notification_settings.*`):** View, Manage Rules & Recipients.

    - **Positions & Designations (`position.*`):** View, Create, Update, Delete.

  - Checkboxes for all other core platform modules (`.view`, `.create`, `.update`, `.delete`, `.export`, `.import`, `.bulk_action`, etc.).

- **Clone Department Button:** Creates a copy of the department with all permissions pre-checked.

- **Safe Delete with Reassignment Modal:** If users exist in a department scheduled for deletion, prompts administrator to select a replacement department to reassign those employees before deletion proceeds.



### 16.3. Test Cases for Departments & Permissions Module

- [ ] **RBAC Module Cards Verification:** Open `/rbac`, create or open any test department. Verify that dedicated permission cards appear for:

  - **Sale Process:** Displays 6 checkboxes (`View`, `Create`, `Edit`, `Update Status / Workflow`, `Delete`, `Export Excel & CI/Packing Docs`).

  - **Stock Movements:** Displays 4 checkboxes (`View`, `Create`, `Cancel / Reverse Movement`, `Delete`).

  - **Notification Rules:** Displays 2 checkboxes (`View`, `Manage Notification Rules`).

  - **Positions & Designations:** Displays 4 checkboxes (`View`, `Create`, `Edit`, `Delete`).

  - **Inquiries & Quotations:** Displays 8 checkboxes (`View`, `Create`, `Update`, `Delete`, `Approve Quotation`, `Export Line Items`, `Import Line Items`, `Send Messages (Email/WeChat)`).

  - **Product Prices:** Displays 6 checkboxes (`View`, `Create`, `Update`, `Delete`, `Export`, `Import`).

  - **Local Purchase:** Displays 5 checkboxes (`View`, `Create`, `Update`, `Delete`, `Export / Print`).

- [ ] **Restricted User Navigation & Action Gating Test:**

  1. Assign a test user to a department possessing only `sale_process.view`, `stock_movement.view`, and `notification_settings.view` (read-only).

  2. Log in as that user: verify the sidebar items for `Sale Process`, `Stock Movement`, and `Notification Rules` are visible.

  3. Navigate to `Sale Process`: verify "+ Create Sale Process" and "Export" buttons on the top right are hidden. In row actions, verify "Edit Order" and "Delete" are hidden.

  4. Navigate to `Stock Movement`: verify "+ New Inward Entry" and "+ New Outward Entry" buttons are hidden. In the table, verify "Cancel" and "Delete" action buttons are hidden.

  5. Navigate to `Notification Rules`: verify that the status toggle buttons (`ACTIVE`/`OFF`) are disabled (click has no effect) and the "Edit" button is replaced by a read-only tag (`🔒 Read Only`).

  6. Attempt to perform direct REST calls without permissions (e.g., `POST /api/v1/sales/orders` or `POST /api/v1/stock/movements`): verify backend strictly returns `403 Forbidden`.

- [ ] Open `/rbac`, click on a department (e.g. `Operations`), verify Left Column renders:

  1. Department Details (Name, Description, Code, Parent Departments)

  2. Managers in this Department

  3. Users in this Department

  4. **Child Departments** (directly beneath Users in this Department)

- [ ] In **Child Departments** card, select another department (e.g. `Sales`) from the dropdown and click `+ Add`. Verify `Sales` appears in the list with member count and `View` / `Remove` buttons.

- [ ] Click `Back to Departments` and open `Sales`. Verify `Operations` is displayed under **Parent Departments** as a removable badge tag (`🏢 Operations [×]`).

- [ ] In `Sales`, select another parent department (e.g. `Executive Management`) and click `+ Add Parent`. Verify `Sales` now lists multiple parents (`Operations` and `Executive Management`).

- [ ] Attempt to add `Operations` as a child department of `Sales`. Verify cycle detection triggers and rejects the circular connection with the error: *"This would create a circular department hierarchy."*

- [ ] In `Operations` -> Child Departments, click `Remove` next to `Sales`. Verify `Sales` is unlinked and no longer appears under Child Departments or as Sales's parent.

- [ ] **RBAC In-Memory Cache & Instant 0ms SWR Rendering:**
  1. Open DevTools Network tab.
  2. Navigate to `/rbac`: verify `GET /api/v1/rbac/roles` and `/permissions` load quickly. On cached hits, verify response latency drops to **< 100 ms** (benchmark: ~85.6 ms vs ~753.9 ms previously).
  3. Navigate away to `/users` and immediately return to `/rbac`: verify department list, roles, and permissions grid render at **0 ms** from `rbacPageCache` without blank loading states.
  4. Modify a department's permissions or name: verify backend invalidates `rbac::roles_with_permissions` and changes immediately reflect without stale data.




---



## 17. CONFIGURATIONS: HSN Codes Master Module



- **Route:** `/masters/hsn`

- **Table Columns:** SR. NO., HSN CODE, DESCRIPTION, GST %, IMPORT DUTY %, PURCHASE VAT %, REFUND VAT %, STATUS, ACTION.

- **Add / Edit Form Fields:**

  - **HSN Code** (*Required*): 6 to 8 digit customs tariff code.

  - **Description**: Trade description.

  - **GST %**: Goods and Services Tax percentage (e.g. 18%).

  - **Import Duty %**: Indian customs import tariff percentage (e.g. 7.5%).

  - **Purchase VAT %**: China domestic input VAT percentage (e.g. 13%).

  - **Refund VAT %**: China export rebate percentage (e.g. 13%).

  - **Status**: `Active` / `Inactive`.



### Test Cases

- [ ] Open `/masters/hsn`, verify table displays all 7 columns (`HSN Code`, `Description`, `GST %`, `Import Duty %`, `Purchase VAT %`, `Refund VAT %`, `Status`).

- [ ] Click `+ New HSN Code`, verify all 4 tax percentage input boxes (`GST %`, `Import Duty %`, `Purchase VAT %`, `Refund VAT %`) open completely blank with soft grey placeholder `0` (not pre-filled with literal `0` text requiring deletion).

- [ ] In `+ New HSN Code`, enter HSN Code: `8422.9090`, GST %: `18`, Import Duty %: `7.5`, Purchase VAT %: `13`, Refund VAT %: `13`. Save and verify record appears in table with all 4 tax rates. Delete test record after verification.

- [ ] Click `📥 Sample Template` in HSN Master; verify downloaded template contains `Import Duty %` and `Purchase VAT %` with valid sample values.

- [ ] In HSN Master, upload CSV with `Update Existing` checked; verify existing HSN codes update their `Import Duty %` and `Purchase VAT %` without throwing duplicate code errors.

- [ ] In Product Master (`/masters/products`), open Add Product modal; select an HSN code from the dropdown. Verify both `Purchase VAT %` and `Refund VAT %` automatically populate from the selected HSN code.

- [ ] In Product Master, verify the detail drawer renders both `Purchase VAT %` (blue badge) and `Refund VAT %` (green badge).

- [ ] Click `📥 Sample Template` in Product Master; verify downloaded template contains `Purchase VAT %`.

- [ ] In Product Master, upload CSV with `Update Existing` checked; verify `Purchase VAT %` updates accurately.

- [ ] When a product with an HSN code is scoped to Inhyma organization, verify `sync_inhyma.py` packages `hsn_code`, `gst_percent`, `import_duty_percent`, and `purchase_vat_percent` in the synchronization payload.

- [ ] In Inhyma ERP, verify that the linked Tax record correctly receives `GST %` (from Yinglima HSN GST %) and `Import Duty %` (from Yinglima HSN Import Duty %), and updates dynamically when product/tax rates are revised in Yinglima.

- [ ] When updating an existing product in Yinglima, verify that all physical dimensions (`length_cm`, `width_cm`, `height_cm`, `packaging_unit_cbm`), packaging attributes (`packaging_gross_weight`, `packaging_net_weight`, `packaging_quantity`), specifications, descriptions, color, and material dynamically update in Inhyma ERP upon synchronization.

- [ ] When a product is deactivated in Yinglima, verify that Inhyma ERP transitions the product to `status = 'INACTIVE'` with `deleted_at = None`, ensuring it immediately appears under Inhyma's Inactive tab (rather than being hidden in soft-delete trash).



---



## 18. CONFIGURATIONS: Geography Masters (Countries, Provinces, Cities)



### 18.1. Countries (`/masters/countries`)

- **Fields:** Country Name (*Required*), ISO Code 2 (e.g. `CN`, `IN`, `US`), ISO Code 3, International Phone Dial Code (e.g. `+86`, `+91`), Currency Code, Status.



### 18.2. Provinces / States (`/masters/states`)

- **Fields:** Country (*Required dropdown*), State / Province Name (*Required*), State Code, Status.
- **Top Filter Toolbar:** Country Filter using `SearchableFilterDropdown` (`All Countries / National Levels`) with pinned `Search / Type here...` search box and 0ms live filtering. Orange Search button removed; reactive filtering on selection; Reset button aligned in straight line.

### 18.3. Cities (`/masters/cities`)

- **Fields:** Country (*Required*), State / Province (*Required, scoped to Country*), City Name (*Required*), City Code, Status.
- **Top Filter Toolbar:** Country Filter (`All Countries`) and cascading Province/Region Filter (`All Provinces / Regions`) using `SearchableFilterDropdown` with instant search and straight-line Reset button.



---



## 19. CONFIGURATIONS: Currencies Master Module



- **Route:** `/masters/currencies`

- **Fields:** Currency Code (*Required*, e.g. `USD`, `CNY`, `INR`, `EUR`), Currency Name, Currency Symbol (e.g. `$`, `¥`, `₹`, `€`), Exchange Rate to Base Currency, Is Base Currency (`true`/`false`), Status.



---



## 20. CONFIGURATIONS: Units of Measurement (UOM) Master Module



- **Route:** `/masters/uom`

- **Fields:** UOM Name (*Required*, e.g. Pieces, Sets, Kilograms, Meters, Rolls, Boxes), UOM Code (e.g. `PCS`, `SET`, `KG`), Symbol, Unit Category, Status.



---



## 21. CONFIGURATIONS: Organization Settings & Company List



### 21.1. Organization Settings (`/organization`)

- **Single-Tenant Corporate Profile Fields:**

  - Company Legal Name, Trade Name, Official Email, Phone, Website.

  - Tax Registration Number (GST / PAN / VAT / TIN).

  - Operating Timezone, Base Currency, Business Hours.

  - Registered Head Office Address, City, State, Country, Postal Code.

- **Actions:** `Edit Organization`, `Save Changes`, `Cancel`. Automatically updates brand name across sidebar.



### 21.2. Organization List (`/masters/company-list`)

- Multi-company entity catalog for group enterprises.

- **Fields:** Company Name, Legal Entity Type, Registration Number, Base Currency, Status.



---



## 22. GOVERNANCE: Audit Log Module



- **Route:** `/audit`

- **Purpose:** Immutable compliance trail capturing all entity mutations across the ERP.

- **Table Columns:** Timestamp (UTC & Local), Actor (User Name & ID), Action Type (`CREATE`, `UPDATE`, `DELETE`, `LOGIN`, `PASSWORD_RESET`, `BULK_ACTION`), Target Entity (`Supplier`, `Product`, `Inquiry`, `User`), Entity ID, IP Address, HTTP Status Code.

- **JSON Delta Viewer Modal:** Click row opens side-by-side before-and-after JSON diff highlighting altered fields.

- **Filters:** Action type dropdown, Entity type, User picker, Date range.



---



## 23. GOVERNANCE: Trash & Recovery (Recycle Bin) Module



- **Route:** `/trash`

- **Purpose:** Universal soft-delete registry allowing one-click data restoration.

- **Table Columns:** Checkbox, Entity Type (e.g. `Supplier`, `Buyer`, `Product`, `Inquiry`), Record Name / Title, Deleted At Timestamp, Deleted By User, Actions.

- **Header Actions:** Module Filter dropdown (`ALL`, `Suppliers`, `Buyers`, `Products`, etc.), Search query.

- **Row Actions:**

  - 🔄 **`Restore` Button:** Restores deleted record back to its active table with relational integrity preserved.

  - ❌ **`Purge` Button:** Permanently deletes record from database (restricted to Super Administrator).

- **Bulk Actions:** `Restore Selected`, `Empty Trash`.



### Trash Conflict Detection & One-Click Restore Modal (`TrashConflictModal.tsx`)

- **Applies To:** All 12 Master Data catalogs (Categories, Sub Categories, Brands, UOM, HSN, Countries, States, Cities, Currencies, Supplier Types, Buyer Types, Companies), Product Master, Buyer Management, Supplier Directory, and Quick Inquiry Drawer.

- **Test Checklist:**

  1. **Category Soft-Delete & Re-creation Conflict:**

     - Navigate to `/masters/categories`.

     - Create category `"Alpha Test 1"`.

     - Soft-delete `"Alpha Test 1"` (record moves to Trash).

     - Click `+ Add Category` and enter name `"Alpha Test 1"`.

     - Click `Save`.

     - **Expected Outcome:** Instead of a 500 error or unexpected crash, an interactive `TrashConflictModal` dialog immediately appears stating: *"Category Already Exists in Trash"*, displaying the matching Name and Code.

  2. **One-Click Restore Action:**

     - In the conflict popup, click `[ 🔄 Restore Alpha Test 1 from Trash ]`.

     - **Expected Outcome:** The modal shows *"Restoring..."* briefly, closes, the categories table refreshes showing `"Alpha Test 1"` active again, and global dropdown caches are invalidated.

  3. **Preserve Form Inputs on Cancel:**

     - Open the create drawer for any entity (e.g. Buyer or Product).

     - Enter detailed information across multiple fields (e.g. 5 contact fields, website, categories).

     - Use a company name that exists in Trash. Click `Save`.

     - When `TrashConflictModal` appears, click `[ Change Name / Cancel ]`.

     - **Expected Outcome:** The popup closes, but the create drawer remains completely OPEN with all entered values, phone numbers, and categories 100% preserved so the user can easily adjust the name without re-entering anything.

  4. **Open Trash Shortcut:**

     - In `TrashConflictModal`, click `[ Open Trash ↗ ]`.

     - **Expected Outcome:** Opens `/trash` in a new browser tab without losing the current page context.

  5. **Inquiry Consignment Code Re-use & Multi-Item Append:**

     - Open `QuickInquiryDrawer` on `/inquiries`.

     - Add 3 product line items with quantities, brands, and remarks.

     - Specify a consignment code that exists in Trash.

     - Click `Save as Proposed`.

     - **Expected Outcome:** The conflict modal opens with primary action `[ 🔄 Restore & Append My Items ]`. Clicking it restores the consignment and immediately appends all 3 line items into it with zero manual re-entry.

  6. **Unified SQL Query & 0ms SWR Cache Performance Test:**

     - Open browser DevTools Network tab.

     - Navigate to `/trash` (cold load): verify endpoint `GET /api/v1/trash` executes a single consolidated `UNION ALL` query returning in `< 300 ms` (benchmark: ~257 ms vs ~948 ms previously).

     - Navigate away to `/masters/products` and immediately click back to `/trash`: verify the table and module filter counts paint instantaneously at **0 ms** from `trashCache` with zero loading skeleton flicker.

     - Soft-delete a record in any master: verify `/trash` reflects the newly soft-deleted record on background revalidation.




---



## 24. USER ACCOUNT: Profile, Security & Active Sessions



- **Route:** `/profile`

- **Section 1: Personal Details:** First Name, Last Name, Email, Contact Number, `Save Profile` button.

- **Section 2: Security & Password:** Current Password, New Password, Confirm Password, show/hide eye icons, `Update Password` button.

- **Section 3: Active Device Sessions:** List of active browser sessions (Browser, OS, IP Address, Device Category, Last Active). Action: `Revoke Session` button.



---



## 25. AUTHENTICATION: Login & Session Recovery



- **Route:** `/login`

- **Form Fields:** Username or Corporate Email (*Required*), Password (*Required*), "Remember Me" checkbox, `Sign In` button.

- **Security Logic:** Rate-limiting protection on failed attempts; automated single-flight token refresh upon access token expiration (`/auth/refresh`).

- **Deactivated Account Immunity & Permanent Deletion Retirement:** User deletion is completely disabled across the system. Deactivated accounts (`is_active=False`, `status=INACTIVE`) cannot log in under any circumstances. Submitting credentials for a deactivated user fails immediately with `403 Forbidden: Account is inactive or locked.`, preventing authentication. Any existing active JWT access tokens are immediately rejected on API calls, and clicking `Force Logout` instantly expels active sessions via real-time WebSocket termination and token invalidation.



---



## 26. EXTERNAL PORTAL: Public Supplier Quotation Submission Portal



- **Route:** `/quote/:token` (Public, No Login Required)

- **Purpose:** Secure tokenized web portal sent to vendors via RFQ emails/WeChat.

- **Display Data:** Inquiry Item Code, Product Name, Technical Specifications, Target Delivery Date, Buyer RFQ Remarks.

- **Supplier Bid Submission Form:**

  - **Unit Price** (*Required*): Number input.

  - **Currency** (*Required*): Dropdown (`CNY`, `USD`, `INR`, `EUR`).

  - **Lead Time (Days)**: Delivery turnaround time.

  - **Commercial Terms & Conditions**: Payment terms, validity period.

  - **Quotation Sheet / PDF Upload**: Direct upload of vendor price quotation to Supabase Cloud Storage.

  - **`Submit Quotation` Button:** Posts bid to backend, updates inquiry status to `QUOTES_RECEIVED`, and notifies procurement officers.



---



## 27. TOPBAR: Universal Search & Record Deep-Linking



- **Component:** `UniversalSearch.tsx` (Top Navigation Bar)

- **Keyboard Shortcuts:** `ArrowUp`, `ArrowDown`, `Enter` (Navigate results), `Escape` (Close dropdown).

- **Backend Search Service:** `GET /search?q=<term>` (`app.search.service`) querying Organizations, Users, Suppliers, Buyers, Products, Product Categories, Sub-Categories, Brands, HSN Codes, Countries, States, Cities, Currencies, and UOM.

- **Deep-Linking Test Cases:**

  1. **Supplier Deep-Link:** Search for a supplier (e.g. `Darsh Impex`), click result $\rightarrow$ Lands on `/suppliers?id=<uuid>`, automatically loads supplier profile and opens `SideDrawer` displaying all details, contacts, categories, and remarks.

  2. **Buyer Deep-Link:** Search for a buyer, click result $\rightarrow$ Lands on `/buyers?id=<uuid>`, automatically loads buyer details and opens `SideDrawer`.

  3. **Product Deep-Link:** Search for a product, click result $\rightarrow$ Lands on `/masters/products?id=<uuid>`, automatically loads product details and opens `SideDrawer`.

  4. **User Deep-Link:** Search for a user member, click result $\rightarrow$ Lands on `/users?id=<uuid>`, automatically loads profile and opens View User Modal.

  5. **Master Data Deep-Link:** Search for Categories, Brands, HSN, Countries, Currencies, etc., click result $\rightarrow$ Opens corresponding master record drawer via `MasterPage.tsx`.

  6. **Drawer Close / URL Cleanup:** Closing the drawer or modal cleanly removes `?id=` from the URL and supports back-button navigation.



---



## 28. USER MANAGEMENT: Unified Person & Workforce Architecture (Employee-to-User Merge)



- **Route:** `/users` (with `/employees` as a route alias)

- **Architecture & Merge Rationale:** Workforce personnel records and user login accounts are unified on the `User` entity (`users` table). Rather than splitting people into two separate screens (`/users` and `/employees`) requiring linking steps, the system uses a single boolean attribute: **`has_login: bool`**.

  - **Login-Enabled Users (`has_login=True`):** Full system accounts with `username`, `email`, `phone`, and `password_hash`. Subject to session management, rate limits, lockouts, and authentication dependencies.

  - **Workforce Members (`has_login=False`):** Offline or field workforce members (e.g. factory floor workers, drivers, warehouse temporary labor, consultants). Created without username, email, phone, or password credentials. Authentication is rejected before password hashing; account status is `INACTIVE` for login but active for organizational assignments.



---



## 29. USER MANAGEMENT: Unified Departments & Organizational Units (Department-to-Role Merge)



- **Route:** `/rbac` (Departments & Permissions)

- **Architecture & Merge Rationale:** Organizational departments and software permission bundles are unified onto the `Role` entity (`roles` table). This eliminates the confusion of having two separate "Departments" screens.

  - **Organizational Structure:** Roles carry `code` (e.g. `SALES`) and multi-parent / multi-child relationships via `department_hierarchy` and `roles.parent_department_id` (supporting many-to-many parent and child departments with server-side circular dependency validation via `would_create_cycle`).

  - **Software Permissions:** Roles bundle fine-grained permission codes (`role_permissions`).

  - **User Role Assignments:** Modeled in `user_roles` with `assignment_type` (`PRIMARY`, `SECONDARY`, `TEMPORARY`, `PROJECT`, `ACTING`), `is_primary`, and effective date ranges.



---



## 30. USER MANAGEMENT: Positions Module



- **Route:** `/positions` (Sidebar Icon: `briefcase`)

- **Purpose:** Professional designations and job titles (e.g. "Sales Manager", "Marketing Advisor", "Senior Engineer") that employees hold.

- **Independence:** Holds no reporting-hierarchy or software-permission logic -- designations do not dictate who reports to whom or software access privileges.

- **Table Columns:** SR. NO., NAME, CODE, EMPLOYEES, STATUS, ACTION (standard master CRUD).

  - **Employees Column:** Displays a dynamic badge (e.g. `👤 1`) showing how many employees currently hold the position.

- **Add / Edit Form Fields:** Position Name (*Required*), Code, Description, Status (supports case-insensitive ACTIVE / INACTIVE / ARCHIVED).

- **Safety & Deletion Freeze Rules:**

  - **Locked/Frozen Delete Button:** If any employees are assigned to a position (`employee_count > 0`), the delete button is completely frozen and locked with a lock icon, disabled appearance, `cursor: not-allowed`, and a hover tooltip explaining that deletion is locked due to active assignments.

  - **Warning Alert Modal:** If the user attempts to click the locked delete button, an immediate modal alert dialog appears explaining that the position cannot be deleted because employees are currently attached to it.

  - **Bulk Delete Protection:** If multiple items are selected for bulk deletion, any positions with active employees are automatically protected and skipped, with an alert notifying the administrator.

  - **Server-Side Conflict Enforcement:** Deletion requests (`DELETE /positions/{id}`) are rejected server-side with HTTP 409 Conflict if active assignments exist.

- **User Profile Display:** Active positions held by a user are displayed in Section 6.5 of the User Profile Drawer via `GET /positions/holders-for-user/{user_id}`.



---



## 31. USER MANAGEMENT: Organization Chart Module



- **Route:** `/org-chart` (Sidebar Icon: `orgChart`)

- **Purpose:** Dynamic, real-time visual hierarchy of company reporting lines, built entirely from active `PRIMARY_REPORTING` relationships (`GET /reporting/org-chart`).

- **Display & Rendering:**

  - Multi-level hierarchical tree diagram with interactive node expansion and collapse.

  - Node resolution dynamically loads person names via `UserRepository.list_all()`.

  - Enforces mandatory server-side cycle detection (`ReportingService.would_create_cycle`) preventing any self-reporting (`A -> A`) or circular reporting (`A -> B -> C -> A`).

  - **Drag-and-Drop Manager Assignment:** Dragging and dropping an employee's card onto a new manager calls `POST /api/v1/reporting/set-manager/{employee_id}` with `manager_employee_id`, updating the primary relationship atomically with cycle validation.

  - Updates dynamically whenever reporting lines are reassigned or updated.



---



## 32. AI Subagent Autonomous Testing Prompt Template



When instructing an autonomous AI agent to verify the ERP after code modifications, copy and run the following prompt:



```markdown

You are acting as an Autonomous QA Tester for the Enterprise ERP.

Your task is to verify that all modules and features described in MODULES_AND_FEATURES_TEST_MANUAL.md exist and function without regressions.



Checklist to execute:

1. Compile backend: Run `python -m compileall backend/app` -> must return 0 errors.

2. Build frontend: Run `npm run typecheck` and `npm run build` in /frontend -> must compile cleanly.

3. Verify module routes in frontend/src/App.tsx and frontend/src/lib/nav.ts match the sitemap in Section 2, and all 26 nav items possess distinct, non-duplicated icons.

4. Verify all form fields, modals, and actions documented for Suppliers, Buyers, Products, Inquiries, Planning, and Users remain intact.

5. Verify the unified User Architecture:

   - Creating a user with `has_login=True` requires email, phone, and password.

   - Creating a user with `has_login=False` permits saving without email, phone, or password.

   - Profile drawer displays Section 6.5 (Positions & Reporting Structure).

   - Positions (/positions, icon: briefcase) and Organization Chart (/org-chart, icon: orgChart) render and function.

   - Departments (/rbac) support optional short code and parent department nesting.

6. Report any missing fields, broken endpoints, or regressions.

```



---



## 33. Universal Import & Deduplication Test Suite (`testingimportfile/`)



A standardized suite of 8 production-grade Excel (`.xlsx`) files is maintained directly in `testingimportfile/` to allow developers and QA engineers to execute end-to-end import and duplicate-detection testing across the 4 core business modules:



### 33.1. Supplier Master (`/suppliers`)

- **Folder:** `testingimportfile/`

- **File 1 (Clean Data):** `supplier_new_data.xlsx`

  - **Rows:** 2 new supplier companies ("Hangzhou Precision Pack Machinery Co., Ltd.", "Apex Automation Systems Pvt. Ltd.")

  - **Headers:** `Company Name`, `Product Categories`, `Key Strength Sub-Categories`, `Products Supplied`, `Secondary Products`, `Country`, `State / Province`, `City`, `Brand Description`, `Supplier Type`, `Current Status`, `Supplier Grade`, `Potential`, `Potential Reason`, `Contact Person`, `Designation`, `Calling Number`, `WhatsApp Number`, `WeChat Number`, `Emails`, `Tax ID / GST Number`, `Address`, `Town`, `Primary Website`, `Secondary Website`, `Visited Factory/Office`, `Visit Remarks`, `Overall Remarks`, `Status`.

  - **Expected Result:** `created: 2, failed: 0`. Both suppliers created successfully and linked to their respective City/State/Country and Category/Sub-Category masters.

- **File 2 (Duplicate / Conflict Data):** `supplier_duplicate_data.xlsx`

  - **Rows:** 4 rows:

    - Row 2: Existing Supplier "Yinglima Packaging Machinery Co., Ltd." (in Wenzhou, China).

    - Row 3: Existing Supplier "Darsh Impex" (in Mumbai, India).

    - Row 4: New company "Newtech Sealing Solutions Co., Ltd." (First entry in batch).

    - Row 5: Same company "Newtech Sealing Solutions Co., Ltd." (Second entry in same batch).

  - **Expected Result:** Rows 2 and 3 skipped/flagged as existing DB duplicates (`ConflictException`). Row 5 flagged as an in-file batch duplicate.



### 33.2. Buyer (Client) Master (`/buyers`)

- **Folder:** `testingimportfile/`

- **File 1 (Clean Data):** `buyer_new_data.xlsx`

  - **Rows:** 2 new buyers ("Zenith Food & Beverage Processing Ltd.", "Global Agro Industries Ltd.")

  - **Headers:** `Company Name`, `Buyer Type`, `Product Categories`, `Product Sub Categories`, `Country`, `City`, `Address`, `Contact Salutation`, `Contact Person Name`, `Designation`, `Calling Number`, `WhatsApp Number`, `Emails`, `Tax ID / GST Number`, `Website`, `Current Status`, `Buyer Grade`, `Potential`, `Potential Reason`, `Product Range`, `Currently Buying From`, `Overall Remarks`, `Status`.

  - **Expected Result:** `created: 2, failed: 0`. Clean import with full contact, salutation, category, and city linking.

- **File 2 (Duplicate / Conflict Data):** `buyer_duplicate_data.xlsx`

  - **Rows:** 5 rows testing Note 66 3-way deduplication:

    - Row 2: "Darsh Impex" -> Triggers Duplicate Company Name collision.

    - Row 3: "Sunrise FMCG Exports Pvt. Ltd." with Calling Number `+91 77384172578` -> Triggers Duplicate Calling Number collision.

    - Row 4: "Horizon Pack Solutions LLP" with WhatsApp Number `+91 77384172578` -> Triggers Duplicate WhatsApp Number collision.

    - Row 5: "Alpha Pack Industries" -> First entry in batch.

    - Row 6: "Alpha Pack Industries" -> Second entry in batch -> Triggers in-file duplicate collision.

  - **Expected Result:** 4 duplicate conflicts correctly captured and isolated; existing records protected from overwrite.



### 33.3. Product Master (`/masters/products`)

- **Folder:** `testingimportfile/`

- **File 1 (Clean Data):** `product_new_data.xlsx`

  - **Rows:** 3 new machine products ("High Speed Continuous Band Sealer Model CBS-900", "Semi-Automatic Carton Sealer Model FX-500", "Heavy Duty Liquid Piston Filling Machine 500ml").

  - **Headers:** `Product Name (As Per Tally)`, `Product Code`, `Brand`, `Category`, `Sub Category`, `HSN Code`, `UOM`, `Organization`, `Branches`, `Pack. Qty`, `Pack. Net Weight`, `Pack. Gross Weight`, `Length (cm)`, `Width (cm)`, `Height (cm)`, `Pack. Unit CBM`, `Refund VAT %`, `Compliance & License Requirements`, `Specification`, `Status`.

  - **Expected Result:** `created: 3, failed: 0`. All 3 products created with auto-calculated CBM and valid category-to-subcategory mapping.

- **File 2 (Duplicate / Conflict Data):** `product_duplicate_data.xlsx`

  - **Rows:** 4 rows:

    - Row 2: Product Name "Ink Cup Set ( TDY 380C)" -> Triggers duplicate Product Name collision (existing code `DAR-01849`).

    - Row 3: Product Code `DAR-01851` -> Triggers duplicate Product Code collision (existing product "Ink Roll (MY 380F)").

    - Row 4: "Digital Ultrasonic Cleaner 30L Industrial" (Code `PRD-BATCH-DUP-01`) -> First entry in batch.

    - Row 5: "Digital Ultrasonic Cleaner 30L Industrial" (Code `PRD-BATCH-DUP-02`) -> Triggers in-file duplicate Product Name collision.

  - **Expected Result:** 3 duplicate conflicts captured and skipped; zero corruption of existing catalog.



### 33.4. Inquiry Consignment Line Items (`/inquiries/{inquiry_id}/items`)

- **Folder:** `testingimportfile/`

- **File 1 (Clean Data):** `inquiry_items_new_data.xlsx`

  - **Rows:** 4 valid line items referencing active Product Master items:

    - Row 2: "Ink Cup Set ( TDY 380C)" (Code `DAR-01849`, Qty: 50, Status: Approved)

    - Row 3: "Ink Roll (MY 380F)" (Code `DAR-01851`, Qty: 100, Status: Proposed)

    - Row 4: "Mother Board for Handy and Printer" (Code `DAR-01852`, Qty: 20, Status: Approved)

    - Row 5: "Motor (Tdy 380)" (Code `DAR-01853`, Qty: 15, Status: Proposed)

  - **Headers:** `Product Name`, `Product Code`, `Quantity`, `UOM`, `Brand Preference`, `Product Specs / Remarks`, `Status`.

  - **Expected Result:** `created: 4, failed: 0`. All 4 items imported into consignment with automatic UOM inheritance and consignment rollup calculation.

- **File 2 (Duplicate & Validation Test Data):** `inquiry_items_duplicate_data.xlsx`

  - **Rows:** 4 rows testing duplicate items and validation handling:

    - Row 2: "Ink Cup Set ( TDY 380C)" (Qty: 50, Status: Approved) -> Initial entry.

    - Row 3: "Ink Cup Set ( TDY 380C)" (Qty: 50, Status: Approved) -> Duplicate line item entry.

    - Row 4: "Non-Existent Mystery Widget 999" (Code `NON-EXISTENT-SKU-999`) -> Triggers "Product not found in Product Master" failure.

    - Row 5: "Motor (Tdy 380)" with Quantity `0` -> Triggers "Invalid quantity. Must be a positive number" failure.

  - **Expected Result:** 2 valid rows imported; 2 invalid rows accurately flagged with exact row numbers and error descriptions.





## 34. Local Purchases & Domestic Procurement Engine (`/purchase/local`)



### 34.1. Module Overview & UI Layout Specifications

- **Navigation:** Main Sidebar -> Purchases -> **Local Purchases** (`/purchase/local`).

- **New Record Entry:** `/purchase/local/new`.

- **Edit Existing Record:** `/purchase/local/:id/edit`.

- **Responsive Standard:** 100% Fluid Auto-Fit layout without fixed width locks (`width: 100%, padding: 16px 24px`). Zero dead whitespace across 50%, 80%, 100%, 125%, and 150% browser zoom levels, matching the Product Master design system.



### 34.2. Form Cards & Interaction Specifications

1. **Card 1: Purchase Order & Invoice Information**

   - **Row 1 (5 Fluid Columns):**

     - `Organization List *`: Mandatory dropdown populated from `master_companies`.

     - `Operating Branch *`: Dynamically scoped to branches of chosen organization.

     - `Supplier *`: Searchable supplier directory dropdown.

     - `Invoice No *`: Vendor invoice number text input.

     - `Invoice Date *`: Invoice date picker.

   - **Row 2 (3 Fluid Columns):**

     - `Currency *`: Standardized to Chinese RMB (`¥`), INR (`₹`), USD (`$`).

     - `Invoice Total Value with VAT (Currency) *`: Header gross amount with VAT.

     - `Bill Document File Upload`: Supports PDF and Excel bill files with integrated `Extract Bill Data` button.

2. **Card 2: Additional Landing Expenses (VB Proportional Allocation)**

   - Inputs for `Packing & Forwarding`, `Transport Expense`, `Offloading Expense`, `Other Expense`.

   - Real-time display of `Total Expenses` and `% Loading Expense (VB)`.

3. **Card 3: Dedicated Product Search & Padlock Lockout**

   - Disabled with padlock icon when no Organization is selected.

   - 0ms in-memory instant search across catalog items strictly scoped to the active Organization.

   - Single click appends item to table, sets standard cost, VAT%, HSN, and quantity to 1.

4. **Card 4: Product Items Consignment Table & Shipment Planning Sync**

   - **Shipment Planning Integration:** Automatically queries active Shipment Planning sheet when Organization, Branch, and Supplier are chosen.

   - Auto-populates planned products, quantities, and HSN codes with `[📦 Planned]` visual badges.

   - Displays header status badge `📦 N planned item(s) from [Sheet Name]` with `Load Planned Items` reload trigger.

   - Mandatory positive unit rate policy (`unit_rate > 0`). Rows with 0 rate show red cell borders and warning `▲ Rate > 0 req.`.

5. **Card 5: Financial Reconciliation & Summary Cards**

   - Displays `Basic Items Total`, `Total VAT`, `Landing Total`, and `Total Quantity`.

   - **Strict Financial Discrepancy Hard-Stop:**

     - When entered Invoice Total matches line items with VAT ($\Delta \le 0.05$): Green banner displays `✅ Invoice Total Matches Line Items Perfectly`. Form submission enabled.

     - When discrepancy exists ($\Delta > 0.05$): Red banner displays `⛔ Invoice Discrepancy Detected: Entered Total vs Items Sum with VAT... Submission is blocked until line items match the invoice total.` Form submission strictly disabled.



### 34.3. Test Cases & Verification Checklist



| Test ID | Test Scenario | Steps | Expected Result |

| :--- | :--- | :--- | :--- |

| **TC-LP-01** | Fluid Auto-Fit Zoom Test | Open `/purchase/local/new` and set browser zoom to 80%, 100%, and 125%. | Form cards and table seamlessly stretch across the entire viewport width. Zero white margins or cutoffs. |

| **TC-LP-02** | Organization Padlock Lockout | Open new form without selecting Organization. | Product search input in Card 3 is disabled with dashed border and guidance message. |

| **TC-LP-03** | Shipment Planning Auto-Population | Select Organization "Inhyma", Branch "Inhyma Mumbai", and Supplier "Inhyma". | Background worker checks active Shipment Planning sheet, finds planned items, and auto-populates table with `[📦 Planned]` badges. |

| **TC-LP-04** | Positive Rate Validation | Add an item and set unit rate to `0`. Click Save. | Form scrolls to top error banner; item row shows red border with `▲ Rate > 0 req.`; submission blocked. |

| **TC-LP-05** | Financial Discrepancy Hard-Stop | Enter Invoice Total `10,000` with line items totaling `9,500`. | Red blocker banner displays `⛔ Invoice Discrepancy Detected`; Save button is disabled; submission prevented. |

| **TC-LP-06** | Balanced Reconciliation Approval | Update line item rate or quantity so line items gross total equals `10,000`. | Red banner converts to green `✅ Invoice Total Matches Line Items Perfectly`; Save button is enabled. |

| **TC-LP-07** | Detail Modal Inspection | On `/purchase/local` list, click invoice link or `👁️ View Details`. | Detail modal opens displaying supplier, receiving branch, expenses breakdown, line items landing rates, and download link. |



---



## 35. Sale Process & Export Trade Documents Engine (`/sale/process`)



### 35.1. Module Overview & UI Layout Specifications

- **Navigation:** Main Sidebar -> Sales -> **Sale Process** (`/sale/process`).

- **Standardized List View Toolbar:**

  - **Left Group:** `[ 50 ▾ ] Items/Page` selector with options `10`, `20`, `50`, `100`. Reactive pagination updates immediately and resets to Page 1.

  - **Constraint:** Zero freeze column option (strictly streamlined per workflow instructions).

  - **Right Group:** Medium-breadth search input (`290px`) positioned on the right side with 🔍 magnifier icon, clear `✕` button when terms are entered, and instant filtering on Order No, Consignment, Buyer Company, Container, BL, or LR No.

- **Workflow Tabs:** `All`, `Pending`, `Sales Confirmed`, `Admin Approved`, `Dispatched`, `LR`, `Cancelled`.



### 35.2. Trade Document Modal & Export Specifications

- **Detail & Workflow Modal:** Click on Order No or `👁️ View Details` kebab action.

- **3-Tab Navigation:**

  - `📋 Order Overview`: Line items, basic prices, landed costs, and workflow status transitions.

  - `📄 Commercial Invoice (CI)`: Formatted preview matching official corporate letterhead, consignee buyer profile, ICBC bank remittance card, and truth declaration.

  - `📦 Packing List (PL)`: Formatted preview with package carton breakdowns, gross/net weights in kg, and volume CBM.

- **Export Actions:**

  - `📥 Download Excel (.xlsx)`: Generates dual-sheet workbook (`CI` and `Packing List`) with openpyxl live formulas and embedded official seal + signature.

  - `🖨️ Print / Save PDF`: Isolated print iframe engine (`@page { size: A4 portrait; margin: 12mm 10mm; }`) with repeating table headers on multi-page splits, side-by-side company seal and handwritten signature (14px gap), and zero modal backdrop overlap.



### 35.3. Test Cases & Verification Checklist



| Test ID | Test Scenario | Steps | Expected Result |

| :--- | :--- | :--- | :--- |

| **TC-SP-01** | Standardized Table Toolbar | Navigate to `/sale/process`. | Toolbar displays at the top of the table card with `[ 50 ▾ ] Items/Page` on the left and a medium-breadth `290px` search input on the right. Zero freeze column buttons are displayed. |

| **TC-SP-02** | Page Size Pagination Switch | Change page size dropdown to `10` or `20`. | Table immediately refreshes, showing the requested row count, and resets to Page 1. |

| **TC-SP-03** | Right-Hand Search & Clear | Type query in search bar. Click `✕` clear button. | Typing filters orders instantly; `✕` appears when query is present; clicking `✕` empties input, restores full list, and resets page. |

| **TC-SP-04** | Trade Document Detail Modal | Click any Order No link. | Modal opens with 3 tabs (`Order Overview`, `Commercial Invoice`, `Packing List`). Navigation bar is clearly visible without being clipped. |

| **TC-SP-05** | Isolated A4 Print & Signature Layout | Click `🖨️ Print / Save PDF` in CI or PL tab. | Dedicated print preview opens cleanly. Company seal and signature sit neatly side-by-side with no overlap or clipping. |

| **TC-SP-06** | Dual-Sheet Excel Export | Click `📥 Download Excel (.xlsx)`. | Browser downloads `Yinglima_CI_PL_{consignment_code}.xlsx`. Opening in Excel shows both `CI` and `Packing List` sheets with live formulas and embedded seal + signature. |



---



## 36. Notification & Automation Rules System (`/settings/notifications`)



### 36.1. Module Overview & UI Layout Specifications

- **Navigation:** Topbar -> Bell Icon -> **Configure Rules** (`/settings/notifications`).

- **Topbar Bell Component:** [`NotificationBell.tsx`](file:///d:/Om%20work1/ERP/Yinglima_ERP/frontend/src/components/NotificationBell.tsx) embedded in [`AppShell.tsx`](file:///d:/Om%20work1/ERP/Yinglima_ERP/frontend/src/components/AppShell.tsx).

- **Rule Management Grid:** [`NotificationSettings.tsx`](file:///d:/Om%20work1/ERP/Yinglima_ERP/frontend/src/pages/NotificationSettings.tsx) displaying Event Name, Status toggle, Active Channels (`in_app`, `email`, `push`), Recipient Roles, Direct Users, and `[ ✏️ Edit ]` action.



### 36.2. Event Hooks & Dispatcher Architecture

- **Central Events Engine:** Automatically captures transactional events:

  * `shipment_requirement_raised`: Dispatched on shipment planning requirements.

  * `shipment_status_ordered`: Dispatched on shipment/container ordering.

  * `sale_process_created`: Dispatched on sale process order creation.

  * `local_purchase_created`: Dispatched on domestic purchase order saving.

  * `inquiry_created`: Dispatched on customer RFQ/inquiry creation.

- **Recipient Deduplication:** Users assigned through both a qualified role and direct selection receive exactly one notification.



### 36.3. Test Cases & Verification Checklist



| Test ID | Test Scenario | Steps | Expected Result |

| :--- | :--- | :--- | :--- |

| **TC-NT-01** | Topbar Badge & Polling | Start backend and frontend. Ensure 1 unread notification exists. | Amber/red pill badge appears over topbar bell icon showing unread count; background worker polls every 30s. |

| **TC-NT-02** | Event Dispatch (Sale Process) | Create a new Sale Process order. | Backend dispatches `sale_process_created` event; configured recipients receive an in-app notification in topbar within 30s. |

| **TC-NT-03** | Event Dispatch (Local Purchase)| Create and save a new Local Purchase bill. | Backend dispatches `local_purchase_created` event; in-app notification appears with PO number and supplier name. |

| **TC-NT-04** | Event Dispatch (Inquiries) | Submit a new customer Inquiry. | Backend dispatches `inquiry_created` event; topbar notification arrives with inquiry code and buyer name. |

| **TC-NT-05** | User Search Modal Parser | Navigate to `/settings/notifications`, click `[ ✏️ Edit ]` on any rule, and type a user search query (e.g. `user b`). | Search bar dynamically queries `/api/v1/users` and correctly parses paginated items; matching users appear in checkbox list without "No users match your search" blank-out. |

| **TC-NT-06** | Read & Direct Navigation | Click any unread notification item in the bell dropdown. | Notification is marked read (`is_read=true`), unread badge count decrements, and user is navigated directly to the associated document. |

| **TC-NT-07** | Mark All As Read | In bell dropdown, click `Mark all as read`. | All notifications are set to read in a single batch; unread badge immediately disappears. |



---



## 37. Shipment Planning Master Grid & Formula Engine (`/planning`)



### 37.1. Module Overview & Multi-Sheet Specifications

- **Navigation:** Main Sidebar -> Logistics -> **Shipment Planning** (`/planning`).

- **Multi-Sheet Architecture:**

  * **Organization Branch Sheets:** Dedicated tabs for `Inhyma Mumbai`, `Inhyma Ahmedabad`, `Inhyma Indore`, `inhyma chennai`, `Mumbai`, `Chennai`, `dubaidarsh`, `One Stop`, `F&B`.

  * **Buyer Planning Sheets:** Dedicated tabs for `Om Packaging - Mulund`, `Prathamesh Packaging PVT LTD - Thane`, `Darsh Impex Mumbai - Mulund`.

- **Master Linkage ("Extract From")**:

  * Brand of Supplier, City, PKG QTY, Unit Weight/Pkg, and CBM/Pkg are linked directly to Product Master (`product`).



### 37.2. Test Cases & Verification Checklist



| Test ID | Test Scenario | Steps | Expected Result |

| :--- | :--- | :--- | :--- |

| **TC-PL-01** | Linked Lookup Auto-Population | Add a product row to any planning sheet. | `Brand of Supplier`, `City`, `PKG QTY`, `UNIT WEIGHT/PKG (KG)`, and `CBM/PKG (KG)` automatically populate from Product Master. |

| **TC-PL-02** | Package Quantity Formula | Enter shipment input quantity (e.g. 56) for an item with PKG QTY = 56. | `NO. OF PKG` immediately calculates and displays `1.0`. |

| **TC-PL-03** | Total Gross Weight Formula | With evaluated PKG = 5 and Unit Weight = 1.0 kg. | `TOTAL WEIGHT` immediately calculates and displays `5.0 kg`. |

| **TC-PL-04** | Total Volume CBM Formula | With evaluated PKG = 6 and Unit CBM = 0.13 m³. | `TOTAL CBM` immediately calculates and displays `0.78 CBM`. |

| **TC-PL-05** | Zero & Blank Division Safety | Leave shipment input quantity blank or set PKG QTY to 0. | Formula engine evaluates safely to empty/null with zero console errors or application crashes. |

| **TC-PL-06** | Auto-Fit & 80% Zoom Viewport | Set browser zoom to 80% on a sheet with 20+ columns. | Table body stretches fluidly; column headers wrap text cleanly (`whiteSpace: normal`); right-hand Action column (`Edit` / `Delete`) stays fully visible within the viewport. |

| **TC-PL-07** | Branch Data Isolation | Open `Inhyma Ahmedabad` sheet. | Products shown are strictly limited to products assigned to Inhyma Ahmedabad. Products belonging to other branches are completely excluded. |

| **TC-PL-08** | Primary Supplier Linked Lookup | Add a product that has a primary supplier configured in Product Master to any planning sheet. | `Brand of Supplier` and `City` immediately display that primary vendor's Brand Description / Company Name and City. |

| **TC-PL-09** | Blank Entry When Product Has No Primary Supplier | Add a product that has no primary supplier assigned in Product Master (`supplier_id = None`), even if linked to other vendors in Supplier Master (`SupplierProductLink`). | `Brand of Supplier` and `City` strictly display as blank/empty cells. All other master specifications (PKG QTY, Unit Weight, Unit CBM) auto-populate normally without interruption. |



---



## 38. Stock Movement (Inward & Outward Register & Live Inventory Ledger) (`/inventory/stock-movements`)



### 38.1. Module Overview

- **Navigation:** Main Sidebar -> `INVENTORY` -> **Stock Movement** (`/inventory/stock-movements`).

- **Modes:**

  - **Inward Register (Receipts)**: Record incoming goods with 1-Click extraction from Local Purchase bills.

  - **Outward Register (Dispatches)**: Record dispatches with 1-Click extraction from Sale Process orders.

  - **Live Stock Ledger**: Real-time calculated inventory per SKU with Kardex history drawer.

- **Ergonomic Modal & Searchable Combobox:**

  - Fast typeahead search combobox for selecting orders without manual scrolling.

  - 4-column compact metadata layout saving ~150px of vertical height.

  - Dedicated table viewport (`maxHeight: 420px`) with pinned sticky headers ensuring 7+ product rows are visible at all times.

  - Anchored modal footer with item count and confirm buttons.



### 38.2. Test Cases & Verification Checklist



| Test ID | Test Scenario | Steps | Expected Result |

| :--- | :--- | :--- | :--- |

| **TC-SM-01** | Outward 1-Click Extract with 30+ Items | Open Outward modal (`+ New Outward Entry`), click `1-Click Extract from Sale Process`. Type in the search combobox to filter order. Select an order containing 30+ items. | Order details auto-populate. Goods line items table loads all 30+ items. At least 7 product rows are immediately visible on screen with sticky headers and a smooth internal scrollbar. |

| **TC-SM-02** | Searchable Order Selector Combobox | In the Order selector, type a partial name, container number, or SO number (e.g. `Indore`, `msku`, `0001`). | The dropdown list instantly filters in real-time, showing only matching orders with checkmark on current selection. |

| **TC-SM-03** | Inward Local Purchase Extraction | Open Inward modal (`+ New Inward Entry`), search and select a confirmed Local Purchase invoice. | Vendor name, bill number, and line items load. Quality inspection columns (`Received Qty`, `Damaged Qty`, `Accepted Qty`) calculate net accepted quantity in real time. |

| **TC-SM-04** | Live Inventory Ledger & Kardex | Record an inward entry (+10) and an outward entry (-4). Open Current Stock Ledger and click `Kardex`. | Current in-stock balance displays `6`. Kardex ledger opens showing both inward (+10) and outward (-4) transactions with document links and running balance. |

| **TC-SM-05** | Pinned Footer & Direct Confirmation | Scroll through 30+ items in the modal table. | Pinned footer with `Cancel`, item count, and `Confirm & Record Outward Stock` remains fixed and accessible without scrolling the window. |

| **TC-SM-06** | Inward/Outward Modal Auto-Reset on Close & Reopen | In /inventory/stock-movements, click + New Inward Entry. Select a confirmed purchase bill (e.g. 122234 (stella)), verify vendor and 3 items populate. Click Cancel or header ✕. Click + New Inward Entry again. | Modal opens completely blank and fresh with 0 lingering bills, 0 pre-selected vendors, and 1 empty line item. Reopening after successful submit also opens 100% clean. |

| **TC-SM-07** | Cascading Reset on Search Combobox Clear (✕) | Select a purchase bill or sale order in the modal. Click ✕ in the search input box. | Selected bill/order, vendor/buyer name, challan/reference number, and all table line items immediately wipe clean back to 1 empty line item. |

| **TC-SM-08** | Reset on Mode Switch (1-Click vs Direct Entry) | Select an order in 1-Click Extract mode, then click ✍️ Direct Manual Entry. | Order link and extracted items cleanly reset, allowing executive to type opening stock or manual adjustments without linked order interference. |



---



## 39. Sale Process & Planning Consignment Extraction (`/sale/process`)



### 39.1. Module Overview

- **Navigation:** Main Sidebar -> `SALES` -> **Sale Process** (`/sale/process`).

- **Create / Edit Order:** `/sale/process/new` and `/sale/process/:id/edit`.

- **3-Level Dependent Hierarchy Architecture:**

  - **Level 1 — Customer / Entity Selector:**

    - Live search combobox partitioned into `🏢 INTERNAL ORGANIZATIONS` (Inhyma, Darsh Impex, FNB Solution, One Stop, Yinglima) and `👤 BUYERS` (Om Packaging, Prathamesh Packaging, etc.).

    - Selecting an entity automatically updates buyer name and primes available sheets.

  - **Level 2 — Planning Sheet / Branch Selector:**

    - Dynamically limits choices to sheets belonging to the selected organization or buyer.

    - If `Inhyma` is selected: displays `Inhyma Mumbai`, `Inhyma Ahmedabad`, `Inhyma  Indore`, `inhyma chennai`.

    - If `Om Packaging` is selected: displays `Om Packaging - Mulund`.

  - **Level 3 — Planning Consignment Column Selector:**

    - Displays only consignment columns belonging to the selected sheet (e.g. `Mum 48`, `Mum 49`, `GJ14`, etc.).

    - Displays total planned units badge and remarks presence indicator.

- **1-Click Planned Products Extraction:**

  - Selecting any consignment column immediately auto-loads all planned products with quantity > 0 from Shipment Planning.

  - Row order is preserved from `PlanningRow.position.asc()`.

  - Automatically fetches primary purchase rates from confirmed Local Purchase (or refund VAT rates), calculates basic RMB, USD CFR, FOB, container CBM, and remarks.

- **Universal Compatibility (Existing & New Sheets):**

  - **All Existing Sheets:** 100% supported via dynamic DB queries (`/planning/sheets`) and dual matching (`organization_id` foreign key + canonical name matching).

  - **All New Sheets:** Any sheet created in Shipment Planning immediately becomes available in the hierarchy. Any manual numeric columns added to the sheet appear in the consignment dropdown, and entering quantities enables 1-click extraction immediately without configuration.

- **Nullable Buyer ID Schema:**

  - Internal sales and inter-organization transfers can be saved with `buyer_id = null`.



### 39.2. Test Cases & Verification Checklist



| Test ID | Test Scenario | Steps | Expected Result |

| :--- | :--- | :--- | :--- |

| **TC-SP-01** | Level 1: Entity Combobox Categorization | Open `/sale/process/new`. Click the `Customer / Entity` dropdown. | The dropdown displays two clearly styled category headers: `🏢 INTERNAL ORGANIZATIONS` and `👤 BUYERS`. Typeahead search immediately filters across both sections. |

| **TC-SP-02** | Level 2: Dependent Planning Sheet Filtering | Select Organization `Inhyma` in Level 1. Click the `Planning Sheet / Branch` dropdown. | Only sheets belonging to Inhyma (`Inhyma Mumbai`, `Inhyma Ahmedabad`, `Inhyma  Indore`, `inhyma chennai`) appear. Unrelated sheets are excluded. |

| **TC-SP-03** | Level 2: Buyer Sheet Association | Select Buyer `Om Packaging` in Level 1. Click the `Planning Sheet / Branch` dropdown. | Only `Om Packaging - Mulund` appears in the sheet dropdown. |

| **TC-SP-04** | Level 3: Consignment Column Isolation & Product Auto-Load | Select sheet `Inhyma Mumbai`, then select consignment column `Mum 48`. | Consignment dropdown strictly lists columns belonging to Inhyma Mumbai. Upon selecting `Mum 48`, planned products with quantity > 0 immediately auto-load into the order items table with correct quantities, unit rates, CBM, and companion remarks. |

| **TC-SP-05** | New Sheet Dynamic Extraction | Create a new sheet in Shipment Planning (`/planning/sheets`) named `Inhyma Test Branch` under organization `Inhyma`. Add column `TST 01` with data type Number. Add 2 products with quantities `5` and `10`. Go to `/sale/process/new`, select `Inhyma` -> `Inhyma Test Branch` -> `TST 01`. | The new sheet and new column appear dynamically in the hierarchy dropdowns. Both products extract into the order items table with quantities 5 and 10 with zero latency. |

| **TC-SP-06** | Nullable Buyer ID for Internal Sales Order | In `/sale/process/new`, select an Organization without selecting a Buyer. Enter order date and load a consignment. Click `Create Sale Order`. | Order saves successfully with HTTP 200/201. `buyer_id` persists as `null` without validation errors or database constraints failing. |

| **TC-SP-07** | Manual Re-Sync with Auto-Load Button | Change quantities or items in the order table manually, then click `Auto-Load Planned Products`. | System re-queries the consignment column and prompts/restores original planned products and quantities from Shipment Planning. |

| **TC-SP-08** | Customer Lockout Gating Test | Open `/sale/process/new` without selecting Customer / Entity. Attempt to click `Planning Sheet / Branch` or `Planning Consignment Column`. | Both buttons remain strictly disabled (`not-allowed`, light gray `#f8fafc` background, dashed border) displaying `🔒 Select Customer / Entity first`. Neither dropdown opens. |

| **TC-SP-09** | Complete Cascade Reset on Customer Deletion | Select Customer `Darsh Impex`, Sheet `Mumbai`, and Consignment `Mumdarsh 2`. Verify 1 product loads with `748.000 m³` container CBM. Click `✕` to clear Customer. | Customer is cleared; Planning Sheet and Consignment Column re-lock immediately; the table items are completely cleared (`0 products`); container CBM resets to `0.000 m³`. Zero orphaned items remain. |

| **TC-SP-10** | Consignment Column Change Auto-Replace | Select Customer `Darsh Impex` and Sheet `Mumbai`. Select Consignment `Mumdarsh 1`, then switch to `Mumdarsh 2`. | The table immediately replaces the items from `Mumdarsh 1` with the exact items, quantities, and container CBM of `Mumdarsh 2`. Stale products from previous columns are cleanly overwritten. |



---



## 40. Module-by-Module RBAC & Dynamic Permission Enforcement (Part 1)



### 40.1. Module Overview & Critical Gap Resolutions

- **Module Coverage (Part 1):**

  - **Sale Process (`sale_process.*`):** Full RBAC gating with 6 granular permissions (`view`, `create`, `update`, `approve`, `delete`, `export`).

  - **Stock Movement (`stock_movement.*`):** Full RBAC gating with 4 granular permissions (`view`, `create`, `cancel`, `delete`).

  - **Notification Rules (`notification_settings.*`):** Dedicated permissions (`view`, `manage`), eliminating legacy borrowing of `user.view`.

  - **Positions & Designations (`position.*`):** Registered human-readable label in `permissionLabels.ts` and gated navigation item.

- **Frontend Architecture:**

  - Sidebar Navigation (`nav.ts` & `AppShell.tsx`): Dynamically filters out menu sections and items when the user lacks `.view` permissions.

  - Action Button Gating (`<Can>` and `hasPermission`):

    - `SaleProcessList.tsx`: `+ Create Sale Process` (<Can permission="sale_process.create">), `Export` (<Can permission="sale_process.export">), `Edit Order` (<Can permission="sale_process.update">), `Delete Order` (<Can permission="sale_process.delete">).

    - `StockMovements.tsx`: `+ New Inward Entry` & `+ New Outward Entry` (<Can permission="stock_movement.create">), `Cancel` (<Can permission="stock_movement.cancel">), `Delete` (<Can permission="stock_movement.delete">).

    - `NotificationSettings.tsx`: Toggles and Edit button controlled via `canManage = hasPermission("notification_settings.manage")`. Read-only badge (`🔒 Read Only`) shown if lacking manage rights.

  - Zero-Latency Performance: In-memory O(1) set lookup and cached permission evaluation.

- **Backend Architecture:**

  - Route Protection: All 13 Sale Process endpoints, 11 Stock Movement endpoints, and 3 Notification Rules endpoints are secured with `@require_permission()`.

  - Return Codes: Returns HTTP 403 Forbidden with standard error payload if permission is missing; returns HTTP 200/201 if permission is granted or if user is `super_admin`.



### 40.2. Test Cases & Verification Checklist



| Test ID | Test Scenario | Steps | Expected Result |

| :--- | :--- | :--- | :--- |

| **TC-RBAC1-01** | Super Admin Unrestricted Access | Log in as Super Admin (`roles: ["super_admin"]`). Navigate through Sale Process, Stock Movements, and Notification Rules. | All menu items are visible in sidebar. All actions (+ Create, Export, Edit, Delete, Inward/Outward, Rule Toggle, Edit) are fully visible, enabled, and functional. |

| **TC-RBAC1-02** | View-Only User Navigation & Action Gating | Log in as standard user with only `.view` permissions (`sale_process.view`, `stock_movement.view`, `notification_settings.view`). | Menu items appear in sidebar. Opening the pages renders data, but all mutation buttons (+ Create Sale Process, Export, Edit, Delete, + New Inward/Outward, Cancel Movement) are completely hidden. Notification Rules shows `🔒 Read Only` and disables status toggles. |

| **TC-RBAC1-03** | Restricted User Menu Lockout | Log in as standard user with ZERO Part 1 permissions. Inspect sidebar navigation. | Sale Process, Stock Movement, and Notification Rules are completely hidden from the sidebar navigation. Attempting direct API access returns HTTP 403 Forbidden. |

| **TC-RBAC1-04** | Granular Sales Operator Gating | Assign `sale_process.view`, `sale_process.create`, and `sale_process.update` to a user. | User sees `+ Create Sale Process` and `Edit Order`. The `Delete Order` and `Export` buttons are strictly hidden. Backend rejects `DELETE /api/v1/sales/orders/{id}` with 403 Forbidden. |

| **TC-RBAC1-05** | Stock Clerk Movement Isolation | Assign `stock_movement.view` and `stock_movement.create` to a user. | User can view movements and click `+ New Inward Entry` / `+ New Outward Entry`. High-risk `Cancel` and `Delete` action buttons are completely hidden. Backend rejects cancel/delete requests with 403. |

| **TC-RBAC1-06** | Notification Rules Manager Gating | Assign only `notification_settings.view` to User A and `notification_settings.manage` to User B. | User A sees rule list with `🔒 Read Only` badge and disabled toggles. User B has toggle switches active and can edit rule conditions and templates. |



---



## 41. Cross-ERP Product Master Lifecycle & Inactivation Synchronization (`/masters/products`)



### 41.1. Architectural Specification & Status Semantics

- **One-Way Directional Synchronization:** Yinglima $\rightarrow$ Inhyma strictly for products assigned to Inhyma Solutions LLP (`85c12bcb-10a1-4b1f-92ed-6ca72ac1b3b5`).

- **Event Distinction:**

  * **Creation (`product.created`):** Dispatched upon creating a new product in Yinglima. Inhyma creates the product and assigns it to Inhyma's active catalog.

  * **Inactivation (`product.updated` with `status: "inactive", is_active: False`):** Dispatched when a product is marked inactive. Inhyma sets `status = 'INACTIVE'` with `deleted_at = NULL`. The product immediately moves into Inhyma's `Inactive` tab without being sent to trash.

  * **Re-activation (`product.updated` with `status: "active", is_active: True`):** Dispatched when reactivated in Yinglima. Inhyma sets `status = 'ACTIVE'`, moving it back into Inhyma's `Active` tab.

  * **Deletion (`product.deleted`):** Dispatched when a product is deleted in Yinglima. Inhyma sets `deleted_at = now()` (soft-deleted), removing it from all active/inactive catalog views into trash.

- **Reverse Flow Immunity:** Inactivating or deleting directly in Inhyma NEVER alters Yinglima's product catalog.



### 41.2. Test Cases & Verification Matrix



| Test ID | Test Scenario | Steps | Expected Result |

| :--- | :--- | :--- | :--- |

| **TC-SYNC-01** | Real-Time Product Creation Sync | Create a new product in Yinglima with Organization = Inhyma Solutions LLP. | Product is created in Yinglima and immediately synced to Inhyma. Appears under Inhyma's `Active` tab with identical specifications. |

| **TC-SYNC-02** | Inactivation Separation from Trash | Mark a product Inactive in Yinglima (`status = "inactive"`). | Yinglima sends `product.updated` (`is_active = False`). Inhyma sets `status = 'INACTIVE'` and keeps `deleted_at = NULL`. Inhyma `Active` count drops by 1, and `Inactive` count increases by 1. Product is visible in Inhyma's `Inactive` tab. |

| **TC-SYNC-03** | Product Re-activation Sync | Re-activate the inactive product in Yinglima (`status = "active"`). | Yinglima sends `product.updated` (`is_active = True`). Inhyma sets `status = 'ACTIVE'`. Product moves back from Inhyma's `Inactive` tab to `Active` tab. |

| **TC-SYNC-04** | Product Deletion Removal | Delete a product in Yinglima (`DELETE /api/v1/masters/products/{id}`). | Yinglima sends `product.deleted`. Inhyma soft-deletes the product (`deleted_at` set). Product is removed from both Active and Inactive views in Inhyma. |

| **TC-SYNC-05** | Reverse Inactivation Immunity | Set a product to Inactive directly in Inhyma ERP. | The product becomes inactive in Inhyma, but Yinglima's product remains Active. Zero reverse sync occurs. |
| **TC-SYNC-06** | Dual-Mode Catalog Coexistence | Add a product manually in Inhyma via `+ New Product` while synced products exist. | Manual product appears immediately in Inhyma Product Master. Both synced and manually created products display, paginate, and are selectable across all downstream modules without query blockade. |



### 42. Local Purchase & Sales Process Dynamic VAT Resolution

#### 42.1. Test Cases & Verification Matrix

| Test ID | Test Scenario | Steps | Expected Result |
| :--- | :--- | :--- | :--- |
| **TC-LP-16** | Zero VAT Fallback Verification | 1. Open `/purchases/local/new`.<br>2. Add a product where Product Master has `Purchase VAT % = 0`.<br>3. Enter Unit Rate = 80.00 and Quantity = 10.<br>4. Check item tax rate and VAT amount.<br>5. Save Local Purchase and open in `/sale/process/new`. | • VAT % displays `0%` (not forced to `13%`).<br>• VAT Amount = ¥0.00.<br>• In Sales Process, Unit Price Excl. VAT = Unit Price Incl. VAT = ¥80.00.<br>• Zero hardcoded 13% fallback is applied. |
| **TC-LP-17** | Custom VAT Rate Inheritance | 1. In Product Master, assign `Purchase VAT % = 9%` or select an HSN code with 9%.<br>2. Create a Local Purchase order with this product. | • Local Purchase automatically inherits 9% VAT.<br>• Unit Price RMB Including VAT = Unit Rate × 1.09.<br>• Sales Process removes 9% (`÷ 1.09`) to recover base cost. |
| **TC-SP-10** | Sales Process 0ms Instant Navigation & SWR Cache | 1. Navigate to `/sale/process`.<br>2. Click an order number to open Commercial Invoice modal.<br>3. Close modal.<br>4. Navigate to `/sale/process/new` and back via `← BACK TO LIST`. | • Order list and KPI stat cards render instantly at **0ms** from memory.<br>• Zero loading spinner flicker or screen blanking.<br>• Detail modal opens at 0ms. |
| **TC-SP-11** | Post-Edit Sale Order Instant Cache Sync | 1. Edit a sale order via `/sale/process/:id/edit`.<br>2. Update remarks, container number, or line item and save.<br>3. View the order immediately in `/sale/process`. | • Form saves and redirects to list.<br>• Updated order renders immediately in list and detail modal with zero stale lag. |
| **TC-INQ-12** | Regulated Product License Red Highlighting & Remark in Inquiry List | 1. Open `/inquiries` for a consignment containing a regulated product (e.g. `Test 1` where Product Master has `license_certificate_required`).<br>2. Inspect the left product card list.<br>3. Select the product card to view the right details pane.<br>4. Open Add Item modal and pick a regulated product. | • The product card is prominently highlighted in **RED** with soft red background and red border.<br>• Displays a bold `⚠️ LICENSE NEEDED` badge.<br>• Displays a dashed red remark banner with the exact license/certificate details.<br>• Right pane shows an explicit compliance warning banner.<br>• Add Item modal alerts the user during selection. |

### 43. Global Filter Options Card Standardization & Universal Reset Filters Button

#### 43.1. Test Cases & Verification Matrix

| Test ID | Test Scenario | Steps | Expected Result |
| :--- | :--- | :--- | :--- |
| **TC-FILT-01** | Local Purchases Filter Header & Reset Button | 1. Navigate to `/purchase/local`.<br>2. Click the filter funnel button.<br>3. Inspect the top header of the filter card.<br>4. Select a Supplier, Status, and date range.<br>5. Click `Reset Filters`. | • Filter card header displays `<svg>` Funnel Icon + `Filter Options` on the left.<br>• Top-right shows a permanent `Reset Filters` button (`#f1f5f9` background, slate text).<br>• Clicking `Reset Filters` clears all selections, resets search, and returns pagination to Page 1. |
| **TC-FILT-02** | Sale Process Filter Header & Reset Button | 1. Navigate to `/sale/process`.<br>2. Click the filter funnel button.<br>3. Inspect the top header row of the filter card.<br>4. Select a Buyer, enter a consignment code, and pick a currency.<br>5. Click `Reset Filters`. | • Filter card header displays `Filter Options` with active count badge on left and `Reset Filters` on top-right.<br>• Inputs have title-cased labels above them and uniform 38px heights.<br>• Clicking `Reset Filters` instantly resets Buyer, Consignment, Currency, Dates, and Search, returning to Page 1. |
| **TC-FILT-03** | Provinces (States) Filter Header & Field Label | 1. Navigate to `/masters/states`.<br>2. Click the filter funnel button.<br>3. Inspect the Filter Options card. | • Header displays `Filter Options` on left and `Reset Filters` on top-right.<br>• The dropdown has a clear label `Country / National Level` positioned above it.<br>• Clicking `Reset Filters` clears the country filter and search, and reloads the full list. |
| **TC-FILT-04** | Cities Filter Header & Cascading Labels | 1. Navigate to `/masters/cities`.<br>2. Click the filter funnel button.<br>3. Inspect the Filter Options card. | • Header displays `Filter Options` on left and `Reset Filters` on top-right.<br>• Two columns display labels `Country` and `Province / Region` above each searchable dropdown.<br>• Clicking `Reset Filters` resets both dropdowns to default. |
| **TC-FILT-05** | Product Prices Filter Header & Reset Button | 1. Navigate to `/product-prices`.<br>2. Click the filter funnel button.<br>3. Inspect the Filter Options card. | • Header displays `Filter Options` on left and `Reset Filters` on top-right.<br>• All 4 filter dropdowns (Category, Sub Category, Brand, Pricing Status) span a clean, responsive 4-column grid.<br>• Clicking `Reset Filters` resets all 4 filters and text search in one click. |
| **TC-FILT-06** | Product Gallery Filter Header & Reset Button | 1. Navigate to `/product-gallery`.<br>2. Inspect the top filter card.<br>3. Select a category, sub-category, and enter search text.<br>4. Click `Reset Filters`. | • Header displays `Filter Options` on left and `Reset Filters` on top-right.<br>• Search, Category, Sub Category, and Brand are arranged with uniform labels.<br>• Clicking `Reset Filters` clears all fields back to default. |

---

## 42. MULTI-ERP FEDERATION: Ecosystem SSO Bridge, Canonical Keys & Dynamic Registry Routing

### 42.1. Module Overview & Architectural Specification
- **Component File Map:**
  - Backend: `app/federation/erp_keys.py`, `app/auth/routes.py`
  - Frontend: `frontend/src/lib/ssoBridge.ts`, `frontend/src/pages/Login.tsx`, `frontend/src/pages/Users.tsx`
- **Canonical ERP Key Normalization:**
  - `canonical_erp_key(raw)` strips hyphens, underscores, whitespace, and `erp` suffixes (e.g. `yinglima-erp` $\rightarrow$ `yinglima`).
  - Ensures seamless key matching between ERP_Main registry (`allowed_erps`) and spoke authorization policies without false 403 Forbidden errors.
- **SSO Handover Resilience & Session Preservation:**
  - If incoming SSO handover returns HTTP 401 due to a local account error in this ERP (e.g. "No account exists for you in this ERP", "Account is deleted or disabled"), the central ecosystem cookie is explicitly PRESERVED.
  - The user remains logged in centrally and can freely access other permitted ERPs without global logout.
- **Dynamic Control Plane Routing:**
  - All redirection and dashboard fallbacks dynamically query `controlPlaneUrl(central)` from the ERP registry (`getEcosystemErps()`). Hardcoded port numbers (e.g. `http://localhost:5170`) are eliminated.
  - Users with no access or redirected after denial land on the control plane with explicit `sso_error=no_access` and `sso_reason` parameters.

### 42.2. Test Cases & Verification Matrix

| Test ID | Test Scenario | Steps | Expected Result |
| :--- | :--- | :--- | :--- |
| **TC-SSO-01** | Canonical Key Matching | In ERP_Main, configure user access with `yinglima` or `yinglima-erp`. Authenticate via SSO handover into Yinglima. | Backend `erp_keys.py` canonicalizes key; user receives spoke token pair; lands on Yinglima dashboard. |
| **TC-SSO-02** | Local Account Problem Does Not Kill Central Session | In Yinglima, deactivate the local user account while keeping central user active. Attempt SSO into Yinglima. | Yinglima refuses access with 401/403 and displays informative denial banner. Central session cookie is retained; switching to Inhyma or Control Plane remains authenticated. |
| **TC-SSO-03** | Dynamic Control Plane Re-Routing | Attempt to open Yinglima with an account that only has access to Inhyma. | System redirects to the central control plane / dashboard with `sso_error=no_access` and `sso_reason` explaining the denial; zero hardcoded localhost:5170 redirects. |
| **TC-SSO-04** | Central Users Link Resolution | Navigate to `/users` in Yinglima. Inspect Central Users button link. | Target URL dynamically matches configured control-plane host from registry without fallback port assumptions. |

---

## 43. RUNNER PROCESS SUPERVISION: Port Pre-Flight Hygiene, Fast-Fail Health Checks & Scoped Hot Reload

### 43.1. Module Overview & Architectural Specification
- **Component File Map:**
  - Root Runner: `run_all.py`
  - Backend Bootstrap: `run.bat`
  - Frontend Proxy: `frontend/vite.config.ts`
- **Port Conflict Hygiene & Orphan Reclaiming:**
  - Automated TCP port scanning via `netstat -ano -p tcp` detects orphaned background processes occupying ports (5170, 5173, 5174, 8000, 8001, 8002).
  - Stale process trees are terminated before new instances are spawned, preventing `[Errno 10048]` socket address collision crashes.
- **Fast-Fail Health Probing:**
  - `wait_for_backend_health` checks child process status (`proc.poll()`) on every polling cycle, failing immediately upon unexpected crashes instead of blocking for the full timeout.
- **Scoped WatchFiles Hot Reload:**
  - Restricts backend file watching strictly to the `app` package directory (`--reload-dir app`), eliminating restart storms caused by caches, tests, migrations, or temporary file writes.
- **Vite Proxy Disconnect Shield:**
  - Catches transient `ECONNRESET`, `ECONNREFUSED`, and `socket hang up` notices in the Vite HTTP/WS proxy during backend reload/restart, suppressing terminal pollution.

### 43.2. Test Cases & Verification Matrix

| Test ID | Test Scenario | Steps | Expected Result |
| :--- | :--- | :--- | :--- |
| **TC-RUN-01** | Clean Ecosystem Startup | Launch `python run_all.py` from root workspace. | All 3 backends and all 3 frontends start in order; health endpoints return HTTP 200; all 6 services report healthy. |
| **TC-RUN-02** | Scoped Reload Immunity | Modify a non-app file (e.g. `.pytest_cache`, documentation, or test file). | Backend server continues running without triggering a WatchFiles server restart. |
| **TC-RUN-03** | Immediate Exit on Crash | Force an early backend crash (e.g. invalid port configuration). | Runner immediately reports process exit code and terminates wait cycle without hanging for 180 seconds. |
| **TC-RUN-04** | Graceful Multi-Service Shutdown | Send SIGINT (`Ctrl+C`) to the running master runner. | All 6 services and child process trees terminate cleanly without leaving orphaned listening sockets. |
| **TC-PP-MODAL-01** | Product Prices Add Quote Modal at 100% Zoom | At 100% browser zoom on `/inventory/product-prices`, click `+ Quote` or `+ Assign` on any product. | All fields align cleanly with the top product banner, and both `Cancel` and `+ Add Supplier Quote` / `Save Supplier Quote` buttons are fully visible inside the white modal card without needing to zoom out. |
| **TC-SALE-LP-01** | Sale Process Auto-Load from Inwarded Local Purchase | Create a Local Purchase for a product (e.g. `DAR-00208`), inward it into stock (`Received / Inwarded`), then auto-load a consignment containing `DAR-00208` in `/sale/process/new`. | Sale Process automatically populates `Supplier` (`✓ Local Purchase`), `Unit Price (RMB) Including VAT`, `Excluding VAT`, `Including Profit %`, `FOB Price (USD)`, and `CFR Price/Unit` from the inwarded Local Purchase. |

---
*End of Master Features & Testing Specification Manual. Maintained for Yinglima Enterprise ERP. Last updated: October 2026 (Sections 42-43: Multi-ERP Ecosystem SSO Bridge, Canonical ERP Keys, Dynamic Registry Routing, Central Session Resilience, Master Runner Process Supervision, and Scoped Reload).*
