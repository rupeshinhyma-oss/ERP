# Enterprise ERP — Complete Modules, Features & Testing Specification Manual

> **Document Type:** Master Regression Testing Specification & Feature Catalog  
> **Location:** Root Workspace (`/MODULES_AND_FEATURES_TEST_MANUAL.md`)  
> **Purpose:** Exhaustive reference catalog detailing every single module, page layout, table column, action button, modal window, drawer, form tab, and form field across the entire ERP. Designed for developers, QA testers, and autonomous AI agents to execute manual and automated regression tests before and after code changes.  
> **Strict Policy:** When developing or modifying features, no existing module, form, or field listed in this document may be removed, broken, or regressed.  
> **Last Updated:** October 29, 2026

---

## Table of Contents

1. [Executive Testing Principles & Rules of Engagement](#1-executive-testing-principles--rules-of-engagement)
2. [Master Navigation Sitemap](#2-master-navigation-sitemap)
3. [DASHBOARD Module](#3-dashboard-module)
4. [CONTACT: Suppliers Module](#4-contact-suppliers-module)
5. [CONTACT: Buyers Module](#5-contact-buyers-module)
6. [INVENTORY: Product Master Module](#6-inventory-product-master-module)
7. [INVENTORY: Product Gallery Module](#7-inventory-product-gallery-module)
8. [INVENTORY: Categories Master Module](#8-inventory-categories-master-module)
9. [INVENTORY: Sub Categories Master Module](#9-inventory-sub-categories-master-module)
10. [INVENTORY: Brands Master Module](#10-inventory-brands-master-module)
11. [INVENTORY: Supplier Types Master Module](#11-inventory-supplier-types-master-module)
12. [INVENTORY: Buyer Types Master Module](#12-inventory-buyer-types-master-module)
13. [SALE: Inquiries & Proforma Workflow Module](#13-sale-inquiries--proforma-workflow-module)
14. [PLANNING: Master Shipment Planning Grid Module](#14-planning-master-shipment-planning-grid-module)
15. [USER MANAGEMENT: Users Module](#15-user-management-users-module)
16. [USER MANAGEMENT: Departments & Permissions (RBAC) Module](#16-user-management-departments--permissions-rbac-module)
17. [CONFIGURATIONS: HSN Codes Master Module](#17-configurations-hsn-codes-master-module)
18. [CONFIGURATIONS: Geography Masters (Countries, Provinces, Cities)](#18-configurations-geography-masters-countries-provinces-cities)
19. [CONFIGURATIONS: Currencies Master Module](#19-configurations-currencies-master-module)
20. [CONFIGURATIONS: Units of Measurement (UOM) Master Module](#20-configurations-units-of-measurement-uom-master-module)
21. [CONFIGURATIONS: ERP Settings & Company List](#21-configurations-erp-settings--company-list)
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
32. [WORK MANAGEMENT: Tasks, Kanban & Calendar Module](#32-work-management-tasks-kanban--calendar-module)
33. [AI Subagent Autonomous Testing Prompt Template](#33-ai-subagent-autonomous-testing-prompt-template)
34. [CONFIGURATIONS: Company Categories Master Module](#34-configurations-company-categories-master-module)
35. [SETTINGS: Bank Master Module](#35-settings-bank-master-module)
36. [CONTACT: Companies Module](#36-contact-companies-module)
37. [INVENTORY: Product Stock Module](#37-inventory-product-stock-module)
38. [INVENTORY: Stock Adjustment & Order PDF Module](#38-inventory-stock-adjustment--order-pdf-module)
39. [TASK: Technical Tasks Module](#39-task-technical-tasks-module)
40. [GLOBAL PLATFORM HARDENING: Autocomplete Suppression & Wheel Lockout](#40-global-platform-hardening-autocomplete-suppression--wheel-lockout)
41. [AUTOCOMPLETE: Typeahead Company Extraction & Prefill](#41-autocomplete-typeahead-company-extraction--prefill)
42. [INVENTORY: Client Name Autocomplete in Stock Adjustment](#42-inventory-client-name-autocomplete-in-stock-adjustment)
43. [LEADS: Lead Inquiries Management & Sales Pipeline](#43-leads-module-lead-inquiries-management--sales-pipeline)
44. [CALL LOG: Follow Ups Management & Inquiries Tracking](#44-call-log-follow-ups-management--inquiries-tracking)
45. [HRMS: Leave Management Module (Phase 1: Foundation & Master Data)](#45-hrms-leave-management-module-phase-1-foundation--master-data)
46. [MASTERS MODULE: Interactive Status Toggle Switch & Payment Terms Master](#46-masters-module-interactive-status-toggle-switch--payment-terms-master)
47. [PURCHASE: Local Purchase Management & Costing Engine](#47-purchase-local-purchase-management--costing-engine)
48. [PURCHASE: Import Purchase Consignments & Customs Landing Matrix](#48-purchase-import-purchase-consignments--customs-landing-matrix)
49. [SALE: Proforma Invoices (Extended Commercial Terms, Address Routing, Approvals Workflow)](#49-sale-proforma-invoices-extended-commercial-terms-address-routing-approvals-workflow)
50. [COMPANIES: Advanced Specification Fields (Monthly Turnover, Potential Analysis, Direct Import from China)](#50-companies-advanced-specification-fields-monthly-turnover-potential-analysis-direct-import-from-china)
51. [SUPPLIERS: Mandatory Calling Number Validation & Contact Phone Rules](#51-suppliers-mandatory-calling-number-validation--contact-phone-rules)
52. [HRMS: HRMS All-Employee Attendance Calendar & Payroll Excel Export QA Verification](#52-hrms-hrms-all-employee-attendance-calendar--payroll-excel-export-qa-verification)
53. [GLOBAL UI STANDARD: Universal Filter Toggle Button & Collapsible Panel Specification](#53-global-ui-standard-universal-filter-toggle-button--collapsible-panel-specification)
54. [GLOBAL UI STANDARD: Universal Page Header, 35px Action Button Standard, and Filter-Above-KPI Hierarchy Across All Modules](#54-global-ui-standard-universal-page-header-35px-action-button-standard-and-filter-above-kpi-hierarchy-across-all-modules)
55. [PAYMENTS: Customer & Supplier Payments Engine, Cash Flow, and Technician Payment Handover](#55-payments-customer--supplier-payments-engine-cash-flow-and-technician-payment-handover)
56. [CRM: Customer Relationship Management Full Suite (Leads, Pipeline, Distribution, Quotations)](#56-crm-customer-relationship-management-full-suite)
57. [WORKFORCE: Recurring Tasks Scheduling Engine](#57-workforce-recurring-tasks-scheduling-engine)
58. [PROFORMA INVOICES: Connected Address Automation, Expected Delivery Date Future Validation, and Slide-Over Add Company & Edit Address Drawers](#58-proforma-invoices-connected-address-automation-expected-delivery-date-future-validation-and-slide-over-add-company--edit-address-drawers)
59. [LOCAL PURCHASE: Unit Landing Rate (INR) (VB) Renaming, Side Scrollbar, and Confirmed Order Delete Protection](#59-local-purchase-unit-landing-rate-inr-vb-renaming-side-scrollbar-and-confirmed-order-delete-protection)
60. [FEED & BROADCAST: Enterprise Timeline, Department & Role Scoping, Interaction Privacy & Reactions](#60-feed--broadcast-enterprise-timeline-department--role-scoping-interaction-privacy--reactions)
61. [DYNAMIC BRAND LOGO: Real-Time Sidebar Branding from ERP Organization Settings](#61-dynamic-brand-logo-real-time-sidebar-branding-from-erp-organization-settings)
62. [PRODUCT MASTER: Category Display Rewiring, Machine Spares Linkage, and Floating Duplicate Overlay Dropdown](#62-product-master-category-display-rewiring-machine-spares-linkage-and-floating-duplicate-overlay-dropdown)
63. [PLATFORM STABILITY: Database Migration Idempotency, Notification Polling Engine, and Multi-ERP Identity Hardening](#63-platform-stability-database-migration-idempotency-notification-polling-engine-and-multi-erp-identity-hardening)
64. [SALE: Sales Process Add New Form (Full Parity with Proforma, Dynamic Masters, Exceeded Stock Alerts, Grey-Locked Cells & Drawers)](#64-sale-sales-process-add-new-form-full-parity-with-proforma-dynamic-masters-exceeded-stock-alerts-grey-locked-cells--drawers)
65. [SALE: Sales Process Live KPI Metrics & Status Tabs Dynamic Calculation Engine](#65-sale-sales-process-live-kpi-metrics--status-tabs-dynamic-calculation-engine)
66. [SALE: Sales Process 9-Status Action Menu Matrix, LR Duplicate, Direct Cancellation & SO Files Deletion](#66-sale-sales-process-9-status-action-menu-matrix-lr-duplicate-direct-cancellation--so-files-deletion)
67. [SALE PROCESS: Collapsible Filter Panel 13-Field Grid & Dropdown Sales Person Selection](#67-sale-process-collapsible-filter-panel-13-field-grid--dropdown-sales-person-selection)
68. [HRMS PHASES 2–6: Granular RBAC, Deny Precedence, Manager-First Real Availability Routing, Two-Stage Approvals & Separation of Duties](#68-hrms-phases-26-granular-rbac-deny-precedence-manager-first-real-availability-routing-two-stage-approvals--separation-of-duties)
69. [FEED: Open Broadcasting & 1-to-1 Private Employee Messaging](#69-feed-open-broadcasting--1-to-1-private-employee-messaging)
70. [SALE PROCESS: Sale Status Update Side Drawer, Multi-Stage Workflow, PO File & Tally Bill Upload](#70-sale-process-sale-status-update-side-drawer-multi-stage-workflow-po-file--tally-bill-upload)
71. [SALE: Discount Payments Ledger, Multi-Installment Adjustment Drawer & Payment List Modal](#71-sale-discount-payments-ledger-multi-installment-adjustment-drawer--payment-list-modal)
72. [REPORTS: Product Re-Order Matrix, Branch-Scoped Shortfall Engine & FIFO Stock Breakup](#72-reports-product-re-order-matrix-branch-scoped-shortfall-engine--fifo-stock-breakup)
73. [REPORTS: Product Stock Transactions Master List & Per-Product Stock Transaction Ledger](#73-reports-product-stock-transactions-master-list--per-product-stock-transaction-ledger)

---

## 1. Executive Testing Principles & Rules of Engagement

1. **Zero Feature Loss Guarantee**: Whenever AI or human engineers add or edit code, this checklist must be tested to ensure existing buttons, fields, validation rules, popovers, and drawers continue to render and function.
2. **Form Completeness**: Every form must retain all specified fields, dropdown data loaders, maskings (e.g. phone country codes), and conditional locks (e.g. 1-way status lock from `New` $\rightarrow$ `Existing`).
3. **Data Integrity**: Soft-deletion must always move records to Trash (`/trash`) and never physically purge rows from active tables.
4. **Optimistic Locking & Concurrency**: Modifying entities must send and check `version` increments to avoid dirty concurrent overwrites.

---

## 2. Master Navigation Sitemap

| Sidebar Section | Navigation Label | Route Path | Active Key | Icon Key | Required Permission |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **DASHBOARD** | Dashboard | `/dashboard` | `dashboard` | `dashboard` | Public Authenticated |
| **CONTACT** | Companies | `/companies` | `companies` | `building` | `company.view` |
| **CONTACT** | Suppliers | `/suppliers` | `suppliers` | `factory` | `supplier.view` |
| **CONTACT** | Buyers | `/buyers` | `buyers` | `shoppingBag` | `buyer.view` |
| **INVENTORY** | Product Stock | `/product-stock/list` | `product-stock` | `stock` | `product.view` |
| **INVENTORY** | Stock Adjustment | `/stock-adjustment` | `stock-adjustment` | `sliders` | `product.view` |
| **INVENTORY** | Stock Transfer | `/stock-transfer` | `stock-transfer` | `truck` | `product.view` |
| **INVENTORY** | Product Master | `/masters/products` | `masters-products` | `box` | `product.view` |
| **INVENTORY** | Product Gallery | `/product-gallery` | `product-gallery` | `image` | `productgallery.view` |
| **INVENTORY** | Categories | `/masters/categories` | `masters-categories` | `layers` | `category.view` |
| **INVENTORY** | Sub Categories | `/masters/subcategories` | `masters-subcategories` | `folderTree` | `subcategory.view` |
| **INVENTORY** | Brands | `/masters/brands` | `masters-brands` | `award` | `brand.view` |
| **INVENTORY** | Supplier Types | `/masters/supplier-types` | `masters-supplier-types` | `network` | `suppliertype.view` |
| **INVENTORY** | Buyer Types | `/masters/buyer-types` | `masters-buyer-types` | `idCard` | `buyertype.view` |
| **SALE** | Inquiries | `/inquiries` | `inquiries` | `fileText` | Public Authenticated / `inquiry.view` |
| **SALE** | Proforma Invoices | `/proforma-invoice/list` | `proforma` | `fileText` | `sale.pi.view` |
| **SALE** | Sales Process | `/sales/process` | `sale-process` | `shoppingCart` | `saleorder.view` |
| **SALE** | Add Sales Order | `/sales/process/add` | `sale-process-add` | `plusCircle` | `saleorder.create` |
| **SALE** | Discount Payments | `/discount-payments` | `discount-payments` | `creditCard` | `saleorder.view` |
| **CRM** | Leads & Pipelines | `/crm/leads` | `crm-leads` | `users` | `crm.view` |
| **CRM** | Sales Quotations | `/crm/quotations` | `crm-quotations` | `fileText` | `crm.quotation.view` |
| **COMMUNICATION** | Feed & Announcements | `/feed` | `feed` | `messageSquare` | Authenticated |
| **PURCHASE** | Local Purchase | `/purchase/localpurchase` | `local-purchases` | `shoppingBag` | `purchase.view` |
| **PURCHASE** | Import Purchase | `/purchase/importpurchase` | `import-purchases` | `ship` | `purchase.view` |
| **PURCHASE** | Purchase Suppliers | `/purchase/suppliers` | `purchase-suppliers` | `factory` | `supplier.view` |
| **REPORTS** | Re-Order | `/reports/re-order` (`/product-reorder/list`) | `reports-reorder` | `refreshCw` | `product.view` |
| **REPORTS** | Stock Transactions | `/reports/stock-transactions` (`/transaction-report/list`) | `reports-stock-transactions` | `activity` | `product.view` |
| **REPORTS** | Stock Transaction Detail | `/stock-transaction/list/:id` | `reports-stock-transactions` | `activity` | `product.view` |
| **REPORTS** | Deleted Orders | `/reports/deleted-orders` | `reports-deleted-orders` | `fileX` | `saleorder.view` |
| **REPORTS** | General Reports | `/reports/general` | `reports-general` | `pieChart` | Authenticated |
| **TASK** | Tasks | `/tasks` | `tasks` | `checkSquare` | `task.view` |
| **TASK** | Technical Tasks | `/technical-task/list` | `technical-tasks` | `wrench` | `technicaltask.view` |
| **USER MANAGEMENT** | Users | `/users` | `users` | `user` | `user.view` |
| **USER MANAGEMENT** | Positions | `/positions` | `positions` | `briefcase` | `position.view` |
| **USER MANAGEMENT** | Organization Chart | `/org-chart` | `org-chart` | `orgChart` | `reporting.view` |
| **USER MANAGEMENT** | Departments & Permissions | `/rbac` | `rbac` | `shield` | `roles_permissions.view` |
| **CONFIGURATIONS** | HSN Codes | `/masters/hsn` | `masters-hsn` | `barcode` | `hsn.view` |
| **CONFIGURATIONS** | Countries | `/masters/countries` | `masters-countries` | `globe` | `country.view` |
| **CONFIGURATIONS** | Provinces | `/masters/states` | `masters-states` | `map` | `state.view` |
| **CONFIGURATIONS** | City | `/masters/cities` | `masters-cities` | `pin` | `city.view` |
| **CONFIGURATIONS** | Currencies | `/masters/currencies` | `masters-currencies` | `coins` | `currency.view` |
| **CONFIGURATIONS** | Units of Measurement | `/masters/uom` | `masters-uom` | `ruler` | `uom.view` |
| **CONFIGURATIONS** | Taxes | `/masters/taxes` | `masters-taxes` | `percent` | `tax.view` |
| **CONFIGURATIONS** | Additional Charges | `/masters/additional-charges` | `masters-additional-charges` | `receipt` | `additionalcharge.view` |
| **CONFIGURATIONS** | Social Media | `/masters/social-media` | `masters-social-media` | `share2` | `socialmedia.view` |
| **CONFIGURATIONS** | Agent Types | `/masters/agent-types` | `masters-agent-types` | `userCheck` | `agenttype.view` |
| **CONFIGURATIONS** | Company Categories | `/masters/company-categories` | `masters-company-categories` | `building` | `companycategory.view` |
| **CONFIGURATIONS** | Company Sectors | `/masters/company-sectors` | `masters-company-sectors` | `layers` | `companysector.view` |
| **CONFIGURATIONS** | Warehouses | `/masters/warehouses` | `masters-warehouses` | `home` | `warehouse.view` |
| **CONFIGURATIONS** | Billing Company | `/masters/billing-company` | `masters-billing-company` | `building` | `billingcompany.view` |
| **CONFIGURATIONS** | Technicians | `/masters/technicians` | `masters-technicians` | `user` | `technician.view` |
| **CONFIGURATIONS** | ERP Settings | `/organization` | `organization` | `settings` | `organization.manage` |
| **CONFIGURATIONS** | Organization List | `/masters/company-list` | `masters-company-list` | `building` | `organizationlist.view` |
| **CONFIGURATIONS** | Audit Log | `/audit` | `audit` | `clock` | `audit.view` |
| **CONFIGURATIONS** | Trash | `/trash` | `trash` | `trash` | `trash.view` |

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
     - ⚙️ **ERP Settings** (`/organization`)
     - 🚪 **Logout** (`POST /api/v1/auth/logout` $\rightarrow$ redirects to `/login`)

### Test Cases
- [ ] Verify logging in redirects directly to `/dashboard`.
- [ ] Verify the user's name is dynamically extracted from `authContext` and displayed in the heading.
- [ ] Verify clicking the profile menu and selecting "My Profile" navigates to `/profile`.
- [ ] Verify clicking "Logout" clears session tokens and redirects to `/login`.

---

## 4. CONTACT: Suppliers Module

- **Route:** `/purchase/suppliers` (legacy redirects: `/suppliers`, `/supplier/list`; Sidebar `activeKey`: `purchase-suppliers` under **PURCHASE**)
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
5. **Toolbar Row:**
   - **Items/Page Dropdown:** `10`, `25`, `50`, `100`, `250`.
   - **📌 Freeze Columns Button:** Opens column pin popover menu (Left / Right / Unpin).
   - **Search Input:** `Search company, country, contact, city, phone...` (live debounced search with `✕` clear button, and numeric Sr. No. jump support).

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
| **Company Name** | `company_name` | Text | — | **YES** | Auto Title-cased; checks real-time duplicate suggestions |
| **Product Category** | `category_ids` | Multi-Select Dropdown | `/masters/product-categories` | No | Searchable multi-panel with checkboxes |
| **Key Strength Sub-Category** | `sub_category_ids` | Multi-Select Dropdown | `/masters/product-sub-categories` | No | Dynamically filtered by chosen Category |
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
- **Company Name** (*Required*): Auto title-case + 3-way duplicate detection (Company + Phone + WhatsApp).
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
  - **Visit Photos / Media Upload**: Multi-file uploader directly connected to **Supabase Cloud Storage** (`supplier-media` bucket) with preview thumbnails and delete action.
  - **Visit Video URL**: Link to factory inspection video (YouTube, Youku, Cloud Storage).
- **Overall Remarks**: General procurement notes.

#### Tab 2: 📇 Contacts Sub-Panel
Manage complete vendor team directory:
- **`+ Add Contact` Button**: Opens contact sub-form with:
  - **Salutation**: `Mr.`, `Ms.`, `Mrs.`, `Dr.`
  - **Person Name** (*Required*): Full name.
  - **Designation**: Role / title.
  - **Handling Territory**: e.g., North America, India, Europe.
  - **Calling Number**: Phone input with country dial code prefix.
  - **WhatsApp Number**: With "Same as Calling" checkbox.
  - **WeChat ID / Number**: With "Same as Calling" checkbox.
  - **Email Address**: Direct email.
- **Contacts Table**: Lists all contacts with `Primary Contact` badge, `Edit` button, and `Delete` button.

#### Tab 3: 📦 Products & Categories
- **Product Categories**: Multi-select panel.
- **Key Strength Sub-Categories**: Multi-select panel scoped to categories.
- **Products Supplied**: Multi-select product picker.
- **Secondary Products Description**: Text area for custom/ancillary items.

### 4.5. Supplier Detail Side Drawer
- **Header:** Company name, status badge, grade badge, potential badge, and public quote share link.
- **Sections:** Identity, Geography, Contact Persons Grid, Sourcing Status, Factory Visit Photos Gallery, Notes.

### Test Cases
- [ ] Open `/purchase/suppliers` and confirm active list loads and `Suppliers` under `PURCHASE` in the left sidebar is highlighted active (`.nav-item.active`).
- [ ] Click `+ QUICK ADD`, fill Company Name, Country, State, City and save. Verify record appears in table.
- [ ] Click `+ ADD NEW`, navigate all 3 tabs, upload factory visit photo, add contact person, and save.
- [ ] Test Country Dial Code Auto-Update: Change Country (e.g. China -> India) and verify Calling Number, WhatsApp Number, and WeChat Number dialing codes automatically update (e.g. `+86` -> `+91`) while resetting Province/City dropdowns.
- [ ] Test 1-Way Status Lock: Change status to `Existing`, save, edit again and verify `New` cannot be chosen.
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

### Test Cases
- [ ] Create Buyer with Company Name, Country, Calling Number, and save.
- [ ] Verify duplicate alert pops up if saving a second buyer with the exact same phone number.
- [ ] Verify deleting a buyer with status `Existing` or potential `Yes` is blocked by protection dialog.

---

## 6. INVENTORY: Product Master Module

- **Route:** `/masters/products`
- **Purpose:** Centralized product catalog, machine-spares compatibility mapping, package-level dimensions report, CBM packaging calculations, photo gallery uploader, and ReportLab PDF datasheet generation.

### 6.0. Master Multi-View Navigation Strip
- Directly beneath the breadcrumb bar (`Dashboard / Product Master`), the `.master-view-nav` tab bar allows one-click switching between three dedicated views:
  1. **`📦 Product Master` (`catalog`):** Main product catalog grid featuring column pinning, inline stock inspection, and bulk activation/deactivation.
  2. **`⚙️ Machine-Spares Universal View` (`universal-view`):** Machine-wise spare parts breakdown showing all linked spare parts, codes, stock levels, and compatibility notes with a dedicated link modal (`/masters/products/machine-spares/universal-view`).
  3. **`📐 Dimensions & Weights Report` (`dimensions-report`):** Package-level breakdown for multi-box products, displaying Length, Width, Height, CBM, Net Weight, and Gross Weight with direct CSV and XLSX export triggers.

### 6.1. Product Master Table Columns
1. **Checkbox:** Row selector.
2. **SR. NO.:** Sequential number with sort cue.
3. **IMAGE:** Thumbnail preview with click-to-expand lightbox.
4. **PRODUCT CODE:** Unique SKU / Item code.
5. **PRODUCT NAME (TALLY):** Official internal accounting name with real-time duplicate suggestions guard.
6. **INVOICE NAME:** Commercial description used on billing documents.
7. **CATEGORY / SUB-CATEGORY:** Dynamic Category badge (`getCategoryNameForProduct(p)`) with secondary Sub-Category chip. For products categorized under machines, the category badge is interactive (`cursor-pointer`) and directly launches the dedicated Machine Spares management drawer.
8. **BRAND:** Manufacturer brand name.
9. **HSN / SAC:** Customs code with VAT Refund rate indicator.
10. **PRIMARY UOM:** Base unit (e.g. PCS, SET, KG).
11. **PACKAGING CBM:** Calculated volume ($L \times W \times H / 1,000,000$).
12. **STATUS:** `Active` / `Inactive` badge.
13. **ACTIONS:**
    - **View Detail Drawer** (`👁️`): Opens the full-height `SideDrawer` displaying complete product specifications, pricing, media gallery, and machine-spare links.
    - **Edit Product** (`✏️`): Opens the full Add/Edit product modal.
    - **Download PDF Datasheet** (`📄`): Downloads ReportLab PDF datasheet.
    - *Note on Delete*: Row-level `Delete` action has been intentionally removed from the master list table to prevent accidental deletion of enterprise catalog items.

### 6.2. Product View SideDrawer Architecture
- **Header Actions Positioning:**
  - The `Edit Product` action button is positioned at the top-right header of `SideDrawer.tsx` within the dedicated `headerActions` slot, adjacent to the close button (`✕`).
  - The bottom fixed footer button row has been eliminated, ensuring uninterrupted scrolling of product specifications, dimensions, and photo galleries down to the viewport base.
- **Identity & Classification Grid Deduplication:**
  - Standardized single-row rendering for Category and Sub-Category, eliminating redundant duplicate Category entries.
- **Dedicated Machine Spare Parts Section:**
  - For products identified as `Machine` (`product_type == "Machine"` or categorized under machines), the drawer includes an interactive **Spare Parts** section.
  - Displays total count of currently mapped compatible spare parts.
  - Lists mapped spares with Part Code, Name, and Brand badges.
  - Features a prominent `Manage Spare Parts →` button that directly opens the dedicated Machine Spares management interface for that machine.

### 6.3. Add / Edit Product Form Fields
- **Basic Details:**
  - **Product Code**: Auto-generated or manual SKU.
  - **Product Name (Tally / Internal)** (*Required*): Primary product title.
  - **Floating Duplicate Name Suggestion Overlay:** As the operator types, a floating overlay dropdown (`absolute left-0 right-0 top-full mt-1 z-30`) renders beneath the input displaying real-time similarity matches (e.g. `95% match`) with existing catalog products and a 1-click preview link, preventing duplicate entries without disrupting the form layout.
  - **Product Name (Invoice / Export)**: Commercial description.
  - **Barcode / EAN / UPC**: Barcode number.
- **Classification & Taxonomy:**
  - **Category** (*Required*): Dropdown from `/masters/product-categories`.
  - **Sub-Category**: Dynamically filtered by chosen Category.
  - **Brand**: Dropdown from `/masters/brands`.
  - **HSN Code**: Dropdown from `/masters/hsn` (auto-fills Refund VAT %).
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
  - Multi-image uploader uploading directly to **Supabase Storage** (`product-images` bucket).

### 6.4. Machine Spare Parts Dedicated Management View
- **Navigation:** Accessible from the Product Master list view, the Machine View SideDrawer (`Manage Spare Parts →`), or `/masters/products/machine-spares/:machineId`.
- **Dual-Tab Architecture:**
  1. **`Selected (<count>)` Tab:**
     - Displays strictly the spare parts currently associated with the selected machine.
     - Action column displays a `Remove` button to unlink the spare from this machine.
  2. **`All Spare Parts (<count>)` Tab:**
     - Catalogs all global spare parts available in the master inventory.
     - Search bar filters by Part No, Item Code, Product Name, Brand, and OEM Compatibility.
     - Action column displays `+ Add` for unlinked spares or a disabled `✓ Added` indicator for already mapped spares.
- **11-Column Table Layout:**
  1. `#`: Sequential index.
  2. `PART NO.`: Spare part manufacturing number.
  3. `ITEM CODE`: Product SKU / code.
  4. `PRODUCT NAME`: Full internal catalog description.
  5. `BRAND`: Brand classification badge.
  6. `CATEGORY`: Top-level taxonomy.
  7. `SUB CATEGORY`: Sub-level taxonomy.
  8. `OEM COMPATIBILITY`: Compatible models and machine tags.
  9. `PRICE (INR)`: Standard selling price formatted in INR currency (`₹XX,XXX.XX`).
  10. `SPECIFICATION`: Technical specifications and parameter attributes.
  11. `ACTION`: Interactive association controls (`+ Add`, `✓ Added`, `Remove`).
- **Multi-Machine Association Model:**
  - Spares can be shared across multiple machines (e.g. universal bearings, sensors) or assigned exclusively to a single machine.
  - Unlinking a spare part from one machine does not alter its mapping to any other machine.

### Test Cases
- [ ] Create a product, enter Length: `100`, Width: `50`, Height: `40`. Verify CBM calculates to `0.200000`.
- [ ] Select HSN code with 13% Refund VAT and confirm Refund VAT % field auto-populates with `13`.
- [ ] Click "Download PDF Datasheet" (`GET /api/v1/products/{id}/datasheet-pdf`) and verify ReportLab PDF generates.
- [ ] Open Product Master table and verify the `ACTION` column contains View (`👁️`), Edit (`✏️`), and Datasheet (`📄`), with no `Delete` button present.
- [ ] Open a Machine product's detail drawer and verify:
  - `Edit Product` button is rendered at the top-right header next to the close (`✕`) button.
  - Bottom drawer area has no sticky footer buttons.
  - Dedicated **Spare Parts** section renders the mapped spare parts count and `Manage Spare Parts →` button.
- [ ] Click `Manage Spare Parts →` and verify the dedicated 2-tab view opens:
  - `Selected` tab shows only mapped spares with a `Remove` action.
  - `All Spare Parts` tab shows the full spare catalog with 11 columns, real-time search, and `+ Add` / `✓ Added` buttons.
  - Add a spare part in `All Spare Parts` tab and confirm it immediately appears in `Selected` tab with an incremented tab badge count.

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

## 13. SALE: Inquiries & Proforma Workflow Module

- **Route:** `/inquiries`
- **Purpose:** End-to-end 3-layer RFQ and Quotation management lifecycle:
  $$\text{Layer 1: Buyer Summary Directory} \longrightarrow \text{Layer 2: Buyer Consignments (FB1, FB2...)} \longrightarrow \text{Layer 3: Inquiry Line Items, RFQs \& Quotation Matrix}$$

### 13.1. Layer 1: Buyer Inquiries Directory
- **Summary Cards / Top KPIs:**
  - **Pending RFQs:** Count of items awaiting supplier quotes.
  - **Approved Quotes:** Count of line items with approved supplier pricing.
  - **Ongoing Inquiries:** Active buyer consignments currently in negotiation.
  - **Completed Consignments:** Successfully ordered / fulfilled consignments.
  - **Total Order Value:** Sum of all active consignment line items.
- **Buyer Directory Table Columns:**
  1. **Checkbox:** Select all / individual buyer rows.
  2. **SR. NO.:** Sequential index with sort.
  3. **BUYER COMPANY NAME:** Clickable buyer title drilling down to Layer 2 Consignments.
  4. **ACTIVE CONSIGNMENTS:** Count badge of active consignments (e.g. `3 Consignments`).
  5. **TOTAL ITEMS:** Total product line items across all consignments.
  6. **STATUS BADGE:** `PENDING`, `PARTIAL_APPROVED`, `FULLY_APPROVED`, `COMPLETED`.
  7. **ORDER VALUE:** Financial sum with currency indicator.
  8. **ACTIONS:** Drilldown arrow (`➔`), Quick Add Item button.
- **Top Actions:**
  - ⚡ **`+ Quick Add Inquiry` Modal:**
    - **Buyer Company** (*Required*): Searchable dropdown from `/buyers`.
    - **Consignment Code** (*Required*): Dropdown of existing codes or type new (e.g. `FB1`).
    - **Product Item** (*Required*): Type-ahead search with Product Code + Name + Category from Product Master.
    - **Quantity** (*Required*): Number input.
    - **Target Price**: Buyer's budgeted price.
    - **Brand Preference**: Preferred manufacturer/brand.
    - **Product Specs Remarks**: Custom technical or packaging requirements.
    - **Action Buttons:** `Cancel`, `Save Item`, `Save & Add Another Item`.
  - ➕ **`+ New Consignment` Modal:**
    - **Buyer Company** (*Required*): Select buyer.
    - **Consignment Code** (*Required*): e.g. `FB1`, `FB2`, `MUM-2026-AUG`.
    - **Target Delivery Date**: Date picker.
    - **Consignment Remarks / Notes**: Text area.

---

### 13.2. Layer 2: Consignments View (Inside a Buyer)
- **Top Header & Navigation:**
  - `← Back to All Companies` breadcrumb button.
  - Heading: `Inquiries for {Buyer Company Name}`.
- **Consignments Table Columns:**
  1. **CONSIGNMENT CODE:** Clickable title (e.g. `FB1`, `FB2`) drilling down to Layer 3 Line Items.
  2. **CREATED DATE:** Timestamp of inquiry initiation.
  3. **TARGET DELIVERY DATE:** Expected receiving / shipping date.
  4. **TOTAL ITEMS:** Count of items in this consignment.
  5. **RFQ DISPATCH STATUS:** `Not Sent`, `Sent to Suppliers`, `Quotes Received`.
  6. **QUOTES RECEIVED:** Count of submitted vendor quotes (e.g. `4 Quotes`).
  7. **STATUS:** `DRAFT`, `SENT_TO_SUPPLIERS`, `UNDER_EVALUATION`, `APPROVED`, `CLOSED`.
  8. **ACTIONS:** `Open Items View`, `Edit Consignment Details`, `Delete Consignment`.

---

### 13.3. Layer 3: Inquiry Line Items, RFQs & Quotation Matrix
- **Top Navigation:**
  - `← Back to Consignments` button.
  - Breadcrumb: `Inquiries / {Buyer Name} / {Consignment Code}`.
- **Toolbar Actions:**
  - ➕ **`+ Add Line Item` Button & Modal:**
    - Product picker (loads SKU, image, category), Quantity, Primary UOM, Target Price, Brand Preference, Remarks.
  - ⚡ **`+ Bulk Add Items` Button & Modal:**
    - Multi-row product picker from Product Master with live search. Check multiple products and enter quantities simultaneously.
  - 📤 **`Dispatch Bulk RFQs` Button & Modal:**
    - **Select Suppliers**: Multi-select supplier picker filtered by relevant product categories or all suppliers.
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
    - **Supplier Thread Filter**: Dropdown allowing users to isolate conversations with specific suppliers (e.g. `Wenzhou Brother Machinery`) or view all combined.
    - **AI Auto-Extraction Indicator**: Displays `QT-AUTO-01` badge when OpenAI GPT-4o automatically parsed an incoming quotation. Subsequent negotiation emails bypass AI (**0 API cost**).
    - **Interactive Inline Email Composer (Gmail/Figma-Style)**:
      - Embedded directly at the bottom of the Email timeline.
      - **"To:" Recipient Field**: Quick dropdown of suppliers or free-text comma-separated email entry.
      - **"Subject:" Field**: Auto-prefilled with context tag `Re: [#ConsignmentCode] ProductName (#SKU) - Inquiry Follow-up`.
      - **"Message Body" Textarea**: Clean, spacious multiline composer for typing replies/messages.
      - **"📎 Attach File"**: Supabase Storage file/PDF uploader.
      - **Action Toolbar**: Primary blue **`✈️ Send Email`** button with async SMTP dispatch + Discard button.
    - **Live Dynamic Polling & WebSocket Sync**: Automatically refreshes feed every 2.5 seconds.
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
- [ ] Drill down to Layer 2 and Layer 3, click `Dispatch Bulk RFQs`, select 2 suppliers, dispatch. Verify RFQ records are generated with public tokens.
- [ ] Switch to the **Emails** tab in Layer 3, verify the timeline displays historical RFQs and replies.
- [ ] In the **Inline Email Composer** at the bottom of the Emails tab, select a supplier from the dropdown, type a message body, and click `✈️ Send Email`. Verify the email is dispatched via SMTP and instantly appears in the conversation thread with the `Outbound Email ↗` badge.
- [ ] Open Public Quote Portal (`/quote/:token`) for a supplier, submit unit price `¥4500` with PDF quote sheet upload.
- [ ] Return to Layer 3 Items view, verify Received Quotes badge updates to `1 Quote`.
- [ ] Open Quotation Matrix Comparison modal, verify Lowest Price is highlighted in green, click `Approve Quote`, verify status turns to `Approved`.
- [ ] Click Tally Status toggle badge on a line item, verify it toggles between `Pending Tally` and `Tally Posted` instantly.

---

## 14. PLANNING: Master Shipment Planning Grid Module

- **Route:** `/planning`
- **Purpose:** Interactive spreadsheet-like shipment planning workbook for branch logistics, dynamic column configuration, container CBM optimization, and audit logging.

### 14.1. Workbook Features & Sheet Architecture
1. **Branch Sheet Tabs:**
   - Multi-tab navigation across enterprise branches (e.g. `Mum Branch`, `MP Branch`, `GJ Branch`, `CN Central`).
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
  - Users created or updated in `ERP_Main` with access to Inhyma are provisioned via `POST /api/v1/internal/users/sync`.
  - Unchecking Inhyma access in `ERP_Main` soft-deletes the local user record (`is_active=False`, `deleted_at=now()`) and revokes all active sessions.
- **Bi-Directional Password Synchronization:**
  - Password changes initiated in Inhyma (`POST /users/{id}/reset-password` or `/auth/change-password`) asynchronously push the updated Argon2id hash to `ERP_Main` (`POST /api/v1/auth/internal/sync-password`), which then fans out to peer spokes (e.g. Yinglima).
  - Outbound calls fail silently if `ERP_Main` is unreachable, with the Durable Access Sync Engine handling queued synchronizations.
- **Global Sign-Out Everywhere Fanout:**
  - When `ERP_Main` issues a global signout fanout, Inhyma receives `POST /api/v1/auth/internal/revoke-user-tokens`.
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
- [ ] **Cross-ERP Sign-Out Everywhere**: When sign-out everywhere is triggered from `ERP_Main`, verify Inhyma's `POST /api/v1/auth/internal/revoke-user-tokens` receives the call, matches the user via multi-identifier resolution, revokes tokens, and logs the user out.
- [ ] **Bi-Directional Password Sync**: Change a user's password locally in Inhyma. Verify that `ERP_Main` receives the update via `POST /api/v1/auth/internal/sync-password` and propagates it to Yinglima without errors.
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
  - Grouped by module cards: `Dashboard`, `Contact`, `Inventory`, `Sale`, `Planning`, `User Management`, `Configurations`, `Audit`, `Trash`.
  - `Select All` / `Deselect All` toggles per module.
  - Checkboxes for granular permissions (`.view`, `.create`, `.update`, `.delete`, `.export`, `.import`, `.bulk_action`, etc.).
- **Clone Department Button:** Creates a copy of the department with all permissions pre-checked.
- **Safe Delete with Reassignment Modal:** If users exist in a department scheduled for deletion, prompts administrator to select a replacement department to reassign those employees before deletion proceeds.

### 16.3. Test Cases for Departments & Permissions Module
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

---

## 17. CONFIGURATIONS: HSN Codes Master Module

- **Route:** `/masters/hsn`
- **Table Columns:** SR. NO., HSN / SAC Code, Description, GST/VAT Rate (%), Refund VAT Rate (%), Status, Actions.
- **Add / Edit Form Fields:**
  - **HSN / SAC Code** (*Required*): 6 to 8 digit customs tariff code.
  - **Description**: Trade description.
  - **GST / VAT Rate (%)**: Standard domestic rate.
  - **Refund VAT Rate (%)**: Export tax rebate percentage.
  - **Status**: `Active` / `Inactive`.

---

## 18. CONFIGURATIONS: Geography Masters (Countries, Provinces, Cities)

### 18.1. Countries (`/masters/countries`)
- **Fields:** Country Name (*Required*), ISO Code 2 (e.g. `CN`, `IN`, `US`), ISO Code 3, International Phone Dial Code (e.g. `+86`, `+91`), Currency Code, Status.

### 18.2. Provinces / States (`/masters/states`)
- **Fields:** Country (*Required dropdown*), State / Province Name (*Required*), State Code, Status.

### 18.3. Cities (`/masters/cities`)
- **Fields:** Country (*Required*), State / Province (*Required, scoped to Country*), City Name (*Required*), City Code, Status.

---

## 19. CONFIGURATIONS: Currencies Master Module

- **Route:** `/masters/currencies`
- **Fields:** Currency Code (*Required*, e.g. `USD`, `CNY`, `INR`, `EUR`), Currency Name, Currency Symbol (e.g. `$`, `¥`, `₹`, `€`), Exchange Rate to Base Currency, Is Base Currency (`true`/`false`), Status.

---

## 20. CONFIGURATIONS: Units of Measurement (UOM) Master Module

- **Route:** `/masters/uom`
- **Fields:** UOM Name (*Required*, e.g. Pieces, Sets, Kilograms, Meters, Rolls, Boxes), UOM Code (e.g. `PCS`, `SET`, `KG`), Symbol, Unit Category, Status.

---

## 21. CONFIGURATIONS: ERP Settings & Company List

### 21.1. ERP Settings (`/organization`)
- **Single-Tenant Corporate Profile Fields:**
  - Company Legal Name, Trade Name, Official Email, Phone, Website.
  - **Company Logo Upload (`logo_data` / `logo_url`):** Supports PNG/JPEG base64 and Supabase cloud URL storage.
  - Tax Registration Number (GST / PAN / VAT / TIN).
  - Operating Timezone, Base Currency, Business Hours.
  - Registered Head Office Address, City, State, Country, Postal Code.
- **Actions:** `Edit Organization`, `Save Changes`, `Cancel`.
- **Real-Time Dynamic Sidebar Branding:**
  - Automatically pushes uploaded company logo and brand name across the entire application shell via `resolveBrandInfo()` and `subscribeBrandLogo()`.
  - AppShell sidebar header immediately extracts the organization logo (`resolveImageUrl(brandLogo)`) with fallback to `/logo.png`.
  - Multiple browser tabs receive real-time updates via local event subscription without requiring page refresh.


### 21.2. Organization List (`/masters/company-list`)
- Multi-company entity catalog for group enterprises.
- **Fields:** Company Name, Legal Entity Type, Registration Number, Base Currency, Status.

---

## 22. GOVERNANCE: Audit Log Module

- **Route:** `/audit`
- **Purpose:** Immutable compliance trail capturing all entity mutations across the ERP.
- **Header Presentation:** Minimalist, uncluttered corporate header (`.page-header`) with redundant subtitle description removed. Action controls wrapped in `.page-header-actions` conforming strictly to the global 35px height, 6px radius standard.
- **Table Columns:** Timestamp (UTC & Local), Actor (User Name & ID), Action Type (`CREATE`, `UPDATE`, `DELETE`, `LOGIN`, `PASSWORD_RESET`, `BULK_ACTION`), Target Entity (`Supplier`, `Product`, `Inquiry`, `User`), Entity ID, IP Address, HTTP Status Code.
- **JSON Delta Viewer Modal:** Click row opens side-by-side before-and-after JSON diff highlighting altered fields.
- **Filters:** Action type dropdown, Entity type, User picker, Date range.

---

## 23. GOVERNANCE: Trash & Recovery (Recycle Bin) Module

- **Route:** `/trash`
- **Purpose:** Universal soft-delete registry allowing one-click data restoration.
- **Header Presentation:** Clean, high-density header with redundant explanatory subtitle removed. Action buttons (`Restore Selected`, `Empty Trash`) encapsulated in `.page-header-actions` adhering to the universal 35px height, 6px border-radius, and 10px button gap standards.
- **Table Columns:** Checkbox, Entity Type (e.g. `Supplier`, `Buyer`, `Product`, `Inquiry`), Record Name / Title, Deleted At Timestamp, Deleted By User, Actions.
- **Header Actions:** Module Filter dropdown (`ALL`, `Suppliers`, `Buyers`, `Products`, etc.), Search query.
- **Row Actions:**
  - 🔄 **`Restore` Button:** Restores deleted record back to its active table with relational integrity preserved.
  - ❌ **`Purge` Button:** Permanently deletes record from database (restricted to Super Administrator).
- **Bulk Actions:** `Restore Selected`, `Empty Trash`.

---

## 24. USER ACCOUNT: Profile, Security & Active Sessions

- **Route:** `/profile`
- **Section 1: Personal Details:** First Name, Last Name, Email, Contact Number, `Save Profile` button.
- **Section 2: Security & Password:** Current Password, New Password, Confirm Password, show/hide eye icons, `Update Password` button.
- **Section 3: Active Device Sessions:** List of active browser sessions (Browser, OS, IP Address, Device Category, Last Active). Action: `Revoke Session` button.

---

## 25. AUTHENTICATION: Login & Session Recovery

- **Route:** `/login` (`frontend/src/pages/Login.tsx`)
- **Form Fields:** Username, Email or Mobile Number (*Required*), Password (*Required*, with show/hide eye toggle), "Remember Me" checkbox, `Sign In` button.
- **Security & Reliability Logic:**
  - Rate-limiting protection on failed attempts; automated single-flight token refresh upon access token expiration (`/auth/refresh`).
  - **Bounded Login Timeout & Reachability Guard:** `POST /auth/login` uses a `15s` `AbortController` timeout (paired with a `30s` Vite `/api` proxy timeout in `vite.config.ts`). If the local `Inhyma_ERP` backend (port `8002`) is unreachable or returns `5xx`, `LoginPage` surfaces the error banner directly on `/login` instead of redirecting into `/dashboard?sso_handover=...`.
  - **Autofill-Safe Session Notice Preservation:** Incoming `ihm_login_notice` messages from `sessionStorage` are protected from immediate browser password-manager autofill `onChange` events for `1000ms` after mount so SSO/session failure banners remain visible.
- **Deactivated Account Immunity & Permanent Deletion Retirement:** User deletion is completely disabled across the system. Deactivated accounts (`is_active=False`, `status=INACTIVE`) cannot log in under any circumstances. Submitting credentials for a deactivated user fails immediately with `403 Forbidden` / `401 Unauthorized`, preventing authentication. Any existing active JWT access tokens are immediately rejected on API calls, and clicking `Force Logout` instantly expels active sessions via real-time WebSocket termination and token invalidation.

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

## 32. WORK MANAGEMENT: Tasks Module (Integrated ERP Architecture)

### 32.1. Module Overview & Navigation
- **Sidebar Section:** `WORK MANAGEMENT`
- **Navigation Label:** `Tasks` (`/tasks` — Active Key: `tasks` — Icon: `checkSquare`)
- **Single Navigation Rule:** Retains only ONE sidebar navigation entry (`Tasks`). Legacy/direct sub-routes (`/tasks/my`, `/tasks/kanban`, `/tasks/calendar`) automatically redirect to `/tasks?tab=...` preventing bookmark breakages.
- **Architectural Rules:**
  - Standard ERP page pattern strictly matching `Users.tsx` layout and aesthetics.
  - Reuses existing Users, Roles (Departments), RBAC engine, Bell Notifications, WebSocket manager, Audit Log, and Soft-delete patterns.

### 32.2. Page Layout & Standard Controls (Matches `Users.tsx`)

#### 1. Page Header & Actions
- **Breadcrumb:** `Dashboard / Work Management / Tasks`
- **Page Title & Subtitle:** `Tasks — Manage team tasks, assignments, subtasks, and track project deadlines.`
- **Header Actions:**
  - `+ New Task` primary action button (opens `CreateTaskModal`).
- **Permission Scope Banner & Segmented View Switcher:**
  - Segmented control beside permission status dynamically tailored to authenticated role:
    - `Super Administrator`: Can switch between `👤 My Tasks`, `🏛️ Department View`, and `🏢 Organization View`.
    - `Director`: Can switch between `👤 My Tasks`, `🏛️ Department View`, and `🏢 Organization View` (if permitted).
    - `Department Manager`: Can switch between `👤 My Tasks` and `🏛️ Department View`.
    - `Employee / Standard User`: Scoped to `👤 My Tasks`.
  - **Permission Scope Banner:** Displays Role badge (`roleDisplayName`), Access scope breakdown (`accessScopeDisplayName`), and current view scope.
  - **Department Switcher Dropdown (`Department: [Frontend ▼]`):** Embedded in Department View allowing authorized managers to toggle between departments immediately.
  - **Organization View Accordions:** Displays enterprise-wide grouped overview with collapsible accordion cards per department, showing task counts (`Frontend (12)`), department color badges, and `▼ Expand All` / `▶ Collapse All` actions.
- **Quick Views Bar:**
  - Fast single-click filter pills:
    - `All`: Resets all quick filters.
    - `⚠️ Overdue`: Filters tasks with due date prior to today that are incomplete.
    - `📅 Due Today`: Filters tasks whose due date equals today.
    - `📆 Due This Week`: Filters tasks whose due date falls within current week.
    - Saved filter chips with deletion action.
- **Unified Toolbar & Filter Bar:**
  - **Search Input:** `Search tasks by title, description, or id...` (real-time debounced query).
  - **Department Filter:** Universal department selector.
  - **Status Filter Dropdown:** `All Statuses`, `To Do`, `In Progress`, `On Hold`, `Completed`.
  - **Issue Type Filter Dropdown:** `All Issue Types`, `TASK`, `BUG`, `IMPROVEMENT`, `STORY`, `EPIC`.
  - **Priority Filter Dropdown:** `All Priorities`, `Low`, `Medium`, `High`, `Critical`.
  - **Labels Filter Dropdown:** Color-coded label multi-select.
  - **Assignee Filter Dropdown:** Filter by any team member.
  - **Due Date Picker:** Date-based deadline filtering.
  - **Reset Button:** Clears all active filters.
- **Floating Bulk Action Bar (`BulkActionBar.tsx`):**
  - Renders dynamically at bottom-center when one or more tasks are checked via row checkboxes.
  - **Selected Counter:** `X tasks selected`.
  - **Bulk Status Selector:** Instantly update status (`TODO`, `IN_PROGRESS`, `ON_HOLD`, `DONE`) across all selected tasks.
  - **Bulk Priority Selector:** Instantly update priority (`LOW`, `MEDIUM`, `HIGH`, `CRITICAL`).
  - **Bulk Delete Action:** Prompts confirmation dialog and batch soft-deletes selected tasks.
  - **Deselect All Button (`✕`):** Clears multi-selection.

#### 2. Primary Navigation Tabs (7 Primary Views)
1. **My Tasks Tab (`tab=my`):**
   - Accessible to all authenticated users.
   - Shows tasks where the current logged-in user is an Assignee or Owner/Creator.
   - Dedicated Empty State: "You're all caught up. No tasks assigned to you with the current filters." + `+ New Task` button.
2. **Department Tab (`tab=department`):**
   - Accessible to users with `task.department_view` or `task.organization_view`.
   - Displays tasks belonging to the selected department via `Department: [Frontend ▼]` dropdown (for Super Admin and Director).
   - Dedicated Empty State: "No tasks in this department. Try changing filters or create a new task." + `+ New Task` button.
   - Clean tabular display with 10 reordered columns, colored Department badges, progress bars, quick actions, and pagination.
3. **Organization Tab (`tab=organization`):**
   - Accessible to users with `task.organization_view` or super-admin role.
   - Grouped by department into collapsible accordion cards showing department badge, name, task count `(${deptTasks.length})`, and quick Expand/Collapse all buttons.
   - Dedicated Empty State: "No organization tasks match these filters." + `+ New Task` button.
4. **Backlog Tab (`tab=backlog`):**
   - Repository of work items pending sprint or scheduling assignment (`sprint_id IS NULL`).
5. **Kanban Tab (`tab=kanban`):**
   - Interactive 4-column drag-and-drop workflow board (`To Do`, `In Progress`, `On Hold`, `Completed`).
   - Cards display issue type badge, priority badge, **colored Department badge**, overdue tag, title, hold badge (if on hold), subtask progress meter, due date, and assignee avatars.
6. **Calendar Tab (`tab=calendar`):**
   - Monthly calendar grid mapping tasks to start/due deadlines and hold expiration dates with status-colored pills.
7. **Gantt Tab (`tab=gantt`):**
   - Interactive SVG horizontal timeline chart (`TaskGanttView.tsx`) with department color-coding in Organization scope.

#### 3. Standard Table View (Reordered 10 Columns)
- **Columns:**
  1. `SELECT`: Row selection checkbox for bulk operations.
  2. `TYPE`: Color-coded issue type badge (`TASK` blue, `BUG` red, `IMPROVEMENT` emerald, `STORY` purple, `EPIC` amber).
  3. `TASK`: Code/Key, Title, description snippet, parent Epic badge (if linked), and label chips. Clicking opens `TaskDrawer`.
  4. `PRIORITY`: Color-coded priority badge (`LOW`, `MEDIUM`, `HIGH`, `CRITICAL`).
  5. `STATUS`: Color-coded status badge (`TODO`, `IN_PROGRESS`, `⏸️ On Hold`, `DONE`). If on hold, displays `hold_reason` and `hold_until`.
  6. `ASSIGNEE`: Stacked avatar chips displaying user initials (Watchers managed cleanly inside `TaskDrawer`).
  7. `DEPARTMENT`: Color-coded department badge (`<DepartmentBadge />`) resolving assignees or task creator's department.
  8. `DUE DATE`: Deadline date with red `OVERDUE` highlight if past deadline.
  9. `PROGRESS`: Progress counter badge (`X/Y Done`) with visual progress bar.
  10. `ACTIONS`:
      - `+Me`: Instant one-click self-assign.
      - `✓`: One-click status toggle between `TODO` and `DONE`.
      - `📄`: Instant clone / duplicate task.
      - `👁️`: Open TaskDrawer details.
      - `⚡`: Instant escalation modal.
      - `🗑️`: Delete task with confirmation dialog.
- **Pagination Controls:** "Showing X to Y of Z tasks", page size selector, Previous / Next page navigation.

### 32.3. Modal & Drawer Specifications

#### 1. Universal Searchable Autocomplete Picker (`SearchableUserSelect.tsx`)
- **Behavior:**
  - Real-time instant filtering as user types full name, username, or department.
  - Auto-closes immediately upon selecting a candidate.
  - Displays selected items as removable chips: `[ (Avatar) Full Name (Department) ✕ ]`.
  - Supports full keyboard navigation (`ArrowDown`, `ArrowUp`, `Enter`, `Escape`).
  - Universally utilized across: Task Assignees, Watchers, Subtask Assignees, Escalation Recipients, and Department Filters.

#### 2. Create Task Modal (`CreateTaskModal.tsx`)
- **Fields:**
  - `Template Selector`: Reusable template dropdown (`Bug Report`, `Feature Story`, `Production Release`, `Standard Task`) prefilling fields, subtasks, and labels.
  - `Issue Type`: Selectable badge selector (`TASK`, `BUG`, `IMPROVEMENT`, `STORY`, `EPIC`).
  - `Parent Epic`: Dropdown to associate task with an existing Epic (hidden when Issue Type is `EPIC`).
  - `Sprint`: Dropdown assigning task to Backlog or an Active/Planned sprint.
  - `Title` (*Required*, max 255 characters).
  - `Description` (multi-line textarea with `@user` mention support).
  - `Priority` dropdown: `LOW`, `MEDIUM`, `HIGH`, `CRITICAL` (default: `MEDIUM`).
  - **Enforced Status:** Defaults strictly to `TODO` with no status dropdown during task creation.
  - `Start Date` (date picker).
  - `Due Date` (date picker).
  - `Assignees Selector`: `SearchableUserSelect` autocomplete with removable chips.
  - `Watchers Selector`: `SearchableUserSelect` autocomplete with removable chips.
  - `Labels Selector`: Color-coded label multi-select with inline "+ New Label" popover (name and hex color picker).
  - `File Attachments & Paste Area`: Native file uploader with drag-and-drop support and `Ctrl+V` screenshot paste from clipboard.
  - `Mini-Task Subtasks Builder`:
    - "+ Add Subtask" button adding unlimited mini-tasks before submission.
    - Each mini-task card includes:
      - `Title` (*Required*).
      - `Description` (optional).
      - `Priority` (`LOW`, `MEDIUM`, `HIGH`, `CRITICAL`).
      - `Status` (`TODO`, `IN_PROGRESS`, `DONE`).
      - `Start Date` and `Due Date` (date pickers).
      - `Assignees`: `SearchableUserSelect` multi-select autocomplete picker.
      - Remove subtask button (`🗑️`).
  - **Initial Escalation Section (Optional):**
    - Toggle checkbox: "⚡ Escalate this task immediately upon creation".
    - When enabled, displays:
      - Escalation Target Category: `Reporting Manager`, `Department Manager`, or `Organization User`.
      - Target User Selector: `SearchableUserSelect` autocomplete populated according to category.
      - Escalation Reason (*Required* textarea).
      - Escalation Due Date (optional deadline date picker).
- **Actions:** "Cancel" button, "Create Task" primary button with spinner loading state.

#### 3. Task Detail Drawer (`TaskDrawer.tsx` — 6 Tabs)
- **Slide-out full-height drawer:**
  - **Header:** Issue Type badge, Epic badge (if linked), Status badge (`TODO`, `IN_PROGRESS`, `⏸️ ON HOLD`, `DONE`), Priority badge, Overdue indicator, inline editable Title, `⚡ Escalate` button, and Close button (`✕`).
  - **Emoji Reaction Bar (`ReactionPicker.tsx`):**
    - Displays active reactions (`👍`, `❤️`, `🎉`, `🚀`, `👀`, `👎`) with counter chips.
    - Quick "+ Add Reaction" picker allowing any team member to react.
  - **Epic Progress Rollup Banner (for `EPIC` Issue Type):**
    - Visual progress bar calculated dynamically from child tasks: `progress_percent = (completed_children / total_children) * 100`.
  - **On Hold Modal & Controls:**
    - When status is changed to `ON_HOLD` or "⏸️ Put On Hold" is clicked, an interactive modal requests:
      - `Hold Reason` (*Required* textarea).
      - `Hold Until Date` (optional calendar date picker).
    - Details tab displays a prominent amber On Hold banner with `▶️ Resume Task` and `✏️ Edit Hold` action buttons.
  - **Six Drawer Tabs:**
    1. **Overview Tab:**
       - Issue type badge and Parent Epic linking selector.
       - Sprint assignment dropdown (move between sprints or send to backlog).
       - Color-coded label chips with quick add/remove.
       - Status selector (`TODO`, `IN_PROGRESS`, `ON_HOLD`, `DONE`) and Priority selector with instant persistence.
       - Start Date and Due Date date pickers.
       - Assignees section: Avatar chips with `✕` remove button, and `+ Add Assignee` searchable autocomplete dropdown.
       - Watchers section: Avatar chips with `✕` remove button, and `+ Add Watcher` searchable autocomplete dropdown.
       - Inline editable Description with Save / Cancel controls and `@user` mention support.
       - **Task Attachments Section:** Displays count badge, drag-and-drop zone, `Ctrl+V` screenshot paste support, `+ Add Files` multi-file picker, `AttachmentList` component rendering file format icons (PDF, Image, XLS, DOC, ZIP, Video), formatted file size (KB/MB), clickable download/view links, and delete action for task creator/managers.
       - **Task Voice Notes Section:** Displays count badge, `🎤 Record Voice Note` toggle button launching `VoiceNoteRecorder` with native HTML5 waveform and timer, and cards for existing recordings with HTML5 `<audio controls>` player, uploader attribution, and timestamp.
       - Metadata card: Creator name, creation timestamp, and last updated timestamp.
    2. **Mini-Tasks Tab:**
       - Progress summary (`X of Y mini-tasks completed`).
       - Mini-task cards with check-off checkbox, title, description, priority badge, status badge, start/due dates, assignee chips, and delete button.
       - "+ Add Mini-Task" expandable builder with title, description, priority, dates, and `SearchableUserSelect` assignees.
       - **Stage-Level Independent Subtask Collaboration:** Under each mini-task card, an expandable discussion toggle (`💬 Subtask Collaboration (X comments, Y files)`) reveals independent subtask comments with author/time, subtask attachment list, and inline `CommentComposer` for posting notes or attaching files directly to that specific mini-task.
    3. **Dependencies Tab (Task Linking):**
       - List of linked dependencies classified by relation type:
         - `⛔ Blocks`: Tasks that cannot proceed until this task finishes.
         - `⚠️ Blocked By`: Tasks that prevent this task from progressing.
         - `🔗 Relates To`: Related reference tasks.
       - Blocker warning indicator if any prerequisites remain incomplete.
       - "+ Link Task" form with dependency relation selector and searchable task autocomplete.
       - Server-side dependency cycle detection preventing circular blocker chains (`A -> B -> A`).
    4. **Escalations Tab:**
       - **Unlimited Escalation Chain:** Full chronological record of all past escalations on this task (never overwritten).
       - **Persistent Action:** Header features a persistent `⚡ + New Escalation` button allowing users to initiate subsequent escalations at any stage.
       - **Escalation Cards:** Each card displays: Escalation Index (`#1`, `#2`, etc.), Escalation Type badge (`REPORTING_MANAGER`, `DEPARTMENT_MANAGER`, `ORGANIZATION_USER`), Escalated By user, Escalated To user, Escalation Timestamp, Target Due Date, and Explanation Reason.
       - **Stage-Level Escalation Discussion:** Under each escalation card, an independent discussion section (`💬 Escalation Discussion (X)`) allows users to exchange resolution notes and track manager responses directly within that specific escalation thread.
    5. **Comments Tab:**
       - Standardized `CommentComposer` component with auto-expanding textarea, `@user` mention suggestions dropdown, `📎 Attach Files` multi-selector with removable chip tags, and `🎤 Record Voice Note` inline microphone recorder.
       - Chronological message stream rendering avatar initials, author name, timestamp, message body, interactive `<audio controls>` voice note player (when audio is attached), `AttachmentList` file cards, and emoji reactions bar (`ReactionPicker`).
    6. **Activity Timeline Tab:**
       - Vertical timeline synthesized dynamically via `GET /api/v1/tasks/{id}/timeline`.
       - Chronological events: `TASK_CREATED`, `USER_ASSIGNED`, `SUBTASK_CREATED`, `SUBTASK_COMPLETED`, `TASK_ESCALATED`, `DEPENDENCY_ADDED`, `SPRINT_CHANGED`, `COMMENT_ADDED`, `ATTACHMENT_ADDED`, `VOICE_NOTE_ADDED`.

#### 4. Escalate Task Modal (`EscalateTaskModal.tsx`)
- **Escalation Target Category Selection:** `Reporting Manager`, `Department Manager`, or `Organization User`.
- **Target User Picker:** `SearchableUserSelect` autocomplete with instant search filtering.
- **Reason Field:** Multi-line textarea (*Required*) explaining the escalation reason.
- **Target Due Date:** Optional date picker specifying an urgent turnaround deadline.
- **Actions:** "Cancel" button, "⚡ Escalate Task" warning button.

#### 5. Live Categorized Notification Bell (`AppShell.tsx`)
- **Topbar Bell Icon & Badge:**
  - Dynamic red unread pill badge (`99+` ceiling) visible on topbar.
  - Live WebSocket listener updating instantly on `NOTIFICATION_RECEIVED`, `TASK_ASSIGNED`, `TASK_ESCALATED`, `TASK_MENTION`, `TASK_HOLD_EXPIRED`, `TASK_ATTACHMENT_ADDED`, `TASK_VOICE_NOTE_ADDED`, and status transitions.
- **Category Filter Tabs:**
  - `All (count)`: Comprehensive stream of all in-app notifications.
  - `⏰ Deadlines (count)`: Strictly filters approaching deadlines (`⏰ DUE SOON`), due today (`📅 DUE TODAY`), and overdue alerts (`⚠️ OVERDUE`) for tasks assigned to the user or created by them.
  - `⚡ Escalations (count)`: Strictly filters escalation alerts where the user is the designated assignee (`to_user`) or recipient of escalation thread replies (`⚡ ESCALATION`).
  - `👤 Team (count)`: Filters assignment notices (`👤 ASSIGNED`), subtasks, completions (`✓ DONE`), on-hold alerts (`⏸️ ON HOLD`), and mentions (`💬 MENTION`).
- **Interactive Notification Cards:**
  - Unread blue indicator dot for unread items.
  - Color-coded category badge chip: `⚠️ OVERDUE` (red), `📅 DUE TODAY` (amber), `⏰ DUE SOON` (yellow), `⚡ ESCALATION` (rose), `💬 MENTION` (purple), `👤 ASSIGNED` (blue), `✓ DONE` (emerald), `⏸️ ON HOLD` (orange).
  - Relative timestamp (`just now`, `5m ago`, `2h ago`, `yesterday`).
  - One-click direct deep-linking: Clicking any notification marks it as read and navigates to the task, immediately opening the `TaskDrawer` (and activating the `escalations` tab if linked with `drawerTab=escalations`).
- **Action Toolbar:**
  - `🔄 Sync / Check Deadlines`: Triggers `POST /api/v1/tasks/check-deadlines` to recheck upcoming and overdue deadlines for the current user and their assigned escalations.
  - `Mark all read`: Marks all in-app notifications as read via `POST /api/v1/notifications/read-all`.
  - Empty state displays contextual icons and advice per category (`⏰`, `⚡`, `👥`, `🔔`).

### 32.4. Test Checklist & Acceptance Criteria
1. **Autocomplete Search & Close:** In Create Task modal, type an employee's name into Assignees -> list filters instantly; clicking employee closes dropdown immediately and renders removable chip `[ Name (Dept) ✕ ]`.
2. **Creation with Default Status:** Create task -> status is strictly `TODO` without requiring or permitting a status selection at creation.
3. **Initial Escalation:** In Create Task modal, enable initial escalation, select Reporting Manager with reason and due date -> task is created with status `TODO`, initial escalation record stored, and recipient receives notification.
4. **Task File Attachments:** In Task Drawer Overview tab, click `+ Add Files` -> upload PDF/Image/Word/ZIP -> file appears in AttachmentList with appropriate icon, formatted size, and working view link.
5. **Native Voice Note Recording:** In Task Drawer Overview or CommentComposer, click `🎤 Record Voice Note` -> browser microphone captures audio with waveform animation; upon completion, audio renders in `<audio controls>` player and persists to backend.
6. **Rich Comment Composer:** Post a comment containing both text message and attached file/voice note -> comment renders in timeline with message body, playable audio player, and attachment chips.
7. **Unlimited Escalations & History:** Escalate task multiple times (e.g. Creator -> Rahul -> Sales Manager -> Operations Head) -> complete chronological chain renders in Escalations tab, with a persistent `+ New Escalation` button always available.
8. **Independent Escalation Discussion:** Open an escalation in Escalations tab -> post a comment in its dedicated thread -> discussion renders exclusively under that escalation card.
9. **Independent Subtask Collaboration:** Expand `Subtask Collaboration` under a mini-task -> upload file and post comment -> updates only that mini-task's comments and attachments.
10. **On Hold Workflow:** In Task Drawer, select status `ON_HOLD` -> modal opens requesting `hold_reason` and `hold_until`; upon submitting, amber On Hold banner renders with `▶️ Resume Task` and `✏️ Edit Hold`.
11. **Hold Expiry Background Worker:** Run `POST /api/v1/tasks/check-holds` -> detects tasks whose `hold_until` has passed and generates notification alerts.
12. **Department Filtering & Management:** Switch to Department tab -> select department from dropdown (for Super Admin / Director) -> verifies tasks are filtered strictly by that department in the table.
13. **Permission-Based View Switcher & Scope Banner:** Verify segmented control `[ 👤 My Tasks | 🏛️ Department | 🏢 Organization ]` shows options based on role. In Department view, switching `Department: [Frontend ▼]` filters tasks immediately. In Organization view, tasks group into collapsible department accordions with counts and Expand/Collapse All controls.
14. **Kanban Board with Department Badges:** Verify 4 columns (`To Do`, `In Progress`, `On Hold`, `Completed`). Each task card renders a colored `<DepartmentBadge />` identifying its department. Move task between columns via quick status dropdown or drag-and-drop.
15. **Calendar Deadlines:** In Calendar tab, verify task start date (🟢), due date (🔴), and hold until (⏸️) display on corresponding calendar days.
16. **Subtask Usability:** Add subtasks with `SearchableUserSelect` assignees; toggle completion -> flips status, updates progress bar, and logs timeline event.
17. **Soft-Delete & Audit:** Delete task -> soft-deleted from active views, recorded in audit log under module `tasks`.
18. **Issue Type Badges & Filtering:** Verify tasks render distinct color-coded issue type badges (`TASK`, `BUG`, `IMPROVEMENT`, `STORY`, `EPIC`). Filter by `BUG` -> only bug issues render in the table.
19. **Epic Hierarchy & Progress Rollup:** Create an `EPIC` task. Create child tasks with `parent_task_id` pointing to the Epic. Complete a child task -> Epic's `progress_percent` recalculates automatically.
20. **Color-Coded Labels (Create, Assign, Filter):** Create a new label (e.g. `Frontend` with color `#3B82F6`). Attach label to tasks. Click label filter pill -> only tasks with that label render.
21. **Sprint Lifecycle:** Create a sprint in `PLANNED` status. Start sprint -> flips to `ACTIVE`. Complete sprint -> flips to `COMPLETED` and incomplete tasks route to Backlog or Next Sprint.
22. **Backlog Transition:** View Backlog tab -> items display with `sprint_id = null`.
23. **Task Templates:** Open Create Task Modal -> select `Bug Report` template -> Title, Description markdown structure, Priority `HIGH`, and default labels prefill automatically.
24. **Row Quick Actions:** On standard table view:
    - Click `+Me` -> logged-in user is added to assignees.
    - Click `✓` -> flips status to `DONE` (or `TODO` if already done).
    - Click `📄` -> clones task with prefix `[Copy]`.
    - Click `👁️` -> opens TaskDrawer.
    - Click `⚡` -> opens instant escalation modal.
    - Click `🗑️` -> opens soft-delete confirmation.
25. **Floating Bulk Action Bar:** Select multiple task checkboxes -> floating `<BulkActionBar>` appears. Change status to `DONE` -> all selected tasks update atomically. Change priority to `CRITICAL` -> all selected tasks update.
26. **Dependency Linking & Blocker Detection:** In Task Drawer Dependencies tab, link Task A as `BLOCKS` Task B. Task B displays `BLOCKED` indicator until Task A is marked `DONE`.
27. **Circular Dependency Prevention:** Attempt to link Task B as `BLOCKS` Task A when Task A already blocks Task B -> server rejects with HTTP 400 Bad Request and error message `Dependency cycle detected`.
28. **Streamlined ERP Task Flow:** Tasks transition seamlessly across `TODO`, `IN_PROGRESS`, `ON_HOLD`, and `DONE` without cumbersome approval queues.
29. **Interactive Gantt Timeline View:** Switch to `Gantt` tab -> tasks render as horizontal SVG timeline bars color-coded by department in Organization scope.
30. **Department Task Switcher & Isolation:** In Department view, select different departments from the dropdown -> verify the table updates immediately to show only tasks belonging to the selected department.
31. **At-Mentions & Notifications:** Post a comment or task description containing `@username` -> mentioned user receives topbar bell notification and WebSocket message of type `TASK_MENTION`.
32. **Emoji Reactions on Tasks & Comments:** Click emoji picker on task header or comment card -> select `🚀` -> reaction count increments to 1; clicking again decrements/removes reaction.
33. **Drag-and-Drop & Clipboard Paste Attachments:** In Task Drawer or Create Task modal, paste a screenshot using `Ctrl+V` -> image file is captured from clipboard and uploaded as an attachment automatically.
34. **Quick Views Bar:** Click `⚠️ Overdue` -> filters overdue tasks. Click `📅 Due Today` and `📆 Due This Week` -> filters by today and current week. Click `All` -> restores full view.
35. **Universal Search Integration:** In topbar search bar, type a task keyword -> tasks matching title, description, or labels appear in search dropdown under `Tasks` category and deep-link directly to `/tasks?tab=my&taskId={id}`.
36. **Modal Lifecycle & Framework Dismissal:** Open `CreateTaskModal`:
    - Click `✕` button -> modal completely unmounts, backdrop blur disappears, and body scroll is restored.
    - Re-open and click `Cancel` button -> modal completely unmounts.
    - Re-open and press `Escape` key -> modal completely unmounts.
    - Re-open and click the semi-transparent backdrop outside the modal card -> modal completely unmounts.
    - Verify that after closing, no transparent overlay blocks user clicks on any page elements.
37. **Date Boundary Integrity & Validation:**
    - In `CreateTaskModal`, enter Start Date `2026-09-10` and Due Date `2026-09-05` -> click `Create Task` -> client blocks submission with error `Due date cannot be earlier than start date.`
    - Direct API `POST /api/v1/tasks` with `due_date < start_date` -> returns HTTP `422 Unprocessable Entity`.
38. **Relational Foreign Key Validation:**
    - Submitting `parent_task_id` or `sprint_id` with a non-existent UUID returns HTTP `422 Unprocessable Entity` with a clear validation message, preventing unhandled 500 database errors.
39. **Interactive Attachment Preview Modal:**
    - In `AttachmentList` (Task Drawer or comments), click on an image, video, audio file, or PDF -> Attachment Preview Modal opens with centered viewport, file metadata, and direct download shortcut.
    - Pressing `Escape`, clicking `✕`, or clicking outside closes the preview cleanly and restores body scrolling.
40. **Task Deadline, Team & Escalation Notifications:**
    - **Self-Scoped Task Deadlines:** Create a task assigned to current user with `due_date` set to today or past due -> click `🔄 Sync` in Notification Bell -> notification appears under `All` and `⏰ Deadlines` with badge `📅 DUE TODAY` or `⚠️ OVERDUE`.
    - **Other Users' Deadlines Not Leaked:** Tasks assigned solely to other users do NOT trigger deadline alerts for the current user.
    - **Targeted Escalation Alerts:** When a task is escalated to the current user -> notification appears under `All` and `⚡ Escalations` with badge `⚡ ESCALATION`. Clicking the notification immediately opens `TaskDrawer` with the `Escalations` tab pre-selected.
    - **Team Mentions & Assignments:** Assigning a task/subtask to a user or mentioning `@username` in a comment produces alerts under `👤 Team` with `👤 ASSIGNED` or `💬 MENTION`.
    - **Deduplication:** Subsequent syncs or page loads within 20 hours do not generate redundant duplicate notifications for the same deadline or escalation.
    - **Tab Switching & Filtering:** Clicking `All`, `⏰ Deadlines`, `⚡ Escalations`, and `👤 Team` accurately filters items and displays badge counts. Empty tabs render friendly empty state illustrations.
41. **Automated Frontend Component & Lifecycle Test Suite (`npm run test`):**
    - `TaskNotificationsAndDrawer.test.tsx` verifies all 8 notification badge classifications (`⚠️ OVERDUE`, `📅 DUE TODAY`, `⏰ DUE SOON`, `⚡ ESCALATION`, `💬 MENTION`, `👤 ASSIGNED`, `✓ DONE`, `⏸️ ON HOLD`), category filtering (`deadlines`, `escalations`, `team`, `all`), `ReactionPicker` active chips & popover toggle, and `EscalateTaskModal` validation & category selectors.
    - `CreateTaskModal.test.tsx` verifies unmount/mount lifecycle, modal dismissal (✕, Cancel, Escape), and date validation rules.
    - `AttachmentList.test.tsx` verifies file rendering, format icons, preview modal launch, and Escape key dismissal.
    - All 23 vitest component tests pass cleanly with 100% assertions.
42. **Aggressive Stress, Speed Benchmarking & Accuracy Suite (`task_stress_and_accuracy_test.py`):**
    - **Burst Concurrency:** 20 simultaneous task creations across parallel async database sessions complete without pool exhaustion or deadlocks (N=20, 100% success rate).
    - **High-Volume Atomic Bulk Updates:** 20 items status/priority updated atomically (latency ~321ms).
    - **Parallel Collaboration Under Load:** 10 parallel comments with `@mentions` committed concurrently at ~8.9 comments/sec without race conditions.
    - **Strict Accuracy Verification:** User scoping isolation (User B receives assignment alert, User C receives 0 leaks), targeted escalations (deep-link directly to `drawerTab=escalations`), 20-hour deduplication window (run 1 generates alerts, run 2 generates 0 duplicate spam), Epic progress rollup math (0/4=0%, 2/4=50%, 4/4=100%), and 3-tier circular blocker cycle prevention (A->B->C->A rejected with HTTP 400).
    - **Speed & Latency Benchmarks:** Profiles min, avg, p50, p95, and max operations latency across task creation, list filtering, detail fetch, timeline synthesis, and notification retrieval.

---

## 33. AI Subagent Autonomous Testing Prompt Template

When instructing an autonomous AI agent to verify the ERP after code modifications, copy and run the following prompt:

```markdown
You are acting as an Autonomous QA Tester for the Enterprise ERP.
Your task is to verify that all modules and features described in MODULES_AND_FEATURES_TEST_MANUAL.md exist and function without regressions.

Checklist to execute:
1. Compile backend: Run `python -m compileall backend/app` -> must return 0 errors.
2. Build frontend: Run `npm run build` in /frontend -> must compile cleanly with 0 TypeScript/Vite errors.
3. Run frontend unit test suite: Run `npm run test` in /frontend -> all 23 vitest tests across CreateTaskModal, AttachmentList, and TaskNotificationsAndDrawer must pass.
4. Run backend unit tests: Run `pytest backend/tests/test_task_deadlines_notifications.py backend/tests/test_tasks_validation.py -v` -> must pass with 0 failures.
5. Run backend empirical test suite: Run `python backend/scripts/empirical_test.py` -> all 37 Enterprise Task V2.0 checks must pass with exit code 0.
6. Run aggressive stress, speed & accuracy suite: Run `python backend/scripts/task_stress_and_accuracy_test.py` -> all burst concurrency, speed profiling, deduplication, and accuracy tests must pass.
7. Verify module routes in frontend/src/App.tsx and frontend/src/lib/nav.ts match the sitemap in Section 2, and all navigation items possess distinct icons.
8. Verify the Work Management module:
   - Sidebar displays single item WORK MANAGEMENT -> Tasks (/tasks).
   - Tasks (/tasks) layout matches Users.tsx (breadcrumbs, title, subtitle, + New Task, filter toolbar, permission scope bar).
   - 7 Navigation Tabs render cleanly: My Tasks, Department (with List/Kanban/Calendar/Analytics), Organization, Backlog, Kanban, Calendar, and Gantt.
   - Universal Searchable Dropdowns (SearchableUserSelect.tsx) filter on keystroke, auto-close on selection, and render removable chips.
   - Issue types render distinct badges: TASK, BUG, IMPROVEMENT, STORY, EPIC.
   - CreateTaskModal supports templates, issue types, parent epic, sprint, color labels, drag-and-drop, clipboard screenshot paste (Ctrl+V), mini-tasks, and initial escalations.
   - TaskDrawer renders 6 tabs: Overview (with Attachments, Voice Notes, and On Hold controls), Mini-Tasks (with independent subtask discussions), Dependencies (with blocker detection and cycle prevention), Escalations (with unlimited history and persistent + New Escalation button), Comments (with rich CommentComposer, @mentions, and emoji reactions), and Activity Timeline.
   - Row Quick Actions (+Me, Complete, Duplicate, Escalate, Delete) and Floating BulkActionBar function seamlessly.
   - Interactive Gantt Timeline (TaskGanttView.tsx) renders live data with department color-coding in Organization scope.
   - Universal search (/api/v1/search?q=) indexes tasks by title, description, and labels.
9. Report any missing fields, broken endpoints, or regressions.
```

---

## 34. CONFIGURATIONS: Company Categories Master Module

- **Route:** `/masters/company-categories`
- **Legacy Redirects:** `/company/category/list`, `/masters-company-categories.html`
- **Required Permission:** `companycategory.view` (Mutations: `companycategory.create`, `companycategory.update`, `companycategory.delete`, `companycategory.export`, `companycategory.import`, `companycategory.bulk_action`)
- **Purpose:** Configurable corporate classifications and tiers (B2B, B2C) for business accounts and client entities.

### Visual Elements & Layout
1. **Breadcrumbs:** `Settings` > `Masters` > `Company Categories`
2. **Page Title:** `Company Categories`
3. **Subtitle:** `Manage corporate tiers, business classifications (B2B/B2C), and company categories.`
4. **Action Buttons:**
   - `+ ADD NEW` (Primary blue button) — Opens the modal drawer to add a new company category.
   - `DELETE` / `Bulk Actions` — Bulk status update and bulk deletion for selected rows.
   - `Import` / `Export` (CSV / XLSX) buttons.
5. **Table Columns:**
   - `Checkbox` — Row select for bulk actions.
   - `Sr. No.` — Sequence index counter.
   - `Name` — Category name (e.g. `Corporate`, `SME`, `Non Traditional`, `Traditional`).
   - `Business Type` — Pill badge indicating `B2B` (blue) or `B2C` (amber).
   - `Status` — Active / Inactive status badge with toggle trigger.
   - `Action` — Quick Edit (pencil icon) and Soft-Delete (trash can icon) action buttons.
6. **Form Fields (Create / Edit Modal):**
   - `Name *` — Required text input (max 100 chars, trimmed, unique).
   - `Business Type *` — Required dropdown selector with options: `B2B`, `B2C`.
   - `Status` — Status dropdown (`Active`, `Inactive`).
   - `Description` — Optional multiline/singleline text notes (max 500 chars).

### Test Cases
- [ ] Verify navigating to `/company/category/list` automatically redirects to `/masters/company-categories`.
- [ ] Verify seeded categories (`Traditional`, `Non Traditional`, `SME`, `Corporate`) render in the list.
- [ ] Verify clicking `+ ADD NEW` opens the creation drawer with `Name`, `Business Type` (default `B2B`), `Status` (default `Active`), and `Description`.
- [ ] Verify duplicate category names are blocked with a clear conflict error.
- [ ] Verify updating category name or business type immediately updates the table without reload.
- [ ] Verify toggling active/inactive status updates the database and cache.
- [ ] Verify row deletion moves category to Trash (`/trash`) with restore capability.
- [ ] Verify multi-select checkboxes allow bulk deletion of selected items.
- [ ] Verify universal topbar search indexes company categories by name and business type.

---

## 35. SETTINGS: Bank Master Module

- **Route:** `/masters/banks`
- **Legacy Redirects:** `/bank/list`, `/masters-bank.html`, `/masters-banks.html`, `/masters/bank`
- **Required Permission:** `bank.view` (Mutations: `bank.create`, `bank.update`, `bank.delete`, `bank.export`, `bank.import`, `bank.bulk_action`)
- **Purpose:** Centralized corporate banking registry tracking account numbers, bank names, account holders, IFSC codes, and branch locations.

### Visual Elements & Layout
1. **Breadcrumbs:** `Settings` > `Masters` > `Bank`
2. **Page Title:** `Bank`
3. **Action Buttons:**
   - `+ ADD NEW` (Primary blue button) — Opens popup modal to add a new bank account.
   - `DELETE` (Green button) — Bulk delete action for selected bank accounts.
4. **Table Columns:**
   - `Checkbox` — Multi-row selection for bulk operations.
   - `Sr. No.` — Row sequence index counter.
   - `Holder Name` — Account holder entity name (e.g. `INHYMA SOLUTIONS LLP (GUJARAT)`).
   - `Bank` — Two-line formatted cell displaying bank name in bold (e.g. `HDFC BANK`) and account number below in secondary monospace font.
   - `Branch` — Bank branch location (e.g. `PARMESHWARI PLAZA MULUND (W)`).
   - `Status` — Active / Inactive status toggle pill.
   - `Action` — Quick Edit (blue pencil icon) and Soft-Delete (red trash can icon) buttons.
5. **Modal Form Fields (Add / Edit Bank):**
   - `Bank Name *` — Required text input (e.g. `HDFC BANK`).
   - `Account Number *` — Required text input, validated for uniqueness (e.g. `50200117491557`).
   - `Account Holder Name *` — Required text input (e.g. `INHYMA SOLUTIONS LLP (GUJARAT)`).
   - `IFSC Code *` — Required text input, auto-capitalized (e.g. `HDFC0000118`).
   - `Branch *` — Required text input (e.g. `PARMESHWARI PLAZA MULUND (W)`).
   - `Status` — Status dropdown (`Active`, `Inactive`).
   - `Submit` — Blue action button submitting the form.

### Test Cases
- [ ] Verify navigating to `/bank/list` automatically redirects to `/masters/banks`.
- [ ] Verify the 3 seeded legacy bank accounts render with correct holder name, multi-line bank/account number, and branch.
- [ ] Verify clicking `+ ADD NEW` opens the popup modal with all 5 required fields.
- [ ] Verify creating a bank account with an existing account number raises a 409 conflict error.
- [ ] Verify editing a bank account updates the record and live table immediately.
- [ ] Verify toggling active/inactive status updates the database.
- [ ] Verify soft-deleting a bank account moves it to Trash (`/trash`) with restore support.
- [ ] Verify bulk delete operates correctly on selected checkboxes.
- [ ] Verify export downloads CSV/XLSX with all bank fields.

---

## 36. CONTACT: Companies Module

- **Route:** `/companies`
- **Add Company Route:** `/companies/add`
- **Legacy Redirects:** `/user/addEdit`, `/user/addedit`
- **Required Permission:** `company.view` (Mutations: `company.create`, `company.update`, `company.delete`, `company.import`, `company.export`)
- **Purpose:** Comprehensive B2B corporate customer and supplier directory tracking legal identities, commercial credit lines, multi-tier potential ratings, multi-contact directories, and dispatch addresses.

### Visual Elements & Layout
1. **Breadcrumbs:** `Contact` > `Companies`
2. **Page Title:** `Companies`
3. **Subtitle:** `Manage corporate business accounts, credit terms, multi-contact directories, and client potential ratings.`
4. **Action Buttons:**
   - `+ ADD NEW` (Primary blue button) — Opens company creation drawer or navigates to `/companies/add`.
   - `Imp / Exp` Dropdown — Amber action dropdown (`ImpExpDropdown`) with professional SVG icon badges for `SAMPLE FILE` (slate document template icon), `IMPORT` (blue upload icon), and `EXPORT` (emerald download icon).
   - `Bulk Actions` — Bulk status activation, deactivation, and soft-deletion for selected companies.
5. **Filter Toolbar:**
   - Real-time search bar querying legal name, trade name, GSTIN, PAN, and contact persons.
   - Grade filter dropdown (`All`, `Grade A`, `Grade B`, `Grade C`, `Grade D`).
   - Potential filter dropdown (`All`, `High`, `Medium`, `Low`).
   - Status toggle (`All`, `Active`, `Inactive`).
6. **Master Companies Table:**
   - `Checkbox` — Multi-row selection for mass actions.
   - `Sr. No.` — Sequence index counter.
   - `Company Name` — Displays legal business name with trade name subtitle.
   - `Primary Contact` — Primary contact person name, designation, and phone.
   - `Email & Phone` — Clickable mailto and tel links with country dialing codes.
   - `City & State` — Geographical billing location.
   - `Grade` — Interactive inline grade selector badge with instant PATCH mutation.
   - `Potential` — Interactive inline potential selector badge with instant PATCH mutation.
   - `Status` — Active / Inactive status toggle pill.
   - `Action` — Quick Edit (pencil icon), Contacts Drawer (users icon), and Soft-Delete (trash can icon).
7. **Multi-Tab Company Drawer / Add Page:**
   - `Overview Tab`: Legal name, trade name, business classification, company category, company sector, GSTIN, PAN, TAN, IEC, GST registration date, age of company, product manufacture or supply, machines buying from, spares buying from, and products of interest.
   - `Contacts Tab`: Multi-contact person roster with name, department, designation, direct phone, WhatsApp number, email, and primary contact toggle.
   - `Addresses Tab`: Multi-address matrix supporting Billing Head Office, Factory/Plant, and Dispatch Warehouses with cascading State ➔ District ➔ City dropdowns, area, and 6-digit Pincode.
   - `Social Media Matrix`: Dynamic repeater allowing creation and management of social profiles (`platform` like LinkedIn, Twitter, Facebook, Instagram, YouTube and profile `url`).
   - `Financials & Credit Tab`: Credit limit (currency), credit period in days, payment terms selector, and bank account associations.
   - `Activity Timeline Tab`: Chronological audit trail of corporate mutations, status transitions, and RFQ consignments.

### Test Cases
- [ ] Verify navigating to `/user/addEdit` or `/user/addedit` seamlessly redirects to `/companies/add`.
- [ ] Verify company list loads with correct pagination, search filters, and grade/potential badges.
- [ ] Verify changing Grade or Potential directly from the table dropdown updates immediately via PATCH without page reload.
- [ ] Verify creating a company requires legal name and validates GSTIN/PAN formatting.
- [ ] Verify creating and editing a company persists all 10 extended intelligence fields:
  - `pincode`: Validates numeric 6-digit postal code.
  - `district_id`: Linked properly via cascading dropdown.
  - `company_category`: Persists selected category.
  - `product_manufacture_or_supply`: Persists manufacturing details.
  - `machines_buying_from`: Persists machine vendor/competitor intelligence.
  - `spares_buying_from`: Persists spare parts vendor/competitor intelligence.
  - `products_interested`: Persists client product interests.
  - `gst_registration_date`: Persists date string.
  - `age_of_company`: Persists company tenure.
  - `social_media`: Dynamic repeater adds multiple platform + URL entries and saves as structured JSON array.
- [ ] Verify adding multiple contacts to a company persists all contacts in the database with primary flag enforcement.
- [ ] Verify soft-deleting a company moves the record and linked contacts to Trash (`/trash`) with full restoration capability.
- [ ] Verify spreadsheet import parses corporate fields and handles duplicate GSTIN/PAN conflicts gracefully.
- [ ] Verify real-time WebSocket events (`company.created`, `company.updated`) refresh connected user sessions live.
- [ ] Verify Add Company quick drawer extracts State, District, and City from Masters with cascading dependencies:
  - Selecting State dynamically fetches districts for that state and resets District and City.
  - District dropdown is disabled until State is selected.
  - Selecting District dynamically fetches cities for that specific district and resets City.
  - City dropdown is disabled until District is selected.
  - Changing District clears selected City and refetches cities for the new district.
  - Adding a custom city persists the new city in City Master with both `state_id` and `district_id`.
- [ ] Verify Autocomplete and Autofill suppression:
  - No black tooltip/popover bubbles (e.g., historical names like `ABC packaging`) appear over `Company Name *` or any other input.
  - All 14 quick drawer inputs have `autocomplete="off"`.
  - Global `autocompleteBlocker.ts` successfully monitors DOM and applies suppression attributes.
- [ ] Verify Mouse Wheel value protection:
  - Hovering and scrolling mouse wheel over any numeric input (e.g. credit limit, phone number, pincode) does NOT change numeric values.


---

## 37. INVENTORY: Product Stock Module

- **Route:** `/product-stock/list`
- **Legacy Redirects:** `/product-stock`, `/product_stock/list`, `/product_stock`
- **Required Permission:** `product.view`
- **Purpose:** Centralized 15-column multi-warehouse inventory matrix (`Mumbai`, `Ahmedabad`, `Indore` physical, transit, and ordered pipelines) outer-joined directly from Product Master (`limit: 2500`, `le=5000`) with live breakup drawers and Product Master detail view.

### Visual Elements & Layout
1. **Breadcrumbs:** `Inventory` > `Product Stock`
2. **Page Title:** `Product Stock`
3. **Top Action Controls:**
   - Dark slate Funnel filter toggle button (`#556987`, filter panel collapsed by default on `/product-stock/list`).
   - Golden-amber `Export` button (`#f59e0b`, hover `#d97706`, `.btn-imp-exp.stock-btn-export` with vector download icon matching Companies `Imp / Exp`): Downloads `Product_Stock_List.xlsx` workbook for the active filtered dataset.
4. **Collapsible 4-Column Filter Panel:**
   - `Category` (`All` + active `ProductCategory` masters).
   - `Sub Category` (`All` + `ProductSubCategory` masters dynamically narrowed when `Category` is selected).
   - `Brand` (`All` + active `Brand` masters).
   - `Is Negative Stock` (`Select`, `Yes`, `No`).
   - Dark slate `Reset` and golden-amber `Search` buttons.
5. **Live Search Input:**
   - Instant client-side search across `Product Name (As Per Tally)`, `Product Code`, `Brand`, and `Sub Category`.
6. **15-Column Title-Case Product Stock Table (Default `50` Rows/Page):**
   - `Sr. No.` | `Product Name (As Per Tally)` (blue clickable hyperlink opening the `Product Details` `SideDrawer` with real Packaging Quantity, Minimum Price, CBM Dimensions, HSN, GST %, UOM, and 9-column warehouse breakdown) | `Product Code` | `Brand` | `Sub Category`
   - **Physical Columns (Soft Pink `#f9e7e9`):** `Mumbai`, `Ahmedabad`, `Indore`
   - **Transit Columns (Warm Beige-Grey `#efece6`):** `Mumbai Transit`, `Ahmedabad Transit`, `Indore Transit`
   - **Ordered Columns (Medium Grey `#dedede`):** `Mumbai Ordered`, `Ahmedabad Ordered`, `Indore Ordered`
   - **Summary Column:** `Total Qty` ($\sum \text{Physical} + \sum \text{Transit} + \sum \text{Ordered}$)
   - **Transaction-Driven `ⓘ` Breakup Buttons (`breakup_flags`):** Opens right-hand `Sale Order Information` drawer (for physical stock) or `Consignment Breakup` drawer with `Booked Sale Orders (FIFO Deducted)` & clickable `Consignment Details` modal (for transit/ordered stock), without hardcoded fallback rows.

### Test Cases
- [ ] Verify navigating to `/product-stock`, `/product_stock`, or `/product_stock/list` resolves to `/product-stock/list` with filter panel collapsed by default.
- [ ] Verify all active Product Master SKUs load (even products with `0` stock and no `product_stocks` row yet) with populated `Brand`, `Category`, and `Sub Category`.
- [ ] Verify selecting a `Category` dynamically narrows `Sub Category` options and clicking `Search` / `Reset` applies and resets filters accurately.
- [ ] Verify `Is Negative Stock` (`Yes` / `No` / `Select`) filters products with any negative warehouse or total balance.
- [ ] Verify clicking `Product Name (As Per Tally)` on `/product-stock/list` opens the `Product Details` `SideDrawer` displaying real Packaging Quantity, Minimum Price, and `L × W × H cm` CBM dimensions.
- [ ] Verify clicking `ⓘ` opens live `Sale Order Information` or `Consignment Breakup` (with FIFO booked Sale Orders) and `Export` downloads `Product_Stock_List.xlsx`.

---

## 38. INVENTORY: Stock Adjustment & Order PDF Module

- **Route:** `/stock-adjustment`
- **Legacy Redirects:** `/adjustment/list`, `/adjustment`
- **Order PDF Route:** `/adjustment/adjustment-order-pdf/:id`
- **Required Permission:** `product.view` (Mutations: `product.create`, `product.delete`)
- **Purpose:** Formal inventory adjustments, reconciliation of count variances, split order consignments, client return processing, and damage write-offs with automatic warehouse inventory synchronization, left-sliding audit drawer, and official A4 Order PDF generation.

### Visual Elements & Layout
1. **Breadcrumbs:** `Inventory` > `Stock Adjustment`
2. **Page Title:** `Stock Adjustment`
3. **Subtitle:** `Record physical inventory count adjustments, reconciliations, split orders, and damage deductions.`
4. **Header Action Controls:**
   - Dark slate Funnel filter toggle button (`#556987`, filter panel collapsed by default).
   - `+ Add New ▾` (Primary blue dropdown button) — Opens `Stock IN Adjustment` or `Stock OUT Adjustment` form.
   - Golden-amber `Export` button (`#f59e0b` / hover `#d97706`, `.btn-imp-exp` with vector download icon; replaces legacy `Imp / Exp` and omits `Bulk Actions`) — Exports filtered adjustments to `stock_adjustments.csv`.
5. **Search & Comprehensive Filter Toolbar:**
   - Live text search bar querying Invoice Number, Client Name, Warehouse, or Remarks.
   - Adjustment Type dropdown filter: `All Types`, `Stock IN` (green), `Stock OUT` (red).
   - Adjustment Purpose dropdown filter: `All Purposes`, `Return From Client`, `Split`, `Damage`, `Inventory Count Variance`, `Internal Transfer Correction`.
   - **Interactive Dual-Calendar Date Range Picker Popover:**
     - Calendar trigger button displaying active range (e.g. `12-09-2026 - 19-09-2026`).
     - 7 Quick Presets: `Today`, `Yesterday`, `This Week`, `Last Week`, `This Month`, `Last Month`, `Custom Range`.
     - Dual Side-by-Side Monthly Navigation: Renders current and next consecutive month with synchronized navigation chevrons.
     - Visual range selection highlighting start date, end date, and continuous hover range.
     - "Clear" button resets to all-time; "Apply" button commits the date filter and executes query.
6. **Master Stock Adjustments Table:**
   - Columns:
     - `Sr No.`: Sequential row index counter.
     - `Invoice No.`: Official transaction voucher number (e.g., `ADJ-2026-001`).
     - `Adjustment Type`: Pill badge displaying `Stock IN` (emerald green) or `Stock OUT` (crimson red).
     - `Client Name`: Name of customer, supplier, or party involved in transaction.
     - `Warehouse`: Warehouse facility where adjustment took effect.
     - `Purpose`: Categorization reason badge (`Return From Client`, `Split`, `Damage`, etc.).
     - `Date`: Formatted transaction date (`DD-MM-YYYY`).
     - `Total Amount`: Formatted total currency sum (e.g., `₹ 2,45,000.00`).
     - `Action`: 3-dots `⋮` action menu button.
7. **3-Dots Action Popup (`ActionMenu`):**
   - Triggered by clicking the row-level `⋮` action menu button on any row.
   - Includes backdrop-click dismissal, `Escape` key handler, and collision-aware viewport positioning.
   - Actions:
     - `Download PDF`: Client-side high-fidelity PDF generation or server endpoint redirect to `/adjustment/adjustment-order-pdf/{id}`.
     - `Delete`: Prompts confirmation modal, verifies permissions, soft-deletes the voucher, and shows toast notification.
8. **Slide-In SideDrawer (Left-Side Modal Animation):**
   - Opens smoothly from the left viewport edge (`side-drawer--left`) whenever clicking any row in the adjustments table.
   - **Header:**
     - Title: Invoice/Reference code (e.g., `ADJ-2026-001`).
     - Status Badge: `Stock IN` green or `Stock OUT` red pill badge.
     - Close button: `✕` icon button in top-right corner.
   - **Comprehensive Metadata Fields Grid:**
     - `Client Name`: Customer or vendor entity name.
     - `Warehouse`: Storage depot name.
     - `Invoice No.`: Official invoice reference.
     - `Adjustment Type`: IN / OUT badge.
     - `Date`: Transaction date (`DD-MM-YYYY`).
     - `Purpose`: Selected adjustment purpose.
     - `Created By`: Author employee name or user email.
     - `Created At`: Audit creation timestamp (`DD-MM-YYYY HH:mm`).
     - `Total Amount`: Formatted grand total sum (`₹ 2,45,000.00`).
   - **Line Items Detail Table (Full 8-Column Schema):**
     - Columns:
       - `Sr No.`: Item sequence index.
       - `Item(S)`: Product SKU and item description.
       - `Category`: Product category.
       - `HSN`: Customs HSN/SAC code.
       - `GST`: Applicable GST percentage rate.
       - `Quantity`: Number of units adjusted.
       - `Unit Price`: Unit rate in currency.
       - `Total Price`: Calculated item total ($\text{Quantity} \times \text{Unit Price}$).
     - **Grand Total Footer Row:** Light slate background (`#e2e8f0`) spanning the table width, with high-contrast label and bold emerald green amount (`#15803d`).
   - **Remarks Section:**
     - Bordered callout card displaying administrative remarks, reason notes, or inspection comments.
9. **A4 Order PDF Generation Engine (`stockAdjustmentPdf.ts`):**
   - Engineered using `jsPDF` and `jspdf-autotable`.
   - Generates production-quality A4 PDF documents matching official corporate invoice formats:
     - Header branding: Inhyma Solutions logo, corporate identity, GSTIN, PAN, and office address.
     - Document Title Banner: `STOCK ADJUSTMENT ORDER` header with voucher ID.
     - Two-Column Voucher Details: Voucher No, Date, Type, Purpose, Warehouse, Client/Party.
     - 8-Column AutoTable Line Items Matrix: Sr No, Item(S), Category, HSN, GST, Quantity, Unit Price, Total Price.
     - Highlighted Grand Total block with currency formatting.
     - Remarks callout card.
     - Dual Signatory section: "Prepared By" and "Authorized Signatory" blocks.

### Test Cases
- [ ] Verify navigating to `/adjustment/list` or `/adjustment` automatically redirects to `/stock-adjustment`.
- [ ] Verify clicking on the Date Range button opens the dual-calendar popover with 7 preset buttons.
- [ ] Verify clicking any preset (e.g. `This Month`, `Last Week`) selects the corresponding dates and highlights the range visually.
- [ ] Verify navigating months forward/backward in the dual-calendar updates month/year synchronously.
- [ ] Verify clicking `Apply` in the date picker filters the table records to within that date range.
- [ ] Verify filtering by Adjustment Type (`Stock IN` / `Stock OUT`) and Purpose updates the table live.
- [ ] Verify clicking on any row in the adjustments table opens the SlideDrawer smoothly from the **left side**.
- [ ] Verify the SideDrawer displays all 9 required metadata fields: `Client Name`, `Warehouse`, `Invoice No.`, `Adjustment Type`, `Date`, `Purpose`, `Created By`, `Created At`, and `Total Amount`.
- [ ] Verify the SideDrawer line items table includes all 8 columns: `Sr No.`, `Item(S)`, `Category`, `HSN`, `GST`, `Quantity`, `Unit Price`, `Total Price`.
- [ ] Verify the `Grand Total` footer row renders with light slate background (`#e2e8f0`) and bold green currency (`#15803d`).
- [ ] Verify the Remarks box renders underneath the table with full notes text.
- [ ] Verify clicking the 3-dots `⋮` action menu displays `Download PDF` and `Delete`.
- [ ] Verify clicking `Download PDF` triggers `generateStockAdjustmentPdf()` and downloads the formatted A4 PDF.
- [ ] Verify visiting `/adjustment/adjustment-order-pdf/:id` renders or downloads the adjustment order document.
- [ ] Verify clicking `Delete` opens a confirmation modal and soft-deletes the record upon confirmation.

---

## 39. TASK: Technical Tasks Module

- **Route:** `/technical-task/list`
- **Legacy Redirects:** `/technical-tasks`
- **Required Permission:** `technicaltask.view` (Mutations: `technicaltask.create`, `technicaltask.update`, `technicaltask.delete`)
- **Purpose:** Field service ticket management, preventive maintenance scheduling, machine breakdown triage, and service technician engineering dispatch.

### Visual Elements & Layout
1. **Breadcrumbs:** `Task` > `Technical Tasks`
2. **Page Title:** `Technical Tasks`
3. **Subtitle:** `Manage field service calls, machine maintenance tickets, technician allocation, and customer support requests.`
4. **Action Buttons:**
   - `+ ADD NEW` (Primary blue button) — Opens the technical service ticket creation drawer.
   - `DELETE` — Bulk delete selected technical tasks.
   - `Refresh` — Refetches tickets and updates status tab counters.
5. **Status Workflow Tabs (with Live Counter Badges):**
   - `All` — Total technical service tasks.
   - `Pending` — Unassigned or newly lodged customer service tickets.
   - `Allotted` — Assigned to a field service technician with scheduled visit date.
   - `Under Process` — Work in progress, machine inspection, or part replacement underway.
   - `Completed` — Service signed off and resolved by client.
   - `Cancelled` — Ticket cancelled or customer rescheduled.
6. **Filter Toolbar & Sub-Toolbar:**
   - Single unified sub-toolbar search bar (`placeholder="Search..."`) querying Customer Name, Machine Model, Serial No, Contact Person, Phone, or City, with 1-click serial badge deep-filtering on table rows.
   - Collapsible filter panel positioned above data tabs with:
   - Call Type filter dropdown (`Installation`, `Preventive Maintenance`, `Breakdown Service`, `Warranty Inspection`).
   - Service Mode filter dropdown (`On-Site`, `Remote Support`, `Workshop Repair`).
   - Priority filter dropdown (`Low`, `Medium`, `High`, `Critical`).
   - Technician filter dropdown (populated from Technicians master / employee directory).
7. **Master Technical Tasks Table:**
   - `Checkbox` — Multi-row selection for bulk operations.
   - `Sr. No.` — Sequence index counter.
   - `Ticket No.` — Unique service call identifier (e.g. `TECH-2026-042`).
   - `Customer / Company` — Client entity name with contact phone.
   - `Machine & Model` — Equipment description and machine serial number.
   - `Call Type` — Service classification pill.
   - `Technician` — Assigned service engineer name with avatar pill.
   - `Scheduled Date` — Target service visit date and time slot.
   - `Priority` — Color-coded priority pill (`Critical` red, `High` orange, `Medium` blue, `Low` gray).
   - `Status` — Current workflow status pill.
   - `Action` — Quick Edit (pencil icon), Status Transition dropdown, and Soft-Delete (trash can icon).
8. **Technical Service Creation / Edit Modal:**
   - Customer / Company autocomplete selector.
   - Machine Model, Serial Number, and Warranty Status (`Under Warranty`, `Out of Warranty`, `AMC Contract`).
   - Call Type selector and Service Mode selector.
   - Assigned Technician autocomplete selector.
   - Scheduled Visit Date and Time.
   - Problem Description and Customer Complaint text notes.

### Test Cases
- [ ] Verify navigating to `/technical-tasks` automatically redirects to `/technical-task/list`.
- [ ] Verify status tabs render with dynamic badge counts matching database records.
- [ ] Verify switching between status tabs (`Pending`, `Allotted`, `Under Process`, `Completed`, `Cancelled`) filters tickets accurately.
- [ ] Verify clicking `+ ADD NEW` opens the creation drawer with all customer, machine, and technician fields.
- [ ] Verify technician dropdown populates with active technicians from the Technicians master.
- [ ] Verify status transitions update ticket state and log the action in the audit trail.
- [ ] Verify soft-deleting a technical task moves it to Trash (`/trash`) with restore capability.
- [ ] Verify multi-select checkboxes allow bulk deletion of technical service tasks.
- [ ] Verify the table sub-toolbar renders a single unified search input (`placeholder="Search..."`) that filters across serial number, company, model, and task description.
- [ ] Verify clicking a serial number badge on any row filters the table and populates the unified search input.
- [ ] Verify the table body empty state displays a clean illustration without any redundant '+ Add New Task' button (using the primary '+ ADD NEW' button in the page header).

---

## 40. GLOBAL PLATFORM HARDENING: Autocomplete Suppression & Wheel Lockout

- **Files:** `frontend/src/lib/autocompleteBlocker.ts`, `frontend/src/App.tsx`, `frontend/src/main.tsx`, `frontend/src/style.css`
- **Scope:** Global UI Engine, All Modals, Drawers, Input Fields, and Numeric Steppers across Inhyma ERP, ERP Main, and Yinglima ERP.
- **Purpose:** Eliminates intrusive browser tooltip popovers / autocomplete bubbles (such as the black `ABC packaging` bubble over company names), blocks password manager heuristic injections, and prevents mouse wheel scrolling from inadvertently changing numeric values on hover.

### Visual & Behavioral Specifications
1. **Dynamic DOM Auto-Attribute Stamping:**
   - Active `MutationObserver` on `document.body` monitors all DOM tree changes.
   - Automatically injects `autocomplete="off"`, `autocapitalize="off"`, `spellcheck="false"`, `data-lpignore="true"` (LastPass blocker), and `data-form-type="other"` (1Password/Bitwarden heuristic disabler) into every `<form>`, `<input>`, `<textarea>`, and `<select>` element.
2. **Capture-Phase Focus Interception:**
   - Document-level capture listener on `focusin` intercepts focus before the browser renders historical suggestions or cached input overlays.
3. **Explicit Form Hardening:**
   - All 14 input fields in the Companies quick drawer explicitly carry `autoComplete="off"`.
   - Control plane user management modals carry `autoComplete="off"` or `autoComplete="new-password"`.
4. **Passive Wheel Lockout:**
   - Document-level listener intercepts `wheel` events on `input[type="number"]` and immediately invokes `blur()`, severing mouse wheel scroll actions from value modification.
5. **Spin-Button Styling Elimination:**
   - Universal CSS removes webkit up/down arrows and forces `appearance: textfield` in Firefox to prevent cluttered numeric inputs.

### Test Cases
- [ ] Verify opening any modal or drawer (e.g. Companies quick drawer, Global Users modal, Technical Tasks drawer) does NOT display browser autocomplete bubbles or previous entry tooltips.
- [ ] Verify typing in `Company Name *` field does not trigger floating black suggestion badges (e.g. `ABC packaging`).
- [ ] Verify inspecting DOM elements in DevTools confirms `autocomplete="off"` and `data-lpignore="true"` are present on dynamically rendered inputs.
- [ ] Verify hovering the mouse cursor over a numeric input (e.g. phone number, credit limit, pincode, task duration) and scrolling the mouse wheel does NOT alter the value.
- [ ] Verify numeric inputs do not display native up/down stepper spin buttons in Chrome, Edge, or Firefox.

---

## 41. COMPANY MASTER: Typeahead Autocomplete & Entity Extraction

- **Files:** `frontend/src/pages/Companies.tsx`, `backend/app/companies/routes.py`, `backend/tests/test_companies.py`
- **Scope:** Inhyma ERP — Companies Directory (`/companies`), "Add Company" Quick Drawer, and "Full Company Profile" Modal Drawer.
- **Purpose:** Enables instant lookup and extraction of existing companies from the database when typing letters in the `Company Name *` input, preventing redundant company creation and auto-populating known addresses, contacts, and tax IDs.

### Visual & Behavioral Specifications
1. **Instant Typeahead Extraction:**
   - Typing any letter/character into `Company Name *` instantly searches local in-memory records (0ms) and debounces a remote database query to `GET /api/v1/companies/lookup?q=...` (150ms).
   - Renders an elevated dropdown below the input styled with `box-shadow: 0 10px 25px rgba(0, 0, 0, 0.12)`.
2. **Matching Letter Highlight:**
   - Matching letters/substrings within company names are highlighted in bold deep blue (`#0061f2`) on a soft blue background (`#e0f2fe`).
3. **Company Preview Details:**
   - Each suggestion entry displays:
     - Company Name (with highlight).
     - Company Type badge (`B2B`, `B2C`, etc.).
     - GST / Tax ID Number (`GST: ...`).
     - Location subtitle (`Area, District`).
4. **Keyboard Accessibility:**
   - `ArrowDown` & `ArrowUp`: Move focus across matching company items.
   - `Enter`: Selects the highlighted company.
   - `Escape`: Closes the dropdown popover.
5. **Entity Auto-Fill on Select:**
   - Clicking or pressing `Enter` on a company fills the `company_name` input and auto-populates all available matching data:
     - Business Type (`company_type`)
     - GST Number (`tax_id_number`)
     - Area (`area`)
     - State (`state_id`)
     - District (`district`)
     - City (`city_id`)
     - Contact Person Salutation, Full Name, and Designation
     - Contact Numbers (Calling, WhatsApp, IndiaMart)
     - Primary Website URL
     - Assigned Sales Person
6. **Graceful Fallback:**
   - If no existing company matches the typed query, the dropdown displays:  
     `➕ No existing company matching "[query]". Will be created as a new company profile.`

### Test Cases
- [ ] Verify clicking `+ ADD COMPANY` on `/companies` opens the Quick Drawer with `Company Name *` focused or ready.
- [ ] Verify typing `Pan` or `Apex` or `Zenith` displays a custom dropdown with matching companies from the database.
- [ ] Verify matched letters in the suggestion list are highlighted in deep blue with a light blue pill.
- [ ] Verify pressing `ArrowDown` moves active focus through the suggestions, and pressing `Enter` selects the highlighted company.
- [ ] Verify selecting an existing company auto-fills the GST No, Area, State, District, City, and Contact details.
- [ ] Verify pressing `Escape` or clicking outside dismisses the suggestion dropdown.
- [ ] Verify typing a brand new company name that does not exist shows the helper note indicating it will be created as a new company profile.
- [ ] Verify saving the company completes successfully via either "Save & Continue" or "Save & Exit".

---

## 42. STOCK ADJUSTMENT: Client Name Typeahead Extraction (Stock IN & Stock OUT)

- **Files:** `frontend/src/components/ClientNameAutocomplete.tsx`, `frontend/src/pages/AddAdjustmentOrderPage.tsx`, `frontend/src/pages/StockAdjustmentPage.tsx`, `frontend/src/pages/__tests__/AddAdjustmentOrderPage.test.tsx`
- **Scope:** Inhyma ERP — Add Adjustment Order Page (`/adjustment/addEdit`), Quick Adjustment Drawer (`/stock-adjustment`), for both **Stock IN** (`Addition`) and **Stock OUT** (`Deduction`).
- **Purpose:** Enables instant lookup and extraction of registered companies in the `Client Name` input with exact visual alignment to the production ERP layout (`Company Name | Contact Person | Phone Number`).

### Visual & Behavioral Specifications
1. **Dropdown Trigger & Presentation:**
   - Clicking or focusing into the `Client Name` field immediately opens the dropdown displaying available companies formatted as:  
     `[Company Name] | [Contact Person Name] | [Phone Number]`
   - If contact person is absent, renders as `[Company Name] | | [Phone Number]`.
2. **Typeahead Character Highlighting:**
   - As letters/words are typed, the company list filters dynamically.
   - Matched characters in company names, contact persons, or phone numbers are highlighted in vivid blue (`#0061f2`) on a soft blue background (`#e0f2fe`).
3. **Keyboard & Selection Controls:**
   - `ArrowDown` & `ArrowUp` cycle through suggestions.
   - `Enter` selects the highlighted company, populating `Client Name` with the company name and closing the popover.
   - `Escape` dismisses the dropdown.
4. **Dual Stock IN & Stock OUT Support:**
   - Functions identically whether `Adjustment Type` is set to `Stock IN` or `Stock OUT`.
   - Switching between `Stock IN` and `Stock OUT` preserves the selected client name.
5. **Custom Client Name Support:**
   - Freeform typing is fully supported for non-registered or ad-hoc clients.
   - If no company matches the typed letters, displays: `➕ Use "[term]" as custom client name`.

### Test Cases
- [ ] Verify navigating to `/adjustment/addEdit?type=Addition` (Stock IN) displays the `Client Name` field with placeholder `Enter Client Name`.
- [ ] Verify clicking/focusing into `Client Name` immediately displays the dropdown formatted as `Company | Contact | Phone`.
- [ ] Verify typing letters (e.g. `Cir`, `Apex`, `Genius`) filters the options and highlights matched letters in blue.
- [ ] Verify pressing `ArrowDown` moves highlight and `Enter` populates the company name.
- [ ] Verify toggling `Adjustment Type` to `Stock OUT` maintains full typeahead autocomplete functionality.
- [ ] Verify entering a custom client name not in the list allows saving the adjustment order successfully.
- [ ] Verify the quick adjustment drawer on `/stock-adjustment` also provides the client autocomplete.

---

## 43. LEADS MODULE: Lead Inquiries Management & Sales Pipeline

- **Files:**
  - Frontend: `frontend/src/pages/LeadsPage.tsx`, `frontend/src/App.tsx`, `frontend/src/lib/nav.ts`, `frontend/src/components/icons.tsx`, `frontend/src/types/index.ts`, `frontend/src/pages/__tests__/LeadsPage.test.tsx`
  - Backend: `backend/app/leads/models.py`, `backend/app/leads/schemas.py`, `backend/app/leads/repository.py`, `backend/app/leads/service.py`, `backend/app/leads/routes.py`, `backend/app/api/v1/router.py`, `backend/tests/test_leads.py`
- **Scope:** Inhyma ERP — Lead Inquiries Management (`/lead/list`), Legacy aliases (`/leads`, `/lead`, `/leads/list`), Navigation Menu `LEAD` > `Leads`.
- **Reference URL & UI:** `erp.inhymasolutions.com/lead/list`
- **Purpose:** Full lifecycle acquisition, intake, assignment, and tracking of customer leads, inquiry requirements, acquisition channels, and sales allocations.

### Visual & Behavioral Specifications (Companies Module UI Design Alignment)
1. **Sidebar Navigation & Routing:**
   - Positioned in sidebar under `LEAD` section with dedicated clipboard icon.
   - Active route: `/lead/list` (with backward compatibility redirects for `/leads`, `/lead`, `/leads/list`, `/lead/list.html`).
   - Page container uses `AppShell activeKey="leads" pageClassName="page-suppliers"` and `main.page` with breadcrumb trail `Dashboard / Leads`.
   - Header bar uses `.page-header` with `h1` and `.page-subtitle` ("Lead directory, sourcing pipeline, contact tracking, and assignments.").
2. **Top Action Controls (Exact Reference Match):**
   - **Filter Button:** Styled button with funnel icon (`#0061f2` when open, `#475569` when closed) toggling the filter card (collapsed by default).
   - **+ ADD NEW Button:** Uses `.btn-add-new` (`#0061f2` background, white text) opening the comprehensive slide drawer with autocomplete.
   - **DELETE Button:** Clean action button (`#10b981` default, `#dc2626` when rows selected) with trash icon for bulk soft-deletion.
3. **Exact 10-Field Dynamic Filter Card (Off by Default):**
   - Collapsed by default, toggled via the funnel filter button in the top action bar:
     * **Row 1:** `Lead Date Range` (with DateRangePicker), `Lead Created By` (select, default "Select"), `Business Type` (select, default "All").
     * **Row 2:** `State` (select, default "All"), `District` (select, default "All", cascaded by State), `City` (select, default "All", cascaded by District/State).
     * **Row 3:** `Lead Source` (select, default "Select"), `Priority` (select, default "All"), `Lead Allotted To` (select, default "All").
     * **Row 4:** `Lead Status` (select, default "All"), and right-aligned `Reset` (slate `#64748b`) & `Search` (amber/gold `#eab308`) action buttons.
   - **Dynamic List-Based Extraction:** Dropdown options dynamically aggregate and extract distinct non-empty values from the actual leads present in the list, enabling instant self-contained filtering without rigid presets.
   - **Dual Client & Server-Side Filtering:** Reactive client-side evaluation against all 10 criteria combined with URL search params dispatched to `GET /api/v1/leads/` for high-volume enterprise datasets.
4. **Data Table Controls & Layout (.card Architecture):**
   - **Toolbar Header:** Starts directly with the authentic toolbar — `50 v Items/Page` selector (options: 10, 20, 50, 100) and `Search...` input with clear `×` button.
   - **Interactive Column Sorting Across Every Column (Companies Module Parity):** Every data column features interactive 3-state sorting (Ascending `▲` -> Descending `▼` -> Reset). Active column headers display `#0284c7` badges with `#e0f2fe` backgrounds; inactive headers display subtle `↕` sort cues.
   - **Table Scroll Container:** Rendered inside `.table-scroll` with `border-collapse: separate; border-spacing: 0` and sticky header capability.
   - **13 Columns Matching Production Screenshot:**
     1. `Checkbox` (`[ ]`): Header checkbox selects/deselects all visible rows.
     2. `Sr. No.`: Row sequence number with sorting indicator (`▲` / `▼`).
     3. `Company Name`: Sortable; primary blue link (`#0061f2`) that opens the **SideDrawer** displaying complete lead profile details.
     4. `Business Type`: Sortable; category badge (`.chip`).
     5. `Source`: Sortable; inquiry acquisition channel.
     6. `Contact Person`: Sortable; contact name and direct phone number with icon.
     7. `Priority`: Sortable; visual pill badge with color coding (Urgent, High, Medium, Low).
     8. `Area/City`: Sortable; formatted geographic location (e.g. `GIDC / Vapi`).
     9. `District / State`: Sortable; regional jurisdiction (e.g. `Valsad / Gujarat`).
     10. `Requirements`: Sortable; summary of inquiry requirements/machinery specifications with tooltip.
     11. `Allotted To`: Sortable; assigned sales representative.
     12. `Added On`: Sortable; formatted inquiry date (`DD-MM-YYYY`).
     13. `Action`: Quick Edit (pencil icon `#eff6ff`) and Single Delete (trash icon `#fef2f2`) buttons.
   - **Empty State:** Distinct banner spanning all 13 columns displaying:
     `No Data Available In Table` on soft gray background (`#f1f5f9`).
   - **Pagination Footer:** Displays `Showing {start} To {end} Of {total} Entries` alongside windowed page number pills and `Previous` / `Next` buttons.
5. **SideDrawer for Lead Profile (Companies Module Pattern):**
   - Clicking on any Company Name opens `<SideDrawer>` with `<DetailFieldGrid>` presenting Company Name, Business Type, Source, Priority, Status, Address, Geographic hierarchy, Requirements, Contact Information (including Designation), and Notes.
   - Includes "✏️ Edit Lead" action in the drawer header.
6. **Shimmer Skeleton Loading:**
   - Replaced spinner with `<LeadsTableSkeletonRows count={8} />` displaying smooth animated skeleton placeholder lines (`.skeleton-line`, `.skeleton-badge`) spanning all 13 table columns during data loading.
7. **Add Lead Drawer (1:1 with Production Screenshot & Form Hardening):**
   - Form layout matches production reference `media_1790675832944.png` with pixel-perfect alignment and exactly 13 fields and controls:
     1. **Lead Source \***: Typable `Combobox` component with dropdown toggle chevron (`#lead-source-select-toggle`), real-time option filtering, custom text typing, and preloaded master lead sources with placeholder "Select".
     2. **Company Name \***: With right-aligned `Add Company` link and `Search Company Name` placeholder, standardized to 38px height.
     3. **Address**: Full-width text input (38px height).
     4. **Area** & **State \***: 2-column balanced grid (`1fr 1fr`, gap 16px). `State *` is upgraded to a typable `Combobox` (`#lead-state-select`) pulling from Masters State (`/masters/states?status=active`). Changing State immediately resets District and City.
     5. **District** & **City**: 2-column balanced grid with typable cascading `Combobox` components:
        - **District** (`#lead-district-select`): Populated from Masters District (`/masters/districts/lookup?state_id={state_id}`). Disabled with placeholder "Select State First" when no state is selected. Changing District immediately resets City.
        - **City** (`#lead-city-select`): Populated from Masters City (`/masters/cities/lookup?district_id={district_id}&state_id={state_id}`). Disabled with placeholder "Select District First" when no district is selected.
     6. **Contact Person**, **Designation**, & **Priority**: 3-column balanced grid (`1fr 1fr 1fr`, gap 16px). Standardized Priority radio container (`height: 38px`, `display: flex`, `alignItems: center`) with `A ○  B ●  C ○` vertically aligned with adjacent input fields.
     7. **Contact Number** & **Email**: 2-column contact inputs (38px height).
     8. **Clients Requirements**: Full-width textarea with `minHeight: 90px`.
     9. **Submit**: Full-width bright blue action button (`#0061f2`, `height: 42px`).
8. **Robust Soft-Deletion & Bulk Deletion:**
   - Both single row delete and bulk delete perform soft deletion (`is_deleted=True`), preserving full audit compliance and recovery via Trash (`/trash`).

### Test Cases
- [ ] Verify navigating to `/lead/list` displays the "Leads" heading, active sidebar item "Leads", and breadcrumbs `Dashboard / Leads`.
- [ ] Verify the table displays pulsating CSS shimmer skeleton rows (`.skeleton-line` and `.skeleton-badge`) across all 13 columns while data is loading.
- [ ] Verify the 3 top action buttons (Filter, + ADD NEW, and green DELETE) are present and properly styled.
- [ ] Verify the table contains all 13 columns: Checkbox, Sr. No., Company Name, Business Type, Source, Contact Person, Priority, Area/City, District / State, Requirements, Allotted To, Added On, Action.
- [ ] Verify when no records exist, the table displays `No Data Available In Table` spanning all 13 columns.
- [ ] Verify clicking `+ ADD NEW` opens the drawer with exact 13 fields matching reference screenshot:
  - Lead Source * typable combobox (both click-to-select and type-to-filter/custom entry supported)
  - Company Name * with "Add Company" link and "Search Company Name" placeholder
  - Address text input
  - Area and State * (typable combobox from Masters State)
  - District and City (typable comboboxes from Masters District and City)
  - Contact Person, Designation, Priority (`A ○  B ○  C ○` radio buttons aligned to 38px row height)
  - Contact Number and Email
  - Clients Requirements textarea
  - Full-width blue "Submit" button
- [ ] Verify typing a custom source or selecting from dropdown in `Lead Source *` updates the field value and form state.
- [ ] Verify State ➔ District ➔ City cascading in Leads Add/Edit drawer:
  - District combobox is initially disabled with placeholder "Select State First".
  - City combobox is initially disabled with placeholder "Select District First".
  - Selecting State enables District and displays only districts belonging to that State.
  - Selecting District enables City and displays only cities belonging to that District.
  - Changing State resets both District and City.
  - Changing District resets City.
- [ ] Verify State ➔ District ➔ City cascading in Companies Quick Add & Add New drawers:
  - Quick Add: Selecting State resets District & City; selecting District resets City; only respective child districts/cities are shown.
  - Add New: Typable comboboxes (`SelectWithSearch`); State filters Districts; District filters Cities; resets cascaded children on change.
- [ ] Verify selecting an existing company via `ClientNameAutocomplete` auto-fills Address, Area, State, District, City, Contact Person, Designation, Contact Number, and Email.
- [ ] Verify clicking "Submit" validates required fields and submits `POST /api/v1/leads/`.
- [ ] Verify clicking Edit on a table row pre-fills the drawer with lead details and updates via `PUT /api/v1/leads/{id}`.
- [ ] Verify column header sorting (Ascending `▲`, Descending `▼`, Reset) works across all columns.
- [ ] Verify bulk selection and clicking `DELETE` calls `POST /api/v1/leads/bulk-delete` with soft-deletion.

---

## 44. CALL LOG: Follow Ups Management & Inquiries Tracking

- **Files:**
  - Frontend: `frontend/src/pages/FollowUpsPage.tsx`, `frontend/src/App.tsx`, `frontend/src/lib/nav.ts`, `frontend/src/components/icons.tsx`, `frontend/src/pages/__tests__/FollowUpsPage.test.tsx`
  - Backend: `backend/app/follow_ups/models.py`, `backend/app/follow_ups/schemas.py`, `backend/app/follow_ups/repository.py`, `backend/app/follow_ups/service.py`, `backend/app/follow_ups/routes.py`, `backend/app/api/v1/router.py`, `backend/tests/test_follow_ups.py`
- **Scope:** Inhyma ERP — Follow Up Logs (`/follow-up/list`), Legacy aliases (`/follow-ups`, `/follow-up`, `/call-logs/follow-up`), Navigation Menu `CALL LOG` > `Follow Up Logs`.
- **Reference URL & UI:** `erp.inhymasolutions.com/follow-up/list`
- **Purpose:** Full lifecycle telecalling interaction logging, client follow-up classifications, inquiry schedules, call feedback notes, and conversion pipeline management.

### Visual & Behavioral Specifications (Companies Module UI Design Alignment)
1. **Sidebar Navigation & Routing:**
   - Positioned in sidebar under `CALL LOG` section with phone receiver icon (`IconPhoneCall`).
   - Active route: `/follow-up/list` (with backward compatibility redirects for `/follow-ups`, `/follow-up`, `/call-logs/follow-up`).
   - Page container uses `AppShell activeKey="call-logs-follow-up"` and `main.page` with breadcrumbs `Dashboard / Follow Ups`.
   - Header bar uses `.page-header` with `h1` ("Follow Ups") and `.page-subtitle` ("Telecalling interaction logs, client follow-up classifications, and scheduled inquiry logs.").
2. **Top Action Controls (Exact Reference Match):**
   - **Filter Button:** Styled button with funnel icon (`#0061f2`) toggling the 12-control filter card (expanded by default).
   - **+ ADD NEW Button:** Bright blue action button (`#0061f2`) opening the Add Follow Up Drawer.
   - **DELETE Button:** Emerald green (`#10b981`) button with trash can icon displaying dynamic count `DELETE (N)` when rows are selected, disabled when no rows selected.
3. **12-Field Responsive 4x3 Filter Card:**
   - 4 rows x 3 columns balanced grid with 16px gaps and 38px standardized control heights:
     * Row 1: `Added Date` (date picker), `Call Type` (dropdown), `Marketing Person` (dropdown).
     * Row 2: `Business Type` (dropdown), `State` (dropdown), `District` (dropdown).
     * Row 3: `City` (dropdown), `Current Status` (dropdown), `Category` (dropdown).
     * Row 4: `Client Grade` (dropdown), `Potential Type` (dropdown), `Business Category` (dropdown).
   - Right-aligned action footer with `Reset` (`#64748b`) and `Search` (`#f59e0b` amber/gold) buttons.
4. **Interactive Data Table (13 Columns):**
   - **Columns:**
     1. `Checkbox`: Select all header checkbox and per-row checkbox.
     2. `Sr. No.`: Auto-indexed sequential numbering across pagination.
     3. `Company Name`: Interactive clickable text button opening the `<SideDrawer>` profile inspector.
     4. `Contact Person`: Bold person name with phone number subtitle (`📞 9824056789`).
     5. `Type / Grade`: Formatted string `Business Type / Client Grade`.
     6. `Area / City`: Combined geographic area and city name.
     7. `District / State`: Combined district and state name.
     8. `Current Status`: High-contrast pill badge with color coding (Existing: green `#166534`, Hot Lead: red `#991b1b`, Cold: slate `#475569`, New/In Progress: blue `#0369a1`).
     9. `Feedback`: Interaction notes with ellipsis text-truncation and full tooltip preview.
     10. `Call Category`: Call classification (`Follow Up`, `Quotation Discussion`, `Payment Follow-up`, etc.).
     11. `Followup Date`: Next scheduled interaction date.
     12. `Added On`: Date record was created.
     13. `Action`: Edit (`✏️`) and Single Delete (`🗑️`) action buttons.
   - **Shimmer Skeleton Loading:** 8 pulsating shimmer skeleton rows across all 13 columns while fetching data.
   - **3-State Column Sorting:** Clicking any table header cycles: Ascending `▲` ➔ Descending `▼` ➔ Default reset.
5. **SideDrawer Profile Inspector:**
   - Clicking any `Company Name` slides out the right-side detail drawer with `<DetailFieldGrid>` displaying:
     * Call Summary Highlight box (`#eff6ff` light blue background with feedback notes).
     * Interaction Details: Call Type, Call Category, Marketing Person, Status, Followup Date, Added On.
     * Classification & Profile: Business Type, Client Grade, Potential Type, Business Category, Category.
     * Geographic Location: Address, Area, City, District, State.
     * Contact Information: Contact Person, Designation, Contact Number, Email.
     * Direct `✏️ Edit Log` action in header.
6. **Add / Edit Call Log Drawer (Exact Reference Match):**
   - Header: `Add Call Log` (or `Edit Call Log`) with close button `✕`.
   - Fields matching production reference screenshot:
     1. `Call Type *`: Standard selection dropdown with "Telecall" as default option (`#call-log-call-type`).
     2. `Company Name *`: Powered by `ClientNameAutocomplete` with placeholder "Search for Company Name" (`#call-log-company-name`). Selecting an existing company auto-populates Contact Person and Phone Number.
     3. `Contact Person`: Text input with placeholder "Contact Person" (`#call-log-contact-person`).
     4. `Phone Number`: Text input for contact phone (`#call-log-phone-number`).
     5. `Feedback`: Multiline textarea for conversation feedback, status, or inquiry details (`#call-log-feedback`).
     6. `Follow Up Date` & `Status`: 2-column balanced grid (`1fr 1fr`):
        - `Follow Up Date`: Date picker (`#call-log-followup-date`).
        - `Status`: Select dropdown with options `Active`, `Inactive`, `Hot Lead`, `Cold`, `Pending`, `Completed` (`#call-log-status`). Default: "Active".
   - Footer: Full-width bright blue "Submit" action button (`#btn-submit-followup`, `#0061f2`).

### Test Cases
- [ ] Verify navigating to `/follow-up/list` displays page heading "Follow Ups", subtitle, and active sidebar item `Follow Up Logs`.
- [ ] Verify the Filter Options panel is collapsed (OFF) by default on initial page load.
- [ ] Verify clicking Filter toggle button reveals the 12-control Filter Card, and clicking again hides it.
- [ ] Verify the table contains all 13 columns matching reference screenshot.
- [ ] Verify skeleton shimmer rows render during data loading across all 13 columns.
- [ ] Verify free-text search filters records by company name, contact person, or city.
- [ ] Verify 3-state column sorting works across all columns (Ascending `▲` ➔ Descending `▼` ➔ Reset).
- [ ] Verify clicking on any Company Name opens the `<SideDrawer>` profile inspector with feedback notes and classification metadata.
- [ ] Verify clicking `+ ADD NEW` opens the "Add Call Log" drawer with exact fields matching reference screenshot:
  - `Call Type *` with default value "Telecall"
  - `Company Name *` with placeholder "Search for Company Name" and letter typeahead autocomplete
  - `Contact Person` with placeholder "Contact Person"
  - `Phone Number`
  - `Feedback` textarea
  - `Follow Up Date` date picker and `Status` dropdown with default "Active"
  - Full-width blue "Submit" button
- [ ] Verify selecting an existing company from `ClientNameAutocomplete` populates Contact Person and Phone Number automatically.
- [ ] Verify clicking "Submit" validates required fields (`Call Type *`, `Company Name *`) and creates the call log.
- [ ] Verify row selection checkbox enables the green `DELETE` button with selected count.
- [ ] Verify single soft delete and bulk soft delete remove items from the table with confirmation modal.
- [ ] Verify all 12 tests in `FollowUpsPage.test.tsx` pass 100%.

---

## 45. HRMS: Leave Management Module (Phase 1: Foundation & Master Data)

### Overview & Operational Context
- **Module Route:** `/hrms/leave` (Accessible via Sidebar: `HRMS` ➔ `Leave Tracker` / `Leave`).
- **Phase 1 Objective:** Robust master data, entitlement policies, leave plan assignments, branch-aware holiday management, manual adjustments with immutable audit history, dynamic request workflows with holiday/weekend auto-exclusions, and manager approvals.
- **Core Tabs:**
  1. `My Leaves` (Self-service leave requests, status tracking, withdrawal/cancellation).
  2. `Leave Approvals` (Manager/HR approval queue, status filters, approval/rejection with remarks, self-approval prevention).
  3. `Holiday` (Branch-filtered annual holiday calendar, date spans, branch applicability).
  4. `Leave Adjustment` (Employee-wise balance matrix, horizontal scrolling with sticky employee name and actions, positive/negative/correction adjustments, audit trail drawer).
  5. `Leave Plans` (Multi-leave-type policy assignment rules targeted by Branch and Department).
  6. `Leave Types` (Master catalog configuration: paid/unpaid, annual quota, carry forward ceiling, consecutive day restrictions, monthly accrual).

### Visual & Behavioral Specifications
1. **Header & Navigation:**
   - AppShell with `activeKey="hrms-leave"` and breadcrumb `HRMS / Leave Tracker`.
   - Page header with title "Leave Tracker" and subtitle "Manage leave applications, balances, company holidays, and entitlement policies.".
   - Primary action buttons:
     - `+ Request Leave` (Opens Apply Leave Drawer from My Leaves or Leave Approvals).
     - `+ Add Plan` (Visible on Leave Plans tab).
     - `+ Add Holiday` (Visible on Holiday tab).
     - `+ Add Leave Type` (Visible on Leave Types tab).
2. **Leave Balance Overview Cards (My Leaves):**
   - Renders summary metric cards showing:
     - Total Balance: Aggregate available days.
     - Casual Leave, Sick Leave, Earned Leave, etc.: Quota badges showing `Available / Allocated` with progress indicators.
3. **Leave Adjustment Employee Matrix:**
   - **Table Layout:** Two-tier column header with sticky left column for `Employee` (Code, Name, Department) and sticky right column for `Action`.
   - **Intermediate Columns:** 3-column sub-headers per leave type: `Consumed`, `Available`, `Total Leave`.
   - **Horizontal Scrolling:** Clean scrolling with fixed boundary columns ensuring high usability across high-density leave catalogs.
   - **Adjust Action (`⚙️ Adjust`):** Opens Adjustment Drawer with:
     - Employee & Leave Type selector.
     - Current Balance metrics preview (`Allocated`, `Consumed`, `Adjustment`, `Available`).
     - Adjustment Type: `Add (+)` or `Deduct (-)`.
     - Days input (`number`, minimum 0.5/1.0).
     - Reason (`text`, required for auditability).
     - Calculation Preview Box showing real-time `Previous Available` ➔ `New Available`.
     - Recent Adjustment History log showing Date, Type, Amount, Previous Balance, Resulting Balance, Reason, and Admin Name.
4. **Leave Application Drawer:**
   - Employee select (pre-filled with current user).
   - Leave Type selector (filtered to active types in company).
   - Date range pickers: `From Date` and `To Date`.
   - Auto-computed `Number of Days` taking into account:
     - Date ordering validation (`from_date <= to_date`).
     - Excluded branch holidays based on employee's registered branch.
     - Excluded standard weekly offs (Saturdays/Sundays).
   - Max consecutive days enforcement based on Leave Type configuration.
   - Reason text field and optional document Attachment URL.
   - Submit validation: verifies sufficient available balance and blocks overlapping requests.
5. **Approval Queue:**
   - Filter controls: Status (`All`, `PENDING`, `APPROVED`, `REJECTED`, `CANCELLED`), Leave Type, Date Range.
   - Self-approval block: Employees cannot approve or reject their own requests.
   - Actions: `Approve` (deducts available balance by incrementing consumed) and `Reject` (requires remarks, leaves balance unchanged).
   - Cancellation: An approved request can be cancelled, which immediately restores previously consumed balance.

### Test Cases
- [ ] Verify navigating to `/hrms/leave` loads the page with all 6 tabs and displays active tab "My Leaves".
- [ ] Verify the 8 initial leave types are seeded and visible under "Leave Types" (Casual Leave, Compensatory Off, Earned Leave, Leave Without Pay, Maternity Leave, Paternity Leave, Sabbatical Leave, Sick Leave).
- [ ] Verify creating a new Leave Plan assigns multiple leave types with specific branch and department applicability.
- [ ] Verify creating a Holiday assigns specific branch applicability and does not apply globally unless explicitly configured.
- [ ] Verify creating a leave request auto-calculates calendar days while excluding branch holidays and weekly offs.
- [ ] Verify leave request is blocked if date range overlaps an existing pending or approved request.
- [ ] Verify leave request is blocked if exceeding maximum consecutive days permitted by leave type.
- [ ] Verify employee cannot approve their own leave request (HTTP 403 Forbidden).
- [ ] Verify manager approval transitions status to `APPROVED` and consumes employee balance.
- [ ] Verify manager rejection transitions status to `REJECTED` and does not alter employee balance.
- [ ] Verify cancelling an approved leave request restores consumed balance back to available.
- [ ] Verify manual Leave Adjustment (+ or -) creates an immutable audit record and updates available balance via `available = allocated + adjusted - consumed`.
- [ ] Verify all automated tests in `test_hrms_leave_phase1.py`, `HrmsPhase1Foundation.test.tsx`, and `HrmsLeavePhase1.test.tsx` pass 100%.

---

## 46. MASTERS MODULE: Interactive Status Toggle Switch & Payment Terms Master

### Overview & Visual Specification
- **Component:** `StatusToggle.tsx` integrated with `MasterPage.tsx`
- **Location:** All 27 Master Data admin tables (`/masters/payment-terms`, `/masters/cities`, `/masters/districts`, `/masters/states`, `/masters/countries`, `/masters/currencies`, `/masters/taxes`, `/masters/additional-charges`, `/masters/social-media`, `/masters/agent-types`, `/masters/company-categories`, `/masters/company-sectors`, `/masters/supplier-types`, `/masters/buyer-types`, `/masters/warehouses`, `/masters/uom`, `/masters/billing-company`, `/masters/company-list`, `/masters/technicians`, `/masters/banks`, `/masters/transport`, `/masters/lead-sources`, `/masters/adjustment-purpose`, `/masters/call-types`, `/masters/brands`, `/masters/categories`, `/masters/subcategories`).
- **Visual Design (Exact Reference Match):**
  - **Pill track:** 42px width, 22px height, 9999px border-radius.
  - **Active State (ON):** Vibrant emerald green (`#10b981`) background, white 16px thumb slid to the right (`translateX(20px)`), tooltip: *"Active — Click to deactivate"*.
  - **Inactive State (OFF):** Soft slate grey (`#cbd5e1`) background, white 16px thumb slid to the left (`translateX(0)`), tooltip: *"Inactive — Click to activate"*.
  - **Transitions:** 220ms cubic bezier transitions on background color and sliding thumb.
  - **Loading Indicator:** Micro spinning ring inside the thumb while asynchronous network request is in flight. Rapid duplicate clicks are suppressed.
  - **Permissions:** If the current authenticated user lacks `.update` permission, the toggle switch renders with 55% opacity, `cursor: not-allowed`, and tooltip *"You do not have permission to modify this status."*

### Backend Routing & Resilience
- **Dual-Method Compatibility:** Every backend master router (`backend/app/masters/*/routes.py`) accepts both `PATCH` and `POST` methods for `/{id}/activate` and `/{id}/deactivate`.
- **Failsafe Client Dispatcher (`toggleMasterStatus`):** Tries `PATCH /{id}/activate` (or deactivate), seamlessly falls back to `POST /{id}/activate` on 405/404, and further falls back to direct record update `PATCH / PUT /{id}` with `{ status }`.
- **Optimistic UI with Rollback:** State flips immediately in table rows and detail drawer. If server returns an error, the switch automatically rolls back to the prior state and displays an error banner.

### Payment Terms Reference View (`/masters/payment-terms`)
- **Table Columns:** Checkbox (row select), Sr. No., Name (e.g. `30 Days Credit`, `Full Credit`), Status (Interactive toggle switch), Action (`Edit` blue button, `Delete` red button).
- **Header Actions:** `+ ADD NEW`, `DELETE` (active when rows selected).
- **Items/Page:** 50 items/page with quick search box.

### Test Cases
- [ ] Verify navigating to `/masters/payment-terms` displays Payment Terms master table matching legacy erp.inhymasolutions.com/payment terms/list.
- [ ] Verify the table has Checkbox, Sr. No., Name, Status, and Action columns.
- [ ] Verify active payment terms display green toggle switches with thumb on the right.
- [ ] Verify inactive payment terms display gray toggle switches with thumb on the left.
- [ ] Verify clicking an active toggle switch turns it off (inactive/gray) immediately and calls the backend `/deactivate` endpoint.
- [ ] Verify clicking an inactive toggle switch turns it on (active/green) immediately and calls the backend `/activate` endpoint.
- [ ] Verify network spinner appears inside the thumb during request execution and prevents double-clicking.
- [ ] Verify sorting by Status column groups active and inactive entries correctly.
- [ ] Verify the Status toggle switch is also present and fully functional across all other master tables (Cities, Districts, States, Countries, Taxes, Warehouses, Banks, etc.).
- [ ] Verify users without update permissions see disabled toggles with `not-allowed` cursor.
- [ ] Verify non-master modules (Leads, Users, Inquiries, Sales, HRMS) remain completely unaffected and retain their standard status badges.


---

## 47. PURCHASE: Local Purchase Management & Costing Engine

### Overview & Route Mapping
- **Primary Routes:** `/purchase/localpurchase`, `/purchase/localpurchase/addedit`, `/purchase-order/list`, `/purchase-order/addedit/:id`.
- **Primary Permissions:** `purchase.local.view`, `purchase.local.create`, `purchase.local.update`, `purchase.local.delete`, `purchase.local.approve`, `purchase.local.stock_in`.
- **Purpose:** Full lifecycle management of domestic purchase orders, commercial vendor terms, dynamic line-item tax calculation, overhead expense allocation (landing cost engine), database workflow status transitions, and atomic warehouse stock-in vouchers.

### Key Visual & Functional Components
1. **Summary KPI Header:**
   - Total Orders count badge.
   - Total Order Value in INR (₹).
   - Aggregate Landed Valuation (₹).
   - Stock-In Completed vs. Pending counts.
2. **Interactive Filter Toolbar:**
   - **Tab Status Pills:** `All`, `Pending`, `Approved`, `Dispatched`, `Delivered`, `Cancelled`.
   - **Multi-Date Range Presets:** `Today`, `Yesterday`, `Last 7 Days`, `This Month`, `Last Month`, `Custom Range`.
   - **Date Range Selector:** Allows filtering across `Order Date`, `Invoice Date`, or `Created Date`.
   - **Search Input:** Fast typeahead search across Order Number, Supplier Name, and Invoice Number.
3. **Master Orders Table Columns:**
   - Checkbox (multi-row selection for bulk operations).
   - Order Number (clickable link opening detailed order drawer).
   - Order Date (`YYYY-MM-DD`).
   - Supplier Name (linked to Supplier directory).
   - Billing Legal Entity & Destination Warehouse.
   - Net Taxable Value (₹) & GST Amount (CGST+SGST or IGST).
   - Total Order Amount (₹).
   - Landed Cost Total (₹) and Landed Factor %.
   - Dynamic Workflow Status Badge (`Draft`, `Pending`, `Approved`, `Dispatched`, `Delivered`, `Cancelled`).
   - Stock-In Status Indicator (`Pending` / `Completed`).
   - Row Actions: `View Details`, `Edit Order`, `Delete`, `Stock-In`, `Download PDF`.
4. **Add / Edit Order Architecture:**
   - **Header Section:** Supplier (Typeahead Autocomplete), Billing Legal Entity, Destination Warehouse, Order Date, Invoice Number, Invoice Date, Transport Carrier, Tracking/LR Number, Payment Terms, Remarks.
   - **Dynamic Line Items Grid:** Product Selector, HSN/SAC code, UOM, Quantity, Unit Rate (₹), Discount %, Line Taxable Subtotal, GST % selector, GST Amount, Total Line Value.
   - **Direct Overhead Allocation:** Freight Charges, Handling/Labour Charges, Transit Insurance, Other Direct Charges.
   - **Automated Costing Engine:**
     $$\text{Expense Factor} = \frac{\text{Total Overheads}}{\sum \text{Line Taxable Amounts}}$$
     $$\text{Line Landed Unit Cost} = \text{Unit Rate} \times (1 + \text{Expense Factor})$$
5. **Database Workflow Integration:**
   - Status changes are validated against `app_workflow_rules` (`purchase.local.status`).
   - Unauthorized users cannot trigger state changes outside configured transitions.
6. **Atomic Warehouse Stock-In:**
   - Executing Stock-In (`POST /api/v1/purchase/local-orders/{id}/stock-in`) atomically increments warehouse inventory ledgers with unit landed cost valuation and locks the purchase order against subsequent modifications.
7. **Header Action Bar & Import / Export (`Imp / Exp`):**
   - Top-right header displays Filter Toggle (funnel), `+ ADD NEW`, `Imp / Exp` dropdown (`btn-imp-exp` golden-amber button with `SAMPLE FILE`, `IMPORT` column-mapping wizard posting to `POST /api/v1/purchase/local-orders/import`, and UTF-8 BOM `EXPORT` CSV download), and `Bulk Actions`.
   - `ImportSummaryPanel` displays created count, duplicate invoice alerts, and per-row validation errors directly below the page header.

### Test Cases
- [ ] Verify navigating to `/purchase/localpurchase` renders the Local Purchase orders table with all KPI summary cards.
- [ ] Verify switching tabs (Pending, Approved, Dispatched, Delivered, Cancelled) correctly filters the dataset.
- [ ] Verify date preset buttons (Today, Yesterday, Last 7 Days, This Month, Custom Range) accurately update table results based on the chosen Date Range By filter.
- [ ] Verify clicking "+ ADD LOCAL PURCHASE" opens the order form with empty line items and current date prefilled.
- [ ] Verify selecting a supplier populates supplier contact and billing information.
- [ ] Verify adding products calculates Taxable Value, GST Amount, and Line Total in real time.
- [ ] Verify adding overhead expenses (Freight, Loading, Insurance) updates the Landed Cost and Expense Factor across all line items automatically.
- [ ] Verify form validation prevents submission if Supplier, Billing Entity, Warehouse, or Line Items are missing.
- [ ] Verify status transition buttons strictly obey database workflow rules and user permissions.
- [ ] Verify executing Stock-In updates the warehouse stock ledger and marks the order status as completed.
- [ ] Verify clicking "Download PDF" streams a valid print-ready Purchase Order document.
- [ ] Verify clicking `Imp / Exp` opens the dropdown menu with professional SVG icon badges for `SAMPLE FILE`, `IMPORT`, and `EXPORT`.
- [ ] Verify `SAMPLE FILE` downloads `Sample_Local_Purchase_Template.csv`, `IMPORT` opens the column-mapping wizard and imports valid rows via `POST /api/v1/purchase/local-orders/import` as `Pending` orders, and `EXPORT` downloads the filtered Local Purchase CSV with UTF-8 BOM.
- [ ] Verify all 32 automated tests in `LocalPurchasePage.test.tsx` and 11 local purchase route tests in `test_purchase_routes.py` pass without errors.

---

## 48. PURCHASE: Import Purchase Consignments & Customs Landing Matrix

### Overview & Route Mapping
- **Primary Routes:** `/purchase/importpurchase`, `/purchase/importpurchase/addedit`, `/purchase-order/import-purchase-list`.
- **Primary Permissions:** `purchase.import.view`, `purchase.import.create`, `purchase.import.update`, `purchase.import.delete`, `purchase.import.approve`, `purchase.import.stock_in`.
- **Purpose:** End-to-end management of overseas import consignments, international shipping logistics (BL, containers, vessel details), multi-currency conversions, Indian Customs statutory duty assessment (Assessable Value, BCD, SWS, IGST), dual landed cost matrices, and warehouse receipt.

### Key Visual & Functional Components
1. **KPI Summary Metrics:**
   - Total Consignments Count.
   - Total Foreign Value ($ / ¥ / €).
   - Total Landed INR Valuation (₹).
   - In-Transit vs. Custom-Cleared Consignment breakdown.
2. **Consignment Logistics & Shipping Header:**
   - Overseas Supplier / Manufacturer picker.
   - Foreign Currency selector (USD, CNY, EUR, etc.) with live Exchange Rate to INR.
   - Port of Loading (Foreign origin) & Port of Discharge (Indian port).
   - Bill of Lading (BL) / Air Waybill (AWB) number and BL Date.
   - Commercial Invoice Number and Invoice Date.
   - Vessel / Flight Name, Container Numbers, Shipping Date, and Expected Arrival Date.
3. **Customs Duty & Statutory Assessment Engine:**
   - **Assessable Value (CIF INR):**
     $$\text{Assessable Value} = (\text{FOB Value Foreign} \times \text{Exchange Rate}) + \text{Ocean/Air Freight} + \text{Insurance}$$
   - **Basic Customs Duty (BCD):** Configurable percentage and amount.
   - **Social Welfare Surcharge (SWS):** Automatically calculated as 10% of BCD.
   - **Integrated GST (IGST):** Assessed on $(\text{Assessable Value} + \text{BCD} + \text{SWS})$.
   - **Clearing & Local Logistics:** C&F Agent charges, Port Demurrage/Detention, and Inland Transport to warehouse.
4. **Dual Landed Costing Matrices:**
   - **Landed Cost (With Duty & Tax):** Comprehensive inventory valuation including all statutory duties, surcharges, and local port clearance.
   - **Landed Cost (Without Duty & Tax):** Base commercial landed valuation for international cost-benefit and pricing margin analysis.
5. **Workflow & Receiving Rules:**
   - Governed by `purchase.import.status` workflow transitions.
   - Final Stock-In atomically updates bonded or domestic warehouse inventory with foreign lot reference and landed unit cost.
6. **Uploaded Invoice File Viewer (Zero-Synthetic PDF Policy):**
   - The application strictly serves and displays the **actual uploaded file** attached in the "Attach Invoice" field on the Add/Edit form.
   - Fabricated synthetic invoice PDF generation is completely eliminated.
   - Multi-format preview: Native PDF rendering in a full-height iframe with browser print and download tools, centered image viewing, and a document preview card for `.docx`/`.xlsx` formats with 1-click download.
   - Dedicated streaming endpoint `GET /api/v1/purchase/import-orders/{purchase_id}/bill-file` supporting inline preview, download disposition, bearer header, and `?token=` query param authentication.
7. **Closed State Immutability & Action Menu Scope:**
   - When an import consignment reaches `Closed` status, the row action menu (`⋮`) strictly displays **ONLY `Download Purchase`**.
   - `Edit`, `Confirm`, and `Delete` actions are suppressed.
   - Client-side navigation to `/addedit/:id` for closed consignments is blocked, and backend endpoint `PUT /purchase/import-orders/{id}` enforces `edit: "none"`.
8. **Header Action Bar & Import / Export (`Imp / Exp`):**
   - Top-right header displays Filter Toggle (funnel), `ADD NEW`, `Imp / Exp` dropdown (`btn-imp-exp` golden-amber button with `SAMPLE FILE`, `IMPORT` column-mapping wizard posting to `POST /api/v1/purchase/import-orders/import`, and UTF-8 BOM `EXPORT` CSV download), and `Bulk Actions`.
   - `ImportSummaryPanel` displays created count, duplicate consignment alerts, and per-row validation errors directly below the page header.

### Test Cases
- [ ] Verify navigating to `/purchase/importpurchase` loads import consignments table with foreign currency and INR totals.
- [ ] Verify filtering by date range works across BL Date, Shipping Date, and Invoice Date.
- [ ] Verify opening the Add Import Consignment form allows selecting foreign currency and entering an exchange rate.
- [ ] Verify entering line items in foreign currency converts them to INR line subtotals accurately.
- [ ] Verify entering Freight and Insurance calculates the correct Customs Assessable Value.
- [ ] Verify Basic Customs Duty (BCD) and Social Welfare Surcharge (SWS at 10% of BCD) compute correctly.
- [ ] Verify Integrated GST (IGST) is computed on the sum of Assessable Value, BCD, and SWS.
- [ ] Verify both Landed Cost (With Duty) and Landed Cost (Without Duty) calculate and display accurately.
- [ ] Verify saving the consignment updates table records and KPI cards.
- [ ] Verify Stock-In atomic execution transfers stock into destination warehouse and sets consignment state to received.
- [ ] Verify clicking the uploaded PDF invoice in the INVOICE column opens `/purchase-order/import-bill-file/:id` and renders the actual uploaded file inside an iframe without generating synthetic PDF.
- [ ] Verify clicking an uploaded docx invoice displays the document card with file size and download button.
- [ ] Verify that on a consignment with `Closed` status, clicking the Action menu (`⋮`) displays strictly ONLY `Download Purchase` (Edit is removed).
- [ ] Verify clicking `Imp / Exp` opens the dropdown menu with professional SVG icon badges for `SAMPLE FILE`, `IMPORT`, and `EXPORT`.
- [ ] Verify `SAMPLE FILE` downloads `Sample_Import_Purchase_Template.csv` with valid dynamic dates, `IMPORT` opens the column-mapping wizard and imports valid consignments via `POST /api/v1/purchase/import-orders/import`, and `EXPORT` downloads the filtered Import Purchase CSV with UTF-8 BOM.
- [ ] Verify all 45 automated tests in `ImportPurchasePage.test.tsx`, 6 tests in `ImportPurchasePdfPage.test.tsx`, and 23 purchase route tests in `test_purchase_routes.py` pass without errors.

---

## 49. SALE: Proforma Invoices (Extended Commercial Terms, Address Routing, Approvals Workflow)

### Overview & Route Mapping
- **Primary Routes:** `/proforma-invoice/list`, `/proforma-invoice/addedit`, `/sales/proforma-invoices`.
- **Primary Permissions:** `sale.pi.view`, `sale.pi.create`, `sale.pi.update`, `sale.pi.delete`, `sale.pi.approve`.
- **Purpose:** Commercial sales quotations, formal Proforma Invoices (PI), dual address routing (billing vs. shipping), dynamic inter/intra-state tax resolution, commercial payment & delivery terms, and database workflow approval tracking.

### Key Visual & Functional Components
1. **Client Master & Dual Address Matrix:**
   - Customer picker with auto-filling of legal trade name, GSTIN, PAN, and contact details.
   - **Billing Address vs. Shipping Address:** Independent selection and custom edit capability for Billing Address and Dispatch/Delivery Address.
2. **Extended Commercial Terms:**
   - Payment Terms dropdown (from Payment Terms Master).
   - Delivery Timeline / Lead Time (e.g. 2-3 weeks).
   - Incoterms / Freight Terms (Ex-Works, FOR Destination, CIF, FOB).
   - Logistics Carrier & Dispatch Port.
   - Corporate Bank Account selector (auto-prints RTGS/NEFT banking credentials on invoice PDF).
3. **Multi-Item Sales Ledger:**
   - Product SKU, description, HSN code, UOM, Quantity, Unit Rate, Discount %.
   - Dynamic Tax Engine: Automatically applies CGST+SGST (if Billing State equals Client State) or IGST (if Interstate).
   - Subtotal, Round Off, and Grand Total in figures and words.
4. **Approval & Conversion Workflow:**
   - Governed by `proforma.status` workflow transitions (`Draft` $\rightarrow$ `Sent` $\rightarrow$ `Approved` $\rightarrow$ `PO Received` $\rightarrow$ `Converted to Sales Order`).
5. **Print & PDF Generation:**
   - High-fidelity PDF generation with company letterhead, tax breakdown table, authorized signature, and bank RTGS/NEFT payment coordinates.

### Test Cases
- [ ] Verify navigating to `/proforma-invoice/list` renders the proforma invoice list with status badges and customer details.
- [ ] Verify clicking "+ CREATE PROFORMA INVOICE" opens the PI builder form.
- [ ] Verify selecting a customer populates default billing and shipping addresses.
- [ ] Verify modifying the shipping address independently does not affect the billing address.
- [ ] Verify selecting line items calculates Taxable Value and applies correct GST rates (CGST+SGST or IGST based on states).
- [ ] Verify selecting a Bank Account embeds correct account number and IFSC into the preview.
- [ ] Verify status transition buttons reflect permissions and database workflow rules.
- [ ] Verify clicking "Download PDF" streams a valid, professional Proforma Invoice PDF.
- [ ] Verify soft delete and restore actions function properly through the Recycle Bin.

---

## 50. COMPANIES: Advanced Specification Fields (Monthly Turnover, Potential Analysis, Direct Import from China)

### Overview & Route Mapping
- **Primary Routes:** `/companies`, Company Detail Drawer, Company Add/Edit Modal.
- **Primary Permissions:** `company.view`, `company.create`, `company.update`, `company.delete`.
- **Purpose:** Enhanced business intelligence fields for customer relationship management, revenue qualification, overseas sourcing feasibility, and personalized contact milestone tracking.

### Key Visual & Functional Components
1. **Monthly Turnover Tracking:**
   - Dedicated numerical input field for monthly business turnover with currency formatting.
   - Enables commercial sales prioritization and credit tier assignments.
2. **Potential Reason / Monthly Business Analysis:**
   - Multi-line descriptive field capturing account capacity, seasonal demand factors, and expansion outlook.
3. **Direct Import from China Cluster:**
   - Restricted strictly to **B2B** business classifications; suppressed for B2C/Retail accounts.
   - Main Toggle: `Direct Import from China` (Boolean Yes/No).
   - Dynamic Child Fields (visible when toggle is Active):
     - `China Agent / Sourcing Partner Name`
     - `Preferred China Origin Port` (e.g. Ningbo, Shanghai, Shenzhen, Qingdao)
     - `Customs Broker / CHA Reference`
     - `Expected Annual Import Volume (Containers / TEU)`
4. **Contact Birthday & Anniversary Tracking:**
   - Multi-contact person entries include `Date of Birth` (`dob`) and `Anniversary Date`.
   - Contact card automatically displays calculated current age and years of relationship.
   - Enables CRM greeting automations and relationship management reminders.

### Test Cases
- [ ] Verify navigating to `/companies` and opening Add/Edit Company modal displays `Monthly Turnover` and `Potential Reason / Monthly Business` fields.
- [ ] Verify entering numerical values into Monthly Turnover formats cleanly without character corruption.
- [ ] Verify the `Direct Import from China` checkbox renders only when Company Type is set to B2B.
- [ ] Verify toggling `Direct Import from China` on reveals China Agent, Origin Port, and Customs Broker fields.
- [ ] Verify saving the company preserves all newly added intelligence fields in the database.
- [ ] Verify adding a contact with DOB and Anniversary Date renders calculated age and anniversary milestones in the contact card.

---

## 51. SUPPLIERS: Mandatory Calling Number Validation & Contact Phone Rules

### Overview & Route Mapping
- **Primary Routes:** `/suppliers`, Supplier Detail Drawer, Supplier Add/Edit Modal.
- **Primary Permissions:** `supplier.view`, `supplier.create`, `supplier.update`, `supplier.delete`.
- **Purpose:** Strict data validation ensuring every active supplier has a verified, dialable primary contact calling phone number, separating direct voice calls from messaging channels.

### Key Visual & Functional Components
1. **Mandatory Calling Number (`contact_calling_number`):**
   - Labeled with a mandatory red asterisk: `Primary Calling Number *`.
   - Dedicated input field with country code support.
   - Client-side validation: Requires minimum 7 to maximum 15 digits; non-numeric characters (except `+`, `-`, and spaces) are rejected.
   - Form Submission Lockout: The Submit button is disabled or triggers an immediate validation banner if calling number is blank or malformed.
2. **Channel Separation:**
   - Distinct fields for `Calling Number`, `WhatsApp Number`, `Alternate Mobile`, and `Landline / Office Ext`.
   - Prevents communication failures caused by recording WhatsApp-only numbers for urgent voice calls.
3. **Backend Schema Enforcement:**
   - FastAPI Pydantic schema (`SupplierCreate`, `SupplierUpdate`) strictly enforces string length and regex pattern, raising HTTP 422 if omitted.
4. **Directory Action Integration:**
   - Calling number renders as a direct one-click `tel:` link in table rows and supplier profile drawers.

### Test Cases
- [ ] Verify opening the Add Supplier modal displays `Primary Calling Number *` with mandatory indicator.
- [ ] Verify attempting to save a supplier with an empty calling number triggers an error message and prevents submission.
- [ ] Verify entering invalid alphabetic characters is blocked or flagged by validation.
- [ ] Verify entering a valid phone number (e.g. `+91 9876543210`) passes validation and saves successfully.
- [ ] Verify supplier table displays calling number with working click-to-call link.
- [ ] Verify existing suppliers without calling numbers display an inline warning indicator prompting data enrichment.

---

## 52. HRMS: HRMS All-Employee Attendance Calendar & Payroll Excel Export QA Verification

### Feature 1: All-Employee Attendance Calendar View (`/hrms/attendance`)
- **Admin/HR View Toggle:**
  - Header displays view mode toggle between **Individual Calendar** and **All Employees Calendar**.
  - Default view for individual attendance maintains legacy functionality.
  - Toggling to **All Employees Calendar** loads the monthly attendance matrix for all authorized company personnel.
- **Attendance Matrix Table (`.hrms-all-cal-table`):**
  - **Sticky Employee Details Column:** Shows Employee Name, Code (e.g. `EMP-000`), Department, and Branch. Includes an **Open** button that switches directly to that employee's individual calendar.
  - **Summary Metrics Columns:** Total Present (`P`), Total Absent (`A`), Total Leave (`L`), Total Half Day (`HD`), and Total Working Hours (`Hrs`).
  - **Date Columns (1..31):** Every calendar day renders with weekday indicator (`Su`, `Mo`, etc.) and colored status badge button:
    - Green (`P`): Present
    - Yellow (`L`): Late arrival within/beyond grace
    - Orange (`HD`): Half Day
    - Amber (`LV`): Approved Leave
    - Purple (`H`): Company Holiday
    - Slate (`WE`): Scheduled Weekend / Weekly Off
    - Red (`A`): Unexcused Absent (subject to LOP calculation)
    - Blue (`IP`): In Progress (today's active punch-in)
- **Attendance Day Details Modal:**
  - Clicking any date cell opens a modal displaying exact punch in/out timestamps (IST), working minutes/hours, shift timing details, geofence verification status, regularization notes, holiday titles, and approved leave reasons.
- **Filters & Month Navigation:**
  - Month/Year selector with `‹ Prev`, `Next ›`, and `Today` quick navigation buttons.
  - Department filter dropdown.
  - Branch filter dropdown.
  - Employee text search filter.
- **RBAC & Scoping Safeguards:**
  - Admin & HR see all authorized company personnel.
  - Managers see only direct reports and supervised department staff.
  - Standard employees see only their own attendance; backend API returns 403 Forbidden if an employee attempts to query unauthorized personnel or company-wide data.

### Feature 2: Payroll Excel Download (`/hrms/payroll`)
- **Excel Export Engine (`GET /api/v1/hrms/payroll/export`):**
  - Uses `openpyxl` to build `.xlsx` reports with professional formatting (dark navy header fill `#1E293B`, white text, bordered data rows, currency formatting `₹#,##0.00`, and formula totals).
  - Preserves actual pre-calculated payroll records without modifying, recalculating, or locking records on export.
  - Dynamic earning and deduction columns reflect active configured rules in `hrms_payroll_components` (Basic, HRA, Special Allowance, PF, PT, etc.).
- **Toolbar & Row Download Actions:**
  - **Toolbar Export Button (`btn-export-all-payroll-excel`):** Downloads entire authorized payroll register for the selected month as `Payroll_Export_All_Employees_YYYY_MM.xlsx`.
  - **Table Row Export Button (`Excel`):** Downloads individual employee payroll sheet for the selected month as `Payroll_Export_{Emp_Code}_{Name}_YYYY_MM.xlsx`.
  - **Employee Payslip Portal Export (`My Salary Slips`):** Non-admin employees can download an Excel version of their approved payslips.
- **Payroll Safeguards & Validations:**
  - Empty months (where payroll has not yet been generated) return a clean `404 Not Found` with explanatory message.
  - Draft / Review unapproved payroll is hidden from regular employees.

### Test Cases
- [ ] Verify Admin can switch between Individual Calendar and All Employees Calendar on `/hrms/attendance`.
- [ ] Verify All Employees Calendar displays all authorized personnel with correct month days and weekday offsets.
- [ ] Verify summary metrics (Present, Absent, Leave, Half Day, Hours) agree with calculated attendance.
- [ ] Verify clicking an attendance cell opens the Attendance Day Details modal with punch in/out times, working hours, and shift info.
- [ ] Verify clicking 'Open' on any employee in the matrix switches to that employee's individual calendar.
- [ ] Verify filtering by department, branch, or employee name filters the matrix table correctly.
- [ ] Verify non-admin employees can only view their own attendance and receive 403 Forbidden on company-wide attendance queries.
- [ ] Verify clicking 'Download Excel' on Monthly Payroll toolbar downloads `Payroll_Export_All_Employees_YYYY_MM.xlsx`.
- [ ] Verify clicking 'Excel' on an employee's row downloads single-employee payroll spreadsheet.
- [ ] Verify Excel spreadsheet opens properly without corruption and contains valid headers, CTC, Basic, Gross, Deductions, LOP, and Net Pay.
- [ ] Verify exporting an empty month returns HTTP 404 with a clear message and does not crash or generate empty files.
- [ ] Verify draft unapproved payroll cannot be exported or viewed by non-admin/non-HR employees.

---

## 53. GLOBAL UI STANDARD: Universal Filter Toggle Button & Collapsible Panel Specification

### Overview & Visual Benchmark
- **Benchmark Source:** [Companies.tsx](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/pages/Companies.tsx#L5628) header filter toggle button.
- **Design Philosophy:** Complete visual and behavioral uniformity across all modules in Inhyma. All filter toggle buttons share identical colors, dimensions, borders, shadows, icons, and lifecycle behavior.

### Key Visual & Functional Specifications
1. **Design Tokens & Palette:**
   - **Default Background:** `#556987` (solid slate/navy).
   - **Hover Background:** `#475569`.
   - **Active/Toggled State:** Permanently `#556987`. It never turns bright blue (`#0284c7` or `#0061f2`) when active or open.
   - **Color / Fill:** `#ffffff`.
   - **Border:** `none`.
   - **Border Radius:** `6px`.
   - **Padding:** `8px 14px`.
   - **Box Shadow:** `0 2px 4px rgba(0, 0, 0, 0.1)`.
   - **Display:** `inline-flex; align-items: center; justify-content: center; cursor: pointer; transition: background 0.15s ease`.
2. **Dimension Standardization (Auto Box-Sizing):**
   - Removed all hardcoded square constraints (`width: 38px`, `height: 38px`, `height: 35px`, `min-width: 36px`, etc.).
   - Standardized box model: `width: auto !important; height: auto !important; min-width: unset !important; min-height: unset !important;`.
3. **Funnel Icon Standardization:**
   - Universal 16×16px SVG funnel polygon:
     ```html
     <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
       <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
     </svg>
     ```
4. **Clean Surface (Zero Badge Invariant):**
   - Buttons do NOT contain red notification badges, count pills (`activeFilterCount`), or indicator dots. The button preserves an identical visual footprint regardless of active filter count.
5. **Initial State (Collapsed / Off Invariant):**
   - Filter panels and drawers across all modules are strictly **off by default** (`useState(false)`). The user must explicitly click the funnel button to reveal filter fields.

### Modules Covered by Universal Standard
- **Contact:** `Companies.tsx`, `Suppliers.tsx`, `AgentsPage.tsx`, `FollowUpsPage.tsx`, `IndustrialZonesPage.tsx`, `LeadsPage.tsx`.
- **Inventory:** `ProductStockPage.tsx`, `StockAdjustmentPage.tsx`, `StockTransferPage.tsx` (header action bar with Funnel filter toggle, `+ ADD NEW`, golden-amber `Export` `.btn-imp-exp` button with download SVG icon, and `Bulk Actions ▾`), `ProductReorderPage.tsx`, `PriceListPage.tsx`, `masters/Products.tsx`.
- **Sales & Commercial:** `sales/SaleProcessList.tsx` (top header with `Including GST` toggle, Funnel filter toggle, `+ ADD NEW`, and golden-amber `Export` `.btn-imp-exp` button with download SVG icon), `sales/DiscountPaymentsPage.tsx`, `ProformaInvoicesPage.tsx`, `DeletedOrdersPage.tsx`.
- **Tasks & Engineering:** `technicalTasks/TechnicalTasksPage.tsx`.
- **Generic Masters:** `components/MasterPage.tsx` (applies to Brands, Categories, UOM, Taxes, Warehouses, Call Types, Buyer Types, etc.).

### Test Cases
- [ ] Verify navigating to any module page (e.g. `/product-stock`, `/stock-adjustment`, `/stock-transfer`, `/deleted-orders`, `/sales/process`, `/price-list`) renders the funnel filter button in `#556987`.
- [ ] Verify the filter button has rectangular padding (`8px 14px`) and is not forced into a square shape (e.g. 38x38px).
- [ ] Verify hovering over the filter button darkens the background to `#475569`.
- [ ] Verify clicking the filter button expands the filter drawer/panel and the button retains its `#556987` color (does NOT change to blue/cyan).
- [ ] Verify clicking the filter button again collapses the filter panel smoothly.
- [ ] Verify on a fresh page load or browser refresh, all filter panels start collapsed/off.
- [ ] Verify the filter button has no red number badge or indicator dot attached to it.
- [ ] Verify applying filters (date ranges, warehouse, sales person, status) updates the grid correctly.
- [ ] Verify clicking 'Reset Filters' clears inputs and restores all grid records.

---

## 54. GLOBAL UI STANDARD: Universal Page Header, 35px Action Button Standard, and Filter-Above-KPI Hierarchy Across All Modules

### 1. Architectural Motivation & Visual Alignment
To establish a cohesive, enterprise-grade user interface across the Inhyma ERP platform, all module pages must adhere to consistent geometry, button sizing, vertical flow hierarchy, and uncluttered headers:
- **Geometry & Spacing:** Global `.page` padding standardized to `12px 20px`, and `.page-header` bottom margin standardized to `16px`. This maximizes usable vertical viewport real estate while providing consistent breathing room.
- **Action Button Sizing:** Action buttons residing in `.page-header-actions` must strictly render at a uniform height of `35px`, a border radius of `6px`, semi-bold typography (`font-weight: 600`, `font-size: 13px`), and a uniform gap of `10px`.
- **Popover Isolation:** Dropdown action popovers (such as `+ Action` menus containing item links) inside `.page-header-actions` must have their internal menu buttons exempted from the 35px height rule so menu items render naturally without clipping or vertical distortion.
- **Filter-Above-KPI Layout Hierarchy:** In any module featuring high-level KPI cards and collapsible filter panels, the filter panel must be positioned vertically *above* the KPI cards. This aligns with natural operator workflow: operators configure filter criteria first (date ranges, warehouse, technician, status), and the summary KPI metrics immediately update in real-time below the filters.
- **Minimalist Header Presentation:** Subtitle descriptive text paragraphs (e.g., redundant explanations of what a screen does) are eliminated from primary headers (such as `/trash` and `/audit`) to achieve clean, high-density presentation.

### 2. Design Tokens & CSS Rule Specification
1. **Global Page Spacing (`src/index.css` & `src/styles/style.css`):**
   ```css
   .page {
     padding: 12px 20px;
   }
   .page-header {
     margin-bottom: 16px;
   }
   ```
2. **Standardized Header Action Buttons:**
   ```css
   .page-header-actions {
     display: flex;
     align-items: center;
     gap: 10px;
   }
   .page-header-actions > button,
   .page-header-actions > .btn,
   .page-header-actions > div > button:first-child {
     height: 35px !important;
     border-radius: 6px !important;
     font-size: 13px !important;
     font-weight: 600 !important;
     display: inline-flex;
     align-items: center;
     justify-content: center;
     padding: 0 14px !important;
     transition: all 0.15s ease-in-out;
   }
   ```
3. **Dropdown Menu & Popover Exemption Rule:**
   ```css
   .page-header-actions div[style*="absolute"] button {
     height: auto !important;
     justify-content: flex-start !important;
     padding: 8px 12px !important;
     font-size: 13px !important;
     font-weight: 400 !important;
   }
   ```

### 3. Filter-Above-KPI Modules Verified
The following modules strictly implement the Filter-Above-KPI structure:
- **Payments Module (`PaymentsPage.tsx`):** Filter panel -> Financial KPI Cards (`TOTAL PAYMENT`, `PAID`, `DUE`) -> Pending/Completed Tabs -> Data Grid.
- **Sale Process (`sales/SaleProcessList.tsx`):** Filter panel -> Pipeline Summary Metric Cards -> Tabs -> Orders Grid.
- **Price List (`PriceListPage.tsx`):** Filter panel -> Currency & Pricing Metrics -> Price Table.
- **Import Purchase (`ImportPurchasePage.tsx`):** Filter panel -> Consignment Pipeline Metric Cards -> Tabs -> Consignment Grid.
- **Product Stock (`ProductStockPage.tsx`):** Filter panel -> Valuation & Reorder Metric Cards -> Warehouse Stock Table.
- **Discount Payments (`sales/DiscountPaymentsPage.tsx`):** Filter panel -> Discount Summary Cards -> Discount Approvals Grid.
- **Technical Tasks (`technicalTasks/TechnicalTasksPage.tsx`):** Filter panel -> Ticket Volume KPI Cards -> Status Tabs -> Service Tickets Grid.

### 4. QA Verification Test Cases
- [ ] Verify navigating to `/trash` renders the title without any explanatory subtitle paragraphs, and the `Empty Trash` button conforms to 35px height.
- [ ] Verify navigating to `/audit` renders the title cleanly without subtitle text, and action buttons adhere to 35px height.
- [ ] Verify navigating to `/payments`, `/sales/process`, `/price-list`, `/import-purchases`, and `/product-stock` renders the filter panel *above* the KPI summary cards.
- [ ] Verify opening a dropdown action menu inside `.page-header-actions` displays menu items with natural height and left alignment, without 35px stretching.
- [ ] Verify clicking filter inputs or toggling filter drawers does not cause horizontal or vertical jitter on the KPI cards or table header.

---

## 55. PAYMENTS: Customer & Supplier Payments Engine, Cash Flow, and Technician Payment Handover

### 1. Module Overview & Routing
- **Route:** `/payments`
- **Navigation Placement:** Direct Topbar navigation access under Tasks (`/payments`).
- **Core Functionality:** Dedicated field service and commercial collections interface enabling finance managers to track real-time payments collected by field technicians, pending balances, and overdue accounts.

### 2. High-Impact Financial KPI Summary Cards
Positioned directly underneath the collapsible filter panel, these three metric cards provide instantaneous cash flow visibility:
1. **TOTAL PAYMENT:** Cumulative monetary amount of all billable tickets within current filter scope.
2. **PAID:** Total payment collected and verified from customers.
3. **DUE:** Outstanding balance remaining across pending and overdue service calls.

### 3. Filter & Search Controls
- **Funnel Filter Toggle:** Standard `#556987` button (8×14px padding, badge-less, default collapsed).
- **Available Filters:**
  - Date Range (`date_from`, `date_to`)
  - Technician Picker (`task_allotted_to`)
  - Payment Status (`pending`, `completed`)
  - Service Type & Call Type
  - City & Third-Party City
  - Priority (`low`, `medium`, `high`, `urgent`)
  - Global Text Search (Customer name, ticket ID, phone)
- **Live Reactivity:** Adjusting any filter recalculates KPI metrics and refetches matching records from `GET /api/v1/technical-tasks/payment-summary` and `GET /api/v1/technical-tasks`.

### 4. Technician Payment Collection Modal
- **Trigger:** Clicking `Record Payment` or the collection icon on any pending ticket row.
- **Fields:**
  - **Payment Amount** (*Required*): Pre-filled with outstanding balance, allows partial or full payment entry.
  - **Payment Mode** (*Required*): Dropdown (`Cash`, `UPI`, `NEFT/RTGS`, `Cheque`).
  - **Reference / Transaction ID**: Bank transaction number, UTR number, or cheque number.
  - **Payment Date** (*Required*): Date and timestamp of collection.
  - **Payment Screenshot / Receipt Upload**: Uploads proof image (JPG, PNG) or PDF voucher via `POST /api/v1/technical-tasks/upload-screenshot`.
- **Atomic Submission:** Submits to `POST /api/v1/technical-tasks/{id}/record-payment`, automatically logs an immutable call log entry in the audit trail, updates payment collection status to `completed`, and moves the ticket from the Pending tab to the Completed tab.

### 5. Zero-Synthetic Data Policy Compliance
- Fully sanitized production database: all 18 mock QA generation scripts purged.
- Preserves authentic corporate users (User A, User B, User C, User D) and actual customer organizations.
- Ensures all financial KPIs reflect authentic business transactions.

### 6. QA Verification Test Cases
- [ ] Verify navigating to `/payments` renders the 3 KPI summary cards (`TOTAL PAYMENT`, `PAID`, `DUE`) with formatted INR currency (`₹`).
- [ ] Verify clicking the Funnel filter button expands the filter drawer directly above the KPI cards.
- [ ] Verify selecting a date range or technician updates the KPI cards and table without page reload.
- [ ] Verify switching between 'Pending' and 'Completed' tabs filters records appropriately.
- [ ] Verify clicking 'Record Payment' opens the payment modal with the due amount pre-populated.
- [ ] Verify entering valid payment details and uploading a screenshot records the transaction and moves the record to Completed.
- [ ] Verify attempting to record payment without required fields triggers validation messages.

---

## 56. CRM: Customer Relationship Management Full Suite

### Overview & Route Mapping
- **Primary Routes:** `/crm/leads`, `/crm/import`, `/crm/pipeline`, `/crm/distribution`.
- **Primary Permissions:** `crm.leads.view`, `crm.leads.create`, `crm.leads.edit`, `crm.leads.delete`, `crm.leads.assign`, `crm.import`, `crm.pipeline.manage`, `crm.quotation.create`.
- **Purpose:** Full lifecycle CRM covering lead ingestion via multi-column CSV import, dynamic multi-stage Kanban pipeline with drag-and-drop, rule-based round-robin salesperson lead distribution, 360° lead timeline with follow-ups synced to workforce tasks, and branded quotation PDF generation.

### Key Visual & Functional Components
1. **Interactive Kanban Pipeline & List Views (`/crm/leads`):**
   - **Kanban Board:** Multi-column view organized by dynamic pipeline stages with real-time lead counts and monetary totals. Supports smooth HTML5 drag-and-drop card transitions between stages with optimistic UI updates and instant server persistence (`PATCH /api/v1/crm/leads/{id}/stage`).
   - **List Grid:** 12-column sortable data grid featuring Lead Title, Company, Contact Person, Phone, Email, Salesperson, Stage, Value, Priority, and Created Date.
   - **Lead Drawer Detail View:** 360° timeline capturing interaction history, call logs, notes, stage transitions, and linked quotations.
   - **Company Master Linkage:** Dynamic typeahead search links leads directly to existing customer records in `companies` table, or auto-provisions new customer entries upon lead qualification.
   - **Workforce Task Synchronization:** Creating a follow-up date and reminder in CRM automatically provisions a synchronized operational task in the Workforce Task queue (`tasks` table) assigned to the respective sales representative.
2. **Dynamic Pipeline Configuration (`/crm/pipeline`):**
   - Customizable sales funnel stages with drag re-ordering, custom HEX color picker, win probability percentage (0–100%), and terminal status flags (`Won`, `Lost`).
   - Protected system stages with delete prevention on stages hosting active leads.
3. **Lead CSV Import Engine (`/crm/import`):**
   - 4-phase import workflow: File Upload ➔ Auto-Column Mapping ➔ Pre-Import Validation Preview ➔ Batch Ingestion.
   - Configurable deduplication rules: detects duplicate phone numbers, emails, or company names with selectable action (`Skip`, `Overwrite`, `Create Duplicate`).
   - Batch audit history log detailing successful imports, validation errors, and downloadable error CSVs.
4. **Salesperson Distribution & Quotas (`/crm/distribution`):**
   - Round-robin lead routing rules distributing incoming leads proportionally across active sales reps based on capacity and target quotas.
   - Live workload dashboard displaying active, won, and lost lead counts per sales representative.
5. **Branded Quotation Generation Engine:**
   - Multi-item quotation creation modal with Product Master autocomplete, unit pricing, quantity, commercial discount %, HSN tax calculation (CGST/SGST/IGST), and total value.
   - Configurable commercial terms: payment terms, delivery period, warranty terms, and validity date.
   - Server and client PDF generation (`quotationPdf.ts`, `quotation_pdf.py`) with corporate logo, bank transfer details, and authorized signature.

### QA Verification Test Cases
- [ ] Verify navigating to `/crm/leads` displays the Kanban board with dynamic pipeline stages, lead counts, and monetary totals.
- [ ] Verify dragging a lead card between Kanban columns updates its stage on the backend without visual glitches.
- [ ] Verify switching to the List view renders the 12-column table with sorting, search, and salesperson filters.
- [ ] Verify opening a lead opens the detail drawer with the full activity timeline, call logs, and linked quotations.
- [ ] Verify scheduling a follow-up in CRM creates a corresponding linked task in `/tasks`.
- [ ] Verify navigating to `/crm/import` allows uploading a CSV and auto-maps columns.
- [ ] Verify importing a CSV with duplicate leads flags conflicts according to the chosen deduplication strategy.
- [ ] Verify navigating to `/crm/pipeline` allows adding, editing, and re-ordering pipeline stages.
- [ ] Verify navigating to `/crm/distribution` displays salesperson lead allocation quotas and distribution rules.
- [ ] Verify generating a quotation for a lead creates an itemized quotation and downloads the branded A4 PDF.

---

## 57. WORKFORCE: Recurring Tasks Scheduling Engine

### Overview & Route Mapping
- **Primary Routes:** `/tasks` (Recurring tab), `/tasks/calendar`, `/tasks/kanban`.
- **Primary Permissions:** `task.view`, `task.create`, `task.edit`, `task.delete`, `task.recurring.manage`.
- **Purpose:** Automation engine for scheduled, repeating operational workforce tasks (daily machine maintenance, weekly stock reconciliation, monthly customer outreach, audit compliance) with automated ticket spawning, pause/resume, and archival lifecycles.

### Key Visual & Functional Components
1. **Recurring Schedule Sub-Tab (`/tasks`):**
   - Dedicated **Recurring** sub-tab alongside My Tasks, Kanban, and Calendar.
   - Displays all active, paused, and archived recurring task definitions with title, assignee, frequency rule, next run date, and status.
2. **Recurring Schedule Modal (`RecurringScheduleModal.tsx`):**
   - **Frequency Options:**
     - **Daily:** Every N days, or weekdays only.
     - **Weekly:** Specific days of the week (Monday through Sunday).
     - **Monthly:** Specific day of the month (e.g. 1st or 15th), or relative day (e.g. last Friday).
     - **Custom Interval:** Every X days/weeks/months.
   - **Execution Window:** Start Date, optional End Date, or maximum occurrences limit.
   - **Task Template Attributes:** Priority, category, estimated duration, checklist items, and default assignee.
3. **Automated Spawning & Lifecycle Worker (`recurring_worker.py`, `recurring_calculator.py`):**
   - Background scheduler checks active recurring schedules and automatically spawns fresh task instances when the next execution timestamp arrives.
   - Pause / Resume controls toggle schedule activity without deleting history.
   - Archiving safely retires schedules while preserving all previously spawned task tickets.

### QA Verification Test Cases
- [ ] Verify navigating to `/tasks` shows the **Recurring** sub-tab.
- [ ] Verify clicking 'Create Recurring Schedule' opens the modal with frequency options (Daily, Weekly, Monthly, Custom).
- [ ] Verify configuring a weekly recurring task calculates the next run timestamp accurately.
- [ ] Verify saving the recurring schedule lists it in the Recurring tasks table.
- [ ] Verify pausing an active recurring schedule stops automated ticket generation.
- [ ] Verify resuming a paused schedule re-calculates the next run date.
- [ ] Verify archiving a recurring schedule moves it to the archived filter while keeping past spawned tasks intact.

---

## 58. PROFORMA INVOICES: Connected Address Automation, Expected Delivery Date Future Validation, and Slide-Over Add Company & Edit Address Drawers

### Overview & Route Mapping
- **Primary Routes:** `/proforma-invoice/list`, Proforma Add/Edit Modal (`ProformaInvoicesPage.tsx`).
- **Primary Permissions:** `proforma.view`, `proforma.create`, `proforma.update`, `proforma.delete`.
- **Purpose:** Accelerated sales ordering with automated billing/shipping company address resolution, inline slide-over drawer editing for custom address overrides, inline new company creation, and delivery date scheduling guards.

### Key Visual & Functional Components
1. **Expected Delivery Date (`expected_delivery_date`):**
   - Renders in the primary Proforma modal form header.
   - Automatically initializes to current date (`todayIso`).
   - Strict Date Validation: Only current or future dates are permitted (`min={todayIso}`). Past dates in the datepicker are locked out, preventing operators from booking backdated delivery commitments.
2. **Connected Company & Address Cards:**
   - Selecting a company in Billing Address or Shipping Address dropdown dynamically extracts that company's address details.
   - Automatically populates and visually renders the respective Address card (Address lines, City, State, Pincode, Phone, Email, and GSTIN).
3. **Slide-Over "Add Company" Drawer (`AddCompanyDrawer.tsx`):**
   - Clickable `+ Add` button placed adjacent to company selection.
   - Opens right-side slide-over drawer allowing operators to quickly register a new company (Customer/Supplier/Both) with contact, tax, and address fields.
   - Form submission lifecycle is strictly guarded with `saving` state (`setSaving(true)` with `try / finally { setSaving(false) }`), disabling double-clicks and rendering `"Saving..."` on the action button while creating the company.
   - Automatically selects the newly created company in the Proforma invoice upon save without requiring a page reload.
4. **Slide-Over "Edit Address" Drawer (`EditAddressDrawer.tsx`):**
   - Clickable `Edit` action button inside both the Billing and Shipping address preview cards.
   - Opens right-side slide-over drawer prefilled with active address fields (Address lines 1 & 2, City, State, Pincode, GSTIN).
   - Saving the drawer updates the specific Proforma Invoice address state without modifying the master company catalog.
5. **Horizontal & Vertical Overflow:**
   - Integrated side scrollbar handling on large proforma item grids and complex address cards.

### QA Verification Test Cases
- [ ] Verify opening the Proforma Invoice Add modal shows `Expected Delivery Date` defaulting to the current date.
- [ ] Verify the date picker for Expected Delivery Date disables all past dates and allows only today or future dates.
- [ ] Verify selecting a company in Billing Address dynamically renders the Billing Address card with that company's address and GSTIN.
- [ ] Verify selecting a company in Shipping Address dynamically renders the Shipping Address card with that company's address and GSTIN.
- [ ] Verify clicking `+ Add` next to company dropdown opens `AddCompanyDrawer`.
- [ ] Verify creating a company via `AddCompanyDrawer` automatically populates it in the Proforma form.
- [ ] Verify clicking `Edit` on the Billing Address card opens `EditAddressDrawer` with pre-filled address details.
- [ ] Verify modifying address fields in `EditAddressDrawer` and saving updates the Proforma Invoice address card correctly.
- [ ] Verify saving the Proforma Invoice preserves the custom edited address and expected delivery date.

---

## 59. LOCAL PURCHASE: Unit Landing Rate (INR) (VB) Renaming, Side Scrollbar, and Confirmed Order Delete Protection

### Overview & Route Mapping
- **Primary Routes:** `/purchase-order/local-purchase`, `/purchase-order/local-purchase/addedit/:id`, `/purchase-order/local-bill/:id`.
- **Primary Permissions:** `purchase.local.view`, `purchase.local.create`, `purchase.local.edit`, `purchase.local.delete`, `purchase.local.confirm`.
- **Purpose:** Enhanced landing cost clarity, grid navigation ergonomics, and critical audit protection prohibiting accidental deletion of confirmed commercial inventory receipts.

### Key Visual & Functional Components
1. **Landing Rate Column Renaming:**
   - Renamed table column and PDF field from `Unit Landing Rate (INR)` to **`Unit Landing Rate (INR) (VB)`** across list grid, edit forms, and generated PDF purchase orders.
   - Clarifies for procurement officers that line landing rates reflect Value-Based expense allocation.
2. **Side Scrollbar Support:**
   - Implemented horizontal side scrollbar styling on the purchase table and items container, enabling smooth navigation on multi-column layouts without layout clipping.
3. **Confirmed Order Delete Lockout:**
   - **Frontend UI Suppression:** In `LocalPurchasePage.tsx`, rows where status equals `Confirmed` strictly hide the `Delete` option from the row action dropdown menu (`⋮`).
   - **Backend Guard:** `DELETE /api/v1/purchase/local-orders/{id}` verifies status; if the order is already in `confirmed` status, it rejects the deletion with HTTP 400 Bad Request ("Confirmed purchase orders cannot be deleted").

### QA Verification Test Cases
- [ ] Verify navigating to `/purchase-order/local-purchase` displays column header `Unit Landing Rate (INR) (VB)`.
- [ ] Verify generating or downloading a Local Purchase Order PDF shows the `Unit Landing Rate (INR) (VB)` label.
- [ ] Verify the table container features a functioning horizontal side scrollbar when columns exceed the viewport width.
- [ ] Verify on a purchase order in `Pending` status, the action menu (`⋮`) displays the `Delete` option.
- [ ] Verify on a purchase order in `Confirmed` status, the action menu (`⋮`) strictly hides the `Delete` option.
- [ ] Verify sending a raw DELETE API request for a confirmed purchase order returns HTTP 400 with an error message preventing deletion.

---

## 60. FEED & BROADCAST: Enterprise Timeline, Department & Role Scoping, Interaction Privacy & Reactions

### Overview & Route Mapping
- **Primary Routes:** `/feed`, Topbar/Sidebar navigation link.
- **Primary Permissions:** `feed.view`, `feed.create`, `feed.broadcast`, `feed.comment`, `feed.react`, `feed.moderate`.
- **Purpose:** Centralized internal corporate communication channel supporting organization-wide broadcasts, targeted department feeds, interactive emoji reactions, comment threads, and role-based privacy safeguards.

### Key Visual & Functional Components
1. **Interactive Timeline & Post Composer (`FeedComposer.tsx`):**
   - Rich post composer allowing authorized users to publish text updates, announcements, and critical notices.
   - Pinned Announcements: High-priority broadcasts pinned to the top of the feed with distinct visual badge styling.
2. **Granular Audience Targeting:**
   - **Public / All Company:** Visible to all active personnel across all branches.
   - **Department Scoping (`feed_post_departments`):** Restricts post visibility exclusively to designated departments (e.g. Sales, Service, Operations, Finance).
   - **Direct Recipients (`feed_post_recipients`):** Confidential broadcasts targeted to specific individuals.
3. **Reactions & Comment Threading (`FeedPostCard.tsx`):**
   - Multi-reaction emoji picker (👍, ❤️, 🎉, 🚀, 💡, 👏) with live reaction counters.
   - Interaction privacy: users can view aggregated counts and inspect reaction participants based on permissions.
   - Nested comment threads with real-time updates and edit/delete permissions for authors and moderators.
4. **Read Receipts & Delivery Tracking (`feed_post_reads`):**
   - Tracks which users have viewed broadcasts for corporate accountability and compliance announcements.

### QA Verification Test Cases
- [ ] Verify navigating to `/feed` loads the company feed timeline with pinned posts at the top.
- [ ] Verify creating a post in `FeedComposer` publishes it to the timeline.
- [ ] Verify publishing a post targeted to a specific department is visible only to members of that department.
- [ ] Verify reacting to a post with an emoji updates the reaction count in real-time.
- [ ] Verify adding a comment displays it immediately under the post.
- [ ] Verify editing and deleting a post is restricted to the post creator or system administrators.
- [ ] Verify read status is recorded in `feed_post_reads` when an operator views a broadcast.

---

## 61. DYNAMIC BRAND LOGO: Real-Time Sidebar Branding from ERP Organization Settings

### Overview & Route Mapping
- **Primary Routes:** `/organization` (ERP Settings), Global AppShell Sidebar (`AppShell.tsx`).
- **Primary Permissions:** `organization.manage`, Public Authenticated.
- **Purpose:** Seamless corporate white-labeling and visual personalization. Eliminates hardcoded placeholder branding (`/logo.png`) by dynamically resolving the active organization's uploaded company logo in the sidebar header with real-time multi-tab propagation.

### Key Visual & Functional Components
1. **Dynamic Brand Logo Resolution (`brand.ts` & `AppShell.tsx`):**
   - On application mount, `AppShell` queries `resolveBrandInfo()` to fetch the active organization profile.
   - Extracts `logo_data` (Base64 data URI) or `logo_url` (Supabase storage URL).
   - Sidebar header renders `<img src={resolveImageUrl(brandLogo) || "/logo.png"} alt="IHM Logo" ... />`.
   - Built-in `onError` event handler: if an image URL fails to load or network error occurs, it gracefully falls back to `/logo.png` with zero visual breakage.
2. **Real-Time Cross-Tab Subscription (`subscribeBrandLogo`):**
   - Whenever an administrator uploads and saves a new company logo in **ERP Settings &rarr; Organization**, `setBrandLogo()` emits a localized window event (`ihm_brand_logo_changed`).
   - The AppShell sidebar listens to this event via `subscribeBrandLogo(setBrandLogo)`, immediately updating the logo in the sidebar header across all active browser windows and tabs without requiring an application reload.

### QA Verification Test Cases
- [ ] Verify that opening any ERP page renders the active organization's custom company logo in the sidebar header.
- [ ] Verify that navigating to `/organization`, uploading a new company logo, and clicking `Save Changes` immediately updates the sidebar header logo in real-time.
- [ ] Verify that if an invalid or unreachable image URL is returned, the sidebar logo falls back gracefully to `/logo.png`.
- [ ] Verify that opening a second browser tab and changing the logo in the first tab updates the second tab's sidebar header immediately.

---

## 62. PRODUCT MASTER: Category Display Rewiring, Machine Spares Linkage, and Floating Duplicate Overlay Dropdown

### Overview & Route Mapping
- **Primary Routes:** `/masters/products` (Product Master Catalog), `/masters/products/machine-spares/:machineId`.
- **Primary Permissions:** `product.view`, `product.create`, `product.update`, `product.delete`.
- **Purpose:** High-precision taxonomy representation in the master catalog, direct machine-to-spare navigation, deduplicated drawer specifications, and non-disruptive floating duplicate warnings.

### Key Visual & Functional Components
1. **Dynamic Category Column Rewiring (`Products.tsx`):**
   - Catalog table category column displays the real-time **Category** name (`getCategoryNameForProduct(p)`) rather than hardcoded machine/spare badges.
   - Preserves intelligent machine detection: for products whose category represents machinery, the badge renders with interactive cursor styling (`cursor-pointer`) and click-to-view machine spare parts compatibility matrix.
2. **SideDrawer Specification Deduplication:**
   - Identity & Classification section in `Product View SideDrawer` cleanly renders a single unified Category and Sub-Category row, eliminating duplicate field rendering.
3. **Floating Duplicate Name Suggestion Dropdown:**
   - Transformed previously disruptive inline warning blocks into a sleek floating dropdown popover (`absolute left-0 right-0 top-full mt-1 z-30`).
   - Renders directly beneath the Product Name input during typing with matching score badges (e.g. `95% match`) and 1-click preview link to inspect existing records.

### QA Verification Test Cases
- [ ] Verify navigating to `/masters/products` displays the actual category name in the CATEGORY column for each product.
- [ ] Verify clicking on a machine category badge opens the dedicated Machine Spare Parts viewer.
- [ ] Verify opening the Product View SideDrawer displays exactly one Category and Sub-Category specification row.
- [ ] Verify creating a new product and typing a name similar to an existing product displays a floating dropdown overlay with similarity percentage, without shifting or distorting adjacent form fields.

---

## 63. PLATFORM STABILITY: Database Migration Idempotency, Notification Polling Engine, and Multi-ERP Identity Hardening

### Overview & Route Mapping
- **Primary Routes:** Topbar Notification Bell (`/api/v1/notifications/unread-count`), Central SSO Handover (`/auth/sso-handover`), Alembic Migrations (`backend/alembic`).
- **Primary Permissions:** System / Multi-ERP Ecosystem.
- **Purpose:** Production startup resilience on cloud hosting (Render), background notification poller stability, and robust SSO identity federation across ERP spokes.

### Key Visual & Functional Components
1. **Idempotent Alembic Migrations (`s4d5e6f7a8b9`, `t5e6f7a8b9c0`):**
   - Wrapped DDL executions with `sa.inspect(bind)` and `if not insp.has_table(...)` guards.
   - Prevents `psycopg2.errors.DuplicateTable: relation "feed_post_departments" already exists` crashes during Render zero-downtime rolling deploys.
2. **Notification Unread Count Poller (`/notifications/unread-count`):**
   - High-efficiency `GET /api/v1/notifications/unread-count` endpoint executing indexed SQL count for the authenticated user.
   - Satisfies frontend topbar notification poller, eliminating repeated HTTP 404 console errors.
   - Supports both `PATCH` and `POST` methods on `/api/v1/notifications/{id}/read`.
3. **Throttled Profile Sync & Ecosystem Key Hardening:**
   - Implemented `Auth.shouldSyncProfile()` with 60-second cooldown in `auth.ts`, eliminating `TypeError: Auth.shouldSyncProfile is not a function`.
   - Standardized canonical ERP key matching in `erp_keys.py`, cleanly normalizing `inhyma-erp` and `inhyma` without spurious authorization denials.
   - Secured `<EcosystemSwitcher currentKey="inhyma" />` and `enforceCentralLanding("inhyma")` in Inhyma AppShell.

### QA Verification Test Cases
- [ ] Verify running database migrations on an existing production database succeeds without `DuplicateTable` exceptions.
- [ ] Verify the browser developer console shows zero 404 errors during topbar notification bell background polling.
- [ ] Verify marking a notification as read via both PATCH and POST returns HTTP 200.
- [ ] Verify loading the application mount executes `Auth.shouldSyncProfile()` cleanly without JavaScript console errors.
- [ ] Verify switching between ERPs in the Ecosystem Switcher navigates seamlessly without session loss.

---

## 64. SALE: Sales Process Add New Form (Full Parity with Proforma, Dynamic Masters, Exceeded Stock Alerts, Grey-Locked Cells & Drawers)

### Overview & Route Mapping
- **Primary Routes:** `/sales/process/add` (Add Sales Order), `/sales/process/edit/:id` (Edit Sales Order), `/sale-order/add`, `/sale-order/addedit`, `/sale-order/addedit/:id`.
- **Primary Permissions:** `saleorder.view`, `saleorder.create`, `saleorder.update`.
- **Purpose:** Full feature alignment between Sales Process Add New and Proforma Invoices Add New. Real-time warehouse-aware stock checks, automated tax calculation, entity drawers, grey locked calculation cells, standardized commercial terms, and default status `pending`.

### Key Visual & Functional Components
1. **General Details Card (4-Column Grid):**
   - **Row 1:** Warehouse * (Combobox with dynamic DB master lookup `/masters/warehouses`), Expected Delivery Date (DatePicker with `minDate="today"` and past-date validation), Payment Terms * (Combobox `/masters/payment-terms`), Sales Person * (Combobox populated with dynamic team members and logged-in user).
   - **Row 2:** Transport Name * (Combobox `/masters/transports`), Third Party Delivery * (Combobox `Yes`/`No` with optional attachment upload when `Yes`), PO (Client Purchase Order `Yes`/`No` with file upload).
   - **Row 3:** Transport Destination (text input), Delivery Type * (Combobox), Delivery Charge * (Combobox). Automatically hidden when Transport Name is `Self Pickup` / `Self Pick-up`.
   - **Container / Consignment Allocation:** Appears dynamically when warehouse is `Transit` or `Ordered` (e.g. `Mumbai Transit`), pre-loading available consignments.
2. **3 Entity Cards (Company, Billing Address, Shipping Address):**
   - **Company Card:** `ClientNameAutocomplete` with real-time company search, clear (trash) button, `+ Add` button opening `AddCompanyDrawer`, and detailed info card displaying Company Name, Business Type (`B2B`/`B2C`), and GST No.
   - **Billing Address Card:** Formatted address card with pencil edit button opening `EditAddressDrawer` in edit mode; or text input with clear and `+ Add` button opening `EditAddressDrawer` in add mode.
   - **Shipping Address Card:** Formatted address card with pencil edit button opening `EditAddressDrawer`; or text input with clear and `+ Add` button opening `EditAddressDrawer` in add mode.
3. **Product Search Card:**
   - Real-time stock catalog lookup (`/inventory/product-stock?limit=500`) specific to the selected warehouse (`mumbai`, `ahmedabad`, `indore`, etc.).
   - Displays Product Name, Product Code, Available Qty, and Standard Price.
   - Auto-resolves HSN via `getAutoHsnForProduct()` and tax rate via `resolveGstPercent()` from `/masters/taxes`.
   - Selecting a product adds it to the item table directly above additional charges.
4. **Product Item Table Card:**
   - **Grey Locked Calculated Cells (`#f8fafc`):** ReadOnly cells for HSN, Taxable Amount, GST %, GST Amount, and Total, dynamically computed using `(unit_price - unit_discount) * quantity`.
   - **Stock Exceeded Alerts & Highlighting:** Top warning banner (`data-testid="alert-exceeded-stock"`), in-table warning banner, red border & background on Qty input, `Qty: ... ⚠️ Exceeds Available!` red badge, and blur toast alerts.
   - **Serial Number Modal:** `🔢 S/N` button on each product row opening modal to record comma/line-separated serial numbers.
   - **Additional Charges:** `[✓] Additional Charges` checkbox (`data-testid="checkbox-additional-charges"`) with standard default rows (Transport Charges HSN 996511 and Packing & Forwarding HSN 996713) and upward-opening Comboboxes (`placement="up"`).
   - **Table Summary Bar (`<tfoot>`):** Total Qty, Total Taxable (green), Total Tax (red), and Total With Tax (bold).
   - `+ Add Product Row` and `+ Add Charge Row` buttons.
5. **Bottom Section & Totals Summary:**
   - **Terms and Conditions:** Pre-filled with standard 3 terms (1. Transport Charges: To Pay. 2. Payment Terms: 100% Before Dispatch. 3. Order once confirmed, cannot be cancelled.).
   - Remarks and Booking Remarks textareas.
   - **Totals Breakdown Card:** Total Basic, Total Discount, Total Taxable Amount, Total Tax, Total Including Tax, and Indian currency words (e.g. `Amount In Words: ... Rupees Only`).
   - **Submit Action:** Blue button validating all required fields, ensuring unit discount does not exceed unit price, and assigning default status `"pending"`. Synchronizes payload with `buyer_name`, `company_name`, `transport_name`, `transporter_name`, `expected_delivery_date`, `delivery_date`, `city`, and `state`.

### QA Verification Test Cases
- [ ] Verify navigating to `/sales/process/add` renders the Add Sales Order form with header, `← BACK` button, and `Submit` button.
- [ ] Verify Warehouse, Payment Terms, Transport Name, Delivery Type, Delivery Charge, and Additional Charge dropdowns populate dynamically from database masters (`/masters/*`) and option lookup endpoints without hardcoded static lists.
- [ ] Verify selecting `Self Pickup` as Transport Name hides Row 3 (Destination, Delivery Type, Delivery Charge) and bypasses validation for delivery type and charge.
- [ ] Verify searching for a company via `ClientNameAutocomplete` populates Company, Billing Address, and Shipping Address cards with business type and GST details.
- [ ] Verify clicking the pencil edit button on Billing or Shipping Address opens `EditAddressDrawer` and updates the formatted address upon save.
- [ ] Verify searching a product in Product Search filters by name and displays real-time available stock for the selected warehouse.
- [ ] Verify selecting a product populates the table row with auto-resolved HSN, standard price, and GST %, and locks HSN, Taxable Amount, GST %, GST Amount, and Total cells as readOnly.
- [ ] Verify entering a quantity greater than available stock displays the top alert banner, red Qty input border, red badge, and blur toast warning.
- [ ] Verify toggling `Additional Charges` checkbox hides/shows additional charge rows and dynamically recalculates summary totals.
- [ ] Verify clicking `Submit` without filling required fields highlights missing fields in red with descriptive error messages.
- [ ] Verify successfully submitting a new order assigns `status: "pending"` by default and redirects to `/sales/process`.
- [ ] Verify `order_date` and `delivery_date` are sent and parsed as standard ISO string dates (`YYYY-MM-DD`) ensuring compatibility with PostgreSQL `asyncpg` `VARCHAR(50)` columns.
- [ ] Verify order creation foreign keys (`buyer_id`, `created_by_id`, `organization_id`) link cleanly without metadata table registration errors (`NoReferencedTableError`).
- [ ] Verify the stock enforcement rule from `Sales & PI Process.docx`: Ordered and Transit warehouses permit negative stock during order generation, whereas physical warehouses (e.g. Mumbai, Ahmedabad, Indore) strictly block orders that exceed available stock with an informative HTTP 409 Conflict toast (`Not enough stock of '...' in ...`).

---

## 65. SALE: Sales Process Live KPI Metrics & Status Tabs Dynamic Calculation Engine

### Overview & Route Mapping
- **Primary Route:** `/sales/process` (Sales Order List / Sales Process).
- **Primary Permissions:** `saleorder.view`.
- **Purpose:** Provide live, real-time KPI metrics and status tab counts reflecting the actual sales orders in the database. Resolves previous static/zero counts and amounts, ensuring accurate financial overview and instant status breakdown.

### Key Visual & Functional Components
1. **Top 6 KPI Summary Cards:**
   - **ALL:** Total count and sum of all active, non-deleted sales orders (`₹ [Amount] ([Count])`).
   - **ADMIN CONFIRMED TO LR:** Total count and sum of orders in progress across statuses `sales_confirmed`, `admin_approved`, `acc_confirmed`, `gatepass_created`, `dispatched`, and `lr`.
   - **PENDING:** Count and amount of newly generated orders awaiting initial sales confirmation.
   - **ADMIN APPROVED:** Count and amount of orders approved by management awaiting accounting confirmation.
   - **LR:** Count and amount of orders that have received Lorry Receipt (LR) tracking.
   - **CANCELLED:** Count and amount of cancelled orders.
2. **Interactive Filtering on KPI Cards:**
   - Clicking on any KPI card activates it as the active filter, dynamically narrowing the orders table to matching records with visual active card highlight (`border: 2px solid #0061f2`).
3. **10 Status Tabs with Dynamic Badges:**
   - Tabs: `All`, `Pending`, `Sales Confirmed`, `Admin Approved`, `Acc. Confirmed`, `Gatepass Created`, `Dispatched`, `Gatepass Cancelled`, `LR`, `Cancelled`.
   - Each tab renders a badge with the exact count of orders matching that status.
   - Clicking a status tab filters the orders list and persists the selected tab in `sessionStorage("sales_process_active_tab")`.
4. **Including GST Toggle:**
   - Switch toggle in the header (`Including GST`).
   - When enabled (default): Amounts display GST-inclusive figures (`amount_inc_gst` / `total_amount`) and the table header displays `Amount (Inc.GST)`.
   - When disabled: Amounts display basic figures (`total_basic`) and the table header switches to `Amount (Ex.GST)`.
   - Flips both KPI card amounts and table column amounts dynamically.
5. **Dual-Tier Resilient Architecture:**
   - **Backend Aggregation:** `GET /api/v1/sales/orders` calculates full-database aggregates via `SaleRepository.get_metrics(...)` with role visibility constraints (`warehouses`, `exclude_statuses`).
   - **Frontend Fallback:** If offline or during initial data streaming, `computeMetricsFromOrders(orderList, incGst)` dynamically computes metrics from loaded records to prevent displaying zero values.
6. **Action Menu Stage Isolation for Pending Orders:**
   - When order status is `pending`, clicking the 3-dots (`⋮`) action button displays **only** three actions: `Edit`, `SO Files`, and `Delete`.
   - Actions for downstream stages (`Print SO (Pricing)`, `Warehouse SO (No Pricing)`, `Gate Pass PDF`, `Download Gate Pass`, and `Send LR to Client`) are suppressed until the order moves beyond the pending stage.
7. **"Upload Files" Slide-Over Drawer on SO Files Action:**
   - Clicking `SO Files` opens the dedicated `<SideDrawer width="400px">` titled **"Upload Files"**.
   - Contains top green action banner **`Check All Upload Files`** (`#dcfce7`) with info badge `ⓘ` allowing users to preview all existing order attachments.
   - Contains **PO File** form field with native file chooser.
   - Pinned full-width blue **Submit** button (`#0061f2`) saving the file, updating local state with PO attachment indicators, and showing a success toast.
8. **Action Menu Stage Isolation for Sales Confirmed Orders:**
   - When order status is `sales_confirmed`, clicking the 3-dots (`⋮`) action menu displays **only** four actions:
     * `Edit`: Navigates to `/sales/process/edit/:id` for modifying the sales order.
     * `SO Files`: Opens the "Upload Files" slide-over drawer for PO attachments.
     * `Cancel`: Prompts confirmation and directly cancels the order, moving it to the Cancelled status.
     * `Delete`: Prompts confirmation and deletes the order.
   - Downstream actions (`Print SO (Pricing)`, `Warehouse SO (No Pricing)`, `Gate Pass PDF`, `Download Gate Pass`, and `Send LR to Client`) are suppressed until the order moves to downstream stages (`admin_approved` and beyond).
9. **Direct Status Transition on Cancel Action:**
   - Clicking **Cancel** on a `Sales Confirmed` order transitions its status immediately to `cancelled` via `PATCH /sales/orders/{id}/status`.
   - Directly navigates to the **Cancelled** tab (`setActiveTab("cancelled")`), displaying the newly cancelled order in the Cancelled list.
   - Dynamically updates tab badges and KPI cards (`sales_confirmed` count decrements by 1; `cancelled` count increments by 1).

### QA Verification Test Cases
- [ ] Verify navigating to `/sales/process` displays the Top 6 KPI summary cards (`ALL`, `ADMIN CONFIRMED TO LR`, `PENDING`, `ADMIN APPROVED`, `LR`, `CANCELLED`) with positive counts and amounts corresponding to existing database orders.
- [ ] Verify the 10 status tabs display badges with accurate counts matching the number of orders in each respective status.
- [ ] Verify clicking the `PENDING` KPI card or `Pending` tab filters the table rows to show only orders with status `pending`.
- [ ] Verify clicking the `ADMIN CONFIRMED TO LR` KPI card filters the table rows to show orders in intermediate statuses (`sales_confirmed`, `admin_approved`, `acc_confirmed`, `gatepass_created`, `dispatched`, `lr`).
- [ ] Verify toggling the `Including GST` switch toggles the table column header between `Amount (Inc.GST)` and `Amount (Ex.GST)`.
- [ ] Verify toggling `Including GST` updates KPI card amounts between GST-inclusive totals and basic totals.
- [ ] Verify clicking the 3-dots (`⋮`) action menu on an order with status `Pending` displays **only** `Edit`, `SO Files`, and `Delete`, and does not display Print SO, Warehouse SO, Gate Pass, or LR options.
- [ ] Verify clicking `SO Files` opens the "Upload Files" slide-over drawer with "Check All Upload Files", "PO File" input, and full-width "Submit" button matching `erp.inhymasolutions.com/sale-order/list`.
- [ ] Verify selecting a file and clicking "Submit" saves the PO file, displays a success toast notification, and closes the drawer.
- [ ] Verify clicking the 3-dots (`⋮`) action menu on an order with status `Sales Confirmed` displays **only** `Edit`, `SO Files`, `Cancel`, and `Delete`.
- [ ] Verify that `Print SO (Pricing)`, `Warehouse SO (No Pricing)`, `Gate Pass PDF`, `Download Gate Pass`, and `Send LR to Client` do NOT appear for `Sales Confirmed` orders.
- [ ] Verify clicking `Cancel` on a `Sales Confirmed` order confirms with prompt, sets order status to `cancelled`, and directly switches active tab to `Cancelled`.
- [ ] Verify the `Sales Confirmed` count decrements and the `Cancelled` count increments by 1 after cancellation.
- [ ] Verify automated backend pytest test `test_list_sale_orders_metrics_calculation` passes.
- [ ] Verify Vitest frontend test suite `SaleProcessListPage.test.tsx` passes with 100% success rate (12/12 passing).

---

## 66. SALE: Sales Process 9-Status Action Menu Matrix, LR Duplicate, Direct Cancellation & SO Files Deletion

- **Primary Route:** `/sales/process` (Sales Order List / Sales Process).
- **Form Route:** `/sales/process/add` & `/sales/process/edit/:id`.
- **Purpose:** Strict enforcement of user-defined action menu capabilities across all 9 workflow statuses, seamless duplicate order generation on LR stage, direct cancellation workflow, and file removal in the SO Files drawer.

### Feature Specifications
1. **Status-Specific Action Menu Matrix:**
   - **Pending (`pending`):**
     * `Edit`: Navigates to `/sales/process/edit/:id`.
     * `SO Files`: Opens "Upload Files" slide-over drawer with file delete options.
     * `Delete`: Prompts confirmation and deletes order.
   - **Sales Confirmed (`sales_confirmed`):**
     * `Edit`: Navigates to `/sales/process/edit/:id`.
     * `SO Files`: Opens "Upload Files" slide-over drawer with file delete options.
     * `Cancel`: Prompts confirmation and directly transitions status to `cancelled`.
     * `Delete`: Prompts confirmation and deletes order.
   - **Admin Approved (`admin_approved`):**
     * `SO Files`: Opens "Upload Files" slide-over drawer with file delete options.
     * `Cancel`: Prompts confirmation and directly transitions status to `cancelled`.
     * `Delete`: Prompts confirmation and deletes order.
   - **Acc Confirmed (`acc_confirmed`):**
     * `SO Files`: Opens "Upload Files" slide-over drawer with file delete options.
     * `Delete`: Prompts confirmation and deletes order.
   - **Gatepass Created (`gatepass_created`):**
     * `Download Gatepass`: Downloads Gatepass PDF for the order.
     * `SO Files`: Opens "Upload Files" slide-over drawer with file delete options.
     * `Delete`: Prompts confirmation and deletes order.
   - **Dispatched (`dispatched`):**
     * `Download Gatepass`: Downloads Gatepass PDF for the order.
     * `SO Files`: Opens "Upload Files" slide-over drawer with file delete options.
     * `Delete`: Prompts confirmation and deletes order.
   - **Gatepass Cancelled (`gatepass_cancelled`):**
     * `SO Files`: Opens "Upload Files" slide-over drawer with file delete options.
     * `Cancel`: Prompts confirmation and directly transitions status to `cancelled`.
     * `Delete`: Prompts confirmation and deletes order.
   - **LR (`lr`):**
     * `Duplicate`: Navigates to `/sales/process/add?duplicate_id=:id` prefilling order details into a fresh `pending` order.
     * `Download Gatepass`: Downloads Gatepass PDF.
     * `Delete`: Prompts confirmation and deletes order.
   - **Cancelled (`cancelled`):**
     * `Delete`: Prompts confirmation and deletes order.
2. **Direct Cancel Action Behavior:**
   - On statuses with `Cancel` in the action menu (`sales_confirmed`, `admin_approved`, `gatepass_cancelled`), clicking **Cancel** directly changes the record's status to `cancelled` and immediately moves user view to the `Cancelled` tab.
3. **LR Duplicate Order Workflow:**
   - Clicking **Duplicate** on an LR order navigates to `/sales/process/add?duplicate_id=:id`.
   - `SaleProcessForm.tsx` prefills customer details, warehouse, payment terms, transport settings, additional charges, and items table from the source order.
   - Clears `order_no` and sets header to `"Add Sales Order (Duplicate)"`.
4. **SO Files Drawer File Deletion:**
   - Clicking **Delete** on any file in the uploaded files list removes that file attachment.
   - Clicking **Delete** on the existing attached PO file clears the PO attachment, unlinks `po_file`/`po_attachment`, and resets `po` to `"No"`.

### QA Verification Test Cases
- [ ] Verify clicking `⋮` on `Admin Approved` order displays **only** `SO Files`, `Cancel`, and `Delete`.
- [ ] Verify clicking `⋮` on `Acc Confirmed` order displays **only** `SO Files` and `Delete`.
- [ ] Verify clicking `⋮` on `Gatepass Created` order displays **only** `Download Gatepass`, `SO Files`, and `Delete`.
- [ ] Verify clicking `⋮` on `Dispatched` order displays **only** `Download Gatepass`, `SO Files`, and `Delete`.
- [ ] Verify clicking `⋮` on `Gatepass Cancelled` order displays **only** `SO Files`, `Cancel`, and `Delete`.
- [ ] Verify clicking `⋮` on `LR` order displays **only** `Duplicate`, `Download Gatepass`, and `Delete`.
- [ ] Verify clicking `⋮` on `Cancelled` order displays **only** `Delete`.
- [ ] Verify clicking `Duplicate` on an LR order navigates to `/sales/process/add?duplicate_id=...` and displays `"Add Sales Order (Duplicate)"`.
- [ ] Verify clicking `Cancel` on an `Admin Approved` or `Gatepass Cancelled` order changes status to `cancelled` and switches active tab to `Cancelled`.
- [ ] Verify deleting a file in the SO Files drawer removes it from the list.
- [ ] Verify deleting the PO file in the SO Files drawer unlinks the PO attachment and updates status.
- [ ] Verify all 28 Vitest tests in `SaleProcessListPage.test.tsx` and `SaleProcessFormPage.test.tsx` pass.
- [ ] Verify all 18 backend pytest tests in `test_sale_order_workflow.py` pass.


---

## 67. SALE PROCESS: Collapsible Filter Panel 13-Field Grid & Dropdown Sales Person Selection

### Module Identification & Location
- **Module Name:** Sales Process Filter Panel (13 Fields with Dynamic Sales Person Dropdown)
- **Routes:** `/sales/process`
- **Files:**
  - Frontend List View: `frontend/src/pages/sales/SaleProcessList.tsx`
  - Stylesheet: `frontend/src/index.css`
  - Test Suite: `frontend/src/pages/__tests__/SaleProcessListPage.test.tsx`

### Feature Overview & Visual Design
1. **13-Field 6-Column Grid Layout (`data-testid="sale-process-filter-panel"`):**
   - **Row 1 (Date Inputs):**
     - `Order Date From` (type date)
     - `Order Date To` (type date)
     - `Invoice Date From` (type date)
     - `Invoice Date To` (type date)
     - `Exp. Delivery From` (type date)
     - `Exp. Delivery To` (type date)
   - **Row 2 (Selection & Filter Criteria):**
     - `State`: `<select>` with all 36 Indian States and Union Territories.
     - `Dispatch`: `<select data-testid="filter-dispatch">` with options: All / Yes / No.
     - `Warehouse`: `<select>` with options: All / Mumbai / Mumbai Transit / Ahmedabad / Indore (merged dynamically with existing order data).
     - `Sales Person`: `<select data-testid="filter-sales-person">` populated dynamically from user records and active orders (`All`, `Admin`, `Dhairya Shah`, etc.).
     - `Company`: `<input data-testid="filter-company">` client/company name text search.
     - `Third Party`: `<select>` with options: All / Yes / No.
   - **Row 3 (Action Row):**
     - `PO`: `<select>` with options: All / Yes / No.
     - Right-aligned Action Buttons: `Reset` (`#64748b`) & `Search` (`#f59e0b`).
2. **Sales Person Dropdown Specification:**
   - Dropdown selection eliminates freehand typos.
   - Dynamically combines active users with distinct `sales_person` values from loaded order records.
   - Selecting a sales person filters orders on clicking Search.
3. **Reset & Search Behavior:**
   - `Search` applies active filter criteria across dates, warehouse, sales person, company, third party, dispatch, and PO.
   - `Reset` clears all 13 filter fields and reloads complete, unfiltered order records.

### QA Verification Test Cases
- [ ] Verify clicking the Filter button toggles the collapsible filter panel.
- [ ] Verify the panel displays all 13 fields across 3 rows matching the reference layout.
- [ ] Verify Row 1 contains 6 date inputs: Order Date From, Order Date To, Invoice Date From, Invoice Date To, Exp. Delivery From, and Exp. Delivery To.
- [ ] Verify Row 2 contains State, Dispatch Status, Warehouse, Sales Person (dropdown), Company, and Third Party.
- [ ] Verify Sales Person is a `<select>` dropdown containing All, Admin, Dhairya Shah, and dynamically populated sales representatives.
- [ ] Verify selecting a Sales Person and clicking Search filters the orders table to orders matching that sales person.
- [ ] Verify clicking "Reset" clears all 13 filter inputs and reloads all unfiltered orders.
- [ ] Verify Row 3 contains PO filter and right-aligned Reset and Search buttons.

---

## 68. HRMS PHASES 2–6: Granular RBAC, Deny Precedence, Manager-First Real Availability Routing, Two-Stage Approvals & Separation of Duties

### Overview & Architectural Foundation
- **Mandatory Requirements:** Comprehensive implementation and audit across all 7 HRMS modules (Attendance, Leave, Assets, Expenses, Site Visits, Payroll, Setup).
- **Core RBAC Precedence:**
  - Standard Canonical Model: `Effective = (Role Permissions ∪ User Grants) \ User Denies`.
  - Deterministic Deny-Marker propagation: explicit `deny:<perm>` codes take absolute precedence over role and individual grants across all API endpoints.
  - Self-Privilege Guard: Non-Super Admins are strictly forbidden from modifying their own roles or permission grants (`HTTP 403 Forbidden`).
- **Manager-First Routing with System Data Availability:**
  - Direct manager priority: Requests route to the assigned manager first whenever assigned and available.
  - Availability is determined via real system data (active user status + non-overlapping approved leave in `HrmsLeaveRequest`).
  - HR Fallback activation: Routes to authorized HR fallback only when manager is unassigned, inactive, or on approved leave.
  - Self-Approval Prevention: Users cannot approve their own requests across any module (`HTTP 400 Bad Request` "Self-approval is not permitted"), with Super Admin override allowed.
  - Duplicate/Stale Action Protection: Approving or rejecting an already processed request returns `HTTP 400 Bad Request`.
- **Multi-Stage Workflows & Separation of Duties:**
  - Expenses: Two-stage approval workflow (`PENDING` ➔ Manager `APPROVED` ➔ HR/Finance `REIMBURSED`).
  - Payroll: Strict separation between calculation/configuration (`hrms.payroll.configure`) and batch approval (`hrms.payroll.approve`). HR users holding only configure permissions cannot approve payroll, and vice versa.
  - Data Scoping & Employee Isolation: Employees can view only their own records and payslips (`HTTP 403 Forbidden` on forged IDs).

### QA Verification Test Cases
- [ ] **Admin Full Control:** Super Admin has company-wide visibility and administrative authority across all 7 modules and approval queues.
- [ ] **Setup Protection:** Regular employees and restricted HR users without `hrms.manage` receive `HTTP 403 Forbidden` when attempting to create leave types, expense categories, or locations.
- [ ] **Self-Approval Denial:** Employee attempting to approve their own leave, attendance regularization, or expense claim receives `HTTP 400 Bad Request` ("Self-approval is not permitted").
- [ ] **Manager-First Routing:** When an employee has an active, available manager, the request routes to that manager's approval queue; HR fallback cannot approve while the manager is available.
- [ ] **Real Availability Fallback:** When the assigned manager is on approved leave (recorded in `hrms_leave_requests`), the system automatically activates the HR fallback queue.
- [ ] **HR Action Permissions:** HR fallback user lacking action permission (`hrms.approve` or `deny:hrms.approve`) receives `HTTP 403 Forbidden`.
- [ ] **Two-Stage Expenses:** An expense claim approved by the manager enters `APPROVED` status; manager cannot mark it `REIMBURSED`. Only authorized HR/Finance can reimburse.
- [ ] **Payroll Separation of Duties:** HR user with `hrms.payroll.configure` can calculate batches but receives `HTTP 403 Forbidden` on batch approval. HR user with `hrms.payroll.approve` can approve batches but cannot run batch recalculations.
- [ ] **Employee Isolation:** Employee A cannot view Employee B's monthly payroll items or payslips (`HTTP 403 Forbidden`).
- [ ] **Self-Escalation Prevention:** Restricted HR or normal users cannot grant themselves permissions or alter their roles via `/api/v1/rbac/users/{id}/roles` or `/permissions` (`HTTP 403 Forbidden`).

---

## 69. FEED: Open Broadcasting & 1-to-1 Private Employee Messaging

### Overview & Architectural Foundation
- **Mandatory Requirements:**
  - Universal announcement publishing for all authenticated ERP employees without requiring `feed.create` or `feed.manage` permissions.
  - 1-to-1 private messaging module integrated within the Feed page with real-time employee search.
  - Strict privacy: only conversation participants can view conversation threads and messages. Admins and third parties receive `HTTP 403 Forbidden`.
  - Author-only edit and soft-delete controls across announcements and direct messages.
  - Notification integration without leaking message content.
  - Read tracking and unread count badges.

### QA Verification Test Cases
- [ ] **Open Broadcasting:** Any authenticated employee with zero special feed permissions can publish company-wide (`ALL`) announcements.
- [ ] **Targeted Announcements:** Any authenticated employee can target one or more departments (`SELECTED` + `department_ids`), specific employees (`SELECTED` + `recipient_ids`), or combined.
- [ ] **Author-Only Announcement Management:** Only the post author can edit (`PATCH /api/v1/feed/posts/{id}`) or delete (`DELETE /api/v1/feed/posts/{id}`). Non-authors receive `HTTP 403 Forbidden`.
- [ ] **Direct Conversation Initialization:** Any employee can start a 1-to-1 conversation with any eligible active employee in the tenant via `POST /api/v1/feed/conversations`. Self-conversations return `HTTP 400 Bad Request`.
- [ ] **Strict Participant Isolation:** Only participants in the conversation can list messages via `GET /api/v1/feed/conversations/{id}/messages`. Third-party employees receive `HTTP 403 Forbidden`.
- [ ] **Admin Privacy Enforcement:** Administrators cannot automatically access or inject messages into another employee's private conversation (`HTTP 403 Forbidden`).
- [ ] **Author-Only Message Lifecycle:** Senders can edit (`PATCH /api/v1/feed/messages/{id}`) and delete (`DELETE /api/v1/feed/messages/{id}`) their own messages. Intended recipients cannot edit or delete the sender's messages (`HTTP 403 Forbidden`).
- [ ] **Unread Tracking:** Unread message count increments for the recipient on new messages (`GET /api/v1/feed/conversations/unread-count`), and clears when conversation is marked read (`POST /api/v1/feed/conversations/{id}/read`).
- [ ] **Security & Validation:** Non-existent IDs return `HTTP 404 Not Found`; unauthenticated requests return `HTTP 401 Unauthorized`; client sender ID spoofing is prevented by deriving identity strictly from authentication tokens.
- [ ] **Existing Features Preserved:** Existing reactions (Like, Celebrate, Support), comments, drafts, readership tracking, CRM, and ERP login continue operating normally.


---

## 70. SALE PROCESS: Sale Status Update Side Drawer, Multi-Stage Workflow, PO File & Tally Bill Upload

### Module Identification & Location
- **Module Name:** Sale Status Update Slide-Over Drawer & Multi-Stage Document Workflow
- **Routes:** `/sales/process`
- **Files:**
  - Frontend List & Drawer: `frontend/src/pages/sales/SaleProcessList.tsx`
  - Frontend Detail Modal: `frontend/src/pages/sales/SaleProcessDetailModal.tsx`
  - Backend Models, Schemas, Service & Routes: `backend/app/sales/models.py`, `backend/app/sales/schemas.py`, `backend/app/sales/service.py`, `backend/app/sales/process_routes.py`
  - Database Migrations: `backend/alembic/versions/v7a8b9c0d1e2_add_po_and_tally_bill_fields_to_sales_orders.py`, `backend/alembic/versions/w8b9c0d1e2f3_add_lr_file_and_dispatch_media_to_sales_orders.py`, `backend/alembic/versions/x9c0d1e2f3a4_add_eway_bill_file_fields_to_sales_orders.py`, `backend/alembic/versions/y0d1e2f3a4b5_add_timeline_to_sales_orders.py`
  - Test Suites: `frontend/src/pages/__tests__/SaleProcessListPage.test.tsx`, `backend/tests/test_sale_order_workflow.py`

### Feature Overview & UI Specifications
1. **Status Column Action & Badges (`SaleProcessList.tsx`):**
   - Every row renders its status pill (`Admin Approved`, `Acc. Confirmed`, `Gatepass Created`, and `Dispatched` use soft green `#dcfce7` / `#15803d`), a blue square edit icon button (`title="Update Status"`), optional `📎 PO` chip on upstream stages (`Sales Confirmed` / `Admin Approved`), and a `DD-MM-YYYY hh:mm A` timestamp below the row.
   - In the **`Acc. Dep.`** column above `Timeline`, invoiced orders display orange `#f59e0b` square chips: **`i`** (instant dark hover tooltip `Tally Bill`, direct link to `tally_bill_url`) and **`E`** (instant dark hover tooltip `E-Way Bill`, direct link to `eway_bill_url` when `E-Way Bill` = `Yes`).
   - The `PO` column also renders `Yes 📎` as a direct clickable download link when `po_file_url` is present.
2. **Sale Status Update Side Drawer (`<SideDrawer title="Sale Status Update" width="480px" maxWidth="95vw">`):**
   - **Green Current Status Banner:** `Current Status: <Stage Label>` (`#dcfce7` background, `#15803d` text).
   - **Stage 1 (`Pending`):**
     - `Status` `<select>` options: `Sales Confirmed` (default) and `Cancel`.
     - `PO File` upload input accepting `.pdf,.png,.jpg,.jpeg,.xlsx,.xls,.doc,.docx` with selected filename/KB preview and `Clear` button.
   - **Stage 2 (`Sales Confirmed`):**
     - `Status` `<select>` options: `Admin Approved` (default) and `Cancel`.
     - `PO File` upload input is hidden.
   - **Stage 3 (`Admin Approved`):**
     - `Status` `<select>` options: `Acc. Confirmed` (default) and `Cancel`.
     - When `Acc. Confirmed` is selected, renders:
       - `Invoice Date*` (`type="date"`, required)
       - `Invoice No *` (`type="text"`, required)
       - `Tally Bill *` (file upload accepting `.pdf,.png,.jpg,.jpeg,.xlsx,.xls,.doc,.docx`, required unless already uploaded)
       - `E-Way Bill` (`No` / `Yes`, default `No`)
       - `E-Way Bill *` (`data-testid="input-status-eway-bill-file"`, conditional file upload shown only when `E-Way Bill` = `Yes`; mandatory when `Yes`, uploaded via `POST /api/v1/sales/upload-eway-bill` and persisted to `eway_bill_url` / `eway_bill_name`; renders orange `[E]` chip in `Acc. Dep.` column and download link in `SaleProcessDetailModal` & `Upload Files`)
       - `Third Party Invoice / Reference *` (shown & required when Third-Party Delivery is `Yes`).
   - **Stage 4 (`Acc. Confirmed`):**
     - Green banner `Current Status: Acc. Confirmed`, `Status` field locked to `Gatepass Created`, clean `Remarks` textarea, and bottom full-width `Submit` button (no extra Outward Gate Pass Details inputs inside the drawer; Gatepass number & metadata are auto-assigned on submission).
   - **Downstream Stages (`Gatepass Created`, `Gatepass Cancelled`, `Dispatched`):**
     - `Gatepass Created` ➔ `Dispatched` / `Gatepass Cancelled`.
     - `Gatepass Cancelled` ➔ `Gatepass Created` / `Cancel`.
     - **Stage 6 (`Dispatched`):**
       - Green banner `Current Status: Dispatched`.
       - `Status` `<select>` options: `LR` (`value="lr"`, default) and `Gatepass Cancel` (`value="gatepass_cancelled"`).
       - When `Status` = `LR` is selected:
          - `[ ] Change Transport Info` checkbox (`data-testid="checkbox-change-transport-info"`): unchecked by default; when checked, expands a clean frameless 2×2 grid (`data-testid="section-change-transport-fields"`, `gridTemplateColumns: "1fr 1fr"`) directly on the white drawer surface:
            - Row 1: `Transport Name` (`<select>` from `/masters/transports` + `Self Pickup`, pre-selected from order or first transport) | `Transport Destination` (`<input type="text">`, empty placeholder, initialized strictly from `order.transport_destination` without falling back to `order.city`).
            - Row 2: `Delivery Type` (`<select>` from `delivery.type` option group, defaulting to `Door`) | `Delivery Charge` (`<select>` from `delivery.charge` option group, defaulting to `To Pay`).
            - Selecting `Self Pickup` automatically hides `Transport Destination`, `Delivery Type`, and `Delivery Charge`.
         - `LR File *` (`data-testid="input-status-lr-file"`): mandatory file upload input (`Choose File | No file chosen`) accepting `.pdf,.png,.jpg,.jpeg,.webp,.doc,.docx,.xlsx,.xls`, uploaded via `POST /api/v1/sales/upload-lr` with filename/KB preview & `Clear` button.
         - `Images/Videos (Upload Multiple)` (`data-testid="dropzone-dispatch-media"`): rectangular drag-and-drop + click-to-browse dropzone (`Drag files here to upload`) accepting multiple `image/*,video/*` files, uploaded via `POST /api/v1/sales/upload-dispatch-media` with per-file remove (`✕`) buttons.
         - `Remarks`: multi-line textarea (clean empty placeholder).
       - When `Status` = `Gatepass Cancel` is selected: hides `Change Transport Info`, `LR File *`, and `Images/Videos (Upload Multiple)`, showing only `Status`, `Remarks`, and `Submit`.
   - **Remarks & Submit:** Multi-line `Remarks` textarea and full-width primary blue `Submit` button (`#0061f2`, `Submitting...` feedback).
3. **Sales Details Modal Integration (`SaleProcessDetailModal.tsx`):**
   - Displays clickable `PO File` link, `Invoice` (`invoice_no` & `invoice_date`), clickable `Tally Bill` link, `E-Way Bill` status & clickable file link, plus uploaded `LR File` and `Dispatch Media` (images/videos) in `Attached Files & Documents`.
4. **Sale Order Time Line Side Drawer (`<SideDrawer title="Sale Order Time Line #<OrderSuffix>" width="480px">`):**
   - Triggered by clicking the blue `Timeline` button in the `Acc. Dep.` column.
   - Renders newest-to-oldest stage nodes connected by a continuous `#cbd5e1` vertical line and `34px` `#dbeafe` clock circles:
     - Pill badges: `LR Mandatory`, `Dispatched`, `Gatepass Created`, and `Account Confirmed` in soft green (`#dcfce7` / `#15803d`); `Sales Confirmed` in soft blue (`#dbeafe` / `#1d4ed8`); `Admin Approval` and `Pending` in soft amber (`#fef3c7` / `#b45309`); `Gatepass Cancelled` / `Cancelled` in soft red (`#fee2e2` / `#dc2626`).
     - Every stage displays calendar icon + `DD-MM-YYYY hh:mm AM/PM` timestamp and user icon + `By : <Actor Name>`, plus optional `Remark : <note>` only when a remark was entered.
     - The `Account Confirmed` node additionally renders `Invoice No : <invoice_no>`, `Invoice Date : <DD-MM-YYYY>`, conditional `E-Way Bill : [⬇]` blue download icon link (`data-testid="timeline-download-eway-bill"`, shown only when an E-Way Bill file was uploaded), and `Tally Bill : [⬇]` blue download icon link (`data-testid="timeline-download-tally-bill"`).

### QA Verification Test Cases
- [ ] **TC-SP-11 (Pending ➔ Sales Confirmed with PO File):** On `/sales/process`, click `[✎]` (`Update Status`) on a `Pending` order. Verify `Sale Status Update` drawer opens with `Current Status: Pending` and `Sales Confirmed` selected. Choose a PO file, verify filename/KB preview and `Clear` button, enter remarks, and click `Submit`. Verify PO uploads via `POST /api/v1/sales/upload-po`, status updates to `Sales Confirmed`, `📎 PO` badge appears, and timestamp updates.
- [ ] **TC-SP-12 (Sales Confirmed ➔ Admin Approved / Cancel):** Click `[✎]` on a `Sales Confirmed` order. Verify `Current Status: Sales Confirmed`, options `Admin Approved` (default) and `Cancel`, and confirm `PO File` input is hidden. Submit and verify status transitions cleanly.
 - [ ] **TC-SP-13 (Admin Approved ➔ Acc. Confirmed / Cancel & Conditional E-Way Bill *):** Click `[✎]` on an `Admin Approved` order. Verify `Invoice Date*`, `Invoice No *`, `Tally Bill *`, and `E-Way Bill` (`No` default, with `E-Way Bill *` file upload hidden) render when `Acc. Confirmed` is selected. Switch `E-Way Bill` to `Yes` and verify the `E-Way Bill *` file upload field (`Choose File | No file chosen`) appears immediately below and blocks submission if empty. Attach both Tally Bill and E-Way Bill files, enter Invoice Date & No, and click `Submit`. Verify `POST /api/v1/sales/upload-tally-bill` and `POST /api/v1/sales/upload-eway-bill` succeed, order moves to `Acc. Confirmed`, and `[i]` + `[E]` chips render in `Acc. Dep.` alongside clickable links in the detail modal.
- [ ] **TC-SP-14 (Acc. Confirmed ➔ Gatepass Created):** Click `[✎]` on an `Acc. Confirmed` order. Verify soft green `Acc. Confirmed` pill in table and drawer displaying `Current Status: Acc. Confirmed`, `Status: Gatepass Created`, `Remarks`, and `Submit` only.
- [ ] **TC-SP-15 (Dispatched ➔ LR / Gatepass Cancel):** Click `[✎]` on a `Dispatched` order. Verify `Current Status: Dispatched` banner and `Status` dropdown containing `LR` and `Gatepass Cancel`. Under `LR`, verify `[ ] Change Transport Info` toggles transport inputs, `LR File *` blocks empty submission and uploads via `POST /api/v1/sales/upload-lr`, and `Images/Videos (Upload Multiple)` dropzone accepts drag-and-drop/browse of multiple photos & videos via `POST /api/v1/sales/upload-dispatch-media`. Verify switching `Status` to `Gatepass Cancel` hides LR fields and transitions the order to `gatepass_cancelled`.
- [ ] **TC-SP-16 (Sale Order Time Line Drawer — Full 7-Stage Chain & Account Confirmed Downloads):** Click `Timeline` in the `Acc. Dep.` column across `Gatepass Created`, `Dispatched`, and `LR` tabs. Verify header `Sale Order Time Line #<OrderSuffix>`, newest-first stage pills (`LR Mandatory` ➔ `Dispatched` ➔ `Gatepass Created` ➔ `Account Confirmed` ➔ `Admin Approval` ➔ `Sales Confirmed` ➔ `Pending`), `DD-MM-YYYY hh:mm AM/PM` timestamps, `By : <Actor>` rows, and on `Account Confirmed`: `Invoice No`, `DD-MM-YYYY` `Invoice Date`, `E-Way Bill` download icon (shown only when E-Way Bill was uploaded), and `Tally Bill` download icon.

---

## 71. SALE: Discount Payments Ledger, Multi-Installment Adjustment Drawer & Payment List Modal

- **Module Name:** Discount Payments (`Discount.docx` & `Completed/Sales & PI Process.docx` L102)
- **Routes:** `/sale-discount/list`, `/discount-payments/list`, `/sales/discount-payments`
- **Files:**
  - Frontend Page: `frontend/src/pages/sales/DiscountPaymentsPage.tsx`
  - Backend Model, Service & Routes: `backend/app/sales/models.py` (`DiscountPayment`), `backend/app/sales/service.py` (`_sync_discount_payment`), `backend/app/sales/routes.py` (`GET / POST / PATCH /api/v1/sales/discount-payments`)
  - Database Migration: `backend/alembic/versions/z1e2f3a4b5c6_add_payments_history_to_discount_payments.py`
  - Test Suites: `frontend/src/pages/__tests__/DiscountPaymentsPage.test.tsx`, `backend/tests/test_discount_payments.py`

### Feature Overview & UI Specifications
1. **Collapsible Filter Panel (Above KPI Cards):**
   - Toggled via top-right `#556987` funnel button (`data-testid="btn-toggle-filter"`, collapsed by default).
   - Fields: `Order Date Range` (`DateRangePicker`), `Warehouse` (`All.` + dynamic warehouses), `Sales Person` (`All.` + dynamic sales persons), `Dispatch` (`All`, `LR`, `Dispatched`, `Pending`, `Gatepass Created`), with `Reset` and `Search` buttons.
2. **Reactive Top 3 KPI Summary Cards:**
   - `TOTAL DISCOUNT` (blue `#0061f2` label), `PAID` (green `#16a34a` label), and `DUE` (red `#ef4444` label), dynamically updating immediately upon submitting partial or full discount adjustments.
3. **Top Stage Tabs (`Discount.docx`):**
   - `All (<count>)`, `Pending (<count>)` (default active tab), and `Completed (<count>)` (completed rows render `✓ Completed` green badge `data-testid="badge-settled-<id>"`).
4. **10-Column Discount Payments Table:**
   - `Order No` (clickable blue `SO-...` link opening `/sale-order/invoice/<order_id>` + blue `DD-MM-YYYY` order date), `Warehouse`, `Company` (blue clickable company name + blue `Mr <Contact>` opening `Company Detail #<code` right drawer), `Contact Person` (name + mobile), `Sales Person`, `Total Discount`, `Paid/Due Dis. Amount` (`Paid ₹ <amount>` when `paid > 0`, red `Due ₹ <amount>` when `due > 0`, or green `✓ Completed` badge when settled), `Status` (live SaleOrder workflow stage badge e.g. `LR` + `DD-MM-YYYY hh:mm AM/PM` + red `Remark` button), `Gatepass` (blue `ID: <no>` + blue `DD-MM-YYYY` opening `Gate Pass Detail #<id>` right drawer), and `Action` (`⋮`).
5. **Action (`⋮`) Menu:**
   - Pending rows (`due_discount > 0`): `$ Adjust Discount` and `☰ List Payments`.
   - Completed rows (`settled` / `due_discount === 0`): `☰ List Payments` only (`$ Adjust Discount` hidden to prevent over-adjustment).
6. **`Discount Adjustment` Right-Side Drawer (`data-testid="discount-adjustment-drawer"`):**
   - White `Discount Summary` card (`Total Discount:`, green `Total Discount Paid:`, red `Total Discount Due:`).
   - `Date *` (`DatePicker`, defaults dynamically to current `DD-MM-YYYY` date), `Amount *` (`type="number"`, `placeholder="Max: <due_discount>"`, strictly validated `0 < amount <= due_discount` with inline alert `data-testid="adjust-discount-error"`), `Remarks/Feedback` textarea, and full-width blue `Submit` button.
7. **`Discount Adjustment Payment List` Modal (`data-testid="list-payments-modal"`):**
   - `Sale Order Detail` `#<OrderShortNo>` card with 3-column aligned grid (`Customer Name` / `Created Date` above `Total Discount` / `Paid Amount` / `Due Amount`).
   - Multi-row installment table `# | Date | Title | Amount | Adjustment By` rendering every partial/full installment from `payments` (`Title` populated from `Remarks/Feedback`, `Adjustment By` populated from the authenticated user's full display name, or `No Payment Found` when `0` payments exist).

### QA Verification Test Cases
- [ ] **TC-DP-01 (Auto-Sync from Sale Process):** Create a Sale Order on `/sales/process/add` with a line-item `Unit Discount > 0` and advance its workflow status to `LR` with a Gatepass. Navigate to `/sale-discount/list` and verify the order automatically appears under `Pending` with accurate `Total Discount`, `Due ₹ <amount>`, `LR` status badge, Company contact details, and `ID: <gatepass_no>`.
- [ ] **TC-DP-02 (Partial Discount Adjustment & Validation):** Click `⋮` ➔ `$ Adjust Discount`. Verify `Date *` defaults to today's `DD-MM-YYYY` date and `Amount *` displays `Max: <due>`. Attempt submitting empty/`0` or `> due` and verify inline error blocks submission. Submit a partial amount with `Remarks/Feedback` and verify `PAID` / `DUE` KPI cards and row `Paid ₹ ...` / `Due ₹ ...` update immediately.
- [ ] **TC-DP-03 (Multi-Installment Payment List & Completion):** Click `⋮` ➔ `☰ List Payments` and verify `Sale Order Detail #<no>` and every recorded installment row (`#`, `Date`, `Title`, `Amount`, `Adjustment By`). Adjust the remaining balance to `0` and verify the record moves from `Pending` to `Completed` with `✓ Completed` badge, `$ Adjust Discount` hidden in `⋮`, and all installments preserved in `List Payments`.

---

## 72. REPORTS: Product Re-Order Matrix, Branch-Scoped Shortfall Engine & FIFO Stock Breakup

- **Module Name:** Product Re-Order (`General New points inhyma.docx` L30/L69/L84/L103, `Phase 2/Stock Transactions.docx` L1-L36, `Phase 2/Reports.docx` L19-L20, `Completed/Product Stock 26-4-25.docx` L23-L24)
- **Routes:** `/product-reorder/list`, `/reports/reorder`
- **Files:**
  - Frontend Page & Styles: `frontend/src/pages/ProductReorderPage.tsx`, `frontend/src/styles/productReorder.css`
  - Frontend API Client: `frontend/src/lib/api.ts` (`ProductReorderItem`, `InventoryApi.listProductReorder`, `InventoryApi.updateProductReorder`, `InventoryApi.getStockBreakup`)
  - Backend Schemas & Routes: `backend/app/inventory/schemas.py` (`ProductReorderItemRead`, `ProductReorderUpdateSchema`), `backend/app/inventory/routes.py` (`GET /api/v1/inventory/product-reorder`, `PATCH /api/v1/inventory/product-reorder/{product_id}`, `GET /api/v1/inventory/product-stock/breakup`)
  - Test Suites: `frontend/src/pages/__tests__/ProductReorderPage.test.tsx`, `backend/tests/test_inventory_integrity.py`, `backend/tests/test_inventory_and_stock_adjustments.py`

### Feature Overview & UI Specifications
1. **Top Page Header & Collapsible 4-Column Filter Panel:**
   - Title `Product Re-Order` on left; dark slate `#5a6d87` funnel toggle button first, followed by golden-amber `#f59e0b` standalone `Export` CSV button (`btn btn-imp-exp reorder-btn-export`) on the right.
   - **Row 1 (4 Columns):** `Category` (`All` + active `ProductCategory` masters), `Sub Category` (`All` + `ProductSubCategory` masters dynamically narrowed when `Category` is selected), `Brand` (`All` + active `Brand` masters), `Short Fall` (`All`, `0`, `Greater Than 0`).
   - **Row 2 (Column 1):** `Re-Order` (`All`, `0`, `Greater Than 0`).
   - **Bottom-Right Filter Actions:** Dark slate `Reset` button (`#5c6f88`) and golden-amber `Search` button (`#f7b919`).
2. **Search + Branch Warehouse Selector Card:**
   - Dedicated white card between Filter Panel and Table Card containing:
     - Left `[ 🔍 | Search products by name, code, brand, sub-category... ]` input.
     - Right Warehouse `<select>` (`Mumbai` default, `Ahmedabad`, `Indore`, `All Warehouses`).
   - Changing the Warehouse selector dynamically scopes Columns 13-16 (`Re-Order`, `Short Fall`, `MOQ`, `Order To Be Place`), `Short Fall` / `Re-Order` filter evaluation, sorting, and inline threshold edits to that branch's net pipeline (`<city> + <city>_transit + <city>_ordered` and per-branch thresholds stored in `ProductStock.orders_info` under `_type == "wh_reorder"`), while `All Warehouses` evaluates against global `Total Qty` and global `Product` / `ProductStock` thresholds.
3. **16-Column Color-Coded Product Re-Order Table (Default `50` Rows/Page, Full Catalog Load up to `2500`+ SKUs):**
   - `Sr. No.` | `Product Name (As Per Tally)` (blue clickable hyperlink)
   - **Physical Columns (Soft Rose-Pink `#f4dce0` header / `#f6dfe2` cells):** `Mumbai` (Col 3), `Ahmadabad` (Col 6), `Indore` (Col 9).
   - **Transit Columns (Warm Beige-Grey `#edeae4` header / `#efece6` cells):** `Mumbai Transit` (Col 4), `Ahmedabad Transit` (Col 7), `Indore Transit` (Col 10).
   - **Ordered Columns (Medium Neutral Grey `#dcdcdc` header / `#dedede` cells):** `Mumbai Ordered` (Col 5), `Ahmedabad Ordered` (Col 8), `Indore Ordered` (Col 11).
   - **Summary & Replenishment Columns:** `Total Qty` (Col 12), `Re-Order` (Col 13, clickable blue inline-editable value), `Short Fall` (Col 14, `max(0, Re-Order - EffectivePipeline)`), `MOQ` (Col 15, clickable blue inline-editable value), `Order To Be Place` (Col 16, `0` when `Short Fall == 0`, else `max(Short Fall, MOQ)`).
4. **Backend-Driven Circular Slate `ⓘ` Breakup Badges (`breakup_flags`):**
   - Driven by live open transactions rather than `qty !== 0` alone:
     - Physical cell (`Mumbai`, `Ahmadabad`, `Indore`) shows `ⓘ` whenever an open `SaleOrder` (`OPEN_SALE_ORDER_STATUSES`) exists for that product & branch—even when physical balance is `0` (`0 ⓘ`), and omits `ⓘ` on positive physical stock (e.g. `41`) when zero open Sale Orders exist.
     - Transit / Ordered cell shows `ⓘ` when active `ImportPurchase` consignments, in-transit `StockTransfer`s (`pending` / `confirmed` / `in transit`), `orders_info` entries, or advance-booked `SaleOrder`s exist.
5. **Interactive Drawers, Modals & Role-Safe PDF Integration:**
   - **Physical `ⓘ` ➔ `Sale Order Information` Drawer:** Displays `SO No & Date` (clickable blue SO number fetching `/api/v1/sales/orders/{order_id}` to open the real Sale Order PDF, automatically enforcing `hidePricing: true` for Warehouse role users), `Company Name` (shown in Re-Order breakup), `City / State`, `Qty`, `Sales Person`, `Exp. Del. Date`, and clean workflow `Status` (`unit_price` strictly excluded).
   - **Transit / Ordered `ⓘ` ➔ `Purchase Order Information` Drawer & `Consignment Details` Modal:** Combines incoming `ImportPurchase` containers and active inter-warehouse `StockTransfer`s, applies FIFO deduction against open `SaleOrder` bookings on `<City> Transit` / `<City> Ordered`, lists `Open Sale Order Bookings (FIFO Deducted)`, and makes every `Inv. / Cons No` clickable to open the `Consignment Details` modal (`Product Name`, `Qty`, `Warehouse`, `Inv. / Cons No`, `Inv. Date`, `Exp. Arri. Date`, `ETD Origin Date`, `ETA Port Date`, `Status`).
   - **Clickable `Product Name` ➔ `Product Master View Window` Drawer:** Displays `Product Name (Tally)` & `Invoice Name`, `Category`, `Sub Category`, `Brand`, `HSN Code`, `GST %`, `Import Duty %`, `UOM`, `Min. Selling Price`, `Packaging` (`Qty/Box`, `Net Wt`, `Gross Wt`), `Dimensions For CBM` (`L × W × H cm` & `Unit CBM`), 9-column warehouse breakdown, `Specifications`, and `Open in Product Master ↗`.

### QA Verification Test Cases
- [ ] **TC-RO-01 (Master Joins, 4-Column Filter Panel, Title-Case Headers & Pagination Summary):** Navigate to `/product-reorder/list` (or `/reports/re-order`). Verify all active catalog products load (default `50` per page), Title-Case column headers (`Sr. No.`, `Product Name (As Per Tally)`, `Mumbai`, etc.) render without forced uppercase, bottom pagination displays `Showing 1–50 of <total> total (Page 1 of <pages>)`, `Category` / `Sub Category` / `Brand` dropdowns populate from master tables, and clicking `Search` / `Reset` filters and resets rows accurately.
- [ ] **TC-RO-02 (Branch Warehouse Selector & Inline Threshold Persistence):** With `Mumbai` selected in the Warehouse bar, click a product's blue `Re-Order` and `MOQ` numbers, save new values, and verify `Short Fall` and `Order To Be Place` recalculate against `Mumbai + Mumbai Transit + Mumbai Ordered`. Switch Warehouse selector to `Indore` or `All Warehouses` and verify branch-isolated vs global pipeline shortfall calculation.
- [ ] **TC-RO-03 (`0 ⓘ` Open Sale Order Breakup & Real Sale Order PDF):** For a product with `0` physical stock in Mumbai and an open Sale Order, verify `0 ⓘ` renders. Click `ⓘ`, verify `Company Name`, clean `Status`, and zero `unit_price` leakage, then click the blue `SO-...` link and confirm the real Sale Order PDF opens (with pricing hidden for Warehouse role).
- [ ] **TC-RO-04 (Transit/Ordered FIFO Breakup, Stock Transfer Inclusion & Consignment Modal):** Click `ⓘ` on a Transit/Ordered cell with incoming Import Purchase or Stock Transfer entries and advance Sale Order bookings. Verify FIFO net available deduction across consignments, `Open Sale Order Bookings` table, and clicking `Inv. / Cons No` opens the `Consignment Details` modal with ETD/ETA dates.
- [ ] **TC-RO-05 (Product Master View Window):** Click any blue `Product Name (As Per Tally)` hyperlink and verify the `Product Master View Window` drawer displays HSN, GST %, UOM, CBM dimensions, 9-column stock matrix, specifications, and `Open in Product Master ↗`.

---

## 73. REPORTS: Product Stock Transactions Master List & Per-Product Stock Transaction Ledger

- **Module Name:** Stock Transactions (`Completed/Product Stock 26-4-25.docx` L27, `General New points inhyma.docx` L132, `Phase 2/Stock Transactions.docx`)
- **Routes:**
  - **Screen 1 (Master List):** `/reports/stock-transactions`, `/transaction-report/list`, `/transaction_report/list`, `/stock-transactions`
  - **Screen 2 (Per-Product Ledger):** `/stock-transaction/list/:id`, `/stock_transaction/list/:id`, `/reports/stock-transactions/:id`
- **Files:**
  - Frontend Pages & Styles: `frontend/src/pages/ProductStockPage.tsx`, `frontend/src/pages/StockTransactionDetailPage.tsx`, `frontend/src/styles/productStock.css`
  - Frontend API Client & Routing: `frontend/src/lib/api.ts` (`StockTransactionLedgerEntry`, `ProductStockLedgerResponse`, `InventoryApi.getProductStockTransactions`), `frontend/src/App.tsx`
  - Backend Schemas & Routes: `backend/app/inventory/schemas.py` (`StockTransactionLedgerItemRead`), `backend/app/inventory/routes.py` (`GET /api/v1/inventory/stock-transactions/{product_ref}`, `/api/v1/stock-transaction/list/{product_ref}`)
  - Test Suites: `frontend/src/pages/__tests__/ProductStockPage.test.tsx`, `frontend/src/pages/__tests__/StockTransactionDetailPage.test.tsx`, `backend/tests/test_inventory_integrity.py`, `backend/tests/test_inventory_and_stock_adjustments.py`

### Feature Overview & UI Specifications
1. **Screen 1 — `Product Stock Transactions` Master List (`/reports/stock-transactions` / `/transaction-report/list`):**
   - Sidebar active navigation key: `REPORTS` ➔ `Stock Transactions` (`reports-stock-transactions`).
   - Top Page Header: `Product Stock Transactions` on left; dark slate Funnel filter toggle `[▼]` + `Export` (`Product_Stock_Transactions.xlsx`) on right.
   - **4-Column Filter Panel (Off / Collapsed by Default; Toggled via Funnel Button):** `Category` (`All`), cascading `Sub Category` (`All`), `Brand` (`All`), `Is Negative Stock` (`Select` / `Yes` / `No`), with dark slate `Reset` and golden-amber `Search` buttons.
   - **Right-Aligned Search Card:** Dedicated white card with `[ 🔍 | Search products by name, code, brand, sub-category... ]`.
   - **15-Column Title-Case Warehouse Matrix:** `Sr. No.` | `Product Name (As Per Tally)` | `Product Code` | `Brand` | `Sub Category` | `Mumbai` (soft pink) | `Mumbai Transit` (warm beige-grey) | `Mumbai Ordered` (medium grey) | `Ahmedabad` (soft pink) | `Ahmedabad Transit` (warm beige-grey) | `Ahmedabad Ordered` (medium grey) | `Indore` (soft pink) | `Indore Transit` (warm beige-grey) | `Indore Ordered` (medium grey) | `Total Qty`.
   - **Drill-Down Navigation:** Clicking any blue `Product Name (As Per Tally)` hyperlink navigates directly to `/stock-transaction/list/:id` (whereas `/product-stock/list` opens the `Product Details` `SideDrawer`).
2. **Screen 2 — `<Product Name> Stock` Per-Product Transaction Ledger (`/stock-transaction/list/:id`):**
   - **Top Header:** `<Product Name> Stock` (e.g., `Air Timer (PFS) Stock`) on left; right side displays dark slate Funnel filter button `[▼]` (collapsible 4-column `Warehouse`, `Type`, `From Date`, `To Date` filter panel with `Reset` & `Search`) and golden-amber `Action ▾` dropdown button (`Export to Excel (.xlsx)`, `Export to CSV (.csv)`, `Add Stock Adjustment`, `Add Stock Transfer`, `← Back to Stock Transactions`).
   - **KPI Card:** White card displaying `AVAILABLE QTY` label and live numeric balance (defaults to `total_qty` across warehouses; dynamically updates to the selected warehouse balance when filtered by a specific `Warehouse`).
   - **Ledger Table Card:**
     - **Toolbar:** Left `[ 10 ▾ ]` `<select>` (`10` default, `25`, `50`, `100`) + `Items/Page` stacked label; right `[ Search... ]` live filter input.
     - **7 Sortable Title-Case Columns:**
       1. `ID`: Sequential chronological movement ID (oldest = `1`, rendered newest-first).
       2. `Title`: Line 1 clickable movement description navigating to the underlying Sale Order / Adjustment PDF / Local Purchase Bill / Import Consignment Bill / Transfer PDF + Line 2 **bold party/company/supplier name** (e.g. **`VRO MACHINES PVT.LTD.`** below `Sale Order #SO-MH/26-27/4987 Confirm`).
       3. `Type`: Color-coded pill badge (`Sale` soft blue, `Stock IN` soft slate-grey, `Stock OUT` soft red, `Sale Cancel` soft amber, `Local Purchase` / `Import Purchase` soft green, `Transfer IN` / `Transfer OUT` soft indigo).
       4. `Warehouse`: Target physical, transit, or ordered warehouse (`Mumbai`, `Mumbai Transit`, `Mumbai Ordered`, `Ahmedabad`, `Indore`, etc.).
       5. `Quantity`: Signed delta with green `+` or red `-` (`- 1`, `+ 1`, `+ 50`, etc.).
       6. `Created By`: Actor / sales person / creator name (`Bhavin Suthar`, `Akshata Wadekar`, etc.).
       7. `Transaction Date`: IST timestamp formatted as `DD-MM-YYYY hh:mm AM/PM` (`28-10-2026 12:10 PM`).
     - **Footer:** `Showing X To Y Of Z Entries` on left | `Previous | 1 | Next` pager on right.

### QA Verification Test Cases
- [ ] **TC-ST-01 (Master List Layout, Collapsed Filter Toggle & Full Catalog Load):** Navigate to `REPORTS` ➔ `Stock Transactions` (`/reports/stock-transactions` or `/transaction-report/list`). Verify heading `Product Stock Transactions`, filter panel off (collapsed) by default and expandable via the top-right Funnel button, right-aligned search card, 15 Title-Case columns with distinct pink/transit-beige/ordered-grey tints, and all active Product Master SKUs loaded with populated `Brand` and `Sub Category`.
- [ ] **TC-ST-02 (Product Name Click ➔ Per-Product Ledger Navigation):** Click any product name in `Product Stock Transactions` (e.g. `Air Timer (PFS)` or `Vertical Stand Economy`). Verify browser navigates to `/stock-transaction/list/<id>`, sidebar highlights `REPORTS` ➔ `Stock Transactions`, heading displays `<Product Name> Stock`, and `AVAILABLE QTY` matches the product's net stock.
- [ ] **TC-ST-03 (All 5 Transactional Sources & Bold Party Name):** Verify movements from Sale Orders (`Sale` `- qty` with bold company name on line 2, plus `Sale Cancel` `+ qty`), Stock Adjustments (`Stock IN` / `Stock OUT` formatted as `Stock In/Out For Purpose <Purpose> (Adjustment Order #<No>)`), Confirmed Local Purchases (`Local Purchase` `+ qty`), Import Purchases (`Import Purchase` `+ qty`), and Stock Transfers (`Transfer OUT` `- qty` & `Transfer IN` `+ qty`) appear newest-first with IST `DD-MM-YYYY hh:mm AM/PM` timestamps.
- [ ] **TC-ST-04 (Toolbar Pagination, Live Search, Filter Panel & Action Menu):** On `/stock-transaction/list/:id`, verify default `10` `Items/Page`, `Showing X To Y Of Z Entries` footer, live `Search...` filtering by company/SO#/actor, Funnel filter updating `AVAILABLE QTY` when scoped to a warehouse, clickable `Title` links opening underlying documents, and `Action ▾` exporting `.xlsx` / `.csv` or navigating to `Add Stock Adjustment` / `Add Stock Transfer`.

---
*End of Master Features & Testing Specification Manual. Maintained for Inhyma Solutions Enterprise ERP. Last updated: October 29, 2026 (Sections 61-73: Dynamic Organization Company Logo, Product Master Category Rewiring & Floating Duplicate Overlay, Platform Migration Idempotency, Sales Process Workflow & 13-Field Filter Grid, HRMS Phases 2-6 RBAC & Approval Architecture, Feed & Broadcast Open Access & 1-to-1 Employee Messaging, Sale Status Update Side Drawer & Chronological Timeline, Discount Payments Multi-Installment Ledger, Product Re-Order Branch-Scoped Matrix & FIFO Stock Breakup, and Product Stock Transactions Master List & Per-Product Stock Transaction Ledger).*
