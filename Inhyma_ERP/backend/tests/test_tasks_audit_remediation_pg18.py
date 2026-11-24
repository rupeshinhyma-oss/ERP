"""
Enterprise Tasks — Audit Remediation Regression Suite (PostgreSQL 18).

Verifies real HTTP routes + real PostgreSQL 18 state & concurrency for every
remediated defect from the Independent Enterprise Tasks Audit:
- Phase 1 (P0): BUG-01 (Reactions), BUG-02 (BLOCKED_BY dependencies),
  BUG-03 (Concurrent recurring generation), BUG-04 (Optimistic locking).
"""

from __future__ import annotations

import asyncio
import os
import uuid
from datetime import date, timedelta

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine

from app.auth.security import create_access_token, hash_password
from app.core.config import settings
from app.main import create_application
from app.org_structure.models import DepartmentLeadershipAssignment, LeadershipType, OrgRecordStatus
from app.rbac.models import Permission, Role, RoleAssignmentStatus, RolePermission, UserPermission, UserRole
from app.tasks.models import (
    Task,
    TaskAssignee,
    TaskComment,
    TaskDependency,
    TaskEscalation,
    TaskPriority,
    TaskReaction,
    TaskRecurringSchedule,
    TaskSprint,
    TaskStatus,
    TaskSubtask,
    TaskVoiceNote,
)
from app.users.models import EmploymentStatus, EmploymentType, User, UserStatus

PG_TEST_URL = os.environ.get(
    "TASKS_PG_TEST_URL",
    os.environ.get("TEST_DATABASE_URL", "postgresql+asyncpg://postgres:root@127.0.0.1:5432/inhyma_test_db"),
)


def _ensure_safe_local_pg(url: str) -> None:
    lower = url.lower()
    if "supabase.com" in lower or "supabase.co" in lower:
        pytest.skip("Refusing to execute Tasks PostgreSQL tests against Supabase.")
    if not lower.startswith("postgresql"):
        pytest.skip("Tasks PostgreSQL integration suite requires PostgreSQL DATABASE_URL.")


@pytest_asyncio.fixture
async def remed_env():
    """Spin up an isolated multi-role test tenant inside local PostgreSQL 18."""
    _ensure_safe_local_pg(PG_TEST_URL)
    prev_db_url = str(settings.DATABASE_URL)
    os.environ["DATABASE_URL"] = PG_TEST_URL
    object.__setattr__(settings, "DATABASE_URL", PG_TEST_URL)

    import app.database.engine as engine_module

    await engine_module.dispose_engine()

    engine: AsyncEngine = create_async_engine(PG_TEST_URL, pool_size=20, max_overflow=30)
    SessionFactory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    tag = uuid.uuid4().hex[:8].lower()
    pw_hash = hash_password("TasksRemed!2026")

    created_user_ids: list[uuid.UUID] = []
    created_role_ids: list[uuid.UUID] = []
    created_task_ids: list[uuid.UUID] = []
    created_schedule_ids: list[uuid.UUID] = []
    created_sprint_ids: list[uuid.UUID] = []

    async with SessionFactory() as session:
        # Ensure all required task permissions exist
        perm_codes = [
            "task.view",
            "task.create",
            "task.assign",
            "task.department_view",
            "task.all_view",
            "task.escalate",
            "task.manage",
            "task.delete",
            "trash.view",
            "trash.restore",
        ]
        perm_map: dict[str, Permission] = {}
        for code in perm_codes:
            res = await session.execute(select(Permission).where(Permission.code == code))
            p = res.scalar_one_or_none()
            if not p:
                p = Permission(code=code, module=code.split(".")[0], description=code)
                session.add(p)
                await session.flush()
            perm_map[code] = p

        # Create 2 distinct departments + super_admin lookup
        ops_role = Role(name=f"RemOps_{tag}", code=f"REMOPS_{tag}", description="Ops dept")
        sales_role = Role(name=f"RemSales_{tag}", code=f"REMSALES_{tag}", description="Sales dept")
        session.add_all([ops_role, sales_role])
        await session.flush()
        created_role_ids.extend([ops_role.id, sales_role.id])

        # Find or create super_admin role
        sa_res = await session.execute(select(Role).where(Role.name == "super_admin"))
        sa_role = sa_res.scalar_one_or_none()
        if not sa_role:
            sa_role = Role(name="super_admin", code="SUPER_ADMIN", description="Super Admin")
            session.add(sa_role)
            await session.flush()

        def mk_user(key: str, *, is_active: bool = True) -> User:
            u = User(
                username=f"rem_{key}_{tag}",
                email=f"rem_{key}_{tag}@example.com",
                password_hash=pw_hash,
                first_name=key.title(),
                last_name=tag.upper(),
                display_name=f"{key.title()} {tag.upper()}",
                is_active=is_active,
                status=UserStatus.ACTIVE if is_active else UserStatus.INACTIVE,
                employment_status=EmploymentStatus.ACTIVE if is_active else EmploymentStatus.TERMINATED,
                employment_type=EmploymentType.FULL_TIME,
                must_change_password=False,
            )
            session.add(u)
            return u

        admin_u = mk_user("admin")
        ops_mgr = mk_user("opsmgr")
        ops_emp = mk_user("opsemp")
        ops_creator = mk_user("opscreator")
        sales_mgr = mk_user("salesmgr")
        sales_emp = mk_user("salesemp")
        all_viewer = mk_user("allviewer")
        inactive_u = mk_user("inactive", is_active=False)
        await session.flush()

        users = {
            "admin": admin_u,
            "ops_mgr": ops_mgr,
            "ops_emp": ops_emp,
            "ops_creator": ops_creator,
            "sales_mgr": sales_mgr,
            "sales_emp": sales_emp,
            "all_viewer": all_viewer,
            "inactive": inactive_u,
        }
        created_user_ids.extend([u.id for u in users.values()])

        # Role assignments
        session.add_all([
            UserRole(user_id=admin_u.id, role_id=sa_role.id, status=RoleAssignmentStatus.ACTIVE, is_primary=True),
            UserRole(user_id=ops_mgr.id, role_id=ops_role.id, status=RoleAssignmentStatus.ACTIVE, is_primary=True),
            UserRole(user_id=ops_emp.id, role_id=ops_role.id, status=RoleAssignmentStatus.ACTIVE, is_primary=True),
            UserRole(user_id=ops_creator.id, role_id=ops_role.id, status=RoleAssignmentStatus.ACTIVE, is_primary=True),
            UserRole(user_id=sales_mgr.id, role_id=sales_role.id, status=RoleAssignmentStatus.ACTIVE, is_primary=True),
            UserRole(user_id=sales_emp.id, role_id=sales_role.id, status=RoleAssignmentStatus.ACTIVE, is_primary=True),
            UserRole(user_id=all_viewer.id, role_id=ops_role.id, status=RoleAssignmentStatus.ACTIVE, is_primary=True),
            UserRole(user_id=inactive_u.id, role_id=sales_role.id, status=RoleAssignmentStatus.ACTIVE, is_primary=True),
        ])

        # Department Leadership assignments
        session.add_all([
            DepartmentLeadershipAssignment(
                department_id=ops_role.id,
                employee_id=ops_mgr.id,
                leadership_type=LeadershipType.PRIMARY_MANAGER,
                status=OrgRecordStatus.ACTIVE,
            ),
            DepartmentLeadershipAssignment(
                department_id=sales_role.id,
                employee_id=sales_mgr.id,
                leadership_type=LeadershipType.PRIMARY_MANAGER,
                status=OrgRecordStatus.ACTIVE,
            ),
        ])

        # Explicit per-user permissions
        def grant(user: User, codes: list[str]):
            for c in codes:
                session.add(UserPermission(user_id=user.id, permission_id=perm_map[c].id, is_granted=True))

        grant(ops_mgr, ["task.view", "task.create", "task.assign", "task.department_view", "task.escalate"])
        grant(ops_emp, ["task.view"])
        grant(ops_creator, ["task.view", "task.create", "task.assign", "task.escalate"])
        grant(sales_mgr, ["task.view", "task.create", "task.assign", "task.department_view", "task.escalate"])
        grant(sales_emp, ["task.view", "task.create"])
        grant(all_viewer, ["task.view", "task.all_view"])

        await session.commit()

    def auth_headers(key: str) -> dict[str, str]:
        u = users[key]
        tok = create_access_token(u.id).token
        return {"Authorization": f"Bearer {tok}"}

    app = create_application()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        yield {
            "client": client,
            "session_factory": SessionFactory,
            "users": users,
            "roles": {"ops": ops_role, "sales": sales_role},
            "headers": {k: auth_headers(k) for k in users},
            "tag": tag,
            "created_task_ids": created_task_ids,
            "created_schedule_ids": created_schedule_ids,
            "created_sprint_ids": created_sprint_ids,
        }

    # Cleanup
    async with SessionFactory() as session:
        if created_task_ids:
            await session.execute(delete(Task).where(Task.id.in_(created_task_ids)))
        # Clean any tasks created by our test users
        await session.execute(delete(Task).where(Task.created_by.in_(created_user_ids)))
        await session.execute(delete(TaskRecurringSchedule).where(TaskRecurringSchedule.created_by.in_(created_user_ids)))
        if created_schedule_ids:
            await session.execute(delete(TaskRecurringSchedule).where(TaskRecurringSchedule.id.in_(created_schedule_ids)))
        await session.execute(delete(TaskSprint).where(TaskSprint.created_by.in_(created_user_ids)))
        if created_sprint_ids:
            await session.execute(delete(TaskSprint).where(TaskSprint.id.in_(created_sprint_ids)))
        await session.execute(delete(DepartmentLeadershipAssignment).where(DepartmentLeadershipAssignment.department_id.in_(created_role_ids)))
        await session.execute(delete(UserPermission).where(UserPermission.user_id.in_(created_user_ids)))
        await session.execute(delete(UserRole).where(UserRole.user_id.in_(created_user_ids)))
        await session.execute(delete(User).where(User.id.in_(created_user_ids)))
        await session.execute(delete(Role).where(Role.id.in_(created_role_ids)))
        await session.commit()

    await engine_module.dispose_engine()
    await engine.dispose()
    os.environ["DATABASE_URL"] = prev_db_url
    object.__setattr__(settings, "DATABASE_URL", prev_db_url)


