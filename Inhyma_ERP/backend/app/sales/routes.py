"""
Sales Routes.

Provides RESTful endpoints for Proforma Invoices, matching
erp.inhymasolutions.com/proforma-invoice/list. Follows the same
try-DB-then-fall-back-to-empty style and raw-query-in-routes structure
as app.inventory.routes (StockAdjustment/StockTransfer), which is the
established house pattern for this class of transactional-order module
rather than the layered masters/* repository+service pattern.
"""

from __future__ import annotations

import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.responses import build_success_response
from app.database.session import get_db_session
from app.sales.models import ProformaInvoice, ProformaInvoiceLineItem
from app.sales.schemas import (
    ProformaInvoiceCreate,
    ProformaInvoiceUpdate,
    ProformaLineItemSchema,
)

router = APIRouter(tags=["Sales - Proforma Invoices"])

# Every status a Proforma Invoice can carry, in the order the legacy ERP's
# status tabs display them (see the screenshot this module was built from).
PROFORMA_STATUSES = ["pending", "admin_approved", "confirmed", "cancelled"]


def _serialize_proforma(p: ProformaInvoice) -> dict:
    """Return the API-shape dict for one ProformaInvoice row, items included."""
    return {
        "id": str(p.id),
        "proforma_no": p.proforma_no,
        "proforma_date": p.proforma_date,
        "expected_delivery_date": p.expected_delivery_date,
        "warehouse": p.warehouse,
        "lead_source": p.lead_source,
        "company_name": p.company_name,
        "city": p.city,
        "state": p.state,
        "sales_person": p.sales_person,
        "amount_inc_gst": float(p.amount_inc_gst),
        "discount": float(p.discount),
        "status": p.status,
        "remark": p.remark,
        "created_by": p.created_by,
        "items": [
            {
                "id": str(li.id),
                "product_name": li.product_name,
                "product_code": li.product_code,
                "hsn_code": li.hsn_code,
                "gst_rate": li.gst_rate,
                "quantity": li.quantity,
                "uom": li.uom,
                "rate": li.rate,
                "amount": li.amount,
            }
            for li in p.items
        ],
    }


async def _resolve_proforma(db: AsyncSession, proforma_id: str) -> ProformaInvoice:
    """Look a proforma up by UUID or, failing that, its human proforma_no -- same lenient-lookup pattern as update_stock_transfer_status."""
    stmt = select(ProformaInvoice).options(selectinload(ProformaInvoice.items)).where(ProformaInvoice.deleted_at.is_(None))
    try:
        val_uuid = uuid.UUID(proforma_id)
        stmt = stmt.where(ProformaInvoice.id == val_uuid)
    except ValueError:
        stmt = stmt.where(ProformaInvoice.proforma_no == proforma_id)

    record = (await db.execute(stmt)).scalars().first()
    if record is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Proforma invoice not found.")
    return record


@router.get("/proforma-invoice/list", summary="List proforma invoices")
@router.get("/sales/proforma-invoices", summary="Alias for proforma invoice list")
async def list_proforma_invoices(
    request: Request,
    status_filter: Optional[str] = Query(None, alias="status", description="'pending' | 'admin_approved' | 'confirmed' | 'cancelled' | 'all'"),
    warehouse: Optional[str] = Query(None, description="Warehouse filter, or 'All'"),
    search: Optional[str] = Query(None, description="Search by proforma no, company, or sales person"),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=500),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    """Return paginated proforma invoices with per-status tab counts and ₹ totals."""
    base_stmt = select(ProformaInvoice).where(ProformaInvoice.deleted_at.is_(None))

    # Tab counts + amount totals across every status, computed once up
    # front (unfiltered by the current search/warehouse) so the pill
    # tabs always show the true totals for the whole list, matching the
    # legacy ERP screenshot's ALL/PENDING/ADMIN APPROVED/CONFIRMED/
    # CANCELLED summary cards.
    async def _count_and_sum(stmt) -> tuple[int, float]:
        sub = stmt.subquery()
        row = (
            await db.execute(
                select(func.count(), func.coalesce(func.sum(sub.c.amount_inc_gst), 0.0)).select_from(sub)
            )
        ).one()
        return int(row[0] or 0), float(row[1] or 0.0)

    all_count, all_amount = await _count_and_sum(base_stmt)
    tab_counts = {"all": {"count": all_count, "amount": all_amount}}
    for st in PROFORMA_STATUSES:
        c, a = await _count_and_sum(base_stmt.where(ProformaInvoice.status == st))
        tab_counts[st] = {"count": c, "amount": a}

    # Apply filtering for the actual page of rows returned
    query_stmt = base_stmt.options(selectinload(ProformaInvoice.items))
    if status_filter and status_filter.lower() != "all":
        query_stmt = query_stmt.where(ProformaInvoice.status == status_filter.strip().lower())
    if warehouse and warehouse != "All":
        query_stmt = query_stmt.where(func.lower(ProformaInvoice.warehouse) == warehouse.strip().lower())
    if search:
        q = f"%{search.strip().lower()}%"
        query_stmt = query_stmt.where(
            or_(
                func.lower(ProformaInvoice.proforma_no).like(q),
                func.lower(ProformaInvoice.company_name).like(q),
                func.lower(ProformaInvoice.sales_person).like(q),
                func.lower(ProformaInvoice.city).like(q),
                func.lower(ProformaInvoice.warehouse).like(q),
            )
        )

    total_stmt = select(func.count()).select_from(query_stmt.subquery())
    total_filtered = (await db.execute(total_stmt)).scalar() or 0

    query_stmt = query_stmt.order_by(ProformaInvoice.created_at.desc()).offset(skip).limit(limit)
    results = (await db.execute(query_stmt)).scalars().all()

    items = [_serialize_proforma(p) for p in results]

    return build_success_response(
        data={"items": items, "tab_counts": tab_counts},
        meta={"total": total_filtered, "skip": skip, "limit": limit, "tab_counts": tab_counts},
        request_id=getattr(request.state, "request_id", "-"),
    )


