"""Import Purchase endpoints (Import Purchase spec)."""

from __future__ import annotations

import uuid
from collections import defaultdict
from datetime import date, datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, File, Query, Request, UploadFile, status
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_user
from app.auth.service import CurrentUser
from app.common import workflow as wf
from app.common.storage import save_uploaded_file
from app.core.exceptions import ConflictException, NotFoundException
from app.core.responses import build_success_response
from app.database.session import get_db_session
from app.inventory import stock_service
from app.purchase import costing
from app.purchase.common import load_parties, party_fields, by_product, check_future, move_stock, product_defaults, resolve_supplier
from app.purchase.models import ImportPurchase, ImportPurchaseItem
from app.purchase.schemas import ImportPreviewIn, ImportPurchaseIn, StatusUpdate, fmt_date, parse_date

router = APIRouter(prefix="/purchase/import-orders", tags=["Purchase - Import"])
GROUP = "purchase.import.status"

ITEM_FIELDS = (
    "product_name product_code uom quantity pkg_unit_cbm pkg_qty item_total_cbm unit_rate_usd unit_rate_inr item_total_usd "
    "duty_percent unit_import_duty item_total_duty exp_per_unit_vb exp_per_unit_cb unit_landing_vb unit_landing_cb landing_diff"
).split()
DATE_FIELDS = ("ordered_date", "etd_origin_date", "eta_port_date", "expected_arrival_date", "invoice_date")
INPUT_FIELDS = (
    "consignment_no conversion_rate customs_conversion_rate invoice_total_usd total_cbm total_import_duty freight insurance "
    "stamp_duty shipping_line_charges cfs_charges clearing_transport offloading misc_charges misc_remarks remarks"
).split()
EXPENSE_FIELDS = (
    "freight insurance stamp_duty shipping_line_charges cfs_charges clearing_transport offloading misc_charges"
).split()


def _rid(request: Request) -> str:
    return getattr(request.state, "request_id", "-")


def _iso(value: Optional[datetime]) -> Optional[str]:
    return value.isoformat() if value else None


def _serialize(p: ImportPurchase, parties: dict) -> dict:
    data = {**party_fields(p, parties),
        "id": str(p.id),
        "supplier_name": p.supplier_name,
        "supplier_id": str(p.supplier_id) if p.supplier_id else None,
        "warehouse": p.warehouse,
        "invoice_total_inr": p.invoice_total_inr,
        "total_expenses": p.total_expenses,
        "gross_total_landing": p.gross_total_landing,
        "loading_percent_vb": p.loading_percent_vb,
        "loading_amount_per_cbm": p.loading_amount_per_cbm,
        "bill_file_url": p.bill_file_url,
        "bill_file_name": p.bill_file_name,
        "status": p.status,
        "stock_applied": p.stock_applied,
        "created_by": p.created_by,
        "created_date": fmt_date(p.created_at.date()) if p.created_at else None,
        "updated_date": fmt_date(p.updated_at.date()) if p.updated_at else None,
        "confirmed_by": p.confirmed_by,
        "confirmed_at": _iso(p.confirmed_at),
        "received_at": _iso(p.received_at),
        "closed_at": _iso(p.closed_at),
        "items": [{"id": str(i.id), **{f: getattr(i, f) for f in ITEM_FIELDS}} for i in p.items],
    }
    data.update({f: getattr(p, f) for f in INPUT_FIELDS})
    data.update({f: fmt_date(getattr(p, f)) for f in DATE_FIELDS})
    data["sum_cbm"] = round(sum(i.item_total_cbm for i in p.items), 4)
    data["sum_usd"] = round(sum(i.item_total_usd for i in p.items), 2)
    data["sum_duty"] = round(sum(i.item_total_duty for i in p.items), 2)
    return data


async def _present(db: AsyncSession, records: list) -> list[dict]:
    parties = await load_parties(db, records)
    return [_serialize(r, parties) for r in records]


async def _get(db: AsyncSession, purchase_id: uuid.UUID) -> ImportPurchase:
    record = (
        await db.execute(select(ImportPurchase).where(ImportPurchase.id == purchase_id, ImportPurchase.deleted_at.is_(None)))
    ).scalars().first()
    if record is None:
        raise NotFoundException("Import purchase not found.")
    return record


