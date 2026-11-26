"""PaymentMode Routes."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, File, Query, Request, UploadFile, status
from fastapi.responses import Response

from app.audit.constants import AuditAction
from app.audit.dependencies import get_audit_service
from app.audit.service import AuditService
from app.auth.dependencies import get_current_user
from app.auth.service import CurrentUser
from app.common.list_query import ListQueryParams, get_list_query_params
from app.common.pagination import PageMeta
from app.core.responses import build_success_response
from app.masters.payment_modes.dependencies import get_payment_mode_service
from app.masters.payment_modes.schemas import (
    ImportSummaryRead,
    PaymentModeCreate,
    PaymentModeRead,
    PaymentModeUpdate,
)
from app.masters.payment_modes.service import PaymentModeService
from app.rbac.dependencies import require_any_permission, require_permission

router = APIRouter(prefix="/masters/payment-modes", tags=["Masters - Payment Modes"])


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
    await audit_service.record(
        action=action,
        module="masters.payment_modes",
        user_id=actor.id,
        username_snapshot=actor.username,
        entity_type="PaymentMode",
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


@router.post("", status_code=status.HTTP_201_CREATED, summary="Create payment mode / bank account")
async def create_payment_mode(
    payload: PaymentModeCreate,
    request: Request,
    service: PaymentModeService = Depends(get_payment_mode_service),
    current_user: CurrentUser = Depends(require_permission("payment_mode.create")),
    audit_service: AuditService = Depends(get_audit_service),
) -> dict:
    item = await service.create(**payload.model_dump())
    data = PaymentModeRead.model_validate(item).model_dump(mode="json")
    await _record_action(
        audit_service=audit_service,
        request=request,
        action=AuditAction.CREATE,
        actor=current_user,
        entity_id=item.id,
        description=f"Created payment mode {item.name!r}.",
        new_values=payload.model_dump(mode="json"),
    )
    return build_success_response(data=data, request_id=request.state.request_id, message="Resource created successfully.")


@router.get("", summary="List payment modes / bank accounts")
async def list_payment_modes(
    request: Request,
    query: ListQueryParams = Depends(get_list_query_params),
    service: PaymentModeService = Depends(get_payment_mode_service),
    _current_user: CurrentUser = Depends(
        require_any_permission(
            "payment_mode.view",
            "finance_report.view",
            "finance_report.create",
            "finance_report.update",
            "consignment_overview.view",
            "consignment_overview.finance.view",
        )
    ),
) -> dict:
    items, total = await service.list_paginated(query)
    meta = PageMeta.build(page=query.page.page, page_size=query.page.page_size, total_records=total).as_meta_dict()
    data = [PaymentModeRead.model_validate(b).model_dump(mode="json") for b in items]
    return build_success_response(data=data, request_id=request.state.request_id, meta=meta)


@router.get("/export", summary="Export payment modes to CSV/Excel")
async def export_payment_modes(
    request: Request,
    format: str = "csv",
    service: PaymentModeService = Depends(get_payment_mode_service),
    current_user: CurrentUser = Depends(require_permission("payment_mode.export")),
    audit_service: AuditService = Depends(get_audit_service),
) -> Response:
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
        description=f"Exported payment modes as {file_format}.",
    )
    media_type = "text/csv" if file_format == "csv" else "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    filename = f"payment_modes.{file_format}"
    return Response(content=content, media_type=media_type, headers={"Content-Disposition": f"attachment; filename={filename}"})


@router.post("/import", summary="Import payment modes from CSV/Excel")
async def import_payment_modes(
    request: Request,
    file: UploadFile = File(...),
    update_existing: bool = Query(False, description="Update existing records matching name instead of skipping"),
    service: PaymentModeService = Depends(get_payment_mode_service),
    current_user: CurrentUser = Depends(require_permission("payment_mode.import")),
    audit_service: AuditService = Depends(get_audit_service),
) -> dict:
    raw_bytes = await file.read()
    summary = await service.import_file(file.filename or "import.csv", raw_bytes, update_existing=update_existing)
    await _record_action(
        audit_service=audit_service,
        request=request,
        action=AuditAction.IMPORT,
        actor=current_user,
        entity_id="bulk",
        description=f"Imported payment modes: {summary.created} created, {summary.updated} updated, {summary.failed} failed.",
        new_values=summary.as_dict(),
    )
    data = ImportSummaryRead(**summary.as_dict()).model_dump(mode="json")
    return build_success_response(data=data, request_id=request.state.request_id)


@router.get("/{payment_mode_id}", summary="Get a payment mode")
async def get_payment_mode(
    payment_mode_id: uuid.UUID,
    request: Request,
    service: PaymentModeService = Depends(get_payment_mode_service),
    _current_user: CurrentUser = Depends(get_current_user),
) -> dict:
    """Fetch a single payment mode by ID (authenticated lookup)."""
    item = await service.get_by_id_or_raise(payment_mode_id)
    data = PaymentModeRead.model_validate(item).model_dump(mode="json")
    return build_success_response(data=data, request_id=request.state.request_id)


@router.patch("/{payment_mode_id}", summary="Update a payment mode")
async def update_payment_mode(
    payment_mode_id: uuid.UUID,
    payload: PaymentModeUpdate,
    request: Request,
    service: PaymentModeService = Depends(get_payment_mode_service),
    current_user: CurrentUser = Depends(require_permission("payment_mode.update")),
    audit_service: AuditService = Depends(get_audit_service),
) -> dict:
    item = await service.update(payment_mode_id, **payload.model_dump())
    data = PaymentModeRead.model_validate(item).model_dump(mode="json")
    await _record_action(
        audit_service=audit_service,
        request=request,
        action=AuditAction.UPDATE,
        actor=current_user,
        entity_id=item.id,
        description=f"Updated payment mode {item.name!r}.",
        new_values=payload.model_dump(exclude_none=True, mode="json"),
    )
    return build_success_response(data=data, request_id=request.state.request_id)


@router.post("/{payment_mode_id}/activate", summary="Activate a payment mode")
async def activate_payment_mode(
    payment_mode_id: uuid.UUID,
    request: Request,
    service: PaymentModeService = Depends(get_payment_mode_service),
    current_user: CurrentUser = Depends(require_permission("payment_mode.update")),
    audit_service: AuditService = Depends(get_audit_service),
) -> dict:
    item = await service.activate(payment_mode_id)
    data = PaymentModeRead.model_validate(item).model_dump(mode="json")
    await _record_action(
        audit_service=audit_service,
        request=request,
        action=AuditAction.UPDATE,
        actor=current_user,
        entity_id=item.id,
        description=f"Activated payment mode {item.name!r}.",
    )
    return build_success_response(data=data, request_id=request.state.request_id)


@router.post("/{payment_mode_id}/deactivate", summary="Deactivate a payment mode")
async def deactivate_payment_mode(
    payment_mode_id: uuid.UUID,
    request: Request,
    service: PaymentModeService = Depends(get_payment_mode_service),
    current_user: CurrentUser = Depends(require_permission("payment_mode.update")),
    audit_service: AuditService = Depends(get_audit_service),
) -> dict:
    item = await service.deactivate(payment_mode_id)
    data = PaymentModeRead.model_validate(item).model_dump(mode="json")
    await _record_action(
        audit_service=audit_service,
        request=request,
        action=AuditAction.UPDATE,
        actor=current_user,
        entity_id=item.id,
        description=f"Deactivated payment mode {item.name!r}.",
    )
    return build_success_response(data=data, request_id=request.state.request_id)


@router.delete("/{payment_mode_id}", summary="Delete a payment mode")
async def delete_payment_mode(
    payment_mode_id: uuid.UUID,
    request: Request,
    service: PaymentModeService = Depends(get_payment_mode_service),
    current_user: CurrentUser = Depends(require_permission("payment_mode.delete")),
    audit_service: AuditService = Depends(get_audit_service),
) -> dict:
    await service.delete(payment_mode_id)
    await _record_action(
        audit_service=audit_service,
        request=request,
        action=AuditAction.DELETE,
        actor=current_user,
        entity_id=payment_mode_id,
        description="Deleted payment mode.",
    )
    return build_success_response(data={"deleted": True}, request_id=request.state.request_id)
