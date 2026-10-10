# Yinglima_ERP — Documentation Index

Welcome to the dedicated documentation directory for **Yinglima_ERP** (China Procurement, Sourcing, RFQs & Master Shipment Planning).

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
