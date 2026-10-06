"""
HRMS Site Visit & Live Tracking Service.

Business logic for:
- Admin-created site visits (assigned to specific employees)
- Employee Check-In & Check-Out with GPS location verification
- Completely separate Live Tracking sessions with periodic temporary GPS point buffering
- Compact route summary processing and temporary points cleanup upon Stop Tracking
- Evidence linkage for Attendance Regularization
"""

from __future__ import annotations

from datetime import date, datetime, timezone
import math
from typing import List, Optional
import uuid

from fastapi import HTTPException, status
from sqlalchemy import delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.hrms.models import (
    HrmsLiveTrackingSession,
    HrmsSiteVisit,
    HrmsSiteVisitCheckIn,
    HrmsTrackingPoint,
)
from app.hrms.schemas import (
    RegularizationEvidenceRead,
    SiteVisitCheckIn,
    SiteVisitCheckOut,
    SiteVisitCreate,
    SiteVisitRead,
    TrackingPointItem,
    TrackingSessionRead,
    TrackingStartPayload,
    TrackingStopPayload,
)
from app.users.models import User


def haversine_distance_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculate the great circle distance between two points in kilometers."""
    R = 6371.0  # Earth radius in kilometers
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (
        math.sin(dlat / 2.0) ** 2
        + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2.0) ** 2
    )
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))
    return R * c


class HrmsSiteVisitService:
    def __init__(self, db: AsyncSession):
        self.db = db

    # =======================================================================
    # DTO Helpers
    # =======================================================================

    def to_site_visit_read(self, v: HrmsSiteVisit) -> SiteVisitRead:
        emp_name = None
        emp_email = None
        if v.employee:
            first = v.employee.first_name or ""
            last = v.employee.last_name or ""
            emp_name = f"{first} {last}".strip() or v.employee.username
            emp_email = v.employee.email

        creator_name = None
        if v.creator:
            first = v.creator.first_name or ""
            last = v.creator.last_name or ""
            creator_name = f"{first} {last}".strip() or v.creator.username

        ts_dto = None
        tr_status = "Not Started"
        if hasattr(v, "tracking_sessions") and v.tracking_sessions:
            latest_ts = v.tracking_sessions[-1]
            ts_dto = self.to_tracking_session_read(latest_ts)
            if latest_ts.status == "ACTIVE":
                tr_status = "Tracking Active"
            elif latest_ts.status in ("COMPLETED", "STOPPED"):
                dist_km = latest_ts.approx_distance_km or 0.0
                pts_ct = latest_ts.total_points or (len(latest_ts.route_summary) if latest_ts.route_summary else 0)
                if dist_km > 0:
                    tr_status = f"Completed ({dist_km} km)"
                elif pts_ct > 0:
                    tr_status = f"Completed ({pts_ct} pts)"
                else:
                    tr_status = "Completed"
            else:
                tr_status = latest_ts.status

        return SiteVisitRead(
            id=v.id,
            employee_id=v.employee_id,
            employee_name=emp_name,
            employee_email=emp_email,
            customer_name=v.customer_name,
            customer_site_name=v.customer_name,
            site_address=v.site_address,
            site_latitude=v.site_latitude,
            site_longitude=v.site_longitude,
            visit_date=v.visit_date,
            planned_start_time=v.planned_start_time,
            planned_end_time=v.planned_end_time,
            status=v.status,
            notes=v.notes,
            check_in_time=v.check_in_time,
            check_in_latitude=v.check_in_latitude,
            check_in_longitude=v.check_in_longitude,
            check_in_accuracy=v.check_in_accuracy,
            check_in_address=v.check_in_address,
            check_out_time=v.check_out_time,
            check_out_latitude=v.check_out_latitude,
            check_out_longitude=v.check_out_longitude,
            check_out_accuracy=v.check_out_accuracy,
            check_out_address=v.check_out_address,
            tracking_status=tr_status,
            tracking_session=ts_dto,
            is_simulated=bool(v.notes and ("SIMULATED" in v.notes.upper() or "TEST" in v.notes.upper())),
            created_by=v.created_by,
            created_by_name=creator_name,
            created_at=v.created_at,
            updated_at=v.updated_at,
        )

    def to_tracking_session_read(self, s: HrmsLiveTrackingSession) -> TrackingSessionRead:
        emp_name = None
        if s.employee:
            first = s.employee.first_name or ""
            last = s.employee.last_name or ""
            emp_name = f"{first} {last}".strip() or s.employee.username

        cust_name = None
        if s.site_visit:
            cust_name = s.site_visit.customer_name

        total_pts = s.total_points or 0
        if not total_pts:
            if s.route_summary:
                total_pts = len(s.route_summary)
            elif hasattr(s, "points") and s.points:
                total_pts = len(s.points)

        duration_mins = s.total_duration_minutes
        duration_secs = (duration_mins * 60) if duration_mins else 0
        if s.status == "ACTIVE" and s.start_time:
            now = datetime.now(timezone.utc)
            duration_secs = max(0, int((now - s.start_time).total_seconds()))
            duration_mins = max(0, duration_secs // 60)

        start_lat = s.start_latitude or (s.start_location.get("latitude") if isinstance(s.start_location, dict) else None)
        start_lng = s.start_longitude or (s.start_location.get("longitude") if isinstance(s.start_location, dict) else None)
        end_lat = s.end_latitude or (s.end_location.get("latitude") if isinstance(s.end_location, dict) else None)
        end_lng = s.end_longitude or (s.end_location.get("longitude") if isinstance(s.end_location, dict) else None)

        return TrackingSessionRead(
            id=s.id,
            employee_id=s.employee_id,
            employee_name=emp_name,
            site_visit_id=s.site_visit_id,
            customer_name=cust_name,
            customer_site_name=cust_name,
            tracking_date=s.tracking_date,
            status=s.status,
            start_time=s.start_time,
            end_time=s.end_time,
            total_duration_minutes=duration_mins,
            total_duration_seconds=duration_secs,
            approx_distance_km=s.approx_distance_km or 0.0,
            approximate_distance_km=s.approx_distance_km or 0.0,
            total_points=total_pts,
            points_count=total_pts,
            start_latitude=start_lat,
            start_longitude=start_lng,
            end_latitude=end_lat,
            end_longitude=end_lng,
            start_location=s.start_location,
            route_summary=s.route_summary or [],
            is_active=(s.status == "ACTIVE"),
            is_simulated=bool(
                (isinstance(s.start_location, dict) and s.start_location.get("is_simulated"))
                or (isinstance(s.end_location, dict) and s.end_location.get("is_simulated"))
            ),
            created_at=s.created_at,
        )

    # =======================================================================
    # 1. Site Visits (Admin Created)
    # =======================================================================

    async def create_site_visit(
        self,
        creator_id: uuid.UUID,
        is_admin: bool,
        payload: SiteVisitCreate,
        allowed_employee_ids: Optional[set[uuid.UUID]] = None,
    ) -> HrmsSiteVisit:
        """Only Admin / authorized HR role / Department Manager can create Site Visits."""
        if not is_admin:
            if allowed_employee_ids is None or payload.employee_id not in allowed_employee_ids:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="You do not have permission to create or assign Site Visits for this employee.",
                )

        emp = await self.db.get(User, payload.employee_id)
        if not emp:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Assigned employee does not exist.",
            )

        cust_name = (payload.customer_name or payload.customer_site_name or "").strip()
        visit = HrmsSiteVisit(
            employee_id=payload.employee_id,
            customer_name=cust_name,
            site_address=payload.site_address.strip(),
            site_latitude=payload.site_latitude,
            site_longitude=payload.site_longitude,
            visit_date=payload.visit_date,
            planned_start_time=payload.planned_start_time.strip(),
            planned_end_time=payload.planned_end_time.strip(),
            status="SCHEDULED",
            notes=payload.notes.strip() if payload.notes else None,
            created_by=creator_id,
        )
        self.db.add(visit)
        await self.db.commit()
        await self.db.refresh(visit)
        return visit

    async def list_site_visits(
        self,
        current_user_id: uuid.UUID,
        is_admin: bool,
        employee_id: Optional[uuid.UUID] = None,
        visit_date: Optional[date] = None,
        status_filter: Optional[str] = None,
        search: Optional[str] = None,
        is_manager: bool = False,
        allowed_employee_ids: Optional[set[uuid.UUID]] = None,
    ) -> List[HrmsSiteVisit]:
        """
        List site visits with strict RBAC:
        - Admin/HR can see all visits or filter by employee/date
        - Department Manager can see visits of their department employees
        - Normal employee sees strictly visits assigned to them
        """
        stmt = (
            select(HrmsSiteVisit)
            .options(
                selectinload(HrmsSiteVisit.employee),
                selectinload(HrmsSiteVisit.creator),
                selectinload(HrmsSiteVisit.tracking_sessions),
            )
            .where(HrmsSiteVisit.deleted_at.is_(None))
        )

        if is_admin:
            if employee_id:
                stmt = stmt.where(HrmsSiteVisit.employee_id == employee_id)
        elif is_manager:
            if employee_id:
                if allowed_employee_ids is None or employee_id not in allowed_employee_ids:
                    raise HTTPException(
                        status_code=status.HTTP_403_FORBIDDEN,
                        detail="You cannot view site visits of employees outside your department.",
                    )
                stmt = stmt.where(HrmsSiteVisit.employee_id == employee_id)
            else:
                mgr_allowed = allowed_employee_ids or {current_user_id}
                stmt = stmt.where(HrmsSiteVisit.employee_id.in_(mgr_allowed))
        else:
            if employee_id and employee_id != current_user_id:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="You do not have access to view site visits of other employees.",
                )
            stmt = stmt.where(HrmsSiteVisit.employee_id == current_user_id)

        if visit_date:
            stmt = stmt.where(HrmsSiteVisit.visit_date == visit_date)

        if status_filter and status_filter.upper() != "ALL":
            stmt = stmt.where(HrmsSiteVisit.status == status_filter.upper())

        if search and search.strip():
            term = f"%{search.strip()}%"
            stmt = stmt.where(
                or_(
                    HrmsSiteVisit.customer_name.ilike(term),
                    HrmsSiteVisit.site_address.ilike(term),
                    HrmsSiteVisit.notes.ilike(term),
                )
            )

        stmt = stmt.order_by(HrmsSiteVisit.visit_date.desc(), HrmsSiteVisit.created_at.desc())
        res = await self.db.execute(stmt)
        return list(res.scalars().all())

    async def get_site_visit(
        self,
        visit_id: uuid.UUID,
        current_user_id: uuid.UUID,
        is_admin: bool,
        allowed_employee_ids: Optional[set[uuid.UUID]] = None,
    ) -> HrmsSiteVisit:
        """Fetch single site visit ensuring employee data isolation."""
        stmt = (
            select(HrmsSiteVisit)
            .options(
                selectinload(HrmsSiteVisit.employee),
                selectinload(HrmsSiteVisit.creator),
                selectinload(HrmsSiteVisit.tracking_sessions),
            )
            .where(HrmsSiteVisit.id == visit_id, HrmsSiteVisit.deleted_at.is_(None))
        )
        res = await self.db.execute(stmt)
        visit = res.scalar_one_or_none()
        if not visit:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Site visit not found.",
            )

        can_view = is_admin or (visit.employee_id == current_user_id) or (
            allowed_employee_ids is not None and visit.employee_id in allowed_employee_ids
        )
        if not can_view:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You do not have access to view this site visit.",
            )

        return visit

    # =======================================================================
    # 2. Check-In & Check-Out
    # =======================================================================

    async def check_in(
        self,
        visit_id: uuid.UUID,
        employee_id: uuid.UUID,
        is_admin: bool,
        payload: SiteVisitCheckIn,
    ) -> HrmsSiteVisit:
        """Record employee check-in with GPS location proof."""
        visit = await self.get_site_visit(visit_id, employee_id, is_admin)

        if not is_admin and visit.employee_id != employee_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You can only check into your own assigned visits.",
            )

        now = datetime.now(timezone.utc)
        visit.check_in_time = now
        visit.check_in_latitude = payload.latitude
        visit.check_in_longitude = payload.longitude
        visit.check_in_accuracy = payload.accuracy
        visit.check_in_address = payload.address.strip() if payload.address else "Location Captured"
        visit.status = "CHECKED_IN"

        # Record check-in event in persistent log
        checkin_log = HrmsSiteVisitCheckIn(
            site_visit_id=visit.id,
            employee_id=employee_id,
            event_type="CHECK_IN",
            latitude=payload.latitude,
            longitude=payload.longitude,
            accuracy=payload.accuracy,
            address=visit.check_in_address,
            captured_at=now,
        )
        self.db.add(checkin_log)

        await self.db.commit()
        await self.db.refresh(visit)
        return visit

    async def check_out(
        self,
        visit_id: uuid.UUID,
        employee_id: uuid.UUID,
        is_admin: bool,
        payload: SiteVisitCheckOut,
    ) -> HrmsSiteVisit:
        """Record employee check-out with GPS location proof."""
        visit = await self.get_site_visit(visit_id, employee_id, is_admin)

        if not is_admin and visit.employee_id != employee_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You can only check out of your own assigned visits.",
            )

        now = datetime.now(timezone.utc)
        visit.check_out_time = now
        visit.check_out_latitude = payload.latitude
        visit.check_out_longitude = payload.longitude
        visit.check_out_accuracy = payload.accuracy
        visit.check_out_address = payload.address.strip() if payload.address else "Location Captured"
        visit.status = "COMPLETED"

        # Record check-out event in persistent log
        checkout_log = HrmsSiteVisitCheckIn(
            site_visit_id=visit.id,
            employee_id=employee_id,
            event_type="CHECK_OUT",
            latitude=payload.latitude,
            longitude=payload.longitude,
            accuracy=payload.accuracy,
            address=visit.check_out_address,
            captured_at=now,
        )
        self.db.add(checkout_log)

        await self.db.commit()
        await self.db.refresh(visit)
        return visit

    # =======================================================================
    # 3. Live Tracking (Separate Optional Workflow)
    # =======================================================================

    async def get_active_tracking_session(
        self,
        employee_id: uuid.UUID,
    ) -> Optional[HrmsLiveTrackingSession]:
        """Retrieve currently active live tracking session for an employee."""
        stmt = (
            select(HrmsLiveTrackingSession)
            .options(
                selectinload(HrmsLiveTrackingSession.employee),
                selectinload(HrmsLiveTrackingSession.site_visit),
                selectinload(HrmsLiveTrackingSession.points),
            )
            .where(
                HrmsLiveTrackingSession.employee_id == employee_id,
                HrmsLiveTrackingSession.status == "ACTIVE",
            )
            .order_by(HrmsLiveTrackingSession.start_time.desc())
            .limit(1)
        )
        res = await self.db.execute(stmt)
        session = res.scalar_one_or_none()
        if session:
            # Sync total_points from points count
            pts_count = len(session.points) if session.points else 0
            session.total_points = pts_count
        return session

    async def start_tracking(
        self,
        employee_id: uuid.UUID,
        payload: TrackingStartPayload,
    ) -> HrmsLiveTrackingSession:
        """Start a new Live Tracking session."""
        now = datetime.now(timezone.utc)

        # If an active session exists, return it
        active = await self.get_active_tracking_session(employee_id)
        if active:
            return active

        # Link to site visit ONLY if explicitly provided in payload (completely optional)
        site_visit_id = payload.site_visit_id

        start_lat = None
        start_lng = None
        if payload.start_location and "latitude" in payload.start_location and "longitude" in payload.start_location:
            try:
                start_lat = float(payload.start_location["latitude"])
                start_lng = float(payload.start_location["longitude"])
            except (ValueError, TypeError):
                pass

        session = HrmsLiveTrackingSession(
            employee_id=employee_id,
            site_visit_id=site_visit_id,
            tracking_date=now.date(),
            status="ACTIVE",
            start_time=now,
            start_location=payload.start_location,
            start_latitude=start_lat,
            start_longitude=start_lng,
            total_points=0,
            approx_distance_km=0.0,
            total_duration_minutes=0,
            route_summary=[],
        )
        self.db.add(session)
        await self.db.flush()

        # If start location has lat/lng, record as the first point in PostgreSQL
        if start_lat is not None and start_lng is not None:
            pt = HrmsTrackingPoint(
                session_id=session.id,
                employee_id=employee_id,
                latitude=start_lat,
                longitude=start_lng,
                accuracy=float(payload.start_location.get("accuracy", 0.0)) if payload.start_location.get("accuracy") else None,
                recorded_at=now,
            )
            self.db.add(pt)
            session.total_points = 1
            session.route_summary = [
                {
                    "lat": round(start_lat, 6),
                    "lng": round(start_lng, 6),
                    "accuracy": pt.accuracy,
                    "time": now.isoformat(),
                }
            ]

        await self.db.commit()
        await self.db.refresh(session)
        return session

    async def record_tracking_points(
        self,
        employee_id: uuid.UUID,
        session_id: uuid.UUID,
        points: List[TrackingPointItem],
    ) -> int:
        """Batch record tracking points while session is active."""
        if not points:
            return 0

        session = await self.db.get(HrmsLiveTrackingSession, session_id)
        if not session or session.status != "ACTIVE":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Active tracking session not found.",
            )

        if session.employee_id != employee_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Cannot submit tracking points to another employee's session.",
            )

        now = datetime.now(timezone.utc)
        records = []
        for pt in points:
            records.append(
                HrmsTrackingPoint(
                    session_id=session_id,
                    employee_id=employee_id,
                    latitude=pt.latitude,
                    longitude=pt.longitude,
                    accuracy=pt.accuracy,
                    recorded_at=pt.recorded_at or now,
                )
            )

        self.db.add_all(records)
        await self.db.flush()

        # Update point count on session
        count_stmt = select(func.count(HrmsTrackingPoint.id)).where(HrmsTrackingPoint.session_id == session_id)
        total_count = (await self.db.execute(count_stmt)).scalar() or 0
        session.total_points = total_count

        await self.db.commit()
        return len(records)

    async def stop_tracking(
        self,
        employee_id: uuid.UUID,
        session_id: uuid.UUID,
        is_admin: bool,
        payload: TrackingStopPayload,
    ) -> HrmsLiveTrackingSession:
        """
        Stop tracking session:
        1. Calculate duration and total approximate distance (Haversine formula).
        2. Build compact permanent route summary and save start/end coordinates.
        3. Persist summary on HrmsLiveTrackingSession with status COMPLETED.
        """
        stmt = (
            select(HrmsLiveTrackingSession)
            .options(
                selectinload(HrmsLiveTrackingSession.employee),
                selectinload(HrmsLiveTrackingSession.site_visit),
                selectinload(HrmsLiveTrackingSession.points),
            )
            .where(HrmsLiveTrackingSession.id == session_id)
        )
        res = await self.db.execute(stmt)
        session = res.scalar_one_or_none()
        if not session:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Tracking session not found.",
            )

        if not is_admin and session.employee_id != employee_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You cannot stop another employee's tracking session.",
            )

        if session.status in ("COMPLETED", "STOPPED"):
            return session

        now = datetime.now(timezone.utc)
        session.end_time = now
        session.status = "COMPLETED"

        # Calculate duration
        duration_mins = max(1, int((now - session.start_time).total_seconds() / 60))
        session.total_duration_minutes = duration_mins

        # Fetch all points in chronological order
        pts_stmt = (
            select(HrmsTrackingPoint)
            .where(HrmsTrackingPoint.session_id == session_id)
            .order_by(HrmsTrackingPoint.recorded_at.asc())
        )
        pts_res = await self.db.execute(pts_stmt)
        points = list(pts_res.scalars().all())

        total_distance = 0.0
        route_summary = []

        if points:
            for i in range(len(points)):
                cur = points[i]
                route_summary.append(
                    {
                        "lat": round(cur.latitude, 6),
                        "lng": round(cur.longitude, 6),
                        "accuracy": cur.accuracy,
                        "time": cur.recorded_at.isoformat(),
                    }
                )
                if i > 0:
                    prev = points[i - 1]
                    dist = haversine_distance_km(prev.latitude, prev.longitude, cur.latitude, cur.longitude)
                    total_distance += dist

            if not session.start_location:
                session.start_location = {
                    "latitude": points[0].latitude,
                    "longitude": points[0].longitude,
                    "accuracy": points[0].accuracy,
                }
            session.start_latitude = points[0].latitude
            session.start_longitude = points[0].longitude

            session.end_location = {
                "latitude": points[-1].latitude,
                "longitude": points[-1].longitude,
                "accuracy": points[-1].accuracy,
            }
            session.end_latitude = points[-1].latitude
            session.end_longitude = points[-1].longitude
            session.total_points = len(points)
        elif payload.end_location:
            session.end_location = payload.end_location
            if "latitude" in payload.end_location and "longitude" in payload.end_location:
                session.end_latitude = float(payload.end_location["latitude"])
                session.end_longitude = float(payload.end_location["longitude"])

        session.approx_distance_km = round(total_distance, 2)
        session.route_summary = route_summary

        await self.db.commit()
        await self.db.refresh(session)
        return session

    async def list_tracking_sessions(
        self,
        current_user_id: uuid.UUID,
        is_admin: bool,
        employee_id: Optional[uuid.UUID] = None,
        tracking_date: Optional[date] = None,
    ) -> List[HrmsLiveTrackingSession]:
        """List tracking sessions with RBAC scoping."""
        stmt = (
            select(HrmsLiveTrackingSession)
            .options(selectinload(HrmsLiveTrackingSession.employee), selectinload(HrmsLiveTrackingSession.site_visit))
        )

        if not is_admin:
            stmt = stmt.where(HrmsLiveTrackingSession.employee_id == current_user_id)
        else:
            if employee_id:
                stmt = stmt.where(HrmsLiveTrackingSession.employee_id == employee_id)

        if tracking_date:
            stmt = stmt.where(HrmsLiveTrackingSession.tracking_date == tracking_date)

        stmt = stmt.order_by(HrmsLiveTrackingSession.start_time.desc())
        res = await self.db.execute(stmt)
        return list(res.scalars().all())

    # =======================================================================
    # 4. Evidence Linkage for Attendance Regularization
    # =======================================================================

    async def get_regularization_evidence(
        self,
        employee_id: uuid.UUID,
        target_date: date,
    ) -> RegularizationEvidenceRead:
        """
        Aggregate Site Visit and Live Tracking evidence for an employee on a given date.
        Displayed to Admin/HR reviewing attendance regularization.
        """
        # 1. Fetch employee
        emp = await self.db.get(User, employee_id)
        emp_name = None
        if emp:
            first = emp.first_name or ""
            last = emp.last_name or ""
            emp_name = f"{first} {last}".strip() or emp.username

        # 2. Fetch site visits for that date
        v_stmt = (
            select(HrmsSiteVisit)
            .options(selectinload(HrmsSiteVisit.employee), selectinload(HrmsSiteVisit.creator))
            .where(
                HrmsSiteVisit.employee_id == employee_id,
                HrmsSiteVisit.visit_date == target_date,
                HrmsSiteVisit.deleted_at.is_(None),
            )
            .order_by(HrmsSiteVisit.planned_start_time.asc())
        )
        v_res = await self.db.execute(v_stmt)
        visits = [self.to_site_visit_read(v) for v in v_res.scalars().all()]

        # 3. Fetch tracking sessions for that date
        t_stmt = (
            select(HrmsLiveTrackingSession)
            .options(selectinload(HrmsLiveTrackingSession.employee), selectinload(HrmsLiveTrackingSession.site_visit))
            .where(
                HrmsLiveTrackingSession.employee_id == employee_id,
                HrmsLiveTrackingSession.tracking_date == target_date,
            )
            .order_by(HrmsLiveTrackingSession.start_time.asc())
        )
        t_res = await self.db.execute(t_stmt)
        trackings = [self.to_tracking_session_read(t) for t in t_res.scalars().all()]

        return RegularizationEvidenceRead(
            employee_id=employee_id,
            employee_name=emp_name,
            date=target_date,
            site_visits=visits,
            tracking_sessions=trackings,
        )
