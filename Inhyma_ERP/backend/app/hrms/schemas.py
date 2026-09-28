"""
HRMS Setup Pydantic Schemas.
Request and response validation models for HRMS Setup endpoints.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime
from pydantic import BaseModel, Field, ConfigDict


# ---------------------------------------------------------------------------
# Location (Geo Fencing) Schemas
# ---------------------------------------------------------------------------

class LocationBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=150, description="Office location name")
    location_type: str = Field(default="OFFICE", max_length=50)
    address: str = Field(..., min_length=1, description="Full office physical address")
    latitude: float = Field(..., ge=-90.0, le=90.0, description="GPS latitude")
    longitude: float = Field(..., ge=-180.0, le=180.0, description="GPS longitude")
    radius_meters: float = Field(default=150.0, gt=0, le=10000, description="Geofence boundary radius in meters")
    is_active: bool = Field(default=True)


class LocationCreate(LocationBase):
    pass


class LocationUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=150)
    location_type: str | None = Field(default=None, max_length=50)
    address: str | None = Field(default=None, min_length=1)
    latitude: float | None = Field(default=None, ge=-90.0, le=90.0)
    longitude: float | None = Field(default=None, ge=-180.0, le=180.0)
    radius_meters: float | None = Field(default=None, gt=0, le=10000)
    is_active: bool | None = None


class LocationStatusUpdate(BaseModel):
    is_active: bool


class LocationRead(LocationBase):
    id: uuid.UUID
    employees_assigned: int = 0
    created_at: datetime
    updated_at: datetime
    version: int

    model_config = ConfigDict(from_attributes=True)


# ---------------------------------------------------------------------------
# Leave Type Schemas
# ---------------------------------------------------------------------------

class LeaveTypeBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=100, description="Leave name e.g. Casual Leave")
    code: str | None = Field(default=None, max_length=50)
    leave_type: str = Field(default="REGULAR", max_length=50)
    is_paid: bool = Field(default=True, description="True for paid, False for unpaid")
    annual_balance: float = Field(default=12.0, ge=0)
    carry_forward_days: float = Field(default=0.0, ge=0)
    max_consecutive_days: int = Field(default=5, ge=1)
    monthly_accrual: bool = Field(default=False)
    is_active: bool = Field(default=True)


class LeaveTypeCreate(LeaveTypeBase):
    pass


class LeaveTypeUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    code: str | None = None
    leave_type: str | None = None
    is_paid: bool | None = None
    annual_balance: float | None = Field(default=None, ge=0)
    carry_forward_days: float | None = Field(default=None, ge=0)
    max_consecutive_days: int | None = Field(default=None, ge=1)
    monthly_accrual: bool | None = None
    is_active: bool | None = None


class LeaveTypeStatusUpdate(BaseModel):
    is_active: bool


class LeaveTypeRead(LeaveTypeBase):
    id: uuid.UUID
    created_at: datetime
    updated_at: datetime
    version: int

    model_config = ConfigDict(from_attributes=True)


# ---------------------------------------------------------------------------
# Expense Category Schemas
# ---------------------------------------------------------------------------

class ExpenseCategoryBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=100, description="Category name e.g. Travel, Meals")
    code: str | None = Field(default=None, max_length=50)
    description: str | None = None
    is_active: bool = Field(default=True)


class ExpenseCategoryCreate(ExpenseCategoryBase):
    pass


class ExpenseCategoryUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    code: str | None = None
    description: str | None = None
    is_active: bool | None = None


class ExpenseCategoryStatusUpdate(BaseModel):
    is_active: bool


class ExpenseCategoryRead(ExpenseCategoryBase):
    id: uuid.UUID
    created_at: datetime
    updated_at: datetime
    version: int

    model_config = ConfigDict(from_attributes=True)


# ---------------------------------------------------------------------------
# Expense Settings & Approval Workflow Schemas
# ---------------------------------------------------------------------------

class ExpenseSettingsBase(BaseModel):
    approval_team_lead: bool = Field(default=True)
    approval_manager: bool = Field(default=True)
    approval_accounts: bool = Field(default=True)

    max_claim_amount: float = Field(default=50000.0, ge=0)
    receipt_required: bool = Field(default=True)
    auto_approval_limit: float = Field(default=500.0, ge=0)
    submission_window_days: int = Field(default=30, ge=1)


class ExpenseSettingsUpdate(ExpenseSettingsBase):
    pass


class ExpenseSettingsRead(ExpenseSettingsBase):
    id: uuid.UUID
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


# ---------------------------------------------------------------------------
# Attendance Schemas (Day 3)
# ---------------------------------------------------------------------------

class AttendancePolicyRead(BaseModel):
    id: uuid.UUID
    shift_name: str = Field(default="General Shift")
    shift_start_time: str = Field(default="10:30")
    shift_end_time: str = Field(default="19:00")
    weekly_off: str = Field(default="Sunday")
    payroll_cycle: str = Field(default="1st-End of Month")
    geofence_radius_meters: float = Field(default=150.0)

    # Grace Period
    enable_grace: bool = Field(default=True)
    grace_period_minutes: int = Field(default=15)
    grace_end_time: str = Field(default="10:45")

    # Late Mark Rules
    enable_late_marks: bool = Field(default=True)
    late_start_time: str = Field(default="10:46")
    count_late_monthly: bool = Field(default=True)
    monthly_late_limit: int = Field(default=3)
    third_late_action: str = Field(default="Half Day")

    # Direct Half Day
    enable_direct_half_day: bool = Field(default=True)
    direct_half_day_time: str = Field(default="11:31")
    half_day_threshold_minutes: int = Field(default=60)

    # Early Exit Rules
    enable_early_exit: bool = Field(default=True)
    early_exit_buffer_minutes: int = Field(default=15)
    mark_early_exit: bool = Field(default=True)
    auto_regularization_early_exit: bool = Field(default=True)

    # Missing Punch Policy
    missing_punch_out: bool = Field(default=True)
    missing_punch_in: bool = Field(default=True)
    auto_mark_irregular: bool = Field(default=True)
    require_regularization: bool = Field(default=True)

    # Advanced Attendance Rules (Optional)
    consecutive_late_warning: bool = Field(default=False)
    auto_email_notification: bool = Field(default=False)
    auto_manager_notification: bool = Field(default=False)
    holiday_overtime: bool = Field(default=False)
    weekend_overtime: bool = Field(default=False)
    flexible_shift: bool = Field(default=False)
    grace_extension: bool = Field(default=False)

    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class AttendancePolicyUpdate(BaseModel):
    shift_name: str | None = Field(default=None, max_length=100)
    shift_start_time: str | None = Field(default=None, pattern=r"^\d{1,2}:\d{2}$")
    shift_end_time: str | None = Field(default=None, pattern=r"^\d{1,2}:\d{2}$")
    weekly_off: str | None = Field(default=None, max_length=100)
    payroll_cycle: str | None = Field(default=None, max_length=100)
    geofence_radius_meters: float | None = Field(default=None, gt=0, le=10000)

    # Grace Period
    enable_grace: bool | None = None
    grace_period_minutes: int | None = Field(default=None, ge=0, le=180)
    grace_end_time: str | None = None

    # Late Mark Rules
    enable_late_marks: bool | None = None
    late_start_time: str | None = None
    count_late_monthly: bool | None = None
    monthly_late_limit: int | None = Field(default=None, ge=1, le=31)
    third_late_action: str | None = None

    # Direct Half Day
    enable_direct_half_day: bool | None = None
    direct_half_day_time: str | None = Field(default=None, pattern=r"^\d{1,2}:\d{2}$")
    half_day_threshold_minutes: int | None = Field(default=None, ge=0, le=360)

    # Early Exit Rules
    enable_early_exit: bool | None = None
    early_exit_buffer_minutes: int | None = Field(default=None, ge=0, le=180)
    mark_early_exit: bool | None = None
    auto_regularization_early_exit: bool | None = None

    # Missing Punch Policy
    missing_punch_out: bool | None = None
    missing_punch_in: bool | None = None
    auto_mark_irregular: bool | None = None
    require_regularization: bool | None = None

    # Advanced Attendance Rules (Optional)
    consecutive_late_warning: bool | None = None
    auto_email_notification: bool | None = None
    auto_manager_notification: bool | None = None
    holiday_overtime: bool | None = None
    weekend_overtime: bool | None = None
    flexible_shift: bool | None = None
    grace_extension: bool | None = None


class PunchInRequest(BaseModel):
    latitude: float = Field(..., ge=-90.0, le=90.0)
    longitude: float = Field(..., ge=-180.0, le=180.0)
    location_id: uuid.UUID | None = None
    timestamp: datetime | None = None  # optional override for policy testing


class PunchOutRequest(BaseModel):
    latitude: float = Field(..., ge=-90.0, le=90.0)
    longitude: float = Field(..., ge=-180.0, le=180.0)
    timestamp: datetime | None = None


class AssignedOfficeRead(BaseModel):
    id: uuid.UUID
    name: str
    address: str
    latitude: float
    longitude: float
    radius_meters: float


class AttendanceRecordRead(BaseModel):
    id: uuid.UUID
    employee_id: uuid.UUID
    attendance_date: str
    punch_in: datetime | None = None
    punch_out: datetime | None = None
    status: str
    working_minutes: int | None = 0
    late_minutes: int = 0
    early_exit_minutes: int = 0
    office_location_id: uuid.UUID | None = None
    office_name: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    punch_in_distance: float | None = None
    punch_out_distance: float | None = None
    is_irregular: bool = False
    regularization_status: str = "NONE"
    regularization_reason: str | None = None
    regularization_note: str | None = None
    can_regularize: bool = False
    punched_in: bool = False
    punched_out: bool = False
    total_hours: str | None = None
    assigned_office: AssignedOfficeRead | None = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class TodayAttendanceRead(BaseModel):
    id: uuid.UUID | None = None
    employee_id: uuid.UUID | None = None
    attendance_date: str
    punched_in: bool = False
    punched_out: bool = False
    status: str = "NOT_PUNCHED"
    punch_in: datetime | None = None
    punch_out: datetime | None = None
    total_hours: str = "0h 00m"
    working_minutes: int = 0
    late_minutes: int = 0
    early_exit_minutes: int = 0
    office_location_id: uuid.UUID | None = None
    office_name: str | None = None
    assigned_office: AssignedOfficeRead | None = None
    is_irregular: bool = False
    regularization_status: str = "NONE"
    can_regularize: bool = False
    attendance_record: AttendanceRecordRead | None = None


class CalendarDayRead(BaseModel):
    date: str  # YYYY-MM-DD
    day_number: int
    day_name: str
    status: str  # PRESENT, LATE, HALF_DAY, MISSING_PUNCH, IN_PROGRESS, WEEKEND, HOLIDAY, LEAVE
    punch_in: str | None = None
    punch_out: str | None = None
    working_minutes: int | None = None
    late_minutes: int = 0
    early_exit_minutes: int = 0
    is_irregular: bool = False
    regularization_status: str = "NONE"
    can_regularize: bool = False
    attendance_id: uuid.UUID | None = None


class RegularizationRequest(BaseModel):
    attendance_id: uuid.UUID | None = None
    date: str
    request_type: str | None = None
    reason: str = Field(..., min_length=2)
    note: str | None = None
    notes: str | None = None
    punch_in: str | None = None
    punch_out: str | None = None
    total_hours: str | None = None
    direct_regularize: bool | None = False


class RegularizationCreate(RegularizationRequest):
    pass


class RegularizationApprovalAction(BaseModel):
    action: str = Field(default="APPROVE")  # "APPROVE", "REJECT_LOP", "ADJUST_LEAVE"
    manager_remarks: str = Field(default="Approved", min_length=1)
    leave_type_id: uuid.UUID | None = None


class RegularizationRejectAction(BaseModel):
    action: str = Field(default="REJECT_LOP")
    manager_remarks: str = Field(default="Rejected", min_length=1)


class RegularizationRead(BaseModel):
    id: uuid.UUID
    employee_id: uuid.UUID
    employee_name: str
    employee_email: str | None = None
    attendance_record_id: uuid.UUID | None = None
    attendance_date: str
    request_type: str
    reason: str
    notes: str | None = None
    punch_in_time: str | None = None
    punch_out_time: str | None = None
    total_hours: str | None = None
    punch_in: str | None = None
    punch_out: str | None = None
    status: str  # PENDING, APPROVED, REJECTED
    regularization_status: str | None = None
    regularization_reason: str | None = None
    submitted_at: datetime
    reviewed_at: datetime | None = None
    reviewed_by: uuid.UUID | None = None
    reviewed_by_name: str | None = None
    manager_remarks: str | None = None
    action_taken: str | None = None

    model_config = ConfigDict(from_attributes=True)

