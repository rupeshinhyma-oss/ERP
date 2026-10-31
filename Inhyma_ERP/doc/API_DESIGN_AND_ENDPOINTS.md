# Inhyma_ERP — API Design & Endpoints Specification

**Service Base URL:** `http://localhost:8002/api/v1`  
**Authentication Scheme:** Bearer JWT (HS256) & WebSocket Query Tokens  
**Standard Response Envelope:** `{ "success": true, "data": ..., "meta": ..., "error": null }`  
**Last Updated:** October 31, 2026

> **Universal Cross-Module Active-Only Extraction & Filtering Convention:**
> - **Management Lists vs Cross-Module Lookups:** Unfiltered management endpoints (`GET /api/v1/masters/*`, `/companies`, `/suppliers`, `/buyers`, `/users`, `/positions`, and `/hrms/setup/*` with default `active_only=false`) return **both** `Active` and `Inactive` rows so each module's own `Active` / `Inactive` tabs and status toggles remain functional. Conversely, every cross-module picker/lookup endpoint (`/api/v1/masters/*/lookup`, `/api/v1/masters/*/dropdown`, `/companies/lookup`, `/companies/sales-persons`, `/users/all?active_only=true`, `/positions/all?active_only=true`, `/inquiries/consignment-codes`, `/inquiries/companies`, `/hrms/setup/*?active_only=true`, `/products/machine-spares/universal-view`, and `/search`) returns **`Active` records only**.
> - **Bidirectional Filter Translation (`BaseRepository._apply_dynamic_filters`):** All paginated endpoints backed by `BaseRepository` inspect real SQLAlchemy columns (`self.model.__table__.columns`) and bidirectionally translate `?status=active|inactive` and `?is_active=true|false` across both `RecordStatus` tables (`products`, `banks`, `warehouses`, all 28 masters) and boolean `is_active` tables (`companies`, `suppliers`, `buyers`).
> - **Historical Reference & Cancellation Reversal Safety:** Single-record reads (`GET /api/v1/.../{id}`) continue resolving inactive historical references (`200 OK`), and order cancellation (`_release_stock`) invokes `StockService.find_product(..., require_active=False)` / `get_warehouse(..., require_active=False)` so stock reversals succeed even if a SKU or warehouse was deactivated later.

---

## 1. Companies & B2B Directory (`/companies`)

