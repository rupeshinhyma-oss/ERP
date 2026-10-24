"""
Stock Movement API Routes.

Exposes REST endpoints for:
- Listing and filtering Inward/Outward movements
- Creating Inward & Outward movements
- 1-Click extraction from Local Purchase bills and Sale Process orders
- Live stock balance ledger
- Product Kardex transaction history
"""

from __future__ import annotations

import uuid
from datetime import date
from typing import Any

from fastapi import APIRouter, Depends, Query, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_user
from app.auth.service import CurrentUser
from app.core.responses import build_success_response
from app.database.session import get_db_session
from app.rbac.dependencies import require_permission
from app.stock.schemas import (
    StockMovementCreate,
    StockMovementResponse,
    StockSummaryMetrics,
)
from app.stock.service import StockMovementService

router = APIRouter(prefix="/stock", tags=["Stock Movement"])


@router.get("/metrics", summary="Get overall stock and movement KPI metrics")
async def get_stock_metrics(
    request: Request,
    db: AsyncSession = Depends(get_db_session),
    current_user: CurrentUser = Depends(require_permission("stock_movement.view")),
) -> dict:
    service = StockMovementService(db)
    metrics = await service.get_summary_metrics()
    return build_success_response(
        data=metrics,
        request_id=getattr(request.state, "request_id", "-"),
    )


@router.get("/movements", summary="List stock movements (Inward or Outward)")
async def list_stock_movements(
    request: Request,
    movement_type: str | None = Query(None, description="inward or outward"),
    source_type: str | None = Query(None, description="local_purchase, sale_process, direct"),
    status: str | None = Query(None),
    date_from: date | None = Query(None),
    date_to: date | None = Query(None),
    search: str | None = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db_session),
    current_user: CurrentUser = Depends(require_permission("stock_movement.view")),
) -> dict:
    service = StockMovementService(db)
    offset = (page - 1) * page_size
    movements, total = await service.list_movements(
        movement_type=movement_type,
        source_type=source_type,
        status=status,
        date_from=date_from,
        date_to=date_to,
        search=search,
        limit=page_size,
        offset=offset,
    )
    data = [StockMovementResponse.model_validate(m).model_dump(mode="json") for m in movements]
    return build_success_response(
        data={"items": data, "total": total, "page": page, "page_size": page_size},
        request_id=getattr(request.state, "request_id", "-"),
    )


@router.post("/movements", status_code=status.HTTP_201_CREATED, summary="Create stock movement")
async def create_stock_movement(
    request: Request,
    payload: StockMovementCreate,
    db: AsyncSession = Depends(get_db_session),
    current_user: CurrentUser = Depends(require_permission("stock_movement.create")),
) -> dict:
    service = StockMovementService(db)
    movement = await service.create_movement(
        payload,
        created_by_id=current_user.id if hasattr(current_user, "id") else None,
        created_by_name=getattr(current_user, "full_name", None) or getattr(current_user, "username", "Admin"),
    )
    return build_success_response(
        data=StockMovementResponse.model_validate(movement).model_dump(mode="json"),
        message=f"{payload.movement_type.capitalize()} movement {movement.movement_no} created successfully.",
        request_id=getattr(request.state, "request_id", "-"),
    )


@router.get("/movements/{movement_id}", summary="Get stock movement details")
async def get_stock_movement_detail(
    request: Request,
    movement_id: uuid.UUID,
    db: AsyncSession = Depends(get_db_session),
    current_user: CurrentUser = Depends(require_permission("stock_movement.view")),
) -> dict:
    service = StockMovementService(db)
    movement = await service.get_movement(movement_id)
    return build_success_response(
        data=StockMovementResponse.model_validate(movement).model_dump(mode="json"),
        request_id=getattr(request.state, "request_id", "-"),
    )


