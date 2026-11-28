# Inhyma_ERP — API Design & Endpoints Specification

**Service Base URL:** `http://localhost:8002/api/v1`  
**Authentication Scheme:** Bearer JWT (HS256) & WebSocket Query Tokens  
**Standard Response Envelope:** `{ "success": true, "data": ..., "meta": ..., "error": null }`  
**Last Updated:** November 27, 2026

> **Universal Cross-Module Active-Only Extraction & Filtering Convention:**
> - **Management Lists vs Cross-Module Lookups:** Unfiltered management endpoints (`GET /api/v1/masters/*`, `/companies`, `/suppliers`, `/buyers`, `/users`, `/positions`, and `/hrms/setup/*` with default `active_only=false`) return **both** `Active` and `Inactive` rows so each module's own `Active` / `Inactive` tabs and status toggles remain functional. Conversely, every cross-module picker/lookup endpoint (`/api/v1/masters/*/lookup`, `/api/v1/masters/*/dropdown`, `/companies/lookup`, `/companies/sales-persons`, `/users/all?active_only=true`, `/positions/all?active_only=true`, `/inquiries/consignment-codes`, `/inquiries/companies`, `/hrms/setup/*?active_only=true`, `/products/machine-spares/universal-view`, and `/search`) returns **`Active` records only**.
> - **Bidirectional Filter Translation (`BaseRepository._apply_dynamic_filters`):** All paginated endpoints backed by `BaseRepository` inspect real SQLAlchemy columns (`self.model.__table__.columns`) and bidirectionally translate `?status=active|inactive` and `?is_active=true|false` across both `RecordStatus` tables (`products`, `banks`, `warehouses`, all 28 masters) and boolean `is_active` tables (`companies`, `suppliers`, `buyers`).
> - **Historical Reference & Cancellation Reversal Safety:** Single-record reads (`GET /api/v1/.../{id}`) continue resolving inactive historical references (`200 OK`), and order cancellation (`_release_stock`) invokes `StockService.find_product(..., require_active=False)` / `get_warehouse(..., require_active=False)` so stock reversals succeed even if a SKU or warehouse was deactivated later.

---

## 1. Companies & B2B Directory (`/companies`)

| Method | Endpoint URI | Description | Permission Gate |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/companies` | List paginated companies with grade, potential, status (`?status=active\|inactive` / `?is_active=true\|false`), and search filters | `company.view \| company.manage` |
| `GET` | `/api/v1/companies/lookup` | Lightweight active-only company autocomplete lookup (`active_only=true` default) for commercial & service forms | `company.{view,create,quick_add,update,manage} \| supplier.{view,create} \| crm.leads.{view,manage}` |
| `GET` | `/api/v1/companies/sales-persons` | List active salespersons (`User.status == ACTIVE`) returning `{ id, display_name, full_name, username }` with `display_name`-first resolution for Proforma, Sales Process, and Company filters | `company.{view,create,quick_add,update,manage} \| supplier.{view,create} \| crm.leads.{view,create,manage}` |
| `POST` | `/api/v1/companies` | Create company account with extended intelligence fields & contacts (`+ QUICK ADD` / `+ ADD NEW`) | `company.create \| company.quick_add \| company.manage` |
| `GET` | `/api/v1/companies/{id}` | Inspect detailed profile (extended fields, social media matrix, Direct Import from China cluster) | `company.view \| company.update \| company.manage` |
| `PATCH` | `/api/v1/companies/{id}` | Update company details, credit terms, turnover, import volume, and intelligence | `company.update \| company.manage` |
| `DELETE`| `/api/v1/companies/{id}` | Soft-delete company record and linked contacts | `company.delete \| company.manage` |
| `PATCH` | `/api/v1/companies/{id}/grade` | Inline update corporate grade (A, B, C) | `company.grade_edit \| company.manage` |
| `PATCH` | `/api/v1/companies/{id}/potential` | Inline update revenue potential rating (Yes / No; requires `potential_reason` if No, allows `potential_business_per_month` if Yes) | `company.potential_edit \| company.manage` |
| `POST` | `/api/v1/companies/{id}/activate` & `/deactivate` | Activate / deactivate company status (single or Bulk Actions) | `company.update \| company.bulk_action \| company.manage` |
| `POST` | `/api/v1/companies/{id}/contacts` | Add sub-contact person with birth_date & anniversary_date | `company.update \| company.manage` |
| `POST` | `/api/v1/companies/import` | Bulk Excel/CSV import wizard | `company.import \| company.manage` |
| `GET` | `/api/v1/companies/export` | Export company records to Excel/CSV | `company.export \| company.manage` |

> **Company Spec Extensions:**
> - `monthly_turnover`: Monthly sales band (active when Business Type is selected).
> - `potential_reason`: Mandatory text reason when `potential == "no"`.
> - `potential_business_per_month`: Projected business volume (active when `potential == "yes"`).
> - `direct_import_from_china`: "Yes" / "No" (restricted to `company_type == "B2B"`).
> - `monthly_import_volume` & `products_needed_for_imports`: Active only when `direct_import_from_china == "Yes"`.
> - Sub-contacts include `birth_date` and `anniversary_date` with automated client-side age computation.


---

## 2. Geography Masters & Cascading Lookups (`/masters`)

| Method | Endpoint URI | Description | Permission Gate |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/masters/{master}/lookup` | Lightweight active-only (`RecordStatus.ACTIVE`) lookup list across all 28 master catalogs (`products`, `categories`, `sub-categories`, `brands`, `uom`, `taxes`, `banks`, `warehouses`, `transports`, `payment-terms`, `countries`, etc.) | Authenticated |
| `GET` | `/api/v1/masters/{master}/dropdown` | Active-only (`RecordStatus.ACTIVE`) `{ id, label }` dropdown projection across master catalogs | Authenticated |
| `GET` | `/api/v1/masters/states/lookup` | List active states/provinces (`RecordStatus.ACTIVE`, optional `country_id` filter) | Authenticated |
| `GET` | `/api/v1/masters/districts/lookup` | List active districts (`RecordStatus.ACTIVE`) filtered by `state_id` query param | Authenticated |
| `GET` | `/api/v1/masters/cities/lookup` | List active cities (`RecordStatus.ACTIVE`) filtered by `district_id` and `state_id` query params | Authenticated |
| `GET` | `/api/v1/rbac/technicians/lookup` | List active Users belonging to the fixed `Technician` `SYSTEM` department (`UserStatus.ACTIVE` & `is_active=True`) for Technical Tasks approval/allotment & filter dropdowns | Authenticated |
| `GET` | `/api/v1/masters/call-types/lookup` | List active technical service call types (`RecordStatus.ACTIVE`) for Technical Tasks creation & filter dropdowns | Authenticated |
| `POST` | `/api/v1/masters/cities` | Create new city with `state_id` and `district_id` references | `city.create` |

---

## 3. Inventory, Product Stock, Re-Order & Stock Transactions (`/inventory`)

