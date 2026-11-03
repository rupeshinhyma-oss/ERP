"""
Unit and Integration Tests for Technical Tasks Module.
"""

from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.auth.dependencies import get_current_user
from app.auth.service import CurrentUser
from app.database.base import Base
from app.database.session import get_db_session
from app.main import create_application
from app.technical_tasks.models import TechnicalTask, TechnicalTaskCallLog, TechnicalTaskLog
from app.technician_operations.models import MachineWarranty, TechnicianWalletTransaction
from app.technical_tasks.schemas import TechnicalTaskCreate, TechnicalTaskStatusUpdate, TechnicalTaskUpdate
from app.technical_tasks.service import TechnicalTaskService
from app.technical_tasks.repository import TechnicalTaskRepository

pytestmark = pytest.mark.asyncio


@pytest.fixture
async def test_db():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    # Create only the tables this module uses. (A full ``Base.metadata.create_all`` breaks whenever the whole
    # application's models are loaded in one pytest run because of an unrelated duplicate CRM index definition.)
    tables = [
        TechnicalTask.__table__,
        TechnicalTaskCallLog.__table__,
        TechnicalTaskLog.__table__,
        MachineWarranty.__table__,
        TechnicianWalletTransaction.__table__,
    ]
    async with engine.begin() as conn:
        await conn.run_sync(lambda sync_conn: Base.metadata.create_all(sync_conn, tables=tables))

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
        "contact_phone": "9000000001",
        "service_charge": "5000",
        "payment_terms": "100% advance",
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

    # 2. Cancelling without mandatory remarks is rejected
    bad_cancel_resp = await test_client.patch(
        f"/api/v1/technical-tasks/{task_id}/status",
        json={"status": "Cancel"},
    )
    assert bad_cancel_resp.status_code in (400, 422)

    # 3. Cancel WITH mandatory remarks transitions to Cancel status and stage
    cancel_resp = await test_client.patch(
        f"/api/v1/technical-tasks/{task_id}/status",
        json={"status": "Cancel", "cancel_remarks": "Customer postponed production shut-down to next quarter."},
    )
    assert cancel_resp.status_code == 200
    task_data = cancel_resp.json()["data"]
    assert task_data["status"] == "Cancel"
    assert task_data["cancel_remarks"] == "Customer postponed production shut-down to next quarter."
    cancel_tab_resp = await test_client.get("/api/v1/technical-tasks?tab=cancel")
    assert any(t["id"] == task_id for t in cancel_tab_resp.json()["data"])

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


# ---------------------------------------------------------------------------------------------------------------
# Business-rule, workflow, filter and isolation tests (rules are enforced server-side, not only in the browser)
# ---------------------------------------------------------------------------------------------------------------
def _payload(**over):
    base = {
        "company_name": "Rule Test Co",
        "contact_phone": "9000000000",
        "task_type": "In-House",
        "city": "Mumbai",
        "machine_model": "ISL450XDAN",
        "task_description": "Not sealing properly",
        "service_type": "Free",
        "call_type": "Repair",
        "priority": "A",
    }
    base.update(over)
    return base


async def _create(client, **over):
    resp = await client.post("/api/v1/technical-tasks", json=_payload(**over))
    assert resp.status_code == 201, resp.text
    return resp.json()["data"]


async def _approve(client, task_id, tech="Mangal Pandey", **extra):
    return await client.patch(
        f"/api/v1/technical-tasks/{task_id}/status", json={"status": "Approved", "task_allotted_to": tech, **extra}
    )


async def test_conditional_required_fields_enforced_by_api(test_client: AsyncClient):
    r = await test_client.post("/api/v1/technical-tasks", json=_payload(service_type="Chargeable"))
    assert r.status_code == 400  # no amount / payment terms
    r = await test_client.post(
        "/api/v1/technical-tasks", json=_payload(service_type="Chargeable", service_charge="2500")
    )
    assert r.status_code == 400  # still no payment terms
    r = await test_client.post(
        "/api/v1/technical-tasks",
        json=_payload(service_type="Chargeable", service_charge="2500", payment_terms="On completion"),
    )
    assert r.status_code == 201
    r = await test_client.post(
        "/api/v1/technical-tasks", json=_payload(task_type="Onsite Visit - Third-Party Location")
    )
    assert r.status_code == 400  # third-party city missing
    r = await test_client.post("/api/v1/technical-tasks", json=_payload(contact_phone=""))
    assert r.status_code == 400
    # Free task: stray amount / terms are dropped; non third-party task: third-party fields are dropped.
    t = await _create(test_client, service_charge="999", payment_terms="x", third_party_city="Surat")
    assert t["service_charge"] is None and t["payment_terms"] is None and t["third_party_city"] is None
    # A new task is always Pending no matter what the client sends.
    t = await _create(test_client, status="Completed", task_approved_by="Hacker")
    assert t["status"] == "Pending" and t["task_approved_by"] is None


