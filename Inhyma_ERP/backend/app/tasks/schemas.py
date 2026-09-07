"""
Task Module Pydantic Schemas.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.tasks.models import (
    ApprovalStatus,
    DependencyType,
    IssueType,
    SprintStatus,
    TaskAssignmentRole,
    TaskPriority,
    TaskStatus,
)


# --- User Snapshot in Schemas ---
class UserMiniRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    full_name: str | None = None
    username: str | None = None
    email: str | None = None
    profile_picture_url: str | None = None


# --- Assignees ---
class TaskAssigneeCreate(BaseModel):
    user_id: uuid.UUID
    assignment_role: TaskAssignmentRole = TaskAssignmentRole.ASSIGNEE


class TaskAssigneeRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    task_id: uuid.UUID
    user_id: uuid.UUID
    assignment_role: str
    created_at: datetime
    user: UserMiniRead | None = None


# --- Subtasks ---
class TaskSubtaskAssigneeRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    subtask_id: uuid.UUID
    user_id: uuid.UUID
    created_at: datetime
    user: UserMiniRead | None = None


class TaskSubtaskCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=255)
    description: str | None = None
    priority: TaskPriority = TaskPriority.MEDIUM
    status: TaskStatus = TaskStatus.TODO
    start_date: date | None = None
    due_date: date | None = None
    assignee_id: uuid.UUID | None = None
    assignee_ids: list[uuid.UUID] = []
    order_index: int = 0


class TaskSubtaskUpdate(BaseModel):
    title: str | None = Field(None, min_length=1, max_length=255)
    description: str | None = None
    priority: TaskPriority | None = None
    status: TaskStatus | None = None
    start_date: date | None = None
    due_date: date | None = None
    completed: bool | None = None
    assignee_id: uuid.UUID | None = None
    assignee_ids: list[uuid.UUID] | None = None
    order_index: int | None = None


class TaskSubtaskRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    task_id: uuid.UUID
    title: str
    description: str | None = None
    priority: str = "MEDIUM"
    status: str = "TODO"
    start_date: date | None = None
    due_date: date | None = None
    completed: bool
    assignee_id: uuid.UUID | None = None
    order_index: int
    created_at: datetime
    updated_at: datetime
    assignee: UserMiniRead | None = None
    assignees: list[TaskSubtaskAssigneeRead] = []


# --- Comments ---
class TaskCommentAttachmentCreateInput(BaseModel):
    file_name: str
    file_url: str
    file_type: str = "application/octet-stream"
    file_size: int = 0


class TaskCommentAttachmentRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    comment_id: uuid.UUID
    file_name: str
    file_url: str
    file_type: str
    file_size: int = 0
    created_at: datetime


class TaskCommentCreate(BaseModel):
    message: str = Field(..., min_length=1)
    audio_url: str | None = None
    attachments: list[TaskCommentAttachmentCreateInput] = []


class TaskCommentRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    task_id: uuid.UUID
    user_id: uuid.UUID
    message: str
    audio_url: str | None = None
    created_at: datetime
    user: UserMiniRead | None = None
    attachments: list[TaskCommentAttachmentRead] = []
    reactions: list[TaskReactionSummary] = []
    mentions: list[TaskMentionRead] = []


# --- Attachments & Voice Notes ---
class TaskAttachmentCreateInput(BaseModel):
    file_name: str
    file_url: str
    file_type: str = "application/octet-stream"
    file_size: int = 0


class TaskAttachmentRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    task_id: uuid.UUID
    uploaded_by: uuid.UUID | None = None
    file_name: str
    file_url: str
    file_type: str
    file_size: int = 0
    created_at: datetime
    uploader: UserMiniRead | None = None


class TaskVoiceNoteCreateInput(BaseModel):
    file_name: str = "Voice Note"
    audio_url: str
    duration_seconds: int = 0


class TaskVoiceNoteRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    task_id: uuid.UUID
    subtask_id: uuid.UUID | None = None
    comment_id: uuid.UUID | None = None
    uploaded_by: uuid.UUID | None = None
    file_name: str
    audio_url: str
    duration_seconds: int = 0
    created_at: datetime
    uploader: UserMiniRead | None = None


# --- Subtask Collaboration ---
class TaskSubtaskCommentCreate(BaseModel):
    message: str = Field(..., min_length=1)
    audio_url: str | None = None


class TaskSubtaskCommentRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    subtask_id: uuid.UUID
    user_id: uuid.UUID
    message: str
    audio_url: str | None = None
    created_at: datetime
    user: UserMiniRead | None = None


class TaskSubtaskAttachmentRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    subtask_id: uuid.UUID
    uploaded_by: uuid.UUID | None = None
    file_name: str
    file_url: str
    file_type: str
    file_size: int = 0
    created_at: datetime
    uploader: UserMiniRead | None = None


# --- Escalation Discussion ---
class TaskEscalationCommentCreate(BaseModel):
    message: str = Field(..., min_length=1)
    audio_url: str | None = None


class TaskEscalationCommentRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    escalation_id: uuid.UUID
    user_id: uuid.UUID
    message: str
    audio_url: str | None = None
    created_at: datetime
    user: UserMiniRead | None = None


# --- Escalations ---
class TaskEscalateRequest(BaseModel):
    to_user: uuid.UUID
    reason: str = Field(..., min_length=1)
    escalation_type: str = "ORGANIZATION_USER"
    due_date: date | None = None


class TaskEscalationRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    task_id: uuid.UUID
    from_user: uuid.UUID
    to_user: uuid.UUID
    reason: str
    escalation_type: str = "ORGANIZATION_USER"
    due_date: date | None = None
    created_at: datetime
    from_user_rel: UserMiniRead | None = None
    to_user_rel: UserMiniRead | None = None
    comments: list[TaskEscalationCommentRead] = []


class TaskEscalateCandidate(BaseModel):
    user_id: uuid.UUID
    name: str
    email: str | None = None
    category: str  # "REPORTING_MANAGER", "DEPARTMENT_MANAGER", "ORGANIZATION_USER"
    detail: str | None = None


class TaskEscalateOptionsResponse(BaseModel):
    reporting_managers: list[TaskEscalateCandidate] = []
    department_managers: list[TaskEscalateCandidate] = []
    organization_users: list[TaskEscalateCandidate] = []


class TaskInitialEscalationInput(BaseModel):
    escalation_type: str = "ORGANIZATION_USER"
    escalated_to_id: uuid.UUID
    reason: str = Field(..., min_length=1)
    due_date: date | None = None


# --- Labels ---
class TaskLabelCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    color: str = "#6366f1"
    description: str | None = None


class TaskLabelRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    color: str = "#6366f1"
    description: str | None = None
    created_at: datetime


class TaskLabelLinkCreate(BaseModel):
    label_id: uuid.UUID | None = None
    name: str | None = None
    color: str | None = None


# --- Sprints ---
class TaskSprintCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=150)
    goal: str | None = None
    start_date: date | None = None
    end_date: date | None = None
    status: SprintStatus = SprintStatus.FUTURE


class TaskSprintUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=150)
    goal: str | None = None
    start_date: date | None = None
    end_date: date | None = None
    status: SprintStatus | None = None


class TaskSprintRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    goal: str | None = None
    start_date: date | None = None
    end_date: date | None = None
    status: SprintStatus
    created_by: uuid.UUID | None = None
    created_at: datetime
    updated_at: datetime
    task_count: int = 0
    completed_task_count: int = 0


# --- Templates ---
class TaskTemplateCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=150)
    description: str | None = None
    category: str | None = None
    template_data: dict[str, Any]


class TaskTemplateUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=150)
    description: str | None = None
    category: str | None = None
    template_data: dict[str, Any] | None = None


class TaskTemplateRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    description: str | None = None
    category: str | None = None
    template_data: dict[str, Any]
    created_by: uuid.UUID | None = None
    created_at: datetime
    updated_at: datetime


# --- Dependencies ---
class TaskDependencyCreate(BaseModel):
    depends_on_task_id: uuid.UUID
    dependency_type: DependencyType = DependencyType.BLOCKS


class TaskDependencyRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    task_id: uuid.UUID
    depends_on_task_id: uuid.UUID
    dependency_type: DependencyType
    created_at: datetime
    depends_on_task_title: str | None = None
    depends_on_task_status: str | None = None


# --- Reactions & Mentions ---
class TaskReactionToggle(BaseModel):
    emoji: str = Field(..., min_length=1, max_length=16)


class TaskReactionRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    task_id: uuid.UUID | None = None
    comment_id: uuid.UUID | None = None
    user_id: uuid.UUID
    emoji: str
    created_at: datetime
    user: UserMiniRead | None = None


class TaskReactionSummary(BaseModel):
    emoji: str
    count: int = 0
    user_ids: list[uuid.UUID] = []
    has_reacted: bool = False


class TaskMentionRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    task_id: uuid.UUID
    comment_id: uuid.UUID | None = None
    mentioned_user_id: uuid.UUID
    created_at: datetime
    user: UserMiniRead | None = None


# --- Saved Filters ---
class TaskSavedFilterCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    filter_config: dict[str, Any] = {}
    is_default: bool = False


class TaskSavedFilterUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=100)
    filter_config: dict[str, Any] | None = None
    is_default: bool | None = None


class TaskSavedFilterRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    user_id: uuid.UUID
    name: str
    filter_config: dict[str, Any]
    is_default: bool
    created_at: datetime
    updated_at: datetime


# --- Bulk Operations ---
class TaskBulkActionRequest(BaseModel):
    task_ids: list[uuid.UUID]
    action: str  # ASSIGN, STATUS, PRIORITY, ADD_LABEL, REMOVE_LABEL, DELETE, ADD_WATCHER, SET_SPRINT
    value: Any = None


class TaskBulkActionResponse(BaseModel):
    success_count: int
    failed_ids: list[uuid.UUID] = []
    message: str


# --- Approvals & Duplicate ---
class TaskSubmitApprovalRequest(BaseModel):
    approver_id: uuid.UUID
    notes: str | None = None


class TaskApprovalActionRequest(BaseModel):
    approved: bool
    notes: str | None = None


class TaskDuplicateRequest(BaseModel):
    include_subtasks: bool = True
    include_labels: bool = True
    include_watchers: bool = True
    include_attachments: bool = False
    new_title: str | None = None


# --- Workload & Capacity ---
class UserWorkloadSummary(BaseModel):
    user_id: uuid.UUID
    user_name: str
    user_email: str | None = None
    department_name: str | None = None
    open_tasks_count: int = 0
    in_progress_tasks_count: int = 0
    overdue_tasks_count: int = 0
    completed_tasks_count: int = 0
    high_priority_count: int = 0


class WorkloadDashboardResponse(BaseModel):
    users: list[UserWorkloadSummary] = []
    total_tasks: int = 0


class CapacityDayAllocation(BaseModel):
    date: date
    task_ids: list[uuid.UUID] = []
    task_count: int = 0


class UserCapacitySummary(BaseModel):
    user_id: uuid.UUID
    user_name: str
    allocations: list[CapacityDayAllocation] = []


class CapacityViewResponse(BaseModel):
    users: list[UserCapacitySummary] = []
    start_date: date
    end_date: date


# --- Task Main Schemas ---
class TaskCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=255)
    description: str | None = None
    priority: TaskPriority = TaskPriority.MEDIUM
    status: TaskStatus = TaskStatus.TODO
    issue_type: IssueType = IssueType.TASK
    parent_task_id: uuid.UUID | None = None
    sprint_id: uuid.UUID | None = None
    start_date: date | None = None
    due_date: date | None = None
    assignee_ids: list[uuid.UUID] = []
    watcher_ids: list[uuid.UUID] = []
    label_ids: list[uuid.UUID] = []
    labels: list[str] = []
    approver_id: uuid.UUID | None = None
    subtasks: list[TaskSubtaskCreate | str] = []
    initial_escalation: TaskInitialEscalationInput | None = None
    attachments: list[TaskAttachmentCreateInput] = []
    voice_notes: list[TaskVoiceNoteCreateInput] = []

    @model_validator(mode="after")
    def validate_dates(self) -> TaskCreate:
        if self.start_date and self.due_date and self.due_date < self.start_date:
            raise ValueError("Due date cannot be earlier than start date.")
        return self


class TaskUpdate(BaseModel):
    title: str | None = Field(None, min_length=1, max_length=255)
    description: str | None = None
    priority: TaskPriority | None = None
    status: TaskStatus | None = None
    issue_type: IssueType | None = None
    parent_task_id: uuid.UUID | None = None
    sprint_id: uuid.UUID | None = None
    start_date: date | None = None
    due_date: date | None = None
    hold_reason: str | None = None
    hold_until: date | None = None
    approval_status: ApprovalStatus | None = None
    approver_id: uuid.UUID | None = None
    approval_notes: str | None = None

    @model_validator(mode="after")
    def validate_dates(self) -> TaskUpdate:
        if self.start_date and self.due_date and self.due_date < self.start_date:
            raise ValueError("Due date cannot be earlier than start date.")
        return self


class TaskAssignRequest(BaseModel):
    user_ids: list[uuid.UUID]
    assignment_role: TaskAssignmentRole = TaskAssignmentRole.ASSIGNEE


class TaskSummaryRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    title: str
    description: str | None = None
    priority: TaskPriority
    status: TaskStatus
    issue_type: IssueType = IssueType.TASK
    parent_task_id: uuid.UUID | None = None
    parent_task_title: str | None = None
    sprint_id: uuid.UUID | None = None
    sprint_name: str | None = None
    approval_status: ApprovalStatus = ApprovalStatus.NOT_REQUIRED
    start_date: date | None = None
    due_date: date | None = None
    hold_reason: str | None = None
    hold_until: date | None = None
    created_by: uuid.UUID | None = None
    creator: UserMiniRead | None = None
    created_at: datetime
    updated_at: datetime
    assignees: list[TaskAssigneeRead] = []
    labels: list[TaskLabelRead] = []
    reactions: list[TaskReactionSummary] = []
    subtask_total: int = 0
    subtask_completed: int = 0
    child_task_count: int = 0
    child_task_completed: int = 0
    progress_percent: int = 0
    comment_count: int = 0
    escalation_count: int = 0
    attachment_count: int = 0
    voice_note_count: int = 0


class TaskRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    title: str
    description: str | None = None
    priority: TaskPriority
    status: TaskStatus
    issue_type: IssueType = IssueType.TASK
    parent_task_id: uuid.UUID | None = None
    parent_task_title: str | None = None
    sprint_id: uuid.UUID | None = None
    sprint: TaskSprintRead | None = None
    approval_status: ApprovalStatus = ApprovalStatus.NOT_REQUIRED
    approver_id: uuid.UUID | None = None
    approver: UserMiniRead | None = None
    approval_notes: str | None = None
    approved_at: datetime | None = None
    start_date: date | None = None
    due_date: date | None = None
    hold_reason: str | None = None
    hold_until: date | None = None
    created_by: uuid.UUID | None = None
    created_at: datetime
    updated_at: datetime
    version: int
    creator: UserMiniRead | None = None
    assignees: list[TaskAssigneeRead] = []
    subtasks: list[TaskSubtaskRead] = []
    comments: list[TaskCommentRead] = []
    escalations: list[TaskEscalationRead] = []
    attachments: list[TaskAttachmentRead] = []
    voice_notes: list[TaskVoiceNoteRead] = []
    labels: list[TaskLabelRead] = []
    dependencies: list[TaskDependencyRead] = []
    reactions: list[TaskReactionSummary] = []
    child_tasks: list[TaskSummaryRead] = []
    progress_percent: int = 0


class TaskListResponse(BaseModel):
    items: list[TaskSummaryRead]
    total: int
    page: int
    page_size: int


class TaskTimelineItemRead(BaseModel):
    id: str
    timestamp: datetime
    actor_id: uuid.UUID | None = None
    actor_name: str | None = None
    event_type: str
    description: str
    details: dict[str, Any] | None = None

