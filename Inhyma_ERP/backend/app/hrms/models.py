"""
HRMS ORM Models.

Defines the tables supporting Location Management, Employee Location Assignments,
and Employee WFH Requests inside the HRMS module.
"""

from __future__ import annotations

from datetime import date, datetime, timezone
from enum import Enum
from typing import Optional

from sqlalchemy import Boolean, Date, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.base import (
    GUID,
    Base,
    SoftDeleteMixin,
    TimestampMixin,
    UUIDPrimaryKeyMixin,
    VersionMixin,
)


class LocationType(str, Enum):
    """Supported office and operational location classifications."""

    OFFICE = "OFFICE"
    BRANCH = "BRANCH"
    WAREHOUSE = "WAREHOUSE"
    FACTORY = "FACTORY"
    CLIENT_SITE = "CLIENT_SITE"


class WfhRequestStatus(str, Enum):
    """Lifecycle statuses for employee WFH requests."""

    PENDING = "PENDING"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"


class HrmsLocation(Base, UUIDPrimaryKeyMixin, TimestampMixin, VersionMixin, SoftDeleteMixin):
    """
    Office or facility location with geofence coordinates and radius.
    """

    __tablename__ = "hrms_locations"

    name: Mapped[str] = mapped_column(String(150), index=True, nullable=False)
    location_type: Mapped[str] = mapped_column(String(50), default=LocationType.OFFICE.value, index=True, nullable=False)
    address: Mapped[str] = mapped_column(Text, nullable=False)
    latitude: Mapped[float] = mapped_column(Float, nullable=False)
    longitude: Mapped[float] = mapped_column(Float, nullable=False)
    radius_meters: Mapped[float] = mapped_column(Float, default=150.0, nullable=False)
    place_id: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, index=True, nullable=False)

    # Relationships
    employee_assignments: Mapped[list["HrmsEmployeeLocation"]] = relationship(
        "HrmsEmployeeLocation",
        back_populates="location",
        cascade="all, delete-orphan",
    )


class HrmsEmployeeLocation(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """
    Mapping between an employee (User) and their assigned locations.
    An employee has exactly one primary location (is_primary=True)
    and zero or more additional locations (is_primary=False).
    """

    __tablename__ = "hrms_employee_locations"

    user_id: Mapped[GUID] = mapped_column(
        GUID(),
        ForeignKey("users.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    location_id: Mapped[GUID] = mapped_column(
        GUID(),
        ForeignKey("hrms_locations.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    is_primary: Mapped[bool] = mapped_column(
        Boolean,
        default=False,
        index=True,
        nullable=False,
    )

    # Relationships
    location: Mapped["HrmsLocation"] = relationship("HrmsLocation", back_populates="employee_assignments")


class HrmsWfhRequest(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """
    Employee Work-From-Home (WFH) request containing map-confirmed location pin
    and sent to the manager approval queue.
    """

    __tablename__ = "hrms_wfh_requests"

    user_id: Mapped[GUID] = mapped_column(
        GUID(),
        ForeignKey("users.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    wfh_date: Mapped[date] = mapped_column(Date, index=True, nullable=False)
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    address: Mapped[str] = mapped_column(Text, nullable=False)
    latitude: Mapped[float] = mapped_column(Float, nullable=False)
    longitude: Mapped[float] = mapped_column(Float, nullable=False)
    radius_meters: Mapped[float] = mapped_column(Float, default=150.0, nullable=False)
    place_id: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    status: Mapped[str] = mapped_column(
        String(20),
        default=WfhRequestStatus.PENDING.value,
        index=True,
        nullable=False,
    )
    manager_id: Mapped[Optional[GUID]] = mapped_column(
        GUID(),
        ForeignKey("users.id", ondelete="SET NULL"),
        index=True,
        nullable=True,
    )
    manager_remarks: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    submitted_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    reviewed_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
