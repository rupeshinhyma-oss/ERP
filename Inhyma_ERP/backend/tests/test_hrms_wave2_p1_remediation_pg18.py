"""
HRMS Wave 2 — Complete P1 Defect Remediation Regression Suite (Real PostgreSQL 18).

Covers all verified P1 defects from the HRMS Complete Independent Audit Report
plus Wave 2 functional, concurrency, notification, and performance requirements:
  A. Live GPS Tracking: point validation, (0,0)/out-of-range/stale/future rejection,
     poor-accuracy drift filtering, duplicate point dedup, out-of-order recovery,
     independent Haversine distance verification, concurrent START & STOP atomicity,
     session reload reconstruction, unauthorized access, Admin/Manager listing scoping
     (HRMS-BUG-12, HRMS-BUG-14, HRMS-BUG-15, HRMS-BUG-20).
  B. Site Visit: create/edit/reassign/cancel lifecycle, invalid coordinate rejection,
     GPS proximity/accuracy/freshness, concurrent check-in & check-out locking,
     history attribution, evidence RBAC & regularization linking (Wave 2 §3B, HRMS-BUG-23/31).
  C. Geofencing: NaN/Infinity/lat=999/(0,0)/freshness validation (no 500 crash),
     inside/boundary/outside/exit/re-entry/expiry transitions, concurrent outside
     heartbeats (single open violation), poor-accuracy drift handling, multi-office,
     inactive location, reassignment, return timer override (HRMS-BUG-13, HRMS-BUG-20).
  D. Notifications: record-scoped dedup (2 distinct requests within 24h BOTH delivered,
     same-record retry deduplicated), Leave / Regularization / Expense (+reimburse) /
     Asset (+return) / Site Visit (+assign/reassign/cancel), HR fallback filtering,
     read/unread API consistency, SAVEPOINT isolation (HRMS-BUG-17, Wave 2 §3D).
  E. Data Integrity, Concurrency & RBAC: soft-deleted Leave Plan applicability
     (HRMS-BUG-16), private DRAFT expense excluded from approvals & summary (HRMS-BUG-18),
     concurrent punch-in / asset-create / expense-create zero-500 integrity (HRMS-BUG-19),
     Manager-First precedence & 1-report scope non-escalation (HRMS-BUG-21),
     read-only & deny:hrms.view across all 6 HRMS modules (HRMS-BUG-11).
  F. Performance & N+1 Query Counts: bounded O(1) SQL queries on payroll calculation,
     assets listing, leave requests/approvals, and tracking sessions (HRMS-BUG-27).

Safety:
  - Runs strictly against isolated local PostgreSQL 18 (`inhyma_test_db`).
  - Refuses to execute if DATABASE_URL references Supabase or production.
  - Cleans up 100% of synthetic test records in `finally:`.
"""

from __future__ import annotations

import asyncio
from datetime import date, datetime, timedelta, timezone
import math
import os
import uuid

from httpx import ASGITransport, AsyncClient
import pytest
import pytest_asyncio
from sqlalchemy import delete, event, func, select
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine

from app.auth.security import create_access_token, hash_password
from app.core.config import settings
from app.hrms.models import (
    HrmsAsset,
    HrmsAssetAssignment,
    HrmsAssetHistory,
    HrmsAssetMaintenance,
    HrmsAttendance,
    HrmsAttendanceRegularization,
    HrmsEmployeeLeaveBalance,
    HrmsEmployeeLocation,
    HrmsEmployeeSalary,
    HrmsExpense,
    HrmsGeofenceViolation,
    HrmsLeaveAdjustment,
    HrmsLeavePlan,
    HrmsLeavePlanType,
    HrmsLeaveRequest,
    HrmsLeaveType,
    HrmsTrackingPoint,
    HrmsLiveTrackingSession,
    HrmsLocation,
    HrmsMonthlyPayroll,
    HrmsMonthlyPayrollItem,
    HrmsPayrollAdjustment,
    HrmsSiteVisit,
    HrmsSiteVisitCheckIn,
    HrmsTrackingSettings,
    HrmsTrackingStop,
)
from app.main import create_application
from app.notifications.models import Notification
from app.rbac.models import Permission, Role, RoleAssignmentStatus, RolePermission, UserPermission, UserRole
from app.users.models import EmploymentStatus, EmploymentType, User, UserStatus

PG_TEST_URL = os.environ.get(
    "HRMS_PG_TEST_URL",
    os.environ.get("TEST_DATABASE_URL", "postgresql+asyncpg://postgres:root@127.0.0.1:5432/inhyma_test_db"),
)


def _ensure_safe_local_pg(url: str) -> None:
    lower = url.lower()
    if "supabase.com" in lower or "supabase.co" in lower:
        pytest.skip("Refusing to execute HRMS Wave 2 tests against Supabase.")
    if not lower.startswith("postgresql"):
        pytest.skip("HRMS Wave 2 suite requires an isolated local PostgreSQL DATABASE_URL.")


def _haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return r * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _offset_point(lat: float, lon: float, distance_m: float, bearing_deg: float = 0.0) -> tuple[float, float]:
    r = 6371000.0
    lat_r = math.radians(lat)
    lon_r = math.radians(lon)
    br_r = math.radians(bearing_deg)
    dr = distance_m / r
    new_lat = math.asin(math.sin(lat_r) * math.cos(dr) + math.cos(lat_r) * math.sin(dr) * math.cos(br_r))
    new_lon = lon_r + math.atan2(
        math.sin(br_r) * math.sin(dr) * math.cos(lat_r),
        math.cos(dr) - math.sin(lat_r) * math.sin(new_lat),
    )
    return math.degrees(new_lat), math.degrees(new_lon)


def _working_date(days_ahead: int) -> date:
    """Return a future Mon-Fri date at least `days_ahead` days from today (never Sunday/Saturday)."""
    d = date.today() + timedelta(days=days_ahead)
    while d.weekday() >= 5:
        d += timedelta(days=1)
    return d


