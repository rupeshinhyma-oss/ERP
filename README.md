# Multi-ERP Enterprise Platform

A distributed, federated multi-ERP ecosystem engineered for high-availability international procurement, domestic distribution, and global analytical oversight.

---

## 1. System Ecosystem

The ecosystem comprises three autonomous systems:

1. **`ERP_Main` (`/ERP_Main`)**
   - Central Control Plane, Identity Provider & Global Reporting Hub
   - FastAPI Backend (Port `8000`), React + TypeScript SPA Frontend (Port `5170`)
   - OIDC Federation Authority, Global ERP Registry, Platform RBAC, Event Inbox, Real-Time Projections, Multi-Entity Search, Secure CSV/XLSX Export Engine.

2. **`Yinglima_ERP` (`/Yinglima_ERP`) — Spoke Machine ID `erp-02`**
   - Autonomous Procurement & Sourcing ERP (China Export / Factory Sourcing)
   - FastAPI Backend (Port `8001`), React + TypeScript SPA Frontend (Port `5173`)
   - Dynamic branding resolved from `ERP Settings -> Company Name` via unauthenticated contract `GET /organizations/public`.
   - Local Argon2id Auth, Buyers, Suppliers, Master Data, Inquiries/RFQs, Vendor Quotations, Planning Sheets with MUM group tracking, Transactional Outbox, Relying-Party SSO Client, Standalone Background Queue Worker.

3. **`Inhyma_ERP` (`/Inhyma_ERP`) — Spoke Machine ID `erp-01`**
   - Autonomous Production Planning & Distribution ERP (India Domestic Distribution)
   - FastAPI Backend (Port `8002`), React + TypeScript SPA Frontend (Port `5174`)
   - Complete visual uniqueness across all 39 sidebar routes with dedicated SVG icons.
   - Dynamic branding resolved from `ERP Settings -> Company Name` via unauthenticated contract `GET /organizations/public`.
   - Local Argon2id Auth, Enterprise Tasks Module v2 (Jira-style boards, recurring tasks daemon worker, escalations, holds), CRM Full Suite (Pipelines, Kanban, Bulk Import, Round-Robin Distribution, Branded Quotations Engine), Local & Import Purchase with Real Bill Streaming, Master Data, Inquiries, Planning Sheets, Transactional Outbox, Standalone Background Queue Worker.

---

## 2. Cloud Database Platform (Supabase SQL / PostgreSQL)

All three systems connect to separate, isolated databases on **Supabase PostgreSQL** (`aws-0-ap-south-1`):
- `ERP_Main` $\rightarrow$ Dedicated Supabase Project (`dwdqigpvkciolblcddcf`)
- `Yinglima_ERP` $\rightarrow$ Dedicated Supabase Project (`mpvzjzunkiqchhhvxrza`)
- `Inhyma_ERP` $\rightarrow$ Dedicated Supabase Project (`kkqxkgdrmvnnvptpjpmi`)

**Key Invariants:**
- **Zero Cross-Database Coupling:** Dedicated Supabase database/schema boundaries; no shared connections, cross-database queries, or cross-database foreign keys.
- **Connection Architecture:** Standard asyncpg / SQLAlchemy async pooler connection (`aws-0-ap-south-1.pooler.supabase.com:5432`). Prepared statement caching disabled when utilizing transaction pooler modes (`DATABASE_DISABLE_STATEMENT_CACHE=true`).
- **Connection Budgeting:** Total peak ecosystem connection utilization is under 15% of the Supabase pooled connection limits.

---

## 3. Project Documentation Library

Documentation is distributed across each dedicated system repository:

### A. Central Control Plane (`ERP_Main`)
Located in **[`ERP_Main/docs/`](ERP_Main/docs/)**:
- **[System Architecture & Design](ERP_Main/docs/SYSTEM_ARCHITECTURE_AND_DESIGN.md)** — Control plane topology, OIDC authority, JWKS key management, and projections engine.
- **[API Design & Endpoints](ERP_Main/docs/API_DESIGN_AND_ENDPOINTS.md)** — Complete endpoint reference for central auth, global users, roles, registry, and OIDC.
- **[Changelog & Function Changes](ERP_Main/docs/CHANGELOG_AND_FUNCTION_CHANGES.md)** — Detailed history of updates, autocomplete blocker, wheel lockout, and access governance.
- **[Disaster Recovery & Runbooks](ERP_Main/docs/DISASTER_RECOVERY_AND_RUNBOOKS.md)** — Operational recovery playbooks and key rotation procedures.

