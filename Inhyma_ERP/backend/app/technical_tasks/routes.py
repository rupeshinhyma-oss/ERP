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
from datetime import date
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
    TechnicalCallLogReportRow,
    TechnicalTaskCountsResponse,
    TechnicalTaskCreate,
    TechnicalTaskPaymentRecordRequest,
    TechnicalTaskRead,
    TechnicalTaskStatusUpdate,
    TechnicalTaskUpdate,
)
from app.technical_tasks.repository import COUNT_CAP
from app.technical_tasks.service import TechnicalTaskService

router = APIRouter(prefix="/technical-tasks", tags=["Technical Tasks"])

# Data-isolation switches. Nothing is restricted unless one of these permissions is granted to the user's role, so
# rolling this out can never lock existing users out. Admins / wildcard users are never restricted.
SCOPE_OWN_PERMISSION = "technical_task.scope.own"            # sees only tasks they created
HIDE_PAYMENT_PENDING_PERMISSION = "technical_task.hide_payment_pending"  # cannot see Payment Pending tasks


def _is_privileged(user: CurrentUser | None) -> bool:
    """Admin-level actions (edit approved / delete beyond Pending / reopen others' cancelled tasks)."""
    if user is None:
        return True
    return user.is_admin or "*" in user.permissions or "technicaltask.manage" in user.permissions


def _scope_for(user: CurrentUser | None) -> dict[str, Any]:
    if user is None or user.is_admin or "*" in user.permissions:
        return {}
    scope: dict[str, Any] = {}
    if SCOPE_OWN_PERMISSION in user.permissions:
        scope["creator_user_id"] = user.id
        scope["creator_username"] = user.username
    if HIDE_PAYMENT_PENDING_PERMISSION in user.permissions:
        scope["exclude_tabs"] = ("payment_pending",)
    return scope


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
    third_party_city: str | None = Query(default=None),
    task_type: str | None = Query(default=None),
    call_type: str | None = Query(default=None),
    service_type: str | None = Query(default=None),
    priority: str | None = Query(default=None),
    technician: str | None = Query(default=None),
    task_allotted_to: str | None = Query(default=None),
    payment_collected: str | None = Query(default=None, description="yes | pending"),
    date_from: date | None = Query(default=None),
    date_to: date | None = Query(default=None),
    sort_by: str = Query(default="created_at"),
    sort_dir: str | None = Query(default=None),
    sort_desc: bool | None = Query(default=None),
    limit: int | None = Query(default=None, ge=1, le=500),
    offset: int | None = Query(default=None, ge=0),
    page: int | None = Query(default=None, ge=1),
    page_size: int | None = Query(default=None, ge=1, le=500),
    service: TechnicalTaskService = Depends(get_service),
    current_user: CurrentUser | None = Depends(get_current_user),
) -> dict:
    effective_tab = status or tab
    effective_dir = sort_dir or ("desc" if sort_desc is None or sort_desc else "asc")
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
        third_party_city=third_party_city,
        task_type=task_type,
        call_type=call_type,
        service_type=service_type,
        priority=priority,
        technician=effective_tech,
        payment_collected=payment_collected,
        date_from=date_from,
        date_to=date_to,
        sort_by=sort_by,
        sort_dir=effective_dir,
        limit=effective_limit,
        offset=effective_offset,
        **_scope_for(current_user),
    )
    data = [_to_dict(item) for item in items]
    shown_total = min(total, COUNT_CAP)
    total_pages = (shown_total + effective_limit - 1) // effective_limit if shown_total > 0 else 1
    return {
        "success": True,
        "data": data,
        "meta": {
            "total": min(total, COUNT_CAP),
            "total_capped": total > COUNT_CAP,  # true => "10000+ matches": narrow the filters
            "limit": effective_limit,
            "offset": effective_offset,
            "page": current_page,
            "pages": total_pages,
            "pagination": {
                "total_records": min(total, COUNT_CAP),
                "page": current_page,
                "page_size": effective_limit,
                "total_pages": total_pages,
            },
        },
    }


@router.get("/counts", summary="Get status tab counts")
async def get_task_counts(
    service: TechnicalTaskService = Depends(get_service),
    current_user: CurrentUser | None = Depends(get_current_user),
) -> dict:
    counts = await service.get_counts(**_scope_for(current_user))
    return {"success": True, "data": counts}


@router.get("/payment-summary", summary="Get payment summary KPIs (total, paid, due, pending/completed counts)")
async def get_payment_summary(
    service: TechnicalTaskService = Depends(get_service),
    current_user: CurrentUser | None = Depends(get_current_user),
) -> dict:
    summary = await service.get_payment_summary(**_scope_for(current_user))
    return {"success": True, "data": summary}


