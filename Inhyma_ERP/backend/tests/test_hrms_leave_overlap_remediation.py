"""
HRMS Leave Overlap Crash Remediation (NEW-01) — Real PostgreSQL Regression Suite.

Validates:
- 0, 1, 2, 3, and 4 overlapping existing leave requests return deterministic
  outcomes (201 for 0 overlaps, 400 for 1/2/3+ overlaps — never HTTP 500 /
  sqlalchemy.exc.MultipleResultsFound).
- Status combinations (PENDING, APPROVED, REJECTED, CANCELLED).
- Date boundaries (adjacent before/after, exact start touch, exact end touch,
  exact single-day match, contained, enclosing multiple non-contiguous leaves).
- Employee isolation (overlapping leaves for Employee A never block Employee B).
- Concurrent overlapping submissions for the same employee serialize cleanly
  (exactly 1 winner 201 and remaining losers 400, zero duplicates, zero 500s),
  and concurrent overlapping submissions by different employees both succeed.

Safety:
- Runs strictly against an isolated local PostgreSQL database (`inhyma_test_db`),
  never Supabase or production.
- Cleans up 100% of synthetic test rows in `finally:`.
"""

from __future__ import annotations

import asyncio
import os
import uuid
from datetime import date, datetime, timezone

import pytest
import pytest_asyncio
from fastapi import HTTPException
from httpx import ASGITransport, AsyncClient
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine

from app.auth.security import create_access_token, hash_password
from app.core.config import settings
from app.hrms.leave_service import HrmsLeaveService
from app.hrms.models import (
    HrmsEmployeeLeaveBalance,
    HrmsLeavePlan,
    HrmsLeavePlanType,
    HrmsLeaveRequest,
    HrmsLeaveType,
)
from app.hrms.schemas import LeaveRequestCreate
from app.main import create_application
from app.notifications.models import Notification
from app.rbac.models import Role, RoleAssignmentStatus, UserRole
from app.users.models import EmploymentStatus, EmploymentType, User, UserStatus

PG_TEST_URL = os.environ.get(
    "HRMS_PG_TEST_URL",
    os.environ.get("TEST_DATABASE_URL", "postgresql+asyncpg://postgres:root@127.0.0.1:5432/inhyma_test_db"),
)


def _ensure_safe_local_pg(url: str) -> None:
    lower = url.lower()
    if "supabase.com" in lower or "supabase.co" in lower:
        pytest.skip("Refusing to execute HRMS PostgreSQL integration tests against Supabase.")
    if not lower.startswith("postgresql"):
        pytest.skip("HRMS leave overlap integration suite requires a PostgreSQL DATABASE_URL.")