### B. India Distribution & Production (`Inhyma_ERP`)
Located in **[`Inhyma_ERP/doc/`](Inhyma_ERP/doc/)**:
- **[System Architecture & Design](Inhyma_ERP/doc/SYSTEM_ARCHITECTURE_AND_DESIGN.md)** — Distribution topology, B2B company intelligence, CRM architecture, recurring tasks engine, and cascading geography.
- **[API Design & Endpoints](Inhyma_ERP/doc/API_DESIGN_AND_ENDPOINTS.md)** — REST API specifications for CRM, Recurring Tasks, Purchase Orders, Companies, Masters, Inventory, and Technical Tasks.
- **[Changelog & Function Changes](Inhyma_ERP/doc/CHANGELOG_AND_FUNCTION_CHANGES.md)** — Chronological release history, company intelligence, CRM suite, and cascading resolution.
- **[Complete Living Technical Manual](Inhyma_ERP/doc/SYSTEM_DOCUMENTATION.md)** — Exhaustive 15-section technical manual.
- **[Modules & Features Test Manual](Inhyma_ERP/MODULES_AND_FEATURES_TEST_MANUAL.md)** — 57-section QA test catalog.

### C. China Procurement & Sourcing (`Yinglima_ERP`)
Located in **[`Yinglima_ERP/doc/`](Yinglima_ERP/doc/)**:
- **[System Architecture & Design](Yinglima_ERP/doc/SYSTEM_ARCHITECTURE_AND_DESIGN.md)** — China sourcing engine, AI quotation extractor, and shipment planning sheets.
- **[API Design & Endpoints](Yinglima_ERP/doc/API_DESIGN_AND_ENDPOINTS.md)** — REST API specifications for Suppliers, Inquiries, and Planning.
- **[Changelog & Function Changes](Yinglima_ERP/doc/CHANGELOG_AND_FUNCTION_CHANGES.md)** — Release history, outbox delivery, and session synchronization.
- **[Complete Living Technical Manual](Yinglima_ERP/doc/SYSTEM_DOCUMENTATION.md)** — Comprehensive technical reference manual.
- **[Modules & Features Test Manual](Yinglima_ERP/MODULES_AND_FEATURES_TEST_MANUAL.md)** — Comprehensive QA test manual.

---

## 4. Federated Identity & Enterprise User Management Architecture

The platform implements an enterprise-grade, distributed user management and identity federation system spanning `ERP_Main` (Central Control Plane) and autonomous spoke instances (`Inhyma_ERP` and `Yinglima_ERP`):

```mermaid
flowchart TD
    subgraph ControlPlane["Central Control Plane (ERP_Main)"]
        GU["Global Users Directory<br/>(/access/users)"]
        PA["Platform Admins<br/>(per-session tokens: sid)"]
        SOE["Per-Session Sign-Out<br/>(/global/ecosystem-session/{sid}/revoke)"]
        PWS["Central Password Federation<br/>(/auth/internal/sync-password)"]
    end

    subgraph Spoke1["Inhyma_ERP (India Spoke)"]
        INH_U["Local Users & HR Profiles"]
        INH_REV["Inbound Session Revocation<br/>(/internal/sessions/{sid}/revoke)"]
        INH_PW["Outbound Password Sync"]
    end

    subgraph Spoke2["Yinglima_ERP (China Spoke)"]
        YNG_U["Local Users & HR Profiles"]
        YNG_REV["Inbound Token Revocation<br/>(/auth/internal/revoke-user-tokens)"]
        YNG_PW["Outbound Password Sync"]
    end

    GU -- "Dynamic Provisioning & Deprovisioning" --> INH_U
    GU -- "Dynamic Provisioning & Deprovisioning" --> YNG_U
    SOE -- "Fanout Token Revocation (X-Service-Key)" --> INH_REV
    SOE -- "Fanout Token Revocation (X-Service-Key)" --> YNG_REV
    INH_PW -- "Inbound Sync" --> PWS
    YNG_PW -- "Inbound Sync" --> PWS
    PWS -- "Fanout Password" --> INH_U
    PWS -- "Fanout Password" --> YNG_U
```

### Key User Management Pillars
1. **Triple-Tier Identity Model:**
   - **Platform Admins (`platform_admins`):** Central control-plane operators with instant token invalidation boundaries via `admin_tokens_revoked_before`.
   - **Global Users (`global_users`):** Authoritative enterprise-wide identity directory with unified Argon2id password hashing, lowercase email index, and active state tracking.
   - **ERP Memberships (`erp_memberships`):** Granular access grants linking global identities to spoke ERP instances with tenant-specific roles.
   - **Autonomous Spoke Users (`users`):** Local tenant directories preserving departmental hierarchies, employee profiles, and operational permissions.
