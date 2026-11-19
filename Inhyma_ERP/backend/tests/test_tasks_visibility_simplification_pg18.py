"""
Enterprise Tasks — Role-Based Visibility, Permission Simplification & Cross-Department Security Suite (PG18).

Covers every access boundary over real HTTP routes + real PostgreSQL 18 (`inhyma_test_db`):
- Seed bootstrap contract: `task.organization_view` removed; `task.view`, `task.department_view`,
  `task.create`, `task.assign`, `task.escalate`, `task.manage`, `task.delete` retained.
- A. Employee (`task.view` only):
  - Sees strictly assigned/created tasks across list, backlog, kanban, calendar, search.
  - Denied (403) on `view=department`, `view=organization`, `department_id=<any>`.
  - Denied (403) on direct task ID, timeline, comments, attachments, comment reactions,
    subtask comments/attachments, dependency linking, parent task attachment.
  - Denied (403) on department workload/capacity & foreign recurring schedules/instances.
  - Obsolete `task.organization_view` user override grants ZERO cross-dept visibility or mutation.
- B. Department Manager (active `DepartmentLeadershipAssignment` & `task.department_view` read-only):
  - Sees all tasks belonging to own department (including peer/employee tasks) and switches
    cleanly between `view=my` and `view=department`.
  - Cannot see or bypass into other departments via search, assignee_id, department_id,
    direct task ID, attachments, reactions, workload, capacity, or recurring schedules.
  - Viewing vs modification separation: `task.department_view` alone grants read visibility
    for own department tasks, NOT edit/delete mutation on peer tasks.
  - Inactive former manager (`status=INACTIVE`) cannot view or mutate former department tasks.
- C. Admin (`super_admin`):
  - Sees all tasks across all departments by default (`view=all`), filters by any department,
    retains full create/edit/delete/assign/recurring capabilities.
- D. Admin-Approved User (explicit RBAC `task.manage` grant via Admin):
  - Before grant: restricted to Employee scope.
  - Self-grant attempt via `PUT /api/v1/rbac/users/{id}/permissions/{perm}` -> 403 Forbidden.
  - After Admin grants `task.manage` via RBAC API: immediately sees all tasks across all
    departments, departments list, workload, and recurring schedules.
  - After Admin revokes `task.manage`: immediately loses cross-department access (403).
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
from app.rbac.models import Permission, Role, RoleAssignmentStatus, RolePermission, UserPermission, UserRole
from app.tasks.models import (
    Task,
    TaskAssignee,
    TaskAttachment,
    TaskComment,
    TaskPriority,
    TaskRecurringSchedule,
    TaskSprint,
    TaskStatus,
    TaskSubtask,
    TaskSubtaskAttachment,
    TaskSubtaskComment,
)
from app.users.models import EmploymentStatus, EmploymentType, User, UserStatus
from scripts.seed import BOOTSTRAP_PERMISSIONS, USER_ROLE_PERMISSION_CODES

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


def test_seed_removes_organization_view_and_retains_core_task_permissions():
    """Verify `task.organization_view` is removed from BOOTSTRAP_PERMISSIONS while `task.all_view` and functional task permissions exist."""
    bootstrap_codes = {row[0] for row in BOOTSTRAP_PERMISSIONS}
    assert "task.organization_view" not in bootstrap_codes
    for required_code in (
        "task.view",
        "task.department_view",
        "task.all_view",
        "task.create",
        "task.assign",
        "task.escalate",
        "task.manage",
        "task.delete",
    ):
        assert required_code in bootstrap_codes, f"Missing required permission: {required_code}"

    # Default employee `user` role must NOT grant department_view, all_view, manage, or delete
    assert "task.view" in USER_ROLE_PERMISSION_CODES
    assert "task.department_view" not in USER_ROLE_PERMISSION_CODES
    assert "task.all_view" not in USER_ROLE_PERMISSION_CODES
    assert "task.organization_view" not in USER_ROLE_PERMISSION_CODES
    assert "task.manage" not in USER_ROLE_PERMISSION_CODES
    assert "task.delete" not in USER_ROLE_PERMISSION_CODES


@pytest_asyncio.fixture
async def pg_tasks_env():
    _ensure_safe_local_pg(PG_TEST_URL)
    prev_db_url = str(settings.DATABASE_URL)
    os.environ["DATABASE_URL"] = PG_TEST_URL
    object.__setattr__(settings, "DATABASE_URL", PG_TEST_URL)

    import app.database.engine as engine_module

    await engine_module.dispose_engine()

    engine: AsyncEngine = create_async_engine(PG_TEST_URL, pool_size=15, max_overflow=20)
    SessionFactory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    tag = uuid.uuid4().hex[:8].lower()
    pw_hash = hash_password("TasksVis!2026")

    created_user_ids: list[uuid.UUID] = []
    created_role_ids: list[uuid.UUID] = []
    created_task_ids: list[uuid.UUID] = []
    created_schedule_ids: list[uuid.UUID] = []
    created_sprint_ids: list[uuid.UUID] = []

    async with SessionFactory() as session:
        # Ensure required permissions exist in test DB
        perm_codes = [
            "task.view",
            "task.department_view",
            "task.all_view",
            "task.create",
            "task.assign",
            "task.escalate",
            "task.manage",
            "task.delete",
            "roles_permissions.view",
            "roles_permissions.action",
        ]
        perm_map: dict[str, Permission] = {}
        for code in perm_codes:
            p = (await session.execute(select(Permission).where(Permission.code == code))).scalar_one_or_none()
            if p is None:
                p = Permission(
                    code=code,
                    module=code.split(".")[0],
                    page="tasks",
                    action=code.split(".")[-1],
                    scope="ALL",
                    description=f"Test seed {code}",
                )
                session.add(p)
                await session.flush()
            perm_map[code] = p

        # Also check if legacy `task.organization_view` exists (or create temp one only if already present)
        legacy_org_perm = (
            await session.execute(select(Permission).where(Permission.code == "task.organization_view"))
        ).scalar_one_or_none()

        super_admin_role = (
            await session.execute(select(Role).where(Role.name == "super_admin"))
        ).scalar_one_or_none()
        if super_admin_role is None:
            super_admin_role = Role(name="super_admin", description="Super Admin", is_system=True)
            session.add(super_admin_role)
            await session.flush()
            created_role_ids.append(super_admin_role.id)

        # Two isolated departments: Dept A (Operations) and Dept B (Sales)
        dept_ops = Role(name=f"TV_Ops_{tag}", code=f"TVO{tag[:4]}", is_system=False)
        dept_sales = Role(name=f"TV_Sales_{tag}", code=f"TVS{tag[:4]}", is_system=False)
        # Read-only department viewer role (`task.view` + `task.department_view` only, NO leadership, NO manage)
        dept_viewer_role = Role(name=f"TV_OpsViewer_{tag}", code=f"TVV{tag[:4]}", is_system=False)
        session.add_all([dept_ops, dept_sales, dept_viewer_role])
        await session.flush()
        created_role_ids.extend([dept_ops.id, dept_sales.id, dept_viewer_role.id])

        # Base permissions on department roles: task.view only (no dept_view or manage!)
        for r in (dept_ops, dept_sales):
            session.add(RolePermission(role_id=r.id, permission_id=perm_map["task.view"].id))
        session.add(RolePermission(role_id=dept_viewer_role.id, permission_id=perm_map["task.view"].id))
        session.add(RolePermission(role_id=dept_viewer_role.id, permission_id=perm_map["task.department_view"].id))
        await session.flush()

        def _make_user(suffix: str, display: str) -> User:
            u = User(
                username=f"tv_{suffix}_{tag}",
                email=f"tv_{suffix}_{tag}@inhyma.test",
                password_hash=pw_hash,
                display_name=display,
                first_name=display.split()[0],
                last_name=display.split()[-1],
                status=UserStatus.ACTIVE,
                is_active=True,
                has_login=True,
                employment_status=EmploymentStatus.ACTIVE,
                employment_type=EmploymentType.FULL_TIME,
            )
            session.add(u)
            return u

        u_admin = _make_user("admin", "TV Admin")
        u_ops_mgr = _make_user("ops_mgr", "TV OpsManager")
        u_ops_emp1 = _make_user("ops_emp1", "TV OpsEmpOne")
        u_ops_emp2 = _make_user("ops_emp2", "TV OpsEmpTwo")
        u_ops_viewer = _make_user("ops_viewer", "TV OpsViewer")
        u_ops_inactive_mgr = _make_user("ops_inact", "TV FormerMgr")
        u_sales_mgr = _make_user("sales_mgr", "TV SalesManager")
        u_sales_emp = _make_user("sales_emp", "TV SalesEmp")
        u_approved_candidate = _make_user("approved", "TV ApprovedUser")
        await session.flush()

        all_users = [
            u_admin,
            u_ops_mgr,
            u_ops_emp1,
            u_ops_emp2,
            u_ops_viewer,
            u_ops_inactive_mgr,
            u_sales_mgr,
            u_sales_emp,
            u_approved_candidate,
        ]
        created_user_ids.extend([u.id for u in all_users])

        # Assign roles
        role_links = [
            (u_admin, super_admin_role),
            (u_ops_mgr, dept_ops),
            (u_ops_emp1, dept_ops),
            (u_ops_emp2, dept_ops),
            (u_ops_viewer, dept_ops),
            (u_ops_viewer, dept_viewer_role),
            (u_ops_inactive_mgr, dept_ops),
            (u_sales_mgr, dept_sales),
            (u_sales_emp, dept_sales),
            (u_approved_candidate, dept_ops),
        ]
        for u, r in role_links:
            session.add(UserRole(user_id=u.id, role_id=r.id, status=RoleAssignmentStatus.ACTIVE))

        # Active Department Leadership for Ops Manager & Sales Manager; INACTIVE for Former Manager
        session.add_all([
            DepartmentLeadershipAssignment(
                department_id=dept_ops.id,
                employee_id=u_ops_mgr.id,
                leadership_type=LeadershipType.PRIMARY_MANAGER,
                status=OrgRecordStatus.ACTIVE,
            ),
            DepartmentLeadershipAssignment(
                department_id=dept_sales.id,
                employee_id=u_sales_mgr.id,
                leadership_type=LeadershipType.PRIMARY_MANAGER,
                status=OrgRecordStatus.ACTIVE,
            ),
            DepartmentLeadershipAssignment(
                department_id=dept_ops.id,
                employee_id=u_ops_inactive_mgr.id,
                leadership_type=LeadershipType.PRIMARY_MANAGER,
                status=OrgRecordStatus.INACTIVE,
            ),
        ])

        # Grant managers create/assign/department_view (NO task.manage!)
        for mgr in (u_ops_mgr, u_sales_mgr):
            for pcode in ("task.department_view", "task.create", "task.assign"):
                session.add(UserPermission(user_id=mgr.id, permission_id=perm_map[pcode].id, is_granted=True))

        # Grant ops_emp1 task.create so we can test dependency/parent IDOR vectors
        session.add(UserPermission(user_id=u_ops_emp1.id, permission_id=perm_map["task.create"].id, is_granted=True))

        # If legacy task.organization_view exists in DB, grant it to u_ops_emp2 to prove it is IGNORED
        if legacy_org_perm is not None:
            session.add(UserPermission(user_id=u_ops_emp2.id, permission_id=legacy_org_perm.id, is_granted=True))

        await session.flush()

        # Sprint shared across departments (verify sprint task_count scoping!)
        sprint = TaskSprint(name=f"TV_Sprint_{tag}", created_by=u_admin.id)
        session.add(sprint)
        await session.flush()
        created_sprint_ids.append(sprint.id)

        # Create tasks:
        # 1) t_ops_emp1: created by Admin, assigned ONLY to u_ops_emp1 (Ops)
        t_ops_emp1 = Task(
            title=f"OpsEmp1Task_{tag}",
            description=f"Confidential ops emp1 work {tag}",
            status=TaskStatus.IN_PROGRESS,
            priority=TaskPriority.HIGH,
            due_date=date.today() + timedelta(days=2),
            sprint_id=sprint.id,
            created_by=u_admin.id,
        )
        # 2) t_ops_emp2: created by u_ops_mgr, assigned ONLY to u_ops_emp2 (Ops peer)
        t_ops_emp2 = Task(
            title=f"OpsEmp2PeerTask_{tag}",
            description=f"Confidential ops emp2 peer work {tag}",
            status=TaskStatus.TODO,
            priority=TaskPriority.MEDIUM,
            due_date=date.today() + timedelta(days=3),
            sprint_id=sprint.id,
            created_by=u_ops_mgr.id,
        )
        # 3) t_sales_secret: created by u_sales_mgr, assigned ONLY to u_sales_emp (Foreign dept!)
        t_sales_secret = Task(
            title=f"SalesSecretTask_{tag}",
            description=f"Top secret sales pipeline {tag}",
            status=TaskStatus.TODO,
            priority=TaskPriority.CRITICAL,
            due_date=date.today() + timedelta(days=1),
            sprint_id=sprint.id,
            created_by=u_sales_mgr.id,
        )
        session.add_all([t_ops_emp1, t_ops_emp2, t_sales_secret])
        await session.flush()
        created_task_ids.extend([t_ops_emp1.id, t_ops_emp2.id, t_sales_secret.id])

        session.add_all([
            TaskAssignee(task_id=t_ops_emp1.id, user_id=u_ops_emp1.id, assignment_role="ASSIGNEE"),
            TaskAssignee(task_id=t_ops_emp2.id, user_id=u_ops_emp2.id, assignment_role="ASSIGNEE"),
            TaskAssignee(task_id=t_sales_secret.id, user_id=u_sales_emp.id, assignment_role="ASSIGNEE"),
        ])

        # Attachment, Comment, Subtask + Subtask Attachment/Comment on foreign Sales task
        sales_att = TaskAttachment(
            task_id=t_sales_secret.id,
            uploaded_by=u_sales_mgr.id,
            file_name="sales_secret.pdf",
            file_url="/uploads/tasks/sales_secret.pdf",
            file_size=1234,
            file_type="application/pdf",
        )
        sales_cmt = TaskComment(
            task_id=t_sales_secret.id,
            user_id=u_sales_mgr.id,
            message="Confidential sales discussion",
        )
        sales_sub = TaskSubtask(
            task_id=t_sales_secret.id,
            title="Confidential sales subtask",
            status="TODO",
            priority="HIGH",
        )
        session.add_all([sales_att, sales_cmt, sales_sub])
        await session.flush()

        sales_sub_att = TaskSubtaskAttachment(
            subtask_id=sales_sub.id,
            uploaded_by=u_sales_mgr.id,
            file_name="sub_secret.pdf",
            file_url="/uploads/tasks/sub_secret.pdf",
            file_size=512,
            file_type="application/pdf",
        )
        sales_sub_cmt = TaskSubtaskComment(
            subtask_id=sales_sub.id,
            user_id=u_sales_mgr.id,
            message="Confidential subtask note",
        )
        session.add_all([sales_sub_att, sales_sub_cmt])

        # Recurring schedules & instances: one in Ops (assigned to u_ops_emp1), one in Sales (assigned to u_sales_emp)
        sch_ops = TaskRecurringSchedule(
            title=f"OpsRecurring_{tag}",
            department=dept_ops.name,
            assignee_id=u_ops_emp1.id,
            manager_id=u_ops_mgr.id,
            created_by=u_ops_mgr.id,
            priority=TaskPriority.MEDIUM,
            frequency="MONTHLY",
            recurrence_config={"day_of_month": 15},
            status="ACTIVE",
            effective_start_date=date.today(),
        )
        sch_sales = TaskRecurringSchedule(
            title=f"SalesRecurring_{tag}",
            department=dept_sales.name,
            assignee_id=u_sales_emp.id,
            manager_id=u_sales_mgr.id,
            created_by=u_sales_mgr.id,
            priority=TaskPriority.HIGH,
            frequency="MONTHLY",
            recurrence_config={"day_of_month": 20},
            status="ACTIVE",
            effective_start_date=date.today(),
        )
        session.add_all([sch_ops, sch_sales])
        await session.flush()
        created_schedule_ids.extend([sch_ops.id, sch_sales.id])

        t_rec_ops = Task(
            title=f"OpsRecurringInst_{tag}",
            status=TaskStatus.TODO,
            priority=TaskPriority.MEDIUM,
            due_date=date.today() + timedelta(days=5),
            created_by=u_ops_mgr.id,
            recurring_schedule_id=sch_ops.id,
            recurrence_period=f"2026-11-{tag}",
        )
        t_rec_sales = Task(
            title=f"SalesRecurringInst_{tag}",
            status=TaskStatus.TODO,
            priority=TaskPriority.HIGH,
            due_date=date.today() + timedelta(days=5),
            created_by=u_sales_mgr.id,
            recurring_schedule_id=sch_sales.id,
            recurrence_period=f"2026-11-{tag}",
        )
        session.add_all([t_rec_ops, t_rec_sales])
        await session.flush()
        created_task_ids.extend([t_rec_ops.id, t_rec_sales.id])
        session.add_all([
            TaskAssignee(task_id=t_rec_ops.id, user_id=u_ops_emp1.id, assignment_role="ASSIGNEE"),
            TaskAssignee(task_id=t_rec_sales.id, user_id=u_sales_emp.id, assignment_role="ASSIGNEE"),
        ])

        await session.commit()

    def _auth_header(u: User) -> dict[str, str]:
        tok = create_access_token(u.id).token
        return {"Authorization": f"Bearer {tok}"}

    app = create_application()
    transport = ASGITransport(app=app)

    env = {
        "tag": tag,
        "transport": transport,
        "SessionFactory": SessionFactory,
        "perm_map": {k: v.id for k, v in perm_map.items()},
        "has_legacy_org_perm": legacy_org_perm is not None,
        "legacy_org_perm_id": legacy_org_perm.id if legacy_org_perm is not None else None,
        "dept_ops": dept_ops,
        "dept_sales": dept_sales,
        "u_admin": u_admin,
        "u_ops_mgr": u_ops_mgr,
        "u_ops_emp1": u_ops_emp1,
        "u_ops_emp2": u_ops_emp2,
        "u_ops_viewer": u_ops_viewer,
        "u_ops_inactive_mgr": u_ops_inactive_mgr,
        "u_sales_mgr": u_sales_mgr,
        "u_sales_emp": u_sales_emp,
        "u_approved": u_approved_candidate,
        "t_ops_emp1": t_ops_emp1,
        "t_ops_emp2": t_ops_emp2,
        "t_sales_secret": t_sales_secret,
        "t_rec_ops": t_rec_ops,
        "t_rec_sales": t_rec_sales,
        "sch_ops": sch_ops,
        "sch_sales": sch_sales,
        "sales_att": sales_att,
        "sales_cmt": sales_cmt,
        "sales_sub": sales_sub,
        "sprint": sprint,
        "headers": {
            "admin": _auth_header(u_admin),
            "ops_mgr": _auth_header(u_ops_mgr),
            "ops_emp1": _auth_header(u_ops_emp1),
            "ops_emp2": _auth_header(u_ops_emp2),
            "ops_viewer": _auth_header(u_ops_viewer),
            "ops_inactive_mgr": _auth_header(u_ops_inactive_mgr),
            "sales_mgr": _auth_header(u_sales_mgr),
            "sales_emp": _auth_header(u_sales_emp),
            "approved": _auth_header(u_approved_candidate),
        },
        "created_task_ids": created_task_ids,
    }

    try:
        yield env
    finally:
        async with SessionFactory() as clean_sess:
            if created_task_ids:
                await clean_sess.execute(delete(Task).where(Task.id.in_(created_task_ids)))
            if created_schedule_ids:
                await clean_sess.execute(delete(TaskRecurringSchedule).where(TaskRecurringSchedule.id.in_(created_schedule_ids)))
            if created_sprint_ids:
                await clean_sess.execute(delete(TaskSprint).where(TaskSprint.id.in_(created_sprint_ids)))
            if created_user_ids:
                await clean_sess.execute(delete(DepartmentLeadershipAssignment).where(DepartmentLeadershipAssignment.employee_id.in_(created_user_ids)))
                await clean_sess.execute(delete(UserPermission).where(UserPermission.user_id.in_(created_user_ids)))
                await clean_sess.execute(delete(UserRole).where(UserRole.user_id.in_(created_user_ids)))
                await clean_sess.execute(delete(User).where(User.id.in_(created_user_ids)))
            if created_role_ids:
                await clean_sess.execute(delete(RolePermission).where(RolePermission.role_id.in_(created_role_ids)))
                await clean_sess.execute(delete(Role).where(Role.id.in_(created_role_ids)))
            await clean_sess.commit()

        await engine.dispose()
        await engine_module.dispose_engine()
        os.environ["DATABASE_URL"] = prev_db_url
        object.__setattr__(settings, "DATABASE_URL", prev_db_url)


@pytest.mark.asyncio
async def test_employee_sees_own_tasks_only_and_is_blocked_from_peer_dept_and_org_data(pg_tasks_env):
    env = pg_tasks_env
    h_emp1 = env["headers"]["ops_emp1"]
    h_emp2 = env["headers"]["ops_emp2"]
    tag = env["tag"]

    async with AsyncClient(transport=env["transport"], base_url="http://test") as client:
        # 1. Own task list across my, all, kanban, calendar, backlog
        for query in [
            f"/api/v1/tasks?view=my&search={tag}",
            f"/api/v1/tasks?view=all&search={tag}",
            f"/api/v1/tasks?view=kanban&search={tag}",
            f"/api/v1/tasks?view=calendar&search={tag}",
        ]:
            res = await client.get(query, headers=h_emp1)
            assert res.status_code == 200, res.text
            ids = {item["id"] for item in res.json()["data"]["items"]}
            assert str(env["t_ops_emp1"].id) in ids
            assert str(env["t_ops_emp2"].id) not in ids  # Same-dept peer hidden!
            assert str(env["t_sales_secret"].id) not in ids  # Foreign-dept hidden!

        # 2. Employee cannot access view=department, view=organization, or department_id filter
        assert (await client.get("/api/v1/tasks?view=department", headers=h_emp1)).status_code == 403
        assert (await client.get("/api/v1/tasks?view=organization", headers=h_emp1)).status_code == 403
        assert (
            await client.get(f"/api/v1/tasks?department_id={env['dept_ops'].id}", headers=h_emp1)
        ).status_code == 403
        assert (
            await client.get(f"/api/v1/tasks?department_id={env['dept_sales'].id}", headers=h_emp1)
        ).status_code == 403

        # 3. Employee cannot view peer or foreign task via direct ID / sub-resources
        for target_id in (env["t_ops_emp2"].id, env["t_sales_secret"].id):
            assert (await client.get(f"/api/v1/tasks/{target_id}", headers=h_emp1)).status_code == 403
            assert (await client.get(f"/api/v1/tasks/{target_id}/timeline", headers=h_emp1)).status_code == 403
            assert (
                await client.post(f"/api/v1/tasks/{target_id}/comment", headers=h_emp1, json={"message": "probe"})
            ).status_code == 403
            assert (
                await client.patch(f"/api/v1/tasks/{target_id}", headers=h_emp1, json={"title": "hijack"})
            ).status_code == 403

        # Foreign attachment, comment reaction, subtask attachment/comment, dependency & parent IDOR
        assert (
            await client.delete(f"/api/v1/tasks/attachments/{env['sales_att'].id}", headers=h_emp1)
        ).status_code == 403
        assert (
            await client.post(
                f"/api/v1/tasks/comments/{env['sales_cmt'].id}/reactions",
                headers=h_emp1,
                json={"emoji": "👍"},
            )
        ).status_code == 403
        assert (
            await client.get(f"/api/v1/tasks/subtasks/{env['sales_sub'].id}/attachments", headers=h_emp1)
        ).status_code == 403
        assert (
            await client.get(f"/api/v1/tasks/subtasks/{env['sales_sub'].id}/comments", headers=h_emp1)
        ).status_code == 403
        assert (
            await client.post(
                f"/api/v1/tasks/{env['t_ops_emp1'].id}/dependencies",
                headers=h_emp1,
                json={"depends_on_task_id": str(env["t_sales_secret"].id), "dependency_type": "BLOCKED_BY"},
            )
        ).status_code == 403
        assert (
            await client.post(
                "/api/v1/tasks",
                headers=h_emp1,
                json={"title": "Probe Child", "parent_task_id": str(env["t_sales_secret"].id)},
            )
        ).status_code == 403

        # 4. Departments list is empty for Employee; workload/capacity scoped to self only
        dept_res = await client.get("/api/v1/tasks/departments", headers=h_emp1)
        assert dept_res.status_code == 200
        assert dept_res.json()["data"] == []

        wl_res = await client.get("/api/v1/tasks/workload", headers=h_emp1)
        assert wl_res.status_code == 200
        wl_uids = {u["user_id"] for u in wl_res.json()["data"]["users"]}
        assert wl_uids == {str(env["u_ops_emp1"].id)}
        assert (
            await client.get(f"/api/v1/tasks/workload?department_id={env['dept_ops'].id}", headers=h_emp1)
        ).status_code == 403
        assert (
            await client.get(
                f"/api/v1/tasks/capacity?start_date={date.today()}&end_date={date.today() + timedelta(days=3)}&department_id={env['dept_ops'].id}",
                headers=h_emp1,
            )
        ).status_code == 403

        # 5. Recurring schedules & instances strictly scoped to Employee's own assignments
        rec_sch = await client.get("/api/v1/tasks/recurring/schedules", headers=h_emp1)
        assert rec_sch.status_code == 200
        rec_sch_ids = {s["id"] for s in rec_sch.json()["data"]}
        assert str(env["sch_ops"].id) in rec_sch_ids
        assert str(env["sch_sales"].id) not in rec_sch_ids
        assert (await client.get(f"/api/v1/tasks/recurring/schedules/{env['sch_sales'].id}", headers=h_emp1)).status_code == 403

        rec_inst = await client.get("/api/v1/tasks/recurring/instances", headers=h_emp1)
        assert rec_inst.status_code == 200
        rec_inst_ids = {t["id"] for t in rec_inst.json()["data"]}
        assert str(env["t_rec_ops"].id) in rec_inst_ids
        assert str(env["t_rec_sales"].id) not in rec_inst_ids

        # 6. Sprint counts do NOT leak peer or foreign-department tasks
        spr_res = await client.get("/api/v1/tasks/sprints", headers=h_emp1)
        assert spr_res.status_code == 200
        our_sprint = next(s for s in spr_res.json()["data"] if s["id"] == str(env["sprint"].id))
        assert our_sprint["task_count"] == 1  # Only t_ops_emp1!

        # 7. Even if legacy `task.organization_view` exists on emp2, it grants ZERO elevated access!
        emp2_list = await client.get(f"/api/v1/tasks?view=all&search={tag}", headers=h_emp2)
        assert emp2_list.status_code == 200
        emp2_ids = {item["id"] for item in emp2_list.json()["data"]["items"]}
        assert str(env["t_ops_emp2"].id) in emp2_ids
        assert str(env["t_ops_emp1"].id) not in emp2_ids
        assert str(env["t_sales_secret"].id) not in emp2_ids
        assert (await client.get(f"/api/v1/tasks/{env['t_sales_secret'].id}", headers=h_emp2)).status_code == 403
        assert (
            await client.patch(f"/api/v1/tasks/{env['t_sales_secret'].id}", headers=h_emp2, json={"title": "nope"})
        ).status_code == 403


@pytest.mark.asyncio
async def test_department_manager_and_read_only_dept_viewer_and_inactive_manager_boundaries(pg_tasks_env):
    env = pg_tasks_env
    h_ops_mgr = env["headers"]["ops_mgr"]
    h_ops_viewer = env["headers"]["ops_viewer"]
    h_inactive = env["headers"]["ops_inactive_mgr"]
    tag = env["tag"]

    async with AsyncClient(transport=env["transport"], base_url="http://test") as client:
        # 1. Ops Manager in Department view sees ALL Ops tasks (both emp1 and emp2), ZERO Sales tasks
        dept_res = await client.get(f"/api/v1/tasks?view=department&search={tag}", headers=h_ops_mgr)
        assert dept_res.status_code == 200, dept_res.text
        dept_ids = {item["id"] for item in dept_res.json()["data"]["items"]}
        assert str(env["t_ops_emp1"].id) in dept_ids
        assert str(env["t_ops_emp2"].id) in dept_ids
        assert str(env["t_sales_secret"].id) not in dept_ids

        # 2. Ops Manager in My Tasks view sees only own tasks (t_ops_emp2 created by mgr, NOT t_ops_emp1 created by admin for emp1)
        my_res = await client.get(f"/api/v1/tasks?view=my&search={tag}", headers=h_ops_mgr)
        assert my_res.status_code == 200
        my_ids = {item["id"] for item in my_res.json()["data"]["items"]}
        assert str(env["t_ops_emp2"].id) in my_ids
        assert str(env["t_ops_emp1"].id) not in my_ids
        assert str(env["t_sales_secret"].id) not in my_ids

        # 3. Ops Manager cannot bypass into Sales department via filters, search, assignee_id, organization, or direct IDs
        assert (
            await client.get(f"/api/v1/tasks?department_id={env['dept_sales'].id}", headers=h_ops_mgr)
        ).status_code == 403
        assert (await client.get("/api/v1/tasks?view=organization", headers=h_ops_mgr)).status_code == 403

        bypass_search = await client.get(
            f"/api/v1/tasks?view=all&search=SalesSecretTask_{tag}&assignee_id={env['u_sales_emp'].id}",
            headers=h_ops_mgr,
        )
        assert bypass_search.status_code == 200
        assert bypass_search.json()["data"]["items"] == []

        assert (await client.get(f"/api/v1/tasks/{env['t_sales_secret'].id}", headers=h_ops_mgr)).status_code == 403
        assert (await client.get(f"/api/v1/tasks/{env['t_sales_secret'].id}/timeline", headers=h_ops_mgr)).status_code == 403
        assert (await client.delete(f"/api/v1/tasks/attachments/{env['sales_att'].id}", headers=h_ops_mgr)).status_code == 403
        assert (await client.get(f"/api/v1/tasks/workload?department_id={env['dept_sales'].id}", headers=h_ops_mgr)).status_code == 403
        assert (
            await client.get(
                f"/api/v1/tasks/recurring/schedules/{env['sch_sales'].id}", headers=h_ops_mgr
            )
        ).status_code == 403
        assert (
            await client.get(
                f"/api/v1/tasks/recurring/schedules?department={env['dept_sales'].name}", headers=h_ops_mgr
            )
        ).status_code == 403

        # Ops Manager `/tasks/departments` returns ONLY TV_Ops
        mgr_depts = (await client.get("/api/v1/tasks/departments", headers=h_ops_mgr)).json()["data"]
        assert [d["id"] for d in mgr_depts] == [str(env["dept_ops"].id)]

        # Sprint count for Ops Manager reflects ONLY Ops tasks (t_ops_emp1 + t_ops_emp2 = 2, NOT Sales!)
        spr_res = await client.get("/api/v1/tasks/sprints", headers=h_ops_mgr)
        our_sprint = next(s for s in spr_res.json()["data"] if s["id"] == str(env["sprint"].id))
        assert our_sprint["task_count"] == 2

        # 4. Viewing vs Modification separation: user with ONLY `task.view` + `task.department_view`
        # CAN view Ops department tasks, CANNOT view Sales tasks, CANNOT mutate Ops peer tasks!
        viewer_get_ops = await client.get(f"/api/v1/tasks/{env['t_ops_emp1'].id}", headers=h_ops_viewer)
        assert viewer_get_ops.status_code == 200
        viewer_get_sales = await client.get(f"/api/v1/tasks/{env['t_sales_secret'].id}", headers=h_ops_viewer)
        assert viewer_get_sales.status_code == 403
        viewer_mutate_ops = await client.patch(
            f"/api/v1/tasks/{env['t_ops_emp1'].id}",
            headers=h_ops_viewer,
            json={"title": "Viewer Must Not Edit"},
        )
        assert viewer_mutate_ops.status_code == 403

        # 5. Inactive former manager CANNOT view or mutate former department's tasks!
        assert (await client.get("/api/v1/tasks?view=department", headers=h_inactive)).status_code == 403
        assert (await client.get(f"/api/v1/tasks/{env['t_ops_emp1'].id}", headers=h_inactive)).status_code == 403
        assert (
            await client.patch(f"/api/v1/tasks/{env['t_ops_emp1'].id}", headers=h_inactive, json={"title": "Stale"})
        ).status_code == 403


@pytest.mark.asyncio
async def test_admin_and_admin_approved_user_lifecycle_and_self_elevation_blocked(pg_tasks_env):
    env = pg_tasks_env
    h_admin = env["headers"]["admin"]
    h_approved = env["headers"]["approved"]
    u_approved = env["u_approved"]
    task_manage_perm_id = env["perm_map"]["task.manage"]
    tag = env["tag"]

    async with AsyncClient(transport=env["transport"], base_url="http://test") as client:
        # 1. Admin sees tasks across ALL departments by default (`view=all`) and can filter by department
        admin_all = await client.get(f"/api/v1/tasks?view=all&search={tag}", headers=h_admin)
        assert admin_all.status_code == 200
        admin_ids = {item["id"] for item in admin_all.json()["data"]["items"]}
        assert {str(env["t_ops_emp1"].id), str(env["t_ops_emp2"].id), str(env["t_sales_secret"].id)}.issubset(admin_ids)

        admin_sales_only = await client.get(
            f"/api/v1/tasks?view=all&department_id={env['dept_sales'].id}&search={tag}",
            headers=h_admin,
        )
        assert admin_sales_only.status_code == 200
        sales_only_ids = {item["id"] for item in admin_sales_only.json()["data"]["items"]}
        assert str(env["t_sales_secret"].id) in sales_only_ids
        assert str(env["t_ops_emp1"].id) not in sales_only_ids

        # 2. Candidate user BEFORE Admin approval: Employee scope only; cannot self-grant `task.manage`!
        before_res = await client.get(f"/api/v1/tasks?view=all&search={tag}", headers=h_approved)
        assert before_res.status_code == 200
        assert before_res.json()["data"]["items"] == []
        assert (await client.get(f"/api/v1/tasks/{env['t_sales_secret'].id}", headers=h_approved)).status_code == 403

        self_grant = await client.post(
            f"/api/v1/rbac/users/{u_approved.id}/permissions",
            headers=h_approved,
            json={"permission_id": str(task_manage_perm_id), "is_granted": True},
        )
        assert self_grant.status_code == 403

        # 3. Admin explicitly grants `task.manage` via existing RBAC user permission override
        grant_res = await client.post(
            f"/api/v1/rbac/users/{u_approved.id}/permissions",
            headers=h_admin,
            json={"permission_id": str(task_manage_perm_id), "is_granted": True},
        )
        assert grant_res.status_code == 200, grant_res.text

        # Admin-approved user now sees ALL tasks across ALL departments, departments list, and recurring schedules
        approved_all = await client.get(f"/api/v1/tasks?view=all&search={tag}", headers=h_approved)
        assert approved_all.status_code == 200
        approved_ids = {item["id"] for item in approved_all.json()["data"]["items"]}
        assert {str(env["t_ops_emp1"].id), str(env["t_ops_emp2"].id), str(env["t_sales_secret"].id)}.issubset(approved_ids)

        assert (await client.get(f"/api/v1/tasks/{env['t_sales_secret'].id}", headers=h_approved)).status_code == 200
        approved_depts = {d["id"] for d in (await client.get("/api/v1/tasks/departments", headers=h_approved)).json()["data"]}
        assert {str(env["dept_ops"].id), str(env["dept_sales"].id)}.issubset(approved_depts)
        approved_rec = {s["id"] for s in (await client.get("/api/v1/tasks/recurring/schedules", headers=h_approved)).json()["data"]}
        assert {str(env["sch_ops"].id), str(env["sch_sales"].id)}.issubset(approved_rec)

        # 4. Admin removes elevated authorization -> access is IMMEDIATELY revoked!
        revoke_res = await client.delete(
            f"/api/v1/rbac/users/{u_approved.id}/permissions/{task_manage_perm_id}",
            headers=h_admin,
        )
        assert revoke_res.status_code == 200, revoke_res.text

        after_revoke_list = await client.get(f"/api/v1/tasks?view=all&search={tag}", headers=h_approved)
        assert after_revoke_list.status_code == 200
        assert after_revoke_list.json()["data"]["items"] == []
        assert (await client.get(f"/api/v1/tasks/{env['t_sales_secret'].id}", headers=h_approved)).status_code == 403
        assert (await client.get("/api/v1/tasks?view=department", headers=h_approved)).status_code == 403
        assert (await client.get("/api/v1/tasks/departments", headers=h_approved)).json()["data"] == []


@pytest.mark.asyncio
async def test_phase2c_rbac_catalog_hides_and_blocks_obsolete_org_view_and_enforces_readonly_task_all_view(
    pg_tasks_env,
):
    """
    Phase 2C security contract:
    - Obsolete `task.organization_view` is hidden from `/rbac/permissions`, role permissions,
      user override listings, and effective-permission breakdowns (without deleting legacy DB rows).
    - Newly granting `task.organization_view` via user override, bulk override, role grant, or
      role creation is rejected with 422.
    - Dedicated `task.all_view` grants read-only all-department visibility WITHOUT granting
      `task.manage` or any write/mutation capability, and revocation takes effect immediately.
    """
    env = pg_tasks_env
    h_admin = env["headers"]["admin"]
    h_approved = env["headers"]["approved"]
    u_approved = env["u_approved"]
    u_emp2 = env["u_ops_emp2"]
    tag = env["tag"]
    task_all_view_perm_id = env["perm_map"]["task.all_view"]
    legacy_org_perm_id = env["legacy_org_perm_id"]

    async with AsyncClient(transport=env["transport"], base_url="http://test") as client:
        # 1. Permission catalog exposes `task.all_view` and strictly omits `task.organization_view`
        perms_res = await client.get("/api/v1/rbac/permissions", headers=h_admin)
        assert perms_res.status_code == 200, perms_res.text
        catalog_codes = {p["code"] for p in perms_res.json()["data"]}
        assert "task.all_view" in catalog_codes
        assert "task.department_view" in catalog_codes
        assert "task.manage" in catalog_codes
        assert "task.organization_view" not in catalog_codes

        # 2. Even if u_ops_emp2 has a legacy DB override for `task.organization_view`,
        #    user overrides & effective breakdown omit it, AND new grants are rejected (422)
        emp2_overrides = await client.get(f"/api/v1/rbac/users/{u_emp2.id}/permissions", headers=h_admin)
        assert emp2_overrides.status_code == 200
        assert "task.organization_view" not in {o["code"] for o in emp2_overrides.json()["data"]}

        emp2_eff = await client.get(f"/api/v1/rbac/users/{u_emp2.id}/effective-permissions", headers=h_admin)
        assert emp2_eff.status_code == 200
        eff_data = emp2_eff.json()["data"]
        assert "task.organization_view" not in eff_data["effective_permissions"]
        assert "task.organization_view" not in eff_data["user_grants"]

        create_role_obsolete = await client.post(
            "/api/v1/rbac/roles",
            headers=h_admin,
            json={
                "name": f"ObsoleteRole_{tag}",
                "description": "Should fail",
                "permission_codes": ["task.view", "task.organization_view"],
            },
        )
        assert create_role_obsolete.status_code == 422

        if legacy_org_perm_id is not None:
            single_grant_obsolete = await client.post(
                f"/api/v1/rbac/users/{u_approved.id}/permissions",
                headers=h_admin,
                json={"permission_id": str(legacy_org_perm_id), "is_granted": True},
            )
            assert single_grant_obsolete.status_code == 422

            bulk_grant_obsolete = await client.put(
                f"/api/v1/rbac/users/{u_approved.id}/permissions/bulk",
                headers=h_admin,
                json={"overrides": [{"permission_id": str(legacy_org_perm_id), "is_granted": True}]},
            )
            assert bulk_grant_obsolete.status_code == 422

            role_grant_obsolete = await client.post(
                f"/api/v1/rbac/roles/{env['dept_ops'].id}/permissions",
                headers=h_admin,
                json={"permission_id": str(legacy_org_perm_id)},
            )
            assert role_grant_obsolete.status_code == 422

        # 3. Ordinary user CANNOT self-grant `task.all_view`
        self_grant_all = await client.post(
            f"/api/v1/rbac/users/{u_approved.id}/permissions",
            headers=h_approved,
            json={"permission_id": str(task_all_view_perm_id), "is_granted": True},
        )
        assert self_grant_all.status_code == 403

        # 4. Admin grants ONLY `task.all_view` (NOT `task.manage`)
        grant_all_res = await client.post(
            f"/api/v1/rbac/users/{u_approved.id}/permissions",
            headers=h_admin,
            json={"permission_id": str(task_all_view_perm_id), "is_granted": True},
        )
        assert grant_all_res.status_code == 200, grant_all_res.text

        # Verify effective permissions include `task.all_view` and DO NOT auto-grant `task.manage`
        approved_eff = await client.get(f"/api/v1/rbac/users/{u_approved.id}/effective-permissions", headers=h_admin)
        assert approved_eff.status_code == 200
        approved_eff_perms = set(approved_eff.json()["data"]["effective_permissions"])
        assert "task.all_view" in approved_eff_perms
        assert "task.manage" not in approved_eff_perms

        # 5. All-department READ access works across all endpoints & department filtering
        all_tasks_res = await client.get(f"/api/v1/tasks?view=all&search={tag}", headers=h_approved)
        assert all_tasks_res.status_code == 200
        all_ids = {item["id"] for item in all_tasks_res.json()["data"]["items"]}
        assert {
            str(env["t_ops_emp1"].id),
            str(env["t_ops_emp2"].id),
            str(env["t_sales_secret"].id),
        }.issubset(all_ids)

        sales_only_res = await client.get(
            f"/api/v1/tasks?view=all&department_id={env['dept_sales'].id}&search={tag}",
            headers=h_approved,
        )
        assert sales_only_res.status_code == 200
        sales_only_ids = {item["id"] for item in sales_only_res.json()["data"]["items"]}
        assert str(env["t_sales_secret"].id) in sales_only_ids
        assert str(env["t_ops_emp1"].id) not in sales_only_ids

        # Direct task read, departments, workload, capacity, sprints, recurring schedules & instances
        assert (await client.get(f"/api/v1/tasks/{env['t_sales_secret'].id}", headers=h_approved)).status_code == 200
        approved_depts = {
            d["id"] for d in (await client.get("/api/v1/tasks/departments", headers=h_approved)).json()["data"]
        }
        assert {str(env["dept_ops"].id), str(env["dept_sales"].id)}.issubset(approved_depts)

        workload_res = await client.get(
            f"/api/v1/tasks/workload?department_id={env['dept_sales'].id}", headers=h_approved
        )
        assert workload_res.status_code == 200
        cap_res = await client.get(
            f"/api/v1/tasks/capacity?start_date={date.today().isoformat()}&end_date={(date.today() + timedelta(days=7)).isoformat()}&department_id={env['dept_sales'].id}",
            headers=h_approved,
        )
        assert cap_res.status_code == 200
        sprints_res = await client.get("/api/v1/tasks/sprints", headers=h_approved)
        assert sprints_res.status_code == 200
        our_sprint = next(s for s in sprints_res.json()["data"] if s["id"] == str(env["sprint"].id))
        assert our_sprint["task_count"] == 3

        rec_list = await client.get("/api/v1/tasks/recurring/schedules", headers=h_approved)
        assert rec_list.status_code == 200
        assert {str(env["sch_ops"].id), str(env["sch_sales"].id)}.issubset(
            {s["id"] for s in rec_list.json()["data"]}
        )

        # 6. Read-only enforcement: `task.all_view` MUST NOT grant create/update/delete/assign/escalate/bulk/recurring mutations
        assert (
            await client.post("/api/v1/tasks", headers=h_approved, json={"title": f"BlockedCreate_{tag}"})
        ).status_code == 403
        assert (
            await client.patch(
                f"/api/v1/tasks/{env['t_sales_secret'].id}",
                headers=h_approved,
                json={"title": "Attempted Mutation"},
            )
        ).status_code == 403
        assert (
            await client.delete(f"/api/v1/tasks/{env['t_sales_secret'].id}", headers=h_approved)
        ).status_code == 403
        assert (
            await client.post(
                f"/api/v1/tasks/{env['t_sales_secret'].id}/assign",
                headers=h_approved,
                json={"user_ids": [str(u_approved.id)]},
            )
        ).status_code == 403
        assert (
            await client.post(
                f"/api/v1/tasks/{env['t_sales_secret'].id}/escalate",
                headers=h_approved,
                json={"to_user": str(env["u_admin"].id), "reason": "Unauthorized escalation"},
            )
        ).status_code == 403
        assert (
            await client.post(
                f"/api/v1/tasks/{env['t_sales_secret'].id}/attachments",
                headers=h_approved,
                json={"file_name": "x.pdf", "file_url": "/uploads/tasks/x.pdf"},
            )
        ).status_code == 403
        assert (
            await client.delete(
                f"/api/v1/tasks/attachments/{env['sales_att'].id}", headers=h_approved
            )
        ).status_code == 403
        assert (
            await client.post(
                f"/api/v1/tasks/{env['t_sales_secret'].id}/subtasks",
                headers=h_approved,
                json={"title": "Unauthorized Subtask"},
            )
        ).status_code == 403
        assert (
            await client.post(
                "/api/v1/tasks/bulk-action",
                headers=h_approved,
                json={"task_ids": [str(env["t_sales_secret"].id)], "action": "UPDATE_STATUS", "status": "DONE"},
            )
        ).status_code == 403
        assert (
            await client.patch(
                f"/api/v1/tasks/recurring/schedules/{env['sch_sales'].id}",
                headers=h_approved,
                json={"title": "Unauthorized Recurring Edit"},
            )
        ).status_code == 403

        # 7. Revoke `task.all_view` -> immediate access removal on the very next request
        revoke_all_res = await client.delete(
            f"/api/v1/rbac/users/{u_approved.id}/permissions/{task_all_view_perm_id}",
            headers=h_admin,
        )
        assert revoke_all_res.status_code == 200, revoke_all_res.text

        post_revoke_list = await client.get(f"/api/v1/tasks?view=all&search={tag}", headers=h_approved)
        assert post_revoke_list.status_code == 200
        assert post_revoke_list.json()["data"]["items"] == []
        assert (await client.get(f"/api/v1/tasks/{env['t_sales_secret'].id}", headers=h_approved)).status_code == 403
        assert (await client.get("/api/v1/tasks/departments", headers=h_approved)).json()["data"] == []
        assert (
            await client.get(f"/api/v1/tasks/workload?department_id={env['dept_sales'].id}", headers=h_approved)
        ).status_code == 403
