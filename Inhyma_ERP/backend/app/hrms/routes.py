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
    AdjustedLeaveActionPayload,
    ApprovalActionPayload,
    AttendanceExemptionCreate,
    AttendancePolicyCreate,
    AttendancePolicyUpdate,
    AttendanceSettingsUpdate,
    EmployeeLocationAssignmentPayload,
    GeocodeQuery,
    LocationCreate,
    LocationUpdate,
    PunchInPayload,
    PunchOutPayload,
    AttendanceRecordResponse,
    RegularizationRequestCreate,
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


@router.get("/locations/assigned", summary="Get current employee's assigned office and geofence")
async def get_assigned_location(
    db: AsyncSession = Depends(get_db_session),
    current_user: CurrentUser = Depends(get_current_user),
):
    """
    Returns the employee's assigned office geofence card:
    Inhyma Thane Office, address, lat/lon coordinates, and geofence radius.
    """
    service = HrmsService(db)
    office = await service.get_assigned_office(str(current_user.id))
    return build_success_response(data=office, message="Assigned office retrieved successfully")


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


@router.delete("/locations/{location_id}", summary="Soft delete location")
async def delete_location(
    location_id: str,
    db: AsyncSession = Depends(get_db_session),
    current_user: CurrentUser = Depends(get_current_user),
):
    """
    HR/Admin action: Soft delete an office/facility location.
    """
    _check_hr_admin_access(current_user)
    service = HrmsService(db)
    result = await service.delete_location(location_id)
    return build_success_response(data=result, message="Location deleted successfully")


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


# ---------------------------------------------------------------------------
# Attendance Logs & Punch
# ---------------------------------------------------------------------------


@router.post("/attendance/punch-in", summary="Record employee punch in")
async def punch_in(
    payload: PunchInPayload,
    db: AsyncSession = Depends(get_db_session),
    current_user: CurrentUser = Depends(get_current_user),
):
    """
    Punch In flow:
    1. Validates current GPS coordinates against assigned office geofence.
    2. Blocks punch if outside radius.
    3. Persists record in PostgreSQL with server timestamp check_in_time.
    4. Auto-evaluates attendance policy rules.
    """
    service = HrmsService(db)
    record = await service.punch_in(
        user_id=str(current_user.id),
        latitude=payload.latitude,
        longitude=payload.longitude,
        office_id=payload.office_id,
    )
    return build_success_response(data=record, message="Punch in recorded successfully")


@router.post("/attendance/punch-out", summary="Record employee punch out")
async def punch_out(
    payload: Optional[PunchOutPayload] = None,
    db: AsyncSession = Depends(get_db_session),
    current_user: CurrentUser = Depends(get_current_user),
):
    """
    Punch Out flow:
    1. Finds today's OPEN attendance record.
    2. Sets check_out_time server timestamp.
    3. Calculates total_work_minutes and final_status.
    4. Marks record CLOSED. Never creates a second record.
    """
    service = HrmsService(db)
    record = await service.punch_out(
        user_id=str(current_user.id),
        latitude=payload.latitude if payload else None,
        longitude=payload.longitude if payload else None,
    )
    return build_success_response(data=record, message="Punch out recorded successfully")


@router.get("/attendance/today", summary="Get today's persistent attendance record")
async def get_today_attendance(
    db: AsyncSession = Depends(get_db_session),
    current_user: CurrentUser = Depends(get_current_user),
):
    """
    Returns today's active or completed attendance record.
    Returns status: 'OPEN', 'CLOSED', or None.
    """
    service = HrmsService(db)
    record = await service.get_today_attendance(str(current_user.id))
    return build_success_response(data=record, message="Today attendance retrieved")


@router.get("/attendance/month", summary="Get monthly attendance records for calendar")
async def get_month_attendance(
    month: Optional[str] = Query(None, description="Month format YYYY-MM"),
    db: AsyncSession = Depends(get_db_session),
    current_user: CurrentUser = Depends(get_current_user),
):
    """
    Returns all attendance records for employee in given month.
    """
    from datetime import datetime
    service = HrmsService(db)
    target_month = month or datetime.now().strftime("%Y-%m")
    records = await service.get_month_attendance(str(current_user.id), month=target_month)
    return build_success_response(data=records, message="Month attendance records retrieved")


