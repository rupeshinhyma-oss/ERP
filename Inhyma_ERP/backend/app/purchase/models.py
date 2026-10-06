"""Purchase ORM models: Local Purchase and Import Purchase (with their line items)."""

from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import List, Optional

from sqlalchemy import Boolean, Date, DateTime, Float, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.base import GUID, Base, SoftDeleteMixin, TimestampMixin, UUIDPrimaryKeyMixin, VersionMixin


def _money() -> Mapped[float]:
    return mapped_column(Float, default=0.0, server_default="0", nullable=False)


class LocalPurchase(Base, UUIDPrimaryKeyMixin, TimestampMixin, VersionMixin, SoftDeleteMixin):
    """A purchase from a local supplier (Purchase 'stock in' spec). Stock is added on Confirm."""

    __tablename__ = "local_purchases"

    supplier_name: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    supplier_id: Mapped[Optional[uuid.UUID]] = mapped_column(GUID(), nullable=True, index=True)
    warehouse: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    invoice_no: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    invoice_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)

    invoice_value_ex_gst: Mapped[float] = _money()      # (A) basic, without GST
    invoice_value_inc_gst: Mapped[float] = _money()
    packing_forwarding: Mapped[float] = _money()
    transport: Mapped[float] = _money()
    offloading: Mapped[float] = _money()
    total_expenses: Mapped[float] = _money()             # (B)
    loading_percent: Mapped[float] = _money()            # (C) = B x 100 / A

    remarks: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    bill_file_url: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    bill_file_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)

    status: Mapped[str] = mapped_column(String(30), nullable=False, index=True)
    stock_applied: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0", nullable=False)
    created_by: Mapped[str] = mapped_column(String(100), nullable=False)
    confirmed_by: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    confirmed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    items: Mapped[List["LocalPurchaseItem"]] = relationship(
        "LocalPurchaseItem", back_populates="purchase", cascade="all, delete-orphan", lazy="selectin"
    )


class LocalPurchaseItem(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "local_purchase_items"

    purchase_id: Mapped[uuid.UUID] = mapped_column(GUID(), ForeignKey("local_purchases.id", ondelete="CASCADE"), nullable=False, index=True)
    product_name: Mapped[str] = mapped_column(String(255), nullable=False)
    product_code: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    quantity: Mapped[float] = mapped_column(Float, nullable=False)           # (Y)
    uom: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    unit_rate: Mapped[float] = _money()                                      # (D) basic, per invoice
    item_total: Mapped[float] = _money()                                     # Y x D
    expense_per_unit: Mapped[float] = _money()                               # (E) = D x C / 100
    unit_landing_value: Mapped[float] = _money()                             # (F) = D + E

    purchase: Mapped["LocalPurchase"] = relationship("LocalPurchase", back_populates="items")


class ImportPurchase(Base, UUIDPrimaryKeyMixin, TimestampMixin, VersionMixin, SoftDeleteMixin):
    """An import consignment (Import Purchase spec). Stock is added as soon as it is saved."""

    __tablename__ = "import_purchases"

    consignment_no: Mapped[str] = mapped_column(String(100), nullable=False, index=True)   # Invoice / Consignment No.
    supplier_name: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    supplier_id: Mapped[Optional[uuid.UUID]] = mapped_column(GUID(), nullable=True, index=True)
    warehouse: Mapped[str] = mapped_column(String(100), nullable=False, index=True)

    ordered_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    etd_origin_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    eta_port_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    expected_arrival_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    invoice_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)

    conversion_rate: Mapped[float] = _money()               # (Z) USD -> INR
    customs_conversion_rate: Mapped[float] = _money()       # (P) USD -> INR for customs
    invoice_total_usd: Mapped[float] = _money()             # (W)
    invoice_total_inr: Mapped[float] = _money()             # (A) = Z x W
    total_cbm: Mapped[float] = _money()                     # (H)
    total_import_duty: Mapped[float] = _money()             # INR, as entered

    freight: Mapped[float] = _money()
    insurance: Mapped[float] = _money()
    stamp_duty: Mapped[float] = _money()
    shipping_line_charges: Mapped[float] = _money()
    cfs_charges: Mapped[float] = _money()
    clearing_transport: Mapped[float] = _money()
    offloading: Mapped[float] = _money()
    misc_charges: Mapped[float] = _money()
    misc_remarks: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    total_expenses: Mapped[float] = _money()                # (B)
    gross_total_landing: Mapped[float] = _money()           # A + B + total import duty
    loading_percent_vb: Mapped[float] = _money()            # (C) = B x 100 / A
    loading_amount_per_cbm: Mapped[float] = _money()        # (I) = B / H

    remarks: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    bill_file_url: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    bill_file_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)

    status: Mapped[str] = mapped_column(String(30), nullable=False, index=True)
    stock_applied: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0", nullable=False)
    created_by: Mapped[str] = mapped_column(String(100), nullable=False)
    confirmed_by: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    confirmed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    received_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    closed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    items: Mapped[List["ImportPurchaseItem"]] = relationship(
        "ImportPurchaseItem", back_populates="purchase", cascade="all, delete-orphan", lazy="selectin"
    )


class ImportPurchaseItem(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "import_purchase_items"

    purchase_id: Mapped[uuid.UUID] = mapped_column(GUID(), ForeignKey("import_purchases.id", ondelete="CASCADE"), nullable=False, index=True)
    product_name: Mapped[str] = mapped_column(String(255), nullable=False)
    product_code: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    uom: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    quantity: Mapped[float] = mapped_column(Float, nullable=False)          # (Y)

    pkg_unit_cbm: Mapped[float] = _money()                                   # (J)
    pkg_qty: Mapped[float] = _money()                                        # (K)
    item_total_cbm: Mapped[float] = _money()                                 # (L) = Y x J / K

    unit_rate_usd: Mapped[float] = _money()                                  # (D)
    unit_rate_inr: Mapped[float] = _money()                                  # (E) = D x Z
    item_total_usd: Mapped[float] = _money()                                 # Y x D

    duty_percent: Mapped[float] = _money()                                   # import duty % of the product's HSN
    unit_import_duty: Mapped[float] = _money()                               # (O) = D x P x duty% / 100
    item_total_duty: Mapped[float] = _money()                                # O x Y

    exp_per_unit_vb: Mapped[float] = _money()                                # (F) = E x C / 100
    exp_per_unit_cb: Mapped[float] = _money()                                # (M) = I x L / Y
    unit_landing_vb: Mapped[float] = _money()                                # (G) = E + F + O
    unit_landing_cb: Mapped[float] = _money()                                # (N) = E + M + O
    landing_diff: Mapped[float] = _money()                                   # N - G

    purchase: Mapped["ImportPurchase"] = relationship("ImportPurchase", back_populates="items")
