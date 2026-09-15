"""Warehouse Routes. Standard CRUD + activate/deactivate + import/export, with audit logging."""

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
from app.masters.warehouses.dependencies import get_warehouse_service
from app.masters.warehouses.models import Warehouse
from app.masters.warehouses.schemas import (
    ImportSummaryRead,
    WarehouseCreate,
    WarehouseRead,
    WarehouseUpdate,
)
from app.masters.warehouses.service import WarehouseService
from app.rbac.dependencies import require_permission

router = APIRouter(prefix="/masters/warehouses", tags=["Masters - Warehouses"])


def _to_read(item: Warehouse) -> dict:
    """Serialize Warehouse model to WarehouseRead dictionary."""
    read = WarehouseRead(
        id=item.id,
        name=item.name,
        address=item.address,
        billing_company=item.billing_company,
        over_selling=item.over_selling,
        is_primary=item.is_primary,
        main_warehouse_id=item.main_warehouse_id,
        main_warehouse_name=item.main_warehouse.name if item.main_warehouse else None,
        color=item.color,
        status=item.status,
        created_at=item.created_at,
        updated_at=item.updated_at,
        version=item.version,
    )
    return read.model_dump(mode="json")


async def _publish_warehouse_event(
    *,
    db: AsyncSession,
    dispatcher: EventDispatcher,
    event_type: str,
    warehouse_id: uuid.UUID | str,
    user_id: uuid.UUID,
    changes: dict,
) -> None:
    """Commit ``db``, then publish a ``warehouse.*`` live event on ``module:warehouses``."""
    await dispatcher.publish_lifecycle_event(
        db,
        module="warehouses",
        entity="warehouse",
        entity_id=warehouse_id,
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
    """Shared helper: record a warehouse action and mark the request as logged."""
    await audit_service.record(
        action=action,
        module="masters.warehouses",
        user_id=actor.id,
        username_snapshot=actor.username,
        entity_type="Warehouse",
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


@router.post("", status_code=status.HTTP_201_CREATED, summary="Create a warehouse entry")
async def create_warehouse(
    payload: WarehouseCreate,
    request: Request,
    service: WarehouseService = Depends(get_warehouse_service),
    current_user: CurrentUser = Depends(require_permission("warehouse.create")),
    audit_service: AuditService = Depends(get_audit_service),
    db: AsyncSession = Depends(get_db_session),
    dispatcher: EventDispatcher = Depends(get_event_dispatcher),
) -> dict:
    """Create a new warehouse platform entry."""
    item = await service.create(**payload.model_dump())
    data = _to_read(item)
    await _record_action(
        audit_service=audit_service,
        request=request,
        action=AuditAction.CREATE,
        actor=current_user,
        entity_id=item.id,
        description=f"Created warehouse {item.name!r}.",
        new_values=payload.model_dump(mode="json"),
    )
    await _publish_warehouse_event(
        db=db,
        dispatcher=dispatcher,
        event_type="warehouse.created",
        warehouse_id=item.id,
        user_id=current_user.id,
        changes=payload.model_dump(mode="json"),
    )
    return build_success_response(data=data, request_id=request.state.request_id, message="Resource created successfully.")


@router.get("", summary="List warehouses")
async def list_warehouses(
    request: Request,
    query: ListQueryParams = Depends(get_list_query_params),
    service: WarehouseService = Depends(get_warehouse_service),
    _current_user: CurrentUser = Depends(require_permission("warehouse.view")),
) -> dict:
    """List warehouses, with search/sort/filter/pagination."""
    items, total = await service.list_paginated(query)
    meta = PageMeta.build(page=query.page.page, page_size=query.page.page_size, total_records=total).as_meta_dict()
    data = [_to_read(i) for i in items]
    return build_success_response(data=data, request_id=request.state.request_id, meta=meta)


@router.get("/export", summary="Export warehouses to CSV/Excel")
async def export_warehouses(
    request: Request,
    format: str = "csv",
    service: WarehouseService = Depends(get_warehouse_service),
    current_user: CurrentUser = Depends(require_permission("warehouse.export")),
    audit_service: AuditService = Depends(get_audit_service),
) -> Response:
    """Export every warehouse entry as a CSV or XLSX file."""
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
        description=f"Exported warehouses as {file_format}.",
    )
    media_type = "text/csv" if file_format == "csv" else "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    filename = f"warehouses_export.{file_format}"
    return Response(
        content=content,
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/import", summary="Import warehouses from CSV/Excel")
async def import_warehouses(
    request: Request,
    file: UploadFile = File(...),
    service: WarehouseService = Depends(get_warehouse_service),
    current_user: CurrentUser = Depends(require_permission("warehouse.import")),
    audit_service: AuditService = Depends(get_audit_service),
) -> dict:
    """Import warehouses from an uploaded CSV or XLSX file."""
    raw_bytes = await file.read()
    summary = await service.import_file(file.filename or "import.csv", raw_bytes)
    await _record_action(
        audit_service=audit_service,
        request=request,
        action=AuditAction.IMPORT,
        actor=current_user,
        entity_id="bulk",
        description=f"Imported warehouses: created={summary.created}, failed={summary.failed}.",
    )
    return build_success_response(
        data=ImportSummaryRead.model_validate(summary).model_dump(mode="json"),
        request_id=request.state.request_id,
        message=f"Import complete. {summary.created} records created.",
    )


@router.get("/lookup", summary="Lightweight warehouses lookup")
async def lookup_warehouses(
    service: WarehouseService = Depends(get_warehouse_service),
    _current_user: CurrentUser = Depends(get_current_user),
) -> dict:
    """Lightweight id/name lookup for dropdowns."""
    items = await service.list_all_cached()
    data = [
        {
            "id": str(i.id),
            "name": i.name,
            "billing_company": i.billing_company,
            "is_primary": i.is_primary,
            "status": i.status.value,
        }
        for i in items
        if i.status.value == "active"
    ]
    return build_success_response(data=data)


@router.get("/{warehouse_id}", summary="Get a warehouse by ID")
async def get_warehouse(
    warehouse_id: uuid.UUID,
    request: Request,
    service: WarehouseService = Depends(get_warehouse_service),
    _current_user: CurrentUser = Depends(require_permission("warehouse.view")),
) -> dict:
    """Fetch a warehouse entry by its UUID."""
    item = await service.get_by_id_or_raise(warehouse_id)
    data = _to_read(item)
    return build_success_response(data=data, request_id=request.state.request_id)


@router.put("/{warehouse_id}", summary="Update a warehouse")
async def update_warehouse(
    warehouse_id: uuid.UUID,
    payload: WarehouseUpdate,
    request: Request,
    service: WarehouseService = Depends(get_warehouse_service),
    current_user: CurrentUser = Depends(require_permission("warehouse.update")),
    audit_service: AuditService = Depends(get_audit_service),
    db: AsyncSession = Depends(get_db_session),
    dispatcher: EventDispatcher = Depends(get_event_dispatcher),
) -> dict:
    """Update an existing warehouse entry."""
    item = await service.update(warehouse_id, **payload.model_dump())
    data = _to_read(item)
    await _record_action(
        audit_service=audit_service,
        request=request,
        action=AuditAction.UPDATE,
        actor=current_user,
        entity_id=warehouse_id,
        description=f"Updated warehouse {item.name!r}.",
        new_values=payload.model_dump(mode="json"),
    )
    await _publish_warehouse_event(
        db=db,
        dispatcher=dispatcher,
        event_type="warehouse.updated",
        warehouse_id=warehouse_id,
        user_id=current_user.id,
        changes=payload.model_dump(mode="json"),
    )
    return build_success_response(data=data, request_id=request.state.request_id, message="Resource updated successfully.")


@router.patch("/{warehouse_id}/activate", summary="Activate a warehouse")
async def activate_warehouse(
    warehouse_id: uuid.UUID,
    request: Request,
    service: WarehouseService = Depends(get_warehouse_service),
    current_user: CurrentUser = Depends(require_permission("warehouse.update")),
    audit_service: AuditService = Depends(get_audit_service),
    db: AsyncSession = Depends(get_db_session),
    dispatcher: EventDispatcher = Depends(get_event_dispatcher),
) -> dict:
    """Set warehouse status to ACTIVE."""
    item = await service.activate(warehouse_id)
    data = _to_read(item)
    await _record_action(
        audit_service=audit_service,
        request=request,
        action=AuditAction.UPDATE,
        actor=current_user,
        entity_id=warehouse_id,
        description=f"Activated warehouse {item.name!r}.",
    )
    await _publish_warehouse_event(
        db=db,
        dispatcher=dispatcher,
        event_type="warehouse.activated",
        warehouse_id=warehouse_id,
        user_id=current_user.id,
        changes={"status": "active"},
    )
    return build_success_response(data=data, request_id=request.state.request_id, message="Warehouse activated.")


@router.patch("/{warehouse_id}/deactivate", summary="Deactivate a warehouse")
async def deactivate_warehouse(
    warehouse_id: uuid.UUID,
    request: Request,
    service: WarehouseService = Depends(get_warehouse_service),
    current_user: CurrentUser = Depends(require_permission("warehouse.update")),
    audit_service: AuditService = Depends(get_audit_service),
    db: AsyncSession = Depends(get_db_session),
    dispatcher: EventDispatcher = Depends(get_event_dispatcher),
) -> dict:
    """Set warehouse status to INACTIVE."""
    item = await service.deactivate(warehouse_id)
    data = _to_read(item)
    await _record_action(
        audit_service=audit_service,
        request=request,
        action=AuditAction.UPDATE,
        actor=current_user,
        entity_id=warehouse_id,
        description=f"Deactivated warehouse {item.name!r}.",
    )
    await _publish_warehouse_event(
        db=db,
        dispatcher=dispatcher,
        event_type="warehouse.deactivated",
        warehouse_id=warehouse_id,
        user_id=current_user.id,
        changes={"status": "inactive"},
    )
    return build_success_response(data=data, request_id=request.state.request_id, message="Warehouse deactivated.")


@router.delete("/{warehouse_id}", summary="Delete a warehouse")
async def delete_warehouse(
    warehouse_id: uuid.UUID,
    request: Request,
    service: WarehouseService = Depends(get_warehouse_service),
    current_user: CurrentUser = Depends(require_permission("warehouse.delete")),
    audit_service: AuditService = Depends(get_audit_service),
    db: AsyncSession = Depends(get_db_session),
    dispatcher: EventDispatcher = Depends(get_event_dispatcher),
) -> dict:
    """Soft-delete a warehouse record."""
    await service.delete(warehouse_id)
    await _record_action(
        audit_service=audit_service,
        request=request,
        action=AuditAction.DELETE,
        actor=current_user,
        entity_id=warehouse_id,
        description=f"Deleted warehouse {warehouse_id}.",
    )
    await _publish_warehouse_event(
        db=db,
        dispatcher=dispatcher,
        event_type="warehouse.deleted",
        warehouse_id=warehouse_id,
        user_id=current_user.id,
        changes={"deleted": True},
    )
    return build_success_response(data={"id": str(warehouse_id)}, request_id=request.state.request_id, message="Resource deleted successfully.")


@router.post("/bulk-status", summary="Bulk activate/deactivate warehouses")
async def bulk_status(
    payload: dict,
    request: Request,
    service: WarehouseService = Depends(get_warehouse_service),
    current_user: CurrentUser = Depends(require_permission("warehouse.bulk_action")),
    audit_service: AuditService = Depends(get_audit_service),
) -> dict:
    """Bulk update status for a list of warehouse IDs."""
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
        description=f"Bulk {target_status} applied to {updated} warehouse records.",
    )
    return build_success_response(data={"updated": updated}, request_id=request.state.request_id, message=f"{updated} records updated.")


@router.post("/bulk-delete", summary="Bulk delete warehouses")
async def bulk_delete(
    payload: dict,
    request: Request,
    service: WarehouseService = Depends(get_warehouse_service),
    current_user: CurrentUser = Depends(require_permission("warehouse.bulk_action")),
    audit_service: AuditService = Depends(get_audit_service),
) -> dict:
    """Bulk soft-delete for a list of warehouse IDs."""
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
        description=f"Bulk deleted {deleted} warehouse records.",
    )
    return build_success_response(data={"deleted": deleted}, request_id=request.state.request_id, message=f"{deleted} records deleted.")
