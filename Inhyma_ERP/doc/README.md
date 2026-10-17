# Inhyma_ERP — Documentation Index

Welcome to the dedicated documentation directory for **Inhyma_ERP** (India Distribution, Production Planning, B2B Companies & Field Service Tasks).

---

## Technical Specifications & Guides

- 🏛️ **[System Architecture & Design](SYSTEM_ARCHITECTURE_AND_DESIGN.md)**:
  - System topology, architectural patterns, and directory layout.
  - Extended B2B Company intelligence data model and social media matrix.
  - Cascading geographic address resolution hierarchy (State ➔ District ➔ City).
  - Purchase Orders (Local & Import) costing engine and dual landed valuation.
  - Proforma Invoices commercial terms and dynamic tax routing.
  - Database-driven workflow status transition engine.
  - Inventory stock adjustments, A4 PDF engine, and technical tasks dispatch.
  - Global autocomplete blocker and mouse wheel scroll value protection.

- 🔌 **[API Design & Endpoints](API_DESIGN_AND_ENDPOINTS.md)**:
  - Complete endpoint reference for Local Purchase, Import Purchase, Proforma Invoices, Suppliers, Companies, Masters, Geography, Inventory, and Tasks.
  - Workflow transition rules and internal spoke deprovisioning endpoint specifications.

- 📜 **[Changelog & Function Changes](CHANGELOG_AND_FUNCTION_CHANGES.md)**:
  - Chronological history of all functional updates, migrations, and bug fixes.
  - Release October 17, 2026 (Part 2): Universal "Grey and Locked" calculation design pattern across Local Purchase, Import Purchase, and Products master; Zero-Layout-Shift Floating Toast Architecture replacing static in-page banners; universal "No Data" table empty state standardization across all modules; unified skeleton row loaders.
  - Release October 17, 2026 (Part 1): Dedicated Payments module (`/payments`) with real-time financial KPI cards (`TOTAL PAYMENT`, `PAID`, `DUE`), technician collection recording modal, auto-audited call logs, zero-synthetic-data policy enforcement (purged 18 QA mock scripts, preserved authentic users A/B/C/D), and removal of deprecated Gatepass from task navigation.
  - Release October 14, 2026: Universal Filter Button UI standardization across all modules (matching Companies `#556987`, 8x14px, badge-less, default collapsed state).
  - Release October 14, 2026 (Part 1): Session-Scoped Tokens (`sid` claim, central session binding, per-session revocation via `/api/v1/internal/sessions/{sid}/revoke`).
  - Release October 10, 2026 (Part 2): Spoke multi-identifier resolution (`erp-01` / `inhyma`), super administrator unrestricted ecosystem access, watcher infinite loop prevention, and graceful SSO switching fallbacks.
  - Release October 10, 2026: Production HTTPS mixed content elimination (`isLocalhost()`), Supabase PgBouncer statement cache auto-disable (`_statement_cache_must_be_disabled`), bi-directional password sync federation (`push_password_to_erp_main`), fail-closed SSO central session verification, and central identity locks.
  - Release October 6, 2026: Local & Import Purchase modules, costing engines, Proforma Invoices commercial terms, database workflow rules engine, company advanced specs, supplier mandatory calling number, and Alembic sync fix.
  - Release September 29, 2026: Extended company profile intelligence, cascading address resolution, autocomplete suppression, and wheel lockout.
  - Release September 26, 2026: Internal spoke deprovisioning, soft-delete filtering, and session synchronization.


- 📘 **[Complete Living Technical Manual](SYSTEM_DOCUMENTATION.md)**:
  - Exhaustive 15-section technical manual covering all modules, database schemas, frontend tokens, and developer guidelines.

- 🛡️ **[Disaster Recovery & Operational Runbooks](DISASTER_RECOVERY_AND_RUNBOOKS.md)**:
  - Database pooler failover, Supabase storage synchronization procedures, and Alembic version desynchronization recovery (RB-03).

---

## Legacy Requirement Files & Samples
- `inquires.txt`: Legacy quotation specifications.
- `buyerclient.txt`: Buyer data specifications.
- `supplierformrequiremnt.txt`: Supplier specifications.
- `productrequiremnt.txt`: Product attributes.
- `test_buyers_import.csv` / `.xlsx`: Sample import files.
