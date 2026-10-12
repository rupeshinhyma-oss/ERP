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

from datetime import datetime

from sqlalchemy import Boolean, Date, DateTime, Float, ForeignKey, Integer, JSON, String, Text, false
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

    # --- commercial terms (Sales & PI spec: payment, transport, delivery, third-party) ---
    payment_terms: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    transport_name: Mapped[Optional[str]] = mapped_column(String(150), nullable=True)
    transport_destination: Mapped[Optional[str]] = mapped_column(String(150), nullable=True)
    delivery_type: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    delivery_charge: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    third_party_delivery: Mapped[Optional[str]] = mapped_column(String(10), nullable=True)
    billing_address: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    shipping_address: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    terms_and_conditions: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # --- computed totals (server-authoritative, recomputed from line items) ---
    taxable_amount: Mapped[float] = mapped_column(Float, default=0.0, server_default="0", nullable=False)
    gst_amount: Mapped[float] = mapped_column(Float, default=0.0, server_default="0", nullable=False)

    # --- workflow tracking ---
    below_min_price: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0", nullable=False)
    cancel_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    approved_by: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    approved_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    confirmed_by: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    confirmed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    cancelled_by: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    cancelled_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

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

    # --- pricing breakdown (Sales & PI spec: unit discount, taxable, GST, total, additional charges) ---
    unit_discount: Mapped[float] = mapped_column(Float, default=0.0, server_default="0", nullable=False)
    taxable_amount: Mapped[float] = mapped_column(Float, default=0.0, server_default="0", nullable=False)
    gst_percent: Mapped[float] = mapped_column(Float, default=0.0, server_default="0", nullable=False)
    gst_amount: Mapped[float] = mapped_column(Float, default=0.0, server_default="0", nullable=False)
    total: Mapped[float] = mapped_column(Float, default=0.0, server_default="0", nullable=False)
    is_additional_charge: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0", nullable=False)
    charge_type: Mapped[Optional[str]] = mapped_column(String(150), nullable=True)

    proforma: Mapped["ProformaInvoice"] = relationship("ProformaInvoice", back_populates="items")

    def __repr__(self) -> str:
        """Return a debug-friendly representation."""
        return f"<ProformaInvoiceLineItem proforma_id={self.proforma_id!r} product_name={self.product_name!r}>"


