# Phase 7 Frontend — Backend Capabilities & Gap Report

**Target System:** `ERP_Main` Control Plane  
**Phase:** Phase 7 Frontend — Global Reporting, Search, Analytics & Unified Operations  
**Date:** September 8, 2026  
**Audience:** Control Plane Architecture Team, Frontend Engineering, Integration Engineering  

---

## 1. Executive Summary

During the implementation of the **Phase 7 Frontend**, the user interface was strictly anchored to the **actual existing Phase 7 backend capabilities**. In strict adherence to architectural directives, **zero fake metrics, zero fake synchronizations, zero fake downloads, and zero fake entity projections** were introduced into the codebase.

This document outlines:
1. Every Phase 7 backend capability successfully connected to the frontend.
2. Areas where the UI intentionally displayed empty, disabled, pending, or unknown states to preserve operational honesty.
3. Concrete backend gaps discovered during integration.
4. Actionable recommendations for Phase 8 backend extensions.

---

## 2. Integrated Backend Capabilities

The following ERP_Main control plane backend routes and services are fully wired into the production frontend:

| Component | Backend Endpoint | Method | Backend Service / Handler | Operational Functionality |
| :--- | :--- | :---: | :--- | :--- |
| **Control Plane Operations** | `/global/dashboard/overview` | `GET` | `GlobalDashboardOverviewService` | Live KPIs (active ERPs, users, memberships, total events, dead-letters), ERP fleet health list with capabilities and API health, and projection freshness checkpoints with lag seconds. |
| **Federated Search** | `/global/search/buyers` | `GET` | `GlobalSearchService.search_buyers` | Multi-ERP buyer projection querying, text matching over company name, status filtering, pagination offset/limit, and timestamping (`data_as_of`). |
| **Projection Detail** | `/global/projections/buyers/{id}` | `GET` | `GlobalBuyerProjectionRepository.get_by_id` | Full inspection metadata drawer showing integration event UUID, event occurrence timestamp, and record timestamps. |
| **Projection Rebuild** | `/global/projections/buyers/rebuild` | `POST` | `GlobalBuyerProjectionRebuilder` | Operator action replaying inbox buyer events to regenerate projection cache idempotently. |
| **Report Catalog** | `/global/reports/definitions` | `GET` | `GlobalReportCatalogService` | Dynamic catalog declaring available (`AVAILABLE`) vs planned (`NOT_YET_SUPPORTED`) report definitions. |
| **Export Job Submission** | `/global/reports/export` | `POST` | `GlobalReportingService.create_export_job` | Creation of asynchronous report export jobs (`CSV`, `JSON`, `XLSX`). |
| **Export Job Tracking** | `/global/reports/export` | `GET` | `GlobalReportingService.list_my_jobs` | Authenticated user job listing with real status (`PENDING`). |
| **Reconciliation Engine** | `/global/reconciliation/erps/{erp_id}` | `POST` | `ReconciliationService.reconcile_erp` | Checkpoint comparison between local buyer projection count and external outbox. |
| **Global Audit Trail** | `/global/audit-logs` | `GET` | `GlobalAuditService.list_logs` | Comprehensive security and administrative audit event directory with category filtering and payload inspection. |
| **Fleet Registry** | `/global/erp-instances` | `GET` | `ErpRegistryService.list_instances` | Registry directory of registered partner ERP nodes. |

---

## 3. Intentional Frontend Honesty & Architectural Guardrails

Rather than fabricating features on the client side, the frontend intentionally reflects the decoupled reality of the decentralized ecosystem:

### 3.1. Asynchronous Export Jobs (Section 16)
* **Backend Behavior:** When `POST /global/reports/export` is invoked, the backend inserts a job record with `status: PENDING`. No background worker daemon or object storage bucket (`S3`/`MinIO`) is currently provisioned in ERP_Main backend to generate real downloadable CSV/Excel files.
* **Frontend Implementation:** The export jobs tab renders the job in genuine `PENDING` state with a badge and explanatory subtext: *"Awaiting asynchronous export worker fulfillment."*
* **Honest Action:** The "Download" button is explicitly rendered with `disabled={true}`, visually dimmed, with the tooltip:  
  `"Export file generation is pending backend execution. No fake download is offered."`
* **Zero Client Generation:** The UI deliberately avoids generating client-side CSV blobs or fabricating instant completion.

### 3.2. Partner ERP Outbox Reconciliation (Section 15)
* **Architectural Boundary:** ERP_Main control plane does not hold database credentials to, nor does it query, the private SQLite/PostgreSQL databases of Yinglima ERP or Inhyma ERP.
* **Backend Response:** `POST /global/reconciliation/erps/{erp_id}` computes `projection_count`, sets `outbox_published_count = None`, and sets `status = "UNKNOWN"`.
* **Frontend Presentation:** The UI displays `Unknown (Unqueried)` in muted italicized text, accompanied by an informative architectural note clarifying that remote outbox polling requires a dedicated telemetry adapter or push webhook from partner nodes.

