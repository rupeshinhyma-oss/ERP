"""
Unit tests for HRMS Attendance, Regularization, Settings, and Geo Fencing Schemas/Services.
"""

from __future__ import annotations

import datetime
import pytest

from app.hrms.schemas import (
    RegularizationRequestCreate,
    ApprovalActionPayload,
    AdjustedLeaveActionPayload,
    AttendanceSettingsUpdate,
    AttendanceExemptionCreate,
    LocationCreate,
    LocationUpdate,
    LocationType,
)
from app.hrms.service import generate_query_strategies, _parse_osm_feature


def test_regularization_request_schema():
    payload = RegularizationRequestCreate(
        attendance_date=datetime.date(2026, 9, 21),
        check_in="09:15",
        check_out="18:30",
        total_hours="9h 15m",
        reason="Biometric fingerprint machine scanner glitch on arrival",
    )
    assert payload.attendance_date == datetime.date(2026, 9, 21)
    assert payload.check_in == "09:15"
    assert payload.check_out == "18:30"
    assert payload.total_hours == "9h 15m"
    assert "fingerprint" in payload.reason


def test_approval_action_payload():
    payload = ApprovalActionPayload(
        status="APPROVED",
        manager_remarks="Verified with gate security log and CCTV. Approved.",
    )
    assert payload.status == "APPROVED"
    assert "CCTV" in payload.manager_remarks


def test_adjusted_leave_action_payload():
    payload = AdjustedLeaveActionPayload(
        action="ADJUST_LEAVE",
        leave_type="Casual Leave",
        manager_remarks="Deducted 0.5 CL as per HR policy.",
    )
    assert payload.action == "ADJUST_LEAVE"
    assert payload.leave_type == "Casual Leave"
    assert "0.5 CL" in payload.manager_remarks


def test_attendance_settings_update_no_mandatory_break():
    """Verify that AttendanceSettingsUpdate has all configuration fields and no mandatory break."""
    payload = AttendanceSettingsUpdate(
        shift_name="General Shift",
        employment_type="Full Time",
        max_late_check_in="09:30",
        max_early_check_out="17:30",
        grace_period_mins=30,
        late_attendance_rule="Deduct Half Day After 3 Instances",
        recurring_cycle="Monthly (1st - 31st)",
        min_overtime_mins=60,
        max_overtime_mins=240,
        holiday_overtime="2.0x Standard Rate",
        weekend_overtime="1.5x Standard Rate",
        approval_required=True,
    )
    data = payload.model_dump()
    assert data["shift_name"] == "General Shift"
    assert data["grace_period_mins"] == 30
    assert data["holiday_overtime"] == "2.0x Standard Rate"
    assert "mandatory_break" not in data


def test_attendance_exemption_create():
    payload = AttendanceExemptionCreate(
        user_id="user-12345",
        exemption_type="Skip Late Rule",
        effective_from=datetime.date(2026, 9, 1),
    )
    assert payload.user_id == "user-12345"
    assert payload.exemption_type == "Skip Late Rule"
    assert payload.effective_from == datetime.date(2026, 9, 1)


def test_location_create_validation():
    payload = LocationCreate(
        name="Mumbai BKC Office",
        location_type=LocationType.OFFICE,
        address="Bandra Kurla Complex, Bandra East, Mumbai, Maharashtra 400051",
        latitude=19.0664,
        longitude=72.8687,
        radius_meters=150.0,
        place_id="ChIJ_3_sBK7P5zsRv9E3Z4123",
    )
    assert payload.name == "Mumbai BKC Office"
    assert payload.radius_meters == 150.0
    assert payload.latitude == 19.0664
    assert payload.longitude == 72.8687


def test_generate_query_strategies_progressive_fallbacks():
    strategies = generate_query_strategies("Unit 402, Lodha Supremus, Road No. 22, Wagle Estate, Thane, Maharashtra 400604")
    assert len(strategies) > 1
    # Full address is first
    assert "Lodha Supremus" in strategies[0]
    # Unit token should be stripped in progressive fallback strategies
    assert any("Lodha Supremus" in s and not s.startswith("Unit 402") for s in strategies)


def test_haversine_distance_meters():
    from app.hrms.service import haversine_distance_meters
    # Distance between Thane office (19.198300, 72.948300) and Pune (18.5204, 73.8567) is ~120-130 km
    dist = haversine_distance_meters(19.198300, 72.948300, 18.5204, 73.8567)
    dist_km = dist / 1000.0
    assert 110 < dist_km < 140

    # Distance within same building (e.g. 10 meters)
    near_dist = haversine_distance_meters(19.198300, 72.948300, 19.198350, 72.948320)
    assert near_dist < 50