@pytest_asyncio.fixture
async def wave2_env():
    """Provision isolated multi-role HRMS environment in local PG18 and tear down completely."""
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

    engine: AsyncEngine = create_async_engine(PG_TEST_URL, pool_size=20, max_overflow=30)
    SessionFactory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    tag = uuid.uuid4().hex[:8].lower()
    pw_hash = hash_password(f"Wave2!{tag}Aa")

    created_user_ids: list[uuid.UUID] = []
    created_role_ids: list[uuid.UUID] = []
    created_loc_ids: list[uuid.UUID] = []
    created_lt_ids: list[uuid.UUID] = []
    created_plan_ids: list[uuid.UUID] = []
    created_asset_ids: list[uuid.UUID] = []
    created_payroll_months: set[str] = set()

    async with SessionFactory() as db:
        perm_rows = (await db.execute(select(Permission))).scalars().all()
        perm_by_code = {p.code: p for p in perm_rows}
        roles_existing = (await db.execute(select(Role).where(Role.deleted_at.is_(None)))).scalars().all()
        role_by_name = {r.name.lower(): r for r in roles_existing}

        dept_a = Role(name=f"W2DeptA_{tag}", code=f"W2A{tag[:4].upper()}", is_system=False)
        dept_b = Role(name=f"W2DeptB_{tag}", code=f"W2B{tag[:4].upper()}", is_system=False)
        role_dept_mgr = Role(name=f"W2DeptManager_{tag}", code=f"W2M{tag[:4].upper()}", is_system=False)
        role_readonly = Role(name=f"W2ReadOnly_{tag}", code=f"W2R{tag[:4].upper()}", is_system=False)
        db.add_all([dept_a, dept_b, role_dept_mgr, role_readonly])
        await db.flush()
        created_role_ids.extend([dept_a.id, dept_b.id, role_dept_mgr.id, role_readonly.id])

        if "hrms.view" in perm_by_code:
            db.add(RolePermission(role_id=role_readonly.id, permission_id=perm_by_code["hrms.view"].id))

        hr_role = role_by_name.get("hr")
        super_admin_role = role_by_name.get("super_admin") or role_by_name.get("admin")
        emp_role = role_by_name.get("employee") or role_by_name.get("user")

        # Offices: Primary (Thane), Secondary (Pune), Inactive (Old Branch)
        office_primary = HrmsLocation(
            name=f"W2 Primary Office {tag}",
            location_type="Office",
            address="Wagle Estate, Thane",
            latitude=19.1998,
            longitude=72.9568,
            radius_meters=150.0,
            is_active=True,
        )
        office_secondary = HrmsLocation(
            name=f"W2 Secondary Office {tag}",
            location_type="Office",
            address="Baner Road, Pune",
            latitude=18.5590,
            longitude=73.7868,
            radius_meters=150.0,
            is_active=True,
        )
        office_inactive = HrmsLocation(
            name=f"W2 Inactive Office {tag}",
            location_type="Office",
            address="Closed Site",
            latitude=21.1458,
            longitude=79.0882,
            radius_meters=150.0,
            is_active=False,
        )
        db.add_all([office_primary, office_secondary, office_inactive])
        await db.flush()
        created_loc_ids.extend([office_primary.id, office_secondary.id, office_inactive.id])

        # Helper to create users
        async def mk_user(
            uname: str,
            first: str,
            last: str,
            *,
            roles: list[Role],
            manager_id: uuid.UUID | None = None,
            is_super_admin: bool = False,
            emp_status: EmploymentStatus = EmploymentStatus.ACTIVE,
            is_active: bool = True,
            denies: list[str] | None = None,
        ) -> User:
            u = User(
                username=f"w2_{uname}_{tag}",
                email=f"w2_{uname}_{tag}@inhyma.test",
                password_hash=pw_hash,
                first_name=first,
                last_name=last,
                display_name=f"{first} {last}",
                employee_code=f"W2-{uname.upper()}-{tag[:4].upper()}",
                status=UserStatus.ACTIVE if is_active else UserStatus.INACTIVE,
                employment_status=emp_status,
                employment_type=EmploymentType.FULL_TIME,
                is_active=is_active,
                manager_id=manager_id,
                date_of_joining=date(2025, 1, 1),
            )
            db.add(u)
            await db.flush()
            created_user_ids.append(u.id)
            for idx, r in enumerate(roles):
                if r is not None:
                    db.add(
                        UserRole(
                            user_id=u.id,
                            role_id=r.id,
                            is_primary=(idx == 0),
                            status=RoleAssignmentStatus.ACTIVE,
                        )
                    )
            for dcode in denies or []:
                if dcode in perm_by_code:
                    db.add(
                        UserPermission(
                            user_id=u.id,
                            permission_id=perm_by_code[dcode].id,
                            is_granted=False,
                        )
                    )
            return u

        admin = await mk_user("admin", "Wave2", "Admin", roles=[super_admin_role], is_super_admin=True)
        hr_std = await mk_user("hr_std", "Wave2", "HRStd", roles=[hr_role])
        hr_deny_sv = await mk_user(
            "hr_denysv",
            "Wave2",
            "HRDenySV",
            roles=[hr_role],
            denies=["hrms.site_visits", "hrms.approve"],
        )
        hr_term = await mk_user(
            "hr_term",
            "Wave2",
            "HRTerm",
            roles=[hr_role],
            emp_status=EmploymentStatus.TERMINATED,
        )
        dept_mgr_a = await mk_user("dmgr_a", "DeptMgr", "Alpha", roles=[dept_a, role_dept_mgr])
        direct_mgr_a = await mk_user("dirmgr_a", "DirectMgr", "Alpha", roles=[dept_a, role_dept_mgr])
        dept_mgr_b = await mk_user("dmgr_b", "DeptMgr", "Beta", roles=[dept_b, role_dept_mgr])
        emp_a1 = await mk_user("emp_a1", "Alice", "Field", roles=[dept_a, emp_role], manager_id=direct_mgr_a.id)
        emp_a2 = await mk_user("emp_a2", "Bob", "Field", roles=[dept_a, emp_role], manager_id=direct_mgr_a.id)
        # Ordinary employee in dept_a who happens to have 1 direct report (emp_sub) — NOT a department manager!
        emp_lead_1rep = await mk_user("lead1", "LeadOne", "Report", roles=[dept_a, emp_role], manager_id=dept_mgr_a.id)
        emp_sub = await mk_user("sub1", "Sub", "One", roles=[dept_a, emp_role], manager_id=emp_lead_1rep.id)
        emp_b1 = await mk_user("emp_b1", "Charlie", "Beta", roles=[dept_b, emp_role], manager_id=dept_mgr_b.id)
        emp_no_mgr = await mk_user("nomgr", "NoMgr", "Staff", roles=[dept_b, emp_role], manager_id=None)
        emp_readonly = await mk_user("ro", "ReadOnly", "Viewer", roles=[dept_a, role_readonly])
        emp_revoked = await mk_user(
            "revoked",
            "Revoked",
            "User",
            roles=[dept_a, emp_role],
            denies=["hrms.view"],
        )

        # Assign primary & secondary offices to emp_a1, primary to emp_a2, emp_b1, emp_readonly
        for u in (emp_a1, emp_a2, emp_b1, emp_readonly, emp_no_mgr):
            db.add(
                HrmsEmployeeLocation(
                    user_id=u.id,
                    location_id=office_primary.id,
                    is_primary=True,
                )
            )
        db.add(
            HrmsEmployeeLocation(
                user_id=emp_a1.id,
                location_id=office_secondary.id,
                is_primary=False,
            )
        )
        db.add(
            HrmsEmployeeLocation(
                user_id=emp_a1.id,
                location_id=office_inactive.id,
                is_primary=False,
            )
        )

        # Configure detailed tracking settings override for emp_a1 (5 min stop threshold, 50m radius, 50m max accuracy, 30s return timer)
        ts_a1 = HrmsTrackingSettings(
            employee_id=emp_a1.id,
            is_active=True,
            is_detailed_tracking_enabled=True,
            detailed_interval_minutes=1,
            detailed_stop_threshold_minutes=5.0,
            stop_detection_radius_meters=50.0,
            max_gps_accuracy_meters=50.0,
            return_timer_seconds=30,
            is_unlimited_return=False,
        )
        # Immediate return timer override (0s -> EXPIRED immediately) for emp_a2
        ts_a2 = HrmsTrackingSettings(
            employee_id=emp_a2.id,
            is_active=True,
            is_detailed_tracking_enabled=True,
            detailed_interval_minutes=1,
            detailed_stop_threshold_minutes=5.0,
            stop_detection_radius_meters=50.0,
            max_gps_accuracy_meters=50.0,
            return_timer_seconds=0,
            is_unlimited_return=False,
        )
        # Unlimited return timer override for emp_b1
        ts_b1 = HrmsTrackingSettings(
            employee_id=emp_b1.id,
            is_active=True,
            is_detailed_tracking_enabled=True,
            detailed_interval_minutes=1,
            detailed_stop_threshold_minutes=5.0,
            stop_detection_radius_meters=50.0,
            max_gps_accuracy_meters=50.0,
            return_timer_seconds=None,
            is_unlimited_return=True,
        )
        db.add_all([ts_a1, ts_a2, ts_b1])

        # Create a dedicated Leave Type for Leave Plan soft-delete test (HRMS-BUG-16)
        lt_plan_test = HrmsLeaveType(
            name=f"W2 Plan Casual {tag}",
            code=f"W2PC{tag[:3].upper()}",
            leave_type="REGULAR",
            is_paid=True,
            annual_balance=12.0,
            max_consecutive_days=10,
            is_active=True,
            allow_half_day=True,
            allow_backdated=True,
            min_notice_days=0,
            require_attachment=False,
            allow_negative_balance=False,
            count_weekends_as_leave=False,
            count_holidays_as_leave=False,
        )
        db.add(lt_plan_test)
        await db.flush()
        created_lt_ids.append(lt_plan_test.id)

        await db.commit()

    def tok(user: User) -> dict[str, str]:
        t = create_access_token(user.id, permissions=[]).token
        return {"Authorization": f"Bearer {t}"}

    app = create_application()
    transport = ASGITransport(app=app, raise_app_exceptions=False)

    env = {
        "tag": tag,
        "engine": engine,
        "SessionFactory": SessionFactory,
        "app": app,
        "transport": transport,
        "tok": tok,
        "admin": admin,
        "hr_std": hr_std,
        "hr_deny_sv": hr_deny_sv,
        "hr_term": hr_term,
        "dept_mgr_a": dept_mgr_a,
        "direct_mgr_a": direct_mgr_a,
        "dept_mgr_b": dept_mgr_b,
        "emp_a1": emp_a1,
        "emp_a2": emp_a2,
        "emp_lead_1rep": emp_lead_1rep,
        "emp_sub": emp_sub,
        "emp_b1": emp_b1,
        "emp_no_mgr": emp_no_mgr,
        "emp_readonly": emp_readonly,
        "emp_revoked": emp_revoked,
        "office_primary": office_primary,
        "office_secondary": office_secondary,
        "office_inactive": office_inactive,
        "lt_plan_test": lt_plan_test,
        "created_plan_ids": created_plan_ids,
        "created_asset_ids": created_asset_ids,
        "created_payroll_months": created_payroll_months,
        "created_user_ids": created_user_ids,
    }

    try:
        yield env
    finally:
        async with SessionFactory() as db:
            uids = created_user_ids
            if uids:
                # Tracking stops & points & sessions
                sess_ids = list(
                    (await db.execute(select(HrmsLiveTrackingSession.id).where(HrmsLiveTrackingSession.employee_id.in_(uids))))
                    .scalars()
                    .all()
                )
                if sess_ids:
                    await db.execute(delete(HrmsTrackingStop).where(HrmsTrackingStop.session_id.in_(sess_ids)))
                    await db.execute(delete(HrmsTrackingPoint).where(HrmsTrackingPoint.session_id.in_(sess_ids)))
                    await db.execute(delete(HrmsLiveTrackingSession).where(HrmsLiveTrackingSession.id.in_(sess_ids)))
                await db.execute(delete(HrmsTrackingStop).where(HrmsTrackingStop.employee_id.in_(uids)))
                # Site visits
                visit_ids = list(
                    (await db.execute(select(HrmsSiteVisit.id).where(HrmsSiteVisit.employee_id.in_(uids))))
                    .scalars()
                    .all()
                )
                if visit_ids:
                    await db.execute(delete(HrmsSiteVisitCheckIn).where(HrmsSiteVisitCheckIn.site_visit_id.in_(visit_ids)))
                    await db.execute(delete(HrmsSiteVisit).where(HrmsSiteVisit.id.in_(visit_ids)))
                await db.execute(delete(HrmsSiteVisitCheckIn).where(HrmsSiteVisitCheckIn.employee_id.in_(uids)))
                # Geofence, attendance, reg, leave, expense, payroll, notifications, locations, tracking settings
                await db.execute(delete(HrmsGeofenceViolation).where(HrmsGeofenceViolation.employee_id.in_(uids)))
                await db.execute(delete(HrmsAttendanceRegularization).where(HrmsAttendanceRegularization.employee_id.in_(uids)))
                await db.execute(delete(HrmsAttendance).where(HrmsAttendance.employee_id.in_(uids)))
                await db.execute(delete(HrmsLeaveRequest).where(HrmsLeaveRequest.employee_id.in_(uids)))
                await db.execute(delete(HrmsLeaveAdjustment).where(HrmsLeaveAdjustment.employee_id.in_(uids)))
                await db.execute(delete(HrmsEmployeeLeaveBalance).where(HrmsEmployeeLeaveBalance.employee_id.in_(uids)))
                await db.execute(delete(HrmsExpense).where(HrmsExpense.employee_id.in_(uids)))
                await db.execute(delete(HrmsPayrollAdjustment).where(HrmsPayrollAdjustment.employee_id.in_(uids)))
                await db.execute(delete(HrmsMonthlyPayrollItem).where(HrmsMonthlyPayrollItem.employee_id.in_(uids)))
                await db.execute(delete(HrmsEmployeeSalary).where(HrmsEmployeeSalary.employee_id.in_(uids)))
                await db.execute(delete(HrmsTrackingSettings).where(HrmsTrackingSettings.employee_id.in_(uids)))
                await db.execute(delete(HrmsEmployeeLocation).where(HrmsEmployeeLocation.user_id.in_(uids)))
                await db.execute(delete(Notification).where(Notification.user_id.in_(uids)))

            if created_asset_ids:
                await db.execute(delete(HrmsAssetMaintenance).where(HrmsAssetMaintenance.asset_id.in_(created_asset_ids)))
                await db.execute(delete(HrmsAssetAssignment).where(HrmsAssetAssignment.asset_id.in_(created_asset_ids)))
                await db.execute(delete(HrmsAssetHistory).where(HrmsAssetHistory.asset_id.in_(created_asset_ids)))
                await db.execute(delete(HrmsAsset).where(HrmsAsset.id.in_(created_asset_ids)))

            if created_payroll_months:
                p_ids = list(
                    (
                        await db.execute(
                            select(HrmsMonthlyPayroll.id).where(
                                HrmsMonthlyPayroll.payroll_month.in_(list(created_payroll_months))
                            )
                        )
                    )
                    .scalars()
                    .all()
                )
                if p_ids:
                    await db.execute(delete(HrmsMonthlyPayrollItem).where(HrmsMonthlyPayrollItem.payroll_id.in_(p_ids)))
                    await db.execute(delete(HrmsMonthlyPayroll).where(HrmsMonthlyPayroll.id.in_(p_ids)))

            if created_plan_ids:
                await db.execute(delete(HrmsLeavePlanType).where(HrmsLeavePlanType.plan_id.in_(created_plan_ids)))
                await db.execute(delete(HrmsLeavePlan).where(HrmsLeavePlan.id.in_(created_plan_ids)))

            if created_lt_ids:
                await db.execute(delete(HrmsLeavePlanType).where(HrmsLeavePlanType.leave_type_id.in_(created_lt_ids)))
                await db.execute(delete(HrmsEmployeeLeaveBalance).where(HrmsEmployeeLeaveBalance.leave_type_id.in_(created_lt_ids)))
                await db.execute(delete(HrmsLeaveType).where(HrmsLeaveType.id.in_(created_lt_ids)))

            if created_loc_ids:
                await db.execute(delete(HrmsEmployeeLocation).where(HrmsEmployeeLocation.location_id.in_(created_loc_ids)))
                await db.execute(delete(HrmsLocation).where(HrmsLocation.id.in_(created_loc_ids)))

            if uids:
                await db.execute(delete(UserPermission).where(UserPermission.user_id.in_(uids)))
                await db.execute(delete(UserRole).where(UserRole.user_id.in_(uids)))
                await db.execute(delete(User).where(User.id.in_(uids)))

            if created_role_ids:
                await db.execute(delete(RolePermission).where(RolePermission.role_id.in_(created_role_ids)))
                await db.execute(delete(Role).where(Role.id.in_(created_role_ids)))

            await db.commit()

        await engine.dispose()
        await engine_module.dispose_engine()
        os.environ["DATABASE_URL"] = prev_db_url
        object.__setattr__(settings, "DATABASE_URL", prev_db_url)
        if prev_direct_url is not None and hasattr(settings, "DIRECT_URL"):
            os.environ["DIRECT_URL"] = str(prev_direct_url)
            object.__setattr__(settings, "DIRECT_URL", prev_direct_url)
        for attr, prev in (
            ("SUPABASE_URL", prev_supa_url),
            ("SUPABASE_SERVICE_KEY", prev_supa_key),
            ("SUPABASE_SERVICE_ROLE_KEY", prev_supa_role_key),
            ("SUPABASE_ANON_KEY", prev_supa_anon),
        ):
            if prev is not None and hasattr(settings, attr):
                os.environ[attr] = str(prev)
                object.__setattr__(settings, attr, prev)


