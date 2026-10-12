"""Local Purchase endpoints (Purchase 'stock in' spec)."""

from __future__ import annotations

import uuid
from datetime import date, datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, File, Query, Request, UploadFile, status
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_user
from app.auth.service import CurrentUser
from app.common import workflow as wf
from app.common.storage import save_uploaded_file
from app.core.exceptions import BadRequestException, ConflictException, NotFoundException
from app.core.responses import build_success_response
from app.database.session import get_db_session
from app.purchase import costing
from app.purchase.common import load_parties, party_fields, move_stock, product_defaults, require_physical_warehouse, resolve_supplier
from app.purchase.models import LocalPurchase, LocalPurchaseItem
from app.purchase.schemas import LocalPurchaseIn, StatusUpdate, fmt_date, parse_date

router = APIRouter(prefix="/purchase/local-orders", tags=["Purchase - Local"])
GROUP = "purchase.local.status"


def _rid(request: Request) -> str:
    return getattr(request.state, "request_id", "-")


def _iso(value: Optional[datetime]) -> Optional[str]:
    return value.isoformat() if value else None


def _serialize(p: LocalPurchase, parties: dict) -> dict:
    return {**party_fields(p, parties),
        "id": str(p.id),
        "supplier_name": p.supplier_name,
        "supplier_id": str(p.supplier_id) if p.supplier_id else None,
        "warehouse": p.warehouse,
        "invoice_no": p.invoice_no,
        "invoice_date": fmt_date(p.invoice_date),
        "invoice_value_ex_gst": p.invoice_value_ex_gst,
        "invoice_value_inc_gst": p.invoice_value_inc_gst,
        "packing_forwarding": p.packing_forwarding,
        "transport": p.transport,
        "offloading": p.offloading,
        "total_expenses": p.total_expenses,
        "loading_percent": p.loading_percent,
        "grand_total": round(sum(i.item_total for i in p.items), 2),
        "remarks": p.remarks,
        "bill_file_url": p.bill_file_url,
        "bill_file_name": p.bill_file_name,
        "status": p.status,
        "stock_applied": p.stock_applied,
        "created_by": p.created_by,
        "created_date": fmt_date(p.created_at.date()) if p.created_at else None,
        "confirmed_by": p.confirmed_by,
        "confirmed_at": _iso(p.confirmed_at),
        "items": [
            {
                "id": str(i.id),
                "product_name": i.product_name,
                "product_code": i.product_code,
                "uom": i.uom,
                "quantity": i.quantity,
                "unit_rate": i.unit_rate,
                "item_total": i.item_total,
                "expense_per_unit": i.expense_per_unit,
                "unit_landing_value": i.unit_landing_value,
            }
            for i in p.items
        ],
    }


async def _present(db: AsyncSession, records: list) -> list[dict]:
    parties = await load_parties(db, records)
    return [_serialize(r, parties) for r in records]


async def _get(db: AsyncSession, purchase_id: uuid.UUID) -> LocalPurchase:
    record = (
        await db.execute(select(LocalPurchase).where(LocalPurchase.id == purchase_id, LocalPurchase.deleted_at.is_(None)))
    ).scalars().first()
    if record is None:
        raise NotFoundException("Local purchase not found.")
    return record


async def _prepare(db: AsyncSession, payload: LocalPurchaseIn, *, exclude_id: Optional[uuid.UUID] = None):
    """Validate against the masters and price the lines. Returns (supplier, warehouse, costing result)."""
    supplier = await resolve_supplier(db, payload.supplier_name, payload.supplier_id)
    warehouse = await require_physical_warehouse(db, payload.warehouse)

    dup = select(LocalPurchase.id).where(
        LocalPurchase.deleted_at.is_(None),
        func.lower(LocalPurchase.supplier_name) == supplier.company_name.lower(),
        func.lower(LocalPurchase.invoice_no) == payload.invoice_no.strip().lower(),
    )
    if exclude_id:
        dup = dup.where(LocalPurchase.id != exclude_id)
    if (await db.execute(dup.limit(1))).first():
        raise ConflictException(f"Invoice '{payload.invoice_no}' from {supplier.company_name} is already recorded.")

    lines = []
    for it in payload.items:
        d = await product_defaults(db, it.product_name)
        lines.append(costing.LocalItemIn(d["name"], it.quantity, it.unit_rate, it.uom or d["uom"], it.product_code or d["code"]))
    result = costing.compute_local(
        invoice_value_ex_gst=payload.invoice_value_ex_gst, packing_forwarding=payload.packing_forwarding,
        transport=payload.transport, offloading=payload.offloading, items=lines,
    )
    return supplier, warehouse, result