def test_parse_time_str_to_minutes():
    from app.hrms.service import parse_time_str_to_minutes
    assert parse_time_str_to_minutes("10:30 AM") == 630
    assert parse_time_str_to_minutes("10:45 AM") == 645
    assert parse_time_str_to_minutes("11:31 AM") == 691
    assert parse_time_str_to_minutes("07:00 PM") == 1140


def test_punch_payloads_validation():
    from app.hrms.schemas import PunchInPayload, PunchOutPayload
    pin = PunchInPayload(latitude=19.198300, longitude=72.948300, office_id="off-1")
    assert pin.latitude == 19.198300
    assert pin.longitude == 72.948300
    assert pin.office_id == "off-1"

    pout = PunchOutPayload()
    assert pout.latitude is None
    assert pout.longitude is None


def test_attendance_policy_create_aliases():
    from app.hrms.schemas import AttendancePolicyCreate, AttendancePolicyUpdate
    policy = AttendancePolicyCreate(
        policy_name="Executive Flexible Shift",
        shift_start="10:30 AM",
        shift_end="07:00 PM",
        grace_until="10:45 AM",
        late_after="10:46 AM",
        direct_half_day_after="11:31 AM",
        late_threshold=3,
        active=True,
    )
    assert policy.resolved_name() == "Executive Flexible Shift"
    assert policy.resolved_late_after() == "10:46 AM"
    assert policy.resolved_threshold() == 3
    assert policy.resolved_active() is True


def test_attendance_serialization_aliases():
    from app.hrms.models import HrmsAttendanceLog
    from app.hrms.service import HrmsService
    import uuid

    # Mock log object
    log = HrmsAttendanceLog(
        user_id=uuid.uuid4(),
        attendance_date=datetime.date(2026, 9, 24),
        check_in_time=datetime.datetime(2026, 9, 24, 10, 31, tzinfo=datetime.timezone.utc),
        check_out_time=datetime.datetime(2026, 9, 24, 19, 5, tzinfo=datetime.timezone.utc),
        punch_in="10:31 AM",
        punch_out="07:05 PM",
        status="CLOSED",
        final_status="Present",
        total_hours="08h 34m",
    )
    # Instantiate service with None (no DB needed for pure serializer)
    svc = HrmsService(None)  # type: ignore
    serialized = svc._serialize_attendance_log(log)
    assert serialized["punched_in"] is not None
    assert serialized["punched_out"] is not None
    assert serialized["punch_in"] == "10:31 AM"
    assert serialized["punch_out"] == "07:05 PM"
    assert serialized["total_hours"] == "08h 34m"


def test_attendance_repository_and_routes_import():
    from app.hrms.repository import AttendanceRepository
    from app.attendance.repository import AttendanceRepository as DirectRepo
    from app.attendance.service import AttendanceService
    from app.attendance.routes import router as attendance_router
    assert AttendanceRepository is not None
    assert DirectRepo is not None
    assert AttendanceService is not None
    assert attendance_router is not None


@pytest.mark.asyncio
async def test_policy_evaluation_rules():
    from app.hrms.service import HrmsService
    from app.hrms.models import HrmsAttendancePolicy
    import uuid

    policy = HrmsAttendancePolicy(
        name="General Office Policy",
        shift_start="10:30 AM",
        shift_end="07:00 PM",
        grace_until="10:45 AM",
        late_starts_after="10:46 AM",
        direct_half_day_after="11:30 AM",
        late_marks_before_half_day=3,
        payroll_cycle="1st to 31st of Month",
        is_active=True,
    )

    svc = HrmsService(None)  # type: ignore

    # 10:40 AM IST is 05:10 AM UTC (<= 10:45 AM -> Present)
    dt_present = datetime.datetime(2026, 9, 24, 5, 10, tzinfo=datetime.timezone.utc)
    status, rule = await svc.evaluate_punch_in_status(uuid.uuid4(), dt_present, policy)
    assert status == "Present"

    # 11:30 AM IST is 06:00 AM UTC (>= 11:30 AM -> Immediate Half Day)
    dt_half_day = datetime.datetime(2026, 9, 24, 6, 0, tzinfo=datetime.timezone.utc)
    status, rule = await svc.evaluate_punch_in_status(uuid.uuid4(), dt_half_day, policy)
    assert status == "Half Day"
    assert "Immediate Half Day" in rule