| Method | Endpoint URI | Description | Permission Gate |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/companies` | List paginated companies with grade, potential, status (`?status=active\|inactive` / `?is_active=true\|false`), and search filters | `company.view` |
| `GET` | `/api/v1/companies/lookup` | Lightweight active-only company autocomplete lookup (`active_only=true` default) for commercial & service forms | Authenticated |
| `GET` | `/api/v1/companies/sales-persons` | List active salespersons (`User.status == ACTIVE`) for Proforma, Sales Process, and Company filters | Authenticated |
| `POST` | `/api/v1/companies` | Create company account with extended intelligence fields & contacts | `company.create` |
| `GET` | `/api/v1/companies/{id}` | Inspect detailed profile (extended fields, social media matrix, Direct Import from China cluster) | `company.view` |
| `PATCH` | `/api/v1/companies/{id}` | Update company details, credit terms, turnover, import volume, and intelligence | `company.update` |
| `DELETE`| `/api/v1/companies/{id}` | Soft-delete company record and linked contacts | `company.delete` |
| `PATCH` | `/api/v1/companies/{id}/grade` | Inline update corporate grade (A, B, C, D) | `company.update` |
| `PATCH` | `/api/v1/companies/{id}/potential` | Inline update revenue potential rating (Yes / No; requires `potential_reason` if No, allows `potential_business_per_month` if Yes) | `company.update` |
| `POST` | `/api/v1/companies/{id}/contacts` | Add sub-contact person with birth_date & anniversary_date | `company.update` |
| `POST` | `/api/v1/companies/import` | Bulk Excel/CSV import wizard | `company.import` |
| `GET` | `/api/v1/companies/export` | Export company records to Excel/CSV | `company.export` |

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
| `POST` | `/api/v1/masters/cities` | Create new city with `state_id` and `district_id` references | `city.create` |

---

## 3. Inventory, Product Stock, Re-Order & Stock Transactions (`/inventory`)

| Method | Endpoint URI | Description | Permission Gate |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/inventory/product-stock` | Master-joined 9-warehouse Product Stock & Stock Transactions list restricted strictly to `Active` products (`Product.status == RecordStatus.ACTIVE`; `limit` up to `5000`, `category`, `sub_category`, `brand`, `warehouse`, `negative_stock`, `low_stock`, `machine_id`, `search`; returns active-only `filter_options` & `breakup_flags`) | `product.view` |
| `GET` | `/api/v1/inventory/product-stock/{id}` | Inspect single product's multi-warehouse stock record (resolves either `ProductStock.id` or `Product.id` with zero-stock fallback) | `product.view` |
| `GET` | `/api/v1/inventory/product-stock/breakup` | Inspect warehouse cell breakup (`physical` adjustments/transfers, or `transit` / `ordered` expected consignments + FIFO `booked_orders` queue) | `product.view` |
| `GET` | `/api/v1/inventory/stock-transactions/{product_ref}` | Chronological 5-source Per-Product Stock Transaction Ledger (`Sale`, `Stock IN`, `Stock OUT`, `Local Purchase`, `Import Purchase`, `Transfer IN`, `Transfer OUT`) with `available_qty`, `warehouse`, `tx_type`, `date_from`, `date_to`, and `search` filters. Aliased at `/api/v1/stock-transaction/list/{product_ref}`, `/api/v1/stock_transaction/list/{product_ref}`, and `/api/v1/inventory/product-stock/{product_ref}/transactions` | `product.view` |
| `GET` | `/api/v1/inventory/product-reorder` | 16-column branch-scoped Product Re-Order matrix for `Active` products (`Product.status == RecordStatus.ACTIVE`, `warehouse=Mumbai|Ahmedabad|Indore|All`, `category`, `sub_category`, `brand`, `shortfall`, `reorder`, `search`) | `product.view` |
| `PATCH` | `/api/v1/inventory/product-reorder/{product_id}` | Inline update `reorder_level` (`Re-Order`) and/or `minimum_order_quantity` (`MOQ`) on `Product` master | `product.update` |
| `GET` | `/api/v1/inventory/goods-expected-report` | Expected incoming consignments report across Import Purchases and Shipment Planning | `product.view` |
| `GET` | `/api/v1/inventory/stock-adjustment` | Paginated stock adjustment vouchers with type/date filters | `product.view` |
| `GET` | `/api/v1/inventory/stock-adjustment/{id}` | Detailed voucher with multi-product line items | `product.view` |
| `POST` | `/api/v1/inventory/stock-adjustment` | Create adjustment voucher and update warehouse balances (enforces active Warehouse & active Product validation) | `product.create` |
| `DELETE`| `/api/v1/inventory/stock-adjustment/{id}`| Soft-delete voucher and reverse inventory adjustments | `product.delete` |
| `GET` | `/api/v1/adjustment/adjustment-order-pdf/{id}` | Stream A4 adjustment order PDF document | `product.view` |
| `GET` | `/api/v1/inventory/stock-transfer` | Paginated inter-warehouse stock transfer orders | `product.view` |
| `POST` | `/api/v1/inventory/stock-transfer` | Create atomic inter-warehouse stock transfer (`from_warehouse` -> `to_warehouse`; enforces active source/destination Warehouses & active Products) | `product.create` |

---

## 4. Technical Tasks & Field Service Dispatch (`/technical-tasks`)