async def _prepare(db: AsyncSession, payload: ImportPurchaseIn, previous: Optional[ImportPurchase]):
    supplier = await resolve_supplier(db, payload.supplier_name, payload.supplier_id)
    warehouse = await stock_service.get_warehouse(db, payload.warehouse)
    today = date.today()

    if payload.ordered_date != (previous.ordered_date if previous else None) and payload.ordered_date > today:
        from app.core.exceptions import BadRequestException

        raise BadRequestException("Ordered date cannot be in the future.")
    for label, field in (("ETD origin date", "etd_origin_date"), ("ETA port date", "eta_port_date"),
                         ("Expected arrival date", "expected_arrival_date")):
        check_future(label, getattr(payload, field), getattr(previous, field) if previous else None, today)

    dup = select(ImportPurchase.id).where(
        ImportPurchase.deleted_at.is_(None),
        func.lower(ImportPurchase.consignment_no) == payload.consignment_no.strip().lower(),
    )
    if previous:
        dup = dup.where(ImportPurchase.id != previous.id)
    if (await db.execute(dup.limit(1))).first():
        raise ConflictException(f"Consignment '{payload.consignment_no}' is already recorded.")

    lines = []
    for it in payload.items:
        d = await product_defaults(db, it.product_name)
        lines.append(
            costing.ImportItemIn(
                product_name=d["name"], quantity=it.quantity, unit_rate_usd=it.unit_rate_usd,
                pkg_unit_cbm=d["pkg_unit_cbm"] if it.pkg_unit_cbm is None else it.pkg_unit_cbm,
                pkg_qty=d["pkg_qty"] if it.pkg_qty is None else it.pkg_qty,
                duty_percent=d["duty_percent"] if it.duty_percent is None else it.duty_percent,
                uom=it.uom or d["uom"], product_code=it.product_code or d["code"],
            )
        )
    result = costing.compute_import(
        conversion_rate=payload.conversion_rate, customs_conversion_rate=payload.customs_conversion_rate,
        invoice_total_usd=payload.invoice_total_usd, total_cbm=payload.total_cbm,
        total_import_duty=payload.total_import_duty, expenses=[getattr(payload, f) for f in EXPENSE_FIELDS], items=lines,
    )
    return supplier, warehouse, result


def _apply(record: ImportPurchase, payload: ImportPurchaseIn, supplier, warehouse, result) -> None:
    record.supplier_name, record.supplier_id, record.warehouse = supplier.company_name, supplier.id, warehouse.name
    for f in INPUT_FIELDS:
        setattr(record, f, getattr(payload, f))
    record.consignment_no = payload.consignment_no.strip()
    for f in DATE_FIELDS:
        setattr(record, f, getattr(payload, f))
    record.invoice_total_inr = result.invoice_total_inr
    record.total_expenses = result.total_expenses
    record.gross_total_landing = result.gross_total_landing
    record.loading_percent_vb = result.loading_percent_vb
    record.loading_amount_per_cbm = result.loading_amount_per_cbm
    record.items.clear()
    for ln in result.items:
        record.items.append(ImportPurchaseItem(**{f: getattr(ln, f) for f in ITEM_FIELDS}))


@router.get("", summary="List import purchases")
async def list_import_purchases(
    request: Request,
    status_filter: Optional[str] = Query(None, alias="status"),
    warehouse: Optional[str] = None,
    supplier: Optional[str] = None,
    search: Optional[str] = None,
    arrival_from: Optional[str] = Query(None, description="Expected arrival date from, DD-MM-YYYY"),
    arrival_to: Optional[str] = None,
    etd_from: Optional[str] = None,
    etd_to: Optional[str] = None,
    eta_from: Optional[str] = None,
    eta_to: Optional[str] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=500),
    db: AsyncSession = Depends(get_db_session),
    _user: CurrentUser = Depends(get_current_user),
) -> dict:
    rules = await wf.load_status_rules(db, GROUP)
    base = select(ImportPurchase).where(ImportPurchase.deleted_at.is_(None))
    tab_counts = {"all": {"count": int((await db.execute(select(func.count()).select_from(base.subquery()))).scalar() or 0)}}
    for st in rules:
        n = (await db.execute(select(func.count()).select_from(base.where(ImportPurchase.status == st).subquery()))).scalar() or 0
        tab_counts[st] = {"count": int(n)}

    q = base
    if status_filter and status_filter.lower() != "all":
        q = q.where(ImportPurchase.status == status_filter.strip().lower())
    if warehouse and warehouse != "All":
        q = q.where(func.lower(ImportPurchase.warehouse) == warehouse.strip().lower())
    if supplier:
        q = q.where(func.lower(ImportPurchase.supplier_name).like(f"%{supplier.strip().lower()}%"))
    for column, lo, hi in (
        (ImportPurchase.expected_arrival_date, arrival_from, arrival_to),
        (ImportPurchase.etd_origin_date, etd_from, etd_to),
        (ImportPurchase.eta_port_date, eta_from, eta_to),
    ):
        if lo and (d := parse_date(lo)):
            q = q.where(column >= d)
        if hi and (d := parse_date(hi)):
            q = q.where(column <= d)
    if search:
        like = f"%{search.strip().lower()}%"
        q = q.where(or_(func.lower(ImportPurchase.supplier_name).like(like), func.lower(ImportPurchase.consignment_no).like(like),
                        func.lower(ImportPurchase.warehouse).like(like)))
    filtered = (await db.execute(select(func.count()).select_from(q.subquery()))).scalar() or 0
    rows = (await db.execute(q.order_by(ImportPurchase.created_at.desc()).offset(skip).limit(limit))).scalars().all()
    return build_success_response(
        data={"items": await _present(db, list(rows)), "tab_counts": tab_counts, "status_rules": rules},
        meta={"total": int(filtered), "skip": skip, "limit": limit},
        request_id=_rid(request),
    )


