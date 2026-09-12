"""
Tax ORM Model.

Owns the ``taxes`` table: HSN Number, GST Percentage, Import Duty (%),
and active status, corresponding to the Taxes master module.
"""

from __future__ import annotations

from sqlalchemy import Numeric, String
from sqlalchemy import Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column

from app.core.constants import RecordStatus
from app.database.base import Base, SoftDeleteMixin, TimestampMixin, UUIDPrimaryKeyMixin, VersionMixin


class Tax(Base, UUIDPrimaryKeyMixin, TimestampMixin, VersionMixin, SoftDeleteMixin):
    """A single tax reference record."""

    __tablename__ = "taxes"

    hsn_number: Mapped[str] = mapped_column(String(50), unique=True, nullable=False, index=True)
    gst_percent: Mapped[float] = mapped_column(Numeric(5, 2), nullable=False, default=0.00)
    import_duty_percent: Mapped[float] = mapped_column(Numeric(5, 2), nullable=False, default=0.00)

    status: Mapped[RecordStatus] = mapped_column(
        SAEnum(RecordStatus, name="tax_status", native_enum=False, length=20),
        default=RecordStatus.ACTIVE,
        nullable=False,
        index=True,
    )

    def __repr__(self) -> str:
        """Return a debug-friendly representation."""
        return f"<Tax hsn_number={self.hsn_number!r} gst_percent={self.gst_percent} import_duty_percent={self.import_duty_percent}>"
