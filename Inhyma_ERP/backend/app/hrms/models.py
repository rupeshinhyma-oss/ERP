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
from sqlalchemy import Boolean, Date, DateTime, Float, ForeignKey, Integer, JSON, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.base import (
    Base,
    GUID,
    SoftDeleteMixin,
    TimestampMixin,
    UUIDPrimaryKeyMixin,
    VersionMixin,
)
from app.users.models import User


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
    carry_forward_allowed: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    carry_forward_days: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    max_consecutive_days: Mapped[int] = mapped_column(Integer, default=5, nullable=False)
    monthly_accrual: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False, index=True)

    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    accrual_amount: Mapped[float] = mapped_column(Float, default=1.0, nullable=False)
    min_notice_days: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    allow_half_day: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    allow_backdated: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    require_attachment: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    attendance_based_accrual: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    attendance_based_condition: Mapped[str | None] = mapped_column(String(100), default="FULL_MONTH_PRESENT", nullable=True)
    attendance_based_reward: Mapped[float] = mapped_column(Float, default=1.0, nullable=False)
    attendance_based_departments: Mapped[str | None] = mapped_column(String(500), default="ALL", nullable=True)
    min_attendance_percentage: Mapped[float | None] = mapped_column(Float, nullable=True)
    min_working_days: Mapped[int | None] = mapped_column(Integer, nullable=True)

    allocation_unit: Mapped[str] = mapped_column(String(20), default="DAYS", nullable=False)
    accrual_frequency: Mapped[str] = mapped_column(String(20), default="MONTHLY", nullable=False)
    applicable_to: Mapped[str] = mapped_column(String(50), default="ALL", nullable=False)
    applicable_departments: Mapped[str | None] = mapped_column(String(500), default="ALL", nullable=True)
    applicable_branches: Mapped[str | None] = mapped_column(String(500), default="ALL", nullable=True)
    count_weekends_as_leave: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    count_holidays_as_leave: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    allow_negative_balance: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    @property
    def annual_entitlement(self) -> float:
        return self.annual_balance

    @property
    def max_carry_forward(self) -> float:
        return self.carry_forward_days


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


# ===========================================================================
# HRMS Leave Management (Phase 1: Foundation & Master Data)
# ===========================================================================

class HrmsLeavePlan(Base, UUIDPrimaryKeyMixin, TimestampMixin, SoftDeleteMixin, VersionMixin):
    """
    Corporate Leave Plans determining applicable leave types by branch and department.
    """

    __tablename__ = "hrms_leave_plans"

    name: Mapped[str] = mapped_column(String(150), nullable=False, index=True)
    effective_from: Mapped[date] = mapped_column(Date, nullable=False)
    effective_to: Mapped[date] = mapped_column(Date, nullable=False)
    branch: Mapped[str] = mapped_column(String(100), default="All Branches", nullable=False)
    department: Mapped[str] = mapped_column(String(100), default="All Departments", nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False, index=True)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    updated_by: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    leave_types: Mapped[list["HrmsLeaveType"]] = relationship(
        "HrmsLeaveType",
        secondary="hrms_leave_plan_types",
        backref="leave_plans",
        lazy="selectin",
    )


class HrmsLeavePlanType(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """
    Many-to-many junction table between Leave Plans and assigned Leave Types.
    """

    __tablename__ = "hrms_leave_plan_types"

    plan_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("hrms_leave_plans.id", ondelete="CASCADE"), nullable=False, index=True
    )
    leave_type_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("hrms_leave_types.id", ondelete="CASCADE"), nullable=False, index=True
    )

    __table_args__ = (
        UniqueConstraint("plan_id", "leave_type_id", name="uq_hrms_leave_plan_types_plan_leave"),
    )


class HrmsHoliday(Base, UUIDPrimaryKeyMixin, TimestampMixin, SoftDeleteMixin, VersionMixin):
    """
    Corporate Holiday master with branch-specific or global applicability.
    """

    __tablename__ = "hrms_holidays"

    name: Mapped[str] = mapped_column(String(150), nullable=False, index=True)
    holiday_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    number_of_days: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    branch_applicability: Mapped[str] = mapped_column(String(255), default="All Branches", nullable=False)
    department_scope: Mapped[str | None] = mapped_column(String(255), default="ALL", nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False, index=True)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    updated_by: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )


class HrmsEmployeeLeaveBalance(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """
    Employee leave quotas, consumption, adjustments, and available balances.
    available = allocated + adjusted - consumed
    """

    __tablename__ = "hrms_employee_leave_balances"

    employee_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    leave_type_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("hrms_leave_types.id", ondelete="CASCADE"), nullable=False, index=True
    )
    year: Mapped[int] = mapped_column(Integer, default=2026, nullable=False, index=True)
    allocated: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    consumed: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    adjusted: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    available: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)

    __table_args__ = (
        UniqueConstraint("employee_id", "leave_type_id", "year", name="uq_hrms_emp_leave_balance_year"),
    )

    def recompute_available(self) -> float:
        self.available = round(self.allocated + self.adjusted - self.consumed, 2)
        return self.available


class HrmsLeaveAdjustment(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """
    Audit log / transaction history for manual balance adjustments and approval deductions.
    """

    __tablename__ = "hrms_leave_adjustments"

    employee_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    leave_type_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("hrms_leave_types.id", ondelete="CASCADE"), nullable=False, index=True
    )
    adjustment_type: Mapped[str] = mapped_column(String(50), nullable=False)  # ADD, DEDUCT, CORRECTION, CREDIT, DEBIT, MANUAL_CREDIT, MANUAL_DEBIT, LEAVE_APPROVED, LEAVE_REVERSED
    amount: Mapped[float] = mapped_column(Float, nullable=False)
    previous_balance: Mapped[float] = mapped_column(Float, nullable=False)
    new_balance: Mapped[float] = mapped_column(Float, nullable=False)
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    source: Mapped[str] = mapped_column(String(50), default="MANUAL", nullable=False)  # MANUAL, LEAVE_APPROVAL, LEAVE_REVERSAL, ACCRUAL
    effective_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    adjusted_by: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )


class HrmsLeaveRequest(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """
    Employee leave requests, approvals, and workflow state.
    """

    __tablename__ = "hrms_leave_requests"

    employee_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    leave_type_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("hrms_leave_types.id", ondelete="CASCADE"), nullable=False, index=True
    )
    from_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    to_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    number_of_days: Mapped[float] = mapped_column(Float, nullable=False)
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    attachment: Mapped[str | None] = mapped_column(String(500), nullable=True)
    status: Mapped[str] = mapped_column(String(50), default="PENDING", nullable=False, index=True)
    approval_status: Mapped[str] = mapped_column(String(50), default="PENDING", nullable=False, index=True)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    updated_by: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    approved_by: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    approval_remarks: Mapped[str | None] = mapped_column(Text, nullable=True)

    leave_type: Mapped["HrmsLeaveType"] = relationship("HrmsLeaveType", lazy="selectin")


# ===========================================================================
# HRMS Asset Management (Hardware, Devices, Equipment)
# ===========================================================================

