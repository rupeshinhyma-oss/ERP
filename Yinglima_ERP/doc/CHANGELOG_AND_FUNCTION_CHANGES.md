# Yinglima_ERP — Changelog & Function Changes History

**System:** Yinglima_ERP (China Procurement)  
**Scope:** Functional updates, schema changes, UI hardening, and bug fixes.

## [Release 2026-10-26] — Product Master Dual-Mode Coexistence (Synced from Yinglima & Manually Added in Inhyma)

### 1. Unified Catalog Loading & De-Scoping Restrictive Query Blocks
- **Problem & Root Cause:**
  - Inhyma Product Master was artificially filtering products by requiring presence in `SyncedEntityMapping` or matching a hardcoded Inhyma organization UUID (`85c12bcb-10a1-4b1f-92ed-6ca72ac1b3b5`), and discarding non-matching codes in the frontend table.
  - This blocked newly added manual products from appearing or updating the record count.
- **Resolution:**
  - Reverted restrictive dynamic filtering in repository and frontend to standard catalog query without hardcoded UUID or sync subquery constraints.
  - Enabled seamless dual-mode coexistence: items synced from Yinglima and items manually created/imported in Inhyma are stored as standard records in `products` and load side-by-side with full pagination, search, sorting, and downstream ERP transactions support.

---

## [Release 2026-10-26] — Ecosystem SSO Bridge, Canonical ERP Key Normalization & Central Session Resilience

### 1. Canonical ERP Key Normalization (`app/federation/erp_keys.py`)
- **Key Normalization Engine:** Standardized `canonical_erp_key(raw)` to strip hyphens, underscores, spaces, and `erp` suffixes (e.g. `yinglima-erp` $\rightarrow$ `yinglima`).
- **Access Evaluation Hardening:** Aligned `erp_access_matches(allowed_erps, target)` and `describe_denial()` with ERP_Main control-plane registry, removing redundant `str()` conversions and preventing false-positive access denials during single-sign-on (SSO) handover.

### 2. Central Session Resilience & Account Error Isolation (`ssoBridge.ts`, `Login.tsx`)
- **Central Session Protection on Local Account Issues:** If SSO handover returns HTTP 401 due to a local account problem in this specific ERP ("No account exists for you", "account is not active", "must explicitly grant access"), the central ecosystem cookie is retained rather than deleted. The user remains logged in centrally and can access other permitted ERPs without global session disruption.
- **Dynamic Control Plane Routing:** Replaced hardcoded fallback URL (`http://localhost:5170/dashboard`) with `controlPlaneUrl(central)` dynamically loaded from the ERP registry. If a user is not permitted on this spoke, they are re-routed to their designated ERP or central dashboard with `sso_error` and detailed `sso_reason` parameters.

### 3. User Management Control Plane Alignment (`Users.tsx`)
- Standardized `centralUsersUrl` to resolve the control plane host strictly from the active ERP registry (`getEcosystemErps()`), eliminating hardcoded local development ports.

---

## [Release 2026-10-23] — Local Purchase Consignment Supplier Filtering & Shipment Planning All Entities Navigation Fix

### 1. Shipment Planning "All Entities" Sheet Navigation & Tab Switching Hardening
- **Business Need & Issue:**
  - In Shipment Planning (`/planning`), selecting `Entity: All Entities (Organizations & Buyers)` displays all 12 sheets across all organizations and buyers (`One Stop`, `Inhyma Mumbai`, `Mumbai`, `Chennai`, `dubaidarsh`, `Om Packaging`, `Prathamesh Packaging`, etc.).
  - Clicking any non-Inhyma sheet tab (e.g. `One Stop` or `Mumbai`) failed to load that sheet and immediately snapped back to `Inhyma Mumbai`.
- **Root Cause:**
  - In `Planning.tsx`, when `All Entities` mode (`tabOrganizationFilterId === null`) was active, updating URL query params via `setSheetUrlParam` triggered a background `useEffect` that saw `tabOrganizationFilterId === null` as uninitialized and forcefully set it back to `inhymaOrg.id`.
  - The sheet reconciliation effect then noticed that the clicked sheet was not in the Inhyma sheets list, immediately resetting `activeSheetId` back to `Inhyma Mumbai`.
- **Frontend Resolution (`Planning.tsx`):**
  - Added `hasInitializedOrgRef` to ensure initial default to Inhyma happens strictly once on initial mount if and only if no specific sheet or organization was requested.
  - When in `All Entities` mode (`tabOrganizationFilterId === null`), clicking any sheet tab preserves `null` so all tabs remain visible and the clicked sheet loads without interference.
  - Updated `setSheetUrlParam` and `SearchableEntityDropdown` `onChange` to clear `?org=` from the URL when `All Entities` is chosen.
  - Verified via `npx tsc --noEmit` (exit code 0).

### 2. Supplier-Scoped Consignment Item Extraction
- **Business Need & Issue:**
  - Shipment Planning consignments (e.g. shipping container `Mum 48`) contain planned items manufactured across 10+ different manufacturing vendors.
  - Selecting a consignment previously loaded all items from every vendor into the local purchase order table, leaving products from unrelated suppliers inside single-vendor invoices.
- **Backend Enhancements (`LocalPurchaseService.get_consignment_items` & Routes):**
  - Updated `GET /api/v1/purchases/local/consignments/{column_id}/items` to accept an optional `supplier_id` query parameter.
  - Queries both primary `Product.supplier_id` and secondary relationships in `SupplierProductLink` to ensure all products linked to the chosen supplier match.
  - Response includes `linked_supplier_ids` on each `ConsignmentProductItem`.
  - Added automated pytest suite: `tests/test_consignment_items_supplier_filter.py` (passed 100%).
- **Frontend Architecture (`frontend/src/pages/purchases/LocalPurchaseForm.tsx`):**
  - **Bidirectional Dynamic Filtering:**
    - If Supplier is selected &rarr; selecting Consignment immediately loads only that supplier's planned products from the container.
    - If Consignment is selected &rarr; selecting or changing Supplier immediately re-filters to that supplier's products with 0ms client-side latency.
    - If Consignment has multiple suppliers and no supplier is selected yet &rarr; prompts the user to select a supplier rather than dumping foreign vendor products into the bill.
    - If a supplier has 0 products in the chosen consignment &rarr; clears table and shows informative status badge and toast notification.
  - **Header Badge & Sync Hardening:**
    - Live badge displays: `📦 {N} planned item(s) for {supplier} from Consignment {code}` with a `Load Planned Items` button.
    - Prevented generic sheet planning queries (`/planning-items`) from overriding scoped consignment items when a consignment is active.

### 2. Local Purchase Domestic Purchase VAT % Source Resolution (HSN Purchase VAT Isolation)
- **Root Cause & Issue:**
  - When loading planned products from consignments (e.g. `Mum 48` for supplier `Prathamesh Packaging PVT LTD`), product `Carton boxes for band sealer without thermocol` (`PROD-MUM-0002`) loaded with `VAT % = 18%`.
  - In `LocalPurchaseService.get_consignment_items` (`service.py`), VAT % resolution code was:
    `vat_rate = float(hsn.gst_percent) if hsn and hsn.gst_percent is not None else ...`
  - This mistakenly fetched Indian GST (18.00%) into Chinese domestic procurement, rather than China domestic Purchase VAT (进项税 = 0.00% / 13.00%).
- **Backend Resolution (`LocalPurchaseService`):**
  - Updated `get_consignment_items`, `get_planning_items`, and `match_product` to resolve:
    1. `hsn.purchase_vat_percent` (if defined and non-null)
    2. Fallback to `product.purchase_vat_percent`
    3. Final default: `0.00%`
  - Indian GST (`gst_percent`) and Export Refund VAT (`refund_vat_percent`) are strictly excluded from Local Purchase calculations.
- **Frontend Resolution (`LocalPurchaseForm.tsx`):**
  - Updated `hsnLookup` and `productLookup` interfaces to include `purchase_vat_percent`.
  - Updated `handleAddProduct` from search catalog to resolve `resolvedHsnObj?.purchase_vat_percent ?? prod.purchase_vat_percent ?? 0`.
- **Verification:**
  - Automated tests in `tests/test_consignment_items_supplier_filter.py` passed 100%, verifying `PROD-MUM-0002` correctly resolves to `0.0%` Purchase VAT instead of `18%`.
