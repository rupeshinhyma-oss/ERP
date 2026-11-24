"""
Task Module Repository.
"""

from __future__ import annotations

import hashlib
import uuid
from datetime import date, datetime, timezone
from typing import Any

from sqlalchemy import and_, case, exists, func, or_, select, text, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import noload, selectinload

from app.common.base_repository import BaseRepository
from app.core.exceptions import ForbiddenException
from app.org_structure.models import DepartmentLeadershipAssignment, OrgRecordStatus
from app.rbac.models import Role, RoleAssignmentStatus, UserRole
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
    TaskRecurringSchedule,
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


def can_view_all_tasks(
    user_permissions: set[str] | list[str] | None,
    *,
    is_super_admin: bool = False,
) -> bool:
    """
    Determine whether an actor has all-department Enterprise Tasks READ visibility:
    - Admin (`is_super_admin`, `super_admin`, `*`),
    - Admin-approved read-only viewer (`task.all_view`), or
    - Administrative task manager (`task.manage`).
    Obsolete `task.organization_view` is intentionally no longer honored.
    """
    if is_super_admin:
        return True
    perms = set(user_permissions or set())
    return (
        "super_admin" in perms
        or "*" in perms
        or "task.all_view" in perms
        or "task.manage" in perms
    )


def is_task_admin_manager(
    user_permissions: set[str] | list[str] | None,
    *,
    is_super_admin: bool = False,
) -> bool:
    """
    Determine whether an actor has administrative Enterprise Tasks MUTATION privileges:
    - Admin (`is_super_admin`, `super_admin`, `*`), or
    - Explicit `task.manage`.
    Read-only visibility permissions (`task.all_view`, `task.department_view`,
    and obsolete `task.organization_view`) NEVER grant administrative mutation access.
    """
    if is_super_admin:
        return True
    perms = set(user_permissions or set())
    return (
        "super_admin" in perms
        or "*" in perms
        or "task.manage" in perms
    )


# Backwards-compatible alias for all-department read visibility checks
is_task_admin_or_approved = can_view_all_tasks


