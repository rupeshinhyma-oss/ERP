"""Pydantic Schemas for Product Prices Directory."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class ProductPriceItem(BaseModel):
    """Product summary row with best supplier price."""

    model_config = ConfigDict(from_attributes=True)

    product_id: uuid.UUID
    product_code: str | None = None
    product_name: str
    product_name_tally: str
    barcode: str | None = None
    category_id: uuid.UUID | None = None
    category_name: str | None = None
    sub_category_id: uuid.UUID | None = None
    sub_category_name: str | None = None
    brand_id: uuid.UUID | None = None
    brand_name: str | None = None
    uom_id: uuid.UUID | None = None
    uom_code: str | None = None
    images: list[str] | None = None
    best_price: float | None = None
    best_currency: str | None = None
    primary_supplier_id: uuid.UUID | None = None
    primary_supplier_name: str | None = None
    primary_link_id: uuid.UUID | None = None
    supplier_count: int = 0
    has_price: bool = False
    is_preferred: bool = False


class ProductPriceSupplierItem(BaseModel):
    """Supplier quote and details for an individual product."""

    model_config = ConfigDict(from_attributes=True)

    link_id: uuid.UUID
    product_id: uuid.UUID
    supplier_id: uuid.UUID
    supplier_name: str
    supplier_code: str | None = None
    contact_calling_number: str | None = None
    contact_whatsapp_number: str | None = None
    contact_wechat_number: str | None = None
    city_name: str | None = None
    state_name: str | None = None
    country_name: str | None = None
    unit_price: float | None = None
    currency: str = "CNY"
    moq: float | None = None
    notes: str | None = None
    updated_at: datetime | None = None
    created_at: datetime | None = None
    is_preferred: bool = False


class AssignSupplierPricePayload(BaseModel):
    """Payload to link/update a supplier price for a product."""

    product_id: uuid.UUID
    supplier_id: uuid.UUID
    unit_price: float | None = None
    currency: str = Field(default="CNY", max_length=10)
    moq: float | None = None
    notes: str | None = None
    is_preferred: bool = False


class SetPreferredSupplierPayload(BaseModel):
    """Payload to manually choose or clear preferred supplier."""

    supplier_id: uuid.UUID | None = None


class UpdatePricePayload(BaseModel):
    """Payload to inline-edit a price link."""

    unit_price: float | None = None
    currency: str | None = Field(default=None, max_length=10)
    moq: float | None = None
    notes: str | None = None


class PriceImportSummary(BaseModel):
    """Summary of universal bulk price import."""

    total_rows: int = 0
    created: int = 0
    updated: int = 0
    failed: int = 0
    errors: list[dict[str, Any]] = Field(default_factory=list)


class PurchaseHistoryRecord(BaseModel):
    """A single purchase event (vendor invoice, quotation, or active catalog quote)."""

    model_config = ConfigDict(from_attributes=True)

    record_type: str  # "invoice" | "quote" | "catalog"
    item_id: str | None = None
    doc_id: str | None = None
    doc_number: str
    record_date: str | None = None
    supplier_id: str | None = None
    supplier_name: str
    quantity: float | None = None
    unit_rate: float
    unit_landing_rate: float | None = None
    currency: str = "CNY"
    total_amount: float | None = None
    status: str | None = None
    remarks: str | None = None


class SalesHistoryRecord(BaseModel):
    """A single sales event (sales order or buyer inquiry requirement)."""

    model_config = ConfigDict(from_attributes=True)

    record_type: str  # "order" | "inquiry"
    item_id: str | None = None
    doc_id: str | None = None
    doc_number: str
    consignment_code: str | None = None
    record_date: str | None = None
    buyer_id: str | None = None
    buyer_name: str
    quantity: float
    unit_rate: float
    currency: str = "RMB"
    item_total: float | None = None
    status: str | None = None
    margin_percent: float | None = None
    remarks: str | None = None


class ProductTradeHistoryMetrics(BaseModel):
    """Executive KPI summary comparing latest purchase vs latest selling rates."""

    model_config = ConfigDict(from_attributes=True)

    latest_purchase_rate: float | None = None
    latest_purchase_currency: str | None = None
    latest_purchase_landing_rate: float | None = None
    latest_purchase_date: str | None = None
    latest_supplier_name: str | None = None
    latest_purchase_type: str | None = None  # "invoice" | "quote" | "catalog"

    latest_sales_rate: float | None = None
    latest_sales_currency: str | None = None
    latest_sales_date: str | None = None
    latest_buyer_name: str | None = None

    estimated_margin_percent: float | None = None
    estimated_profit_per_unit: float | None = None
    profit_currency: str | None = None

    total_purchased_qty: float = 0.0
    total_sold_qty: float = 0.0


class ProductTradeHistoryResponse(BaseModel):
    """Full 360-degree trade history for a product."""

    model_config = ConfigDict(from_attributes=True)

    product_id: uuid.UUID
    product_code: str | None = None
    product_name: str
    product_name_tally: str | None = None
    uom_code: str | None = None
    metrics: ProductTradeHistoryMetrics
    purchases: list[PurchaseHistoryRecord] = Field(default_factory=list)
    sales: list[SalesHistoryRecord] = Field(default_factory=list)

