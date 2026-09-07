"""
Task Module ORM Models.

Standalone task management and workforce collaboration:
    - tasks
    - task_assignees
    - task_subtasks
    - task_comments
    - task_escalations
"""

from __future__ import annotations

import uuid
from datetime import date, datetime
from enum import Enum
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Integer, JSON, String, Text, UniqueConstraint, inspect
from sqlalchemy import Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.base import GUID, Base, SoftDeleteMixin, TimestampMixin, UUIDPrimaryKeyMixin, VersionMixin

if TYPE_CHECKING:
    from app.users.models import User


class TaskPriority(str, Enum):
    """Priority level for a task."""

    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"
    CRITICAL = "CRITICAL"


class TaskStatus(str, Enum):
    """Lifecycle progress state of a task."""

    TODO = "TODO"
    IN_PROGRESS = "IN_PROGRESS"
    REVIEW = "REVIEW"
    ON_HOLD = "ON_HOLD"
    PENDING_APPROVAL = "PENDING_APPROVAL"
    DONE = "DONE"


class IssueType(str, Enum):
    """Jira-inspired issue types for a task."""

    TASK = "TASK"
    BUG = "BUG"
    IMPROVEMENT = "IMPROVEMENT"
    STORY = "STORY"
    EPIC = "EPIC"
    APPROVAL = "APPROVAL"


class ApprovalStatus(str, Enum):
    """Approval status for a task."""

    NONE = "NONE"
    PENDING = "PENDING"
    PENDING_APPROVAL = "PENDING_APPROVAL"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"
    NOT_REQUIRED = "NOT_REQUIRED"


class DependencyType(str, Enum):
    """Task dependency relationship types."""

    BLOCKS = "BLOCKS"
    BLOCKED_BY = "BLOCKED_BY"
    RELATES_TO = "RELATES_TO"


class SprintStatus(str, Enum):
    """Lifecycle status of a sprint."""

    PLANNED = "PLANNED"
    ACTIVE = "ACTIVE"
    COMPLETED = "COMPLETED"
    FUTURE = "FUTURE"


class TaskAssignmentRole(str, Enum):
    """Role of an assignee on a task."""

    OWNER = "OWNER"
    ASSIGNEE = "ASSIGNEE"
    WATCHER = "WATCHER"
    PRIMARY = "PRIMARY"
    COLLABORATOR = "COLLABORATOR"
    REVIEWER = "REVIEWER"