@router.post("/preview", summary="Calculate the landing cost for the values typed so far (nothing is saved)")
async def preview_import_purchase(
    payload: ImportPreviewIn,
    request: Request,
    db: AsyncSession = Depends(get_db_session),
    _user: CurrentUser = Depends(get_current_user),
) -> dict:
    """Runs the exact formulas used on save, so the form never shows a number the server would not store."""
    lines = []
    for it in payload.items:
        if not it.product_name.strip():
            continue
        d = await product_defaults(db, it.product_name)
        lines.append(
            costing.ImportItemIn(
                product_name=d["name"], quantity=it.quantity, unit_rate_usd=it.unit_rate_usd,
                pkg_unit_cbm=d["pkg_unit_cbm"] if it.pkg_unit_cbm is None else it.pkg_unit_cbm,
                pkg_qty=d["pkg_qty"] if it.pkg_qty is None else it.pkg_qty,
                duty_percent=d["duty_percent"] if it.duty_percent is None else it.duty_percent,
                uom=it.uom or d["uom"], product_code=it.product_code or d["code"],
            )
        )
    r = costing.compute_import(
        conversion_rate=payload.conversion_rate, customs_conversion_rate=payload.customs_conversion_rate,
        invoice_total_usd=payload.invoice_total_usd, total_cbm=payload.total_cbm, total_import_duty=payload.total_import_duty,
        expenses=[getattr(payload, f) for f in EXPENSE_FIELDS], items=lines,
    )
    data = {
        "invoice_total_inr": r.invoice_total_inr, "total_expenses": r.total_expenses, "gross_total_landing": r.gross_total_landing,
        "loading_percent_vb": r.loading_percent_vb, "loading_amount_per_cbm": r.loading_amount_per_cbm,
        "sum_cbm": r.sum_cbm, "sum_usd": r.sum_usd, "sum_duty": r.sum_duty,
        "items": [{f: getattr(i, f) for f in ITEM_FIELDS} for i in r.items],
    }
    return build_success_response(data=data, request_id=_rid(request))


@router.get("/{purchase_id}", summary="Get an import purchase")
async def get_import_purchase(
    purchase_id: uuid.UUID, request: Request, db: AsyncSession = Depends(get_db_session), _user: CurrentUser = Depends(get_current_user)
) -> dict:
    return build_success_response(data=(await _present(db, [await _get(db, purchase_id)]))[0], request_id=_rid(request))


@router.post("", status_code=status.HTTP_201_CREATED, summary="Create an import purchase (adds stock immediately)")
async def create_import_purchase(
    payload: ImportPurchaseIn,
    request: Request,
    db: AsyncSession = Depends(get_db_session),
    user: CurrentUser = Depends(get_current_user),
) -> dict:
    rules = await wf.load_status_rules(db, GROUP)
    supplier, warehouse, result = await _prepare(db, payload, None)
    first = wf.initial_status(rules)
    record = ImportPurchase(status=first, created_by=user.username)
    _apply(record, payload, supplier, warehouse, result)
    if rules[first].get("stock_in"):
        await move_stock(db, record.warehouse, [(i.product_name, i.quantity) for i in record.items], +1)
        record.stock_applied = True
    db.add(record)
    await db.flush()
    await db.refresh(record, attribute_names=["items"])
    return build_success_response(data=(await _present(db, [record]))[0], message="Import purchase created.", request_id=_rid(request))


