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

import uuid
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_auth_service
from app.auth.service import AuthService
from app.core.responses import build_success_response
from app.database.session import get_db_session
from app.hrms.attendance_service import HrmsAttendanceService, IST
from app.hrms.schemas import (
    AssignedOfficeRead,
    AttendancePolicyRead,
    AttendancePolicyUpdate,
    AttendanceRecordRead,
    CalendarDayRead,
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


from app.hrms.rbac import HrmsUserContext, get_hrms_user_context


async def get_current_employee_id(
    ctx: HrmsUserContext = Depends(get_hrms_user_context),
) -> uuid.UUID:
    ctx.require_module_access("attendance")
    return ctx.user_id


# ===========================================================================
# Attendance Policy Endpoints (Configurable)
# ===========================================================================

@router.get("/policy")
async def get_policy(service: HrmsAttendanceService = Depends(get_attendance_service)):
    policy = await service.get_policy()
    return build_success_response(
        data=AttendancePolicyRead.model_validate(policy).model_dump(mode="json"),
        message="Attendance policy retrieved successfully.",
    )


@router.put("/policy")
async def update_policy(
    payload: AttendancePolicyUpdate,
    service: HrmsAttendanceService = Depends(get_attendance_service),
):
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


# ===========================================================================
# Today's Punch Session
# ===========================================================================

@router.get("/today")
async def get_today_attendance(
    employee_id: Optional[uuid.UUID] = Query(default=None),
    user_id: Optional[uuid.UUID] = Query(default=None),
    ctx: HrmsUserContext = Depends(get_hrms_user_context),
    service: HrmsAttendanceService = Depends(get_attendance_service),
):
    ctx.require_module_access("attendance")
    target_id = employee_id or user_id or ctx.user_id
    ctx.require_employee_access(target_id)
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
    employee_id: Optional[uuid.UUID] = Query(default=None),
    user_id: Optional[uuid.UUID] = Query(default=None),
    ctx: HrmsUserContext = Depends(get_hrms_user_context),
    service: HrmsAttendanceService = Depends(get_attendance_service),
):
    ctx.require_module_access("attendance")
    target_id = employee_id or user_id or ctx.user_id
    ctx.require_employee_access(target_id)
    now = datetime.now(IST)
    y = year or now.year
    m = month or now.month
    calendar_days = await service.get_calendar(target_id, y, m)
    return build_success_response(
        data=[d.model_dump(mode="json") for d in calendar_days],
        message="Monthly attendance calendar retrieved successfully.",
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
    record = await service.submit_regularization(target_id, payload, is_admin=ctx.is_admin)
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
):
    ctx.require_module_access("attendance")
    if not (ctx.is_admin or ctx.is_hr or ctx.is_manager):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Permission denied. You cannot approve attendance regularizations.")

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
):
    ctx.require_module_access("attendance")
    if not (ctx.is_admin or ctx.is_hr or ctx.is_manager):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Permission denied. You cannot reject attendance regularizations.")

    record = await service.reject_regularization(request_id, ctx.user_id, payload=payload)
    return build_success_response(
        data=record.model_dump(mode="json"),
        message="Attendance regularization request rejected.",
    )
