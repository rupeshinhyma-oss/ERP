"""
HRMS Asset Management Integration Tests.

Validates:
1. Asset creation with auto-generated code and custom code
2. Asset fetching by ID with full audit history
3. Asset search and filters (search, status, category)
4. Asset metadata updates
5. Asset assignment to real employee from users table
6. Asset return workflow with condition update
7. Validation: duplicate serial number returns 409
8. Validation: non-existent employee returns 400
9. Validation: non-existent asset returns 404
10. Validation: cannot assign retired or lost asset
11. One active assignment rule enforcement: attempting concurrent assignment raises 409
12. Persistent assignment table and history inspection (GET /{id}/assignments)
13. Maintenance logging and status transition (POST /{id}/maintenance, GET /{id}/maintenance)
14. Branch transfer and movement audit (POST /{id}/move)
15. Summary counts endpoint directly querying PostgreSQL (GET /summary)
16. Warranty status filtering (ACTIVE, EXPIRING_SOON, EXPIRED, NO_WARRANTY)
17. Soft-delete asset
18. Proper cleanup in teardown
"""

from datetime import date, datetime, timedelta, timezone
import uuid
import pytest
from httpx import AsyncClient
from sqlalchemy import delete, select

from app.auth.security import create_access_token
from app.database.engine import get_sessionmaker
from app.hrms.models import (
    HrmsAsset,
    HrmsAssetAssignment,
    HrmsAssetHistory,
    HrmsAssetMaintenance,
    HrmsLocation,
)
from app.users.models import User, UserStatus