# ============================================================================
# PHASE 1 — P0 DATA INTEGRITY & AVAILABILITY
# ============================================================================

@pytest.mark.asyncio
async def test_bug01_reactions_preserve_task_read_and_update(remed_env):
    """BUG-01: Adding task and comment reactions must NEVER break GET/PATCH/list on the task."""
    client: AsyncClient = remed_env["client"]
    h_mgr = remed_env["headers"]["ops_mgr"]
    h_emp = remed_env["headers"]["ops_emp"]
    emp_id = str(remed_env["users"]["ops_emp"].id)
    mgr_id = str(remed_env["users"]["ops_mgr"].id)

    # 1. Create task assigned to ops_emp
    create_res = await client.post(
        "/api/v1/tasks",
        headers=h_mgr,
        json={"title": "BUG01 Reaction Task", "assignee_ids": [emp_id]},
    )
    assert create_res.status_code == 201, create_res.text
    task_id = create_res.json()["data"]["id"]

    # 2. Add comment on task
    cmt_res = await client.post(
        f"/api/v1/tasks/{task_id}/comment",
        headers=h_mgr,
        json={"message": "Testing comment reactions"},
    )
    assert cmt_res.status_code == 200, cmt_res.text
    comment_id = cmt_res.json()["data"]["id"]

    # 3. Add task reactions from both manager and assignee + comment reaction
    r1 = await client.post(f"/api/v1/tasks/{task_id}/reactions", headers=h_mgr, json={"emoji": "👍"})
    r2 = await client.post(f"/api/v1/tasks/{task_id}/reactions", headers=h_emp, json={"emoji": "👍"})
    r3 = await client.post(f"/api/v1/tasks/{task_id}/reactions", headers=h_emp, json={"emoji": "🚀"})
    rc = await client.post(f"/api/v1/tasks/comments/{comment_id}/reactions", headers=h_mgr, json={"emoji": "❤️"})
    assert r1.status_code == 200 and r1.json()["data"]["added"] is True
    assert r2.status_code == 200 and r2.json()["data"]["added"] is True
    assert r3.status_code == 200 and r3.json()["data"]["added"] is True
    assert rc.status_code == 200 and rc.json()["data"]["added"] is True

    # 4. GET /tasks/{id} must succeed 200 with properly aggregated TaskReactionSummary
    get_mgr = await client.get(f"/api/v1/tasks/{task_id}", headers=h_mgr)
    assert get_mgr.status_code == 200, get_mgr.text
    detail = get_mgr.json()["data"]
    rx_by_emoji = {r["emoji"]: r for r in detail["reactions"]}
    assert rx_by_emoji["👍"]["count"] == 2
    assert set(rx_by_emoji["👍"]["user_ids"]) == {mgr_id, emp_id}
    assert rx_by_emoji["👍"]["has_reacted"] is True
    assert rx_by_emoji["🚀"]["count"] == 1
    assert rx_by_emoji["🚀"]["has_reacted"] is False

    # Comment reactions also aggregated cleanly
    assert len(detail["comments"]) == 1
    cmt_rx = detail["comments"][0]["reactions"]
    assert len(cmt_rx) == 1
    assert cmt_rx[0]["emoji"] == "❤️"
    assert cmt_rx[0]["count"] == 1
    assert cmt_rx[0]["has_reacted"] is True

    # 5. PATCH /tasks/{id} must succeed 200 after reactions exist
    patch_res = await client.patch(
        f"/api/v1/tasks/{task_id}",
        headers=h_mgr,
        json={"title": "BUG01 Reaction Task Updated", "version": detail["version"]},
    )
    assert patch_res.status_code == 200, patch_res.text
    assert patch_res.json()["data"]["title"] == "BUG01 Reaction Task Updated"
    assert len(patch_res.json()["data"]["reactions"]) == 2

    # 6. List view includes summarized reactions without crashing
    list_res = await client.get("/api/v1/tasks?view=my", headers=h_emp)
    assert list_res.status_code == 200, list_res.text
    found = [t for t in list_res.json()["data"]["items"] if t["id"] == task_id]
    assert len(found) == 1
    emp_rx = {r["emoji"]: r for r in found[0]["reactions"]}
    assert emp_rx["🚀"]["has_reacted"] is True

    # 7. Toggle off removes reaction cleanly
    r_off = await client.post(f"/api/v1/tasks/{task_id}/reactions", headers=h_emp, json={"emoji": "🚀"})
    assert r_off.status_code == 200 and r_off.json()["data"]["added"] is False
    get_after_off = await client.get(f"/api/v1/tasks/{task_id}", headers=h_emp)
    assert get_after_off.status_code == 200
    assert "🚀" not in {r["emoji"] for r in get_after_off.json()["data"]["reactions"]}


