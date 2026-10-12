"""
Pydantic Schemas for the Sales module.

Proforma Invoices, Sales Process, and Discount Payments.
"""

from __future__ import annotations

from typing import Any, List, Optional

from datetime import date as _date

from pydantic import BaseModel, Field, model_validator


# ==============================================================================
# Proforma Invoice Schemas
# ==============================================================================

class ProformaLineItemSchema(BaseModel):
    """Line item belonging to a Proforma Invoice."""

    id: Optional[str] = None
    product_name: str
    product_code: Optional[str] = None
    hsn_code: Optional[str] = None
    gst_rate: Optional[str] = None
    quantity: float = Field(1.0, gt=0)
    uom: Optional[str] = None
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
    charge_type: Optional[str] = None


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
    remark: Optional[str] = None
    items: List[ProformaLineItemSchema] = Field(default_factory=list)
    # status, totals, discount, below_min_price and created_by are server-controlled


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
    taxable_amount: float = 0.0
    gst_amount: float = 0.0
    below_min_price: bool = False
    cancel_reason: Optional[str] = None
    approved_by: Optional[str] = None
    approved_at: Optional[str] = None
    confirmed_by: Optional[str] = None
    confirmed_at: Optional[str] = None
    cancelled_by: Optional[str] = None
    cancelled_at: Optional[str] = None
    items: List[ProformaLineItemSchema] = Field(default_factory=list)

    model_config = {"from_attributes": True}


class ProformaStatusUpdate(BaseModel):
    """Payload for PATCH /proforma-invoice/{id}/status."""

    status: str = Field(..., min_length=1)
    reason: Optional[str] = Field(None, description="Required when the DB rules say so (e.g. cancelling).")


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


def _to_date(value: Any) -> _date | None:
    """Dates arrive as JSON text (DD-MM-YYYY from the forms, or ISO): turn them into real dates, or fail clearly."""
    if value in (None, ""):
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, _date):
        return value
    text = str(value).strip()
    for fmt in ("%d-%m-%Y", "%Y-%m-%d", "%d/%m/%Y"):
        try:
            return datetime.strptime(text[:10], fmt).date()
        except ValueError:
            continue
    try:
        return datetime.fromisoformat(text).date()
    except ValueError as exc:
        raise ValueError(f"'{value}' is not a valid date (use DD-MM-YYYY).") from exc


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
    # what the Sales Process form sends (the server recomputes every amount; these are inputs only)
    hsn: str | None = None
    uom: str | None = None
    unit_price: float | None = Field(default=None, ge=0)
    unit_discount: float = Field(default=0.0, ge=0)
    gst_percent: float | None = Field(default=None, ge=0)
    is_additional_charge: bool = False
    charge_type: str | None = None
    serial_numbers: list[str] | None = None

    def as_priced_input(self) -> "ProformaLineItemSchema":
        """The shared pricing function (spec formula) works on Proforma lines; a sale-order line maps onto one 1:1."""
        price = self.unit_price if self.unit_price is not None else self.unit_rate
        return ProformaLineItemSchema(
            product_name=self.product_name, product_code=self.product_code, hsn_code=self.hsn_code or self.hsn,
            quantity=self.quantity, uom=self.uom, rate=price, unit_price=price, unit_discount=self.unit_discount,
            gst_percent=self.gst_percent if self.gst_percent is not None else self.tax_percent,
            is_additional_charge=self.is_additional_charge, charge_type=self.charge_type,
        )


class SaleOrderItemResponse(BaseModel):
    id: uuid.UUID
    order_id: uuid.UUID
    product_id: uuid.UUID | None = None
    product_name: str
    product_code: str | None = None
    hsn_code: str | None = None
    uom: str | None = "Nos"
    quantity: float
    unit_rate: float
    unit_price: float | None = None
    unit_discount: float | None = None
    taxable_amount: float | None = None
    tax_percent: float
    tax_amount: float
    gst_amount: float | None = None
    item_total: float
    planning_row_id: uuid.UUID | None = None
    remarks: str | None = None
    is_additional_charge: bool = False
    charge_type: str | None = None
    serial_numbers: list[str] | None = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


def _normalise_order_input(data: Any, *, creating: bool) -> Any:
    """Accept the names the Sales Process form uses and turn text dates into dates."""
    if not isinstance(data, dict):
        return data
    d = dict(data)
    company = (d.get("company_name") or "").strip()
    if not (d.get("buyer_name") or "").strip():
        if company:
            d["buyer_name"] = company
        elif creating:
            raise ValueError("Company (buyer) is required.")
    if not d.get("transporter_name") and d.get("transport_name"):
        d["transporter_name"] = d["transport_name"]
    if not d.get("delivery_date") and d.get("expected_delivery_date"):
        d["delivery_date"] = d["expected_delivery_date"]
    if creating:
        d["order_date"] = _to_date(d.get("order_date")) or _date.today()
    elif d.get("order_date") not in (None, ""):
        d["order_date"] = _to_date(d["order_date"])
    if "delivery_date" in d:
        d["delivery_date"] = _to_date(d.get("delivery_date"))
    return d


