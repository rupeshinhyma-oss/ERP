"""
CRM Sales Quotation and Product Association Routes.

Exposes RESTful endpoints for:
- Product Master lookup for CRM quoting
- Lead-Product interest association management
- Sales Quotation creation, line items, calculation, revision tracking, and status transitions
"""

from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, Depends, Query, Request, Response, status
from app.core.config import settings
from app.core.responses import build_success_response
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_user
from app.auth.service import CurrentUser
from app.database.session import get_db_session
from app.crm.dependencies import require_crm_any_permission
from app.crm.quotation_service import CrmQuotationService
from app.crm.schemas import (
    CrmLeadProductCreate,
    CrmLeadProductListResponse,
    CrmLeadProductRead,
    CrmProductLookupResponse,
    CrmQuotationShareActivityCreate,
    CrmQuotationStatusUpdate,
    CrmQuotationVersionRead,
    CrmSalesQuotationCreate,
    CrmSalesQuotationListResponse,
    CrmSalesQuotationRead,
    CrmSalesQuotationUpdate,
)

router = APIRouter(prefix="/crm", tags=["CRM - Quotations & Products"])


def get_quotation_service(session: AsyncSession = Depends(get_db_session)) -> CrmQuotationService:
    return CrmQuotationService(session)


def _with_envelope(
    model_or_dict: Any,
    request: Request | None = None,
    message: str = "Operation completed successfully",
) -> dict[str, Any]:
    """
    Return a backward-compatible response dictionary containing both the standard ERP
    envelope (`success`, `data`, `message`, `meta`) and top-level payload keys so both
    envelope-aware clients and direct field consumers operate seamlessly.
    """
    dumped = (
        model_or_dict.model_dump(mode="json")
        if hasattr(model_or_dict, "model_dump")
        else dict(model_or_dict)
    )
    req_id = (
        getattr(request.state, "request_id", "-")
        if request is not None and hasattr(request, "state")
        else "-"
    )
    envelope = build_success_response(data=dumped, message=message, request_id=req_id)
    return {**dumped, **envelope}


# -----------------------------------------------------------------------------
# 1. Product Master Lookup for CRM
# -----------------------------------------------------------------------------


@router.get(
    "/products/lookup",
    summary="Search active products for CRM quotation and association",
)
async def lookup_products(
    request: Request,
    q: str | None = Query(None, description="Search term for product name, code, or barcode"),
    limit: int = Query(50, ge=1, le=100),
    service: CrmQuotationService = Depends(get_quotation_service),
    current_user: CurrentUser = Depends(require_crm_any_permission("crm.leads.view", "crm.leads.manage")),
) -> dict[str, Any]:
    """Search and lookup non-deleted, active, sellable Product Master items."""
    res = await service.search_products(query=q, limit=limit, actor=current_user)
    return _with_envelope(res, request)


# -----------------------------------------------------------------------------
# 2. Lead-Product Associations
# -----------------------------------------------------------------------------


@router.get(
    "/leads/{lead_id}/products",
    summary="List products associated with a CRM lead",
)
async def list_lead_products(
    request: Request,
    lead_id: uuid.UUID,
    service: CrmQuotationService = Depends(get_quotation_service),
    current_user: CurrentUser = Depends(require_crm_any_permission("crm.leads.view", "crm.leads.manage")),
) -> dict[str, Any]:
    """List associated products of interest for a lead."""
    res = await service.list_lead_products(lead_id=lead_id, actor=current_user)
    return _with_envelope(res, request)


@router.post(
    "/leads/{lead_id}/products",
    status_code=status.HTTP_201_CREATED,
    summary="Associate a product with a CRM lead",
)
async def associate_lead_product(
    request: Request,
    lead_id: uuid.UUID,
    payload: CrmLeadProductCreate,
    service: CrmQuotationService = Depends(get_quotation_service),
    current_user: CurrentUser = Depends(require_crm_any_permission("crm.leads.view", "crm.leads.manage")),
) -> dict[str, Any]:
    """Link an existing Product Master product to a lead."""
    res = await service.associate_product(lead_id=lead_id, payload=payload, actor=current_user)
    return _with_envelope(res, request, message="Product associated with lead successfully.")


@router.delete(
    "/leads/{lead_id}/products/{product_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    response_model=None,
    summary="Remove a product association from a CRM lead",
)
async def remove_lead_product(
    lead_id: uuid.UUID,
    product_id: uuid.UUID,
    service: CrmQuotationService = Depends(get_quotation_service),
    current_user: CurrentUser = Depends(require_crm_any_permission("crm.leads.view", "crm.leads.manage")),
) -> Response:
    """Remove a product association from a lead."""
    await service.remove_lead_product(lead_id=lead_id, product_id=product_id, actor=current_user)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# -----------------------------------------------------------------------------
# 3. Sales Quotations
# -----------------------------------------------------------------------------


@router.get(
    "/leads/{lead_id}/quotations",
    summary="List sales quotations for a CRM lead",
)
async def list_lead_quotations(
    request: Request,
    lead_id: uuid.UUID,
    service: CrmQuotationService = Depends(get_quotation_service),
    current_user: CurrentUser = Depends(require_crm_any_permission("crm.leads.view", "crm.leads.manage")),
) -> dict[str, Any]:
    """List all quotations created for a lead."""
    res = await service.list_lead_quotations(lead_id=lead_id, actor=current_user)
    return _with_envelope(res, request)


