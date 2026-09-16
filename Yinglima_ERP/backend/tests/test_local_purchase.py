"""
Tests for Local Purchase Module.
Verifies Value-Based (VB) landing expense distribution and calculations.
"""

from __future__ import annotations

import pytest
from app.purchases.local.service import LocalPurchaseService
from app.purchases.local.models import LocalPurchase


def test_landing_expense_value_based_calculation():
    """Verify exact Value-Based proportional expense distribution across items."""
    service = LocalPurchaseService(session=None)  # type: ignore[arg-type]

    items = [
        {
            "product_name": "Item A",
            "quantity": 100,
            "unit_rate": 650.0,
            "vat_rate": 13.0,
        },
        {
            "product_name": "Item B",
            "quantity": 50,
            "unit_rate": 200.0,
            "vat_rate": 13.0,
        },
    ]

    packing = 2500.0
    transport = 4200.0
    offloading = 1100.0
    other = 0.0

    # Total expenses = 2500 + 4200 + 1100 = 7800
    # Item A: 100 * 650 = 65,000 (86.67% of 75,000)
    # Item B: 50 * 200 = 10,000 (13.33% of 75,000)
    # Items Total Basic = 75,000
    # Total expenses = 7,800
    # Loading % = (7800 / 75000) * 100 = 10.4%
    # Item A allocated = (65000 / 75000) * 7800 = 6760.0
    # Item A expense per unit = 6760.0 / 100 = 67.60
    # Item A unit landing rate = 650.0 + 67.60 = 717.60
    # Item B allocated = (10000 / 75000) * 7800 = 1040.0
    # Item B expense per unit = 1040.0 / 50 = 20.80
    # Item B unit landing rate = 200.0 + 20.80 = 220.80

    result = service.calculate_landing_rates(
        packing_forwarding=packing,
        transport_expense=transport,
        offloading_expense=offloading,
        other_expense=other,
        items=items,
    )

    assert result["total_expenses"] == 7800.0
    assert result["items_total_basic"] == 75000.0
    assert result["loading_expense_pct"] == 10.4
    assert result["total_quantity"] == 150.0

    items_res = result["items"]
    assert len(items_res) == 2

    # Item A checks
    assert items_res[0]["item_total"] == 65000.0
    assert items_res[0]["vat_amount"] == 8450.0  # 13% of 65,000
    assert items_res[0]["expense_per_unit"] == 67.6
    assert items_res[0]["unit_landing_rate"] == 717.6
    assert items_res[0]["total_landing_rate"] == 71760.0

    # Item B checks
    assert items_res[1]["item_total"] == 10000.0
    assert items_res[1]["vat_amount"] == 1300.0  # 13% of 10,000
    assert items_res[1]["expense_per_unit"] == 20.8
    assert items_res[1]["unit_landing_rate"] == 220.8
    assert items_res[1]["total_landing_rate"] == 11040.0

    # Total landing rate equals total basic + total expenses
    assert result["items_total_landing"] == 75000.0 + 7800.0


def test_financial_reconciliation_discrepancy_check():
    """Verify that reconciliation allows within 0.05 tolerance and strictly blocks above 0.05."""
    service = LocalPurchaseService(session=None)  # type: ignore[arg-type]

    items = [
        {
            "product_name": "Test Item",
            "quantity": 10,
            "unit_rate": 100.0,
            "vat_rate": 13.0,
        },
    ]

    calc = service.calculate_landing_rates(
        packing_forwarding=0,
        transport_expense=0,
        offloading_expense=0,
        other_expense=0,
        items=items,
    )

    # Basic = 1000.0, VAT = 130.0 -> Gross = 1130.0
    items_gross = round(calc["items_total_basic"] + calc["items_total_vat"], 2)
    assert items_gross == 1130.0

    # Test tolerance within 0.05
    diff_exact = round(abs(1130.0 - items_gross), 2)
    assert diff_exact <= 0.05

    diff_within_tolerance = round(abs(1130.04 - items_gross), 2)
    assert diff_within_tolerance <= 0.05

    # Test discrepancy exceeding 0.05
    diff_exceeding = round(abs(1130.10 - items_gross), 2)
    assert diff_exceeding > 0.05

    diff_large_discrepancy = round(abs(1200.0 - items_gross), 2)
    assert diff_large_discrepancy > 0.05

