"""
Unit & Integration Tests for Inventory Product Stock and Stock Adjustment Modules.

Tests cover:
- ORM Models (ProductStock, StockAdjustment, StockAdjustmentLineItem)
- Pydantic schemas validation and field normalization
- Live PostgreSQL database querying and verification
"""

from __future__ import annotations

import uuid
import pytest
from sqlalchemy import select

from app.database.engine import get_sessionmaker
from app.inventory.models import ProductStock, StockAdjustment, StockAdjustmentLineItem
from app.inventory.schemas import (
    ProductStockItemRead,
    StockAdjustmentCreate,
    StockAdjustmentLineItemSchema,
    StockAdjustmentRead,
)


# ---------------------------------------------------------------------------
# 1. ORM Model Tests
# ---------------------------------------------------------------------------

def test_product_stock_model():
    stock = ProductStock(
        product_name_tally="ISL450XDAN Flow Wrap machine",
        product_code="MACH-002",
        category="Machines",
        sub_category="Packaging",
        brand="Yinglima",
        mumbai=2.0,
        ahmedabad=1.0,
        indore=0.0,
        total_qty=3.0,
        uom="SET",
        status="In Stock",
    )
    assert stock.product_name_tally == "ISL450XDAN Flow Wrap machine"
    assert stock.total_qty == 3.0
    assert stock.mumbai == 2.0


def test_stock_adjustment_and_line_items_model():
    adj_id = uuid.uuid4()
    adj = StockAdjustment(
        id=adj_id,
        adjustment_no="495",
        adjustment_date="19-09-2026",
        client_name="TEST CLIENT",
        warehouse="Mumbai",
        type="Stock IN",
        purpose="Return From Client",
        total_amount=50000.0,
        created_by="Admin",
    )
    item = StockAdjustmentLineItem(
        adjustment_id=adj_id,
        product_name="Test Product",
        category="Machines",
        quantity=1.0,
        rate=50000.0,
        amount=50000.0,
    )
    adj.items.append(item)
    assert len(adj.items) == 1
    assert adj.items[0].product_name == "Test Product"
    assert adj.items[0].amount == 50000.0


# ---------------------------------------------------------------------------
# 2. Schema Normalization Tests
# ---------------------------------------------------------------------------

def test_stock_adjustment_create_normalization():
    # Test normalization of adjustment_type -> type and item aliases
    payload = {
        "adjustment_date": "19-09-2026",
        "adjustment_type": "IN",
        "warehouse": "Mumbai",
        "purpose": "Return From Client",
        "items": [
            {
                "item_name": "ISL250 Machine",
                "quantity": 2,
                "unit_price": 50000,
            }
        ],
    }
    schema = StockAdjustmentCreate.model_validate(payload)
    assert schema.type == "Stock IN"
    assert len(schema.items) == 1
    assert schema.items[0].product_name == "ISL250 Machine"
    assert schema.items[0].qty == 2.0
    assert schema.items[0].rate == 50000.0
    assert schema.items[0].amount == 100000.0


# ---------------------------------------------------------------------------
# 3. Live Database Integration Tests
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_live_database_records():
    session_factory = get_sessionmaker()
    async with session_factory() as session:
        # 1. Product Stock table query
        prod_result = await session.execute(select(ProductStock).limit(5))
        prod_records = prod_result.scalars().all()
        assert len(prod_records) > 0
        first_prod = prod_records[0]
        assert first_prod.product_name_tally is not None
        assert first_prod.total_qty is not None

        # 2. Stock Adjustments table query
        adj_result = await session.execute(select(StockAdjustment).limit(5))
        adj_records = adj_result.scalars().all()
        assert len(adj_records) > 0
        first_adj = adj_records[0]
        assert first_adj.adjustment_no is not None
        assert first_adj.warehouse is not None
