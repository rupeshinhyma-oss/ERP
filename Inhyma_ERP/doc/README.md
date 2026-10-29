# Inhyma_ERP — Documentation Index

Welcome to the dedicated documentation directory for **Inhyma_ERP** (India Distribution, Production Planning, B2B Companies & Field Service Tasks).

---

## Technical Specifications & Guides

- 🏛️ **[System Architecture & Design](SYSTEM_ARCHITECTURE_AND_DESIGN.md)**:
  - System topology, architectural patterns, and directory layout.
  - Extended B2B Company intelligence data model and social media matrix.
  - Cascading geographic address resolution hierarchy (State ➔ District ➔ City).
  - Purchase Orders (Local & Import) costing engine, dual landed valuation, and multi-line `.csv`/`.xlsx` bulk import engine.
  - Proforma Invoices commercial terms and dynamic tax routing.
  - Database-driven workflow status transition engine.
  - Multi-warehouse Product Stock matrix (9 warehouse columns across Mumbai, Ahmedabad, Indore), Branch-Scoped Product Re-Order engine with FIFO consignment breakup, Per-Product 5-source Stock Transaction Ledger, Stock Adjustments/Transfers, A4 PDF engine, and technical tasks dispatch.
  - Global autocomplete blocker and mouse wheel scroll value protection.
  - Universal page header geometry (`.page { padding: 12px 20px }`), 35px action button standard (`.page-header-actions`), golden-amber `#f59e0b` `Export` / `Imp / Exp` vector SVG badge standard, and filter-above-KPI layout hierarchy.

- 🔌 **[API Design & Endpoints](API_DESIGN_AND_ENDPOINTS.md)**:
  - Complete endpoint reference for Local Purchase (including `/local-orders/import`), Import Purchase (including `/import-orders/import`), Proforma Invoices, Sales Orders & Discount Payments, Suppliers, Companies, Masters, Geography, Inventory (Product Stock, Re-Order, Stock Transactions Ledger, Adjustments & Transfers), HRMS (Attendance, Leave, Assets, Expenses, Site Visits, Payroll), Payments, and Tasks.
  - Workflow transition rules and internal spoke deprovisioning endpoint specifications.

- 📜 **[Changelog & Function Changes](CHANGELOG_AND_FUNCTION_CHANGES.md)**:
  - Chronological history of all functional updates, migrations, and bug fixes.
  - Release October 29, 2026: Local & Import Purchase multi-line `.csv`/`.xlsx` bulk import (`POST /purchase/local-orders/import`, `POST /purchase/import-orders/import`) & `ImpExpDropdown` vector SVG badges; standardized golden-amber `#f59e0b` `Export` buttons & header alignment across Product Stock, Stock Adjustment, Stock Transfer, Sales Process & Product Re-Order; Suppliers active sidebar highlight (`purchase-suppliers`) & removal of Goods Expected Report from `REPORTS`; HRMS separation-of-duties security remediation, geolocation hardening & payroll approval persistence; Product Stock Transactions Master List & Per-Product 5-Source Ledger (`/stock-transaction/list/:id`); Product Re-Order 16-Column Branch-Scoped Matrix; Discount Payments Multi-Installment Ledger & Sale Order E-Way Bill / Status Timeline.
  - Release October 28, 2026: Interactive Sale Status Update Side Drawer across all Sale Process stages (`Pending` -> `Sales Confirmed` -> `Admin Approved` -> `Acc. Confirmed` -> `Gatepass Created` -> `Dispatched` -> `LR`), PO / Tally Bill / LR / Dispatch Media uploads, and Alembic migrations `v7a8b9c0d1e2` & `w8b9c0d1e2f3`.
  - Release October 27, 2026: Sales Process Add New Parity with Proforma Invoice, 100% Dynamic Masters, Warehouse Stock Exceeded Alerts, Upward Comboboxes, Live KPI Metrics, and Dynamic Organization Logo in Proforma PDF.
  - Release October 23, 2026: Machine Spare Parts Dedicated Management (dual tabs `Selected` and `All Spare Parts`, 11-column data table, multi-machine shared & unique compatibility mapping); SideDrawer Header Action Button Architecture (`headerActions` slot elevation, bottom button elimination, dedicated Machine Spare Parts drawer section with direct navigation); Product Master Deletion Safety (removed row `Delete` action to guard master catalog); Alembic Migration Chain Merge & Container Startup Hardening (unified head `d32a657d3f2f`, idempotent DDL inspection checks, and `alembic upgrade heads` startup resilience).
  - Release October 22, 2026 (Part 2): Import Purchase: Real Uploaded Invoice File Display, Zero-Synthetic-PDF Policy & Dedicated Streaming Endpoint (`GET /purchase/import-orders/{id}/bill-file` with Bearer & `?token=` query auth), Closed Consignment Action Menu Lock (strictly displays `Download Purchase` only, removing Edit/Confirm/Delete).
  - Release October 22, 2026 (Part 1): CRM Full Suite (Phases 1–6: dynamic pipeline stages, drag-and-drop Kanban board, bulk CSV import wizard with auto-mapping & deduplication, round-robin salesperson lead distribution, 360° lead timeline, company master linking, follow-up sync to workforce tasks, and branded ReportLab Quotation PDF); Workforce Recurring Tasks Scheduling Engine (recurring sub-tab in `/tasks`, modal scheduler, `recurring_worker.py` daemon); Product Sync Adapter (Yinglima -> Inhyma with auto-provisioning of missing relational dependencies).
  - Release October 19, 2026: Universal Page Header Geometry & Spacing Standardization (`12px 20px`), Global 35px Header Action Button & Isolated Popover Standard (`.page-header-actions`), Universal Filter-Above-KPI Placement Hierarchy across all modules, and Minimalist Header Cleanups on Trash and Audit modules.
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
  - Database pooler failover, Supabase storage synchronization procedures, Alembic version desynchronization recovery (RB-03), and resolving divergent migration heads (RB-04).

---

## Legacy Requirement Files & Samples
- `inquires.txt`: Legacy quotation specifications.
- `buyerclient.txt`: Buyer data specifications.
- `supplierformrequiremnt.txt`: Supplier specifications.
- `productrequiremnt.txt`: Product attributes.
- `test_buyers_import.csv` / `.xlsx`: Sample import files.
