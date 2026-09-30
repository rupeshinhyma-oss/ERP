"""
Lead ORM Model.

Tracks incoming sales leads, prospects, sources, contact details,
geography, requirements, sales allocations, and lead statuses.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime

from sqlalchemy import Date, DateTime, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database.base import Base, SoftDeleteMixin, TimestampMixin, UUIDPrimaryKeyMixin, VersionMixin


class Lead(Base, UUIDPrimaryKeyMixin, TimestampMixin, VersionMixin, SoftDeleteMixin):
    """A single Lead entity."""

    __tablename__ = "leads"

    company_name: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    business_type: Mapped[str | None] = mapped_column(String(100), nullable=True, index=True)
    source: Mapped[str | None] = mapped_column(String(100), nullable=True, index=True)
    contact_person: Mapped[str | None] = mapped_column(String(150), nullable=True)
    designation: Mapped[str | None] = mapped_column(String(100), nullable=True)
    contact_phone: Mapped[str | None] = mapped_column(String(50), nullable=True)
    contact_email: Mapped[str | None] = mapped_column(String(100), nullable=True)
    priority: Mapped[str] = mapped_column(String(50), nullable=False, default="Medium", index=True)
    address: Mapped[str | None] = mapped_column(String(255), nullable=True)
    area: Mapped[str | None] = mapped_column(String(150), nullable=True)
    city: Mapped[str | None] = mapped_column(String(100), nullable=True, index=True)
    district: Mapped[str | None] = mapped_column(String(100), nullable=True)
    state: Mapped[str | None] = mapped_column(String(100), nullable=True, index=True)
    requirements: Mapped[str | None] = mapped_column(Text, nullable=True)
    allotted_to: Mapped[str | None] = mapped_column(String(150), nullable=True, index=True)
    created_by: Mapped[str | None] = mapped_column(String(150), nullable=True, index=True)
    lead_status: Mapped[str] = mapped_column(String(50), nullable=False, default="New", index=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    added_on: Mapped[date] = mapped_column(Date, nullable=False, default=date.today)

    def __repr__(self) -> str:
        return f"<Lead id={self.id!r} company={self.company_name!r} status={self.lead_status!r}>"
