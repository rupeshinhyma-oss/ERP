"""
Adjustment Purpose ORM Model.

Owns the ``adjustment_purposes`` table: tracks stock reconciliation / adjustment reasons,
such as Return From Client, Opening Stock, Damage, Scrap, Self Use, Split, Free From Supplier,
Removed Parts, Non Working (Damage), Return To Supplier, Sample / Testing, Stock Audit, Theft / Loss.
"""

from __future__ import annotations

from sqlalchemy import String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.constants import RecordStatus
from app.database.base import Base, RecordStatusColumn, SoftDeleteMixin, TimestampMixin, UUIDPrimaryKeyMixin, VersionMixin


class AdjustmentPurpose(Base, UUIDPrimaryKeyMixin, TimestampMixin, VersionMixin, SoftDeleteMixin):
    """A single adjustment purpose record."""

    __tablename__ = "adjustment_purposes"

    name: Mapped[str] = mapped_column(String(100), nullable=False, unique=True, index=True)

    status: Mapped[RecordStatus] = mapped_column(
        RecordStatusColumn(),
        default=RecordStatus.ACTIVE,
        nullable=False,
        index=True,
    )

    def __repr__(self) -> str:
        """Return a debug-friendly representation."""
        return f"<AdjustmentPurpose name={self.name!r} status={self.status!r}>"