async def test_status_machine_and_technician_required(test_client: AsyncClient):
    t = await _create(test_client)
    tid = t["id"]
    # Pending cannot jump straight to Completed before being Approved
    assert (await test_client.patch(f"/api/v1/technical-tasks/{tid}/status", json={"status": "Completed"})).status_code == 400
    # Approving without selecting Task Allotted To is rejected per workflow specification
    no_tech = await test_client.patch(f"/api/v1/technical-tasks/{tid}/status", json={"status": "Approved"})
    assert no_tech.status_code == 400
    # Approving with technician allotment transitions Pending -> Approved
    app_res = await _approve(test_client, tid)
    assert app_res.status_code == 200
    assert app_res.json()["data"]["status"] == "Approved"
    assert app_res.json()["data"]["task_approved_by"] is not None
    done = await test_client.patch(f"/api/v1/technical-tasks/{tid}/status", json={"status": "Completed", "remarks": "Replaced heater"})
    assert done.status_code == 200 and done.json()["data"]["status"] == "Completed"
    # Completed is final: no further status change, no edit.
    assert (await test_client.patch(f"/api/v1/technical-tasks/{tid}/status", json={"status": "Pending"})).status_code == 400
    assert (await test_client.patch(f"/api/v1/technical-tasks/{tid}", json={"city": "Pune"})).status_code == 400


async def test_remarks_stay_separate_and_free_tasks_never_payment_pending(test_client: AsyncClient):
    t = await _create(test_client, creator_remarks="Client angry")
    tid = t["id"]
    await _approve(test_client, tid, remarks="Go on Monday")
    bad = await test_client.patch(f"/api/v1/technical-tasks/{tid}/status", json={"status": "Payment Pending"})
    assert bad.status_code == 400  # Free task: no payment pending
    done = await test_client.patch(
        f"/api/v1/technical-tasks/{tid}/status", json={"status": "Completed", "remarks": "Fixed on site"}
    )
    d = done.json()["data"]
    assert d["creator_remarks"] == "Client angry"
    assert d["approver_remarks"] == "Go on Monday"          # NOT overwritten by the technician
    assert d["technician_remarks"] == "Fixed on site"
    assert d["payment_status"] is None
    logs = (await test_client.get(f"/api/v1/technical-tasks/{tid}/call-logs")).json()["data"]
    assert any(l["call_type"] == "Completion" and l["remarks"] == "Fixed on site" for l in logs)


async def test_chargeable_payment_flow(test_db: AsyncSession, test_client: AsyncClient):
    t = await _create(test_client, service_type="Chargeable", service_charge="5000", payment_terms="On completion")
    tid = t["id"]
    await _approve(test_client, tid, tech="Mangal Pandey")
    # Not collected -> Payment Pending (even if the client asked for Completed)
    r = await test_client.patch(
        f"/api/v1/technical-tasks/{tid}/status", json={"status": "Completed", "payment_collected": False}
    )
    assert r.json()["data"]["status"] == "Payment Pending"
    assert r.json()["data"]["payment_status"] == "Pending"
    pp = (await test_client.get("/api/v1/technical-tasks/counts")).json()["data"]["payment_pending"]
    assert pp >= 1
    # Collected needs a payment mode
    r = await test_client.patch(
        f"/api/v1/technical-tasks/{tid}/status", json={"status": "Completed", "payment_collected": True}
    )
    assert r.status_code == 400
    r = await test_client.patch(
        f"/api/v1/technical-tasks/{tid}/status",
        json={"status": "Completed", "payment_collected": True, "payment_mode": "Self collect", "collected_amount": "4800"},
    )
    d = r.json()["data"]
    assert d["status"] == "Completed" and d["payment_status"] == "Paid"
    assert d["payment_mode"] == "Self collect" and Decimal(str(d["collected_amount"])) == Decimal("4800")

    # Self collect payment automatically syncs a VERIFIED COLLECTION entry into Technician Wallet
    wallet_rows = (
        await test_db.execute(
            select(TechnicianWalletTransaction).where(TechnicianWalletTransaction.technical_task_id == uuid.UUID(tid))
        )
    ).scalars().all()
    assert len(wallet_rows) == 1
    assert wallet_rows[0].transaction_type == "COLLECTION"
    assert wallet_rows[0].status == "VERIFIED"
    assert wallet_rows[0].technician_name == "Mangal Pandey"
    assert wallet_rows[0].payment_mode == "Self collect"
    assert Decimal(str(wallet_rows[0].amount)) == Decimal("4800")


