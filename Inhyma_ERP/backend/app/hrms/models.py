"""
HRMS Setup Database Models.

Permanent PostgreSQL schema for:
- Office Locations (Geofencing parameters & office boundaries)
- Employee Location Assignments
- Leave Types & Entitlements
- Expense Categories
- Expense Approval Configuration & Claim Rules
"""

from __future__ import annotations

from datetime import date, datetime
import uuid
from sqlalchemy import Boolean, Date, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.database.base import (
    Base,
    GUID,
    SoftDeleteMixin,
    TimestampMixin,
    UUIDPrimaryKeyMixin,
    VersionMixin,
)


class HrmsLocation(Base, UUIDPrimaryKeyMixin, TimestampMixin, SoftDeleteMixin, VersionMixin):
    """
    Office Location master for Attendance geofence validation.

    Stores office coordinates and radius in meters. Soft-deleted locations
    are excluded from active attendance punch verification.
    """

    __tablename__ = "hrms_locations"

    name: Mapped[str] = mapped_column(String(150), nullable=False, index=True)
    location_type: Mapped[str] = mapped_column(String(50), default="OFFICE", nullable=False)
    address: Mapped[str] = mapped_column(Text, nullable=False)
    latitude: Mapped[float] = mapped_column(Float, nullable=False)
    longitude: Mapped[float] = mapped_column(Float, nullable=False)
    radius_meters: Mapped[float] = mapped_column(Float, default=150.0, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False, index=True)


