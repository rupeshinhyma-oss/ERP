"""
HRMS Site Visit & Live Tracking Endpoints.

Mounts under ``/api/v1/hrms``:
- Site Visits:
  - GET  /hrms/site-visits (List site visits, RBAC filtered)
  - POST /hrms/site-visits (Admin/HR/Manager: create site visit)
  - GET  /hrms/site-visits/{id} (Get site visit detail)
  - POST /hrms/site-visits/{id}/check-in (Check in with GPS)
  - POST /hrms/site-visits/{id}/check-out (Check out with GPS)
  - GET  /hrms/site-visits/evidence (Evidence by employee_id + date)
- Live Tracking:
  - GET  /hrms/tracking/active (Get employee's current active tracking session)
  - POST /hrms/tracking/start (Start live tracking session)
  - POST /hrms/tracking/points (Upload batch of 5-minute tracking points)
  - POST /hrms/tracking/{session_id}/stop (Stop live tracking and process summary)
  - GET  /hrms/tracking/sessions (List tracking sessions)
- Regularization Linkage:
  - GET  /hrms/attendance/regularizations/{id}/evidence (Evidence for regularization)
"""

from __future__ import annotations

from datetime import date
from typing import List, Optional
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.responses import build_success_response
from app.database.session import get_db_session
from app.hrms.models import HrmsAttendanceRegularization
from app.hrms.rbac import HrmsUserContext, get_hrms_user_context
from app.hrms.schemas import (
    RegularizationEvidenceRead,
    SiteVisitCheckIn,
    SiteVisitCheckOut,
    SiteVisitCreate,
    SiteVisitRead,
    TrackingPointsBatch,
    TrackingSessionRead,
    TrackingStartPayload,
    TrackingStopPayload,
)
from app.hrms.site_visit_service import HrmsSiteVisitService
from app.users.models import User, UserStatus

router = APIRouter(tags=["HRMS - Site Visits & Tracking"])


def get_site_visit_service(db: AsyncSession = Depends(get_db_session)) -> HrmsSiteVisitService:
    return HrmsSiteVisitService(db)


# ===========================================================================
# 1. Site Visit Endpoints
# ===========================================================================

@router.get("/hrms/site-visits", summary="List site visits")
async def list_site_visits(
    employee_id: Optional[uuid.UUID] = Query(default=None),
    visit_date: Optional[date] = Query(default=None),
    status: Optional[str] = Query(default=None),
    search: Optional[str] = Query(default=None),
    service: HrmsSiteVisitService = Depends(get_site_visit_service),
    ctx: HrmsUserContext = Depends(get_hrms_user_context),
):
    ctx.require_module_access("site_visits")
    allowed_ids = None if (ctx.is_admin or ctx.is_hr) else ctx.managed_employee_ids

    visits = await service.list_site_visits(
        current_user_id=ctx.user_id,
        is_admin=ctx.is_admin or ctx.is_hr,
        employee_id=employee_id,
        visit_date=visit_date,
        status_filter=status,
        search=search,
        is_manager=ctx.is_manager,
        allowed_employee_ids=allowed_ids,
    )
    data = [service.to_site_visit_read(v).model_dump(mode="json") for v in visits]
    return build_success_response(data=data, message="Site visits retrieved successfully.")


@router.post("/hrms/site-visits", status_code=status.HTTP_201_CREATED, summary="Create site visit")
async def create_site_visit(
    payload: SiteVisitCreate,
    service: HrmsSiteVisitService = Depends(get_site_visit_service),
    ctx: HrmsUserContext = Depends(get_hrms_user_context),
):
    ctx.require_module_access("site_visits")
    if not (ctx.is_admin or ctx.is_hr or ctx.is_manager):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Permission denied. Only Admin, HR, or Department Managers can create Site Visits.",
        )

    allowed_ids = None if (ctx.is_admin or ctx.is_hr) else ctx.managed_employee_ids
    visit = await service.create_site_visit(
        creator_id=ctx.user_id,
        is_admin=ctx.is_admin or ctx.is_hr,
        payload=payload,
        allowed_employee_ids=allowed_ids,
    )
    dto = service.to_site_visit_read(visit)
    return build_success_response(data=dto.model_dump(mode="json"), message="Site visit created successfully.")


