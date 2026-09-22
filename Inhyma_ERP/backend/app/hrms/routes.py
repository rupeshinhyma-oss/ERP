"""
HRMS RESTful Endpoints.

Mounts routes for Location Management, Employee Location Assignments,
and WFH Requests with geocoding resolution.
"""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_user
from app.auth.service import CurrentUser
from app.core.exceptions import ForbiddenException
from app.core.responses import build_success_response
from app.database.session import get_db_session
from app.hrms.schemas import (
    EmployeeLocationAssignmentPayload,
    GeocodeQuery,
    LocationCreate,
    LocationUpdate,
    ReverseGeocodeQuery,
    WfhRequestCreate,
    WfhRequestReview,
)
from app.hrms.service import HrmsService

router = APIRouter(prefix="/hrms", tags=["HRMS - Locations & WFH"])


def _check_hr_admin_access(current_user: CurrentUser) -> None:
    """Ensure caller has HR or Admin privileges for management operations."""
    if current_user.is_super_admin or current_user.username == "admin" or "*" in current_user.permissions:
        return
    # Check permissions and roles
    roles = [r.lower() for r in (current_user.roles or [])]
    if any(r in roles for r in ["admin", "hr", "hr_manager", "super_admin", "manager"]):
        return
    if "hrms.manage" in current_user.permissions or "hrms.admin" in current_user.permissions:
        return
    raise ForbiddenException("HR or Admin privileges required for this location action")


# ---------------------------------------------------------------------------
# Universal Geocoding & Address Resolution
# ---------------------------------------------------------------------------


@router.get("/address-search", summary="Search address suggestions worldwide")
async def address_search(
    q: str = Query(..., min_length=1, description="Search address, building, street, or city"),
    db: AsyncSession = Depends(get_db_session),
    _current_user: CurrentUser = Depends(get_current_user),
):
    """
    Worldwide address suggestions powered by OpenStreetMap Nominatim.
    Returns candidate locations with structured building, street, locality,
    city, state, PIN code, and place_id.
    """
    service = HrmsService(db)
    results = await service.search_addresses(q)
    return build_success_response(data=results, message="Address suggestions retrieved")


@router.post("/geocode", summary="Resolve address to map coordinates")
async def geocode_address(
    payload: GeocodeQuery,
    db: AsyncSession = Depends(get_db_session),
    _current_user: CurrentUser = Depends(get_current_user),
):
    """
    Translates an address string to coordinates and formatted name using
    OpenStreetMap Nominatim worldwide.
    """
    service = HrmsService(db)
    result = await service.geocode_address(payload.address)
    return build_success_response(data=result, message="Address resolved successfully")


@router.post("/reverse-geocode", summary="Resolve coordinates to human-readable address")
async def reverse_geocode(
    payload: ReverseGeocodeQuery,
    db: AsyncSession = Depends(get_db_session),
    _current_user: CurrentUser = Depends(get_current_user),
):
    """
    Reverse resolves lat/lon to a structured location verification card
    containing building, street, locality, city, state, pin_code, and place_id.
    """
    service = HrmsService(db)
    result = await service.reverse_geocode(payload.latitude, payload.longitude)
    return build_success_response(
        data=result,
        message="Coordinates resolved successfully",
    )


# ---------------------------------------------------------------------------
# Location Management
# ---------------------------------------------------------------------------


@router.get("/locations", summary="List office and operational locations")
async def list_locations(
    active_only: bool = Query(False, description="Filter only active locations"),
    search: Optional[str] = Query(None, description="Search term across name, address, type"),
    db: AsyncSession = Depends(get_db_session),
    _current_user: CurrentUser = Depends(get_current_user),
):
    """
    Returns list of locations including assigned employees count.
    """
    service = HrmsService(db)
    locations = await service.list_locations(active_only=active_only, search=search)
    return build_success_response(data=locations, message="Locations retrieved")


@router.post("/locations", summary="Create new confirmed location", status_code=status.HTTP_201_CREATED)
async def create_location(
    payload: LocationCreate,
    db: AsyncSession = Depends(get_db_session),
    current_user: CurrentUser = Depends(get_current_user),
):
    """
    HR/Admin action: Save a new location with confirmed pin coordinates and radius.
    """
    _check_hr_admin_access(current_user)
    service = HrmsService(db)
    new_loc = await service.create_location(payload)
    return build_success_response(data=new_loc, message="Location created successfully")


@router.get("/locations/{location_id}", summary="Get single location details")
async def get_location(
    location_id: str,
    db: AsyncSession = Depends(get_db_session),
    _current_user: CurrentUser = Depends(get_current_user),
):
    """Fetch single location details."""
    service = HrmsService(db)
    loc = await service.get_location(location_id)
    return build_success_response(data=loc, message="Location retrieved")