class HrmsAsset(Base, UUIDPrimaryKeyMixin, TimestampMixin, SoftDeleteMixin, VersionMixin):
    """
    Asset master table for tracking corporate hardware, equipment, devices, and inventory.
    """

    __tablename__ = "hrms_assets"

    asset_code: Mapped[str] = mapped_column(String(50), unique=True, nullable=False, index=True)
    asset_name: Mapped[str] = mapped_column(String(150), nullable=False, index=True)
    asset_category: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    brand: Mapped[str | None] = mapped_column(String(100), nullable=True)
    model: Mapped[str | None] = mapped_column(String(100), nullable=True)
    serial_number: Mapped[str | None] = mapped_column(String(100), nullable=True, index=True)
    purchase_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    purchase_cost: Mapped[float | None] = mapped_column(Float, nullable=True)
    status: Mapped[str] = mapped_column(String(50), default="AVAILABLE", nullable=False, index=True)
    condition: Mapped[str] = mapped_column(String(50), default="GOOD", nullable=False)
    location_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("hrms_locations.id", ondelete="SET NULL"), nullable=True, index=True
    )
    assigned_to_user_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    assigned_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    vendor: Mapped[str | None] = mapped_column(String(150), nullable=True)
    warranty_expiry: Mapped[date | None] = mapped_column(Date, nullable=True)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    updated_by: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    # Relationships
    assigned_to: Mapped["User | None"] = relationship("User", foreign_keys=[assigned_to_user_id], lazy="selectin")
    location: Mapped["HrmsLocation | None"] = relationship("HrmsLocation", foreign_keys=[location_id], lazy="selectin")
    creator: Mapped["User | None"] = relationship("User", foreign_keys=[created_by], lazy="selectin")
    updater: Mapped["User | None"] = relationship("User", foreign_keys=[updated_by], lazy="selectin")
    history: Mapped[list["HrmsAssetHistory"]] = relationship(
        "HrmsAssetHistory",
        back_populates="asset",
        cascade="all, delete-orphan",
        order_by="desc(HrmsAssetHistory.created_at)",
        lazy="selectin",
    )
    assignments: Mapped[list["HrmsAssetAssignment"]] = relationship(
        "HrmsAssetAssignment",
        back_populates="asset",
        cascade="all, delete-orphan",
        order_by="desc(HrmsAssetAssignment.assigned_at)",
        lazy="selectin",
    )
    maintenance_records: Mapped[list["HrmsAssetMaintenance"]] = relationship(
        "HrmsAssetMaintenance",
        back_populates="asset",
        cascade="all, delete-orphan",
        order_by="desc(HrmsAssetMaintenance.reported_date)",
        lazy="selectin",
    )


class HrmsAssetHistory(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """
    Event audit log for asset lifecycle events (creation, assignment, return, status/condition updates).
    """

    __tablename__ = "hrms_asset_history"

    asset_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("hrms_assets.id", ondelete="CASCADE"), nullable=False, index=True
    )
    action: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    previous_value: Mapped[str | None] = mapped_column(Text, nullable=True)
    new_value: Mapped[str | None] = mapped_column(Text, nullable=True)
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    performed_by: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Relationships
    asset: Mapped["HrmsAsset"] = relationship("HrmsAsset", back_populates="history")
    user: Mapped["User | None"] = relationship("User", foreign_keys=[user_id], lazy="selectin")
    performer: Mapped["User | None"] = relationship("User", foreign_keys=[performed_by], lazy="selectin")


class HrmsAssetAssignment(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """
    Dedicated persistent asset assignment history and active allocation table.
    Enforces that an asset has zero or one active assignment at any time.
    """

    __tablename__ = "hrms_asset_assignments"

    asset_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("hrms_assets.id", ondelete="CASCADE"), nullable=False, index=True
    )
    employee_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    assigned_at: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    returned_at: Mapped[date | None] = mapped_column(Date, nullable=True, index=True)
    expected_return_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    assignment_status: Mapped[str] = mapped_column(String(50), default="ACTIVE", nullable=False, index=True)
    condition_at_assignment: Mapped[str | None] = mapped_column(String(50), default="GOOD", nullable=True)
    condition_at_return: Mapped[str | None] = mapped_column(String(50), nullable=True)
    assignment_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    return_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    assigned_by: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    returned_by: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    # Relationships
    asset: Mapped["HrmsAsset"] = relationship("HrmsAsset", back_populates="assignments")
    employee: Mapped["User"] = relationship("User", foreign_keys=[employee_id], lazy="selectin")
    assigner: Mapped["User | None"] = relationship("User", foreign_keys=[assigned_by], lazy="selectin")
    returner: Mapped["User | None"] = relationship("User", foreign_keys=[returned_by], lazy="selectin")


