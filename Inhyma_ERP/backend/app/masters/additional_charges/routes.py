"""
Additional Charges Routes. Standard CRUD + activate/deactivate + import/export, with audit logging.
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
from app.masters.additional_charges.dependencies import get_additional_charge_service
from app.masters.additional_charges.schemas import (
    AdditionalChargeCreate,
    AdditionalChargeRead,
    AdditionalChargeUpdate,
    ImportSummaryRead,
)
from app.masters.additional_charges.service import AdditionalChargeService
from app.rbac.dependencies import require_permission

router = APIRouter(prefix="/masters/additional-charges", tags=["Masters - Additional Charges"])


async def _publish_additional_charge_event(
    *,
    db: AsyncSession,
    dispatcher: EventDispatcher,
    event_type: str,
    charge_id: uuid.UUID | str,
    user_id: uuid.UUID,
    changes: dict,
) -> None:
    """Commit ``db``, then publish an ``additional_charge.*`` live event on ``module:additional_charges``."""
    await dispatcher.publish_lifecycle_event(
        db,
        module="additional_charges",
        entity="additional_charge",
        entity_id=charge_id,
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
    """Shared helper: record an additional charge action and mark the request as logged."""
    await audit_service.record(
        action=action,
        module="masters.additional_charges",
        user_id=actor.id,
        username_snapshot=actor.username,
        entity_type="AdditionalCharge",
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


@router.post("", status_code=status.HTTP_201_CREATED, summary="Create an additional charge entry")
async def create_additional_charge(
    payload: AdditionalChargeCreate,
    request: Request,
    service: AdditionalChargeService = Depends(get_additional_charge_service),
    current_user: CurrentUser = Depends(require_permission("additionalcharge.create")),
    audit_service: AuditService = Depends(get_audit_service),
    db: AsyncSession = Depends(get_db_session),
    dispatcher: EventDispatcher = Depends(get_event_dispatcher),
) -> dict:
    """Create a new additional charge entry."""
    charge = await service.create(**payload.model_dump())
    data = AdditionalChargeRead.model_validate(charge).model_dump(mode="json")
    await _record_action(
        audit_service=audit_service,
        request=request,
        action=AuditAction.CREATE,
        actor=current_user,
        entity_id=charge.id,
        description=f"Created additional charge {charge.name!r} (GST {charge.gst_percent}%).",
        new_values=payload.model_dump(mode="json"),
    )
    await _publish_additional_charge_event(
        db=db,
        dispatcher=dispatcher,
        event_type="additional_charge.created",
        charge_id=charge.id,
        user_id=current_user.id,
        changes=payload.model_dump(mode="json"),
    )
    return build_success_response(data=data, request_id=request.state.request_id, message="Resource created successfully.")


@router.get("", summary="List additional charges")
async def list_additional_charges(
    request: Request,
    query: ListQueryParams = Depends(get_list_query_params),
    service: AdditionalChargeService = Depends(get_additional_charge_service),
    _current_user: CurrentUser = Depends(require_permission("additionalcharge.view")),
) -> dict:
    """List additional charges, with search/sort/filter/pagination."""
    charges, total = await service.list_paginated(query)
    meta = PageMeta.build(page=query.page.page, page_size=query.page.page_size, total_records=total).as_meta_dict()
    data = [AdditionalChargeRead.model_validate(c).model_dump(mode="json") for c in charges]
    return build_success_response(data=data, request_id=request.state.request_id, meta=meta)


@router.get("/export", summary="Export additional charges to CSV/Excel")
async def export_additional_charges(
    request: Request,
    format: str = "csv",
    service: AdditionalChargeService = Depends(get_additional_charge_service),
    current_user: CurrentUser = Depends(require_permission("additionalcharge.export")),
    audit_service: AuditService = Depends(get_audit_service),
) -> Response:
    """Export every additional charge entry as a CSV or XLSX file."""
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
        description=f"Exported additional charges as {file_format}.",
    )
    media_type = "text/csv" if file_format == "csv" else "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    filename = f"additional_charges_export.{file_format}"
    return Response(
        content=content,
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/import", summary="Import additional charges from CSV/Excel")
async def import_additional_charges(
    request: Request,
    file: UploadFile = File(...),
    service: AdditionalChargeService = Depends(get_additional_charge_service),
    current_user: CurrentUser = Depends(require_permission("additionalcharge.import")),
    audit_service: AuditService = Depends(get_audit_service),
) -> dict:
    """Import additional charges from an uploaded CSV or XLSX file."""
    raw_bytes = await file.read()
    summary = await service.import_file(file.filename or "import.csv", raw_bytes)
    await _record_action(
        audit_service=audit_service,
        request=request,
        action=AuditAction.IMPORT,
        actor=current_user,
        entity_id="bulk",
        description=f"Imported additional charges: created={summary.created}, failed={summary.failed}.",
    )
    return build_success_response(
        data=ImportSummaryRead.model_validate(summary).model_dump(mode="json"),
        request_id=request.state.request_id,
        message=f"Import complete. {summary.created} records created.",
    )


@router.get("/lookup", summary="Lightweight additional charges lookup")
async def lookup_additional_charges(
    service: AdditionalChargeService = Depends(get_additional_charge_service),
    _current_user: CurrentUser = Depends(get_current_user),
) -> dict:
    """Lightweight id/name lookup for dropdowns."""
    charges = await service.list_all_cached()
    data = [
        {
            "id": str(c.id),
            "name": c.name,
            "hsn_number": c.hsn_number,
            "gst_percent": float(c.gst_percent),
            "status": c.status.value,
        }
        for c in charges
        if c.status.value == "active"
    ]
    return build_success_response(data=data)


@router.get("/{charge_id}", summary="Get an additional charge by ID")
async def get_additional_charge(
    charge_id: uuid.UUID,
    request: Request,
    service: AdditionalChargeService = Depends(get_additional_charge_service),
    _current_user: CurrentUser = Depends(require_permission("additionalcharge.view")),
) -> dict:
    """Fetch an additional charge entry by its UUID."""
    charge = await service.get_by_id_or_raise(charge_id)
    data = AdditionalChargeRead.model_validate(charge).model_dump(mode="json")
    return build_success_response(data=data, request_id=request.state.request_id)


@router.put("/{charge_id}", summary="Update an additional charge")
async def update_additional_charge(
    charge_id: uuid.UUID,
    payload: AdditionalChargeUpdate,
    request: Request,
    service: AdditionalChargeService = Depends(get_additional_charge_service),
    current_user: CurrentUser = Depends(require_permission("additionalcharge.update")),
    audit_service: AuditService = Depends(get_audit_service),
    db: AsyncSession = Depends(get_db_session),
    dispatcher: EventDispatcher = Depends(get_event_dispatcher),
) -> dict:
    """Update an existing additional charge entry."""
    charge = await service.update(charge_id, **payload.model_dump())
    data = AdditionalChargeRead.model_validate(charge).model_dump(mode="json")
    await _record_action(
        audit_service=audit_service,
        request=request,
        action=AuditAction.UPDATE,
        actor=current_user,
        entity_id=charge_id,
        description=f"Updated additional charge {charge.name!r}.",
        new_values=payload.model_dump(mode="json"),
    )
    await _publish_additional_charge_event(
        db=db,
        dispatcher=dispatcher,
        event_type="additional_charge.updated",
        charge_id=charge_id,
        user_id=current_user.id,
        changes=payload.model_dump(mode="json"),
    )
    return build_success_response(data=data, request_id=request.state.request_id, message="Resource updated successfully.")


@router.patch("/{charge_id}/activate", summary="Activate an additional charge")
async def activate_additional_charge(
    charge_id: uuid.UUID,
    request: Request,
    service: AdditionalChargeService = Depends(get_additional_charge_service),
    current_user: CurrentUser = Depends(require_permission("additionalcharge.update")),
    audit_service: AuditService = Depends(get_audit_service),
    db: AsyncSession = Depends(get_db_session),
    dispatcher: EventDispatcher = Depends(get_event_dispatcher),
) -> dict:
    """Set additional charge status to ACTIVE."""
    charge = await service.activate(charge_id)
    data = AdditionalChargeRead.model_validate(charge).model_dump(mode="json")
    await _record_action(
        audit_service=audit_service,
        request=request,
        action=AuditAction.UPDATE,
        actor=current_user,
        entity_id=charge_id,
        description=f"Activated additional charge {charge.name!r}.",
    )
    await _publish_additional_charge_event(
        db=db,
        dispatcher=dispatcher,
        event_type="additional_charge.activated",
        charge_id=charge_id,
        user_id=current_user.id,
        changes={"status": "active"},
    )
    return build_success_response(data=data, request_id=request.state.request_id, message="Additional charge activated.")


@router.patch("/{charge_id}/deactivate", summary="Deactivate an additional charge")
async def deactivate_additional_charge(
    charge_id: uuid.UUID,
    request: Request,
    service: AdditionalChargeService = Depends(get_additional_charge_service),
    current_user: CurrentUser = Depends(require_permission("additionalcharge.update")),
    audit_service: AuditService = Depends(get_audit_service),
    db: AsyncSession = Depends(get_db_session),
    dispatcher: EventDispatcher = Depends(get_event_dispatcher),
) -> dict:
    """Set additional charge status to INACTIVE."""
    charge = await service.deactivate(charge_id)
    data = AdditionalChargeRead.model_validate(charge).model_dump(mode="json")
    await _record_action(
        audit_service=audit_service,
        request=request,
        action=AuditAction.UPDATE,
        actor=current_user,
        entity_id=charge_id,
        description=f"Deactivated additional charge {charge.name!r}.",
    )
    await _publish_additional_charge_event(
        db=db,
        dispatcher=dispatcher,
        event_type="additional_charge.deactivated",
        charge_id=charge_id,
        user_id=current_user.id,
        changes={"status": "inactive"},
    )
    return build_success_response(data=data, request_id=request.state.request_id, message="Additional charge deactivated.")


@router.delete("/{charge_id}", summary="Delete an additional charge")
async def delete_additional_charge(
    charge_id: uuid.UUID,
    request: Request,
    service: AdditionalChargeService = Depends(get_additional_charge_service),
    current_user: CurrentUser = Depends(require_permission("additionalcharge.delete")),
    audit_service: AuditService = Depends(get_audit_service),
    db: AsyncSession = Depends(get_db_session),
    dispatcher: EventDispatcher = Depends(get_event_dispatcher),
) -> dict:
    """Soft-delete an additional charge record."""
    await service.delete(charge_id)
    await _record_action(
        audit_service=audit_service,
        request=request,
        action=AuditAction.DELETE,
        actor=current_user,
        entity_id=charge_id,
        description=f"Deleted additional charge {charge_id}.",
    )
    await _publish_additional_charge_event(
        db=db,
        dispatcher=dispatcher,
        event_type="additional_charge.deleted",
        charge_id=charge_id,
        user_id=current_user.id,
        changes={"deleted": True},
    )
    return build_success_response(data={"id": str(charge_id)}, request_id=request.state.request_id, message="Resource deleted successfully.")


@router.post("/bulk-status", summary="Bulk activate/deactivate additional charges")
async def bulk_status(
    payload: dict,
    request: Request,
    service: AdditionalChargeService = Depends(get_additional_charge_service),
    current_user: CurrentUser = Depends(require_permission("additionalcharge.bulk_action")),
    audit_service: AuditService = Depends(get_audit_service),
) -> dict:
    """Bulk update status for a list of additional charge IDs."""
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
        description=f"Bulk {target_status} applied to {updated} additional charge records.",
    )
    return build_success_response(data={"updated": updated}, request_id=request.state.request_id, message=f"{updated} records updated.")


@router.post("/bulk-delete", summary="Bulk delete additional charges")
async def bulk_delete(
    payload: dict,
    request: Request,
    service: AdditionalChargeService = Depends(get_additional_charge_service),
    current_user: CurrentUser = Depends(require_permission("additionalcharge.bulk_action")),
    audit_service: AuditService = Depends(get_audit_service),
) -> dict:
    """Bulk soft-delete for a list of additional charge IDs."""
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
        description=f"Bulk deleted {deleted} additional charge records.",
    )
    return build_success_response(data={"deleted": deleted}, request_id=request.state.request_id, message=f"{deleted} records deleted.")
