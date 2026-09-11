# Phase 7 Backend — Global Reporting, Search & Unified Operations: Architecture & Completion Guide

## 1. Architectural Overview

ERP_Main operates as the central control plane and global read-model projector for the independent ERP fleet (`Yinglima_ERP` and `Inhyma_ERP`). In Phase 7 Backend Completion, the platform evolves from a single-entity demonstration into a production-grade, multi-entity projection, search, reporting, and operational monitoring engine.

### Strict ERP Boundaries
1. **Decoupled Physical Storage**: ERP_Main never touches partner ERP databases directly. No cross-database queries, shared database instances, or cross-ERP foreign keys exist.
2. **Event-Driven Projections**: Data propagates strictly through immutable domain events (`buyer.*`, `supplier.*`, `product.*`, `inquiry.*`) via signed HTTP event ingestion into the `integration_inbox`.
3. **Telemetry-Based Health & Reconciliation**: ERP_Main communicates with partner ERPs via authenticated HTTP telemetry requests (`GET /api/v1/integration/telemetry`), comparing outbox activity against projected counts without intrusive DB access.
4. **Independent Identity & Authorization**: Global users view data through authorization-filtered read models. Platform permissions (`platform.search.read`, `platform.dashboard.read`, `platform.reports.read`, `platform.reports.export`, `platform.sync.reconcile`) govern all operations.

---

## 2. Generic Projection Framework & Registry

The generic projection framework (`app.reporting.framework`) decouples event processing from individual entity models, providing a standardized contract for all domain entities.

### Key Components
- **`ProjectionDefinition`**: Dataclass defining the contract for each entity type:
  - `entity_type`: Canonical name (`buyer`, `supplier`, `product`, `inquiry`).
  - `event_types`: List of events triggering updates (e.g., `["supplier.created", "supplier.updated"]`).
  - `model_class`: SQLAlchemy read-model projection class.
  - `handler`: Asynchronous function mapping event payload and metadata to the read model.
- **`ProjectionRegistry`**: Registry singleton storing definitions, providing lookup by entity type and event type.
- **`ProjectionProcessor`**: Generic orchestration engine handling event materialization, idempotency, version sequencing, and checkpoint progression.

### Real-Time Materialization
When an event arrives at `POST /api/v1/integration/events`:
1. The event is verified and written to `integration_inbox`.
2. An inline projection hook (`ProjectionProcessor.process_single_event`) executes immediately within the transaction.
3. If the event matches a registered projection definition, the projection is materialized in real time.
4. In addition, batch checkpointing via `POST /api/v1/global/projections/rebuild` or background replay remains fully functional.

---

## 3. Supported Multi-Entity Projections

| Entity Type | Projection Table | Events Handled | Read Model Fields |
|---|---|---|---|
| **Buyer** | `global_buyer_projections` | `buyer.created`, `buyer.updated` | `id`, `source_erp_id`, `source_entity_id`, `company_name`, `status`, `version`, `synced_at` |
| **Supplier** | `global_supplier_projections` | `supplier.created`, `supplier.updated` | `id`, `source_erp_id`, `source_entity_id`, `supplier_code`, `name`, `email`, `phone`, `country`, `status`, `is_active`, `version`, `synced_at` |
| **Product** | `global_product_projections` | `product.created`, `product.updated` | `id`, `source_erp_id`, `source_entity_id`, `product_code`, `name`, `category`, `uom`, `status`, `is_active`, `version`, `synced_at` |
| **Inquiry** | `global_inquiry_projections` | `inquiry.created` | `id`, `source_erp_id`, `source_entity_id`, `inquiry_number`, `buyer_name`, `season`, `status`, `item_count`, `version`, `synced_at` |

---

## 4. Producer Outbox Integration in Partner ERPs

Both `Yinglima_ERP` and `Inhyma_ERP` publish integration events to their transactional `integration_outbox` table during business transactions:

