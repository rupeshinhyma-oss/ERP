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
| `GET` | `/api/v1/technical-tasks` | List service tickets by status tab and priority | `technicaltask.view` |
| `GET` | `/api/v1/technical-tasks/counts` | Status tab badge counts (Pending, Allotted, Under Process, etc.) | `technicaltask.view` |
| `POST` | `/api/v1/technical-tasks` | Create field service ticket / breakdown maintenance call | `technicaltask.create` |
| `GET` | `/api/v1/technical-tasks/{id}` | Inspect detailed service ticket | `technicaltask.view` |
| `PATCH` | `/api/v1/technical-tasks/{id}` | Update machine details, problem notes, or scheduled visit | `technicaltask.update` |
| `PATCH` | `/api/v1/technical-tasks/{id}/status` | Transition ticket status with resolution remarks | `technicaltask.update` |
| `DELETE`| `/api/v1/technical-tasks/{id}` | Soft-delete technical service task | `technicaltask.delete` |

---

## 5. Spoke Governance & Internal Deprovisioning

| Method | Endpoint URI | Description | Auth Required |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/v1/internal/users/{id}/deprovision` | Invalidate sessions and soft-delete user record upon control plane deprovisioning | Internal Service Key |

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
| `GET` | `/api/v1/purchase/import-orders/{id}/bill-file` | Stream or download consignment document | Authenticated |

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
| `GET` | `/api/v1/organizations/public` | Unauthenticated public branding endpoint returning company name, legal name, and logo | Public |