@pytest_asyncio.fixture
async def pg_leave_env():
    _ensure_safe_local_pg(PG_TEST_URL)
    prev_db_url = str(settings.DATABASE_URL)
    os.environ["DATABASE_URL"] = PG_TEST_URL
    object.__setattr__(settings, "DATABASE_URL", PG_TEST_URL)

    import app.database.engine as engine_module

    await engine_module.dispose_engine()

    engine: AsyncEngine = create_async_engine(PG_TEST_URL, pool_size=15, max_overflow=20)
    SessionFactory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    tag = uuid.uuid4().hex[:8].lower()
    pw_hash = hash_password("LeaveOverlap!2026")

    created_user_ids: list[uuid.UUID] = []
    created_role_ids: list[uuid.UUID] = []
    created_lt_ids: list[uuid.UUID] = []
    created_plan_ids: list[uuid.UUID] = []

    async with SessionFactory() as db:
        dept_role = Role(
            name=f"lvo_dept_{tag}",
            code=f"LVO{tag[:5].upper()}",
            description="Synthetic leave overlap audit dept",
            is_system=False,
        )
        db.add(dept_role)
        await db.flush()
        created_role_ids.append(dept_role.id)

        user_role = (await db.execute(select(Role).where(Role.name == "user"))).scalar_one_or_none()

        # Leave type with generous max_consecutive_days & balance so overlap logic is isolated
        lt = HrmsLeaveType(
            name=f"Overlap QA Leave {tag}",
            code=f"OVQ{tag[:4].upper()}",
            leave_type="REGULAR",
            is_paid=True,
            annual_balance=60.0,
            max_consecutive_days=45,
            is_active=True,
            allow_backdated=True,
            min_notice_days=0,
            require_attachment=False,
            allow_negative_balance=False,
            count_weekends_as_leave=True,
            count_holidays_as_leave=True,
        )
        db.add(lt)
        await db.flush()
        created_lt_ids.append(lt.id)

        # Unpaid leave type to verify advisory-lock serialization works without balance lock
        lt_unpaid = HrmsLeaveType(
            name=f"Overlap Unpaid QA {tag}",
            code=f"OVU{tag[:4].upper()}",
            leave_type="REGULAR",
            is_paid=False,
            annual_balance=60.0,
            max_consecutive_days=45,
            is_active=True,
            allow_backdated=True,
            min_notice_days=0,
            require_attachment=False,
            allow_negative_balance=True,
            count_weekends_as_leave=True,
            count_holidays_as_leave=True,
        )
        db.add(lt_unpaid)
        await db.flush()
        created_lt_ids.append(lt_unpaid.id)

        plan = HrmsLeavePlan(
            name=f"Overlap QA Plan {tag}",
            effective_from=date(2026, 1, 1),
            effective_to=date(2028, 12, 31),
            branch="All Branches",
            department=dept_role.name,
            is_active=True,
        )
        db.add(plan)
        await db.flush()
        created_plan_ids.append(plan.id)

        db.add(HrmsLeavePlanType(plan_id=plan.id, leave_type_id=lt.id))
        db.add(HrmsLeavePlanType(plan_id=plan.id, leave_type_id=lt_unpaid.id))
        await db.commit()

    async def make_employee(short_key: str) -> tuple[User, dict[str, str]]:
        async with SessionFactory() as s:
            sfx = uuid.uuid4().hex[:4]
            uname = f"lvo_{short_key}_{tag}_{sfx}"
            u = User(
                first_name="LVO",
                last_name=f"{short_key}_{sfx}",
                display_name=f"LVO {short_key} {tag}",
                employee_code=f"LVO-{short_key[:3].upper()}-{sfx.upper()}",
                has_login=True,
                username=uname,
                email=f"{uname}@inhyma-local.test",
                password_hash=pw_hash,
                employment_type=EmploymentType.FULL_TIME,
                employment_status=EmploymentStatus.ACTIVE,
                status=UserStatus.ACTIVE,
                is_active=True,
            )
            s.add(u)
            await s.flush()
            created_user_ids.append(u.id)

            s.add(
                UserRole(
                    user_id=u.id,
                    role_id=dept_role.id,
                    status=RoleAssignmentStatus.ACTIVE,
                    is_primary=True,
                )
            )
            if user_role is not None:
                s.add(
                    UserRole(
                        user_id=u.id,
                        role_id=user_role.id,
                        status=RoleAssignmentStatus.ACTIVE,
                        is_primary=False,
                    )
                )
            for yr in (2026, 2027):
                s.add(
                    HrmsEmployeeLeaveBalance(
                        employee_id=u.id,
                        leave_type_id=lt.id,
                        year=yr,
                        allocated=60.0,
                        consumed=0.0,
                        adjusted=0.0,
                        available=60.0,
                    )
                )
            await s.commit()
            tok = create_access_token(u.id, permissions=["hrms.leave", "user.view"]).token
            return u, {"Authorization": f"Bearer {tok}"}

    async def seed_leave_row(
        emp_id: uuid.UUID,
        from_d: date,
        to_d: date,
        status_val: str = "APPROVED",
        leave_type_id: uuid.UUID | None = None,
    ) -> HrmsLeaveRequest:
        async with SessionFactory() as s:
            row = HrmsLeaveRequest(
                employee_id=emp_id,
                leave_type_id=leave_type_id or lt.id,
                from_date=from_d,
                to_date=to_d,
                number_of_days=float((to_d - from_d).days + 1),
                reason=f"Seeded {status_val} {tag}",
                status=status_val,
                approval_status=status_val,
                created_by=emp_id,
                updated_by=emp_id,
            )
            s.add(row)
            await s.commit()
            await s.refresh(row)
            return row

    app = create_application()
    transport = ASGITransport(app=app, raise_app_exceptions=False)
    try:
        async with AsyncClient(transport=transport, base_url="http://testserver") as client:
            yield {
                "tag": tag,
                "client": client,
                "SessionFactory": SessionFactory,
                "lt": lt,
                "lt_unpaid": lt_unpaid,
                "make_employee": make_employee,
                "seed_leave_row": seed_leave_row,
            }
    finally:
        async with SessionFactory() as cdb:
            if created_user_ids:
                await cdb.execute(delete(Notification).where(Notification.user_id.in_(created_user_ids)))
                await cdb.execute(delete(HrmsLeaveRequest).where(HrmsLeaveRequest.employee_id.in_(created_user_ids)))
                await cdb.execute(
                    delete(HrmsEmployeeLeaveBalance).where(
                        HrmsEmployeeLeaveBalance.employee_id.in_(created_user_ids)
                    )
                )
                await cdb.execute(delete(UserRole).where(UserRole.user_id.in_(created_user_ids)))
                await cdb.execute(delete(User).where(User.id.in_(created_user_ids)))
            if created_plan_ids:
                await cdb.execute(delete(HrmsLeavePlanType).where(HrmsLeavePlanType.plan_id.in_(created_plan_ids)))
                await cdb.execute(delete(HrmsLeavePlan).where(HrmsLeavePlan.id.in_(created_plan_ids)))
            if created_lt_ids:
                await cdb.execute(delete(HrmsLeaveType).where(HrmsLeaveType.id.in_(created_lt_ids)))
            if created_role_ids:
                await cdb.execute(delete(Role).where(Role.id.in_(created_role_ids)))
            await cdb.commit()

        await engine.dispose()
        await engine_module.dispose_engine()
        object.__setattr__(settings, "DATABASE_URL", prev_db_url)


