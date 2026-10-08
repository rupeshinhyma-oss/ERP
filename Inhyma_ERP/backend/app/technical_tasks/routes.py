"""
Technical Tasks Routes.

Provides REST API endpoints for:
- Listing with filtering, search, sorting, and tab-based status counts
- Detail retrieval
- Creation
- Updates
- Status transitions (approve, complete, cancel, reopen/reassign)
- Single and bulk deletion
- Call Logs management (create, list)
- Payment Screenshot upload
"""

from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, Depends, File, Query, Request, UploadFile, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_user
from app.auth.service import CurrentUser
from app.core.responses import build_success_response
from app.database.session import get_db_session
from app.common.storage import save_uploaded_file
from app.technical_tasks.models import TechnicalTask, TechnicalTaskCallLog
from app.technical_tasks.repository import TechnicalTaskRepository
from app.technical_tasks.schemas import (
    TechnicalTaskBulkDeleteRequest,
    TechnicalTaskCallLogCreate,
    TechnicalTaskCallLogRead,
    TechnicalTaskCountsResponse,
    TechnicalTaskCreate,
    TechnicalTaskRead,
    TechnicalTaskStatusUpdate,
    TechnicalTaskUpdate,
)
from app.technical_tasks.service import TechnicalTaskService

router = APIRouter(prefix="/technical-tasks", tags=["Technical Tasks"])


def get_service(db: AsyncSession = Depends(get_db_session)) -> TechnicalTaskService:
    return TechnicalTaskService(TechnicalTaskRepository(db))


def _to_dict(task: TechnicalTask) -> dict[str, Any]:
    return TechnicalTaskRead.model_validate(task).model_dump(mode="json")


def _log_to_dict(log: TechnicalTaskCallLog) -> dict[str, Any]:
    return TechnicalTaskCallLogRead.model_validate(log).model_dump(mode="json")