| Method | Endpoint URI | Description | Permission Gate |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/inventory/product-stock` | Master-joined 9-warehouse Product Stock & Stock Transactions list restricted strictly to `Active` products (`Product.status == RecordStatus.ACTIVE`; `limit` up to `5000`, `category`, `sub_category`, `brand`, `warehouse`, `negative_stock`, `low_stock`, `machine_id`, `search`; returns active-only `filter_options` & `breakup_flags`) | `product_stock.{view,manage} \| stock_adjustment.{create,manage} \| stock_transfer.{create,manage} \| product.view \| report.view \| proforma.{view,create,update} \| saleorder.{view,create,update}` |
| `GET` | `/api/v1/inventory/product-stock/{id}` | Inspect single product's multi-warehouse stock record (resolves either `ProductStock.id` or `Product.id` with zero-stock fallback) | `product_stock.{view,manage} \| stock_adjustment.{create,manage} \| stock_transfer.{create,manage} \| product.view \| report.view \| proforma.{view,create,update} \| saleorder.{view,create,update}` |
| `GET` | `/api/v1/inventory/product-stock/breakup` | Inspect warehouse cell breakup (`physical` adjustments/transfers, or `transit` / `ordered` expected consignments + FIFO `booked_orders` queue) | `product_stock.{view,manage} \| product.view \| report.view` |
| `GET` | `/api/v1/inventory/stock-transactions/{product_ref}` | Chronological 5-source Per-Product Stock Transaction Ledger (`Sale`, `Stock IN`, `Stock OUT`, `Local Purchase`, `Import Purchase`, `Transfer IN`, `Transfer OUT`) with `available_qty`, `warehouse`, `tx_type`, `date_from`, `date_to`, and `search` filters. Aliased at `/api/v1/stock-transaction/list/{product_ref}`, `/api/v1/stock_transaction/list/{product_ref}`, and `/api/v1/inventory/product-stock/{product_ref}/transactions` | `product_stock.{view,manage} \| product.view \| report.view` |
| `GET` | `/api/v1/inventory/product-reorder` | 16-column branch-scoped Product Re-Order matrix for `Active` products (`Product.status == RecordStatus.ACTIVE`, `warehouse=Mumbai\|Ahmedabad\|Indore\|All`, `category`, `sub_category`, `brand`, `shortfall`, `reorder`, `search`) | `product.view` |
| `PATCH` | `/api/v1/inventory/product-reorder/{product_id}` | Inline update `reorder_level` (`Re-Order`) and/or `minimum_order_quantity` (`MOQ`) on `Product` master | `product.update` |
| `GET` | `/api/v1/inventory/goods-expected-report` | Expected incoming consignments report across Import Purchases and Shipment Planning | `product.view` |
| `GET` | `/api/v1/inventory/stock-adjustment` | Paginated stock adjustment vouchers with type/date filters (aliased at `/api/v1/adjustment/list`) | `stock_adjustment.view \| stock_adjustment.manage` |
| `GET` | `/api/v1/inventory/stock-adjustment/{id}` | Detailed voucher with multi-product line items (aliased at `/api/v1/adjustment/{id}`) | `stock_adjustment.view \| stock_adjustment.download \| stock_adjustment.manage` |
| `POST` | `/api/v1/inventory/stock-adjustment` | Create adjustment voucher and update warehouse balances (enforces active Warehouse & active Product validation; aliased at `/api/v1/adjustment`) | `stock_adjustment.create \| stock_adjustment.manage` |
| `DELETE`| `/api/v1/inventory/stock-adjustment/{id}`| Soft-delete voucher and reverse inventory adjustments (aliased at `/api/v1/adjustment/{id}`) | `stock_adjustment.delete \| stock_adjustment.manage` |
| `GET` | `/api/v1/adjustment/adjustment-order-pdf/{id}` | Stream A4 adjustment order PDF document | `stock_adjustment.download \| stock_adjustment.manage` |
| `GET` | `/api/v1/inventory/stock-transfer` | Paginated inter-warehouse stock transfer orders with per-stage view filtering and tab counts (aliased at `/api/v1/transfer/list`) | `stock_transfer.{view,pending.view,confirmed.view,received.view,cancel.view,download,manage}` |
| `GET` | `/api/v1/inventory/stock-transfer/{id}` | Inspect single stock transfer order and line items | `stock_transfer.{view,<stage>.view,download,manage}` |
| `POST` | `/api/v1/inventory/stock-transfer` | Create atomic inter-warehouse stock transfer (`from_warehouse` -> `to_warehouse`; enforces active source/destination Warehouses & active Products) | `stock_transfer.create \| stock_transfer.manage` |
| `PATCH` | `/api/v1/inventory/stock-transfer/{id}/status` | Transition transfer status (`Pending`, `Confirmed`, `Received`, `Cancel`) with Downstream Sales & stage RBAC checks | `stock_transfer.{pending,confirmed,received,cancel,manage}` (per target stage) |
| `POST` | `/api/v1/inventory/stock-transfer/{id}/receive-to-main` | Receive in-transit stock transfer into physical destination main warehouse | `stock_transfer.received \| stock_transfer.manage` |

---

## 4. Technical Tasks & Field Service Dispatch (`/technical-tasks`, `/payments`)

| Method | Endpoint URI | Description | Permission Gate |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/technical-tasks` | List paginated service tickets with status tab (`all`, `Pending`, `Approved`, `Completed`, `Cancel`; legacy `Payment Pending` rows normalized into `Completed`), `task_type`, `service_type`, `call_type`, `priority`, `city`, `third_party_city`, `task_allotted_to`, date range, and payment stage (`payment_collected=all\|pending\|completed`, strictly excluding cancelled tasks in `/payments` mode) | `technicaltask.{view,pending.view,approved.view,completed.view,cancel.view,manage} \| payment.{view,pending.view,completed.view,manage}` |
| `GET` | `/api/v1/technical-tasks/counts` | Status tab badge counts (`all`, `pending`, `approved`, `completed`, `cancel`) | `technicaltask.view \| technicaltask.manage` |
| `GET` | `/api/v1/technical-tasks/payment-summary` | Real-time financial KPIs (`total_payment`, `paid`, `due`, `all_count`, `pending_count`, `completed_count`) across active (non-cancelled) `Chargeable` tasks using NULL-safe `coalesce` SQL predicates | `payment.view \| payment.manage \| technicaltask.view \| technicaltask.manage` |
| `GET` | `/api/v1/technical-tasks/call-log-report` | Paginated cross-ticket technician call/visit log analytics report | `technicaltask.view \| technicaltask.manage \| report.view` |
| `GET` | `/api/v1/technical-tasks/monthly-summary` | Monthly technician service call & resolution summary metrics | `technicaltask.view \| technicaltask.manage \| report.view` |
| `GET` | `/api/v1/technical-tasks/lookup/serial/{serial_number}` | Lookup machine model, warranty status, customer details, and historical ticket count by machine serial number | `technicaltask.view \| technicaltask.create \| technicaltask.manage` |
| `POST` | `/api/v1/technical-tasks` | Create field service ticket with sequential `task_number` and initial `Create Technical Task` audit log (Payments-only callers restricted to `Chargeable`) | `technicaltask.create \| technicaltask.manage \| payment.create \| payment.manage` |
| `GET` | `/api/v1/technical-tasks/{id}` | Inspect detailed service ticket (accepts either UUID `id` or sequential integer `task_number`) | `technicaltask.{view,call_logs.view,manage} \| payment.{view,details.view,manage}` |
| `GET` | `/api/v1/technical-tasks/{id}/call-logs` | List chronological technician `Telecall` / `Physical Visit` call logs (resolves UUID or `task_number`) | `technicaltask.{view,call_logs.view,manage} \| payment.{view,details.view,manage}` |
| `POST` | `/api/v1/technical-tasks/{id}/call-logs` | Append technician call log (`task_type`: `Telecall` or `Physical Visit`, `remarks`) (resolves UUID or `task_number`) | `technicaltask.update \| technicaltask.create \| technicaltask.manage` |
| `GET` | `/api/v1/technical-tasks/{id}/task-logs` | List immutable lifecycle task logs (`Create Technical Task`, `Approve Technical Task`, `Complete Technical Task`, `Cancel Technical Task`, `Reopen Technical Task`, `Record Task Payment`, `Update Technical Task`) | `technicaltask.{view,call_logs.view,manage} \| payment.{view,details.view,manage}` |
| `PATCH` | `/api/v1/technical-tasks/{id}` | Update machine details, problem notes, contact person, payment fields, or scheduled visit | `technicaltask.update \| technicaltask.manage` |
| `PATCH` | `/api/v1/technical-tasks/{id}/status` | Transition ticket status (`Approved` enforces mandatory `task_allotted_to` & `technicaltask.approve`; `Completed` enforces `technicaltask.complete`; `Cancel` enforces mandatory `cancel_remarks`, `technicaltask.cancel` & reverses any `Self collect` wallet entry) | `technicaltask.{approve,complete,cancel,update,manage}` |
| `POST` | `/api/v1/technical-tasks/{id}/reopen` | Reopen/reassign cancelled or completed ticket back to `Approved` with technician allotment | `technicaltask.reopen \| technicaltask.approve \| technicaltask.update \| technicaltask.manage` |
| `POST` | `/api/v1/technical-tasks/{id}/record-payment` | Atomically record collected payment (`amount_collected`, `payment_mode`, `payment_screenshot`, `payment_reference`, `payment_date`, `remarks`), normalize any legacy `Payment Pending` status to `Completed`, update `payment_status` (`Paid` / `Pending`), and auto-sync `Self collect` into `technician_wallet_transactions` (`VERIFIED` `COLLECTION`) | `payment.update \| payment.manage \| technicaltask.update \| technicaltask.manage` |
| `POST` | `/api/v1/technical-tasks/upload-screenshot` | Upload payment screenshot / receipt image (`.jpg`, `.png`, `.webp`) or `.pdf` | `technicaltask.{create,update,manage} \| payment.{create,update,manage} \| technician_operations.{wallet.*,warranty.create,manage}` |
| `POST` | `/api/v1/technical-tasks/bulk-delete` | Bulk soft-delete technical tasks by array of IDs and reverse linked `Self collect` technician wallet entries | `technicaltask.bulk_action \| technicaltask.delete \| technicaltask.manage \| payment.delete \| payment.manage` |
| `DELETE`| `/api/v1/technical-tasks/{id}` | Soft-delete technical service task and reverse any linked `Self collect` technician wallet entries | `technicaltask.delete \| technicaltask.manage \| payment.delete \| payment.manage` |

