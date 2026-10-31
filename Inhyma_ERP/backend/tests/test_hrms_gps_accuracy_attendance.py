"""
Automated Verification Tests for GPS Accuracy, Freshness, and Multi-Location Attendance.

Covers:
1. Primary location punch accepted.
2. First additional location punch accepted.
3. Second additional location punch accepted.
4. Unassigned office punch rejected.
5. Inactive assigned location rejected.
13. Accuracy is transmitted correctly.
14. Punch-in accuracy persists.
15. Punch-out accuracy persists.
16. Negative and invalid accuracy values are rejected.
18. Existing attendance records remain readable (null accuracy).
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
import math
from unittest.mock import AsyncMock, MagicMock
import uuid
import pytest
from pydantic import ValidationError

from app.core.exceptions import BadRequestException
from app.hrms.models import (
    HrmsAttendance,
    HrmsAttendancePolicy,
    HrmsLocation,
)
from app.hrms.attendance_service import (
    HrmsAttendanceService,
    IST,
    validate_gps_freshness,
    MAX_GPS_AGE_SECONDS,
    MAX_GPS_FUTURE_TOLERANCE_SECONDS,
)
from app.hrms.schemas import (
    PunchInRequest,
    PunchOutRequest,
    AttendanceRecordRead,
    TodayAttendanceRead,
)


def make_test_location(
    name: str = "Test Office",
    lat: float = 19.198,
    lng: float = 72.947,
    radius: float = 150.0,
    is_active: bool = True,
    loc_id: uuid.UUID | None = None,
) -> HrmsLocation:
    loc = MagicMock(spec=HrmsLocation)
    loc.id = loc_id or uuid.uuid4()
    loc.name = name
    loc.location_type = "Office"
    loc.address = f"Address for {name}"
    loc.latitude = lat
    loc.longitude = lng
    loc.radius_meters = radius
    loc.is_active = is_active
    loc.deleted_at = None
    return loc


def make_test_policy() -> MagicMock:
    p = MagicMock(spec=HrmsAttendancePolicy)
    p.shift_name = "General Shift"
    p.shift_start_time = "10:30"
    p.shift_end_time = "19:00"
    p.geofence_radius_meters = 150.0
    p.enable_grace = True
    p.grace_period_minutes = 15
    p.enable_late_marks = True
    p.count_late_monthly = False
    p.enable_direct_half_day = True
    p.direct_half_day_time = "11:31"
    return p


@pytest.mark.asyncio
async def test_multi_location_punch_in_and_accuracy_persistence():
    """Scenarios 1, 2, 3, 13, 14: Punches at primary, add1, add2 persist accuracy."""
    loc_prim = make_test_location("Thane Office (Primary)", 19.198, 72.947, 150.0)
    loc_add1 = make_test_location("Mumbai Office (Add1)", 19.066, 72.868, 150.0)
    loc_add2 = make_test_location("Gujarat Office (Add2)", 23.033, 72.508, 150.0)

    db = AsyncMock()
    async def mock_refresh(rec):
        rec.id = uuid.uuid4()
        rec.created_at = datetime.now(timezone.utc)
        rec.updated_at = datetime.now(timezone.utc)
    db.refresh = AsyncMock(side_effect=mock_refresh)
    # Mock result of execute for record query
    db.execute = AsyncMock(return_value=MagicMock(scalar_one_or_none=MagicMock(return_value=None)))

    service = HrmsAttendanceService(db)
    service.get_policy = AsyncMock(return_value=make_test_policy())
    service.get_today_attendance = AsyncMock(return_value=None)
    service.get_permitted_locations = AsyncMock(return_value=(loc_prim, [loc_prim, loc_add1, loc_add2]))

    emp_id = uuid.uuid4()

    # 1. Primary punch with accuracy 8.5m
    payload_prim = PunchInRequest(latitude=19.198, longitude=72.947, accuracy=8.5, gps_timestamp=datetime.now(timezone.utc))
    rec1 = await service.punch_in(emp_id, payload_prim)
    assert rec1.office_name == "Thane Office (Primary)"
    assert rec1.punch_in_accuracy_meters == 8.5

    # 2. Add1 punch with accuracy 14.2m
    payload_add1 = PunchInRequest(latitude=19.066, longitude=72.868, accuracy=14.2, gps_timestamp=datetime.now(timezone.utc))
    rec2 = await service.punch_in(emp_id, payload_add1)
    assert rec2.office_name == "Mumbai Office (Add1)"
    assert rec2.punch_in_accuracy_meters == 14.2

    # 3. Add2 punch with accuracy 22.0m
    payload_add2 = PunchInRequest(latitude=23.033, longitude=72.508, accuracy=22.0, gps_timestamp=datetime.now(timezone.utc))
    rec3 = await service.punch_in(emp_id, payload_add2)
    assert rec3.office_name == "Gujarat Office (Add2)"
    assert rec3.punch_in_accuracy_meters == 22.0


@pytest.mark.asyncio
async def test_unassigned_and_inactive_location_punch_rejected():
    """Scenarios 4, 5: Unassigned and inactive locations rejected."""
    loc_prim = make_test_location("Thane Office (Primary)", 19.198, 72.947, 150.0)
    db = AsyncMock()
    service = HrmsAttendanceService(db)
    service.get_policy = AsyncMock(return_value=make_test_policy())
    service.get_today_attendance = AsyncMock(return_value=None)
    service.get_permitted_locations = AsyncMock(return_value=(loc_prim, [loc_prim]))

    emp_id = uuid.uuid4()

    # Unassigned location coordinates (Indore, MP)
    with pytest.raises(BadRequestException) as exc:
        await service.punch_in(emp_id, PunchInRequest(latitude=22.753, longitude=75.893, accuracy=10.0, gps_timestamp=datetime.now(timezone.utc)))
    assert "outside your assigned office locations" in str(exc.value).lower()

    # Inactive location not returned by get_permitted_locations
    loc_inactive = make_test_location("Old Inactive", 19.066, 72.868, 150.0, is_active=False)
    service.get_permitted_locations = AsyncMock(return_value=(loc_prim, [loc_prim]))
    with pytest.raises(BadRequestException) as exc:
        await service.punch_in(emp_id, PunchInRequest(latitude=19.066, longitude=72.868, accuracy=10.0, gps_timestamp=datetime.now(timezone.utc)))
    assert "outside your assigned office locations" in str(exc.value).lower()


@pytest.mark.asyncio
async def test_punch_out_accuracy_persistence():
    """Scenario 15: Punch-out accuracy persists and working minutes calculated."""
    loc_prim = make_test_location("Thane Office", 19.198, 72.947, 150.0)
    emp_id = uuid.uuid4()

    mock_rec = MagicMock(spec=HrmsAttendance)
    mock_rec.id = uuid.uuid4()
    mock_rec.employee_id = emp_id
    mock_rec.attendance_date = date.today()
    mock_rec.punch_in = datetime.now(timezone.utc)
    mock_rec.punch_out = None
    mock_rec.status = "PRESENT"
    mock_rec.working_minutes = 0
    mock_rec.late_minutes = 0
    mock_rec.early_exit_minutes = 0
    mock_rec.office_location_id = loc_prim.id
    mock_rec.latitude = 19.198
    mock_rec.longitude = 72.947
    mock_rec.punch_in_distance = 5.0
    mock_rec.punch_in_accuracy_meters = 7.5
    mock_rec.punch_out_accuracy_meters = None
    mock_rec.is_irregular = False
    mock_rec.regularization_status = "NONE"
    mock_rec.regularization_reason = None
    mock_rec.regularization_note = None
    mock_rec.created_at = datetime.now(timezone.utc)
    mock_rec.updated_at = datetime.now(timezone.utc)

    db = AsyncMock()
    db.execute = AsyncMock(return_value=MagicMock(scalar_one_or_none=MagicMock(return_value=mock_rec)))

    service = HrmsAttendanceService(db)
    service.get_policy = AsyncMock(return_value=make_test_policy())
    service.get_permitted_locations = AsyncMock(return_value=(loc_prim, [loc_prim]))

    payload = PunchOutRequest(latitude=19.198, longitude=72.947, accuracy=12.4, gps_timestamp=datetime.now(timezone.utc))
    rec = await service.punch_out(emp_id, payload)
    assert rec.punch_in_accuracy_meters == 7.5
    assert rec.punch_out_accuracy_meters == 12.4


def test_negative_and_invalid_accuracy_rejected():
    """Scenario 16: Pydantic rejects negative accuracy values."""
    with pytest.raises(ValidationError):
        PunchInRequest(latitude=19.198, longitude=72.947, accuracy=-5.0)

    with pytest.raises(ValidationError):
        PunchOutRequest(latitude=19.198, longitude=72.947, accuracy=-1.0)


@pytest.mark.asyncio
async def test_non_finite_accuracy_rejected_by_service():
    """Scenario 16: Service rejects non-finite accuracy values (inf, nan)."""
    loc_prim = make_test_location("Thane Office", 19.198, 72.947, 150.0)
    db = AsyncMock()
    service = HrmsAttendanceService(db)
    service.get_policy = AsyncMock(return_value=make_test_policy())
    service.get_permitted_locations = AsyncMock(return_value=(loc_prim, [loc_prim]))
    emp_id = uuid.uuid4()

    # Pass infinity via mock or bypass pydantic
    payload_inf = MagicMock(spec=PunchInRequest)
    payload_inf.latitude = 19.198
    payload_inf.longitude = 72.947
    payload_inf.accuracy = float("inf")
    payload_inf.gps_timestamp = datetime.now(timezone.utc)

    with pytest.raises(BadRequestException) as exc:
        await service.punch_in(emp_id, payload_inf)
    assert "invalid gps accuracy value" in str(exc.value).lower()

    # Pass NaN via mock
    payload_nan = MagicMock(spec=PunchInRequest)
    payload_nan.latitude = 19.198
    payload_nan.longitude = 72.947
    payload_nan.accuracy = float("nan")
    payload_nan.gps_timestamp = datetime.now(timezone.utc)

    with pytest.raises(BadRequestException) as exc:
        await service.punch_in(emp_id, payload_nan)
    assert "invalid gps accuracy value" in str(exc.value).lower()


@pytest.mark.asyncio
async def test_gps_accuracy_schema_validation_matrix():
    """Phase 1.2: Validate Pydantic schema validation rules for accuracy."""
    # 1. 5m accepted
    p1 = PunchInRequest(latitude=19.198, longitude=72.947, accuracy=5.0)
    assert p1.accuracy == 5.0
    p1_out = PunchOutRequest(latitude=19.198, longitude=72.947, accuracy=5.0)
    assert p1_out.accuracy == 5.0

    # 2. 50m accepted
    p2 = PunchInRequest(latitude=19.198, longitude=72.947, accuracy=50.0)
    assert p2.accuracy == 50.0

    # 3. Exactly 100.0m boundary accepted
    p3 = PunchInRequest(latitude=19.198, longitude=72.947, accuracy=100.0)
    assert p3.accuracy == 100.0
    p3_out = PunchOutRequest(latitude=19.198, longitude=72.947, accuracy=100.0)
    assert p3_out.accuracy == 100.0

    # 4. 100.1m rejected by schema
    with pytest.raises(ValidationError):
        PunchInRequest(latitude=19.198, longitude=72.947, accuracy=100.1)
    with pytest.raises(ValidationError):
        PunchOutRequest(latitude=19.198, longitude=72.947, accuracy=100.1)

    # 5. 500m rejected by schema
    with pytest.raises(ValidationError):
        PunchInRequest(latitude=19.198, longitude=72.947, accuracy=500.0)
    with pytest.raises(ValidationError):
        PunchOutRequest(latitude=19.198, longitude=72.947, accuracy=500.0)

    # 6. 10000m rejected by schema
    with pytest.raises(ValidationError):
        PunchInRequest(latitude=19.198, longitude=72.947, accuracy=10000.0)
    with pytest.raises(ValidationError):
        PunchOutRequest(latitude=19.198, longitude=72.947, accuracy=10000.0)

    # 7. Missing accuracy rejected by schema
    with pytest.raises(ValidationError):
        PunchInRequest(latitude=19.198, longitude=72.947)  # type: ignore
    with pytest.raises(ValidationError):
        PunchOutRequest(latitude=19.198, longitude=72.947)  # type: ignore

    # 8. Negative accuracy rejected by schema
    with pytest.raises(ValidationError):
        PunchInRequest(latitude=19.198, longitude=72.947, accuracy=-0.1)
    with pytest.raises(ValidationError):
        PunchOutRequest(latitude=19.198, longitude=72.947, accuracy=-0.1)

    # 9. NaN rejected by schema
    with pytest.raises(ValidationError):
        PunchInRequest(latitude=19.198, longitude=72.947, accuracy=float("nan"))
    with pytest.raises(ValidationError):
        PunchOutRequest(latitude=19.198, longitude=72.947, accuracy=float("nan"))

    # 10. Infinity rejected by schema
    with pytest.raises(ValidationError):
        PunchInRequest(latitude=19.198, longitude=72.947, accuracy=float("inf"))
    with pytest.raises(ValidationError):
        PunchOutRequest(latitude=19.198, longitude=72.947, accuracy=float("inf"))


@pytest.mark.asyncio
async def test_gps_accuracy_service_enforcement_punch_in_and_punch_out():
    """Phase 1.2: Validate attendance_service server-side enforcement for punch-in and punch-out."""
    loc_prim = make_test_location("Thane Office", 19.198, 72.947, 150.0)
    emp_id = uuid.uuid4()

    mock_rec = MagicMock(spec=HrmsAttendance)
    mock_rec.id = uuid.uuid4()
    mock_rec.employee_id = emp_id
    mock_rec.attendance_date = date.today()
    mock_rec.punch_in = datetime.now(timezone.utc)
    mock_rec.punch_out = None
    mock_rec.status = "PRESENT"
    mock_rec.working_minutes = 0
    mock_rec.late_minutes = 0
    mock_rec.early_exit_minutes = 0
    mock_rec.office_location_id = loc_prim.id
    mock_rec.latitude = 19.198
    mock_rec.longitude = 72.947
    mock_rec.punch_in_distance = 5.0
    mock_rec.punch_in_accuracy_meters = 10.0
    mock_rec.punch_out_accuracy_meters = None
    mock_rec.is_irregular = False
    mock_rec.regularization_status = "NONE"
    mock_rec.regularization_reason = None
    mock_rec.regularization_note = None
    mock_rec.created_at = datetime.now(timezone.utc)
    mock_rec.updated_at = datetime.now(timezone.utc)

    db = AsyncMock()
    async def mock_refresh(rec):
        rec.id = uuid.uuid4()
        rec.created_at = datetime.now(timezone.utc)
        rec.updated_at = datetime.now(timezone.utc)
    db.refresh = AsyncMock(side_effect=mock_refresh)
    db.execute = AsyncMock(return_value=MagicMock(scalar_one_or_none=MagicMock(return_value=mock_rec)))

    service = HrmsAttendanceService(db)
    service.get_policy = AsyncMock(return_value=make_test_policy())
    service.get_today_attendance = AsyncMock(return_value=None)
    service.get_permitted_locations = AsyncMock(return_value=(loc_prim, [loc_prim]))

    now_ts = datetime.now(timezone.utc)

    # 1. 5m accepted by punch_in
    rec_5 = await service.punch_in(emp_id, PunchInRequest(latitude=19.198, longitude=72.947, accuracy=5.0, gps_timestamp=now_ts))
    assert rec_5.punch_in_accuracy_meters == 5.0

    # 2. 50m accepted by punch_in
    rec_50 = await service.punch_in(emp_id, PunchInRequest(latitude=19.198, longitude=72.947, accuracy=50.0, gps_timestamp=now_ts))
    assert rec_50.punch_in_accuracy_meters == 50.0

    # 3. 100m accepted by punch_in
    rec_100 = await service.punch_in(emp_id, PunchInRequest(latitude=19.198, longitude=72.947, accuracy=100.0, gps_timestamp=now_ts))
    assert rec_100.punch_in_accuracy_meters == 100.0

    # 4. 100m accepted by punch_out
    rec_out_100 = await service.punch_out(emp_id, PunchOutRequest(latitude=19.198, longitude=72.947, accuracy=100.0, gps_timestamp=now_ts))
    assert rec_out_100.punch_out_accuracy_meters == 100.0

    # 5. Service rejects > 100m (e.g. 100.1m, 500m, 10000m)
    for bad_acc in [100.1, 500.0, 10000.0]:
        bad_in = MagicMock(spec=PunchInRequest, latitude=19.198, longitude=72.947, accuracy=bad_acc, gps_timestamp=now_ts)
        with pytest.raises(BadRequestException) as exc_in:
            await service.punch_in(emp_id, bad_in)
        assert "gps signal is insufficient" in str(exc_in.value).lower()
        assert "exceeds maximum allowed 100.0m" in str(exc_in.value).lower()

        bad_out = MagicMock(spec=PunchOutRequest, latitude=19.198, longitude=72.947, accuracy=bad_acc, gps_timestamp=now_ts)
        with pytest.raises(BadRequestException) as exc_out:
            await service.punch_out(emp_id, bad_out)
        assert "gps signal is insufficient" in str(exc_out.value).lower()
        assert "exceeds maximum allowed 100.0m" in str(exc_out.value).lower()

    # 6. Service rejects missing accuracy (None)
    missing_in = MagicMock(spec=PunchInRequest, latitude=19.198, longitude=72.947, accuracy=None, gps_timestamp=now_ts)
    with pytest.raises(BadRequestException) as exc_miss_in:
        await service.punch_in(emp_id, missing_in)
    assert "missing gps accuracy" in str(exc_miss_in.value).lower()

    missing_out = MagicMock(spec=PunchOutRequest, latitude=19.198, longitude=72.947, accuracy=None, gps_timestamp=now_ts)
    with pytest.raises(BadRequestException) as exc_miss_out:
        await service.punch_out(emp_id, missing_out)
    assert "missing gps accuracy" in str(exc_miss_out.value).lower()

    # 7. Service rejects negative accuracy
    neg_in = MagicMock(spec=PunchInRequest, latitude=19.198, longitude=72.947, accuracy=-1.0, gps_timestamp=now_ts)
    with pytest.raises(BadRequestException) as exc_neg_in:
        await service.punch_in(emp_id, neg_in)
    assert "invalid gps accuracy value" in str(exc_neg_in.value).lower()

    neg_out = MagicMock(spec=PunchOutRequest, latitude=19.198, longitude=72.947, accuracy=-1.0, gps_timestamp=now_ts)
    with pytest.raises(BadRequestException) as exc_neg_out:
        await service.punch_out(emp_id, neg_out)
    assert "invalid gps accuracy value" in str(exc_neg_out.value).lower()


@pytest.mark.asyncio
async def test_existing_attendance_records_remain_readable():
    """Scenario 18: Existing records with null accuracy remain completely readable."""
    loc_prim = make_test_location("Thane Office", 19.198, 72.947, 150.0)
    emp_id = uuid.uuid4()

    mock_rec = MagicMock(spec=HrmsAttendance)
    mock_rec.id = uuid.uuid4()
    mock_rec.employee_id = emp_id
    mock_rec.attendance_date = date.today()
    mock_rec.punch_in = datetime.now(timezone.utc)
    mock_rec.punch_out = datetime.now(timezone.utc)
    mock_rec.status = "PRESENT"
    mock_rec.working_minutes = 480
    mock_rec.late_minutes = 0
    mock_rec.early_exit_minutes = 0
    mock_rec.office_location_id = loc_prim.id
    mock_rec.latitude = 19.198
    mock_rec.longitude = 72.947
    mock_rec.punch_in_distance = 15.0
    mock_rec.punch_out_distance = 18.0
    mock_rec.punch_in_accuracy_meters = None  # Historical record with no accuracy
    mock_rec.punch_out_accuracy_meters = None
    mock_rec.is_irregular = False
    mock_rec.regularization_status = "NONE"
    mock_rec.regularization_reason = None
    mock_rec.regularization_note = None
    mock_rec.created_at = datetime.now(timezone.utc)
    mock_rec.updated_at = datetime.now(timezone.utc)

    db = AsyncMock()
    db.execute = AsyncMock(return_value=MagicMock(scalar_one_or_none=MagicMock(return_value=mock_rec)))
    db.get = AsyncMock(return_value=loc_prim)

    service = HrmsAttendanceService(db)
    read_dto = await service.get_today_attendance(emp_id)
    assert read_dto is not None
    assert read_dto.punch_in_accuracy_meters is None
    assert read_dto.punch_out_accuracy_meters is None
    assert read_dto.status == "PRESENT"
    assert read_dto.working_minutes == 480


# ==============================================================================
# PHASE 1.3 — Server-Side GPS Freshness Enforcement Tests
# ==============================================================================

@pytest.mark.asyncio
async def test_gps_freshness_current_timestamp_accepted_punch_in_and_out():
    """Phase 1.3: Current GPS timestamp (0s old) is accepted for punch-in and punch-out."""
    loc_prim = make_test_location("Thane Office", 19.198, 72.947, 150.0)
    emp_id = uuid.uuid4()
    fixed_server_now = datetime(2026, 10, 31, 10, 0, 0, tzinfo=timezone.utc)

    mock_rec = MagicMock(spec=HrmsAttendance)
    mock_rec.id = uuid.uuid4()
    mock_rec.employee_id = emp_id
    mock_rec.attendance_date = fixed_server_now.astimezone(IST).date()
    mock_rec.punch_in = fixed_server_now
    mock_rec.punch_out = None
    mock_rec.status = "PRESENT"
    mock_rec.working_minutes = 0
    mock_rec.late_minutes = 0
    mock_rec.early_exit_minutes = 0
    mock_rec.office_location_id = loc_prim.id
    mock_rec.latitude = 19.198
    mock_rec.longitude = 72.947
    mock_rec.punch_in_distance = 5.0
    mock_rec.punch_in_accuracy_meters = 10.0
    mock_rec.punch_out_accuracy_meters = None
    mock_rec.is_irregular = False
    mock_rec.regularization_status = "NONE"
    mock_rec.regularization_reason = None
    mock_rec.regularization_note = None
    mock_rec.created_at = fixed_server_now
    mock_rec.updated_at = fixed_server_now

    db = AsyncMock()
    async def mock_refresh(rec):
        rec.id = uuid.uuid4()
        rec.created_at = fixed_server_now
        rec.updated_at = fixed_server_now
    db.refresh = AsyncMock(side_effect=mock_refresh)
    db.execute = AsyncMock(return_value=MagicMock(scalar_one_or_none=MagicMock(return_value=mock_rec)))

    service = HrmsAttendanceService(db)
    service.get_policy = AsyncMock(return_value=make_test_policy())
    service.get_today_attendance = AsyncMock(return_value=None)
    service.get_permitted_locations = AsyncMock(return_value=(loc_prim, [loc_prim]))

    # Punch in with current GPS timestamp
    payload_in = PunchInRequest(
        latitude=19.198,
        longitude=72.947,
        accuracy=10.0,
        gps_timestamp=fixed_server_now,
    )
    rec_in = await service.punch_in(emp_id, payload_in, server_now=fixed_server_now)
    assert rec_in.punch_in_accuracy_meters == 10.0

    # Punch out with current GPS timestamp
    payload_out = PunchOutRequest(
        latitude=19.198,
        longitude=72.947,
        accuracy=12.0,
        gps_timestamp=fixed_server_now,
    )
    rec_out = await service.punch_out(emp_id, payload_out, server_now=fixed_server_now)
    assert rec_out.punch_out_accuracy_meters == 12.0


@pytest.mark.asyncio
async def test_gps_freshness_30s_old_accepted_punch_in_and_out():
    """Phase 1.3: GPS reading 30 seconds old is accepted."""
    loc_prim = make_test_location("Thane Office", 19.198, 72.947, 150.0)
    emp_id = uuid.uuid4()
    fixed_server_now = datetime(2026, 10, 31, 10, 0, 0, tzinfo=timezone.utc)
    reading_time = fixed_server_now - timedelta(seconds=30)

    mock_rec = MagicMock(spec=HrmsAttendance)
    mock_rec.id = uuid.uuid4()
    mock_rec.employee_id = emp_id
    mock_rec.attendance_date = fixed_server_now.astimezone(IST).date()
    mock_rec.punch_in = fixed_server_now
    mock_rec.punch_out = None
    mock_rec.status = "PRESENT"
    mock_rec.working_minutes = 0
    mock_rec.late_minutes = 0
    mock_rec.early_exit_minutes = 0
    mock_rec.office_location_id = loc_prim.id
    mock_rec.latitude = 19.198
    mock_rec.longitude = 72.947
    mock_rec.punch_in_distance = 5.0
    mock_rec.punch_in_accuracy_meters = 15.0
    mock_rec.punch_out_accuracy_meters = None
    mock_rec.is_irregular = False
    mock_rec.regularization_status = "NONE"
    mock_rec.regularization_reason = None
    mock_rec.regularization_note = None
    mock_rec.created_at = fixed_server_now
    mock_rec.updated_at = fixed_server_now

    db = AsyncMock()
    async def mock_refresh(rec):
        rec.id = uuid.uuid4()
        rec.created_at = fixed_server_now
        rec.updated_at = fixed_server_now
    db.refresh = AsyncMock(side_effect=mock_refresh)
    db.execute = AsyncMock(return_value=MagicMock(scalar_one_or_none=MagicMock(return_value=mock_rec)))

    service = HrmsAttendanceService(db)
    service.get_policy = AsyncMock(return_value=make_test_policy())
    service.get_today_attendance = AsyncMock(return_value=None)
    service.get_permitted_locations = AsyncMock(return_value=(loc_prim, [loc_prim]))

    # Punch in with 30s old timestamp
    payload_in = PunchInRequest(latitude=19.198, longitude=72.947, accuracy=15.0, gps_timestamp=reading_time)
    rec_in = await service.punch_in(emp_id, payload_in, server_now=fixed_server_now)
    assert rec_in.punch_in_accuracy_meters == 15.0

    # Punch out with 30s old timestamp
    payload_out = PunchOutRequest(latitude=19.198, longitude=72.947, accuracy=15.0, gps_timestamp=reading_time)
    rec_out = await service.punch_out(emp_id, payload_out, server_now=fixed_server_now)
    assert rec_out.punch_out_accuracy_meters == 15.0


@pytest.mark.asyncio
async def test_gps_freshness_exactly_60s_old_boundary_accepted():
    """Phase 1.3: GPS reading exactly 60 seconds old boundary is accepted."""
    loc_prim = make_test_location("Thane Office", 19.198, 72.947, 150.0)
    emp_id = uuid.uuid4()
    fixed_server_now = datetime(2026, 10, 31, 10, 0, 0, tzinfo=timezone.utc)
    boundary_time = fixed_server_now - timedelta(seconds=60)

    mock_rec = MagicMock(spec=HrmsAttendance)
    mock_rec.id = uuid.uuid4()
    mock_rec.employee_id = emp_id
    mock_rec.attendance_date = fixed_server_now.astimezone(IST).date()
    mock_rec.punch_in = fixed_server_now
    mock_rec.punch_out = None
    mock_rec.status = "PRESENT"
    mock_rec.working_minutes = 0
    mock_rec.late_minutes = 0
    mock_rec.early_exit_minutes = 0
    mock_rec.office_location_id = loc_prim.id
    mock_rec.latitude = 19.198
    mock_rec.longitude = 72.947
    mock_rec.punch_in_distance = 5.0
    mock_rec.punch_in_accuracy_meters = 20.0
    mock_rec.punch_out_accuracy_meters = None
    mock_rec.is_irregular = False
    mock_rec.regularization_status = "NONE"
    mock_rec.regularization_reason = None
    mock_rec.regularization_note = None
    mock_rec.created_at = fixed_server_now
    mock_rec.updated_at = fixed_server_now

    db = AsyncMock()
    async def mock_refresh(rec):
        rec.id = uuid.uuid4()
        rec.created_at = fixed_server_now
        rec.updated_at = fixed_server_now
    db.refresh = AsyncMock(side_effect=mock_refresh)
    db.execute = AsyncMock(return_value=MagicMock(scalar_one_or_none=MagicMock(return_value=mock_rec)))

    service = HrmsAttendanceService(db)
    service.get_policy = AsyncMock(return_value=make_test_policy())
    service.get_today_attendance = AsyncMock(return_value=None)
    service.get_permitted_locations = AsyncMock(return_value=(loc_prim, [loc_prim]))

    # Exactly 60s old accepted for punch-in
    payload_in = PunchInRequest(latitude=19.198, longitude=72.947, accuracy=20.0, gps_timestamp=boundary_time)
    rec_in = await service.punch_in(emp_id, payload_in, server_now=fixed_server_now)
    assert rec_in.punch_in_accuracy_meters == 20.0

    # Exactly 60s old accepted for punch-out
    payload_out = PunchOutRequest(latitude=19.198, longitude=72.947, accuracy=20.0, gps_timestamp=boundary_time)
    rec_out = await service.punch_out(emp_id, payload_out, server_now=fixed_server_now)
    assert rec_out.punch_out_accuracy_meters == 20.0


@pytest.mark.asyncio
async def test_gps_freshness_more_than_60s_old_rejected():
    """Phase 1.3: GPS reading older than 60 seconds is rejected for punch-in and punch-out."""
    loc_prim = make_test_location("Thane Office", 19.198, 72.947, 150.0)
    emp_id = uuid.uuid4()
    fixed_server_now = datetime(2026, 10, 31, 10, 0, 0, tzinfo=timezone.utc)
    stale_time_60_1 = fixed_server_now - timedelta(seconds=60.1)
    stale_time_120 = fixed_server_now - timedelta(seconds=120)

    mock_rec = MagicMock(spec=HrmsAttendance)
    mock_rec.id = uuid.uuid4()
    mock_rec.employee_id = emp_id
    mock_rec.attendance_date = fixed_server_now.astimezone(IST).date()
    mock_rec.punch_in = fixed_server_now
    mock_rec.punch_out = None

    db = AsyncMock()
    db.execute = AsyncMock(return_value=MagicMock(scalar_one_or_none=MagicMock(return_value=mock_rec)))
    service = HrmsAttendanceService(db)
    service.get_policy = AsyncMock(return_value=make_test_policy())
    service.get_today_attendance = AsyncMock(return_value=None)
    service.get_permitted_locations = AsyncMock(return_value=(loc_prim, [loc_prim]))

    # 1. 60.1s old rejected on punch-in
    payload_in_60_1 = PunchInRequest(latitude=19.198, longitude=72.947, accuracy=10.0, gps_timestamp=stale_time_60_1)
    with pytest.raises(BadRequestException) as exc1:
        await service.punch_in(emp_id, payload_in_60_1, server_now=fixed_server_now)
    assert "stale gps reading" in str(exc1.value).lower()
    assert "exceeds maximum allowed age of 60 seconds" in str(exc1.value).lower()

    # 2. 120s old rejected on punch-in
    payload_in_120 = PunchInRequest(latitude=19.198, longitude=72.947, accuracy=10.0, gps_timestamp=stale_time_120)
    with pytest.raises(BadRequestException) as exc2:
        await service.punch_in(emp_id, payload_in_120, server_now=fixed_server_now)
    assert "stale gps reading" in str(exc2.value).lower()

    # 3. 60.1s old rejected on punch-out
    payload_out_60_1 = PunchOutRequest(latitude=19.198, longitude=72.947, accuracy=10.0, gps_timestamp=stale_time_60_1)
    with pytest.raises(BadRequestException) as exc3:
        await service.punch_out(emp_id, payload_out_60_1, server_now=fixed_server_now)
    assert "stale gps reading" in str(exc3.value).lower()
    assert "exceeds maximum allowed age of 60 seconds" in str(exc3.value).lower()


@pytest.mark.asyncio
async def test_gps_freshness_future_tolerance_10s_accepted_and_excess_rejected():
    """Phase 1.3: GPS reading up to 10s in future is accepted; > 10s in future is rejected."""
    loc_prim = make_test_location("Thane Office", 19.198, 72.947, 150.0)
    emp_id = uuid.uuid4()
    fixed_server_now = datetime(2026, 10, 31, 10, 0, 0, tzinfo=timezone.utc)
    future_10s = fixed_server_now + timedelta(seconds=10.0)
    future_10_1s = fixed_server_now + timedelta(seconds=10.1)
    future_60s = fixed_server_now + timedelta(seconds=60.0)

    mock_rec = MagicMock(spec=HrmsAttendance)
    mock_rec.id = uuid.uuid4()
    mock_rec.employee_id = emp_id
    mock_rec.attendance_date = fixed_server_now.astimezone(IST).date()
    mock_rec.punch_in = fixed_server_now
    mock_rec.punch_out = None
    mock_rec.status = "PRESENT"
    mock_rec.working_minutes = 0
    mock_rec.late_minutes = 0
    mock_rec.early_exit_minutes = 0
    mock_rec.office_location_id = loc_prim.id
    mock_rec.latitude = 19.198
    mock_rec.longitude = 72.947
    mock_rec.punch_in_distance = 5.0
    mock_rec.punch_in_accuracy_meters = 10.0
    mock_rec.punch_out_accuracy_meters = None
    mock_rec.is_irregular = False
    mock_rec.regularization_status = "NONE"
    mock_rec.regularization_reason = None
    mock_rec.regularization_note = None
    mock_rec.created_at = fixed_server_now
    mock_rec.updated_at = fixed_server_now

    db = AsyncMock()
    async def mock_refresh(rec):
        rec.id = uuid.uuid4()
        rec.created_at = fixed_server_now
        rec.updated_at = fixed_server_now
    db.refresh = AsyncMock(side_effect=mock_refresh)
    db.execute = AsyncMock(return_value=MagicMock(scalar_one_or_none=MagicMock(return_value=mock_rec)))

    service = HrmsAttendanceService(db)
    service.get_policy = AsyncMock(return_value=make_test_policy())
    service.get_today_attendance = AsyncMock(return_value=None)
    service.get_permitted_locations = AsyncMock(return_value=(loc_prim, [loc_prim]))

    # 1. Exactly 10s in future: accepted for punch-in and punch-out
    payload_in_10 = PunchInRequest(latitude=19.198, longitude=72.947, accuracy=10.0, gps_timestamp=future_10s)
    rec_in_10 = await service.punch_in(emp_id, payload_in_10, server_now=fixed_server_now)
    assert rec_in_10.punch_in_accuracy_meters == 10.0

    payload_out_10 = PunchOutRequest(latitude=19.198, longitude=72.947, accuracy=10.0, gps_timestamp=future_10s)
    rec_out_10 = await service.punch_out(emp_id, payload_out_10, server_now=fixed_server_now)
    assert rec_out_10.punch_out_accuracy_meters == 10.0

    # 2. 10.1s in future: rejected for punch-in
    payload_in_10_1 = PunchInRequest(latitude=19.198, longitude=72.947, accuracy=10.0, gps_timestamp=future_10_1s)
    with pytest.raises(BadRequestException) as exc_in:
        await service.punch_in(emp_id, payload_in_10_1, server_now=fixed_server_now)
    assert "invalid gps timestamp" in str(exc_in.value).lower()
    assert "in the future" in str(exc_in.value).lower()
    assert "exceeds maximum allowed tolerance of 10 seconds" in str(exc_in.value).lower()

    # 3. 60s in future: rejected for punch-out
    payload_out_60 = PunchOutRequest(latitude=19.198, longitude=72.947, accuracy=10.0, gps_timestamp=future_60s)
    with pytest.raises(BadRequestException) as exc_out:
        await service.punch_out(emp_id, payload_out_60, server_now=fixed_server_now)
    assert "invalid gps timestamp" in str(exc_out.value).lower()
    assert "in the future" in str(exc_out.value).lower()


@pytest.mark.asyncio
async def test_gps_freshness_missing_and_invalid_timestamp_rejected():
    """Phase 1.3: Missing or invalid timestamps are rejected for punch-in and punch-out."""
    loc_prim = make_test_location("Thane Office", 19.198, 72.947, 150.0)
    emp_id = uuid.uuid4()
    fixed_server_now = datetime(2026, 10, 31, 10, 0, 0, tzinfo=timezone.utc)

    db = AsyncMock()
    service = HrmsAttendanceService(db)
    service.get_policy = AsyncMock(return_value=make_test_policy())
    service.get_today_attendance = AsyncMock(return_value=None)
    service.get_permitted_locations = AsyncMock(return_value=(loc_prim, [loc_prim]))

    # Missing timestamp on punch-in
    payload_missing_in = PunchInRequest(latitude=19.198, longitude=72.947, accuracy=10.0, gps_timestamp=None)
    with pytest.raises(BadRequestException) as exc1:
        await service.punch_in(emp_id, payload_missing_in, server_now=fixed_server_now)
    assert "missing gps timestamp" in str(exc1.value).lower()

    # Missing timestamp on punch-out
    payload_missing_out = PunchOutRequest(latitude=19.198, longitude=72.947, accuracy=10.0, gps_timestamp=None)
    with pytest.raises(BadRequestException) as exc2:
        await service.punch_out(emp_id, payload_missing_out, server_now=fixed_server_now)
    assert "missing gps timestamp" in str(exc2.value).lower()

    # Invalid timestamp (non-datetime)
    mock_bad_time = MagicMock(spec=PunchInRequest, latitude=19.198, longitude=72.947, accuracy=10.0, gps_timestamp="bad-date-format")
    with pytest.raises(BadRequestException) as exc3:
        await service.punch_in(emp_id, mock_bad_time, server_now=fixed_server_now)
    assert "invalid gps timestamp" in str(exc3.value).lower()


@pytest.mark.asyncio
async def test_gps_freshness_timezone_aware_handling():
    """Phase 1.3: Timezone-aware timestamps (UTC, IST, other offsets) handled correctly."""
    fixed_server_now = datetime(2026, 10, 31, 12, 0, 0, tzinfo=timezone.utc)  # 12:00:00 UTC = 17:30:00 IST

    # 1. IST timestamp acquired 20 seconds before server now (17:29:40 IST = 11:59:40 UTC)
    ist_time = datetime(2026, 10, 31, 17, 29, 40, tzinfo=IST)
    norm1 = validate_gps_freshness(ist_time, server_now_utc=fixed_server_now)
    assert norm1.tzinfo == timezone.utc
    assert (fixed_server_now - norm1).total_seconds() == 20.0

    # 2. EST (UTC-5) timestamp acquired 15 seconds before server now (06:59:45 EST = 11:59:45 UTC)
    est_tz = timezone(timedelta(hours=-5))
    est_time = datetime(2026, 10, 31, 6, 59, 45, tzinfo=est_tz)
    norm2 = validate_gps_freshness(est_time, server_now_utc=fixed_server_now)
    assert norm2.tzinfo == timezone.utc
    assert (fixed_server_now - norm2).total_seconds() == 15.0

    # 3. Naive datetime treated as UTC
    naive_time = datetime(2026, 10, 31, 11, 59, 50)  # 10s old if UTC
    norm3 = validate_gps_freshness(naive_time, server_now_utc=fixed_server_now)
    assert norm3.tzinfo == timezone.utc
    assert (fixed_server_now - norm3).total_seconds() == 10.0


@pytest.mark.asyncio
async def test_server_attendance_timestamp_remains_authoritative():
    """Phase 1.3: Server clock remains strictly authoritative for punch times; client gps_timestamp is ignored."""
    loc_prim = make_test_location("Thane Office", 19.198, 72.947, 150.0)
    emp_id = uuid.uuid4()
    fixed_server_now = datetime(2026, 10, 31, 10, 0, 0, tzinfo=timezone.utc)
    client_gps_timestamp = fixed_server_now - timedelta(seconds=45)

    mock_rec = MagicMock(spec=HrmsAttendance)
    mock_rec.id = uuid.uuid4()
    mock_rec.employee_id = emp_id
    mock_rec.attendance_date = fixed_server_now.astimezone(IST).date()
    mock_rec.punch_in = fixed_server_now
    mock_rec.punch_out = None
    mock_rec.status = "PRESENT"
    mock_rec.working_minutes = 0
    mock_rec.late_minutes = 0
    mock_rec.early_exit_minutes = 0
    mock_rec.office_location_id = loc_prim.id
    mock_rec.latitude = 19.198
    mock_rec.longitude = 72.947
    mock_rec.punch_in_distance = 5.0
    mock_rec.punch_in_accuracy_meters = 10.0
    mock_rec.punch_out_accuracy_meters = None
    mock_rec.is_irregular = False
    mock_rec.regularization_status = "NONE"
    mock_rec.regularization_reason = None
    mock_rec.regularization_note = None
    mock_rec.created_at = fixed_server_now
    mock_rec.updated_at = fixed_server_now

    db = AsyncMock()
    async def mock_refresh(rec):
        rec.id = uuid.uuid4()
        rec.created_at = fixed_server_now
        rec.updated_at = fixed_server_now
    db.refresh = AsyncMock(side_effect=mock_refresh)
    db.execute = AsyncMock(return_value=MagicMock(scalar_one_or_none=MagicMock(return_value=mock_rec)))

    service = HrmsAttendanceService(db)
    service.get_policy = AsyncMock(return_value=make_test_policy())
    service.get_today_attendance = AsyncMock(return_value=None)
    service.get_permitted_locations = AsyncMock(return_value=(loc_prim, [loc_prim]))

    # Punch in with client GPS timestamp 45s ago
    payload_in = PunchInRequest(latitude=19.198, longitude=72.947, accuracy=10.0, gps_timestamp=client_gps_timestamp)
    rec_in = await service.punch_in(emp_id, payload_in, server_now=fixed_server_now)

    # The recorded punch_in must reflect server time (local_dt/fixed_server_now), NEVER client_gps_timestamp
    assert rec_in.punch_in != client_gps_timestamp
    assert rec_in.punch_in.date() == fixed_server_now.astimezone(IST).date()

    # Punch out with client GPS timestamp 45s ago
    payload_out = PunchOutRequest(latitude=19.198, longitude=72.947, accuracy=10.0, gps_timestamp=client_gps_timestamp)
    rec_out = await service.punch_out(emp_id, payload_out, server_now=fixed_server_now)
    assert rec_out.punch_out == fixed_server_now
    assert rec_out.punch_out != client_gps_timestamp


@pytest.mark.asyncio
async def test_failed_validation_does_not_create_or_modify_attendance_records():
    """Phase 1.3: Stale/future/missing GPS validation failure occurs before any record creation or mutation."""
    loc_prim = make_test_location("Thane Office", 19.198, 72.947, 150.0)
    emp_id = uuid.uuid4()
    fixed_server_now = datetime(2026, 10, 31, 10, 0, 0, tzinfo=timezone.utc)
    stale_time = fixed_server_now - timedelta(seconds=75)

    mock_rec = MagicMock(spec=HrmsAttendance)
    mock_rec.punch_out = None

    db = AsyncMock()
    db.execute = AsyncMock(return_value=MagicMock(scalar_one_or_none=MagicMock(return_value=mock_rec)))
    service = HrmsAttendanceService(db)
    service.get_policy = AsyncMock(return_value=make_test_policy())
    service.get_today_attendance = AsyncMock(return_value=None)
    service.get_permitted_locations = AsyncMock(return_value=(loc_prim, [loc_prim]))

    # 1. Stale punch-in: db.add must NEVER be called
    payload_in = PunchInRequest(latitude=19.198, longitude=72.947, accuracy=10.0, gps_timestamp=stale_time)
    with pytest.raises(BadRequestException):
        await service.punch_in(emp_id, payload_in, server_now=fixed_server_now)
    assert not db.add.called

    # 2. Stale punch-out: mock_rec.punch_out must NEVER be updated and commit never called
    payload_out = PunchOutRequest(latitude=19.198, longitude=72.947, accuracy=10.0, gps_timestamp=stale_time)
    with pytest.raises(BadRequestException):
        await service.punch_out(emp_id, payload_out, server_now=fixed_server_now)
    assert mock_rec.punch_out is None
    assert not db.commit.called
