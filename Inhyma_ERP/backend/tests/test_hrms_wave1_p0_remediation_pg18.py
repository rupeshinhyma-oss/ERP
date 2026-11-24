"""
HRMS Wave 1 — P0 Critical Defect Remediation Regression Suite (Real PostgreSQL 18).

Covers all 7 verified P0 remediation areas from the HRMS Complete Independent Audit Report:
  A. Leave Data Privacy / IDOR (HRMS-BUG-01)
  B. Payroll Calculation Correctness — 11 expected-value scenarios (HRMS-BUG-02, HRMS-BUG-03)
  C. Leave Balance Concurrency — 10 transactional & concurrency scenarios (HRMS-BUG-04)
  D. Terminated Employee Access — 8 lifecycle & token/refresh scenarios (HRMS-BUG-05)
  E. Expense Receipt Security — 14 content/MIME/storage/RBAC scenarios (HRMS-BUG-07)
  F. Payslip Privacy — 12 role/manager/draft/export isolation scenarios (HRMS-BUG-06, HRMS-BUG-08)
  G. Backend RBAC Enforcement — 10 roles x grant/absent/deny/session matrix (HRMS-BUG-06/09/10/11)

Safety:
  - Runs strictly against isolated local PostgreSQL 18 (`inhyma_test_db`).
  - Refuses to execute if DATABASE_URL references Supabase or production.
  - Cleans up 100% of synthetic test records and local temp files in `finally:`.
"""

from __future__ import annotations

import asyncio
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal, ROUND_HALF_UP
import io
import os
from pathlib import Path
from unittest.mock import patch
import uuid

from httpx import ASGITransport, AsyncClient
from PIL import Image
import pytest
import pytest_asyncio
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine

from app.auth.security import create_access_token, hash_password
from app.core.config import settings
from app.hrms.leave_service import HrmsLeaveService
from app.hrms.models import (
    HrmsAttendance,
    HrmsAttendanceRegularization,
    HrmsEmployeeLeaveBalance,
    HrmsEmployeeSalary,
    HrmsExpense,
    HrmsExpenseCategory,
    HrmsExpenseSettings,
    HrmsHoliday,
    HrmsLeaveAdjustment,
    HrmsLeavePlan,
    HrmsLeavePlanType,
    HrmsLeaveRequest,
    HrmsLeaveType,
    HrmsMonthlyPayroll,
    HrmsMonthlyPayrollItem,
    HrmsPayrollAdjustment,
    HrmsPayrollComponent,
)
from app.hrms.payroll_service import HrmsPayrollService
from app.main import create_application
from app.notifications.models import Notification
from app.rbac.models import Permission, Role, RoleAssignmentStatus, RolePermission, UserPermission, UserRole
from app.users.models import EmploymentStatus, EmploymentType, User, UserStatus

PG_TEST_URL = os.environ.get(
    "HRMS_PG_TEST_URL",
    os.environ.get("TEST_DATABASE_URL", "postgresql+asyncpg://postgres:root@127.0.0.1:5432/inhyma_test_db"),
)

TWO_DP = Decimal("0.01")


def _q2(val: Decimal) -> Decimal:
    return val.quantize(TWO_DP, rounding=ROUND_HALF_UP)


def _ensure_safe_local_pg(url: str) -> None:
    lower = url.lower()
    if "supabase.com" in lower or "supabase.co" in lower:
        pytest.skip("Refusing to execute HRMS Wave 1 tests against Supabase.")
    if not lower.startswith("postgresql"):
        pytest.skip("HRMS Wave 1 suite requires an isolated local PostgreSQL DATABASE_URL.")


def _make_valid_pdf_bytes(marker: bytes = b"INHYMA-WAVE1-RECEIPT") -> bytes:
    return (
        b"%PDF-1.4\n"
        b"1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n"
        b"2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n"
        b"3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >> endobj\n"
        b"% " + marker + b"\n"
        b"xref\n0 4\n0000000000 65535 f \n"
        b"trailer << /Size 4 /Root 1 0 R >>\nstartxref\n180\n%%EOF\n"
    )


def _make_valid_image_bytes(fmt: str = "PNG") -> bytes:
    buf = io.BytesIO()
    img = Image.new("RGB", (32, 32), color=(42, 120, 210))
    img.save(buf, format=fmt)
    return buf.getvalue()


