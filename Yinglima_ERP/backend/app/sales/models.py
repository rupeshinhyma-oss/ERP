"""
Sale Process ORM Models.

Owns `sales_orders` and `sales_order_items` tables for commercial export
orders from Yinglima to Indian entities (Inhyma, Darsh Impex, etc.),
integrated directly with Shipment Planning consignments.
"""

from __future__ import annotations

import uuid
from datetime import date

from sqlalchemy import Date, ForeignKey, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.base import GUID, Base, SoftDeleteMixin, TimestampMixin, UUIDPrimaryKeyMixin
import app.users.models  # noqa: F401
import app.buyers.models  # noqa: F401
import app.masters.company_list.models  # noqa: F401
import app.planning.models  # noqa: F401


class SaleOrder(Base, UUIDPrimaryKeyMixin, TimestampMixin, SoftDeleteMixin):
    """Sale Order record for commercial sale and consignment tracking."""

    __tablename__ = "sales_orders"

    order_no: Mapped[str] = mapped_column(String(100), unique=True, nullable=False, index=True)

    organization_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("master_companies.id"), nullable=False, index=True
    )
    organization_name: Mapped[str] = mapped_column(String(150), default="Yinglima", nullable=False)

    buyer_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("buyers.id"), nullable=False, index=True
    )
    buyer_name: Mapped[str] = mapped_column(String(200), nullable=False)
    buyer_branch_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    buyer_branch_name: Mapped[str | None] = mapped_column(String(150), nullable=True)

    # Consignment reference from Shipment Planning (e.g. MUMINHYMA 1)
    consignment_code: Mapped[str | None] = mapped_column(String(100), nullable=True, index=True)
    planning_sheet_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("planning_sheets.id"), nullable=True
    )
    planning_column_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("planning_columns.id"), nullable=True
    )

    order_date: Mapped[date] = mapped_column(Date, nullable=False)
    delivery_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    currency: Mapped[str] = mapped_column(String(10), default="RMB", nullable=False)

    # Lifecycle status: pending | sales_confirmed | admin_approved | dispatched | lr | cancelled
    status: Mapped[str] = mapped_column(String(30), default="pending", nullable=False, index=True)

    # Financial rollups
    total_basic: Mapped[float] = mapped_column(Numeric(15, 2), default=0.0, nullable=False)
    total_tax: Mapped[float] = mapped_column(Numeric(15, 2), default=0.0, nullable=False)
    total_amount: Mapped[float] = mapped_column(Numeric(15, 2), default=0.0, nullable=False)
    total_quantity: Mapped[float] = mapped_column(Numeric(12, 2), default=0.0, nullable=False)

    # Shipping / Logistics details
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

    # Relationship to line items
    items: Mapped[list[SaleOrderItem]] = relationship(
        "SaleOrderItem",
        back_populates="order",
        cascade="all, delete-orphan",
        order_by="SaleOrderItem.created_at",
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

    quantity: Mapped[float] = mapped_column(Numeric(12, 2), default=1.0, nullable=False)
    unit_rate: Mapped[float] = mapped_column(Numeric(15, 2), default=0.0, nullable=False)
    tax_percent: Mapped[float] = mapped_column(Numeric(6, 2), default=0.0, nullable=False)
    tax_amount: Mapped[float] = mapped_column(Numeric(15, 2), default=0.0, nullable=False)
    item_total: Mapped[float] = mapped_column(Numeric(15, 2), default=0.0, nullable=False)

    planning_row_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("planning_rows.id"), nullable=True
    )
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)

    order: Mapped[SaleOrder] = relationship("SaleOrder", back_populates="items")

    def __repr__(self) -> str:
        return f"<SaleOrderItem {self.product_name!r} qty={self.quantity}>"
