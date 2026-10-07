"""
Technical Task ORM Model.

Tracks field technical tasks, onsite service visits, in-house trials/demos,
repairs, technician allocations, status lifecycles, and technical call logs.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import Date, DateTime, ForeignKey, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.base import Base, SoftDeleteMixin, TimestampMixin, UUIDPrimaryKeyMixin, VersionMixin


class TechnicalTask(Base, UUIDPrimaryKeyMixin, TimestampMixin, VersionMixin, SoftDeleteMixin):
    """A single technical task record."""

    __tablename__ = "technical_tasks"

    company_name: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    task_type: Mapped[str] = mapped_column(String(100), nullable=False, default="In-House", index=True)
    city: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    third_party: Mapped[str | None] = mapped_column(String(100), nullable=True)
    third_party_city: Mapped[str | None] = mapped_column(String(100), nullable=True)
    third_party_contact_name: Mapped[str | None] = mapped_column(String(150), nullable=True)
    third_party_contact_phone: Mapped[str | None] = mapped_column(String(50), nullable=True)

    priority: Mapped[str] = mapped_column(String(10), nullable=False, default="A", index=True)
    machine_model: Mapped[str] = mapped_column(String(255), nullable=False)
    task_description: Mapped[str] = mapped_column(Text, nullable=False, default="")

    # Contact info
    contact_person_name: Mapped[str | None] = mapped_column(String(150), nullable=True)
    contact_designation: Mapped[str | None] = mapped_column(String(100), nullable=True)
    contact_phone: Mapped[str | None] = mapped_column(String(50), nullable=True)

    # Creation metadata
    created_by_name: Mapped[str] = mapped_column(String(100), nullable=False, default="Admin")
    task_created_date: Mapped[date] = mapped_column(Date, nullable=False, default=date.today)
    creator_remarks: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Service & Call details
    service_type: Mapped[str] = mapped_column(String(50), nullable=False, default="Free")
    service_charge: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    payment_terms: Mapped[str | None] = mapped_column(Text, nullable=True)
    call_type: Mapped[str] = mapped_column(String(50), nullable=False, default="Demo", index=True)

    # Approval & Allotment
    task_approved_by: Mapped[str | None] = mapped_column(String(100), nullable=True)
    task_approved_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    task_allotted_to: Mapped[str | None] = mapped_column(String(100), nullable=True, index=True)
    approver_remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    scheduled_visit_date: Mapped[date | None] = mapped_column(Date, nullable=True)

    # Financial & Lifecycle status
    payment_status: Mapped[str | None] = mapped_column(String(50), nullable=True)
    payment_mode: Mapped[str | None] = mapped_column(String(50), nullable=True)
    payment_screenshot: Mapped[str | None] = mapped_column(String(500), nullable=True)
    status: Mapped[str] = mapped_column(String(50), nullable=False, default="Pending", index=True)
    cancel_remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    completed_date: Mapped[date | None] = mapped_column(Date, nullable=True)

    # Call Logs relationship
    call_logs: Mapped[list[TechnicalTaskCallLog]] = relationship(
        "TechnicalTaskCallLog",
        back_populates="task",
        cascade="all, delete-orphan",
        order_by="desc(TechnicalTaskCallLog.created_at)",
        lazy="noload",
    )

    def __repr__(self) -> str:
        return (
            f"<TechnicalTask id={self.id!r} company={self.company_name!r} "
            f"type={self.task_type!r} status={self.status!r}>"
        )


class TechnicalTaskCallLog(Base, UUIDPrimaryKeyMixin):
    """A log entry for a technical call or physical visit."""

    __tablename__ = "technical_task_call_logs"

    task_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("technical_tasks.id", ondelete="CASCADE"), nullable=False, index=True
    )
    call_date: Mapped[date] = mapped_column(Date, nullable=False, default=date.today)
    call_type: Mapped[str] = mapped_column(String(50), nullable=False, default="Telecall")
    remarks: Mapped[str] = mapped_column(Text, nullable=False)
    created_by: Mapped[str] = mapped_column(String(100), nullable=False, default="Technician")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)

    task: Mapped[TechnicalTask] = relationship("TechnicalTask", back_populates="call_logs")

    def __repr__(self) -> str:
        return f"<TechnicalTaskCallLog id={self.id!r} task_id={self.task_id!r} type={self.call_type!r}>"