| Method | Endpoint URI | Description | Permission Gate |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/technical-tasks` | List service tickets by status tab, priority, and payment status (`payment_collected=pending|completed`) | `technicaltask.view` |
| `GET` | `/api/v1/technical-tasks/counts` | Status tab badge counts (Pending, Approved, Payment Pending, Completed, Cancel) | `technicaltask.view` |
| `GET` | `/api/v1/technical-tasks/payment-summary` | Aggregated payment KPIs (`total_payment`, `paid`, `due`, `pending_count`, `completed_count`) | `technicaltask.view` |
| `POST` | `/api/v1/technical-tasks` | Create field service ticket / breakdown maintenance call | `technicaltask.create` |
| `GET` | `/api/v1/technical-tasks/{id}` | Inspect detailed service ticket | `technicaltask.view` |
| `PATCH` | `/api/v1/technical-tasks/{id}` | Update machine details, problem notes, payment fields, or scheduled visit | `technicaltask.update` |
| `PATCH` | `/api/v1/technical-tasks/{id}/status` | Transition ticket status with resolution remarks and optional payment collection | `technicaltask.update` |
| `POST` | `/api/v1/technical-tasks/{id}/record-payment` | Atomically record collected payment amount, payment mode, reference no, date, and receipt | `technicaltask.update` |
| `POST` | `/api/v1/technical-tasks/upload-screenshot` | Upload payment screenshot / receipt image or PDF | Authenticated |
| `POST` | `/api/v1/technical-tasks/bulk-delete` | Bulk soft-delete technical tasks by array of IDs | `technicaltask.delete` |
| `DELETE`| `/api/v1/technical-tasks/{id}` | Soft-delete technical service task | `technicaltask.delete` |

---

## 5. Spoke Governance & Internal Identity Provisioning (`/internal/users`)

Machine-to-machine internal service endpoints invoked by `ERP_Main` over authenticated HTTP channels (Bearer Token with `X-ERP-Key` / HMAC token validation).

| Method | Endpoint URI | Description | Auth Required |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/v1/internal/users/check` | Inspect whether a user already exists locally by email or username | Internal Service Bearer |
| `POST` | `/api/v1/internal/users/provision` | Provision minimal local account or reactivate previously deactivated account | Internal Service Bearer |
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
| `GET` | `/api/v1/purchase/local-orders` | List local purchases with status counts (`all`, `pending`, `confirmed`), search, warehouse, and date filters | Authenticated |
| `POST` | `/api/v1/purchase/local-orders` | Create local purchase with active Supplier, active physical Warehouse, and active Product lines; server auto-calculates expense loading & landing rates | Authenticated |
| `POST` | `/api/v1/purchase/local-orders/import` | Bulk import multi-line local purchase invoices from `.csv` / `.xlsx` (`file` + optional `column_map` JSON), validating **active** Supplier/Warehouse/Product masters, calculating Expense Factor & Unit Landing Rate (INR) (VB), skipping duplicate Invoice Nos, and isolating row errors via nested DB savepoints | Authenticated |
| `GET` | `/api/v1/purchase/local-orders/{id}` | Inspect detailed local purchase record and items | Authenticated |
| `PUT` | `/api/v1/purchase/local-orders/{id}` | Update pending local purchase lines or invoice expenses | `localpurchase.update` |
| `PATCH` | `/api/v1/purchase/local-orders/{id}/status` | Transition purchase status (`pending` -> `confirmed`); auto-applies physical stock-in movement | `localpurchase.confirm` |
| `DELETE`| `/api/v1/purchase/local-orders/{id}` | Soft-delete local purchase order | Administrator |
| `POST` | `/api/v1/purchase/local-orders/{id}/bill` | Upload scanned invoice bill document | Authenticated |
| `DELETE`| `/api/v1/purchase/local-orders/{id}/bill` | Delete uploaded invoice bill attachment | Authenticated |
| `GET` | `/api/v1/purchase/local-orders/{id}/bill-file` | Stream or view attached bill file | Authenticated |

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

## 9. Sales — Proforma Invoices (`/sales/proforma-invoices`)

