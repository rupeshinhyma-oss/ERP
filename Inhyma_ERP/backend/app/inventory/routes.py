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
    limit: int = Query(50, ge=1, le=500),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    """Paginated product stock straight from the database -- never sample data.

    Filters are exact matches on indexed columns (the dropdown values come from the same data); the search box is a
    contains-search over name / code / brand / sub-category served by trigram indexes. A database error is an error
    (500) -- it is no longer replaced by made-up products.
    """
    stmt = select(ProductStock).where(ProductStock.deleted_at.is_(None))
    for column, value in ((ProductStock.category, category), (ProductStock.sub_category, sub_category), (ProductStock.brand, brand)):
        wanted = _text(value)
        if wanted and wanted.lower() not in ("all", "select"):
            stmt = stmt.where(column == wanted)

    flag = _text(negative_stock).lower()
    if flag == "yes":
        stmt = stmt.where(or_(*(getattr(ProductStock, c) < 0 for c in _NEGATIVE_CHECK_COLUMNS)))
    elif flag == "no":
        stmt = stmt.where(and_(*(getattr(ProductStock, c) >= 0 for c in _NEGATIVE_CHECK_COLUMNS)))

    wanted_status = _text(status_filter)
    if wanted_status and wanted_status.lower() not in ("all", "select"):
        stmt = stmt.where(ProductStock.status == wanted_status)
    if _text(search):
        stmt = stmt.where(
            or_(
                _contains(ProductStock.product_name_tally, search),
                _contains(ProductStock.product_code, search),
                _contains(ProductStock.brand, search),
                _contains(ProductStock.sub_category, search),
            )
        )

    total = (await db.execute(select(func.count()).select_from(stmt.order_by(None).subquery()))).scalar() or 0
    rows = (
        await db.execute(
            stmt.order_by(ProductStock.sr_no.asc().nulls_last(), ProductStock.created_at.desc(), ProductStock.id).offset(skip).limit(limit)
        )
    ).scalars().all()
    return build_success_response(
        data={"items": [_stock_item(r) for r in rows], "total": total, "skip": skip, "limit": limit},
        request_id=getattr(request.state, "request_id", "-"),
    )


# ==============================================================================
# Product Re-Order Endpoints
# ==============================================================================

