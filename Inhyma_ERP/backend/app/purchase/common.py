"""Helpers shared by the Local and Import purchase routes."""

from __future__ import annotations

from collections import defaultdict
from datetime import date
from typing import Iterable

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import BadRequestException
from app.inventory import stock_service
from app.masters.billing_companies.models import BillingCompany
from app.masters.cities.models import City
from app.masters.states.models import State
from app.masters.taxes.models import Tax
from app.masters.uom.models import UnitOfMeasurement
from app.masters.warehouses.models import Warehouse
from app.suppliers.models import Supplier, SupplierEmail


async def resolve_supplier(db: AsyncSession, name: str, supplier_id):
    """The supplier must exist in the Supplier master (no free-typed suppliers).

    Only the id and name are needed, so just those columns are read (a full Supplier entity would also
    load its emails, contacts and category links).
    Supports exact match, prefix match (e.g. 'Yinglima' -> 'Yinglima Packaging Machinery Co., Ltd.'),
    and substring match for convenience.
    """
    clean_name = (name or "").strip()
    if supplier_id:
        stmt = select(Supplier.id, Supplier.company_name).where(Supplier.deleted_at.is_(None), Supplier.id == supplier_id)
        supplier = (await db.execute(stmt)).first()
        if supplier:
            return supplier

    if not clean_name:
        raise BadRequestException("Supplier name is required.")

    # 1. Exact match (case-insensitive)
    stmt = select(Supplier.id, Supplier.company_name).where(
        Supplier.deleted_at.is_(None),
        func.lower(Supplier.company_name) == clean_name.lower(),
    )
    supplier = (await db.execute(stmt)).first()
    if supplier:
        return supplier

    # 2. Prefix match (e.g. 'Yinglima' -> 'Yinglima Packaging Machinery Co., Ltd.')
    stmt = select(Supplier.id, Supplier.company_name).where(
        Supplier.deleted_at.is_(None),
        Supplier.company_name.ilike(f"{clean_name}%"),
    )
    supplier = (await db.execute(stmt)).first()
    if supplier:
        return supplier

    # 3. Substring match
    stmt = select(Supplier.id, Supplier.company_name).where(
        Supplier.deleted_at.is_(None),
        Supplier.company_name.ilike(f"%{clean_name}%"),
    )
    supplier = (await db.execute(stmt)).first()
    if supplier:
        return supplier

    raise BadRequestException(f"Supplier '{name}' is not in the Supplier master.")



async def require_physical_warehouse(db: AsyncSession, name: str):
    warehouse = await stock_service.get_warehouse(db, name)
    if not stock_service.is_physical(warehouse):
        raise BadRequestException("Local purchases can only be received into a physical warehouse.")
    return warehouse


async def product_defaults(db: AsyncSession, product_name: str) -> dict:
    """Facts about a product from the Product Master (also proves the product exists)."""
    product = await stock_service.find_product(db, product_name)
    duty = None
    if product.hsn_id:
        duty = (await db.execute(select(Tax.import_duty_percent).where(Tax.id == product.hsn_id))).scalar()
    uom = (await db.execute(select(func.coalesce(UnitOfMeasurement.short_name, UnitOfMeasurement.name)).where(UnitOfMeasurement.id == product.uom_id))).scalar()
    return {
        "name": product.product_name,
        "code": product.product_code,
        "uom": uom,
        "duty_percent": float(duty) if duty is not None else 0.0,
        "pkg_unit_cbm": float(product.packaging_unit_cbm or 0.0),
        "pkg_qty": float(product.packaging_quantity or 0.0),
    }


def by_product(items: Iterable[tuple[str, float]]) -> dict[str, float]:
    """Sum quantities per product (case-insensitive) so a product listed twice moves stock once."""
    totals: dict[str, float] = defaultdict(float)
    names: dict[str, str] = {}
    for name, qty in items:
        key = name.strip().lower()
        names.setdefault(key, name.strip())
        totals[key] += qty
    return {names[k]: v for k, v in totals.items()}


async def move_stock(db: AsyncSession, warehouse: str, items: Iterable[tuple[str, float]], sign: int) -> None:
    for name, qty in by_product(items).items():
        await stock_service.apply_stock_delta(db, product_name=name, warehouse_name=warehouse, delta=sign * qty)


def check_future(label: str, value: date | None, previous: date | None, today: date) -> None:
    """Spec: ETD / ETA / expected-arrival dates may not be in the past (an unchanged saved value is left alone)."""
    if value and value != previous and value < today:
        raise BadRequestException(f"{label} cannot be in the past.")


async def load_parties(db: AsyncSession, records: list) -> dict:
    """Real supplier and buyer details for printed documents, read from the masters (never invented).

    * supplier -> address, phone, GST and first email from the Supplier master
    * buyer ("To") -> the billing company of the purchase's warehouse
    """
    supplier_ids = {r.supplier_id for r in records if getattr(r, "supplier_id", None)}
    suppliers: dict = {}
    if supplier_ids:
        rows = (
            await db.execute(
                select(Supplier.id, Supplier.address, Supplier.town, Supplier.contact_calling_number, Supplier.tax_id_number,
                       City.name.label("city"), State.name.label("state"))
                .outerjoin(City, City.id == Supplier.city_id)
                .outerjoin(State, State.id == Supplier.state_id)
                .where(Supplier.id.in_(supplier_ids))
            )
        ).all()
        emails: dict = {}
        for sid, email in (await db.execute(select(SupplierEmail.supplier_id, SupplierEmail.email).where(SupplierEmail.supplier_id.in_(supplier_ids)))).all():
            emails.setdefault(sid, email)
        for r in rows:
            suppliers[r.id] = {
                "supplier_address": ", ".join(x for x in (r.address, r.town, r.city, r.state) if x),
                "supplier_phone": r.contact_calling_number or "",
                "supplier_gst": r.tax_id_number or "",
                "supplier_email": emails.get(r.id, ""),
            }

    buyers: dict = {}
    names = {r.warehouse for r in records}
    if names:
        rows = (
            await db.execute(
                select(Warehouse.name.label("warehouse"), BillingCompany.name.label("company"), BillingCompany.address,
                       BillingCompany.city, BillingCompany.zip_code, BillingCompany.email, BillingCompany.mobile, BillingCompany.gst_no)
                .outerjoin(BillingCompany, BillingCompany.name == Warehouse.billing_company)
                .where(Warehouse.name.in_(names))
            )
        ).all()
        for r in rows:
            buyers[r.warehouse] = {
                "to_name": r.company or "",
                "to_address": ", ".join(x for x in (r.address, r.city, r.zip_code) if x),
                "to_email": r.email or "",
                "to_phone": r.mobile or "",
                "to_gst": r.gst_no or "",
            }
    return {"suppliers": suppliers, "buyers": buyers}


_BLANK_SUPPLIER = {"supplier_address": "", "supplier_phone": "", "supplier_gst": "", "supplier_email": ""}
_BLANK_BUYER = {"to_name": "", "to_address": "", "to_email": "", "to_phone": "", "to_gst": ""}


def party_fields(record, parties: dict) -> dict:
    return {
        **parties["suppliers"].get(getattr(record, "supplier_id", None), _BLANK_SUPPLIER),
        **parties["buyers"].get(record.warehouse, _BLANK_BUYER),
    }