| Method | Endpoint URI | Description | Permission Gate |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/sales/proforma-invoices` | List proforma invoices with status tabs, commercial terms, and search | Authenticated |
| `POST` | `/api/v1/sales/proforma-invoices` | Create new proforma invoice with line items, tax breakdown, and commercial terms | Authenticated |
| `GET` | `/api/v1/sales/proforma-invoices/{id}` | Inspect detailed proforma invoice with billing/shipping address and line calculations | Authenticated |
| `PUT` | `/api/v1/sales/proforma-invoices/{id}` | Update editable proforma invoice record | Authenticated |
| `PATCH` | `/api/v1/sales/proforma-invoices/{id}/status` | Move proforma invoice through workflow (`pending` -> `admin_approved` -> `confirmed` or `cancelled`) | `proforma.approve` / Admin |
| `DELETE`| `/api/v1/sales/proforma-invoices/{id}` | Soft-delete proforma invoice record | Administrator |

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
| `POST` | `/api/v1/auth/login` | Local credential authentication returning token pair & profile | Public |
| `POST` | `/api/v1/auth/sso-handover` | Authenticate incoming SSO handover token with mandatory live central session verification against ERP_Main | Public / Handover Token |
| `POST` | `/api/v1/auth/change-password` | Update current user's password and asynchronously push to ERP_Main | Authenticated |
| `POST` | `/api/v1/users/{id}/reset-password` | Administrative password reset and automatic fanout push to ERP_Main | `user.manage` |
| `PATCH` | `/api/v1/users/{id}` | Update user attributes; email is locked to central control plane | `user.update` |
| `POST` | `/api/v1/internal/users/{id}/deprovision` | Invalidate spoke sessions and soft-delete user upon ERP_Main deprovisioning | Internal Service Key |
| `GET` | `/api/v1/organizations/public` | Unauthenticated public branding endpoint returning company name, legal name, and DB-backed versioned logo URL | Public |
| `GET` | `/api/v1/organizations/logo` | Stream company logo binary directly from database (`logo_data`) with `?v={sha1}` version hash for immutable client caching | Public |
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

## 18. Sales — Sales Orders & Sales Process Execution (`/sales/orders`, `/sales/gate-pass`, `/sales/discount-payments`)

| Method | Endpoint URI | Description | Permission Gate |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/sales/orders` | Paginated list of Sales Orders with status tabs, search, warehouse, buyer, and date filters | `saleorder.view` |
| `POST` | `/api/v1/sales/orders` | Create Sales Order defaulting to `pending` status with line items & commercial terms | `saleorder.create` |
| `GET` | `/api/v1/sales/orders/{id}` | Inspect detailed Sales Order record with line items, tax, and address breakdown | `saleorder.view` |
| `PATCH`| `/api/v1/sales/orders/{id}` | Update Sales Order details, line items, and commercial fields | `saleorder.update` |
| `PATCH`| `/api/v1/sales/orders/{id}/status` | Advance Sales Order stage (`pending` -> `sales_confirmed` -> `admin_approved` -> `acc_confirmed` -> `gatepass_created` -> `dispatched` -> `lr`) with PO & Tally Bill metadata | Authenticated (Workflow RBAC) |
| `POST` | `/api/v1/sales/upload-po` | Upload client Purchase Order (PO) document (`inhyma-sales-docs` / `/uploads/private/sales_po/`) | Authenticated |
| `POST` | `/api/v1/sales/upload-tally-bill` | Upload Tally Bill document (`inhyma-sales-docs` / `/uploads/private/sales_tally_bills/`) | Authenticated |
| `POST` | `/api/v1/sales/upload-eway-bill` | Upload E-Way Bill document when `E-Way Bill = Yes` (`inhyma-sales-docs` / `/uploads/private/sales_eway_bills/`) | Authenticated |
| `POST` | `/api/v1/sales/upload-lr` | Upload Lorry Receipt (LR) file (`inhyma-sales-docs` / `/uploads/private/sales_lr/`) | Authenticated |
| `POST` | `/api/v1/sales/upload-dispatch-media` | Upload multiple dispatch photos/videos (`inhyma-sales-docs` / `/uploads/private/sales_dispatch_media/`) | Authenticated |
| `POST` | `/api/v1/sales/orders/{id}/status-with-po` | Atomic multipart status update with optional PO file upload | Authenticated (Workflow RBAC) |
| `DELETE`| `/api/v1/sales/orders/{id}` | Soft-delete Sales Order and revert inventory stock deductions | `saleorder.delete` |
| `POST` | `/api/v1/sales/orders/{id}/restore` | Restore soft-deleted Sales Order (Admin only) | `saleorder.manage` |
| `GET` | `/api/v1/sales/metrics` | Grouped sales order KPI metrics by status tabs | `saleorder.view` |
| `GET` | `/api/v1/sales/next-gatepass-no` | Generate next sequential gate pass reference number | `saleorder.view` |
| `GET` | `/api/v1/sales/planning-consignments` | Extract consignment columns from Shipment Planning sheets for order pre-allocation | `saleorder.view` |
| `GET` | `/api/v1/sales/planning-consignments/{column_id}/items` | Extract planned products and quantities from consignment column | `saleorder.view` |
| `GET` | `/api/v1/sales/export` | Export Sales Orders dataset to Excel spreadsheet | `saleorder.view` |
| `POST` | `/api/v1/sales/gate-pass` | Create dispatch Gate Pass with logistics metadata and transporter carrier | `saleorder.update` |
| `POST` | `/api/v1/sales/orders/{id}/upload-lr` | Attach transporter LR document and multi-photo delivery proof | `saleorder.update` |
| `GET` | `/api/v1/sales/discount-payments` | List under-invoicing cash discount payment ledger entries and multi-installment history | `saleorder.view` |
| `POST` | `/api/v1/sales/discount-payments` | Record discount payment installment settlement (with optional receipt & remarks) | `saleorder.update` |
| `PATCH` | `/api/v1/sales/discount-payments/{payment_id}` | Update existing discount payment installment (amount, mode, date, receipt, remarks) | `saleorder.update` |

