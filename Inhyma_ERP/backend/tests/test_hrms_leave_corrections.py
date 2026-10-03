"""
Tests for HRMS Leave and Attendance Corrections.
Validates:
- Scenario A: Admin can create and approve/reject their own leave request without error.
- Scenario B: Regular employee cannot approve own or others' requests.
- Scenario E & F: Configurable consecutive days limit (not hardcoded to 3).
- Scenario G & H: Holiday automatically appears in Attendance calendar with priority over Absent/Missing Punch; no regularize button.
- Scenario I: Approved leave displays on Attendance calendar with priority over Absent; no regularize button.
- Scenario K: Standalone Leave Type is directly usable without requiring Leave Plans.
"""

import uuid
from datetime import date, timedelta
import pytest
from httpx import AsyncClient
from sqlalchemy import select, delete

from app.auth.security import create_access_token
from app.database.engine import get_sessionmaker
from app.hrms.models import HrmsHoliday, HrmsLeaveRequest, HrmsLeaveType
from app.users.models import User, UserStatus


@pytest.mark.asyncio
async def test_admin_self_approval_and_scenarios(client: AsyncClient):
    sessionmaker = get_sessionmaker()

    # 1. Ensure Admin User exists
    admin_id = uuid.uuid4()
    async with sessionmaker() as session:
        admin_user = User(
            id=admin_id,
            email=f"admin.{uuid.uuid4().hex[:6]}@inhyma.com",
            username=f"admin_{uuid.uuid4().hex[:4]}",
            first_name="Super",
            last_name="Admin",
            password_hash="mock_hash",
            is_active=True,
            status=UserStatus.ACTIVE,
        )
        session.add(admin_user)
        await session.commit()

    admin_token = create_access_token(admin_id, permissions=["*"]).token
    admin_headers = {"Authorization": f"Bearer {admin_token}"}

    # 2. Create Regular Employee
    emp_id = uuid.uuid4()
    async with sessionmaker() as session:
        emp_user = User(
            id=emp_id,
            email=f"emp.{uuid.uuid4().hex[:6]}@inhyma.com",
            username=f"emp_{uuid.uuid4().hex[:4]}",
            first_name="Regular",
            last_name="Employee",
            password_hash="mock_hash",
            is_active=True,
            status=UserStatus.ACTIVE,
        )
        session.add(emp_user)
        await session.commit()

    emp_token = create_access_token(emp_id, permissions=[]).token
    emp_headers = {"Authorization": f"Bearer {emp_token}"}

    # -------------------------------------------------------------------------
    # Scenario E & F: Configurable consecutive days limit
    # -------------------------------------------------------------------------
    lt_payload = {
        "name": f"Configurable Test Leave {uuid.uuid4().hex[:6]}",
        "code": "CTL",
        "leave_type": "REGULAR",
        "is_paid": False,  # Unpaid so balance checks don't block
        "annual_balance": 30.0,
        "max_consecutive_days": 5,
        "is_active": True,
    }
    lt_res = await client.post("/api/v1/hrms/leave/types", json=lt_payload, headers=admin_headers)
    assert lt_res.status_code == 201, lt_res.text
    lt_data = lt_res.json()["data"]
    lt_id = lt_data["id"]

    # 5-day request -> Allowed
    req_5days = {
        "leave_type_id": lt_id,
        "from_date": "2026-08-03",  # Monday
        "to_date": "2026-08-07",    # Friday (5 calendar days)
        "reason": "5 days test",
    }
    res_5days = await client.post("/api/v1/hrms/leave/requests", json=req_5days, headers=emp_headers)
    assert res_5days.status_code == 201, res_5days.text

    # 6-day request -> Blocked with max consecutive days message
    req_6days = {
        "leave_type_id": lt_id,
        "from_date": "2026-08-10",  # Monday
        "to_date": "2026-08-15",    # Saturday (6 days)
        "reason": "6 days test",
    }
    res_6days = await client.post("/api/v1/hrms/leave/requests", json=req_6days, headers=emp_headers)
    assert res_6days.status_code == 400
    assert "consecutive days are allowed" in res_6days.text

    # Update Leave Type to max_consecutive_days = 10
    update_res = await client.put(
        f"/api/v1/hrms/leave/types/{lt_id}",
        json={"max_consecutive_days": 10},
        headers=admin_headers,
    )
    assert update_res.status_code == 200, update_res.text

    # Now 6-day request -> Allowed! (Proves consecutive limit is configurable, not hardcoded 3)
    res_6days_retry = await client.post("/api/v1/hrms/leave/requests", json=req_6days, headers=emp_headers)
    assert res_6days_retry.status_code == 201, res_6days_retry.text

    # -------------------------------------------------------------------------
    # Scenario A: Admin creates own leave and self-approves
    # -------------------------------------------------------------------------
    admin_req_payload = {
        "leave_type_id": lt_id,
        "from_date": "2026-08-24",
        "to_date": "2026-08-25",
        "reason": "Admin personal leave",
    }
    admin_create_res = await client.post(
        "/api/v1/hrms/leave/requests", json=admin_req_payload, headers=admin_headers
    )
    assert admin_create_res.status_code == 201, admin_create_res.text
    admin_req = admin_create_res.json()["data"]
    admin_req_id = admin_req["id"]
    assert admin_req["approval_status"] == "PENDING"
    assert admin_req["employee_id"] == str(admin_id)

    # Admin opens approval queue -> sees own request
    approvals_res = await client.get("/api/v1/hrms/leave/approvals", headers=admin_headers)
    assert approvals_res.status_code == 200
    approvals_data = approvals_res.json()["data"]
    assert any(a["id"] == admin_req_id for a in approvals_data)

    # Admin APPROVES own request -> MUST WORK (No 'Employees cannot approve their own leave request' error)
    admin_approve_res = await client.patch(
        f"/api/v1/hrms/leave/approvals/{admin_req_id}/approve",
        json={"approval_remarks": "Self-approved by Administrator"},
        headers=admin_headers,
    )
    assert admin_approve_res.status_code == 200, admin_approve_res.text
    assert admin_approve_res.json()["data"]["approval_status"] == "APPROVED"

    # -------------------------------------------------------------------------
    # Scenario B: Regular employee cannot approve own leave request
    # -------------------------------------------------------------------------
    emp_self_approve = await client.patch(
        f"/api/v1/hrms/leave/approvals/{res_5days.json()['data']['id']}/approve",
        json={"approval_remarks": "Employee trying self-approval"},
        headers=emp_headers,
    )
    assert emp_self_approve.status_code == 400
    assert "cannot approve their own" in emp_self_approve.text.lower()

    # -------------------------------------------------------------------------
    # Scenario G & H: Holiday integration in Attendance Calendar
    # -------------------------------------------------------------------------
    test_hol_date = "2026-09-18"
    hol_payload = {
        "name": "Founders Day Holiday",
        "holiday_date": test_hol_date,
        "number_of_days": 1,
        "branch_applicability": "All Branches",
        "is_active": True,
    }
    hol_create_res = await client.post("/api/v1/hrms/leave/holidays", json=hol_payload, headers=admin_headers)
    assert hol_create_res.status_code == 201, hol_create_res.text
    hol_id = hol_create_res.json()["data"]["id"]

    # Open Attendance Calendar for September 2026
    cal_res = await client.get(
        f"/api/v1/hrms/attendance/calendar?employee_id={emp_id}&year=2026&month=9",
        headers=admin_headers,
    )
    assert cal_res.status_code == 200, cal_res.text
    cal_days = cal_res.json()["data"]
    hol_day = next((d for d in cal_days if d["date"] == test_hol_date), None)
    assert hol_day is not None
    # Priority 1: HOLIDAY badge, holiday_name present, can_regularize is False
    assert hol_day["status"] == "HOLIDAY"
    assert hol_day["holiday_name"] == "Founders Day Holiday"
    assert hol_day["can_regularize"] is False

    # Deactivate / delete holiday
    del_hol_res = await client.delete(f"/api/v1/hrms/leave/holidays/{hol_id}", headers=admin_headers)
    assert del_hol_res.status_code == 200

    # Refresh Attendance Calendar -> Date returns to standard calculation
    cal_res2 = await client.get(
        f"/api/v1/hrms/attendance/calendar?employee_id={emp_id}&year=2026&month=9",
        headers=admin_headers,
    )
    assert cal_res2.status_code == 200
    hol_day_reverted = next(d for d in cal_res2.json()["data"] if d["date"] == test_hol_date)
    assert hol_day_reverted["status"] != "HOLIDAY"

    # -------------------------------------------------------------------------
    # Scenario I: Approved Leave on Attendance Calendar
    # -------------------------------------------------------------------------
    # The admin leave was approved for 2026-08-24 & 2026-08-25
    cal_admin_aug = await client.get(
        f"/api/v1/hrms/attendance/calendar?employee_id={admin_id}&year=2026&month=8",
        headers=admin_headers,
    )
    assert cal_admin_aug.status_code == 200
    aug_days = cal_admin_aug.json()["data"]
    leave_day = next(d for d in aug_days if d["date"] == "2026-08-24")
    assert leave_day["status"] == "LEAVE"
    assert leave_day["leave_type_name"] == lt_payload["name"]
    assert leave_day["can_regularize"] is False
