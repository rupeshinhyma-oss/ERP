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

