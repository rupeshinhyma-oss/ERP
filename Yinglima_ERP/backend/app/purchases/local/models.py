"""
Local Purchase ORM Models.

Owns `local_purchases` and `local_purchase_items` tables for domestic procurement,
value-based (VB) landing expense distribution, and invoice tracking.
"""

from __future__ import annotations

import uuid
from datetime import date

from sqlalchemy import Date, ForeignKey, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.base import GUID, Base, SoftDeleteMixin, TimestampMixin, UUIDPrimaryKeyMixin


class LocalPurchase(Base, UUIDPrimaryKeyMixin, TimestampMixin, SoftDeleteMixin):
    """Local Purchase Order / Vendor Invoice record."""

    __tablename__ = "local_purchases"

    organization_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("master_companies.id"), nullable=False, index=True
    )
    organization_name: Mapped[str] = mapped_column(String(150), nullable=False)
    branch_id: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    branch_name: Mapped[str] = mapped_column(String(150), nullable=False)

    supplier_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("suppliers.id"), nullable=False, index=True
    )
    supplier_name: Mapped[str] = mapped_column(String(200), nullable=False)

    invoice_no: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    invoice_date: Mapped[date] = mapped_column(Date, nullable=False)
    currency: Mapped[str] = mapped_column(String(10), default="RMB", nullable=False)

    # Single invoice total value with VAT
    invoice_total_value: Mapped[float] = mapped_column(Numeric(15, 2), nullable=False)
    bill_file_url: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Expenses breakdown (all in purchase currency, default RMB)
    packing_forwarding: Mapped[float] = mapped_column(Numeric(12, 2), default=0.0, nullable=False)
    transport_expense: Mapped[float] = mapped_column(Numeric(12, 2), default=0.0, nullable=False)
    offloading_expense: Mapped[float] = mapped_column(Numeric(12, 2), default=0.0, nullable=False)
    other_expense: Mapped[float] = mapped_column(Numeric(12, 2), default=0.0, nullable=False)
    total_expenses: Mapped[float] = mapped_column(Numeric(15, 2), default=0.0, nullable=False)
    loading_expense_pct: Mapped[float] = mapped_column(Numeric(6, 2), default=0.0, nullable=False)

    # Rollup totals
    items_total_basic: Mapped[float] = mapped_column(Numeric(15, 2), default=0.0, nullable=False)
    items_total_vat: Mapped[float] = mapped_column(Numeric(15, 2), default=0.0, nullable=False)
    items_total_landing: Mapped[float] = mapped_column(Numeric(15, 2), default=0.0, nullable=False)
    total_quantity: Mapped[float] = mapped_column(Numeric(12, 2), default=0.0, nullable=False)

    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(30), default="Confirmed", nullable=False, index=True)

    created_by_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("users.id"), nullable=True
    )
    created_by_name: Mapped[str | None] = mapped_column(String(150), nullable=True)

    # Relationship to line items
    items: Mapped[list[LocalPurchaseItem]] = relationship(
        "LocalPurchaseItem",
        back_populates="purchase",
        cascade="all, delete-orphan",
        order_by="LocalPurchaseItem.created_at",
    )

    def __repr__(self) -> str:
        return f"<LocalPurchase {self.invoice_no!r} - {self.supplier_name!r}>"


class LocalPurchaseItem(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """Line item in a Local Purchase order."""

    __tablename__ = "local_purchase_items"

    purchase_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("local_purchases.id", ondelete="CASCADE"), nullable=False, index=True
    )
    product_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("products.id", ondelete="SET NULL"), nullable=True, index=True
    )
    product_name: Mapped[str] = mapped_column(String(255), nullable=False)
    product_code: Mapped[str | None] = mapped_column(String(100), nullable=True)
    hsn_code: Mapped[str | None] = mapped_column(String(50), nullable=True)

    quantity: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False)
    unit_rate: Mapped[float] = mapped_column(Numeric(15, 2), nullable=False)
    vat_rate: Mapped[float] = mapped_column(Numeric(5, 2), default=13.0, nullable=False)
    item_total: Mapped[float] = mapped_column(Numeric(15, 2), nullable=False)  # quantity * unit_rate (Basic)
    vat_amount: Mapped[float] = mapped_column(Numeric(15, 2), default=0.0, nullable=False)

    # Value-Based (VB) allocated expenses & landing rates
    expense_per_unit: Mapped[float] = mapped_column(Numeric(12, 2), default=0.0, nullable=False)
    unit_landing_rate: Mapped[float] = mapped_column(Numeric(15, 2), nullable=False)
    total_landing_rate: Mapped[float] = mapped_column(Numeric(15, 2), nullable=False)

    purchase: Mapped[LocalPurchase] = relationship("LocalPurchase", back_populates="items")

    def __repr__(self) -> str:
        return f"<LocalPurchaseItem {self.product_name!r} qty={self.quantity}>"
