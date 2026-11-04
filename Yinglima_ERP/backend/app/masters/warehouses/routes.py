"""Warehouse Routes."""

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
from app.masters.warehouses.dependencies import get_warehouse_service
from app.masters.warehouses.schemas import (
    ImportSummaryRead,
    WarehouseCreate,
    WarehouseRead,
    WarehouseUpdate,
)
from app.masters.warehouses.service import WarehouseService
from app.rbac.dependencies import require_any_permission

router = APIRouter(prefix="/masters/warehouses", tags=["Masters - Warehouses"])


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


@router.post("", status_code=status.HTTP_201_CREATED, summary="Create warehouse")
async def create_warehouse(
    payload: WarehouseCreate,
    request: Request,
    service: WarehouseService = Depends(get_warehouse_service),
    current_user: CurrentUser = Depends(require_any_permission("warehouse.create", "product.create", "stock_movement.inward")),
    audit_service: AuditService = Depends(get_audit_service),
) -> dict:
    item = await service.create(**payload.model_dump())
    data = WarehouseRead.model_validate(item).model_dump(mode="json")
    await _record_action(
        audit_service=audit_service,
        request=request,
        action=AuditAction.CREATE,
        actor=current_user,
        entity_id=item.id,
        description=f"Created warehouse {item.name!r}.",
        new_values=payload.model_dump(mode="json"),
    )
    return build_success_response(data=data, request_id=request.state.request_id, message="Resource created successfully.")


@router.get("", summary="List warehouses")
async def list_warehouses(
    request: Request,
    query: ListQueryParams = Depends(get_list_query_params),
    service: WarehouseService = Depends(get_warehouse_service),
    _current_user: CurrentUser = Depends(get_current_user),
) -> dict:
    items, total = await service.list_paginated(query)
    meta = PageMeta.build(page=query.page.page, page_size=query.page.page_size, total_records=total).as_meta_dict()
    data = [WarehouseRead.model_validate(w).model_dump(mode="json") for w in items]
    return build_success_response(data=data, request_id=request.state.request_id, meta=meta)


@router.get("/all", summary="List all active warehouses for dropdowns")
async def list_all_warehouses(
    request: Request,
    service: WarehouseService = Depends(get_warehouse_service),
    _current_user: CurrentUser = Depends(get_current_user),
) -> dict:
    items = await service.repository.list_all(active_only=True)
    data = [WarehouseRead.model_validate(w).model_dump(mode="json") for w in items]
    return build_success_response(data=data, request_id=request.state.request_id)


@router.get("/export", summary="Export warehouses to CSV/Excel")
async def export_warehouses(
    request: Request,
    format: str = "csv",
    service: WarehouseService = Depends(get_warehouse_service),
    current_user: CurrentUser = Depends(require_any_permission("warehouse.export", "product.export", "stock_movement.view")),
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
        description=f"Exported warehouses as {file_format}.",
    )
    media_type = "text/csv" if file_format == "csv" else "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    filename = f"warehouses.{file_format}"
    return Response(content=content, media_type=media_type, headers={"Content-Disposition": f"attachment; filename={filename}"})


@router.post("/import", summary="Import warehouses from CSV/Excel")
async def import_warehouses(
    request: Request,
    file: UploadFile = File(...),
    update_existing: bool = Query(False, description="Update existing records matching name instead of skipping"),
    service: WarehouseService = Depends(get_warehouse_service),
    current_user: CurrentUser = Depends(require_any_permission("warehouse.import", "product.import", "product.create")),
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
        description=f"Imported warehouses: {summary.created} created, {summary.updated} updated, {summary.failed} failed.",
    )
    data = ImportSummaryRead.model_validate(summary).model_dump(mode="json")
    return build_success_response(data=data, request_id=request.state.request_id, message="Import complete.")


