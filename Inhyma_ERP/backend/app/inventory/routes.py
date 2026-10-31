"""
Inventory and Stock Adjustment Routes.

Provides RESTful endpoints for:
1. Product Stock: Warehouse-level physical inventory counts, valuations, filtering.
2. Stock Adjustments: Stock IN / OUT reconciliations, client returns, transit damage, split assemblies.
3. Official Stock Adjustment PDF Generation & Downloads.
"""

from __future__ import annotations

import datetime
import uuid
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import Response
from sqlalchemy import Integer, and_, case, cast, func, or_, select, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth.dependencies import get_current_user
from app.auth.service import CurrentUser
from app.core.constants import RecordStatus
from app.core.logging import get_logger
from app.inventory import stock_service
from app.rbac.dependencies import require_permission
from app.core.responses import build_success_response
from app.database.session import get_db_session
from app.inventory.models import (
    ProductStock,
    StockAdjustment,
    StockAdjustmentLineItem,
    StockTransfer,
    StockTransferLineItem,
)
from app.inventory.schemas import (
    ProductReorderItemRead,
    ProductReorderUpdateSchema,
    ProductStockItemRead,
    StockAdjustmentCreate,
    StockAdjustmentLineItemSchema,
    StockAdjustmentRead,
    StockTransferCreate,
    StockTransferLineItemSchema,
    StockTransferRead,
    StockTransferTabCounts,
    StockTransferUpdateStatus,
)

router = APIRouter(
    tags=["Inventory & Stock Management"],
    dependencies=[Depends(require_permission("product.view"))],  # was open to everyone, even without a login
)
logger = get_logger(__name__)

# ==============================================================================
# Shared helpers
# ==============================================================================

# Sale orders that still hold a booking against a physical warehouse (stock taken, goods not yet dispatched).
OPEN_SALE_ORDER_STATUSES = ("pending", "sales_confirmed", "admin_approved", "acc_confirmed", "gatepass_created")
# Import purchases whose goods are still on the way (spec: "Include status pending and confirm").
ACTIVE_PURCHASE_STATUSES = ("pending", "confirmed")
_NEGATIVE_CHECK_COLUMNS = stock_service.WAREHOUSE_COLUMNS


def _escape_like(text_value: str) -> str:
    """Escape LIKE wildcards so a typed ``%`` or ``_`` is searched literally."""
    return text_value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _text(value: Any) -> str:
    """A query parameter as clean text. Called directly (not through HTTP) an omitted optional parameter is a FastAPI
    ``Query`` object, not ``None`` -- anything that is not a string counts as "not given"."""
    return value.strip() if isinstance(value, str) else ""


def _contains(column, term: str):
    return column.ilike(f"%{_escape_like(_text(term))}%", escape="\\")


def _parse_ddmmyyyy(value: str) -> datetime.date:
    """Adjustment dates arrive as DD-MM-YYYY (or ISO YYYY-MM-DD)."""
    text_value = _text(value)
    for fmt in ("%d-%m-%Y", "%Y-%m-%d", "%d/%m/%Y"):
        try:
            return datetime.datetime.strptime(text_value[:10], fmt).date()
        except ValueError:
            continue
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Invalid adjustment date '{value}'. Use DD-MM-YYYY.")


def _parse_date_range(value: Optional[str]) -> tuple[Optional[datetime.date], Optional[datetime.date]]:
    """'MM/DD/YYYY - MM/DD/YYYY' (the date-range picker format) -> (start, end)."""
    value = _text(value)
    if not value or "-" not in value:
        return None, None
    parts = [p.strip() for p in value.split(" - ")] if " - " in value else [p.strip() for p in value.split("-", 1)]
    if len(parts) != 2:
        return None, None
    out = []
    for part in parts:
        try:
            out.append(datetime.datetime.strptime(part, "%m/%d/%Y").date())
        except ValueError:
            return None, None
    return out[0], out[1]


def _stock_item(r: ProductStock) -> dict:
    return {
        "id": str(r.id),
        "sr_no": r.sr_no,
        "product_id": str(r.product_id) if r.product_id else None,
        "product_name_tally": r.product_name_tally,
        "product_name": r.product_name_tally,
        "product_code": r.product_code or "-",
        "brand": r.brand or "-",
        "category": r.category,
        "sub_category": r.sub_category,
        "hsn_code": r.hsn_code,
        "gst_rate": r.gst_rate,
        "mumbai": r.mumbai,
        "mumbai_transit": r.mumbai_transit,
        "mumbai_ordered": r.mumbai_ordered,
        "ahmedabad": r.ahmedabad,
        "ahmedabad_transit": r.ahmedabad_transit,
        "ahmedabad_ordered": r.ahmedabad_ordered,
        "indore": r.indore,
        "indore_transit": r.indore_transit,
        "indore_ordered": r.indore_ordered,
        "total_qty": r.total_qty,
        "uom": r.uom,
        "description": r.description,
        "orders_info": r.orders_info or [],
        "status": r.status,
        "quantity_on_hand": r.total_qty,
        "quantity_available": r.total_qty,
    }


def _adjustment_record(r: StockAdjustment) -> dict:
    return {
        "id": str(r.id),
        "adjustment_no": r.adjustment_no,
        "adjustment_date": r.adjustment_date,
        "client_name": r.client_name,
        "invoice_no": r.invoice_no,
        "warehouse": r.warehouse,
        "type": r.type,
        "purpose": r.purpose,
        "total_amount": r.total_amount,
        "created_by": r.created_by,
        "created_at": r.created_at.strftime("%d-%m-%Y") if hasattr(r.created_at, "strftime") else str(r.created_at),
        "remarks": r.remarks,
        "items": [
            {
                "product_name": li.product_name,
                "product_code": li.product_code,
                "category": li.category,
                "hsn_code": li.hsn_code,
                "gst_rate": li.gst_rate,
                "qty": li.quantity,
                "quantity": li.quantity,
                "uom": li.uom,
                "rate": li.rate,
                "amount": li.amount,
            }
            for li in r.items
        ],
    }


async def _next_adjustment_no(db: AsyncSession) -> str:
    """Next adjustment number (numbering starts at 493). Serialised on PostgreSQL so two users cannot get the same one."""
    if db.bind is not None and db.bind.dialect.name == "postgresql":
        await db.execute(text("SELECT pg_advisory_xact_lock(hashtext('stock_adjustment_no'))"))
        highest = (
            await db.execute(
                select(func.max(cast(StockAdjustment.adjustment_no, Integer))).where(StockAdjustment.adjustment_no.op("~")("^[0-9]+$"))
            )
        ).scalar()
    else:
        numbers = [int(n) for (n,) in (await db.execute(select(StockAdjustment.adjustment_no))).all() if n and str(n).isdigit()]
        highest = max(numbers) if numbers else None
    return str(max((highest or 0) + 1, 493))



# ==============================================================================
# Product Stock Endpoints
# ==============================================================================

@router.get("/inventory/product-stock", summary="List product stock across warehouses")
@router.get("/product-stock/list", summary="Alias for product stock list")
@router.get("/transaction_report/list", summary="Alias for Stock Transactions report")
@router.get("/transaction-report/list", summary="Alias for Stock Transactions report")
async def list_product_stock(
    request: Request,
    category: Optional[str] = Query(None, description="Category filter"),
    sub_category: Optional[str] = Query(None, description="Sub-category filter"),
    brand: Optional[str] = Query(None, description="Brand filter"),
    negative_stock: Optional[str] = Query(None, description="Negative stock filter ('Yes', 'No', 'Select')"),
    status_filter: Optional[str] = Query(None, alias="status", description="Status filter"),
    search: Optional[str] = Query(None, description="Search term"),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=5000),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    """Paginated product stock straight from the database -- never sample data.

    Joins Product -> ProductStock + ProductCategory + ProductSubCategory + Brand + UnitOfMeasurement + Tax so every
    active product in the master catalog appears with its real classification, warehouse balances (0 when no movement
    has occurred yet), live (i) breakup flags, and master dropdown options.
    """
    from app.masters.brands.models import Brand
    from app.masters.product_categories.models import ProductCategory
    from app.masters.product_sub_categories.models import ProductSubCategory
    from app.masters.products.models import Product
    from app.masters.taxes.models import Tax
    from app.masters.uom.models import UnitOfMeasurement

    ps = ProductStock
    name_expr = func.coalesce(ps.product_name_tally, Product.product_name_tally, Product.product_name)
    code_expr = func.coalesce(func.nullif(Product.product_code, "-"), func.nullif(ps.product_code, "-"), "-")
    brand_expr = func.coalesce(func.nullif(func.nullif(ps.brand, "-"), ""), Brand.name, "-")
    category_expr = func.coalesce(func.nullif(func.nullif(ps.category, "-"), ""), ProductCategory.name)
    sub_category_expr = func.coalesce(func.nullif(func.nullif(ps.sub_category, "-"), ""), ProductSubCategory.name)
    uom_expr = func.coalesce(UnitOfMeasurement.short_name, UnitOfMeasurement.name, func.nullif(ps.uom, ""), "SET")
    hsn_expr = func.coalesce(Tax.hsn_number, ps.hsn_code)
    status_expr = func.coalesce(ps.status, "In Stock")
    total_qty_expr = func.coalesce(ps.total_qty, 0.0)

    stmt = (
        select(
            ps.id.label("stock_id"),
            Product.id.label("prod_id"),
            ps.sr_no.label("sr_no"),
            name_expr.label("name"),
            Product.product_name_invoice.label("name_invoice"),
            code_expr.label("code"),
            brand_expr.label("brand"),
            category_expr.label("category"),
            sub_category_expr.label("sub_category"),
            uom_expr.label("uom"),
            hsn_expr.label("hsn_code"),
            Tax.gst_percent.label("gst_percent"),
            ps.gst_rate.label("ps_gst_rate"),
            Product.minimum_price.label("minimum_price"),
            Product.packaging_quantity.label("packaging_quantity"),
            Product.packaging_net_weight.label("packaging_net_weight"),
            Product.packaging_gross_weight.label("packaging_gross_weight"),
            func.coalesce(Product.length_cm, Product.length).label("length_cm"),
            func.coalesce(Product.width_cm, Product.width).label("width_cm"),
            func.coalesce(Product.height_cm, Product.height).label("height_cm"),
            Product.packaging_unit_cbm.label("packaging_unit_cbm"),
            Product.specification.label("specification"),
            func.coalesce(Product.description, ps.description).label("description"),
            ps.orders_info.label("orders_info"),
            status_expr.label("status"),
            func.coalesce(ps.mumbai, 0.0).label("mumbai"),
            func.coalesce(ps.mumbai_transit, 0.0).label("mumbai_transit"),
            func.coalesce(ps.mumbai_ordered, 0.0).label("mumbai_ordered"),
            func.coalesce(ps.ahmedabad, 0.0).label("ahmedabad"),
            func.coalesce(ps.ahmedabad_transit, 0.0).label("ahmedabad_transit"),
            func.coalesce(ps.ahmedabad_ordered, 0.0).label("ahmedabad_ordered"),
            func.coalesce(ps.indore, 0.0).label("indore"),
            func.coalesce(ps.indore_transit, 0.0).label("indore_transit"),
            func.coalesce(ps.indore_ordered, 0.0).label("indore_ordered"),
            total_qty_expr.label("total_qty"),
        )
        .select_from(Product)
        .outerjoin(ps, and_(ps.product_id == Product.id, ps.deleted_at.is_(None)))
        .outerjoin(ProductCategory, and_(ProductCategory.id == Product.category_id, ProductCategory.deleted_at.is_(None)))
        .outerjoin(ProductSubCategory, and_(ProductSubCategory.id == Product.sub_category_id, ProductSubCategory.deleted_at.is_(None)))
        .outerjoin(Brand, and_(Brand.id == Product.brand_id, Brand.deleted_at.is_(None)))
        .outerjoin(UnitOfMeasurement, and_(UnitOfMeasurement.id == Product.uom_id, UnitOfMeasurement.deleted_at.is_(None)))
        .outerjoin(Tax, and_(Tax.id == Product.hsn_id, Tax.deleted_at.is_(None)))
        .where(Product.deleted_at.is_(None), Product.status == RecordStatus.ACTIVE)
    )

    for column_expr, value in ((category_expr, category), (sub_category_expr, sub_category), (brand_expr, brand)):
        wanted = _text(value)
        if wanted and wanted.lower() not in ("all", "select"):
            stmt = stmt.where(column_expr == wanted)

    flag = _text(negative_stock).lower()
    if flag == "yes":
        stmt = stmt.where(or_(*(func.coalesce(getattr(ps, c), 0.0) < 0 for c in _NEGATIVE_CHECK_COLUMNS)))
    elif flag == "no":
        stmt = stmt.where(and_(*(func.coalesce(getattr(ps, c), 0.0) >= 0 for c in _NEGATIVE_CHECK_COLUMNS)))

    wanted_status = _text(status_filter)
    if wanted_status and wanted_status.lower() not in ("all", "select"):
        stmt = stmt.where(status_expr == wanted_status)
    if _text(search):
        stmt = stmt.where(
            or_(
                _contains(name_expr, search),
                _contains(code_expr, search),
                _contains(brand_expr, search),
                _contains(sub_category_expr, search),
                _contains(category_expr, search),
            )
        )

    total = (await db.execute(select(func.count()).select_from(stmt.order_by(None).subquery()))).scalar() or 0
    rows = (
        await db.execute(
            stmt.order_by(ps.sr_no.asc().nulls_last(), Product.product_name_tally.asc(), Product.id).offset(skip).limit(limit)
        )
    ).all()

    breakup_map = await _compute_breakup_flags(db, [r.name for r in rows if r.name])

    cat_names = [
        c for (c,) in (await db.execute(select(ProductCategory.name).where(ProductCategory.deleted_at.is_(None), ProductCategory.status == RecordStatus.ACTIVE).order_by(ProductCategory.name))).all() if c
    ]
    sub_rows = (
        await db.execute(
            select(ProductSubCategory.name, ProductCategory.name)
            .outerjoin(ProductCategory, ProductCategory.id == ProductSubCategory.category_id)
            .where(ProductSubCategory.deleted_at.is_(None), ProductSubCategory.status == RecordStatus.ACTIVE)
            .order_by(ProductSubCategory.name)
        )
    ).all()
    brand_names = [
        b for (b,) in (await db.execute(select(Brand.name).where(Brand.deleted_at.is_(None), Brand.status == RecordStatus.ACTIVE).order_by(Brand.name))).all() if b
    ]

    items = []
    for idx, r in enumerate(rows, start=skip + 1):
        if r.gst_percent is not None:
            gst_val = float(r.gst_percent)
            gst_str = f"{int(gst_val)}%" if gst_val.is_integer() else f"{gst_val:g}%"
        else:
            gst_str = r.ps_gst_rate or "18%"
        clean_orders_info = [
            e for e in (r.orders_info or [])
            if not (isinstance(e, dict) and e.get("_type") == "wh_reorder")
        ]
        name_key = (r.name or "").strip().lower()
        t_qty = float(r.total_qty or 0.0)
        items.append({
            "id": str(r.stock_id or r.prod_id),
            "sr_no": r.sr_no if r.sr_no is not None else idx,
            "product_id": str(r.prod_id) if r.prod_id else None,
            "product_name_tally": r.name,
            "product_name": r.name,
            "product_name_invoice": r.name_invoice,
            "product_code": r.code or "-",
            "brand": r.brand or "-",
            "category": r.category,
            "sub_category": r.sub_category or "-",
            "hsn_code": r.hsn_code,
            "gst_rate": gst_str,
            "mumbai": float(r.mumbai),
            "mumbai_transit": float(r.mumbai_transit),
            "mumbai_ordered": float(r.mumbai_ordered),
            "ahmedabad": float(r.ahmedabad),
            "ahmedabad_transit": float(r.ahmedabad_transit),
            "ahmedabad_ordered": float(r.ahmedabad_ordered),
            "indore": float(r.indore),
            "indore_transit": float(r.indore_transit),
            "indore_ordered": float(r.indore_ordered),
            "total_qty": t_qty,
            "uom": r.uom or "SET",
            "minimum_price": float(r.minimum_price) if r.minimum_price is not None else None,
            "packaging_quantity": float(r.packaging_quantity) if r.packaging_quantity is not None else None,
            "packaging_net_weight": float(r.packaging_net_weight) if r.packaging_net_weight is not None else None,
            "packaging_gross_weight": float(r.packaging_gross_weight) if r.packaging_gross_weight is not None else None,
            "length_cm": float(r.length_cm) if r.length_cm is not None else None,
            "width_cm": float(r.width_cm) if r.width_cm is not None else None,
            "height_cm": float(r.height_cm) if r.height_cm is not None else None,
            "packaging_unit_cbm": float(r.packaging_unit_cbm) if r.packaging_unit_cbm is not None else None,
            "specification": r.specification,
            "description": r.description,
            "orders_info": clean_orders_info,
            "status": r.status or "In Stock",
            "quantity_on_hand": t_qty,
            "quantity_available": t_qty,
            "breakup_flags": breakup_map.get(name_key, []),
        })

    return build_success_response(
        data={
            "items": items,
            "total": total,
            "skip": skip,
            "limit": limit,
            "filter_options": {
                "categories": cat_names,
                "sub_categories": [{"name": s_name, "category": c_name} for s_name, c_name in sub_rows if s_name],
                "brands": brand_names,
            },
        },
        request_id=getattr(request.state, "request_id", "-") if request and hasattr(request, "state") else "-",
    )