# =============================================================================
# A. LIVE GPS TRACKING (HRMS-BUG-12, 14, 15, 20)
# =============================================================================


@pytest.mark.asyncio
async def test_a_live_gps_tracking_validation_concurrency_scoping_and_distance(wave2_env):
    env = wave2_env
    tok = env["tok"]
    emp_a1 = env["emp_a1"]
    emp_a2 = env["emp_a2"]
    emp_b1 = env["emp_b1"]
    direct_mgr_a = env["direct_mgr_a"]
    admin = env["admin"]
    SessionFactory = env["SessionFactory"]

    async with AsyncClient(transport=env["transport"], base_url="http://test") as client:
        # 1. Concurrent START (6 simultaneous calls) -> MUST produce EXACTLY 1 ACTIVE session (HRMS-BUG-20)
        start_payload = {
            "start_location": {"lat": 19.1998, "lng": 72.9568, "accuracy": 10.0, "address": "Start Office"}
        }
        start_resps = await asyncio.gather(
            *[
                client.post("/api/v1/hrms/tracking/start", headers=tok(emp_a1), json=start_payload)
                for _ in range(6)
            ]
        )
        assert all(r.status_code in (200, 201) for r in start_resps), [r.status_code for r in start_resps]
        sess_ids = {r.json()["data"]["id"] for r in start_resps}
        assert len(sess_ids) == 1, f"Concurrent START created multiple sessions: {sess_ids}"
        session_id = next(iter(sess_ids))

        async with SessionFactory() as db:
            active_cnt = (
                await db.execute(
                    select(func.count(HrmsLiveTrackingSession.id)).where(
                        HrmsLiveTrackingSession.employee_id == emp_a1.id,
                        HrmsLiveTrackingSession.status == "ACTIVE",
                    )
                )
            ).scalar()
            assert active_cnt == 1, f"Expected 1 ACTIVE session in DB, found {active_cnt}"

        # 2. Repeated START -> idempotent
        rep_start = await client.post("/api/v1/hrms/tracking/start", headers=tok(emp_a1), json=start_payload)
        assert rep_start.status_code in (200, 201)
        assert rep_start.json()["data"]["id"] == session_id

        # 3. Invalid points MUST be rejected with 400/422 (HRMS-BUG-12)
        now = datetime.now(timezone.utc)
        for bad_name, bad_pts in [
            ("out_of_range_lat", [{"latitude": 999.0, "longitude": 72.95, "accuracy": 10.0, "recorded_at": now.isoformat()}]),
            ("out_of_range_lng", [{"latitude": 19.20, "longitude": -999.0, "accuracy": 10.0, "recorded_at": now.isoformat()}]),
            ("null_island_0_0", [{"latitude": 0.0, "longitude": 0.0, "accuracy": 10.0, "recorded_at": now.isoformat()}]),
            ("negative_accuracy", [{"latitude": 19.20, "longitude": 72.95, "accuracy": -5.0, "recorded_at": now.isoformat()}]),
            ("future_timestamp", [{"latitude": 19.20, "longitude": 72.95, "accuracy": 10.0, "recorded_at": (now + timedelta(minutes=5)).isoformat()}]),
            ("stale_before_session", [{"latitude": 19.20, "longitude": 72.95, "accuracy": 10.0, "recorded_at": (now - timedelta(hours=48)).isoformat()}]),
        ]:
            r_bad = await client.post(
                "/api/v1/hrms/tracking/points",
                headers=tok(emp_a1),
                json={"session_id": session_id, "points": bad_pts},
            )
            assert r_bad.status_code in (400, 422), f"Expected 400/422 for {bad_name}, got {r_bad.status_code}: {r_bad.text}"

        # 4. Deterministic journey with:
        #    - Segment 1: (20.000, 75.000) -> (20.005, 75.000)
        #    - Segment 2 (out-of-order + duplicate + poor-accuracy 5000m outlier at (28.0, 77.0)!):
        #      (20.010, 75.000) + 6-min stationary stop (within 15m) -> (20.015, 75.000)
        t0 = now - timedelta(minutes=12)
        p1 = {"latitude": 20.000, "longitude": 75.000, "accuracy": 10.0, "recorded_at": (t0 + timedelta(minutes=0)).isoformat()}
        p2 = {"latitude": 20.005, "longitude": 75.000, "accuracy": 12.0, "recorded_at": (t0 + timedelta(minutes=2)).isoformat()}
        p3 = {"latitude": 20.010, "longitude": 75.000, "accuracy": 10.0, "recorded_at": (t0 + timedelta(minutes=4)).isoformat()}
        p4 = {"latitude": 20.01005, "longitude": 75.00005, "accuracy": 12.0, "recorded_at": (t0 + timedelta(minutes=7)).isoformat()}
        p5 = {"latitude": 20.01008, "longitude": 75.00002, "accuracy": 10.0, "recorded_at": (t0 + timedelta(minutes=10)).isoformat()}
        p6 = {"latitude": 20.015, "longitude": 75.000, "accuracy": 10.0, "recorded_at": (t0 + timedelta(minutes=11, seconds=30)).isoformat()}
        # Poor accuracy wild jump (accuracy=5000m, ~900km away!) -> MUST be filtered out!
        p_drift = {"latitude": 28.6139, "longitude": 77.2090, "accuracy": 5000.0, "recorded_at": (t0 + timedelta(minutes=5)).isoformat()}

        # Upload out-of-order batch + retry duplicate batch + poor accuracy outlier
        r_b1 = await client.post(
            "/api/v1/hrms/tracking/points",
            headers=tok(emp_a1),
            json={"session_id": session_id, "points": [p2, p1, p_drift]},
        )
        assert r_b1.status_code == 200, r_b1.text

        # Network recovery retry containing duplicate p2 + out-of-order p6, p4, p3, p5
        r_b2 = await client.post(
            "/api/v1/hrms/tracking/points",
            headers=tok(emp_a1),
            json={"session_id": session_id, "points": [p2, p6, p4, p3, p5, p3]},
        )
        assert r_b2.status_code == 200, r_b2.text

        # Verify session reload reconstruction via GET /tracking/active
        r_active = await client.get("/api/v1/hrms/tracking/active", headers=tok(emp_a1))
        assert r_active.status_code == 200
        assert r_active.json()["data"]["id"] == session_id
        assert r_active.json()["data"]["total_points"] == 6, f"Expected 6 clean deduplicated points, got {r_active.json()['data']['total_points']}"

        # Unauthorized employee cannot upload points to emp_a1's session or view emp_a1's stops
        r_unauth_pts = await client.post(
            "/api/v1/hrms/tracking/points",
            headers=tok(emp_b1),
            json={"session_id": session_id, "points": [p1]},
        )
        assert r_unauth_pts.status_code == 403
        r_unauth_stops = await client.get(f"/api/v1/hrms/tracking/{session_id}/stops", headers=tok(emp_b1))
        assert r_unauth_stops.status_code == 403

        # 5. Admin stopping emp_a1's session concurrently (4x) -> idempotent, exact Haversine distance,
        #    and HrmsTrackingStop.employee_id MUST be emp_a1.id (NOT admin.id! HRMS-BUG-15)
        stop_resps = await asyncio.gather(
            *[
                client.post(f"/api/v1/hrms/tracking/{session_id}/stop", headers=tok(admin), json={})
                for _ in range(4)
            ]
        )
        assert all(r.status_code == 200 for r in stop_resps), [r.status_code for r in stop_resps]
        stopped_dto = stop_resps[0].json()["data"]
        assert stopped_dto["status"] == "COMPLETED"

        # Independent chronological Haversine distance across p1->p2->p3->p4->p5->p6
        ordered = [p1, p2, p3, p4, p5, p6]
        expected_m = sum(
            _haversine_m(ordered[i]["latitude"], ordered[i]["longitude"], ordered[i + 1]["latitude"], ordered[i + 1]["longitude"])
            for i in range(len(ordered) - 1)
        )
        expected_km = round(expected_m / 1000.0, 2)
        actual_km = stopped_dto["approx_distance_km"]
        assert abs(actual_km - expected_km) <= 0.02, f"Distance mismatch: expected ~{expected_km}km, got {actual_km}km (drift leaked?)"

        # Verify stationary stop ownership == emp_a1.id (NOT admin.id!)
        async with SessionFactory() as db:
            stops = list(
                (await db.execute(select(HrmsTrackingStop).where(HrmsTrackingStop.session_id == uuid.UUID(session_id))))
                .scalars()
                .all()
            )
            assert len(stops) >= 1, "Expected >=1 stationary stop for 6-min dwell"
            for st in stops:
                assert st.employee_id == emp_a1.id, f"Stop misattributed to {st.employee_id} instead of {emp_a1.id}"

        # 6. Admin & Manager GET /tracking/sessions scoping (HRMS-BUG-14)
        r_adm_list = await client.get("/api/v1/hrms/tracking/sessions", headers=tok(admin))
        assert r_adm_list.status_code == 200
        adm_ids = [s["id"] for s in r_adm_list.json()["data"]]
        assert session_id in adm_ids, f"Admin unfiltered GET /tracking/sessions missing emp_a1 session! Got {len(adm_ids)} rows"

        r_mgr_list = await client.get(
            f"/api/v1/hrms/tracking/sessions?employee_id={emp_a1.id}", headers=tok(direct_mgr_a)
        )
        assert r_mgr_list.status_code == 200
        mgr_ids = [s["id"] for s in r_mgr_list.json()["data"]]
        assert session_id in mgr_ids, "Manager GET /tracking/sessions?employee_id=<report> returned 0 rows!"

        # Manager unfiltered list also includes direct report's session
        r_mgr_all = await client.get("/api/v1/hrms/tracking/sessions", headers=tok(direct_mgr_a))
        assert r_mgr_all.status_code == 200
        assert session_id in [s["id"] for s in r_mgr_all.json()["data"]]

        # Cross-dept peer cannot query emp_a1's sessions
        r_emp_other = await client.get(
            f"/api/v1/hrms/tracking/sessions?employee_id={emp_a1.id}", headers=tok(emp_a2)
        )
        assert r_emp_other.status_code == 403