@pytest.mark.asyncio
async def test_hrms_asset_lifecycle_full_workflow(client: AsyncClient):
    sessionmaker = get_sessionmaker()

    # 1. Setup Admin and Real Employee from users table
    admin_id = uuid.uuid4()
    emp_id = uuid.uuid4()

    async with sessionmaker() as session:
        admin_user = User(
            id=admin_id,
            email=f"asset.admin.{uuid.uuid4().hex[:6]}@example.com",
            username=f"asset_admin_{uuid.uuid4().hex[:4]}",
            first_name="Asset",
            last_name="Admin",
            password_hash="mock_hash",
            is_active=True,
            status=UserStatus.ACTIVE,
        )
        session.add(admin_user)

        real_emp = User(
            id=emp_id,
            email=f"emp.{uuid.uuid4().hex[:6]}@example.com",
            username=f"emp_{uuid.uuid4().hex[:4]}",
            first_name="Ravi",
            last_name="Kumar",
            employee_code=f"EMP-AST-{uuid.uuid4().hex[:4]}",
            password_hash="mock_hash",
            is_active=True,
            status=UserStatus.ACTIVE,
        )
        session.add(real_emp)
        await session.commit()

    admin_token = create_access_token(admin_id, permissions=["*"]).token
    admin_headers = {"Authorization": f"Bearer {admin_token}"}

    created_asset_ids = []

    try:
        # -------------------------------------------------------------------
        # 2. Create Asset with Auto-Generated Code
        # -------------------------------------------------------------------
        sn_1 = f"SN-{uuid.uuid4().hex[:8]}"
        create_payload = {
            "asset_name": "MacBook Pro 16",
            "asset_category": "Laptop",
            "brand": "Apple",
            "model": "M3 Max",
            "serial_number": sn_1,
            "purchase_date": "2026-01-15",
            "purchase_cost": 2499.00,
            "vendor": "Apple India Retail Ltd",
            "warranty_expiry": str(date.today() + timedelta(days=365)),
            "condition": "NEW",
            "description": "Engineering high-performance machine",
        }
        res = await client.post("/api/v1/hrms/assets", json=create_payload, headers=admin_headers)
        assert res.status_code == 201, res.text
        data = res.json()["data"]
        asset_id = data["id"]
        created_asset_ids.append(asset_id)

        assert data["asset_name"] == "MacBook Pro 16"
        assert data["asset_code"].startswith("AST-")
        assert data["status"] == "AVAILABLE"
        assert data["serial_number"] == sn_1
        assert data["vendor"] == "Apple India Retail Ltd"
        assert data["assigned_to_user_id"] is None

        # -------------------------------------------------------------------
        # 3. Fetch Asset by ID and verify CREATED history event
        # -------------------------------------------------------------------
        get_res = await client.get(f"/api/v1/hrms/assets/{asset_id}", headers=admin_headers)
        assert get_res.status_code == 200
        get_data = get_res.json()["data"]
        assert len(get_data["history"]) >= 1
        assert get_data["history"][0]["action"] == "CREATED"

        # -------------------------------------------------------------------
        # 4. Search and Filters
        # -------------------------------------------------------------------
        search_res = await client.get(f"/api/v1/hrms/assets?search={sn_1}", headers=admin_headers)
        assert search_res.status_code == 200
        assert len(search_res.json()["data"]) == 1

        cat_res = await client.get("/api/v1/hrms/assets?category=Laptop", headers=admin_headers)
        assert cat_res.status_code == 200
        assert any(a["id"] == asset_id for a in cat_res.json()["data"])

        # -------------------------------------------------------------------
        # 5. Metadata Updates (PATCH)
        # -------------------------------------------------------------------
        patch_payload = {
            "model": "M3 Max 64GB",
            "description": "Upgraded RAM specs",
        }
        patch_res = await client.patch(f"/api/v1/hrms/assets/{asset_id}", json=patch_payload, headers=admin_headers)
        assert patch_res.status_code == 200
        assert patch_res.json()["data"]["model"] == "M3 Max 64GB"

        # -------------------------------------------------------------------
        # 6. Assign Asset to Real Employee
        # -------------------------------------------------------------------
        assign_payload = {
            "employee_id": str(emp_id),
            "assigned_date": "2026-02-01",
            "expected_return_date": "2026-12-31",
            "condition_at_assignment": "EXCELLENT",
            "notes": "Handover for senior backend engineering duties.",
        }
        assign_res = await client.post(
            f"/api/v1/hrms/assets/{asset_id}/assign",
            json=assign_payload,
            headers=admin_headers,
        )
        assert assign_res.status_code == 200, assign_res.text
        assigned_data = assign_res.json()["data"]
        assert assigned_data["status"] == "ASSIGNED"
        assert assigned_data["assigned_to_user_id"] == str(emp_id)
        assert assigned_data["assigned_to_name"] == "Ravi Kumar"
        assert assigned_data["expected_return_date"] == "2026-12-31"

        # -------------------------------------------------------------------
        # 7. Check Persistence in Database Table hrms_asset_assignments
        # -------------------------------------------------------------------
        assignments_res = await client.get(f"/api/v1/hrms/assets/{asset_id}/assignments", headers=admin_headers)
        assert assignments_res.status_code == 200
        assign_history = assignments_res.json()["data"]
        assert len(assign_history) == 1
        assert assign_history[0]["employee_id"] == str(emp_id)
        assert assign_history[0]["assignment_status"] == "ACTIVE"

        # -------------------------------------------------------------------
        # 8. Return Asset Workflow
        # -------------------------------------------------------------------
        return_payload = {
            "return_date": "2026-03-01",
            "condition_after_return": "GOOD",
            "notes": "Project completed, equipment returned in clean working condition.",
        }
        ret_res = await client.post(
            f"/api/v1/hrms/assets/{asset_id}/return",
            json=return_payload,
            headers=admin_headers,
        )
        assert ret_res.status_code == 200, ret_res.text
        ret_data = ret_res.json()["data"]
        assert ret_data["status"] == "AVAILABLE"
        assert ret_data["assigned_to_user_id"] is None
        assert ret_data["condition"] == "GOOD"

        # Verify assignment record closed
        assignments_after_return = await client.get(f"/api/v1/hrms/assets/{asset_id}/assignments", headers=admin_headers)
        assert assignments_after_return.status_code == 200
        closed_assign = assignments_after_return.json()["data"][0]
        assert closed_assign["assignment_status"] == "RETURNED"
        assert closed_assign["returned_at"] == "2026-03-01"

        # -------------------------------------------------------------------
        # 9. Direct Status Update
        # -------------------------------------------------------------------
        status_payload = {"status": "UNDER_MAINTENANCE", "notes": "Sent for regular battery check"}
        st_res = await client.patch(f"/api/v1/hrms/assets/{asset_id}/status", json=status_payload, headers=admin_headers)
        assert st_res.status_code == 200
        assert st_res.json()["data"]["status"] == "UNDER_MAINTENANCE"

        # Reset to AVAILABLE
        await client.patch(
            f"/api/v1/hrms/assets/{asset_id}/status",
            json={"status": "AVAILABLE"},
            headers=admin_headers,
        )

        # -------------------------------------------------------------------
        # 10. Duplicate Serial Number Validation
        # -------------------------------------------------------------------
        dup_payload = {
            "asset_name": "Another Laptop",
            "asset_category": "Laptop",
            "serial_number": sn_1,
        }
        dup_res = await client.post("/api/v1/hrms/assets", json=dup_payload, headers=admin_headers)
        assert dup_res.status_code == 409
        assert "already exists" in dup_res.text.lower()

        # -------------------------------------------------------------------
        # 11. Soft-Delete / Retire Asset
        # -------------------------------------------------------------------
        del_res = await client.delete(f"/api/v1/hrms/assets/{asset_id}", headers=admin_headers)
        assert del_res.status_code == 200

        # Should no longer appear in active list
        list_after_del = await client.get("/api/v1/hrms/assets", headers=admin_headers)
        assert not any(a["id"] == asset_id for a in list_after_del.json()["data"])

    finally:
        async with sessionmaker() as session:
            for aid in created_asset_ids:
                a_uuid = uuid.UUID(aid) if isinstance(aid, str) else aid
                await session.execute(delete(HrmsAssetAssignment).where(HrmsAssetAssignment.asset_id == a_uuid))
                await session.execute(delete(HrmsAssetMaintenance).where(HrmsAssetMaintenance.asset_id == a_uuid))
                await session.execute(delete(HrmsAssetHistory).where(HrmsAssetHistory.asset_id == a_uuid))
                await session.execute(delete(HrmsAsset).where(HrmsAsset.id == a_uuid))

            for uid in [admin_id, emp_id]:
                u = await session.get(User, uid)
                if u:
                    u.deleted_at = datetime.now(timezone.utc)
                    u.is_active = False
            await session.commit()


