"""
Sale Process API Routes.

Exposes REST endpoints for:
- Listing and filtering sale orders
- Creating sale orders (with auto-consignment loading from Shipment Planning)
- Status workflow updates (Pending, Sales Confirmed, Admin Approved, Dispatched, LR, Cancelled)
- Shipment planning consignment column & items extraction
- KPI summary metrics (matching reference design)
- Excel export
"""

from __future__ import annotations

import io
import uuid
from datetime import date
from typing import Any

from fastapi import APIRouter, Depends, Query, Request, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_user
from app.auth.service import CurrentUser
from app.core.exceptions import NotFoundException
from app.core.logging import get_logger
from app.core.responses import build_success_response
from app.database.session import get_db_session
from app.sales.schemas import (
    PlanningConsignmentColumnResponse,
    PlanningConsignmentItemsResponse,
    SaleOrderDetailResponse,
    SaleOrderResponse,
    SaleOrderCreate,
    SaleOrderStatusUpdate,
    SaleOrderUpdate,
    SaleSummaryMetrics,
)
from app.sales.service import SaleService

logger = get_logger(__name__)

router = APIRouter(prefix="/sales", tags=["Sales - Sale Process"])


def get_sale_service(session: AsyncSession = Depends(get_db_session)) -> SaleService:
    return SaleService(session)


# ---------------------------------------------------------------------------
# KPI Summary Metrics
# ---------------------------------------------------------------------------

@router.get("/metrics", summary="Get sales KPI metrics grouped by status")
async def get_sales_metrics(
    request: Request,
    organization_id: uuid.UUID | None = Query(default=None),
    buyer_id: uuid.UUID | None = Query(default=None),
    currency: str | None = Query(default=None),
    date_from: date | None = Query(default=None),
    date_to: date | None = Query(default=None),
    service: SaleService = Depends(get_sale_service),
    current_user: CurrentUser = Depends(get_current_user),
) -> dict:
    req_id = getattr(request.state, "request_id", "-")
    metrics = await service.repo.get_metrics(
        organization_id=organization_id,
        buyer_id=buyer_id,
        currency=currency,
        date_from=date_from,
        date_to=date_to,
    )
    return build_success_response(data=metrics.model_dump(), request_id=req_id)


# ---------------------------------------------------------------------------
# Shipment Planning Integration
# ---------------------------------------------------------------------------

@router.get(
    "/planning-consignments",
    summary="List available consignment columns from Shipment Planning sheets",
)
async def list_planning_consignments(
    request: Request,
    organization_id: uuid.UUID | None = Query(default=None),
    buyer_id: uuid.UUID | None = Query(default=None),
    buyer_name: str | None = Query(default=None),
    sheet_id: uuid.UUID | None = Query(default=None),
    service: SaleService = Depends(get_sale_service),
    current_user: CurrentUser = Depends(get_current_user),
) -> dict:
    req_id = getattr(request.state, "request_id", "-")
    consignments = await service.get_planning_consignments(
        organization_id=organization_id,
        buyer_id=buyer_id,
        buyer_name=buyer_name,
        sheet_id=sheet_id,
    )
    return build_success_response(
        data=[c.model_dump() for c in consignments],
        request_id=req_id,
    )


@router.get(
    "/planning-consignments/{column_id}/items",
    summary="Extract planned products and quantities from a consignment column",
)
async def extract_consignment_items(
    column_id: uuid.UUID,
    request: Request,
    service: SaleService = Depends(get_sale_service),
    current_user: CurrentUser = Depends(get_current_user),
) -> dict:
    req_id = getattr(request.state, "request_id", "-")
    result = await service.extract_consignment_items(column_id)
    return build_success_response(data=result.model_dump(), request_id=req_id)


# ---------------------------------------------------------------------------
# Sales Order CRUD
# ---------------------------------------------------------------------------

@router.get("/orders", summary="List sale orders with filters & pagination")
async def list_sale_orders(
    request: Request,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=500),
    search: str | None = Query(default=None),
    organization_id: uuid.UUID | None = Query(default=None),
    buyer_id: uuid.UUID | None = Query(default=None),
    buyer_branch_id: str | None = Query(default=None),
    consignment_code: str | None = Query(default=None),
    status: str | None = Query(default=None),
    currency: str | None = Query(default=None),
    date_from: date | None = Query(default=None),
    date_to: date | None = Query(default=None),
    service: SaleService = Depends(get_sale_service),
    current_user: CurrentUser = Depends(get_current_user),
) -> dict:
    req_id = getattr(request.state, "request_id", "-")
    offset = (page - 1) * page_size
    records, total = await service.repo.list_with_filters(
        search=search,
        organization_id=organization_id,
        buyer_id=buyer_id,
        buyer_branch_id=buyer_branch_id,
        consignment_code=consignment_code,
        status=status,
        currency=currency,
        date_from=date_from,
        date_to=date_to,
        limit=page_size,
        offset=offset,
    )

    items = []
    for r in records:
        items.append(
            SaleOrderResponse(
                id=r.id,
                order_no=r.order_no,
                organization_id=r.organization_id,
                organization_name=r.organization_name,
                buyer_id=r.buyer_id,
                buyer_name=r.buyer_name,
                buyer_branch_id=r.buyer_branch_id,
                buyer_branch_name=r.buyer_branch_name,
                consignment_code=r.consignment_code,
                planning_sheet_id=r.planning_sheet_id,
                planning_column_id=r.planning_column_id,
                order_date=r.order_date,
                delivery_date=r.delivery_date,
                currency=r.currency,
                status=r.status,
                total_basic=float(r.total_basic),
                total_tax=float(r.total_tax),
                total_amount=float(r.total_amount),
                total_quantity=float(r.total_quantity),
                item_count=len(r.items),
                container_no=r.container_no,
                bl_no=r.bl_no,
                lr_no=r.lr_no,
                transporter_name=r.transporter_name,
                port_of_loading=r.port_of_loading,
                port_of_discharge=r.port_of_discharge,
                remarks=r.remarks,
                created_by_name=r.created_by_name,
                created_at=r.created_at,
                updated_at=r.updated_at,
            ).model_dump()
        )

    return build_success_response(
        data={
            "items": items,
            "total": total,
            "page": page,
            "page_size": page_size,
            "total_pages": (total + page_size - 1) // page_size if total > 0 else 1,
        },
        request_id=req_id,
    )