@pytest_asyncio.fixture
async def wave1_env():
    """Provision isolated multi-role HRMS environment in local PostgreSQL 18 and tear down completely."""
    _ensure_safe_local_pg(PG_TEST_URL)

    prev_db_url = str(settings.DATABASE_URL)
    prev_direct_url = getattr(settings, "DIRECT_URL", None)
    prev_supa_url = getattr(settings, "SUPABASE_URL", None)
    prev_supa_key = getattr(settings, "SUPABASE_SERVICE_KEY", None)
    prev_supa_role_key = getattr(settings, "SUPABASE_SERVICE_ROLE_KEY", None)
    prev_supa_anon = getattr(settings, "SUPABASE_ANON_KEY", None)

    os.environ["DATABASE_URL"] = PG_TEST_URL
    os.environ["DIRECT_URL"] = PG_TEST_URL
    os.environ["SUPABASE_URL"] = ""
    os.environ["SUPABASE_SERVICE_KEY"] = ""
    os.environ["SUPABASE_SERVICE_ROLE_KEY"] = ""
    os.environ["SUPABASE_ANON_KEY"] = ""

    object.__setattr__(settings, "DATABASE_URL", PG_TEST_URL)
    if hasattr(settings, "DIRECT_URL"):
        object.__setattr__(settings, "DIRECT_URL", PG_TEST_URL)
    for attr in ("SUPABASE_URL", "SUPABASE_SERVICE_KEY", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_ANON_KEY"):
        if hasattr(settings, attr):
            object.__setattr__(settings, attr, "")

    import app.database.engine as engine_module

    await engine_module.dispose_engine()

    engine: AsyncEngine = create_async_engine(PG_TEST_URL, pool_size=20, max_overflow=25)
    SessionFactory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    tag = uuid.uuid4().hex[:8].lower()
    raw_password = f"Wave1!{tag}Aa"
    pw_hash = hash_password(raw_password)

    created_user_ids: list[uuid.UUID] = []
    created_role_ids: list[uuid.UUID] = []
    created_lt_ids: list[uuid.UUID] = []
    created_plan_ids: list[uuid.UUID] = []
    created_holiday_ids: list[uuid.UUID] = []
    created_payroll_months: set[str] = set()
    created_expense_ids: list[uuid.UUID] = []
    created_local_files: list[Path] = []
    saved_components_state: list[tuple[uuid.UUID, bool]] = []
    created_comp_ids: list[uuid.UUID] = []

    async with SessionFactory() as db:
        # Ensure required permissions exist
        perm_rows = (await db.execute(select(Permission))).scalars().all()
        perm_by_code = {p.code: p for p in perm_rows}

        # Fetch standard roles
        roles_existing = (await db.execute(select(Role).where(Role.deleted_at.is_(None)))).scalars().all()
        role_by_name = {r.name.lower(): r for r in roles_existing}

        # Synthetic isolated departments & custom roles for Wave 1 tests
        dept_eng = Role(name=f"W1Eng_{tag}", code=f"W1E{tag[:4].upper()}", description="Wave 1 Eng Dept", is_system=False)
        dept_ops = Role(name=f"W1Ops_{tag}", code=f"W1O{tag[:4].upper()}", description="Wave 1 Ops Dept", is_system=False)
        role_dept_mgr = Role(
            name=f"W1DeptManager_{tag}",
            code=f"W1M{tag[:4].upper()}",
            description="Wave 1 Dept Manager",
            is_system=False,
        )
        role_hr_restricted = Role(
            name=f"HR",  # will reuse existing HR role if present
            code=f"W1HR{tag[:4].upper()}",
            is_system=False,
        )
        role_readonly = Role(
            name=f"W1ReadOnly_{tag}",
            code=f"W1R{tag[:4].upper()}",
            description="Wave 1 Read-Only HRMS Viewer",
            is_system=False,
        )

        db.add_all([dept_eng, dept_ops, role_dept_mgr, role_readonly])
        await db.flush()
        created_role_ids.extend([dept_eng.id, dept_ops.id, role_dept_mgr.id, role_readonly.id])

        # Grant ONLY hrms.view to role_readonly
        if "hrms.view" in perm_by_code:
            db.add(RolePermission(role_id=role_readonly.id, permission_id=perm_by_code["hrms.view"].id))

        # Restricted HR custom role (HR without payroll/setup)
        role_hr_no_payroll = Role(
            name=f"human_resources",
            code=f"W1HNP{tag[:3].upper()}",
            description="Wave 1 HR without payroll",
            is_system=False,
        )
        if "human_resources" not in role_by_name:
            db.add(role_hr_no_payroll)
            await db.flush()
            created_role_ids.append(role_hr_no_payroll.id)
            for pcode in ("hrms.attendance", "hrms.leave", "hrms.expenses", "hrms.assets", "hrms.site_visits", "hrms.view"):
                if pcode in perm_by_code:
                    db.add(RolePermission(role_id=role_hr_no_payroll.id, permission_id=perm_by_code[pcode].id))
        else:
            role_hr_no_payroll = role_by_name["human_resources"]

        hr_role = role_by_name.get("hr")
        super_admin_role = role_by_name.get("super_admin") or role_by_name.get("admin")
        employee_role = role_by_name.get("employee") or role_by_name.get("user")

        # Leave types: Paid CL, Paid SL, Unpaid LWP
        lt_cl = HrmsLeaveType(
            name=f"W1 Casual Paid {tag}",
            code=f"W1CL{tag[:3].upper()}",
            leave_type="REGULAR",
            is_paid=True,
            annual_balance=12.0,
            max_consecutive_days=30,
            is_active=True,
            allow_half_day=True,
            allow_backdated=True,
            min_notice_days=0,
            require_attachment=False,
            allow_negative_balance=False,
            count_weekends_as_leave=False,
            count_holidays_as_leave=False,
        )
        lt_sl = HrmsLeaveType(
            name=f"W1 Sick Paid {tag}",
            code=f"W1SL{tag[:3].upper()}",
            leave_type="REGULAR",
            is_paid=True,
            annual_balance=10.0,
            max_consecutive_days=30,
            is_active=True,
            allow_half_day=True,
            allow_backdated=True,
            min_notice_days=0,
            require_attachment=False,
            allow_negative_balance=False,
            count_weekends_as_leave=False,
            count_holidays_as_leave=False,
        )
        lt_lwp = HrmsLeaveType(
            name=f"W1 Unpaid LWP {tag}",
            code=f"W1LP{tag[:3].upper()}",
            leave_type="SPECIAL",
            is_paid=False,
            annual_balance=30.0,
            max_consecutive_days=30,
            is_active=True,
            allow_half_day=True,
            allow_backdated=True,
            min_notice_days=0,
            require_attachment=False,
            allow_negative_balance=True,
            count_weekends_as_leave=False,
            count_holidays_as_leave=False,
        )
        db.add_all([lt_cl, lt_sl, lt_lwp])
        await db.flush()
        created_lt_ids.extend([lt_cl.id, lt_sl.id, lt_lwp.id])

        plan = HrmsLeavePlan(
            name=f"W1 Plan {tag}",
            effective_from=date(2024, 1, 1),
            effective_to=date(2028, 12, 31),
            branch="All Branches",
            department="All Departments",
            is_active=True,
        )
        db.add(plan)
        await db.flush()
        created_plan_ids.append(plan.id)
        for lt in (lt_cl, lt_sl, lt_lwp):
            db.add(HrmsLeavePlanType(plan_id=plan.id, leave_type_id=lt.id))

        # Ensure an active Travel expense category exists
        cat_exists = (
            await db.execute(select(HrmsExpenseCategory).where(func.lower(HrmsExpenseCategory.name) == "travel"))
        ).scalar_one_or_none()
        if not cat_exists:
            db.add(HrmsExpenseCategory(name="Travel", is_active=True))

        # Ensure deterministic payroll components exist for calculation tests
        existing_comps = (
            await db.execute(select(HrmsPayrollComponent).where(HrmsPayrollComponent.deleted_at.is_(None)))
        ).scalars().all()
        if not existing_comps:
            comps = [
                HrmsPayrollComponent(
                    name="Basic Salary", code="BASIC", component_type="EARNING",
                    calculation_type="PERCENTAGE", calculation_basis="CTC", value=50.0,
                    display_order=1, is_active=True,
                ),
                HrmsPayrollComponent(
                    name="House Rent Allowance", code="HRA", component_type="EARNING",
                    calculation_type="PERCENTAGE", calculation_basis="BASIC", value=40.0,
                    display_order=2, is_active=True,
                ),
                HrmsPayrollComponent(
                    name="Special Allowance", code="SPECIAL", component_type="EARNING",
                    calculation_type="REMAINING", calculation_basis="CTC", value=0.0,
                    display_order=3, is_active=True,
                ),
                HrmsPayrollComponent(
                    name="Provident Fund", code="PF", component_type="DEDUCTION",
                    calculation_type="PERCENTAGE", calculation_basis="BASIC", value=12.0,
                    display_order=4, is_active=True,
                ),
                HrmsPayrollComponent(
                    name="Professional Tax", code="PT", component_type="DEDUCTION",
                    calculation_type="FIXED", calculation_basis=None, value=200.0,
                    display_order=5, is_active=True,
                ),
            ]
            db.add_all(comps)
            await db.flush()
            created_comp_ids.extend([c.id for c in comps])

        await db.commit()

    async def make_user(
        short_key: str,
        *,
        roles: list[Role] | None = None,
        grants: list[str] | None = None,
        denies: list[str] | None = None,
        manager_id: uuid.UUID | None = None,
        is_active: bool = True,
        user_status: UserStatus = UserStatus.ACTIVE,
        employment_status: EmploymentStatus = EmploymentStatus.ACTIVE,
        date_of_joining: date | None = date(2024, 1, 1),
    ) -> tuple[User, dict[str, str]]:
        async with SessionFactory() as s:
            sfx = uuid.uuid4().hex[:4]
            uname = f"w1_{short_key}_{tag}_{sfx}"
            emp_code = f"W1-{short_key[:4].upper()}-{sfx.upper()}"
            u = User(
                first_name="W1",
                last_name=f"{short_key}_{sfx}",
                display_name=f"W1 {short_key} {tag}",
                employee_code=emp_code,
                has_login=True,
                username=uname,
                email=f"{uname}@inhyma-wave1.test",
                password_hash=pw_hash,
                manager_id=manager_id,
                date_of_joining=date_of_joining,
                employment_type=EmploymentType.FULL_TIME,
                employment_status=employment_status,
                status=user_status,
                is_active=is_active,
            )
            s.add(u)
            await s.flush()
            created_user_ids.append(u.id)

            for idx, r in enumerate(roles or []):
                if r is not None:
                    s.add(
                        UserRole(
                            user_id=u.id,
                            role_id=r.id,
                            status=RoleAssignmentStatus.ACTIVE,
                            is_primary=(idx == 0),
                        )
                    )

            for gcode in grants or []:
                p = perm_by_code.get(gcode)
                if p:
                    s.add(UserPermission(user_id=u.id, permission_id=p.id, is_granted=True))
            for dcode in denies or []:
                p = perm_by_code.get(dcode)
                if p:
                    s.add(UserPermission(user_id=u.id, permission_id=p.id, is_granted=False))

            await s.commit()
            await s.refresh(u)
            tok = create_access_token(u.id, permissions=[]).token
            return u, {"Authorization": f"Bearer {tok}"}

    # Provision core multi-role personas
    admin_u, admin_h = await make_user("admin", roles=[super_admin_role])
    hr_full_u, hr_full_h = await make_user("hrfull", roles=[hr_role])
    hr_deny_all_u, hr_deny_all_h = await make_user(
        "hrdeny",
        roles=[hr_role],
        denies=["hrms.payroll", "hrms.setup", "hrms.approve", "hrms.leave", "hrms.expenses"],
    )
    hr_no_payroll_u, hr_no_payroll_h = await make_user(
        "hrnopay",
        roles=[role_hr_no_payroll],
    )
    pay_cfg_u, pay_cfg_h = await make_user(
        "paycfg",
        roles=[hr_role],
        grants=["hrms.payroll", "hrms.payroll.configure"],
        denies=["hrms.payroll.approve"],
    )
    pay_app_u, pay_app_h = await make_user(
        "payapp",
        roles=[hr_role],
        grants=["hrms.payroll", "hrms.payroll.approve"],
        denies=["hrms.payroll.configure"],
    )
    mgr_eng_u, mgr_eng_h = await make_user("mgreng", roles=[dept_eng, role_dept_mgr, employee_role])
    emp_a_u, emp_a_h = await make_user("empa", roles=[dept_eng, employee_role], manager_id=mgr_eng_u.id)
    emp_b_u, emp_b_h = await make_user("empb", roles=[dept_eng, employee_role], manager_id=mgr_eng_u.id)
    emp_ops_u, emp_ops_h = await make_user("empops", roles=[dept_ops, employee_role])
    readonly_u, readonly_h = await make_user("ronly", roles=[role_readonly])

    app = create_application()
    transport = ASGITransport(app=app, raise_app_exceptions=False)
    try:
        async with AsyncClient(transport=transport, base_url="http://testserver") as client:
            yield {
                "tag": tag,
                "password": raw_password,
                "client": client,
                "SessionFactory": SessionFactory,
                "make_user": make_user,
                "roles": {
                    "super_admin": super_admin_role,
                    "hr": hr_role,
                    "hr_no_payroll": role_hr_no_payroll,
                    "employee": employee_role,
                    "dept_eng": dept_eng,
                    "dept_ops": dept_ops,
                    "dept_mgr": role_dept_mgr,
                    "readonly": role_readonly,
                },
                "users": {
                    "admin": (admin_u, admin_h),
                    "hr_full": (hr_full_u, hr_full_h),
                    "hr_deny": (hr_deny_all_u, hr_deny_all_h),
                    "hr_no_payroll": (hr_no_payroll_u, hr_no_payroll_h),
                    "pay_cfg": (pay_cfg_u, pay_cfg_h),
                    "pay_app": (pay_app_u, pay_app_h),
                    "mgr_eng": (mgr_eng_u, mgr_eng_h),
                    "emp_a": (emp_a_u, emp_a_h),
                    "emp_b": (emp_b_u, emp_b_h),
                    "emp_ops": (emp_ops_u, emp_ops_h),
                    "readonly": (readonly_u, readonly_h),
                },
                "leave_types": {"cl": lt_cl, "sl": lt_sl, "lwp": lt_lwp},
                "track_payroll_month": lambda m: created_payroll_months.add(m),
                "track_holiday_id": lambda hid: created_holiday_ids.append(hid),
                "track_expense_id": lambda eid: created_expense_ids.append(eid),
                "track_local_file": lambda p: created_local_files.append(p),
            }
    finally:
        # Clean up all synthetic rows in local PG18
        async with SessionFactory() as s:
            if created_payroll_months:
                p_ids = (
                    await s.execute(
                        select(HrmsMonthlyPayroll.id).where(
                            HrmsMonthlyPayroll.payroll_month.in_(list(created_payroll_months))
                        )
                    )
                ).scalars().all()
                if p_ids:
                    await s.execute(delete(HrmsMonthlyPayrollItem).where(HrmsMonthlyPayrollItem.payroll_id.in_(p_ids)))
                    await s.execute(delete(HrmsMonthlyPayroll).where(HrmsMonthlyPayroll.id.in_(p_ids)))

            if created_user_ids:
                await s.execute(delete(Notification).where(Notification.user_id.in_(created_user_ids)))
                await s.execute(delete(HrmsMonthlyPayrollItem).where(HrmsMonthlyPayrollItem.employee_id.in_(created_user_ids)))
                await s.execute(delete(HrmsPayrollAdjustment).where(HrmsPayrollAdjustment.employee_id.in_(created_user_ids)))
                await s.execute(delete(HrmsEmployeeSalary).where(HrmsEmployeeSalary.employee_id.in_(created_user_ids)))
                await s.execute(delete(HrmsAttendanceRegularization).where(HrmsAttendanceRegularization.employee_id.in_(created_user_ids)))
                await s.execute(delete(HrmsAttendance).where(HrmsAttendance.employee_id.in_(created_user_ids)))
                await s.execute(delete(HrmsLeaveAdjustment).where(HrmsLeaveAdjustment.employee_id.in_(created_user_ids)))
                await s.execute(delete(HrmsLeaveRequest).where(HrmsLeaveRequest.employee_id.in_(created_user_ids)))
                await s.execute(delete(HrmsEmployeeLeaveBalance).where(HrmsEmployeeLeaveBalance.employee_id.in_(created_user_ids)))
                await s.execute(delete(HrmsExpense).where(HrmsExpense.employee_id.in_(created_user_ids)))
                await s.execute(delete(UserPermission).where(UserPermission.user_id.in_(created_user_ids)))
                await s.execute(delete(UserRole).where(UserRole.user_id.in_(created_user_ids)))
                await s.execute(delete(User).where(User.id.in_(created_user_ids)))

            if created_expense_ids:
                await s.execute(delete(HrmsExpense).where(HrmsExpense.id.in_(created_expense_ids)))
            if created_holiday_ids:
                await s.execute(delete(HrmsHoliday).where(HrmsHoliday.id.in_(created_holiday_ids)))
            if created_plan_ids:
                await s.execute(delete(HrmsLeavePlanType).where(HrmsLeavePlanType.plan_id.in_(created_plan_ids)))
                await s.execute(delete(HrmsLeavePlan).where(HrmsLeavePlan.id.in_(created_plan_ids)))
            if created_lt_ids:
                await s.execute(delete(HrmsLeaveAdjustment).where(HrmsLeaveAdjustment.leave_type_id.in_(created_lt_ids)))
                await s.execute(delete(HrmsLeaveRequest).where(HrmsLeaveRequest.leave_type_id.in_(created_lt_ids)))
                await s.execute(delete(HrmsEmployeeLeaveBalance).where(HrmsEmployeeLeaveBalance.leave_type_id.in_(created_lt_ids)))
                await s.execute(delete(HrmsLeaveType).where(HrmsLeaveType.id.in_(created_lt_ids)))
            if created_comp_ids:
                await s.execute(delete(HrmsPayrollComponent).where(HrmsPayrollComponent.id.in_(created_comp_ids)))
            if created_role_ids:
                await s.execute(delete(RolePermission).where(RolePermission.role_id.in_(created_role_ids)))
                await s.execute(delete(UserRole).where(UserRole.role_id.in_(created_role_ids)))
                await s.execute(delete(Role).where(Role.id.in_(created_role_ids)))

            await s.commit()

        for fp in created_local_files:
            try:
                if fp.is_file():
                    fp.unlink()
            except Exception:
                pass

        await engine.dispose()
        await engine_module.dispose_engine()
        os.environ["DATABASE_URL"] = prev_db_url
        object.__setattr__(settings, "DATABASE_URL", prev_db_url)
        if prev_direct_url is not None and hasattr(settings, "DIRECT_URL"):
            object.__setattr__(settings, "DIRECT_URL", prev_direct_url)
        for attr, prev in (
            ("SUPABASE_URL", prev_supa_url),
            ("SUPABASE_SERVICE_KEY", prev_supa_key),
            ("SUPABASE_SERVICE_ROLE_KEY", prev_supa_role_key),
            ("SUPABASE_ANON_KEY", prev_supa_anon),
        ):
            if prev is not None and hasattr(settings, attr):
                object.__setattr__(settings, attr, prev)


# =============================================================================
# AREA A: LEAVE DATA PRIVACY / IDOR (HRMS-BUG-01)
# =============================================================================


@pytest.mark.asyncio
async def test_a_leave_idor_same_department_coworker_and_identifier_paths(wave1_env):
    """Ordinary employee cannot access same-dept coworker's leave balances, requests, adjustments, or approvals."""
    client: AsyncClient = wave1_env["client"]
    SessionFactory = wave1_env["SessionFactory"]
    lt_cl = wave1_env["leave_types"]["cl"]
    emp_a, emp_a_h = wave1_env["users"]["emp_a"]
    emp_b, emp_b_h = wave1_env["users"]["emp_b"]
    emp_ops, emp_ops_h = wave1_env["users"]["emp_ops"]
    mgr_eng, mgr_eng_h = wave1_env["users"]["mgr_eng"]
    hr_full, hr_full_h = wave1_env["users"]["hr_full"]
    admin, admin_h = wave1_env["users"]["admin"]

    # Seed balances & a leave request for emp_b and emp_ops
    async with SessionFactory() as s:
        for u in (emp_a, emp_b, emp_ops):
            s.add(
                HrmsEmployeeLeaveBalance(
                    employee_id=u.id, leave_type_id=lt_cl.id, year=2026,
                    allocated=12.0, consumed=0.0, adjusted=0.0, available=12.0,
                )
            )
        req_b = HrmsLeaveRequest(
            employee_id=emp_b.id, leave_type_id=lt_cl.id,
            from_date=date(2026, 12, 1), to_date=date(2026, 12, 2),
            number_of_days=2.0, reason="Private medical leave B",
            status="PENDING", approval_status="PENDING",
            created_by=emp_b.id, updated_by=emp_b.id,
        )
        req_ops = HrmsLeaveRequest(
            employee_id=emp_ops.id, leave_type_id=lt_cl.id,
            from_date=date(2026, 12, 3), to_date=date(2026, 12, 4),
            number_of_days=2.0, reason="Private Ops leave",
            status="PENDING", approval_status="PENDING",
            created_by=emp_ops.id, updated_by=emp_ops.id,
        )
        s.add_all([req_b, req_ops])
        await s.commit()
        await s.refresh(req_b)
        await s.refresh(req_ops)

    # 1. Ordinary employee A CAN access own data
    assert (await client.get("/api/v1/hrms/leave/balances", headers=emp_a_h)).status_code == 200
    assert (await client.get(f"/api/v1/hrms/leave/balances/{emp_a.id}", headers=emp_a_h)).status_code == 200
    assert (await client.get("/api/v1/hrms/leave/requests", headers=emp_a_h)).status_code == 200

    # 2. Ordinary employee A CANNOT access same-department coworker B via UUID, employee_code, or username
    for ident in (str(emp_b.id), emp_b.employee_code, emp_b.username):
        r1 = await client.get(f"/api/v1/hrms/leave/balances?employee_id={ident}", headers=emp_a_h)
        assert r1.status_code == 403, f"IDOR leak on GET /balances?employee_id={ident}: {r1.status_code}"

        r2 = await client.get(f"/api/v1/hrms/leave/balances/{ident}", headers=emp_a_h)
        assert r2.status_code == 403, f"IDOR leak on GET /balances/{ident}: {r2.status_code}"

        r3 = await client.get(f"/api/v1/hrms/leave/requests?employee_id={ident}", headers=emp_a_h)
        assert r3.status_code == 403, f"IDOR leak on GET /requests?employee_id={ident}: {r3.status_code}"

        r4 = await client.get(f"/api/v1/hrms/leave/adjustments?employee_id={ident}", headers=emp_a_h)
        assert r4.status_code == 403, f"IDOR leak on GET /adjustments?employee_id={ident}: {r4.status_code}"

        r5 = await client.get(f"/api/v1/hrms/leave/adjustments/history?employee_id={ident}", headers=emp_a_h)
        assert r5.status_code == 403, f"IDOR leak on GET /adjustments/history?employee_id={ident}: {r5.status_code}"

        r6 = await client.get(f"/api/v1/hrms/leave/adjustments/{ident}", headers=emp_a_h)
        assert r6.status_code == 403, f"IDOR leak on GET /adjustments/{ident}: {r6.status_code}"

        r7 = await client.get(
            f"/api/v1/hrms/leave/calculate-days?from_date=2026-12-08&to_date=2026-12-09&employee_id={ident}",
            headers=emp_a_h,
        )
        assert r7.status_code == 403, f"IDOR leak on GET /calculate-days?employee_id={ident}: {r7.status_code}"

        r8 = await client.get(f"/api/v1/hrms/leave/applicable-types?employee_id={ident}", headers=emp_a_h)
        assert r8.status_code == 403, f"IDOR leak on GET /applicable-types?employee_id={ident}: {r8.status_code}"

    # 3. Ordinary employee A CANNOT view coworker B's individual request, approval queue, or matrix
    assert (await client.get(f"/api/v1/hrms/leave/requests/{req_b.id}", headers=emp_a_h)).status_code == 403
    assert (await client.get("/api/v1/hrms/leave/approvals", headers=emp_a_h)).status_code == 403
    assert (await client.get("/api/v1/hrms/leave/matrix", headers=emp_a_h)).status_code == 403
    assert (await client.get("/api/v1/hrms/leave/adjustments/matrix", headers=emp_a_h)).status_code == 403

    # 4. Ordinary employee A CANNOT create leave request on behalf of B (via body or query)
    r_body = await client.post(
        "/api/v1/hrms/leave/requests",
        json={
            "employee_id": str(emp_b.id),
            "leave_type_id": str(lt_cl.id),
            "from_date": "2026-12-15",
            "to_date": "2026-12-15",
            "reason": "Forged leave",
        },
        headers=emp_a_h,
    )
    assert r_body.status_code == 403

    r_qry = await client.post(
        f"/api/v1/hrms/leave/requests?employee_id={emp_b.id}",
        json={
            "leave_type_id": str(lt_cl.id),
            "from_date": "2026-12-16",
            "to_date": "2026-12-16",
            "reason": "Forged query leave",
        },
        headers=emp_a_h,
    )
    assert r_qry.status_code == 403

    # 5. Department Manager CAN access own department employee B (UUID, code, username) & approvals queue,
    #    but CANNOT access outside-department emp_ops!
    for ident in (str(emp_b.id), emp_b.employee_code, emp_b.username):
        assert (await client.get(f"/api/v1/hrms/leave/balances/{ident}", headers=mgr_eng_h)).status_code == 200
    assert (await client.get(f"/api/v1/hrms/leave/requests/{req_b.id}", headers=mgr_eng_h)).status_code == 200
    r_mgr_q = await client.get("/api/v1/hrms/leave/approvals", headers=mgr_eng_h)
    assert r_mgr_q.status_code == 200
    q_emp_ids = {item["employee_id"] for item in r_mgr_q.json()["data"]}
    assert str(emp_b.id) in q_emp_ids
    assert str(emp_ops.id) not in q_emp_ids

    assert (await client.get(f"/api/v1/hrms/leave/balances/{emp_ops.id}", headers=mgr_eng_h)).status_code == 403
    assert (await client.get(f"/api/v1/hrms/leave/requests/{req_ops.id}", headers=mgr_eng_h)).status_code == 403

    # 6. Manager-first approval & HR fallback preserved:
    #    HR cannot approve emp_b while mgr_eng is active & available -> 403
    r_hr_block = await client.patch(
        f"/api/v1/hrms/leave/approvals/{req_b.id}/approve",
        json={"approval_remarks": "HR premature"},
        headers=hr_full_h,
    )
    assert r_hr_block.status_code == 403

    #    HR CAN approve emp_ops (unassigned manager -> HR fallback) -> 200
    r_hr_fb = await client.patch(
        f"/api/v1/hrms/leave/approvals/{req_ops.id}/approve",
        json={"approval_remarks": "HR fallback approved"},
        headers=hr_full_h,
    )
    assert r_hr_fb.status_code == 200

    #    Assigned manager mgr_eng CAN approve emp_b -> 200
    r_mgr_app = await client.patch(
        f"/api/v1/hrms/leave/approvals/{req_b.id}/approve",
        json={"approval_remarks": "Manager approved"},
        headers=mgr_eng_h,
    )
    assert r_mgr_app.status_code == 200

    # 7. Admin retains company-wide access
    assert (await client.get(f"/api/v1/hrms/leave/balances/{emp_ops.id}", headers=admin_h)).status_code == 200


# =============================================================================
# AREA B: PAYROLL CALCULATION CORRECTNESS (11 SCENARIOS)
# =============================================================================


@pytest.mark.asyncio
async def test_b_payroll_11_expected_value_scenarios(wave1_env):
    """Independently verify all 11 payroll calculation scenarios with exact Decimal arithmetic."""
    SessionFactory = wave1_env["SessionFactory"]
    make_user = wave1_env["make_user"]
    roles = wave1_env["roles"]
    lt_cl = wave1_env["leave_types"]["cl"]
    lt_lwp = wave1_env["leave_types"]["lwp"]
    admin, _ = wave1_env["users"]["admin"]
    track_month = wave1_env["track_payroll_month"]
    track_holiday = wave1_env["track_holiday_id"]

    # Create dedicated isolated employees for Scenarios 1..10 so none interfere with each other
    u_full_clean, _ = await make_user("p01", roles=[roles["dept_eng"], roles["employee"]])
    u_unpaid_lwp, _ = await make_user("p02", roles=[roles["dept_eng"], roles["employee"]])
    u_paid_leave, _ = await make_user("p03", roles=[roles["dept_eng"], roles["employee"]])
    u_mid_clean, _ = await make_user("p04a", roles=[roles["dept_eng"], roles["employee"]])
    u_mid_1abs, _ = await make_user("p04b", roles=[roles["dept_eng"], roles["employee"]])
    u_miss_part, _ = await make_user("p05a", roles=[roles["dept_eng"], roles["employee"]])
    u_miss_none, _ = await make_user("p05b", roles=[roles["dept_eng"], roles["employee"]])
    u_pend_lv, _ = await make_user("p06", roles=[roles["dept_eng"], roles["employee"]])
    u_rej_lv, _ = await make_user("p07", roles=[roles["dept_eng"], roles["employee"]])
    u_reg_app, _ = await make_user("p08", roles=[roles["dept_eng"], roles["employee"]])
    u_zero_sal, _ = await make_user("p10", roles=[roles["dept_eng"], roles["employee"]])

    # Use past completed month 2024-04 (April 2024: 30 days, Sundays = 7,14,21,28 -> 4 Sundays, 0 holidays -> 26 working days)
    past_month = "2024-04"
    track_month(past_month)
    p_year, p_mon = 2024, 4
    working_dates_apr = [
        date(p_year, p_mon, d) for d in range(1, 31) if date(p_year, p_mon, d).weekday() != 6
    ]
    assert len(working_dates_apr) == 26

    # Assign ₹3,12,000 Annual CTC (₹26,000/month -> ₹1,000.00/day across 26 working days!) for crystal-clear verification
    annual_ctc_val = 312000.0
    async with SessionFactory() as s:
        svc = HrmsPayrollService(s)
        preview_26k = await svc.calculate_preview(annual_ctc_val)
        monthly_gross = Decimal(str(preview_26k.monthly_gross))
        std_ded = Decimal(str(preview_26k.total_deductions))

        # Assign salaries
        for u in (
            u_full_clean, u_unpaid_lwp, u_paid_leave,
            u_mid_clean, u_mid_1abs,
            u_miss_part, u_miss_none,
            u_pend_lv, u_rej_lv, u_reg_app,
        ):
            s.add(
                HrmsEmployeeSalary(
                    employee_id=u.id, annual_ctc=annual_ctc_val,
                    monthly_ctc=float(_q2(Decimal(str(annual_ctc_val)) / Decimal("12"))),
                    effective_from=date(2024, 1, 1), is_active=True,
                    structure_breakdown=preview_26k.model_dump(),
                    created_by=admin.id, updated_by=admin.id,
                )
            )
        # Scenario 10: Zero salary
        s.add(
            HrmsEmployeeSalary(
                employee_id=u_zero_sal.id, annual_ctc=0.0, monthly_ctc=0.0,
                effective_from=date(2024, 1, 1), is_active=True,
                structure_breakdown={}, created_by=admin.id, updated_by=admin.id,
            )
        )

        # Helper to insert PRESENT attendance rows
        def add_present(emp_id: uuid.UUID, dates_list: list[date]):
            for dt in dates_list:
                s.add(
                    HrmsAttendance(
                        employee_id=emp_id, attendance_date=dt,
                        punch_in=datetime(dt.year, dt.month, dt.day, 4, 0, tzinfo=timezone.utc),
                        punch_out=datetime(dt.year, dt.month, dt.day, 13, 0, tzinfo=timezone.utc),
                        status="PRESENT", working_minutes=540,
                        late_minutes=0, early_exit_minutes=0,
                        is_irregular=False, regularization_status="NONE",
                    )
                )

        # Scenario 1: Full month present (26/26)
        add_present(u_full_clean.id, working_dates_apr)

        # Scenario 2: 24 days present + 2 days APPROVED Unpaid Leave (LWP, is_paid=False)
        add_present(u_unpaid_lwp.id, working_dates_apr[:-2])
        s.add(
            HrmsLeaveRequest(
                employee_id=u_unpaid_lwp.id, leave_type_id=lt_lwp.id,
                from_date=working_dates_apr[-2], to_date=working_dates_apr[-1],
                number_of_days=2.0, reason="Unpaid LWP",
                status="APPROVED", approval_status="APPROVED",
                created_by=u_unpaid_lwp.id, approved_by=admin.id,
            )
        )

        # Scenario 3: 24 days present + 2 days APPROVED Paid Leave (CL, is_paid=True)
        add_present(u_paid_leave.id, working_dates_apr[:-2])
        s.add(
            HrmsLeaveRequest(
                employee_id=u_paid_leave.id, leave_type_id=lt_cl.id,
                from_date=working_dates_apr[-2], to_date=working_dates_apr[-1],
                number_of_days=2.0, reason="Paid CL",
                status="APPROVED", approval_status="APPROVED",
                created_by=u_paid_leave.id, approved_by=admin.id,
            )
        )

        # Scenario 5a: Partial missing attendance (23 present, 3 past working days missing -> 3 LOP)
        add_present(u_miss_part.id, working_dates_apr[:-3])
        # Scenario 5b: Zero attendance records (u_miss_none has no rows at all)

        # Scenario 6: 24 present + 2 days PENDING paid leave -> must be 2 LOP (NOT paid!)
        add_present(u_pend_lv.id, working_dates_apr[:-2])
        s.add(
            HrmsLeaveRequest(
                employee_id=u_pend_lv.id, leave_type_id=lt_cl.id,
                from_date=working_dates_apr[-2], to_date=working_dates_apr[-1],
                number_of_days=2.0, reason="Pending CL",
                status="PENDING", approval_status="PENDING",
                created_by=u_pend_lv.id,
            )
        )

        # Scenario 7: 24 present + 2 days REJECTED paid leave -> must be 2 LOP (NOT paid!)
        add_present(u_rej_lv.id, working_dates_apr[:-2])
        s.add(
            HrmsLeaveRequest(
                employee_id=u_rej_lv.id, leave_type_id=lt_cl.id,
                from_date=working_dates_apr[-2], to_date=working_dates_apr[-1],
                number_of_days=2.0, reason="Rejected CL",
                status="REJECTED", approval_status="REJECTED",
                created_by=u_rej_lv.id, approved_by=admin.id,
            )
        )

        # Scenario 8: 25 present + 1 day APPROVED regularization -> 26 present, 0 LOP!
        add_present(u_reg_app.id, working_dates_apr[:-1])
        reg_dt = working_dates_apr[-1]
        s.add(
            HrmsAttendance(
                employee_id=u_reg_app.id, attendance_date=reg_dt,
                status="ABSENT", working_minutes=0,
                late_minutes=0, early_exit_minutes=0,
                is_irregular=False, regularization_status="APPROVED",
            )
        )

        # Scenario 10: Zero salary with full attendance
        add_present(u_zero_sal.id, working_dates_apr)

        await s.commit()

        # Calculate 2024-04 payroll
        await svc.calculate_monthly_payroll(past_month, admin.id)
        pr = await svc.get_monthly_payroll(past_month)
        items_by_emp = {it.employee_id: it for it in pr.items}

        # --- Assertions Scenarios 1, 2, 3, 5a, 5b, 6, 7, 8, 10 ---
        # 1. Full month, no unpaid leave
        it1 = items_by_emp[u_full_clean.id]
        assert it1.working_days == 26
        assert it1.present_days == 26.0
        assert it1.lop_days == 0.0
        assert it1.lop_deduction == 0.0
        assert Decimal(str(it1.net_salary)) == _q2(monthly_gross - std_ded)

        # 2. Full month with 2 days APPROVED UNPAID LEAVE (LWP) -> HRMS-BUG-02
        it2 = items_by_emp[u_unpaid_lwp.id]
        exp_lop_2 = _q2((monthly_gross / Decimal("26")) * Decimal("2"))
        assert it2.paid_leave_days == 0.0, f"Unpaid LWP counted as paid_leave_days={it2.paid_leave_days}"
        assert it2.lop_days == 2.0, f"Unpaid LWP lop_days expected 2.0, got {it2.lop_days}"
        assert Decimal(str(it2.lop_deduction)) == exp_lop_2
        assert Decimal(str(it2.net_salary)) == max(Decimal("0.00"), _q2(monthly_gross - std_ded - exp_lop_2))

        # 3. Full month with 2 days APPROVED PAID LEAVE (CL)
        it3 = items_by_emp[u_paid_leave.id]
        assert it3.paid_leave_days == 2.0
        assert it3.lop_days == 0.0
        assert it3.lop_deduction == 0.0
        assert Decimal(str(it3.net_salary)) == _q2(monthly_gross - std_ded)

        # 5a. Partial missing attendance (3 past days absent)
        it5a = items_by_emp[u_miss_part.id]
        exp_lop_3 = _q2((monthly_gross / Decimal("26")) * Decimal("3"))
        assert it5a.present_days == 23.0
        assert it5a.lop_days == 3.0
        assert Decimal(str(it5a.lop_deduction)) == exp_lop_3

        # 5b. Zero attendance records -> existing documented policy (0 LOP)
        it5b = items_by_emp[u_miss_none.id]
        assert it5b.lop_days == 0.0
        assert it5b.lop_deduction == 0.0

        # 6. Pending leave -> NOT paid, treated as LOP
        it6 = items_by_emp[u_pend_lv.id]
        assert it6.paid_leave_days == 0.0
        assert it6.lop_days == 2.0
        assert Decimal(str(it6.lop_deduction)) == exp_lop_2

        # 7. Rejected leave -> NOT paid, treated as LOP
        it7 = items_by_emp[u_rej_lv.id]
        assert it7.paid_leave_days == 0.0
        assert it7.lop_days == 2.0
        assert Decimal(str(it7.lop_deduction)) == exp_lop_2

        # 8. Approved regularization -> Present, 0 LOP
        it8 = items_by_emp[u_reg_app.id]
        assert it8.present_days == 26.0
        assert it8.lop_days == 0.0
        assert it8.lop_deduction == 0.0

        # 10. Zero salary -> safe 0 values, no negative net or crash
        it10 = items_by_emp[u_zero_sal.id]
        assert it10.annual_ctc == 0.0
        assert it10.gross_amount == 0.0
        assert it10.total_deductions == 0.0
        assert it10.net_salary == 0.0

        # --- Scenario 4: Mid-month payroll calculation (HRMS-BUG-03) ---
        # Use current calendar month if today < end of month; otherwise pick a future month where days are FUTURE
        today_ist = datetime.now(timezone(timedelta(hours=5, minutes=30))).date()
        import calendar as calmod
        cur_days_in_mo = calmod.monthrange(today_ist.year, today_ist.month)[1]
        if today_ist.day < cur_days_in_mo:
            mid_y, mid_m = today_ist.year, today_ist.month
        else:
            # Fallback if run on last day of month: next month has all future days
            mid_y = today_ist.year + (1 if today_ist.month == 12 else 0)
            mid_m = 1 if today_ist.month == 12 else today_ist.month + 1
            cur_days_in_mo = calmod.monthrange(mid_y, mid_m)[1]

        mid_month_str = f"{mid_y:04d}-{mid_m:02d}"
        # Only track cleanup if this month didn't already exist in test db
        ex_mid = (await s.execute(select(HrmsMonthlyPayroll).where(HrmsMonthlyPayroll.payroll_month == mid_month_str))).scalar_one_or_none()
        if not ex_mid:
            track_month(mid_month_str)

        mid_cal = await svc._calculate_calendar_metrics(mid_y, mid_m)
        mid_working_total = mid_cal["working_days"]
        mid_hols = mid_cal["holiday_dates"]
        elapsed_work_days = [
            date(mid_y, mid_m, d)
            for d in range(1, min(today_ist.day, cur_days_in_mo) + 1)
            if date(mid_y, mid_m, d).weekday() != 6
            and date(mid_y, mid_m, d) not in mid_hols
            and date(mid_y, mid_m, d) <= today_ist
        ]
        # Clean mid-month employee attended every elapsed working day
        add_present(u_mid_clean.id, elapsed_work_days)
        # Second mid-month employee missed exactly 1 past working day (earliest elapsed < today)
        past_elapsed = [d for d in elapsed_work_days if d < today_ist]
        if past_elapsed:
            add_present(u_mid_1abs.id, [d for d in elapsed_work_days if d != past_elapsed[0]])
        await s.commit()

        await svc.calculate_monthly_payroll(mid_month_str, admin.id)
        pr_mid = await svc.get_monthly_payroll(mid_month_str)
        mid_items = {it.employee_id: it for it in pr_mid.items}

        it4a = mid_items[u_mid_clean.id]
        assert it4a.lop_days == 0.0, f"Future days wrongly deducted as LOP! lop_days={it4a.lop_days}"
        assert it4a.lop_deduction == 0.0

        if past_elapsed:
            it4b = mid_items[u_mid_1abs.id]
            exp_mid_lop = _q2(monthly_gross / Decimal(str(mid_working_total)))
            assert it4b.lop_days == 1.0, f"Expected exactly 1.0 LOP mid-month, got {it4b.lop_days}"
            assert Decimal(str(it4b.lop_deduction)) == exp_mid_lop

        # --- Scenario 9: Zero working days (all non-Sunday weekdays in 2024-02 marked as active corporate holidays) ---
        zero_month = "2024-02"
        track_month(zero_month)
        for d in range(1, 30):  # Feb 2024 is leap year (29 days)
            dt = date(2024, 2, d)
            if dt.weekday() != 6:
                h = HrmsHoliday(
                    name=f"W1 Hol {d}", holiday_date=dt, number_of_days=1,
                    branch_applicability="All Branches", is_active=True,
                )
                s.add(h)
                await s.flush()
                track_holiday(h.id)
        await s.commit()

        pr_zero = await svc.calculate_monthly_payroll(zero_month, admin.id)
        assert pr_zero.working_days == 0
        pr_zero_full = await svc.get_monthly_payroll(zero_month)
        it9 = next(it for it in pr_zero_full.items if it.employee_id == u_full_clean.id)
        assert it9.working_days == 0
        assert it9.lop_deduction == 0.0

    # --- Scenario 11: Concurrent calculation attempts for same fresh month on real PG18 ---
    conc_month = "2024-05"
    track_month(conc_month)

    async def _run_calc():
        async with SessionFactory() as cs:
            c_svc = HrmsPayrollService(cs)
            p = await c_svc.calculate_monthly_payroll(conc_month, admin.id)
            return p.id, p.total_employees, p.total_net

    results = await asyncio.gather(*[_run_calc() for _ in range(6)], return_exceptions=True)
    errors = [r for r in results if isinstance(r, Exception)]
    assert not errors, f"Concurrent payroll calculation raised errors: {errors}"
    payroll_ids = {r[0] for r in results}
    assert len(payroll_ids) == 1, "Concurrent calculation created duplicate HrmsMonthlyPayroll rows!"

    async with SessionFactory() as s:
        p_count = (await s.execute(select(func.count(HrmsMonthlyPayroll.id)).where(HrmsMonthlyPayroll.payroll_month == conc_month))).scalar()
        assert p_count == 1
        item_rows = (
            await s.execute(
                select(HrmsMonthlyPayrollItem.employee_id).where(HrmsMonthlyPayrollItem.payroll_id == next(iter(payroll_ids)))
            )
        ).scalars().all()
        assert len(item_rows) == len(set(item_rows)), "Duplicate employee items created under concurrency!"


# =============================================================================
# AREA C: LEAVE BALANCE CONCURRENCY (10 SCENARIOS — HRMS-BUG-04)
# =============================================================================


@pytest.mark.asyncio
async def test_c_leave_balance_10_concurrency_and_transaction_scenarios(wave1_env):
    """Verify all 10 leave approval concurrency, atomicity, cancellation, half-day, and multi-type scenarios."""
    client: AsyncClient = wave1_env["client"]
    SessionFactory = wave1_env["SessionFactory"]
    make_user = wave1_env["make_user"]
    roles = wave1_env["roles"]
    lt_cl = wave1_env["leave_types"]["cl"]
    lt_sl = wave1_env["leave_types"]["sl"]
    admin, admin_h = wave1_env["users"]["admin"]
    mgr_eng, mgr_eng_h = wave1_env["users"]["mgr_eng"]

    u_emp, _ = await make_user("lvc", roles=[roles["dept_eng"], roles["employee"]], manager_id=mgr_eng.id)

    async def reset_bal(lt_id: uuid.UUID, allocated: float = 10.0) -> uuid.UUID:
        async with SessionFactory() as s:
            existing = (
                await s.execute(
                    select(HrmsEmployeeLeaveBalance).where(
                        HrmsEmployeeLeaveBalance.employee_id == u_emp.id,
                        HrmsEmployeeLeaveBalance.leave_type_id == lt_id,
                        HrmsEmployeeLeaveBalance.year == 2027,
                    )
                )
            ).scalar_one_or_none()
            if existing:
                existing.allocated = allocated
                existing.consumed = 0.0
                existing.adjusted = 0.0
                existing.available = allocated
                bal_id = existing.id
            else:
                b = HrmsEmployeeLeaveBalance(
                    employee_id=u_emp.id, leave_type_id=lt_id, year=2027,
                    allocated=allocated, consumed=0.0, adjusted=0.0, available=allocated,
                )
                s.add(b)
                await s.flush()
                bal_id = b.id
            await s.commit()
            return bal_id

    async def get_bal(lt_id: uuid.UUID) -> tuple[float, float]:
        async with SessionFactory() as s:
            b = (
                await s.execute(
                    select(HrmsEmployeeLeaveBalance).where(
                        HrmsEmployeeLeaveBalance.employee_id == u_emp.id,
                        HrmsEmployeeLeaveBalance.leave_type_id == lt_id,
                        HrmsEmployeeLeaveBalance.year == 2027,
                    )
                )
            ).scalar_one()
            return b.consumed, b.available

    async def seed_req(lt_id: uuid.UUID, d1: date, d2: date, days: float) -> uuid.UUID:
        async with SessionFactory() as s:
            r = HrmsLeaveRequest(
                employee_id=u_emp.id, leave_type_id=lt_id,
                from_date=d1, to_date=d2, number_of_days=days,
                reason=f"Concurrency test {days}d",
                status="PENDING", approval_status="PENDING",
                created_by=u_emp.id, updated_by=u_emp.id,
            )
            s.add(r)
            await s.commit()
            await s.refresh(r)
            return r.id

    # 1. One approval request
    await reset_bal(lt_cl.id, 10.0)
    r1 = await seed_req(lt_cl.id, date(2027, 1, 4), date(2027, 1, 5), 2.0)
    resp1 = await client.patch(f"/api/v1/hrms/leave/approvals/{r1}/approve", json={"approval_remarks": "ok"}, headers=mgr_eng_h)
    assert resp1.status_code == 200
    assert await get_bal(lt_cl.id) == (2.0, 8.0)

    # 2. Same approval submitted twice sequentially
    resp1_dup = await client.patch(f"/api/v1/hrms/leave/approvals/{r1}/approve", json={"approval_remarks": "dup"}, headers=mgr_eng_h)
    assert resp1_dup.status_code == 400
    assert await get_bal(lt_cl.id) == (2.0, 8.0)

    # 3. Same approval submitted concurrently (6 parallel HTTP requests on PG18!) — HRMS-BUG-04
    await reset_bal(lt_cl.id, 10.0)
    r3 = await seed_req(lt_cl.id, date(2027, 2, 1), date(2027, 2, 2), 2.0)
    resps_conc = await asyncio.gather(
        *[
            client.patch(f"/api/v1/hrms/leave/approvals/{r3}/approve", json={"approval_remarks": f"race-{i}"}, headers=mgr_eng_h)
            for i in range(6)
        ]
    )
    codes = sorted(r.status_code for r in resps_conc)
    assert codes.count(200) == 1, f"Duplicate concurrent approval! Statuses={codes}"
    assert codes.count(400) == 5, f"Expected 5x400 losers, got {codes}"
    assert await get_bal(lt_cl.id) == (2.0, 8.0), f"Double deduction detected! bal={await get_bal(lt_cl.id)}"

    # 4. Two different leave requests competing for remaining balance (avail=3.0, reqA=2.0, reqB=2.0)
    await reset_bal(lt_cl.id, 3.0)
    ra = await seed_req(lt_cl.id, date(2027, 3, 1), date(2027, 3, 2), 2.0)
    rb = await seed_req(lt_cl.id, date(2027, 3, 8), date(2027, 3, 9), 2.0)
    res_ab = await asyncio.gather(
        client.patch(f"/api/v1/hrms/leave/approvals/{ra}/approve", json={"approval_remarks": "raceA"}, headers=mgr_eng_h),
        client.patch(f"/api/v1/hrms/leave/approvals/{rb}/approve", json={"approval_remarks": "raceB"}, headers=mgr_eng_h),
    )
    ab_codes = sorted(r.status_code for r in res_ab)
    assert ab_codes == [200, 400], f"Competing requests overspent balance! statuses={ab_codes}"
    consumed_ab, avail_ab = await get_bal(lt_cl.id)
    assert consumed_ab == 2.0 and avail_ab == 1.0, f"Balance corrupted: consumed={consumed_ab}, avail={avail_ab}"

    # 5. Approval followed by cancellation (admin cancels approved request -> balance restored)
    winner_id = ra if res_ab[0].status_code == 200 else rb
    r_cancel = await client.patch(f"/api/v1/hrms/leave/requests/{winner_id}/cancel", headers=admin_h)
    assert r_cancel.status_code == 200
    assert await get_bal(lt_cl.id) == (0.0, 3.0)

    # 6. Rejection -> balance unchanged
    await reset_bal(lt_cl.id, 10.0)
    r6 = await seed_req(lt_cl.id, date(2027, 4, 5), date(2027, 4, 6), 2.0)
    resp6 = await client.patch(f"/api/v1/hrms/leave/approvals/{r6}/reject", json={"approval_remarks": "No"}, headers=mgr_eng_h)
    assert resp6.status_code == 200
    assert await get_bal(lt_cl.id) == (0.0, 10.0)

    # 7. Failed transaction followed by retry -> rollback leaves balance intact, retry deducts once
    await reset_bal(lt_cl.id, 10.0)
    r7 = await seed_req(lt_cl.id, date(2027, 5, 3), date(2027, 5, 4), 2.0)
    with patch("app.hrms.leave_service.notify_leave_decision", side_effect=RuntimeError("Simulated notification DB error")):
        async with SessionFactory() as s:
            svc = HrmsLeaveService(s)
            with pytest.raises(RuntimeError):
                await svc.approve_leave_request(r7, reviewer_id=admin.id, remarks="fail", is_admin=True)
            await s.rollback()
    assert await get_bal(lt_cl.id) == (0.0, 10.0)
    resp7_retry = await client.patch(f"/api/v1/hrms/leave/approvals/{r7}/approve", json={"approval_remarks": "retry"}, headers=mgr_eng_h)
    assert resp7_retry.status_code == 200
    assert await get_bal(lt_cl.id) == (2.0, 8.0)

    # 8. Insufficient balance -> rejected 400, balance unchanged
    await reset_bal(lt_cl.id, 1.0)
    r8 = await seed_req(lt_cl.id, date(2027, 6, 1), date(2027, 6, 3), 3.0)
    resp8 = await client.patch(f"/api/v1/hrms/leave/approvals/{r8}/approve", json={"approval_remarks": "insuff"}, headers=mgr_eng_h)
    assert resp8.status_code == 400
    assert await get_bal(lt_cl.id) == (0.0, 1.0)

    # 9. Half-day leave (0.5 days) -> concurrent approval deducts 0.5 once, cancel restores 0.5
    await reset_bal(lt_cl.id, 5.0)
    r9 = await seed_req(lt_cl.id, date(2027, 7, 1), date(2027, 7, 1), 0.5)
    res9 = await asyncio.gather(
        client.patch(f"/api/v1/hrms/leave/approvals/{r9}/approve", json={"approval_remarks": "half1"}, headers=mgr_eng_h),
        client.patch(f"/api/v1/hrms/leave/approvals/{r9}/approve", json={"approval_remarks": "half2"}, headers=mgr_eng_h),
    )
    assert sorted(r.status_code for r in res9) == [200, 400]
    assert await get_bal(lt_cl.id) == (0.5, 4.5)
    assert (await client.patch(f"/api/v1/hrms/leave/requests/{r9}/cancel", headers=admin_h)).status_code == 200
    assert await get_bal(lt_cl.id) == (0.0, 5.0)

    # 10. Different leave types with separate balances (CL vs SL)
    await reset_bal(lt_cl.id, 6.0)
    await reset_bal(lt_sl.id, 8.0)
    r10_cl = await seed_req(lt_cl.id, date(2027, 8, 2), date(2027, 8, 3), 2.0)
    r10_sl = await seed_req(lt_sl.id, date(2027, 8, 9), date(2027, 8, 11), 3.0)
    res10 = await asyncio.gather(
        client.patch(f"/api/v1/hrms/leave/approvals/{r10_cl}/approve", json={"approval_remarks": "cl"}, headers=mgr_eng_h),
        client.patch(f"/api/v1/hrms/leave/approvals/{r10_sl}/approve", json={"approval_remarks": "sl"}, headers=mgr_eng_h),
    )
    assert all(r.status_code == 200 for r in res10)
    assert await get_bal(lt_cl.id) == (2.0, 4.0)
    assert await get_bal(lt_sl.id) == (3.0, 5.0)


# =============================================================================
# AREA D: TERMINATED EMPLOYEE ACCESS (8 SCENARIOS — HRMS-BUG-05)
# =============================================================================


@pytest.mark.asyncio
async def test_d_terminated_employee_8_lifecycle_and_token_scenarios(wave1_env):
    """Verify all 8 terminated/inactive/active/reactivated employee access scenarios."""
    client: AsyncClient = wave1_env["client"]
    SessionFactory = wave1_env["SessionFactory"]
    make_user = wave1_env["make_user"]
    roles = wave1_env["roles"]
    password = wave1_env["password"]
    admin, admin_h = wave1_env["users"]["admin"]
    lt_cl = wave1_env["leave_types"]["cl"]

    u_active, _ = await make_user("dact", roles=[roles["dept_eng"], roles["employee"]])
    u_inactive, _ = await make_user(
        "dinact", roles=[roles["dept_eng"], roles["employee"]],
        is_active=False, user_status=UserStatus.INACTIVE,
    )
    u_term_active_login, _ = await make_user(
        "dterm", roles=[roles["dept_eng"], roles["employee"]],
        is_active=True, user_status=UserStatus.ACTIVE,
        employment_status=EmploymentStatus.TERMINATED,
    )
    # Employee who starts ACTIVE, logs in to obtain valid access+refresh tokens, then is TERMINATED
    u_live_term, _ = await make_user(
        "dliveterm", roles=[roles["dept_eng"], roles["employee"]],
        is_active=True, user_status=UserStatus.ACTIVE,
        employment_status=EmploymentStatus.ACTIVE,
    )

    # Seed a historical leave balance for u_live_term so Admin historical read can be verified
    async with SessionFactory() as s:
        s.add(
            HrmsEmployeeLeaveBalance(
                employee_id=u_live_term.id, leave_type_id=lt_cl.id, year=2026,
                allocated=12.0, consumed=2.0, adjusted=0.0, available=10.0,
            )
        )
        await s.commit()

    # 1. Active employee: login -> 200, HRMS API -> 200
    r_login_act = await client.post("/api/v1/auth/login", json={"identifier": u_active.username, "password": password})
    assert r_login_act.status_code == 200
    act_token = r_login_act.json()["data"]["access_token"]
    assert (await client.get("/api/v1/hrms/leave/balances", headers={"Authorization": f"Bearer {act_token}"})).status_code == 200

    # 2. Inactive employee: login -> 401
    r_login_inact = await client.post("/api/v1/auth/login", json={"identifier": u_inactive.username, "password": password})
    assert r_login_inact.status_code == 401

    # 3. Terminated employee with is_active=True, status=ACTIVE -> login MUST be rejected (401)!
    r_login_term = await client.post("/api/v1/auth/login", json={"identifier": u_term_active_login.username, "password": password})
    assert r_login_term.status_code == 401, f"Terminated employee logged in! status={r_login_term.status_code}"

    # 4 & 5 & 6. Employee logs in while ACTIVE, obtains valid access + refresh tokens, then is TERMINATED
    r_live = await client.post("/api/v1/auth/login", json={"identifier": u_live_term.username, "password": password})
    assert r_live.status_code == 200
    live_access = r_live.json()["data"]["access_token"]
    live_refresh = r_live.json()["data"]["refresh_token"]
    live_h = {"Authorization": f"Bearer {live_access}"}
    assert (await client.get("/api/v1/hrms/leave/balances", headers=live_h)).status_code == 200

    # Terminate employee while keeping is_active=True and status=ACTIVE
    async with SessionFactory() as s:
        db_u = await s.get(User, u_live_term.id)
        db_u.employment_status = EmploymentStatus.TERMINATED
        await s.commit()

    # 4. Existing access token rejected immediately
    r_me = await client.get("/api/v1/auth/profile", headers=live_h)
    assert r_me.status_code in (401, 403), f"Terminated token still worked on /auth/profile: {r_me.status_code}"

    # 5. Refresh token rejected immediately
    r_ref = await client.post("/api/v1/auth/refresh", json={"refresh_token": live_refresh})
    assert r_ref.status_code in (401, 403), f"Terminated user refreshed token: {r_ref.status_code}"

    # 6. Direct HRMS API requests with existing token all rejected
    for ep in (
        "/api/v1/hrms/leave/balances",
        "/api/v1/hrms/leave/requests",
        "/api/v1/hrms/expenses",
        "/api/v1/hrms/payroll/payslips",
        "/api/v1/hrms/attendance/today",
        "/api/v1/hrms/employees",
    ):
        r_ep = await client.get(ep, headers=live_h)
        assert r_ep.status_code in (401, 403), f"Terminated user accessed {ep}: {r_ep.status_code}"

    # 7. Authorized Admin CAN still view terminated employee's historical records (and is_active was NOT mutated)
    r_hist_bal = await client.get(f"/api/v1/hrms/leave/balances/{u_live_term.id}?year=2026", headers=admin_h)
    assert r_hist_bal.status_code == 200
    r_hist_sal = await client.get(f"/api/v1/hrms/payroll/salary/history/{u_live_term.id}", headers=admin_h)
    assert r_hist_sal.status_code == 200
    async with SessionFactory() as s:
        db_u = await s.get(User, u_live_term.id)
        assert db_u.is_active is True  # Unrelated account flag not silently overwritten

    # 8. Rejoining / reactivated employee (employment_status -> ACTIVE) regains login & HRMS access
    async with SessionFactory() as s:
        db_u = await s.get(User, u_live_term.id)
        db_u.employment_status = EmploymentStatus.ACTIVE
        await s.commit()

    r_rejoin = await client.post("/api/v1/auth/login", json={"identifier": u_live_term.username, "password": password})
    assert r_rejoin.status_code == 200
    rejoin_tok = r_rejoin.json()["data"]["access_token"]
    assert (await client.get("/api/v1/hrms/leave/balances", headers={"Authorization": f"Bearer {rejoin_tok}"})).status_code == 200


# =============================================================================
# AREA E: EXPENSE RECEIPT SECURITY (14 SCENARIOS — HRMS-BUG-07)
# =============================================================================


@pytest.mark.asyncio
async def test_e_expense_receipt_14_security_scenarios(wave1_env):
    """Verify all 14 receipt upload validation, private storage, signed URL, and RBAC download scenarios."""
    client: AsyncClient = wave1_env["client"]
    emp_a, emp_a_h = wave1_env["users"]["emp_a"]
    emp_b, emp_b_h = wave1_env["users"]["emp_b"]
    emp_ops, emp_ops_h = wave1_env["users"]["emp_ops"]
    mgr_eng, mgr_eng_h = wave1_env["users"]["mgr_eng"]
    hr_full, hr_full_h = wave1_env["users"]["hr_full"]
    track_exp = wave1_env["track_expense_id"]
    track_file = wave1_env["track_local_file"]

    pdf_bytes = _make_valid_pdf_bytes()
    jpg_bytes = _make_valid_image_bytes("JPEG")
    png_bytes = _make_valid_image_bytes("PNG")

    # 1. Valid PDF receipt
    r_pdf = await client.post(
        "/api/v1/hrms/expenses/upload-receipt",
        files={"file": ("taxi_bill.pdf", pdf_bytes, "application/pdf")},
        headers=emp_a_h,
    )
    assert r_pdf.status_code == 200, f"Valid PDF rejected: {r_pdf.text}"
    pdf_url = r_pdf.json()["data"]["file_url"]
    assert "/uploads/expenses/" not in pdf_url, f"Receipt stored in public URL: {pdf_url}"
    stored_pdf_name = pdf_url.rsplit("/", 1)[-1]
    track_file(Path("uploads") / "private" / "expenses" / stored_pdf_name)

    # 2. Valid JPEG receipt
    r_jpg = await client.post(
        "/api/v1/hrms/expenses/upload-receipt",
        files={"file": ("hotel.jpg", jpg_bytes, "image/jpeg")},
        headers=emp_a_h,
    )
    assert r_jpg.status_code == 200, f"Valid JPEG rejected: {r_jpg.text}"
    track_file(Path("uploads") / "private" / "expenses" / r_jpg.json()["data"]["file_url"].rsplit("/", 1)[-1])

    # 3. Valid PNG receipt
    r_png = await client.post(
        "/api/v1/hrms/expenses/upload-receipt",
        files={"file": ("meal.png", png_bytes, "image/png")},
        headers=emp_a_h,
    )
    assert r_png.status_code == 200, f"Valid PNG rejected: {r_png.text}"
    track_file(Path("uploads") / "private" / "expenses" / r_png.json()["data"]["file_url"].rsplit("/", 1)[-1])

    # 4. Executable renamed as PDF
    exe_payload = b"MZ\x90\x00\x03\x00\x00\x00\x04\x00\x00\x00\xff\xff\x00\x00This program cannot be run in DOS mode"
    r_exe = await client.post(
        "/api/v1/hrms/expenses/upload-receipt",
        files={"file": ("malware.pdf", exe_payload, "application/pdf")},
        headers=emp_a_h,
    )
    assert r_exe.status_code == 400, f"Executable renamed as PDF accepted! status={r_exe.status_code}"

    # 5. HTML renamed as image
    html_payload = b"<!DOCTYPE html><html><body><script>alert('xss')</script></body></html>"
    r_html = await client.post(
        "/api/v1/hrms/expenses/upload-receipt",
        files={"file": ("xss.png", html_payload, "image/png")},
        headers=emp_a_h,
    )
    assert r_html.status_code == 400, f"HTML renamed as PNG accepted! status={r_html.status_code}"

    # 6. MIME / extension mismatch (valid PDF sent with image/png MIME; valid PNG sent with application/pdf MIME)
    r_mis1 = await client.post(
        "/api/v1/hrms/expenses/upload-receipt",
        files={"file": ("bill.pdf", pdf_bytes, "image/png")},
        headers=emp_a_h,
    )
    assert r_mis1.status_code == 400, f"MIME/extension mismatch (pdf as image/png) accepted! {r_mis1.status_code}"

    r_mis2 = await client.post(
        "/api/v1/hrms/expenses/upload-receipt",
        files={"file": ("photo.png", png_bytes, "application/pdf")},
        headers=emp_a_h,
    )
    assert r_mis2.status_code == 400, f"MIME/extension mismatch (png as pdf) accepted! {r_mis2.status_code}"

    # 7. Corrupt file (truncated invalid PDF / corrupt JPEG bytes)
    r_corrupt_pdf = await client.post(
        "/api/v1/hrms/expenses/upload-receipt",
        files={"file": ("broken.pdf", b"%PDF-1.4\ncorrupted_no_eof", "application/pdf")},
        headers=emp_a_h,
    )
    assert r_corrupt_pdf.status_code == 400

    r_corrupt_jpg = await client.post(
        "/api/v1/hrms/expenses/upload-receipt",
        files={"file": ("broken.jpg", b"\xff\xd8\xff\xe0corrupted_jpeg_data", "image/jpeg")},
        headers=emp_a_h,
    )
    assert r_corrupt_jpg.status_code == 400

    # 8. Empty file
    r_empty = await client.post(
        "/api/v1/hrms/expenses/upload-receipt",
        files={"file": ("empty.pdf", b"", "application/pdf")},
        headers=emp_a_h,
    )
    assert r_empty.status_code == 400

    # 9. Oversized file (> 10 MB receipt cap)
    oversized_pdf = b"%PDF-1.4\n" + (b"A" * (10 * 1024 * 1024 + 512)) + b"\n%%EOF\n"
    r_big = await client.post(
        "/api/v1/hrms/expenses/upload-receipt",
        files={"file": ("huge.pdf", oversized_pdf, "application/pdf")},
        headers=emp_a_h,
    )
    assert r_big.status_code == 400

    # Create an actual expense claim for emp_a attached to the valid PDF receipt
    r_exp = await client.post(
        "/api/v1/hrms/expenses?submit=true",
        json={
            "expense_date": date.today().isoformat(),
            "category": "Travel",
            "amount": 450.0,
            "description": "Client airport taxi",
            "receipt_url": pdf_url,
            "receipt_filename": "taxi_bill.pdf",
            "is_submit": True,
        },
        headers=emp_a_h,
    )
    assert r_exp.status_code == 201, f"Failed creating expense: {r_exp.text}"
    exp_id = r_exp.json()["data"]["id"]
    track_exp(uuid.UUID(exp_id))

    # 10. Unauthorized employee download (emp_b same dept, emp_ops other dept, unauthenticated) -> 403 / 401
    assert (await client.get(f"/api/v1/hrms/expenses/{exp_id}/receipt")).status_code == 401
    assert (await client.get(f"/api/v1/hrms/expenses/{exp_id}/receipt", headers=emp_b_h)).status_code == 403
    assert (await client.get(f"/api/v1/hrms/expenses/{exp_id}/receipt", headers=emp_ops_h)).status_code == 403
    # Generic /uploads/private/expenses/... bypass must ALSO be blocked for unauthorized employee!
    assert (await client.get(f"/uploads/private/expenses/{stored_pdf_name}", headers=emp_b_h)).status_code in (403, 404)

    # 11. Authorized owner download -> 200 with security headers & exact PDF bytes
    r_own = await client.get(f"/api/v1/hrms/expenses/{exp_id}/receipt", headers=emp_a_h)
    assert r_own.status_code == 200
    assert r_own.content == pdf_bytes
    assert r_own.headers.get("x-content-type-options") == "nosniff"
    assert "no-store" in (r_own.headers.get("cache-control") or "")

    # 12. Authorized reviewer download (assigned manager & HR) -> 200
    r_mgr = await client.get(f"/api/v1/hrms/expenses/{exp_id}/receipt", headers=mgr_eng_h)
    assert r_mgr.status_code == 200 and r_mgr.content == pdf_bytes
    r_hr = await client.get(f"/api/v1/hrms/expenses/{exp_id}/receipt", headers=hr_full_h)
    assert r_hr.status_code == 200 and r_hr.content == pdf_bytes

    # 13. Signed URL: valid fresh signed URL succeeds; expired or tampered signature rejected!
    r_sign = await client.get(f"/api/v1/hrms/expenses/{exp_id}/receipt-url", headers=emp_a_h)
    assert r_sign.status_code == 200
    signed_url = r_sign.json()["data"]["signed_url"]
    assert (await client.get(signed_url)).status_code == 200

    # Tampered signature -> 401/403
    assert (await client.get(f"{signed_url}tampered")).status_code in (401, 403)
    # Expired timestamp -> 401/403
    assert (await client.get(f"/api/v1/hrms/expenses/{exp_id}/receipt?exp=1000000000&sig=deadbeef")).status_code in (401, 403)

    # 14. Direct public URL access (/uploads/expenses/...) -> 404 (mount removed!)
    assert (await client.get(f"/uploads/expenses/{stored_pdf_name}")).status_code in (401, 403, 404)


# =============================================================================
# AREA F: PAYSLIP PRIVACY (12 SCENARIOS — HRMS-BUG-06, HRMS-BUG-08, MGR SCOPE)
# =============================================================================


@pytest.mark.asyncio
async def test_f_payslip_privacy_12_scenarios(wave1_env):
    """Verify all 12 payslip & salary privacy scenarios including manager salary isolation."""
    client: AsyncClient = wave1_env["client"]
    SessionFactory = wave1_env["SessionFactory"]
    admin, admin_h = wave1_env["users"]["admin"]
    hr_full, hr_full_h = wave1_env["users"]["hr_full"]
    hr_deny, hr_deny_h = wave1_env["users"]["hr_deny"]
    hr_no_payroll, hr_no_payroll_h = wave1_env["users"]["hr_no_payroll"]
    pay_cfg, pay_cfg_h = wave1_env["users"]["pay_cfg"]
    pay_app, pay_app_h = wave1_env["users"]["pay_app"]
    mgr_eng, mgr_eng_h = wave1_env["users"]["mgr_eng"]
    emp_a, emp_a_h = wave1_env["users"]["emp_a"]
    emp_b, emp_b_h = wave1_env["users"]["emp_b"]
    track_month = wave1_env["track_payroll_month"]

    approved_month = "2024-06"
    draft_month = "2024-07"
    review_month = "2024-08"
    for m in (approved_month, draft_month, review_month):
        track_month(m)

    # Seed salaries for emp_a, emp_b, mgr_eng and create APPROVED, DRAFT, and REVIEW payroll snapshots
    async with SessionFactory() as s:
        for u, ctc in ((emp_a, 420000.0), (emp_b, 480000.0), (mgr_eng, 720000.0)):
            s.add(
                HrmsEmployeeSalary(
                    employee_id=u.id, annual_ctc=ctc, monthly_ctc=round(ctc / 12, 2),
                    effective_from=date(2024, 1, 1), is_active=True,
                    structure_breakdown={}, created_by=admin.id, updated_by=admin.id,
                )
            )
        await s.flush()

        def make_batch(m_str: str, yr: int, mo: int, batch_status: str, item_status: str):
            p = HrmsMonthlyPayroll(
                payroll_month=m_str, payroll_year=yr, month_number=mo,
                status=batch_status, working_days=26, weekend_days=4, holiday_days=0,
                total_employees=3, total_gross=135000.0, total_deductions=10000.0, total_net=125000.0,
                processed_by=admin.id,
                approved_by=admin.id if batch_status == "APPROVED" else None,
                approved_at=datetime.now(timezone.utc) if batch_status == "APPROVED" else None,
            )
            s.add(p)
            return p

        p_app = make_batch(approved_month, 2024, 6, "APPROVED", "APPROVED")
        p_dft = make_batch(draft_month, 2024, 7, "PROCESSED", "DRAFT")
        p_rev = make_batch(review_month, 2024, 8, "REVIEW", "DRAFT")
        await s.flush()

        items_map: dict[tuple[str, uuid.UUID], uuid.UUID] = {}
        for batch, m_str, istat in ((p_app, approved_month, "APPROVED"), (p_dft, draft_month, "DRAFT"), (p_rev, review_month, "DRAFT")):
            for u, ctc in ((emp_a, 420000.0), (emp_b, 480000.0), (mgr_eng, 720000.0)):
                it = HrmsMonthlyPayrollItem(
                    payroll_id=batch.id, employee_id=u.id,
                    annual_ctc=ctc, monthly_ctc=round(ctc / 12, 2),
                    working_days=26, present_days=26.0, paid_leave_days=0.0,
                    holiday_days=0, weekend_days=4, lop_days=0.0,
                    earnings_breakdown=[{"code": "BASIC", "name": "Basic Salary", "monthly_amount": round(ctc / 24, 2)}],
                    deductions_breakdown=[{"code": "PT", "name": "Professional Tax", "monthly_amount": 200.0}],
                    additions_breakdown=[],
                    lop_deduction=0.0, gross_amount=round(ctc / 12, 2),
                    total_deductions=200.0, net_salary=round(ctc / 12 - 200.0, 2),
                    status=istat,
                )
                s.add(it)
                await s.flush()
                items_map[(m_str, u.id)] = it.id
        await s.commit()

    app_a_id = items_map[(approved_month, emp_a.id)]
    app_b_id = items_map[(approved_month, emp_b.id)]
    dft_a_id = items_map[(draft_month, emp_a.id)]
    rev_a_id = items_map[(review_month, emp_a.id)]

    # 1. Employee accessing own approved payslip -> 200
    r1 = await client.get(f"/api/v1/hrms/payroll/payslips?payroll_month={approved_month}", headers=emp_a_h)
    assert r1.status_code == 200 and len(r1.json()["data"]) == 1
    assert r1.json()["data"][0]["employee_id"] == str(emp_a.id)
    assert (await client.get(f"/api/v1/hrms/payroll/payslips/{app_a_id}", headers=emp_a_h)).status_code == 200

    # 2. Employee accessing another employee's payslip (UUID, employee_code, username, direct item_id) -> 403
    for ident in (str(emp_b.id), emp_b.employee_code, emp_b.username):
        assert (await client.get(f"/api/v1/hrms/payroll/payslips?employee_id={ident}", headers=emp_a_h)).status_code == 403
        assert (await client.get(f"/api/v1/hrms/payroll/salary/history/{ident}", headers=emp_a_h)).status_code == 403
    assert (await client.get(f"/api/v1/hrms/payroll/payslips/{app_b_id}", headers=emp_a_h)).status_code == 403

    # 3. Employee accessing draft payroll -> empty list on /payslips, 403 on detail & monthly
    r3 = await client.get(f"/api/v1/hrms/payroll/payslips?payroll_month={draft_month}", headers=emp_a_h)
    assert r3.status_code == 200 and r3.json()["data"] == []
    assert (await client.get(f"/api/v1/hrms/payroll/payslips/{dft_a_id}", headers=emp_a_h)).status_code == 403
    assert (await client.get(f"/api/v1/hrms/payroll/monthly/{draft_month}", headers=emp_a_h)).status_code == 403

    # 4. Employee accessing unapproved (REVIEW) payroll -> empty list, 403 on detail & monthly
    r4 = await client.get(f"/api/v1/hrms/payroll/payslips?payroll_month={review_month}", headers=emp_a_h)
    assert r4.status_code == 200 and r4.json()["data"] == []
    assert (await client.get(f"/api/v1/hrms/payroll/payslips/{rev_a_id}", headers=emp_a_h)).status_code == 403
    assert (await client.get(f"/api/v1/hrms/payroll/monthly/{review_month}", headers=emp_a_h)).status_code == 403

    # 5. Department Manager accessing team payslip / salary / monthly / export -> MUST BE 403!
    assert (await client.get("/api/v1/hrms/payroll/employees", headers=mgr_eng_h)).status_code == 403
    assert (await client.get(f"/api/v1/hrms/payroll/monthly/{approved_month}", headers=mgr_eng_h)).status_code == 403
    assert (await client.get(f"/api/v1/hrms/payroll/salary/history/{emp_a.id}", headers=mgr_eng_h)).status_code == 403
    assert (await client.get(f"/api/v1/hrms/payroll/payslips?employee_id={emp_a.id}", headers=mgr_eng_h)).status_code == 403
    assert (await client.get(f"/api/v1/hrms/payroll/payslips?employee_id={emp_a.employee_code}", headers=mgr_eng_h)).status_code == 403
    assert (await client.get(f"/api/v1/hrms/payroll/payslips?employee_id=ALL", headers=mgr_eng_h)).status_code == 403
    assert (await client.get(f"/api/v1/hrms/payroll/payslips/{app_a_id}", headers=mgr_eng_h)).status_code == 403
    assert (await client.get(f"/api/v1/hrms/payroll/adjustments?payroll_month={approved_month}", headers=mgr_eng_h)).status_code == 403
    assert (await client.get(f"/api/v1/hrms/payroll/export?payroll_month={approved_month}&employee_id={emp_a.id}", headers=mgr_eng_h)).status_code == 403
    # Manager CAN still see their OWN approved payslip
    r_mgr_own = await client.get(f"/api/v1/hrms/payroll/payslips?payroll_month={approved_month}", headers=mgr_eng_h)
    assert r_mgr_own.status_code == 200 and len(r_mgr_own.json()["data"]) == 1
    assert r_mgr_own.json()["data"][0]["employee_id"] == str(mgr_eng.id)

    # 6. HR with payroll permission -> 200
    assert (await client.get("/api/v1/hrms/payroll/employees", headers=hr_full_h)).status_code == 200
    assert (await client.get(f"/api/v1/hrms/payroll/monthly/{approved_month}", headers=hr_full_h)).status_code == 200
    assert (await client.get(f"/api/v1/hrms/payroll/salary/history/{emp_a.id}", headers=hr_full_h)).status_code == 200

    # 7. HR WITHOUT payroll permission (both absent AND explicit deny:hrms.payroll) -> 403 on ALL payroll endpoints!
    for hdrs in (hr_no_payroll_h, hr_deny_h):
        assert (await client.get("/api/v1/hrms/payroll/employees", headers=hdrs)).status_code == 403
        assert (await client.get(f"/api/v1/hrms/payroll/monthly/{approved_month}", headers=hdrs)).status_code == 403
        assert (await client.get(f"/api/v1/hrms/payroll/salary/history/{emp_a.id}", headers=hdrs)).status_code == 403
        assert (await client.get(f"/api/v1/hrms/payroll/payslips?payroll_month={approved_month}", headers=hdrs)).status_code == 403
        assert (await client.get(f"/api/v1/hrms/payroll/export?payroll_month={approved_month}", headers=hdrs)).status_code == 403

    # 8. Payroll configurator WITHOUT approval permission -> can configure/edit, blocked from approve/reopen
    assert (await client.get("/api/v1/hrms/payroll/components", headers=pay_cfg_h)).status_code == 200
    assert (await client.post(f"/api/v1/hrms/payroll/monthly/{review_month}/approve", headers=pay_cfg_h)).status_code == 403
    assert (await client.post(f"/api/v1/hrms/payroll/monthly/{approved_month}/reopen", json={"reason": "test"}, headers=pay_cfg_h)).status_code == 403

    # 9. Payroll approver WITHOUT configuration permission -> blocked from configure/calculate/assign/edit, CAN approve/reopen
    assert (await client.post("/api/v1/hrms/payroll/calculate", json={"payroll_month": review_month}, headers=pay_app_h)).status_code == 403
    assert (
        await client.post(
            "/api/v1/hrms/payroll/salary/assign",
            json={"employee_id": str(emp_a.id), "annual_ctc": 500000.0, "effective_from": "2024-09-01"},
            headers=pay_app_h,
        )
    ).status_code == 403
    assert (await client.post(f"/api/v1/hrms/payroll/monthly/{review_month}/approve", headers=pay_app_h)).status_code == 200
    assert (await client.post(f"/api/v1/hrms/payroll/monthly/{review_month}/reopen", json={"reason": "QA reopen"}, headers=pay_app_h)).status_code == 200

    # 10. Admin access -> 200
    assert (await client.get(f"/api/v1/hrms/payroll/monthly/{approved_month}", headers=admin_h)).status_code == 200
    assert (await client.get(f"/api/v1/hrms/payroll/payslips/{app_b_id}", headers=admin_h)).status_code == 200

    # 11. Direct download endpoint (payslip detail)
    assert (await client.get(f"/api/v1/hrms/payroll/payslips/{app_a_id}", headers=emp_a_h)).status_code == 200
    assert (await client.get(f"/api/v1/hrms/payroll/payslips/{app_b_id}", headers=emp_a_h)).status_code == 403

    # 12. Export endpoint
    r_exp_own = await client.get(f"/api/v1/hrms/payroll/export?payroll_month={approved_month}", headers=emp_a_h)
    assert r_exp_own.status_code == 200
    assert (await client.get(f"/api/v1/hrms/payroll/export?payroll_month={approved_month}&employee_id={emp_b.id}", headers=emp_a_h)).status_code == 403
    assert (await client.get(f"/api/v1/hrms/payroll/export?payroll_month={draft_month}", headers=emp_a_h)).status_code == 403
    assert (await client.get(f"/api/v1/hrms/payroll/export?payroll_month={approved_month}", headers=admin_h)).status_code == 200


# =============================================================================
# AREA G: BACKEND RBAC ENFORCEMENT (EXPLICIT DENY & READ-ONLY — BUG-06/09/10/11)
# =============================================================================


@pytest.mark.asyncio
async def test_g_backend_rbac_explicit_denies_and_readonly_enforcement(wave1_env):
    """Verify explicit denies override grants across Setup, Payroll, Expenses, Leave, and Read-Only users cannot write."""
    client: AsyncClient = wave1_env["client"]
    SessionFactory = wave1_env["SessionFactory"]
    admin, admin_h = wave1_env["users"]["admin"]
    hr_full, hr_full_h = wave1_env["users"]["hr_full"]
    hr_deny, hr_deny_h = wave1_env["users"]["hr_deny"]
    emp_a, emp_a_h = wave1_env["users"]["emp_a"]
    readonly, readonly_h = wave1_env["users"]["readonly"]
    lt_cl = wave1_env["leave_types"]["cl"]
    track_exp = wave1_env["track_expense_id"]

    # Seed an APPROVED expense for emp_a to test reimburse with deny:hrms.approve
    async with SessionFactory() as s:
        exp = HrmsExpense(
            expense_code=f"EXP-W1-{uuid.uuid4().hex[:6].upper()}",
            employee_id=emp_a.id,
            expense_date=date.today(),
            category="Travel",
            amount=300.0,
            currency="INR",
            description="RBAC reimburse test",
            status="APPROVED",
            submitted_at=datetime.now(timezone.utc),
            reviewed_at=datetime.now(timezone.utc),
            reviewed_by=admin.id,
        )
        s.add(exp)
        await s.commit()
        await s.refresh(exp)
        track_exp(exp.id)

    # 1. Explicit deny:hrms.setup MUST block HR (even though HR role grants hrms.manage + hrms.setup!) — HRMS-BUG-09
    assert (await client.get("/api/v1/hrms/setup/locations", headers=hr_full_h)).status_code == 200
    assert (await client.get("/api/v1/hrms/setup/tracking-settings", headers=hr_full_h)).status_code == 200

    for ep in (
        "/api/v1/hrms/setup/locations",
        "/api/v1/hrms/setup/leave-types",
        "/api/v1/hrms/setup/expense-categories",
        "/api/v1/hrms/setup/expense-settings",
        "/api/v1/hrms/setup/tracking-settings",
        "/api/v1/hrms/setup/detailed-tracking/employees",
        "/api/v1/hrms/setup/return-timer/employees",
        "/api/v1/hrms/setup/employee-locations",
    ):
        r = await client.get(ep, headers=hr_deny_h)
        assert r.status_code == 403, f"Explicit deny:hrms.setup bypassed on GET {ep}: {r.status_code}"

    # 2. Explicit deny:hrms.approve MUST block HR on POST /expenses/{id}/reimburse — HRMS-BUG-10
    r_reimb_deny = await client.post(
        f"/api/v1/hrms/expenses/{exp.id}/reimburse",
        json={"notes": "Should fail due to deny:hrms.approve"},
        headers=hr_deny_h,
    )
    assert r_reimb_deny.status_code == 403, f"Explicit deny:hrms.approve bypassed on reimburse! {r_reimb_deny.status_code}"

    # Full HR with hrms.approve CAN reimburse
    r_reimb_ok = await client.post(
        f"/api/v1/hrms/expenses/{exp.id}/reimburse",
        json={"notes": "Authorized HR reimburse"},
        headers=hr_full_h,
    )
    assert r_reimb_ok.status_code == 200

    # 3. Explicit deny:hrms.payroll MUST block HR on GET /salary/history/{id} — HRMS-BUG-06
    r_sal_deny = await client.get(f"/api/v1/hrms/payroll/salary/history/{emp_a.id}", headers=hr_deny_h)
    assert r_sal_deny.status_code == 403
    assert "annual_ctc" not in r_sal_deny.text

    # 4. Read-only user (hrms.view ONLY, no create/update/manage) CANNOT mutate HRMS records — HRMS-BUG-11
    r_ro_exp = await client.post(
        "/api/v1/hrms/expenses?submit=false",
        json={
            "expense_date": date.today().isoformat(),
            "category": "Travel",
            "amount": 100.0,
            "description": "Read-only write attempt",
            "is_submit": False,
        },
        headers=readonly_h,
    )
    assert r_ro_exp.status_code == 403, f"Read-only user created expense! {r_ro_exp.status_code}"

    r_ro_lv = await client.post(
        "/api/v1/hrms/leave/requests",
        json={
            "leave_type_id": str(lt_cl.id),
            "from_date": "2026-12-21",
            "to_date": "2026-12-21",
            "reason": "Read-only leave write attempt",
        },
        headers=readonly_h,
    )
    assert r_ro_lv.status_code == 403, f"Read-only user created leave request! {r_ro_lv.status_code}"

    r_ro_up = await client.post(
        "/api/v1/hrms/expenses/upload-receipt",
        files={"file": ("ro.pdf", _make_valid_pdf_bytes(), "application/pdf")},
        headers=readonly_h,
    )
    assert r_ro_up.status_code == 403, f"Read-only user uploaded receipt! {r_ro_up.status_code}"

    # 5. Invalid / expired session token returns 401 with zero sensitive data
    bad_h = {"Authorization": "Bearer invalid.jwt.token"}
    for ep in (
        "/api/v1/hrms/leave/balances",
        "/api/v1/hrms/payroll/payslips",
        "/api/v1/hrms/expenses",
        "/api/v1/hrms/setup/locations",
    ):
        r_unauth = await client.get(ep, headers=bad_h)
        assert r_unauth.status_code == 401
        assert "traceback" not in r_unauth.text.lower()
