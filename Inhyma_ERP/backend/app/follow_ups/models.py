"""
FollowUp ORM Model.

Tracks telecalling interaction logs, client follow-up classifications,
scheduled follow-up dates, call feedback, marketing handlers, and inquiry logs.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime

from sqlalchemy import Date, DateTime, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database.base import Base, SoftDeleteMixin, TimestampMixin, UUIDPrimaryKeyMixin, VersionMixin


class FollowUp(Base, UUIDPrimaryKeyMixin, TimestampMixin, VersionMixin, SoftDeleteMixin):
    """A single Follow-Up / Telecalling Log entity."""

    __tablename__ = "follow_ups"

    company_name: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    contact_person: Mapped[str | None] = mapped_column(String(150), nullable=True)
    contact_phone: Mapped[str | None] = mapped_column(String(50), nullable=True)
    contact_email: Mapped[str | None] = mapped_column(String(100), nullable=True)
    designation: Mapped[str | None] = mapped_column(String(100), nullable=True)

    # Classification & Grading
    business_type: Mapped[str | None] = mapped_column(String(100), nullable=True, index=True)
    client_grade: Mapped[str | None] = mapped_column(String(50), nullable=True, index=True)
    potential_type: Mapped[str | None] = mapped_column(String(50), nullable=True, index=True)
    business_category: Mapped[str | None] = mapped_column(String(100), nullable=True, index=True)
    category: Mapped[str | None] = mapped_column(String(100), nullable=True, index=True)

    # Interaction / Call Details
    call_type: Mapped[str | None] = mapped_column(String(50), nullable=True, index=True)
    call_category: Mapped[str | None] = mapped_column(String(100), nullable=True, index=True)
    marketing_person: Mapped[str | None] = mapped_column(String(150), nullable=True, index=True)
    current_status: Mapped[str] = mapped_column(String(50), nullable=False, default="New", index=True)
    feedback: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Geographic Hierarchy
    address: Mapped[str | None] = mapped_column(String(255), nullable=True)
    area: Mapped[str | None] = mapped_column(String(150), nullable=True)
    city: Mapped[str | None] = mapped_column(String(100), nullable=True, index=True)
    district: Mapped[str | None] = mapped_column(String(100), nullable=True, index=True)
    state: Mapped[str | None] = mapped_column(String(100), nullable=True, index=True)

    # Dates
    followup_date: Mapped[date | None] = mapped_column(Date, nullable=True, index=True)
    added_on: Mapped[date] = mapped_column(Date, nullable=False, default=date.today, index=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    def __repr__(self) -> str:
        return f"<FollowUp id={self.id!r} company={self.company_name!r} status={self.current_status!r}>"