@router.put("/locations/{location_id}", summary="Update existing location")
async def update_location(
    location_id: str,
    payload: LocationUpdate,
    db: AsyncSession = Depends(get_db_session),
    current_user: CurrentUser = Depends(get_current_user),
):
    """
    HR/Admin action: Update address, coordinates, radius, or status.
    """
    _check_hr_admin_access(current_user)
    service = HrmsService(db)
    updated = await service.update_location(location_id, payload)
    return build_success_response(data=updated, message="Location updated successfully")


@router.patch("/locations/{location_id}/toggle-status", summary="Soft toggle location active/disabled state")
async def toggle_location_status(
    location_id: str,
    db: AsyncSession = Depends(get_db_session),
    current_user: CurrentUser = Depends(get_current_user),
):
    """
    HR/Admin action: Soft disable or re-enable a location (no hard deletion).
    """
    _check_hr_admin_access(current_user)
    service = HrmsService(db)
    result = await service.toggle_location_status(location_id)
    status_label = "active" if result["is_active"] else "disabled"
    return build_success_response(data=result, message=f"Location marked {status_label}")


# ---------------------------------------------------------------------------
# Employee Location Assignments
# ---------------------------------------------------------------------------


@router.get("/employee-assignments", summary="List employees and their location assignments")
async def list_employee_assignments(
    search: Optional[str] = Query(None, description="Filter employees by name/code/email"),
    db: AsyncSession = Depends(get_db_session),
    _current_user: CurrentUser = Depends(get_current_user),
):
    """
    Returns employees with their assigned primary and additional office locations.
    """
    service = HrmsService(db)
    assignments = await service.list_employee_assignments(search=search)
    return build_success_response(data=assignments, message="Employee assignments retrieved")


@router.get("/employees/{user_id}/locations", summary="Get specific employee's location assignments")
async def get_employee_locations(
    user_id: str,
    db: AsyncSession = Depends(get_db_session),
    _current_user: CurrentUser = Depends(get_current_user),
):
    """Returns the primary and additional locations assigned to a user."""
    service = HrmsService(db)
    result = await service.get_employee_locations(user_id)
    return build_success_response(data=result, message="Employee locations retrieved")


@router.put("/employees/{user_id}/locations", summary="Assign primary and additional locations to an employee")
async def assign_employee_locations(
    user_id: str,
    payload: EmployeeLocationAssignmentPayload,
    db: AsyncSession = Depends(get_db_session),
    current_user: CurrentUser = Depends(get_current_user),
):
    """
    HR/Admin action: Set exactly 1 primary location and optional additional locations.
    Employees cannot self-assign office locations.
    """
    _check_hr_admin_access(current_user)
    service = HrmsService(db)
    updated = await service.assign_employee_locations(user_id, payload)
    return build_success_response(data=updated, message="Employee locations assigned successfully")


# ---------------------------------------------------------------------------
# Employee WFH Requests & Manager Approval Queue
# ---------------------------------------------------------------------------


@router.post("/wfh-requests", summary="Submit WFH request with map pin", status_code=status.HTTP_201_CREATED)
async def create_wfh_request(
    payload: WfhRequestCreate,
    db: AsyncSession = Depends(get_db_session),
    current_user: CurrentUser = Depends(get_current_user),
):
    """
    Employee action: Submits WFH request with confirmed address, coordinates, and reason.
    """
    service = HrmsService(db)
    req = await service.create_wfh_request(str(current_user.id), payload)
    return build_success_response(data=req, message="WFH request submitted for manager approval")


@router.get("/wfh-requests/my", summary="List current employee's WFH requests")
async def list_my_wfh_requests(
    db: AsyncSession = Depends(get_db_session),
    current_user: CurrentUser = Depends(get_current_user),
):
    """Returns historical and current WFH requests submitted by the caller."""
    service = HrmsService(db)
    requests = await service.list_my_wfh_requests(str(current_user.id))
    return build_success_response(data=requests, message="My WFH requests retrieved")


@router.get("/wfh-requests/pending", summary="Manager approval queue for pending WFH requests")
async def list_pending_wfh_requests(
    db: AsyncSession = Depends(get_db_session),
    current_user: CurrentUser = Depends(get_current_user),
):
    """
    Manager/HR action: Fetches all pending WFH requests requiring approval or rejection.
    """
    _check_hr_admin_access(current_user)
    service = HrmsService(db)
    pending = await service.list_pending_wfh_requests()
    return build_success_response(data=pending, message="Pending WFH queue retrieved")


@router.patch("/wfh-requests/{request_id}/review", summary="Approve or reject a WFH request")
async def review_wfh_request(
    request_id: str,
    payload: WfhRequestReview,
    db: AsyncSession = Depends(get_db_session),
    current_user: CurrentUser = Depends(get_current_user),
):
    """
    Manager/HR action: Reviews a pending WFH request, setting status to APPROVED or REJECTED.
    """
    _check_hr_admin_access(current_user)
    service = HrmsService(db)
    reviewed = await service.review_wfh_request(
        request_id=request_id,
        manager_id=str(current_user.id),
        payload=payload,
    )
    status_msg = "approved" if payload.status == "APPROVED" else "rejected"
    return build_success_response(data=reviewed, message=f"WFH request {status_msg}")
