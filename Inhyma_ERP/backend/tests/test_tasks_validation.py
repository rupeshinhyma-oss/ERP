"""
Unit tests for Task date, parent, and sprint validations.
"""

import pytest
import uuid
from datetime import date, timedelta
from pydantic import ValidationError

from app.tasks.schemas import TaskCreate, TaskUpdate
from app.tasks.models import TaskPriority, TaskStatus, IssueType


def test_task_create_date_validation():
    today = date.today()
    yesterday = today - timedelta(days=1)
    tomorrow = today + timedelta(days=1)

    # Valid dates: due_date > start_date
    valid = TaskCreate(
        title="Valid Task",
        start_date=today,
        due_date=tomorrow,
    )
    assert valid.start_date == today
    assert valid.due_date == tomorrow

    # Valid dates: due_date == start_date
    same_day = TaskCreate(
        title="Same Day Task",
        start_date=today,
        due_date=today,
    )
    assert same_day.start_date == same_day.due_date

    # Invalid dates: due_date < start_date must raise ValidationError
    with pytest.raises(ValidationError) as exc_info:
        TaskCreate(
            title="Invalid Task",
            start_date=today,
            due_date=yesterday,
        )
    assert "Due date cannot be earlier than start date." in str(exc_info.value)


def test_task_update_date_validation():
    today = date.today()
    yesterday = today - timedelta(days=1)
    tomorrow = today + timedelta(days=1)

    # Valid update
    valid = TaskUpdate(
        start_date=today,
        due_date=tomorrow,
    )
    assert valid.due_date == tomorrow

    # Invalid update: due_date < start_date
    with pytest.raises(ValidationError) as exc_info:
        TaskUpdate(
            start_date=today,
            due_date=yesterday,
        )
    assert "Due date cannot be earlier than start date." in str(exc_info.value)


from unittest.mock import AsyncMock, MagicMock
from app.tasks.service import TaskService
from app.tasks.models import Task, TaskDependency, DependencyType
from app.core.exceptions import ValidationException, ForbiddenException
from app.auth.service import CurrentUser


@pytest.mark.asyncio
async def test_task_on_hold_empty_reason_validation():
    repo = MagicMock()
    repo.session = MagicMock()
    service = TaskService(
        repository=repo,
        audit_service=MagicMock(),
        notification_service=MagicMock(),
    )

    task_id = uuid.uuid4()
    creator_id = uuid.uuid4()
    mock_task = Task(
        id=task_id,
        title="Test Hold Task",
        status=TaskStatus.IN_PROGRESS,
        priority=TaskPriority.MEDIUM,
        created_by=creator_id,
        version=1,
    )
    mock_task.assignees = []
    mock_task.dependencies = []
    mock_task.dependent_on = []

    service.get_task = AsyncMock(return_value=mock_task)
    user_ctx = CurrentUser(id=creator_id, username="creator", permissions={"task.view"})

    # Empty hold reason should raise ValidationException
    with pytest.raises(ValidationException) as exc_info:
        await service.update_task(
            task_id,
            TaskUpdate(status=TaskStatus.ON_HOLD, hold_reason="   "),
            user_ctx,
        )
    assert "A valid, non-empty hold reason is required" in str(exc_info.value)


@pytest.mark.asyncio
async def test_task_escalate_sla_due_date_validation():
    repo = MagicMock()
    repo.session = MagicMock()
    service = TaskService(
        repository=repo,
        audit_service=MagicMock(),
        notification_service=MagicMock(),
    )

    task_id = uuid.uuid4()
    user_id = uuid.uuid4()
    target_user = uuid.uuid4()

    mock_task = Task(id=task_id, title="Test Task", created_by=user_id)
    service.get_task = AsyncMock(return_value=mock_task)
    user_ctx = CurrentUser(id=user_id, username="testuser", permissions={"task.view"})

    # Missing due_date should raise ValidationException
    with pytest.raises(ValidationException) as exc_info:
        await service.escalate_task(
            task_id=task_id,
            to_user=target_user,
            reason="Urgent blocker",
            current_user=user_ctx,
            due_date=None,
        )
    assert "SLA resolution due date is required" in str(exc_info.value)


@pytest.mark.asyncio
async def test_task_blocked_by_dependency_completion_prevention():
    repo = MagicMock()
    repo.session = MagicMock()
    service = TaskService(
        repository=repo,
        audit_service=MagicMock(),
        notification_service=MagicMock(),
    )

    task_id = uuid.uuid4()
    blocker_id = uuid.uuid4()
    creator_id = uuid.uuid4()

    mock_task = Task(
        id=task_id,
        title="Dependent Task",
        status=TaskStatus.IN_PROGRESS,
        priority=TaskPriority.MEDIUM,
        created_by=creator_id,
        version=1,
    )
    mock_task.assignees = []

    # Dep: this task is BLOCKED_BY blocker_id
    dep = TaskDependency(
        id=uuid.uuid4(),
        task_id=task_id,
        depends_on_task_id=blocker_id,
        dependency_type=DependencyType.BLOCKED_BY,
    )
    mock_task.dependencies = [dep]
    mock_task.dependent_on = []

    blocker_task = Task(
        id=blocker_id,
        title="Blocker Task A",
        status=TaskStatus.IN_PROGRESS,  # Not DONE
    )

    service.get_task = AsyncMock(return_value=mock_task)
    repo.get_task_by_id = AsyncMock(return_value=blocker_task)
    user_ctx = CurrentUser(id=creator_id, username="creator", permissions={"task.view"})

    # Attempting to set status to DONE must be rejected
    with pytest.raises(ValidationException) as exc_info:
        await service.update_task(
            task_id,
            TaskUpdate(status=TaskStatus.DONE),
            user_ctx,
        )
    assert "Cannot complete task. Blocked by: Blocker Task A" in str(exc_info.value)


@pytest.mark.asyncio
async def test_task_unauthorized_mutation_and_deletion_prevention():
    repo = MagicMock()
    repo.session = MagicMock()
    # Mock manager check to return None
    mock_exec_res = MagicMock()
    mock_exec_res.scalar_one_or_none.return_value = None
    repo.session.execute = AsyncMock(return_value=mock_exec_res)
    service = TaskService(
        repository=repo,
        audit_service=MagicMock(),
        notification_service=MagicMock(),
    )

    task_id = uuid.uuid4()
    creator_id = uuid.uuid4()
    unauthorized_user_id = uuid.uuid4()

    mock_task = Task(
        id=task_id,
        title="Confidential Task",
        status=TaskStatus.TODO,
        created_by=creator_id,
        version=1,
    )
    mock_task.assignees = []
    mock_task.dependencies = []
    mock_task.dependent_on = []

    service.get_task = AsyncMock(return_value=mock_task)
    unauthorized_ctx = CurrentUser(id=unauthorized_user_id, username="stranger", permissions={"task.view"})

    # Attempt update by unauthorized user
    with pytest.raises(ForbiddenException) as exc_info:
        await service.update_task(
            task_id,
            TaskUpdate(title="Malicious update"),
            unauthorized_ctx,
        )
    assert "You do not have permission to update this task" in str(exc_info.value)

    # Attempt delete by unauthorized user
    with pytest.raises(ForbiddenException) as exc_info:
        await service.soft_delete_task(
            task_id,
            unauthorized_ctx,
        )
    assert "You do not have permission to delete this task" in str(exc_info.value)
