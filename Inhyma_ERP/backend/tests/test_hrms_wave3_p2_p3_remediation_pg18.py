"""
INHYMA ERP — HRMS Wave 3 (P2/P3) Comprehensive PostgreSQL 18 Integration Regression Suite.

Covers real PG18 end-to-end verification for:
- W3-01 (HRMS-BUG-23): Attendance Regularization Cancellation (RBAC, terminal states, audit, concurrency)
- W3-02 (HRMS-BUG-23): Half-Day Leave Application (0.5 day, policy, bounds, concurrency, Attendance & Payroll)
- W3-03 (HRMS-BUG-23): Expense Auto-Approval Limit (documented safe policy preservation & Numeric precision)
- W3-04 (HRMS-BUG-24): Attendance Early-Exit Buffer (exact boundaries, flexible/custom shift, late preservation)
- W3-05 (HRMS-BUG-25): Leave Type applicable_departments (ALL, DEPARTMENT, BRANCH, CUSTOM, malformed, stale)
- W3-06 (HRMS-BUG-26): Asset Manager List/Detail Consistency & DB-Level Pagination
- W3-07 (HRMS-BUG-27): Attendance Excel Export non-blocking offload & RBAC/filters
- W3-08 (HRMS-BUG-31): Remaining Endpoint Scoping (/leave/calculate-days, /attendance/permitted-offices, /hrms/employees, /setup/*/employees)
- W3-12 (HRMS-BUG-33): Tracking Duration Floor (0s / 1s / 45s / 90s / 3665s) & IST Date Alignment across UTC midnight
- HRMS-BUG-28: Monetary Numeric(14, 2) Schema Verification & Edge-Value Precision
"""

from __future__ import annotations

import asyncio
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
import io
import os
import uuid
from unittest.mock import patch

import openpyxl
import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import delete, select, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.auth.security import create_access_token, hash_password
from app.database.session import get_db_session
from app.hrms.attendance_service import HrmsAttendanceService, IST
from app.hrms.expense_service import HrmsExpenseService
from app.hrms.models import (
    HrmsAsset,
    HrmsAssetAssignment,
    HrmsAssetHistory,
    HrmsAssetMaintenance,
    HrmsAttendance,
    HrmsAttendancePolicy,
    HrmsAttendanceRegularization,
    HrmsEmployeeLeaveBalance,
    HrmsEmployeeLocation,
    HrmsEmployeeSalary,
    HrmsExpense,
    HrmsExpenseSettings,
    HrmsHoliday,
    HrmsLeaveAdjustment,
    HrmsLeavePlan,
    HrmsLeavePlanType,
    HrmsLeaveRequest,
    HrmsLeaveType,
    HrmsLiveTrackingSession,
    HrmsLocation,
    HrmsMonthlyPayroll,
    HrmsMonthlyPayrollItem,
    HrmsPayrollAdjustment,
    HrmsPayrollComponent,
    HrmsTrackingPoint,
)
from app.hrms.rbac import check_manager_availability
from app.hrms.schemas import PunchInRequest, PunchOutRequest, TrackingStartPayload, TrackingStopPayload
from app.hrms.site_visit_service import HrmsSiteVisitService
from app.main import app
from app.notifications.models import Notification
from app.rbac.models import Permission, Role, RoleAssignmentStatus, UserPermission, UserRole
from app.users.models import EmploymentStatus, User, UserStatus


def _working_date(offset_days: int = 10) -> date:
    """Return a future weekday (Mon-Fri) avoiding Sundays and standard national holidays."""
    d = datetime.now(IST).date() + timedelta(days=offset_days)
    blocked_md = {(1, 26), (8, 15), (10, 2), (11, 8)}
    while d.weekday() >= 5 or (d.month, d.day) in blocked_md:
        d += timedelta(days=1)
    return d


def _past_working_date(offset_days: int = 3) -> date:
    """Return a recent past weekday (Mon-Fri) avoiding Sundays and standard national holidays."""
    d = datetime.now(IST).date() - timedelta(days=offset_days)
    blocked_md = {(1, 26), (8, 15), (10, 2), (11, 8)}
    while d.weekday() >= 5 or (d.month, d.day) in blocked_md:
        d -= timedelta(days=1)
    return d


def _next_sunday(offset_days: int = 3) -> date:
    d = datetime.now(IST).date() + timedelta(days=offset_days)
    while d.weekday() != 6:
        d += timedelta(days=1)
    return d


