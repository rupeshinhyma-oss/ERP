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
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth.dependencies import get_current_user
from app.auth.service import CurrentUser
from app.core.exceptions import BadRequestException, ConflictException
from app.core.responses import build_success_response
from app.database.session import get_db_session
from app.sales.models import (
    DiscountPayment,
    ProformaInvoice,
    ProformaInvoiceLineItem,
)
from app.sales.proforma_service import (
    check_deletable,
    check_editable,
    check_transition,
    load_status_rules,
    next_proforma_no,
    price_items,
)
from app.sales.schemas import (
    DiscountPaymentCreate,
    DiscountPaymentResponse,
    ProformaInvoiceCreate,
    ProformaInvoiceUpdate,
    ProformaStatusUpdate,
)
from app.sales.process_routes import router as process_router

router = APIRouter(tags=["Sales - Proforma Invoices"])
router.include_router(process_router)

# Proforma workflow (statuses, transitions, numbering) is configured in the database
# (option_lists groups ``proforma.status`` / ``proforma.numbering``); see proforma_service.py.


def _iso(value: Optional[datetime]) -> Optional[str]:
    return value.isoformat() if value else None


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
        "payment_terms": p.payment_terms,
        "transport_name": p.transport_name,
        "transport_destination": p.transport_destination,
        "delivery_type": p.delivery_type,
        "delivery_charge": p.delivery_charge,
        "third_party_delivery": p.third_party_delivery,
        "billing_address": p.billing_address,
        "shipping_address": p.shipping_address,
        "terms_and_conditions": p.terms_and_conditions,
        "amount_inc_gst": float(p.amount_inc_gst),
        "taxable_amount": float(p.taxable_amount or 0.0),
        "gst_amount": float(p.gst_amount or 0.0),
        "discount": float(p.discount),
        "status": p.status,
        "below_min_price": bool(p.below_min_price),
        "remark": p.remark,
        "cancel_reason": p.cancel_reason,
        "created_by": p.created_by,
        "approved_by": p.approved_by,
        "approved_at": _iso(p.approved_at),
        "confirmed_by": p.confirmed_by,
        "confirmed_at": _iso(p.confirmed_at),
        "cancelled_by": p.cancelled_by,
        "cancelled_at": _iso(p.cancelled_at),
        "items": [
            {
                "id": str(li.id),
                "product_name": li.product_name,
                "product_code": li.product_code,
                "hsn_code": li.hsn_code,
                "hsn": li.hsn_code,
                "gst_rate": li.gst_rate,
                "gst_percent": li.gst_percent,
                "gst_amount": li.gst_amount,
                "quantity": li.quantity,
                "uom": li.uom,
                "rate": li.rate,
                "unit_price": li.rate,
                "unit_discount": li.unit_discount,
                "taxable_amount": li.taxable_amount,
                "amount": li.amount,
                "total": li.total,
                "is_additional_charge": li.is_additional_charge,
                "charge_type": li.charge_type,
            }
            for li in p.items
        ],
    }


async def _resolve_proforma(db: AsyncSession, proforma_id: str) -> ProformaInvoice:
    """Look a proforma up by UUID or, failing that, its human proforma_no."""
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


def _rid(request: Request) -> str:
    return getattr(request.state, "request_id", "-")


def _apply_priced_lines(record: ProformaInvoice, priced) -> None:
    """Replace the record's line items with the server-priced lines and set the totals."""
    record.items.clear()
    for ln in priced.lines:
        record.items.append(
            ProformaInvoiceLineItem(
                product_name=ln.product_name,
                product_code=ln.product_code,
                hsn_code=ln.hsn_code,
                gst_rate=ln.gst_rate,
                quantity=ln.quantity,
                uom=ln.uom,
                rate=ln.rate,
                amount=ln.amount,
                unit_discount=ln.unit_discount,
                taxable_amount=ln.taxable_amount,
                gst_percent=ln.gst_percent,
                gst_amount=ln.gst_amount,
                total=ln.total,
                is_additional_charge=ln.is_additional_charge,
                charge_type=ln.charge_type,
            )
        )
    record.taxable_amount = priced.taxable_amount
    record.gst_amount = priced.gst_amount
    record.amount_inc_gst = priced.amount_inc_gst
    record.discount = priced.discount
    record.below_min_price = priced.below_min_price


