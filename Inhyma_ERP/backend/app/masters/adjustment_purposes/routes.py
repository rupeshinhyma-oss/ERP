"""Adjustment Purposes Routes. Standard CRUD + activate/deactivate + import/export, with audit logging."""

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
from app.masters.adjustment_purposes.dependencies import get_adjustment_purpose_service
from app.masters.adjustment_purposes.models import AdjustmentPurpose
from app.masters.adjustment_purposes.schemas import (
    AdjustmentPurposeCreate,
    AdjustmentPurposeLookup,
    AdjustmentPurposeRead,
    AdjustmentPurposeUpdate,
    ImportSummaryRead,
)
from app.masters.adjustment_purposes.service import AdjustmentPurposeService
from app.rbac.dependencies import require_permission

router = APIRouter(tags=["Masters - Adjustment Purposes"])


class BulkActionRequest(BaseModel):
    """Payload for bulk actions on adjustment purposes."""

    ids: list[uuid.UUID]
    action: str


def _to_read(item: AdjustmentPurpose) -> dict:
    """Serialize AdjustmentPurpose model to AdjustmentPurposeRead dictionary."""
    read = AdjustmentPurposeRead(
        id=item.id,
        name=item.name,
        status=item.status,
        created_at=item.created_at,
        updated_at=item.updated_at,
        version=item.version,
    )
    return read.model_dump(mode="json")


async def _publish_adjustment_purpose_event(
    *,
    db: AsyncSession,
    dispatcher: EventDispatcher,
    event_type: str,
    purpose_id: uuid.UUID | str,
    user_id: uuid.UUID,
    changes: dict,
) -> None:
    """Commit ``db``, then publish an ``adjustment_purpose.*`` live event on ``module:adjustment_purposes``."""
    await dispatcher.publish_lifecycle_event(
        db,
        module="adjustment_purposes",
        entity="adjustment_purpose",
        entity_id=purpose_id,
        event_type=event_type,
        version=None,
        user_id=user_id,
        changes=changes,
    )


async def _record_action(
    audit_service: AuditService,
    request: Request,
    user: CurrentUser,
    action: AuditAction,
    entity_id: uuid.UUID | None,
    old_state: dict | None,
    new_state: dict | None,
) -> None:
    """Record a structured audit log entry."""
    ip_address = request.client.host if request.client else None
    user_agent = request.headers.get("user-agent")
    await audit_service.log_action(
        user_id=user.id,
        action=action,
        entity_name="adjustment_purposes",
        entity_id=entity_id,
        old_state=old_state,
        new_state=new_state,
        ip_address=ip_address,
        user_agent=user_agent,
    )


@router.get("", summary="List adjustment purposes with pagination and filtering")
async def list_adjustment_purposes(
    request: Request,
    params: ListQueryParams = Depends(get_list_query_params),
    service: AdjustmentPurposeService = Depends(get_adjustment_purpose_service),
    _perm: CurrentUser = Depends(require_permission("adjustment_purpose.view")),
) -> dict:
    """Return a paginated list of adjustment purposes."""
    items, total = await service.list_paginated(params)
    data = [_to_read(item) for item in items]
    meta = PageMeta.build(
        page=params.page.page,
        page_size=params.page.page_size,
        total_records=total,
    ).as_meta_dict()
    return build_success_response(data=data, meta=meta, request_id=getattr(request.state, "request_id", "-"))


@router.get("/lookup", summary="List active adjustment purposes for select dropdowns")
@router.get("/dropdown", summary="List active adjustment purposes for dropdowns")
async def dropdown_adjustment_purposes(
    request: Request,
    service: AdjustmentPurposeService = Depends(get_adjustment_purpose_service),
    _perm: CurrentUser = Depends(require_permission("adjustment_purpose.view")),
) -> dict:
    """Return lightweight adjustment purposes list for selects/dropdowns."""
    items = await service.list_all_cached()
    data = [AdjustmentPurposeLookup.model_validate(i).model_dump(mode="json") for i in items]
    return build_success_response(data=data, request_id=getattr(request.state, "request_id", "-"))


@router.post("", status_code=status.HTTP_201_CREATED, summary="Create an adjustment purpose")
async def create_adjustment_purpose(
    request: Request,
    payload: AdjustmentPurposeCreate,
    service: AdjustmentPurposeService = Depends(get_adjustment_purpose_service),
    audit_service: AuditService = Depends(get_audit_service),
    dispatcher: EventDispatcher = Depends(get_event_dispatcher),
    db: AsyncSession = Depends(get_db_session),
    user: CurrentUser = Depends(require_permission("adjustment_purpose.create")),
) -> dict:
    """Create a new adjustment purpose record."""
    item = await service.create(**payload.model_dump())
    data = _to_read(item)
    await _record_action(
        audit_service, request, user, AuditAction.CREATE,
        entity_id=item.id, old_state=None, new_state=data,
    )
    await _publish_adjustment_purpose_event(
        db=db,
        dispatcher=dispatcher,
        event_type="adjustment_purpose.created",
        purpose_id=item.id,
        user_id=user.id,
        changes=data,
    )
    return build_success_response(data=data, message="Adjustment purpose created successfully.")


