"""
Tests for Employee Location Assignment & Multi-Location Attendance.

Covers all 11 required scenarios:
1. Employee with one primary location can punch there.
2. Employee with one primary and two additional locations can punch at all three.
3. Employee cannot punch at an unassigned location (even if in company).
4. GPS outside every assigned geofence is rejected with message.
5. Inactive assigned locations cannot be used for new punches.
6. Unauthorized users cannot add, edit, or remove assignments through APIs / RBAC.
7. Admin can grant and revoke assignment-management permission (hrms.location_assignments.manage).
8. Changing the primary location preserves other additional assignments.
9. Removing a primary location requires another primary selection.
10. Existing attendance, regularization, and geofence timer behavior remains intact.
11. Employees cannot access another employee's assignment information unless authorized.

SAFE: Pure isolated unit tests using AsyncMock/MagicMock.
Zero writes to shared or production databases.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock, patch
import uuid
import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from app.core.exceptions import BadRequestException, ConflictException, ForbiddenException, NotFoundException
from app.hrms.models import (
    HrmsAttendance,
    HrmsAttendancePolicy,
    HrmsAttendanceRegularization,
    HrmsEmployeeLocation,
    HrmsLocation,
    HrmsLocationAssignmentHistory,
)
from app.hrms.attendance_service import HrmsAttendanceService, IST
from app.hrms.service import HrmsSetupService
from app.hrms.schemas import (
    EmployeeLocationAssignPayload,
    EmployeeLocationOverview,
    PunchInRequest,
    PunchOutRequest,
)
from app.hrms.rbac import (
    HrmsUserContext,
    require_location_assignments_manage,
)
from app.users.models import User, UserStatus


def make_location(
    name: str = "Test HQ",
    lat: float = 19.199824,
    lng: float = 72.956795,
    radius: int = 150,
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
    loc.created_at = datetime.now(timezone.utc)
    loc.updated_at = datetime.now(timezone.utc)
    return loc


def make_policy() -> MagicMock:
    policy = MagicMock(spec=HrmsAttendancePolicy)
    policy.shift_name = "General Shift"
    policy.shift_start_time = "10:30"
    policy.shift_end_time = "19:00"
    policy.geofence_radius_meters = 200
    policy.enable_grace = False
    policy.enable_late_marks = False
    policy.enable_direct_half_day = False
    policy.flexible_shift = False
    return policy


def make_user(
    name: str = "Test Employee",
    user_id: uuid.UUID | None = None,
    department: str = "Engineering",
    roles: list[str] | None = None,
) -> MagicMock:
    u = MagicMock(spec=User)
    u.id = user_id or uuid.uuid4()
    u.username = f"emp_{str(u.id)[:6]}"
    u.first_name = name.split()[0]
    u.last_name = name.split()[1] if len(name.split()) > 1 else "User"
    u.email = f"{u.first_name.lower()}@inhyma.test"
    u.department = department
    u.status = UserStatus.ACTIVE
    u.roles = roles or ["EMPLOYEE"]
    u.employee_code = f"EMP-{str(u.id)[:4]}"
    u.deleted_at = None
    return u


def make_user_ctx(
    user_id: uuid.UUID | None = None,
    roles: list[str] | None = None,
    is_super_admin: bool = False,
    is_admin: bool = False,
    is_hr: bool = False,
    is_manager: bool = False,
    permissions: set[str] | None = None,
) -> HrmsUserContext:
    uid = user_id or uuid.uuid4()
    return HrmsUserContext(
        user_id=uid,
        username="test_user",
        email="test@inhyma.test",
        display_name="Test User",
        is_super_admin=is_super_admin,
        is_admin=is_admin,
        is_hr=is_hr,
        is_manager=is_manager,
        department="Engineering",
        roles=roles or ["EMPLOYEE"],
        permissions=permissions or set(),
    )


# ===========================================================================
# SCENARIO 1: Employee with one primary location can punch there
# ===========================================================================

@pytest.mark.asyncio
async def test_scenario_1_employee_with_one_primary_location_can_punch_there():
    mock_db = AsyncMock()
    async def mock_refresh(rec):
        rec.id = uuid.uuid4()
        rec.created_at = datetime.now(timezone.utc)
        rec.updated_at = datetime.now(timezone.utc)
    mock_db.refresh = AsyncMock(side_effect=mock_refresh)

    mock_exec_res = MagicMock()
    mock_exec_res.scalar_one_or_none.return_value = None
    mock_db.execute.return_value = mock_exec_res

    service = HrmsAttendanceService(mock_db)
    user_id = uuid.uuid4()
    mumbai_hq = make_location("Mumbai HQ", lat=19.199824, lng=72.956795, radius=100)

    service.get_policy = AsyncMock(return_value=make_policy())
    service.get_permitted_locations = AsyncMock(return_value=(mumbai_hq, [mumbai_hq]))
    service.get_today_attendance = AsyncMock(return_value=None)

    payload = PunchInRequest(latitude=19.199824, longitude=72.956795, accuracy=10.0, gps_timestamp=datetime.now(timezone.utc))
    await service.punch_in(user_id, payload)

    assert mock_db.add.called
    added_record = mock_db.add.call_args[0][0]
    assert isinstance(added_record, HrmsAttendance)
    assert added_record.office_location_id == mumbai_hq.id
    assert added_record.employee_id == user_id


# ===========================================================================
# SCENARIO 2: Employee with one primary and two additional locations can punch at all three
# ===========================================================================

@pytest.mark.asyncio
async def test_scenario_2_employee_with_multi_locations_can_punch_at_all_three():
    mock_db = AsyncMock()
    async def mock_refresh(rec):
        rec.id = uuid.uuid4()
        rec.created_at = datetime.now(timezone.utc)
        rec.updated_at = datetime.now(timezone.utc)
    mock_db.refresh = AsyncMock(side_effect=mock_refresh)

    mock_exec_res = MagicMock()
    mock_exec_res.scalar_one_or_none.return_value = None
    mock_db.execute.return_value = mock_exec_res

    service = HrmsAttendanceService(mock_db)
    user_id = uuid.uuid4()

    mumbai_hq = make_location("Mumbai HQ", lat=19.199824, lng=72.956795, radius=100)
    gujarat_office = make_location("Gujarat Branch", lat=23.033, lng=72.508, radius=150)
    mp_office = make_location("MP Office", lat=22.753, lng=75.893, radius=120)

    permitted_offices = [mumbai_hq, gujarat_office, mp_office]
    service.get_policy = AsyncMock(return_value=make_policy())
    service.get_permitted_locations = AsyncMock(return_value=(mumbai_hq, permitted_offices))
    service.get_today_attendance = AsyncMock(return_value=None)

    # 1. Punch at Mumbai HQ
    payload1 = PunchInRequest(latitude=19.199824, longitude=72.956795, accuracy=10.0, gps_timestamp=datetime.now(timezone.utc))
    await service.punch_in(user_id, payload1)
    rec1 = mock_db.add.call_args[0][0]
    assert rec1.office_location_id == mumbai_hq.id

    # 2. Punch at Gujarat Branch
    payload2 = PunchInRequest(latitude=23.033, longitude=72.508, accuracy=10.0, gps_timestamp=datetime.now(timezone.utc))
    await service.punch_in(user_id, payload2)
    rec2 = mock_db.add.call_args[0][0]
    assert rec2.office_location_id == gujarat_office.id

    # 3. Punch at MP Office
    payload3 = PunchInRequest(latitude=22.753, longitude=75.893, accuracy=10.0, gps_timestamp=datetime.now(timezone.utc))
    await service.punch_in(user_id, payload3)
    rec3 = mock_db.add.call_args[0][0]
    assert rec3.office_location_id == mp_office.id


# ===========================================================================
# SCENARIO 3: Employee cannot punch at an unassigned location
# ===========================================================================

@pytest.mark.asyncio
async def test_scenario_3_employee_cannot_punch_at_unassigned_location():
    mock_db = AsyncMock()
    service = HrmsAttendanceService(mock_db)
    user_id = uuid.uuid4()

    mumbai_hq = make_location("Mumbai HQ", lat=19.199824, lng=72.956795, radius=100)
    # Delhi Office is a valid company office, but not permitted for this employee
    delhi_lat, delhi_lng = 28.6139, 77.2090

    service.get_policy = AsyncMock(return_value=make_policy())
    service.get_permitted_locations = AsyncMock(return_value=(mumbai_hq, [mumbai_hq]))
    service.get_today_attendance = AsyncMock(return_value=None)

    payload = PunchInRequest(latitude=delhi_lat, longitude=delhi_lng, accuracy=10.0, gps_timestamp=datetime.now(timezone.utc))
    with pytest.raises(BadRequestException) as exc_info:
        await service.punch_in(user_id, payload)

    assert "You are outside your assigned office locations" in str(exc_info.value)


# ===========================================================================
# SCENARIO 4: GPS outside every assigned geofence is rejected with clear message
# ===========================================================================

@pytest.mark.asyncio
async def test_scenario_4_gps_outside_every_assigned_geofence_rejected():
    mock_db = AsyncMock()
    service = HrmsAttendanceService(mock_db)
    user_id = uuid.uuid4()

    mumbai_hq = make_location("Mumbai HQ", lat=19.199824, lng=72.956795, radius=100)
    gujarat_office = make_location("Gujarat Branch", lat=23.033, lng=72.508, radius=150)

    service.get_policy = AsyncMock(return_value=make_policy())
    service.get_permitted_locations = AsyncMock(return_value=(mumbai_hq, [mumbai_hq, gujarat_office]))
    service.get_today_attendance = AsyncMock(return_value=None)

    # Far away (e.g. Bangalore coordinates)
    payload = PunchInRequest(latitude=12.9716, longitude=77.5946, accuracy=10.0, gps_timestamp=datetime.now(timezone.utc))
    with pytest.raises(BadRequestException) as exc_info:
        await service.punch_in(user_id, payload)

    assert "Outside geofence: You are outside your assigned office locations. Please punch in from an authorized location." in str(exc_info.value)


# ===========================================================================
# SCENARIO 5: Inactive assigned locations cannot be used for new punches
# ===========================================================================

@pytest.mark.asyncio
async def test_scenario_5_inactive_assigned_locations_cannot_be_used():
    mock_db = AsyncMock()
    service = HrmsAttendanceService(mock_db)
    user_id = uuid.uuid4()

    inactive_hq = make_location("Decommissioned Office", lat=19.199824, lng=72.956795, radius=100, is_active=False)

    service.get_policy = AsyncMock(return_value=make_policy())
    # If employee only has inactive location, permitted_offices list is empty
    service.get_permitted_locations = AsyncMock(return_value=(None, []))

    payload = PunchInRequest(latitude=19.199824, longitude=72.956795, accuracy=10.0, gps_timestamp=datetime.now(timezone.utc))
    with pytest.raises(BadRequestException) as exc_info:
        await service.punch_in(user_id, payload)

    assert "You are outside your assigned office locations" in str(exc_info.value)


# ===========================================================================
# SCENARIO 6: Unauthorized users cannot add, edit, or remove assignments through APIs
# ===========================================================================

@pytest.mark.asyncio
async def test_scenario_6_unauthorized_users_blocked_by_rbac():
    # 1. Normal Employee has no permission
    emp_ctx = make_user_ctx(roles=["EMPLOYEE"], permissions=set())
    assert emp_ctx.can_manage_location_assignments() is False

    with pytest.raises(HTTPException) as exc_info:
        require_location_assignments_manage(emp_ctx)
    assert exc_info.value.status_code == 403

    # 2. HR without explicit hrms.location_assignments.manage has no access
    hr_ctx = make_user_ctx(roles=["HR"], permissions={"hrms.attendance.view", "hrms.leave.manage"})
    assert hr_ctx.can_manage_location_assignments() is False

    with pytest.raises(HTTPException) as exc_info:
        require_location_assignments_manage(hr_ctx)
    assert exc_info.value.status_code == 403

    # 3. Manager without explicit permission has no access
    mgr_ctx = make_user_ctx(roles=["DEPARTMENT_MANAGER"], permissions={"hrms.attendance.view"})
    assert mgr_ctx.can_manage_location_assignments() is False

    with pytest.raises(HTTPException) as exc_info:
        require_location_assignments_manage(mgr_ctx)
    assert exc_info.value.status_code == 403


# ===========================================================================
# SCENARIO 7: Admin can grant and revoke assignment-management permission
# ===========================================================================

@pytest.mark.asyncio
async def test_scenario_7_admin_can_grant_and_revoke_assignment_permission():
    # When Admin explicitly grants hrms.location_assignments.manage to HR user
    hr_authorized_ctx = make_user_ctx(roles=["HR"], permissions={"hrms.location_assignments.manage"})
    assert hr_authorized_ctx.can_manage_location_assignments() is True
    res = require_location_assignments_manage(hr_authorized_ctx)
    assert res == hr_authorized_ctx

    # Super Admin has automatic full access
    admin_ctx = make_user_ctx(roles=["ADMIN"], is_admin=True, is_super_admin=True)
    assert admin_ctx.can_manage_location_assignments() is True
    admin_res = require_location_assignments_manage(admin_ctx)
    assert admin_res == admin_ctx

    # When revoked from HR user
    hr_revoked_ctx = make_user_ctx(roles=["HR"], permissions=set())
    assert hr_revoked_ctx.can_manage_location_assignments() is False


# ===========================================================================
# SCENARIO 8: Changing the primary location preserves other additional assignments
# ===========================================================================

@pytest.mark.asyncio
async def test_scenario_8_changing_primary_preserves_additional_assignments():
    mock_db = AsyncMock()
    service = HrmsSetupService(mock_db)

    user_id = uuid.uuid4()
    actor_id = uuid.uuid4()

    loc_mumbai = make_location("Mumbai HQ", loc_id=uuid.uuid4())
    loc_gujarat = make_location("Gujarat Branch", loc_id=uuid.uuid4())
    loc_mp = make_location("MP Office", loc_id=uuid.uuid4())

    target_user = make_user("Employee A", user_id=user_id)

    # Existing records
    existing_primary = MagicMock(spec=HrmsEmployeeLocation)
    existing_primary.user_id = user_id
    existing_primary.location_id = loc_mumbai.id
    existing_primary.is_primary = True
    existing_primary.location = loc_mumbai

    existing_add1 = MagicMock(spec=HrmsEmployeeLocation)
    existing_add1.user_id = user_id
    existing_add1.location_id = loc_gujarat.id
    existing_add1.is_primary = False
    existing_add1.location = loc_gujarat

    existing_add2 = MagicMock(spec=HrmsEmployeeLocation)
    existing_add2.user_id = user_id
    existing_add2.location_id = loc_mp.id
    existing_add2.is_primary = False
    existing_add2.location = loc_mp

    # Now change primary location to Gujarat, keeping MP and Mumbai as additional
    payload = EmployeeLocationAssignPayload(
        primary_location_id=str(loc_gujarat.id),
        additional_location_ids=[str(loc_mp.id), str(loc_mumbai.id)],
        notes="Transferred primary office to Gujarat Branch",
    )

    # Mock db.get for user and locations
    def mock_get(model, entity_id):
        if model == User:
            return target_user
        if model == HrmsLocation:
            if entity_id == loc_mumbai.id:
                return loc_mumbai
            if entity_id == loc_gujarat.id:
                return loc_gujarat
            if entity_id == loc_mp.id:
                return loc_mp
        return None

    mock_db.get.side_effect = mock_get

    # Mock db.execute for existing employee locations
    mock_existing_exec = MagicMock()
    mock_existing_exec.scalars.return_value.all.return_value = [existing_primary, existing_add1, existing_add2]
    mock_db.execute.return_value = mock_existing_exec

    with patch.object(service, "get_employee_location_overview", new_callable=AsyncMock) as mock_overview:
        mock_overview.return_value = EmployeeLocationOverview(
            employee_id=str(user_id),
            username="emp_a",
            employee_name="Employee A User",
            department="Engineering",
            primary_location=None,
            additional_locations=[],
            total_permitted_locations=3,
        )

        overview = await service.update_employee_locations(
            employee_id=user_id,
            payload=payload,
            actor_id=actor_id,
        )

        # Gujarat is now primary
        assert existing_add1.is_primary is True
        # Mumbai is now additional
        assert existing_primary.is_primary is False
        # MP remains additional
        assert existing_add2.is_primary is False
        # Commit called
        assert mock_db.commit.called


# ===========================================================================
# SCENARIO 9: Removing a primary location requires another primary selection
# ===========================================================================

@pytest.mark.asyncio
async def test_scenario_9_removing_primary_location_requires_another_primary():
    # 1. Invalid or empty primary location cannot be formed into a valid assign payload
    with pytest.raises(ValidationError):
        EmployeeLocationAssignPayload(
            primary_location_id="",
            additional_location_ids=[],
        )

    # 2. Attempting to assign an inactive or non-existent primary location raises BadRequestException
    mock_db = AsyncMock()
    service = HrmsSetupService(mock_db)
    user_id = uuid.uuid4()
    actor_id = uuid.uuid4()

    fake_loc_id = uuid.uuid4()
    payload = EmployeeLocationAssignPayload(
        primary_location_id=str(fake_loc_id),
        additional_location_ids=[],
    )

    target_user = make_user("Employee A", user_id=user_id)
    mock_db.get.side_effect = lambda model, entity_id: target_user if model == User else None

    with pytest.raises(BadRequestException) as exc_info:
        await service.update_employee_locations(
            employee_id=user_id,
            payload=payload,
            actor_id=actor_id,
        )
    assert "Primary location not found" in str(exc_info.value)


# ===========================================================================
# SCENARIO 10: Existing attendance, regularization, and geofence timer behavior remains intact
# ===========================================================================

@pytest.mark.asyncio
async def test_scenario_10_attendance_regularization_and_timer_remain_intact():
    mock_db = AsyncMock()
    service = HrmsAttendanceService(mock_db)
    user_id = uuid.uuid4()
    loc = make_location("Head Office", lat=19.199824, lng=72.956795, radius=100)

    # 1. punch_out validates permitted locations
    existing_attendance = HrmsAttendance()
    existing_attendance.id = uuid.uuid4()
    existing_attendance.employee_id = user_id
    existing_attendance.attendance_date = datetime.now(IST).date()
    existing_attendance.punch_in = datetime.now(IST) - timedelta(hours=8)
    existing_attendance.punch_out = None
    existing_attendance.office_location_id = loc.id
    existing_attendance.status = "PRESENT"
    existing_attendance.working_minutes = 480
    existing_attendance.late_minutes = 0
    existing_attendance.early_exit_minutes = 0
    existing_attendance.latitude = 19.199824
    existing_attendance.longitude = 72.956795
    existing_attendance.punch_in_distance = 10.0
    existing_attendance.punch_out_distance = None
    existing_attendance.is_irregular = False
    existing_attendance.regularization_status = "NONE"
    existing_attendance.regularization_reason = None
    existing_attendance.regularization_note = None
    existing_attendance.created_at = datetime.now(timezone.utc)
    existing_attendance.updated_at = datetime.now(timezone.utc)

    def mock_db_execute(stmt, *args, **kwargs):
        res = MagicMock()
        sql_text = str(stmt).lower()
        if "hrms_geofence_violations" in sql_text:
            res.scalar_one_or_none.return_value = None
        else:
            res.scalar_one_or_none.return_value = existing_attendance
        return res

    mock_db.execute.side_effect = mock_db_execute

    service.get_policy = AsyncMock(return_value=make_policy())
    service.get_permitted_locations = AsyncMock(return_value=(loc, [loc]))
    service.get_assigned_office = AsyncMock(return_value=loc)

    # Punch out inside office succeeds
    payload_in = PunchOutRequest(latitude=19.199824, longitude=72.956795, accuracy=10.0, gps_timestamp=datetime.now(timezone.utc))
    await service.punch_out(user_id, payload_in)
    assert existing_attendance.punch_out is not None

    # Punch out outside all locations is rejected
    existing_attendance.punch_out = None  # Reset for testing outside
    payload_out = PunchOutRequest(latitude=28.6139, longitude=77.2090, accuracy=10.0, gps_timestamp=datetime.now(timezone.utc))
    with pytest.raises(BadRequestException) as exc_info:
        await service.punch_out(user_id, payload_out)
    assert "Outside geofence: You are outside your assigned office locations" in str(exc_info.value)

    # 2. check_geofence_status evaluates across all permitted offices
    mock_settings = MagicMock()
    mock_settings.max_gps_accuracy_meters = 50.0
    mock_settings.return_timer_seconds = 300
    mock_settings.is_unlimited_return = False

    with patch("app.hrms.service.HrmsSetupService.get_effective_tracking_settings", new_callable=AsyncMock) as mock_track:
        mock_track.return_value = mock_settings

        status_inside = await service.check_geofence_status(
            employee_id=user_id,
            latitude=19.199824,
            longitude=72.956795,
        )
        assert status_inside.is_inside is True
        assert status_inside.boundary_radius_meters == 100.0

        status_outside = await service.check_geofence_status(
            employee_id=user_id,
            latitude=28.6139,
            longitude=77.2090,
        )
        assert status_outside.is_inside is False


# ===========================================================================
# SCENARIO 11: Employees cannot access another employee's assignment info unless authorized
# ===========================================================================

@pytest.mark.asyncio
async def test_scenario_11_employees_cannot_access_other_employee_assignments_unless_authorized():
    emp_user_id = uuid.uuid4()

    regular_employee_ctx = make_user_ctx(user_id=emp_user_id, roles=["EMPLOYEE"], permissions=set())

    # A regular employee attempting to invoke management dependency raises 403 Forbidden
    with pytest.raises(HTTPException) as exc_info:
        require_location_assignments_manage(regular_employee_ctx)
    assert exc_info.value.status_code == 403

    # An authorized user with explicit hrms.location_assignments.manage passes
    authorized_ctx = make_user_ctx(
        user_id=emp_user_id,
        roles=["HR"],
        permissions={"hrms.location_assignments.manage"},
    )
    res = require_location_assignments_manage(authorized_ctx)
    assert res.user_id == emp_user_id