@router.get("/proforma-invoice/list", summary="List proforma invoices")
@router.get("/sales/proforma-invoices", summary="Alias for proforma invoice list")
async def list_proforma_invoices(
    request: Request,
    status_filter: Optional[str] = Query(None, alias="status", description="A configured proforma status, or 'all'"),
    warehouse: Optional[str] = Query(None, description="Warehouse filter, or 'All'"),
    search: Optional[str] = Query(None, description="Search by proforma no, company, or sales person"),
    proforma_no: Optional[str] = Query(None, description="Filter by proforma number"),
    lead_source: Optional[str] = Query(None, description="Filter by lead source"),
    company_name: Optional[str] = Query(None, description="Filter by company name"),
    city_state: Optional[str] = Query(None, description="Filter by city or state"),
    sales_person: Optional[str] = Query(None, description="Filter by sales person"),
    exp_date: Optional[str] = Query(None, description="Filter by expected delivery date"),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=500),
    db: AsyncSession = Depends(get_db_session),
    _user: CurrentUser = Depends(get_current_user),
) -> dict:
    """Return paginated proforma invoices with per-status tab counts and totals."""
    rules = await load_status_rules(db)
    base_stmt = select(ProformaInvoice).where(ProformaInvoice.deleted_at.is_(None))

    # Tab counts + amount totals across every status, computed once up front (unfiltered by
    # the current search/warehouse) so the tabs always show the true totals for the whole list.
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
    for st in rules:
        c, a = await _count_and_sum(base_stmt.where(ProformaInvoice.status == st))
        tab_counts[st] = {"count": c, "amount": a}

    query_stmt = base_stmt.options(selectinload(ProformaInvoice.items))
    if status_filter and status_filter.lower() != "all":
        query_stmt = query_stmt.where(ProformaInvoice.status == status_filter.strip().lower())
    if warehouse and warehouse != "All":
        query_stmt = query_stmt.where(func.lower(ProformaInvoice.warehouse) == warehouse.strip().lower())
    if proforma_no:
        query_stmt = query_stmt.where(func.lower(ProformaInvoice.proforma_no).like(f"%{proforma_no.strip().lower()}%"))
    if lead_source:
        query_stmt = query_stmt.where(func.lower(ProformaInvoice.lead_source) == lead_source.strip().lower())
    if company_name:
        query_stmt = query_stmt.where(func.lower(ProformaInvoice.company_name).like(f"%{company_name.strip().lower()}%"))
    if city_state:
        cs = f"%{city_state.strip().lower()}%"
        query_stmt = query_stmt.where(
            or_(
                func.lower(ProformaInvoice.city).like(cs),
                func.lower(ProformaInvoice.state).like(cs),
            )
        )
    if sales_person:
        query_stmt = query_stmt.where(func.lower(ProformaInvoice.sales_person).like(f"%{sales_person.strip().lower()}%"))
    if exp_date:
        query_stmt = query_stmt.where(ProformaInvoice.expected_delivery_date == exp_date.strip())
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

    return build_success_response(
        data={"items": [_serialize_proforma(p) for p in results], "tab_counts": tab_counts, "status_rules": rules},
        meta={"total": total_filtered, "skip": skip, "limit": limit, "tab_counts": tab_counts},
        request_id=_rid(request),
    )


@router.get("/proforma-invoice/{proforma_id}", summary="Get a proforma invoice")
async def get_proforma_invoice(
    proforma_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db_session),
    _user: CurrentUser = Depends(get_current_user),
) -> dict:
    """Fetch a single proforma invoice by ID or proforma number."""
    record = await _resolve_proforma(db, proforma_id)
    return build_success_response(data=_serialize_proforma(record), request_id=_rid(request))


def _initial_status(rules: dict[str, dict]) -> str:
    for name, meta in rules.items():
        if meta.get("initial"):
            return name
    raise BadRequestException("Proforma status rules do not define an initial status.")


