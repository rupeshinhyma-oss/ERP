"""Call Types Routes. Standard CRUD + activate/deactivate + import/export, with audit logging."""

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
from app.masters.call_types.dependencies import get_call_type_service
from app.masters.call_types.models import CallType
from app.masters.call_types.schemas import (
    CallTypeCreate,
    CallTypeLookup,
    CallTypeRead,
    CallTypeUpdate,
    ImportSummaryRead,
)
from app.masters.call_types.service import CallTypeService
from app.rbac.dependencies import require_permission

router = APIRouter(tags=["Masters - Call Types"])


class BulkActionRequest(BaseModel):
    """Payload for bulk actions on call types."""

    ids: list[uuid.UUID]
    action: str


def _to_read(item: CallType) -> dict:
    """Serialize CallType model to CallTypeRead dictionary."""
    read = CallTypeRead(
        id=item.id,
        name=item.name,
        status=item.status,
        created_at=item.created_at,
        updated_at=item.updated_at,
        version=item.version,
    )
    return read.model_dump(mode="json")


async def _publish_call_type_event(
    *,
    db: AsyncSession,
    dispatcher: EventDispatcher,
    event_type: str,
    call_type_id: uuid.UUID | str,
    user_id: uuid.UUID,
    changes: dict,
) -> None:
    """Commit ``db``, then publish a ``call_type.*`` live event on ``module:call_types``."""
    await dispatcher.publish_lifecycle_event(
        db,
        module="call_types",
        entity="call_type",
        entity_id=call_type_id,
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
        entity_name="call_types",
        entity_id=entity_id,
        old_state=old_state,
        new_state=new_state,
        ip_address=ip_address,
        user_agent=user_agent,
    )


@router.get("", summary="List call types with pagination and filtering")
async def list_call_types(
    request: Request,
    params: ListQueryParams = Depends(get_list_query_params),
    service: CallTypeService = Depends(get_call_type_service),
    _perm: CurrentUser = Depends(require_permission("call_type.view")),
) -> dict:
    """Return a paginated list of call types."""
    items, total = await service.list_paginated(params)
    data = [_to_read(item) for item in items]
    meta = PageMeta.build(
        page=params.page.page,
        page_size=params.page.page_size,
        total_records=total,
    ).as_meta_dict()
    return build_success_response(data=data, meta=meta, request_id=getattr(request.state, "request_id", "-"))


@router.get("/lookup", summary="List active call types for select dropdowns")
@router.get("/dropdown", summary="List active call types for dropdowns")
async def dropdown_call_types(
    request: Request,
    service: CallTypeService = Depends(get_call_type_service),
    _perm: CurrentUser = Depends(require_permission("call_type.view")),
) -> dict:
    """Return lightweight call types list for selects/dropdowns."""
    items = await service.list_all_cached()
    data = [CallTypeLookup.model_validate(i).model_dump(mode="json") for i in items]
    return build_success_response(data=data, request_id=getattr(request.state, "request_id", "-"))


@router.post("", status_code=status.HTTP_201_CREATED, summary="Create a call type")
async def create_call_type(
    request: Request,
    payload: CallTypeCreate,
    service: CallTypeService = Depends(get_call_type_service),
    audit_service: AuditService = Depends(get_audit_service),
    dispatcher: EventDispatcher = Depends(get_event_dispatcher),
    db: AsyncSession = Depends(get_db_session),
    user: CurrentUser = Depends(require_permission("call_type.create")),
) -> dict:
    """Create a new call type record."""
    item = await service.create(**payload.model_dump())
    data = _to_read(item)
    await _record_action(
        audit_service, request, user, AuditAction.CREATE,
        entity_id=item.id, old_state=None, new_state=data,
    )
    await _publish_call_type_event(
        db=db,
        dispatcher=dispatcher,
        event_type="call_type.created",
        call_type_id=item.id,
        user_id=user.id,
        changes=data,
    )
    return build_success_response(data=data, message="Call type created successfully.")