@pytest.mark.asyncio
async def test_bug02_blocked_by_prevents_completion_and_preserves_db_state(remed_env):
    """BUG-02: Incomplete BLOCKED_BY blocker must return 422 without changing DB, and succeed 200 once unblocked."""
    client: AsyncClient = remed_env["client"]
    h_mgr = remed_env["headers"]["ops_mgr"]
    emp_id = str(remed_env["users"]["ops_emp"].id)
    SessionFactory = remed_env["session_factory"]

    a_res = await client.post("/api/v1/tasks", headers=h_mgr, json={"title": "BUG02 Blocker A", "assignee_ids": [emp_id]})
    b_res = await client.post("/api/v1/tasks", headers=h_mgr, json={"title": "BUG02 Dependent B", "assignee_ids": [emp_id]})
    assert a_res.status_code == 201 and b_res.status_code == 201
    task_a_id = a_res.json()["data"]["id"]
    task_b_id = b_res.json()["data"]["id"]

    # Link B BLOCKED_BY A (testing relationship_type alias compatibility as well as dependency_type)
    dep_res = await client.post(
        f"/api/v1/tasks/{task_b_id}/dependencies",
        headers=h_mgr,
        json={"depends_on_task_id": task_a_id, "relationship_type": "BLOCKED_BY"},
    )
    assert dep_res.status_code == 200, dep_res.text
    dep_data = dep_res.json()["data"]
    assert dep_data["dependency_type"] == "BLOCKED_BY"
    assert dep_data["depends_on_task_title"] == "BUG02 Blocker A"
    assert dep_data["depends_on_task_status"] == "TODO"

    # Attempt to complete B while A is still TODO -> MUST reject 422
    blk_patch = await client.patch(
        f"/api/v1/tasks/{task_b_id}",
        headers=h_mgr,
        json={"status": "DONE"},
    )
    assert blk_patch.status_code == 422, blk_patch.text
    assert "BUG02 Blocker A" in blk_patch.text

    # Verify DB state is UNCHANGED (still TODO, version still 1)
    async with SessionFactory() as session:
        row = (await session.execute(select(Task).where(Task.id == uuid.UUID(task_b_id)))).scalar_one()
        assert row.status == TaskStatus.TODO
        assert row.version == 1

    # Complete blocker A -> 200
    a_done = await client.patch(f"/api/v1/tasks/{task_a_id}", headers=h_mgr, json={"status": "DONE"})
    assert a_done.status_code == 200, a_done.text

    # Now complete B -> MUST succeed 200 (no MissingGreenlet 500!) and persist DONE
    b_done = await client.patch(f"/api/v1/tasks/{task_b_id}", headers=h_mgr, json={"status": "DONE"})
    assert b_done.status_code == 200, b_done.text
    b_payload = b_done.json()["data"]
    assert b_payload["status"] == "DONE"
    assert b_payload["dependencies"][0]["depends_on_task_title"] == "BUG02 Blocker A"
    assert b_payload["dependencies"][0]["depends_on_task_status"] == "DONE"

    async with SessionFactory() as session:
        row = (await session.execute(select(Task).where(Task.id == uuid.UUID(task_b_id)))).scalar_one()
        assert row.status == TaskStatus.DONE


@pytest.mark.asyncio
async def test_bug03_concurrent_recurring_generation_is_strictly_idempotent(remed_env):
    """BUG-03: 6 concurrent POST /tasks/recurring/generate calls must create exactly 1 DB task for the period."""
    client: AsyncClient = remed_env["client"]
    h_admin = remed_env["headers"]["admin"]
    emp_id = str(remed_env["users"]["ops_emp"].id)
    mgr_id = str(remed_env["users"]["ops_mgr"].id)
    SessionFactory = remed_env["session_factory"]

    # Create schedule with future start date first so POST /recurring/schedules doesn't auto-generate today
    target_date = date.today() + timedelta(days=5)
    sch_res = await client.post(
        "/api/v1/tasks/recurring/schedules",
        headers=h_admin,
        json={
            "title": "BUG03 Concurrent Recurring Check",
            "department": remed_env["roles"]["ops"].name,
            "assignee_id": emp_id,
            "manager_id": mgr_id,
            "priority": "HIGH",
            "frequency": "MONTHLY",
            "recurrence_config": {"day_of_month": target_date.day},
            "effective_start_date": target_date.isoformat(),
        },
    )
    assert sch_res.status_code == 201, sch_res.text
    schedule_id = sch_res.json()["data"]["id"]

    # Fire 6 concurrent generation requests for target_date
    async def trigger():
        return await client.post(
            f"/api/v1/tasks/recurring/generate?schedule_id={schedule_id}&as_of_date={target_date.isoformat()}",
            headers=h_admin,
        )

    responses = await asyncio.gather(*[trigger() for _ in range(6)])
    assert all(r.status_code == 200 for r in responses), [(r.status_code, r.text) for r in responses]
    gen_counts = [r.json()["data"]["generated_count"] for r in responses]
    assert sum(gen_counts) == 1, f"Expected exactly 1 total generated task across 6 concurrent calls, got {gen_counts}"

    # Verify actual DB count is strictly 1
    async with SessionFactory() as session:
        cnt = (
            await session.execute(
                select(func.count(Task.id)).where(
                    Task.recurring_schedule_id == uuid.UUID(schedule_id),
                    Task.deleted_at.is_(None),
                )
            )
        ).scalar_one()
        assert cnt == 1

    # Subsequent next-month call still generates period 2 cleanly (sequential recurrence intact)
    next_month_date = target_date + timedelta(days=32)
    r_next = await client.post(
        f"/api/v1/tasks/recurring/generate?schedule_id={schedule_id}&as_of_date={next_month_date.isoformat()}",
        headers=h_admin,
    )
    assert r_next.status_code == 200
    assert r_next.json()["data"]["generated_count"] == 1


@pytest.mark.asyncio
async def test_bug04_optimistic_locking_rejects_stale_version_and_prevents_lost_updates(remed_env):
    """BUG-04: Stale version PATCH returns 409 Conflict; concurrent PATCHes cannot lose updates."""
    client: AsyncClient = remed_env["client"]
    h_admin = remed_env["headers"]["admin"]
    SessionFactory = remed_env["session_factory"]

    create_res = await client.post("/api/v1/tasks", headers=h_admin, json={"title": "BUG04 OptLock Task"})
    assert create_res.status_code == 201
    task_id = create_res.json()["data"]["id"]
    assert create_res.json()["data"]["version"] == 1

    # 1. Valid current-version PATCH succeeds (version 1 -> 2)
    r1 = await client.patch(
        f"/api/v1/tasks/{task_id}",
        headers=h_admin,
        json={"title": "BUG04 V2", "version": 1},
    )
    assert r1.status_code == 200, r1.text
    assert r1.json()["data"]["version"] == 2

    # 2. Stale version=1 PATCH MUST be rejected with 409 Conflict and NOT overwrite title
    r_stale = await client.patch(
        f"/api/v1/tasks/{task_id}",
        headers=h_admin,
        json={"title": "BUG04 Stale Overwrite", "version": 1},
    )
    assert r_stale.status_code == 409, r_stale.text

    async with SessionFactory() as session:
        row = (await session.execute(select(Task).where(Task.id == uuid.UUID(task_id)))).scalar_one()
        assert row.title == "BUG04 V2"
        assert row.version == 2

    # 3. 10 concurrent PATCHes all claiming version=2 -> strictly 1 succeeds (200), 9 rejected (409)
    async def patch_with_v2(idx: int):
        return await client.patch(
            f"/api/v1/tasks/{task_id}",
            headers=h_admin,
            json={"title": f"BUG04 Race {idx}", "version": 2},
        )

    race_res = await asyncio.gather(*[patch_with_v2(i) for i in range(10)])
    statuses = [r.status_code for r in race_res]
    assert statuses.count(200) == 1, statuses
    assert statuses.count(409) == 9, statuses

    # 4. 5 concurrent PATCHes without explicit version -> serialized via FOR UPDATE, zero lost version increments (3 -> 8)
    async def patch_no_ver(idx: int):
        return await client.patch(
            f"/api/v1/tasks/{task_id}",
            headers=h_admin,
            json={"description": f"Concurrent update {idx}"},
        )

    no_ver_res = await asyncio.gather(*[patch_no_ver(i) for i in range(5)])
    assert all(r.status_code == 200 for r in no_ver_res), [r.status_code for r in no_ver_res]
    async with SessionFactory() as session:
        row = (await session.execute(select(Task).where(Task.id == uuid.UUID(task_id)))).scalar_one()
        assert row.version == 8, f"Expected version=8 after 5 serialized updates from v3, got {row.version}"


# ============================================================================
# PHASE 2 — P1 SECURITY AND AUTHORIZATION (BUG-07, BUG-08, BUG-09)
# ============================================================================

