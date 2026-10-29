# Yinglima_ERP — Documentation Index

Welcome to the dedicated documentation directory for **Yinglima_ERP** (China Procurement, Sourcing, RFQs & Master Shipment Planning).

---

## Module Guides & Safety Manuals (What Changed, How to Test, What NOT to Break)

- 🛒 **[Local Purchase Module Guide](MODULE_LOCAL_PURCHASE.md)**:
  - Architecture, database models, and recent updates (Supplier type-ahead search & Supabase invoice storage).
  - Step-by-step verification checklist and edge cases.
  - Critical rules: what to keep, what NOT to break (unmatched costing $0.00 rule, dual-state sync).

- 📦 **[Sales Process & 16-Column CI Engine Guide](MODULE_SALE_PROCESS.md)**:
  - Confirmed orders, Commercial Invoice 16-column costing sheet, China export VAT refund calculations, and Excel export.
  - Testing checklist (Test 1 / Mumbai Sheet calculation validation).
  - Critical constraints: zero-fallback pricing, exchange rate locking, precision rules.

- 🚢 **[Shipment Planning & Master Planning Sheet Guide](MODULE_SHIPMENT_PLANNING.md)**:
  - Master Planning Sheet China to India, container CBM utilization, inline cell edits, column permissions (`TEST(Y/N)`, `APPROVAL DATE`), and status colors.
  - Testing checklist and formula validation.

- 📝 **[Inquiries, RFQs & Quotations Guide](MODULE_INQUIRIES.md)**:
  - Buyer RFQs, multi-vendor quote comparison, AI quotation extractor, manager approval workflows, and quotation dispatch.

- 🏭 **[Suppliers & Vendor Directory Guide](MODULE_SUPPLIERS.md)**:
  - Chinese factory profiles, WeChat IDs, RMB bank accounts, quality ratings, factory visit media, and downstream integration.

- 🤝 **[Agents & Buyers Directory Guide](MODULE_BUYERS.md)**:
  - Overseas clients, consignee delivery ports, client grades (VIP A/B/C), potential ratings, and inquiry histories.

- 🏷️ **[Product Master & Catalog Guide](MODULE_PRODUCT_MASTER.md)**:
  - Products, packaging ratios, carton CBM math, private prices, and photo galleries.

- 👥 **[User Management, Positions & RBAC Guide](MODULE_USER_MANAGEMENT.md)**:
  - User accounts, employee positions, department-role assignments, 3-tier hierarchy, and user permission overrides.

- ⚙️ **[Settings Masters & 12 Reference Lookups Guide](MODULE_SETTINGS_MASTERS.md)**:
  - Consolidated single guide for all 12 lookup masters: Cities, Provinces, Countries, Currencies, UOM, HSN Codes, Categories, Subcategories, Brands, Supplier Types, Buyer Types, and Organization List.

- 🛡️ **[System Settings, Audit Logs & Trash Recovery Guide](MODULE_SYSTEM_SETTINGS_AUDIT_TRASH.md)**:
  - Corporate profile, immutable audit trails, and central 1-click trash restore/purge.

- 🔐 **[Roles, Permissions & Access Control Master Guide](ROLES_AND_PERMISSIONS_MASTER_GUIDE.md)**:
  - Mathematical effective permission formula, 25-module permission code matrix (`module.action`), backend `require_permission` dependencies, frontend `<Can>` guards, and Redis/memory cache invalidation.

- 📐 **[All KPIs & Formulas Master Guide](ERP_ALL_KPIS_AND_FORMULAS_MASTER_GUIDE.md)**:
  - Complete mathematical definitions for CBM, Gross Weight, Net Weight, Packages, Quotation Margins, and Costing.

---

## Technical Specifications & Guides

- 🏛️ **[System Architecture & Design](SYSTEM_ARCHITECTURE_AND_DESIGN.md)**:
  - System topology, architectural patterns, and directory layout.
  - Suppliers catalog and factory visit media attachments.
  - Inquiries, RFQ comparisons, and AI Quotation Extractor (GPT-4o/Gemini).
  - Master Shipment Planning Sheets (CBM container calculation engine).
  - Transactional Outbox pattern for cross-system event streaming.
  - Global autocomplete blocker and mouse wheel scroll value protection.

- 🔌 **[API Design & Endpoints](API_DESIGN_AND_ENDPOINTS.md)**:
  - Complete endpoint reference for Suppliers, Inquiries, Planning Sheets, and Public Vendor Portal.
  - Internal spoke deprovisioning endpoint specifications.

- 📜 **[Changelog & Function Changes](CHANGELOG_AND_FUNCTION_CHANGES.md)**:
  - Chronological history of functional updates, migrations, and bug fixes.
  - Release October 29, 2026: `.env`-driven cross-ERP URL resolution (`VITE_*_URL`), zero hardcoded localhost/ports, and strict local-vs-Render routing isolation (`sanitizeEnvMatchedUrl` in `ssoBridge.ts`, `ecosystemSession.ts`, `EcosystemSwitcher.tsx`, `vite.config.ts`).
  - Release October 28, 2026: Sale Process costing resolution for `Received / Inwarded` Local Purchases and Product Prices Add Quote modal 100% zoom visibility fix.
  - Release October 10, 2026 (Part 2): Spoke multi-identifier resolution (`erp-02` / `yinglima`), super administrator unrestricted ecosystem access, watcher infinite loop prevention, and graceful SSO switching fallbacks.
  - Release October 10, 2026: Production HTTPS mixed content elimination (`isLocalhost()`), Supabase PgBouncer statement cache auto-disable (`_statement_cache_must_be_disabled`), cascading category enforcement (Products, Suppliers, Buyers), bi-directional password sync federation, fail-closed SSO central session verification, and central identity locks.
  - Release October 5, 2026: Commercial Invoice (CI) 16-column costing engine, confirmed Local Purchase supplier sourcing, dynamic HSN refund VAT sync, and Excel export.
  - Release September 29, 2026: Autocomplete blocker implementation, wheel scroll protection.
  - Release September 26, 2026: Internal spoke deprovisioning, soft-delete filtering, and SSO identity preservation.


- 📘 **[Complete Living Technical Manual](SYSTEM_DOCUMENTATION.md)**:
  - Exhaustive 15-section technical manual covering all procurement workflows, database schemas, frontend components, and background workers.

- 🌐 **[Multi-ERP Architecture Guide](MULTI_ERP_ARCHITECTURE.md)**:
  - In-depth architectural design of the multi-ERP federation.

- 🛡️ **[Disaster Recovery & Operational Runbooks](DISASTER_RECOVERY_AND_RUNBOOKS.md)**:
  - Mailbox poller troubleshooting, outbox event backpressure management, and Supabase media sync.

---

## Legacy Requirement Files & Samples
- `inquires.txt`: Original functional requirements for inquiries.
- `buyerclient.txt`: Buyer data specifications.
- `supplierformrequiremnt.txt`: Vendor data structure.
- `productrequiremnt.txt`: Product specifications.
