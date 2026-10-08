"""Unit and integration tests for Price List Management Module."""

from __future__ import annotations

import io
import uuid
from unittest.mock import AsyncMock, MagicMock

import pytest
from openpyxl import load_workbook

from app.masters.price_list.schemas import (
    AssignSupplierQuotePayload,
    BulkPriceUpdateItem,
    BulkPriceUpdateRequest,
    PriceListItem,
    PriceListMetrics,
    PriceListUpdatePayload,
)
from app.masters.price_list.service import PriceListService


def test_price_list_schemas_inclusive_math():
    """Verify standard GST inclusive & exclusive arithmetic rules."""
    # Given a base price of 1000 and 18% GST:
    base_price = 1000.0
    gst_percent = 18.0

    gst_amount = round(base_price * (gst_percent / 100.0), 2)
    inclusive_price = round(base_price + gst_amount, 2)

    assert gst_amount == 180.0
    assert inclusive_price == 1180.0

    # Back-calculation from inclusive to base:
    back_calculated_base = round(inclusive_price / (1.0 + (gst_percent / 100.0)), 2)
    assert back_calculated_base == 1000.0


def test_price_list_schemas_odd_cents_rounding():
    """Verify GST back-calculation with fractional amounts (F&B / retail model)."""
    # Item sold at ₹999.00 MRP inclusive of 18% GST:
    inclusive_price = 999.00
    gst_rate = 18.0

    base_rate = round(inclusive_price / (1.0 + gst_rate / 100.0), 2)
    gst_amount = round(inclusive_price - base_rate, 2)

    assert base_rate == 846.61
    assert gst_amount == 152.39
    assert round(base_rate + gst_amount, 2) == 999.00


def test_price_list_update_payload_validation():
    """Verify PriceListUpdatePayload validates positive numbers and flags."""
    payload = PriceListUpdatePayload(
        standard_price=1250.50,
        minimum_price=1100.00,
        standard_cost=800.00,
        is_inclusive=True,
    )
    assert payload.standard_price == 1250.50
    assert payload.is_inclusive is True


@pytest.mark.asyncio
async def test_price_list_service_export_excel():
    """Test generating a styled Excel export for price list."""
    session = AsyncMock()
    service = PriceListService(session)

    # Mock repository returning two items
    sample_item_1 = PriceListItem(
        product_id=uuid.uuid4(),
        product_code="PRD-001",
        product_name="Standard Hex Bolt",
        product_name_tally="Standard Hex Bolt M12",
        standard_price=100.0,
        minimum_price=90.0,
        standard_cost=65.0,
        gst_percent=18.0,
        standard_price_gst_amount=18.0,
        standard_price_inc_gst=118.0,
        minimum_price_gst_amount=16.2,
        minimum_price_inc_gst=106.2,
        current_stock=250.0,
        has_price=True,
    )

    service.repo.list_price_items = AsyncMock(return_value=([sample_item_1], 1))

    content, media_type, filename = await service.export_price_list(file_format="xlsx")

    assert media_type == "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    assert filename == "price_list.xlsx"

    wb = load_workbook(io.BytesIO(content))
    ws = wb.active
    assert ws is not None
    # Row 1 is header, Row 2 is first item
    assert ws.cell(row=2, column=2).value == "PRD-001"
    assert ws.cell(row=2, column=11).value == 100.0  # Selling Price (Base)
    assert ws.cell(row=2, column=13).value == 118.0  # Selling Price (Incl GST)


@pytest.mark.asyncio
async def test_price_list_service_generate_template():
    """Test generating bulk price import sample template."""
    session = AsyncMock()
    service = PriceListService(session)

    content, media_type, filename = await service.generate_template()
    assert filename == "price_import_template.xlsx"

    wb = load_workbook(io.BytesIO(content))
    ws = wb.active
    assert ws is not None
    assert ws.cell(row=1, column=1).value == "Product Code"
    assert ws.cell(row=1, column=3).value == "Selling Price"
    assert ws.cell(row=1, column=6).value == "Pricing Mode (Exclusive or Inclusive)"
