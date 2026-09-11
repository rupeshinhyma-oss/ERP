# ERP_Main Frontend — Global Control Plane

> **ERP_Main uses the existing Yinglima/Inhyma frontend UI language as its visual/product baseline while remaining a separate control-plane application.**

The `ERP_Main` frontend provides the unified user interface for the global control plane. It shares the same visual identity, typography, CSS tokens, layout conventions, tables, badges, modals, and navigation patterns as **Yinglima ERP** and **Inhyma ERP**, but has an entirely different scope of responsibility:

- **Global ERP Registry & Instance Management**
- **Authorized "My ERPs" Launcher with PKCE SSO**
- **Unified Global User & Platform Admin Authentication**
- **Decentralized Session Management & Periodic Expiry Guard**
- **Global User Identity Directory & Provisioning (Prompt 5)**
- **ERP Membership Bindings, Lifecycle Operations & Safe Unlinking (Prompt 5)**
- **Platform RBAC Roles, Permissions Catalog & Assignment Matrix (Prompt 5)**
- **Identity Linking Conflict Resolution Queue (Prompt 5)**
- **Integration & Cross-ERP Operations Control Plane (Prompt 6)**
- **Transactional Outbox & Inbox Architecture Monitoring (Prompt 6)**
- **Dead-Letter Recovery & Operational Replay (Prompt 6)**
- **Buyer Projection Reconciliation & Drift Detection (Prompt 6)**
- **Safe Server-Sanitized Event Payload Inspection (Prompt 6)**
- **Global Audit Log Explorer**
- **Global Projections Reporting & Export Jobs**
- **Federated Cross-ERP Search**

---

## Integration & Event Mesh Architecture (Prompt 6)

```text
 ┌───────────────────────────┐         ┌───────────────────────────┐
 │       Yinglima ERP        │         │        Inhyma ERP         │
 │                           │         │                           │
 │  Local Business Tx        │         │  Local Business Tx        │
 │  ┌─────────────────────┐  │         │  ┌─────────────────────┐  │
 │  │ Transactional       │  │         │  │ Transactional       │  │
 │  │ Outbox Table        │  │         │  │ Outbox Table        │  │
 │  └──────────┬──────────┘  │         │  └──────────┬──────────┘  │
 └─────────────┼─────────────┘         └─────────────┼─────────────┘
               │  Async Push (HMAC-SHA256)           │  Async Push (HMAC-SHA256)
               ▼                                     ▼
 ┌─────────────────────────────────────────────────────────────────┐
 │                   ERP_Main Control Plane                        │
 │                                                                 │
 │   POST /global/integration/events                               │
 │   ┌─────────────────────────────────────────────────────────┐   │
 │   │ Idempotent Inbox (SHA-256 deduplication & sequencing)   │   │
 │   └─────────────┬───────────────────────────────────────────┘   │
 │                 │                                               │
 │                 ├─────────► Subscriptions Routing Engine        │
 │                 │           (buyer.created -> Projection Sync)  │
 │                 │                                               │
 │                 ├─────────► Dead-Letter Queue                   │
 │                 │           (Terminal failures, replayable)     │
 │                 ▼                                               │
 │   Control Plane Operators UI (/integration)                     │
 │   - Fleet Health & Projection Sync Lag                          │
 │   - Filterable Events Directory & Trace by Correlation ID       │
 │   - Dead-Letter Diagnostic Drawer & Real Replay                 │
 │   - Subscriptions Rule Engine Management                        │
 │   - Projection Reconciliation (Drift Detection)                 │
 └─────────────────────────────────────────────────────────────────┘
```

1. **Decoupled Local Databases & Event Independence**:
   - Neither Yinglima nor Inhyma exposes direct database connections or foreign keys to ERP_Main.
   - Events are written transactionally into each ERP's local outbox table atomically with business mutations, then dispatched asynchronously over HTTPS to `POST /global/integration/events`.
2. **Idempotency & Deduplication**:
   - Incoming events are indexed by unique `(producer_erp_id, event_id)`. Duplicate arrivals return HTTP 200 with `status: "IGNORED"` and duplicate explanation.
3. **Payload Inspection Guardrails**:
   - Payloads inspected in the UI are recursively masked on the server (`_sanitize_payload`), stripping tokens, passwords, API keys, and credentials before reaching the browser.
   - Payload rendering uses strict text `pre` elements, forbidding raw HTML execution.
4. **Zero Fake Capabilities**:
   - Outbox counts of external ERPs are honestly displayed as `Unknown` unless specifically provided via dedicated local health endpoints.
   - Dead letter replay invokes `POST /global/integration/dead-letters/{id}/replay` directly against the control plane backend.

---

## Identity Decoupling & Platform RBAC Architecture (Prompt 5)

