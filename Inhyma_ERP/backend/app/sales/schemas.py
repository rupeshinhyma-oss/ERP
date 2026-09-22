"""
Pydantic Schemas for the Sales module.

Proforma Invoices, Sales Process, and Discount Payments.
"""

from __future__ import annotations

from typing import Any, List, Optional

from pydantic import BaseModel, Field


# ==============================================================================
# Proforma Invoice Schemas
# ==============================================================================

class ProformaLineItemSchema(BaseModel):
    """Line item belonging to a Proforma Invoice."""

    id: Optional[str] = None
    product_name: str
    product_code: Optional[str] = "-"
    hsn_code: Optional[str] = None
    gst_rate: Optional[str] = "18%"
    quantity: float = Field(1.0, gt=0)
    uom: str = "Nos"
    rate: float = Field(0.0, ge=0)
    amount: float = Field(0.0, ge=0)
    hsn: Optional[str] = None
    unit_price: Optional[float] = None
    unit_discount: Optional[float] = 0.0
    taxable_amount: Optional[float] = None
    gst_percent: Optional[float] = None
    gst_amount: Optional[float] = None
    total: Optional[float] = None
    is_additional_charge: Optional[bool] = False


class ProformaInvoiceCreate(BaseModel):
    """Payload to create a new Proforma Invoice."""

    proforma_date: str = Field(..., description="'DD-MM-YYYY'")
    expected_delivery_date: Optional[str] = Field(None, description="'DD-MM-YYYY'")
    warehouse: str = Field(..., description="Warehouse this proforma ships from")
    lead_source: Optional[str] = None
    company_name: str = Field(..., min_length=1, description="Buyer/company being invoiced")
    city: Optional[str] = None
    state: Optional[str] = None
    sales_person: Optional[str] = None
    payment_terms: Optional[str] = None
    transport_name: Optional[str] = None
    third_party_delivery: Optional[str] = None
    transport_destination: Optional[str] = None
    delivery_type: Optional[str] = None
    delivery_charge: Optional[str] = None
    billing_address: Optional[str] = None
    shipping_address: Optional[str] = None
    terms_and_conditions: Optional[str] = None
    amount_inc_gst: Optional[float] = Field(None, ge=0, description="Grand total, GST included -- computed from items if omitted")
    discount: float = Field(0.0, ge=0)
    status: str = Field("pending", description="'pending' | 'admin_approved' | 'confirmed' | 'cancelled'")
    remark: Optional[str] = None
    created_by: str = "Admin User"
    items: List[ProformaLineItemSchema] = Field(default_factory=list)


class ProformaInvoiceUpdate(BaseModel):
    """Payload to update an existing Proforma Invoice. All fields optional (partial update)."""

    proforma_date: Optional[str] = None
    expected_delivery_date: Optional[str] = None
    warehouse: Optional[str] = None
    lead_source: Optional[str] = None
    company_name: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    sales_person: Optional[str] = None
    payment_terms: Optional[str] = None
    transport_name: Optional[str] = None
    third_party_delivery: Optional[str] = None
    transport_destination: Optional[str] = None
    delivery_type: Optional[str] = None
    delivery_charge: Optional[str] = None
    billing_address: Optional[str] = None
    shipping_address: Optional[str] = None
    terms_and_conditions: Optional[str] = None
    amount_inc_gst: Optional[float] = Field(None, ge=0)
    discount: Optional[float] = Field(None, ge=0)
    status: Optional[str] = None
    remark: Optional[str] = None
    items: Optional[List[ProformaLineItemSchema]] = None


class ProformaInvoiceRead(BaseModel):
    """Full Proforma Invoice record, as returned by the API."""

    id: str
    proforma_no: str
    proforma_date: str
    expected_delivery_date: Optional[str] = None
    warehouse: str
    lead_source: Optional[str] = None
    company_name: str
    city: Optional[str] = None
    state: Optional[str] = None
    sales_person: Optional[str] = None
    payment_terms: Optional[str] = None
    transport_name: Optional[str] = None
    third_party_delivery: Optional[str] = None
    transport_destination: Optional[str] = None
    delivery_type: Optional[str] = None
    delivery_charge: Optional[str] = None
    billing_address: Optional[str] = None
    shipping_address: Optional[str] = None
    terms_and_conditions: Optional[str] = None
    amount_inc_gst: float
    discount: float
    status: str
    remark: Optional[str] = None
    created_by: str
    items: List[ProformaLineItemSchema] = Field(default_factory=list)

    model_config = {"from_attributes": True}


class ProformaStatusCounts(BaseModel):
    """Count for one status tab on the Proforma Invoices list page."""

    count: int = 0
    amount: float = 0.0


class ProformaTabCounts(BaseModel):
    """Count + ₹ amount total per status tab, matching the legacy ERP's
    ALL / PENDING / ADMIN APPROVED / CONFIRMED / CANCELLED summary cards."""

    all: ProformaStatusCounts = Field(default_factory=ProformaStatusCounts)
    pending: ProformaStatusCounts = Field(default_factory=ProformaStatusCounts)
    admin_approved: ProformaStatusCounts = Field(default_factory=ProformaStatusCounts)
    confirmed: ProformaStatusCounts = Field(default_factory=ProformaStatusCounts)
    cancelled: ProformaStatusCounts = Field(default_factory=ProformaStatusCounts)


# ==============================================================================
# Sale Process (SaleOrder) Schemas
# ==============================================================================

import uuid
from datetime import date, datetime
from pydantic import ConfigDict


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


class SaleOrderCreate(BaseModel):
    organization_id: uuid.UUID
    organization_name: str = "Inhyma"
    buyer_id: uuid.UUID
    buyer_name: str
    buyer_branch_id: str | None = None
    buyer_branch_name: str | None = None

    consignment_code: str | None = None
    planning_sheet_id: uuid.UUID | None = None
    planning_column_id: uuid.UUID | None = None

    order_date: Any
    delivery_date: Any | None = None
    currency: str = "INR"
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

    order_date: Any | None = None
    delivery_date: Any | None = None
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

    order_date: Any
    delivery_date: Any | None = None
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
    currency: str = "INR"


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


# ==============================================================================
# Discount Payment Schemas
# ==============================================================================

class DiscountPaymentCreate(BaseModel):
    order_ref: str
    customer_name: str
    sales_person: str | None = None
    total_order_amount: float
    discount_percent: float
    remarks: str | None = None


class DiscountPaymentResponse(BaseModel):
    id: uuid.UUID | str
    payment_no: str
    payment_date: str
    order_ref: str
    customer_name: str
    sales_person: str | None = None
    total_order_amount: float
    discount_percent: float
    discount_amount: float
    net_payable: float
    status: str
    remarks: str | None = None
    created_by: str

    model_config = ConfigDict(from_attributes=True)

