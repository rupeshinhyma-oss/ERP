# Yinglima_ERP — API Design & Endpoints Specification

**Service Base URL:** `http://localhost:8001/api/v1`  
**Authentication Scheme:** Bearer JWT (HS256) & Tokenized Portal URLs  
**Standard Response Envelope:** `{ "success": true, "data": ..., "meta": ..., "error": null }`

---

## 1. Suppliers & Vendor Management (`/suppliers`)

| Method | Endpoint URI | Description | Permission Gate |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/suppliers` | List paginated Chinese suppliers with ratings and search | `supplier.view` |
| `POST` | `/api/v1/suppliers` | Create supplier profile with WeChat, tax, and bank accounts | `supplier.create` |
| `GET` | `/api/v1/suppliers/{id}` | Inspect detailed supplier record and media attachments | `supplier.view` |
| `PATCH` | `/api/v1/suppliers/{id}` | Update supplier profile, factory location, or credit terms | `supplier.update` |
| `DELETE`| `/api/v1/suppliers/{id}` | Soft-delete supplier profile | `supplier.delete` |
| `POST` | `/api/v1/suppliers/{id}/media` | Upload factory visit photo/video to Supabase Storage | `supplier.update` |

---

## 2. Inquiries, RFQs & Quotations (`/inquiries`)

| Method | Endpoint URI | Description | Permission Gate |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/inquiries` | List RFQ inquiries with stage status and consignments | `inquiry.view` |
| `POST` | `/api/v1/inquiries` | Create new RFQ inquiry for multi-vendor sourcing | `inquiry.create` |
| `GET` | `/api/v1/inquiries/{id}` | Inspect inquiry items, quotes matrix, and email thread | `inquiry.view` |
| `POST` | `/api/v1/inquiries/{id}/quotations` | Manually enter supplier quote | `inquiry.update` |
| `GET` | `/api/v1/inquiries/{id}/matrix` | Quotation comparison matrix comparing MOQ, price, lead time | `inquiry.view` |
| `POST` | `/api/v1/inquiries/{id}/send-rfq` | Dispatch automated RFQ emails to selected vendors | `inquiry.update` |

---

## 3. Public Vendor Quotation Portal (`/portal`)

| Method | Endpoint URI | Description | Auth Required |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/portal/quote/{token}` | Load RFQ specifications for external supplier | Tokenized URL |
| `POST` | `/api/v1/portal/quote/{token}` | Submit vendor pricing, lead time, and PDF attachment | Tokenized URL |

---

## 4. Master Shipment Planning Sheets (`/planning`)

| Method | Endpoint URI | Description | Permission Gate |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/planning/sheets` | List container planning workbooks | `planning.view` |
| `POST` | `/api/v1/planning/sheets` | Create new container shipment planning workbook | `planning.create` |
| `GET` | `/api/v1/planning/sheets/{id}` | Retrieve dynamic sheet rows, columns, and CBM sums | `planning.view` |
| `PATCH` | `/api/v1/planning/cells` | Batch cell update with optimistic concurrency | `planning.update` |

---

## 5. Spoke Governance & Internal Deprovisioning

| Method | Endpoint URI | Description | Auth Required |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/v1/internal/users/{id}/deprovision` | Invalidate sessions and soft-delete user record upon control plane deprovisioning | Internal Service Key |

---

## 6. Authentication, SSO Handover & Identity Federation (`/auth`, `/users`, `/organizations`)

| Method | Endpoint URI | Description | Auth Required |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/v1/auth/login` | Local credential authentication returning token pair & profile | Public |
| `POST` | `/api/v1/auth/sso-handover` | Authenticate incoming SSO handover token with mandatory live central session verification against ERP_Main | Public / Handover Token |
| `POST` | `/api/v1/auth/change-password` | Update current user's password and asynchronously push to ERP_Main | Authenticated |
| `POST` | `/api/v1/users/{id}/reset-password` | Administrative password reset and automatic fanout push to ERP_Main | `user.manage` |
| `PATCH` | `/api/v1/users/{id}` | Update user attributes; email is locked to central control plane | `user.update` |
| `GET` | `/api/v1/organizations/public` | Unauthenticated public branding endpoint returning company name, legal name, and logo | Public |

