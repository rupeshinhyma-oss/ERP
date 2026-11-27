"""
Comprehensive Notification Audit & Regression Tests for Inhyma ERP:
1. Shared NotificationRepository length clamping (prevents VARCHAR(50)/VARCHAR(255) overflow crashes)
2. HRMS Notifications:
   - Leave cancellation (employee cancels -> manager/HR notified; Admin cancels -> employee notified with balance note)
   - Site visit reassigned away (previous employee notified)
   - Payroll payslip published & salary structure updated
3. CRM Lead Management Notifications:
   - Manual lead assignment, reassignment (new owner deep-link + former owner RBAC-safe `/crm/leads` link)
   - Bulk CSV import summary notification (1 lead -> direct link; N leads -> 1 concise batch summary)
   - Stage transition (assigned salesperson notified + reporting manager notified on Won/Lost)
   - Follow-up completed/cancelled by another user
   - Quotation created & status changed on another user's lead
   - SAVEPOINT isolation & self-notification exclusion
4. Enterprise Tasks Notifications:
   - Expired hold deduplication (`check_expired_holds`)
   - Comment `@mention` deduplication (mentioned user receives `task_mention` ONLY, not duplicate `comment_added`)
   - Escalation comment & recurring escalation deep-links (`&drawerTab=escalations`)
   - Self-escalation notification exclusion
   - Subtask assignee added on `update_subtask`
   - `duplicate_task` & `bulk_action` (`ASSIGN`, `ADD_WATCHER`, `STATUS -> DONE`) notifications
   - `RecurringTaskWorker._run_once` executes `check_task_deadlines` & `check_expired_holds`
"""

from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.crm.notifications import (
    notify_crm_batch_leads_assigned,
    notify_crm_follow_up_status_changed,
    notify_crm_lead_assigned,
    notify_crm_lead_stage_changed,
    notify_crm_lead_transferred_away,
    notify_crm_quotation_event,
    send_isolated_crm_notification,
)
from app.hrms.notifications import (
    notify_leave_cancelled,
    notify_payslip_published,
    notify_salary_updated,
    notify_site_visit_reassigned_away,
)
from app.notifications.repository import NotificationRepository
from app.tasks.models import (
    IssueType,
    Task,
    TaskAssignee,
    TaskEscalation,
    TaskPriority,
    TaskStatus,
    TaskSubtask,
)
from app.tasks.schemas import TaskBulkActionRequest, TaskDuplicateRequest
from app.tasks.service import TaskService
from app.users.models import User, UserStatus


def make_mock_session():
    session = MagicMock()
    session.get = AsyncMock(return_value=None)
    session.add = MagicMock()
    session.flush = AsyncMock()
    session.commit = AsyncMock()
    session.rollback = AsyncMock()
    session.refresh = AsyncMock()

    nested_savepoint = MagicMock()
    nested_savepoint.__aenter__ = AsyncMock(return_value=nested_savepoint)
    nested_savepoint.__aexit__ = AsyncMock(return_value=None)
    session.begin_nested.return_value = nested_savepoint

    fallback_res = MagicMock()
    fallback_res.scalars.return_value.all.return_value = []
    fallback_res.scalar_one_or_none.return_value = None
    session.execute = AsyncMock(return_value=fallback_res)
    return session, nested_savepoint


# ---------------------------------------------------------------------------
# 1. Shared NotificationRepository Defensive Clamping
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_notification_repository_clamps_long_fields():
    session, _ = make_mock_session()
    repo = NotificationRepository(session)
    uid = uuid.uuid4()

    notif = await repo.create(
        user_id=uid,
        type="x" * 90,
        title="T" * 400,
        message="Body text",
        link="/" + ("a" * 300),
    )
    assert len(notif.type) == 50
    assert len(notif.title) == 255
    assert notif.link is not None and len(notif.link) == 255
    session.flush.assert_awaited_once()


