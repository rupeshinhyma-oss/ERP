# Multi-ERP Enterprise Platform

A distributed, federated multi-ERP ecosystem engineered for high-availability international procurement, domestic distribution, and global analytical oversight.

---

## 1. System Ecosystem

The ecosystem comprises three autonomous systems:

1. **`ERP_Main` (`/ERP_Main`)**
   - Central Control Plane, Identity Provider & Global Reporting Hub
   - FastAPI Backend (Port `8000`), React + TypeScript SPA Frontend (Port `5170`)
   - OIDC Federation Authority, Global ERP Registry, Platform RBAC, Event Inbox, Real-Time Projections, Multi-Entity Search, Secure CSV/XLSX Export Engine.

2. **`Yinglima_ERP` (`/Yinglima_ERP`)**
   - Autonomous Procurement & Sourcing ERP (China Export / Factory Sourcing)
   - FastAPI Backend (Port `8001`), React + TypeScript SPA Frontend (Port `5173`)
   - Local Argon2id Auth, Buyers, Suppliers, Master Data, Inquiries/RFQs, Vendor Quotations, Planning Sheets with MUM group tracking, Transactional Outbox, Relying-Party SSO Client, Standalone Background Queue Worker.

3. **`Inhyma_ERP` (`/Inhyma_ERP`)**
   - Autonomous Production Planning & Distribution ERP (India Domestic Distribution)
   - FastAPI Backend (Port `8002`), React + TypeScript SPA Frontend (Port `5174`)
   - Local Argon2id Auth, Enterprise Tasks Module v2 (Jira-style boards, escalations, holds), Master Data, Inquiries, Planning Sheets, Transactional Outbox, Standalone Background Queue Worker.

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

All comprehensive documentation is located in the **[`docs/`](docs/)** directory:

- **[Master Technical Reference Manual](docs/MASTER_ERP_ECOSYSTEM_DOCUMENTATION.md)** — Exhaustive documentation covering system architecture, boundary invariants, features of all 3 ERPs, cross-system workflows, CI/CD, and operational recovery.
- **[Disaster Recovery Plan](docs/DISASTER_RECOVERY_PLAN.md)** — Recovery playbooks for Scenarios A through F (ERP_Main outage, partner ERP outages, database cloud outage, failed deployments, data corruption) with RTO < 15 min, RPO < 1 min.
- **[Operational Runbooks](docs/OPERATIONAL_RUNBOOKS.md)** — SRE procedures RB-01 through RB-07 (deployment, migration, rollback, PITR drill, DLQ replay, key rotation, worker incident recovery).
- **[Final Production Readiness Report](FINAL_PRODUCTION_READINESS_REPORT.md)** — Definitive 27-area readiness matrix and production sign-off (`PRODUCTION READY WITH DOCUMENTED RISKS`).
- **[Production Readiness Gaps](PRODUCTION_READINESS_GAPS.md)** — Risk register and mitigation plans.

---

## 4. Quick Start & Operational Commands

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

### F. Run Full Production Container Stack (Docker Compose)
```bash
docker compose -f docker-compose.prod.yml up -d
```

