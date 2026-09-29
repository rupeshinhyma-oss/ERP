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
| `GET` | `/api/v1/companies/{id}` | Inspect detailed profile (10 extended fields, social media matrix) | `company.view` |
| `PATCH` | `/api/v1/companies/{id}` | Update company details, credit terms, and intelligence | `company.update` |
| `DELETE`| `/api/v1/companies/{id}` | Soft-delete company record and linked contacts | `company.delete` |
| `PATCH` | `/api/v1/companies/{id}/grade` | Inline update corporate grade (A, B, C, D) | `company.update` |
| `PATCH` | `/api/v1/companies/{id}/potential` | Inline update revenue potential rating (High, Medium, Low) | `company.update` |
| `POST` | `/api/v1/companies/{id}/contacts` | Add sub-contact person to roster | `company.update` |
| `POST` | `/api/v1/companies/import` | Bulk Excel/CSV import wizard | `company.import` |
| `GET` | `/api/v1/companies/export` | Export company records to Excel/CSV | `company.export` |

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

