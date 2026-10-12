"""
Unit and Integration Tests for Technical Tasks Module.
"""

from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.auth.dependencies import get_current_user
from app.auth.service import CurrentUser
from app.database.base import Base
from app.database.session import get_db_session
from app.main import create_application
from app.technical_tasks.models import TechnicalTask
from app.technical_tasks.schemas import TechnicalTaskCreate, TechnicalTaskStatusUpdate, TechnicalTaskUpdate
from app.technical_tasks.service import TechnicalTaskService
from app.technical_tasks.repository import TechnicalTaskRepository

pytestmark = pytest.mark.asyncio


@pytest.fixture
async def test_db():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    session_factory = async_sessionmaker(bind=engine, class_=AsyncSession, expire_on_commit=False)
    async with session_factory() as session:
        yield session

    await engine.dispose()


@pytest.fixture
async def test_client(test_db: AsyncSession):
    app = create_application()

    async def _override_db():
        yield test_db

    user = CurrentUser(
        id=uuid.uuid4(),
        username="admin",
        permissions={"*"},
    )

    app.dependency_overrides[get_db_session] = _override_db
    app.dependency_overrides[get_current_user] = lambda: user

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as ac:
        yield ac


async def test_technical_task_crud(test_db: AsyncSession, test_client: AsyncClient):
    # 1. Create
    create_payload = {
        "company_name": "Test Packaging Corp",
        "task_type": "In-House",
        "city": "Mumbai",
        "machine_model": "XM12.7 Handy Printer",
        "task_description": "Initial printer test and nozzle alignment",
        "contact_person_name": "Rajesh Kumar",
        "contact_phone": "9876543210",
        "service_type": "Free",
        "call_type": "Demo",
        "priority": "A",
        "status": "Pending",
    }
    resp = await test_client.post("/api/v1/technical-tasks", json=create_payload)
    assert resp.status_code == 201
    data = resp.json()["data"]
    assert data["company_name"] == "Test Packaging Corp"
    task_id = data["id"]

    # 2. List & Counts
    list_resp = await test_client.get("/api/v1/technical-tasks")
    assert list_resp.status_code == 200
    assert list_resp.json()["meta"]["total"] >= 1

    counts_resp = await test_client.get("/api/v1/technical-tasks/counts")
    assert counts_resp.status_code == 200
    counts = counts_resp.json()["data"]
    assert counts["all"] >= 1
    assert counts["pending"] >= 1

    # Check tab & status filtering for pending
    pending_tab_resp = await test_client.get("/api/v1/technical-tasks?tab=pending")
    assert pending_tab_resp.status_code == 200
    assert all(t["status"].lower() == "pending" for t in pending_tab_resp.json()["data"])
    assert pending_tab_resp.json()["meta"]["total"] >= 1

    pending_status_resp = await test_client.get("/api/v1/technical-tasks?status=Pending")
    assert pending_status_resp.status_code == 200
    assert all(t["status"].lower() == "pending" for t in pending_status_resp.json()["data"])

    # 3. Status update to Approved
    status_resp = await test_client.patch(
        f"/api/v1/technical-tasks/{task_id}/status",
        json={"status": "Approved", "task_allotted_to": "Mangal Pandey"},
    )
    assert status_resp.status_code == 200
    updated_data = status_resp.json()["data"]
    assert updated_data["status"] == "Approved"
    assert updated_data["task_allotted_to"] == "Mangal Pandey"
    assert updated_data["task_approved_by"] is not None

    # Check tab & status filtering for approved
    app_tab_resp = await test_client.get("/api/v1/technical-tasks?tab=approved")
    assert app_tab_resp.status_code == 200
    assert all(t["status"].lower() == "approved" for t in app_tab_resp.json()["data"])
    assert app_tab_resp.json()["meta"]["total"] >= 1

    # 4. Status update to Completed
    complete_resp = await test_client.patch(
        f"/api/v1/technical-tasks/{task_id}/status",
        json={"status": "Completed"},
    )
    assert complete_resp.status_code == 200
    completed_data = complete_resp.json()["data"]
    assert completed_data["status"] == "Completed"
    assert completed_data["completed_date"] is not None

    # 5. Bulk Delete
    del_resp = await test_client.post(
        "/api/v1/technical-tasks/bulk-delete",
        json={"ids": [task_id]},
    )
    assert del_resp.status_code == 200
    assert del_resp.json()["deleted_count"] == 1