@router.get("/{call_type_id}", summary="Get call type details by ID")
async def get_call_type(
    call_type_id: uuid.UUID,
    service: CallTypeService = Depends(get_call_type_service),
    _perm: CurrentUser = Depends(require_permission("call_type.view")),
) -> dict:
    """Fetch details of a specific call type."""
    item = await service.get_by_id_or_raise(call_type_id)
    return build_success_response(data=_to_read(item))


@router.put("/{call_type_id}", summary="Update an existing call type")
async def update_call_type(
    request: Request,
    call_type_id: uuid.UUID,
    payload: CallTypeUpdate,
    service: CallTypeService = Depends(get_call_type_service),
    audit_service: AuditService = Depends(get_audit_service),
    dispatcher: EventDispatcher = Depends(get_event_dispatcher),
    db: AsyncSession = Depends(get_db_session),
    user: CurrentUser = Depends(require_permission("call_type.update")),
) -> dict:
    """Update fields of an existing call type."""
    existing = await service.get_by_id_or_raise(call_type_id)
    old_state = _to_read(existing)

    update_dict = payload.model_dump(exclude_unset=True)
    item = await service.update(call_type_id, **update_dict)
    new_state = _to_read(item)

    await _record_action(
        audit_service, request, user, AuditAction.UPDATE,
        entity_id=item.id, old_state=old_state, new_state=new_state,
    )
    await _publish_call_type_event(
        db=db,
        dispatcher=dispatcher,
        event_type="call_type.updated",
        call_type_id=item.id,
        user_id=user.id,
        changes=new_state,
    )
    return build_success_response(data=new_state, message="Call type updated successfully.")


@router.delete("/{call_type_id}", summary="Soft-delete a call type")
async def delete_call_type(
    request: Request,
    call_type_id: uuid.UUID,
    service: CallTypeService = Depends(get_call_type_service),
    audit_service: AuditService = Depends(get_audit_service),
    dispatcher: EventDispatcher = Depends(get_event_dispatcher),
    db: AsyncSession = Depends(get_db_session),
    user: CurrentUser = Depends(require_permission("call_type.delete")),
) -> dict:
    """Soft-delete a call type record."""
    item = await service.get_by_id_or_raise(call_type_id)
    old_state = _to_read(item)

    await service.delete(call_type_id)

    await _record_action(
        audit_service, request, user, AuditAction.DELETE,
        entity_id=call_type_id, old_state=old_state, new_state=None,
    )
    await _publish_call_type_event(
        db=db,
        dispatcher=dispatcher,
        event_type="call_type.deleted",
        call_type_id=call_type_id,
        user_id=user.id,
        changes={"deleted": True},
    )
    return build_success_response(data=None, message="Call type deleted successfully.")


@router.post("/{call_type_id}/activate", summary="Activate a call type")
async def activate_call_type(
    request: Request,
    call_type_id: uuid.UUID,
    service: CallTypeService = Depends(get_call_type_service),
    audit_service: AuditService = Depends(get_audit_service),
    dispatcher: EventDispatcher = Depends(get_event_dispatcher),
    db: AsyncSession = Depends(get_db_session),
    user: CurrentUser = Depends(require_permission("call_type.update")),
) -> dict:
    """Set call type status to active."""
    existing = await service.get_by_id_or_raise(call_type_id)
    old_state = _to_read(existing)

    item = await service.activate(call_type_id)
    new_state = _to_read(item)

    await _record_action(
        audit_service, request, user, AuditAction.STATUS_CHANGE,
        entity_id=item.id, old_state=old_state, new_state=new_state,
    )
    await _publish_call_type_event(
        db=db,
        dispatcher=dispatcher,
        event_type="call_type.activated",
        call_type_id=item.id,
        user_id=user.id,
        changes={"status": "ACTIVE"},
    )
    return build_success_response(data=new_state, message="Call type activated.")