@router.get("/hrms/site-visits/evidence", summary="Get site visit and live tracking evidence for a date")
async def get_evidence_by_query(
    employee_id: uuid.UUID = Query(...),
    date: date = Query(...),
    service: HrmsSiteVisitService = Depends(get_site_visit_service),
    ctx: HrmsUserContext = Depends(get_hrms_user_context),
):
    ctx.require_module_access("site_visits")
    ctx.require_employee_access(employee_id)
    evidence = await service.get_regularization_evidence(employee_id=employee_id, target_date=date)
    return build_success_response(data=evidence.model_dump(mode="json"), message="Evidence retrieved successfully.")


@router.get("/hrms/site-visits/employees", summary="List active employees for site visit assignment")
async def list_site_visit_employees(
    db: AsyncSession = Depends(get_db_session),
    ctx: HrmsUserContext = Depends(get_hrms_user_context),
):
    ctx.require_module_access("site_visits")
    stmt = (
        select(User)
        .where(User.status == UserStatus.ACTIVE, User.is_active == True, User.deleted_at.is_(None))
        .order_by(User.first_name, User.username)
    )

    if not (ctx.is_admin or ctx.is_hr):
        if ctx.is_manager:
            stmt = stmt.where(User.id.in_(ctx.managed_employee_ids))
        else:
            stmt = stmt.where(User.id == ctx.user_id)

    result = await db.execute(stmt)
    users = result.scalars().all()
    data = [
        {
            "id": str(u.id),
            "username": u.username or "",
            "full_name": u.full_name,
            "first_name": u.first_name or "",
            "last_name": u.last_name or "",
            "email": u.email or "",
        }
        for u in users
    ]
    return build_success_response(data=data, message="Site visit employees retrieved successfully.")


@router.get("/hrms/site-visits/{visit_id}", summary="Get site visit by ID")
async def get_site_visit(
    visit_id: uuid.UUID,
    service: HrmsSiteVisitService = Depends(get_site_visit_service),
    ctx: HrmsUserContext = Depends(get_hrms_user_context),
):
    ctx.require_module_access("site_visits")
    allowed_ids = None if (ctx.is_admin or ctx.is_hr) else ctx.managed_employee_ids
    visit = await service.get_site_visit(
        visit_id=visit_id,
        current_user_id=ctx.user_id,
        is_admin=ctx.is_admin or ctx.is_hr,
        allowed_employee_ids=allowed_ids,
    )
    dto = service.to_site_visit_read(visit)
    return build_success_response(data=dto.model_dump(mode="json"), message="Site visit retrieved successfully.")


@router.post("/hrms/site-visits/{visit_id}/check-in", summary="Employee Check-In at Site Visit")
async def check_in_site_visit(
    visit_id: uuid.UUID,
    payload: SiteVisitCheckIn,
    service: HrmsSiteVisitService = Depends(get_site_visit_service),
    ctx: HrmsUserContext = Depends(get_hrms_user_context),
):
    ctx.require_module_access("site_visits")
    visit = await service.check_in(
        visit_id=visit_id,
        employee_id=ctx.user_id,
        is_admin=ctx.is_admin,
        payload=payload,
    )
    dto = service.to_site_visit_read(visit)
    return build_success_response(data=dto.model_dump(mode="json"), message="Checked in successfully at customer site.")


@router.post("/hrms/site-visits/{visit_id}/check-out", summary="Employee Check-Out from Site Visit")
async def check_out_site_visit(
    visit_id: uuid.UUID,
    payload: SiteVisitCheckOut,
    service: HrmsSiteVisitService = Depends(get_site_visit_service),
    ctx: HrmsUserContext = Depends(get_hrms_user_context),
):
    ctx.require_module_access("site_visits")
    visit = await service.check_out(
        visit_id=visit_id,
        employee_id=ctx.user_id,
        is_admin=ctx.is_admin,
        payload=payload,
    )
    dto = service.to_site_visit_read(visit)
    return build_success_response(data=dto.model_dump(mode="json"), message="Checked out successfully from customer site.")


# ===========================================================================
# 2. Live Tracking Endpoints
# ===========================================================================

