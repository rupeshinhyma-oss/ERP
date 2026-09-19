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