def _apply(record: LocalPurchase, payload: LocalPurchaseIn, supplier, warehouse, result) -> None:
    record.supplier_name, record.supplier_id = supplier.company_name, supplier.id
    record.warehouse = warehouse.name
    record.invoice_no = payload.invoice_no.strip()
    record.invoice_date = payload.invoice_date
    record.invoice_value_ex_gst = result.invoice_value_ex_gst
    record.invoice_value_inc_gst = payload.invoice_value_inc_gst
    record.packing_forwarding, record.transport, record.offloading = payload.packing_forwarding, payload.transport, payload.offloading
    record.total_expenses, record.loading_percent = result.total_expenses, result.loading_percent
    record.remarks = payload.remarks
    record.items.clear()
    for ln in result.items:
        record.items.append(
            LocalPurchaseItem(
                product_name=ln.product_name, product_code=ln.product_code, uom=ln.uom, quantity=ln.quantity,
                unit_rate=ln.unit_rate, item_total=ln.item_total, expense_per_unit=ln.expense_per_unit,
                unit_landing_value=ln.unit_landing_value,
            )
        )


@router.get("", summary="List local purchases")
async def list_local_purchases(
    request: Request,
    status_filter: Optional[str] = Query(None, alias="status"),
    warehouse: Optional[str] = None,
    supplier: Optional[str] = None,
    search: Optional[str] = None,
    date_from: Optional[str] = Query(None, description="Invoice date from, DD-MM-YYYY"),
    date_to: Optional[str] = Query(None, description="Invoice date to, DD-MM-YYYY"),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=500),
    db: AsyncSession = Depends(get_db_session),
    _user: CurrentUser = Depends(get_current_user),
) -> dict:
    rules = await wf.load_status_rules(db, GROUP)
    base = select(LocalPurchase).where(LocalPurchase.deleted_at.is_(None))

    tab_counts = {}
    total = (await db.execute(select(func.count()).select_from(base.subquery()))).scalar() or 0
    tab_counts["all"] = {"count": int(total)}
    for st in rules:
        n = (await db.execute(select(func.count()).select_from(base.where(LocalPurchase.status == st).subquery()))).scalar() or 0
        tab_counts[st] = {"count": int(n)}

    q = base
    if status_filter and status_filter.lower() != "all":
        q = q.where(LocalPurchase.status == status_filter.strip().lower())
    if warehouse and warehouse != "All":
        q = q.where(func.lower(LocalPurchase.warehouse) == warehouse.strip().lower())
    if supplier:
        q = q.where(func.lower(LocalPurchase.supplier_name).like(f"%{supplier.strip().lower()}%"))
    if date_from and (d := parse_date(date_from)):
        q = q.where(LocalPurchase.invoice_date >= d)
    if date_to and (d := parse_date(date_to)):
        q = q.where(LocalPurchase.invoice_date <= d)
    if search:
        like = f"%{search.strip().lower()}%"
        q = q.where(or_(func.lower(LocalPurchase.supplier_name).like(like), func.lower(LocalPurchase.invoice_no).like(like),
                        func.lower(LocalPurchase.warehouse).like(like)))
    filtered = (await db.execute(select(func.count()).select_from(q.subquery()))).scalar() or 0
    rows = (await db.execute(q.order_by(LocalPurchase.created_at.desc()).offset(skip).limit(limit))).scalars().all()
    return build_success_response(
        data={"items": await _present(db, list(rows)), "tab_counts": tab_counts, "status_rules": rules},
        meta={"total": int(filtered), "skip": skip, "limit": limit},
        request_id=_rid(request),
    )


@router.get("/{purchase_id}", summary="Get a local purchase")
async def get_local_purchase(
    purchase_id: uuid.UUID, request: Request, db: AsyncSession = Depends(get_db_session), _user: CurrentUser = Depends(get_current_user)
) -> dict:
    return build_success_response(data=(await _present(db, [await _get(db, purchase_id)]))[0], request_id=_rid(request))


