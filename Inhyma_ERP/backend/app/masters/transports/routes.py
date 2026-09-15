"""Transport Routes. Standard CRUD + activate/deactivate + import/export, with audit logging."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, File, Request, UploadFile, status
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.audit.constants import AuditAction
from app.audit.dependencies import get_audit_service
from app.audit.service import AuditService
from app.auth.service import CurrentUser
from app.common.list_query import ListQueryParams, get_list_query_params
from app.common.pagination import PageMeta
from app.core.exceptions import BadRequestException
from app.core.responses import build_success_response
from app.database.session import get_db_session
from app.events.dependencies import get_event_dispatcher
from app.events.dispatcher import EventDispatcher
from app.masters.transports.dependencies import get_transport_service
from app.masters.transports.models import Transport
from app.masters.transports.schemas import (
    ImportSummaryRead,
    TransportCreate,
    TransportLookup,
    TransportRead,
    TransportUpdate,
)
from app.masters.transports.service import TransportService
from app.rbac.dependencies import require_permission

router = APIRouter(tags=["Masters - Transports"])


class BulkActionRequest(BaseModel):
    """Payload for bulk actions on transports."""

    ids: list[uuid.UUID]
    action: str


def _to_read(item: Transport) -> dict:
    """Serialize Transport model to TransportRead dictionary."""
    read = TransportRead(
        id=item.id,
        name=item.name,
        gst_number=item.gst_number,
        mobile=item.mobile,
        status=item.status,
        created_at=item.created_at,
        updated_at=item.updated_at,
        version=item.version,
    )
    return read.model_dump(mode="json")


async def _publish_transport_event(
    *,
    db: AsyncSession,
    dispatcher: EventDispatcher,
    event_type: str,
    transport_id: uuid.UUID | str,
    user_id: uuid.UUID,
    changes: dict,
) -> None:
    """Commit ``db``, then publish a ``transport.*`` live event on ``module:transports``."""
    await dispatcher.publish_lifecycle_event(
        db,
        module="transports",
        entity="transport",
        entity_id=transport_id,
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
    """Shared helper: record a transport action and mark the request as logged."""
    await audit_service.record(
        action=action,
        module="masters.transports",
        user_id=actor.id,
        username_snapshot=actor.username,
        entity_type="Transport",
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


@router.post("", status_code=status.HTTP_201_CREATED, summary="Create a transport entry")
async def create_transport(
    payload: TransportCreate,
    request: Request,
    service: TransportService = Depends(get_transport_service),
    current_user: CurrentUser = Depends(require_permission("transport.create")),
    audit_service: AuditService = Depends(get_audit_service),
    db: AsyncSession = Depends(get_db_session),
    dispatcher: EventDispatcher = Depends(get_event_dispatcher),
) -> dict:
    """Create a new transport with audit logging and live event broadcast."""
    item = await service.create(**payload.model_dump())
    item_read = _to_read(item)
    await _record_action(
        audit_service=audit_service,
        request=request,
        action=AuditAction.CREATE,
        actor=current_user,
        entity_id=item.id,
        description=f"Created transport '{item.name}'",
        new_values=item_read,
    )
    await _publish_transport_event(
        db=db,
        dispatcher=dispatcher,
        event_type="created",
        transport_id=item.id,
        user_id=current_user.id,
        changes=item_read,
    )
    return build_success_response(
        data=item_read,
        message="Transport created successfully.",
        request_id=request.state.request_id,
    )


@router.get("", summary="List transport entries")
async def list_transports(
    request: Request,
    query_params: ListQueryParams = Depends(get_list_query_params),
    service: TransportService = Depends(get_transport_service),
    current_user: CurrentUser = Depends(require_permission("transport.view")),
) -> dict:
    """Return a paginated list of transport entries."""
    items, total = await service.list_paginated(query_params)
    meta = PageMeta.build(page=query_params.page.page, page_size=query_params.page.page_size, total_records=total).as_meta_dict()
    data = [_to_read(i) for i in items]
    return build_success_response(data=data, meta=meta, request_id=request.state.request_id)


@router.get("/lookup", summary="List active transports for select dropdowns")
async def lookup_transports(
    request: Request,
    service: TransportService = Depends(get_transport_service),
    current_user: CurrentUser = Depends(require_permission("transport.view")),
) -> dict:
    """Return cached minimal transport list for dropdown selectors."""
    items = await service.list_all_cached()
    data = [TransportLookup.model_validate(i).model_dump(mode="json") for i in items]
    return build_success_response(data=data, request_id=request.state.request_id)


@router.get("/export", summary="Export transport master data to CSV or Excel")
async def export_transports(
    format: str = "csv",
    service: TransportService = Depends(get_transport_service),
    current_user: CurrentUser = Depends(require_permission("transport.export")),
) -> Response:
    """Stream an exported file containing all transport records."""
    fmt = format.lower().strip()
    if fmt not in ("csv", "xlsx", "excel"):
        fmt = "csv"
    norm_fmt = "xlsx" if fmt in ("xlsx", "excel") else "csv"
    raw = await service.export_file(norm_fmt)
    if norm_fmt == "csv":
        return Response(
            content=raw,
            media_type="text/csv",
            headers={"Content-Disposition": 'attachment; filename="transports.csv"'},
        )
    return Response(
        content=raw,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="transports.xlsx"'},
    )


@router.post("/import", summary="Import transport records from CSV or Excel")
async def import_transports(
    request: Request,
    file: UploadFile = File(...),
    service: TransportService = Depends(get_transport_service),
    current_user: CurrentUser = Depends(require_permission("transport.import")),
    audit_service: AuditService = Depends(get_audit_service),
    db: AsyncSession = Depends(get_db_session),
    dispatcher: EventDispatcher = Depends(get_event_dispatcher),
) -> dict:
    """Bulk-import transport records from an uploaded file."""
    raw_bytes = await file.read()
    summary = await service.import_file(file.filename or "import.csv", raw_bytes)
    summary_dict = summary.to_dict()
    await _record_action(
        audit_service=audit_service,
        request=request,
        action=AuditAction.BULK_IMPORT,
        actor=current_user,
        entity_id="bulk",
        description=f"Imported {summary.imported_rows} transport entries from file '{file.filename}'",
        new_values=summary_dict,
    )
    if summary.imported_rows > 0:
        await _publish_transport_event(
            db=db,
            dispatcher=dispatcher,
            event_type="imported",
            transport_id="bulk",
            user_id=current_user.id,
            changes={"imported_rows": summary.imported_rows},
        )
    return build_success_response(
        data=ImportSummaryRead(**summary_dict).model_dump(),
        message=f"Import complete: {summary.imported_rows} added, {summary.duplicate_rows} duplicates, {summary.error_rows} errors.",
        request_id=request.state.request_id,
    )


@router.post("/bulk", summary="Perform bulk operations on multiple transports")
async def bulk_action_transports(
    payload: BulkActionRequest,
    request: Request,
    service: TransportService = Depends(get_transport_service),
    current_user: CurrentUser = Depends(require_permission("transport.bulk_action")),
    audit_service: AuditService = Depends(get_audit_service),
    db: AsyncSession = Depends(get_db_session),
    dispatcher: EventDispatcher = Depends(get_event_dispatcher),
) -> dict:
    """Apply activate/deactivate/delete to a list of transport IDs."""
    action = payload.action.lower().strip()
    if action not in ("activate", "deactivate", "delete"):
        raise BadRequestException(f"Unsupported bulk action '{payload.action}'. Supported: activate, deactivate, delete.")

    count = 0
    for tid in payload.ids:
        try:
            if action == "activate":
                await service.activate(tid)
            elif action == "deactivate":
                await service.deactivate(tid)
            elif action == "delete":
                await service.delete(tid)
            count += 1
        except Exception:
            continue

    await _record_action(
        audit_service=audit_service,
        request=request,
        action=AuditAction.BULK_UPDATE if action != "delete" else AuditAction.BULK_DELETE,
        actor=current_user,
        entity_id="bulk",
        description=f"Bulk {action} applied to {count} transports",
    )
    await _publish_transport_event(
        db=db,
        dispatcher=dispatcher,
        event_type=f"bulk_{action}",
        transport_id="bulk",
        user_id=current_user.id,
        changes={"count": count, "action": action},
    )
    return build_success_response(
        data={"affected": count},
        message=f"Bulk {action} applied to {count} records.",
        request_id=request.state.request_id,
    )


@router.get("/{transport_id}", summary="Get a transport entry by ID")
async def get_transport(
    transport_id: uuid.UUID,
    request: Request,
    service: TransportService = Depends(get_transport_service),
    current_user: CurrentUser = Depends(require_permission("transport.view")),
) -> dict:
    """Retrieve a single transport record."""
    item = await service.get_by_id_or_raise(transport_id)
    return build_success_response(data=_to_read(item), request_id=request.state.request_id)


@router.put("/{transport_id}", summary="Update a transport entry")
async def update_transport(
    transport_id: uuid.UUID,
    payload: TransportUpdate,
    request: Request,
    service: TransportService = Depends(get_transport_service),
    current_user: CurrentUser = Depends(require_permission("transport.update")),
    audit_service: AuditService = Depends(get_audit_service),
    db: AsyncSession = Depends(get_db_session),
    dispatcher: EventDispatcher = Depends(get_event_dispatcher),
) -> dict:
    """Update transport fields with audit logging and live event broadcast."""
    item = await service.update(transport_id, **payload.model_dump(exclude_unset=True))
    item_read = _to_read(item)
    await _record_action(
        audit_service=audit_service,
        request=request,
        action=AuditAction.UPDATE,
        actor=current_user,
        entity_id=transport_id,
        description=f"Updated transport '{item.name}'",
        new_values=item_read,
    )
    await _publish_transport_event(
        db=db,
        dispatcher=dispatcher,
        event_type="updated",
        transport_id=transport_id,
        user_id=current_user.id,
        changes=item_read,
    )
    return build_success_response(
        data=item_read,
        message="Transport updated successfully.",
        request_id=request.state.request_id,
    )


@router.patch("/{transport_id}/activate", summary="Activate a transport entry")
async def activate_transport(
    transport_id: uuid.UUID,
    request: Request,
    service: TransportService = Depends(get_transport_service),
    current_user: CurrentUser = Depends(require_permission("transport.update")),
    audit_service: AuditService = Depends(get_audit_service),
    db: AsyncSession = Depends(get_db_session),
    dispatcher: EventDispatcher = Depends(get_event_dispatcher),
) -> dict:
    """Set transport status to ACTIVE."""
    item = await service.activate(transport_id)
    item_read = _to_read(item)
    await _record_action(
        audit_service=audit_service,
        request=request,
        action=AuditAction.UPDATE,
        actor=current_user,
        entity_id=transport_id,
        description=f"Activated transport '{item.name}'",
        new_values={"status": item.status.value},
    )
    await _publish_transport_event(
        db=db,
        dispatcher=dispatcher,
        event_type="activated",
        transport_id=transport_id,
        user_id=current_user.id,
        changes=item_read,
    )
    return build_success_response(data=item_read, message="Transport activated.", request_id=request.state.request_id)


@router.patch("/{transport_id}/deactivate", summary="Deactivate a transport entry")
async def deactivate_transport(
    transport_id: uuid.UUID,
    request: Request,
    service: TransportService = Depends(get_transport_service),
    current_user: CurrentUser = Depends(require_permission("transport.update")),
    audit_service: AuditService = Depends(get_audit_service),
    db: AsyncSession = Depends(get_db_session),
    dispatcher: EventDispatcher = Depends(get_event_dispatcher),
) -> dict:
    """Set transport status to INACTIVE."""
    item = await service.deactivate(transport_id)
    item_read = _to_read(item)
    await _record_action(
        audit_service=audit_service,
        request=request,
        action=AuditAction.UPDATE,
        actor=current_user,
        entity_id=transport_id,
        description=f"Deactivated transport '{item.name}'",
        new_values={"status": item.status.value},
    )
    await _publish_transport_event(
        db=db,
        dispatcher=dispatcher,
        event_type="deactivated",
        transport_id=transport_id,
        user_id=current_user.id,
        changes=item_read,
    )
    return build_success_response(data=item_read, message="Transport deactivated.", request_id=request.state.request_id)


@router.delete("/{transport_id}", status_code=status.HTTP_200_OK, summary="Soft-delete a transport entry")
async def delete_transport(
    transport_id: uuid.UUID,
    request: Request,
    service: TransportService = Depends(get_transport_service),
    current_user: CurrentUser = Depends(require_permission("transport.delete")),
    audit_service: AuditService = Depends(get_audit_service),
    db: AsyncSession = Depends(get_db_session),
    dispatcher: EventDispatcher = Depends(get_event_dispatcher),
) -> dict:
    """Soft-delete a transport record."""
    item = await service.get_by_id_or_raise(transport_id)
    name = item.name
    await service.delete(transport_id)
    await _record_action(
        audit_service=audit_service,
        request=request,
        action=AuditAction.DELETE,
        actor=current_user,
        entity_id=transport_id,
        description=f"Deleted transport '{name}'",
    )
    await _publish_transport_event(
        db=db,
        dispatcher=dispatcher,
        event_type="deleted",
        transport_id=transport_id,
        user_id=current_user.id,
        changes={"name": name},
    )
    return build_success_response(data={"id": str(transport_id)}, message="Transport deleted.", request_id=request.state.request_id)