@router.get("/hrms/tracking/active", summary="Get active live tracking session")
async def get_active_tracking(
    service: HrmsSiteVisitService = Depends(get_site_visit_service),
    ctx: HrmsUserContext = Depends(get_hrms_user_context),
):
    ctx.require_module_access("site_visits")
    session = await service.get_active_tracking_session(employee_id=ctx.user_id)
    data = service.to_tracking_session_read(session).model_dump(mode="json") if session else None
    return build_success_response(data=data, message="Active tracking session retrieved.")


@router.post("/hrms/tracking/start", status_code=status.HTTP_201_CREATED, summary="Start live tracking")
async def start_tracking(
    payload: TrackingStartPayload = TrackingStartPayload(),
    service: HrmsSiteVisitService = Depends(get_site_visit_service),
    ctx: HrmsUserContext = Depends(get_hrms_user_context),
):
    ctx.require_module_access("site_visits")
    session = await service.start_tracking(employee_id=ctx.user_id, payload=payload)
    dto = service.to_tracking_session_read(session)
    return build_success_response(data=dto.model_dump(mode="json"), message="Live tracking started successfully.")


@router.post("/hrms/tracking/points", summary="Upload periodic tracking points")
async def upload_tracking_points(
    payload: TrackingPointsBatch,
    service: HrmsSiteVisitService = Depends(get_site_visit_service),
    ctx: HrmsUserContext = Depends(get_hrms_user_context),
):
    ctx.require_module_access("site_visits")
    count = await service.record_tracking_points(
        employee_id=ctx.user_id,
        session_id=payload.session_id,
        points=payload.points,
    )
    return build_success_response(data={"recorded_count": count}, message=f"{count} tracking points recorded.")


@router.post("/hrms/tracking/{session_id}/stop", summary="Stop live tracking and process compact summary")
async def stop_tracking(
    session_id: uuid.UUID,
    payload: TrackingStopPayload = TrackingStopPayload(),
    service: HrmsSiteVisitService = Depends(get_site_visit_service),
    ctx: HrmsUserContext = Depends(get_hrms_user_context),
):
    ctx.require_module_access("site_visits")
    session = await service.stop_tracking(
        employee_id=ctx.user_id,
        session_id=session_id,
        is_admin=ctx.is_admin,
        payload=payload,
    )
    dto = service.to_tracking_session_read(session)
    return build_success_response(data=dto.model_dump(mode="json"), message="Live tracking stopped and summary saved.")


@router.get("/hrms/tracking/sessions", summary="List tracking sessions")
async def list_tracking_sessions(
    employee_id: Optional[uuid.UUID] = Query(default=None),
    date: Optional[date] = Query(default=None),
    service: HrmsSiteVisitService = Depends(get_site_visit_service),
    ctx: HrmsUserContext = Depends(get_hrms_user_context),
):
    ctx.require_module_access("site_visits")
    target_id = employee_id or ctx.user_id
    if not (ctx.is_admin or ctx.is_hr):
        ctx.require_employee_access(target_id)

    sessions = await service.list_tracking_sessions(
        current_user_id=ctx.user_id,
        is_admin=ctx.is_admin or ctx.is_hr,
        employee_id=target_id if (ctx.is_admin or ctx.is_hr or target_id != ctx.user_id) else None,
        tracking_date=date,
    )
    data = [service.to_tracking_session_read(s).model_dump(mode="json") for s in sessions]
    return build_success_response(data=data, message="Tracking sessions retrieved.")


# ===========================================================================
# 3. Attendance Regularization Evidence Linkage
# ===========================================================================

@router.get("/hrms/attendance/regularizations/{regularization_id}/evidence", summary="Get evidence for a regularization request")
async def get_regularization_evidence(
    regularization_id: uuid.UUID,
    db: AsyncSession = Depends(get_db_session),
    service: HrmsSiteVisitService = Depends(get_site_visit_service),
    ctx: HrmsUserContext = Depends(get_hrms_user_context),
):
    ctx.require_module_access("site_visits")
    reg = await db.get(HrmsAttendanceRegularization, regularization_id)
    if not reg:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Regularization request not found.",
        )

    ctx.require_employee_access(reg.employee_id)
    evidence = await service.get_regularization_evidence(employee_id=reg.employee_id, target_date=reg.attendance_date)
    return build_success_response(data=evidence.model_dump(mode="json"), message="Regularization evidence retrieved.")