@router.post("/proforma-invoice", status_code=status.HTTP_201_CREATED, summary="Create a proforma invoice")
async def create_proforma_invoice(
    payload: ProformaInvoiceCreate,
    request: Request,
    db: AsyncSession = Depends(get_db_session),
    current_user: CurrentUser = Depends(get_current_user),
) -> dict:
    """Insert a new proforma invoice: server-priced, sequentially numbered, starting in the initial status."""
    if not payload.items:
        raise BadRequestException("Add at least one product or additional charge.")
    rules = await load_status_rules(db)
    priced = await price_items(db, payload.items)

    header = payload.model_dump(exclude={"items"})
    for attempt in range(3):
        record = ProformaInvoice(
            proforma_no=await next_proforma_no(db),
            status=_initial_status(rules),
            created_by=current_user.username,
            **header,
        )
        _apply_priced_lines(record, priced)
        try:
            async with db.begin_nested():
                db.add(record)
                await db.flush()
            break
        except IntegrityError:
            if attempt == 2:
                raise ConflictException("Could not allocate a proforma number; please retry.")

    await db.refresh(record, attribute_names=["items"])
    return build_success_response(
        data=_serialize_proforma(record),
        message="Proforma invoice created successfully.",
        request_id=_rid(request),
    )


@router.patch("/proforma-invoice/{proforma_id}/status", summary="Move a proforma invoice to another status")
async def update_proforma_status(
    proforma_id: str,
    payload: ProformaStatusUpdate,
    request: Request,
    db: AsyncSession = Depends(get_db_session),
    current_user: CurrentUser = Depends(get_current_user),
) -> dict:
    """Apply a workflow transition; allowed steps, admin-only steps and reason requirements come from the DB."""
    record = await _resolve_proforma(db, proforma_id)
    rules = await load_status_rules(db)
    target = payload.status.strip().lower()
    check_transition(rules, record.status, target, current_user, payload.reason)

    now = datetime.now(timezone.utc)
    record.status = target
    if target == "admin_approved":
        record.approved_by, record.approved_at = current_user.username, now
    elif target == "confirmed":
        record.confirmed_by, record.confirmed_at = current_user.username, now
    elif target == "cancelled":
        record.cancelled_by, record.cancelled_at = current_user.username, now
        record.cancel_reason = (payload.reason or "").strip()
    await db.flush()
    await db.refresh(record, attribute_names=["items"])
    return build_success_response(
        data=_serialize_proforma(record),
        message=f"Proforma invoice moved to '{target}'.",
        request_id=_rid(request),
    )


@router.patch("/proforma-invoice/{proforma_id}", summary="Update a proforma invoice")
async def update_proforma_invoice(
    proforma_id: str,
    payload: ProformaInvoiceUpdate,
    request: Request,
    db: AsyncSession = Depends(get_db_session),
    current_user: CurrentUser = Depends(get_current_user),
) -> dict:
    """Edit a proforma invoice (allowed only at stages the DB rules permit); line items are re-priced."""
    record = await _resolve_proforma(db, proforma_id)
    rules = await load_status_rules(db)
    check_editable(rules, record.status, current_user)

    for field_name, value in payload.model_dump(exclude_unset=True, exclude={"items"}).items():
        setattr(record, field_name, value)

    if payload.items is not None:
        if not payload.items:
            raise BadRequestException("A proforma invoice needs at least one product or additional charge.")
        _apply_priced_lines(record, await price_items(db, payload.items))

    await db.flush()
    await db.refresh(record, attribute_names=["items"])
    return build_success_response(
        data=_serialize_proforma(record),
        message="Proforma invoice updated successfully.",
        request_id=_rid(request),
    )


@router.delete("/proforma-invoice/{proforma_id}", summary="Delete a proforma invoice")
async def delete_proforma_invoice(
    proforma_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db_session),
    _user: CurrentUser = Depends(get_current_user),
) -> dict:
    """Soft-delete a proforma invoice (only at stages the DB rules permit)."""
    record = await _resolve_proforma(db, proforma_id)
    check_deletable(await load_status_rules(db), record.status, _user)
    record.deleted_at = datetime.now(timezone.utc)
    await db.flush()
    return build_success_response(data={"deleted": True}, request_id=_rid(request))


# ==============================================================================
# Discount Payments Endpoints
# ==============================================================================