# ==============================================================================
# Product Re-Order Endpoints
# ==============================================================================

_SO_STATUS_LABELS: dict[str, str] = {
    "pending": "Pending",
    "sales_confirmed": "Sales Confirmed",
    "admin_approved": "Admin Approved",
    "acc_confirmed": "Acc. Confirmed",
    "gatepass_created": "Gatepass Created",
    "dispatched": "Dispatched",
    "gatepass_cancelled": "Gatepass Cancelled",
    "lr": "LR",
    "cancelled": "Cancelled",
}


def _format_so_status(raw_status: Optional[str]) -> str:
    key = (raw_status or "pending").strip().lower()
    return _SO_STATUS_LABELS.get(key, key.replace("_", " ").title())


def _extract_warehouse_thresholds(orders_info: Any) -> dict[str, dict[str, float]]:
    """Extract per-branch Re-Order & MOQ overrides stored inside ProductStock.orders_info."""
    out: dict[str, dict[str, float]] = {}
    if not isinstance(orders_info, list):
        return out
    for entry in orders_info:
        if isinstance(entry, dict) and entry.get("_type") == "wh_reorder":
            wh = str(entry.get("warehouse") or "").strip().lower()
            if wh in ("mumbai", "ahmedabad", "indore"):
                out[wh] = {
                    "reorder_level": float(entry.get("reorder_level") or 0.0),
                    "moq": float(entry.get("moq") or 0.0),
                }
    return out


async def _compute_breakup_flags(db: AsyncSession, product_names: list[str]) -> dict[str, list[str]]:
    """Return {lower_product_name: sorted list of column keys} that have live breakup rows.

    Covers:
    1. Open SaleOrders (OPEN_SALE_ORDER_STATUSES) booked against physical, transit, or ordered warehouses.
    2. Active ImportPurchases (ACTIVE_PURCHASE_STATUSES) in '<City> Transit' or '<City> Ordered'.
    3. Active in-transit StockTransfers ('pending' / 'confirmed') moving into '<City>' / '<City> Transit'.
    """
    lowered_names = sorted({n.strip().lower() for n in product_names if n and n.strip()})
    if not lowered_names:
        return {}

    from app.purchase.models import ImportPurchase, ImportPurchaseItem
    from app.sales.models import SaleOrder, SaleOrderItem

    flags: dict[str, set[str]] = {}

    def _add_flag(prod_lower: str, raw_wh: Optional[str], *, force_transit: bool = False) -> None:
        w = (raw_wh or "").strip().lower()
        if not w:
            return
        for city in ("mumbai", "ahmedabad", "indore"):
            if w == city:
                flags.setdefault(prod_lower, set()).add(f"{city}_transit" if force_transit else city)
                return
            if w == f"{city} transit":
                flags.setdefault(prod_lower, set()).add(f"{city}_transit")
                return
            if w == f"{city} ordered":
                flags.setdefault(prod_lower, set()).add(f"{city}_ordered")
                return

    from sqlalchemy.exc import OperationalError

    # 1. Open Sale Orders
    try:
        async with db.begin_nested():
            so_rows = (
                await db.execute(
                    select(func.lower(SaleOrderItem.product_name), SaleOrder.warehouse)
                    .join(SaleOrder, SaleOrder.id == SaleOrderItem.order_id)
                    .where(
                        SaleOrder.deleted_at.is_(None),
                        SaleOrder.status.in_(OPEN_SALE_ORDER_STATUSES),
                        func.lower(SaleOrderItem.product_name).in_(lowered_names),
                    )
                    .distinct()
                )
            ).all()
        for p_low, wh in so_rows:
            if p_low:
                _add_flag(p_low, wh)
    except OperationalError:
        pass

    # 2. Active Import Purchases (Transit / Ordered)
    try:
        async with db.begin_nested():
            ip_rows = (
                await db.execute(
                    select(func.lower(ImportPurchaseItem.product_name), ImportPurchase.warehouse)
                    .join(ImportPurchase, ImportPurchase.id == ImportPurchaseItem.purchase_id)
                    .where(
                        ImportPurchase.deleted_at.is_(None),
                        ImportPurchase.status.in_(ACTIVE_PURCHASE_STATUSES),
                        func.lower(ImportPurchaseItem.product_name).in_(lowered_names),
                    )
                    .distinct()
                )
            ).all()
        for p_low, wh in ip_rows:
            if p_low and wh and ("transit" in wh.lower() or "ordered" in wh.lower()):
                _add_flag(p_low, wh)
    except OperationalError:
        pass

    # 3. Active In-Transit Stock Transfers (Point 69)
    try:
        async with db.begin_nested():
            st_rows = (
                await db.execute(
                    select(func.lower(StockTransferLineItem.product_name), StockTransfer.to_warehouse)
                    .join(StockTransfer, StockTransfer.id == StockTransferLineItem.transfer_id)
                    .where(
                        StockTransfer.deleted_at.is_(None),
                        func.lower(StockTransfer.status).in_(("pending", "confirmed", "in transit", "in_transit")),
                        func.lower(StockTransferLineItem.product_name).in_(lowered_names),
                    )
                    .distinct()
                )
            ).all()
        for p_low, to_wh in st_rows:
            if p_low and to_wh:
                _, city, _ = _parse_wh_column(to_wh, prefer_transit=True)
                flags.setdefault(p_low, set()).add(f"{city}_transit")
    except OperationalError:
        pass

    return {k: sorted(v) for k, v in flags.items()}


