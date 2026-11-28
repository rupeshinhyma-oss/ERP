"""
Enterprise Tasks & Recurring Tasks — Assignee Change Authorization,
Previous Assignee Visibility, and 7-Persona RBAC Security Suite (PostgreSQL 18).

Verifies real HTTP endpoints + real PostgreSQL 18 persistence across:
- Normal Tasks (12 security & visibility scenarios including direct API bypass traps)
- Recurring Tasks (10 definition authorization, history & instance preservation scenarios)
- Full 7-persona RBAC Matrix (Admin, Admin-approved task.all_view & task.manage,
  Department Manager, Original Creator, Current Assignee, Previous Assignee,
  Unauthorized Other-Department Employee, plus deprecated task.organization_view check)
"""

from __future__ import annotations

import os
import uuid
from datetime import date, timedelta

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine

from app.auth.security import create_access_token, hash_password
from app.core.config import settings
from app.main import create_application
from app.org_structure.models import DepartmentLeadershipAssignment, LeadershipType, OrgRecordStatus
from app.rbac.models import Permission, Role, RoleAssignmentStatus, UserPermission, UserRole
from app.tasks.models import (
    Task,
    TaskAssignmentHistory,
    TaskRecurringSchedule,
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
async def auth_hist_env():
    """Spin up an isolated multi-persona tenant inside local PostgreSQL 18 and clean up 100% afterwards."""
    _ensure_safe_local_pg(PG_TEST_URL)
    prev_db_url = str(settings.DATABASE_URL)
    os.environ["DATABASE_URL"] = PG_TEST_URL
    object.__setattr__(settings, "DATABASE_URL", PG_TEST_URL)

    import app.database.engine as engine_module

    await engine_module.dispose_engine()

    engine: AsyncEngine = create_async_engine(PG_TEST_URL, pool_size=10, max_overflow=20)
    SessionFactory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    tag = uuid.uuid4().hex[:8].lower()
    pw_hash = hash_password("TasksAuthHist!2026")

    created_user_ids: list[uuid.UUID] = []
    created_role_ids: list[uuid.UUID] = []

    async with SessionFactory() as session:
        perm_codes = [
            "task.view",
            "task.create",
            "task.assign",
            "task.department_view",
            "task.all_view",
            "task.organization_view",
            "task.escalate",
            "task.manage",
            "task.delete",
        ]
        perm_map: dict[str, Permission] = {}
        for code in perm_codes:
            res = await session.execute(select(Permission).where(Permission.code == code))
            p = res.scalar_one_or_none()
            if not p:
                p = Permission(code=code, module="tasks", description=code)
                session.add(p)
                await session.flush()
            perm_map[code] = p

        ops_role = Role(name=f"AuthOps_{tag}", code=f"AUTHOPS_{tag}", description="Ops dept")
        fin_role = Role(name=f"AuthFin_{tag}", code=f"AUTHFIN_{tag}", description="Finance dept")
        session.add_all([ops_role, fin_role])
        await session.flush()
        created_role_ids.extend([ops_role.id, fin_role.id])

        sa_res = await session.execute(select(Role).where(Role.name == "super_admin"))
        sa_role = sa_res.scalar_one_or_none()
        if not sa_role:
            sa_role = Role(name="super_admin", code="SUPER_ADMIN", description="Super Admin")
            session.add(sa_role)
            await session.flush()

        def mk_user(key: str) -> User:
            u = User(
                username=f"ah_{key}_{tag}",
                email=f"ah_{key}_{tag}@example.com",
                password_hash=pw_hash,
                first_name=key.title(),
                last_name=tag.upper(),
                display_name=f"{key.title()} {tag.upper()}",
                is_active=True,
                status=UserStatus.ACTIVE,
                employment_status=EmploymentStatus.ACTIVE,
                employment_type=EmploymentType.FULL_TIME,
                must_change_password=False,
            )
            session.add(u)
            return u

        admin_u = mk_user("admin")
        approved_viewer = mk_user("allviewer")
        task_manager = mk_user("taskmgr")
        ops_mgr = mk_user("opsmgr")
        ops_creator = mk_user("opscreator")
        emp_a = mk_user("empa")
        emp_b = mk_user("empb")
        other_dept_emp = mk_user("finemp")
        deprecated_org_emp = mk_user("orgemp")
        await session.flush()

        users = {
            "admin": admin_u,
            "approved_viewer": approved_viewer,
            "task_manager": task_manager,
            "ops_mgr": ops_mgr,
            "ops_creator": ops_creator,
            "emp_a": emp_a,
            "emp_b": emp_b,
            "other_dept_emp": other_dept_emp,
            "deprecated_org_emp": deprecated_org_emp,
        }
        created_user_ids.extend([u.id for u in users.values()])

        session.add_all([
            UserRole(user_id=admin_u.id, role_id=sa_role.id, status=RoleAssignmentStatus.ACTIVE, is_primary=True),
            UserRole(user_id=approved_viewer.id, role_id=ops_role.id, status=RoleAssignmentStatus.ACTIVE, is_primary=True),
            UserRole(user_id=task_manager.id, role_id=ops_role.id, status=RoleAssignmentStatus.ACTIVE, is_primary=True),
            UserRole(user_id=ops_mgr.id, role_id=ops_role.id, status=RoleAssignmentStatus.ACTIVE, is_primary=True),
            UserRole(user_id=ops_creator.id, role_id=ops_role.id, status=RoleAssignmentStatus.ACTIVE, is_primary=True),
            UserRole(user_id=emp_a.id, role_id=ops_role.id, status=RoleAssignmentStatus.ACTIVE, is_primary=True),
            UserRole(user_id=emp_b.id, role_id=ops_role.id, status=RoleAssignmentStatus.ACTIVE, is_primary=True),
            UserRole(user_id=other_dept_emp.id, role_id=fin_role.id, status=RoleAssignmentStatus.ACTIVE, is_primary=True),
            UserRole(user_id=deprecated_org_emp.id, role_id=fin_role.id, status=RoleAssignmentStatus.ACTIVE, is_primary=True),
        ])

        session.add(
            DepartmentLeadershipAssignment(
                department_id=ops_role.id,
                employee_id=ops_mgr.id,
                leadership_type=LeadershipType.PRIMARY_MANAGER,
                status=OrgRecordStatus.ACTIVE,
            )
        )

        def grant(user: User, codes: list[str]) -> None:
            for c in codes:
                session.add(UserPermission(user_id=user.id, permission_id=perm_map[c].id, is_granted=True))

        # IMPORTANT: emp_a & emp_b deliberately mirror real seeded employees who hold
        # task.view, task.create, task.assign, task.escalate on the default `user` role!
        grant(emp_a, ["task.view", "task.create", "task.assign", "task.escalate"])
        grant(emp_b, ["task.view", "task.create", "task.assign", "task.escalate"])
        grant(ops_creator, ["task.view", "task.create", "task.assign", "task.escalate"])
        grant(ops_mgr, ["task.view", "task.create", "task.assign", "task.department_view", "task.escalate"])
        grant(approved_viewer, ["task.view", "task.all_view"])
        grant(task_manager, ["task.view", "task.manage"])
        grant(other_dept_emp, ["task.view", "task.create", "task.assign"])
        grant(deprecated_org_emp, ["task.view", "task.organization_view"])

        await session.commit()

    def auth_headers(key: str) -> dict[str, str]:
        tok = create_access_token(users[key].id).token
        return {"Authorization": f"Bearer {tok}"}

    app = create_application()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        yield {
            "client": client,
            "session_factory": SessionFactory,
            "users": users,
            "roles": {"ops": ops_role, "fin": fin_role},
            "headers": {k: auth_headers(k) for k in users},
            "tag": tag,
        }

    # Guaranteed complete test-data cleanup
    async with SessionFactory() as session:
        task_ids_res = await session.execute(select(Task.id).where(Task.created_by.in_(created_user_ids)))
        task_ids = list(task_ids_res.scalars().all())
        sched_ids_res = await session.execute(
            select(TaskRecurringSchedule.id).where(TaskRecurringSchedule.created_by.in_(created_user_ids))
        )
        sched_ids = list(sched_ids_res.scalars().all())

        if task_ids:
            await session.execute(delete(TaskAssignmentHistory).where(TaskAssignmentHistory.task_id.in_(task_ids)))
            await session.execute(delete(Task).where(Task.id.in_(task_ids)))
        if sched_ids:
            await session.execute(
                delete(TaskAssignmentHistory).where(TaskAssignmentHistory.recurring_schedule_id.in_(sched_ids))
            )
            await session.execute(delete(TaskRecurringSchedule).where(TaskRecurringSchedule.id.in_(sched_ids)))

        await session.execute(
            delete(TaskAssignmentHistory).where(TaskAssignmentHistory.user_id.in_(created_user_ids))
        )
        await session.execute(
            delete(DepartmentLeadershipAssignment).where(
                DepartmentLeadershipAssignment.department_id.in_(created_role_ids)
            )
        )
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
# NORMAL TASK TESTS (1 - 12)
# ============================================================================


@pytest.mark.asyncio
async def test_normal_task_assignee_auth_previous_visibility_and_bypass_protection(auth_hist_env):
    client: AsyncClient = auth_hist_env["client"]
    h = auth_hist_env["headers"]
    u = auth_hist_env["users"]
    sf = auth_hist_env["session_factory"]

    emp_a_id = str(u["emp_a"].id)
    emp_b_id = str(u["emp_b"].id)

    # 1. Admin creates task and assigns Employee A (with a subtask to test subtask reassignment too)
    create_res = await client.post(
        "/api/v1/tasks",
        headers=h["admin"],
        json={
            "title": f"Task T-100 Auth & History {auth_hist_env['tag']}",
            "description": "Quarterly compliance checklist",
            "priority": "HIGH",
            "status": "TODO",
            "assignee_ids": [emp_a_id],
            "subtasks": [{"title": "Draft report", "assignee_ids": [emp_a_id]}],
        },
    )
    assert create_res.status_code == 201, create_res.text
    task_data = create_res.json()["data"]
    task_id = task_data["id"]
    subtask_id = task_data["subtasks"][0]["id"]
    assert task_data["can_change_assignee"] is True
    assert len(task_data["assignment_history"]) == 1
    assert task_data["assignment_history"][0]["user_id"] == emp_a_id
    assert task_data["assignment_history"][0]["unassigned_at"] is None

    # 2. Employee A can view the task (and can_change_assignee is False)
    emp_a_get = await client.get(f"/api/v1/tasks/{task_id}", headers=h["emp_a"])
    assert emp_a_get.status_code == 200, emp_a_get.text
    emp_a_task = emp_a_get.json()["data"]
    assert emp_a_task["can_change_assignee"] is False
    assert emp_a_task["is_previously_assigned"] is False

    emp_a_my = await client.get("/api/v1/tasks?view=my", headers=h["emp_a"])
    assert emp_a_my.status_code == 200
    assert any(item["id"] == task_id for item in emp_a_my.json()["data"]["items"])

    # 3. Employee A attempts to change assignee to Employee B -> 403
    reassign_other = await client.post(
        f"/api/v1/tasks/{task_id}/assign",
        headers=h["emp_a"],
        json={"user_ids": [emp_b_id], "assignment_role": "ASSIGNEE"},
    )
    assert reassign_other.status_code == 403, reassign_other.text

    # 4. Employee A attempts to change assignee to themselves -> 403
    reassign_self = await client.post(
        f"/api/v1/tasks/{task_id}/assign",
        headers=h["emp_a"],
        json={"user_ids": [emp_a_id], "assignment_role": "ASSIGNEE"},
    )
    assert reassign_self.status_code == 403, reassign_self.text

    # 12 (part A). Direct API bypass attempts while Employee A is active assignee -> all 403
    # 12a. PATCH /tasks/{id} with assignee_ids
    bypass_patch_ids = await client.patch(
        f"/api/v1/tasks/{task_id}",
        headers=h["emp_a"],
        json={"assignee_ids": [emp_b_id]},
    )
    assert bypass_patch_ids.status_code == 403, bypass_patch_ids.text

    # 12b. PATCH /tasks/{id} with assignee_id
    bypass_patch_single = await client.patch(
        f"/api/v1/tasks/{task_id}",
        headers=h["emp_a"],
        json={"assignee_id": emp_b_id},
    )
    assert bypass_patch_single.status_code == 403, bypass_patch_single.text

    # 12c. POST /tasks/bulk-action ASSIGN
    bypass_bulk = await client.post(
        "/api/v1/tasks/bulk-action",
        headers=h["emp_a"],
        json={"task_ids": [task_id], "action": "ASSIGN", "value": emp_b_id},
    )
    assert bypass_bulk.status_code == 403, bypass_bulk.text

    # 12d. POST /tasks/{id}/assign with role=WATCHER attempting to downgrade active assignee
    bypass_watcher_downgrade = await client.post(
        f"/api/v1/tasks/{task_id}/assign",
        headers=h["emp_a"],
        json={"user_ids": [emp_a_id], "assignment_role": "WATCHER"},
    )
    assert bypass_watcher_downgrade.status_code == 403, bypass_watcher_downgrade.text

    # 12e. PATCH /tasks/subtasks/{subtask_id} attempting to change subtask assignee
    bypass_subtask_assign = await client.patch(
        f"/api/v1/tasks/subtasks/{subtask_id}",
        headers=h["emp_a"],
        json={"assignee_ids": [emp_b_id]},
    )
    assert bypass_subtask_assign.status_code == 403, bypass_subtask_assign.text

    # 5. Employee A updates task status, adds comment, toggles subtask -> ALLOWED (preserved!)
    status_res = await client.patch(
        f"/api/v1/tasks/{task_id}",
        headers=h["emp_a"],
        json={"status": "IN_PROGRESS", "description": "Started checklist work"},
    )
    assert status_res.status_code == 200, status_res.text
    assert status_res.json()["data"]["status"] == "IN_PROGRESS"

    comment_res = await client.post(
        f"/api/v1/tasks/{task_id}/comment",
        headers=h["emp_a"],
        json={"message": "Working on initial section"},
    )
    assert comment_res.status_code == 200 or comment_res.status_code == 201, comment_res.text

    sub_toggle_res = await client.patch(
        f"/api/v1/tasks/subtasks/{subtask_id}",
        headers=h["emp_a"],
        json={"completed": True},
    )
    assert sub_toggle_res.status_code == 200, sub_toggle_res.text

    # 6. Admin reassigns Employee A -> Employee B -> 200
    admin_reassign = await client.post(
        f"/api/v1/tasks/{task_id}/assign",
        headers=h["admin"],
        json={"user_ids": [emp_b_id], "assignment_role": "ASSIGNEE"},
    )
    assert admin_reassign.status_code == 200, admin_reassign.text
    reassigned_data = admin_reassign.json()["data"]
    assert [a["user_id"] for a in reassigned_data["assignees"] if a["assignment_role"] != "WATCHER"] == [emp_b_id]

    # 10. Assignment history contains BOTH assignments (A closed -> B open) in API and DB
    hist = reassigned_data["assignment_history"]
    assert len(hist) == 2
    hist_a = next(r for r in hist if r["user_id"] == emp_a_id)
    hist_b = next(r for r in hist if r["user_id"] == emp_b_id)
    assert hist_a["unassigned_at"] is not None
    assert hist_a["unassigned_by"] == str(u["admin"].id)
    assert hist_a["reassigned_to_user_id"] == emp_b_id
    assert hist_b["unassigned_at"] is None
    assert hist_b["assigned_by"] == str(u["admin"].id)

    async with sf() as session:
        db_hist = (
            await session.execute(
                select(TaskAssignmentHistory).where(TaskAssignmentHistory.task_id == uuid.UUID(task_id))
            )
        ).scalars().all()
        assert len(db_hist) == 2

    # 7. Employee A retains read-only visibility in task history
    emp_a_hist = await client.get("/api/v1/tasks?view=history", headers=h["emp_a"])
    assert emp_a_hist.status_code == 200, emp_a_hist.text
    hist_items = emp_a_hist.json()["data"]["items"]
    matched_hist = [i for i in hist_items if i["id"] == task_id]
    assert len(matched_hist) == 1
    assert matched_hist[0]["is_previously_assigned"] is True
    assert matched_hist[0]["reassigned_at"] is not None
    assert matched_hist[0]["reassigned_by_name"] is not None
    assert matched_hist[0]["can_change_assignee"] is False
    # Verify private email/username are sanitized for previous-assignee-only view
    for a in matched_hist[0]["assignees"]:
        if a.get("user"):
            assert a["user"].get("email") is None
            assert a["user"].get("username") is None

    emp_a_detail = await client.get(f"/api/v1/tasks/{task_id}", headers=h["emp_a"])
    assert emp_a_detail.status_code == 200, emp_a_detail.text
    detail_payload = emp_a_detail.json()["data"]
    assert detail_payload["is_previously_assigned"] is True
    assert detail_payload["can_change_assignee"] is False
    assert detail_payload["reassigned_at"] is not None
    assert len(detail_payload["assignment_history"]) == 2
    for a in detail_payload["assignees"]:
        if a.get("user"):
            assert a["user"].get("email") is None

    emp_a_timeline = await client.get(f"/api/v1/tasks/{task_id}/timeline", headers=h["emp_a"])
    assert emp_a_timeline.status_code == 200, emp_a_timeline.text
    event_types = [e["event_type"] for e in emp_a_timeline.json()["data"]]
    assert "USER_ASSIGNED" in event_types
    assert "USER_REASSIGNED" in event_types

    # 8. Employee A does NOT see the task in active assigned tasks (view=my)
    emp_a_my_after = await client.get("/api/v1/tasks?view=my", headers=h["emp_a"])
    assert emp_a_my_after.status_code == 200
    assert not any(item["id"] == task_id for item in emp_a_my_after.json()["data"]["items"])

    # Previous Assignee (Employee A) CANNOT mutate, comment, escalate, duplicate, or reassign -> all 403
    assert (
        await client.patch(f"/api/v1/tasks/{task_id}", headers=h["emp_a"], json={"status": "DONE"})
    ).status_code == 403
    assert (
        await client.post(f"/api/v1/tasks/{task_id}/comment", headers=h["emp_a"], json={"message": "Sneaky"})
    ).status_code == 403
    assert (
        await client.post(
            f"/api/v1/tasks/{task_id}/escalate",
            headers=h["emp_a"],
            json={
                "to_user": str(u["ops_mgr"].id),
                "reason": "Old assignee escalation",
                "due_date": (date.today() + timedelta(days=2)).isoformat(),
            },
        )
    ).status_code == 403
    assert (
        await client.post(
            f"/api/v1/tasks/{task_id}/assign",
            headers=h["emp_a"],
            json={"user_ids": [emp_a_id], "assignment_role": "ASSIGNEE"},
        )
    ).status_code == 403
    assert (
        await client.post(f"/api/v1/tasks/{task_id}/duplicate", headers=h["emp_a"], json={})
    ).status_code == 403

    # 9. Employee B sees it in active assigned tasks, can update status, and CANNOT reassign
    emp_b_my = await client.get("/api/v1/tasks?view=my", headers=h["emp_b"])
    assert emp_b_my.status_code == 200
    emp_b_items = [i for i in emp_b_my.json()["data"]["items"] if i["id"] == task_id]
    assert len(emp_b_items) == 1
    assert emp_b_items[0]["can_change_assignee"] is False
    assert emp_b_items[0]["is_previously_assigned"] is False

    emp_b_status = await client.patch(
        f"/api/v1/tasks/{task_id}",
        headers=h["emp_b"],
        json={"status": "REVIEW"},
    )
    assert emp_b_status.status_code == 200
    assert emp_b_status.json()["data"]["status"] == "REVIEW"

    emp_b_reassign = await client.post(
        f"/api/v1/tasks/{task_id}/assign",
        headers=h["emp_b"],
        json={"user_ids": [emp_a_id], "assignment_role": "ASSIGNEE"},
    )
    assert emp_b_reassign.status_code == 403

    # 11. Unauthorized employee (other department) cannot retrieve task or timeline -> 403
    assert (await client.get(f"/api/v1/tasks/{task_id}", headers=h["other_dept_emp"])).status_code == 403
    assert (await client.get(f"/api/v1/tasks/{task_id}/timeline", headers=h["other_dept_emp"])).status_code == 403
    other_my = await client.get("/api/v1/tasks?view=my", headers=h["other_dept_emp"])
    assert not any(i["id"] == task_id for i in other_my.json()["data"]["items"])
    other_hist = await client.get("/api/v1/tasks?view=history", headers=h["other_dept_emp"])
    assert not any(i["id"] == task_id for i in other_hist.json()["data"]["items"])


# ============================================================================
# RECURRING TASK TESTS (1 - 10)
# ============================================================================


@pytest.mark.asyncio
async def test_recurring_task_authorization_history_and_instance_preservation(auth_hist_env):
    client: AsyncClient = auth_hist_env["client"]
    h = auth_hist_env["headers"]
    u = auth_hist_env["users"]

    emp_a_id = str(u["emp_a"].id)
    emp_b_id = str(u["emp_b"].id)
    ops_mgr_id = str(u["ops_mgr"].id)
    ops_dept_name = auth_hist_env["roles"]["ops"].name

    # Pick a start date comfortably in the current month so generation works deterministically
    today = date.today()
    month_start = today.replace(day=1)

    # 1. Creator creates recurring task assigned to Employee A
    create_sched_res = await client.post(
        "/api/v1/tasks/recurring/schedules",
        headers=h["ops_creator"],
        json={
            "title": f"Monthly Compliance Audit {auth_hist_env['tag']}",
            "description": "Audit internal controls",
            "department": ops_dept_name,
            "assignee_id": emp_a_id,
            "manager_id": ops_mgr_id,
            "priority": "HIGH",
            "issue_type": "TASK",
            "frequency": "MONTHLY",
            "recurrence_config": {
                "month_mode": "EVERY_MONTH",
                "months": [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
                "day_type": "SPECIFIC_DAY",
                "day_of_month": 28,
            },
            "reminder_lead_days": 3,
            "escalation_timing_type": "ON_DUE_DATE",
            "escalation_offset_days": 0,
            "escalation_repeat_interval_days": 7,
            "effective_start_date": month_start.isoformat(),
        },
    )
    assert create_sched_res.status_code == 201, create_sched_res.text
    sched = create_sched_res.json()["data"]
    sched_id = sched["id"]
    assert sched["can_manage_schedule"] is True
    assert len(sched["assignment_history"]) == 1
    assert sched["assignment_history"][0]["user_id"] == emp_a_id

    # Verify Employee A sees schedule in read-only mode (can_manage_schedule == False)
    emp_a_sched = await client.get(f"/api/v1/tasks/recurring/schedules/{sched_id}", headers=h["emp_a"])
    assert emp_a_sched.status_code == 200
    assert emp_a_sched.json()["data"]["can_manage_schedule"] is False

    # Instance #1 was generated on creation (for current month/period)
    inst_list_1 = await client.get(
        f"/api/v1/tasks/recurring/instances?schedule_id={sched_id}&history_only=false",
        headers=h["ops_creator"],
    )
    assert inst_list_1.status_code == 200
    instances_1 = inst_list_1.json()["data"]
    assert len(instances_1) == 1
    inst1_id = instances_1[0]["id"]
    inst1_period = instances_1[0]["recurrence_period"]
    assert [a["user_id"] for a in instances_1[0]["assignees"] if a["assignment_role"] == "ASSIGNEE"] == [emp_a_id]

    # 9. No duplicate instances generated on repeated run for same date/period
    dup_gen = await client.post(
        f"/api/v1/tasks/recurring/generate?schedule_id={sched_id}&as_of_date={today.isoformat()}",
        headers=h["ops_creator"],
    )
    assert dup_gen.status_code == 200
    assert dup_gen.json()["data"]["generated_count"] == 0

    # 2 & 7. Employee A CANNOT change recurring assignee OR edit/pause/archive/delete/generate schedule -> all 403
    assert (
        await client.patch(
            f"/api/v1/tasks/recurring/schedules/{sched_id}",
            headers=h["emp_a"],
            json={"assignee_id": emp_b_id},
        )
    ).status_code == 403
    assert (
        await client.patch(
            f"/api/v1/tasks/recurring/schedules/{sched_id}",
            headers=h["emp_a"],
            json={"title": "Tampered Title", "frequency": "YEARLY"},
        )
    ).status_code == 403
    assert (
        await client.post(f"/api/v1/tasks/recurring/schedules/{sched_id}/pause", headers=h["emp_a"])
    ).status_code == 403
    assert (
        await client.post(f"/api/v1/tasks/recurring/schedules/{sched_id}/archive", headers=h["emp_a"])
    ).status_code == 403
    assert (
        await client.post(
            f"/api/v1/tasks/recurring/generate?schedule_id={sched_id}",
            headers=h["emp_a"],
        )
    ).status_code == 403
    # Employee A also CANNOT reassign the generated instance #1 -> 403
    assert (
        await client.post(
            f"/api/v1/tasks/{inst1_id}/assign",
            headers=h["emp_a"],
            json={"user_ids": [emp_b_id], "assignment_role": "ASSIGNEE"},
        )
    ).status_code == 403

    # 3. Creator changes recurring assignee to Employee B (even with update_pending_instances=True)
    upd_sched_res = await client.patch(
        f"/api/v1/tasks/recurring/schedules/{sched_id}",
        headers=h["ops_creator"],
        json={"assignee_id": emp_b_id, "update_pending_instances": True},
    )
    assert upd_sched_res.status_code == 200, upd_sched_res.text
    upd_sched = upd_sched_res.json()["data"]
    assert upd_sched["assignee_id"] == emp_b_id
    assert len(upd_sched["assignment_history"]) == 2

    # Schedule history endpoint reflects Employee A (closed -> Employee B) and Employee B (active)
    sched_hist_res = await client.get(
        f"/api/v1/tasks/recurring/schedules/{sched_id}/history",
        headers=h["ops_creator"],
    )
    assert sched_hist_res.status_code == 200
    sched_hist = sched_hist_res.json()["data"]
    assert len(sched_hist) == 2
    assert sched_hist[0]["user_id"] == emp_a_id
    assert sched_hist[0]["unassigned_at"] is not None
    assert sched_hist[0]["reassigned_to_user_id"] == emp_b_id
    assert sched_hist[1]["user_id"] == emp_b_id
    assert sched_hist[1]["unassigned_at"] is None

    # 4. Existing generated instance #1 RETAINS Employee A as its historical assignment!
    inst1_check = await client.get(f"/api/v1/tasks/{inst1_id}", headers=h["ops_creator"])
    assert inst1_check.status_code == 200
    inst1_assignees = [
        a["user_id"] for a in inst1_check.json()["data"]["assignees"] if a["assignment_role"] == "ASSIGNEE"
    ]
    assert inst1_assignees == [emp_a_id]

    # 5. Future generated instance #2 (next month) goes to Employee B!
    next_month_date = (today.replace(day=28) + timedelta(days=5)).replace(day=2)
    gen_next_res = await client.post(
        f"/api/v1/tasks/recurring/generate?schedule_id={sched_id}&as_of_date={next_month_date.isoformat()}",
        headers=h["ops_creator"],
    )
    assert gen_next_res.status_code == 200, gen_next_res.text
    assert gen_next_res.json()["data"]["generated_count"] == 1
    inst2_id = gen_next_res.json()["data"]["task_ids"][0]
    assert inst2_id != inst1_id

    inst2_check = await client.get(f"/api/v1/tasks/{inst2_id}", headers=h["ops_creator"])
    assert inst2_check.status_code == 200
    assert inst2_check.json()["data"]["recurrence_period"] != inst1_period
    assert [
        a["user_id"] for a in inst2_check.json()["data"]["assignees"] if a["assignment_role"] == "ASSIGNEE"
    ] == [emp_b_id]

    # 9 (again). Re-running generator for next_month_date produces 0 duplicates
    dup_next_gen = await client.post(
        f"/api/v1/tasks/recurring/generate?schedule_id={sched_id}&as_of_date={next_month_date.isoformat()}",
        headers=h["ops_creator"],
    )
    assert dup_next_gen.status_code == 200
    assert dup_next_gen.json()["data"]["generated_count"] == 0

    # 8. Employee B sees newly generated instance #2 in My Tasks and Upcoming Recurring Instances
    emp_b_my = await client.get("/api/v1/tasks?view=my", headers=h["emp_b"])
    assert any(i["id"] == inst2_id for i in emp_b_my.json()["data"]["items"])
    assert not any(i["id"] == inst1_id for i in emp_b_my.json()["data"]["items"])

    emp_b_upcoming = await client.get(
        f"/api/v1/tasks/recurring/instances?schedule_id={sched_id}&history_only=false",
        headers=h["emp_b"],
    )
    assert emp_b_upcoming.status_code == 200
    assert [i["id"] for i in emp_b_upcoming.json()["data"]] == [inst2_id]

    # 6. Employee A retains visibility of previous instance #1 and NEVER sees Employee B's new instance #2
    assert (await client.get(f"/api/v1/tasks/{inst1_id}", headers=h["emp_a"])).status_code == 200
    assert (await client.get(f"/api/v1/tasks/{inst2_id}", headers=h["emp_a"])).status_code == 403
    emp_a_insts = await client.get(
        f"/api/v1/tasks/recurring/instances?schedule_id={sched_id}&history_only=false",
        headers=h["emp_a"],
    )
    assert emp_a_insts.status_code == 200
    assert [i["id"] for i in emp_a_insts.json()["data"]] == [inst1_id]

    # Now Creator ALSO reassigns instance #1 itself from Employee A -> Employee B:
    # Employee A must lose active assignment on instance #1 yet retain historical visibility!
    reassign_inst1 = await client.post(
        f"/api/v1/tasks/{inst1_id}/assign",
        headers=h["ops_creator"],
        json={"user_ids": [emp_b_id], "assignment_role": "ASSIGNEE"},
    )
    assert reassign_inst1.status_code == 200

    emp_a_upcoming_after = await client.get(
        f"/api/v1/tasks/recurring/instances?schedule_id={sched_id}&history_only=false",
        headers=h["emp_a"],
    )
    assert emp_a_upcoming_after.status_code == 200
    assert emp_a_upcoming_after.json()["data"] == []

    emp_a_rec_hist = await client.get(
        f"/api/v1/tasks/recurring/instances?schedule_id={sched_id}&history_only=true",
        headers=h["emp_a"],
    )
    assert emp_a_rec_hist.status_code == 200
    assert [i["id"] for i in emp_a_rec_hist.json()["data"]] == [inst1_id]
    assert emp_a_rec_hist.json()["data"][0]["is_previously_assigned"] is True

    # 10. Existing recurrence previews & frequencies (MONTHLY, QUARTERLY, YEARLY) remain unchanged
    for freq, cfg in [
        ("MONTHLY", {"month_mode": "EVERY_MONTH", "day_type": "LAST_WORKING_DAY"}),
        ("QUARTERLY", {"quarters": ["Q1", "Q2", "Q3", "Q4"]}),
        ("YEARLY", {"year_type": "FINANCIAL", "financial_year_start_month": 4, "due_month": 3, "day_type": "LAST_DAY"}),
    ]:
        prev_res = await client.post(
            "/api/v1/tasks/recurring/preview",
            headers=h["ops_creator"],
            json={"frequency": freq, "recurrence_config": cfg, "start_date": today.isoformat()},
        )
        assert prev_res.status_code == 200, prev_res.text
        assert prev_res.json()["data"]["next_occurrence"] is not None


# ============================================================================
# 7-PERSONA RBAC MATRIX REGRESSION
# ============================================================================


@pytest.mark.asyncio
async def test_seven_persona_rbac_matrix_and_deprecated_org_view(auth_hist_env):
    client: AsyncClient = auth_hist_env["client"]
    h = auth_hist_env["headers"]
    u = auth_hist_env["users"]

    emp_a_id = str(u["emp_a"].id)
    emp_b_id = str(u["emp_b"].id)
    other_emp_id = str(u["other_dept_emp"].id)

    # Create an Ops task (owned by ops_creator, assigned to emp_a)
    ops_task_res = await client.post(
        "/api/v1/tasks",
        headers=h["ops_creator"],
        json={
            "title": f"Ops RBAC Task {auth_hist_env['tag']}",
            "assignee_ids": [emp_a_id],
        },
    )
    assert ops_task_res.status_code == 201
    ops_task_id = ops_task_res.json()["data"]["id"]

    # Create a Finance task (owned by other_dept_emp) to test cross-dept manager isolation
    fin_task_res = await client.post(
        "/api/v1/tasks",
        headers=h["other_dept_emp"],
        json={
            "title": f"Finance RBAC Task {auth_hist_env['tag']}",
            "assignee_ids": [other_emp_id],
        },
    )
    assert fin_task_res.status_code == 201
    fin_task_id = fin_task_res.json()["data"]["id"]

    # 1. Admin-approved read-only (`task.all_view`): can READ both tasks, CANNOT assign/mutate (403)
    av_get = await client.get(f"/api/v1/tasks/{ops_task_id}", headers=h["approved_viewer"])
    assert av_get.status_code == 200
    assert av_get.json()["data"]["can_change_assignee"] is False
    assert (await client.get(f"/api/v1/tasks/{fin_task_id}", headers=h["approved_viewer"])).status_code == 200
    assert (
        await client.post(
            f"/api/v1/tasks/{ops_task_id}/assign",
            headers=h["approved_viewer"],
            json={"user_ids": [emp_b_id]},
        )
    ).status_code == 403
    assert (
        await client.patch(
            f"/api/v1/tasks/{ops_task_id}",
            headers=h["approved_viewer"],
            json={"status": "DONE"},
        )
    ).status_code == 403

    # 2. Task Manager (`task.manage`): CAN assign across departments
    tm_get = await client.get(f"/api/v1/tasks/{ops_task_id}", headers=h["task_manager"])
    assert tm_get.status_code == 200
    assert tm_get.json()["data"]["can_change_assignee"] is True
    assert (
        await client.post(
            f"/api/v1/tasks/{ops_task_id}/assign",
            headers=h["task_manager"],
            json={"user_ids": [emp_b_id]},
        )
    ).status_code == 200

    # 3. Original Creator (`ops_creator`): CAN reassign their own created task back to emp_a
    creator_reassign = await client.post(
        f"/api/v1/tasks/{ops_task_id}/assign",
        headers=h["ops_creator"],
        json={"user_ids": [emp_a_id]},
    )
    assert creator_reassign.status_code == 200

    # 4. Department Manager (`ops_mgr`): CAN reassign Ops task (200), CANNOT view/assign Finance task (403)
    mgr_ops = await client.post(
        f"/api/v1/tasks/{ops_task_id}/assign",
        headers=h["ops_mgr"],
        json={"user_ids": [emp_b_id]},
    )
    assert mgr_ops.status_code == 200
    assert (await client.get(f"/api/v1/tasks/{fin_task_id}", headers=h["ops_mgr"])).status_code == 403
    assert (
        await client.post(
            f"/api/v1/tasks/{fin_task_id}/assign",
            headers=h["ops_mgr"],
            json={"user_ids": [emp_a_id]},
        )
    ).status_code == 403

    # 5. Admin (`super_admin`): CAN view & reassign Finance task
    assert (
        await client.post(
            f"/api/v1/tasks/{fin_task_id}/assign",
            headers=h["admin"],
            json={"user_ids": [other_emp_id]},
        )
    ).status_code == 200

    # 6. Deprecated `task.organization_view`: MUST NOT expand visibility or grant assign access
    assert (
        await client.get(f"/api/v1/tasks/{ops_task_id}", headers=h["deprecated_org_emp"])
    ).status_code == 403
    assert (
        await client.post(
            f"/api/v1/tasks/{ops_task_id}/assign",
            headers=h["deprecated_org_emp"],
            json={"user_ids": [emp_a_id]},
        )
    ).status_code == 403