class SaleOrderCreate(BaseModel):
    organization_id: uuid.UUID | None = None
    organization_name: str = "Inhyma"
    buyer_id: uuid.UUID | None = None
    buyer_name: str
    buyer_branch_id: str | None = None
    buyer_branch_name: str | None = None

    company_name: str | None = None
    warehouse: str | None = None
    proforma_no: str | None = None
    proforma_id: uuid.UUID | None = None
    city: str | None = None
    state: str | None = None
    sales_person: str | None = None
    billing_address: str | None = None
    shipping_address: str | None = None
    payment_terms: str | None = None
    transport_destination: str | None = None
    delivery_type: str | None = None
    delivery_charge: str | None = None
    third_party_delivery: str | None = None
    third_party_invoice: str | None = None
    terms_and_conditions: str | None = None
    booking_remarks: str | None = None
    # totals are computed by the server from the lines; any client value is ignored
    amount_inc_gst: float | None = None
    discount: float | None = None

    consignment_code: str | None = None
    allocated_consignment: str | None = None
    planning_sheet_id: uuid.UUID | None = None
    planning_column_id: uuid.UUID | None = None

    order_date: _date
    delivery_date: _date | None = None
    currency: str = "INR"
    status: str = "pending"  # ignored: a new order always starts at the workflow's initial status

    container_no: str | None = None
    bl_no: str | None = None
    lr_no: str | None = None
    transporter_name: str | None = None
    port_of_loading: str | None = None
    port_of_discharge: str | None = None
    remarks: str | None = None

    items: list[SaleOrderItemCreate] = Field(..., min_length=1)

    @model_validator(mode="before")
    @classmethod
    def _normalise(cls, data: Any) -> Any:
        return _normalise_order_input(data, creating=True)


class SaleOrderUpdate(BaseModel):
    buyer_id: uuid.UUID | None = None
    buyer_name: str | None = None
    buyer_branch_id: str | None = None
    buyer_branch_name: str | None = None

    company_name: str | None = None
    warehouse: str | None = None
    proforma_no: str | None = None
    proforma_id: uuid.UUID | None = None
    city: str | None = None
    state: str | None = None
    sales_person: str | None = None
    billing_address: str | None = None
    shipping_address: str | None = None
    payment_terms: str | None = None
    transport_destination: str | None = None
    delivery_type: str | None = None
    delivery_charge: str | None = None
    third_party_delivery: str | None = None
    third_party_invoice: str | None = None
    terms_and_conditions: str | None = None
    booking_remarks: str | None = None
    amount_inc_gst: float | None = None
    discount: float | None = None

    # Invoicing & Gate Pass
    invoice_no: str | None = None
    invoice_date: str | None = None
    gatepass: str | None = None
    gatepass_no: str | None = None
    gatepass_date: str | None = None
    gatepass_handled_by: str | None = None

    consignment_code: str | None = None
    allocated_consignment: str | None = None
    planning_sheet_id: uuid.UUID | None = None
    planning_column_id: uuid.UUID | None = None

    order_date: _date | None = None
    delivery_date: _date | None = None
    currency: str | None = None
    status: str | None = None  # ignored: use the status endpoint

    container_no: str | None = None
    bl_no: str | None = None
    lr_no: str | None = None
    transporter_name: str | None = None
    port_of_loading: str | None = None
    port_of_discharge: str | None = None
    remarks: str | None = None

    items: list[SaleOrderItemCreate] | None = None

    @model_validator(mode="before")
    @classmethod
    def _normalise(cls, data: Any) -> Any:
        return _normalise_order_input(data, creating=False)


class SaleOrderStatusUpdate(BaseModel):
    status: str = Field(..., min_length=1, max_length=30)
    remarks: str | None = None
    invoice_no: str | None = None
    invoice_date: str | None = None
    third_party_invoice: str | None = None
    gatepass: str | None = None
    gatepass_no: str | None = None
    gatepass_date: str | None = None
    gatepass_handled_by: str | None = None
    transporter_name: str | None = None
    transport_destination: str | None = None
    delivery_type: str | None = None
    delivery_charge: str | None = None
    lr_no: str | None = None


class SaleOrderResponse(BaseModel):
    id: uuid.UUID
    order_no: str
    organization_id: uuid.UUID | None = None
    organization_name: str | None = "Inhyma"
    buyer_id: uuid.UUID | None = None
    buyer_name: str
    buyer_branch_id: str | None = None
    buyer_branch_name: str | None = None

    company_name: str | None = None
    warehouse: str | None = None
    proforma_no: str | None = None
    proforma_id: uuid.UUID | None = None
    city: str | None = None
    state: str | None = None
    sales_person: str | None = None
    billing_address: str | None = None
    shipping_address: str | None = None
    payment_terms: str | None = None
    transport_destination: str | None = None
    delivery_type: str | None = None
    delivery_charge: str | None = None
    third_party_delivery: str | None = None
    third_party_invoice: str | None = None
    amount_inc_gst: float | None = None
    discount: float | None = None

    invoice_no: str | None = None
    invoice_date: str | None = None
    gatepass: str | None = None
    gatepass_no: str | None = None
    gatepass_date: str | None = None
    gatepass_handled_by: str | None = None

    consignment_code: str | None = None
    allocated_consignment: str | None = None
    planning_sheet_id: uuid.UUID | None = None
    planning_column_id: uuid.UUID | None = None

    order_date: Any
    delivery_date: Any | None = None
    currency: str
    status: str
    cancel_reason: str | None = None
    stock_applied: bool = False
    terms_and_conditions: str | None = None
    booking_remarks: str | None = None

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
    admin_confirmed_to_lr: MetricItem = Field(default_factory=MetricItem)
    pending: MetricItem = Field(default_factory=MetricItem)
    sales_confirmed: MetricItem = Field(default_factory=MetricItem)
    admin_approved: MetricItem = Field(default_factory=MetricItem)
    acc_confirmed: MetricItem = Field(default_factory=MetricItem)
    gatepass_created: MetricItem = Field(default_factory=MetricItem)
    gatepass_cancelled: MetricItem = Field(default_factory=MetricItem)
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