async def test_edit_ignores_workflow_fields_and_honours_version(test_client: AsyncClient):
    t = await _create(test_client)
    tid, ver = t["id"], t["version"]
    r = await test_client.patch(
        f"/api/v1/technical-tasks/{tid}", json={"city": "Pune", "status": "Completed", "version": ver}
    )
    assert r.status_code == 200
    assert r.json()["data"]["city"] == "Pune" and r.json()["data"]["status"] == "Pending"
    stale = await test_client.patch(f"/api/v1/technical-tasks/{tid}", json={"city": "Surat", "version": ver})
    assert stale.status_code == 409  # someone else saved in between


async def test_filters_ordering_and_sort_direction(test_client: AsyncClient):
    done = await _create(test_client, company_name="Zeta Done", city="Surat")
    await _approve(test_client, done["id"])
    await test_client.patch(f"/api/v1/technical-tasks/{done['id']}/status", json={"status": "Completed"})
    appr = await _create(test_client, company_name="Mid Approved", city="Surat")
    await _approve(test_client, appr["id"])
    pend = await _create(
        test_client, company_name="Alpha Pending", city="Vapi", task_type="Onsite Visit - Third-Party Location",
        third_party_city="Kalyan", service_type="Chargeable", service_charge="100", payment_terms="x",
    )
    all_rows = (await test_client.get("/api/v1/technical-tasks")).json()["data"]
    order = [r["company_name"] for r in all_rows]
    assert order.index("Alpha Pending") < order.index("Mid Approved") < order.index("Zeta Done")  # Pending, Approved, Completed

    asc = (await test_client.get("/api/v1/technical-tasks?sort_by=company_name&sort_desc=false")).json()["data"]
    desc = (await test_client.get("/api/v1/technical-tasks?sort_by=company_name&sort_desc=true")).json()["data"]
    names_asc = [r["company_name"] for r in asc]
    assert names_asc == sorted(names_asc) and [r["company_name"] for r in desc] == sorted(names_asc, reverse=True)

    today = date.today().isoformat()
    assert (await test_client.get(f"/api/v1/technical-tasks?date_from={today}&date_to={today}")).json()["meta"]["total"] >= 3
    assert (await test_client.get("/api/v1/technical-tasks?date_to=2000-01-01")).json()["meta"]["total"] == 0
    tp = (await test_client.get("/api/v1/technical-tasks?third_party_city=kalyan")).json()["data"]
    assert [r["company_name"] for r in tp] == ["Alpha Pending"]
    svc = (await test_client.get("/api/v1/technical-tasks?service_type=Chargeable")).json()["data"]
    assert [r["company_name"] for r in svc] == ["Alpha Pending"]
    assert (await test_client.get("/api/v1/technical-tasks?city=sur")).json()["meta"]["total"] == 2
    assert (await test_client.get("/api/v1/technical-tasks?search=zeta")).json()["meta"]["total"] == 1
    assert (await test_client.get("/api/v1/technical-tasks?payment_collected=pending")).json()["meta"]["total"] == 1


