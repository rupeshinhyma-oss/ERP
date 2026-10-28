# Module Guide: Sales Process & Commercial Invoice Engine (`sales_process`)

**System:** Yinglima_ERP  
**Module:** Sales Process Orders, 16-Column CI Costing Engine & Exports (`/sale/process`)  
**Status:** Active / Production Ready  
**Last Updated:** 2026-10-21  

---

## 1. Overview & Purpose

The **Sale Process** module is the central international trade and billing engine of Yinglima ERP. It connects confirmed buyer orders, confirmed supplier local purchases, container shipping allocations, export VAT refunds, and Commercial Invoice (CI) 16-column calculations. It supports custom export sheets (such as the China-to-India Mumbai Sheet and standard CI/PL packing lists).

---

## 2. Key Architecture & File Map

### Frontend:
* **Orders List:** `SaleProcessOrders.tsx` (Route: `/sale/process`)
* **New / Edit Order Form:** `SaleProcessForm.tsx` (Route: `/sale/process/new`, `/sale/process/:id/edit`)
* **Commercial Invoice (CI) 16-Column Table:** `CommercialInvoiceTable.tsx`
* **Export Actions:** `ExcelExportButton.tsx` (Direct Excel `.xlsx` generator)

### Backend:
* **Routes:** `app/sales/routes.py`, `app/sales/process/routes.py`
* **Service:** `app/sales/service.py`, `app/sales/costing_service.py`
* **Models:** `app/sales/models.py` (`sale_process_orders`, `sale_process_items`, `commercial_invoices`)

---

## 3. The 16-Column CI Costing Specification

The Commercial Invoice table calculates 16 exact financial columns per product line item:

| Col # | Field | Formula / Calculation Logic |
| :--- | :--- | :--- |
| **1** | S/N | Row sequence index (1, 2, 3...) |
| **2** | Product Description | Product name, specs, buyer reference |
| **3** | HSN Code | Tariff code loaded from Master |
| **4** | Quantity | Order quantity in primary UOM |
| **5** | Unit Price (USD) | Export sale price per unit |
| **6** | Total Amount (USD) | `Qty * Unit Price (USD)` |
| **7** | Supplier Sourcing (RMB) | Purchase cost per unit in domestic RMB (from Local Purchase) |
| **8** | Total Purchase (RMB) | `Qty * Supplier Sourcing (RMB)` |
| **9** | VAT Refund Rate (%) | China export VAT refund rate based on HSN (e.g. 13%) |
| **10** | VAT Refund Amount (RMB) | `(Total Purchase / 1.13) * (Refund Rate %)` |
| **11** | Exchange Rate | USD to RMB exchange rate |
| **12** | Gross Sourcing Cost (USD)| `Total Purchase (RMB) / Exchange Rate` |
| **13** | Net Sourcing Cost (USD) | `(Total Purchase - VAT Refund) / Exchange Rate` |
| **14** | Profit Margin (USD) | `Total Amount (USD) - Net Sourcing Cost (USD)` |
| **15** | Profit Margin (%) | `(Profit Margin (USD) / Total Amount (USD)) * 100` |
| **16** | Packaging / CBM | Total cartons and total container cubic meters |

---

## 4. 3-Level Shipment Planning Hierarchy Integration

The New/Edit Sale Process Order form (`/sale/process/new`, `/sale/process/:id/edit`) features a synchronized 3-level hierarchy matching Shipment Planning:

```
Step 1: Customer / Entity (Internal Organizations & Buyers)
         │
         ▼
Step 2: Planning Sheet / Branch (e.g. Inhyma Mumbai, Inhyma Ahmedabad, Darsh Impex Mumbai - Mulund)
         │
         ▼
Step 3: Planning Consignment Column (Filtered to ONLY columns in the chosen sheet)
```

