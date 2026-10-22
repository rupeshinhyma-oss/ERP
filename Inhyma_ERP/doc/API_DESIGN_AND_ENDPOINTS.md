# Inhyma_ERP — API Design & Endpoints Specification

**Service Base URL:** `http://localhost:8002/api/v1`  
**Authentication Scheme:** Bearer JWT (HS256) & WebSocket Query Tokens  
**Standard Response Envelope:** `{ "success": true, "data": ..., "meta": ..., "error": null }`

---

## 1. Companies & B2B Directory (`/companies`)

| Method | Endpoint URI | Description | Permission Gate |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/companies` | List paginated companies with grade, potential, and search filters | `company.view` |
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
| `GET` | `/api/v1/masters/states/lookup` | List all states/provinces | Authenticated |
| `GET` | `/api/v1/masters/districts/lookup` | List districts filtered by `state_id` query param | Authenticated |
| `GET` | `/api/v1/masters/cities/lookup` | List cities filtered by `district_id` and `state_id` query params | Authenticated |
| `POST` | `/api/v1/masters/cities` | Create new city with `state_id` and `district_id` references | `city.create` |

---

## 3. Inventory & Stock Adjustments (`/inventory`)

| Method | Endpoint URI | Description | Permission Gate |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/inventory/stock-adjustment` | Paginated stock adjustment vouchers with type/date filters | `product.view` |
| `GET` | `/api/v1/inventory/stock-adjustment/{id}` | Detailed voucher with multi-product line items | `product.view` |
| `POST` | `/api/v1/inventory/stock-adjustment` | Create adjustment voucher and update warehouse balances | `product.create` |
| `DELETE`| `/api/v1/inventory/stock-adjustment/{id}`| Soft-delete voucher and reverse inventory adjustments | `product.delete` |
| `GET` | `/api/v1/adjustment/adjustment-order-pdf/{id}` | Stream A4 adjustment order PDF document | `product.view` |

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
| `POST` | `/api/v1/purchase/local-orders` | Create local purchase with multi-product lines; server auto-calculates expense loading & landing rates | Authenticated |
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
| `POST` | `/api/v1/purchase/import-orders` | Create import consignment with exchange rates, duty %, shipping, and dual VB/CB landing calculations | Authenticated |
| `POST` | `/api/v1/purchase/import-orders/preview` | Live preview calculation of CBM, duty, and landing expenses while typing in form | Authenticated |
| `GET` | `/api/v1/purchase/import-orders/{id}` | Inspect detailed consignment record, line items, and landed costs | Authenticated |
| `PUT` | `/api/v1/purchase/import-orders/{id}` | Update pending import consignment details or product lines | Authenticated |
| `PATCH` | `/api/v1/purchase/import-orders/{id}/status` | Move consignment through workflow (`pending` -> `confirmed` -> `received` -> `closed`) | Authenticated / Admin |
| `DELETE`| `/api/v1/purchase/import-orders/{id}` | Soft-delete import consignment order | Authenticated / Admin |
| `POST` | `/api/v1/purchase/import-orders/{id}/bill` | Upload consignment document / shipping bill | Authenticated |
| `DELETE`| `/api/v1/purchase/import-orders/{id}/bill` | Delete uploaded consignment document | Authenticated |
| `GET` | `/api/v1/purchase/import-orders/{id}/bill-file` | Stream or download original uploaded invoice/bill file (supports query `?token=<access_token>` and `?download=true`) | Authenticated |

> **Bill File Streaming & Zero-Synthetic-PDF Policy:**
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

