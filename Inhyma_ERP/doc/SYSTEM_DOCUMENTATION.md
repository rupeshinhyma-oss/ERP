# Enterprise ERP System — Unified Architecture, Feature & Technical Manual

> **System Version:** 1.0.0 (Production)  
> **Last Updated:** October 31, 2026  
> **Architectural Pattern:** Modular Async Monolith (FastAPI) + React 18 SPA (Vite) + Real-Time WebSocket Event Bus  
> **Target Audience:** Systems Architects, Software Engineers, DevOps, and Autonomous AI Coding Assistants.  
> **Scope:** Complete end-to-end technical reference containing all system features, data models, API endpoints, background workers, frontend architecture, and developer integration guidelines.

---

## Table of Contents

1. [Executive Architecture & System Topology](#1-executive-architecture--system-topology)
2. [Technology Stack & Dependencies](#2-technology-stack--dependencies)
3. [Directory Layout & File Map](#3-directory-layout--file-map)
4. [Database Architecture & Universal Mixins](#4-database-architecture--universal-mixins)
5. [Complete Data Models & Entity Dictionary](#5-complete-data-models--entity-dictionary)
6. [Security, Authentication & Session Engine](#6-security-authentication--session-engine)
7. [RBAC Engine, Departments & Effective Permissions](#7-rbac-engine-departments--effective-permissions)
8. [Module-by-Module Technical Breakdown](#8-module-by-module-technical-breakdown)
   - 8.1. [Authentication & Active Sessions](#81-authentication--active-sessions)
   - 8.2. [Users & HR Profile Management](#82-users--hr-profile-management)
   - 8.3. [Departments & Department Managers](#83-departments--department-managers)
   - 8.4. [Master Data & Generic Catalogs](#84-master-data--generic-catalogs)
   - 8.5. [Product Catalog & Dynamic Specification Builder](#85-product-catalog--dynamic-specification-builder)
   - 8.6. [Supplier Directory & Tokenized Public Portal](#86-supplier-directory--tokenized-public-portal)
   - 8.7. [Buyer & Client Management](#87-buyer--client-management)
   - 8.8. [Inquiries, RFQs & AI Quotation Extractor](#88-inquiries-rfqs--ai-quotation-extractor)
   - 8.9. [Automated Inbound IMAP Email Worker](#89-automated-inbound-imap-email-worker)
   - 8.10. [Master Shipment Planning Grid & Container Calculations](#810-master-shipment-planning-grid--container-calculations)
   - 8.11. [Audit Trails & JSON Delta Change Diffing](#811-audit-trails--json-delta-change-diffing)
   - 8.12. [Recycle Bin (Universal Soft-Delete & Recovery)](#812-recycle-bin-universal-soft-delete--recovery)
   - 8.13. [Organization & System Profile](#813-organization--system-profile)
   - 8.14. [Employee Directory & Organization Structure](#814-employee-directory--organization-structure-identity--access-management-upgrade)
   - 8.15. [Standalone Work Management & Task Module](#815-standalone-work-management--task-module)
   - 8.16. [Inventory: Product Stock Management & Stock Transactions](#816-inventory-product-stock-management-inhyma-multi-warehouse-matrix)
     - 8.16.1. [Inventory: Product Re-Order Matrix, Branch-Scoped Shortfall & FIFO Stock Breakup](#8161-inventory-product-re-order-matrix-branch-scoped-shortfall--fifo-stock-breakup)
     - 8.16.2. [Reports: Product Stock Transactions & Per-Product Stock Transaction Ledger](#8162-reports-product-stock-transactions--per-product-stock-transaction-ledger)
   - 8.17. [Inventory: Stock Adjustment & Order PDF Generation](#817-inventory-stock-adjustment--order-pdf-generation)
   - 8.18. [Contact: Companies & Multi-Contact Directory](#818-contact-companies--multi-contact-directory)
   - 8.19. [Task: Technical Tasks & Field Service Dispatch](#819-task-technical-tasks--field-service-dispatch)
     - 8.19.1. [Technical Tasks: Payments Module & Technician Collections](#8191-technical-tasks-payments-module-payments--technician-collections)
   - 8.20. [HRMS: Leave Management Foundation & Master Data Architecture (Phase 1)](#820-hrms-leave-management-foundation--master-data-architecture-phase-1)
   - 8.21. [Purchase: Local Purchase Management & Costing Engine](#821-purchase-local-purchase-management--costing-engine)
   - 8.22. [Purchase: Import Purchase Consignments & Customs Landing Matrix](#822-purchase-import-purchase-consignments--customs-landing-matrix)
   - 8.23. [Sales: Proforma Invoices (PI) & Extended Commercial Terms](#823-sales-proforma-invoices-pi--extended-commercial-terms)
   - 8.24. [Database-Driven Status Rules & Dynamic Workflow Engine](#824-database-driven-status-rules--dynamic-workflow-engine)
   - 8.25. [Sales: Sales Order Execution & Sales Process Add/Edit Engine (Full Parity with Proforma, Dynamic Masters, Exceeded Stock Alerts, Grey-Locked Cells & Drawers), Gate Pass Logistics & Discount Ledger](#825-sales-sales-order-execution--sales-process-addedit-engine-full-parity-with-proforma-dynamic-masters-exceeded-stock-alerts-grey-locked-cells--drawers-gate-pass-logistics--discount-ledger)
   - 8.26. [CRM: Customer Relationship Management Full Suite, Quotations & Task Synchronization](#826-crm-customer-relationship-management-full-suite-leads-pipelines-distribution-timeline--branded-quotations-engine)
   - 8.27. [Workforce: Recurring Tasks Scheduling Engine & Automated Worker](#827-workforce-recurring-tasks-scheduling-engine--automated-spawning-worker)
   - 8.28. [Product Sync Adapter & Dynamic Relational Provisioning Engine](#828-product-sync-adapter--dynamic-relational-provisioning-engine-yinglima---inhyma)
   - 8.29. [Communication: Internal Feed & Broadcast Announcements Engine](#829-communication-internal-feed--broadcast-announcements-engine)

9. [Real-Time WebSocket & Event Synchronization](#9-real-time-websocket--event-synchronization)
10. [Multi-Tier Caching Engine](#10-multi-tier-caching-engine)
11. [Universal Bulk Import & Export Wizard](#11-universal-bulk-import--export-wizard)
12. [Frontend Architecture, UI Standards & Single-Flight Token Refresh](#12-frontend-architecture--single-flight-token-refresh)
   - 12.1. [Universal "Grey and Locked" Calculation Design Pattern](#121-universal-grey-and-locked-calculation-design-pattern-calc-locked)
   - 12.2. [Zero-Layout-Shift Floating Toast Architecture](#122-zero-layout-shift-floating-toast-architecture--banner-deprecation)
   - 12.3. [Universal "No Data" Empty State Standardization](#123-universal-no-data-empty-state-standardization)
   - 12.4. [Unified Table Skeleton Loaders](#124-unified-table-skeleton-loaders)
   - 12.5. [Universal Page Header & Spacing Standardization](#125-universal-page-header--spacing-standardization)
   - 12.6. [Universal Header Action Buttons Standard](#126-universal-header-action-buttons-standard-page-header-actions)
   - 12.7. [Filter Placement Hierarchy: Positioned Above KPI Summary Cards](#127-filter-placement-hierarchy-positioned-above-kpi-summary-cards)
   - 12.8. [Streamlined Minimalist Header Cleanups](#128-streamlined-minimalist-header-cleanups)
   - 12.9. [Sub-Toolbar Search Consolidation & Table Empty State Cleanup](#129-sub-toolbar-search-consolidation--table-empty-state-cleanup)
13. [Complete API Route & Endpoint Directory](#13-complete-api-route--endpoint-directory)
14. [Developer & AI Integration Guide (Rules of Engagement)](#14-developer--ai-integration-guide-rules-of-engagement)
15. [Deployment, Environment Variables & Operations](#15-deployment-environment-variables--operations)
16. [Central Ecosystem Federation, DB-Backed Inbound Email Deduplication & Bootstrap Seed Guards](#16-central-ecosystem-federation-db-backed-inbound-email-deduplication--bootstrap-seed-guards)
   - 16.1. [Resilient Central Federation & Spoke Survival Mechanics](#161-resilient-central-federation--spoke-survival-mechanics)
   - 16.2. [Platform-Gated Winsock DNS Resilience](#162-platform-gated-winsock-dns-resilience)
   - 16.3. [Persistent Database Inbound Email Deduplication](#163-persistent-database-inbound-email-deduplication)
   - 16.4. [Idempotent Deployment & First-Install Seed Protection](#164-idempotent-deployment--first-install-seed-protection)
   - 16.5. [SSO Handover Local Account Guards](#165-sso-handover-local-account-guards)
   - 16.6. [Database-Backed Organization Branding & Storage Quota Protection](#166-database-backed-organization-branding--storage-quota-protection)
   - 16.7. [Environment-Isolated Cross-ERP URL Resolution & Zero-Hardcoded-Port Architecture](#167-environment-isolated-cross-erp-url-resolution--zero-hardcoded-port-architecture)
   - 16.8. [Pytest Live-Database Isolation & Synthetic QA Persona Prevention](#168-pytest-live-database-isolation--synthetic-qa-persona-prevention)
   - 16.9. [System-Wide Active-Only Cross-Module Extraction & Historical Reference Preservation](#169-system-wide-active-only-cross-module-extraction--historical-reference-preservation)

---

## 1. Executive Architecture & System Topology

```
+---------------------------------------------------------------------------------------------------+
|                                          CLIENT TIER                                              |
|  React 18 Single Page App  |  IHM Design System (Vanilla CSS)  |  WebSocket Real-Time Listener    |
+-------------------------------------------------+-------------------------------------------------+
                                                  | HTTPS / WSS JSON API
+-------------------------------------------------v-------------------------------------------------+
|                                     FASTAPI APPLICATION TIER                                      |
|                                                                                                   |
|  [Middleware Pipeline: CORS -> Rate Limiting -> Request Logging -> Security Headers -> Context]   |
|                                                                                                   |
|  +---------------------------+  +---------------------------+  +-------------------------------+  |
|  | Authentication & Sessions |  | RBAC & Department Engine  |  | Inquiries & RFQ Lifecycle     |  |
|  | - Argon2id Password Hash  |  | - Hierarchical Roles      |  | - Multi-Vendor RFQ Tracking   |  |
|  | - JWT Access & Refresh    |  | - Dynamic Permissions     |  | - Quotation Matrix Comparison |  |
|  | - Single-Flight Refresh   |  | - User Override Engine    |  | - AI Extraction (GPT-4o/Gemini|  |
|  +---------------------------+  +---------------------------+  +-------------------------------+  |
|  | Master Data & Catalogs    |  | Sourcing & Partners       |  | Master Planning Engine        |  |
|  | - Dynamic Specs Engine    |  | - Suppliers & Contacts    |  | - Dynamic Sheet/Row/Col/Cell  |  |
|  | - Multilevel Categories   |  | - Public Tokenized Portal |  | - Container CBM Optimization  |  |
|  | - Currencies & Geography  |  | - Buyers & Credit Limits  |  | - Cell Status Tagging Engine  |  |
|  +---------------------------+  +---------------------------+  +-------------------------------+  |
|  | Background Workers        |  | Real-Time Event Engine    |  | Governance & Recovery         |  |
|  | - IMAP Email Inbound Poll |  | - WebSocket Manager       |  | - Immutable Audit Logger      |  |
|  | - AI Attachment Extractor |  | - JSON Mutation Broadcast |  | - Universal Soft-Delete / Bin |  |
|  | - Cache Eviction Daemon   |  | - Conflict Prevention     |  | - Field-Level JSON Delta Diff |  |
|  +---------------------------+  +---------------------------+  +-------------------------------+  |
+--------------------------------+----------------------------+-------------------------------------+
                                 |                            |
+--------------------------------v-------+  +-----------------v-------+  +--------------------------+
|            PERSISTENCE TIER            |  |       CACHING TIER      |  |       STORAGE TIER       |
| PostgreSQL / SQLite (SQLAlchemy Async) |  | Redis / InMemoryCache   |  | Local / Cloud Uploads    |
| Alembic Versioned Migrations           |  | Namespace-Based Cache   |  | Quotations, PDFs, Images |
+----------------------------------------+  +-------------------------+  +--------------------------+
```

### 1.1. Core Architectural Pillars
1. **Strict Onion Architecture**: `routes -> services -> repositories -> database`. Routes handle transport and authentication; services orchestrate business validation, audit logging, and caching; repositories build optimized async SQLAlchemy queries.
2. **Unified Response Envelope**: Every HTTP response is structured as `{ "success": true, "data": ..., "meta": ..., "error": null }`. Error responses provide the same uniform contract with a standardized error code and debug message.
3. **Domain Exceptions Hierarchy**: Business logic raises framework-agnostic exceptions (`NotFoundException`, `ConflictException`, `ForbiddenException`, `ValidationException`) translated into standard HTTP envelopes at the middleware boundary.
4. **Optimistic Concurrency**: Records implement integer `version` attributes to prevent dirty overwrites during simultaneous concurrent edits.
5. **Universal Soft-Deletion**: Records inherit `SoftDeleteMixin` (`deleted_at`, `deleted_by`). Deletion operations move data to the Recycle Bin for one-click restoration.

---

## 2. Technology Stack & Dependencies

### Backend Stack
- **Framework**: FastAPI (Python 3.11+) with Uvicorn ASGI server.
- **ORM & Database**: SQLAlchemy 2.0 Async (`asyncpg` for PostgreSQL, `aiosqlite` for local dev) with Alembic migration versioning, strict single-head linear history enforcement (`tests/test_migrations_match_models.py`), idempotent DDL guards (`sa.inspect`), and container startup resilience (`alembic upgrade heads`).
- **Data Validation**: Pydantic v2 schemas for high-throughput serialization.
- **Authentication**: Argon2id password hashing (`argon2-cffi`) and PyJWT (HMAC-SHA256).
- **Caching**: Dual-backend (`InMemoryCacheBackend` with LRU eviction and Redis client).
- **AI Processing**: OpenAI GPT-4o-mini / Google Gemini multimodal APIs for quote extraction from PDF/Excel/image documents.
- **PDF & Office Tooling**: `ReportLab` for PDF datasheets and `openpyxl` / `pypdf` for spreadsheet and document parsing.

### Frontend Stack
- **Core Framework**: React 18 with strict TypeScript typing.
- **Build Engine**: Vite with optimized Rollup code splitting.
- **Styling**: Vanilla CSS (IHM Design System) with custom tokens (glassmorphism, vibrant badges, accessible inputs).
- **Data Utilities**: `SheetJS` (xlsx) and `PapaParse` for client-side spreadsheet import/export.
- **Real-Time Client**: Native WebSocket `LiveClient` with automatic exponential backoff reconnection.

---

## 3. Directory Layout & File Map

```
Inhyma_ERP/
├── AGENTS.md                  # Mandatory AI and Developer Living Documentation Policy
├── MODULES_AND_FEATURES_TEST_MANUAL.md # Exhaustive UI, Form, Validation & QA Regression Catalog
├── doc/
│   ├── README.md              # Central documentation index
│   └── SYSTEM_DOCUMENTATION.md# Master Unified Architecture & Feature Manual (THIS FILE)
├── backend/
│   ├── app/
│   │   ├── api/v1/router.py   # Versioned API route registration
│   │   ├── audit/             # Immutable audit log models, service, and routes
│   │   ├── auth/              # JWT auth, Argon2id, session tracking, rate limiting
│   │   ├── buyers/             # Buyer directory, contacts, addresses, credit limits
│   │   ├── cache/              # Redis / in-memory cache manager, cleanup worker
│   │   ├── common/             # BaseRepository, BaseService, Pagination, Storage, Importer, Email
│   │   ├── core/                # Config, Responses, Exceptions, Exception Handlers, Logging
│   │   ├── crm/                # CRM pipelines, Kanban leads, round-robin distribution, quotations
│   │   ├── database/           # Async Engine (PostgreSQL + StaticPool SQLite test isolation), Session DI, Mixins
│   │   ├── employees/          # Employee (workforce/person) records, optional User Account link
│   │   ├── events/             # WebSocket connection manager and broadcast bus
│   │   ├── feed/               # Internal broadcast announcements & 1-to-1 employee messaging
│   │   ├── hrms/               # Attendance, Leave, Assets, Expenses, Site Visits, Payroll & RBAC
│   │   ├── inventory/          # 9-warehouse Product Stock matrix, Re-Order engine, 5-source Stock Transactions ledger, Adjustments & Transfers
│   │   ├── inquiries/          # RFQ lifecycle, AI Quote Extractor, IMAP email poller
│   │   ├── masters/           # Brands, Categories, Subcategories, Geography, Currencies
│   │   ├── middleware/        # Correlation ID, Logging, Security, Rate Limiter
│   │   ├── organizations/     # Enterprise profile settings
│   │   ├── org_structure/     # Departments, Positions, Leadership, Reporting Structure (IAM upgrade)
│   │   ├── planning/          # Dynamic spreadsheet planning grid, container CBM calculator
│   │   ├── products/          # Product catalog, dynamic specs, machine-spares & Yinglima sync_adapter
│   │   ├── purchase/          # Local & Import PO costing, streaming & bulk CSV/Excel import
│   │   ├── rbac/              # Roles (super_admin + user system roles), Permissions, Overrides
│   │   ├── sales/             # Proforma invoices, Sales Orders, Gatepass & Discount Payments
│   │   ├── suppliers/         # Supplier directory, tokenized public quote portal
│   │   ├── tasks/             # Workforce tasks, Jira board & recurring_worker.py
│   │   ├── technical_tasks/   # Field service tickets, technician dispatch & payments
│   │   ├── trash/             # Universal Recycle Bin recovery service
│   │   ├── users/             # User accounts, HR profiles, reporting managers & ERP_Main sync
│   │   └── main.py            # Composition root, lifespan lifecycle, middleware wiring
│   ├── alembic/               # Database schema version migrations (single head z1e2f3a4b5c6)
│   ├── scripts/               # Idempotent seed.py (297 permissions, 2 system roles) & maintenance utilities
│   ├── tests/                 # SQLite-isolated pytest suite (conftest.py live-DB guard)
│   └── requirements.txt       # Python dependencies
└── frontend/
    ├── src/
    │   ├── components/        # AppShell, MasterPage, SearchableDropdown, ImportWizard, UI, icons
    │   ├── lib/               # API client, Auth Context, Navigation registry (nav.ts), WebSockets
    │   ├── pages/             # Inquiries, Planning, Suppliers, Buyers, Users, Rbac, Profile
    │   │   ├── masters/       # Products, Brands, Categories, Currencies, Cities, Countries
    │   │   └── org/           # Positions, Organization Chart (dynamic org hierarchy)
    │   ├── styles/            # IHM Design System stylesheet (style.css, pages.css)
    │   └── types/             # Strict TypeScript domain interfaces
    └── package.json           # Frontend dependencies and build scripts
```

---

## 4. Database Architecture & Universal Mixins

All database models reside in `backend/app/` and inherit from declarative mixins defined in `backend/app/database/base.py`:

```python
class UUIDPrimaryKeyMixin:
    """Provides a RFC 4122 UUID v4 primary key column."""
    id: Mapped[uuid.UUID] = mapped_column(GUID(), primary_key=True, default=uuid.uuid4)

class TimestampMixin:
    """Tracks UTC creation and update timestamps."""
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, onupdate=_utcnow)

class SoftDeleteMixin:
    """Provides non-destructive lifecycle management."""
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    deleted_by: Mapped[uuid.UUID | None] = mapped_column(GUID(), nullable=True)

class VersionMixin:
    """Provides optimistic concurrency control."""
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
```

---

## 5. Complete Data Models & Entity Dictionary

```mermaid
erDiagram
    USERS ||--o{ USER_ROLES : assigned
    ROLES ||--o{ USER_ROLES : holds
    ROLES ||--o{ ROLE_PERMISSIONS : defines
    PERMISSIONS ||--o{ ROLE_PERMISSIONS : grants
    USERS ||--o{ USER_PERMISSIONS : overrides
    PERMISSIONS ||--o{ USER_PERMISSIONS : target
    USERS ||--o{ SESSIONS : registers

    ROLES ||--o{ ROLES : "parent_department (nested)"
    ROLES ||--o{ DEPARTMENT_HIERARCHY : "parent_department (multi)"
    ROLES ||--o{ DEPARTMENT_HIERARCHY : "child_department (multi)"
    USERS ||--o{ EMPLOYEE_POSITION_ASSIGNMENTS : holds
    POSITIONS ||--o{ EMPLOYEE_POSITION_ASSIGNMENTS : filled_by
    ROLES ||--o{ DEPARTMENT_LEADERSHIP_ASSIGNMENTS : led_by
    USERS ||--o{ DEPARTMENT_LEADERSHIP_ASSIGNMENTS : leads
    USERS ||--o{ EMPLOYEE_REPORTING_RELATIONSHIPS : "reports (as person)"
    USERS ||--o{ EMPLOYEE_REPORTING_RELATIONSHIPS : "manages (as manager)"

    BUYERS ||--o{ INQUIRIES : initiates
    INQUIRIES ||--o{ INQUIRY_ITEMS : contains
    INQUIRIES ||--o{ INQUIRY_SUPPLIER_QUOTES : receives
    SUPPLIERS ||--o{ INQUIRY_SUPPLIER_QUOTES : submits
    
    CATEGORIES ||--o{ SUB_CATEGORIES : contains
    SUB_CATEGORIES ||--o{ PRODUCTS : classifies
    BRANDS ||--o{ PRODUCTS : manufactures
    PRODUCTS ||--o{ INQUIRY_ITEMS : references
    
    PLANNING_SHEETS ||--o{ PLANNING_COLUMNS : defines
    PLANNING_SHEETS ||--o{ PLANNING_ROWS : contains
    PLANNING_ROWS ||--o{ PLANNING_CELLS : stores
    PLANNING_COLUMNS ||--o{ PLANNING_CELLS : formats

    USERS ||--o{ TASKS : creates
    TASKS ||--o{ TASK_ASSIGNEES : assigns
    USERS ||--o{ TASK_ASSIGNEES : "assigned_as (OWNER/ASSIGNEE/WATCHER)"
    TASKS ||--o{ TASK_SUBTASKS : "breaks_into (mini_tasks)"
    TASK_SUBTASKS ||--o{ TASK_SUBTASK_ASSIGNEES : assigns_to
    USERS ||--o{ TASK_SUBTASK_ASSIGNEES : "completes"
    TASKS ||--o{ TASK_COMMENTS : receives
    USERS ||--o{ TASK_COMMENTS : writes
    TASKS ||--o{ TASK_ESCALATIONS : records
    USERS ||--o{ TASK_ESCALATIONS : "escalates / target"
    USERS ||--o{ NOTIFICATIONS : receives
```

---

## 6. Security, Authentication & Session Engine

### 6.1. Dual-Token JWT & Single-Flight Refresh
- **Access Token**: 15-minute expiration, contains `sub` (User UUID), `username`, `roles`, and base claims.
- **Refresh Token**: 7-day expiration, stored cryptographically in the `refresh_tokens` table. Each refresh token is strictly **single-use** and rotated upon every `/auth/refresh` call.
- **Single-Flight Frontend Guard**: When multiple parallel API calls encounter a `401 Unauthorized`, only a single refresh request is dispatched. All concurrent requests wait on the same promise, preventing race conditions and unexpected logouts.

### 6.2. Argon2id Password Encryption
Passwords are hashed using Argon2id with strict parameters:
- Time cost: 3 iterations
- Memory cost: 65,536 KB
- Parallelism: 4 threads
- Salt length: 16 bytes

### 6.3. Active Session Governance
Every authentication creates a record in the `sessions` table capturing IP address, location, browser user-agent, and device category. Users and administrators can inspect active sessions and revoke compromised devices remotely.

### 6.4. Soft-Deleted Account Authentication Immunity
In accordance with system security standards, soft-deleted user accounts (`deleted_at IS NOT NULL`) are strictly prevented from authenticating:
- **Login Defense**: `UserRepository.get_by_identifier` automatically excludes soft-deleted accounts via `_base_select()`. Attempts to log in with credentials of a soft-deleted user fail immediately with `401 Unauthorized: Invalid username/email/phone number or password.`, mirroring the exact security response of hard-deleted accounts without leaking account existence.
- **Active Token Rejection**: Any in-flight JWT access token presented for a soft-deleted user is rejected during dependency verification (`verify_access_token`) with `401 Unauthorized: User account no longer exists.`.
- **Property Guard**: `User.can_login` evaluates strictly to `False` if `deleted_at` is set.
- **Restoration**: If an administrator restores the user from the Recycle Bin (clearing `deleted_at`), normal authentication capabilities are restored.

### 6.5. Multi-ERP Identity Federation & Sign-Out Everywhere
- **Inbound Central Token Revocation (`POST /api/v1/auth/internal/revoke-user-tokens`):**
  - Receives global revocation signals dispatched by `ERP_Main` when a user executes "Sign Out Everywhere" or when an administrator revokes access centrally.
  - Authenticated via shared microservice key (`X-Service-Key`).
  - **Multi-Identifier Matching:** Resolves the local target user by inspecting all provided attributes: local primary key `id`, external `user_id` / `global_user_id`, normalized `email`, or `username`.
  - Atomically revokes all matching records in `refresh_tokens`, updates user revocation cache, and pushes a real-time WebSocket `FORCE_LOGOUT` (`code: 4001`) event to terminate connected browser sessions instantly.
- **Bi-Directional Password Synchronization:**
  - **Outbound Sync (`erp_main_client.py`):** Whenever an authenticated user or administrator changes a password locally in Inhyma (`POST /users/{id}/reset-password` or `/auth/change-password`), the backend asynchronously pushes the new hash to `ERP_Main` (`POST /api/v1/auth/internal/sync-password`). If ERP_Main is temporarily unreachable, the call fails silently without rolling back the local transaction, and the Durable Access Sync Engine catches up queued updates.
  - **Inbound Central Push:** When ERP_Main resets a password centrally, it updates the user's password hash in Inhyma via internal synchronization RPC.
- **SSO Ecosystem Bridge & Switcher:**
  - Supports incoming SSO handover tickets from `ERP_Main` (`POST /auth/sso-handover`) allowing authorized cross-ERP navigation without credential re-entry.
  - Clears local session cache if an incoming ticket targets an identity differing from the currently active local user.
- **WebSocket Handshake Connection Pool & Lock Safety (`verify_websocket_token` in `app/auth/dependencies.py`):**
  - Long-lived WebSocket endpoints (`/api/v1/events/live`, `/api/v1/planning/sheets/{sheet_id}/live`) verify handshake tokens inside a strictly short-lived `AsyncSession` that commits and closes **before** entering the socket receive loop, ensuring open browser tabs never hold database pool connections or `idle in transaction` PostgreSQL locks on `users`/`roles`.
- **Non-Blocking Startup Schema Check & Port Cleanup (`app/main.py`, `backend/run.bat`, `frontend/run.bat`):**
  - Application lifespan inspects `information_schema.columns` via read-only `SELECT` before issuing any `ALTER TABLE` / `create_all` DDL (guarded with `SET LOCAL lock_timeout = '5s'`), eliminating `ACCESS EXCLUSIVE` lock contention on `users` during `--reload` restarts.
  - Disables Windows Console QuickEdit mode on startup and clears stale listeners on ports `8002` and `5174` in `run.bat` to prevent duplicate `SO_REUSEADDR` listeners on Windows.

---

## 7. RBAC Engine, Departments & Effective Permissions

## 7. RBAC Engine, Departments & Effective Permissions

The platform unifies **Roles** and organizational **Departments** onto the same underlying entity (`roles` table). A Role carries software permission bundles (`role_permissions`) AND real organizational placement (`code` and `parent_department_id` for departmental hierarchy with server-side cycle detection). Assigning a user to a department grants that department's permissions and places the person in the organizational unit. Individual per-user overrides (`user_permissions` ALLOW/DENY) remain available for any user who needs to deviate from department defaults.

### 7.1. Effective Permission Calculation
User capabilities are calculated dynamically at request time:

$$\text{EffectivePermissions} = \left( \bigcup_{r \in \text{UserRoles}} \text{RolePermissions}(r) \cup \text{DirectGrants} \right) \setminus \text{DirectDenies}$$

A user may be assigned any number of Roles simultaneously (`POST /users/{id}/roles` is additive, carrying assignment metadata `assignment_type` [PRIMARY, SECONDARY, TEMPORARY, PROJECT, ACTING], `is_primary`, and effective dates).

*Super Admin Rule:* Users with the `super_admin` role bypass checks and possess all permissions unconditionally.

### 7.2. Department Managers & Leadership
- Department members can be designated as **Department Managers** or leadership assignees (`department_leadership_assignments`).
- Managers display a `MANAGER` badge on the department roster.
- Administrators can configure direct per-user permission overrides (`🔑 Edit permissions`) to give managers elevated operational privileges (e.g. deletion, approval, bulk exports) without altering the base department role.
- Setting a manager automatically updates the `manager_id` reporting hierarchy for department members.

### 7.3. Multi-Parent & Multi-Child Department Hierarchy
- **Entity Model (`department_hierarchy`)**: Supports many-to-many relationships between organizational departments (`parent_department_id` $\leftrightarrow$ `child_department_id`).
- **Bidirectional Relationship**:
  - A parent department can possess **multiple child departments** (sub-departments).
  - A child department can report to or be nested under **multiple parent departments**.
- **DAG Cycle Prevention**: Traversing both `department_hierarchy` and legacy `roles.parent_department_id` via breadth-first search prevents direct or indirect recursive loops across the departmental graph. Attempted cycles fail fast with HTTP `409 Conflict` ("This would create a circular department hierarchy.").
- **Backward Compatibility**: Automatically mirrors and backfills the primary parent to `roles.parent_department_id` for legacy single-parent queries.

---

## 8. Module-by-Module Technical Breakdown

### 8.1. Authentication & Active Sessions
- **Endpoints:** `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`, `GET /auth/me`, `GET /auth/sessions`, `DELETE /auth/sessions/{id}`.
- **Features:** Self-service password change, active session listing, device revocation, and forced password reset on first login. Users with `has_login=False` cannot authenticate and are rejected before password hashing.

### 8.2. Users & HR Profile Management (Unified Person & Workforce Directory)
- **Endpoints:** `GET /users`, `GET /users/all`, `GET /users/department-manager/{role_id}`, `POST /users`, `GET /users/{id}`, `PATCH /users/{id}`, `POST /users/{id}/reset-password`, `POST /users/{id}/roles`, `DELETE /users/{id}/roles/{role_id}`.
- **Features:** Unified person directory supporting both ERP login users and workforce members with no system credentials (`has_login=False` -- factory workers, drivers, temporary labor, consultants).
  - **Account Fields:** `username`, `email`, `phone`, `password` (required when `has_login=True`; optional/null when `has_login=False`), and optional initial `position_id`.
  - **HR Attributes:** Employee Code, Contact Numbers, Gender, Date of Birth, Date of Joining, Employment Type, Status, Address, Emergency Contact, and Notes. **Last Name is optional**.
  - **Default "User" Role Assignment:** If an individual is not explicitly assigned any department/role upon creation (or if unassigned), the system automatically assigns the default system **"User"** role. When all roles are removed from a person, the system automatically falls back to assigning the "User" role.
  - **Position Assignment & Editing:** When creating an account, an optional **Position** dropdown (extracted from the active Positions catalog) can be selected to establish an immediate primary position assignment. In the **Edit User Profile & HR Details** drawer, administrators can also view, update, reassign, or unset the user's primary position directly alongside the Reporting Manager selector, with changes synchronized atomically to `employee_position_assignments`.
  - **Department & Manager Auto-Wiring:** When selecting an initial department in the Create User modal, the system calls `/users/department-manager/{role_id}` to automatically detect and pre-fill the department's active manager, with manual override capability.
  - **Positions & Reporting:** Profile Drawer displays held positions (`GET /positions/holders-for-user/{id}`), reporting managers (`GET /reporting/managers/{id}`), and direct reports (`GET /reporting/direct-reports/{id}`).
  - **Multi-Role Assignment:** Assign any number of roles/departments with `assignment_type` (PRIMARY, SECONDARY, TEMPORARY, PROJECT, ACTING), `is_primary`, and effective date ranges.
  - **Account Deactivation Policy & Permanent Retirement of User Deletion:** User deletion is permanently retired and disabled system-wide (`DELETE /users/{id}` returns 400 Bad Request) to preserve audit integrity and historical transaction data. Deactivating a user (`POST /users/{id}/deactivate`) marks their account `INACTIVE` (`is_active=False`), immediately terminates all active sessions, and prevents login or token refresh. Deactivated accounts can be reactivated by administrators (`POST /users/{id}/activate`).
  - **Collective Multi-Select & Bulk Deactivation:** The Users directory supports selecting multiple accounts via row/header checkboxes to execute bulk deactivation with built-in safety guardrails (protecting the administrator's own account, super-admin accounts, and already inactive accounts).
  - **Unified Edit User Profile & HR Details Drawer (Integrated Department Management):** The previous separate "Manage Departments" row action is now consolidated directly into the "Edit Profile" drawer. Administrators can manage basic identity, contact info, HR attributes, reporting manager, positions, and add/remove **Department & Role Assignments** (with assignment types and primary flags) in one unified interface without switching modals.
  - **Immediate Real-Time Force Logout:** "Force Logout" (`POST /users/{id}/force-logout`) provides guaranteed real-time session termination. It revokes device sessions in the database, caches a revocation timestamp (`auth_force_logout:{user_id}`) to instantly reject any in-flight access tokens on subsequent API calls, and pushes a real-time WebSocket disconnect event (`FORCE_LOGOUT`, code `4001`) that immediately clears client storage and redirects the active user to the login screen.
  - **Central Identity Provider Integration (`ERP_Main`):**
    - Inhyma acts as a distributed spoke node under the central `ERP_Main` control plane.
    - User accounts provisioned centrally in `ERP_Main` (`/access/users`) are automatically synchronized to Inhyma's local `users` directory via `POST /api/v1/internal/users/sync`.
    - Revoking access or deprovisioning from `ERP_Main` soft-deletes the local user record (`is_active=False`, `deleted_at=now()`) and revokes all active session tokens.
    - Password updates performed locally or centrally are propagated across the ecosystem via `erp_main_client.py` and `POST /api/v1/auth/internal/sync-password`.
    - Central "Sign Out Everywhere" signals received at `POST /api/v1/auth/internal/revoke-user-tokens` cleanly match users across `id`, `user_id`, `email`, or `username` to invalidate local credentials and push WebSocket disconnection events.

### 8.3. Departments & Permissions (RBAC & Org Structure)
- **Endpoints:** `GET /rbac/roles`, `POST /rbac/roles`, `PATCH /rbac/roles/{id}`, `DELETE /rbac/roles/{id}`, `POST /rbac/roles/{id}/delete-with-reassignment`, `PUT /rbac/users/{id}/permissions/bulk`, `GET /rbac/roles/{id}/hierarchy`, `POST /rbac/roles/{id}/parents`, `DELETE /rbac/roles/{id}/parents/{parent_id}`, `POST /rbac/roles/{id}/children`, `DELETE /rbac/roles/{id}/children/{child_id}`.
- **Features:** Department role definitions with optional short department `code` (e.g. `SALES`), multi-parent department nesting, safe deletion with user reassignment modal, and permission cloning.
  - **Canonical System Roles (`is_system=True`):** Only two roles are hardcoded/seeded by `scripts/seed.py`: `super_admin` (displayed as `Admin` with `SYSTEM` badge, holding all `297/297` permissions and reserved for the bootstrap administrator) and `user` (displayed as `User` with `SYSTEM` badge, assigned by default to standard accounts). Both are protected from rename and deletion. Zero business departments (`Sales`, `HR`, `Operations`, etc.) are hardcoded—all organizational departments are created and managed dynamically by administrators (`is_system=False`).
  - **Child Departments Card:** Dedicated card directly beneath "Users in this Department" in the left column of `/rbac`, displaying connected sub-departments, member counts, quick view navigation, and inline add/remove child controls.
  - **Multi-Parent Department Management:** Department Details allows assigning multiple parent departments with removable tag badges and immediate unlinking without resaving the entire role.
  - **Real-Time Bidirectional Sync:** Adding a child department in Operations instantly updates the child's parent roster, and vice versa.
  - **Cycle Prevention:** Strict validation prevents assigning an ancestor as a child or vice-versa.

### 8.4. Master Data & Generic Catalogs
- **Modules:** Payment Terms, Brands, Categories, Sub-Categories, Countries, States, Districts, Cities, Currencies, Units of Measurement (UOM), HSN/SAC Codes, Operating Companies, Taxes, Additional Charges, Social Media, Agent Types, Company Categories, Company Sectors, Warehouses, Billing Companies, Technicians, Banks, Transport, Lead Sources, Adjustment Purposes, and Call Types.
- **Features:** Built on the unified `MasterPage.tsx` engine providing uniform search, pagination, validation, modal creation, cached lookup resolution (`nameResolver.ts`), and bulk activate/deactivate/delete.
  - **Interactive Status Toggle Switches (`StatusToggle.tsx`):** All Master module tables render high-fidelity, interactive toggle switches in place of static status badges in the main table list.
    - *Visual State:* Active entries display a vibrant emerald green pill (`#10b981`) with thumb slid right (`translateX(20px)`); Inactive entries display a soft neutral slate pill (`#cbd5e1`) with thumb slid left (`translateX(0)`).
    - *Instant & Optimistic Update:* Clicking the switch flips state immediately with 220ms bezier transitions; the underlying master service triggers `toggleMasterStatus(apiBase, id, newStatus)`.
    - *Network Resilience & Error Rollback:* Shows a micro-spinner inside the switch thumb while mutation is in-flight, suppresses duplicate clicks, and reverts to previous state with error banner if the server request fails.
    - *Dual-Method Backend Compatibility:* All backend master routers support both `PATCH` and `POST` routes for `/{id}/activate` and `/{id}/deactivate`, preventing HTTP 405 Method Not Allowed errors across all client transports.
  - **Company Categories:** Configurable business classifications supporting B2B and B2C corporate tiers, status toggles, bulk deletion, and legacy route resolution (`/company/category/list` -> `/masters/company-categories`).
  - **Company Sectors:** Industry vertical classifications (e.g., Agriculture, Pharma & Healthcare, Packaging, FMCG, Metals & Mining, Chemical, Textile, Electronics, Automobile), status toggles, bulk deletion, CSV/Excel import/export, and legacy route resolution (`/company/sector/list` -> `/masters/company-sectors`).
  - **Warehouses:** Inventory hubs, transit depots, and storage facilities with Billing Company associations, Over Selling permissions, Primary status flags, Main Warehouse hierarchy links, color indicators, bulk deletion, and legacy route resolution (`/warehouse/list` -> `/masters/warehouses`).
  - **Additional Charges:** HSN and GST percentage-based rates for freight, transport, packing & forwarding.
  - **Social Media:** Managed external communication and marketing channel handles.
  - **Agent Types:** Multi-tier agent classifications and commission brackets.

### 8.5. Product Catalog & Dynamic Specification Builder
- **Endpoints:** `GET /products`, `POST /products`, `PATCH /products/{id}`, `POST /masters/products/specification-document`, `GET /masters/products/specification-documents/{doc_id}`, `GET /masters/products/specification-documents/{doc_id}/{filename}`, `POST /products/{id}/specs`, `GET /products/{id}/datasheet-pdf`, `GET /masters/products/machine-spares/universal-view`, `POST /masters/products/machine-spares/map`, `POST /masters/products/machine-spares/unmap`, `GET /masters/products/package-dimensions`.
- **Database-Backed Specification Document Storage (`ProductSpecificationDocument`):**
  - Replaces the legacy rich-text specification box in `Products.tsx` with a document file upload input (`Select Document` / drag-and-drop).
  - Stores uploaded documents (`.pdf`, `.doc`, `.docx`, `.xls`, `.xlsx`, `.csv`, `.txt`, `.rtf`, `.odt`, `.ods`, `.ppt`, `.pptx`) directly in PostgreSQL (`product_specification_documents.file_data` `BYTEA`), while keeping lightweight metadata (`specification_doc_id`, `specification_doc_name`, `specification_doc_mime`, `specification_doc_url`) on `products` so catalog queries never load binary blobs.
  - Whenever a document is uploaded, the system automatically generates and saves its direct DB streaming URL (`/api/v1/masters/products/specification-documents/{doc_id}/{filename}`) on the product (no manual clipboard copy required), displays that clickable link inside the **Product Details** View (`Specification` section) for every product with an uploaded document, and automatically attaches the link to the Quotation line item and embeds it as a clickable hyperlink inside generated CRM Quotation PDFs whenever that product is selected while creating a Quotation.
- **Features:** Dynamic JSON specification builder allowing arbitrary technical specifications (e.g. Dimensions, Voltage, Speed, Material). Includes multi-image upload, supplier association, and ReportLab PDF datasheet generation.
- **Master Multi-View Navigation Strip (`master-view-nav`):**
  - **`📦 Product Master` (`catalog`):** Main product catalog grid featuring column pinning, inline stock inspection, and bulk activation/deactivation.
  - **`⚙️ Machine-Spares Universal View` (`universal-view`):** Machine-wise spare parts breakdown showing all linked spare parts, codes, stock levels, and compatibility notes with a dedicated link modal (`/masters/products/machine-spares/universal-view`).
  - **`📐 Dimensions & Weights Report` (`dimensions-report`):** Package-level breakdown for multi-box products, displaying Length, Width, Height, CBM, Net Weight, and Gross Weight with direct CSV and XLSX export triggers.
- **Dedicated Machine Spare Parts Management Interface:**
  - Provides a dedicated 2-tab view:
    - **`Selected (<count>)`**: Shows spare parts mapped to the current machine with quick `Remove` unlinking.
    - **`All Spare Parts (<count>)`**: Global catalog of spare parts with search, pagination, and `+ Add` / `✓ Added` actions.
  - Full 11-column data table layout: `#`, `PART NO.`, `ITEM CODE`, `PRODUCT NAME`, `BRAND`, `CATEGORY`, `SUB CATEGORY`, `OEM COMPATIBILITY`, `PRICE (INR)`, `SPECIFICATION`, `ACTION`.
  - Supports multi-machine relationships: machines can share identical standard spares (e.g. standard bearings, belts) or maintain exclusive machine-specific spare parts.
- **SideDrawer UI Architecture:**
  - Upgraded with `headerActions` slot: `Edit Product` button is placed at the top-right header of `SideDrawer.tsx` alongside the close button.
  - Eliminated bottom fixed button row to allow clean, unobstructed scrolling of product attributes and media.
  - Embedded dedicated **Spare Parts** section for Machine products displaying mapped spares count, item preview, and a direct `Manage Spare Parts →` shortcut.
- **Master Catalog Deletion Safety:**
  - Row-level `Delete` action button removed from the Product Master list view (`ProductListPage.tsx`) to guard against accidental deletion of core catalog records.
- **Real-Time Duplicate Prevention Guard (`ProductNameSuggestions`):**
  - Intercepts operator input in real-time, executing trigram/substring match queries against existing product catalog names to prevent creating duplicate SKU entries.
- **Dimensional CBM Auto-Calculation:**
  - Enforced read-only packaging unit CBM field computed dynamically from user millimeter inputs:
    $$\text{CBM} = \frac{L \times W \times H}{1,000,000}$$
- **Strict Zero-Stock Deletion Lock:**
  - Product deletion is strictly blocked via `_check_zero_stock_or_raise` if any physical or virtual warehouse holds non-zero stock.
- **Cross-ERP One-Way Synchronization Receiver Adapter (`ProductSyncAdapter`)**:
  - Implemented in `app/integration/adapters/product.py` and registered in `app/integration/sync_engine.py`.
  - Configured with `SOURCE_TO_TARGET` policy for `("yinglima", "product")` with `delete_strategy="PROPAGATE_ARCHIVE"`.
  - Ingests cross-ERP events dispatched from Yinglima (`product.created`, `product.updated`, `product.deactivated`, `product.deleted`) via `POST /api/v1/integration/events`.
  - **Self-Healing Foreign Key Auto-Provisioning:** If incoming product payloads contain referenced Categories, Sub-Categories, Brands, UOMs, or Taxes not yet present in Inhyma, the adapter provisions them automatically on the fly so sync never aborts.
  - **Schema Normalization:** Clamps packaging gross weight ($\ge 0.001\text{ kg}$) and CBM ($\ge 0.000001\text{ m}^3$) to satisfy Inhyma database check constraints.
  - **Cache Invalidation:** Automatically invalidates `product_dropdown*` Redis/in-memory cache keys upon product upsert or deactivation.
  - **Strict Directionality Guard:** Enforces one-way sync ($Yinglima \rightarrow Inhyma$); any events originating in Inhyma attempting to push to Yinglima are rejected.

### 8.6. Supplier Directory & Tokenized Public Portal
- **Route & Sidebar Active Key:** `/purchase/suppliers` (legacy redirects `/suppliers`, `/supplier/list`) rendered under `PURCHASE -> Suppliers` with `AppShell` `activeKey="purchase-suppliers"` (`AppShell.tsx` also normalizes alias keys via `navItem?.key || activeKey` so `Suppliers` is always highlighted active in the sidebar).
- **Endpoints:** `GET /suppliers`, `POST /suppliers`, `PATCH /suppliers/{id}`, `POST /suppliers/{id}/contacts`, `POST /suppliers/import`, `GET /suppliers/export`.
- **Features:** Vendor directory with multi-contact management, payment terms, and bank details. Generates secure, tokenized public quote portal links (`/quotes/public/:token`) allowing vendors to submit bids without system accounts.
- **Mandatory Calling Number Validation:**
  - `contact_calling_number` is strictly mandatory (`min_length=1`) on supplier creation.
  - Updates enforce `_validate_calling_not_blanked`, preventing operators from wiping or blanking out the contact telephone number.
  - Frontend enforces this in both the quick add drawer and full edit view with required asterisk indicators (`*`) and client-side pre-submission validation.
- **Dynamic Geography & Phone Dialing Code Sync:** When changing Country in the Supplier Profile (e.g., China &rarr; India), Province and City dropdowns reset automatically, and the country dialing code prefixes on Calling Number, WhatsApp Number, and WeChat Number auto-update dynamically (e.g., `+86 7304240120` &rarr; `+91 7304240120`).
- **All-Column 3-State Sort Headers:** Every data content column (**Company Name**, **Product Category**, **Product Sub Category**, **City / State**, **Grade**, **Type**, **Current Status**, and **Potential**) supports interactive 3-state sorting (Ascending `▲` $\rightarrow$ Descending `▼` $\rightarrow$ Reset Unsorted). Empty-cell relegation ensures populated records always appear at the top in both ascending and descending modes.

### 8.7. Buyer & Client Management
- **Endpoints:** `GET /buyers`, `POST /buyers`, `PATCH /buyers/{id}`, `POST /buyers/{id}/contacts`, `POST /buyers/{id}/addresses`.
- **Features:** Client directory with credit limits, client grades (A, B, C, Premium), multi-address delivery matrix (Billing, Shipping, Warehouse), and bulk import/export.

### 8.8. Inquiries, RFQs & AI Quotation Extractor
- **Endpoints:** `GET /inquiries`, `POST /inquiries`, `POST /inquiries/{id}/rfq/dispatch`, `POST /inquiries/{id}/send-email-message`, `GET /inquiries/{id}/messages`, `POST /inquiries/{id}/quotes/manual`, `POST /inquiries/{id}/quotes/extract-pdf`, `POST /inquiries/{id}/convert-to-proforma`, `GET /inquiries/{id}/compare-matrix`.
- **Features:**
  - 3-layer RFQ and Quotation management lifecycle: `Buyer Directory` $\rightarrow$ `Consignments` $\rightarrow$ `Line Items & Quotation Matrix`.
  - **Interactive Inline Email Composer (Gmail/Figma-Style)**: Located in the Inquiries -> Emails tab. Allows users to write custom follow-up emails or replies directly to suppliers, auto-selects recipient emails from known suppliers, pre-fills context-aware subject lines, attaches files, and immediately dispatches outbound SMTP emails. Dispatched emails are instantly recorded into the communication timeline.
  - **Strict 1-Quote AI Extraction Policy**: The inbound AI parsing worker only extracts quotation terms from initial inbound supplier replies. Subsequent follow-up correspondence and chats between sales personnel and suppliers are logged directly to the email timeline without AI duplication or spurious quotation matrix modifications.
  - All Expected Receiving Date date-pickers enforce `min={today}` to disable selecting past dates.
  - Outbound WeChat RFQ engine automatically resolves supplier 11-digit mobile numbers to WeCom User IDs via Tencent API using `httpx`.
  - Supabase Cloud Storage integration handles all quotation PDF attachments.
  - Full RFQ status progression: `DRAFT` $\rightarrow$ `SENT_TO_SUPPLIERS` $\rightarrow$ `QUOTES_RECEIVED` $\rightarrow$ `UNDER_EVALUATION` $\rightarrow$ `APPROVED` $\rightarrow$ `ORDER_PLACED` $\rightarrow$ `CLOSED`.
  - Side-by-side vendor quotation comparison matrix with lowest bid and fastest turnaround highlighting.
  - Multimodal AI quote extractor parsing PDFs, Excel sheets, and email text into structured bids (`ExtractedQuotation`).
  - 1-Quote negotiation iteration tracking and turnaround time metrics.

### 8.9. Automated Inbound IMAP Email Worker
- **File:** `backend/app/inquiries/email_inbound_worker.py`
- **Features:** Background daemon running every 60 seconds. Connects via secure IMAP, checks for inquiry reference tokens in email subjects/headers, downloads quote attachments, triggers AI extraction, and logs quotation bids automatically. Avoids duplicate processing via `processed_email_ids.json`.

### 8.10. Master Shipment Planning Grid & Container Calculations
- **Endpoints:** `GET /planning/sheets`, `POST /planning/sheets`, `GET /planning/sheets/{id}/grid`, `GET /planning/sheets/{id}/filter-values`, `GET /planning/organization-search`, `POST /planning/rows`, `POST /planning/columns`, `PATCH /planning/cells`, `POST /planning/container-calc`.
- **Features:**
  - Dynamic grid model (`planning_sheets` $\rightarrow$ `planning_rows` $\rightarrow$ `planning_columns` $\rightarrow$ `planning_cells`).
  - Column data types (`TEXT`, `NUMBER`, `DATE`, `BOOLEAN_YN`) and source types (`MANUAL`, `LINKED_LOOKUP`, `AGGREGATE`, `FORMULA_CALCULATION`).
  - **Organization-Wide Cross-Branch Search Bar**: Top-level search bar dynamically scans across all branches of the currently viewed organization (e.g. Inhyma Mumbai, Inhyma Ahmedabad, Inhyma Indore) via `/planning/organization-search`. Provides instant branch-wise result counts, previews matching items, filters the active grid live, and allows one-click switching to any branch tab.
  - **Full-Dataset Column Filtering & Live Search**: Filter popover dynamically queries distinct values and occurrence counts across all records on the sheet (1384+ items) via `/planning/sheets/{id}/filter-values` with debounced text search, ensuring unrendered and newly created Product Master records are fully searchable.
  - **Automated Product Master Auto-Population**: Automatically syncs and materializes unlinked products for the sheet's organization and branch upon sheet load or filter search.
  - Cell status color tagging (e.g. `status-ordered`, `status-purchased`).
  - Container calculation engine computing total volume in CBM and payload weight across 20FT, 40FT, 40FT HC, and LCL container configurations.
  - Group-wise subcategory & product sorting.

### 8.11. Audit Trails & JSON Delta Change Diffing
- **Endpoints:** `GET /audit`, `GET /audit/{id}`, `GET /audit/export`.
- **Features:** Immutable audit repository capturing actor, IP, timestamp, action type, and field-level before/after JSON delta diffs across all business entities.

### 8.12. Recycle Bin (Universal Soft-Delete & Recovery)
- **Endpoints:** `GET /trash`, `POST /trash/{entity_type}/{id}/restore`, `DELETE /trash/{entity_type}/{id}/purge`.
- **Features:** Centralized Recycle Bin displaying soft-deleted records across all tables. One-click recovery restores records with full relational integrity. Permanent purge is restricted to Super Administrators.

### 8.13. Organization & System Profile
- **Endpoints:** `GET /organizations/profile`, `PATCH /organizations/profile`.
- **Features:** Enterprise legal identity, tax/VAT/TIN registration, official address, and base operational currency.

### 8.14. Organization Structure, Positions & Reporting Hierarchy
- **Files:** `backend/app/org_structure/`.
- **Architecture:** Unifies workforce identity into `User` (`has_login` boolean) and department management into `Role` (`code`, `parent_department_id`). Complemented by dedicated organizational modules:
- **Positions (`/positions`):** Designations/titles (e.g. "Sales Manager", "Marketing Advisor"). Managed via `Position` and assigned to users via `employee_position_assignments` (supporting PRIMARY, SECONDARY, ACTING, TEMPORARY roles). Holds no permission or reporting logic. Creation and updates support case-insensitive lifecycle status (`ACTIVE`, `INACTIVE`, `ARCHIVED`).
  - **Employee Assignment Count & Deletion Lock:** `GET /positions` and `GET /positions/all` dynamically aggregate active assignment counts (`employee_count`). If any employees currently hold a position (`employee_count > 0`), the position's delete button is completely frozen and locked on the UI with a lock icon, `cursor: not-allowed`, tooltip warning, and an explanatory modal alert preventing deletion. Server-side deletion enforcement (`PositionService.delete`) strictly rejects deletions with HTTP 409 Conflict if active assignments exist.
- **Department Leadership:** `department_leadership_assignments` records who manages/heads a department (`department_id` references `roles.id`, `employee_id` references `users.id`). The same user may lead multiple departments; a department may have multiple leadership assignees.
- **Reporting Structure (`/reporting`):** Person-to-person reporting lines in `employee_reporting_relationships` (`employee_id` and `manager_employee_id` referencing `users.id`). Supports relationship types (`PRIMARY_REPORTING`, `FUNCTIONAL_REPORTING`, `PROJECT_REPORTING`, `DOTTED_LINE`, `TEMPORARY_REPORTING`) and optional department scoping.
  - **Mandatory Server-Side Cycle Prevention:** `ReportingService.would_create_cycle` verifies the reporting graph before any row is saved, immediately rejecting self-reporting (`A -> A`) and circular chains (`A -> B -> C -> A`) with a 409 Conflict.
  - **Direct Reports Reassignment:** `POST /reporting/reassign-direct-reports/{manager_id}` allows reassigning all direct reports before deactivating a manager.
  - **Set / Move Primary Manager (Org Chart):** `POST /reporting/set-manager/{employee_id}` updates an employee's primary reporting manager in a single atomic transaction, validating cycle prevention and returning the updated relationship.
- **Dynamic Org Chart (`GET /reporting/org-chart`):** Renders the multi-level reporting tree in `/org-chart` using active `PRIMARY_REPORTING` relationships resolved dynamically against `UserRepository.list_all()`, including node `relationship_id`.

### 8.15. Enterprise Work Management & Task Module (Integrated ERP Architecture)
- **Endpoints:**
  - Tasks Core: `GET /tasks` (supports `view`, `department_id`, `status`, `priority`, `assignee_id`, `due_date_to`, `search`), `POST /tasks`, `GET /tasks/escalate-options`, `GET /tasks/{id}`, `PATCH /tasks/{id}`, `DELETE /tasks/{id}`, `GET /tasks/{id}/timeline`.
  - File & Media Storage: `POST /tasks/upload-file` (multipart upload handling documents and voice note audio blobs via Supabase/local fallback storage).
  - Task Attachments: `POST /tasks/{id}/attachments` (add attachment), `DELETE /tasks/attachments/{attachment_id}` (delete attachment).
  - Voice Notes: `POST /tasks/{id}/voice-notes` (record and persist audio voice notes with duration).
  - Hold Lifecycle & Expiry Worker: `POST /tasks/check-holds` (automated / periodic scanner flagging expired holds and dispatching notifications).
  - Assignment & Watchers: `POST /tasks/{id}/assign` (supports `OWNER`, `ASSIGNEE`, `WATCHER` roles).
  - Mini-Task Subtasks: `POST /tasks/{id}/subtasks`, `PATCH /tasks/subtasks/{subtask_id}`, `DELETE /tasks/subtasks/{subtask_id}`.
  - Subtask Collaboration: `GET /tasks/subtasks/{subtask_id}/comments`, `POST /tasks/subtasks/{subtask_id}/comments`, `GET /tasks/subtasks/{subtask_id}/attachments`, `POST /tasks/subtasks/{subtask_id}/attachments`.
  - Multi-Escalation Engine: `POST /tasks/{id}/escalate` (records unlimited escalations in `task_escalations`).
  - Escalation Collaboration: `GET /tasks/escalations/{escalation_id}/comments`, `POST /tasks/escalations/{escalation_id}/comments`.
  - Discussion Comments: `POST /tasks/{id}/comment` (supports text, attached files, and voice notes).
  - Notification Engine: `GET /notifications`, `GET /notifications/unread-count`, `POST /notifications/{id}/read`, `POST /notifications/read-all`.
- **Navigation & Unified Page Architecture:**
  - **Single Sidebar Item:** Located under `WORK MANAGEMENT -> Tasks` (`/tasks`). Separate standalone routes (`/tasks/my`, `/tasks/kanban`, `/tasks/calendar`) seamlessly redirect to `/tasks?tab=...` preventing bookmark breakage.
  - **Standard ERP Page Layout:** Fully matches `Users.tsx` layout standards:
    - Breadcrumb trail: `Dashboard / Work Management / Tasks`.
    - Page Header: Title, descriptive subtitle, and primary `+ New Task` action button.
    - **Permission Scope Bar:** Interactive scope selector matching user permissions:
      - `Own Tasks` (`scope=OWN`): Logged-in user's personal tasks.
      - `Selected Department` (`scope=SELECTED_DEPT`): Scoped to a specific department filter.
      - `Multiple Departments` (`scope=MULTI_DEPT`): Scoped across managed departments.
      - `Entire Organization` (`scope=ENTIRE_ORG`): Organization-wide directory (requires `task.organization_view` or Super Admin).
    - Unified Filters Bar: Search query, Status filter (including `⏸️ On Hold`), Priority filter, Assignee picker, Overdue toggle, and Live Refresh button.
    - Five Integrated View Tabs:
      1. `My Tasks` (`tab=my`): Tasks where current user is an assignee, watcher, or creator.
      2. `Department` (`tab=department`): Department-wide tasks. Includes secondary sub-view toggle:
         - `📋 List`: Standard paginated table with sort and actions.
         - `📊 Kanban`: 4-column board scoped to the department.
         - `📅 Calendar`: Monthly calendar matrix scoped to the department.
         - `📈 Analytics`: Real-time command center displaying 5 summary metric cards (Total, In Progress, On Hold, Completed, Overdue), Department Completion Rate progress bar, and Team Member Workload & Delivery breakdown table.
      3. `Organization` (`tab=organization`): Organization-wide task directory across all departments.
      4. `Kanban` (`tab=kanban`): Interactive 4-column workflow board (`TODO` To Do, `IN_PROGRESS` In Progress, `ON_HOLD` On Hold, `DONE` Completed) with subtask progress indicators, On Hold amber banner, quick status change dropdown, and assignee avatar stacks.
      5. `Calendar` (`tab=calendar`): Monthly scheduling grid mapping tasks to Start Dates (🟢), Due Dates (🔴), and Hold Until Deadlines (⏸️), with month navigation and click-to-view drawer integration.
- **Universal Searchable Autocomplete Dropdowns (`SearchableUserSelect.tsx`):**
  - High-performance autocomplete component replacing all static HTML select dropdowns.
  - Features real-time search filtering across user full name, username, and department tags.
  - Instantly auto-closes upon user selection.
  - Renders removable avatar chips: `[ (Avatar) Full Name (Department) ✕ ]`.
  - Full keyboard navigation support (`ArrowDown`, `ArrowUp`, `Enter`, `Escape`).
  - Universally utilized for:
    - Task Assignees
    - Task Watchers
    - Subtask Assignees
    - Escalation User Picker
    - Department Filter & Scope Pickers
- **Enterprise Task Creation & Field Specifications (`CreateTaskModal.tsx`):**
  - **Real ERP Users Integration:** All user pickers strictly populate from `/api/v1/users` (no mock data).
  - **Enforced Default Status:** Status is strictly set to `TODO` by default with no status picker during creation.
  - **Multiple Assignees & Watchers:** Multi-selection autocomplete pickers with duplicate prevention.
  - **Time Boundaries & Date Validation:** Dedicated `start_date` and `due_date` date pickers. Client and backend Pydantic `@model_validator` strictly enforce `due_date >= start_date` (rejecting inversions with HTTP 422).
  - **Foreign Key Relational Verification:** Nonexistent `parent_task_id` or `sprint_id` UUIDs are verified before insert, throwing `ValidationException` instead of database 500 errors.
  - **Hardened Modal Framework Lifecycle:** Strict `isOpen` guard prevents orphan DOM overlays; global `Escape` key listeners and backdrop-click handlers dismiss modals cleanly; document body scroll is automatically locked (`overflow: hidden`) while open and restored upon close/unmount with zero interaction blocking.
  - **Interactive Attachment Preview Modal (`AttachmentList.tsx`):** Built-in preview modal supporting in-browser rendering for images, videos, audio blobs, and PDF documents, complete with download shortcuts, `Escape` key dismissals, and background blur cleanup.
  - **Unlimited Mini-Task Subtasks:** Integrated subtask builder tracking title, description, priority, dates, and multiple assignees.
  - **Initial Escalation during Creation:** Optional toggle enabling instant escalation upon creation to `Reporting Manager`, `Department Manager`, or `Organization User` with mandatory reason and optional deadline.
- **On Hold System & Expiration Alerts:**
  - Database schema contains `hold_reason: str` and `hold_until: date`.
  - First-class `ON_HOLD` lifecycle status with distinct amber styling across Table, Kanban, and Drawer.
  - Task Drawer includes dedicated On Hold modal, interactive `⏸️ Put On Hold` / `✏️ Edit Hold` actions, and `▶️ Resume Task` button.
  - Automated hold expiration detection (`POST /tasks/check-holds`) alerting managers and assignees when a hold date has lapsed.
- **Comprehensive Task Drawer (5 Tabs):**
  - Slide-out full-height drawer (`TaskDrawer.tsx`) supporting:
    1. `Overview`: Inline editable title and description, progress bar (% completed based on mini-tasks), On Hold banner with resume/edit controls, status/priority selectors, start/due dates, assignees chips with inline autocomplete add/remove, watchers chips with inline autocomplete add/remove, **Task Attachments section** with direct file upload, file type icons, size display, direct download/view link, and deletion; and **Task Voice Notes section** with native audio recorder, playback player, author, and timestamp.
    2. `Mini-Tasks`: Interactive subtask checklist cards showing status badges, priority badges, start/due dates, assignee chips, check-off toggles, inline subtask creation form, and **Subtask-Level Collaboration Section** providing independent comment threads and dedicated subtask file attachments.
    3. `Escalations`: Complete history of all past escalations on the task displaying escalation index, escalation type, escalated by, escalated to, timestamp, target due date, explanation reason, persistent **`+ New Escalation` button**, and **Escalation-Level Discussion Section** providing independent resolution discussions under each escalation card.
    4. `Comments`: Real-time rich discussion thread with standardized `CommentComposer` supporting text, file attachments, and in-browser voice note recording (`<audio controls>` player and file chips inside comment cards).
    5. `Activity Timeline`: Vertical timeline synthesized dynamically by `GET /tasks/{id}/timeline`, rendering chronological events (`TASK_CREATED`, `USER_ASSIGNED`, `SUBTASK_CREATED`, `TASK_ESCALATED`, `SUBTASK_COMPLETED`, `COMMENT_ADDED`, `ATTACHMENT_ADDED`, `VOICE_NOTE_ADDED`) with actor attribution and relative time format.
- **Multi-Level Escalation System & Unlimited Escalation Chain:**
  - Supports escalating tasks to:
    1. `Reporting Manager`: Dynamically resolved via active `employee_reporting_relationships`.
    2. `Department Manager`: Dynamically resolved via `department_leadership_assignments`.
    3. `Organization User`: Any active ERP user selected from the directory.
  - Unlimited escalations per task stored chronologically in `task_escalations` table (never overwritten).
  - Persistent `+ New Escalation` button in Task Drawer header allows initiating new escalations at any stage.
  - Automatically dispatches in-app bell notifications and real-time WebSocket events (`TASK_ESCALATED`) to target assignees.
- **Enterprise Collaboration & Stage-Level Discussions:**
  - Independent comment thread & attachments on each Subtask (`task_subtask_comments`, `task_subtask_attachments`).
  - Independent discussion thread on each Escalation (`task_escalation_comments`).
  - Unified file attachment system supporting PDF, Excel, Word, Images, ZIP, and Videos.
  - Native browser audio recording via HTML5 `MediaRecorder` API with live waveform animation and playback preview.
- **Real-Time Notification Bell & WebSocket Sync:**
  - Application topbar (`AppShell.tsx`) features an unread notification counter badge updated live via WebSocket (`NOTIFICATION_RECEIVED`, `TASK_ASSIGNED`, `TASK_ESCALATED`, `TASK_HOLD_EXPIRED`, `TASK_ATTACHMENT_ADDED`, `TASK_VOICE_NOTE_ADDED`).
  - Dropdown panel displays notification details, time elapsed, mark-as-read, and mark-all-as-read actions.
- **Auditing, Soft-Delete & RBAC Scoping:**
- **Enterprise Tasks V2.0 — Jira-Inspired Work Management Upgrade:**
  - **Issue Types System:**
    - First-class `issue_type` field supported across database (`tasks.issue_type`), schemas, routes, and UI.
    - Supported Issue Types: `TASK`, `BUG`, `IMPROVEMENT`, `STORY`, `EPIC`, `APPROVAL` (default: `TASK`).
    - Color-coded badges rendered across table views, kanban cards, calendar pills, gantt bars, and the task drawer.
    - Full filter integration in `GET /api/v1/tasks?issue_type={type}` and quick-chip filters.
  - **Epic Hierarchy & Progress Rollup:**
    - Support for 3-tier hierarchy: `Epic -> Task -> Subtask`.
    - Tasks can select any active Epic via searchable parent selector (`parent_task_id`).
    - Epic completion percentage (`progress_percent`) automatically rolls up from child task completion status:
      $$\text{Epic Progress \%} = \left( \frac{\text{Completed Child Tasks}}{\text{Total Child Tasks}} \right) \times 100$$
    - If a task has no child tasks, progress rolls up based on mini-task subtask completion.
    - Parent task titles are dynamically rendered and clickable as navigational links.
  - **Color-Coded Labels Engine:**
    - Reusable labels stored in `task_labels` (`name`, `color`, `description`) linked via `task_label_links`.
    - APIs: `GET /tasks/labels`, `POST /tasks/labels`, inline creation in task drawer and creation modal.
    - Visual color-coded pill chips rendered on table rows, drawer headers, and filterable via `GET /tasks?label_id={id}`.
  - **Backlog & Sprints Lifecycle Management:**
    - Database entity `task_sprints` (`name`, `goal`, `start_date`, `end_date`, `status: PLANNED|ACTIVE|COMPLETED|FUTURE`).
    - `Task.sprint_id` foreign key. Tasks with `sprint_id IS NULL` represent the product **Backlog**.
    - APIs: `GET /tasks/sprints`, `POST /tasks/sprints`, `PATCH /tasks/sprints/{id}`, `DELETE /tasks/sprints/{id}`.
    - Primary page tabs in `TasksPage.tsx`: `Backlog`, `Current Sprint`, `Future Sprints`, `Gantt Timeline`, `Team Workload`.
  - **Reusable Task Templates:**
    - Entity `task_templates` with prefilled `issue_type`, `priority`, `default_subtasks`, `default_labels`, `default_watcher_ids`, and `is_shared`.
    - APIs: `GET /tasks/templates`, `POST /tasks/templates`, `PATCH /tasks/templates/{id}`, `DELETE /tasks/templates/{id}`.
    - Template picker banner in `CreateTaskModal.tsx` auto-populates title, description, subtasks, priority, and labels upon selection.
  - **@User Mentions & Emoji Reactions:**
    - Comment and task discussions parse `@username`, `@email`, and `@display_name` tokens into `task_mentions` records.
    - Triggers in-app notification bell and WebSocket event `TASK_MENTION` to mentioned team members.
    - Emoji reactions (`TaskReaction`) toggleable on both tasks and comments with count aggregation and user reaction indicators (`👍`, `❤️`, `👀`, `🚀`, etc.).
  - **Drag-and-Drop & Clipboard Screenshot Paste:**
    - Native `Ctrl+V` clipboard image pasting in `CommentComposer.tsx` and `CreateTaskModal.tsx`.
    - Drag-and-drop file upload target zones with visual hover feedback and direct storage upload.
  - **User-Specific Saved Filters:**
    - Entity `task_saved_filters` (`user_id`, `name`, `filter_criteria`, `is_default`).
    - APIs: `GET /tasks/saved-filters`, `POST /tasks/saved-filters`, `PATCH /tasks/saved-filters/{id}`, `DELETE /tasks/saved-filters/{id}`.
    - Quick-bar chips in `TasksPage.tsx` allowing instant switching between saved personal or team filter presets.
  - **Row Quick Action Toolbar:**
    - Interactive table row actions for high-velocity triage without opening drawers:
      - `+Me` (Assign Me): Instantly adds current user to task assignees.
      - `✓` (Complete): Instantly transitions task status to `DONE`.
      - `📄` (Duplicate): Clones task with subtasks, labels, and watchers.
      - `⚡` (Escalate): Opens escalation modal.
      - `🗑️` (Delete): Prompts confirmation and soft-deletes task.
  - **Floating Bulk Operations Action Bar (`<BulkActionBar>`):**
    - Checkbox selection in table header and rows with selection counter.
    - Floating docked bottom toolbar supporting mass operations:
      - Mass Status change (`TODO`, `IN_PROGRESS`, `DONE`)
      - Mass Priority change (`LOW`, `MEDIUM`, `HIGH`, `CRITICAL`)
      - Mass Issue Type assignment
      - Mass Sprint assignment
      - Mass Label addition / removal
      - Mass Assignment
      - Mass Soft-Delete
    - Backend API: `POST /api/v1/tasks/bulk` (`TaskBulkActionRequest`).
  - **Task Dependencies & Cycle Blocker Detection:**
    - Entity `task_dependencies` with `relationship_type` (`BLOCKS`, `BLOCKED_BY`, `RELATES_TO`).
    - Graph traversal cycle detection preventing circular blocker chains (e.g., A blocks B blocks A) with `ValidationException`.
    - Dedicated Dependencies tab in `TaskDrawer.tsx` showing blockers, blocked tasks, and related links.
  - **Team Workload Dashboard & Capacity View:**
    - Management dashboard visualizing team allocation and burnout risks.
    - `GET /api/v1/tasks/workload`: Aggregates open, in-progress, completed, overdue, and critical tasks per team member.
    - `GET /api/v1/tasks/capacity`: Renders interactive date matrix mapping daily scheduled task loads across active dates.
    - UI component `<TaskWorkloadDashboard>` embedded in Tasks page.
  - **Formal Approval Workflow:**
    - Dedicated `APPROVAL` issue type and `approval_status` (`NONE`, `PENDING_APPROVAL`, `APPROVED`, `REJECTED`).
    - `POST /api/v1/tasks/{id}/submit-approval`: Submits task to designated manager with review notes, transitions status to `PENDING_APPROVAL`.
    - `POST /api/v1/tasks/{id}/action-approval`: Approver approves (transitions to `DONE`) or rejects (reverts to `IN_PROGRESS`) with audit trail.
    - Interactive approval banner in `TaskDrawer.tsx` with one-click `Approve` and `Reject` buttons.
  - **Interactive SVG Gantt Timeline View (`<TaskGanttView>`):**
    - High-performance horizontal SVG timeline rendering task start and due dates.
    - Progress fill, issue type color coding, dependency connector lines, today guideline, and day/week scale toggles.
  - **Global Universal Search Integration:**
    - Task entity integrated into `/api/v1/search?q=` across task titles, descriptions, linked label names, and comment message bodies.
    - Surfaces directly in ERP topbar global search with `[ISSUE_TYPE]` badge and direct deep-link.

### 8.16. Inventory: Product Stock Management (Inhyma Multi-Warehouse Matrix)
- **Files:**
  - Backend: `backend/app/inventory/models.py`, `backend/app/inventory/stock_service.py`, `backend/app/inventory/routes.py`, `backend/app/inventory/schemas.py`.
  - Frontend: `frontend/src/pages/ProductStockPage.tsx`, `frontend/src/pages/StockTransactionDetailPage.tsx`, `frontend/src/styles/productStock.css`, `frontend/src/components/SortHeader.tsx`.
- **Endpoints:**
  - `GET /api/v1/inventory/product-stock` (and `/product-stock`, `/product-stock/list`): Lists up to `5000` active products from `Product` (`Product.deleted_at.is_(None)`) outer-joined with `ProductStock`, `ProductCategory`, `ProductSubCategory`, `Brand`, `UnitOfMeasurement`, and `Tax`, returning `filter_options` (`categories`, `sub_categories` with parent `category`, `brands`), live `breakup_flags`, and real Product Master packaging/dimensions/pricing fields without synthetic cost or reserved fields.
  - `GET /api/v1/inventory/product-stock/{id}`: Resolves either `ProductStock.id` or `Product.id` to return detailed warehouse balances and metadata.
  - `GET /api/v1/inventory/product-stock/breakup`: Used by physical, transit, and ordered warehouse `(i)` info popups to display open Sale Orders and incoming consignments/transfers with FIFO deduction.
- **Header Controls & Inhyma 15-Column Title-Case Warehouse Matrix:**
  - Top-right header displays dark slate Funnel filter toggle (`#556987`, collapsed by default) and golden-amber `Export` button (`#f59e0b` / hover `#d97706`, `.btn-imp-exp.stock-btn-export` with SVG download icon matching Companies `Imp / Exp`).
  1. `Sr. No.`
  2. `Product Name (As Per Tally)` (opens `Product Details` `SideDrawer` on `/product-stock/list`; navigates to `/stock-transaction/list/:id` on `/reports/stock-transactions` / `/transaction-report/list`)
  3. `Product Code`
  4. `Brand`
  5. `Sub Category`
  6. `Mumbai` (soft pink `#f9e7e9`)
  7. `Mumbai Transit` (warm beige-grey `#efece6`)
  8. `Mumbai Ordered` (medium grey `#dedede`)
  9. `Ahmedabad` (soft pink)
  10. `Ahmedabad Transit` (warm beige-grey)
  11. `Ahmedabad Ordered` (medium grey)
  12. `Indore` (soft pink)
  13. `Indore Transit` (warm beige-grey)
  14. `Indore Ordered` (medium grey)
  15. `Total Qty`: $\sum \text{Physical Warehouses} + \sum \text{Transit Warehouses} + \sum \text{Ordered Warehouses}$
- **Physical vs. Transit Business Invariants:**
  - **Strict Physical Non-Negative Rule:** Physical warehouses (`is_physical(warehouse) == True`) strictly forbid negative stock. Any sales order or adjustment attempting to drive stock below zero throws `409 Conflict`.
  - **Transit / Ordered Advance Booking Tolerance:** Virtual warehouses (`_transit`, `_ordered`) allow negative balances when goods are pre-allocated against incoming purchase orders.
- **Database Integrity & Concurrency Architecture:**
  - **Unique Index:** `uq_product_stocks_product_id` on `product_stocks(product_id)` guarantees one stock ledger row per product master record.
  - **Advisory Locks:** `pg_advisory_xact_lock` serializes stock row initialization under high concurrent request bursts.
  - **Nested Savepoint Recovery:** Recovers gracefully from race conditions using `begin_nested()` to handle duplicate key collisions.
  - **Metadata Segregation:** `NON_WAREHOUSE_COLUMNS = {"reorder_level", "moq"}` prevents non-inventory integers from contaminating physical stock aggregation formulas.
- **Container Inwarding via Stock Transfer (`Receive to Main WH` & `StockTransferPage.tsx`):**
  - Frontend (`/stock-transfer`, `/transfer/list`) header displays Funnel filter toggle, `+ ADD NEW`, golden-amber `Export` button (`.btn-imp-exp` with download SVG icon; replaces legacy `Imp / Exp`), and `Bulk Actions ▾` dropdown.
  - Endpoint `POST /inventory/stock-transfer/{id}/receive-to-main` atomically decrements the source transit warehouse column and increments the destination physical warehouse column when offloaded.

#### 8.16.1. Inventory: Product Re-Order Matrix, Branch-Scoped Shortfall & FIFO Stock Breakup
- **Files:**
  - Backend: `backend/app/inventory/routes.py`, `backend/app/inventory/schemas.py`, `backend/app/inventory/stock_service.py`.
  - Frontend: `frontend/src/pages/ProductReorderPage.tsx`, `frontend/src/styles/productReorder.css`, `frontend/src/lib/api.ts`.
- **Endpoints:**
  - `GET /api/v1/inventory/product-reorder` (and `/product-reorder`, `/product-reorder/list`): Lists up to `5000` active products outer-joined with `ProductStock`, `ProductCategory`, `ProductSubCategory`, `Brand`, `UnitOfMeasurement`, and `Tax`, returning `filter_options`, `breakup_flags`, `warehouse_thresholds`, and branch-scoped or global shortfall metrics.
  - `PATCH /api/v1/inventory/product-reorder/{product_id}`: Updates inline `reorder_level` and/or `minimum_order_quantity` (`MOQ`) either globally (`All` / omitted) or scoped to a specific branch (`Mumbai`, `Ahmedabad`, `Indore`) stored in `ProductStock.orders_info` (`_type == "wh_reorder"`).
  - `GET /api/v1/inventory/product-stock/breakup`: Returns role-safe physical Sale Order bookings (`order_id`, clickable SO PDF without `unit_price` leakage) or Transit/Ordered incoming `ImportPurchase` consignments + active inter-warehouse `StockTransfer`s (`pending` / `confirmed` / `in transit`) with FIFO deduction against advance-booked `SaleOrder`s.
- **Core Business Architecture:**
  - **Branch-Scoped Replenishment Math:** Selecting `Mumbai` (default), `Ahmedabad`, or `Indore` in the Warehouse bar evaluates `Short Fall = max(0, Re-Order - (city + city_transit + city_ordered))` and `Order To Be Place = 0 if Short Fall == 0 else max(Short Fall, MOQ)` using branch-specific thresholds, while `All Warehouses` evaluates against global `Total Qty`.
  - **Header Action Layout & Export Theme:** Renders the slate Filter funnel button (`reorder-btn-filter`) first followed by a standalone golden-amber `#f59e0b` `Export` button (`btn btn-imp-exp reorder-btn-export`, hover `#d97706`, UTF-8 BOM CSV export) on the right, matching Companies and Product Stock.
  - **Transaction-Driven `ⓘ` Badges (`breakup_flags`):** Computed from live open `SaleOrder`s, active `ImportPurchase`s, and in-transit `StockTransfer`s so `0` physical stock with an open Sale Order accurately displays `0 ⓘ`, while unbooked physical stock omits `ⓘ`.

#### 8.16.2. Reports: Product Stock Transactions & Per-Product Stock Transaction Ledger
- **Files:**
  - Backend: `backend/app/inventory/routes.py` (`get_product_stock_transactions`), `backend/app/inventory/schemas.py` (`StockTransactionLedgerItemRead`).
  - Frontend: `frontend/src/pages/ProductStockPage.tsx` (Master List mode on `/reports/stock-transactions` & `/transaction-report/list`; legacy `/reports/goods-expected` removed from the `REPORTS` sidebar in `nav.ts` and redirected to `/reports/stock-transactions`), `frontend/src/pages/StockTransactionDetailPage.tsx` (`/stock-transaction/list/:id` & `/reports/stock-transactions/:id`), `frontend/src/styles/productStock.css`, `frontend/src/lib/api.ts` (`InventoryApi.getProductStockTransactions`).
- **Endpoints:**
  - `GET /api/v1/inventory/stock-transactions/{product_ref}` (and aliases `/api/v1/stock-transaction/list/{product_ref}`, `/api/v1/stock_transaction/list/{product_ref}`, `/api/v1/inventory/product-stock/{product_ref}/transactions`): Resolves `Product.id` UUID, `ProductStock.id` UUID, `ProductStock.sr_no`, or `Product.product_code` and aggregates chronological stock movements across all 5 transactional engines:
    1. **Sale Orders (`SaleOrder` / `SaleOrderItem`):** Records `Sale` (`- qty`) whenever stock was deducted (`stock_applied == True` or confirmed/cancelled lifecycle) with **bold `party_name`** (`company_name` / `buyer_name`) below the SO title, plus `Sale Cancel` (`+ qty`) when cancelled or soft-deleted.
    2. **Stock Adjustments (`StockAdjustment` / `StockAdjustmentLineItem`):** Records `Stock IN` (`+ qty`) / `Stock OUT` (`- qty`) formatted as `Stock In/Out For Purpose <Purpose> (Adjustment Order #<No>)`, plus soft-delete reversals.
    3. **Local Purchases (`LocalPurchase` / `LocalPurchaseItem`):** Records `Local Purchase` (`+ qty`) upon confirmation (`stock_applied == True`), plus cancellation reversals.
    4. **Import Purchases (`ImportPurchase` / `ImportPurchaseItem`):** Records `Import Purchase` (`+ qty`) into `<City> Ordered` / `<City> Transit` / physical warehouse, plus cancellation reversals.
    5. **Stock Transfers (`StockTransfer` / `StockTransferLineItem`):** Records dual-leg `Transfer OUT` (`- qty` from origin) and `Transfer IN` (`+ qty` into destination / transit), plus cancellation reversals.
- **UI Architecture:**
  - **Screen 1 — Master List (`Product Stock Transactions`):** Collapsible filter panel (`Category`, cascading `Sub Category`, `Brand`, `Is Negative Stock`) off by default and toggled via the top-right Funnel button, right-aligned search card, 15 Title-Case columns with distinct pink/transit-beige/ordered-grey tints, and product name links navigating to `/stock-transaction/list/:id`.
  - **Screen 2 — Per-Product Ledger (`<Product Name> Stock`):** Top-right Funnel filter toggle (`Warehouse`, `Type`, `From Date`, `To Date`) + golden-amber `Action ▾` menu (`Export to Excel (.xlsx)`, `Export to CSV (.csv)`, `Add Stock Adjustment`, `Add Stock Transfer`, `← Back to Stock Transactions`), `AVAILABLE QTY` KPI card (dynamically scoped when filtered by warehouse), `Items/Page` (`10` default, `25`, `50`, `100`) + instant `Search...`, 7 sortable columns (`ID`, `Title` with clickable document link + bold party/company name, `Type` pill badge, `Warehouse`, signed `Quantity` `- 1` / `+ 1`, `Created By`, `Transaction Date` IST `DD-MM-YYYY hh:mm AM/PM`), and `Showing X To Y Of Z Entries` + `Previous | 1 | Next` pager.

### 8.17. Inventory: Stock Adjustment & Order PDF Generation
- **Files:**
  - Backend: `backend/app/inventory/models.py`, `backend/app/inventory/routes.py`, `backend/app/inventory/stock_service.py`.
  - Frontend: `frontend/src/pages/StockAdjustmentPage.tsx` (top header with Funnel filter toggle, `+ Add New ▾` dropdown, and golden-amber `Export` `.btn-imp-exp` button with download SVG icon; no `Bulk Actions`), `frontend/src/pages/AddAdjustmentOrderPage.tsx`, `frontend/src/lib/stockAdjustmentPdf.ts`.
- **Endpoints:**
  - `GET /api/v1/inventory/stock-adjustment`: Paginated list of server-authoritative stock adjustments with date range filters, client name search, and type filtering (`IN` / `OUT`).
  - `POST /api/v1/inventory/stock-adjustment`: Atomically creates an adjustment voucher and updates target warehouse balances.
  - `DELETE /api/v1/inventory/stock-adjustment/{id}`: Soft-deletes adjustment voucher and atomically reverses the inventory balance in the database.
  - `GET /api/v1/adjustment/adjustment-order-pdf/{id}`: Generates branded PDF voucher.
- **Server-Authoritative Real-Time Architecture:**
  - **Zero In-Memory Fallbacks:** All adjustment entries and stock lookups execute against PostgreSQL tables; legacy client localStorage mocks are completely removed.
  - **Atomic Stock Reversal:** Deleting an adjustment voucher executes an inverse delta (`move_stock(-sign * qty)`), immediately restoring warehouse inventory levels.
  - **Indexed Date Column:** `adjustment_dt` (`Date` type) indexed for high-performance range queries.
  - **Client Autocomplete:** Typeahead integration automatically extracts and validates client companies from the active buyer/company directory.
  - Smoothly animates into view from the left viewport edge (`side-drawer--left`) when clicking any table row.
  - **Header:** Displays Invoice/Reference number (e.g., `ADJ-2026-001`), adjustment type pill badge (`Stock IN` green / `Stock OUT` red), and close `✕` button.
  - **Metadata Fields Grid:**
    - `Client Name`: Customer or vendor entity name associated with the transaction.
    - `Warehouse`: Target storage warehouse depot.
    - `Invoice No.`: Official invoice or adjustment reference code.
    - `Adjustment Type`: IN / OUT badge.
    - `Date`: Formatted adjustment date (`DD-MM-YYYY`).
    - `Purpose`: Purpose categorization tag.
    - `Created By`: Author employee name or user email.
    - `Created At`: Audit creation timestamp (`DD-MM-YYYY HH:mm`).
    - `Total Amount`: Formatted total transaction sum (e.g., `₹ 2,45,000.00`).
  - **Line Items Detail Table (Full 8-Column Schema):**
    - Columns: `Sr No.`, `Item(S)`, `Category`, `HSN`, `GST`, `Quantity`, `Unit Price`, `Total Price`.
    - `Grand Total` Footer Row: Formatted with light slate background (`#e2e8f0`), bold high-contrast label, and prominent emerald green currency amount (`#15803d`).
  - **Remarks Section:** Bordered callout card displaying administrative remarks, inspection notes, or approval reasons.
- **A4 Order PDF Generation Engine (`stockAdjustmentPdf.ts`):**
  - Engineered with `jsPDF` and `jspdf-autotable`.
  - Strict compliance with corporate invoice and inventory documentation standards:
    - Corporate Header: Inhyma Solutions logo, legal company name, GSTIN, PAN, and registered office address.
    - Document Title Banner: High-contrast `STOCK ADJUSTMENT ORDER` header with barcode / voucher ID.
    - Two-Column Voucher Details: Voucher No, Date, Type, Purpose, Warehouse, Client/Party Name.
    - AutoTable Line Items Matrix: Formatted 8-column table with alternating row striping, exact cell padding, and numeric right-alignment for quantities and currency amounts.
    - Financial Summary Block: Subtotal, GST breakup, and bold highlighted Grand Total box.
    - Remarks Callout & Dual Signatory Block: "Prepared By" and "Authorized Signatory" signature lines with official stamp boxes.

### 8.18. Contact: Companies & Multi-Contact Directory
- **Files:** `backend/app/companies/routes.py`, `backend/app/companies/service.py`, `backend/app/companies/repository.py`, `backend/app/companies/schemas.py`, `backend/app/companies/models.py`, `frontend/src/pages/Companies.tsx`, `frontend/src/components/ImportWizard.tsx` (`ImpExpDropdown` with vector SVG icon badges for `SAMPLE FILE`, `IMPORT`, and `EXPORT`).
- **Endpoints:**
  - `GET /api/v1/companies`: Paginated list of enterprise companies with grade, potential, and search filters.
  - `POST /api/v1/companies`: Create company account with primary contact, tax identifiers, and full B2B intelligence profile.
  - `GET /api/v1/companies/{id}`: Retrieve detailed company profile, addresses, contacts, and extended intelligence.
  - `PATCH /api/v1/companies/{id}`: Update company information, credit terms, and status.
  - `DELETE /api/v1/companies/{id}`: Soft-delete company record and associated contacts.
  - `POST /api/v1/companies/{id}/contacts`: Add sub-contact person to company contact roster.
  - `PATCH /api/v1/companies/{id}/grade`: Quick-update corporate grade (A, B, C, D).
  - `PATCH /api/v1/companies/{id}/potential`: Quick-update client revenue potential rating.
  - `POST /api/v1/companies/import`: Bulk spreadsheet import for company directories.
  - `GET /api/v1/companies/export`: Export company database to Excel / CSV.
  - Legacy Aliases: `/user/addEdit`, `/user/addedit`.
- **Features & Data Architecture:**
  - **Comprehensive Legal & Tax Identifiers:** B2B corporate directory tracking Legal Name, Trade Name, GSTIN, PAN, TAN, and IEC codes.
  - **Commercial Terms & Rating:** Multi-tier company classifications, payment credit limits, credit terms (Net 30, Net 60, Advance), Grade (A-D), and Revenue Potential (High/Medium/Low).
  - **Extended Corporate Intelligence (Release 2026-09-29):**
    - `pincode`: 6-digit postal code for precision geographic indexing.
    - `district_id`: Direct relational foreign key linkage to District master (`districts.id`).
    - `company_category`: Corporate business role (Manufacturer, Trader, OEM, Service).
    - `product_manufacture_or_supply`: In-depth goods manufactured or supplied.
    - `machines_buying_from`: Competitor and vendor intelligence tracking for machinery.
    - `spares_buying_from`: Intelligence tracking for spare parts and tooling.
    - `products_interested`: Target demand and product interest areas.
    - `gst_registration_date`: Tax authority registration timestamp.
    - `age_of_company`: Operational tenure in years.
    - `social_media`: Dynamic JSON matrix `[{"platform": "LinkedIn", "url": "https://..."}, ...]` managed via interactive frontend repeater.
  - **Company Intelligence Specification Extensions (Release 2026-10-06):**
    - `monthly_turnover`: Estimated monthly turnover band, conditionally activated when Business Type (`company_type`) is selected.
    - `potential_reason`: Mandatory text justification required whenever `potential == "no"` explaining why the account is currently unqualified.
    - `potential_business_per_month`: Projected business band required whenever `potential == "yes"`.
    - **Direct Import From China Cluster:**
      - `direct_import_from_china`: Dedicated section restricted exclusively to B2B companies (`company_type == "B2B"`).
      - `monthly_import_volume`: Conditional monthly volume band (e.g. 5-10 L, 25-50 L), active only when `direct_import_from_china == "Yes"`.
      - `products_needed_for_imports`: Target sourcing product list, active only when `direct_import_from_china == "Yes"`.
      - Client-side helper `clearInapplicableCompanyFields()` automatically wipes dependent fields whenever parent conditions switch (e.g. B2B &rarr; B2C or Yes &rarr; No).
    - **Contact Birth Date, Anniversary Date & Age Calculation:**
      - Sub-contact model (`company_contacts`) stores `birth_date` and `anniversary_date` in `DD-MM-YYYY` format.
      - Automated client-side age computation (`computeAge()`) displays exact integer age alongside contact names.
  - **Cascading Address Hierarchy:**
    - Strict 3-level geographical cascade: State (`/masters/states/lookup`) ➔ District (`/masters/districts/lookup?state_id=...`) ➔ City (`/masters/cities/lookup?district_id=...&state_id=...`).
    - Selecting State clears and filters District; selecting District clears and filters City.
    - Dynamic City Addition: Adding a custom city persists the new entry in the City Master with both parent `state_id` and `district_id` references.
  - **Multi-Address Matrix:** Supports Billing Head Office, Factory/Plant, and Warehouse Delivery locations with PIN/ZIP validation.
  - **Real-Time Event Dispatching:** Dispatches WebSocket mutations (`company.created`, `company.updated`, `company.deleted`) on `module:companies` to synchronize active client sessions.

### 8.19. Task: Technical Tasks & Field Service Dispatch
- **Files:** `backend/app/technical_tasks/routes.py`, `backend/app/technical_tasks/service.py`, `backend/app/technical_tasks/repository.py`, `backend/app/technical_tasks/schemas.py`, `backend/app/technical_tasks/models.py`, `frontend/src/pages/technicalTasks/TechnicalTasksPage.tsx`.
- **Endpoints:**
  - `GET /api/v1/technical-tasks`: Paginated list of service tasks with tab status, call type, technician, city, and priority filters.
  - `GET /api/v1/technical-tasks/counts`: Summary status counts across tabs (`All`, `Pending`, `Allotted`, `Under Process`, `Completed`, `Cancelled`).
  - `POST /api/v1/technical-tasks`: Create new field service ticket or maintenance request.
  - `GET /api/v1/technical-tasks/{id}`: Retrieve full technical service task details.
  - `PATCH /api/v1/technical-tasks/{id}`: Update service ticket fields and customer complaints.
  - `PATCH /api/v1/technical-tasks/{id}/status`: Transition service ticket status with resolution remarks.
  - `DELETE /api/v1/technical-tasks/{id}`: Soft-delete technical task ticket.
  - `POST /api/v1/technical-tasks/bulk-delete`: Bulk soft-delete selected service tasks.
  - Legacy Aliases: `/technical-task/list`, `/technical-tasks`.
- **Features:**
  - Field service engineering dispatch tracking machine serial numbers, models, installation dates, and warranty status.
  - Status Tab Workflow: `All` $\rightarrow$ `Pending` $\rightarrow$ `Allotted` $\rightarrow$ `Under Process` $\rightarrow$ `Completed` (or `Cancelled`).
  - Call Type Classifications: `Installation`, `Preventive Maintenance`, `Breakdown Service`, `Warranty Inspection`, `Post-Warranty Overhaul`.
  - Service Modes: `On-Site Client Visit`, `Remote Diagnostic Support`, `Workshop Repair`.
  - Technician Allotment: Searchable technician assignment linked to employee directory with scheduled service visit dates.

#### 8.19.1. Technical Tasks: Payments Module (`/payments`) & Technician Collections
- **Files:**
  - Frontend: `frontend/src/pages/technicalTasks/PaymentsPage.tsx`, `frontend/src/pages/PaymentsPage.tsx`, `frontend/src/styles/payments.css`, `frontend/src/lib/technicalTasksApi.ts`, `frontend/src/lib/nav.ts`.
  - Backend: `backend/app/technical_tasks/routes.py`, `backend/app/technical_tasks/service.py`, `backend/app/technical_tasks/repository.py`, `backend/app/technical_tasks/schemas.py`, `backend/app/technical_tasks/models.py`.
  - Automated Tests: `backend/tests/test_technical_tasks.py` (`test_payment_summary_and_recording`).
- **Endpoints:**
  - `GET /api/v1/technical-tasks/payment-summary`: Aggregates real-time financial KPI totals (`total_payment`, `paid`, `due`, `pending_count`, `completed_count`) using high-performance indexed database queries.
  - `POST /api/v1/technical-tasks/{task_id}/record-payment`: Atomically updates `collected_amount`, `payment_mode`, `payment_status` (`Paid` if balance cleared, `Pending` if balance remains), sets task status to `Completed` if work was done, and appends an audit call log entry (`call_type="Payment Collected"`).
  - `POST /api/v1/technical-tasks/upload-screenshot`: Uploads payment receipt image/document attachment to storage.
- **Top Financial KPI Metric Cards:**
  - **`TOTAL PAYMENT`**: Aggregated sum of service charges across all chargeable technical tasks.
  - **`PAID`**: Aggregated total amount collected from clients/technicians displayed in emerald green (`#16a34a`).
  - **`DUE`**: Dynamic pending balance ($\text{Total} - \text{Paid}$) in high-contrast slate font (`#0f172a`).
- **Status Tabs & Sub-Toolbar Controls:**
  - `Pending (<count>)`: Displays tasks with unpaid or partial payment balance (active default tab with blue indicator).
  - `Completed (<count>)`: Displays tasks where full service charge payment has been collected and reconciled.
  - Selectable pagination (`10`, `25`, `50`, `100` Items/Page), instant live search across company, city, machine model, contact person, technician, and priority.
  - Collapsible filter drawer: City, Task Type, Priority, Technician, and Date Range.
- **Dual Amount Display & Grid Matrix:**
  - `Total Amount`: Shows formatted INR currency (`₹...`) alongside green `Chargable` pill badge (or gray `Non-Chargable`).
  - `Paid/Due`: Multi-line breakdown showing collected payment in blue (`Paid: ₹...`) and remaining balance in red (`Due: ₹...`).
  - Interactive company name linking to detail drawer/modal.
  - Row action menu (`⋮`) offering quick triggers: *Record Payment* and *View Details*.
- **Interactive Modals:**
  - **Record / Collect Payment Modal:** Real-time balance due calculator. Captures Amount to Collect (validated against positive values), Payment Mode (*Company Acc*, *Self collect*, *UPI / QR*, *Cheque*, *Cash*, *Bank Transfer*), Date, Reference/UTR No, Receipt Screenshot/Document upload, and collection remarks. Submitting records payment and automatically logs a call history audit record.
  - **Add Payment Modal:** Typeahead client linking via `ClientNameAutocomplete` to quickly initiate chargeable service tasks.
  - **Payment Details Modal:** Full ticket overview including machine model, problem reported, technician assigned, approver, billing breakdown, and receipt document preview.
  - **Bulk Delete Modal:** Multi-row soft-delete with confirmation modal.
- **Strict Zero-Synthetic-Data Enforcement:**
  - Absolute ban on automated mock/QA data generation scripts (18 test/seeding scripts purged across Inhyma and ERP_Dashboard).
  - Authentic accounts protected: `User A`, `User B`, `User C`, `User D`, and `Admin`.
  - Honest zero states rendered across all tables when no authentic records exist.
- **Navigation Architecture:**
  - Dedicated item in the **`TASK`** navigation block in `nav.ts` with custom `₹` currency icon (`IconIndianRupee`).
  - Deprecated and removed legacy `Gatepass` navigation link from the `TASK` section to maintain clean, streamlined operational workflows.

### 8.20. HRMS: Leave Management Foundation & Master Data Architecture (Phase 1)
- **Files:**
  - Backend: `backend/app/hrms/models.py`, `backend/app/hrms/leave_service.py`, `backend/app/hrms/leave_routes.py`, `backend/app/hrms/schemas.py`, `backend/app/hrms/service.py`.
  - Frontend: `frontend/src/pages/hrms/LeavePage.tsx`, `frontend/src/pages/hrms/hrms.css`.
  - Migrations: `backend/alembic/versions/i1a2b3c4d5eb_create_hrms_leave_phase1_tables.py`.
- **Endpoints (`/api/v1/hrms/leave`):**
  - **Leave Types Master:**
    - `GET /types`: List all leave types with active/inactive status.
    - `POST /types`: Create leave type (name, code, paid/unpaid, annual quota, carry-forward, max consecutive days, monthly accrual).
    - `PUT /types/{id}`: Update leave type configuration.
    - `DELETE /types/{id}`: Deactivate/soft-delete leave type.
  - **Leave Plans Master:**
    - `GET /plans`: List leave plans with associated types, branch, and department scope.
    - `POST /plans`: Create leave plan linking multiple leave types to branch/department.
    - `PUT /plans/{id}`: Update leave plan and type mappings.
    - `DELETE /plans/{id}`: Deactivate leave plan.
  - **Holidays Master:**
    - `GET /holidays`: List company holidays filtered by branch and year.
    - `POST /holidays`: Register holiday with date, number of days, and applicable branch IDs.
    - `PUT /holidays/{id}`: Update holiday details.
    - `DELETE /holidays/{id}`: Delete holiday record.
  - **Employee Balances & Matrix:**
    - `GET /balances`: Retrieve employee leave balances by year (`applicable_period`).
    - `GET /balances/matrix`: High-density pivot matrix mapping each employee to all active leave types (`consumed`, `available`, `total_leave`).
  - **Leave Adjustments & Audit Trail:**
    - `POST /adjustments`: Perform manual positive, negative, or corrective balance adjustments with mandatory reason logging.
    - `GET /adjustments/history`: Immutable audit trail showing previous balance, adjustment amount, resulting balance, reason, and admin actor.
  - **Leave Requests Workflow:**
    - `GET /requests`: List leave requests with employee, type, and status filtering.
    - `POST /requests`: Submit leave application with automated day calculation (excluding branch holidays and weekly offs), overlap validation, and balance checks.
    - `POST /requests/{id}/cancel`: Cancel leave request; restores consumed balance if previously approved.
  - **Leave Approvals Queue:**
    - `GET /approvals`: Filter pending and processed approvals for authorized managers.
    - `PATCH /approvals/{id}/approve`: Approve leave request; increments consumed balance and decrements available balance. Blocks self-approval.
    - `PATCH /approvals/{id}/reject`: Reject leave request with mandatory remarks; balance remains unchanged. Blocks self-approval.
- **Data Models:**
  - `HrmsLeaveType`: Master leave categories (`Casual Leave`, `Compensatory Off`, `Earned Leave`, `Leave Without Pay`, `Maternity Leave`, `Paternity Leave`, `Sabbatical Leave`, `Sick Leave`).
  - `HrmsLeavePlan` & `HrmsLeavePlanType`: Policy containers defining multi-type entitlements applicable by Branch and Department.
  - `HrmsHoliday`: Calendar holidays scoped to specific organizational branches.
  - `HrmsEmployeeLeaveBalance`: Year-wise employee quotas tracking `allocated`, `consumed`, `adjusted`, and `applicable_period`. Available balance is strictly derived:
    $$\text{Available} = \text{Allocated} + \text{Adjusted} - \text{Consumed}$$
  - `HrmsLeaveAdjustment`: Immutable audit records tracking every manual adjustment (+/-), previous balance, new balance, reason, and administrator user.
  - `HrmsLeaveRequest`: Employee applications tracking date span, days count, reason, attachment, review workflow status (`PENDING`, `APPROVED`, `REJECTED`, `CANCELLED`), reviewer remarks, and timestamps.
- **Frontend Architecture & UX:**
  - 6 dedicated tabs: `My Leaves`, `Leave Approvals`, `Holiday`, `Leave Adjustment`, `Leave Plans`, `Leave Types`.
  - Matrix table features sticky left columns (`Employee`) and sticky right columns (`Action`) for frictionless horizontal scrolling across dense leave types.
  - Real-time adjustment drawer preview dynamically calculating resulting balances before commit.

### 8.21. Purchase: Local Purchase Management & Costing Engine
- **Files:** `backend/app/purchase/local_routes.py`, `backend/app/purchase/models.py`, `backend/app/purchase/schemas.py`, `backend/app/purchase/costing.py`, `backend/app/purchase/common.py`, `frontend/src/pages/purchase/LocalPurchasePage.tsx`, `frontend/src/lib/purchaseApi.ts`, `frontend/src/lib/localPurchasePdf.ts`.
- **Endpoints:**
  - `GET /api/v1/purchase/local-orders`: List local purchases with status tab counts (`all`, `pending`, `confirmed`), search, warehouse, and date range filters.
  - `POST /api/v1/purchase/local-orders`: Create local purchase order with multi-line items. Server calculates expense loading percent and landing costs.
  - `POST /api/v1/purchase/local-orders/import`: Bulk import local purchase orders from CSV/XLSX (supports multi-line invoice grouping, master validation against Suppliers, Physical Warehouses, and Products, duplicate invoice reporting, and row-level error isolation).
  - `GET /api/v1/purchase/local-orders/{id}`: Detailed local purchase record and pricing matrix.
  - `PUT /api/v1/purchase/local-orders/{id}`: Update editable local purchase fields and items (locked once confirmed).
  - `PATCH /api/v1/purchase/local-orders/{id}/status`: Transition status (`pending` -> `confirmed`). Automatically increases physical warehouse stock.
  - `DELETE /api/v1/purchase/local-orders/{id}`: Soft-delete local purchase record (restricted to administrators).
  - `POST /api/v1/purchase/local-orders/{id}/bill`: Upload scanned invoice attachment.
  - `DELETE /api/v1/purchase/local-orders/{id}/bill`: Delete attached invoice file.
  - `GET /api/v1/purchase/local-orders/{id}/bill-file`: Stream or download attached invoice bill.
- **Costing Engine & Stock-In Mechanics:**
  - Expense Aggregation: $\text{Total Expenses} = \text{Packing \& Forwarding} + \text{Transport} + \text{Offloading}$.
  - Expense Loading: $\text{Loading \%} = \frac{\text{Total Expenses}}{\text{Basic Invoice Value}} \times 100$.
  - Line Item Landing: $\text{Expense Per Unit} = \text{Unit Rate} \times \frac{\text{Loading \%}}{100}$, $\text{Unit Landing Value} = \text{Unit Rate} + \text{Expense Per Unit}$.
  - **Stock Movement Hook:** Transitioning to `confirmed` status invokes `move_stock(db, warehouse, [(product, qty)], +1)` and sets `stock_applied = True`, `confirmed_by`, and `confirmed_at`.
- **Frontend Architecture & "Grey and Locked" UX Standard:**
  - **Non-Editable Calculated Fields:** `Total Of All Expenses` and `% Loading Expense (Value Based)` are wrapped in the `.calc-locked-wrapper` container with `#e9ecef` background, `1px solid #cbd5e1` border, `#475569` text, `cursor: not-allowed`, and a 🔒 lock icon indicator, clearly indicating they are computed values and cannot be edited by hand.
  - **Product Line Items Matrix:** Computed table columns (`Item Total`, `Expense Per Unit`, `Unit Landing Rate (VB)`, and `Total Landing Rate (VB)`) and footer grand totals are styled with `.calc-locked` cells and `cursor: not-allowed`.
  - Live landing rate calculation in client table matching server formula.
  - Datalist supplier lookup (`<datalist id="local-supplier-options">`) enforcing selection from known suppliers.
  - UOM badge display pulled dynamically from `/masters/uom`.
  - A4 Local Purchase Order PDF generation with company header, party details, and tax breakdowns.
  - **Unit Landing Rate (INR) (VB) Standardization:** Column header in both the UI table grid and generated PDF is standardized to `Unit Landing Rate (INR) (VB)` to emphasize Value-Based expense allocation.
  - **Horizontal Side Scrollbar:** Added side scrollbar overflow styling on the local purchase data table and item breakdown panels to ensure clean presentation without vertical or horizontal clipping.
  - **Confirmed Order Deletion Protection:** In `LocalPurchasePage.tsx`, purchase orders in `Confirmed` status strictly omit the `Delete` option from the row action menu (`⋮`). The backend endpoint `DELETE /api/v1/purchase/local-orders/{id}` verifies status and returns `400 Bad Request` if deletion of a confirmed order is attempted, preserving financial and inventory integrity.
  - **Import & Export Dropdown (`Imp / Exp`):** The Local Purchase list header renders the shared `ImpExpDropdown` (`btn-imp-exp` golden-amber trigger with `SAMPLE FILE`, `IMPORT` column-mapping wizard, and UTF-8 BOM `EXPORT` CSV download) alongside `ImportSummaryPanel` and `Bulk Actions`.

### 8.22. Purchase: Import Purchase Consignments & Customs Landing Matrix
- **Files:** `backend/app/purchase/import_routes.py`, `backend/app/purchase/models.py`, `backend/app/purchase/schemas.py`, `backend/app/purchase/costing.py`, `frontend/src/pages/purchase/ImportPurchasePage.tsx`, `frontend/src/lib/purchaseApi.ts`, `frontend/src/lib/importPurchasePdf.ts`.
- **Endpoints:**
  - `GET /api/v1/purchase/import-orders`: List import consignments with status counts (`all`, `pending`, `confirmed`, `received`, `closed`) and date range filters.
  - `POST /api/v1/purchase/import-orders`: Create import consignment with exchange rates, duties, and dual VB/CB landing calculations.
  - `POST /api/v1/purchase/import-orders/preview`: Live calculation preview endpoint returning computed CBM, duty, and landed costs while typing in the form.
  - `POST /api/v1/purchase/import-orders/import`: Bulk import overseas consignments from CSV/XLSX (supports multi-line consignment grouping, master validation against Suppliers, Warehouses, and Products, dual VB/CB landing calculations, immediate stock-in per workflow rules, duplicate consignment reporting, and row-level error isolation).
  - `GET /api/v1/purchase/import-orders/{id}`: Detailed consignment profile and volumetric lines.
  - `PUT /api/v1/purchase/import-orders/{id}`: Update editable consignment record.
  - `PATCH /api/v1/purchase/import-orders/{id}/status`: Move consignment through workflow (`pending` -> `confirmed` -> `received` -> `closed`).
  - `DELETE /api/v1/purchase/import-orders/{id}`: Soft-delete consignment.
- **Dual Landing Valuation Matrix & "Grey and Locked" UX Standard:**
  - **Computed Landing Cards:** Summary boxes for `Total Expenses`, `Purchase Invoice Total Value (INR)`, `Gross Total Landing (INR)`, `% Loading Expense (Value Based)`, and `Loading Amount per CBM` use the `.calc-locked` class (`#e9ecef` background, `#cbd5e1` border, `#475569` text, `cursor: not-allowed`, with 🔒 lock indicator icons).
  - **Core Financial Summary Formulas:**
    - $\text{Purchase Invoice Total Value (INR)} (A) = \text{Conversion Rate (USD to INR)} \times \text{Purchase Invoice Total Value (USD)}$
    - $\text{Total Expenses} (B) = \text{Freight} + \text{Insurance} + \text{Stamp Duty} + \text{Shipping Line Charges} + \text{CFS Charges} + \text{Clearing \& Transport} + \text{Offloading} + \text{Miscellaneous}$
    - $\text{Gross Total Landing (INR)} = A + B = \text{Purchase Invoice Total Value (INR)} + \text{Total Expenses}$
    - $\% \text{ Loading Expense (Value Based)} (C) = \frac{B \times 100}{A}$
    - $\text{Loading Amount per CBM} (I) = \frac{B}{\text{Total CBM } (H)}$
  - **Customs Matrix Computed Columns:** Volumetric CBM, line-item USD valuation (**Item Total (Basic in USD)** = `Quantity * Unit Rate (USD)`), customs duties, unit landing rate (VB), unit landing rate (CB), and differential diff columns are styled with `.calc-locked`.
  - Calculates landing rates on both **Value Basis (VB)** (allocated proportionally by line-item USD valuation) and **CBM Volume Basis (CB)** (allocated proportionally by volumetric cubic meters).
  - Calculates differential $\text{Diff (CB - VB)} = \text{Unit Landing (CB)} - \text{Unit Landing (VB)}$ to reveal volume penalties on bulky cargo.
- **Top Filter Panel & In-Transit Restraints:**
  - Provides top panel filtering across **Warehouse**, **Expected Arrival Date Range**, **ETD Origin Date Range**, and **ETA Port Date Range** with presets and custom date pickers.
  - During `pending` status, consignments can only be allocated to transit holding warehouses (e.g. `Mumbai Ordered`), preventing false stock availability before physical port receipt.
- **Supplier Selection Combobox UI Standard:**
  - Replaced the native browser `<datalist>` popup with a custom styled floating Combobox matching Inhyma ERP design standards: pure white elevated card (`#ffffff`), subtle border (`1px solid #cbd5e1`), elevation shadow (`0 6px 16px rgba(0, 0, 0, 0.12)`), animated rotatable chevron arrow, active item highlighting (`#eff6ff`, text `#2563eb`), keyboard selection, and click-outside dismissal.
- **Product Search Dual Combobox (Written Search & Dropdown Button):**
  - Upgraded **PRODUCT SEARCH** into a dual-mode combobox extracting products directly from the **Product Master** (`/masters/products`). Operators can either type to filter matching catalog products live or click the dropdown chevron button to browse active catalog items, with 1-click selection appending to the consignment's **PRODUCT ITEM** table.
- **Date Form Logic & Business Rules:**
  - **Ordered Date (`ordered_date`):**
    - Defaults automatically to the current date (`todayDDMMYYYY()`).
    - Strictly permits only past or current dates (`maxDate="today"`). Future days are disabled in the calendar grid, next-month navigation is blocked when out of range, live typing displays an immediate warning, and form submission is halted if a future date is provided.
  - **ETD Origin Date (`etd_origin_date`), ETA Port Date (`eta_port_date`), and Expected Arrival Date (`expected_arrival_date`):**
    - On a fresh Add New form prior to entering `ETA Port Date`, all three date fields initialize to blank (`""`) with the `DD-MM-YYYY` placeholder.
    - **Automatic `ETA Port Date + 5 Days` Default (Unlocked & Editable):** Whenever a valid `ETA Port Date` (`>= effectiveCreatedDate`) is selected or typed in `ImportPurchasePage.tsx` (or when opening Edit on a consignment that has `ETA Port Date` set and a blank `Expected Arrival Date`), `Expected Arrival Date` automatically populates with **`ETA Port Date + 5 days`** via calendar-safe `addDaysToDDMMYYYY(eta, 5)`. Likewise, backend `POST /api/v1/purchase/import-orders` (`_prepare` on create) and `POST /api/v1/purchase/import-orders/import` (`import_import_purchases` CSV/Excel upload) default `expected_arrival_date = eta_port_date + timedelta(days=5)` whenever `eta_port_date` is provided and `expected_arrival_date` is omitted.
    - **Editable Override Behavior:** Unlike `.calc-locked` formula fields, `Expected Arrival Date` renders as a standard unlocked `#ffffff` `<DatePicker />` so operators can freely edit or override it via calendar picker or direct `DD-MM-YYYY` keyboard input; manual overrides (`expectedArrivalCustomizedRef`) on or after an updated `ETA Port Date` are preserved without being overwritten.
    - Strictly permit only dates on or after the consignment's Created Date (`minDate=effectiveCreatedDate`).
    - **Dynamic Created Date Anchor:** Resolves to the consignment's original creation timestamp (`added_on` / `created_at_time`) when editing an existing record, or defaults to the current day (`todayDDMMYYYY()`) when adding a new consignment.
    - Dates prior to the Created Date are disabled in the calendar grid with dimmed styling (`opacity: 0.35`, `#cbd5e1`). Previous month navigation is blocked when earlier months are out of range.
    - Live typing validation flags any date earlier than Created Date with an immediate alert, and pre-submission validation blocks creation or updates if an invalid date is entered.
- **Uploaded Invoice File Viewer & Zero-Synthetic-PDF Policy:**
  - **No Synthetic Document Generation:** The system strictly serves and renders the **actual file uploaded by the operator** in the "Attach Invoice" field on the Add/Edit form. It never dynamically constructs, fabricates, or renders synthetic invoice PDFs.
  - **Dedicated Streaming Endpoint (`GET /api/v1/purchase/import-orders/{purchase_id}/bill-file`):** Authenticated via standard `Authorization: Bearer <token>` header or `?token=<access_token>` query parameter. Streams the original uploaded file with `content_disposition_type="inline"` (or `attachment` when `download=true`) and proper MIME detection (`application/pdf`, image types, etc.).
  - **Multi-Format Frontend Viewer ([`ImportPurchasePdfPage.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/pages/ImportPurchasePdfPage.tsx)):**
    - **PDF Documents:** Renders inside a full-height `<iframe src={blobUrl} />` with browser native tools, print trigger (`🖨️ Print`), and `⬇️ Download PDF`.
    - **Images:** Renders centered preview with `⬇️ Download File`.
    - **Word Documents & Spreadsheets (`.docx`, `.xlsx`):** Renders a dedicated document preview card showing the file icon, name, consignment number, file size, and a direct `⬇️ Download <Filename>` button.
    - **Zero State (No Invoice Attached):** Informative message explaining that no invoice was uploaded for the consignment and guiding the operator to attach one via the Add/Edit form.
  - **Direct Access Points:**
    - Clicking the filename in the `INVOICE` column of the Import Purchase table.
    - Clicking `[ ⤓ View PDF ]` / `[ ⤓ View Invoice ]` in the "Import Purchase Details" modal.
    - Selecting "Download Purchase" in the table action menu (`⋮`).
- **Closed Consignment Immutability & Action Menu Scope:**
  - When an import purchase consignment reaches `closed` status, the row action menu (`⋮`) strictly displays **ONLY** `Download Purchase`.
  - The `Edit`, `Confirm`, and `Delete` options are completely removed.
  - Client-side routing to `/purchase-order/import-purchase/addedit/:id` for closed orders is blocked with a warning toast, and backend endpoint `PUT /purchase/import-orders/{purchase_id}` enforces `edit: "none"` on `closed` status.
- **Import & Export Dropdown (`Imp / Exp`):**
  - The Import Purchase list header renders the shared `ImpExpDropdown` (`btn-imp-exp` golden-amber trigger with `SAMPLE FILE`, `IMPORT` column-mapping wizard, and UTF-8 BOM `EXPORT` CSV download) alongside `ImportSummaryPanel`, `ADD NEW`, and `Bulk Actions`.

### 8.23. Sales: Proforma Invoices (PI) & Extended Commercial Terms
- **Files:** `backend/app/sales/routes.py`, `backend/app/sales/models.py`, `backend/app/sales/schemas.py`, `backend/app/sales/proforma_service.py`, `frontend/src/pages/ProformaInvoicesPage.tsx`, `frontend/src/lib/proformaInvoicePdf.ts`.
- **Endpoints:**
  - `GET /api/v1/sales/proforma-invoices`: List proforma invoices with status tabs (`all`, `pending`, `admin_approved`, `confirmed`, `cancelled`).
  - `POST /api/v1/sales/proforma-invoices`: Create PI with line items, additional charges, and commercial terms.
  - `GET /api/v1/sales/proforma-invoices/{id}`: Retrieve PI detail with billing/shipping address and item tax breakdown.
  - `PUT /api/v1/sales/proforma-invoices/{id}`: Edit proforma invoice (locked once confirmed).
  - `PATCH /api/v1/sales/proforma-invoices/{id}/status`: Workflow transition with approval and cancellation reasons.
- **Features:**
  - Extended commercial terms: Payment Terms, Delivery Type (Godown/Door), Delivery Charge (To Pay/Paid), Third-Party Delivery.
  - Address routing: Billing Address and Shipping Address snapshotting with GSTIN details.
  - Sequential PI numbering rules (`proforma.numbering` group in `option_lists`).
  - **Expected Delivery Date (`expected_delivery_date`):** Dedicated scheduling field defaulting to the current date and strictly validating that only present and future dates are selectable (`min={todayIso}`).
  - **Connected Company & Address Automation:** Selecting a company in Billing or Shipping fields automatically loads and displays the company's full address card (address lines, city, state, pin, phone, email, and GSTIN).
  - **Slide-Over "Add Company" Drawer (`AddCompanyDrawer.tsx`):** `+ Add` button next to company selectors triggers a right-side drawer to register a new company (Customer/Supplier/Both) with instant selection into the active form upon save.
  - **Slide-Over "Edit Address" Drawer (`EditAddressDrawer.tsx`):** `Edit` button on Billing and Shipping address cards opens a slide-over drawer to edit and override address fields directly for the proforma document without mutating the master company record.
  - **Side Scrollbar Support:** Enhanced horizontal and vertical overflow handling on tables and modal forms.

### 8.24. Database-Driven Status Rules & Dynamic Workflow Engine
- **Files:** `backend/app/common/workflow.py`, `backend/alembic/versions/k1a2b3c4d5e8_seed_proforma_rules.py`, `backend/alembic/versions/m1a2b3c4d5ea_seed_purchase_rules.py`, `frontend/src/lib/workflowRules.ts`.
- **Architecture:**
  - Document workflow logic is decoupled from application code and stored in `option_lists.meta` under groups (`purchase.local.status`, `purchase.import.status`, `proforma.status`).
  - Rules specify:
    - `next`: Array of allowable destination status keys.
    - `admin_only_to`: Statuses restricted strictly to administrators.
    - `perm_to`: Object mapping `{ target_status: required_permission_code }`.
    - `reason_required_to`: Statuses requiring a non-empty text reason.
    - `edit`: Edit capability (`"any"`, `"admin"`, `"none"`, `"perm:<code>"`).
    - `delete`: Deletion capability (`"admin"`, `"any"`, `False`).
    - `stock_in`: Boolean indicating if entering this status increments physical stock balances.
  - **Fail-Safe Fallbacks:** Built-in `FALLBACK_RULES` dictionary ensures API endpoints never crash with 503 if option lists are unseeded.

### 8.25. Sales: Sales Order Execution & Sales Process Add/Edit Engine (Full Parity with Proforma, Dynamic Masters, Exceeded Stock Alerts, Grey-Locked Cells & Drawers), Gate Pass Logistics & Discount Ledger
- **Files:** `backend/app/sales/service.py`, `backend/app/sales/routes.py`, `backend/app/sales/process_routes.py`, `backend/app/sales/models.py`, `backend/app/sales/schemas.py`, `frontend/src/pages/sales/SaleProcessList.tsx`, `frontend/src/pages/sales/SaleProcessForm.tsx`, `frontend/src/pages/sales/SaleProcessDetailModal.tsx`, `frontend/src/pages/sales/DiscountPaymentsPage.tsx`.
- **Primary Routes:** `/sales/process` (List with `Including GST` toggle, Funnel filter toggle, `+ ADD NEW`, and golden-amber `Export` `.btn-imp-exp` button with download SVG icon), `/sales/process/add` & `/sale-order/addedit` (Add Order), `/sales/process/edit/:id` & `/sale-order/addedit/:id` (Edit Order), `/discount-payments` (Discount Ledger).
- **Endpoints:**
  - `GET /api/v1/sales/orders`: Paginated list of confirmed & pending Sales Orders with status stages and filters.
  - `POST /api/v1/sales/orders`: Create Sales Order defaulting to `pending` status with line items & commercial terms.
  - `GET /api/v1/sales/orders/{id}`: Inspect detailed Sales Order record with line items, tax, and address breakdown.
  - `PATCH /api/v1/sales/orders/{id}`: Update Sales Order details, line items, PO/Tally bill links, and commercial fields.
  - `PATCH /api/v1/sales/orders/{id}/status`: Advance SO stage (`pending` ➔ `sales_confirmed` ➔ `admin_approved` ➔ `acc_confirmed` ➔ `gatepass_created` ➔ `dispatched` ➔ `lr` / `cancelled`) with stage-specific metadata (`po_file_url`, `po_file_name`, `invoice_date`, `invoice_no`, `tally_bill_url`, `tally_bill_name`, `eway_bill`, `third_party_invoice`, `gatepass_no`, `lr_no`).
  - `POST /api/v1/sales/upload-po`: Upload Purchase Order (PO) document to `inhyma-sales-docs` / `/uploads/private/sales_po/`.
  - `POST /api/v1/sales/upload-tally-bill`: Upload Tally Bill document to `inhyma-sales-docs` / `/uploads/private/sales_tally_bills/`.
  - `POST /api/v1/sales/upload-eway-bill`: Upload E-Way Bill document to `inhyma-sales-docs` / `/uploads/private/sales_eway_bills/`.
  - `POST /api/v1/sales/upload-lr`: Upload Lorry Receipt (LR) document to `inhyma-sales-docs` / `/uploads/private/sales_lr/`.
  - `POST /api/v1/sales/upload-dispatch-media`: Upload multiple dispatch images and videos (`files: list[UploadFile]`) to `inhyma-sales-docs` / `/uploads/private/sales_dispatch_media/`.
  - `POST /api/v1/sales/orders/{id}/status-with-po`: Atomic multipart status update with optional PO file upload.
  - `DELETE /api/v1/sales/orders/{id}`: Soft-delete Sales Order and revert stock allocations.
  - `POST /api/v1/sales/orders/{id}/restore`: Restore soft-deleted Sales Order (Admin only).
  - `GET /api/v1/sales/metrics`: Status-grouped KPI summary metrics (`total_orders`, `pending_count`, `confirmed_count`, etc.).
  - `GET /api/v1/sales/next-gatepass-no`: Generate sequential Gate Pass reference number.
  - `GET /api/v1/sales/planning-consignments`: Extract consignment columns from Shipment Planning sheets for order pre-allocation.
  - `GET /api/v1/sales/planning-consignments/{column_id}/items`: Extract planned products and quantities from consignment column.
  - `GET /api/v1/sales/export`: Export Sales Orders dataset to Excel spreadsheet.
  - `POST /api/v1/sales/gate-pass`: Create dispatch Gate Pass with logistics metadata.
  - `POST /api/v1/sales/orders/{id}/upload-lr`: Attach transporter LR document and multi-photo delivery proof.
  - `GET /api/v1/sales/discount-payments`: List under-invoicing discount ledger entries.
  - `POST /api/v1/sales/discount-payments`: Record cash discount settlement against a Sales Order reference.
- **Sale Status Update Side Drawer, Persistent Timeline & Document Badges (`SaleProcessList.tsx`, `SaleProcessDetailModal.tsx`, Migrations `v7a8b9c0d1e2`, `w8b9c0d1e2f3`, `x9c0d1e2f3a4` & `y0d1e2f3a4b5`):**
  - **Top Header Actions (`SaleProcessList.tsx`):** Displays `Including GST` toggle switch, dark slate `#556987` Filter funnel button (collapsed by default), `+ ADD NEW` button, and standalone golden-amber `#f59e0b` `Export` button (`.btn.btn-imp-exp` with 14×14 vector download SVG icon and UTF-8 BOM CSV export).
  - **Interactive Edit Action:** Clicking the square blue pen button (`title="Update Status"`) next to any row's status badge opens the right-hand **Sale Status Update** `SideDrawer` (`width="480px"`).
  - **Multi-Stage Conditional Controls:**
    - **Pending:** Green banner `Current Status: Pending`, target status options `Sales Confirmed` (default) / `Cancel`, plus **PO File** upload (`.pdf,.png,.jpg,.jpeg,.xlsx,.xls,.doc,.docx`) with size preview & `Clear` action.
    - **Sales Confirmed:** `Admin Approved` (default) / `Cancel` (PO input hidden).
    - **Admin Approved:** `Acc. Confirmed` (default) / `Cancel` — requires `Invoice Date*`, `Invoice No *`, `Tally Bill *` file upload, `E-Way Bill` (`No`/`Yes` — when `Yes` is selected, dynamically expands a mandatory `E-Way Bill *` file upload uploaded via `POST /api/v1/sales/upload-eway-bill` and persisted in `eway_bill_url` / `eway_bill_name`), plus `Third Party Invoice / Reference *` when Third-Party Delivery is enabled.
    - **Acc. Confirmed:** `Gatepass Created` (clean drawer displaying `Current Status: Acc. Confirmed`, `Status: Gatepass Created`, `Remarks`, and `Submit` with auto-generated Gatepass metadata).
    - **Gatepass Created / Gatepass Cancelled:** `Gatepass Created` ➔ `Dispatched` / `Gatepass Cancelled`; `Gatepass Cancelled` ➔ `Gatepass Created` / `Cancel`.
    - **Dispatched:** `Status` `<select>` options `LR` (default) and `Gatepass Cancel`. When `LR` is selected, renders `[ ] Change Transport Info` checkbox (expanding a clean frameless 2×2 grid of `Transport Name`, `Transport Destination`, `Delivery Type` defaulting to `Door`, and `Delivery Charge` defaulting to `To Pay`, with `Self Pickup` handling), mandatory `LR File *` upload (`POST /api/v1/sales/upload-lr`), `Images/Videos (Upload Multiple)` drag-and-drop + browse dropzone (`POST /api/v1/sales/upload-dispatch-media`), and `Remarks`. Switching to `Gatepass Cancel` hides LR fields and transitions to `gatepass_cancelled`.
  - **Direct Download Badges, `Acc. Dep.` `[i]`/`[E]` Chips & Timestamps:** Displays clickable `📎 PO` and `📎 Bill` download badges in the Status column & PO column, orange `[i]` (Tally Bill) and `[E]` (E-Way Bill) chips in the `Acc. Dep.` column above `Timeline`, clickable Tally Bill & E-Way Bill links in `SaleProcessDetailModal` & `Upload Files` (`SO Files`), plus `DD-MM-YYYY hh:mm A` timestamp below the status badge.
  - **Persistent Chronological Sale Order Timeline (`sales_orders.timeline` JSON column, Migration `y0d1e2f3a4b5`):** Records every lifecycle transition newest-first (`LR Mandatory` ➔ `Dispatched` ➔ `Gatepass Created` ➔ `Account Confirmed` ➔ `Admin Approval` ➔ `Sales Confirmed` ➔ `Pending`, plus `Gatepass Cancelled` / `Cancelled`) with IST `DD-MM-YYYY hh:mm AM/PM` timestamps, resolved user display names (`By : <Actor>`), optional stage `Remark`, and rich `Account Confirmed` metadata (`Invoice No`, `DD-MM-YYYY` `Invoice Date`, conditional `E-Way Bill` download icon link when `E-Way Bill = Yes`, and `Tally Bill` download icon link), with automatic upstream stage backfill for pre-migration orders.
- **Sales Process Add New Form Architecture (`SaleProcessForm.tsx`):**
  - **100% Feature Parity with Proforma Invoice:** Designed to match the exact UX, visual structure, validation patterns, and calculation standards of Proforma Invoice's Add New form (`ProformaInvoicesPage.tsx`), ensuring zero learning curve for operators.
  - **Dynamic DB Masters Integration (`useMasterNames`):**
    - Dynamic lookups for `/masters/warehouses`, `/masters/payment-terms`, `/masters/transports`, and `/masters/additional-charges` using the reactive `useMasterNames` hook.
    - Gracefully merges live database options with standard system defaults (e.g. `Mumbai`, `Ahmedabad`, `Indore`; `100% Advance`, `30 Days Credit`; `Self Pickup`, `VRL Logistics`).
  - **Delivery Date Parsing & Past Date Protection (`parseDateAny`):**
    - Universal parsing supporting `DD-MM-YYYY`, `YYYY-MM-DD`, and `DD/MM/YYYY`.
    - Strict validation enforcing `minDate="today"`, rejecting expected delivery dates in the past with visual toast warnings.
  - **Entity Cards with Slide-Over Drawers:**
    - **Company Card:** Integrated `ClientNameAutocomplete` with real-time company search, clear (trash) button, `+ Add` button triggering `AddCompanyDrawer`, and detailed info card displaying Company Name, Business Type (`B2B`/`B2C`), and GST No.
    - **Billing Address Card:** Formatted address card with pencil edit button opening `EditAddressDrawer` in edit mode; or text input with clear and `+ Add` button opening `EditAddressDrawer` in add mode.
    - **Shipping Address Card:** Formatted address card with pencil edit button opening `EditAddressDrawer`; or text input with clear and `+ Add` button opening `EditAddressDrawer` in add mode.
  - **Product Search Card & Real-Time Warehouse Stock Check:**
    - Warehouse-specific live inventory check against `/inventory/product-stock?limit=500`.
    - Auto-resolves HSN via `getAutoHsnForProduct()` and tax rate via `resolveGstPercent()` from `/masters/taxes`.
    - Selecting a catalog product appends it directly to the **PRODUCT ITEM** table.
  - **Product Item Table & Calculation Standards:**
    - **Grey-Locked Computed Cells (`#f8fafc`):** ReadOnly cells for HSN, Taxable Amount, GST %, GST Amount, and Total, dynamically computed via `(unit_price - unit_discount) * quantity`.
    - **Stock Exceeded Alerts:** Real-time top alert banner (`data-testid="alert-exceeded-stock"`), in-table warning alert banner, red border & background on Qty input, red badge (`Qty: ... ⚠️ Exceeds Available!`), and blur toast warnings.
    - **Upward-Opening Comboboxes (`placement="up"`):** Combobox dropdowns within table rows open upward, completely eliminating table scrollbar clipping and container overflow issues.
    - **Serial Number Tracking (`🔢 S/N`):** Modal window permitting operators to input comma/line-separated product serial numbers.
    - **Additional Charges Toggle:** Checkbox `[✓] Additional Charges` (`data-testid="checkbox-additional-charges"`) defaulting to Transport Charges (HSN 996511) and Packing & Forwarding (HSN 996713) with dynamic add/remove charge actions.
    - **Table Footer Summary Bar (`<tfoot>`):** Total Qty, Total Taxable, Total Tax, and Total With Tax.
  - **Self-Pickup Automation:**
    - Selecting `Self Pickup` / `Self Pick-up` as Transport Name automatically hides Row 3 (Destination, Delivery Type, Delivery Charge) and relaxes delivery type and delivery charge validation.
  - **Standardized Terms and Conditions & Totals Breakdown:**
    - Standard 3-rule terms: 1. Transport Charges: To Pay. 2. Payment Terms: 100% Before Dispatch. 3. Order once confirmed, cannot be cancelled.
    - Totals breakdown card: Total Basic, Total Discount, Total Taxable Amount, Total Tax, Total Including Tax, and Indian currency words (e.g. `Amount In Words: ... Rupees Only`).
  - **Default Status "Pending" & Schema Synchronization:**
    - New sales orders automatically default to `status: "pending"`.
    - Synchronizes payload with `buyer_name` + `company_name`, `transport_name` + `transporter_name`, `expected_delivery_date` + `delivery_date`, `city`, and `state`, guaranteeing complete interoperability with backend Pydantic schemas.
    - Validates that unit discount cannot exceed unit price.
- **Physical Stock Deduction & Negative Protection Engine:**
  - **Stock Deduction Trigger:** Upon transitioning to a status configured with `stock_out: True` (typically `sales_confirmed`), `_take_stock(order)` invokes `move_stock(warehouse, lines, -1)` and marks `order.stock_applied = True`.
  - **Strict Physical Warehouse Negative Lock:**
    ```python
    if avail < qty:
        raise ConflictException(f"Not enough stock of '{prod.product_name}' in {order.warehouse}. Available: {avail}, Requested: {qty}")
    ```
    Physical warehouses (`Mumbai`, `Ahmedabad`, `Indore`) strictly block saving if stock is insufficient. Virtual warehouses (`_transit`, `_ordered`) permit negative balances for advance pre-bookings.
  - **Automatic Reversal on Cancellation or Deletion:**
    When an order is cancelled or soft-deleted, `_release_stock(order)` immediately executes `move_stock(warehouse, lines, +1)` and resets `order.stock_applied = False`, returning quantities back to physical inventory.
- **Gate Pass Logistics & LR Attachment Workflow:**
  - **Gate Pass Form Parameters:**
    - Transporter Name (default: `Not Sure`).
    - Delivery Type: `Godown` / `Door` (default: `Godown`).
    - Delivery Charges: `To Pay` / `Paid` (default: `To Pay`).
    - Destination City / Area.
  - **Proof of Delivery (LR Upload):** Transporter Lorry Receipt (LR) number with multi-photo attachment; marks order lifecycle as `Dispatched`.
- **Discount Payment Ledger & Multi-Installment Adjustment Engine (`DiscountPaymentsPage.tsx`, `routes.py`, `service.py`):**
  - **Automatic SaleOrder Synchronization (`_sync_discount_payment`):** Creating or updating any `SaleOrder` with `discount > 0` automatically creates/updates its `DiscountPayment` row (and `GET /api/v1/sales/discount-payments` auto-backfills missing discounted orders), enriching live `SaleOrder`, `Company`, and `GatePass` metadata (`status` workflow stage label such as `LR` / `Dispatched` / `Gatepass Created`, `gatepass_id`, `gatepass_date`, `contact_name`, `contact_person_name`, `contact_person_mobile`). Soft-deleting or cancelling an unpaid order automatically soft-deletes its ledger entry.
  - **Top 3 KPI Cards & Stage Tabs (`Discount.docx`):** Reactive `TOTAL DISCOUNT`, `PAID`, and `DUE` cards above `All`, `Pending` (default active), and `Completed` (with green `✓ Completed` badge identifying settled payments) tabs.
  - **Multi-Installment Payment Ledger (`z1e2f3a4b5c6` — `discount_payments.payments` JSON):**
    - `PATCH /api/v1/sales/discount-payments/{payment_id}` validates `0 < amount <= due_discount`, resolves the authenticated user's full display name (`Adjustment By`), updates `paid_discount` / `due_discount` / `settled`, and appends `{ id, date, title, amount, adjusted_by }` to `discount_payments.payments`.
    - **`Discount Adjustment` Right Drawer:** Displays `Discount Summary` card (`Total Discount:`, green `Total Discount Paid:`, red `Total Discount Due:`), dynamic today's `Date *` (`DD-MM-YYYY`), validated `Amount *` (`Max: <due>`), and `Remarks/Feedback` (stored as installment `Title`).
    - **`Discount Adjustment Payment List` Modal:** Displays `Sale Order Detail #<OrderShortNo>` (`Customer Name`, `Created Date`, `Total Discount`, `Paid Amount`, `Due Amount`) and full chronological `# | Date | Title | Amount | Adjustment By` installment table.
- **Sales Process List & Execution Architecture (`SaleProcessList.tsx`):**
  - **Dynamic Top 6 KPI Metric Cards & 10 Status Tabs Calculation Engine:**
    - Live aggregation directly computes counts and currency totals across order stages: `ALL`, `ADMIN CONFIRMED TO LR`, `PENDING`, `ADMIN APPROVED`, `LR`, and `CANCELLED`.
    - Integrated with reactive `includingGst` toggle: dynamically recalculates values based on `amount_inc_gst` / `total_amount` vs. `amount_exc_gst` / `total_basic`.
    - Status tabs dynamically reflect accurate counts (`All`, `Pending`, `Sales Confirmed`, `Admin Approved`, `Acc. Confirmed`, `Gatepass Created`, `Dispatched`, `Gatepass Cancelled`, `LR`, `Cancelled`).
  - **Comprehensive 9-Status Action Menu Matrix (`⋮` Dropdown):**
    - Rigorously isolates action choices per workflow status:
      1. `pending`: **Edit**, **SO Files**, **Delete**
      2. `sales_confirmed`: **Edit**, **SO Files**, **Cancel**, **Delete**
      3. `admin_approved`: **SO Files**, **Cancel**, **Delete**
      4. `acc_confirmed`: **SO Files**, **Delete**
      5. `gatepass_created`: **Download Gatepass**, **SO Files**, **Delete**
      6. `dispatched`: **Download Gatepass**, **SO Files**, **Delete**
      7. `gatepass_cancelled`: **SO Files**, **Cancel**, **Delete**
      8. `lr`: **Duplicate**, **Download Gatepass**, **Delete**
      9. `cancelled`: **Delete**
    - Unrequested menu items (`Print SO (Pricing)`, `Warehouse SO (No Pricing)`, `Gate Pass PDF`, `Send LR to Client`) are completely eliminated from the dropdown.
  - **Direct Status Cancellation Workflow (`handleCancelOrder`):**
    - For cancellable statuses (`sales_confirmed`, `admin_approved`, `gatepass_cancelled`), clicking **Cancel** directly sets `status: "cancelled"`, triggers `PATCH /api/v1/sales/orders/{id}/status`, surfaces a success toast, and immediately routes the user to the active **Cancelled** tab.
  - **LR Duplicate Workflow:**
    - For orders in `lr` status, clicking **Duplicate** navigates to `/sales/process/add?duplicate_id=${o.id}`. The form loads buyer info, shipping address, commercial terms, and line items, clears `order_no`, and presents a fresh order in `pending` status with header `"Add Sales Order (Duplicate)"`.
  - **"Upload Files" Slide-Over Drawer with File Deletion & PO Unlinking:**
    - Opens upon clicking **SO Files** (`data-testid="btn-action-so-files"`).
    - Lists all uploaded attachments with dedicated **View** and **Delete** (`data-testid="btn-delete-file-{idx}"`) controls.
    - Attached PO documents feature a dedicated **Delete** button (`data-testid="btn-delete-po-file"`), clearing `po_file`/`po_attachment`, resetting `po: "No"`, and synchronizing with backend order remarks.
    - Provides a **Clear** button for pending files prior to upload.
  - **13-Field Collapsible Filter Panel & Dynamic Sales Person Dropdown:**
    - Organized in a responsive 6-column grid matching legacy reference layout:
      - **Row 1 (6 Date Bounds):** `Order Date From/To`, `Invoice Date From/To`, `Exp. Delivery From/To`.
      - **Row 2 (6 Criteria):** `State` (36 States/UTs), `Dispatch Status` (All/Yes/No), `Warehouse` (Mumbai/Mumbai Transit/Ahmedabad/Indore), `Sales Person` (dynamic `<select>` populated from users & active orders), `Company` (substring search), `Third Party` (All/Yes/No).
      - **Row 3 (Actions):** `PO` (All/Yes/No), right-aligned `Reset` (`#64748b`) and `Search` (`#f59e0b`) buttons.
    - Fully synchronizes client-side and backend filtering, restoring pristine state upon Reset.

### 8.26. CRM: Customer Relationship Management Full Suite (Leads, Pipelines, Distribution, Timeline & Branded Quotations Engine)
- **Backend Architecture & Files:** `backend/app/crm/models.py`, `backend/app/crm/schemas.py`, `backend/app/crm/routes.py`, `backend/app/crm/service.py`, `backend/app/crm/quotation_service.py`, `backend/app/crm/distribution_service.py`.
- **Frontend Architecture & Files:** `frontend/src/pages/crm/LeadListPage.tsx`, `frontend/src/pages/crm/LeadKanbanPage.tsx`, `frontend/src/pages/crm/LeadDetailPage.tsx`, `frontend/src/pages/crm/LeadImportModal.tsx`, `frontend/src/pages/crm/PipelineSettingsPage.tsx`, `frontend/src/pages/crm/DistributionSettingsPage.tsx`, `frontend/src/pages/crm/QuotationBuilderPage.tsx`, `frontend/src/pages/crm/QuotationViewPage.tsx`.
- **Database Schema Models:**
  - `Lead`: Core CRM prospective customer model (`id`, `lead_code`, `company_name`, `contact_name`, `email`, `phone`, `source_id`, `priority`, `business_type`, `stage_id`, `assigned_to_user_id`, `company_id`, `expected_revenue`, `closing_date`, `status`, `notes`, `created_at`, `updated_at`).
  - `PipelineStage`: Configurable lifecycle stages (`id`, `name`, `code`, `order_index`, `color`, `is_won_stage`, `is_lost_stage`, `sla_hours`).
  - `LeadActivity`: 360° audit timeline records (`id`, `lead_id`, `activity_type` [CALL, MEETING, EMAIL, NOTE, STAGE_CHANGE, QUOTE_SENT, TASK_CREATED], `title`, `description`, `performed_by_user_id`, `created_at`).
  - `LeadDistributionRule`: Round-robin and capacity-based sales allotment rules (`id`, `name`, `criteria_json`, `salesperson_user_ids`, `last_assigned_user_id`, `is_active`).
  - `CrmQuotation` & `CrmQuotationItem`: Branded quotation engine with header pricing, tax schemes, delivery terms, validity windows, and line items.
- **Core Functional Capabilities:**
  - **Dynamic Pipeline Stages:** Customizable pipeline workflow stages allowing management to adjust deal progression gates, SLA escalation thresholds, and winning/losing outcomes.
  - **Interactive Drag-and-Drop Kanban:** Smooth drag-and-drop board allowing sales representatives to transition deals between stages with live stage sum valuations and count badges.
  - **Bulk CSV/Excel Import Wizard:** Robust wizard supporting header fuzzy matching, custom column mapping, preview parsing, duplicate detection by phone/email/company name, and rollback-safe batch insertion.
  - **Round-Robin Lead Distribution Engine:** Automated assignment daemon that fairly routes incoming leads across qualified sales team members based on territory, source, or rotation index.
  - **360° Lead Activity Timeline:** Chronological timeline consolidating notes, stage progression logs, call summaries, quotation dispatches, and linked tasks.
  - **Company Master Conversion:** 1-click seamless conversion of qualified leads into official `Company` records within the B2B directory, linking existing contacts and past activity.
  - **Workforce Task Synchronization:** Scheduling follow-up reminders automatically spawns assigned tickets in the enterprise Workforce Task module with bidirectional linkbacks.
  - **Branded ReportLab Quotation PDF (`backend/app/crm/quotation_pdf.py`):** Server-side ReportLab PDF engine (`reportlab>=4.2.0`) producing formatted A4 quotations (`GET /api/v1/crm/quotations/{quotation_id}/pdf`) with company branding, tax breakdown, terms & conditions, authorized signature blocks, and automatic clickable PDF URI hyperlinks (`Specification PDF: <filename>`) pointing directly to DB-stored Product Master specification PDFs.

### 8.27. Workforce: Recurring Tasks Scheduling Engine & Automated Spawning Worker
- **Backend Architecture & Files:** `backend/app/tasks/recurring_models.py`, `backend/app/tasks/recurring_schemas.py`, `backend/app/tasks/recurring_routes.py`, `backend/app/tasks/recurring_service.py`, `backend/app/tasks/recurring_worker.py`.
- **Frontend Architecture & Files:** `frontend/src/pages/tasks/TasksPage.tsx` (Sub-tab "Recurring Tasks"), `frontend/src/components/tasks/RecurringScheduleModal.tsx`, `frontend/src/lib/taskApi.ts`.
- **Database Schema Models:**
  - `RecurringTaskSchedule`: Master schedule template (`id`, `title`, `description`, `recurrence_type` [DAILY, WEEKLY, MONTHLY, CUSTOM_CRON], `recurrence_interval`, `days_of_week`, `day_of_month`, `cron_expression`, `priority`, `department_id`, `assignee_user_ids`, `watcher_user_ids`, `label_ids`, `checklist_template_json`, `start_date`, `end_date`, `last_generated_at`, `next_run_at`, `status` [ACTIVE, PAUSED, COMPLETED, ARCHIVED], `created_by_user_id`).
- **Core Functional Capabilities:**
  - **Unified Tasks Sub-Tab:** Embedded as a dedicated sub-view in `/tasks`, displaying active, paused, and upcoming recurring task schedules with cadence badges and next execution clocks.
  - **Schedule Creator Modal:** Intuitive modal allowing operators to define task templates with title, description, priority, assignees, subtask checklist blueprints, and cadence rules (Daily, Weekly on specific days, Monthly on specific day of month, or custom Cron).
  - **Background Daemon Worker (`recurring_worker.py`):** Asynchronous worker checking pending schedules against `next_run_at <= utcnow()`, executing transactional task instantiation, applying subtasks/watchers, computing the subsequent `next_run_at` timestamp, and updating schedule metadata without race conditions.
  - **Manual Trigger Override:** 1-click "Run Now" action permitting supervisors to spawn an immediate task instance outside regular schedule windows.
  - **Lifecycle Management:** Dedicated controls to pause, resume, edit, or archive schedules with complete audit trail logging.

### 8.28. Product Sync Adapter & Dynamic Relational Provisioning Engine (Yinglima -> Inhyma)
- **Backend Architecture & Files:** `backend/app/products/sync_adapter.py`, `backend/app/products/routes.py`, `backend/app/products/service.py`.
- **Core Functional Capabilities:**
  - **Cross-ERP Product Sync Adapter:** Connects Yinglima (China Sourcing) to Inhyma (India Distribution), orchestrating catalog synchronization over authenticated HTTP API channels.
  - **Dynamic Dependency Auto-Provisioning:** If an incoming product references a Category, Subcategory, Brand, UOM, or Tax rate that does not yet exist in the destination ERP, the adapter dynamically creates the missing entity in the local masters before persisting the product, preventing foreign key integrity violations.
  - **Pagination & Query Normalization:** Enforces standard `limit` parameter handling and newest-first sorting (`created_at DESC`) to ensure deterministic catalog views.
  - **WebSocket Fanout:** Emits real-time `PRODUCT_SYNCED` notifications to connected UI sessions upon ingestion, automatically refreshing product lookup caches.

### 8.29. Communication: Internal Feed & Broadcast Announcements Engine
- **Files:** `backend/app/feed/routes.py`, `backend/app/feed/models.py`, `backend/app/feed/schemas.py`, `backend/app/feed/service.py`, `frontend/src/pages/feed/FeedPage.tsx`, `frontend/src/pages/feed/FeedComposer.tsx`, `frontend/src/pages/feed/FeedPostCard.tsx`, `frontend/src/pages/feed/FeedEditModal.tsx`, `frontend/src/lib/feedApi.ts`, `frontend/src/styles/feed.css`.
- **Database Architecture:**
  - `feed_posts`: Primary post entity with `title`, `content`, `post_type` (`announcement`, `general`, `alert`), `is_pinned`, `author_id`, `created_at`, `updated_at`, `deleted_at`.
  - `feed_post_departments`: Relational targeting junction table linking posts to specific department IDs.
  - `feed_post_recipients`: Direct recipient targeting junction table linking confidential broadcasts to individual user IDs.
  - `feed_post_comments`: Comment entity supporting threaded discussions under posts with author reference, content, and soft deletion.
  - `feed_post_reactions`: Reaction entity capturing user emoji reactions (`like`, `love`, `celebrate`, `rocket`, `insightful`, `clap`) ensuring 1 reaction type per user per post.
  - `feed_post_reads`: Read-receipt tracking recording user viewing timestamps for compliance and broadcast visibility confirmation.
- **Backend Endpoints (`/api/v1/feed`):**
  - `GET /posts`: List scoped feed posts with pagination, search, post type filter, and department visibility checks.
  - `POST /posts`: Create a new feed post or broadcast with targeted departments/recipients and pin status.
  - `GET /posts/{id}`: Detailed post record, comments, reaction aggregations, and viewer status.
  - `PUT /posts/{id}`: Edit post content (creator or administrator only).
  - `DELETE /posts/{id}`: Soft-delete post.
  - `POST /posts/{id}/pin`: Toggle post pinned status (administrators and managers).
  - `POST /posts/{id}/comments`: Post a comment on a feed entry.
  - `DELETE /comments/{comment_id}`: Remove comment.
  - `POST /posts/{id}/reactions`: Toggle emoji reaction on a post.
  - `POST /posts/{id}/mark-read`: Record user read receipt.
- **Frontend Architecture & UX:**
  - Accessible via the `/feed` route and the topbar/sidebar navigation.
  - **Feed Composer (`FeedComposer.tsx`):** WYSIWYG post composer with announcement priority toggles, department multi-select dropdown, and validation.
  - **Feed Timeline & Post Cards (`FeedPostCard.tsx`):** Render author avatars, department badges, pinned visual ribbons, emoji reaction picker popover, reaction counters, and expandable comment threads.
  - **Interaction Privacy & RBAC:** Enforces granular view and interaction permissions so confidential and department-specific broadcasts are isolated strictly to authorized personnel.

---

## 9. Real-Time WebSocket & Event Synchronization

**File:** `backend/app/events/manager.py` & `frontend/src/lib/live/liveClient.ts`

- **Endpoint:** `ws://<host>:<port>/api/v1/events/ws?token=<JWT_ACCESS_TOKEN>`
- **Behavior:** Broadcasts entity mutation events (`RECORD_CREATED`, `RECORD_UPDATED`, `RECORD_DELETED`) to all connected client tabs. Client pages selectively refresh datasets, preventing concurrent edit collisions.

---

## 10. Multi-Tier Caching Engine

**File:** `backend/app/cache/`

- **Dual-Backend:** Supports Redis in distributed environments and `InMemoryCacheBackend` (with LRU eviction) for local development.
- **Namespaces:** `permissions:<user_id>`, `dropdowns:<entity>`, `dashboard:counts`, `records:<entity>:<id>`.
- **Admin API:** `GET /cache/stats`, `GET /cache/keys`, `DELETE /cache/flush`, `DELETE /cache/namespace/{name}`.

---

## 11. Universal Bulk Import & Export Wizard

**Files:** `frontend/src/components/ImportWizard.tsx`, `backend/app/common/importer.py`

- **Workflow:** File Upload (.xlsx / .csv) $\rightarrow$ Header Fuzzy Matching $\rightarrow$ Column Mapping UI $\rightarrow$ Client-Side Validation $\rightarrow$ Transactional Batch Insertion $\rightarrow$ Error Log Report.
- **Duplicate Prevention:** Validates existing database records by TIN, Email, Phone, or Code before commit.

---

## 12. Frontend Architecture & Single-Flight Token Refresh

**Files:** `frontend/src/lib/api.ts`, `frontend/src/lib/authContext.tsx`, `frontend/src/components/AppShell.tsx`

- **Routing:** React Router v6 with `ProtectedRoute` guards and deep-link redirect preservation.
- **Error Boundaries:** Multi-layer error boundary protection with an application-level root boundary in `main.tsx` and a route-keyed boundary (`ErrorBoundary key={location.pathname}`) in `App.tsx` ensuring crashed page states do not leak across navigation transitions.
- **Component Design System:** Predefined accessible UI tokens in `frontend/src/components/ui.tsx` and `fields.tsx` (including interactive `TextField` with automatic password visibility eye toggle `showPasswordToggle`).
- **Universal Filter Button & Panel Standard (Companies Benchmark):** All module page headers utilize a uniform filter toggle button matching the [Companies.tsx](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/pages/Companies.tsx#L5628) reference.
  - **Color Palette:** Solid `#556987` background, `#475569` on hover, and permanently locked to `#556987` when active or open (never switching to bright-blue or accent states).
  - **Geometry & Padding:** `padding: 8px 14px; border-radius: 6px; border: none; box-shadow: 0 2px 4px rgba(0,0,0,0.1);`. Hardcoded fixed dimensions (`38px x 38px`, `min-width: 36px`, etc.) are removed to prevent distorted square buttons.
  - **Funnel Icon:** Embedded 16×16px SVG funnel icon (`polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"`).
  - **Clean Surface:** No internal counter badges or notification dots on the button, guaranteeing an identical rectangular footprint across all modules.
  - **Initial State Invariant:** All filter panels and drawers initialize collapsed (`useState(false)`), ensuring clean page loads.
- **Hooks Architecture:** Custom hooks for asynchronous state management: `useAuth`, `usePendingGuard`, `useToast`, `usePagination`.
- **Computed Fields "Grey and Locked" Design Standard (`.calc-locked`):**
  - **Purpose:** Visually isolate formula-computed or server-derived fields from user-fillable fields across all ERP order and master forms.
  - **Color & Visual Tokens:** Soft slate grey background (`#e9ecef` in light mode, `#1e293b` in dark mode), subtle border (`#cbd5e1` / `#334155`), slate-600 font (`#475569`, `font-weight: 600`), and `cursor: not-allowed`.
  - **Container Helpers:** `.calc-locked-wrapper` flex container supporting input prefixes (e.g. `₹`, `$`, `%`) and lock indicator iconography (`🔒`).
  - **Applied Modules:** Local Purchase (`Total Of All Expenses`, `% Loading Expense (VB)`, line-item landing calculations), Import Purchase (`Total Expenses`, `Invoice Total Value`, `Gross Total Landing`, `% Loading Expense`, `Loading Amount per CBM`), and Products Master (`packaging_unit_cbm`, multi-package volume and weight summaries).
- **Universal "No Data" Empty State Standard:**
  - When query results or table datasets return 0 records, the table body MUST render a full-width row with the exact centered string: **`"No Data"`** (e.g. `<TableMessageRow colSpan={columns.length}>No Data</TableMessageRow>`).
  - Inconsistent, fragmented legacy empty messages (`"No records found."`, `"No suppliers found."`, `"No soft-deleted records found."`) are prohibited.
- **Table Skeleton Row Loaders Architecture:**
  - Reusable modular skeleton rows (e.g., `ProductSkeletonRows`, `CompanySkeletonRows`, `SupplierSkeletonRows`, `StockAdjustmentSkeletonRows`, `StockTransferSkeletonRows`) are rendered during table loading states.
  - Ensures zero layout shift, preserving column widths and header geometry until live records arrive from the backend.
- **Universal Table Action Dropdown (`⋮` Actions Menu) Geometry & Overflow Protection:**
  - **Problem Statement:** Data tables wrapped in horizontal scroll containers (`overflow-x: auto` / `.table-scroll`) create an overflow clipping context. Absolutely-positioned action dropdown menus (`top: 100%` or `top: 36px`) on bottom rows or in tables with few rows extend past the container bounds, getting cut off by scrollbars or clipped at the table bottom.
  - **Standardized Prevention Pattern:**
    1. **Container Min-Height:** Table scroll wrappers specify `minHeight: "320px"`, ensuring short tables (1–2 rows) provide ample clearance below rows without clipping.
    2. **Active Cell Stacking (`zIndex: 50`):** The action cell or trigger wrapper applies `zIndex: activeMenuId === row.id ? 50 : 1` with `position: relative`, ensuring opened popovers stack smoothly above sibling rows.
    3. **Dynamic Directional Flipping (`openUpward`):** Automatically computes row position:
       `const openUpward = items.length >= 3 && idx >= items.length - (items.length >= 4 ? 2 : 1);`
       When `openUpward` is true, the menu cleanly flips upward (`top: "auto"`, `bottom: ...`), adjusts margins, and inverts box shadows (`0 -4px 12px rgba(0,0,0,0.12)`), keeping all actions fully visible and unobstructed.
    4. **Viewport-Relative Floating Menus (`position: fixed`):** Where container boundaries strictly enforce clipping, action menus resolve coordinates via `getBoundingClientRect()` with capture-phase outside click and scroll listeners, breaking out of scroll wrappers entirely.
    5. **Applied Modules:** Import Purchase, Local Purchase, Sale Process List, Discount Payments, Proforma Invoices, Inquiries, Stock Transfer, Stock Adjustment, Technical Tasks, and Payments.
- **Upward-Opening Combobox Placement in Table Rows & Form Line Items (`placement="up"`):**
  - **Problem Statement:** In transactional item grids (e.g. `SaleProcessForm.tsx`, `ProformaInvoicesPage.tsx`), Combobox inputs rendered inside table cells default to opening downwards. In short tables, lower rows, or horizontally scrolled wrappers, downward popovers extend below the visible table boundaries, causing vertical scroll clipping or pushing container layout heights.
  - **Standardized Prevention Pattern:**
    1. Table-embedded searchable comboboxes specify `placement="up"`.
    2. The dropdown popover floats cleanly above the input trigger (`bottom: 100%`, `margin-bottom: 4px`), completely avoiding container overflow, clipped options, or table bottom collision.
    3. Applied across Product Row selectors, Additional Charge type selectors, and Unit selectors in Sales Process and Proforma Invoices.

---

## 13. Complete API Route & Endpoint Directory

| Module | HTTP Method | Endpoint URI | Description | Permission Gate |
| :--- | :--- | :--- | :--- | :--- |
| **Auth** | `POST` | `/api/v1/auth/login` | Authenticate credentials & issue JWT pair | Public |
| **Auth** | `POST` | `/api/v1/auth/refresh` | Rotate single-use refresh token | Public (Valid Token) |
| **Auth** | `POST` | `/api/v1/auth/logout` | Revoke refresh token & active session | Authenticated |
| **Auth** | `GET` | `/api/v1/auth/me` | Fetch profile & effective permissions | Authenticated |
| **Auth** | `GET` | `/api/v1/auth/sessions` | List active user device sessions | Authenticated |
| **Auth** | `DELETE`| `/api/v1/auth/sessions/{id}` | Revoke specific device session | Authenticated |
| **Users** | `GET` | `/api/v1/users` | List paginated users with search/sort | `user.read` |
| **Users** | `GET` | `/api/v1/users/all` | List all users (unpaginated for manager lookups) | `user.read` |
| **Users** | `GET` | `/api/v1/users/department-manager/{role_id}` | Get active manager for a department/role | `user.read` |
| **Users** | `POST` | `/api/v1/users` | Create person record (login user or workforce member via `has_login`) | `user.create` |
| **Users** | `GET` | `/api/v1/users/{id}` | Inspect user details & roles | `user.read` |
| **Users** | `PATCH` | `/api/v1/users/{id}` | Update user profile / reporting manager | `user.update` |
| **Users** | `POST` | `/api/v1/users/{id}/reset-password` | Generate temporary login password | `user.reset_password` |
| **Users** | `POST` | `/api/v1/users/{id}/roles` | Assign Role/Department (with assignment_type, is_primary, effective dates) | `user.action` |
| **Users** | `POST` | `/api/v1/users/{id}/deactivate` | Deactivate a user, terminate all active sessions, and block login | `user.action` |
| **Users** | `POST` | `/api/v1/users/{id}/activate` | Reactivate an inactive user, restoring login ability | `user.action` |
| **Users** | `DELETE`| `/api/v1/users/{id}` | Permanently disabled (returns 400 Bad Request to preserve audit integrity) | `user.action` |
| **RBAC** | `GET` | `/api/v1/rbac/roles` | List all Roles / Departments | `roles_permissions.view` |
| **RBAC** | `POST` | `/api/v1/rbac/roles` | Create new Role / Department (with optional `code` and `parent_department_id`) | `roles_permissions.create` |
| **RBAC** | `PATCH` | `/api/v1/rbac/roles/{id}` | Update Role name/description/code/parent (with cycle detection) | `roles_permissions.action` |
| **RBAC** | `DELETE`| `/api/v1/rbac/roles/{id}` | Delete Role (with impact check) | `roles_permissions.action` |
| **RBAC** | `POST` | `/api/v1/rbac/roles/{id}/delete-with-reassignment` | Safe delete with user reassignment | `roles_permissions.action` |
| **RBAC** | `GET` | `/api/v1/rbac/roles/{id}/hierarchy` | Fetch connected parent and child departments | `roles_permissions.view` |
| **RBAC** | `POST` | `/api/v1/rbac/roles/{id}/parents` | Link an additional parent department (with cycle check) | `roles_permissions.action` |
| **RBAC** | `DELETE`| `/api/v1/rbac/roles/{id}/parents/{parent_id}` | Unlink a parent department | `roles_permissions.action` |
| **RBAC** | `POST` | `/api/v1/rbac/roles/{id}/children` | Link an additional child department (with cycle check) | `roles_permissions.action` |
| **RBAC** | `DELETE`| `/api/v1/rbac/roles/{id}/children/{child_id}` | Unlink a child department | `roles_permissions.action` |
| **RBAC** | `GET` | `/api/v1/rbac/permissions` | List all system permission codes | `roles_permissions.view` |
| **RBAC** | `PUT` | `/api/v1/rbac/users/{id}/permissions/bulk` | Save per-user direct permission overrides | `roles_permissions.action` |
| **RBAC** | `GET` | `/api/v1/rbac/users/{id}/effective-permissions` | Compute effective user permissions | `roles_permissions.view` |
| **Positions** | `GET/POST`| `/api/v1/positions` | Manage positions/designations | `position.*` |
| **Positions** | `GET` | `/api/v1/positions/holders-for-user/{user_id}` | List position assignments held by a user | `position.view` |
| **Positions** | `POST/DELETE`| `/api/v1/positions/assignments[/{id}]` | Assign/remove an employee's position assignment | `position.update` |
| **Reporting** | `POST` | `/api/v1/reporting` | Create a reporting relationship (rejects self/circular reporting, 409) | `reporting.manage` |
| **Reporting** | `GET` | `/api/v1/reporting/managers/{user_id}` | List managers for a user | `reporting.view` |
| **Reporting** | `GET` | `/api/v1/reporting/direct-reports/{user_id}` | List direct reports for a user | `reporting.view` |
| **Reporting** | `DELETE`| `/api/v1/reporting/{id}` | Remove a reporting relationship | `reporting.manage` |
| **Reporting** | `POST` | `/api/v1/reporting/reassign-direct-reports/{manager_id}` | Move a manager's active direct reports to someone else | `reporting.manage` |
| **Reporting** | `POST` | `/api/v1/reporting/set-manager/{employee_id}` | Set or move an employee's primary manager (drag-and-drop org chart) | `reporting.manage` |
| **Reporting** | `GET` | `/api/v1/reporting/org-chart` | Dynamic organization chart data (active PRIMARY_REPORTING edges) | `reporting.view` |
| **Masters** | `GET/POST`| `/api/v1/masters/brands` | Manage product brands | `brand.*` |
| **Masters** | `GET/POST`| `/api/v1/masters/categories` | Manage product categories | `category.*` |
| **Masters** | `GET/POST`| `/api/v1/masters/subcategories` | Manage product sub-categories | `subcategory.*` |
| **Masters** | `GET/POST`| `/api/v1/masters/countries` | Manage country records | `country.*` |
| **Masters** | `GET/POST`| `/api/v1/masters/states` | Manage state/province records | `state.*` |
| **Masters** | `GET/POST`| `/api/v1/masters/cities` | Manage city records | `city.*` |
| **Masters** | `GET/POST`| `/api/v1/masters/currencies` | Manage currencies & conversion rates | `currency.*` |
| **Masters** | `GET/POST`| `/api/v1/masters/uom` | Manage units of measurement | `uom.*` |
| **Masters** | `GET/POST`| `/api/v1/masters/hsn` | Manage HSN/SAC customs codes | `hsn.*` |
| **Masters** | `GET/POST`| `/api/v1/masters/company-list` | Manage enterprise company/branch entities | `organizationlist.*` |
| **Masters** | `GET/POST`| `/api/v1/masters/supplier-types` | Manage supplier classification types | `suppliertype.*` |
| **Masters** | `GET/POST`| `/api/v1/masters/buyer-types` | Manage buyer client classification types | `buyertype.*` |
| **Masters** | `GET/POST`| `/api/v1/masters/taxes` | Manage tax rates, GST, and HSN codes | `tax.*` |
| **Masters** | `GET/POST`| `/api/v1/masters/additional-charges` | Manage freight, packing & forwarding, and additional charges | `additionalcharge.*` |
| **Masters** | `GET/POST`| `/api/v1/masters/social-media` | Manage social media communication channels | `socialmedia.*` |
| **Masters** | `GET/POST`| `/api/v1/masters/agent-types` | Manage agent classifications and partnership tiers | `agenttype.*` |
| **Masters** | `GET/POST`| `/api/v1/masters/company-categories` | Manage corporate tiers and B2B/B2C company categories | `companycategory.*` |
| **Search**  | `GET` | `/api/v1/search` | Universal global topbar search across all modules | Authenticated |
| **Products**| `GET` | `/api/v1/products` | Paginated product catalog | `product.read` |
| **Products**| `POST` | `/api/v1/products` | Create product record | `product.create` |
| **Products**| `PATCH` | `/api/v1/products/{id}` | Update product & technical specs | `product.update` |
| **Products**| `GET` | `/api/v1/products/{id}/datasheet-pdf` | Generate ReportLab PDF datasheet | `product.read` |
| **Suppliers**| `GET` | `/api/v1/suppliers` | List suppliers with multi-column sort | `supplier.read` |
| **Suppliers**| `POST` | `/api/v1/suppliers` | Create supplier record | `supplier.create` |
| **Suppliers**| `PATCH` | `/api/v1/suppliers/{id}` | Update supplier profile & bank details | `supplier.update` |
| **Suppliers**| `POST` | `/api/v1/suppliers/{id}/contacts` | Add contact to supplier directory | `supplier.update` |
| **Suppliers**| `POST` | `/api/v1/suppliers/import` | Bulk import suppliers from spreadsheet | `supplier.import` |
| **Suppliers**| `GET` | `/api/v1/suppliers/export` | Export supplier database | `supplier.export` |
| **Buyers** | `GET` | `/api/v1/buyers` | List buyer clients with status filters | `buyer.read` |
| **Buyers** | `POST` | `/api/v1/buyers` | Create buyer profile | `buyer.create` |
| **Buyers** | `PATCH` | `/api/v1/buyers/{id}` | Update buyer profile & credit limit | `buyer.update` |
| **Buyers** | `POST` | `/api/v1/buyers/{id}/addresses` | Add billing/shipping address | `buyer.update` |
| **Inquiries**| `GET` | `/api/v1/inquiries` | List RFQs with status filtering & financials | `inquiry.read` |
| **Inquiries**| `POST` | `/api/v1/inquiries` | Create new inquiry consignment | `inquiry.create` |
| **Inquiries**| `PATCH` | `/api/v1/inquiries/{id}` | Update inquiry header & status | `inquiry.update` |
| **Inquiries**| `POST` | `/api/v1/inquiries/{id}/items` | Add line item to inquiry | `inquiry.update` |
| **Inquiries**| `POST` | `/api/v1/inquiries/{id}/items/bulk` | Bulk add items to inquiry | `inquiry.update` |
| **Inquiries**| `POST` | `/api/v1/inquiries/{id}/bulk-rfqs` | Dispatch multi-item RFQ emails/WeChat to suppliers | `inquiry.action` |
| **Inquiries**| `GET`  | `/api/v1/inquiries/{id}/messages` | Fetch chronological two-way communication feed | `inquiry.read` |
| **Inquiries**| `GET`  | `/api/v1/inquiries/wechat/callback` | Tencent WeCom handshake verification | Public (Signature Verified) |
| **Inquiries**| `POST` | `/api/v1/inquiries/wechat/callback` | WeCom webhook handler with AI quotation ingestion | Public (AES Decrypted) |
| **Inquiries**| `POST` | `/api/v1/inquiries/items/{item_id}/rfqs` | Dispatch single-item RFQ email & portal link | `inquiry.action` |
| **Inquiries**| `POST` | `/api/v1/inquiries/items/{item_id}/quotations` | Manually record supplier quotation | `inquiry.update` |
| **Inquiries**| `PATCH` | `/api/v1/inquiries/quotations/{id}` | Edit quotation details (qty, price, currency, terms) | `inquiry.update` |
| **Inquiries**| `PATCH` | `/api/v1/inquiries/quotations/{id}/status` | Approve or reject quotation | `inquiry.approve` |
| **Inquiries**| `DELETE` | `/api/v1/inquiries/quotations/{id}` | Soft-delete quotation & resync KPIs | `inquiry.delete` |
| **Inquiries**| `POST` | `/api/v1/inquiries/inbound-webhook` | Inbound webhook for WeChat/Email auto-ingestion | Public (API / Webhook) |
| **Inquiries**| `GET` | `/api/v1/inquiries/items/{item_id}/quotations` | List quotations with turnaround & lead times | `inquiry.read` |
| **Inquiries**| `GET` | `/api/v1/inquiries/quotations/documents` | Fetch all quotation sheets for Gallery | `inquiry.read` |
| **Inquiries**| `POST` | `/api/v1/inquiries/bulk-tally-post` | Bulk mark items as Tally Entry Posted | `inquiry.update` |
| **Public** | `GET` | `/api/v1/public/quotes/{token}` | Fetch RFQ specifications for vendor | Public (Token Validated) |
| **Public** | `POST` | `/api/v1/public/quotes/{token}` | Submit vendor quote bids & lead times | Public (Token Validated) |
| **Public** | `POST` | `/api/v1/public/quotes/{token}/upload` | Upload quotation PDF / datasheet | Public (Token Validated) |
| **Planning**| `GET` | `/api/v1/planning/sheets` | List planning sheets / branches | `planning.read` |
| **Planning**| `POST` | `/api/v1/planning/sheets` | Create planning sheet | `planning.sheet.manage` |
| **Planning**| `GET` | `/api/v1/planning/sheets/{id}/grid` | Fetch dynamic planning matrix | `planning.read` |
| **Planning**| `GET` | `/api/v1/planning/sheets/{id}/filter-values` | Query distinct column filter values & counts | `planning.read` |
| **Planning**| `GET` | `/api/v1/planning/organization-search` | Search items across all branch sheets of an organization | `planning.read` |
| **Planning**| `POST` | `/api/v1/planning/rows` | Add item row to planning sheet | `planning.row.manage` |
| **Planning**| `POST` | `/api/v1/planning/columns` | Add dynamic column to sheet | `planning.column.manage` |
| **Planning**| `PATCH` | `/api/v1/planning/cells` | Update cell value & status color | `planning.cell.edit` |
| **Planning**| `POST` | `/api/v1/planning/container-calc` | Compute container CBM & load capacity | `planning.read` |
| **Audit** | `GET` | `/api/v1/audit` | Query immutable audit change logs | `audit.view` |
| **Trash** | `GET` | `/api/v1/trash` | List soft-deleted records | `trash.view` |
| **Trash** | `POST` | `/api/v1/trash/{entity}/{id}/restore` | One-click restore deleted record | `trash.restore` |
| **Trash** | `DELETE`| `/api/v1/trash/{entity}/{id}/purge` | Permanently purge record | `trash.purge` (Super Admin) |
| **Cache** | `GET` | `/api/v1/cache/stats` | Inspect cache metrics & hit rate | `settings.manage` |
| **Cache** | `DELETE`| `/api/v1/cache/flush` | Flush entire cache | `settings.manage` |
| **Organizations** | `GET/PATCH` | `/api/v1/organizations/profile` | Manage enterprise company profile & logo | `organization.view/manage` |
| **Events** | `WS` | `/api/v1/events/ws` | Real-time WebSocket connection bus | Authenticated |
| **Tasks** | `GET` | `/api/v1/tasks` | List scoped tasks with view_mode (`my`/`department`/`organization`/`kanban`/`calendar`), optional `department_id`, and status (`ON_HOLD`), priority, date filters | `task.view` |
| **Tasks** | `POST` | `/api/v1/tasks` | Create task with default status TODO, multiple assignees, watchers, start/due dates, subtasks & optional initial escalation | `task.view` / `task.create` |
| **Tasks** | `POST` | `/api/v1/tasks/check-holds` | Scan and flag expired task holds, broadcasting expiration notifications | `task.manage` / Super Admin |
| **Tasks** | `GET` | `/api/v1/tasks/escalate-options` | Fetch candidate reporting managers, department managers & org users | `task.view` |
| **Tasks** | `GET` | `/api/v1/tasks/{id}` | Retrieve task detail, assignees, subtasks, comments & escalation history | `task.view` |
| **Tasks** | `POST` | `/api/v1/tasks/upload-file` | Multipart file & audio blob upload (Supabase/local fallback) | `task.view` |
| **Tasks** | `POST` | `/api/v1/tasks/{id}/attachments` | Add file attachment metadata to task | `task.view` |
| **Tasks** | `DELETE`| `/api/v1/tasks/attachments/{attachment_id}` | Remove task file attachment | `task.manage` / Creator |
| **Tasks** | `POST` | `/api/v1/tasks/{id}/voice-notes` | Persist recorded audio voice note to task | `task.view` |
| **Tasks** | `GET` | `/api/v1/tasks/subtasks/{subtask_id}/comments` | List subtask independent discussion comments | `task.view` |
| **Tasks** | `POST` | `/api/v1/tasks/subtasks/{subtask_id}/comments` | Post independent comment to subtask | `task.view` |
| **Tasks** | `GET` | `/api/v1/tasks/subtasks/{subtask_id}/attachments` | List subtask independent file attachments | `task.view` |
| **Tasks** | `POST` | `/api/v1/tasks/subtasks/{subtask_id}/attachments` | Attach file metadata to subtask | `task.view` |
| **Tasks** | `GET` | `/api/v1/tasks/escalations/{escalation_id}/comments` | List escalation independent resolution comments | `task.view` |
| **Tasks** | `POST` | `/api/v1/tasks/escalations/{escalation_id}/comments` | Post resolution comment to escalation | `task.view` |
| **Tasks** | `PATCH`| `/api/v1/tasks/{id}` | Update title, description, status, priority, start date, due date | `task.view` |
| **Tasks** | `DELETE`| `/api/v1/tasks/{id}` | Soft-delete task with audit log | `task.manage` / `task.delete` |
| **Tasks** | `GET` | `/api/v1/tasks/{id}/timeline` | Synthesize chronological activity timeline events | `task.view` |
| **Tasks** | `POST` | `/api/v1/tasks/{id}/assign` | Assign team members with role (`ASSIGNEE` / `WATCHER`) | `task.assign` / `task.manage` |
| **Tasks** | `POST` | `/api/v1/tasks/{id}/comment` | Post rich comment with message, audio & file attachments | `task.view` |
| **Tasks** | `POST` | `/api/v1/tasks/{id}/escalate` | Record escalation to reporting manager, department head, or org user | `task.escalate` / `task.manage` |
| **Tasks** | `POST` | `/api/v1/tasks/{id}/subtasks` | Add mini-task subtask with dates, priority, status & assignees | `task.view` |
| **Tasks** | `PATCH`| `/api/v1/tasks/subtasks/{subtask_id}` | Edit mini-task subtask fields or toggle completion | `task.view` |
| **Tasks** | `DELETE`| `/api/v1/tasks/subtasks/{subtask_id}` | Remove mini-task subtask checklist item | `task.view` |
| **Tasks V2** | `GET` | `/api/v1/tasks/labels` | List all reusable task labels | `task.view` |
| **Tasks V2** | `POST` | `/api/v1/tasks/labels` | Create a color-coded task label | `task.view` |
| **Tasks V2** | `GET` | `/api/v1/tasks/sprints` | List sprints filtered by optional status | `task.view` |
| **Tasks V2** | `POST` | `/api/v1/tasks/sprints` | Create a new planned/active sprint | `task.create` / `task.manage` |
| **Tasks V2** | `PATCH`| `/api/v1/tasks/sprints/{id}` | Update sprint name, goal, dates, or status | `task.create` / `task.manage` |
| **Tasks V2** | `DELETE`| `/api/v1/tasks/sprints/{id}` | Delete sprint and unassign child tasks to backlog | `task.create` / `task.manage` |
| **Tasks V2** | `GET` | `/api/v1/tasks/templates` | List reusable boilerplate task templates | `task.view` |
| **Tasks V2** | `POST` | `/api/v1/tasks/templates` | Create boilerplate task template with default subtasks & labels | `task.view` |
| **Tasks V2** | `PATCH`| `/api/v1/tasks/templates/{id}` | Update boilerplate task template | `task.view` |
| **Tasks V2** | `DELETE`| `/api/v1/tasks/templates/{id}` | Delete boilerplate task template | `task.view` |
| **Tasks V2** | `GET` | `/api/v1/tasks/saved-filters` | List current user's saved filter presets | `task.view` |
| **Tasks V2** | `POST` | `/api/v1/tasks/saved-filters` | Create user saved filter preset | `task.view` |
| **Tasks V2** | `PATCH`| `/api/v1/tasks/saved-filters/{id}` | Update saved filter name or criteria | `task.view` |
| **Tasks V2** | `DELETE`| `/api/v1/tasks/saved-filters/{id}` | Delete user saved filter preset | `task.view` |
| **Tasks V2** | `POST` | `/api/v1/tasks/bulk` | Execute mass bulk operations (status, priority, label, sprint, delete) | `task.view` / `task.manage` |
| **Tasks V2** | `POST` | `/api/v1/tasks/{id}/duplicate` | Duplicate task with subtasks, labels, and watchers | `task.view` / `task.create` |
| **Tasks V2** | `POST` | `/api/v1/tasks/{id}/dependencies` | Link dependency (`BLOCKS`, `BLOCKED_BY`, `RELATES_TO`) with cycle check | `task.view` |
| **Tasks V2** | `DELETE`| `/api/v1/tasks/dependencies/{id}` | Remove task dependency relationship | `task.view` |
| **Tasks V2** | `POST` | `/api/v1/tasks/{id}/reactions` | Toggle emoji reaction on task | `task.view` |
| **Tasks V2** | `POST` | `/api/v1/tasks/comments/{id}/reactions` | Toggle emoji reaction on task comment | `task.view` |
| **Tasks V2** | `POST` | `/api/v1/tasks/{id}/submit-approval` | Submit task for manager approval | `task.view` |
| **Tasks V2** | `POST` | `/api/v1/tasks/{id}/action-approval` | Action task approval (`approved: true/false`, notes) | `task.view` |
| **Tasks V2** | `GET` | `/api/v1/tasks/workload` | Team workload metrics dashboard per employee | `task.view` |
| **Tasks V2** | `GET` | `/api/v1/tasks/capacity` | Team workload capacity grid matrix by date range | `task.view` |
| **Search** | `GET` | `/api/v1/search?q=` | Global search across tasks (title, description, label, comment) | Authenticated |
| **Notifications** | `GET` | `/api/v1/notifications` | Fetch user in-app notifications | Authenticated |
| **Notifications** | `GET` | `/api/v1/notifications/unread-count` | Get unread notification badge count | Authenticated |
| **Notifications** | `POST` | `/api/v1/notifications/{id}/read` | Mark single notification as read | Authenticated |
| **Notifications** | `POST` | `/api/v1/notifications/read-all` | Mark all notifications as read | Authenticated |
| **Inventory: Stock** | `GET` | `/api/v1/inventory/product-stock` | Full-catalog 15-column Product Stock & Stock Transactions master list (`limit <= 5000`) with master joins, `filter_options` & `breakup_flags` | `product.view` |
| **Inventory: Stock** | `GET` | `/api/v1/inventory/product-stock/{id}` | Retrieve individual product stock valuation & availability ledger (by `ProductStock.id` or `Product.id`) | `product.view` |
| **Inventory: Stock** | `GET` | `/api/v1/product-stock` | Legacy alias for `/inventory/product-stock` | `product.view` |
| **Inventory: Stock** | `GET` | `/api/v1/product-stock/list` | Legacy alias for `/inventory/product-stock` | `product.view` |
| **Reports: Stock Ledger** | `GET` | `/api/v1/inventory/stock-transactions/{product_ref}` | Chronological per-product stock transaction ledger across Sale Orders, Adjustments, Local/Import Purchases & Transfers | `product.view` |
| **Reports: Stock Ledger** | `GET` | `/api/v1/stock-transaction/list/{product_ref}` | Legacy alias for `/inventory/stock-transactions/{product_ref}` | `product.view` |
| **Inventory: Re-Order** | `GET` | `/api/v1/inventory/product-reorder` | Full-catalog 16-column Product Re-Order matrix with master joins, `filter_options`, `breakup_flags` & branch `warehouse` scoping | `product.view` |
| **Inventory: Re-Order** | `PATCH` | `/api/v1/inventory/product-reorder/{product_id}` | Inline update of global or branch-scoped `reorder_level` and `minimum_order_quantity` (`MOQ`) | `product.edit` |
| **Inventory: Breakup** | `GET` | `/api/v1/inventory/product-stock/breakup` | Physical open Sale Order breakup (`unit_price` excluded) & Transit/Ordered consignment + StockTransfer FIFO breakup | `product.view` |
| **Inventory: Adjustment** | `GET` | `/api/v1/inventory/stock-adjustment` | List stock adjustment vouchers with date range, purpose & type filters | `product.view` |
| **Inventory: Adjustment** | `GET` | `/api/v1/inventory/stock-adjustment/{id}` | Retrieve stock adjustment voucher with multi-line item breakdown | `product.view` |
| **Inventory: Adjustment** | `POST` | `/api/v1/inventory/stock-adjustment` | Create stock adjustment voucher & atomically update warehouse quantities | `product.create` |
| **Inventory: Adjustment** | `DELETE`| `/api/v1/inventory/stock-adjustment/{id}` | Soft-delete stock adjustment voucher & revert stock mutations | `product.delete` |
| **Inventory: Adjustment** | `GET` | `/api/v1/adjustment/list` | Legacy alias for `/inventory/stock-adjustment` | `product.view` |
| **Inventory: Adjustment** | `GET` | `/api/v1/adjustment/{id}` | Legacy alias for `/inventory/stock-adjustment/{id}` | `product.view` |
| **Inventory: Adjustment** | `POST` | `/api/v1/adjustment` | Legacy alias for creating adjustment | `product.create` |
| **Inventory: Adjustment** | `DELETE`| `/api/v1/adjustment/{id}` | Legacy alias for deleting adjustment | `product.delete` |
| **Inventory: Adjustment** | `GET` | `/api/v1/adjustment/adjustment-order-pdf/{id}` | Generate/stream official A4 adjustment order PDF | `product.view` |
| **Companies** | `GET` | `/api/v1/companies` | List enterprise companies with grade, potential & search filters | `company.view` |
| **Companies** | `POST` | `/api/v1/companies` | Create new enterprise company profile | `company.create` |
| **Companies** | `GET` | `/api/v1/companies/{id}` | Get company profile, multi-contact directory & address matrix | `company.view` |
| **Companies** | `PATCH` | `/api/v1/companies/{id}` | Update company details, credit terms, and status | `company.update` |
| **Companies** | `DELETE`| `/api/v1/companies/{id}` | Soft-delete company record | `company.delete` |
| **Companies** | `POST` | `/api/v1/companies/{id}/contacts` | Add contact person to company roster | `company.update` |
| **Companies** | `PATCH` | `/api/v1/companies/{id}/grade` | Quick-update company tier/grade (A, B, C, D) | `company.update` |
| **Companies** | `PATCH` | `/api/v1/companies/{id}/potential` | Quick-update revenue potential rating | `company.update` |
| **Companies** | `POST` | `/api/v1/companies/import` | Bulk import companies from spreadsheet | `company.import` |
| **Companies** | `GET` | `/api/v1/companies/export` | Export company database to Excel / CSV | `company.export` |
| **Technical Tasks** | `GET` | `/api/v1/technical-tasks` | List technical service tasks with tab status, call type & filters | `technicaltask.view` |
| **Technical Tasks** | `GET` | `/api/v1/technical-tasks/counts` | Get status counts across tabs (All, Pending, Allotted, Under Process, etc.) | `technicaltask.view` |
| **Technical Tasks** | `GET` | `/api/v1/technical-tasks/payment-summary` | Aggregated payment summary KPIs (`total_payment`, `paid`, `due`, counts) | `technicaltask.view` |
| **Technical Tasks** | `POST` | `/api/v1/technical-tasks` | Create field service ticket or machine maintenance task | `technicaltask.create` |
| **Technical Tasks** | `GET` | `/api/v1/technical-tasks/{id}` | Retrieve technical service task details | `technicaltask.view` |
| **Technical Tasks** | `PATCH` | `/api/v1/technical-tasks/{id}` | Update technical service task fields & notes | `technicaltask.update` |
| **Technical Tasks** | `PATCH` | `/api/v1/technical-tasks/{id}/status` | Transition task status (pending -> allotted -> under process -> done) | `technicaltask.update` |
| **Technical Tasks** | `POST` | `/api/v1/technical-tasks/{id}/record-payment` | Atomically record collected payment amount, payment mode, reference no, date, and receipt | `technicaltask.update` |
| **Technical Tasks** | `POST` | `/api/v1/technical-tasks/upload-screenshot` | Upload payment screenshot / receipt image or PDF | Authenticated |
| **Technical Tasks** | `DELETE`| `/api/v1/technical-tasks/{id}` | Soft-delete technical task | `technicaltask.delete` |
| **Technical Tasks** | `POST` | `/api/v1/technical-tasks/bulk-delete` | Bulk soft-delete selected technical tasks | `technicaltask.delete` |
| **Masters** | `GET/POST`| `/api/v1/masters/districts` | Manage administrative district records | `district.*` |
| **Masters** | `GET/POST`| `/api/v1/masters/company-sectors` | Manage industry sectors (Agriculture, Pharma, FMCG, Metals, etc.) | `companysector.*` |
| **Masters** | `GET/POST`| `/api/v1/masters/warehouses` | Manage inventory hubs, transit depots & billing company links | `warehouse.*` |
| **Masters** | `GET/POST`| `/api/v1/masters/billing-companies` | Manage billing legal entities & tax credentials | `billingcompany.*` |
| **Masters** | `GET/POST`| `/api/v1/masters/technicians` | Manage field service engineers & service technicians | `technician.*` |
| **Masters** | `GET/POST`| `/api/v1/masters/banks` | Manage corporate banking registry (IFSC, Account No, Branch) | `bank.*` |
| **Masters** | `GET/POST`| `/api/v1/masters/transports` | Manage logistics providers, transport carriers & tracking links | `transport.*` |
| **Masters** | `GET/POST`| `/api/v1/masters/payment-terms` | Manage commercial payment terms & credit days | `paymentterms.*` |
| **Masters** | `GET/POST`| `/api/v1/masters/lead-sources` | Manage lead generation sources & marketing channels | `leadsource.*` |
| **Masters** | `GET/POST`| `/api/v1/masters/adjustment-purposes` | Manage stock adjustment reasons (Damage, Split, Return, Count Variance) | `adjustmentpurpose.*` |
| **Masters** | `GET/POST`| `/api/v1/masters/call-types` | Manage field service call types (Installation, Breakdown, Maintenance) | `calltype.*` |
| **Purchase: Local** | `GET` | `/api/v1/purchase/local-orders` | List local purchase orders with filters, search, multi-date range & summary KPIs | `purchase.local.view` |
| **Purchase: Local** | `POST` | `/api/v1/purchase/local-orders` | Create local purchase order with line items, tax, and automated landing cost | `purchase.local.create` |
| **Purchase: Local** | `POST` | `/api/v1/purchase/local-orders/import` | Import local purchase orders from CSV / XLSX with column mapping & summary | `Authenticated` |
| **Purchase: Local** | `GET` | `/api/v1/purchase/local-orders/{id}` | Retrieve local purchase order with line items & landed cost breakdown | `purchase.local.view` |
| **Purchase: Local** | `PUT` | `/api/v1/purchase/local-orders/{id}` | Update local purchase order details & line items | `purchase.local.update` |
| **Purchase: Local** | `DELETE`| `/api/v1/purchase/local-orders/{id}` | Soft-delete local purchase order | `purchase.local.delete` |
| **Purchase: Local** | `POST` | `/api/v1/purchase/local-orders/{id}/status` | Transition local order status via dynamic workflow engine | `purchase.local.approve` |
| **Purchase: Local** | `POST` | `/api/v1/purchase/local-orders/{id}/stock-in` | Execute atomic warehouse stock-in voucher generation | `purchase.local.stock_in` |
| **Purchase: Local** | `GET` | `/api/v1/purchase/local-orders/export` | Export local purchase orders to Excel / CSV | `purchase.local.view` |
| **Purchase: Import** | `GET` | `/api/v1/purchase/import-orders` | List import consignments with filters, search, custom date ranges & summary KPIs | `purchase.import.view` |
| **Purchase: Import** | `POST` | `/api/v1/purchase/import-orders` | Create import consignment with active Supplier/Warehouse/Products, `expected_arrival_date = eta_port_date + 5 days` default when omitted, duty calculations & dual landing costs | `purchase.import.create` |
| **Purchase: Import** | `POST` | `/api/v1/purchase/import-orders/import` | Import overseas consignments from CSV / XLSX with active master validation, `ETA Port Date + 5 days` fallback, column mapping & summary | `Authenticated` |
| **Purchase: Import** | `GET` | `/api/v1/purchase/import-orders/{id}` | Retrieve import consignment details with line items & landing calculations | `purchase.import.view` |
| **Purchase: Import** | `PUT` | `/api/v1/purchase/import-orders/{id}` | Update import consignment details & line items | `purchase.import.update` |
| **Purchase: Import** | `DELETE`| `/api/v1/purchase/import-orders/{id}` | Soft-delete import consignment | `purchase.import.delete` |
| **Purchase: Import** | `POST` | `/api/v1/purchase/import-orders/{id}/status` | Transition consignment status via dynamic workflow engine | `purchase.import.approve` |
| **Purchase: Import** | `POST` | `/api/v1/purchase/import-orders/{id}/stock-in` | Execute atomic inventory stock-in into destination warehouse | `purchase.import.stock_in` |
| **Purchase: Import** | `GET` | `/api/v1/purchase/import-orders/export` | Export import consignments to Excel / CSV | `purchase.import.view` |
| **Sales: Proforma** | `GET` | `/api/v1/sales/proforma-invoices` | List proforma invoices with customer, date, status & search filters | `sale.pi.view` |
| **Sales: Proforma** | `POST` | `/api/v1/sales/proforma-invoices` | Create proforma invoice with billing/shipping address routing & line items | `sale.pi.create` |
| **Sales: Proforma** | `GET` | `/api/v1/sales/proforma-invoices/{id}` | Retrieve proforma invoice details, line items & commercial terms | `sale.pi.view` |
| **Sales: Proforma** | `PUT` | `/api/v1/sales/proforma-invoices/{id}` | Update proforma invoice details & commercial terms | `sale.pi.update` |
| **Sales: Proforma** | `DELETE`| `/api/v1/sales/proforma-invoices/{id}` | Soft-delete proforma invoice | `sale.pi.delete` |
| **Sales: Proforma** | `POST` | `/api/v1/sales/proforma-invoices/{id}/status` | Transition proforma status via dynamic workflow engine | `sale.pi.approve` |
| **Sales: Proforma** | `GET` | `/api/v1/sales/proforma-invoices/{id}/pdf` | Generate/stream official branded Proforma Invoice PDF | `sale.pi.view` |
| **Sales: Proforma** | `GET` | `/api/v1/sales/proforma-invoices/export` | Export proforma invoices to Excel / CSV | `sale.pi.view` |
| **Sales: Orders**   | `GET` | `/api/v1/sales/orders` | Paginated list of confirmed & pending Sales Orders with status stages and filters | `saleorder.view` |
| **Sales: Orders**   | `POST`| `/api/v1/sales/orders` | Create Sales Order defaulting to `pending` status with line items & commercial terms | `saleorder.create` |
| **Sales: Orders**   | `GET` | `/api/v1/sales/orders/{id}` | Inspect detailed Sales Order record with line items, tax, and address breakdown | `saleorder.view` |
| **Sales: Orders**   | `PATCH`| `/api/v1/sales/orders/{id}` | Update Sales Order details, line items, and commercial fields | `saleorder.update` |
| **Sales: Orders**   | `PATCH`| `/api/v1/sales/orders/{id}/status` | Advance Sales Order stage (`pending` -> `sales_confirmed` -> `admin_approved` -> `acc_confirmed` -> `gatepass_created` -> `dispatched` -> `lr`) with PO & Tally Bill metadata | Authenticated (Workflow RBAC) |
| **Sales: Orders**   | `POST`| `/api/v1/sales/upload-po` | Upload client Purchase Order (PO) document (`inhyma-sales-docs` / `sales_po`) | Authenticated |
| **Sales: Orders**   | `POST`| `/api/v1/sales/upload-tally-bill` | Upload Tally Bill invoice document (`inhyma-sales-docs` / `sales_tally_bills`) | Authenticated |
| **Sales: Orders**   | `POST`| `/api/v1/sales/upload-lr` | Upload Lorry Receipt (LR) document (`inhyma-sales-docs` / `sales_lr`) | Authenticated |
| **Sales: Orders**   | `POST`| `/api/v1/sales/upload-dispatch-media` | Upload multiple dispatch images/videos (`inhyma-sales-docs` / `sales_dispatch_media`) | Authenticated |
| **Sales: Orders**   | `POST`| `/api/v1/sales/orders/{id}/status-with-po` | Atomic multipart status transition with optional PO document upload | Authenticated (Workflow RBAC) |
| **Sales: Orders**   | `DELETE`| `/api/v1/sales/orders/{id}` | Soft-delete Sales Order and atomically revert deducted stock back to inventory | `saleorder.delete` |
| **Sales: Orders**   | `POST`| `/api/v1/sales/orders/{id}/restore` | Restore soft-deleted Sales Order (Admin only) | `saleorder.manage` |
| **Sales: Orders**   | `GET` | `/api/v1/sales/metrics` | Grouped sales order KPI metrics by status tabs (all, pending, confirmed, dispatched, etc.) | `saleorder.view` |
| **Sales: Orders**   | `GET` | `/api/v1/sales/next-gatepass-no` | Generate next sequential gate pass reference number | `saleorder.view` |
| **Sales: Orders**   | `GET` | `/api/v1/sales/planning-consignments` | Extract consignment columns from Shipment Planning sheets for order pre-allocation | `saleorder.view` |
| **Sales: Orders**   | `GET` | `/api/v1/sales/planning-consignments/{column_id}/items` | Extract planned products and quantities from consignment column | `saleorder.view` |
| **Sales: Orders**   | `GET` | `/api/v1/sales/export` | Export Sales Orders dataset to Excel spreadsheet | `saleorder.view` |
| **Sales: Gate Pass**| `POST`| `/api/v1/sales/gate-pass` | Create dispatch Gate Pass with logistics metadata and transporter carrier | `saleorder.update` |
| **Sales: Logistics**| `POST`| `/api/v1/sales/orders/{id}/upload-lr` | Attach transporter LR document and multi-photo delivery proof | `saleorder.update` |
| **Sales: Discounts**| `GET` | `/api/v1/sales/discount-payments` | List synchronized Sale Order discount payment ledger entries with live Company/GatePass enrichment & `payments` history | `saleorder.view` |
| **Sales: Discounts**| `POST`| `/api/v1/sales/discount-payments` | Create standalone discount payment authorization record | `saleorder.update` |
| **Sales: Discounts**| `PATCH`| `/api/v1/sales/discount-payments/{payment_id}` | Record validated partial/full discount adjustment installment into `payments` ledger with authenticated `adjusted_by` | `saleorder.update` |
| **Workflow Engine** | `GET` | `/api/v1/masters/workflow-rules` | List registered workflow status transition rules | `workflow.view` |
| **Workflow Engine** | `POST` | `/api/v1/masters/workflow-rules` | Create or update database-driven workflow transition rule | `workflow.manage` |
| **Federation** | `POST` | `/api/v1/federation/sso-handover` | Generate cross-ERP single sign-on handover ticket | Authenticated |
| **Federation** | `POST` | `/api/v1/federation/token` | Exchange SSO ticket for local JWT session pair | Public (Ticket Validated) |
| **Federation** | `GET` | `/api/v1/health/federation` | Run live diagnostics & latency ping against ERP_Main central registry | Super Admin / Authenticated |
| **Organizations** | `GET` | `/api/v1/organizations/public` | Fetch public organization name and logo for login page | Public |
| **Purchase: Import** | `GET` | `/api/v1/purchase/import-orders/{id}/bill-file` | Stream or download original uploaded bill file with Bearer or query token (`?token=`) | `purchase.import.view` |
| **CRM: Leads** | `GET` | `/api/v1/crm/leads` | List CRM leads with search, source, status, assignment & stage filters | `crm.view` |
| **CRM: Leads** | `POST` | `/api/v1/crm/leads` | Create new CRM lead with contact info and stage | `crm.create` |
| **CRM: Leads** | `GET` | `/api/v1/crm/leads/{id}` | Inspect CRM lead details and requirements | `crm.view` |
| **CRM: Leads** | `PATCH` | `/api/v1/crm/leads/{id}` | Update CRM lead details, notes & fields | `crm.update` |
| **CRM: Leads** | `PATCH` | `/api/v1/crm/leads/{id}/stage` | Advance or update lead pipeline stage (Kanban drag-and-drop) | `crm.update` |
| **CRM: Leads** | `GET` | `/api/v1/crm/leads/{id}/timeline` | 360-degree chronological lead activity timeline | `crm.view` |
| **CRM: Leads** | `POST` | `/api/v1/crm/leads/{id}/convert-company` | Convert lead into official B2B Company record | `company.create` |
| **CRM: Import** | `POST` | `/api/v1/crm/import` | Bulk import leads from CSV/Excel with column mapping & deduplication | `crm.import` |
| **CRM: Pipeline** | `GET/POST`| `/api/v1/crm/pipeline` | Manage CRM pipeline stages, ordering, and SLA limits | `crm.pipeline.manage` |
| **CRM: Distribution**| `GET/POST`| `/api/v1/crm/distribution` | Manage round-robin lead distribution rules across sales team | `crm.distribution.manage` |
| **CRM: Quotation** | `GET` | `/api/v1/crm/quotations` | List CRM sales quotations with status & client filters | `crm.quotation.view` |
| **CRM: Quotation** | `POST` | `/api/v1/crm/quotations` | Create branded sales quotation with itemized terms | `crm.quotation.create` |
| **CRM: Quotation** | `GET` | `/api/v1/crm/quotations/{id}/pdf` | Stream or download branded ReportLab Quotation PDF | `crm.quotation.view` |
| **Workforce: Recurring**| `GET` | `/api/v1/tasks/recurring-schedules` | List recurring task schedules with status and cadence filters | `task.view` |
| **Workforce: Recurring**| `POST` | `/api/v1/tasks/recurring-schedules` | Create recurring task template with cron/interval cadence | `task.create` |
| **Workforce: Recurring**| `PATCH`| `/api/v1/tasks/recurring-schedules/{id}` | Update schedule recurrence pattern, assignees, or priority | `task.update` |
| **Workforce: Recurring**| `PATCH`| `/api/v1/tasks/recurring-schedules/{id}/status` | Pause, resume, or archive recurring schedule | `task.update` |
| **Workforce: Recurring**| `POST` | `/api/v1/tasks/recurring-schedules/{id}/trigger` | Manually spawn next task instance immediately | `task.create` |
| **Product: Sync** | `POST` | `/api/v1/products/sync-yinglima` | Trigger outbound product catalog synchronization from Yinglima to Inhyma | `product.manage` |
| **Feed**            | `GET` | `/api/v1/feed/posts` | List scoped feed posts with pagination, search, and department visibility checks | Authenticated |
| **Feed**            | `POST`| `/api/v1/feed/posts` | Create a new broadcast or discussion post with targeted departments/recipients | Authenticated |
| **Feed**            | `GET` | `/api/v1/feed/posts/{id}` | Detailed post record, comments, reaction aggregations, and viewer status | Authenticated |
| **Feed**            | `PUT` | `/api/v1/feed/posts/{id}` | Edit post content (creator or administrator only) | Authenticated |
| **Feed**            | `DELETE`| `/api/v1/feed/posts/{id}` | Soft-delete feed post | Authenticated |
| **Feed**            | `POST`| `/api/v1/feed/posts/{id}/pin` | Toggle post pinned status | `feed.pin` / Admin |
| **Feed**            | `POST`| `/api/v1/feed/posts/{id}/comments` | Post comment on feed entry | Authenticated |
| **Feed**            | `DELETE`| `/api/v1/feed/comments/{comment_id}` | Soft-delete comment | Authenticated |
| **Feed**            | `POST`| `/api/v1/feed/posts/{id}/reactions` | Toggle emoji reaction on post | Authenticated |
| **Feed**            | `POST`| `/api/v1/feed/posts/{id}/mark-read` | Record user read receipt for broadcast compliance | Authenticated |

---

## 14. Developer & AI Integration Guide (Rules of Engagement)

When building new features, modifying endpoints, or merging external components into this ERP:

### 14.1. Adding a New Business Module
1. **Model**: Create `backend/app/<module>/models.py`. Inherit from `Base`, `UUIDPrimaryKeyMixin`, `TimestampMixin`, `SoftDeleteMixin`, and `VersionMixin`.
2. **Schemas**: Define `Create`, `Update`, `Read` schemas in `backend/app/<module>/schemas.py`.
3. **Repository**: Inherit from `BaseRepository[Model]` in `backend/app/<module>/repository.py`.
4. **Service**: Implement business rules and audit recording in `backend/app/<module>/service.py`.
5. **Routes**: Wire endpoints with `Depends(require_permission("<module>.<action>"))` in `backend/app/<module>/routes.py`.
6. **Register Router**: Include the router in `backend/app/api/v1/router.py`.
7. **Migration**: Generate migration via `alembic revision --autogenerate -m "add <module> table"`.
8. **Frontend**: Create `frontend/src/pages/<Module>.tsx` and register route in `frontend/src/lib/nav.ts`.
9. **Living Documentation**: Update `doc/SYSTEM_DOCUMENTATION.md` immediately per [`AGENTS.md`](file:///c:/Users/Inhyma%20Solutions/Downloads/ERP_Main_Claude-main/AGENTS.md).

### 14.2. Antipatterns & Critical Rules
- ❌ **NEVER execute physical deletion (`session.delete(row)`) in standard flows**: Always use soft-delete (`row.deleted_at = utcnow()`).
- ❌ **NEVER bypass permission dependencies**: Every private endpoint must specify `Depends(require_permission(...))`.
- ❌ **NEVER alter database tables manually**: Keep all migrations version-controlled in `backend/alembic/versions/`.
- ❌ **NEVER modify user permissions without invalidating cache**: Always call `cache_manager.invalidate_user_permissions(user_id)`.

---

## 15. Deployment, Environment Variables & Operations

### Backend Environment Variables (`backend/.env`)
```env
# Application Settings
APP_NAME=Enterprise ERP
ENVIRONMENT=production
DEBUG=false
SECRET_KEY=your-super-secret-key-32-chars-minimum
API_V1_PREFIX=/api/v1

# Database Configuration
DATABASE_URL=postgresql+asyncpg://postgres:password@localhost:5432/erp_database

# CORS Allowed Origins
BACKEND_CORS_ORIGINS=["http://localhost:5173","https://erp.yourdomain.com"]

# JWT Configuration
ACCESS_TOKEN_EXPIRE_MINUTES=15
REFRESH_TOKEN_EXPIRE_DAYS=7

# Caching Configuration
REDIS_URL=redis://localhost:6379/0

# AI Quotation Extractor API Keys
OPENAI_API_KEY=your-openai-api-key
GEMINI_API_KEY=your-gemini-api-key

# Inbound Email Worker (IMAP)
IMAP_SERVER=imap.gmail.com
IMAP_PORT=993
IMAP_USERNAME=quotes@yourdomain.com
IMAP_PASSWORD=your-app-password
# Supabase Storage & Cloud Asset Persistence
SUPABASE_PROJECT_ID=mpvzjzunkiqchhhvxrza
SUPABASE_SERVICE_KEY=your-supabase-service-role-secret-key
SUPABASE_ANON_KEY=your-supabase-anon-key
SUPABASE_URL=https://mpvzjzunkiqchhhvxrza.supabase.co
```

### Frontend Environment Variables (`frontend/.env`)
```env
VITE_DEV_PORT=5174
VITE_API_BASE_URL=http://127.0.0.1:8002/api/v1
VITE_CENTRAL_AUTH_API=http://127.0.0.1:8000/api/v1
VITE_CONTROL_PLANE_URL=http://localhost:5170
VITE_CONTROL_PLANE_API_URL=http://127.0.0.1:8000
VITE_YINGLIMA_URL=http://localhost:5173
VITE_YINGLIMA_API_URL=http://127.0.0.1:8001
VITE_INHYMA_URL=http://localhost:5174
VITE_INHYMA_API_URL=http://127.0.0.1:8002
```

### Supabase Storage & Media Asset Persistence Architecture
- **Central Storage Engine (`app.common.storage`)**: All file and media uploads (Product Photos, Supplier Visit Photos/Videos, and Inbound Supplier Quotation Sheets/PDFs) utilize a unified async storage engine.
- **Dedicated Public Buckets**:
  - `product-images`: Multi-photo product catalogs and cover images.
  - `supplier-media`: Factory visit photos, videos, and supplier profile attachments.
  - `quotations`: PDF quote sheets and specification attachments extracted from supplier reply emails.
- **Automatic Bucket Provisioning**: The service role secret key automatically provisions public buckets (`public: true`, 50MB per-file ceiling) upon initial upload.
- **Resilient Fallback**: If Supabase credentials are not supplied or the remote service is temporarily unreachable, files safely persist to the backend's local `uploads/` directory with detailed structured warning logs.
- **Sync & Maintenance Utility (`scripts/sync_uploads_to_supabase.py`)**: One-command synchronization tool that scans local disk directories (`uploads/products`, `uploads/suppliers`, `uploads/quotations`), uploads them to Supabase Storage, and updates all existing PostgreSQL database references with global public URLs.

### Inbound & Outbound Email Architecture (Zero Wasted API Costs)
- **Bidirectional Mailbox Polling**: Poller inspects both `INBOX` and `[Gmail]/Sent Mail` to capture supplier replies and salesperson outbound negotiations sent directly via email clients (e.g. Gmail web, Outlook, mobile).
- **Outbound Multi-Recipient Parsing**: Outbound emails parse all addresses from `To` and `Cc` to guarantee matching against all recipient suppliers.
- **Outbound Company Emails**: Emails sent by Yinglima (`om1inhyma@gmail.com`) are strictly tagged as `direction="outbound"`. They are logged into the `Emails` tab timeline with **0 OpenAI API calls** and never create quotation rows.
- **First Valid Supplier Reply**: The first valid reply from a supplier to our RFQ triggers OpenAI GPT extraction **exactly ONCE**, creating `QT-AUTO-01`, uploading any quote attachment directly to Supabase Storage, and logging the email in the `Emails` tab.
- **Subsequent Follow-ups & Negotiations**: Once `QT-AUTO-01` exists for `(inquiry_item_id, supplier_id)`, all subsequent negotiation emails, price discussions, and delivery conversations bypass AI extraction (**0 OpenAI API calls**) and are appended directly to the `Emails` timeline.
- **Thread-Aware Item Inheritance**: Short follow-up emails without explicit SKU numbers automatically inherit the product item (`inquiry_item_id`) from the active thread history with that supplier.
- **Dynamic Live Polling**: Frontend automatically live-syncs quotes and email messages every 2.5 seconds, ensuring updates reflect instantly without manual browser refresh.
### Universal Search & Deep-Linking Architecture (`GET /search?q=`)
- **Global Search Endpoint (`app.search.service`)**: Searches asynchronously across Organization, Users, Suppliers, Buyers, Products, Product Categories & Sub-Categories, Brands, HSN Codes, Geography Masters (Countries, States, Cities), Currencies & UOM, **Inquiries & Consignments** (`ConsignmentCode`, `InquiryItem`), and **Trash** (soft-deleted records across all models via `MODEL_MAP`).
- **Client-Side Deep-Linking (`UniversalSearch.tsx`)**: Clicking a search result carries the matched record's UUID via query parameter (e.g. `/suppliers?id=8973e972-...`, `/buyers?id=...`, `/masters/products?id=...`, `/users?id=...`, `/inquiries?buyerId=...&inquiryId=...`, `/trash?q=...`).
- **Automatic Drawer & Modal Invocation**: Destination pages (`Suppliers.tsx`, `Buyers.tsx`, `Users.tsx`, `masters/Products.tsx`, `Inquiries.tsx`, `Trash.tsx`, and `MasterPage.tsx` for shared masters) detect parameters on mount or route transition and open corresponding views/drawers automatically.

### Global Paste Auto-Clean Sanitizer (`lib/pasteSanitizer.ts`)
- **System-Wide Clipboard Interceptor**: Listens globally to all paste events on HTML `<input>` and `<textarea>` elements across all forms, tables, search bars, and modals.
- **Artifact Stripping**: Automatically strips leading and trailing spaces, tab characters (`\t`), newlines (`\n`), and non-breaking space characters (`\u00A0`) captured when copying cells from Excel, PDFs, or web tables.
- **Native React State Dispatch**: Seamlessly triggers React's synthetic `onChange` and `input` events so form state updates immediately without manual backspacing. Excludes password and file upload inputs.

### Global Autocomplete & Autofill Suppression System (`lib/autocompleteBlocker.ts`)
- **System-Wide Overlay Defense**: Continuously enforces `autocomplete="off"`, `autocapitalize="off"`, `spellcheck="false"`, `data-lpignore="true"` (LastPass disabler), and `data-form-type="other"` (1Password/Bitwarden heuristic disabler) across all DOM `<form>`, `<input>`, `<textarea>`, and `<select>` elements.
- **Dual-Defense Architecture**:
  - Continuous DOM `MutationObserver` on `document.body` detecting dynamically mounted drawer inputs and popover dialogs.
  - Document-level capture-phase `focusin` event interceptor immediately re-verifying and applying `autocomplete="off"` prior to browser layout engine suggestions popup rendering.
- **Eliminates Browser Bubble Artifacts**: Permanently suppresses floating tooltip popover bubbles (e.g. historical name suggestions) from obscuring critical inputs.

### 12. Frontend Architecture, Zero-Layout-Shift Floating Toasts & Hardening Standards

#### 12.1. Universal "Grey and Locked" Calculation Design Pattern (`.calc-locked`)
To eliminate ambiguity between user-editable inputs and system-calculated or formula-derived values across forms:
- **Design Tokens & Classes ([`style.css`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/styles/style.css)):**
  - **Background:** `#e9ecef` (Light slate grey) in light mode, `#1e293b` in dark mode.
  - **Border:** `1px solid #cbd5e1` (slate-300) in light mode, `#334155` in dark mode.
  - **Font Color:** `#475569` (slate-600) with `font-weight: 600` for high contrast and readability.
  - **Interaction:** `cursor: not-allowed`, `user-select: none`, with non-focusable read-only behavior.
  - **Iconography:** Integrated 🔒 lock icon badge for clear visual signaling.
  - **Standard Classes:** `.calc-locked`, `.calculated-field`, and `.calc-locked-wrapper`.
- **Implemented Modules:**
  - **Local Purchase ([`LocalPurchasePage.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/pages/purchase/LocalPurchasePage.tsx)):** `Total Of All Expenses`, `% Loading Expense (Value Based)`, line-item calculated columns (`Item Total`, `Expense Per Unit`, `Unit Landing Rate (VB)`, `Total Landing Rate (VB)`).
  - **Import Purchase ([`ImportPurchasePage.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/pages/purchase/ImportPurchasePage.tsx)):** `Total Expenses`, `Invoice Total Value (INR)`, `Gross Total Landing (INR)`, `% Loading Expense (VB)`, `Loading Amount per CBM`, line-item landing rates and totals (whereas smart operational defaults such as `Expected Arrival Date = ETA Port Date + 5 days` remain unlocked `#ffffff` `<DatePicker />` fields so operators can freely edit them).
  - **Product Master ([`Products.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/pages/masters/Products.tsx)):** `packaging_unit_cbm` and multi-package total cards (`packageTotals.cbm`, `net`, `gross`).

#### 12.2. Zero-Layout-Shift Floating Toast Architecture & Banner Deprecation
- **Floating Toast Notification System ([`toast.tsx`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/lib/toast.tsx), [`style.css`](file:///c:/Users/Inhyma%20Solutions/OneDrive/Desktop/ERP/Inhyma_ERP/frontend/src/styles/style.css)):**
  - Replaced legacy disruptive in-page static alert banners (`.banner`, `.banner-success`, `.banner-danger`, `.error-banner`) that pushed down form controls, expanded page heights, and created high Cumulative Layout Shift (CLS).
  - Deployed an asynchronous floating toast system (`useToast()`) mounted at the fixed viewport overlay (`top: 20px; right: 20px; z-index: 99999;`).
  - Implemented 4 notification tiers:
    - **Success:** Emerald green (`#059669` / `#10b981`) with `✓` icon and 3.5s auto-dismiss.
    - **Error:** Crimson red (`#dc2626` / `#ef4444`) with `✕` icon and 3.5s auto-dismiss.
    - **Warning:** Amber (`#d97706`) with alert icon.
    - **Info:** Slate blue (`#2563eb`) with info icon.
  - Interactive dismiss button (`×`), auto-dismiss timer pause on mouse hover, and stacked toast queue.
- **Pages Converted:**
  - `Organization.tsx`, `Trash.tsx`, `Profile.tsx`, `SetupPage.tsx` (HRMS), `LeavePage.tsx` (HRMS), `LocalPurchasePage.tsx`, `ImportPurchasePage.tsx`, `TechnicianOperationsPage.tsx`, `PriceListPage.tsx`.
- **Accessible Graceful Degradation Pattern:**
  - Styled legacy `.banner`, `.error-banner`, and `.success-banner` in `visually-hidden` mode (`position: absolute; clip: rect(0, 0, 0, 0);`) so screen readers, assistive technology, and unit tests continue to detect alerts without visual layout shifts.

#### 12.3. Universal "No Data" Empty State Standardization
- All tables across the enterprise ERP display the standardized label `"No Data"` when empty, eliminating fragmented messages.

#### 12.4. Unified Table Skeleton Loaders
- Standardized skeleton row placeholders maintaining fixed column geometry during active loading states to prevent jarring layout jumps.

#### 12.5. Universal Page Header & Spacing Standardization
- **Global Page Geometry (`.page` & `.page-header`):**
  - Standardized `.page { padding: 12px 20px; }` across all pages, aligning topbar spacing and providing an edge-to-edge 20px grid alignment for all main card tables and data containers.
  - Standardized `.page-header { margin-bottom: 16px; }` across all views, including all 30+ master modules via `MasterPage.tsx`, `StockTransferPage.tsx`, and `StockAdjustmentPage.tsx`.
  - Conditioned alert and feedback containers across pages (`TechnicalTasksPage.tsx`, `PaymentsPage.tsx`, `TechnicianOperationsPage.tsx`) to ensure empty feedback banner wrappers do not render phantom blank spaces or vertical layout gaps below page headers.

#### 12.6. Universal Header Action Buttons Standard (`.page-header-actions`)
- **Pixel-Matched Button Architecture:**
  - Standardized CSS rules for all action buttons located inside `.page-header-actions` (`height: 35px !important; min-height: 35px !important; max-height: 35px !important; box-sizing: border-box !important; border-radius: 6px !important; font-size: 13px !important; font-weight: 600 !important; gap: 10px !important; line-height: 1 !important; display: inline-flex !important; align-items: center !important; justify-content: center !important;`).
  - Unifies `.btn-filter-toggle`, `.btn-add-new`, `.btn-quick-add`, `.btn-imp-exp`, `.btn-bulk-actions`, `.stock-btn-export`, etc.
  - **Popover Isolation:** Protected popover dropdown menu items (`.page-header-actions div[style*="absolute"] button`, `.dropdown-menu button`, `[role="menu"] button`) with `height: auto !important; min-height: unset; justify-content: flex-start !important;` to ensure internal dropdown menu options remain normal.

#### 12.7. Filter Placement Hierarchy: Positioned Above KPI Summary Cards
- Standardized the visual and DOM hierarchy across all ERP list views so collapsible and in-page filter panels appear **directly above** the top KPI metric summary cards:
  - **Payments (`PaymentsPage.tsx`):** Filter toggle panel sits above the 3 KPI metric summary cards (`TOTAL PAYMENT`, `PAID`, `DUE`).
  - **Sale Process (`SaleProcessList.tsx`):** Collapsible filter panel sits above the 6 Top KPI Summary Cards.
  - **Price List Management (`PriceListPage.tsx`):** Collapsible filter panel sits above the 4 Top KPI Metrics Cards.
  - **Import Purchase (`ImportPurchasePage.tsx`):** Collapsible filter panel sits above the dynamic workflow KPI cards and status tabs.
  - **Product Stock (`ProductStockPage.tsx`):** Machine Lookup Search & Warehouse Filters sit above the KPI summary strip in the Goods Expected Date Report view.
  - **Discount Payments (`DiscountPaymentsPage.tsx`):** Collapsible filter panel sits above the 3 Top KPI Cards.
  - **Technical Tasks (`TechnicalTasksPage.tsx`):** Filter panel sits directly under the header before data tabs and table card.

#### 12.8. Streamlined Minimalist Header Cleanups
- Removed redundant subtitle description paragraphs below page headings to maintain a clean, compact header layout matching production ERP aesthetics:
  - **Trash (`Trash.tsx`):** Removed redundant description text and placed **Empty Trash** button inside `.page-header-actions`.
  - **Audit Log (`Audit.tsx`):** Removed redundant description text, keeping clean **Audit Log** header.

#### 12.9. Sub-Toolbar Search Consolidation & Table Empty State Cleanup
- **Unified Sub-Toolbar Search (`TechnicalTasksPage.tsx`):**
  - Merged the separate serial number search input and generic search input into a single, clean search box (`placeholder="Search..."`).
  - Automatically queries across all backend searchable fields (serial number, customer/company, machine model, contact person, phone, task description) without requiring manual mode switches.
  - Retained 1-click serial number table badge deep-filtering (`task-row-serial-number`), instantly populating the unified search input and filtering records.
- **Empty State Button Deduplication:**
  - Removed redundant `+ Add New Task` action buttons from within the empty state table body, avoiding duplication with the primary `+ ADD NEW` button located in `.page-header-actions` at the top right.

### HRMS Enhancements: All-Employee Attendance Calendar & Payroll Excel Export Architecture

#### 1. All-Employee Attendance Calendar (`GET /api/v1/hrms/attendance/all-calendar`)
- **Multi-Employee Attendance Matrix**: Aggregates month-long attendance records across authorized personnel into a single matrix.
  - Days 1 through total days in month aligned to day of week.
  - Daily status resolution: `PRESENT`, `LATE`, `HALF_DAY`, `ON_LEAVE`, `HOLIDAY`, `WEEKEND`, `ABSENT`, `IN_PROGRESS`.
  - Non-destructive missing punch handling: missing days are not assumed absent unless explicitly evaluated by company HR policy rules.
- **Granular Role-Based Access Control (RBAC)**:
  - `Admin` & `HR`: Full organizational access across all branches, departments, and employees.
  - `Department Managers`: Scoped to direct department reports and supervised personnel (`managed_employee_ids`).
  - `Standard Employees`: Backend enforces strict self-only scope; attempting to query other employees or company-wide returns 403 Forbidden.
- **Filtering & Navigation**:
  - Month and year navigation (`year`, `month` parameters).
  - Dynamic filter dropdowns for Department, Branch, and Employee text search.
- **Attendance Day Details Modal**:
  - Displays punch in/out timestamps (IST), working hours/minutes, shift timings, geofencing verification, approved leave reason, holiday titles, regularization notes, and Loss of Pay (LOP) impact.
  - Direct deep-link button enabling Admin/Manager to open an individual employee's detailed calendar.

#### 2. Authoritative Payroll Excel Export Engine (`GET /api/v1/hrms/payroll/export`)
- **Non-Destructive Export Architecture**: Exports actual pre-calculated, verified monthly payroll records from `hrms_monthly_payrolls` and `hrms_monthly_payroll_items`. Downloading the report never modifies or recalculates locked or draft payroll.
- **Dynamic Salary Component Representation**:
  - Dynamically builds columns for all configured earning components (e.g. Basic, HRA, Special Allowance) and deduction components (e.g. PF, ESI, Professional Tax).
  - Avoids hardcoded salary structures; respects organizational rules defined in `hrms_payroll_components`.
- **Export Formats & Controls**:
  - Company-wide export: `Payroll_Export_All_Employees_YYYY_MM.xlsx` (includes summary totals row, auto-fitted columns, bold header styling, and currency formatting).
  - Single employee export: `Payroll_Export_{Employee_Code}_{Name}_YYYY_MM.xlsx`.
  - Empty month safeguard: Returns clean `404 Not Found` with explanatory error if payroll has not been generated for the target period.

#### 3. HRMS Integrity Remediation, Separation-of-Duties & Payroll Approval Persistence (`backend/app/hrms/*`, `frontend/src/pages/hrms/*`)
- **Strict Separation-of-Duties & Self-Action Guards:**
  - **Assets (`asset_routes.py`):** `GET /api/v1/hrms/assets/summary`, `PATCH`/`PUT /api/v1/hrms/assets/{id}`, and `PATCH /api/v1/hrms/assets/{id}/status` strictly require Admin or HR privileges (`403 Forbidden` for non-Admin/HR callers).
  - **Attendance Direct Regularization (`attendance_routes.py`):** `POST /api/v1/hrms/attendance/regularizations` with `direct_regularize=True` is restricted to Administrators (`403 Forbidden` otherwise) and blocks self-regularization (`target_id == ctx.user_id` -> `400 Bad Request`).
  - **Expense Reimbursement (`expense_routes.py`):** `POST /api/v1/hrms/expenses/{id}/reimburse` strictly forbids self-reimbursement (`exp.employee_id == ctx.user_id` -> `403 Forbidden`).
  - **Payroll Self-Modification Blocks (`payroll_routes.py`):** `PATCH /api/v1/hrms/payroll/items/{item_id}` and `POST /api/v1/hrms/payroll/adjustments` reject self-edits and self-adjustments (`400 Bad Request`) so another authorized administrator must adjust an operator's own payroll.
- **Payroll Approval Persistence, Deduplication & Manager Scoping:**
  - `POST /api/v1/hrms/payroll/{month}/approve` returns the full `_serialize_payroll` payload with employee-level row deduplication and propagates `status = "APPROVED"` across all serialized line items whenever the parent payroll is `APPROVED`.
  - Department managers querying `GET /api/v1/hrms/payroll/payslips?employee_id=ALL` receive `APPROVED` payslips scoped strictly to `ctx.managed_employee_ids`.
- **Payroll Privacy & Approval Safeguards**:
  - Unapproved or draft payroll is restricted from standard employees.
  - Employees can only download their own approved payslip data.
  - Salary data and CTC structures are hidden from unauthorized roles.

---

## 16. Central Ecosystem Federation, DB-Backed Inbound Email Deduplication & Bootstrap Seed Guards

### 16.1. Resilient Central Federation & Spoke Survival Mechanics
In a distributed multi-ERP enterprise mesh where `ERP_Main` serves as the central control plane, spoke ERP instances (`Inhyma_ERP`, `Yinglima_ERP`) communicate with central for single sign-on (SSO), federation, and tenant verification.

1. **Multi-URL Base Discovery (`erp_main_api_base_urls()` in `app/core/config.py`):**
   - In production cloud platforms (such as Render.com), services are often addressed via custom domains or direct `onrender.com` internal domains.
   - The spoke resolves candidates across `ERP_MAIN_API_BASE_URL`, `ERP_MAIN_URL`, and fallback default URLs. Each candidate is tested sequentially during outbound calls.
2. **Explicit IPv4 Outbound Binding (`0.0.0.0`):**
   - Cloud containers frequently fail during inter-service HTTPS connections if HTTP client libraries attempt to connect via unrouted IPv6 addresses.
   - All `httpx.AsyncClient` federation instances explicitly set `local_address="0.0.0.0"`, guaranteeing IPv4 socket routing across the public internet.
3. **40-Second Cold-Start Sleeping Budget:**
   - Free/Starter cloud tiers spin down during inactivity. Standard 5s or 10s HTTP timeouts prematurely kill user SSO requests before the sleeping upstream container boots.
   - Outbound federation requests allocate a 40.0-second total timeout budget (`httpx.Timeout(40.0, connect=20.0)`), allowing sleeping instances to cold-boot cleanly.
4. **900-Second Stale Session Fallback Tolerance (`_from_cache`):**
   - If central is undergoing scheduled maintenance or experiencing temporary network partitions, spoke backends retain active verified sessions in local memory cache for up to 900 seconds (15 minutes).
   - The user session is authenticated with `session["_from_cache"] = True`, preventing enterprise operational lockouts during transient central network blips.
5. **Federation Health Diagnostic Endpoint (`GET /api/v1/health/federation`):**
   - Provides live health and latency metrics against central endpoints without requiring a full SSO login attempt.
   - Returns reachable candidate URL, latency in milliseconds, status code, and detailed fallback diagnosis.

### 16.2. Platform-Gated Winsock DNS Resilience
On Windows workstations and local developer environments, asynchronous DNS lookups in `asyncio` and `httpx` can trigger Winsock socket leaks (`WSAEADDRINUSE`) or silent lockups.
- **Platform Gating (`sys.platform.startswith("win")`):**
  - Winsock DNS caching is strictly restricted to Windows developer hosts.
  - Production Linux containers run completely unaffected, allowing kernel glibc resolver handling.
- **Port-Sensitive 5-Tuple DNS Cache:**
  - Cache entries are keyed by `(host, port, family, type, proto)`.
  - Automatically preserves specific port destinations, preventing cross-port collisions when testing multiple local dev instances on `localhost:8000`, `8001`, and `8002`.

### 16.3. Persistent Database Inbound Email Deduplication
To completely eliminate duplicate AI quotation extraction and redundant supplier emails across worker restarts:
- **Relational Deduplication Table (`email_inbound_processed`):**
  - Tracks every ingested email by unique compound constraints: `message_id`, `uid`, `inquiry_id`, `supplier_id`, and `processed_at`.
  - Before invoking OpenAI or processing mail body attachments, worker checks `SELECT 1 FROM email_inbound_processed WHERE message_id = :mid`.
- **Atomic Insertion Under Concurrency:**
  - Ingestion commits a deduplication record in the same database transaction, preventing concurrent poller runs from double-billing AI extraction APIs.
- **30-Minute Historical Baseline:**
  - Inbound worker establishes a historical cutoff timestamp (`utcnow() - timedelta(minutes=30)`).
  - Historical emails older than 30 minutes are stamped into the deduplication ledger without triggering repetitive quotes, ensuring newly started workers process only fresh inbound communications.

### 16.4. Idempotent Deployment & First-Install Seed Protection
Production database seeds (`backend/scripts/seed.py`) run during automated container build and start phases (e.g. `render.yaml`).
- **First-Install Guard (`BOOTSTRAP_FORCE_RESET`):**
  - If existing organization, user, or role records are detected in the database, `seed.py` immediately skips mutating live production accounts.
  - Destructive re-seeding is strictly prohibited unless `BOOTSTRAP_FORCE_RESET=true` is explicitly injected into environment variables.
- **Geography & Master Data Protection:**
  - Countries, States, Districts, and Cities are verified for existing records before running bulk insert scripts.
  - Prevents primary key collisions and protects user-customized city and district additions.
- **Registry Host Safety (`seed_registry.py`):**
  - When running in `ERP_Main`, `seed_registry.py` updates spoke registration URLs only if explicit environment variables (`INHYMA_ERP_URL`, `YINGLIMA_ERP_URL`) are populated.
  - Prevents local developer runs from overwriting production cloud URLs in the central registry with `http://localhost`.

### 16.5. SSO Handover Local Account Guards
During federated single sign-on (`POST /api/v1/auth/sso-handover`):
- **Disabled/Deleted Account Enforcement:**
  - If a user exists in the spoke ERP but has `is_active=False` or `deleted_at IS NOT NULL`, the endpoint rejects handover with `401 Unauthorized` ("Account is inactive or disabled on this ERP instance").
  - Prevents deactivated or terminated employees from regaining access to spoke instances via central SSO credentials.
- **Controlled Auto-Provisioning (`SSO_HANDOVER_AUTO_PROVISION`):**
  - If a user does not exist locally and `SSO_HANDOVER_AUTO_PROVISION=false` (default in strict environments), access is cleanly rejected with `403 Forbidden` until an administrator creates the local role assignment.

### 16.6. Database-Backed Organization Branding & Storage Quota Protection
Enterprise logos and branding assets are stored directly in PostgreSQL with public streaming:
- **Endpoint `GET /api/v1/organizations/logo?v={sha1}`:**
  - Streams high-resolution PNG/JPEG binary data with long-term `Cache-Control: public, max-age=86400, immutable`.
  - The query parameter `v` contains a SHA-1 hash of the image content, forcing immediate browser cache refresh upon logo replacement.
- **Client Storage Quota Protections (`try/catch` in `brand.ts` and `Organization.tsx`):**
  - Storing massive Base64 strings in browser `localStorage` causes `QuotaExceededError` crashes on mobile or restricted webview browsers.
  - All brand caching operations are wrapped in graceful quota guards that safely degrade to in-memory state or remote streaming without throwing unhandled exceptions.

### 16.7. Environment-Isolated Cross-ERP URL Resolution & Zero-Hardcoded-Port Architecture
To guarantee that local development (`localhost` / LAN) and cloud deployments (`Render.com`) can safely operate even when sharing a common central PostgreSQL database without cross-redirecting users between environments:
- **Zero Hardcoded Host/Port Links:**
  - Removed all hardcoded `localhost`, `127.0.0.1`, and port (`5170`, `5173`, `5174`, `8000`, `8001`, `8002`) fallbacks across `vite.config.ts`, `src/lib/ssoBridge.ts`, `src/lib/ecosystemSession.ts`, `src/components/EcosystemSwitcher.tsx`, `app/core/config.py`, `app/inquiries/routes.py`, and `ERP_Main` (`landing.py`, `http_adapter.py`, `federation/routes.py`, `federation/security.py`, `AppShell.tsx`).
- **Environment-First Peer Discovery (`.env` Locally, Platform Env in Cloud):**
  - **Central Control Plane (`ERP_Main`):** `landing.py` resolves peer dashboard destinations from `<KEY>_FRONTEND_URL` (`YINGLIMA_FRONTEND_URL`, `INHYMA_FRONTEND_URL`) and `FRONTEND_URL` (with `CORS_ALLOWED_ORIGINS` single-origin deduction when `FRONTEND_URL` is omitted on Render) before consulting `erp_instances.base_url`. `http_adapter.py` resolves spoke backend URLs from `<KEY>_API_URL` (`YINGLIMA_API_URL`, `INHYMA_API_URL`) first.
  - **Spoke & Control-Plane Frontends:** `ssoBridge.ts`, `ecosystemSession.ts`, and `EcosystemSwitcher.tsx` read `VITE_CONTROL_PLANE_URL`, `VITE_CONTROL_PLANE_API_URL`, `VITE_CENTRAL_AUTH_API`, `VITE_YINGLIMA_URL`, `VITE_YINGLIMA_API_URL`, `VITE_INHYMA_URL`, and `VITE_INHYMA_API_URL` from `.env` / `.env.defaults` locally and from Render environment variables in production.
- **Strict Environment Class Isolation (`LOCAL` vs `PRODUCTION`):**
  - Backend `_matches_current_environment(url)` (`ERP_Main/backend/app/global_auth/landing.py`, `http_adapter.py`) rejects public hosted domains (`*.onrender.com`) when `ENVIRONMENT=local` and rejects loopback/RFC-1918 LAN addresses when `ENVIRONMENT=production`.
  - Frontend `sanitizeEnvMatchedUrl(raw)` (`ssoBridge.ts`, `EcosystemSwitcher.tsx`, `ecosystemSession.ts`, `AppShell.tsx`) enforces browser-origin parity across `routeForCentralSession()`, `enforceCentralLanding()`, `erpUrlFor()`, `controlPlaneUrl()`, and `planSwitch()`—preventing a `localhost` session (such as a single-ERP user visiting another local port) from ever jumping to a hosted Render URL, while automatically adapting loopback hostnames (`localhost`) to the browser's LAN IP when accessed over Wi-Fi/LAN.

### 16.8. Pytest Live-Database Isolation & Synthetic QA Persona Prevention
To guarantee that automated developer or IDE test runs can never pollute `Inhyma_ERP`'s live PostgreSQL / Supabase database with synthetic `@example.com` accounts (`rec_mgr_*`, `rec_user_*`, `feed_user_*`, etc.):
- **Strict Test Isolation (`backend/tests/conftest.py`):**
  - Removed `load_dotenv(..., override=True)` from `conftest.py`.
  - Before `app.core.config.settings` initializes, if `ALLOW_LIVE_DB_TESTS != "1"` and `DATABASE_URL` is either unset (which would otherwise read `.env`) or references `supabase.com` / `supabase.co`, `conftest.py` overrides `DATABASE_URL="sqlite+aiosqlite:///:memory:"`, `DIRECT_URL=""`, and `ENVIRONMENT="test"`.
  - Ephemeral non-Supabase PostgreSQL service containers (such as GitHub Actions CI `localhost:5432/erp_db`) continue to execute transparently when explicitly supplied via `DATABASE_URL`.
- **SQLite Engine & Startup Compatibility (`config.py`, `engine.py`, `main.py`):**
  - `Settings.DATABASE_URL` accepts `PostgresDsn | str` for non-production test environments while `validate_production_secrets()` strictly blocks SQLite when `ENVIRONMENT=production`.
  - `get_engine()` uses SQLAlchemy `StaticPool` for `sqlite+aiosqlite://` URLs, and `_run_startup_schema()` executes `Base.metadata.create_all` instead of PostgreSQL-specific `information_schema` DDLs when `engine.dialect.name == "sqlite"`.
- **Zero Synthetic QA Provisioners in Repository:**
  - All standalone fake-persona provisioning scripts (`provision_tasks_qa_personas.py`, `provision_hrms_qa_matrix.py`, `provision_feed_test_accounts.py`, `prepare_minimal_crm_qa_data.py`, `seed_crm_qa_demo_data.py`, `cleanup_local_crm_qa_data.py`) and non-isolated live-DB user/department-creating pytest files have been permanently removed from `backend/scripts/` and `backend/tests/`.
- **HRMS `ensure_seeds()` Soft-Delete Respect (`app/hrms/service.py`, `app/hrms/leave_service.py`):**
  - Default seeding checks for `HrmsLocation`, `HrmsLeaveType`, `HrmsExpenseCategory`, `HrmsHoliday`, and `HrmsLeavePlan` inspect total table existence (without `.where(deleted_at.is_(None))`), ensuring that once initial defaults have been seeded, soft-deleting a default record from HRMS Setup never triggers automatic re-creation on page reload.
- **Canonical 297-Permission Bootstrap Sync (`backend/scripts/seed.py`):**
  - Consolidated granular HRMS module permissions (`hrms.attendance`, `hrms.leave`, `hrms.assets`, `hrms.expenses`, `hrms.site_visits`, `hrms.payroll`, `hrms.payroll.configure`, `hrms.payroll.approve`, `hrms.setup`) and master permissions (`bank.*`, `billingcompany.*`, `technician.*`) directly into `BOOTSTRAP_PERMISSIONS` so `super_admin` (`Admin`) receives 100% (`297/297`) permission coverage while seeding strictly the two canonical system roles (`super_admin` and `user`).

### 16.9. System-Wide Active-Only Cross-Module Extraction & Historical Reference Preservation
Across `Inhyma_ERP`, every record carrying an `Active` / `Inactive` lifecycle (`status = RecordStatus.ACTIVE / INACTIVE`, `UserStatus.ACTIVE / INACTIVE`, or `is_active = True / False`) obeys a strict two-boundary contract:
- **Boundary 1 — Own Master / Directory Management Screens Preserve Both Tabs:**
  - Unfiltered management endpoints (`GET /api/v1/masters/*`, `/companies`, `/suppliers`, `/buyers`, `/users`, `/positions`, `/hrms/setup/*` with default `active_only=False`, CRM `PipelineSetupPage` & `SalespersonDistributionPage`, HRMS `PayrollPage`) continue returning **both** `Active` and `Inactive` records so `Active (N)` and `Inactive (M)` tabs and re-activation toggles remain 100% functional.
- **Boundary 2 — Cross-Module Extractions Strictly Return `Active` Records Only:**
  - **Bidirectional Dynamic Filter Translation (`app/common/base_repository.py`):** `_apply_dynamic_filters` inspects real SQLAlchemy table columns (`self.model.__table__.columns`, avoiding Python `@property` descriptors such as `Product.is_active`) and bidirectionally translates `?status=active|inactive` and `?is_active=true|false` across both `RecordStatus` tables (`products`, `banks`, `warehouses`, all 28 masters) and boolean `is_active` tables (`companies`, `suppliers`, `buyers`).
  - **Master `/lookup` & `/dropdown` Services:** All 28 `app/masters/*/service.py` `list_all_cached()` and `list_all_dropdown()` implementations, `CityRepository`, `DistrictRepository`, and `ProductService.get_machine_spares_universal_view()` filter strictly to `RecordStatus.ACTIVE`. Frontend `useLookup` (`includeInactive = false` default), `useSearchableLookup` (`src/lib/lookups.ts`), and `productSearchCache.ts` (`prefetchMasterProducts` / `fetchMasterProducts`) apply both `?status=active` query parameters and client-side `isRecordActive` filtering.
  - **Inventory, Price List & Product Gallery:** `GET /api/v1/inventory/product-stock`, `GET /api/v1/inventory/product-reorder`, `PriceListRepository` (`list_price_items` & `get_metrics`), and `ProductGallery.tsx` restrict catalog projections to `Product.status == RecordStatus.ACTIVE` (and active suppliers in Gallery/Price List).
  - **Non-Destructive Shipment Planning Source Filtering (`app/planning/repository.py`, `app/planning/service.py`, `Planning.tsx`):** Linked-module rows (`item_source_module`), `LINKED_LOOKUP` cells, `AGGREGATE` computations, `auto_populate_item_column`, and source-record autocomplete searches dynamically exclude inactive records **without** deleting underlying `PlanningRow` or `PlanningCell` rows—if an inactive product is later re-activated, its planning row and all saved cell values reappear intact.
  - **Commercial, CRM, Inquiry, Directory, HRMS & Universal Search Consumers:** Active-only filters and backend validation guards are enforced across `/companies/lookup`, `/companies/sales-persons`, `/users/all?active_only=true`, `/positions/all?active_only=true`, `/inquiries/consignment-codes`, `/inquiries/companies`, `/search` (`search_universal`), `/hrms/setup/{locations,leave-types,expense-categories,holidays,leave-plans}?active_only=true`, Proforma & Sales Order forms and PDF bank footers, Local & Import Purchase forms and CSV/Excel importers, CRM Lead creation/reassignment/import & Quotation product search, Technical Tasks, HRMS Leave/Asset/Expense/Site-Visit pickers, and Users/RBAC Reporting Manager & Department member/manager pickers.
  - **Historical Single-Record & Stock Reversal Safety:** Single-record reads (`GET /.../{id}`), printed Purchase/Sales PDF party resolvers, edit-form `item.id === currentSelectedId` retention, and `StockService.find_product(..., require_active=False)` / `get_warehouse(..., require_active=False)` during order cancellation (`_release_stock`) remain unrestricted so historical transactions never 404 or fail to reverse stock when a SKU or warehouse is deactivated later.

---
*Maintained and verified for Inhyma Solutions Enterprise ERP. Last updated: October 30, 2026 (Import Purchase Expected Arrival Date Editable Default [ETA Port Date + 5 Days], System-Wide Active-Only Cross-Module Extraction & Historical Reference Preservation, Pytest Live-Database Isolation & Removal of Synthetic-User QA Scripts, Environment-Isolated Cross-ERP URL Resolution & Zero-Hardcoded-Port Architecture, Local & Import Purchase Bulk CSV/Excel Import Engine, Standardized Golden-Amber Export & Vector SVG Imp/Exp Controls, Suppliers Sidebar Active Highlight & Goods Expected Report Removal, HRMS Integrity Remediation & Payroll Approval Persistence, Product Stock Transactions Master List & Per-Product Ledger, Product Re-Order Branch-Scoped Matrix & FIFO Stock Breakup, Sale Status Update & Timeline Drawers, and Discount Payments Multi-Installment Ledger).*