class HrmsAssetMaintenance(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """
    Persistent maintenance, repair, and servicing lifecycle records for assets.
    """

    __tablename__ = "hrms_asset_maintenance"

    asset_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("hrms_assets.id", ondelete="CASCADE"), nullable=False, index=True
    )
    issue: Mapped[str] = mapped_column(String(255), nullable=False)
    reported_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    maintenance_start: Mapped[date | None] = mapped_column(Date, nullable=True)
    maintenance_end: Mapped[date | None] = mapped_column(Date, nullable=True)
    vendor_technician: Mapped[str | None] = mapped_column(String(150), nullable=True)
    cost: Mapped[float | None] = mapped_column(Float, nullable=True)
    status: Mapped[str] = mapped_column(String(50), default="OPEN", nullable=False, index=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    updated_by: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    # Relationships
    asset: Mapped["HrmsAsset"] = relationship("HrmsAsset", back_populates="maintenance_records")
    creator: Mapped["User | None"] = relationship("User", foreign_keys=[created_by], lazy="selectin")
    updater: Mapped["User | None"] = relationship("User", foreign_keys=[updated_by], lazy="selectin")


# ===========================================================================
# HRMS Expense Management (Phase 2: Functional Core)
# ===========================================================================

class HrmsExpense(Base, UUIDPrimaryKeyMixin, TimestampMixin, SoftDeleteMixin, VersionMixin):
    """
    Employee expense claims, drafts, approvals, and reimbursements.
    """

    __tablename__ = "hrms_expenses"

    expense_code: Mapped[str] = mapped_column(String(50), unique=True, nullable=False, index=True)
    employee_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    expense_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    category: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    amount: Mapped[float] = mapped_column(Float, nullable=False)
    currency: Mapped[str] = mapped_column(String(10), default="INR", nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    location_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("hrms_locations.id", ondelete="SET NULL"), nullable=True, index=True
    )
    receipt_url: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    receipt_filename: Mapped[str | None] = mapped_column(String(255), nullable=True)
    status: Mapped[str] = mapped_column(String(50), default="DRAFT", nullable=False, index=True)
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    reviewed_by: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    rejection_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    reimbursed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    reimbursed_by: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    reimbursement_notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Relationships
    employee: Mapped["User"] = relationship("User", foreign_keys=[employee_id], lazy="selectin")
    reviewer: Mapped["User | None"] = relationship("User", foreign_keys=[reviewed_by], lazy="selectin")
    reimburser: Mapped["User | None"] = relationship("User", foreign_keys=[reimbursed_by], lazy="selectin")
    location: Mapped["HrmsLocation | None"] = relationship("HrmsLocation", foreign_keys=[location_id], lazy="selectin")


# ===========================================================================
# HRMS Site Visit & Live Tracking
# ===========================================================================

class HrmsSiteVisit(Base, UUIDPrimaryKeyMixin, TimestampMixin, SoftDeleteMixin, VersionMixin):
    """
    On-field client/customer site visits assigned by Admin/HR.
    Employees check in and check out at the customer location with GPS verification.
    """

    __tablename__ = "hrms_site_visits"

    employee_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    customer_name: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    site_address: Mapped[str] = mapped_column(Text, nullable=False)
    site_latitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    site_longitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    visit_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    planned_start_time: Mapped[str] = mapped_column(String(20), nullable=False)
    planned_end_time: Mapped[str] = mapped_column(String(20), nullable=False)
    status: Mapped[str] = mapped_column(String(50), default="SCHEDULED", nullable=False, index=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Check-In evidence
    check_in_time: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    check_in_latitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    check_in_longitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    check_in_accuracy: Mapped[float | None] = mapped_column(Float, nullable=True)
    check_in_address: Mapped[str | None] = mapped_column(String(500), nullable=True)

    # Check-Out evidence
    check_out_time: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    check_out_latitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    check_out_longitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    check_out_accuracy: Mapped[float | None] = mapped_column(Float, nullable=True)
    check_out_address: Mapped[str | None] = mapped_column(String(500), nullable=True)

    # Audit
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    # Relationships
    employee: Mapped["User"] = relationship("User", foreign_keys=[employee_id], lazy="selectin")
    creator: Mapped["User | None"] = relationship("User", foreign_keys=[created_by], lazy="selectin")
    tracking_sessions: Mapped[list["HrmsLiveTrackingSession"]] = relationship(
        "HrmsLiveTrackingSession", back_populates="site_visit", cascade="all, delete-orphan", lazy="selectin"
    )


class HrmsLiveTrackingSession(Base, UUIDPrimaryKeyMixin, TimestampMixin, VersionMixin):
    """
    Live tracking session initiated by employee.
    Stores compact processed route summary, distance, and duration once stopped.
    """

    __tablename__ = "hrms_tracking_sessions"

    employee_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    site_visit_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("hrms_site_visits.id", ondelete="SET NULL"), nullable=True, index=True
    )
    tracking_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(50), default="ACTIVE", nullable=False, index=True)
    start_time: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    end_time: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    total_duration_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    approx_distance_km: Mapped[float | None] = mapped_column(Float, nullable=True)
    total_points: Mapped[int | None] = mapped_column(Integer, default=0, nullable=True)
    start_latitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    start_longitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    end_latitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    end_longitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    start_location: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    end_location: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    route_summary: Mapped[list | None] = mapped_column(JSON, nullable=True)

    # Relationships
    employee: Mapped["User"] = relationship("User", foreign_keys=[employee_id], lazy="selectin")
    site_visit: Mapped["HrmsSiteVisit | None"] = relationship(
        "HrmsSiteVisit", back_populates="tracking_sessions", foreign_keys=[site_visit_id], lazy="selectin"
    )
    points: Mapped[list["HrmsTrackingPoint"]] = relationship(
        "HrmsTrackingPoint", back_populates="session", cascade="all, delete-orphan", lazy="selectin"
    )


