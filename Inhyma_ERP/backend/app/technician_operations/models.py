"""ORM Models for Technician Operations, Spare Parts Gatepass, Wallet & Warranty Tracking."""

from __future__ import annotations

import uuid
from datetime import date, datetime

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Integer, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.base import GUID, Base, SoftDeleteMixin, TimestampMixin, UUIDPrimaryKeyMixin, VersionMixin


class MachineWarranty(Base, UUIDPrimaryKeyMixin, TimestampMixin, VersionMixin, SoftDeleteMixin):
    """Machine Serial Number and Warranty Lifecycle Tracking Record."""

    __tablename__ = "machine_warranties"

    serial_number: Mapped[str] = mapped_column(String(100), unique=True, nullable=False, index=True)
    machine_model: Mapped[str] = mapped_column(String(255), nullable=False)
    product_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("products.id", ondelete="SET NULL"), nullable=True, index=True
    )
    company_name: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    company_id: Mapped[uuid.UUID | None] = mapped_column(GUID(), nullable=True)

    invoice_number: Mapped[str | None] = mapped_column(String(100), nullable=True)
    invoice_date: Mapped[date] = mapped_column(Date, nullable=False)
    warranty_months: Mapped[int] = mapped_column(Integer, default=12, nullable=False)
    warranty_end_date: Mapped[date] = mapped_column(Date, nullable=False)

    # UNDER_WARRANTY, OUT_OF_WARRANTY, EXTENDED_AMC, VOIDED
    status: Mapped[str] = mapped_column(String(50), default="UNDER_WARRANTY", nullable=False, index=True)

    contact_person: Mapped[str | None] = mapped_column(String(150), nullable=True)
    contact_phone: Mapped[str | None] = mapped_column(String(50), nullable=True)
    installation_city: Mapped[str | None] = mapped_column(String(100), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    def is_currently_covered(self) -> bool:
        """Return True if status is UNDER_WARRANTY or EXTENDED_AMC and today is on or before expiry date."""
        if self.status in ("VOIDED", "OUT_OF_WARRANTY"):
            return False
        return date.today() <= self.warranty_end_date


class TechnicianGatepass(Base, UUIDPrimaryKeyMixin, TimestampMixin, VersionMixin, SoftDeleteMixin):
    """
    Outward Gatepass tracking spare parts taken out by service technicians.
    Tracks issuance, field usage, partial returns, and Sales Order reconciliation.
    """

    __tablename__ = "technician_gatepasses"

    gatepass_number: Mapped[str] = mapped_column(String(50), unique=True, nullable=False, index=True)
    technician_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("technicians.id", ondelete="SET NULL"), nullable=True, index=True
    )
    technician_name: Mapped[str] = mapped_column(String(150), nullable=False, index=True)
    technician_mobile: Mapped[str | None] = mapped_column(String(50), nullable=True)

    technical_task_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("technical_tasks.id", ondelete="SET NULL"), nullable=True, index=True
    )
    customer_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    machine_serial_number: Mapped[str | None] = mapped_column(String(100), nullable=True)
    is_warranty_service: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    issue_date: Mapped[date] = mapped_column(Date, default=date.today, nullable=False)
    issued_by_name: Mapped[str] = mapped_column(String(100), default="Warehouse", nullable=False)
    purpose: Mapped[str] = mapped_column(String(150), default="Field Service Call", nullable=False)

    # Status: ISSUED, PARTIALLY_RETURNED, RECONCILED, CLOSED, CANCELLED
    status: Mapped[str] = mapped_column(String(50), default="ISSUED", nullable=False, index=True)

    # Reconciliation controls
    so_required: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    so_number: Mapped[str | None] = mapped_column(String(100), nullable=True)
    so_created: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    return_gatepass_number: Mapped[str | None] = mapped_column(String(100), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    items: Mapped[list[TechnicianGatepassItem]] = relationship(
        "TechnicianGatepassItem",
        back_populates="gatepass",
        cascade="all, delete-orphan",
        order_by="TechnicianGatepassItem.created_at.asc()",
        lazy="selectin",
    )


class TechnicianGatepassItem(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """Line item in a technician spare parts gatepass."""

    __tablename__ = "technician_gatepass_items"

    gatepass_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("technician_gatepasses.id", ondelete="CASCADE"), nullable=False, index=True
    )
    product_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("products.id", ondelete="SET NULL"), nullable=True, index=True
    )
    product_code: Mapped[str | None] = mapped_column(String(50), nullable=True)
    product_name: Mapped[str] = mapped_column(String(255), nullable=False)
    uom: Mapped[str] = mapped_column(String(50), default="NOS", nullable=False)

    quantity_issued: Mapped[float] = mapped_column(Numeric(12, 3), default=1.0, nullable=False)
    quantity_consumed: Mapped[float] = mapped_column(Numeric(12, 3), default=0.0, nullable=False)
    quantity_returned: Mapped[float] = mapped_column(Numeric(12, 3), default=0.0, nullable=False)
    unit_rate: Mapped[float | None] = mapped_column(Numeric(14, 2), nullable=True)

    is_warranty_covered: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    sales_order_number: Mapped[str | None] = mapped_column(String(100), nullable=True)

    # Item Status: ISSUED, CONSUMED_BILLED, CONSUMED_WARRANTY, RETURNED_GOOD, RETURNED_DEFECTIVE, DAMAGED
    item_status: Mapped[str] = mapped_column(String(50), default="ISSUED", nullable=False)
    remarks: Mapped[str | None] = mapped_column(String(255), nullable=True)

    gatepass: Mapped[TechnicianGatepass] = relationship("TechnicianGatepass", back_populates="items")


class TechnicianWalletTransaction(Base, UUIDPrimaryKeyMixin, TimestampMixin, VersionMixin, SoftDeleteMixin):
    """
    Cash and payment ledger for field technicians.
    Tracks money collected from customers, cash deposited to office, and approved expenses.
    """

    __tablename__ = "technician_wallet_transactions"

    transaction_number: Mapped[str] = mapped_column(String(50), unique=True, nullable=False, index=True)
    technician_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("technicians.id", ondelete="SET NULL"), nullable=True, index=True
    )
    technician_name: Mapped[str] = mapped_column(String(150), nullable=False, index=True)
    technical_task_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("technical_tasks.id", ondelete="SET NULL"), nullable=True, index=True
    )
    customer_name: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # Transaction Type: COLLECTION, HANDOVER_DEPOSIT, FIELD_EXPENSE
    transaction_type: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    amount: Mapped[float] = mapped_column(Numeric(14, 2), nullable=False)

    # Cash, UPI, Cheque, Bank Transfer, NEFT
    payment_mode: Mapped[str] = mapped_column(String(50), default="Cash", nullable=False)
    reference_no: Mapped[str | None] = mapped_column(String(100), nullable=True)
    transaction_date: Mapped[date] = mapped_column(Date, default=date.today, nullable=False)

    receipt_url: Mapped[str | None] = mapped_column(String(500), nullable=True)

    # Status: VERIFIED, PENDING_APPROVAL, REJECTED
    status: Mapped[str] = mapped_column(String(50), default="VERIFIED", nullable=False)
    verified_by: Mapped[str | None] = mapped_column(String(100), nullable=True)
    verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