class SaleOrder(Base, UUIDPrimaryKeyMixin, TimestampMixin, SoftDeleteMixin):
    """Sale Order record for commercial sale and consignment tracking."""

    __tablename__ = "sales_orders"

    order_no: Mapped[str] = mapped_column(String(100), unique=True, nullable=False, index=True)

    organization_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("master_companies.id"), nullable=True, index=True
    )
    organization_name: Mapped[str] = mapped_column(String(150), default="Inhyma", nullable=False)

    buyer_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("buyers.id"), nullable=True, index=True
    )
    buyer_name: Mapped[str] = mapped_column(String(200), nullable=False)
    buyer_branch_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    buyer_branch_name: Mapped[str | None] = mapped_column(String(150), nullable=True)

    company_name: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)
    warehouse: Mapped[str | None] = mapped_column(String(100), nullable=True, index=True)
    proforma_no: Mapped[str | None] = mapped_column(String(50), nullable=True, index=True)
    proforma_id: Mapped[uuid.UUID | None] = mapped_column(GUID(), nullable=True, index=True)
    city: Mapped[str | None] = mapped_column(String(100), nullable=True)
    state: Mapped[str | None] = mapped_column(String(100), nullable=True)
    sales_person: Mapped[str | None] = mapped_column(String(150), nullable=True, index=True)
    billing_address: Mapped[str | None] = mapped_column(Text, nullable=True)
    shipping_address: Mapped[str | None] = mapped_column(Text, nullable=True)
    payment_terms: Mapped[str | None] = mapped_column(String(100), nullable=True)
    transport_destination: Mapped[str | None] = mapped_column(String(150), nullable=True)
    delivery_type: Mapped[str | None] = mapped_column(String(50), nullable=True)
    delivery_charge: Mapped[str | None] = mapped_column(String(50), nullable=True)
    third_party_delivery: Mapped[str | None] = mapped_column(String(20), nullable=True)
    third_party_invoice: Mapped[str | None] = mapped_column(String(255), nullable=True)
    amount_inc_gst: Mapped[float] = mapped_column(Float, default=0.0, server_default="0", nullable=False)
    discount: Mapped[float] = mapped_column(Float, default=0.0, server_default="0", nullable=False)

    # Invoicing & Accounting
    invoice_no: Mapped[str | None] = mapped_column(String(100), nullable=True, index=True)
    invoice_date: Mapped[str | None] = mapped_column(String(50), nullable=True)

    # Gate Pass tracking
    gatepass: Mapped[str | None] = mapped_column(String(100), nullable=True)
    gatepass_no: Mapped[str | None] = mapped_column(String(100), nullable=True)
    gatepass_date: Mapped[str | None] = mapped_column(String(50), nullable=True)
    gatepass_handled_by: Mapped[str | None] = mapped_column(String(150), nullable=True)

    consignment_code: Mapped[str | None] = mapped_column(String(100), nullable=True, index=True)
    allocated_consignment: Mapped[str | None] = mapped_column(String(100), nullable=True)
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
    cancel_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    terms_and_conditions: Mapped[str | None] = mapped_column(Text, nullable=True)
    booking_remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    # True while this order's quantities are deducted from stock (kept in step with the status rules)
    stock_applied: Mapped[bool] = mapped_column(Boolean, default=False, server_default=false(), nullable=False)

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
    uom: Mapped[str | None] = mapped_column(String(50), default="Nos", nullable=True)

    quantity: Mapped[float] = mapped_column(Float, default=1.0, nullable=False)
    unit_rate: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    unit_price: Mapped[float | None] = mapped_column(Float, nullable=True)
    unit_discount: Mapped[float | None] = mapped_column(Float, default=0.0, nullable=True)
    taxable_amount: Mapped[float | None] = mapped_column(Float, nullable=True)
    tax_percent: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    tax_amount: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    gst_amount: Mapped[float | None] = mapped_column(Float, nullable=True)
    item_total: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    is_additional_charge: Mapped[bool] = mapped_column(Boolean, default=False, server_default=false(), nullable=False)
    charge_type: Mapped[str | None] = mapped_column(String(100), nullable=True)

    planning_row_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("planning_rows.id"), nullable=True
    )
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    serial_numbers: Mapped[list | None] = mapped_column(JSON, nullable=True)

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
    warehouse: Mapped[str | None] = mapped_column(String(100), default="Mumbai", nullable=True)
    contact_person_name: Mapped[str | None] = mapped_column(String(150), nullable=True)
    contact_person_mobile: Mapped[str | None] = mapped_column(String(50), nullable=True)
    total_order_amount: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    discount_percent: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    discount_amount: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    paid_discount: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    due_discount: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    net_payable: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    status: Mapped[str] = mapped_column(String(30), default="pending", nullable=False, index=True)
    status_updated_at: Mapped[str | None] = mapped_column(String(50), nullable=True)
    settled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    gatepass_id: Mapped[str | None] = mapped_column(String(50), nullable=True)
    gatepass_date: Mapped[str | None] = mapped_column(String(50), nullable=True)
    settle_date: Mapped[str | None] = mapped_column(String(50), nullable=True)
    settle_remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by: Mapped[str] = mapped_column(String(100), default="Admin User", nullable=False)

    def __repr__(self) -> str:
        return f"<DiscountPayment {self.payment_no!r} - {self.customer_name!r}>"


class GatePass(Base, UUIDPrimaryKeyMixin, TimestampMixin, SoftDeleteMixin):
    """Gate Pass record for dispatch and transport tracking (Completed/Gate Pass.docx)."""

    __tablename__ = "gate_passes"

    gatepass_no: Mapped[str] = mapped_column(String(50), unique=True, index=True, nullable=False)
    gatepass_date: Mapped[Any] = mapped_column(Date, nullable=False)
    so_id: Mapped[uuid.UUID | None] = mapped_column(GUID(), ForeignKey("sales_orders.id", ondelete="SET NULL"), nullable=True, index=True)
    so_no: Mapped[str | None] = mapped_column(String(100), nullable=True)
    so_date: Mapped[str | None] = mapped_column(String(50), nullable=True)
    invoice_no: Mapped[str | None] = mapped_column(String(100), nullable=True)
    invoice_date: Mapped[str | None] = mapped_column(String(50), nullable=True)
    sales_person: Mapped[str | None] = mapped_column(String(150), nullable=True)
    party_name: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    billing_address: Mapped[str | None] = mapped_column(Text, nullable=True)
    shipping_address: Mapped[str | None] = mapped_column(Text, nullable=True)
    transport_name: Mapped[str | None] = mapped_column(String(150), nullable=True)
    destination: Mapped[str | None] = mapped_column(String(150), nullable=True)
    delivery_type: Mapped[str | None] = mapped_column(String(50), default="Door", nullable=True)
    delivery_charges: Mapped[str | None] = mapped_column(String(50), default="To Pay", nullable=True)
    handled_by: Mapped[str | None] = mapped_column(String(150), nullable=True)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    items: Mapped[list | None] = mapped_column(JSON, default=list, nullable=False)
    status: Mapped[str] = mapped_column(String(50), default="ACTIVE", nullable=False)
    created_by: Mapped[str | None] = mapped_column(String(150), nullable=True)

    def __repr__(self) -> str:
        return f"<GatePass {self.gatepass_no!r} - {self.party_name!r}>"