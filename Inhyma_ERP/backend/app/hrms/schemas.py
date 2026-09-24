"""
HRMS Pydantic Schemas.

Request/response validation schemas for Locations, Employee Assignments,
and WFH Requests.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import List, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.hrms.models import LocationType, WfhRequestStatus


# ---------------------------------------------------------------------------
# Location Schemas
# ---------------------------------------------------------------------------


class LocationBase(BaseModel):
    """Base fields common to location creation and response."""

    name: str = Field(..., min_length=2, max_length=150, description="Office/facility title")
    location_type: LocationType = Field(default=LocationType.OFFICE, description="Classification")
    address: str = Field(..., min_length=5, description="Full human-readable address")
    latitude: float = Field(..., ge=-90.0, le=90.0, description="WGS84 latitude")
    longitude: float = Field(..., ge=-180.0, le=180.0, description="WGS84 longitude")
    radius_meters: float = Field(default=150.0, ge=10.0, le=10000.0, description="Geofence radius in meters")
    place_id: Optional[str] = Field(None, description="Google Maps Place ID")


class LocationCreate(LocationBase):
    """Payload to create a new location."""

    pass


class LocationUpdate(BaseModel):
    """Payload to update an existing location."""

    name: Optional[str] = Field(None, min_length=2, max_length=150)
    location_type: Optional[LocationType] = None
    address: Optional[str] = Field(None, min_length=5)
    latitude: Optional[float] = Field(None, ge=-90.0, le=90.0)
    longitude: Optional[float] = Field(None, ge=-180.0, le=180.0)
    radius_meters: Optional[float] = Field(None, ge=10.0, le=10000.0)
    place_id: Optional[str] = None
    is_active: Optional[bool] = None


class LocationResponse(LocationBase):
    """Serialized location representation."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    is_active: bool
    assigned_employees_count: int = 0
    created_at: datetime
    updated_at: datetime


# ---------------------------------------------------------------------------
# Employee Location Assignment Schemas
# ---------------------------------------------------------------------------


class EmployeeLocationSummary(BaseModel):
    """Summary of a location assigned to an employee."""

    id: str
    name: str
    location_type: str
    address: str
    radius_meters: float
    is_primary: bool


class EmployeeLocationAssignmentPayload(BaseModel):
    """Payload for HR/Admin to set an employee's primary and additional locations."""

    primary_location_id: str = Field(..., description="The single mandatory primary office location")
    additional_location_ids: List[str] = Field(
        default_factory=list,
        description="Optional additional office/facility locations",
    )


class EmployeeLocationAssignmentResponse(BaseModel):
    """View of an employee with all their assigned locations."""

    user_id: str
    employee_name: str
    employee_code: Optional[str] = None
    email: Optional[str] = None
    department: Optional[str] = None
    role: Optional[str] = None
    primary_location: Optional[EmployeeLocationSummary] = None
    additional_locations: List[EmployeeLocationSummary] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# WFH Request Schemas
# ---------------------------------------------------------------------------


class WfhRequestCreate(BaseModel):
    """Payload submitted by an employee to request WFH."""

    wfh_date: date = Field(..., description="Date for WFH in YYYY-MM-DD format")
    reason: str = Field(..., min_length=3, description="Justification for WFH")
    address: str = Field(..., min_length=5, description="Full work/home address")
    latitude: float = Field(..., ge=-90.0, le=90.0)
    longitude: float = Field(..., ge=-180.0, le=180.0)
    radius_meters: float = Field(default=150.0, ge=10.0, le=5000.0)
    place_id: Optional[str] = Field(None, description="Google Maps Place ID")


class WfhRequestReview(BaseModel):
    """Manager/HR approval or rejection payload."""

    status: WfhRequestStatus = Field(..., description="APPROVED or REJECTED")
    manager_remarks: Optional[str] = Field(None, max_length=500)