@router.get("/{warehouse_id}", summary="Get warehouse details")
async def get_warehouse(
    warehouse_id: uuid.UUID,
    request: Request,
    service: WarehouseService = Depends(get_warehouse_service),
    _current_user: CurrentUser = Depends(get_current_user),
) -> dict:
    """Fetch a single warehouse by ID."""
    item = await service.get_by_id_or_raise(warehouse_id)
    data = WarehouseRead.model_validate(item).model_dump(mode="json")
    return build_success_response(data=data, request_id=request.state.request_id)


@router.patch("/{warehouse_id}", summary="Update warehouse")
async def update_warehouse(
    warehouse_id: uuid.UUID,
    payload: WarehouseUpdate,
    request: Request,
    service: WarehouseService = Depends(get_warehouse_service),
    current_user: CurrentUser = Depends(require_any_permission("warehouse.update", "product.update")),
    audit_service: AuditService = Depends(get_audit_service),
) -> dict:
    item = await service.update(warehouse_id, **payload.model_dump(exclude_unset=True))
    data = WarehouseRead.model_validate(item).model_dump(mode="json")
    await _record_action(
        audit_service=audit_service,
        request=request,
        action=AuditAction.UPDATE,
        actor=current_user,
        entity_id=warehouse_id,
        description=f"Updated warehouse {item.name!r}.",
        new_values=payload.model_dump(exclude_unset=True, mode="json"),
    )
    return build_success_response(data=data, request_id=request.state.request_id)


@router.post("/{warehouse_id}/activate", summary="Activate warehouse")
async def activate_warehouse(
    warehouse_id: uuid.UUID,
    request: Request,
    service: WarehouseService = Depends(get_warehouse_service),
    current_user: CurrentUser = Depends(require_any_permission("warehouse.update", "product.update")),
    audit_service: AuditService = Depends(get_audit_service),
) -> dict:
    item = await service.activate(warehouse_id)
    data = WarehouseRead.model_validate(item).model_dump(mode="json")
    await _record_action(
        audit_service=audit_service,
        request=request,
        action=AuditAction.UPDATE,
        actor=current_user,
        entity_id=warehouse_id,
        description=f"Activated warehouse {item.name!r}.",
    )
    return build_success_response(data=data, request_id=request.state.request_id)


@router.post("/{warehouse_id}/deactivate", summary="Deactivate warehouse")
async def deactivate_warehouse(
    warehouse_id: uuid.UUID,
    request: Request,
    service: WarehouseService = Depends(get_warehouse_service),
    current_user: CurrentUser = Depends(require_any_permission("warehouse.update", "product.update")),
    audit_service: AuditService = Depends(get_audit_service),
) -> dict:
    item = await service.deactivate(warehouse_id)
    data = WarehouseRead.model_validate(item).model_dump(mode="json")
    await _record_action(
        audit_service=audit_service,
        request=request,
        action=AuditAction.UPDATE,
        actor=current_user,
        entity_id=warehouse_id,
        description=f"Deactivated warehouse {item.name!r}.",
    )
    return build_success_response(data=data, request_id=request.state.request_id)


@router.delete("/{warehouse_id}", status_code=status.HTTP_200_OK, summary="Delete warehouse")
async def delete_warehouse(
    warehouse_id: uuid.UUID,
    request: Request,
    service: WarehouseService = Depends(get_warehouse_service),
    current_user: CurrentUser = Depends(require_any_permission("warehouse.delete", "product.delete")),
    audit_service: AuditService = Depends(get_audit_service),
) -> dict:
    item = await service.get_by_id_or_raise(warehouse_id)
    await service.delete(warehouse_id)
    await _record_action(
        audit_service=audit_service,
        request=request,
        action=AuditAction.DELETE,
        actor=current_user,
        entity_id=warehouse_id,
        description=f"Deleted warehouse {item.name!r}.",
    )
    return build_success_response(data={"id": str(warehouse_id)}, request_id=request.state.request_id, message="Resource deleted successfully.")