@router.get("/attendance/policies", summary="Get attendance policies (alias)")
async def get_attendance_policies_alias(
    db: AsyncSession = Depends(get_db_session),
    _current_user: CurrentUser = Depends(get_current_user),
):
    service = HrmsService(db)
    policies = await service.list_policies()
    return build_success_response(data=policies, message="Attendance policies retrieved")


@router.post("/attendance/policies", summary="Create attendance policy (alias)", status_code=status.HTTP_201_CREATED)
async def create_attendance_policy_alias(
    payload: AttendancePolicyCreate,
    db: AsyncSession = Depends(get_db_session),
    current_user: CurrentUser = Depends(get_current_user),
):
    _check_hr_admin_access(current_user)
    service = HrmsService(db)
    policy = await service.create_policy(payload)
    return build_success_response(data=policy, message="Attendance policy created successfully")


@router.put("/attendance/policies/{policy_id}", summary="Update attendance policy (alias)")
async def update_attendance_policy_alias(
    policy_id: str,
    payload: AttendancePolicyUpdate,
    db: AsyncSession = Depends(get_db_session),
    current_user: CurrentUser = Depends(get_current_user),
):
    _check_hr_admin_access(current_user)
    service = HrmsService(db)
    policy = await service.update_policy(policy_id, payload)
    return build_success_response(data=policy, message="Attendance policy updated successfully")


@router.get("/attendance/logs", summary="List employee attendance logs")
async def list_attendance_logs(
    month: Optional[str] = Query(None, description="Month format YYYY-MM"),
    db: AsyncSession = Depends(get_db_session),
    current_user: CurrentUser = Depends(get_current_user),
):
    service = HrmsService(db)
    logs = await service.list_attendance_logs(str(current_user.id), month=month)
    return build_success_response(data=logs, message="Attendance logs retrieved")


@router.post("/attendance/punch", summary="Record employee punch in/out")
async def record_punch(
    punch_type: str = Query(..., description="in or out"),
    workplace: str = Query("Office", description="Workplace location"),
    db: AsyncSession = Depends(get_db_session),
    current_user: CurrentUser = Depends(get_current_user),
):
    service = HrmsService(db)
    res = await service.record_punch(str(current_user.id), punch_type=punch_type, workplace=workplace)
    return build_success_response(data=res, message=f"Punch {punch_type} recorded successfully")


# ---------------------------------------------------------------------------
# Regularization Drawer Submissions
# ---------------------------------------------------------------------------


@router.post("/regularization-requests", summary="Submit regularization request", status_code=status.HTTP_201_CREATED)
async def create_regularization(
    payload: RegularizationRequestCreate,
    db: AsyncSession = Depends(get_db_session),
    current_user: CurrentUser = Depends(get_current_user),
):
    service = HrmsService(db)
    req = await service.create_regularization_request(str(current_user.id), payload)
    return build_success_response(data=req, message="Regularization request submitted to manager")


@router.get("/regularization-requests/my", summary="List current employee's regularization requests")
async def list_my_regularizations(
    db: AsyncSession = Depends(get_db_session),
    current_user: CurrentUser = Depends(get_current_user),
):
    service = HrmsService(db)
    reqs = await service.list_regularization_requests(str(current_user.id))
    return build_success_response(data=reqs, message="Regularization requests retrieved")


# ---------------------------------------------------------------------------
# Unified Manager Approval Queue
# ---------------------------------------------------------------------------


@router.get("/approvals", summary="Unified approval inbox for Regularization and WFH")
async def list_approvals(
    status_filter: Optional[str] = Query(None, description="PENDING, APPROVED, REJECTED"),
    db: AsyncSession = Depends(get_db_session),
    current_user: CurrentUser = Depends(get_current_user),
):
    _check_hr_admin_access(current_user)
    service = HrmsService(db)
    approvals = await service.list_unified_approvals(status_filter=status_filter)
    return build_success_response(data=approvals, message="Approval queue retrieved")


