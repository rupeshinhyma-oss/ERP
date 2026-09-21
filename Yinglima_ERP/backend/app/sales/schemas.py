"""
Pydantic schemas for the Sale Process module.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


# ---------------------------------------------------------------------------
# Line Item Schemas
# ---------------------------------------------------------------------------

class SaleOrderItemCreate(BaseModel):
    product_id: uuid.UUID | None = None
    product_name: str = Field(..., min_length=1, max_length=255)
    product_code: str | None = None
    hsn_code: str | None = None
    quantity: float = Field(..., gt=0)
    unit_rate: float = Field(default=0.0, ge=0)
    tax_percent: float = Field(default=0.0, ge=0)
    tax_amount: float = Field(default=0.0, ge=0)
    item_total: float = Field(default=0.0, ge=0)
    planning_row_id: uuid.UUID | None = None
    remarks: str | None = None


class SaleOrderItemResponse(BaseModel):
    id: uuid.UUID
    order_id: uuid.UUID
    product_id: uuid.UUID | None = None
    product_name: str
    product_code: str | None = None
    hsn_code: str | None = None
    quantity: float
    unit_rate: float
    tax_percent: float
    tax_amount: float
    item_total: float
    planning_row_id: uuid.UUID | None = None
    remarks: str | None = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


# ---------------------------------------------------------------------------
# Order Create / Update Schemas
# ---------------------------------------------------------------------------

class SaleOrderCreate(BaseModel):
    organization_id: uuid.UUID
    organization_name: str = "Yinglima"
    buyer_id: uuid.UUID
    buyer_name: str
    buyer_branch_id: str | None = None
    buyer_branch_name: str | None = None

    consignment_code: str | None = None
    planning_sheet_id: uuid.UUID | None = None
    planning_column_id: uuid.UUID | None = None

    order_date: date
    delivery_date: date | None = None
    currency: str = "RMB"
    status: str = "pending"

    container_no: str | None = None
    bl_no: str | None = None
    lr_no: str | None = None
    transporter_name: str | None = None
    port_of_loading: str | None = None
    port_of_discharge: str | None = None
    remarks: str | None = None

    items: list[SaleOrderItemCreate] = Field(..., min_length=1)


class SaleOrderUpdate(BaseModel):
    buyer_id: uuid.UUID | None = None
    buyer_name: str | None = None
    buyer_branch_id: str | None = None
    buyer_branch_name: str | None = None

    consignment_code: str | None = None
    planning_sheet_id: uuid.UUID | None = None
    planning_column_id: uuid.UUID | None = None

    order_date: date | None = None
    delivery_date: date | None = None
    currency: str | None = None
    status: str | None = None

    container_no: str | None = None
    bl_no: str | None = None
    lr_no: str | None = None
    transporter_name: str | None = None
    port_of_loading: str | None = None
    port_of_discharge: str | None = None
    remarks: str | None = None

    items: list[SaleOrderItemCreate] | None = None


class SaleOrderStatusUpdate(BaseModel):
    status: str = Field(..., min_length=1, max_length=30)
    remarks: str | None = None


# ---------------------------------------------------------------------------
# Order Responses
# ---------------------------------------------------------------------------

class SaleOrderResponse(BaseModel):
    id: uuid.UUID
    order_no: str
    organization_id: uuid.UUID
    organization_name: str
    buyer_id: uuid.UUID
    buyer_name: str
    buyer_branch_id: str | None = None
    buyer_branch_name: str | None = None

    consignment_code: str | None = None
    planning_sheet_id: uuid.UUID | None = None
    planning_column_id: uuid.UUID | None = None

    order_date: date
    delivery_date: date | None = None
    currency: str
    status: str

    total_basic: float
    total_tax: float
    total_amount: float
    total_quantity: float
    item_count: int = 0

    container_no: str | None = None
    bl_no: str | None = None
    lr_no: str | None = None
    transporter_name: str | None = None
    port_of_loading: str | None = None
    port_of_discharge: str | None = None
    remarks: str | None = None

    created_by_name: str | None = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class SaleOrderDetailResponse(SaleOrderResponse):
    items: list[SaleOrderItemResponse] = []


# ---------------------------------------------------------------------------
# KPI Summary Metrics (Matches Darsh Impex reference)
# ---------------------------------------------------------------------------

class MetricItem(BaseModel):
    count: int = 0
    amount: float = 0.0


class SaleSummaryMetrics(BaseModel):
    all: MetricItem = Field(default_factory=MetricItem)
    pending: MetricItem = Field(default_factory=MetricItem)
    sales_confirmed: MetricItem = Field(default_factory=MetricItem)
    admin_approved: MetricItem = Field(default_factory=MetricItem)
    dispatched: MetricItem = Field(default_factory=MetricItem)
    lr: MetricItem = Field(default_factory=MetricItem)
    cancelled: MetricItem = Field(default_factory=MetricItem)
    currency: str = "RMB"


# ---------------------------------------------------------------------------
# Shipment Planning Consignment Integration Schemas
# ---------------------------------------------------------------------------

class PlanningConsignmentColumnResponse(BaseModel):
    sheet_id: uuid.UUID
    sheet_name: str
    column_id: uuid.UUID
    column_name: str
    code: str
    item_count: int = 0
    total_quantity: float = 0.0
    has_remarks_column: bool = False


class ExtractedConsignmentItem(BaseModel):
    product_id: uuid.UUID | None = None
    product_name: str
    product_code: str | None = None
    hsn_code: str | None = None
    quantity: float
    unit_rate: float = 0.0
    vat_rate: float = 0.0
    planning_row_id: uuid.UUID | None = None
    remarks: str | None = None


class PlanningConsignmentItemsResponse(BaseModel):
    sheet_id: uuid.UUID
    sheet_name: str
    column_id: uuid.UUID
    column_name: str
    consignment_code: str
    count: int
    total_quantity: float
    items: list[ExtractedConsignmentItem]