### 4. Official Module Architecture & Workflow Manual Creation
- Created [`doc/YINGLIMA_ERP_OFFICIAL_MODULE_WORKFLOW_MANUAL.md`](file:///d:/Om%20work1/ERP/Yinglima_ERP/doc/YINGLIMA_ERP_OFFICIAL_MODULE_WORKFLOW_MANUAL.md) based strictly on active production codebase.
- Covers end-to-end operational lifecycle, architecture tables, and individual module guides with standard Mermaid flowcharts.

## [Release 2026-10-23] — HSN & Product Master Multi-Tax Architecture (Import Duty & Dual China VAT)

### 1. HSN Master Tax Expansion (`import_duty_percent` & `purchase_vat_percent`)
- **Database & Model Updates:**
  - Added `import_duty_percent numeric(5, 2) NOT NULL DEFAULT 0.00` and `purchase_vat_percent numeric(5, 2) NOT NULL DEFAULT 0.00` to `hsn_codes` table and `HsnCode` ORM model.
  - Updated Pydantic schemas (`HsnCreate`, `HsnUpdate`, `HsnRead`) and constants (`IMPORT_HEADERS`, `EXPORT_HEADERS`).
- **UI Table & Modal Form (`frontend/src/pages/masters/Hsn.tsx`):**
  - Added `Import Duty %` and `Purchase VAT %` columns to the HSN Codes data table.
  - Added `Import Duty %` and `Purchase VAT %` numeric input fields (0–100%) to the Add/Edit HSN modal form.
  - Added both rates to the HSN side drawer detail card.
  - **Form Input UX Optimization:** Updated form initialization so tax input fields (`GST %`, `Import Duty %`, `Purchase VAT %`, `Refund VAT %`) default to blank with `placeholder="0"` instead of pre-typed literal `"0"`, eliminating the need to backspace/erase `0` before entering rates while cleanly defaulting to `0.00` upon submit.
- **Bulk Import Parity (Add New & Update Existing):**
  - Updated `validate_hsn_row()` to parse `Import Duty %` and `Purchase VAT %` with flexible aliases (`pay_vat_percent`, `Pay VAT %`, `import_duty_percent`, `import_duty`).
  - `update_existing=true` accurately updates both rates on existing HSN codes.
  - Downloadable Sample Template auto-generates with valid sample values (`Import Duty %: 7.5`, `Purchase VAT %: 13`).

### 2. Product Master Dual VAT Architecture (`purchase_vat_percent`)
- **Database & Model Updates:**
  - Added `purchase_vat_percent numeric(5, 2) NOT NULL DEFAULT 0.00` to `products` table and `Product` ORM model.
  - Updated Pydantic schemas (`ProductCreate`, `ProductUpdate`, `ProductRead`) and constants.
- **Form Modal & Auto-Fill from HSN (`frontend/src/pages/masters/Products.tsx`):**
  - Added `Purchase VAT %` input field in the Product form next to `Refund VAT %`.
  - When an HSN code is selected from the dropdown, both `Purchase VAT %` and `Refund VAT %` auto-populate from the chosen HSN code while preserving manual overrides.
  - Rendered `Purchase VAT %` as a dedicated blue badge in the Executive Product Detail drawer.
- **Product Import / Export Parity:**
  - Updated `validate_product_row()` to parse `Purchase VAT %` (and aliases `pay_vat_percent`, `Pay VAT %`).
  - Added `Purchase VAT %` to Product CSV/XLSX export and sample templates (`sampleTemplate.ts`, `ImportWizard.tsx`).
- **Cross-ERP Tax Sync (`backend/app/masters/products/sync_inhyma.py` & Inhyma Adapter):**
  - In `build_product_sync_payload()`, included `gst_percent` and `import_duty_percent` from the linked HSN record, alongside `purchase_vat_percent`.
  - Enables Inhyma ERP's Product Master to automatically receive and link the Indian Import Duty and GST rates.
  - In `Inhyma_ERP/backend/app/integration/adapters/product.py` (`_resolve_tax`), corrected field mapping so `Tax.gst_percent` reads from `payload["gst_percent"]` (instead of mistakenly reading `refund_vat_percent`) and `Tax.import_duty_percent` reads from `payload["import_duty_percent"]`. Existing Inhyma tax records also update when updated rates sync from Yinglima.
  - Verified comprehensive sync parity: updates in Yinglima to dimensions (`length_cm`, `width_cm`, `height_cm`, `packaging_unit_cbm`), packaging weights (`packaging_gross_weight`, `packaging_net_weight`, `packaging_quantity`), specifications, descriptions, color, and material accurately and dynamically update in Inhyma.
  - **Deactivation & Soft-Delete Parity:** Fixed status sync in Inhyma product adapter (`product.py`) so that deactivating a product ensures `product.status = 'INACTIVE'` with `product.deleted_at = None`. This guarantees that deactivated products immediately appear in Inhyma's Inactive tab rather than being excluded as soft-deleted trash records.

## [Release 2026-10-23] — Product Master & Gallery `has_images` PostgreSQL Scalar Protection

### 1. Robust `has_images` Filter Handling (`ProductRepository`)
- **Problem & Root Cause:**
  - `GET /api/v1/masters/products?has_images=true` was failing with HTTP 500 (`asyncpg.exceptions.InvalidParameterValueError: cannot get array length of a scalar`).
  - Some historical rows in PostgreSQL had JSON scalar strings or `null` in `products.images`. PostgreSQL query optimization re-orders `WHERE` clauses, invoking `func.json_array_length(Product.images)` before verifying that the JSON type was actually an array.
- **Resolution in `backend/app/masters/products/repository.py`:**
  - Added SQL `case()` expression wrapping `and_(Product.images.is_not(None), func.json_typeof(Product.images) == 'array')`, returning `json_array_length(Product.images)` only for array types, and `0` otherwise.
  - Both `has_images=true` and `has_images=false` now execute cleanly without errors across all 885 product records.
- **Product Gallery Impact (`frontend/src/pages/ProductGallery.tsx`):**
  - Resolves visual photo catalog loading failures when fetching products with images (`/masters/products?has_images=true&page_size=100&sort_by=created_at&sort_order=desc`).
  - Response time dropped to < 300ms, immediately populating the Product Catalog Media tab with photos.

## [Release 2026-10-22] — Bulk Action High-Speed Endpoints & Master Form Status Cleanup

### 1. High-Speed Bulk Activate and Bulk Deactivate Endpoints
- **Endpoints Implemented:**
  - `POST /api/v1/masters/products/bulk-activate` — Activates multiple products in a single SQL operation.
  - `POST /api/v1/masters/products/bulk-deactivate` — Deactivates multiple products in a single SQL operation while verifying all selected items have zero stock.
- **Frontend MasterPage Integration (`frontend/src/components/MasterPage.tsx`):**
  - Upgraded `handleBulkActivate()` and `handleBulkDeactivate()` to call `/bulk-activate` and `/bulk-deactivate` in a single high-speed HTTP request, rather than issuing separate requests per row.
  - Added seamless fallback to per-item endpoint for legacy masters that do not yet have bulk endpoints.

### 2. Streamlined Form UX Across All Masters
- **Removal of Redundant Status Input:**
  - Removed `<StatusSelectField />` from all Master forms (`Products`, `Categories`, `SubCategories`, `Brands`, `Hsn`, `Uom`, `BuyerTypes`, `SupplierTypes`, `CompanyList`, `Countries`, `States`, `Cities`, `Currencies`).
  - New records default to `"active"`; edited records cleanly preserve their existing status.
  - Status transitions are now managed via the table's Bulk Action buttons (`Bulk Activate` and `Bulk Inactive`), eliminating clutter and preventing accidental status toggles during basic edits.

### 3. Universal Instant Cut-Off & Immediate Table Refresh Across All Modules
- **Immediate Visual Feedback on Bulk Actions:**
  - **Active Tab (`statusFilter === "active"`):** When bulk deactivating items, selected rows are immediately removed (0ms optimistic cut-off) from the Active table view, and `setReloadCounter` triggers an instant background refetch so server-side pagination, total counts, and subsequent page records update immediately.
  - **Inactive Tab (`statusFilter === "inactive"`):** When bulk activating items, selected rows are immediately removed from the Inactive table view and transferred to Active without requiring the user to switch tabs to refresh the table.
- **Form Edit Status Consistency:**
  - In `MasterPage.tsx` (`handleSubmit`), if a record's status is modified so it no longer matches the current tab's `statusFilter`, it immediately cuts off from the active list view and reloads.
- **Cross-Module Rollout:**
  - Applied across `MasterPage.tsx` (all Master entities), `Suppliers.tsx`, `Buyers.tsx`, and `Users.tsx`.

## [Release 2026-10-22] — Product Deactivation vs Deletion Lifecycle Synchronization Fix

### 1. Distinction Between Inactivation and Deletion Across ERPs
- **Problem & Root Cause:**
  - When marking a product Inactive in Yinglima (`PATCH /api/v1/masters/products/{id}` or `POST /{id}/deactivate`), Yinglima was emitting `event_type = "product.deactivated"`.
  - Inhyma's integration sync engine matched `.deactivated` under `is_delete`, which invoked `apply_delete` and populated `deleted_at = now()` (soft-delete / trash).
  - Because `deleted_at` was set, Inhyma queries automatically hid the product from BOTH the Active tab and the Inactive tab, causing Inhyma's Inactive tab to display `Inactive (0)` and "No Data".
- **Resolution in `Yinglima_ERP` (`backend/app/masters/products/routes.py`):**
  - Updated `update_product` and `deactivate_product` endpoints to emit `event_type = "product.updated"` with payload `{"status": "inactive", "is_active": False}`.
  - Inhyma's `apply_update` receives this event and sets `product.status = RecordStatus.INACTIVE` with `deleted_at = NULL`.
  - The product now moves cleanly into Inhyma's **Inactive** tab without being soft-deleted into trash.
  - Reserved `event_type = "product.deleted"` strictly for actual product deletions (`DELETE /api/v1/masters/products/{id}`).
- **Data Restoration:**
  - Restored product "Test 2" (`58d7c317-dec4-4aa7-8e54-146657bf07ab`) in Inhyma DB: cleared `deleted_at = NULL` and set `status = 'INACTIVE'`, bringing Inhyma's Inactive tab to `Inactive (1)`.
- **Automated End-to-End Verification:**
  - Executed automated lifecycle test verifying:
    1. **Create in Yinglima** $\rightarrow$ Immediately appears in Inhyma as **active**.
    2. **Inactivate in Yinglima** $\rightarrow$ Immediately moves to Inhyma **inactive** tab (`deleted_at = NULL`).
    3. **Re-activate in Yinglima** $\rightarrow$ Immediately moves back to Inhyma **active** tab.
    4. **Delete in Yinglima** $\rightarrow$ Immediately soft-deleted and unlisted from Inhyma.

## [Release 2026-10-22] — Product Master Edit Hardening & Supplier Foreign Key Resilience

### 1. Product Master Edit Resilience & Dangling Supplier Reference Protection
- **Root Cause & Resolution:**
  - Resolved `500 INTERNAL_SERVER_ERROR` on `PATCH /api/v1/masters/products/{id}` occurring when editing products that had historical or deleted `supplier_id` values.
  - Previously, `ProductService.update()` unconditionally called `_sync_supplier_link()` which triggered a PostgreSQL `ForeignKeyViolationError` on constraint `supplier_product_links_supplier_id_fkey`.
  - Hardened `ProductService._validate_references()` to verify supplier existence in `suppliers` table and safely nullify non-existent references before persistence.
  - Hardened `ProductService.update()` to include `supplier_id` in merged validation and sync back sanitization.
  - Hardened `ProductService._sync_supplier_link()` with an existence check on `suppliers` and exception guard.
  - Executed safe data cleanup across Yinglima DB (`mpvzjzunkiqchhhvxrza`), clearing dangling `supplier_id` references on 34 legacy products without impacting any valid operational data.

### 2. Verified Real-time Status Sync to Inhyma
- **Deactivation Lifecycle Verification:**
  - Tested editing product `DAR-00017` ("LT 2 spares") in Yinglima with HSN `8422.a247`, Sub-Category "Packaging machine Spares", and setting status to `inactive`.
  - Both Yinglima DB and Inhyma DB updated synchronously: Inhyma product `DAR-00017` status successfully transitioned to `INACTIVE`.

## [Release 2026-10-22] — Cross-ERP Product Master Synchronization & Inhyma Organization Scoping

### 1. Cross-ERP Product Synchronization Engine & Bulk Reconciliation
- **Yinglima-to-Inhyma Product Master Sync:**
  - Designed and executed end-to-end reconciliation script (`backend/scripts/sync_all_inhyma_products.py`) syncing catalog items assigned to Inhyma (`organization_id = 85c12bcb-10a1-4b1f-92ed-6ca72ac1b3b5`) from Yinglima DB (`mpvzjzunkiqchhhvxrza`) to Inhyma DB (`kkqxkgdrmvnnvptpjpmi`).
  - Total Yinglima products assigned to Inhyma: **873 products**.
  - **319 products newly created** in Inhyma ERP with complete technical specs, CBM, packaging weights, and explicit Inhyma organization assignment.
  - **554 products updated** with reconciled foreign key dependencies (Categories, Sub-Categories, Brands, UOMs, and HSN/Taxes).
  - Populated **873 rows** in `synced_entity_mappings` (`source_erp_id = 'yinglima'`, `entity_type = 'product'`) linking source and target entity UUIDs for future idempotent real-time event updates.

### 2. Zero-Data-Loss Protection & Strict Organization Scoping
- **Safe Isolation & Preservation of Non-Inhyma and Local Products:**
  - Preserved Darsh Impex (652 items), FNB Solution (769 items), and native domestic Indian spare parts (`INH-xxxxx`, 935 items) in Inhyma ERP's database with zero deletions or schema corruption.
  - Inhyma ERP Product Master frontend (`/product/list`) and backend repository now query with `organization_id=85c12bcb-10a1-4b1f-92ed-6ca72ac1b3b5`, supporting both Yinglima-synced products and newly added native Inhyma products while filtering out Darsh Impex, FNB Solution, and legacy domestic `INH-` spare parts.
  - **Strict One-Way Lifecycle:**
    - Deactivating a product in Yinglima automatically deactivates it in Inhyma.
    - Deleting a product in Yinglima soft-deletes it in Inhyma (`deleted_at` timestamp recorded).
    - Inactivating or deleting directly in Inhyma NEVER affects Yinglima (zero reverse sync).

### 3. Federation Credential & Outbox Hardening
- **Mutual M2M Security:**
  - Configured `FEDERATION_SERVICE_CREDENTIAL` in `Yinglima_ERP/backend/.env` matching Inhyma federation keys.
  - Reset `peer_health_states` circuit breakers to `CLOSED`.
  - Verified unit test suite: `tests/test_sync_product_to_inhyma.py` (2/2 tests passing, 100%).
  - Verified frontend production builds: `npm run build` completed with 0 errors.

## [Release 2026-10-22] — RBAC Permission Hardening: Sale Process, Stock Movements, Notification Rules & Position Matrix Integration

### 1. New RBAC Permissions & Full Matrix Integration (155 -> 167 System Permissions)
- **Sale Process (`sale_process.*` - 6 permissions):**
  - Added `sale_process.view`, `sale_process.create`, `sale_process.update`, `sale_process.approve`, `sale_process.delete`, `sale_process.export`.
  - Backend routes in `backend/app/sales/routes.py` secured with `@require_permission` decorators.
  - Frontend navigation in `nav.ts` guarded with `permission: "sale_process.view"`.
  - `SaleProcessList.tsx` action buttons (`+ Create Sale Process`, `Export`, `Edit Order`, `Delete`) wrapped with `<Can>` permission gates.
- **Stock Movement (`stock_movement.*` - 4 permissions):**
  - Added `stock_movement.view`, `stock_movement.create`, `stock_movement.cancel`, `stock_movement.delete`.
  - Backend routes in `backend/app/stock/routes.py` secured with `@require_permission` decorators.
  - Frontend navigation in `nav.ts` guarded with `permission: "stock_movement.view"`.
  - `StockMovements.tsx` action buttons (`+ New Inward Entry`, `+ New Outward Entry`, `Cancel`, `Delete`) wrapped with `<Can>` permission gates.
- **Notification Rules (`notification_settings.*` - 2 permissions):**
  - Added dedicated `notification_settings.view` and `notification_settings.manage` permissions (eliminating previous reuse of `user.view`).
  - Backend routes in `backend/app/notifications/routes.py` secured with `@require_permission` decorators.
  - Frontend navigation in `nav.ts` guarded with `permission: "notification_settings.view"`.
  - `NotificationSettings.tsx` toggle and edit buttons disabled/hidden for users without `notification_settings.manage`.
- **Positions & Designations (`position.*`):**
  - Added friendly display name and module category mapping in `permissionLabels.ts` (`Positions & Designations`), ensuring proper rendering in `/rbac` and permission matrices.
- **Zero-Latency In-Memory Architecture Guarantee:**
  - Permissions are cached in RAM on the backend via Redis/MemoryCache and hydrated on frontend session creation as a JS `Set`.
  - All permission evaluations (`hasPermission()`, `<Can>`) execute in $O(1)$ (< 0.001ms) with zero extra network round-trips.

## [Release 2026-10-22] — Global Custom In-App Confirmation Modal: Elimination of Native Browser window.confirm()

### 1. Global In-App Confirm Dialog Architecture (`frontend/src/lib/confirm.tsx`)
- **Elimination of Unstyled Browser "Black Box" Popups:**
  - Completely replaced the browser's native `window.confirm()` dialog (which rendered as a dark/black floating prompt saying `localhost:5173 says` on Windows/Chrome dark mode) with a unified, modern in-app confirmation modal.
  - Implemented `ConfirmDialogProvider` and `useConfirm()` hook mounted at the application root (`main.tsx`).
  - Modal features:
    - Clean white card dialog (`#ffffff`, `borderRadius: 16px`, smooth backdrop blur overlay `rgba(15, 23, 42, 0.55)`).
    - Top icon badge: Circular soft-red icon badge (`#fee2e2`, `#dc2626`) with a clean trash/delete SVG icon (or amber warning icon for warnings).
    - Title: Bold modal heading (`"Delete Confirmation"`, `"Delete Product Item"`, etc.).
    - Item highlight pill: Clean item name/code tag (`#f1f5f9`, border `#e2e8f0`, bold text `#334155`).
    - Action buttons: Styled Cancel button (`#ffffff` / `#475569`, border `#cbd5e1`) and prominent Danger button (`#dc2626`, bold white text `#ffffff`).
    - Keyboard navigation: `Escape` key dismisses, `Enter` key confirms.

### 2. Comprehensive ERP Module Rollout
- **Inquiries (`Inquiries.tsx`):**
  - Consignment deletion, bulk consignment deletion, quotation removal, and product item deletion (the exact screen reported by user) now trigger the custom white confirmation dialog.
- **Local Purchases (`LocalPurchases.tsx`):**
  - Purchase invoice deletion triggers the custom modal with invoice number highlight.
- **Sale Process (`SaleProcessList.tsx`):**
  - Sale order deletion triggers the custom modal with order number highlight.
- **Stock Movements (`StockMovements.tsx`):**
  - Movement cancellation and permanent deletion trigger the custom modal with movement number highlight.
- **Product Prices (`ProductPrices.tsx`):**
  - Price quote removal triggers the custom modal with supplier name highlight.
- **Product Gallery (`ProductGallery.tsx`):**
  - Broken media deletion, product image deletion, and supplier visit photo deletion trigger the custom modal.
- **Master Data Pages (`MasterPage.tsx`):**
  - All 13 Master entities (Products Master, Categories, Subcategories, Brands, HSN, UOM, Countries, States, Cities, Currencies, Company List, Buyer Types, Supplier Types) now use the custom modal for row and bulk deletion.
- **Suppliers & Buyers (`Suppliers.tsx`, `Buyers.tsx`):**
  - Contact person deletion, supplier/buyer deletion, and bulk actions (delete, deactivate) use the custom modal.
- **Planning (`Planning.tsx`):**
  - Sheet deletion and column group deletion use the custom modal.
- **Trash & User Management (`Trash.tsx`, `Users.tsx`, `Rbac.tsx`):**
  - Permanent deletion, empty trash, account actions, bulk deactivation, and department deletion use the custom modal.

## [Release 2026-10-22] — Global UI Button Standardization: Orange Imp / Exp Buttons & Unified Filter Funnel Headers

### 1. Global Standardized Vibrant Orange Export & Import Buttons (`#f59e0b`)
- **Visual Harmonization:**
  - Standardized all list header Export and Import buttons across the ERP to match the vibrant orange standard established in **Products Master** (`#f59e0b`, white bold text `#ffffff`, `fontWeight: 700`, `borderRadius: 6px`, `border: none`, `boxShadow: 0 2px 4px rgba(245, 158, 11, 0.25)`).
  - Updated `LocalPurchases.tsx`: replaced old white button (`📥 Export ▼`) with the standardized orange `"Export ▾"` button (`btn-imp-exp`).
  - Updated `ProductPrices.tsx`: replaced old white outline button (`📥 Export ▼`) with the standardized orange `"Export ▾"` button (`btn-imp-exp`).
  - Re-aligned `SaleProcessList.tsx` and all master/entity list pages via unified `btn-imp-exp` CSS class in `style.css`.

### 2. Global Unified Top Filter Funnel Button (Symbol & Color)
- **Funnel SVG & State Standard:**
  - Standardized the top filter toggle button across all ERP modules to the compact Funnel SVG icon button (`btn-header-filter`).
  - Inactive / Default State: dark slate background (`#475569`) with white SVG funnel icon (`<polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon>`), `padding: 8px 12px`, `borderRadius: 6px`, `border: none`.
  - Active / Filter Open State: primary blue background (`#0061f2`) with active filter count badge (`#ef4444`).
  - Updated `LocalPurchases.tsx`: replaced wide `"Filters"` text button with the compact Funnel icon button.
  - Updated `ProductPrices.tsx`: adjusted button padding and classes to match standard height.
  - Updated `Buyers.tsx`: aligned active background from `#4f46e5` to unified `#0061f2`.
### 3. Product Prices: Removal of Redundant "Search" Button
- **Streamlined Live Reactive Filtering:**
  - Removed the redundant orange `"Search"` button from the expandable filter drawer in `ProductPrices.tsx`.
  - All filter dropdowns (Category, Sub Category, Brand, Pricing Status) are fully reactive and trigger `fetchPrices` automatically on change via the dependency hook.
  - Retained the clean `"Reset"` button to clear all active dropdown filters, search terms, and reset back to page 1.

## [Release 2026-10-22] — Stock Movements: Clean 0-Item Empty-State Lifecycle, Ghost Row Elimination & Cascading Clear (Inward & Outward)

### 1. Elimination of Ghost 1-Item Table Rows
- **Zero-Item Initial State in 1-Click Extract Mode:**
  - Resolved issue in `StockMovementModal.tsx` where opening, reopening, or resetting the Inward or Outward creation modal in `1-Click Extract` mode was defaulting `items` to `[createEmptyItem()]` (1 blank row), displaying `2. GOODS LINE ITEMS (1 ITEMS)` and `Total Items: 1` before any purchase bill or sale order was chosen.
  - Initialized `items` to an empty array (`[]`) by default and in `resetForm()`.
  - When no bill/order is selected, Section 2 displays **`2. GOODS LINE ITEMS (0 items)`** with a clean, friendly empty-state banner:
    > *"No purchase bill [or sale order] selected yet. Search and select a confirmed purchase bill above to auto-extract line items, or click '+ Add Item' above to add products manually."*
  - Bottom metrics bar accurately displays `Total Items: 0 | Total Net Qty: 0`.

### 2. Complete Cascading Reset on Combobox Clear (✕)
- **Instant Unselection & Wipe:**
  - Clicking the `✕` clear button in the order search combobox immediately executes `handleClearSelectedOrder()`.
  - Atomically clears search query, selected purchase bill / sale order ID, vendor/buyer names, challan/reference number, vehicle/transporter details, and wipes all line items back to `0 items` (`items = []`).

### 3. Mode Switch Row Preparation & Submit Guard
- **Smooth Mode Switching:**
  - Switching from 1-Click Extract to **✍️ Direct Manual Entry** clears any linked order and initializes 1 clean blank item row (`items = [createEmptyItem()]`) so operators can start entering products immediately.
  - Switching back to **⚡ 1-Click Extract** resets line items cleanly back to `0 items`.
  - Operators can delete any line item via row `✕` without artificial disabled constraints; deleting all items returns to the empty-state banner.
  - The submit button is strictly disabled (`cursor: not-allowed`, background `#94a3b8`) whenever `items.length === 0`, preventing accidental empty stock movement submissions.

## [Release 2026-10-22] — Supplier Contacts: Two-Way Synchronization with Profile, Auto-Promotion & Make Primary Feature

### 1. Two-Way Profile & Contact Roster Synchronization
- **Elimination of Desynchronization:**
  - Resolved issue where adding a contact in the **Contacts** tab of a supplier (e.g., `om1`) did not reflect in the **Profile** tab's **`Primary Contact Information`** section, leaving the inputs blank.
  - Adding or updating a primary contact now immediately synchronizes with the `Supplier` entity's `contact_salutation`, `contact_full_name`, `contact_designation`, `contact_calling_number`, `contact_whatsapp_number`, `contact_wechat_number`, and `emails`.
  - In `Suppliers.tsx`, submitting a contact drawer immediately triggers `refreshSupplierProfileAfterContactChange()`, which updates both `form` state and the background `rows` table without requiring a page reload. Switching back to the Profile tab shows the updated contact details immediately.

### 2. Auto-Promotion of First Contact to Primary
- **Automatic Primary Assignment:**
  - When a supplier is created without contact details, adding the first contact in the Contacts tab automatically designates it as `is_primary = True` and writes its information to the supplier's primary profile fields.
  - In `Suppliers.tsx`, opening the contact drawer with an empty profile or empty roster defaults `Set as Primary Contact` to checked.

### 3. 1-Click "★ Make Primary" & Endpoint Support
- **Promote Secondary Contacts:**
  - Added a `★ Make Primary` button on all secondary contact rows in the Contacts sub-table.
  - Added endpoints `POST /suppliers/{id}/contacts/{contact_id}/make-primary`, `/primary`, and `/set-primary` to atomically promote the contact, demote previous primaries, and update the parent supplier profile.
  - Added `★ Primary` badge to clearly distinguish primary contacts from secondary team members.
  - Primary contact deletion is guarded (`ConflictException` with user-friendly error message) to prevent accidental removal of active profile contact details.

### 4. Existing Record Hydration
- **Fallback Hydration:**
  - When opening the edit modal for any existing supplier whose `contact_full_name` was previously blank, `openModal()` automatically hydrates form inputs from the supplier's primary contact (or first roster contact), ensuring instant visibility.

## [Release 2026-10-21] — Sale Process: Customer Gating Lockout & Cascading Reset of Planning Sheets, Consignments, and Line Items

### 1. Customer Selection Gating & Padlock Lockout
- **Strict Selector Gating:**
  - Enforced strict dependency lockout in `SaleProcessForm.tsx`: both **Planning Sheet / Branch** and **Planning Consignment Column** remain **disabled, locked, and closed** until a Customer/Entity is chosen.
  - Locked state displays a distinct dashed border, light gray background (`#f8fafc`), disabled cursor (`not-allowed`), and a `🔒 Select Customer / Entity first` prompt.
  - Dropdown menus cannot be opened while locked, preventing accidental assignment of mismatched sheets or bypass of customer permissions.

### 2. Complete Cascading Reset & Data Cleanliness
- **Elimination of Orphaned Line Items:**
  - When the Customer/Entity is cleared (`✕` or choosing `-- Select Entity --`) or changed to a different entity, the form automatically executes a complete cascading reset:
    - Re-locks the Planning Sheet and Consignment Column selectors.
    - Resets `selectedSheetId`, `selectedSheetName`, `selectedColumnId`, and `selectedConsignmentCode`.
    - **Wipes all table line items (`items = []`)** so products from a previously selected consignment never linger in the table.
    - Resets Container Freight CBM (`totalContainerCbm = 0`) and clears consignment banner messages.
- **Immediate Data Loading on Consignment Column Selection:**
  - Selecting or changing a Planning Consignment Column immediately triggers the item extraction engine, wipes any previous column's products, and populates the table with the planned products, quantities, and CBM of the newly selected column.
  - If a column with 0 planned products is chosen, the table is cleanly reset to 0 items with an informative notice.
  - Clearing the consignment column (`✕`) automatically wipes the line items and resets container CBM.

### 3. Responsive Layout & Zero-Overflow Hardening (100% Zoom Protection)
- **Elimination of Consignment & Auto-Load Button Card Overflow:**
  - Resolved layout blowout where long consignment labels pushed the ⚡ Auto-Load button past the card container boundary at 100% browser zoom.
  - Added min-width: 0, overflow: hidden, and single-line ellipsis text truncation to all Row 1 grid cells, combobox buttons, and labels.
  - Optimized consignment trigger label to concise format (${col.column_name} •  items ( pcs)) with full metadata on hover tooltip (	itle).
  - Restyled the ⚡ Auto-Load button with lex-shrink: 0, compact padding (8px 10px), and inline-flex alignment with spinner.

## [Release 2026-10-21] — Shipment Planning: First Column ("ITEM") Excel-Style Drag-to-Resize & Server Persistence

### 1. Shipment Planning ITEM Column Drag-to-Resize
- **Interactive Drag Handle (`EditableItemHeader`):**
  - Added dedicated right-edge column resize handle with `col-resize` cursor and active grab highlight (`#2563EB`) to the first column ("ITEM") in `frontend/src/pages/Planning.tsx`.
  - Enables Excel-style drag-to-resize for the first column, matching all subsequent consignment and master lookup columns.
- **Instantaneous 0-Lag Visual Feedback:**
  - Integrated dynamic CSS custom property `--item-col-width` onto the table wrapper element.
  - Linked `--item-col-width` across `EditableItemHeader`, `EditableRowLabel`, and `PlanningGridSkeletonRows`. Live mouse movement updates the CSS variable directly, delivering buttery-smooth resizing across all rows with zero DOM lag or excessive React re-renders.
  - Dynamic frozen column offset: `stickyLeftByColumnId` automatically recalculates sticky positions for subsequent frozen columns (`TEST(Y/N)`, `APPROVAL DATE`, pinned columns) based on the active or persisted item column width.
- **Server Persistence & Alembic Migration:**
  - Added `item_width_px` (`sa.Integer`, nullable) to `planning_sheets` via Alembic migration [`d5e6f7a8b9c0_add_item_width_px_to_planning_sheets.py`](file:///d:/Om%20work1/ERP/Yinglima_ERP/backend/alembic/versions/d5e6f7a8b9c0_add_item_width_px_to_planning_sheets.py).
  - Added `PlanningItemWidthUpdate` schema (`width_px` clamped between 64px and 800px, default 240px) and updated `PlanningSheetRead`.
  - Added endpoint `PATCH /api/v1/planning/sheets/{sheet_id}/item-width` in [`backend/app/planning/routes.py`](file:///d:/Om%20work1/ERP/Yinglima_ERP/backend/app/planning/routes.py).
  - Broadcasts lightweight WebSocket event `item_width_changed` so other users viewing the sheet receive live width synchronization without refreshing.
  - Added automated unit test [`backend/tests/test_planning_item_width.py`](file:///d:/Om%20work1/ERP/Yinglima_ERP/backend/tests/test_planning_item_width.py) validating persistence, clamping, and reset behavior.

## [Release 2026-10-21] — Stock Movement Module (Inward & Outward Registers, 1-Click PO/SO Extract & Live Inventory Ledger)

### 1. Stock Movement (Inward & Outward) Architecture
- **Inward Register (Warehouse Stock-In):**
  - Added dedicated warehouse reception register for incoming domestic vendor shipments, factory arrivals, and warehouse returns.
  - **1-Click Extract from Local Purchase:** Automatically extracts vendor details, invoice numbers, consignment codes, and line items (name, SKU, ordered quantity, unit rate) directly from confirmed Local Purchase bills.
  - Granular quality control: Allows entering actual received quantity, damaged/rejected quantity, and computes net accepted stock (`quantity - damaged_quantity`).
- **Outward Register (Warehouse Stock-Out):**
  - Added dedicated dispatch register for customer shipments, container loadings, and branch dispatches.
  - **1-Click Extract from Sale Process:** Automatically extracts buyer details, order numbers, container numbers, transporter names, LR numbers, and ordered items directly from confirmed Sale Process orders.
- **Live Inventory Ledger & Kardex:**
  - Real-time stock balance calculated as $\sum \text{Inward Accepted Qty} - \sum \text{Outward Dispatched Qty}$.
  - Chronological **Kardex** ledger history drawer for every product showing date, movement type, document reference, party, quantities in/out, and running balance.
- **Database Schema ([`c4d5e6f7a8b9_create_stock_movements_and_items.py`](file:///d:/Om%20work1/ERP/Yinglima_ERP/backend/alembic/versions/c4d5e6f7a8b9_create_stock_movements_and_items.py)):**
  - Created tables `stock_movements` and `stock_movement_items` with full indexing on `movement_no`, `movement_type`, `movement_date`, `purchase_id`, `sale_order_id`, and `product_id`.
- **Backend API Endpoints (`/api/v1/stock`):**
  - Mounted `/metrics`, `/movements`, `/movements/{id}`, `/movements/{id}/cancel`, `/extract/purchase/{id}`, `/extract/sale-order/{id}`, `/balances`, and `/kardex`.
- **Frontend UI (`/inventory/stock-movements`):**
  - Integrated under `INVENTORY` in navigation sidebar.
  - Clean tabbed interface: Inward Register, Outward Register, Current Stock Ledger, and top KPI cards.
  - **Searchable Combobox for Orders/Bills**: Upgraded native select dropdowns in the creation modal to an instant live-filtering search combobox with match indicators, keyboard focus, and clear buttons.
  - **Ergonomic Modal Layout**: Redesigned dialog dimensions (`width: 96vw`, `maxWidth: 1280px`, `height: 94vh`) and condensed 8 metadata fields into a compact 4-column, 2-row grid.
  - **High-Visibility Custom Scrollbar & Table Viewport**:
    - Added custom styled slate scrollbars (`.stock-modal-scroll`, `.stock-table-scroll` with `#94a3b8` thumb and `#f1f5f9` track) and `scrollbar-gutter: stable`, eliminating hidden/invisible browser scrollbars.
    - Removed redundant duplicate inner footer from Card 2, leaving the single pinned bottom modal bar as the clean source of truth.
    - Optimized table cell padding (`6px 8px` cells, `5px 8px` inputs) with **sticky pinned headers** (`position: sticky`, `top: 0`), guaranteeing 8 to 10 product items fit directly on screen on standard desktop and laptop displays without row cutoff.
  - **Pinned Bottom Actions Footer**: Modal footer with line item totals and Confirm/Cancel buttons is permanently anchored at the bottom of the dialog.
- **Strict Outward Inventory Blocking (Anti-Negative Stock Rule)**:
  - **Server-Side Enforcement ([`app/stock/service.py`](file:///d:/Om%20work1/ERP/Yinglima_ERP/backend/app/stock/service.py), [`app/stock/repository.py`](file:///d:/Om%20work1/ERP/Yinglima_ERP/backend/app/stock/repository.py)):**
    - Outward dispatches now perform an mandatory stock check prior to creating movement records.
    - If requested outward quantity exceeds warehouse available stock ($\sum \text{Inward Accepted} - \sum \text{Outward Dispatched}$ across confirmed non-deleted movements), the API immediately blocks the movement with `400 Bad Request` ("Insufficient Stock for '<Item>'. Available: X, requested: Y. Outward dispatch blocked to prevent negative inventory.").
    - Multi-line aggregation: Aggregates duplicate items within the same dispatch voucher before stock validation.
    - Inward safeguards: Cancelling or deleting an inward receipt is blocked if goods have already been dispatched.
  - **Stock Movement Deletion API & UI Action ([`routes.py`](file:///d:/Om%20work1/ERP/Yinglima_ERP/backend/app/stock/routes.py), [`StockMovements.tsx`](file:///d:/Om%20work1/ERP/Yinglima_ERP/frontend/src/pages/inventory/StockMovements.tsx)):**
    - Added `DELETE /api/v1/stock/movements/{id}` endpoint and UI **Delete** button with confirmation prompt in Inward & Outward registers.
    - Added `GET /api/v1/stock/available-stock` endpoint for quick product balance queries.
  - **Real-Time Client-Side Feedback ([`StockMovementModal.tsx`](file:///d:/Om%20work1/ERP/Yinglima_ERP/frontend/src/pages/inventory/StockMovementModal.tsx)):**
    - Each line item displays an live `In-Stock: X units` badge.
    - When entered quantity exceeds stock, the input turns red, alerts with `⚠️ Blocked: Exceeds warehouse stock!`, and sets the submit button state to `🚫 Blocked: Insufficient Stock`.
  - **Ledger Cleanup**: Cleared legacy negative stock test entries (`OUT-2026-0001` and `INW-2026-0001`), restoring net warehouse stock to a clean 0 balance.
  - **Complete Cascading Reset & Modal Lifecycle Hardening ([`StockMovementModal.tsx`](file:///d:/Om%20work1/ERP/Yinglima_ERP/frontend/src/pages/inventory/StockMovementModal.tsx), [`StockMovements.tsx`](file:///d:/Om%20work1/ERP/Yinglima_ERP/frontend/src/pages/inventory/StockMovements.tsx)):**
    - Conditionally mounted `StockMovementModal` in `StockMovements.tsx` (`{isModalOpen && <StockMovementModal ... />}`) so unmounting flushes state completely on close.
    - Added `resetForm()` lifecycle trigger on modal open, close, and successful voucher submission, guaranteeing the modal opens 100% fresh and blank every time.
    - In the purchase bill/sale order search selector, clicking ✕ calls `handleClearSelectedOrder()` which immediately resets party details, reference numbers, notes, and resets the table back to 1 clean empty row.
    - Switching between ⚡ 1-Click Extract and ✍️ Direct Manual Entry automatically clears any linked order and line items for clean manual typing.

### 2. Sale Process 3-Level Hierarchy Selector (Entity → Sheet → Consignment) & Nullable Buyer ID

- **Customer / Entity Selector (Combobox):**
  - Upgraded the single buyer input in `frontend/src/pages/sales/SaleProcessForm.tsx` to a structured entity combobox that partitions entities into two distinct categories:
    - `🏢 INTERNAL ORGANIZATIONS`: Lists all registered master companies (e.g., Inhyma, Darsh Impex, FNB Solution, One Stop, Yinglima).
    - `👤 BUYERS`: Lists all registered buyer entities (e.g., Om Packaging, Prathamesh Packaging).
  - Supports instant typeahead search across all organizations and buyers.
- **Planning Sheet / Branch Selector (New Dependent Field):**
  - Introduced dynamic Sheet / Branch dropdown linking directly to the chosen entity.
  - When an Organization (e.g. `Inhyma`) is selected, automatically filters available sheets to those belonging to that organization (`Inhyma Mumbai`, `Inhyma Ahmedabad`, `Inhyma  Indore`, `inhyma chennai`).
  - When a Buyer (e.g. `Om Packaging`) is selected, automatically displays `Om Packaging - Mulund`.
- **Planning Consignment Column Filter & 1-Click Auto-Load:**
  - Consignment column combobox restricts choices strictly to the columns that belong to the chosen Sheet/Branch (e.g., `Mum 48`, `Mum 49`, `GJ14`, etc.).
  - Selecting a consignment column immediately auto-loads all planned products with quantity > 0, unit rates, CBM, and remarks. Includes manual `Auto-Load Planned Products` button for re-syncing at any time.
- **Support for All Existing & Newly Created Sheets:**
  - **Existing Sheets:** Works seamlessly with all pre-existing sheets across all branches/entities via dynamic DB queries (`/planning/sheets`) and dual matching (matching both explicit `organization_id` foreign key and canonical sheet name prefixes like `Inhyma Mumbai`, `Inhyma Ahmedabad`, etc.).
  - **New Sheets:** Any new sheet created in Shipment Planning immediately appears in the hierarchy dropdowns. Its manual numeric columns immediately become selectable consignment columns, and row items extract with complete fidelity without requiring any code changes or system migrations.
- **Database Schema Migration: Nullable Buyer ID:**
  - **Alembic Migration ([`b3c4d5e6f7a8_allow_nullable_buyer_id_in_sales_orders.py`](file:///d:/Om%20work1/ERP/Yinglima_ERP/backend/alembic/versions/b3c4d5e6f7a8_allow_nullable_buyer_id_in_sales_orders.py)):** Executed `ALTER TABLE sales_orders ALTER COLUMN buyer_id DROP NOT NULL`.
  - Enables internal sales, cross-branch transfers, and organization-consignment orders to be created and saved without requiring an external buyer record.
  - Updated `SaleOrder.buyer_id` in `app/sales/models.py` and `app/sales/schemas.py`.
  - Enhanced `get_planning_consignments` in `app/sales/service.py` to directly target `sheet_id` when provided.


### 3. Sale Process List Action Toolbar UI Alignment (Products Master Pattern)
- **Filter Toggle Button (`SaleProcessList.tsx`):**
  - Replaced the outlined white text button (`🔍 Filters`) with the compact dark slate square button (`#475569`, toggling to `#0061f2` when active) featuring the standardized filter funnel SVG icon, matching Products Master.
  - Retained the high-visibility active filter badge indicator.
- **Export Button Styling (`SaleProcessList.tsx`):**
  - Replaced the plain white button with the vibrant amber/orange button (`#f59e0b`, `color: #ffffff`, `fontWeight: 700`, `border: none`), matching the Products Master `Imp / Exp ▾` visual standard.
- **Toolbar Action Order:**
  - Aligned action hierarchy: `[ 🌪️ Filter Toggle ]` $\rightarrow$ `[ + Create Sale Process ]` (blue primary) $\rightarrow$ `[ Export ]` (orange secondary).

### 4. Shipment Planning Strict Primary Supplier Isolation from Product Master
- **Strict Primary Supplier Rule Enforcement ([`app/masters/products/repository.py`](file:///d:/Om%20work1/ERP/Yinglima_ERP/backend/app/masters/products/repository.py)):**
  - Updated `attach_planning_supplier_info` to resolve `supplier_name`, `_planning_supplier_name`, and `_planning_supplier_city` strictly and exclusively from `Product.supplier_id` configured directly in Product Master.
  - Eliminated fallback scanning of `SupplierProductLink` table: if a product does not belong to any supplier in Product Master (`Product.supplier_id` is None / empty), it strictly outputs blank/null for `Brand of Supplier` and `City` in Shipment Planning.
  - Removed accidental in-memory mutation of `product.supplier_id` that previously occurred during fallback resolution.
  - Preserved all other product master linked lookup columns (`product_code`, `product_name`, `packaging_quantity`, `packaging_gross_weight`, `packaging_unit_cbm`, `standard_price`, etc.) intact without modification.
- **Source Registry Mapping ([`app/planning/source_registry.py`](file:///d:/Om%20work1/ERP/Yinglima_ERP/backend/app/planning/source_registry.py)):**
  - Updated registry documentation and field getters to reflect strict primary supplier resolution from Product Master.
- **Automated Test Suite ([`backend/tests/test_product_primary_supplier_strict.py`](file:///d:/Om%20work1/ERP/Yinglima_ERP/backend/tests/test_product_primary_supplier_strict.py)):**
  - Added automated test verifying that products with primary suppliers attach their brand and city correctly, products with `supplier_id=None` remain blank in Shipment Planning even if linked in Supplier Master, and all temporary test records are cleanly deleted.

### 4. Spare Products Master Catalog Isolation & Light-Orange Line Item Highlighting (No Emoji Toggle)
- **Product Repository Filter (`is_spare=true` / `is_spare=false`):**
  - Added `is_spare` to `filterable_fields` in [`app/masters/products/repository.py`](file:///d:/Om%20work1/ERP/Yinglima_ERP/backend/app/masters/products/repository.py).
  - Handles dynamic category and sub-category subqueries targeting categories/subcategories containing `"spare"` (e.g. `Packaging machine Spares`, `Filteration Spares`, `UV Spare`, `Spares For Material Handling`, `Hand Sealer (Spares)`, etc.).
  - Guarantees complete machines (e.g. GF100, FR400) are never returned when `is_spare=true` is requested.
- **Dedicated `+ Add Spare from Master` Modal:**
  - Updated API query in [`SaleProcessForm.tsx`](file:///d:/Om%20work1/ERP/Yinglima_ERP/frontend/src/pages/sales/SaleProcessForm.tsx) to `/masters/products?is_spare=true&page_size=100`.
  - The modal strictly displays genuine spare parts from the master catalog.
- **Line Items Table Styling (Removal of Emoji Click-to-Toggle):**
  - Removed the clickable emoji toggle button (`🚜 Machine` / `⚙️ Spare`) to eliminate accidental flips.
  - Regular machine items display in standard clean rows with zero emoji button clutter.
  - Spare parts (items marked with `is_spare=true`) are highlighted with a soft, clean **light-orange** background (`#fff7ed` / `#fffaf5`) and an elegant non-clickable light-orange badge (`Spare Part`).

### 5. Shipment Planning Unified Column Structure & Cross-Sheet Canonical Alignment
- **Global Deduplication of Specification Columns:**
  - Removed 4 trailing manual duplicate columns (`Supplier City`, `PKG QTY`, `UNIT WEIGHT/PKG (KG)`, `CBM/PKG (KG)`) from `Inhyma Mumbai`.
  - Audited all rows to confirm that all packaging specifications exist directly in the central Product Master (`Product`), making manual redundant columns obsolete.
- **Companion Formula Synthesis for Ahmedabad & Indore:**
  - Added missing formula companion columns on `Inhyma Ahmedabad` for groups `GJ14` and `GJ15`: `NO. OF PKG GJ14/15`, `TOTAL WEIGHT GJ14/15`, `TOTAL CBM GJ14/15`.
  - Added missing companion column group on `Inhyma  Indore` for `MP -06`: `MP -06 Remarks`, `NO. OF PKG MP6`, `TOTAL WEIGHT MP6`, and `TOTAL CBM MP6`.
- **Flexible Consignment Label & Delimiter Engine:**
  - Updated backend regex patterns in [`app/planning/service.py`](file:///d:/Om%20work1/ERP/Yinglima_ERP/backend/app/planning/service.py) (`_is_pure_mum_column`, `mum_num_from_column_name`, `_mum_derived_kind_and_group`, and `_compute_mum_derived_value`) and frontend regex in [`Planning.tsx`](file:///d:/Om%20work1/ERP/Yinglima_ERP/frontend/src/pages/Planning.tsx) (`mumGroupNumber`, `mumRemarksGroupNumber`) to support hyphens and leading zeros (`[\s\-]*0*(\d+)`).
  - Seamlessly parses `MP -06`, `GJ14`, `Mum 48`, `Chen 1`, etc.
- **Duplicate Prevention on Group Creation:**
  - Enhanced `create_next_mum_group` in `service.py`: if a sheet already contains a column matching the standard product specification name or field, it auto-upgrades the column to `LINKED_LOOKUP` rather than duplicating it.
- **Universal Canonical Layout Across All Sheets:**
  - Re-indexed and verified all 12 Organization and Buyer sheets (`Inhyma Mumbai`, `Inhyma Ahmedabad`, `Inhyma  Indore`, `inhyma chennai`, `Chennai`, `Mumbai`, `F&B`, `One Stop`, `dubaidarsh`, `Om Packaging - Mulund`, `Prathamesh Packaging PVT LTD - Thane`, `Darsh Impex Mumbai - Mulund`) in strict canonical order:
    1. System/Approval headers (`TEST(Y/N)`, `APPROVAL DATE`).
    2. Consignment quantity & remarks pairs (`<Label> <N>`, `<Label><N> Remarks`).
    3. Shared linked specification block (`Brand of Supplier`, `City`, `PKG QTY`, `UNIT WEIGHT/PKG (KG)`, `CBM/PKG (KG)`).
    4. Group calculation formulas (`NO. OF PKG <LABEL><N>`, `TOTAL WEIGHT <LABEL><N>`, `TOTAL CBM <LABEL><N>`).
    5. Status flags (`TALLY ENTRY POSTED (Y/N)`).

### 6. Shipment Planning Packaging Specifications Backfill & Read-Time Prefetch Fallback
- **Database Cell Synchronization:**
  - Synchronized and backfilled all 278 rows in `Inhyma Mumbai` for specification columns `PKG QTY`, `UNIT WEIGHT/PKG (KG)`, and `CBM/PKG (KG)`.
  - Recomputed and stored companion formula columns (`NO. OF PKG MUM48/49/50`, `TOTAL WEIGHT MUM48/49/50`, `TOTAL CBM MUM48/49/50`) across all 278 rows.
- **Zero-Latency Batch Product Prefetch ([`app/planning/routes.py`](file:///d:/Om%20work1/ERP/Yinglima_ERP/backend/app/planning/routes.py)):**
  - Integrated single-query batch prefetching of linked products in `GET /api/v1/planning/sheets/{sheet_id}/grid`.
  - If a cell record for `PKG QTY`, `UNIT WEIGHT/PKG (KG)`, `CBM/PKG (KG)`, `Brand of Supplier`, or `City` is missing from `planning_cells`, the backend automatically resolves it directly from the prefetched Product Master data.
  - Companion formulas evaluate dynamically if unpersisted, setting both `value` and `display_value` to guarantee 100% data visibility on the frontend grid.

---

## [Release 2026-10-19] — Notification & Automation System, Shipment Planning Auto-Fit & Formula Verification

### 1. Enterprise Notification & Automation System
- **Database Architecture ([`a2b3c4d5e6f7_create_notification_rules_and_system.py`](file:///d:/Om%20work1/ERP/Yinglima_ERP/backend/alembic/versions/a2b3c4d5e6f7_create_notification_rules_and_system.py)):**
  - Added PostgreSQL tables `notification_rules`, `notifications_inbox`, and `notification_user_settings` with indexes on user, read status, and created timestamp.
- **Backend Service & Dispatcher Engine ([`app/notifications/service.py`](file:///d:/Om%20work1/ERP/Yinglima_ERP/backend/app/notifications/service.py)):**
  - Granular rules engine matching system events against configured delivery channels (`in_app`, `email`, `push`), target roles, and individual user IDs.
  - Automatically deduplicates recipients across overlapping roles and direct user assignments.
- **Event Hook Integrations:**
  - Connected live hooks in Shipment Planning (`shipment_requirement_raised`, `shipment_status_ordered`), Sales Process (`sale_process_created`), Local Purchase (`local_purchase_created`), and Inquiries (`inquiry_created`).
- **Frontend Topbar Notification Bell & Dropdown ([`NotificationBell.tsx`](file:///d:/Om%20work1/ERP/Yinglima_ERP/frontend/src/components/NotificationBell.tsx)):**
  - Integrated into top navigation bar with unread count pill badge and 30-second background polling.
  - Interactive notification drawer supporting single-click read-and-navigate, "Mark all as read" batch update, and direct link to rule configuration.
- **Notification Rule Configuration ([`NotificationSettings.tsx`](file:///d:/Om%20work1/ERP/Yinglima_ERP/frontend/src/pages/NotificationSettings.tsx)):**
  - Added management modal allowing administrators to toggle rule activation, channels, roles, and user assignments.
  - **User Search Parser Bug Fix:** Resolved user search issue where paginated API response `{ items: [...] }` was causing empty user list state in modal, enabling typeahead search (e.g. `user b`) to immediately display matching users.

### 2. Shipment Planning Master Product Linkage ("Extract From") & Multi-Sheet Architecture
- **Master Product Linkage Verification:**
  - Audited all 12 active Organization and Buyer sheets (`Inhyma Mumbai`, `Inhyma Ahmedabad`, `Inhyma Indore`, `inhyma chennai`, `Mumbai`, `Chennai`, `dubaidarsh`, `One Stop`, `F&B`, `Om Packaging`, `Prathamesh Packaging`, `Darsh Impex Mumbai`).
  - Standardized 5 core product master lookup columns (`Brand of Supplier`, `City`, `PKG QTY`, `UNIT WEIGHT/PKG (KG)`, `CBM/PKG (KG)`) as live `LINKED_LOOKUP` fields extracting directly from Product Master (`product`).
  - Added missing base linked columns to freshly created `One Stop` and `F&B` sheets.
- **Organization & Branch Data Isolation:**
  - Verified backend filtering `_all_product_ids_for_organization(effective_organization_id, branch_id=effective_branch_id)` strictly restricts rows to products belonging to that specific branch.

### 3. Shipment Planning Formula Engine Verification
- **Automated Mathematical Audit Across All Sheets:**
  - Tested 21 active formula columns and 69 live row evaluations with **0 errors / 100% mathematical accuracy**.
  - Formula dependency chain (`NO. OF PKG` $\rightarrow$ `TOTAL WEIGHT` $\rightarrow$ `TOTAL CBM`) evaluates safely with zero-division protection and instant store-on-write persistence.

### 4. Shipment Planning Auto-Fit & 80% Zoom Viewport Optimization
- **Responsive Table Geometry ([`Planning.tsx`](file:///d:/Om%20work1/ERP/Yinglima_ERP/frontend/src/pages/Planning.tsx)):**
  - Upgraded table container with fluid width and `overflowX: "auto"`.
  - Added `whiteSpace: "normal"` and responsive column widths to headers, eliminating awkward title truncation.
  - Pinned and auto-fitted right-hand Action column ensuring Edit and Delete buttons stay within viewport at 80% and 100% zoom levels.

### 5. Inquiry Product Search & Smart Focus Type-Ahead Dropdown Fix
- **Searchable Dropdown Smart Focus ([`SearchableDropdown.tsx`](file:///d:/Om%20work1/ERP/Yinglima_ERP/frontend/src/components/SearchableDropdown.tsx)):**
  - Resolved an issue where placing cursor/focus or clicking the toggle button on an already-selected product or entity triggered search with literal composite label (`Product Name (Product Code)`), returning 0 matches ("No matches.") because database columns store names and codes separately.
  - When focusing or clicking on an unchanged selection (`value !== null && inputValue.trim() === label.trim()`), the dropdown now automatically queries with empty string `""` to display all available options, highlighting the current selection with `✓`.
- **Product Fetcher Composite Label Sanitization ([`Inquiries.tsx`](file:///d:/Om%20work1/ERP/Yinglima_ERP/frontend/src/pages/Inquiries.tsx)):**
  - Updated `productFetcher` in both Quick Inquiry drawer and Inquiry edit modal to detect and extract code from composite labels containing parentheses `(CODE)` or dashes (`CODE — Name`), ensuring typed/pasted composite product strings match their respective product code or name immediately.

## [Release 2026-10-21] — Automated One-Way Product Master Cross-ERP Synchronization (Yinglima -> Inhyma)

### 1. Automated One-Way Product Master Sync (`Organization = Inhyma`)
- **Business Rule & Trigger ([`app/masters/products/sync_inhyma.py`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Yinglima_ERP/backend/app/masters/products/sync_inhyma.py)):**
  - Implemented automatic cross-ERP synchronization to Inhyma's Product Master whenever a product is created or edited in Yinglima with `Organization = Inhyma` (supports both single `organization_id` and multi-organization array `organization_ids`).
  - **Strict One-Way Policy:** Data sync is strictly unidirectional ($Yinglima \rightarrow Inhyma$). Products created, edited, or deleted in Inhyma are never synced back to Yinglima.
  - Detects Inhyma through known instance UUID (`85c12bcb-10a1-4b1f-92ed-6ca72ac1b3b5`), slug matching, and `master_companies` name/code matching (`is_inhyma_organization`).
  - Automatically syncs updates if a product was previously synchronized to Inhyma, even if the organization field is preserved or updated.

### 2. Deactivation & Soft-Delete Cascade
- **One-Way Status Synchronization:**
  - When a product is deactivated in Yinglima (`POST /masters/products/{id}/deactivate`), the deactivation event is automatically dispatched to Inhyma, marking the corresponding Inhyma product as inactive (`is_active=False`, `status="inactive"`).
  - When a product is deleted/soft-deleted in Yinglima (`DELETE /masters/products/{id}`), Inhyma cascades the archival without hard-deleting relational history.
  - **No Vice-Versa:** Deactivation or deletion in Inhyma's Product Master does NOT alter or deactivate the product in Yinglima.

### 3. Multi-Tier Resilience & Transactional Fallbacks
- **Non-Blocking Architecture:**
  - Sync failures or network timeouts in communicating with Inhyma never fail or roll back the local Yinglima product creation or update transaction.
- **Immediate Direct HTTP Delivery + Durable Outbox Queue Fallback:**
  - Upon committing the product locally, Yinglima publishes an integration outbox event (`aggregate_type="product"`) and triggers an immediate direct HTTP POST to Inhyma's `/api/v1/integration/events` endpoint using mutual peer service credentials.
  - If Inhyma is unreachable, sleeping, or experiencing latency, the delivery is automatically queued in `integration_outbox_deliveries` and retried with exponential backoff by the async queue worker.

### 4. Classification Natural Key Translation & Inhyma Dimension Harmonization
- **Natural Key Resolution:**
  - Assembles product payloads with natural business keys (`category_name`, `category_code`, `sub_category_name`, `sub_category_code`, `brand_name`, `brand_code`, `uom_code`, `hsn_code`) rather than local database foreign key UUIDs.
  - Automatically translates packaging dimensions (`length_cm`, `width_cm`, `height_cm`, `packaging_unit_cbm`) and enforces positive gross weight constraints required by Inhyma's database.

### 5. Type Safety & Diagnostic Hardening
- Resolved linter and static type analysis warnings:
  - Corrected model import to `HsnCode` from `app.masters.hsn.models`.
  - Type-narrowed dimensions (`raw_len`, `raw_width`, `raw_height`) with explicit `is not None` guards before converting to `float`, preventing `float | None` type mismatch warnings.
  - Cleaned up string conversions in `organization_ids` iteration to prevent redundant `str()` call warnings on string elements.

---

## [Release 2026-10-14] — Seed First-Install Guards, Inbound Email DB Deduplication & Handover Account Protection

### 1. Database Seed First-Install Protection (`BOOTSTRAP_FORCE_RESET`)
- **Non-Destructive Bootstrap Guard:**
  - Hardened `backend/scripts/seed.py` so that automatic startup scripts in container environments (e.g. Render build/start commands) cannot overwrite or corrupt existing production database rows.
  - If existing users, organizations, or permissions exist, seeding halts safely unless `BOOTSTRAP_FORCE_RESET=true` is explicitly provided.
  - Master geography seeding (`countries`, `states`, `districts`, `cities`) skips insertion if existing rows are present, protecting customized data.

### 2. Atomic Inbound Email Deduplication (`email_inbound_processed`)
- **Persistent Database Deduplication Ledger:**
  - Added PostgreSQL table `email_inbound_processed` (`backend/app/inquiries/models.py`) to prevent duplicate quote processing and double API consumption when the inbound email poller restarts.
  - Keyed by `(message_id, uid, inquiry_id, supplier_id)`.
  - Poller checks `SELECT 1 FROM email_inbound_processed WHERE message_id = :mid` before invoking AI extraction or recording quotation attachments.
  - Incorporates a 30-minute historical baseline cutoff on initialization: emails older than 30 minutes are stamped into the deduplication ledger without creating duplicate quotes.

### 3. SSO Handover Local Account Guards & Disabled User Rejection
- **Enforcing Local User Status on Federated Handover:**
  - Updated `POST /api/v1/auth/sso-handover` in `backend/app/api/v1/auth.py`.
  - When an incoming handover ticket is presented for a user with `is_active=False` or `deleted_at IS NOT NULL`, the system immediately rejects the handover with `401 Unauthorized` ("Account is inactive or disabled on this ERP instance").
  - Prevents terminated or suspended users from re-activating accounts via central SSO.
  - Respects `SSO_HANDOVER_AUTO_PROVISION=false`: blocks unauthorized user creation during handover.

### 4. Shared Token Pair Types Restoration
- **Session Types Alignment:**
  - Restored `TokenPair` in `backend/app/auth/security.py` and aligned with `TokenResponse` in `backend/app/auth/schemas.py`, ensuring full compatibility with session-scoped token handlers.

---

## [Release 2026-10-14] — Resilient Central Federation, DNS Winsock Isolation & Live Diagnostics

### 1. Multi-URL Central Control Plane Discovery
- **Config Fallback Array (`erp_main_api_base_urls()` in `app/core/config.py`):**
  - Added multi-candidate discovery searching across `ERP_MAIN_API_BASE_URL`, `ERP_MAIN_URL`, and fallback default URLs.
  - Enables seamless spoke communication across custom cloud domains and internal Render platform URLs.

### 2. Outbound IPv4 Binding & Sleeping Container Wake-Up Budget
- **IPv4 Socket Binding (`0.0.0.0`):**
  - In `backend/app/federation/erp_main_client.py`, `httpx.AsyncClient` binds outbound traffic to `0.0.0.0`, eliminating IPv6 connection drops on container platforms.
- **40-Second Cold-Start Sleeping Budget:**
  - Extended federation timeout budget to 40 seconds (`httpx.Timeout(40.0, connect=20.0)`), allowing sleeping Render instances to wake up cleanly without timing out SSO handovers.

### 3. 900-Second Stale Session Cache Fallback
- **Partition Tolerance (`_from_cache`):**
  - If ERP_Main is temporarily unreachable or undergoing deployment, active session validations fall back to local memory cache for up to 900 seconds (15 minutes).
  - Flags validated session as `_from_cache = True`, maintaining system uptime without dropping active operations.

### 4. Platform-Gated Winsock DNS Isolation
- **Platform Gating (`sys.platform.startswith("win")`):**
  - In `backend/app/core/dns_resilience.py`, DNS caching is platform-gated to Windows workstations only.
  - Linux production environments run unpatched, relying on native `glibc` DNS resolution.
  - Caching key uses 5-tuple `(host, port, family, type, proto)`, preserving exact port destinations and preventing localhost collisions.

### 5. Central Federation Health Diagnostics
- **Endpoint `GET /api/v1/health/federation`:**
  - Added spoke diagnostic endpoint to test real-time federation health, connectivity latency (ms), and reachable endpoints against ERP_Main.

---

## [Release 2026-10-14] — Database-Backed Organization Branding & Storage Quota Protection

### 1. Versioned Database-Persisted Organization Logo
- **Streaming Endpoint `GET /api/v1/organizations/logo?v={sha1}`:**
  - Stored enterprise logos directly in PostgreSQL `organizations.logo_data` and streamed via public endpoint with immutable caching (`Cache-Control: public, max-age=86400, immutable`).
  - SHA-1 hash query parameter guarantees immediate cache invalidation whenever the logo is updated in settings.

### 2. Client-Side Storage Quota Guards
- **Safe Quota Degradation in `brand.ts` and `Organization.tsx`:**
  - Wrapped `localStorage.setItem` for large brand assets in `try/catch` handlers.
  - Prevents `QuotaExceededError` crashes on mobile and webview browsers when storing large base64 logos, falling back gracefully to remote URLs or in-memory state.

---

## [Release 2026-10-14] — Universal Filter Button UI Standardization

### 1. Enterprise UI Harmonization
- Standardized all module filter buttons to match the Companies reference:
  - Color palette: `#556987` solid background, `#475569` on hover, permanently locked to `#556987` when active.
  - Geometry: `padding: 8px 14px`, `border-radius: 6px`, no hardcoded square dimensions.
  - Icon: 16x16px SVG funnel icon.
  - Clean surface: zero counter badges or colored dots on the button face.
  - Default state: all filter drawers initialize collapsed (`useState(false)`).

---

## [Release 2026-10-14] — Session-Scoped Tokens (one login = one session id)

- Access and refresh tokens carry a `sid` claim (`auth/security.py`). `AuthService._issue_token_pair` binds both tokens to one session id; refresh keeps it. `TokenResponse` gains `session_id` and `session_mode` (`"central"` or `"local"`).
- **Login** opens the login's central session via ERP_Main (`federation/erp_main_client.open_central_session`) only *after* the password is verified. If ERP_Main cannot be reached or refuses, the login still succeeds with a local session id `loc-<uuid>`.
- **SSO handover** issues tokens carrying the verified central `sid`.
- **Per-session revocation:** `AuthService.revoke_session` stores `sid:<sid>` in `token_blacklist` (cached), closes that session's WebSockets (`ConnectionManager.disconnect_session`). `verify_access_token` and `refresh` reject a revoked `sid` and, for central sessions, ask ERP_Main at most every 45 s (`central_session_state`, fail-open) so a lost message cannot leave a session alive.
- **New endpoint:** `POST /api/v1/internal/sessions/{sid}/revoke` (service credential). `POST /auth/logout` now revokes the token's session and reports it to ERP_Main (`push_session_signout_to_erp_main`); it no longer signs the person out of their other logins.
- **Frontend:** the login page uses the session id from the login reply; a fresh handover always replaces a saved session; no stored default-admin login; scoped cookie clearing; visible reason when an automatic sign-in fails.
- **Reliability hardening:** when ERP_Main cannot be reached during a handover the ERP now answers **503** (`EcosystemSessionUnavailable`) instead of 401, so the browser retries instead of treating it as "session ended"; the login's central call uses short timeouts (connect 1.5 s, read 3 s) so a login never hangs. Browser: one shared handover exchange per arrival, retries 0.7/2.5/6 s, per-status messages, "Signing you in..." state, a switcher that validates before navigating (and no longer declares hooks after an early return), and a watcher that checks immediately then every 30 s / 2 min (was 2.5 s).
## [Release 2026-10-15] — Buyer Master "Added On / By" Attribution & Company Name Auto Title Case

### 1. Auto Capitalization (Title Case) on Buyer Company Name
- **Frontend Real-time Title Case in [`Buyers.tsx`](file:///d:/Om%20work1/ERP/Yinglima_ERP/frontend/src/pages/Buyers.tsx):**
  - Integrated `autoTitleCase` on the **Name of Company** input field.
  - Automatically capitalizes the first letter of each typed word in real-time (e.g., `om dhanashree` $\rightarrow$ `Om Dhanashree`), exactly matching the behavior of Supplier Master.
  - Non-destructive to uppercase acronyms (e.g. `PVT LTD`, `LLP`, `IBM` remain intact).
  - 100% compatible with backend case-insensitive duplicate checks (`lower(trim(company_name))`) and search queries.

### 2. "Added On / By" User Attribution in Buyer Master Table
- **Database & Migration ([`8b9c0d1e2f3a_add_created_by_to_buyers.py`](file:///d:/Om%20work1/ERP/Yinglima_ERP/backend/alembic/versions/8b9c0d1e2f3a_add_created_by_to_buyers.py)):**
  - Added `created_by_id` column (`UUID NULL REFERENCES users(id) ON DELETE SET NULL`) to `buyers` table with index.
  - Backfilled existing 6 buyers to the system `admin` user.
- **Backend Service & Routes:**
  - Automatically captures the current authenticated user's ID upon buyer creation and CSV/XLSX file imports.
  - Resolves creator display names efficiently via single-batch lookup (`attach_creator_names`) and returns `created_by_name` in `BuyerListItemRead`.
- **Frontend Table UI in [`Buyers.tsx`](file:///d:/Om%20work1/ERP/Yinglima_ERP/frontend/src/pages/Buyers.tsx):**
  - Updated column header to **Added On / By**.
  - Renders formatted date with subtext `by {created_by_name || "—"}` in clean, read-only layout without affecting column freeze or sorting configurations.

## [Release 2026-10-15] — Products Master Table Streamlining & 720px Executive Detail Drawer with Top Photo Zoom

### 1. Products Master External Table Streamlining
- **Removed Status & Branches Columns from Main View in [`Products.tsx`](file:///d:/Om%20work1/ERP/Yinglima_ERP/frontend/src/pages/masters/Products.tsx):**
  - Removed the `Status` toggle column and `Branches` chips column from `columnHeaders` and `columns`.
  - Saves considerable horizontal space and eliminates visual clutter, allowing Product Name, Code, Brand, Categories, Supplier, and Packaging metrics to fit cleanly without horizontal crowding.
  - Full operating branch assignments and active/inactive status badges are now centrally consolidated in the executive detail drawer.

### 2. Upgraded 720px Executive Product Detail Drawer
- **Matching Design Standards of Buyers & Suppliers in [`Products.tsx`](file:///d:/Om%20work1/ERP/Yinglima_ERP/frontend/src/pages/masters/Products.tsx):**
  - Widened the Product Detail `<SideDrawer>` from standard ~480px to `720px` (`maxWidth: "95vw"`).
  - **Top Photo Hero Identity Card:**
    - Products with photos display a compact 124px × 124px photo thumbnail at the **very TOP** side-by-side with product identity (Tally name, invoice name, status badge, code, barcode, and classification chips).
    - If multiple images exist, a mini thumbnail strip enables instant switcher preview.
    - If a product has no photo, the identity block gracefully expands across the full width without blank boxes or wasted space.
    - **Clear Headline Labels for Product Code, HSN Code & Barcode:** Added explicit bold labels (`🏷️ Product Code: ...`, `🧾 HSN Code: ...`, `🔢 Barcode: ...`) in the top hero badge row and drawer header subtitle so users and warehouse personnel immediately recognize every identifier without ambiguity.
  - **Click-to-Zoom Lightbox Modal:**
    - Clicking on the top photo thumbnail opens a full-screen blurred lightbox overlay displaying the high-resolution photo with an overlay close button.
  - **🏢 Operating Locations & Assigned Branches Card:**
    - Displays organization badges (`🏛️ Inhyma Group`) and all assigned operating branches (`🏢 Inhyma Ahmedabad (IA1)`), or clear `🌐 All Branches / General Distribution` badge if unrestricted.
  - **📐 Packaging & Physical Dimensions Card:**
    - Structured 2-column grid displaying Primary UOM, Secondary UOM (with conversion factor), Packaging Quantity, Net Weight (kg), Gross Weight (kg), Dimensions (L × W × H cm), Packaging Unit CBM (formatted to 6 decimal places in bold blue `0.000000 CBM`), and MOQ.
  - **🏷️ Classification, Sourcing & Tax Card:**
    - Primary Supplier, HSN Code, GST Rate %, Refund VAT % (green badge), Standard Price, Standard Cost, Color/Material, and Purchasable/Sellable status.
  - **📜 Compliance, Licenses & Specifications Card:**
    - High-visibility alert banner for `license_certificate_required` and dedicated sections for technical specifications and notes.
  - **🕒 System Timestamps & Action Footer:**
    - Shows Created/Updated timestamps, `[ 📜 Trade & Price History ]` drawer launcher, and `[ ✏️ Edit Product ]` action.

## [Release 2026-10-15] — Buyer State/Province Field, Non-Clickable Reference Suggestions, Dual Contacts Import/Export & Performance Hardening

### 1. Replaced Black Box Confirm Dialog with Non-Clickable Reference-Only Suggestions
- **Elimination of Popup in [`Buyers.tsx`](file:///d:/Om%20work1/ERP/Yinglima_ERP/frontend/src/pages/Buyers.tsx):**
  - Removed intrusive `window.confirm` popup (`Buyer "{name}" already exists in Master. Would you like to open it to edit?`) triggered on typing or clicking existing company names.
  - Replaced with a non-clickable reference-only dropdown matching `Suppliers.tsx` standard (`Existing in Master (N) | Reference Only (Non-selectable)`). Items have `pointerEvents: "none"` and cannot overwrite user input.
  - Added non-blocking inline duplicate warning banner (`⚠️ A buyer with this exact name already exists. You can still save if intentional.`) to alert users without interrupting data entry.

### 2. Full-Stack State / Province Field (Form, DB, Import & Export, Side Drawer)
- **Database Migration [`7a8b9c0d1e2f_add_state_id_to_buyers.py`](file:///d:/Om%20work1/ERP/Yinglima_ERP/backend/alembic/versions/7a8b9c0d1e2f_add_state_id_to_buyers.py):**
  - Added `state_id` column (`UUID NULL REFERENCES states(id)`) to `buyers` table with index.
- **Backend Service, Schemas & Models:**
  - Updated `Buyer` model, `BuyerCreate`, `BuyerUpdate`, `BuyerRead`, and `BuyerListItemRead` with `state_id`.
  - Injected `StateRepository` into `BuyerService` and `dependencies.py` to validate state existence and country linkage (`_validate_state`).
- **Frontend Form & Side Drawer in [`Buyers.tsx`](file:///d:/Om%20work1/ERP/Yinglima_ERP/frontend/src/pages/Buyers.tsx):**
  - Restructured Location Details into a 3-column responsive grid: `Country *` | `State / Province (Optional)` | `City (Optional)`.
  - `State / Province` cascades dynamically from selected `Country` and resets when Country changes.
  - Displayed `State / Province` in the 720px Executive Side Drawer Location & Delivery Address card.
  - **Dynamic City Locking:** Locked City field (`disabled={!formStateId}`) showing placeholder `-- Please select State / Province first --` until a State is selected, matching Product Sub Category behavior. Automatically clears City if State or Country is changed.

### 3. Removal of Grade D Option
- **Clean Alignment with Master Specifications:**
  - Removed `<option value="D">Grade D</option>` from the inline Client Grade table select in [`Buyers.tsx`](file:///d:/Om%20work1/ERP/Yinglima_ERP/frontend/src/pages/Buyers.tsx).
  - Client Grade options now strictly adhere to standard A, B, and C (`Grade A`, `Grade B`, `Grade C`) across all table inline edits, filter headers, modal forms, and backend schemas.

### 4. Dual Contacts (`Contact Person 2`) in Import & Export Templates
- **Template Updates in [`constants.py`](file:///d:/Om%20work1/ERP/Yinglima_ERP/backend/app/buyers/constants.py) & [`sampleTemplate.ts`](file:///d:/Om%20work1/ERP/Yinglima_ERP/frontend/src/lib/sampleTemplate.ts):**
  - Export & Import headers updated to include `State / Province` (positioned between Country and City) and secondary contact fields (`Contact Person 2`, `Designation 2`, `Calling Number 2`, `WhatsApp Number 2`).
- **Import Engine Support in [`validators.py`](file:///d:/Om%20work1/ERP/Yinglima_ERP/backend/app/buyers/validators.py) & [`service.py`](file:///d:/Om%20work1/ERP/Yinglima_ERP/backend/app/buyers/service.py):**
  - Resolves `State / Province` text to `state_id` matching State master under the specified country.
  - Automatically extracts and persists secondary contacts (`is_primary=False`) in `buyer_contacts` alongside primary contacts, both on new insert and on updating existing buyers.

### 5. Contact Drawer Widening, Direct-Click Email Compose & Brand Icons
- **Direct-Click Email Compose in [`fields.tsx`](file:///d:/Om%20work1/ERP/Yinglima_ERP/frontend/src/components/fields.tsx):**
  - Removed the copy button from `EmailTagInput` chips.
  - Clicking on an email chip directly triggers email compose (`mailto:${email}` with `✉️` indicator) in the user's email client (e.g. Gmail/Outlook).
  - Maintained the quick `✕` remove button to delete tags.
- **Contact Side Drawer Width & Scrollbar Elimination in [`Buyers.tsx`](file:///d:/Om%20work1/ERP/Yinglima_ERP/frontend/src/pages/Buyers.tsx):**
  - Increased Contact Side Drawer width from `480px` to `600px` (`maxWidth: "94vw"`, `overflowX: "hidden"`).
  - Calling Number and WhatsApp Number inputs now fit side-by-side with generous breathing room and zero horizontal scrolling.
  - Replaced plain text email input with `EmailTagInput`, allowing multiple emails with chip management.
  - Added visual branding icons: `📞` for Calling Number, official green `<WhatsAppIcon />` for WhatsApp Number, and `✉️` for Email IDs.
  - Contact table rows now display multiple clickable email badges and official WhatsApp icon.

### 6. Top Filter Cleanup: "All Status" Label & "Reset Filters" Button
- **Top Filter Header Standardization in [`Buyers.tsx`](file:///d:/Om%20work1/ERP/Yinglima_ERP/frontend/src/pages/Buyers.tsx):**
  - Replaced the plain `Advanced Filters` title and red `Clear All Filters ✕` text link with the standard `Filter Options` header featuring a funnel SVG icon and a dedicated `[ Reset Filters ]` button matching `Suppliers.tsx` (`#f1f5f9` background, `#cbd5e1` border, 6px radius).
  - Corrected the Current Status filter dropdown's all-option label from `All Statuses` to `All Status`.

### 7. Form Field Label Simplification ("Category" & "Sub Category")
- **Clean Labeling in [`Buyers.tsx`](file:///d:/Om%20work1/ERP/Yinglima_ERP/frontend/src/pages/Buyers.tsx):**
  - Updated the Classification & Product Interest section labels in the Add/Edit Buyer modal from `Product Category (multiple)` and `Product Sub Category (multiple)` to **`Category`** and **`Sub Category`** for cleaner, more concise form presentation.

### 8. Merged "Category & Sub-Category" Table Column with Enhanced Width & Chips
- **Space-Saving Unified Layout in [`Buyers.tsx`](file:///d:/Om%20work1/ERP/Yinglima_ERP/frontend/src/pages/Buyers.tsx):**
  - Merged the separate `PRODUCT CATEGORY` and `PRODUCT SUB CATEGORY` table columns into a single unified **`Category & Sub-Category`** column (11 columns total instead of 12).
  - Displays Category badges with `🏷️` on top and Sub-Category badges with `↳ 📁` directly beneath, saving significant horizontal table width.
  - Increased the combined column's width (`width: 240px`, `minWidth: 220px`, `maxWidth: 300px`) and chip popover max-width (`175px`) so multi-selected categories and sub-categories render cleanly with their `+N` count badges and full popovers.
  - Updated Freeze Columns popover, column indices, skeleton rows, and sort order.

### 9. Buyer Contacts Auto-Promotion, "Make Primary" & Full Two-Way Sync (Tab 1 ↔ Tab 2)
- **Auto-Promotion of Initial Contact in [`service.py`](file:///d:/Om%20work1/ERP/Yinglima_ERP/backend/app/buyers/service.py):**
  - Resolved the disconnect where buyers created without contact details on Tab 1 ("Profile") had empty profile fields even after adding contacts in Tab 2 ("Contacts").
  - If a buyer has no primary contact yet (or `contact_full_name` is empty), adding the first contact person in Tab 2 automatically sets `is_primary=True` and syncs `contact_salutation`, `contact_full_name`, `contact_designation`, `contact_calling_number`, `contact_whatsapp_number`, and `emails` directly to the `buyers` row.
- **Dedicated "Make Primary" Promotion Endpoint:**
  - Added `POST /api/v1/buyers/{buyer_id}/contacts/{contact_id}/make-primary` in [`routes.py`](file:///d:/Om%20work1/ERP/Yinglima_ERP/backend/app/buyers/routes.py).
  - Calling this promotes the selected contact to `is_primary=True`, demotes previous primary contacts to `is_primary=False`, and syncs all profile and contact phone/email fields into the `buyers` table row.
- **Frontend Two-Way Profile & Table Re-Sync in [`Buyers.tsx`](file:///d:/Om%20work1/ERP/Yinglima_ERP/frontend/src/pages/Buyers.tsx):**
  - Added `★ Make Primary` action button for team members in the Tab 2 Contacts Table.
  - Added `★ Set as Primary Contact Person (syncs directly to Profile tab)` checkbox in the Contact Person side drawer (defaults to checked if no primary contact exists yet).
  - Implemented `refreshBuyerProfileAfterContactChange`: saving, editing, promoting, or deleting contacts now immediately refreshes Tab 1 profile form, Tab 2 contacts list, the main table row, and the 720px side detail drawer.
  - Comprehensive unit test suite in [`test_buyer_contact_sync.py`](file:///d:/Om%20work1/ERP/Yinglima_ERP/backend/tests/test_buyer_contact_sync.py) with 100% pass rate.

### 10. Verified Performance Benchmarks & Zero Regressions
- **Response Times (Measured on warm database engine):**
  - `GET /buyers` paginated query: **~310 ms** (under 350 ms target).
  - CSV Export generation (28 columns): **~421 ms**.
  - XLSX Export generation (28 columns): **~398 ms**.
  - Bulk Import execution (with State & Contact 2 resolution): **~1,130 ms**.
- **Test Suite:** 16 of 16 tests passing (13 durable & sync tests + 3 contact sync tests); frontend build passes cleanly in 2.52s with 0 errors.

## [Release 2026-10-14] — Buyer Module Category Loading Optimization & Full 720px Detail Drawer

### 1. In-Memory Category & Sub-Category Performance Optimization in Buyer Form
- **Zero-Latency In-Memory Resolution in [`Buyers.tsx`](file:///d:/Om%20work1/ERP/Yinglima_ERP/frontend/src/pages/Buyers.tsx):**
  - Eliminated the 4-5s delay and duplicate network calls when opening and typing in the Category & Sub-Category multi-select fields in the Buyer Create/Edit modal.
  - Replaced uncached network fetches with memoized in-memory filtering against `categories.items` and `subCategories.items` (already prefetched and cached by `useLookup`).
  - Added in-memory fast-path lookup to `fetchNameLabel` for `/masters/product-categories`, `/masters/product-sub-categories`, `/masters/buyer-types`, and `/masters/countries`, eliminating individual per-chip network queries when pre-populating multi-select values.
  - Stabilized callback references with `useCallback` (`fetchCategoryOptions`, `fetchCategoryLabel`, `fetchSubCategoryOptions`, `fetchSubCategoryLabel`) to eliminate redundant effect re-executions during modal interactions.

### 2. Full Detail View on Blue Link Click (Buyer 720px Side Drawer)
- **Executive Detail Drawer in [`Buyers.tsx`](file:///d:/Om%20work1/ERP/Yinglima_ERP/frontend/src/pages/Buyers.tsx):**
  - Clicking any blue Buyer Company Name hyperlink opens a 720px side drawer (`SideDrawer`) fetching the complete buyer profile from `GET /buyers/:id` with background loading indicator (`⏳ Loading full details...`).
  - Organized into 5 executive cards matching the Supplier module standard:
    1. **🏢 Company Profile & Classification:** Company Name, Buyer Type, Tax ID (TIN / GST), Country, City, Category chips (`🏷️`), Sub-Category chips (`📂`), Currently Buying From, Product Range, Remarks.
    2. **👤 Primary Contact Information:** Contact Person, Designation, Calling Number (`📞 tel:`), WhatsApp Number with official vector `<WhatsAppIcon size={16} />` and direct `https://wa.me/...` link (`↗`), Email badges (`mailto:`), Website links (`🌐 ↗`).
    3. **📍 Location & Postal Delivery Address:** Country, City, Full Postal Delivery Address.
    4. **📊 Pipeline Status & Commercial Evaluation:** Client Grade pill (`GRADE A/B/C`), Current Status pill (`EXISTING/NEW`), Potential Status pill (`YES/NO`), Reason for Potential Status.
    5. **👥 Additional Contacts Roster:** Displays all secondary contacts from `detailBuyer.contacts` with Person Name, Designation, Calling Number, WhatsApp Number with WhatsApp SVG icon, and Email.
  - Supports deep-linking via `?id=` query parameter and full synchronization with browser back navigation via `useModalHistorySync`.

## [Release 2026-10-14] — Supplier Dual Contacts, Town Removal, Address Relocation & Master Validation

### 1. Dual Contacts in Supplier Import / Export & Multi-Number Support
- **Dual Contacts Pipeline in [`Suppliers.tsx`](file:///d:/Om%20work1/ERP/Yinglima_ERP/frontend/src/pages/Suppliers.tsx), [`service.py`](file:///d:/Om%20work1/ERP/Yinglima_ERP/backend/app/suppliers/service.py), and [`constants.py`](file:///d:/Om%20work1/ERP/Yinglima_ERP/backend/app/suppliers/constants.py):**
  - Extended import and export templates to support secondary contacts: `Contact Person 2`, `Designation 2`, `Calling Number 2`, `WhatsApp Number 2`, and `WeChat Number 2`.
  - Added support for comma/slash-separated multiple phone numbers with normalization.
  - Applied migration [`41a972a6d3d4_widen_supplier_phone_columns.py`](file:///d:/Om%20work1/ERP/Yinglima_ERP/backend/alembic/versions/41a972a6d3d4_widen_supplier_phone_columns.py) to widen phone columns to `VARCHAR(150)`.

### 2. Complete Removal of `Town` Column across Entire Stack
- **Database & Codebase Purge in [`models.py`](file:///d:/Om%20work1/ERP/Yinglima_ERP/backend/app/suppliers/models.py) and [`Suppliers.tsx`](file:///d:/Om%20work1/ERP/Yinglima_ERP/frontend/src/pages/Suppliers.tsx):**
  - Generated and applied Alembic migration [`86ea2b62aa9c_drop_town_from_suppliers.py`](file:///d:/Om%20work1/ERP/Yinglima_ERP/backend/alembic/versions/86ea2b62aa9c_drop_town_from_suppliers.py).
  - Dropped `town` from `Supplier` model, Pydantic schemas (`SupplierCreate`, `SupplierUpdate`, `SupplierRead`), routes, repositories, search service, import/export headers, and frontend drawer/form bindings.

### 3. Form Layout Rebalancing & Address Relocation to Tab 1
- **Full-Width Address under Geography:**
  - Relocated `Address` field to **Tab 1 (General Information)** immediately beneath Country, Province, and City, spanning all 3 columns (`gridColumn: "1 / -1"`).
  - Removed `Address` and `Town` from Tab 2, rebalancing the remaining 6 profile fields into a symmetrical **2-row × 3-column** grid without empty cells.

### 4. Strict Province Master Validation
- **Master Integrity in [`Suppliers.tsx`](file:///d:/Om%20work1/ERP/Yinglima_ERP/frontend/src/pages/Suppliers.tsx):**
  - Removed `allowCustomText={true}` and `onTextChange` from `field-province`.
  - Eliminated `Use "..." (New) ↵ Enter` prompt; users can strictly select valid states from the Province Master (`/masters/states`), matching Country and City behavior.

### 5. Table Column Optimization: Column Consolidation (15 to 11 Columns) & Horizontal Scroll Elimination

### 1. Merged Company Name & Brand Column
- **2-Line Clamping & Informational Pill Tag in [`Suppliers.tsx`](file:///d:/Om%20work1/ERP/Yinglima_ERP/frontend/src/pages/Suppliers.tsx):**
  - Consolidated separate "Company Name" and "Brand" columns into a unified **"Company Name & Brand"** column.
  - Implemented 2-line clamping (`-webkit-line-clamp: 2`) with hover tooltip (`title={s.company_name}`) to comfortably accommodate long company names without breaking row layout.
  - Placed the Brand directly underneath as a subtle pill badge (`🏷️ <Brand>`) when present.

### 2. Merged Category & Sub-Category Column
- **Hierarchical Vertical Display in [`Suppliers.tsx`](file:///d:/Om%20work1/ERP/Yinglima_ERP/frontend/src/pages/Suppliers.tsx):**
  - Combined "Product Category" and "Key Strength Sub-Category" into **"Category & Sub-Category"**.
  - Renders category chips on line 1 and sub-category chips underneath on line 2 (`↳ 📂 <Sub-Category>`), maintaining full popover modal inspection.

### 3. Merged Products Supplied & Secondary Products Column
- **Unified Product Portfolio Presentation in [`Suppliers.tsx`](file:///d:/Om%20work1/ERP/Yinglima_ERP/frontend/src/pages/Suppliers.tsx):**
  - Combined Primary Products Supplied chips and Secondary Products description into a unified single column **"Products Supplied & Secondary"**.
  - Primary products render on line 1 (`📦 <Products> (+N)`), and secondary products render directly underneath on line 2 (`↳ 📦 <Secondary>`).

### 4. Removed Redundant Country Column from Frontend Table
- **Streamlined Geographic Column:**
  - Hidden the redundant `Country` (`China`) column from the list view table while preserving City and Province, saving 90px+ of horizontal space. Country remains intact in database models, edit forms, and Side Drawer.

### 5. Synchronized Skeleton Loader, Sorting & Freeze Menu
- **11-Column Unified System:**
  - Updated `displayOrder`, `SUPPLIER_TABLE_COLUMNS`, header sorting switch, and `SupplierSkeletonRows` to the new 11-column index structure.
  - Adjusted `TableMessageRow colSpan` to 11.

### 6. Master Quality Assurance (QA) & Verification Audit Checklist Added
- **Comprehensive Audit Specification in [`MODULE_SUPPLIERS.md`](file:///d:/Om%20work1/ERP/Yinglima_ERP/doc/MODULE_SUPPLIERS.md):**
  - Added dedicated Section 7 covering: Form dropdown integrity & cascading rules, Saving & two-way sync across table inline and inside form modal, Blue Company Name link triggering the 720px Side Drawer (Complete View) with 5 structured cards, 11-column layout verification, Top filter views with unlocked master search and 'All' reset, Dual contacts in import/export, and Loading time benchmarks (<300ms API, 0ms cached dropdowns).

### 7. Simplified Top Filter Dropdown Labels
- **Filter Labels Refined in [`Suppliers.tsx`](file:///d:/Om%20work1/ERP/Yinglima_ERP/frontend/src/pages/Suppliers.tsx):**
  - Renamed `Product Category` ➔ **`Category`**.
  - Renamed `Key Strength Sub Category` ➔ **`Product Sub Category`**.
  - Renamed `Product Supplied` ➔ **`Product`**.
  - Preserved all underlying cascading queries, debouncing, master lookups, and `"All"` reset behavior.

### 8. Official WhatsApp & WeChat SVG Brand Icons in Side Drawers
- **Icon Upgrades in [`Suppliers.tsx`](file:///d:/Om%20work1/ERP/Yinglima_ERP/frontend/src/pages/Suppliers.tsx) and [`Buyers.tsx`](file:///d:/Om%20work1/ERP/Yinglima_ERP/frontend/src/pages/Buyers.tsx):**
  - Replaced generic chat bubble emojis (`💬` and `🗨️`) with crisp, official vector SVG brand symbols.
  - **WhatsApp:** Green `#25D366` SVG icon paired with clickable `https://wa.me/...` direct link.
  - **WeChat:** Green `#07C160` SVG dual-bubble icon for instant recognition.
  - Applied across Primary Contact Information (Card 2) and Additional Contacts (Card 5).

---

## [Release 2026-10-13] — Supplier Module Side Drawer Expansion, Potential Dropdown Fix & Master Documentation

### 1. Supplier Detail Side Drawer Overhaul (720px 2-Column Executive Layout)
- **Expanded Width & Structured Cards in [`Suppliers.tsx`](file:///d:/Om%20work1/ERP/Yinglima_ERP/frontend/src/pages/Suppliers.tsx):**
  - Expanded drawer from 480px to **720px** (`maxWidth: 720px, width: 100%`) for a spacious, non-overlapping dual-column layout.
  - Added 5 structured cards: Company Profile & Classification, Primary Contact Information, Factory Visit & Inspection Media, Pipeline Status & Commercial Evaluation, and Additional Contacts.
  - Implemented smart clickable badges for inspection videos and cloud folders (`▶️ YouTube Video ↗`, `📁 Google Drive ↗`, `📂 OneDrive ↗`, `🎬 Vimeo ↗`, `🎥 Video Link ↗`).
  - Added direct clickable links for Phone (`tel:`), WhatsApp (`https://wa.me/...`), Email (`mailto:`), and official websites.

### 2. Potential Dropdown Case-Sensitivity Bug Fix
- **Option Value Alignment in [`Suppliers.tsx`](file:///d:/Om%20work1/ERP/Yinglima_ERP/frontend/src/pages/Suppliers.tsx):**
  - Normalized database potential values (`"yes"` / `"no"`) with the Edit Modal's dropdown options, resolving the bug where suppliers with Potential = Yes were reverting to "Select Potential" upon opening the modal.

### 3. Supplier Master Requirement Specification Document
- **Master Documentation in [`MODULE_SUPPLIERS.md`](file:///d:/Om%20work1/ERP/Yinglima_ERP/doc/MODULE_SUPPLIERS.md):**
  - Compiled the complete master specification for the Supplier module, including field validations (calling number digit restrictions, WeChat/WhatsApp handling), business logic (one-way New -> Existing progression, deletion protection rules), side drawer architecture, and downstream cross-module integrations with Local Purchase, Sourcing, and Planning.

### 4. Floating Reference-Only Master Suggestion Dropdown for Supplier Company Name
- **Floating Suggestion Architecture in [`Suppliers.tsx`](file:///d:/Om%20work1/ERP/Yinglima_ERP/frontend/src/pages/Suppliers.tsx):**
  - Implemented an autocomplete-style floating suggestion container underneath the "Name of Company" field on the Supplier create/edit form.
  - Prioritizes prefix matches so typing `"o"` or `"om"` places matching suppliers like `"Om"` at the very top of the suggestion list.
  - Configured with `pointer-events: none` and `user-select: none` ("untouchable") to ensure suggestions are purely visual/informational and cannot be accidentally clicked or selected to overwrite user text.
  - Integrated real-time exact duplicate detection that blocks saving and shows an alert both inside the dropdown and beneath the blurred input field.

### 5. Sidebar Active-Click Page State Reset & Sequential History Preservation
- **Active Navigation Reset in [`AppShell.tsx`](file:///d:/Om%20work1/ERP/Yinglima_ERP/frontend/src/components/AppShell.tsx), [`Suppliers.tsx`](file:///d:/Om%20work1/ERP/Yinglima_ERP/frontend/src/pages/Suppliers.tsx), and [`Buyers.tsx`](file:///d:/Om%20work1/ERP/Yinglima_ERP/frontend/src/pages/Buyers.tsx):**
  - Fixed an issue where clicking on "Suppliers" in the sidebar while viewing the "Add Supplier" form did nothing because React Router ignored clicks to the currently active URL.
  - Added an active-click event bus (`erp:nav-active-click`) in `AppShell.tsx` that signals the mounted view to close any open forms, drawers, or import views and return directly to the main table/list.
  - Maintained strict browser history sequencing: navigating between pages (e.g. Suppliers ⇄ Buyers) pushes standard browser history entries so back and forward browser arrows work with 100% fidelity.

### 6. 3-Tier Cascading Categorization & Grouped Multi-Panel Dropdown for Products Supplied
- **Hierarchical Products Supplied Dropdown in [`Suppliers.tsx`](file:///d:/Om%20work1/ERP/Yinglima_ERP/frontend/src/pages/Suppliers.tsx):**
  - Upgraded **Products Supplied (multiple)** to dynamically filter products by both selected **Product Category (multiple)** and **Key Strength Sub-Category (multiple)**.
  - Configured intelligent disabled states: disabled with `"-- Please select Category first --"` if no category is selected, or `"-- Please select Sub-Categories first --"` if categories are chosen but no sub-categories have been selected yet.
  - When multiple categories and sub-categories are selected, products render in a grouped multi-panel dropdown organized under their parent Sub-Categories (labeled `${Category} › ${Sub-Category}` or `${Sub-Category}`), matching the UX design of the Sub-Category dropdown.
  - Supported master `Select All`, category/sub-category group-level select-all checkboxes with count indicators `(X/Y selected)`, and individual product checkboxes.
  - Implemented automatic pruning: removing a category prunes any selected sub-categories and products belonging to that category; removing a sub-category prunes any selected products under that sub-category.
### 7. Universal Top Filter Bar Unlock & Typeahead Master Search
- **Standardized Top Filter UX Across All Active ERP Modules:**
  - Upgraded top filter dropdowns in **Suppliers** (`Suppliers.tsx`), **Product Master** (`masters/Products.tsx`), **Buyers** (`Buyers.tsx`), **Product Prices** (`ProductPrices.tsx`), **Product Gallery** (`ProductGallery.tsx`), and **Local Purchases** (`LocalPurchases.tsx`).
  - **Eliminated Locked / Disabled Fields:** Completely removed arbitrary `disabled={!parent}` locks on cascading filters (such as *Sub Category*, *Province / State*, *City*).
  - **Master Typeahead Search with 'All' Support:** Every dropdown includes a live `Search / Type here...` input and an `"All"` reset option at the top.
  - **Dynamic Contextual Scoping:** If a parent filter is chosen, options are scoped to that parent; if no parent filter is chosen, users can search and select across all records directly from the respective master lookup/endpoint without friction.

---

## [Release 2026-10-13] — Latency & Response-Time Optimization Across Backend & Frontend

### 1. Backend N+1 Query Elimination & Eager Loading
- **RBAC Roles Preloading in [`repository.py`](file:///d:/Om%20work1/ERP/Yinglima_ERP/backend/app/rbac/repository.py), [`routes.py`](file:///d:/Om%20work1/ERP/Yinglima_ERP/backend/app/rbac/routes.py), and [`service.py`](file:///d:/Om%20work1/ERP/Yinglima_ERP/backend/app/rbac/service.py):**
  - Replaced serial loop querying permissions for each role (`for r in roles: await get_permission_codes_for_role(r.id)`) with `list_all_with_permissions` using SQLAlchemy `selectinload(Role.permission_links).selectinload(RolePermission.permission)`.
  - Dropped database round trips from 45 serial queries down to 2 batched queries.
  - Response time dropped from **5,464 ms to 340 ms (16x faster)**.
- **User Management Batching in [`users/routes.py`](file:///d:/Om%20work1/ERP/Yinglima_ERP/backend/app/users/routes.py):**
  - Implemented `_batch_users_with_roles` replacing the 4 sequential queries per user row (roles, manager, position, employee position) with 3 single SQL queries using `IN (...)`.
  - Response time dropped from **2,928 ms to 620 ms (4.7x faster)**.

### 2. 0ms Fast-Path In-Memory DNS Resolution
- **Winsock DNS Bypass in [`dns_resilience.py`](file:///d:/Om%20work1/ERP/Yinglima_ERP/backend/app/core/dns_resilience.py):**
  - Added an in-memory 60-second TTL fast-path cache to prevent repetitive Windows Winsock system calls (160ms each) on pooled Supabase connections across Yinglima ERP, Inhyma ERP, and Central ERP Main.

### 3. Frontend Route Code-Splitting with `React.lazy`
- **Dynamic Module Loading in [`App.tsx`](file:///d:/Om%20work1/ERP/Yinglima_ERP/frontend/src/App.tsx):**
  - Converted secondary and master pages to `React.lazy` dynamic imports wrapped with `<Suspense>`.
  - Initial production JavaScript bundle dropped from **1,497.86 kB (1.5 MB) down to 266.16 kB (82% smaller)**.
  - Heavy third-party packages such as SheetJS (`xlsx` at 429 kB) are now loaded strictly on-demand when Excel export/import actions occur.

### 4. Shell Caching & Form Optimization
- **Profile & Brand Caching in [`auth.ts`](file:///d:/Om%20work1/ERP/Yinglima_ERP/frontend/src/lib/auth.ts), [`AppShell.tsx`](file:///d:/Om%20work1/ERP/Yinglima_ERP/frontend/src/components/AppShell.tsx), and [`brand.ts`](file:///d:/Om%20work1/ERP/Yinglima_ERP/frontend/src/lib/brand.ts):**
  - Added 10-second throttling to `/auth/profile` sync to eliminate redundant network hits during navigation.
  - Added memory caching and in-flight request deduplication to `resolveBrandName()`, reducing `/organizations/public` calls to 0.99 ms.
- **Local Purchase Quote Optimization in [`LocalPurchaseForm.tsx`](file:///d:/Om%20work1/ERP/Yinglima_ERP/frontend/src/pages/purchases/LocalPurchaseForm.tsx):**
  - Corrected lookup URL from `/suppliers?page_size=1000` to standard `/suppliers` to enable global caching.
  - Line-item quote lookups now execute in parallel via `Promise.all` and update state in a single batch, reducing form load latency to 269 ms.

---
## [Release 2026-10-12] — Local Purchase Supplier Type-Ahead, Bill Document Cloud Storage & RBAC Master Documentation

### 1. Local Purchase Supplier Searchable Combobox & Extraction Auto-Fill
- **Type-Ahead Autocomplete in [`LocalPurchaseForm.tsx`](file:///d:/Om%20work1/ERP/Yinglima_ERP/frontend/src/pages/purchases/LocalPurchaseForm.tsx):**
  - Replaced the static HTML `<select>` dropdown with the application's reusable [`SearchableDropdown`](file:///d:/Om%20work1/ERP/Yinglima_ERP/frontend/src/components/SearchableDropdown.tsx).
  - Users can now type characters (e.g. "San", "LT", "Young") to filter suppliers in real time with keyboard navigation (Arrow Up/Down + Enter) and a quick-clear (`✕`) button.
  - Selecting a supplier automatically syncs with quotation line-item pricing and planning sheet imports.
- **Bill Document Cloud Storage in Supabase & Download Action:**
  - Extended local purchase backend schemas and services ([`schemas.py`](file:///d:/Om%20work1/ERP/Yinglima_ERP/backend/app/purchases/local/schemas.py), [`service.py`](file:///d:/Om%20work1/ERP/Yinglima_ERP/backend/app/purchases/local/service.py), [`storage.py`](file:///d:/Om%20work1/ERP/Yinglima_ERP/backend/app/common/storage.py)) to upload and persist invoice files (PDFs, images, Excel) to Supabase Storage.
  - Added direct invoice document download actions on both [`LocalPurchaseForm.tsx`](file:///d:/Om%20work1/ERP/Yinglima_ERP/frontend/src/pages/purchases/LocalPurchaseForm.tsx) and [`LocalPurchaseDetailModal.tsx`](file:///d:/Om%20work1/ERP/Yinglima_ERP/frontend/src/pages/purchases/LocalPurchaseDetailModal.tsx).
  - When **⚡ Extract Bill Data** runs, any detected supplier name or ID automatically resolves against the supplier database and pre-fills the type-ahead search bar.

### 2. Comprehensive RBAC & Permissions Master Guide
- **Master Documentation in [`ROLES_AND_PERMISSIONS_MASTER_GUIDE.md`](file:///d:/Om%20work1/ERP/Yinglima_ERP/doc/ROLES_AND_PERMISSIONS_MASTER_GUIDE.md):**
  - Created a full architectural and operational guide covering Yinglima ERP's Role-Based Access Control (RBAC) engine.
  - Documented the Department-Role convergence, the 3-tier precedence hierarchy (Super Admin > Department Defaults > User Overrides), and the mathematical effective permission formula.
  - Included a complete matrix of all 25 modules and their fine-grained permission codes (`module.action`), backend dependencies (`require_permission`), frontend UI guards (`<Can>`, `hasPermission`), and real-time Redis/memory cache invalidation lifecycles.

---

## [Release 2026-10-10] — Cross-Ecosystem Single Sign-Out (SLO), M2M Force Logout API & WebSocket Disconnect

### 1. Internal Machine-to-Machine Force-Logout API
- **Endpoint Implementation in [`internal_users.py`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Yinglima_ERP/backend/app/api/v1/internal_users.py):**
  - Added `POST /api/v1/internal/users/{identifier}/logout` guarded by `internal_service_dep` HMAC authentication.
  - Accepts local UUID or email/username prefix to resolve the user record.
  - Invokes `auth_service.force_logout_user(user.id)`, invalidating active sessions and recording a revocation timestamp to blacklist bearer tokens.
  - Emits real-time `FORCE_LOGOUT` frame across live WebSocket channels (`ws_manager.disconnect_user(str(user.id))`) to instantly disconnect open browser sessions.
- **Unit Test Coverage:**
  - Added `test_internal_logout_endpoint_works` in [`test_internal_users_foreign_keys.py`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Yinglima_ERP/backend/tests/test_internal_users_foreign_keys.py).

### 2. Multi-Origin Browser Session Invalidation & Shared Cookie Logout
- **Cross-Port Cookie Synchronization in [`ecosystemSession.ts`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Yinglima_ERP/frontend/src/lib/ecosystemSession.ts):**
  - Sets `ihm_ecosystem_logged_out=1` cookie on logout across domain `localhost` and configured subdomains with root path `/`.
  - Added `isExplicitlyLoggedOut()` helper checking both `sessionStorage` and the shared cookie marker.
  - Clears `ihm_ecosystem_logged_out` on fresh logins via `setEcosystemCookie()`.
- **Fast Watcher & App Lifecycle Defense:**
  - Configured `initEcosystemSessionWatcher()` to poll every 2.5 seconds and trigger on window focus and visibility changes.
  - In [`AppShell.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Yinglima_ERP/frontend/src/components/AppShell.tsx), verified `isExplicitlyLoggedOut()` on mount and immediately purged local auth state (`Auth.clear()`) if any other ecosystem tab or app logged out.
  - In [`ssoBridge.ts`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Yinglima_ERP/frontend/src/lib/ssoBridge.ts), updated `isExplicitLogout` to use `isExplicitlyLoggedOut()`, preventing automatic SSO re-authentication after a user explicitly logged out.

---

## [Release 2026-10-10] — Spoke 403 Loop Elimination, Address Bar Query Sanitization & Cross-ERP Failover Redirection

### 1. Spoke ERP 403 Loop Prevention & Failover Cross-ERP Redirection
- **Immediate Address Bar Query Sanitization in [`ssoBridge.ts`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Yinglima_ERP/frontend/src/lib/ssoBridge.ts):**
  - In `processIncomingSsoHandover()`, stripped `sso_handover` from `window.location.search` immediately upon parsing via `window.history.replaceState`. Prevents re-submitting rejected tickets on browser refreshes or navigation changes.
- **Failover Cross-ERP Redirection on 403 Forbidden:**
  - When backend `POST /api/v1/auth/sso-handover` responds with 403 (e.g. user `userb@gmail.com` granted only Inhyma attempts to access Yinglima), the `catch` block clears stale credentials (`Auth.clear()`) and inspects the active central session.
  - Automatically redirects users to their granted spoke ERP (e.g. Inhyma at `http://localhost:5174/dashboard?sso_handover=...`) or the official central control plane (`http://localhost:5170/dashboard`), avoiding endless 403 exception retries.
- **AppShell & App Lifecycle Loop Defense:**
  - In [`AppShell.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Yinglima_ERP/frontend/src/components/AppShell.tsx), sanitized `location.search` when redirecting to `/login` to ensure rejected handover parameters are not carried into login route state.
  - In [`App.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Yinglima_ERP/frontend/src/App.tsx), added `ssoProcessedRef = useRef(false)` guard preventing repeated invocations across component re-renders.
  - In [`Login.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Yinglima_ERP/frontend/src/pages/Login.tsx), added mount-time handover processing parity with Inhyma ERP.

### 2. Auto-Activation on Central SSO Handover & Eviction Guard
- **Verified Account Auto-Activation in [`auth/routes.py`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Yinglima_ERP/backend/app/auth/routes.py):**
  - In `sso_handover_login`, when central verification confirms the user is authorized for Yinglima, any existing account marked inactive or soft-deleted is automatically restored (`deleted_at = None`, `is_active = True`, `status = UserStatus.ACTIVE`). Unregistered users are auto-provisioned on the fly. Eliminates 403 errors when central permissions are restored.
- **Central Verification Before Eviction in [`AppShell.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Yinglima_ERP/frontend/src/components/AppShell.tsx):**
  - Gated the logged-in access check behind `verifyCentralEcosystemSession`. Prevents stale localhost browser cookies from evicting newly authenticated users and eliminates multi-tab redirect loops.
- **Failover SSO Error Signaling in [`ssoBridge.ts`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Yinglima_ERP/frontend/src/lib/ssoBridge.ts):**
  - Appended `?sso_error=handover_failed` when redirecting back to the control plane, allowing ERP_Main to halt automated bouncing and retain the user on the control plane dashboard.

---

## [Release 2026-10-10] — Production HTTPS Mixed Content Elimination, Supabase PgBouncer Statement Cache Auto-Disable, Cascading Category Enforcement & Bi-Directional Password Sync Federation

### 1. Production Origin Security, Dynamic SSO Routing & User Isolation
- **`isLocalhost()` Security Interceptor:**
  - In [`ecosystemSession.ts`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Yinglima_ERP/frontend/src/lib/ecosystemSession.ts) and [`ssoBridge.ts`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Yinglima_ERP/frontend/src/lib/ssoBridge.ts), wrapped all `http://localhost:*` fallback URLs with `isLocalhost()` guards.
  - In production HTTPS deployments (e.g. Render, Cloudflare, custom domains), insecure `http://` calls to ports `:8000`, `:8001`, `:8002`, `:5170`, `:5173`, and `:5174` are suppressed, eliminating browser Mixed Content blocking errors (`Blocked loading mixed active content`).
- **Dynamic SSO Route Handling (`routeForCentralSession`):**
  - Added `routeForCentralSession` and `createSsoHandoverUrlFromSession` in [`ssoBridge.ts`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Yinglima_ERP/frontend/src/lib/ssoBridge.ts) to handle multi-ERP routing directly from central session data.
  - Users with 0 granted spoke ERPs (e.g. `User A`, `User B`, `User C`, `User D` with `allowed_erps = ["control-plane"]`) or $\ge 2$ spoke ERPs are automatically redirected to `http://localhost:5170/dashboard`.
  - Users with exactly 1 other spoke ERP are redirected to their assigned ERP dashboard.
- **User Isolation Guard:**
  - In `processIncomingSsoHandover()`, if the incoming ticket or cookie email differs from the local cached profile, `Auth.clear()` runs immediately to enforce strict account isolation and avoid session leakage across logins.
  - Direct navigation to Yinglima routes (`/dashboard`) by unassigned users triggers an automatic bounce to `http://localhost:5170/dashboard`.

### 2. Dual-Path Centralized Spoke Login (`Login.tsx`)
- **Central Session Routing & Graceful SSO Fallback in [`Login.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Yinglima_ERP/frontend/src/pages/Login.tsx):**
  - Updated the login workflow to perform local authentication while concurrently establishing the central ecosystem session with `ERP_Main`.
  - Supports flexible user lookup by canonical email, display name (e.g. `User A`), or username prefix.
  - If a user is not authorized for Yinglima (including zero-grant users), `routeForCentralSession` immediately redirects them via SSO handover to the official central dashboard (`http://localhost:5170/dashboard`) or their designated spoke ERP rather than throwing an unhandled error.
  - If a user's password was changed on another ERP and has not yet synced locally, the verified central session logs them in via SSO handover, preventing user lockouts.
  - Fails closed: if the user's central session is reported revoked or inactive, login is rejected immediately.

### 3. Bi-Directional Password Synchronization with ERP_Main
- **Password Fanout Client [`erp_main_client.py`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Yinglima_ERP/backend/app/federation/erp_main_client.py):**
  - Added `push_password_to_erp_main(email, new_password)` transmitting password changes to `ERP_Main` via `POST /internal/users/password` using internal service credentials.
- **Route Interceptors:**
  - Hooked into `change_password` in [`auth/routes.py`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Yinglima_ERP/backend/app/auth/routes.py) and `reset_password` in [`users/routes.py`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Yinglima_ERP/backend/app/users/routes.py).
  - Automatically pushes password updates to ERP_Main so they propagate across the entire multi-ERP ecosystem without raising into or interrupting the local caller.
- **Automated Test Suite:**
  - Added [`test_password_sync_to_erp_main.py`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Yinglima_ERP/backend/tests/test_password_sync_to_erp_main.py).

### 4. SSO Handover Central Verification Guard
- **Fail-Closed Session Confirmation in [`auth/routes.py`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Yinglima_ERP/backend/app/auth/routes.py):**
  - Integrated `verify_ecosystem_session(session_id)` from [`erp_main_client.py`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Yinglima_ERP/backend/app/federation/erp_main_client.py) into `sso_handover_login`.
  - When `SSO_HANDOVER_REQUIRE_CENTRAL_VERIFICATION` is enabled, the backend verifies the central session against ERP_Main's live database before generating local tokens.
  - Ensures tokens constructed client-side cannot bypass access governance, and immediately rejects revoked or suspended accounts.
- **Automated Test Suite:**
  - Added [`test_sso_handover_central_verification.py`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Yinglima_ERP/backend/tests/test_sso_handover_central_verification.py).

### 5. Central Identity Protection on Local Profile Edits
- **Email Modification Lock in [`users/routes.py`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Yinglima_ERP/backend/app/users/routes.py):**
  - Implemented `enforce_central_identity(user_service, user_id, payload)`.
  - Form re-submissions containing the existing email are permitted, but attempting to modify an email address locally throws `ForbiddenException("A user's email is managed centrally. Please change it from the ERP_Main Control Panel.")`, preventing broken SSO identity mappings.

### 6. Cascading Category Enforcement in Master Data UI
- **Required Category Selection Before Subcategory Population:**
  - In [`Products.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Yinglima_ERP/frontend/src/pages/masters/Products.tsx), [`Suppliers.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Yinglima_ERP/frontend/src/pages/Suppliers.tsx), [`Buyers.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Yinglima_ERP/frontend/src/pages/Buyers.tsx), and [`SearchableDropdown.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Yinglima_ERP/frontend/src/components/SearchableDropdown.tsx):
  - Strictly requires selecting a Primary Category before the Subcategory dropdown can be populated or selected.
  - Subcategory is disabled and indicates `"Select category first"` until a category is chosen.
  - Changing or clearing the Category automatically resets the selected Subcategory.

### 7. Database Connection Hardening for Supabase Transaction Pooler (PgBouncer)
- **Prepared Statement Cache Auto-Disable:**
  - In [`app/database/engine.py`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Yinglima_ERP/backend/app/database/engine.py), implemented `_statement_cache_must_be_disabled()`.
  - Auto-detects port 6543 / PgBouncer connection strings and disables asyncpg's prepared statement cache (`statement_cache_size=0`), preventing `DuplicatePreparedStatementError`.

### 8. Local Purchase Boolean Simplification
- In [`app/sales/service.py`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Yinglima_ERP/backend/app/sales/service.py), simplified `is_from_local_purchase` logic for clean, deterministic sourcing attribution.

### 9. Python Virtualenv Interpreter Resolution in `server.py`
- Fixed Windows virtual environment symlink resolution by using `sys.executable` directly rather than `Path(sys.executable).resolve()`.

### 10. Spare-Part Support in Sale Process Order Processing (`is_spare`)
- **Backend Schema & Service Extensions ([`models.py`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Yinglima_ERP/backend/app/sales/models.py), [`schemas.py`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Yinglima_ERP/backend/app/sales/schemas.py), [`service.py`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Yinglima_ERP/backend/app/sales/service.py)):**
  - Added `is_spare` boolean column to `sales_order_items` with validation in request schemas.
  - Handled spare-part unit pricing, packaging, and commercial calculations in `service.py`.
- **Frontend Interface ([`SaleProcessForm.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Yinglima_ERP/frontend/src/pages/sales/SaleProcessForm.tsx), [`SaleProcessDetailModal.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Yinglima_ERP/frontend/src/pages/sales/SaleProcessDetailModal.tsx), [`saleProcess.ts`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Yinglima_ERP/frontend/src/types/saleProcess.ts)):**
  - Added interactive spare-part toggle and product picker to differentiate main machines from spare components.
  - Added `[Spare]` visual badges and dedicated costing column displays in both the form and order detail modal.

### 11. Master Shipment Planning `(Blanks)` Filter & Migration Suite
- **Planning Grid Empty Cell Filtering ([`planning/repository.py`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Yinglima_ERP/backend/app/planning/repository.py), [`Planning.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Yinglima_ERP/frontend/src/pages/Planning.tsx)):**
  - Added `(Blanks)` filter option in column filter dropdowns, allowing logistics operators to filter container sheets for rows with unset values.
- **Migration & Health Diagnostic Scripts:**
  - Added [`migrate_master_planning.py`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Yinglima_ERP/backend/scripts/migrate_master_planning.py) for robust automated migration of master planning workbook data.
  - Added [`update_product_branches.py`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Yinglima_ERP/backend/scripts/update_product_branches.py) and [`inspect_counts.py`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Yinglima_ERP/backend/scripts/inspect_counts.py).

---

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

## [Release 2026-10-10] — Real-Time Provisioning Synchronization & Soft-Deleted User Restoration
- **Re-Granting Restoration:** Updated `POST /api/v1/internal/users/provision` in [`internal_users.py`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Yinglima_ERP/backend/app/api/v1/internal_users.py) to look up users by email regardless of `deleted_at`. When access is restored in ERP_Main, any soft-deleted user is reactivated (`deleted_at = None`, `is_active = True`, `status = ACTIVE`) and their password updated if provided.
- **Dynamic List Filtering:** Soft-deleted users are omitted from active user queries (`/users`), while restored users immediately reappear upon being granted access.

---

## [Release 2026-10-10 Part 2] — Ecosystem Session Reliability, Cross-ERP Switching & False Logout Elimination

### 1. Root Cause Resolution for False Logouts and Switch Loops
- **Session Revocation Disambiguation:** In [`ecosystemSession.ts`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Yinglima_ERP/frontend/src/lib/ecosystemSession.ts), the `ihm_ecosystem_logged_out` cookie was previously written as a generic `"1"`, causing newly established sessions to be flagged as revoked.
- **Session-ID Keyed Revocation:** `clearEcosystemCookie(sessionId)` now records the exact revoked session ID inside `ihm_ecosystem_logged_out`. `isExplicitlyLoggedOut(currentSessionId)` only flags revocation if the cookie's recorded ID matches the current active session.
- **SSO Handover Exemption:** Added immediate exemption for incoming SSO handover navigation (`sso_handover` query param in URL) ensuring switching users are never rejected as logged out.
- **Cross-Domain/Port Cleansing:** Added `clearCookieEverywhere` and `setCookieEverywhere` covering host-only, `localhost`, `127.0.0.1`, current hostname, and `VITE_COOKIE_DOMAIN`.

### 2. Multi-Tab Session Synchronization & Polling Loop Hardening
- **Watcher Polling Loop Fix:** Removed redundant calls to `clearEcosystemCookie()` inside periodic polling, preventing perpetual renewal of the 60-second logout window.
- **Tab Focus Stale State Recovery:** Window `focus` events purge stale tab-scoped `ihm_explicit_logout` flags when an active local session exists.

### 3. Switcher Fallbacks & Local Login Session Recovery
- **Switch Failure Fallback:** Wrapped `handleSwitch` in [`EcosystemSwitcher.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Yinglima_ERP/frontend/src/components/EcosystemSwitcher.tsx) in try/catch blocks with direct navigation fallback.
- **Local Login Fallback Session:** In [`Login.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Yinglima_ERP/frontend/src/pages/Login.tsx), local login automatically establishes a fallback ecosystem session cookie if central control plane communication is degraded.

### 4. Backend Multi-Identifier & Role-Based Authorization
- **Comprehensive Key Resolution:** In [`routes.py`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Yinglima_ERP/backend/app/auth/routes.py), `sso_handover_login` matches against all known Yinglima identifiers (`yinglima`, `erp-02`, and dynamic `settings.ERP_KEY`), eliminating 403 Forbidden false rejections when central permissions use machine keys or friendly names.
- **Central Authority & Super Admin Exemption:** Central role verification honors `central.get("role") == "super_admin"` with ecosystem-wide access, preventing super admins or users with valid grants from getting trapped in redirect loops.

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