class WfhRequestResponse(BaseModel):
    """Serialized WFH request."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    user_id: str
    employee_name: str
    employee_code: Optional[str] = None
    wfh_date: str
    reason: str
    address: str
    latitude: float
    longitude: float
    radius_meters: float
    place_id: Optional[str] = None
    status: str
    manager_id: Optional[str] = None
    manager_remarks: Optional[str] = None
    submitted_at: datetime
    reviewed_at: Optional[datetime] = None


# ---------------------------------------------------------------------------
# Geocoding Schemas
# ---------------------------------------------------------------------------


class GeocodeQuery(BaseModel):
    """Address string to resolve to coordinates."""

    address: str = Field(..., min_length=2)


class GeocodeResponse(BaseModel):
    """Resolved coordinate output."""

    address: str
    latitude: float
    longitude: float
    display_name: str
    place_id: Optional[str] = None
    building: Optional[str] = None
    street: Optional[str] = None
    locality: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    pin_code: Optional[str] = None
    country: Optional[str] = None


class ReverseGeocodeQuery(BaseModel):
    """Coordinate pair to resolve to address."""

    latitude: float = Field(..., ge=-90.0, le=90.0)
    longitude: float = Field(..., ge=-180.0, le=180.0)


class LocationVerificationResponse(BaseModel):
    """Structured reverse-geocoded location verification card details."""

    place_id: Optional[str] = None
    display_name: str
    latitude: float
    longitude: float
    type: Optional[str] = None
    building: Optional[str] = None
    street: Optional[str] = None
    locality: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    pin_code: Optional[str] = None
    country: Optional[str] = None
    address: str


class AddressSuggestionResponse(BaseModel):
    """Candidate address item returned from address search."""

    place_id: str
    display_name: str
    latitude: float
    longitude: float
    type: str
    building: str
    street: str
    locality: str
    city: str
    state: str
    pin_code: str
    country: str
    address: str


# ---------------------------------------------------------------------------
# Attendance, Regularization, and Approval Schemas
# ---------------------------------------------------------------------------


class RegularizationRequestCreate(BaseModel):
    attendance_date: date
    check_in: str
    check_out: str
    total_hours: str
    reason: str


class ApprovalActionPayload(BaseModel):
    status: str = Field(..., description="APPROVED or REJECTED")
    manager_remarks: Optional[str] = None


class AdjustedLeaveActionPayload(BaseModel):
    action: str = Field(..., description="APPROVE, REJECT, or ADJUST_LEAVE")
    leave_type: Optional[str] = None
    manager_remarks: Optional[str] = None


class AttendanceSettingsUpdate(BaseModel):
    shift_name: Optional[str] = None
    shift_start: Optional[str] = None
    shift_end: Optional[str] = None
    grace_until: Optional[str] = None
    late_starts_after: Optional[str] = None
    direct_half_day_after: Optional[str] = None
    late_marks_before_half_day: Optional[int] = None
    payroll_cycle: Optional[str] = None
    employment_type: Optional[str] = None
    max_late_check_in: Optional[str] = None
    max_early_check_out: Optional[str] = None
    grace_period_mins: Optional[int] = None
    late_attendance_rule: Optional[str] = None
    recurring_cycle: Optional[str] = None
    min_overtime_mins: Optional[int] = None
    max_overtime_mins: Optional[int] = None
    holiday_overtime: Optional[str] = None
    weekend_overtime: Optional[str] = None
    approval_required: Optional[bool] = None


class AttendanceExemptionCreate(BaseModel):
    user_id: str
    exemption_type: str
    effective_from: date


# ---------------------------------------------------------------------------
# Attendance Policy Engine Schemas
# ---------------------------------------------------------------------------


class AttendancePolicyBase(BaseModel):
    name: str = Field(..., min_length=2, max_length=150)
    shift_start: str = Field(default="10:30 AM")
    shift_end: str = Field(default="07:00 PM")
    grace_until: str = Field(default="10:45 AM")
    late_starts_after: str = Field(default="10:45 AM")
    direct_half_day_after: str = Field(default="11:30 AM")
    late_marks_before_half_day: int = Field(default=3, ge=1, le=10)
    payroll_cycle: str = Field(default="1st to 31st of Month")
    employment_type: str = Field(default="Full Time Permanent")


class AttendancePolicyCreate(BaseModel):
    name: Optional[str] = None
    policy_name: Optional[str] = None
    shift_start: str = Field(default="10:30 AM")
    shift_end: str = Field(default="07:00 PM")
    grace_until: str = Field(default="10:45 AM")
    late_starts_after: Optional[str] = None
    late_after: Optional[str] = None
    direct_half_day_after: str = Field(default="11:31 AM")
    late_marks_before_half_day: Optional[int] = None
    late_threshold: Optional[int] = None
    payroll_cycle: str = Field(default="1st to 31st of Month")
    employment_type: str = Field(default="Full Time Permanent")
    is_active: bool = False
    active: Optional[bool] = None

    def resolved_name(self) -> str:
        return self.policy_name or self.name or "Company Attendance Policy"

    def resolved_late_after(self) -> str:
        return self.late_after or self.late_starts_after or "10:46 AM"

    def resolved_threshold(self) -> int:
        return self.late_threshold or self.late_marks_before_half_day or 3

    def resolved_active(self) -> bool:
        if self.active is not None:
            return self.active
        return self.is_active


class AttendancePolicyUpdate(BaseModel):
    name: Optional[str] = None
    policy_name: Optional[str] = None
    shift_start: Optional[str] = None
    shift_end: Optional[str] = None
    grace_until: Optional[str] = None
    late_starts_after: Optional[str] = None
    late_after: Optional[str] = None
    direct_half_day_after: Optional[str] = None
    late_marks_before_half_day: Optional[int] = None
    late_threshold: Optional[int] = None
    payroll_cycle: Optional[str] = None
    employment_type: Optional[str] = None
    is_active: Optional[bool] = None
    active: Optional[bool] = None
    is_archived: Optional[bool] = None


class AttendancePolicyResponse(AttendancePolicyBase):
    model_config = ConfigDict(from_attributes=True)

    id: str
    is_active: bool
    is_archived: bool
    created_at: datetime
    updated_at: datetime


# ---------------------------------------------------------------------------
# Real Attendance Engine Schemas
# ---------------------------------------------------------------------------


class PunchInPayload(BaseModel):
    latitude: float = Field(..., ge=-90.0, le=90.0)
    longitude: float = Field(..., ge=-180.0, le=180.0)
    office_id: Optional[str] = None


class PunchOutPayload(BaseModel):
    latitude: Optional[float] = Field(None, ge=-90.0, le=90.0)
    longitude: Optional[float] = Field(None, ge=-180.0, le=180.0)


class AttendanceRecordResponse(BaseModel):
    id: str
    user_id: str
    attendance_date: str
    check_in_time: Optional[datetime] = None
    check_out_time: Optional[datetime] = None
    office_id: Optional[str] = None
    office_name: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    punch_type: Optional[str] = "CHECK_IN"
    status: str = "OPEN"
    final_status: Optional[str] = "Present"
    total_work_minutes: Optional[int] = None
    total_hours: Optional[str] = None
    rule_triggered: Optional[str] = None
    punch_in: Optional[str] = None
    punch_out: Optional[str] = None
    is_irregular: bool = False