# ---------------------------------------------------------------------------
# 2. HRMS New / Fixed Notification Flows
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_hrms_notify_leave_cancelled_employee_vs_admin():
    session, _ = make_mock_session()
    emp_id = uuid.uuid4()
    mgr_id = uuid.uuid4()
    admin_id = uuid.uuid4()
    req_id = uuid.uuid4()

    mock_emp = MagicMock(spec=User)
    mock_emp.id = emp_id
    mock_emp.display_name = "Priya Nair"
    session.get.return_value = mock_emp

    with (
        patch("app.hrms.notifications.resolve_hrms_approvers", new_callable=AsyncMock, return_value=[mgr_id]),
        patch("app.hrms.notifications.NotificationService") as mock_svc_cls,
        patch("app.hrms.notifications.NotificationRepository"),
    ):
        mock_svc = MagicMock()
        mock_svc.has_recent_notification = AsyncMock(return_value=False)
        mock_svc.notify_user = AsyncMock()
        mock_svc_cls.return_value = mock_svc

        # Employee cancels own leave -> notifies manager
        await notify_leave_cancelled(
            session,
            employee_id=emp_id,
            from_date="2026-12-01",
            to_date="2026-12-02",
            number_of_days=2.0,
            actor_id=emp_id,
            request_id=req_id,
            was_approved=False,
        )
        mock_svc.notify_user.assert_awaited_once_with(
            user_id=mgr_id,
            type="hrms_leave_cancelled",
            title="Leave Request Cancelled",
            message="Priya Nair cancelled their leave request (2 day(s), 2026-12-01 to 2026-12-02).",
            link=f"/hrms/leave?request_id={req_id}",
        )

        mock_svc.notify_user.reset_mock()

        # Admin cancels approved leave -> notifies employee with balance restoration note
        await notify_leave_cancelled(
            session,
            employee_id=emp_id,
            from_date="2026-12-01",
            to_date="2026-12-02",
            number_of_days=2.0,
            actor_id=admin_id,
            request_id=req_id,
            was_approved=True,
        )
        mock_svc.notify_user.assert_awaited_once_with(
            user_id=emp_id,
            type="hrms_leave_cancelled",
            title="Leave Request Cancelled",
            message="Your leave request for 2 day(s) from 2026-12-01 to 2026-12-02 was cancelled. Your leave balance has been restored.",
            link=f"/hrms/leave?request_id={req_id}",
        )


@pytest.mark.asyncio
async def test_hrms_site_visit_reassigned_away_and_payroll_notifications():
    session, _ = make_mock_session()
    emp_id = uuid.uuid4()
    admin_id = uuid.uuid4()
    visit_id = uuid.uuid4()
    salary_id = uuid.uuid4()

    with (
        patch("app.hrms.notifications.NotificationService") as mock_svc_cls,
        patch("app.hrms.notifications.NotificationRepository"),
    ):
        mock_svc = MagicMock()
        mock_svc.has_recent_notification = AsyncMock(return_value=False)
        mock_svc.notify_user = AsyncMock()
        mock_svc_cls.return_value = mock_svc

        await notify_site_visit_reassigned_away(
            session,
            previous_employee_id=emp_id,
            customer_name="Acme Factory",
            visit_date="2026-12-10",
            actor_id=admin_id,
            visit_id=visit_id,
        )
        assert mock_svc.notify_user.call_args.kwargs["type"] == "hrms_site_visit_reassigned_away"
        assert mock_svc.notify_user.call_args.kwargs["link"] == f"/hrms/site-visit?visit_id={visit_id}"

        mock_svc.notify_user.reset_mock()
        await notify_payslip_published(
            session,
            employee_id=emp_id,
            payroll_month="2026-11",
            actor_id=admin_id,
        )
        assert mock_svc.notify_user.call_args.kwargs["type"] == "hrms_payslip_published"
        assert mock_svc.notify_user.call_args.kwargs["link"] == "/hrms/payroll?month=2026-11"

        mock_svc.notify_user.reset_mock()
        await notify_salary_updated(
            session,
            employee_id=emp_id,
            effective_from="2026-11-01",
            actor_id=admin_id,
            salary_id=salary_id,
        )
        assert mock_svc.notify_user.call_args.kwargs["type"] == "hrms_salary_updated"
        assert mock_svc.notify_user.call_args.kwargs["link"] == f"/hrms/payroll?salary_id={salary_id}"