---

## 5. Spoke Governance & Internal Identity Provisioning (`/internal/users`)

Machine-to-machine internal service endpoints invoked by `ERP_Main` over authenticated HTTP channels (Bearer Token with `X-ERP-Key` / HMAC token validation).

| Method | Endpoint URI | Description | Auth Required |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/v1/internal/users/check` | Inspect whether a user already exists locally by email or username | Internal Service Bearer |
| `POST` | `/api/v1/internal/users/provision` | Provision minimal local account or reactivate/re-sync existing local account (including idempotent `display_name` & optional password sync from `ERP_Main`) | Internal Service Bearer |
| `POST` | `/api/v1/internal/users/{id}/access` | Block (`allow_login: false`) or restore (`allow_login: true`) local authentication | Internal Service Bearer |
| `POST` | `/api/v1/internal/users/{id}/deprovision` | Soft-delete user and revoke all active sessions upon ERP_Main deprovisioning | Internal Service Bearer |
| `DELETE`| `/api/v1/internal/users/{id}` | Idempotent alias for user deprovisioning | Internal Service Bearer |
| `POST` | `/api/v1/internal/users/{id}/logout` | Force logout local user and broadcast WebSocket `FORCE_LOGOUT` upon ecosystem logout | Internal Service Bearer |

---

## 6. Leads & Inquiries Management (`/leads`)

| Method | Endpoint URI | Description | Permission Gate |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/leads/` | List paginated leads with search, source, priority, and business type filters | Authenticated |
| `GET` | `/api/v1/leads/list` | List leads (alias route matching UI path) | Authenticated |
| `POST` | `/api/v1/leads/` | Create a new lead inquiry with company and contact information | Authenticated |
| `GET` | `/api/v1/leads/{id}` | Inspect detailed lead profile and requirement notes | Authenticated |
| `PUT` | `/api/v1/leads/{id}` | Update lead details, stage, status, or assignment | Authenticated |
| `DELETE`| `/api/v1/leads/{id}` | Soft-delete a lead record (`is_deleted = True`) | Authenticated |
| `POST` | `/api/v1/leads/bulk-delete` | Bulk soft-delete selected leads by array of IDs | Authenticated |

---

## 7. Purchase — Local Purchase Orders (`/purchase/local-orders`)

| Method | Endpoint URI | Description | Permission Gate |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/purchase/local-orders` | List local purchases with status counts (`all`, `pending`, `confirmed`), search, warehouse, and date filters | `localpurchase.view \| localpurchase.manage` |
| `POST` | `/api/v1/purchase/local-orders` | Create local purchase with active Supplier, active physical Warehouse, and active Product lines; server auto-calculates expense loading & landing rates | `localpurchase.create \| localpurchase.manage` |
| `POST` | `/api/v1/purchase/local-orders/import` | Bulk import multi-line local purchase invoices from `.csv` / `.xlsx` (`file` + optional `column_map` JSON), validating **active** Supplier/Warehouse/Product masters, calculating Expense Factor & Unit Landing Rate (INR) (VB), skipping duplicate Invoice Nos, and isolating row errors via nested DB savepoints | `localpurchase.import \| localpurchase.manage` |
| `GET` | `/api/v1/purchase/local-orders/{id}` | Inspect detailed local purchase record and items | `localpurchase.{view,update,download,manage}` |
| `PUT` | `/api/v1/purchase/local-orders/{id}` | Update pending local purchase lines or invoice expenses | `localpurchase.update \| localpurchase.manage` |
| `PATCH` | `/api/v1/purchase/local-orders/{id}/status` | Transition purchase status (`pending` -> `confirmed`); auto-applies physical stock-in movement | `localpurchase.confirm \| localpurchase.manage` |
| `DELETE`| `/api/v1/purchase/local-orders/{id}` | Soft-delete local purchase order (`pending` stage for `localpurchase.delete`; confirmed orders restricted to `localpurchase.manage` / Admin) | `localpurchase.delete \| localpurchase.manage` |
| `POST` | `/api/v1/purchase/local-orders/{id}/bill` | Upload scanned invoice bill document | `localpurchase.{update,create,manage}` |
| `DELETE`| `/api/v1/purchase/local-orders/{id}/bill` | Delete uploaded invoice bill attachment | `localpurchase.update \| localpurchase.manage` |
| `GET` | `/api/v1/purchase/local-orders/{id}/bill-file` | Stream or view attached bill file | `localpurchase.download \| localpurchase.manage` |

---

## 8. Purchase — Import Purchase Consignments (`/purchase/import-orders`)

| Method | Endpoint URI | Description | Permission Gate |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/purchase/import-orders` | List import consignments with status counts (`all`, `pending`, `confirmed`, `received`, `closed`) and 3-way date ranges | Authenticated |
| `POST` | `/api/v1/purchase/import-orders` | Create import consignment with active Supplier/Warehouse/Products, exchange rates, duty %, shipping, and dual VB/CB landing calculations; defaults `expected_arrival_date` to **`eta_port_date + 5 days`** when `eta_port_date` is provided and `expected_arrival_date` is omitted while honoring any explicit custom `expected_arrival_date` | Authenticated |
| `POST` | `/api/v1/purchase/import-orders/import` | Bulk import multi-line import consignments from `.csv` / `.xlsx` (`file` + optional `column_map` JSON), validating **active** Supplier/Warehouse/Product masters, defaulting omitted `Expected Arrival Date` to `ETA Port Date + 5 days` (while preserving explicit custom dates), calculating dual VB/CB landing costs, applying workflow `stock_in_on_create` rules, skipping duplicate Consignment Nos, and isolating row errors via nested DB savepoints | Authenticated |
| `POST` | `/api/v1/purchase/import-orders/preview` | Live preview calculation of CBM, duty, and landing expenses while typing in form | Authenticated |
| `GET` | `/api/v1/purchase/import-orders/{id}` | Inspect detailed consignment record, line items, and landed costs | Authenticated |
| `PUT` | `/api/v1/purchase/import-orders/{id}` | Update pending import consignment details or product lines | Authenticated |
| `PATCH` | `/api/v1/purchase/import-orders/{id}/status` | Move consignment through workflow (`pending` -> `confirmed` -> `received` -> `closed`) | Authenticated / Admin |
| `DELETE`| `/api/v1/purchase/import-orders/{id}` | Soft-delete import consignment order | Authenticated / Admin |
| `POST` | `/api/v1/purchase/import-orders/{id}/bill` | Upload consignment document / shipping bill | Authenticated |
| `DELETE`| `/api/v1/purchase/import-orders/{id}/bill` | Delete uploaded consignment document | Authenticated |
| `GET` | `/api/v1/purchase/import-orders/{id}/bill-file` | Stream or download original uploaded invoice/bill file (supports query `?token=<access_token>` and `?download=true`) | Authenticated |

> **Expected Arrival Date Default (`ETA Port Date + 5 Days`, Editable), Bill File Streaming & Zero-Synthetic-PDF Policy:**
> - **`Expected Arrival Date` Default & Override Contract:** On both `POST /api/v1/purchase/import-orders` (`_prepare` when `previous is None`) and `POST /api/v1/purchase/import-orders/import` (`import_import_purchases`), if `eta_port_date` is supplied and `expected_arrival_date` is blank/omitted, the server automatically computes `expected_arrival_date = eta_port_date + timedelta(days=5)`. In the Add/Edit UI (`ImportPurchasePage.tsx`), selecting or typing `ETA Port Date` auto-populates `Expected Arrival Date` (`addDaysToDDMMYYYY(val, 5)`) while keeping the field unlocked and editable so any custom `expected_arrival_date` (`>= Created Date`) is accepted and persisted.
> - `GET /api/v1/purchase/import-orders/{id}/bill-file`: Authenticated via standard `Authorization: Bearer <token>` or `?token=<jwt>` query parameter (allowing clean HTML `<iframe>` previews without CORS header issues).
> - **Zero Synthetic PDF Generation:** The endpoint serves only the real, operator-uploaded invoice file. Synthetic PDF generation is banned. Multi-format support: PDF (`<iframe src={blobUrl}>`), images (preview + download), and Office documents (`.docx`/`.xlsx` download cards).
> - **Closed Status Action Menu Lock:** Consignments in `closed` status strictly restrict the row action menu to `Download Purchase` only. Edit, Confirm, and Delete operations are removed.

