"""
Local Purchase Routes.

API endpoints for:
- Listing, filtering, creating, viewing, updating, and deleting local purchase orders
- Value-Based (VB) landing cost calculation preview
- Bill extraction from PDF and Excel files
- Exporting to Excel (.xlsx) and CSV
"""

from __future__ import annotations

import uuid
from datetime import date
from typing import Any

from fastapi import APIRouter, Depends, File, Query, Request, Response, UploadFile, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_user
from app.auth.service import CurrentUser
from app.rbac.dependencies import require_permission
from app.core.logging import get_logger
from app.core.responses import build_success_response
from app.database.session import get_db_session
from app.purchases.local.schemas import (
    BillExtractionResponse,
    LocalPurchaseCreate,
    LocalPurchaseDetailResponse,
    LocalPurchaseItemCreate,
    LocalPurchaseSummaryResponse,
    LocalPurchaseUpdate,
)
from app.purchases.local.service import LocalPurchaseService
from pydantic import BaseModel, Field

logger = get_logger(__name__)

router = APIRouter(prefix="/purchases/local", tags=["Purchases - Local Purchase"])


def get_service(session: AsyncSession = Depends(get_db_session)) -> LocalPurchaseService:
    return LocalPurchaseService(session)


class CalculatePreviewPayload(BaseModel):
    packing_forwarding: float = 0.0
    transport_expense: float = 0.0
    offloading_expense: float = 0.0
    other_expense: float = 0.0
    items: list[dict[str, Any]] = Field(default_factory=list)


@router.get("", summary="List local purchases with filters & pagination")
async def list_local_purchases(
    request: Request,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=500),
    search: str | None = Query(default=None),
    organization_id: uuid.UUID | None = Query(default=None),
    branch_id: str | None = Query(default=None),
    supplier_id: uuid.UUID | None = Query(default=None),
    status: str | None = Query(default=None),
    currency: str | None = Query(default=None),
    date_from: date | None = Query(default=None),
    date_to: date | None = Query(default=None),
    service: LocalPurchaseService = Depends(get_service),
    current_user: CurrentUser = Depends(require_permission('local_purchase.create')),
) -> dict:
    offset = (page - 1) * page_size
    records, total = await service.repo.list_with_filters(
        search=search,
        organization_id=organization_id,
        branch_id=branch_id,
        supplier_id=supplier_id,
        status=status,
        currency=currency,
        date_from=date_from,
        date_to=date_to,
        limit=page_size,
        offset=offset,
    )

    summaries = []
    for r in records:
        s = LocalPurchaseSummaryResponse(
            id=r.id,
            organization_id=r.organization_id,
            organization_name=r.organization_name,
            branch_id=r.branch_id,
            branch_name=r.branch_name,
            supplier_id=r.supplier_id,
            supplier_name=r.supplier_name,
            invoice_no=r.invoice_no,
            invoice_date=r.invoice_date,
            currency=r.currency,
            invoice_total_value=float(r.invoice_total_value),
            bill_file_url=r.bill_file_url,
            total_expenses=float(r.total_expenses),
            loading_expense_pct=float(r.loading_expense_pct),
            items_total_basic=float(r.items_total_basic),
            items_total_vat=float(r.items_total_vat),
            items_total_landing=float(r.items_total_landing),
            total_quantity=float(r.total_quantity),
            items_count=len(r.items),
            remarks=r.remarks,
            status=r.status,
            created_by_name=r.created_by_name,
            created_at=r.created_at,
            updated_at=r.updated_at,
        )
        summaries.append(s.model_dump())

    return build_success_response(
        data={
            "items": summaries,
            "total": total,
            "page": page,
            "page_size": page_size,
            "total_pages": (total + page_size - 1) // page_size if total > 0 else 1,
        },
        request_id=getattr(request.state, "request_id", "-"),
    )


@router.post("", status_code=status.HTTP_201_CREATED, summary="Create a new local purchase")
async def create_local_purchase(
    payload: LocalPurchaseCreate,
    request: Request,
    service: LocalPurchaseService = Depends(get_service),
    current_user: CurrentUser = Depends(require_permission('local_purchase.create')),
) -> dict:
    user_name = current_user.username if current_user and current_user.username else "Admin"
    created = await service.create_purchase(
        payload=payload,
        created_by_id=current_user.id,
        created_by_name=user_name,
    )
    detail = LocalPurchaseDetailResponse.model_validate(created)
    return build_success_response(
        data=detail.model_dump(),
        message="Local purchase created successfully.",
        request_id=getattr(request.state, "request_id", "-"),
    )


@router.post("/calculate-preview", summary="Live calculate Value-Based (VB) landing rates preview")
async def calculate_preview(
    payload: CalculatePreviewPayload,
    request: Request,
    service: LocalPurchaseService = Depends(get_service),
    _current_user: CurrentUser = Depends(require_permission('local_purchase.view')),
) -> dict:
    result = service.calculate_landing_rates(
        packing_forwarding=payload.packing_forwarding,
        transport_expense=payload.transport_expense,
        offloading_expense=payload.offloading_expense,
        other_expense=payload.other_expense,
        items=payload.items,
    )
    return build_success_response(
        data=result,
        request_id=getattr(request.state, "request_id", "-"),
    )