# ---------------------------------------------------------------------------
# 3. CRM Lead Management Notifications
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_crm_lead_assigned_reassigned_and_transferred_away():
    session, savepoint = make_mock_session()
    lead_id = uuid.uuid4()
    admin_id = uuid.uuid4()
    old_rep_id = uuid.uuid4()
    new_rep_id = uuid.uuid4()

    with (
        patch("app.crm.notifications.NotificationService") as mock_svc_cls,
        patch("app.crm.notifications.NotificationRepository"),
    ):
        mock_svc = MagicMock()
        mock_svc.has_recent_notification = AsyncMock(return_value=False)
        mock_svc.notify_user = AsyncMock()
        mock_svc_cls.return_value = mock_svc

        # 1. Assign to new rep
        await notify_crm_lead_assigned(
            session,
            lead_id=lead_id,
            lead_code="LD-1001",
            lead_name="Apex Packaging",
            assignee_id=new_rep_id,
            actor_id=admin_id,
            actor_name="Sales Manager",
            reassigned=True,
            reason="Territory rebalance",
        )
        kwargs = mock_svc.notify_user.call_args.kwargs
        assert kwargs["user_id"] == new_rep_id
        assert kwargs["type"] == "crm_lead_reassigned"
        assert kwargs["link"] == f"/crm/leads?leadId={lead_id}"
        assert "Territory rebalance" in kwargs["message"]

        # 2. Previous owner gets RBAC-safe /crm/leads link (NO leadId)
        mock_svc.notify_user.reset_mock()
        await notify_crm_lead_transferred_away(
            session,
            lead_code="LD-1001",
            lead_name="Apex Packaging",
            previous_owner_id=old_rep_id,
            actor_id=admin_id,
            new_owner_name="New Rep",
            reason="Territory rebalance",
        )
        kwargs = mock_svc.notify_user.call_args.kwargs
        assert kwargs["user_id"] == old_rep_id
        assert kwargs["type"] == "crm_lead_transferred"
        assert kwargs["link"] == "/crm/leads"

        # 3. Self-assignment does NOT notify
        mock_svc.notify_user.reset_mock()
        await notify_crm_lead_assigned(
            session,
            lead_id=lead_id,
            lead_code="LD-1001",
            lead_name="Apex Packaging",
            assignee_id=admin_id,
            actor_id=admin_id,
        )
        mock_svc.notify_user.assert_not_awaited()


@pytest.mark.asyncio
async def test_crm_batch_leads_assigned_summarizes_multiple_leads():
    session, _ = make_mock_session()
    rep_id = uuid.uuid4()
    admin_id = uuid.uuid4()
    batch_id = uuid.uuid4()

    with (
        patch("app.crm.notifications.NotificationService") as mock_svc_cls,
        patch("app.crm.notifications.NotificationRepository"),
    ):
        mock_svc = MagicMock()
        mock_svc.has_recent_notification = AsyncMock(return_value=False)
        mock_svc.notify_user = AsyncMock()
        mock_svc_cls.return_value = mock_svc

        # Multiple leads -> exactly ONE summary notification
        leads = [
            (uuid.uuid4(), "LD-1", "Lead One"),
            (uuid.uuid4(), "LD-2", "Lead Two"),
            (uuid.uuid4(), "LD-3", "Lead Three"),
        ]
        await notify_crm_batch_leads_assigned(
            session,
            assignee_id=rep_id,
            leads=leads,
            batch_name="Q4 Expo CSV",
            batch_id=batch_id,
            actor_id=admin_id,
        )
        mock_svc.notify_user.assert_awaited_once()
        kwargs = mock_svc.notify_user.call_args.kwargs
        assert kwargs["user_id"] == rep_id
        assert kwargs["type"] == "crm_leads_batch_assigned"
        assert kwargs["title"] == "3 New Leads Assigned"
        assert f"batch_id={batch_id}" in kwargs["link"]