class HrmsEmployeeLocation(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """
    Mapping between employees and authorized office locations.
    """

    __tablename__ = "hrms_employee_locations"

    user_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    location_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("hrms_locations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    is_primary: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)


class HrmsLeaveType(Base, UUIDPrimaryKeyMixin, TimestampMixin, SoftDeleteMixin, VersionMixin):
    """
    Leave types and corporate annual leave allocation policies.
    """

    __tablename__ = "hrms_leave_types"

    name: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    code: Mapped[str | None] = mapped_column(String(50), nullable=True)
    leave_type: Mapped[str] = mapped_column(String(50), default="REGULAR", nullable=False)
    is_paid: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    annual_balance: Mapped[float] = mapped_column(Float, default=12.0, nullable=False)
    carry_forward_days: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    max_consecutive_days: Mapped[int] = mapped_column(Integer, default=5, nullable=False)
    monthly_accrual: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False, index=True)


class HrmsExpenseCategory(Base, UUIDPrimaryKeyMixin, TimestampMixin, SoftDeleteMixin, VersionMixin):
    """
    Expense reimbursement categories (e.g. Travel, Meals, Fuel).
    """

    __tablename__ = "hrms_expense_categories"

    name: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    code: Mapped[str | None] = mapped_column(String(50), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False, index=True)


class HrmsExpenseSettings(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """
    Global Expense approval workflow stages and claim limit rules.
    Singleton record storing organization-wide expense policies.
    """

    __tablename__ = "hrms_expense_settings"

    approval_team_lead: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    approval_manager: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    approval_accounts: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    max_claim_amount: Mapped[float] = mapped_column(Float, default=50000.0, nullable=False)
    receipt_required: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    auto_approval_limit: Mapped[float] = mapped_column(Float, default=500.0, nullable=False)
    submission_window_days: Mapped[int] = mapped_column(Integer, default=30, nullable=False)


class HrmsAttendancePolicy(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """
    Organization-wide configurable attendance policy engine.
    Stores standard shift timings, grace minutes, late limits, severe late arrival,
    early exit buffers, missing punch policies, and optional advanced rules.
    """

    __tablename__ = "hrms_attendance_policies"

    shift_name: Mapped[str] = mapped_column(String(100), default="General Shift", nullable=False)
    shift_start_time: Mapped[str] = mapped_column(String(10), default="10:30", nullable=False)
    shift_end_time: Mapped[str] = mapped_column(String(10), default="19:00", nullable=False)
    weekly_off: Mapped[str] = mapped_column(String(100), default="Sunday", nullable=False)
    payroll_cycle: Mapped[str] = mapped_column(String(100), default="1st-End of Month", nullable=False)
    geofence_radius_meters: Mapped[float] = mapped_column(Float, default=150.0, nullable=False)

    # Grace Period
    enable_grace: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    grace_period_minutes: Mapped[int] = mapped_column(Integer, default=15, nullable=False)
    grace_end_time: Mapped[str] = mapped_column(String(10), default="10:45", nullable=False)

    # Late Mark Rules
    enable_late_marks: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    late_start_time: Mapped[str] = mapped_column(String(10), default="10:46", nullable=False)
    count_late_monthly: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    monthly_late_limit: Mapped[int] = mapped_column(Integer, default=3, nullable=False)
    third_late_action: Mapped[str] = mapped_column(String(50), default="Half Day", nullable=False)

    # Severe Late Arrival Rule (Direct Half Day)
    enable_direct_half_day: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    direct_half_day_time: Mapped[str] = mapped_column(String(10), default="11:31", nullable=False)
    half_day_threshold_minutes: Mapped[int] = mapped_column(Integer, default=60, nullable=False)

    # Early Exit Rules
    enable_early_exit: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    early_exit_buffer_minutes: Mapped[int] = mapped_column(Integer, default=15, nullable=False)
    mark_early_exit: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    auto_regularization_early_exit: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    # Missing Punch Policy
    missing_punch_out: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    missing_punch_in: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    auto_mark_irregular: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    require_regularization: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    # Advanced Attendance Rules (Optional)
    consecutive_late_warning: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    auto_email_notification: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    auto_manager_notification: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    holiday_overtime: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    weekend_overtime: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    flexible_shift: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    grace_extension: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)


class HrmsAttendance(Base, UUIDPrimaryKeyMixin, TimestampMixin, VersionMixin):
    """
    Daily Employee Attendance record with geofence validation and live session tracking.
    Enforces strictly one attendance record per employee per day.
    """

    __tablename__ = "hrms_attendance"

    employee_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    attendance_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    punch_in: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    punch_out: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    status: Mapped[str] = mapped_column(String(50), default="PRESENT", nullable=False, index=True)
    working_minutes: Mapped[int | None] = mapped_column(Integer, default=0, nullable=True)
    late_minutes: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    early_exit_minutes: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    office_location_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("hrms_locations.id", ondelete="SET NULL"), nullable=True, index=True
    )
    latitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    longitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    punch_in_distance: Mapped[float | None] = mapped_column(Float, nullable=True)
    punch_out_distance: Mapped[float | None] = mapped_column(Float, nullable=True)
    is_irregular: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, index=True)
    regularization_status: Mapped[str] = mapped_column(String(50), default="NONE", nullable=False, index=True)
    regularization_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    regularization_note: Mapped[str | None] = mapped_column(Text, nullable=True)

    __table_args__ = (
        UniqueConstraint("employee_id", "attendance_date", name="uq_hrms_attendance_employee_date"),
    )


class HrmsAttendanceRegularization(Base, UUIDPrimaryKeyMixin, TimestampMixin, VersionMixin):
    """
    Persistent table for attendance regularization requests.
    Stores request details, audit tracking, manager reviews, and status workflow.
    """

    __tablename__ = "hrms_attendance_regularizations"

    employee_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    attendance_record_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("hrms_attendance.id", ondelete="SET NULL"), nullable=True, index=True
    )
    attendance_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    request_type: Mapped[str] = mapped_column(String(50), default="LATE_PUNCH", nullable=False)
    reason: Mapped[str] = mapped_column(String(255), nullable=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    punch_in_time: Mapped[str | None] = mapped_column(String(20), nullable=True)
    punch_out_time: Mapped[str | None] = mapped_column(String(20), nullable=True)
    total_hours: Mapped[str | None] = mapped_column(String(20), nullable=True)
    status: Mapped[str] = mapped_column(String(50), default="PENDING", nullable=False, index=True)
    submitted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    reviewed_by: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    manager_remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    action_taken: Mapped[str | None] = mapped_column(String(50), nullable=True)


