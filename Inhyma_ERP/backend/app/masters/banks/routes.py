"""Bank Routes. Standard CRUD + activate/deactivate + import/export, with audit logging."""

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
from app.masters.banks.dependencies import get_bank_service
from app.masters.banks.models import Bank
from app.masters.banks.schemas import (
    BankCreate,
    BankLookup,
    BankRead,
    BankUpdate,
    ImportSummaryRead,
)
from app.masters.banks.service import BankService
from app.rbac.dependencies import require_permission

router = APIRouter(prefix="/masters/banks", tags=["Masters - Banks"])


class BulkActionRequest(BaseModel):
    """Payload for bulk actions on banks."""

    ids: list[uuid.UUID]
    action: str


def _to_read(item: Bank) -> dict:
    """Serialize Bank model to BankRead dictionary."""
    read = BankRead(
        id=item.id,
        bank_name=item.bank_name,
        account_number=item.account_number,
        account_holder_name=item.account_holder_name,
        ifsc_code=item.ifsc_code,
        branch=item.branch,
        status=item.status,
        created_at=item.created_at,
        updated_at=item.updated_at,
        version=item.version,
    )
    return read.model_dump(mode="json")


async def _publish_bank_event(
    *,
    db: AsyncSession,
    dispatcher: EventDispatcher,
    event_type: str,
    bank_id: uuid.UUID | str,
    user_id: uuid.UUID,
    changes: dict,
) -> None:
    """Commit ``db``, then publish a ``bank.*`` live event on ``module:banks``."""
    await dispatcher.publish_lifecycle_event(
        db,
        module="banks",
        entity="bank",
        entity_id=bank_id,
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
    """Shared helper: record a bank action and mark the request as logged."""
    await audit_service.record(
        action=action,
        module="masters.banks",
        user_id=actor.id,
        username_snapshot=actor.username,
        entity_type="Bank",
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


@router.post("", status_code=status.HTTP_201_CREATED, summary="Create a bank entry")
async def create_bank(
    payload: BankCreate,
    request: Request,
    service: BankService = Depends(get_bank_service),
    current_user: CurrentUser = Depends(require_permission("bank.create")),
    audit_service: AuditService = Depends(get_audit_service),
    db: AsyncSession = Depends(get_db_session),
    dispatcher: EventDispatcher = Depends(get_event_dispatcher),
) -> dict:
    """Create a new bank entry."""
    item = await service.create(**payload.model_dump())
    data = _to_read(item)
    await _record_action(
        audit_service=audit_service,
        request=request,
        action=AuditAction.CREATE,
        actor=current_user,
        entity_id=item.id,
        description=f"Created bank account {item.account_number!r} ({item.bank_name}).",
        new_values=data,
    )
    await _publish_bank_event(
        db=db,
        dispatcher=dispatcher,
        event_type="bank.created",
        bank_id=item.id,
        user_id=current_user.id,
        changes=data,
    )
    return build_success_response(data=data, request_id=request.state.request_id, message="Bank created successfully.")


@router.get("", summary="List banks with pagination and filters")
async def list_banks(
    request: Request,
    query_params: ListQueryParams = Depends(get_list_query_params),
    service: BankService = Depends(get_bank_service),
    current_user: CurrentUser = Depends(require_permission("bank.view")),
) -> dict:
    """Return a paginated list of bank entries."""
    items, total = await service.list_paginated(query_params)
    meta = PageMeta.build(page=query_params.page.page, page_size=query_params.page.page_size, total_records=total).as_meta_dict()
    data = [_to_read(i) for i in items]
    return build_success_response(data=data, meta=meta, request_id=request.state.request_id)


@router.get("/lookup", summary="List active banks for select dropdowns")
async def lookup_banks(
    request: Request,
    service: BankService = Depends(get_bank_service),
    current_user: CurrentUser = Depends(require_permission("bank.view")),
) -> dict:
    """Return cached minimal bank list for dropdown selectors."""
    items = await service.list_all_cached()
    data = [BankLookup.model_validate(i).model_dump(mode="json") for i in items]
    return build_success_response(data=data, request_id=request.state.request_id)


@router.get("/export", summary="Export bank master data to CSV or Excel")
async def export_banks(
    format: str = "csv",
    service: BankService = Depends(get_bank_service),
    current_user: CurrentUser = Depends(require_permission("bank.export")),
) -> Response:
    """Stream an exported file containing all bank records."""
    fmt = format.lower().strip()
    if fmt not in ("csv", "xlsx", "excel"):
        fmt = "csv"
    norm_fmt = "xlsx" if fmt in ("xlsx", "excel") else "csv"
    raw = await service.export_file(norm_fmt)
    if norm_fmt == "csv":
        return Response(
            content=raw,
            media_type="text/csv",
            headers={"Content-Disposition": 'attachment; filename="banks.csv"'},
        )
    return Response(
        content=raw,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="banks.xlsx"'},
    )


@router.post("/import", summary="Import bank records from CSV or Excel")
async def import_banks(
    request: Request,
    file: UploadFile = File(...),
    service: BankService = Depends(get_bank_service),
    current_user: CurrentUser = Depends(require_permission("bank.import")),
    audit_service: AuditService = Depends(get_audit_service),
) -> dict:
    """Bulk-import bank records from a CSV or XLSX file."""
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
        description=f"Imported bank file {filename!r}: {summary.created} created, {summary.failed} failed.",
        new_values=data,
    )
    return build_success_response(data=data, request_id=request.state.request_id, message="Import completed.")


@router.post("/bulk-action", summary="Perform bulk operations on banks")
async def bulk_action(
    payload: BulkActionRequest,
    request: Request,
    service: BankService = Depends(get_bank_service),
    current_user: CurrentUser = Depends(require_permission("bank.bulk_action")),
    audit_service: AuditService = Depends(get_audit_service),
    db: AsyncSession = Depends(get_db_session),
    dispatcher: EventDispatcher = Depends(get_event_dispatcher),
) -> dict:
    """Perform bulk operations (delete, activate, deactivate) on selected banks."""
    action = payload.action.lower()
    affected = 0
    for bank_id in payload.ids:
        if action == "delete":
            await service.delete(bank_id)
            await _publish_bank_event(
                db=db,
                dispatcher=dispatcher,
                event_type="bank.deleted",
                bank_id=bank_id,
                user_id=current_user.id,
                changes={"deleted": True},
            )
            affected += 1
        elif action == "activate":
            await service.activate(bank_id)
            await _publish_bank_event(
                db=db,
                dispatcher=dispatcher,
                event_type="bank.activated",
                bank_id=bank_id,
                user_id=current_user.id,
                changes={"status": "ACTIVE"},
            )
            affected += 1
        elif action == "deactivate":
            await service.deactivate(bank_id)
            await _publish_bank_event(
                db=db,
                dispatcher=dispatcher,
                event_type="bank.deactivated",
                bank_id=bank_id,
                user_id=current_user.id,
                changes={"status": "INACTIVE"},
            )
            affected += 1
        else:
            raise BadRequestException(f"Unsupported bulk action: {payload.action}")

    await _record_action(
        audit_service=audit_service,
        request=request,
        action=AuditAction.BULK_DELETE if action == "delete" else AuditAction.UPDATE,
        actor=current_user,
        entity_id="bulk",
        description=f"Bulk {action} on {affected} banks.",
    )
    return build_success_response(data={"affected": affected}, request_id=request.state.request_id, message=f"Bulk {action} completed.")


@router.get("/{bank_id}", summary="Get a bank by ID")
async def get_bank(
    bank_id: uuid.UUID,
    request: Request,
    service: BankService = Depends(get_bank_service),
    current_user: CurrentUser = Depends(require_permission("bank.view")),
) -> dict:
    """Fetch details of a single bank record."""
    item = await service.get_by_id_or_raise(bank_id)
    return build_success_response(data=_to_read(item), request_id=request.state.request_id)


@router.put("/{bank_id}", summary="Update a bank entry")
async def update_bank(
    bank_id: uuid.UUID,
    payload: BankUpdate,
    request: Request,
    service: BankService = Depends(get_bank_service),
    current_user: CurrentUser = Depends(require_permission("bank.update")),
    audit_service: AuditService = Depends(get_audit_service),
    db: AsyncSession = Depends(get_db_session),
    dispatcher: EventDispatcher = Depends(get_event_dispatcher),
) -> dict:
    """Update fields of an existing bank."""
    item = await service.update(bank_id, **payload.model_dump(exclude_unset=True))
    data = _to_read(item)
    await _record_action(
        audit_service=audit_service,
        request=request,
        action=AuditAction.UPDATE,
        actor=current_user,
        entity_id=bank_id,
        description=f"Updated bank {item.account_number!r}.",
        new_values=data,
    )
    await _publish_bank_event(
        db=db,
        dispatcher=dispatcher,
        event_type="bank.updated",
        bank_id=bank_id,
        user_id=current_user.id,
        changes=data,
    )
    return build_success_response(data=data, request_id=request.state.request_id, message="Bank updated successfully.")


@router.patch("/{bank_id}/activate", summary="Activate a bank")
async def activate_bank(
    bank_id: uuid.UUID,
    request: Request,
    service: BankService = Depends(get_bank_service),
    current_user: CurrentUser = Depends(require_permission("bank.update")),
    audit_service: AuditService = Depends(get_audit_service),
    db: AsyncSession = Depends(get_db_session),
    dispatcher: EventDispatcher = Depends(get_event_dispatcher),
) -> dict:
    """Mark a bank as active."""
    item = await service.activate(bank_id)
    data = _to_read(item)
    await _record_action(
        audit_service=audit_service,
        request=request,
        action=AuditAction.UPDATE,
        actor=current_user,
        entity_id=bank_id,
        description=f"Activated bank {item.account_number!r}.",
        new_values={"status": item.status.value},
    )
    await _publish_bank_event(
        db=db,
        dispatcher=dispatcher,
        event_type="bank.activated",
        bank_id=bank_id,
        user_id=current_user.id,
        changes={"status": item.status.value},
    )
    return build_success_response(data=data, request_id=request.state.request_id, message="Bank activated successfully.")


@router.patch("/{bank_id}/deactivate", summary="Deactivate a bank")
async def deactivate_bank(
    bank_id: uuid.UUID,
    request: Request,
    service: BankService = Depends(get_bank_service),
    current_user: CurrentUser = Depends(require_permission("bank.update")),
    audit_service: AuditService = Depends(get_audit_service),
    db: AsyncSession = Depends(get_db_session),
    dispatcher: EventDispatcher = Depends(get_event_dispatcher),
) -> dict:
    """Mark a bank as inactive."""
    item = await service.deactivate(bank_id)
    data = _to_read(item)
    await _record_action(
        audit_service=audit_service,
        request=request,
        action=AuditAction.UPDATE,
        actor=current_user,
        entity_id=bank_id,
        description=f"Deactivated bank {item.account_number!r}.",
        new_values={"status": item.status.value},
    )
    await _publish_bank_event(
        db=db,
        dispatcher=dispatcher,
        event_type="bank.deactivated",
        bank_id=bank_id,
        user_id=current_user.id,
        changes={"status": item.status.value},
    )
    return build_success_response(data=data, request_id=request.state.request_id, message="Bank deactivated successfully.")


@router.delete("/{bank_id}", status_code=status.HTTP_200_OK, summary="Soft-delete a bank")
async def delete_bank(
    bank_id: uuid.UUID,
    request: Request,
    service: BankService = Depends(get_bank_service),
    current_user: CurrentUser = Depends(require_permission("bank.delete")),
    audit_service: AuditService = Depends(get_audit_service),
    db: AsyncSession = Depends(get_db_session),
    dispatcher: EventDispatcher = Depends(get_event_dispatcher),
) -> dict:
    """Soft-delete a bank entry."""
    await service.delete(bank_id)
    await _record_action(
        audit_service=audit_service,
        request=request,
        action=AuditAction.DELETE,
        actor=current_user,
        entity_id=bank_id,
        description=f"Soft-deleted bank {bank_id}.",
    )
    await _publish_bank_event(
        db=db,
        dispatcher=dispatcher,
        event_type="bank.deleted",
        bank_id=bank_id,
        user_id=current_user.id,
        changes={"deleted": True},
    )
    return build_success_response(data=None, request_id=request.state.request_id, message="Bank deleted successfully.")
