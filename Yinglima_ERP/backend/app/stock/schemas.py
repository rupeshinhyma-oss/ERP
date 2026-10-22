"""
Stock Movement (Inward & Outward) Pydantic Schemas.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


# ---------------------------------------------------------------------------
# Line Items
# ---------------------------------------------------------------------------

class StockMovementItemCreate(BaseModel):
    product_id: uuid.UUID | None = None
    product_name: str = Field(..., min_length=1, max_length=255)
    product_code: str | None = None
    expected_quantity: float = Field(default=0.0, ge=0.0)
    quantity: float = Field(default=0.0, ge=0.0)
    damaged_quantity: float = Field(default=0.0, ge=0.0)
    accepted_quantity: float = Field(default=0.0, ge=0.0)
    unit_rate: float = Field(default=0.0, ge=0.0)
    package_details: str | None = None
    remarks: str | None = None


class StockMovementItemResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    movement_id: uuid.UUID
    product_id: uuid.UUID | None = None
    product_name: str
    product_code: str | None = None
    expected_quantity: float = 0.0
    quantity: float = 0.0
    damaged_quantity: float = 0.0
    accepted_quantity: float = 0.0
    unit_rate: float = 0.0
    package_details: str | None = None
    remarks: str | None = None
    created_at: datetime


# ---------------------------------------------------------------------------
# Stock Movement Header
# ---------------------------------------------------------------------------

class StockMovementCreate(BaseModel):
    movement_type: str = Field(..., pattern="^(inward|outward)$")
    movement_date: date
    source_type: str = Field(default="direct", pattern="^(local_purchase|sale_process|direct)$")

    # Link to Local Purchase (for Inward)
    purchase_id: uuid.UUID | None = None
    purchase_invoice_no: str | None = None

    # Link to Sale Process (for Outward)
    sale_order_id: uuid.UUID | None = None
    sale_order_no: str | None = None

    # Parties
    supplier_id: uuid.UUID | None = None
    supplier_name: str | None = None
    buyer_id: uuid.UUID | None = None
    buyer_name: str | None = None

    # Logistics & Gate Pass
    reference_no: str | None = None
    warehouse_location: str | None = None
    vehicle_no: str | None = None
    transporter_name: str | None = None
    container_no: str | None = None
    remarks: str | None = None

    items: list[StockMovementItemCreate] = Field(default_factory=list)


class StockMovementResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    movement_no: str
    movement_type: str
    movement_date: date
    status: str
    source_type: str

    purchase_id: uuid.UUID | None = None
    purchase_invoice_no: str | None = None
    sale_order_id: uuid.UUID | None = None
    sale_order_no: str | None = None

    supplier_id: uuid.UUID | None = None
    supplier_name: str | None = None
    buyer_id: uuid.UUID | None = None
    buyer_name: str | None = None

    reference_no: str | None = None
    warehouse_location: str | None = None
    vehicle_no: str | None = None
    transporter_name: str | None = None
    container_no: str | None = None

    total_quantity: float = 0.0
    total_items_count: int = 0
    remarks: str | None = None

    created_by_id: uuid.UUID | None = None
    created_by_name: str | None = None
    created_at: datetime
    updated_at: datetime

    items: list[StockMovementItemResponse] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Metrics & Stock Balance
# ---------------------------------------------------------------------------

class StockSummaryMetrics(BaseModel):
    total_inward_records: int = 0
    total_inward_quantity: float = 0.0
    total_outward_records: int = 0
    total_outward_quantity: float = 0.0
    total_net_stock_quantity: float = 0.0


class StockBalanceItem(BaseModel):
    product_id: uuid.UUID | None = None
    product_name: str
    product_code: str | None = None
    total_inward_qty: float = 0.0
    total_outward_qty: float = 0.0
    current_stock_qty: float = 0.0
    last_movement_date: date | None = None


# ---------------------------------------------------------------------------
# 1-Click Extract Schemas
# ---------------------------------------------------------------------------

class ExtractedItem(BaseModel):
    product_id: uuid.UUID | None = None
    product_name: str
    product_code: str | None = None
    quantity: float = 0.0
    unit_rate: float = 0.0
    hsn_code: str | None = None


class PurchaseExtractResponse(BaseModel):
    purchase_id: uuid.UUID
    invoice_no: str
    invoice_date: date
    supplier_id: uuid.UUID
    supplier_name: str
    consignment_code: str | None = None
    currency: str = "RMB"
    total_quantity: float = 0.0
    items: list[ExtractedItem] = Field(default_factory=list)


class SaleOrderExtractResponse(BaseModel):
    sale_order_id: uuid.UUID
    order_no: str
    order_date: date
    buyer_id: uuid.UUID | None = None
    buyer_name: str
    consignment_code: str | None = None
    container_no: str | None = None
    transporter_name: str | None = None
    lr_no: str | None = None
    currency: str = "RMB"
    total_quantity: float = 0.0
    items: list[ExtractedItem] = Field(default_factory=list)