@router.post("/movements/{movement_id}/cancel", summary="Cancel stock movement")
async def cancel_stock_movement(
    request: Request,
    movement_id: uuid.UUID,
    reason: str | None = Query(None),
    db: AsyncSession = Depends(get_db_session),
    current_user: CurrentUser = Depends(require_permission("stock_movement.cancel")),
) -> dict:
    service = StockMovementService(db)
    movement = await service.cancel_movement(movement_id, reason=reason)
    return build_success_response(
        data=StockMovementResponse.model_validate(movement).model_dump(mode="json"),
        message=f"Movement {movement.movement_no} cancelled successfully.",
        request_id=getattr(request.state, "request_id", "-"),
    )


@router.delete("/movements/{movement_id}", summary="Delete stock movement")
async def delete_stock_movement(
    request: Request,
    movement_id: uuid.UUID,
    db: AsyncSession = Depends(get_db_session),
    current_user: CurrentUser = Depends(require_permission("stock_movement.delete")),
) -> dict:
    service = StockMovementService(db)
    await service.delete_movement(movement_id)
    return build_success_response(
        data={"id": str(movement_id)},
        message="Stock movement deleted successfully.",
        request_id=getattr(request.state, "request_id", "-"),
    )


@router.get("/available-stock", summary="Get live available stock for a product")
async def get_available_stock(
    request: Request,
    product_id: uuid.UUID | None = Query(None),
    product_code: str | None = Query(None),
    product_name: str | None = Query(None),
    db: AsyncSession = Depends(get_db_session),
    current_user: CurrentUser = Depends(require_permission("stock_movement.view")),
) -> dict:
    service = StockMovementService(db)
    stock = await service.get_available_stock(
        product_id=product_id, product_code=product_code, product_name=product_name
    )
    return build_success_response(
        data={"available_stock": stock},
        request_id=getattr(request.state, "request_id", "-"),
    )


@router.get("/extract/purchase/{purchase_id}", summary="1-Click Extract from Local Purchase for Inward")
async def extract_from_purchase(
    request: Request,
    purchase_id: uuid.UUID,
    db: AsyncSession = Depends(get_db_session),
    current_user: CurrentUser = Depends(require_permission("stock_movement.view")),
) -> dict:
    service = StockMovementService(db)
    data = await service.extract_from_local_purchase(purchase_id)
    return build_success_response(
        data=data.model_dump(mode="json"),
        request_id=getattr(request.state, "request_id", "-"),
    )


@router.get("/extract/sale-order/{sale_order_id}", summary="1-Click Extract from Sale Process for Outward")
async def extract_from_sale_order(
    request: Request,
    sale_order_id: uuid.UUID,
    db: AsyncSession = Depends(get_db_session),
    current_user: CurrentUser = Depends(require_permission("stock_movement.view")),
) -> dict:
    service = StockMovementService(db)
    data = await service.extract_from_sale_order(sale_order_id)
    return build_success_response(
        data=data.model_dump(mode="json"),
        request_id=getattr(request.state, "request_id", "-"),
    )


@router.get("/balances", summary="Get live product stock balances")
async def get_stock_balances(
    request: Request,
    search: str | None = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(100, ge=1, le=500),
    db: AsyncSession = Depends(get_db_session),
    current_user: CurrentUser = Depends(require_permission("stock_movement.view")),
) -> dict:
    service = StockMovementService(db)
    offset = (page - 1) * page_size
    balances = await service.get_stock_balances(search=search, limit=page_size, offset=offset)
    return build_success_response(
        data={"items": balances, "page": page, "page_size": page_size},
        request_id=getattr(request.state, "request_id", "-"),
    )


@router.get("/kardex", summary="Get chronological Kardex transaction ledger for an item")
async def get_product_kardex(
    request: Request,
    product_id: uuid.UUID | None = Query(None),
    product_name: str | None = Query(None),
    db: AsyncSession = Depends(get_db_session),
    current_user: CurrentUser = Depends(require_permission("stock_movement.view")),
) -> dict:
    service = StockMovementService(db)
    kardex = await service.get_product_kardex(product_id=product_id, product_name=product_name)
    return build_success_response(
        data={"items": kardex, "product_id": str(product_id) if product_id else None, "product_name": product_name},
        request_id=getattr(request.state, "request_id", "-"),
    )
