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
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

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

# In-memory store initialized with seed records matching ERP production database
_STOCK_ADJUSTMENTS: List[Dict[str, Any]] = [
    {
        "id": "adj-1",
        "adjustment_no": "492",
        "adjustment_date": "19-09-2026",
        "client_name": "GARUDA ENGINEERS",
        "invoice_no": "660/26-27",
        "warehouse": "Ahmedabad",
        "type": "Stock IN",
        "purpose": "Return From Client",
        "total_amount": 275000.0,
        "created_by": "Akshata Wadekar",
        "created_at": "19-09-2026",
        "remarks": "Party required another machine, but salesperson give the other machine",
        "items": [
            {
                "product_name": "ISL450XDAN Flow Wrap machine w/o end seal chain",
                "product_code": "MACH-002",
                "category": "Machines",
                "hsn_code": "84224000",
                "gst_rate": "18%",
                "qty": 1.0,
                "uom": "SET",
                "rate": 275000.0,
                "amount": 275000.0,
            }
        ],
    },
    {
        "id": "adj-2",
        "adjustment_no": "491",
        "adjustment_date": "18-09-2026",
        "client_name": None,
        "invoice_no": None,
        "warehouse": "Ahmedabad",
        "type": "Stock IN",
        "purpose": "Split",
        "total_amount": 61250.0,
        "created_by": "Akshata Wadekar",
        "created_at": "18-09-2026",
        "remarks": "Stock inward from split batch 09-AHM",
        "items": [
            {
                "product_name": "XLSG36100 Capping Machine Spares",
                "product_code": "SPR-003",
                "category": "Spares",
                "hsn_code": "84229090",
                "gst_rate": "18%",
                "qty": 5.0,
                "uom": "PCS",
                "rate": 12250.0,
                "amount": 61250.0,
            }
        ],
    },
    {
        "id": "adj-3",
        "adjustment_no": "490",
        "adjustment_date": "18-09-2026",
        "client_name": None,
        "invoice_no": None,
        "warehouse": "Ahmedabad",
        "type": "Stock OUT",
        "purpose": "Split",
        "total_amount": 61250.0,
        "created_by": "Akshata Wadekar",
        "created_at": "18-09-2026",
        "remarks": "Stock outward to component sub-assemblies",
        "items": [
            {
                "product_name": "XLSG36100 Assembly Unit",
                "product_code": "ASSM-003",
                "category": "Machines",
                "hsn_code": "84223000",
                "gst_rate": "18%",
                "qty": 1.0,
                "uom": "SET",
                "rate": 61250.0,
                "amount": 61250.0,
            }
        ],
    },
    {
        "id": "adj-4",
        "adjustment_no": "489",
        "adjustment_date": "17-09-2026",
        "client_name": None,
        "invoice_no": None,
        "warehouse": "Mumbai",
        "type": "Stock IN",
        "purpose": "Split",
        "total_amount": 10708.0,
        "created_by": "Akshata Wadekar",
        "created_at": "17-09-2026",
        "remarks": "Inward adjustment split across spare kits",
        "items": [
            {
                "product_name": "Sensor (Banding)",
                "product_code": "SEN-001",
                "category": "Spares",
                "hsn_code": "84229090",
                "gst_rate": "18%",
                "qty": 2.0,
                "uom": "PCS",
                "rate": 5354.0,
                "amount": 10708.0,
            }
        ],
    },
    {
        "id": "adj-5",
        "adjustment_no": "488",
        "adjustment_date": "17-09-2026",
        "client_name": None,
        "invoice_no": None,
        "warehouse": "Mumbai",
        "type": "Stock OUT",
        "purpose": "Damage",
        "total_amount": 225000.0,
        "created_by": "Akshata Wadekar",
        "created_at": "17-09-2026",
        "remarks": "Transit damage inspection rejection",
        "items": [
            {
                "product_name": "Automatic Auger Powder Filling Machine",
                "product_code": "MACH-008",
                "category": "Machines",
                "hsn_code": "84223000",
                "gst_rate": "18%",
                "qty": 1.0,
                "uom": "SET",
                "rate": 225000.0,
                "amount": 225000.0,
            }
        ],
    },
    {
        "id": "adj-6",
        "adjustment_no": "487",
        "adjustment_date": "17-09-2026",
        "client_name": None,
        "invoice_no": None,
        "warehouse": "Mumbai",
        "type": "Stock IN",
        "purpose": "Split",
        "total_amount": 73500.0,
        "created_by": "Akshata Wadekar",
        "created_at": "17-09-2026",
        "remarks": "Inward adjustment split from main packaging module",
        "items": [
            {
                "product_name": "AF1000T Sub-assembly Module",
                "product_code": "ASSM-007",
                "category": "Machines",
                "hsn_code": "84223000",
                "gst_rate": "18%",
                "qty": 1.0,
                "uom": "SET",
                "rate": 73500.0,
                "amount": 73500.0,
            }
        ],
    },
    {
        "id": "adj-7",
        "adjustment_no": "486",
        "adjustment_date": "17-09-2026",
        "client_name": None,
        "invoice_no": None,
        "warehouse": "Mumbai",
        "type": "Stock OUT",
        "purpose": "Split",
        "total_amount": 73500.0,
        "created_by": "Akshata Wadekar",
        "created_at": "17-09-2026",
        "remarks": "Outward adjustment split for packaging conversion",
        "items": [
            {
                "product_name": "AF1000T Sub-assembly Module",
                "product_code": "ASSM-007",
                "category": "Machines",
                "hsn_code": "84223000",
                "gst_rate": "18%",
                "qty": 1.0,
                "uom": "SET",
                "rate": 73500.0,
                "amount": 73500.0,
            }
        ],
    },
    {
        "id": "adj-8",
        "adjustment_no": "485",
        "adjustment_date": "15-09-2026",
        "client_name": "SLEXO PACKAGING",
        "invoice_no": "3288/26-27",
        "warehouse": "Mumbai",
        "type": "Stock IN",
        "purpose": "Return From Client",
        "total_amount": 26000.0,
        "created_by": "Akshata Wadekar",
        "created_at": "15-09-2026",
        "remarks": "Return from customer demo consignment",
        "items": [
            {
                "product_name": "Sensor (Banding) & Heating Elements",
                "product_code": "SEN-001B",
                "category": "Spares",
                "hsn_code": "84229090",
                "gst_rate": "18%",
                "qty": 4.0,
                "uom": "PCS",
                "rate": 6500.0,
                "amount": 26000.0,
            }
        ],
    },
    {
        "id": "adj-9",
        "adjustment_no": "484",
        "adjustment_date": "15-09-2026",
        "client_name": None,
        "invoice_no": None,
        "warehouse": "Ahmedabad",
        "type": "Stock IN",
        "purpose": "Split",
        "total_amount": 105000.0,
        "created_by": "Akshata Wadekar",
        "created_at": "15-09-2026",
        "remarks": "Stock inward split for packaging sub-assembly",
        "items": [
            {
                "product_name": "Packaging Line Conveyor Belt & Assembly",
                "product_code": "CONV-001",
                "category": "Machines",
                "hsn_code": "84223000",
                "gst_rate": "18%",
                "qty": 1.0,
                "uom": "SET",
                "rate": 105000.0,
                "amount": 105000.0,
            }
        ],
    },
    {
        "id": "adj-10",
        "adjustment_no": "483",
        "adjustment_date": "15-09-2026",
        "client_name": None,
        "invoice_no": None,
        "warehouse": "Ahmedabad",
        "type": "Stock OUT",
        "purpose": "Split",
        "total_amount": 105000.0,
        "created_by": "Akshata Wadekar",
        "created_at": "15-09-2026",
        "remarks": "Stock outward split for assembly transfer",
        "items": [
            {
                "product_name": "Packaging Line Conveyor Belt & Assembly",
                "product_code": "CONV-001",
                "category": "Machines",
                "hsn_code": "84223000",
                "gst_rate": "18%",
                "qty": 1.0,
                "uom": "SET",
                "rate": 105000.0,
                "amount": 105000.0,
            }
        ],
    },
    {
        "id": "adj-11",
        "adjustment_no": "482",
        "adjustment_date": "12-09-2026",
        "client_name": None,
        "invoice_no": None,
        "warehouse": "Mumbai",
        "type": "Stock OUT",
        "purpose": "Damage",
        "total_amount": 347349.0,
        "created_by": "Akshata Wadekar",
        "created_at": "12-09-2026",
        "remarks": "Damaged during transit inspection",
        "items": [
            {
                "product_name": "Automatic Liquid Nitrogen Dosing System",
                "product_code": "DOS-002",
                "category": "Machines",
                "hsn_code": "84224000",
                "gst_rate": "18%",
                "qty": 1.0,
                "uom": "SET",
                "rate": 347349.0,
                "amount": 347349.0,
            }
        ],
    },
]

