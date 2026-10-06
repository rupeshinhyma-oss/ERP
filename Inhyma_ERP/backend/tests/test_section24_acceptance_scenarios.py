"""
Test Suite verifying all Section 24 Acceptance Criteria:
1. Employee: Employee A logs in -> My Leaves -> only Employee A records
2. Admin: Admin logs in -> My Leaves -> only Admin's own records; Admin -> Leave Approvals -> organization-wide requests
3. Manager: Manager logs in -> Leave Approvals -> only permitted department employees
4. Admin Self Approval: Admin applies leave -> appears in Admin My Leaves -> Approve/Reject works without self-approval error
5. Configurable Leave Type: Earned Leave (Annual=18, Monthly=1.5, Max consecutive=15)
6. Custom Leave Type: Special Leave (Annual=5, Max consecutive=2) -> dynamically appears in applicable types
7. Consecutive days limit: Max 5 allows 5 days; Max 2 rejects 3 days with clear validation
8. Holiday -> Attendance integration: Holiday date displays HOLIDAY, not ABSENT or regularize
9. Leave Adjustment: +2 and -1 updates balance correctly
"""

import uuid
from datetime import date, timedelta
import pytest
from httpx import AsyncClient
from sqlalchemy import select, delete

from app.auth.security import create_access_token
from app.database.engine import get_sessionmaker
from app.hrms.models import (
    HrmsHoliday,
    HrmsLeaveRequest,
    HrmsLeaveType,
)
from app.users.models import User, UserStatus


