"""
Attendance RESTful Endpoints.
Routes for punch-in, punch-out, today session, and month calendar.
"""

from __future__ import annotations

from typing import Optional
from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_user
from app.auth.service import CurrentUser
from app.core.responses import build_success_response
from app.database.session import get_db_session
from app.hrms.schemas import PunchInPayload, PunchOutPayload
from app.attendance.service import AttendanceService

router = APIRouter(prefix="/attendance", tags=["HRMS - Attendance"])


@router.post("/punch-in", summary="Record employee punch in")
async def punch_in(
    payload: PunchInPayload,
    db: AsyncSession = Depends(get_db_session),
    current_user: CurrentUser = Depends(get_current_user),
):
    service = AttendanceService(db)
    record = await service.punch_in(
        user_id=str(current_user.id),
        latitude=payload.latitude,
        longitude=payload.longitude,
        office_id=payload.office_id,
    )
    return build_success_response(data=record, message="Punch in recorded successfully")


@router.post("/punch-out", summary="Record employee punch out")
async def punch_out(
    payload: Optional[PunchOutPayload] = None,
    db: AsyncSession = Depends(get_db_session),
    current_user: CurrentUser = Depends(get_current_user),
):
    service = AttendanceService(db)
    record = await service.punch_out(
        user_id=str(current_user.id),
        latitude=payload.latitude if payload else None,
        longitude=payload.longitude if payload else None,
    )
    return build_success_response(data=record, message="Punch out recorded successfully")


@router.get("/today", summary="Get today's persistent attendance record")
async def get_today_attendance(
    db: AsyncSession = Depends(get_db_session),
    current_user: CurrentUser = Depends(get_current_user),
):
    service = AttendanceService(db)
    record = await service.get_today_attendance(str(current_user.id))
    return build_success_response(data=record, message="Today attendance retrieved")


@router.get("/month", summary="Get monthly attendance records for calendar")
async def get_month_attendance(
    month: Optional[str] = Query(None, description="Month format YYYY-MM"),
    db: AsyncSession = Depends(get_db_session),
    current_user: CurrentUser = Depends(get_current_user),
):
    from datetime import datetime
    service = AttendanceService(db)
    target_month = month or datetime.now().strftime("%Y-%m")
    records = await service.get_month_attendance(str(current_user.id), month=target_month)
    return build_success_response(data=records, message="Month attendance records retrieved")
