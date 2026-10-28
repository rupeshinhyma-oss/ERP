import pytest
import uuid
from app.tasks.repository import TaskRepository
from app.tasks.models import Task, TaskAssignee, TaskStatus, TaskPriority
from app.users.models import User
from sqlalchemy import select, delete

@pytest.mark.asyncio
async def test_department_conflict_resolution_precedence(db_session):
    """
    Regression test verifying authoritative department resolution when
    creator, primary assignee, secondary watcher, and approver belong to different departments.
    Rules:
    1. Primary ASSIGNEE's department takes precedence.
    2. Watcher takes secondary precedence if no primary assignee.
    3. Creator's department takes tertiary precedence for unassigned tasks.
    4. Approver does not override or reclassify the task's department.
    """
    repo = TaskRepository(db_session)

    sales_emp = (await db_session.execute(select(User).where(User.email == "qa_sales_emp@inhyma.test"))).scalar_one_or_none()
    mgmt_user = (await db_session.execute(select(User).where(User.email == "userd@gmail.com"))).scalar_one_or_none()
    admin_user = (await db_session.execute(select(User).where(User.email == "admin@example.com"))).scalar_one_or_none()

    if not (sales_emp and mgmt_user and admin_user):
        pytest.skip("Required QA users not present in database.")

    temp_task_id = uuid.uuid4()
    temp_task = Task(
        id=temp_task_id,
        title="CONFLICT-TEST: Multi-Department Conflict Check",
        created_by=sales_emp.id,
        approver_id=admin_user.id,
        status=TaskStatus.TODO,
        priority=TaskPriority.MEDIUM,
    )
    db_session.add(temp_task)
    await db_session.flush()

    try:
        # 1. Unassigned: Creator=Sales, Approver=Admin -> Must resolve to Sales
        dept_res_1 = await repo.resolve_tasks_departments([temp_task_id])
        _, dept_name_1 = dept_res_1.get(temp_task_id, (None, None))
        assert dept_name_1 == "Sales"

        # 2. Primary Assigned: Assignee=Management -> Must resolve to Management
        assignee_rec = TaskAssignee(
            id=uuid.uuid4(),
            task_id=temp_task_id,
            user_id=mgmt_user.id,
            assignment_role="ASSIGNEE",
        )
        db_session.add(assignee_rec)
        await db_session.flush()

        dept_res_2 = await repo.resolve_tasks_departments([temp_task_id])
        _, dept_name_2 = dept_res_2.get(temp_task_id, (None, None))
        assert dept_name_2 == "Management"

        # 3. Watcher added: Watcher=Sales -> Primary Assignee (Management) retains precedence
        watcher_rec = TaskAssignee(
            id=uuid.uuid4(),
            task_id=temp_task_id,
            user_id=sales_emp.id,
            assignment_role="WATCHER",
        )
        db_session.add(watcher_rec)
        await db_session.flush()

        dept_res_3 = await repo.resolve_tasks_departments([temp_task_id])
        _, dept_name_3 = dept_res_3.get(temp_task_id, (None, None))
        assert dept_name_3 == "Management"

    finally:
        await db_session.execute(delete(TaskAssignee).where(TaskAssignee.task_id == temp_task_id))
        await db_session.execute(delete(Task).where(Task.id == temp_task_id))
        await db_session.commit()