```text
               ┌────────────────────────────────────────────────────────┐
               │             ERP_Main Control Plane                     │
               │                                                        │
               │   GlobalUser (UUID)  ── holding ──>  Platform Roles    │
               │         │                           (GLOBAL / ERP)     │
               └─────────┼──────────────────────────────────┬───────────┘
                         │                                  │
                   ErpMembership                    Platform RBAC
                   (Identity Link)                  (Control Plane APIs)
                         │                                  │
       ┌─────────────────┴─────────────────┐                │
       ▼                                   ▼                ▼
┌─────────────────────────┐     ┌─────────────────────────┐ ┌──────────────┐
│  Yinglima ERP           │     │  Inhyma ERP             │ │ Control-     │
│                         │     │                         │ │ Plane Actions│
│  Local User: loc_001    │     │  Local User: inhy_999   │ │ (Audits,     │
│  Local RBAC:            │     │  Local RBAC:            │ │  Federation, │
│  - INVENTORY_MANAGER    │     │  - SALES_DIRECTOR       │ │  Fleet Reg)  │
│  - FINANCIAL_OFFICER    │     │  - DISPATCHER           │ └──────────────┘
└─────────────────────────┘     └─────────────────────────┘
```

1. **GlobalUser ≠ ErpMembership ≠ Local ERP User**:
   - `GlobalUser`: Global human identity managed in the control plane.
   - `ErpMembership`: Binding record associating one Global User with one local account identifier (`local_user_id`) in a specific ERP instance.
   - `Local ERP User`: Authoritative business account in the target ERP database.
2. **Authoritative Local RBAC**:
   - Business authorizations (purchase orders, warehouse stock, quoting rules, ledger access) remain strictly inside the local ERP.
   - Platform roles grant permissions *only* over control plane endpoints (`platform.users.*`, `platform.erp.*`, `platform.authz.*`, `platform.audit.*`).
3. **Safe Unlinking**:
   - Severing an `ErpMembership` unlinks the global SSO association but preserves the local ERP user account in the target database intact.

---

## Directory & Folder Structure

