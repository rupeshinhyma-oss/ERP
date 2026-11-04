# Financial Report & Payment Planner Module (`MODULE_FINANCIAL_REPORT.md`)

## 1. Overview
The **Financial Report & Payment Planner** module (`/finance/report`) provides a unified financial tracking and payment planning workspace modeled after the manager's Financial Planner Excel (`Finance_Planner_-_FnB_Darsh_&_Yinglima.xlsx`) and reference Finance Planning Report UI.

- **Confirm-Only Entry Rule**: Entries from **Local Purchase** (`/purchase/local`) and **Sales Process** (`/sale/process`) automatically appear in the Financial Report module once they reach **`Confirmed`** status (excluding `Pending`, `Draft`, and `Cancelled` entries).
- **Two Main Sections**:
  1. **Local Purchase (Supplier Payments)**: Tracks outward supplier payables in RMB (`¥`) with live USD (`$`) equivalents, payment terms (`30-70`, `100% Advance`, `CAD`, etc.), expected dispatch dates, due dates, partial/full payment installments, and pending balances.
  2. **Sales Process (Export & Agent Freight Schedule)**: Tracks inward buyer export receivables in USD (`$`) with RMB (`¥`) equivalents, expected stuffing dates (auto-linked from Shipment Planning column descriptions if set), ETD/ETA dates, TT received dates, BL details & status (`Telex`, `Original Received`, `Pending`), and forwarder/agent freight bills (`Agent Name`, `Local Charge RMB`, `Freight Charge RMB`, `Total Inv Amount RMB`, `Bill Status: Paid/Pending`, `Agent Payment Date`).
- **Two Stages per Section**:
  - **`Pending`**: `Balance Amount > 0` (payment is pending or partially completed).
  - **`Cleared`**: `Balance Amount <= 0` (`100%` of the invoice/order amount has been paid/received).
  - **`All`**: Combined view of both stages.

---

## 2. Database Schema (`backend/app/finance/models.py`)
- **`finance_record_meta`**:
  - Keyed by `(source_type, source_id)` (`unique`), where `source_type` is `'local_purchase'` or `'sale_order'`.
  - Stores `payment_terms`, `expected_dispatch_date`, `due_date`, `delivery_status`, `attachment_url`, `remarks`, `tt_received_date`, `expected_stuffing_date`, `bl_details`, `bl_status`, `bill_status`, `agent_name`, `agent_local_charge`, `agent_freight_charge`, `agent_inv_amount`, and `agent_payment_date`.
- **`finance_payments`**:
  - Stores individual payment installments linked to `(source_type, source_id)`: `payment_date`, `amount`, `currency`, `payment_mode` (`RMB A/C`, `USD Transaction A/C`, `USD Capital A/C`, `TT / Wire Transfer`, etc.), `bank_charges`, `reference_no`, `attachment_url`, `remarks`, `created_by_id`, `created_by_name`, `deleted_at`.

---

## 3. API Endpoints (`backend/app/finance/routes.py`)
- `GET /api/v1/finance/report` — Returns KPI summaries (Local Purchase RMB/USD, Sales Process USD/RMB, Agent Freight RMB/USD) along with filtered Local Purchase and Sales Process financial rows.
- `POST /api/v1/finance/{source_type}/{source_id}/payments` — Records an advance, partial, or full payment installment and recalculates `paid_amount`, `balance_amount`, and stage (`pending` vs `cleared`).
- `GET /api/v1/finance/{source_type}/{source_id}/payments` — Lists all recorded payment installments for a record.
- `DELETE /api/v1/finance/payments/{payment_id}` — Soft-deletes a payment installment and recalculates the parent record's balance and stage.
- `PATCH /api/v1/finance/{source_type}/{source_id}/meta` — Updates payment terms, expected dispatch/stuffing dates, due dates, BL details/status, and forwarder/agent freight bill fields.
- `GET /api/v1/finance/export` — Exports a styled 4-sheet `.xlsx` Financial Planner workbook (`Financial Summary`, `Local Purchase (Suppliers)`, `Sales & Agent Schedule`, and `Payment Transactions`).

---

## 4. Frontend UI (`frontend/src/pages/finance/FinancialReport.tsx`)
- **Route**: `/finance/report` (Sidebar: `FINANCE -> Financial Report`).
- **Top 6 KPI Summary Cards**:
  - 3 cards for Local Purchase (`ALL`, `PAID`, `BALANCE` in `¥` + `$` Eqv.).
  - 3 cards for Sales Process (`ALL`, `RECEIVED`, `BALANCE` in `$` + `¥` Eqv.).
- **3-Dot (`⋮`) Action Menu on Every Row**:
  - `💳 Add Payment`: Modal with `[30% of Total]`, `[50% of Total]`, `[70% of Total]`, and `[100% Full Balance]` quick-fill buttons.
  - `📜 Payment History`: View all installments and delete erroneous entries.
  - `✏️ Edit Schedule / Terms / BL & Agent Bill`: Modal to edit payment terms, due date, expected dispatch/stuffing date, BL status, and forwarder freight bill amounts.
  - `👁️ View Local Purchase / View Sale Order`: Opens the source document directly.



