"""
Bank ORM Model.

Owns the ``banks`` table: tracks company bank accounts with
bank name, account number, account holder name, IFSC code, branch, and status.
"""

from __future__ import annotations

from sqlalchemy import String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.constants import RecordStatus
from app.database.base import Base, RecordStatusColumn, SoftDeleteMixin, TimestampMixin, UUIDPrimaryKeyMixin, VersionMixin


class Bank(Base, UUIDPrimaryKeyMixin, TimestampMixin, VersionMixin, SoftDeleteMixin):
    """A single bank account record."""

    __tablename__ = "banks"

    bank_name: Mapped[str] = mapped_column(String(150), nullable=False, index=True)
    account_number: Mapped[str] = mapped_column(String(50), nullable=False, unique=True, index=True)
    account_holder_name: Mapped[str] = mapped_column(String(200), nullable=False, index=True)
    ifsc_code: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    branch: Mapped[str] = mapped_column(String(150), nullable=False)

    status: Mapped[RecordStatus] = mapped_column(
        RecordStatusColumn(),
        default=RecordStatus.ACTIVE,
        nullable=False,
        index=True,
    )

    def __repr__(self) -> str:
        """Return a debug-friendly representation."""
        return f"<Bank bank_name={self.bank_name!r} account_number={self.account_number!r}>"
