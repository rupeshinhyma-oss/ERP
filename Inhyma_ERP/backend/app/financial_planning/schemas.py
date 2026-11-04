"""Pydantic schemas for Financial Planning Report endpoints."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


class FinancialPlanningTermsUpdate(BaseModel):
    """Payload to update Payment Terms, Due Date, Remarks, and optional Payment Terms attachment."""

    payment_terms: str | None = Field(default=None, max_length=150)
    due_date: str | None = Field(default=None, max_length=50)
    remarks: str | None = None
    payment_attachment_url: str | None = Field(default=None, max_length=500)
    payment_attachment_name: str | None = Field(default=None, max_length=255)


class FinancialPlanningPaymentRecord(BaseModel):
    """Payload to record a partial or full payment against a Financial Planning entry."""

    amount: float = Field(..., gt=0, description="Payment amount in the entry's currency (INR or USD)")
    payment_mode: str | None = Field(default=None, max_length=100)
    payment_date: str | None = Field(default=None, max_length=50)
    reference_no: str | None = Field(default=None, max_length=150)
    remarks: str | None = None
    payment_attachment_url: str | None = Field(default=None, max_length=500)
    payment_attachment_name: str | None = Field(default=None, max_length=255)


class FinancialPlanningAttachmentUpdate(BaseModel):
    """Payload to attach or replace an Invoice or Payment document on a Financial Planning entry."""

    attachment_type: Literal["invoice", "payment"] = "invoice"
    file_url: str = Field(..., min_length=1, max_length=500)
    file_name: str | None = Field(default=None, max_length=255)


class FinancialPlanningKpis(BaseModel):
    inr_all: float = 0.0
    inr_paid: float = 0.0
    inr_balance: float = 0.0
    inr_count: int = 0
    usd_all: float = 0.0
    usd_paid: float = 0.0
    usd_balance: float = 0.0
    usd_count: int = 0
    pending_count: int = 0
    cleared_count: int = 0


class FinancialPlanningRecordOut(BaseModel):
    id: str
    entry_key: str
    party_name: str
    party_type: Literal["Supplier", "Taxes", "Customer"]
    invoice_no: str
    invoice_attachment_url: str | None = None
    invoice_attachment_name: str | None = None
    allow_invoice_upload: bool = True
    payment_terms: str | None = None
    payment_attachment_url: str | None = None
    payment_attachment_name: str | None = None
    currency: Literal["INR", "USD"] = "INR"
    total_amount: float = 0.0
    paid_amount: float = 0.0
    balance_amount: float = 0.0
    due_date: str | None = None
    status: Literal["Pending", "Cleared"] = "Pending"
    remarks: str | None = None
    source_module: Literal["import_purchase", "local_purchase", "sales_process"]
    source_label: str
    source_stage: str
    source_record_id: str
    payments_history: list[dict[str, Any]] = Field(default_factory=list)