---

## 9. Sales — Proforma Invoices (`/proforma-invoice/list`, `/sales/proforma-invoices`)

| Method | Endpoint URI | Description | Permission Gate |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/proforma-invoice/list` (`/api/v1/sales/proforma-invoices`) | List proforma invoices with per-stage tab counts, commercial terms, and search (masked/enforced per stage view permission) | `proforma.view \| proforma.{pending,admin_approved,confirmed,cancelled}.view \| proforma.manage` |
| `POST` | `/api/v1/proforma-invoice` | Create new proforma invoice with line items, tax breakdown, and commercial terms | `proforma.create \| proforma.manage` |
| `GET` | `/api/v1/proforma-invoice/{id}` | Inspect detailed proforma invoice with billing/shipping address and line calculations | `proforma.{view,<stage>.view,download,details.view,update,manage}` |
| `PATCH` | `/api/v1/proforma-invoice/{id}` | Update editable proforma invoice record (`pending` stage for editors; `admin_approved` additionally requires `proforma.approve \| proforma.manage`) | `proforma.update \| proforma.manage` |
| `PATCH` | `/api/v1/proforma-invoice/{id}/status` | Move proforma invoice through workflow (`pending` -> `admin_approved` -> `confirmed` or `cancelled`) | `proforma.{approve,confirm,cancel,manage}` (per target stage) |
| `DELETE`| `/api/v1/proforma-invoice/{id}` | Soft-delete proforma invoice record (at deletable stages) | `proforma.delete \| proforma.manage` |

---

## 10. Suppliers Directory (`/suppliers`)

| Method | Endpoint URI | Description | Permission Gate |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/suppliers` | List paginated suppliers with filters and product categories | `supplier.view` |
| `POST` | `/api/v1/suppliers` | Create supplier profile; **`contact_calling_number` is mandatory** with strict phone validation | `supplier.create` |
| `GET` | `/api/v1/suppliers/{id}` | Inspect detailed supplier record and linked products | `supplier.view` |
| `PATCH` | `/api/v1/suppliers/{id}` | Update supplier profile (cannot blank out mandatory calling number) | `supplier.update` |
| `POST` | `/api/v1/suppliers/{id}/contacts` | Add sub-contact person with country dial code, WhatsApp/WeChat sync, and handling territory | `supplier.update` |
| `POST` | `/api/v1/suppliers/import` | Bulk CSV/Excel supplier import with column mapping and duplicate validation | `supplier.import` |
| `GET` | `/api/v1/suppliers/export` | Export active/filtered suppliers directory to CSV/Excel | `supplier.export` |
| `DELETE`| `/api/v1/suppliers/{id}` | Soft-delete supplier profile | `supplier.delete` |

---

## 11. Authentication, SSO Handover & Identity Federation (`/auth`, `/users`)

| Method | Endpoint URI | Description | Auth Required |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/v1/auth/login` | Local credential authentication (email / phone / internal username) returning token pair & `ProfileResponse` (`display_name` & `full_name` primary) | Public |
| `GET` | `/api/v1/auth/profile` | Retrieve current authenticated user's `ProfileResponse` (`display_name`, `full_name`, roles, permissions) | Authenticated |
| `POST` | `/api/v1/auth/sso-handover` | Authenticate incoming SSO handover token with mandatory live central session verification against ERP_Main and `display_name`-enriched `ProfileResponse` | Public / Handover Token |
| `POST` | `/api/v1/auth/change-password` | Update current user's password and asynchronously push to ERP_Main | Authenticated |
| `POST` | `/api/v1/users/{id}/reset-password` | Administrative password reset and automatic fanout push to ERP_Main | `user.manage` |
| `PATCH` | `/api/v1/users/{id}` | Update user profile & HR attributes (`display_name` primary, internal `username` preserved when omitted, email locked to central control plane) with best-effort `display_name` push to `ERP_Main` (`POST /internal/users/profile`) | `user.update` / Self |
| `POST` | `/api/v1/internal/users/{id}/deprovision` | Invalidate spoke sessions and soft-delete user upon ERP_Main deprovisioning | Internal Service Key |
| `GET` | `/api/v1/organizations/public` | Unauthenticated public branding endpoint returning company name, legal name, and DB-backed versioned logo URL (`null` when removed) | Public |
| `GET` | `/api/v1/organizations/logo` | Stream company logo binary directly from database (`logo_data`) with `?v={sha1}` version hash for immutable client caching (`404` when absent) | Public |
| `POST` | `/api/v1/organizations/logo` | Upload or replace company logo (`logo_data` in PostgreSQL + branding storage cleanup of previous file) | `organization.manage` |
| `DELETE` | `/api/v1/organizations/logo` | Remove company logo (clears `logo_url` & `logo_data` in DB and deletes stored branding file) | `organization.manage` |
| `GET` | `/api/v1/health/federation` | Cross-ERP sign-in and control plane diagnostics: live ERP_Main probes, latencies, base URLs tried, and validation problems (safe, no secrets) | Public |

## Session-scoped tokens and per-session revocation

- Login (`POST /api/v1/auth/login`), refresh and SSO handover replies include `session_id` and `session_mode` (`"central"`: ERP_Main knows the session, switching ERPs works; `"local"`: this ERP only, used when ERP_Main was unreachable at login).
- Every access and refresh token carries `sid`. `POST /api/v1/auth/logout` revokes the token's session here and reports it to ERP_Main, which ends it everywhere that login was used. Other logins of the same person keep working.
- `POST /api/v1/internal/sessions/{session_id}/revoke` (service credential: `Authorization: Bearer <credential>`): called by ERP_Main to end one session. Idempotent. All tokens of that session stop working and its live WebSockets are closed.
- A token without `sid` (issued before this release) keeps working and can only be ended with the per-user force logout (`POST /api/v1/internal/users/{id-or-email}/logout`).
- Safety net: the ERP asks ERP_Main about central sessions at most every 45 seconds and ends a revoked one itself; if ERP_Main is unreachable the session is kept (fail-open).
- `POST /api/v1/auth/sso-handover`:
  - `401 Unauthorized`: Returned when the central session ended, does not match, or when the user account is soft-deleted (`deleted_at IS NOT NULL`) or disabled (`is_active=False`) in this ERP's local database ("This account was deleted or disabled in this ERP. Ask an administrator to restore it.").
  - `403 Forbidden`: Returned when the user has no permissions or organization access to this ERP.
  - **`503 Service Unavailable`**: Returned when ERP_Main cannot be reached during handover verification after exhaustive candidate trials and the 40s wake-up budget (retryable by frontend).
  - Stale session fallback: If ERP_Main remains unreachable, an active session verified within `SSO_HANDOVER_STALE_OK_SECONDS` (900s) is accepted from memory cache (`_from_cache: True`).

---

## 12. Customer Relationship Management (CRM) Full Suite (`/crm`)

| Method | Endpoint URI | Description | Permission Gate |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/crm/leads` | List CRM leads with search, source, stage, priority, and date range filters | `crm.view` |
| `POST` | `/api/v1/crm/leads` | Create new CRM lead with contact, company, priority, and stage | `crm.create` |
| `GET` | `/api/v1/crm/leads/{id}` | Inspect detailed lead profile, requirement notes, and linked entities | `crm.view` |
| `PATCH` | `/api/v1/crm/leads/{id}` | Update lead fields, assignment, closing date, and expected revenue | `crm.update` |
| `PATCH` | `/api/v1/crm/leads/{id}/stage` | Advance or update pipeline stage (Kanban drag-and-drop integration) | `crm.update` |
| `GET` | `/api/v1/crm/leads/{id}/timeline` | Retrieve 360° chronological activity timeline (calls, notes, quotes, tasks) | `crm.view` |
| `POST` | `/api/v1/crm/leads/{id}/convert-company` | Convert qualified lead into official B2B Company master record | `company.create` |
| `DELETE`| `/api/v1/crm/leads/{id}` | Soft-delete CRM lead | `crm.delete` |
| `POST` | `/api/v1/crm/import` | Bulk import leads from CSV/Excel with column mapping & deduplication | `crm.import` |
| `GET` | `/api/v1/crm/pipeline` | List configured pipeline stages in sequential order | `crm.view` |
| `POST` | `/api/v1/crm/pipeline` | Create, reorder, or update pipeline lifecycle stages and SLA hours | `crm.pipeline.manage` |
| `GET` | `/api/v1/crm/distribution` | List round-robin sales distribution rules | `crm.distribution.manage` |
| `POST` | `/api/v1/crm/distribution` | Update lead assignment routing rules and salesperson roster | `crm.distribution.manage` |
| `POST` | `/api/v1/crm/distribution/assign-next` | Evaluates rules and auto-assigns next sales rep via round-robin | Authenticated |
| `GET` | `/api/v1/crm/quotations` | List CRM quotations with status, lead, and client filters | `crm.quotation.view` |
| `POST` | `/api/v1/crm/quotations` | Generate formal sales quotation with tax calculations & commercial terms | `crm.quotation.create` |
| `GET` | `/api/v1/crm/quotations/{id}` | Retrieve quotation details and line items | `crm.quotation.view` |
| `GET` | `/api/v1/crm/quotations/{id}/pdf` | Stream official branded ReportLab Quotation A4 PDF document | `crm.quotation.view` |

