"""
Task Module API Routes.
"""

from __future__ import annotations

import uuid
from datetime import date
from fastapi import APIRouter, Depends, File, Query, Request, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from app.audit.repository import AuditRepository
from app.audit.service import AuditService
from app.auth.dependencies import get_current_user
from app.auth.service import CurrentUser
from app.common.storage import save_uploaded_file
from app.core.responses import build_success_response
from app.database.session import get_db_session
from app.notifications.repository import NotificationRepository
from app.notifications.service import NotificationService
from app.rbac.dependencies import require_any_permission, require_permission
from app.tasks.models import (
    ApprovalStatus,
    DependencyType,
    IssueType,
    SprintStatus,
    TaskPriority,
    TaskStatus,
)
from app.tasks.repository import TaskRepository
from app.tasks.schemas import (
    CapacityViewResponse,
    TaskApprovalActionRequest,
    TaskAssignRequest,
    TaskAttachmentCreateInput,
    TaskAttachmentRead,
    TaskBulkActionRequest,
    TaskBulkActionResponse,
    TaskCommentCreate,
    TaskCommentRead,
    TaskCreate,
    TaskDependencyCreate,
    TaskDependencyRead,
    TaskDuplicateRequest,
    TaskEscalateOptionsResponse,
    TaskEscalateRequest,
    TaskEscalationCommentCreate,
    TaskEscalationCommentRead,
    TaskEscalationRead,
    TaskLabelCreate,
    TaskLabelRead,
    TaskListResponse,
    TaskReactionToggle,
    TaskRead,
    TaskSavedFilterCreate,
    TaskSavedFilterRead,
    TaskSavedFilterUpdate,
    TaskSprintCreate,
    TaskSprintRead,
    TaskSprintUpdate,
    TaskSubmitApprovalRequest,
    TaskSubtaskAttachmentRead,
    TaskSubtaskCommentCreate,
    TaskSubtaskCommentRead,
    TaskSubtaskCreate,
    TaskSubtaskRead,
    TaskSubtaskUpdate,
    TaskTemplateCreate,
    TaskTemplateRead,
    TaskTemplateUpdate,
    TaskUpdate,
    TaskVoiceNoteCreateInput,
    TaskVoiceNoteRead,
    WorkloadDashboardResponse,
)
from app.tasks.service import TaskService

router = APIRouter(prefix="/tasks", tags=["Tasks"])


def get_task_service(db: AsyncSession = Depends(get_db_session)) -> TaskService:
    repo = TaskRepository(db)
    audit = AuditService(AuditRepository(db))
    notif_repo = NotificationRepository(db)
    notif = NotificationService(notif_repo)
    return TaskService(repository=repo, audit_service=audit, notification_service=notif)


@router.post("/upload-file", summary="Upload a file or voice note recording")
async def upload_file(
    request: Request,
    file: UploadFile = File(...),
    current_user: CurrentUser = Depends(require_permission("task.view")),
) -> dict:
    content = await file.read()
    public_url, stored_name = await save_uploaded_file(
        content=content,
        original_filename=file.filename or "upload",
        bucket="task-attachments",
        local_subfolder="tasks",
        content_type=file.content_type,
    )
    return build_success_response(
        data={
            "file_url": public_url,
            "file_name": file.filename or stored_name,
            "file_size": len(content),
            "file_type": file.content_type or "application/octet-stream",
        },
        request_id=getattr(request.state, "request_id", "-"),
    )