@pytest.mark.asyncio
async def test_bug07_readonly_all_view_blocked_from_foreign_collaboration_writes(remed_env):
    """BUG-07: Read-only task.all_view user can read foreign tasks, but MUST get 403 on all write/collab endpoints."""
    client: AsyncClient = remed_env["client"]
    h_sales_mgr = remed_env["headers"]["sales_mgr"]
    h_sales_emp = remed_env["headers"]["sales_emp"]
    h_av = remed_env["headers"]["all_viewer"]
    sales_emp_id = str(remed_env["users"]["sales_emp"].id)
    SessionFactory = remed_env["session_factory"]

    # Sales Manager creates Sales task with comment, subtask, and escalation row
    t_res = await client.post(
        "/api/v1/tasks",
        headers=h_sales_mgr,
        json={"title": "BUG07 Foreign Sales Task", "assignee_ids": [sales_emp_id]},
    )
    assert t_res.status_code == 201
    task_id = t_res.json()["data"]["id"]

    cmt_res = await client.post(
        f"/api/v1/tasks/{task_id}/comment",
        headers=h_sales_mgr,
        json={"message": "Internal sales comment"},
    )
    assert cmt_res.status_code == 200
    comment_id = cmt_res.json()["data"]["id"]

    sub_res = await client.post(
        f"/api/v1/tasks/{task_id}/subtasks",
        headers=h_sales_mgr,
        json={"title": "Sales subtask"},
    )
    assert sub_res.status_code == 200
    subtask_id = sub_res.json()["data"]["id"]

    # Insert an escalation directly in DB so escalation-comment test is independent of Phase 3 BUG-05
    async with SessionFactory() as session:
        esc = TaskEscalation(
            task_id=uuid.UUID(task_id),
            from_user=remed_env["users"]["sales_mgr"].id,
            to_user=remed_env["users"]["admin"].id,
            reason="Test escalation",
            escalation_type="ORGANIZATION_USER",
            due_date=date.today() + timedelta(days=2),
        )
        session.add(esc)
        await session.commit()
        esc_id = str(esc.id)

    # 1. Read-only task.all_view user CAN read the foreign task
    assert (await client.get(f"/api/v1/tasks/{task_id}", headers=h_av)).status_code == 200

    # 2. Read-only task.all_view user MUST be denied (403) on ALL collaboration write endpoints
    assert (
        await client.post(f"/api/v1/tasks/{task_id}/comment", headers=h_av, json={"message": "Unauthorized"})
    ).status_code == 403
    assert (
        await client.post(f"/api/v1/tasks/{task_id}/reactions", headers=h_av, json={"emoji": "👍"})
    ).status_code == 403
    assert (
        await client.post(f"/api/v1/tasks/comments/{comment_id}/reactions", headers=h_av, json={"emoji": "👍"})
    ).status_code == 403
    assert (
        await client.post(f"/api/v1/tasks/subtasks/{subtask_id}/comments", headers=h_av, json={"message": "Nope"})
    ).status_code == 403
    assert (
        await client.post(f"/api/v1/tasks/escalations/{esc_id}/comments", headers=h_av, json={"message": "Nope"})
    ).status_code == 403

    # 3. Verify zero unauthorized DB rows were written
    async with SessionFactory() as session:
        rx_cnt = (
            await session.execute(select(func.count(TaskReaction.id)).where(TaskReaction.task_id == uuid.UUID(task_id)))
        ).scalar_one()
        assert rx_cnt == 0

    # 4. Legitimate participant (sales_emp assignee) CAN still comment and react (200)
    assert (
        await client.post(f"/api/v1/tasks/{task_id}/comment", headers=h_sales_emp, json={"message": "Assignee update"})
    ).status_code == 200
    assert (
        await client.post(f"/api/v1/tasks/{task_id}/reactions", headers=h_sales_emp, json={"emoji": "👍"})
    ).status_code == 200


@pytest.mark.asyncio
async def test_bug08_directory_privacy_and_authorized_org_wide_assignment_and_escalation(remed_env):
    """BUG-08 + Business Reqs A-G: Enforce directory privacy while preserving org-wide assign/escalate & user validation."""
    client: AsyncClient = remed_env["client"]
    h_ops_emp = remed_env["headers"]["ops_emp"]
    h_ops_mgr = remed_env["headers"]["ops_mgr"]
    h_ops_creator = remed_env["headers"]["ops_creator"]
    h_sales_mgr = remed_env["headers"]["sales_mgr"]
    h_av = remed_env["headers"]["all_viewer"]

    ops_emp_id = str(remed_env["users"]["ops_emp"].id)
    sales_emp_id = str(remed_env["users"]["sales_emp"].id)
    inactive_id = str(remed_env["users"]["inactive"].id)
    fake_uid = str(uuid.uuid4())

    # A. Plain task.view employee CANNOT enumerate org directory via /escalate-options (403) or /assignees (self only)
    assert (await client.get("/api/v1/tasks/escalate-options", headers=h_ops_emp)).status_code == 403
    assert (await client.get("/api/v1/tasks/escalate-options", headers=h_av)).status_code == 403

    emp_assignees_res = await client.get("/api/v1/tasks/assignees", headers=h_ops_emp)
    assert emp_assignees_res.status_code == 200
    emp_assignees = emp_assignees_res.json()["data"]
    assert [u["id"] for u in emp_assignees] == [ops_emp_id]
    assert emp_assignees[0]["email"] is None

    # C & D & E. Authorized creator/manager/escalator sees ALL eligible active org users with minimum info (NO emails)
    creator_assignees_res = await client.get("/api/v1/tasks/assignees", headers=h_ops_creator)
    assert creator_assignees_res.status_code == 200
    creator_assignees = creator_assignees_res.json()["data"]
    creator_assignee_ids = {u["id"] for u in creator_assignees}
    assert sales_emp_id in creator_assignee_ids  # Cross-department active user visible for assignment!
    assert inactive_id not in creator_assignee_ids  # Inactive user excluded!
    assert all(u.get("email") is None for u in creator_assignees)  # No unnecessary email exposure!

    esc_opts_res = await client.get("/api/v1/tasks/escalate-options", headers=h_ops_creator)
    assert esc_opts_res.status_code == 200, esc_opts_res.text
    esc_opts = esc_opts_res.json()["data"]
    all_esc_candidates = (
        esc_opts["reporting_managers"] + esc_opts["department_managers"] + esc_opts["organization_users"]
    )
    esc_candidate_ids = {c["user_id"] for c in all_esc_candidates}
    assert sales_emp_id in esc_candidate_ids
    assert inactive_id not in esc_candidate_ids
    assert all(c.get("email") is None for c in all_esc_candidates)
    assert all("@" not in (c.get("detail") or "") for c in all_esc_candidates)

    # G. Authorized task creator/manager CAN assign any eligible active org user (including cross-department)
    t_ops = await client.post(
        "/api/v1/tasks",
        headers=h_ops_mgr,
        json={"title": "BUG08 Ops Cross-Team Task", "assignee_ids": [ops_emp_id]},
    )
    assert t_ops.status_code == 201
    t_ops_id = t_ops.json()["data"]["id"]

    assign_cross_org = await client.post(
        f"/api/v1/tasks/{t_ops_id}/assign",
        headers=h_ops_mgr,
        json={"user_ids": [ops_emp_id, sales_emp_id], "assignment_role": "ASSIGNEE"},
    )
    assert assign_cross_org.status_code == 200, assign_cross_org.text
    assigned_ids = {a["user_id"] for a in assign_cross_org.json()["data"]["assignees"]}
    assert {ops_emp_id, sales_emp_id}.issubset(assigned_ids)

    # G. Existing department task boundaries remain enforced: Ops Manager CANNOT assign on a Sales task (403)
    t_sales = await client.post(
        "/api/v1/tasks",
        headers=h_sales_mgr,
        json={"title": "BUG08 Foreign Sales Private Task", "assignee_ids": [sales_emp_id]},
    )
    assert t_sales.status_code == 201
    t_sales_id = t_sales.json()["data"]["id"]
    assert (
        await client.post(
            f"/api/v1/tasks/{t_sales_id}/assign",
            headers=h_ops_mgr,
            json={"user_ids": [ops_emp_id], "assignment_role": "ASSIGNEE"},
        )
    ).status_code == 403

    # F. Server-side validation rejects nonexistent and inactive users with 422 (NEVER 500)
    assert (
        await client.post(
            f"/api/v1/tasks/{t_ops_id}/assign",
            headers=h_ops_mgr,
            json={"user_ids": [fake_uid], "assignment_role": "ASSIGNEE"},
        )
    ).status_code == 422
    assert (
        await client.post(
            f"/api/v1/tasks/{t_ops_id}/assign",
            headers=h_ops_mgr,
            json={"user_ids": [inactive_id], "assignment_role": "ASSIGNEE"},
        )
    ).status_code == 422
    assert (
        await client.post(
            "/api/v1/tasks",
            headers=h_ops_mgr,
            json={"title": "Invalid Assignee Create", "assignee_ids": [fake_uid]},
        )
    ).status_code == 422


