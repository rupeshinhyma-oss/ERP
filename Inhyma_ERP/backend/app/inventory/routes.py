"""
Inventory and Stock Adjustment Routes.

Provides RESTful endpoints for:
1. Product Stock: Warehouse-level physical inventory counts, valuations, filtering.
2. Stock Adjustments: Stock IN / OUT reconciliations, client returns, transit damage, split assemblies.
3. Official Stock Adjustment PDF Generation & Downloads.
"""

from __future__ import annotations

import datetime
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import Response

from app.core.responses import build_success_response
from app.inventory.schemas import (
    ProductStockItemRead,
    StockAdjustmentCreate,
    StockAdjustmentLineItemSchema,
    StockAdjustmentRead,
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
) -> dict:
    """Return paginated product stock records with real-time filtering."""
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
async def get_product_stock(stock_id: str, request: Request) -> dict:
    """Retrieve single product stock entry."""
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
) -> dict:
    """Return paginated list of stock adjustment records."""
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
async def get_stock_adjustment(adjustment_id: str, request: Request) -> dict:
    """Retrieve details of an adjustment record with items breakdown."""
    for item in _STOCK_ADJUSTMENTS:
        if item["id"] == adjustment_id or item.get("adjustment_no") == adjustment_id:
            return build_success_response(
                data=item,
                request_id=getattr(request.state, "request_id", "-"),
            )
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Adjustment record not found")


@router.post("/inventory/stock-adjustment", status_code=status.HTTP_201_CREATED, summary="Create stock adjustment")
@router.post("/adjustment", status_code=status.HTTP_201_CREATED, summary="Alias to create adjustment")
async def create_stock_adjustment(payload: StockAdjustmentCreate, request: Request) -> dict:
    """Record a new stock adjustment."""
    now = datetime.datetime.now()
    calc_total = sum(li.amount for li in payload.items)

    new_id = f"adj-{int(now.timestamp() * 1000)}"
    adj_no = payload.adjustment_no or str(len(_STOCK_ADJUSTMENTS) + 493)

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
async def delete_stock_adjustment(adjustment_id: str, request: Request) -> dict:
    """Delete a stock adjustment record by ID."""
    global _STOCK_ADJUSTMENTS
    initial_count = len(_STOCK_ADJUSTMENTS)
    _STOCK_ADJUSTMENTS = [item for item in _STOCK_ADJUSTMENTS if item["id"] != adjustment_id and item.get("adjustment_no") != adjustment_id]

    if len(_STOCK_ADJUSTMENTS) == initial_count:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Adjustment record not found")

    return build_success_response(
        data={"deleted_id": adjustment_id},
        message="Stock adjustment deleted successfully.",
        request_id=getattr(request.state, "request_id", "-"),
    )