1. **Customer / Entity Selector & Strict Lockout Gating:**
   - Unified combobox with two distinct grouped sections:
     - `🏢 INTERNAL ORGANIZATIONS`: Lists all registered master companies (e.g. Inhyma, Darsh Impex, FNB Solution, One Stop, Test Group, Yinglima).
     - `👤 BUYERS`: Lists all registered buyer entities (e.g. Om Packaging, Prathamesh Packaging, etc.).
   - Full instant search filter.
   - **Strict Lockout Rule:** Unless a Customer/Entity is chosen, both the **Planning Sheet / Branch** and **Planning Consignment Column** dropdowns remain strictly **disabled, locked, and closed** with a `🔒 Locked / Select Customer first` indicator.
   - **Complete Cascading Reset on Customer Clear/Change:** Clearing (`✕`) or changing the Customer immediately:
     - Re-locks the Planning Sheet and Consignment Column selectors.
     - Resets selected Sheet and Consignment IDs to blank.
     - **Clears all planned line items (`items = []`)** from the table so no orphaned products linger without an associated customer.
     - Resets Container Freight CBM (`totalContainerCbm = 0`) and consignment banner information.

2. **Planning Sheet / Branch Selector:**
   - Automatically filters available planning sheets to only those belonging to the selected organization or buyer.
   - For example, selecting `Inhyma` filters the sheets dropdown to `Inhyma Mumbai`, `Inhyma Ahmedabad`, `Inhyma  Indore`, `inhyma chennai`.
   - Selecting `Om Packaging` filters to `Om Packaging - Mulund`.
   - **Cascading Reset on Sheet Clear/Change:** Clearing or changing the Sheet immediately clears any active Consignment Column, resets Container CBM to 0, and wipes the table line items.

3. **Planning Consignment Column Selector & Immediate Data Loading:**
   - Displays **only** the consignment columns from the selected planning sheet (e.g., `Mum 48`, `Mum 49`, `GJ14`, etc.).
   - **Immediate Data Loading on Column Change:** Selecting or changing a consignment column immediately calls the extraction engine, wipes any previous column's products, and populates the table with the items, quantities, and CBM of the newly selected column.
   - **Clear Column Action:** Clearing the consignment column (`✕`) automatically wipes the line items and resets container CBM.

4. **Nullable Buyer ID & Organization Transfer Support:**
   - `sales_orders.buyer_id` is nullable (migration `b3c4d5e6f7a8`), enabling export sales and internal consignment transfers to internal organizations/sheets without constraint violations.

5. **Spares Catalog Isolation & Light-Orange Line Item Highlighting:**
   - **`+ Add Spare from Master` Modal:** Dynamically queries `/masters/products?is_spare=true`, filtering strictly to categories and subcategories matching "spare" (e.g., `Packaging machine Spares`, `Filteration Spares`, `UV Spare`, `Spares For Material Handling`, etc.). Machines (GF100, FR400, etc.) are strictly excluded.
   - **Line Items Table Styling (No Emoji Toggle):**
     - Removed the clickable emoji toggle button (`🚜 Machine` / `⚙️ Spare`) to prevent unintended state flips.
     - Regular machine items display in standard clean rows without buttons.
     - Spare parts are cleanly highlighted with a gentle **light-orange** background (`#fff7ed` / `#fffaf5`) and a non-clickable light-orange pill (`Spare Part`).

6. **Responsive Layout & Zero-Overflow Hardening (100% Zoom Protection):**
   - Row 1 grid tracks and combobox containers enforce min-width: 0, overflow: hidden, and single-line ellipsis text truncation.
   - The Planning Consignment Column combobox cleanly truncates long consignment names with full metadata available via hover tooltip (	itle).
   - The adjacent ⚡ Auto-Load button uses compact lex-shrink: 0 inline-flex formatting, preventing the button from ever wrapping or overflowing past the card container at 100% zoom or on compact screens.

---

## 5. Automated Notifications & Event Triggers

Whenever a new sale process order is created in the system, the Sale Process service dispatches a system event:
* **Event Hook:** `sale_process_created`
* **Trigger Payload:** `{ "order_id": order.id, "order_number": order.order_number, "buyer_name": buyer.company_name, "total_usd": order.total_amount_usd }`
* **Notification Dispatch:** Delivered to all users and roles configured under the `sale_process_created` rule in Notification Settings.
* **Direct Navigation:** Clicking the topbar notification navigates directly to `/sale/process/{order_id}`.

---

## 5. What Needs to Be Verified (Testing Checklist)

- [ ] **Costing Rule (Zero-Fallback Rule):**
  - Verify that unmatched items (items without a linked local purchase price) strictly evaluate to `$0.00 / ¥0.00` and do **NOT** silently fall back to Product Master catalog prices.
