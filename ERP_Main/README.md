# ERP_Main — Multi-ERP Global Control Plane

Global control plane and identity federation hub for the Inhyma Multi-ERP Platform ecosystem.

---

## 1. Overview & Architecture

`ERP_Main` serves as the central orchestration and management platform connecting independent spoke ERPs (such as **Yinglima ERP** and **Inhyma ERP**).

### Core Responsibilities
- **ERP Registry (`app/erp_registry`)**: Catalog of registered ERP instances, operating statuses (`ACTIVE`, `INACTIVE`, `DECOMMISSIONED`), supported module manifests, and connection metadata.
- **Platform Authentication (`app/platform_auth`)**: Authentication and access management for platform administrators (human control-plane operators).
- **Global Identity & Memberships (`app/global_users`, `app/erp_memberships`)**: Cross-ERP global user directory linking human identities across multiple regional ERP deployments with zero local credential centralization.
- **Service Identity (`app/service_identity`)**: Machine-to-machine authentication, service credential issuance/rotation, and heartbeat monitoring for registered ERP spokes.
- **Global Audit Trail (`app/global_audit`)**: Unified audit log tracking cross-platform control-plane operations.

---

## 2. Technology Stack

- **Backend Framework**: FastAPI (Python 3.11 / 3.12)
- **ORM & Database**: SQLAlchemy 2.0 (Async) with SQLite (`sqlite+aiosqlite`) for local development, PostgreSQL ready for production
- **Migrations**: Alembic
- **Validation**: Pydantic v2 & Pydantic Settings
- **Testing**: Pytest with `pytest-asyncio` (59 tests, 100% passing)

---

## 3. Quickstart & Local Development

### 1. Prerequisites
- Python 3.11+
- Virtual environment tool (`venv`)

### 2. Setup
```bash
cd backend
python -m venv venv
venv\Scripts\activate      # Windows
source venv/bin/activate    # Linux/macOS

pip install -r requirements.txt
```

### 3. Environment Configuration
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```

Default local development settings:
- **Host**: `0.0.0.0`
- **Port**: `8000`
- **API URL**: `http://localhost:8000`
- **API Documentation**: `http://localhost:8000/docs`

### 4. Database Migrations & Seeding
```bash
# Run migrations
python -m alembic upgrade head

# Seed initial ERP registry
python -m scripts.seed_registry
```

### 5. Running the Server
```bash
python server.py
```

### 6. Running Tests
```bash
python -m pytest tests
```