@router.get("/call-log-report", summary="Technical call log report (all logs, separate from the call log form)")
async def call_log_report(
    date_from: date | None = Query(default=None),
    date_to: date | None = Query(default=None),
    call_type: str | None = Query(default=None),
    created_by: str | None = Query(default=None),
    search: str | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=500),
    service: TechnicalTaskService = Depends(get_service),
    current_user: CurrentUser | None = Depends(get_current_user),
) -> dict:
    offset = (page - 1) * page_size
    items, total = await service.call_log_report(
        date_from=date_from, date_to=date_to, call_type=call_type, created_by=created_by, search=search,
        limit=page_size, offset=offset, **_scope_for(current_user),
    )
    data = [TechnicalCallLogReportRow.model_validate(i).model_dump(mode="json") for i in items]
    shown = min(total, COUNT_CAP)
    pages = (shown + page_size - 1) // page_size if shown else 1
    return {
        "success": True,
        "data": data,
        "meta": {"total": shown, "total_capped": total > COUNT_CAP, "page": page, "page_size": page_size, "pages": pages,
                 "pagination": {"total_records": shown, "page": page, "page_size": page_size, "total_pages": pages}},
    }


@router.get("/monthly-summary", summary="Open vs Closed month-wise summary for the technical module dashboard")
async def monthly_summary(
    months: int = Query(default=12, ge=1, le=36),
    service: TechnicalTaskService = Depends(get_service),
    current_user: CurrentUser | None = Depends(get_current_user),
) -> dict:
    return {"success": True, "data": await service.monthly_summary(months, **_scope_for(current_user))}


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
    task = await service.create(
        payload, creator_name=creator, creator_user_id=current_user.id if current_user else None
    )
    return {"success": True, "data": _to_dict(task), "message": "Technical task created successfully."}


@router.patch("/{task_id}", summary="Update a technical task")
async def update_technical_task(
    task_id: uuid.UUID,
    payload: TechnicalTaskUpdate,
    service: TechnicalTaskService = Depends(get_service),
    current_user: CurrentUser | None = Depends(get_current_user),
) -> dict:
    task = await service.update(
        task_id, payload, user_name=current_user.username if current_user else None, privileged=_is_privileged(current_user)
    )
    return {"success": True, "data": _to_dict(task), "message": "Technical task updated successfully."}


@router.patch("/{task_id}/status", summary="Update status of technical task")
async def update_technical_task_status(
    task_id: uuid.UUID,
    payload: TechnicalTaskStatusUpdate,
    service: TechnicalTaskService = Depends(get_service),
    current_user: CurrentUser | None = Depends(get_current_user),
) -> dict:
    user_name = current_user.username if current_user else None
    task = await service.update_status(task_id, payload, user_name=user_name, privileged=_is_privileged(current_user))
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
    task = await service.update_status(task_id, payload, user_name=user_name, privileged=_is_privileged(current_user))
    return {
        "success": True,
        "data": _to_dict(task),
        "message": f"Technical task reopened successfully (Status: {task.status}).",
    }


@router.post("/{task_id}/record-payment", summary="Record a payment for a technical task")
async def record_technical_task_payment(
    task_id: uuid.UUID,
    payload: TechnicalTaskPaymentRecordRequest,
    service: TechnicalTaskService = Depends(get_service),
    current_user: CurrentUser | None = Depends(get_current_user),
) -> dict:
    user_name = current_user.username if current_user else "Accounts"
    task = await service.record_payment(
        task_id=task_id,
        amount=payload.amount,
        payment_mode=payload.payment_mode,
        payment_date=payload.payment_date,
        reference_no=payload.reference_no,
        payment_screenshot=payload.payment_screenshot,
        remarks=payload.remarks,
        user_name=user_name,
    )
    return {
        "success": True,
        "data": _to_dict(task),
        "message": f"Payment of ₹{payload.amount:,.2f} recorded successfully.",
    }


@router.delete("/{task_id}", summary="Delete a technical task")
async def delete_technical_task(
    task_id: uuid.UUID,
    service: TechnicalTaskService = Depends(get_service),
    current_user: CurrentUser | None = Depends(get_current_user),
) -> dict:
    await service.delete(task_id, privileged=_is_privileged(current_user))
    return {"success": True, "message": "Technical task deleted successfully."}


@router.post("/bulk-delete", summary="Bulk delete technical tasks")
async def bulk_delete_technical_tasks(
    payload: TechnicalTaskBulkDeleteRequest,
    service: TechnicalTaskService = Depends(get_service),
    current_user: CurrentUser | None = Depends(get_current_user),
) -> dict:
    deleted_count = await service.bulk_delete(payload.ids, privileged=_is_privileged(current_user))
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