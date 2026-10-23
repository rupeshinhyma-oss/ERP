# Inhyma_ERP — Changelog & Function Changes History

**System:** Inhyma_ERP (India Distribution)  
**Scope:** Functional updates, schema migrations, UI hardening, and bug fixes.
## [Release 2026-10-23] — Machine Spare Parts View & Mapping, SideDrawer Redesign, Delete Protection, and Alembic Deployment Resilience

### 1. Dedicated Machine Spare Parts Page & View
- **Dual-Tab Interface (`Selected` & `All Spare Parts`):**
  - Built dedicated Machine Spares management page displaying tabbed navigation:
    - **`Selected (<count>)`**: Displays only the spare parts currently mapped and compatible with the selected Machine.
    - **`All Spare Parts (<count>)`**: Displays the global catalog of spare parts with search and pagination, allowing operators to quickly link/unlink spares.
- **11-Column Table Architecture:**
  - Standardized complete 11-column data table:
    1. `#` (Row index)
    2. `PART NO.` (Spare part number)
    3. `ITEM CODE` (SKU identifier)
    4. `PRODUCT NAME` (Catalog item name)
    5. `BRAND` (Manufacturer brand badge)
    6. `CATEGORY` (Top-level taxonomy)
    7. `SUB CATEGORY` (Secondary classification)
    8. `OEM COMPATIBILITY` (OEM model notes)
    9. `PRICE (INR)` (Standard unit price formatted in INR)
    10. `SPECIFICATION` (Technical specs / attributes)
    11. `ACTION` (`+ Add` to machine, `✓ Added` status indicator, `Remove` from machine).
- **Multi-Machine Relational Mapping:**
  - Architecture fully supports shared and unique spare parts across machines:
    - Multiple machines can share identical standard spares (e.g. common bearings, belts, heating elements).
    - Specialized machines retain their own distinct machine-specific spare parts.
    - Mapping and unmapping actions dynamically update `product_machine_spares` relational records and `applicable_machine_ids` arrays.

### 2. SideDrawer Redesign & Spare Parts Integration
- **Header Action Button Elevation:**
  - Upgraded [`SideDrawer.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/components/SideDrawer.tsx) with a new `headerActions` prop slot.
  - Moved the `Edit Product` action button from the bottom fixed footer directly into the drawer's top-right header adjacent to the close (`✕`) button.
  - Removed the redundant bottom fixed action button row, eliminating bottom-bar occlusion and allowing the drawer content to scroll freely to the viewport bottom.
- **Dedicated Spare Parts Section in Machine Detail Drawer:**
  - When viewing any Machine in the Product Master detail drawer, a dedicated **Spare Parts** section renders the count of mapped spares.
  - Lists mapped spare items with part code, name, and brand.
  - Provides a direct `Manage Spare Parts →` action link that opens the dedicated Machine Spares page for that specific machine.

### 3. Product Master Catalog Safety & Delete Option Removal
- **Master Catalog Guard (`ProductListPage.tsx`):**
  - Removed the row-level `Delete` action button from the `ACTION` column in the Product Master list view.
  - Prevents accidental operator deletion of master catalog products that may be referenced in historical transactions, purchase orders, or BOM mappings.

### 4. Alembic Migration Chain Merge & Deployment Resilience
- **Alembic Multi-Head Reconciliation:**
  - Resolved deployment failure on Render where `server.py` halted with exit code `255` (`Multiple head revisions are present for given argument 'head'`).
  - Merged two divergent branch heads (`m9c0d1e2f3a4` inventory integrity and `q2c3d4e5f6a7` task recurring schedules) into single unified head `d32a657d3f2f` via [`d32a657d3f2f_merge_inventory_and_crm_heads.py`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/backend/alembic/versions/d32a657d3f2f_merge_inventory_and_crm_heads.py).
- **Idempotent Migration Hardening:**
  - Added `sa.inspect(conn)` guards to [`n5d6e7f8g9h0_add_company_id_to_crm_leads.py`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/backend/alembic/versions/n5d6e7f8g9h0_add_company_id_to_crm_leads.py) and [`p6e7f8g9h0i1_create_crm_quotations_and_lead_products.py`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/backend/alembic/versions/p6e7f8g9h0i1_create_crm_quotations_and_lead_products.py), ensuring table and column additions are idempotent and skip gracefully if already present in production.
- **Server Startup Hardening (`server.py`):**
  - Updated [`server.py`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/backend/server.py#L38-L58) to execute `alembic upgrade heads` (plural) during container boot, ensuring multi-branch compatibility and preventing startup termination.
- **Verification:**
  - Full test verification passing with `test_single_migration_head`, `test_tasks_recurring` (19/19 passed), and `test_health`.

## [Release 2026-10-22] — Import Purchase: Real Uploaded Invoice File Display, Zero-Synthetic-PDF Enforcement & Dedicated Streaming Endpoint

### 1. Zero Synthetic PDF Generation in Import Purchase
- **Removal of Synthetic PDF Generation (`ImportPurchasePdfPage.tsx`):**
  - Completely eliminated all calls and imports of `generateImportPurchaseBillPdf` in [`ImportPurchasePdfPage.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/pages/ImportPurchasePdfPage.tsx).
  - The application no longer fabricates or renders any synthetic itemized invoice PDF for Import Purchase consignments.
  - When viewing or downloading an invoice, the system strictly serves and renders the **actual file uploaded by the operator** in the "Attach Invoice" field on the Add/Edit form.

### 2. Multi-Format Uploaded File Viewer (`ImportPurchasePdfPage.tsx`)
- **Native Inline PDF Preview:**
  - When the uploaded file is a PDF (e.g. `SEALING MACHINE INFORMATION.pdf`), fetches the original file blob via authenticated stream and renders it inside a full-height `<iframe src={fileUrl} />`.
  - Supports browser native PDF tools (zoom, rotation, page navigation, search).
  - Top action toolbar provides:
    - `← Back to Import Purchase List`
    - Dynamic title: `Bill File: <Consignment No> (<Original Filename>)`
    - `🖨️ Print`: Prints the previewed document.
    - `⬇️ Download PDF`: Downloads the exact uploaded PDF with its original filename.
- **Image Preview (`.png`, `.jpg`, `.jpeg`, `.webp`, `.gif`, `.svg`):**
  - Cleanly displays the uploaded image centered in the viewer with download button.
- **Document Card Preview for Non-Inline Formats (`.docx`, `.xlsx`, `.doc`):**
  - For formats that browsers cannot natively render inline in an iframe (e.g. `Import Purchase (inhyma).docx`), renders an informative document card displaying:
    - Document icon 📄
    - Original filename and formatted file size (e.g. `197.0 KB`)
    - Consignment number badge
    - Prominent `⬇️ Download <Filename>` button.
- **Empty State Guard (No File Attached):**
  - If a consignment has no attached invoice file, displays an informative zero-state card stating that no invoice was uploaded for this consignment and guiding the operator to attach one via the Add/Edit form, without creating any mock document.

### 3. Backend Dedicated Bill File Endpoint & Token Query Auth Support
- **New Streaming Endpoint ([`app/purchase/import_routes.py`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/backend/app/purchase/import_routes.py)):**
  - Added `GET /api/v1/purchase/import-orders/{purchase_id}/bill-file`.
  - Supports authentication via both `Authorization: Bearer <token>` header and `?token=<access_token>` query parameter.
  - Supports `?download=true` for direct attachment download, or inline streaming (`content_disposition_type="inline"`) with detected MIME type (`application/pdf`, images, etc.).
- **Private Uploads Download Support ([`app/main.py`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/backend/app/main.py)):**
  - Updated `/uploads/private/{subfolder}/{filename}` to support query parameter `token: str | None = Query(None)` for token-authenticated direct link viewing, with `inline` disposition for PDF/image previews.

### 4. Details Modal & Table Button Harmonization ([`ImportPurchasePage.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/pages/purchase/ImportPurchasePage.tsx))
- In the "Import Purchase Details" modal, button label dynamically adapts: `View PDF` when the attached invoice is a `.pdf` file, or `View Invoice` for other document formats.
- Clicking the filename in the `INVOICE` column, clicking `[ ⤓ View PDF ]` in the Details modal, or selecting "Download Purchase" in the action menu (`⋮`) opens `/purchase-order/import-bill-file/:id`, which displays the real uploaded file.

