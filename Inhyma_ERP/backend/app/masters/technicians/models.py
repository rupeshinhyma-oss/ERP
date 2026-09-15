"""
Technician ORM Model.

Owns the ``technicians`` table: Name, Mobile, City, Password Hash, and status.
"""

from __future__ import annotations

from sqlalchemy import String
from sqlalchemy import Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column

from app.core.constants import RecordStatus
from app.database.base import Base, SoftDeleteMixin, TimestampMixin, UUIDPrimaryKeyMixin, VersionMixin


class Technician(Base, UUIDPrimaryKeyMixin, TimestampMixin, VersionMixin, SoftDeleteMixin):
    """A single service technician reference record."""

    __tablename__ = "technicians"

    name: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    mobile: Mapped[str] = mapped_column(String(20), unique=True, nullable=False, index=True)
    city: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    password_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)

    status: Mapped[RecordStatus] = mapped_column(
        SAEnum(RecordStatus, name="technician_status", native_enum=False, length=20),
        default=RecordStatus.ACTIVE,
        nullable=False,
        index=True,
    )

    def __repr__(self) -> str:
        """Return a debug-friendly representation."""
        return f"<Technician name={self.name!r} mobile={self.mobile!r} city={self.city!r} status={self.status!r}>"