@pytest.mark.asyncio
async def test_bug09_sprint_and_template_ownership_enforced(remed_env):
    """BUG-09: task.create alone MUST NOT allow editing or deleting Admin's or another team's sprint/template."""
    client: AsyncClient = remed_env["client"]
    h_admin = remed_env["headers"]["admin"]
    h_sales_emp = remed_env["headers"]["sales_emp"]
    h_sales_mgr = remed_env["headers"]["sales_mgr"]
    h_ops_mgr = remed_env["headers"]["ops_mgr"]
    SessionFactory = remed_env["session_factory"]

    # 1. Admin creates a sprint & template
    sp_admin_res = await client.post(
        "/api/v1/tasks/sprints",
        headers=h_admin,
        json={"name": "BUG09 Admin Sprint", "status": "ACTIVE"},
    )
    assert sp_admin_res.status_code == 200, sp_admin_res.text
    admin_sprint_id = sp_admin_res.json()["data"]["id"]

    tpl_admin_res = await client.post(
        "/api/v1/tasks/templates",
        headers=h_admin,
        json={"name": "BUG09 Admin Template", "template_data": {"issue_type": "TASK"}},
    )
    assert tpl_admin_res.status_code == 200, tpl_admin_res.text
    admin_tpl_id = tpl_admin_res.json()["data"]["id"]

    # 2. Employee with task.create CANNOT edit or delete Admin's sprint or template (403)
    assert (
        await client.patch(f"/api/v1/tasks/sprints/{admin_sprint_id}", headers=h_sales_emp, json={"name": "Hijacked"})
    ).status_code == 403
    assert (
        await client.delete(f"/api/v1/tasks/sprints/{admin_sprint_id}", headers=h_sales_emp)
    ).status_code == 403
    assert (
        await client.patch(f"/api/v1/tasks/templates/{admin_tpl_id}", headers=h_sales_emp, json={"name": "Hijacked"})
    ).status_code == 403

    # Verify Admin's sprint still exists in DB unchanged
    async with SessionFactory() as session:
        sp = (await session.execute(select(TaskSprint).where(TaskSprint.id == uuid.UUID(admin_sprint_id)))).scalar_one_or_none()
        assert sp is not None and sp.name == "BUG09 Admin Sprint"

    # 3. Employee CAN create, update, and delete their OWN sprint
    sp_emp_res = await client.post(
        "/api/v1/tasks/sprints",
        headers=h_sales_emp,
        json={"name": "BUG09 SalesEmp Own Sprint", "status": "FUTURE"},
    )
    assert sp_emp_res.status_code == 200
    emp_sprint_id = sp_emp_res.json()["data"]["id"]

    # Cross-department Ops Manager CANNOT delete SalesEmp's sprint (403)
    assert (await client.delete(f"/api/v1/tasks/sprints/{emp_sprint_id}", headers=h_ops_mgr)).status_code == 403
    # SalesEmp CAN edit own sprint (200)
    assert (
        await client.patch(f"/api/v1/tasks/sprints/{emp_sprint_id}", headers=h_sales_emp, json={"name": "Updated Own"})
    ).status_code == 200
    # Sales Manager (active manager of SalesEmp's dept) CAN delete SalesEmp's sprint (200)
    assert (await client.delete(f"/api/v1/tasks/sprints/{emp_sprint_id}", headers=h_sales_mgr)).status_code == 200
    # Admin CAN delete Admin's sprint (200)
    assert (await client.delete(f"/api/v1/tasks/sprints/{admin_sprint_id}", headers=h_admin)).status_code == 200
    assert (await client.delete(f"/api/v1/tasks/templates/{admin_tpl_id}", headers=h_admin)).status_code == 200


# ============================================================================
# PHASE 3 — P1 WORKFLOW & CONCURRENCY (BUG-05, BUG-06, BUG-10, BUG-12)
# ============================================================================

@pytest.mark.asyncio
async def test_bug05_escalation_serialization_past_sla_422_and_retry_idempotency(remed_env):
    """BUG-05: Escalation returns 200 with loaded relations, rejects past SLA 422, deduplicates retries."""
    client: AsyncClient = remed_env["client"]
    h_ops_mgr = remed_env["headers"]["ops_mgr"]
    h_ops_emp = remed_env["headers"]["ops_emp"]
    ops_emp_id = str(remed_env["users"]["ops_emp"].id)
    sales_emp_id = str(remed_env["users"]["sales_emp"].id)
    SessionFactory = remed_env["session_factory"]

    t_res = await client.post(
        "/api/v1/tasks",
        headers=h_ops_mgr,
        json={"title": "BUG05 Escalation Task", "assignee_ids": [ops_emp_id]},
    )
    assert t_res.status_code == 201
    task_id = t_res.json()["data"]["id"]

    # 1. Past SLA due_date MUST be rejected 422 with zero DB rows created
    yesterday = (date.today() - timedelta(days=1)).isoformat()
    past_res = await client.post(
        f"/api/v1/tasks/{task_id}/escalate",
        headers=h_ops_mgr,
        json={
            "to_user": sales_emp_id,
            "reason": "Past SLA test",
            "escalation_type": "ORGANIZATION_USER",
            "due_date": yesterday,
        },
    )
    assert past_res.status_code == 422, past_res.text

    # 2. Valid escalation to eligible cross-department active org user returns 200 with loaded relations
    sla_date = (date.today() + timedelta(days=3)).isoformat()
    payload = {
        "to_user": sales_emp_id,
        "reason": "Urgent cross-team blocker",
        "escalation_type": "ORGANIZATION_USER",
        "due_date": sla_date,
    }
    esc_r1 = await client.post(f"/api/v1/tasks/{task_id}/escalate", headers=h_ops_mgr, json=payload)
    assert esc_r1.status_code == 200, esc_r1.text
    esc1 = esc_r1.json()["data"]
    assert esc1["from_user_rel"] is not None
    assert esc1["to_user_rel"]["id"] == sales_emp_id
    assert esc1["comments"] == []

    # 3. Retrying identical payload 3x MUST NOT create duplicate DB rows
    esc_r2 = await client.post(f"/api/v1/tasks/{task_id}/escalate", headers=h_ops_mgr, json=payload)
    esc_r3 = await client.post(f"/api/v1/tasks/{task_id}/escalate", headers=h_ops_mgr, json=payload)
    assert esc_r2.status_code == 200 and esc_r3.status_code == 200
    assert esc_r2.json()["data"]["id"] == esc1["id"]
    assert esc_r3.json()["data"]["id"] == esc1["id"]

    async with SessionFactory() as session:
        cnt = (
            await session.execute(
                select(func.count(TaskEscalation.id)).where(TaskEscalation.task_id == uuid.UUID(task_id))
            )
        ).scalar_one()
        assert cnt == 1

    # 4. Distinct second escalation still creates a second record cleanly
    esc_distinct = await client.post(
        f"/api/v1/tasks/{task_id}/escalate",
        headers=h_ops_mgr,
        json={**payload, "reason": "Follow-up escalation with new details"},
    )
    assert esc_distinct.status_code == 200
    assert esc_distinct.json()["data"]["id"] != esc1["id"]

    # 5. Escalation discussion comment works (200) with loaded author, while unauthorized employee without escalate gets 403 on escalate
    ec_res = await client.post(
        f"/api/v1/tasks/escalations/{esc1['id']}/comments",
        headers=h_ops_mgr,
        json={"message": "Tracking escalation resolution"},
    )
    assert ec_res.status_code == 200, ec_res.text
    assert ec_res.json()["data"]["user"] is not None
    assert (
        await client.post(f"/api/v1/tasks/{task_id}/escalate", headers=h_ops_emp, json=payload)
    ).status_code == 403


