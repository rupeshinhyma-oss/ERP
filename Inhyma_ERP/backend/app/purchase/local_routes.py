"""Local Purchase endpoints (Purchase 'stock in' spec)."""

from __future__ import annotations

import re
import uuid
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any, Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile, status
from fastapi.responses import FileResponse, RedirectResponse
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_auth_service, get_current_user
from app.auth.service import AuthService, CurrentUser
from app.common import workflow as wf
from app.common.storage import guess_content_type, save_uploaded_file
from app.core.exceptions import AppException, BadRequestException, ConflictException, NotFoundException
from app.core.responses import build_success_response
from app.database.session import get_db_session
from app.masters.import_export import ImportSummary, model_to_dict, parse_rows_from_file
from app.masters.products.models import Product
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


class _InFileDuplicateRowError(Exception):
    """Raised when an identical invoice line item row is repeated in the same import file."""


def _norm_col(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", (name or "").lower()).strip()


def _cell(norm_row: dict[str, str], *aliases: str) -> str:
    for alias in aliases:
        val = norm_row.get(_norm_col(alias), "")
        if val != "":
            return val
    return ""


def _num_field(raw: str, label: str, *, required: bool = False, positive: bool = False) -> float:
    cleaned = raw.replace(",", "").strip()
    if cleaned == "":
        if required:
            raise BadRequestException(f"{label} is required.")
        return 0.0
    try:
        value = float(cleaned)
    except ValueError as exc:
        raise BadRequestException(f"{label} must be a valid number.") from exc
    if positive and value <= 0:
        raise BadRequestException(f"{label} must be greater than 0.")
    if not positive and value < 0:
        raise BadRequestException(f"{label} cannot be negative.")
    return value


async def _resolve_import_product(db: AsyncSession, product_name: str, product_code: str) -> dict:
    if product_name:
        try:
            return await product_defaults(db, product_name)
        except BadRequestException:
            if not product_code:
                prod_by_code = (
                    await db.execute(select(Product).where(func.lower(Product.product_code) == product_name.lower()))
                ).scalars().first()
                if prod_by_code is not None:
                    return await product_defaults(db, prod_by_code.product_name)
                raise
    if product_code:
        prod = (
            await db.execute(select(Product).where(func.lower(Product.product_code) == product_code.lower()))
        ).scalars().first()
        if prod is not None:
            return await product_defaults(db, prod.product_name)
        raise BadRequestException(f"Product code '{product_code}' is not in the Product Master.")
    raise BadRequestException("Product Name or Product Code is required.")


@router.post("/import", summary="Import local purchases from CSV/Excel")
async def import_local_purchases(
    request: Request,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db_session),
    user: CurrentUser = Depends(get_current_user),
) -> dict:
    raw_bytes = await file.read()
    rows = parse_rows_from_file(file.filename or "import.csv", raw_bytes)
    rules = await wf.load_status_rules(db, GROUP)
    initial_st = wf.initial_status(rules)

    summary = ImportSummary(total_rows=len(rows))
    batch_invoices: dict[tuple[str, str], dict[str, Any]] = {}

    for index, raw_row in enumerate(rows, start=2):
        norm = {_norm_col(k): str(v).strip() for k, v in raw_row.items() if k is not None and v is not None}
        try:
            async with db.begin_nested():
                invoice_no = _cell(norm, "invoice_no", "invoice no", "invoice number", "bill no")
                if not invoice_no:
                    raise BadRequestException("Invoice No. is required.")

                invoice_date_raw = _cell(norm, "invoice_date", "invoice date dd mm yyyy", "invoice date", "bill date", "date")
                if not invoice_date_raw:
                    raise BadRequestException("Invoice Date is required.")
                try:
                    inv_date = parse_date(invoice_date_raw)
                except ValueError as exc:
                    raise BadRequestException(str(exc)) from exc
                if inv_date is None:
                    raise BadRequestException("Invoice Date is required.")

                supplier_raw = _cell(norm, "supplier_name", "supplier", "vendor", "vendor name", "party name")
                supplier = await resolve_supplier(db, supplier_raw, None)

                warehouse_raw = _cell(norm, "warehouse", "warehouse name", "location")
                if not warehouse_raw:
                    raise BadRequestException("Warehouse is required.")
                warehouse = await require_physical_warehouse(db, warehouse_raw)

                product_name_raw = _cell(norm, "product_name", "product name", "product name as per tally", "item name", "product")
                product_code_raw = _cell(norm, "product_code", "product code", "sku", "item code")
                prod_info = await _resolve_import_product(db, product_name_raw, product_code_raw)

                qty = _num_field(_cell(norm, "quantity", "qty"), "Quantity", required=True, positive=True)
                unit_rate = _num_field(_cell(norm, "unit_rate", "unit rate inr", "unit rate", "rate", "basic rate"), "Unit Rate", required=True)
                ex_gst = _num_field(
                    _cell(norm, "invoice_value_ex_gst", "invoice total value basic without gst", "basic value", "basic amount"),
                    "Invoice Total Value (Basic Without GST)",
                )
                inc_gst_cell = _cell(
                    norm,
                    "invoice_value_inc_gst",
                    "invoice total value including gst",
                    "invoice total value inr",
                    "invoice total",
                )
                inc_gst_explicit = _num_field(inc_gst_cell, "Invoice Total Value (Including GST)") if inc_gst_cell != "" else None
                pf = _num_field(_cell(norm, "packing_forwarding", "packing forwarding"), "Packing & Forwarding")
                tr = _num_field(_cell(norm, "transport", "transport expense"), "Transport")
                off = _num_field(_cell(norm, "offloading", "offloading expense"), "Offloading")
                remarks = _cell(norm, "remarks", "remark", "notes") or None

                inv_key = (supplier.company_name.lower(), invoice_no.lower())
                line_sig = (prod_info["name"].lower(), round(qty, 6), round(unit_rate, 6))
                item_in = costing.LocalItemIn(
                    prod_info["name"],
                    qty,
                    unit_rate,
                    prod_info["uom"],
                    product_code_raw or prod_info["code"],
                )

                if inv_key in batch_invoices:
                    entry = batch_invoices[inv_key]
                    if line_sig in entry["seen_lines"]:
                        raise _InFileDuplicateRowError(
                            f"Duplicate of an earlier row in this file (Invoice '{invoice_no}', Product '{prod_info['name']}'); skipped."
                        )
                    entry["seen_lines"].add(line_sig)
                    entry["items_in"].append(item_in)
                    record: LocalPurchase = entry["record"]
                    result = costing.compute_local(
                        invoice_value_ex_gst=entry["explicit_ex_gst"],
                        packing_forwarding=record.packing_forwarding,
                        transport=record.transport,
                        offloading=record.offloading,
                        items=entry["items_in"],
                    )
                    record.invoice_value_ex_gst = result.invoice_value_ex_gst
                    record.invoice_value_inc_gst = (
                        entry["explicit_inc_gst"] if entry["explicit_inc_gst"] is not None else result.invoice_value_ex_gst
                    )
                    record.total_expenses = result.total_expenses
                    record.loading_percent = result.loading_percent
                    record.items.clear()
                    for ln in result.items:
                        record.items.append(
                            LocalPurchaseItem(
                                product_name=ln.product_name,
                                product_code=ln.product_code,
                                uom=ln.uom,
                                quantity=ln.quantity,
                                unit_rate=ln.unit_rate,
                                item_total=ln.item_total,
                                expense_per_unit=ln.expense_per_unit,
                                unit_landing_value=ln.unit_landing_value,
                            )
                        )
                    await db.flush()
                else:
                    existing_po = (
                        await db.execute(
                            select(LocalPurchase).where(
                                LocalPurchase.deleted_at.is_(None),
                                func.lower(LocalPurchase.supplier_name) == inv_key[0],
                                func.lower(LocalPurchase.invoice_no) == inv_key[1],
                            )
                        )
                    ).scalars().first()
                    if existing_po is not None:
                        raise ConflictException(
                            f"Invoice '{invoice_no}' from {supplier.company_name} is already recorded.",
                            details={"existing": model_to_dict(existing_po)},
                        )

                    items_in = [item_in]
                    result = costing.compute_local(
                        invoice_value_ex_gst=ex_gst,
                        packing_forwarding=pf,
                        transport=tr,
                        offloading=off,
                        items=items_in,
                    )
                    record = LocalPurchase(status=initial_st, created_by=user.username)
                    record.supplier_name, record.supplier_id = supplier.company_name, supplier.id
                    record.warehouse = warehouse.name
                    record.invoice_no = invoice_no
                    record.invoice_date = inv_date
                    record.invoice_value_ex_gst = result.invoice_value_ex_gst
                    record.invoice_value_inc_gst = inc_gst_explicit if inc_gst_explicit is not None else result.invoice_value_ex_gst
                    record.packing_forwarding = pf
                    record.transport = tr
                    record.offloading = off
                    record.total_expenses = result.total_expenses
                    record.loading_percent = result.loading_percent
                    record.remarks = remarks
                    for ln in result.items:
                        record.items.append(
                            LocalPurchaseItem(
                                product_name=ln.product_name,
                                product_code=ln.product_code,
                                uom=ln.uom,
                                quantity=ln.quantity,
                                unit_rate=ln.unit_rate,
                                item_total=ln.item_total,
                                expense_per_unit=ln.expense_per_unit,
                                unit_landing_value=ln.unit_landing_value,
                            )
                        )
                    db.add(record)
                    await db.flush()
                    batch_invoices[inv_key] = {
                        "record": record,
                        "items_in": items_in,
                        "explicit_ex_gst": ex_gst,
                        "explicit_inc_gst": inc_gst_explicit,
                        "seen_lines": {line_sig},
                    }

            summary.created += 1
        except _InFileDuplicateRowError as exc:
            summary.failed += 1
            summary.in_file_duplicate_count += 1
            summary.in_file_duplicates.append({"row": index, "error": str(exc), "row_data": dict(raw_row)})
        except ConflictException as exc:
            summary.failed += 1
            summary.duplicate_count += 1
            existing = exc.details.get("existing") if isinstance(exc.details, dict) else None
            summary.duplicates.append({"row": index, "error": str(exc), "row_data": dict(raw_row), "existing": existing})
        except AppException as exc:
            summary.failed += 1
            summary.errors.append({"row": index, "error": str(exc), "row_data": dict(raw_row)})
        except Exception as exc:  # noqa: BLE001
            summary.failed += 1
            summary.errors.append({"row": index, "error": str(exc), "row_data": dict(raw_row)})

    return build_success_response(
        data=summary.as_dict(),
        message=f"Imported local purchases: {summary.created} created, {summary.failed} failed.",
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


@router.get("/{purchase_id}/bill-file", summary="Download or view the attached bill file")
async def get_local_bill_file(
    purchase_id: uuid.UUID,
    request: Request,
    token: Optional[str] = Query(None),
    download: bool = Query(False),
    db: AsyncSession = Depends(get_db_session),
    auth_service: AuthService = Depends(get_auth_service),
):
    raw_token = token
    auth_header = request.headers.get("Authorization")
    if auth_header and auth_header.startswith("Bearer "):
        raw_token = auth_header[7:].strip()
    if not raw_token:
        raise HTTPException(status_code=401, detail="Authentication credentials were not provided.")
    try:
        await auth_service.verify_access_token(raw_token)
    except Exception as exc:
        raise HTTPException(status_code=401, detail="Invalid or expired access token.") from exc

    record = await _get(db, purchase_id)
    if not record.bill_file_url:
        raise NotFoundException("No bill file attached to this purchase.")

    if record.bill_file_url.startswith("http://") or record.bill_file_url.startswith("https://"):
        return RedirectResponse(url=record.bill_file_url)

    clean_name = Path(record.bill_file_url).name
    target = (Path("uploads") / "private" / "purchases" / clean_name).resolve()
    if not target.is_file():
        target = (Path("uploads") / "purchases" / clean_name).resolve()
    if not target.is_file():
        raise NotFoundException("Attached bill file not found on disk.")

    ext = target.suffix.lower().lstrip(".")
    media_type = guess_content_type(target.name)
    if ext == "pdf":
        media_type = "application/pdf"

    disp = "attachment" if download else "inline"
    return FileResponse(target, media_type=media_type, filename=record.bill_file_name or target.name, content_disposition_type=disp)

