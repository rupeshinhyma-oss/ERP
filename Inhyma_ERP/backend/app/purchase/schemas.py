"""Request payloads for Local and Import Purchases. Dates are exchanged as DD-MM-YYYY (the ERP's display format)."""

from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Any, List, Optional

from pydantic import BaseModel, Field, field_validator


def parse_date(value: Any) -> Optional[date]:
    """Accept a ``date``, ``DD-MM-YYYY`` or ``YYYY-MM-DD``; blank means no date."""
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    text = str(value).strip()
    for fmt in ("%d-%m-%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(text, fmt).date()
        except ValueError:
            continue
    raise ValueError("Dates must be DD-MM-YYYY.")


def fmt_date(value: Optional[date]) -> Optional[str]:
    return value.strftime("%d-%m-%Y") if value else None


class StatusUpdate(BaseModel):
    status: str = Field(..., min_length=1)
    reason: Optional[str] = None


# ------------------------------------------------------------------------------ local
class LocalItemIn(BaseModel):
    product_name: str = Field(..., min_length=1)
    product_code: Optional[str] = None
    uom: Optional[str] = None
    quantity: float = Field(..., gt=0)
    unit_rate: float = Field(..., ge=0)


class LocalPurchaseIn(BaseModel):
    supplier_name: str = Field(..., min_length=1)
    supplier_id: Optional[uuid.UUID] = None
    warehouse: str = Field(..., min_length=1)
    invoice_no: str = Field(..., min_length=1)
    invoice_date: date
    invoice_value_ex_gst: float = Field(0.0, ge=0)
    invoice_value_inc_gst: float = Field(0.0, ge=0)
    packing_forwarding: float = Field(0.0, ge=0)
    transport: float = Field(0.0, ge=0)
    offloading: float = Field(0.0, ge=0)
    remarks: Optional[str] = None
    items: List[LocalItemIn] = Field(..., min_length=1)

    _dates = field_validator("invoice_date", mode="before")(lambda cls, v: parse_date(v))


# ----------------------------------------------------------------------------- import
class ImportItemIn(BaseModel):
    product_name: str = Field(..., min_length=1)
    product_code: Optional[str] = None
    uom: Optional[str] = None
    quantity: float = Field(..., gt=0)
    unit_rate_usd: float = Field(..., ge=0)
    # taken from the Product Master when omitted
    pkg_unit_cbm: Optional[float] = Field(None, ge=0)
    pkg_qty: Optional[float] = Field(None, ge=0)
    duty_percent: Optional[float] = Field(None, ge=0)


class ImportPurchaseIn(BaseModel):
    consignment_no: str = Field(..., min_length=1)
    supplier_name: str = Field(..., min_length=1)
    supplier_id: Optional[uuid.UUID] = None
    warehouse: str = Field(..., min_length=1)

    ordered_date: date
    etd_origin_date: Optional[date] = None
    eta_port_date: Optional[date] = None
    expected_arrival_date: Optional[date] = None
    invoice_date: Optional[date] = None

    conversion_rate: float = Field(..., gt=0)
    customs_conversion_rate: float = Field(..., gt=0)
    invoice_total_usd: float = Field(0.0, ge=0)
    total_cbm: float = Field(0.0, ge=0)
    total_import_duty: float = Field(0.0, ge=0)

    freight: float = Field(0.0, ge=0)
    insurance: float = Field(0.0, ge=0)
    stamp_duty: float = Field(0.0, ge=0)
    shipping_line_charges: float = Field(0.0, ge=0)
    cfs_charges: float = Field(0.0, ge=0)
    clearing_transport: float = Field(0.0, ge=0)
    offloading: float = Field(0.0, ge=0)
    misc_charges: float = Field(0.0, ge=0)
    misc_remarks: Optional[str] = None

    remarks: Optional[str] = None
    items: List[ImportItemIn] = Field(..., min_length=1)

    _dates = field_validator(
        "ordered_date", "etd_origin_date", "eta_port_date", "expected_arrival_date", "invoice_date", mode="before"
    )(lambda cls, v: parse_date(v))


class ImportPreviewIn(BaseModel):
    """Values typed so far on the Import Purchase form; used only to show the landing cost before saving."""

    conversion_rate: float = Field(0.0, ge=0)
    customs_conversion_rate: float = Field(0.0, ge=0)
    invoice_total_usd: float = Field(0.0, ge=0)
    total_cbm: float = Field(0.0, ge=0)
    total_import_duty: float = Field(0.0, ge=0)
    freight: float = Field(0.0, ge=0)
    insurance: float = Field(0.0, ge=0)
    stamp_duty: float = Field(0.0, ge=0)
    shipping_line_charges: float = Field(0.0, ge=0)
    cfs_charges: float = Field(0.0, ge=0)
    clearing_transport: float = Field(0.0, ge=0)
    offloading: float = Field(0.0, ge=0)
    misc_charges: float = Field(0.0, ge=0)
    items: List[ImportItemIn] = Field(default_factory=list)