class HrmsTrackingPoint(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """
    GPS points recorded periodically while tracking is active.
    Persisted in PostgreSQL to record complete travel checkpoints.
    """

    __tablename__ = "hrms_tracking_points"

    session_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("hrms_tracking_sessions.id", ondelete="CASCADE"), nullable=False, index=True
    )
    employee_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    latitude: Mapped[float] = mapped_column(Float, nullable=False)
    longitude: Mapped[float] = mapped_column(Float, nullable=False)
    accuracy: Mapped[float | None] = mapped_column(Float, nullable=True)
    recorded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)

    # Relationships
    session: Mapped["HrmsLiveTrackingSession"] = relationship("HrmsLiveTrackingSession", back_populates="points")


class HrmsSiteVisitCheckIn(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """
    Log of Check-In and Check-Out events captured with device GPS proof.
    """

    __tablename__ = "hrms_site_visit_checkins"

    site_visit_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("hrms_site_visits.id", ondelete="CASCADE"), nullable=False, index=True
    )
    employee_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    event_type: Mapped[str] = mapped_column(String(50), nullable=False)  # CHECK_IN / CHECK_OUT
    latitude: Mapped[float] = mapped_column(Float, nullable=False)
    longitude: Mapped[float] = mapped_column(Float, nullable=False)
    accuracy: Mapped[float | None] = mapped_column(Float, nullable=True)
    address: Mapped[str | None] = mapped_column(String(500), nullable=True)
    captured_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)

    # Relationships
    site_visit: Mapped["HrmsSiteVisit"] = relationship("HrmsSiteVisit", foreign_keys=[site_visit_id], lazy="selectin")
    employee: Mapped["User"] = relationship("User", foreign_keys=[employee_id], lazy="selectin")


class HrmsPayrollComponent(Base, UUIDPrimaryKeyMixin, TimestampMixin, SoftDeleteMixin, VersionMixin):
    """
    Global configurable salary components (Basic, HRA, PF, PT, allowances, deductions).
    Configured once globally by HR/Admin and reused across employee salaries.
    """

    __tablename__ = "hrms_payroll_components"

    name: Mapped[str] = mapped_column(String(100), nullable=False)
    code: Mapped[str] = mapped_column(String(50), nullable=False, unique=True, index=True)
    component_type: Mapped[str] = mapped_column(String(20), nullable=False, index=True)  # EARNING / DEDUCTION
    calculation_type: Mapped[str] = mapped_column(
        String(30), nullable=False
    )  # PERCENTAGE / FIXED / REMAINING
    calculation_basis: Mapped[str | None] = mapped_column(String(50), nullable=True)  # CTC / BASIC / GROSS / <CODE>
    value: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    is_taxable: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    is_statutory: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    display_order: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False, index=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)


class HrmsEmployeeSalary(Base, UUIDPrimaryKeyMixin, TimestampMixin, SoftDeleteMixin, VersionMixin):
    """
    Employee salary structure with effective dates and revision history.
    """

    __tablename__ = "hrms_employee_salaries"

    employee_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    annual_ctc: Mapped[float] = mapped_column(Float, nullable=False)
    monthly_ctc: Mapped[float] = mapped_column(Float, nullable=False)
    effective_from: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False, index=True)
    structure_breakdown: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_by: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    updated_by: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    # Relationships
    employee: Mapped["User"] = relationship("User", foreign_keys=[employee_id], lazy="selectin")


