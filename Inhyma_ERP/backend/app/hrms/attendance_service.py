"""
HRMS Attendance Service Layer (Day 3).

Core business logic for Employee Attendance:
- Geofence validation using the Haversine formula
- Configurable Attendance Policy (Shift start, end, grace time, half-day threshold)
- Automated status calculation:
    - Before 10:45 AM (shift_start + grace): PRESENT
    - After 10:45 AM: LATE
    - After 11:30 AM: HALF_DAY
    - Missing Punch & Early Exit detection
- Live working timer persistence
- Monthly Attendance Calendar matrix with selective regularization triggers
"""

from __future__ import annotations

import calendar
import math
import uuid
from datetime import date, datetime, time, timedelta, timezone
from typing import List, Optional

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import BadRequestException, NotFoundException
from app.hrms.models import (
    HrmsAttendance,
    HrmsAttendancePolicy,
    HrmsAttendanceRegularization,
    HrmsEmployeeLocation,
    HrmsLocation,
)
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
from app.users.models import User

# Indian Standard Time (Asia/Kolkata) used organization-wide (single timezone source, no hardcoded offsets)
try:
    from zoneinfo import ZoneInfo
    IST = ZoneInfo("Asia/Kolkata")
except Exception:
    IST = timezone(timedelta(hours=5, minutes=30))


def to_ist(dt: datetime | None) -> datetime | None:
    """Ensure datetime is converted to Indian Standard Time (Asia/Kolkata)."""
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(IST)


def format_time_ist(dt: datetime | None) -> str | None:
    """Format datetime into IST 12-hour string (e.g. '10:30 AM')."""
    ist_dt = to_ist(dt)
    return ist_dt.strftime("%I:%M %p") if ist_dt else None


def haversine_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """
    Calculate the great-circle distance between two points on Earth in meters.
    Uses the Haversine formula.
    """
    R = 6371000.0  # Earth radius in meters
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)

    a = (
        math.sin(delta_phi / 2.0) ** 2
        + math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda / 2.0) ** 2
    )
    c = 2.0 * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))
    return R * c