@router.get("", summary="List technical tasks with filtering and pagination")
async def list_technical_tasks(
    request: Request,
    tab: str | None = Query(default=None),
    status: str | None = Query(default=None),
    search: str | None = Query(default=None),
    serial_number: str | None = Query(default=None),
    city: str | None = Query(default=None),
    task_type: str | None = Query(default=None),
    call_type: str | None = Query(default=None),
    service_type: str | None = Query(default=None),
    priority: str | None = Query(default=None),
    technician: str | None = Query(default=None),
    task_allotted_to: str | None = Query(default=None),
    sort_by: str = Query(default="created_at"),
    sort_dir: str = Query(default="desc"),
    limit: int | None = Query(default=None, ge=1, le=500),
    offset: int | None = Query(default=None, ge=0),
    page: int | None = Query(default=None, ge=1),
    page_size: int | None = Query(default=None, ge=1, le=500),
    service: TechnicalTaskService = Depends(get_service),
) -> dict:
    effective_tab = status or tab
    effective_tech = technician or task_allotted_to
    effective_limit = page_size if page_size is not None else (limit if limit is not None else 50)
    effective_offset = (
        ((page - 1) * effective_limit) if page is not None else (offset if offset is not None else 0)
    )
    current_page = (effective_offset // effective_limit) + 1 if effective_limit > 0 else 1

    items, total = await service.list_tasks(
        tab=effective_tab,
        search=search,
        serial_number=serial_number,
        city=city,
        task_type=task_type,
        call_type=call_type,
        service_type=service_type,
        priority=priority,
        technician=effective_tech,
        sort_by=sort_by,
        sort_dir=sort_dir,
        limit=effective_limit,
        offset=effective_offset,
    )
    data = [_to_dict(item) for item in items]
    total_pages = (total + effective_limit - 1) // effective_limit if total > 0 else 1
    return {
        "success": True,
        "data": data,
        "meta": {
            "total": total,
            "limit": effective_limit,
            "offset": effective_offset,
            "page": current_page,
            "pages": total_pages,
            "pagination": {
                "total_records": total,
                "page": current_page,
                "page_size": effective_limit,
                "total_pages": total_pages,
            },
        },
    }


@router.get("/counts", summary="Get status tab counts")
async def get_task_counts(
    service: TechnicalTaskService = Depends(get_service),
) -> dict:
    counts = await service.get_counts()
    return {"success": True, "data": counts}


@router.post("/upload-screenshot", summary="Upload payment screenshot")
async def upload_payment_screenshot(
    request: Request,
    file: UploadFile = File(...),
    current_user: CurrentUser | None = Depends(get_current_user),
) -> dict:
    content = await file.read()
    public_url, stored_name = await save_uploaded_file(
        content=content,
        original_filename=file.filename or "screenshot.png",
        bucket="technical-task-screenshots",
        local_subfolder="technical_tasks",
        content_type=file.content_type,
    )
    return {
        "success": True,
        "data": {
            "file_url": public_url,
            "file_name": file.filename or stored_name,
        },
        "message": "Payment screenshot uploaded successfully.",
    }


@router.get("/serial-lookup/{serial_number}", summary="Look up machine info and past tasks by serial number")
async def lookup_by_serial_number(
    serial_number: str,
    service: TechnicalTaskService = Depends(get_service),
) -> dict:
    data = await service.lookup_serial(serial_number)
    return {"success": True, "data": data}


@router.get("/{task_id}", summary="Get technical task details")
async def get_technical_task(
    task_id: uuid.UUID,
    service: TechnicalTaskService = Depends(get_service),
) -> dict:
    task = await service.get_by_id(task_id)
    return {"success": True, "data": _to_dict(task)}


@router.post("", status_code=status.HTTP_201_CREATED, summary="Create a new technical task")
async def create_technical_task(
    payload: TechnicalTaskCreate,
    service: TechnicalTaskService = Depends(get_service),
    current_user: CurrentUser | None = Depends(get_current_user),
) -> dict:
    creator = current_user.username if current_user else "Admin"
    task = await service.create(payload, creator_name=creator)
    return {"success": True, "data": _to_dict(task), "message": "Technical task created successfully."}


@router.patch("/{task_id}", summary="Update a technical task")
async def update_technical_task(
    task_id: uuid.UUID,
    payload: TechnicalTaskUpdate,
    service: TechnicalTaskService = Depends(get_service),
) -> dict:
    task = await service.update(task_id, payload)
    return {"success": True, "data": _to_dict(task), "message": "Technical task updated successfully."}


@router.patch("/{task_id}/status", summary="Update status of technical task")
async def update_technical_task_status(
    task_id: uuid.UUID,
    payload: TechnicalTaskStatusUpdate,
    service: TechnicalTaskService = Depends(get_service),
    current_user: CurrentUser | None = Depends(get_current_user),
) -> dict:
    user_name = current_user.username if current_user else None
    task = await service.update_status(task_id, payload, user_name=user_name)
    return {"success": True, "data": _to_dict(task), "message": f"Task status updated to {task.status}."}


@router.post("/{task_id}/reopen", summary="Reopen and optionally reassign a cancelled technical task")
async def reopen_technical_task(
    task_id: uuid.UUID,
    payload: TechnicalTaskStatusUpdate,
    service: TechnicalTaskService = Depends(get_service),
    current_user: CurrentUser | None = Depends(get_current_user),
) -> dict:
    user_name = current_user.username if current_user else "Admin"
    if payload.status.lower() not in ("approved", "pending"):
        payload.status = "Approved" if payload.task_allotted_to else "Pending"
    task = await service.update_status(task_id, payload, user_name=user_name)
    return {
        "success": True,
        "data": _to_dict(task),
        "message": f"Technical task reopened successfully (Status: {task.status}).",
    }


@router.delete("/{task_id}", summary="Delete a technical task")
async def delete_technical_task(
    task_id: uuid.UUID,
    service: TechnicalTaskService = Depends(get_service),
) -> dict:
    await service.delete(task_id)
    return {"success": True, "message": "Technical task deleted successfully."}


@router.post("/bulk-delete", summary="Bulk delete technical tasks")
async def bulk_delete_technical_tasks(
    payload: TechnicalTaskBulkDeleteRequest,
    service: TechnicalTaskService = Depends(get_service),
) -> dict:
    deleted_count = await service.bulk_delete(payload.ids)
    return {
        "success": True,
        "message": f"Successfully deleted {deleted_count} technical task(s).",
        "deleted_count": deleted_count,
    }


@router.get("/{task_id}/call-logs", summary="Get call logs for a task")
async def get_task_call_logs(
    task_id: uuid.UUID,
    service: TechnicalTaskService = Depends(get_service),
) -> dict:
    logs = await service.list_call_logs(task_id)
    return {"success": True, "data": [_log_to_dict(l) for l in logs]}


@router.post("/{task_id}/call-logs", status_code=status.HTTP_201_CREATED, summary="Add a call log for a task")
async def create_task_call_log(
    task_id: uuid.UUID,
    payload: TechnicalTaskCallLogCreate,
    service: TechnicalTaskService = Depends(get_service),
    current_user: CurrentUser | None = Depends(get_current_user),
) -> dict:
    creator = current_user.username if current_user else "Technician"
    log = await service.add_call_log(task_id, payload, creator_name=creator)
    return {"success": True, "data": _log_to_dict(log), "message": "Call log recorded successfully."}
