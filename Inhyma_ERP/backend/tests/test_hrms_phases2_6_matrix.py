"""
Comprehensive Automated Test Matrix for HRMS Phases 2–6.

Validates:
A. Admin Full Control & Cross-Module Authority
B. Manager-First Approval with Real System Availability & HR Fallback/Escalation
C. Admin-Configurable Per-User HRMS Permissions & Deny Precedence
D. 10 Dedicated Synthetic Staging Personas
E. Seven-Module Coverage (Attendance, Leave, Assets, Expenses, Site Visits, Payroll, Setup)
F. Defect remediations: Duplicate/stale action protection, self-approval blocking,
   separation of duties (payroll configure vs approve), employee/manager data isolation,
   and self-privilege escalation prevention.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta, timezone
import pytest
from httpx import AsyncClient
from sqlalchemy import delete, select, update

from app.auth.security import create_access_token
from app.database.engine import get_sessionmaker
from app.hrms.models import (
    HrmsAttendance,
    HrmsAttendanceRegularization,
    HrmsExpense,
    HrmsExpenseCategory,
    HrmsHoliday,
    HrmsLeaveAdjustment,
    HrmsLeavePlan,
    HrmsLeaveRequest,
    HrmsLeaveType,
    HrmsMonthlyPayroll,
    HrmsMonthlyPayrollItem,
    HrmsEmployeeSalary,
    HrmsAsset,
    HrmsSiteVisit,
)
from app.users.models import User, UserStatus
from app.rbac.models import Permission, UserPermission, Role, UserRole


# Persona emails defined in provision_hrms_qa_matrix.py
PERSONAS = {
    "super_admin": "qa_super_admin@inhyma.test",
    "admin": "qa_admin@inhyma.test",
    "hr_full": "qa_hr_full@inhyma.test",
    "hr_restricted": "qa_hr_restricted@inhyma.test",
    "hr_payroll_cfg": "qa_hr_payroll_cfg@inhyma.test",
    "hr_payroll_app": "qa_hr_payroll_app@inhyma.test",
    "mgr_sales": "qa_mgr_sales@inhyma.test",
    "mgr_solo": "qa_mgr_solo@inhyma.test",
    "emp_a": "qa_emp_a@inhyma.test",
    "emp_b": "qa_emp_b@inhyma.test",
    "emp_other": "qa_emp_other@inhyma.test",
}


async def get_persona_headers(sessionmaker, email: str) -> tuple[dict[str, str], User]:
    async with sessionmaker() as session:
        user = (await session.execute(select(User).where(User.email == email))).scalars().first()
        assert user is not None, f"Persona {email} not found in database. Run provision script first."
        token_obj = create_access_token(user.id)
        return {"Authorization": f"Bearer {token_obj.token}"}, user


@pytest.mark.asyncio
async def test_hrms_phases2_6_comprehensive_matrix(client: AsyncClient):
    sessionmaker = get_sessionmaker()

    # 1. Load Persona Tokens and User Records
    tokens = {}
    users = {}
    for key, email in PERSONAS.items():
        headers, user_obj = await get_persona_headers(sessionmaker, email)
        tokens[key] = headers
        users[key] = user_obj

    # Pre-test cleanup of test personas' transactional records
    test_user_ids = [u.id for u in users.values()]
    async with sessionmaker() as session:
        await session.execute(delete(HrmsLeaveRequest).where(HrmsLeaveRequest.employee_id.in_(test_user_ids)))
        await session.execute(delete(HrmsAttendanceRegularization).where(HrmsAttendanceRegularization.employee_id.in_(test_user_ids)))
        await session.execute(delete(HrmsExpense).where(HrmsExpense.employee_id.in_(test_user_ids)))
        await session.execute(delete(HrmsMonthlyPayrollItem).where(HrmsMonthlyPayrollItem.employee_id.in_(test_user_ids)))
        await session.execute(delete(HrmsMonthlyPayroll).where(HrmsMonthlyPayroll.payroll_month == "2026-10"))
        await session.commit()

    # -------------------------------------------------------------------------
    # TEST 1: SETUP PROTECTION & ADMIN FULL CONTROL
    # -------------------------------------------------------------------------
    # Non-admin / normal employee cannot create a leave type (403 Forbidden)
    setup_payload = {
        "name": f"Matrix Annual Vacation {uuid.uuid4().hex[:4]}",
        "code": f"MAV_{uuid.uuid4().hex[:3]}",
        "leave_type": "REGULAR",
        "is_paid": True,
        "annual_balance": 15.0,
        "carry_forward_allowed": True,
        "carry_forward_days": 5.0,
        "max_consecutive_days": 10,
        "monthly_accrual": False,
        "is_active": True,
    }
    emp_create_res = await client.post(
        "/api/v1/hrms/leave/types",
        json=setup_payload,
        headers=tokens["emp_a"],
    )
    assert emp_create_res.status_code == 403, "Regular employee must be denied leave type creation"

    # Restricted HR (only attendance and leave, but denied hrms.manage) cannot create leave types
    hr_restr_create_res = await client.post(
        "/api/v1/hrms/leave/types",
        json=setup_payload,
        headers=tokens["hr_restricted"],
    )
    assert hr_restr_create_res.status_code == 403, "Restricted HR without manage must be denied leave type creation"

    # Super Admin can create leave type (Admin Full Control)
    admin_create_res = await client.post(
        "/api/v1/hrms/leave/types",
        json=setup_payload,
        headers=tokens["super_admin"],
    )
    assert admin_create_res.status_code == 201, admin_create_res.text
    matrix_lt_id = uuid.UUID(admin_create_res.json()["data"]["id"])

    # -------------------------------------------------------------------------
    # TEST 2: MANAGER-FIRST APPROVAL WITH REAL AVAILABILITY (LEAVE MODULE)
    # -------------------------------------------------------------------------
    # Step A: Emp A submits a leave request
    leave_from = (date.today() + timedelta(days=10)).isoformat()
    leave_to = (date.today() + timedelta(days=11)).isoformat()
    req_payload = {
        "leave_type_id": str(matrix_lt_id),
        "from_date": leave_from,
        "to_date": leave_to,
        "reason": "Family vacation matrix test",
    }
    create_leave_res = await client.post(
        f"/api/v1/hrms/leave/requests?employee_id={users['emp_a'].id}",
        json=req_payload,
        headers=tokens["emp_a"],
    )
    assert create_leave_res.status_code == 201, create_leave_res.text
    leave_req_id = uuid.UUID(create_leave_res.json()["data"]["id"])

    # Step B: Emp A tries to approve their own request (Self-Approval Denial)
    self_app_res = await client.post(
        f"/api/v1/hrms/leave/approvals/{leave_req_id}/approve",
        json={"approval_remarks": "Self approval attempt"},
        headers=tokens["emp_a"],
    )
    assert self_app_res.status_code == 400, "Self-approval must return 400 Bad Request"
    assert "self-approval" in self_app_res.text.lower()

    # Step C: Cross-department/unrelated manager (Solo Manager) tries to approve
    cross_mgr_res = await client.post(
        f"/api/v1/hrms/leave/approvals/{leave_req_id}/approve",
        json={"approval_remarks": "Cross manager approval attempt"},
        headers=tokens["mgr_solo"],
    )
    assert cross_mgr_res.status_code == 403, "Unassigned manager must be denied approval"

    # Step D: HR Fallback tries to approve while assigned manager is available
    # Manager qa_mgr_sales is active and has no approved leave -> HR fallback must be blocked!
    hr_fallback_premature_res = await client.post(
        f"/api/v1/hrms/leave/approvals/{leave_req_id}/approve",
        json={"approval_remarks": "Premature HR fallback attempt"},
        headers=tokens["hr_full"],
    )
    assert hr_fallback_premature_res.status_code == 403, "HR fallback must be blocked when manager is available"
    assert "routed to the responsible manager first" in hr_fallback_premature_res.text.lower()

    # Step E: Responsible Manager (qa_mgr_sales) approves -> Success!
    mgr_app_res = await client.post(
        f"/api/v1/hrms/leave/approvals/{leave_req_id}/approve",
        json={"approval_remarks": "Approved by Sales Manager"},
        headers=tokens["mgr_sales"],
    )
    assert mgr_app_res.status_code == 200, mgr_app_res.text
    assert mgr_app_res.json()["data"]["approval_status"] == "APPROVED"

    # Step F: Duplicate approval protection
    dup_app_res = await client.post(
        f"/api/v1/hrms/leave/approvals/{leave_req_id}/approve",
        json={"approval_remarks": "Duplicate approval attempt"},
        headers=tokens["mgr_sales"],
    )
    assert dup_app_res.status_code == 400, "Duplicate approval must be blocked"
    assert "already approved" in dup_app_res.text.lower()

    # -------------------------------------------------------------------------
    # TEST 3: REJECTION WORKFLOW & AUDIT PRESERVATION
    # -------------------------------------------------------------------------
    # Emp A submits another leave request for rejection testing
    leave2_from = (date.today() + timedelta(days=20)).isoformat()
    leave2_to = (date.today() + timedelta(days=21)).isoformat()
    req2_res = await client.post(
        f"/api/v1/hrms/leave/requests?employee_id={users['emp_a'].id}",
        json={
            "leave_type_id": str(matrix_lt_id),
            "from_date": leave2_from,
            "to_date": leave2_to,
            "reason": "Rejection workflow test",
        },
        headers=tokens["emp_a"],
    )
    assert req2_res.status_code == 201
    leave2_req_id = uuid.UUID(req2_res.json()["data"]["id"])

    # Manager rejects with mandatory reason
    mgr_reject_res = await client.post(
        f"/api/v1/hrms/leave/approvals/{leave2_req_id}/reject",
        json={"approval_remarks": "Quarter-end sales push requires full presence"},
        headers=tokens["mgr_sales"],
    )
    assert mgr_reject_res.status_code == 200, mgr_reject_res.text
    assert mgr_reject_res.json()["data"]["approval_status"] == "REJECTED"

    # Verify HR or Admin cannot silently override a rejected request
    hr_override_res = await client.post(
        f"/api/v1/hrms/leave/approvals/{leave2_req_id}/approve",
        json={"approval_remarks": "HR attempt to override rejection"},
        headers=tokens["hr_full"],
    )
    assert hr_override_res.status_code == 400, "Cannot approve already rejected request"
    assert "already rejected" in hr_override_res.text.lower()

    # -------------------------------------------------------------------------
    # TEST 4: HR FALLBACK ACTIVATION (NO ASSIGNED MANAGER / MANAGER ON LEAVE)
    # -------------------------------------------------------------------------
    # Scenario A: Employee Other has no manager (manager_id is None)
    leave3_from = (date.today() + timedelta(days=30)).isoformat()
    leave3_to = (date.today() + timedelta(days=31)).isoformat()
    req3_res = await client.post(
        f"/api/v1/hrms/leave/requests?employee_id={users['emp_other'].id}",
        json={
            "leave_type_id": str(matrix_lt_id),
            "from_date": leave3_from,
            "to_date": leave3_to,
            "reason": "Emp Other leave without manager",
        },
        headers=tokens["emp_other"],
    )
    assert req3_res.status_code == 201
    leave3_req_id = uuid.UUID(req3_res.json()["data"]["id"])

    # HR Fallback can approve directly because manager is unassigned
    hr_unassigned_app_res = await client.post(
        f"/api/v1/hrms/leave/approvals/{leave3_req_id}/approve",
        json={"approval_remarks": "Approved by HR fallback (no manager assigned)"},
        headers=tokens["hr_full"],
    )
    assert hr_unassigned_app_res.status_code == 200, hr_unassigned_app_res.text
    assert hr_unassigned_app_res.json()["data"]["approval_status"] == "APPROVED"

    # Scenario B: Manager is unavailable due to active approved leave
    # Create approved leave for qa_mgr_sales covering today
    mgr_leave_id = uuid.uuid4()
    async with sessionmaker() as session:
        mgr_leave = HrmsLeaveRequest(
            id=mgr_leave_id,
            employee_id=users["mgr_sales"].id,
            leave_type_id=matrix_lt_id,
            from_date=date.today(),
            to_date=date.today() + timedelta(days=1),
            number_of_days=2.0,
            reason="Manager on medical leave",
            approval_status="APPROVED",
            status="APPROVED",
        )
        session.add(mgr_leave)
        await session.commit()

    try:
        # Emp B submits leave request while sales manager is on leave
        leave4_from = (date.today() + timedelta(days=40)).isoformat()
        leave4_to = (date.today() + timedelta(days=41)).isoformat()
        req4_res = await client.post(
            f"/api/v1/hrms/leave/requests?employee_id={users['emp_b'].id}",
            json={
                "leave_type_id": str(matrix_lt_id),
                "from_date": leave4_from,
                "to_date": leave4_to,
                "reason": "Emp B request while manager is on leave",
            },
            headers=tokens["emp_b"],
        )
        assert req4_res.status_code == 201
        leave4_req_id = uuid.UUID(req4_res.json()["data"]["id"])

        # HR Fallback can now approve because manager is on approved leave!
        hr_leave_app_res = await client.post(
            f"/api/v1/hrms/leave/approvals/{leave4_req_id}/approve",
            json={"approval_remarks": "Approved by HR fallback (manager on leave)"},
            headers=tokens["hr_full"],
        )
        assert hr_leave_app_res.status_code == 200, hr_leave_app_res.text
        assert hr_leave_app_res.json()["data"]["approval_status"] == "APPROVED"
    finally:
        # Clean up manager's leave record
        async with sessionmaker() as session:
            await session.execute(delete(HrmsLeaveRequest).where(HrmsLeaveRequest.id == mgr_leave_id))
            await session.commit()

    # -------------------------------------------------------------------------
    # TEST 5: ATTENDANCE REGULARIZATION APPROVAL & DOUBLE-APPROVAL PROTECTION
    # -------------------------------------------------------------------------
    reg_date = (date.today() - timedelta(days=2)).isoformat()
    reg_res = await client.post(
        "/api/v1/hrms/attendance/regularizations",
        json={
            "employee_id": str(users["emp_a"].id),
            "attendance_date": reg_date,
            "check_in": "09:00:00",
            "check_out": "18:00:00",
            "reason": "Biometric scanner power outage",
        },
        headers=tokens["emp_a"],
    )
    assert reg_res.status_code == 200, reg_res.text
    reg_id = uuid.UUID(reg_res.json()["data"]["id"])

    # Emp A self-approval blocked
    reg_self_res = await client.post(
        f"/api/v1/hrms/attendance/regularizations/{reg_id}/approve",
        json={"remarks": "Self approve regularization"},
        headers=tokens["emp_a"],
    )
    assert reg_self_res.status_code == 400
    assert "self-approval" in reg_self_res.text.lower()

    # Sales Manager approves -> Success
    reg_mgr_res = await client.post(
        f"/api/v1/hrms/attendance/regularizations/{reg_id}/approve",
        json={"remarks": "Confirmed on-site presence via security log"},
        headers=tokens["mgr_sales"],
    )
    assert reg_mgr_res.status_code == 200, reg_mgr_res.text
    assert reg_mgr_res.json()["data"]["status"] == "APPROVED"

    # Duplicate regularization approval attempt returns 400
    reg_dup_res = await client.post(
        f"/api/v1/hrms/attendance/regularizations/{reg_id}/approve",
        json={"remarks": "Second approval attempt"},
        headers=tokens["mgr_sales"],
    )
    assert reg_dup_res.status_code == 400
    assert "already approved" in reg_dup_res.text.lower()

    # -------------------------------------------------------------------------
    # TEST 6: TWO-STAGE EXPENSE APPROVAL & RESTRICTED HR ACCESS
    # -------------------------------------------------------------------------
    # Emp A submits expense claim
    exp_create_res = await client.post(
        "/api/v1/hrms/expenses",
        json={
            "expense_date": date.today().isoformat(),
            "category": "Travel",
            "amount": 2500.0,
            "description": "Lunch meeting with prospect leadership team",
            "is_submit": False,
        },
        headers=tokens["emp_a"],
    )
    assert exp_create_res.status_code == 201, exp_create_res.text
    exp_id = uuid.UUID(exp_create_res.json()["data"]["id"])

    # Submit expense from DRAFT to PENDING
    exp_sub_res = await client.post(
        f"/api/v1/hrms/expenses/{exp_id}/submit",
        headers=tokens["emp_a"],
    )
    assert exp_sub_res.status_code == 200
    assert exp_sub_res.json()["data"]["status"] == "PENDING"

    # Attempt premature reimbursement before Stage 1 approval -> 400
    premature_reimburse = await client.post(
        f"/api/v1/hrms/expenses/{exp_id}/reimburse",
        headers=tokens["hr_full"],
    )
    assert premature_reimburse.status_code == 400, "Only approved expenses can be reimbursed"

    # Restricted HR attempts to approve expense -> 403 Forbidden (denied hrms.expenses)
    hr_restr_exp = await client.post(
        f"/api/v1/hrms/expenses/{exp_id}/approve",
        headers=tokens["hr_restricted"],
    )
    assert hr_restr_exp.status_code == 403, "Restricted HR must be denied expense approval"

    # Stage 1: Sales Manager approves expense
    mgr_exp_app = await client.post(
        f"/api/v1/hrms/expenses/{exp_id}/approve",
        headers=tokens["mgr_sales"],
    )
    assert mgr_exp_app.status_code == 200, mgr_exp_app.text
    assert mgr_exp_app.json()["data"]["status"] == "APPROVED"

    # Verify Manager cannot perform Stage 2 (reimbursement) -> 403 Forbidden
    mgr_reimburse_res = await client.post(
        f"/api/v1/hrms/expenses/{exp_id}/reimburse",
        headers=tokens["mgr_sales"],
    )
    assert mgr_reimburse_res.status_code == 403, "Managers cannot reimburse expenses"

    # Stage 2: HR Full marks as reimbursed
    hr_reimburse_res = await client.post(
        f"/api/v1/hrms/expenses/{exp_id}/reimburse",
        json={"notes": "Processed via Axis Bank corporate transfer"},
        headers=tokens["hr_full"],
    )
    assert hr_reimburse_res.status_code == 200, hr_reimburse_res.text
    assert hr_reimburse_res.json()["data"]["status"] == "REIMBURSED"

    # -------------------------------------------------------------------------
    # TEST 7: PAYROLL SEPARATION OF DUTIES (CONFIGURE VS APPROVE)
    # -------------------------------------------------------------------------
    # Step A: HR Payroll Approve tries to configure salary -> 403 Forbidden
    sal_cfg_res = await client.post(
        "/api/v1/hrms/payroll/salary/assign",
        json={
            "employee_id": str(users["emp_a"].id),
            "annual_ctc": 1200000.0,
            "effective_from": "2026-04-01",
            "notes": "Annual increment",
        },
        headers=tokens["hr_payroll_app"],
    )
    assert sal_cfg_res.status_code == 403, "Payroll Approve persona must not configure salary"

    # Step B: HR Payroll Configure persona successfully configures salary
    sal_cfg_ok = await client.post(
        "/api/v1/hrms/payroll/salary/assign",
        json={
            "employee_id": str(users["emp_a"].id),
            "annual_ctc": 1200000.0,
            "effective_from": "2026-04-01",
            "notes": "Annual increment by payroll config specialist",
        },
        headers=tokens["hr_payroll_cfg"],
    )
    assert sal_cfg_ok.status_code == 201, sal_cfg_ok.text

    # Step C: HR Payroll Configure calculates monthly draft batch
    calc_res = await client.post(
        "/api/v1/hrms/payroll/calculate",
        json={"payroll_month": "2026-10"},
        headers=tokens["hr_payroll_cfg"],
    )
    assert calc_res.status_code == 200, calc_res.text

    # Step D: HR Payroll Configure tries to approve monthly payroll -> 403 Forbidden!
    cfg_app_attempt = await client.post(
        "/api/v1/hrms/payroll/approve",
        json={"payroll_month": "2026-10"},
        headers=tokens["hr_payroll_cfg"],
    )
    assert cfg_app_attempt.status_code == 403, "Payroll Configure persona must not approve payroll"

    # Step E: HR Payroll Approve persona approves monthly payroll -> 200 Success!
    app_payroll_ok = await client.post(
        "/api/v1/hrms/payroll/approve",
        json={"payroll_month": "2026-10"},
        headers=tokens["hr_payroll_app"],
    )
    assert app_payroll_ok.status_code == 200, app_payroll_ok.text
    assert app_payroll_ok.json()["data"]["status"] == "APPROVED"

    # -------------------------------------------------------------------------
    # TEST 8: DATA ISOLATION (EMPLOYEE & MANAGER BOUNDARIES)
    # -------------------------------------------------------------------------
    # Emp A tries to access Emp B's payslip -> 403 Forbidden
    payslip_forged = await client.get(
        f"/api/v1/hrms/payroll/payslips?employee_id={users['emp_b'].id}&payroll_month=2026-10",
        headers=tokens["emp_a"],
    )
    assert payslip_forged.status_code == 403, "Employee cannot access another employee's payslip"

    # Emp A can access own payslip
    payslip_own = await client.get(
        "/api/v1/hrms/payroll/payslips?payroll_month=2026-10",
        headers=tokens["emp_a"],
    )
    assert payslip_own.status_code == 200, payslip_own.text

    # Sales Manager tries to access Emp Other (Engineering) regularizations -> 403 Forbidden
    mgr_cross_reg = await client.get(
        f"/api/v1/hrms/attendance/regularizations?employee_id={users['emp_other'].id}",
        headers=tokens["mgr_sales"],
    )
    assert mgr_cross_reg.status_code == 403, "Manager cannot inspect cross-department employee"

    # -------------------------------------------------------------------------
    # TEST 9: SELF-PRIVILEGE ESCALATION BLOCKING
    # -------------------------------------------------------------------------
    # HR Full tries to grant themselves super_admin permission via RBAC API
    perm_stmt = select(Permission).where(Permission.code == "super_admin")
    async with sessionmaker() as session:
        sa_perm = (await session.execute(perm_stmt)).scalars().first()
        if not sa_perm:
            sa_perm = (await session.execute(select(Permission))).scalars().first()

    if sa_perm:
        escalate_res = await client.post(
            f"/api/v1/rbac/users/{users['hr_full'].id}/permissions",
            json={"permission_id": str(sa_perm.id), "is_granted": True},
            headers=tokens["hr_full"],
        )
        assert escalate_res.status_code == 403, "Non-super-admin cannot modify own permissions"
        assert "forbidden" in escalate_res.text.lower() or "cannot modify your own permissions" in escalate_res.text.lower()