async def test_isolation_scope_hides_other_users_and_payment_pending(test_db: AsyncSession):
    repo = TechnicalTaskRepository(test_db)
    svc = TechnicalTaskService(repo)
    mine, other = uuid.uuid4(), uuid.uuid4()
    base = dict(company_name="C", contact_phone="1", task_type="In-House", city="X", machine_model="M",
                task_description="d", service_type="Free", call_type="Repair")
    await svc.create(TechnicalTaskCreate(**base), creator_name="sales1", creator_user_id=mine)
    await svc.create(TechnicalTaskCreate(**base), creator_name="sales2", creator_user_id=other)
    rows, total = await repo.list_tasks(creator_user_id=mine, creator_username="sales1")
    assert total == 1 and rows[0].created_by_name == "sales1"
    counts = await repo.get_counts(creator_user_id=mine, creator_username="sales1")
    assert counts["all"] == 1
    _, total_all = await repo.list_tasks()
    assert total_all == 2
    assert (await repo.get_counts(exclude_tabs=("payment_pending",)))["all"] == 2


async def test_bulk_delete_is_single_statement_and_idempotent(test_client: AsyncClient):
    a, b = await _create(test_client), await _create(test_client)
    r = await test_client.post("/api/v1/technical-tasks/bulk-delete", json={"ids": [a["id"], b["id"]]})
    assert r.json()["deleted_count"] == 2
    r = await test_client.post("/api/v1/technical-tasks/bulk-delete", json={"ids": [a["id"], b["id"]]})
    assert r.json()["deleted_count"] == 0


# ---------------------------------------------------------------------------------------------------------------
# Approver overrides, call-log report, monthly summary, admin-level actions
# ---------------------------------------------------------------------------------------------------------------
@pytest.fixture
async def limited_client(test_db: AsyncSession):
    """A normal (non-admin) user sharing the same database as ``test_client``."""
    app = create_application()

    async def _override_db():
        yield test_db

    user = CurrentUser(
        id=uuid.uuid4(),
        username="sales1",
        permissions={
            "technicaltask.view",
            "technicaltask.create",
            "technicaltask.update",
            "technicaltask.approve",
            "technicaltask.delete",
            "technicaltask.bulk_action",
        },
    )
    app.dependency_overrides[get_db_session] = _override_db
    app.dependency_overrides[get_current_user] = lambda: user
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as ac:
        yield ac


async def test_approver_can_override_type_service_amount_and_terms(test_client: AsyncClient):
    t = await _create(test_client)  # created as Free / In-House
    tid = t["id"]
    # Chargeable override without amount/terms is rejected by the same rules as create
    bad = await _approve(test_client, tid, service_type="Chargeable")
    assert bad.status_code == 400
    ok = await _approve(
        test_client, tid, service_type="Chargeable", service_charge="3500", payment_terms="50% advance",
        task_type="Onsite Visit - Client Location", scheduled_visit_date="2026-11-01",
    )
    d = ok.json()["data"]
    assert ok.status_code == 200 and d["service_type"] == "Chargeable"
    assert Decimal(str(d["service_charge"])) == Decimal("3500") and d["payment_terms"] == "50% advance"
    assert d["task_type"] == "Onsite Visit - Client Location" and d["scheduled_visit_date"] == "2026-11-01"
    logs = (await test_client.get(f"/api/v1/technical-tasks/{tid}/call-logs")).json()["data"]
    assert any(l["call_type"] == "Approver Override" for l in logs)
    # Override to a third-party visit needs the third-party city
    t2 = await _create(test_client)
    assert (await _approve(test_client, t2["id"], task_type="Onsite Visit - Third-Party Location")).status_code == 400


async def test_call_log_report_filters_and_pagination(test_client: AsyncClient):
    a = await _create(test_client, company_name="Report Alpha")
    b = await _create(test_client, company_name="Report Beta")
    for tid, ctype, rem in ((a["id"], "Telecall", "Called client"), (a["id"], "Physical Visit", "Visited"), (b["id"], "Telecall", "No answer")):
        r = await test_client.post(f"/api/v1/technical-tasks/{tid}/call-logs", json={"call_type": ctype, "remarks": rem})
        assert r.status_code == 201
    rep = (await test_client.get("/api/v1/technical-tasks/call-log-report")).json()
    assert rep["meta"]["total"] == 3 and {r["company_name"] for r in rep["data"]} == {"Report Alpha", "Report Beta"}
    assert all("task_status" in r and "machine_model" in r for r in rep["data"])
    tele = (await test_client.get("/api/v1/technical-tasks/call-log-report?call_type=Telecall")).json()
    assert tele["meta"]["total"] == 2
    srch = (await test_client.get("/api/v1/technical-tasks/call-log-report?search=beta")).json()
    assert [r["company_name"] for r in srch["data"]] == ["Report Beta"]
    none = (await test_client.get("/api/v1/technical-tasks/call-log-report?date_to=2000-01-01")).json()
    assert none["meta"]["total"] == 0
    page = (await test_client.get("/api/v1/technical-tasks/call-log-report?page=2&page_size=2")).json()
    assert len(page["data"]) == 1 and page["meta"]["pages"] == 2