- [ ] **Formula Verification (e.g. Test 1 / Darsh Impex Sheet):**
  - Input: Qty = 196, Pkg = 98 (units/box), Box Wt = 56 kg, Carton CBM = 0.748 m³.
  - Output must calculate:
    - Pkg (Cartons) = `196 / 98 = 2.0`
    - Total Gross Wt = `2 * 56 = 112 kg`
    - Total CBM = `2 * 0.748 = 1.496 m³`
- [ ] **Excel Export Integrity:**
  - Click **Export CI Sheet**.
  - Open generated Excel file and verify formatting, column widths, summary totals, and currency signs match the on-screen table.

---

## 6. Critical Constraints: What to KEEP / What NOT to Break

> [!CAUTION]
> **Strict financial constraints that must never be altered:**

1. **Unmatched Sourcing Cost Rule:**
   - Sourcing cost is strictly populated from actual Local Purchase bills. If no match exists, display `$0.00` to prevent misleading profit margin inflation.
2. **Rounding Precision:**
   - Financial totals must round to 2 decimal places. CBM must maintain 3 to 4 decimal places.
3. **VAT Ex-Factory Formula:**
   - Export VAT refund formula must divide purchase by `(1 + VAT rate)` before applying refund percentage.

---

---

## 8. Warehouse Outward Stock Dispatch Workflow (Added 2026-10-26)

### Purpose & Architecture
To maintain a synchronized single source of truth for physical inventory, stock deductions occur directly when export sale orders reach **Dispatched** status, rather than requiring duplicate manual register entries.

### User Flow:
1. **Interactive Dispatch Button (`[📤 Outward / Dispatch Stock]`):**
   - In `/sale/process`, for orders in `admin_approved` or `sales_confirmed` status, an interactive purple button `[📤 Outward / Dispatch Stock]` is displayed in the Status column (matching the `[📦 Inward Stock]` design in Local Purchase).
   - Alternatively, selecting `📤 Outward / Dispatch Stock` from the `⋮` action menu or clicking `📤 Outward / Dispatch Stock` in the order details modal (`SaleProcessDetailModal.tsx`) initiates dispatch.
2. **Outward Confirmation Modal (`SaleProcessOutwardModal.tsx`):**
   - Opens pre-filled with movement date, warehouse location (`"Main Godown"`), container number, vehicle number, transporter name, and line items with requested quantities and unit rates.
   - User reviews logistics information and clicks **Confirm Outward & Dispatch**.
3. **Strict Stock Availability Validation:**
   - The backend (`POST /api/v1/sales/orders/{id}/dispatch`) validates available stock in the warehouse ($\sum \text{Inward} - \sum \text{Outward}$) for each SKU.
   - **Strict Blocking Rule:** If requested quantity exceeds available stock, dispatch is strictly prevented and returns `400 Bad Request`:
     $$\text{"Insufficient stock in warehouse (Available: X, Requested: Y) for 'Product Name (SKU)'. Outward dispatch blocked to prevent negative inventory."}$$
   - The frontend immediately displays this error in a red toast notification.
4. **Automated Inventory Deduction & Voucher Linking:**
   - When sufficient stock is verified, the system atomically creates an official `StockMovement` (type `outward`, `OUT-YYYY-XXXX`).
   - Deducts quantities from the warehouse live inventory ledger.
   - Transitions order status to `dispatched`.
   - The list row renders an official `● DISPATCHED` badge with a direct link to the generated outward voucher.

---

## 9. Sale Process In-Memory SWR Cache & Instant 0ms Navigation (Release 2026-10-26)

### Purpose & Architecture
To eliminate blank loading spinners and latency across `/sale/process`, `/sale/process/new`, and `/sale/process/:id/edit`, an in-memory client-side SWR (Stale-While-Revalidate) cache is implemented in [`saleProcessCache.ts`](file:///d:/Om%20work1/ERP/Yinglima_ERP/frontend/src/lib/saleProcessCache.ts).

### Key Features:
1. **0ms Instant List Paint (`SaleProcessList.tsx`):**
   - On initial load or returning from details/edit via `← BACK TO LIST`, the order list and KPI cards render instantaneously in **0ms** from memory.
   - Background revalidation refreshes fresh network data seamlessly without blanking the screen or showing jarring spinners.
2. **0ms Instant Commercial Invoice Modal (`SaleProcessDetailModal.tsx`):**
   - Clicking an order number (`SO-YLM/2026/001`) immediately paints the Commercial Invoice and trade details in **0ms** from cache.
   - Updates made to order workflow status (`sales_confirmed`, `admin_approved`, `dispatched`, etc.) are written directly to cache via `updateSaleOrderInCache()`.
3. **0ms Form Pre-Filling & Lookup Caching (`SaleProcessForm.tsx`):**
   - When editing an existing sale order, all fields (consignments, logistics, line items) populate in **0ms** from `getSaleOrderDetailCache()`.
   - Planning sheets (`/planning/sheets`) are cached in memory to eliminate network delays when creating new orders.
   - On save/patch, the updated order is pushed synchronously to `updateSaleOrderInCache()` prior to navigation, ensuring the list immediately reflects changes without stale data.

---

## 10. Filter Options Card Standardization & Reset Filters Button (Release 2026-10-27)

### Purpose & Architecture
To ensure visual and operational consistency across the entire ERP, the collapsible filter panel in [`SaleProcessList.tsx`](file:///d:/Om%20work1/ERP/Yinglima_ERP/frontend/src/pages/sales/SaleProcessList.tsx) was standardized to match the gold standard layout established in Suppliers and Buyers.

### Key Features:
1. **Standard Header Row:**
   - **Top-Left:** Funnel icon with bold title `Filter Options` and an active filter count pill (`{activeFiltersCount} active`).
   - **Top-Right:** Permanent, prominent `Reset Filters` button (`background: #f1f5f9`, border `#cbd5e1`, slate text `#475569`, bold, rounded 6px).
2. **One-Click Filter Reset:**
   - Clicking `Reset Filters` immediately clears:
     - `selectedBuyerId` (resets to "All Buyers")
     - `selectedConsignment` (clears consignment code)
     - `selectedCurrency` (resets to "All Currencies")
     - `dateFrom` and `dateTo` (clears date range)
     - `search` (clears order / consignment text search)
     - Resets pagination back to Page 1.
3. **Structured Inputs & Field Labels:**
   - All filter controls (`Buyer Company`, `Consignment Code`, `Currency`, `Date From`, `Date To`) are arranged in a responsive grid with uniform 38px heights and title-cased labels placed cleanly above each input.

---

## 11. Local Purchase Costing Resolution: Confirmed & Received / Inwarded Support with Consignment Priority (Release 2026-10-28)

### Purpose & Business Rule (Strict Option A — Local Purchase Only, Zero Fallback)
When auto-loading a consignment column (`extract_consignment_items`) or adding a product (`get_product_costing_info`) in the Sale Process module (`backend/app/sales/service.py`), the system populates `Supplier`, `Unit Price (RMB) Including VAT`, `Unit Price (RMB) Excluding VAT`, `Including Profit %`, `FOB Price (USD)`, and `CFR Price/Unit` strictly from finalized Local Purchase invoices:

1. **Valid Local Purchase Statuses (`Confirmed` + `Received / Inwarded`):**
   - Queries `LocalPurchase` records where `status IN ('Confirmed', 'Received / Inwarded', 'Inwarded', 'Completed')` and `deleted_at IS NULL`.
   - Ensures that Local Purchases that have already been inwarded into warehouse stock (`Received / Inwarded`) continue to populate costing and supplier details in Sale Process.
   - `Draft` and `Cancelled` Local Purchases are strictly excluded.
2. **Two-Tier Priority Resolution:**
   - **Priority 1 (Exact Consignment Match):** If a finalized Local Purchase exists for that product under the exact same consignment (`planning_column_id == col.id` or `consignment_code == col.name`), its supplier and unit rate are prioritized first.
   - **Priority 2 (Latest Finalized Local Purchase):** Otherwise, the most recent finalized Local Purchase (`ORDER BY invoice_date DESC, created_at DESC`) for that product is used.
3. **Strict Zero Fallback Rule:**
   - If a product has no finalized Local Purchase record, `unit_price_rmb_with_vat` remains `0.00` and `supplier_name` remains `None` (no fallback to Product Prices catalog quotes).