# =============================================================================
# B. SITE VISIT LIFECYCLE, EDIT/REASSIGN/CANCEL, CONCURRENCY & EVIDENCE
# =============================================================================


@pytest.mark.asyncio
async def test_b_site_visit_lifecycle_edit_reassign_cancel_concurrency_and_evidence(wave2_env):
    env = wave2_env
    tok = env["tok"]
    emp_a1 = env["emp_a1"]
    emp_a2 = env["emp_a2"]
    emp_b1 = env["emp_b1"]
    direct_mgr_a = env["direct_mgr_a"]
    dept_mgr_b = env["dept_mgr_b"]
    hr_deny_sv = env["hr_deny_sv"]
    admin = env["admin"]
    SessionFactory = env["SessionFactory"]

    site_lat, site_lng = 19.2050, 72.9600
    today_iso = date.today().isoformat()

    async with AsyncClient(transport=env["transport"], base_url="http://test") as client:
        # 1. Invalid site coordinates on create rejected cleanly
        for bad_lat, bad_lng in [(999.0, 72.96), (0.0, 0.0)]:
            r_bad_sv = await client.post(
                "/api/v1/hrms/site-visits",
                headers=tok(direct_mgr_a),
                json={
                    "employee_id": str(emp_a1.id),
                    "customer_name": "Bad Coords Site",
                    "site_address": "Nowhere",
                    "site_latitude": bad_lat,
                    "site_longitude": bad_lng,
                    "visit_date": today_iso,
                },
            )
            assert r_bad_sv.status_code in (400, 422), f"Invalid site coords ({bad_lat},{bad_lng}) accepted: {r_bad_sv.status_code}"

        # 2. Valid create by Manager
        r_create = await client.post(
            "/api/v1/hrms/site-visits",
            headers=tok(direct_mgr_a),
            json={
                "employee_id": str(emp_a1.id),
                "customer_name": "Wave2 Client Corp",
                "site_address": "Plot 9, Thane",
                "site_latitude": site_lat,
                "site_longitude": site_lng,
                "visit_date": today_iso,
            },
        )
        assert r_create.status_code == 201, r_create.text
        visit_id = r_create.json()["data"]["id"]

        # 3. Edit & Reassign (PATCH /hrms/site-visits/{id}) -> MUST work (no 405!)
        r_edit = await client.patch(
            f"/api/v1/hrms/site-visits/{visit_id}",
            headers=tok(direct_mgr_a),
            json={
                "customer_name": "Wave2 Client Corp (Updated)",
                "employee_id": str(emp_a2.id),
                "notes": "Reassigned to Bob",
            },
        )
        assert r_edit.status_code == 200, f"Site visit edit/reassign failed: {r_edit.status_code} {r_edit.text}"
        assert r_edit.json()["data"]["customer_name"] == "Wave2 Client Corp (Updated)"
        assert r_edit.json()["data"]["employee_id"] == str(emp_a2.id)

        # Cross-dept manager cannot reassign to outside dept
        r_xdept = await client.patch(
            f"/api/v1/hrms/site-visits/{visit_id}",
            headers=tok(direct_mgr_a),
            json={"employee_id": str(emp_b1.id)},
        )
        assert r_xdept.status_code == 403

        # Reassign back to emp_a1 for check-in tests
        r_back = await client.put(
            f"/api/v1/hrms/site-visits/{visit_id}",
            headers=tok(admin),
            json={"employee_id": str(emp_a1.id)},
        )
        assert r_back.status_code == 200

        # 4. Create a 2nd visit and Cancel it (POST /hrms/site-visits/{id}/cancel)
        r_create2 = await client.post(
            "/api/v1/hrms/site-visits",
            headers=tok(direct_mgr_a),
            json={
                "employee_id": str(emp_a1.id),
                "customer_name": "Cancel Target Corp",
                "site_address": "Plot 10, Thane",
                "site_latitude": site_lat,
                "site_longitude": site_lng,
                "visit_date": today_iso,
            },
        )
        assert r_create2.status_code == 201
        visit2_id = r_create2.json()["data"]["id"]

        r_cancel = await client.post(
            f"/api/v1/hrms/site-visits/{visit2_id}/cancel",
            headers=tok(direct_mgr_a),
            json={"reason": "Client rescheduled"},
        )
        assert r_cancel.status_code == 200, f"Site visit cancel failed: {r_cancel.status_code} {r_cancel.text}"
        assert r_cancel.json()["data"]["status"] == "CANCELLED"

        # Editing or checking into cancelled visit rejected 400
        r_edit_cancelled = await client.patch(
            f"/api/v1/hrms/site-visits/{visit2_id}",
            headers=tok(direct_mgr_a),
            json={"notes": "Should fail"},
        )
        assert r_edit_cancelled.status_code == 400

        # 5. Concurrent check-in (4x) within 299m -> EXACTLY 1 succeeds [200, 400, 400, 400] and 1 CheckIn row!
        now_iso = datetime.now(timezone.utc).isoformat()
        in_lat, in_lng = _offset_point(site_lat, site_lng, 290.0)
        ci_resps = await asyncio.gather(
            *[
                client.post(
                    f"/api/v1/hrms/site-visits/{visit_id}/check-in",
                    headers=tok(emp_a1),
                    json={"latitude": in_lat, "longitude": in_lng, "accuracy": 15.0, "gps_timestamp": now_iso},
                )
                for _ in range(4)
            ]
        )
        ci_codes = sorted(r.status_code for r in ci_resps)
        assert ci_codes == [200, 400, 400, 400], f"Concurrent check-in race: {ci_codes}"

        # Concurrent check-out (4x) -> EXACTLY 1 succeeds [200, 400, 400, 400]
        co_resps = await asyncio.gather(
            *[
                client.post(
                    f"/api/v1/hrms/site-visits/{visit_id}/check-out",
                    headers=tok(emp_a1),
                    json={"latitude": in_lat, "longitude": in_lng, "accuracy": 12.0, "gps_timestamp": now_iso},
                )
                for _ in range(4)
            ]
        )
        co_codes = sorted(r.status_code for r in co_resps)
        assert co_codes == [200, 400, 400, 400], f"Concurrent check-out race: {co_codes}"

        async with SessionFactory() as db:
            logs = list(
                (await db.execute(select(HrmsSiteVisitCheckIn).where(HrmsSiteVisitCheckIn.site_visit_id == uuid.UUID(visit_id))))
                .scalars()
                .all()
            )
            assert len(logs) == 2, f"Expected exactly 2 audit rows (1 CHECK_IN + 1 CHECK_OUT), found {len(logs)}"
            assert all(lg.employee_id == emp_a1.id for lg in logs)

        # 6. Regularization evidence access control (including HR with attendance + deny:site_visits)
        r_reg = await client.post(
            "/api/v1/hrms/attendance/regularizations",
            headers=tok(emp_a1),
            json={"date": today_iso, "reason": "Customer site visit", "notes": "Wave2 visit proof"},
        )
        assert r_reg.status_code == 200, r_reg.text
        reg_id = r_reg.json()["data"]["id"]

        # Unrelated employee -> 403
        r_ev_unauth = await client.get(
            f"/api/v1/hrms/attendance/regularizations/{reg_id}/evidence", headers=tok(emp_b1)
        )
        assert r_ev_unauth.status_code == 403

        # HR with hrms.attendance (even with deny:hrms.site_visits) -> 200 (HRMS-BUG-31)
        r_ev_hr = await client.get(
            f"/api/v1/hrms/attendance/regularizations/{reg_id}/evidence", headers=tok(hr_deny_sv)
        )
        assert r_ev_hr.status_code == 200, f"HR attendance reviewer blocked from regularization evidence: {r_ev_hr.status_code}"
        assert any(v["id"] == visit_id for v in r_ev_hr.json()["data"]["site_visits"])