@pytest_asyncio.fixture
async def w3_env():
    """Isolated PG18 environment with multi-role actors and guaranteed teardown."""
    db_url = os.environ["DATABASE_URL"]
    assert "127.0.0.1" in db_url or "localhost" in db_url, "Refusing non-local DB"
    engine = create_async_engine(db_url, echo=False, pool_size=12, max_overflow=12)
    SessionFactory = async_sessionmaker(bind=engine, expire_on_commit=False)

    async def override_get_db():
        async with SessionFactory() as session:
            yield session

    app.dependency_overrides[get_db_session] = override_get_db

    tag = f"w3_{uuid.uuid4().hex[:6]}"
    pw_hash = hash_password("Wave3Qa@2026!")

    created_user_ids: list[uuid.UUID] = []
    created_role_ids: list[uuid.UUID] = []
    created_loc_ids: list[uuid.UUID] = []
    created_lt_ids: list[uuid.UUID] = []
    created_lp_ids: list[uuid.UUID] = []
    created_hol_ids: list[uuid.UUID] = []
    created_asset_ids: list[uuid.UUID] = []
    created_payroll_months: list[str] = []
    orig_policy_snapshot: dict | None = None
    orig_exp_settings_snapshot: dict | None = None

    async with SessionFactory() as db:
        # Snapshot existing policy & expense settings so we always restore cleanly
        pol = (await db.execute(select(HrmsAttendancePolicy).limit(1))).scalar_one_or_none()
        if pol:
            orig_policy_snapshot = {
                "id": pol.id,
                "shift_name": pol.shift_name,
                "shift_start_time": pol.shift_start_time,
                "shift_end_time": pol.shift_end_time,
                "weekly_off": pol.weekly_off,
                "enable_grace": pol.enable_grace,
                "grace_period_minutes": pol.grace_period_minutes,
                "enable_early_exit": pol.enable_early_exit,
                "early_exit_buffer_minutes": pol.early_exit_buffer_minutes,
                "mark_early_exit": pol.mark_early_exit,
                "flexible_shift": pol.flexible_shift,
            }

        es = (await db.execute(select(HrmsExpenseSettings).limit(1))).scalar_one_or_none()
        if es:
            orig_exp_settings_snapshot = {
                "id": es.id,
                "max_claim_amount": es.max_claim_amount,
                "auto_approval_limit": es.auto_approval_limit,
                "receipt_required": es.receipt_required,
                "submission_window_days": es.submission_window_days,
            }

        # Existing system roles
        sa_role = (await db.execute(select(Role).where(Role.name == "super_admin"))).scalar_one()
        hr_role = (await db.execute(select(Role).where(Role.name == "hr"))).scalar_one()
        emp_role = (await db.execute(select(Role).where(Role.name == "employee"))).scalar_one()
        mgr_role = (await db.execute(select(Role).where(Role.name == "department_manager"))).scalar_one_or_none()
        if not mgr_role:
            mgr_role = Role(name=f"department_manager", description="Department Manager", is_system=True)
            db.add(mgr_role)
            await db.flush()
            created_role_ids.append(mgr_role.id)

        # Custom department roles including one containing substring "all" ("Call Center")
        dept_a_role = Role(name=f"W3DeptA_{tag}", description=f"W3 Dept A {tag}", is_system=False)
        dept_b_role = Role(name=f"W3DeptB_{tag}", description=f"W3 Dept B {tag}", is_system=False)
        dept_call_role = Role(name=f"Call Center {tag}", description=f"Call Center {tag}", is_system=False)
        dept_deleted_role = Role(
            name=f"W3OldDept_{tag}",
            description=f"W3 Old Dept {tag}",
            is_system=False,
            deleted_at=datetime.now(timezone.utc),
        )
        db.add_all([dept_a_role, dept_b_role, dept_call_role, dept_deleted_role])
        await db.flush()
        created_role_ids.extend([dept_a_role.id, dept_b_role.id, dept_call_role.id, dept_deleted_role.id])

        # Permissions lookup for explicit deny tests
        perm_hrms_view = (await db.execute(select(Permission).where(Permission.code == "hrms.view"))).scalar_one_or_none()
        perm_hrms_setup = (await db.execute(select(Permission).where(Permission.code == "hrms.setup"))).scalar_one_or_none()
        perm_hrms_leave = (await db.execute(select(Permission).where(Permission.code == "hrms.leave"))).scalar_one_or_none()
        perm_hrms_att = (await db.execute(select(Permission).where(Permission.code == "hrms.attendance"))).scalar_one_or_none()

        # Locations (including one containing substring "all" -> "Mall Branch")
        loc_a = HrmsLocation(
            name=f"W3 Office A {tag}",
            address="100 A Street",
            latitude=19.2183,
            longitude=72.9781,
            radius_meters=150.0,
            is_active=True,
        )
        loc_b = HrmsLocation(
            name=f"Mall Branch {tag}",
            address="200 Mall Road",
            latitude=18.5204,
            longitude=73.8567,
            radius_meters=150.0,
            is_active=True,
        )
        db.add_all([loc_a, loc_b])
        await db.flush()
        created_loc_ids.extend([loc_a.id, loc_b.id])

        def _mk_user(suffix: str, code: str, mgr_id: uuid.UUID | None = None, first: str = "W3", last: str = "User") -> User:
            u = User(
                username=f"{tag}_{suffix}",
                email=f"{tag}_{suffix}@wave3.local",
                password_hash=pw_hash,
                first_name=first,
                last_name=last,
                display_name=f"{first} {last}",
                employee_code=code,
                manager_id=mgr_id,
                is_active=True,
                status=UserStatus.ACTIVE,
                employment_status=EmploymentStatus.ACTIVE,
            )
            db.add(u)
            return u

        admin = _mk_user("admin", f"W3ADM-{tag[:4].upper()}", first="W3", last="Admin")
        hr = _mk_user("hr", f"W3HR-{tag[:4].upper()}", first="W3", last="HR")
        hr_deny_view = _mk_user("hr_deny", f"W3HRD-{tag[:4].upper()}", first="W3", last="HRDeny")
        mgr_a = _mk_user("mgr_a", f"W3MGA-{tag[:4].upper()}", first="W3", last="MgrA")
        mgr_a2 = _mk_user("mgr_a2", f"W3MGA2-{tag[:4].upper()}", first="W3", last="SecMgrA")
        readonly_u = _mk_user("ro", f"W3RO-{tag[:4].upper()}", first="W3", last="ReadOnly")
        await db.flush()

        emp_a1 = _mk_user("emp_a1", f"W3EA1-{tag[:4].upper()}", mgr_id=mgr_a.id, first="W3", last="EmpA1")
        emp_b1 = _mk_user("emp_b1", f"W3EB1-{tag[:4].upper()}", first="W3", last="EmpB1")
        emp_call = _mk_user("emp_call", f"W3ECL-{tag[:4].upper()}", first="W3", last="EmpCall")
        emp_nodept = _mk_user("emp_nodept", f"W3END-{tag[:4].upper()}", first="W3", last="EmpNoDept")
        await db.flush()

        all_users = [admin, hr, hr_deny_view, mgr_a, mgr_a2, readonly_u, emp_a1, emp_b1, emp_call, emp_nodept]
        created_user_ids.extend([u.id for u in all_users])

        # Role assignments
        db.add_all([
            UserRole(user_id=admin.id, role_id=sa_role.id, is_primary=True, status=RoleAssignmentStatus.ACTIVE),
            UserRole(user_id=hr.id, role_id=hr_role.id, is_primary=True, status=RoleAssignmentStatus.ACTIVE),
            UserRole(user_id=hr_deny_view.id, role_id=hr_role.id, is_primary=True, status=RoleAssignmentStatus.ACTIVE),
            UserRole(user_id=mgr_a.id, role_id=mgr_role.id, is_primary=True, status=RoleAssignmentStatus.ACTIVE),
            UserRole(user_id=mgr_a.id, role_id=dept_a_role.id, is_primary=False, status=RoleAssignmentStatus.ACTIVE),
            UserRole(user_id=mgr_a2.id, role_id=mgr_role.id, is_primary=True, status=RoleAssignmentStatus.ACTIVE),
            UserRole(user_id=mgr_a2.id, role_id=dept_a_role.id, is_primary=False, status=RoleAssignmentStatus.ACTIVE),
            UserRole(user_id=readonly_u.id, role_id=emp_role.id, is_primary=True, status=RoleAssignmentStatus.ACTIVE),
            UserRole(user_id=emp_a1.id, role_id=dept_a_role.id, is_primary=True, status=RoleAssignmentStatus.ACTIVE),
            UserRole(user_id=emp_b1.id, role_id=dept_b_role.id, is_primary=True, status=RoleAssignmentStatus.ACTIVE),
            UserRole(user_id=emp_call.id, role_id=dept_call_role.id, is_primary=True, status=RoleAssignmentStatus.ACTIVE),
            # emp_nodept has ONLY a soft-deleted role so active department resolves to General
            UserRole(user_id=emp_nodept.id, role_id=dept_deleted_role.id, is_primary=True, status=RoleAssignmentStatus.ACTIVE),
        ])

        # Explicit UserPermissions for readonly_u (hrms.view only) and hr_deny_view (deny hrms.view)
        if perm_hrms_view:
            db.add(UserPermission(user_id=readonly_u.id, permission_id=perm_hrms_view.id, is_granted=True))
            db.add(UserPermission(user_id=hr_deny_view.id, permission_id=perm_hrms_view.id, is_granted=False))
        if perm_hrms_setup:
            db.add(UserPermission(user_id=hr_deny_view.id, permission_id=perm_hrms_setup.id, is_granted=False))
        if perm_hrms_leave:
            db.add(UserPermission(user_id=hr_deny_view.id, permission_id=perm_hrms_leave.id, is_granted=False))
        if perm_hrms_att:
            db.add(UserPermission(user_id=hr_deny_view.id, permission_id=perm_hrms_att.id, is_granted=False))

        # Location assignments
        db.add_all([
            HrmsEmployeeLocation(user_id=emp_a1.id, location_id=loc_a.id, is_primary=True),
            HrmsEmployeeLocation(user_id=emp_b1.id, location_id=loc_b.id, is_primary=True),
            HrmsEmployeeLocation(user_id=emp_call.id, location_id=loc_b.id, is_primary=True),
            HrmsEmployeeLocation(user_id=mgr_a.id, location_id=loc_a.id, is_primary=True),
            HrmsEmployeeLocation(user_id=admin.id, location_id=loc_a.id, is_primary=True),
        ])

        await db.commit()

    def tok(user: User, perms: list[str] | None = None) -> dict[str, str]:
        p = perms if perms is not None else []
        if user.id == admin.id and perms is None:
            p = ["*"]
        elif user.id == hr.id and perms is None:
            p = [
                "hrms.view", "hrms.create", "hrms.update", "hrms.manage", "hrms.approve",
                "hrms.setup", "hrms.attendance", "hrms.leave", "hrms.assets",
                "hrms.expenses", "hrms.site_visits", "hrms.payroll",
            ]
        elif user.id == hr_deny_view.id and perms is None:
            p = ["deny:hrms.view", "deny:hrms.setup", "deny:hrms.leave", "deny:hrms.attendance"]
        elif user.id == readonly_u.id and perms is None:
            p = ["hrms.view"]
        return {"Authorization": f"Bearer {create_access_token(user.id, permissions=p).token}"}

    env = {
        "tag": tag,
        "engine": engine,
        "SessionFactory": SessionFactory,
        "transport": ASGITransport(app=app),
        "tok": tok,
        "admin": admin,
        "hr": hr,
        "hr_deny_view": hr_deny_view,
        "mgr_a": mgr_a,
        "mgr_a2": mgr_a2,
        "readonly_u": readonly_u,
        "emp_a1": emp_a1,
        "emp_b1": emp_b1,
        "emp_call": emp_call,
        "emp_nodept": emp_nodept,
        "dept_a_name": dept_a_role.name,
        "dept_b_name": dept_b_role.name,
        "dept_call_name": dept_call_role.name,
        "dept_deleted_name": dept_deleted_role.name,
        "loc_a": loc_a,
        "loc_b": loc_b,
        "created_lt_ids": created_lt_ids,
        "created_lp_ids": created_lp_ids,
        "created_hol_ids": created_hol_ids,
        "created_asset_ids": created_asset_ids,
        "created_payroll_months": created_payroll_months,
    }

    try:
        yield env
    finally:
        app.dependency_overrides.clear()
        async with SessionFactory() as db:
            # Restore original policy & expense settings
            if orig_policy_snapshot:
                pol = await db.get(HrmsAttendancePolicy, orig_policy_snapshot["id"])
                if pol:
                    for k, v in orig_policy_snapshot.items():
                        if k != "id":
                            setattr(pol, k, v)
            if orig_exp_settings_snapshot:
                es = await db.get(HrmsExpenseSettings, orig_exp_settings_snapshot["id"])
                if es:
                    for k, v in orig_exp_settings_snapshot.items():
                        if k != "id":
                            setattr(es, k, v)

            if created_payroll_months:
                pay_ids = list(
                    (await db.execute(select(HrmsMonthlyPayroll.id).where(HrmsMonthlyPayroll.payroll_month.in_(created_payroll_months)))).scalars().all()
                )
                if pay_ids:
                    await db.execute(delete(HrmsMonthlyPayrollItem).where(HrmsMonthlyPayrollItem.payroll_id.in_(pay_ids)))
                    await db.execute(delete(HrmsMonthlyPayroll).where(HrmsMonthlyPayroll.id.in_(pay_ids)))

            if created_asset_ids:
                await db.execute(delete(HrmsAssetHistory).where(HrmsAssetHistory.asset_id.in_(created_asset_ids)))
                await db.execute(delete(HrmsAssetAssignment).where(HrmsAssetAssignment.asset_id.in_(created_asset_ids)))
                await db.execute(delete(HrmsAssetMaintenance).where(HrmsAssetMaintenance.asset_id.in_(created_asset_ids)))
                await db.execute(delete(HrmsAsset).where(HrmsAsset.id.in_(created_asset_ids)))

            if created_user_ids:
                await db.execute(delete(Notification).where(Notification.user_id.in_(created_user_ids)))
                await db.execute(delete(HrmsTrackingPoint).where(HrmsTrackingPoint.employee_id.in_(created_user_ids)))
                await db.execute(delete(HrmsLiveTrackingSession).where(HrmsLiveTrackingSession.employee_id.in_(created_user_ids)))
                await db.execute(delete(HrmsAttendanceRegularization).where(HrmsAttendanceRegularization.employee_id.in_(created_user_ids)))
                await db.execute(delete(HrmsAttendance).where(HrmsAttendance.employee_id.in_(created_user_ids)))
                await db.execute(delete(HrmsLeaveRequest).where(HrmsLeaveRequest.employee_id.in_(created_user_ids)))
                await db.execute(delete(HrmsLeaveAdjustment).where(HrmsLeaveAdjustment.employee_id.in_(created_user_ids)))
                await db.execute(delete(HrmsEmployeeLeaveBalance).where(HrmsEmployeeLeaveBalance.employee_id.in_(created_user_ids)))
                await db.execute(delete(HrmsExpense).where(HrmsExpense.employee_id.in_(created_user_ids)))
                await db.execute(delete(HrmsPayrollAdjustment).where(HrmsPayrollAdjustment.employee_id.in_(created_user_ids)))
                await db.execute(delete(HrmsMonthlyPayrollItem).where(HrmsMonthlyPayrollItem.employee_id.in_(created_user_ids)))
                await db.execute(delete(HrmsEmployeeSalary).where(HrmsEmployeeSalary.employee_id.in_(created_user_ids)))
                await db.execute(delete(HrmsEmployeeLocation).where(HrmsEmployeeLocation.user_id.in_(created_user_ids)))
                await db.execute(delete(UserPermission).where(UserPermission.user_id.in_(created_user_ids)))
                await db.execute(delete(UserRole).where(UserRole.user_id.in_(created_user_ids)))
                await db.execute(delete(User).where(User.id.in_(created_user_ids)))

            if created_lp_ids:
                await db.execute(delete(HrmsLeavePlanType).where(HrmsLeavePlanType.plan_id.in_(created_lp_ids)))
                await db.execute(delete(HrmsLeavePlan).where(HrmsLeavePlan.id.in_(created_lp_ids)))
            if created_lt_ids:
                await db.execute(delete(HrmsLeavePlanType).where(HrmsLeavePlanType.leave_type_id.in_(created_lt_ids)))
                await db.execute(delete(HrmsLeaveType).where(HrmsLeaveType.id.in_(created_lt_ids)))
            if created_hol_ids:
                await db.execute(delete(HrmsHoliday).where(HrmsHoliday.id.in_(created_hol_ids)))
            if created_loc_ids:
                await db.execute(delete(HrmsLocation).where(HrmsLocation.id.in_(created_loc_ids)))
            if created_role_ids:
                await db.execute(delete(Role).where(Role.id.in_(created_role_ids)))
            await db.commit()
        await engine.dispose()


