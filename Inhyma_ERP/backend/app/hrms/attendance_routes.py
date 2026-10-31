"""
HRMS Attendance Endpoints (Day 3).

Mounts under ``/api/v1/hrms/attendance``:
- Policy retrieval & configuration (shift start, shift end, grace time, half-day threshold)
- Assigned office & geofence resolution
- Today's attendance status & live session
- Punch In with Haversine distance geofencing
- Punch Out with live session calculation & early exit detection
- Monthly Attendance Calendar matrix with selective regularization triggers
- One-day Regularization request submission
"""

from __future__ import annotations

import calendar
import uuid
from datetime import date, datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_auth_service
from app.auth.service import AuthService
from app.core.logging import get_logger
from app.core.responses import build_success_response
from app.database.session import get_db_session
from app.users.models import User
from app.hrms.attendance_service import HrmsAttendanceService, IST

logger = get_logger(__name__)
from app.hrms.schemas import (
    AssignedOfficeRead,
    AttendancePolicyRead,
    AttendancePolicyUpdate,
    AttendanceRecordRead,
    CalendarDayRead,
    GeofenceCheckRequest,
    GeofenceCheckResponse,
    PunchInRequest,
    PunchOutRequest,
    RegularizationApprovalAction,
    RegularizationCreate,
    RegularizationRead,
    RegularizationRejectAction,
    RegularizationRequest,
    TodayAttendanceRead,
)

router = APIRouter(prefix="/hrms/attendance", tags=["HRMS - Attendance"])


def get_attendance_service(db: AsyncSession = Depends(get_db_session)) -> HrmsAttendanceService:
    return HrmsAttendanceService(db)


from app.hrms.models import HrmsAttendanceRegularization
from app.hrms.rbac import (
    HrmsUserContext,
    get_hrms_user_context,
    resolve_hrms_employee,
    resolve_hrms_employee_or_404,
    verify_approval_authorization,
)


async def get_current_employee_id(
    ctx: HrmsUserContext = Depends(get_hrms_user_context),
) -> uuid.UUID:
    ctx.require_module_access("attendance")
    return ctx.user_id


# ===========================================================================
# Attendance Policy Endpoints (Configurable)
# ===========================================================================

@router.get("/policy")
async def get_policy(
    service: HrmsAttendanceService = Depends(get_attendance_service),
    ctx: HrmsUserContext = Depends(get_hrms_user_context),
):
    ctx.require_module_access("attendance")
    policy = await service.get_policy()
    return build_success_response(
        data=AttendancePolicyRead.model_validate(policy).model_dump(mode="json"),
        message="Attendance policy retrieved successfully.",
    )


@router.put("/policy")
async def update_policy(
    payload: AttendancePolicyUpdate,
    service: HrmsAttendanceService = Depends(get_attendance_service),
    ctx: HrmsUserContext = Depends(get_hrms_user_context),
):
    ctx.require_module_access("attendance")
    if not (ctx.is_admin or (ctx.is_hr and "hrms.manage" in ctx.permissions)):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Permission denied. Only Admin or HR with setup permissions can update attendance policy.",
        )
    policy = await service.update_policy(payload)
    return build_success_response(
        data=AttendancePolicyRead.model_validate(policy).model_dump(mode="json"),
        message="Attendance policy updated successfully.",
    )


# ===========================================================================
# Assigned Office & Geofence
# ===========================================================================

@router.get("/assigned-office")
async def get_assigned_office(
    employee_id: uuid.UUID = Depends(get_current_employee_id),
    service: HrmsAttendanceService = Depends(get_attendance_service),
):
    office = await service.get_assigned_office(employee_id)
    return build_success_response(
        data=AssignedOfficeRead(
            id=office.id,
            name=office.name,
            address=office.address,
            latitude=office.latitude,
            longitude=office.longitude,
            radius_meters=office.radius_meters,
        ).model_dump(mode="json"),
        message="Assigned office retrieved successfully.",
    )


@router.get("/permitted-offices")
async def get_permitted_offices(
    employee_id: Optional[str] = Query(default=None),
    ctx: HrmsUserContext = Depends(get_hrms_user_context),
    service: HrmsAttendanceService = Depends(get_attendance_service),
):
    """
    Fetch all active authorized office locations (primary and additional) for the employee.
    Used by frontend attendance engine to validate geofence across all permitted locations.
    """
    ctx.require_module_access("attendance")
    target_id = ctx.user_id
    if employee_id:
        if ctx.is_admin or ctx.is_hr:
            try:
                target_id = uuid.UUID(employee_id)
            except ValueError:
                pass

    _, permitted = await service.get_permitted_locations(target_id)
    return build_success_response(
        data=[
            AssignedOfficeRead(
                id=loc.id,
                name=loc.name,
                address=loc.address,
                latitude=loc.latitude,
                longitude=loc.longitude,
                radius_meters=loc.radius_meters,
            ).model_dump(mode="json")
            for loc in permitted
        ],
        message="Permitted offices retrieved successfully.",
    )


