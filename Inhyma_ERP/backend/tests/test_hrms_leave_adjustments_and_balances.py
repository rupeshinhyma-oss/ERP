"""
Comprehensive backend tests for HRMS Leave Adjustment and Leave Balance.

Validates:
1. Real employees loaded from DB into adjustment matrix.
2. Role data visibility:
   - Admin sees all employees.
   - Manager sees only department / direct reports.
   - Employee sees only own balances and is forbidden from matrix/other employees' adjustments.
3. Leave balance calculation & automatic deduction upon approval.
4. Idempotent approval preventing double deductions.
5. Pending leaves rejected / cancelled do not deduct.
6. Reversal of approved leave restores balance with LEAVE_REVERSAL audit record.
7. Manual credit and debit with required reason and remarks.
8. Negative balance prevention unless allow_negative_balance is True.
9. Dynamic Leave Types appear in matrix.
"""

import uuid
from datetime import date, datetime, timedelta, timezone
import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.auth.security import create_access_token
from app.database.engine import get_sessionmaker
from app.hrms.models import (
    HrmsEmployeeLeaveBalance,
    HrmsLeaveAdjustment,
    HrmsLeaveRequest,
    HrmsLeaveType,
)
from app.users.models import User, UserStatus


@pytest.mark.asyncio
async def test_hrms_leave_adjustments_and_balances_comprehensive(client: AsyncClient):
    sessionmaker = get_sessionmaker()

    # 1. Setup Admin user
    admin_id = uuid.uuid4()
    async with sessionmaker() as session:
        admin_user = User(
            id=admin_id,
            email=f"admin.{uuid.uuid4().hex[:6]}@inhyma.com",
            username=f"admin_{uuid.uuid4().hex[:4]}",
            first_name="Admin",
            last_name="Supervisor",
            password_hash="mock_hash",
            is_active=True,
            status=UserStatus.ACTIVE,
        )
        session.add(admin_user)
        await session.commit()

    admin_token = create_access_token(admin_id, permissions=["*"]).token
    admin_headers = {"Authorization": f"Bearer {admin_token}"}

    # 2. Setup Manager user
    manager_id = uuid.uuid4()
    async with sessionmaker() as session:
        manager_user = User(
            id=manager_id,
            email=f"mgr.{uuid.uuid4().hex[:6]}@inhyma.com",
            username=f"mgr_{uuid.uuid4().hex[:4]}",
            first_name="Manager",
            last_name="Lead",
            password_hash="mock_hash",
            is_active=True,
            status=UserStatus.ACTIVE,
        )
        session.add(manager_user)
        await session.commit()

    manager_token = create_access_token(manager_id, permissions=["hrms.view", "hrms.manage"]).token
    manager_headers = {"Authorization": f"Bearer {manager_token}"}

    # 3. Setup Employee 1 (reports to manager) and Employee 2 (independent)
    emp1_id = uuid.uuid4()
    emp2_id = uuid.uuid4()
    async with sessionmaker() as session:
        emp1_user = User(
            id=emp1_id,
            email=f"emp1.{uuid.uuid4().hex[:6]}@inhyma.com",
            username=f"emp1_{uuid.uuid4().hex[:4]}",
            first_name="Alice",
            last_name="Report",
            employee_code=f"EMP-{uuid.uuid4().hex[:6].upper()}",
            manager_id=manager_id,
            password_hash="mock_hash",
            is_active=True,
            status=UserStatus.ACTIVE,
        )
        emp2_user = User(
            id=emp2_id,
            email=f"emp2.{uuid.uuid4().hex[:6]}@inhyma.com",
            username=f"emp2_{uuid.uuid4().hex[:4]}",
            first_name="Bob",
            last_name="Independent",
            employee_code=f"EMP-{uuid.uuid4().hex[:6].upper()}",
            password_hash="mock_hash",
            is_active=True,
            status=UserStatus.ACTIVE,
        )
        session.add_all([emp1_user, emp2_user])
        await session.commit()

    emp1_token = create_access_token(emp1_id, permissions=[]).token
    emp1_headers = {"Authorization": f"Bearer {emp1_token}"}
    emp2_token = create_access_token(emp2_id, permissions=[]).token
    emp2_headers = {"Authorization": f"Bearer {emp2_token}"}

    # 4. Create dynamic Leave Types via Admin
    # Leave Type 1: Strict (no negative balance)
    lt1_payload = {
        "name": f"Strict Casual Leave {uuid.uuid4().hex[:4]}",
        "code": f"SCL-{uuid.uuid4().hex[:3]}",
        "leave_type": "REGULAR",
        "is_paid": True,
        "annual_balance": 15.0,
        "allow_negative_balance": False,
        "is_active": True,
    }
    lt1_res = await client.post("/api/v1/hrms/leave/types", json=lt1_payload, headers=admin_headers)
    assert lt1_res.status_code == 201, lt1_res.text
    lt1_id = lt1_res.json()["data"]["id"]

    # Leave Type 2: Flexible (allows negative balance)
    lt2_payload = {
        "name": f"Flexible Sick Leave {uuid.uuid4().hex[:4]}",
        "code": f"FSL-{uuid.uuid4().hex[:3]}",
        "leave_type": "REGULAR",
        "is_paid": True,
        "annual_balance": 10.0,
        "allow_negative_balance": True,
        "is_active": True,
    }
    lt2_res = await client.post("/api/v1/hrms/leave/types", json=lt2_payload, headers=admin_headers)
    assert lt2_res.status_code == 201, lt2_res.text
    lt2_id = lt2_res.json()["data"]["id"]

    # =========================================================================
    # Test 1 & 2: Dynamic Matrix & Role-Based Visibility
    # =========================================================================
    # Admin sees matrix with both employees and columns for both leave types
    matrix_admin = await client.get("/api/v1/hrms/leave/adjustments/matrix", headers=admin_headers)
    assert matrix_admin.status_code == 200, matrix_admin.text
    admin_rows = matrix_admin.json()["data"]
    admin_emp_ids = [row["employee_id"] for row in admin_rows]
    assert str(emp1_id) in admin_emp_ids
    assert str(emp2_id) in admin_emp_ids

    # Dynamic leave type columns exist in each employee row balances
    emp1_row = next(r for r in admin_rows if r["employee_id"] == str(emp1_id))
    assert lt1_id in emp1_row["balances"]
    assert lt2_id in emp1_row["balances"]

    # Manager sees Alice (direct report) but NOT Bob (independent)
    matrix_mgr = await client.get("/api/v1/hrms/leave/adjustments/matrix", headers=manager_headers)
    assert matrix_mgr.status_code == 200, matrix_mgr.text
    mgr_rows = matrix_mgr.json()["data"]
    mgr_emp_ids = [row["employee_id"] for row in mgr_rows]
    assert str(emp1_id) in mgr_emp_ids
    assert str(emp2_id) not in mgr_emp_ids

    # Regular employee calling matrix is Forbidden (403)
    matrix_emp = await client.get("/api/v1/hrms/leave/adjustments/matrix", headers=emp1_headers)
    assert matrix_emp.status_code == 403

    # Regular employee querying other employee's adjustments is Forbidden (403)
    emp_adj_forbidden = await client.get(f"/api/v1/hrms/leave/adjustments/{emp2_id}", headers=emp1_headers)
    assert emp_adj_forbidden.status_code == 403

    # =========================================================================
    # Test 3 & 4: Manual Adjustments (Credit & Debit), Reason Required, Negative Balance Enforced
    # =========================================================================
    # Attempt manual adjustment WITHOUT reason -> should fail with 400
    no_reason_payload = {
        "employee_id": str(emp1_id),
        "leave_type_id": lt1_id,
        "adjustment_type": "ADD",
        "amount": 2.0,
        "reason": "   ",  # whitespace
        "remarks": "Missing reason",
    }
    no_reason_res = await client.post("/api/v1/hrms/leave/adjustments", json=no_reason_payload, headers=admin_headers)
    assert no_reason_res.status_code == 400
    assert "reason is required" in no_reason_res.text.lower()

    # Manual Credit +5 days to Alice on lt1
    credit_payload = {
        "employee_id": str(emp1_id),
        "leave_type_id": lt1_id,
        "adjustment_type": "ADD",
        "amount": 5.0,
        "reason": "Annual incentive credit",
        "remarks": "Approved by HR Director",
        "effective_date": "2026-10-01",
    }
    credit_res = await client.post("/api/v1/hrms/leave/adjustments", json=credit_payload, headers=admin_headers)
    assert credit_res.status_code == 201, credit_res.text
    credit_data = credit_res.json()["data"]
    assert credit_data["source"] == "MANUAL"
    assert credit_data["amount"] == 5.0

    # Verify Alice's balance for lt1: Allocated=15.0 + Adjusted=5.0 = Available=20.0
    bal_res = await client.get(f"/api/v1/hrms/leave/balances/{emp1_id}", headers=admin_headers)
    assert bal_res.status_code == 200, bal_res.text
    alice_bals = bal_res.json()["data"]
    lt1_bal = next(b for b in alice_bals if b["leave_type_id"] == lt1_id)
    assert lt1_bal["allocated"] == 15.0
    assert lt1_bal["adjusted"] == 5.0
    assert lt1_bal["consumed"] == 0.0
    assert lt1_bal["available"] == 20.0

    # Attempt Manual Debit exceeding available on Strict leave type (e.g. debit 25 days) -> 400
    excess_debit = {
        "employee_id": str(emp1_id),
        "leave_type_id": lt1_id,
        "adjustment_type": "DEDUCT",
        "amount": 25.0,
        "reason": "Excess deduction test",
    }
    excess_res = await client.post("/api/v1/hrms/leave/adjustments", json=excess_debit, headers=admin_headers)
    assert excess_res.status_code == 400
    assert "negative balance" in excess_res.text.lower()

    # Manual Debit on Flexible leave type (lt2) exceeding available (Available=10, Debit=15 -> -5) -> Allowed
    flex_debit = {
        "employee_id": str(emp1_id),
        "leave_type_id": lt2_id,
        "adjustment_type": "DEDUCT",
        "amount": 15.0,
        "reason": "Permitted negative balance adjustment",
    }
    flex_res = await client.post("/api/v1/hrms/leave/adjustments", json=flex_debit, headers=admin_headers)
    assert flex_res.status_code == 201, flex_res.text
    flex_data = flex_res.json()["data"]
    assert flex_data["new_balance"] == -5.0

    # =========================================================================
    # Test 5 & 6: Automatic Deduction on Approval, Idempotency & Reversal
    # =========================================================================
    # Alice currently has 20.0 available on lt1
    # Alice requests 3 days leave (from Oct 12 to Oct 14)
    req_payload = {
        "leave_type_id": lt1_id,
        "from_date": "2026-10-12",
        "to_date": "2026-10-14",
        "reason": "Family vacation",
    }
    req_res = await client.post("/api/v1/hrms/leave/requests", json=req_payload, headers=emp1_headers)
    assert req_res.status_code == 201, req_res.text
    leave_req_id = req_res.json()["data"]["id"]

    # Pending request must NOT deduct balance yet
    bal_res_pending = await client.get(f"/api/v1/hrms/leave/balances/{emp1_id}", headers=admin_headers)
    lt1_bal_p = next(b for b in bal_res_pending.json()["data"] if b["leave_type_id"] == lt1_id)
    assert lt1_bal_p["consumed"] == 0.0
    assert lt1_bal_p["available"] == 20.0

    # Admin approves the request
    approve_res = await client.patch(
        f"/api/v1/hrms/leave/approvals/{leave_req_id}/approve",
        json={"approval_remarks": "Approved by supervisor"},
        headers=admin_headers,
    )
    assert approve_res.status_code == 200, approve_res.text
    assert approve_res.json()["data"]["approval_status"] == "APPROVED"

    # Consumed should now be 3.0, Available should be 17.0
    bal_res_approved = await client.get(f"/api/v1/hrms/leave/balances/{emp1_id}", headers=admin_headers)
    lt1_bal_a = next(b for b in bal_res_approved.json()["data"] if b["leave_type_id"] == lt1_id)
    assert lt1_bal_a["consumed"] == 3.0
    assert lt1_bal_a["available"] == 17.0

    # Verify audit transaction for LEAVE_APPROVED
    adj_history_res = await client.get(f"/api/v1/hrms/leave/adjustments/{emp1_id}", headers=admin_headers)
    assert adj_history_res.status_code == 200
    history = adj_history_res.json()["data"]
    appr_audit = next((h for h in history if h["source"] in ("LEAVE_APPROVAL", "LEAVE_APPROVED")), None)
    assert appr_audit is not None
    assert appr_audit["amount"] == -3.0

    # Idempotency: Attempt approving the SAME request again
    re_approve = await client.patch(
        f"/api/v1/hrms/leave/approvals/{leave_req_id}/approve",
        json={"approval_remarks": "Second redundant approval"},
        headers=admin_headers,
    )
    assert re_approve.status_code == 200
    # Consumed must NOT be deducted again
    bal_res_reappr = await client.get(f"/api/v1/hrms/leave/balances/{emp1_id}", headers=admin_headers)
    lt1_bal_re = next(b for b in bal_res_reappr.json()["data"] if b["leave_type_id"] == lt1_id)
    assert lt1_bal_re["consumed"] == 3.0
    assert lt1_bal_re["available"] == 17.0

    # Reversal: Cancel the approved leave request
    cancel_res = await client.patch(
        f"/api/v1/hrms/leave/requests/{leave_req_id}/cancel",
        headers=admin_headers,
    )
    assert cancel_res.status_code == 200, cancel_res.text

    # Reversal must restore consumed back to 0.0 and available back to 20.0
    bal_res_reversed = await client.get(f"/api/v1/hrms/leave/balances/{emp1_id}", headers=admin_headers)
    lt1_bal_rev = next(b for b in bal_res_reversed.json()["data"] if b["leave_type_id"] == lt1_id)
    assert lt1_bal_rev["consumed"] == 0.0
    assert lt1_bal_rev["available"] == 20.0

    # Verify audit transaction for LEAVE_REVERSAL
    adj_history_rev = await client.get(f"/api/v1/hrms/leave/adjustments/{emp1_id}", headers=admin_headers)
    history_rev = adj_history_rev.json()["data"]
    rev_audit = next((h for h in history_rev if h["source"] == "LEAVE_REVERSAL"), None)
    assert rev_audit is not None
    assert rev_audit["amount"] == 3.0

    # =========================================================================
    # Test 7: Employee Cannot Manipulate Another Employee's Balance
    # =========================================================================
    tamper_payload = {
        "employee_id": str(emp2_id),
        "leave_type_id": lt1_id,
        "adjustment_type": "ADD",
        "amount": 10.0,
        "reason": "Unauthorized credit attempt",
    }
    tamper_res = await client.post("/api/v1/hrms/leave/adjustments", json=tamper_payload, headers=emp1_headers)
    assert tamper_res.status_code == 403

    # Cleanup test leave types
    await client.delete(f"/api/v1/hrms/leave/types/{lt1_id}", headers=admin_headers)
    await client.delete(f"/api/v1/hrms/leave/types/{lt2_id}", headers=admin_headers)

    # Cleanup test users so dev DB does not accumulate duplicates
    async with sessionmaker() as session:
        for uid in [admin_id, manager_id, emp1_id, emp2_id]:
            u = await session.get(User, uid)
            if u:
                u.deleted_at = datetime.now(timezone.utc)
                u.is_active = False
        await session.commit()