---

## 13. Workforce — Recurring Tasks Scheduling Engine (`/tasks/recurring-schedules`)

| Method | Endpoint URI | Description | Permission Gate |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/tasks/recurring-schedules` | List recurring task schedules with cadence, status, and department filters | `task.view` |
| `POST` | `/api/v1/tasks/recurring-schedules` | Create recurring schedule template (Daily, Weekly, Monthly, Cron) | `task.create` |
| `GET` | `/api/v1/tasks/recurring-schedules/{id}` | Inspect schedule template details, blueprint subtasks, and run history | `task.view` |
| `PATCH` | `/api/v1/tasks/recurring-schedules/{id}` | Update schedule recurrence pattern, priority, assignees, or dates | `task.update` |
| `PATCH` | `/api/v1/tasks/recurring-schedules/{id}/status`| Pause, resume, or archive recurring schedule | `task.update` |
| `POST` | `/api/v1/tasks/recurring-schedules/{id}/trigger`| Immediately spawn task instance from schedule blueprint ("Run Now") | `task.create` |
| `DELETE`| `/api/v1/tasks/recurring-schedules/{id}`| Soft-delete recurring schedule template | `task.delete` |

---

## 14. Product Catalog Synchronization Adapter (`/products/sync-yinglima`)

| Method | Endpoint URI | Description | Permission Gate |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/v1/products/sync-yinglima` | Trigger synchronization of products from Yinglima (China Sourcing) to Inhyma | `product.manage` |
| `GET` | `/api/v1/products/sync-status` | Inspect last synchronization run, items ingested, and dependency provision status | `product.view` |

> **Dependency Auto-Provisioning Engine:**
> - When synchronizing catalog items from Yinglima to Inhyma, if an incoming item references a Category, Subcategory, Brand, UOM, or Tax rate not present in Inhyma, the adapter auto-creates the record on the fly before persisting the product.
> - Preserves relational foreign key integrity without human intervention.

---

## 15. Product Master, DB-Backed Specification Documents & Machine-Spares Mapping (`/masters/products`, `/products/machine-spares`)

| Method | Endpoint URI | Description | Permission Gate |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/v1/masters/products/specification-document` | Upload a Product Master specification document (`.pdf`, `.doc`, `.docx`, `.xls`, `.xlsx`, `.csv`, `.txt`, `.rtf`, `.odt`, `.ods`, `.ppt`, `.pptx`, up to 25 MB), persist binary payload in PostgreSQL (`product_specification_documents`), and return saved `{ specification_doc_id, specification_doc_name, specification_doc_mime, specification_doc_url }` | Authenticated |
| `GET` | `/api/v1/masters/products/specification-documents/{doc_id}` | Publicly stream/download DB-stored product specification document (`Content-Disposition: inline` for PDFs; `attachment` for Office documents) so links embedded inside external Quotation PDFs open directly | Public |
| `GET` | `/api/v1/masters/products/specification-documents/{doc_id}/{filename}` | Filename-preserving public streaming route for DB-stored product specification documents | Public |
| `GET` | `/api/v1/products/machine-spares/universal-view` | Inspect machine-wise spare parts compatibility matrix, linked codes, pricing, and stock levels across `Active` machines and `Active` spare parts (`RecordStatus.ACTIVE`) | `product.view` |
| `POST` | `/api/v1/products/machine-spares/map` | Map/associate a spare part to a machine model (`{ machine_id, spare_part_id, remarks? }`) | `product.update` |
| `POST` | `/api/v1/products/machine-spares/unmap` | Unlink a spare part from a specific machine model (`{ machine_id, spare_part_id }`) | `product.update` |
| `DELETE` | `/api/v1/products/machine-spares/unmap` | Idempotent alias to unlink a spare part from a machine model | `product.update` |

> **Multi-Machine Association Model:**
> - Machines and spare parts are associated through `product_machine_spares` join records.
> - Standard spare parts can be linked to multiple machines concurrently (shared spares).
> - Unlinking a spare part from one machine does not sever relationships with any other machine.

---

## 16. In-App Notification Engine & Polling Endpoints (`/notifications`)

| Method | Endpoint URI | Description | Permission Gate |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/notifications` | List notifications for the authenticated user with pagination and filter | Authenticated |
| `GET` | `/api/v1/notifications/unread-count` | Ultra-lightweight endpoint returning `{ unread_count: int }` for header bell badge poller | Authenticated |
| `PATCH` | `/api/v1/notifications/{id}/read` | Mark a specific notification as read | Authenticated |
| `POST` | `/api/v1/notifications/{id}/read` | Idempotent POST alias for marking notification as read | Authenticated |
| `POST` | `/api/v1/notifications/read-all` | Mark all unread notifications as read for current user | Authenticated |

---

## 17. Multi-ERP Federation & Ecosystem SSO Handover (`/auth/sso-handover`)

