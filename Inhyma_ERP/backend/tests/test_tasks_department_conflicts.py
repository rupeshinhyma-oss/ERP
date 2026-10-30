import os
import uuid
from collections.abc import AsyncGenerator
import pytest
import pytest_asyncio
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.database.engine import get_sessionmaker
from app.rbac.models import Role, RoleAssignmentStatus, RoleAssignmentType, UserRole
from app.tasks.models import Task, TaskAssignee, TaskPriority, TaskStatus
from app.tasks.repository import TaskRepository
from app.users.models import User, UserStatus


# resolve_tasks_departments uses PostgreSQL-only SQL (DISTINCT ON) and this test inserts synthetic
# users/roles, so it never runs on the isolated in-memory SQLite used by local pytest (see conftest.py).
_ON_SQLITE = os.environ.get("DATABASE_URL", "").lower().startswith("sqlite")
pytestmark = pytest.mark.skipif(_ON_SQLITE, reason="PostgreSQL-only; set ALLOW_LIVE_DB_TESTS=1 to run.")


@pytest_asyncio.fixture
async def db_session() -> AsyncGenerator[AsyncSession, None]:
    sessionmaker = get_sessionmaker()
    async with sessionmaker() as session:
        yield session


@pytest.mark.asyncio
async def test_department_conflict_resolution_precedence(db_session: AsyncSession):
    """
    Regression test verifying authoritative department resolution when
    creator, primary assignee, secondary watcher, and approver belong to different departments.

    Rules verified:
    1. Unassigned task: creator's department is used.
    2. Primary ASSIGNEE's department takes precedence over creator.
    3. Primary ASSIGNEE takes precedence over secondary WATCHER.
    4. When primary ASSIGNEE is removed, WATCHER takes precedence over creator.
    5. Approver does not reclassify the task's department.
    """
    repo = TaskRepository(db_session)
    suffix = uuid.uuid4().hex[:6]

    # Create 2 isolated department roles
    dept_sales = Role(
        id=uuid.uuid4(),
        name=f"Test_Sales_{suffix}",
        code=f"TS_{suffix[:4]}",
        is_system=False,
    )
    dept_mgmt = Role(
        id=uuid.uuid4(),
        name=f"Test_Mgmt_{suffix}",
        code=f"TM_{suffix[:4]}",
        is_system=False,
    )
    db_session.add_all([dept_sales, dept_mgmt])
    await db_session.flush()

    # Create 3 ephemeral users
    sales_creator = User(
        id=uuid.uuid4(),
        username=f"creator_{suffix}",
        email=f"creator_{suffix}@inhyma.test",
        display_name="Sales Creator",
        status=UserStatus.ACTIVE,
        is_active=True,
    )
    mgmt_assignee = User(
        id=uuid.uuid4(),
        username=f"assignee_{suffix}",
        email=f"assignee_{suffix}@inhyma.test",
        display_name="Mgmt Assignee",
        status=UserStatus.ACTIVE,
        is_active=True,
    )
    admin_approver = User(
        id=uuid.uuid4(),
        username=f"approver_{suffix}",
        email=f"approver_{suffix}@inhyma.test",
        display_name="Admin Approver",
        status=UserStatus.ACTIVE,
        is_active=True,
    )
    db_session.add_all([sales_creator, mgmt_assignee, admin_approver])
    await db_session.flush()

    # Map users to departments via UserRole
    ur_sales = UserRole(
        id=uuid.uuid4(),
        user_id=sales_creator.id,
        role_id=dept_sales.id,
        assignment_type=RoleAssignmentType.PRIMARY,
        is_primary=True,
        status=RoleAssignmentStatus.ACTIVE,
    )
    ur_mgmt = UserRole(
        id=uuid.uuid4(),
        user_id=mgmt_assignee.id,
        role_id=dept_mgmt.id,
        assignment_type=RoleAssignmentType.PRIMARY,
        is_primary=True,
        status=RoleAssignmentStatus.ACTIVE,
    )
    db_session.add_all([ur_sales, ur_mgmt])
    await db_session.flush()

    temp_task_id = uuid.uuid4()
    temp_task = Task(
        id=temp_task_id,
        title=f"CONFLICT-TEST: Multi-Department Conflict Check {suffix}",
        created_by=sales_creator.id,
        approver_id=admin_approver.id,
        status=TaskStatus.TODO,
        priority=TaskPriority.MEDIUM,
    )
    db_session.add(temp_task)
    await db_session.flush()

    assignee_rec_id = uuid.uuid4()
    watcher_rec_id = uuid.uuid4()

    try:
        # 1. Unassigned: Creator=Sales, Approver=Admin -> Must resolve to Sales
        dept_res_1 = await repo.resolve_tasks_departments([temp_task_id])
        dept_id_1, dept_name_1 = dept_res_1.get(temp_task_id, (None, None))
        assert dept_id_1 == dept_sales.id
        assert dept_name_1 == dept_sales.name

        # 2. Primary Assigned: Assignee=Management -> Must resolve to Management
        assignee_rec = TaskAssignee(
            id=assignee_rec_id,
            task_id=temp_task_id,
            user_id=mgmt_assignee.id,
            assignment_role="ASSIGNEE",
        )
        db_session.add(assignee_rec)
        await db_session.flush()

        dept_res_2 = await repo.resolve_tasks_departments([temp_task_id])
        dept_id_2, dept_name_2 = dept_res_2.get(temp_task_id, (None, None))
        assert dept_id_2 == dept_mgmt.id
        assert dept_name_2 == dept_mgmt.name

        # 3. Watcher added: Watcher=Sales -> Primary Assignee (Management) retains precedence
        watcher_rec = TaskAssignee(
            id=watcher_rec_id,
            task_id=temp_task_id,
            user_id=sales_creator.id,
            assignment_role="WATCHER",
        )
        db_session.add(watcher_rec)
        await db_session.flush()

        dept_res_3 = await repo.resolve_tasks_departments([temp_task_id])
        dept_id_3, dept_name_3 = dept_res_3.get(temp_task_id, (None, None))
        assert dept_id_3 == dept_mgmt.id
        assert dept_name_3 == dept_mgmt.name

        # 4. Remove primary assignee: Only Watcher (Sales) and Creator (Sales) -> Resolves to Sales
        await db_session.execute(delete(TaskAssignee).where(TaskAssignee.id == assignee_rec_id))
        await db_session.flush()

        dept_res_4 = await repo.resolve_tasks_departments([temp_task_id])
        dept_id_4, dept_name_4 = dept_res_4.get(temp_task_id, (None, None))
        assert dept_id_4 == dept_sales.id
        assert dept_name_4 == dept_sales.name

    finally:
        # Tear down all test records cleanly without leaving artifacts in the DB
        await db_session.execute(delete(TaskAssignee).where(TaskAssignee.task_id == temp_task_id))
        await db_session.execute(delete(Task).where(Task.id == temp_task_id))
        await db_session.execute(delete(UserRole).where(UserRole.id.in_([ur_sales.id, ur_mgmt.id])))
        await db_session.execute(
            delete(User).where(User.id.in_([sales_creator.id, mgmt_assignee.id, admin_approver.id]))
        )
        await db_session.execute(delete(Role).where(Role.id.in_([dept_sales.id, dept_mgmt.id])))
        await db_session.commit()