@router.post("/orders", summary="Create a new sale order", status_code=status.HTTP_201_CREATED)
async def create_sale_order(
    payload: SaleOrderCreate,
    request: Request,
    service: SaleService = Depends(get_sale_service),
    current_user: CurrentUser = Depends(get_current_user),
) -> dict:
    req_id = getattr(request.state, "request_id", "-")
    order = await service.create_order(payload, current_user=current_user)
    # Reload with items
    loaded = await service.repo.get_by_id(order.id)
    if not loaded:
        raise NotFoundException("Created order could not be reloaded.")
    return build_success_response(
        data=SaleOrderDetailResponse.model_validate(loaded).model_dump(),
        request_id=req_id,
    )


@router.get("/orders/{id}", summary="Get sale order details by ID")
async def get_sale_order(
    id: uuid.UUID,
    request: Request,
    service: SaleService = Depends(get_sale_service),
    current_user: CurrentUser = Depends(get_current_user),
) -> dict:
    req_id = getattr(request.state, "request_id", "-")
    order = await service.repo.get_by_id(id)
    if not order:
        raise NotFoundException(f"Sale order {id} not found.")
    return build_success_response(
        data=SaleOrderDetailResponse.model_validate(order).model_dump(),
        request_id=req_id,
    )


@router.patch("/orders/{id}", summary="Update a sale order")
async def update_sale_order(
    id: uuid.UUID,
    payload: SaleOrderUpdate,
    request: Request,
    service: SaleService = Depends(get_sale_service),
    current_user: CurrentUser = Depends(get_current_user),
) -> dict:
    req_id = getattr(request.state, "request_id", "-")
    order = await service.update_order(id, payload)
    loaded = await service.repo.get_by_id(order.id)
    if not loaded:
        raise NotFoundException("Updated order could not be reloaded.")
    return build_success_response(
        data=SaleOrderDetailResponse.model_validate(loaded).model_dump(),
        request_id=req_id,
    )


@router.patch("/orders/{id}/status", summary="Update status of a sale order")
async def update_order_status(
    id: uuid.UUID,
    payload: SaleOrderStatusUpdate,
    request: Request,
    service: SaleService = Depends(get_sale_service),
    current_user: CurrentUser = Depends(get_current_user),
) -> dict:
    req_id = getattr(request.state, "request_id", "-")
    order = await service.update_status(id, payload.status, payload.remarks)
    loaded = await service.repo.get_by_id(order.id)
    if not loaded:
        raise NotFoundException("Order could not be reloaded.")
    return build_success_response(
        data=SaleOrderDetailResponse.model_validate(loaded).model_dump(),
        request_id=req_id,
    )


@router.delete("/orders/{id}", summary="Soft delete a sale order")
async def delete_sale_order(
    id: uuid.UUID,
    request: Request,
    service: SaleService = Depends(get_sale_service),
    current_user: CurrentUser = Depends(get_current_user),
) -> dict:
    req_id = getattr(request.state, "request_id", "-")
    deleted_by = getattr(current_user, "name", getattr(current_user, "username", "Admin"))
    ok = await service.repo.soft_delete(id, deleted_by=deleted_by)
    if not ok:
        raise NotFoundException(f"Sale order {id} not found.")
    return build_success_response(
        data={"id": str(id), "deleted": True},
        request_id=req_id,
    )


@router.get("/export", summary="Export sales orders to Excel")
async def export_sale_orders(
    search: str | None = Query(default=None),
    organization_id: uuid.UUID | None = Query(default=None),
    buyer_id: uuid.UUID | None = Query(default=None),
    buyer_branch_id: str | None = Query(default=None),
    consignment_code: str | None = Query(default=None),
    status: str | None = Query(default=None),
    currency: str | None = Query(default=None),
    date_from: date | None = Query(default=None),
    date_to: date | None = Query(default=None),
    service: SaleService = Depends(get_sale_service),
    current_user: CurrentUser = Depends(get_current_user),
) -> Response:
    records, _ = await service.repo.list_with_filters(
        search=search,
        organization_id=organization_id,
        buyer_id=buyer_id,
        buyer_branch_id=buyer_branch_id,
        consignment_code=consignment_code,
        status=status,
        currency=currency,
        date_from=date_from,
        date_to=date_to,
        limit=5000,
        offset=0,
    )
    output = service.export_excel(records)
    filename = f"sales_orders_{date.today().isoformat()}.xlsx"
    return Response(
        content=output.getvalue(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
