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

from fastapi import APIRouter, Depends, File, Form, Query, Request, Response, UploadFile, status
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
    invoice_date_from: str | None = Query(default=None),
    invoice_date_to: str | None = Query(default=None),
    delivery_date_from: str | None = Query(default=None),
    delivery_date_to: str | None = Query(default=None),
    state: str | None = Query(default=None),
    dispatch: str | None = Query(default=None),
    including_gst: bool = Query(default=True),
    service: SaleService = Depends(get_sale_service),
    current_user: CurrentUser = Depends(get_current_user),
) -> dict:
    req_id = getattr(request.state, "request_id", "-")
    offset = (page - 1) * page_size
    visibility = await service.visible_filters(current_user)
    records, total = await service.repo.list_with_filters(
        **visibility,
        search=search,
        organization_id=organization_id,
        buyer_id=buyer_id,
        buyer_branch_id=buyer_branch_id,
        consignment_code=consignment_code,
        status=status,
        currency=currency,
        date_from=date_from,
        date_to=date_to,
        invoice_date_from=invoice_date_from,
        invoice_date_to=invoice_date_to,
        delivery_date_from=delivery_date_from,
        delivery_date_to=delivery_date_to,
        state=state,
        dispatch=dispatch,
        limit=page_size,
        offset=offset,
    )

    items = [SaleOrderResponse.model_validate(r).model_dump() for r in records]

    metrics = await service.repo.get_metrics(
        **visibility,
        organization_id=organization_id,
        buyer_id=buyer_id,
        currency=currency,
        date_from=date_from,
        date_to=date_to,
        including_gst=including_gst,
    )

    return build_success_response(
        data={
            "items": items,
            "total": total,
            "page": page,
            "page_size": page_size,
            "total_pages": (total + page_size - 1) // page_size if total > 0 else 1,
            "status_rules": await service.load_status_rules(),
            "metrics": metrics.model_dump(),
        },
        request_id=req_id,
    )


@router.get("/next-gatepass-no", summary="Generate next sequential gatepass number")
async def get_next_gatepass_no(
    request: Request,
    service: SaleService = Depends(get_sale_service),
    current_user: CurrentUser = Depends(get_current_user),
) -> dict:
    req_id = getattr(request.state, "request_id", "-")
    gp_no = await service.repo.generate_gatepass_no()
    return build_success_response(data={"gatepass_no": gp_no}, request_id=req_id)


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
    visibility = await service.visible_filters(current_user)
    if visibility and (
        order.warehouse not in visibility["warehouses"] or order.status in visibility["exclude_statuses"]
    ):
        raise NotFoundException(f"Sale order {id} not found.")  # hidden from this role, as if it did not exist
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
    order = await service.update_order(id, payload, current_user)
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
    order = await service.update_status(id, payload, current_user)
    loaded = await service.repo.get_by_id(order.id)
    if not loaded:
        raise NotFoundException("Order could not be reloaded.")
    return build_success_response(
        data=SaleOrderDetailResponse.model_validate(loaded).model_dump(),
        request_id=req_id,
    )


@router.post("/upload-po", summary="Upload Purchase Order (PO) document")
async def upload_po_document(
    request: Request,
    file: UploadFile = File(...),
    current_user: CurrentUser = Depends(get_current_user),
) -> dict:
    req_id = getattr(request.state, "request_id", "-")
    from app.common.storage import save_uploaded_file

    content = await file.read()
    url, filename = await save_uploaded_file(
        content=content,
        original_filename=file.filename or "purchase_order.pdf",
        bucket="inhyma-sales-docs",
        local_subfolder="sales_po",
        content_type=file.content_type,
    )
    return build_success_response(
        data={"url": url, "filename": file.filename or filename},
        request_id=req_id,
    )


@router.post("/upload-tally-bill", summary="Upload Tally Bill document")
async def upload_tally_bill(
    request: Request,
    file: UploadFile = File(...),
    current_user: CurrentUser = Depends(get_current_user),
) -> dict:
    req_id = getattr(request.state, "request_id", "-")
    from app.common.storage import save_uploaded_file

    content = await file.read()
    url, filename = await save_uploaded_file(
        content=content,
        original_filename=file.filename or "tally_bill.pdf",
        bucket="inhyma-sales-docs",
        local_subfolder="sales_tally_bills",
        content_type=file.content_type,
    )
    return build_success_response(
        data={"url": url, "filename": file.filename or filename},
        request_id=req_id,
    )