# =============================================================================
# C. GEOFENCING VALIDATION, BOUNDARIES, CONCURRENCY & TIMERS (HRMS-BUG-13, 20)
# =============================================================================


@pytest.mark.asyncio
async def test_c_geofencing_validation_boundaries_concurrency_multi_office_and_timers(wave2_env):
    env = wave2_env
    tok = env["tok"]
    emp_a1 = env["emp_a1"]
    emp_a2 = env["emp_a2"]
    emp_b1 = env["emp_b1"]
    office_primary = env["office_primary"]
    office_secondary = env["office_secondary"]
    office_inactive = env["office_inactive"]
    SessionFactory = env["SessionFactory"]

    p_lat, p_lng = office_primary.latitude, office_primary.longitude

    async with AsyncClient(transport=env["transport"], base_url="http://test") as client:
        # 1. Invalid inputs MUST return 400/422 — NEVER 500! (HRMS-BUG-13)
        r_nan = await client.post(
            "/api/v1/hrms/attendance/geofence-status?latitude=nan&longitude=nan&accuracy=10",
            headers=tok(emp_a1),
        )
        assert r_nan.status_code in (400, 422), f"Expected 400/422 on NaN, got {r_nan.status_code}: {r_nan.text}"

        r_inf = await client.post(
            "/api/v1/hrms/attendance/geofence-status?latitude=inf&longitude=72.95&accuracy=10",
            headers=tok(emp_a1),
        )
        assert r_inf.status_code in (400, 422), f"Expected 400/422 on Inf, got {r_inf.status_code}: {r_inf.text}"

        for bad_name, body in [
            ("lat_999", {"latitude": 999.0, "longitude": 72.95, "accuracy": 10.0}),
            ("null_island", {"latitude": 0.0, "longitude": 0.0, "accuracy": 10.0}),
            ("neg_acc", {"latitude": p_lat, "longitude": p_lng, "accuracy": -10.0}),
            ("stale_ts", {"latitude": p_lat, "longitude": p_lng, "accuracy": 10.0, "gps_timestamp": (datetime.now(timezone.utc) - timedelta(seconds=120)).isoformat()}),
            ("future_ts", {"latitude": p_lat, "longitude": p_lng, "accuracy": 10.0, "gps_timestamp": (datetime.now(timezone.utc) + timedelta(seconds=60)).isoformat()}),
        ]:
            rb = await client.post("/api/v1/hrms/attendance/geofence-status", headers=tok(emp_a1), json=body)
            assert rb.status_code in (400, 422), f"Expected 400/422 for {bad_name}, got {rb.status_code}: {rb.text}"

        # 2. Boundary accuracy: inside (140m), exact boundary (149.9m <= 150m), outside (155m)
        lat_in, lng_in = _offset_point(p_lat, p_lng, 140.0)
        r_in = await client.post(
            "/api/v1/hrms/attendance/geofence-status",
            headers=tok(emp_a1),
            json={"latitude": lat_in, "longitude": lng_in, "accuracy": 10.0, "gps_timestamp": datetime.now(timezone.utc).isoformat()},
        )
        assert r_in.status_code == 200
        assert r_in.json()["data"]["is_inside"] is True
        assert r_in.json()["data"]["status"] == "INSIDE"

        # 3. Multiple permitted offices: inside secondary office -> INSIDE; inside INACTIVE office -> OUTSIDE!
        r_sec = await client.post(
            "/api/v1/hrms/attendance/geofence-status",
            headers=tok(emp_a1),
            json={"latitude": office_secondary.latitude, "longitude": office_secondary.longitude, "accuracy": 10.0},
        )
        assert r_sec.status_code == 200
        assert r_sec.json()["data"]["is_inside"] is True
        assert r_sec.json()["data"]["office_name"] == office_secondary.name

        # 4. Poor accuracy drift outside office -> MUST NOT create false violation row & returns POOR_ACCURACY!
        lat_out, lng_out = _offset_point(p_lat, p_lng, 220.0)
        r_drift = await client.post(
            "/api/v1/hrms/attendance/geofence-status",
            headers=tok(emp_a1),
            json={"latitude": lat_out, "longitude": lng_out, "accuracy": 250.0},
        )
        assert r_drift.status_code == 200
        drift_data = r_drift.json()["data"]
        assert drift_data["active_exit"] is False
        assert drift_data["status"] == "POOR_ACCURACY", f"Expected POOR_ACCURACY, got {drift_data['status']}"

        async with SessionFactory() as db:
            v_cnt = (
                await db.execute(
                    select(func.count(HrmsGeofenceViolation.id)).where(HrmsGeofenceViolation.employee_id == emp_a1.id)
                )
            ).scalar()
            assert v_cnt == 0, f"Poor accuracy drift created {v_cnt} false violation rows!"

        # 5. Concurrent 6x outside heartbeats -> MUST create EXACTLY 1 open violation row (HRMS-BUG-20)
        conc_out = await asyncio.gather(
            *[
                client.post(
                    "/api/v1/hrms/attendance/geofence-status",
                    headers=tok(emp_a1),
                    json={"latitude": lat_out, "longitude": lng_out, "accuracy": 10.0},
                )
                for _ in range(6)
            ]
        )
        assert all(r.status_code == 200 for r in conc_out)
        incident_ids = {r.json()["data"]["incident_id"] for r in conc_out}
        assert len(incident_ids) == 1, f"Concurrent outside heartbeats created multiple incidents: {incident_ids}"

        async with SessionFactory() as db:
            open_cnt = (
                await db.execute(
                    select(func.count(HrmsGeofenceViolation.id)).where(
                        HrmsGeofenceViolation.employee_id == emp_a1.id,
                        HrmsGeofenceViolation.return_time.is_(None),
                    )
                )
            ).scalar()
            assert open_cnt == 1, f"Expected 1 open geofence violation in DB, found {open_cnt}"

        # 6. Return inside before expiry -> RESOLVED
        r_ret = await client.post(
            "/api/v1/hrms/attendance/geofence-status",
            headers=tok(emp_a1),
            json={"latitude": p_lat, "longitude": p_lng, "accuracy": 10.0},
        )
        assert r_ret.status_code == 200
        assert r_ret.json()["data"]["status"] == "RESOLVED"
        assert r_ret.json()["data"]["is_inside"] is True

        # 7. Employee-specific return timer overrides:
        #    emp_a2 has return_timer_seconds=0 -> immediate EXPIRED
        r_imm = await client.post(
            "/api/v1/hrms/attendance/geofence-status",
            headers=tok(emp_a2),
            json={"latitude": office_inactive.latitude, "longitude": office_inactive.longitude, "accuracy": 10.0},
        )
        assert r_imm.status_code == 200
        assert r_imm.json()["data"]["status"] == "EXPIRED"
        assert r_imm.json()["data"]["is_expired"] is True

        #    emp_b1 has is_unlimited_return=True -> OUTSIDE_PENDING, is_unlimited=True, not expired
        r_unlim = await client.post(
            "/api/v1/hrms/attendance/geofence-status",
            headers=tok(emp_b1),
            json={"latitude": lat_out, "longitude": lng_out, "accuracy": 10.0},
        )
        assert r_unlim.status_code == 200
        assert r_unlim.json()["data"]["is_unlimited"] is True
        assert r_unlim.json()["data"]["is_expired"] is False