@router.patch("/approvals/{request_type}/{request_id}/action", summary="Approve or reject a request")
async def review_approval(
    request_type: str,
    request_id: str,
    payload: ApprovalActionPayload,
    db: AsyncSession = Depends(get_db_session),
    current_user: CurrentUser = Depends(get_current_user),
):
    _check_hr_admin_access(current_user)
    service = HrmsService(db)
    res = await service.review_approval(
        request_type=request_type,
        request_id=request_id,
        manager_id=str(current_user.id),
        payload=payload,
    )
    status_label = "approved" if payload.status == "APPROVED" else "rejected"
    return build_success_response(data=res, message=f"Request successfully {status_label}")


# ---------------------------------------------------------------------------
# Adjusted Leave Workflow
# ---------------------------------------------------------------------------


@router.get("/adjusted-leaves", summary="List attendance irregularities tracking as adjusted leave")
async def list_adjusted_leaves(
    db: AsyncSession = Depends(get_db_session),
    current_user: CurrentUser = Depends(get_current_user),
):
    _check_hr_admin_access(current_user)
    service = HrmsService(db)
    leaves = await service.list_adjusted_leaves()
    return build_success_response(data=leaves, message="Adjusted leaves retrieved")


@router.post("/adjusted-leaves/{leave_id}/action", summary="Action an adjusted leave irregularity")
async def action_adjusted_leave(
    leave_id: str,
    payload: AdjustedLeaveActionPayload,
    db: AsyncSession = Depends(get_db_session),
    current_user: CurrentUser = Depends(get_current_user),
):
    _check_hr_admin_access(current_user)
    service = HrmsService(db)
    res = await service.action_adjusted_leave(
        leave_id=leave_id,
        manager_id=str(current_user.id),
        payload=payload,
    )
    return build_success_response(data=res, message=f"Adjusted leave updated: {res['final_decision']}")


# ---------------------------------------------------------------------------
# Attendance Settings (3 Tabs) & Exemptions
# ---------------------------------------------------------------------------


@router.get("/settings", summary="Get 3-tab attendance settings")
async def get_attendance_settings(
    db: AsyncSession = Depends(get_db_session),
    _current_user: CurrentUser = Depends(get_current_user),
):
    service = HrmsService(db)
    st = await service.get_attendance_settings()
    return build_success_response(data=st, message="Attendance settings retrieved")


@router.put("/settings", summary="Update 3-tab attendance settings")
async def update_attendance_settings(
    payload: AttendanceSettingsUpdate,
    db: AsyncSession = Depends(get_db_session),
    current_user: CurrentUser = Depends(get_current_user),
):
    _check_hr_admin_access(current_user)
    service = HrmsService(db)
    st = await service.update_attendance_settings(payload)
    return build_success_response(data=st, message="Attendance settings updated successfully")


@router.get("/exemptions", summary="List Tab 2 attendance exemptions")
async def list_exemptions(
    db: AsyncSession = Depends(get_db_session),
    current_user: CurrentUser = Depends(get_current_user),
):
    _check_hr_admin_access(current_user)
    service = HrmsService(db)
    exs = await service.list_attendance_exemptions()
    return build_success_response(data=exs, message="Exemptions retrieved")


@router.post("/exemptions", summary="Add Tab 2 attendance exemption", status_code=status.HTTP_201_CREATED)
async def create_exemption(
    payload: AttendanceExemptionCreate,
    db: AsyncSession = Depends(get_db_session),
    current_user: CurrentUser = Depends(get_current_user),
):
    _check_hr_admin_access(current_user)
    service = HrmsService(db)
    ex = await service.create_attendance_exemption(payload)
    return build_success_response(data=ex, message="Attendance exemption added")


# ---------------------------------------------------------------------------
# Attendance Policies (Multi-Policy Engine)
# ---------------------------------------------------------------------------


@router.get("/policies", summary="List attendance policies")
async def list_policies(
    include_archived: bool = Query(False, description="Include archived policies"),
    db: AsyncSession = Depends(get_db_session),
    _current_user: CurrentUser = Depends(get_current_user),
):
    """List all attendance policies. Seeds default company policy if empty."""
    service = HrmsService(db)
    policies = await service.list_policies(include_archived=include_archived)
    return build_success_response(data=policies, message="Policies retrieved")