2. **Bi-Directional Password Synchronization:**
   - Passwords changed centrally or locally on any spoke automatically propagate across all active ecosystem accounts without credential drift.
3. **Session-Scoped Login & Logout:**
   - Every login has its own session id, carried by all of that login's tokens (dashboard and each ERP). Logging out anywhere ends *that* session in the dashboard and the ERPs it used; other logins of the same account and other people are unaffected. "Sign out everywhere" is a separate, explicit action (`POST /api/v1/global/auth/sign-out-everywhere`, `/global/user-auth/sign-out-everywhere`).
   - Built-in fallbacks: a login still works if ERP_Main is down (clearly labelled local session), and ERPs re-check central sessions themselves so a lost sign-out message cannot leave a session alive (about 45 s). See `ERP_Main/docs/API_DESIGN_AND_ENDPOINTS.md` section 1.
4. **Multi-Identifier Spoke Resolution:**
   - Spoke synchronization and revocation endpoints resolve users safely across `id`, `user_id`, `email`, or `username`, eliminating distributed primary key collision issues.
5. **Platform Role Preservation:**
   - Spoke provisioning operations preserve platform administrative privileges, maintaining strict least-privilege separation between central control-plane and tenant-level roles.

---

## 5. Quick Start & Operational Commands

### A. Run Automated Backend Test Suites (675 Tests Total)
```bash
# ERP_Main backend (242 tests)
cd ERP_Main/backend && pytest -v

# Yinglima ERP backend (213 tests)
cd Yinglima_ERP/backend && pytest -v

# Inhyma ERP backend (220 tests)
cd Inhyma_ERP/backend && pytest -v
```

### B. Compile Frontend Production Builds (All Clean)
```bash
cd ERP_Main/frontend && npm run build
cd Yinglima_ERP/frontend && npm run build
cd Inhyma_ERP/frontend && npm run build
```

### C. Validate Production Environment Configurations
```bash
python scripts/validate_production_config.py --env staging
python scripts/validate_production_config.py --env production
```

### D. Execute Production Smoke Test Harness
```bash
python scripts/production_smoke_test.py
```

### E. One-Command Backend Startup (`python server.py`)
Running `python server.py` inside any backend directory automatically runs:
1. Virtual environment auto-detection & activation
2. Verification of `.env` configuration
3. Database migration execution (`alembic upgrade head`)
4. Idempotent bootstrap seeding (`python -m scripts.seed`)
5. Uvicorn API server startup with hot reload

```bash
# Start ERP_Main Control Plane (Port 8000)
cd ERP_Main/backend && python server.py

# Start Yinglima ERP API (Port 8001)
cd Yinglima_ERP/backend && python server.py

# Start Inhyma ERP API (Port 8002)
cd Inhyma_ERP/backend && python server.py
```

### F. Run Full Ecosystem Production Container Stack (All 3 Systems)
```bash
# Spins up ERP_Main (8000/5170), Yinglima (8001/5173), and Inhyma (8002/5174) with healthchecks:
docker compose -f docker-compose.ecosystem.yml up -d --build
```

---

## 5. Cloud Deployment Guide (DigitalOcean, Render, AWS)

A comprehensive, production-tested deployment manual is available in **[`DEPLOYMENT_GUIDE.md`](DEPLOYMENT_GUIDE.md)**:

- **Render.com Blueprints:** Ready-to-deploy blueprints located at [`Inhyma_ERP/render.yaml`](Inhyma_ERP/render.yaml), [`Yinglima_ERP/render.yaml`](Yinglima_ERP/render.yaml), and [`ERP_Main/render.yaml`](ERP_Main/render.yaml).
- **DigitalOcean:** Multi-service Droplet setup via `docker-compose.ecosystem.yml` or DigitalOcean App Platform PaaS.
- **Amazon Web Services (AWS):** AWS ECS Fargate, AWS App Runner, and EC2 containerized topologies.
- **Production URL & Port Decoupling:** Fully parametric URL resolution (zero hardcoded LAN IPs or localhost references).
- **Cross-Subdomain SSO & Cookie Sync:** Unified session propagation via `VITE_COOKIE_DOMAIN` and central ecosystem sessions (`ihm_ecosystem_session`).
- **Disambiguated Session Verification & False Logout Prevention:** 3-way status contract (`valid` vs `notFound` vs `revoked`) ensuring client background watchers do not falsely terminate sessions on network blips or server restarts.
- **Multi-Identifier Spoke Resolution:** Bidirectional resolution of machine keys (`erp-01` / `inhyma`, `erp-02` / `yinglima`) enabling uninterrupted SSO switching and centralized access governance across spokes.