```text
ERP/ERP_Main/frontend/
├── index.html                   # HTML entry point (Inter & Plus Jakarta Sans fonts)
├── package.json                 # React 18, Vite 5, TypeScript 5.6, Vitest
├── tsconfig.json                # TypeScript project references
├── tsconfig.app.json            # Strict TypeScript configuration for src/
├── tsconfig.node.json           # Node configuration for vite.config.ts
├── vite.config.ts               # Vite bundler, @ alias, proxy to backend
├── vitest.config.ts             # Vitest with JSDOM test runner
├── .env.example                 # Environment variables template
├── .gitignore                   # Git ignore patterns
├── public/
│   ├── favicon.svg              # Control plane brand icon
│   ├── logo.png                 # Platform brand logo
│   └── login-illustration.png   # Login visual illustration
└── src/
    ├── index.css                # Base resets and root styling
    ├── styles/
    │   ├── style.css            # Reused design tokens, layout shell, badges, tables, modals
    │   └── control-plane.css    # Control-plane launcher cards, sync grid, tabs, audit panels
    ├── types/
    │   └── index.ts             # TypeScript interfaces: instances, users, federation, integration, outbox
    ├── lib/
    │   ├── api.ts               # Centralized HTTP client, auth bearer interceptor, 401 handler
    │   ├── auth.ts              # Session storage, dual-principal detection, reactive subscribers
    │   ├── session.tsx          # GlobalSessionProvider, useGlobalSession, expiry dialog
    │   ├── federation.ts        # PKCE S256 generator, cryptographic state, URL validator
    │   ├── nav.ts               # Navigation items tree and page titles
    │   ├── brand.ts             # Platform branding resolver
    │   ├── hooks.ts             # useAuth, usePageTitle, useDebounce, useModal
    │   └── toast.tsx            # Declarative toast notification provider
    ├── components/
    │   ├── AppShell.tsx         # Header, responsive sidebar, user dropdown, breadcrumbs
    │   ├── Breadcrumb.tsx       # Navigation trail
    │   ├── Pagination.tsx       # Table pagination controls
    │   ├── ErrorBoundary.tsx    # Uncaught render error boundary
    │   ├── icons.tsx            # SVG icon catalog matching ERP style
    │   └── ui.tsx               # StatusBadge, Banner, Modal, ConfirmDialog, LoadingSpinner, EmptyState
    ├── pages/
    │   ├── Login.tsx            # Split-layout Global & Platform Admin Sign In
    │   ├── ErpLauncher.tsx      # "My ERPs" authorized launcher grid with PKCE SSO
    │   ├── AuthCallback.tsx     # SSO Return handler with CSRF state verification
    │   ├── Dashboard.tsx        # Control Plane KPIs, fleet status, projection health, audit feed
    │   ├── ErpRegistry.tsx      # Registered ERP fleet management, register modal, decommission
    │   ├── ErpDetail.tsx        # Detailed ERP inspection: capabilities, members, heartbeat
    │   ├── GlobalUsers.tsx      # Global identity directory, status transitions, Flow A provisioning, access summary
    │   ├── Memberships.tsx      # ERP membership bindings, lifecycle actions (verify, suspend, restore, revoke), safe unlink
    │   ├── IdentityConflicts.tsx# Resolution queue for ambiguous and conflicting identity matches
    │   ├── PlatformAuthz.tsx    # Platform roles, permissions catalog, grant/revoke matrix, and user assignments
    │   ├── IntegrationEvents.tsx# 5-Tab Control Plane: Fleet Health, Events Directory, Dead Letters, Subscriptions, Reconciliation
    │   ├── GlobalAudit.tsx      # Centralized audit log with filter search and payload drawer
    │   ├── Reporting.tsx        # Global Buyer Projections overview and export jobs (CSV/XLSX)
    │   ├── Search.tsx           # Federated cross-ERP entity search with freshness tracking
    │   ├── Health.tsx           # Platform health, signing domain info, architectural guardrails
    │   └── Forbidden.tsx        # 403 Access Denied presentation
    ├── tests/
    │   ├── Auth.test.ts         # Token storage, profile notify, dual principals, role labels
    │   ├── GlobalLogin.test.tsx # Split layout, password toggle, dual authentication flows
    │   ├── GlobalSession.test.tsx # Session provider, expiration tracking, sign in again dialog
    │   ├── FederationLauncher.test.tsx # PKCE generation, open-redirect protection, URL builder
    │   ├── AuthCallback.test.tsx # State validation, callback handling, session restore
    │   ├── ErpLauncher.test.tsx # Authorized launcher cards and launch buttons
    │   ├── UIStates.test.tsx    # Status badges, banners, spinners, empty states
    │   ├── AppShell.test.tsx    # Auth guard, sidebar navigation, brand rendering
    │   ├── ErpRegistry.test.tsx # Registry table and API integration
    │   ├── IdentityConflicts.test.tsx # Conflict resolution queue triggers
    │   ├── GlobalUsers.test.tsx # Global user directory, filters, create with primary_email, access summary
    │   ├── Memberships.test.tsx # Membership bindings, lifecycle actions, safe unlinking
    │   ├── PlatformAuthz.test.tsx # Roles, permissions catalog, user role assignments, permission matrix
    │   ├── IntegrationEvents.test.tsx # 5 tabs: Fleet health, filters, trace correlation, drawer inspection, replay, reconciliation
    │   ├── Dashboard.test.tsx       # Live KPIs, fleet health cards, lag checks, rebuild modal
    │   ├── Search.test.tsx          # Federated search, entity types, inspection drawer, deep link disabled
    │   ├── Reporting.test.tsx       # Available reports, buyer directory, honest pending exports, reconciliation
    │   └── GlobalAudit.test.tsx     # Categorized audit trail, search, slide-out drawer
    ├── App.tsx                  # GlobalSessionProvider wrapper, route table, 401 interceptor
    └── main.tsx                 # React DOM mount point
```

---

## Security & Architecture Guardrails

- **PKCE Flow**: Every launch handshake uses RFC 7636 Proof Key for Code Exchange using SHA-256 (`code_challenge_method=S256`).
- **Cryptographic State Parameter**: High-entropy cryptographically random state parameter stored in `sessionStorage` preventing Cross-Site Request Forgery (CSRF).
- **Strict Redirect URI Validation**: Outbound redirect URIs are strictly validated against registered ERP instance `base_url` origins, prohibiting open-redirect attacks (`javascript:`, external domain hijacking, or protocol mismatch).
- **Zero Credentials in Transit**: Authorization codes are ephemeral (10-minute single-use). Access tokens and credentials never appear in query strings or browser history.
- **Server-Side Payload Redaction**: Sensitive fields (`password`, `token`, `secret`, `key`, `authorization`, `credential`) are recursively stripped from integration payloads before returning to the browser.
- **Decoupled Local Autonomy**: Direct `/auth/login` workflows inside Yinglima and Inhyma ERP remain independent and functional.
- **Safe Unlinking**: Removing an identity binding leaves the target ERP account intact.
- **Honest Asynchronous Exports (Section 16)**: Report export jobs reflect genuine backend `PENDING` state with disabled download action; zero fake files or client-side synthetic downloads.
- **Zero Cross-DB Queries**: ERP_Main reads exclusively from control plane projections; zero cross-database queries or foreign keys to Yinglima/Inhyma databases.

---

## Development & Build Commands

All commands can be run via npm:

```bash
# Install dependencies
npm install

# Run typecheck
npm run typecheck

# Run unit and component tests (18 test suites, 67 tests)
npm test -- --run

# Build production bundle
npm run build

# Run local development server
npm run dev
```

> **Windows Shell Note**: When running on Windows systems where PowerShell script execution is restricted, execute npm commands via `cmd.exe /c "npm ..."`.

