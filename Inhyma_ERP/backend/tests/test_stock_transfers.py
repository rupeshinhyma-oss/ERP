"""
Unit & Integration Tests for Stock Transfer Module.

Tests cover:
- ORM Models (StockTransfer, StockTransferLineItem)
- Schemas & Validation (StockTransferCreate, StockTransferRead, StockTransferTabCounts)
- Live PostgreSQL database querying and tab counts verification (All 46, Pending 0, Confirmed 3, Received 41, Cancel 2)
"""

from __future__ import annotations

import uuid
import pytest
from sqlalchemy import func, select

from app.database.engine import get_sessionmaker
from app.inventory.models import StockTransfer, StockTransferLineItem
from app.inventory.schemas import (
    StockTransferCreate,
    StockTransferLineItemSchema,
    StockTransferRead,
    StockTransferTabCounts,
)


def test_stock_transfer_model_instantiation():
    transfer = StockTransfer(
        sr_no=53,
        transfer_no="TRF-2026-053",
        transfer_date="19-09-2026 05:00 PM",
        from_warehouse="Ahmedabad",
        to_warehouse="Mumbai",
        total_amount=150000.0,
        added_by="Akshata Wadekar",
        status="Received",
    )
    assert transfer.sr_no == 53
    assert transfer.transfer_no == "TRF-2026-053"
    assert transfer.from_warehouse == "Ahmedabad"
    assert transfer.to_warehouse == "Mumbai"
    assert transfer.status == "Received"


def test_stock_transfer_create_schema():
    payload = {
        "transfer_date": "19-09-2026 05:00 PM",
        "from_warehouse": "Indore",
        "to_warehouse": "Mumbai",
        "total_amount": 75000.0,
        "status": "Confirmed",
        "items": [
            {
                "product_name": "Packaging Line Sensor Unit",
                "product_code": "SEN-009",
                "category": "Spares",
                "quantity": 3.0,
                "uom": "PCS",
                "rate": 25000.0,
                "amount": 75000.0,
            }
        ],
    }
    schema = StockTransferCreate.model_validate(payload)
    assert schema.from_warehouse == "Indore"
    assert schema.to_warehouse == "Mumbai"
    assert schema.status == "Confirmed"
    assert len(schema.items) == 1
    assert schema.items[0].rate == 25000.0


@pytest.mark.asyncio
async def test_live_stock_transfers_db_and_counts():
    session_factory = get_sessionmaker()
    async with session_factory() as session:
        # Check total count
        total_count = (await session.execute(
            select(func.count()).select_from(StockTransfer).where(StockTransfer.deleted_at.is_(None))
        )).scalar()
        assert total_count == 46

        # Check status breakdown matches screenshot tabs: All (46), Pending (0), Confirmed (3), Received (41), Cancel (2)
        res = await session.execute(
            select(StockTransfer.status, func.count()).where(StockTransfer.deleted_at.is_(None)).group_by(StockTransfer.status)
        )
        status_map = dict(res.all())
        assert status_map.get("Received", 0) == 41
        assert status_map.get("Confirmed", 0) == 3
        assert status_map.get("Cancel", 0) == 2
        assert status_map.get("Pending", 0) == 0

        # Check top row matches screenshot (Sr 52, Ahmedabad -> Mumbai, 18-09-2026 04:37 PM)
        top_row = (await session.execute(
            select(StockTransfer).where(StockTransfer.deleted_at.is_(None)).order_by(StockTransfer.sr_no.desc()).limit(1)
        )).scalars().first()
        assert top_row is not None
        assert top_row.sr_no == 52
        assert top_row.from_warehouse == "Ahmedabad"
        assert top_row.to_warehouse == "Mumbai"
        assert top_row.added_by == "Akshata Wadekar"
        assert top_row.status == "Received"
        assert top_row.total_amount == pytest.approx(629534.06, 0.01)


def test_parse_wh_column_physical_and_transit():
    from app.inventory.routes import _parse_wh_column

    col, city, is_tr = _parse_wh_column("Ahmedabad")
    assert col == "ahmedabad" and city == "ahmedabad" and not is_tr

    col, city, is_tr = _parse_wh_column("Mumbai Transit")
    assert col == "mumbai_transit" and city == "mumbai" and is_tr

    col, city, is_tr = _parse_wh_column("Main Warehouse - Bhiwandi")
    assert col == "mumbai" and city == "mumbai" and not is_tr

    col, city, is_tr = _parse_wh_column("Indore Transit")
    assert col == "indore_transit" and city == "indore" and is_tr

    col, city, is_tr = _parse_wh_column("Indore", prefer_transit=True)
    assert col == "indore_transit" and city == "indore" and is_tr


def test_recompute_total_stock():
    from app.inventory.routes import _recompute_total_stock
    from app.inventory.models import ProductStock

    prod = ProductStock(
        product_name_tally="Demo Item",
        ahmedabad=10.0,
        ahmedabad_transit=5.0,
        ahmedabad_ordered=2.0,
        mumbai=20.0,
        mumbai_transit=3.0,
        mumbai_ordered=0.0,
        indore=4.0,
        indore_transit=1.0,
        indore_ordered=0.0,
        total_qty=0.0,
    )
    _recompute_total_stock(prod)
    assert prod.total_qty == 45.0


def test_is_physical_warehouse_rules():
    from app.inventory.stock_service import is_physical
    from app.masters.warehouses.models import Warehouse

    main_wh = Warehouse(name="Mumbai", address="Plot 1", billing_company="Inhyma", main_warehouse_id=None)
    assert is_physical(main_wh) is True

    transit_wh = Warehouse(name="Mumbai Transit", address="Plot 1", billing_company="Inhyma", main_warehouse_id=None)
    assert is_physical(transit_wh) is False

    ordered_wh = Warehouse(name="Ahmedabad Ordered", address="Plot 2", billing_company="Inhyma", main_warehouse_id=None)
    assert is_physical(ordered_wh) is False

    child_wh = Warehouse(name="Sub Warehouse", address="Plot 3", billing_company="Inhyma", main_warehouse_id=uuid.uuid4())
    assert is_physical(child_wh) is False


@pytest.mark.asyncio
async def test_goods_expected_report_lookup():
    from app.inventory.routes import get_goods_expected_report
    from unittest.mock import AsyncMock, MagicMock

    mock_db = AsyncMock()
    mock_execute_result = MagicMock()
    mock_execute_result.all.return_value = []
    mock_execute_result.scalars.return_value.all.return_value = []
    mock_db.execute.return_value = mock_execute_result

    res = await get_goods_expected_report(
        request=None,
        machine="Sensor",
        warehouse="Mumbai",
        status="In Transit",
        limit=50,
        db=mock_db,
    )
    assert res["success"] is True
    assert "items" in res["data"]
    assert "total" in res["data"]

