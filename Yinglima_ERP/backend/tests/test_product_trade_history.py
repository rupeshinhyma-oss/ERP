"""Tests for Product Trade & Price History feature."""

from __future__ import annotations

import uuid
import pytest
from app.database.engine import get_sessionmaker
from app.masters.product_prices.service import ProductPriceService
from app.masters.product_prices.schemas import (
    ProductTradeHistoryResponse,
    PurchaseHistoryRecord,
    SalesHistoryRecord,
    ProductTradeHistoryMetrics,
)


def test_trade_history_schema_serialization():
    """Verify that trade history schemas serialize and calculate as expected."""
    sample_id = uuid.uuid4()
    metrics = ProductTradeHistoryMetrics(
        latest_purchase_rate=14.0,
        latest_purchase_currency="USD",
        latest_purchase_landing_rate=15.0,
        latest_purchase_date="2026-03-10",
        latest_supplier_name="Zhejiang Machinery Co.",
        latest_purchase_type="invoice",
        latest_sales_rate=19.0,
        latest_sales_currency="USD",
        latest_sales_date="2026-03-12",
        latest_buyer_name="Inhyma Mumbai",
        estimated_margin_percent=26.32,
        estimated_profit_per_unit=5.0,
        profit_currency="USD",
        total_purchased_qty=100.0,
        total_sold_qty=100.0,
    )

    purchase = PurchaseHistoryRecord(
        record_type="invoice",
        doc_number="LP-INV-088",
        record_date="2026-03-10",
        supplier_name="Zhejiang Machinery Co.",
        quantity=100.0,
        unit_rate=14.0,
        unit_landing_rate=15.0,
        currency="USD",
        total_amount=1400.0,
        status="Confirmed",
    )

    sale = SalesHistoryRecord(
        record_type="order",
        doc_number="SO-2026-0035",
        consignment_code="MUM1",
        record_date="2026-03-12",
        buyer_name="Inhyma Mumbai",
        quantity=100.0,
        unit_rate=19.0,
        currency="USD",
        item_total=1900.0,
        status="sales_confirmed",
        margin_percent=26.3,
    )

    res = ProductTradeHistoryResponse(
        product_id=sample_id,
        product_code="GP-100",
        product_name="Stainless Steel Gear Pump",
        metrics=metrics,
        purchases=[purchase],
        sales=[sale],
    )

    data = res.model_dump()
    assert data["product_code"] == "GP-100"
    assert data["metrics"]["estimated_margin_percent"] == 26.32
    assert len(data["purchases"]) == 1
    assert data["purchases"][0]["record_type"] == "invoice"
    assert len(data["sales"]) == 1
    assert data["sales"][0]["margin_percent"] == 26.3


@pytest.mark.asyncio
async def test_get_trade_history_service_query():
    """Verify live query against database for trade history."""
    sm = get_sessionmaker()
    async with sm() as s:
        svc = ProductPriceService(s)
        # Query product with known sales orders: FR900 Band Sealer MSH
        pid = uuid.UUID("1163f4dd-c6c2-4520-a7ba-c6db9578874a")
        res = await svc.get_trade_history(pid)

        assert res.product_id == pid
        assert "FR900" in res.product_name
        assert isinstance(res.sales, list)
        assert len(res.sales) > 0
        assert res.sales[0].record_type == "order"
        assert res.metrics.total_sold_qty > 0