class Task(Base, UUIDPrimaryKeyMixin, TimestampMixin, VersionMixin, SoftDeleteMixin):
    """Main Task entity."""

    __tablename__ = "tasks"

    title: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    priority: Mapped[TaskPriority] = mapped_column(
        SAEnum(TaskPriority, name="task_priority", native_enum=False, length=20),
        default=TaskPriority.MEDIUM,
        nullable=False,
        index=True,
    )
    status: Mapped[TaskStatus] = mapped_column(
        SAEnum(TaskStatus, name="task_status", native_enum=False, length=20),
        default=TaskStatus.TODO,
        nullable=False,
        index=True,
    )

    start_date: Mapped[date | None] = mapped_column(Date, nullable=True, index=True)
    due_date: Mapped[date | None] = mapped_column(Date, nullable=True, index=True)
    hold_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    hold_until: Mapped[date | None] = mapped_column(Date, nullable=True, index=True)

    issue_type: Mapped[str] = mapped_column(String(20), default="TASK", nullable=False, index=True)
    parent_task_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("tasks.id", ondelete="SET NULL"), nullable=True, index=True
    )
    sprint_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("task_sprints.id", ondelete="SET NULL"), nullable=True, index=True
    )
    approval_status: Mapped[str] = mapped_column(String(20), default="NONE", nullable=False, index=True)
    approver_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    approval_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    created_by: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    deleted_by: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    creator: Mapped["User | None"] = relationship("User", foreign_keys=[created_by], lazy="selectin")
    parent_task: Mapped["Task | None"] = relationship("Task", remote_side="Task.id", foreign_keys=[parent_task_id], back_populates="child_tasks", lazy="selectin")
    child_tasks: Mapped[list["Task"]] = relationship("Task", foreign_keys=[parent_task_id], back_populates="parent_task", lazy="selectin", overlaps="parent_task")
    sprint: Mapped["TaskSprint | None"] = relationship("TaskSprint", foreign_keys=[sprint_id], back_populates="tasks", lazy="selectin")
    approver: Mapped["User | None"] = relationship("User", foreign_keys=[approver_id], lazy="selectin")

    assignees: Mapped[list["TaskAssignee"]] = relationship(
        "TaskAssignee",
        back_populates="task",
        cascade="all, delete-orphan",
        lazy="selectin",
    )
    subtasks: Mapped[list["TaskSubtask"]] = relationship(
        "TaskSubtask",
        back_populates="task",
        cascade="all, delete-orphan",
        order_by="TaskSubtask.order_index",
        lazy="selectin",
    )
    comments: Mapped[list["TaskComment"]] = relationship(
        "TaskComment",
        back_populates="task",
        cascade="all, delete-orphan",
        order_by="TaskComment.created_at",
        lazy="selectin",
    )
    escalations: Mapped[list["TaskEscalation"]] = relationship(
        "TaskEscalation",
        back_populates="task",
        cascade="all, delete-orphan",
        order_by="TaskEscalation.created_at",
        lazy="selectin",
    )
    attachments: Mapped[list["TaskAttachment"]] = relationship(
        "TaskAttachment",
        back_populates="task",
        cascade="all, delete-orphan",
        order_by="TaskAttachment.created_at",
        lazy="selectin",
    )
    voice_notes: Mapped[list["TaskVoiceNote"]] = relationship(
        "TaskVoiceNote",
        back_populates="task",
        cascade="all, delete-orphan",
        order_by="TaskVoiceNote.created_at",
        lazy="selectin",
    )
    task_label_links: Mapped[list["TaskLabelLink"]] = relationship(
        "TaskLabelLink",
        back_populates="task",
        cascade="all, delete-orphan",
        lazy="selectin",
    )
    labels: Mapped[list["TaskLabel"]] = relationship(
        "TaskLabel",
        secondary="task_label_links",
        lazy="selectin",
        viewonly=True,
    )
    dependencies: Mapped[list["TaskDependency"]] = relationship(
        "TaskDependency",
        foreign_keys="TaskDependency.task_id",
        back_populates="task",
        cascade="all, delete-orphan",
        lazy="selectin",
    )
    dependent_on: Mapped[list["TaskDependency"]] = relationship(
        "TaskDependency",
        foreign_keys="TaskDependency.depends_on_task_id",
        back_populates="depends_on_task",
        cascade="all, delete-orphan",
        lazy="selectin",
    )
    reactions: Mapped[list["TaskReaction"]] = relationship(
        "TaskReaction",
        foreign_keys="TaskReaction.task_id",
        back_populates="task",
        cascade="all, delete-orphan",
        lazy="selectin",
    )
    mentions: Mapped[list["TaskMention"]] = relationship(
        "TaskMention",
        foreign_keys="TaskMention.task_id",
        back_populates="task",
        cascade="all, delete-orphan",
        lazy="selectin",
    )

    @property
    def parent_task_title(self) -> str | None:
        state = inspect(self, raiseerr=False)
        if state and "parent_task" in state.dict:
            parent = state.dict.get("parent_task")
            return parent.title if parent else None
        return None

    @property
    def sprint_name(self) -> str | None:
        state = inspect(self, raiseerr=False)
        if state and "sprint" in state.dict:
            sprint_obj = state.dict.get("sprint")
            return sprint_obj.name if sprint_obj else None
        return None

    @property
    def progress_percent(self) -> int:
        state = inspect(self, raiseerr=False)
        children = state.dict.get("child_tasks") if state else None
        if children:
            total = len(children)
            completed = sum(
                1
                for c in children
                if getattr(c, "status", None) == "DONE"
                or getattr(getattr(c, "status", None), "value", None) == "DONE"
            )
            return int((completed / total) * 100) if total > 0 else 0

        subtasks = state.dict.get("subtasks") if state else None
        if subtasks:
            total = len(subtasks)
            completed = sum(
                1
                for s in subtasks
                if getattr(s, "completed", False) or getattr(s, "status", None) == "DONE"
            )
            return int((completed / total) * 100) if total > 0 else 0

        curr_status = getattr(self.status, "value", self.status)
        return 100 if curr_status == "DONE" else 0

    def __repr__(self) -> str:
        return f"<Task id={self.id} title={self.title!r} status={self.status.value}>"