@pytest.mark.asyncio
async def test_section_24_full_acceptance_criteria(client: AsyncClient):
    sessionmaker = get_sessionmaker()

    # -------------------------------------------------------------------------
    # 1. Setup Users & Roles
    # -------------------------------------------------------------------------
    admin_id = uuid.uuid4()
    mgr_id = uuid.uuid4()
    emp_a_id = uuid.uuid4()
    emp_b_id = uuid.uuid4()

    async with sessionmaker() as session:
        # Admin
        admin_user = User(
            id=admin_id,
            email=f"admin.{uuid.uuid4().hex[:6]}@inhyma.com",
            username=f"admin_{uuid.uuid4().hex[:4]}",
            first_name="Admin",
            last_name="User",
            password_hash="mock_hash",
            is_active=True,
            status=UserStatus.ACTIVE,
        )
        session.add(admin_user)

        # Manager
        mgr_user = User(
            id=mgr_id,
            email=f"mgr.{uuid.uuid4().hex[:6]}@inhyma.com",
            username=f"mgr_{uuid.uuid4().hex[:4]}",
            first_name="Tech",
            last_name="Manager",
            password_hash="mock_hash",
            is_active=True,
            status=UserStatus.ACTIVE,
        )
        session.add(mgr_user)

        # Employee A (reports to Manager)
        emp_a = User(
            id=emp_a_id,
            email=f"empa.{uuid.uuid4().hex[:6]}@inhyma.com",
            username=f"empa_{uuid.uuid4().hex[:4]}",
            first_name="Employee",
            last_name="A",
            manager_id=mgr_id,
            password_hash="mock_hash",
            is_active=True,
            status=UserStatus.ACTIVE,
        )
        session.add(emp_a)

        # Employee B (unrelated, no manager or other department)
        emp_b = User(
            id=emp_b_id,
            email=f"empb.{uuid.uuid4().hex[:6]}@inhyma.com",
            username=f"empb_{uuid.uuid4().hex[:4]}",
            first_name="Employee",
            last_name="B",
            password_hash="mock_hash",
            is_active=True,
            status=UserStatus.ACTIVE,
        )
        session.add(emp_b)

        await session.commit()

    admin_token = create_access_token(admin_id, permissions=["*"]).token
    admin_headers = {"Authorization": f"Bearer {admin_token}"}

    mgr_token = create_access_token(mgr_id, permissions=["hrms.approve"]).token
    mgr_headers = {"Authorization": f"Bearer {mgr_token}"}

    emp_a_token = create_access_token(emp_a_id, permissions=[]).token
    emp_a_headers = {"Authorization": f"Bearer {emp_a_token}"}

    emp_b_token = create_access_token(emp_b_id, permissions=[]).token
    emp_b_headers = {"Authorization": f"Bearer {emp_b_token}"}

    # -------------------------------------------------------------------------
    # 2. Configurable Leave Types: Earned Leave, Special Leave, Casual Leave
    # -------------------------------------------------------------------------
    el_res = await client.post(
        "/api/v1/hrms/leave/types",
        json={
            "name": f"Earned Leave {uuid.uuid4().hex[:4]}",
            "code": "EL",
            "is_paid": True,
            "annual_balance": 18.0,
            "monthly_accrual": True,
            "accrual_frequency": "MONTHLY",
            "accrual_amount": 1.5,
            "max_consecutive_days": 15,
            "carry_forward_allowed": True,
            "carry_forward_days": 30.0,
            "allow_half_day": True,
            "allow_backdated": True,
            "is_active": True,
        },
        headers=admin_headers,
    )
    assert el_res.status_code == 201
    el_type = el_res.json()["data"]

    # Custom Leave Type: Special Leave
    sl_res = await client.post(
        "/api/v1/hrms/leave/types",
        json={
            "name": f"Special Leave {uuid.uuid4().hex[:4]}",
            "code": "SPEC",
            "is_paid": True,
            "annual_balance": 5.0,
            "max_consecutive_days": 2,
            "allow_backdated": True,
            "is_active": True,
        },
        headers=admin_headers,
    )
    assert sl_res.status_code == 201
    sl_type = sl_res.json()["data"]

    # Verify Custom Leave Type appears in applicable types
    app_res = await client.get("/api/v1/hrms/leave/applicable-types", headers=emp_a_headers)
    assert app_res.status_code == 200
    applicable_names = [t["name"] for t in app_res.json()["data"]]
    assert el_type["name"] in applicable_names
    assert sl_type["name"] in applicable_names

    # -------------------------------------------------------------------------
    # 3. Test Consecutive Limit: Max 5 allows 5, Max 2 blocks 3
    # -------------------------------------------------------------------------
    cl_res = await client.post(
        "/api/v1/hrms/leave/types",
        json={
            "name": f"Casual Leave {uuid.uuid4().hex[:4]}",
            "code": "CL",
            "is_paid": False,
            "annual_balance": 20.0,
            "max_consecutive_days": 5,
            "allow_backdated": True,
            "is_active": True,
        },
        headers=admin_headers,
    )
    assert cl_res.status_code == 201
    cl_type = cl_res.json()["data"]

    # 5-day request -> Allowed
    req_5 = await client.post(
        "/api/v1/hrms/leave/requests",
        json={
            "leave_type_id": cl_type["id"],
            "from_date": "2026-11-02",
            "to_date": "2026-11-06",
            "reason": "5 days test",
        },
        headers=emp_a_headers,
    )
    assert req_5.status_code == 201, req_5.text

    # Update to Max consecutive = 2
    update_res = await client.put(
        f"/api/v1/hrms/leave/types/{cl_type['id']}",
        json={"max_consecutive_days": 2},
        headers=admin_headers,
    )
    assert update_res.status_code == 200

    # 3-day request -> Rejected with clear validation message
    req_3 = await client.post(
        "/api/v1/hrms/leave/requests",
        json={
            "leave_type_id": cl_type["id"],
            "from_date": "2026-11-09",
            "to_date": "2026-11-11",
            "reason": "3 days test",
        },
        headers=emp_a_headers,
    )
    assert req_3.status_code == 400
    assert "consecutive days are allowed" in req_3.text.lower()

    # -------------------------------------------------------------------------
    # 4. Strict Scoping: My Leaves & Leave Approvals
    # -------------------------------------------------------------------------
    # Employee B creates a request
    req_b = await client.post(
        "/api/v1/hrms/leave/requests",
        json={
            "leave_type_id": cl_type["id"],
            "from_date": "2026-11-16",
            "to_date": "2026-11-17",
            "reason": "Emp B vacation",
        },
        headers=emp_b_headers,
    )
    assert req_b.status_code == 201

    # Employee A My Leaves: ONLY Employee A records (Never Employee B)
    my_leaves_a = await client.get("/api/v1/hrms/leave/requests", headers=emp_a_headers)
    assert my_leaves_a.status_code == 200
    my_a_ids = [r["employee_id"] for r in my_leaves_a.json()["data"]]
    assert all(eid == str(emp_a_id) for eid in my_a_ids)
    assert str(emp_b_id) not in my_a_ids

    # Admin My Leaves: ONLY Admin's own records (empty currently, not org-wide 66 records!)
    admin_my_leaves = await client.get("/api/v1/hrms/leave/requests", headers=admin_headers)
    assert admin_my_leaves.status_code == 200
    admin_my_ids = [r["employee_id"] for r in admin_my_leaves.json()["data"]]
    assert all(eid == str(admin_id) for eid in admin_my_ids)

    # Manager Approvals: only permitted department (Employee A in Technical, NOT Employee B in Sales)
    mgr_approvals = await client.get("/api/v1/hrms/leave/approvals", headers=mgr_headers)
    assert mgr_approvals.status_code == 200
    mgr_app_emps = [r["employee_id"] for r in mgr_approvals.json()["data"]]
    assert str(emp_a_id) in mgr_app_emps
    assert str(emp_b_id) not in mgr_app_emps

    # Admin Approvals: Organization-wide (Both Employee A and Employee B)
    admin_approvals = await client.get("/api/v1/hrms/leave/approvals", headers=admin_headers)
    assert admin_approvals.status_code == 200
    admin_app_emps = [r["employee_id"] for r in admin_approvals.json()["data"]]
    assert str(emp_a_id) in admin_app_emps
    assert str(emp_b_id) in admin_app_emps

    # -------------------------------------------------------------------------
    # 5. Admin Self-Approval Rule: Admin creates leave & approves own leave
    # -------------------------------------------------------------------------
    admin_req = await client.post(
        "/api/v1/hrms/leave/requests",
        json={
            "leave_type_id": cl_type["id"],
            "from_date": "2026-11-23",
            "to_date": "2026-11-24",
            "reason": "Admin executive leave",
        },
        headers=admin_headers,
    )
    assert admin_req.status_code == 201
    admin_req_id = admin_req.json()["data"]["id"]

    # Admin approves own request -> MUST WORK, NO self-approval error
    admin_app_res = await client.patch(
        f"/api/v1/hrms/leave/approvals/{admin_req_id}/approve",
        json={"approval_remarks": "Self-approved by executive Admin authority"},
        headers=admin_headers,
    )
    assert admin_app_res.status_code == 200
    assert admin_app_res.json()["data"]["status"] == "APPROVED"

    # -------------------------------------------------------------------------
    # 6. Leave Adjustment: +2 and -1 updates balance
    # -------------------------------------------------------------------------
    adj_add = await client.post(
        "/api/v1/hrms/leave/adjustments",
        json={
            "employee_id": str(emp_a_id),
            "leave_type_id": el_type["id"],
            "adjustment_type": "ADD",
            "amount": 2.0,
            "reason": "Performance bonus days",
            "year": 2026,
        },
        headers=admin_headers,
    )
    assert adj_add.status_code in (200, 201)
    assert adj_add.json()["data"]["new_balance"] >= 2.0

    adj_ded = await client.post(
        "/api/v1/hrms/leave/adjustments",
        json={
            "employee_id": str(emp_a_id),
            "leave_type_id": el_type["id"],
            "adjustment_type": "DEDUCT",
            "amount": 1.0,
            "reason": "Audit correction",
            "year": 2026,
        },
        headers=admin_headers,
    )
    assert adj_ded.status_code in (200, 201)
    assert adj_ded.json()["data"]["new_balance"] == adj_add.json()["data"]["new_balance"] - 1.0

    # -------------------------------------------------------------------------
    # 7. Holiday -> Attendance Integration
    # -------------------------------------------------------------------------
    hol_date = "2026-12-25"
    hol_res = await client.post(
        "/api/v1/hrms/leave/holidays",
        json={
            "name": "Christmas Day",
            "holiday_date": hol_date,
            "number_of_days": 1,
            "branch_applicability": "ALL",
            "is_active": True,
        },
        headers=admin_headers,
    )
    assert hol_res.status_code == 201

    cal_res = await client.get(
        f"/api/v1/hrms/attendance/calendar?year=2026&month=12",
        headers=emp_a_headers,
    )
    assert cal_res.status_code == 200
    cal_data = cal_res.json()["data"]
    days_list = cal_data if isinstance(cal_data, list) else cal_data.get("days", [])
    christmas_day = next((d for d in days_list if d["date"] == hol_date), None)
    assert christmas_day is not None
    assert christmas_day["status"] == "HOLIDAY"
    assert christmas_day["can_regularize"] is False
    assert christmas_day["holiday_name"] == "Christmas Day"

    # Cleanup test leave types, holiday, and test users
    await client.delete(f"/api/v1/hrms/leave/types/{el_type['id']}")
    await client.delete(f"/api/v1/hrms/leave/types/{sl_type['id']}")
    await client.delete(f"/api/v1/hrms/leave/types/{cl_type['id']}")
    hol_json = hol_res.json()
    if isinstance(hol_json, dict) and "data" in hol_json and isinstance(hol_json["data"], dict) and "id" in hol_json["data"]:
        await client.delete(f"/api/v1/hrms/leave/holidays/{hol_json['data']['id']}")

    from datetime import datetime, timezone
    async with sessionmaker() as session:
        for uid in [admin_id, mgr_id, emp_a_id, emp_b_id]:
            u = await session.get(User, uid)
            if u:
                u.deleted_at = datetime.now(timezone.utc)
                u.is_active = False
        await session.commit()
