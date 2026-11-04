"""ORM model for Financial Planning Report persistent overlays and payment ledger."""

from __future__ import annotations

import uuid
from typing import Any, Optional

from sqlalchemy import Float, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database.base import GUID, Base, SoftDeleteMixin, TimestampMixin, UUIDPrimaryKeyMixin


class FinancialPlanningEntry(Base, UUIDPrimaryKeyMixin, TimestampMixin, SoftDeleteMixin):
    """
    Persistent Financial Planning overlay keyed to a deterministic confirmed source row:
      - ``import_purchase:{purchase_id}:supplier``
      - ``import_purchase:{purchase_id}:taxes``
      - ``local_purchase:{purchase_id}:supplier``
      - ``sales_process:{order_id}:client``

    Live commercial headers & totals are read directly from ``import_purchases``,
    ``local_purchases``, and ``sales_orders`` so stage transitions immediately
    appear/disappear without stale sync lag, while Finance updates (payment terms,
    due dates, attachments, recorded settlements, remarks) persist here.
    """

    __tablename__ = "financial_planning_entries"

    entry_key: Mapped[str] = mapped_column(String(160), unique=True, nullable=False, index=True)
    source_module: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    source_record_id: Mapped[uuid.UUID] = mapped_column(GUID(), nullable=False, index=True)

    paid_amount: Mapped[float] = mapped_column(Float, default=0.0, server_default="0", nullable=False)
    payment_terms_override: Mapped[Optional[str]] = mapped_column(String(150), nullable=True)
    due_date_override: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)

    invoice_attachment_url: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    invoice_attachment_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)

    payment_attachment_url: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    payment_attachment_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)

    remarks: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    payments_history: Mapped[Optional[list[dict[str, Any]]]] = mapped_column(JSON, nullable=True)
    updated_by_name: Mapped[Optional[str]] = mapped_column(String(150), nullable=True)

    def __repr__(self) -> str:
        return f"<FinancialPlanningEntry entry_key={self.entry_key!r} paid={self.paid_amount}>"