@router.get("/proforma-invoice/{proforma_id}", summary="Get a proforma invoice")
async def get_proforma_invoice(
    proforma_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    """Fetch a single proforma invoice by ID or proforma number."""
    record = await _resolve_proforma(db, proforma_id)
    return build_success_response(data=_serialize_proforma(record), request_id=getattr(request.state, "request_id", "-"))


@router.post("/proforma-invoice", status_code=status.HTTP_201_CREATED, summary="Create a proforma invoice")
async def create_proforma_invoice(
    payload: ProformaInvoiceCreate,
    request: Request,
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    """Insert a new proforma invoice, auto-numbering it and summing line items for the total if not given explicitly."""
    calc_amount = payload.amount_inc_gst
    if calc_amount is None:
        calc_amount = sum(item.amount for item in payload.items)

    total_existing = (await db.execute(select(func.count()).select_from(ProformaInvoice))).scalar() or 0
    proforma_no = f"PI-{total_existing + 1:04d}"

    record = ProformaInvoice(
        proforma_no=proforma_no,
        proforma_date=payload.proforma_date,
        expected_delivery_date=payload.expected_delivery_date,
        warehouse=payload.warehouse,
        lead_source=payload.lead_source,
        company_name=payload.company_name,
        city=payload.city,
        state=payload.state,
        sales_person=payload.sales_person,
        amount_inc_gst=calc_amount,
        discount=payload.discount,
        status=payload.status.strip().lower(),
        remark=payload.remark,
        created_by=payload.created_by,
    )
    db.add(record)
    await db.flush()

    for item in payload.items:
        db.add(
            ProformaInvoiceLineItem(
                proforma_id=record.id,
                product_name=item.product_name,
                product_code=item.product_code,
                hsn_code=item.hsn_code,
                gst_rate=item.gst_rate,
                quantity=item.quantity,
                uom=item.uom,
                rate=item.rate,
                amount=item.amount,
            )
        )

    await db.flush()
    await db.refresh(record, attribute_names=["items"])

    return build_success_response(
        data=_serialize_proforma(record),
        message="Proforma invoice created successfully.",
        request_id=getattr(request.state, "request_id", "-"),
    )


@router.patch("/proforma-invoice/{proforma_id}", summary="Update a proforma invoice")
async def update_proforma_invoice(
    proforma_id: str,
    payload: ProformaInvoiceUpdate,
    request: Request,
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    """Partially update a proforma invoice, replacing its line items wholesale if a new items list is given."""
    record = await _resolve_proforma(db, proforma_id)
    update_data = payload.model_dump(exclude_unset=True, exclude={"items"})

    if "status" in update_data and update_data["status"]:
        update_data["status"] = update_data["status"].strip().lower()

    for field_name, value in update_data.items():
        setattr(record, field_name, value)

    if payload.items is not None:
        record.items.clear()
        await db.flush()
        for item in payload.items:
            db.add(
                ProformaInvoiceLineItem(
                    proforma_id=record.id,
                    product_name=item.product_name,
                    product_code=item.product_code,
                    hsn_code=item.hsn_code,
                    gst_rate=item.gst_rate,
                    quantity=item.quantity,
                    uom=item.uom,
                    rate=item.rate,
                    amount=item.amount,
                )
            )
        if payload.amount_inc_gst is None:
            record.amount_inc_gst = sum(item.amount for item in payload.items)

    await db.flush()
    await db.refresh(record, attribute_names=["items"])

    return build_success_response(
        data=_serialize_proforma(record),
        message="Proforma invoice updated successfully.",
        request_id=getattr(request.state, "request_id", "-"),
    )


@router.delete("/proforma-invoice/{proforma_id}", summary="Delete a proforma invoice")
async def delete_proforma_invoice(
    proforma_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    """Soft-delete a proforma invoice."""
    from datetime import datetime, timezone

    record = await _resolve_proforma(db, proforma_id)
    record.deleted_at = datetime.now(timezone.utc)
    await db.flush()

    return build_success_response(data={"deleted": True}, request_id=getattr(request.state, "request_id", "-"))
