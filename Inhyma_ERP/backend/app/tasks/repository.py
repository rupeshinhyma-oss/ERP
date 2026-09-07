"""
Task Module Repository.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime, timezone
from typing import Any

from sqlalchemy import and_, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.common.base_repository import BaseRepository
from app.org_structure.models import DepartmentLeadershipAssignment
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
    TaskSubtaskAssignee,
    TaskSubtaskAttachment,
    TaskSubtaskComment,
    TaskTemplate,
    TaskVoiceNote,
)
from app.users.models import User


class TaskRepository(BaseRepository[Task]):
    """Async repository for Task entities and child relations."""

    def __init__(self, session: AsyncSession) -> None:
        super().__init__(session, Task)

    async def list_tasks(
        self,
        *,
        current_user_id: uuid.UUID,
        user_permissions: set[str],
        view_mode: str = "all",  # "all", "my", "department", "organization", "kanban", "calendar"
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
    ) -> tuple[list[Task], int]:
        """List tasks applying visibility rules, filters, and pagination."""
        base_query = select(Task).where(Task.deleted_at.is_(None))

        # --- Visibility Logic ---
        can_view_org = (
            "task.organization_view" in user_permissions
            or "task.manage" in user_permissions
            or "super_admin" in user_permissions
        )
        can_view_dept = "task.department_view" in user_permissions or can_view_org

        target_depts: list[uuid.UUID] = []
        if department_id:
            target_depts.append(department_id)
        if department_ids:
            target_depts.extend(department_ids)

        if target_depts:
            target_users_subq = select(UserRole.user_id).where(UserRole.role_id.in_(target_depts))
            base_query = base_query.where(
                or_(
                    Task.created_by.in_(target_users_subq),
                    Task.id.in_(
                        select(TaskAssignee.task_id).where(TaskAssignee.user_id.in_(target_users_subq))
                    ),
                )
            )
        elif view_mode == "my":
            base_query = base_query.where(
                or_(
                    Task.created_by == current_user_id,
                    Task.id.in_(
                        select(TaskAssignee.task_id).where(TaskAssignee.user_id == current_user_id)
                    ),
                )
            )
        elif view_mode == "department":
            # Department manager or department member scoping
            managed_depts_subq = select(DepartmentLeadershipAssignment.department_id).where(
                DepartmentLeadershipAssignment.employee_id == current_user_id
            )
            user_depts_subq = select(UserRole.role_id).where(UserRole.user_id == current_user_id)
            combined_depts_subq = select(UserRole.role_id).where(
                or_(
                    UserRole.role_id.in_(user_depts_subq),
                    UserRole.role_id.in_(managed_depts_subq),
                )
            )
            dept_users_subq = select(UserRole.user_id).where(UserRole.role_id.in_(combined_depts_subq))
            base_query = base_query.where(
                or_(
                    Task.created_by == current_user_id,
                    Task.created_by.in_(dept_users_subq),
                    Task.id.in_(
                        select(TaskAssignee.task_id).where(
                            or_(
                                TaskAssignee.user_id == current_user_id,
                                TaskAssignee.user_id.in_(dept_users_subq),
                            )
                        )
                    ),
                )
            )
        elif view_mode == "organization":
            if not can_view_org:
                user_depts_subq = select(UserRole.role_id).where(UserRole.user_id == current_user_id)
                dept_users_subq = select(UserRole.user_id).where(UserRole.role_id.in_(user_depts_subq))
                base_query = base_query.where(
                    or_(
                        Task.created_by == current_user_id,
                        Task.created_by.in_(dept_users_subq),
                        Task.id.in_(
                            select(TaskAssignee.task_id).where(
                                or_(
                                    TaskAssignee.user_id == current_user_id,
                                    TaskAssignee.user_id.in_(dept_users_subq),
                                )
                            )
                        ),
                    )
                )
        else:
            # Default / kanban / calendar
            if not can_view_org:
                if can_view_dept:
                    user_depts_subq = select(UserRole.role_id).where(UserRole.user_id == current_user_id)
                    dept_users_subq = select(UserRole.user_id).where(UserRole.role_id.in_(user_depts_subq))
                    base_query = base_query.where(
                        or_(
                            Task.created_by == current_user_id,
                            Task.created_by.in_(dept_users_subq),
                            Task.id.in_(
                                select(TaskAssignee.task_id).where(
                                    or_(
                                        TaskAssignee.user_id == current_user_id,
                                        TaskAssignee.user_id.in_(dept_users_subq),
                                    )
                                )
                            ),
                        )
                    )
                else:
                    base_query = base_query.where(
                        or_(
                            Task.created_by == current_user_id,
                            Task.id.in_(
                                select(TaskAssignee.task_id).where(TaskAssignee.user_id == current_user_id)
                            ),
                        )
                    )

        # --- Additional Filters ---
        if status is not None:
            base_query = base_query.where(Task.status == status)

        if priority is not None:
            base_query = base_query.where(Task.priority == priority)

        if issue_type is not None:
            base_query = base_query.where(Task.issue_type == issue_type)

        if parent_task_id is not None:
            base_query = base_query.where(Task.parent_task_id == parent_task_id)

        if is_backlog:
            base_query = base_query.where(Task.sprint_id.is_(None))
        elif sprint_id is not None:
            base_query = base_query.where(Task.sprint_id == sprint_id)

        if label_id is not None:
            base_query = base_query.where(
                Task.id.in_(select(TaskLabelLink.task_id).where(TaskLabelLink.label_id == label_id))
            )

        if approval_status is not None:
            base_query = base_query.where(Task.approval_status == approval_status)

        if assignee_id is not None:
            base_query = base_query.where(
                Task.id.in_(select(TaskAssignee.task_id).where(TaskAssignee.user_id == assignee_id))
            )

        if due_date_from is not None:
            base_query = base_query.where(Task.due_date >= due_date_from)

        if due_date_to is not None:
            base_query = base_query.where(Task.due_date <= due_date_to)

        if search and search.strip():
            term = f"%{search.strip()}%"
            base_query = base_query.where(
                or_(Task.title.ilike(term), Task.description.ilike(term))
            )

        # Count total
        count_sub = base_query.subquery()
        count_stmt = select(func.count()).select_from(count_sub)
        count_res = await self.session.execute(count_stmt)
        total = int(count_res.scalar() or 0)

        # Order & Paginate
        stmt = (
            base_query.options(
                selectinload(Task.assignees),
                selectinload(Task.subtasks),
                selectinload(Task.child_tasks),
                selectinload(Task.parent_task),
                selectinload(Task.sprint),
                selectinload(Task.task_label_links),
                selectinload(Task.labels),
                selectinload(Task.comments),
                selectinload(Task.escalations),
                selectinload(Task.attachments),
                selectinload(Task.voice_notes),
                selectinload(Task.reactions),
                selectinload(Task.creator),
            )
            .order_by(
                Task.due_date.asc().nullslast(),
                Task.created_at.desc(),
            )
            .offset((page - 1) * page_size)
            .limit(page_size)
        )

        res = await self.session.execute(stmt)
        items = list(res.scalars().all())
        return items, total

    async def get_task_by_id(self, task_id: uuid.UUID, *, include_deleted: bool = False) -> Task | None:
        stmt = select(Task).where(Task.id == task_id).execution_options(populate_existing=True)
        if not include_deleted:
            stmt = stmt.where(Task.deleted_at.is_(None))
        res = await self.session.execute(stmt)
        return res.scalar_one_or_none()

    async def set_assignees(
        self,
        task: Task,
        user_ids: list[uuid.UUID],
        *,
        role: str = "ASSIGNEE",
    ) -> list[TaskAssignee]:
        """Replace assignees for a given role (or general assignees)."""
        stmt = select(TaskAssignee).where(
            TaskAssignee.task_id == task.id,
            TaskAssignee.assignment_role == role,
        )
        res = await self.session.execute(stmt)
        existing_with_role = list(res.scalars().all())
        current_map = {a.user_id: a for a in existing_with_role}

        for uid, a in list(current_map.items()):
            if uid not in user_ids:
                await self.session.delete(a)

        new_assignees: list[TaskAssignee] = []
        for uid in user_ids:
            if uid in current_map:
                new_assignees.append(current_map[uid])
            else:
                # Check if user already exists with another role to avoid uq violation
                other_stmt = select(TaskAssignee).where(
                    TaskAssignee.task_id == task.id,
                    TaskAssignee.user_id == uid,
                )
                other_res = await self.session.execute(other_stmt)
                existing_any = other_res.scalar_one_or_none()
                if existing_any:
                    existing_any.assignment_role = role
                    new_assignees.append(existing_any)
                else:
                    new_a = TaskAssignee(task_id=task.id, user_id=uid, assignment_role=role)
                    self.session.add(new_a)
                    new_assignees.append(new_a)

        await self.session.flush()
        return new_assignees

    async def add_comment(
        self,
        task_id: uuid.UUID,
        user_id: uuid.UUID,
        message: str,
        audio_url: str | None = None,
        attachments_data: list[dict[str, Any]] | None = None,
    ) -> TaskComment:
        comment = TaskComment(task_id=task_id, user_id=user_id, message=message, audio_url=audio_url)
        self.session.add(comment)
        await self.session.flush()

        if attachments_data:
            for att in attachments_data:
                ca = TaskCommentAttachment(
                    comment_id=comment.id,
                    file_name=att.get("file_name", "attachment"),
                    file_url=att.get("file_url", ""),
                    file_size=att.get("file_size", 0),
                    file_type=att.get("file_type") or "application/octet-stream",
                )
                self.session.add(ca)
            await self.session.flush()

        return comment

    async def add_escalation(
        self,
        task_id: uuid.UUID,
        from_user: uuid.UUID,
        to_user: uuid.UUID,
        reason: str,
        escalation_type: str = "ORGANIZATION_USER",
        due_date: date | None = None,
    ) -> TaskEscalation:
        esc = TaskEscalation(
            task_id=task_id,
            from_user=from_user,
            to_user=to_user,
            reason=reason,
            escalation_type=escalation_type,
            due_date=due_date,
        )
        self.session.add(esc)
        await self.session.flush()
        return esc

    async def create_subtask(
        self,
        task_id: uuid.UUID,
        title: str,
        *,
        description: str | None = None,
        priority: str = "MEDIUM",
        status: str = "TODO",
        start_date: date | None = None,
        due_date: date | None = None,
        completed: bool = False,
        assignee_id: uuid.UUID | None = None,
        assignee_ids: list[uuid.UUID] | None = None,
        order_index: int = 0,
    ) -> TaskSubtask:
        if status == "DONE" or completed:
            completed = True
            status = "DONE"

        sub = TaskSubtask(
            task_id=task_id,
            title=title,
            description=description,
            priority=priority,
            status=status,
            start_date=start_date,
            due_date=due_date,
            completed=completed,
            assignee_id=assignee_id,
            order_index=order_index,
        )
        self.session.add(sub)
        await self.session.flush()

        # Handle multiple assignees
        all_uids = list(assignee_ids or [])
        if assignee_id and assignee_id not in all_uids:
            all_uids.append(assignee_id)

        for uid in all_uids:
            sub_a = TaskSubtaskAssignee(subtask_id=sub.id, user_id=uid)
            self.session.add(sub_a)

        await self.session.flush()
        return sub

    async def get_subtask_by_id(self, subtask_id: uuid.UUID) -> TaskSubtask | None:
        stmt = select(TaskSubtask).where(TaskSubtask.id == subtask_id)
        res = await self.session.execute(stmt)
        return res.scalar_one_or_none()

    async def update_subtask(
        self,
        subtask: TaskSubtask,
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
    ) -> TaskSubtask:
        if title is not None:
            subtask.title = title
        if description is not None:
            subtask.description = description
        if priority is not None:
            subtask.priority = priority
        if status is not None:
            subtask.status = status
            subtask.completed = (status == "DONE")
        if completed is not None:
            subtask.completed = completed
            if completed:
                subtask.status = "DONE"
            elif subtask.status == "DONE":
                subtask.status = "TODO"
        if start_date is not None:
            subtask.start_date = start_date
        if due_date is not None:
            subtask.due_date = due_date
        if assignee_id is not None:
            subtask.assignee_id = assignee_id
        if order_index is not None:
            subtask.order_index = order_index

        if assignee_ids is not None:
            # Sync subtask assignees
            stmt = select(TaskSubtaskAssignee).where(TaskSubtaskAssignee.subtask_id == subtask.id)
            res = await self.session.execute(stmt)
            existing = list(res.scalars().all())
            existing_map = {a.user_id: a for a in existing}

            for uid, a in list(existing_map.items()):
                if uid not in assignee_ids:
                    await self.session.delete(a)

            for uid in assignee_ids:
                if uid not in existing_map:
                    new_sa = TaskSubtaskAssignee(subtask_id=subtask.id, user_id=uid)
                    self.session.add(new_sa)

        await self.session.flush()
        return subtask

    async def delete_subtask(self, subtask: TaskSubtask) -> None:
        await self.session.delete(subtask)
        await self.session.flush()

    # --- Attachments & Voice Notes ---
    async def add_attachment(
        self,
        task_id: uuid.UUID,
        user_id: uuid.UUID,
        file_name: str,
        file_url: str,
        file_size: int = 0,
        file_type: str | None = None,
    ) -> TaskAttachment:
        attachment = TaskAttachment(
            task_id=task_id,
            uploaded_by=user_id,
            file_name=file_name,
            file_url=file_url,
            file_size=file_size,
            file_type=file_type or "application/octet-stream",
        )
        self.session.add(attachment)
        await self.session.flush()
        return attachment

    async def get_attachment_by_id(self, attachment_id: uuid.UUID) -> TaskAttachment | None:
        stmt = select(TaskAttachment).where(TaskAttachment.id == attachment_id)
        res = await self.session.execute(stmt)
        return res.scalar_one_or_none()

    async def delete_attachment(self, attachment: TaskAttachment) -> None:
        await self.session.delete(attachment)
        await self.session.flush()

    async def list_attachments(self, task_id: uuid.UUID) -> list[TaskAttachment]:
        stmt = select(TaskAttachment).where(TaskAttachment.task_id == task_id).order_by(TaskAttachment.created_at.desc())
        res = await self.session.execute(stmt)
        return list(res.scalars().all())

    async def add_voice_note(
        self,
        task_id: uuid.UUID,
        user_id: uuid.UUID,
        audio_url: str,
        duration_seconds: int = 0,
        file_size: int = 0,
        mime_type: str = "audio/webm",
        title: str | None = None,
    ) -> TaskVoiceNote:
        vn = TaskVoiceNote(
            task_id=task_id,
            uploaded_by=user_id,
            audio_url=audio_url,
            duration_seconds=duration_seconds,
            file_name=title or "voice_note.webm",
        )
        self.session.add(vn)
        await self.session.flush()
        return vn

    async def list_voice_notes(self, task_id: uuid.UUID) -> list[TaskVoiceNote]:
        stmt = select(TaskVoiceNote).where(TaskVoiceNote.task_id == task_id).order_by(TaskVoiceNote.created_at.desc())
        res = await self.session.execute(stmt)
        return list(res.scalars().all())

    # --- Subtask Collaboration (Independent Comments & Attachments) ---
    async def add_subtask_comment(
        self,
        subtask_id: uuid.UUID,
        user_id: uuid.UUID,
        message: str,
        audio_url: str | None = None,
    ) -> TaskSubtaskComment:
        sc = TaskSubtaskComment(
            subtask_id=subtask_id,
            user_id=user_id,
            message=message,
            audio_url=audio_url,
        )
        self.session.add(sc)
        await self.session.flush()
        return sc

    async def list_subtask_comments(self, subtask_id: uuid.UUID) -> list[TaskSubtaskComment]:
        stmt = (
            select(TaskSubtaskComment)
            .where(TaskSubtaskComment.subtask_id == subtask_id)
            .order_by(TaskSubtaskComment.created_at.asc())
        )
        res = await self.session.execute(stmt)
        return list(res.scalars().all())

    async def add_subtask_attachment(
        self,
        subtask_id: uuid.UUID,
        user_id: uuid.UUID,
        file_name: str,
        file_url: str,
        file_size: int = 0,
        file_type: str | None = None,
    ) -> TaskSubtaskAttachment:
        sa = TaskSubtaskAttachment(
            subtask_id=subtask_id,
            uploaded_by=user_id,
            file_name=file_name,
            file_url=file_url,
            file_size=file_size,
            file_type=file_type or "application/octet-stream",
        )
        self.session.add(sa)
        await self.session.flush()
        return sa

    async def list_subtask_attachments(self, subtask_id: uuid.UUID) -> list[TaskSubtaskAttachment]:
        stmt = (
            select(TaskSubtaskAttachment)
            .where(TaskSubtaskAttachment.subtask_id == subtask_id)
            .order_by(TaskSubtaskAttachment.created_at.desc())
        )
        res = await self.session.execute(stmt)
        return list(res.scalars().all())

    # --- Escalation Collaboration (Independent Comments) ---
    async def get_escalation_by_id(self, escalation_id: uuid.UUID) -> TaskEscalation | None:
        stmt = select(TaskEscalation).where(TaskEscalation.id == escalation_id)
        res = await self.session.execute(stmt)
        return res.scalar_one_or_none()

    async def add_escalation_comment(
        self,
        escalation_id: uuid.UUID,
        user_id: uuid.UUID,
        message: str,
        audio_url: str | None = None,
    ) -> TaskEscalationComment:
        ec = TaskEscalationComment(
            escalation_id=escalation_id,
            user_id=user_id,
            message=message,
            audio_url=audio_url,
        )
        self.session.add(ec)
        await self.session.flush()
        return ec

    async def list_escalation_comments(self, escalation_id: uuid.UUID) -> list[TaskEscalationComment]:
        stmt = (
            select(TaskEscalationComment)
            .where(TaskEscalationComment.escalation_id == escalation_id)
            .order_by(TaskEscalationComment.created_at.asc())
        )
        res = await self.session.execute(stmt)
        return list(res.scalars().all())

    # --- Labels ---
    async def list_labels(self) -> list[TaskLabel]:
        stmt = select(TaskLabel).order_by(TaskLabel.name.asc())
        res = await self.session.execute(stmt)
        return list(res.scalars().all())

    async def get_label_by_id(self, label_id: uuid.UUID) -> TaskLabel | None:
        stmt = select(TaskLabel).where(TaskLabel.id == label_id)
        res = await self.session.execute(stmt)
        return res.scalar_one_or_none()

    async def get_label_by_name(self, name: str) -> TaskLabel | None:
        stmt = select(TaskLabel).where(func.lower(TaskLabel.name) == func.lower(name.strip()))
        res = await self.session.execute(stmt)
        return res.scalar_one_or_none()

    async def create_label(self, name: str, color: str = "#6366f1", description: str | None = None) -> TaskLabel:
        label = TaskLabel(name=name.strip(), color=color, description=description)
        self.session.add(label)
        await self.session.flush()
        return label

    async def get_or_create_label(self, name: str, color: str = "#6366f1") -> TaskLabel:
        existing = await self.get_label_by_name(name)
        if existing:
            return existing
        return await self.create_label(name=name, color=color)

    async def set_task_labels(self, task_id: uuid.UUID, label_ids: list[uuid.UUID]) -> list[TaskLabel]:
        stmt = select(TaskLabelLink).where(TaskLabelLink.task_id == task_id)
        res = await self.session.execute(stmt)
        existing = list(res.scalars().all())
        existing_map = {link.label_id: link for link in existing}

        for lid, link in list(existing_map.items()):
            if lid not in label_ids:
                await self.session.delete(link)

        for lid in label_ids:
            if lid not in existing_map:
                new_link = TaskLabelLink(task_id=task_id, label_id=lid)
                self.session.add(new_link)

        await self.session.flush()
        return await self.get_task_labels(task_id)

    async def add_task_label(self, task_id: uuid.UUID, label_id: uuid.UUID) -> None:
        stmt = select(TaskLabelLink).where(TaskLabelLink.task_id == task_id, TaskLabelLink.label_id == label_id)
        res = await self.session.execute(stmt)
        if not res.scalar_one_or_none():
            link = TaskLabelLink(task_id=task_id, label_id=label_id)
            self.session.add(link)
            await self.session.flush()

    async def remove_task_label(self, task_id: uuid.UUID, label_id: uuid.UUID) -> None:
        stmt = select(TaskLabelLink).where(TaskLabelLink.task_id == task_id, TaskLabelLink.label_id == label_id)
        res = await self.session.execute(stmt)
        link = res.scalar_one_or_none()
        if link:
            await self.session.delete(link)
            await self.session.flush()

    async def get_task_labels(self, task_id: uuid.UUID) -> list[TaskLabel]:
        stmt = (
            select(TaskLabel)
            .join(TaskLabelLink, TaskLabelLink.label_id == TaskLabel.id)
            .where(TaskLabelLink.task_id == task_id)
            .order_by(TaskLabel.name.asc())
        )
        res = await self.session.execute(stmt)
        return list(res.scalars().all())

    # --- Sprints ---
    async def list_sprints(self, status: SprintStatus | None = None) -> list[TaskSprint]:
        stmt = select(TaskSprint)
        if status is not None:
            stmt = stmt.where(TaskSprint.status == status)
        stmt = stmt.order_by(TaskSprint.created_at.desc())
        res = await self.session.execute(stmt)
        return list(res.scalars().all())

    async def get_sprint_by_id(self, sprint_id: uuid.UUID) -> TaskSprint | None:
        stmt = select(TaskSprint).where(TaskSprint.id == sprint_id)
        res = await self.session.execute(stmt)
        return res.scalar_one_or_none()

    async def create_sprint(
        self,
        name: str,
        goal: str | None = None,
        start_date: date | None = None,
        end_date: date | None = None,
        status: SprintStatus = SprintStatus.FUTURE,
        created_by: uuid.UUID | None = None,
    ) -> TaskSprint:
        sprint = TaskSprint(
            name=name,
            goal=goal,
            start_date=start_date,
            end_date=end_date,
            status=status,
            created_by=created_by,
        )
        self.session.add(sprint)
        await self.session.flush()
        return sprint

    async def update_sprint(
        self,
        sprint: TaskSprint,
        name: str | None = None,
        goal: str | None = None,
        start_date: date | None = None,
        end_date: date | None = None,
        status: SprintStatus | None = None,
    ) -> TaskSprint:
        if name is not None:
            sprint.name = name
        if goal is not None:
            sprint.goal = goal
        if start_date is not None:
            sprint.start_date = start_date
        if end_date is not None:
            sprint.end_date = end_date
        if status is not None:
            sprint.status = status
        await self.session.flush()
        return sprint

    async def delete_sprint(self, sprint: TaskSprint) -> None:
        stmt = update(Task).where(Task.sprint_id == sprint.id).values(sprint_id=None)
        await self.session.execute(stmt)
        await self.session.delete(sprint)
        await self.session.flush()

    # --- Templates ---
    async def list_templates(self, category: str | None = None) -> list[TaskTemplate]:
        stmt = select(TaskTemplate)
        if category is not None:
            stmt = stmt.where(or_(TaskTemplate.issue_type == category, TaskTemplate.name.ilike(f"%{category}%")))
        stmt = stmt.order_by(TaskTemplate.name.asc())
        res = await self.session.execute(stmt)
        return list(res.scalars().all())

    async def get_template_by_id(self, template_id: uuid.UUID) -> TaskTemplate | None:
        stmt = select(TaskTemplate).where(TaskTemplate.id == template_id)
        res = await self.session.execute(stmt)
        return res.scalar_one_or_none()

    async def create_template(
        self,
        name: str,
        template_data: dict[str, Any],
        description: str | None = None,
        category: str | None = None,
        created_by: uuid.UUID | None = None,
    ) -> TaskTemplate:
        itype = (template_data or {}).get("issue_type") or category or "TASK"
        prio = (template_data or {}).get("default_priority") or (template_data or {}).get("priority", "MEDIUM")
        subtasks = (template_data or {}).get("subtask_templates") or (template_data or {}).get("default_subtasks", [])
        labels = (template_data or {}).get("default_labels", [])
        watchers = (template_data or {}).get("default_watcher_ids", [])
        is_shared = (template_data or {}).get("is_shared", True)

        template = TaskTemplate(
            name=name,
            description=description,
            issue_type=itype,
            priority=prio,
            default_subtasks=subtasks,
            default_labels=labels,
            default_watcher_ids=watchers,
            is_shared=is_shared,
            created_by=created_by,
        )
        self.session.add(template)
        await self.session.flush()
        return template

    async def update_template(
        self,
        template: TaskTemplate,
        name: str | None = None,
        description: str | None = None,
        category: str | None = None,
        template_data: dict[str, Any] | None = None,
    ) -> TaskTemplate:
        if name is not None:
            template.name = name
        if description is not None:
            template.description = description
        if category is not None:
            template.issue_type = category
        if template_data is not None:
            template.template_data = template_data
        await self.session.flush()
        return template

    async def delete_template(self, template: TaskTemplate) -> None:
        await self.session.delete(template)
        await self.session.flush()

    # --- Dependencies ---
    async def check_dependency_cycle(self, task_id: uuid.UUID, depends_on_task_id: uuid.UUID) -> bool:
        if task_id == depends_on_task_id:
            return True
        visited = set()
        queue = [depends_on_task_id]
        while queue:
            curr = queue.pop(0)
            if curr == task_id:
                return True
            if curr in visited:
                continue
            visited.add(curr)
            stmt = select(TaskDependency.depends_on_task_id).where(TaskDependency.task_id == curr)
            res = await self.session.execute(stmt)
            next_tasks = list(res.scalars().all())
            for nxt in next_tasks:
                if nxt not in visited:
                    queue.append(nxt)
        return False

    async def add_dependency(
        self,
        task_id: uuid.UUID,
        depends_on_task_id: uuid.UUID,
        dependency_type: DependencyType = DependencyType.BLOCKS,
    ) -> TaskDependency:
        stmt = select(TaskDependency).where(
            TaskDependency.task_id == task_id,
            TaskDependency.depends_on_task_id == depends_on_task_id,
        )
        res = await self.session.execute(stmt)
        existing = res.scalar_one_or_none()
        if existing:
            existing.dependency_type = dependency_type
            await self.session.flush()
            return existing

        dep = TaskDependency(
            task_id=task_id,
            depends_on_task_id=depends_on_task_id,
            dependency_type=dependency_type,
        )
        self.session.add(dep)
        await self.session.flush()
        return dep

    async def remove_dependency(self, dependency_id: uuid.UUID) -> None:
        stmt = select(TaskDependency).where(TaskDependency.id == dependency_id)
        res = await self.session.execute(stmt)
        dep = res.scalar_one_or_none()
        if dep:
            await self.session.delete(dep)
            await self.session.flush()

    async def list_task_dependencies(self, task_id: uuid.UUID) -> list[TaskDependency]:
        stmt = (
            select(TaskDependency)
            .where(TaskDependency.task_id == task_id)
            .order_by(TaskDependency.created_at.asc())
        )
        res = await self.session.execute(stmt)
        return list(res.scalars().all())

    # --- Reactions ---
    async def toggle_reaction(
        self,
        user_id: uuid.UUID,
        emoji: str,
        task_id: uuid.UUID | None = None,
        comment_id: uuid.UUID | None = None,
    ) -> bool:
        stmt = select(TaskReaction).where(
            TaskReaction.user_id == user_id,
            TaskReaction.emoji == emoji,
        )
        if task_id is not None:
            stmt = stmt.where(TaskReaction.task_id == task_id)
        elif comment_id is not None:
            stmt = stmt.where(TaskReaction.comment_id == comment_id)
        else:
            return False

        res = await self.session.execute(stmt)
        existing = res.scalar_one_or_none()
        if existing:
            await self.session.delete(existing)
            await self.session.flush()
            return False
        else:
            reaction = TaskReaction(
                user_id=user_id,
                emoji=emoji,
                task_id=task_id,
                comment_id=comment_id,
            )
            self.session.add(reaction)
            await self.session.flush()
            return True

    async def get_reactions_summary(
        self,
        current_user_id: uuid.UUID,
        task_id: uuid.UUID | None = None,
        comment_id: uuid.UUID | None = None,
    ) -> list[dict[str, Any]]:
        stmt = select(TaskReaction)
        if task_id is not None:
            stmt = stmt.where(TaskReaction.task_id == task_id)
        elif comment_id is not None:
            stmt = stmt.where(TaskReaction.comment_id == comment_id)
        else:
            return []

        res = await self.session.execute(stmt)
        reactions = list(res.scalars().all())
        summary_map: dict[str, dict[str, Any]] = {}
        for r in reactions:
            if r.emoji not in summary_map:
                summary_map[r.emoji] = {
                    "emoji": r.emoji,
                    "count": 0,
                    "user_ids": [],
                    "has_reacted": False,
                }
            summary_map[r.emoji]["count"] += 1
            summary_map[r.emoji]["user_ids"].append(r.user_id)
            if r.user_id == current_user_id:
                summary_map[r.emoji]["has_reacted"] = True

        return list(summary_map.values())

    # --- Mentions ---
    async def create_mention(
        self,
        task_id: uuid.UUID,
        mentioned_user_id: uuid.UUID,
        mentioned_by: uuid.UUID | None = None,
        comment_id: uuid.UUID | None = None,
        context_type: str = "TASK_COMMENT",
    ) -> TaskMention:
        mention = TaskMention(
            task_id=task_id,
            mentioned_user_id=mentioned_user_id,
            mentioned_by=mentioned_by or mentioned_user_id,
            comment_id=comment_id,
            context_type=context_type,
        )
        self.session.add(mention)
        await self.session.flush()
        return mention

    async def list_mentions(
        self,
        task_id: uuid.UUID | None = None,
        comment_id: uuid.UUID | None = None,
    ) -> list[TaskMention]:
        stmt = select(TaskMention)
        if comment_id is not None:
            stmt = stmt.where(TaskMention.comment_id == comment_id)
        elif task_id is not None:
            stmt = stmt.where(TaskMention.task_id == task_id)
        res = await self.session.execute(stmt)
        return list(res.scalars().all())

    # --- Saved Filters ---
    async def list_saved_filters(self, user_id: uuid.UUID) -> list[TaskSavedFilter]:
        stmt = (
            select(TaskSavedFilter)
            .where(TaskSavedFilter.user_id == user_id)
            .order_by(TaskSavedFilter.created_at.desc())
        )
        res = await self.session.execute(stmt)
        return list(res.scalars().all())

    async def get_saved_filter_by_id(self, filter_id: uuid.UUID) -> TaskSavedFilter | None:
        stmt = select(TaskSavedFilter).where(TaskSavedFilter.id == filter_id)
        res = await self.session.execute(stmt)
        return res.scalar_one_or_none()

    async def create_saved_filter(
        self,
        user_id: uuid.UUID,
        name: str,
        filter_config: dict[str, Any],
        is_default: bool = False,
    ) -> TaskSavedFilter:
        if is_default:
            stmt = update(TaskSavedFilter).where(TaskSavedFilter.user_id == user_id).values(is_default=False)
            await self.session.execute(stmt)

        saved = TaskSavedFilter(
            user_id=user_id,
            name=name,
            filter_criteria=filter_config,
            is_default=is_default,
        )
        self.session.add(saved)
        await self.session.flush()
        return saved

    async def update_saved_filter(
        self,
        saved_filter: TaskSavedFilter,
        name: str | None = None,
        filter_config: dict[str, Any] | None = None,
        is_default: bool | None = None,
    ) -> TaskSavedFilter:
        if name is not None:
            saved_filter.name = name
        if filter_config is not None:
            saved_filter.filter_criteria = filter_config
        if is_default is not None:
            if is_default:
                stmt = (
                    update(TaskSavedFilter)
                    .where(TaskSavedFilter.user_id == saved_filter.user_id)
                    .values(is_default=False)
                )
                await self.session.execute(stmt)
            saved_filter.is_default = is_default
        await self.session.flush()
        return saved_filter

    async def delete_saved_filter(self, saved_filter: TaskSavedFilter) -> None:
        await self.session.delete(saved_filter)
        await self.session.flush()

    # --- Bulk Operations ---
    async def bulk_update_tasks(
        self,
        task_ids: list[uuid.UUID],
        action: str,
        value: Any,
        actor_id: uuid.UUID,
    ) -> tuple[int, list[uuid.UUID]]:
        success_count = 0
        failed_ids: list[uuid.UUID] = []

        stmt = select(Task).where(Task.id.in_(task_ids), Task.deleted_at.is_(None))
        res = await self.session.execute(stmt)
        tasks = list(res.scalars().all())
        found_map = {t.id: t for t in tasks}

        for tid in task_ids:
            task = found_map.get(tid)
            if not task:
                failed_ids.append(tid)
                continue

            try:
                if action == "STATUS":
                    task.status = TaskStatus(str(value))
                    if task.status == TaskStatus.DONE:
                        for st in task.subtasks:
                            st.completed = True
                            st.status = "DONE"
                elif action == "PRIORITY":
                    task.priority = TaskPriority(str(value))
                elif action == "ASSIGN":
                    raw_uids = value if isinstance(value, list) else [value]
                    uids = [uuid.UUID(str(u)) for u in raw_uids]
                    await self.set_assignees(task, uids, role="ASSIGNEE")
                elif action == "ADD_WATCHER":
                    raw_uids = value if isinstance(value, list) else [value]
                    uids = [uuid.UUID(str(u)) for u in raw_uids]
                    for uid in uids:
                        chk = select(TaskAssignee).where(
                            TaskAssignee.task_id == task.id,
                            TaskAssignee.user_id == uid,
                            TaskAssignee.assignment_role == "WATCHER",
                        )
                        chk_res = await self.session.execute(chk)
                        if not chk_res.scalar_one_or_none():
                            self.session.add(TaskAssignee(task_id=task.id, user_id=uid, assignment_role="WATCHER"))
                elif action == "ADD_LABEL":
                    label_id = uuid.UUID(str(value))
                    await self.add_task_label(task.id, label_id)
                elif action == "REMOVE_LABEL":
                    label_id = uuid.UUID(str(value))
                    await self.remove_task_label(task.id, label_id)
                elif action == "SET_SPRINT":
                    task.sprint_id = uuid.UUID(str(value)) if value else None
                elif action == "DELETE":
                    task.deleted_at = datetime.now(timezone.utc)
                success_count += 1
            except Exception:
                failed_ids.append(tid)

        await self.session.flush()
        return success_count, failed_ids

    # --- Hierarchy & Rollup ---
    async def get_child_tasks(self, parent_task_id: uuid.UUID) -> list[Task]:
        stmt = (
            select(Task)
            .where(Task.parent_task_id == parent_task_id, Task.deleted_at.is_(None))
            .order_by(Task.created_at.asc())
        )
        res = await self.session.execute(stmt)
        return list(res.scalars().all())

    def calculate_task_progress(self, task: Task) -> int:
        if task.child_tasks:
            total = len(task.child_tasks)
            completed = sum(1 for c in task.child_tasks if c.status == TaskStatus.DONE)
            return int((completed / total) * 100) if total > 0 else 0
        if task.subtasks:
            total = len(task.subtasks)
            completed = sum(1 for s in task.subtasks if s.completed or s.status == "DONE")
            return int((completed / total) * 100) if total > 0 else 0
        return 100 if task.status == TaskStatus.DONE else 0

    # --- Workload & Capacity ---
    async def get_team_workload(self, department_id: uuid.UUID | None = None) -> list[dict[str, Any]]:
        user_stmt = select(User).where(User.is_active.is_(True), User.deleted_at.is_(None))
        if department_id:
            user_stmt = user_stmt.join(UserRole, UserRole.user_id == User.id).where(UserRole.role_id == department_id)
        res = await self.session.execute(user_stmt)
        users = list(res.scalars().all())

        today = date.today()
        workload: list[dict[str, Any]] = []
        for u in users:
            stmt = (
                select(Task)
                .join(TaskAssignee, TaskAssignee.task_id == Task.id)
                .where(
                    TaskAssignee.user_id == u.id,
                    TaskAssignee.assignment_role == "ASSIGNEE",
                    Task.deleted_at.is_(None),
                )
            )
            t_res = await self.session.execute(stmt)
            tasks = list(t_res.scalars().all())

            open_count = sum(1 for t in tasks if t.status == TaskStatus.TODO)
            in_progress_count = sum(1 for t in tasks if t.status == TaskStatus.IN_PROGRESS)
            completed_count = sum(1 for t in tasks if t.status == TaskStatus.DONE)
            overdue_count = sum(1 for t in tasks if t.due_date and t.due_date < today and t.status != TaskStatus.DONE)
            high_priority_count = sum(
                1 for t in tasks if t.priority in (TaskPriority.HIGH, TaskPriority.CRITICAL) and t.status != TaskStatus.DONE
            )

            workload.append({
                "user_id": u.id,
                "user_name": u.full_name or u.email,
                "user_email": u.email,
                "department_name": None,
                "open_tasks_count": open_count,
                "in_progress_tasks_count": in_progress_count,
                "overdue_tasks_count": overdue_count,
                "completed_tasks_count": completed_count,
                "high_priority_count": high_priority_count,
            })

        return workload

    async def get_capacity_grid(
        self,
        start_date: date,
        end_date: date,
        department_id: uuid.UUID | None = None,
    ) -> list[dict[str, Any]]:
        user_stmt = select(User).where(User.is_active.is_(True), User.deleted_at.is_(None))
        if department_id:
            user_stmt = user_stmt.join(UserRole, UserRole.user_id == User.id).where(UserRole.role_id == department_id)
        res = await self.session.execute(user_stmt)
        users = list(res.scalars().all())

        from datetime import timedelta
        days: list[date] = []
        curr = start_date
        while curr <= end_date:
            days.append(curr)
            curr += timedelta(days=1)

        result: list[dict[str, Any]] = []
        for u in users:
            stmt = (
                select(Task)
                .join(TaskAssignee, TaskAssignee.task_id == Task.id)
                .where(
                    TaskAssignee.user_id == u.id,
                    TaskAssignee.assignment_role == "ASSIGNEE",
                    Task.deleted_at.is_(None),
                    Task.status != TaskStatus.DONE,
                    or_(
                        and_(Task.start_date.isnot(None), Task.start_date <= end_date, Task.due_date >= start_date),
                        and_(Task.due_date >= start_date, Task.due_date <= end_date),
                    ),
                )
            )
            t_res = await self.session.execute(stmt)
            tasks = list(t_res.scalars().all())

            allocations = []
            for d in days:
                d_tasks = []
                for t in tasks:
                    t_start = t.start_date or t.due_date
                    t_due = t.due_date or t.start_date
                    if t_start and t_due and t_start <= d <= t_due:
                        d_tasks.append(t.id)
                    elif t_due and t_due == d:
                        d_tasks.append(t.id)

                allocations.append({
                    "date": d,
                    "task_ids": d_tasks,
                    "task_count": len(d_tasks),
                })

            result.append({
                "user_id": u.id,
                "user_name": u.full_name or u.email,
                "allocations": allocations,
            })

        return result