@pytest.mark.asyncio
async def test_leave_overlap_counts_0_1_2_3_plus_never_returns_500(pg_leave_env):
    """
    Core NEW-01 regression:
    - 0 overlapping leaves -> 201 Created
    - 1 overlapping leaf -> 400 Bad Request
    - 2 overlapping leaves -> 400 Bad Request (previously HTTP 500 MultipleResultsFound)
    - 3+ overlapping leaves -> 400 Bad Request (previously HTTP 500 MultipleResultsFound)
    """
    client: AsyncClient = pg_leave_env["client"]
    lt_id = str(pg_leave_env["lt"].id)
    emp, headers = await pg_leave_env["make_employee"]("counts")

    # 0 overlaps: clean period succeeds (201)
    r0 = await client.post(
        "/api/v1/hrms/leave/requests",
        json={
            "leave_type_id": lt_id,
            "from_date": "2027-01-04",
            "to_date": "2027-01-05",
            "reason": "Clean non-overlapping request",
        },
        headers=headers,
    )
    assert r0.status_code == 201, r0.text

    # Seed 1, 2, 3, and 4 approved/pending leaves across Feb 2027 and test enclosing ranges
    await pg_leave_env["seed_leave_row"](emp.id, date(2027, 2, 3), date(2027, 2, 3), "APPROVED")
    r1 = await client.post(
        "/api/v1/hrms/leave/requests",
        json={
            "leave_type_id": lt_id,
            "from_date": "2027-02-01",
            "to_date": "2027-02-05",
            "reason": "Overlaps 1 approved leave",
        },
        headers=headers,
    )
    assert r1.status_code == 400, r1.text
    assert "overlapping leave request" in r1.text.lower()

    # Add 2nd existing leave inside Feb 1..28 -> 2 overlaps (exact NEW-01 crash reproducer)
    await pg_leave_env["seed_leave_row"](emp.id, date(2027, 2, 10), date(2027, 2, 10), "APPROVED")
    for attempt in range(3):
        r2 = await client.post(
            "/api/v1/hrms/leave/requests",
            json={
                "leave_type_id": lt_id,
                "from_date": "2027-02-01",
                "to_date": "2027-02-28",
                "reason": f"Overlaps 2 approved leaves retry #{attempt + 1}",
            },
            headers=headers,
        )
        assert r2.status_code == 400, f"Retry {attempt + 1} failed: {r2.status_code} {r2.text}"
        assert "overlapping leave request" in r2.text.lower()

    # Add 3rd (PENDING) and 4th (APPROVED) existing leaves -> 3+ overlaps
    await pg_leave_env["seed_leave_row"](emp.id, date(2027, 2, 17), date(2027, 2, 18), "PENDING")
    await pg_leave_env["seed_leave_row"](emp.id, date(2027, 2, 24), date(2027, 2, 24), "APPROVED")
    r4 = await client.post(
        "/api/v1/hrms/leave/requests",
        json={
            "leave_type_id": lt_id,
            "from_date": "2027-02-01",
            "to_date": "2027-02-28",
            "reason": "Overlaps 4 mixed PENDING/APPROVED leaves",
        },
        headers=headers,
    )
    assert r4.status_code == 400, r4.text
    assert "overlapping leave request" in r4.text.lower()