@router.post(
    "/leads/{lead_id}/quotations",
    status_code=status.HTTP_201_CREATED,
    summary="Create a new sales quotation draft for a lead",
)
async def create_sales_quotation(
    request: Request,
    lead_id: uuid.UUID,
    payload: CrmSalesQuotationCreate,
    service: CrmQuotationService = Depends(get_quotation_service),
    current_user: CurrentUser = Depends(require_crm_any_permission("crm.leads.view", "crm.leads.manage")),
) -> dict[str, Any]:
    """Create a new sales quotation with validated items and decimal-safe totals."""
    res = await service.create_quotation(lead_id=lead_id, payload=payload, actor=current_user)
    return _with_envelope(res, request, message="Sales quotation created successfully.")


@router.get(
    "/quotations/{quotation_id}",
    summary="Get sales quotation details, line items, and revision history",
)
async def get_sales_quotation(
    request: Request,
    quotation_id: uuid.UUID,
    service: CrmQuotationService = Depends(get_quotation_service),
    current_user: CurrentUser = Depends(require_crm_any_permission("crm.leads.view", "crm.leads.manage")),
) -> dict[str, Any]:
    """Get single quotation details, checking lead access authorization."""
    res = await service.get_quotation(quotation_id=quotation_id, actor=current_user)
    return _with_envelope(res, request)


@router.patch(
    "/quotations/{quotation_id}",
    summary="Update sales quotation or create a new revision",
)
@router.put(
    "/quotations/{quotation_id}",
    summary="Update sales quotation or create a new revision",
)
async def update_sales_quotation(
    request: Request,
    quotation_id: uuid.UUID,
    payload: CrmSalesQuotationUpdate,
    service: CrmQuotationService = Depends(get_quotation_service),
    current_user: CurrentUser = Depends(require_crm_any_permission("crm.leads.view", "crm.leads.manage")),
) -> dict[str, Any]:
    """Update quotation draft or finalize revision snapshot."""
    res = await service.update_quotation(quotation_id=quotation_id, payload=payload, actor=current_user)
    return _with_envelope(res, request, message="Sales quotation updated successfully.")


@router.patch(
    "/quotations/{quotation_id}/status",
    summary="Update sales quotation status",
)
async def update_quotation_status(
    request: Request,
    quotation_id: uuid.UUID,
    payload: CrmQuotationStatusUpdate,
    service: CrmQuotationService = Depends(get_quotation_service),
    current_user: CurrentUser = Depends(require_crm_any_permission("crm.leads.view", "crm.leads.manage")),
) -> dict[str, Any]:
    """Change quotation lifecycle status."""
    res = await service.update_quotation_status(quotation_id=quotation_id, payload=payload, actor=current_user)
    return _with_envelope(res, request, message="Sales quotation status updated successfully.")


@router.get(
    "/quotations/{quotation_id}/versions",
    response_model=list[CrmQuotationVersionRead],
    summary="List revision snapshots of a sales quotation",
)
async def list_quotation_versions(
    quotation_id: uuid.UUID,
    service: CrmQuotationService = Depends(get_quotation_service),
    current_user: CurrentUser = Depends(require_crm_any_permission("crm.leads.view", "crm.leads.manage")),
) -> list[CrmQuotationVersionRead]:
    """Retrieve archived revision snapshots of a sales quotation."""
    return await service.list_quotation_versions(quotation_id=quotation_id, actor=current_user)


@router.get(
    "/quotations/{quotation_id}/pdf",
    summary="Generate and stream official Quotation PDF",
    response_class=Response,
)
async def get_quotation_pdf(
    request: Request,
    quotation_id: uuid.UUID,
    version: int | None = Query(None, description="Optional revision version number (defaults to current version)"),
    service: CrmQuotationService = Depends(get_quotation_service),
    current_user: CurrentUser = Depends(require_crm_any_permission("crm.leads.view", "crm.leads.manage")),
) -> Response:
    """
    Generate and stream official Sales Quotation PDF from saved snapshot.
    Enforces RBAC lead authorization and logs CRM activity (deduplicated).
    Does NOT change quotation status or create revisions.
    """
    if settings.BACKEND_URL and settings.BACKEND_URL.strip():
        public_origin = settings.BACKEND_URL.strip().rstrip("/")
    else:
        proto = (request.headers.get("x-forwarded-proto") or request.url.scheme or "http").split(",")[0].strip()
        host = (
            request.headers.get("x-forwarded-host")
            or request.headers.get("host")
            or request.url.netloc
            or ""
        ).split(",")[0].strip()
        if host.startswith("127.0.0.1:"):
            origin_hdr = f"{request.headers.get('origin', '')} {request.headers.get('referer', '')}"
            if "localhost" in origin_hdr:
                host = "localhost:" + host.split(":", 1)[1]
        public_origin = f"{proto}://{host}" if host else str(request.base_url).rstrip("/")

    pdf_bytes, filename = await service.generate_quotation_pdf(
        public_origin=public_origin,
        quotation_id=quotation_id,
        version=version,
        actor=current_user,
    )
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'inline; filename="{filename}"',
            "Content-Type": "application/pdf",
        },
    )


@router.post(
    "/quotations/{quotation_id}/share-activity",
    summary="Record email or whatsapp quotation sharing attempt or opened event",
)
async def record_quotation_share_activity(
    request: Request,
    quotation_id: uuid.UUID,
    payload: CrmQuotationShareActivityCreate,
    service: CrmQuotationService = Depends(get_quotation_service),
    current_user: CurrentUser = Depends(require_crm_any_permission("crm.leads.view", "crm.leads.manage")),
) -> dict[str, Any]:
    """
    Log sharing attempt or opened composer action for email/whatsapp.
    Enforces RBAC lead scope and deduplicates repeated submissions.
    """
    res = await service.record_share_activity(
        quotation_id=quotation_id,
        payload=payload,
        actor=current_user,
    )
    return _with_envelope(res, request)
