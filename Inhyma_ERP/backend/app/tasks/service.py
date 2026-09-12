"""
Task Module Service.
"""

from __future__ import annotations

import re
import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Any

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.audit.constants import AuditAction
from app.audit.service import AuditService
from app.core.exceptions import BadRequestException, ForbiddenException, NotFoundException, ValidationException
from app.core.logging import get_logger
from app.events.channels import module_channel, user_channel
from app.events.dispatcher import EventDispatcher
from app.events.models import Event
from app.notifications.service import NotificationService
from app.org_structure.models import DepartmentLeadershipAssignment, EmployeeReportingRelationship
from app.rbac.models import UserRole
from app.tasks.models import (
    ApprovalStatus,
    DependencyType,
    IssueType,
    SprintStatus,
    Task,
    TaskAssignee,
    TaskAttachment,
    TaskComment,
    TaskCommentAttachment,
    TaskDependency,
    TaskEscalation,
    TaskEscalationComment,
    TaskLabel,
    TaskLabelLink,
    TaskMention,
    TaskPriority,
    TaskReaction,
    TaskSavedFilter,
    TaskSprint,
    TaskStatus,
    TaskSubtask,
    TaskSubtaskAttachment,
    TaskSubtaskComment,
    TaskTemplate,
    TaskVoiceNote,
)
from app.tasks.repository import TaskRepository
from app.tasks.schemas import (
    CapacityDayAllocation,
    CapacityViewResponse,
    TaskApprovalActionRequest,
    TaskBulkActionRequest,
    TaskBulkActionResponse,
    TaskCreate,
    TaskDependencyCreate,
    TaskDependencyRead,
    TaskDuplicateRequest,
    TaskEscalateCandidate,
    TaskEscalateOptionsResponse,
    TaskLabelCreate,
    TaskLabelRead,
    TaskReactionSummary,
    TaskSavedFilterCreate,
    TaskSavedFilterRead,
    TaskSavedFilterUpdate,
    TaskSprintCreate,
    TaskSprintRead,
    TaskSprintUpdate,
    TaskSubmitApprovalRequest,
    TaskSummaryRead,
    TaskTemplateCreate,
    TaskTemplateRead,
    TaskTemplateUpdate,
    TaskUpdate,
    UserCapacitySummary,
    UserMiniRead,
    UserWorkloadSummary,
    WorkloadDashboardResponse,
)
from app.users.models import User

logger = get_logger(__name__)