@pytest.mark.asyncio
async def test_leave_overlap_status_combinations_and_date_boundaries(pg_leave_env):
    """
    Verify:
    - REJECTED & CANCELLED existing requests do NOT block overlapping new requests.
    - PENDING + APPROVED combinations DO block (never 500).
    - Exact boundary semantics: adjacent day before/after succeeds; touching start/end
      day, exact same day, and contained ranges return 400.
    """
    client: AsyncClient = pg_leave_env["client"]
    lt_id = str(pg_leave_env["lt"].id)
    emp, headers = await pg_leave_env["make_employee"]("bounds")

    # 1. Multiple REJECTED and CANCELLED rows on March 10..12 must NOT block a new request
    await pg_leave_env["seed_leave_row"](emp.id, date(2027, 3, 10), date(2027, 3, 11), "REJECTED")
    await pg_leave_env["seed_leave_row"](emp.id, date(2027, 3, 11), date(2027, 3, 12), "CANCELLED")
    r_non_blocking = await client.post(
        "/api/v1/hrms/leave/requests",
        json={
            "leave_type_id": lt_id,
            "from_date": "2027-03-10",
            "to_date": "2027-03-12",
            "reason": "Allowed over REJECTED + CANCELLED rows",
        },
        headers=headers,
    )
    assert r_non_blocking.status_code == 201, r_non_blocking.text

    # Now March 10..12 is PENDING. Test date boundaries around March 10..12:
    # Adjacent before (March 8..9) -> allowed (201)
    r_before = await client.post(
        "/api/v1/hrms/leave/requests",
        json={
            "leave_type_id": lt_id,
            "from_date": "2027-03-08",
            "to_date": "2027-03-09",
            "reason": "Adjacent day before",
        },
        headers=headers,
    )
    assert r_before.status_code == 201, r_before.text

    # Adjacent after (March 13..14) -> allowed (201)
    r_after = await client.post(
        "/api/v1/hrms/leave/requests",
        json={
            "leave_type_id": lt_id,
            "from_date": "2027-03-13",
            "to_date": "2027-03-14",
            "reason": "Adjacent day after",
        },
        headers=headers,
    )
    assert r_after.status_code == 201, r_after.text

    # Touching start boundary (March 7..8 touches March 8..9) -> 400
    r_touch_start = await client.post(
        "/api/v1/hrms/leave/requests",
        json={
            "leave_type_id": lt_id,
            "from_date": "2027-03-07",
            "to_date": "2027-03-08",
            "reason": "Touches start boundary",
        },
        headers=headers,
    )
    assert r_touch_start.status_code == 400

    # Touching end boundary (March 14..15 touches March 13..14) -> 400
    r_touch_end = await client.post(
        "/api/v1/hrms/leave/requests",
        json={
            "leave_type_id": lt_id,
            "from_date": "2027-03-14",
            "to_date": "2027-03-15",
            "reason": "Touches end boundary",
        },
        headers=headers,
    )
    assert r_touch_end.status_code == 400

    # Single-day contained inside March 10..12 -> 400
    r_inside = await client.post(
        "/api/v1/hrms/leave/requests",
        json={
            "leave_type_id": lt_id,
            "from_date": "2027-03-11",
            "to_date": "2027-03-11",
            "reason": "Contained single day",
        },
        headers=headers,
    )
    assert r_inside.status_code == 400

    # Enclosing all 3 contiguous PENDING blocks (March 8..14) -> 400 (NOT 500!)
    r_enclosing = await client.post(
        "/api/v1/hrms/leave/requests",
        json={
            "leave_type_id": lt_id,
            "from_date": "2027-03-07",
            "to_date": "2027-03-16",
            "reason": "Encloses 3 PENDING blocks + REJECTED + CANCELLED",
        },
        headers=headers,
    )
    assert r_enclosing.status_code == 400
    assert "overlapping leave request" in r_enclosing.text.lower()


