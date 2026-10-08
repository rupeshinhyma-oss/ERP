"""Landing-cost formulas, checked against figures worked out by hand from the Purchase specs."""

from __future__ import annotations

import pytest

from app.purchase.costing import ImportItemIn, LocalItemIn, compute_import, compute_local, money


def test_money_rounds_half_up_not_bankers():
    assert money(0.125) == 0.13       # banker's rounding would give 0.12
    assert money(2.675) == 2.68
    assert money(1.005) == 1.01


def test_local_purchase_formulas():
    # A = 10,000 ; B = 200 + 300 + 500 = 1,000 ; C = B x 100 / A = 10 %
    res = compute_local(
        invoice_value_ex_gst=10000, packing_forwarding=200, transport=300, offloading=500,
        items=[LocalItemIn("Roller", quantity=10, unit_rate=100), LocalItemIn("Belt", quantity=36, unit_rate=250)],
    )
    assert res.total_expenses == 1000.0
    assert res.loading_percent == 10.0
    roller, belt = res.items
    assert (roller.item_total, roller.expense_per_unit, roller.unit_landing_value) == (1000.0, 10.0, 110.0)   # E = D x C/100 ; F = D + E
    assert (belt.item_total, belt.expense_per_unit, belt.unit_landing_value) == (9000.0, 25.0, 275.0)
    assert res.grand_total == 10000.0


def test_local_purchase_without_expenses_or_invoice_value_does_not_divide_by_zero():
    res = compute_local(invoice_value_ex_gst=0, packing_forwarding=0, transport=0, offloading=0,
                        items=[LocalItemIn("Roller", 2, 50)])
    assert res.loading_percent == 0.0 and res.items[0].unit_landing_value == 50.0
    assert res.invoice_value_ex_gst == 100.0     # falls back to the line total when A is left blank


def test_import_purchase_formulas_match_the_spec():
    # Z = 80, P = 82, W = 1,000 USD -> A = 80,000
    # B = 4000+400+100+1000+1500+2000+500+500 = 10,000 -> C = 12.5 % ; H = 20 CBM -> I = 500 / CBM
    res = compute_import(
        conversion_rate=80, customs_conversion_rate=82, invoice_total_usd=1000, total_cbm=20, total_import_duty=6000,
        expenses=[4000, 400, 100, 1000, 1500, 2000, 500, 500],
        items=[
            ImportItemIn("Sealer", quantity=10, unit_rate_usd=60, pkg_unit_cbm=0.5, pkg_qty=1, duty_percent=10),
            ImportItemIn("Spare", quantity=20, unit_rate_usd=40, pkg_unit_cbm=1.5, pkg_qty=2, duty_percent=0),
        ],
    )
    assert res.invoice_total_inr == 80000.0
    assert res.total_expenses == 10000.0
    assert res.loading_percent_vb == 12.5
    assert res.loading_amount_per_cbm == 500.0
    assert res.gross_total_landing == 96000.0          # A + B + total import duty

    sealer, spare = res.items
    # L = 10 x 0.5 / 1 = 5 ; E = 60 x 80 = 4800 ; O = 60 x 82 x 10% = 492 ; F = 4800 x 12.5% = 600
    # M = 500 x 5 / 10 = 250 ; G = 4800 + 600 + 492 = 5892 ; N = 4800 + 250 + 492 = 5542 ; N - G = -350
    assert (sealer.item_total_cbm, sealer.unit_rate_inr, sealer.unit_import_duty) == (5.0, 4800.0, 492.0)
    assert (sealer.exp_per_unit_vb, sealer.exp_per_unit_cb) == (600.0, 250.0)
    assert (sealer.unit_landing_vb, sealer.unit_landing_cb, sealer.landing_diff) == (5892.0, 5542.0, -350.0)
    assert sealer.item_total_usd == 600.0 and sealer.item_total_duty == 4920.0
    # second line has no duty: L = 20 x 1.5 / 2 = 15 ; E = 3200 ; F = 400 ; M = 500 x 15 / 20 = 375 ; G = 3600 ; N = 3575
    assert (spare.item_total_cbm, spare.unit_import_duty) == (15.0, 0.0)
    assert (spare.unit_landing_vb, spare.unit_landing_cb, spare.landing_diff) == (3600.0, 3575.0, -25.0)

    # table totals: 20 CBM matches H, but 1,400 USD differs from W = 1,000 -- saving is still allowed (spec)
    assert res.sum_cbm == 20.0
    assert res.sum_usd == 1400.0
    assert res.sum_duty == 4920.0


@pytest.mark.parametrize("kwargs", [dict(total_cbm=0), dict(invoice_total_usd=0)])
def test_import_formulas_never_divide_by_zero(kwargs):
    base = dict(conversion_rate=80, customs_conversion_rate=82, invoice_total_usd=1000, total_cbm=20, total_import_duty=0,
                expenses=[100], items=[ImportItemIn("X", 5, 10, pkg_unit_cbm=1, pkg_qty=1)])
    base.update(kwargs)
    res = compute_import(**base)
    assert res.items[0].unit_landing_cb >= 0 and res.items[0].unit_landing_vb >= 0