# ===========================================================================
# Today's Punch Session
# ===========================================================================

@router.get("/today")
async def get_today_attendance(
    employee_id: Optional[str] = Query(default=None),
    user_id: Optional[str] = Query(default=None),
    ctx: HrmsUserContext = Depends(get_hrms_user_context),
    service: HrmsAttendanceService = Depends(get_attendance_service),
    db: AsyncSession = Depends(get_db_session),
):
    ctx.require_module_access("attendance")
    raw_id = employee_id or user_id
    if raw_id:
        if not (ctx.is_admin or ctx.is_hr):
            try:
                parsed_uuid = uuid.UUID(raw_id.strip())
                ctx.require_employee_access(parsed_uuid)
            except ValueError:
                pass
        target_user = await resolve_hrms_employee_or_404(db, raw_id, error_label="employee")
        ctx.require_employee_access(target_user.id)
        target_id = target_user.id
    else:
        target_id = ctx.user_id
    session_state = await service.get_today_session_state(target_id)
    return build_success_response(
        data=session_state.model_dump(mode="json"),
        message="Today's attendance retrieved successfully.",
    )


@router.post("/punch-in", status_code=status.HTTP_201_CREATED)
async def punch_in(
    payload: PunchInRequest,
    employee_id: uuid.UUID = Depends(get_current_employee_id),
    service: HrmsAttendanceService = Depends(get_attendance_service),
):
    record = await service.punch_in(employee_id, payload)
    return build_success_response(
        data=record.model_dump(mode="json"),
        message=f"Punched in successfully as {record.status}.",
    )


@router.post("/punch-out", status_code=status.HTTP_200_OK)
async def punch_out(
    payload: PunchOutRequest,
    employee_id: uuid.UUID = Depends(get_current_employee_id),
    service: HrmsAttendanceService = Depends(get_attendance_service),
):
    record = await service.punch_out(employee_id, payload)
    return build_success_response(
        data=record.model_dump(mode="json"),
        message="Punched out successfully. Active work session logged.",
    )


# ===========================================================================
# Monthly Calendar & Regularization
# ===========================================================================

@router.get("/calendar")
async def get_calendar(
    year: Optional[int] = Query(default=None),
    month: Optional[int] = Query(default=None),
    employee_id: Optional[str] = Query(default=None),
    user_id: Optional[str] = Query(default=None),
    ctx: HrmsUserContext = Depends(get_hrms_user_context),
    service: HrmsAttendanceService = Depends(get_attendance_service),
    db: AsyncSession = Depends(get_db_session),
):
    ctx.require_module_access("attendance")
    raw_id = employee_id or user_id
    if raw_id:
        if not (ctx.is_admin or ctx.is_hr):
            try:
                parsed_uuid = uuid.UUID(raw_id.strip())
                ctx.require_employee_access(parsed_uuid)
            except ValueError:
                pass
        target_user = await resolve_hrms_employee_or_404(db, raw_id, error_label="employee")
        ctx.require_employee_access(target_user.id)
        target_id = target_user.id
    else:
        target_id = ctx.user_id

    now = datetime.now(IST)
    y = year or now.year
    m = month or now.month
    calendar_days = await service.get_calendar(target_id, y, m)
    return build_success_response(
        data=[d.model_dump(mode="json") for d in calendar_days],
        message="Monthly attendance calendar retrieved successfully.",
    )


