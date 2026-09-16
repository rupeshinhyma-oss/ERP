"""
Lead Source ORM Model.

Owns the ``lead_sources`` table: tracks inquiry origin channels such as Own Website,
Indiamart, Facebook, Instagram, Agent, Other, Data Scrapping.
"""

from __future__ import annotations

from sqlalchemy import String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.constants import RecordStatus
from app.database.base import Base, RecordStatusColumn, SoftDeleteMixin, TimestampMixin, UUIDPrimaryKeyMixin, VersionMixin


class LeadSource(Base, UUIDPrimaryKeyMixin, TimestampMixin, VersionMixin, SoftDeleteMixin):
    """A single lead source record."""

    __tablename__ = "lead_sources"

    name: Mapped[str] = mapped_column(String(100), nullable=False, unique=True, index=True)

    status: Mapped[RecordStatus] = mapped_column(
        RecordStatusColumn(),
        default=RecordStatus.ACTIVE,
        nullable=False,
        index=True,
    )

    def __repr__(self) -> str:
        """Return a debug-friendly representation."""
        return f"<LeadSource name={self.name!r} status={self.status!r}>"