@router.get("/{purpose_id}", summary="Get adjustment purpose details by ID")
async def get_adjustment_purpose(
    purpose_id: uuid.UUID,
    service: AdjustmentPurposeService = Depends(get_adjustment_purpose_service),
    _perm: CurrentUser = Depends(require_permission("adjustment_purpose.view")),
) -> dict:
    """Fetch details of a specific adjustment purpose."""
    item = await service.get_by_id_or_raise(purpose_id)
    return build_success_response(data=_to_read(item))


@router.put("/{purpose_id}", summary="Update an existing adjustment purpose")
async def update_adjustment_purpose(
    request: Request,
    purpose_id: uuid.UUID,
    payload: AdjustmentPurposeUpdate,
    service: AdjustmentPurposeService = Depends(get_adjustment_purpose_service),
    audit_service: AuditService = Depends(get_audit_service),
    dispatcher: EventDispatcher = Depends(get_event_dispatcher),
    db: AsyncSession = Depends(get_db_session),
    user: CurrentUser = Depends(require_permission("adjustment_purpose.update")),
) -> dict:
    """Update fields of an existing adjustment purpose."""
    existing = await service.get_by_id_or_raise(purpose_id)
    old_state = _to_read(existing)

    update_dict = payload.model_dump(exclude_unset=True)
    item = await service.update(purpose_id, **update_dict)
    new_state = _to_read(item)

    await _record_action(
        audit_service, request, user, AuditAction.UPDATE,
        entity_id=item.id, old_state=old_state, new_state=new_state,
    )
    await _publish_adjustment_purpose_event(
        db=db,
        dispatcher=dispatcher,
        event_type="adjustment_purpose.updated",
        purpose_id=item.id,
        user_id=user.id,
        changes=new_state,
    )
    return build_success_response(data=new_state, message="Adjustment purpose updated successfully.")


@router.delete("/{purpose_id}", summary="Soft-delete an adjustment purpose")
async def delete_adjustment_purpose(
    request: Request,
    purpose_id: uuid.UUID,
    service: AdjustmentPurposeService = Depends(get_adjustment_purpose_service),
    audit_service: AuditService = Depends(get_audit_service),
    dispatcher: EventDispatcher = Depends(get_event_dispatcher),
    db: AsyncSession = Depends(get_db_session),
    user: CurrentUser = Depends(require_permission("adjustment_purpose.delete")),
) -> dict:
    """Soft-delete an adjustment purpose record."""
    item = await service.get_by_id_or_raise(purpose_id)
    old_state = _to_read(item)

    await service.delete(purpose_id)

    await _record_action(
        audit_service, request, user, AuditAction.DELETE,
        entity_id=purpose_id, old_state=old_state, new_state=None,
    )
    await _publish_adjustment_purpose_event(
        db=db,
        dispatcher=dispatcher,
        event_type="adjustment_purpose.deleted",
        purpose_id=purpose_id,
        user_id=user.id,
        changes={"deleted": True},
    )
    return build_success_response(data=None, message="Adjustment purpose deleted successfully.")


@router.post("/{purpose_id}/activate", summary="Activate an adjustment purpose")
async def activate_adjustment_purpose(
    request: Request,
    purpose_id: uuid.UUID,
    service: AdjustmentPurposeService = Depends(get_adjustment_purpose_service),
    audit_service: AuditService = Depends(get_audit_service),
    dispatcher: EventDispatcher = Depends(get_event_dispatcher),
    db: AsyncSession = Depends(get_db_session),
    user: CurrentUser = Depends(require_permission("adjustment_purpose.update")),
) -> dict:
    """Set adjustment purpose status to active."""
    existing = await service.get_by_id_or_raise(purpose_id)
    old_state = _to_read(existing)

    item = await service.activate(purpose_id)
    new_state = _to_read(item)

    await _record_action(
        audit_service, request, user, AuditAction.STATUS_CHANGE,
        entity_id=item.id, old_state=old_state, new_state=new_state,
    )
    await _publish_adjustment_purpose_event(
        db=db,
        dispatcher=dispatcher,
        event_type="adjustment_purpose.activated",
        purpose_id=item.id,
        user_id=user.id,
        changes={"status": "ACTIVE"},
    )
    return build_success_response(data=new_state, message="Adjustment purpose activated.")


