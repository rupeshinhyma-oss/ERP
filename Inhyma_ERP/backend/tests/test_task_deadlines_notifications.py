"""
Unit tests for Task Deadline & Escalation Notification Checks.
Verifies that:
1. Deadlines only notify the relevant user (assignee/creator).
2. Escalations only notify the user assigned for escalation (to_user).
3. Notifications are deduplicated when recently sent.
"""

import pytest
import uuid
from datetime import date, timedelta
from unittest.mock import AsyncMock, MagicMock

from app.tasks.service import TaskService
from app.tasks.models import Task, TaskAssignee, TaskEscalation, TaskStatus, TaskPriority, IssueType


@pytest.mark.asyncio
async def test_check_task_deadlines_filters_by_user_and_escalation():
    # Setup users
    user_me = uuid.uuid4()
    user_other = uuid.uuid4()

    today = date.today()
    yesterday = today - timedelta(days=1)

    # Mock repository and session
    repo = MagicMock()
    session = MagicMock()
    repo.session = session

    # Create task 1: Assigned to user_me, overdue
    task1 = Task(
        id=uuid.uuid4(),
        title="My Overdue Task",
        due_date=yesterday,
        status=TaskStatus.IN_PROGRESS,
        priority=TaskPriority.HIGH,
        issue_type=IssueType.TASK,
        created_by=user_me,
    )
    assignee1 = TaskAssignee(id=uuid.uuid4(), task_id=task1.id, user_id=user_me, assignment_role="ASSIGNEE")
    task1.assignees = [assignee1]
    task1.escalations = []

    # Create task 2: Assigned to user_other, due today, but escalated to user_me
    task2 = Task(
        id=uuid.uuid4(),
        title="Other's Task with Escalation to Me",
        due_date=today,
        status=TaskStatus.IN_PROGRESS,
        priority=TaskPriority.CRITICAL,
        issue_type=IssueType.BUG,
        created_by=user_other,
    )
    assignee2 = TaskAssignee(id=uuid.uuid4(), task_id=task2.id, user_id=user_other, assignment_role="ASSIGNEE")
    esc2 = TaskEscalation(
        id=uuid.uuid4(),
        task_id=task2.id,
        to_user=user_me,
        reason="Needs urgent review",
        due_date=today,
    )
    task2.assignees = [assignee2]
    task2.escalations = [esc2]

    # Create task 3: Assigned to user_other with escalation to user_other
    task3 = Task(
        id=uuid.uuid4(),
        title="Other's Unrelated Task",
        due_date=yesterday,
        status=TaskStatus.TODO,
        priority=TaskPriority.LOW,
        issue_type=IssueType.TASK,
        created_by=user_other,
    )
    assignee3 = TaskAssignee(id=uuid.uuid4(), task_id=task3.id, user_id=user_other, assignment_role="ASSIGNEE")
    esc3 = TaskEscalation(
        id=uuid.uuid4(),
        task_id=task3.id,
        to_user=user_other,
        reason="Other escalation",
        due_date=yesterday,
    )
    task3.assignees = [assignee3]
    task3.escalations = [esc3]

    # Mock session execution returning tasks
    scalars_mock = MagicMock()
    scalars_mock.all.return_value = [task1, task2, task3]
    exec_result = MagicMock()
    exec_result.scalars.return_value = scalars_mock
    session.execute = AsyncMock(return_value=exec_result)
    session.refresh = AsyncMock()

    # Mock notification service
    notif_service = MagicMock()
    notif_service.has_recent_notification = AsyncMock(return_value=False)
    notif_service.notify_user = AsyncMock()

    # Instantiate TaskService
    service = TaskService(
        repository=repo,
        audit_service=MagicMock(),
        notification_service=notif_service,
    )

    # Execute check strictly for user_me
    count = await service.check_task_deadlines(user_id=user_me)

    # Verification:
    # 1. user_me should receive overdue notification for task 1
    # 2. user_me should receive escalation_deadline for task 2 (escalated to user_me)
    # 3. user_me should NOT receive task 2's deadline (assigned to user_other)
    # 4. user_me should NOT receive anything for task 3
    # 5. user_other should NOT receive anything because user_id=user_me was requested
    assert count == 2
    assert notif_service.notify_user.call_count == 2

    call_args_list = notif_service.notify_user.call_args_list

    # Check call 1: task_overdue for user_me
    call1 = call_args_list[0].kwargs
    assert call1["user_id"] == user_me
    assert call1["type"] == "task_overdue"
    assert "/tasks?id=" in call1["link"]

    # Check call 2: escalation_deadline for user_me
    call2 = call_args_list[1].kwargs
    assert call2["user_id"] == user_me
    assert call2["type"] == "escalation_deadline"
    assert "drawerTab=escalations" in call2["link"]


@pytest.mark.asyncio
async def test_check_task_deadlines_deduplication():
    user_me = uuid.uuid4()
    today = date.today()
    yesterday = today - timedelta(days=1)

    repo = MagicMock()
    session = MagicMock()
    repo.session = session

    task = Task(
        id=uuid.uuid4(),
        title="My Task",
        due_date=yesterday,
        status=TaskStatus.IN_PROGRESS,
        priority=TaskPriority.HIGH,
        issue_type=IssueType.TASK,
        created_by=user_me,
    )
    assignee = TaskAssignee(id=uuid.uuid4(), task_id=task.id, user_id=user_me, assignment_role="ASSIGNEE")
    task.assignees = [assignee]
    task.escalations = []

    scalars_mock = MagicMock()
    scalars_mock.all.return_value = [task]
    exec_result = MagicMock()
    exec_result.scalars.return_value = scalars_mock
    session.execute = AsyncMock(return_value=exec_result)
    session.refresh = AsyncMock()

    # has_recent_notification returns True (already sent within 20 hours)
    notif_service = MagicMock()
    notif_service.has_recent_notification = AsyncMock(return_value=True)
    notif_service.notify_user = AsyncMock()

    service = TaskService(
        repository=repo,
        audit_service=MagicMock(),
        notification_service=notif_service,
    )

    count = await service.check_task_deadlines(user_id=user_me)
    # Should NOT notify because it was already sent
    assert count == 0
    assert notif_service.notify_user.call_count == 0
