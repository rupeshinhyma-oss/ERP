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


class HrmsAttendanceLog(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """
    Daily employee punch log record with check-in/out and irregular status tracking.
    """

    __tablename__ = "hrms_attendance_logs"

    user_id: Mapped[GUID] = mapped_column(
        GUID(),
        ForeignKey("users.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    attendance_date: Mapped[date] = mapped_column(Date, index=True, nullable=False)
    check_in_time: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    check_out_time: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    office_id: Mapped[Optional[GUID]] = mapped_column(
        GUID(),
        ForeignKey("hrms_locations.id", ondelete="SET NULL"),
        nullable=True,
    )
    latitude: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    longitude: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    punch_type: Mapped[Optional[str]] = mapped_column(String(20), default="CHECK_IN", nullable=True)
    status: Mapped[str] = mapped_column(String(50), default="OPEN", index=True, nullable=False)
    final_status: Mapped[Optional[str]] = mapped_column(String(50), default="Present", nullable=True)
    total_work_minutes: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    rule_triggered: Mapped[Optional[str]] = mapped_column(String(150), nullable=True)
    punch_in: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    punch_out: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    total_hours: Mapped[Optional[str]] = mapped_column(String(30), nullable=True)
    workplace: Mapped[Optional[str]] = mapped_column(String(150), nullable=True)
    is_irregular: Mapped[bool] = mapped_column(Boolean, default=False, index=True, nullable=False)
    late_mark: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    half_day: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    regularization_status: Mapped[Optional[str]] = mapped_column(String(30), default=None, nullable=True)

    # Relationships
    office: Mapped[Optional["HrmsLocation"]] = relationship("HrmsLocation")

    @property
    def employee_id(self):
        return self.user_id

    @employee_id.setter
    def employee_id(self, val):
        self.user_id = val


# Model alias for session-centric attendance queries
AttendanceSession = HrmsAttendanceLog



class HrmsRegularizationRequest(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """
    Employee Regularization Request submitted via the right-side drawer.
    """

    __tablename__ = "hrms_regularization_requests"

    user_id: Mapped[GUID] = mapped_column(
        GUID(),
        ForeignKey("users.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    attendance_date: Mapped[date] = mapped_column(Date, index=True, nullable=False)
    check_in: Mapped[str] = mapped_column(String(20), nullable=False)
    check_out: Mapped[str] = mapped_column(String(20), nullable=False)
    total_hours: Mapped[str] = mapped_column(String(30), nullable=False)
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="PENDING", index=True, nullable=False)
    manager_id: Mapped[Optional[GUID]] = mapped_column(
        GUID(),
        ForeignKey("users.id", ondelete="SET NULL"),
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


class HrmsAdjustedLeave(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """
    Attendance irregularities converted into adjustment records.
    """

    __tablename__ = "hrms_adjusted_leaves"

    user_id: Mapped[GUID] = mapped_column(
        GUID(),
        ForeignKey("users.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    irregularity_date: Mapped[date] = mapped_column(Date, index=True, nullable=False)
    irregularity_type: Mapped[str] = mapped_column(String(50), nullable=False)
    requested_action: Mapped[str] = mapped_column(String(100), default="Regularization Request", nullable=False)
    final_decision: Mapped[str] = mapped_column(String(50), default="Pending", nullable=False)
    leave_deducted: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    manager_id: Mapped[Optional[GUID]] = mapped_column(
        GUID(),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    manager_remarks: Mapped[Optional[str]] = mapped_column(Text, nullable=True)


class HrmsAttendanceSettings(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """
    3-Tab Attendance Configuration Settings.
    """

    __tablename__ = "hrms_attendance_settings"

    # Tab 1: Configure Attendance
    shift_name: Mapped[str] = mapped_column(String(100), default="General Shift (10:30 AM - 07:00 PM)", nullable=False)
    shift_start: Mapped[str] = mapped_column(String(50), default="10:30 AM", nullable=False)
    shift_end: Mapped[str] = mapped_column(String(50), default="07:00 PM", nullable=False)
    grace_until: Mapped[str] = mapped_column(String(50), default="10:45 AM", nullable=False)
    late_starts_after: Mapped[str] = mapped_column(String(50), default="10:45 AM", nullable=False)
    direct_half_day_after: Mapped[str] = mapped_column(String(50), default="11:30 AM", nullable=False)
    late_marks_before_half_day: Mapped[int] = mapped_column(Integer, default=3, nullable=False)
    payroll_cycle: Mapped[str] = mapped_column(String(100), default="1st to 31st of Month", nullable=False)
    employment_type: Mapped[str] = mapped_column(String(100), default="Full Time Permanent", nullable=False)
    max_late_check_in: Mapped[str] = mapped_column(String(50), default="30 minutes", nullable=False)
    max_early_check_out: Mapped[str] = mapped_column(String(50), default="15 minutes", nullable=False)
    grace_period_mins: Mapped[int] = mapped_column(Integer, default=15, nullable=False)
    late_attendance_rule: Mapped[str] = mapped_column(String(200), default="3 late punches = 0.5 day leave deduction", nullable=False)
    recurring_cycle: Mapped[str] = mapped_column(String(100), default="1st to end of current calendar month", nullable=False)

    # Tab 3: Configure Overtime
    min_overtime_mins: Mapped[int] = mapped_column(Integer, default=60, nullable=False)
    max_overtime_mins: Mapped[int] = mapped_column(Integer, default=240, nullable=False)
    holiday_overtime: Mapped[str] = mapped_column(String(100), default="2.0x base pay or comp-off", nullable=False)
    weekend_overtime: Mapped[str] = mapped_column(String(100), default="1.5x base hourly rate", nullable=False)
    approval_required: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)


class HrmsAttendanceExemption(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """
    Tab 2: Attendance Exemptions for employees.
    """

    __tablename__ = "hrms_attendance_exemptions"

    user_id: Mapped[GUID] = mapped_column(
        GUID(),
        ForeignKey("users.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    exemption_type: Mapped[str] = mapped_column(String(100), nullable=False)
    effective_from: Mapped[date] = mapped_column(Date, nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="ACTIVE", nullable=False)


class HrmsAttendancePolicy(Base, UUIDPrimaryKeyMixin, TimestampMixin, SoftDeleteMixin):
    """
    Reusable Attendance Policy Engine configurations.
    """

    __tablename__ = "hrms_attendance_policies"

    name: Mapped[str] = mapped_column(String(150), nullable=False, index=True)
    shift_start: Mapped[str] = mapped_column(String(50), default="10:30 AM", nullable=False)
    shift_end: Mapped[str] = mapped_column(String(50), default="07:00 PM", nullable=False)
    grace_until: Mapped[str] = mapped_column(String(50), default="10:45 AM", nullable=False)
    late_starts_after: Mapped[str] = mapped_column(String(50), default="10:45 AM", nullable=False)
    direct_half_day_after: Mapped[str] = mapped_column(String(50), default="11:30 AM", nullable=False)
    late_marks_before_half_day: Mapped[int] = mapped_column(Integer, default=3, nullable=False)
    payroll_cycle: Mapped[str] = mapped_column(String(100), default="1st to 31st of Month", nullable=False)
    employment_type: Mapped[str] = mapped_column(String(100), default="Full Time Permanent", nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=False, index=True, nullable=False)
    is_archived: Mapped[bool] = mapped_column(Boolean, default=False, index=True, nullable=False)

    @property
    def policy_name(self) -> str:
        return self.name

    @property
    def late_after(self) -> str:
        return self.late_starts_after

    @property
    def late_threshold(self) -> int:
        return self.late_marks_before_half_day

    @property
    def active(self) -> bool:
        return self.is_active

