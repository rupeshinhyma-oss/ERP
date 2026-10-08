"""Pydantic schemas for Price List Management Module."""

from __future__ import annotations

import uuid
from datetime import datetime
from pydantic import BaseModel, ConfigDict, Field


class SupplierQuoteItem(BaseModel):
    """One supplier's quote / purchase price for a product."""

    model_config = ConfigDict(from_attributes=True)

    link_id: uuid.UUID
    supplier_id: uuid.UUID
    supplier_name: str
    supplier_code: str | None = None
    calling_number: str | None = None
    unit_price: float | None = None
    currency: str = "INR"
    moq: float | None = None
    notes: str | None = None
    updated_at: datetime | None = None


class PriceListItem(BaseModel):
    """Product item with full commercial pricing and GST computations."""

    model_config = ConfigDict(from_attributes=True)

    product_id: uuid.UUID
    product_code: str | None = None
    product_name: str
    product_name_tally: str
    product_name_invoice: str | None = None
    barcode: str | None = None

    category_id: uuid.UUID | None = None
    category_name: str | None = None
    sub_category_id: uuid.UUID | None = None
    sub_category_name: str | None = None
    brand_id: uuid.UUID | None = None
    brand_name: str | None = None
    uom_id: uuid.UUID | None = None
    uom_code: str | None = None

    hsn_id: uuid.UUID | None = None
    hsn_number: str | None = None
    gst_percent: float = 18.0
    import_duty_percent: float = 0.0

    current_stock: float = 0.0
    images: list[str] | None = None
    image_url: str | None = None
    status: str = "active"

    # Base (Exclusive of GST) Pricing
    standard_price: float | None = None
    minimum_price: float | None = None
    standard_cost: float | None = None

    # GST Calculation Amounts
    standard_price_gst_amount: float | None = None
    minimum_price_gst_amount: float | None = None
    standard_cost_gst_amount: float | None = None

    # Final (Inclusive of GST) Pricing
    standard_price_inc_gst: float | None = None
    minimum_price_inc_gst: float | None = None
    standard_cost_inc_gst: float | None = None

    # Margins
    margin_amount: float | None = None
    margin_percent: float | None = None

    # Status Flags
    has_price: bool = False
    has_min_price: bool = False
    supplier_count: int = 0
    suppliers: list[SupplierQuoteItem] = Field(default_factory=list)


class PriceListUpdatePayload(BaseModel):
    """Payload to update selling or minimum price for a single product."""

    standard_price: float | None = Field(default=None, ge=0)
    minimum_price: float | None = Field(default=None, ge=0)
    standard_cost: float | None = Field(default=None, ge=0)
    is_inclusive: bool = Field(
        default=False,
        description="If True, provided prices are treated as inclusive of GST, and base rates are back-calculated.",
    )


class BulkPriceUpdateItem(BaseModel):
    """One item in a bulk price update batch."""

    product_id: uuid.UUID
    standard_price: float | None = Field(default=None, ge=0)
    minimum_price: float | None = Field(default=None, ge=0)
    standard_cost: float | None = Field(default=None, ge=0)
    is_inclusive: bool = False


class BulkPriceUpdateRequest(BaseModel):
    """Payload to update multiple product prices in batch."""

    items: list[BulkPriceUpdateItem]


class AssignSupplierQuotePayload(BaseModel):
    """Assign or update a supplier quotation for a product."""

    supplier_id: uuid.UUID
    unit_price: float = Field(..., ge=0)
    currency: str = Field(default="INR", max_length=10)
    moq: float | None = Field(default=None, ge=0)
    notes: str | None = None


class PriceListMetrics(BaseModel):
    """Aggregated catalog metrics for Price List KPI cards."""

    total_products: int = 0
    priced_products: int = 0
    unpriced_products: int = 0
    avg_standard_price_ex_gst: float = 0.0
    avg_standard_price_inc_gst: float = 0.0
    avg_min_price_ex_gst: float = 0.0
    avg_min_price_inc_gst: float = 0.0


class PriceImportRowError(BaseModel):
    """Error detail for a failed row in price import."""

    row_number: int
    product_code: str | None = None
    error: str


class PriceImportSummary(BaseModel):
    """Summary of bulk price spreadsheet import."""

    total_rows: int = 0
    successful_updates: int = 0
    failed_rows: int = 0
    errors: list[PriceImportRowError] = Field(default_factory=list)