@router.get("/all-calendar")
async def get_all_calendar(
    year: Optional[int] = Query(default=None),
    month: Optional[int] = Query(default=None),
    employee_id: Optional[str] = Query(default=None),
    department: Optional[str] = Query(default=None),
    branch: Optional[str] = Query(default=None),
    search: Optional[str] = Query(default=None),
    ctx: HrmsUserContext = Depends(get_hrms_user_context),
    service: HrmsAttendanceService = Depends(get_attendance_service),
    db: AsyncSession = Depends(get_db_session),
):
    """
    Retrieve monthly attendance calendar matrix for all authorized employees.
    Strictly enforced RBAC:
    - Admin / HR: Company-wide view, full filtering by employee, department, branch, search.
    - Department Manager: Scoped strictly to managed department employees.
    - Employee: Strictly scoped to own attendance record. Attempting to view others returns 403 Forbidden.
    """
    ctx.require_module_access("attendance")
    now = datetime.now(IST)
    y = year or now.year
    m = month or now.month

    allowed_ids = None
    target_emp_id = None

    if employee_id and employee_id.strip() and employee_id.strip().upper() != "ALL":
        if not (ctx.is_admin or ctx.is_hr):
            try:
                parsed_emp_uuid = uuid.UUID(employee_id.strip())
                ctx.require_employee_access(parsed_emp_uuid)
            except ValueError:
                pass
        target_user = await resolve_hrms_employee_or_404(db, employee_id, error_label="employee")
        if not (ctx.is_admin or ctx.is_hr):
            ctx.require_employee_access(target_user.id)
        target_emp_id = target_user.id
    elif not (ctx.is_admin or ctx.is_hr):
        if ctx.is_manager:
            allowed_ids = ctx.managed_employee_ids
        else:
            target_emp_id = ctx.user_id

    calendar_matrix = await service.get_all_employees_calendar(
        year=y,
        month=m,
        allowed_employee_ids=allowed_ids,
        department=department,
        branch=branch,
        employee_id=target_emp_id,
        search=search,
    )
    return build_success_response(
        data=calendar_matrix,
        message="All employees monthly attendance calendar retrieved successfully.",
    )



# ===========================================================================
# Attendance Regularizations & Approval Workflow
# ===========================================================================

@router.post("/regularize", status_code=status.HTTP_200_OK)
@router.post("/regularization", status_code=status.HTTP_200_OK)
@router.post("/regularizations", status_code=status.HTTP_200_OK)
async def submit_regularization(
    payload: RegularizationRequest,
    ctx: HrmsUserContext = Depends(get_hrms_user_context),
    service: HrmsAttendanceService = Depends(get_attendance_service),
):
    ctx.require_module_access("attendance")
    target_id = payload.employee_id if (payload.employee_id and (ctx.is_admin or ctx.is_hr)) else ctx.user_id
    if payload.direct_regularize:
        if not ctx.is_admin:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Permission denied. Only administrators can perform direct attendance regularization.",
            )
        if target_id == ctx.user_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Self-approval is not permitted. Administrators cannot directly regularize their own attendance.",
            )
    record = await service.submit_regularization(target_id, payload, is_admin=ctx.is_admin, actor_id=ctx.user_id)
    return build_success_response(
        data=record.model_dump(mode="json"),
        message="Regularization request submitted successfully.",
    )


@router.get("/regularizations", status_code=status.HTTP_200_OK)
async def get_regularizations(
    status: Optional[str] = Query(default=None),
    employee_id: Optional[uuid.UUID] = Query(default=None),
    user_id: Optional[uuid.UUID] = Query(default=None),
    ctx: HrmsUserContext = Depends(get_hrms_user_context),
    service: HrmsAttendanceService = Depends(get_attendance_service),
):
    ctx.require_module_access("attendance")
    target_id = employee_id or user_id
    if target_id:
        ctx.require_employee_access(target_id)
        records = await service.get_regularizations(status=status, employee_id=target_id)
    else:
        if ctx.is_admin or ctx.is_hr:
            records = await service.get_regularizations(status=status, employee_id=None)
        elif ctx.is_manager:
            all_recs = await service.get_regularizations(status=status, employee_id=None)
            records = [r for r in all_recs if r.employee_id in ctx.managed_employee_ids]
        else:
            records = await service.get_regularizations(status=status, employee_id=ctx.user_id)

    return build_success_response(
        data=[r.model_dump(mode="json") for r in records],
        message="Attendance regularizations retrieved successfully.",
    )


@router.patch("/regularizations/{request_id}/approve", status_code=status.HTTP_200_OK)
@router.post("/regularizations/{request_id}/approve", status_code=status.HTTP_200_OK)
async def approve_regularization(
    request_id: uuid.UUID,
    payload: Optional[RegularizationApprovalAction] = None,
    ctx: HrmsUserContext = Depends(get_hrms_user_context),
    service: HrmsAttendanceService = Depends(get_attendance_service),
    db: AsyncSession = Depends(get_db_session),
):
    ctx.require_module_access("attendance")
    res = await db.execute(
        select(HrmsAttendanceRegularization).where(HrmsAttendanceRegularization.id == request_id)
    )
    reg_req = res.scalar_one_or_none()
    if not reg_req:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Regularization request {request_id} not found.")

    if reg_req.status != "PENDING":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Attendance regularization request is already {reg_req.status}.",
        )

    await verify_approval_authorization(
        db=db,
        ctx=ctx,
        target_employee_id=reg_req.employee_id,
        module_name="attendance",
        action_label="approve",
    )

    record = await service.approve_regularization(request_id, ctx.user_id, payload=payload)
    return build_success_response(
        data=record.model_dump(mode="json"),
        message="Attendance regularization request approved successfully.",
    )


