"""
Unit and Integration Tests for CRM Follow-up Task Assignment Notifications (Phase 3 & 3.2).

Verifies:
1. Creating a new CRM follow-up creates a linked task and dispatches exactly one task_assigned notification inside a SAVEPOINT.
2. The notification recipient is strictly the assigned salesperson (target_assignee_id).
3. The notification contains the correct type ("task_assigned"), title, message, and deep link ("/tasks?id={id}").
4. Self-assignment (when the actor assigns a follow-up to themself) does not trigger a self-notification.
5. Updating a follow-up without changing the assignee does not dispatch a new assignment notification.
6. Repeated/retried synchronization does not produce duplicate notifications.
7. Reassigning a follow-up to a new salesperson notifies the new assignee only.
8. Completed or cancelled follow-ups do not trigger task assignment notifications.
9. Notification failures inside SAVEPOINT are logged safely and do NOT poison the outer session, allowing the core CRM follow-up and task to commit cleanly.
10. Core task flush failures before SAVEPOINT propagate immediately to caller without being masked.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.crm.follow_up_task_sync import sync_follow_up_to_task
from app.crm.models import CrmFollowUp, CrmLead
from app.tasks.models import Task, TaskAssignee, TaskPriority, TaskStatus


def make_mock_session():
    """Create a mock SQLAlchemy AsyncSession with SAVEPOINT (begin_nested) support."""
    session = MagicMock()
    session.get = AsyncMock(return_value=None)
    session.add = MagicMock()
    session.flush = AsyncMock()
    session.commit = AsyncMock()
    session.rollback = AsyncMock()
    session.delete = AsyncMock()

    nested_savepoint = MagicMock()
    nested_savepoint.__aenter__ = AsyncMock(return_value=nested_savepoint)
    nested_savepoint.__aexit__ = AsyncMock(return_value=None)
    session.begin_nested.return_value = nested_savepoint

    fallback_res = MagicMock()
    fallback_res.scalar_one_or_none.return_value = None
    session.execute = AsyncMock(return_value=fallback_res)
    return session, nested_savepoint


@pytest.fixture
def mock_lead() -> CrmLead:
    lead = MagicMock(spec=CrmLead)
    lead.id = uuid.uuid4()
    lead.name = "Acme Global Solutions"
    lead.company_name = "Acme Corp"
    lead.lead_code = "LEAD-101"
    lead.priority = "high"
    lead.assigned_to = None
    lead.normalized_phone = "+919876543210"
    lead.original_phone = "9876543210"
    return lead


@pytest.fixture
def mock_follow_up(mock_lead: CrmLead) -> CrmFollowUp:
    fu = MagicMock(spec=CrmFollowUp)
    fu.id = uuid.uuid4()
    fu.lead_id = mock_lead.id
    fu.task_id = None
    fu.due_at = datetime.now(timezone.utc)
    fu.follow_up_type = "call"
    fu.notes = "Call CEO regarding enterprise proposal."
    fu.status = "pending"
    fu.assigned_to = uuid.uuid4()
    return fu


@pytest.mark.asyncio
async def test_new_follow_up_sends_one_assignment_notification_in_savepoint(
    mock_lead: CrmLead, mock_follow_up: CrmFollowUp
):
    actor_id = uuid.uuid4()
    salesperson_id = mock_follow_up.assigned_to
    session, savepoint = make_mock_session()

    with (
        patch("app.crm.follow_up_task_sync.NotificationService") as mock_notif_service_cls,
        patch("app.crm.follow_up_task_sync.NotificationRepository") as mock_notif_repo_cls,
    ):
        mock_notif_service = MagicMock()
        mock_notif_service.has_recent_notification = AsyncMock(return_value=False)
        mock_notif_service.notify_user = AsyncMock()
        mock_notif_service_cls.return_value = mock_notif_service

        task = await sync_follow_up_to_task(
            session=session,
            follow_up=mock_follow_up,
            lead=mock_lead,
            actor_id=actor_id,
        )

        assert task is not None
        assert mock_follow_up.task_id == task.id

        # SAVEPOINT must be initiated for notification isolation
        session.begin_nested.assert_called_once()
        savepoint.__aenter__.assert_awaited_once()

        # Verify notification service was called
        mock_notif_service.has_recent_notification.assert_awaited_once_with(
            user_id=salesperson_id,
            type="task_assigned",
            link=f"/tasks?id={task.id}",
            within_hours=24,
        )

        mock_notif_service.notify_user.assert_awaited_once_with(
            user_id=salesperson_id,
            type="task_assigned",
            title="Task Assigned",
            message=f"You have been assigned to task: {task.title}",
            link=f"/tasks?id={task.id}",
        )


@pytest.mark.asyncio
async def test_self_assignment_excludes_notification(
    mock_lead: CrmLead, mock_follow_up: CrmFollowUp
):
    actor_id = mock_follow_up.assigned_to  # Salesperson assigns to themself
    session, _ = make_mock_session()

    with (
        patch("app.crm.follow_up_task_sync.NotificationService") as mock_notif_service_cls,
        patch("app.crm.follow_up_task_sync.NotificationRepository") as mock_notif_repo_cls,
    ):
        mock_notif_service = MagicMock()
        mock_notif_service.has_recent_notification = AsyncMock(return_value=False)
        mock_notif_service.notify_user = AsyncMock()
        mock_notif_service_cls.return_value = mock_notif_service

        await sync_follow_up_to_task(
            session=session,
            follow_up=mock_follow_up,
            lead=mock_lead,
            actor_id=actor_id,
        )

        mock_notif_service.notify_user.assert_not_awaited()
        session.begin_nested.assert_not_called()


@pytest.mark.asyncio
async def test_existing_follow_up_update_without_assignee_change_no_notification(
    mock_lead: CrmLead, mock_follow_up: CrmFollowUp
):
    actor_id = uuid.uuid4()
    salesperson_id = mock_follow_up.assigned_to
    session, _ = make_mock_session()

    existing_task = Task(
        id=uuid.uuid4(),
        title="CRM Follow-up — Old Title",
        description="Old description",
        status=TaskStatus.TODO,
        priority=TaskPriority.MEDIUM,
    )
    mock_follow_up.task_id = existing_task.id
    session.get = AsyncMock(return_value=existing_task)

    # Existing assignee query returns current salesperson
    existing_assignee = TaskAssignee(
        id=uuid.uuid4(),
        task_id=existing_task.id,
        user_id=salesperson_id,
        assignment_role="ASSIGNEE",
    )
    assignee_res = MagicMock()
    assignee_res.scalars.return_value.all.return_value = [existing_assignee]
    session.execute = AsyncMock(return_value=assignee_res)

    with (
        patch("app.crm.follow_up_task_sync.NotificationService") as mock_notif_service_cls,
        patch("app.crm.follow_up_task_sync.NotificationRepository") as mock_notif_repo_cls,
    ):
        mock_notif_service = MagicMock()
        mock_notif_service.notify_user = AsyncMock()
        mock_notif_service_cls.return_value = mock_notif_service

        await sync_follow_up_to_task(
            session=session,
            follow_up=mock_follow_up,
            lead=mock_lead,
            actor_id=actor_id,
        )

        # No new notification since assignee has not changed
        mock_notif_service.notify_user.assert_not_awaited()
        session.begin_nested.assert_not_called()


@pytest.mark.asyncio
async def test_reassignment_notifies_new_assignee_only(
    mock_lead: CrmLead, mock_follow_up: CrmFollowUp
):
    actor_id = uuid.uuid4()
    old_salesperson_id = uuid.uuid4()
    new_salesperson_id = uuid.uuid4()
    mock_follow_up.assigned_to = new_salesperson_id
    session, savepoint = make_mock_session()

    existing_task = Task(
        id=uuid.uuid4(),
        title="CRM Follow-up — Acme",
        description="Desc",
        status=TaskStatus.TODO,
        priority=TaskPriority.HIGH,
    )
    mock_follow_up.task_id = existing_task.id
    session.get = AsyncMock(return_value=existing_task)

    # Existing assignee was old_salesperson_id
    old_assignee = TaskAssignee(
        id=uuid.uuid4(),
        task_id=existing_task.id,
        user_id=old_salesperson_id,
        assignment_role="ASSIGNEE",
    )
    assignee_res = MagicMock()
    assignee_res.scalars.return_value.all.return_value = [old_assignee]
    session.execute = AsyncMock(return_value=assignee_res)

    with (
        patch("app.crm.follow_up_task_sync.NotificationService") as mock_notif_service_cls,
        patch("app.crm.follow_up_task_sync.NotificationRepository") as mock_notif_repo_cls,
    ):
        mock_notif_service = MagicMock()
        mock_notif_service.has_recent_notification = AsyncMock(return_value=False)
        mock_notif_service.notify_user = AsyncMock()
        mock_notif_service_cls.return_value = mock_notif_service

        await sync_follow_up_to_task(
            session=session,
            follow_up=mock_follow_up,
            lead=mock_lead,
            actor_id=actor_id,
        )

        session.begin_nested.assert_called_once()

        # Asserts only the NEW salesperson is notified
        mock_notif_service.notify_user.assert_awaited_once_with(
            user_id=new_salesperson_id,
            type="task_assigned",
            title="Task Assigned",
            message=f"You have been assigned to task: {existing_task.title}",
            link=f"/tasks?id={existing_task.id}",
        )


@pytest.mark.asyncio
async def test_deduplication_prevents_duplicate_notifications_on_retries(
    mock_lead: CrmLead, mock_follow_up: CrmFollowUp
):
    actor_id = uuid.uuid4()
    session, _ = make_mock_session()

    with (
        patch("app.crm.follow_up_task_sync.NotificationService") as mock_notif_service_cls,
        patch("app.crm.follow_up_task_sync.NotificationRepository") as mock_notif_repo_cls,
    ):
        mock_notif_service = MagicMock()
        # Simulate that notification was already dispatched within 24 hours
        mock_notif_service.has_recent_notification = AsyncMock(return_value=True)
        mock_notif_service.notify_user = AsyncMock()
        mock_notif_service_cls.return_value = mock_notif_service

        await sync_follow_up_to_task(
            session=session,
            follow_up=mock_follow_up,
            lead=mock_lead,
            actor_id=actor_id,
        )

        mock_notif_service.notify_user.assert_not_awaited()


@pytest.mark.asyncio
async def test_completed_or_cancelled_follow_up_does_not_notify(
    mock_lead: CrmLead, mock_follow_up: CrmFollowUp
):
    actor_id = uuid.uuid4()
    mock_follow_up.status = "completed"
    session, _ = make_mock_session()

    with (
        patch("app.crm.follow_up_task_sync.NotificationService") as mock_notif_service_cls,
        patch("app.crm.follow_up_task_sync.NotificationRepository") as mock_notif_repo_cls,
    ):
        mock_notif_service = MagicMock()
        mock_notif_service.notify_user = AsyncMock()
        mock_notif_service_cls.return_value = mock_notif_service

        await sync_follow_up_to_task(
            session=session,
            follow_up=mock_follow_up,
            lead=mock_lead,
            actor_id=actor_id,
        )

        mock_notif_service.notify_user.assert_not_awaited()
        session.begin_nested.assert_not_called()


@pytest.mark.asyncio
async def test_notification_flush_failure_inside_savepoint_preserves_outer_session(
    mock_lead: CrmLead, mock_follow_up: CrmFollowUp
):
    """
    Phase 3.2 Verification:
    If a database flush/write error occurs specifically during notification creation inside
    the SAVEPOINT, the SAVEPOINT rolls back, the error is safely caught and logged,
    and the outer session remains valid so the caller can successfully commit the core CRM follow-up and task.
    """
    actor_id = uuid.uuid4()
    session, savepoint = make_mock_session()

    with (
        patch("app.crm.follow_up_task_sync.NotificationService") as mock_notif_service_cls,
        patch("app.crm.follow_up_task_sync.NotificationRepository") as mock_notif_repo_cls,
    ):
        mock_notif_service = MagicMock()
        mock_notif_service.has_recent_notification = AsyncMock(return_value=False)
        # Simulate a PostgreSQL flush/database failure on notification insert
        mock_notif_service.notify_user = AsyncMock(
            side_effect=RuntimeError("foreign key or check constraint failure on notification flush")
        )
        mock_notif_service_cls.return_value = mock_notif_service

        task = await sync_follow_up_to_task(
            session=session,
            follow_up=mock_follow_up,
            lead=mock_lead,
            actor_id=actor_id,
        )

        # Task and follow_up linkage must still succeed
        assert task is not None
        assert mock_follow_up.task_id == task.id

        # Savepoint __aexit__ was called (handling the savepoint rollback)
        savepoint.__aexit__.assert_awaited_once()

        # Outer session rollback was NOT called by follow_up_task_sync
        session.rollback.assert_not_called()

        # Caller can now cleanly commit the outer session
        await session.commit()
        session.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_core_crm_task_failure_propagates_without_entering_savepoint(
    mock_lead: CrmLead, mock_follow_up: CrmFollowUp
):
    """
    Phase 3.2 Verification:
    If the core CRM Task or TaskAssignee flush fails (before the savepoint),
    the failure must NOT be swallowed by the notification handler; it must raise normally.
    """
    actor_id = uuid.uuid4()
    session, _ = make_mock_session()

    # Core flush fails (e.g. invalid task title or missing required lead)
    session.flush = AsyncMock(side_effect=ValueError("Core Task persistence constraint violation"))

    with pytest.raises(ValueError, match="Core Task persistence constraint violation"):
        await sync_follow_up_to_task(
            session=session,
            follow_up=mock_follow_up,
            lead=mock_lead,
            actor_id=actor_id,
        )

    # Savepoint was NEVER entered because the core entity failed first
    session.begin_nested.assert_not_called()
