"""
Local Purchase Pydantic Schemas.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class LocalPurchaseItemBase(BaseModel):
    """Base fields for a local purchase line item."""

    product_id: uuid.UUID | None = None
    product_name: str = Field(..., min_length=1, max_length=255)
    product_code: str | None = Field(default=None, max_length=100)
    hsn_code: str | None = Field(default=None, max_length=50)
    quantity: float = Field(..., gt=0)
    unit_rate: float = Field(..., gt=0)
    vat_rate: float = Field(default=13.0, ge=0, le=100)


class LocalPurchaseItemCreate(LocalPurchaseItemBase):
    """Payload to create an item in a local purchase."""

    item_total: float | None = None
    vat_amount: float | None = None
    expense_per_unit: float | None = None
    unit_landing_rate: float | None = None
    total_landing_rate: float | None = None


class LocalPurchaseItemUpdate(LocalPurchaseItemBase):
    """Payload to update an existing item."""

    id: uuid.UUID | None = None
    item_total: float | None = None
    vat_amount: float | None = None
    expense_per_unit: float | None = None
    unit_landing_rate: float | None = None
    total_landing_rate: float | None = None


class LocalPurchaseItemResponse(LocalPurchaseItemBase):
    """Response representation of a line item."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    purchase_id: uuid.UUID
    item_total: float
    vat_amount: float
    expense_per_unit: float
    unit_landing_rate: float
    total_landing_rate: float
    created_at: datetime


class LocalPurchaseBase(BaseModel):
    """Base fields for a local purchase invoice."""

    organization_id: uuid.UUID
    organization_name: str = Field(..., min_length=1, max_length=150)
    branch_id: str = Field(..., min_length=1, max_length=100)
    branch_name: str = Field(..., min_length=1, max_length=150)
    supplier_id: uuid.UUID
    supplier_name: str = Field(..., min_length=1, max_length=200)
    invoice_no: str = Field(..., min_length=1, max_length=100)
    invoice_date: date
    currency: str = Field(default="RMB", max_length=10)
    invoice_total_value: float = Field(..., ge=0)
    bill_file_url: str | None = None

    packing_forwarding: float = Field(default=0.0, ge=0)
    transport_expense: float = Field(default=0.0, ge=0)
    offloading_expense: float = Field(default=0.0, ge=0)
    other_expense: float = Field(default=0.0, ge=0)
    remarks: str | None = None
    status: str = Field(default="Confirmed", max_length=30)


class LocalPurchaseCreate(LocalPurchaseBase):
    """Payload to create a new local purchase with items."""

    items: list[LocalPurchaseItemCreate] = Field(default_factory=list)


class LocalPurchaseUpdate(BaseModel):
    """Payload to update a local purchase with items."""

    organization_id: uuid.UUID | None = None
    organization_name: str | None = None
    branch_id: str | None = None
    branch_name: str | None = None
    supplier_id: uuid.UUID | None = None
    supplier_name: str | None = None
    invoice_no: str | None = None
    invoice_date: date | None = None
    currency: str | None = None
    invoice_total_value: float | None = None
    bill_file_url: str | None = None

    packing_forwarding: float | None = None
    transport_expense: float | None = None
    offloading_expense: float | None = None
    other_expense: float | None = None
    remarks: str | None = None
    status: str | None = None
    items: list[LocalPurchaseItemUpdate] | None = None


class LocalPurchaseSummaryResponse(BaseModel):
    """Summary item for the list view table."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    organization_id: uuid.UUID
    organization_name: str
    branch_id: str
    branch_name: str
    supplier_id: uuid.UUID
    supplier_name: str
    invoice_no: str
    invoice_date: date
    currency: str
    invoice_total_value: float
    bill_file_url: str | None = None
    total_expenses: float
    loading_expense_pct: float
    items_total_basic: float
    items_total_vat: float
    items_total_landing: float
    total_quantity: float
    items_count: int = 0
    remarks: str | None = None
    status: str
    created_by_name: str | None = None
    created_at: datetime
    updated_at: datetime


class LocalPurchaseDetailResponse(LocalPurchaseSummaryResponse):
    """Detailed response including full line items."""

    packing_forwarding: float = 0.0
    transport_expense: float = 0.0
    offloading_expense: float = 0.0
    other_expense: float = 0.0
    items: list[LocalPurchaseItemResponse] = Field(default_factory=list)


class BillExtractionItem(BaseModel):
    """Extracted item row from bill upload."""

    product_name: str
    product_code: str | None = None
    hsn_code: str | None = None
    quantity: float = 1.0
    unit_rate: float = 0.0
    vat_rate: float = 13.0
    item_total: float = 0.0
    matched_product_id: uuid.UUID | None = None


class BillExtractionResponse(BaseModel):
    """Extracted form data from uploaded bill file."""

    supplier_name: str | None = None
    supplier_id: uuid.UUID | None = None
    invoice_no: str | None = None
    invoice_date: date | None = None
    currency: str = "RMB"
    invoice_total_value: float | None = None
    items: list[BillExtractionItem] = Field(default_factory=list)
    confidence: float = 1.0
    notes: str | None = None
