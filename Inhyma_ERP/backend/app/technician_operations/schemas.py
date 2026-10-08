"""Pydantic schemas for Technician Gatepass, Wallet Management & Warranty System."""

from __future__ import annotations

import uuid
from datetime import date, datetime
from pydantic import BaseModel, ConfigDict, Field


# ---------------------------------------------------------------------------
# Machine Warranty Schemas
# ---------------------------------------------------------------------------

class WarrantyRegisterPayload(BaseModel):
    """Payload to register a machine serial number and warranty policy."""

    serial_number: str = Field(..., min_length=2, max_length=100)
    machine_model: str = Field(..., min_length=2, max_length=255)
    product_id: uuid.UUID | None = None
    company_name: str = Field(..., min_length=2, max_length=255)
    company_id: uuid.UUID | None = None
    invoice_number: str | None = None
    invoice_date: date
    warranty_months: int = Field(default=12, ge=1, le=120)
    contact_person: str | None = None
    contact_phone: str | None = None
    installation_city: str | None = None
    notes: str | None = None


class WarrantyRead(BaseModel):
    """Warranty record representation."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    serial_number: str
    machine_model: str
    product_id: uuid.UUID | None = None
    company_name: str
    company_id: uuid.UUID | None = None
    invoice_number: str | None = None
    invoice_date: date
    warranty_months: int
    warranty_end_date: date
    status: str
    contact_person: str | None = None
    contact_phone: str | None = None
    installation_city: str | None = None
    notes: str | None = None
    created_at: datetime
    is_currently_covered: bool = False
    days_remaining: int = 0


class WarrantyValidationResult(BaseModel):
    """Quick validation result for machine serial number."""

    serial_number: str
    is_registered: bool
    is_covered: bool
    status: str
    company_name: str | None = None
    machine_model: str | None = None
    invoice_date: date | None = None
    warranty_end_date: date | None = None
    message: str


# ---------------------------------------------------------------------------
# Technician Spare Parts Gatepass Schemas
# ---------------------------------------------------------------------------

class GatepassItemCreate(BaseModel):
    """Line item when issuing spare parts on gatepass."""

    product_id: uuid.UUID | None = None
    product_code: str | None = None
    product_name: str = Field(..., min_length=1, max_length=255)
    uom: str = "NOS"
    quantity_issued: float = Field(..., gt=0)
    unit_rate: float | None = Field(default=None, ge=0)
    remarks: str | None = None


class GatepassCreate(BaseModel):
    """Payload to create an Outward Gatepass for technician."""

    technician_id: uuid.UUID | None = None
    technician_name: str = Field(..., min_length=2, max_length=150)
    technician_mobile: str | None = None
    technical_task_id: uuid.UUID | None = None
    customer_name: str | None = None
    machine_serial_number: str | None = None
    purpose: str = Field(default="Field Service Call", max_length=150)
    issue_date: date = Field(default_factory=date.today)
    issued_by_name: str = "Warehouse"
    notes: str | None = None
    items: list[GatepassItemCreate] = Field(..., min_length=1)


class GatepassItemReturnPayload(BaseModel):
    """Reconciliation values for one item upon partial or full return."""

    item_id: uuid.UUID
    quantity_returned: float = Field(default=0.0, ge=0)
    quantity_consumed: float = Field(default=0.0, ge=0)
    is_warranty_covered: bool = False
    item_status: str = "RETURNED_GOOD"  # RETURNED_GOOD, RETURNED_DEFECTIVE, CONSUMED_BILLED, CONSUMED_WARRANTY
    remarks: str | None = None


class GatepassReturnPayload(BaseModel):
    """Payload when technician returns from field to warehouse."""

    return_gatepass_number: str | None = None
    notes: str | None = None
    items: list[GatepassItemReturnPayload]


class GatepassLinkSOPayload(BaseModel):
    """Link a Sales Order created by salesperson for consumed parts."""

    sales_order_number: str = Field(..., min_length=2, max_length=100)
    notes: str | None = None


class GatepassItemRead(BaseModel):
    """Read representation of an item on gatepass."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    gatepass_id: uuid.UUID
    product_id: uuid.UUID | None = None
    product_code: str | None = None
    product_name: str
    uom: str
    quantity_issued: float
    quantity_consumed: float
    quantity_returned: float
    unit_rate: float | None = None
    is_warranty_covered: bool = False
    sales_order_number: str | None = None
    item_status: str
    remarks: str | None = None


class GatepassRead(BaseModel):
    """Full representation of a Technician Gatepass."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    gatepass_number: str
    technician_id: uuid.UUID | None = None
    technician_name: str
    technician_mobile: str | None = None
    technical_task_id: uuid.UUID | None = None
    customer_name: str | None = None
    machine_serial_number: str | None = None
    is_warranty_service: bool
    issue_date: date
    issued_by_name: str
    purpose: str
    status: str
    so_required: bool
    so_number: str | None = None
    so_created: bool
    return_gatepass_number: str | None = None
    notes: str | None = None
    created_at: datetime
    items: list[GatepassItemRead] = Field(default_factory=list)

    total_issued: float = 0.0
    total_consumed: float = 0.0
    total_returned: float = 0.0
    pending_return: float = 0.0
    reconciliation_message: str = ""


class DraftSOGenerationResponse(BaseModel):
    """Pre-formatted draft Sales Order payload for salesperson to bill consumed parts."""

    customer_name: str
    machine_serial_number: str | None = None
    gatepass_number: str
    items_to_bill: list[dict]
    estimated_subtotal: float
    message: str


# ---------------------------------------------------------------------------
# Technician Payment & Wallet Schemas
# ---------------------------------------------------------------------------

class WalletTransactionCreate(BaseModel):
    """Record a collection, handover deposit, or approved expense."""

    technician_id: uuid.UUID | None = None
    technician_name: str = Field(..., min_length=2, max_length=150)
    technical_task_id: uuid.UUID | None = None
    customer_name: str | None = None
    transaction_type: str = Field(..., pattern="^(COLLECTION|HANDOVER_DEPOSIT|FIELD_EXPENSE)$")
    amount: float = Field(..., gt=0)
    payment_mode: str = Field(default="Cash", max_length=50)
    reference_no: str | None = None
    transaction_date: date = Field(default_factory=date.today)
    receipt_url: str | None = None
    notes: str | None = None


class WalletTransactionRead(BaseModel):
    """Ledger transaction record."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    transaction_number: str
    technician_id: uuid.UUID | None = None
    technician_name: str
    technical_task_id: uuid.UUID | None = None
    customer_name: str | None = None
    transaction_type: str
    amount: float
    payment_mode: str
    reference_no: str | None = None
    transaction_date: date
    receipt_url: str | None = None
    status: str
    verified_by: str | None = None
    verified_at: datetime | None = None
    notes: str | None = None
    created_at: datetime


class TechnicianWalletSummary(BaseModel):
    """Technician-wise wallet balance summary card."""

    technician_id: uuid.UUID | None = None
    technician_name: str
    technician_mobile: str | None = None
    total_collected: float = 0.0
    total_deposited: float = 0.0
    total_expenses: float = 0.0
    net_wallet_balance: float = 0.0
    status: str = "CLEAR"  # CLEAR, PENDING_DEPOSIT, REIMBURSEMENT_DUE
    last_transaction_date: date | None = None


class TechnicianOperationsMetrics(BaseModel):
    """High level KPI metrics for technician operations."""

    active_gatepasses: int = 0
    pending_reconciliations: int = 0
    pending_sales_orders: int = 0
    total_wallet_cash_held: float = 0.0
    total_warranties_active: int = 0
