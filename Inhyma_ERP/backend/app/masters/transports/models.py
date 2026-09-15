"""
Transport ORM Model.

Owns the ``transports`` table: tracks third-party and in-house transport providers
with transport name, GST number, contact mobile, and record status.
"""

from __future__ import annotations

from sqlalchemy import String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.constants import RecordStatus
from app.database.base import Base, RecordStatusColumn, SoftDeleteMixin, TimestampMixin, UUIDPrimaryKeyMixin, VersionMixin


class Transport(Base, UUIDPrimaryKeyMixin, TimestampMixin, VersionMixin, SoftDeleteMixin):
    """A single transport carrier record."""

    __tablename__ = "transports"

    name: Mapped[str] = mapped_column(String(200), nullable=False, unique=True, index=True)
    gst_number: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    mobile: Mapped[str | None] = mapped_column(String(50), nullable=True, index=True)

    status: Mapped[RecordStatus] = mapped_column(
        RecordStatusColumn(),
        default=RecordStatus.ACTIVE,
        nullable=False,
        index=True,
    )

    def __repr__(self) -> str:
        """Return a debug-friendly representation."""
        return f"<Transport name={self.name!r} gst_number={self.gst_number!r}>"
