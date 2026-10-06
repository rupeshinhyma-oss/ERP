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

## [Release 2026-10-03] — Local Purchase: Smart Supplier Quote Auto-Inheritance & User-Driven Quantity Logic

### 1. Smart Supplier Unit Rate & Quote Lookup
- **Supplier-Aware Rate Auto-Inheritance:**
  - In [`LocalPurchaseForm.tsx`](file:///d:/Om/work1/ERP/Yinglima_ERP/frontend/src/pages/purchases/LocalPurchaseForm.tsx), when adding a product from catalog search, the system now queries `/api/v1/inventory/product-prices/{product_id}/suppliers`.
  - **Priority 1 (Matched Supplier Quote):** If the supplier selected on the invoice has an active quote for that product in `supplier_product_links`, that supplier's exact `unit_price` is auto-filled into `unit_rate`.
  - **Priority 2 (Preferred Quote / Available Quote):** If the selected supplier does not have a quote, it falls back to the preferred quote (or first active quote > 0) in Product Prices.
  - **No Quote in Product Prices:** If no supplier quote exists in Product Prices, the system does **NOT** check Product Master (since master catalog does not hold purchase prices). `unit_rate` is left empty/blank (`""`) with placeholder `0.00` so the user types their own price directly.
- **Dynamic Supplier Switch Auto-Fill:**
  - When the user selects or switches the Supplier on the invoice, existing items with `unit_rate = 0` are automatically checked against the newly selected supplier's price quotes and updated.

### 2. Multi-Level Quantity Auto-Populate & Direct User Entry
- **Quantity Hierarchy:**
  - **Priority 1 (Supplier Quote MOQ):** If the matched supplier quote specifies `moq > 0`, quantity is initialized to `quote.moq`.
  - **Priority 2 (Packaging Quantity / MOQ from Product Master):** If supplier quote has no MOQ (or 0), the system checks `packaging_quantity` (or `minimum_order_quantity`) from Product Master.
  - **Priority 3 (Both Zero / Empty — User's Own Input):** If both MOQ and Product Master packaging quantity are 0 or empty, the field is **NOT** forced to 1. It is left blank/empty (`""`) with placeholder `0` so the user types their own required quantity directly.
- **Removed Forced Blur Overrides:**
  - Removed old `onBlur` behavior that forcibly overrode empty quantities to `1`.
  - Added visual error highlight (`▲ Qty > 0 req.`) and form submission validation to prevent submitting an invoice without quantity while giving the user full editing freedom.

---

## [Release 2026-10-03] — Product Price Directory: Manual Preferred Supplier Selection & Rate Benchmark Control

### 1. Manual Supplier Selection Control (No Automatic Lowest-Wins Enforced)
- **Eliminated Automatic Lowest Quote Constraint:**
  - Previously, the system strictly sorted quotations by price (`ORDER BY price ASC`), automatically crowning whichever supplier quoted the lowest amount as the primary benchmark.
  - Added user-directed control allowing procurement and management to manually designate any supplier quote as the **⭐ Preferred Supplier** for any product.
- **Backend Prioritized Ordering & API:**
  - Updated CTE query in [`repository.py`](file:///d:/Om%20work1/ERP/Yinglima_ERP/backend/app/masters/product_prices/repository.py) to prioritize the manually selected supplier (`CASE WHEN spl.supplier_id = p.supplier_id THEN 0 ELSE 1 END ASC`) before falling back to lowest quote.
  - Added `PUT /api/v1/inventory/product-prices/{product_id}/preferred-supplier` with [`SetPreferredSupplierPayload`](file:///d:/Om%20work1/ERP/Yinglima_ERP/backend/app/masters/product_prices/schemas.py) to set or clear preferred supplier status on `products.supplier_id`.
  - Added `is_preferred: bool` flag to [`ProductPriceItem`](file:///d:/Om%20work1/ERP/Yinglima_ERP/backend/app/masters/product_prices/schemas.py), [`ProductPriceSupplierItem`](file:///d:/Om%20work1/ERP/Yinglima_ERP/backend/app/masters/product_prices/schemas.py), and [`AssignSupplierPricePayload`](file:///d:/Om%20work1/ERP/Yinglima_ERP/backend/app/masters/product_prices/schemas.py).

### 2. Multi-Currency Conversions & Exchange Rates 100% Preserved
- **Multi-Currency System Retained:**
  - Preserved all dynamic currency conversions (`USD`, `CNY`/`RMB`, `EUR`, `INR`), currency symbols, converted estimate hints `(~$ ...)`, and live exchange rate API polling (`/masters/currencies/rates`).
  - Quoted prices and conversions reflect the exact currency and unit rate of the selected preferred supplier.

### 3. Interactive UI Controls in Product Prices Module
- **Accordion Sub-Table (`Compare ▾`):**
  - Added `[⭐ Set Preferred]` and `[⭐ Preferred (Unset)]` action buttons on each supplier quotation row with optimistic UI updates.
  - Added golden `⭐ PREFERRED` badge for the designated supplier, and preserved `LOWEST` badge for lowest price comparison.
- **Add Quote Modal & Sub-Table Quick Add:**
  - Added `☑ Set as Preferred Supplier for this product` toggle in both the `+ Add Price / + Quote` modal and the sub-table inline quick-add row.
- **Main Table Row:**
  - Displays `⭐ Preferred` badge next to the primary supplier name when manually selected by the user.

---

## [Release 2026-10-03] — Local Purchase Streamlining & Complete Organization/Branch Removal

### 1. Complete Database Column Drop & Backend Clean-up
- **Database Column Dropping (`local_purchases` table):**
  - Executed PostgreSQL schema migration dropping `organization_id`, `organization_name`, `branch_id`, and `branch_name` columns from `local_purchases` (`ALTER TABLE local_purchases DROP COLUMN IF EXISTS ...`).
- **Backend ORM Models & Schemas:**
  - Removed `organization_id`, `organization_name`, `branch_id`, and `branch_name` from [`LocalPurchase` model](file:///d:/Om%20work1/ERP/Yinglima_ERP/backend/app/purchases/local/models.py), [`LocalPurchaseBase`](file:///d:/Om%20work1/ERP/Yinglima_ERP/backend/app/purchases/local/schemas.py), [`LocalPurchaseCreate`](file:///d:/Om%20work1/ERP/Yinglima_ERP/backend/app/purchases/local/schemas.py), [`LocalPurchaseUpdate`](file:///d:/Om%20work1/ERP/Yinglima_ERP/backend/app/purchases/local/schemas.py), and [`LocalPurchaseSummaryResponse`](file:///d:/Om%20work1/ERP/Yinglima_ERP/backend/app/purchases/local/schemas.py).
- **Backend Repository, Service & Routes:**
  - Removed organization and branch fields from [`LocalPurchaseRepository`](file:///d:/Om%20work1/ERP/Yinglima_ERP/backend/app/purchases/local/repository.py) searchable and filterable fields and queries.
  - Removed columns from Excel exporter in [`service.py`](file:///d:/Om%20work1/ERP/Yinglima_ERP/backend/app/purchases/local/service.py) with re-indexed number and alignment formatting.
  - Cleaned up query parameters and response mappings in [`routes.py`](file:///d:/Om%20work1/ERP/Yinglima_ERP/backend/app/purchases/local/routes.py).

### 2. Frontend List Table & Filter Drawer Clean-up
- **Table Column Removal (`LocalPurchases.tsx`):**
  - Removed the `ORGANIZATION & BRANCH` column header and table body cells.
  - Adjusted table empty and loading states to `colSpan={10}`.
- **Filter Drawer & State:**
  - Removed the `Organization` and `Operating Branch` dropdown filters and lookup dependencies from [`LocalPurchases.tsx`](file:///d:/Om%20work1/ERP/Yinglima_ERP/frontend/src/pages/purchases/LocalPurchases.tsx).
- **Detail View & Form Dead Code Elimination:**
  - Removed the `To (Receiving Location)` card from [`LocalPurchaseDetailModal.tsx`](file:///d:/Om%20work1/ERP/Yinglima_ERP/frontend/src/pages/purchases/LocalPurchaseDetailModal.tsx).
  - Removed all leftover state and payload attributes from [`LocalPurchaseForm.tsx`](file:///d:/Om%20work1/ERP/Yinglima_ERP/frontend/src/pages/purchases/LocalPurchaseForm.tsx) and updated TypeScript interfaces in [`types/localPurchase.ts`](file:///d:/Om%20work1/ERP/Yinglima_ERP/frontend/src/types/localPurchase.ts).

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
