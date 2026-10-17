"""
CRM Sales Quotation and Product Association Routes.

Exposes RESTful endpoints for:
- Product Master lookup for CRM quoting
- Lead-Product interest association management
- Sales Quotation creation, line items, calculation, revision tracking, and status transitions
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_user
from app.auth.service import CurrentUser
from app.database.session import get_db_session
from app.rbac.dependencies import require_permission
from app.crm.quotation_service import CrmQuotationService
from app.crm.schemas import (
    CrmLeadProductCreate,
    CrmLeadProductListResponse,
    CrmLeadProductRead,
    CrmProductLookupResponse,
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


# -----------------------------------------------------------------------------
# 1. Product Master Lookup for CRM
# -----------------------------------------------------------------------------


@router.get(
    "/products/lookup",
    response_model=CrmProductLookupResponse,
    summary="Search active products for CRM quotation and association",
)
async def lookup_products(
    q: str | None = Query(None, description="Search term for product name, code, or barcode"),
    limit: int = Query(50, ge=1, le=100),
    service: CrmQuotationService = Depends(get_quotation_service),
    current_user: CurrentUser = Depends(require_permission("crm.leads.view")),
) -> CrmProductLookupResponse:
    """Search and lookup non-deleted, active, sellable Product Master items."""
    return await service.search_products(query=q, limit=limit, actor=current_user)


# -----------------------------------------------------------------------------
# 2. Lead-Product Associations
# -----------------------------------------------------------------------------


@router.get(
    "/leads/{lead_id}/products",
    response_model=CrmLeadProductListResponse,
    summary="List products associated with a CRM lead",
)
async def list_lead_products(
    lead_id: uuid.UUID,
    service: CrmQuotationService = Depends(get_quotation_service),
    current_user: CurrentUser = Depends(require_permission("crm.leads.view")),
) -> CrmLeadProductListResponse:
    """List associated products of interest for a lead."""
    return await service.list_lead_products(lead_id=lead_id, actor=current_user)


@router.post(
    "/leads/{lead_id}/products",
    response_model=CrmLeadProductRead,
    status_code=status.HTTP_201_CREATED,
    summary="Associate a product with a CRM lead",
)
async def associate_lead_product(
    lead_id: uuid.UUID,
    payload: CrmLeadProductCreate,
    service: CrmQuotationService = Depends(get_quotation_service),
    current_user: CurrentUser = Depends(require_permission("crm.leads.manage")),
) -> CrmLeadProductRead:
    """Link an existing Product Master product to a lead."""
    return await service.associate_product(lead_id=lead_id, payload=payload, actor=current_user)


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
    current_user: CurrentUser = Depends(require_permission("crm.leads.manage")),
) -> Response:
    """Remove a product association from a lead."""
    await service.remove_lead_product(lead_id=lead_id, product_id=product_id, actor=current_user)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# -----------------------------------------------------------------------------
# 3. Sales Quotations
# -----------------------------------------------------------------------------


@router.get(
    "/leads/{lead_id}/quotations",
    response_model=CrmSalesQuotationListResponse,
    summary="List sales quotations for a CRM lead",
)
async def list_lead_quotations(
    lead_id: uuid.UUID,
    service: CrmQuotationService = Depends(get_quotation_service),
    current_user: CurrentUser = Depends(require_permission("crm.leads.view")),
) -> CrmSalesQuotationListResponse:
    """List all quotations created for a lead."""
    return await service.list_lead_quotations(lead_id=lead_id, actor=current_user)


@router.post(
    "/leads/{lead_id}/quotations",
    response_model=CrmSalesQuotationRead,
    status_code=status.HTTP_201_CREATED,
    summary="Create a new sales quotation draft for a lead",
)
async def create_sales_quotation(
    lead_id: uuid.UUID,
    payload: CrmSalesQuotationCreate,
    service: CrmQuotationService = Depends(get_quotation_service),
    current_user: CurrentUser = Depends(require_permission("crm.leads.manage")),
) -> CrmSalesQuotationRead:
    """Create a new sales quotation with validated items and decimal-safe totals."""
    return await service.create_quotation(lead_id=lead_id, payload=payload, actor=current_user)


@router.get(
    "/quotations/{quotation_id}",
    response_model=CrmSalesQuotationRead,
    summary="Get sales quotation details, line items, and revision history",
)
async def get_sales_quotation(
    quotation_id: uuid.UUID,
    service: CrmQuotationService = Depends(get_quotation_service),
    current_user: CurrentUser = Depends(require_permission("crm.leads.view")),
) -> CrmSalesQuotationRead:
    """Get single quotation details, checking lead access authorization."""
    return await service.get_quotation(quotation_id=quotation_id, actor=current_user)


@router.patch(
    "/quotations/{quotation_id}",
    response_model=CrmSalesQuotationRead,
    summary="Update sales quotation or create a new revision",
)
@router.put(
    "/quotations/{quotation_id}",
    response_model=CrmSalesQuotationRead,
    summary="Update sales quotation or create a new revision",
)
async def update_sales_quotation(
    quotation_id: uuid.UUID,
    payload: CrmSalesQuotationUpdate,
    service: CrmQuotationService = Depends(get_quotation_service),
    current_user: CurrentUser = Depends(require_permission("crm.leads.manage")),
) -> CrmSalesQuotationRead:
    """Update quotation draft or finalize revision snapshot."""
    return await service.update_quotation(quotation_id=quotation_id, payload=payload, actor=current_user)


@router.patch(
    "/quotations/{quotation_id}/status",
    response_model=CrmSalesQuotationRead,
    summary="Update sales quotation status",
)
async def update_quotation_status(
    quotation_id: uuid.UUID,
    payload: CrmQuotationStatusUpdate,
    service: CrmQuotationService = Depends(get_quotation_service),
    current_user: CurrentUser = Depends(require_permission("crm.leads.manage")),
) -> CrmSalesQuotationRead:
    """Change quotation lifecycle status."""
    return await service.update_quotation_status(quotation_id=quotation_id, payload=payload, actor=current_user)


@router.get(
    "/quotations/{quotation_id}/versions",
    response_model=list[CrmQuotationVersionRead],
    summary="List revision snapshots of a sales quotation",
)
async def list_quotation_versions(
    quotation_id: uuid.UUID,
    service: CrmQuotationService = Depends(get_quotation_service),
    current_user: CurrentUser = Depends(require_permission("crm.leads.view")),
) -> list[CrmQuotationVersionRead]:
    """Retrieve archived revision snapshots of a sales quotation."""
    return await service.list_quotation_versions(quotation_id=quotation_id, actor=current_user)


@router.get(
    "/quotations/{quotation_id}/pdf",
    summary="Generate and stream official Quotation PDF",
    response_class=Response,
)
async def get_quotation_pdf(
    quotation_id: uuid.UUID,
    version: int | None = Query(None, description="Optional revision version number (defaults to current version)"),
    service: CrmQuotationService = Depends(get_quotation_service),
    current_user: CurrentUser = Depends(require_permission("crm.leads.view")),
) -> Response:
    """
    Generate and stream official Sales Quotation PDF from saved snapshot.
    Enforces RBAC lead authorization and logs CRM activity (deduplicated).
    Does NOT change quotation status or create revisions.
    """
    pdf_bytes, filename = await service.generate_quotation_pdf(
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
