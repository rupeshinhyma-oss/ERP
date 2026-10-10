# ERP_Main — Documentation Index

Welcome to the dedicated documentation directory for **ERP_Main** (Global Control Plane, Identity Provider & Analytical Projection Hub).

---

## Technical Specifications & Guides

- 🏛️ **[System Architecture & Design](SYSTEM_ARCHITECTURE_AND_DESIGN.md)**:
  - System topology, control plane role, and directory layout.
  - Central OIDC identity authority, JWKS key management, and ecosystem sessions.
  - Global user access governance, direct access grants, and conditional routing.
  - Materialized projections engine and architectural invariants.

- 🔌 **[API Design & Endpoints](API_DESIGN_AND_ENDPOINTS.md)**:
  - Complete endpoint reference for authentication, global users, and roles.
  - ERP instance registry and spoke discovery endpoints.
  - OpenID Connect federation endpoints and JWKS.
  - Event ingestion and asynchronous export engine.

- 📜 **[Changelog & Function Changes](CHANGELOG_AND_FUNCTION_CHANGES.md)**:
  - Chronological history of functional updates and bug fixes.
  - Platform authorization starter demo role separation & deletion preservation.
  - Production HTTPS Mixed Content elimination & origin resolution.
  - Supabase PgBouncer prepared statement cache auto-disable.
  - Durable access sync retry engine (`access_sync_tasks`) & high-scale indexes.
  - Bi-directional password synchronization and central session exchange.
  - Global autocomplete & autofill blocker implementation (`autocompleteBlocker.ts`).
  - Access governance unification and true spoke user deprovisioning.

- 🛡️ **[Disaster Recovery & Operational Runbooks](DISASTER_RECOVERY_AND_RUNBOOKS.md)**:
  - High availability failure playbooks (control plane and cloud database outages).
  - Standard operating procedures for key rotation and emergency deprovisioning.

---

## Historical Phase Delivery Reports

- **[PHASE_7_BACKEND_COMPLETION.md](PHASE_7_BACKEND_COMPLETION.md)**: Backend completion summary.
- **[PHASE_7_FRONTEND_DELIVERY_REPORT.md](PHASE_7_FRONTEND_DELIVERY_REPORT.md)**: Frontend delivery summary.
- **[PHASE_3_DELIVERY_REPORT.md](PHASE_3_DELIVERY_REPORT.md)**: Global identity delivery report.
