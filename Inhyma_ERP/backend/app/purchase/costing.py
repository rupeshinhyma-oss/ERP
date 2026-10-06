"""Landing-cost formulas for Local and Import Purchases (pure functions, no I/O).

The letters in the comments are the symbols used in the Purchase specs. The server is the
authority: whatever the form shows, these functions decide what is stored.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from decimal import ROUND_HALF_UP, Decimal


def money(value: float, places: int = 2) -> float:
    """Round half-up (not banker's rounding) so printed figures match what accountants expect."""
    quantum = Decimal(1).scaleb(-places)
    return float(Decimal(str(value)).quantize(quantum, rounding=ROUND_HALF_UP))


def _div(numerator: float, denominator: float) -> float:
    return numerator / denominator if denominator else 0.0


# ------------------------------------------------------------------------------ local
@dataclass
class LocalItemIn:
    product_name: str
    quantity: float
    unit_rate: float
    uom: str | None = None
    product_code: str | None = None


@dataclass
class LocalItemOut:
    product_name: str
    product_code: str | None
    uom: str | None
    quantity: float
    unit_rate: float
    item_total: float
    expense_per_unit: float
    unit_landing_value: float


@dataclass
class LocalResult:
    invoice_value_ex_gst: float
    total_expenses: float
    loading_percent: float
    items: list[LocalItemOut] = field(default_factory=list)
    grand_total: float = 0.0


def compute_local(
    *, invoice_value_ex_gst: float, packing_forwarding: float, transport: float, offloading: float, items: list[LocalItemIn]
) -> LocalResult:
    """B = P&F + transport + offloading; C = B x 100 / A; E = D x C / 100; F = D + E."""
    item_sum = sum(i.quantity * i.unit_rate for i in items)
    a = invoice_value_ex_gst if invoice_value_ex_gst else item_sum        # (A) falls back to the lines if left blank
    b = packing_forwarding + transport + offloading                        # (B)
    c = _div(b * 100.0, a)                                                 # (C)
    out = []
    for i in items:
        e = i.unit_rate * c / 100.0                                        # (E)
        out.append(
            LocalItemOut(
                product_name=i.product_name, product_code=i.product_code, uom=i.uom, quantity=i.quantity,
                unit_rate=money(i.unit_rate), item_total=money(i.quantity * i.unit_rate),
                expense_per_unit=money(e), unit_landing_value=money(i.unit_rate + e),                     # (F)
            )
        )
    return LocalResult(
        invoice_value_ex_gst=money(a), total_expenses=money(b), loading_percent=money(c, 4), items=out,
        grand_total=money(item_sum),
    )


# ----------------------------------------------------------------------------- import
@dataclass
class ImportItemIn:
    product_name: str
    quantity: float                  # (Y)
    unit_rate_usd: float             # (D)
    pkg_unit_cbm: float = 0.0        # (J)
    pkg_qty: float = 0.0             # (K)
    duty_percent: float = 0.0
    uom: str | None = None
    product_code: str | None = None


@dataclass
class ImportItemOut:
    product_name: str
    product_code: str | None
    uom: str | None
    quantity: float
    pkg_unit_cbm: float
    pkg_qty: float
    item_total_cbm: float
    unit_rate_usd: float
    unit_rate_inr: float
    item_total_usd: float
    duty_percent: float
    unit_import_duty: float
    item_total_duty: float
    exp_per_unit_vb: float
    exp_per_unit_cb: float
    unit_landing_vb: float
    unit_landing_cb: float
    landing_diff: float


@dataclass
class ImportResult:
    invoice_total_inr: float
    total_expenses: float
    gross_total_landing: float
    loading_percent_vb: float
    loading_amount_per_cbm: float
    items: list[ImportItemOut] = field(default_factory=list)
    sum_cbm: float = 0.0
    sum_usd: float = 0.0
    sum_duty: float = 0.0


def compute_import(
    *,
    conversion_rate: float,            # (Z)
    customs_conversion_rate: float,    # (P)
    invoice_total_usd: float,          # (W)
    total_cbm: float,                  # (H)
    total_import_duty: float,
    expenses: list[float],
    items: list[ImportItemIn],
) -> ImportResult:
    """Implements the Import Purchase spec: A = Z x W, B = sum(expenses), C = B x 100 / A, I = B / H, and the
    per-item L, E, O, F, M, G, N and difference. Gross total landing = A + B + total import duty."""
    z, p = conversion_rate, customs_conversion_rate
    a = z * invoice_total_usd                                  # (A)
    b = sum(expenses)                                          # (B)
    c = _div(b * 100.0, a)                                     # (C) value-based loading %
    i_per_cbm = _div(b, total_cbm)                             # (I) loading amount per CBM

    lines: list[ImportItemOut] = []
    for it in items:
        y = it.quantity
        l = _div(y * it.pkg_unit_cbm, it.pkg_qty)              # (L) = Y x J / K
        e = it.unit_rate_usd * z                               # (E) = D x Z
        o = it.unit_rate_usd * p * it.duty_percent / 100.0     # (O) = D x P x duty% / 100
        f = e * c / 100.0                                      # (F) = E x C / 100
        m = _div(i_per_cbm * l, y)                             # (M) = I x L / Y
        g = e + f + o                                          # (G) = E + F + O
        n = e + m + o                                          # (N) = E + M + O
        lines.append(
            ImportItemOut(
                product_name=it.product_name, product_code=it.product_code, uom=it.uom, quantity=y,
                pkg_unit_cbm=it.pkg_unit_cbm, pkg_qty=it.pkg_qty, item_total_cbm=money(l, 4),
                unit_rate_usd=money(it.unit_rate_usd), unit_rate_inr=money(e), item_total_usd=money(y * it.unit_rate_usd),
                duty_percent=it.duty_percent, unit_import_duty=money(o), item_total_duty=money(o * y),
                exp_per_unit_vb=money(f), exp_per_unit_cb=money(m), unit_landing_vb=money(g), unit_landing_cb=money(n),
                landing_diff=money(n - g),
            )
        )
    return ImportResult(
        invoice_total_inr=money(a),
        total_expenses=money(b),
        gross_total_landing=money(a + b + total_import_duty),
        loading_percent_vb=money(c, 4),
        loading_amount_per_cbm=money(i_per_cbm),
        items=lines,
        sum_cbm=money(sum(x.item_total_cbm for x in lines), 4),
        sum_usd=money(sum(x.item_total_usd for x in lines)),
        sum_duty=money(sum(x.item_total_duty for x in lines)),
    )