## 7. Performance & 0ms Instant Update Architecture
- **Frontend In-Memory Cache & 0ms Optimistic Mutations (`FinancialReport.tsx`)**:
  - `cachedFinanceReport` stores the latest report in memory so navigating back to `/finance/report` paints in **0ms** while revalidating silently in the background (`fetchReport({ silent: true })`).
  - Recording a payment (`handleSavePayment`), deleting a payment (`handleDeletePayment`), or editing schedule/terms/agent details (`handleSaveMeta`) immediately updates the row (`paid_amount`, `balance_amount`, `stage`, `payments`, and schedule fields) and recalculates all 6 KPI summary cards via `recomputeFinanceReportKpis` in **0ms**, closes the modal immediately, and syncs silently in the background without blanking the table.
- **Backend Query & Roundtrip Optimization (`backend/app/finance/service.py`)**:
  - Uses single-query `joinedload(LocalPurchase.items)` and `joinedload(SaleOrder.items)` with `.unique()` to eliminate secondary `SELECT ... IN` roundtrips.
  - Caches the USD-to-RMB exchange rate in memory (`_CACHED_USD_TO_RMB`, 60s TTL).
  - Eliminates redundant `_verify_source_exists` and `session.refresh(...)` roundtrips in `add_payment` and `update_meta`.

---

## 8. Consignment Overview Module (`/finance/consignment-overview`)
- **Unified Consignment Workspace**: Combines **Finance Planning**, **Consignment Gallery (Editable Export Documents)**, **Cargo Status (Editable Shipment Checklist)**, and **Product Summary** into a single unified module under the **FINANCE** sidebar section (`FINANCE -> Consignment Overview`).
- **Grouping & Inclusion Rule**:
  - Automatically groups all Confirmed/Inwarded **Local Purchases** (`Confirmed`, `Inwarded`) and Confirmed/Dispatched/LR **Sales Process Orders** (`Confirmed`, `Dispatched`, `LR`) by normalized `consignment_code` (e.g. `Mum 51`, `Mum 48`, `GJ15`, `Mum 1`) or standalone order/invoice key.
- **Database Table (`consignment_overviews` in `backend/app/finance/models.py`)**:
  - Keyed by `consignment_key` (`unique`), storing `documents_json` (Supabase Storage URLs per slot), `checklist_json` (`Yes`/`No` boolean state per checklist item), `cargo_remarks`, `etd_origin_date`, `eta_port_date`, and `forwarder_name`.
- **Detail View Sections (`frontend/src/pages/finance/ConsignmentOverview.tsx`)**:
  1. **Top Shipment Summary Bar**: Displays `Invoice / Cons. No. & Date`, `Supplier Name(s)`, `Buyer / Destination Branch`, `Ordered Date`, and inline-editable `ETD Origin (China)`, `ETA Destination Port`, and `Forwarder / Agent Name`.
  2. **Finance Planning Table**: Lists all linked `Supplier` (Local Purchase in RMB `¥`), `Customer` (Sale Order in USD `$`), and `Cargo Forwarder` (Agent Freight in RMB `¥`) lines with payment terms, attached bill download links, total/paid/balance amounts, due dates, and `Cleared` / `Pending` status badges.
  3. **Consignment Gallery (16 China/Global Export Document Slots)**:
     - Slots: `Proforma Invoice (PI)`, `Sales Contract`, `Swift T.T 1 - Advance`, `Swift T.T 2 - Balance`, `Supplier Tax Invoice (Fapiao / Bill)` (auto-linked from Local Purchase bill if uploaded), `Draft Approved Bill of Lading`, `Final Bill of Lading (BL)`, `Commercial Invoice (CI)`, `Packing List (PL)`, `Certificate of Origin (COO)`, `Marine Insurance Policy`, `China Export Customs Declaration / Shipping Bill`, `Inspection / Quality Certificate (COC / COA)`, `MSDS / Technical Datasheet`, `Forwarder / Agent Freight Invoice`, and `Final Landing Cost Sheet`.
     - Each card supports 1-click file upload (`POST /api/v1/finance/consignment-overview/documents`) directly to Supabase Storage (`purchase-bills` bucket), cloud view/download (`☁⬇`), and file removal (`DELETE /api/v1/finance/consignment-overview/documents`).
  4. **Cargo Status — Shipment Checklist Details (12 Editable Yes/No Toggles)**:
     - Items: `Supplier Invoices / Fapiao Collected`, `Listed with Forwarder / Booking Confirmed`, `Container Stuffing & Loading Completed`, `China Export Customs Declaration Cleared`, `Draft Approved BL Received`, `Insurance Mail Sent`, `Insurance Certificate Received`, `Final BL Received`, `Certificate of Origin (COO) Received`, `Telex Release Done`, `All Export Docs (CI/PL/COO/BL) Checked`, and `All Docs Shared to Buyer / Clearing Agent`, plus editable `Cargo Remark`.
     - Clicking any checklist card toggles `Yes` (green) / `No` (red) in **0ms** and persists via `PATCH /api/v1/finance/consignment-overview/checklist`.
  5. **Product Summary Table**: Lists all products, supplier/source document numbers, quantities, UOM, and batch/consignment numbers for the consignment.