async def test_monthly_summary_open_vs_closed(test_client: AsyncClient):
    done = await _create(test_client)
    await _approve(test_client, done["id"])
    await test_client.patch(f"/api/v1/technical-tasks/{done['id']}/status", json={"status": "Completed"})
    await _create(test_client)
    data = (await test_client.get("/api/v1/technical-tasks/monthly-summary?months=6")).json()["data"]
    assert len(data["months"]) == 6
    this_month = data["months"][-1]
    assert this_month["month"] == date.today().strftime("%Y-%m")
    assert this_month["created"] == 2 and this_month["completed"] == 1
    assert data["open_now"] == 1 and data["closed_now"] == 1


async def test_admin_level_actions_for_normal_users(test_client: AsyncClient, limited_client: AsyncClient):
    pend = await _create(test_client)
    appr = await _create(test_client)
    await _approve(test_client, appr["id"])                       # approved by "admin"
    # Normal user: cannot edit an Approved task they did not approve, cannot delete it, can delete a Pending one
    assert (await limited_client.patch(f"/api/v1/technical-tasks/{appr['id']}", json={"city": "Pune"})).status_code == 403
    assert (await limited_client.delete(f"/api/v1/technical-tasks/{appr['id']}")).status_code == 403
    assert (await limited_client.delete(f"/api/v1/technical-tasks/{pend['id']}")).status_code == 200
    # Bulk delete by a normal user only removes Pending tasks
    p2 = await _create(test_client)
    r = await limited_client.post("/api/v1/technical-tasks/bulk-delete", json={"ids": [appr["id"], p2["id"]]})
    assert r.json()["deleted_count"] == 1
    # Reopen of a cancelled task approved by someone else: only admin / that approver
    await test_client.patch(f"/api/v1/technical-tasks/{appr['id']}/status", json={"status": "Cancel", "cancel_remarks": "Client postponed"})
    denied = await limited_client.post(f"/api/v1/technical-tasks/{appr['id']}/reopen", json={"status": "Approved", "task_allotted_to": "Mangal"})
    assert denied.status_code == 403
    allowed = await test_client.post(f"/api/v1/technical-tasks/{appr['id']}/reopen", json={"status": "Approved", "task_allotted_to": "Mangal"})
    assert allowed.status_code == 200