@router.get("/inventory/product-reorder", summary="List product re-order table records")
@router.get("/product-reorder/list", summary="Alias for product re-order table records")
async def list_product_reorder(
    request: Request,
    category: Optional[str] = Query(None, description="Category filter"),
    sub_category: Optional[str] = Query(None, description="Sub-category filter"),
    brand: Optional[str] = Query(None, description="Brand filter"),
    shortfall: Optional[str] = Query(None, description="Short fall filter: 'All' | '0' | 'Greater Than 0'"),
    reorder: Optional[str] = Query(None, description="Re-order filter: 'All' | '0' | 'Greater Than 0'"),
    warehouse: Optional[str] = Query(None, description="Warehouse scope: 'Mumbai' | 'Ahmedabad' | 'Indore' | 'All'"),
    search: Optional[str] = Query(None, description="Search keyword"),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=5000),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    """Re-order table: every product with its master classification, warehouse pipeline stock, shortfall, and order qty.

    Joins Product -> ProductStock + ProductCategory + ProductSubCategory + Brand + UnitOfMeasurement + Tax so all
    products (even those without stock movement rows yet) have accurate Category, Sub-Category, Brand, HSN, UOM, and
    Product Master specifications. Supports warehouse-scoped shortfall evaluation ('Mumbai', 'Ahmedabad', 'Indore')
    as well as global ('All' / omitted).
    """
    from app.masters.brands.models import Brand
    from app.masters.product_categories.models import ProductCategory
    from app.masters.product_sub_categories.models import ProductSubCategory
    from app.masters.products.models import Product
    from app.masters.taxes.models import Tax
    from app.masters.uom.models import UnitOfMeasurement

    ps = ProductStock
    total_qty = func.coalesce(ps.total_qty, 0.0)
    level = case(
        (func.coalesce(ps.reorder_level, 0.0) > 0, ps.reorder_level),
        else_=func.coalesce(Product.reorder_level, 0.0),
    )
    moq = case(
        (func.coalesce(ps.minimum_order_quantity, 0.0) > 0, ps.minimum_order_quantity),
        else_=func.coalesce(Product.minimum_order_quantity, 0.0),
    )

    wh_scope = _text(warehouse).lower()
    is_branch_scope = wh_scope in ("mumbai", "ahmedabad", "indore")
    if is_branch_scope:
        eval_qty = (
            func.coalesce(getattr(ps, wh_scope), 0.0)
            + func.coalesce(getattr(ps, f"{wh_scope}_transit"), 0.0)
            + func.coalesce(getattr(ps, f"{wh_scope}_ordered"), 0.0)
        )
    else:
        eval_qty = total_qty

    short_fall = case((level > eval_qty, level - eval_qty), else_=0.0)

    name_expr = func.coalesce(ps.product_name_tally, Product.product_name_tally, Product.product_name)
    code_expr = func.coalesce(func.nullif(Product.product_code, "-"), func.nullif(ps.product_code, "-"), "-")
    brand_expr = func.coalesce(Brand.name, func.nullif(ps.brand, "-"), "-")
    category_expr = func.coalesce(ProductCategory.name, func.nullif(ps.category, "-"), "-")
    sub_category_expr = func.coalesce(ProductSubCategory.name, func.nullif(ps.sub_category, "-"), "-")
    uom_expr = func.coalesce(UnitOfMeasurement.short_name, UnitOfMeasurement.name, func.nullif(ps.uom, ""), "SET")
    hsn_expr = func.coalesce(Tax.hsn_number, ps.hsn_code)

    stmt = (
        select(
            ps.id.label("stock_id"),
            Product.id.label("prod_id"),
            ps.sr_no.label("sr_no"),
            name_expr.label("name"),
            Product.product_name_invoice.label("name_invoice"),
            code_expr.label("code"),
            brand_expr.label("brand"),
            category_expr.label("category"),
            sub_category_expr.label("sub_category"),
            uom_expr.label("uom"),
            hsn_expr.label("hsn_code"),
            Tax.gst_percent.label("gst_percent"),
            Tax.import_duty_percent.label("import_duty_percent"),
            Product.minimum_price.label("minimum_price"),
            Product.packaging_quantity.label("packaging_quantity"),
            Product.packaging_net_weight.label("packaging_net_weight"),
            Product.packaging_gross_weight.label("packaging_gross_weight"),
            func.coalesce(Product.length_cm, Product.length).label("length_cm"),
            func.coalesce(Product.width_cm, Product.width).label("width_cm"),
            func.coalesce(Product.height_cm, Product.height).label("height_cm"),
            Product.packaging_unit_cbm.label("packaging_unit_cbm"),
            Product.specification.label("specification"),
            func.coalesce(Product.description, ps.description).label("description"),
            ps.orders_info.label("orders_info"),
            func.coalesce(ps.mumbai, 0.0).label("mumbai"),
            func.coalesce(ps.mumbai_transit, 0.0).label("mumbai_transit"),
            func.coalesce(ps.mumbai_ordered, 0.0).label("mumbai_ordered"),
            func.coalesce(ps.ahmedabad, 0.0).label("ahmedabad"),
            func.coalesce(ps.ahmedabad_transit, 0.0).label("ahmedabad_transit"),
            func.coalesce(ps.ahmedabad_ordered, 0.0).label("ahmedabad_ordered"),
            func.coalesce(ps.indore, 0.0).label("indore"),
            func.coalesce(ps.indore_transit, 0.0).label("indore_transit"),
            func.coalesce(ps.indore_ordered, 0.0).label("indore_ordered"),
            total_qty.label("total_qty"),
            level.label("reorder_level"),
            moq.label("moq"),
            short_fall.label("short_fall"),
        )
        .select_from(Product)
        .outerjoin(ps, and_(ps.product_id == Product.id, ps.deleted_at.is_(None)))
        .outerjoin(ProductCategory, and_(ProductCategory.id == Product.category_id, ProductCategory.deleted_at.is_(None)))
        .outerjoin(ProductSubCategory, and_(ProductSubCategory.id == Product.sub_category_id, ProductSubCategory.deleted_at.is_(None)))
        .outerjoin(Brand, and_(Brand.id == Product.brand_id, Brand.deleted_at.is_(None)))
        .outerjoin(UnitOfMeasurement, and_(UnitOfMeasurement.id == Product.uom_id, UnitOfMeasurement.deleted_at.is_(None)))
        .outerjoin(Tax, and_(Tax.id == Product.hsn_id, Tax.deleted_at.is_(None)))
        .where(Product.deleted_at.is_(None), Product.status == RecordStatus.ACTIVE)
    )

    for column_expr, value in ((category_expr, category), (sub_category_expr, sub_category), (brand_expr, brand)):
        wanted = _text(value)
        if wanted and wanted.lower() not in ("all", "select"):
            stmt = stmt.where(column_expr == wanted)

    if _text(search):
        stmt = stmt.where(
            or_(
                _contains(name_expr, search),
                _contains(code_expr, search),
                _contains(brand_expr, search),
                _contains(sub_category_expr, search),
                _contains(category_expr, search),
            )
        )

    sf = _text(shortfall).lower()
    ro = _text(reorder).lower()

    if not is_branch_scope:
        if sf == "0":
            stmt = stmt.where(short_fall == 0)
        elif sf in ("greater than 0", ">0", "gt0"):
            stmt = stmt.where(short_fall > 0)
        if ro == "0":
            stmt = stmt.where(level == 0)
        elif ro in ("greater than 0", ">0", "gt0"):
            stmt = stmt.where(level > 0)

        total = (await db.execute(select(func.count()).select_from(stmt.order_by(None).subquery()))).scalar() or 0
        rows = (
            await db.execute(
                stmt.order_by(short_fall.desc(), Product.product_name_tally, Product.id).offset(skip).limit(limit)
            )
        ).all()
        resolved_rows = []
        for r in rows:
            wh_thresholds = _extract_warehouse_thresholds(r.orders_info)
            eff_level = float(r.reorder_level or 0.0)
            eff_moq = float(r.moq or 0.0)
            if eff_level == 0.0 and wh_thresholds:
                eff_level = sum(v["reorder_level"] for v in wh_thresholds.values())
                if eff_moq == 0.0:
                    eff_moq = max((v["moq"] for v in wh_thresholds.values()), default=0.0)
            eff_sf = max(0.0, eff_level - float(r.total_qty or 0.0))
            resolved_rows.append((r, wh_thresholds, eff_level, eff_moq, eff_sf))
    else:
        all_rows = (await db.execute(stmt.order_by(Product.product_name_tally, Product.id))).all()
        computed = []
        for r in all_rows:
            wh_thresholds = _extract_warehouse_thresholds(r.orders_info)
            if wh_scope in wh_thresholds:
                eff_level = wh_thresholds[wh_scope]["reorder_level"]
                eff_moq = wh_thresholds[wh_scope]["moq"]
            else:
                eff_level = float(r.reorder_level or 0.0)
                eff_moq = float(r.moq or 0.0)
            branch_qty = (
                float(getattr(r, wh_scope) or 0.0)
                + float(getattr(r, f"{wh_scope}_transit") or 0.0)
                + float(getattr(r, f"{wh_scope}_ordered") or 0.0)
            )
            eff_sf = max(0.0, eff_level - branch_qty)
            if sf == "0" and eff_sf != 0.0:
                continue
            if sf in ("greater than 0", ">0", "gt0") and eff_sf <= 0.0:
                continue
            if ro == "0" and eff_level != 0.0:
                continue
            if ro in ("greater than 0", ">0", "gt0") and eff_level <= 0.0:
                continue
            computed.append((r, wh_thresholds, eff_level, eff_moq, eff_sf))

        computed.sort(key=lambda tup: (-tup[4], (tup[0].name or "").lower(), str(tup[0].prod_id)))
        total = len(computed)
        resolved_rows = computed[skip : skip + limit]

    breakup_map = await _compute_breakup_flags(db, [r.name for (r, *_rest) in resolved_rows if r.name])

    # Master dropdown options so filters always expose all active Categories, Sub-Categories, and Brands
    cat_names = [
        c for (c,) in (await db.execute(select(ProductCategory.name).where(ProductCategory.deleted_at.is_(None), ProductCategory.status == RecordStatus.ACTIVE).order_by(ProductCategory.name))).all() if c
    ]
    sub_rows = (
        await db.execute(
            select(ProductSubCategory.name, ProductCategory.name)
            .outerjoin(ProductCategory, ProductCategory.id == ProductSubCategory.category_id)
            .where(ProductSubCategory.deleted_at.is_(None), ProductSubCategory.status == RecordStatus.ACTIVE)
            .order_by(ProductSubCategory.name)
        )
    ).all()
    brand_names = [
        b for (b,) in (await db.execute(select(Brand.name).where(Brand.deleted_at.is_(None), Brand.status == RecordStatus.ACTIVE).order_by(Brand.name))).all() if b
    ]

    items = []
    for idx, (r, wh_thresholds, eff_level, eff_moq, eff_sf) in enumerate(resolved_rows, start=skip + 1):
        order_to_place = (max(eff_sf, eff_moq) if eff_moq > 0 else eff_sf) if eff_sf > 0 else 0.0
        name_key = (r.name or "").strip().lower()
        items.append({
            "id": str(r.stock_id or r.prod_id),
            "sr_no": idx,
            "product_id": str(r.prod_id) if r.prod_id else None,
            "product_name_tally": r.name,
            "product_name_invoice": r.name_invoice,
            "product_code": r.code,
            "brand": r.brand,
            "category": r.category,
            "sub_category": r.sub_category,
            "uom": r.uom or "SET",
            "hsn_code": r.hsn_code,
            "gst_percent": float(r.gst_percent) if r.gst_percent is not None else None,
            "import_duty_percent": float(r.import_duty_percent) if r.import_duty_percent is not None else None,
            "minimum_price": float(r.minimum_price) if r.minimum_price is not None else None,
            "packaging_quantity": float(r.packaging_quantity) if r.packaging_quantity is not None else None,
            "packaging_net_weight": float(r.packaging_net_weight) if r.packaging_net_weight is not None else None,
            "packaging_gross_weight": float(r.packaging_gross_weight) if r.packaging_gross_weight is not None else None,
            "length_cm": float(r.length_cm) if r.length_cm is not None else None,
            "width_cm": float(r.width_cm) if r.width_cm is not None else None,
            "height_cm": float(r.height_cm) if r.height_cm is not None else None,
            "packaging_unit_cbm": float(r.packaging_unit_cbm) if r.packaging_unit_cbm is not None else None,
            "specification": r.specification,
            "description": r.description,
            "mumbai": float(r.mumbai),
            "mumbai_transit": float(r.mumbai_transit),
            "mumbai_ordered": float(r.mumbai_ordered),
            "ahmedabad": float(r.ahmedabad),
            "ahmedabad_transit": float(r.ahmedabad_transit),
            "ahmedabad_ordered": float(r.ahmedabad_ordered),
            "indore": float(r.indore),
            "indore_transit": float(r.indore_transit),
            "indore_ordered": float(r.indore_ordered),
            "total_qty": float(r.total_qty),
            "reorder_level": float(eff_level),
            "moq": float(eff_moq),
            "minimum_order_quantity": float(eff_moq),
            "short_fall": float(eff_sf),
            "order_to_be_place": float(order_to_place),
            "breakup_flags": breakup_map.get(name_key, []),
            "warehouse_thresholds": wh_thresholds,
        })
    return build_success_response(
        data={
            "items": items,
            "total": total,
            "skip": skip,
            "limit": limit,
            "warehouse": warehouse or "All",
            "filter_options": {
                "categories": cat_names,
                "sub_categories": [{"name": s_name, "category": c_name} for s_name, c_name in sub_rows if s_name],
                "brands": brand_names,
            },
        },
        request_id=getattr(request.state, "request_id", "-") if request and hasattr(request, "state") else "-",
    )