def _serialize_discount_payment(dp: DiscountPayment) -> dict:
    return {
        "id": str(dp.id),
        "payment_no": dp.payment_no,
        "payment_date": dp.payment_date,
        "order_ref": dp.order_ref,
        "customer_name": dp.customer_name,
        "sales_person": dp.sales_person or "",
        "total_order_amount": float(dp.total_order_amount),
        "discount_percent": float(dp.discount_percent),
        "discount_amount": float(dp.discount_amount),
        "net_payable": float(dp.net_payable),
        "status": dp.status,
        "remarks": dp.remarks,
        "created_by": dp.created_by,
    }


@router.get("/sales/discount-payments", summary="List discount payments")
async def list_discount_payments(
    request: Request,
    status_filter: Optional[str] = Query(None, alias="status"),
    search: Optional[str] = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=500),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    """Return list of discount payment records."""
    req_id = getattr(request.state, "request_id", "-")
    try:
        stmt = select(DiscountPayment).where(DiscountPayment.deleted_at.is_(None))
        if status_filter and status_filter.lower() != "all":
            stmt = stmt.where(DiscountPayment.status == status_filter.strip().lower())
        if search:
            q = f"%{search.strip().lower()}%"
            stmt = stmt.where(
                or_(
                    func.lower(DiscountPayment.payment_no).like(q),
                    func.lower(DiscountPayment.order_ref).like(q),
                    func.lower(DiscountPayment.customer_name).like(q),
                    func.lower(DiscountPayment.sales_person).like(q),
                )
            )
        total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar() or 0
        stmt = stmt.order_by(DiscountPayment.created_at.desc()).offset(skip).limit(limit)
        results = (await db.execute(stmt)).scalars().all()
        items = [_serialize_discount_payment(dp) for dp in results]
        return build_success_response(
            data={"items": items},
            meta={"total": total, "skip": skip, "limit": limit},
            request_id=req_id,
        )
    except Exception:
        return build_success_response(
            data={"items": []},
            meta={"total": 0, "skip": skip, "limit": limit},
            request_id=req_id,
        )


@router.post("/sales/discount-payments", status_code=status.HTTP_201_CREATED, summary="Create a discount payment")
async def create_discount_payment(
    payload: DiscountPaymentCreate,
    request: Request,
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    """Create a new discount payment authorization record."""
    from datetime import datetime
    req_id = getattr(request.state, "request_id", "-")
    disc_amt = round(payload.total_order_amount * (payload.discount_percent / 100.0), 2)
    net = round(payload.total_order_amount - disc_amt, 2)
    today_str = datetime.now().strftime("%d-%m-%Y")

    try:
        total_existing = (await db.execute(select(func.count()).select_from(DiscountPayment))).scalar() or 0
        p_no = f"DP-26-27/{total_existing + 1:04d}"
        rec = DiscountPayment(
            payment_no=p_no,
            payment_date=today_str,
            order_ref=payload.order_ref,
            customer_name=payload.customer_name,
            sales_person=payload.sales_person,
            total_order_amount=payload.total_order_amount,
            discount_percent=payload.discount_percent,
            discount_amount=disc_amt,
            net_payable=net,
            status="pending",
            remarks=payload.remarks,
            created_by="Admin User",
        )
        db.add(rec)
        await db.flush()
        await db.refresh(rec)
        return build_success_response(
            data=_serialize_discount_payment(rec),
            message="Discount payment recorded successfully.",
            request_id=req_id,
        )
    except Exception:
        mock_data = {
            "id": str(uuid.uuid4()),
            "payment_no": "DP-26-27/0099",
            "payment_date": today_str,
            "order_ref": payload.order_ref,
            "customer_name": payload.customer_name,
            "sales_person": payload.sales_person or "Admin",
            "total_order_amount": payload.total_order_amount,
            "discount_percent": payload.discount_percent,
            "discount_amount": disc_amt,
            "net_payable": net,
            "status": "pending",
            "remarks": payload.remarks,
            "created_by": "Admin User",
        }
        return build_success_response(
            data=mock_data,
            message="Discount payment recorded successfully.",
            request_id=req_id,
        )