@router.get("", summary="List tasks with visibility rules and filters")
async def list_tasks(
    request: Request,
    view: str = Query("all", description="View mode: all, my, kanban, calendar, department"),
    department_id: uuid.UUID | None = Query(None, description="Filter by department ID"),
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
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=500),
    current_user: CurrentUser = Depends(require_permission("task.view")),
    service: TaskService = Depends(get_task_service),
) -> dict:
    items, total = await service.list_tasks(
        current_user_id=current_user.id,
        user_permissions=current_user.permissions,
        view_mode=view,
        department_id=department_id,
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
    serialized = [item.model_dump() for item in items]
    data = TaskListResponse(
        items=serialized,
        total=total,
        page=page,
        page_size=page_size,
    ).model_dump()
    return build_success_response(data=data, request_id=getattr(request.state, "request_id", "-"))


@router.post("", summary="Create a new task")
async def create_task(
    payload: TaskCreate,
    request: Request,
    current_user: CurrentUser = Depends(require_any_permission("task.view", "task.create", "task.assign")),
    service: TaskService = Depends(get_task_service),
) -> dict:
    task = await service.create_task(payload, current_user)
    serialized = TaskRead.model_validate(task).model_dump()
    return build_success_response(
        data=serialized, status_code=201, request_id=getattr(request.state, "request_id", "-")
    )


@router.get("/escalate-options", summary="Get candidate users and managers for manual escalation")
async def get_escalate_options(
    request: Request,
    current_user: CurrentUser = Depends(require_permission("task.view")),
    service: TaskService = Depends(get_task_service),
) -> dict:
    data = await service.get_escalate_options(current_user.id)
    return build_success_response(
        data=data.model_dump(), request_id=getattr(request.state, "request_id", "-")
    )


# --- Labels ---
@router.get("/labels", summary="List all task labels")
async def list_labels(
    request: Request,
    current_user: CurrentUser = Depends(require_permission("task.view")),
    service: TaskService = Depends(get_task_service),
) -> dict:
    data = await service.list_labels()
    return build_success_response(data=[l.model_dump() for l in data], request_id=getattr(request.state, "request_id", "-"))


@router.post("/labels", summary="Create a task label")
async def create_label(
    payload: TaskLabelCreate,
    request: Request,
    current_user: CurrentUser = Depends(require_permission("task.view")),
    service: TaskService = Depends(get_task_service),
) -> dict:
    label = await service.create_label(payload, current_user)
    return build_success_response(data=label.model_dump(), status_code=201, request_id=getattr(request.state, "request_id", "-"))


# --- Sprints ---
@router.get("/sprints", summary="List sprints")
async def list_sprints(
    request: Request,
    status: SprintStatus | None = None,
    current_user: CurrentUser = Depends(require_permission("task.view")),
    service: TaskService = Depends(get_task_service),
) -> dict:
    data = await service.list_sprints(status=status)
    return build_success_response(data=[s.model_dump() for s in data], request_id=getattr(request.state, "request_id", "-"))


@router.post("/sprints", summary="Create a sprint")
async def create_sprint(
    payload: TaskSprintCreate,
    request: Request,
    current_user: CurrentUser = Depends(require_any_permission("task.create", "task.manage")),
    service: TaskService = Depends(get_task_service),
) -> dict:
    sprint = await service.create_sprint(payload, current_user)
    return build_success_response(data=sprint.model_dump(), status_code=201, request_id=getattr(request.state, "request_id", "-"))


@router.patch("/sprints/{sprint_id}", summary="Update a sprint")
async def update_sprint(
    sprint_id: uuid.UUID,
    payload: TaskSprintUpdate,
    request: Request,
    current_user: CurrentUser = Depends(require_any_permission("task.create", "task.manage")),
    service: TaskService = Depends(get_task_service),
) -> dict:
    sprint = await service.update_sprint(sprint_id, payload, current_user)
    return build_success_response(data=sprint.model_dump(), request_id=getattr(request.state, "request_id", "-"))


@router.delete("/sprints/{sprint_id}", summary="Delete a sprint")
async def delete_sprint(
    sprint_id: uuid.UUID,
    request: Request,
    current_user: CurrentUser = Depends(require_any_permission("task.create", "task.manage")),
    service: TaskService = Depends(get_task_service),
) -> dict:
    await service.delete_sprint(sprint_id, current_user)
    return build_success_response(data={"deleted": True}, request_id=getattr(request.state, "request_id", "-"))


# --- Templates ---
@router.get("/templates", summary="List task templates")
async def list_templates(
    request: Request,
    category: str | None = None,
    current_user: CurrentUser = Depends(require_permission("task.view")),
    service: TaskService = Depends(get_task_service),
) -> dict:
    data = await service.list_templates(category=category)
    return build_success_response(data=[t.model_dump() for t in data], request_id=getattr(request.state, "request_id", "-"))


@router.post("/templates", summary="Create task template")
async def create_template(
    payload: TaskTemplateCreate,
    request: Request,
    current_user: CurrentUser = Depends(require_any_permission("task.create", "task.manage")),
    service: TaskService = Depends(get_task_service),
) -> dict:
    tpl = await service.create_template(payload, current_user)
    return build_success_response(data=tpl.model_dump(), status_code=201, request_id=getattr(request.state, "request_id", "-"))


@router.patch("/templates/{template_id}", summary="Update task template")
async def update_template(
    template_id: uuid.UUID,
    payload: TaskTemplateUpdate,
    request: Request,
    current_user: CurrentUser = Depends(require_any_permission("task.create", "task.manage")),
    service: TaskService = Depends(get_task_service),
) -> dict:
    tpl = await service.update_template(template_id, payload, current_user)
    return build_success_response(data=tpl.model_dump(), request_id=getattr(request.state, "request_id", "-"))


@router.delete("/templates/{template_id}", summary="Delete task template")
async def delete_template(
    template_id: uuid.UUID,
    request: Request,
    current_user: CurrentUser = Depends(require_any_permission("task.create", "task.manage")),
    service: TaskService = Depends(get_task_service),
) -> dict:
    await service.delete_template(template_id, current_user)
    return build_success_response(data={"deleted": True}, request_id=getattr(request.state, "request_id", "-"))


# --- Saved Filters ---
@router.get("/saved-filters", summary="List user's saved filters")
async def list_saved_filters(
    request: Request,
    current_user: CurrentUser = Depends(require_permission("task.view")),
    service: TaskService = Depends(get_task_service),
) -> dict:
    data = await service.list_saved_filters(current_user)
    return build_success_response(data=[f.model_dump() for f in data], request_id=getattr(request.state, "request_id", "-"))


@router.post("/saved-filters", summary="Create saved filter")
async def create_saved_filter(
    payload: TaskSavedFilterCreate,
    request: Request,
    current_user: CurrentUser = Depends(require_permission("task.view")),
    service: TaskService = Depends(get_task_service),
) -> dict:
    sf = await service.create_saved_filter(payload, current_user)
    return build_success_response(data=sf.model_dump(), status_code=201, request_id=getattr(request.state, "request_id", "-"))


@router.patch("/saved-filters/{filter_id}", summary="Update saved filter")
async def update_saved_filter(
    filter_id: uuid.UUID,
    payload: TaskSavedFilterUpdate,
    request: Request,
    current_user: CurrentUser = Depends(require_permission("task.view")),
    service: TaskService = Depends(get_task_service),
) -> dict:
    sf = await service.update_saved_filter(filter_id, payload, current_user)
    return build_success_response(data=sf.model_dump(), request_id=getattr(request.state, "request_id", "-"))


@router.delete("/saved-filters/{filter_id}", summary="Delete saved filter")
async def delete_saved_filter(
    filter_id: uuid.UUID,
    request: Request,
    current_user: CurrentUser = Depends(require_permission("task.view")),
    service: TaskService = Depends(get_task_service),
) -> dict:
    await service.delete_saved_filter(filter_id, current_user)
    return build_success_response(data={"deleted": True}, request_id=getattr(request.state, "request_id", "-"))


# --- Bulk Operations ---
@router.post("/bulk-action", summary="Perform bulk operation across multiple tasks")
async def bulk_action(
    payload: TaskBulkActionRequest,
    request: Request,
    current_user: CurrentUser = Depends(require_any_permission("task.view", "task.create", "task.manage")),
    service: TaskService = Depends(get_task_service),
) -> dict:
    res = await service.bulk_action(payload, current_user)
    return build_success_response(data=res.model_dump(), request_id=getattr(request.state, "request_id", "-"))


# --- Workload & Capacity ---
@router.get("/workload", summary="Team workload dashboard")
async def get_workload(
    request: Request,
    department_id: uuid.UUID | None = None,
    current_user: CurrentUser = Depends(require_permission("task.view")),
    service: TaskService = Depends(get_task_service),
) -> dict:
    res = await service.get_workload_dashboard(department_id=department_id)
    return build_success_response(data=res.model_dump(), request_id=getattr(request.state, "request_id", "-"))


@router.get("/capacity", summary="Capacity calendar view")
async def get_capacity(
    request: Request,
    start_date: date = Query(...),
    end_date: date = Query(...),
    department_id: uuid.UUID | None = None,
    current_user: CurrentUser = Depends(require_permission("task.view")),
    service: TaskService = Depends(get_task_service),
) -> dict:
    res = await service.get_capacity_view(start_date=start_date, end_date=end_date, department_id=department_id)
    return build_success_response(data=res.model_dump(), request_id=getattr(request.state, "request_id", "-"))


# --- Comment Reactions & Dependency Deletion ---
@router.post("/comments/{comment_id}/reactions", summary="Toggle reaction on task comment")
async def toggle_comment_reaction(
    comment_id: uuid.UUID,
    payload: TaskReactionToggle,
    request: Request,
    current_user: CurrentUser = Depends(require_permission("task.view")),
    service: TaskService = Depends(get_task_service),
) -> dict:
    added = await service.toggle_comment_reaction(comment_id, payload.emoji, current_user)
    return build_success_response(data={"added": added, "emoji": payload.emoji}, request_id=getattr(request.state, "request_id", "-"))


@router.delete("/dependencies/{dependency_id}", summary="Remove task dependency")
async def remove_dependency(
    dependency_id: uuid.UUID,
    request: Request,
    current_user: CurrentUser = Depends(require_permission("task.view")),
    service: TaskService = Depends(get_task_service),
) -> dict:
    await service.remove_dependency(dependency_id, current_user)
    return build_success_response(data={"deleted": True}, request_id=getattr(request.state, "request_id", "-"))


@router.get("/{id}", summary="Get task by ID with assignees, subtasks, comments, escalations")
async def get_task_by_id(
    id: uuid.UUID,
    request: Request,
    current_user: CurrentUser = Depends(require_permission("task.view")),
    service: TaskService = Depends(get_task_service),
) -> dict:
    task = await service.get_task(id)
    serialized = TaskRead.model_validate(task).model_dump()
    return build_success_response(data=serialized, request_id=getattr(request.state, "request_id", "-"))


@router.patch("/{id}", summary="Update task details")
async def update_task(
    id: uuid.UUID,
    payload: TaskUpdate,
    request: Request,
    current_user: CurrentUser = Depends(require_permission("task.view")),
    service: TaskService = Depends(get_task_service),
) -> dict:
    task = await service.update_task(id, payload, current_user)
    serialized = TaskRead.model_validate(task).model_dump()
    return build_success_response(data=serialized, request_id=getattr(request.state, "request_id", "-"))


@router.delete("/{id}", summary="Soft-delete task")
async def delete_task(
    id: uuid.UUID,
    request: Request,
    current_user: CurrentUser = Depends(require_any_permission("task.manage", "task.delete", "task.create")),
    service: TaskService = Depends(get_task_service),
) -> dict:
    await service.soft_delete_task(id, current_user)
    return build_success_response(
        data={"deleted": True}, request_id=getattr(request.state, "request_id", "-")
    )


@router.post("/{id}/assign", summary="Assign users to task")
async def assign_task(
    id: uuid.UUID,
    payload: TaskAssignRequest,
    request: Request,
    current_user: CurrentUser = Depends(require_any_permission("task.assign", "task.manage", "task.view")),
    service: TaskService = Depends(get_task_service),
) -> dict:
    task = await service.assign_task(
        id, payload.user_ids, current_user, role=payload.assignment_role.value
    )
    serialized = TaskRead.model_validate(task).model_dump()
    return build_success_response(data=serialized, request_id=getattr(request.state, "request_id", "-"))


@router.post("/{id}/comment", summary="Add comment to task")
async def add_task_comment(
    id: uuid.UUID,
    payload: TaskCommentCreate,
    request: Request,
    current_user: CurrentUser = Depends(require_permission("task.view")),
    service: TaskService = Depends(get_task_service),
) -> dict:
    attachments_data = [a.model_dump() for a in payload.attachments] if payload.attachments else None
    comment = await service.add_comment(
        id,
        payload.message,
        current_user,
        audio_url=payload.audio_url,
        attachments=attachments_data,
    )
    serialized = TaskCommentRead.model_validate(comment).model_dump()
    return build_success_response(
        data=serialized, status_code=201, request_id=getattr(request.state, "request_id", "-")
    )


@router.post("/{id}/attachments", summary="Add attachment to task")
async def add_task_attachment(
    id: uuid.UUID,
    payload: TaskAttachmentCreateInput,
    request: Request,
    current_user: CurrentUser = Depends(require_permission("task.view")),
    service: TaskService = Depends(get_task_service),
) -> dict:
    att = await service.add_attachment(
        id,
        file_name=payload.file_name,
        file_url=payload.file_url,
        file_size=payload.file_size,
        file_type=payload.file_type,
        current_user=current_user,
    )
    serialized = TaskAttachmentRead.model_validate(att).model_dump()
    return build_success_response(
        data=serialized, status_code=201, request_id=getattr(request.state, "request_id", "-")
    )


@router.delete("/attachments/{attachment_id}", summary="Delete an attachment from task")
async def delete_task_attachment(
    attachment_id: uuid.UUID,
    request: Request,
    current_user: CurrentUser = Depends(require_permission("task.view")),
    service: TaskService = Depends(get_task_service),
) -> dict:
    await service.delete_attachment(attachment_id, current_user)
    return build_success_response(
        data={"deleted": True}, request_id=getattr(request.state, "request_id", "-")
    )


@router.post("/{id}/voice-notes", summary="Add voice note to task")
async def add_task_voice_note(
    id: uuid.UUID,
    payload: TaskVoiceNoteCreateInput,
    request: Request,
    current_user: CurrentUser = Depends(require_permission("task.view")),
    service: TaskService = Depends(get_task_service),
) -> dict:
    vn = await service.add_voice_note(
        id,
        audio_url=payload.audio_url,
        duration_seconds=payload.duration_seconds,
        file_size=payload.file_size,
        mime_type=payload.mime_type or "audio/webm",
        title=payload.title,
        current_user=current_user,
    )
    serialized = TaskVoiceNoteRead.model_validate(vn).model_dump()
    return build_success_response(
        data=serialized, status_code=201, request_id=getattr(request.state, "request_id", "-")
    )


@router.post("/{id}/escalate", summary="Escalate task to manager or user")
async def escalate_task(
    id: uuid.UUID,
    payload: TaskEscalateRequest,
    request: Request,
    current_user: CurrentUser = Depends(require_any_permission("task.escalate", "task.manage", "task.view")),
    service: TaskService = Depends(get_task_service),
) -> dict:
    esc = await service.escalate_task(
        id,
        payload.to_user,
        payload.reason,
        current_user,
        escalation_type=payload.escalation_type,
        due_date=payload.due_date,
    )
    serialized = TaskEscalationRead.model_validate(esc).model_dump()
    return build_success_response(
        data=serialized, status_code=201, request_id=getattr(request.state, "request_id", "-")
    )


@router.get("/{id}/timeline", summary="Get activity timeline for task")
async def get_task_timeline(
    id: uuid.UUID,
    request: Request,
    current_user: CurrentUser = Depends(require_permission("task.view")),
    service: TaskService = Depends(get_task_service),
) -> dict:
    events = await service.get_task_timeline(id)
    return build_success_response(data=events, request_id=getattr(request.state, "request_id", "-"))


@router.post("/{id}/subtasks", summary="Add a subtask to task")
async def add_subtask(
    id: uuid.UUID,
    payload: TaskSubtaskCreate,
    request: Request,
    current_user: CurrentUser = Depends(require_permission("task.view")),
    service: TaskService = Depends(get_task_service),
) -> dict:
    p_val = payload.priority.value if hasattr(payload.priority, "value") else str(payload.priority or "MEDIUM")
    s_val = payload.status.value if hasattr(payload.status, "value") else str(payload.status or "TODO")
    sub = await service.add_subtask(
        id,
        payload.title,
        description=payload.description,
        priority=p_val,
        status=s_val,
        start_date=payload.start_date,
        due_date=payload.due_date,
        assignee_id=payload.assignee_id,
        assignee_ids=payload.assignee_ids,
        order_index=payload.order_index,
        current_user=current_user,
    )
    serialized = TaskSubtaskRead.model_validate(sub).model_dump()
    return build_success_response(
        data=serialized, status_code=201, request_id=getattr(request.state, "request_id", "-")
    )


@router.patch("/subtasks/{subtask_id}", summary="Update a subtask (completed, title, assignee)")
async def update_subtask(
    subtask_id: uuid.UUID,
    payload: TaskSubtaskUpdate,
    request: Request,
    current_user: CurrentUser = Depends(require_permission("task.view")),
    service: TaskService = Depends(get_task_service),
) -> dict:
    p_val = payload.priority.value if payload.priority and hasattr(payload.priority, "value") else (str(payload.priority) if payload.priority else None)
    s_val = payload.status.value if payload.status and hasattr(payload.status, "value") else (str(payload.status) if payload.status else None)
    sub = await service.update_subtask(
        subtask_id,
        title=payload.title,
        description=payload.description,
        priority=p_val,
        status=s_val,
        start_date=payload.start_date,
        due_date=payload.due_date,
        completed=payload.completed,
        assignee_id=payload.assignee_id,
        assignee_ids=payload.assignee_ids,
        order_index=payload.order_index,
        current_user=current_user,
    )
    serialized = TaskSubtaskRead.model_validate(sub).model_dump()
    return build_success_response(data=serialized, request_id=getattr(request.state, "request_id", "-"))


@router.delete("/subtasks/{subtask_id}", summary="Delete a subtask")
async def delete_subtask(
    subtask_id: uuid.UUID,
    request: Request,
    current_user: CurrentUser = Depends(require_permission("task.view")),
    service: TaskService = Depends(get_task_service),
) -> dict:
    await service.delete_subtask(subtask_id, current_user)
    return build_success_response(
        data={"deleted": True}, request_id=getattr(request.state, "request_id", "-")
    )


# --- Subtask Collaboration (Independent Comments & Attachments) ---
@router.get("/subtasks/{subtask_id}/comments", summary="Get comments for subtask")
async def get_subtask_comments(
    subtask_id: uuid.UUID,
    request: Request,
    current_user: CurrentUser = Depends(require_permission("task.view")),
    service: TaskService = Depends(get_task_service),
) -> dict:
    comments = await service.list_subtask_comments(subtask_id)
    serialized = [TaskSubtaskCommentRead.model_validate(c).model_dump() for c in comments]
    return build_success_response(data=serialized, request_id=getattr(request.state, "request_id", "-"))


@router.post("/subtasks/{subtask_id}/comments", summary="Add comment to subtask")
async def add_subtask_comment(
    subtask_id: uuid.UUID,
    payload: TaskSubtaskCommentCreate,
    request: Request,
    current_user: CurrentUser = Depends(require_permission("task.view")),
    service: TaskService = Depends(get_task_service),
) -> dict:
    c = await service.add_subtask_comment(
        subtask_id, payload.message, current_user, audio_url=payload.audio_url
    )
    serialized = TaskSubtaskCommentRead.model_validate(c).model_dump()
    return build_success_response(
        data=serialized, status_code=201, request_id=getattr(request.state, "request_id", "-")
    )


@router.get("/subtasks/{subtask_id}/attachments", summary="Get attachments for subtask")
async def get_subtask_attachments(
    subtask_id: uuid.UUID,
    request: Request,
    current_user: CurrentUser = Depends(require_permission("task.view")),
    service: TaskService = Depends(get_task_service),
) -> dict:
    attachments = await service.list_subtask_attachments(subtask_id)
    serialized = [TaskSubtaskAttachmentRead.model_validate(a).model_dump() for a in attachments]
    return build_success_response(data=serialized, request_id=getattr(request.state, "request_id", "-"))


@router.post("/subtasks/{subtask_id}/attachments", summary="Add attachment to subtask")
async def add_subtask_attachment(
    subtask_id: uuid.UUID,
    payload: TaskAttachmentCreateInput,
    request: Request,
    current_user: CurrentUser = Depends(require_permission("task.view")),
    service: TaskService = Depends(get_task_service),
) -> dict:
    sa = await service.add_subtask_attachment(
        subtask_id,
        file_name=payload.file_name,
        file_url=payload.file_url,
        file_size=payload.file_size,
        file_type=payload.file_type,
        current_user=current_user,
    )
    serialized = TaskSubtaskAttachmentRead.model_validate(sa).model_dump()
    return build_success_response(
        data=serialized, status_code=201, request_id=getattr(request.state, "request_id", "-")
    )


# --- Escalation Collaboration (Independent Comments) ---
@router.get("/escalations/{escalation_id}/comments", summary="Get comments for escalation")
async def get_escalation_comments(
    escalation_id: uuid.UUID,
    request: Request,
    current_user: CurrentUser = Depends(require_permission("task.view")),
    service: TaskService = Depends(get_task_service),
) -> dict:
    comments = await service.list_escalation_comments(escalation_id)
    serialized = [TaskEscalationCommentRead.model_validate(c).model_dump() for c in comments]
    return build_success_response(data=serialized, request_id=getattr(request.state, "request_id", "-"))


@router.post("/escalations/{escalation_id}/comments", summary="Add comment to escalation")
async def add_escalation_comment(
    escalation_id: uuid.UUID,
    payload: TaskEscalationCommentCreate,
    request: Request,
    current_user: CurrentUser = Depends(require_permission("task.view")),
    service: TaskService = Depends(get_task_service),
) -> dict:
    ec = await service.add_escalation_comment(
        escalation_id, payload.message, current_user, audio_url=payload.audio_url
    )
    serialized = TaskEscalationCommentRead.model_validate(ec).model_dump()
    return build_success_response(
        data=serialized, status_code=201, request_id=getattr(request.state, "request_id", "-")
    )


@router.post("/check-holds", summary="Check for expired holds and send notifications")
async def check_expired_holds(
    request: Request,
    current_user: CurrentUser = Depends(require_permission("task.view")),
    service: TaskService = Depends(get_task_service),
) -> dict:
    count = await service.check_expired_holds()
    return build_success_response(
        data={"expired_holds_checked": count},
        request_id=getattr(request.state, "request_id", "-"),
    )


@router.post("/check-deadlines", summary="Check approaching & overdue deadlines for self and assigned escalations")
async def check_task_deadlines(
    request: Request,
    current_user: CurrentUser = Depends(get_current_user),
    service: TaskService = Depends(get_task_service),
) -> dict:
    count = await service.check_task_deadlines(user_id=current_user.id)
    return build_success_response(
        data={"notifications_sent": count},
        request_id=getattr(request.state, "request_id", "-"),
    )


# --- V2.0 Task Operations (Duplicate, Dependencies, Reactions, Approvals) ---
@router.post("/{id}/duplicate", summary="Duplicate an existing task")
async def duplicate_task(
    id: uuid.UUID,
    payload: TaskDuplicateRequest,
    request: Request,
    current_user: CurrentUser = Depends(require_any_permission("task.view", "task.create")),
    service: TaskService = Depends(get_task_service),
) -> dict:
    task = await service.duplicate_task(id, payload, current_user)
    return build_success_response(
        data=TaskRead.model_validate(task).model_dump(), status_code=201, request_id=getattr(request.state, "request_id", "-")
    )


@router.post("/{id}/dependencies", summary="Add task dependency")
async def add_task_dependency(
    id: uuid.UUID,
    payload: TaskDependencyCreate,
    request: Request,
    current_user: CurrentUser = Depends(require_permission("task.view")),
    service: TaskService = Depends(get_task_service),
) -> dict:
    dep = await service.add_dependency(id, payload, current_user)
    return build_success_response(
        data=TaskDependencyRead.model_validate(dep).model_dump(), status_code=201, request_id=getattr(request.state, "request_id", "-")
    )


@router.post("/{id}/reactions", summary="Toggle reaction on task")
async def toggle_task_reaction(
    id: uuid.UUID,
    payload: TaskReactionToggle,
    request: Request,
    current_user: CurrentUser = Depends(require_permission("task.view")),
    service: TaskService = Depends(get_task_service),
) -> dict:
    added = await service.toggle_task_reaction(id, payload.emoji, current_user)
    return build_success_response(
        data={"added": added, "emoji": payload.emoji}, request_id=getattr(request.state, "request_id", "-")
    )


@router.post("/{id}/submit-approval", summary="Submit task for manager approval")
async def submit_approval(
    id: uuid.UUID,
    payload: TaskSubmitApprovalRequest,
    request: Request,
    current_user: CurrentUser = Depends(require_permission("task.view")),
    service: TaskService = Depends(get_task_service),
) -> dict:
    task = await service.submit_for_approval(id, payload, current_user)
    return build_success_response(
        data=TaskRead.model_validate(task).model_dump(), request_id=getattr(request.state, "request_id", "-")
    )


@router.post("/{id}/action-approval", summary="Approve or reject pending task")
async def action_approval(
    id: uuid.UUID,
    payload: TaskApprovalActionRequest,
    request: Request,
    current_user: CurrentUser = Depends(require_permission("task.view")),
    service: TaskService = Depends(get_task_service),
) -> dict:
    task = await service.action_approval(id, payload, current_user)
    return build_success_response(
        data=TaskRead.model_validate(task).model_dump(), request_id=getattr(request.state, "request_id", "-")
    )