@pytest.mark.asyncio
async def test_bug06_voice_note_creation_validation_and_authorization(remed_env):
    """BUG-06: Voice note creation succeeds with both schema variants, validates metadata, enforces RBAC."""
    client: AsyncClient = remed_env["client"]
    h_ops_mgr = remed_env["headers"]["ops_mgr"]
    h_av = remed_env["headers"]["all_viewer"]
    ops_emp_id = str(remed_env["users"]["ops_emp"].id)
    SessionFactory = remed_env["session_factory"]

    t_res = await client.post(
        "/api/v1/tasks",
        headers=h_ops_mgr,
        json={"title": "BUG06 Voice Note Task", "assignee_ids": [ops_emp_id]},
    )
    assert t_res.status_code == 201
    task_id = t_res.json()["data"]["id"]

    # 1. Payload with file_name/audio_url/duration_seconds (previous 500 AttributeError path)
    vn1 = await client.post(
        f"/api/v1/tasks/{task_id}/voice-notes",
        headers=h_ops_mgr,
        json={"file_name": "standup_note.webm", "audio_url": "/uploads/tasks/standup_note.webm", "duration_seconds": 14},
    )
    assert vn1.status_code == 200, vn1.text
    vn1_data = vn1.json()["data"]
    assert vn1_data["file_name"] == "standup_note.webm"
    assert vn1_data["duration_seconds"] == 14
    assert vn1_data["uploader"] is not None

    # 2. Payload with frontend audio_url/duration_seconds + optional title/mime_type/file_size
    vn2 = await client.post(
        f"/api/v1/tasks/{task_id}/voice-notes",
        headers=h_ops_mgr,
        json={
            "audio_url": "/uploads/tasks/briefing.webm",
            "duration_seconds": 25,
            "file_size": 4096,
            "mime_type": "audio/webm",
            "title": "Briefing Audio",
        },
    )
    assert vn2.status_code == 200, vn2.text
    assert vn2.json()["data"]["file_name"] == "Briefing Audio"

    # 3. Validation rejects negative duration or empty audio_url (422)
    assert (
        await client.post(
            f"/api/v1/tasks/{task_id}/voice-notes",
            headers=h_ops_mgr,
            json={"audio_url": "/uploads/tasks/x.webm", "duration_seconds": -5},
        )
    ).status_code == 422
    assert (
        await client.post(
            f"/api/v1/tasks/{task_id}/voice-notes",
            headers=h_ops_mgr,
            json={"audio_url": "", "duration_seconds": 5},
        )
    ).status_code == 422

    # 4. Read-only task.all_view user gets 403 (NOT 500!) on foreign voice note add
    assert (
        await client.post(
            f"/api/v1/tasks/{task_id}/voice-notes",
            headers=h_av,
            json={"file_name": "unauth.webm", "audio_url": "/uploads/tasks/u.webm", "duration_seconds": 3},
        )
    ).status_code == 403

    # 5. Task detail includes voice notes cleanly & delete works
    get_res = await client.get(f"/api/v1/tasks/{task_id}", headers=h_ops_mgr)
    assert get_res.status_code == 200
    assert len(get_res.json()["data"]["voice_notes"]) == 2
    assert (await client.delete(f"/api/v1/tasks/voice-notes/{vn1_data['id']}", headers=h_ops_mgr)).status_code == 200

    async with SessionFactory() as session:
        rem = (
            await session.execute(select(func.count(TaskVoiceNote.id)).where(TaskVoiceNote.task_id == uuid.UUID(task_id)))
        ).scalar_one()
        assert rem == 1


@pytest.mark.asyncio
async def test_bug10_concurrent_approvals_and_concurrent_assignments_are_safe(remed_env):
    """BUG-10: 5 concurrent approvals allow strictly 1 success; 8 concurrent assignments produce zero 500s."""
    client: AsyncClient = remed_env["client"]
    h_ops_creator = remed_env["headers"]["ops_creator"]
    h_ops_mgr = remed_env["headers"]["ops_mgr"]
    h_ops_emp = remed_env["headers"]["ops_emp"]
    ops_mgr_id = str(remed_env["users"]["ops_mgr"].id)
    ops_emp_id = str(remed_env["users"]["ops_emp"].id)
    sales_emp_id = str(remed_env["users"]["sales_emp"].id)
    SessionFactory = remed_env["session_factory"]

    # 1. Create task by ops_creator (assigned to ops_emp), submit for approval to ops_mgr
    t_res = await client.post(
        "/api/v1/tasks",
        headers=h_ops_creator,
        json={"title": "BUG10 Concurrent Approval Task", "assignee_ids": [ops_emp_id]},
    )
    assert t_res.status_code == 201
    task_id = t_res.json()["data"]["id"]

    sub_res = await client.post(
        f"/api/v1/tasks/{task_id}/submit-approval",
        headers=h_ops_creator,
        json={"approver_id": ops_mgr_id, "notes": "Ready for review"},
    )
    assert sub_res.status_code == 200, sub_res.text
    assert sub_res.json()["data"]["status"] == "PENDING_APPROVAL"

    # Anti-self-approval: creator and assignee cannot approve (403)
    assert (
        await client.post(f"/api/v1/tasks/{task_id}/action-approval", headers=h_ops_creator, json={"approved": True})
    ).status_code == 403
    assert (
        await client.post(f"/api/v1/tasks/{task_id}/action-approval", headers=h_ops_emp, json={"approved": True})
    ).status_code == 403

    # Fire 5 concurrent approvals as designated approver (ops_mgr)
    async def do_approve(i: int):
        return await client.post(
            f"/api/v1/tasks/{task_id}/action-approval",
            headers=h_ops_mgr,
            json={"approved": True, "notes": f"Concurrent approve {i}"},
        )

    appr_res = await asyncio.gather(*[do_approve(i) for i in range(5)])
    appr_codes = [r.status_code for r in appr_res]
    assert appr_codes.count(200) == 1, f"Expected strictly 1 approval 200, got {appr_codes}"
    assert appr_codes.count(422) == 4, f"Expected 4 rejected replays (422), got {appr_codes}"

    async with SessionFactory() as session:
        row = (await session.execute(select(Task).where(Task.id == uuid.UUID(task_id)))).scalar_one()
        assert row.status == TaskStatus.DONE
        assert row.approval_status == "APPROVED"

    # 2. 8 concurrent POST /tasks/{id}/assign calls MUST produce ZERO 500 IntegrityErrors
    t2_res = await client.post(
        "/api/v1/tasks",
        headers=h_ops_mgr,
        json={"title": "BUG10 Concurrent Assign Task"},
    )
    assert t2_res.status_code == 201
    t2_id = t2_res.json()["data"]["id"]

    async def do_assign(i: int):
        uids = [ops_emp_id, sales_emp_id] if i % 2 == 0 else [ops_emp_id]
        return await client.post(
            f"/api/v1/tasks/{t2_id}/assign",
            headers=h_ops_mgr,
            json={"user_ids": uids, "assignment_role": "ASSIGNEE"},
        )

    assign_res = await asyncio.gather(*[do_assign(i) for i in range(8)])
    assign_codes = [r.status_code for r in assign_res]
    assert all(code == 200 for code in assign_codes), f"Concurrent assign had non-200: {assign_codes}"

    async with SessionFactory() as session:
        rows = (
            await session.execute(select(TaskAssignee).where(TaskAssignee.task_id == uuid.UUID(t2_id)))
        ).scalars().all()
        assert len(rows) in (1, 2)


