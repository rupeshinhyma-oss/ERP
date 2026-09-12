"""
Tax Routes. Standard CRUD + activate/deactivate + import/export, with audit logging.
"""

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
from app.masters.taxes.dependencies import get_tax_service
from app.masters.taxes.schemas import ImportSummaryRead, TaxCreate, TaxRead, TaxUpdate
from app.masters.taxes.service import TaxService
from app.rbac.dependencies import require_permission

router = APIRouter(prefix="/masters/taxes", tags=["Masters - Taxes"])


async def _publish_tax_event(
    *,
    db: AsyncSession,
    dispatcher: EventDispatcher,
    event_type: str,
    tax_id: uuid.UUID | str,
    user_id: uuid.UUID,
    changes: dict,
) -> None:
    """Commit ``db``, then publish a ``tax.*`` live event on ``module:taxes``."""
    await dispatcher.publish_lifecycle_event(
        db,
        module="taxes",
        entity="tax",
        entity_id=tax_id,
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
    """Shared helper: record a tax action and mark the request as logged."""
    await audit_service.record(
        action=action,
        module="masters.taxes",
        user_id=actor.id,
        username_snapshot=actor.username,
        entity_type="Tax",
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


@router.post("", status_code=status.HTTP_201_CREATED, summary="Create a tax entry")
async def create_tax(
    payload: TaxCreate,
    request: Request,
    service: TaxService = Depends(get_tax_service),
    current_user: CurrentUser = Depends(require_permission("tax.create")),
    audit_service: AuditService = Depends(get_audit_service),
    db: AsyncSession = Depends(get_db_session),
    dispatcher: EventDispatcher = Depends(get_event_dispatcher),
) -> dict:
    """Create a new tax / HSN entry."""
    tax = await service.create(**payload.model_dump())
    data = TaxRead.model_validate(tax).model_dump(mode="json")
    await _record_action(
        audit_service=audit_service,
        request=request,
        action=AuditAction.CREATE,
        actor=current_user,
        entity_id=tax.id,
        description=f"Created tax entry {tax.hsn_number!r} (GST {tax.gst_percent}%, Duty {tax.import_duty_percent}%).",
        new_values=payload.model_dump(mode="json"),
    )
    await _publish_tax_event(
        db=db,
        dispatcher=dispatcher,
        event_type="tax.created",
        tax_id=tax.id,
        user_id=current_user.id,
        changes=payload.model_dump(mode="json"),
    )
    return build_success_response(data=data, request_id=request.state.request_id, message="Resource created successfully.")


@router.get("", summary="List taxes")
async def list_taxes(
    request: Request,
    query: ListQueryParams = Depends(get_list_query_params),
    service: TaxService = Depends(get_tax_service),
    _current_user: CurrentUser = Depends(require_permission("tax.view")),
) -> dict:
    """List taxes, with search/sort/filter/pagination."""
    taxes, total = await service.list_paginated(query)
    meta = PageMeta.build(page=query.page.page, page_size=query.page.page_size, total_records=total).as_meta_dict()
    data = [TaxRead.model_validate(b).model_dump(mode="json") for b in taxes]
    return build_success_response(data=data, request_id=request.state.request_id, meta=meta)


@router.get("/export", summary="Export taxes to CSV/Excel")
async def export_taxes(
    request: Request,
    format: str = "csv",
    service: TaxService = Depends(get_tax_service),
    current_user: CurrentUser = Depends(require_permission("tax.export")),
    audit_service: AuditService = Depends(get_audit_service),
) -> Response:
    """Export every tax entry as a CSV or XLSX file."""
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
        description=f"Exported taxes as {file_format}.",
    )
    media_type = "text/csv" if file_format == "csv" else "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    filename = f"taxes.{file_format}"
    return Response(content=content, media_type=media_type, headers={"Content-Disposition": f"attachment; filename={filename}"})


@router.post("/import", summary="Import taxes from CSV/Excel")
async def import_taxes(
    request: Request,
    file: UploadFile = File(...),
    service: TaxService = Depends(get_tax_service),
    current_user: CurrentUser = Depends(require_permission("tax.import")),
    audit_service: AuditService = Depends(get_audit_service),
) -> dict:
    """Import taxes from an uploaded CSV/XLSX file, validating every row."""
    raw_bytes = await file.read()
    summary = await service.import_file(file.filename or "import.csv", raw_bytes)
    await _record_action(
        audit_service=audit_service,
        request=request,
        action=AuditAction.IMPORT,
        actor=current_user,
        entity_id="bulk",
        description=f"Imported taxes: {summary.created} created, {summary.failed} failed.",
        new_values=summary.as_dict(),
    )
    data = ImportSummaryRead(**summary.as_dict()).model_dump(mode="json")
    return build_success_response(data=data, request_id=request.state.request_id)


@router.get("/{tax_id}", summary="Get a tax entry")
async def get_tax(
    tax_id: uuid.UUID,
    request: Request,
    service: TaxService = Depends(get_tax_service),
    _current_user: CurrentUser = Depends(get_current_user),
) -> dict:
    """Fetch a single tax entry by ID."""
    tax = await service.get_by_id_or_raise(tax_id)
    data = TaxRead.model_validate(tax).model_dump(mode="json")
    return build_success_response(data=data, request_id=request.state.request_id)


@router.patch("/{tax_id}", summary="Update a tax entry")
async def update_tax(
    tax_id: uuid.UUID,
    payload: TaxUpdate,
    request: Request,
    service: TaxService = Depends(get_tax_service),
    current_user: CurrentUser = Depends(require_permission("tax.update")),
    audit_service: AuditService = Depends(get_audit_service),
    db: AsyncSession = Depends(get_db_session),
    dispatcher: EventDispatcher = Depends(get_event_dispatcher),
) -> dict:
    """Update an existing tax entry."""
    tax = await service.update(tax_id, **payload.model_dump())
    data = TaxRead.model_validate(tax).model_dump(mode="json")
    await _record_action(
        audit_service=audit_service,
        request=request,
        action=AuditAction.UPDATE,
        actor=current_user,
        entity_id=tax.id,
        description=f"Updated tax entry {tax.hsn_number!r}.",
        new_values=payload.model_dump(exclude_none=True, mode="json"),
    )
    await _publish_tax_event(
        db=db,
        dispatcher=dispatcher,
        event_type="tax.updated",
        tax_id=tax.id,
        user_id=current_user.id,
        changes=payload.model_dump(exclude_none=True, mode="json"),
    )
    return build_success_response(data=data, request_id=request.state.request_id)


@router.post("/{tax_id}/activate", summary="Activate a tax entry")
async def activate_tax(
    tax_id: uuid.UUID,
    request: Request,
    service: TaxService = Depends(get_tax_service),
    current_user: CurrentUser = Depends(require_permission("tax.update")),
    audit_service: AuditService = Depends(get_audit_service),
    db: AsyncSession = Depends(get_db_session),
    dispatcher: EventDispatcher = Depends(get_event_dispatcher),
) -> dict:
    """Set tax status to active."""
    tax = await service.activate(tax_id)
    data = TaxRead.model_validate(tax).model_dump(mode="json")
    await _record_action(
        audit_service=audit_service,
        request=request,
        action=AuditAction.UPDATE,
        actor=current_user,
        entity_id=tax.id,
        description=f"Activated tax entry {tax.hsn_number!r}.",
    )
    await _publish_tax_event(
        db=db,
        dispatcher=dispatcher,
        event_type="tax.updated",
        tax_id=tax.id,
        user_id=current_user.id,
        changes={"is_active": True},
    )
    return build_success_response(data=data, request_id=request.state.request_id)


@router.post("/{tax_id}/deactivate", summary="Deactivate a tax entry")
async def deactivate_tax(
    tax_id: uuid.UUID,
    request: Request,
    service: TaxService = Depends(get_tax_service),
    current_user: CurrentUser = Depends(require_permission("tax.update")),
    audit_service: AuditService = Depends(get_audit_service),
    db: AsyncSession = Depends(get_db_session),
    dispatcher: EventDispatcher = Depends(get_event_dispatcher),
) -> dict:
    """Set tax status to inactive."""
    tax = await service.deactivate(tax_id)
    data = TaxRead.model_validate(tax).model_dump(mode="json")
    await _record_action(
        audit_service=audit_service,
        request=request,
        action=AuditAction.UPDATE,
        actor=current_user,
        entity_id=tax.id,
        description=f"Deactivated tax entry {tax.hsn_number!r}.",
    )
    await _publish_tax_event(
        db=db,
        dispatcher=dispatcher,
        event_type="tax.updated",
        tax_id=tax.id,
        user_id=current_user.id,
        changes={"is_active": False},
    )
    return build_success_response(data=data, request_id=request.state.request_id)


@router.delete("/{tax_id}", summary="Delete a tax entry")
async def delete_tax(
    tax_id: uuid.UUID,
    request: Request,
    service: TaxService = Depends(get_tax_service),
    current_user: CurrentUser = Depends(require_permission("tax.delete")),
    audit_service: AuditService = Depends(get_audit_service),
    db: AsyncSession = Depends(get_db_session),
    dispatcher: EventDispatcher = Depends(get_event_dispatcher),
) -> dict:
    """Soft-delete a tax entry."""
    await service.delete(tax_id)
    await _record_action(
        audit_service=audit_service,
        request=request,
        action=AuditAction.DELETE,
        actor=current_user,
        entity_id=tax_id,
        description="Deleted tax entry.",
    )
    await _publish_tax_event(
        db=db,
        dispatcher=dispatcher,
        event_type="tax.deleted",
        tax_id=tax_id,
        user_id=current_user.id,
        changes={},
    )
    return build_success_response(data={"deleted": True}, request_id=request.state.request_id)
