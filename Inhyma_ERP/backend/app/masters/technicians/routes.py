"""Technician Routes. Standard CRUD + activate/deactivate + import/export, with audit logging."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, File, Request, UploadFile, status
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.audit.constants import AuditAction
from app.audit.dependencies import get_audit_service
from app.audit.service import AuditService
from app.auth.dependencies import get_current_user
from app.auth.service import CurrentUser
from app.common.list_query import ListQueryParams, get_list_query_params
from app.common.pagination import PageMeta
from app.core.responses import build_success_response
from app.database.session import get_db_session
from app.events.dependencies import get_event_dispatcher
from app.events.dispatcher import EventDispatcher
from app.masters.technicians.dependencies import get_technician_service
from app.masters.technicians.models import Technician
from app.masters.technicians.schemas import (
    ImportSummaryRead,
    TechnicianCreate,
    TechnicianLookup,
    TechnicianRead,
    TechnicianUpdate,
)
from app.masters.technicians.service import TechnicianService
from app.rbac.dependencies import require_permission

router = APIRouter(prefix="/masters/technicians", tags=["Masters - Technicians"])


def _to_read(item: Technician) -> dict:
    """Serialize Technician model to TechnicianRead dictionary."""
    read = TechnicianRead(
        id=item.id,
        name=item.name,
        mobile=item.mobile,
        city=item.city,
        status=item.status,
        created_at=item.created_at,
        updated_at=item.updated_at,
        version=item.version,
    )
    return read.model_dump(mode="json")


async def _publish_technician_event(
    *,
    db: AsyncSession,
    dispatcher: EventDispatcher,
    event_type: str,
    technician_id: uuid.UUID | str,
    user_id: uuid.UUID,
    changes: dict,
) -> None:
    """Commit ``db``, then publish a ``technician.*`` live event on ``module:technicians``."""
    await dispatcher.publish_lifecycle_event(
        db,
        module="technicians",
        entity="technician",
        entity_id=technician_id,
        event_type=event_type,
        version=None,
        user_id=user_id,
        changes=changes,
    )


async def _record_action(
    *,
    audit_service: AuditService,
    request: Request,
    action: AuditAction,
    actor: CurrentUser,
    entity_id: uuid.UUID | str,
    description: str,
    new_values: dict | None = None,
) -> None:
    """Shared helper: record a technician action and mark the request as logged."""
    await audit_service.record(
        action=action,
        module="masters.technicians",
        user_id=actor.id,
        username_snapshot=actor.username,
        entity_type="Technician",
        entity_id=str(entity_id),
        new_values=new_values,
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
        request_id=request.state.request_id,
        http_method=request.method,
        endpoint=request.url.path,
        response_status=status.HTTP_200_OK,
        description=description,
    )
    request.state.audit_logged = True


@router.post("", status_code=status.HTTP_201_CREATED, summary="Create a technician entry")
async def create_technician(
    payload: TechnicianCreate,
    request: Request,
    service: TechnicianService = Depends(get_technician_service),
    current_user: CurrentUser = Depends(require_permission("technician.create")),
    audit_service: AuditService = Depends(get_audit_service),
    db: AsyncSession = Depends(get_db_session),
    dispatcher: EventDispatcher = Depends(get_event_dispatcher),
) -> dict:
    """Create a new technician platform entry."""
    item = await service.create(**payload.model_dump())
    data = _to_read(item)
    await _record_action(
        audit_service=audit_service,
        request=request,
        action=AuditAction.CREATE,
        actor=current_user,
        entity_id=item.id,
        description=f"Created technician {item.name!r}.",
        new_values=data,
    )
    await _publish_technician_event(
        db=db,
        dispatcher=dispatcher,
        event_type="technician.created",
        technician_id=item.id,
        user_id=current_user.id,
        changes=data,
    )
    return build_success_response(data=data, request_id=request.state.request_id, message="Technician created successfully.")


@router.get("", summary="List technicians with pagination and filters")
async def list_technicians(
    request: Request,
    query_params: ListQueryParams = Depends(get_list_query_params),
    service: TechnicianService = Depends(get_technician_service),
    current_user: CurrentUser = Depends(require_permission("technician.view")),
) -> dict:
    """Return a paginated list of technician entries."""
    items, total = await service.list_paginated(query_params)
    meta = PageMeta.build(page=query_params.page.page, page_size=query_params.page.page_size, total_records=total).as_meta_dict()
    data = [_to_read(i) for i in items]
    return build_success_response(data=data, meta=meta, request_id=request.state.request_id)


@router.get("/lookup", summary="List active technicians for select dropdowns")
async def lookup_technicians(
    request: Request,
    service: TechnicianService = Depends(get_technician_service),
    current_user: CurrentUser = Depends(require_permission("technician.view")),
) -> dict:
    """Return cached minimal technician list for dropdown selectors."""
    items = await service.list_all_cached()
    data = [TechnicianLookup.model_validate(i).model_dump(mode="json") for i in items]
    return build_success_response(data=data, request_id=request.state.request_id)


@router.get("/export", summary="Export technician master data to CSV or Excel")
async def export_technicians(
    format: str = "csv",
    service: TechnicianService = Depends(get_technician_service),
    current_user: CurrentUser = Depends(require_permission("technician.export")),
) -> Response:
    """Stream an exported file containing all technician records."""
    fmt = format.lower().strip()
    if fmt not in ("csv", "xlsx", "excel"):
        fmt = "csv"
    norm_fmt = "xlsx" if fmt in ("xlsx", "excel") else "csv"
    raw = await service.export_file(norm_fmt)
    if norm_fmt == "csv":
        return Response(
            content=raw,
            media_type="text/csv",
            headers={"Content-Disposition": 'attachment; filename="technicians.csv"'},
        )
    return Response(
        content=raw,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="technicians.xlsx"'},
    )


@router.post("/import", summary="Import technician records from CSV or Excel")
async def import_technicians(
    request: Request,
    file: UploadFile = File(...),
    service: TechnicianService = Depends(get_technician_service),
    current_user: CurrentUser = Depends(require_permission("technician.import")),
    audit_service: AuditService = Depends(get_audit_service),
) -> dict:
    """Bulk-import technician records from a CSV or XLSX file."""
    raw = await file.read()
    filename = file.filename or "upload.csv"
    summary = await service.import_file(filename, raw)
    data = ImportSummaryRead.model_validate(summary.__dict__).model_dump(mode="json")
    await _record_action(
        audit_service=audit_service,
        request=request,
        action=AuditAction.IMPORT,
        actor=current_user,
        entity_id="bulk",
        description=f"Imported technician file {filename!r}: {summary.created} created, {summary.failed} failed.",
        new_values=data,
    )
    return build_success_response(data=data, request_id=request.state.request_id, message="Import completed.")


@router.get("/{technician_id}", summary="Get a technician by ID")
async def get_technician(
    technician_id: uuid.UUID,
    request: Request,
    service: TechnicianService = Depends(get_technician_service),
    current_user: CurrentUser = Depends(require_permission("technician.view")),
) -> dict:
    """Fetch details of a single technician record."""
    item = await service.get_by_id_or_raise(technician_id)
    return build_success_response(data=_to_read(item), request_id=request.state.request_id)


@router.put("/{technician_id}", summary="Update a technician entry")
async def update_technician(
    technician_id: uuid.UUID,
    payload: TechnicianUpdate,
    request: Request,
    service: TechnicianService = Depends(get_technician_service),
    current_user: CurrentUser = Depends(require_permission("technician.update")),
    audit_service: AuditService = Depends(get_audit_service),
    db: AsyncSession = Depends(get_db_session),
    dispatcher: EventDispatcher = Depends(get_event_dispatcher),
) -> dict:
    """Update fields of an existing technician."""
    item = await service.update(technician_id, **payload.model_dump(exclude_unset=True))
    data = _to_read(item)
    await _record_action(
        audit_service=audit_service,
        request=request,
        action=AuditAction.UPDATE,
        actor=current_user,
        entity_id=technician_id,
        description=f"Updated technician {item.name!r}.",
        new_values=data,
    )
    await _publish_technician_event(
        db=db,
        dispatcher=dispatcher,
        event_type="technician.updated",
        technician_id=technician_id,
        user_id=current_user.id,
        changes=data,
    )
    return build_success_response(data=data, request_id=request.state.request_id, message="Technician updated successfully.")


@router.patch("/{technician_id}/activate", summary="Activate a technician")
async def activate_technician(
    technician_id: uuid.UUID,
    request: Request,
    service: TechnicianService = Depends(get_technician_service),
    current_user: CurrentUser = Depends(require_permission("technician.update")),
    audit_service: AuditService = Depends(get_audit_service),
    db: AsyncSession = Depends(get_db_session),
    dispatcher: EventDispatcher = Depends(get_event_dispatcher),
) -> dict:
    """Mark a technician as active."""
    item = await service.activate(technician_id)
    data = _to_read(item)
    await _record_action(
        audit_service=audit_service,
        request=request,
        action=AuditAction.UPDATE,
        actor=current_user,
        entity_id=technician_id,
        description=f"Activated technician {item.name!r}.",
        new_values={"status": item.status.value},
    )
    await _publish_technician_event(
        db=db,
        dispatcher=dispatcher,
        event_type="technician.activated",
        technician_id=technician_id,
        user_id=current_user.id,
        changes={"status": item.status.value},
    )
    return build_success_response(data=data, request_id=request.state.request_id, message="Technician activated successfully.")


@router.patch("/{technician_id}/deactivate", summary="Deactivate a technician")
async def deactivate_technician(
    technician_id: uuid.UUID,
    request: Request,
    service: TechnicianService = Depends(get_technician_service),
    current_user: CurrentUser = Depends(require_permission("technician.update")),
    audit_service: AuditService = Depends(get_audit_service),
    db: AsyncSession = Depends(get_db_session),
    dispatcher: EventDispatcher = Depends(get_event_dispatcher),
) -> dict:
    """Mark a technician as inactive."""
    item = await service.deactivate(technician_id)
    data = _to_read(item)
    await _record_action(
        audit_service=audit_service,
        request=request,
        action=AuditAction.UPDATE,
        actor=current_user,
        entity_id=technician_id,
        description=f"Deactivated technician {item.name!r}.",
        new_values={"status": item.status.value},
    )
    await _publish_technician_event(
        db=db,
        dispatcher=dispatcher,
        event_type="technician.deactivated",
        technician_id=technician_id,
        user_id=current_user.id,
        changes={"status": item.status.value},
    )
    return build_success_response(data=data, request_id=request.state.request_id, message="Technician deactivated successfully.")


@router.delete("/{technician_id}", summary="Soft-delete a technician")
async def delete_technician(
    technician_id: uuid.UUID,
    request: Request,
    service: TechnicianService = Depends(get_technician_service),
    current_user: CurrentUser = Depends(require_permission("technician.delete")),
    audit_service: AuditService = Depends(get_audit_service),
    db: AsyncSession = Depends(get_db_session),
    dispatcher: EventDispatcher = Depends(get_event_dispatcher),
) -> dict:
    """Soft-delete a technician record."""
    await service.delete(technician_id)
    await _record_action(
        audit_service=audit_service,
        request=request,
        action=AuditAction.DELETE,
        actor=current_user,
        entity_id=technician_id,
        description=f"Deleted technician {technician_id}.",
    )
    await _publish_technician_event(
        db=db,
        dispatcher=dispatcher,
        event_type="technician.deleted",
        technician_id=technician_id,
        user_id=current_user.id,
        changes={"deleted": True},
    )
    return build_success_response(data={"id": str(technician_id)}, request_id=request.state.request_id, message="Resource deleted successfully.")


@router.post("/bulk-status", summary="Bulk activate/deactivate technicians")
async def bulk_status(
    payload: dict,
    request: Request,
    service: TechnicianService = Depends(get_technician_service),
    current_user: CurrentUser = Depends(require_permission("technician.bulk_action")),
    audit_service: AuditService = Depends(get_audit_service),
) -> dict:
    """Bulk update status for a list of technician IDs."""
    ids = payload.get("ids", [])
    target_status = payload.get("status", "active").lower()
    updated = 0
    for id_str in ids:
        try:
            cid = uuid.UUID(id_str)
            if target_status == "active":
                await service.activate(cid)
            else:
                await service.deactivate(cid)
            updated += 1
        except Exception:
            continue
    await _record_action(
        audit_service=audit_service,
        request=request,
        action=AuditAction.UPDATE,
        actor=current_user,
        entity_id="bulk",
        description=f"Bulk {target_status} applied to {updated} technician records.",
    )
    return build_success_response(data={"updated": updated}, request_id=request.state.request_id, message=f"{updated} records updated.")


@router.post("/bulk-delete", summary="Bulk delete technicians")
async def bulk_delete(
    payload: dict,
    request: Request,
    service: TechnicianService = Depends(get_technician_service),
    current_user: CurrentUser = Depends(require_permission("technician.bulk_action")),
    audit_service: AuditService = Depends(get_audit_service),
) -> dict:
    """Bulk soft-delete for a list of technician IDs."""
    ids = payload.get("ids", [])
    deleted = 0
    for id_str in ids:
        try:
            cid = uuid.UUID(id_str)
            await service.delete(cid)
            deleted += 1
        except Exception:
            continue
    await _record_action(
        audit_service=audit_service,
        request=request,
        action=AuditAction.DELETE,
        actor=current_user,
        entity_id="bulk",
        description=f"Bulk deleted {deleted} technician records.",
    )
    return build_success_response(data={"deleted": deleted}, request_id=request.state.request_id, message=f"{deleted} records deleted.")