class HrmsMonthlyPayroll(Base, UUIDPrimaryKeyMixin, TimestampMixin, SoftDeleteMixin, VersionMixin):
    """
    Monthly payroll processing cycle header and approval snapshot.
    """

    __tablename__ = "hrms_monthly_payrolls"

    payroll_month: Mapped[str] = mapped_column(String(7), nullable=False, unique=True, index=True)  # e.g. "2026-10"
    payroll_year: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    month_number: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(30), default="DRAFT", nullable=False, index=True)  # DRAFT / PROCESSED / APPROVED
    total_employees: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    total_gross: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    total_deductions: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    total_net: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    working_days: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    weekend_days: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    holiday_days: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    processed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    processed_by: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    approved_by: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Relationships
    items: Mapped[list["HrmsMonthlyPayrollItem"]] = relationship(
        "HrmsMonthlyPayrollItem", back_populates="payroll", cascade="all, delete-orphan", lazy="selectin"
    )


class HrmsMonthlyPayrollItem(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """
    Line item for each employee in a monthly payroll snapshot.
    Stores immutable calculation data when payroll is processed/approved.
    """

    __tablename__ = "hrms_monthly_payroll_items"

    payroll_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("hrms_monthly_payrolls.id", ondelete="CASCADE"), nullable=False, index=True
    )
    employee_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    salary_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("hrms_employee_salaries.id", ondelete="SET NULL"), nullable=True
    )
    annual_ctc: Mapped[float] = mapped_column(Float, nullable=False)
    monthly_ctc: Mapped[float] = mapped_column(Float, nullable=False)
    working_days: Mapped[int] = mapped_column(Integer, nullable=False)
    present_days: Mapped[float] = mapped_column(Float, nullable=False)
    paid_leave_days: Mapped[float] = mapped_column(Float, nullable=False)
    holiday_days: Mapped[int] = mapped_column(Integer, nullable=False)
    weekend_days: Mapped[int] = mapped_column(Integer, nullable=False)
    lop_days: Mapped[float] = mapped_column(Float, nullable=False)

    earnings_breakdown: Mapped[list | None] = mapped_column(JSON, nullable=True)
    deductions_breakdown: Mapped[list | None] = mapped_column(JSON, nullable=True)
    additions_breakdown: Mapped[list | None] = mapped_column(JSON, nullable=True)

    lop_deduction: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    gross_amount: Mapped[float] = mapped_column(Float, nullable=False)
    total_deductions: Mapped[float] = mapped_column(Float, nullable=False)
    net_salary: Mapped[float] = mapped_column(Float, nullable=False)

    status: Mapped[str] = mapped_column(String(30), default="DRAFT", nullable=False, index=True)
    calculation_details: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    edit_history: Mapped[list | None] = mapped_column(JSON, nullable=True, default=list)

    __table_args__ = (
        UniqueConstraint("payroll_id", "employee_id", name="uq_hrms_payroll_item_emp"),
    )

    # Relationships
    payroll: Mapped["HrmsMonthlyPayroll"] = relationship("HrmsMonthlyPayroll", back_populates="items")
    employee: Mapped["User"] = relationship("User", foreign_keys=[employee_id], lazy="selectin")
    salary: Mapped["HrmsEmployeeSalary | None"] = relationship(
        "HrmsEmployeeSalary", foreign_keys=[salary_id], lazy="selectin"
    )


class HrmsPayrollAdjustment(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """
    One-off monthly adjustments (performance bonuses, incentives, special deductions).
    Applies only to that specific payroll month.
    """

    __tablename__ = "hrms_payroll_adjustments"

    employee_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    payroll_month: Mapped[str] = mapped_column(String(7), nullable=False, index=True)
    adjustment_type: Mapped[str] = mapped_column(String(20), nullable=False)  # ADDITION / DEDUCTION
    title: Mapped[str] = mapped_column(String(150), nullable=False)
    amount: Mapped[float] = mapped_column(Float, nullable=False)
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    # Relationships
    employee: Mapped["User"] = relationship("User", foreign_keys=[employee_id], lazy="selectin")