async def test_serial_number_integration_and_lookup(test_db: AsyncSession, test_client: AsyncClient):
    create_payload = {
        "company_name": "Precision Automation",
        "task_type": "Onsite Visit",
        "city": "Pune",
        "machine_model": "DX-500 Band Sealer",
        "serial_number": "SN-2026-DX-9901",
        "task_description": "Heating element failure",
        "contact_person_name": "Anil Deshmukh",
        "contact_phone": "9812345678",
        "service_type": "Free",
        "call_type": "Breakdown",
        "priority": "A",
        "status": "Pending",
    }
    resp = await test_client.post("/api/v1/technical-tasks", json=create_payload)
    assert resp.status_code == 201
    task_id = resp.json()["data"]["id"]
    assert resp.json()["data"]["serial_number"] == "SN-2026-DX-9901"

    # Search past tasks by serial number
    filter_resp = await test_client.get("/api/v1/technical-tasks?serial_number=SN-2026-DX-9901")
    assert filter_resp.status_code == 200
    items = filter_resp.json()["data"]
    assert len(items) == 1
    assert items[0]["serial_number"] == "SN-2026-DX-9901"

    # Lookup by serial number endpoint
    lookup_resp = await test_client.get("/api/v1/technical-tasks/serial-lookup/SN-2026-DX-9901")
    assert lookup_resp.status_code == 200
    data = lookup_resp.json()["data"]
    assert data["serial_number"] == "SN-2026-DX-9901"
    assert data["machine_model"] == "DX-500 Band Sealer"
    assert data["company_name"] == "Precision Automation"
    assert data["past_tasks_count"] == 1


async def test_cancellation_mandatory_remarks_and_reopen_workflow(test_db: AsyncSession, test_client: AsyncClient):
    # 1. Create task
    create_payload = {
        "company_name": "Alpha Pharma Ltd",
        "task_type": "In-House",
        "city": "Vadodara",
        "machine_model": "Auger Filler AF-100",
        "serial_number": "SN-AF-4001",
        "task_description": "Load cell calibration",
        "service_type": "Chargeable",
        "call_type": "Maintenance",
        "priority": "B",
        "status": "Pending",
    }
    resp = await test_client.post("/api/v1/technical-tasks", json=create_payload)
    assert resp.status_code == 201
    task_id = resp.json()["data"]["id"]

    # 2. Try to cancel WITHOUT remarks -> strictly blocked (422 from Pydantic validator or 400 from service)
    bad_cancel_resp = await test_client.patch(
        f"/api/v1/technical-tasks/{task_id}/status",
        json={"status": "Cancel", "remarks": "", "cancel_remarks": ""},
    )
    assert bad_cancel_resp.status_code in (400, 422)

    # 3. Cancel with mandatory remarks -> succeeds
    cancel_resp = await test_client.patch(
        f"/api/v1/technical-tasks/{task_id}/status",
        json={"status": "Cancel", "cancel_remarks": "Customer postponed production shut-down to next quarter."},
    )
    assert cancel_resp.status_code == 200
    task_data = cancel_resp.json()["data"]
    assert task_data["status"] == "Cancel"
    assert task_data["cancel_remarks"] == "Customer postponed production shut-down to next quarter."

    # 4. Reopen and reassign cancelled task to a new technician
    reopen_resp = await test_client.post(
        f"/api/v1/technical-tasks/{task_id}/reopen",
        json={
            "status": "Approved",
            "task_allotted_to": "Vikas Shinde",
            "remarks": "Reopened as customer requested urgent service visit next Monday.",
        },
    )
    assert reopen_resp.status_code == 200
    reopened_data = reopen_resp.json()["data"]
    assert reopened_data["status"] == "Approved"
    assert reopened_data["task_allotted_to"] == "Vikas Shinde"
    assert reopened_data["cancel_remarks"] is None