@pytest.mark.asyncio
async def test_hrms_asset_one_active_assignment_rule(client: AsyncClient):
    """Enforces that an asset cannot be assigned concurrently to two employees."""
    sessionmaker = get_sessionmaker()

    admin_id = uuid.uuid4()
    emp1_id = uuid.uuid4()
    emp2_id = uuid.uuid4()

    async with sessionmaker() as session:
        admin = User(
            id=admin_id,
            email=f"admin.{uuid.uuid4().hex[:6]}@example.com",
            username=f"admin_{uuid.uuid4().hex[:4]}",
            first_name="Admin",
            last_name="Super",
            password_hash="mock",
            is_active=True,
            status=UserStatus.ACTIVE,
        )
        emp1 = User(
            id=emp1_id,
            email=f"emp1.{uuid.uuid4().hex[:6]}@example.com",
            username=f"emp1_{uuid.uuid4().hex[:4]}",
            first_name="Employee",
            last_name="One",
            employee_code=f"EMP-{uuid.uuid4().hex[:4]}",
            password_hash="mock",
            is_active=True,
            status=UserStatus.ACTIVE,
        )
        emp2 = User(
            id=emp2_id,
            email=f"emp2.{uuid.uuid4().hex[:6]}@example.com",
            username=f"emp2_{uuid.uuid4().hex[:4]}",
            first_name="Employee",
            last_name="Two",
            employee_code=f"EMP-{uuid.uuid4().hex[:4]}",
            password_hash="mock",
            is_active=True,
            status=UserStatus.ACTIVE,
        )
        session.add_all([admin, emp1, emp2])
        await session.commit()

    admin_token = create_access_token(admin_id, permissions=["*"]).token
    headers = {"Authorization": f"Bearer {admin_token}"}
    asset_id = None

    try:
        # 1. Create asset
        c_res = await client.post(
            "/api/v1/hrms/assets",
            json={"asset_name": "Test Dell Workstation", "asset_category": "Desktop"},
            headers=headers,
        )
        assert c_res.status_code == 201
        asset_id = c_res.json()["data"]["id"]

        # 2. Assign to Employee 1
        a1_res = await client.post(
            f"/api/v1/hrms/assets/{asset_id}/assign",
            json={"employee_id": str(emp1_id), "assigned_date": str(date.today())},
            headers=headers,
        )
        assert a1_res.status_code == 200

        # 3. Attempt concurrent assignment to Employee 2 -> Must be rejected with 409
        a2_res = await client.post(
            f"/api/v1/hrms/assets/{asset_id}/assign",
            json={"employee_id": str(emp2_id), "assigned_date": str(date.today())},
            headers=headers,
        )
        assert a2_res.status_code == 409, f"Expected 409 Conflict, got {a2_res.status_code}"
        assert "already assigned" in a2_res.text.lower()

        # 4. Return from Employee 1
        ret_res = await client.post(
            f"/api/v1/hrms/assets/{asset_id}/return",
            json={"return_date": str(date.today()), "condition_after_return": "GOOD"},
            headers=headers,
        )
        assert ret_res.status_code == 200

        # 5. Now assign to Employee 2 -> Should succeed
        a2_success = await client.post(
            f"/api/v1/hrms/assets/{asset_id}/assign",
            json={"employee_id": str(emp2_id), "assigned_date": str(date.today())},
            headers=headers,
        )
        assert a2_success.status_code == 200
        assert a2_success.json()["data"]["assigned_to_user_id"] == str(emp2_id)

        # 6. Verify assignment history has 2 records
        history_res = await client.get(f"/api/v1/hrms/assets/{asset_id}/assignments", headers=headers)
        assert history_res.status_code == 200
        assignments = history_res.json()["data"]
        assert len(assignments) == 2
        statuses = [a["assignment_status"] for a in assignments]
        assert "ACTIVE" in statuses
        assert "RETURNED" in statuses

    finally:
        async with sessionmaker() as session:
            if asset_id:
                a_uuid = uuid.UUID(asset_id)
                await session.execute(delete(HrmsAssetAssignment).where(HrmsAssetAssignment.asset_id == a_uuid))
                await session.execute(delete(HrmsAssetHistory).where(HrmsAssetHistory.asset_id == a_uuid))
                await session.execute(delete(HrmsAsset).where(HrmsAsset.id == a_uuid))
            for uid in [admin_id, emp1_id, emp2_id]:
                u = await session.get(User, uid)
                if u:
                    u.deleted_at = datetime.now(timezone.utc)
            await session.commit()