@router.post("/policies", summary="Create attendance policy", status_code=status.HTTP_201_CREATED)
async def create_policy(
    payload: AttendancePolicyCreate,
    db: AsyncSession = Depends(get_db_session),
    current_user: CurrentUser = Depends(get_current_user),
):
    """Admin action: Create a new reusable attendance policy."""
    _check_hr_admin_access(current_user)
    service = HrmsService(db)
    created = await service.create_policy(payload)
    return build_success_response(data=created, message="Attendance policy created successfully")


@router.put("/policies/{policy_id}", summary="Update attendance policy")
async def update_policy(
    policy_id: str,
    payload: AttendancePolicyUpdate,
    db: AsyncSession = Depends(get_db_session),
    current_user: CurrentUser = Depends(get_current_user),
):
    """Admin action: Update policy thresholds and details."""
    _check_hr_admin_access(current_user)
    service = HrmsService(db)
    updated = await service.update_policy(policy_id, payload)
    return build_success_response(data=updated, message="Attendance policy updated successfully")


@router.post("/policies/{policy_id}/activate", summary="Activate policy")
async def activate_policy(
    policy_id: str,
    db: AsyncSession = Depends(get_db_session),
    current_user: CurrentUser = Depends(get_current_user),
):
    """Admin action: Set active policy for the company."""
    _check_hr_admin_access(current_user)
    service = HrmsService(db)
    result = await service.activate_policy(policy_id)
    return build_success_response(data=result, message="Attendance policy activated successfully")


@router.post("/policies/{policy_id}/duplicate", summary="Duplicate policy")
async def duplicate_policy(
    policy_id: str,
    db: AsyncSession = Depends(get_db_session),
    current_user: CurrentUser = Depends(get_current_user),
):
    """Admin action: Duplicate policy as copy."""
    _check_hr_admin_access(current_user)
    service = HrmsService(db)
    result = await service.duplicate_policy(policy_id)
    return build_success_response(data=result, message="Attendance policy duplicated successfully")


@router.delete("/policies/{policy_id}", summary="Archive attendance policy")
async def archive_policy(
    policy_id: str,
    db: AsyncSession = Depends(get_db_session),
    current_user: CurrentUser = Depends(get_current_user),
):
    """Admin action: Archive policy."""
    _check_hr_admin_access(current_user)
    service = HrmsService(db)
    result = await service.archive_policy(policy_id)
    return build_success_response(data=result, message="Attendance policy archived successfully")


# ---------------------------------------------------------------------------
# Direct Aliases for /attendance/* and /locations/* (Part 10 Endpoints)
# ---------------------------------------------------------------------------

attendance_alias_router = APIRouter(tags=["HRMS - Attendance & Locations Root"])

attendance_alias_router.add_api_route("/attendance/punch-in", punch_in, methods=["POST"], summary="Punch In (Root Alias)")
attendance_alias_router.add_api_route("/attendance/punch-out", punch_out, methods=["POST"], summary="Punch Out (Root Alias)")
attendance_alias_router.add_api_route("/attendance/today", get_today_attendance, methods=["GET"], summary="Get Today Attendance (Root Alias)")
attendance_alias_router.add_api_route("/attendance/month", get_month_attendance, methods=["GET"], summary="Get Month Attendance (Root Alias)")
attendance_alias_router.add_api_route("/attendance/policies", get_attendance_policies_alias, methods=["GET"], summary="List Policies (Root Alias)")
attendance_alias_router.add_api_route("/attendance/policies", create_attendance_policy_alias, methods=["POST"], status_code=status.HTTP_201_CREATED, summary="Create Policy (Root Alias)")
attendance_alias_router.add_api_route("/attendance/policies/{policy_id}", update_attendance_policy_alias, methods=["PUT"], summary="Update Policy (Root Alias)")
attendance_alias_router.add_api_route("/locations", list_locations, methods=["GET"], summary="List Locations (Root Alias)")
attendance_alias_router.add_api_route("/locations/assigned", get_assigned_location, methods=["GET"], summary="Get Assigned Location (Root Alias)")
attendance_alias_router.add_api_route("/locations", create_location, methods=["POST"], status_code=status.HTTP_201_CREATED, summary="Create Location (Root Alias)")
attendance_alias_router.add_api_route("/locations/{location_id}", update_location, methods=["PUT"], summary="Update Location (Root Alias)")