| Method | Endpoint URI | Description | Permission Gate |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/v1/auth/sso-handover` | Exchange central ecosystem session token for spoke JWT token pair | Public / Central Token |
| `GET` | `/api/v1/auth/verify-session` | Validate session token, profile claims, and ecosystem access permissions | Authenticated |

> **Canonical ERP Key Matching Engine (`erp_keys.py`):**
> - Normalizes keys via lowercase, alphanumeric stripping (e.g. `inhyma-erp` $\rightarrow$ `inhyma`).
> - Prevents access denial from casing or suffix differences between ERP_Main registry and spoke apps.

---

## 18. Sales — Sales Orders & Sales Process Execution (`/sales/orders`, `/sales/discount-payments`)

| Method | Endpoint URI | Description | Permission Gate |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/sales/orders` | Paginated list of Sales Orders with 9 stage tabs, search, warehouse, buyer, and date filters (enforces per-stage `?status=` query gating and tab masking) | `saleorder.view \| saleorder.{pending,sales_confirmed,admin_approved,acc_confirmed,gatepass_created,dispatched,gatepass_cancelled,lr,cancelled}.view \| saleorder.{approve,accounts,warehouse,manage}` |
| `POST` | `/api/v1/sales/orders` | Create Sales Order defaulting to `pending` status with line items & commercial terms; supports optional `technician_gatepass_id` (credits gatepass-held physical stock without double-deduction and closes the linked gatepass) and auto-syncs `SaleOrderItem.serial_numbers` into `MachineWarranty` | `saleorder.{create,duplicate,manage} \| technician_operations.{gatepass.create_so,manage}` |
| `GET` | `/api/v1/sales/orders/{id}` | Inspect detailed Sales Order record with line items, tax, and address breakdown | `saleorder.{view,<stage>.view,details.view,download,update,duplicate,files,approve,accounts,warehouse,manage}` |
| `PATCH`| `/api/v1/sales/orders/{id}` | Update Sales Order details, line items, and commercial fields (syncing updated `serial_numbers` to `MachineWarranty`); file-only updates accepted under `saleorder.files` | `saleorder.update \| saleorder.files \| saleorder.manage` |
| `PATCH`| `/api/v1/sales/orders/{id}/status` | Advance Sales Order stage (`pending` -> `sales_confirmed` -> `admin_approved` -> `acc_confirmed` -> `gatepass_created` -> `dispatched` -> `lr` or `cancelled`, re-holding and unlinking any linked Technician Gatepass on cancellation) with PO, Tally Bill, E-Way Bill, Gatepass, and LR metadata | `saleorder.{confirm,approve,accounts,warehouse,cancel,manage}` (per transition) |
| `POST` | `/api/v1/sales/upload-po` | Upload client Purchase Order (PO) document (`inhyma-sales-docs` / `/uploads/private/sales_po/`) | `saleorder.{files,confirm,accounts,warehouse,update,create,manage}` |
| `POST` | `/api/v1/sales/upload-tally-bill` | Upload Tally Bill document (`inhyma-sales-docs` / `/uploads/private/sales_tally_bills/`) | `saleorder.{files,confirm,accounts,warehouse,update,create,manage}` |
| `POST` | `/api/v1/sales/upload-eway-bill` | Upload E-Way Bill document when `E-Way Bill = Yes` (`inhyma-sales-docs` / `/uploads/private/sales_eway_bills/`) | `saleorder.{files,confirm,accounts,warehouse,update,create,manage}` |
| `POST` | `/api/v1/sales/upload-lr` | Upload Lorry Receipt (LR) file (`inhyma-sales-docs` / `/uploads/private/sales_lr/`) | `saleorder.{files,confirm,accounts,warehouse,update,create,manage}` |
| `POST` | `/api/v1/sales/upload-dispatch-media` | Upload multiple dispatch photos/videos (`inhyma-sales-docs` / `/uploads/private/sales_dispatch_media/`) | `saleorder.{files,confirm,accounts,warehouse,update,create,manage}` |
| `POST` | `/api/v1/sales/orders/{id}/status-with-po` | Atomic multipart status update with optional PO file upload | `saleorder.{confirm,approve,accounts,warehouse,cancel,manage}` |
| `DELETE`| `/api/v1/sales/orders/{id}` | Soft-delete Sales Order, revert inventory stock deductions, and re-hold/reopen any linked Technician Gatepass (`so_required=True`) | `saleorder.delete \| saleorder.manage` |
| `POST` | `/api/v1/sales/orders/{id}/restore` | Restore soft-deleted Sales Order (Admin / `saleorder.manage` only) | `saleorder.manage` |
| `GET` | `/api/v1/sales/metrics` | Grouped sales order KPI metrics by status tabs | `_REQUIRE_SALEORDER_LIST` |
| `GET` | `/api/v1/sales/next-gatepass-no` | Generate next sequential gate pass reference number | `saleorder.{view,<stage>.view,create,update,duplicate,warehouse,manage}` |
| `GET` | `/api/v1/sales/planning-consignments` | Extract consignment columns from Shipment Planning sheets for order pre-allocation | `saleorder.{view,<stage>.view,create,update,duplicate,warehouse,manage}` |
| `GET` | `/api/v1/sales/planning-consignments/{column_id}/items` | Extract planned products and quantities from consignment column | `saleorder.{view,<stage>.view,create,update,duplicate,warehouse,manage}` |
| `GET` | `/api/v1/sales/export` | Export Sales Orders dataset to Excel spreadsheet (enforces `?status=` stage view check) | `saleorder.export \| saleorder.manage` |
| `GET` | `/api/v1/sales/discount-payments` | List under-invoicing cash discount payment ledger entries and multi-installment history (enforces stage `?status=` permissions; strictly isolated from `saleorder.*`, `proforma.*`, `crm.leads.*`, and `report.view`) | `discount_payment.{view,pending.view,completed.view,manage}` |
| `POST` | `/api/v1/sales/discount-payments` | Record discount payment installment settlement authorization (strictly gated to Discount Payments write permissions) | `discount_payment.adjust \| discount_payment.manage` |
| `PATCH` | `/api/v1/sales/discount-payments/{payment_id}` | Update existing discount payment installment (amount, mode, date, receipt, remarks) | `discount_payment.adjust \| discount_payment.manage` |
| `GET` | `/api/v1/sales/deleted-orders` (`/api/v1/delete_order_report/list`) | List soft-deleted Sales Orders in Deleted Orders report | `report.view \| trash.view \| saleorder.{view,approve,delete,manage}` |
| `POST` | `/api/v1/sales/deleted-orders/{id}/restore` | Restore soft-deleted Sales Order from Deleted Orders report | `saleorder.{approve,delete,manage}` |

> **Granular Masters RBAC (`z9e3f4a5b6c7`–`z9h6a7b8c9d0`):**
> - `/api/v1/masters/products*` (`products/routes.py`, `price_list/routes.py`, `inventory/routes.py`, `events/routes.py`) enforce 8 `product.*` permissions (`view`, `create`, `update`, `delete`, `export`, `import`, `bulk_action`, `manage`; `/activate` & `/deactivate` accept `product.update | product.bulk_action | product.manage`; `/bulk-delete` requires both `product.delete` and `product.bulk_action` or `product.manage`).
> - `/api/v1/masters/product-categories*`, `/api/v1/masters/product-sub-categories*`, and `/api/v1/masters/brands*` each enforce 9 granular permissions (`view`, `create`, `update`, `delete`, `export`, `import`, `bulk_action`, `status_edit`, `manage`; `/activate` & `/deactivate` accept `*.update | *.status_edit | *.bulk_action | *.manage`).

> **Sales Process Add/Edit Architecture (`SaleProcessForm.tsx`):**
> - **100% Parity with Proforma Invoice:** Full alignment with Proforma's Add New form structure, validation rules, drawer slides, and calculation engine.
> - **Default Status "Pending":** Newly submitted orders automatically assign `status: "pending"`, ensuring they enter the initial workflow stage cleanly.
> - **Schema Harmonization:** Payload provides dual fields (`buyer_name` + `company_name`, `transport_name` + `transporter_name`, `expected_delivery_date` + `delivery_date`, `city`, `state`) to guarantee total compatibility with FastAPI backend schemas.
> - **Dynamic Masters & Drawers:** Uses `useMasterNames` for live database masters, `ClientNameAutocomplete` with `AddCompanyDrawer`, and `EditAddressDrawer` for non-destructive Billing/Shipping address overrides.
> - **Stock Exceeded Alerts:** Real-time query against `/inventory/product-stock?limit=500` warns users when quantity exceeds available warehouse stock with top banner, in-table alert, red border, and red badge.
> - **Upward Dropdown Positioning (`placement="up"`):** Searchable Comboboxes inside table rows open upward, completely avoiding scrollbar boundary clipping.
> - **Technician Gatepass Pre-Fill Bridge (`?gatepass_id=<uuid>`):** Navigating to `/sales/process/add?gatepass_id=<uuid>` fetches `GET /api/v1/technician-operations/gatepasses/{id}/draft-so`, pre-fills Dispatch Warehouse, Company, Billing/Shipping Addresses, Remarks, and consumed non-warranty spare parts (`HSN`, `GST %`, `Qty`, `Rate`), displays a linked-gatepass banner, and submits `technician_gatepass_id` on `POST /api/v1/sales/orders`.

---

## 19. Communication — Internal Feed, Announcements & 1:1 Direct Messages (`/feed`)