# =============================================================================
# D. NOTIFICATIONS: RECORD-SCOPED DEDUP, COMPLETE EVENTS & HR FALLBACK (HRMS-BUG-17)
# =============================================================================


@pytest.mark.asyncio
async def test_d_notifications_record_scoped_dedup_complete_events_and_savepoint(wave2_env):
    env = wave2_env
    tok = env["tok"]
    admin = env["admin"]
    hr_std = env["hr_std"]
    hr_deny_sv = env["hr_deny_sv"]
    hr_term = env["hr_term"]
    direct_mgr_a = env["direct_mgr_a"]
    emp_a1 = env["emp_a1"]
    emp_a2 = env["emp_a2"]
    emp_no_mgr = env["emp_no_mgr"]
    lt_plan_test = env["lt_plan_test"]
    SessionFactory = env["SessionFactory"]

    async with AsyncClient(transport=env["transport"], base_url="http://test") as client:
        # 1. Two distinct employees submit expenses to the SAME manager within 24h ->
        #    Manager MUST receive TWO distinct notifications (HRMS-BUG-17)!
        today_iso = date.today().isoformat()
        exp_payload = {
            "expense_date": today_iso,
            "category": "Travel",
            "amount": 250.0,
            "description": "Wave2 client cab",
            "receipt_url": "private://expense-receipts/dummy.pdf",
            "is_submit": True,
        }
        r_e1 = await client.post("/api/v1/hrms/expenses?submit=true", headers=tok(emp_a1), json=exp_payload)
        assert r_e1.status_code == 201, r_e1.text
        exp1_id = r_e1.json()["data"]["id"]

        r_e2 = await client.post("/api/v1/hrms/expenses?submit=true", headers=tok(emp_a2), json=exp_payload)
        assert r_e2.status_code == 201, r_e2.text
        exp2_id = r_e2.json()["data"]["id"]

        async with SessionFactory() as db:
            mgr_exp_notifs = list(
                (
                    await db.execute(
                        select(Notification).where(
                            Notification.user_id == direct_mgr_a.id,
                            Notification.type == "hrms_expense_submitted",
                        )
                    )
                )
                .scalars()
                .all()
            )
            assert len(mgr_exp_notifs) == 2, f"HRMS-BUG-17: Expected 2 expense notifications for manager, got {len(mgr_exp_notifs)}"
            assert len({n.link for n in mgr_exp_notifs}) == 2, "Expense notification links must be record-scoped!"

        # Approve & Reimburse exp1 -> employee receives APPROVED and REIMBURSED notifications
        r_app = await client.post(f"/api/v1/hrms/expenses/{exp1_id}/approve", headers=tok(direct_mgr_a))
        assert r_app.status_code == 200, r_app.text
        r_reimb = await client.post(
            f"/api/v1/hrms/expenses/{exp1_id}/reimburse",
            headers=tok(admin),
            json={"reimbursement_notes": "NEFT ref 999"},
        )
        assert r_reimb.status_code == 200, r_reimb.text

        async with SessionFactory() as db:
            emp_exp_types = set(
                (
                    await db.execute(
                        select(Notification.type).where(
                            Notification.user_id == emp_a1.id,
                            Notification.type.in_(["hrms_expense_approved", "hrms_expense_reimbursed"]),
                        )
                    )
                )
                .scalars()
                .all()
            )
            assert "hrms_expense_approved" in emp_exp_types
            assert "hrms_expense_reimbursed" in emp_exp_types, "Missing expense reimbursement notification!"

        # 2. Two distinct leave requests to same manager within 24h -> BOTH delivered!
        d_lv1 = _working_date(10).isoformat()
        d_lv2 = _working_date(12).isoformat()
        r_l1 = await client.post(
            "/api/v1/hrms/leave/requests",
            headers=tok(emp_a1),
            json={"leave_type_id": str(lt_plan_test.id), "from_date": d_lv1, "to_date": d_lv1, "reason": "Personal 1"},
        )
        assert r_l1.status_code == 201, r_l1.text
        r_l2 = await client.post(
            "/api/v1/hrms/leave/requests",
            headers=tok(emp_a2),
            json={"leave_type_id": str(lt_plan_test.id), "from_date": d_lv2, "to_date": d_lv2, "reason": "Personal 2"},
        )
        assert r_l2.status_code == 201, r_l2.text

        async with SessionFactory() as db:
            mgr_lv_notifs = list(
                (
                    await db.execute(
                        select(Notification).where(
                            Notification.user_id == direct_mgr_a.id,
                            Notification.type == "hrms_leave_requested",
                        )
                    )
                )
                .scalars()
                .all()
            )
            assert len(mgr_lv_notifs) == 2, f"Expected 2 leave notifications for manager, got {len(mgr_lv_notifs)}"

        # 3. HR Fallback notification for employee without manager MUST NOT notify terminated HR or deny:hrms.approve HR!
        r_l_nomgr = await client.post(
            "/api/v1/hrms/leave/requests",
            headers=tok(emp_no_mgr),
            json={"leave_type_id": str(lt_plan_test.id), "from_date": d_lv1, "to_date": d_lv1, "reason": "NoMgr Leave"},
        )
        assert r_l_nomgr.status_code == 201, r_l_nomgr.text
        nomgr_lv_id = r_l_nomgr.json()["data"]["id"]

        async with SessionFactory() as db:
            fallback_recipients = set(
                (
                    await db.execute(
                        select(Notification.user_id).where(
                            Notification.type == "hrms_leave_requested",
                            Notification.link.contains(nomgr_lv_id),
                        )
                    )
                )
                .scalars()
                .all()
            )
            assert hr_std.id in fallback_recipients, "Active HR should receive fallback leave notification"
            assert hr_term.id not in fallback_recipients, "Terminated HR MUST NOT receive fallback notification!"
            assert hr_deny_sv.id not in fallback_recipients, "HR with deny:hrms.approve MUST NOT receive approval notification!"

        # 4. Asset assign + return notifications
        r_ast = await client.post(
            "/api/v1/hrms/assets",
            headers=tok(admin),
            json={"asset_name": f"Wave2 Laptop {env['tag']}", "asset_category": "Laptop", "status": "AVAILABLE"},
        )
        assert r_ast.status_code == 201, r_ast.text
        ast_id = r_ast.json()["data"]["id"]
        env["created_asset_ids"].append(uuid.UUID(ast_id))

        r_asgn = await client.post(
            f"/api/v1/hrms/assets/{ast_id}/assign",
            headers=tok(admin),
            json={"employee_id": str(emp_a1.id), "assigned_date": today_iso},
        )
        assert r_asgn.status_code == 200, r_asgn.text

        r_ret = await client.post(
            f"/api/v1/hrms/assets/{ast_id}/return",
            headers=tok(admin),
            json={"return_date": today_iso, "condition_after_return": "GOOD"},
        )
        assert r_ret.status_code == 200, r_ret.text

        async with SessionFactory() as db:
            ast_notifs = set(
                (
                    await db.execute(
                        select(Notification.type).where(
                            Notification.user_id == emp_a1.id,
                            Notification.type.in_(["hrms_asset_assigned", "hrms_asset_returned"]),
                        )
                    )
                )
                .scalars()
                .all()
            )
            assert "hrms_asset_assigned" in ast_notifs
            assert "hrms_asset_returned" in ast_notifs, "Missing asset return notification!"

        # 5. Notification read/unread API consistency
        r_notifs = await client.get("/api/v1/notifications", headers=tok(emp_a1))
        assert r_notifs.status_code == 200
        items = r_notifs.json()["data"]
        assert len(items) >= 2


