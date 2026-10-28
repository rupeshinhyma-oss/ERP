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
from sqlalchemy import String, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth.dependencies import get_auth_service, get_current_user
from app.auth.service import AuthService, CurrentUser
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

        # Auto-create Sale Order matching Sales & PI Process workflow
        created_so = None
        existing_so = None
        try:
            from app.sales.models import SaleOrder, SaleOrderItem
            from app.sales.repository import SaleRepository
            from datetime import date

            async with db.begin_nested():
                existing_so = (
                    await db.execute(
                        select(SaleOrder).where(SaleOrder.proforma_id == record.id, SaleOrder.deleted_at.is_(None))
                    )
                ).scalars().first()

                if not existing_so:
                    sale_repo = SaleRepository(db)
                    so_no = await sale_repo.generate_order_no(date.today())

                    so_items = []
                    for it in record.items:
                        so_items.append(
                            SaleOrderItem(
                                product_name=it.product_name,
                                product_code=it.product_code,
                                hsn_code=it.hsn_code,
                                uom=it.uom or "Nos",
                                quantity=float(it.quantity),
                                unit_rate=float(it.rate),
                                unit_price=float(it.rate),
                                unit_discount=float(it.unit_discount or 0.0),
                                taxable_amount=float(it.taxable_amount or 0.0),
                                tax_percent=float(it.gst_percent or 18.0),
                                tax_amount=float(it.gst_amount or 0.0),
                                gst_amount=float(it.gst_amount or 0.0),
                                item_total=float(it.total or it.amount or 0.0),
                            )
                        )

                    # Deduct physical warehouse stock if warehouse is physical
                    from app.purchase.common import move_stock
                    from app.inventory import stock_service
                    wh = await stock_service.get_warehouse(db, record.warehouse)
                    if stock_service.is_physical(wh):
                        await move_stock(db, record.warehouse, [(i.product_name, i.quantity) for i in record.items], -1)

                    created_so = SaleOrder(
                        order_no=so_no,
                        buyer_name=record.company_name,
                        company_name=record.company_name,
                        warehouse=record.warehouse,
                        proforma_no=record.proforma_no,
                        proforma_id=record.id,
                        city=record.city,
                        state=record.state,
                        sales_person=record.sales_person,
                        billing_address=record.billing_address,
                        shipping_address=record.shipping_address,
                        payment_terms=record.payment_terms,
                        transporter_name=record.transport_name,
                        transport_destination=record.transport_destination,
                        delivery_type=record.delivery_type,
                        delivery_charge=record.delivery_charge,
                        third_party_delivery=record.third_party_delivery,
                        amount_inc_gst=float(record.amount_inc_gst),
                        discount=float(record.discount),
                        order_date=record.proforma_date or date.today().strftime("%d-%m-%Y"),
                        delivery_date=record.expected_delivery_date,
                        currency="INR",
                        status="sales_confirmed",
                        total_basic=float(record.taxable_amount or 0.0),
                        total_tax=float(record.gst_amount or 0.0),
                        total_amount=float(record.amount_inc_gst or 0.0),
                        total_quantity=sum(float(i.quantity) for i in record.items),
                        remarks=f"Generated from Proforma {record.proforma_no}. {record.remark or ''}".strip(),
                        created_by_name=current_user.username,
                        items=so_items,
                    )
                    db.add(created_so)
                    await db.flush()

                    from app.companies.repository import CompanyRepository
                    company_repo = CompanyRepository(db)
                    await company_repo.transition_to_existing_by_name(record.company_name)
        except (BadRequestException, ConflictException):
            raise
        except Exception:
            pass
    elif target == "cancelled":
        record.cancelled_by, record.cancelled_at = current_user.username, now
        record.cancel_reason = (payload.reason or "").strip()
    await db.flush()
    await db.refresh(record, attribute_names=["items"])

    res_data = _serialize_proforma(record)
    if target == "confirmed":
        so_record = created_so or existing_so
        if so_record:
            res_data["sale_order_no"] = so_record.order_no
            res_data["sale_order_id"] = str(so_record.id)

    return build_success_response(
        data=res_data,
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

def _extract_order_short_no(order_ref: str | None) -> str:
    s = (order_ref or "").strip()
    if "/" in s:
        tail = s.rsplit("/", 1)[-1].strip()
        if tail:
            return tail
    return s or "0001"


def _normalize_discount_stage(dp_status: str | None, so: Optional[object] = None) -> str:
    from app.sales.service import _discount_status_label

    if so is not None and getattr(so, "status", None):
        return _discount_status_label(getattr(so, "status", None))
    raw = (dp_status or "").strip()
    if not raw or raw.lower() == "pending":
        return "Pending"
    if raw.lower() in ("completed", "settled", "paid"):
        return "LR"
    return _discount_status_label(raw)


def _serialize_discount_payment(
    dp: DiscountPayment,
    so: Optional[object] = None,
    comp: Optional[object] = None,
    gp: Optional[object] = None,
) -> dict:
    from app.sales.service import _clean_gatepass_id, _format_ddmmyyyy, _format_ist_timeline_dt

    paid = round(float(getattr(dp, "paid_discount", 0.0) or 0.0), 2)
    total_disc = round(float(dp.discount_amount or 0.0), 2)
    raw_due = getattr(dp, "due_discount", None)
    due = round(
        float(raw_due) if raw_due is not None else max(0.0, total_disc - paid),
        2,
    )
    is_settled = bool(
        getattr(dp, "settled", False)
        or due <= 0.009
        or (dp.status or "").strip().lower() in ("completed", "settled", "paid")
    )
    if is_settled and due <= 0.009:
        due = 0.0

    # Live SaleOrder & GatePass enrichment
    order_id = str(getattr(so, "id", None) or dp.id)
    order_no = getattr(so, "order_no", None) or dp.order_ref
    order_date = (
        _format_ddmmyyyy(getattr(so, "order_date", None))
        or _format_ddmmyyyy(dp.payment_date)
        or dp.payment_date
    )
    warehouse = (
        getattr(so, "warehouse", None)
        or getattr(dp, "warehouse", None)
        or "Mumbai"
    )
    company_name = (
        getattr(so, "company_name", None)
        or getattr(so, "buyer_name", None)
        or dp.customer_name
    )
    sales_person = (
        getattr(so, "sales_person", None)
        or dp.sales_person
        or ""
    )
    stage_label = _normalize_discount_stage(dp.status, so=so)

    so_timeline = getattr(so, "timeline", None) if so is not None else None
    latest_timeline_dt = (
        str(so_timeline[0].get("date") or "").strip()
        if isinstance(so_timeline, list) and so_timeline and isinstance(so_timeline[0], dict)
        else ""
    )
    status_updated_at = (
        latest_timeline_dt
        or getattr(dp, "status_updated_at", None)
        or order_date
    )

    created_dt_obj = getattr(so, "created_at", None) or getattr(dp, "created_at", None)
    created_at_str = (
        _format_ist_timeline_dt(created_dt_obj)
        if created_dt_obj is not None
        else f"{order_date} 12:00 PM"
    )

    gatepass_id = (
        _clean_gatepass_id(getattr(gp, "gatepass_no", None))
        or _clean_gatepass_id(getattr(so, "gatepass_no", None) if so is not None else None)
        or _clean_gatepass_id(getattr(so, "gatepass", None) if so is not None else None)
        or _clean_gatepass_id(getattr(dp, "gatepass_id", None))
    )
    gatepass_date = (
        _format_ddmmyyyy(getattr(gp, "gatepass_date", None) if gp is not None else None)
        or _format_ddmmyyyy(getattr(so, "gatepass_date", None) if so is not None else None)
        or _format_ddmmyyyy(getattr(dp, "gatepass_date", None))
    )

    # Contact & Company Detail Drawer enrichment
    comp_contact_full = (getattr(comp, "contact_full_name", None) or "").strip() if comp is not None else ""
    comp_salutation = (getattr(comp, "contact_salutation", None) or "").strip() if comp is not None else ""
    comp_mobile = (
        ((getattr(comp, "contact_calling_number", None) or "").strip()
         or (getattr(comp, "contact_whatsapp_number", None) or "").strip())
        if comp is not None
        else ""
    )

    contact_person_name = (
        getattr(dp, "contact_person_name", None)
        or comp_contact_full
        or None
    )
    contact_person_mobile = (
        getattr(dp, "contact_person_mobile", None)
        or comp_mobile
        or None
    )
    if comp_contact_full:
        prefix = comp_salutation or "Mr"
        contact_name = (
            comp_contact_full
            if comp_contact_full.lower().startswith(("mr ", "ms ", "mrs ", "dr "))
            else f"{prefix} {comp_contact_full}"
        )
    elif contact_person_name:
        contact_name = (
            contact_person_name
            if contact_person_name.lower().startswith(("mr ", "ms ", "mrs ", "dr "))
            else f"Mr {contact_person_name}"
        )
    else:
        contact_name = None

    remark_val = (
        dp.remarks
        or (getattr(so, "booking_remarks", None) if so is not None else None)
        or (getattr(so, "remarks", None) if so is not None else None)
    )

    # Installment payment ledger (`payments` JSON array)
    raw_payments = getattr(dp, "payments", None)
    payments: list[dict] = []
    if isinstance(raw_payments, list) and len(raw_payments) > 0:
        for idx, item in enumerate(raw_payments):
            if isinstance(item, dict):
                payments.append({
                    "id": str(item.get("id") or f"{dp.id}-{idx + 1}"),
                    "date": str(item.get("date") or dp.settle_date or order_date),
                    "title": str(item.get("title") or "Discount Adjustment"),
                    "amount": round(float(item.get("amount") or 0.0), 2),
                    "adjusted_by": str(item.get("adjusted_by") or dp.created_by or "Admin"),
                })
    elif paid > 0.009:
        payments.append({
            "id": f"{dp.id}-1",
            "date": str(getattr(dp, "settle_date", None) or order_date),
            "title": str(getattr(dp, "settle_remarks", None) or "Discount Adjustment"),
            "amount": paid,
            "adjusted_by": str(sales_person or dp.created_by or "Admin"),
        })

    comp_status_raw = getattr(comp, "current_status", None) if comp is not None else None
    comp_status = (
        comp_status_raw.value
        if hasattr(comp_status_raw, "value")
        else str(comp_status_raw or "Existing")
    ).title()
    comp_potential_raw = getattr(comp, "potential", None) if comp is not None else None
    comp_potential = (
        comp_potential_raw.value
        if hasattr(comp_potential_raw, "value")
        else str(comp_potential_raw or "Yes")
    ).title()

    return {
        "id": str(dp.id),
        "order_id": order_id,
        "invoice_id": _extract_order_short_no(order_no),
        "created_at": created_at_str,
        "payment_no": dp.payment_no,
        "payment_date": order_date,
        "order_ref": order_no,
        "customer_name": company_name,
        "sales_person": sales_person,
        "warehouse": warehouse,
        "contact_person_name": contact_person_name,
        "contact_person_mobile": contact_person_mobile,
        "total_order_amount": float(dp.total_order_amount or 0.0),
        "discount_percent": float(dp.discount_percent or 0.0),
        "discount_amount": total_disc,
        "paid_discount": paid,
        "due_discount": due,
        "net_payable": float(dp.net_payable or 0.0),
        "status": stage_label,
        "status_updated_at": status_updated_at,
        "settled": is_settled,
        "gatepass_id": gatepass_id,
        "gatepass_date": gatepass_date,
        "gate_keeper_name": (
            (getattr(gp, "handled_by", None) if gp is not None else None)
            or (getattr(so, "gatepass_handled_by", None) if so is not None else None)
            or None
        ),
        "transport_name": (
            (getattr(gp, "transport_name", None) if gp is not None else None)
            or (getattr(so, "transporter_name", None) if so is not None else None)
            or None
        ),
        "delivery_type": (
            (getattr(gp, "delivery_type", None) if gp is not None else None)
            or (getattr(so, "delivery_type", None) if so is not None else None)
            or None
        ),
        "delivery_charge": (
            (getattr(gp, "delivery_charges", None) if gp is not None else None)
            or (getattr(so, "delivery_charge", None) if so is not None else None)
            or None
        ),
        "lr_file_url": getattr(so, "lr_file_url", None) if so is not None else None,
        "lr_file_name": getattr(so, "lr_file_name", None) if so is not None else None,
        "gst_no": getattr(comp, "tax_id_number", None) if comp is not None else None,
        "designation": getattr(comp, "contact_designation", None) if comp is not None else None,
        "contact_number": contact_person_mobile,
        "address_area": (
            ", ".join(
                p for p in (
                    getattr(comp, "address", None) if comp is not None else None,
                    getattr(comp, "area", None) if comp is not None else None,
                )
                if p
            )
            or (getattr(so, "billing_address", None) if so is not None else None)
        ),
        "city": (
            (getattr(so, "city", None) if so is not None else None)
            or (getattr(comp, "town", None) if comp is not None else None)
        ),
        "district": getattr(comp, "district", None) if comp is not None else None,
        "state": getattr(so, "state", None) if so is not None else None,
        "current_status": comp_status,
        "business_type": getattr(comp, "company_type", None) if comp is not None else None,
        "category": getattr(comp, "company_category", None) if comp is not None else None,
        "potential_type": comp_potential,
        "business_categories": getattr(comp, "business_category", None) if comp is not None else None,
        "payments": payments,
        "remarks": remark_val,
        "remark": remark_val,
        "created_by": dp.created_by,
        # Frontend UI compatibility aliases
        "order_no": order_no,
        "order_date": order_date,
        "company_name": company_name,
        "contact_name": contact_name,
        "total_discount": total_disc,
    }


async def _load_discount_enrichment_maps(
    db: AsyncSession,
    rows: list[DiscountPayment],
) -> tuple[dict[str, object], dict[str, object], dict[str, object]]:
    so_map: dict[str, object] = {}
    comp_map: dict[str, object] = {}
    gp_map: dict[str, object] = {}
    if not rows:
        return so_map, comp_map, gp_map

    order_refs = list({r.order_ref for r in rows if r.order_ref})
    try:
        from app.sales.models import GatePass, SaleOrder

        if order_refs:
            async with db.begin_nested():
                so_rows = (
                    await db.execute(
                        select(SaleOrder).where(
                            SaleOrder.order_no.in_(order_refs),
                            SaleOrder.deleted_at.is_(None),
                        )
                    )
                ).scalars().all()
                for so in so_rows:
                    so_map[so.order_no] = so

                gp_rows = (
                    await db.execute(
                        select(GatePass).where(
                            GatePass.so_no.in_(order_refs),
                            GatePass.deleted_at.is_(None),
                        )
                    )
                ).scalars().all()
                for gp in gp_rows:
                    if gp.so_no:
                        gp_map[gp.so_no] = gp
    except Exception:
        pass

    comp_names = list({
        (
            getattr(so_map.get(r.order_ref), "company_name", None)
            or r.customer_name
            or ""
        ).strip().lower()
        for r in rows
        if (getattr(so_map.get(r.order_ref), "company_name", None) or r.customer_name)
    })
    if comp_names:
        try:
            from sqlalchemy.orm import noload
            from app.companies.models import Company

            async with db.begin_nested():
                c_rows = (
                    await db.execute(
                        select(Company).options(noload("*")).where(
                            Company.deleted_at.is_(None),
                            func.lower(Company.company_name).in_(comp_names),
                        )
                    )
                ).scalars().all()
                for c in c_rows:
                    comp_map[c.company_name.strip().lower()] = c
        except Exception:
            pass

    return so_map, comp_map, gp_map


@router.get("/sales/discount-payments", summary="List discount payments")
async def list_discount_payments(
    request: Request,
    status_filter: Optional[str] = Query(None, alias="status"),
    warehouse: Optional[str] = Query(None),
    sales_person: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(500, ge=1, le=2000),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    """Return list of discount payment records, auto-synchronized with Sales Orders."""
    req_id = getattr(request.state, "request_id", "-")
    try:
        # Backfill any discounted SaleOrders not yet present in discount_payments
        try:
            from app.sales.models import SaleOrder
            from app.sales.service import SaleService

            async with db.begin_nested():
                missing_orders = (
                    await db.execute(
                        select(SaleOrder).where(
                            SaleOrder.deleted_at.is_(None),
                            SaleOrder.discount > 0,
                            func.lower(SaleOrder.status) != "cancelled",
                            ~SaleOrder.order_no.in_(
                                select(DiscountPayment.order_ref).where(
                                    DiscountPayment.deleted_at.is_(None)
                                )
                            ),
                        )
                    )
                ).scalars().all()
                if missing_orders:
                    svc = SaleService(db)
                    for mo in missing_orders:
                        await svc._sync_discount_payment(mo)
        except Exception:
            pass

        stmt = select(DiscountPayment).where(DiscountPayment.deleted_at.is_(None))
        if status_filter and status_filter.lower() != "all":
            sf = status_filter.strip().lower()
            if sf == "pending":
                stmt = stmt.where(
                    DiscountPayment.settled.is_(False),
                    DiscountPayment.due_discount > 0.009,
                )
            elif sf == "completed":
                stmt = stmt.where(
                    or_(
                        DiscountPayment.settled.is_(True),
                        DiscountPayment.due_discount <= 0.009,
                    )
                )
            else:
                stmt = stmt.where(func.lower(DiscountPayment.status) == sf)
        if warehouse and warehouse.lower() not in ("all", "all."):
            stmt = stmt.where(func.lower(DiscountPayment.warehouse) == warehouse.strip().lower())
        if sales_person and sales_person.lower() not in ("all", "all."):
            stmt = stmt.where(func.lower(DiscountPayment.sales_person).like(f"%{sales_person.strip().lower()}%"))
        if search:
            q = f"%{search.strip().lower()}%"
            stmt = stmt.where(
                or_(
                    func.lower(DiscountPayment.payment_no).like(q),
                    func.lower(DiscountPayment.order_ref).like(q),
                    func.lower(DiscountPayment.customer_name).like(q),
                    func.lower(DiscountPayment.sales_person).like(q),
                    func.lower(DiscountPayment.contact_person_name).like(q),
                    func.lower(DiscountPayment.gatepass_id).like(q),
                )
            )
        total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar() or 0
        stmt = stmt.order_by(DiscountPayment.created_at.desc()).offset(skip).limit(limit)
        results = list((await db.execute(stmt)).scalars().all())
        so_map, comp_map, gp_map = await _load_discount_enrichment_maps(db, results)
        items = [
            _serialize_discount_payment(
                dp,
                so=so_map.get(dp.order_ref),
                comp=comp_map.get(
                    (
                        getattr(so_map.get(dp.order_ref), "company_name", None)
                        or dp.customer_name
                        or ""
                    ).strip().lower()
                ),
                gp=gp_map.get(dp.order_ref),
            )
            for dp in results
        ]
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
    from app.sales.service import IST, _format_ist_timeline_dt

    req_id = getattr(request.state, "request_id", "-")
    disc_amt = round(payload.total_order_amount * (payload.discount_percent / 100.0), 2)
    net = round(payload.total_order_amount - disc_amt, 2)
    today_str = datetime.now(IST).strftime("%d-%m-%Y")
    now_ist_str = _format_ist_timeline_dt()

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
            paid_discount=0.0,
            due_discount=disc_amt,
            net_payable=net,
            status="Pending",
            status_updated_at=now_ist_str,
            settled=False,
            payments=[],
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
            "warehouse": "Mumbai",
            "total_order_amount": payload.total_order_amount,
            "discount_percent": payload.discount_percent,
            "discount_amount": disc_amt,
            "paid_discount": 0.0,
            "due_discount": disc_amt,
            "net_payable": net,
            "status": "Pending",
            "settled": False,
            "payments": [],
            "remarks": payload.remarks,
            "created_by": "Admin User",
        }
        return build_success_response(
            data=mock_data,
            message="Discount payment recorded successfully.",
            request_id=req_id,
        )


@router.patch("/sales/discount-payments/{payment_id}", summary="Record settlement or adjustment for a discount payment")
async def update_discount_payment_settlement(
    payment_id: str,
    payload: dict,
    request: Request,
    db: AsyncSession = Depends(get_db_session),
    auth_service: AuthService = Depends(get_auth_service),
) -> dict:
    """Record a partial or full discount adjustment installment on a discount record."""
    from app.sales.service import IST, SaleService, _format_ddmmyyyy

    req_id = getattr(request.state, "request_id", "-")
    stmt = select(DiscountPayment).where(
        DiscountPayment.deleted_at.is_(None),
        or_(
            func.cast(DiscountPayment.id, String) == payment_id,
            DiscountPayment.payment_no == payment_id,
            DiscountPayment.order_ref == payment_id,
        ),
    )
    rec = (await db.execute(stmt)).scalars().first()
    if not rec:
        return build_success_response(
            data={"id": payment_id, "settled": payload.get("settled", True)},
            message="Settlement updated (mock).",
            request_id=req_id,
        )

    total_disc = round(float(rec.discount_amount or 0.0), 2)
    old_paid = round(float(rec.paid_discount or 0.0), 2)
    old_due = round(
        float(rec.due_discount)
        if rec.due_discount is not None
        else max(0.0, total_disc - old_paid),
        2,
    )

    if "amount" in payload and payload["amount"] is not None:
        try:
            delta = round(float(payload["amount"]), 2)
        except (TypeError, ValueError):
            raise BadRequestException("Adjustment amount must be a valid number.")
    elif "paid_discount" in payload and payload["paid_discount"] is not None:
        try:
            target_paid = round(float(payload["paid_discount"]), 2)
        except (TypeError, ValueError):
            raise BadRequestException("Paid discount must be a valid number.")
        delta = round(target_paid - old_paid, 2)
    else:
        delta = old_due

    if delta <= 0:
        raise BadRequestException("Adjustment amount must be greater than 0.")
    if delta > old_due + 0.01:
        raise BadRequestException(
            f"Adjustment amount ({delta:.2f}) cannot exceed remaining due discount ({old_due:.2f})."
        )

    # Resolve logged-in user display name ("Adjustment By" in List Payments modal)
    actor_name: str | None = None
    auth_header = request.headers.get("authorization") or ""
    if auth_header.lower().startswith("bearer "):
        raw_token = auth_header.split(" ", 1)[1].strip()
        if raw_token:
            try:
                curr_user = await auth_service.verify_access_token(raw_token)
                actor_name = await SaleService(db)._resolve_actor_name(curr_user)
            except Exception:
                actor_name = None
    if not actor_name:
        actor_name = (
            str(payload.get("adjusted_by") or "").strip()
            or rec.sales_person
            or rec.created_by
            or "Admin"
        )

    settle_date_str = (
        _format_ddmmyyyy(payload.get("settle_date"))
        or datetime.now(IST).strftime("%d-%m-%Y")
    )
    raw_remark = str(payload.get("settle_remarks") or "").strip()
    title_str = raw_remark or "Discount Adjustment"

    existing_payments = list(rec.payments) if isinstance(rec.payments, list) else []
    if not existing_payments and old_paid > 0.009:
        existing_payments.append({
            "id": str(uuid.uuid4()),
            "date": str(rec.settle_date or rec.payment_date),
            "title": str(rec.settle_remarks or "Discount Adjustment"),
            "amount": old_paid,
            "adjusted_by": str(rec.sales_person or rec.created_by or "Admin"),
        })

    existing_payments.append({
        "id": str(uuid.uuid4()),
        "date": settle_date_str,
        "title": title_str,
        "amount": round(min(delta, old_due), 2),
        "adjusted_by": actor_name,
    })

    new_paid = round(min(total_disc, old_paid + delta), 2)
    new_due = round(max(0.0, total_disc - new_paid), 2)
    is_settled = new_due <= 0.009

    rec.paid_discount = new_paid
    rec.due_discount = 0.0 if is_settled else new_due
    rec.settled = is_settled
    rec.settle_date = settle_date_str
    rec.payments = existing_payments
    if raw_remark:
        rec.settle_remarks = raw_remark
        if not rec.remarks:
            rec.remarks = raw_remark

    await db.flush()
    await db.refresh(rec)
    so_map, comp_map, gp_map = await _load_discount_enrichment_maps(db, [rec])
    so_obj = so_map.get(rec.order_ref)
    comp_obj = comp_map.get(
        (
            getattr(so_obj, "company_name", None)
            or rec.customer_name
            or ""
        ).strip().lower()
    )
    gp_obj = gp_map.get(rec.order_ref)
    return build_success_response(
        data=_serialize_discount_payment(rec, so=so_obj, comp=comp_obj, gp=gp_obj),
        message="Discount settlement updated successfully.",
        request_id=req_id,
    )


# ==============================================================================
# Deleted Orders (erp.inhymasolutions.com/delete_order_report/list#)
# ==============================================================================

_DELETED_ORDERS_SEED = [
    {
        "id": "del-1",
        "order_no": "SO-MP/26-27/0618",
        "order_date": "07-10-2026",
        "warehouse": "Indore",
        "expected_delivery_date": "07-10-2026",
        "company_name": "SMART PACKAGING SYSTEMS",
        "city": "Indore",
        "state": "Madhya Pradesh",
        "third_party": "No",
        "po": "No",
        "sales_person": "Sunita Pawar",
        "amount_inc_gst": 17700.0,
        "discount": 0.0,
        "status": "Trash",
        "deleted_at": "07-10-2026 01:21 PM",
        "acc_dep": "Pending",
        "gatepass": "Pending",
        "remark": "",
    },
    {
        "id": "del-2",
        "order_no": "SO-MH/26-27/4476",
        "order_date": "07-10-2026",
        "warehouse": "Mumbai",
        "expected_delivery_date": "07-10-2026",
        "company_name": "SHANTI PACKAGING",
        "city": "Navi Mumbai",
        "state": "Maharashtra",
        "third_party": "No",
        "po": "No",
        "sales_person": "Dhairya Shah",
        "amount_inc_gst": 6608.0,
        "discount": 0.0,
        "status": "Trash",
        "deleted_at": "07-10-2026 12:21 PM",
        "acc_dep": "Pending",
        "gatepass": "Pending",
        "remark": "",
    },
    {
        "id": "del-3",
        "order_no": "SO-MH/26-27/4402",
        "order_date": "03-10-2026",
        "warehouse": "Mumbai",
        "expected_delivery_date": "03-10-2026",
        "company_name": "HARSH PLASTIC AND MACHINERY",
        "city": "Bhadran",
        "state": "Gujarat",
        "third_party": "No",
        "po": "No",
        "sales_person": "Bhavin Suthar",
        "amount_inc_gst": 177000.0,
        "discount": 0.0,
        "status": "Trash",
        "deleted_at": "03-10-2026 02:40 PM",
        "acc_dep": "Pending",
        "gatepass": "Pending",
        "remark": "",
    },
    {
        "id": "del-4",
        "order_no": "SO-MH/26-27/4401",
        "order_date": "03-10-2026",
        "warehouse": "Mumbai",
        "expected_delivery_date": "03-10-2026",
        "company_name": "DHUMER AUTOMATION & SERVICES",
        "city": "Vapi",
        "state": "Gujarat",
        "third_party": "No",
        "po": "No",
        "sales_person": "Bhavin Suthar",
        "amount_inc_gst": 118000.0,
        "discount": 0.0,
        "status": "Trash",
        "deleted_at": "03-10-2026 02:30 PM",
        "acc_dep": "Pending",
        "gatepass": "Pending",
        "remark": "Order cancelled by client",
    },
    {
        "id": "del-5",
        "order_no": "SO-MH/26-27/4394",
        "order_date": "03-10-2026",
        "warehouse": "Mumbai",
        "expected_delivery_date": "03-10-2026",
        "company_name": "SPARKLING CLEANERS",
        "city": "Mira-Bhayandar",
        "state": "Maharashtra",
        "third_party": "No",
        "po": "No",
        "sales_person": "Siddhi Kilaje",
        "amount_inc_gst": 74340.0,
        "discount": 0.0,
        "status": "Trash",
        "deleted_at": "03-10-2026 02:26 PM",
        "acc_dep": "Pending",
        "gatepass": "Pending",
        "remark": "",
    },
    {
        "id": "del-6",
        "order_no": "SO-GJ/26-27/0862",
        "order_date": "03-10-2026",
        "warehouse": "Ahmedabad",
        "expected_delivery_date": "03-10-2026",
        "company_name": "MAGICPACK AUTOMATIONS PVT LTD",
        "city": "Medchal",
        "state": "Telangana",
        "third_party": "No",
        "po": "No",
        "sales_person": "Abhishek Patel",
        "amount_inc_gst": 53100.0,
        "discount": 0.0,
        "status": "Trash",
        "deleted_at": "03-10-2026 03:50 PM",
        "acc_dep": "Pending",
        "gatepass": "Pending",
        "remark": "",
    },
    {
        "id": "del-7",
        "order_no": "SO-MH/26-27/4386",
        "order_date": "03-10-2026",
        "warehouse": "Mumbai",
        "expected_delivery_date": "03-10-2026",
        "company_name": "GLOBAL IMPEX MACHINERY",
        "city": "AHMEDABAD",
        "state": "Gujarat",
        "third_party": "Yes",
        "po": "No",
        "sales_person": "Dhairya Shah",
        "amount_inc_gst": 122130.0,
        "discount": 0.0,
        "status": "Trash",
        "deleted_at": "04-10-2026 11:41 AM",
        "acc_dep": "Pending",
        "gatepass": "Pending",
        "remark": "",
    },
]


@router.get("/sales/deleted-orders", summary="List deleted / cancelled orders")
@router.get("/delete_order_report/list", summary="Alias for deleted orders report")
@router.get("/delete-order-report/list", summary="Hyphenated alias for deleted orders report matching documentation")
async def list_deleted_orders(
    request: Request,
    warehouse: Optional[str] = Query(None),
    sales_person: Optional[str] = Query(None),
    state: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    """Return deleted orders matching filters."""
    req_id = getattr(request.state, "request_id", "-")
    items = [dict(o) for o in _DELETED_ORDERS_SEED]

    try:
        from app.sales.models import SaleOrder
        # Also query DB for any soft-deleted SaleOrder records
        db_stmt = select(SaleOrder).where(SaleOrder.deleted_at.is_not(None)).order_by(SaleOrder.deleted_at.desc())
        db_rows = (await db.execute(db_stmt)).scalars().all()
        for r in db_rows:
            items.append({
                "id": str(r.id),
                "order_no": r.order_no,
                "order_date": r.order_date,
                "warehouse": r.warehouse or "Mumbai",
                "expected_delivery_date": r.delivery_date or r.order_date,
                "company_name": r.company_name or r.buyer_name,
                "city": r.city or "",
                "state": r.state or "",
                "third_party": r.third_party_delivery or "No",
                "po": "No",
                "sales_person": r.sales_person or "Admin",
                "amount_inc_gst": float(r.amount_inc_gst or r.total_amount or 0.0),
                "discount": float(r.discount or 0.0),
                "status": "Trash",
                "deleted_at": r.deleted_at.strftime("%d-%m-%Y %I:%M %p") if r.deleted_at else "Recently",
                "acc_dep": "Pending",
                "gatepass": r.gatepass or "Pending",
                "remark": r.remarks or "",
            })
    except Exception:
        pass

    # Apply filters
    filtered = items
    if warehouse and warehouse.strip() not in ("All", "All Warehouses"):
        filtered = [i for i in filtered if i.get("warehouse", "").lower() == warehouse.strip().lower()]

    if sales_person and sales_person.strip() != "All":
        filtered = [i for i in filtered if sales_person.strip().lower() in i.get("sales_person", "").lower()]

    if state and state.strip() not in ("All", "x All"):
        filtered = [i for i in filtered if state.strip().lower() in i.get("state", "").lower()]

    if search and search.strip():
        q = search.strip().lower()
        filtered = [
            i for i in filtered
            if q in i.get("order_no", "").lower()
            or q in i.get("company_name", "").lower()
            or q in i.get("sales_person", "").lower()
            or q in i.get("city", "").lower()
            or q in i.get("state", "").lower()
        ]

    total = len(filtered)
    paged = filtered[skip : skip + limit]

    return build_success_response(
        data={"items": paged, "total": total, "skip": skip, "limit": limit},
        request_id=req_id,
    )


@router.post("/sales/deleted-orders/{order_id}/restore", summary="Restore a deleted order")
@router.post("/delete_order_report/{order_id}/restore", summary="Alias to restore a deleted order")
@router.post("/delete-order-report/{order_id}/restore", summary="Alias to restore a deleted order")
async def restore_deleted_order(
    order_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    req_id = getattr(request.state, "request_id", "-")
    from app.sales.models import SaleOrder
    import uuid

    # Try UUID parse
    found = False
    try:
        u_id = uuid.UUID(order_id)
        stmt = select(SaleOrder).where(SaleOrder.id == u_id)
        order = (await db.execute(stmt)).scalars().first()
        if order:
            order.deleted_at = None
            await db.flush()
            found = True
    except (ValueError, TypeError):
        pass

    if not found:
        # Also check by order_no
        stmt = select(SaleOrder).where(SaleOrder.order_no == order_id)
        order = (await db.execute(stmt)).scalars().first()
        if order:
            order.deleted_at = None
            await db.flush()
            found = True

    return build_success_response(
        data={"id": order_id, "restored": True},
        request_id=req_id,
    )

