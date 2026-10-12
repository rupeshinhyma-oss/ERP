"""Price List Management Router.

Endpoints for Control Panel / Masters / Inventory:
- List products with full commercial pricing and GST computations
- Catalog KPI metrics (total, priced, unpriced, average selling prices)
- Inline & drawer pricing updates (with inclusive/exclusive GST toggle)
- Bulk pricing updates
- Supplier quotation sub-table management
- Excel & CSV export
- Sample template download & bulk Excel import
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, File, Query, Request, Response, UploadFile, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.service import CurrentUser
from app.core.logging import get_logger
from app.core.responses import build_success_response
from app.database.session import get_db_session
from app.masters.price_list.schemas import (
    AssignSupplierQuotePayload,
    BulkPriceUpdateRequest,
    PriceListUpdatePayload,
)
from app.masters.price_list.service import PriceListService
from app.rbac.dependencies import require_permission

logger = get_logger(__name__)

router = APIRouter(prefix="/masters/price-list", tags=["Masters - Price List"])


def get_service(session: AsyncSession = Depends(get_db_session)) -> PriceListService:
    return PriceListService(session)


@router.get("", summary="List commercial product price items with GST calculations")
async def list_price_items(
    request: Request,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=500),
    search: str | None = Query(default=None),
    category_id: uuid.UUID | None = Query(default=None),
    sub_category_id: uuid.UUID | None = Query(default=None),
    brand_id: uuid.UUID | None = Query(default=None),
    has_price: bool | None = Query(default=None),
    gst_percent: float | None = Query(default=None),
    sort_by: str = Query(default="product_name_tally"),
    sort_dir: str = Query(default="asc"),
    service: PriceListService = Depends(get_service),
    _current_user: CurrentUser = Depends(require_permission("product.view")),
) -> dict:
    items, total = await service.list_prices(
        page=page,
        page_size=page_size,
        search=search,
        category_id=category_id,
        sub_category_id=sub_category_id,
        brand_id=brand_id,
        has_price=has_price,
        gst_percent=gst_percent,
        sort_by=sort_by,
        sort_dir=sort_dir,
    )

    total_pages = (total + page_size - 1) // page_size if total > 0 else 1

    return build_success_response(
        data=[item.model_dump() for item in items],
        meta={
            "page": page,
            "page_size": page_size,
            "total_items": total,
            "total_pages": total_pages,
        },
        request_id=getattr(request.state, "request_id", "-"),
    )


@router.get("/metrics", summary="Get catalog pricing KPI metrics")
async def get_price_metrics(
    request: Request,
    service: PriceListService = Depends(get_service),
    _current_user: CurrentUser = Depends(require_permission("product.view")),
) -> dict:
    metrics = await service.get_metrics()
    return build_success_response(
        data=metrics.model_dump(),
        request_id=getattr(request.state, "request_id", "-"),
    )


@router.patch("/{product_id}", summary="Update selling and minimum prices for a product")
async def update_product_price(
    request: Request,
    product_id: uuid.UUID,
    payload: PriceListUpdatePayload,
    service: PriceListService = Depends(get_service),
    _current_user: CurrentUser = Depends(require_permission("product.update")),
) -> dict:
    updated_item = await service.update_price(product_id, payload)
    return build_success_response(
        data=updated_item.model_dump() if updated_item else None,
        request_id=getattr(request.state, "request_id", "-"),
    )


@router.post("/bulk-update", summary="Bulk update multiple product prices")
async def bulk_update_prices(
    request: Request,
    payload: BulkPriceUpdateRequest,
    service: PriceListService = Depends(get_service),
    _current_user: CurrentUser = Depends(require_permission("product.update")),
) -> dict:
    result = await service.bulk_update_prices(payload)
    return build_success_response(
        data=result,
        request_id=getattr(request.state, "request_id", "-"),
    )


@router.get("/{product_id}/suppliers", summary="Get all supplier quotations for a product")
async def get_product_suppliers(
    request: Request,
    product_id: uuid.UUID,
    service: PriceListService = Depends(get_service),
    _current_user: CurrentUser = Depends(require_permission("product.view")),
) -> dict:
    suppliers = await service.get_product_suppliers(product_id)
    return build_success_response(
        data=[s.model_dump() for s in suppliers],
        request_id=getattr(request.state, "request_id", "-"),
    )


@router.post("/{product_id}/suppliers", summary="Assign or update a supplier quotation", status_code=status.HTTP_201_CREATED)
async def assign_supplier_quote(
    request: Request,
    product_id: uuid.UUID,
    payload: AssignSupplierQuotePayload,
    service: PriceListService = Depends(get_service),
    _current_user: CurrentUser = Depends(require_permission("product.update")),
) -> dict:
    link_id = await service.assign_supplier_quote(product_id, payload)
    return build_success_response(
        data={"link_id": str(link_id), "message": "Supplier quote saved successfully"},
        request_id=getattr(request.state, "request_id", "-"),
    )


@router.delete("/suppliers/{link_id}", summary="Remove a supplier quotation")
async def delete_supplier_quote(
    request: Request,
    link_id: uuid.UUID,
    service: PriceListService = Depends(get_service),
    _current_user: CurrentUser = Depends(require_permission("product.update")),
) -> dict:
    await service.delete_supplier_quote(link_id)
    return build_success_response(
        data={"message": "Supplier quote removed successfully"},
        request_id=getattr(request.state, "request_id", "-"),
    )


@router.get("/export", summary="Export price list to Excel or CSV with GST breakdown")
async def export_price_list(
    format: str = Query(default="xlsx", pattern="^(xlsx|csv)$"),
    search: str | None = Query(default=None),
    category_id: uuid.UUID | None = Query(default=None),
    sub_category_id: uuid.UUID | None = Query(default=None),
    brand_id: uuid.UUID | None = Query(default=None),
    has_price: bool | None = Query(default=None),
    gst_percent: float | None = Query(default=None),
    service: PriceListService = Depends(get_service),
    _current_user: CurrentUser = Depends(require_permission("product.export")),
) -> Response:
    content, media_type, filename = await service.export_price_list(
        file_format=format,
        search=search,
        category_id=category_id,
        sub_category_id=sub_category_id,
        brand_id=brand_id,
        has_price=has_price,
        gst_percent=gst_percent,
    )
    return Response(
        content=content,
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/sample-template", summary="Download bulk price import template")
async def download_price_template(
    service: PriceListService = Depends(get_service),
    _current_user: CurrentUser = Depends(require_permission("product.export")),
) -> Response:
    content, media_type, filename = await service.generate_template()
    return Response(
        content=content,
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/import", summary="Bulk import product prices from Excel")
async def import_price_list(
    request: Request,
    file: UploadFile = File(...),
    service: PriceListService = Depends(get_service),
    _current_user: CurrentUser = Depends(require_permission("product.update")),
) -> dict:
    content = await file.read()
    summary = await service.import_prices_from_excel(content)
    return build_success_response(
        data=summary.model_dump(),
        request_id=getattr(request.state, "request_id", "-"),
    )