async def test_payment_summary_and_recording(test_db: AsyncSession, test_client: AsyncClient):
    chargeable = await _create(test_client, service_type="Chargeable", service_charge=10000, payment_terms="Immediate")
    await _approve(test_client, chargeable["id"], tech="Suresh Patil")

    # Cancelled chargeable task must NEVER inflate payment summary or appear in payment tabs
    cancelled_chargeable = await _create(
        test_client, company_name="Cancelled Order Co", service_type="Chargeable", service_charge=7000, payment_terms="Advance"
    )
    cancel_r = await test_client.patch(
        f"/api/v1/technical-tasks/{cancelled_chargeable['id']}/status",
        json={"status": "Cancel", "cancel_remarks": "Customer cancelled service visit"},
    )
    assert cancel_r.status_code == 200

    res = await test_client.get("/api/v1/technical-tasks/payment-summary")
    summary = res.json()["data"]
    assert summary["total_payment"] == 10000.0
    assert summary["paid"] == 0.0
    assert summary["due"] == 10000.0
    assert summary["all_count"] == 1
    assert summary["pending_count"] == 1
    assert summary["completed_count"] == 0

    all_pay_rows = (await test_client.get("/api/v1/technical-tasks?payment_collected=all")).json()["data"]
    assert [row["id"] for row in all_pay_rows] == [chargeable["id"]]
    pend_pay_rows = (await test_client.get("/api/v1/technical-tasks?payment_collected=pending")).json()["data"]
    assert [row["id"] for row in pend_pay_rows] == [chargeable["id"]]

    p1 = await test_client.post(
        f"/api/v1/technical-tasks/{chargeable['id']}/record-payment",
        json={"amount": 4000, "payment_mode": "Company Acc", "reference_no": "UPI987654"},
    )
    assert p1.status_code == 200
    assert float(p1.json()["data"]["collected_amount"]) == 4000.0
    assert p1.json()["data"]["payment_status"] == "Pending"

    res2 = await test_client.get("/api/v1/technical-tasks/payment-summary")
    summary2 = res2.json()["data"]
    assert summary2["total_payment"] == 10000.0
    assert summary2["paid"] == 4000.0
    assert summary2["due"] == 6000.0
    assert summary2["all_count"] == 1
    assert summary2["pending_count"] == 1
    assert summary2["completed_count"] == 0

    p2 = await test_client.post(
        f"/api/v1/technical-tasks/{chargeable['id']}/record-payment",
        json={"amount": 6000, "payment_mode": "Self collect", "reference_no": "CASH-6000"},
    )
    assert p2.status_code == 200
    assert float(p2.json()["data"]["collected_amount"]) == 10000.0
    assert p2.json()["data"]["payment_status"] == "Paid"

    res3 = await test_client.get("/api/v1/technical-tasks/payment-summary")
    summary3 = res3.json()["data"]
    assert summary3["total_payment"] == 10000.0
    assert summary3["paid"] == 10000.0
    assert summary3["due"] == 0.0
    assert summary3["all_count"] == 1
    assert summary3["pending_count"] == 0
    assert summary3["completed_count"] == 1

    comp_pay_rows = (await test_client.get("/api/v1/technical-tasks?payment_collected=completed")).json()["data"]
    assert [row["id"] for row in comp_pay_rows] == [chargeable["id"]]

    wallet_rows = (
        await test_db.execute(
            select(TechnicianWalletTransaction).where(
                TechnicianWalletTransaction.technical_task_id == uuid.UUID(chargeable["id"])
            )
        )
    ).scalars().all()
    assert len(wallet_rows) == 1
    assert wallet_rows[0].transaction_type == "COLLECTION"
    assert wallet_rows[0].technician_name == "Suresh Patil"
    assert Decimal(str(wallet_rows[0].amount)) == Decimal("6000")


async def test_technical_task_rbac_permissions(test_db: AsyncSession, test_client: AsyncClient):
    """Verify RBAC permission enforcement across Technical Tasks endpoints and seed definitions."""
    from scripts.seed import BOOTSTRAP_PERMISSIONS

    seeded_codes = {row[0] for row in BOOTSTRAP_PERMISSIONS if row[1] == "technicaltask"}
    assert seeded_codes == {
        "technicaltask.view",
        "technicaltask.create",
        "technicaltask.update",
        "technicaltask.approve",
        "technicaltask.delete",
        "technicaltask.export",
        "technicaltask.bulk_action",
        "technicaltask.manage",
    }

    task = await _create(test_client, company_name="RBAC Corp")
    tid = task["id"]

    active_perms: set[str] = set()
    app = create_application()

    async def _override_db():
        yield test_db

    app.dependency_overrides[get_db_session] = _override_db
    app.dependency_overrides[get_current_user] = lambda: CurrentUser(
        id=uuid.uuid4(),
        username="rbac_user",
        permissions=set(active_perms),
    )

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        # 1. Zero permissions -> 403 across endpoints
        assert (await client.get("/api/v1/technical-tasks")).status_code == 403
        assert (await client.get("/api/v1/technical-tasks/counts")).status_code == 403
        assert (await client.post("/api/v1/technical-tasks", json={"company_name": "X"})).status_code == 403
        assert (await client.patch(f"/api/v1/technical-tasks/{tid}", json={"city": "Pune"})).status_code == 403
        assert (await client.delete(f"/api/v1/technical-tasks/{tid}")).status_code == 403
        assert (await client.post("/api/v1/technical-tasks/bulk-delete", json={"ids": [tid]})).status_code == 403

        # 2. View-only -> 200 on read, 403 on write
        active_perms.update({"technicaltask.view"})
        assert (await client.get("/api/v1/technical-tasks")).status_code == 200
        assert (await client.get("/api/v1/technical-tasks/counts")).status_code == 200
        assert (await client.get(f"/api/v1/technical-tasks/{tid}")).status_code == 200
        assert (await client.post("/api/v1/technical-tasks", json={"company_name": "X"})).status_code == 403

        # 3. Update without Approve -> cannot transition Pending -> Approved
        active_perms.clear()
        active_perms.update({"technicaltask.view", "technicaltask.update"})
        assert (
            await client.patch(
                f"/api/v1/technical-tasks/{tid}/status",
                json={"status": "Approved", "task_allotted_to": "Tech 1"},
            )
        ).status_code == 403

        # 4. Approve without Update -> can approve Pending -> Approved, cannot Complete
        active_perms.clear()
        active_perms.update({"technicaltask.view", "technicaltask.approve"})
        approve_res = await client.patch(
            f"/api/v1/technical-tasks/{tid}/status",
            json={"status": "Approved", "task_allotted_to": "Tech 1"},
        )
        assert approve_res.status_code == 200
        assert (
            await client.patch(f"/api/v1/technical-tasks/{tid}/status", json={"status": "Completed"})
        ).status_code == 403

        # 5. technicaltask.manage -> full access including deleting an Approved task approved by someone else
        active_perms.clear()
        active_perms.update({"technicaltask.manage"})
        assert (await client.get("/api/v1/technical-tasks")).status_code == 200
        assert (await client.delete(f"/api/v1/technical-tasks/{tid}")).status_code == 200


