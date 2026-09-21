"""
Pydantic Schemas for the Sales module.

Proforma Invoices first; Sales Process, Discount Payments, and a
customer-facing Quotation schema follow later in this same file per the
initial scoping decision to build Proforma alone first.
"""

from __future__ import annotations

from typing import List, Optional

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