| Method | Endpoint URI | Description | Permission Gate |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/v1/feed/posts` | Create new feed post/announcement with department (`feed_post_departments`) or explicit recipient (`is_explicit`) targeting | `feed.create` |
| `GET` | `/api/v1/feed/posts` | List scoped feed posts with pagination (`page`, `page_size`), search, and dynamic department + explicit-recipient privacy checks | `feed.view` |
| `GET` | `/api/v1/feed/posts/{post_id}` | Detailed visible post record, comments, reaction aggregations, and viewer status | `feed.view` |
| `PATCH` | `/api/v1/feed/posts/{post_id}` | Edit feed post content/targeting (author only) | `feed.create` |
| `DELETE`| `/api/v1/feed/posts/{post_id}` | Soft-delete feed post (author or `feed.manage` on visible post) | `feed.create \| feed.manage` |
| `GET` | `/api/v1/feed/recipients/eligible` | List eligible active workforce recipients for audience selection | `feed.create \| feed.view` |
| `GET` | `/api/v1/feed/departments/eligible` | List eligible active departments for audience targeting | `feed.create \| feed.view` |
| `POST` | `/api/v1/feed/posts/{post_id}/comments` | Add a comment to a visible feed post | `feed.create` |
| `GET` | `/api/v1/feed/posts/{post_id}/comments` | List comments for a visible feed post | `feed.view` |
| `PATCH` | `/api/v1/feed/posts/{post_id}/comments/{comment_id}` | Edit own comment on a visible feed post | `feed.create` |
| `DELETE`| `/api/v1/feed/posts/{post_id}/comments/{comment_id}` | Soft-delete comment (author or `feed.manage` on visible post) | `feed.create \| feed.manage` |
| `POST` | `/api/v1/feed/posts/{post_id}/reactions` | Toggle emoji reaction on a visible feed post | `feed.create` |
| `POST` | `/api/v1/feed/posts/{post_id}/read` | Mark feed post as read for current user | `feed.view` |
| `GET` | `/api/v1/feed/posts/{post_id}/readership` | Retrieve post readership list | `feed.view` |
| `POST` | `/api/v1/feed/conversations` | Start or retrieve canonical 1:1 DM conversation (`participant_low_id`, `participant_high_id`) | `feed.create` |
| `GET` | `/api/v1/feed/conversations` | List private 1:1 DM conversations for current participant | `feed.view` |
| `GET` | `/api/v1/feed/conversations/unread-count` | Get total unread direct messages count for current user | `feed.view` |
| `GET` | `/api/v1/feed/conversations/{conversation_id}` | Get participant-only 1:1 DM conversation details | `feed.view` |
| `GET` | `/api/v1/feed/conversations/{conversation_id}/messages` | List messages in participant-only 1:1 DM conversation | `feed.view` |
| `POST` | `/api/v1/feed/conversations/{conversation_id}/messages` | Send direct message in 1:1 DM conversation | `feed.create` |
| `PATCH` | `/api/v1/feed/messages/{message_id}` | Edit own direct message | `feed.create` |
| `DELETE`| `/api/v1/feed/messages/{message_id}` | Soft-delete own direct message | `feed.create` |
| `POST` | `/api/v1/feed/conversations/{conversation_id}/read` | Mark 1:1 DM conversation as read | `feed.view` |

---

## 20. Human Resource Management System — HRMS (`/hrms`)

| Method | Endpoint URI | Description | Permission / Role Gate |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/v1/hrms/attendance/punch-in` | Punch in with validated GPS coordinates & geofence verification | `hrms.attendance` |
| `POST` | `/api/v1/hrms/attendance/punch-out` | Punch out and compute daily worked duration & attendance status | `hrms.attendance` |
| `GET` | `/api/v1/hrms/attendance/all-calendar` | Monthly all-employee attendance calendar matrix (`PRESENT`, `LATE`, `HALF_DAY`, `ON_LEAVE`, `HOLIDAY`, `WEEKEND`, `ABSENT`) | `hrms.attendance` (Scoped) |
| `POST` | `/api/v1/hrms/attendance/regularizations` | Submit attendance regularization; `direct_regularize=True` restricted strictly to Admin with self-approval blocked (`400 Bad Request`) | `hrms.attendance` / Admin |
| `GET` / `POST` | `/api/v1/hrms/leave/requests` | List or submit employee leave requests with manager-first routing and HR availability fallback | `hrms.leave` |
| `POST` | `/api/v1/hrms/leave/requests/{id}/approve` | Approve/reject leave request (enforces self-approval prevention & stale action guard) | Manager / HR / Admin |
| `GET` | `/api/v1/hrms/assets/summary` | Retrieve company-wide asset summary statistics (strictly gated to Admin or HR; `403` for regular employees) | Admin / HR |
| `PATCH` / `PUT` | `/api/v1/hrms/assets/{id}` | Update asset metadata, condition, or status (`PATCH /assets/{id}/status`); strictly gated to Admin or HR | Admin / HR |
| `GET` / `POST` | `/api/v1/hrms/expenses` | List or submit employee expense claims | `hrms.expenses` |
| `POST` | `/api/v1/hrms/expenses/{id}/approve` | Stage 1 manager/HR approval (`PENDING` -> `APPROVED`; self-approval blocked) | Manager / HR / Admin |
| `POST` | `/api/v1/hrms/expenses/{id}/reimburse` | Stage 2 HR/Finance reimbursement (`APPROVED` -> `REIMBURSED`; self-reimbursement strictly blocked with `403`) | HR / Finance / Admin |
| `GET` / `POST` | `/api/v1/hrms/site-visits` | Track field site visits with check-in/out geolocation & photographic evidence lifecycle | `hrms.site_visits` |
| `POST` | `/api/v1/hrms/payroll/calculate` | Generate/recalculate monthly payroll batch (`hrms.payroll.configure` separation-of-duties gate) | `hrms.payroll.configure` |
| `POST` | `/api/v1/hrms/payroll/{month}/approve` | Approve monthly payroll batch (`hrms.payroll.approve`), returning full deduplicated payroll with child item `APPROVED` propagation | `hrms.payroll.approve` |
| `PATCH` | `/api/v1/hrms/payroll/items/{item_id}` | Edit monthly payroll line item (`hrms.payroll.configure`; self-editing strictly prohibited with `400 Bad Request`) | `hrms.payroll.configure` |
| `POST` | `/api/v1/hrms/payroll/adjustments` | Add payroll bonus/deduction adjustment (`hrms.payroll.configure`; self-adjustment strictly prohibited with `400 Bad Request`) | `hrms.payroll.configure` |
| `GET` | `/api/v1/hrms/payroll/payslips` | Retrieve approved salary slips (employees see own only; managers with `employee_id=ALL` see managed department `APPROVED` slips) | `hrms.payroll` (Scoped) |
| `GET` | `/api/v1/hrms/payroll/export` | Export non-destructive monthly payroll `.xlsx` workbook (`Payroll_Export_All_Employees_YYYY_MM.xlsx`) | Admin / HR |

> **HRMS Setup Active-Only Extraction, Seed Idempotency & RBAC Bootstrap Notes:**
> - **Cross-Module `?active_only=true` vs Setup Management (`active_only=false`):** HRMS Setup endpoints (`/api/v1/hrms/setup/{locations,leave-types,expense-categories,holidays,leave-plans}`) return both active and inactive rows by default (`active_only=false`) for `/hrms/setup`, and accept `?active_only=true` when consumed by Leave (`/hrms/leave`), Asset Management (`/hrms/assets`), and Expense Management (`/hrms/expenses`), backed by server-side active-status validation on mutations.
> - **Soft-Delete Non-Recreation (`ensure_seeds()`):** HRMS setup endpoints inspect total row counts including soft-deleted rows (`deleted_at IS NOT NULL`) so user-deleted defaults never re-create on subsequent calls.
> - **Canonical RBAC System Roles (`/api/v1/rbac/roles`):** Bootstrap seeding (`scripts/seed.py`) provisions strictly three `is_system=True` roles—`super_admin` (`Admin`, holding all `420/420` unique permissions across `425` bootstrap entries), `user` (`User`), and `technician` (`Technician`, fixed field-service department to which admins assign `User` accounts)—with zero hardcoded business departments. All permission grant/revoke/bulk mutations (`POST`/`DELETE /rbac/roles/{id}/permissions`, `PUT /rbac/roles/{id}/permissions/bulk`, `PUT /rbac/users/{id}/permissions/bulk`, `/rbac/clone`, and `POST`/`DELETE /users/{id}/roles`) commit and publish `PERMISSIONS_UPDATED` over WebSocket (`user:{id}`) so connected clients sync `/auth/profile` immediately, while `AuthService.verify_access_token` prevents zero-permission DB users from inheriting stale JWT claims. On `/rbac` and `/users`, permission matrices group modules to match left-sidebar `nav.ts` sections (`NAV_PERMISSION_SECTIONS`) with real-time search filtering (`filterNavPermissionSections`).

---

## 21. Technician Operations — Spare Parts Gatepass, Stock Conservation, Wallet Ledger & Machine Warranty (`/technician-operations`)

