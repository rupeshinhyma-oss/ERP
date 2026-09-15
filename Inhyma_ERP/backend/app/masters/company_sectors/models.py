"""
CompanySector ORM Model.

Owns the ``company_sectors`` table: Name, optional description, and active status,
corresponding to the Company Sectors master module.
"""

from __future__ import annotations

from sqlalchemy import String, Text
from sqlalchemy import Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column

from app.core.constants import RecordStatus
from app.database.base import Base, SoftDeleteMixin, TimestampMixin, UUIDPrimaryKeyMixin, VersionMixin


class CompanySector(Base, UUIDPrimaryKeyMixin, TimestampMixin, VersionMixin, SoftDeleteMixin):
    """A single company sector reference record."""

    __tablename__ = "company_sectors"

    name: Mapped[str] = mapped_column(String(100), unique=True, nullable=False, index=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    status: Mapped[RecordStatus] = mapped_column(
        SAEnum(RecordStatus, name="company_sector_status", native_enum=False, length=20),
        default=RecordStatus.ACTIVE,
        nullable=False,
        index=True,
    )

    def __repr__(self) -> str:
        """Return a debug-friendly representation."""
        return f"<CompanySector name={self.name!r} status={self.status!r}>"