> **Sales Process Add/Edit Architecture (`SaleProcessForm.tsx`):**
> - **100% Parity with Proforma Invoice:** Full alignment with Proforma's Add New form structure, validation rules, drawer slides, and calculation engine.
> - **Default Status "Pending":** Newly submitted orders automatically assign `status: "pending"`, ensuring they enter the initial workflow stage cleanly.
> - **Schema Harmonization:** Payload provides dual fields (`buyer_name` + `company_name`, `transport_name` + `transporter_name`, `expected_delivery_date` + `delivery_date`, `city`, `state`) to guarantee total compatibility with FastAPI backend schemas.
> - **Dynamic Masters & Drawers:** Uses `useMasterNames` for live database masters, `ClientNameAutocomplete` with `AddCompanyDrawer`, and `EditAddressDrawer` for non-destructive Billing/Shipping address overrides.
> - **Stock Exceeded Alerts:** Real-time query against `/inventory/product-stock?limit=500` warns users when quantity exceeds available warehouse stock with top banner, in-table alert, red border, and red badge.
> - **Upward Dropdown Positioning (`placement="up"`):** Searchable Comboboxes inside table rows open upward, completely avoiding scrollbar boundary clipping.

---

## 19. Communication — Internal Feed & Broadcast Announcements (`/feed`)

| Method | Endpoint URI | Description | Permission Gate |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/feed/posts` | List scoped feed posts with pagination, search, and department visibility checks | Authenticated |
| `POST` | `/api/v1/feed/posts` | Create new feed post or broadcast with targeted departments/recipients and pin status | Authenticated |
| `GET` | `/api/v1/feed/posts/{id}` | Detailed post record, comments, reaction aggregations, and viewer status | Authenticated |
| `PUT` | `/api/v1/feed/posts/{id}` | Edit post content (creator or administrator only) | Authenticated |
| `DELETE`| `/api/v1/feed/posts/{id}` | Soft-delete post | Authenticated |
| `POST` | `/api/v1/feed/posts/{id}/pin` | Toggle post pinned status | `feed.pin` / Admin |
| `POST` | `/api/v1/feed/posts/{id}/comments` | Post comment on feed entry | Authenticated |
| `DELETE`| `/api/v1/feed/comments/{comment_id}` | Soft-delete comment | Authenticated |
| `POST` | `/api/v1/feed/posts/{id}/reactions` | Toggle emoji reaction on post | Authenticated |
| `POST` | `/api/v1/feed/posts/{id}/mark-read` | Record user read receipt for broadcast compliance | Authenticated |

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
> - **Canonical RBAC System Roles (`/api/v1/rbac/roles`):** Bootstrap seeding (`scripts/seed.py`) provisions strictly two `is_system=True` roles—`super_admin` (`Admin`, holding all `297/297` permissions) and `user` (`User`)—with zero hardcoded business departments.