@router.patch("/inventory/product-reorder/{product_id}", summary="Update reorder level and MOQ for product")
async def update_product_reorder(
    product_id: str,
    payload: ProductReorderUpdateSchema,
    request: Request,
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    """Update reorder level and MOQ on the product and its stock row (global or branch-scoped). 404 when no such product exists."""
    from app.masters.products.models import Product

    for value in (payload.reorder_level, payload.minimum_order_quantity):
        if value is not None and value < 0:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Reorder level and MOQ cannot be negative.")
    clean_id = product_id.strip()
    product = None
    stock = None
    try:
        val_uuid = uuid.UUID(clean_id)
        product = (await db.execute(select(Product).where(Product.id == val_uuid))).scalars().first()
        stock = (await db.execute(select(ProductStock).where(ProductStock.id == val_uuid, ProductStock.deleted_at.is_(None)))).scalars().first()
    except ValueError:
        product = (await db.execute(select(Product).where(Product.product_code == clean_id))).scalars().first()
    if stock is None and product is not None:
        stock = (await db.execute(select(ProductStock).where(ProductStock.product_id == product.id, ProductStock.deleted_at.is_(None)))).scalars().first()
    if product is None and stock is not None and stock.product_id:
        product = (await db.execute(select(Product).where(Product.id == stock.product_id))).scalars().first()
    if product is None and stock is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")

    wh_scope = _text(payload.warehouse).lower()
    is_branch_scope = wh_scope in ("mumbai", "ahmedabad", "indore")

    if is_branch_scope and stock is None and product is not None:
        stock = await stock_service._ensure_stock_row(db, product)

    if is_branch_scope and stock is not None:
        existing_entries = [
            e for e in (stock.orders_info or [])
            if not (isinstance(e, dict) and e.get("_type") == "wh_reorder" and str(e.get("warehouse") or "").strip().lower() == wh_scope)
        ]
        prev_wh = _extract_warehouse_thresholds(stock.orders_info).get(wh_scope, {})
        next_level = float(payload.reorder_level if payload.reorder_level is not None else prev_wh.get("reorder_level", stock.reorder_level or 0.0))
        next_moq = float(payload.minimum_order_quantity if payload.minimum_order_quantity is not None else prev_wh.get("moq", stock.minimum_order_quantity or 0.0))
        existing_entries.append({
            "_type": "wh_reorder",
            "warehouse": wh_scope,
            "reorder_level": next_level,
            "moq": next_moq,
        })
        stock.orders_info = list(existing_entries)
        wh_thresholds = _extract_warehouse_thresholds(stock.orders_info)
    else:
        for target in (product, stock):
            if target is None:
                continue
            if payload.reorder_level is not None:
                target.reorder_level = payload.reorder_level
            if payload.minimum_order_quantity is not None:
                target.minimum_order_quantity = payload.minimum_order_quantity
        if stock is not None and isinstance(stock.orders_info, list):
            stock.orders_info = [
                e for e in stock.orders_info
                if not (isinstance(e, dict) and e.get("_type") == "wh_reorder")
            ]
        wh_thresholds = _extract_warehouse_thresholds(stock.orders_info if stock is not None else [])

    await db.flush()
    return build_success_response(
        data={
            "updated": True,
            "product_id": clean_id,
            "warehouse": payload.warehouse or "All",
            "reorder_level": payload.reorder_level,
            "moq": payload.minimum_order_quantity,
            "minimum_order_quantity": payload.minimum_order_quantity,
            "warehouse_thresholds": wh_thresholds,
        },
        request_id=getattr(request.state, "request_id", "-") if request and hasattr(request, "state") else "-",
    )


@router.get("/inventory/product-stock/breakup", summary="Get order / transit / physical stock breakup for product")
async def get_product_stock_breakup(
    product_name: str = Query(..., description="Product name"),
    warehouse: str = Query(..., description="City name e.g. Mumbai, Ahmedabad, Indore"),
    type: str = Query("physical", description="'physical' | 'transit' | 'ordered'"),
    request: Request = None,
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    """Rows for the (i) popup of one stock cell.

    * physical: the sale orders that still hold a booking on this product in that warehouse (stock taken, not yet
      dispatched) -- cancelled and dispatched orders are not stock any more;
    * transit / ordered: the import consignments (and active inter-branch stock transfers for transit) still on the way
      (pending / confirmed) into "<City> Transit" / "<City> Ordered", with FIFO deduction of any open SaleOrders booked
      directly against that transit/ordered warehouse.
    The product is matched by its exact name and the warehouse by its exact name (no substring matching).
    """
    from app.sales.models import SaleOrder, SaleOrderItem

    clean_p = product_name.strip()
    clean_w = warehouse.strip()
    stock_type = type.strip().lower()
    if stock_type not in ("physical", "transit", "ordered"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="type must be physical, transit or ordered")
    all_warehouses = clean_w.lower() == "all"
    items: list[dict] = []
    booked_orders: list[dict] = []

    if stock_type == "physical":
        stmt = (
            select(SaleOrder, SaleOrderItem)
            .join(SaleOrderItem, SaleOrderItem.order_id == SaleOrder.id)
            .where(
                SaleOrder.deleted_at.is_(None),
                SaleOrder.status.in_(OPEN_SALE_ORDER_STATUSES),
                func.lower(SaleOrderItem.product_name) == clean_p.lower(),
            )
        )
        if not all_warehouses:
            stmt = stmt.where(func.lower(SaleOrder.warehouse) == clean_w.lower())
        results = (await db.execute(stmt.order_by(SaleOrder.created_at.desc()).limit(500))).all()
        for idx, (so, so_item) in enumerate(results, start=1):
            items.append({
                "sr_no": idx,
                "order_id": str(so.id),
                "order_no": so.order_no,
                "order_date": so.order_date or "-",
                "company_name": so.company_name or so.buyer_name or "-",
                "gst_no": getattr(so, "gst_no", None),
                "city_state": ", ".join(filter(None, [so.city, so.state])) or "-",
                "quantity": so_item.quantity,
                "status": _format_so_status(so.status),
                "sales_person": so.sales_person or "-",
                "delivery_date": so.delivery_date or "-",
            })
    else:
        from app.purchase.models import ImportPurchase, ImportPurchaseItem

        target_warehouse = f"{clean_w} {stock_type.title()}"
        stmt = (
            select(ImportPurchase, ImportPurchaseItem)
            .join(ImportPurchaseItem, ImportPurchaseItem.purchase_id == ImportPurchase.id)
            .where(
                ImportPurchase.deleted_at.is_(None),
                ImportPurchase.status.in_(ACTIVE_PURCHASE_STATUSES),
                func.lower(ImportPurchaseItem.product_name) == clean_p.lower(),
            )
        )
        if all_warehouses:
            stmt = stmt.where(func.lower(ImportPurchase.warehouse).like(f"% {stock_type}"))
        else:
            stmt = stmt.where(func.lower(ImportPurchase.warehouse) == target_warehouse.lower())
        results = (
            await db.execute(
                stmt.order_by(
                    ImportPurchase.expected_arrival_date.asc().nullslast(),
                    ImportPurchase.created_at.asc(),
                ).limit(500)
            )
        ).all()
        for ip, ip_item in results:
            items.append({
                "sr_no": len(items) + 1,
                "source_type": "import_purchase",
                "consignment_no": ip.consignment_no,
                "invoice_no": ip.consignment_no,
                "date": str(ip.invoice_date or ip.ordered_date or "-"),
                "supplier_name": ip.supplier_name or "-",
                "gross_quantity": float(ip_item.quantity or 0),
                "quantity": float(ip_item.quantity or 0),
                "arrival_date": str(ip.expected_arrival_date or ip.eta_port_date or ip.ordered_date or "-"),
                "status": (ip.status or stock_type).replace("_", " ").title(),
                "warehouse": ip.warehouse or target_warehouse,
                "invoice_date": str(ip.invoice_date or "-"),
                "expected_arrival_date": str(ip.expected_arrival_date or "-"),
                "etd_origin_date": str(ip.etd_origin_date or "-"),
                "eta_port_date": str(ip.eta_port_date or "-"),
            })

        from sqlalchemy.exc import OperationalError

        # Include active in-transit inter-warehouse Stock Transfers in Transit breakup (General New points L69)
        if stock_type == "transit":
            try:
                async with db.begin_nested():
                    st_stmt = (
                        select(StockTransfer, StockTransferLineItem)
                        .join(StockTransferLineItem, StockTransferLineItem.transfer_id == StockTransfer.id)
                        .where(
                            StockTransfer.deleted_at.is_(None),
                            func.lower(StockTransfer.status).in_(("pending", "confirmed", "in transit", "in_transit")),
                            func.lower(StockTransferLineItem.product_name) == clean_p.lower(),
                        )
                    )
                    st_results = (await db.execute(st_stmt.order_by(StockTransfer.created_at.asc()).limit(200))).all()
                for st_rec, st_item in st_results:
                    _, dest_city, _ = _parse_wh_column(st_rec.to_warehouse, prefer_transit=True)
                    if not all_warehouses and dest_city != clean_w.lower():
                        continue
                    items.append({
                        "sr_no": len(items) + 1,
                        "source_type": "stock_transfer",
                        "consignment_no": st_rec.transfer_no,
                        "invoice_no": st_rec.transfer_no,
                        "date": str(st_rec.transfer_date or "-"),
                        "supplier_name": f"Transfer from {st_rec.from_warehouse}",
                        "gross_quantity": float(st_item.quantity or 0),
                        "quantity": float(st_item.quantity or 0),
                        "arrival_date": "-",
                        "status": f"Transfer ({st_rec.status})",
                        "warehouse": st_rec.to_warehouse or target_warehouse,
                        "invoice_date": str(st_rec.transfer_date or "-"),
                        "expected_arrival_date": "-",
                        "etd_origin_date": "-",
                        "eta_port_date": "-",
                    })
            except OperationalError:
                pass

        # Check open SaleOrders booked directly against '<City> Transit' or '<City> Ordered' and apply FIFO deduction
        remaining_booked = 0.0
        try:
            async with db.begin_nested():
                so_transit_stmt = (
                    select(SaleOrder, SaleOrderItem)
                    .join(SaleOrderItem, SaleOrderItem.order_id == SaleOrder.id)
                    .where(
                        SaleOrder.deleted_at.is_(None),
                        SaleOrder.status.in_(OPEN_SALE_ORDER_STATUSES),
                        func.lower(SaleOrderItem.product_name) == clean_p.lower(),
                    )
                )
                if all_warehouses:
                    so_transit_stmt = so_transit_stmt.where(func.lower(SaleOrder.warehouse).like(f"% {stock_type}"))
                else:
                    so_transit_stmt = so_transit_stmt.where(func.lower(SaleOrder.warehouse) == target_warehouse.lower())
                so_transit_rows = (await db.execute(so_transit_stmt.order_by(SaleOrder.created_at.asc()).limit(500))).all()
            for b_idx, (so, so_item) in enumerate(so_transit_rows, start=1):
                b_qty = float(so_item.quantity or 0)
                remaining_booked += b_qty
                booked_orders.append({
                    "sr_no": b_idx,
                    "order_id": str(so.id),
                    "order_no": so.order_no,
                    "order_date": so.order_date or "-",
                    "company_name": so.company_name or so.buyer_name or "-",
                    "city_state": ", ".join(filter(None, [so.city, so.state])) or "-",
                    "quantity": b_qty,
                    "status": _format_so_status(so.status),
                    "sales_person": so.sales_person or "-",
                    "delivery_date": so.delivery_date or "-",
                })
        except OperationalError:
            pass

        if remaining_booked > 0 and items:
            for entry in items:
                if remaining_booked <= 0:
                    entry["booked_quantity"] = 0.0
                    continue
                deduct = min(float(entry["quantity"]), remaining_booked)
                entry["booked_quantity"] = deduct
                entry["quantity"] = round(float(entry["quantity"]) - deduct, 6)
                remaining_booked = round(remaining_booked - deduct, 6)

    return build_success_response(
        data={
            "product_name": clean_p,
            "warehouse": clean_w,
            "stock_type": stock_type,
            "items": items,
            "booked_orders": booked_orders,
        },
        request_id=getattr(getattr(request, "state", None), "request_id", "-") if request else "-",
    )


@router.get("/inventory/goods-expected-report", summary="Goods Expected Date Report for Marketing")
async def get_goods_expected_report(
    request: Request,
    machine: Optional[str] = Query(None, description="Machine lookup by product name, code, container or supplier"),
    warehouse: Optional[str] = Query(None, description="Warehouse filter"),
    status: Optional[str] = Query(None, description="Shipment status filter"),
    limit: int = Query(200, ge=1, le=1000),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    """
    Goods Expected Date Report for Marketing:
    Allows marketing to look up machines and check arriving containers,
    ETD (Origin Date), ETA Port, and Expected Arrival Date.
    """
    items = []
    try:
        from app.purchase.models import ImportPurchase, ImportPurchaseItem

        stmt = (
            select(ImportPurchase, ImportPurchaseItem)
            .join(ImportPurchaseItem, ImportPurchaseItem.purchase_id == ImportPurchase.id)
            .where(ImportPurchase.deleted_at.is_(None))
        )

        if machine and machine.strip():
            clean_m = machine.strip()
            stmt = stmt.where(
                or_(
                    ImportPurchaseItem.product_name.ilike(f"%{clean_m}%"),
                    ImportPurchaseItem.product_code.ilike(f"%{clean_m}%"),
                    ImportPurchase.consignment_no.ilike(f"%{clean_m}%"),
                    ImportPurchase.supplier_name.ilike(f"%{clean_m}%"),
                )
            )

        if warehouse and warehouse.strip().lower() != "all":
            stmt = stmt.where(ImportPurchase.warehouse.ilike(f"%{warehouse.strip()}%"))

        if status and status.strip().lower() != "all":
            stmt = stmt.where(ImportPurchase.status.ilike(f"%{status.strip()}%"))

        stmt = stmt.order_by(
            ImportPurchase.expected_arrival_date.asc().nullslast(),
            ImportPurchase.eta_port_date.asc().nullslast(),
            ImportPurchase.created_at.desc(),
        ).limit(limit)

        results = (await db.execute(stmt)).all()

        for idx, (ip, ip_item) in enumerate(results, start=1):
            status_text = (ip.status or "In Transit").replace("_", " ").title()
            items.append({
                "sr_no": idx,
                "id": str(ip.id),
                "item_id": str(ip_item.id),
                "product_name": ip_item.product_name,
                "product_code": ip_item.product_code or "-",
                "container_no": ip.consignment_no,
                "consignment_no": ip.consignment_no,
                "supplier_name": ip.supplier_name or "-",
                "warehouse": ip.warehouse,
                "quantity": ip_item.quantity,
                "uom": ip_item.uom or "NOS",
                "ordered_date": str(ip.ordered_date) if ip.ordered_date else "-",
                "etd_origin_date": str(ip.etd_origin_date) if ip.etd_origin_date else "-",
                "eta_port_date": str(ip.eta_port_date) if ip.eta_port_date else "-",
                "expected_arrival_date": str(ip.expected_arrival_date) if ip.expected_arrival_date else "-",
                "status": status_text,
                "remarks": ip.remarks or "",
            })

        # Fallback check on ProductStock.orders_info if results are empty and a machine search was given
        if not items and machine and machine.strip():
            st_stmt = select(ProductStock).where(
                ProductStock.deleted_at.is_(None),
                or_(
                    ProductStock.product_name_tally.ilike(f"%{machine.strip()}%"),
                    ProductStock.product_code.ilike(f"%{machine.strip()}%"),
                ),
            )
            stocks = (await db.execute(st_stmt)).scalars().all()
            idx = 1
            for st in stocks:
                if st.orders_info:
                    for o in st.orders_info:
                        if not isinstance(o, dict) or o.get("_type") == "wh_reorder":
                            continue
                        items.append({
                            "sr_no": idx,
                            "id": f"po-{idx}",
                            "item_id": f"po-item-{idx}",
                            "product_name": st.product_name_tally,
                            "product_code": st.product_code or "-",
                            "container_no": o.get("po_number", f"PO-{idx}"),
                            "consignment_no": o.get("po_number", f"PO-{idx}"),
                            "supplier_name": o.get("supplier", "-"),
                            "warehouse": warehouse or "Mumbai",
                            "quantity": float(o.get("ordered_qty", 1)),
                            "uom": st.uom or "NOS",
                            "ordered_date": "-",
                            "etd_origin_date": "-",
                            "eta_port_date": "-",
                            "expected_arrival_date": o.get("expected_date", "-"),
                            "status": "Ordered",
                            "remarks": "",
                        })
                        idx += 1
    except Exception as exc:
        logger.warning(f"Error fetching goods expected report: {exc}")

    return build_success_response(
        data={"items": items, "total": len(items)},
        meta={"count": len(items)},
        request_id=getattr(getattr(request, "state", None), "request_id", "-") if request else "-",
    )


_IST_TZ = datetime.timezone(datetime.timedelta(hours=5, minutes=30))


def _to_ist_dt(raw: Any, fallback_dt: Optional[datetime.datetime] = None) -> datetime.datetime:
    """Normalize UTC/aware/naive datetimes or ERP date strings into IST timezone-aware datetime."""
    if isinstance(raw, datetime.datetime):
        if raw.tzinfo is None:
            return raw.replace(tzinfo=datetime.timezone.utc).astimezone(_IST_TZ)
        return raw.astimezone(_IST_TZ)
    if isinstance(raw, datetime.date):
        return datetime.datetime(raw.year, raw.month, raw.day, 0, 0, tzinfo=_IST_TZ)
    if isinstance(raw, str) and raw.strip():
        s = raw.strip()
        for fmt in ("%d-%m-%Y %I:%M %p", "%d-%m-%Y %H:%M:%S", "%Y-%m-%d %H:%M:%S"):
            try:
                return datetime.datetime.strptime(s, fmt).replace(tzinfo=_IST_TZ)
            except ValueError:
                continue
        try:
            iso_dt = datetime.datetime.fromisoformat(s.replace("Z", "+00:00"))
            return iso_dt.replace(tzinfo=_IST_TZ) if iso_dt.tzinfo is None else iso_dt.astimezone(_IST_TZ)
        except ValueError:
            pass
        for fmt in ("%d-%m-%Y", "%Y-%m-%d", "%d/%m/%Y"):
            try:
                d = datetime.datetime.strptime(s[:10], fmt).date()
                return datetime.datetime(d.year, d.month, d.day, 0, 0, tzinfo=_IST_TZ)
            except ValueError:
                continue
    if fallback_dt is not None:
        return fallback_dt
    return datetime.datetime(1970, 1, 1, 0, 0, tzinfo=_IST_TZ)


def _fmt_signed_qty(val: float) -> str:
    sign_str = "+ " if val >= 0 else "- "
    mag = abs(round(float(val), 4))
    num_str = str(int(mag)) if mag.is_integer() else f"{mag:g}"
    return f"{sign_str}{num_str}"


def _parse_iso_or_dmy(raw: Optional[str]) -> Optional[str]:
    val = _text(raw)
    if not val:
        return None
    for fmt in ("%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y"):
        try:
            return datetime.datetime.strptime(val[:10], fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    return None


def _find_timeline_event(timeline: Any, target_keys: set[str]) -> Optional[dict]:
    if not isinstance(timeline, list):
        return None
    for ev in timeline:
        if not isinstance(ev, dict):
            continue
        k1 = str(ev.get("status_key") or "").strip().lower().replace(" ", "_").replace("-", "_")
        k2 = str(ev.get("status") or "").strip().lower().replace(" ", "_").replace("-", "_")
        if k1 in target_keys or k2 in target_keys:
            return ev
    return None


@router.get("/inventory/stock-transactions/{product_ref}", summary="Per-product stock transaction ledger")
@router.get("/stock-transaction/list/{product_ref}", summary="Alias for per-product stock transaction ledger")
@router.get("/stock_transaction/list/{product_ref}", summary="Alias for per-product stock transaction ledger")
@router.get("/inventory/product-stock/{product_ref}/transactions", summary="Alias for per-product stock transaction ledger")
async def get_product_stock_transactions(
    product_ref: str,
    request: Request,
    warehouse: Optional[str] = Query(None, description="Warehouse filter (e.g. Mumbai, Mumbai Transit, All)"),
    type_filter: Optional[str] = Query(None, alias="type", description="Transaction type filter"),
    date_from: Optional[str] = Query(None, description="From date (YYYY-MM-DD or DD-MM-YYYY)"),
    date_to: Optional[str] = Query(None, description="To date (YYYY-MM-DD or DD-MM-YYYY)"),
    search: Optional[str] = Query(None, description="Search keyword"),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    """Chronological per-product stock ledger across Sale Orders, Stock Adjustments, Local Purchases,
    Import Purchases, and Stock Transfers.

    Matches erp.inhymasolutions.com/stock-transaction/list/:id layout:
    - Returns product header summary + AVAILABLE QTY + warehouse balances
    - Returns newest-first ledger rows with sequential ID, Title + bold Party Name, Type badge, Warehouse,
      signed Quantity ('- 1' / '+ 1'), Created By, and Transaction Date ('DD-MM-YYYY hh:mm AM/PM' IST).
    """
    from sqlalchemy.exc import OperationalError

    from app.masters.brands.models import Brand
    from app.masters.product_categories.models import ProductCategory
    from app.masters.product_sub_categories.models import ProductSubCategory
    from app.masters.products.models import Product
    from app.masters.uom.models import UnitOfMeasurement
    from app.purchase.models import ImportPurchase, ImportPurchaseItem, LocalPurchase, LocalPurchaseItem
    from app.sales.models import SaleOrder, SaleOrderItem

    clean_ref = product_ref.strip()
    product: Optional[Product] = None
    stock: Optional[ProductStock] = None

    try:
        ref_uuid = uuid.UUID(clean_ref)
        product = (
            await db.execute(select(Product).where(Product.id == ref_uuid, Product.deleted_at.is_(None)))
        ).scalars().first()
        stock = (
            await db.execute(select(ProductStock).where(ProductStock.id == ref_uuid, ProductStock.deleted_at.is_(None)))
        ).scalars().first()
    except ValueError:
        if clean_ref.isdigit():
            stock = (
                await db.execute(
                    select(ProductStock).where(ProductStock.sr_no == int(clean_ref), ProductStock.deleted_at.is_(None))
                )
            ).scalars().first()
        if product is None and stock is None:
            product = (
                await db.execute(
                    select(Product).where(
                        Product.deleted_at.is_(None),
                        or_(
                            func.lower(Product.product_code) == clean_ref.lower(),
                            func.lower(Product.product_name_tally) == clean_ref.lower(),
                            func.lower(Product.product_name) == clean_ref.lower(),
                        ),
                    )
                )
            ).scalars().first()
        if product is None and stock is None:
            stock = (
                await db.execute(
                    select(ProductStock).where(
                        ProductStock.deleted_at.is_(None),
                        or_(
                            func.lower(ProductStock.product_code) == clean_ref.lower(),
                            func.lower(ProductStock.product_name_tally) == clean_ref.lower(),
                        ),
                    )
                )
            ).scalars().first()

    if product is not None and stock is None:
        stock = (
            await db.execute(
                select(ProductStock).where(ProductStock.product_id == product.id, ProductStock.deleted_at.is_(None))
            )
        ).scalars().first()
        if stock is None:
            p_tally = (product.product_name_tally or product.product_name or "").strip().lower()
            if p_tally:
                stock = (
                    await db.execute(
                        select(ProductStock).where(
                            ProductStock.product_id.is_(None),
                            ProductStock.deleted_at.is_(None),
                            func.lower(ProductStock.product_name_tally) == p_tally,
                        )
                    )
                ).scalars().first()
    elif stock is not None and product is None and stock.product_id is not None:
        product = (await db.execute(select(Product).where(Product.id == stock.product_id))).scalars().first()

    if product is None and stock is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")

    # Resolve master metadata for header display
    brand_name = stock.brand if (stock and stock.brand and stock.brand != "-") else "-"
    cat_name = stock.category if (stock and stock.category and stock.category != "-") else None
    sub_name = stock.sub_category if (stock and stock.sub_category and stock.sub_category != "-") else None
    uom_name = stock.uom if (stock and stock.uom) else "SET"

    if product is not None:
        if brand_name == "-" and product.brand_id:
            b = (await db.execute(select(Brand.name).where(Brand.id == product.brand_id))).scalar()
            if b:
                brand_name = b
        if not cat_name and product.category_id:
            c = (await db.execute(select(ProductCategory.name).where(ProductCategory.id == product.category_id))).scalar()
            if c:
                cat_name = c
        if not sub_name and product.sub_category_id:
            s = (await db.execute(select(ProductSubCategory.name).where(ProductSubCategory.id == product.sub_category_id))).scalar()
            if s:
                sub_name = s
        if product.uom_id:
            u = (
                await db.execute(
                    select(func.coalesce(UnitOfMeasurement.short_name, UnitOfMeasurement.name)).where(
                        UnitOfMeasurement.id == product.uom_id
                    )
                )
            ).scalar()
            if u:
                uom_name = u

    display_name = (
        (stock.product_name_tally if stock else None)
        or (product.product_name_tally if product else None)
        or (product.product_name if product else None)
        or clean_ref
    )
    display_code = (
        (product.product_code if (product and product.product_code and product.product_code != "-") else None)
        or (stock.product_code if (stock and stock.product_code and stock.product_code != "-") else None)
        or "-"
    )

    target_names_lower = {
        n.strip().lower()
        for n in (
            stock.product_name_tally if stock else None,
            product.product_name_tally if product else None,
            product.product_name if product else None,
            product.product_name_invoice if product else None,
        )
        if n and n.strip()
    }
    target_product_id = product.id if product is not None else None

    raw_entries: list[dict[str, Any]] = []

    def _push_entry(
        *,
        entry_uid: str,
        title: str,
        party_name: Optional[str],
        tx_type: str,
        wh: str,
        signed_qty: float,
        actor: str,
        dt_ist: datetime.datetime,
        phase: int,
        ref_type: str,
        ref_id: str,
        ref_no: Optional[str],
    ) -> None:
        raw_entries.append({
            "entry_uid": entry_uid,
            "title": title,
            "party_name": party_name,
            "type": tx_type,
            "warehouse": wh,
            "quantity": round(float(signed_qty), 4),
            "quantity_display": _fmt_signed_qty(signed_qty),
            "created_by": actor or "Admin",
            "transaction_date": dt_ist.strftime("%d-%m-%Y %I:%M %p"),
            "iso_date": dt_ist.strftime("%Y-%m-%d"),
            "sort_epoch": dt_ist.timestamp(),
            "_phase": phase,
            "ref_type": ref_type,
            "ref_id": ref_id,
            "ref_no": ref_no,
        })

    # 1. Sale Orders (Confirm / Booked stock out + Cancel / Delete stock return)
    try:
        async with db.begin_nested():
            so_conds = []
            if target_product_id is not None:
                so_conds.append(SaleOrderItem.product_id == target_product_id)
            if target_names_lower:
                so_conds.append(func.lower(SaleOrderItem.product_name).in_(sorted(target_names_lower)))
            if so_conds:
                so_rows = (
                    await db.execute(
                        select(SaleOrder, SaleOrderItem)
                        .join(SaleOrderItem, SaleOrderItem.order_id == SaleOrder.id)
                        .where(SaleOrderItem.is_additional_charge.is_(False), or_(*so_conds))
                        .order_by(SaleOrder.created_at.asc())
                    )
                ).all()
            else:
                so_rows = []
        for so, li in so_rows:
            st_low = (so.status or "").strip().lower()
            is_cancelled_or_deleted = st_low == "cancelled" or so.deleted_at is not None
            conf_ev = _find_timeline_event(
                so.timeline, {"sales_confirmed", "confirmed", "admin_approved", "acc_confirmed"}
            ) or _find_timeline_event(so.timeline, {"pending"})
            ever_applied = (
                bool(so.stock_applied)
                or st_low in (
                    "sales_confirmed",
                    "confirmed",
                    "admin_approved",
                    "acc_confirmed",
                    "gatepass_created",
                    "gatepass_cancelled",
                    "dispatched",
                    "lr",
                    "cancelled",
                )
                or conf_ev is not None
            )
            if not ever_applied:
                continue
            party = (so.company_name or so.buyer_name or "").strip() or None
            wh_name = (so.warehouse or "Mumbai").strip()
            actor = (
                (str(conf_ev.get("by")).strip() if conf_ev and conf_ev.get("by") else None)
                or (so.created_by_name or "").strip()
                or (so.sales_person or "").strip()
                or "Admin"
            )
            out_dt = _to_ist_dt(
                conf_ev.get("date") if conf_ev else None,
                fallback_dt=_to_ist_dt(so.created_at),
            )
            qty_mag = abs(float(li.quantity or 0.0))
            _push_entry(
                entry_uid=f"so-{li.id}-out",
                title=f"Sale Order #{so.order_no} Confirm",
                party_name=party,
                tx_type="Sale",
                wh=wh_name,
                signed_qty=-qty_mag,
                actor=actor,
                dt_ist=out_dt,
                phase=0,
                ref_type="sale_order",
                ref_id=str(so.id),
                ref_no=so.order_no,
            )
            if is_cancelled_or_deleted and not so.stock_applied:
                canc_ev = _find_timeline_event(so.timeline, {"cancelled"})
                canc_actor = (
                    (str(canc_ev.get("by")).strip() if canc_ev and canc_ev.get("by") else None)
                    or (so.created_by_name or "").strip()
                    or (so.sales_person or "").strip()
                    or "Admin"
                )
                canc_dt = _to_ist_dt(
                    canc_ev.get("date") if canc_ev else None,
                    fallback_dt=_to_ist_dt(so.deleted_at or getattr(so, "updated_at", None) or so.created_at),
                )
                if canc_dt < out_dt:
                    canc_dt = out_dt
                _push_entry(
                    entry_uid=f"so-{li.id}-cancel",
                    title=f"Sale Order #{so.order_no} Cancelled",
                    party_name=party,
                    tx_type="Sale Cancel",
                    wh=wh_name,
                    signed_qty=qty_mag,
                    actor=canc_actor,
                    dt_ist=canc_dt,
                    phase=1,
                    ref_type="sale_order",
                    ref_id=str(so.id),
                    ref_no=so.order_no,
                )
    except OperationalError:
        pass

    # 2. Stock Adjustments (Stock IN / Stock OUT + soft-delete reversals)
    try:
        async with db.begin_nested():
            adj_conds = []
            if target_product_id is not None:
                adj_conds.append(StockAdjustmentLineItem.product_id == str(target_product_id))
            if target_names_lower:
                adj_conds.append(func.lower(StockAdjustmentLineItem.product_name).in_(sorted(target_names_lower)))
            if adj_conds:
                adj_rows = (
                    await db.execute(
                        select(StockAdjustment, StockAdjustmentLineItem)
                        .join(StockAdjustmentLineItem, StockAdjustmentLineItem.adjustment_id == StockAdjustment.id)
                        .where(or_(*adj_conds))
                        .order_by(StockAdjustment.created_at.asc())
                    )
                ).all()
            else:
                adj_rows = []
        for adj, li in adj_rows:
            is_in = (adj.type or "").strip().upper() != "STOCK OUT"
            prefix = "Stock In" if is_in else "Stock Out"
            purpose_str = (adj.purpose or "Adjustment").strip()
            adj_no_str = (adj.adjustment_no or "-").strip()
            wh_name = (adj.warehouse or "Mumbai").strip()
            party = (adj.client_name or "").strip() or None
            actor = (adj.created_by or "Admin").strip()
            qty_mag = abs(float(li.quantity or 0.0))
            adj_dt = _to_ist_dt(adj.created_at)
            _push_entry(
                entry_uid=f"adj-{li.id}",
                title=f"{prefix} For Purpose {purpose_str} (Adjustment Order #{adj_no_str})",
                party_name=party,
                tx_type="Stock IN" if is_in else "Stock OUT",
                wh=wh_name,
                signed_qty=qty_mag if is_in else -qty_mag,
                actor=actor,
                dt_ist=adj_dt,
                phase=0,
                ref_type="stock_adjustment",
                ref_id=str(adj.id),
                ref_no=adj_no_str,
            )
            if adj.deleted_at is not None:
                rev_dt = _to_ist_dt(adj.deleted_at, fallback_dt=adj_dt)
                if rev_dt < adj_dt:
                    rev_dt = adj_dt
                _push_entry(
                    entry_uid=f"adj-{li.id}-rev",
                    title=f"Adjustment Order #{adj_no_str} Deleted (Reversed)",
                    party_name=party,
                    tx_type="Stock OUT" if is_in else "Stock IN",
                    wh=wh_name,
                    signed_qty=-qty_mag if is_in else qty_mag,
                    actor=actor,
                    dt_ist=rev_dt,
                    phase=1,
                    ref_type="stock_adjustment",
                    ref_id=str(adj.id),
                    ref_no=adj_no_str,
                )
    except OperationalError:
        pass

    # 3. Local Purchases (Confirmed stock in + soft-delete reversals)
    try:
        async with db.begin_nested():
            if target_names_lower:
                lp_rows = (
                    await db.execute(
                        select(LocalPurchase, LocalPurchaseItem)
                        .join(LocalPurchaseItem, LocalPurchaseItem.purchase_id == LocalPurchase.id)
                        .where(func.lower(LocalPurchaseItem.product_name).in_(sorted(target_names_lower)))
                        .order_by(LocalPurchase.created_at.asc())
                    )
                ).all()
            else:
                lp_rows = []
        for lp, li in lp_rows:
            lp_status = (lp.status or "").strip().lower()
            was_applied = bool(lp.stock_applied) or lp_status == "confirmed" or lp.confirmed_at is not None
            if not was_applied:
                continue
            party = (lp.supplier_name or "").strip() or None
            wh_name = (lp.warehouse or "Mumbai").strip()
            actor = (lp.confirmed_by or lp.created_by or "Admin").strip()
            qty_mag = abs(float(li.quantity or 0.0))
            lp_dt = _to_ist_dt(lp.confirmed_at or lp.created_at)
            _push_entry(
                entry_uid=f"lp-{li.id}",
                title=f"Local Purchase #{lp.invoice_no} Confirm",
                party_name=party,
                tx_type="Local Purchase",
                wh=wh_name,
                signed_qty=qty_mag,
                actor=actor,
                dt_ist=lp_dt,
                phase=0,
                ref_type="local_purchase",
                ref_id=str(lp.id),
                ref_no=lp.invoice_no,
            )
            if (lp.deleted_at is not None or lp_status == "cancelled") and not lp.stock_applied:
                rev_dt = _to_ist_dt(lp.deleted_at or getattr(lp, "updated_at", None) or lp_dt, fallback_dt=lp_dt)
                if rev_dt < lp_dt:
                    rev_dt = lp_dt
                _push_entry(
                    entry_uid=f"lp-{li.id}-rev",
                    title=f"Local Purchase #{lp.invoice_no} Cancelled",
                    party_name=party,
                    tx_type="Stock OUT",
                    wh=wh_name,
                    signed_qty=-qty_mag,
                    actor=actor,
                    dt_ist=rev_dt,
                    phase=1,
                    ref_type="local_purchase",
                    ref_id=str(lp.id),
                    ref_no=lp.invoice_no,
                )
    except OperationalError:
        pass

    # 4. Import Purchases (Consignment stock in + soft-delete/cancel reversals)
    try:
        async with db.begin_nested():
            if target_names_lower:
                ip_rows = (
                    await db.execute(
                        select(ImportPurchase, ImportPurchaseItem)
                        .join(ImportPurchaseItem, ImportPurchaseItem.purchase_id == ImportPurchase.id)
                        .where(func.lower(ImportPurchaseItem.product_name).in_(sorted(target_names_lower)))
                        .order_by(ImportPurchase.created_at.asc())
                    )
                ).all()
            else:
                ip_rows = []
        for ip, li in ip_rows:
            ip_status = (ip.status or "pending").strip().lower()
            was_applied = bool(ip.stock_applied) or ip_status in ("pending", "confirmed", "received", "closed", "cancelled")
            if not was_applied:
                continue
            party = (ip.supplier_name or "").strip() or None
            wh_name = (ip.warehouse or "Mumbai Ordered").strip()
            actor = (ip.confirmed_by or ip.created_by or "Admin").strip()
            qty_mag = abs(float(li.quantity or 0.0))
            ip_dt = _to_ist_dt(ip.created_at)
            status_title = ip_status.replace("_", " ").title() if ip_status != "cancelled" else "Pending"
            _push_entry(
                entry_uid=f"ip-{li.id}",
                title=f"Import Purchase #{ip.consignment_no} ({status_title})",
                party_name=party,
                tx_type="Import Purchase",
                wh=wh_name,
                signed_qty=qty_mag,
                actor=actor,
                dt_ist=ip_dt,
                phase=0,
                ref_type="import_purchase",
                ref_id=str(ip.id),
                ref_no=ip.consignment_no,
            )
            if (ip.deleted_at is not None or ip_status == "cancelled") and not ip.stock_applied:
                rev_dt = _to_ist_dt(ip.deleted_at or getattr(ip, "updated_at", None) or ip_dt, fallback_dt=ip_dt)
                if rev_dt < ip_dt:
                    rev_dt = ip_dt
                _push_entry(
                    entry_uid=f"ip-{li.id}-rev",
                    title=f"Import Purchase #{ip.consignment_no} Cancelled",
                    party_name=party,
                    tx_type="Stock OUT",
                    wh=wh_name,
                    signed_qty=-qty_mag,
                    actor=actor,
                    dt_ist=rev_dt,
                    phase=1,
                    ref_type="import_purchase",
                    ref_id=str(ip.id),
                    ref_no=ip.consignment_no,
                )
    except OperationalError:
        pass

    # 5. Stock Transfers (Origin Transfer OUT + Destination Transfer IN + Cancel reversals)
    try:
        async with db.begin_nested():
            if target_names_lower:
                st_rows = (
                    await db.execute(
                        select(StockTransfer, StockTransferLineItem)
                        .join(StockTransferLineItem, StockTransferLineItem.transfer_id == StockTransfer.id)
                        .where(func.lower(StockTransferLineItem.product_name).in_(sorted(target_names_lower)))
                        .order_by(StockTransfer.created_at.asc())
                    )
                ).all()
            else:
                st_rows = []
        for st, li in st_rows:
            st_status = (st.status or "Received").strip()
            st_low = st_status.lower()
            _, dest_city, dest_is_transit = _parse_wh_column(
                st.to_warehouse,
                prefer_transit=(st_low not in ("received", "cancel")),
            )
            dest_wh = f"{dest_city.capitalize()} Transit" if dest_is_transit else (st.to_warehouse or dest_city.capitalize()).strip()
            orig_wh = (st.from_warehouse or "Mumbai").strip()
            actor = (st.added_by or "Admin").strip()
            qty_mag = abs(float(li.quantity or 0.0))
            st_dt = _to_ist_dt(st.created_at)
            _push_entry(
                entry_uid=f"trf-{li.id}-out",
                title=f"Stock Transfer Out #{st.transfer_no} (To {dest_wh})",
                party_name=None,
                tx_type="Transfer OUT",
                wh=orig_wh,
                signed_qty=-qty_mag,
                actor=actor,
                dt_ist=st_dt,
                phase=0,
                ref_type="stock_transfer",
                ref_id=str(st.id),
                ref_no=st.transfer_no,
            )
            _push_entry(
                entry_uid=f"trf-{li.id}-in",
                title=f"Stock Transfer In #{st.transfer_no} (From {orig_wh})",
                party_name=None,
                tx_type="Transfer IN",
                wh=dest_wh,
                signed_qty=qty_mag,
                actor=actor,
                dt_ist=st_dt,
                phase=0,
                ref_type="stock_transfer",
                ref_id=str(st.id),
                ref_no=st.transfer_no,
            )
            if st_low == "cancel" or st.deleted_at is not None:
                rev_dt = _to_ist_dt(st.deleted_at or getattr(st, "updated_at", None) or st_dt, fallback_dt=st_dt)
                if rev_dt < st_dt:
                    rev_dt = st_dt
                _push_entry(
                    entry_uid=f"trf-{li.id}-cancel-in",
                    title=f"Stock Transfer #{st.transfer_no} Cancelled (Returned to {orig_wh})",
                    party_name=None,
                    tx_type="Transfer IN",
                    wh=orig_wh,
                    signed_qty=qty_mag,
                    actor=actor,
                    dt_ist=rev_dt,
                    phase=1,
                    ref_type="stock_transfer",
                    ref_id=str(st.id),
                    ref_no=st.transfer_no,
                )
                _push_entry(
                    entry_uid=f"trf-{li.id}-cancel-out",
                    title=f"Stock Transfer #{st.transfer_no} Cancelled (Reversed from {dest_wh})",
                    party_name=None,
                    tx_type="Transfer OUT",
                    wh=dest_wh,
                    signed_qty=-qty_mag,
                    actor=actor,
                    dt_ist=rev_dt,
                    phase=1,
                    ref_type="stock_transfer",
                    ref_id=str(st.id),
                    ref_no=st.transfer_no,
                )
    except OperationalError:
        pass

    # Assign sequential IDs chronologically (oldest=1 .. newest=N) then reverse to newest-first
    raw_entries.sort(key=lambda e: (e["sort_epoch"], e["_phase"], e["entry_uid"]))
    all_warehouses_seen: set[str] = set()
    all_types_seen: set[str] = set()
    for seq_id, entry in enumerate(raw_entries, start=1):
        entry["id"] = seq_id
        entry.pop("_phase", None)
        if entry["warehouse"]:
            all_warehouses_seen.add(entry["warehouse"])
        if entry["type"]:
            all_types_seen.add(entry["type"])

    ledger_entries = list(reversed(raw_entries))

    # Apply optional server-side filters
    wanted_wh = _text(warehouse)
    if wanted_wh and wanted_wh.lower() not in ("all", "select"):
        ledger_entries = [e for e in ledger_entries if (e["warehouse"] or "").strip().lower() == wanted_wh.lower()]

    wanted_type = _text(type_filter)
    if wanted_type and wanted_type.lower() not in ("all", "select"):
        ledger_entries = [e for e in ledger_entries if (e["type"] or "").strip().lower() == wanted_type.lower()]

    iso_from = _parse_iso_or_dmy(date_from)
    iso_to = _parse_iso_or_dmy(date_to)
    if iso_from:
        ledger_entries = [e for e in ledger_entries if e["iso_date"] >= iso_from]
    if iso_to:
        ledger_entries = [e for e in ledger_entries if e["iso_date"] <= iso_to]

    q_term = _text(search).lower()
    if q_term:
        ledger_entries = [
            e
            for e in ledger_entries
            if q_term in str(e["id"]).lower()
            or q_term in (e["title"] or "").lower()
            or q_term in (e["party_name"] or "").lower()
            or q_term in (e["type"] or "").lower()
            or q_term in (e["warehouse"] or "").lower()
            or q_term in (e["created_by"] or "").lower()
            or q_term in (e["transaction_date"] or "").lower()
            or q_term in (e["quantity_display"] or "").lower()
        ]

    warehouses_balances = {
        col: float(getattr(stock, col, 0.0) or 0.0) if stock is not None else 0.0
        for col in stock_service.WAREHOUSE_COLUMNS
    }
    total_qty = float(stock.total_qty or 0.0) if stock is not None else 0.0
    physical_qty = (
        warehouses_balances["mumbai"] + warehouses_balances["ahmedabad"] + warehouses_balances["indore"]
    )

    wh_col_key = wanted_wh.lower().replace(" ", "_") if wanted_wh and wanted_wh.lower() not in ("all", "select") else ""
    filtered_avail_qty = warehouses_balances.get(wh_col_key, total_qty) if wh_col_key else total_qty

    standard_warehouses = [
        "Mumbai",
        "Mumbai Transit",
        "Mumbai Ordered",
        "Ahmedabad",
        "Ahmedabad Transit",
        "Ahmedabad Ordered",
        "Indore",
        "Indore Transit",
        "Indore Ordered",
    ]
    standard_types = [
        "Sale",
        "Sale Cancel",
        "Stock IN",
        "Stock OUT",
        "Local Purchase",
        "Import Purchase",
        "Transfer IN",
        "Transfer OUT",
    ]

    return build_success_response(
        data={
            "product": {
                "id": str(product.id if product is not None else stock.id),
                "product_id": str(product.id) if product is not None else None,
                "stock_id": str(stock.id) if stock is not None else None,
                "sr_no": stock.sr_no if stock is not None else None,
                "product_name_tally": display_name,
                "product_code": display_code,
                "brand": brand_name,
                "category": cat_name,
                "sub_category": sub_name or "-",
                "uom": uom_name,
                "available_qty": total_qty,
                "filtered_available_qty": filtered_avail_qty,
                "physical_qty": physical_qty,
                "warehouses": warehouses_balances,
            },
            "items": ledger_entries,
            "total": len(ledger_entries),
            "filter_options": {
                "warehouses": standard_warehouses + sorted(w for w in all_warehouses_seen if w not in standard_warehouses),
                "types": standard_types + sorted(t for t in all_types_seen if t not in standard_types),
            },
        },
        request_id=getattr(request.state, "request_id", "-") if request and hasattr(request, "state") else "-",
    )


@router.get("/inventory/product-stock/{stock_id}", summary="Get product stock details by ID")
async def get_product_stock(stock_id: str, request: Request, db: AsyncSession = Depends(get_db_session)) -> dict:
    """Single product stock entry (by stock ID, product ID, product code or exact name)."""
    from app.masters.products.models import Product

    stmt = select(ProductStock).where(ProductStock.deleted_at.is_(None))
    prod_fallback: Optional[Product] = None
    try:
        val_uuid = uuid.UUID(stock_id)
        stmt = stmt.where(or_(ProductStock.id == val_uuid, ProductStock.product_id == val_uuid))
        prod_fallback = (await db.execute(select(Product).where(Product.id == val_uuid, Product.deleted_at.is_(None)))).scalars().first()
    except ValueError:
        stmt = stmt.where(or_(ProductStock.product_code == stock_id, func.lower(ProductStock.product_name_tally) == stock_id.lower()))
        prod_fallback = (
            await db.execute(
                select(Product).where(
                    Product.deleted_at.is_(None),
                    or_(Product.product_code == stock_id, func.lower(Product.product_name_tally) == stock_id.lower()),
                )
            )
        ).scalars().first()
    r = (await db.execute(stmt)).scalars().first()
    if r is not None:
        return build_success_response(data=_stock_item(r), request_id=getattr(request.state, "request_id", "-"))
    if prod_fallback is not None:
        p_name = prod_fallback.product_name_tally or prod_fallback.product_name
        return build_success_response(
            data={
                "id": str(prod_fallback.id),
                "sr_no": None,
                "product_id": str(prod_fallback.id),
                "product_name_tally": p_name,
                "product_name": p_name,
                "product_code": prod_fallback.product_code or "-",
                "brand": "-",
                "category": None,
                "sub_category": None,
                "hsn_code": None,
                "gst_rate": "18%",
                "mumbai": 0.0,
                "mumbai_transit": 0.0,
                "mumbai_ordered": 0.0,
                "ahmedabad": 0.0,
                "ahmedabad_transit": 0.0,
                "ahmedabad_ordered": 0.0,
                "indore": 0.0,
                "indore_transit": 0.0,
                "indore_ordered": 0.0,
                "total_qty": 0.0,
                "uom": "SET",
                "description": prod_fallback.description,
                "orders_info": [],
                "status": "In Stock",
                "quantity_on_hand": 0.0,
                "quantity_available": 0.0,
            },
            request_id=getattr(request.state, "request_id", "-"),
        )
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Stock record not found")


# ==============================================================================
# Stock Adjustment Endpoints
# ==============================================================================

@router.get("/inventory/stock-adjustment", summary="List stock adjustments")
@router.get("/adjustment/list", summary="Alias for adjustment list")
async def list_stock_adjustments(
    request: Request,
    date_range: Optional[str] = Query(None, description="'MM/DD/YYYY - MM/DD/YYYY'"),
    type_filter: Optional[str] = Query(None, alias="type", description="'Stock IN' | 'Stock OUT' | 'All'"),
    purpose_filter: Optional[str] = Query(None, alias="purpose", description="'Return From Client' | 'Split' | 'Damage' | 'All'"),
    warehouse: Optional[str] = Query(None, description="Warehouse filter or 'All'"),
    search: Optional[str] = Query(None, description="Search term"),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=500),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    """Paginated adjustments from the database (newest first). Every filter -- including the date range -- is applied
    on the server; nothing is served from memory."""
    stmt = select(StockAdjustment).where(StockAdjustment.deleted_at.is_(None))
    if _text(type_filter) and _text(type_filter) != "All":
        stmt = stmt.where(StockAdjustment.type == _text(type_filter))
    if _text(purpose_filter) and _text(purpose_filter) != "All":
        stmt = stmt.where(StockAdjustment.purpose == _text(purpose_filter))
    if _text(warehouse) and _text(warehouse) != "All":
        stmt = stmt.where(StockAdjustment.warehouse == _text(warehouse))
    start, end = _parse_date_range(date_range)
    if start and end:
        stmt = stmt.where(StockAdjustment.adjustment_dt >= start, StockAdjustment.adjustment_dt <= end)
    if _text(search):
        line_match = select(StockAdjustmentLineItem.id).where(
            StockAdjustmentLineItem.adjustment_id == StockAdjustment.id, _contains(StockAdjustmentLineItem.product_name, search)
        ).exists()
        stmt = stmt.where(
            or_(
                _contains(StockAdjustment.client_name, search),
                _contains(StockAdjustment.invoice_no, search),
                _contains(StockAdjustment.warehouse, search),
                _contains(StockAdjustment.purpose, search),
                _contains(StockAdjustment.adjustment_no, search),
                _contains(StockAdjustment.created_by, search),
                line_match,
            )
        )
    total = (await db.execute(select(func.count()).select_from(stmt.order_by(None).subquery()))).scalar() or 0
    rows = (
        await db.execute(
            stmt.options(selectinload(StockAdjustment.items))
            .order_by(StockAdjustment.adjustment_dt.desc().nulls_last(), StockAdjustment.created_at.desc(), StockAdjustment.id)
            .offset(skip)
            .limit(limit)
        )
    ).scalars().all()
    return build_success_response(
        data={"items": [_adjustment_record(r) for r in rows], "total": total, "skip": skip, "limit": limit},
        request_id=getattr(request.state, "request_id", "-"),
    )


@router.get("/inventory/stock-adjustment/{adjustment_id}", summary="Get stock adjustment details")
@router.get("/adjustment/{adjustment_id}", summary="Alias for single adjustment details")
async def get_stock_adjustment(adjustment_id: str, request: Request, db: AsyncSession = Depends(get_db_session)) -> dict:
    """One adjustment (by id or adjustment number)."""
    stmt = select(StockAdjustment).options(selectinload(StockAdjustment.items)).where(StockAdjustment.deleted_at.is_(None))
    try:
        stmt = stmt.where(StockAdjustment.id == uuid.UUID(adjustment_id))
    except ValueError:
        stmt = stmt.where(StockAdjustment.adjustment_no == adjustment_id)
    r = (await db.execute(stmt)).scalars().first()
    if r is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Adjustment record not found")
    return build_success_response(data=_adjustment_record(r), request_id=getattr(request.state, "request_id", "-"))


@router.post("/inventory/stock-adjustment", status_code=status.HTTP_201_CREATED, summary="Create stock adjustment")
@router.post("/adjustment", status_code=status.HTTP_201_CREATED, summary="Alias to create adjustment")
async def create_stock_adjustment(
    payload: StockAdjustmentCreate,
    request: Request,
    db: AsyncSession = Depends(get_db_session),
    current_user: CurrentUser = Depends(get_current_user),
) -> dict:
    """Record a stock adjustment AND apply it to the stock -- both or neither.

    Stock moves through the one shared stock service, so the rules are the same as for purchases and orders:
    the warehouse and every product must exist, a transit / ordered warehouse changes its own column (never the
    physical one), a physical warehouse can never go negative (409), and the quantity applied is exactly the
    quantity recorded. Any failure rolls the whole adjustment back and is reported -- nothing is "saved locally".
    """
    if payload.type not in ("Stock IN", "Stock OUT"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Type must be 'Stock IN' or 'Stock OUT'.")
    adjustment_dt = _parse_ddmmyyyy(payload.adjustment_date)
    await stock_service.get_warehouse(db, payload.warehouse, require_active=True)  # unknown or inactive warehouse -> 400 before anything is written

    adj_no = (payload.adjustment_no or "").strip() or await _next_adjustment_no(db)
    clash = (
        await db.execute(
            select(StockAdjustment.id).where(StockAdjustment.adjustment_no == adj_no, StockAdjustment.deleted_at.is_(None)).limit(1)
        )
    ).first()
    if clash:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"Adjustment number {adj_no} already exists.")

    sign = 1.0 if payload.type == "Stock IN" else -1.0
    new_adj = StockAdjustment(
        adjustment_no=adj_no,
        adjustment_date=payload.adjustment_date,
        adjustment_dt=adjustment_dt,
        client_name=payload.client_name,
        invoice_no=payload.invoice_no,
        warehouse=payload.warehouse,
        type=payload.type,
        purpose=payload.purpose,
        total_amount=sum(li.amount for li in payload.items),
        created_by=getattr(current_user, "username", None) or "Admin User",
        remarks=payload.remarks,
    )
    db.add(new_adj)
    await db.flush()
    for item in payload.items:
        await stock_service.find_product(db, item.product_name, require_active=True)
        db.add(
            StockAdjustmentLineItem(
                adjustment_id=new_adj.id, product_name=item.product_name, product_code=item.product_code,
                category=item.category, hsn_code=item.hsn_code, gst_rate=item.gst_rate, quantity=item.qty,
                uom=item.uom, rate=item.rate, amount=item.amount,
            )
        )
        await stock_service.apply_stock_delta(db, product_name=item.product_name, warehouse_name=payload.warehouse, delta=sign * item.qty)
    await db.flush()
    await db.refresh(new_adj, attribute_names=["items"])
    return build_success_response(
        data=_adjustment_record(new_adj),
        message="Stock adjustment recorded and stock updated.",
        request_id=getattr(request.state, "request_id", "-"),
    )


@router.delete("/inventory/stock-adjustment/{adjustment_id}", summary="Delete a stock adjustment")
@router.delete("/adjustment/{adjustment_id}", summary="Alias to delete adjustment")
async def delete_stock_adjustment(
    adjustment_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    """Delete an adjustment AND reverse its stock effect, so the stock never keeps a movement that no longer exists.

    Reversing a Stock IN removes goods that may already have been sold: if that would drive a physical warehouse
    negative the delete is refused (409) -- same rule as everywhere else.
    """
    stmt = (
        select(StockAdjustment)
        .options(selectinload(StockAdjustment.items))
        .where(StockAdjustment.deleted_at.is_(None))
        .with_for_update()
    )
    try:
        stmt = stmt.where(StockAdjustment.id == uuid.UUID(adjustment_id))
    except ValueError:
        stmt = stmt.where(StockAdjustment.adjustment_no == adjustment_id)
    record = (await db.execute(stmt)).scalars().first()
    if record is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Adjustment record not found")
    undo = -1.0 if record.type == "Stock IN" else 1.0
    for li in record.items:
        await stock_service.apply_stock_delta(db, product_name=li.product_name, warehouse_name=record.warehouse, delta=undo * li.quantity)
    record.deleted_at = datetime.datetime.now(datetime.timezone.utc)
    await db.flush()
    return build_success_response(
        data={"deleted_id": adjustment_id},
        message="Stock adjustment deleted and its stock effect reversed.",
        request_id=getattr(request.state, "request_id", "-"),
    )


# ==============================================================================
# Stock Transfer Endpoints (Matches erp.inhymasolutions.com/transfer/list)
# ==============================================================================

@router.get("/inventory/stock-transfer", summary="List stock transfers")
@router.get("/transfer/list", summary="Legacy alias for stock transfer list")
async def list_stock_transfers(
    request: Request,
    status_filter: Optional[str] = Query(None, alias="status", description="Status filter (All, Pending, Confirmed, Received, Cancel)"),
    from_warehouse: Optional[str] = Query(None, description="Origin warehouse filter"),
    to_warehouse: Optional[str] = Query(None, description="Destination warehouse filter"),
    search: Optional[str] = Query(None, description="Search by transfer no, warehouse, or added by"),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=500),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    """Return paginated stock transfers from PostgreSQL database with tab counts breakdown."""
    try:
        base_stmt = select(StockTransfer).where(StockTransfer.deleted_at.is_(None))

        # Compute exact tab counts across all statuses for top pill tabs
        all_count = (await db.execute(select(func.count()).select_from(base_stmt.subquery()))).scalar() or 0
        pending_count = (await db.execute(
            select(func.count()).select_from(base_stmt.where(func.lower(StockTransfer.status) == "pending").subquery())
        )).scalar() or 0
        confirmed_count = (await db.execute(
            select(func.count()).select_from(base_stmt.where(func.lower(StockTransfer.status) == "confirmed").subquery())
        )).scalar() or 0
        received_count = (await db.execute(
            select(func.count()).select_from(base_stmt.where(func.lower(StockTransfer.status) == "received").subquery())
        )).scalar() or 0
        cancel_count = (await db.execute(
            select(func.count()).select_from(base_stmt.where(func.lower(StockTransfer.status) == "cancel").subquery())
        )).scalar() or 0

        tab_counts = {
            "all": all_count,
            "pending": pending_count,
            "confirmed": confirmed_count,
            "received": received_count,
            "cancel": cancel_count,
        }

        # Apply filtering
        query_stmt = base_stmt.options(selectinload(StockTransfer.items))
        if status_filter and status_filter.lower() != "all":
            query_stmt = query_stmt.where(func.lower(StockTransfer.status) == status_filter.strip().lower())
        if from_warehouse and from_warehouse != "All":
            query_stmt = query_stmt.where(func.lower(StockTransfer.from_warehouse) == from_warehouse.strip().lower())
        if to_warehouse and to_warehouse != "All":
            query_stmt = query_stmt.where(func.lower(StockTransfer.to_warehouse) == to_warehouse.strip().lower())
        if search:
            q = f"%{search.strip().lower()}%"
            query_stmt = query_stmt.where(
                or_(
                    func.lower(StockTransfer.transfer_no).ilike(q),
                    func.lower(StockTransfer.from_warehouse).ilike(q),
                    func.lower(StockTransfer.to_warehouse).ilike(q),
                    func.lower(StockTransfer.added_by).ilike(q),
                    func.lower(StockTransfer.transfer_date).ilike(q),
                )
            )

        total_stmt = select(func.count()).select_from(query_stmt.subquery())
        total_filtered = (await db.execute(total_stmt)).scalar() or 0

        # Sort descending by sr_no as per screenshot (52, 51, 50...)
        query_stmt = query_stmt.order_by(StockTransfer.sr_no.desc()).offset(skip).limit(limit)
        results = (await db.execute(query_stmt)).scalars().all()

        items = []
        for r in results:
            items.append({
                "id": str(r.id),
                "sr_no": r.sr_no,
                "transfer_no": r.transfer_no,
                "transfer_date": r.transfer_date,
                "from_warehouse": r.from_warehouse,
                "to_warehouse": r.to_warehouse,
                "total_amount": float(r.total_amount),
                "added_by": r.added_by,
                "status": r.status,
                "remarks": r.remarks,
                "items": [
                    {
                        "id": str(li.id),
                        "product_name": li.product_name,
                        "product_code": li.product_code,
                        "category": li.category,
                        "quantity": li.quantity,
                        "uom": li.uom,
                        "rate": li.rate,
                        "amount": li.amount,
                    }
                    for li in r.items
                ],
            })

        return build_success_response(
            data={"items": items, "tab_counts": tab_counts},
            meta={
                "total": total_filtered,
                "skip": skip,
                "limit": limit,
                "tab_counts": tab_counts,
            },
            request_id=getattr(request.state, "request_id", "-"),
        )
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to query stock transfers: {str(exc)}",
        )


@router.get("/inventory/stock-transfer/{transfer_id}", summary="Get stock transfer detail")
async def get_stock_transfer(
    transfer_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    """Fetch single stock transfer with line items."""
    stmt = (
        select(StockTransfer)
        .options(selectinload(StockTransfer.items))
        .where(StockTransfer.deleted_at.is_(None))
    )
    try:
        val_uuid = uuid.UUID(transfer_id)
        stmt = stmt.where(StockTransfer.id == val_uuid)
    except ValueError:
        if transfer_id.isdigit():
            stmt = stmt.where(StockTransfer.sr_no == int(transfer_id))
        else:
            stmt = stmt.where(StockTransfer.transfer_no == transfer_id)

    transfer = (await db.execute(stmt)).scalars().first()
    if not transfer:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Stock transfer record not found")

    return build_success_response(
        data={
            "id": str(transfer.id),
            "sr_no": transfer.sr_no,
            "transfer_no": transfer.transfer_no,
            "transfer_date": transfer.transfer_date,
            "from_warehouse": transfer.from_warehouse,
            "to_warehouse": transfer.to_warehouse,
            "total_amount": float(transfer.total_amount),
            "added_by": transfer.added_by,
            "status": transfer.status,
            "remarks": transfer.remarks,
            "items": [
                {
                    "id": str(li.id),
                    "product_name": li.product_name,
                    "product_code": li.product_code,
                    "category": li.category,
                    "quantity": li.quantity,
                    "uom": li.uom,
                    "rate": li.rate,
                    "amount": li.amount,
                }
                for li in transfer.items
            ],
        },
        request_id=getattr(request.state, "request_id", "-"),
    )


def _parse_wh_column(wh_name: str, prefer_transit: bool = False) -> tuple[str, str, bool]:
    """
    Returns (target_column, base_city, is_transit).
    Maps warehouse names to ProductStock columns.
    """
    w = (wh_name or "").strip().lower()
    is_transit = "transit" in w or prefer_transit
    if "ahmedabad" in w:
        city = "ahmedabad"
    elif "indore" in w:
        city = "indore"
    else:
        city = "mumbai"
    col = f"{city}_transit" if is_transit else city
    return col, city, is_transit


def _recompute_total_stock(prod: ProductStock) -> None:
    prod.total_qty = (
        (prod.ahmedabad or 0.0) + (prod.ahmedabad_transit or 0.0) + (prod.ahmedabad_ordered or 0.0)
        + (prod.mumbai or 0.0) + (prod.mumbai_transit or 0.0) + (prod.mumbai_ordered or 0.0)
        + (prod.indore or 0.0) + (prod.indore_transit or 0.0) + (prod.indore_ordered or 0.0)
    )


@router.post("/inventory/stock-transfer", status_code=status.HTTP_201_CREATED, summary="Create stock transfer")
async def create_stock_transfer(
    payload: StockTransferCreate,
    request: Request,
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    """Insert new stock transfer into PostgreSQL and update warehouse inventory."""
    from app.masters.products.models import Product
    from app.masters.warehouses.models import Warehouse

    for wh_label, wh_name in (("Origin warehouse", payload.from_warehouse), ("Destination warehouse", payload.to_warehouse)):
        if wh_name and wh_name.strip():
            wh_row = (
                await db.execute(
                    select(Warehouse).where(func.lower(Warehouse.name) == wh_name.strip().lower(), Warehouse.deleted_at.is_(None))
                )
            ).scalars().first()
            if wh_row is not None and wh_row.status != RecordStatus.ACTIVE:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"{wh_label} '{wh_name}' is inactive in the Warehouse Master.",
                )

    for item in payload.items:
        p_conds = [func.lower(Product.product_name) == item.product_name.strip().lower(), func.lower(Product.product_name_tally) == item.product_name.strip().lower()]
        if item.product_code and item.product_code.strip():
            p_conds.append(func.lower(Product.product_code) == item.product_code.strip().lower())
        prod_master = (
            await db.execute(select(Product).where(Product.deleted_at.is_(None), or_(*p_conds)))
        ).scalars().first()
        if prod_master is not None and prod_master.status != RecordStatus.ACTIVE:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Product '{item.product_name}' is inactive in the Product Master.",
            )

    calc_total = payload.total_amount or sum(item.amount for item in payload.items)

    count_stmt = select(func.count()).select_from(StockTransfer)
    total_existing = (await db.execute(count_stmt)).scalar() or 0
    next_sr = total_existing + 1
    transfer_no = f"TRF-2026-{next_sr:03d}"

    new_transfer = StockTransfer(
        sr_no=next_sr,
        transfer_no=transfer_no,
        transfer_date=payload.transfer_date,
        from_warehouse=payload.from_warehouse,
        to_warehouse=payload.to_warehouse,
        total_amount=calc_total,
        added_by=payload.added_by,
        status=payload.status,
        remarks=payload.remarks,
    )
    db.add(new_transfer)
    await db.flush()

    for item in payload.items:
        line = StockTransferLineItem(
            transfer_id=new_transfer.id,
            product_name=item.product_name,
            product_code=item.product_code,
            category=item.category,
            quantity=item.quantity,
            uom=item.uom,
            rate=item.rate,
            amount=item.amount,
        )
        db.add(line)

    # Inventory balances: Deduct origin stock and credit destination (transit or physical)
    from_wh_lower = (payload.from_warehouse or "").strip().lower()
    is_from_physical = "transit" not in from_wh_lower and "ordered" not in from_wh_lower

    from_col, from_city, _ = _parse_wh_column(payload.from_warehouse, prefer_transit=False)
    # If to_warehouse is explicitly transit OR transfer status is not "Received", allocate to transit
    to_col, to_city, _ = _parse_wh_column(payload.to_warehouse, prefer_transit=(payload.status != "Received"))

    for item in payload.items:
        prod_stmt = select(ProductStock).where(
            or_(
                func.lower(ProductStock.product_name_tally) == item.product_name.strip().lower(),
                func.lower(ProductStock.product_code) == (item.product_code or "").strip().lower(),
            ),
            ProductStock.deleted_at.is_(None),
        )
        prod_match = (await db.execute(prod_stmt)).scalars().first()
        avail = getattr(prod_match, from_col, 0.0) or 0.0 if prod_match else 0.0

        if is_from_physical:
            # Physical warehouse stock cannot be driven negative
            if avail - item.quantity < -1e-9:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Insufficient physical stock for '{item.product_name}' in {payload.from_warehouse}. Available: {avail}, Requested: {item.quantity}. Physical warehouse stock cannot be negative.",
                )

        if not prod_match:
            # Create a ProductStock entry on first use if missing (e.g. from transit transfer)
            prod_match = ProductStock(
                product_name_tally=item.product_name,
                product_code=item.product_code or "-",
                category=item.category or "Machines",
                uom=item.uom or "NOS",
                total_qty=0.0,
            )
            db.add(prod_match)
            await db.flush()

        # Deduct from origin (may go negative if transit or ordered warehouse)
        curr_from = getattr(prod_match, from_col, 0.0) or 0.0
        setattr(prod_match, from_col, curr_from - item.quantity)
        # Add to destination (transit or physical)
        dest_avail = getattr(prod_match, to_col, 0.0) or 0.0
        setattr(prod_match, to_col, dest_avail + item.quantity)
        _recompute_total_stock(prod_match)

    await db.flush()
    await db.refresh(new_transfer)

    return build_success_response(
        data={
            "id": str(new_transfer.id),
            "sr_no": new_transfer.sr_no,
            "transfer_no": new_transfer.transfer_no,
            "transfer_date": new_transfer.transfer_date,
            "from_warehouse": new_transfer.from_warehouse,
            "to_warehouse": new_transfer.to_warehouse,
            "total_amount": new_transfer.total_amount,
            "added_by": new_transfer.added_by,
            "status": new_transfer.status,
            "remarks": new_transfer.remarks,
            "items": [item.model_dump() for item in payload.items],
        },
        message="Stock transfer created successfully.",
        request_id=getattr(request.state, "request_id", "-"),
    )


@router.patch("/inventory/stock-transfer/{transfer_id}/status", summary="Update transfer status")
async def update_stock_transfer_status(
    transfer_id: str,
    payload: StockTransferUpdateStatus,
    request: Request,
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    """Update status of a transfer (e.g. Cancel or Received) with Downstream Sales check."""
    stmt = (
        select(StockTransfer)
        .options(selectinload(StockTransfer.items))
        .where(StockTransfer.deleted_at.is_(None))
    )
    try:
        val_uuid = uuid.UUID(transfer_id)
        stmt = stmt.where(StockTransfer.id == val_uuid)
    except ValueError:
        if transfer_id.isdigit():
            stmt = stmt.where(StockTransfer.sr_no == int(transfer_id))
        else:
            stmt = stmt.where(StockTransfer.transfer_no == transfer_id)

    record = (await db.execute(stmt)).scalars().first()
    if not record:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Transfer not found")

    old_status = record.status
    new_status = payload.status

    if old_status != new_status:
        to_transit_col, to_city, _ = _parse_wh_column(record.to_warehouse, prefer_transit=True)
        to_phys_col = to_city
        from_phys_col, from_city, _ = _parse_wh_column(record.from_warehouse, prefer_transit=False)

        # 1. Moving to "Received": transit -> physical main warehouse
        if new_status == "Received" and old_status != "Received":
            for item in record.items:
                prod_stmt = select(ProductStock).where(
                    or_(
                        func.lower(ProductStock.product_name_tally) == item.product_name.strip().lower(),
                        func.lower(ProductStock.product_code) == (item.product_code or "").strip().lower(),
                    ),
                    ProductStock.deleted_at.is_(None),
                )
                prod_match = (await db.execute(prod_stmt)).scalars().first()
                if prod_match:
                    # Deduct from transit
                    curr_transit = getattr(prod_match, to_transit_col, 0.0) or 0.0
                    setattr(prod_match, to_transit_col, max(0.0, curr_transit - item.quantity))
                    # Add to physical main warehouse
                    curr_phys = getattr(prod_match, to_phys_col, 0.0) or 0.0
                    setattr(prod_match, to_phys_col, curr_phys + item.quantity)
                    _recompute_total_stock(prod_match)

            # If to_warehouse had "Transit" in it, normalize to main warehouse
            if "transit" in record.to_warehouse.lower():
                record.to_warehouse = to_city.capitalize()

        # 2. Moving to "Cancel": reverse transfer with Downstream Sales Protection (Point 103)
        elif new_status == "Cancel" and old_status != "Cancel":
            for item in record.items:
                prod_stmt = select(ProductStock).where(
                    or_(
                        func.lower(ProductStock.product_name_tally) == item.product_name.strip().lower(),
                        func.lower(ProductStock.product_code) == (item.product_code or "").strip().lower(),
                    ),
                    ProductStock.deleted_at.is_(None),
                )
                prod_match = (await db.execute(prod_stmt)).scalars().first()
                if prod_match:
                    if old_status == "Received":
                        # Stock was in physical destination warehouse. Check for negative stock!
                        curr_dest = getattr(prod_match, to_phys_col, 0.0) or 0.0
                        if curr_dest < item.quantity:
                            raise HTTPException(
                                status_code=status.HTTP_400_BAD_REQUEST,
                                detail=(
                                    f"Cannot cancel transfer {record.transfer_no}: Product '{item.product_name}' "
                                    f"has already been sold or dispatched from {record.to_warehouse}. "
                                    f"Reversing would cause negative stock (Available: {curr_dest}, Transfer Qty: {item.quantity})."
                                ),
                            )
                        setattr(prod_match, to_phys_col, curr_dest - item.quantity)
                    else:
                        # Stock was in transit
                        curr_transit = getattr(prod_match, to_transit_col, 0.0) or 0.0
                        setattr(prod_match, to_transit_col, max(0.0, curr_transit - item.quantity))

                    # Return stock to origin physical warehouse
                    curr_from = getattr(prod_match, from_phys_col, 0.0) or 0.0
                    setattr(prod_match, from_phys_col, curr_from + item.quantity)
                    _recompute_total_stock(prod_match)

        record.status = new_status
        await db.flush()

    return build_success_response(
        data={"id": str(record.id), "status": record.status, "to_warehouse": record.to_warehouse},
        message=f"Transfer status updated to {record.status}.",
        request_id=getattr(request.state, "request_id", "-"),
    )


@router.post("/inventory/stock-transfer/{transfer_id}/receive-to-main", summary="Receive transit transfer into physical main warehouse")
async def receive_stock_transfer_to_main(
    transfer_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    """Explicitly converts transit transfer to Received in physical destination warehouse (Point 69)."""
    return await update_stock_transfer_status(
        transfer_id=transfer_id,
        payload=StockTransferUpdateStatus(status="Received"),
        request=request,
        db=db,
    )