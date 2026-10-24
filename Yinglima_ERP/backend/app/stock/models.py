"""
Stock Movement (Inward & Outward) ORM Models.

Tracks physical warehouse inventory flows:
- Inward: Supplier/Local Purchase receipts, warehouse returns, or direct stock-in.
- Outward: Buyer/Sale Process dispatches, samples, or warehouse dispatches.
"""

from __future__ import annotations

import uuid
from datetime import date

from sqlalchemy import Date, ForeignKey, Integer, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.base import GUID, Base, SoftDeleteMixin, TimestampMixin, UUIDPrimaryKeyMixin


class StockMovement(Base, UUIDPrimaryKeyMixin, TimestampMixin, SoftDeleteMixin):
    """Warehouse Stock Movement Header (Inward or Outward)."""

    __tablename__ = "stock_movements"

    movement_no: Mapped[str] = mapped_column(String(50), unique=True, nullable=False, index=True)
    # inward | outward
    movement_type: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    movement_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    # confirmed | cancelled | draft
    status: Mapped[str] = mapped_column(String(30), default="confirmed", nullable=False, index=True)
    # local_purchase | sale_process | direct
    source_type: Mapped[str] = mapped_column(String(30), default="direct", nullable=False)

    # 1-Click Link References
    purchase_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("local_purchases.id", ondelete="SET NULL"), nullable=True, index=True
    )
    purchase_invoice_no: Mapped[str | None] = mapped_column(String(100), nullable=True)

    sale_order_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("sales_orders.id", ondelete="SET NULL"), nullable=True, index=True
    )
    sale_order_no: Mapped[str | None] = mapped_column(String(100), nullable=True)

    # Supplier / Buyer Parties
    supplier_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("suppliers.id", ondelete="SET NULL"), nullable=True, index=True
    )
    supplier_name: Mapped[str | None] = mapped_column(String(200), nullable=True)

    buyer_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("buyers.id", ondelete="SET NULL"), nullable=True, index=True
    )
    buyer_name: Mapped[str | None] = mapped_column(String(200), nullable=True)

    # Shipping / Gate Pass Details
    reference_no: Mapped[str | None] = mapped_column(String(100), nullable=True)
    warehouse_location: Mapped[str | None] = mapped_column(String(150), nullable=True)
    vehicle_no: Mapped[str | None] = mapped_column(String(100), nullable=True)
    transporter_name: Mapped[str | None] = mapped_column(String(150), nullable=True)
    container_no: Mapped[str | None] = mapped_column(String(100), nullable=True)

    # Summary Quantities
    total_quantity: Mapped[float] = mapped_column(Numeric(14, 2), default=0.0, nullable=False)
    total_items_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_by_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_by_name: Mapped[str | None] = mapped_column(String(150), nullable=True)

    # Relationships
    items: Mapped[list[StockMovementItem]] = relationship(
        "StockMovementItem",
        back_populates="movement",
        cascade="all, delete-orphan",
        lazy="selectin",
        order_by="StockMovementItem.created_at",
    )

    def __repr__(self) -> str:
        return f"<StockMovement {self.movement_no} ({self.movement_type})>"


class StockMovementItem(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """Line item in a warehouse Stock Movement."""

    __tablename__ = "stock_movement_items"

    movement_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("stock_movements.id", ondelete="CASCADE"), nullable=False, index=True
    )
    product_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("products.id", ondelete="SET NULL"), nullable=True, index=True
    )
    product_name: Mapped[str] = mapped_column(String(255), nullable=False)
    product_code: Mapped[str | None] = mapped_column(String(100), nullable=True)

    # Quantities
    expected_quantity: Mapped[float] = mapped_column(Numeric(12, 2), default=0.0, nullable=False)
    quantity: Mapped[float] = mapped_column(Numeric(12, 2), default=0.0, nullable=False)
    damaged_quantity: Mapped[float] = mapped_column(Numeric(12, 2), default=0.0, nullable=False)
    accepted_quantity: Mapped[float] = mapped_column(Numeric(12, 2), default=0.0, nullable=False)

    unit_rate: Mapped[float] = mapped_column(Numeric(15, 2), default=0.0, nullable=False)
    package_details: Mapped[str | None] = mapped_column(String(150), nullable=True)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)

    movement: Mapped[StockMovement] = relationship("StockMovement", back_populates="items")

    def __repr__(self) -> str:
        return f"<StockMovementItem {self.product_name} accepted={self.accepted_quantity}>"
