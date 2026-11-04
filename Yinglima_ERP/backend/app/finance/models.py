"""
SQLAlchemy ORM Models for the Financial Report & Payment Planner Module.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    Date,
    DateTime,
    Index,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.database.base import Base


class FinanceRecordMeta(Base):
    """
    Stores supplementary financial planning metadata for a confirmed
    LocalPurchase (`source_type='local_purchase'`) or SaleOrder (`source_type='sale_order'`).
    """

    __tablename__ = "finance_record_meta"
    __table_args__ = (
        UniqueConstraint("source_type", "source_id", name="uq_finance_record_meta_source"),
        Index("ix_finance_record_meta_source", "source_type", "source_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    source_type: Mapped[str] = mapped_column(String(32), nullable=False)
    source_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)

    # Shared / Local Purchase financial fields
    payment_terms: Mapped[str | None] = mapped_column(String(120), nullable=True)
    expected_dispatch_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    due_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    delivery_status: Mapped[str | None] = mapped_column(String(80), nullable=True)
    attachment_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Sales Process / Export & Agent Freight Bill fields (Manager's Excel Tabs 3 & 4)
    tt_received_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    expected_stuffing_date: Mapped[str | None] = mapped_column(String(100), nullable=True)
    bl_details: Mapped[str | None] = mapped_column(String(150), nullable=True)
    bl_status: Mapped[str | None] = mapped_column(String(80), nullable=True)
    bill_status: Mapped[str | None] = mapped_column(String(80), nullable=True)
    agent_name: Mapped[str | None] = mapped_column(String(150), nullable=True)
    agent_local_charge: Mapped[Decimal] = mapped_column(
        Numeric(15, 2), nullable=False, default=Decimal("0.00")
    )
    agent_freight_charge: Mapped[Decimal] = mapped_column(
        Numeric(15, 2), nullable=False, default=Decimal("0.00")
    )
    agent_inv_amount: Mapped[Decimal] = mapped_column(
        Numeric(15, 2), nullable=False, default=Decimal("0.00")
    )
    agent_payment_date: Mapped[date | None] = mapped_column(Date, nullable=True)

    updated_by_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    updated_by_name: Mapped[str | None] = mapped_column(String(150), nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )


class FinancePayment(Base):
    """
    Stores individual advance, partial, or full payment installments recorded
    against a Local Purchase (`local_purchase`) or Sale Process (`sale_order`).
    """

    __tablename__ = "finance_payments"
    __table_args__ = (
        Index("ix_finance_payments_source", "source_type", "source_id"),
        Index("ix_finance_payments_date", "payment_date"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    source_type: Mapped[str] = mapped_column(String(32), nullable=False)
    source_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)

    payment_date: Mapped[date] = mapped_column(Date, nullable=False)
    amount: Mapped[Decimal] = mapped_column(
        Numeric(15, 2), nullable=False, default=Decimal("0.00")
    )
    currency: Mapped[str] = mapped_column(String(16), nullable=False, default="RMB")
    payment_mode: Mapped[str | None] = mapped_column(String(100), nullable=True)
    bank_charges: Mapped[Decimal] = mapped_column(
        Numeric(15, 2), nullable=False, default=Decimal("0.00")
    )
    reference_no: Mapped[str | None] = mapped_column(String(150), nullable=True)
    attachment_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_by_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    created_by_name: Mapped[str | None] = mapped_column(String(150), nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )
    deleted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )


class ConsignmentOverviewMeta(Base):
    """
    Stores unified Consignment Gallery document slots (Supabase Storage URLs),
    Cargo Status shipment checklist toggles (Yes/No), and shipment metadata
    for a Consignment / Export Order (`consignment_key`).
    """

    __tablename__ = "consignment_overviews"
    __table_args__ = (
        UniqueConstraint("consignment_key", name="uq_consignment_overviews_key"),
        Index("ix_consignment_overviews_key", "consignment_key"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    consignment_key: Mapped[str] = mapped_column(String(120), nullable=False)

    # JSON objects stored as text for flexibility across document slots & checklist items
    documents_json: Mapped[str | None] = mapped_column(Text, nullable=True, default="{}")
    checklist_json: Mapped[str | None] = mapped_column(Text, nullable=True, default="{}")
    cargo_remarks: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Optional overrides for header dates / forwarder when no SaleOrder is created yet
    etd_origin_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    eta_port_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    forwarder_name: Mapped[str | None] = mapped_column(String(150), nullable=True)

    updated_by_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    updated_by_name: Mapped[str | None] = mapped_column(String(150), nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )


class VatReturnRecord(Base):
    """
    Stores Export VAT Return (China Export Tax Rebate / 出口退税) shipment ledger records.
    Supports both live Confirmed Sales Process orders (`source_type='sale_order'`)
    and imported/manual historical shipments (`source_type='manual'`).
    """

    __tablename__ = "vat_return_records"
    __table_args__ = (
        UniqueConstraint("exp_no", name="uq_vat_return_records_exp_no"),
        Index("ix_vat_return_records_exp_no", "exp_no"),
        Index("ix_vat_return_records_source", "source_type", "source_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    source_type: Mapped[str] = mapped_column(String(32), nullable=False, default="sale_order")
    source_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)

    exp_no: Mapped[str] = mapped_column(String(120), nullable=False)
    invoice_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    financial_year: Mapped[str | None] = mapped_column(String(32), nullable=True)
    consignment_code: Mapped[str | None] = mapped_column(String(120), nullable=True)
    buyer_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    organization_name: Mapped[str | None] = mapped_column(String(150), nullable=True)

    first_filing_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    receiving_date_text: Mapped[str | None] = mapped_column(String(150), nullable=True)
    status_override: Mapped[str | None] = mapped_column(String(40), nullable=True)

    total_rmb_incl_vat_override: Mapped[Decimal | None] = mapped_column(
        Numeric(15, 2), nullable=True
    )
    total_vat_return_override: Mapped[Decimal | None] = mapped_column(
        Numeric(15, 2), nullable=True
    )

    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    items_override_json: Mapped[str | None] = mapped_column(Text, nullable=True, default="[]")

    updated_by_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    updated_by_name: Mapped[str | None] = mapped_column(String(150), nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )
    deleted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )


class VatReturnReceipt(Base):
    """
    Stores full or partial VAT refund receipts from the China Tax Bureau
    against a VatReturnRecord.
    """

    __tablename__ = "vat_return_receipts"
    __table_args__ = (
        Index("ix_vat_return_receipts_record", "vat_record_id"),
        Index("ix_vat_return_receipts_exp_no", "exp_no"),
        Index("ix_vat_return_receipts_date", "receipt_date"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    vat_record_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    exp_no: Mapped[str] = mapped_column(String(120), nullable=False)

    receipt_date: Mapped[date] = mapped_column(Date, nullable=False)
    amount_rmb: Mapped[Decimal] = mapped_column(
        Numeric(15, 2), nullable=False, default=Decimal("0.00")
    )
    reference_no: Mapped[str | None] = mapped_column(String(150), nullable=True)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_by_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    created_by_name: Mapped[str | None] = mapped_column(String(150), nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )
    deleted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