@router.post("/extract-bill", summary="Upload and extract data from PDF or Excel bill")
async def extract_bill(
    request: Request,
    file: UploadFile = File(...),
    service: LocalPurchaseService = Depends(get_service),
    _current_user: CurrentUser = Depends(require_permission('local_purchase.view')),
) -> dict:
    file_bytes = await file.read()
    filename = file.filename or "uploaded_bill.pdf"
    extracted = await service.extract_bill(file_bytes=file_bytes, filename=filename)
    return build_success_response(
        data=extracted.model_dump(),
        message="Bill extracted successfully.",
        request_id=getattr(request.state, "request_id", "-"),
    )


@router.get("/export", summary="Export local purchases to Excel (.xlsx)")
async def export_local_purchases(
    search: str | None = Query(default=None),
    organization_id: uuid.UUID | None = Query(default=None),
    branch_id: str | None = Query(default=None),
    supplier_id: uuid.UUID | None = Query(default=None),
    status: str | None = Query(default=None),
    currency: str | None = Query(default=None),
    date_from: date | None = Query(default=None),
    date_to: date | None = Query(default=None),
    service: LocalPurchaseService = Depends(get_service),
    _current_user: CurrentUser = Depends(require_permission('local_purchase.export')),
) -> Response:
    records, _ = await service.repo.list_with_filters(
        search=search,
        organization_id=organization_id,
        branch_id=branch_id,
        supplier_id=supplier_id,
        status=status,
        currency=currency,
        date_from=date_from,
        date_to=date_to,
        limit=10000,
        offset=0,
    )
    excel_stream = service.export_excel(records)
    filename = f"local_purchases_{date.today().strftime('%Y%m%d')}.xlsx"
    return Response(
        content=excel_stream.getvalue(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/planning-items", summary="Fetch planned items from Shipment Planning for an Organization, Branch, and Supplier")
async def get_planning_items(
    request: Request,
    organization_id: uuid.UUID = Query(..., description="Organization UUID"),
    branch_id: str | None = Query(default=None, description="Branch identifier"),
    branch_name: str | None = Query(default=None, description="Branch Name"),
    supplier_name: str | None = Query(default=None, description="Supplier company name"),
    supplier_id: uuid.UUID | None = Query(default=None, description="Supplier UUID"),
    service: LocalPurchaseService = Depends(get_service),
    _current_user: CurrentUser = Depends(require_permission('local_purchase.view')),
) -> dict:
    """Fetch matching planned items from Shipment Planning sheet."""
    result = await service.get_planning_items(
        organization_id=organization_id,
        branch_id=branch_id,
        branch_name=branch_name,
        supplier_name=supplier_name,
        supplier_id=supplier_id,
    )
    return build_success_response(
        data=result,
        message=f"Found {result.get('count', 0)} planned items from {result.get('sheet_name', 'Shipment Planning')}.",
        request_id=getattr(request.state, "request_id", "-"),
    )


@router.get("/{purchase_id}", summary="Get local purchase details by ID")
async def get_local_purchase(
    purchase_id: uuid.UUID,
    request: Request,
    service: LocalPurchaseService = Depends(get_service),
    _current_user: CurrentUser = Depends(require_permission('local_purchase.view')),
) -> dict:
    purchase = await service.get_purchase(purchase_id)
    detail = LocalPurchaseDetailResponse.model_validate(purchase)
    return build_success_response(
        data=detail.model_dump(),
        request_id=getattr(request.state, "request_id", "-"),
    )


@router.patch("/{purchase_id}", summary="Update existing local purchase")
async def update_local_purchase(
    purchase_id: uuid.UUID,
    payload: LocalPurchaseUpdate,
    request: Request,
    service: LocalPurchaseService = Depends(get_service),
    _current_user: CurrentUser = Depends(require_permission('local_purchase.update')),
) -> dict:
    updated = await service.update_purchase(purchase_id, payload)
    detail = LocalPurchaseDetailResponse.model_validate(updated)
    return build_success_response(
        data=detail.model_dump(),
        message="Local purchase updated successfully.",
        request_id=getattr(request.state, "request_id", "-"),
    )


@router.delete("/{purchase_id}", summary="Soft delete a local purchase")
async def delete_local_purchase(
    purchase_id: uuid.UUID,
    request: Request,
    service: LocalPurchaseService = Depends(get_service),
    _current_user: CurrentUser = Depends(require_permission('local_purchase.delete')),
) -> dict:
    await service.delete_purchase(purchase_id)
    return build_success_response(
        data={"id": str(purchase_id)},
        message="Local purchase deleted successfully.",
        request_id=getattr(request.state, "request_id", "-"),
    )