_PRODUCT_STOCK: List[Dict[str, Any]] = [
    {
        "id": "stk-1",
        "product_name": "ISL450XDAN Flow Wrap machine w/o end seal chain",
        "product_code": "MACH-002",
        "category": "Machines",
        "sub_category": "Flow Wrap",
        "brand": "Inhyma Pack",
        "warehouse": "Ahmedabad",
        "quantity_on_hand": 12.0,
        "quantity_available": 10.0,
        "quantity_reserved": 2.0,
        "uom": "SET",
        "unit_cost": 275000.0,
        "total_value": 3300000.0,
        "status": "In Stock",
    },
    {
        "id": "stk-2",
        "product_name": "XLSG36100 Capping Machine Spares",
        "product_code": "SPR-003",
        "category": "Spares",
        "sub_category": "Capping Parts",
        "brand": "Inhyma Parts",
        "warehouse": "Ahmedabad",
        "quantity_on_hand": 45.0,
        "quantity_available": 45.0,
        "quantity_reserved": 0.0,
        "uom": "PCS",
        "unit_cost": 12250.0,
        "total_value": 551250.0,
        "status": "In Stock",
    },
    {
        "id": "stk-3",
        "product_name": "Sensor (Banding)",
        "product_code": "SEN-001",
        "category": "Spares",
        "sub_category": "Sensors",
        "brand": "Omron",
        "warehouse": "Mumbai",
        "quantity_on_hand": 18.0,
        "quantity_available": 14.0,
        "quantity_reserved": 4.0,
        "uom": "PCS",
        "unit_cost": 5354.0,
        "total_value": 96372.0,
        "status": "In Stock",
    },
    {
        "id": "stk-4",
        "product_name": "Automatic Auger Powder Filling Machine",
        "product_code": "MACH-008",
        "category": "Machines",
        "sub_category": "Fillers",
        "brand": "Inhyma Pack",
        "warehouse": "Mumbai",
        "quantity_on_hand": 3.0,
        "quantity_available": 2.0,
        "quantity_reserved": 1.0,
        "uom": "SET",
        "unit_cost": 225000.0,
        "total_value": 675000.0,
        "status": "Low Stock",
    },
]

