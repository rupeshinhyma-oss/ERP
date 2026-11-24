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
import io
import logging
import math
import uuid
from datetime import date, datetime, time, timedelta, timezone
from typing import List, Optional

logger = logging.getLogger(__name__)

from sqlalchemy import func, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import BadRequestException, ForbiddenException, NotFoundException
from app.hrms.notifications import (
    notify_regularization_cancelled,
    notify_regularization_decision,
    notify_regularization_requested,
)
from app.hrms.models import (
    HrmsAttendance,
    HrmsAttendancePolicy,
    HrmsAttendanceRegularization,
    HrmsEmployeeLeaveBalance,
    HrmsEmployeeLocation,
    HrmsGeofenceViolation,
    HrmsHoliday,
    HrmsLeaveAdjustment,
    HrmsLeaveRequest,
    HrmsLeaveType,
    HrmsLocation,
)
from app.hrms.schemas import (
    AssignedOfficeRead,
    AttendancePolicyRead,
    AttendancePolicyUpdate,
    AttendanceRecordRead,
    CalendarDayRead,
    GeofenceCheckResponse,
    PunchInRequest,
    PunchOutRequest,
    RegularizationApprovalAction,
    RegularizationCancelAction,
    RegularizationCreate,
    RegularizationRead,
    RegularizationRejectAction,
    RegularizationRequest,
    TodayAttendanceRead,
)
from app.users.models import User, UserStatus

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
    a = min(1.0, max(0.0, a))
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


MAX_ACCEPTABLE_GPS_ACCURACY_METERS: float = 100.0
MAX_GPS_AGE_SECONDS: float = 60.0
MAX_GPS_FUTURE_TOLERANCE_SECONDS: float = 10.0