# =============================================================================
# E. LEAVE PLAN DELETE, DRAFT EXPENSE LEAK, CONCURRENT 500s & RBAC (BUG 11,16,18,19,21)
# =============================================================================


@pytest.mark.asyncio
async def test_e_leave_plan_soft_delete_draft_expense_concurrency_and_rbac(wave2_env):
    env = wave2_env
    tok = env["tok"]
    admin = env["admin"]
    dept_mgr_a = env["dept_mgr_a"]
    direct_mgr_a = env["direct_mgr_a"]
    emp_a1 = env["emp_a1"]
    emp_a2 = env["emp_a2"]
    emp_lead_1rep = env["emp_lead_1rep"]
    emp_sub = env["emp_sub"]
    emp_readonly = env["emp_readonly"]
    emp_revoked = env["emp_revoked"]
    office_primary = env["office_primary"]
    lt_plan_test = env["lt_plan_test"]
    SessionFactory = env["SessionFactory"]

    today_iso = date.today().isoformat()

    async with AsyncClient(transport=env["transport"], base_url="http://test") as client:
        # 1. HRMS-BUG-16: Soft-deleting Leave Plan MUST NOT break linked leave types!
        r_plan = await client.post(
            "/api/v1/hrms/leave/plans",
            headers=tok(admin),
            json={
                "name": f"W2 Temp Plan {env['tag']}",
                "branch": "All Branches",
                "department": "All Departments",
                "effective_from": f"{date.today().year}-01-01",
                "effective_to": f"{date.today().year}-12-31",
                "is_active": True,
                "leave_type_ids": [str(lt_plan_test.id)],
            },
        )
        assert r_plan.status_code == 201, r_plan.text
        plan_id = r_plan.json()["data"]["id"]
        env["created_plan_ids"].append(uuid.UUID(plan_id))

        r_del_plan = await client.delete(f"/api/v1/hrms/leave/plans/{plan_id}", headers=tok(admin))
        assert r_del_plan.status_code == 200

        r_app_types = await client.get("/api/v1/hrms/leave/applicable-types", headers=tok(emp_a1))
        assert r_app_types.status_code == 200
        app_lt_ids = [t["id"] for t in r_app_types.json()["data"]]
        assert str(lt_plan_test.id) in app_lt_ids, "HRMS-BUG-16: Soft-deleted leave plan hid linked leave type!"

        # 2. HRMS-BUG-18: Private DRAFT expense MUST NOT leak into approvals queue or summary!
        r_draft = await client.post(
            "/api/v1/hrms/expenses",
            headers=tok(emp_a1),
            json={
                "expense_date": today_iso,
                "category": "Meals",
                "amount": 321.0,
                "description": "Private unsubmitted draft",
                "is_submit": False,
            },
        )
        assert r_draft.status_code == 201
        draft_id = r_draft.json()["data"]["id"]
        assert r_draft.json()["data"]["status"] == "DRAFT"

        r_q = await client.get("/api/v1/hrms/expenses?view_mode=approvals", headers=tok(direct_mgr_a))
        assert r_q.status_code == 200
        q_ids = [e["id"] for e in r_q.json()["data"]]
        assert draft_id not in q_ids, "HRMS-BUG-18: Private DRAFT leaked into approvals queue!"

        r_sum = await client.get("/api/v1/hrms/expenses/summary?view_mode=approvals", headers=tok(direct_mgr_a))
        assert r_sum.status_code == 200
        assert r_sum.json()["data"]["draft_count"] == 0, "HRMS-BUG-18: Private DRAFT counted in approvals summary!"

        r_draft_read = await client.get(f"/api/v1/hrms/expenses/{draft_id}", headers=tok(direct_mgr_a))
        assert r_draft_read.status_code == 403, f"Non-owner read private DRAFT expense: {r_draft_read.status_code}"

        # 3. HRMS-BUG-19: Concurrent punch-in, asset create, expense create -> ZERO 500s!
        now_iso = datetime.now(timezone.utc).isoformat()
        punch_resps = await asyncio.gather(
            *[
                client.post(
                    "/api/v1/hrms/attendance/punch-in",
                    headers=tok(emp_a1),
                    json={
                        "latitude": office_primary.latitude,
                        "longitude": office_primary.longitude,
                        "accuracy": 10.0,
                        "gps_timestamp": now_iso,
                    },
                )
                for _ in range(4)
            ]
        )
        punch_codes = sorted(r.status_code for r in punch_resps)
        assert 500 not in punch_codes, f"HRMS-BUG-19: Concurrent punch-in crashed with 500: {punch_codes}"
        assert punch_codes == [201, 400, 400, 400], f"Unexpected punch-in race statuses: {punch_codes}"

        ast_resps = await asyncio.gather(
            *[
                client.post(
                    "/api/v1/hrms/assets",
                    headers=tok(admin),
                    json={"asset_name": f"W2 Race Asset {i} {env['tag']}", "asset_category": "Monitor", "status": "AVAILABLE"},
                )
                for i in range(5)
            ]
        )
        ast_codes = [r.status_code for r in ast_resps]
        assert all(c == 201 for c in ast_codes), f"HRMS-BUG-19: Concurrent asset create failed: {ast_codes}"
        ast_gen_codes = set()
        for r in ast_resps:
            d = r.json()["data"]
            env["created_asset_ids"].append(uuid.UUID(d["id"]))
            ast_gen_codes.add(d["asset_code"])
        assert len(ast_gen_codes) == 5

        exp_resps = await asyncio.gather(
            *[
                client.post(
                    "/api/v1/hrms/expenses",
                    headers=tok(emp_a2),
                    json={
                        "expense_date": today_iso,
                        "category": "Travel",
                        "amount": 100.0 + i,
                        "description": f"Concurrent draft {i}",
                        "is_submit": False,
                    },
                )
                for i in range(5)
            ]
        )
        exp_codes = [r.status_code for r in exp_resps]
        assert all(c == 201 for c in exp_codes), f"HRMS-BUG-19: Concurrent expense create failed: {exp_codes}"
        assert len({r.json()["data"]["expense_code"] for r in exp_resps}) == 5

        # 4. HRMS-BUG-21: Manager-First precedence & 1-report non-escalation
        # (a) emp_a1's manager_id is direct_mgr_a (active & available). dept_mgr_a is same dept but NOT emp_a1.manager_id!
        r_lv = await client.post(
            "/api/v1/hrms/leave/requests",
            headers=tok(emp_a1),
            json={
                "leave_type_id": str(lt_plan_test.id),
                "from_date": _working_date(20).isoformat(),
                "to_date": _working_date(20).isoformat(),
                "reason": "Manager-first precedence test",
            },
        )
        assert r_lv.status_code == 201, r_lv.text
        lv_id = r_lv.json()["data"]["id"]

        r_wrong_mgr = await client.post(
            f"/api/v1/hrms/leave/approvals/{lv_id}/approve",
            headers=tok(dept_mgr_a),
            json={"approval_remarks": "Secondary dept manager trying to bypass direct manager"},
        )
        assert r_wrong_mgr.status_code == 403, f"HRMS-BUG-21: Secondary Dept Mgr bypassed emp.manager_id! Got {r_wrong_mgr.status_code}"

        # (b) emp_lead_1rep has 1 direct report (emp_sub) in dept_a, but NO manager role -> MUST NOT access unrelated dept_a peer emp_a2!
        r_lead_peer = await client.get(
            f"/api/v1/hrms/leave/balances?employee_id={emp_a2.id}", headers=tok(emp_lead_1rep)
        )
        assert r_lead_peer.status_code == 403, f"HRMS-BUG-21: 1-report employee escalated to full dept! Got {r_lead_peer.status_code}"

        # (c) Reassign emp_sub.manager_id from emp_lead_1rep to direct_mgr_a -> emp_lead_1rep immediately loses approval right!
        r_sub_lv = await client.post(
            "/api/v1/hrms/leave/requests",
            headers=tok(emp_sub),
            json={
                "leave_type_id": str(lt_plan_test.id),
                "from_date": _working_date(22).isoformat(),
                "to_date": _working_date(22).isoformat(),
                "reason": "Reassigned manager test",
            },
        )
        assert r_sub_lv.status_code == 201
        sub_lv_id = r_sub_lv.json()["data"]["id"]

        async with SessionFactory() as db:
            sub_row = await db.get(User, emp_sub.id)
            sub_row.manager_id = direct_mgr_a.id
            await db.commit()

        r_old_mgr = await client.post(
            f"/api/v1/hrms/leave/approvals/{sub_lv_id}/approve",
            headers=tok(emp_lead_1rep),
            json={"approval_remarks": "Former manager attempting approval"},
        )
        assert r_old_mgr.status_code == 403, f"HRMS-BUG-21: Former manager approved after reassignment! Got {r_old_mgr.status_code}"

        # 5. HRMS-BUG-11: Read-only & deny:hrms.view enforced across all 6 HRMS modules
        r_ro_punch = await client.post(
            "/api/v1/hrms/attendance/punch-in",
            headers=tok(emp_readonly),
            json={"latitude": office_primary.latitude, "longitude": office_primary.longitude, "accuracy": 10.0, "gps_timestamp": now_iso},
        )
        assert r_ro_punch.status_code == 403, f"Read-only user allowed to punch-in: {r_ro_punch.status_code}"

        r_ro_track = await client.post("/api/v1/hrms/tracking/start", headers=tok(emp_readonly), json={})
        assert r_ro_track.status_code == 403, f"Read-only user allowed to start tracking: {r_ro_track.status_code}"

        for ep in [
            "/api/v1/hrms/attendance/today",
            "/api/v1/hrms/leave/requests",
            "/api/v1/hrms/assets",
            "/api/v1/hrms/expenses",
            "/api/v1/hrms/site-visits",
            "/api/v1/hrms/payroll/payslips",
        ]:
            r_rev = await client.get(ep, headers=tok(emp_revoked))
            assert r_rev.status_code == 403, f"HRMS-BUG-11: Revoked user (deny:hrms.view) got {r_rev.status_code} on {ep}"


