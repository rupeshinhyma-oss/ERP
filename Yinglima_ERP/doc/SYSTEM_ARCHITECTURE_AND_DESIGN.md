# Yinglima_ERP — System Architecture & Design Specification

**System Role:** China Sourcing, Procurement, Vendor Quotations & Master Shipment Planning  
**Architecture Type:** Modular Async Monolith (FastAPI) + React 18 SPA (Vite) + Outbox Engine  
**Database:** PostgreSQL (Supabase Cloud Pooler / Dedicated Database Schema)  
**Location:** `Yinglima_ERP/`

---

## 1. System Topology & Architectural Pattern

`Yinglima_ERP` powers China vendor procurement, automated quotation extraction, RFQ management, and container shipment planning.

```mermaid
flowchart TD
    subgraph Client["Client Tier (React 18 SPA - Port :5173)"]
        UI["React 18 Dashboard & Drawers"]
        BL["Autocomplete & Autofill Blocker"]
        WL["Wheel Scroll Value Lockout"]
        SW["Ecosystem Switcher Component"]
    end

    subgraph AppTier["FastAPI Application Tier (Port :8001)"]
        SUP["Suppliers & Media Directory"]
        RFQ["Inquiries & RFQ Lifecycle"]
        AI_EXT["AI Quotation Extractor (GPT-4o/Gemini)"]
        PLAN["Shipment Planning Grid Engine"]
        OUT["Transactional Outbox Engine"]
        DEP["Internal Deprovisioning Endpoint"]
    end

    subgraph External["External Services & Integrations"]
        CP["ERP_Main Control Plane"]
        IMAP["IMAP Mailbox Poller"]
        PORTAL["Tokenized Public Supplier Portal"]
    end

    UI --> SUP
    UI --> RFQ
    UI --> PLAN
    IMAP --> AI_EXT
    AI_EXT --> RFQ
    PORTAL --> RFQ
    RFQ --> OUT
    OUT -. Synchronize .-> CP
    CP -. Deprovision RPC .-> DEP
```

---

## 2. Core Domain Architectures

### 2.1 Suppliers & Factory Media Directory
- Vendor catalog tracking Chinese suppliers, factory locations, English/Chinese names, WeChat/WhatsApp contacts, bank accounts, and tax numbers.
- Factory visit media persistent storage (photos, inspection videos) via Supabase Storage.

### 2.2 Inquiries, RFQs & AI Quotation Extractor
- Inbound IMAP email poller monitoring supplier responses to RFQs.
- **Zero Wasted API Calls:** First supplier reply triggers AI extraction; subsequent negotiation emails bypass AI and append directly to the email timeline.
- Dynamic quotation matrix comparing multi-vendor pricing, lead times, MOQ, and terms.
- Public tokenized submission portal for direct vendor quote input without ERP login.

### 2.3 Master Shipment Planning Grid Engine
- Dynamic spreadsheet-like planning grid for container optimization (20GP, 40GP, 40HQ, 45HQ).
- Automated CBM and gross weight calculations with status tagging per cell/row.

### 2.4 Transactional Outbox Engine
- Guaranteed event delivery to `ERP_Main` for global reporting and projections without two-phase commit overhead.

### 2.5 Commercial Invoice (CI) 16-Column Costing Engine & Local Purchase Sourcing
- **Confirmed Local Purchase Source of Truth:** Sourcing and purchase pricing for Sale Process orders automatically pull from the latest confirmed Local Purchase order for that product.
- **Dynamic VAT Exclusion & Export Costing:** Uses HSN Refund VAT rates (standard 13%) to dynamically compute `Unit Price Excl. VAT = Unit Price Incl. VAT / (1 + Refund VAT%)`, FOB Price (USD), container freight allocation per CBM, CFR unit prices, and supplier payables matching the official 16-column Excel export model.

### 2.6 Federated Authentication, Central Verification & Password Synchronization
- **Central Session Routing & Graceful Login:** Spoke login authenticates locally and simultaneously establishes an ecosystem session with `ERP_Main`. If a user is not authorized for Yinglima, they are redirected automatically to their assigned spoke or to the Central Control Plane. If a recent password change hasn't synced locally, the verified central session completes authentication via SSO handover.
- **Bi-Directional Password Synchronization:** Local password changes (`/auth/change-password` and `/users/{id}/reset-password`) are securely transmitted to `ERP_Main` via `POST /internal/users/password` using internal service credentials, fanning out updates across the ecosystem.
- **Fail-Closed Central Session Verification:** Inbound SSO handover logins verify the central session against ERP_Main's live database via `verify_ecosystem_session()`. Revoked or suspended accounts cannot bypass security checks.
- **Central Identity Protection:** User email addresses are locked to the central control plane (`enforce_central_identity`), preventing local edits from breaking global SSO mappings.

