"""Company Sectors Routes. Standard CRUD + activate/deactivate + import/export, with audit logging."""

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
from app.masters.company_sectors.dependencies import get_company_sector_service
from app.masters.company_sectors.schemas import (
    CompanySectorCreate,
    CompanySectorRead,
    CompanySectorUpdate,
    ImportSummaryRead,
)
from app.masters.company_sectors.service import CompanySectorService
from app.rbac.dependencies import require_permission

router = APIRouter(prefix="/masters/company-sectors", tags=["Masters - Company Sectors"])


async def _publish_company_sector_event(
    *,
    db: AsyncSession,
    dispatcher: EventDispatcher,
    event_type: str,
    company_sector_id: uuid.UUID | str,
    user_id: uuid.UUID,
    changes: dict,
) -> None:
    """Commit ``db``, then publish a ``company_sector.*`` live event on ``module:company_sectors``."""
    await dispatcher.publish_lifecycle_event(
        db,
        module="company_sectors",
        entity="company_sector",
        entity_id=company_sector_id,
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
    """Shared helper: record a company sector action and mark the request as logged."""
    await audit_service.record(
        action=action,
        module="masters.company_sectors",
        user_id=actor.id,
        username_snapshot=actor.username,
        entity_type="CompanySector",
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


@router.post("", status_code=status.HTTP_201_CREATED, summary="Create a company sector entry")
async def create_company_sector(
    payload: CompanySectorCreate,
    request: Request,
    service: CompanySectorService = Depends(get_company_sector_service),
    current_user: CurrentUser = Depends(require_permission("companysector.create")),
    audit_service: AuditService = Depends(get_audit_service),
    db: AsyncSession = Depends(get_db_session),
    dispatcher: EventDispatcher = Depends(get_event_dispatcher),
) -> dict:
    """Create a new company sector platform entry."""
    item = await service.create(**payload.model_dump())
    data = CompanySectorRead.model_validate(item).model_dump(mode="json")
    await _record_action(
        audit_service=audit_service,
        request=request,
        action=AuditAction.CREATE,
        actor=current_user,
        entity_id=item.id,
        description=f"Created company sector {item.name!r}.",
        new_values=payload.model_dump(mode="json"),
    )
    await _publish_company_sector_event(
        db=db,
        dispatcher=dispatcher,
        event_type="company_sector.created",
        company_sector_id=item.id,
        user_id=current_user.id,
        changes=payload.model_dump(mode="json"),
    )
    return build_success_response(data=data, request_id=request.state.request_id, message="Resource created successfully.")


@router.get("", summary="List company sectors")
async def list_company_sectors(
    request: Request,
    query: ListQueryParams = Depends(get_list_query_params),
    service: CompanySectorService = Depends(get_company_sector_service),
    _current_user: CurrentUser = Depends(require_permission("companysector.view")),
) -> dict:
    """List company sectors, with search/sort/filter/pagination."""
    items, total = await service.list_paginated(query)
    meta = PageMeta.build(page=query.page.page, page_size=query.page.page_size, total_records=total).as_meta_dict()
    data = [CompanySectorRead.model_validate(i).model_dump(mode="json") for i in items]
    return build_success_response(data=data, request_id=request.state.request_id, meta=meta)


@router.get("/export", summary="Export company sectors to CSV/Excel")
async def export_company_sectors(
    request: Request,
    format: str = "csv",
    service: CompanySectorService = Depends(get_company_sector_service),
    current_user: CurrentUser = Depends(require_permission("companysector.export")),
    audit_service: AuditService = Depends(get_audit_service),
) -> Response:
    """Export every company sector entry as a CSV or XLSX file."""
    file_format = format.lower()
    if file_format not in ("csv", "xlsx"):
        file_format = "csv"
    content = await service.export_file(file_format)
    await _record_action(
        audit_service=audit_service,
        request=request,
        action=AuditAction.EXPORT,
        actor=current_user,
        entity_id="bulk",
        description=f"Exported company sectors as {file_format}.",
    )
    media_type = "text/csv" if file_format == "csv" else "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    filename = f"company_sectors_export.{file_format}"
    return Response(
        content=content,
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/import", summary="Import company sectors from CSV/Excel")
async def import_company_sectors(
    request: Request,
    file: UploadFile = File(...),
    service: CompanySectorService = Depends(get_company_sector_service),
    current_user: CurrentUser = Depends(require_permission("companysector.import")),
    audit_service: AuditService = Depends(get_audit_service),
) -> dict:
    """Import company sectors from an uploaded CSV or XLSX file."""
    raw_bytes = await file.read()
    summary = await service.import_file(file.filename or "import.csv", raw_bytes)
    await _record_action(
        audit_service=audit_service,
        request=request,
        action=AuditAction.IMPORT,
        actor=current_user,
        entity_id="bulk",
        description=f"Imported company sectors: created={summary.created}, failed={summary.failed}.",
    )
    return build_success_response(
        data=ImportSummaryRead.model_validate(summary).model_dump(mode="json"),
        request_id=request.state.request_id,
        message=f"Import complete. {summary.created} records created.",
    )


@router.get("/lookup", summary="Lightweight company sectors lookup")
async def lookup_company_sectors(
    service: CompanySectorService = Depends(get_company_sector_service),
    _current_user: CurrentUser = Depends(get_current_user),
) -> dict:
    """Lightweight id/name lookup for dropdowns."""
    items = await service.list_all_cached()
    data = [
        {
            "id": str(i.id),
            "name": i.name,
            "description": i.description,
            "status": i.status.value,
        }
        for i in items
        if i.status.value == "active"
    ]
    return build_success_response(data=data)


@router.get("/{company_sector_id}", summary="Get a company sector by ID")
async def get_company_sector(
    company_sector_id: uuid.UUID,
    request: Request,
    service: CompanySectorService = Depends(get_company_sector_service),
    _current_user: CurrentUser = Depends(require_permission("companysector.view")),
) -> dict:
    """Fetch a company sector entry by its UUID."""
    item = await service.get_by_id_or_raise(company_sector_id)
    data = CompanySectorRead.model_validate(item).model_dump(mode="json")
    return build_success_response(data=data, request_id=request.state.request_id)


@router.put("/{company_sector_id}", summary="Update a company sector")
async def update_company_sector(
    company_sector_id: uuid.UUID,
    payload: CompanySectorUpdate,
    request: Request,
    service: CompanySectorService = Depends(get_company_sector_service),
    current_user: CurrentUser = Depends(require_permission("companysector.update")),
    audit_service: AuditService = Depends(get_audit_service),
    db: AsyncSession = Depends(get_db_session),
    dispatcher: EventDispatcher = Depends(get_event_dispatcher),
) -> dict:
    """Update an existing company sector entry."""
    item = await service.update(company_sector_id, **payload.model_dump())
    data = CompanySectorRead.model_validate(item).model_dump(mode="json")
    await _record_action(
        audit_service=audit_service,
        request=request,
        action=AuditAction.UPDATE,
        actor=current_user,
        entity_id=company_sector_id,
        description=f"Updated company sector {item.name!r}.",
        new_values=payload.model_dump(mode="json"),
    )
    await _publish_company_sector_event(
        db=db,
        dispatcher=dispatcher,
        event_type="company_sector.updated",
        company_sector_id=company_sector_id,
        user_id=current_user.id,
        changes=payload.model_dump(mode="json"),
    )
    return build_success_response(data=data, request_id=request.state.request_id, message="Resource updated successfully.")


@router.patch("/{company_sector_id}/activate", summary="Activate a company sector")
async def activate_company_sector(
    company_sector_id: uuid.UUID,
    request: Request,
    service: CompanySectorService = Depends(get_company_sector_service),
    current_user: CurrentUser = Depends(require_permission("companysector.update")),
    audit_service: AuditService = Depends(get_audit_service),
    db: AsyncSession = Depends(get_db_session),
    dispatcher: EventDispatcher = Depends(get_event_dispatcher),
) -> dict:
    """Set company sector status to ACTIVE."""
    item = await service.activate(company_sector_id)
    data = CompanySectorRead.model_validate(item).model_dump(mode="json")
    await _record_action(
        audit_service=audit_service,
        request=request,
        action=AuditAction.UPDATE,
        actor=current_user,
        entity_id=company_sector_id,
        description=f"Activated company sector {item.name!r}.",
    )
    await _publish_company_sector_event(
        db=db,
        dispatcher=dispatcher,
        event_type="company_sector.activated",
        company_sector_id=company_sector_id,
        user_id=current_user.id,
        changes={"status": "active"},
    )
    return build_success_response(data=data, request_id=request.state.request_id, message="Company sector activated.")


@router.patch("/{company_sector_id}/deactivate", summary="Deactivate a company sector")
async def deactivate_company_sector(
    company_sector_id: uuid.UUID,
    request: Request,
    service: CompanySectorService = Depends(get_company_sector_service),
    current_user: CurrentUser = Depends(require_permission("companysector.update")),
    audit_service: AuditService = Depends(get_audit_service),
    db: AsyncSession = Depends(get_db_session),
    dispatcher: EventDispatcher = Depends(get_event_dispatcher),
) -> dict:
    """Set company sector status to INACTIVE."""
    item = await service.deactivate(company_sector_id)
    data = CompanySectorRead.model_validate(item).model_dump(mode="json")
    await _record_action(
        audit_service=audit_service,
        request=request,
        action=AuditAction.UPDATE,
        actor=current_user,
        entity_id=company_sector_id,
        description=f"Deactivated company sector {item.name!r}.",
    )
    await _publish_company_sector_event(
        db=db,
        dispatcher=dispatcher,
        event_type="company_sector.deactivated",
        company_sector_id=company_sector_id,
        user_id=current_user.id,
        changes={"status": "inactive"},
    )
    return build_success_response(data=data, request_id=request.state.request_id, message="Company sector deactivated.")


@router.delete("/{company_sector_id}", summary="Delete a company sector")
async def delete_company_sector(
    company_sector_id: uuid.UUID,
    request: Request,
    service: CompanySectorService = Depends(get_company_sector_service),
    current_user: CurrentUser = Depends(require_permission("companysector.delete")),
    audit_service: AuditService = Depends(get_audit_service),
    db: AsyncSession = Depends(get_db_session),
    dispatcher: EventDispatcher = Depends(get_event_dispatcher),
) -> dict:
    """Soft-delete a company sector record."""
    await service.delete(company_sector_id)
    await _record_action(
        audit_service=audit_service,
        request=request,
        action=AuditAction.DELETE,
        actor=current_user,
        entity_id=company_sector_id,
        description=f"Deleted company sector {company_sector_id}.",
    )
    await _publish_company_sector_event(
        db=db,
        dispatcher=dispatcher,
        event_type="company_sector.deleted",
        company_sector_id=company_sector_id,
        user_id=current_user.id,
        changes={"deleted": True},
    )
    return build_success_response(data={"id": str(company_sector_id)}, request_id=request.state.request_id, message="Resource deleted successfully.")


@router.post("/bulk-status", summary="Bulk activate/deactivate company sectors")
async def bulk_status(
    payload: dict,
    request: Request,
    service: CompanySectorService = Depends(get_company_sector_service),
    current_user: CurrentUser = Depends(require_permission("companysector.bulk_action")),
    audit_service: AuditService = Depends(get_audit_service),
) -> dict:
    """Bulk update status for a list of company sector IDs."""
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
        description=f"Bulk {target_status} applied to {updated} company sector records.",
    )
    return build_success_response(data={"updated": updated}, request_id=request.state.request_id, message=f"{updated} records updated.")


@router.post("/bulk-delete", summary="Bulk delete company sectors")
async def bulk_delete(
    payload: dict,
    request: Request,
    service: CompanySectorService = Depends(get_company_sector_service),
    current_user: CurrentUser = Depends(require_permission("companysector.bulk_action")),
    audit_service: AuditService = Depends(get_audit_service),
) -> dict:
    """Bulk soft-delete for a list of company sector IDs."""
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
        description=f"Bulk deleted {deleted} company sector records.",
    )
    return build_success_response(data={"deleted": deleted}, request_id=request.state.request_id, message=f"{deleted} records deleted.")