class TaskAssignee(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """Many-to-many link between Task and assigned User."""

    __tablename__ = "task_assignees"
    __table_args__ = (UniqueConstraint("task_id", "user_id", name="uq_task_assignee"),)

    task_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    assignment_role: Mapped[str] = mapped_column(String(50), default="ASSIGNEE", nullable=False)

    task: Mapped[Task] = relationship("Task", back_populates="assignees")
    user: Mapped["User"] = relationship("User", foreign_keys=[user_id], lazy="selectin")

    def __repr__(self) -> str:
        return f"<TaskAssignee task_id={self.task_id} user_id={self.user_id} role={self.assignment_role}>"


class TaskSubtask(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """Subtasks belonging to a Task."""

    __tablename__ = "task_subtasks"

    task_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False, index=True
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    priority: Mapped[str] = mapped_column(String(20), default="MEDIUM", nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="TODO", nullable=False)
    start_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    due_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    completed: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, index=True)
    assignee_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    order_index: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    task: Mapped[Task] = relationship("Task", back_populates="subtasks")
    assignee: Mapped["User | None"] = relationship("User", foreign_keys=[assignee_id], lazy="selectin")
    assignees: Mapped[list["TaskSubtaskAssignee"]] = relationship(
        "TaskSubtaskAssignee",
        back_populates="subtask",
        cascade="all, delete-orphan",
        lazy="selectin",
    )
    comments: Mapped[list["TaskSubtaskComment"]] = relationship(
        "TaskSubtaskComment",
        back_populates="subtask",
        cascade="all, delete-orphan",
        order_by="TaskSubtaskComment.created_at",
        lazy="selectin",
    )
    attachments: Mapped[list["TaskSubtaskAttachment"]] = relationship(
        "TaskSubtaskAttachment",
        back_populates="subtask",
        cascade="all, delete-orphan",
        order_by="TaskSubtaskAttachment.created_at",
        lazy="selectin",
    )

    def __repr__(self) -> str:
        return f"<TaskSubtask id={self.id} task_id={self.task_id} completed={self.completed}>"


class TaskSubtaskAssignee(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """Users assigned to a specific mini-task subtask."""

    __tablename__ = "task_subtask_assignees"
    __table_args__ = (UniqueConstraint("subtask_id", "user_id", name="uq_subtask_assignee"),)

    subtask_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("task_subtasks.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )

    subtask: Mapped[TaskSubtask] = relationship("TaskSubtask", back_populates="assignees")
    user: Mapped["User"] = relationship("User", foreign_keys=[user_id], lazy="selectin")

    def __repr__(self) -> str:
        return f"<TaskSubtaskAssignee subtask_id={self.subtask_id} user_id={self.user_id}>"


class TaskComment(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """Comments on a Task."""

    __tablename__ = "task_comments"

    task_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    message: Mapped[str] = mapped_column(Text, nullable=False)
    audio_url: Mapped[str | None] = mapped_column(String(500), nullable=True)

    task: Mapped[Task] = relationship("Task", back_populates="comments")
    user: Mapped["User"] = relationship("User", foreign_keys=[user_id], lazy="selectin")
    attachments: Mapped[list["TaskCommentAttachment"]] = relationship(
        "TaskCommentAttachment",
        back_populates="comment",
        cascade="all, delete-orphan",
        order_by="TaskCommentAttachment.created_at",
        lazy="selectin",
    )
    reactions: Mapped[list["TaskReaction"]] = relationship(
        "TaskReaction",
        foreign_keys="TaskReaction.comment_id",
        back_populates="comment",
        cascade="all, delete-orphan",
        lazy="selectin",
    )

    def __repr__(self) -> str:
        return f"<TaskComment id={self.id} task_id={self.task_id} user_id={self.user_id}>"


class TaskEscalation(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """Recorded manual escalations for a Task."""

    __tablename__ = "task_escalations"

    task_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False, index=True
    )
    from_user: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    to_user: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    escalation_type: Mapped[str] = mapped_column(String(50), default="ORGANIZATION_USER", nullable=False)
    due_date: Mapped[date | None] = mapped_column(Date, nullable=True)

    task: Mapped[Task] = relationship("Task", back_populates="escalations")
    from_user_rel: Mapped["User"] = relationship("User", foreign_keys=[from_user], lazy="selectin")
    to_user_rel: Mapped["User"] = relationship("User", foreign_keys=[to_user], lazy="selectin")
    comments: Mapped[list["TaskEscalationComment"]] = relationship(
        "TaskEscalationComment",
        back_populates="escalation",
        cascade="all, delete-orphan",
        order_by="TaskEscalationComment.created_at",
        lazy="selectin",
    )

    def __repr__(self) -> str:
        return f"<TaskEscalation id={self.id} task_id={self.task_id} from={self.from_user} to={self.to_user}>"


class TaskAttachment(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """File attachments uploaded to a Task."""

    __tablename__ = "task_attachments"

    task_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False, index=True
    )
    uploaded_by: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    file_name: Mapped[str] = mapped_column(String(255), nullable=False)
    file_url: Mapped[str] = mapped_column(String(500), nullable=False)
    file_type: Mapped[str] = mapped_column(String(100), nullable=False)
    file_size: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    task: Mapped[Task] = relationship("Task", back_populates="attachments")
    uploader: Mapped["User | None"] = relationship("User", foreign_keys=[uploaded_by], lazy="selectin")

    def __repr__(self) -> str:
        return f"<TaskAttachment id={self.id} name={self.file_name!r}>"


class TaskCommentAttachment(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """File attachments on a specific comment."""

    __tablename__ = "task_comment_attachments"

    comment_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("task_comments.id", ondelete="CASCADE"), nullable=False, index=True
    )
    file_name: Mapped[str] = mapped_column(String(255), nullable=False)
    file_url: Mapped[str] = mapped_column(String(500), nullable=False)
    file_type: Mapped[str] = mapped_column(String(100), nullable=False)
    file_size: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    comment: Mapped[TaskComment] = relationship("TaskComment", back_populates="attachments")

    def __repr__(self) -> str:
        return f"<TaskCommentAttachment id={self.id} name={self.file_name!r}>"


class TaskVoiceNote(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """Voice recordings attached to a Task."""

    __tablename__ = "task_voice_notes"

    task_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False, index=True
    )
    subtask_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("task_subtasks.id", ondelete="CASCADE"), nullable=True, index=True
    )
    comment_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("task_comments.id", ondelete="CASCADE"), nullable=True, index=True
    )
    uploaded_by: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    file_name: Mapped[str] = mapped_column(String(255), nullable=False)
    audio_url: Mapped[str] = mapped_column(String(500), nullable=False)
    duration_seconds: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    task: Mapped[Task] = relationship("Task", back_populates="voice_notes")
    uploader: Mapped["User | None"] = relationship("User", foreign_keys=[uploaded_by], lazy="selectin")

    def __repr__(self) -> str:
        return f"<TaskVoiceNote id={self.id} duration={self.duration_seconds}s>"


class TaskSubtaskComment(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """Collaborative comments on an individual subtask."""

    __tablename__ = "task_subtask_comments"

    subtask_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("task_subtasks.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    message: Mapped[str] = mapped_column(Text, nullable=False)
    audio_url: Mapped[str | None] = mapped_column(String(500), nullable=True)

    subtask: Mapped[TaskSubtask] = relationship("TaskSubtask", back_populates="comments")
    user: Mapped["User"] = relationship("User", foreign_keys=[user_id], lazy="selectin")

    def __repr__(self) -> str:
        return f"<TaskSubtaskComment id={self.id} subtask_id={self.subtask_id}>"


class TaskSubtaskAttachment(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """File attachments attached to a subtask."""

    __tablename__ = "task_subtask_attachments"

    subtask_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("task_subtasks.id", ondelete="CASCADE"), nullable=False, index=True
    )
    uploaded_by: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    file_name: Mapped[str] = mapped_column(String(255), nullable=False)
    file_url: Mapped[str] = mapped_column(String(500), nullable=False)
    file_type: Mapped[str] = mapped_column(String(100), nullable=False)
    file_size: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    subtask: Mapped[TaskSubtask] = relationship("TaskSubtask", back_populates="attachments")
    uploader: Mapped["User | None"] = relationship("User", foreign_keys=[uploaded_by], lazy="selectin")

    def __repr__(self) -> str:
        return f"<TaskSubtaskAttachment id={self.id} name={self.file_name!r}>"


class TaskEscalationComment(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """Discussion comments on an individual escalation record."""

    __tablename__ = "task_escalation_comments"

    escalation_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("task_escalations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    message: Mapped[str] = mapped_column(Text, nullable=False)
    audio_url: Mapped[str | None] = mapped_column(String(500), nullable=True)

    escalation: Mapped[TaskEscalation] = relationship("TaskEscalation", back_populates="comments")
    user: Mapped["User"] = relationship("User", foreign_keys=[user_id], lazy="selectin")

    def __repr__(self) -> str:
        return f"<TaskEscalationComment id={self.id} escalation_id={self.escalation_id}>"


class TaskSprint(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """Sprints and execution cycles for Tasks."""

    __tablename__ = "task_sprints"

    name: Mapped[str] = mapped_column(String(100), nullable=False)
    goal: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="PLANNED", nullable=False, index=True)
    start_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    end_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    creator: Mapped["User | None"] = relationship("User", foreign_keys=[created_by], lazy="selectin")
    tasks: Mapped[list[Task]] = relationship("Task", back_populates="sprint")

    def __repr__(self) -> str:
        return f"<TaskSprint id={self.id} name={self.name!r} status={self.status}>"


class TaskLabel(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """Reusable categorized colored tags for tasks."""

    __tablename__ = "task_labels"

    name: Mapped[str] = mapped_column(String(100), nullable=False, unique=True, index=True)
    color: Mapped[str] = mapped_column(String(20), default="#3b82f6", nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    creator: Mapped["User | None"] = relationship("User", foreign_keys=[created_by], lazy="selectin")
    links: Mapped[list["TaskLabelLink"]] = relationship("TaskLabelLink", back_populates="label", cascade="all, delete-orphan")

    def __repr__(self) -> str:
        return f"<TaskLabel id={self.id} name={self.name!r} color={self.color}>"


class TaskLabelLink(Base, UUIDPrimaryKeyMixin):
    """Association between a Task and a TaskLabel."""

    __tablename__ = "task_label_links"
    __table_args__ = (UniqueConstraint("task_id", "label_id", name="uq_task_label_link"),)

    task_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False, index=True
    )
    label_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("task_labels.id", ondelete="CASCADE"), nullable=False, index=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)

    task: Mapped[Task] = relationship("Task", back_populates="task_label_links")
    label: Mapped[TaskLabel] = relationship("TaskLabel", back_populates="links", lazy="selectin")

    def __repr__(self) -> str:
        return f"<TaskLabelLink task_id={self.task_id} label_id={self.label_id}>"


class TaskTemplate(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """Reusable task boilerplate templates."""

    __tablename__ = "task_templates"

    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    issue_type: Mapped[str] = mapped_column(String(20), default="TASK", nullable=False)
    priority: Mapped[str] = mapped_column(String(20), default="MEDIUM", nullable=False)
    default_subtasks: Mapped[list | None] = mapped_column(JSON, default=list, nullable=True)
    default_labels: Mapped[list | None] = mapped_column(JSON, default=list, nullable=True)
    default_watcher_ids: Mapped[list | None] = mapped_column(JSON, default=list, nullable=True)
    is_shared: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    creator: Mapped["User | None"] = relationship("User", foreign_keys=[created_by], lazy="selectin")

    @property
    def category(self) -> str | None:
        return self.issue_type

    @category.setter
    def category(self, val: str | None) -> None:
        if val:
            self.issue_type = val

    @property
    def template_data(self) -> dict:
        return {
            "issue_type": self.issue_type,
            "default_priority": self.priority,
            "subtask_templates": self.default_subtasks or [],
            "default_labels": self.default_labels or [],
            "default_watcher_ids": self.default_watcher_ids or [],
        }

    @template_data.setter
    def template_data(self, data: dict) -> None:
        if isinstance(data, dict):
            if "issue_type" in data:
                self.issue_type = data["issue_type"]
            if "default_priority" in data or "priority" in data:
                self.priority = data.get("default_priority") or data.get("priority")
            if "subtask_templates" in data or "default_subtasks" in data:
                self.default_subtasks = data.get("subtask_templates") or data.get("default_subtasks")
            if "default_labels" in data:
                self.default_labels = data["default_labels"]
            if "default_watcher_ids" in data:
                self.default_watcher_ids = data["default_watcher_ids"]
            if "is_shared" in data:
                self.is_shared = data["is_shared"]

    def __repr__(self) -> str:
        return f"<TaskTemplate id={self.id} name={self.name!r}>"


class TaskDependency(Base, UUIDPrimaryKeyMixin):
    """Inter-task dependency relationship (Blocks, Blocked By, Relates To)."""

    __tablename__ = "task_dependencies"
    __table_args__ = (UniqueConstraint("task_id", "depends_on_task_id", "relationship_type", name="uq_task_dependency"),)

    task_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False, index=True
    )
    depends_on_task_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False, index=True
    )
    relationship_type: Mapped[str] = mapped_column(String(20), default="BLOCKS", nullable=False)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)

    task: Mapped[Task] = relationship("Task", foreign_keys=[task_id], back_populates="dependencies")
    depends_on_task: Mapped[Task] = relationship("Task", foreign_keys=[depends_on_task_id], back_populates="dependent_on", lazy="selectin")
    creator: Mapped["User | None"] = relationship("User", foreign_keys=[created_by], lazy="selectin")

    @property
    def dependency_type(self) -> str:
        return self.relationship_type

    @dependency_type.setter
    def dependency_type(self, val: str) -> None:
        self.relationship_type = val

    @property
    def depends_on_task_title(self) -> str | None:
        return self.depends_on_task.title if self.depends_on_task else None

    @property
    def depends_on_task_status(self) -> str | None:
        if not self.depends_on_task:
            return None
        st = self.depends_on_task.status
        return getattr(st, "value", str(st))

    def __repr__(self) -> str:
        return f"<TaskDependency task_id={self.task_id} relates={self.relationship_type} to={self.depends_on_task_id}>"


class TaskSavedFilter(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """User-customized search filter presets."""

    __tablename__ = "task_saved_filters"

    user_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    filter_criteria: Mapped[dict] = mapped_column(JSON, nullable=False)
    is_default: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    user: Mapped["User"] = relationship("User", foreign_keys=[user_id], lazy="selectin")

    @property
    def filter_config(self) -> dict:
        return self.filter_criteria

    @filter_config.setter
    def filter_config(self, val: dict) -> None:
        self.filter_criteria = val or {}

    def __repr__(self) -> str:
        return f"<TaskSavedFilter id={self.id} user_id={self.user_id} name={self.name!r}>"


class TaskReaction(Base, UUIDPrimaryKeyMixin):
    """Emoji reactions on tasks or comments."""

    __tablename__ = "task_reactions"

    task_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("tasks.id", ondelete="CASCADE"), nullable=True, index=True
    )
    comment_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("task_comments.id", ondelete="CASCADE"), nullable=True, index=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    emoji: Mapped[str] = mapped_column(String(10), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)

    task: Mapped[Task | None] = relationship("Task", foreign_keys=[task_id], back_populates="reactions")
    comment: Mapped[TaskComment | None] = relationship("TaskComment", foreign_keys=[comment_id], back_populates="reactions")
    user: Mapped["User"] = relationship("User", foreign_keys=[user_id], lazy="selectin")

    def __repr__(self) -> str:
        return f"<TaskReaction user_id={self.user_id} emoji={self.emoji}>"


class TaskMention(Base, UUIDPrimaryKeyMixin):
    """User mention tracking in task and comment discussions."""

    __tablename__ = "task_mentions"

    task_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False, index=True
    )
    comment_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("task_comments.id", ondelete="CASCADE"), nullable=True
    )
    mentioned_user_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    mentioned_by: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    context_type: Mapped[str] = mapped_column(String(30), default="TASK_COMMENT", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)

    task: Mapped[Task] = relationship("Task", foreign_keys=[task_id], back_populates="mentions")
    comment: Mapped[TaskComment | None] = relationship("TaskComment", foreign_keys=[comment_id])
    mentioned_user: Mapped["User"] = relationship("User", foreign_keys=[mentioned_user_id], lazy="selectin")
    author: Mapped["User"] = relationship("User", foreign_keys=[mentioned_by], lazy="selectin")

    def __repr__(self) -> str:
        return f"<TaskMention task_id={self.task_id} mentioned={self.mentioned_user_id}>"