| Method | Endpoint URI | Description | Permission Gate |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/technician-operations/lookups` | Unified active lookups (`Technician` department Users, `companies`, physical `warehouses`, `machines`, `spare_parts` with `compatible_machine_ids` & `stock_by_warehouse`, `cities`, open `technical_tasks`, non-cancelled `sale_orders`, and `serials`) | `technician_operations.{view,gatepasses.view,wallets.view,warranty.view,manage}` |
| `GET` | `/api/v1/technician-operations/metrics` | Top KPI ribbon counters (`active_gatepasses`, `pending_sales_orders`, `cash_in_hand`, `active_warranties`) | `technician_operations.{view,gatepasses.view,wallets.view,warranty.view,manage}` |
| `GET` | `/api/v1/technician-operations/gatepasses` | Paginated technician spare-parts outward gatepasses (`status`, `search`, `page`, `page_size`) | `technician_operations.gatepasses.view \| technician_operations.manage` |
| `POST` | `/api/v1/technician-operations/gatepasses` | Issue outward spare-parts gatepass (`GP-TECH-YYYY-NNNN`) and deduct physical warehouse stock (`409 Conflict` if insufficient stock) | `technician_operations.gatepass.create \| technician_operations.manage` |
| `GET` | `/api/v1/technician-operations/gatepasses/{id}` | Inspect detailed technician gatepass header, issued/returned/consumed items, and reconciliation metadata | `technician_operations.gatepass.details \| .draft_so \| .manage \| saleorder.{view,create,update}` |
| `POST` | `/api/v1/technician-operations/gatepasses/{id}/return` | Reconcile returned vs consumed parts (`returned + consumed <= issued`), restore `RETURNED_GOOD` to physical warehouse, quarantine `RETURNED_DEFECTIVE`, and set `so_required=True` on non-warranty consumed spares | `technician_operations.gatepass.return \| .update \| .manage` |
| `GET` | `/api/v1/technician-operations/gatepasses/{id}/draft-so` | Generate pre-filled Draft Sales Order payload (`warehouse`, `company`, `addresses`, `remarks`, consumed `items` with `hsn_code` & `gst_percent`) for `SaleProcessForm.tsx` | `technician_operations.gatepass.{draft_so,create_so} \| .manage \| saleorder.{view,create,update}` |
| `POST` | `/api/v1/technician-operations/gatepasses/{id}/link-so` | Verify and link an existing non-cancelled `SaleOrder` (`sale_order_id` or `so_number`), release gatepass-held stock if `order.stock_applied` is true, and close reconciliation | `technician_operations.gatepass.link_so \| .update \| .manage \| saleorder.{create,update}` |
| `GET` | `/api/v1/technician-operations/wallet/summaries` | Live per-technician wallet balances across `Technician` department Users (`total_collected`, `total_deposited`, `total_expenses`, `net_cash_in_hand`) | `technician_operations.wallet.balances.view \| technician_operations.manage` |
| `GET` | `/api/v1/technician-operations/wallet/transactions` | Paginated technician wallet ledger (`COLLECTION`, `HANDOVER_DEPOSIT`, `FIELD_EXPENSE`, including auto-synced `Self collect` `Task Sync` entries and uploaded `receipt_url` vouchers) | `technician_operations.wallets.view \| technician_operations.manage` |
| `POST` | `/api/v1/technician-operations/wallet/transactions` | Record manual wallet collection, cash handover deposit, or field expense (`WTX-YYYY-NNNN`) with optional uploaded receipt URL (type-checked per `transaction_type`) | `technician_operations.wallet.{create,collect,handover,expense} \| .manage` |
| `GET` | `/api/v1/technician-operations/warranty` | Paginated Machine Warranty Registry (`machine_warranties` + auto-synced Sales Order machine serials) | `technician_operations.warranty.view \| technician_operations.manage` |
| `POST` | `/api/v1/technician-operations/warranty` | Register or update a Machine Warranty Policy (`serial_number`, `machine_model`, `customer_name`, `warranty_months`, `start_date`, `end_date`) | `technician_operations.warranty.create \| technician_operations.manage` |
| `GET` | `/api/v1/technician-operations/warranty/validate` | Live serial coverage check (`?serial_number=...`) across both `MachineWarranty` policies and historical `SaleOrderItem.serial_numbers` | `technician_operations.warranty.validate \| .gatepass.create \| .manage \| saleorder.{view,create,update}` |

---

## 22. Financial Planning Report — Live 3-Module Aggregation & Settlement Overlay (`/financial-planning`)

| Method | Endpoint URI | Description | Permission Gate |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/financial-planning` | Aggregates live entries, dual-currency KPIs (`INR` `₹` default + `USD` `$`), and active `payment_terms_options` across confirmed `ImportPurchase` (`confirmed`, `received`, `closed` -> Supplier + `Total Taxes (INR)` rows), confirmed `LocalPurchase` (`confirmed` -> Supplier row), and `Acc. Confirmed` `SaleOrder` (`acc_confirmed` and downstream active stages -> Customer row), merged with `financial_planning_entries` overlays | `report.view \| purchase.view \| saleorder.view \| saleorder.accounts \| saleorder.approve` |
| `POST` | `/api/v1/financial-planning/upload` | Multipart upload for invoice, customs/BOE challan, or payment receipt (`financial-planning` bucket / `uploads/private/financial_planning`) | `report.view \| purchase.{view,create,update} \| localpurchase.{update,manage} \| importpurchase.update \| saleorder.{accounts,update,approve}` |
| `PATCH` | `/api/v1/financial-planning/entries/{entry_key}/terms` | Upsert `payment_terms`, `due_date`, `remarks`, and optional `payment_attachment_url` on `financial_planning_entries` (`entry_key = {source_module}:{uuid}:{role}`) | `report.view \| purchase.{view,create,update} \| localpurchase.{update,manage} \| importpurchase.update \| saleorder.{accounts,update,approve}` |
| `POST` | `/api/v1/financial-planning/entries/{entry_key}/record-payment` | Record partial or full settlement (`amount > 0` and `<= balance_amount`), append immutable entry to `payments_history`, and transition `Pending` -> `Cleared` when balance reaches `0` | `report.view \| purchase.{view,create,update} \| localpurchase.{update,manage} \| importpurchase.update \| saleorder.{accounts,update,approve}` |
| `PATCH` | `/api/v1/financial-planning/entries/{entry_key}/attachment` | Attach or replace `invoice` or `payment` document URL on a Financial Planning entry | `report.view \| purchase.{view,create,update} \| localpurchase.{update,manage} \| importpurchase.update \| saleorder.{accounts,update,approve}` |

---

## 23. Cargo Overview — Consignment Gallery, Cargo Status Checklist, Finance & Product Summary (`/cargo-overview`)

| Method | Endpoint URI | Description | Permission Gate |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/cargo-overview` | List Cargo Overview consignments (`stage=all\|pending\|cleared`, `warehouse`, `search`) and active `warehouses`, merging `cargo_overviews` overlays with pluggable `CargoDataExtractor` records | `cargo_overview.view \| report.view` |
| `GET` | `/api/v1/cargo-overview/detail` | Retrieve unified Detail View payload (`?key=...`) containing Metadata Strip, Finance Planning (`INR` `₹` / `USD` `$`), 22-slot Consignment Gallery, 12-item Cargo Status Checklist, and Product Summary | `cargo_overview.view \| report.view` |
| `POST` | `/api/v1/cargo-overview` | Create or upsert a `CargoOverview` record (`consignment_key`, `batch_no`, `warehouse`, dates, forwarder/agent, `finance_lines`, `products`) | `cargo_overview.cargo_status.edit \| report.view` |
| `PATCH` | `/api/v1/cargo-overview/checklist` | Update Yes/No checklist toggles, `cargo_remarks`, `etd_origin_date`, `eta_port_date`, `expected_arrival_date`, `forwarder_name`, `clearing_agent_name`, and `batch_no` (`?key=...`) | `cargo_overview.cargo_status.edit \| report.view` |
| `POST` | `/api/v1/cargo-overview/documents` | Multipart upload to one of the 22 Consignment Gallery slots (`?key=...&slot_key=...`) via `save_uploaded_file` (`cargo-overview` Supabase bucket or `/uploads/private/cargo_overview/`) | `cargo_overview.gallery.upload \| report.view` |
| `DELETE` | `/api/v1/cargo-overview/documents` | Delete a manually uploaded document from a Consignment Gallery slot (`?key=...&slot_key=...`) and clean up stored file | `cargo_overview.gallery.delete \| report.view` |
| `GET` | `/api/v1/cargo-overview/export` | Export filtered Cargo Overview list summary as UTF-8 BOM `.csv` | `cargo_overview.view \| report.view` |

---

## 24. RBAC Auto-Save Bulk Sync & Live Permission Broadcast (`/rbac`, `/users/{id}/roles`)

| Method | Endpoint URI | Description | Permission Gate |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/rbac/permissions` | List all active (non-deprecated) permission definitions (`planning.*`, `inquiry.*`, `quotation.*`, `technician_operations.create`, `task.organization_view` excluded) | `roles_permissions.view` |
| `POST` | `/api/v1/rbac/roles/{role_id}/permissions` | Immediately grant one permission to a department and publish `PERMISSIONS_UPDATED` to assigned users | `roles_permissions.action` |
| `DELETE` | `/api/v1/rbac/roles/{role_id}/permissions/{permission_id}` | Immediately revoke one permission from a department and publish `PERMISSIONS_UPDATED` to assigned users | `roles_permissions.action` |
| `PUT` | `/api/v1/rbac/roles/{role_id}/permissions/bulk` | Atomically replace all direct permissions on a department (`Select Group` / `Deselect Group` / `Select All` / `Deselect All`; rejects `super_admin` and deprecated codes) and publish `PERMISSIONS_UPDATED` | `roles_permissions.action` |
| `PUT` | `/api/v1/rbac/users/{user_id}/permissions/bulk` | Atomically replace per-user direct `ALLOW`/`DENY` overrides (`GRANT`/`DENY` diff vs role defaults) and publish `PERMISSIONS_UPDATED` | `roles_permissions.action` |
| `POST` / `DELETE` | `/api/v1/users/{user_id}/roles` (`/{role_id}`) | Assign or remove a department role on a user, commit, and publish `PERMISSIONS_UPDATED` on `user:{user_id}` | `user.action` |