class TaskService:
    """Orchestrates task business logic, RBAC visibility, notifications, and audits."""

    def __init__(
        self,
        repository: TaskRepository,
        audit_service: AuditService,
        notification_service: NotificationService,
        dispatcher: EventDispatcher | None = None,
    ) -> None:
        self.repository = repository
        self.audit_service = audit_service
        self.notification_service = notification_service
        self.dispatcher = dispatcher or EventDispatcher()

    # --- Helpers ---
    async def _assert_can_mutate_task(self, task: Task, current_user: Any, action: str = "update") -> None:
        """
        Enforce strict Object-Level Authorization (BUG-01 & BUG-02).
        Allowed actors:
          - Super Admin / explicit task.manage / task.organization_view
          - Creator (for update or delete)
          - Assignees (for update/assign/dependency/subtasks; delete restricted)
          - Department Manager of creator or any assignee
        """
        user_perms = set(getattr(current_user, "permissions", []))
        is_super_admin = (
            "super_admin" in user_perms
            or "task.organization_view" in user_perms
            or "task.manage" in user_perms
            or "*" in user_perms
        )
        if is_super_admin:
            return

        actor_id = getattr(current_user, "id", None)
        if not actor_id:
            raise ForbiddenException(f"You do not have permission to {action} this task.")

        # Creator can update or delete own task
        if task.created_by == actor_id:
            return

        # Assignees can update, assign, link dependencies, but cannot delete
        is_assignee = any(getattr(a, "user_id", None) == actor_id for a in getattr(task, "assignees", []))
        if is_assignee and action != "delete":
            return

        # Department Manager check: verify if current_user is manager for creator's or assignees' departments
        target_user_ids = {task.created_by} if task.created_by else set()
        for a in getattr(task, "assignees", []):
            if getattr(a, "user_id", None):
                target_user_ids.add(a.user_id)

        if target_user_ids:
            dept_subq = select(UserRole.role_id).where(UserRole.user_id.in_(target_user_ids))
            mgr_stmt = (
                select(DepartmentLeadershipAssignment.id)
                .where(
                    DepartmentLeadershipAssignment.employee_id == actor_id,
                    DepartmentLeadershipAssignment.department_id.in_(dept_subq),
                )
                .limit(1)
            )
            res = await self.repository.session.execute(mgr_stmt)
            if res.scalar_one_or_none():
                return

        # If action is delete and user has explicit task.delete
        if action == "delete" and "task.delete" in user_perms and task.created_by == actor_id:
            return

        raise ForbiddenException(f"You do not have permission to {action} this task.")

    def _to_summary(self, task: Task) -> TaskSummaryRead:
        from sqlalchemy import inspect
        state = inspect(task, raiseerr=False)

        subtasks = state.dict.get("subtasks", []) if state else []
        subtask_total = len(subtasks)
        subtask_completed = sum(1 for s in subtasks if getattr(s, "completed", False) or getattr(s, "status", None) == "DONE")

        raw_labels = state.dict.get("labels", []) if state else []
        labels = [TaskLabelRead.model_validate(l) for l in raw_labels]

        child_tasks = state.dict.get("child_tasks", []) if state else []
        child_count = len(child_tasks)
        child_completed = sum(
            1 for c in child_tasks
            if getattr(c, "status", None) == "DONE" or getattr(getattr(c, "status", None), "value", None) == "DONE"
        )

        creator = state.dict.get("creator") if state else None
        assignees = state.dict.get("assignees", []) if state else []
        comments = state.dict.get("comments", []) if state else []
        escalations = state.dict.get("escalations", []) if state else []
        attachments = state.dict.get("attachments", []) if state else []
        voice_notes = state.dict.get("voice_notes", []) if state else []
        dependencies = state.dict.get("dependencies", []) if state else []
        depends_on_ids = [
            d.depends_on_task_id
            for d in dependencies
            if hasattr(d, "depends_on_task_id") and d.depends_on_task_id is not None
        ]

        issue_type_val = getattr(task, "issue_type", "TASK")
        if hasattr(issue_type_val, "value"):
            issue_type_val = issue_type_val.value

        approval_status_val = getattr(task, "approval_status", "NONE")
        if hasattr(approval_status_val, "value"):
            approval_status_val = approval_status_val.value

        return TaskSummaryRead(
            id=task.id,
            title=task.title,
            description=task.description,
            priority=task.priority,
            status=task.status,
            issue_type=issue_type_val or "TASK",
            parent_task_id=task.parent_task_id,
            parent_task_title=task.parent_task_title,
            sprint_id=task.sprint_id,
            sprint_name=task.sprint_name,
            approval_status=approval_status_val or "NONE",
            start_date=task.start_date,
            due_date=task.due_date,
            hold_reason=task.hold_reason,
            hold_until=task.hold_until,
            created_by=task.created_by,
            creator=UserMiniRead.model_validate(creator) if creator else None,
            created_at=task.created_at,
            updated_at=task.updated_at,
            assignees=assignees,
            labels=labels,
            reactions=[],
            subtask_total=subtask_total,
            subtask_completed=subtask_completed,
            child_task_count=child_count,
            child_task_completed=child_completed,
            progress_percent=task.progress_percent,
            comment_count=len(comments),
            escalation_count=len(escalations),
            attachment_count=len(attachments),
            voice_note_count=len(voice_notes),
            depends_on_task_ids=depends_on_ids,
        )

    async def _broadcast_task_event(
        self,
        event_type: str,
        task: Task,
        *,
        actor_id: uuid.UUID | None = None,
        extra_payload: dict[str, Any] | None = None,
    ) -> None:
        """Broadcast live task event to tasks module channel and affected users."""
        payload = {
            "task_id": str(task.id),
            "title": task.title,
            "status": task.status.value if hasattr(task.status, "value") else str(task.status),
            "priority": task.priority.value if hasattr(task.priority, "value") else str(task.priority),
            "start_date": task.start_date.isoformat() if task.start_date else None,
            "due_date": task.due_date.isoformat() if task.due_date else None,
            "hold_reason": task.hold_reason,
            "hold_until": task.hold_until.isoformat() if task.hold_until else None,
            "issue_type": getattr(task, "issue_type", "TASK"),
            "approval_status": getattr(task, "approval_status", "NONE"),
        }
        if extra_payload:
            payload.update(extra_payload)

        event = Event(
            event_type=event_type,
            entity="task",
            entity_id=str(task.id),
            changes=payload,
        )

        channels = [module_channel("tasks")]
        # Also broadcast directly to creator and assignees
        if task.created_by:
            channels.append(user_channel(task.created_by))
        for a in task.assignees:
            channels.append(user_channel(a.user_id))

        await self.dispatcher.publish_to_channels(
            list(set(channels)), event, exclude_user_id=actor_id
        )

    # --- Task Operations ---
    async def list_tasks(
        self,
        *,
        current_user_id: uuid.UUID,
        user_permissions: set[str],
        view_mode: str = "all",
        department_id: uuid.UUID | None = None,
        department_ids: list[uuid.UUID] | None = None,
        status: TaskStatus | None = None,
        priority: TaskPriority | None = None,
        issue_type: str | None = None,
        parent_task_id: uuid.UUID | None = None,
        sprint_id: uuid.UUID | None = None,
        is_backlog: bool | None = None,
        label_id: uuid.UUID | None = None,
        approval_status: str | None = None,
        assignee_id: uuid.UUID | None = None,
        due_date_from: date | None = None,
        due_date_to: date | None = None,
        search: str | None = None,
        page: int = 1,
        page_size: int = 50,
    ) -> tuple[list[TaskSummaryRead], int]:
        tasks, total = await self.repository.list_tasks(
            current_user_id=current_user_id,
            user_permissions=user_permissions,
            view_mode=view_mode,
            department_id=department_id,
            department_ids=department_ids,
            status=status,
            priority=priority,
            issue_type=issue_type,
            parent_task_id=parent_task_id,
            sprint_id=sprint_id,
            is_backlog=is_backlog,
            label_id=label_id,
            approval_status=approval_status,
            assignee_id=assignee_id,
            due_date_from=due_date_from,
            due_date_to=due_date_to,
            search=search,
            page=page,
            page_size=page_size,
        )
        summaries = [self._to_summary(t) for t in tasks]
        return summaries, total

    async def get_task(self, task_id: uuid.UUID) -> Task:
        task = await self.repository.get_task_by_id(task_id)
        if not task:
            raise NotFoundException(f"Task with ID {task_id} not found.")
        await self.repository.session.refresh(
            task, [
                "assignees",
                "subtasks",
                "comments",
                "escalations",
                "attachments",
                "voice_notes",
                "task_label_links",
                "dependencies",
                "child_tasks",
                "reactions",
            ]
        )
        return task

    async def create_task(
        self,
        payload: TaskCreate,
        current_user: Any,
    ) -> Task:
        if payload.start_date and payload.due_date and payload.due_date < payload.start_date:
            raise ValidationException("Due date cannot be earlier than start date.")

        if payload.parent_task_id:
            parent = await self.repository.get_by_id(payload.parent_task_id)
            if not parent:
                raise ValidationException("Specified parent task does not exist.")

        if payload.sprint_id:
            sprint = await self.repository.get_sprint_by_id(payload.sprint_id)
            if not sprint:
                raise ValidationException("Specified sprint does not exist.")

        hold_reason_val = getattr(payload, "hold_reason", None)
        hold_until_val = getattr(payload, "hold_until", None)
        if payload.status == TaskStatus.ON_HOLD and (not hold_reason_val or not hold_reason_val.strip()):
            raise ValidationException("Hold reason is required when setting task status to ON_HOLD.")

        issue_type_str = payload.issue_type.value if hasattr(payload.issue_type, "value") else str(payload.issue_type or "TASK")
        task = Task(
            title=payload.title,
            description=payload.description,
            priority=payload.priority,
            status=payload.status,
            issue_type=issue_type_str,
            parent_task_id=payload.parent_task_id,
            sprint_id=payload.sprint_id,
            start_date=payload.start_date,
            due_date=payload.due_date,
            hold_reason=hold_reason_val,
            hold_until=hold_until_val,
            created_by=current_user.id,
        )
        if payload.approver_id:
            task.approver_id = payload.approver_id
            task.approval_status = "PENDING_APPROVAL"
            task.status = TaskStatus.PENDING_APPROVAL
        elif issue_type_str == "APPROVAL":
            task.approval_status = "PENDING_APPROVAL"
            task.status = TaskStatus.PENDING_APPROVAL

        self.repository.session.add(task)
        await self.repository.session.flush()

        # Add assignees
        if payload.assignee_ids:
            await self.repository.set_assignees(task, payload.assignee_ids, role="ASSIGNEE")

        # Add watchers
        if payload.watcher_ids:
            await self.repository.set_assignees(task, payload.watcher_ids, role="WATCHER")

        # Add labels
        if payload.label_ids:
            await self.repository.set_task_labels(task.id, payload.label_ids)
        if payload.labels:
            for lbl_name in payload.labels:
                if isinstance(lbl_name, str) and lbl_name.strip():
                    l_obj = await self.repository.get_or_create_label(lbl_name.strip())
                    await self.repository.add_task_label(task.id, l_obj.id)

        # Add initial subtasks
        if payload.subtasks:
            for idx, sub_item in enumerate(payload.subtasks):
                if isinstance(sub_item, str):
                    if sub_item.strip():
                        await self.repository.create_subtask(
                            task.id,
                            title=sub_item.strip(),
                            order_index=idx,
                        )
                else:
                    p_val = sub_item.priority.value if hasattr(sub_item.priority, "value") else str(sub_item.priority or "MEDIUM")
                    s_val = sub_item.status.value if hasattr(sub_item.status, "value") else str(sub_item.status or "TODO")
                    sub_created = await self.repository.create_subtask(
                        task.id,
                        title=sub_item.title,
                        description=sub_item.description,
                        priority=p_val,
                        status=s_val,
                        start_date=sub_item.start_date,
                        due_date=sub_item.due_date,
                        assignee_id=sub_item.assignee_id,
                        assignee_ids=sub_item.assignee_ids,
                        order_index=sub_item.order_index or idx,
                    )
                    for sub_uid in (sub_item.assignee_ids or []):
                        if sub_uid != current_user.id:
                            await self.notification_service.notify_user(
                                user_id=sub_uid,
                                type="subtask_assigned",
                                title="Subtask Assigned",
                                message=f"You have been assigned to subtask '{sub_item.title}' on task: {task.title}",
                                link=f"/tasks?id={task.id}",
                            )

        # Add initial escalation if supplied
        if payload.initial_escalation:
            init_esc = payload.initial_escalation
            await self.repository.add_escalation(
                task_id=task.id,
                from_user=current_user.id,
                to_user=init_esc.escalated_to_id,
                reason=init_esc.reason,
                escalation_type=init_esc.escalation_type,
                due_date=init_esc.due_date,
            )
            if init_esc.escalated_to_id != current_user.id:
                await self.notification_service.notify_user(
                    user_id=init_esc.escalated_to_id,
                    type="task_escalated",
                    title="Task Escalated",
                    message=f"Task '{task.title}' was escalated to you during creation: {init_esc.reason}",
                    link=f"/tasks?id={task.id}&drawerTab=escalations",
                )

        # Add initial attachments if supplied
        if payload.attachments:
            for att in payload.attachments:
                await self.repository.add_attachment(
                    task_id=task.id,
                    user_id=current_user.id,
                    file_name=att.file_name,
                    file_url=att.file_url,
                    file_size=att.file_size,
                    file_type=att.file_type,
                )

        # Add initial voice notes if supplied
        if payload.voice_notes:
            for vn in payload.voice_notes:
                await self.repository.add_voice_note(
                    task_id=task.id,
                    user_id=current_user.id,
                    audio_url=vn.audio_url,
                    duration_seconds=vn.duration_seconds,
                    file_size=vn.file_size,
                    mime_type=vn.mime_type or "audio/webm",
                    title=vn.title,
                )

        await self.repository.session.commit()
        refreshed = await self.get_task(task.id)

        # Audit Log
        await self.audit_service.record(
            action=AuditAction.CREATE,
            module="tasks",
            user_id=current_user.id,
            username_snapshot=current_user.username,
            entity_type="Task",
            entity_id=str(refreshed.id),
            new_values={
                "title": refreshed.title,
                "priority": refreshed.priority.value,
                "status": refreshed.status.value,
                "start_date": refreshed.start_date.isoformat() if refreshed.start_date else None,
                "due_date": refreshed.due_date.isoformat() if refreshed.due_date else None,
                "assignee_count": len(refreshed.assignees),
            },
            description=f"Created task '{refreshed.title}'",
        )

        # Stored & Real-Time Notifications for Assignees
        for a in refreshed.assignees:
            if a.assignment_role != "WATCHER" and a.user_id != current_user.id:
                await self.notification_service.notify_user(
                    user_id=a.user_id,
                    type="task_assigned",
                    title="Task Assigned",
                    message=f"You have been assigned to task: {refreshed.title}",
                    link=f"/tasks?id={refreshed.id}",
                )
            elif a.assignment_role == "WATCHER" and a.user_id != current_user.id:
                await self.notification_service.notify_user(
                    user_id=a.user_id,
                    type="task_watcher",
                    title="Task Watcher Added",
                    message=f"You have been added as a watcher to task: {refreshed.title}",
                    link=f"/tasks?id={refreshed.id}",
                )

        # Broadcast WebSocket event
        await self._broadcast_task_event(
            "TASK_CREATED", refreshed, actor_id=current_user.id
        )

        return refreshed

    async def update_task(
        self,
        task_id: uuid.UUID,
        payload: TaskUpdate,
        current_user: Any,
    ) -> Task:
        task = await self.get_task(task_id)
        await self._assert_can_mutate_task(task, current_user, action="update")

        new_start = payload.start_date if payload.start_date is not None else task.start_date
        new_due = payload.due_date if payload.due_date is not None else task.due_date
        if new_start and new_due and new_due < new_start:
            raise ValidationException("Due date cannot be earlier than start date.")

        if payload.parent_task_id is not None:
            if payload.parent_task_id == task_id:
                raise ValidationException("A task cannot be its own parent.")
            parent = await self.repository.get_by_id(payload.parent_task_id)
            if not parent:
                raise ValidationException("Specified parent task does not exist.")

        if payload.sprint_id is not None:
            sprint = await self.repository.get_sprint_by_id(payload.sprint_id)
            if not sprint:
                raise ValidationException("Specified sprint does not exist.")

        old_values = {
            "title": task.title,
            "description": task.description,
            "priority": task.priority.value if hasattr(task.priority, "value") else str(task.priority or "MEDIUM"),
            "status": task.status.value if hasattr(task.status, "value") else str(task.status or "TODO"),
            "start_date": task.start_date.isoformat() if task.start_date else None,
            "due_date": task.due_date.isoformat() if task.due_date else None,
            "hold_reason": task.hold_reason,
            "hold_until": task.hold_until.isoformat() if task.hold_until else None,
        }

        if payload.title is not None:
            task.title = payload.title
        if payload.description is not None:
            task.description = payload.description
        if payload.priority is not None:
            task.priority = payload.priority
        if payload.start_date is not None:
            task.start_date = payload.start_date
        if payload.due_date is not None:
            task.due_date = payload.due_date
        if payload.hold_reason is not None:
            task.hold_reason = payload.hold_reason
        if payload.hold_until is not None:
            task.hold_until = payload.hold_until
        if payload.issue_type is not None:
            task.issue_type = payload.issue_type.value if hasattr(payload.issue_type, "value") else str(payload.issue_type)
        if payload.parent_task_id is not None:
            task.parent_task_id = payload.parent_task_id
        if payload.sprint_id is not None:
            task.sprint_id = payload.sprint_id
        if payload.approval_status is not None:
            task.approval_status = payload.approval_status.value if hasattr(payload.approval_status, "value") else str(payload.approval_status)
        if payload.approver_id is not None:
            task.approver_id = payload.approver_id
        if payload.approval_notes is not None:
            task.approval_notes = payload.approval_notes

        status_changed_to_done = False
        status_changed_to_hold = False
        status_changed_from_hold = False

        if payload.status is not None:
            if payload.status == TaskStatus.DONE:
                # Check all BLOCKED_BY dependencies (BUG-03)
                incomplete_blockers: list[str] = []
                for dep in getattr(task, "dependencies", []):
                    dep_type = dep.dependency_type.value if hasattr(dep.dependency_type, "value") else str(dep.dependency_type)
                    if dep_type == "BLOCKED_BY":
                        dep_task = await self.repository.get_task_by_id(dep.depends_on_task_id)
                        if dep_task and dep_task.status != TaskStatus.DONE:
                            incomplete_blockers.append(dep_task.title)
                for dep in getattr(task, "dependent_on", []):
                    dep_type = dep.dependency_type.value if hasattr(dep.dependency_type, "value") else str(dep.dependency_type)
                    if dep_type == "BLOCKS":
                        dep_task = await self.repository.get_task_by_id(dep.task_id)
                        if dep_task and dep_task.status != TaskStatus.DONE:
                            incomplete_blockers.append(dep_task.title)
                if incomplete_blockers:
                    raise ValidationException(
                        f"Cannot complete task. Blocked by: {', '.join(incomplete_blockers)}"
                    )

            if payload.status == TaskStatus.ON_HOLD:
                hold_reason_check = payload.hold_reason or task.hold_reason
                if not hold_reason_check or not hold_reason_check.strip():
                    raise ValidationException("A valid, non-empty hold reason is required when placing a task ON_HOLD.")

            if task.status != TaskStatus.DONE and payload.status == TaskStatus.DONE:
                status_changed_to_done = True
            if task.status != TaskStatus.ON_HOLD and payload.status == TaskStatus.ON_HOLD:
                status_changed_to_hold = True
            if task.status == TaskStatus.ON_HOLD and payload.status not in (None, TaskStatus.ON_HOLD):
                status_changed_from_hold = True
            task.status = payload.status

        task.version += 1
        await self.repository.session.commit()
        refreshed = await self.get_task(task.id)

        new_values = {
            "title": refreshed.title,
            "description": refreshed.description,
            "priority": refreshed.priority.value,
            "status": refreshed.status.value,
            "start_date": refreshed.start_date.isoformat() if refreshed.start_date else None,
            "due_date": refreshed.due_date.isoformat() if refreshed.due_date else None,
            "hold_reason": refreshed.hold_reason,
            "hold_until": refreshed.hold_until.isoformat() if refreshed.hold_until else None,
        }

        # Audit Log
        await self.audit_service.record(
            action=AuditAction.UPDATE,
            module="tasks",
            user_id=current_user.id,
            username_snapshot=current_user.username,
            entity_type="Task",
            entity_id=str(refreshed.id),
            old_values=old_values,
            new_values=new_values,
            description=f"Updated task '{refreshed.title}'",
        )

        # Recipients for notifications
        recipients = {a.user_id for a in refreshed.assignees}
        if refreshed.created_by:
            recipients.add(refreshed.created_by)
        recipients.discard(current_user.id)

        # Notify on task completed
        if status_changed_to_done:
            for uid in recipients:
                await self.notification_service.notify_user(
                    user_id=uid,
                    type="task_completed",
                    title="Task Completed",
                    message=f"Task '{refreshed.title}' has been marked as Completed by {current_user.username}",
                    link=f"/tasks?id={refreshed.id}",
                )
        elif status_changed_to_hold:
            for uid in recipients:
                await self.notification_service.notify_user(
                    user_id=uid,
                    type="hold_started",
                    title="Task Put On Hold",
                    message=f"Task '{refreshed.title}' has been put on hold: {refreshed.hold_reason or 'No reason specified'} (Hold until: {refreshed.hold_until or 'Unspecified'})",
                    link=f"/tasks?id={refreshed.id}",
                )
        elif status_changed_from_hold:
            for uid in recipients:
                await self.notification_service.notify_user(
                    user_id=uid,
                    type="hold_ended",
                    title="Task Hold Ended",
                    message=f"Task '{refreshed.title}' hold has ended and is now {refreshed.status.value}.",
                    link=f"/tasks?id={refreshed.id}",
                )
        else:
            for uid in recipients:
                await self.notification_service.notify_user(
                    user_id=uid,
                    type="task_updated",
                    title="Task Updated",
                    message=f"Task '{refreshed.title}' was updated by {current_user.username}",
                    link=f"/tasks?id={refreshed.id}",
                )

        await self._broadcast_task_event("TASK_UPDATED", refreshed, actor_id=current_user.id)
        return refreshed

    async def check_expired_holds(self) -> int:
        """Find tasks currently ON_HOLD where hold_until <= today, and send notifications."""
        today = date.today()
        stmt = (
            select(Task)
            .where(
                Task.deleted_at.is_(None),
                Task.status == TaskStatus.ON_HOLD,
                Task.hold_until.is_not(None),
                Task.hold_until <= today,
            )
        )
        res = await self.repository.session.execute(stmt)
        tasks = list(res.scalars().all())
        notified_count = 0
        for task in tasks:
            await self.repository.session.refresh(task, ["assignees"])
            recipients = {a.user_id for a in task.assignees}
            if task.created_by:
                recipients.add(task.created_by)
            for uid in recipients:
                await self.notification_service.notify_user(
                    user_id=uid,
                    type="hold_ended",
                    title="Task Hold Period Ended",
                    message=f"Task hold period has ended for '{task.title}'.",
                    link=f"/tasks?id={task.id}",
                )
                notified_count += 1
            await self._broadcast_task_event("TASK_HOLD_EXPIRED", task)
        return len(tasks)

    async def check_task_deadlines(self, user_id: uuid.UUID | None = None) -> int:
        """
        Check for approaching or overdue task deadlines and escalation targets.
        Alerts users strictly for tasks assigned to them (or created by them)
        and escalations assigned to them.
        """
        today = date.today()
        tomorrow = today + timedelta(days=1)
        notified_count = 0

        # 1. Fetch active tasks with deadlines
        stmt = (
            select(Task)
            .where(
                Task.deleted_at.is_(None),
                Task.status != TaskStatus.DONE,
                Task.due_date.is_not(None),
            )
        )
        res = await self.repository.session.execute(stmt)
        tasks = list(res.scalars().all())

        for task in tasks:
            await self.repository.session.refresh(task, ["assignees", "escalations"])

            # Determine relevant users: assignees and creator
            task_users = {a.user_id for a in task.assignees if a.assignment_role != "WATCHER"}
            if task.created_by:
                task_users.add(task.created_by)

            # If user_id is specified, filter to strictly that user (themself)
            if user_id is not None:
                if user_id not in task_users:
                    task_users = set()
                else:
                    task_users = {user_id}

            if task.due_date:
                link_url = f"/tasks?id={task.id}"
                # Overdue
                if task.due_date < today:
                    notif_type = "task_overdue"
                    title = "⚠️ Task Overdue"
                    message = f"Task '{task.title}' was due on {task.due_date} and is overdue."
                # Due today
                elif task.due_date == today:
                    notif_type = "task_deadline_today"
                    title = "📅 Task Due Today"
                    message = f"Task '{task.title}' is due today ({today})."
                # Due tomorrow
                elif task.due_date == tomorrow:
                    notif_type = "task_deadline_approaching"
                    title = "⏰ Task Due Tomorrow"
                    message = f"Task '{task.title}' is due tomorrow ({task.due_date})."
                else:
                    notif_type = None
                    title = None
                    message = None

                if notif_type and title and message:
                    for uid in task_users:
                        # Deduplicate within 20 hours to prevent repetitive spam
                        already_sent = await self.notification_service.has_recent_notification(
                            uid, notif_type, link_url, within_hours=20
                        )
                        if not already_sent:
                            await self.notification_service.notify_user(
                                user_id=uid,
                                type=notif_type,
                                title=title,
                                message=message,
                                link=link_url,
                            )
                            notified_count += 1

            # 2. Check escalations assigned to user(s)
            for esc in (task.escalations or []):
                esc_target = esc.to_user
                if not esc_target:
                    continue
                # Only notify if they were assigned for escalation
                if user_id is not None and esc_target != user_id:
                    continue

                esc_link = f"/tasks?id={task.id}&drawerTab=escalations"
                if esc.due_date:
                    if esc.due_date < today:
                        esc_type = "escalation_overdue"
                        esc_title = "🚨 Escalation Resolution Overdue"
                        esc_msg = f"Escalation on task '{task.title}' assigned to you was due on {esc.due_date}."
                    elif esc.due_date == today:
                        esc_type = "escalation_deadline"
                        esc_title = "⚡ Escalation Due Today"
                        esc_msg = f"Escalation on task '{task.title}' assigned to you is due today ({today})."
                    else:
                        esc_type = None
                        esc_title = None
                        esc_msg = None

                    if esc_type and esc_title and esc_msg:
                        already_sent = await self.notification_service.has_recent_notification(
                            esc_target, esc_type, esc_link, within_hours=20
                        )
                        if not already_sent:
                            await self.notification_service.notify_user(
                                user_id=esc_target,
                                type=esc_type,
                                title=esc_title,
                                message=esc_msg,
                                link=esc_link,
                            )
                            notified_count += 1

        return notified_count

    async def assign_task(
        self,
        task_id: uuid.UUID,
        user_ids: list[uuid.UUID],
        current_user: Any,
        role: str = "ASSIGNEE",
    ) -> Task:
        task = await self.get_task(task_id)
        await self._assert_can_mutate_task(task, current_user, action="assign users to")
        old_ids = {a.user_id for a in task.assignees if a.assignment_role == role}
        await self.repository.set_assignees(task, user_ids, role=role)
        await self.repository.session.commit()
        refreshed = await self.get_task(task.id)

        newly_added = set(user_ids) - old_ids
        for uid in newly_added:
            if uid != current_user.id:
                notif_type = "task_watcher" if role == "WATCHER" else "task_assigned"
                title_str = "Task Watcher Added" if role == "WATCHER" else "Task Assigned"
                msg_str = (
                    f"You have been added as a watcher to task: {refreshed.title}"
                    if role == "WATCHER"
                    else f"You have been assigned to task: {refreshed.title}"
                )
                await self.notification_service.notify_user(
                    user_id=uid,
                    type=notif_type,
                    title=title_str,
                    message=msg_str,
                    link=f"/tasks?id={refreshed.id}",
                )

        await self.audit_service.record(
            action=AuditAction.ROLE_ASSIGNED,
            module="tasks",
            user_id=current_user.id,
            username_snapshot=current_user.username,
            entity_type="Task",
            entity_id=str(refreshed.id),
            new_values={"role": role, "user_ids": [str(u) for u in user_ids]},
            description=f"Updated {role.lower()}s for task '{refreshed.title}'",
        )

        await self._broadcast_task_event("TASK_ASSIGNED", refreshed, actor_id=current_user.id)
        return refreshed

    async def _process_mentions(
        self,
        text: str,
        task_id: uuid.UUID,
        comment_id: uuid.UUID | None,
        author: Any,
        task_title: str,
    ) -> list[TaskMention]:
        mentions_created: list[TaskMention] = []
        tokens = re.findall(r"@([a-zA-Z0-9_.@-]+)", text)
        if not tokens:
            return mentions_created

        for token in set(tokens):
            user = None
            try:
                u_id = uuid.UUID(token)
                stmt = select(User).where(User.id == u_id, User.is_active.is_(True), User.deleted_at.is_(None))
                res = await self.repository.session.execute(stmt)
                user = res.scalar_one_or_none()
            except ValueError:
                pass

            if not user:
                stmt = select(User).where(
                    or_(
                        func.lower(User.username) == token.lower(),
                        func.lower(User.email) == token.lower(),
                        func.lower(User.first_name) == token.lower(),
                        func.lower(User.display_name) == token.lower(),
                    ),
                    User.is_active.is_(True),
                    User.deleted_at.is_(None),
                )
                res = await self.repository.session.execute(stmt)
                user = res.scalar_one_or_none()

            if user and user.id != author.id:
                mention = await self.repository.create_mention(
                    task_id=task_id,
                    mentioned_user_id=user.id,
                    mentioned_by=author.id,
                    comment_id=comment_id,
                )
                mentions_created.append(mention)

                author_name = author.username or getattr(author, "full_name", "Someone")
                await self.notification_service.notify_user(
                    user_id=user.id,
                    type="task_mention",
                    title="You were mentioned in a task",
                    message=f"{author_name} mentioned you in task '{task_title}': {text[:80]}",
                    link=f"/tasks?id={task_id}",
                )

                event = Event(
                    event_type="TASK_MENTION",
                    entity="task",
                    entity_id=str(task_id),
                    changes={
                        "task_id": str(task_id),
                        "comment_id": str(comment_id) if comment_id else None,
                        "mentioned_by": author_name,
                        "text": text[:100],
                    },
                )
                await self.dispatcher.publish_to_channels([user_channel(user.id)], event)

        return mentions_created

    async def add_comment(
        self,
        task_id: uuid.UUID,
        message: str,
        current_user: Any,
        audio_url: str | None = None,
        attachments: list[dict[str, Any]] | None = None,
    ) -> TaskComment:
        task = await self.get_task(task_id)
        comment = await self.repository.add_comment(
            task.id, current_user.id, message, audio_url=audio_url, attachments_data=attachments
        )
        await self.repository.session.commit()
        await self.repository.session.refresh(comment, ["attachments"])

        # Process mentions
        await self._process_mentions(message, task.id, comment.id, current_user, task.title)

        # Audit
        await self.audit_service.record(
            action=AuditAction.UPDATE,
            module="tasks",
            user_id=current_user.id,
            username_snapshot=current_user.username,
            entity_type="TaskComment",
            entity_id=str(comment.id),
            new_values={"task_id": str(task.id), "message": message[:100], "audio_url": audio_url},
            description=f"Commented on task '{task.title}'",
        )

        # Notify creator and assignees
        recipients = {a.user_id for a in task.assignees}
        if task.created_by:
            recipients.add(task.created_by)
        recipients.discard(current_user.id)

        has_audio = bool(audio_url)
        has_att = bool(attachments)
        addon_text = " (with voice note)" if has_audio else (" (with attachment)" if has_att else "")

        for uid in recipients:
            await self.notification_service.notify_user(
                user_id=uid,
                type="comment_added",
                title="New Task Comment",
                message=f"{current_user.username} commented on '{task.title}'{addon_text}: {message[:80]}",
                link=f"/tasks?id={task.id}",
            )

        await self._broadcast_task_event(
            "TASK_COMMENT",
            task,
            actor_id=current_user.id,
            extra_payload={"comment_id": str(comment.id), "author": current_user.username},
        )
        return comment

    async def add_attachment(
        self,
        task_id: uuid.UUID,
        file_name: str,
        file_url: str,
        file_size: int,
        file_type: str | None,
        current_user: Any,
    ) -> TaskAttachment:
        task = await self.get_task(task_id)
        attachment = await self.repository.add_attachment(
            task.id,
            current_user.id,
            file_name=file_name,
            file_url=file_url,
            file_size=file_size,
            file_type=file_type,
        )
        await self.repository.session.commit()
        await self.repository.session.refresh(attachment)

        await self.audit_service.record(
            action=AuditAction.UPDATE,
            module="tasks",
            user_id=current_user.id,
            username_snapshot=current_user.username,
            entity_type="TaskAttachment",
            entity_id=str(attachment.id),
            new_values={"task_id": str(task.id), "file_name": file_name, "file_url": file_url},
            description=f"Uploaded attachment '{file_name}' to task '{task.title}'",
        )

        recipients = {a.user_id for a in task.assignees}
        if task.created_by:
            recipients.add(task.created_by)
        recipients.discard(current_user.id)

        for uid in recipients:
            await self.notification_service.notify_user(
                user_id=uid,
                type="task_attachment_added",
                title="New Task Attachment",
                message=f"{current_user.username} added attachment '{file_name}' to task: {task.title}",
                link=f"/tasks?id={task.id}",
            )

        await self._broadcast_task_event(
            "TASK_ATTACHMENT_ADDED",
            task,
            actor_id=current_user.id,
            extra_payload={"attachment_id": str(attachment.id), "file_name": file_name},
        )
        return attachment

    async def delete_attachment(self, attachment_id: uuid.UUID, current_user: Any) -> None:
        attachment = await self.repository.get_attachment_by_id(attachment_id)
        if not attachment:
            raise NotFoundException(f"Attachment with ID {attachment_id} not found.")
        task = await self.get_task(attachment.task_id)
        await self.repository.delete_attachment(attachment)
        await self.repository.session.commit()
        await self._broadcast_task_event("TASK_UPDATED", task, actor_id=current_user.id)

    async def add_voice_note(
        self,
        task_id: uuid.UUID,
        audio_url: str,
        duration_seconds: int,
        file_size: int,
        mime_type: str,
        title: str | None,
        current_user: Any,
    ) -> TaskVoiceNote:
        task = await self.get_task(task_id)
        vn = await self.repository.add_voice_note(
            task.id,
            current_user.id,
            audio_url=audio_url,
            duration_seconds=duration_seconds,
            file_size=file_size,
            mime_type=mime_type,
            title=title,
        )
        await self.repository.session.commit()
        await self.repository.session.refresh(vn)

        await self.audit_service.record(
            action=AuditAction.UPDATE,
            module="tasks",
            user_id=current_user.id,
            username_snapshot=current_user.username,
            entity_type="TaskVoiceNote",
            entity_id=str(vn.id),
            new_values={"task_id": str(task.id), "duration_seconds": duration_seconds, "audio_url": audio_url},
            description=f"Added voice note to task '{task.title}'",
        )

        recipients = {a.user_id for a in task.assignees}
        if task.created_by:
            recipients.add(task.created_by)
        recipients.discard(current_user.id)

        for uid in recipients:
            await self.notification_service.notify_user(
                user_id=uid,
                type="task_voice_note_added",
                title="New Task Voice Note",
                message=f"{current_user.username} recorded a voice note ({duration_seconds}s) on task: {task.title}",
                link=f"/tasks?id={task.id}",
            )

        await self._broadcast_task_event(
            "TASK_VOICE_NOTE_ADDED",
            task,
            actor_id=current_user.id,
            extra_payload={"voice_note_id": str(vn.id), "duration_seconds": duration_seconds},
        )
        return vn

    async def add_subtask_comment(
        self,
        subtask_id: uuid.UUID,
        message: str,
        current_user: Any,
        audio_url: str | None = None,
    ) -> TaskSubtaskComment:
        subtask = await self.repository.get_subtask_by_id(subtask_id)
        if not subtask:
            raise NotFoundException(f"Subtask with ID {subtask_id} not found.")
        task = await self.get_task(subtask.task_id)

        sc = await self.repository.add_subtask_comment(
            subtask.id, current_user.id, message, audio_url=audio_url
        )
        await self.repository.session.commit()
        await self.repository.session.refresh(sc)

        await self._process_mentions(message, task.id, None, current_user, f"Subtask '{subtask.title}' on {task.title}")

        recipients = {a.user_id for a in subtask.assignees}
        if subtask.assignee_id:
            recipients.add(subtask.assignee_id)
        if task.created_by:
            recipients.add(task.created_by)
        recipients.discard(current_user.id)

        for uid in recipients:
            await self.notification_service.notify_user(
                user_id=uid,
                type="subtask_comment_added",
                title="Subtask Discussion Update",
                message=f"{current_user.username} replied on subtask '{subtask.title}' ({task.title}): {message[:80]}",
                link=f"/tasks?id={task.id}",
            )

        await self._broadcast_task_event(
            "SUBTASK_COMMENT_ADDED",
            task,
            actor_id=current_user.id,
            extra_payload={"subtask_id": str(subtask.id), "comment_id": str(sc.id)},
        )
        return sc

    async def list_subtask_comments(self, subtask_id: uuid.UUID) -> list[TaskSubtaskComment]:
        subtask = await self.repository.get_subtask_by_id(subtask_id)
        if not subtask:
            raise NotFoundException(f"Subtask with ID {subtask_id} not found.")
        return await self.repository.list_subtask_comments(subtask_id)

    async def add_subtask_attachment(
        self,
        subtask_id: uuid.UUID,
        file_name: str,
        file_url: str,
        file_size: int,
        file_type: str | None,
        current_user: Any,
    ) -> TaskSubtaskAttachment:
        subtask = await self.repository.get_subtask_by_id(subtask_id)
        if not subtask:
            raise NotFoundException(f"Subtask with ID {subtask_id} not found.")
        task = await self.get_task(subtask.task_id)

        sa = await self.repository.add_subtask_attachment(
            subtask.id,
            current_user.id,
            file_name=file_name,
            file_url=file_url,
            file_size=file_size,
            file_type=file_type,
        )
        await self.repository.session.commit()
        await self.repository.session.refresh(sa)

        await self._broadcast_task_event(
            "SUBTASK_ATTACHMENT_ADDED",
            task,
            actor_id=current_user.id,
            extra_payload={"subtask_id": str(subtask.id), "attachment_id": str(sa.id)},
        )
        return sa

    async def list_subtask_attachments(self, subtask_id: uuid.UUID) -> list[TaskSubtaskAttachment]:
        subtask = await self.repository.get_subtask_by_id(subtask_id)
        if not subtask:
            raise NotFoundException(f"Subtask with ID {subtask_id} not found.")
        return await self.repository.list_subtask_attachments(subtask_id)

    # --- Escalation Discussion ---
    async def add_escalation_comment(
        self,
        escalation_id: uuid.UUID,
        message: str,
        current_user: Any,
        audio_url: str | None = None,
    ) -> TaskEscalationComment:
        esc = await self.repository.get_escalation_by_id(escalation_id)
        if not esc:
            raise NotFoundException(f"Escalation with ID {escalation_id} not found.")
        task = await self.get_task(esc.task_id)

        ec = await self.repository.add_escalation_comment(
            esc.id, current_user.id, message, audio_url=audio_url
        )
        await self.repository.session.commit()
        await self.repository.session.refresh(ec)

        await self._process_mentions(message, task.id, None, current_user, f"Escalation on {task.title}")

        recipients = {esc.from_user, esc.to_user}
        if task.created_by:
            recipients.add(task.created_by)
        recipients.discard(current_user.id)

        for uid in recipients:
            await self.notification_service.notify_user(
                user_id=uid,
                type="escalation_comment_added",
                title="Escalation Thread Update",
                message=f"{current_user.username} replied on escalation ({task.title}): {message[:80]}",
                link=f"/tasks?id={task.id}",
            )

        await self._broadcast_task_event(
            "ESCALATION_COMMENT_ADDED",
            task,
            actor_id=current_user.id,
            extra_payload={"escalation_id": str(esc.id), "comment_id": str(ec.id)},
        )
        return ec

    async def list_escalation_comments(self, escalation_id: uuid.UUID) -> list[TaskEscalationComment]:
        esc = await self.repository.get_escalation_by_id(escalation_id)
        if not esc:
            raise NotFoundException(f"Escalation with ID {escalation_id} not found.")
        return await self.repository.list_escalation_comments(escalation_id)

    async def escalate_task(
        self,
        task_id: uuid.UUID,
        to_user: uuid.UUID,
        reason: str,
        current_user: Any,
        *,
        escalation_type: str = "ORGANIZATION_USER",
        due_date: date | None = None,
    ) -> TaskEscalation:
        if not to_user:
            raise ValidationException("Escalation target user is required.")
        if not reason or not reason.strip():
            raise ValidationException("A clear reason is required for escalation.")
        if not due_date:
            raise ValidationException("SLA resolution due date is required for escalation.")

        task = await self.get_task(task_id)
        esc = await self.repository.add_escalation(
            task.id,
            from_user=current_user.id,
            to_user=to_user,
            reason=reason,
            escalation_type=escalation_type,
            due_date=due_date,
        )
        await self.repository.session.commit()

        # Audit Log
        await self.audit_service.record(
            action=AuditAction.UPDATE,
            module="tasks",
            user_id=current_user.id,
            username_snapshot=current_user.username,
            entity_type="TaskEscalation",
            entity_id=str(esc.id),
            new_values={
                "task_id": str(task.id),
                "to_user": str(to_user),
                "reason": reason,
                "escalation_type": escalation_type,
                "due_date": due_date.isoformat() if due_date else None,
            },
            description=f"Escalated task '{task.title}' ({escalation_type})",
        )

        # Notify to_user
        await self.notification_service.notify_user(
            user_id=to_user,
            type="task_escalated",
            title="Task Escalated to You",
            message=f"Task '{task.title}' was escalated to you by {current_user.username}: {reason}",
            link=f"/tasks?id={task.id}&drawerTab=escalations",
        )

        await self._broadcast_task_event(
            "TASK_ESCALATED",
            task,
            actor_id=current_user.id,
            extra_payload={
                "to_user": str(to_user),
                "reason": reason,
                "escalation_type": escalation_type,
            },
        )
        return esc

    async def add_subtask(
        self,
        task_id: uuid.UUID,
        title: str,
        *,
        description: str | None = None,
        priority: str = "MEDIUM",
        status: str = "TODO",
        start_date: date | None = None,
        due_date: date | None = None,
        assignee_id: uuid.UUID | None = None,
        assignee_ids: list[uuid.UUID] | None = None,
        order_index: int = 0,
        current_user: Any,
    ) -> TaskSubtask:
        task = await self.get_task(task_id)
        subtask = await self.repository.create_subtask(
            task.id,
            title,
            description=description,
            priority=priority,
            status=status,
            start_date=start_date,
            due_date=due_date,
            assignee_id=assignee_id,
            assignee_ids=assignee_ids,
            order_index=order_index,
        )
        await self.repository.session.commit()

        notify_uids = list(assignee_ids or [])
        if assignee_id and assignee_id not in notify_uids:
            notify_uids.append(assignee_id)

        for uid in notify_uids:
            if uid != current_user.id:
                await self.notification_service.notify_user(
                    user_id=uid,
                    type="subtask_assigned",
                    title="Subtask Assigned",
                    message=f"You have been assigned to subtask '{title}' on task: {task.title}",
                    link=f"/tasks?id={task.id}",
                )

        await self._broadcast_task_event("TASK_UPDATED", task, actor_id=current_user.id)
        return subtask

    async def update_subtask(
        self,
        subtask_id: uuid.UUID,
        *,
        title: str | None = None,
        description: str | None = None,
        priority: str | None = None,
        status: str | None = None,
        start_date: date | None = None,
        due_date: date | None = None,
        completed: bool | None = None,
        assignee_id: uuid.UUID | None = None,
        assignee_ids: list[uuid.UUID] | None = None,
        order_index: int | None = None,
        current_user: Any,
    ) -> TaskSubtask:
        subtask = await self.repository.get_subtask_by_id(subtask_id)
        if not subtask:
            raise NotFoundException(f"Subtask with ID {subtask_id} not found.")

        was_completed = subtask.completed or subtask.status == "DONE"
        task = await self.get_task(subtask.task_id)
        updated = await self.repository.update_subtask(
            subtask,
            title=title,
            description=description,
            priority=priority,
            status=status,
            start_date=start_date,
            due_date=due_date,
            completed=completed,
            assignee_id=assignee_id,
            assignee_ids=assignee_ids,
            order_index=order_index,
        )
        await self.repository.session.commit()

        # Check if subtask transitioned to completed
        is_now_completed = updated.completed or updated.status == "DONE"
        if not was_completed and is_now_completed:
            recipients = {a.user_id for a in task.assignees}
            if task.created_by:
                recipients.add(task.created_by)
            recipients.discard(current_user.id)
            for uid in recipients:
                await self.notification_service.notify_user(
                    user_id=uid,
                    type="subtask_completed",
                    title="Subtask Completed",
                    message=f"Subtask '{updated.title}' was marked complete by {current_user.username}",
                    link=f"/tasks?id={task.id}",
                )

        await self._broadcast_task_event("TASK_UPDATED", task, actor_id=current_user.id)
        return updated

    async def delete_subtask(self, subtask_id: uuid.UUID, current_user: Any) -> None:
        subtask = await self.repository.get_subtask_by_id(subtask_id)
        if not subtask:
            raise NotFoundException(f"Subtask with ID {subtask_id} not found.")
        task = await self.get_task(subtask.task_id)
        await self.repository.delete_subtask(subtask)
        await self.repository.session.commit()
        await self._broadcast_task_event("TASK_UPDATED", task, actor_id=current_user.id)

    async def soft_delete_task(self, task_id: uuid.UUID, current_user: Any) -> None:
        task = await self.get_task(task_id)
        await self._assert_can_mutate_task(task, current_user, action="delete")
        task.deleted_at = datetime.now(timezone.utc)
        task.deleted_by = current_user.id
        await self.repository.session.commit()

        await self.audit_service.record(
            action=AuditAction.DELETE,
            module="tasks",
            user_id=current_user.id,
            username_snapshot=current_user.username,
            entity_type="Task",
            entity_id=str(task.id),
            description=f"Soft-deleted task '{task.title}'",
        )

        await self._broadcast_task_event("TASK_UPDATED", task, actor_id=current_user.id)

    async def get_task_timeline(self, task_id: uuid.UUID) -> list[dict[str, Any]]:
        """Synthesize chronological activity timeline from task creation, assignees, subtasks, escalations, comments, and audits."""
        task = await self.get_task(task_id)
        timeline: list[dict[str, Any]] = []

        # 1. Task Created
        timeline.append({
            "id": f"created-{task.id}",
            "timestamp": task.created_at,
            "actor_id": task.created_by,
            "actor_name": task.creator.full_name if task.creator else "System",
            "event_type": "TASK_CREATED",
            "description": f"Created task '{task.title}'",
            "details": {
                "priority": task.priority.value,
                "status": task.status.value,
                "due_date": task.due_date.isoformat() if task.due_date else None,
            },
        })

        # 2. Assignees
        for a in task.assignees:
            role_label = a.assignment_role.capitalize()
            user_name = a.user.full_name if a.user else "User"
            timeline.append({
                "id": f"assignee-{a.id}",
                "timestamp": a.created_at,
                "actor_id": None,
                "actor_name": "Task System",
                "event_type": "USER_ASSIGNED",
                "description": f"Added {user_name} as {role_label}",
                "details": {"role": a.assignment_role, "user_id": str(a.user_id)},
            })

        # 3. Subtasks
        for s in task.subtasks:
            timeline.append({
                "id": f"subtask-{s.id}",
                "timestamp": s.created_at,
                "actor_id": None,
                "actor_name": "Task System",
                "event_type": "SUBTASK_CREATED",
                "description": f"Created subtask '{s.title}'",
                "details": {
                    "priority": s.priority,
                    "status": s.status,
                    "due_date": s.due_date.isoformat() if s.due_date else None,
                },
            })
            if s.completed or s.status == "DONE":
                timeline.append({
                    "id": f"subtask-done-{s.id}",
                    "timestamp": s.updated_at,
                    "actor_id": None,
                    "actor_name": "Task System",
                    "event_type": "SUBTASK_COMPLETED",
                    "description": f"Completed subtask '{s.title}'",
                    "details": {"subtask_id": str(s.id)},
                })

        # 4. Comments
        for c in task.comments:
            c_name = c.user.full_name if c.user else "User"
            timeline.append({
                "id": f"comment-{c.id}",
                "timestamp": c.created_at,
                "actor_id": c.user_id,
                "actor_name": c_name,
                "event_type": "COMMENT_ADDED",
                "description": f"Commented: {c.message[:100]}",
                "details": {"message": c.message},
            })

        # 5. Escalations
        for e in task.escalations:
            from_name = e.from_user_rel.full_name if e.from_user_rel else "User"
            to_name = e.to_user_rel.full_name if e.to_user_rel else "Manager"
            timeline.append({
                "id": f"escalation-{e.id}",
                "timestamp": e.created_at,
                "actor_id": e.from_user,
                "actor_name": from_name,
                "event_type": "TASK_ESCALATED",
                "description": f"Escalated to {to_name} ({e.escalation_type}): {e.reason[:100]}",
                "details": {
                    "to_user": to_name,
                    "reason": e.reason,
                    "escalation_type": e.escalation_type,
                    "due_date": e.due_date.isoformat() if e.due_date else None,
                },
            })

        # 6. Attachments
        for att in getattr(task, "attachments", []):
            att_name = att.uploader.full_name if att.uploader else "User"
            timeline.append({
                "id": f"attachment-{att.id}",
                "timestamp": att.created_at,
                "actor_id": att.uploaded_by,
                "actor_name": att_name,
                "event_type": "ATTACHMENT_ADDED",
                "description": f"Uploaded attachment '{att.file_name}'",
                "details": {"file_name": att.file_name, "file_url": att.file_url, "file_size": att.file_size},
            })

        # 7. Voice Notes
        for vn in getattr(task, "voice_notes", []):
            vn_name = vn.uploader.full_name if vn.uploader else "User"
            timeline.append({
                "id": f"voice-note-{vn.id}",
                "timestamp": vn.created_at,
                "actor_id": vn.uploaded_by,
                "actor_name": vn_name,
                "event_type": "VOICE_NOTE_ADDED",
                "description": f"Added a voice note ({vn.duration_seconds}s)",
                "details": {"duration_seconds": vn.duration_seconds, "audio_url": vn.audio_url},
            })

        # Sort chronologically
        timeline.sort(key=lambda x: x["timestamp"])
        return timeline

    # --- Escalation Options Resolution ---
    async def get_escalate_options(self, current_user_id: uuid.UUID) -> TaskEscalateOptionsResponse:
        """Resolve Reporting Managers, Department Managers, and Candidate Organization Users."""
        session = self.repository.session

        # 1. Reporting Managers for current user
        rep_stmt = (
            select(EmployeeReportingRelationship)
            .where(
                EmployeeReportingRelationship.employee_id == current_user_id,
                EmployeeReportingRelationship.deleted_at.is_(None)
                if hasattr(EmployeeReportingRelationship, "deleted_at")
                else True,
            )
        )
        rep_res = await session.execute(rep_stmt)
        rep_rels = rep_res.scalars().all()

        reporting_managers: list[TaskEscalateCandidate] = []
        seen_uids: set[uuid.UUID] = {current_user_id}

        for r in rep_rels:
            if r.manager and r.manager.id not in seen_uids:
                seen_uids.add(r.manager.id)
                reporting_managers.append(
                    TaskEscalateCandidate(
                        user_id=r.manager.id,
                        name=r.manager.full_name,
                        email=r.manager.email,
                        category="REPORTING_MANAGER",
                        detail=f"Reporting line ({r.relationship_type.value if hasattr(r.relationship_type, 'value') else r.relationship_type})",
                    )
                )

        # Fallback to User.manager_id if no relation row
        user_stmt = select(User).where(User.id == current_user_id)
        user_res = await session.execute(user_stmt)
        u_record = user_res.scalar_one_or_none()
        if u_record and u_record.manager_id and u_record.manager_id not in seen_uids:
            mgr_stmt = select(User).where(User.id == u_record.manager_id)
            mgr_res = await session.execute(mgr_stmt)
            mgr = mgr_res.scalar_one_or_none()
            if mgr:
                seen_uids.add(mgr.id)
                reporting_managers.append(
                    TaskEscalateCandidate(
                        user_id=mgr.id,
                        name=mgr.full_name,
                        email=mgr.email,
                        category="REPORTING_MANAGER",
                        detail="Direct Manager",
                    )
                )

        # 2. Department Managers for current user's departments
        dept_ids_stmt = select(UserRole.role_id).where(UserRole.user_id == current_user_id)
        dept_ids_res = await session.execute(dept_ids_stmt)
        my_depts = [row[0] for row in dept_ids_res.fetchall()]

        department_managers: list[TaskEscalateCandidate] = []
        if my_depts:
            ldr_stmt = (
                select(DepartmentLeadershipAssignment)
                .where(DepartmentLeadershipAssignment.department_id.in_(my_depts))
            )
            ldr_res = await session.execute(ldr_stmt)
            leaders = ldr_res.scalars().all()
            for ldr in leaders:
                if ldr.employee and ldr.employee.id not in seen_uids:
                    seen_uids.add(ldr.employee.id)
                    dept_name = ldr.department.name if ldr.department else "Department"
                    department_managers.append(
                        TaskEscalateCandidate(
                            user_id=ldr.employee.id,
                            name=ldr.employee.full_name,
                            email=ldr.employee.email,
                            category="DEPARTMENT_MANAGER",
                            detail=f"{dept_name} ({ldr.leadership_type.value if hasattr(ldr.leadership_type, 'value') else ldr.leadership_type})",
                        )
                    )

        # 3. All other active organization users
        all_users_stmt = (
            select(User)
            .where(
                User.deleted_at.is_(None),
                User.is_active.is_(True),
            )
            .order_by(User.first_name.asc(), User.username.asc())
            .limit(200)
        )
        all_users_res = await session.execute(all_users_stmt)
        all_users = all_users_res.scalars().all()

        org_users: list[TaskEscalateCandidate] = []
        for u in all_users:
            if u.id not in seen_uids:
                org_users.append(
                    TaskEscalateCandidate(
                        user_id=u.id,
                        name=u.full_name,
                        email=u.email,
                        category="ORGANIZATION_USER",
                        detail=u.username or "Employee",
                    )
                )

        return TaskEscalateOptionsResponse(
            reporting_managers=reporting_managers,
            department_managers=department_managers,
            organization_users=org_users,
        )

    # --- Reactions ---
    async def toggle_task_reaction(
        self,
        task_id: uuid.UUID,
        emoji: str,
        current_user: Any,
    ) -> bool:
        task = await self.get_task(task_id)
        added = await self.repository.toggle_reaction(
            user_id=current_user.id,
            emoji=emoji,
            task_id=task.id,
        )
        await self.repository.session.commit()
        await self._broadcast_task_event(
            "TASK_REACTION",
            task,
            actor_id=current_user.id,
            extra_payload={"emoji": emoji, "added": added, "user_id": str(current_user.id)},
        )
        return added

    async def toggle_comment_reaction(
        self,
        comment_id: uuid.UUID,
        emoji: str,
        current_user: Any,
    ) -> bool:
        stmt = select(TaskComment).where(TaskComment.id == comment_id)
        res = await self.repository.session.execute(stmt)
        comment = res.scalar_one_or_none()
        if not comment:
            raise NotFoundException(f"Comment with ID {comment_id} not found.")

        added = await self.repository.toggle_reaction(
            user_id=current_user.id,
            emoji=emoji,
            comment_id=comment.id,
        )
        await self.repository.session.commit()
        task = await self.get_task(comment.task_id)
        await self._broadcast_task_event(
            "TASK_REACTION",
            task,
            actor_id=current_user.id,
            extra_payload={"comment_id": str(comment.id), "emoji": emoji, "added": added, "user_id": str(current_user.id)},
        )
        return added

    # --- Dependencies ---
    async def add_dependency(
        self,
        task_id: uuid.UUID,
        payload: TaskDependencyCreate,
        current_user: Any,
    ) -> TaskDependency:
        task = await self.get_task(task_id)
        await self._assert_can_mutate_task(task, current_user, action="add dependency to")
        dep_task = await self.repository.get_task_by_id(payload.depends_on_task_id)
        if not dep_task:
            raise NotFoundException(f"Target task with ID {payload.depends_on_task_id} not found.")

        is_cycle = await self.repository.check_dependency_cycle(task.id, payload.depends_on_task_id)
        if is_cycle:
            raise ValidationException("Cannot add dependency: circular blocker chain detected.")

        dep_type_str = payload.dependency_type.value if hasattr(payload.dependency_type, "value") else str(payload.dependency_type)
        dep = await self.repository.add_dependency(
            task_id=task.id,
            depends_on_task_id=payload.depends_on_task_id,
            dependency_type=dep_type_str,
        )
        await self.repository.session.commit()
        await self.repository.session.refresh(dep)

        await self.audit_service.record(
            action=AuditAction.UPDATE,
            module="tasks",
            user_id=current_user.id,
            username_snapshot=current_user.username,
            entity_type="TaskDependency",
            entity_id=str(dep.id),
            new_values={"task_id": str(task.id), "depends_on": str(payload.depends_on_task_id), "type": dep_type_str},
            description=f"Linked dependency '{dep_type_str}' on task '{task.title}'",
        )

        await self._broadcast_task_event("TASK_DEPENDENCY_ADDED", task, actor_id=current_user.id)
        return dep

    async def remove_dependency(self, dependency_id: uuid.UUID, current_user: Any) -> None:
        stmt = select(TaskDependency).where(TaskDependency.id == dependency_id)
        res = await self.repository.session.execute(stmt)
        dep = res.scalar_one_or_none()
        if not dep:
            raise NotFoundException(f"Dependency with ID {dependency_id} not found.")
        task = await self.get_task(dep.task_id)
        await self._assert_can_mutate_task(task, current_user, action="remove dependency from")
        await self.repository.remove_dependency(dependency_id)
        await self.repository.session.commit()
        await self._broadcast_task_event("TASK_DEPENDENCY_REMOVED", task, actor_id=current_user.id)

    # --- Approval Workflow ---
    async def submit_for_approval(
        self,
        task_id: uuid.UUID,
        payload: TaskSubmitApprovalRequest,
        current_user: Any,
    ) -> Task:
        task = await self.get_task(task_id)
        approver = await self.repository.session.get(User, payload.approver_id)
        if not approver:
            raise NotFoundException(f"Approver with ID {payload.approver_id} not found.")

        task.status = TaskStatus.PENDING_APPROVAL
        task.approval_status = "PENDING_APPROVAL"
        task.approver_id = payload.approver_id
        task.approval_notes = payload.notes
        task.version += 1
        await self.repository.session.commit()
        refreshed = await self.get_task(task.id)

        await self.notification_service.notify_user(
            user_id=payload.approver_id,
            type="task_approval_requested",
            title="Task Approval Requested",
            message=f"{current_user.username} requested your approval for task: {task.title}",
            link=f"/tasks?id={task.id}",
        )

        await self.audit_service.record(
            action=AuditAction.UPDATE,
            module="tasks",
            user_id=current_user.id,
            username_snapshot=current_user.username,
            entity_type="Task",
            entity_id=str(task.id),
            new_values={"status": "PENDING_APPROVAL", "approver_id": str(payload.approver_id)},
            description=f"Submitted task '{task.title}' for approval to {approver.username}",
        )

        await self._broadcast_task_event("TASK_APPROVAL_REQUESTED", refreshed, actor_id=current_user.id)
        return refreshed

    async def action_approval(
        self,
        task_id: uuid.UUID,
        payload: TaskApprovalActionRequest,
        current_user: Any,
    ) -> Task:
        task = await self.get_task(task_id)

        if payload.approved:
            task.status = TaskStatus.DONE
            task.approval_status = "APPROVED"
            task.approved_at = datetime.now(timezone.utc)
            action_str = "Approved"
        else:
            task.status = TaskStatus.IN_PROGRESS
            task.approval_status = "REJECTED"
            action_str = "Rejected"

        if payload.notes:
            task.approval_notes = payload.notes
        task.version += 1
        await self.repository.session.commit()
        refreshed = await self.get_task(task.id)

        recipients = {a.user_id for a in task.assignees}
        if task.created_by:
            recipients.add(task.created_by)
        recipients.discard(current_user.id)

        for uid in recipients:
            await self.notification_service.notify_user(
                user_id=uid,
                type=f"task_approval_{action_str.lower()}",
                title=f"Task {action_str}",
                message=f"Task '{task.title}' was {action_str.lower()} by {current_user.username}.",
                link=f"/tasks?id={task.id}",
            )

        await self.audit_service.record(
            action=AuditAction.UPDATE,
            module="tasks",
            user_id=current_user.id,
            username_snapshot=current_user.username,
            entity_type="Task",
            entity_id=str(task.id),
            new_values={"status": task.status.value, "approval_status": task.approval_status},
            description=f"{action_str} task '{task.title}'",
        )

        await self._broadcast_task_event(f"TASK_APPROVAL_{action_str.upper()}", refreshed, actor_id=current_user.id)
        return refreshed

    # --- Duplicate Task ---
    async def duplicate_task(
        self,
        task_id: uuid.UUID,
        options: TaskDuplicateRequest,
        current_user: Any,
    ) -> Task:
        orig = await self.get_task(task_id)
        new_title = options.new_title or f"{orig.title} (Copy)"

        issue_type_val = getattr(orig, "issue_type", "TASK")
        if hasattr(issue_type_val, "value"):
            issue_type_val = issue_type_val.value

        new_task = Task(
            title=new_title,
            description=orig.description,
            priority=orig.priority,
            status=TaskStatus.TODO,
            issue_type=issue_type_val or "TASK",
            parent_task_id=orig.parent_task_id,
            sprint_id=orig.sprint_id,
            start_date=orig.start_date,
            due_date=orig.due_date,
            created_by=current_user.id,
        )
        self.repository.session.add(new_task)
        await self.repository.session.flush()

        assignee_uids = [a.user_id for a in orig.assignees if a.assignment_role == "ASSIGNEE"]
        if assignee_uids:
            await self.repository.set_assignees(new_task, assignee_uids, role="ASSIGNEE")
        if options.include_watchers:
            watcher_uids = [a.user_id for a in orig.assignees if a.assignment_role == "WATCHER"]
            if watcher_uids:
                await self.repository.set_assignees(new_task, watcher_uids, role="WATCHER")

        if options.include_subtasks and orig.subtasks:
            for st in orig.subtasks:
                sub_assignee_ids = [sa.user_id for sa in st.assignees]
                p_val = st.priority.value if hasattr(st.priority, "value") else str(st.priority or "MEDIUM")
                await self.repository.create_subtask(
                    new_task.id,
                    title=st.title,
                    description=st.description,
                    priority=p_val,
                    status="TODO",
                    start_date=st.start_date,
                    due_date=st.due_date,
                    assignee_id=st.assignee_id,
                    assignee_ids=sub_assignee_ids,
                    order_index=st.order_index,
                )

        if options.include_labels and orig.labels:
            label_ids = [l.id for l in orig.labels]
            await self.repository.set_task_labels(new_task.id, label_ids)

        if options.include_attachments and getattr(orig, "attachments", None):
            for att in orig.attachments:
                await self.repository.add_attachment(
                    task_id=new_task.id,
                    user_id=current_user.id,
                    file_name=att.file_name,
                    file_url=att.file_url,
                    file_size=att.file_size,
                    file_type=att.file_type,
                )

        await self.repository.session.commit()
        refreshed = await self.get_task(new_task.id)

        await self.audit_service.record(
            action=AuditAction.CREATE,
            module="tasks",
            user_id=current_user.id,
            username_snapshot=current_user.username,
            entity_type="Task",
            entity_id=str(refreshed.id),
            new_values={"title": refreshed.title, "duplicated_from": str(orig.id)},
            description=f"Duplicated task from '{orig.title}'",
        )

        await self._broadcast_task_event("TASK_CREATED", refreshed, actor_id=current_user.id)
        return refreshed

    # --- Bulk Actions ---
    async def bulk_action(
        self,
        payload: TaskBulkActionRequest,
        current_user: Any,
    ) -> TaskBulkActionResponse:
        success_count, failed_ids = await self.repository.bulk_update_tasks(
            task_ids=payload.task_ids,
            action=payload.action,
            value=payload.value,
            actor_id=current_user.id,
        )
        await self.repository.session.commit()

        await self.audit_service.record(
            action=AuditAction.UPDATE,
            module="tasks",
            user_id=current_user.id,
            username_snapshot=current_user.username,
            entity_type="Task",
            entity_id="bulk",
            new_values={"action": payload.action, "count": success_count},
            description=f"Bulk {payload.action} on {success_count} tasks",
        )

        event = Event(
            event_type="TASK_BULK_UPDATED",
            entity="task",
            entity_id="bulk",
            changes={"action": payload.action, "task_ids": [str(t) for t in payload.task_ids]},
        )
        await self.dispatcher.publish_to_channels([module_channel("tasks")], event)

        return TaskBulkActionResponse(
            success_count=success_count,
            failed_ids=failed_ids,
            message=f"Successfully processed {success_count} of {len(payload.task_ids)} tasks.",
        )

    # --- Labels ---
    async def list_labels(self) -> list[TaskLabelRead]:
        labels = await self.repository.list_labels()
        return [TaskLabelRead.model_validate(l) for l in labels]

    async def create_label(self, payload: TaskLabelCreate, current_user: Any) -> TaskLabelRead:
        label = await self.repository.create_label(
            name=payload.name,
            color=payload.color,
            description=payload.description,
        )
        await self.repository.session.commit()
        return TaskLabelRead.model_validate(label)

    # --- Sprints ---
    async def list_sprints(self, status: SprintStatus | None = None) -> list[TaskSprintRead]:
        sprints = await self.repository.list_sprints(status=status)
        result = []
        for s in sprints:
            t_count = len(getattr(s, "tasks", []))
            comp_count = sum(1 for t in getattr(s, "tasks", []) if getattr(t, "status", None) == "DONE" or getattr(getattr(t, "status", None), "value", None) == "DONE")
            st_val = getattr(s, "status", "FUTURE")
            read_obj = TaskSprintRead(
                id=s.id,
                name=s.name,
                goal=s.goal,
                start_date=s.start_date,
                end_date=s.end_date,
                status=st_val.value if hasattr(st_val, "value") else str(st_val),
                created_by=s.created_by,
                created_at=s.created_at,
                updated_at=s.updated_at,
                task_count=t_count,
                completed_task_count=comp_count,
            )
            result.append(read_obj)
        return result

    async def create_sprint(self, payload: TaskSprintCreate, current_user: Any) -> TaskSprintRead:
        sprint = await self.repository.create_sprint(
            name=payload.name,
            goal=payload.goal,
            start_date=payload.start_date,
            end_date=payload.end_date,
            status=payload.status,
            created_by=current_user.id,
        )
        await self.repository.session.commit()
        return TaskSprintRead.model_validate(sprint)

    async def update_sprint(self, sprint_id: uuid.UUID, payload: TaskSprintUpdate, current_user: Any) -> TaskSprintRead:
        sprint = await self.repository.get_sprint_by_id(sprint_id)
        if not sprint:
            raise NotFoundException(f"Sprint with ID {sprint_id} not found.")
        updated = await self.repository.update_sprint(
            sprint,
            name=payload.name,
            goal=payload.goal,
            start_date=payload.start_date,
            end_date=payload.end_date,
            status=payload.status,
        )
        await self.repository.session.commit()
        return TaskSprintRead.model_validate(updated)

    async def delete_sprint(self, sprint_id: uuid.UUID, current_user: Any) -> None:
        sprint = await self.repository.get_sprint_by_id(sprint_id)
        if not sprint:
            raise NotFoundException(f"Sprint with ID {sprint_id} not found.")
        await self.repository.delete_sprint(sprint)
        await self.repository.session.commit()

    # --- Templates ---
    async def list_templates(self, category: str | None = None) -> list[TaskTemplateRead]:
        templates = await self.repository.list_templates(category=category)
        return [TaskTemplateRead.model_validate(t) for t in templates]

    async def create_template(self, payload: TaskTemplateCreate, current_user: Any) -> TaskTemplateRead:
        tpl = await self.repository.create_template(
            name=payload.name,
            description=payload.description,
            category=payload.category,
            template_data=payload.template_data,
            created_by=current_user.id,
        )
        await self.repository.session.commit()
        return TaskTemplateRead.model_validate(tpl)

    async def update_template(self, template_id: uuid.UUID, payload: TaskTemplateUpdate, current_user: Any) -> TaskTemplateRead:
        tpl = await self.repository.get_template_by_id(template_id)
        if not tpl:
            raise NotFoundException(f"Template with ID {template_id} not found.")
        updated = await self.repository.update_template(
            tpl,
            name=payload.name,
            description=payload.description,
            category=payload.category,
            template_data=payload.template_data,
        )
        await self.repository.session.commit()
        return TaskTemplateRead.model_validate(updated)

    async def delete_template(self, template_id: uuid.UUID, current_user: Any) -> None:
        tpl = await self.repository.get_template_by_id(template_id)
        if not tpl:
            raise NotFoundException(f"Template with ID {template_id} not found.")
        await self.repository.delete_template(tpl)
        await self.repository.session.commit()

    # --- Saved Filters ---
    async def list_saved_filters(self, current_user: Any) -> list[TaskSavedFilterRead]:
        filters = await self.repository.list_saved_filters(current_user.id)
        return [TaskSavedFilterRead.model_validate(f) for f in filters]

    async def create_saved_filter(self, payload: TaskSavedFilterCreate, current_user: Any) -> TaskSavedFilterRead:
        sf = await self.repository.create_saved_filter(
            user_id=current_user.id,
            name=payload.name,
            filter_config=payload.filter_config,
            is_default=payload.is_default,
        )
        await self.repository.session.commit()
        return TaskSavedFilterRead.model_validate(sf)

    async def update_saved_filter(self, filter_id: uuid.UUID, payload: TaskSavedFilterUpdate, current_user: Any) -> TaskSavedFilterRead:
        sf = await self.repository.get_saved_filter_by_id(filter_id)
        if not sf or sf.user_id != current_user.id:
            raise NotFoundException(f"Filter with ID {filter_id} not found.")
        updated = await self.repository.update_saved_filter(
            sf,
            name=payload.name,
            filter_config=payload.filter_config,
            is_default=payload.is_default,
        )
        await self.repository.session.commit()
        return TaskSavedFilterRead.model_validate(updated)

    async def delete_saved_filter(self, filter_id: uuid.UUID, current_user: Any) -> None:
        sf = await self.repository.get_saved_filter_by_id(filter_id)
        if not sf or sf.user_id != current_user.id:
            raise NotFoundException(f"Filter with ID {filter_id} not found.")
        await self.repository.delete_saved_filter(sf)
        await self.repository.session.commit()

    # --- Workload & Capacity ---
    async def get_workload_dashboard(self, department_id: uuid.UUID | None = None) -> WorkloadDashboardResponse:
        data = await self.repository.get_team_workload(department_id=department_id)
        users = [UserWorkloadSummary.model_validate(d) for d in data]
        total_tasks = sum(u.open_tasks_count + u.in_progress_tasks_count + u.completed_tasks_count for u in users)
        return WorkloadDashboardResponse(users=users, total_tasks=total_tasks)

    async def get_capacity_view(
        self,
        start_date: date,
        end_date: date,
        department_id: uuid.UUID | None = None,
    ) -> CapacityViewResponse:
        data = await self.repository.get_capacity_grid(start_date=start_date, end_date=end_date, department_id=department_id)
        users = []
        for d in data:
            allocs = [CapacityDayAllocation(date=a["date"], task_ids=a["task_ids"], task_count=a["task_count"]) for a in d["allocations"]]
            users.append(UserCapacitySummary(user_id=d["user_id"], user_name=d["user_name"], allocations=allocs))
        return CapacityViewResponse(users=users, start_date=start_date, end_date=end_date)