@pytest.mark.asyncio
async def test_leave_overlap_employee_isolation_and_concurrent_submissions(pg_leave_env):
    """
    Verify:
    1. Employee isolation: Employee A having 3 overlapping APPROVED/PENDING leaves
       does not block Employee B from requesting those exact dates.
    2. Concurrent overlapping submissions for the SAME employee (paid & unpaid)
       serialize cleanly: strictly 1 winner (201), remaining losers rejected (400),
       zero duplicates in DB, zero 500s.
    3. Concurrent submissions over 2+ pre-existing overlapping leaves all return 400.
    4. Concurrent submissions by DIFFERENT employees for the exact same dates both succeed.
    """
    client: AsyncClient = pg_leave_env["client"]
    SF = pg_leave_env["SessionFactory"]
    lt_id = str(pg_leave_env["lt"].id)
    lt_unpaid_id = str(pg_leave_env["lt_unpaid"].id)

    emp_a, h_a = await pg_leave_env["make_employee"]("empa")
    emp_b, h_b = await pg_leave_env["make_employee"]("empb")

    # 1. Seed 3 overlapping rows for Employee A in April 2027
    await pg_leave_env["seed_leave_row"](emp_a.id, date(2027, 4, 2), date(2027, 4, 3), "APPROVED")
    await pg_leave_env["seed_leave_row"](emp_a.id, date(2027, 4, 6), date(2027, 4, 7), "PENDING")
    await pg_leave_env["seed_leave_row"](emp_a.id, date(2027, 4, 10), date(2027, 4, 11), "APPROVED")

    # Employee B requesting April 1..12 succeeds (201) despite Employee A's 3 leaves
    r_b_iso = await client.post(
        "/api/v1/hrms/leave/requests",
        json={
            "leave_type_id": lt_id,
            "from_date": "2027-04-01",
            "to_date": "2027-04-12",
            "reason": "Employee B isolated dates",
        },
        headers=h_b,
    )
    assert r_b_iso.status_code == 201, r_b_iso.text

    # 2. 3-way concurrent submissions for Employee A spanning 3 existing overlaps -> all 400 (zero 500)
    conc_multi_res = await asyncio.gather(
        *[
            client.post(
                "/api/v1/hrms/leave/requests",
                json={
                    "leave_type_id": lt_id,
                    "from_date": "2027-04-01",
                    "to_date": "2027-04-12",
                    "reason": f"Concurrent multi-overlap #{i}",
                },
                headers=h_a,
            )
            for i in range(3)
        ]
    )
    assert [r.status_code for r in conc_multi_res] == [400, 400, 400]

    # 3. 3-way concurrent submissions for the SAME employee on a fresh paid date range -> 1x 201, 2x 400
    conc_paid = await asyncio.gather(
        *[
            client.post(
                "/api/v1/hrms/leave/requests",
                json={
                    "leave_type_id": lt_id,
                    "from_date": "2027-05-10",
                    "to_date": "2027-05-12",
                    "reason": f"Concurrent paid race #{i}",
                },
                headers=h_a,
            )
            for i in range(3)
        ]
    )
    paid_codes = sorted(r.status_code for r in conc_paid)
    assert paid_codes == [201, 400, 400], f"Unexpected concurrent paid codes: {paid_codes}"

    async with SF() as db:
        may_cnt = (
            await db.execute(
                select(func.count(HrmsLeaveRequest.id)).where(
                    HrmsLeaveRequest.employee_id == emp_a.id,
                    HrmsLeaveRequest.from_date == date(2027, 5, 10),
                    HrmsLeaveRequest.status.in_(["PENDING", "APPROVED"]),
                )
            )
        ).scalar_one()
        assert may_cnt == 1

    # 4. 3-way concurrent submissions for the SAME employee on a fresh UNPAID date range -> 1x 201, 2x 400
    conc_unpaid = await asyncio.gather(
        *[
            client.post(
                "/api/v1/hrms/leave/requests",
                json={
                    "leave_type_id": lt_unpaid_id,
                    "from_date": "2027-06-10",
                    "to_date": "2027-06-11",
                    "reason": f"Concurrent unpaid race #{i}",
                },
                headers=h_a,
            )
            for i in range(3)
        ]
    )
    unpaid_codes = sorted(r.status_code for r in conc_unpaid)
    assert unpaid_codes == [201, 400, 400], f"Unexpected concurrent unpaid codes: {unpaid_codes}"

    # 5. Concurrent submissions by DIFFERENT employees for identical dates -> both 201
    conc_diff_emp = await asyncio.gather(
        client.post(
            "/api/v1/hrms/leave/requests",
            json={
                "leave_type_id": lt_id,
                "from_date": "2027-07-05",
                "to_date": "2027-07-06",
                "reason": "Emp A July leave",
            },
            headers=h_a,
        ),
        client.post(
            "/api/v1/hrms/leave/requests",
            json={
                "leave_type_id": lt_id,
                "from_date": "2027-07-05",
                "to_date": "2027-07-06",
                "reason": "Emp B July leave",
            },
            headers=h_b,
        ),
    )
    assert sorted(r.status_code for r in conc_diff_emp) == [201, 201]