@router.get("/inventory/product-reorder", summary="List product re-order table records")
@router.get("/product-reorder/list", summary="Alias for product re-order table records")
async def list_product_reorder(
    request: Request,
    category: Optional[str] = Query(None, description="Category filter"),
    sub_category: Optional[str] = Query(None, description="Sub-category filter"),
    brand: Optional[str] = Query(None, description="Brand filter"),
    shortfall: Optional[str] = Query(None, description="Short fall filter: 'All' | '0' | 'Greater Than 0'"),
    reorder: Optional[str] = Query(None, description="Re-order filter: 'All' | '0' | 'Greater Than 0'"),
    warehouse: Optional[str] = Query(None, description="Warehouse filter (not used)"),
    search: Optional[str] = Query(None, description="Search keyword"),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=500),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    """Re-order table: every product with its stock, short fall and the quantity to order.

    Real products only (no sample rows), filtered and paginated in SQL -- there is no 100-product cap any more.
    """
    from app.masters.products.models import Product

    ps = ProductStock
    total_qty = func.coalesce(ps.total_qty, 0.0)
    level = case((func.coalesce(ps.reorder_level, 0.0) > 0, ps.reorder_level), else_=func.coalesce(Product.reorder_level, 0.0))
    moq = case((func.coalesce(ps.minimum_order_quantity, 0.0) > 0, ps.minimum_order_quantity), else_=func.coalesce(Product.minimum_order_quantity, 0.0))
    short_fall = case((level > total_qty, level - total_qty), else_=0.0)

    stmt = (
        select(
            ps.id.label("stock_id"), Product.id.label("prod_id"), ps.sr_no.label("sr_no"),
            func.coalesce(ps.product_name_tally, Product.product_name_tally).label("name"),
            func.coalesce(ps.product_code, Product.product_code, "-").label("code"),
            func.coalesce(ps.brand, "-").label("brand"), func.coalesce(ps.category, "-").label("category"),
            func.coalesce(ps.sub_category, "-").label("sub_category"),
            func.coalesce(ps.mumbai, 0.0).label("mumbai"), func.coalesce(ps.mumbai_transit, 0.0).label("mumbai_transit"),
            func.coalesce(ps.mumbai_ordered, 0.0).label("mumbai_ordered"), func.coalesce(ps.ahmedabad, 0.0).label("ahmedabad"),
            func.coalesce(ps.ahmedabad_transit, 0.0).label("ahmedabad_transit"), func.coalesce(ps.ahmedabad_ordered, 0.0).label("ahmedabad_ordered"),
            func.coalesce(ps.indore, 0.0).label("indore"), func.coalesce(ps.indore_transit, 0.0).label("indore_transit"),
            func.coalesce(ps.indore_ordered, 0.0).label("indore_ordered"),
            total_qty.label("total_qty"), level.label("reorder_level"), moq.label("moq"), short_fall.label("short_fall"),
        )
        .select_from(Product)
        .outerjoin(ps, and_(ps.product_id == Product.id, ps.deleted_at.is_(None)))
        .where(Product.deleted_at.is_(None))
    )
    for column, value in ((ps.category, category), (ps.sub_category, sub_category), (ps.brand, brand)):
        wanted = _text(value)
        if wanted and wanted.lower() not in ("all", "select"):
            stmt = stmt.where(column == wanted)
    sf = _text(shortfall).lower()
    if sf == "0":
        stmt = stmt.where(short_fall == 0)
    elif sf in ("greater than 0", ">0", "gt0"):
        stmt = stmt.where(short_fall > 0)
    ro = _text(reorder).lower()
    if ro == "0":
        stmt = stmt.where(level == 0)
    elif ro in ("greater than 0", ">0", "gt0"):
        stmt = stmt.where(level > 0)
    if _text(search):
        stmt = stmt.where(
            or_(_contains(func.coalesce(ps.product_name_tally, Product.product_name_tally), search),
                _contains(func.coalesce(ps.product_code, Product.product_code), search),
                _contains(ps.brand, search), _contains(ps.sub_category, search))
        )

    total = (await db.execute(select(func.count()).select_from(stmt.order_by(None).subquery()))).scalar() or 0
    rows = (await db.execute(stmt.order_by(short_fall.desc(), Product.product_name_tally, Product.id).offset(skip).limit(limit))).all()
    items = []
    for idx, r in enumerate(rows, start=skip + 1):
        order_to_place = (max(r.short_fall, r.moq) if r.moq > 0 else r.short_fall) if r.short_fall > 0 else 0.0
        items.append({
            "id": str(r.stock_id or r.prod_id), "sr_no": idx, "product_id": str(r.prod_id) if r.prod_id else None,
            "product_name_tally": r.name, "product_code": r.code, "brand": r.brand, "category": r.category,
            "sub_category": r.sub_category, "mumbai": float(r.mumbai), "mumbai_transit": float(r.mumbai_transit),
            "mumbai_ordered": float(r.mumbai_ordered), "ahmedabad": float(r.ahmedabad),
            "ahmedabad_transit": float(r.ahmedabad_transit), "ahmedabad_ordered": float(r.ahmedabad_ordered),
            "indore": float(r.indore), "indore_transit": float(r.indore_transit), "indore_ordered": float(r.indore_ordered),
            "total_qty": float(r.total_qty), "reorder_level": float(r.reorder_level), "moq": float(r.moq),
            "minimum_order_quantity": float(r.moq), "short_fall": float(r.short_fall), "order_to_be_place": float(order_to_place),
        })
    return build_success_response(
        data={"items": items, "total": total, "skip": skip, "limit": limit},
        request_id=getattr(request.state, "request_id", "-") if request and hasattr(request, "state") else "-",
    )