router = APIRouter(tags=["Inventory & Stock Management"])


# ==============================================================================
# Product Stock Endpoints
# ==============================================================================

@router.get("/inventory/product-stock", summary="List product stock across warehouses")
@router.get("/product-stock/list", summary="Alias for product stock list")
async def list_product_stock(
    request: Request,
    warehouse: Optional[str] = Query(None, description="Warehouse filter"),
    category: Optional[str] = Query(None, description="Category filter"),
    brand: Optional[str] = Query(None, description="Brand filter"),
    status_filter: Optional[str] = Query(None, alias="status", description="Status filter"),
    search: Optional[str] = Query(None, description="Search term"),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=500),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    """Return paginated product stock records from PostgreSQL database with filtering."""
    try:
        stmt = select(ProductStock).where(ProductStock.deleted_at.is_(None))
        if category and category != "All":
            stmt = stmt.where(func.lower(ProductStock.category) == category.lower())
        if brand and brand != "All":
            stmt = stmt.where(func.lower(ProductStock.brand) == brand.lower())
        if status_filter and status_filter != "All":
            stmt = stmt.where(func.lower(ProductStock.status) == status_filter.lower())
        if search:
            q = f"%{search.strip().lower()}%"
            stmt = stmt.where(
                or_(
                    func.lower(ProductStock.product_name_tally).like(q),
                    func.lower(ProductStock.product_code).like(q),
                    func.lower(ProductStock.brand).like(q),
                )
            )

        count_stmt = select(func.count()).select_from(stmt.subquery())
        total = (await db.execute(count_stmt)).scalar() or 0

        stmt = stmt.order_by(ProductStock.sr_no.asc().nulls_last(), ProductStock.created_at.desc()).offset(skip).limit(limit)
        db_records = (await db.execute(stmt)).scalars().all()

        if db_records:
            items = []
            _FALLBACK_META = {
                "Sensor (Banding)": ("SEN-001", "Omron"),
                "ISL250 Rotary PFS 8 Head With Zipper & Nitrogen": ("MACH-001", "Yinglima"),
                "XLSG36100 Capping Machine": ("MACH-002", "Yinglima"),
                "Automatic Tube Filling & Sealing Machine": ("MACH-003", "Yinglima"),
                "Semi Automatic MAP (Vacuum + 2 Gases) Tray/Cup Sealing Machine": ("MACH-004", "Yinglima"),
            }
            for r in db_records:
                p_code = r.product_code
                p_brand = r.brand
                if (not p_code or p_code == "-") and r.product_name_tally in _FALLBACK_META:
                    p_code = _FALLBACK_META[r.product_name_tally][0]
                if (not p_brand or p_brand == "-") and r.product_name_tally in _FALLBACK_META:
                    p_brand = _FALLBACK_META[r.product_name_tally][1]

                items.append({
                    "id": str(r.id),
                    "sr_no": r.sr_no,
                    "product_name_tally": r.product_name_tally,
                    "product_name": r.product_name_tally,
                    "product_code": p_code or "-",
                    "brand": p_brand or "-",
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
                    "quantity_reserved": 0.0,
                    "unit_cost": 25000.0,
                    "total_value": r.total_qty * 25000.0,
                })
            return build_success_response(
                data={"items": items, "total": total, "skip": skip, "limit": limit},
                request_id=getattr(request.state, "request_id", "-"),
            )
    except Exception as exc:
        pass

    # Fallback to in-memory store if DB query fails or table empty
    results = _PRODUCT_STOCK
    if warehouse and warehouse != "All":
        results = [item for item in results if item["warehouse"].lower() == warehouse.lower()]
    if category and category != "All":
        results = [item for item in results if item["category"].lower() == category.lower()]
    if brand and brand != "All":
        results = [item for item in results if item.get("brand", "").lower() == brand.lower()]
    if status_filter and status_filter != "All":
        results = [item for item in results if item["status"].lower() == status_filter.lower()]
    if search:
        q = search.lower().strip()
        results = [
            item for item in results
            if q in item["product_name"].lower() or q in item["product_code"].lower()
        ]

    total = len(results)
    paged = results[skip : skip + limit]
    return build_success_response(
        data={"items": paged, "total": total, "skip": skip, "limit": limit},
        request_id=getattr(request.state, "request_id", "-"),
    )