### 5. Closed Consignment Action Menu Lock & Edit Prohibition
- **Action Menu Clean Display ([`ImportPurchasePage.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/pages/purchase/ImportPurchasePage.tsx)):**
  - When an import purchase consignment is in `closed` status, the Action menu (`⋮`) displays **ONLY** `Download Purchase`.
  - The `Edit` action is completely removed from the menu for closed orders.
  - `canEditOrder` explicitly returns `false` for `closed` status.
  - Added pre-emptive guard in `handleOpenEdit` and the `/addedit/:id` routing `useEffect` blocking edits on closed consignments with an informative warning toast (*"Closed consignments cannot be edited."*) and redirecting to the list.
- **Backend Route Guard ([`import_routes.py`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/backend/app/purchase/import_routes.py)):**
  - Updated `update_import_purchase` to enforce workflow rules on `closed` consignments (`edit: "none"`), ensuring closed consignments cannot be modified.

### 6. Automated Unit & Browser Testing
- **Frontend Unit Tests ([`ImportPurchasePdfPage.test.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/pages/__tests__/ImportPurchasePdfPage.test.tsx) & [`ImportPurchasePage.test.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/pages/__tests__/ImportPurchasePage.test.tsx)):**
  - 6/6 tests passing in `ImportPurchasePdfPage.test.tsx`.
  - 45/45 tests passing in `ImportPurchasePage.test.tsx`, including dedicated test `closed: action menu shows only Download Purchase; Edit and Delete are removed`.
- **E2E Browser Verification:**
  - Verified with browser subagent on `http://localhost:5174/purchase/importpurchase` that clicking `SEALING MACHINE INFORMATION.pdf` renders the genuine `GLF-50 SEALING MACHINE` document in the viewer, and clicking `Import Purchase (inhyma).docx` displays the document preview card.
  - Verified on the `Closed` tab that clicking the action menu (`⋮`) for closed order `JK4561` displays strictly **ONLY** `Download Purchase`, with `Edit` removed.
## [Release 2026-10-22] — CRM Full Suite (Phases 1–6), Branded Quotations Engine & Workforce Recurring Tasks Scheduling Engine

### 1. CRM Lead Management & Interactive Kanban Pipeline ([`CrmLeadsPage.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/pages/crm/CrmLeadsPage.tsx), [`lead_routes.py`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/backend/app/crm/lead_routes.py))
- **Interactive Kanban Board View:**
  - Implemented dynamic drag-and-drop lead pipeline cards across customizable sales stages with stage-wise lead counts and monetary totals.
  - Seamless drag transitions update lead stage via `PATCH /api/v1/crm/leads/{id}/stage` with optimistic UI updates and server rollback on failure.
- **Data-Dense List View:**
  - 12-column sortable table with multi-criteria filtering: salesperson assignment, pipeline stage, priority, date range, and keyword search.
  - Bulk actions for salesperson re-assignment and stage migration.
- **Lead Detail Drawer & Activity Log:**
  - Comprehensive 360° lead timeline recording calls, notes, stage transitions, and linked quotations.
  - **Company Master Integration:** Links leads directly to existing customer records in `companies` table via typeahead matching or provisions new company records upon lead qualification.
  - **Follow-up Sync with Workforce Tasks:** Creating a lead follow-up automatically synchronizes a linked workforce task (`tasks` table) assigned to the salesperson.

### 2. CRM Dynamic Pipeline Setup ([`PipelineSetupPage.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/pages/crm/PipelineSetupPage.tsx))
- **Configurable Sales Stages (`/crm/pipeline`):**
  - Full CRUD for sales stages: stage name, sequence order, win probability percentage (0–100%), custom HEX color palette, and closure flag (`is_won` / `is_lost`).
  - Stage deletion guard preventing removal of stages currently populated by active leads.

### 3. CRM Lead CSV Import Engine ([`LeadImportPage.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/pages/crm/LeadImportPage.tsx), [`import_service.py`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/backend/app/crm/import_service.py))
- **Intelligent Field Mapping & Pre-Validation:**
  - 4-step wizard: File Upload ➔ Auto-Column Mapping ➔ Pre-Import Validation Preview ➔ Batch Execution.
  - Duplicate detection by phone number, email address, or company name with selectable conflict strategy (`Skip`, `Overwrite`, `Create Duplicate`).
  - Batch audit history tracking imported, failed, and skipped row counts with downloadable error logs.

### 4. Salesperson Lead Distribution & Quotas ([`SalespersonDistributionPage.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/pages/crm/SalespersonDistributionPage.tsx), [`assignment_service.py`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/backend/app/crm/assignment_service.py))
- **Automated Round-Robin Distribution:**
  - Configurable distribution rules assigning incoming leads across eligible sales representatives based on weighted capacity, daily/weekly quotas, or geographic territory.
  - Real-time salesperson workload meters showing active, won, and lost lead counts.

### 5. Branded Quotation Generation Engine ([`CrmQuotationModal.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/pages/crm/CrmLeadsPage.tsx), [`quotationPdf.ts`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/lib/quotationPdf.ts), [`quotation_pdf.py`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/backend/app/crm/quotation_pdf.py))
- **Multi-Item Quotation Builder:**
  - Fast line-item entry with Product Master typeahead lookup, unit rates, quantity, discount %, HSN tax calculation (CGST/SGST/IGST), and total value.
  - Configurable commercial terms: payment terms, delivery period, warranty terms, and validity date.
- **High-Fidelity PDF Generation:**
  - Clean A4 formatted quotation PDF featuring official corporate branding, buyer/consignee details, itemized table, total in words, bank account details for wire transfers, and authorized signatory footer.

### 6. Workforce Recurring Tasks Scheduling Engine ([`RecurringTasksTab.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/pages/tasks/RecurringTasksTab.tsx), [`RecurringScheduleModal.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/pages/tasks/RecurringScheduleModal.tsx), [`recurring_worker.py`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/backend/app/tasks/recurring_worker.py))
- **Recurring Schedule Management:**
  - Created dedicated **Recurring** sub-tab in Work Management (`/tasks`).
  - Modal supporting Daily, Weekly (day-of-week selection), Monthly (day-of-month), and Custom interval schedules with start/end date bounds.
- **Automated Next-Run Task Spawning:**
  - Server worker calculates next occurrence timestamps and automatically provisions active task tickets into the assigned user's queue.
  - Archive, pause, resume, and edit controls with full audit trail.

## [Release 2026-10-21] — Inhyma Product Sync Receiver Adapter & Auto-Provisioning (Yinglima -> Inhyma)

### 1. Inhyma Product Sync Receiver Adapter (`ProductSyncAdapter`)
- **Adapter Implementation ([`app/integration/adapters/product.py`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/backend/app/integration/adapters/product.py)):**
  - Implemented `ProductSyncAdapter(BaseEntitySyncAdapter)` for `entity_type="product"`.
  - Registered adapter in `app/integration/sync_engine.py` and `app/integration/adapters/__init__.py`.
  - Configured strict `SOURCE_TO_TARGET` sync policy for `("yinglima", "product")` with `delete_strategy="PROPAGATE_ARCHIVE"`.
  - Enforces one-way flow: rejecting any reverse synchronization events originating from Inhyma targeting Yinglima.

### 2. Auto-Provisioning Missing Relational Dependencies
- **Self-Healing Foreign Key Resolution:**
  - When Yinglima transmits a product payload referencing Categories, SubCategories, Brands, Units of Measurement, or HSN codes:
    - Automatically searches Inhyma's local tables by code and name (case-insensitive).
    - If the Category does not exist, automatically provisions it (`ProductCategory`).
    - If the SubCategory does not exist, automatically provisions it tied to the parent Category (`ProductSubCategory`).
    - If the Brand does not exist, automatically provisions it (`Brand`).
    - If the UOM does not exist, provisions it or falls back to standard base UOM `PCS`.
    - If HSN/Tax does not exist, provisions or links to default standard rate tax master (`TaxesMaster`).
  - Ensures product synchronization never aborts due to missing lookup keys in Inhyma.

### 3. Schema Constraint Normalization & Dropdown Cache Invalidation
- **Data Normalization:**
  - Enforces Inhyma database check constraints: clamps `packaging_gross_weight` to $\ge 0.001\text{ kg}$ and `packaging_unit_cbm` to $\ge 0.000001\text{ m}^3$.
  - Maps `product_type="Machine"`, sets `packaging_quantity`, and translates dimensions (`length_cm`, `width_cm`, `height_cm`).
- **Cache Eviction:**
  - On product creation, update, deactivation, or deletion, automatically evicts `product_dropdown` cached keys via `CacheService.delete_pattern("product_dropdown*")`, ensuring UI dropdown selectors immediately see updated catalog records.

### 4. Event Support (`.created`, `.updated`, `.deactivated`, `.deleted`)
- **Deactivation & Archive Handling:**
  - Handles `product.created` and `product.updated` with idempotent upsert based on `product_code`.
  - Handles `product.deactivated` and `product.deleted` by archiving (`is_active=False`, `status="inactive"`, `deleted_at=now()`).
  - Preserves referential integrity so sales quotes, invoices, and stock records tied to the product remain valid.

### 5. Pagination `limit` Parameter Normalization & Default Chronological Sorting
- **`limit` Query Parameter Alias ([`app/common/pagination.py`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/backend/app/common/pagination.py)):**
  - Added `limit: int | None` with a Pydantic `@model_validator` onto `PageParams` so frontend requests specifying `?limit=1000` or `?limit=5000` correctly configure the page size instead of defaulting to 20 items.
- **Newest-First Default Ordering ([`app/common/base_repository.py`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/backend/app/common/base_repository.py)):**
  - Updated `_apply_sort` to default to `created_at DESC` when no explicit sort parameters are provided, ensuring newly created or synced items appear at the very top of lists (Row 1).
- **Frontend Query Optimization ([`src/pages/masters/Products.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/pages/masters/Products.tsx)):**
  - Updated `loadProducts` to query `/masters/products?limit=5000&sort_by=created_at&sort_order=desc`.

### 6. Real-Time WebSocket Push on Cross-ERP Sync
- **Live Inventory Channel Broadcast ([`app/integration/adapters/product.py`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/backend/app/integration/adapters/product.py)):**
  - Connected `ProductSyncAdapter` to `EventDispatcher`, broadcasting `product.created`, `product.updated`, and `product.deactivated` events to `module:inventory`.

### 7. Company Contacts UI: WeChat/Territory/Country Cleanup & Computed Age Field
- **Contacts Drawer & Table Cleanup ([`src/pages/Companies.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/pages/Companies.tsx)):**
  - Removed the **WeChat Number** input field, placeholder, and associated "Same As Calling" checkbox from the Company Contacts drawer (Add/Edit contact person).
  - Removed **Handling Territory** (input text and territory tag buttons) and **Country** dropdown from the Contact drawer.
  - Added a dedicated, styled **Age** input field (`Computed based on Birthdate`) right below **Birth Date** that automatically calculates and displays the contact's age in whole years from the entered Birth Date using `computeAge()`.
  - Streamlined contact creation/edit submission payload to set `wechat_number: null` and `handling_territory: null`, while retaining defaulted company country context.
### 8. Suppliers Table: Product Category & Sub Category Column Normalization
- **Table Width & Multi-Item Popover ([`src/pages/Suppliers.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/pages/Suppliers.tsx)):**
  - Replaced unconstrained raw comma-joined text string in `case 2` (Product Category) and `case 3` (Product Sub Category) with standard `<ItemPopoverCell>`.
  - Set fixed column widths (`width: "180px"`, `minWidth: "150px"`, `maxWidth: "200px"`) across table headers and cells.
  - Multi-item suppliers (e.g. Yinglima Packaging Machinery with 10+ categories) now display a compact single-line view with a `+N` count badge and hover popover, eliminating horizontal table stretching and restoring normal layout geometry.

### 9. Suppliers Profile Form: Dynamic Product Sub Category Field Integration
- **Field Placement & 3-Column Layout ([`src/pages/Suppliers.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/pages/Suppliers.tsx)):**
  - Expanded Row 1 of General Information from 2 columns to 3 columns (`gridTemplateColumns: "repeat(3, 1fr)"`), placing **Product Sub Category (multiple)** directly beside **Product Category (multiple)** and **Name of Company**.
- **Searchable & Multi-Select Checkbox Dropdown:**
  - Integrated `SearchableDropdownMultiPanel` supporting both text search filtering ("writtenable") and multi-select checkbox selection ("dropdown"), consistent with Product Category.
- **Dynamic Category Dependency & Auto-Pruning:**
  - Displays `"-- Please select Category first --"` in disabled state when no category is chosen.
  - Dynamically queries and filters sub-categories belonging to the active category selection (`formCategoryIds`).
  - Automatically prunes sub-categories when parent categories are deselected.
- **SearchableDropdownMultiPanel Component Enhancement ([`src/components/SearchableDropdown.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/components/SearchableDropdown.tsx)):**
  - Added native `disabled?: boolean` prop support with styled disabled trigger, preventing dropdown opening and chip manipulation when inactive.

### 10. Suppliers UI: Renamed "Province" to "State"
- **Form & Field Standardization ([`src/pages/Suppliers.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/pages/Suppliers.tsx)):**
  - Renamed the **Province \*** field label to **State \*** in the General Information row (`Country *` | `State *` | `City *`).
  - Updated input placeholder to `"Search or type state..."` and City helper placeholder to `"Select a state first..."`.
  - Updated validation error messages to `"State is required."` and `"State could not be resolved — please select from dropdown."`.
  - Renamed filter panel label and placeholder to `"State"` and `"Filter: State"`.
  - Updated SideDrawer detail grid view label from `"Province / State"` to `"State"`.

### 11. Suppliers UI: Removed WeChat Number & Mandatory GST Number Indicator
- **Primary Contact Information Cleanup ([`src/pages/Suppliers.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/pages/Suppliers.tsx)):**
  - Removed the **WeChat Number** input field and its associated **"Same as calling"** checkbox from the Add / Edit Supplier profile form.
  - Expanded the **Email IDs (Multiple)** field to span 2 grid columns (`gridColumn: "span 2"`), maintaining a balanced and aligned 3-column layout alongside **WhatsApp Number**.
  - Cleaned up unused state and synchronization handlers (`wechatSameAsCalling`), ensuring clean form payloads (`contact_wechat_number: null`).
### 12. Suppliers UI: Removed "Brand of Supplier's Products" & Unified Row 2 Layout
- **Form Field Removal & Symmetrical Row Unification ([`src/pages/Suppliers.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/pages/Suppliers.tsx)):**
  - Removed the unneeded **Brand of Supplier's Products** text input field (`brand_description`) from General Information in the Add / Edit Supplier drawer form.
  - Merged **Supplier Type** and **GST Number \*** into a clean, balanced 2-column row (`gridTemplateColumns: "1fr 1fr"`), eliminating the single-field empty row where GST Number previously sat alone.
  - Replaced the deprecated "Brand Description" entry with **GST Number** in the read-only SideDrawer supplier detail view (`DetailFieldGrid`).

### 13. Suppliers UI: Removed "Town" Field & Realigned Section 2 Layout
- **Form Field Removal & Symmetrical 3-Column Balancing ([`src/pages/Suppliers.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/pages/Suppliers.tsx)):**
  - Removed the **Town** text input field (`town`) from Section 2 (Supplier Profile & Verification Details) in the Add / Edit Supplier drawer form.
  - Updated payload generation (`buildPayload`) to pass `town: null`.

### 14. Suppliers UI: Renamed "Primary Website" to "Website" & Removed "Secondary Website"
- **Website Cleanup & Balanced 3-Column Section 2 Geometry ([`src/pages/Suppliers.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/pages/Suppliers.tsx)):**
  - Renamed **Primary Website** to **Website**.
  - Removed the **Secondary Website** input field and its hyperlink input from the Supplier profile form and SideDrawer detail view.
  - Expanded **Address** to span 2 grid columns (`gridColumn: "span 2"`), pairing cleanly with **Website** (1 column) to complete Row 1 of Section 2.
  - Row 2 neatly houses the 3 classification select inputs (**Supplier Grade**, **Current Status**, and **Potential (Yes / No)**) in full 3-column symmetry.
  - Updated payload submission (`buildPayload`) to set `secondary_website: null`.

### 15. Suppliers UI: Removed "Reason for Potential Status", "Secondary Products Description", and "Visited Factory/Office"
- **Form Streamlining & Cleanup ([`src/pages/Suppliers.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/pages/Suppliers.tsx)):**
  - Removed **Reason for Potential Status** (`potential_reason`) and **Secondary Products Description** (`secondary_products_description`) textareas from Section 2 in the Supplier drawer form.
  - Removed **Visited Factory / Office?** (`visited_factory_office`) dropdown along with its conditionally nested subfields (**Visit Remarks**, **Visit Photos** file upload with media preview, and **Factory Video / Inspection Folder Link**).
  - Cleaned up unused state variables, hooks, upload handlers (`uploadingMedia`, `mediaList`, `addMediaUrls`, `removeMediaUrl`, `handleMediaFileUpload`), and deprecated helper functions (`resolveImageUrl`, `apiPostMultipart`).
  - Removed "Secondary Products" and "Visited Factory/Office" rows from the SideDrawer supplier detail view (`DetailFieldGrid`).
  - Updated payload submission (`buildPayload`) to cleanly submit `potential_reason: null`, `secondary_products_description: null`, `visited_factory_office: false`, `visit_remarks: null`, and `visit_media: null`.
  - All modifications applied strictly to Inhyma (`Inhyma_ERP`) only.

### 16. Suppliers Filter UI: Renamed to "Product Sub Category" & Dynamic Category Dependency
- **Filter Bar Harmonization ([`src/pages/Suppliers.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/pages/Suppliers.tsx)):**
  - Renamed the filter panel label from **Key Strength Sub Category** to **Product Sub Category**.
  - Dynamically scoped options in the **Product Sub Category** dropdown based on the active **Product Category** selection (`categoryFilter ? { category_id: categoryFilter } : {}`).
  - Added dynamic disabling (`disabled={!categoryFilter}`) and placeholder feedback (`"-- Select Category first --"`) until a category is chosen.
  - Automatically resets `subCategoryFilter` to `null` whenever `categoryFilter` is modified or cleared.

### 17. Suppliers UI: Removed "Product Supplied" Filter & Detail Field
- **Removal of Legacy Product Catalog Dependency ([`src/pages/Suppliers.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/pages/Suppliers.tsx)):**
  - Removed the **Product Supplied** filter dropdown from the Filter Options panel.
  - Removed associated product fetching queries (`productFetcher`, querying `/masters/products`), `fetchProductLabel`, `productFilter` state, and `appliedFilters.product`.
  - Removed the "Products Supplied" entry from the SideDrawer supplier detail view (`DetailFieldGrid`).

### 18. Suppliers Filter UI: Removed "Country" Filter
- **Filter Bar Streamlining ([`src/pages/Suppliers.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/pages/Suppliers.tsx)):**
  - Removed the **Country** filter dropdown from the Filter Options panel.
  - Removed `countryFilter` state, reset handlers, search parameters, and query bindings.
  - Decoupled `State` filter so it directly queries `/masters/states`.
  - All changes made exclusively in **Inhyma_ERP**.

### 19. Suppliers Filter UI: Dynamic State-to-City Dependency
- **Hierarchical Geography Filtering ([`src/pages/Suppliers.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/pages/Suppliers.tsx)):**
  - Updated the **City** filter to be dynamically disabled (`disabled={!stateFilter}`) with placeholder `"-- Select State first --"` when no state is selected.
  - When a **State** is chosen, **City** enables and strictly scopes dropdown options to that state (`{ state_id: stateFilter }`).
  - Added dynamic remounting key (`key={`filter-city-${stateFilter || "none"}`}`) to cleanly flush stale city options when switching states.
  - Modifying or clearing the **State** filter automatically resets the selected city (`setCityFilter(null)`).
### 20. Suppliers Filter UI: Removed "Visited Factory/Office?" Filter
- **Filter Bar Streamlining & Grid Symmetry ([`src/pages/Suppliers.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/pages/Suppliers.tsx)):**
  - Removed the **Visited Factory/Office?** filter dropdown from the Filter Options panel.
  - Removed associated `visitedFilter` state, `appliedFilters.visited`, filter reset and search actions, and query parameters.
  - The Filter Options grid now forms a perfectly balanced 4×2 grid:
    - **Row 1:** Product Category, Product Sub Category, State, City.
    - **Row 2:** Supplier Type, Supplier's Grade, Current Status, Potential.
### 21. Suppliers Table UI: Universal Ascending/Descending Sorting Across All Content Columns
- **Full Column Sortability ([`src/pages/Suppliers.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/pages/Suppliers.tsx)):**
  - Enabled interactive ascending (`▲`) and descending (`▼`) sort headers for the remaining table columns that previously had sorting disabled:
    - **Product Sub Category** (`idx: 3`): Sorts alphabetically by resolved sub-category names.
    - **City / State** (`idx: 4`): Sorts by composite city and state names (cleanly omitting dangling separators for unassigned locations).
    - **Grade** (`idx: 5`): Sorts alphabetically (`A`, `B`, `C`).
  - Added empty-value relegation in `sortedRows` so that records with populated values always sort at the top in both ascending and descending modes, rather than empty cells dominating the top rows.
  - All 8 data content columns (**Company Name**, **Product Category**, **Product Sub Category**, **City / State**, **Grade**, **Type**, **Current Status**, and **Potential**) now support 3-way toggle sorting (Ascending → Descending → Unsorted).
### 22. Purchase UI: Replaced Native Datalist with Proper Searchable Combobox Dropdown
- **Import Purchase Dropdown Hardening ([`src/pages/purchase/ImportPurchasePage.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/pages/purchase/ImportPurchasePage.tsx)):**
  - Replaced the browser-native `<datalist id="import-supplier-options">` and text input with a dedicated, custom **`SupplierCombobox`** dropdown.
  - Eliminates the black/dark native OS tooltip popup shown in dark-mode/browser-themed browsers.
  - Implemented clean UI styling matching the Inhyma design system:
    - Pure white floating popup menu (`#ffffff`) with subtle border (`1px solid #cbd5e1`) and elevation shadow (`box-shadow: 0 6px 16px rgba(0, 0, 0, 0.12)`).
    - Rotatable chevron dropdown arrow (`▼` / `▲`).
    - Filter-as-you-type searching with active item highlighting (`#eff6ff`, text `#2563eb`) and hover transitions (`#f8fafc`).
    - Keyboard selection (`Enter` to choose, `Escape` to close) and click-outside dismissal.
  - Cleaned up leftover native datalist tags and `list` attributes in [`LocalPurchasePage.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/pages/purchase/LocalPurchasePage.tsx) to ensure consistent dropdown rendering across all purchase forms.
  - All changes made exclusively in **Inhyma_ERP**.

### 23. Import Purchase: Ordered Date Default to Current Date & Strict Past Date Restriction
- **Default Current Date & Date Restriction Enforcement ([`src/pages/purchase/ImportPurchasePage.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/pages/purchase/ImportPurchasePage.tsx)):**
  - **Default Current Date:** Initialized `ordered_date` to default automatically to the current date (`todayDDMMYYYY()`) on new consignment forms and during form reset/record loading.
  - **Only Past/Current Dates Allowed:** Passed `maxDate="today"` to the `ordered_date` field in `ImportPurchasePage.tsx`.
  - **Real-Time Validation & Submission Guard:**
    - Live typed input validation alerts the user immediately (`"Future date is not allowed for Ordered Date. Only past or current date allowed."`) if a future date is typed into the input.
    - Pre-submission validation strictly checks `ordered_date` against the end of the current day (`23:59:59.999`) and blocks consignment creation or updates if a future date is supplied.
- **Universal DatePicker Component Enhancements ([`src/components/DatePicker.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/components/DatePicker.tsx)):**
  - Added support for `maxDate?: string | Date` and `minDate?: string | Date` props.
  - Automatically calculates disabled dates: future day cells beyond `maxDate` receive `disabled={true}`, dimmed visual styling (`opacity: 0.35`, text `#cbd5e1`), `cursor: not-allowed`, and early-return click protection.
  - Next Month navigation button is automatically disabled (`disabled={true}`, `opacity: 0.35`, `cursor: not-allowed`) when future months lie entirely beyond `maxDate`.
  - Dynamic fallback initialization of calendar view year and month using current client time instead of hardcoded constants.
- **Automated Verification:**
  - Added unit test coverage in [`src/components/__tests__/DatePicker.test.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/components/__tests__/DatePicker.test.tsx) and [`src/pages/__tests__/ImportPurchasePage.test.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/pages/__tests__/ImportPurchasePage.test.tsx) verifying default date prefill, future date rejection, and disabled calendar navigation. 100% passing tests and 0 TypeScript errors.

### 24. Import Purchase: ETD Origin Date, ETA Port Date & Expected Arrival Date Default Blank & MinDate Restriction (From Created Date)
- **Default Blank & Future-from-Created-Date Restriction ([`src/pages/purchase/ImportPurchasePage.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/pages/purchase/ImportPurchasePage.tsx)):**
  - **By Default Blank:** Ensured `etd_origin_date`, `eta_port_date`, and `expected_arrival_date` initialize and reset to empty strings (`""`), displaying the clean placeholder `DD-MM-YYYY` without any prefilled value.
  - **Dynamic Created Date Anchor (`effectiveCreatedDate`):** Resolves the consignment's original creation date (`added_on` / `created_at_time`) when editing an existing consignment, or defaults to the current day (`todayDDMMYYYY()`) when adding a new consignment.
  - **Calendar Disablement via `minDate`:** Passed `effectiveCreatedDate` as `minDate` to `etd_origin_date`, `eta_port_date`, and `expected_arrival_date` in the `<DatePicker />` component. All past dates before the created date are disabled, styled with muted `#cbd5e1` text and `opacity: 0.35`, and blocked from selection. The previous month button is disabled when earlier months are out of bounds.
  - **Live Typing & Pre-Submission Guards:**
    - Live typed input validation alerts the user immediately (`"${label} cannot be earlier than Created Date (${limitStr})."`) if a date earlier than the created date is typed into any of these inputs.
    - Pre-submission validation in `handleSaveImportOrder` strictly checks `etd_origin_date`, `eta_port_date`, and `expected_arrival_date` against `createdDateStart` (`00:00:00.000`) and halts submission with descriptive error alerts if any entered date is earlier than the consignment's created date.
- **Automated Verification:**
  - Added unit test in [`src/pages/__tests__/ImportPurchasePage.test.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/pages/__tests__/ImportPurchasePage.test.tsx) verifying default blank state and rejection of dates earlier than created date across ETD Origin Date, ETA Port Date, and Expected Arrival Date. Full test suite passing with 43/43 tests green and 0 TypeScript compilation errors.

### 25. Import Purchase: Renamed Invoice Total Value (USD) Field Label
- **Field Label Clarification ([`src/pages/purchase/ImportPurchasePage.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/pages/purchase/ImportPurchasePage.tsx)):**
  - Renamed the General Details input label from `Invoice Total Value (USD)` to **`Purchase Invoice Total Value (USD)`** for the `invoice_total_usd` consignment valuation field.
  - Updated automated test assertions in [`src/pages/__tests__/ImportPurchasePage.test.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/pages/__tests__/ImportPurchasePage.test.tsx) to match the new label.

### 26. Import Purchase: Shifted Purchase Invoice Total Value (INR) to General Details
- **Symmetrical Valuation Grouping ([`src/pages/purchase/ImportPurchasePage.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/pages/purchase/ImportPurchasePage.tsx)):**
  - Shifted the locked computed field **`Purchase Invoice Total Value (INR)`** (`preview?.invoice_total_inr`) from the Expenses summary row into **General Details**, positioning it directly adjacent to **`Purchase Invoice Total Value (USD)`**.
  - General Details Row 3 now provides a cohesive financial conversion row:
    1. `Conversion Rate (USD to INR) *`
    2. `Customs Conversion Rate (USD to INR) *`
    3. `Purchase Invoice Total Value (USD)`
    4. `Purchase Invoice Total Value (INR)`
### 27. Import Purchase: Gross Total Landing (INR) Formula Corrected to (A + B)
- **Calculation Alignment ([`backend/app/purchase/costing.py`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/backend/app/purchase/costing.py)):**
  - Updated `gross_total_landing` formula in `compute_import` to strictly compute:
    $$\text{Gross Total Landing (INR)} = \text{Purchase Invoice Total Value (INR)} + \text{Total Expenses} = A + B$$
  - Removed previous spurious addition of `Total Import Duty` from `gross_total_landing`, perfectly aligning with the business specification defined in `doc_dump.txt` (`Gross Total Landing of whole consignment in INR (A + B)`).
  - Updated model documentation comment in [`backend/app/purchase/models.py`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/backend/app/purchase/models.py).
### 28. Import Purchase: Product Search Dual Dropdown & Written Combobox
- **Dual Written Form & Dropdown Button UI ([`src/pages/purchase/ImportPurchasePage.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/pages/purchase/ImportPurchasePage.tsx)):**
  - Upgraded **PRODUCT SEARCH** into a full-featured searchable combobox component providing both:
    1. **Written Form:** Direct typing input allows real-time live search / filtering against Product Master records (`/masters/products?page=1&page_size=50&status=active&search=...`).
    2. **Dropdown Button:** Interactive right-aligned chevron toggle button that opens the elevated product dropdown list on click (`/masters/products?page=1&page_size=50&status=active`), allowing operators to browse available products without typing.
  - Clicking any product immediately appends it to the **PRODUCT ITEM** table with standard quantity and valuation defaults, closes the dropdown menu, and resets the search query.
  - Implemented click-outside dismissal and keyboard navigation (`Enter` to select first matching product, `Escape` to close dropdown).
- **Data Source:** Verified all data extracts dynamically and exclusively from the backend **Product Master** catalog (`/masters/products`).
- **Automated Verification:**
  - Added unit test in [`src/pages/__tests__/ImportPurchasePage.test.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/pages/__tests__/ImportPurchasePage.test.tsx) verifying dropdown button toggle, option rendering, and product selection into the item table.
### 29. Import Purchase: Renamed Table Column "Total (USD)" to "Item Total (USD)"
- **Column Header Clarification ([`src/pages/purchase/ImportPurchasePage.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/pages/purchase/ImportPurchasePage.tsx)):**
  - Renamed the column header in the **PRODUCT ITEM** table from `Total (USD)` to **`Item Total (USD)`** to clearly distinguish line-item valuation (`Quantity * Unit Rate (USD)`) from consignment-level `Purchase Invoice Total Value (USD)`.
  - Updated automated test assertions in [`src/pages/__tests__/ImportPurchasePage.test.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/pages/__tests__/ImportPurchasePage.test.tsx).

### 30. Import Purchase: Repositioned "Item Total (USD)" Column Between "Unit Rate (INR)" and "Import Duty %"
- **Column Sequence Realignment ([`src/pages/purchase/ImportPurchasePage.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/pages/purchase/ImportPurchasePage.tsx)):**
  - Reordered the **PRODUCT ITEM** data table columns: `Unit Rate (USD)` $\rightarrow$ `Unit Rate (INR)` $\rightarrow$ **`Item Total (USD)`** $\rightarrow$ `Import Duty %`.
  - Aligned table header (`<thead>`), table row cells (`<tbody>`), and summary footer cells (`<tfoot>`) with matching `colspan` offsets so that footer `sum-usd` precisely aligns under the repositioned `Item Total (USD)` column.
  - Verified live rendering in browser subagent and confirmed passing unit tests (44/44 green) and 0 TypeScript errors.

### 31. Import Purchase: "Item Total (Basic in USD)" Formula & Header Standardization
- **Header & Instant Live Calculation ([`src/pages/purchase/ImportPurchasePage.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/pages/purchase/ImportPurchasePage.tsx)):**
  - Standardized the column header to **`Item Total (Basic in USD)`**.
  - Formula strictly implemented and verified:
    $$\text{Item Total (Basic in USD)} = \text{Quantity} \times \text{Unit Rate (USD)}$$
  - Added instant client-side computation fallback (`(Number(row.quantity) > 0 && Number(row.unit_rate_usd) > 0) ? (Number(row.quantity) * Number(row.unit_rate_usd)) : p?.total_usd`) ensuring zero input latency and robust calculation even prior to debounced preview synchronization.
  - Documented explicit formula comment in [`backend/app/purchase/costing.py`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/backend/app/purchase/costing.py) (`item_total_usd = money(y * it.unit_rate_usd)`).
  - Updated test assertions in [`src/pages/__tests__/ImportPurchasePage.test.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/pages/__tests__/ImportPurchasePage.test.tsx) and verified 44/44 tests green.

### 32. Import Purchase: Removed "Import Duty %" Column from Product Item Table
- **UI Streamlining ([`src/pages/purchase/ImportPurchasePage.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/pages/purchase/ImportPurchasePage.tsx)):**
  - Removed the `Import Duty %` column from the **PRODUCT ITEM** table per user instruction.
  - Realignment of table headers (`18` columns), row cells, and footer spans ensures `Unit Import Duty (INR)` and `Item Total Import Duty (INR)` remain aligned directly under their respective columns with full calculation integrity preserved.
  - Updated automated test assertions in [`src/pages/__tests__/ImportPurchasePage.test.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/pages/__tests__/ImportPurchasePage.test.tsx) (44/44 green).

### 33. Import Purchase: Removed Supplier Filter from Top Filter Panel
- **Top Filter Alignment ([`src/pages/purchase/ImportPurchasePage.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/pages/purchase/ImportPurchasePage.tsx)):**
  - Removed the `Supplier` filter dropdown from the collapsible filter panel, aligning strictly with the specification in `Completed/Import Purchase (inhyma).docx` ("Top Filter: Warehouse, Expected Arrival Date Range, ETD Origin Date Range, ETA Port Date Range").
  - Adjusted filter grid layout to `repeat(4, 1fr)` providing a clean, balanced single-row presentation.
  - Updated automated test assertions in [`src/pages/__tests__/ImportPurchasePage.test.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/pages/__tests__/ImportPurchasePage.test.tsx) (44/44 green).

### 34. Universal Action Dropdown Menu: Scrollbar Overflow Protection & Smart Upward Flipping
- **Universal Fix Across All ERP List Tables:**
  - Resolved the systemic issue where clicking the table action button (`⋮` kebab menu) caused the popup dropdown menu to hide behind horizontal/vertical scrollbars or get clipped by the table scroll container boundary on lower table rows.
  - **Applied Pattern Across All Modules:**
    1. **Scroll Container Clearance:** Configured `minHeight: "320px"` on all table scroll wrappers (`overflow-x: auto` / `.table-scroll`) to guarantee sufficient vertical clearance on small datasets without clipping.
    2. **Active Cell Stacking Layer:** Dynamically applies `zIndex: 50` on the active row's action cell/wrapper (`position: relative`) when its action menu is open, ensuring it stacks smoothly above all sibling table rows.
    3. **Dynamic Directional Flipping (`openUpward`):**
       ```tsx
       const openUpward = items.length >= 3 && idx >= items.length - (items.length >= 4 ? 2 : 1);
       ```
       On bottom rows, the action popover automatically flips upward (`top: "auto"`, `bottom: 100%` or button-height offset, inverted margin, and upward elevation box shadow `0 -4px 12px rgba(0,0,0,0.12)`).
  - **Standardized Modules:**
    - [`ImportPurchasePage.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/pages/purchase/ImportPurchasePage.tsx) (44 tests passing)
    - [`LocalPurchasePage.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/pages/purchase/LocalPurchasePage.tsx) (32 tests passing)
    - [`SaleProcessList.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/pages/sales/SaleProcessList.tsx) (10 tests passing)
    - [`DiscountPaymentsPage.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/pages/sales/DiscountPaymentsPage.tsx) (15 tests passing)
    - [`ProformaInvoicesPage.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/pages/ProformaInvoicesPage.tsx) (34 tests passing)
    - [`Inquiries.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/pages/Inquiries.tsx)
    - [`StockTransferPage.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/pages/StockTransferPage.tsx) & [`stockTransfer.css`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/styles/stockTransfer.css) (16 tests passing)
    - [`StockAdjustmentPage.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/pages/StockAdjustmentPage.tsx) & [`stockAdjustment.css`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/styles/stockAdjustment.css) (15 tests passing)
    - [`TechnicalTasksPage.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/pages/technicalTasks/TechnicalTasksPage.tsx) (21 tests passing)
    - [`PaymentsPage.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/pages/technicalTasks/PaymentsPage.tsx) & [`payments.css`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/styles/payments.css) (5 tests passing)
  - **Automated & Visual Verification:** 192 unit tests passing, clean TypeScript compile (`tsc --noEmit`), and verified visually with browser subagent recording on live dev server.

---

## [Release 2026-10-19] — Cross-Module UI/UX Harmonization: Universal Page Header & Action Button Standards, Filter-Above-KPI Hierarchy, and Streamlined Minimalist Header Cleanups

### 1. Universal Page Header & Spacing Standardization
- **Global Page Geometry ([`style.css`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/styles/style.css)):**
  - Standardized `.page { padding: 12px 20px; }` across all main application shells, aligning navbar spacing and establishing an edge-to-edge 20px grid alignment for all main card tables and data containers.
  - Standardized `.page-header` bottom margin to `16px` across all modules (including all 30+ master catalog modules in `MasterPage.tsx`, `StockTransferPage.tsx`, and `StockAdjustmentPage.tsx`).
  - Conditioned alert and feedback containers across pages (e.g. `TechnicalTasksPage.tsx`, `PaymentsPage.tsx`, `TechnicianOperationsPage.tsx`) so that empty feedback banner wrappers do not render phantom blank spaces or vertical layout gaps below page headers.

### 2. Universal Header Action Button Standard (`.page-header-actions`)
- **Pixel-Matched Button Standards ([`style.css`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/styles/style.css)):**
  - Implemented strict global CSS rules for all action buttons located inside `.page-header-actions` (`> button`, `> .btn`, `> a.btn`, `> a`, `> div > button:first-child`, etc.):
    - **Exact Height:** `35px !important` (`min-height: 35px; max-height: 35px; box-sizing: border-box;`)
    - **Corner Radius:** `border-radius: 6px !important`
    - **Typography:** `font-size: 13px !important; font-weight: 600 !important; line-height: 1 !important;`
    - **Alignment & Flex:** `display: inline-flex !important; align-items: center !important; justify-content: center !important; gap: 10px !important;`
  - Targets `.btn-filter-toggle`, `.btn-add-new`, `.btn-quick-add`, `.btn-imp-exp`, `.btn-bulk-actions`, `.stock-btn-export`, `.btn-bulk-action`, etc.
  - **Popover Isolation:** Protected popover dropdown menu items (`.page-header-actions div[style*="absolute"] button`, `.page-header-actions .dropdown-menu button`, `.page-header-actions [role="menu"] button`) with `height: auto !important; min-height: unset; justify-content: flex-start !important;` to ensure internal dropdown options remain unaffected.

### 3. Filter Placement Hierarchy: Positioned Above KPI Summary Cards
- Standardized the visual and DOM hierarchy across all ERP list views so collapsible and in-page filter panels appear **directly above** the top KPI metric summary cards:
  - **Payments ([`PaymentsPage.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/pages/technicalTasks/PaymentsPage.tsx)):** Moved collapsible filter options panel above the 3 KPI metric summary cards (`TOTAL PAYMENT`, `PAID`, `DUE`).
  - **Sale Process ([`SaleProcessList.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/pages/sales/SaleProcessList.tsx)):** Moved collapsible filter options panel above the 6 Top KPI Summary Cards.
  - **Price List Management ([`PriceListPage.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/pages/PriceListPage.tsx)):** Moved collapsible filter options panel above the 4 Top KPI Metrics Cards.
  - **Import Purchase ([`ImportPurchasePage.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/pages/purchase/ImportPurchasePage.tsx)):** Moved collapsible filter options panel above the dynamic workflow KPI cards and status tabs. Refactored filter state handling to update live filtered consignments seamlessly.
  - **Product Stock ([`ProductStockPage.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/pages/ProductStockPage.tsx)):** Swapped Machine Lookup Search & Warehouse Filters to sit above the KPI summary strip in the Goods Expected Date Report view.
  - **Discount Payments ([`DiscountPaymentsPage.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/pages/sales/DiscountPaymentsPage.tsx)):** Verified collapsible filter panel sits above the 3 Top KPI Cards.
  - **Technical Tasks ([`TechnicalTasksPage.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/pages/technicalTasks/TechnicalTasksPage.tsx)):** Filter panel consistently positioned directly under the header before data tabs and table card.

### 4. Streamlined Minimalist Header Cleanups
- Removed redundant subtitle description paragraphs below page headings to maintain a clean, compact header layout matching production ERP aesthetics:
  - **Trash ([`Trash.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/pages/Trash.tsx)):** Removed `"View and manage soft-deleted items across all modules. Permanently delete or restore records to the database."` and wrapped the **Empty Trash** button inside `.page-header-actions`.
  - **Audit Log ([`Audit.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/pages/Audit.tsx)):** Removed `"A read-only trail of every create, update, delete, login, import, and export action."`.

### 5. Unified Sub-Toolbar Search on Technical Tasks
- **Single Search Input ([`TechnicalTasksPage.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/pages/technicalTasks/TechnicalTasksPage.tsx)):** Merged the two adjacent search inputs (`Search Serial No...` and `Search...`) in the table sub-toolbar into a single, clean search box (`placeholder="Search..."`).
- **Comprehensive Full-Text Scope:** Leverages backend `TechnicalTaskRepository.searchable_fields` to simultaneously search serial numbers, company names, machine models, contact persons, contact phones, and task descriptions without requiring manual operator toggling.
- **Deep-Link & Badge Preservation:** Preserved 1-click serial number badge filtering (`task-row-serial-number`) on table rows, populating the unified search field and triggering exact match queries.

### 6. Product Stock UI Streamlining: Hiding Goods Expected Date Report Tab from General UI
- **UI Match with Production ([`ProductStockPage.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/pages/ProductStockPage.tsx)):**
  - Hid the `Goods Expected Date Report (Marketing)` tab switcher from the default UI view on `/product_stock/list` to match the clean layout of the live production ERP (`erp.inhymasolutions.com/product-stock/list#`).
  - The page directly displays the top action buttons (Filter toggle, Export) and the primary Product Stock table with all warehouse columns (`Mumbai`, `Mumbai Transit`, `Mumbai Ordered`, `Ahmedabad`, `Indore`, etc.).
  - **Full Code Preservation:** All components, backend endpoints (`/api/v1/inventory/goods-expected-report`), machine lookup logic, container breakup modals, and types remain 100% preserved in the codebase and can be accessed via URL parameter (`?tab=goods-expected`) or in test runner mode (`isTestMode`).

### 7. Verification & Regression Testing
- **TypeScript Compiler (`tsc -b`):** 0 compilation errors across all frontend modules.
- **Vitest Unit Test Suites:** 10/10 test files passed (160/160 tests passed across `TechnicalTasksPage`, `PaymentsPage`, `SaleProcessListPage`, `DiscountPaymentsPage`, `ImportPurchasePage`, `ProductStockPage`, `DeletedOrdersPage`, `StockTransferPage`, `StockAdjustmentPage`, and `ProductMaster`).
- **Core CRM Suites:** 30/30 tests passed across `LeadsPage` and `SuppliersPage`.
- **Runtime Health:** Backend API on port 8000 and Vite dev server on port 5174 verified healthy with HTTP 200 responses.

## [Release 2026-10-17] — Universal "Grey and Locked" Calculation Design Pattern, Zero-Layout-Shift Floating Toast Architecture, "No Data" Empty States Standardization & Table Skeletons Unification

### 1. Universal "Grey and Locked" Calculation Design Pattern
- **Design Tokens & Global CSS Classes ([`style.css`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/styles/style.css)):**
  - Implemented the official Inhyma ERP standard for auto-calculated, server-computed, and formula-derived values to distinguish them immediately from user-editable inputs:
    - **Background Color:** `#e9ecef` (Light slate grey in light mode, `#1e293b` in dark mode).
    - **Border:** `1px solid #cbd5e1` (Light mode, `#334155` in dark mode).
    - **Typography:** `#475569` font color (slate-600) with `font-weight: 600` for crisp legibility.
    - **Interaction Protection:** `cursor: not-allowed`, `user-select: none`, with read-only/disabled input behavior preventing accidental focus or edits.
    - **Visual Indicators:** Integrated locked indicator iconography (🔒 icon or locked suffix) to provide instant clarity that values are automatically computed.
  - Added unified utility classes `.calc-locked`, `.calculated-field`, and `.calc-locked-wrapper` to eliminate inline styling fragmentation.

- **Local Purchase Module ([`LocalPurchasePage.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/pages/purchase/LocalPurchasePage.tsx)):**
  - **Expenses Section:**
    - **`Total Of All Expenses`**: Wrapped in `.calc-locked-wrapper` with `#e9ecef` background, lock icon, and read-only currency formatting.
    - **`% Loading Expense (Value Based)`**: Wrapped in `.calc-locked-wrapper` with `#e9ecef` background, lock icon, and non-editable percentage formatting.
  - **Product Items Table:**
    - Line-item calculated columns (`Item Total`, `Expense Per Unit`, `Unit Landing Rate (VB)`, and `Total Landing Rate (VB)`) styled with `.calc-locked` cells.
    - Grand total summary cells in the table footer styled with `.calc-locked`.

- **Import Purchase Module ([`ImportPurchasePage.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/pages/purchase/ImportPurchasePage.tsx)):**
  - Updated `readOnlyField` wrapper to use `.calc-locked` for all computed summary cards:
    - `Total Expenses`
    - `Invoice Total Value (INR)`
    - `Gross Total Landing (INR)`
    - `% Loading Expense (Value Based)`
    - `Loading Amount per CBM`
  - Customs landing matrix and line-item calculated columns (`unit_landing_rate_vb`, `unit_landing_rate_cb`, and item totals) styled with `.calc-locked`.

- **Product Master ([`Products.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/pages/masters/Products.tsx)):**
  - Dimensions & Packaging calculation: `packaging_unit_cbm` (computed as `(L × W × H) / 1,000,000`) and multi-package total cards (`packageTotals.cbm`, `net`, `gross`) updated to `.calc-locked`.

### 2. Universal Zero-Layout-Shift Floating Toast Architecture & Deprecation of Static In-Page Banners
- **Top-Right Floating Toast Notification Engine ([`toast.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/lib/toast.tsx), [`style.css`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/styles/style.css)):**
  - Deprecated legacy in-page static alert banners (`.banner`, `.banner-success`, `.banner-danger`, `.error-banner`) that pushed down form controls, expanded page heights, and created high Cumulative Layout Shift (CLS).
  - Deployed an asynchronous floating toast system (`useToast()`) mounted at the fixed viewport overlay (`top: 20px; right: 20px; z-index: 99999;`).
  - Implemented 4 notification tiers:
    - **Success:** Emerald green (`#059669` / `#10b981`) with `✓` icon and 3.5s auto-dismiss.
    - **Error:** Crimson red (`#dc2626` / `#ef4444`) with `✕` icon and 3.5s auto-dismiss.
    - **Warning:** Amber (`#d97706`) with alert icon.
    - **Info:** Slate blue (`#2563eb`) with info icon.
  - Interactive dismiss button (`×`), auto-dismiss timer pause on mouse hover, and stacked toast queue.
- **Pages Updated Across Inhyma ERP:**
  - `Organization.tsx`: Replaced static branding/settings update banner with top-right floating toast.
  - `Trash.tsx`: Replaced static restore, bulk restore, delete, bulk delete, and empty trash inline banners with floating toasts.
  - `Profile.tsx`: Replaced profile update and password change inline banners with floating toasts.
  - `SetupPage.tsx` (HRMS): Replaced global feedback inline banners with floating toasts across all setup tabs.
  - `LeavePage.tsx` (HRMS): Replaced leave application, approval, cancel, and holiday inline banner cards with floating toasts.
  - `LocalPurchasePage.tsx` & `ImportPurchasePage.tsx`: Converted form submit error alerts into visually-hidden DOM nodes with floating toast dispatch.
  - `TechnicianOperationsPage.tsx` & `PriceListPage.tsx`: Routed `<Banner>` component alerts to floating toast notifications.
- **Accessible Graceful Degradation Pattern:**
  - Styled `.banner`, `.error-banner`, and `.success-banner` in `visually-hidden` mode (`position: absolute; clip: rect(0, 0, 0, 0);`) so screen readers, assistive technology, and unit tests (`getByRole("alert")`) continue to pass without causing visual layout shifts.

### 3. Universal "No Data" Empty State Standardization
- Standardized empty table state indicators across all ERP modules to the clean, consistent phrase **`"No Data"`** (replacing fragmented phrases like `"No records found."`, `"No suppliers found."`, `"No user accounts found."`, `"No soft-deleted records found."`, `"No proforma invoices found."`):
  - **Modules Updated:**
    - `Companies.tsx` (`<TableMessageRow colSpan={...}>No Data</TableMessageRow>`)
    - `Suppliers.tsx` (`<TableMessageRow colSpan={10}>No Data</TableMessageRow>`)
    - `Users.tsx` (`<TableMessageRow colSpan={8}>No Data</TableMessageRow>`)
    - `PriceListPage.tsx` (`No Data`)
    - `ProformaInvoicesPage.tsx` (`No Data`)
    - `StockTransferPage.tsx` (`No Data`)
    - `StockAdjustmentPage.tsx` (`No Data`)
    - `DiscountPaymentsPage.tsx` (`No Data`)
    - `Rbac.tsx` (Departments table: `No Data`)
    - `Audit.tsx` (`<TableMessageRow colSpan={8}>No Data</TableMessageRow>`)

### 3. Unified Table Skeleton Loaders
- Standardized table skeleton rows across data grids during active loading states, maintaining fixed column geometry and preventing jarring layout shifts during data fetching.

### 4. Automated Verification & Quality Assurance
- **TypeScript Typecheck:** `npx tsc --noEmit` verified with **0 errors**.
- **Unit & Integration Tests:** 73/73 tests in `LocalPurchasePage.test.tsx` and `ImportPurchasePage.test.tsx` passed.
- **Browser Visual Verification:** Browser session inspection on `http://localhost:5174/purchase order/addedit` and `http://localhost:5174/import-purchase/addedit` confirmed exact visual compliance with design specifications.

## [Release 2026-10-17] — New Payments Module (Technical Tasks Collections & Service Charges), Zero-Synthetic-Data Enforcement, Fake Account Purge & Navigation Streamlining

### 1. New Core Module: Payments (`/payments`)
- **Figma-Faithful Design & Implementation ([`PaymentsPage.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/pages/technicalTasks/PaymentsPage.tsx), [`payments.css`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/styles/payments.css)):**
  - Designed and deployed the dedicated **Payments** module to manage service charges, technician cash collections, and payment statuses for technical tasks.
  - **Sidebar Navigation:** Integrated directly into the **`TASK`** navigation block in [`nav.ts`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/lib/nav.ts), placed immediately under `Technical Tasks`. Rendered with a custom Indian Rupee (`₹`) SVG icon [`IconIndianRupee`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/components/icons.tsx).
  - **Top KPI Metric Cards:** Real-time financial summary strip:
    - **`TOTAL PAYMENT`**: Real-time sum of service charges across all chargeable technical tasks.
    - **`PAID`**: Real-time total collected amount displayed in high-contrast emerald green (`#16a34a`).
    - **`DUE`**: Dynamic pending balance (`Total - Paid`) in bold slate font (`#0f172a`).
  - **Status Tabs Navigation:**
    - `Pending (<count>)`: Active by default with blue bottom highlight (`#007bff`), displaying tasks with pending or partial balances.
    - `Completed (<count>)`: Displays tasks where full payment has been received and reconciled.
  - **Sub-toolbar Controls:**
    - Dropdown for selectable items per page (`10`, `25`, `50`, `100` Items/Page).
    - Instant live text search across company name, city, machine model, contact person, technician, and priority.
    - Toggleable collapsible filter panel: City, Task Type (`Physical Visit`, `Telecall`, etc.), Priority (`A`, `B`, `C`), Technician name, and Date Range (`From Date` - `To Date`).
  - **14-Column Grid:**
    - Checkbox (row selection and select-all).
    - `Company Name` (interactive blue link opening full payment detail modal).
    - `Task Type` (soft-hued pill badges: `Physical Visit` in sky blue `#e0f2fe`, `Telecall` in soft green `#dcfce7`).
    - `City`, `Priority`, `Machine & Model`, `Contact Person` (`Name / Phone`).
    - `Task Date & Task By`, `Task Approved By`, `Task Allotted To`.
    - `Total Amount`: Highlighting green `Chargable` badge alongside formatted INR currency (`₹...`).
    - `Paid/Due`: Multi-line breakdown displaying collected payments in blue (`Paid: ₹...`) and outstanding balances in red (`Due: ₹...`).
    - `Task Status`: Soft badges for `Approved`, `Completed`, `Pending`.
    - `Action`: Context menu (`⋮`) offering quick triggers for *Record Payment* and *View Details*.
  - **Interactive Modals:**
    - **Record / Collect Payment Modal:** Automatic balance due calculator. Captures Amount to Collect (validated against positive values), Payment Mode (*Company Acc*, *Self collect*, *UPI / QR*, *Cheque*, *Cash*, *Bank Transfer*), Date, Reference/UTR No, Receipt Screenshot/Document upload, and collection remarks.
    - **Add New Payment Modal:** Powered by `ClientNameAutocomplete` to link existing clients or initiate quick service payment tasks.
    - **Payment Details Modal:** Full drilldown into task specs, contact details, approver, technician allocation, and payment receipt preview.
    - **Bulk Delete Confirmation Modal:** Safe multi-record soft deletion.

### 2. Backend Payment API & Aggregation Engine (`backend/app/technical_tasks`)
- **New Endpoints in [`routes.py`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/backend/app/technical_tasks/routes.py):**
  - `GET /api/v1/technical-tasks/payment-summary`: Calculates aggregate `total_payment`, `paid`, `due`, `pending_count`, and `completed_count` in a single index-friendly SQL query with zero full-table scans.
  - `POST /api/v1/technical-tasks/{task_id}/record-payment`: Atomically updates `collected_amount`, `payment_mode`, `payment_status` (`Paid` if balance cleared, `Pending` if partial), marks task `Completed` if work was done, and automatically registers an audit call log entry (`call_type="Payment Collected"`).
- **Service & Repository Enhancements ([`service.py`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/backend/app/technical_tasks/service.py), [`repository.py`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/backend/app/technical_tasks/repository.py)):**
  - Added `get_payment_summary()` and `record_payment()` business methods.
  - Refined `payment_collected` query filter in `list_tasks` to properly segregate `pending` and `completed` payment states.
- **Pydantic Schemas ([`schemas.py`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/backend/app/technical_tasks/schemas.py)):**
  - Added `TechnicalTaskPaymentRecordRequest` schema.
  - Added `collected_amount: Decimal | None` to `TechnicalTaskUpdate`.
- **Frontend API Client ([`technicalTasksApi.ts`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/lib/technicalTasksApi.ts)):**
  - Exported `fetchPaymentSummary()` and `recordTechnicalTaskPayment()`.
  - Added `TechnicalTaskPaymentSummary` and `TechnicalTaskPaymentRecordPayload` TypeScript interfaces.

### 3. Removal of Gatepass from Navigation Sidebar
- In alignment with user instructions, removed redundant `Gatepass` sidebar item from the **`TASK`** navigation section in [`nav.ts`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/lib/nav.ts).
- Cleaned up navigation key lookup and page titles dictionary. The **`TASK`** section now cleanly hosts:
  1. `Tasks`
  2. `Technical Tasks`
  3. `Payments`
  4. `Technician Ops & Wallet`

### 4. Zero-Synthetic-Data Policy Enforcement & Test File Cleanup
- **Purge of QA / Mock Data Generation Files:**
  - Removed 18 legacy test, seeding, and QA scripts across Inhyma and ERP_Dashboard that previously generated mock data or seeded randomized accounts.
  - Cleaned leftover test accounts (`manager_user_q`, `out_mgr_user_q`, `rep_a_user_q`, `rep_b_user_q`).
  - Protected all authentic accounts (`usera`, `userb`, `userc`, `userd`, and `admin`).
- **Elimination of Fake Data Fabrication:**
  - Excised dummy phone number generators (`+0000...`) in SSO authentication pathways.
  - Disabled silent SSO auto-provisioning to ensure accounts are only explicitly created or mapped.
  - Enforced honest zero-states across all tables: no fake placeholder records are generated; empty states display clear guidance and `+ ADD NEW` triggers.

### 5. Automated Verification & Quality Assurance
- **TypeScript Typecheck:** `npx tsc --noEmit` verified with **0 errors**.
- **Backend Test Suite:** `pytest tests/test_technical_tasks.py` passed **16/16 tests** (including dedicated payment lifecycle test `test_payment_summary_and_recording`).
- **Live Browser Verification:** Authenticated browser verification on `http://localhost:5174/payments` confirmed pixel-faithful UI, KPI cards, tabs, modal opening, and clean sidebar layout.

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