@router.post("/{call_type_id}/deactivate", summary="Deactivate a call type")
async def deactivate_call_type(
    request: Request,
    call_type_id: uuid.UUID,
    service: CallTypeService = Depends(get_call_type_service),
    audit_service: AuditService = Depends(get_audit_service),
    dispatcher: EventDispatcher = Depends(get_event_dispatcher),
    db: AsyncSession = Depends(get_db_session),
    user: CurrentUser = Depends(require_permission("call_type.update")),
) -> dict:
    """Set call type status to inactive."""
    existing = await service.get_by_id_or_raise(call_type_id)
    old_state = _to_read(existing)

    item = await service.deactivate(call_type_id)
    new_state = _to_read(item)

    await _record_action(
        audit_service, request, user, AuditAction.STATUS_CHANGE,
        entity_id=item.id, old_state=old_state, new_state=new_state,
    )
    await _publish_call_type_event(
        db=db,
        dispatcher=dispatcher,
        event_type="call_type.deactivated",
        call_type_id=item.id,
        user_id=user.id,
        changes={"status": "INACTIVE"},
    )
    return build_success_response(data=new_state, message="Call type deactivated.")


@router.post("/bulk", summary="Perform bulk actions on call types")
async def bulk_action_call_types(
    request: Request,
    payload: BulkActionRequest,
    service: CallTypeService = Depends(get_call_type_service),
    audit_service: AuditService = Depends(get_audit_service),
    dispatcher: EventDispatcher = Depends(get_event_dispatcher),
    db: AsyncSession = Depends(get_db_session),
    user: CurrentUser = Depends(require_permission("call_type.bulk_action")),
) -> dict:
    """Bulk delete, activate, or deactivate multiple call types."""
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

    await _publish_call_type_event(
        db=db,
        dispatcher=dispatcher,
        event_type=f"call_type.bulk_{act}",
        call_type_id=payload.ids[0] if payload.ids else "bulk",
        user_id=user.id,
        changes={"action": act, "affected": affected},
    )

    return build_success_response(
        data={"affected": affected, "errors": errors},
        message=f"Bulk {act} applied to {affected} call type(s).",
    )


@router.post("/import", summary="Import call types from CSV/XLSX")
async def import_call_types(
    request: Request,
    file: UploadFile = File(...),
    service: CallTypeService = Depends(get_call_type_service),
    audit_service: AuditService = Depends(get_audit_service),
    dispatcher: EventDispatcher = Depends(get_event_dispatcher),
    db: AsyncSession = Depends(get_db_session),
    user: CurrentUser = Depends(require_permission("call_type.import")),
) -> dict:
    """Bulk import call types from a CSV or Excel spreadsheet."""
    contents = await file.read()
    summary = await service.import_file(file.filename or "import.csv", contents)

    await _record_action(
        audit_service, request, user, AuditAction.IMPORT,
        entity_id=None, old_state=None, new_state={"imported": summary.imported_rows},
    )
    await _publish_call_type_event(
        db=db,
        dispatcher=dispatcher,
        event_type="call_type.imported",
        call_type_id="bulk",
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


@router.get("/export", summary="Export call types to CSV/XLSX")
@router.get("/export/file", summary="Export call types to CSV/XLSX")
async def export_call_types(
    format: str = "xlsx",
    service: CallTypeService = Depends(get_call_type_service),
    _perm: CurrentUser = Depends(require_permission("call_type.export")),
) -> Response:
    """Download export file containing all call types."""
    fmt = format.lower().strip()
    if fmt not in ("csv", "xlsx"):
        raise BadRequestException("Format must be 'csv' or 'xlsx'.")

    file_bytes = await service.export_file(fmt)
    media_type = (
        "text/csv"
        if fmt == "csv"
        else "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )
    filename = f"call_types.{fmt}"
    return Response(
        content=file_bytes,
        media_type=media_type,
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )
