"""
Sales ORM Models.

Owns the tables backing the "SALE" section of the app (see
frontend/src/lib/nav.ts): Proforma Invoices, Sales Process,
and Discount Payments.

Deliberately follows the same pragmatic, denormalized-field style as
``app.inventory.models.StockAdjustment`` / ``StockTransfer`` (plain string
columns for company/warehouse/sales-person rather than FKs everywhere)
rather than the fully-relational style of ``app.masters.products`` --
this is a transactional order screen, not a shared master, and the two
sibling modules under INVENTORY already establish that this is the
house style for this class of screen. A first pass keeps Proforma
standalone (no FK to Buyers or Products yet); wiring it to real Buyer/
Product records is a deliberate later step, not an oversight.
"""

from __future__ import annotations

import uuid
from typing import Any, List, Optional

from sqlalchemy import Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.base import (
    GUID,
    Base,
    SoftDeleteMixin,
    TimestampMixin,
    UUIDPrimaryKeyMixin,
    VersionMixin,
)


class ProformaInvoice(Base, UUIDPrimaryKeyMixin, TimestampMixin, VersionMixin, SoftDeleteMixin):
    """
    A single Proforma Invoice header record.

    ``status`` drives the status-tab counts/totals on the list page
    (ALL / PENDING / ADMIN APPROVED / CONFIRMED / CANCELLED in the
    legacy ERP screenshot this was built from) -- stored as a plain
    lowercase string, matching StockTransfer.status's own convention,
    rather than a native DB enum, so a status can be renamed or a new
    one added without a migration.
    """

    __tablename__ = "proforma_invoices"

    proforma_no: Mapped[str] = mapped_column(String(50), unique=True, index=True, nullable=False)
    proforma_date: Mapped[str] = mapped_column(String(50), nullable=False, index=True)  # "DD-MM-YYYY", matches legacy display format
    expected_delivery_date: Mapped[Optional[str]] = mapped_column(String(50), nullable=True, index=True)

    warehouse: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    lead_source: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)

    company_name: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    city: Mapped[Optional[str]] = mapped_column(String(150), nullable=True)
    state: Mapped[Optional[str]] = mapped_column(String(150), nullable=True)

    sales_person: Mapped[Optional[str]] = mapped_column(String(150), nullable=True, index=True)

    amount_inc_gst: Mapped[float] = mapped_column(Float, default=0.0, server_default="0", nullable=False)
    discount: Mapped[float] = mapped_column(Float, default=0.0, server_default="0", nullable=False)

    status: Mapped[str] = mapped_column(String(30), default="pending", server_default="pending", index=True, nullable=False)
    remark: Mapped[Optional[str]] = mapped_column(Text, nullable=True)  # e.g. the "Remark" note shown under Admin Approved in the legacy screenshot

    created_by: Mapped[str] = mapped_column(String(100), default="Admin User", server_default="Admin User", nullable=False)

    items: Mapped[List["ProformaInvoiceLineItem"]] = relationship(
        "ProformaInvoiceLineItem",
        back_populates="proforma",
        cascade="all, delete-orphan",
        lazy="selectin",
    )

    def __repr__(self) -> str:
        """Return a debug-friendly representation."""
        return f"<ProformaInvoice proforma_no={self.proforma_no!r} status={self.status!r}>"


class ProformaInvoiceLineItem(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """
    A single product line on a Proforma Invoice.

    Kept denormalized (product_name/code as plain strings, not a
    product_id FK) for this first pass, matching
    StockAdjustmentLineItem's own precedent -- wiring this to the real
    Product Master is a deliberate later step per the initial scoping
    decision to keep Proforma standalone for now.
    """

    __tablename__ = "proforma_invoice_items"

    proforma_id: Mapped[uuid.UUID] = mapped_column(
        GUID(),
        ForeignKey("proforma_invoices.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    product_name: Mapped[str] = mapped_column(String(255), nullable=False)
    product_code: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    hsn_code: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    gst_rate: Mapped[Optional[str]] = mapped_column(String(20), default="18%", server_default="18%", nullable=True)
    quantity: Mapped[float] = mapped_column(Float, default=1.0, server_default="1", nullable=False)
    uom: Mapped[str] = mapped_column(String(50), default="Nos", server_default="Nos", nullable=False)
    rate: Mapped[float] = mapped_column(Float, default=0.0, server_default="0", nullable=False)
    amount: Mapped[float] = mapped_column(Float, default=0.0, server_default="0", nullable=False)

    proforma: Mapped["ProformaInvoice"] = relationship("ProformaInvoice", back_populates="items")

    def __repr__(self) -> str:
        """Return a debug-friendly representation."""
        return f"<ProformaInvoiceLineItem proforma_id={self.proforma_id!r} product_name={self.product_name!r}>"


class SaleOrder(Base, UUIDPrimaryKeyMixin, TimestampMixin, SoftDeleteMixin):
    """Sale Order record for commercial sale and consignment tracking."""

    __tablename__ = "sales_orders"

    order_no: Mapped[str] = mapped_column(String(100), unique=True, nullable=False, index=True)

    organization_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("master_companies.id"), nullable=False, index=True
    )
    organization_name: Mapped[str] = mapped_column(String(150), default="Inhyma", nullable=False)

    buyer_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("buyers.id"), nullable=False, index=True
    )
    buyer_name: Mapped[str] = mapped_column(String(200), nullable=False)
    buyer_branch_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    buyer_branch_name: Mapped[str | None] = mapped_column(String(150), nullable=True)

    consignment_code: Mapped[str | None] = mapped_column(String(100), nullable=True, index=True)
    planning_sheet_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("planning_sheets.id"), nullable=True
    )
    planning_column_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("planning_columns.id"), nullable=True
    )

    order_date: Mapped[Any] = mapped_column(String(50), nullable=False)
    delivery_date: Mapped[str | None] = mapped_column(String(50), nullable=True)
    currency: Mapped[str] = mapped_column(String(10), default="INR", nullable=False)

    status: Mapped[str] = mapped_column(String(30), default="pending", nullable=False, index=True)

    total_basic: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    total_tax: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    total_amount: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    total_quantity: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)

    container_no: Mapped[str | None] = mapped_column(String(100), nullable=True)
    bl_no: Mapped[str | None] = mapped_column(String(100), nullable=True)
    lr_no: Mapped[str | None] = mapped_column(String(100), nullable=True)
    transporter_name: Mapped[str | None] = mapped_column(String(150), nullable=True)
    port_of_loading: Mapped[str | None] = mapped_column(String(100), nullable=True)
    port_of_discharge: Mapped[str | None] = mapped_column(String(100), nullable=True)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_by_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("users.id"), nullable=True
    )
    created_by_name: Mapped[str | None] = mapped_column(String(150), nullable=True)

    items: Mapped[list["SaleOrderItem"]] = relationship(
        "SaleOrderItem",
        back_populates="order",
        cascade="all, delete-orphan",
        lazy="selectin",
    )

    def __repr__(self) -> str:
        return f"<SaleOrder {self.order_no!r} - {self.buyer_name!r}>"


class SaleOrderItem(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """Line item in a Sale Order."""

    __tablename__ = "sales_order_items"

    order_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("sales_orders.id", ondelete="CASCADE"), nullable=False, index=True
    )

    product_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("products.id"), nullable=True, index=True
    )
    product_name: Mapped[str] = mapped_column(String(255), nullable=False)
    product_code: Mapped[str | None] = mapped_column(String(100), nullable=True)
    hsn_code: Mapped[str | None] = mapped_column(String(50), nullable=True)

    quantity: Mapped[float] = mapped_column(Float, default=1.0, nullable=False)
    unit_rate: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    tax_percent: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    tax_amount: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    item_total: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)

    planning_row_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("planning_rows.id"), nullable=True
    )
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)

    order: Mapped[SaleOrder] = relationship("SaleOrder", back_populates="items")

    def __repr__(self) -> str:
        return f"<SaleOrderItem {self.product_name!r} qty={self.quantity}>"


class DiscountPayment(Base, UUIDPrimaryKeyMixin, TimestampMixin, SoftDeleteMixin):
    """Discount Payment authorization and settlement record."""

    __tablename__ = "discount_payments"

    payment_no: Mapped[str] = mapped_column(String(50), unique=True, index=True, nullable=False)
    payment_date: Mapped[str] = mapped_column(String(50), nullable=False)
    order_ref: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    customer_name: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    sales_person: Mapped[str | None] = mapped_column(String(150), nullable=True)
    total_order_amount: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    discount_percent: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    discount_amount: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    net_payable: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    status: Mapped[str] = mapped_column(String(30), default="pending", nullable=False, index=True)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by: Mapped[str] = mapped_column(String(100), default="Admin User", nullable=False)

    def __repr__(self) -> str:
        return f"<DiscountPayment {self.payment_no!r} - {self.customer_name!r}>"