@router.patch("/inventory/product-reorder/{product_id}", summary="Update reorder level and MOQ for product")
async def update_product_reorder(
    product_id: str,
    payload: ProductReorderUpdateSchema,
    request: Request,
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    """Update reorder level and MOQ on the product and its stock row. 404 when no such product exists."""
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
    for target in (product, stock):
        if target is None:
            continue
        if payload.reorder_level is not None:
            target.reorder_level = payload.reorder_level
        if payload.minimum_order_quantity is not None:
            target.minimum_order_quantity = payload.minimum_order_quantity
    await db.flush()
    return build_success_response(
        data={
            "updated": True, "product_id": clean_id, "reorder_level": payload.reorder_level, "moq": payload.minimum_order_quantity,
            "minimum_order_quantity": payload.minimum_order_quantity,
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
    * transit / ordered: the import consignments still on the way (pending / confirmed) into "<City> Transit" /
      "<City> Ordered" -- received and cancelled ones are history, and the other warehouses of the city are not mixed in.
    The product is matched by its exact name and the warehouse by its exact name (no substring matching).
    """
    clean_p = product_name.strip()
    clean_w = warehouse.strip()
    stock_type = type.strip().lower()
    if stock_type not in ("physical", "transit", "ordered"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="type must be physical, transit or ordered")
    all_warehouses = clean_w.lower() == "all"
    items: list[dict] = []

    if stock_type == "physical":
        from app.sales.models import SaleOrder, SaleOrderItem

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
                "order_no": so.order_no,
                "order_date": so.order_date or "-",
                "company_name": so.company_name or so.buyer_name or "-",
                "gst_no": getattr(so, "gst_no", None),
                "city_state": ", ".join(filter(None, [so.city, so.state])) or "-",
                "quantity": so_item.quantity,
                "status": (so.status or "pending").replace("_", " ").title(),
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
        results = (await db.execute(stmt.order_by(ImportPurchase.created_at.desc()).limit(500))).all()
        for idx, (ip, ip_item) in enumerate(results, start=1):
            items.append({
                "sr_no": idx,
                "consignment_no": ip.consignment_no,
                "invoice_no": ip.consignment_no,
                "date": str(ip.invoice_date or ip.ordered_date or "-"),
                "supplier_name": ip.supplier_name or "-",
                "quantity": ip_item.quantity,
                "arrival_date": str(ip.expected_arrival_date or ip.eta_port_date or ip.ordered_date or "-"),
                "status": (ip.status or stock_type).replace("_", " ").title(),
                "warehouse": ip.warehouse or target_warehouse,
                "invoice_date": str(ip.invoice_date or "-"),
                "expected_arrival_date": str(ip.expected_arrival_date or "-"),
                "etd_origin_date": str(ip.etd_origin_date or "-"),
                "eta_port_date": str(ip.eta_port_date or "-"),
            })

    return build_success_response(
        data={"product_name": clean_p, "warehouse": clean_w, "stock_type": stock_type, "items": items},
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


@router.get("/inventory/product-stock/{stock_id}", summary="Get product stock details by ID")
async def get_product_stock(stock_id: str, request: Request, db: AsyncSession = Depends(get_db_session)) -> dict:
    """Single product stock entry (by id, product code or exact name)."""
    stmt = select(ProductStock).where(ProductStock.deleted_at.is_(None))
    try:
        stmt = stmt.where(ProductStock.id == uuid.UUID(stock_id))
    except ValueError:
        stmt = stmt.where(or_(ProductStock.product_code == stock_id, func.lower(ProductStock.product_name_tally) == stock_id.lower()))
    r = (await db.execute(stmt)).scalars().first()
    if r is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Stock record not found")
    return build_success_response(data=_stock_item(r), request_id=getattr(request.state, "request_id", "-"))


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
    await stock_service.get_warehouse(db, payload.warehouse)  # unknown warehouse -> 400 before anything is written

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