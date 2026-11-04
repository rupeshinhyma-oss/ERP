# Module Documentation: VAT Return (China Export Tax Rebate / 出口退税)

## 1. Overview & Purpose
The **VAT Return (`/finance/vat-return`)** module under the **`FINANCE`** sidebar section manages Yinglima China's **Export VAT Tax Rebates (出口退税)** across all confirmed commercial export shipments (`EXP` invoices).

It unifies two tightly linked views modeled directly on the manager's `RETURNED VAT LIST Yinglima` workbook:
1. **Table 1 — Export VAT Return Summary Ledger**: Tracks every confirmed `EXP` shipment (`EXP2023 - 01` through `EXP2026 - 97+`), Invoice Date, Financial Year (`FY 2023-2024`, `FY 2024-2025`, `FY 2025-2026`, `FY 2026-2027`), Total RMB Inclusive of VAT, Total VAT Return Amount (`¥`), VAT Amount Received (`¥`), Balance VAT to be Received (`¥`), Status (`RECEIVED`, `PARTIAL RECEIVED`, `PENDING`, `NO VAT`), VAT Receiving Date(s), Partial Amount Received, 1st Tax Bureau Filing Date, and Remarks.
2. **Table 2 — Per-Shipment Product & Supplier VAT Breakdown**: Clicking any `EXP No.` opens the item-level breakdown modal (`YL-EXP...`) showing Contract Date, Contract / Fapiao No., Supplier, Product, Quantity, RMB Price with VAT, Total RMB Inclusive VAT, USD Price, Rebate Rate (`13%`, `9%`, `6%`, `0% No VAT`), and computed **VAT To Be Returned (`¥`)**.

---

## 2. Live Sales Process Integration & Formula Engine

### 2.1 Automatic Sync from Confirmed Sales Process Orders
- Every **Confirmed / Dispatched / LR** order in **Sales Process** (`sales_orders` + `sales_order_items`, excluding `pending`, `draft`, and `cancelled`) automatically appears in the VAT Return ledger.
- Each line item inherits:
  - `quantity`, `unit_price_rmb_with_vat`, `total_supplier_amount_rmb`, and `cfr_price_usd` / `fob_price_usd` from `SaleOrderItem`.
  - Default `purchase_vat_percent` (standard `13%`) and `refund_vat_percent` (`13%`, `9%`, or `0%`) from `Product` Master or `HsnCode` Master.
  - Supplier `contract_no` (`invoice_no`) and `contract_date` (`invoice_date`) auto-matched from confirmed **Local Purchase** records for the same `(consignment_code, supplier_name)` or supplier.

### 2.2 Exact China Export VAT Rebate Formula
For each product line in a shipment:
$$\text{Total RMB Inclusive of VAT} = \text{Quantity} \times \text{RMB Unit Price With VAT}$$
$$\text{VAT To Be Returned (¥)} = \frac{\text{Total RMB Inclusive of VAT}}{1 + (\text{Purchase VAT \%} / 100)} \times \left(\frac{\text{Refund VAT \%}}{100}\right)$$
- **Standard 13% Rebate**: $\frac{\text{Total RMB}}{1.13} \times 0.13$
- **9% Rebate Category**: $\frac{\text{Total RMB}}{1.13} \times 0.09$
- **No VAT / 0% Rebate**: `¥ 0.00` (when purchased without Fapiao or `0%` export rebate rate)

The shipment's **Total VAT Return Amount (`¥`)** is the sum of all its breakdown items' `vat_to_be_returned` (or a manual override if adjusted by the China Tax Bureau).

### 2.3 Automatic Status & Balance Calculation
- $\text{Balance VAT (¥)} = \max(0, \text{Total VAT Return} - \text{VAT Amount Received})$
- **Status**:
  - `NO VAT`: When `Total VAT Return == 0` or explicitly set to `NO VAT`.
  - `RECEIVED` (Green): When `Balance VAT <= 0.50` and `Total VAT Return > 0`.
  - `PARTIAL RECEIVED` (Amber): When `0 < VAT Received < Total VAT Return`.
  - `PENDING` (Red): When `VAT Received == 0` and `Total VAT Return > 0`.

---

## 3. Database Schema (`backend/app/finance/models.py`)