async def test_technical_task_detail_by_number_call_logs_and_task_logs(test_client: AsyncClient):
    created = await _create(
        test_client,
        company_name="Dynamic Machinery Pvt Ltd",
        contact_person_name="Arun Nair",
        contact_phone="9898989898",
        task_type="Telecall",
        machine_model="GF100 Granular Filler",
        task_description="Installation",
    )
    tid = created["id"]
    tnum = created["task_number"]
    assert isinstance(tnum, int) and tnum >= 1

    # Detail lookup works by sequential task_number as well as UUID
    by_num = await test_client.get(f"/api/v1/technical-tasks/{tnum}")
    assert by_num.status_code == 200
    assert by_num.json()["data"]["id"] == tid
    assert by_num.json()["data"]["task_number"] == tnum

    # Initial Task Log Summary contains 'Create Technical Task' with Pending status
    task_logs_initial = (await test_client.get(f"/api/v1/technical-tasks/{tnum}/task-logs")).json()["data"]
    assert len(task_logs_initial) == 1
    assert task_logs_initial[0]["title"] == "Create Technical Task"
    assert task_logs_initial[0]["status"] == "Pending"

    # Add Call Logs (Telecall & Physical Visit) via task_number endpoint
    r1 = await test_client.post(
        f"/api/v1/technical-tasks/{tnum}/call-logs",
        json={"call_type": "Telecall", "remarks": "Spoke with plant supervisor regarding power supply."},
    )
    assert r1.status_code == 201
    r2 = await test_client.post(
        f"/api/v1/technical-tasks/{tid}/call-logs",
        json={"call_type": "Physical Visit", "remarks": "Completed on-site alignment check."},
    )
    assert r2.status_code == 201

    call_logs = (await test_client.get(f"/api/v1/technical-tasks/{tnum}/call-logs")).json()["data"]
    assert len(call_logs) == 2
    assert {c["call_type"] for c in call_logs} == {"Telecall", "Physical Visit"}

    # Transition status -> Task Log Summary appends lifecycle entries
    await _approve(test_client, tid, tech="Ramesh Kumar")
    await test_client.patch(
        f"/api/v1/technical-tasks/{tid}/status",
        json={"status": "Completed", "remarks": "Commissioned successfully"},
    )
    task_logs_after = (await test_client.get(f"/api/v1/technical-tasks/{tid}/task-logs")).json()["data"]
    titles = [entry["title"] for entry in task_logs_after]
    assert "Create Technical Task" in titles
    assert "Approve Technical Task" in titles
    assert "Complete Technical Task" in titles


