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

## 7. Sale Process List Toolbar UI Alignment (Products Master Pattern)

The action toolbar on `/sale/process` is aligned with the Products Master standard:
* **Filter Toggle Button:** Compact slate square button (`#475569`, toggling to `#0061f2` when open or active) featuring the standardized filter funnel SVG icon and active filter counter badge.
* **Export Button:** Vibrant amber/orange button (`#f59e0b`, `color: #ffffff`, `fontWeight: 700`, `border: none`) matching the Products Master `Imp / Exp ▾` visual hierarchy.
* **Create Sale Process:** Blue primary action button (`#0061f2`, `color: #ffffff`).

