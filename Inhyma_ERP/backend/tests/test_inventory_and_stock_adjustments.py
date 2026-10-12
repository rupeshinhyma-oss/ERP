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
        assert isinstance(prod_records, list)
        if len(prod_records) > 0:
            first_prod = prod_records[0]
            assert first_prod.product_name_tally is not None
            assert first_prod.total_qty is not None

        # 2. Stock Adjustments table query
        adj_result = await session.execute(select(StockAdjustment).limit(5))
        adj_records = adj_result.scalars().all()
        assert isinstance(adj_records, list)
        if len(adj_records) > 0:
            first_adj = adj_records[0]
            assert first_adj.adjustment_no is not None
            assert first_adj.warehouse is not None


@pytest.mark.asyncio
async def test_product_stock_filters_and_breakup_endpoints():
    from app.inventory.routes import list_product_stock, get_product_stock_breakup
    from unittest.mock import MagicMock

    session_factory = get_sessionmaker()
    async with session_factory() as session:
        req = MagicMock()
        req.state.request_id = "test-req-123"

        # 1. Test listing with sub_category and negative_stock
        res = await list_product_stock(
            request=req,
            category="Machines",
            sub_category="All",
            brand="All",
            negative_stock="No",
            skip=0,
            limit=10,
            db=session,
        )
        assert res["success"] is True
        assert "items" in res["data"]
        for it in res["data"]["items"]:
            assert it["total_qty"] >= 0

        # 2. Test breakup endpoint for physical warehouse
        breakup_res = await get_product_stock_breakup(
            product_name="Sensor (Banding)",
            warehouse="Mumbai",
            type="physical",
            request=req,
            db=session,
        )
        assert breakup_res["success"] is True
        assert breakup_res["data"]["stock_type"] == "physical"
        assert "items" in breakup_res["data"]

        # 3. Test breakup endpoint for transit / ordered warehouse
        transit_res = await get_product_stock_breakup(
            product_name="ISL250 Rotary PFS 8 Head With Zipper & Nitrogen",
            warehouse="Mumbai",
            type="ordered",
            request=req,
            db=session,
        )
        assert transit_res["success"] is True
        assert transit_res["data"]["stock_type"] == "ordered"
        assert "items" in transit_res["data"]


@pytest.mark.asyncio
async def test_product_reorder_listing_and_patch():
    from app.inventory.routes import list_product_reorder, update_product_reorder
    from app.inventory.schemas import ProductReorderUpdateSchema
    from unittest.mock import MagicMock

    session_factory = get_sessionmaker()
    async with session_factory() as session:
        req = MagicMock()
        req.state.request_id = "test-reorder-req"

        # 1. Test listing with default parameters
        res = await list_product_reorder(
            category="All",
            sub_category="All",
            brand="All",
            shortfall="All",
            reorder="All",
            search=None,
            warehouse="Mumbai",
            skip=0,
            limit=15,
            request=req,
            db=session,
        )
        assert res["success"] is True
        items = res["data"]["items"]
        assert len(items) >= 10
        # Verify 16 columns structure on items
        first_item = items[0]
        for field in [
            "sr_no", "product_name_tally", "mumbai", "mumbai_transit", "mumbai_ordered",
            "ahmedabad", "ahmedabad_transit", "ahmedabad_ordered",
            "indore", "indore_transit", "indore_ordered",
            "total_qty", "reorder_level", "short_fall", "minimum_order_quantity", "order_to_be_place"
        ]:
            assert field in first_item, f"Missing field {field} in reorder item"

        # 2. Test shortfall filter "Greater Than 0"
        sf_res = await list_product_reorder(
            category="All",
            sub_category="All",
            brand="All",
            shortfall="Greater Than 0",
            reorder="All",
            skip=0,
            limit=10,
            request=req,
            db=session,
        )
        assert sf_res["success"] is True
        for it in sf_res["data"]["items"]:
            assert it["short_fall"] > 0

        # 3. Test patch thresholds
        first_id = first_item["id"]
        patch_payload = ProductReorderUpdateSchema(reorder_level=12.0, minimum_order_quantity=20.0)
        patch_res = await update_product_reorder(
            product_id=first_id,
            payload=patch_payload,
            request=req,
            db=session,
        )
        assert patch_res["success"] is True
        assert patch_res["data"]["reorder_level"] == 12.0
        assert patch_res["data"]["minimum_order_quantity"] == 20.0

