# Inhyma_ERP — Documentation Index

Welcome to the dedicated documentation directory for **Inhyma_ERP** (India Distribution, Production Planning, B2B Companies & Field Service Tasks).

---

## Technical Specifications & Guides

- 🏛️ **[System Architecture & Design](SYSTEM_ARCHITECTURE_AND_DESIGN.md)**:
  - System topology, architectural patterns, and directory layout.
  - Extended B2B Company intelligence data model and social media matrix.
  - Cascading geographic address resolution hierarchy (State ➔ District ➔ City).
  - Inventory stock adjustments, A4 PDF engine, and technical tasks dispatch.
  - Global autocomplete blocker and mouse wheel scroll value protection.

- 🔌 **[API Design & Endpoints](API_DESIGN_AND_ENDPOINTS.md)**:
  - Complete endpoint reference for Companies, Masters, Geography, Inventory, and Tasks.
  - Internal spoke deprovisioning endpoint specifications.

- 📜 **[Changelog & Function Changes](CHANGELOG_AND_FUNCTION_CHANGES.md)**:
  - Chronological history of all functional updates, migrations, and bug fixes.
  - Release September 29, 2026: Extended company profile intelligence, cascading address resolution, autocomplete suppression, and wheel lockout.
  - Release September 26, 2026: Internal spoke deprovisioning, soft-delete filtering, and session synchronization.

- 📘 **[Complete Living Technical Manual](SYSTEM_DOCUMENTATION.md)**:
  - Exhaustive 15-section technical manual covering all modules, database schemas, frontend tokens, and developer guidelines.

- 🛡️ **[Disaster Recovery & Operational Runbooks](DISASTER_RECOVERY_AND_RUNBOOKS.md)**:
  - Database pooler failover and Supabase storage synchronization procedures.

---

## Legacy Requirement Files & Samples
- `inquires.txt`: Legacy quotation specifications.
- `buyerclient.txt`: Buyer data specifications.
- `supplierformrequiremnt.txt`: Supplier specifications.
- `productrequiremnt.txt`: Product attributes.
- `test_buyers_import.csv` / `.xlsx`: Sample import files.