@router.put("/{purchase_id}", summary="Edit an import purchase (stock is adjusted by the net change)")
async def update_import_purchase(
    purchase_id: uuid.UUID,
    payload: ImportPurchaseIn,
    request: Request,
    db: AsyncSession = Depends(get_db_session),
    user: CurrentUser = Depends(get_current_user),
) -> dict:
    record = await _get(db, purchase_id)
    rules = await wf.load_status_rules(db, GROUP)
    wf.check_editable(rules, record.status, user)
    supplier, warehouse, result = await _prepare(db, payload, record)

    old_warehouse = await stock_service.get_warehouse(db, record.warehouse)
    if record.stock_applied and old_warehouse.name != warehouse.name and stock_service.is_physical(old_warehouse):
        raise ConflictException("The warehouse cannot be changed once stock has been received into a physical warehouse.")

    if record.stock_applied:
        deltas: dict[tuple[str, str], float] = defaultdict(float)
        for name, qty in by_product((i.product_name, i.quantity) for i in record.items).items():
            deltas[(old_warehouse.name, name)] -= qty
        for name, qty in by_product((ln.product_name, ln.quantity) for ln in result.items).items():
            deltas[(warehouse.name, name)] += qty
        for (wh, name), delta in sorted(deltas.items(), key=lambda kv: -kv[1]):       # additions before removals
            if abs(delta) > 1e-9:
                await stock_service.apply_stock_delta(db, product_name=name, warehouse_name=wh, delta=delta)

    _apply(record, payload, supplier, warehouse, result)
    await db.flush()
    await db.refresh(record, attribute_names=["items"])
    return build_success_response(data=(await _present(db, [record]))[0], message="Import purchase updated.", request_id=_rid(request))


@router.patch("/{purchase_id}/status", summary="Move an import purchase to another status")
async def update_import_status(
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
    now = datetime.now(timezone.utc)
    record.status = target
    if target == "confirmed":
        record.confirmed_by, record.confirmed_at = user.username, now
    elif target == "received":
        record.received_at = now
    elif target == "closed":
        record.closed_at = now
    await db.flush()
    await db.refresh(record, attribute_names=["items"])
    return build_success_response(data=(await _present(db, [record]))[0], message=f"Import purchase moved to '{target}'.", request_id=_rid(request))


@router.delete("/{purchase_id}", summary="Delete an import purchase (reverses its stock)")
async def delete_import_purchase(
    purchase_id: uuid.UUID, request: Request, db: AsyncSession = Depends(get_db_session), user: CurrentUser = Depends(get_current_user)
) -> dict:
    record = await _get(db, purchase_id)
    wf.check_deletable(await wf.load_status_rules(db, GROUP), record.status, user)
    if record.stock_applied:
        await move_stock(db, record.warehouse, [(i.product_name, i.quantity) for i in record.items], -1)
        record.stock_applied = False
    record.deleted_at = datetime.now(timezone.utc)
    await db.flush()
    return build_success_response(data={"deleted": True}, request_id=_rid(request))


@router.post("/{purchase_id}/bill", summary="Attach the invoice")
async def upload_import_bill(
    purchase_id: uuid.UUID,
    request: Request,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db_session),
    user: CurrentUser = Depends(get_current_user),
) -> dict:
    record = await _get(db, purchase_id)
    wf.check_editable(await wf.load_status_rules(db, GROUP), record.status, user)
    url, _stored = await save_uploaded_file(
        content=await file.read(), original_filename=file.filename or "invoice", bucket="purchase-bills",
        local_subfolder="purchases", content_type=file.content_type,
    )
    record.bill_file_url, record.bill_file_name = url, file.filename
    await db.flush()
    await db.refresh(record, attribute_names=["items"])
    return build_success_response(data=(await _present(db, [record]))[0], message="Invoice attached.", request_id=_rid(request))


@router.delete("/{purchase_id}/bill", summary="Remove the attached invoice")
async def delete_import_bill(
    purchase_id: uuid.UUID, request: Request, db: AsyncSession = Depends(get_db_session), user: CurrentUser = Depends(get_current_user)
) -> dict:
    record = await _get(db, purchase_id)
    wf.check_editable(await wf.load_status_rules(db, GROUP), record.status, user)
    record.bill_file_url = record.bill_file_name = None
    await db.flush()
    await db.refresh(record, attribute_names=["items"])
    return build_success_response(data=(await _present(db, [record]))[0], message="Invoice removed.", request_id=_rid(request))