---

## 6. Ecosystem Resilience, Email Deduplication & Production Safeguards

### A. Central Federation Multi-URL Discovery & Spoke Resilience
- **Multi-Candidate Resolution (`erp_main_api_base_urls()`):** Spoke backends resolve candidate URLs sequentially (`ERP_MAIN_API_BASE_URL`, `ERP_MAIN_URL`, and defaults), ensuring resilience when switching between custom domains and cloud platform endpoints.
- **Outbound IPv4 Binding (`0.0.0.0`):** Outbound `httpx.AsyncClient` connections bind explicitly to `0.0.0.0`, eliminating broken IPv6 routing in cloud container meshes.
- **40-Second Cold-Start Sleeping Budget:** Cloud container instances (e.g. Render starter tiers) are allocated a 40.0s timeout budget (`httpx.Timeout(40.0, connect=20.0)`), allowing sleeping upstream containers to cold-boot cleanly during SSO handovers.
- **900s Stale Session Tolerance (`_from_cache`):** If the central control plane is temporarily unreachable or undergoing deployment, verified sessions are served from spoke local memory cache for up to 15 minutes, preventing user lockouts.
- **Live Federation Diagnostics (`GET /api/v1/health/federation`):** Diagnostic endpoint providing real-time ping latency and connectivity verification between spoke nodes and central control.

### B. Platform-Gated Winsock DNS Isolation
- **Windows Gating (`sys.platform.startswith("win")`):** Asynchronous DNS caching in `dns_resilience.py` runs exclusively on Windows developer workstations, preventing Winsock socket leaks (`WSAEADDRINUSE`) without affecting production Linux containers.
- **Port-Sensitive 5-Tuple DNS Cache Key:** Keyed by `(host, port, family, type, proto)`, preserving exact port destinations and preventing localhost cross-port routing collisions across `localhost:8000`, `8001`, and `8002`.

### C. Persistent Inbound Email Deduplication
- **Atomic Relational Ledger (`email_inbound_processed`):** Stores compound unique keys `(message_id, uid, inquiry_id, supplier_id)`. Checks `SELECT 1 FROM email_inbound_processed WHERE message_id = :mid` before invoking OpenAI extraction APIs, completely eliminating duplicate quotes across worker restarts.
- **30-Minute Historical Baseline:** On worker startup, historical messages older than 30 minutes are stamped into the deduplication ledger without creating duplicate quotes.
- **Zero-Cost Follow-ups:** Supplier quotation extraction runs strictly once (`QT-AUTO-01`); subsequent negotiation emails bypass LLM extraction and append directly to the thread timeline.

### D. Idempotent Deployment & Seed First-Install Protection
- **Bootstrap Guard (`BOOTSTRAP_FORCE_RESET`):** All `seed.py` scripts across `Inhyma_ERP`, `Yinglima_ERP`, and `ERP_Main` halt automatically if existing records are detected. Live accounts, credentials, and master geographies are never overwritten unless `BOOTSTRAP_FORCE_RESET=true` is explicitly provided.
- **Registry Host Safety (`seed_registry.py`):** Spoke instance URLs are updated only if explicit environment variables (`INHYMA_ERP_URL`, `YINGLIMA_ERP_URL`) are provided, preventing local developer runs from overwriting production cloud URLs with localhost.
- **SSO Handover Inactive User Guards:** `POST /api/v1/auth/sso-handover` verifies local account status; incoming SSO handovers for users with `is_active=False` or `deleted_at IS NOT NULL` are rejected with `401 Unauthorized` ("Account is inactive or disabled on this ERP instance").

### E. Database-Backed Organization Branding & Storage Quota Guards
- **Versioned Logo Streaming (`GET /api/v1/organizations/logo?v={sha1}`):** Streams high-resolution organization logos directly from PostgreSQL with `Cache-Control: public, max-age=86400, immutable`. The `v` query hash forces immediate browser cache refresh on logo update.
- **Client Storage Quota Protection:** `try/catch` handlers around `localStorage.setItem` in `brand.ts` and `Organization.tsx` eliminate mobile browser `QuotaExceededError` crashes when handling large base64 logo strings.



