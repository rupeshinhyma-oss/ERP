"""
Inventory ORM Models.

Defines database models for:
1. ProductStock (physical inventory counts and valuations across warehouses)
2. StockAdjustment (Stock IN / OUT adjustment orders)
3. StockAdjustmentLineItem (individual line items linked to adjustments)
"""

from __future__ import annotations

import uuid
from typing import Any, List, Optional

from sqlalchemy import JSON, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.base import (
    GUID,
    Base,
    SoftDeleteMixin,
    TimestampMixin,
    UUIDPrimaryKeyMixin,
    VersionMixin,
)


class ProductStock(Base, UUIDPrimaryKeyMixin, TimestampMixin, VersionMixin, SoftDeleteMixin):
    """
    Physical product inventory balances across warehouses.
    Matches the exact layout of the legacy ERP Product Stock view.
    """

    __tablename__ = "product_stocks"

    sr_no: Mapped[Optional[int]] = mapped_column(Integer, nullable=True, index=True)
    product_id: Mapped[Optional[uuid.UUID]] = mapped_column(GUID(), nullable=True, index=True)
    product_name_tally: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    product_code: Mapped[str] = mapped_column(String(100), default="-", server_default="-", nullable=False)
    brand: Mapped[str] = mapped_column(String(100), default="-", server_default="-", nullable=False)
    category: Mapped[Optional[str]] = mapped_column(String(100), nullable=True, index=True)
    sub_category: Mapped[Optional[str]] = mapped_column(String(100), nullable=True, index=True)
    hsn_code: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    gst_rate: Mapped[Optional[str]] = mapped_column(String(20), default="18%", server_default="18%", nullable=True)

    # Warehouse physical stock, transit, and ordered allocations
    mumbai: Mapped[float] = mapped_column(Float, default=0.0, server_default="0", nullable=False)
    mumbai_transit: Mapped[float] = mapped_column(Float, default=0.0, server_default="0", nullable=False)
    mumbai_ordered: Mapped[float] = mapped_column(Float, default=0.0, server_default="0", nullable=False)

    ahmedabad: Mapped[float] = mapped_column(Float, default=0.0, server_default="0", nullable=False)
    ahmedabad_transit: Mapped[float] = mapped_column(Float, default=0.0, server_default="0", nullable=False)
    ahmedabad_ordered: Mapped[float] = mapped_column(Float, default=0.0, server_default="0", nullable=False)

    indore: Mapped[float] = mapped_column(Float, default=0.0, server_default="0", nullable=False)
    indore_transit: Mapped[float] = mapped_column(Float, default=0.0, server_default="0", nullable=False)
    indore_ordered: Mapped[float] = mapped_column(Float, default=0.0, server_default="0", nullable=False)

    total_qty: Mapped[float] = mapped_column(Float, default=0.0, server_default="0", nullable=False)
    uom: Mapped[str] = mapped_column(String(50), default="SET", server_default="SET", nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    orders_info: Mapped[Optional[Any]] = mapped_column(JSON, default=list, nullable=True)
    status: Mapped[str] = mapped_column(String(50), default="In Stock", server_default="In Stock", nullable=False)


class StockAdjustment(Base, UUIDPrimaryKeyMixin, TimestampMixin, VersionMixin, SoftDeleteMixin):
    """
    Stock Adjustment transaction order (Stock IN or Stock OUT).
    """

    __tablename__ = "stock_adjustments"

    adjustment_no: Mapped[Optional[str]] = mapped_column(String(50), nullable=True, index=True)
    adjustment_date: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    client_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True, index=True)
    invoice_no: Mapped[Optional[str]] = mapped_column(String(100), nullable=True, index=True)
    warehouse: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    type: Mapped[str] = mapped_column(String(50), nullable=False, index=True)  # "Stock IN" | "Stock OUT"
    purpose: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    total_amount: Mapped[float] = mapped_column(Float, default=0.0, server_default="0", nullable=False)
    created_by: Mapped[str] = mapped_column(String(100), default="Admin User", server_default="Admin User", nullable=False)
    remarks: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    items: Mapped[List[StockAdjustmentLineItem]] = relationship(
        "StockAdjustmentLineItem",
        back_populates="adjustment",
        cascade="all, delete-orphan",
        lazy="selectin",
    )


class StockAdjustmentLineItem(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """
    Individual product line item associated with a StockAdjustment order.
    """

    __tablename__ = "stock_adjustment_items"

    adjustment_id: Mapped[uuid.UUID] = mapped_column(
        GUID(),
        ForeignKey("stock_adjustments.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    product_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    product_name: Mapped[str] = mapped_column(String(255), nullable=False)
    product_code: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    category: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    hsn_code: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    gst_rate: Mapped[Optional[str]] = mapped_column(String(20), default="18%", server_default="18%", nullable=True)
    quantity: Mapped[float] = mapped_column(Float, default=1.0, server_default="1", nullable=False)
    uom: Mapped[str] = mapped_column(String(50), default="SET", server_default="SET", nullable=False)
    rate: Mapped[float] = mapped_column(Float, default=0.0, server_default="0", nullable=False)
    amount: Mapped[float] = mapped_column(Float, default=0.0, server_default="0", nullable=False)

    adjustment: Mapped[StockAdjustment] = relationship("StockAdjustment", back_populates="items")


class StockTransfer(Base, UUIDPrimaryKeyMixin, TimestampMixin, VersionMixin, SoftDeleteMixin):
    """
    Inter-warehouse stock transfer record.
    Matches erp.inhymasolutions.com/transfer/list layout.
    """

    __tablename__ = "stock_transfers"

    sr_no: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    transfer_no: Mapped[str] = mapped_column(String(50), unique=True, index=True, nullable=False)
    transfer_date: Mapped[str] = mapped_column(String(50), nullable=False)
    from_warehouse: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    to_warehouse: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    total_amount: Mapped[float] = mapped_column(Float, default=0.0, server_default="0", nullable=False)
    added_by: Mapped[str] = mapped_column(String(100), default="Akshata Wadekar", server_default="Akshata Wadekar", nullable=False)
    status: Mapped[str] = mapped_column(String(50), default="Received", server_default="Received", index=True, nullable=False)
    remarks: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    items: Mapped[List[StockTransferLineItem]] = relationship(
        "StockTransferLineItem",
        back_populates="transfer",
        cascade="all, delete-orphan",
        lazy="selectin",
    )


class StockTransferLineItem(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """
    Line item belonging to a Stock Transfer.
    """

    __tablename__ = "stock_transfer_items"

    transfer_id: Mapped[uuid.UUID] = mapped_column(
        GUID(),
        ForeignKey("stock_transfers.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    product_name: Mapped[str] = mapped_column(String(255), nullable=False)
    product_code: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    category: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    quantity: Mapped[float] = mapped_column(Float, default=1.0, server_default="1", nullable=False)
    uom: Mapped[str] = mapped_column(String(50), default="SET", server_default="SET", nullable=False)
    rate: Mapped[float] = mapped_column(Float, default=0.0, server_default="0", nullable=False)
    amount: Mapped[float] = mapped_column(Float, default=0.0, server_default="0", nullable=False)

    transfer: Mapped[StockTransfer] = relationship("StockTransfer", back_populates="items")