@pytest.mark.asyncio
async def test_bug12_direct_patch_cannot_bypass_approval_workflow(remed_env):
    """BUG-12: Direct PATCH / bulk-action cannot set PENDING_APPROVAL or forge APPROVED/REJECTED."""
    client: AsyncClient = remed_env["client"]
    h_ops_creator = remed_env["headers"]["ops_creator"]
    h_ops_mgr = remed_env["headers"]["ops_mgr"]
    ops_mgr_id = str(remed_env["users"]["ops_mgr"].id)
    SessionFactory = remed_env["session_factory"]

    t_res = await client.post("/api/v1/tasks", headers=h_ops_creator, json={"title": "BUG12 Approval Guard Task"})
    assert t_res.status_code == 201
    task_id = t_res.json()["data"]["id"]

    # 1. Direct PATCH to PENDING_APPROVAL rejected (422)
    r_bypass1 = await client.patch(
        f"/api/v1/tasks/{task_id}",
        headers=h_ops_creator,
        json={"status": "PENDING_APPROVAL"},
    )
    assert r_bypass1.status_code == 422, r_bypass1.text

    # 2. Direct PATCH forging approval_status=APPROVED rejected (422)
    r_bypass2 = await client.patch(
        f"/api/v1/tasks/{task_id}",
        headers=h_ops_creator,
        json={"approval_status": "APPROVED"},
    )
    assert r_bypass2.status_code == 422, r_bypass2.text

    # 3. Bulk status to PENDING_APPROVAL rejected (422)
    r_bulk_bypass = await client.post(
        "/api/v1/tasks/bulk-action",
        headers=h_ops_creator,
        json={"task_ids": [task_id], "action": "STATUS", "value": "PENDING_APPROVAL"},
    )
    assert r_bulk_bypass.status_code == 422, r_bulk_bypass.text

    # Verify DB untouched
    async with SessionFactory() as session:
        row = (await session.execute(select(Task).where(Task.id == uuid.UUID(task_id)))).scalar_one()
        assert row.status == TaskStatus.TODO
        assert row.approval_status in ("NONE", "NOT_REQUIRED")

    # 4. Valid normal status transitions still work (TODO -> IN_PROGRESS -> REVIEW)
    assert (
        await client.patch(f"/api/v1/tasks/{task_id}", headers=h_ops_creator, json={"status": "IN_PROGRESS"})
    ).status_code == 200
    assert (
        await client.patch(f"/api/v1/tasks/{task_id}", headers=h_ops_creator, json={"status": "REVIEW"})
    ).status_code == 200

    # 5. Proper submit-approval -> non-admin cannot bypass DONE via PATCH -> designated approver rejects -> resubmit -> approves
    sub = await client.post(
        f"/api/v1/tasks/{task_id}/submit-approval",
        headers=h_ops_creator,
        json={"approver_id": ops_mgr_id, "notes": "Please approve"},
    )
    assert sub.status_code == 200
    assert sub.json()["data"]["status"] == "PENDING_APPROVAL"

    # Non-admin creator cannot jump PENDING_APPROVAL -> DONE via PATCH (422)
    assert (
        await client.patch(f"/api/v1/tasks/{task_id}", headers=h_ops_creator, json={"status": "DONE"})
    ).status_code == 422

    # Designated approver rejects -> returns to IN_PROGRESS / REJECTED
    rej = await client.post(
        f"/api/v1/tasks/{task_id}/action-approval",
        headers=h_ops_mgr,
        json={"approved": False, "notes": "Needs rework"},
    )
    assert rej.status_code == 200
    assert rej.json()["data"]["status"] == "IN_PROGRESS"
    assert rej.json()["data"]["approval_status"] == "REJECTED"


# ============================================================================
# PHASE 4 — P1 PERFORMANCE / N+1 QUERY ELIMINATION (BUG-11)
# ============================================================================

@pytest.mark.asyncio
async def test_bug11_no_n_plus_one_queries_across_workload_assignees_capacity_sprints(remed_env):
    """BUG-11: Workload, assignees, capacity, and sprints execute constant batched SQL (<=12 queries including auth)."""
    from sqlalchemy import event
    import app.database.engine as engine_module

    client: AsyncClient = remed_env["client"]
    h_admin = remed_env["headers"]["admin"]
    h_ops_mgr = remed_env["headers"]["ops_mgr"]
    h_ops_emp = remed_env["headers"]["ops_emp"]
    ops_emp_id = str(remed_env["users"]["ops_emp"].id)
    sales_emp_id = str(remed_env["users"]["sales_emp"].id)
    today = date.today()

    # Seed a sprint and tasks across statuses, overdue, high-priority, and departments
    sp = (await client.post("/api/v1/tasks/sprints", headers=h_admin, json={"name": "BUG11 Sprint", "status": "ACTIVE"})).json()["data"]
    sp_id = sp["id"]

    t1 = await client.post(
        "/api/v1/tasks",
        headers=h_ops_mgr,
        json={
            "title": "BUG11 Ops Overdue High",
            "priority": "HIGH",
            "status": "IN_PROGRESS",
            "sprint_id": sp_id,
            "start_date": (today - timedelta(days=3)).isoformat(),
            "due_date": (today - timedelta(days=1)).isoformat(),
            "assignee_ids": [ops_emp_id],
        },
    )
    t2 = await client.post(
        "/api/v1/tasks",
        headers=h_ops_mgr,
        json={
            "title": "BUG11 Ops Done",
            "priority": "MEDIUM",
            "status": "DONE",
            "sprint_id": sp_id,
            "due_date": today.isoformat(),
            "assignee_ids": [ops_emp_id],
        },
    )
    t3 = await client.post(
        "/api/v1/tasks",
        headers=h_admin,
        json={
            "title": "BUG11 Sales Todo",
            "priority": "CRITICAL",
            "status": "TODO",
            "sprint_id": sp_id,
            "start_date": today.isoformat(),
            "due_date": (today + timedelta(days=2)).isoformat(),
            "assignee_ids": [sales_emp_id],
        },
    )
    assert t1.status_code == 201 and t2.status_code == 201 and t3.status_code == 201

    # Attach SQL counter to the active app async engine
    app_engine = engine_module.get_engine()
    sql_queries: list[str] = []

    def _count_sql(conn, cursor, statement, parameters, context, executemany):
        sql_queries.append(statement)

    event.listen(app_engine.sync_engine, "before_cursor_execute", _count_sql)
    try:
        # 1. GET /tasks/workload
        sql_queries.clear()
        wl_res = await client.get("/api/v1/tasks/workload", headers=h_admin)
        wl_sql_count = len(sql_queries)
        assert wl_res.status_code == 200, wl_res.text
        assert wl_sql_count <= 12, f"GET /tasks/workload ran {wl_sql_count} SQL queries (expected <=12)"
        wl_by_uid = {u["user_id"]: u for u in wl_res.json()["data"]["users"]}
        assert wl_by_uid[ops_emp_id]["in_progress_tasks_count"] >= 1
        assert wl_by_uid[ops_emp_id]["completed_tasks_count"] >= 1
        assert wl_by_uid[ops_emp_id]["overdue_tasks_count"] >= 1
        assert wl_by_uid[ops_emp_id]["high_priority_count"] >= 1
        assert wl_by_uid[sales_emp_id]["open_tasks_count"] >= 1

        # 2. GET /tasks/assignees
        sql_queries.clear()
        asgn_res = await client.get("/api/v1/tasks/assignees", headers=h_admin)
        asgn_sql_count = len(sql_queries)
        assert asgn_res.status_code == 200, asgn_res.text
        assert asgn_sql_count <= 12, f"GET /tasks/assignees ran {asgn_sql_count} SQL queries (expected <=12)"
        asgn_by_uid = {u["id"]: u for u in asgn_res.json()["data"]}
        assert asgn_by_uid[ops_emp_id]["department"] == remed_env["roles"]["ops"].name
        assert asgn_by_uid[sales_emp_id]["department"] == remed_env["roles"]["sales"].name

        # 3. GET /tasks/capacity
        sql_queries.clear()
        cap_res = await client.get(
            f"/api/v1/tasks/capacity?start_date={today.isoformat()}&end_date={(today + timedelta(days=5)).isoformat()}",
            headers=h_admin,
        )
        cap_sql_count = len(sql_queries)
        assert cap_res.status_code == 200, cap_res.text
        assert cap_sql_count <= 12, f"GET /tasks/capacity ran {cap_sql_count} SQL queries (expected <=12)"
        cap_by_uid = {u["user_id"]: u for u in cap_res.json()["data"]["users"]}
        sales_today_alloc = next(a for a in cap_by_uid[sales_emp_id]["allocations"] if a["date"] == today.isoformat())
        assert t3.json()["data"]["id"] in sales_today_alloc["task_ids"]

        # 4. GET /tasks/sprints (verify query count + role-scoped counts)
        sql_queries.clear()
        sp_admin_res = await client.get("/api/v1/tasks/sprints", headers=h_admin)
        sp_sql_count = len(sql_queries)
        assert sp_admin_res.status_code == 200, sp_admin_res.text
        assert sp_sql_count <= 12, f"GET /tasks/sprints ran {sp_sql_count} SQL queries (expected <=12)"
        sp_admin_obj = next(s for s in sp_admin_res.json()["data"] if s["id"] == sp_id)
        assert sp_admin_obj["task_count"] == 3
        assert sp_admin_obj["completed_task_count"] == 1

        sp_mgr_obj = next(
            s for s in (await client.get("/api/v1/tasks/sprints", headers=h_ops_mgr)).json()["data"] if s["id"] == sp_id
        )
        assert sp_mgr_obj["task_count"] == 2  # Only Ops tasks, NOT Sales!
        assert sp_mgr_obj["completed_task_count"] == 1

        sp_emp_obj = next(
            s for s in (await client.get("/api/v1/tasks/sprints", headers=h_ops_emp)).json()["data"] if s["id"] == sp_id
        )
        assert sp_emp_obj["task_count"] == 2  # Assigned to ops_emp
    finally:
        event.remove(app_engine.sync_engine, "before_cursor_execute", _count_sql)