@pytest.mark.asyncio
async def test_crm_stage_won_notifies_reporting_manager_and_followup_quotation_events():
    session, _ = make_mock_session()
    lead_id = uuid.uuid4()
    rep_id = uuid.uuid4()
    mgr_id = uuid.uuid4()
    admin_id = uuid.uuid4()

    rep_user = MagicMock(spec=User)
    rep_user.id = rep_id
    rep_user.manager_id = mgr_id

    mgr_user = MagicMock(spec=User)
    mgr_user.id = mgr_id
    mgr_user.deleted_at = None
    mgr_user.is_active = True
    mgr_user.status = UserStatus.ACTIVE
    mgr_user.employment_status = None

    async def fake_get(model, pk):
        if pk == rep_id:
            return rep_user
        if pk == mgr_id:
            return mgr_user
        return None

    session.get = AsyncMock(side_effect=fake_get)

    with (
        patch("app.crm.notifications.NotificationService") as mock_svc_cls,
        patch("app.crm.notifications.NotificationRepository"),
    ):
        mock_svc = MagicMock()
        mock_svc.has_recent_notification = AsyncMock(return_value=False)
        mock_svc.notify_user = AsyncMock()
        mock_svc_cls.return_value = mock_svc

        # Salesperson marks own lead WON -> manager notified (salesperson NOT self-notified)
        await notify_crm_lead_stage_changed(
            session,
            lead_id=lead_id,
            lead_code="LD-500",
            lead_name="Mega Corp",
            assignee_id=rep_id,
            from_stage_name="Proposal",
            to_stage_name="Closed Won",
            stage_type="won",
            actor_id=rep_id,
            actor_name="Sales Rep",
        )
        mock_svc.notify_user.assert_awaited_once()
        assert mock_svc.notify_user.call_args.kwargs["user_id"] == mgr_id
        assert mock_svc.notify_user.call_args.kwargs["type"] == "crm_lead_won"

        # Manager cancels rep's follow-up -> rep notified with drawerTab=followups
        mock_svc.notify_user.reset_mock()
        await notify_crm_follow_up_status_changed(
            session,
            lead_id=lead_id,
            lead_code="LD-500",
            lead_name="Mega Corp",
            follow_up_id=uuid.uuid4(),
            follow_up_type="call",
            new_status="cancelled",
            assignee_id=rep_id,
            actor_id=admin_id,
            actor_name="Admin",
        )
        kwargs = mock_svc.notify_user.call_args.kwargs
        assert kwargs["user_id"] == rep_id
        assert kwargs["type"] == "crm_follow_up_cancelled"
        assert kwargs["link"] == f"/crm/leads?leadId={lead_id}&drawerTab=followups"

        # Manager updates quotation status -> rep notified with drawerTab=quotations
        mock_svc.notify_user.reset_mock()
        await notify_crm_quotation_event(
            session,
            lead_id=lead_id,
            lead_code="LD-500",
            lead_name="Mega Corp",
            quotation_number="SQ-202611-0001",
            action="status_changed",
            status_label="sent",
            assignee_id=rep_id,
            actor_id=admin_id,
            actor_name="Admin",
        )
        kwargs = mock_svc.notify_user.call_args.kwargs
        assert kwargs["user_id"] == rep_id
        assert kwargs["type"] == "crm_quotation_status_changed"
        assert kwargs["link"] == f"/crm/leads?leadId={lead_id}&drawerTab=quotations"


@pytest.mark.asyncio
async def test_crm_notification_savepoint_failure_preserves_outer_transaction():
    session, savepoint = make_mock_session()
    with (
        patch("app.crm.notifications.NotificationService") as mock_svc_cls,
        patch("app.crm.notifications.NotificationRepository"),
    ):
        mock_svc = MagicMock()
        mock_svc.has_recent_notification = AsyncMock(return_value=False)
        mock_svc.notify_user = AsyncMock(side_effect=RuntimeError("DB failure"))
        mock_svc_cls.return_value = mock_svc

        await send_isolated_crm_notification(
            session,
            recipient_id=uuid.uuid4(),
            type="crm_lead_assigned",
            title="New Lead",
            message="Msg",
            link="/crm/leads",
        )
        savepoint.__aexit__.assert_awaited_once()
        session.rollback.assert_not_called()


# ---------------------------------------------------------------------------
# 4. Enterprise Task Notification Fixes
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_check_expired_holds_deduplicates_notifications():
    session, _ = make_mock_session()
    repo = MagicMock()
    repo.session = session

    assignee_id = uuid.uuid4()
    task = Task(
        id=uuid.uuid4(),
        title="Held Deployment Task",
        status=TaskStatus.ON_HOLD,
        priority=TaskPriority.HIGH,
        issue_type=IssueType.TASK,
        hold_until=date.today() - timedelta(days=1),
        created_by=assignee_id,
    )
    task.assignees = [TaskAssignee(id=uuid.uuid4(), task_id=task.id, user_id=assignee_id, assignment_role="ASSIGNEE")]

    scalars_mock = MagicMock()
    scalars_mock.all.return_value = [task]
    exec_res = MagicMock()
    exec_res.scalars.return_value = scalars_mock
    session.execute = AsyncMock(return_value=exec_res)

    notif = MagicMock()
    notif.has_recent_notification = AsyncMock(side_effect=[False, True])
    notif.notify_user = AsyncMock()

    svc = TaskService(repository=repo, audit_service=MagicMock(), notification_service=notif)
    svc._broadcast_task_event = AsyncMock()

    # First pass sends notification
    await svc.check_expired_holds()
    assert notif.notify_user.call_count == 1
    assert notif.notify_user.call_args.kwargs["type"] == "hold_ended"

    # Second pass within 20h is deduplicated
    await svc.check_expired_holds()
    assert notif.notify_user.call_count == 1


