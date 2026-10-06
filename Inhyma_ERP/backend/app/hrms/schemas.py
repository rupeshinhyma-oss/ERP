"""
HRMS Setup Pydantic Schemas.
Request and response validation models for HRMS Setup endpoints.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Any
from pydantic import BaseModel, Field, ConfigDict, model_validator


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
    description: str | None = None
    leave_type: str = Field(default="REGULAR", max_length=50)
    is_paid: bool = Field(default=True, description="True for paid, False for unpaid")
    annual_balance: float = Field(default=12.0, ge=0)
    carry_forward_allowed: bool = Field(default=False)
    carry_forward_days: float = Field(default=0.0, ge=0)
    max_consecutive_days: int = Field(default=5, ge=0, description="0 = No Limit")
    monthly_accrual: bool = Field(default=False)
    accrual_amount: float = Field(default=1.0, ge=0)
    min_notice_days: int = Field(default=0, ge=0)
    allow_half_day: bool = Field(default=True)
    allow_backdated: bool = Field(default=True)
    require_attachment: bool = Field(default=False)
    attendance_based_accrual: bool = Field(default=False)
    attendance_based_condition: str | None = Field(default="FULL_MONTH_PRESENT")
    attendance_based_reward: float = Field(default=1.0, ge=0)
    attendance_based_departments: str | None = Field(default="ALL")
    min_attendance_percentage: float | None = None
    min_working_days: int | None = None
    allocation_unit: str = Field(default="DAYS", max_length=20)
    accrual_frequency: str = Field(default="MONTHLY", max_length=20)
    applicable_to: str = Field(default="ALL", max_length=50)
    applicable_departments: str | None = Field(default="ALL")
    applicable_branches: str | None = Field(default="ALL")
    count_weekends_as_leave: bool = Field(default=False)
    count_holidays_as_leave: bool = Field(default=False)
    allow_negative_balance: bool = Field(default=False)
    is_active: bool = Field(default=True)


class LeaveTypeCreate(LeaveTypeBase):
    pass


class LeaveTypeUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    code: str | None = None
    description: str | None = None
    leave_type: str | None = None
    is_paid: bool | None = None
    annual_balance: float | None = Field(default=None, ge=0)
    carry_forward_allowed: bool | None = None
    carry_forward_days: float | None = Field(default=None, ge=0)
    max_consecutive_days: int | None = Field(default=None, ge=0)
    monthly_accrual: bool | None = None
    accrual_amount: float | None = Field(default=None, ge=0)
    min_notice_days: int | None = Field(default=None, ge=0)
    allow_half_day: bool | None = None
    allow_backdated: bool | None = None
    require_attachment: bool | None = None
    attendance_based_accrual: bool | None = None
    attendance_based_condition: str | None = None
    attendance_based_reward: float | None = Field(default=None, ge=0)
    attendance_based_departments: str | None = None
    min_attendance_percentage: float | None = None
    min_working_days: int | None = None
    allocation_unit: str | None = None
    accrual_frequency: str | None = None
    applicable_to: str | None = None
    applicable_departments: str | None = None
    applicable_branches: str | None = None
    count_weekends_as_leave: bool | None = None
    count_holidays_as_leave: bool | None = None
    allow_negative_balance: bool | None = None
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
# Expense Claims Schemas (Phase 2)
# ---------------------------------------------------------------------------

class ExpenseCreate(BaseModel):
    expense_date: date
    category: str = Field(..., min_length=1, max_length=100)
    amount: float = Field(..., gt=0, description="Amount must be greater than 0")
    description: str = Field(..., min_length=1)
    location_id: uuid.UUID | None = None
    receipt_url: str | None = None
    receipt_filename: str | None = None
    is_submit: bool = False


class ExpenseUpdate(BaseModel):
    expense_date: date | None = None
    category: str | None = Field(default=None, min_length=1, max_length=100)
    amount: float | None = Field(default=None, gt=0)
    description: str | None = Field(default=None, min_length=1)
    location_id: uuid.UUID | None = None
    receipt_url: str | None = None
    receipt_filename: str | None = None


class ExpenseRejectPayload(BaseModel):
    rejection_reason: str = Field(..., min_length=1, description="Reason for rejecting the expense claim")


class ExpenseReimbursePayload(BaseModel):
    notes: str | None = None


class ExpenseRead(BaseModel):
    id: uuid.UUID
    expense_code: str
    employee_id: uuid.UUID
    employee_name: str | None = None
    employee_email: str | None = None
    employee_code: str | None = None
    expense_date: date
    category: str
    amount: float
    currency: str = "INR"
    description: str
    location_id: uuid.UUID | None = None
    receipt_url: str | None = None
    receipt_filename: str | None = None
    status: str
    submitted_at: datetime | None = None
    reviewed_at: datetime | None = None
    reviewed_by: uuid.UUID | None = None
    reviewer_name: str | None = None
    rejection_reason: str | None = None
    reimbursed_at: datetime | None = None
    reimbursed_by: uuid.UUID | None = None
    reimburser_name: str | None = None
    reimbursement_notes: str | None = None
    created_at: datetime
    updated_at: datetime
    version: int

    model_config = ConfigDict(from_attributes=True)


class ExpenseSummaryRead(BaseModel):
    total_count: int = 0
    total_amount: float = 0.0
    pending_count: int = 0
    pending_amount: float = 0.0
    approved_count: int = 0
    approved_amount: float = 0.0
    rejected_count: int = 0
    rejected_amount: float = 0.0
    reimbursed_count: int = 0
    reimbursed_amount: float = 0.0
    draft_count: int = 0
    draft_amount: float = 0.0



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
    holiday_name: str | None = None
    leave_type_name: str | None = None
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
    employee_id: uuid.UUID | None = None

    @model_validator(mode="before")
    @classmethod
    def handle_field_aliases(cls, data: Any) -> Any:
        if isinstance(data, dict):
            if "date" not in data and "attendance_date" in data:
                data["date"] = str(data["attendance_date"])
            if "punch_in" not in data and "proposed_punch_in" in data:
                data["punch_in"] = str(data["proposed_punch_in"])
            if "punch_out" not in data and "proposed_punch_out" in data:
                data["punch_out"] = str(data["proposed_punch_out"])
        return data


class RegularizationCreate(RegularizationRequest):
    pass


class RegularizationApprovalAction(BaseModel):
    action: str = Field(default="APPROVE")  # "APPROVE", "REJECT_LOP", "ADJUST_LEAVE"
    manager_remarks: str = Field(default="Approved", min_length=1)
    leave_type_id: uuid.UUID | None = None

    @model_validator(mode="before")
    @classmethod
    def handle_approval_aliases(cls, data: Any) -> Any:
        if isinstance(data, dict):
            if "manager_remarks" not in data and "notes" in data:
                data["manager_remarks"] = str(data["notes"])
            elif "manager_remarks" not in data and "remarks" in data:
                data["manager_remarks"] = str(data["remarks"])
        return data


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


# ---------------------------------------------------------------------------
# Leave Plan Schemas
# ---------------------------------------------------------------------------

class LeavePlanCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=150, description="Plan name e.g. Corporate Standard Plan")
    effective_from: date
    effective_to: date
    branch: str = Field(default="All Branches", max_length=100)
    department: str = Field(default="All Departments", max_length=100)
    leave_type_ids: list[uuid.UUID] = Field(default_factory=list)
    is_active: bool = Field(default=True)


class LeavePlanUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=150)
    effective_from: date | None = None
    effective_to: date | None = None
    branch: str | None = None
    department: str | None = None
    leave_type_ids: list[uuid.UUID] | None = None
    is_active: bool | None = None


class LeavePlanStatusUpdate(BaseModel):
    is_active: bool


class LeavePlanRead(BaseModel):
    id: uuid.UUID
    name: str
    effective_from: date
    effective_to: date
    branch: str
    department: str
    is_active: bool
    leave_type_ids: list[uuid.UUID] = Field(default_factory=list)
    leave_types: list[LeaveTypeRead] = Field(default_factory=list)
    created_by: uuid.UUID | None = None
    created_by_name: str | None = None
    updated_by: uuid.UUID | None = None
    updated_by_name: str | None = None
    created_at: datetime
    updated_at: datetime
    version: int

    model_config = ConfigDict(from_attributes=True)


# ---------------------------------------------------------------------------
# Holiday Schemas
# ---------------------------------------------------------------------------

class HolidayCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=150, description="Holiday name e.g. Diwali")
    holiday_date: date
    number_of_days: int = Field(default=1, ge=1)
    branch_applicability: str = Field(default="All Branches", max_length=255)
    department_scope: str | None = Field(default="ALL", max_length=255)
    is_active: bool = Field(default=True)


class HolidayUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=150)
    holiday_date: date | None = None
    number_of_days: int | None = Field(default=None, ge=1)
    branch_applicability: str | None = None
    department_scope: str | None = None
    is_active: bool | None = None


class HolidayRead(BaseModel):
    id: uuid.UUID
    name: str
    holiday_date: date
    number_of_days: int
    branch_applicability: str
    department_scope: str | None = "ALL"
    is_active: bool
    created_by: uuid.UUID | None = None
    created_by_name: str | None = None
    updated_by: uuid.UUID | None = None
    updated_by_name: str | None = None
    created_at: datetime
    updated_at: datetime
    version: int

    model_config = ConfigDict(from_attributes=True)


# ---------------------------------------------------------------------------
# Leave Balance & Adjustment Schemas
# ---------------------------------------------------------------------------

class EmployeeLeaveBalanceRead(BaseModel):
    id: uuid.UUID
    employee_id: uuid.UUID
    employee_name: str
    employee_code: str | None = None
    branch: str | None = None
    department: str | None = None
    leave_type_id: uuid.UUID
    leave_type_name: str
    leave_type_code: str | None = None
    year: int
    allocated: float
    consumed: float
    adjusted: float
    available: float
    created_at: datetime | None = None
    updated_at: datetime | None = None

    model_config = ConfigDict(from_attributes=True)


class LeaveBalanceSummary(BaseModel):
    allocated: float
    consumed: float
    adjusted: float
    available: float
    total_leave: float


class EmployeeLeaveAdjustmentRow(BaseModel):
    employee_id: uuid.UUID
    employee_name: str
    employee_code: str | None = None
    branch: str | None = None
    department: str | None = None
    balances: dict[str, LeaveBalanceSummary] = Field(default_factory=dict)


class LeaveAdjustmentCreate(BaseModel):
    employee_id: uuid.UUID
    leave_type_id: uuid.UUID
    adjustment_type: str = Field(..., description="ADD, DEDUCT, CREDIT, DEBIT, or CORRECTION")
    amount: float = Field(..., description="Amount or target value")
    reason: str = Field(..., min_length=1, description="Audit reason for manual balance change")
    remarks: str | None = None
    effective_date: date | None = None
    year: int = Field(default=2026)


class LeaveAdjustmentHistoryRead(BaseModel):
    id: uuid.UUID
    employee_id: uuid.UUID
    employee_name: str | None = None
    leave_type_id: uuid.UUID
    leave_type_name: str | None = None
    adjustment_type: str
    amount: float
    previous_balance: float
    new_balance: float
    reason: str
    remarks: str | None = None
    source: str = "MANUAL"
    effective_date: date | None = None
    adjusted_by: uuid.UUID | None = None
    adjusted_by_name: str | None = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


# ---------------------------------------------------------------------------
# Leave Request & Approval Schemas
# ---------------------------------------------------------------------------

class LeaveRequestCreate(BaseModel):
    employee_id: uuid.UUID | None = None
    leave_type_id: uuid.UUID
    from_date: date
    to_date: date
    reason: str = Field(..., min_length=1, description="Reason for leave")
    attachment: str | None = None


class LeaveApprovalAction(BaseModel):
    approval_remarks: str | None = None


class LeaveRequestRead(BaseModel):
    id: uuid.UUID
    employee_id: uuid.UUID
    employee_name: str
    employee_code: str | None = None
    branch: str | None = None
    department: str | None = None
    leave_type_id: uuid.UUID
    leave_type_name: str
    leave_type_code: str | None = None
    from_date: date
    to_date: date
    number_of_days: float
    reason: str
    attachment: str | None = None
    status: str
    approval_status: str
    created_by: uuid.UUID | None = None
    created_by_name: str | None = None
    updated_by: uuid.UUID | None = None
    updated_by_name: str | None = None
    approved_by: uuid.UUID | None = None
    approved_by_name: str | None = None
    approval_remarks: str | None = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class LeaveDayCalculationRead(BaseModel):
    from_date: date
    to_date: date
    number_of_days: float
    total_calendar_days: int
    weekly_off_days: int
    holiday_days: int
    holiday_names: list[str] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# HRMS Asset Management Schemas
# ---------------------------------------------------------------------------

class AssetBase(BaseModel):
    asset_name: str = Field(..., min_length=1, max_length=150)
    asset_category: str = Field(..., min_length=1, max_length=100)
    brand: str | None = Field(default=None, max_length=100)
    model: str | None = Field(default=None, max_length=100)
    serial_number: str | None = Field(default=None, max_length=100)
    purchase_date: date | None = None
    purchase_cost: float | None = None
    vendor: str | None = Field(default=None, max_length=150)
    warranty_expiry: date | None = None
    condition: str = Field(default="GOOD", max_length=50)
    location_id: uuid.UUID | None = None
    description: str | None = None

    @model_validator(mode="before")
    @classmethod
    def handle_category_alias(cls, data: Any) -> Any:
        if isinstance(data, dict):
            cat = data.get("category") or data.get("asset_category") or "GENERAL"
            data["asset_category"] = cat
            data["category"] = cat
        return data


class AssetCreate(AssetBase):
    asset_code: str | None = Field(default=None, max_length=50)
    status: str | None = Field(default="AVAILABLE", max_length=50)

    @model_validator(mode="before")
    @classmethod
    def handle_create_category_alias(cls, data: Any) -> Any:
        if isinstance(data, dict):
            cat = data.get("category") or data.get("asset_category") or "GENERAL"
            data["asset_category"] = cat
            data["category"] = cat
        return data


class AssetUpdate(BaseModel):
    asset_name: str | None = Field(default=None, min_length=1, max_length=150)
    asset_category: str | None = Field(default=None, min_length=1, max_length=100)
    brand: str | None = Field(default=None, max_length=100)
    model: str | None = Field(default=None, max_length=100)
    serial_number: str | None = Field(default=None, max_length=100)
    purchase_date: date | None = None
    purchase_cost: float | None = None
    vendor: str | None = Field(default=None, max_length=150)
    warranty_expiry: date | None = None
    condition: str | None = Field(default=None, max_length=50)
    location_id: uuid.UUID | None = None
    description: str | None = None
    status: str | None = Field(default=None, max_length=50)

    @model_validator(mode="before")
    @classmethod
    def handle_category_alias(cls, data: Any) -> Any:
        if isinstance(data, dict):
            if "category" in data and "asset_category" not in data:
                data["asset_category"] = data["category"]
        return data


class AssetStatusUpdate(BaseModel):
    status: str = Field(..., max_length=50)
    notes: str | None = None


class AssetAssign(BaseModel):
    employee_id: uuid.UUID = Field(..., description="ID of employee from users table")
    assigned_date: date = Field(default_factory=date.today)
    expected_return_date: date | None = None
    assigned_location_id: uuid.UUID | None = None
    location_id: uuid.UUID | None = None
    condition_at_assignment: str | None = None
    condition: str | None = None
    notes: str | None = None

    @model_validator(mode="before")
    @classmethod
    def handle_assign_aliases(cls, data: Any) -> Any:
        if isinstance(data, dict):
            if "user_id" in data and "employee_id" not in data:
                data["employee_id"] = data["user_id"]
            if "allocated_from" in data and "assigned_date" not in data:
                data["assigned_date"] = data["allocated_from"]
            if "condition" in data and "condition_at_assignment" not in data:
                data["condition_at_assignment"] = data["condition"]
            if "branch_id" in data and "assigned_location_id" not in data:
                data["assigned_location_id"] = data["branch_id"]
        return data


class AssetReturn(BaseModel):
    return_date: date = Field(default_factory=date.today)
    condition_after_return: str | None = Field(default=None, max_length=50)
    condition: str | None = Field(default=None, max_length=50)
    return_location_id: uuid.UUID | None = None
    location_id: uuid.UUID | None = None
    notes: str | None = None


class AssetMove(BaseModel):
    location_id: uuid.UUID = Field(..., description="Target branch/location ID")
    reason: str | None = Field(default=None, description="Reason for location transfer")


class AssetAssignmentRead(BaseModel):
    id: uuid.UUID
    asset_id: uuid.UUID
    employee_id: uuid.UUID
    employee_name: str | None = None
    employee_code: str | None = None
    employee_department: str | None = None
    employee_branch: str | None = None
    assigned_at: date
    returned_at: date | None = None
    expected_return_date: date | None = None
    assignment_status: str
    condition_at_assignment: str | None = None
    condition_at_return: str | None = None
    assignment_notes: str | None = None
    return_notes: str | None = None
    assigned_by: uuid.UUID | None = None
    assigned_by_name: str | None = None
    returned_by: uuid.UUID | None = None
    returned_by_name: str | None = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class AssetMaintenanceCreate(BaseModel):
    issue: str = Field(..., min_length=1, max_length=255)
    reported_date: date = Field(default_factory=date.today)
    maintenance_start: date | None = None
    maintenance_end: date | None = None
    vendor_technician: str | None = Field(default=None, max_length=150)
    cost: float | None = None
    status: str = Field(default="OPEN", max_length=50)
    notes: str | None = None


class AssetMaintenanceUpdate(BaseModel):
    issue: str | None = Field(default=None, min_length=1, max_length=255)
    reported_date: date | None = None
    maintenance_start: date | None = None
    maintenance_end: date | None = None
    vendor_technician: str | None = Field(default=None, max_length=150)
    cost: float | None = None
    status: str | None = Field(default=None, max_length=50)
    notes: str | None = None


class AssetMaintenanceRead(BaseModel):
    id: uuid.UUID
    asset_id: uuid.UUID
    issue: str
    reported_date: date
    maintenance_start: date | None = None
    maintenance_end: date | None = None
    vendor_technician: str | None = None
    cost: float | None = None
    status: str
    notes: str | None = None
    created_by: uuid.UUID | None = None
    created_by_name: str | None = None
    updated_by: uuid.UUID | None = None
    updated_by_name: str | None = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class AssetSummaryRead(BaseModel):
    total_assets: int
    available: int
    assigned: int
    in_maintenance: int
    damaged: int
    lost: int
    retired: int


class AssetHistoryRead(BaseModel):
    id: uuid.UUID
    asset_id: uuid.UUID
    action: str
    previous_value: str | None = None
    new_value: str | None = None
    user_id: uuid.UUID | None = None
    user_name: str | None = None
    performed_by: uuid.UUID | None = None
    performed_by_name: str | None = None
    notes: str | None = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class AssetRead(AssetBase):
    id: uuid.UUID
    asset_code: str
    status: str
    assigned_to_user_id: uuid.UUID | None = None
    assigned_to_name: str | None = None
    assigned_to_code: str | None = None
    assigned_to_department: str | None = None
    assigned_to_branch: str | None = None
    assigned_date: date | None = None
    expected_return_date: date | None = None
    location_name: str | None = None
    branch_name: str | None = None
    created_by: uuid.UUID | None = None
    created_by_name: str | None = None
    updated_by: uuid.UUID | None = None
    updated_by_name: str | None = None
    created_at: datetime
    updated_at: datetime
    history: list[AssetHistoryRead] = Field(default_factory=list)
    assignments_count: int = 0
    maintenance_count: int = 0
    model_config = ConfigDict(from_attributes=True)


# ===========================================================================
# HRMS Site Visit & Live Tracking Schemas
# ===========================================================================

class SiteVisitCreate(BaseModel):
    employee_id: uuid.UUID
    customer_name: str | None = None
    customer_site_name: str | None = None
    site_address: str = Field(..., min_length=1, description="Site Address / Location")
    site_latitude: float | None = None
    site_longitude: float | None = None
    visit_date: date
    planned_start_time: str = Field(default="10:00 AM", description="Planned Start Time (e.g. 10:00 AM)")
    planned_end_time: str = Field(default="07:00 PM", description="Planned End Time (e.g. 07:00 PM)")
    status: str = Field(default="SCHEDULED")
    notes: str | None = None

    @model_validator(mode="before")
    @classmethod
    def resolve_customer_name(cls, data: Any) -> Any:
        if isinstance(data, dict):
            c_name = data.get("customer_name") or data.get("customer_site_name")
            data["customer_name"] = c_name
            data["customer_site_name"] = c_name
        return data


class SiteVisitCheckIn(BaseModel):
    latitude: float
    longitude: float
    accuracy: float | None = None
    address: str | None = None


class SiteVisitCheckOut(BaseModel):
    latitude: float
    longitude: float
    accuracy: float | None = None
    address: str | None = None


class SiteVisitRead(BaseModel):
    id: uuid.UUID
    employee_id: uuid.UUID
    employee_name: str | None = None
    employee_email: str | None = None
    customer_name: str
    customer_site_name: str | None = None
    site_address: str
    site_latitude: float | None = None
    site_longitude: float | None = None
    visit_date: date
    planned_start_time: str
    planned_end_time: str
    status: str
    notes: str | None = None
    check_in_time: datetime | None = None
    check_in_latitude: float | None = None
    check_in_longitude: float | None = None
    check_in_accuracy: float | None = None
    check_in_address: str | None = None
    check_out_time: datetime | None = None
    check_out_latitude: float | None = None
    check_out_longitude: float | None = None
    check_out_accuracy: float | None = None
    check_out_address: str | None = None
    tracking_status: str | None = None
    tracking_session: Any | None = None
    is_simulated: bool | None = False
    created_by: uuid.UUID | None = None
    created_by_name: str | None = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class TrackingStartPayload(BaseModel):
    site_visit_id: uuid.UUID | None = None
    start_location: dict | None = None


class TrackingPointItem(BaseModel):
    latitude: float
    longitude: float
    accuracy: float | None = None
    recorded_at: datetime | None = None


class TrackingPointsBatch(BaseModel):
    session_id: uuid.UUID
    points: list[TrackingPointItem]


class TrackingStopPayload(BaseModel):
    end_location: dict | None = None


class TrackingSessionRead(BaseModel):
    id: uuid.UUID
    employee_id: uuid.UUID
    employee_name: str | None = None
    site_visit_id: uuid.UUID | None = None
    customer_name: str | None = None
    customer_site_name: str | None = None
    tracking_date: date
    status: str
    start_time: datetime
    end_time: datetime | None = None
    total_duration_minutes: int | None = None
    total_duration_seconds: int | None = None
    approx_distance_km: float | None = None
    approximate_distance_km: float | None = None
    total_points: int | None = 0
    points_count: int | None = 0
    start_latitude: float | None = None
    start_longitude: float | None = None
    end_latitude: float | None = None
    end_longitude: float | None = None
    start_location: dict | None = None
    end_location: dict | None = None
    route_summary: list | None = None
    is_active: bool | None = False
    is_simulated: bool | None = False
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class RegularizationEvidenceRead(BaseModel):
    employee_id: uuid.UUID
    employee_name: str | None = None
    date: date
    site_visits: list[SiteVisitRead] = Field(default_factory=list)
    tracking_sessions: list[TrackingSessionRead] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Payroll Schemas
# ---------------------------------------------------------------------------

class PayrollComponentBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    code: str = Field(..., min_length=1, max_length=50)
    component_type: str = Field(..., description="EARNING or DEDUCTION")
    calculation_type: str = Field(
        ...,
        description="PERCENTAGE, FIXED, REMAINING, PERCENTAGE_OF_CTC, PERCENTAGE_OF_BASIC"
    )
    calculation_basis: str | None = Field(default=None, description="Basis for percentage: CTC, BASIC, GROSS, or component code")
    value: float = Field(default=0.0, ge=0.0)
    is_taxable: bool = Field(default=True)
    is_statutory: bool = Field(default=False)
    display_order: int = Field(default=1, ge=1)
    is_active: bool = Field(default=True)
    description: str | None = None


class PayrollComponentCreate(PayrollComponentBase):
    pass


class PayrollComponentUpdate(BaseModel):
    name: str | None = None
    code: str | None = None
    component_type: str | None = None
    calculation_type: str | None = None
    calculation_basis: str | None = None
    value: float | None = None
    is_taxable: bool | None = None
    is_statutory: bool | None = None
    display_order: int | None = None
    is_active: bool | None = None
    description: str | None = None


class PayrollComponentRead(PayrollComponentBase):
    id: uuid.UUID
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class SalaryBreakdownItem(BaseModel):
    component_id: str | None = None
    code: str
    name: str
    type: str  # EARNING or DEDUCTION
    calculation_type: str
    calculation_basis: str | None = None
    rate_or_pct: float
    monthly_amount: float
    annual_amount: float


class SalaryPreviewRequest(BaseModel):
    annual_ctc: float = Field(..., gt=0, description="Annual Cost to Company in INR")


class SalaryPreviewResponse(BaseModel):
    annual_ctc: float
    monthly_ctc: float
    earnings: list[SalaryBreakdownItem]
    deductions: list[SalaryBreakdownItem]
    monthly_gross: float
    total_deductions: float
    estimated_net_salary: float
    annual_gross: float
    annual_net: float


class EmployeeSalaryAssignRequest(BaseModel):
    employee_id: uuid.UUID
    annual_ctc: float = Field(..., gt=0)
    effective_from: date
    notes: str | None = None


class EmployeeSalaryRead(BaseModel):
    id: uuid.UUID
    employee_id: uuid.UUID
    employee_name: str | None = None
    employee_code: str | None = None
    department_name: str | None = None
    designation_name: str | None = None
    annual_ctc: float
    monthly_ctc: float
    effective_from: date
    is_active: bool
    structure_breakdown: dict | None = None
    notes: str | None = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class PayrollAdjustmentCreate(BaseModel):
    employee_id: uuid.UUID
    payroll_month: str = Field(..., pattern=r"^\d{4}-\d{2}$", description="YYYY-MM")
    adjustment_type: str = Field(..., description="ADDITION or DEDUCTION")
    title: str = Field(..., min_length=1, max_length=150)
    amount: float = Field(..., gt=0)
    reason: str = Field(..., min_length=1)

    @model_validator(mode="before")
    @classmethod
    def handle_month_aliases(cls, data: Any) -> Any:
        if isinstance(data, dict):
            if "month" in data and not data.get("payroll_month"):
                data["payroll_month"] = data["month"]
        return data


class PayrollAdjustmentRead(BaseModel):
    id: uuid.UUID
    employee_id: uuid.UUID
    employee_name: str | None = None
    payroll_month: str
    adjustment_type: str
    title: str
    amount: float
    reason: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class MonthlyPayrollCalculateRequest(BaseModel):
    payroll_month: str | None = Field(default=None, description="YYYY-MM (optional in body if provided in URL path)")

    @model_validator(mode="before")
    @classmethod
    def handle_month_aliases(cls, data: Any) -> Any:
        if isinstance(data, dict):
            if "month" in data and not data.get("payroll_month"):
                data["payroll_month"] = data["month"]
        return data


class MonthlyPayrollItemRead(BaseModel):
    id: uuid.UUID
    payroll_id: uuid.UUID
    employee_id: uuid.UUID
    employee_name: str | None = None
    employee_code: str | None = None
    department: str | None = None
    designation: str | None = None
    payroll_month: str | None = None
    annual_ctc: float
    monthly_ctc: float
    working_days: int
    present_days: float
    paid_leave_days: float
    holiday_days: int
    weekend_days: int
    lop_days: float
    earnings_breakdown: list[dict] | None = None
    deductions_breakdown: list[dict] | None = None
    additions_breakdown: list[dict] | None = None
    lop_deduction: float
    gross_amount: float
    total_deductions: float
    net_salary: float
    status: str
    calculation_details: dict | None = None
    edit_history: list[dict] | None = None

    model_config = ConfigDict(from_attributes=True)


class MonthlyPayrollItemEditRequest(BaseModel):
    reason: str = Field(..., min_length=3, description="Mandatory audit reason for editing this payroll record")
    earnings_updates: dict[str, float] | None = None  # e.g. {"SPECIAL_ALLOWANCE": 5000.0}
    deductions_updates: dict[str, float] | None = None # e.g. {"PENALTY": 200.0}
    notes: str | None = None


class MonthlyPayrollReopenRequest(BaseModel):
    payroll_month: str | None = Field(default=None, description="YYYY-MM")
    reason: str = Field(..., min_length=3, description="Reason for reopening an approved payroll snapshot")


class MonthlyPayrollRead(BaseModel):
    id: uuid.UUID
    payroll_month: str
    payroll_year: int
    month_number: int
    status: str
    total_employees: int
    total_gross: float
    total_deductions: float
    total_net: float
    working_days: int
    weekend_days: int
    holiday_days: int
    processed_at: datetime | None = None
    processed_by_name: str | None = None
    approved_at: datetime | None = None
    approved_by_name: str | None = None
    notes: str | None = None
    items: list[MonthlyPayrollItemRead] = Field(default_factory=list)

    model_config = ConfigDict(from_attributes=True)