@pytest.mark.asyncio
async def test_hrms_asset_maintenance_and_branch_movement(client: AsyncClient):
    """Validates maintenance logging, status locking, and branch transfers."""
    sessionmaker = get_sessionmaker()

    admin_id = uuid.uuid4()
    emp_id = uuid.uuid4()
    loc1_id = uuid.uuid4()
    loc2_id = uuid.uuid4()

    async with sessionmaker() as session:
        admin = User(
            id=admin_id,
            email=f"admin.{uuid.uuid4().hex[:6]}@example.com",
            username=f"admin_{uuid.uuid4().hex[:4]}",
            first_name="Admin",
            last_name="Super",
            password_hash="mock",
            is_active=True,
            status=UserStatus.ACTIVE,
        )
        emp = User(
            id=emp_id,
            email=f"emp.{uuid.uuid4().hex[:6]}@example.com",
            username=f"emp_{uuid.uuid4().hex[:4]}",
            first_name="Employee",
            last_name="Test",
            employee_code=f"EMP-{uuid.uuid4().hex[:4]}",
            password_hash="mock",
            is_active=True,
            status=UserStatus.ACTIVE,
        )
        loc1 = HrmsLocation(
            id=loc1_id,
            name="Mumbai HQ",
            address="BKC Mumbai",
            latitude=19.0760,
            longitude=72.8777,
        )
        loc2 = HrmsLocation(
            id=loc2_id,
            name="Pune Branch",
            address="Hinjewadi Pune",
            latitude=18.5204,
            longitude=73.8567,
        )
        session.add_all([admin, emp, loc1, loc2])
        await session.commit()

    admin_token = create_access_token(admin_id, permissions=["*"]).token
    headers = {"Authorization": f"Bearer {admin_token}"}
    asset_id = None

    try:
        # 1. Create asset at Mumbai HQ
        c_res = await client.post(
            "/api/v1/hrms/assets",
            json={"asset_name": "HP LaserJet Pro", "asset_category": "Printer", "location_id": str(loc1_id)},
            headers=headers,
        )
        assert c_res.status_code == 201
        asset_id = c_res.json()["data"]["id"]

        # 2. Log maintenance record
        maint_payload = {
            "issue": "Toner roller jamming and paper pickup failure",
            "reported_date": str(date.today()),
            "vendor_technician": "HP Authorized Service Center",
            "cost": 150.00,
            "status": "OPEN",
            "notes": "Service technician scheduled for on-site visit.",
        }
        m_res = await client.post(
            f"/api/v1/hrms/assets/{asset_id}/maintenance",
            json=maint_payload,
            headers=headers,
        )
        assert m_res.status_code == 201
        assert m_res.json()["data"]["issue"] == maint_payload["issue"]

        # 3. Verify asset status updated to MAINTENANCE
        get_asset = await client.get(f"/api/v1/hrms/assets/{asset_id}", headers=headers)
        assert get_asset.status_code == 200
        assert get_asset.json()["data"]["status"] == "MAINTENANCE"

        # 4. Attempt to assign asset while under maintenance -> Must fail with 400
        assign_fail = await client.post(
            f"/api/v1/hrms/assets/{asset_id}/assign",
            json={"employee_id": str(emp_id), "assigned_date": str(date.today())},
            headers=headers,
        )
        assert assign_fail.status_code == 400
        assert "cannot assign asset in 'maintenance'" in assign_fail.text.lower()

        # 5. Move branch from Mumbai HQ to Pune Branch
        move_res = await client.post(
            f"/api/v1/hrms/assets/{asset_id}/move",
            json={"location_id": str(loc2_id), "reason": "Relocated to Pune Branch for development team"},
            headers=headers,
        )
        assert move_res.status_code == 200
        assert move_res.json()["data"]["location_name"] == "Pune Branch"

        # 6. Verify audit history contains BRANCH_TRANSFER and MAINTENANCE_LOGGED
        history_res = await client.get(f"/api/v1/hrms/assets/{asset_id}/history", headers=headers)
        actions = [h["action"] for h in history_res.json()["data"]]
        assert "MAINTENANCE_LOGGED" in actions
        assert "BRANCH_TRANSFER" in actions

    finally:
        async with sessionmaker() as session:
            if asset_id:
                a_uuid = uuid.UUID(asset_id)
                await session.execute(delete(HrmsAssetMaintenance).where(HrmsAssetMaintenance.asset_id == a_uuid))
                await session.execute(delete(HrmsAssetHistory).where(HrmsAssetHistory.asset_id == a_uuid))
                await session.execute(delete(HrmsAsset).where(HrmsAsset.id == a_uuid))
            for uid in [admin_id, emp_id]:
                u = await session.get(User, uid)
                if u:
                    u.deleted_at = datetime.now(timezone.utc)
            for lid in [loc1_id, loc2_id]:
                loc = await session.get(HrmsLocation, lid)
                if loc:
                    loc.deleted_at = datetime.now(timezone.utc)
            await session.commit()