class TaskRepository(BaseRepository[Task]):
    """Async repository for Task entities and child relations."""

    def __init__(self, session: AsyncSession) -> None:
        super().__init__(session, Task)

    async def get_user_managed_department_ids(self, user_id: uuid.UUID) -> set[uuid.UUID]:
        """Fetch IDs of departments this user is explicitly authorized to manage via active DepartmentLeadershipAssignment."""
        managed_stmt = select(DepartmentLeadershipAssignment.department_id).where(
            DepartmentLeadershipAssignment.employee_id == user_id,
            DepartmentLeadershipAssignment.status == OrgRecordStatus.ACTIVE,
        )
        managed_res = await self.session.execute(managed_stmt)
        return set(managed_res.scalars().all())

    async def get_user_assigned_department_ids(self, user_id: uuid.UUID) -> set[uuid.UUID]:
        """Fetch IDs of departments this user is assigned to via UserRole (excluding system roles)."""
        role_stmt = (
            select(UserRole.role_id)
            .join(Role, UserRole.role_id == Role.id)
            .where(
                UserRole.user_id == user_id,
                or_(UserRole.status == RoleAssignmentStatus.ACTIVE, UserRole.status.is_(None)),
                Role.name.notin_(["super_admin", "user"]),
                Role.deleted_at.is_(None),
            )
        )
        role_res = await self.session.execute(role_stmt)
        return set(role_res.scalars().all())

    async def get_user_permitted_department_ids(self, user_id: uuid.UUID) -> set[uuid.UUID]:
        managed = await self.get_user_managed_department_ids(user_id)
        assigned = await self.get_user_assigned_department_ids(user_id)
        return managed | assigned

    async def get_user_department_scope_ids(
        self,
        user_id: uuid.UUID,
        user_permissions: set[str] | list[str] | None = None,
    ) -> set[uuid.UUID]:
        """
        Resolve authoritative department IDs for department-wide task visibility:
        - Active DepartmentLeadershipAssignment -> managed department(s).
        - Explicit `task.department_view` permission (without leadership row) -> assigned department(s).
        - Plain employee (neither leadership nor `task.department_view`) -> empty set (My Tasks only).
        """
        managed = await self.get_user_managed_department_ids(user_id)
        if managed:
            return managed
        perms = set(user_permissions or set())
        if "task.department_view" in perms:
            return await self.get_user_assigned_department_ids(user_id)
        return set()

    async def get_department_user_ids(self, dept_ids: set[uuid.UUID] | list[uuid.UUID]) -> set[uuid.UUID]:
        """Return all active member and leader user IDs for the given department role IDs."""
        dept_list = list(dept_ids)
        if not dept_list:
            return set()
        dept_users_subq = select(UserRole.user_id).where(
            UserRole.role_id.in_(dept_list),
            or_(UserRole.status == RoleAssignmentStatus.ACTIVE, UserRole.status.is_(None)),
        )
        lead_users_subq = select(DepartmentLeadershipAssignment.employee_id).where(
            DepartmentLeadershipAssignment.department_id.in_(dept_list),
            DepartmentLeadershipAssignment.status == OrgRecordStatus.ACTIVE,
        )
        res = await self.session.execute(dept_users_subq.union(lead_users_subq))
        return set(res.scalars().all())

    async def get_department_names_by_ids(self, dept_ids: set[uuid.UUID] | list[uuid.UUID]) -> set[str]:
        """Return lowercase department names for the given department role IDs."""
        dept_list = list(dept_ids)
        if not dept_list:
            return set()
        stmt = select(Role.name).where(Role.id.in_(dept_list), Role.deleted_at.is_(None))
        res = await self.session.execute(stmt)
        return {name.lower() for name in res.scalars().all() if name}

    async def resolve_tasks_departments(
        self, task_ids: list[uuid.UUID]
    ) -> dict[uuid.UUID, tuple[uuid.UUID | None, str | None]]:
        """
        Deterministically resolve (department_id, department_name) for tasks.
        Assignee leadership/role takes highest precedence, followed by creator leadership/role.
        """
        if not task_ids:
            return {}
        from sqlalchemy import text
        sql = """
        WITH task_users AS (
            SELECT t.id as task_id, ta.user_id,
                   CASE WHEN ta.assignment_role = 'ASSIGNEE' THEN 1 ELSE 2 END as priority
            FROM tasks t
            JOIN task_assignees ta ON t.id = ta.task_id
            WHERE t.id = ANY(:task_ids)
            UNION ALL
            SELECT t.id as task_id, t.created_by as user_id, 3 as priority
            FROM tasks t
            WHERE t.id = ANY(:task_ids) AND t.created_by IS NOT NULL
        ),
        user_dept AS (
            SELECT dla.employee_id as user_id, dla.department_id, r.name as dept_name, 1 as dept_rank
            FROM department_leadership_assignments dla
            JOIN roles r ON dla.department_id = r.id
            WHERE dla.status = 'ACTIVE'
            UNION ALL
            SELECT ur.user_id, ur.role_id as department_id, r.name as dept_name, 2 as dept_rank
            FROM user_roles ur
            JOIN roles r ON ur.role_id = r.id
            WHERE (ur.status = 'ACTIVE' OR ur.status IS NULL)
              AND r.name NOT IN ('super_admin', 'user')
        )
        SELECT DISTINCT ON (tu.task_id)
            tu.task_id, ud.department_id, ud.dept_name
        FROM task_users tu
        JOIN user_dept ud ON tu.user_id = ud.user_id
        ORDER BY tu.task_id, tu.priority ASC, ud.dept_rank ASC
        """
        res = await self.session.execute(text(sql), {"task_ids": [str(tid) for tid in task_ids]})
        result: dict[uuid.UUID, tuple[uuid.UUID | None, str | None]] = {}
        for row in res.fetchall():
            result[uuid.UUID(str(row[0]))] = (uuid.UUID(str(row[1])) if row[1] else None, row[2])
        return result

    async def get_task_department(self, task_id: uuid.UUID) -> tuple[uuid.UUID | None, str | None]:
        res = await self.resolve_tasks_departments([task_id])
        return res.get(task_id, (None, None))

    async def get_user_primary_department_id(self, user_id: uuid.UUID) -> uuid.UUID | None:
        """Resolve a user's primary/default department deterministically according to leadership and role assignments."""
        from sqlalchemy import case
        from app.org_structure.models import LeadershipType, OrgRecordStatus
        from app.rbac.models import RoleAssignmentStatus, RoleAssignmentType

        # 1. Active leadership assignments ordered by leadership precedence
        lead_stmt = (
            select(DepartmentLeadershipAssignment.department_id)
            .where(
                DepartmentLeadershipAssignment.employee_id == user_id,
                DepartmentLeadershipAssignment.status == OrgRecordStatus.ACTIVE,
            )
            .order_by(
                case(
                    (DepartmentLeadershipAssignment.leadership_type == LeadershipType.PRIMARY_MANAGER, 1),
                    (DepartmentLeadershipAssignment.leadership_type == LeadershipType.DEPARTMENT_HEAD, 2),
                    (DepartmentLeadershipAssignment.leadership_type == LeadershipType.ACTING_MANAGER, 3),
                    (DepartmentLeadershipAssignment.leadership_type == LeadershipType.ASSISTANT_MANAGER, 4),
                    else_=5,
                ),
                DepartmentLeadershipAssignment.department_id,
            )
        )
        lead_res = await self.session.execute(lead_stmt)
        dept = lead_res.scalars().first()
        if dept:
            return dept

        # 2. Active UserRole assignments ordered by is_primary, PRIMARY assignment_type, then role_id
        role_stmt = (
            select(UserRole.role_id)
            .where(
                UserRole.user_id == user_id,
                UserRole.status == RoleAssignmentStatus.ACTIVE,
            )
            .order_by(
                UserRole.is_primary.desc(),
                case(
                    (UserRole.assignment_type == RoleAssignmentType.PRIMARY, 1),
                    else_=2,
                ),
                UserRole.role_id,
            )
        )
        role_res = await self.session.execute(role_stmt)
        return role_res.scalars().first()

    async def get_users_primary_departments(
        self, user_ids: list[uuid.UUID]
    ) -> dict[uuid.UUID, tuple[uuid.UUID | None, str | None]]:
        """
        Batched resolution of (primary_department_id, primary_department_name) for many users
        in at most 2 SQL queries, preserving the exact precedence of `get_user_primary_department_id`.
        """
        unique_ids = list(dict.fromkeys(user_ids))
        if not unique_ids:
            return {}

        from app.org_structure.models import LeadershipType
        from app.rbac.models import RoleAssignmentType

        result: dict[uuid.UUID, tuple[uuid.UUID | None, str | None]] = {}

        # 1. Active leadership assignments ordered by leadership precedence
        lead_stmt = (
            select(
                DepartmentLeadershipAssignment.employee_id,
                DepartmentLeadershipAssignment.department_id,
                Role.name,
            )
            .join(Role, DepartmentLeadershipAssignment.department_id == Role.id)
            .where(
                DepartmentLeadershipAssignment.employee_id.in_(unique_ids),
                DepartmentLeadershipAssignment.status == OrgRecordStatus.ACTIVE,
                Role.deleted_at.is_(None),
            )
            .order_by(
                DepartmentLeadershipAssignment.employee_id,
                case(
                    (DepartmentLeadershipAssignment.leadership_type == LeadershipType.PRIMARY_MANAGER, 1),
                    (DepartmentLeadershipAssignment.leadership_type == LeadershipType.DEPARTMENT_HEAD, 2),
                    (DepartmentLeadershipAssignment.leadership_type == LeadershipType.ACTING_MANAGER, 3),
                    (DepartmentLeadershipAssignment.leadership_type == LeadershipType.ASSISTANT_MANAGER, 4),
                    else_=5,
                ),
                DepartmentLeadershipAssignment.department_id,
            )
        )
        lead_res = await self.session.execute(lead_stmt)
        for emp_id, dept_id, dept_name in lead_res.fetchall():
            if emp_id not in result:
                result[emp_id] = (dept_id, dept_name)

        remaining_ids = [uid for uid in unique_ids if uid not in result]
        if remaining_ids:
            # 2. Active UserRole assignments ordered by is_primary, PRIMARY assignment_type, then role_id
            role_stmt = (
                select(
                    UserRole.user_id,
                    UserRole.role_id,
                    Role.name,
                )
                .join(Role, UserRole.role_id == Role.id)
                .where(
                    UserRole.user_id.in_(remaining_ids),
                    UserRole.status == RoleAssignmentStatus.ACTIVE,
                    Role.deleted_at.is_(None),
                )
                .order_by(
                    UserRole.user_id,
                    UserRole.is_primary.desc(),
                    case(
                        (UserRole.assignment_type == RoleAssignmentType.PRIMARY, 1),
                        else_=2,
                    ),
                    UserRole.role_id,
                )
            )
            role_res = await self.session.execute(role_stmt)
            for uid, role_id, role_name in role_res.fetchall():
                if uid not in result:
                    result[uid] = (role_id, role_name)

        return result

    async def list_tasks(
        self,
        *,
        current_user_id: uuid.UUID,
        user_permissions: set[str],
        is_super_admin: bool = False,
        view_mode: str = "all",  # "all", "my", "department", "kanban", "calendar"
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
        """List tasks applying authoritative role-based visibility rules, filters, and pagination."""
        base_query = select(Task).where(Task.deleted_at.is_(None))
        normalized_view = (view_mode or "all").strip().lower()

        # --- Authoritative Role & Scope Determination ---
        can_view_all = can_view_all_tasks(
            user_permissions, is_super_admin=is_super_admin
        )
        dept_scope_ids = (
            set()
            if can_view_all
            else await self.get_user_department_scope_ids(current_user_id, user_permissions)
        )
        is_dept_manager = bool(dept_scope_ids)

        def get_dept_task_condition(dept_ids: list[uuid.UUID]):
            dept_users_subq = select(UserRole.user_id).where(
                UserRole.role_id.in_(dept_ids),
                or_(UserRole.status == RoleAssignmentStatus.ACTIVE, UserRole.status.is_(None)),
            )
            lead_users_subq = select(DepartmentLeadershipAssignment.employee_id).where(
                DepartmentLeadershipAssignment.department_id.in_(dept_ids),
                DepartmentLeadershipAssignment.status == OrgRecordStatus.ACTIVE,
            )
            all_dept_users = dept_users_subq.union(lead_users_subq)
            return or_(
                Task.created_by.in_(all_dept_users),
                Task.id.in_(
                    select(TaskAssignee.task_id).where(TaskAssignee.user_id.in_(all_dept_users))
                ),
            )

        own_task_condition = or_(
            Task.created_by == current_user_id,
            Task.approver_id == current_user_id,
            Task.id.in_(select(TaskAssignee.task_id).where(TaskAssignee.user_id == current_user_id)),
        )

        target_depts: list[uuid.UUID] = []
        if department_id:
            target_depts.append(department_id)
        if department_ids:
            target_depts.extend(department_ids)

        if can_view_all:
            # 1. Admin & Admin-approved users: all tasks across all departments
            if normalized_view == "my":
                base_query = base_query.where(own_task_condition)
            if target_depts:
                base_query = base_query.where(get_dept_task_condition(target_depts))
        elif is_dept_manager:
            # 2. Department Manager: restricted strictly to own/managed department(s)
            if normalized_view == "organization":
                raise ForbiddenException("You do not have permission to access organization-wide tasks.")
            if target_depts:
                unauthorized = [d for d in target_depts if d not in dept_scope_ids]
                if unauthorized:
                    raise ForbiddenException("You do not have permission to view tasks for this department.")
            if normalized_view == "my":
                base_query = base_query.where(own_task_condition)
                if target_depts:
                    base_query = base_query.where(get_dept_task_condition(target_depts))
            elif target_depts:
                base_query = base_query.where(get_dept_task_condition(target_depts))
            elif normalized_view == "department":
                base_query = base_query.where(get_dept_task_condition(list(dept_scope_ids)))
            else:
                # "all", "kanban", "calendar": own department tasks + own assigned/created tasks
                base_query = base_query.where(
                    or_(
                        get_dept_task_condition(list(dept_scope_ids)),
                        own_task_condition,
                    )
                )
        else:
            # 3. Employee: strictly own tasks only; department/organization views & filters denied
            if normalized_view in ("department", "organization"):
                raise ForbiddenException("You do not have permission to view department or organization tasks.")
            if target_depts:
                raise ForbiddenException("You do not have permission to filter tasks by department.")
            base_query = base_query.where(own_task_condition)

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
                selectinload(Task.dependencies),
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

    def _is_postgres(self) -> bool:
        try:
            bind = self.session.bind or getattr(self.session, "get_bind", lambda: None)()
            return bool(bind and getattr(bind.dialect, "name", "") == "postgresql")
        except Exception:
            return False

    @staticmethod
    def _advisory_lock_key(namespace: str, entity_id: uuid.UUID) -> int:
        digest = hashlib.sha256(f"{namespace}:{entity_id}".encode("utf-8")).digest()
        return int.from_bytes(digest[:8], byteorder="big", signed=True)

    async def lock_task_row(self, task_id: uuid.UUID) -> uuid.UUID | None:
        """Acquire a row-level FOR UPDATE lock on the task row in PostgreSQL."""
        if not self._is_postgres():
            return task_id
        stmt = (
            select(Task.id)
            .where(Task.id == task_id, Task.deleted_at.is_(None))
            .with_for_update()
        )
        res = await self.session.execute(stmt)
        return res.scalar_one_or_none()

    async def get_task_by_id(self, task_id: uuid.UUID, *, include_deleted: bool = False) -> Task | None:
        stmt = (
            select(Task)
            .where(Task.id == task_id)
            .options(
                selectinload(Task.creator),
                selectinload(Task.parent_task),
                selectinload(Task.child_tasks),
                selectinload(Task.sprint),
                selectinload(Task.approver),
                selectinload(Task.assignees).selectinload(TaskAssignee.user),
                selectinload(Task.subtasks).selectinload(TaskSubtask.assignee),
                selectinload(Task.subtasks).selectinload(TaskSubtask.assignees).selectinload(TaskSubtaskAssignee.user),
                selectinload(Task.comments).selectinload(TaskComment.user),
                selectinload(Task.comments).selectinload(TaskComment.attachments),
                selectinload(Task.comments).selectinload(TaskComment.reactions),
                selectinload(Task.escalations).selectinload(TaskEscalation.from_user_rel),
                selectinload(Task.escalations).selectinload(TaskEscalation.to_user_rel),
                selectinload(Task.escalations).selectinload(TaskEscalation.comments).selectinload(TaskEscalationComment.user),
                selectinload(Task.attachments).selectinload(TaskAttachment.uploader),
                selectinload(Task.voice_notes).selectinload(TaskVoiceNote.uploader),
                selectinload(Task.task_label_links).selectinload(TaskLabelLink.label),
                selectinload(Task.labels),
                selectinload(Task.dependencies).selectinload(TaskDependency.depends_on_task),
                selectinload(Task.dependent_on),
                selectinload(Task.reactions),
            )
            .execution_options(populate_existing=True)
        )
        if not include_deleted:
            stmt = stmt.where(Task.deleted_at.is_(None))
        res = await self.session.execute(stmt)
        return res.scalar_one_or_none()

    async def get_incomplete_blocking_task_titles(self, task_id: uuid.UUID) -> list[str]:
        """Return titles of all active incomplete tasks blocking `task_id`."""
        blocked_by_stmt = (
            select(Task.title)
            .join(TaskDependency, TaskDependency.depends_on_task_id == Task.id)
            .where(
                TaskDependency.task_id == task_id,
                TaskDependency.relationship_type == DependencyType.BLOCKED_BY.value,
                Task.deleted_at.is_(None),
                Task.status != TaskStatus.DONE,
            )
        )
        blocks_inverse_stmt = (
            select(Task.title)
            .join(TaskDependency, TaskDependency.task_id == Task.id)
            .where(
                TaskDependency.depends_on_task_id == task_id,
                TaskDependency.relationship_type == DependencyType.BLOCKS.value,
                Task.deleted_at.is_(None),
                Task.status != TaskStatus.DONE,
            )
        )
        res1 = await self.session.execute(blocked_by_stmt)
        res2 = await self.session.execute(blocks_inverse_stmt)
        titles: list[str] = []
        seen: set[str] = set()
        for t in list(res1.scalars().all()) + list(res2.scalars().all()):
            if t and t not in seen:
                seen.add(t)
                titles.append(t)
        return titles

    async def set_assignees(
        self,
        task: Task,
        user_ids: list[uuid.UUID],
        *,
        role: str = "ASSIGNEE",
    ) -> list[TaskAssignee]:
        """Replace assignees for a given role (or general assignees)."""
        deduped_user_ids = list(dict.fromkeys(user_ids))
        stmt = select(TaskAssignee).where(
            TaskAssignee.task_id == task.id,
            TaskAssignee.assignment_role == role,
        )
        res = await self.session.execute(stmt)
        existing_with_role = list(res.scalars().all())
        current_map = {a.user_id: a for a in existing_with_role}

        deleted_any = False
        for uid, a in list(current_map.items()):
            if uid not in deduped_user_ids:
                await self.session.delete(a)
                deleted_any = True
        if deleted_any:
            await self.session.flush()

        new_assignees: list[TaskAssignee] = []
        for uid in deduped_user_ids:
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
        return (await self.get_subtask_by_id(sub.id)) or sub

    async def get_subtask_by_id(self, subtask_id: uuid.UUID) -> TaskSubtask | None:
        stmt = (
            select(TaskSubtask)
            .options(
                selectinload(TaskSubtask.assignees).selectinload(TaskSubtaskAssignee.user),
                selectinload(TaskSubtask.assignee),
            )
            .where(TaskSubtask.id == subtask_id)
        )
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
        return (await self.get_subtask_by_id(subtask.id)) or subtask

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

    async def get_voice_note_by_id(self, voice_note_id: uuid.UUID) -> TaskVoiceNote | None:
        stmt = (
            select(TaskVoiceNote)
            .where(TaskVoiceNote.id == voice_note_id)
            .options(selectinload(TaskVoiceNote.uploader))
            .execution_options(populate_existing=True)
        )
        res = await self.session.execute(stmt)
        return res.scalar_one_or_none()

    async def delete_voice_note(self, voice_note: TaskVoiceNote) -> None:
        await self.session.delete(voice_note)
        await self.session.flush()

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
        stmt = (
            select(TaskEscalation)
            .where(TaskEscalation.id == escalation_id)
            .options(
                selectinload(TaskEscalation.from_user_rel),
                selectinload(TaskEscalation.to_user_rel),
                selectinload(TaskEscalation.comments).selectinload(TaskEscalationComment.user),
            )
            .execution_options(populate_existing=True)
        )
        res = await self.session.execute(stmt)
        return res.scalar_one_or_none()

    async def find_recent_identical_escalation(
        self,
        *,
        task_id: uuid.UUID,
        from_user: uuid.UUID,
        to_user: uuid.UUID,
        reason: str,
        escalation_type: str,
        due_date: date | None,
        since: datetime,
    ) -> TaskEscalation | None:
        stmt = (
            select(TaskEscalation)
            .where(
                TaskEscalation.task_id == task_id,
                TaskEscalation.from_user == from_user,
                TaskEscalation.to_user == to_user,
                TaskEscalation.reason == reason,
                TaskEscalation.escalation_type == escalation_type,
                TaskEscalation.due_date == due_date,
                TaskEscalation.created_at >= since,
            )
            .options(
                selectinload(TaskEscalation.from_user_rel),
                selectinload(TaskEscalation.to_user_rel),
                selectinload(TaskEscalation.comments).selectinload(TaskEscalationComment.user),
            )
            .order_by(TaskEscalation.created_at.desc())
            .limit(1)
        )
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
        stmt = select(TaskSprint).options(noload(TaskSprint.creator))
        if status is not None:
            stmt = stmt.where(TaskSprint.status == status)
        stmt = stmt.order_by(TaskSprint.created_at.desc())
        res = await self.session.execute(stmt)
        return list(res.scalars().all())

    async def get_sprint_task_counts(
        self,
        sprint_ids: list[uuid.UUID],
        *,
        can_view_all: bool = True,
        actor_id: uuid.UUID | None = None,
        scoped_dept_users: set[uuid.UUID] | None = None,
    ) -> dict[uuid.UUID, tuple[int, int]]:
        """
        Return {sprint_id: (total_visible_tasks, completed_visible_tasks)} in a single SQL GROUP BY query
        respecting exact role-based visibility scoping without hydrating Task ORM objects.
        """
        if not sprint_ids:
            return {}
        stmt = select(
            Task.sprint_id,
            func.count(Task.id).label("task_count"),
            func.coalesce(
                func.sum(case((Task.status == TaskStatus.DONE, 1), else_=0)),
                0,
            ).label("completed_count"),
        ).where(
            Task.sprint_id.in_(sprint_ids),
            Task.deleted_at.is_(None),
        )

        if not can_view_all and actor_id is not None:
            if scoped_dept_users is not None:
                allowed = list(scoped_dept_users)
                stmt = stmt.where(
                    or_(
                        Task.created_by.in_(allowed),
                        Task.approver_id.in_(allowed),
                        exists(
                            select(1).where(
                                TaskAssignee.task_id == Task.id,
                                TaskAssignee.user_id.in_(allowed),
                            )
                        ),
                    )
                )
            else:
                stmt = stmt.where(
                    or_(
                        Task.created_by == actor_id,
                        Task.approver_id == actor_id,
                        exists(
                            select(1).where(
                                TaskAssignee.task_id == Task.id,
                                TaskAssignee.user_id == actor_id,
                            )
                        ),
                    )
                )

        stmt = stmt.group_by(Task.sprint_id)
        res = await self.session.execute(stmt)
        return {
            row[0]: (int(row[1] or 0), int(row[2] or 0))
            for row in res.fetchall()
            if row[0] is not None
        }

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

    async def get_dependency_by_id(self, dependency_id: uuid.UUID) -> TaskDependency | None:
        stmt = (
            select(TaskDependency)
            .where(TaskDependency.id == dependency_id)
            .options(selectinload(TaskDependency.depends_on_task))
            .execution_options(populate_existing=True)
        )
        res = await self.session.execute(stmt)
        return res.scalar_one_or_none()

    async def add_dependency(
        self,
        task_id: uuid.UUID,
        depends_on_task_id: uuid.UUID,
        dependency_type: DependencyType | str = DependencyType.BLOCKS,
    ) -> TaskDependency:
        dep_type_val = dependency_type.value if hasattr(dependency_type, "value") else str(dependency_type)
        stmt = select(TaskDependency).where(
            TaskDependency.task_id == task_id,
            TaskDependency.depends_on_task_id == depends_on_task_id,
        )
        res = await self.session.execute(stmt)
        existing = res.scalar_one_or_none()
        if existing:
            existing.dependency_type = dep_type_val
            await self.session.flush()
            return (await self.get_dependency_by_id(existing.id)) or existing

        dep = TaskDependency(
            task_id=task_id,
            depends_on_task_id=depends_on_task_id,
            dependency_type=dep_type_val,
        )
        self.session.add(dep)
        await self.session.flush()
        return (await self.get_dependency_by_id(dep.id)) or dep

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
    @staticmethod
    def _format_user_display_name(
        display_name: str | None,
        first_name: str | None,
        last_name: str | None,
        username: str | None,
        email: str | None,
    ) -> str:
        full = f"{first_name or ''} {last_name or ''}".strip()
        return display_name or full or username or email or "Team Member"

    async def get_team_workload(
        self,
        department_id: uuid.UUID | None = None,
        *,
        department_ids: set[uuid.UUID] | list[uuid.UUID] | None = None,
        user_id: uuid.UUID | None = None,
    ) -> list[dict[str, Any]]:
        user_stmt = select(
            User.id,
            User.display_name,
            User.first_name,
            User.last_name,
            User.username,
            User.email,
        ).where(User.is_active.is_(True), User.deleted_at.is_(None))
        if user_id is not None:
            user_stmt = user_stmt.where(User.id == user_id)
        elif department_id is not None:
            dept_uids = await self.get_department_user_ids([department_id])
            if not dept_uids:
                return []
            user_stmt = user_stmt.where(User.id.in_(dept_uids))
        elif department_ids is not None:
            dept_uids = await self.get_department_user_ids(list(department_ids))
            if not dept_uids:
                return []
            user_stmt = user_stmt.where(User.id.in_(dept_uids))
        res = await self.session.execute(user_stmt)
        user_rows = res.fetchall()
        if not user_rows:
            return []

        user_ids = [row[0] for row in user_rows]
        today = date.today()

        agg_stmt = (
            select(
                TaskAssignee.user_id,
                func.coalesce(func.sum(case((Task.status == TaskStatus.TODO, 1), else_=0)), 0),
                func.coalesce(func.sum(case((Task.status == TaskStatus.IN_PROGRESS, 1), else_=0)), 0),
                func.coalesce(func.sum(case((Task.status == TaskStatus.DONE, 1), else_=0)), 0),
                func.coalesce(
                    func.sum(
                        case(
                            (
                                and_(
                                    Task.due_date.is_not(None),
                                    Task.due_date < today,
                                    Task.status != TaskStatus.DONE,
                                ),
                                1,
                            ),
                            else_=0,
                        )
                    ),
                    0,
                ),
                func.coalesce(
                    func.sum(
                        case(
                            (
                                and_(
                                    Task.priority.in_([TaskPriority.HIGH, TaskPriority.CRITICAL]),
                                    Task.status != TaskStatus.DONE,
                                ),
                                1,
                            ),
                            else_=0,
                        )
                    ),
                    0,
                ),
            )
            .join(Task, TaskAssignee.task_id == Task.id)
            .where(
                TaskAssignee.user_id.in_(user_ids),
                TaskAssignee.assignment_role == "ASSIGNEE",
                Task.deleted_at.is_(None),
            )
            .group_by(TaskAssignee.user_id)
        )
        agg_res = await self.session.execute(agg_stmt)
        stats_by_user: dict[uuid.UUID, tuple[int, int, int, int, int]] = {
            row[0]: (int(row[1]), int(row[2]), int(row[3]), int(row[4]), int(row[5]))
            for row in agg_res.fetchall()
        }

        workload: list[dict[str, Any]] = []
        for uid, dname, fname, lname, uname, email in user_rows:
            open_cnt, in_prog_cnt, done_cnt, overdue_cnt, high_cnt = stats_by_user.get(
                uid, (0, 0, 0, 0, 0)
            )
            workload.append({
                "user_id": uid,
                "user_name": self._format_user_display_name(dname, fname, lname, uname, email),
                "user_email": email,
                "department_name": None,
                "open_tasks_count": open_cnt,
                "in_progress_tasks_count": in_prog_cnt,
                "overdue_tasks_count": overdue_cnt,
                "completed_tasks_count": done_cnt,
                "high_priority_count": high_cnt,
            })

        return workload

    async def get_capacity_grid(
        self,
        start_date: date,
        end_date: date,
        department_id: uuid.UUID | None = None,
        *,
        department_ids: set[uuid.UUID] | list[uuid.UUID] | None = None,
        user_id: uuid.UUID | None = None,
    ) -> list[dict[str, Any]]:
        user_stmt = select(
            User.id,
            User.display_name,
            User.first_name,
            User.last_name,
            User.username,
            User.email,
        ).where(User.is_active.is_(True), User.deleted_at.is_(None))
        if user_id is not None:
            user_stmt = user_stmt.where(User.id == user_id)
        elif department_id is not None:
            dept_uids = await self.get_department_user_ids([department_id])
            if not dept_uids:
                return []
            user_stmt = user_stmt.where(User.id.in_(dept_uids))
        elif department_ids is not None:
            dept_uids = await self.get_department_user_ids(list(department_ids))
            if not dept_uids:
                return []
            user_stmt = user_stmt.where(User.id.in_(dept_uids))
        res = await self.session.execute(user_stmt)
        user_rows = res.fetchall()
        if not user_rows:
            return []

        user_ids = [row[0] for row in user_rows]

        from datetime import timedelta
        days: list[date] = []
        curr = start_date
        while curr <= end_date:
            days.append(curr)
            curr += timedelta(days=1)

        task_rows_stmt = (
            select(
                TaskAssignee.user_id,
                Task.id,
                Task.start_date,
                Task.due_date,
            )
            .join(Task, TaskAssignee.task_id == Task.id)
            .where(
                TaskAssignee.user_id.in_(user_ids),
                TaskAssignee.assignment_role == "ASSIGNEE",
                Task.deleted_at.is_(None),
                Task.status != TaskStatus.DONE,
                or_(
                    and_(Task.start_date.is_not(None), Task.start_date <= end_date, Task.due_date >= start_date),
                    and_(Task.due_date >= start_date, Task.due_date <= end_date),
                ),
            )
        )
        t_res = await self.session.execute(task_rows_stmt)
        tasks_by_user: dict[uuid.UUID, list[tuple[uuid.UUID, date | None, date | None]]] = {}
        for uid, tid, t_start, t_due in t_res.fetchall():
            tasks_by_user.setdefault(uid, []).append((tid, t_start, t_due))

        result: list[dict[str, Any]] = []
        for uid, dname, fname, lname, uname, email in user_rows:
            user_tasks = tasks_by_user.get(uid, [])
            allocations = []
            for d in days:
                d_tasks = []
                for tid, raw_start, raw_due in user_tasks:
                    t_start = raw_start or raw_due
                    t_due = raw_due or raw_start
                    if t_start and t_due and t_start <= d <= t_due:
                        d_tasks.append(tid)
                    elif t_due and t_due == d:
                        d_tasks.append(tid)

                allocations.append({
                    "date": d,
                    "task_ids": d_tasks,
                    "task_count": len(d_tasks),
                })

            result.append({
                "user_id": uid,
                "user_name": self._format_user_display_name(dname, fname, lname, uname, email),
                "allocations": allocations,
            })

        return result

    # --- Recurring Task Schedules ---
    async def create_recurring_schedule(self, schedule: TaskRecurringSchedule) -> TaskRecurringSchedule:
        self.session.add(schedule)
        await self.session.commit()
        await self.session.refresh(schedule, ["assignee", "manager", "creator"])
        return schedule

    async def lock_recurring_schedule(self, schedule_id: uuid.UUID) -> TaskRecurringSchedule | None:
        """
        Acquire per-schedule PostgreSQL transaction-scoped advisory lock AND row-level FOR UPDATE lock
        so concurrent HTTP or worker generation runs cannot create duplicate tasks for the same period.
        """
        if self._is_postgres():
            lock_id = self._advisory_lock_key("recurring_schedule", schedule_id)
            await self.session.execute(
                text("SELECT pg_advisory_xact_lock(:lock_id)"),
                {"lock_id": lock_id},
            )
            stmt = (
                select(TaskRecurringSchedule)
                .where(
                    TaskRecurringSchedule.id == schedule_id,
                    TaskRecurringSchedule.deleted_at.is_(None),
                )
                .options(
                    selectinload(TaskRecurringSchedule.assignee),
                    selectinload(TaskRecurringSchedule.manager),
                    selectinload(TaskRecurringSchedule.creator),
                )
                .with_for_update()
                .execution_options(populate_existing=True)
            )
            res = await self.session.execute(stmt)
            return res.scalar_one_or_none()
        return await self.get_recurring_schedule(schedule_id)

    async def get_recurring_schedule(self, schedule_id: uuid.UUID) -> TaskRecurringSchedule | None:
        stmt = (
            select(TaskRecurringSchedule)
            .where(
                TaskRecurringSchedule.id == schedule_id,
                TaskRecurringSchedule.deleted_at.is_(None),
            )
            .options(
                selectinload(TaskRecurringSchedule.assignee),
                selectinload(TaskRecurringSchedule.manager),
                selectinload(TaskRecurringSchedule.creator),
            )
        )
        res = await self.session.execute(stmt)
        return res.scalar_one_or_none()

    async def list_recurring_schedules(
        self,
        department: str | None = None,
        status: str | None = None,
        frequency: str | None = None,
        *,
        scoped_user_id: uuid.UUID | None = None,
        scoped_department_user_ids: set[uuid.UUID] | None = None,
        scoped_department_names: set[str] | None = None,
    ) -> list[TaskRecurringSchedule]:
        stmt = (
            select(TaskRecurringSchedule)
            .where(TaskRecurringSchedule.deleted_at.is_(None))
            .options(
                selectinload(TaskRecurringSchedule.assignee),
                selectinload(TaskRecurringSchedule.manager),
                selectinload(TaskRecurringSchedule.creator),
            )
            .order_by(TaskRecurringSchedule.created_at.desc())
        )
        if scoped_department_user_ids is not None or scoped_department_names is not None:
            dept_clauses = []
            if scoped_user_id is not None:
                dept_clauses.extend([
                    TaskRecurringSchedule.assignee_id == scoped_user_id,
                    TaskRecurringSchedule.manager_id == scoped_user_id,
                    TaskRecurringSchedule.created_by == scoped_user_id,
                ])
            if scoped_department_user_ids:
                dept_clauses.extend([
                    TaskRecurringSchedule.assignee_id.in_(scoped_department_user_ids),
                    TaskRecurringSchedule.manager_id.in_(scoped_department_user_ids),
                    TaskRecurringSchedule.created_by.in_(scoped_department_user_ids),
                ])
            if scoped_department_names:
                dept_clauses.append(func.lower(TaskRecurringSchedule.department).in_(scoped_department_names))
            stmt = stmt.where(or_(*dept_clauses) if dept_clauses else TaskRecurringSchedule.id.is_(None))
        elif scoped_user_id is not None:
            stmt = stmt.where(
                or_(
                    TaskRecurringSchedule.assignee_id == scoped_user_id,
                    TaskRecurringSchedule.manager_id == scoped_user_id,
                    TaskRecurringSchedule.created_by == scoped_user_id,
                )
            )
        if department:
            stmt = stmt.where(func.lower(TaskRecurringSchedule.department) == department.lower())
        if status:
            stmt = stmt.where(TaskRecurringSchedule.status == status)
        if frequency:
            stmt = stmt.where(TaskRecurringSchedule.frequency == frequency.upper())

        res = await self.session.execute(stmt)
        return list(res.scalars().all())

    async def get_active_recurring_schedules(self) -> list[TaskRecurringSchedule]:
        stmt = (
            select(TaskRecurringSchedule)
            .where(
                TaskRecurringSchedule.deleted_at.is_(None),
                TaskRecurringSchedule.status == "ACTIVE",
            )
            .options(
                selectinload(TaskRecurringSchedule.assignee),
                selectinload(TaskRecurringSchedule.manager),
                selectinload(TaskRecurringSchedule.creator),
            )
        )
        res = await self.session.execute(stmt)
        return list(res.scalars().all())

    async def get_recurring_task_instance(
        self, schedule_id: uuid.UUID, period: str
    ) -> Task | None:
        stmt = (
            select(Task)
            .where(
                Task.recurring_schedule_id == schedule_id,
                Task.recurrence_period == period,
                Task.deleted_at.is_(None),
            )
        )
        res = await self.session.execute(stmt)
        return res.scalar_one_or_none()

    async def list_recurring_instances(
        self,
        schedule_id: uuid.UUID | None = None,
        history_only: bool = False,
        limit: int = 100,
        *,
        scoped_user_id: uuid.UUID | None = None,
        scoped_department_user_ids: set[uuid.UUID] | None = None,
    ) -> list[Task]:
        stmt = (
            select(Task)
            .where(
                Task.recurring_schedule_id.is_not(None),
                Task.deleted_at.is_(None),
            )
            .options(
                selectinload(Task.recurring_schedule),
                selectinload(Task.assignees).selectinload(TaskAssignee.user),
                selectinload(Task.approver),
                selectinload(Task.creator),
                selectinload(Task.escalations),
            )
            .order_by(Task.due_date.desc(), Task.created_at.desc())
            .limit(limit)
        )
        if scoped_department_user_ids is not None:
            allowed_uids = set(scoped_department_user_ids)
            if scoped_user_id is not None:
                allowed_uids.add(scoped_user_id)
            if not allowed_uids:
                return []
            stmt = stmt.where(
                or_(
                    Task.created_by.in_(allowed_uids),
                    Task.approver_id.in_(allowed_uids),
                    Task.id.in_(
                        select(TaskAssignee.task_id).where(TaskAssignee.user_id.in_(allowed_uids))
                    ),
                )
            )
        elif scoped_user_id is not None:
            stmt = stmt.where(
                or_(
                    Task.created_by == scoped_user_id,
                    Task.approver_id == scoped_user_id,
                    Task.id.in_(
                        select(TaskAssignee.task_id).where(TaskAssignee.user_id == scoped_user_id)
                    ),
                )
            )
        if schedule_id:
            stmt = stmt.where(Task.recurring_schedule_id == schedule_id)
        if history_only:
            stmt = stmt.where(Task.status == TaskStatus.DONE)
        else:
            stmt = stmt.where(Task.status != TaskStatus.DONE)

        res = await self.session.execute(stmt)
        return list(res.scalars().all())

