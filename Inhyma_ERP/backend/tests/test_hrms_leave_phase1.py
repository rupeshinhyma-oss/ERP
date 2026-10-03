"""
HRMS Leave Management Phase 1 Tests.

Validates:
1. Leave type creation
2. Leave plan creation
3. Holiday creation
4. Employee balance calculation
5. Positive adjustment
6. Negative adjustment
7. Adjustment audit history
8. Leave request creation
9. Duplicate/overlap validation
10. Approval
11. Rejection
12. Approved leave balance consumption
13. Rejected leave balance unchanged
14. Cancelled approved leave balance restoration
"""

import uuid
from datetime import date, timedelta
import pytest
from httpx import AsyncClient
from sqlalchemy import delete, select

from app.database.engine import get_sessionmaker
from app.hrms.models import HrmsLeaveRequest, HrmsLeaveAdjustment
from app.users.models import User


@pytest.mark.asyncio
async def test_hrms_leave_phase1_full_workflow(client: AsyncClient):
    # -----------------------------------------------------------------------
    # 1. Leave type creation
    # -----------------------------------------------------------------------
    lt_payload = {
        "name": f"Paternity Pilot Leave {uuid.uuid4().hex[:6]}",
        "code": "PPL",
        "leave_type": "REGULAR",
        "is_paid": True,
        "annual_balance": 10.0,
        "carry_forward_allowed": True,
        "carry_forward_days": 5.0,
        "max_consecutive_days": 5,
        "monthly_accrual": False,
        "is_active": True,
    }
    lt_res = await client.post("/api/v1/hrms/leave/types", json=lt_payload)
    assert lt_res.status_code == 201, lt_res.text
    created_lt = lt_res.json()["data"]
    lt_id = created_lt["id"]
    assert created_lt["name"] == lt_payload["name"]
    assert created_lt["carry_forward_allowed"] is True

    # Verify listing includes the 8 seed types + the new type
    types_list_res = await client.get("/api/v1/hrms/leave/types")
    assert types_list_res.status_code == 200
    all_names = [t["name"] for t in types_list_res.json()["data"]]
    assert "Casual Leave" in all_names
    assert "Sick Leave" in all_names
    assert "Earned Leave" in all_names
    assert "Leave Without Pay" in all_names
    assert "Maternity Leave" in all_names
    assert "Paternity Leave" in all_names
    assert "Sabbatical Leave" in all_names
    assert "Compensatory Off" in all_names

    # -----------------------------------------------------------------------
    # 2. Leave plan creation
    # -----------------------------------------------------------------------
    plan_payload = {
        "name": "Thane Technical Leave Plan 2026",
        "effective_from": "2026-01-01",
        "effective_to": "2026-12-31",
        "branch": "Thane",
        "department": "Technical",
        "leave_type_ids": [lt_id],
        "is_active": True,
    }
    plan_res = await client.post("/api/v1/hrms/leave/plans", json=plan_payload)
    assert plan_res.status_code == 201, plan_res.text
    created_plan = plan_res.json()["data"]
    plan_id = created_plan["id"]
    assert created_plan["name"] == "Thane Technical Leave Plan 2026"
    assert created_plan["branch"] == "Thane"
    assert lt_id in created_plan["leave_type_ids"]

    # -----------------------------------------------------------------------
    # 3. Holiday creation
    # -----------------------------------------------------------------------
    holiday_payload = {
        "name": f"Regional Festival {uuid.uuid4().hex[:6]}",
        "holiday_date": "2026-11-15",
        "number_of_days": 1,
        "branch_applicability": "Thane",
        "is_active": True,
    }
    hol_res = await client.post("/api/v1/hrms/leave/holidays", json=holiday_payload)
    assert hol_res.status_code == 201, hol_res.text
    created_hol = hol_res.json()["data"]
    assert created_hol["name"] == holiday_payload["name"]
    assert created_hol["branch_applicability"] == "Thane"

    # Branch-specific filtering
    hol_filter_res = await client.get("/api/v1/hrms/leave/holidays?branch=Thane")
    assert hol_filter_res.status_code == 200
    assert any(h["id"] == created_hol["id"] for h in hol_filter_res.json()["data"])

    # -----------------------------------------------------------------------
    # 4. Employee balance calculation
    # -----------------------------------------------------------------------
    bal_res = await client.get("/api/v1/hrms/leave/balances?year=2026")
    assert bal_res.status_code == 200, bal_res.text
    balances = bal_res.json()["data"]
    assert len(balances) > 0
    emp_id = balances[0]["employee_id"]

    # Clean up prior test requests for emp_id to guarantee deterministic test execution
    sessionmaker = get_sessionmaker()
    async with sessionmaker() as session:
        await session.execute(delete(HrmsLeaveRequest).where(HrmsLeaveRequest.employee_id == emp_id))
        await session.commit()

    # Re-fetch balances after cleanup
    bal_res = await client.get(f"/api/v1/hrms/leave/balances?employee_id={emp_id}&year=2026")
    balances = bal_res.json()["data"]

    # Balance formula check: available = allocated + adjusted - consumed
    for b in balances:
        expected_available = round(b["allocated"] + b["adjusted"] - b["consumed"], 2)
        assert b["available"] == expected_available

    target_bal = next(b for b in balances if b["leave_type_name"] == "Casual Leave")
    target_lt_id = target_bal["leave_type_id"]
    cur_avail = target_bal["available"]
    cur_consumed = target_bal["consumed"]

    # -----------------------------------------------------------------------
    # 5. Positive adjustment
    # -----------------------------------------------------------------------
    pos_adj_payload = {
        "employee_id": emp_id,
        "leave_type_id": target_lt_id,
        "adjustment_type": "ADD",
        "amount": 2.0,
        "reason": "Prior year carry forward credits",
        "year": 2026,
    }
    pos_res = await client.post("/api/v1/hrms/leave/adjustments", json=pos_adj_payload)
    assert pos_res.status_code == 201, pos_res.text
    pos_data = pos_res.json()["data"]
    assert pos_data["adjustment_type"] == "ADD"
    assert pos_data["amount"] == 2.0
    assert pos_data["previous_balance"] == cur_avail
    assert pos_data["new_balance"] == round(cur_avail + 2.0, 2)

    # Check updated balance
    bal_res2 = await client.get(f"/api/v1/hrms/leave/balances?employee_id={emp_id}&year=2026")
    updated_bal = next(b for b in bal_res2.json()["data"] if b["leave_type_id"] == target_lt_id)
    assert updated_bal["available"] == round(cur_avail + 2.0, 2)

    # -----------------------------------------------------------------------
    # 6. Negative adjustment
    # -----------------------------------------------------------------------
    neg_adj_payload = {
        "employee_id": emp_id,
        "leave_type_id": target_lt_id,
        "adjustment_type": "DEDUCT",
        "amount": 1.0,
        "reason": "Administrative quota deduction",
        "year": 2026,
    }
    neg_res = await client.post("/api/v1/hrms/leave/adjustments", json=neg_adj_payload)
    assert neg_res.status_code == 201, neg_res.text
    neg_data = neg_res.json()["data"]
    assert neg_data["adjustment_type"] == "DEDUCT"
    assert neg_data["amount"] == -1.0
    assert neg_data["previous_balance"] == round(cur_avail + 2.0, 2)
    assert neg_data["new_balance"] == round(cur_avail + 1.0, 2)

    # -----------------------------------------------------------------------
    # 7. Adjustment audit history
    # -----------------------------------------------------------------------
    hist_res = await client.get(
        f"/api/v1/hrms/leave/adjustments/history?employee_id={emp_id}&leave_type_id={target_lt_id}"
    )
    assert hist_res.status_code == 200, hist_res.text
    history = hist_res.json()["data"]
    assert len(history) >= 2
    reasons = [h["reason"] for h in history]
    assert "Prior year carry forward credits" in reasons
    assert "Administrative quota deduction" in reasons

    # -----------------------------------------------------------------------
    # 8. Leave request creation
    # -----------------------------------------------------------------------
    base_monday = date(2026, 6, 1)
    day_tuesday = date(2026, 6, 2)
    day_wednesday = date(2026, 6, 3)

    req_payload = {
        "leave_type_id": target_lt_id,
        "from_date": base_monday.isoformat(),
        "to_date": day_tuesday.isoformat(),
        "reason": "Family event and personal matters",
    }
    req_res = await client.post(f"/api/v1/hrms/leave/requests?employee_id={emp_id}", json=req_payload)
    assert req_res.status_code == 201, req_res.text
    req_data = req_res.json()["data"]
    req_id = req_data["id"]
    assert req_data["status"] == "PENDING"
    assert req_data["approval_status"] == "PENDING"
    assert req_data["number_of_days"] == 2.0

    # Ensure pending request does NOT deduct consumed balance yet (Rule H)
    bal_res3 = await client.get(f"/api/v1/hrms/leave/balances?employee_id={emp_id}&year=2026")
    bal_after_pending = next(b for b in bal_res3.json()["data"] if b["leave_type_id"] == target_lt_id)
    assert bal_after_pending["consumed"] == cur_consumed
    assert bal_after_pending["available"] == round(cur_avail + 1.0, 2)

    # -----------------------------------------------------------------------
    # 9. Duplicate/overlap validation
    # -----------------------------------------------------------------------
    overlap_payload = {
        "leave_type_id": target_lt_id,
        "from_date": day_tuesday.isoformat(),
        "to_date": day_wednesday.isoformat(),
        "reason": "Conflicting application",
    }
    overlap_res = await client.post(f"/api/v1/hrms/leave/requests?employee_id={emp_id}", json=overlap_payload)
    assert overlap_res.status_code == 400
    err_msg = overlap_res.json().get("message") or overlap_res.json().get("detail", "")
    assert "overlapping" in err_msg.lower()

    # -----------------------------------------------------------------------
    # 10. Self-approval rule (Admin CAN self-approve; regular employee CANNOT)
    # -----------------------------------------------------------------------
    # Create regular non-admin employee
    from app.users.models import UserStatus
    non_admin_id = uuid.uuid4()
    async with sessionmaker() as session:
        non_admin_emp = User(
            id=non_admin_id,
            email=f"employee.{uuid.uuid4().hex[:6]}@inhyma.com",
            first_name="Regular",
            last_name="Employee",
            password_hash="mock_hash",
            is_active=True,
            status=UserStatus.ACTIVE,
        )
        session.add(non_admin_emp)
        await session.commit()

    # Create request for regular employee
    non_admin_req_res = await client.post(
        f"/api/v1/hrms/leave/requests?employee_id={non_admin_id}",
        json={
            "leave_type_id": target_lt_id,
            "from_date": "2026-07-20",
            "to_date": "2026-07-21",
            "reason": "Regular employee leave",
        },
    )
    assert non_admin_req_res.status_code == 201
    non_admin_req_id = non_admin_req_res.json()["data"]["id"]

    # Regular employee self-approval is blocked with 400
    self_app_res = await client.patch(
        f"/api/v1/hrms/leave/approvals/{non_admin_req_id}/approve?reviewer_id={non_admin_id}",
        json={"approval_remarks": "Self approval attempt by regular employee"},
    )
    assert self_app_res.status_code == 400
    self_msg = self_app_res.json().get("message") or self_app_res.json().get("detail", "")
    assert "cannot approve their own" in self_msg.lower()

    # Admin self-approval succeeds for admin's own request (Critical Requirement 1)
    admin_self_app_res = await client.patch(
        f"/api/v1/hrms/leave/approvals/{req_id}/approve?reviewer_id={emp_id}",
        json={"approval_remarks": "Approved by admin for self."},
    )
    assert admin_self_app_res.status_code == 200, admin_self_app_res.text
    assert admin_self_app_res.json()["data"]["approval_status"] == "APPROVED"

    # 12. Approved leave balance consumption
    bal_res_app = await client.get(f"/api/v1/hrms/leave/balances?employee_id={emp_id}&year=2026")
    bal_after_app = next(b for b in bal_res_app.json()["data"] if b["leave_type_id"] == target_lt_id)
    assert bal_after_app["consumed"] == round(cur_consumed + 2.0, 2)
    assert bal_after_app["available"] == round(cur_avail - 1.0, 2)

    # -----------------------------------------------------------------------
    # 11 & 13. Rejection & balance unchanged
    # -----------------------------------------------------------------------
    other_monday = date(2026, 7, 6)
    other_tuesday = date(2026, 7, 7)
    req2_payload = {
        "leave_type_id": target_lt_id,
        "from_date": other_monday.isoformat(),
        "to_date": other_tuesday.isoformat(),
        "reason": "Second request for rejection test",
    }
    req2_res = await client.post(f"/api/v1/hrms/leave/requests?employee_id={emp_id}", json=req2_payload)
    assert req2_res.status_code == 201
    req2_id = req2_res.json()["data"]["id"]

    # 11. Rejection (Admin can reject request)
    reject_res = await client.patch(
        f"/api/v1/hrms/leave/approvals/{req2_id}/reject?reviewer_id={emp_id}",
        json={"approval_remarks": "Critical client release scheduled."},
    )
    assert reject_res.status_code == 200
    assert reject_res.json()["data"]["approval_status"] == "REJECTED"

    # 13. Rejected leave balance unchanged
    bal_res4 = await client.get(f"/api/v1/hrms/leave/balances?employee_id={emp_id}&year=2026")
    bal_after_rejection = next(b for b in bal_res4.json()["data"] if b["leave_type_id"] == target_lt_id)
    assert bal_after_rejection["consumed"] == round(cur_consumed + 2.0, 2)
    assert bal_after_rejection["available"] == round(cur_avail - 1.0, 2)

    # -----------------------------------------------------------------------
    # 14. Cancelled approved leave balance restoration
    # -----------------------------------------------------------------------
    cancel_res = await client.patch(f"/api/v1/hrms/leave/requests/{req_id}/cancel")
    assert cancel_res.status_code == 200
    assert cancel_res.json()["data"]["status"] == "CANCELLED"

    # Verify balance was restored
    bal_res5 = await client.get(f"/api/v1/hrms/leave/balances?employee_id={emp_id}&year=2026")
    bal_after_cancel = next(b for b in bal_res5.json()["data"] if b["leave_type_id"] == target_lt_id)
    assert bal_after_cancel["consumed"] == cur_consumed
    assert bal_after_cancel["available"] == round(cur_avail + 1.0, 2)