def compute_policy_timings(shift_start: str, grace_minutes: int) -> tuple[str, str]:
    """Compute auto-calculated grace end time and late start time."""
    try:
        sh, sm = map(int, shift_start.split(":"))
        total_m = sh * 60 + sm + grace_minutes
        grace_end_h = (total_m // 60) % 24
        grace_end_m = total_m % 60
        grace_end_str = f"{grace_end_h:02d}:{grace_end_m:02d}"

        late_total_m = total_m + 1
        late_start_h = (late_total_m // 60) % 24
        late_start_m = late_total_m % 60
        late_start_str = f"{late_start_h:02d}:{late_start_m:02d}"
        return grace_end_str, late_start_str
    except Exception:
        return "10:45", "10:46"


def parse_time_on_date(target_date: date, time_str: str | None) -> datetime | None:
    """Parse time string (e.g. '10:30', '10:30 AM') on a given date into IST datetime."""
    if not time_str or not time_str.strip():
        return None
    s = time_str.strip()
    for fmt in ("%H:%M", "%H:%M:%S", "%I:%M %p", "%I:%M%p", "%I:%M:%S %p"):
        try:
            parsed = datetime.strptime(s, fmt).time()
            naive = datetime.combine(target_date, parsed)
            return naive.replace(tzinfo=IST)
        except ValueError:
            continue
    return None


class HrmsAttendanceService:
    def __init__(self, db: AsyncSession):
        self.db = db

    # -----------------------------------------------------------------------
    # Policy Management (Configurable)
    # -----------------------------------------------------------------------
    async def ensure_policy_seed(self) -> HrmsAttendancePolicy:
        """Seed default organizational Attendance Policy if none exists."""
        res = await self.db.execute(select(HrmsAttendancePolicy).limit(1))
        policy = res.scalar_one_or_none()
        if not policy:
            policy = HrmsAttendancePolicy(
                shift_name="General Shift",
                shift_start_time="10:30",
                shift_end_time="19:00",
                weekly_off="Sunday",
                payroll_cycle="1st-End of Month",
                geofence_radius_meters=150.0,
                enable_grace=True,
                grace_period_minutes=15,
                grace_end_time="10:45",
                enable_late_marks=True,
                late_start_time="10:46",
                count_late_monthly=True,
                monthly_late_limit=3,
                third_late_action="Half Day",
                enable_direct_half_day=True,
                direct_half_day_time="11:31",
                half_day_threshold_minutes=60,
                enable_early_exit=True,
                early_exit_buffer_minutes=15,
                mark_early_exit=True,
                auto_regularization_early_exit=True,
                missing_punch_out=True,
                missing_punch_in=True,
                auto_mark_irregular=True,
                require_regularization=True,
                consecutive_late_warning=False,
                auto_email_notification=False,
                auto_manager_notification=False,
                holiday_overtime=False,
                weekend_overtime=False,
                flexible_shift=False,
                grace_extension=False,
            )
            self.db.add(policy)
            await self.db.commit()
            await self.db.refresh(policy)
        else:
            # Ensure any missing null defaults from previous versions are populated
            changed = False
            if not policy.shift_name:
                policy.shift_name = "General Shift"
                changed = True
            if not policy.weekly_off:
                policy.weekly_off = "Sunday"
                changed = True
            if not policy.payroll_cycle:
                policy.payroll_cycle = "1st-End of Month"
                changed = True
            if not policy.grace_end_time:
                policy.grace_end_time = "10:45"
                changed = True
            if not policy.late_start_time:
                policy.late_start_time = "10:46"
                changed = True
            if not policy.third_late_action:
                policy.third_late_action = "Half Day"
                changed = True
            if not policy.direct_half_day_time:
                policy.direct_half_day_time = "11:31"
                changed = True
            if changed:
                await self.db.commit()
                await self.db.refresh(policy)
        return policy

    async def get_policy(self) -> HrmsAttendancePolicy:
        return await self.ensure_policy_seed()

    async def update_policy(self, payload: AttendancePolicyUpdate) -> HrmsAttendancePolicy:
        policy = await self.ensure_policy_seed()

        if payload.shift_name is not None:
            policy.shift_name = payload.shift_name
        if payload.shift_start_time is not None:
            policy.shift_start_time = payload.shift_start_time
        if payload.shift_end_time is not None:
            policy.shift_end_time = payload.shift_end_time
        if payload.weekly_off is not None:
            policy.weekly_off = payload.weekly_off
        if payload.payroll_cycle is not None:
            policy.payroll_cycle = payload.payroll_cycle
        if payload.geofence_radius_meters is not None:
            policy.geofence_radius_meters = payload.geofence_radius_meters

        if payload.enable_grace is not None:
            policy.enable_grace = payload.enable_grace
        if payload.grace_period_minutes is not None:
            policy.grace_period_minutes = payload.grace_period_minutes

        calc_grace_end, calc_late_start = compute_policy_timings(
            policy.shift_start_time, policy.grace_period_minutes
        )
        policy.grace_end_time = payload.grace_end_time or calc_grace_end
        policy.late_start_time = payload.late_start_time or calc_late_start

        if payload.enable_late_marks is not None:
            policy.enable_late_marks = payload.enable_late_marks
        if payload.count_late_monthly is not None:
            policy.count_late_monthly = payload.count_late_monthly
        if payload.monthly_late_limit is not None:
            policy.monthly_late_limit = payload.monthly_late_limit
        if payload.third_late_action is not None:
            policy.third_late_action = payload.third_late_action

        if payload.enable_direct_half_day is not None:
            policy.enable_direct_half_day = payload.enable_direct_half_day
        if payload.direct_half_day_time is not None:
            policy.direct_half_day_time = payload.direct_half_day_time
        if payload.half_day_threshold_minutes is not None:
            policy.half_day_threshold_minutes = payload.half_day_threshold_minutes

        if payload.enable_early_exit is not None:
            policy.enable_early_exit = payload.enable_early_exit
        if payload.early_exit_buffer_minutes is not None:
            policy.early_exit_buffer_minutes = payload.early_exit_buffer_minutes
        if payload.mark_early_exit is not None:
            policy.mark_early_exit = payload.mark_early_exit
        if payload.auto_regularization_early_exit is not None:
            policy.auto_regularization_early_exit = payload.auto_regularization_early_exit

        if payload.missing_punch_out is not None:
            policy.missing_punch_out = payload.missing_punch_out
        if payload.missing_punch_in is not None:
            policy.missing_punch_in = payload.missing_punch_in
        if payload.auto_mark_irregular is not None:
            policy.auto_mark_irregular = payload.auto_mark_irregular
        if payload.require_regularization is not None:
            policy.require_regularization = payload.require_regularization

        if payload.consecutive_late_warning is not None:
            policy.consecutive_late_warning = payload.consecutive_late_warning
        if payload.auto_email_notification is not None:
            policy.auto_email_notification = payload.auto_email_notification
        if payload.auto_manager_notification is not None:
            policy.auto_manager_notification = payload.auto_manager_notification
        if payload.holiday_overtime is not None:
            policy.holiday_overtime = payload.holiday_overtime
        if payload.weekend_overtime is not None:
            policy.weekend_overtime = payload.weekend_overtime
        if payload.flexible_shift is not None:
            policy.flexible_shift = payload.flexible_shift
        if payload.grace_extension is not None:
            policy.grace_extension = payload.grace_extension

        await self.db.commit()
        await self.db.refresh(policy)
        return policy

    # -----------------------------------------------------------------------
    # Assigned Office Resolution
    # -----------------------------------------------------------------------
    async def get_assigned_office(self, user_id: uuid.UUID) -> HrmsLocation:
        """
        Fetch employee's assigned office location.
        Falls back to primary assigned office, or default Thane office.
        """
        # 1. Check direct employee-location mapping
        mapping_query = (
            select(HrmsLocation)
            .join(HrmsEmployeeLocation, HrmsEmployeeLocation.location_id == HrmsLocation.id)
            .where(
                HrmsEmployeeLocation.user_id == user_id,
                HrmsLocation.deleted_at.is_(None),
                HrmsLocation.is_active.is_(True),
            )
            .order_by(HrmsEmployeeLocation.is_primary.desc())
        )
        res = await self.db.execute(mapping_query)
        loc = res.scalar_one_or_none()
        if loc:
            return loc

        # 2. Check for "Inhyma Thane Office" (case-insensitive name check)
        loc_res = await self.db.execute(
            select(HrmsLocation).where(
                HrmsLocation.name.ilike("%Thane%"),
                HrmsLocation.deleted_at.is_(None),
                HrmsLocation.is_active.is_(True),
            )
        )
        loc = loc_res.scalar_one_or_none()
        if loc:
            return loc

        # 3. Create canonical Inhyma Thane Office if not present
        default_office = HrmsLocation(
            name="Inhyma Thane Office",
            location_type="OFFICE",
            address="Office No 421, 4th Floor, Lodha Supremus, Road Number 22, Wagle Industrial Estate, Thane West, Maharashtra 400604",
            latitude=19.199824,
            longitude=72.956795,
            radius_meters=150.0,
            is_active=True,
        )
        self.db.add(default_office)
        await self.db.commit()
        await self.db.refresh(default_office)
        return default_office

    # -----------------------------------------------------------------------
    # Today's Attendance Query
    # -----------------------------------------------------------------------
    async def get_today_attendance(
        self, user_id: uuid.UUID, target_date: Optional[date] = None
    ) -> Optional[AttendanceRecordRead]:
        if target_date is None:
            target_date = datetime.now(IST).date()

        query = select(HrmsAttendance).where(
            HrmsAttendance.employee_id == user_id,
            HrmsAttendance.attendance_date == target_date,
        )
        res = await self.db.execute(query)
        rec = res.scalar_one_or_none()
        if not rec:
            return None

        office_name = None
        office_read = None
        if rec.office_location_id:
            loc = await self.db.get(HrmsLocation, rec.office_location_id)
            if loc:
                office_name = loc.name
                office_read = AssignedOfficeRead(
                    id=loc.id,
                    name=loc.name,
                    address=loc.address,
                    latitude=loc.latitude,
                    longitude=loc.longitude,
                    radius_meters=loc.radius_meters,
                )

        can_regularize = self._can_regularize_record(rec)
        punched_in = bool(rec.punch_in)
        punched_out = bool(rec.punch_out)
        working_mins = rec.working_minutes or 0
        total_hours = f"{working_mins // 60}h {working_mins % 60:02d}m" if working_mins > 0 else "0h 00m"

        return AttendanceRecordRead(
            id=rec.id,
            employee_id=rec.employee_id,
            attendance_date=rec.attendance_date.isoformat(),
            punch_in=to_ist(rec.punch_in),
            punch_out=to_ist(rec.punch_out),
            status=rec.status,
            working_minutes=working_mins,
            late_minutes=rec.late_minutes,
            early_exit_minutes=rec.early_exit_minutes,
            office_location_id=rec.office_location_id,
            office_name=office_name,
            latitude=rec.latitude,
            longitude=rec.longitude,
            punch_in_distance=rec.punch_in_distance,
            punch_out_distance=rec.punch_out_distance,
            is_irregular=rec.is_irregular,
            regularization_status=rec.regularization_status,
            regularization_reason=rec.regularization_reason,
            regularization_note=rec.regularization_note,
            can_regularize=can_regularize,
            punched_in=punched_in,
            punched_out=punched_out,
            total_hours=total_hours,
            assigned_office=office_read,
            created_at=rec.created_at,
            updated_at=rec.updated_at,
        )

    async def get_today_session_state(self, user_id: uuid.UUID) -> TodayAttendanceRead:
        today = datetime.now(IST).date()
        office = await self.get_assigned_office(user_id)
        office_read = AssignedOfficeRead(
            id=office.id,
            name=office.name,
            address=office.address,
            latitude=office.latitude,
            longitude=office.longitude,
            radius_meters=office.radius_meters,
        )

        rec = await self.get_today_attendance(user_id, today)
        if rec:
            status = "IN_PROGRESS" if (rec.punch_in and not rec.punch_out) else rec.status
            return TodayAttendanceRead(
                id=rec.id,
                employee_id=rec.employee_id,
                attendance_date=rec.attendance_date,
                punched_in=bool(rec.punch_in),
                punched_out=bool(rec.punch_out),
                status=status,
                punch_in=rec.punch_in,
                punch_out=rec.punch_out,
                total_hours=rec.total_hours or "0h 00m",
                working_minutes=rec.working_minutes or 0,
                late_minutes=rec.late_minutes,
                early_exit_minutes=rec.early_exit_minutes,
                office_location_id=rec.office_location_id,
                office_name=rec.office_name or office.name,
                assigned_office=office_read,
                is_irregular=rec.is_irregular,
                regularization_status=rec.regularization_status,
                can_regularize=rec.can_regularize,
                attendance_record=rec,
            )

        return TodayAttendanceRead(
            attendance_date=today.isoformat(),
            punched_in=False,
            punched_out=False,
            status="NOT_PUNCHED",
            punch_in=None,
            punch_out=None,
            total_hours="0h 00m",
            working_minutes=0,
            late_minutes=0,
            early_exit_minutes=0,
            office_location_id=office.id,
            office_name=office.name,
            assigned_office=office_read,
            is_irregular=False,
            regularization_status="NONE",
            can_regularize=False,
            attendance_record=None,
        )

    # -----------------------------------------------------------------------
    # Punch In Flow
    # -----------------------------------------------------------------------
    async def punch_in(self, user_id: uuid.UUID, payload: PunchInRequest) -> AttendanceRecordRead:
        policy = await self.get_policy()
        office = await self.get_assigned_office(user_id)

        # 1. Determine punch timestamp & local date
        raw_time = payload.timestamp or datetime.now(timezone.utc)
        if raw_time.tzinfo is None:
            raw_time = raw_time.replace(tzinfo=IST)
        local_dt = raw_time.astimezone(IST)
        today = local_dt.date()

        # 2. Geofence Distance Validation
        distance = haversine_distance(
            payload.latitude, payload.longitude, office.latitude, office.longitude
        )
        allowed_radius = office.radius_meters or policy.geofence_radius_meters

        if distance > allowed_radius:
            raise BadRequestException(
                f"Outside geofence: You are {round(distance)}m from {office.name} (allowed: {int(allowed_radius)}m)."
            )

        # 3. Duplicate punch check
        existing = await self.get_today_attendance(user_id, today)
        if existing and existing.punch_in:
            raise BadRequestException("Already punched in for today.")

        # 4. Status determination based on Configurable Policy Engine
        start_h, start_m = map(int, policy.shift_start_time.split(":"))
        shift_start_mins = start_h * 60 + start_m
        current_mins = local_dt.hour * 60 + local_dt.minute

        # Check Direct Half Day Rule (Severe Late Arrival)
        direct_half_day_triggered = False
        if policy.enable_direct_half_day:
            direct_h, direct_m = map(int, policy.direct_half_day_time.split(":"))
            direct_mins = direct_h * 60 + direct_m
            if current_mins >= direct_mins:
                direct_half_day_triggered = True

        if direct_half_day_triggered:
            # Employee arriving after direct half day time immediately becomes Half Day.
            # No late count increment.
            status = "HALF_DAY"
            late_minutes = max(0, current_mins - shift_start_mins)
            is_irregular = True
        else:
            grace_mins = policy.grace_period_minutes if policy.enable_grace else 0
            grace_limit_mins = shift_start_mins + grace_mins

            if current_mins <= grace_limit_mins:
                status = "PRESENT"
                late_minutes = 0
                is_irregular = False
            else:
                # Late arrival
                late_minutes = current_mins - shift_start_mins
                is_irregular = True

                if policy.enable_late_marks and policy.count_late_monthly:
                    # Count previous late punches in current payroll month
                    month_start = date(today.year, today.month, 1)
                    count_q = select(func.count(HrmsAttendance.id)).where(
                        HrmsAttendance.employee_id == user_id,
                        HrmsAttendance.attendance_date >= month_start,
                        HrmsAttendance.attendance_date < today,
                        HrmsAttendance.status == "LATE",
                    )
                    count_res = await self.db.execute(count_q)
                    prior_lates = count_res.scalar() or 0

                    if (prior_lates + 1) >= policy.monthly_late_limit:
                        action = (policy.third_late_action or "Half Day").strip()
                        if action in ("Half Day", "Leave Deduction"):
                            status = "HALF_DAY"
                        else:
                            status = "LATE"
                    else:
                        status = "LATE"
                else:
                    status = "LATE"

        # 5. Persist record (Strictly exactly one record per employee per day)
        query = select(HrmsAttendance).where(
            HrmsAttendance.employee_id == user_id,
            HrmsAttendance.attendance_date == today,
        )
        res = await self.db.execute(query)
        record = res.scalar_one_or_none()

        if record:
            record.punch_in = local_dt
            record.status = status
            record.working_minutes = 0
            record.late_minutes = late_minutes
            record.early_exit_minutes = 0
            record.office_location_id = office.id
            record.latitude = payload.latitude
            record.longitude = payload.longitude
            record.punch_in_distance = round(distance, 1)
            record.is_irregular = is_irregular
        else:
            record = HrmsAttendance(
                employee_id=user_id,
                attendance_date=today,
                punch_in=local_dt,
                status=status,
                working_minutes=0,
                late_minutes=late_minutes,
                early_exit_minutes=0,
                office_location_id=office.id,
                latitude=payload.latitude,
                longitude=payload.longitude,
                punch_in_distance=round(distance, 1),
                is_irregular=is_irregular,
                regularization_status="NONE",
            )
            self.db.add(record)

        await self.db.commit()
        await self.db.refresh(record)

        office_read = AssignedOfficeRead(
            id=office.id,
            name=office.name,
            address=office.address,
            latitude=office.latitude,
            longitude=office.longitude,
            radius_meters=office.radius_meters,
        )

        return AttendanceRecordRead(
            id=record.id,
            employee_id=record.employee_id,
            attendance_date=record.attendance_date.isoformat(),
            punch_in=to_ist(record.punch_in),
            punch_out=None,
            status=record.status,
            working_minutes=0,
            late_minutes=record.late_minutes,
            early_exit_minutes=0,
            office_location_id=record.office_location_id,
            office_name=office.name,
            latitude=record.latitude,
            longitude=record.longitude,
            punch_in_distance=record.punch_in_distance,
            punch_out_distance=None,
            is_irregular=record.is_irregular,
            regularization_status="NONE",
            can_regularize=self._can_regularize_record(record),
            punched_in=True,
            punched_out=False,
            total_hours="0h 00m",
            assigned_office=office_read,
            created_at=record.created_at,
            updated_at=record.updated_at,
        )

    # -----------------------------------------------------------------------
    # Punch Out Flow
    # -----------------------------------------------------------------------
    async def punch_out(self, user_id: uuid.UUID, payload: PunchOutRequest) -> AttendanceRecordRead:
        policy = await self.get_policy()
        office = await self.get_assigned_office(user_id)

        raw_time = payload.timestamp or datetime.now(timezone.utc)
        if raw_time.tzinfo is None:
            raw_time = raw_time.replace(tzinfo=IST)
        local_dt = raw_time.astimezone(IST)
        today = local_dt.date()

        # 1. Fetch active punch in
        res = await self.db.execute(
            select(HrmsAttendance).where(
                HrmsAttendance.employee_id == user_id,
                HrmsAttendance.attendance_date == today,
            )
        )
        record = res.scalar_one_or_none()
        if not record or not record.punch_in:
            raise BadRequestException("Cannot punch out without punching in first.")

        if record.punch_out is not None:
            raise BadRequestException("Attendance locked: already punched out for today.")

        # 2. Calculate distance
        distance = haversine_distance(
            payload.latitude, payload.longitude, office.latitude, office.longitude
        )

        # 3. Calculate working minutes
        working_seconds = (local_dt - to_ist(record.punch_in)).total_seconds()
        working_mins = max(0, int(working_seconds / 60))
        record.working_minutes = working_mins

        # 4. Check Early Exit against shift_end_time (e.g. 19:00 = 1140 mins)
        end_h, end_m = map(int, policy.shift_end_time.split(":"))
        shift_end_mins = end_h * 60 + end_m
        current_mins = local_dt.hour * 60 + local_dt.minute

        early_exit_mins = 0
        if current_mins < shift_end_mins:
            early_exit_mins = shift_end_mins - current_mins
            record.early_exit_minutes = early_exit_mins
            record.is_irregular = True

        record.punch_out = local_dt
        record.punch_out_distance = round(distance, 1)

        await self.db.commit()
        await self.db.refresh(record)

        office_read = AssignedOfficeRead(
            id=office.id,
            name=office.name,
            address=office.address,
            latitude=office.latitude,
            longitude=office.longitude,
            radius_meters=office.radius_meters,
        )
        total_hours = f"{working_mins // 60}h {working_mins % 60:02d}m" if working_mins > 0 else "0h 00m"

        return AttendanceRecordRead(
            id=record.id,
            employee_id=record.employee_id,
            attendance_date=record.attendance_date.isoformat(),
            punch_in=to_ist(record.punch_in),
            punch_out=to_ist(record.punch_out),
            status=record.status,
            working_minutes=record.working_minutes,
            late_minutes=record.late_minutes,
            early_exit_minutes=record.early_exit_minutes,
            office_location_id=record.office_location_id,
            office_name=office.name,
            latitude=record.latitude,
            longitude=record.longitude,
            punch_in_distance=record.punch_in_distance,
            punch_out_distance=record.punch_out_distance,
            is_irregular=record.is_irregular,
            regularization_status=record.regularization_status,
            regularization_reason=record.regularization_reason,
            regularization_note=record.regularization_note,
            can_regularize=self._can_regularize_record(record),
            punched_in=True,
            punched_out=True,
            total_hours=total_hours,
            assigned_office=office_read,
            created_at=record.created_at,
            updated_at=record.updated_at,
        )

    # -----------------------------------------------------------------------
    # Monthly Attendance Calendar Matrix
    # -----------------------------------------------------------------------
    async def get_calendar(
        self, user_id: uuid.UUID, year: int, month: int
    ) -> List[CalendarDayRead]:
        _, num_days = calendar.monthrange(year, month)
        today = datetime.now(IST).date()

        start_date = date(year, month, 1)
        end_date = date(year, month, num_days)

        # Query all records for this employee in the month
        res = await self.db.execute(
            select(HrmsAttendance).where(
                HrmsAttendance.employee_id == user_id,
                HrmsAttendance.attendance_date >= start_date,
                HrmsAttendance.attendance_date <= end_date,
            )
        )
        records = res.scalars().all()
        record_map = {r.attendance_date: r for r in records}

        days_list: List[CalendarDayRead] = []

        day_names = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

        # Policy-driven Weekly Off (no hardcoded weekend detection, defaults to Sunday only)
        policy = await self.get_policy()
        weekly_off_raw = (policy.weekly_off or "Sunday").strip()
        weekly_off_days = {d.strip().capitalize() for d in weekly_off_raw.split(",") if d.strip()}
        if not weekly_off_days:
            weekly_off_days = {"Sunday"}

        for d_num in range(1, num_days + 1):
            cur_date = date(year, month, d_num)
            weekday_idx = cur_date.weekday()
            day_full_name = cur_date.strftime("%A")
            is_weekend = day_full_name in weekly_off_days

            rec = record_map.get(cur_date)

            if rec:
                status = rec.status
                if cur_date == today and rec.punch_in and not rec.punch_out and rec.status == "PRESENT":
                    status = "IN_PROGRESS"

                can_regularize = self._can_regularize_record(rec) if status != "IN_PROGRESS" else False

                days_list.append(
                    CalendarDayRead(
                        date=cur_date.isoformat(),
                        day_number=d_num,
                        day_name=day_names[weekday_idx],
                        status=status,
                        punch_in=format_time_ist(rec.punch_in),
                        punch_out=format_time_ist(rec.punch_out),
                        working_minutes=rec.working_minutes,
                        late_minutes=rec.late_minutes,
                        early_exit_minutes=rec.early_exit_minutes,
                        is_irregular=rec.is_irregular,
                        regularization_status=rec.regularization_status,
                        can_regularize=can_regularize,
                        attendance_id=rec.id,
                    )
                )
            else:
                if is_weekend:
                    status = "WEEKEND"
                    can_regularize = False
                    is_irregular = False
                elif cur_date < today:
                    status = "ABSENT"
                    can_regularize = True
                    is_irregular = False
                elif cur_date == today:
                    status = "NOT_PUNCHED"
                    can_regularize = False
                    is_irregular = False
                else:
                    status = "FUTURE"
                    can_regularize = False
                    is_irregular = False

                days_list.append(
                    CalendarDayRead(
                        date=cur_date.isoformat(),
                        day_number=d_num,
                        day_name=day_names[weekday_idx],
                        status=status,
                        punch_in=None,
                        punch_out=None,
                        working_minutes=None,
                        late_minutes=0,
                        early_exit_minutes=0,
                        is_irregular=is_irregular,
                        regularization_status="NONE",
                        can_regularize=can_regularize,
                        attendance_id=None,
                    )
                )

        return days_list

    # -----------------------------------------------------------------------
    # Regularization Workflows (Submit, Get, Approve, Reject)
    # -----------------------------------------------------------------------
    async def submit_regularization(
        self,
        user_id: uuid.UUID,
        payload: RegularizationRequest,
        is_admin: bool = False,
    ) -> RegularizationRead:
        req_date = date.fromisoformat(payload.date)
        notes = payload.notes or payload.note or ""
        req_type = payload.request_type or "LATE_PUNCH"
        now_ist = datetime.now(IST)
        is_direct = bool(payload.direct_regularize and is_admin)

        punch_in_dt = parse_time_on_date(req_date, payload.punch_in)
        punch_out_dt = parse_time_on_date(req_date, payload.punch_out)
        working_mins = None
        if punch_in_dt and punch_out_dt and punch_out_dt > punch_in_dt:
            working_mins = int((punch_out_dt - punch_in_dt).total_seconds() // 60)

        # 1. Query or create attendance record in the same atomic transaction
        query = select(HrmsAttendance).where(
            HrmsAttendance.employee_id == user_id,
            HrmsAttendance.attendance_date == req_date,
        )
        res = await self.db.execute(query)
        rec = res.scalar_one_or_none()

        if not rec:
            initial_status = "PRESENT" if is_direct else ("MISSING_PUNCH" if req_type == "MISSING_PUNCH" else "ABSENT")
            rec = HrmsAttendance(
                employee_id=user_id,
                attendance_date=req_date,
                status=initial_status,
                punch_in=punch_in_dt if is_direct else None,
                punch_out=punch_out_dt if is_direct else None,
                working_minutes=working_mins if is_direct else 0,
                is_irregular=False if is_direct else True,
                regularization_status="APPROVED" if is_direct else "PENDING",
                regularization_reason=payload.reason,
                regularization_note=notes,
            )
            self.db.add(rec)
            await self.db.flush()
        else:
            if is_direct:
                rec.regularization_status = "APPROVED"
                rec.status = "PRESENT"
                rec.is_irregular = False
                if punch_in_dt:
                    rec.punch_in = punch_in_dt
                if punch_out_dt:
                    rec.punch_out = punch_out_dt
                if working_mins is not None:
                    rec.working_minutes = working_mins
                rec.late_minutes = 0
                rec.early_exit_minutes = 0
            else:
                rec.regularization_status = "PENDING"
                rec.is_irregular = True
            rec.regularization_reason = payload.reason
            rec.regularization_note = notes
            await self.db.flush()

        # 2. Query or create persistent regularization request
        reg_query = select(HrmsAttendanceRegularization).where(
            HrmsAttendanceRegularization.employee_id == user_id,
            HrmsAttendanceRegularization.attendance_date == req_date,
            HrmsAttendanceRegularization.status == "PENDING",
        )
        reg_res = await self.db.execute(reg_query)
        existing_reg = reg_res.scalar_one_or_none()

        if existing_reg:
            reg_req = existing_reg
            reg_req.request_type = req_type
            reg_req.reason = payload.reason
            reg_req.notes = notes
            reg_req.punch_in_time = payload.punch_in
            reg_req.punch_out_time = payload.punch_out
            reg_req.total_hours = payload.total_hours
            reg_req.attendance_record_id = rec.id
            if is_direct:
                reg_req.status = "APPROVED"
                reg_req.reviewed_at = now_ist
                reg_req.reviewed_by = user_id
                reg_req.manager_remarks = "Directly regularized by Administrator"
                reg_req.action_taken = "DIRECT_REGULARIZE"
        else:
            reg_req = HrmsAttendanceRegularization(
                employee_id=user_id,
                attendance_record_id=rec.id,
                attendance_date=req_date,
                request_type=req_type,
                reason=payload.reason,
                notes=notes,
                punch_in_time=payload.punch_in,
                punch_out_time=payload.punch_out,
                total_hours=payload.total_hours,
                status="APPROVED" if is_direct else "PENDING",
                submitted_at=now_ist,
                reviewed_at=now_ist if is_direct else None,
                reviewed_by=user_id if is_direct else None,
                manager_remarks="Directly regularized by Administrator" if is_direct else None,
                action_taken="DIRECT_REGULARIZE" if is_direct else None,
            )
            self.db.add(reg_req)

        await self.db.commit()
        await self.db.refresh(reg_req)

        # Resolve employee name
        user_res = await self.db.execute(select(User).where(User.id == user_id))
        user = user_res.scalar_one_or_none()
        emp_name = f"{user.first_name} {user.last_name}".strip() if user else "Employee"
        emp_email = user.email if user else None

        return RegularizationRead(
            id=reg_req.id,
            employee_id=reg_req.employee_id,
            employee_name=emp_name,
            employee_email=emp_email,
            attendance_record_id=reg_req.attendance_record_id,
            attendance_date=reg_req.attendance_date.isoformat(),
            request_type=reg_req.request_type,
            reason=reg_req.reason,
            notes=reg_req.notes,
            punch_in_time=reg_req.punch_in_time,
            punch_out_time=reg_req.punch_out_time,
            total_hours=reg_req.total_hours,
            punch_in=reg_req.punch_in_time,
            punch_out=reg_req.punch_out_time,
            status=reg_req.status,
            regularization_status=reg_req.status,
            regularization_reason=reg_req.reason,
            submitted_at=reg_req.submitted_at,
            reviewed_at=reg_req.reviewed_at,
            reviewed_by=reg_req.reviewed_by,
            reviewed_by_name=emp_name if is_direct else None,
            manager_remarks=reg_req.manager_remarks,
            action_taken=reg_req.action_taken,
        )

    async def get_regularizations(
        self,
        status: Optional[str] = None,
        employee_id: Optional[uuid.UUID] = None,
    ) -> List[RegularizationRead]:
        query = select(HrmsAttendanceRegularization).order_by(
            HrmsAttendanceRegularization.submitted_at.desc()
        )
        if status and status.upper() != "ALL":
            query = query.where(HrmsAttendanceRegularization.status == status.upper())
        if employee_id:
            query = query.where(HrmsAttendanceRegularization.employee_id == employee_id)

        res = await self.db.execute(query)
        records = res.scalars().all()
        if not records:
            return []

        user_ids = set()
        for r in records:
            user_ids.add(r.employee_id)
            if r.reviewed_by:
                user_ids.add(r.reviewed_by)

        users_query = select(User).where(User.id.in_(user_ids))
        users_res = await self.db.execute(users_query)
        users_map = {u.id: u for u in users_res.scalars().all()}

        # Batch fetch linked attendance records for fallback punch timings
        att_ids = [r.attendance_record_id for r in records if r.attendance_record_id]
        att_map = {}
        if att_ids:
            att_query = select(HrmsAttendance).where(HrmsAttendance.id.in_(att_ids))
            att_rows = await self.db.execute(att_query)
            att_map = {a.id: a for a in att_rows.scalars().all()}

        output = []
        for r in records:
            emp = users_map.get(r.employee_id)
            emp_name = f"{emp.first_name} {emp.last_name}".strip() if emp else "Employee"
            emp_email = emp.email if emp else None

            rev = users_map.get(r.reviewed_by) if r.reviewed_by else None
            rev_name = f"{rev.first_name} {rev.last_name}".strip() if rev else None

            att = att_map.get(r.attendance_record_id)
            punch_in_str = r.punch_in_time or format_time_ist(att.punch_in if att else None)
            punch_out_str = r.punch_out_time or format_time_ist(att.punch_out if att else None)
            hours_str = r.total_hours
            if not hours_str and att and att.working_minutes:
                hours_str = f"{att.working_minutes // 60}h {att.working_minutes % 60:02d}m"

            output.append(
                RegularizationRead(
                    id=r.id,
                    employee_id=r.employee_id,
                    employee_name=emp_name,
                    employee_email=emp_email,
                    attendance_record_id=r.attendance_record_id,
                    attendance_date=r.attendance_date.isoformat(),
                    request_type=r.request_type,
                    reason=r.reason,
                    notes=r.notes,
                    punch_in_time=r.punch_in_time,
                    punch_out_time=r.punch_out_time,
                    total_hours=hours_str,
                    punch_in=punch_in_str,
                    punch_out=punch_out_str,
                    status=r.status,
                    regularization_status=r.status,
                    regularization_reason=r.reason,
                    submitted_at=r.submitted_at,
                    reviewed_at=r.reviewed_at,
                    reviewed_by=r.reviewed_by,
                    reviewed_by_name=rev_name,
                    manager_remarks=r.manager_remarks,
                    action_taken=r.action_taken,
                )
            )
        return output

    async def approve_regularization(
        self,
        request_id: uuid.UUID,
        reviewer_id: uuid.UUID,
        payload: Optional[RegularizationApprovalAction] = None,
    ) -> RegularizationRead:
        res = await self.db.execute(
            select(HrmsAttendanceRegularization).where(HrmsAttendanceRegularization.id == request_id)
        )
        reg_req = res.scalar_one_or_none()
        if not reg_req:
            raise NotFoundException(f"Regularization request {request_id} not found.")

        now_ist = datetime.now(IST)
        action = (payload.action if payload else "APPROVE") or "APPROVE"
        manager_remarks = (payload.manager_remarks if payload and payload.manager_remarks else "Approved").strip()
        if not manager_remarks:
            manager_remarks = "Approved"

        reg_req.status = "APPROVED"
        reg_req.reviewed_at = now_ist
        reg_req.reviewed_by = reviewer_id
        reg_req.manager_remarks = manager_remarks
        reg_req.action_taken = action

        # Update linked attendance record
        att_rec = None
        if reg_req.attendance_record_id:
            att_res = await self.db.execute(
                select(HrmsAttendance).where(HrmsAttendance.id == reg_req.attendance_record_id)
            )
            att_rec = att_res.scalar_one_or_none()

        if not att_rec:
            att_res = await self.db.execute(
                select(HrmsAttendance).where(
                    HrmsAttendance.employee_id == reg_req.employee_id,
                    HrmsAttendance.attendance_date == reg_req.attendance_date,
                )
            )
            att_rec = att_res.scalar_one_or_none()

        if att_rec:
            att_rec.regularization_status = "APPROVED"
            att_rec.status = "PRESENT"
            att_rec.is_irregular = False
            att_rec.regularization_reason = reg_req.reason
            att_rec.regularization_note = f"Approved ({action}): {manager_remarks}"

            # Apply requested punch timings if set
            if reg_req.punch_in_time:
                p_in = parse_time_on_date(att_rec.attendance_date, reg_req.punch_in_time)
                if p_in:
                    att_rec.punch_in = p_in
            if reg_req.punch_out_time:
                p_out = parse_time_on_date(att_rec.attendance_date, reg_req.punch_out_time)
                if p_out:
                    att_rec.punch_out = p_out
            if att_rec.punch_in and att_rec.punch_out and att_rec.punch_out > att_rec.punch_in:
                att_rec.working_minutes = int((att_rec.punch_out - att_rec.punch_in).total_seconds() // 60)
            att_rec.late_minutes = 0
            att_rec.early_exit_minutes = 0

        await self.db.commit()
        await self.db.refresh(reg_req)

        users_res = await self.db.execute(
            select(User).where(User.id.in_([reg_req.employee_id, reviewer_id]))
        )
        users_map = {u.id: u for u in users_res.scalars().all()}
        emp = users_map.get(reg_req.employee_id)
        rev = users_map.get(reviewer_id)

        punch_in_str = reg_req.punch_in_time or format_time_ist(att_rec.punch_in if att_rec else None)
        punch_out_str = reg_req.punch_out_time or format_time_ist(att_rec.punch_out if att_rec else None)
        hours_str = reg_req.total_hours
        if not hours_str and att_rec and att_rec.working_minutes:
            hours_str = f"{att_rec.working_minutes // 60}h {att_rec.working_minutes % 60:02d}m"

        return RegularizationRead(
            id=reg_req.id,
            employee_id=reg_req.employee_id,
            employee_name=f"{emp.first_name} {emp.last_name}".strip() if emp else "Employee",
            employee_email=emp.email if emp else None,
            attendance_record_id=reg_req.attendance_record_id,
            attendance_date=reg_req.attendance_date.isoformat(),
            request_type=reg_req.request_type,
            reason=reg_req.reason,
            notes=reg_req.notes,
            punch_in_time=reg_req.punch_in_time,
            punch_out_time=reg_req.punch_out_time,
            total_hours=hours_str,
            punch_in=punch_in_str,
            punch_out=punch_out_str,
            status=reg_req.status,
            regularization_status=reg_req.status,
            regularization_reason=reg_req.reason,
            submitted_at=reg_req.submitted_at,
            reviewed_at=reg_req.reviewed_at,
            reviewed_by=reg_req.reviewed_by,
            reviewed_by_name=f"{rev.first_name} {rev.last_name}".strip() if rev else None,
            manager_remarks=reg_req.manager_remarks,
            action_taken=reg_req.action_taken,
        )

    async def reject_regularization(
        self,
        request_id: uuid.UUID,
        reviewer_id: uuid.UUID,
        payload: Optional[RegularizationRejectAction] = None,
    ) -> RegularizationRead:
        res = await self.db.execute(
            select(HrmsAttendanceRegularization).where(HrmsAttendanceRegularization.id == request_id)
        )
        reg_req = res.scalar_one_or_none()
        if not reg_req:
            raise NotFoundException(f"Regularization request {request_id} not found.")

        now_ist = datetime.now(IST)
        action = (payload.action if payload else "REJECT_LOP") or "REJECT_LOP"
        manager_remarks = (payload.manager_remarks if payload and payload.manager_remarks else "Rejected (Mark LOP)").strip()
        if not manager_remarks:
            manager_remarks = "Rejected (Mark LOP)"

        reg_req.status = "REJECTED"
        reg_req.reviewed_at = now_ist
        reg_req.reviewed_by = reviewer_id
        reg_req.manager_remarks = manager_remarks
        reg_req.action_taken = action

        # Update linked attendance record
        att_rec = None
        if reg_req.attendance_record_id:
            att_res = await self.db.execute(
                select(HrmsAttendance).where(HrmsAttendance.id == reg_req.attendance_record_id)
            )
            att_rec = att_res.scalar_one_or_none()

        if not att_rec:
            att_res = await self.db.execute(
                select(HrmsAttendance).where(
                    HrmsAttendance.employee_id == reg_req.employee_id,
                    HrmsAttendance.attendance_date == reg_req.attendance_date,
                )
            )
            att_rec = att_res.scalar_one_or_none()

        if att_rec:
            att_rec.regularization_status = "REJECTED"
            if action == "REJECT_LOP" and att_rec.status == "MISSING_PUNCH":
                att_rec.status = "ABSENT"
            att_rec.is_irregular = True
            att_rec.regularization_note = f"Rejected ({action}): {manager_remarks}"

        await self.db.commit()
        await self.db.refresh(reg_req)

        users_res = await self.db.execute(
            select(User).where(User.id.in_([reg_req.employee_id, reviewer_id]))
        )
        users_map = {u.id: u for u in users_res.scalars().all()}
        emp = users_map.get(reg_req.employee_id)
        rev = users_map.get(reviewer_id)

        punch_in_str = reg_req.punch_in_time or format_time_ist(att_rec.punch_in if att_rec else None)
        punch_out_str = reg_req.punch_out_time or format_time_ist(att_rec.punch_out if att_rec else None)
        hours_str = reg_req.total_hours
        if not hours_str and att_rec and att_rec.working_minutes:
            hours_str = f"{att_rec.working_minutes // 60}h {att_rec.working_minutes % 60:02d}m"

        return RegularizationRead(
            id=reg_req.id,
            employee_id=reg_req.employee_id,
            employee_name=f"{emp.first_name} {emp.last_name}".strip() if emp else "Employee",
            employee_email=emp.email if emp else None,
            attendance_record_id=reg_req.attendance_record_id,
            attendance_date=reg_req.attendance_date.isoformat(),
            request_type=reg_req.request_type,
            reason=reg_req.reason,
            notes=reg_req.notes,
            punch_in_time=reg_req.punch_in_time,
            punch_out_time=reg_req.punch_out_time,
            total_hours=hours_str,
            punch_in=punch_in_str,
            punch_out=punch_out_str,
            status=reg_req.status,
            regularization_status=reg_req.status,
            regularization_reason=reg_req.reason,
            submitted_at=reg_req.submitted_at,
            reviewed_at=reg_req.reviewed_at,
            reviewed_by=reg_req.reviewed_by,
            reviewed_by_name=f"{rev.first_name} {rev.last_name}".strip() if rev else None,
            manager_remarks=reg_req.manager_remarks,
            action_taken=reg_req.action_taken,
        )

    # -----------------------------------------------------------------------
    # Helper: Regularization Eligibility Rule
    # -----------------------------------------------------------------------
    @staticmethod
    def _can_regularize_record(rec: HrmsAttendance) -> bool:
        """
        The edit icon must appear ONLY when:
        Late, Half Day, Missing Punch, Outside Geofence, Pending Regularization, Absent.
        Never show for:
        Present, Holiday, Weekend, Future, Approved Leave, In Progress.
        """
        if rec.regularization_status == "APPROVED":
            return False
        if rec.regularization_status == "PENDING":
            return True
        if rec.status in ("WEEKEND", "HOLIDAY", "FUTURE", "NOT_PUNCHED", "EMPTY", "IN_PROGRESS", "APPROVED_LEAVE", "LEAVE"):
            return False
        if rec.status == "PRESENT" and not rec.is_irregular and rec.early_exit_minutes == 0 and rec.late_minutes == 0:
            return False
        if rec.status in ("LATE", "HALF_DAY", "MISSING_PUNCH", "ABSENT"):
            return True
        if rec.is_irregular:
            return True
        if rec.early_exit_minutes > 0 or rec.late_minutes > 0:
            return True
        return False