def validate_gps_freshness(
    gps_timestamp: datetime | None,
    server_now_utc: datetime | None = None,
    max_age_seconds: float = MAX_GPS_AGE_SECONDS,
    max_future_seconds: float = MAX_GPS_FUTURE_TOLERANCE_SECONDS,
) -> datetime:
    """
    Centralized validation for GPS timestamp freshness.

    Rules:
    - gps_timestamp must be provided (reject missing).
    - gps_timestamp must be a valid datetime (reject invalid).
    - Converted to timezone-aware UTC.
    - Reading age (server_now - gps_time) cannot exceed max_age_seconds (60s).
    - Reading timestamp cannot be more than max_future_seconds (10s) ahead of server clock.

    Returns normalized timezone-aware UTC datetime.
    """
    if gps_timestamp is None:
        raise BadRequestException(
            "Missing GPS timestamp: A valid GPS timestamp is required to record attendance. "
            "Please enable location services and retry."
        )

    if not isinstance(gps_timestamp, datetime):
        raise BadRequestException(
            "Invalid GPS timestamp: Timestamp must be a valid date and time."
        )

    # Normalize to timezone-aware UTC
    if gps_timestamp.tzinfo is None:
        gps_dt_utc = gps_timestamp.replace(tzinfo=timezone.utc)
    else:
        gps_dt_utc = gps_timestamp.astimezone(timezone.utc)

    now = server_now_utc if server_now_utc is not None else datetime.now(timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    else:
        now = now.astimezone(timezone.utc)

    age_seconds = (now - gps_dt_utc).total_seconds()

    if age_seconds < -max_future_seconds:
        future_seconds = abs(age_seconds)
        raise BadRequestException(
            f"Invalid GPS timestamp: GPS timestamp is {round(future_seconds, 1)}s in the future "
            f"(exceeds maximum allowed tolerance of {int(max_future_seconds)} seconds). "
            "Please verify your device clock."
        )

    if age_seconds > max_age_seconds:
        raise BadRequestException(
            f"Stale GPS reading: GPS coordinates were acquired {round(age_seconds, 1)}s ago "
            f"(exceeds maximum allowed age of {int(max_age_seconds)} seconds). "
            "Please acquire a fresh location reading and retry."
        )

    return gps_dt_utc


class HrmsAttendanceService:
    MAX_ACCEPTABLE_GPS_ACCURACY_METERS: float = MAX_ACCEPTABLE_GPS_ACCURACY_METERS
    MAX_GPS_AGE_SECONDS: float = MAX_GPS_AGE_SECONDS
    MAX_GPS_FUTURE_TOLERANCE_SECONDS: float = MAX_GPS_FUTURE_TOLERANCE_SECONDS
    validate_gps_freshness = staticmethod(validate_gps_freshness)

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
            .order_by(HrmsEmployeeLocation.is_primary.desc(), HrmsLocation.name.asc())
        )
        res = await self.db.execute(mapping_query)
        loc = res.scalars().first()
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
        loc = loc_res.scalars().first()
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

    async def get_permitted_locations(self, user_id: uuid.UUID) -> tuple[HrmsLocation, list[HrmsLocation]]:
        """
        Resolve employee's assigned primary and additional permitted locations.
        Returns:
            (primary_office, all_permitted_offices)
        Rules:
        - Only active and non-soft-deleted HrmsLocation records are included.
        - Primary office is the one with is_primary=True (or first assigned if none marked primary).
        - If employee has no assigned locations in DB, falls back to default assigned office (e.g. Thane Office)
          as the primary and only permitted location.
        - all_permitted_offices includes the primary office and all additional assigned active offices.
        - Duplicate location mappings are deduplicated deterministically.
        """
        rows = None
        try:
            mapping_query = (
                select(HrmsLocation, HrmsEmployeeLocation.is_primary)
                .join(HrmsEmployeeLocation, HrmsEmployeeLocation.location_id == HrmsLocation.id)
                .where(
                    HrmsEmployeeLocation.user_id == user_id,
                    HrmsLocation.deleted_at.is_(None),
                    HrmsLocation.is_active.is_(True),
                )
                .order_by(HrmsEmployeeLocation.is_primary.desc(), HrmsLocation.name.asc())
            )
            res = await self.db.execute(mapping_query)
            if hasattr(res, "all"):
                rows = res.all()
        except Exception as exc:
            logger.warning("Error fetching permitted locations for user %s: %s", user_id, exc)
            rows = None

        if rows:
            primary_office = None
            permitted_offices = []
            seen_ids = set()
            for item in rows:
                if hasattr(item, "__getitem__") and len(item) >= 2:
                    loc, is_prim = item[0], bool(item[1])
                elif hasattr(item, "HrmsLocation"):
                    loc = getattr(item, "HrmsLocation")
                    is_prim = bool(getattr(item, "is_primary", False))
                else:
                    loc, is_prim = item, False

                if (
                    loc is not None
                    and getattr(loc, "id", None) is not None
                    and loc.id not in seen_ids
                    and getattr(loc, "latitude", None) is not None
                    and getattr(loc, "longitude", None) is not None
                    and getattr(loc, "is_active", True)
                    and getattr(loc, "deleted_at", None) is None
                ):
                    seen_ids.add(loc.id)
                    permitted_offices.append(loc)
                    if is_prim and primary_office is None:
                        primary_office = loc

            if permitted_offices:
                if primary_office is None:
                    primary_office = permitted_offices[0]
                return primary_office, permitted_offices

        # Fallback to get_assigned_office
        default_loc = await self.get_assigned_office(user_id)
        return default_loc, [default_loc]

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
            punch_in_accuracy_meters=rec.punch_in_accuracy_meters,
            punch_out_accuracy_meters=rec.punch_out_accuracy_meters,
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
        primary_office, permitted_locations = await self.get_permitted_locations(user_id)
        office = primary_office
        office_read = AssignedOfficeRead(
            id=office.id,
            name=office.name,
            address=office.address,
            latitude=office.latitude,
            longitude=office.longitude,
            radius_meters=office.radius_meters,
        )
        permitted_reads = [
            AssignedOfficeRead(
                id=loc.id,
                name=loc.name,
                address=loc.address,
                latitude=loc.latitude,
                longitude=loc.longitude,
                radius_meters=loc.radius_meters,
            )
            for loc in permitted_locations
        ]

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
                permitted_offices=permitted_reads,
                is_irregular=rec.is_irregular,
                regularization_status=rec.regularization_status,
                can_regularize=rec.can_regularize,
                attendance_record=rec,
            )

        return TodayAttendanceRead(
            employee_id=user_id,
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
            permitted_offices=permitted_reads,
            is_irregular=False,
            regularization_status="NONE",
            can_regularize=False,
            attendance_record=None,
        )

    # -----------------------------------------------------------------------
    # Punch In Flow
    # -----------------------------------------------------------------------
    async def punch_in(
        self,
        user_id: uuid.UUID,
        payload: PunchInRequest,
        server_now: datetime | None = None,
    ) -> AttendanceRecordRead:
        policy = await self.get_policy()
        primary_office, permitted_offices = await self.get_permitted_locations(user_id)

        # 1. Authoritative server timestamp & local date (ignore untrusted client timestamp)
        now_utc = server_now if server_now is not None else datetime.now(timezone.utc)
        if now_utc.tzinfo is None:
            now_utc = now_utc.replace(tzinfo=timezone.utc)
        else:
            now_utc = now_utc.astimezone(timezone.utc)
        local_dt = now_utc.astimezone(IST)
        today = local_dt.date()

        # Validate GPS accuracy
        if payload.accuracy is None:
            raise BadRequestException(
                "Missing GPS accuracy: An accuracy measurement within 100 metres is required to record attendance. "
                "Please enable location services and retry."
            )
        if not math.isfinite(payload.accuracy) or payload.accuracy < 0.0:
            raise BadRequestException("Invalid GPS accuracy value: must be a finite, non-negative number.")
        if payload.accuracy > MAX_ACCEPTABLE_GPS_ACCURACY_METERS:
            raise BadRequestException(
                f"GPS signal is insufficient (accuracy ±{round(payload.accuracy, 1)}m exceeds maximum allowed {MAX_ACCEPTABLE_GPS_ACCURACY_METERS}m). "
                "Please retry from a location with better reception."
            )

        # Validate GPS freshness
        validate_gps_freshness(payload.gps_timestamp, server_now_utc=now_utc)

        # 2. Multi-Location Geofence Validation
        validating_office = None
        validating_distance = None

        for off in permitted_offices:
            dist = haversine_distance(
                payload.latitude, payload.longitude, off.latitude, off.longitude
            )
            allowed_radius = off.radius_meters or policy.geofence_radius_meters
            if dist <= allowed_radius:
                validating_office = off
                validating_distance = dist
                break

        if not validating_office:
            raise BadRequestException(
                "Outside geofence: You are outside your assigned office locations. Please punch in from an authorized location."
            )

        office = validating_office
        distance = validating_distance

        # 3. Serialize concurrent punch-in for same employee & date on PostgreSQL (HRMS-BUG-19)
        if isinstance(self.db, AsyncSession):
            bind = self.db.get_bind()
            if bind is not None and bind.dialect.name == "postgresql":
                await self.db.execute(
                    text("SELECT pg_advisory_xact_lock(hashtext(:lock_key))"),
                    {"lock_key": f"hrms_punch_in:{user_id}:{today.isoformat()}"},
                )

        # Duplicate punch check
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

        acc_val = round(payload.accuracy, 2) if payload.accuracy is not None else None
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
            record.punch_in_accuracy_meters = acc_val
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
                punch_in_accuracy_meters=acc_val,
                is_irregular=is_irregular,
                regularization_status="NONE",
            )
            self.db.add(record)

        try:
            await self.db.commit()
            await self.db.refresh(record)
        except IntegrityError:
            await self.db.rollback()
            raise BadRequestException("Already punched in for today.")

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
            punch_in_accuracy_meters=record.punch_in_accuracy_meters,
            punch_out_accuracy_meters=None,
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
    async def punch_out(
        self,
        user_id: uuid.UUID,
        payload: PunchOutRequest,
        server_now: datetime | None = None,
    ) -> AttendanceRecordRead:
        policy = await self.get_policy()
        primary_office, permitted_offices = await self.get_permitted_locations(user_id)

        # 1. Authoritative server timestamp & local date (ignore untrusted client timestamp)
        now_utc = server_now if server_now is not None else datetime.now(timezone.utc)
        if now_utc.tzinfo is None:
            now_utc = now_utc.replace(tzinfo=timezone.utc)
        else:
            now_utc = now_utc.astimezone(timezone.utc)
        local_dt = now_utc.astimezone(IST)
        today = local_dt.date()

        # Validate GPS accuracy
        if payload.accuracy is None:
            raise BadRequestException(
                "Missing GPS accuracy: An accuracy measurement within 100 metres is required to record attendance. "
                "Please enable location services and retry."
            )
        if not math.isfinite(payload.accuracy) or payload.accuracy < 0.0:
            raise BadRequestException("Invalid GPS accuracy value: must be a finite, non-negative number.")
        if payload.accuracy > MAX_ACCEPTABLE_GPS_ACCURACY_METERS:
            raise BadRequestException(
                f"GPS signal is insufficient (accuracy ±{round(payload.accuracy, 1)}m exceeds maximum allowed {MAX_ACCEPTABLE_GPS_ACCURACY_METERS}m). "
                "Please retry from a location with better reception."
            )

        # Validate GPS freshness
        validate_gps_freshness(payload.gps_timestamp, server_now_utc=now_utc)

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

        # 2. Multi-Location Geofence Validation
        validating_office = None
        validating_distance = None

        for off in permitted_offices:
            dist = haversine_distance(
                payload.latitude, payload.longitude, off.latitude, off.longitude
            )
            allowed_radius = off.radius_meters or policy.geofence_radius_meters
            if dist <= allowed_radius:
                validating_office = off
                validating_distance = dist
                break

        if not validating_office:
            raise BadRequestException(
                "Outside geofence: You are outside your assigned office locations. Please punch out from an authorized location."
            )

        office = validating_office
        distance = validating_distance

        # 3. Calculate working minutes
        working_seconds = (local_dt - to_ist(record.punch_in)).total_seconds()
        working_mins = max(0, int(working_seconds / 60))
        record.working_minutes = working_mins

        # 4. Check Early Exit against policy shift_end_time & early_exit_buffer_minutes (HRMS-BUG-24)
        early_exit_mins = 0
        enable_early = getattr(policy, "enable_early_exit", True)
        if enable_early is not False:
            raw_buf = getattr(policy, "early_exit_buffer_minutes", 0)
            buffer_mins = max(0, int(raw_buf)) if isinstance(raw_buf, (int, float)) else 0
            raw_end = getattr(policy, "shift_end_time", None)
            end_str = raw_end if isinstance(raw_end, str) and ":" in raw_end else "19:00"
            end_h, end_m = map(int, end_str.split(":")[:2])
            shift_end_mins = end_h * 60 + end_m

            raw_start = getattr(policy, "shift_start_time", None)
            start_str = raw_start if isinstance(raw_start, str) and ":" in raw_start else "10:30"
            start_h, start_m = map(int, start_str.split(":")[:2])
            shift_start_mins = start_h * 60 + start_m
            required_shift_mins = max(0, shift_end_mins - shift_start_mins)
            current_mins = local_dt.hour * 60 + local_dt.minute

            is_flexible = getattr(policy, "flexible_shift", False) is True
            if is_flexible and required_shift_mins > 0:
                shortfall = required_shift_mins - working_mins
                if shortfall > buffer_mins:
                    early_exit_mins = shortfall
            else:
                # Inclusive boundary: leaving at (shift_end - buffer) or later is within grace buffer
                cutoff_mins = shift_end_mins - buffer_mins
                if current_mins < cutoff_mins:
                    early_exit_mins = shift_end_mins - current_mins

            mark_early = getattr(policy, "mark_early_exit", True)
            if early_exit_mins > 0 and mark_early is not False:
                record.early_exit_minutes = early_exit_mins
                record.is_irregular = True
            else:
                record.early_exit_minutes = 0
        else:
            record.early_exit_minutes = 0

        out_acc_val = round(payload.accuracy, 2) if payload.accuracy is not None else None
        record.punch_out = local_dt
        record.punch_out_distance = round(distance, 1)
        record.punch_out_accuracy_meters = out_acc_val

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
            punch_in_accuracy_meters=record.punch_in_accuracy_meters,
            punch_out_accuracy_meters=record.punch_out_accuracy_meters,
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

        # 1. Resolve employee's branch and department
        loc_res = await self.db.execute(
            select(HrmsLocation.name)
            .join(HrmsEmployeeLocation, HrmsEmployeeLocation.location_id == HrmsLocation.id)
            .where(
                HrmsEmployeeLocation.user_id == user_id,
                HrmsLocation.deleted_at.is_(None),
            )
            .order_by(HrmsEmployeeLocation.is_primary.desc())
            .limit(1)
        )
        emp_branch = loc_res.scalar_one_or_none() or "Thane"

        from app.rbac.models import Role, UserRole
        role_res = await self.db.execute(
            select(Role.name)
            .join(UserRole, UserRole.role_id == Role.id)
            .where(UserRole.user_id == user_id)
            .order_by(UserRole.is_primary.desc())
            .limit(1)
        )
        emp_dept = role_res.scalar_one_or_none() or "General"

        # 2. Centralized active holidays in month (Priority 1)
        holidays_res = await self.db.execute(
            select(HrmsHoliday).where(
                HrmsHoliday.deleted_at.is_(None),
                HrmsHoliday.is_active.is_(True),
                HrmsHoliday.holiday_date >= start_date,
                HrmsHoliday.holiday_date <= end_date,
            )
        )
        holidays = holidays_res.scalars().all()
        holiday_map: dict[date, HrmsHoliday] = {}
        for h in holidays:
            app_b = (h.branch_applicability or "All Branches").lower()
            app_d = (getattr(h, "department_scope", None) or "All Departments").lower()
            b_match = "all" in app_b or emp_branch.lower() in app_b
            d_match = "all" in app_d or emp_dept.lower() in app_d
            if b_match and d_match:
                holiday_map[h.holiday_date] = h

        # 3. Approved leave requests for employee in month (Priority 3)
        leaves_res = await self.db.execute(
            select(HrmsLeaveRequest, HrmsLeaveType.name, HrmsLeaveType.is_paid).join(
                HrmsLeaveType, HrmsLeaveType.id == HrmsLeaveRequest.leave_type_id
            ).where(
                HrmsLeaveRequest.employee_id == user_id,
                HrmsLeaveRequest.approval_status == "APPROVED",
                HrmsLeaveRequest.from_date <= end_date,
                HrmsLeaveRequest.to_date >= start_date,
            )
        )
        leaves = leaves_res.all()
        leave_map: dict[date, tuple[str, bool, float]] = {}
        for req, lt_name, lt_is_paid in leaves:
            day_weight = 0.5 if (req.from_date == req.to_date and abs(float(req.number_of_days or 1.0) - 0.5) < 1e-6) else 1.0
            cur = max(req.from_date, start_date)
            req_end = min(req.to_date, end_date)
            while cur <= req_end:
                leave_map[cur] = (lt_name, bool(lt_is_paid), day_weight)
                cur += timedelta(days=1)

        # 4. Attendance records for this employee in month
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

        # Policy-driven Weekly Off (Priority 2)
        policy = await self.get_policy()
        weekly_off_raw = (policy.weekly_off or "Sunday").strip()
        weekly_off_days = {d.strip().capitalize() for d in weekly_off_raw.split(",") if d.strip()}
        if not weekly_off_days:
            weekly_off_days = {"Sunday"}

        # Strict priority evaluation:
        # 1. Holiday -> 2. Weekly Off -> 3. Approved Leave -> 4. Present/Late/Half Day -> 5. Absent
        for d_num in range(1, num_days + 1):
            cur_date = date(year, month, d_num)
            weekday_idx = cur_date.weekday()
            day_full_name = cur_date.strftime("%A")
            is_weekend = day_full_name in weekly_off_days
            rec = record_map.get(cur_date)

            is_holiday = cur_date in holiday_map
            is_leave = cur_date in leave_map

            # Priority 1: Holiday
            if is_holiday:
                h_name = holiday_map[cur_date].name
                days_list.append(
                    CalendarDayRead(
                        date=cur_date.isoformat(),
                        day_number=d_num,
                        day_name=day_names[weekday_idx],
                        status="HOLIDAY",
                        holiday_name=h_name,
                        punch_in=format_time_ist(rec.punch_in) if rec else None,
                        punch_out=format_time_ist(rec.punch_out) if rec else None,
                        working_minutes=rec.working_minutes if rec else None,
                        late_minutes=0,
                        early_exit_minutes=0,
                        is_irregular=False,
                        regularization_status="NONE",
                        can_regularize=False,
                        attendance_id=rec.id if rec else None,
                    )
                )
            # Priority 2: Approved Leave
            elif is_leave:
                lt_name, lt_is_paid, lv_weight = leave_map[cur_date]
                display_lt = f"{lt_name} (Half Day)" if lv_weight == 0.5 else lt_name
                days_list.append(
                    CalendarDayRead(
                        date=cur_date.isoformat(),
                        day_number=d_num,
                        day_name=day_names[weekday_idx],
                        status="HALF_DAY" if (lv_weight == 0.5 and rec and rec.punch_in) else "LEAVE",
                        leave_type_name=display_lt,
                        is_paid_leave=lt_is_paid,
                        leave_days=lv_weight,
                        punch_in=format_time_ist(rec.punch_in) if rec else None,
                        punch_out=format_time_ist(rec.punch_out) if rec else None,
                        working_minutes=rec.working_minutes if rec else None,
                        late_minutes=0,
                        early_exit_minutes=0,
                        is_irregular=False,
                        regularization_status="NONE",
                        can_regularize=False,
                        attendance_id=rec.id if rec else None,
                    )
                )
            # Priority 3: Actual Punch / Attendance Activity (including worked weekends)
            elif rec and (rec.punch_in or rec.status in ("PRESENT", "LATE", "HALF_DAY", "IN_PROGRESS", "MISSING_PUNCH") or rec.regularization_status in ("PENDING", "APPROVED")):
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
            # Priority 4: Weekly Off
            elif is_weekend:
                days_list.append(
                    CalendarDayRead(
                        date=cur_date.isoformat(),
                        day_number=d_num,
                        day_name=day_names[weekday_idx],
                        status="WEEKEND",
                        punch_in=format_time_ist(rec.punch_in) if rec else None,
                        punch_out=format_time_ist(rec.punch_out) if rec else None,
                        working_minutes=rec.working_minutes if rec else None,
                        late_minutes=0,
                        early_exit_minutes=0,
                        is_irregular=False,
                        regularization_status="NONE",
                        can_regularize=False,
                        attendance_id=rec.id if rec else None,
                    )
                )
            # Priority 5: Other existing record
            elif rec:
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
            # Priority 5: Absent / Not Punched / Future
            else:
                if cur_date < today:
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
        actor_id: Optional[uuid.UUID] = None,
    ) -> RegularizationRead:
        req_date = date.fromisoformat(payload.date)
        notes = payload.notes or payload.note or ""
        req_type = payload.request_type or "LATE_PUNCH"
        now_ist = datetime.now(IST)

        if payload.direct_regularize:
            if not is_admin:
                raise BadRequestException("Direct regularization requires administrator privileges.")
            if actor_id is not None and actor_id == user_id:
                raise BadRequestException("Self-approval is not permitted. Administrators cannot directly regularize their own attendance.")

        is_direct = bool(payload.direct_regularize and is_admin and (actor_id != user_id if actor_id is not None else True))

        punch_in_dt = parse_time_on_date(req_date, payload.punch_in)
        punch_out_dt = parse_time_on_date(req_date, payload.punch_out)
        working_mins = None
        if punch_in_dt and punch_out_dt and punch_out_dt > punch_in_dt:
            working_mins = int((punch_out_dt - punch_in_dt).total_seconds() // 60)

        # Block regularization for future dates
        if req_date > now_ist.date():
            raise BadRequestException("Attendance cannot be regularized for future dates.")

        # Block regularization on holidays
        holiday_res = await self.db.execute(
            select(HrmsHoliday).where(
                HrmsHoliday.deleted_at.is_(None),
                HrmsHoliday.is_active.is_(True),
                HrmsHoliday.holiday_date == req_date,
            )
        )
        if holiday_res.scalar_one_or_none():
            raise BadRequestException("Attendance cannot be regularized for holidays.")

        # Block regularization on approved leave dates
        leave_res = await self.db.execute(
            select(HrmsLeaveRequest)
            .where(
                HrmsLeaveRequest.employee_id == user_id,
                HrmsLeaveRequest.approval_status == "APPROVED",
                HrmsLeaveRequest.from_date <= req_date,
                HrmsLeaveRequest.to_date >= req_date,
            )
            .order_by(HrmsLeaveRequest.created_at.desc(), HrmsLeaveRequest.id.desc())
            .limit(1)
        )
        if leave_res.scalar_one_or_none():
            raise BadRequestException("Attendance cannot be regularized for approved leave days.")

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
        reg_query = (
            select(HrmsAttendanceRegularization)
            .where(
                HrmsAttendanceRegularization.employee_id == user_id,
                HrmsAttendanceRegularization.attendance_date == req_date,
                HrmsAttendanceRegularization.status == "PENDING",
            )
            .order_by(HrmsAttendanceRegularization.created_at.desc(), HrmsAttendanceRegularization.id.desc())
            .limit(1)
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

        await self.db.flush()
        if not is_direct:
            await notify_regularization_requested(
                self.db,
                employee_id=reg_req.employee_id,
                attendance_date=reg_req.attendance_date.isoformat(),
                reason=reg_req.reason,
                actor_id=user_id,
                request_id=reg_req.id,
            )
        await self.db.commit()
        await self.db.refresh(reg_req)

        # Resolve employee name
        user_res = await self.db.execute(select(User).where(User.id == user_id))
        user = user_res.scalar_one_or_none()
        emp_name = (user.display_name or f"{user.first_name or ''} {user.last_name or ''}".strip() or user.username or "Employee") if user else "Employee"
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
            emp_name = (emp.display_name or f"{emp.first_name or ''} {emp.last_name or ''}".strip() or emp.username or "Employee") if emp else "Employee"
            emp_email = emp.email if emp else None

            rev = users_map.get(r.reviewed_by) if r.reviewed_by else None
            rev_name = (rev.display_name or f"{rev.first_name or ''} {rev.last_name or ''}".strip() or rev.username) if rev else None

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

    async def _resolve_hrms_context_for_user(self, user_id: uuid.UUID):
        """Build an authoritative HrmsUserContext from PostgreSQL RBAC tables for direct service calls."""
        from app.hrms.rbac import HrmsUserContext
        from app.rbac.models import Permission, Role, RoleAssignmentStatus, UserPermission, UserRole
        from app.rbac.repository import RoleRepository

        user = await self.db.get(User, user_id)
        if not user or user.deleted_at is not None or not user.is_active:
            raise ForbiddenException("Reviewer account is inactive or not found.")

        roles_stmt = (
            select(Role.name)
            .join(UserRole, UserRole.role_id == Role.id)
            .where(
                UserRole.user_id == user.id,
                UserRole.status == RoleAssignmentStatus.ACTIVE,
                Role.deleted_at.is_(None),
            )
        )
        roles = list((await self.db.execute(roles_stmt)).scalars().all())
        perms = set(await RoleRepository(self.db).get_permission_codes_for_user(user.id))

        # Ensure explicit user-level denies are honored even when super_admin role grants '*'
        deny_rows = (
            await self.db.execute(
                select(Permission.code)
                .join(UserPermission, UserPermission.permission_id == Permission.id)
                .where(UserPermission.user_id == user.id, UserPermission.is_granted.is_(False))
            )
        ).scalars().all()
        for code in deny_rows:
            perms.discard(code)
            perms.add(f"deny:{code}")

        is_super_admin = bool(getattr(user, "is_super_admin", False) or "super_admin" in roles)
        is_admin = bool(
            is_super_admin
            or "*" in perms
            or "admin" in perms
            or "super_admin" in roles
            or "admin" in roles
        )
        is_hr = bool(
            is_admin
            or "HR" in roles
            or any(r.upper() == "HR" or r.lower() == "human_resources" for r in roles)
            or "hrms.manage" in perms
        )

        dept = None
        for r in roles:
            if r.lower() not in ("user", "super_admin", "admin", "department_manager", "employee"):
                dept = r
                break
        if not dept:
            dept = getattr(user, "department", None) or "General"

        managed_ids: set[uuid.UUID] = {user.id}
        reports_stmt = select(User.id).where(User.manager_id == user.id, User.deleted_at.is_(None))
        for uid in (await self.db.execute(reports_stmt)).scalars().all():
            managed_ids.add(uid)

        is_manager = bool(
            "department_manager" in roles
            or any("manager" in r.lower() for r in roles)
            or len(managed_ids) > 1
        )
        if is_manager and dept and dept.lower() != "general":
            dept_roles_stmt = select(Role.id).where(func.lower(Role.name) == dept.lower(), Role.deleted_at.is_(None))
            dept_role_ids = list((await self.db.execute(dept_roles_stmt)).scalars().all())
            if dept_role_ids:
                dept_users_stmt = select(UserRole.user_id).where(
                    UserRole.role_id.in_(dept_role_ids),
                    UserRole.status == RoleAssignmentStatus.ACTIVE,
                )
                for uid in (await self.db.execute(dept_users_stmt)).scalars().all():
                    managed_ids.add(uid)

        return HrmsUserContext(
            user_id=user.id,
            username=user.username or "",
            email=user.email or "",
            display_name=getattr(user, "full_name", None) or user.display_name or "",
            is_super_admin=is_super_admin,
            is_admin=is_admin,
            is_hr=is_hr,
            is_manager=is_manager,
            department=dept,
            roles=roles,
            permissions=perms,
            managed_employee_ids=managed_ids,
        )

    async def _enforce_regularization_reviewer_auth(
        self,
        reviewer_id: uuid.UUID,
        target_employee_id: uuid.UUID,
        action_label: str,
        ctx=None,
    ) -> None:
        from app.hrms.rbac import verify_approval_authorization

        if ctx is not None:
            if ctx.user_id != reviewer_id:
                raise ForbiddenException("Reviewer identity does not match authenticated context.")
            resolved_ctx = ctx
        else:
            resolved_ctx = await self._resolve_hrms_context_for_user(reviewer_id)

        await verify_approval_authorization(
            db=self.db,
            ctx=resolved_ctx,
            target_employee_id=target_employee_id,
            module_name="attendance",
            action_label=action_label,
        )

    async def approve_regularization(
        self,
        request_id: uuid.UUID,
        reviewer_id: uuid.UUID,
        payload: Optional[RegularizationApprovalAction] = None,
        ctx=None,
    ) -> RegularizationRead:
        res = await self.db.execute(
            select(HrmsAttendanceRegularization)
            .where(HrmsAttendanceRegularization.id == request_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        reg_req = res.scalar_one_or_none()
        if not reg_req:
            raise NotFoundException(f"Regularization request {request_id} not found.")

        if reg_req.status != "PENDING":
            raise BadRequestException(
                f"Regularization request is already {reg_req.status.lower()} and cannot be reviewed again."
            )

        await self._enforce_regularization_reviewer_auth(
            reviewer_id=reviewer_id,
            target_employee_id=reg_req.employee_id,
            action_label="approve",
            ctx=ctx,
        )

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

        if action == "ADJUST_LEAVE":
            target_lt_id = payload.leave_type_id if payload else None
            if not target_lt_id:
                # Find default applicable paid leave type
                lt_query = select(HrmsLeaveType).where(
                    HrmsLeaveType.deleted_at.is_(None),
                    HrmsLeaveType.is_active == True,
                    HrmsLeaveType.is_paid == True,
                ).order_by(HrmsLeaveType.created_at.asc())
                default_lt = (await self.db.execute(lt_query)).scalars().first()
                if default_lt:
                    target_lt_id = default_lt.id
                else:
                    any_lt = (await self.db.execute(
                        select(HrmsLeaveType).where(
                            HrmsLeaveType.deleted_at.is_(None),
                            HrmsLeaveType.is_active == True,
                        )
                    )).scalars().first()
                    target_lt_id = any_lt.id if any_lt else None

            if target_lt_id:
                lt = await self.db.get(HrmsLeaveType, target_lt_id)
                year = reg_req.attendance_date.year
                bal_query = (
                    select(HrmsEmployeeLeaveBalance)
                    .where(
                        HrmsEmployeeLeaveBalance.employee_id == reg_req.employee_id,
                        HrmsEmployeeLeaveBalance.leave_type_id == target_lt_id,
                        HrmsEmployeeLeaveBalance.year == year,
                    )
                    .with_for_update()
                )
                bal = (await self.db.execute(bal_query)).scalar_one_or_none()
                if not bal:
                    bal = HrmsEmployeeLeaveBalance(
                        employee_id=reg_req.employee_id,
                        leave_type_id=target_lt_id,
                        year=year,
                        allocated=lt.annual_balance if lt else 0.0,
                        consumed=0.0,
                        adjusted=0.0,
                        available=lt.annual_balance if lt else 0.0,
                    )
                    self.db.add(bal)
                    await self.db.flush()

                # Deterministically inspect only active APPROVED leave records covering this date
                # (ignoring historical CANCELLED / REJECTED requests so MultipleResultsFound cannot occur
                # and unrelated historical requests are never selected).
                existing_req = (
                    await self.db.execute(
                        select(HrmsLeaveRequest)
                        .where(
                            HrmsLeaveRequest.employee_id == reg_req.employee_id,
                            HrmsLeaveRequest.approval_status == "APPROVED",
                            HrmsLeaveRequest.from_date <= reg_req.attendance_date,
                            HrmsLeaveRequest.to_date >= reg_req.attendance_date,
                        )
                        .order_by(HrmsLeaveRequest.created_at.desc(), HrmsLeaveRequest.id.desc())
                        .limit(1)
                    )
                ).scalar_one_or_none()

                if not existing_req:
                    new_avail = round(bal.allocated + bal.adjusted - (bal.consumed + 1.0), 2)
                    if lt and not getattr(lt, "allow_negative_balance", False) and new_avail < 0:
                        raise BadRequestException(
                            f"Adjust leave failed: insufficient {lt.name} balance (available: {bal.available}). Cannot deduct 1 day."
                        )

                    prev_available = bal.available
                    bal.consumed = round(bal.consumed + 1.0, 2)
                    bal.available = round(bal.allocated + bal.adjusted - bal.consumed, 2)

                    leave_req = HrmsLeaveRequest(
                        employee_id=reg_req.employee_id,
                        leave_type_id=target_lt_id,
                        from_date=reg_req.attendance_date,
                        to_date=reg_req.attendance_date,
                        number_of_days=1.0,
                        reason=f"Attendance Regularization #{reg_req.id} adjusted against leave",
                        status="APPROVED",
                        approval_status="APPROVED",
                        approved_by=reviewer_id,
                        approval_remarks=manager_remarks,
                        created_by=reviewer_id,
                        updated_by=reviewer_id,
                    )
                    self.db.add(leave_req)

                    audit = HrmsLeaveAdjustment(
                        employee_id=reg_req.employee_id,
                        leave_type_id=target_lt_id,
                        adjustment_type="LEAVE_APPROVED",
                        amount=-1.0,
                        previous_balance=prev_available,
                        new_balance=bal.available,
                        reason=f"Attendance Regularization #{reg_req.id} adjusted against leave",
                        remarks=manager_remarks,
                        source="REGULARIZATION",
                        effective_date=reg_req.attendance_date,
                        adjusted_by=reviewer_id,
                    )
                    self.db.add(audit)

        if att_rec:
            att_rec.regularization_status = "APPROVED"
            att_rec.status = "LEAVE" if action == "ADJUST_LEAVE" else "PRESENT"
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

        await self.db.flush()
        try:
            await notify_regularization_decision(
                self.db,
                employee_id=reg_req.employee_id,
                decision="APPROVED",
                attendance_date=reg_req.attendance_date.isoformat(),
                actor_id=reviewer_id,
                request_id=reg_req.id,
            )
        except Exception as exc:
            logger.warning("Failed to dispatch regularization approval notification: %s", exc)
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
            employee_name=(emp.display_name or f"{emp.first_name or ''} {emp.last_name or ''}".strip() or emp.username or "Employee") if emp else "Employee",
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
            reviewed_by_name=(rev.display_name or f"{rev.first_name or ''} {rev.last_name or ''}".strip() or rev.username) if rev else None,
            manager_remarks=reg_req.manager_remarks,
            action_taken=reg_req.action_taken,
        )

    async def reject_regularization(
        self,
        request_id: uuid.UUID,
        reviewer_id: uuid.UUID,
        payload: Optional[RegularizationRejectAction] = None,
        ctx=None,
    ) -> RegularizationRead:
        res = await self.db.execute(
            select(HrmsAttendanceRegularization)
            .where(HrmsAttendanceRegularization.id == request_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        reg_req = res.scalar_one_or_none()
        if not reg_req:
            raise NotFoundException(f"Regularization request {request_id} not found.")

        if reg_req.status != "PENDING":
            raise BadRequestException(
                f"Regularization request is already {reg_req.status.lower()} and cannot be reviewed again."
            )

        await self._enforce_regularization_reviewer_auth(
            reviewer_id=reviewer_id,
            target_employee_id=reg_req.employee_id,
            action_label="reject",
            ctx=ctx,
        )

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

        await self.db.flush()
        try:
            await notify_regularization_decision(
                self.db,
                employee_id=reg_req.employee_id,
                decision="REJECTED",
                attendance_date=reg_req.attendance_date.isoformat(),
                actor_id=reviewer_id,
                request_id=reg_req.id,
            )
        except Exception as exc:
            logger.warning("Failed to dispatch regularization rejection notification: %s", exc)
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
            employee_name=(emp.display_name or f"{emp.first_name or ''} {emp.last_name or ''}".strip() or emp.username or "Employee") if emp else "Employee",
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
            reviewed_by_name=(rev.display_name or f"{rev.first_name or ''} {rev.last_name or ''}".strip() or rev.username) if rev else None,
            manager_remarks=reg_req.manager_remarks,
            action_taken=reg_req.action_taken,
        )

    async def cancel_regularization(
        self,
        request_id: uuid.UUID,
        actor_id: uuid.UUID,
        payload: Optional[RegularizationCancelAction] = None,
        ctx=None,
    ) -> RegularizationRead:
        """
        Cancel a PENDING attendance regularization request without deleting audit history.
        - Serialized with FOR UPDATE + populate_existing=True against concurrent approve/reject.
        - Permitted only for requester, Admin, HR, or authorized manager of the requester.
        - Terminal states (APPROVED, REJECTED, CANCELLED) cannot be cancelled.
        - Restores linked HrmsAttendance.regularization_status from PENDING back to NONE.
        """
        res = await self.db.execute(
            select(HrmsAttendanceRegularization)
            .where(HrmsAttendanceRegularization.id == request_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        reg_req = res.scalar_one_or_none()
        if not reg_req:
            raise NotFoundException(f"Regularization request {request_id} not found.")

        resolved_ctx = ctx if ctx is not None else await self._resolve_hrms_context_for_user(actor_id)
        if resolved_ctx.user_id != actor_id:
            raise ForbiddenException("Actor identity does not match authenticated context.")

        is_owner = reg_req.employee_id == actor_id
        is_authorized_actor = (
            is_owner
            or resolved_ctx.is_admin
            or resolved_ctx.is_hr
            or (resolved_ctx.is_manager and reg_req.employee_id in resolved_ctx.managed_employee_ids)
        )
        if not is_authorized_actor:
            raise ForbiddenException(
                "Permission denied. Only the requester, their manager, HR, or an Administrator can cancel this regularization request."
            )

        if reg_req.status != "PENDING":
            raise BadRequestException(
                f"Cannot cancel regularization request with status '{reg_req.status}'. Only PENDING requests can be cancelled."
            )

        now_ist = datetime.now(IST)
        cancel_reason = (
            payload.reason.strip()
            if payload and payload.reason and payload.reason.strip()
            else ("Cancelled by requester" if is_owner else "Cancelled by authorized reviewer")
        )

        reg_req.status = "CANCELLED"
        reg_req.reviewed_at = now_ist
        reg_req.reviewed_by = actor_id
        reg_req.action_taken = "CANCELLED"
        reg_req.manager_remarks = cancel_reason

        # Restore linked attendance record if it is still referencing this PENDING request
        att_rec = None
        if reg_req.attendance_record_id:
            att_res = await self.db.execute(
                select(HrmsAttendance)
                .where(HrmsAttendance.id == reg_req.attendance_record_id)
                .with_for_update()
                .execution_options(populate_existing=True)
            )
            att_rec = att_res.scalar_one_or_none()
        if not att_rec:
            att_res = await self.db.execute(
                select(HrmsAttendance)
                .where(
                    HrmsAttendance.employee_id == reg_req.employee_id,
                    HrmsAttendance.attendance_date == reg_req.attendance_date,
                )
                .with_for_update()
                .execution_options(populate_existing=True)
            )
            att_rec = att_res.scalar_one_or_none()

        if att_rec and att_rec.regularization_status == "PENDING":
            att_rec.regularization_status = "NONE"
            att_rec.regularization_note = f"Cancelled: {cancel_reason}"

        await self.db.flush()
        try:
            await notify_regularization_cancelled(
                self.db,
                employee_id=reg_req.employee_id,
                attendance_date=reg_req.attendance_date.isoformat(),
                actor_id=actor_id,
                request_id=reg_req.id,
                reason=cancel_reason,
            )
        except Exception as exc:
            logger.warning("Failed to dispatch regularization cancellation notification: %s", exc)
        await self.db.commit()
        await self.db.refresh(reg_req)

        users_res = await self.db.execute(
            select(User).where(User.id.in_([reg_req.employee_id, actor_id]))
        )
        users_map = {u.id: u for u in users_res.scalars().all()}
        emp = users_map.get(reg_req.employee_id)
        rev = users_map.get(actor_id)

        punch_in_str = reg_req.punch_in_time or format_time_ist(att_rec.punch_in if att_rec else None)
        punch_out_str = reg_req.punch_out_time or format_time_ist(att_rec.punch_out if att_rec else None)
        hours_str = reg_req.total_hours
        if not hours_str and att_rec and att_rec.working_minutes:
            hours_str = f"{att_rec.working_minutes // 60}h {att_rec.working_minutes % 60:02d}m"

        return RegularizationRead(
            id=reg_req.id,
            employee_id=reg_req.employee_id,
            employee_name=(emp.display_name or f"{emp.first_name or ''} {emp.last_name or ''}".strip() or emp.username or "Employee") if emp else "Employee",
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
            reviewed_by_name=(rev.display_name or f"{rev.first_name or ''} {rev.last_name or ''}".strip() or rev.username) if rev else None,
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

    # -----------------------------------------------------------------------
    # Geofence Exit & Return Timer Verification
    # -----------------------------------------------------------------------
    async def check_geofence_status(
        self,
        employee_id: uuid.UUID,
        latitude: float,
        longitude: float,
        accuracy: Optional[float] = 10.0,
        gps_timestamp: Optional[datetime] = None,
    ) -> GeofenceCheckResponse:
        """
        Evaluate employee's current GPS position against their assigned office geofence.
        Validates coordinate finiteness/bounds, rejects (0,0) & invalid accuracy/freshness,
        serializes concurrent heartbeats via PostgreSQL advisory lock to prevent duplicate
        open violation rows, handles poor-accuracy GPS drift without false exits,
        manages return timers, and resolves events upon return inside perimeter.
        """
        # 1. Strict GPS coordinate, accuracy, and optional freshness validation (HRMS-BUG-13)
        if not math.isfinite(latitude) or not math.isfinite(longitude):
            raise BadRequestException("Invalid GPS coordinates: latitude and longitude must be finite numbers.")
        if not (-90.0 <= latitude <= 90.0) or not (-180.0 <= longitude <= 180.0):
            raise BadRequestException("Invalid GPS coordinates: latitude must be within [-90, 90] and longitude within [-180, 180].")
        if abs(latitude) < 1e-6 and abs(longitude) < 1e-6:
            raise BadRequestException("Invalid GPS coordinates: (0, 0) coordinates are not permitted.")
        if accuracy is not None and (not math.isfinite(accuracy) or accuracy < 0.0):
            raise BadRequestException("Invalid GPS accuracy value: must be a finite, non-negative number.")

        now = datetime.now(timezone.utc)
        if gps_timestamp is not None:
            validate_gps_freshness(gps_timestamp, server_now_utc=now)

        from app.hrms.service import HrmsSetupService
        setup_svc = HrmsSetupService(self.db)
        settings = await setup_svc.get_effective_tracking_settings(employee_id)

        primary_office, permitted_offices = await self.get_permitted_locations(employee_id)
        if not permitted_offices:
            raise BadRequestException("No active office locations are assigned for geofence verification.")

        validating_office = None
        validating_distance = None
        closest_office = primary_office or permitted_offices[0]
        closest_distance = float("inf")

        for off in permitted_offices:
            dist = haversine_distance(latitude, longitude, off.latitude, off.longitude)
            if not math.isfinite(dist):
                continue
            allowed_r = float(off.radius_meters or 150.0)
            if dist <= allowed_r:
                validating_office = off
                validating_distance = dist
                break
            if dist < closest_distance:
                closest_distance = dist
                closest_office = off

        if not math.isfinite(closest_distance) and validating_distance is None:
            raise BadRequestException("Unable to compute finite geofence distance for assigned offices.")

        is_inside_geofence = (validating_office is not None)
        office = validating_office if is_inside_geofence else closest_office
        distance = validating_distance if is_inside_geofence else closest_distance
        allowed_radius = float(office.radius_meters or 150.0)

        max_acc = float(settings.max_gps_accuracy_meters or 50.0)
        # If accuracy is unreliable, do not trigger a false exit or false return
        if accuracy is not None and accuracy > max_acc:
            stmt = (
                select(HrmsGeofenceViolation)
                .where(
                    HrmsGeofenceViolation.employee_id == employee_id,
                    HrmsGeofenceViolation.status.in_(["ACTIVE_EXIT", "EXPIRED"]),
                    HrmsGeofenceViolation.return_time.is_(None),
                )
                .order_by(HrmsGeofenceViolation.exit_time.desc())
                .limit(1)
            )
            incident = (await self.db.execute(stmt)).scalar_one_or_none()
            if incident:
                rem_secs = None
                if incident.expiry_time and incident.expiry_time > now:
                    rem_secs = max(0, int((incident.expiry_time - now).total_seconds()))
                return GeofenceCheckResponse(
                    is_inside=False,
                    status="EXPIRED" if incident.status == "EXPIRED" else "OUTSIDE_PENDING",
                    distance_meters=round(distance, 1),
                    boundary_radius_meters=allowed_radius,
                    office_name=office.name,
                    active_exit=True,
                    is_expired=(incident.status == "EXPIRED"),
                    remaining_seconds=rem_secs,
                    is_unlimited=settings.is_unlimited_return,
                    incident_id=incident.id,
                )
            return GeofenceCheckResponse(
                is_inside=is_inside_geofence,
                status="POOR_ACCURACY",
                distance_meters=round(distance, 1),
                boundary_radius_meters=allowed_radius,
                office_name=office.name,
                active_exit=False,
                is_expired=False,
                remaining_seconds=None,
                is_unlimited=settings.is_unlimited_return,
                incident_id=None,
            )

        # Serialize concurrent geofence heartbeats per employee on PostgreSQL (HRMS-BUG-20)
        if isinstance(self.db, AsyncSession):
            bind = self.db.get_bind()
            if bind is not None and bind.dialect.name == "postgresql":
                await self.db.execute(
                    text("SELECT pg_advisory_xact_lock(hashtext(:lock_key))"),
                    {"lock_key": f"hrms_geofence:{employee_id}"},
                )

        # Fetch active exit incident (locked)
        stmt = (
            select(HrmsGeofenceViolation)
            .where(
                HrmsGeofenceViolation.employee_id == employee_id,
                HrmsGeofenceViolation.status.in_(["ACTIVE_EXIT", "EXPIRED"]),
                HrmsGeofenceViolation.return_time.is_(None),
            )
            .order_by(HrmsGeofenceViolation.exit_time.desc())
            .limit(1)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        incident = (await self.db.execute(stmt)).scalar_one_or_none()

        if distance > allowed_radius:
            # OUTSIDE GEOFENCE
            timer_secs = settings.return_timer_seconds
            is_unlimited = settings.is_unlimited_return

            if not incident:
                # Start new exit event
                if is_unlimited:
                    exp_time = None
                    init_status = "ACTIVE_EXIT"
                elif timer_secs == 0:
                    # Immediate timeout expiry -> Persist violation event directly
                    exp_time = now
                    init_status = "EXPIRED"
                else:
                    exp_time = now + timedelta(seconds=timer_secs or 300)
                    init_status = "ACTIVE_EXIT"

                incident = HrmsGeofenceViolation(
                    employee_id=employee_id,
                    location_id=office.id,
                    exit_time=now,
                    expiry_time=exp_time,
                    status=init_status,
                    distance_meters=round(distance, 1),
                    boundary_radius_meters=allowed_radius,
                    last_latitude=latitude,
                    last_longitude=longitude,
                    notes=f"Exited {office.name} boundary by {round(distance - allowed_radius, 1)}m",
                )
                self.db.add(incident)
                await self.db.commit()
                await self.db.refresh(incident)
            else:
                # Update existing incident without creating duplicates
                incident.last_latitude = latitude
                incident.last_longitude = longitude
                incident.distance_meters = round(distance, 1)

                # Check if timer expired
                if incident.status == "ACTIVE_EXIT" and incident.expiry_time and now >= incident.expiry_time:
                    incident.status = "EXPIRED"

                await self.db.commit()
                await self.db.refresh(incident)

            rem_secs = None
            if incident.expiry_time and incident.expiry_time > now:
                rem_secs = max(0, int((incident.expiry_time - now).total_seconds()))
            elif incident.status == "EXPIRED":
                rem_secs = 0

            return GeofenceCheckResponse(
                is_inside=False,
                status="EXPIRED" if (incident.status == "EXPIRED") else "OUTSIDE_PENDING",
                distance_meters=round(distance, 1),
                boundary_radius_meters=allowed_radius,
                office_name=office.name,
                active_exit=True,
                is_expired=(incident.status == "EXPIRED"),
                remaining_seconds=rem_secs,
                is_unlimited=is_unlimited,
                incident_id=incident.id,
            )
        else:
            # INSIDE GEOFENCE
            was_exit = False
            if incident:
                was_exit = True
                if incident.status == "ACTIVE_EXIT":
                    # Returned before expiry: cancel timer and resolve
                    incident.status = "RESOLVED_RETURNED"
                    incident.return_time = now
                elif incident.status == "EXPIRED":
                    incident.return_time = now
                await self.db.commit()

            return GeofenceCheckResponse(
                is_inside=True,
                status="RESOLVED" if was_exit else "INSIDE",
                distance_meters=round(distance, 1),
                boundary_radius_meters=allowed_radius,
                office_name=office.name,
                active_exit=False,
                is_expired=False,
                remaining_seconds=None,
                is_unlimited=settings.is_unlimited_return,
                incident_id=None,
            )

    # -----------------------------------------------------------------------
    # Authoritative Attendance Excel (.xlsx) Export
    # -----------------------------------------------------------------------
    async def export_attendance_excel(
        self,
        start_date: date,
        end_date: date,
        employee_id: Optional[uuid.UUID] = None,
        allowed_employee_ids: Optional[set[uuid.UUID]] = None,
        is_admin: bool = False,
        calendar_month_name: Optional[str] = None,
    ) -> tuple[io.BytesIO, int, int]:
        """
        Export authoritative attendance records directly from PostgreSQL to a styled Excel (.xlsx) workbook.
        Builds the Monthly Attendance Matrix, Monthly Summary, and Daily Punch Register.
        Returns (BytesIO buffer, total_employees_count, total_attendance_records_count).
        """
        from app.hrms.attendance_export_builder import build_monthly_attendance_excel
        return await build_monthly_attendance_excel(
            db=self.db,
            start_date=start_date,
            end_date=end_date,
            employee_id=employee_id,
            allowed_employee_ids=allowed_employee_ids,
            is_admin=is_admin,
            calendar_month_name=calendar_month_name,
        )

    # -----------------------------------------------------------------------
    # All-Employee Attendance Calendar Matrix & Summary
    # -----------------------------------------------------------------------
    async def get_all_employees_calendar(
        self,
        year: int,
        month: int,
        allowed_employee_ids: Optional[set[uuid.UUID]] = None,
        department: Optional[str] = None,
        branch: Optional[str] = None,
        employee_id: Optional[uuid.UUID] = None,
        search: Optional[str] = None,
    ) -> dict:
        """
        Retrieves monthly attendance calendar matrix for all authorized employees.
        Uses actual PostgreSQL attendance records, leaves, holidays and policies.
        Enforces strict RBAC scoping, holiday applicability, and attendance calculations.
        """
        _, num_days = calendar.monthrange(year, month)
        today = datetime.now(IST).date()
        start_date = date(year, month, 1)
        end_date = date(year, month, num_days)
        date_list = [date(year, month, d) for d in range(1, num_days + 1)]
        day_names = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
        month_name = start_date.strftime("%B %Y")

        # 1. Fetch policy for shifts & weekly offs
        policy = await self.get_policy()
        shift_name = policy.shift_name or "General Shift"
        shift_start = policy.shift_start_time or "10:30"
        shift_end = policy.shift_end_time or "19:00"
        weekly_off_raw = (policy.weekly_off or "Sunday").strip()
        weekly_off_days = {d.strip().capitalize() for d in weekly_off_raw.split(",") if d.strip()}
        if not weekly_off_days:
            weekly_off_days = {"Sunday"}

        # 2. Query authorized employees
        user_stmt = (
            select(User)
            .where(
                User.deleted_at.is_(None),
                User.is_active.is_(True),
                User.status == UserStatus.ACTIVE,
            )
            .order_by(User.first_name.asc(), User.last_name.asc(), User.username.asc())
        )
        if employee_id:
            user_stmt = user_stmt.where(User.id == employee_id)
        elif allowed_employee_ids is not None:
            user_stmt = user_stmt.where(User.id.in_(allowed_employee_ids))

        users = list((await self.db.execute(user_stmt)).scalars().all())
        all_uids = [u.id for u in users]

        # 3. Batch resolve departments and branches
        dept_map: dict[uuid.UUID, str] = {}
        branch_map: dict[uuid.UUID, str] = {}

        if all_uids:
            try:
                from app.rbac.models import UserRole, Role
                r_stmt = (
                    select(UserRole.user_id, Role.name)
                    .join(Role, Role.id == UserRole.role_id)
                    .where(UserRole.user_id.in_(all_uids), Role.deleted_at.is_(None))
                )
                for uid, rname in (await self.db.execute(r_stmt)).all():
                    if rname.lower() not in ("user", "employee", "department_manager", "super_admin", "admin") and uid not in dept_map:
                        dept_map[uid] = rname
            except Exception:
                pass

            try:
                loc_stmt = (
                    select(HrmsEmployeeLocation.user_id, HrmsLocation.name)
                    .join(HrmsLocation, HrmsLocation.id == HrmsEmployeeLocation.location_id)
                    .where(HrmsEmployeeLocation.user_id.in_(all_uids), HrmsLocation.deleted_at.is_(None))
                    .order_by(HrmsEmployeeLocation.is_primary.desc())
                )
                for uid, lname in (await self.db.execute(loc_stmt)).all():
                    if uid not in branch_map:
                        branch_map[uid] = lname
            except Exception:
                pass

        # Collect all distinct departments and branches before filtering for frontend dropdowns
        all_departments = sorted(list({dept_map.get(u.id) or getattr(u, "department", None) or "General" for u in users}))
        all_branches = sorted(list({branch_map.get(u.id) or "Thane" for u in users}))

        # Apply department & branch filters if requested
        if department and department.strip() and department.strip().lower() != "all":
            d_filter = department.strip().lower()
            users = [u for u in users if (dept_map.get(u.id) or getattr(u, "department", None) or "General").lower() == d_filter]

        if branch and branch.strip() and branch.strip().lower() != "all":
            b_filter = branch.strip().lower()
            users = [u for u in users if (branch_map.get(u.id) or "Thane").lower() == b_filter]

        if search and search.strip():
            s_term = search.strip().lower()
            users = [
                u for u in users
                if s_term in f"{u.display_name or ''} {u.first_name or ''} {u.last_name or ''} {u.username or ''} {u.employee_code or ''}".lower()
            ]

        filtered_uids = [u.id for u in users]

        # 4. Batch query holidays in month
        hol_stmt = select(HrmsHoliday).where(
            HrmsHoliday.deleted_at.is_(None),
            HrmsHoliday.is_active.is_(True),
            HrmsHoliday.holiday_date >= start_date,
            HrmsHoliday.holiday_date <= end_date,
        )
        all_holidays = list((await self.db.execute(hol_stmt)).scalars().all())

        # 5. Batch query approved leaves in month
        emp_leave_map: dict[uuid.UUID, dict[date, tuple[HrmsLeaveRequest, HrmsLeaveType]]] = {}
        if filtered_uids:
            leaves_stmt = (
                select(HrmsLeaveRequest, HrmsLeaveType)
                .join(HrmsLeaveType, HrmsLeaveType.id == HrmsLeaveRequest.leave_type_id)
                .where(
                    HrmsLeaveRequest.employee_id.in_(filtered_uids),
                    HrmsLeaveRequest.approval_status == "APPROVED",
                    HrmsLeaveRequest.from_date <= end_date,
                    HrmsLeaveRequest.to_date >= start_date,
                )
            )
            all_leaves = list((await self.db.execute(leaves_stmt)).all())
            for req, lt in all_leaves:
                cur = max(req.from_date, start_date)
                req_end = min(req.to_date, end_date)
                if req.employee_id not in emp_leave_map:
                    emp_leave_map[req.employee_id] = {}
                while cur <= req_end:
                    emp_leave_map[req.employee_id][cur] = (req, lt)
                    cur += timedelta(days=1)

        # 6. Batch query attendance records in month
        emp_att_map: dict[tuple[uuid.UUID, date], HrmsAttendance] = {}
        if filtered_uids:
            att_stmt = select(HrmsAttendance).where(
                HrmsAttendance.employee_id.in_(filtered_uids),
                HrmsAttendance.attendance_date >= start_date,
                HrmsAttendance.attendance_date <= end_date,
            )
            all_attendance = list((await self.db.execute(att_stmt)).scalars().all())
            for a in all_attendance:
                emp_att_map[(a.employee_id, a.attendance_date)] = a

        # 7. Evaluate attendance and build calendar matrix for each employee
        employees_data = []

        for u in users:
            emp_branch = branch_map.get(u.id) or "Thane"
            emp_dept = dept_map.get(u.id) or getattr(u, "department", None) or "General"
            emp_code = u.employee_code or getattr(u, "code", None) or f"EMP-{str(u.id)[:6].upper()}"
            first = u.first_name or ""
            last = u.last_name or ""
            emp_name = getattr(u, "display_name", None) or f"{first} {last}".strip() or u.username or "Employee"
            doj = getattr(u, "date_of_joining", None)

            # Holiday resolution for this employee
            emp_hol_map: dict[date, HrmsHoliday] = {}
            for h in all_holidays:
                b_app = (h.branch_applicability or "All Branches").lower()
                d_app = (getattr(h, "department_scope", None) or "All Departments").lower()
                if ("all" in b_app or emp_branch.lower() in b_app) and ("all" in d_app or emp_dept.lower() in d_app):
                    emp_hol_map[h.holiday_date] = h

            leaves_for_emp = emp_leave_map.get(u.id, {})
            has_records = any((u.id, d) in emp_att_map for d in date_list) or len(leaves_for_emp) > 0

            days = []
            present_days = 0.0
            absent_days = 0.0
            half_days = 0.0
            paid_leave_days = 0.0
            unpaid_leave_days = 0.0
            holiday_days = 0
            weekend_days = 0
            working_days_count = 0
            total_working_mins = 0

            for d in date_list:
                day_num = d.day
                weekday_idx = d.weekday()
                day_name = day_names[weekday_idx]
                day_full_name = d.strftime("%A")
                is_weekend = day_full_name in weekly_off_days
                is_holiday = d in emp_hol_map
                holiday_obj = emp_hol_map.get(d)
                leave_info = leaves_for_emp.get(d)
                att_rec = emp_att_map.get((u.id, d))

                if is_weekend:
                    weekend_days += 1
                elif is_holiday:
                    holiday_days += 1
                else:
                    working_days_count += 1

                # Prioritized daily status evaluation
                status_code = "-"
                status_label = "-"
                punch_in_str = None
                punch_out_str = None
                wm: Optional[int] = None
                late_m = 0
                early_m = 0
                is_irreg = False
                reg_status = "NONE"
                reg_reason = None
                reg_note = None
                h_name = None
                l_name = None
                is_lop = False
                att_id = None

                if is_holiday:
                    status_code = "HOLIDAY"
                    status_label = "Holiday"
                    h_name = holiday_obj.name if holiday_obj else "Holiday"

                elif leave_info:
                    req_obj, lt_obj = leave_info
                    is_half_leave = (
                        req_obj.from_date == req_obj.to_date
                        and abs(float(req_obj.number_of_days or 1.0) - 0.5) < 1e-6
                    )
                    lv_weight = 0.5 if is_half_leave else 1.0
                    l_name = f"{lt_obj.name} (Half Day)" if (lt_obj and is_half_leave) else (lt_obj.name if lt_obj else "Leave")
                    if lt_obj and getattr(lt_obj, "is_paid", True):
                        paid_leave_days += lv_weight
                    else:
                        unpaid_leave_days += lv_weight
                        is_lop = True

                    if is_half_leave and att_rec:
                        att_id = str(att_rec.id)
                        wm = att_rec.working_minutes or 0
                        total_working_mins += wm
                        punch_in_str = format_time_ist(att_rec.punch_in)
                        punch_out_str = format_time_ist(att_rec.punch_out)
                        present_days += 0.5
                        half_days += 1.0
                        status_code = "HALF_DAY"
                        status_label = "Half Day Leave"
                    elif is_half_leave:
                        status_code = "HALF_DAY"
                        status_label = "Half Day Leave"
                        half_days += 1.0
                        if d < today:
                            absent_days += 0.5
                            is_lop = True
                    else:
                        status_code = "LEAVE"
                        status_label = "On Leave"

                elif att_rec:
                    att_id = str(att_rec.id)
                    wm = att_rec.working_minutes or 0
                    total_working_mins += wm
                    late_m = att_rec.late_minutes or 0
                    early_m = att_rec.early_exit_minutes or 0
                    is_irreg = att_rec.is_irregular
                    reg_status = att_rec.regularization_status or "NONE"
                    reg_reason = att_rec.regularization_reason
                    reg_note = att_rec.regularization_note

                    punch_in_str = format_time_ist(att_rec.punch_in)
                    punch_out_str = format_time_ist(att_rec.punch_out)

                    raw_st = (att_rec.status or "PRESENT").upper()
                    if d == today and att_rec.punch_in and not att_rec.punch_out and raw_st == "PRESENT":
                        raw_st = "IN_PROGRESS"

                    if raw_st in ("PRESENT", "LATE", "IN_PROGRESS") or reg_status == "APPROVED":
                        status_code = "PRESENT" if raw_st != "LATE" else "LATE"
                        status_label = "Present" if raw_st != "LATE" else "Late"
                        if raw_st == "IN_PROGRESS":
                            status_code = "IN_PROGRESS"
                            status_label = "In Progress"
                        present_days += 1.0
                    elif raw_st == "HALF_DAY":
                        status_code = "HALF_DAY"
                        status_label = "Half Day"
                        present_days += 0.5
                        half_days += 1.0
                        is_lop = True
                    elif raw_st == "ABSENT":
                        status_code = "ABSENT"
                        status_label = "Absent"
                        absent_days += 1.0
                        is_lop = True
                    elif raw_st in ("MISSING_PUNCH", "OUTSIDE_GEOFENCE"):
                        status_code = raw_st
                        status_label = raw_st.replace("_", " ").title()
                        present_days += 1.0
                    else:
                        status_code = raw_st
                        status_label = raw_st.replace("_", " ").title()
                        present_days += 1.0

                elif is_weekend:
                    status_code = "WEEKEND"
                    status_label = "Weekend"

                else:
                    # Missing record
                    if doj and d < doj:
                        status_code = "NOT_JOINED"
                        status_label = "Not Joined"
                    elif d < today and has_records:
                        status_code = "ABSENT"
                        status_label = "Absent"
                        absent_days += 1.0
                        is_lop = True
                    elif d == today:
                        status_code = "NOT_PUNCHED"
                        status_label = "Not Punched"
                    else:
                        status_code = "FUTURE"
                        status_label = "Future"

                working_hours_str = f"{wm // 60}h {wm % 60:02d}m" if wm and wm > 0 else ("0h 00m" if punch_in_str else "-")

                days.append({
                    "day": day_num,
                    "day_number": day_num,
                    "date": d.isoformat(),
                    "day_name": day_name,
                    "status": status_code,
                    "status_label": status_label,
                    "punch_in": punch_in_str,
                    "punch_out": punch_out_str,
                    "working_minutes": wm,
                    "working_hours": working_hours_str,
                    "late_minutes": late_m,
                    "early_exit_minutes": early_m,
                    "is_irregular": is_irreg,
                    "regularization_status": reg_status,
                    "regularization_reason": reg_reason,
                    "regularization_note": reg_note,
                    "holiday_name": h_name,
                    "leave_type_name": l_name,
                    "is_lop": is_lop,
                    "attendance_id": att_id,
                    "shift_name": shift_name,
                    "shift_hours": f"{shift_start} - {shift_end}",
                })

            summary = {
                "total_working_days": working_days_count,
                "present_days": present_days,
                "present": present_days,
                "total_present": present_days,
                "absent_days": absent_days,
                "absent": absent_days,
                "total_absent": absent_days,
                "half_days": half_days,
                "half_day": half_days,
                "total_half_day": half_days,
                "leave": paid_leave_days + unpaid_leave_days,
                "total_leave": paid_leave_days + unpaid_leave_days,
                "paid_leave_days": paid_leave_days,
                "unpaid_leave_days": unpaid_leave_days,
                "holiday_days": holiday_days,
                "weekend_days": weekend_days,
                "paid_days": present_days + paid_leave_days + holiday_days + weekend_days,
                "total_working_minutes": total_working_mins,
                "total_working_hours": f"{total_working_mins // 60}h {total_working_mins % 60:02d}m",
            }

            employees_data.append({
                "employee_id": str(u.id),
                "employee_name": emp_name,
                "employee_code": emp_code,
                "department": emp_dept,
                "branch": emp_branch,
                "days": days,
                "summary": summary,
            })

        return {
            "year": year,
            "month": month,
            "month_name": month_name,
            "total_days": num_days,
            "departments": all_departments,
            "branches": all_branches,
            "employees": employees_data,
        }


