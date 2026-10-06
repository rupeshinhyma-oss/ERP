"""Stock movements for ``ProductStock``.

``ProductStock`` keeps one row per product with one numeric column per warehouse
(``mumbai``, ``mumbai_transit``, ``mumbai_ordered``, ...). This service is the single place that
changes those balances for purchases, so the rules are applied consistently:

* the warehouse name is resolved to its column from the *model's own columns* (nothing about
  specific branches is hardcoded here);
* the warehouse must exist in the Warehouse master;
* a **physical** warehouse (one with no main warehouse) can never go negative; transit and
  ordered warehouses may (Sales & PI spec);
* the product must exist in the Product Master, and its stock row is created on first use.

Callers run inside the request transaction, so an error rolls back every movement of the request.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import BadRequestException, ConflictException
from app.inventory.models import ProductStock
from app.masters.brands.models import Brand
from app.masters.product_categories.models import ProductCategory
from app.masters.product_sub_categories.models import ProductSubCategory
from app.masters.products.models import Product
from app.masters.taxes.models import Tax
from app.masters.uom.models import UnitOfMeasurement
from app.masters.warehouses.models import Warehouse

# every numeric column of ProductStock except the total is a warehouse balance
WAREHOUSE_COLUMNS: tuple[str, ...] = tuple(
    c.name
    for c in ProductStock.__table__.columns
    if c.type.__class__.__name__ == "Float" and c.name != "total_qty"
)


def warehouse_column(name: str) -> str:
    """Map a warehouse name (``"Mumbai Transit"``) to its stock column (``mumbai_transit``)."""
    slug = re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")
    if slug not in WAREHOUSE_COLUMNS:
        raise BadRequestException(
            f"Stock is not tracked for warehouse '{name}'. It needs a stock column before purchases can use it."
        )
    return slug


async def get_warehouse(db: AsyncSession, name: str) -> Warehouse:
    stmt = select(Warehouse).where(func.lower(Warehouse.name) == name.strip().lower(), Warehouse.deleted_at.is_(None))
    warehouse = (await db.execute(stmt)).scalars().first()
    if warehouse is None:
        raise BadRequestException(f"Warehouse '{name}' does not exist.")
    return warehouse


def is_physical(warehouse: Warehouse) -> bool:
    """Physical warehouses are the main ones; transit / ordered warehouses point at a main warehouse."""
    return warehouse.main_warehouse_id is None


async def find_product(db: AsyncSession, name: str) -> Product:
    lowered = name.strip().lower()
    stmt = select(Product).where(or_(func.lower(Product.product_name) == lowered, func.lower(Product.product_name_tally) == lowered))
    product = (await db.execute(stmt)).scalars().first()
    if product is None:
        raise BadRequestException(f"Product '{name}' is not in the Product Master.")
    return product


async def _ensure_stock_row(db: AsyncSession, product: Product) -> ProductStock:
    stmt = (
        select(ProductStock)
        .where(
            ProductStock.deleted_at.is_(None),
            or_(ProductStock.product_id == product.id, func.lower(ProductStock.product_name_tally) == product.product_name.lower()),
        )
        .with_for_update()
    )
    row = (await db.execute(stmt)).scalars().first()
    if row is not None:
        return row

    async def _scalar(stmt_):
        return (await db.execute(stmt_)).first()

    brand = await _scalar(select(Brand.name).where(Brand.id == product.brand_id)) if product.brand_id else None
    category = await _scalar(select(ProductCategory.name).where(ProductCategory.id == product.category_id))
    sub = await _scalar(select(ProductSubCategory.name).where(ProductSubCategory.id == product.sub_category_id)) if product.sub_category_id else None
    tax = await _scalar(select(Tax.hsn_number, Tax.gst_percent).where(Tax.id == product.hsn_id)) if product.hsn_id else None
    uom = await _scalar(select(func.coalesce(UnitOfMeasurement.short_name, UnitOfMeasurement.name)).where(UnitOfMeasurement.id == product.uom_id))
    next_sr = (await db.execute(select(func.coalesce(func.max(ProductStock.sr_no), 0) + 1))).scalar() or 1

    row = ProductStock(
        sr_no=next_sr,
        product_id=product.id,
        product_name_tally=product.product_name_tally or product.product_name,
        product_code=product.product_code or "-",
        brand=brand[0] if brand else "-",
        category=category[0] if category else None,
        sub_category=sub[0] if sub else None,
        hsn_code=tax[0] if tax else None,
        gst_rate=f"{float(tax[1]):g}%" if tax else None,
        uom=uom[0] if uom else "",
    )
    db.add(row)
    await db.flush()
    return row


@dataclass
class StockResult:
    product_name: str
    warehouse: str
    before: float
    after: float


async def apply_stock_delta(db: AsyncSession, *, product_name: str, warehouse_name: str, delta: float) -> StockResult:
    """Add (``delta`` > 0) or remove (``delta`` < 0) stock of a product in a warehouse."""
    warehouse = await get_warehouse(db, warehouse_name)
    column = warehouse_column(warehouse.name)
    product = await find_product(db, product_name)
    row = await _ensure_stock_row(db, product)

    before = float(getattr(row, column) or 0.0)
    after = round(before + delta, 6)
    if after < -1e-9 and is_physical(warehouse):
        raise ConflictException(
            f"Not enough stock of '{product.product_name}' in {warehouse.name} "
            f"(available {before:g}, needed {abs(delta):g}). Physical warehouses cannot go negative."
        )
    setattr(row, column, after)
    row.total_qty = round(sum(float(getattr(row, c) or 0.0) for c in WAREHOUSE_COLUMNS), 6)
    await db.flush()
    return StockResult(product.product_name, warehouse.name, before, after)