@router.post("/{purpose_id}/deactivate", summary="Deactivate an adjustment purpose")
async def deactivate_adjustment_purpose(
    request: Request,
    purpose_id: uuid.UUID,
    service: AdjustmentPurposeService = Depends(get_adjustment_purpose_service),
    audit_service: AuditService = Depends(get_audit_service),
    dispatcher: EventDispatcher = Depends(get_event_dispatcher),
    db: AsyncSession = Depends(get_db_session),
    user: CurrentUser = Depends(require_permission("adjustment_purpose.update")),
) -> dict:
    """Set adjustment purpose status to inactive."""
    existing = await service.get_by_id_or_raise(purpose_id)
    old_state = _to_read(existing)

    item = await service.deactivate(purpose_id)
    new_state = _to_read(item)

    await _record_action(
        audit_service, request, user, AuditAction.STATUS_CHANGE,
        entity_id=item.id, old_state=old_state, new_state=new_state,
    )
    await _publish_adjustment_purpose_event(
        db=db,
        dispatcher=dispatcher,
        event_type="adjustment_purpose.deactivated",
        purpose_id=item.id,
        user_id=user.id,
        changes={"status": "INACTIVE"},
    )
    return build_success_response(data=new_state, message="Adjustment purpose deactivated.")


@router.post("/bulk", summary="Perform bulk actions on adjustment purposes")
async def bulk_action_adjustment_purposes(
    request: Request,
    payload: BulkActionRequest,
    service: AdjustmentPurposeService = Depends(get_adjustment_purpose_service),
    audit_service: AuditService = Depends(get_audit_service),
    dispatcher: EventDispatcher = Depends(get_event_dispatcher),
    db: AsyncSession = Depends(get_db_session),
    user: CurrentUser = Depends(require_permission("adjustment_purpose.bulk_action")),
) -> dict:
    """Bulk delete, activate, or deactivate multiple adjustment purposes."""
    act = payload.action.lower()
    affected = 0
    errors: list[str] = []

    for pid in payload.ids:
        try:
            if act == "delete":
                await service.delete(pid)
                await _record_action(
                    audit_service, request, user, AuditAction.DELETE,
                    entity_id=pid, old_state=None, new_state=None,
                )
            elif act == "activate":
                await service.activate(pid)
            elif act == "deactivate":
                await service.deactivate(pid)
            else:
                raise BadRequestException(f"Unsupported action: {payload.action}")
            affected += 1
        except Exception as exc:
            errors.append(f"{pid}: {str(exc)}")

    await _publish_adjustment_purpose_event(
        db=db,
        dispatcher=dispatcher,
        event_type=f"adjustment_purpose.bulk_{act}",
        purpose_id=payload.ids[0] if payload.ids else "bulk",
        user_id=user.id,
        changes={"action": act, "affected": affected},
    )

    return build_success_response(
        data={"affected": affected, "errors": errors},
        message=f"Bulk {act} applied to {affected} adjustment purpose(s).",
    )


@router.post("/import", summary="Import adjustment purposes from CSV/XLSX")
async def import_adjustment_purposes(
    request: Request,
    file: UploadFile = File(...),
    service: AdjustmentPurposeService = Depends(get_adjustment_purpose_service),
    audit_service: AuditService = Depends(get_audit_service),
    dispatcher: EventDispatcher = Depends(get_event_dispatcher),
    db: AsyncSession = Depends(get_db_session),
    user: CurrentUser = Depends(require_permission("adjustment_purpose.import")),
) -> dict:
    """Bulk import adjustment purposes from a CSV or Excel spreadsheet."""
    contents = await file.read()
    summary = await service.import_file(file.filename or "import.csv", contents)

    await _record_action(
        audit_service, request, user, AuditAction.IMPORT,
        entity_id=None, old_state=None, new_state={"imported": summary.imported_rows},
    )
    await _publish_adjustment_purpose_event(
        db=db,
        dispatcher=dispatcher,
        event_type="adjustment_purpose.imported",
        purpose_id="bulk",
        user_id=user.id,
        changes={"imported": summary.imported_rows},
    )

    read_summary = ImportSummaryRead(
        total_rows=summary.total_rows,
        imported_rows=summary.imported_rows,
        duplicate_rows=summary.duplicate_rows,
        error_rows=summary.error_rows,
        errors=summary.errors,
    )
    return build_success_response(
        data=read_summary.model_dump(),
        message=f"Import completed. {summary.imported_rows} row(s) imported.",
    )


@router.get("/export", summary="Export adjustment purposes to CSV/XLSX")
@router.get("/export/file", summary="Export adjustment purposes to CSV/XLSX")
async def export_adjustment_purposes(
    format: str = "xlsx",
    service: AdjustmentPurposeService = Depends(get_adjustment_purpose_service),
    _perm: CurrentUser = Depends(require_permission("adjustment_purpose.export")),
) -> Response:
    """Download export file containing all adjustment purposes."""
    fmt = format.lower().strip()
    if fmt not in ("csv", "xlsx"):
        raise BadRequestException("Format must be 'csv' or 'xlsx'.")

    file_bytes = await service.export_file(fmt)
    media_type = (
        "text/csv"
        if fmt == "csv"
        else "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )
    filename = f"adjustment_purposes.{fmt}"
    return Response(
        content=file_bytes,
        media_type=media_type,
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )
