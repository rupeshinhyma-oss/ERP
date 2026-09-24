"""
HRMS Attendance Repository.

Provides data access layer for Attendance Logs, Assigned Locations, and Regularization Requests.
Encapsulates PostgreSQL database queries and transactions.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime, timezone
from typing import Any, Dict, List, Optional

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.hrms.models import (
    HrmsAttendanceLog,
    HrmsAttendancePolicy,
    HrmsEmployeeLocation,
    HrmsLocation,
    HrmsRegularizationRequest,
    LocationType,
)


class AttendanceRepository:
    """Repository handling all PostgreSQL persistence for HRMS Attendance."""

    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def get_today_log(self, user_id: uuid.UUID, today: date) -> Optional[HrmsAttendanceLog]:
        """Fetch today's latest attendance log for an employee."""
        stmt = (
            select(HrmsAttendanceLog)
            .options(selectinload(HrmsAttendanceLog.office))
            .where(
                HrmsAttendanceLog.user_id == user_id,
                HrmsAttendanceLog.attendance_date == today,
            )
            .order_by(HrmsAttendanceLog.created_at.desc())
        )
        res = await self.db.execute(stmt)
        return res.scalars().first()

    async def get_open_log_today(self, user_id: uuid.UUID, today: date) -> Optional[HrmsAttendanceLog]:
        """Fetch currently active OPEN punch log for today."""
        stmt = (
            select(HrmsAttendanceLog)
            .options(selectinload(HrmsAttendanceLog.office))
            .where(
                HrmsAttendanceLog.user_id == user_id,
                HrmsAttendanceLog.attendance_date == today,
                HrmsAttendanceLog.status == "OPEN",
            )
        )
        res = await self.db.execute(stmt)
        return res.scalar_one_or_none()

    async def get_month_logs(self, user_id: uuid.UUID, year: int, month: int) -> List[HrmsAttendanceLog]:
        """Fetch all attendance logs for an employee for a specific year and month."""
        stmt = (
            select(HrmsAttendanceLog)
            .options(selectinload(HrmsAttendanceLog.office))
            .where(
                HrmsAttendanceLog.user_id == user_id,
                func.extract("year", HrmsAttendanceLog.attendance_date) == year,
                func.extract("month", HrmsAttendanceLog.attendance_date) == month,
            )
            .order_by(HrmsAttendanceLog.attendance_date.asc())
        )
        res = await self.db.execute(stmt)
        return list(res.scalars().all())

    async def get_assigned_office(self, user_id: uuid.UUID) -> HrmsLocation:
        """
        Get the assigned office for the user.
        If user has a primary assigned location, return that.
        Otherwise return the default active office (Inhyma Thane Office),
        seeding it if none exists in the database.
        """
        # 1. Primary assignment
        stmt = (
            select(HrmsEmployeeLocation)
            .options(selectinload(HrmsEmployeeLocation.location))
            .where(
                HrmsEmployeeLocation.user_id == user_id,
                HrmsEmployeeLocation.is_primary == True,
            )
        )
        res = await self.db.execute(stmt)
        assignment = res.scalar_one_or_none()
        if assignment and assignment.location and assignment.location.is_active:
            return assignment.location

        # 2. Match Thane or first active location
        stmt_loc = (
            select(HrmsLocation)
            .where(
                HrmsLocation.is_active == True,
                HrmsLocation.deleted_at.is_(None),
            )
            .order_by(
                HrmsLocation.name.ilike("%Thane%").desc(),
                HrmsLocation.created_at.asc(),
            )
        )
        res_loc = await self.db.execute(stmt_loc)
        office = res_loc.scalars().first()
        if office:
            return office

        # 3. Seed Inhyma Thane Office
        default_loc = HrmsLocation(
            name="Inhyma Thane Office",
            location_type=LocationType.OFFICE,
            address="Office No 421, 4th Floor, Lodha Supremus, Road Number 22, Wagle Industrial Estate, Thane West, Maharashtra 400604",
            latitude=19.198300,
            longitude=72.948300,
            radius_meters=150.0,
            place_id="ChIJ_lodha_supremus_thane_421",
            is_active=True,
        )
        self.db.add(default_loc)
        await self.db.commit()
        await self.db.refresh(default_loc)
        return default_loc

    async def create_punch_in(
        self,
        user_id: uuid.UUID,
        today: date,
        check_in_time: datetime,
        office_id: Optional[uuid.UUID],
        latitude: float,
        longitude: float,
        punch_in_str: str,
        workplace: str,
        final_status: str,
        rule_triggered: Optional[str],
        is_irregular: bool,
        late_mark: bool,
        half_day: bool,
    ) -> HrmsAttendanceLog:
        """Create and persist an OPEN attendance record."""
        log = HrmsAttendanceLog(
            user_id=user_id,
            attendance_date=today,
            check_in_time=check_in_time,
            office_id=office_id,
            latitude=latitude,
            longitude=longitude,
            punch_type="CHECK_IN",
            status="OPEN",
            final_status=final_status,
            rule_triggered=rule_triggered,
            punch_in=punch_in_str,
            workplace=workplace,
            is_irregular=is_irregular,
            late_mark=late_mark,
            half_day=half_day,
            regularization_status=None,
        )
        self.db.add(log)
        await self.db.commit()
        await self.db.refresh(log)
        await self.db.refresh(log, ["office"])
        return log

    async def close_punch_out(
        self,
        log: HrmsAttendanceLog,
        check_out_time: datetime,
        punch_out_str: str,
        total_work_minutes: int,
        total_hours_str: str,
        final_status: Optional[str] = None,
        is_irregular: Optional[bool] = None,
        half_day: Optional[bool] = None,
    ) -> HrmsAttendanceLog:
        """Mark an open attendance record as CLOSED with check-out details."""
        log.check_out_time = check_out_time
        log.punch_out = punch_out_str
        log.total_work_minutes = total_work_minutes
        log.total_hours = total_hours_str
        log.punch_type = "CHECK_OUT"
        log.status = "CLOSED"
        if final_status is not None:
            log.final_status = final_status
        if is_irregular is not None:
            log.is_irregular = is_irregular
        if half_day is not None:
            log.half_day = half_day

        await self.db.commit()
        await self.db.refresh(log)
        await self.db.refresh(log, ["office"])
        return log