@router.patch("/regularizations/{request_id}/reject", status_code=status.HTTP_200_OK)
@router.post("/regularizations/{request_id}/reject", status_code=status.HTTP_200_OK)
async def reject_regularization(
    request_id: uuid.UUID,
    payload: Optional[RegularizationRejectAction] = None,
    ctx: HrmsUserContext = Depends(get_hrms_user_context),
    service: HrmsAttendanceService = Depends(get_attendance_service),
    db: AsyncSession = Depends(get_db_session),
):
    ctx.require_module_access("attendance")
    res = await db.execute(
        select(HrmsAttendanceRegularization).where(HrmsAttendanceRegularization.id == request_id)
    )
    reg_req = res.scalar_one_or_none()
    if not reg_req:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Regularization request {request_id} not found.")

    if reg_req.status != "PENDING":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Attendance regularization request is already {reg_req.status}.",
        )

    await verify_approval_authorization(
        db=db,
        ctx=ctx,
        target_employee_id=reg_req.employee_id,
        module_name="attendance",
        action_label="reject",
    )

    record = await service.reject_regularization(request_id, ctx.user_id, payload=payload)
    return build_success_response(
        data=record.model_dump(mode="json"),
        message="Attendance regularization request rejected.",
    )


# ===========================================================================
# Geofence Status & Return Timer Verification
# ===========================================================================

@router.post("/geofence-status")
@router.get("/geofence-status")
async def check_geofence_status(
    latitude: Optional[float] = Query(None),
    longitude: Optional[float] = Query(None),
    accuracy: Optional[float] = Query(10.0),
    payload: Optional[GeofenceCheckRequest] = None,
    ctx: HrmsUserContext = Depends(get_hrms_user_context),
    service: HrmsAttendanceService = Depends(get_attendance_service),
):
    """
    Check current position against assigned office boundary.
    Starts return timer on exit; expires into violation event on timeout;
    cancels timer and resolves event on return inside boundary.
    """
    ctx.require_module_access("attendance")
    lat = payload.latitude if (payload and payload.latitude is not None) else latitude
    lng = payload.longitude if (payload and payload.longitude is not None) else longitude
    acc = payload.accuracy if (payload and payload.accuracy is not None) else accuracy

    if lat is None or lng is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Latitude and longitude are required to verify geofence status.",
        )

    res = await service.check_geofence_status(
        employee_id=ctx.user_id,
        latitude=float(lat),
        longitude=float(lng),
        accuracy=float(acc or 10.0),
    )
    return build_success_response(
        data=res.model_dump(mode="json"),
        message="Geofence status checked successfully.",
    )


# ===========================================================================
# Authoritative Attendance Excel Export
# ===========================================================================