- **Suppliers** (`suppliers/routes.py`):
  - `supplier.created`: Emitted with `supplier_code`, `name`, `email`, `phone`, `country`, `status`, `is_active`, `version=1`.
  - `supplier.updated`: Emitted with current field states and incremented `version`.
- **Products** (`masters/products/routes.py`):
  - `product.created`: Emitted with `product_code`, `name`, `category`, `uom`, `status`, `is_active`, `version=1`.
  - `product.updated`: Emitted on master product changes.
- **Inquiries** (`inquiries/routes.py`):
  - `inquiry.created`: Emitted on item creation with `inquiry_number`, `buyer_name`, `season`, `status`, and `item_count`.
- **Buyers** (`buyers/routes.py`):
  - `buyer.created` and `buyer.updated` both emit outbox events with incremented versions.
- **Integration Telemetry Endpoint** (`integration/routes.py`):
  - `GET /api/v1/integration/telemetry`: Authenticated via `FEDERATION_SERVICE_CREDENTIAL`, returns total outbox records and pending/failed counts without cross-database access.

---

## 5. Unified Search & Entity Inspection

### Endpoints
- **Unified Multi-Entity Search**:
  `GET /api/v1/global/search?q={query}&entity_type=buyer&entity_type=supplier&limit=50`
  Returns polymorphic `GenericSearchResult` records across all supported projections, scoped to the caller's authorized ERPs.
- **Entity-Specific Searches**:
  - `GET /api/v1/global/search/buyers`
  - `GET /api/v1/global/search/suppliers`
  - `GET /api/v1/global/search/products`
  - `GET /api/v1/global/search/inquiries`
- **Polymorphic Entity Inspection**:
  `GET /api/v1/global/projections/{entity_type}/{id}`
  Retrieves detailed projection state, metadata, and raw synchronized attributes.

---

## 6. Dynamic Report Engine & Export Lifecycle

### Available Reports
1. `global_buyer_summary`: Aggregated buyer accounts and sync versions.
2. `global_supplier_summary`: Supplier directories, contact parameters, and active statuses.
3. `global_product_catalog`: Global SKU definitions, categories, and units of measure.
4. `global_inquiry_pipeline`: Global inquiry flow, buyers, and season distributions.
5. `cross_erp_overview`: Multi-ERP entity tallies, connectivity status, and fleet visibility.

### Real File Export & Secure Delivery
1. **Request Creation**:
   `POST /api/v1/global/reports/export`
   Creates a `ReportExportJob` in `PENDING` state with parameters, filters, and requester attribution.
2. **Job Processing**:
   `POST /api/v1/global/reports/export/{id}/process`
   Executes asynchronously (or via worker), writes actual CSV or XLSX files using `openpyxl` into a secured export directory, computes SHA-256 checksums, and issues a 32-byte secure download token valid for 24 hours.
3. **Secure Download**:
   `GET /api/v1/global/reports/export/{id}/download?token={download_token}`
   Validates token, verifies expiry, enforces directory confinement against traversal attacks, and streams the file using `FileResponse`.
4. **Retention Cleanup**:
   `POST /api/v1/global/reports/export/cleanup?retention_hours=72`
   Deletes expired physical files and transitions job status to `EXPIRED`.

---

## 7. Operational Metrics & Subsystem Health

- **Subsystems Health**:
  `GET /api/v1/global/health/subsystems`
  Evaluates database connectivity, projection engine status, checkpoint lags, and export storage directory health.
- **Point-in-Time Metrics**:
  `GET /api/v1/global/metrics`
  Aggregates total registered ERPs, active ERP count, total projected records by entity, unprocessed inbox events, and total export jobs.
- **Partner Telemetry Reconciliation**:
  `POST /api/v1/global/reconciliation/{erp_id}`
  Polls partner ERP `GET /api/v1/integration/telemetry` over HTTP, compares partner outbox counts with projected items, and flags discrepancies honestly without fake synchronization.
