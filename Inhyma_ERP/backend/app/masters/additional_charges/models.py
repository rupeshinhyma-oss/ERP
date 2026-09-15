"""
Additional Charge ORM Model.

Owns the ``additional_charges`` table: Name, HSN Number, GST Percentage,
optional description, and active status, corresponding to the Additional Charges master module.
"""

from __future__ import annotations

from sqlalchemy import Numeric, String, Text
from sqlalchemy import Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column

from app.core.constants import RecordStatus
from app.database.base import Base, SoftDeleteMixin, TimestampMixin, UUIDPrimaryKeyMixin, VersionMixin


class AdditionalCharge(Base, UUIDPrimaryKeyMixin, TimestampMixin, VersionMixin, SoftDeleteMixin):
    """A single additional charge reference record (e.g. Transport Charges, Packing & Forwarding)."""

    __tablename__ = "additional_charges"

    name: Mapped[str] = mapped_column(String(150), unique=True, nullable=False, index=True)
    hsn_number: Mapped[str | None] = mapped_column(String(50), nullable=True, index=True)
    gst_percent: Mapped[float] = mapped_column(Numeric(5, 2), nullable=False, default=0.00)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    status: Mapped[RecordStatus] = mapped_column(
        SAEnum(RecordStatus, name="additional_charge_status", native_enum=False, length=20),
        default=RecordStatus.ACTIVE,
        nullable=False,
        index=True,
    )

    def __repr__(self) -> str:
        """Return a debug-friendly representation."""
        return f"<AdditionalCharge name={self.name!r} hsn_number={self.hsn_number!r} gst_percent={self.gst_percent}>"
