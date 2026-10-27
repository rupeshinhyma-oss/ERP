"""
CRM Follow-up to Workforce & Agile Task Synchronization Module.

Maintains bidirectional consistency between CRM follow-up commitments
and Inhyma ERP's Workforce & Agile Tasks (backend/app/tasks):
- Automatically generates a corresponding Task when a follow-up is scheduled.
- Assigns the task to the responsible salesperson with the follow-up due date.
- Formats rich lead and follow-up reference details in the task description.
- Prevents duplicate tasks via stable task_id foreign key linkage and idempotent lookups.
- Updates the existing task upon follow-up edits without overwriting user-modified task fields.
- Marks the task as DONE upon follow-up completion, capturing completion notes.
- Soft-deletes and places the task ON_HOLD upon cancellation so it no longer appears active.
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.crm.models import CrmActivity, CrmFollowUp, CrmLead
from app.database.base import _utcnow
from app.notifications.repository import NotificationRepository
from app.notifications.service import NotificationService
from app.tasks.models import Task, TaskAssignee, TaskComment, TaskPriority, TaskStatus

logger = logging.getLogger(__name__)


def format_crm_follow_up_task_description(lead: CrmLead, follow_up: CrmFollowUp) -> str:
    """Format structured, human-readable task description with lead and follow-up context."""
    due_str = follow_up.due_at.strftime("%Y-%m-%d %H:%M UTC") if follow_up.due_at else "N/A"
    lines = [
        f"• Lead: {lead.name}",
        f"• Company: {lead.company_name or 'N/A'}",
        f"• Contact Phone: {lead.normalized_phone or lead.original_phone or 'N/A'}",
        f"• Follow-up Purpose: {follow_up.follow_up_type.capitalize()}",
        f"• Follow-up Notes: {follow_up.notes or 'None'}",
        f"• Follow-up Date & Time: {due_str}",
        f"• CRM Lead Reference: {lead.lead_code} (ID: {lead.id})",
        f"• CRM Follow-up Reference: ID {follow_up.id}",
    ]
    return "\n".join(lines)


def map_lead_priority_to_task_priority(lead_priority: str | None) -> TaskPriority:
    """Map CRM lead priority levels to TaskPriority enum."""
    p = (lead_priority or "").strip().lower()
    if p == "urgent":
        return TaskPriority.CRITICAL
    elif p == "high":
        return TaskPriority.HIGH
    elif p == "low":
        return TaskPriority.LOW
    return TaskPriority.MEDIUM


async def sync_follow_up_to_task(
    session: AsyncSession,
    follow_up: CrmFollowUp,
    lead: CrmLead,
    actor_id: uuid.UUID,
) -> Task:
    """
    Ensure exactly one Workforce Task exists for this CRM follow-up.
    Creates or updates the linked task idempotently without duplicates.
    """
    task: Task | None = None

    if follow_up.task_id:
        task = await session.get(Task, follow_up.task_id)

    # Fallback lookup to prevent duplicates if task_id was not set or during retries
    if not task:
        ref_str = f"CRM Follow-up Reference: ID {follow_up.id}"
        stmt = (
            select(Task)
            .where(
                Task.description.contains(ref_str),
                Task.deleted_at.is_(None),
            )
            .order_by(Task.created_at.desc())
            .limit(1)
        )
        task = (await session.execute(stmt)).scalar_one_or_none()
        if task:
            follow_up.task_id = task.id

    due_date_val = follow_up.due_at.date() if follow_up.due_at else None
    target_assignee_id = follow_up.assigned_to or lead.assigned_to or actor_id

    is_new_task = False
    is_reassigned = False

    if task:
        # Update existing task without overwriting unrelated fields modified by users
        task.title = f"CRM Follow-up — {lead.name}"
        task.due_date = due_date_val

        # If follow-up was previously cancelled or marked done, re-activate if now pending
        if follow_up.status == "pending":
            if task.deleted_at is not None:
                task.deleted_at = None
                task.deleted_by = None
            if task.status in (TaskStatus.ON_HOLD, TaskStatus.DONE):
                task.status = TaskStatus.TODO
                task.hold_reason = None

        new_desc = format_crm_follow_up_task_description(lead, follow_up)
        # Preserve completion notes or user notes if appended
        if task.description and "\n\nCompletion Notes:" in task.description:
            suffix = task.description[task.description.index("\n\nCompletion Notes:"):]
            task.description = f"{new_desc}{suffix}"
        elif task.description and "\n\nUser Notes:" in task.description:
            suffix = task.description[task.description.index("\n\nUser Notes:"):]
            task.description = f"{new_desc}{suffix}"
        else:
            task.description = new_desc

        task.updated_at = _utcnow()

        # Update assignee role if changed
        if target_assignee_id:
            assignee_stmt = select(TaskAssignee).where(
                TaskAssignee.task_id == task.id,
                TaskAssignee.assignment_role == "ASSIGNEE",
            )
            existing_assignees = list((await session.execute(assignee_stmt)).scalars().all())
            has_correct = any(a.user_id == target_assignee_id for a in existing_assignees)
            if not has_correct:
                for a in existing_assignees:
                    await session.delete(a)
                new_a = TaskAssignee(
                    task_id=task.id,
                    user_id=target_assignee_id,
                    assignment_role="ASSIGNEE",
                )
                session.add(new_a)
                is_reassigned = True
    else:
        # Create brand-new Task
        task = Task(
            title=f"CRM Follow-up — {lead.name}",
            description=format_crm_follow_up_task_description(lead, follow_up),
            priority=map_lead_priority_to_task_priority(lead.priority),
            status=TaskStatus.TODO,
            issue_type="TASK",
            due_date=due_date_val,
            created_by=actor_id,
        )
        session.add(task)
        await session.flush()

        follow_up.task_id = task.id

        if target_assignee_id:
            assignee = TaskAssignee(
                task_id=task.id,
                user_id=target_assignee_id,
                assignment_role="ASSIGNEE",
            )
            session.add(assignee)
            await session.flush()
        is_new_task = True

    # Stored & Real-Time Notification for assigned salesperson (isolated optional side effect)
    if (is_new_task or is_reassigned) and target_assignee_id and follow_up.status == "pending":
        if target_assignee_id != actor_id:
            # Ensure core CRM changes (Task & TaskAssignee) are cleanly flushed before savepoint
            await session.flush()
            try:
                async with session.begin_nested():
                    notif_repo = NotificationRepository(session)
                    notif_service = NotificationService(notif_repo)
                    task_link = f"/tasks?id={task.id}"

                    already_notified = await notif_service.has_recent_notification(
                        user_id=target_assignee_id,
                        type="task_assigned",
                        link=task_link,
                        within_hours=24,
                    )
                    if not already_notified:
                        await notif_service.notify_user(
                            user_id=target_assignee_id,
                            type="task_assigned",
                            title="Task Assigned",
                            message=f"You have been assigned to task: {task.title}",
                            link=task_link,
                        )
            except Exception:
                logger.exception(
                    "Failed to create CRM follow-up task assignment notification (rolled back savepoint).",
                    extra={"task_id": str(task.id), "user_id": str(target_assignee_id)},
                )

    return task


async def complete_follow_up_task(
    session: AsyncSession,
    follow_up: CrmFollowUp,
    actor_id: uuid.UUID,
    actor_username: str,
    completion_notes: str | None = None,
    outcome: str | None = None,
) -> Task | None:
    """
    Update linked Task to DONE when a CRM follow-up is marked completed.
    Preserves completion notes and original context.
    """
    task: Task | None = None
    if follow_up.task_id:
        task = await session.get(Task, follow_up.task_id)

    if not task:
        ref_str = f"CRM Follow-up Reference: ID {follow_up.id}"
        stmt = (
            select(Task)
            .where(Task.description.contains(ref_str))
            .limit(1)
        )
        task = (await session.execute(stmt)).scalar_one_or_none()
        if task:
            follow_up.task_id = task.id

    if not task:
        return None

    task.status = TaskStatus.DONE
    task.updated_at = _utcnow()

    c_notes = (completion_notes or "").strip()
    if c_notes and "Completion Notes:" not in (task.description or ""):
        task.description = f"{task.description or ''}\n\nCompletion Notes: {c_notes}".strip()

    comment_body = f"Follow-up completed in CRM by {actor_username}."
    if outcome:
        comment_body += f" Outcome: {outcome.strip()}"
    if c_notes:
        comment_body += f"\nCompletion Notes: {c_notes}"

    comment = TaskComment(
        task_id=task.id,
        user_id=actor_id,
        message=comment_body,
    )
    session.add(comment)
    return task


async def cancel_follow_up_task(
    session: AsyncSession,
    follow_up: CrmFollowUp,
    actor_id: uuid.UUID,
    actor_username: str,
) -> Task | None:
    """
    Handle cancellation of a CRM follow-up on its linked Task.
    Prevents the task from appearing as an active outstanding follow-up
    without marking it as successfully completed.
    """
    task: Task | None = None
    if follow_up.task_id:
        task = await session.get(Task, follow_up.task_id)

    if not task:
        ref_str = f"CRM Follow-up Reference: ID {follow_up.id}"
        stmt = (
            select(Task)
            .where(Task.description.contains(ref_str))
            .limit(1)
        )
        task = (await session.execute(stmt)).scalar_one_or_none()
        if task:
            follow_up.task_id = task.id

    if not task:
        return None

    now_dt = _utcnow()
    task.status = TaskStatus.ON_HOLD
    task.hold_reason = f"CRM follow-up was cancelled by {actor_username}"
    task.deleted_at = now_dt
    task.deleted_by = actor_id
    task.updated_at = now_dt

    comment = TaskComment(
        task_id=task.id,
        user_id=actor_id,
        message=f"Follow-up was cancelled in CRM by {actor_username}.",
    )
    session.add(comment)
    return task


async def sync_task_completion_to_follow_up(
    session: AsyncSession,
    task_id: uuid.UUID,
    actor_id: uuid.UUID,
    actor_username: str,
    completion_notes: str | None = None,
) -> CrmFollowUp | None:
    """
    When a Workforce Task originating from a CRM follow-up is completed (status=DONE),
    automatically complete the linked CRM follow-up.

    Safety & Integrity rules:
    - Uses the persisted task_id relationship on CrmFollowUp (not title/lead name).
    - Safe & Idempotent: returns existing record immediately if already completed.
    - Prevents synchronization loops: no action if follow-up is already completed.
    - Preserves existing follow-up history and completion notes.
    - Creates CrmActivity record with activity_type='follow_up_completed'.
    - Updates lead's last_contacted_at, status (new -> contacted), and recalculates next_follow_up_at.
    - Participates in the caller's active database transaction session.
    """
    stmt = (
        select(CrmFollowUp)
        .where(
            CrmFollowUp.task_id == task_id,
            CrmFollowUp.deleted_at.is_(None),
        )
        .order_by(CrmFollowUp.created_at.desc())
        .limit(1)
    )
    follow_up = (await session.execute(stmt)).scalars().first()
    if not follow_up:
        return None

    # Idempotent guard: if already completed, do nothing
    if follow_up.status == "completed":
        return follow_up

    now_dt = _utcnow()
    follow_up.status = "completed"
    follow_up.completed_at = now_dt
    follow_up.updated_at = now_dt

    lead = await session.get(CrmLead, follow_up.lead_id)
    if lead and lead.deleted_at is None:
        c_notes = (completion_notes or "").strip()
        orig_notes = (follow_up.notes or "").strip()
        full_desc = c_notes if c_notes else orig_notes or "Follow-up marked completed via Workforce Task."
        if c_notes and orig_notes:
            full_desc = f"{c_notes} (Scheduled context: {orig_notes})"

        activity = CrmActivity(
            lead_id=lead.id,
            activity_type="follow_up_completed",
            subject=f"Follow-up Completed: {follow_up.follow_up_type.capitalize()}",
            description=full_desc,
            outcome="completed",
            performed_by=actor_id,
            activity_at=now_dt,
            created_at=now_dt,
        )
        session.add(activity)

        if follow_up.follow_up_type in {"call", "meeting", "whatsapp", "email", "demo"}:
            lead.last_contacted_at = now_dt
            if lead.status == "new":
                lead.status = "contacted"

        # Recalculate next_follow_up_at denormalized on lead
        await session.flush()
        next_due_stmt = (
            select(func.min(CrmFollowUp.due_at))
            .where(
                CrmFollowUp.lead_id == lead.id,
                CrmFollowUp.status == "pending",
                CrmFollowUp.deleted_at.is_(None),
            )
        )
        earliest_due = (await session.execute(next_due_stmt)).scalar()
        lead.next_follow_up_at = earliest_due
        lead.updated_at = now_dt

    return follow_up

