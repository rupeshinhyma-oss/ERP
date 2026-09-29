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