@router.post("/upload-eway-bill", summary="Upload E-Way Bill document")
async def upload_eway_bill(
    request: Request,
    file: UploadFile = File(...),
    current_user: CurrentUser = Depends(get_current_user),
) -> dict:
    req_id = getattr(request.state, "request_id", "-")
    from app.common.storage import save_uploaded_file

    content = await file.read()
    url, filename = await save_uploaded_file(
        content=content,
        original_filename=file.filename or "eway_bill.pdf",
        bucket="inhyma-sales-docs",
        local_subfolder="sales_eway_bills",
        content_type=file.content_type,
    )
    return build_success_response(
        data={"url": url, "filename": file.filename or filename},
        request_id=req_id,
    )


@router.post("/upload-lr", summary="Upload Lorry Receipt (LR) document")
async def upload_lr_document(
    request: Request,
    file: UploadFile = File(...),
    current_user: CurrentUser = Depends(get_current_user),
) -> dict:
    req_id = getattr(request.state, "request_id", "-")
    from app.common.storage import save_uploaded_file

    content = await file.read()
    url, filename = await save_uploaded_file(
        content=content,
        original_filename=file.filename or "lr_document.pdf",
        bucket="inhyma-sales-docs",
        local_subfolder="sales_lr",
        content_type=file.content_type,
    )
    return build_success_response(
        data={"url": url, "filename": file.filename or filename},
        request_id=req_id,
    )


@router.post("/upload-dispatch-media", summary="Upload multiple dispatch images/videos")
async def upload_dispatch_media(
    request: Request,
    files: list[UploadFile] = File(...),
    current_user: CurrentUser = Depends(get_current_user),
) -> dict:
    req_id = getattr(request.state, "request_id", "-")
    from app.common.storage import guess_content_type, save_uploaded_file

    uploaded_items: list[dict[str, Any]] = []
    for f in files:
        content = await f.read()
        orig_name = f.filename or "dispatch_media.jpg"
        url, stored_name = await save_uploaded_file(
            content=content,
            original_filename=orig_name,
            bucket="inhyma-sales-docs",
            local_subfolder="sales_dispatch_media",
            content_type=f.content_type,
        )
        uploaded_items.append(
            {
                "url": url,
                "filename": orig_name or stored_name,
                "content_type": f.content_type or guess_content_type(orig_name),
                "size": len(content),
            }
        )
    return build_success_response(
        data={"files": uploaded_items},
        request_id=req_id,
    )


@router.post("/orders/{id}/status-with-po", summary="Update sale order status with optional PO file upload")
async def update_order_status_with_po(
    id: uuid.UUID,
    request: Request,
    status: str = Form("sales_confirmed"),
    remarks: str | None = Form(None),
    po_file: UploadFile | None = File(None),
    service: SaleService = Depends(get_sale_service),
    current_user: CurrentUser = Depends(get_current_user),
) -> dict:
    req_id = getattr(request.state, "request_id", "-")
    po_url: str | None = None
    po_name: str | None = None
    if po_file and po_file.filename:
        from app.common.storage import save_uploaded_file

        content = await po_file.read()
        if content:
            po_url, _ = await save_uploaded_file(
                content=content,
                original_filename=po_file.filename,
                bucket="inhyma-sales-docs",
                local_subfolder="sales_po",
                content_type=po_file.content_type,
            )
            po_name = po_file.filename

    status_payload = SaleOrderStatusUpdate(
        status=status,
        remarks=remarks,
        po_file_url=po_url,
        po_file_name=po_name,
    )
    order = await service.update_status(id, status_payload, current_user)
    loaded = await service.repo.get_by_id(order.id)
    if not loaded:
        raise NotFoundException("Order could not be reloaded.")
    return build_success_response(
        data=SaleOrderDetailResponse.model_validate(loaded).model_dump(),
        request_id=req_id,
    )


@router.delete("/orders/{id}", summary="Delete a sale order (stage rules apply; stock is returned)")
async def delete_sale_order(
    id: uuid.UUID,
    request: Request,
    service: SaleService = Depends(get_sale_service),
    current_user: CurrentUser = Depends(get_current_user),
) -> dict:
    req_id = getattr(request.state, "request_id", "-")
    await service.delete_order(id, current_user)
    return build_success_response(
        data={"id": str(id), "deleted": True},
        request_id=req_id,
    )


@router.post("/orders/{id}/restore", summary="Restore a soft-deleted sale order (administrators only)")
async def restore_sale_order(
    id: uuid.UUID,
    request: Request,
    service: SaleService = Depends(get_sale_service),
    current_user: CurrentUser = Depends(get_current_user),
) -> dict:
    req_id = getattr(request.state, "request_id", "-")
    await service.restore_order(id, current_user)
    return build_success_response(
        data={"id": str(id), "restored": True},
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
        **(await service.visible_filters(current_user)),
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