### 3.3. Federated Search Coverage (Section 14)
* **Supported Entity Types:** The control plane currently maintains read projections solely for `buyer` entities (`GlobalBuyerProjection`).
* **Planned Entity Types:** Projections for `supplier`, `product`, and `quotation` have not been implemented in the backend event consumer.
* **Frontend Design:** The search type selector renders `Buyers (Supported)` alongside disabled options:
  * `Suppliers (Not Yet Supported)`
  * `Products (Not Yet Supported)`
  * `Quotations (Not Yet Supported)`
* **Honest Empty States:** Searching for nonexistent records displays an honest empty state explaining that the record was not found in the control plane index, directing the operator to verify whether partner ERP outbox events have been emitted and ingested.

### 3.4. Deep-Linking to Partner ERPs (Section 14)
* **Local ID Availability:** The search results drawer presents `source_entity_id` (e.g. `loc-buyer-101`) and `source_erp_id`.
* **Deep-Link Absence:** Partner ERP frontends do not currently expose signed deep-linking routes or SSO cross-navigation back to specific entity screens from ERP_Main.
* **Frontend Design:** The "Open in ERP" button is rendered with `disabled={true}`, styled as unclickable, with tooltip:  
  `"Deep linking to local buyer record in source ERP is not yet configured."`

---

## 4. Backend Gaps Discovered

During frontend construction and testing, the following backend gaps and missing capabilities were identified:

### Gap 1: Asynchronous Export Worker & Artifact Delivery
* **Description:** While `POST /global/reports/export` records the user's intent to export, there is no background queue (e.g., Celery, Redis queue, or FastAPI background task runner) executing report compilation or writing artifacts to persistent storage.
* **Impact:** Jobs remain permanently in `PENDING` status unless manually updated in the database.
* **Recommendation:** Implement a background worker service in `app/reporting/worker.py` that queries projection tables, serializes to CSV/XLSX, stores files in secure object storage, generates signed download URLs, and transitions job status to `COMPLETED` or `FAILED`.

### Gap 2: Remote Outbox Telemetry & Two-Way Reconciliation
* **Description:** The reconciliation endpoint currently returns `outbox_published_count = None` because ERP_Main has no direct or API-based query interface into Yinglima or Inhyma outbox tables.
* **Impact:** Operators cannot verify whether events were lost between the partner ERP outbox and ERP_Main inbox.
* **Recommendation:** Implement an authenticated internal health/metrics endpoint on partner ERPs (e.g., `GET /internal/telemetry/outbox-count?aggregate_type=buyer`) that ERP_Main can call during reconciliation, or configure partner ERP outbox publishers to periodically push sequence checkpoints to ERP_Main.

### Gap 3: Missing Projections for Non-Buyer Aggregates
* **Description:** The event ingest pipeline in `ERP_Main` only consumes `BUYER_REGISTERED`, `BUYER_UPDATED`, and related buyer event types into projection tables. Supplier, product catalog, and quotation events are either discarded or routed without projection storage.
* **Impact:** Federated search and cross-ERP reporting are limited to buyers.
* **Recommendation:** In Phase 8, implement:
  * `GlobalSupplierProjection` (`app/reporting/models/supplier.py`)
  * `GlobalProductProjection` (`app/reporting/models/product.py`)
  * `GlobalQuotationProjection` (`app/reporting/models/quotation.py`)
  * Corresponding consumer handlers in `app/integration/service.py` to materialize read models.

### Gap 4: Partner ERP Deep Link Registry
* **Description:** The control plane knows `base_url` for each registered ERP (e.g., `http://localhost:8001`), but has no route template registry (e.g., `/buyers/{id}`) or cryptographic SSO bridge to seamlessly launch an operator directly into a record inside a partner ERP.
* **Impact:** Operators inspecting a buyer projection cannot one-click navigate to the live record in Yinglima or Inhyma ERP.
* **Recommendation:** Add a `deep_link_templates` JSON column to `erp_instances` (e.g., `{"buyer": "/app/buyers/{source_entity_id}"}`) and combine with the Phase 5 federation launcher tokens to enable secure cross-ERP record navigation.

---

## 5. Architectural Verification Matrix

| Architectural Principle | Implementation Status | Evidence / Verification |
| :--- | :---: | :--- |
| **Control-Plane Only Storage** | Verified | ERP_Main reads solely from its own SQLite database (`erp_main.db`). Zero cross-database connections or foreign keys to Yinglima/Inhyma databases. |
| **Event-Driven Materialization** | Verified | Buyer projections and search models are generated exclusively by processing ingested `IntegrationInboxEvent` records. |
| **Strict Identity Boundaries** | Verified | Global users govern control plane actions; memberships link to local users without conflating global identity with local roles. |
| **Truth in UI States** | Verified | Automated tests in `Reporting.test.tsx`, `Search.test.tsx`, and `Dashboard.test.tsx` assert that pending exports stay pending, unsupported entities are disabled, and unknown reconciliation counts remain unknown. |