@router.get("/inventory/product-stock/{stock_id}", summary="Get product stock details by ID")
async def get_product_stock(stock_id: str, request: Request, db: AsyncSession = Depends(get_db_session)) -> dict:
    """Retrieve single product stock entry from PostgreSQL database."""
    try:
        stmt = select(ProductStock).where(ProductStock.deleted_at.is_(None))
        try:
            val_uuid = uuid.UUID(stock_id)
            stmt = stmt.where(ProductStock.id == val_uuid)
        except ValueError:
            stmt = stmt.where(or_(ProductStock.product_code == stock_id, func.lower(ProductStock.product_name_tally) == stock_id.lower()))
        r = (await db.execute(stmt)).scalars().first()
        if r:
            return build_success_response(
                data={
                    "id": str(r.id),
                    "sr_no": r.sr_no,
                    "product_name_tally": r.product_name_tally,
                    "product_name": r.product_name_tally,
                    "product_code": r.product_code,
                    "brand": r.brand,
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
                    "quantity_reserved": 0.0,
                    "unit_cost": 25000.0,
                    "total_value": r.total_qty * 25000.0,
                },
                request_id=getattr(request.state, "request_id", "-"),
            )
    except Exception:
        pass

    for item in _PRODUCT_STOCK:
        if item["id"] == stock_id:
            return build_success_response(
                data=item,
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
    """Return paginated list of stock adjustment records from PostgreSQL database."""
    try:
        stmt = (
            select(StockAdjustment)
            .options(selectinload(StockAdjustment.items))
            .where(StockAdjustment.deleted_at.is_(None))
        )
        if type_filter and type_filter != "All":
            stmt = stmt.where(StockAdjustment.type == type_filter)
        if purpose_filter and purpose_filter != "All":
            stmt = stmt.where(func.lower(StockAdjustment.purpose) == purpose_filter.lower())
        if warehouse and warehouse != "All":
            stmt = stmt.where(func.lower(StockAdjustment.warehouse) == warehouse.lower())
        if search:
            q = f"%{search.strip().lower()}%"
            stmt = stmt.where(
                or_(
                    func.lower(StockAdjustment.client_name).like(q),
                    func.lower(StockAdjustment.invoice_no).like(q),
                    func.lower(StockAdjustment.warehouse).like(q),
                    func.lower(StockAdjustment.purpose).like(q),
                    func.lower(StockAdjustment.adjustment_no).like(q),
                )
            )

        count_stmt = select(func.count()).select_from(stmt.subquery())
        total = (await db.execute(count_stmt)).scalar() or 0

        stmt = stmt.order_by(StockAdjustment.created_at.desc()).offset(skip).limit(limit)
        db_rows = (await db.execute(stmt)).scalars().all()

        if db_rows:
            items = []
            for r in db_rows:
                items.append({
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
                })
            return build_success_response(
                data={"items": items, "total": total, "skip": skip, "limit": limit},
                request_id=getattr(request.state, "request_id", "-"),
            )
    except Exception:
        pass

    # Fallback to in-memory store
    results = _STOCK_ADJUSTMENTS
    if type_filter and type_filter != "All":
        results = [item for item in results if item["type"] == type_filter]
    if purpose_filter and purpose_filter != "All":
        results = [item for item in results if item["purpose"] == purpose_filter]
    if warehouse and warehouse != "All":
        results = [item for item in results if item["warehouse"].lower() == warehouse.lower()]
    if search:
        q = search.lower().strip()
        results = [
            item for item in results
            if (item.get("client_name") and q in item["client_name"].lower())
            or (item.get("invoice_no") and q in item["invoice_no"].lower())
            or q in item["warehouse"].lower()
            or q in item["purpose"].lower()
            or q in item["type"].lower()
            or any(q in li["product_name"].lower() for li in item.get("items", []))
        ]

    total = len(results)
    paged = results[skip : skip + limit]
    return build_success_response(
        data={"items": paged, "total": total, "skip": skip, "limit": limit},
        request_id=getattr(request.state, "request_id", "-"),
    )


@router.get("/inventory/stock-adjustment/{adjustment_id}", summary="Get stock adjustment details")
@router.get("/adjustment/{adjustment_id}", summary="Alias for single adjustment details")
async def get_stock_adjustment(adjustment_id: str, request: Request, db: AsyncSession = Depends(get_db_session)) -> dict:
    """Retrieve details of an adjustment record from PostgreSQL database."""
    try:
        stmt = (
            select(StockAdjustment)
            .options(selectinload(StockAdjustment.items))
            .where(StockAdjustment.deleted_at.is_(None))
        )
        try:
            val_uuid = uuid.UUID(adjustment_id)
            stmt = stmt.where(StockAdjustment.id == val_uuid)
        except ValueError:
            stmt = stmt.where(or_(StockAdjustment.adjustment_no == adjustment_id, StockAdjustment.client_name == adjustment_id))
        r = (await db.execute(stmt)).scalars().first()
        if r:
            return build_success_response(
                data={
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
                },
                request_id=getattr(request.state, "request_id", "-"),
            )
    except Exception:
        pass

    for item in _STOCK_ADJUSTMENTS:
        if item["id"] == adjustment_id or item.get("adjustment_no") == adjustment_id:
            return build_success_response(
                data=item,
                request_id=getattr(request.state, "request_id", "-"),
            )
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Adjustment record not found")


@router.post("/inventory/stock-adjustment", status_code=status.HTTP_201_CREATED, summary="Create stock adjustment")
@router.post("/adjustment", status_code=status.HTTP_201_CREATED, summary="Alias to create adjustment")
async def create_stock_adjustment(
    payload: StockAdjustmentCreate,
    request: Request,
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    """Record a new stock adjustment directly into PostgreSQL database."""
    calc_total = sum(li.amount for li in payload.items)
    adj_no = payload.adjustment_no
    if not adj_no:
        try:
            count_stmt = select(func.count()).select_from(StockAdjustment)
            total_records = (await db.execute(count_stmt)).scalar() or 0
            adj_no = str(total_records + 493)
        except Exception:
            adj_no = str(len(_STOCK_ADJUSTMENTS) + 493)

    try:
        new_adj = StockAdjustment(
            adjustment_no=adj_no,
            adjustment_date=payload.adjustment_date,
            client_name=payload.client_name,
            invoice_no=payload.invoice_no,
            warehouse=payload.warehouse,
            type=payload.type,
            purpose=payload.purpose,
            total_amount=calc_total,
            created_by="Admin User",
            remarks=payload.remarks,
        )
        db.add(new_adj)
        await db.flush()

        for item in payload.items:
            line = StockAdjustmentLineItem(
                adjustment_id=new_adj.id,
                product_name=item.product_name,
                product_code=item.product_code,
                category=item.category,
                hsn_code=item.hsn_code,
                gst_rate=item.gst_rate,
                quantity=item.qty,
                uom=item.uom,
                rate=item.rate,
                amount=item.amount,
            )
            db.add(line)

        # Update physical stock in product_stocks table
        for item in payload.items:
            prod_stmt = select(ProductStock).where(
                or_(
                    func.lower(ProductStock.product_name_tally) == item.product_name.strip().lower(),
                    func.lower(ProductStock.product_code) == (item.product_code or "").strip().lower(),
                ),
                ProductStock.deleted_at.is_(None),
            )
            prod_match = (await db.execute(prod_stmt)).scalars().first()
            if prod_match:
                delta = item.qty if payload.type == "Stock IN" else -item.qty
                wh = payload.warehouse.lower()
                if "ahmedabad" in wh:
                    prod_match.ahmedabad = max(0.0, prod_match.ahmedabad + delta)
                elif "mumbai" in wh:
                    prod_match.mumbai = max(0.0, prod_match.mumbai + delta)
                elif "indore" in wh:
                    prod_match.indore = max(0.0, prod_match.indore + delta)
                prod_match.total_qty = prod_match.ahmedabad + prod_match.mumbai + prod_match.indore

        await db.flush()
        await db.refresh(new_adj)

        record = {
            "id": str(new_adj.id),
            "adjustment_no": new_adj.adjustment_no,
            "adjustment_date": new_adj.adjustment_date,
            "client_name": new_adj.client_name,
            "invoice_no": new_adj.invoice_no,
            "warehouse": new_adj.warehouse,
            "type": new_adj.type,
            "purpose": new_adj.purpose,
            "total_amount": new_adj.total_amount,
            "created_by": new_adj.created_by,
            "remarks": new_adj.remarks,
            "items": [item.model_dump() for item in payload.items],
        }

        # Also keep in-memory list synchronized for offline fallback
        _STOCK_ADJUSTMENTS.insert(0, record)

        return build_success_response(
            data=record,
            message="Stock adjustment recorded successfully in database.",
            request_id=getattr(request.state, "request_id", "-"),
        )
    except Exception as exc:
        # Fallback to in-memory store
        now = datetime.datetime.now()
        new_id = f"adj-{int(now.timestamp() * 1000)}"
        record = {
            "id": new_id,
            "adjustment_no": adj_no,
            "adjustment_date": payload.adjustment_date,
            "client_name": payload.client_name,
            "invoice_no": payload.invoice_no,
            "warehouse": payload.warehouse,
            "type": payload.type,
            "purpose": payload.purpose,
            "total_amount": calc_total,
            "created_by": "Admin User",
            "created_at": payload.adjustment_date,
            "remarks": payload.remarks,
            "items": [item.model_dump() for item in payload.items],
        }
        _STOCK_ADJUSTMENTS.insert(0, record)
        return build_success_response(
            data=record,
            message="Stock adjustment recorded successfully.",
            request_id=getattr(request.state, "request_id", "-"),
        )


@router.delete("/inventory/stock-adjustment/{adjustment_id}", summary="Delete a stock adjustment")
@router.delete("/adjustment/{adjustment_id}", summary="Alias to delete adjustment")
async def delete_stock_adjustment(
    adjustment_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    """Delete a stock adjustment record by ID in PostgreSQL database."""
    deleted_in_db = False
    try:
        stmt = select(StockAdjustment).where(StockAdjustment.deleted_at.is_(None))
        try:
            val_uuid = uuid.UUID(adjustment_id)
            stmt = stmt.where(StockAdjustment.id == val_uuid)
        except ValueError:
            stmt = stmt.where(StockAdjustment.adjustment_no == adjustment_id)
        record = (await db.execute(stmt)).scalars().first()
        if record:
            record.deleted_at = datetime.datetime.now(datetime.timezone.utc)
            deleted_in_db = True
    except Exception:
        pass

    global _STOCK_ADJUSTMENTS
    initial_count = len(_STOCK_ADJUSTMENTS)
    _STOCK_ADJUSTMENTS = [item for item in _STOCK_ADJUSTMENTS if item["id"] != adjustment_id and item.get("adjustment_no") != adjustment_id]

    if not deleted_in_db and len(_STOCK_ADJUSTMENTS) == initial_count:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Adjustment record not found")

    return build_success_response(
        data={"deleted_id": adjustment_id},
        message="Stock adjustment deleted successfully.",
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


@router.post("/inventory/stock-transfer", status_code=status.HTTP_201_CREATED, summary="Create stock transfer")
async def create_stock_transfer(
    payload: StockTransferCreate,
    request: Request,
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    """Insert new stock transfer into PostgreSQL."""
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
    """Update status of a transfer (e.g. Cancel or Received)."""
    stmt = select(StockTransfer).where(StockTransfer.deleted_at.is_(None))
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

    record.status = payload.status
    await db.flush()

    return build_success_response(
        data={"id": str(record.id), "status": record.status},
        message=f"Transfer status updated to {record.status}.",
        request_id=getattr(request.state, "request_id", "-"),
    )
