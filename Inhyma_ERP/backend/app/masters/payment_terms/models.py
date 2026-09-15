"""
Payment Term ORM Model.

Owns the ``payment_terms`` table: tracks credit limits, advance payment rules,
and billing settlement cycles.
"""

from __future__ import annotations

from sqlalchemy import String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.constants import RecordStatus
from app.database.base import Base, RecordStatusColumn, SoftDeleteMixin, TimestampMixin, UUIDPrimaryKeyMixin, VersionMixin


class PaymentTerm(Base, UUIDPrimaryKeyMixin, TimestampMixin, VersionMixin, SoftDeleteMixin):
    """A single payment term record."""

    __tablename__ = "payment_terms"

    name: Mapped[str] = mapped_column(String(100), nullable=False, unique=True, index=True)

    status: Mapped[RecordStatus] = mapped_column(
        RecordStatusColumn(),
        default=RecordStatus.ACTIVE,
        nullable=False,
        index=True,
    )

    def __repr__(self) -> str:
        """Return a debug-friendly representation."""
        return f"<PaymentTerm name={self.name!r} status={self.status!r}>"
