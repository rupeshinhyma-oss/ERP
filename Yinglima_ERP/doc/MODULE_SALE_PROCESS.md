# Module Guide: Sales Process & Commercial Invoice Engine (`sales_process`)

**System:** Yinglima_ERP  
**Module:** Sales Process Orders, 16-Column CI Costing Engine & Exports (`/sale/process`)  
**Status:** Active / Production Ready  
**Last Updated:** 2026-10-12  

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

## 4. What Needs to Be Verified (Testing Checklist)

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

## 5. Critical Constraints: What to KEEP / What NOT to Break

> [!CAUTION]
> **Strict financial constraints that must never be altered:**

1. **Unmatched Sourcing Cost Rule:**
   - Sourcing cost is strictly populated from actual Local Purchase bills. If no match exists, display `$0.00` to prevent misleading profit margin inflation.
2. **Rounding Precision:**
   - Financial totals must round to 2 decimal places. CBM must maintain 3 to 4 decimal places.
3. **VAT Ex-Factory Formula:**
   - Export VAT refund formula must divide purchase by `(1 + VAT rate)` before applying refund percentage.
