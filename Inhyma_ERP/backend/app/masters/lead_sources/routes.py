"""Lead Sources Routes. Standard CRUD + activate/deactivate + import/export, with audit logging."""

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
from app.masters.lead_sources.dependencies import get_lead_source_service
from app.masters.lead_sources.models import LeadSource
from app.masters.lead_sources.schemas import (
    ImportSummaryRead,
    LeadSourceCreate,
    LeadSourceLookup,
    LeadSourceRead,
    LeadSourceUpdate,
)
from app.masters.lead_sources.service import LeadSourceService
from app.rbac.dependencies import require_permission

router = APIRouter(tags=["Masters - Lead Sources"])


class BulkActionRequest(BaseModel):
    """Payload for bulk actions on lead sources."""

    ids: list[uuid.UUID]
    action: str


def _to_read(item: LeadSource) -> dict:
    """Serialize LeadSource model to LeadSourceRead dictionary."""
    read = LeadSourceRead(
        id=item.id,
        name=item.name,
        status=item.status,
        created_at=item.created_at,
        updated_at=item.updated_at,
        version=item.version,
    )
    return read.model_dump(mode="json")


async def _publish_lead_source_event(
    *,
    db: AsyncSession,
    dispatcher: EventDispatcher,
    event_type: str,
    source_id: uuid.UUID | str,
    user_id: uuid.UUID,
    changes: dict,
) -> None:
    """Commit ``db``, then publish a ``lead_source.*`` live event on ``module:lead_sources``."""
    await dispatcher.publish_lifecycle_event(
        db,
        module="lead_sources",
        entity="lead_source",
        entity_id=source_id,
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
    """Shared helper: record a lead source action and mark the request as logged."""
    await audit_service.record(
        action=action,
        module="masters.lead_sources",
        user_id=actor.id,
        username_snapshot=actor.username,
        entity_type="LeadSource",
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


@router.post("", status_code=status.HTTP_201_CREATED, summary="Create a lead source entry")
async def create_lead_source(
    payload: LeadSourceCreate,
    request: Request,
    service: LeadSourceService = Depends(get_lead_source_service),
    current_user: CurrentUser = Depends(require_permission("lead_source.create")),
    audit_service: AuditService = Depends(get_audit_service),
    db: AsyncSession = Depends(get_db_session),
    dispatcher: EventDispatcher = Depends(get_event_dispatcher),
) -> dict:
    """Create a new lead source with audit logging and live event broadcast."""
    item = await service.create(**payload.model_dump())
    item_read = _to_read(item)
    await _record_action(
        audit_service=audit_service,
        request=request,
        action=AuditAction.CREATE,
        actor=current_user,
        entity_id=item.id,
        description=f"Created lead source '{item.name}'",
        new_values=item_read,
    )
    await _publish_lead_source_event(
        db=db,
        dispatcher=dispatcher,
        event_type="created",
        source_id=item.id,
        user_id=current_user.id,
        changes=item_read,
    )
    return build_success_response(
        data=item_read,
        message="Lead source created successfully.",
        request_id=request.state.request_id,
    )


@router.get("", summary="List lead source entries")
async def list_lead_sources(
    request: Request,
    query_params: ListQueryParams = Depends(get_list_query_params),
    service: LeadSourceService = Depends(get_lead_source_service),
    current_user: CurrentUser = Depends(require_permission("lead_source.view")),
) -> dict:
    """Return a paginated list of lead source entries."""
    items, total = await service.list_paginated(query_params)
    meta = PageMeta.build(page=query_params.page.page, page_size=query_params.page.page_size, total_records=total).as_meta_dict()
    data = [_to_read(i) for i in items]
    return build_success_response(data=data, meta=meta, request_id=request.state.request_id)


@router.get("/lookup", summary="List active lead sources for select dropdowns")
async def lookup_lead_sources(
    request: Request,
    service: LeadSourceService = Depends(get_lead_source_service),
    current_user: CurrentUser = Depends(require_permission("lead_source.view")),
) -> dict:
    """Return cached minimal lead source list for dropdown selectors."""
    items = await service.list_all_cached()
    data = [LeadSourceLookup.model_validate(i).model_dump(mode="json") for i in items]
    return build_success_response(data=data, request_id=request.state.request_id)


@router.get("/export", summary="Export lead sources master data to CSV or Excel")
async def export_lead_sources(
    format: str = "csv",
    service: LeadSourceService = Depends(get_lead_source_service),
    current_user: CurrentUser = Depends(require_permission("lead_source.export")),
) -> Response:
    """Stream an exported file containing all lead source records."""
    fmt = format.lower().strip()
    if fmt not in ("csv", "xlsx", "excel"):
        fmt = "csv"
    norm_fmt = "xlsx" if fmt in ("xlsx", "excel") else "csv"
    raw = await service.export_file(norm_fmt)
    if norm_fmt == "csv":
        return Response(
            content=raw,
            media_type="text/csv",
            headers={"Content-Disposition": 'attachment; filename="lead_sources.csv"'},
        )
    return Response(
        content=raw,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="lead_sources.xlsx"'},
    )


@router.post("/import", summary="Import lead source records from CSV or Excel")
async def import_lead_sources(
    request: Request,
    file: UploadFile = File(...),
    service: LeadSourceService = Depends(get_lead_source_service),
    current_user: CurrentUser = Depends(require_permission("lead_source.import")),
    audit_service: AuditService = Depends(get_audit_service),
    db: AsyncSession = Depends(get_db_session),
    dispatcher: EventDispatcher = Depends(get_event_dispatcher),
) -> dict:
    """Bulk-import lead source records from an uploaded file."""
    raw_bytes = await file.read()
    summary = await service.import_file(file.filename or "import.csv", raw_bytes)
    summary_dict = summary.to_dict()
    await _record_action(
        audit_service=audit_service,
        request=request,
        action=AuditAction.BULK_IMPORT,
        actor=current_user,
        entity_id="bulk",
        description=f"Imported {summary.imported_rows} lead source entries from file '{file.filename}'",
        new_values=summary_dict,
    )
    if summary.imported_rows > 0:
        await _publish_lead_source_event(
            db=db,
            dispatcher=dispatcher,
            event_type="imported",
            source_id="bulk",
            user_id=current_user.id,
            changes={"imported_rows": summary.imported_rows},
        )
    return build_success_response(
        data=ImportSummaryRead(**summary_dict).model_dump(),
        message=f"Import complete: {summary.imported_rows} added, {summary.duplicate_rows} duplicates, {summary.error_rows} errors.",
        request_id=request.state.request_id,
    )


@router.post("/bulk", summary="Perform bulk operations on multiple lead sources")
async def bulk_action_lead_sources(
    payload: BulkActionRequest,
    request: Request,
    service: LeadSourceService = Depends(get_lead_source_service),
    current_user: CurrentUser = Depends(require_permission("lead_source.bulk_action")),
    audit_service: AuditService = Depends(get_audit_service),
    db: AsyncSession = Depends(get_db_session),
    dispatcher: EventDispatcher = Depends(get_event_dispatcher),
) -> dict:
    """Apply activate/deactivate/delete to a list of lead source IDs."""
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
        description=f"Bulk {action} applied to {count} lead sources",
    )
    await _publish_lead_source_event(
        db=db,
        dispatcher=dispatcher,
        event_type=f"bulk_{action}",
        source_id="bulk",
        user_id=current_user.id,
        changes={"count": count, "action": action},
    )
    return build_success_response(
        data={"affected": count},
        message=f"Bulk {action} applied to {count} records.",
        request_id=request.state.request_id,
    )


@router.get("/{source_id}", summary="Get a lead source entry by ID")
async def get_lead_source(
    source_id: uuid.UUID,
    request: Request,
    service: LeadSourceService = Depends(get_lead_source_service),
    current_user: CurrentUser = Depends(require_permission("lead_source.view")),
) -> dict:
    """Retrieve a single lead source record."""
    item = await service.get_by_id_or_raise(source_id)
    return build_success_response(data=_to_read(item), request_id=request.state.request_id)


@router.put("/{source_id}", summary="Update a lead source entry")
async def update_lead_source(
    source_id: uuid.UUID,
    payload: LeadSourceUpdate,
    request: Request,
    service: LeadSourceService = Depends(get_lead_source_service),
    current_user: CurrentUser = Depends(require_permission("lead_source.update")),
    audit_service: AuditService = Depends(get_audit_service),
    db: AsyncSession = Depends(get_db_session),
    dispatcher: EventDispatcher = Depends(get_event_dispatcher),
) -> dict:
    """Update lead source fields with audit logging and live event broadcast."""
    item = await service.update(source_id, **payload.model_dump(exclude_unset=True))
    item_read = _to_read(item)
    await _record_action(
        audit_service=audit_service,
        request=request,
        action=AuditAction.UPDATE,
        actor=current_user,
        entity_id=source_id,
        description=f"Updated lead source '{item.name}'",
        new_values=item_read,
    )
    await _publish_lead_source_event(
        db=db,
        dispatcher=dispatcher,
        event_type="updated",
        source_id=source_id,
        user_id=current_user.id,
        changes=item_read,
    )
    return build_success_response(
        data=item_read,
        message="Lead source updated successfully.",
        request_id=request.state.request_id,
    )


@router.patch("/{source_id}/activate", summary="Activate a lead source entry")
async def activate_lead_source(
    source_id: uuid.UUID,
    request: Request,
    service: LeadSourceService = Depends(get_lead_source_service),
    current_user: CurrentUser = Depends(require_permission("lead_source.update")),
    audit_service: AuditService = Depends(get_audit_service),
    db: AsyncSession = Depends(get_db_session),
    dispatcher: EventDispatcher = Depends(get_event_dispatcher),
) -> dict:
    """Set lead source status to ACTIVE."""
    item = await service.activate(source_id)
    item_read = _to_read(item)
    await _record_action(
        audit_service=audit_service,
        request=request,
        action=AuditAction.UPDATE,
        actor=current_user,
        entity_id=source_id,
        description=f"Activated lead source '{item.name}'",
        new_values={"status": item.status.value},
    )
    await _publish_lead_source_event(
        db=db,
        dispatcher=dispatcher,
        event_type="activated",
        source_id=source_id,
        user_id=current_user.id,
        changes=item_read,
    )
    return build_success_response(data=item_read, message="Lead source activated.", request_id=request.state.request_id)


@router.patch("/{source_id}/deactivate", summary="Deactivate a lead source entry")
async def deactivate_lead_source(
    source_id: uuid.UUID,
    request: Request,
    service: LeadSourceService = Depends(get_lead_source_service),
    current_user: CurrentUser = Depends(require_permission("lead_source.update")),
    audit_service: AuditService = Depends(get_audit_service),
    db: AsyncSession = Depends(get_db_session),
    dispatcher: EventDispatcher = Depends(get_event_dispatcher),
) -> dict:
    """Set lead source status to INACTIVE."""
    item = await service.deactivate(source_id)
    item_read = _to_read(item)
    await _record_action(
        audit_service=audit_service,
        request=request,
        action=AuditAction.UPDATE,
        actor=current_user,
        entity_id=source_id,
        description=f"Deactivated lead source '{item.name}'",
        new_values={"status": item.status.value},
    )
    await _publish_lead_source_event(
        db=db,
        dispatcher=dispatcher,
        event_type="deactivated",
        source_id=source_id,
        user_id=current_user.id,
        changes=item_read,
    )
    return build_success_response(data=item_read, message="Lead source deactivated.", request_id=request.state.request_id)


@router.delete("/{source_id}", status_code=status.HTTP_200_OK, summary="Soft-delete a lead source entry")
async def delete_lead_source(
    source_id: uuid.UUID,
    request: Request,
    service: LeadSourceService = Depends(get_lead_source_service),
    current_user: CurrentUser = Depends(require_permission("lead_source.delete")),
    audit_service: AuditService = Depends(get_audit_service),
    db: AsyncSession = Depends(get_db_session),
    dispatcher: EventDispatcher = Depends(get_event_dispatcher),
) -> dict:
    """Soft-delete a lead source record."""
    item = await service.get_by_id_or_raise(source_id)
    name = item.name
    await service.delete(source_id)
    await _record_action(
        audit_service=audit_service,
        request=request,
        action=AuditAction.DELETE,
        actor=current_user,
        entity_id=source_id,
        description=f"Deleted lead source '{name}'",
    )
    await _publish_lead_source_event(
        db=db,
        dispatcher=dispatcher,
        event_type="deleted",
        source_id=source_id,
        user_id=current_user.id,
        changes={"name": name},
    )
    return build_success_response(data={"id": str(source_id)}, message="Lead source deleted.", request_id=request.state.request_id)