---

## 3. Frontend Architecture & Platform Hardening

### 3.1 Global Autocomplete & Autofill Blocker (`lib/autocompleteBlocker.ts`)
- Continuously enforces `autocomplete="off"`, `autocapitalize="off"`, `spellcheck="false"`, `data-lpignore="true"` (LastPass blocker), and `data-form-type="other"` (heuristics disabler) across all DOM elements via a `MutationObserver`.
- Capture-phase `focusin` listener intercepts user interactions before browser suggestion popups render, permanently suppressing floating suggestion bubbles.

### 3.2 Wheel Scroll Value Lockout & Spin-Button Elimination
- Document-level passive `wheel` listener blurs `input[type="number"]` elements on mouse wheel scroll.
- Universal CSS removes webkit outer/inner spin buttons and sets `-moz-appearance: textfield`.

### 3.3 SSO Handover & Identity Preservation
- `ssoBridge.ts` passes the active authenticated user's email and first name during ERP switching, preventing unintended admin fallback.

### 3.4 Cascading Category Hierarchy Enforcement
- In `Products.tsx`, `Suppliers.tsx`, `Buyers.tsx`, and `SearchableDropdown.tsx`, subcategory options are strictly locked until a primary category is selected. Changing or clearing a category automatically resets linked subcategories.

---

## 4. Directory Layout

```
Yinglima_ERP/
├── backend/
│   ├── app/
│   │   ├── suppliers/            # Supplier directory & visit media
│   │   ├── inquiries/            # Inquiries, RFQs, quotation comparison
│   │   ├── planning/             # Container shipment planning sheets
│   │   ├── email_poller/         # IMAP inbound quote poller
│   │   ├── quotation_extractor/  # AI extraction pipeline (OpenAI/Gemini)
│   │   ├── outbox/               # Transactional outbox publisher
│   │   └── api/v1/internal_users.py # Spoke user deprovisioning endpoint
│   ├── alembic/                  # Database migrations
│   └── tests/                    # Backend test suites
├── frontend/
│   ├── src/
│   │   ├── components/           # EcosystemSwitcher, UI tokens
│   │   ├── lib/                  # autocompleteBlocker.ts, ssoBridge.ts
│   │   ├── pages/                # Suppliers, Inquiries, PlanningSheets
│   │   ├── App.tsx               # App lifecycle & blocker initialization
│   │   └── main.tsx              # Wheel scroll lockout listener
│   └── package.json
└── doc/                          # System documentation
```

---

## 5. Machine Identifiers vs. Dynamic Human Branding

To achieve complete decoupling between infrastructure routing and organizational branding:

1. **Unique Machine Identifier (`erp-02`):**
   - The backend instance identifier `ERP_INSTANCE_ID = "erp-02"` is defined in [`backend/app/core/config.py`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Yinglima_ERP/backend/app/core/config.py).
   - Used for inter-ERP service-to-service authentication, health reporting, and identity sync across the ecosystem.

2. **Public Branding Contract (`GET /organizations/public`):**
   - Unauthenticated endpoint serving `{ company_name, legal_name, logo_url, erp_id }`.
   - Allows client applications, login pages, and browser tab titles to resolve branding dynamically before authentication.

3. **Dynamic Single Source of Truth (`ERP Settings -> Company Name`):**
   - The human-facing brand name is never hardcoded in source files.
   - All frontend components, public supplier quotation pages, and sales order forms query `getCachedBrandName()`, which stays synchronized with the active record in the `organizations` database table.

---

## 6. Database Connection Resilience & Production Security

1. **PgBouncer / Supabase Transaction Pooler Statement Cache Auto-Disable:**
   - In [`app/database/engine.py`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Yinglima_ERP/backend/app/database/engine.py), `_statement_cache_must_be_disabled()` automatically detects port 6543 / PgBouncer and sets `statement_cache_size=0` on asyncpg, preventing PostgreSQL `DuplicatePreparedStatementError`.
2. **Production HTTPS Origin Protection & Mixed Content Elimination:**
   - In [`ecosystemSession.ts`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Yinglima_ERP/frontend/src/lib/ecosystemSession.ts) and [`ssoBridge.ts`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Yinglima_ERP/frontend/src/lib/ssoBridge.ts), `isLocalhost()` guards prevent fallback to insecure `http://localhost:*` URLs when served on HTTPS domains (Render, custom domains).