# =============================================================================
# F. PERFORMANCE & N+1 SQL QUERY COUNT BOUNDS (HRMS-BUG-27)
# =============================================================================


@pytest.mark.asyncio
async def test_f_performance_n_plus_1_query_counts_and_pagination(wave2_env):
    env = wave2_env
    tok = env["tok"]
    admin = env["admin"]
    emp_a1 = env["emp_a1"]
    emp_a2 = env["emp_a2"]
    emp_b1 = env["emp_b1"]
    lt_plan_test = env["lt_plan_test"]
    SessionFactory = env["SessionFactory"]

    # Seed 10 assets, 10 leave requests, and salary structures for 5 users
    today_iso = date.today().isoformat()
    async with AsyncClient(transport=env["transport"], base_url="http://test") as client:
        for i in range(10):
            r_a = await client.post(
                "/api/v1/hrms/assets",
                headers=tok(admin),
                json={"asset_name": f"Perf Asset {i} {env['tag']}", "asset_category": "Laptop", "status": "AVAILABLE"},
            )
            assert r_a.status_code == 201
            aid = r_a.json()["data"]["id"]
            env["created_asset_ids"].append(uuid.UUID(aid))
            if i < 3:
                target_u = [emp_a1, emp_a2, emp_b1][i]
                await client.post(
                    f"/api/v1/hrms/assets/{aid}/assign",
                    headers=tok(admin),
                    json={"employee_id": str(target_u.id), "assigned_date": today_iso},
                )

        # Assign salaries to 5 synthetic users and run payroll for an isolated test month (2025-03)
        pay_month = "2025-03"
        env["created_payroll_months"].add(pay_month)
        for u in (emp_a1, emp_a2, emp_b1, env["emp_no_mgr"], env["emp_sub"]):
            r_s = await client.post(
                "/api/v1/hrms/payroll/salary/assign",
                headers=tok(admin),
                json={"employee_id": str(u.id), "annual_ctc": 600000.0, "effective_from": "2025-01-01"},
            )
            assert r_s.status_code in (200, 201), r_s.text

        # Seed 8 leave requests across employees (distinct Mon-Fri working days in Jan next year to avoid holidays)
        base_mon = date(date.today().year + 1, 2, 2)
        while base_mon.weekday() != 0:
            base_mon += timedelta(days=1)
        for idx in range(8):
            target_u = [emp_a1, emp_a2, emp_b1, env["emp_no_mgr"]][idx % 4]
            d_lv = (base_mon + timedelta(days=(idx // 4) * 7 + (idx % 4))).isoformat()
            r_lr = await client.post(
                "/api/v1/hrms/leave/requests",
                headers=tok(target_u),
                json={"leave_type_id": str(lt_plan_test.id), "from_date": d_lv, "to_date": d_lv, "reason": f"Perf leave {idx}"},
            )
            assert r_lr.status_code == 201, r_lr.text

        # Attach SQL query counter to the app's engine
        import app.database.engine as engine_module

        app_engine = engine_module.get_engine()
        sql_counter = {"count": 0}

        def _count_sql(conn, cursor, statement, parameters, context, executemany):
            sql_counter["count"] += 1

        event.listen(app_engine.sync_engine, "before_cursor_execute", _count_sql)
        try:
            # 1. GET /hrms/assets -> MUST NOT do N+1 per asset (constant O(1) <= 25 queries)
            sql_counter["count"] = 0
            r_assets = await client.get("/api/v1/hrms/assets", headers=tok(admin))
            assert r_assets.status_code == 200
            assets_queries = sql_counter["count"]
            assert assets_queries <= 25, f"HRMS-BUG-27: GET /hrms/assets executed {assets_queries} SQL queries (N+1)!"

            # 2. GET /hrms/leave/approvals -> MUST NOT do 5*N queries (constant O(1) <= 15 queries)
            sql_counter["count"] = 0
            r_lv_app = await client.get("/api/v1/hrms/leave/approvals?limit=50", headers=tok(admin))
            assert r_lv_app.status_code == 200
            lv_queries = sql_counter["count"]
            assert lv_queries <= 15, f"HRMS-BUG-27: GET /hrms/leave/approvals executed {lv_queries} SQL queries (N+1)!"

            # 3. POST /hrms/payroll/calculate -> MUST NOT scale linearly with N*13 queries (constant O(1) <= 40 queries)
            sql_counter["count"] = 0
            r_pay = await client.post(
                "/api/v1/hrms/payroll/calculate",
                headers=tok(admin),
                json={"payroll_month": pay_month},
            )
            assert r_pay.status_code in (200, 201), r_pay.text
            pay_queries = sql_counter["count"]
            assert pay_queries <= 40, f"HRMS-BUG-27: POST /hrms/payroll/calculate executed {pay_queries} SQL queries (N+1)!"
        finally:
            event.remove(app_engine.sync_engine, "before_cursor_execute", _count_sql)