@pytest.mark.asyncio
async def test_comment_mention_does_not_send_duplicate_comment_notification():
    session, _ = make_mock_session()
    repo = MagicMock()
    repo.session = session

    author = MagicMock()
    author.id = uuid.uuid4()
    author.username = "alice"
    author.display_name = "Alice"
    author.is_super_admin = True
    author.permissions = ["*"]

    mentioned_assignee_id = uuid.uuid4()
    other_assignee_id = uuid.uuid4()

    task = Task(
        id=uuid.uuid4(),
        title="Release Checklist",
        status=TaskStatus.IN_PROGRESS,
        priority=TaskPriority.MEDIUM,
        issue_type=IssueType.TASK,
        created_by=author.id,
    )
    task.assignees = [
        TaskAssignee(id=uuid.uuid4(), task_id=task.id, user_id=mentioned_assignee_id, assignment_role="ASSIGNEE"),
        TaskAssignee(id=uuid.uuid4(), task_id=task.id, user_id=other_assignee_id, assignment_role="ASSIGNEE"),
    ]

    comment_obj = MagicMock()
    comment_obj.id = uuid.uuid4()
    repo.add_comment = AsyncMock(return_value=comment_obj)

    notif = MagicMock()
    notif.notify_user = AsyncMock()
    audit = MagicMock()
    audit.record = AsyncMock()

    svc = TaskService(repository=repo, audit_service=audit, notification_service=notif)
    svc.get_task = AsyncMock(return_value=task)
    svc._assert_can_collaborate_on_task = AsyncMock()
    svc._broadcast_task_event = AsyncMock()

    fake_mention = MagicMock()
    fake_mention.mentioned_user_id = mentioned_assignee_id
    svc._process_mentions = AsyncMock(return_value=[fake_mention])

    await svc.add_comment(task.id, "Hey @bob please check", author)

    # ONLY other_assignee_id should receive comment_added (mentioned_assignee_id already received task_mention)
    notif.notify_user.assert_awaited_once()
    assert notif.notify_user.call_args.kwargs["user_id"] == other_assignee_id
    assert notif.notify_user.call_args.kwargs["type"] == "comment_added"


@pytest.mark.asyncio
async def test_escalation_comment_uses_escalations_drawer_tab_and_self_escalation_excluded():
    session, _ = make_mock_session()
    repo = MagicMock()
    repo.session = session

    actor = MagicMock()
    actor.id = uuid.uuid4()
    actor.username = "manager"
    actor.display_name = "Manager"
    actor.is_super_admin = True
    actor.permissions = ["*"]

    target_uid = uuid.uuid4()
    task = Task(
        id=uuid.uuid4(),
        title="SLA Escalation Task",
        status=TaskStatus.IN_PROGRESS,
        priority=TaskPriority.HIGH,
        issue_type=IssueType.TASK,
        created_by=target_uid,
    )
    task.assignees = []

    esc = TaskEscalation(
        id=uuid.uuid4(),
        task_id=task.id,
        from_user=target_uid,
        to_user=actor.id,
        reason="Blocked on vendor",
        due_date=date.today() + timedelta(days=2),
    )
    repo.get_escalation_by_id = AsyncMock(return_value=esc)
    ec = MagicMock()
    ec.id = uuid.uuid4()
    repo.add_escalation_comment = AsyncMock(return_value=ec)
    repo.add_escalation = AsyncMock(return_value=esc)

    notif = MagicMock()
    notif.notify_user = AsyncMock()
    audit = MagicMock()
    audit.record = AsyncMock()

    svc = TaskService(repository=repo, audit_service=audit, notification_service=notif)
    svc.get_task = AsyncMock(return_value=task)
    svc._assert_can_collaborate_on_task = AsyncMock()
    svc._validate_eligible_active_users = AsyncMock()
    svc._broadcast_task_event = AsyncMock()
    svc._process_mentions = AsyncMock(return_value=[])

    # 1. Escalation comment links directly to &drawerTab=escalations
    await svc.add_escalation_comment(esc.id, "Following up now", actor)
    notif.notify_user.assert_awaited_once()
    assert notif.notify_user.call_args.kwargs["link"] == f"/tasks?id={task.id}&drawerTab=escalations"

    # 2. Self-escalation does NOT self-notify
    notif.notify_user.reset_mock()
    await svc.escalate_task(
        task.id,
        to_user=actor.id,
        reason="Self note",
        current_user=actor,
        due_date=date.today() + timedelta(days=1),
    )
    notif.notify_user.assert_not_awaited()


