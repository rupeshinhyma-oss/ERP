"""Payment Terms Routes. Standard CRUD + activate/deactivate + import/export, with audit logging."""

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
from app.masters.payment_terms.dependencies import get_payment_term_service
from app.masters.payment_terms.models import PaymentTerm
from app.masters.payment_terms.schemas import (
    ImportSummaryRead,
    PaymentTermCreate,
    PaymentTermLookup,
    PaymentTermRead,
    PaymentTermUpdate,
)
from app.masters.payment_terms.service import PaymentTermService
from app.rbac.dependencies import require_permission

router = APIRouter(tags=["Masters - Payment Terms"])


class BulkActionRequest(BaseModel):
    """Payload for bulk actions on payment terms."""

    ids: list[uuid.UUID]
    action: str


def _to_read(item: PaymentTerm) -> dict:
    """Serialize PaymentTerm model to PaymentTermRead dictionary."""
    read = PaymentTermRead(
        id=item.id,
        name=item.name,
        status=item.status,
        created_at=item.created_at,
        updated_at=item.updated_at,
        version=item.version,
    )
    return read.model_dump(mode="json")


async def _publish_payment_term_event(
    *,
    db: AsyncSession,
    dispatcher: EventDispatcher,
    event_type: str,
    term_id: uuid.UUID | str,
    user_id: uuid.UUID,
    changes: dict,
) -> None:
    """Commit ``db``, then publish a ``payment_term.*`` live event on ``module:payment_terms``."""
    await dispatcher.publish_lifecycle_event(
        db,
        module="payment_terms",
        entity="payment_term",
        entity_id=term_id,
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
    """Shared helper: record a payment term action and mark the request as logged."""
    await audit_service.record(
        action=action,
        module="masters.payment_terms",
        user_id=actor.id,
        username_snapshot=actor.username,
        entity_type="PaymentTerm",
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


@router.post("", status_code=status.HTTP_201_CREATED, summary="Create a payment term entry")
async def create_payment_term(
    payload: PaymentTermCreate,
    request: Request,
    service: PaymentTermService = Depends(get_payment_term_service),
    current_user: CurrentUser = Depends(require_permission("payment_term.create")),
    audit_service: AuditService = Depends(get_audit_service),
    db: AsyncSession = Depends(get_db_session),
    dispatcher: EventDispatcher = Depends(get_event_dispatcher),
) -> dict:
    """Create a new payment term with audit logging and live event broadcast."""
    item = await service.create(**payload.model_dump())
    item_read = _to_read(item)
    await _record_action(
        audit_service=audit_service,
        request=request,
        action=AuditAction.CREATE,
        actor=current_user,
        entity_id=item.id,
        description=f"Created payment term '{item.name}'",
        new_values=item_read,
    )
    await _publish_payment_term_event(
        db=db,
        dispatcher=dispatcher,
        event_type="created",
        term_id=item.id,
        user_id=current_user.id,
        changes=item_read,
    )
    return build_success_response(
        data=item_read,
        message="Payment term created successfully.",
        request_id=request.state.request_id,
    )


@router.get("", summary="List payment term entries")
async def list_payment_terms(
    request: Request,
    query_params: ListQueryParams = Depends(get_list_query_params),
    service: PaymentTermService = Depends(get_payment_term_service),
    current_user: CurrentUser = Depends(require_permission("payment_term.view")),
) -> dict:
    """Return a paginated list of payment term entries."""
    items, total = await service.list_paginated(query_params)
    meta = PageMeta.build(page=query_params.page.page, page_size=query_params.page.page_size, total_records=total).as_meta_dict()
    data = [_to_read(i) for i in items]
    return build_success_response(data=data, meta=meta, request_id=request.state.request_id)


@router.get("/lookup", summary="List active payment terms for select dropdowns")
async def lookup_payment_terms(
    request: Request,
    service: PaymentTermService = Depends(get_payment_term_service),
    current_user: CurrentUser = Depends(require_permission("payment_term.view")),
) -> dict:
    """Return cached minimal payment term list for dropdown selectors."""
    items = await service.list_all_cached()
    data = [PaymentTermLookup.model_validate(i).model_dump(mode="json") for i in items]
    return build_success_response(data=data, request_id=request.state.request_id)


@router.get("/export", summary="Export payment terms master data to CSV or Excel")
async def export_payment_terms(
    format: str = "csv",
    service: PaymentTermService = Depends(get_payment_term_service),
    current_user: CurrentUser = Depends(require_permission("payment_term.export")),
) -> Response:
    """Stream an exported file containing all payment term records."""
    fmt = format.lower().strip()
    if fmt not in ("csv", "xlsx", "excel"):
        fmt = "csv"
    norm_fmt = "xlsx" if fmt in ("xlsx", "excel") else "csv"
    raw = await service.export_file(norm_fmt)
    if norm_fmt == "csv":
        return Response(
            content=raw,
            media_type="text/csv",
            headers={"Content-Disposition": 'attachment; filename="payment_terms.csv"'},
        )
    return Response(
        content=raw,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="payment_terms.xlsx"'},
    )


@router.post("/import", summary="Import payment term records from CSV or Excel")
async def import_payment_terms(
    request: Request,
    file: UploadFile = File(...),
    service: PaymentTermService = Depends(get_payment_term_service),
    current_user: CurrentUser = Depends(require_permission("payment_term.import")),
    audit_service: AuditService = Depends(get_audit_service),
    db: AsyncSession = Depends(get_db_session),
    dispatcher: EventDispatcher = Depends(get_event_dispatcher),
) -> dict:
    """Bulk-import payment term records from an uploaded file."""
    raw_bytes = await file.read()
    summary = await service.import_file(file.filename or "import.csv", raw_bytes)
    summary_dict = summary.to_dict()
    await _record_action(
        audit_service=audit_service,
        request=request,
        action=AuditAction.BULK_IMPORT,
        actor=current_user,
        entity_id="bulk",
        description=f"Imported {summary.imported_rows} payment term entries from file '{file.filename}'",
        new_values=summary_dict,
    )
    if summary.imported_rows > 0:
        await _publish_payment_term_event(
            db=db,
            dispatcher=dispatcher,
            event_type="imported",
            term_id="bulk",
            user_id=current_user.id,
            changes={"imported_rows": summary.imported_rows},
        )
    return build_success_response(
        data=ImportSummaryRead(**summary_dict).model_dump(),
        message=f"Import complete: {summary.imported_rows} added, {summary.duplicate_rows} duplicates, {summary.error_rows} errors.",
        request_id=request.state.request_id,
    )


@router.post("/bulk", summary="Perform bulk operations on multiple payment terms")
async def bulk_action_payment_terms(
    payload: BulkActionRequest,
    request: Request,
    service: PaymentTermService = Depends(get_payment_term_service),
    current_user: CurrentUser = Depends(require_permission("payment_term.bulk_action")),
    audit_service: AuditService = Depends(get_audit_service),
    db: AsyncSession = Depends(get_db_session),
    dispatcher: EventDispatcher = Depends(get_event_dispatcher),
) -> dict:
    """Apply activate/deactivate/delete to a list of payment term IDs."""
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
        description=f"Bulk {action} applied to {count} payment terms",
    )
    await _publish_payment_term_event(
        db=db,
        dispatcher=dispatcher,
        event_type=f"bulk_{action}",
        term_id="bulk",
        user_id=current_user.id,
        changes={"count": count, "action": action},
    )
    return build_success_response(
        data={"affected": count},
        message=f"Bulk {action} applied to {count} records.",
        request_id=request.state.request_id,
    )


@router.get("/{term_id}", summary="Get a payment term entry by ID")
async def get_payment_term(
    term_id: uuid.UUID,
    request: Request,
    service: PaymentTermService = Depends(get_payment_term_service),
    current_user: CurrentUser = Depends(require_permission("payment_term.view")),
) -> dict:
    """Retrieve a single payment term record."""
    item = await service.get_by_id_or_raise(term_id)
    return build_success_response(data=_to_read(item), request_id=request.state.request_id)


@router.put("/{term_id}", summary="Update a payment term entry")
async def update_payment_term(
    term_id: uuid.UUID,
    payload: PaymentTermUpdate,
    request: Request,
    service: PaymentTermService = Depends(get_payment_term_service),
    current_user: CurrentUser = Depends(require_permission("payment_term.update")),
    audit_service: AuditService = Depends(get_audit_service),
    db: AsyncSession = Depends(get_db_session),
    dispatcher: EventDispatcher = Depends(get_event_dispatcher),
) -> dict:
    """Update payment term fields with audit logging and live event broadcast."""
    item = await service.update(term_id, **payload.model_dump(exclude_unset=True))
    item_read = _to_read(item)
    await _record_action(
        audit_service=audit_service,
        request=request,
        action=AuditAction.UPDATE,
        actor=current_user,
        entity_id=term_id,
        description=f"Updated payment term '{item.name}'",
        new_values=item_read,
    )
    await _publish_payment_term_event(
        db=db,
        dispatcher=dispatcher,
        event_type="updated",
        term_id=term_id,
        user_id=current_user.id,
        changes=item_read,
    )
    return build_success_response(
        data=item_read,
        message="Payment term updated successfully.",
        request_id=request.state.request_id,
    )


@router.patch("/{term_id}/activate", summary="Activate a payment term entry")
async def activate_payment_term(
    term_id: uuid.UUID,
    request: Request,
    service: PaymentTermService = Depends(get_payment_term_service),
    current_user: CurrentUser = Depends(require_permission("payment_term.update")),
    audit_service: AuditService = Depends(get_audit_service),
    db: AsyncSession = Depends(get_db_session),
    dispatcher: EventDispatcher = Depends(get_event_dispatcher),
) -> dict:
    """Set payment term status to ACTIVE."""
    item = await service.activate(term_id)
    item_read = _to_read(item)
    await _record_action(
        audit_service=audit_service,
        request=request,
        action=AuditAction.UPDATE,
        actor=current_user,
        entity_id=term_id,
        description=f"Activated payment term '{item.name}'",
        new_values={"status": item.status.value},
    )
    await _publish_payment_term_event(
        db=db,
        dispatcher=dispatcher,
        event_type="activated",
        term_id=term_id,
        user_id=current_user.id,
        changes=item_read,
    )
    return build_success_response(data=item_read, message="Payment term activated.", request_id=request.state.request_id)


@router.patch("/{term_id}/deactivate", summary="Deactivate a payment term entry")
async def deactivate_payment_term(
    term_id: uuid.UUID,
    request: Request,
    service: PaymentTermService = Depends(get_payment_term_service),
    current_user: CurrentUser = Depends(require_permission("payment_term.update")),
    audit_service: AuditService = Depends(get_audit_service),
    db: AsyncSession = Depends(get_db_session),
    dispatcher: EventDispatcher = Depends(get_event_dispatcher),
) -> dict:
    """Set payment term status to INACTIVE."""
    item = await service.deactivate(term_id)
    item_read = _to_read(item)
    await _record_action(
        audit_service=audit_service,
        request=request,
        action=AuditAction.UPDATE,
        actor=current_user,
        entity_id=term_id,
        description=f"Deactivated payment term '{item.name}'",
        new_values={"status": item.status.value},
    )
    await _publish_payment_term_event(
        db=db,
        dispatcher=dispatcher,
        event_type="deactivated",
        term_id=term_id,
        user_id=current_user.id,
        changes=item_read,
    )
    return build_success_response(data=item_read, message="Payment term deactivated.", request_id=request.state.request_id)


@router.delete("/{term_id}", status_code=status.HTTP_200_OK, summary="Soft-delete a payment term entry")
async def delete_payment_term(
    term_id: uuid.UUID,
    request: Request,
    service: PaymentTermService = Depends(get_payment_term_service),
    current_user: CurrentUser = Depends(require_permission("payment_term.delete")),
    audit_service: AuditService = Depends(get_audit_service),
    db: AsyncSession = Depends(get_db_session),
    dispatcher: EventDispatcher = Depends(get_event_dispatcher),
) -> dict:
    """Soft-delete a payment term record."""
    item = await service.get_by_id_or_raise(term_id)
    name = item.name
    await service.delete(term_id)
    await _record_action(
        audit_service=audit_service,
        request=request,
        action=AuditAction.DELETE,
        actor=current_user,
        entity_id=term_id,
        description=f"Deleted payment term '{name}'",
    )
    await _publish_payment_term_event(
        db=db,
        dispatcher=dispatcher,
        event_type="deleted",
        term_id=term_id,
        user_id=current_user.id,
        changes={"name": name},
    )
    return build_success_response(data={"id": str(term_id)}, message="Payment term deleted.", request_id=request.state.request_id)