# =============================================================================
# W3-01 (HRMS-BUG-23): ATTENDANCE REGULARIZATION CANCELLATION
# =============================================================================

@pytest.mark.asyncio
async def test_w3_01_attendance_regularization_cancellation(w3_env):
    tok = w3_env["tok"]
    emp_a1 = w3_env["emp_a1"]
    emp_b1 = w3_env["emp_b1"]
    mgr_a = w3_env["mgr_a"]
    admin = w3_env["admin"]
    readonly_u = w3_env["readonly_u"]
    SessionFactory = w3_env["SessionFactory"]

    d1 = _past_working_date(2).isoformat()
    d2 = _past_working_date(4).isoformat()
    d3 = _past_working_date(6).isoformat()
    d4 = _past_working_date(8).isoformat()

    async with AsyncClient(transport=w3_env["transport"], base_url="http://test") as client:
        # 1. Employee submits regularization for d1
        r_sub = await client.post(
            "/api/v1/hrms/attendance/regularizations",
            headers=tok(emp_a1),
            json={
                "date": d1,
                "reason": "Missing Punch",
                "notes": "Forgot punch out",
                "punch_in": "10:30",
                "punch_out": "19:00",
            },
        )
        assert r_sub.status_code == 200, r_sub.text
        reg1_id = r_sub.json()["data"]["id"]

        # 2. Unrelated employee (emp_b1) CANNOT cancel emp_a1's regularization -> 403
        r_forbid = await client.patch(
            f"/api/v1/hrms/attendance/regularizations/{reg1_id}/cancel",
            headers=tok(emp_b1),
            json={"reason": "Unauthorized cancel"},
        )
        assert r_forbid.status_code == 403, f"Expected 403 for unrelated employee, got {r_forbid.status_code}: {r_forbid.text}"

        # 3. Read-only user CANNOT cancel -> 403
        r_ro = await client.patch(
            f"/api/v1/hrms/attendance/regularizations/{reg1_id}/cancel",
            headers=tok(readonly_u),
        )
        assert r_ro.status_code == 403

        # 4. Requester (emp_a1) cancels own PENDING regularization -> 200
        r_can = await client.patch(
            f"/api/v1/hrms/attendance/regularizations/{reg1_id}/cancel",
            headers=tok(emp_a1),
            json={"reason": "Found original punch entry"},
        )
        assert r_can.status_code == 200, f"Requester cancel failed: {r_can.status_code} {r_can.text}"
        can_data = r_can.json()["data"]
        assert can_data["status"] == "CANCELLED"
        assert can_data["action_taken"] == "CANCELLED"
        assert can_data["reviewed_by"] == str(emp_a1.id)
        assert can_data["reviewed_at"] is not None

        # 5. Record is NOT silently deleted in DB & linked attendance is restored to NONE
        async with SessionFactory() as db:
            db_reg = await db.get(HrmsAttendanceRegularization, uuid.UUID(reg1_id))
            assert db_reg is not None, "Regularization record must be preserved, not deleted!"
            assert db_reg.status == "CANCELLED"
            att = (
                await db.execute(
                    select(HrmsAttendance).where(
                        HrmsAttendance.employee_id == emp_a1.id,
                        HrmsAttendance.attendance_date == date.fromisoformat(d1),
                    )
                )
            ).scalar_one()
            assert att.regularization_status == "NONE"

        # 6. Double cancel -> 400
        r_dup = await client.patch(
            f"/api/v1/hrms/attendance/regularizations/{reg1_id}/cancel",
            headers=tok(emp_a1),
        )
        assert r_dup.status_code == 400

        # 7. Cancel after APPROVED -> 400 (terminal state protected)
        r_sub2 = await client.post(
            "/api/v1/hrms/attendance/regularizations",
            headers=tok(emp_a1),
            json={"date": d2, "reason": "Traffic Delay", "notes": "Metro delay", "punch_in": "10:30", "punch_out": "19:00"},
        )
        assert r_sub2.status_code == 200
        reg2_id = r_sub2.json()["data"]["id"]
        r_app2 = await client.post(
            f"/api/v1/hrms/attendance/regularizations/{reg2_id}/approve",
            headers=tok(mgr_a),
            json={"action": "APPROVE", "manager_remarks": "Verified"},
        )
        assert r_app2.status_code == 200
        r_can_approved = await client.patch(
            f"/api/v1/hrms/attendance/regularizations/{reg2_id}/cancel",
            headers=tok(emp_a1),
        )
        assert r_can_approved.status_code == 400, "Must not allow cancelling APPROVED regularization!"

        # 8. Cancel after REJECTED -> 400 (terminal state protected)
        r_sub3 = await client.post(
            "/api/v1/hrms/attendance/regularizations",
            headers=tok(emp_a1),
            json={"date": d3, "reason": "Other", "notes": "Test reject", "punch_in": "10:30", "punch_out": "19:00"},
        )
        assert r_sub3.status_code == 200
        reg3_id = r_sub3.json()["data"]["id"]
        r_rej3 = await client.post(
            f"/api/v1/hrms/attendance/regularizations/{reg3_id}/reject",
            headers=tok(mgr_a),
            json={"action": "REJECT_LOP", "manager_remarks": "Invalid claim"},
        )
        assert r_rej3.status_code == 200
        r_can_rej = await client.post(
            f"/api/v1/hrms/attendance/regularizations/{reg3_id}/cancel",
            headers=tok(admin),
        )
        assert r_can_rej.status_code == 400, "Must not allow cancelling REJECTED regularization!"

        # 9. Concurrent cancel vs approve race -> strictly ONE 200, ONE 400, ZERO 500s
        r_sub4 = await client.post(
            "/api/v1/hrms/attendance/regularizations",
            headers=tok(emp_a1),
            json={"date": d4, "reason": "GPS Issue", "notes": "Concurrent test", "punch_in": "10:30", "punch_out": "19:00"},
        )
        assert r_sub4.status_code == 200
        reg4_id = r_sub4.json()["data"]["id"]

        res_can, res_app = await asyncio.gather(
            client.patch(f"/api/v1/hrms/attendance/regularizations/{reg4_id}/cancel", headers=tok(emp_a1)),
            client.post(
                f"/api/v1/hrms/attendance/regularizations/{reg4_id}/approve",
                headers=tok(mgr_a),
                json={"action": "APPROVE", "manager_remarks": "Race approve"},
            ),
        )
        codes = sorted([res_can.status_code, res_app.status_code])
        assert codes == [200, 400], f"Expected strict [200, 400] under concurrent cancel vs approve, got {codes}"

        async with SessionFactory() as db:
            db_reg4 = await db.get(HrmsAttendanceRegularization, uuid.UUID(reg4_id))
            att4 = (
                await db.execute(
                    select(HrmsAttendance).where(
                        HrmsAttendance.employee_id == emp_a1.id,
                        HrmsAttendance.attendance_date == date.fromisoformat(d4),
                    )
                )
            ).scalar_one()
            if db_reg4.status == "CANCELLED":
                assert att4.regularization_status == "NONE"
            else:
                assert db_reg4.status == "APPROVED"
                assert att4.regularization_status == "APPROVED"


# =============================================================================
# W3-02 (HRMS-BUG-23): HALF-DAY LEAVE APPLICATION + ATTENDANCE & PAYROLL
# =============================================================================

@pytest.mark.asyncio
async def test_w3_02_half_day_leave_lifecycle_attendance_and_payroll(w3_env):
    tok = w3_env["tok"]
    admin = w3_env["admin"]
    mgr_a = w3_env["mgr_a"]
    emp_a1 = w3_env["emp_a1"]
    SessionFactory = w3_env["SessionFactory"]
    tag = w3_env["tag"]

    async with SessionFactory() as db:
        lt_half_ok = HrmsLeaveType(
            name=f"W3 HalfOK {tag}",
            code=f"HOK{tag[:3]}",
            leave_type="REGULAR",
            is_paid=True,
            annual_balance=2.0,
            allow_half_day=True,
            max_consecutive_days=5,
            is_active=True,
        )
        lt_half_no = HrmsLeaveType(
            name=f"W3 HalfNO {tag}",
            code=f"HNO{tag[:3]}",
            leave_type="REGULAR",
            is_paid=True,
            annual_balance=5.0,
            allow_half_day=False,
            max_consecutive_days=5,
            is_active=True,
        )
        lt_unpaid_half = HrmsLeaveType(
            name=f"W3 UnpaidHalf {tag}",
            code=f"HUH{tag[:3]}",
            leave_type="REGULAR",
            is_paid=False,
            annual_balance=0.0,
            allow_half_day=True,
            allow_negative_balance=True,
            max_consecutive_days=5,
            is_active=True,
        )
        db.add_all([lt_half_ok, lt_half_no, lt_unpaid_half])
        await db.flush()
        w3_env["created_lt_ids"].extend([lt_half_ok.id, lt_half_no.id, lt_unpaid_half.id])
        await db.commit()

    # Use a deterministic past month (2026-06) with weekday dates so payroll + calendar are deterministic
    d_hd_paid = date(2026, 6, 3)     # Wed
    d_hd_unpaid = date(2026, 6, 4)   # Thu
    d_hd_multi_end = date(2026, 6, 5)
    d_sun = date(2026, 6, 7)         # Sun

    async with AsyncClient(transport=w3_env["transport"], base_url="http://test") as client:
        # 1. calculate-days with is_half_day=true on single working day -> 0.5
        r_calc = await client.get(
            f"/api/v1/hrms/leave/calculate-days?from_date={d_hd_paid}&to_date={d_hd_paid}&leave_type_id={lt_half_ok.id}&is_half_day=true",
            headers=tok(emp_a1),
        )
        assert r_calc.status_code == 200, r_calc.text
        assert r_calc.json()["data"]["number_of_days"] == 0.5

        # 2. calculate-days half-day on multi-day range -> 400
        r_calc_multi = await client.get(
            f"/api/v1/hrms/leave/calculate-days?from_date={d_hd_paid}&to_date={d_hd_multi_end}&leave_type_id={lt_half_ok.id}&is_half_day=true",
            headers=tok(emp_a1),
        )
        assert r_calc_multi.status_code == 400

        # 3. calculate-days half-day on Sunday -> 400
        r_calc_sun = await client.get(
            f"/api/v1/hrms/leave/calculate-days?from_date={d_sun}&to_date={d_sun}&leave_type_id={lt_half_ok.id}&is_half_day=true",
            headers=tok(emp_a1),
        )
        assert r_calc_sun.status_code == 400

        # 4. Reject half-day when leave type has allow_half_day=False
        r_disallow = await client.post(
            "/api/v1/hrms/leave/requests",
            headers=tok(emp_a1),
            json={
                "leave_type_id": str(lt_half_no.id),
                "from_date": d_hd_paid.isoformat(),
                "to_date": d_hd_paid.isoformat(),
                "is_half_day": True,
                "reason": "Half day disallowed test",
            },
        )
        assert r_disallow.status_code == 400, f"Should reject allow_half_day=False, got {r_disallow.status_code}"

        # 5. Reject invalid fractional number_of_days (e.g. 0.25)
        r_bad_frac = await client.post(
            "/api/v1/hrms/leave/requests",
            headers=tok(emp_a1),
            json={
                "leave_type_id": str(lt_half_ok.id),
                "from_date": d_hd_paid.isoformat(),
                "to_date": d_hd_paid.isoformat(),
                "number_of_days": 0.25,
                "reason": "Invalid quarter day",
            },
        )
        assert r_bad_frac.status_code in (400, 422)

        # 6. Apply half-day paid leave via number_of_days=0.5 (also supports is_half_day=True)
        r_hd1 = await client.post(
            "/api/v1/hrms/leave/requests",
            headers=tok(emp_a1),
            json={
                "leave_type_id": str(lt_half_ok.id),
                "from_date": d_hd_paid.isoformat(),
                "to_date": d_hd_paid.isoformat(),
                "number_of_days": 0.5,
                "half_day_session": "FIRST_HALF",
                "reason": "Doctor appointment morning",
            },
        )
        assert r_hd1.status_code == 201, r_hd1.text
        hd1_data = r_hd1.json()["data"]
        assert hd1_data["number_of_days"] == 0.5, f"Expected 0.5 days, got {hd1_data['number_of_days']}"
        hd1_id = hd1_data["id"]

        # 7. Overlapping request on same date -> 400
        r_ov = await client.post(
            "/api/v1/hrms/leave/requests",
            headers=tok(emp_a1),
            json={
                "leave_type_id": str(lt_half_ok.id),
                "from_date": d_hd_paid.isoformat(),
                "to_date": d_hd_paid.isoformat(),
                "is_half_day": True,
                "reason": "Duplicate half day",
            },
        )
        assert r_ov.status_code == 400

        # 8. Concurrent duplicate approval -> strictly ONE succeeds, exact 0.5 balance deducted!
        app_resps = await asyncio.gather(
            client.post(f"/api/v1/hrms/leave/approvals/{hd1_id}/approve", headers=tok(mgr_a), json={"approval_remarks": "OK 1"}),
            client.post(f"/api/v1/hrms/leave/approvals/{hd1_id}/approve", headers=tok(mgr_a), json={"approval_remarks": "OK 2"}),
        )
        assert sorted(r.status_code for r in app_resps) == [200, 400]

        async with SessionFactory() as db:
            bal = (
                await db.execute(
                    select(HrmsEmployeeLeaveBalance).where(
                        HrmsEmployeeLeaveBalance.employee_id == emp_a1.id,
                        HrmsEmployeeLeaveBalance.leave_type_id == lt_half_ok.id,
                        HrmsEmployeeLeaveBalance.year == 2026,
                    )
                )
            ).scalar_one()
            assert bal.consumed == 0.5, f"Expected consumed=0.5, got {bal.consumed}"
            assert bal.available == 1.5, f"Expected available=1.5, got {bal.available}"

        # 9. Also approve a half-day unpaid leave on d_hd_unpaid AND add a half-day attendance punch on d_hd_paid
        r_hd2 = await client.post(
            "/api/v1/hrms/leave/requests",
            headers=tok(emp_a1),
            json={
                "leave_type_id": str(lt_unpaid_half.id),
                "from_date": d_hd_unpaid.isoformat(),
                "to_date": d_hd_unpaid.isoformat(),
                "is_half_day": True,
                "reason": "Unpaid half day",
            },
        )
        assert r_hd2.status_code == 201, r_hd2.text
        hd2_id = r_hd2.json()["data"]["id"]
        assert (
            await client.post(f"/api/v1/hrms/leave/approvals/{hd2_id}/approve", headers=tok(mgr_a), json={"approval_remarks": "OK"})
        ).status_code == 200

        # Assign salary to emp_a1 & record attendance for ALL working days of June 2026 (including worked half on d_hd_paid & d_hd_unpaid)
        async with SessionFactory() as db:
            sal = HrmsEmployeeSalary(
                employee_id=emp_a1.id,
                annual_ctc=Decimal("312000.00"),
                monthly_ctc=Decimal("26000.00"),
                effective_from=date(2026, 1, 1),
                is_active=True,
            )
            db.add(sal)
            for day_n in range(1, 31):
                cur_d = date(2026, 6, day_n)
                if cur_d.weekday() == 6:
                    continue
                db.add(
                    HrmsAttendance(
                        employee_id=emp_a1.id,
                        attendance_date=cur_d,
                        punch_in=datetime(2026, 6, day_n, 5, 0, tzinfo=timezone.utc),
                        punch_out=datetime(2026, 6, day_n, 13, 45, tzinfo=timezone.utc),
                        status="PRESENT",
                        working_minutes=525,
                        is_irregular=False,
                        regularization_status="NONE",
                    )
                )
            await db.commit()

        # 10. Check Attendance Calendar & All-Calendar reflect 0.5 paid leave & 0.5 unpaid leave (not 1.0!)
        r_all_cal = await client.get(
            f"/api/v1/hrms/attendance/all-calendar?year=2026&month=6&employee_id={emp_a1.id}",
            headers=tok(admin),
        )
        assert r_all_cal.status_code == 200, r_all_cal.text
        emp_cal = r_all_cal.json()["data"]["employees"][0]
        assert emp_cal["summary"]["paid_leave_days"] == 0.5, f"Calendar paid_leave_days wrong: {emp_cal['summary']}"
        assert emp_cal["summary"]["unpaid_leave_days"] == 0.5, f"Calendar unpaid_leave_days wrong: {emp_cal['summary']}"

        # 11. Check Payroll calculates exact paid_leave_days=0.5, lop_days=0.5!
        w3_env["created_payroll_months"].append("2026-06")
        r_pay = await client.post(
            "/api/v1/hrms/payroll/calculate",
            headers=tok(admin),
            json={"payroll_month": "2026-06"},
        )
        assert r_pay.status_code == 200, r_pay.text
        items = r_pay.json()["data"]["items"]
        emp_item = next(it for it in items if it["employee_id"] == str(emp_a1.id))
        assert emp_item["paid_leave_days"] == 0.5, f"Payroll paid_leave_days expected 0.5, got {emp_item['paid_leave_days']}"
        assert emp_item["lop_days"] == 0.5, f"Payroll lop_days expected 0.5 (half-day unpaid + worked half), got {emp_item['lop_days']}"


# =============================================================================
# W3-03 (HRMS-BUG-23): EXPENSE AUTO-APPROVAL LIMIT (SAFE POLICY PRESERVATION)
# =============================================================================

@pytest.mark.asyncio
async def test_w3_03_expense_auto_approval_policy_safety_preservation(w3_env):
    tok = w3_env["tok"]
    admin = w3_env["admin"]
    emp_a1 = w3_env["emp_a1"]
    mgr_a = w3_env["mgr_a"]

    async with AsyncClient(transport=w3_env["transport"], base_url="http://test") as client:
        # Configure auto_approval_limit = 500.00 cleanly
        r_set = await client.put(
            "/api/v1/hrms/setup/expense-settings",
            headers=tok(admin),
            json={
                "approval_team_lead": True,
                "approval_manager": True,
                "approval_accounts": True,
                "max_claim_amount": 50000.00,
                "receipt_required": False,
                "auto_approval_limit": 500.00,
                "submission_window_days": 30,
            },
        )
        assert r_set.status_code == 200, r_set.text
        assert r_set.json()["data"]["auto_approval_limit"] == 500.0

        # Negative auto_approval_limit rejected -> 422
        r_neg_set = await client.put(
            "/api/v1/hrms/setup/expense-settings",
            headers=tok(admin),
            json={
                "approval_team_lead": True,
                "approval_manager": True,
                "approval_accounts": True,
                "max_claim_amount": 50000.00,
                "receipt_required": False,
                "auto_approval_limit": -10.0,
                "submission_window_days": 30,
            },
        )
        assert r_neg_set.status_code == 422

        # Zero and negative expense claim amounts rejected -> 400/422
        today_iso = datetime.now(IST).date().isoformat()
        for bad_amt in (0, -50.0):
            r_bad = await client.post(
                "/api/v1/hrms/expenses?submit=true",
                headers=tok(emp_a1),
                json={"expense_date": today_iso, "category": "Travel", "amount": bad_amt, "description": "Bad amt", "is_submit": True},
            )
            assert r_bad.status_code in (400, 422)

        # Below limit (250.00), at limit (500.00), above limit (600.00) safely enter PENDING (no unreviewed self-approval bypass)
        for amt in (250.00, 500.00, 600.00):
            r_exp = await client.post(
                "/api/v1/hrms/expenses?submit=true",
                headers=tok(emp_a1),
                json={"expense_date": today_iso, "category": "Travel", "amount": amt, "description": f"Claim {amt}", "is_submit": True},
            )
            assert r_exp.status_code == 201, r_exp.text
            assert r_exp.json()["data"]["status"] == "PENDING"
            # Self-approval still blocked
            exp_id = r_exp.json()["data"]["id"]
            assert (await client.post(f"/api/v1/hrms/expenses/{exp_id}/approve", headers=tok(emp_a1))).status_code in (400, 403)
            # Manager approves cleanly
            assert (await client.post(f"/api/v1/hrms/expenses/{exp_id}/approve", headers=tok(mgr_a))).status_code == 200


# =============================================================================
# W3-04 (HRMS-BUG-24): ATTENDANCE EARLY-EXIT BUFFER BOUNDARIES
# =============================================================================

@pytest.mark.asyncio
async def test_w3_04_attendance_early_exit_buffer_boundaries(w3_env):
    emp_a1 = w3_env["emp_a1"]
    loc_a = w3_env["loc_a"]
    SessionFactory = w3_env["SessionFactory"]

    async def _run_punch_pair(
        target_day: date,
        in_hhmm: tuple[int, int],
        out_hhmm: tuple[int, int],
        *,
        shift_start: str = "10:30",
        shift_end: str = "19:00",
        enable_early_exit: bool = True,
        early_exit_buffer: int = 15,
        flexible_shift: bool = False,
    ):
        async with SessionFactory() as db:
            pol = (await db.execute(select(HrmsAttendancePolicy).limit(1))).scalar_one()
            pol.shift_start_time = shift_start
            pol.shift_end_time = shift_end
            pol.enable_early_exit = enable_early_exit
            pol.early_exit_buffer_minutes = early_exit_buffer
            pol.flexible_shift = flexible_shift
            await db.execute(
                delete(HrmsAttendance).where(
                    HrmsAttendance.employee_id == emp_a1.id,
                    HrmsAttendance.attendance_date == target_day,
                )
            )
            await db.commit()

            svc = HrmsAttendanceService(db)
            in_ist = datetime(target_day.year, target_day.month, target_day.day, in_hhmm[0], in_hhmm[1], 0, tzinfo=IST)
            out_ist = datetime(target_day.year, target_day.month, target_day.day, out_hhmm[0], out_hhmm[1], 0, tzinfo=IST)
            in_utc = in_ist.astimezone(timezone.utc)
            out_utc = out_ist.astimezone(timezone.utc)

            await svc.punch_in(
                emp_a1.id,
                PunchInRequest(latitude=loc_a.latitude, longitude=loc_a.longitude, accuracy=10.0, gps_timestamp=in_utc),
                server_now=in_utc,
            )
            rec = await svc.punch_out(
                emp_a1.id,
                PunchOutRequest(latitude=loc_a.latitude, longitude=loc_a.longitude, accuracy=10.0, gps_timestamp=out_utc),
                server_now=out_utc,
            )
            return rec

    # 1. Exact shift end 19:00 -> early_exit=0, irregular=False
    r_exact = await _run_punch_pair(date(2026, 8, 3), (10, 30), (19, 0))
    assert r_exact.early_exit_minutes == 0 and r_exact.is_irregular is False

    # 2. Within 15m buffer (18:50 = 10m before 19:00) -> early_exit=0, irregular=False
    r_within = await _run_punch_pair(date(2026, 8, 4), (10, 30), (18, 50))
    assert r_within.early_exit_minutes == 0, f"HRMS-BUG-24: Expected 0 early_exit within 15m buffer, got {r_within.early_exit_minutes}"
    assert r_within.is_irregular is False

    # 3. Exact inclusive buffer boundary (18:45 = 15m before 19:00) -> early_exit=0, irregular=False
    r_bound = await _run_punch_pair(date(2026, 8, 5), (10, 30), (18, 45))
    assert r_bound.early_exit_minutes == 0 and r_bound.is_irregular is False

    # 4. 1 minute beyond buffer (18:44 = 16m before 19:00) -> early_exit=16, irregular=True
    r_beyond = await _run_punch_pair(date(2026, 8, 6), (10, 30), (18, 44))
    assert r_beyond.early_exit_minutes == 16 and r_beyond.is_irregular is True

    # 5. enable_early_exit=False -> 17:00 punch-out is NOT flagged
    r_disabled = await _run_punch_pair(date(2026, 8, 7), (10, 30), (17, 0), enable_early_exit=False)
    assert r_disabled.early_exit_minutes == 0 and r_disabled.is_irregular is False

    # 6. Custom shift 09:00-17:30 with 10m buffer: 17:20 clean, 17:19 flagged (11m)
    r_cust_ok = await _run_punch_pair(date(2026, 8, 10), (9, 0), (17, 20), shift_start="09:00", shift_end="17:30", early_exit_buffer=10)
    assert r_cust_ok.early_exit_minutes == 0 and r_cust_ok.is_irregular is False
    r_cust_early = await _run_punch_pair(date(2026, 8, 11), (9, 0), (17, 19), shift_start="09:00", shift_end="17:30", early_exit_buffer=10)
    assert r_cust_early.early_exit_minutes == 11 and r_cust_early.is_irregular is True

    # 7. Flexible shift: punched in early at 09:30, punched out at 18:00 (8.5h = full shift completed) -> NOT early exit
    r_flex = await _run_punch_pair(date(2026, 8, 12), (9, 30), (18, 0), shift_start="10:30", shift_end="19:00", flexible_shift=True)
    assert r_flex.early_exit_minutes == 0 and r_flex.is_irregular is False


# =============================================================================
# W3-05 (HRMS-BUG-25): LEAVE TYPE applicable_departments
# =============================================================================

@pytest.mark.asyncio
async def test_w3_05_leave_type_applicable_departments(w3_env):
    tok = w3_env["tok"]
    admin = w3_env["admin"]
    emp_a1 = w3_env["emp_a1"]
    emp_b1 = w3_env["emp_b1"]
    emp_call = w3_env["emp_call"]
    emp_nodept = w3_env["emp_nodept"]
    dept_a_name = w3_env["dept_a_name"]
    dept_call_name = w3_env["dept_call_name"]
    dept_deleted_name = w3_env["dept_deleted_name"]
    loc_b = w3_env["loc_b"]
    tag = w3_env["tag"]
    SessionFactory = w3_env["SessionFactory"]

    async with AsyncClient(transport=w3_env["transport"], base_url="http://test") as client:
        # 1. Create dept-specific leave type passing applicable_departments WITHOUT explicit applicable_to
        r_lt_a = await client.post(
            "/api/v1/hrms/leave/types",
            headers=tok(admin),
            json={
                "name": f"DeptA Only {tag}",
                "code": f"DA{tag[:4]}",
                "annual_balance": 5.0,
                "applicable_departments": dept_a_name,
            },
        )
        assert r_lt_a.status_code == 201, r_lt_a.text
        lt_a_id = r_lt_a.json()["data"]["id"]
        w3_env["created_lt_ids"].append(uuid.UUID(lt_a_id))

        # 2. Create leave type restricted to "Call Center <tag>" (contains substring "all"!)
        r_lt_call = await client.post(
            "/api/v1/hrms/leave/types",
            headers=tok(admin),
            json={
                "name": f"CallCenter Only {tag}",
                "code": f"CC{tag[:4]}",
                "annual_balance": 5.0,
                "applicable_to": "DEPARTMENT",
                "applicable_departments": dept_call_name,
            },
        )
        assert r_lt_call.status_code == 201, r_lt_call.text
        lt_call_id = r_lt_call.json()["data"]["id"]
        w3_env["created_lt_ids"].append(uuid.UUID(lt_call_id))

        # 3. Create leave type with applicable_to=ALL and stale department string in DB -> must apply to EVERYONE!
        async with SessionFactory() as db:
            lt_all_stale = HrmsLeaveType(
                name=f"AllWithStale {tag}",
                code=f"AS{tag[:4]}",
                annual_balance=5.0,
                applicable_to="ALL",
                applicable_departments="NonExistentStaleDept",
                is_active=True,
            )
            # 4. Malformed empty DEPARTMENT config -> must fail closed (apply to nobody)
            lt_malformed = HrmsLeaveType(
                name=f"MalformedDept {tag}",
                code=f"MD{tag[:4]}",
                annual_balance=5.0,
                applicable_to="DEPARTMENT",
                applicable_departments=" , , ",
                is_active=True,
            )
            # 5. CUSTOM (Department + Branch combined)
            lt_custom = HrmsLeaveType(
                name=f"CustomCallMall {tag}",
                code=f"CM{tag[:4]}",
                annual_balance=5.0,
                applicable_to="CUSTOM",
                applicable_departments=dept_call_name,
                applicable_branches=loc_b.name,
                is_active=True,
            )
            # 6. Deleted department restriction (emp_nodept has ONLY soft-deleted role dept_deleted_name -> must NOT match)
            lt_old_dept = HrmsLeaveType(
                name=f"OldDeletedDept {tag}",
                code=f"OD{tag[:4]}",
                annual_balance=5.0,
                applicable_to="DEPARTMENT",
                applicable_departments=dept_deleted_name,
                is_active=True,
            )
            db.add_all([lt_all_stale, lt_malformed, lt_custom, lt_old_dept])
            await db.flush()
            w3_env["created_lt_ids"].extend([lt_all_stale.id, lt_malformed.id, lt_custom.id, lt_old_dept.id])
            await db.commit()

        async def _get_app_ids(user: User) -> set[str]:
            r = await client.get("/api/v1/hrms/leave/applicable-types", headers=tok(user))
            assert r.status_code == 200, r.text
            return {t["id"] for t in r.json()["data"]}

        ids_a1 = await _get_app_ids(emp_a1)
        ids_b1 = await _get_app_ids(emp_b1)
        ids_call = await _get_app_ids(emp_call)
        ids_nodept = await _get_app_ids(emp_nodept)

        # DeptA Only: visible to emp_a1, NOT to emp_b1 / emp_call / emp_nodept
        assert lt_a_id in ids_a1
        assert lt_a_id not in ids_b1, "HRMS-BUG-25: DeptA leave type leaked to DeptB!"
        assert lt_a_id not in ids_call
        assert lt_a_id not in ids_nodept

        # Backend POST /requests must also reject emp_b1 applying for DeptA Only -> 400
        d_apply = _working_date(15).isoformat()
        r_apply_b = await client.post(
            "/api/v1/hrms/leave/requests",
            headers=tok(emp_b1),
            json={"leave_type_id": lt_a_id, "from_date": d_apply, "to_date": d_apply, "reason": "Wrong dept apply"},
        )
        assert r_apply_b.status_code == 400

        # Call Center (contains "all"): visible ONLY to emp_call, NOT emp_a1 or emp_b1!
        assert lt_call_id in ids_call
        assert lt_call_id not in ids_a1, "Substring 'all' in 'Call Center' falsely matched DeptA!"
        assert lt_call_id not in ids_b1

        # applicable_to=ALL with stale department data -> visible to ALL employees
        assert str(lt_all_stale.id) in ids_a1
        assert str(lt_all_stale.id) in ids_b1
        assert str(lt_all_stale.id) in ids_nodept

        # Malformed empty DEPARTMENT -> fails closed (not visible to anyone)
        assert str(lt_malformed.id) not in ids_a1
        assert str(lt_malformed.id) not in ids_b1

        # CUSTOM (Call Center + Mall Branch): visible ONLY to emp_call (who has both), NOT emp_b1 (only branch) or emp_a1
        assert str(lt_custom.id) in ids_call
        assert str(lt_custom.id) not in ids_b1
        assert str(lt_custom.id) not in ids_a1

        # Deleted department role: emp_nodept must NOT match soft-deleted role
        assert str(lt_old_dept.id) not in ids_nodept


# =============================================================================
# W3-06 (HRMS-BUG-26): ASSET MANAGER LIST/DETAIL CONSISTENCY & DB PAGINATION
# =============================================================================

@pytest.mark.asyncio
async def test_w3_06_asset_manager_list_detail_consistency_and_db_pagination(w3_env):
    tok = w3_env["tok"]
    admin = w3_env["admin"]
    hr = w3_env["hr"]
    mgr_a = w3_env["mgr_a"]
    mgr_a2 = w3_env["mgr_a2"]
    emp_a1 = w3_env["emp_a1"]
    emp_b1 = w3_env["emp_b1"]
    readonly_u = w3_env["readonly_u"]
    SessionFactory = w3_env["SessionFactory"]
    tag = w3_env["tag"]

    async with SessionFactory() as db:
        # 4 unassigned stock assets alphabetically FIRST (AAA-0001..0004)
        stock_assets = []
        for i in range(4):
            a = HrmsAsset(
                asset_code=f"AAA-W3-{tag}-{i}",
                asset_name=f"Unassigned Stock {i} {tag}",
                asset_category="Laptop",
                status="AVAILABLE",
                assigned_to_user_id=None,
            )
            db.add(a)
            stock_assets.append(a)

        # 2 unrelated dept assets (BBB-...)
        other_asset = HrmsAsset(
            asset_code=f"BBB-W3-{tag}-1",
            asset_name=f"DeptB Laptop {tag}",
            asset_category="Laptop",
            status="ASSIGNED",
            assigned_to_user_id=emp_b1.id,
        )
        db.add(other_asset)

        # 3 team assets (ZZZ-... alphabetically AFTER unassigned stock!)
        team_a1_1 = HrmsAsset(
            asset_code=f"ZZZ-W3-{tag}-1",
            asset_name=f"EmpA1 Laptop {tag}",
            asset_category="Laptop",
            status="ASSIGNED",
            assigned_to_user_id=emp_a1.id,
        )
        team_a1_2 = HrmsAsset(
            asset_code=f"ZZZ-W3-{tag}-2",
            asset_name=f"EmpA1 Monitor {tag}",
            asset_category="Monitor",
            status="ASSIGNED",
            assigned_to_user_id=emp_a1.id,
        )
        team_mgr = HrmsAsset(
            asset_code=f"ZZZ-W3-{tag}-3",
            asset_name=f"MgrA Phone {tag}",
            asset_category="Mobile",
            status="ASSIGNED",
            assigned_to_user_id=mgr_a.id,
        )
        db.add_all([team_a1_1, team_a1_2, team_mgr])
        await db.flush()
        w3_env["created_asset_ids"].extend([a.id for a in stock_assets] + [other_asset.id, team_a1_1.id, team_a1_2.id, team_mgr.id])
        await db.commit()

    async with AsyncClient(transport=w3_env["transport"], base_url="http://test") as client:
        # 1. Manager list MUST NOT return unassigned stock or unrelated DeptB assets!
        r_mgr_list = await client.get(f"/api/v1/hrms/assets?search={tag}", headers=tok(mgr_a))
        assert r_mgr_list.status_code == 200
        mgr_ids = {a["id"] for a in r_mgr_list.json()["data"]}
        for sa in stock_assets:
            assert str(sa.id) not in mgr_ids, "HRMS-BUG-26: Unassigned stock leaked into Manager asset list!"
            assert (await client.get(f"/api/v1/hrms/assets/{sa.id}", headers=tok(mgr_a))).status_code == 403
        assert str(other_asset.id) not in mgr_ids
        assert (await client.get(f"/api/v1/hrms/assets/{other_asset.id}", headers=tok(mgr_a))).status_code == 403

        # Every asset in Manager's list MUST return 200 on detail!
        assert mgr_ids == {str(team_a1_1.id), str(team_a1_2.id), str(team_mgr.id)}
        for aid in mgr_ids:
            assert (await client.get(f"/api/v1/hrms/assets/{aid}", headers=tok(mgr_a))).status_code == 200

        # 2. DB-level pagination: page=1&page_size=2 MUST return 2 team assets (NOT truncated by stock assets!)
        r_p1 = await client.get(f"/api/v1/hrms/assets?search={tag}&page=1&page_size=2", headers=tok(mgr_a))
        r_p2 = await client.get(f"/api/v1/hrms/assets?search={tag}&page=2&page_size=2", headers=tok(mgr_a))
        assert len(r_p1.json()["data"]) == 2, f"Pagination truncated by post-filter: page1 had {len(r_p1.json()['data'])}"
        assert len(r_p2.json()["data"]) == 1, f"Pagination page2 expected 1, got {len(r_p2.json()['data'])}"

        # 3. Secondary DeptA manager sees DeptA team assets (not stock, not DeptB)
        r_mgr2 = await client.get(f"/api/v1/hrms/assets?search={tag}", headers=tok(mgr_a2))
        mgr2_ids = {a["id"] for a in r_mgr2.json()["data"]}
        assert str(team_a1_1.id) in mgr2_ids
        assert str(stock_assets[0].id) not in mgr2_ids
        assert str(other_asset.id) not in mgr2_ids

        # 4. Ordinary employee sees strictly own assets (2), read-only user sees 0 (own only), Admin/HR see all 8
        assert len((await client.get(f"/api/v1/hrms/assets?search={tag}", headers=tok(emp_a1))).json()["data"]) == 2
        assert len((await client.get(f"/api/v1/hrms/assets?search={tag}", headers=tok(readonly_u))).json()["data"]) == 0
        assert len((await client.get(f"/api/v1/hrms/assets?search={tag}", headers=tok(admin))).json()["data"]) == 8
        assert len((await client.get(f"/api/v1/hrms/assets?search={tag}", headers=tok(hr))).json()["data"]) == 8


# =============================================================================
# W3-07 (HRMS-BUG-27): ATTENDANCE EXCEL EXPORT RBAC, VALIDATION & FORMAT
# =============================================================================

@pytest.mark.asyncio
async def test_w3_07_attendance_export_format_filters_and_rbac(w3_env):
    tok = w3_env["tok"]
    admin = w3_env["admin"]
    mgr_a = w3_env["mgr_a"]
    emp_a1 = w3_env["emp_a1"]
    emp_b1 = w3_env["emp_b1"]

    async with AsyncClient(transport=w3_env["transport"], base_url="http://test") as client:
        # 1. Invalid filters -> 400
        assert (await client.get("/api/v1/hrms/attendance/export?year=2026&month=13", headers=tok(admin))).status_code == 400
        assert (await client.get("/api/v1/hrms/attendance/export?start_date=2026-07-10&end_date=2026-07-01", headers=tok(admin))).status_code == 400

        # 2. Unauthorized employee trying to export another employee -> 403
        assert (await client.get(f"/api/v1/hrms/attendance/export?year=2026&month=7&employee_id={emp_b1.id}", headers=tok(emp_a1))).status_code == 403

        # 3. Employee self export (empty records range) -> valid XLSX with Attendance Matrix & C3 freeze panes
        r_emp = await client.get("/api/v1/hrms/attendance/export?start_date=2025-01-01&end_date=2025-01-03", headers=tok(emp_a1))
        assert r_emp.status_code == 200
        assert int(r_emp.headers["X-Employee-Count"]) == 1
        wb = openpyxl.load_workbook(io.BytesIO(r_emp.content))
        assert wb.sheetnames == ["Attendance Matrix"]
        assert wb["Attendance Matrix"].freeze_panes == "C3"

        # 4. Manager team export -> 200 scoped to team
        r_mgr = await client.get("/api/v1/hrms/attendance/export?start_date=2025-01-01&end_date=2025-01-02", headers=tok(mgr_a))
        assert r_mgr.status_code == 200


# =============================================================================
# W3-08 (HRMS-BUG-31): REMAINING ENDPOINT SCOPING (UUID, CODE, USERNAME, DENY)
# =============================================================================

@pytest.mark.asyncio
async def test_w3_08_remaining_endpoint_scoping_rbac_idor(w3_env):
    tok = w3_env["tok"]
    admin = w3_env["admin"]
    hr = w3_env["hr"]
    hr_deny_view = w3_env["hr_deny_view"]
    mgr_a = w3_env["mgr_a"]
    emp_a1 = w3_env["emp_a1"]
    emp_b1 = w3_env["emp_b1"]
    loc_b = w3_env["loc_b"]

    d_wd = _working_date(10).isoformat()

    async with AsyncClient(transport=w3_env["transport"], base_url="http://test") as client:
        # 1. /hrms/leave/calculate-days across UUID, employee_code, username
        for ident in (str(emp_b1.id), emp_b1.employee_code, emp_b1.username):
            assert (
                await client.get(f"/api/v1/hrms/leave/calculate-days?from_date={d_wd}&to_date={d_wd}&employee_id={ident}", headers=tok(emp_a1))
            ).status_code == 403, f"calculate-days IDOR failed for {ident}"
            assert (
                await client.get(f"/api/v1/hrms/leave/calculate-days?from_date={d_wd}&to_date={d_wd}&employee_id={ident}", headers=tok(mgr_a))
            ).status_code == 403
            assert (
                await client.get(f"/api/v1/hrms/leave/calculate-days?from_date={d_wd}&to_date={d_wd}&employee_id={ident}", headers=tok(hr))
            ).status_code == 200
        # Manager CAN query direct report emp_a1 by UUID / code / username
        for ident in (str(emp_a1.id), emp_a1.employee_code, emp_a1.username):
            assert (
                await client.get(f"/api/v1/hrms/leave/calculate-days?from_date={d_wd}&to_date={d_wd}&employee_id={ident}", headers=tok(mgr_a))
            ).status_code == 200
        assert (
            await client.get(f"/api/v1/hrms/leave/calculate-days?from_date={d_wd}&to_date={d_wd}", headers=tok(hr_deny_view))
        ).status_code == 403

        # 2. /hrms/attendance/permitted-offices across UUID, employee_code, username
        for ident in (str(emp_b1.id), emp_b1.employee_code, emp_b1.username):
            r_emp_idor = await client.get(f"/api/v1/hrms/attendance/permitted-offices?employee_id={ident}", headers=tok(emp_a1))
            assert r_emp_idor.status_code == 403, f"permitted-offices IDOR returned {r_emp_idor.status_code} for {ident}"
            r_mgr_idor = await client.get(f"/api/v1/hrms/attendance/permitted-offices?employee_id={ident}", headers=tok(mgr_a))
            assert r_mgr_idor.status_code == 403
            r_hr_ok = await client.get(f"/api/v1/hrms/attendance/permitted-offices?employee_id={ident}", headers=tok(hr))
            assert r_hr_ok.status_code == 200
            office_ids = [o["id"] for o in r_hr_ok.json()["data"]]
            assert str(loc_b.id) in office_ids, f"Admin/HR resolving {ident} must return emp_b1's office!"
        # Manager CAN query direct report emp_a1
        for ident in (str(emp_a1.id), emp_a1.employee_code, emp_a1.username):
            assert (await client.get(f"/api/v1/hrms/attendance/permitted-offices?employee_id={ident}", headers=tok(mgr_a))).status_code == 200
        assert (await client.get("/api/v1/hrms/attendance/permitted-offices", headers=tok(hr_deny_view))).status_code == 403

        # 3. /hrms/employees: deny:hrms.view MUST be rejected with 403!
        r_emp_deny = await client.get("/api/v1/hrms/employees", headers=tok(hr_deny_view))
        assert r_emp_deny.status_code == 403, f"deny:hrms.view bypassed /hrms/employees: {r_emp_deny.status_code}"
        # Normal employee sees self only; Manager sees managed team only; Admin/HR see company-wide
        emp_list_ids = {u["id"] for u in (await client.get("/api/v1/hrms/employees", headers=tok(emp_a1))).json()["data"]}
        assert emp_list_ids == {str(emp_a1.id)}
        mgr_list_ids = {u["id"] for u in (await client.get("/api/v1/hrms/employees", headers=tok(mgr_a))).json()["data"]}
        assert str(emp_a1.id) in mgr_list_ids and str(emp_b1.id) not in mgr_list_ids

        # 4. /hrms/setup/detailed-tracking/employees & /return-timer/employees: ordinary employee -> 403!
        assert (await client.get("/api/v1/hrms/setup/detailed-tracking/employees", headers=tok(emp_a1))).status_code == 403
        assert (await client.get("/api/v1/hrms/setup/return-timer/employees", headers=tok(emp_a1))).status_code == 403
        assert (await client.get("/api/v1/hrms/setup/detailed-tracking/employees", headers=tok(admin))).status_code == 200
        assert (await client.get("/api/v1/hrms/setup/return-timer/employees", headers=tok(hr))).status_code == 200


# =============================================================================
# W3-12 (HRMS-BUG-33): TRACKING DURATION FLOOR & IST DATE ALIGNMENT
# =============================================================================

@pytest.mark.asyncio
async def test_w3_12_tracking_duration_floor_and_ist_date_alignment(w3_env):
    emp_a1 = w3_env["emp_a1"]
    mgr_a = w3_env["mgr_a"]
    SessionFactory = w3_env["SessionFactory"]

    async with SessionFactory() as db:
        svc = HrmsSiteVisitService(db)

        # 1. Start + immediate stop (< 1s) -> 0s & 0m (NOT forced to 1m / 60s!)
        s0 = await svc.start_tracking(emp_a1.id, TrackingStartPayload())
        s0_stopped = await svc.stop_tracking(emp_a1.id, s0.id, False, TrackingStopPayload())
        dto0 = svc.to_tracking_session_read(s0_stopped)
        assert dto0.total_duration_minutes == 0, f"HRMS-BUG-33: Expected 0m for <1s session, got {dto0.total_duration_minutes}"
        assert dto0.total_duration_seconds == 0, f"Expected 0s, got {dto0.total_duration_seconds}"

        # 2. 1-second, 45-second, 90-second, 3665-second sessions -> exact seconds & minutes without shifting UTC timestamps
        base_utc = datetime(2026, 8, 10, 20, 0, 0, tzinfo=timezone.utc)  # 2026-08-11 01:30:00 IST (cross-midnight!)
        for secs, expected_mins in [(0, 0), (1, 0), (45, 0), (90, 1), (3665, 61)]:
            sess = HrmsLiveTrackingSession(
                id=uuid.uuid4(),
                employee_id=emp_a1.id,
                tracking_date=base_utc.astimezone(IST).date(),
                status="COMPLETED",
                start_time=base_utc,
                end_time=base_utc + timedelta(seconds=secs),
                total_duration_minutes=secs // 60,
                approx_distance_km=0.0,
                total_points=0,
                route_summary=[],
                created_at=base_utc,
            )
            dto = svc.to_tracking_session_read(sess)
            assert dto.total_duration_seconds == secs, f"Expected {secs}s, got {dto.total_duration_seconds}"
            assert dto.total_duration_minutes == expected_mins, f"Expected {expected_mins}m, got {dto.total_duration_minutes}"
            assert dto.start_time == base_utc
            assert dto.end_time == base_utc + timedelta(seconds=secs)

        # 3. UTC midnight boundary (2026-08-10 20:00:00 UTC = 2026-08-11 01:30:00 IST):
        #    start_tracking MUST record tracking_date = 2026-08-11 (IST), while start_time remains 2026-08-10T20:00:00Z!
        class _FixedDatetime(datetime):
            @classmethod
            def now(cls, tz=None):
                return base_utc.astimezone(tz) if tz else base_utc.replace(tzinfo=None)

        with patch("app.hrms.site_visit_service.datetime", _FixedDatetime):
            s_mid = await svc.start_tracking(emp_a1.id, TrackingStartPayload())
            assert s_mid.tracking_date == date(2026, 8, 11), f"Expected IST date 2026-08-11, got {s_mid.tracking_date}"
            assert s_mid.start_time == base_utc
            await svc.stop_tracking(emp_a1.id, s_mid.id, False, TrackingStopPayload())

        # 4. Expense policy date check across UTC midnight: 2026-08-11 IST must NOT be rejected as future!
        exp_svc = HrmsExpenseService(db)
        settings = await exp_svc._get_settings()
        with patch("app.hrms.expense_service.datetime", _FixedDatetime):
            exp_svc._validate_claim_policies(
                settings=settings,
                amount=100.0,
                expense_date=date(2026, 8, 11),
                receipt_url="private://expense-receipts/ok.pdf",
            )

        # 5. Manager availability check across UTC midnight: manager on leave on 2026-08-11 IST -> unavailable!
        lt_any = (await db.execute(select(HrmsLeaveType).where(HrmsLeaveType.deleted_at.is_(None)).limit(1))).scalar_one()
        mgr_lv = HrmsLeaveRequest(
            employee_id=mgr_a.id,
            leave_type_id=lt_any.id,
            from_date=date(2026, 8, 11),
            to_date=date(2026, 8, 11),
            number_of_days=1.0,
            reason="IST midnight leave",
            status="APPROVED",
            approval_status="APPROVED",
        )
        db.add(mgr_lv)
        await db.commit()

        with patch("app.hrms.rbac.datetime", _FixedDatetime):
            avail, reason = await check_manager_availability(db, mgr_a.id)
            assert avail is False and reason == "MANAGER_ON_LEAVE", f"Expected MANAGER_ON_LEAVE on IST 2026-08-11, got {(avail, reason)}"


# =============================================================================
# HRMS-BUG-28: MONETARY NUMERIC(14, 2) SCHEMA & PRECISION VERIFICATION
# =============================================================================

@pytest.mark.asyncio
async def test_hrms_bug_28_monetary_numeric_precision_and_edge_values(w3_env):
    SessionFactory = w3_env["SessionFactory"]
    tok = w3_env["tok"]
    admin = w3_env["admin"]
    emp_a1 = w3_env["emp_a1"]
    tag = w3_env["tag"]

    expected_monetary_columns = [
        ("hrms_expense_settings", "max_claim_amount"),
        ("hrms_expense_settings", "auto_approval_limit"),
        ("hrms_assets", "purchase_cost"),
        ("hrms_asset_maintenance", "cost"),
        ("hrms_expenses", "amount"),
        ("hrms_employee_salaries", "annual_ctc"),
        ("hrms_employee_salaries", "monthly_ctc"),
        ("hrms_monthly_payrolls", "total_gross"),
        ("hrms_monthly_payrolls", "total_deductions"),
        ("hrms_monthly_payrolls", "total_net"),
        ("hrms_monthly_payroll_items", "annual_ctc"),
        ("hrms_monthly_payroll_items", "monthly_ctc"),
        ("hrms_monthly_payroll_items", "lop_deduction"),
        ("hrms_monthly_payroll_items", "gross_amount"),
        ("hrms_monthly_payroll_items", "total_deductions"),
        ("hrms_monthly_payroll_items", "net_salary"),
        ("hrms_payroll_adjustments", "amount"),
        ("hrms_payroll_components", "value"),
    ]

    async with SessionFactory() as db:
        rows = (
            await db.execute(
                text(
                    """
                    SELECT table_name, column_name, data_type, numeric_precision, numeric_scale
                    FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name LIKE 'hrms_%'
                    """
                )
            )
        ).all()
        col_map = {(t, c): (dt, prec, sc) for t, c, dt, prec, sc in rows}

        for tbl, col in expected_monetary_columns:
            assert (tbl, col) in col_map, f"Missing column {tbl}.{col}"
            dt, prec, sc = col_map[(tbl, col)]
            assert dt == "numeric" and prec == 14 and sc == 2, (
                f"HRMS-BUG-28: Expected {tbl}.{col} to be numeric(14, 2), got {dt}({prec}, {sc})"
            )

        # Edge-value persistence test: 0.00, 0.01, 100.10, 999999999999.99, and exact 0.10 + 0.20 = 0.30
        a_max = HrmsAsset(
            asset_code=f"NUM-MAX-{tag}",
            asset_name=f"Max Cost Asset {tag}",
            asset_category="Equipment",
            purchase_cost=Decimal("999999999999.99"),
            status="AVAILABLE",
        )
        a_zero = HrmsAsset(
            asset_code=f"NUM-ZERO-{tag}",
            asset_name=f"Zero Cost Asset {tag}",
            asset_category="Equipment",
            purchase_cost=Decimal("0.00"),
            status="AVAILABLE",
        )
        db.add_all([a_max, a_zero])
        await db.flush()
        w3_env["created_asset_ids"].extend([a_max.id, a_zero.id])

        m_penny = HrmsAssetMaintenance(
            asset_id=a_max.id,
            issue="Penny calibration",
            reported_date=datetime.now(IST).date(),
            cost=Decimal("0.01"),
            status="OPEN",
        )
        db.add(m_penny)

        e1 = HrmsExpense(
            expense_code=f"W3N1-{tag}",
            employee_id=emp_a1.id,
            expense_date=datetime.now(IST).date(),
            category="Travel",
            amount=Decimal("0.10"),
            currency="INR",
            description="Decimal drift test 1",
            status="DRAFT",
        )
        e2 = HrmsExpense(
            expense_code=f"W3N2-{tag}",
            employee_id=emp_a1.id,
            expense_date=datetime.now(IST).date(),
            category="Travel",
            amount=Decimal("0.20"),
            currency="INR",
            description="Decimal drift test 2",
            status="DRAFT",
        )
        e3 = HrmsExpense(
            expense_code=f"W3N3-{tag}",
            employee_id=emp_a1.id,
            expense_date=datetime.now(IST).date(),
            category="Travel",
            amount=Decimal("100.10"),
            currency="INR",
            description="Exact 100.10",
            status="DRAFT",
        )
        db.add_all([e1, e2, e3])
        await db.commit()

        # Verify exact SQL SUM(0.10 + 0.20) == Decimal('0.30') with ZERO IEEE 754 drift!
        sum_val = (
            await db.execute(
                text("SELECT SUM(amount) FROM hrms_expenses WHERE expense_code IN (:c1, :c2)"),
                {"c1": f"W3N1-{tag}", "c2": f"W3N2-{tag}"},
            )
        ).scalar_one()
        assert sum_val == Decimal("0.30"), f"Expected exact Decimal('0.30'), got {sum_val!r}"

        # Re-read max value
        await db.refresh(a_max)
        assert a_max.purchase_cost == Decimal("999999999999.99")

    # Verify JSON API serialization remains backward-compatible numeric float/number
    async with AsyncClient(transport=w3_env["transport"], base_url="http://test") as client:
        r_ast = await client.get(f"/api/v1/hrms/assets/{a_max.id}", headers=tok(admin))
        assert r_ast.status_code == 200
        assert isinstance(r_ast.json()["data"]["purchase_cost"], (int, float))


# =============================================================================
# SECTION 5 & W3-13: PARTIAL UNIQUE INDEXES & WFH TABLE DEPRECATION COMMENT
# =============================================================================

@pytest.mark.asyncio
async def test_section5_partial_unique_indexes_and_wfh_deprecation_comment(w3_env):
    from sqlalchemy.exc import IntegrityError
    from app.hrms.models import HrmsGeofenceViolation, HrmsLiveTrackingSession

    SessionFactory = w3_env["SessionFactory"]
    emp_b1 = w3_env["emp_b1"]

    async with SessionFactory() as db:
        idx_rows = (
            await db.execute(
                text(
                    "SELECT indexname FROM pg_indexes "
                    "WHERE schemaname = 'public' "
                    "AND indexname IN ("
                    "  'uq_hrms_tracking_sessions_active_employee', "
                    "  'uq_hrms_geofence_violations_open_employee'"
                    ")"
                )
            )
        ).scalars().all()
        assert set(idx_rows) == {
            "uq_hrms_tracking_sessions_active_employee",
            "uq_hrms_geofence_violations_open_employee",
        }

        wfh_comment = (
            await db.execute(text("SELECT obj_description('hrms_wfh_requests'::regclass, 'pg_class')"))
        ).scalar_one_or_none()
        assert wfh_comment is not None and "DEPRECATED (HRMS-BUG-34" in wfh_comment

        # Verify DB enforces at most ONE ACTIVE tracking session per employee
        now_utc = datetime.now(timezone.utc)
        s1 = HrmsLiveTrackingSession(
            employee_id=emp_b1.id,
            tracking_date=datetime.now(IST).date(),
            status="ACTIVE",
            start_time=now_utc,
        )
        db.add(s1)
        await db.flush()

        s2_dup = HrmsLiveTrackingSession(
            employee_id=emp_b1.id,
            tracking_date=datetime.now(IST).date(),
            status="ACTIVE",
            start_time=now_utc,
        )
        with pytest.raises(IntegrityError):
            async with db.begin_nested():
                db.add(s2_dup)
                await db.flush()

        # Verify DB enforces at most ONE open geofence violation per employee
        gv1 = HrmsGeofenceViolation(
            employee_id=emp_b1.id,
            exit_time=now_utc,
            status="ACTIVE_EXIT",
            distance_meters=220.0,
            boundary_radius_meters=100.0,
            last_latitude=19.20,
            last_longitude=72.95,
        )
        db.add(gv1)
        await db.flush()

        gv2_dup = HrmsGeofenceViolation(
            employee_id=emp_b1.id,
            exit_time=now_utc,
            status="EXPIRED",
            distance_meters=250.0,
            boundary_radius_meters=100.0,
            last_latitude=19.20,
            last_longitude=72.95,
        )
        with pytest.raises(IntegrityError):
            async with db.begin_nested():
                db.add(gv2_dup)
                await db.flush()

        await db.rollback()