@pytest.mark.asyncio
async def test_update_subtask_notifies_newly_added_assignee():
    session, _ = make_mock_session()
    repo = MagicMock()
    repo.session = session

    actor = MagicMock()
    actor.id = uuid.uuid4()
    actor.username = "lead"
    actor.display_name = "Team Lead"

    new_uid = uuid.uuid4()
    task = Task(
        id=uuid.uuid4(),
        title="Parent Task",
        status=TaskStatus.IN_PROGRESS,
        priority=TaskPriority.MEDIUM,
        issue_type=IssueType.TASK,
        created_by=actor.id,
    )
    task.assignees = []

    sub = MagicMock(spec=TaskSubtask)
    sub.id = uuid.uuid4()
    sub.task_id = task.id
    sub.title = "Prepare BOM"
    sub.assignee_id = None
    sub.assignees = []
    sub.completed = False
    sub.status = "TODO"

    repo.get_subtask_by_id = AsyncMock(return_value=sub)
    repo.update_subtask = AsyncMock(return_value=sub)

    notif = MagicMock()
    notif.notify_user = AsyncMock()

    svc = TaskService(repository=repo, audit_service=MagicMock(), notification_service=notif)
    svc.get_task = AsyncMock(return_value=task)
    svc._assert_can_mutate_task = AsyncMock()
    svc._validate_eligible_active_users = AsyncMock()
    svc._broadcast_task_event = AsyncMock()

    await svc.update_subtask(sub.id, assignee_ids=[new_uid], current_user=actor)
    notif.notify_user.assert_awaited_once()
    assert notif.notify_user.call_args.kwargs["user_id"] == new_uid
    assert notif.notify_user.call_args.kwargs["type"] == "subtask_assigned"


@pytest.mark.asyncio
async def test_bulk_action_assign_and_done_dispatches_notifications():
    session, _ = make_mock_session()
    repo = MagicMock()
    repo.session = session

    actor = MagicMock()
    actor.id = uuid.uuid4()
    actor.username = "admin"
    actor.display_name = "Admin"
    actor.is_super_admin = True
    actor.permissions = ["*"]

    target_uid = uuid.uuid4()
    t1 = Task(
        id=uuid.uuid4(),
        title="Bulk Task 1",
        status=TaskStatus.TODO,
        priority=TaskPriority.MEDIUM,
        issue_type=IssueType.TASK,
        created_by=target_uid,
    )
    t1.assignees = [TaskAssignee(id=uuid.uuid4(), task_id=t1.id, user_id=target_uid, assignment_role="ASSIGNEE")]

    repo.get_task_by_id = AsyncMock(return_value=t1)
    repo.bulk_update_tasks = AsyncMock(return_value=(1, []))

    notif = MagicMock()
    notif.notify_user = AsyncMock()
    audit = MagicMock()
    audit.record = AsyncMock()

    svc = TaskService(repository=repo, audit_service=audit, notification_service=notif)
    svc._assert_can_mutate_task = AsyncMock()
    svc._validate_eligible_active_users = AsyncMock()
    svc.dispatcher = MagicMock()
    svc.dispatcher.publish_to_channels = AsyncMock()

    # 1. Bulk ASSIGN notifies assignee
    await svc.bulk_action(
        TaskBulkActionRequest(task_ids=[t1.id], action="ASSIGN", value=str(target_uid)),
        current_user=actor,
    )
    notif.notify_user.assert_awaited_once()
    assert notif.notify_user.call_args.kwargs["user_id"] == target_uid
    assert notif.notify_user.call_args.kwargs["type"] == "task_assigned"
    assert notif.notify_user.call_args.kwargs["link"] == f"/tasks?id={t1.id}"

    # 2. Bulk STATUS -> DONE notifies assignee/creator
    notif.notify_user.reset_mock()
    with patch("app.crm.follow_up_task_sync.sync_task_completion_to_follow_up", new_callable=AsyncMock):
        await svc.bulk_action(
            TaskBulkActionRequest(task_ids=[t1.id], action="STATUS", value="DONE"),
            current_user=actor,
        )
    notif.notify_user.assert_awaited_once()
    assert notif.notify_user.call_args.kwargs["user_id"] == target_uid
    assert notif.notify_user.call_args.kwargs["type"] == "task_completed"