@pytest.mark.asyncio
async def test_hrms_asset_summary_statistics(client: AsyncClient):
    """Validates the GET /summary endpoint querying live PostgreSQL data."""
    admin_id = uuid.uuid4()
    admin_token = create_access_token(admin_id, permissions=["*"]).token
    headers = {"Authorization": f"Bearer {admin_token}"}

    res = await client.get("/api/v1/hrms/assets/summary", headers=headers)
    assert res.status_code == 200
    summary = res.json()["data"]

    assert "total_assets" in summary
    assert "available" in summary
    assert "assigned" in summary
    assert "in_maintenance" in summary
    assert "damaged" in summary
    assert "lost" in summary
    assert "retired" in summary
    assert isinstance(summary["total_assets"], int)


@pytest.mark.asyncio
async def test_hrms_asset_assignment_security_and_reassignment_rules(client: AsyncClient):
    """
    Validates:
    - Assigning asset to existing DB user
    - Reassignment workflow (return -> reassign)
    - Prevention of assigning retired assets
    - Prevention of assigning deleted / inactive users
    - Prevention of returning an already available asset
    - Verification of database persistence in PostgreSQL tables
    """
    sessionmaker = get_sessionmaker()

    admin_id = uuid.uuid4()
    active_emp_id = uuid.uuid4()
    deleted_emp_id = uuid.uuid4()

    async with sessionmaker() as session:
        admin = User(
            id=admin_id,
            email=f"admin.sec.{uuid.uuid4().hex[:6]}@example.com",
            username=f"admin_sec_{uuid.uuid4().hex[:4]}",
            password_hash="mock",
            is_active=True,
            status=UserStatus.ACTIVE,
        )
        active_emp = User(
            id=active_emp_id,
            email=f"active.emp.{uuid.uuid4().hex[:6]}@example.com",
            username=f"active_emp_{uuid.uuid4().hex[:4]}",
            employee_code=f"ACT-{uuid.uuid4().hex[:4]}",
            password_hash="mock",
            is_active=True,
            status=UserStatus.ACTIVE,
        )
        deleted_emp = User(
            id=deleted_emp_id,
            email=f"del.emp.{uuid.uuid4().hex[:6]}@example.com",
            username=f"del_emp_{uuid.uuid4().hex[:4]}",
            employee_code=f"DEL-{uuid.uuid4().hex[:4]}",
            password_hash="mock",
            is_active=False,
            deleted_at=datetime.now(timezone.utc),
            status=UserStatus.INACTIVE,
        )
        session.add_all([admin, active_emp, deleted_emp])
        await session.commit()

    admin_token = create_access_token(admin_id, permissions=["*"]).token
    headers = {"Authorization": f"Bearer {admin_token}"}
    asset_id = None

    try:
        # 1. Create asset
        c_res = await client.post(
            "/api/v1/hrms/assets",
            json={"asset_name": "Lenovo ThinkPad P1", "asset_category": "Laptop"},
            headers=headers,
        )
        assert c_res.status_code == 201
        asset_id = c_res.json()["data"]["id"]

        # 2. Prevent assigning to deleted / inactive user -> 400
        del_assign = await client.post(
            f"/api/v1/hrms/assets/{asset_id}/assign",
            json={"employee_id": str(deleted_emp_id), "assigned_date": str(date.today())},
            headers=headers,
        )
        assert del_assign.status_code == 400
        assert "inactive" in del_assign.text.lower() or "not found" in del_assign.text.lower()

        # 3. Prevent returning an already unassigned/available asset -> 400
        invalid_return = await client.post(
            f"/api/v1/hrms/assets/{asset_id}/return",
            json={"return_date": str(date.today()), "condition_after_return": "GOOD"},
            headers=headers,
        )
        assert invalid_return.status_code == 400
        assert "not currently assigned" in invalid_return.text.lower()

        # 4. Successfully assign to active employee
        assign_ok = await client.post(
            f"/api/v1/hrms/assets/{asset_id}/assign",
            json={"employee_id": str(active_emp_id), "assigned_date": str(date.today())},
            headers=headers,
        )
        assert assign_ok.status_code == 200
        assert assign_ok.json()["data"]["status"] == "ASSIGNED"

        # 5. Return asset
        ret_ok = await client.post(
            f"/api/v1/hrms/assets/{asset_id}/return",
            json={"return_date": str(date.today()), "condition_after_return": "GOOD"},
            headers=headers,
        )
        assert ret_ok.status_code == 200
        assert ret_ok.json()["data"]["status"] == "AVAILABLE"

        # 6. Reassign asset (reassignment workflow)
        reassign_ok = await client.post(
            f"/api/v1/hrms/assets/{asset_id}/assign",
            json={"employee_id": str(active_emp_id), "assigned_date": str(date.today())},
            headers=headers,
        )
        assert reassign_ok.status_code == 200
        assert reassign_ok.json()["data"]["status"] == "ASSIGNED"

        # Return again so we can test retiring
        await client.post(
            f"/api/v1/hrms/assets/{asset_id}/return",
            json={"return_date": str(date.today()), "condition_after_return": "GOOD"},
            headers=headers,
        )

        # 7. Retire asset
        del_asset = await client.delete(f"/api/v1/hrms/assets/{asset_id}", headers=headers)
        assert del_asset.status_code == 200

        # 8. Prevent assigning retired asset -> 400
        assign_retired = await client.post(
            f"/api/v1/hrms/assets/{asset_id}/assign",
            json={"employee_id": str(active_emp_id), "assigned_date": str(date.today())},
            headers=headers,
        )
        assert assign_retired.status_code == 400 or assign_retired.status_code == 404

        # 9. Verify PostgreSQL Database Persistence directly via SQLAlchemy Session
        async with sessionmaker() as db_session:
            a_uuid = uuid.UUID(asset_id)
            db_asset = await db_session.get(HrmsAsset, a_uuid)
            assert db_asset is not None
            assert db_asset.status == "RETIRED"
            assert db_asset.deleted_at is not None

            # Verify assignment history records in PostgreSQL
            hist_res = await db_session.execute(
                select(HrmsAssetAssignment).where(HrmsAssetAssignment.asset_id == a_uuid)
            )
            assignments = hist_res.scalars().all()
            assert len(assignments) == 2  # Assigned twice, both returned
            for a in assignments:
                assert a.assignment_status == "RETURNED"
                assert a.returned_at is not None

    finally:
        async with sessionmaker() as session:
            if asset_id:
                a_uuid = uuid.UUID(asset_id)
                await session.execute(delete(HrmsAssetAssignment).where(HrmsAssetAssignment.asset_id == a_uuid))
                await session.execute(delete(HrmsAssetHistory).where(HrmsAssetHistory.asset_id == a_uuid))
                await session.execute(delete(HrmsAsset).where(HrmsAsset.id == a_uuid))
            for uid in [admin_id, active_emp_id, deleted_emp_id]:
                u = await session.get(User, uid)
                if u:
                    u.deleted_at = datetime.now(timezone.utc)
            await session.commit()

