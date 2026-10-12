"""Proforma Invoice business rules.

Everything configurable lives in the database (``option_lists``), not in code:

* ``proforma.status``    -> allowed next statuses, who may edit / delete, admin-only and
                            reason-required transitions (stored in each row's ``meta``)
* ``proforma.numbering`` -> PI number prefix and zero-padded width

This module holds the pure rule functions plus the few queries they need, so the
route handlers stay thin and the rules can be unit-tested.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.service import CurrentUser
from app.common import workflow as wf
from app.core.constants import RecordStatus
from app.core.exceptions import BadRequestException, ServiceUnavailableException
from app.masters.option_lists.models import OptionList
from app.masters.products.models import Product
from app.masters.uom.models import UnitOfMeasurement
from app.sales.models import ProformaInvoice
from app.sales.schemas import ProformaLineItemSchema

STATUS_GROUP = "proforma.status"
NUMBERING_GROUP = "proforma.numbering"


# ----------------------------------------------------------------------------- rules
# The workflow engine is shared with the Purchase modules (app.common.workflow); the
# Proforma-specific parts are just the group names and the approval permission.
APPROVE_PERMISSION = "proforma.approve"


async def _group_rows(db: AsyncSession, group: str) -> list[OptionList]:
    return await wf.load_group(db, group)


async def load_status_rules(db: AsyncSession) -> dict[str, dict[str, Any]]:
    """Return ``{status: rules}`` for every workflow status configured in the DB."""
    return await wf.load_status_rules(db, STATUS_GROUP)


def user_is_admin(user: CurrentUser) -> bool:
    return wf.is_admin(user, APPROVE_PERMISSION)


def check_transition(rules: dict[str, dict], current: str, target: str, user: CurrentUser, reason: str | None) -> None:
    wf.check_transition(rules, current, target, user, reason, admin_permission=APPROVE_PERMISSION)


def check_editable(rules: dict[str, dict], status: str, user: CurrentUser) -> None:
    wf.check_editable(rules, status, user, admin_permission=APPROVE_PERMISSION)


def check_deletable(rules: dict[str, dict], status: str, user: CurrentUser | None = None) -> None:
    wf.check_deletable(rules, status, user, admin_permission=APPROVE_PERMISSION)


# -------------------------------------------------------------------------- numbering
async def next_proforma_no(db: AsyncSession) -> str:
    """Next sequential PI number, e.g. ``PI-00001`` (prefix and width come from the DB)."""
    cfg = {r.value: r.label for r in await _group_rows(db, NUMBERING_GROUP)}
    if "prefix" not in cfg or "width" not in cfg:
        raise ServiceUnavailableException("Proforma numbering is not configured.")
    prefix, width = cfg["prefix"], int(cfg["width"])
    # include soft-deleted rows so a number is never reused
    existing = (await db.execute(select(ProformaInvoice.proforma_no))).scalars().all()
    pattern = re.compile(rf"^{re.escape(prefix)}(\d+)$")
    highest = max((int(m.group(1)) for n in existing if (m := pattern.match(n or ""))), default=0)
    return f"{prefix}{highest + 1:0{width}d}"


# ----------------------------------------------------------------------------- pricing
def _percent(item: ProformaLineItemSchema) -> float:
    if item.gst_percent is not None:
        return float(item.gst_percent)
    if item.gst_rate:
        m = re.search(r"[\d.]+", item.gst_rate)
        if m:
            return float(m.group(0))
    return 0.0


@dataclass
class PricedLine:
    product_name: str
    product_code: str | None
    hsn_code: str | None
    gst_rate: str
    quantity: float
    uom: str
    rate: float
    amount: float
    unit_discount: float
    taxable_amount: float
    gst_percent: float
    gst_amount: float
    total: float
    is_additional_charge: bool
    charge_type: str | None


@dataclass
class PricedInvoice:
    lines: list[PricedLine]
    taxable_amount: float
    gst_amount: float
    amount_inc_gst: float
    discount: float
    below_min_price: bool


async def price_items(db: AsyncSession, items: list[ProformaLineItemSchema]) -> PricedInvoice:
    """Recompute every line and the totals on the server; flag lines under the product's minimum price."""
    names = {i.product_name.strip().lower() for i in items if not i.is_additional_charge}
    catalog: dict[str, tuple[float | None, str | None]] = {}
    if names:
        stmt = (
            select(
                func.lower(Product.product_name),
                Product.standard_price,
                func.coalesce(UnitOfMeasurement.short_name, UnitOfMeasurement.name),
            )
            .join(UnitOfMeasurement, UnitOfMeasurement.id == Product.uom_id, isouter=True)
            .where(func.lower(Product.product_name).in_(names))
        )
        for lname, min_price, uom in (await db.execute(stmt)).all():
            catalog[lname] = (float(min_price) if min_price is not None else None, uom)

    lines: list[PricedLine] = []
    below_min = False
    for it in items:
        unit_price = float(it.unit_price if it.unit_price is not None else it.rate)
        discount = float(it.unit_discount or 0.0)
        if discount < 0 or discount > unit_price:
            raise BadRequestException(f"Unit discount for '{it.product_name}' must be between 0 and the unit price.")
        pct = _percent(it)
        taxable = round((unit_price - discount) * it.quantity, 2)
        gst = round(taxable * pct / 100.0, 2)
        min_price, catalog_uom = catalog.get(it.product_name.strip().lower(), (None, None))
        if not it.is_additional_charge and min_price and unit_price < min_price:
            below_min = True
        lines.append(
            PricedLine(
                product_name=it.product_name.strip(),
                product_code=it.product_code,
                hsn_code=it.hsn_code or it.hsn,
                gst_rate=f"{pct:g}%",
                quantity=it.quantity,
                uom=(it.uom or catalog_uom or ""),
                rate=unit_price,
                amount=round(taxable + gst, 2),
                unit_discount=discount,
                taxable_amount=taxable,
                gst_percent=pct,
                gst_amount=gst,
                total=round(taxable + gst, 2),
                is_additional_charge=bool(it.is_additional_charge),
                charge_type=it.charge_type,
            )
        )
    return PricedInvoice(
        lines=lines,
        taxable_amount=round(sum(l.taxable_amount for l in lines), 2),
        gst_amount=round(sum(l.gst_amount for l in lines), 2),
        amount_inc_gst=round(sum(l.total for l in lines), 2),
        discount=round(sum(l.unit_discount * l.quantity for l in lines), 2),
        below_min_price=below_min,
    )