### 3.1 `vat_return_records` (`VatReturnRecord`)
Stores per-shipment overrides for live `SaleOrder` records (`source_type='sale_order'`) as well as imported or manually created historical `EXP` shipments (`source_type='manual'`).
- `id` (`UUID`, PK)
- `source_type` (`VARCHAR(32)`: `'sale_order'` | `'manual'`)
- `source_id` (`UUID`)
- `exp_no` (`VARCHAR(120)`, unique, indexed)
- `invoice_date` (`DATE`, nullable)
- `financial_year` (`VARCHAR(32)`, e.g. `'2025-2026'`)
- `consignment_code` (`VARCHAR(120)`, nullable)
- `buyer_name` (`VARCHAR(200)`, nullable)
- `organization_name` (`VARCHAR(150)`, nullable)
- `first_filing_date` (`DATE`, nullable)
- `receiving_date_text` (`VARCHAR(150)`, nullable)
- `status_override` (`VARCHAR(40)`, nullable)
- `total_rmb_incl_vat_override` (`NUMERIC(15, 2)`, nullable)
- `total_vat_return_override` (`NUMERIC(15, 2)`, nullable)
- `remarks` (`TEXT`, nullable)
- `items_override_json` (`TEXT`, JSON array of `VatReturnBreakdownItem` objects)
- `updated_by_id`, `updated_by_name`, `created_at`, `updated_at`, `deleted_at`

### 3.2 `vat_return_receipts` (`VatReturnReceipt`)
Stores individual full or partial VAT refund receipts from the China Tax Bureau.
- `id` (`UUID`, PK)
- `vat_record_id` (`UUID`, indexed)
- `exp_no` (`VARCHAR(120)`, indexed)
- `receipt_date` (`DATE`, indexed)
- `amount_rmb` (`NUMERIC(15, 2)`)
- `reference_no` (`VARCHAR(150)`, nullable)
- `remarks` (`TEXT`, nullable)
- `created_by_id`, `created_by_name`, `created_at`, `updated_at`, `deleted_at`

---

## 4. Backend API Endpoints (`backend/app/finance/routes.py`)
All endpoints are mounted under `/api/v1/finance/vat-returns`:
- `GET /api/v1/finance/vat-returns`: Lists all VAT Return rows + KPI summary (`total_vat_return_rmb`, `received_vat_rmb`, `partial_received_vat_rmb`, `balance_vat_rmb`, USD equivalents, stage counts, and `available_financial_years`).
- `POST /api/v1/finance/vat-returns/manual`: Creates a standalone `EXP` entry.
- `PATCH /api/v1/finance/vat-returns/record?key={record_key}`: Updates filing date, status override, total override, remarks, or saves edited `breakdown_items`.
- `POST /api/v1/finance/vat-returns/receipts?key={record_key}`: Records a full or partial VAT refund receipt in RMB (`¥`).
- `DELETE /api/v1/finance/vat-returns/receipts/{receipt_id}`: Soft-deletes a VAT receipt and recalculates the shipment's balance and status.
- `GET /api/v1/finance/vat-returns/sample-csv`: Downloads a sample CSV template (`vat_return_sample.csv`).
- `POST /api/v1/finance/vat-returns/import`: Imports `.xlsx` or `.csv` files (supports both the manager's multi-section `RETURNED VAT LIST Yinglima` workbook with Table 1 + Table 2 side-by-side and standard summary sheets), upserting by normalized `EXP No.` with zero duplicate rows.
- `GET /api/v1/finance/vat-returns/export`: Exports a styled 2-sheet Excel workbook (`Sheet 1: VAT Return Summary`, `Sheet 2: Product VAT Breakdown`).

---

## 5. Frontend UI (`frontend/src/pages/finance/VatReturn.tsx`)
- **4 Interactive KPI Cards**:
  1. `TOTAL VAT RETURN — ALL` (`stage='all'`)
  2. `VAT AMOUNT RECEIVED` (`stage='received'`)
  3. `PARTIAL VAT RECEIVED` (`stage='partial'`)
  4. `BALANCE VAT TO BE RECEIVED` (`stage='pending'`)
  - Clicking any KPI card switches `activeStage` and moves the active blue border (`1.5px solid #3b82f6`) to that card.
- **Financial Year Pill Selector**: Instant client-side filtering across `All Years`, `FY 2026-2027`, `FY 2025-2026`, `FY 2024-2025`, and `FY 2023-2024`.
- **`Imp / Exp ▾` Dropdown**: Provides `Sample File (.csv)`, `Import Excel / CSV`, and `Export 2-Sheet Excel (.xlsx)`.
- **Clickable `EXP No.` Breakdown Modal**: Opens Table 2 where users can inspect or inline-edit Contract Date, Contract No., Supplier, Product, Quantity, RMB Price with VAT, USD Price, Rebate % (`13%`, `9%`, `6%`, `0%`), and Remarks with live formula recalculation.

