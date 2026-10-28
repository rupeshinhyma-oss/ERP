# Module Guide: Local Purchase (`local_purchase`)

**System:** Yinglima_ERP  
**Module:** Local Procurement & Purchases (`/purchases/local`)  
**Status:** Active / Production Ready  
**Last Updated:** 2026-10-12  

---

## 1. Overview & Purpose

The **Local Purchase** module allows China operations to record domestic procurement orders, manage supplier invoices/bills, track line items, calculate totals, handle taxes, and export purchase orders. It bridges domestic Chinese procurement with international shipment planning.

---

## 2. Key Architecture & File Map

### Frontend:
* **Form & Editing:** [`LocalPurchaseForm.tsx`](file:///d:/Om%20work1/ERP/Yinglima_ERP/frontend/src/pages/purchases/LocalPurchaseForm.tsx) (Route: `/purchases/local/new`, `/purchases/local/:id/edit`)
* **List Page:** [`LocalPurchases.tsx`](file:///d:/Om%20work1/ERP/Yinglima_ERP/frontend/src/pages/purchases/LocalPurchases.tsx) (Route: `/purchases/local`)
* **Detail Modal:** [`LocalPurchaseDetailModal.tsx`](file:///d:/Om%20work1/ERP/Yinglima_ERP/frontend/src/pages/purchases/LocalPurchaseDetailModal.tsx)
* **Searchable Combobox:** [`SearchableDropdown.tsx`](file:///d:/Om%20work1/ERP/Yinglima_ERP/frontend/src/components/SearchableDropdown.tsx)

### Backend:
* **Service:** [`service.py`](file:///d:/Om%20work1/ERP/Yinglima_ERP/backend/app/purchases/local/service.py)
* **Schemas:** [`schemas.py`](file:///d:/Om%20work1/ERP/Yinglima_ERP/backend/app/purchases/local/schemas.py)
* **Storage Utility:** [`storage.py`](file:///d:/Om%20work1/ERP/Yinglima_ERP/backend/app/common/storage.py)
* **Routes:** `app/purchases/local/routes.py`
* **Models:** `app/purchases/local/models.py` (`local_purchases`, `local_purchase_items`)

---

## 3. What Was Changed / Updated

### Release 2026-10-27: Top Filter Options Card Standardization & Permanent Reset Filters Button
1. **Permanent `Reset Filters` Button & Unified Card Header:**
   - Standardized the expandable filter box in `LocalPurchases.tsx` to match the Suppliers and Buyers reference standard:
     - Header row with `<svg>` Funnel icon and bold title `Filter Options` with active count badge.
     - Top-right permanent `Reset Filters` button (`background: #f1f5f9`, border `#cbd5e1`, slate text `#475569`, bold, rounded 6px).
     - Clicking `Reset Filters` instantly resets `selectedSupplierId`, `selectedStatus`, `dateFrom`, `dateTo`, and `searchInput`, restoring pagination to Page 1.
   - Clean uniform 38px inputs with title-cased labels (`Supplier`, `Status`, `From Date`, `To Date`) positioned cleanly above each input.

### Release 2026-10-27: Lightweight Supplier Dropdown Migration (`/suppliers/lookup`)
1. **Lightweight Dropdown Lookup Integration:**
   - Switched `supplierLookup` in `LocalPurchaseForm.tsx` and `LocalPurchases.tsx` to use the dedicated `GET /api/v1/suppliers/lookup` endpoint.
   - Drastically reduced response payload from ~25 KB (or up to 3 MB at scale) to only **4.43 KB** (an 82% reduction).
   - In-memory cache returns active suppliers instantaneously in **< 1 ms** without loading heavy relations (contacts, addresses, tax IDs) into procurement forms.
2. **Active Supplier Parity:**
   - By leveraging `/suppliers/lookup`, inactive suppliers (e.g. `LT1`) are omitted at the database query level (`WHERE is_active = true`), preventing inactive vendors from being mistakenly selected.

### Release 2026-10-26: Dynamic VAT % & Removal of 13.0% Fallback
1. **Removed 13.0% Fallback Across Models, Schemas & Services:**
   - Changed `LocalPurchaseItem.vat_rate` model default from `13.0` to `0.0`.
   - Updated Pydantic schemas (`LocalPurchaseItemBase`, `BillExtractionItem`) to default `vat_rate` to `0.0` instead of `13.0`.
   - In `service.py`, item VAT calculation now evaluates `float(raw_vat) if raw_vat is not None else 0.0`.
   - In bill extraction & product matching, fallbacks default to `0.0` (or the Product Master / HSN assigned `purchase_vat_percent`), ensuring no phantom 13% tax is introduced.
2. **Sales Process Costing Alignment:**
   - In `backend/app/sales/service.py` and `SaleProcessForm.tsx`, costing calculations strictly respect the Local Purchase invoice tax rate or the Product Master tax rate, eliminating the `13.0%` hardcoded fallback.
3. **3-Level Dynamic VAT Inheritance Hierarchy:**
   - **Priority 1 (Product Specific):** If `Product.purchase_vat_percent` is configured (e.g. 8%), it takes absolute precedence over generic tax codes.
   - **Priority 2 (HSN Code Category):** If product specific VAT is null, it inherits from the linked `HsnCode.purchase_vat_percent`.
   - **Priority 3 (Default):** If neither is set, defaults cleanly to `0.0%` (strictly zero hardcoded values).
   - **User Invoice Override:** When editing or creating a local purchase order, users can directly edit the line item VAT % to match the domestic factory invoice.

### Release 2026-10-13: Latency & Form Optimization
1. **Lookup Endpoint Normalization:**
   - Standardized supplier lookup URL from `/suppliers?page_size=1000` to `/suppliers`, enabling global lookup caching and avoiding heavy unpaginated payload transfers.
2. **Parallelized Line Item Quote Fetching:**
   - Product pricing lookups for unquoted items (`/inventory/product-prices/{id}/suppliers`) now run concurrently using `Promise.all` and update component state in a single batch, reducing form load latency to 269 ms.

### Release 2026-10-12: Supplier Searchable Combobox & Cloud Storage
1. **Supplier Searchable Combobox (Type-Ahead):**
   - Replaced static HTML `<select>` with interactive `SearchableDropdown`.
   - Users can type any partial name (e.g. "San", "LT") to filter suppliers in real time.
   - Supports keyboard navigation (Arrow Up, Down, Enter, Escape) and quick clear (`✕`).
   - Keeps standard red error validation border if submitted empty.
2. **Bill Document Cloud Storage (Supabase):**
   - Added cloud storage upload for invoice documents (`invoice_file_path`, `invoice_file_name`) targeting Supabase Storage.
   - Added direct file download actions in both the Form and the Detail Modal.
3. **Bill Extraction Auto-Fill Integration:**
   - When the user clicks **⚡ Extract Bill Data**, any supplier identified by the AI extractor automatically matches against the supplier directory and pre-populates the type-ahead search bar.

### Release 2026-10-19: Automated Event Notifications
1. **Purchase Order Notification Hook (`local_purchase_created`):**
   - Automatically fires the `local_purchase_created` event when a domestic purchase order is successfully saved.
   - Dispatches in-app notifications and email alerts to configured procurement roles and managers.
   - Topbar alert includes PO number, supplier name, and total amount with direct link to the purchase order.

### Release 2026-10-24: Automated Warehouse Inwarding & Stock Movement Integration
1. **Automated Warehouse Inwarding Directly from Local Purchase (`/purchases/local`):**
   - Streamlined domestic inward receipts: instead of requiring warehouse staff to manually recreate purchase bills inside Stock Movements, an inward receipt is triggered directly from the confirmed Local Purchase.
   - Status Column Action: When a purchase is in `Confirmed` status, the Status column displays a prominent **`[📦 Inward Stock]`** button. The row action menu (`⋮`) also includes **`📦 Inward to Warehouse`**.
2. **Form Status Dropdown (`Confirmed` / `Inwarded`) & Inward Stock Card (`LocalPurchaseForm.tsx`):**
   - Added a visible **Status** dropdown in the Add/Edit form with exactly two options:
     - `● Confirmed`: Default status for new local purchases.
     - `● Inwarded`: Automatically expands the **Warehouse Inward Stock Receipt** card.
   - When `Inwarded` is selected:
     - Configurable fields appear: Receiving Warehouse (defaults to `"Main Godown"`), Movement/Inward Date (defaults to today), Transporter Name, Vehicle Registration No, and Inward Delivery Remarks.
     - Upon clicking Save, the purchase is created/updated and immediately executes the inward workflow (`POST /api/v1/purchases/local/{purchase_id}/inward`), crediting warehouse stock balances and generating the inward slip (`INW-YYYY-XXXX`).
3. **Pre-Populated Verification Modal (`LocalPurchaseInwardModal.tsx`):**
   - For existing confirmed purchases in the list view, clicking `[📦 Inward Stock]` opens the verification modal pre-filled with supplier, invoice, and line item quantities.
   - Defaults: Warehouse Location defaults to `"Main Godown"`, Movement Date defaults to today, and each item defaults to 100% accepted quantity (`quantity = expected_quantity`, `damaged_quantity = 0`).
   - Supports live adjustment of received and damaged quantities, transporter name, vehicle registration number, and delivery remarks.
4. **Performance & Loading Time Enhancements:**
   - **Debounced Search:** Added a 300ms debounce to the search input in `LocalPurchases.tsx`, eliminating redundant intermediate API queries while typing.
   - **Lightweight Item Count Subquery:** Optimized `LocalPurchaseRepository.list_with_filters` with `load_only(LocalPurchaseItem.id)` on line items, preventing heavy column fetching for summary listings.
   - **Database Indexing:** Created compound index `ix_local_purchases_active_created ON local_purchases (deleted_at, created_at DESC)` and `ix_local_purchases_invoice_date` for 0ms sorting and filtering.
5. **Database Purge of Legacy Test Records:**
   - Cleaned up 15 legacy test records lacking proper organization/consignment mappings, preserving single valid reference purchase `32132132165` (`Inhyma Mumbai / Mum 48`) with 4 realistic line items.

### Release 2026-10-23: Consignment Product Supplier Filtering
1. **Consignment Line Items Scoped to Selected Supplier:**
   - Multi-supplier consignments (e.g. shipping containers like `Mum 48` carrying products across 10+ different manufacturing vendors) now strictly filter to only the products belonging to the selected supplier when generating local purchase orders.
   - Prevents unassociated vendor goods from populating into single-supplier purchase orders and bills.
2. **Bidirectional Cascading Flow:**
   - **Supplier Selected First &rarr; Consignment Selected:** Only planned products in the chosen consignment belonging to the active supplier auto-populate.
   - **Consignment Selected First &rarr; Supplier Selected:** Selecting or switching the supplier immediately re-filters the consignment's planned items with instant 0ms latency from cached consignment data.
   - **Zero Matching Products Handling:** When a supplier has 0 planned items in a selected consignment, the table clears gracefully with an informative toast and zero-count badge (`ℹ️ 0 planned items for [Supplier] in Consignment [Code]`).
   - **Accurate Information Badge:** The table header displays: `📦 {count} planned item(s) for {supplier} from Consignment {code}` with a `Load Planned Items` refresh button.
3. **Backend Query Optimization:**
   - `GET /api/v1/purchases/local/consignments/{column_id}/items` accepts optional `supplier_id` query parameter for direct server-side filtering.
   - Response items include `linked_supplier_ids` to support secondary supplier relationships via `SupplierProductLink`.

### Release 2026-10-24 (Part 2): Header Filter Action, Top Filter Panel & Consignment-Scoped Product Search
1. **Header Action Bar Filter Button & Products Master UI Consistency (`LocalPurchases.tsx`):**
   - **Top Header Action Placement:** Positioned the Filter Toggle Button (`.btn.btn-header-filter`) in the top page header actions bar (top right, immediately preceding `+ ADD LOCAL PURCHASE` and `Export ▾`), achieving 100% visual consistency with the Products Master (`MasterPage.tsx`).
   - **Color & Icon Palette:** Styled with corporate slate `#475569` when inactive, switching to primary blue `#0061f2` when the filter panel is open or filters are active. Features a crisp white SVG funnel icon (`⏚`) and a red active filter counter badge (`#ef4444`).
   - **Top Expandable Filter Panel:** Rendered as an expandable `.card` directly above the Data Table Card (between KPI stat cards and table card). Contains Supplier dropdown, Status dropdown (`Confirmed`, `Inwarded`, `Pending`, `Cancelled`), From Date, To Date, and `✕ Reset Filters`.
   - **Clean Table Toolbar:** Retained a clean, focused Data Table Card toolbar: Items/Page selector (`20`, `50`, `100`, `200`) on the left, and debounced Search input with search SVG and `✕` clear button on the right.
2. **Card 3 Product Search Strictly Scoped to Selected Consignment (`LocalPurchaseForm.tsx`):**
   - Replaced global master product catalog search with container-specific planned product search derived from `consignmentRawItems` (the products planned in the selected container column).
   - **Pre-Selection Lock:** When Branch & Consignment are not yet selected, Card 3 is safely locked with clear guidance (`🔒 Please select Branch & Consignment in Card 1 first to search planned products`).
   - **Scoped Autocomplete:** Once a consignment is chosen, typing in the search box filters only among products planned in that container by name, product code, or vendor/brand name.
   - **Supplier Prioritization:** When a supplier is selected in Card 1, products matching that supplier are highlighted with a `✓ Selected Supplier` badge and prioritized at the top of the search dropdown.
   - **Planned Quantity & Blank Unit Rate Entry:** Clicking any planned product adds it to the items table with its planned container quantity (`prod.quantity`) and blank unit rate `""` (placeholder `0.00`) ready for direct supplier invoice entry.
   - Eliminates redundant network calls to `/masters/products?page_size=1000`, dramatically accelerating form loading and interaction.

3. **Granular RBAC Permission: `local_purchase.inward` (`routes.py` & `LocalPurchases.tsx`):**
   - Registered dedicated permission `local_purchase.inward` in RBAC permissions matrix (`0 / 6 active` for Local Purchase).
   - Display label: `📦 Inward to Warehouse` (icon: `📦`, module: `local_purchase`).
   - Gated `[📦 Inward Stock]` status column button and `📦 Inward to Warehouse` kebab menu item behind `hasPermission("local_purchase.inward")`.
   - Backend endpoint `POST /api/v1/purchases/local/{purchase_id}/inward` strictly enforces `require_permission('local_purchase.inward')` (returning 403 Forbidden for unauthorized users).
   - Granted to `super_admin` role by default; configurable per Department and Role in `/rbac`.

### Release 2026-10-26: Instant 0ms Navigation, In-Memory SWR Cache & Post-Edit Detail Synchronization
1. **Instant 0ms Blue Link Opening (`LocalPurchaseDetailModal.tsx` & `localPurchaseCache.ts`):**
   - Implemented client-side SWR caching module `frontend/src/lib/localPurchaseCache.ts`.
   - Clicking on any blue invoice link (e.g. `LP-YLM/2026/0102`) opens the detail modal instantaneously at **0ms** without blanking the screen with `⏳ Loading local purchase details...`.
   - When opened, the modal immediately paints either from the `detailCache` or by synthesizing basic summary attributes from `initialSummary` (`LocalPurchaseSummary`).
   - Line items table only displays a micro-spinner inside `<tbody>` if line items are streaming for the first time; once loaded or saved, line items render at 0ms.
   - Background revalidation runs concurrently against `GET /api/v1/purchases/local/{id}` and updates the cache.

2. **Instant 0ms "Back to List" Navigation (`LocalPurchases.tsx` & `LocalPurchaseForm.tsx`):**
   - In `LocalPurchases.tsx`, `purchases`, `loading`, and `total` are initialized synchronously from `getLocalPurchasesListCache(cacheKey)`.
   - Clicking `← BACK TO LIST` or Cancel from the edit/new page renders the table, KPI stat cards, and pagination controls at **0ms** from memory without any full-page reload or loading spinner flicker.
   - Silent background revalidation confirms data consistency with PostgreSQL in the background.

3. **Live Post-Edit Detail & List Synchronization:**
   - On saving an edit in `LocalPurchaseForm.tsx`, the server response (`LocalPurchaseDetail`) is immediately passed to `updateLocalPurchaseInCache(savedDetail)`.
   - Updates both the detail cache for that purchase and in-memory list cache entries in-place.
   - When the user navigates back to `/purchase/local` and immediately clicks the blue invoice link again, the modal immediately displays the **freshly updated data** (updated invoice number, supplier, amounts, expenses, and line items) with zero stale lag.
   - In edit mode, `LocalPurchaseForm.tsx` pre-populates all form controls instantly at 0ms from `getLocalPurchaseDetailCache(id)`.

4. **Warehouse Inward Modal Damaged Quantity Placeholder & Input Ergonomics (`LocalPurchaseInwardModal.tsx`):**
   - Configured `placeholder="0"` so empty/zero damaged quantities render as subtle gray placeholder text rather than stubborn literal value text.
   - Added `onFocus={(e) => e.target.select()}` across Received and Damaged inputs so clicking or tabbing into the field auto-highlights the number, preventing keystroke concatenation (e.g. typing `10` will never accidentally turn into `100`).
   - Entering damaged quantities automatically deducts from accepted Received quantities (`quantity = Math.max(0, expected - damaged)`), ensuring exact inventory balance alignment.
   - Visual feedback: Damaged quantities `> 0` render in bold red (`#dc2626`) with a red border (`1.5px solid #ef4444`) and soft red background (`#fef2f2`).

---

## 4. What Needs to Be Verified (Testing Checklist)

When touching this module, always verify the following:

- [ ] **Instant 0ms Blue Link Opening:**
  - On `/purchase/local`, click on any blue invoice link (`LP-YLM/2026/0102`).
  - Modal must open immediately at 0ms with complete details; no blanking loading screen.
- [ ] **Instant 0ms Back to List Navigation:**
  - Click `[Edit]` on a local purchase, navigate to `/purchase/local/:id/edit`.
  - Click `← BACK TO LIST`. Table and KPI stat cards must paint instantly at 0ms without `⏳ Loading local purchases...` spinner.
- [ ] **Post-Edit Fresh Data Verification on Blue Link:**
  - Edit any field on an existing local purchase (e.g. change invoice total or note or items).
  - Click `Save Changes`.
  - On returning to `/purchase/local`, click the blue invoice number link.
  - The modal must immediately display the newly edited data without stale numbers or delay.

- [ ] **Supplier Selection & Filtering:**
  - Open `/purchases/local/new`.
  - Type 2–3 letters into the Supplier box. Suggestions must filter dynamically.
  - Press Down Arrow + Enter. The supplier must select properly and display their name.
- [ ] **Validation on Submit:**
  - Submit the form without picking a supplier. A red border and error message must appear.
  - Picking a supplier must immediately clear the error.
- [ ] **Line Items & Calculation:**
  - Add at least 2 line items with Quantity, Unit Price, and Tax rate.
  - Verify Subtotal, Total Tax, and Grand Total update instantaneously without NaN or rounding errors.
- [ ] **Bill Document Upload & Download:**
  - Attach an invoice PDF or image.
  - Save the purchase order.
  - Open the Detail Modal (`LocalPurchaseDetailModal.tsx`) and click the download button. The original invoice must download cleanly.
- [ ] **Edit Mode Pre-Fill:**
  - Open an existing purchase order for editing (`/purchases/local/:id/edit`).
  - Verify the supplier name is pre-populated in the search bar, not blank or showing an empty ID.
- [ ] **Permission Gates & Inward Access Control:**
  - Users with `local_purchase.view` can browse and view orders.
  - Users lacking `local_purchase.create` or `local_purchase.update` must not see the Save or Edit buttons.
  - Users with `local_purchase.inward` can see and click `[📦 Inward Stock]` and `📦 Inward to Warehouse`.
  - Users lacking `local_purchase.inward` cannot see inwarding buttons and are blocked with 403 on `POST /purchases/local/{id}/inward`.
  - Departments / Roles in `/rbac` can independently toggle the 6th Local Purchase permission (`📦 Inward to Warehouse`).

---

## 5. Critical Constraints: What to KEEP / What NOT to Break

> [!CAUTION]
> **Do NOT alter or remove the following core behaviors under any circumstances:**

1. **Dual State Synchronization (`supplierId` + `supplierName`):**
   - Both `supplier_id` (UUID) and `supplier_name` (string) must be preserved in state and submitted together. Downstream reports and exports rely on `supplier_name` being immediately available without join latency.
2. **No Fallback Costing to Master Product Prices:**
   - In Sales Process and Shipment Planning, unmatched local purchase products must strictly evaluate to `$0.00 / ¥0.00` and **never silently fall back** to the global product catalog price.
3. **Soft-Delete Cascade:**
   - Deleting a Local Purchase must soft-delete its child `local_purchase_items` rows (`deleted_at IS NOT NULL`). Hard-deleting rows directly via SQL breaks trash recovery.
4. **Storage URL Handling:**
   - When downloading an invoice file, ensure the Supabase signed URL generation handles spaces and Unicode filenames safely via `encodeURIComponent` or backend proxy.
5. **No Auto-Submit on Enter:**
   - Selecting a supplier from the dropdown via keyboard `Enter` must NOT prematurely submit the entire purchase order form. `e.preventDefault()` must remain on dropdown key handlers.
6. **Instant Organization Loading & Consignments Decoupling:**
   - Organization lookup (`/masters/company-list/lookup`) is fetched independently and cached in memory across form opens for instant 0ms dropdown display.
   - Any newly added organization in Organization Master is immediately fetched fresh and displayed.
   - Consignments lookup (`/purchases/local/consignments-lookup`) runs single-batch SQL with in-memory TTL caching without blocking Organization selection.
