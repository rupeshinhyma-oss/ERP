"""
PaymentMode ORM Model.

Owns the ``payment_modes`` table: configurable payment modes and bank accounts
(e.g., RMB A/C, USD Transaction A/C, TT / Wire Transfer, Cash).
"""

from __future__ import annotations

from sqlalchemy import Enum as SAEnum
from sqlalchemy import String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.constants import RecordStatus
from app.database.base import Base, SoftDeleteMixin, TimestampMixin, UUIDPrimaryKeyMixin


class PaymentMode(Base, UUIDPrimaryKeyMixin, TimestampMixin, SoftDeleteMixin):
    """A single payment mode / bank account reference record."""

    __tablename__ = "payment_modes"

    name: Mapped[str] = mapped_column(String(150), unique=True, nullable=False, index=True)
    code: Mapped[str] = mapped_column(String(50), unique=True, nullable=False, index=True)
    account_type: Mapped[str | None] = mapped_column(String(80), nullable=True)
    currency_code: Mapped[str | None] = mapped_column(String(20), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    status: Mapped[RecordStatus] = mapped_column(
        SAEnum(RecordStatus, name="payment_mode_status", native_enum=False, length=20),
        default=RecordStatus.ACTIVE,
        nullable=False,
        index=True,
    )

    def __repr__(self) -> str:
        """Return a debug-friendly representation."""
        return f"<PaymentMode code={self.code!r} name={self.name!r}>"