@router.post("", status_code=status.HTTP_201_CREATED, summary="Create a local purchase")
async def create_local_purchase(
    payload: LocalPurchaseIn,
    request: Request,
    db: AsyncSession = Depends(get_db_session),
    user: CurrentUser = Depends(get_current_user),
) -> dict:
    rules = await wf.load_status_rules(db, GROUP)
    supplier, warehouse, result = await _prepare(db, payload)
    record = LocalPurchase(status=wf.initial_status(rules), created_by=user.username)
    _apply(record, payload, supplier, warehouse, result)
    db.add(record)
    await db.flush()
    await db.refresh(record, attribute_names=["items"])
    return build_success_response(data=(await _present(db, [record]))[0], message="Local purchase created.", request_id=_rid(request))


@router.put("/{purchase_id}", summary="Edit a local purchase")
async def update_local_purchase(
    purchase_id: uuid.UUID,
    payload: LocalPurchaseIn,
    request: Request,
    db: AsyncSession = Depends(get_db_session),
    user: CurrentUser = Depends(get_current_user),
) -> dict:
    record = await _get(db, purchase_id)
    rules = await wf.load_status_rules(db, GROUP)
    wf.check_editable(rules, record.status, user)
    supplier, warehouse, result = await _prepare(db, payload, exclude_id=record.id)
    _apply(record, payload, supplier, warehouse, result)
    await db.flush()
    await db.refresh(record, attribute_names=["items"])
    return build_success_response(data=(await _present(db, [record]))[0], message="Local purchase updated.", request_id=_rid(request))


@router.patch("/{purchase_id}/status", summary="Move a local purchase to another status")
async def update_local_status(
    purchase_id: uuid.UUID,
    payload: StatusUpdate,
    request: Request,
    db: AsyncSession = Depends(get_db_session),
    user: CurrentUser = Depends(get_current_user),
) -> dict:
    record = await _get(db, purchase_id)
    rules = await wf.load_status_rules(db, GROUP)
    target = payload.status.strip().lower()
    wf.check_transition(rules, record.status, target, user, payload.reason)

    if rules[target].get("stock_in") and not record.stock_applied:
        await move_stock(db, record.warehouse, [(i.product_name, i.quantity) for i in record.items], +1)
        record.stock_applied = True
        record.confirmed_by, record.confirmed_at = user.username, datetime.now(timezone.utc)
    record.status = target
    await db.flush()
    await db.refresh(record, attribute_names=["items"])
    return build_success_response(data=(await _present(db, [record]))[0], message=f"Local purchase moved to '{target}'.", request_id=_rid(request))


@router.delete("/{purchase_id}", summary="Delete a local purchase (reverses stock if it was confirmed)")
async def delete_local_purchase(
    purchase_id: uuid.UUID, request: Request, db: AsyncSession = Depends(get_db_session), user: CurrentUser = Depends(get_current_user)
) -> dict:
    record = await _get(db, purchase_id)
    rules = await wf.load_status_rules(db, GROUP)
    wf.check_deletable(rules, record.status, user)
    if record.stock_applied:
        await move_stock(db, record.warehouse, [(i.product_name, i.quantity) for i in record.items], -1)
        record.stock_applied = False
    record.deleted_at = datetime.now(timezone.utc)
    await db.flush()
    return build_success_response(data={"deleted": True}, request_id=_rid(request))


@router.post("/{purchase_id}/bill", summary="Attach the supplier's bill")
async def upload_local_bill(
    purchase_id: uuid.UUID,
    request: Request,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db_session),
    user: CurrentUser = Depends(get_current_user),
) -> dict:
    record = await _get(db, purchase_id)
    wf.check_editable(await wf.load_status_rules(db, GROUP), record.status, user)
    url, _stored = await save_uploaded_file(
        content=await file.read(), original_filename=file.filename or "bill", bucket="purchase-bills",
        local_subfolder="purchases", content_type=file.content_type,
    )
    record.bill_file_url, record.bill_file_name = url, file.filename
    await db.flush()
    await db.refresh(record, attribute_names=["items"])
    return build_success_response(data=(await _present(db, [record]))[0], message="Bill attached.", request_id=_rid(request))


@router.delete("/{purchase_id}/bill", summary="Remove the attached bill")
async def delete_local_bill(
    purchase_id: uuid.UUID, request: Request, db: AsyncSession = Depends(get_db_session), user: CurrentUser = Depends(get_current_user)
) -> dict:
    record = await _get(db, purchase_id)
    wf.check_editable(await wf.load_status_rules(db, GROUP), record.status, user)
    record.bill_file_url = record.bill_file_name = None
    await db.flush()
    await db.refresh(record, attribute_names=["items"])
    return build_success_response(data=(await _present(db, [record]))[0], message="Bill removed.", request_id=_rid(request))