@router.get("/export")
async def export_attendance(
    start_date: Optional[date] = Query(None, description="From date (YYYY-MM-DD)"),
    end_date: Optional[date] = Query(None, description="To date (YYYY-MM-DD)"),
    year: Optional[int] = Query(None, description="Calendar year (e.g. 2026)"),
    month: Optional[int] = Query(None, description="Calendar month (1-12)"),
    employee_id: Optional[str] = Query(None, description="Optional employee UUID or employee code filter or 'ALL'"),
    ctx: HrmsUserContext = Depends(get_hrms_user_context),
    service: HrmsAttendanceService = Depends(get_attendance_service),
    db: AsyncSession = Depends(get_db_session),
):
    """
    Download authoritative attendance records to an Excel (.xlsx) workbook.
    Enforces RBAC scoping:
    - Admin: company-wide or specific employee
    - HR: company-wide within HR scope
    - Department Manager: scoped to department employees
    - Normal Employee: self only
    Supports:
    - Complete calendar month (year + month)
    - Custom date range (start_date + end_date)
    - Single day (start_date only)
    """
    ctx.require_module_access("attendance")

    # Authoritative employee resolution (handles 'ALL', '', UUID, and employee code)
    resolved_emp_id: Optional[uuid.UUID] = None
    if employee_id and employee_id.strip() and employee_id.strip().upper() != "ALL":
        if not (ctx.is_admin or ctx.is_hr):
            try:
                parsed_uuid = uuid.UUID(employee_id.strip())
                if ctx.is_manager:
                    if parsed_uuid not in ctx.managed_employee_ids:
                        raise HTTPException(
                            status_code=status.HTTP_403_FORBIDDEN,
                            detail="Permission denied. You can only export records for your department.",
                        )
                else:
                    if parsed_uuid != ctx.user_id:
                        raise HTTPException(
                            status_code=status.HTTP_403_FORBIDDEN,
                            detail="Permission denied. You can only export your own attendance records.",
                        )
            except ValueError:
                pass
        target_user = await resolve_hrms_employee_or_404(db, employee_id, error_label="employee")
        resolved_emp_id = target_user.id

    calendar_month_name = None
    if year is not None and month is not None:
        if month < 1 or month > 12:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Month must be between 1 and 12.",
            )
        _, num_days = calendar.monthrange(year, month)
        resolved_start = date(year, month, 1)
        resolved_end = date(year, month, num_days)
        calendar_month_name = resolved_start.strftime("%B %Y")
    elif start_date is not None and end_date is not None:
        if start_date > end_date:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Start date cannot be after end date.",
            )
        resolved_start = start_date
        resolved_end = end_date
    elif start_date is not None and end_date is None:
        resolved_start = start_date
        resolved_end = start_date
    elif start_date is None and end_date is not None:
        resolved_start = end_date
        resolved_end = end_date
    else:
        # Default to current calendar month (1st through last day)
        now_date = datetime.now(IST).date()
        _, num_days = calendar.monthrange(now_date.year, now_date.month)
        resolved_start = date(now_date.year, now_date.month, 1)
        resolved_end = date(now_date.year, now_date.month, num_days)
        year = now_date.year
        month = now_date.month
        calendar_month_name = resolved_start.strftime("%B %Y")

    is_admin = ctx.is_admin or ctx.is_hr
    allowed_ids = None

    if not is_admin:
        if ctx.is_manager:
            if resolved_emp_id:
                ctx.require_employee_access(resolved_emp_id)
            else:
                allowed_ids = ctx.managed_employee_ids
        else:
            # Normal employee: can only export self
            if resolved_emp_id and resolved_emp_id != ctx.user_id:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Permission denied. You can only export your own attendance records.",
                )
            resolved_emp_id = ctx.user_id

    try:
        buf, emp_count, count = await service.export_attendance_excel(
            start_date=resolved_start,
            end_date=resolved_end,
            employee_id=resolved_emp_id,
            allowed_employee_ids=allowed_ids,
            is_admin=is_admin,
            calendar_month_name=calendar_month_name,
        )

        target_label = "All_Employees"
        if resolved_emp_id:
            emp = await service.db.get(User, resolved_emp_id)
            if emp:
                name_part = (emp.first_name or emp.username or "Employee").strip().replace(" ", "_")
                code_part = getattr(emp, "employee_code", None) or getattr(emp, "code", None)
                if code_part:
                    target_label = f"{code_part}_{name_part}"
                else:
                    target_label = name_part

        if calendar_month_name and year and month:
            filename = f"Attendance_Export_{target_label}_{year}_{month:02d}.xlsx"
        elif resolved_start == resolved_end:
            filename = f"Attendance_Export_{target_label}_{resolved_start.strftime('%Y%m%d')}.xlsx"
        else:
            filename = f"Attendance_Export_{target_label}_{resolved_start.strftime('%Y%m%d')}_to_{resolved_end.strftime('%Y%m%d')}.xlsx"

        headers = {
            "Content-Disposition": f'attachment; filename="{filename}"',
            "X-Total-Count": str(count),
            "X-Employee-Count": str(emp_count),
            "Access-Control-Expose-Headers": "Content-Disposition, X-Total-Count, X-Employee-Count",
            "Cache-Control": "no-cache, no-store, must-revalidate, max-age=0",
            "Pragma": "no-cache",
            "Expires": "0",
        }
        return Response(
            content=buf.getvalue(),
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers=headers,
        )
    except HTTPException:
        raise
    except ValueError as val_err:
        logger.error("Attendance Excel workbook validation failed: %s", val_err)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Attendance Excel workbook generation validation failed: {val_err}",
        )
    except Exception as exc:
        logger.exception("Failed to export attendance Excel: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to export attendance Excel: {str(exc)}",
        )


