"""Pydantic schemas for the Cargo Overview module."""

from __future__ import annotations

from datetime import date
from typing import Literal, Optional

from pydantic import BaseModel, Field


CargoStageLiteral = Literal["pending", "cleared", "all"]
CargoCurrencyLiteral = Literal["INR", "USD"]
CargoPartyRoleLiteral = Literal[
    "Supplier",
    "Cargo Forwarder",
    "Clearing Agent",
    "Taxes",
    "Customer",
]


class CargoFinanceLine(BaseModel):
    id: str
    role: CargoPartyRoleLiteral = "Supplier"
    party_name: str
    doc_no: str
    payment_terms: str | None = None
    attachment_url: str | None = None
    attachment_name: str | None = None
    currency: CargoCurrencyLiteral = "INR"
    total_amount: float = 0.0
    paid_amount: float = 0.0
    balance_amount: float = 0.0
    due_date: date | None = None
    stage: Literal["pending", "cleared"] = "pending"
    source_module: str | None = None
    source_record_id: str | None = None


class CargoDocumentSlot(BaseModel):
    slot_key: str
    label: str
    file_url: str | None = None
    filename: str | None = None
    uploaded_at: str | None = None
    uploaded_by: str | None = None
    is_auto_linked: bool = False


class CargoChecklistItem(BaseModel):
    key: str
    label: str
    value: bool = False


class CargoProductLine(BaseModel):
    sr_no: int
    product_name: str
    product_code: str | None = None
    hsn_code: str | None = None
    quantity: float = 0.0
    uom: str = "PCS"
    batch_no: str | None = None
    supplier_name: str | None = None
    source_doc_no: str | None = None


class CargoOverviewRow(BaseModel):
    consignment_key: str
    display_title: str
    invoice_or_order_summary: str
    batch_no: str | None = None
    supplier_summary: str = "—"
    warehouse: str | None = None
    ordered_date: date | None = None
    etd_origin_date: date | None = None
    eta_port_date: date | None = None
    expected_arrival_date: date | None = None
    forwarder_name: str | None = None
    clearing_agent_name: str | None = None
    cargo_remarks: str | None = None
    source_module: str | None = None
    source_record_id: str | None = None

    pi_file_url: str | None = None
    overall_stage: Literal["pending", "cleared"] = "pending"
    docs_uploaded_count: int = 0
    docs_total_count: int = 22
    checklist_yes_count: int = 0
    checklist_total_count: int = 12

    finance_rows: list[CargoFinanceLine] = Field(default_factory=list)
    documents: list[CargoDocumentSlot] = Field(default_factory=list)
    checklist: list[CargoChecklistItem] = Field(default_factory=list)
    products: list[CargoProductLine] = Field(default_factory=list)


class CargoOverviewListResponse(BaseModel):
    total_consignments: int = 0
    pending_consignments: int = 0
    cleared_consignments: int = 0
    warehouses: list[str] = Field(default_factory=list)
    items: list[CargoOverviewRow] = Field(default_factory=list)


class CargoOverviewCreatePayload(BaseModel):
    consignment_key: str = Field(..., min_length=1, max_length=120)
    display_title: str | None = Field(default=None, max_length=150)
    invoice_or_order_no: str | None = Field(default=None, max_length=150)
    batch_no: str | None = Field(default=None, max_length=120)
    supplier_name: str | None = Field(default=None, max_length=255)
    warehouse: str | None = Field(default=None, max_length=100)
    ordered_date: date | None = None
    etd_origin_date: date | None = None
    eta_port_date: date | None = None
    expected_arrival_date: date | None = None
    forwarder_name: str | None = Field(default=None, max_length=150)
    clearing_agent_name: str | None = Field(default=None, max_length=150)
    cargo_remarks: str | None = None
    finance_lines: Optional[list[CargoFinanceLine]] = None
    products: Optional[list[CargoProductLine]] = None


class CargoChecklistUpdatePayload(BaseModel):
    checklist: dict[str, bool] | None = None
    cargo_remarks: str | None = None
    etd_origin_date: date | None = None
    eta_port_date: date | None = None
    expected_arrival_date: date | None = None
    forwarder_name: str | None = None
    clearing_agent_name: str | None = None
    batch_no: str | None = None
