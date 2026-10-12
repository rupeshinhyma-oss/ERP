"""
Agent ORM Model.

Tracks sourcing/sales agents, commission representatives, contact channels,
work descriptions, territory coverage, assigned sales person, and age calculation.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime

from sqlalchemy import Date, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database.base import Base, SoftDeleteMixin, TimestampMixin, UUIDPrimaryKeyMixin, VersionMixin


class Agent(Base, UUIDPrimaryKeyMixin, TimestampMixin, VersionMixin, SoftDeleteMixin):
    """An external Agent entity."""

    __tablename__ = "agents"

    full_name: Mapped[str] = mapped_column(String(150), nullable=False, index=True)
    agent_type: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    company_name: Mapped[str | None] = mapped_column(String(200), nullable=True, index=True)
    work_description: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Contact Info
    calling_number: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    whatsapp_number: Mapped[str | None] = mapped_column(String(50), nullable=True, index=True)

    # Geographic Location
    state: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    district: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    city: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    area: Mapped[str | None] = mapped_column(String(150), nullable=True)
    address: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Demographics & Grade
    birth_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    age: Mapped[int | None] = mapped_column(Integer, nullable=True)
    agent_grade: Mapped[str | None] = mapped_column(String(50), nullable=True, index=True)
    current_status: Mapped[str] = mapped_column(String(50), nullable=False, default="Select", index=True)  # Existing / New / Select
    potential: Mapped[str] = mapped_column(String(50), nullable=False, default="Select", index=True)  # Yes / No / Select

    # Sales Person Tagging & Remarks
    sales_person: Mapped[str | None] = mapped_column(String(150), nullable=True, index=True)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    added_on: Mapped[date] = mapped_column(Date, nullable=False, default=date.today, index=True)

    def __repr__(self) -> str:
        return f"<Agent id={self.id!r} name={self.full_name!r} calling={self.calling_number!r}>"