# ============================================================================
# PHASE 5 — P2/P3 REMAINING DEFECTS (BUG-14, BUG-15, BUG-18)
# ============================================================================

@pytest.mark.asyncio
async def test_bug14_soft_deleted_task_appears_in_trash_and_restores(remed_env):
    """BUG-14: Soft-deleted tasks appear in /api/v1/trash and can be restored back to active state."""
    client: AsyncClient = remed_env["client"]
    h_admin = remed_env["headers"]["admin"]
    SessionFactory = remed_env["session_factory"]

    t_res = await client.post("/api/v1/tasks", headers=h_admin, json={"title": "BUG14 Trashable Task"})
    assert t_res.status_code == 201
    task_id = t_res.json()["data"]["id"]

    # Soft delete task
    del_res = await client.delete(f"/api/v1/tasks/{task_id}", headers=h_admin)
    assert del_res.status_code == 200
    assert (await client.get(f"/api/v1/tasks/{task_id}", headers=h_admin)).status_code == 404

    # Must appear in /api/v1/trash as entity_type="Task"
    trash_res = await client.get("/api/v1/trash", headers=h_admin)
    assert trash_res.status_code == 200, trash_res.text
    trash_items = trash_res.json()["data"]
    found = [i for i in trash_items if i["id"] == task_id and i["entity_type"] == "Task"]
    assert len(found) == 1, f"Soft-deleted task {task_id} not found in Trash!"
    assert found[0]["name"] == "BUG14 Trashable Task"

    # Restore via /api/v1/trash/restore -> task becomes readable again & deleted_at/deleted_by cleared in DB
    restore_res = await client.post(
        "/api/v1/trash/restore",
        headers=h_admin,
        json={"items": [{"entity_type": "Task", "id": task_id}]},
    )
    assert restore_res.status_code == 200, restore_res.text
    assert restore_res.json()["data"]["restored_count"] == 1
    assert (await client.get(f"/api/v1/tasks/{task_id}", headers=h_admin)).status_code == 200

    async with SessionFactory() as session:
        row = (await session.execute(select(Task).where(Task.id == uuid.UUID(task_id)))).scalar_one()
        assert row.deleted_at is None
        assert row.deleted_by is None

    # Soft-delete again and permanently delete via /api/v1/trash/permanent-delete
    assert (await client.delete(f"/api/v1/tasks/{task_id}", headers=h_admin)).status_code == 200
    perm_res = await client.post(
        "/api/v1/trash/permanent-delete",
        headers=h_admin,
        json={"items": [{"entity_type": "Task", "id": task_id}]},
    )
    assert perm_res.status_code == 200, perm_res.text
    async with SessionFactory() as session:
        row = (await session.execute(select(Task).where(Task.id == uuid.UUID(task_id)))).scalar_one_or_none()
        assert row is None


@pytest.mark.asyncio
async def test_bug15_upload_size_limit_10mb_enforced(remed_env):
    """BUG-15: POST /tasks/upload-file rejects files >10MB and invalid extensions while accepting valid PDFs."""
    client: AsyncClient = remed_env["client"]
    h_ops_emp = remed_env["headers"]["ops_emp"]

    # 1. Valid small PDF succeeds
    ok_res = await client.post(
        "/api/v1/tasks/upload-file",
        headers=h_ops_emp,
        files={"file": ("small.pdf", b"%PDF-1.4\nhello", "application/pdf")},
    )
    assert ok_res.status_code == 200, ok_res.text

    # 2. Disallowed .exe rejected (400)
    exe_res = await client.post(
        "/api/v1/tasks/upload-file",
        headers=h_ops_emp,
        files={"file": ("evil.exe", b"MZ\x90\x00", "application/octet-stream")},
    )
    assert exe_res.status_code == 400

    # 3. Oversized 11MB PDF rejected (400)
    oversized = b"%PDF-1.4\n" + (b"0" * (11 * 1024 * 1024))
    big_res = await client.post(
        "/api/v1/tasks/upload-file",
        headers=h_ops_emp,
        files={"file": ("huge.pdf", oversized, "application/pdf")},
    )
    assert big_res.status_code in (400, 413, 422), f"Expected oversized upload rejection, got {big_res.status_code}"


@pytest.mark.asyncio
async def test_bug18_recurring_schedule_lifecycle_records_descriptive_audit_logs(remed_env):
    """BUG-18: Recurring schedule create/pause/resume/archive/unarchive/delete write descriptive audit logs."""
    from app.audit.models import AuditLog

    client: AsyncClient = remed_env["client"]
    h_admin = remed_env["headers"]["admin"]
    emp_id = str(remed_env["users"]["ops_emp"].id)
    SessionFactory = remed_env["session_factory"]

    sch_res = await client.post(
        "/api/v1/tasks/recurring/schedules",
        headers=h_admin,
        json={
            "title": "BUG18 Audited Schedule",
            "department": remed_env["roles"]["ops"].name,
            "assignee_id": emp_id,
            "priority": "MEDIUM",
            "frequency": "MONTHLY",
            "recurrence_config": {"day_of_month": 20},
            "effective_start_date": (date.today() + timedelta(days=2)).isoformat(),
        },
    )
    assert sch_res.status_code == 201
    sch_data = sch_res.json()["data"]
    sch_id = sch_data["id"]
    assert sch_data["next_run_date"] is not None

    assert (await client.post(f"/api/v1/tasks/recurring/schedules/{sch_id}/pause", headers=h_admin)).status_code == 200
    assert (await client.post(f"/api/v1/tasks/recurring/schedules/{sch_id}/resume", headers=h_admin)).status_code == 200
    assert (await client.post(f"/api/v1/tasks/recurring/schedules/{sch_id}/archive", headers=h_admin)).status_code == 200
    assert (await client.post(f"/api/v1/tasks/recurring/schedules/{sch_id}/unarchive", headers=h_admin)).status_code == 200
    assert (await client.delete(f"/api/v1/tasks/recurring/schedules/{sch_id}", headers=h_admin)).status_code == 200

    async with SessionFactory() as session:
        logs = (
            await session.execute(
                select(AuditLog)
                .where(
                    AuditLog.entity_type == "TaskRecurringSchedule",
                    AuditLog.entity_id == sch_id,
                )
                .order_by(AuditLog.created_at.asc())
            )
        ).scalars().all()
        descs = [l.description for l in logs]
        assert len(logs) >= 6, f"Expected >=6 lifecycle audit logs, got {len(logs)}: {descs}"
        assert all(d and len(d) > 5 for d in descs), f"Audit descriptions must be non-empty: {descs}"
        joined = " | ".join(descs)
        assert "Paused" in joined
        assert "Resumed" in joined
        assert "Archived" in joined
        assert "Restored" in joined
        assert "Soft-deleted" in joined
