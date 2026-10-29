"""
Isolated Unit Regression Test Suite for HRMS Phase 9 Batch 1 Security Remediations:
- DEF-LM-01: Forged reviewer ID query bypass eliminated; reviewer strictly authenticated principal; self-approval prohibited.
- DEF-AST-01: Asset PATCH, PUT, and status mutation require Admin/HR role; non-Admin/HR rejected with 403.
- DEF-ATT-01: Authoritative server timestamps for punch-in and punch-out; client timestamp spoofing ignored.
- DEF-ATT-06: Self-approval prohibited for ALL roles, including administrators (in rbac.py and leave_routes.py).
- DEF-ATT-02: Geofence & location validation strictly enforced.

These tests use isolated mocks and do NOT connect to or mutate shared Supabase data.
"""

import uuid
from datetime import date, datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException, status

from app.hrms.asset_routes import (
    update_asset_patch,
    update_asset_put,
    update_asset_status_endpoint,
)
from app.hrms.attendance_routes import submit_regularization
from app.hrms.attendance_service import HrmsAttendanceService, IST
from app.core.exceptions import BadRequestException
from app.hrms.leave_routes import approve_leave_request, reject_leave_request
from app.hrms.models import HrmsAttendance, HrmsLeaveRequest, HrmsLocation
from app.hrms.rbac import HrmsUserContext, verify_approval_authorization
from app.hrms.schemas import (
    AssetStatusUpdate,
    AssetUpdate,
    LeaveApprovalAction,
    PunchInRequest,
    PunchOutRequest,
    RegularizationRequest,
)


# ==============================================================================
# DEF-LM-01: Leave Approval Authorization & Reviewer Identity Enforcement
# ==============================================================================

@pytest.mark.asyncio
async def test_leave_approval_rejects_self_approval():
    """Verify that any employee (including managers/admins) attempting self-approval is rejected with HTTP 400."""
    user_id = uuid.uuid4()
    req_id = uuid.uuid4()

    mock_db = AsyncMock()
    mock_leave = MagicMock(spec=HrmsLeaveRequest)
    mock_leave.id = req_id
    mock_leave.employee_id = user_id  # Caller is the applicant
    mock_leave.approval_status = "PENDING"
    mock_leave.total_days = 2

    mock_db.scalar.return_value = mock_leave

    mock_ctx = MagicMock(spec=HrmsUserContext)
    mock_ctx.user_id = user_id
    mock_ctx.is_admin = True
    mock_ctx.managed_employee_ids = [user_id]
    mock_ctx.require_module_access = MagicMock()

    mock_service = AsyncMock()

    with pytest.raises(HTTPException) as exc_info:
        await approve_leave_request(
            request_id=req_id,
            payload=LeaveApprovalAction(remarks="Self-approving my own leave"),
            service=mock_service,
            ctx=mock_ctx,
            db=mock_db,
        )

    assert exc_info.value.status_code == status.HTTP_400_BAD_REQUEST
    assert "Self-approval is not permitted" in exc_info.value.detail
    mock_service.approve_leave.assert_not_called()


@pytest.mark.asyncio
async def test_leave_rejection_rejects_self_action():
    """Verify that self-rejection is also rejected with HTTP 400."""
    user_id = uuid.uuid4()
    req_id = uuid.uuid4()

    mock_db = AsyncMock()
    mock_leave = MagicMock(spec=HrmsLeaveRequest)
    mock_leave.id = req_id
    mock_leave.employee_id = user_id
    mock_leave.approval_status = "PENDING"

    mock_db.scalar.return_value = mock_leave

    mock_ctx = MagicMock(spec=HrmsUserContext)
    mock_ctx.user_id = user_id
    mock_ctx.is_admin = True
    mock_ctx.require_module_access = MagicMock()

    mock_service = AsyncMock()

    with pytest.raises(HTTPException) as exc_info:
        await reject_leave_request(
            request_id=req_id,
            payload=LeaveApprovalAction(remarks="Self-rejecting"),
            service=mock_service,
            ctx=mock_ctx,
            db=mock_db,
        )

    assert exc_info.value.status_code == status.HTTP_400_BAD_REQUEST
    assert "Self-approval is not permitted" in exc_info.value.detail
    mock_service.reject_leave.assert_not_called()


@pytest.mark.asyncio
async def test_leave_approval_derives_reviewer_strictly_from_authenticated_principal():
    """Verify reviewer_id is taken from ctx.user_id and passed directly to service."""
    admin_id = uuid.uuid4()
    target_emp_id = uuid.uuid4()
    req_id = uuid.uuid4()

    mock_db = AsyncMock()
    mock_leave = MagicMock(spec=HrmsLeaveRequest)
    mock_leave.id = req_id
    mock_leave.employee_id = target_emp_id
    mock_leave.approval_status = "PENDING"
    mock_leave.total_days = 1

    mock_db.scalar.return_value = mock_leave

    mock_ctx = MagicMock(spec=HrmsUserContext)
    mock_ctx.user_id = admin_id
    mock_ctx.is_admin = True
    mock_ctx.require_module_access = MagicMock()

    mock_service = AsyncMock()
    mock_approved_record = MagicMock()
    mock_approved_record.model_dump.return_value = {"id": str(req_id), "status": "APPROVED"}
    mock_service.approve_leave_request.return_value = mock_approved_record

    with patch("app.hrms.leave_routes.verify_approval_authorization", new_callable=AsyncMock) as mock_verify:
        response = await approve_leave_request(
            request_id=req_id,
            payload=LeaveApprovalAction(approval_remarks="Approved by Admin"),
            service=mock_service,
            ctx=mock_ctx,
            db=mock_db,
        )

        mock_verify.assert_called_once_with(
            db=mock_db,
            ctx=mock_ctx,
            target_employee_id=target_emp_id,
            module_name="leave",
            action_label="approve",
        )
        mock_service.approve_leave_request.assert_called_once_with(
            req_id,
            reviewer_id=admin_id,
            remarks="Approved by Admin",
            is_admin=True,
        )
        assert response["data"]["status"] == "APPROVED"


@pytest.mark.asyncio
async def test_leave_rejection_derives_reviewer_strictly_from_authenticated_principal():
    """Verify reviewer_id in reject_leave_request is taken from ctx.user_id and passed directly to service."""
    admin_id = uuid.uuid4()
    target_emp_id = uuid.uuid4()
    req_id = uuid.uuid4()

    mock_db = AsyncMock()
    mock_leave = MagicMock(spec=HrmsLeaveRequest)
    mock_leave.id = req_id
    mock_leave.employee_id = target_emp_id
    mock_leave.approval_status = "PENDING"

    mock_db.scalar.return_value = mock_leave

    mock_ctx = MagicMock(spec=HrmsUserContext)
    mock_ctx.user_id = admin_id
    mock_ctx.is_admin = True
    mock_ctx.require_module_access = MagicMock()

    mock_service = AsyncMock()
    mock_rejected_record = MagicMock()
    mock_rejected_record.model_dump.return_value = {"id": str(req_id), "status": "REJECTED"}
    mock_service.reject_leave_request.return_value = mock_rejected_record

    with patch("app.hrms.leave_routes.verify_approval_authorization", new_callable=AsyncMock) as mock_verify:
        response = await reject_leave_request(
            request_id=req_id,
            payload=LeaveApprovalAction(approval_remarks="Rejected by Admin"),
            service=mock_service,
            ctx=mock_ctx,
            db=mock_db,
        )

        mock_verify.assert_called_once_with(
            db=mock_db,
            ctx=mock_ctx,
            target_employee_id=target_emp_id,
            module_name="leave",
            action_label="reject",
        )
        mock_service.reject_leave_request.assert_called_once_with(
            req_id,
            reviewer_id=admin_id,
            remarks="Rejected by Admin",
            is_admin=True,
        )
        assert response["data"]["status"] == "REJECTED"


# ==============================================================================
# DEF-AST-01: Asset Metadata & Status Mutation Role Authorization
# ==============================================================================

@pytest.mark.asyncio
async def test_asset_patch_unauthorized_user_raises_403():
    """Verify that a non-Admin/HR user cannot update asset metadata via PATCH."""
    asset_id = uuid.uuid4()
    regular_user_id = uuid.uuid4()
    ctx = (regular_user_id, False)  # is_admin_or_hr = False

    payload = AssetUpdate(asset_name="Hacked Laptop Name")
    mock_service = AsyncMock()

    with pytest.raises(HTTPException) as exc_info:
        await update_asset_patch(
            asset_id=asset_id,
            payload=payload,
            service=mock_service,
            ctx=ctx,
        )

    assert exc_info.value.status_code == status.HTTP_403_FORBIDDEN
    assert "Permission denied. Only Admin or HR" in exc_info.value.detail
    mock_service.update_asset.assert_not_called()


@pytest.mark.asyncio
async def test_asset_put_unauthorized_user_raises_403():
    """Verify that a non-Admin/HR user cannot update asset metadata via PUT."""
    asset_id = uuid.uuid4()
    regular_user_id = uuid.uuid4()
    ctx = (regular_user_id, False)

    payload = AssetUpdate(asset_name="Hacked Laptop Name")
    mock_service = AsyncMock()

    with pytest.raises(HTTPException) as exc_info:
        await update_asset_put(
            asset_id=asset_id,
            payload=payload,
            service=mock_service,
            ctx=ctx,
        )

    assert exc_info.value.status_code == status.HTTP_403_FORBIDDEN
    assert "Permission denied. Only Admin or HR" in exc_info.value.detail
    mock_service.update_asset.assert_not_called()


@pytest.mark.asyncio
async def test_asset_status_endpoint_unauthorized_user_raises_403():
    """Verify that a non-Admin/HR user cannot change asset status directly via PATCH /status."""
    asset_id = uuid.uuid4()
    regular_user_id = uuid.uuid4()
    ctx = (regular_user_id, False)

    payload = AssetStatusUpdate(status="retired", notes="Attempt unauthorized retirement")
    mock_service = AsyncMock()

    with pytest.raises(HTTPException) as exc_info:
        await update_asset_status_endpoint(
            asset_id=asset_id,
            payload=payload,
            service=mock_service,
            ctx=ctx,
        )

    assert exc_info.value.status_code == status.HTTP_403_FORBIDDEN
    assert "Permission denied. Only Admin or HR" in exc_info.value.detail
    mock_service.update_asset_status.assert_not_called()


@pytest.mark.asyncio
async def test_asset_patch_admin_authorized_succeeds():
    """Verify that an Admin/HR user is permitted to update asset metadata."""
    asset_id = uuid.uuid4()
    admin_id = uuid.uuid4()
    ctx = (admin_id, True)  # is_admin_or_hr = True

    payload = AssetUpdate(asset_name="Updated Laptop 2026")
    mock_service = AsyncMock()
    mock_asset_read = MagicMock()
    mock_asset_read.model_dump.return_value = {"id": str(asset_id), "asset_name": "Updated Laptop 2026"}
    mock_service.update_asset.return_value = mock_asset_read

    response = await update_asset_patch(
        asset_id=asset_id,
        payload=payload,
        service=mock_service,
        ctx=ctx,
    )

    mock_service.update_asset.assert_called_once_with(asset_id, payload, actor_id=admin_id)
    assert response["data"]["asset_name"] == "Updated Laptop 2026"


@pytest.mark.asyncio
async def test_asset_put_admin_authorized_succeeds():
    """Verify that an Admin/HR user is permitted to update asset metadata via PUT."""
    asset_id = uuid.uuid4()
    admin_id = uuid.uuid4()
    ctx = (admin_id, True)  # is_admin_or_hr = True

    payload = AssetUpdate(asset_name="Updated Laptop 2026 PUT")
    mock_service = AsyncMock()
    mock_asset_read = MagicMock()
    mock_asset_read.model_dump.return_value = {"id": str(asset_id), "asset_name": "Updated Laptop 2026 PUT"}
    mock_service.update_asset.return_value = mock_asset_read

    response = await update_asset_put(
        asset_id=asset_id,
        payload=payload,
        service=mock_service,
        ctx=ctx,
    )

    mock_service.update_asset.assert_called_once_with(asset_id, payload, actor_id=admin_id)
    assert response["data"]["asset_name"] == "Updated Laptop 2026 PUT"


@pytest.mark.asyncio
async def test_asset_status_endpoint_admin_authorized_succeeds():
    """Verify that an Admin/HR user is permitted to change asset status directly via PATCH /status."""
    asset_id = uuid.uuid4()
    admin_id = uuid.uuid4()
    ctx = (admin_id, True)  # is_admin_or_hr = True

    payload = AssetStatusUpdate(status="retired", notes="Authorized retirement by Admin")
    mock_service = AsyncMock()
    mock_asset_read = MagicMock()
    mock_asset_read.model_dump.return_value = {"id": str(asset_id), "status": "RETIRED"}
    mock_service.update_asset_status.return_value = mock_asset_read

    response = await update_asset_status_endpoint(
        asset_id=asset_id,
        payload=payload,
        service=mock_service,
        ctx=ctx,
    )

    mock_service.update_asset_status.assert_called_once_with(asset_id, payload, actor_id=admin_id)
    assert response["message"] == "Asset status updated to RETIRED successfully."


# ==============================================================================
# DEF-ATT-01: Authoritative Server Timestamps (Spoofing Ignored)
# ==============================================================================

@pytest.mark.asyncio
async def test_punch_in_uses_authoritative_server_clock_and_ignores_client_timestamp():
    """Verify punch_in ignores client-supplied timestamp to prevent early/late spoofing."""
    mock_db = AsyncMock()
    async def mock_refresh(rec):
        rec.id = uuid.uuid4()
        rec.created_at = datetime.now(timezone.utc)
        rec.updated_at = datetime.now(timezone.utc)
    mock_db.refresh = AsyncMock(side_effect=mock_refresh)
    mock_exec_result = MagicMock()
    mock_exec_result.scalar_one_or_none.return_value = None
    mock_db.execute.return_value = mock_exec_result
    service = HrmsAttendanceService(mock_db)

    user_id = uuid.uuid4()
    spoofed_time = datetime(2025, 1, 1, 9, 0, 0, tzinfo=timezone.utc)  # Spoofed early arrival in past year

    mock_policy = MagicMock()
    mock_policy.shift_start_time = "10:30"
    mock_policy.geofence_radius_meters = 500
    mock_policy.enable_grace = False
    mock_policy.enable_late_marks = False
    mock_policy.enable_direct_half_day = False
    mock_policy.flexible_shift = False

    mock_office = MagicMock(spec=HrmsLocation)
    mock_office.id = uuid.uuid4()
    mock_office.name = "Thane Main Office"
    mock_office.address = "123 Business Park, Thane"
    mock_office.latitude = 19.199824
    mock_office.longitude = 72.956795
    mock_office.radius_meters = 200

    service.get_policy = AsyncMock(return_value=mock_policy)
    service.get_assigned_office = AsyncMock(return_value=mock_office)
    service.get_today_attendance = AsyncMock(return_value=None)

    payload = PunchInRequest(
        latitude=19.199824,
        longitude=72.956795,
        timestamp=spoofed_time,
    )

    now_before = datetime.now(IST)
    await service.punch_in(user_id, payload)
    now_after = datetime.now(IST)

    # Inspect added record
    assert mock_db.add.called
    added_record = mock_db.add.call_args[0][0]
    assert isinstance(added_record, HrmsAttendance)

    # The punch_in must be close to current server IST time, NOT the spoofed 2025 timestamp
    assert added_record.punch_in.year == now_before.year
    assert added_record.punch_in.month == now_before.month
    assert added_record.punch_in.day == now_before.day
    assert now_before <= added_record.punch_in <= now_after
    assert added_record.attendance_date == now_before.date()
    assert added_record.attendance_date != spoofed_time.date()


# ==============================================================================
# DEF-ATT-06: Administrator Self-Approval Blocked Server-Side
# ==============================================================================

@pytest.mark.asyncio
async def test_verify_approval_authorization_blocks_admin_self_approval():
    """Verify that an Administrator cannot self-approve their own request in verify_approval_authorization."""
    admin_id = uuid.uuid4()

    mock_db = AsyncMock()
    mock_ctx = MagicMock(spec=HrmsUserContext)
    mock_ctx.user_id = admin_id
    mock_ctx.is_admin = True
    mock_ctx.managed_employee_ids = [admin_id]

    with pytest.raises(HTTPException) as exc_info:
        await verify_approval_authorization(
            db=mock_db,
            ctx=mock_ctx,
            target_employee_id=admin_id,  # Admin targeting themselves
            module_name="attendance",
            action_label="approve",
        )

    assert exc_info.value.status_code == status.HTTP_400_BAD_REQUEST
    assert "Self-approval is not permitted" in exc_info.value.detail
    assert "attendance" in exc_info.value.detail


@pytest.mark.asyncio
async def test_verify_approval_authorization_permits_admin_for_other_employees():
    """Verify that an Administrator CAN approve requests for other employees."""
    admin_id = uuid.uuid4()
    subordinate_id = uuid.uuid4()

    mock_db = AsyncMock()
    mock_ctx = MagicMock(spec=HrmsUserContext)
    mock_ctx.user_id = admin_id
    mock_ctx.is_admin = True

    # Should not raise exception
    await verify_approval_authorization(
        db=mock_db,
        ctx=mock_ctx,
        target_employee_id=subordinate_id,
        module_name="attendance",
        action_label="approve",
    )


@pytest.mark.asyncio
async def test_verify_approval_authorization_blocks_manager_self_approval():
    """Verify that a Manager cannot self-approve their own request in verify_approval_authorization."""
    manager_id = uuid.uuid4()

    mock_db = AsyncMock()
    mock_ctx = MagicMock(spec=HrmsUserContext)
    mock_ctx.user_id = manager_id
    mock_ctx.is_admin = False
    mock_ctx.managed_employee_ids = [manager_id]

    with pytest.raises(HTTPException) as exc_info:
        await verify_approval_authorization(
            db=mock_db,
            ctx=mock_ctx,
            target_employee_id=manager_id,  # Manager targeting themselves
            module_name="leave",
            action_label="approve",
        )

    assert exc_info.value.status_code == status.HTTP_400_BAD_REQUEST
    assert "Self-approval is not permitted" in exc_info.value.detail


@pytest.mark.asyncio
async def test_verify_approval_authorization_blocks_employee_self_approval():
    """Verify that a regular Employee cannot self-approve their own request."""
    emp_id = uuid.uuid4()

    mock_db = AsyncMock()
    mock_ctx = MagicMock(spec=HrmsUserContext)
    mock_ctx.user_id = emp_id
    mock_ctx.is_admin = False
    mock_ctx.managed_employee_ids = []

    with pytest.raises(HTTPException) as exc_info:
        await verify_approval_authorization(
            db=mock_db,
            ctx=mock_ctx,
            target_employee_id=emp_id,
            module_name="expenses",
            action_label="approve",
        )

    assert exc_info.value.status_code == status.HTTP_400_BAD_REQUEST
    assert "Self-approval is not permitted" in exc_info.value.detail


# ==============================================================================
# DEF-ATT-02: Geolocation & Geofence Enforcement
# ==============================================================================

@pytest.mark.asyncio
async def test_punch_in_rejects_outside_geofence():
    """Verify that punch_in rejects attendance when coordinates are outside the geofence radius."""
    mock_db = AsyncMock()
    service = HrmsAttendanceService(mock_db)

    user_id = uuid.uuid4()
    mock_policy = MagicMock()
    mock_policy.geofence_radius_meters = 150

    mock_office = MagicMock(spec=HrmsLocation)
    mock_office.id = uuid.uuid4()
    mock_office.name = "Thane Main Office"
    mock_office.latitude = 19.199824
    mock_office.longitude = 72.956795
    mock_office.radius_meters = 150

    service.get_policy = AsyncMock(return_value=mock_policy)
    service.get_assigned_office = AsyncMock(return_value=mock_office)

    # Coords ~5km away from office
    payload = PunchInRequest(
        latitude=19.250000,
        longitude=72.990000,
    )

    with pytest.raises(Exception) as exc_info:
        await service.punch_in(user_id, payload)

    assert "Outside geofence" in str(exc_info.value)


@pytest.mark.asyncio
async def test_punch_out_uses_authoritative_server_clock_and_ignores_client_timestamp():
    """Verify punch_out ignores client-supplied timestamp to prevent early/late spoofing."""
    mock_db = AsyncMock()
    service = HrmsAttendanceService(mock_db)

    user_id = uuid.uuid4()
    now_before = datetime.now(IST)
    spoofed_time = datetime(2025, 1, 1, 18, 0, 0, tzinfo=timezone.utc)

    mock_policy = MagicMock()
    mock_policy.shift_end_time = "19:00"
    mock_policy.auto_mark_irregular = False

    mock_office = MagicMock(spec=HrmsLocation)
    mock_office.id = uuid.uuid4()
    mock_office.name = "Thane Main Office"
    mock_office.address = "123 Business Park, Thane"
    mock_office.latitude = 19.199824
    mock_office.longitude = 72.956795
    mock_office.radius_meters = 200

    existing_record = HrmsAttendance(
        id=uuid.uuid4(),
        employee_id=user_id,
        attendance_date=now_before.date(),
        punch_in=now_before,
        punch_out=None,
        status="PRESENT",
        working_minutes=0,
        late_minutes=0,
        early_exit_minutes=0,
        office_location_id=mock_office.id,
        latitude=19.199824,
        longitude=72.956795,
        punch_in_distance=10.0,
        is_irregular=False,
        regularization_status="NONE",
        created_at=now_before,
        updated_at=now_before,
    )

    service.get_policy = AsyncMock(return_value=mock_policy)
    service.get_assigned_office = AsyncMock(return_value=mock_office)

    mock_exec_result = MagicMock()
    mock_exec_result.scalar_one_or_none.return_value = existing_record
    mock_db.execute.return_value = mock_exec_result

    payload = PunchOutRequest(
        latitude=19.199824,
        longitude=72.956795,
        timestamp=spoofed_time,
    )

    await service.punch_out(user_id, payload)
    now_after = datetime.now(IST)

    assert existing_record.punch_out is not None
    assert existing_record.punch_out.year == now_before.year
    assert existing_record.punch_out.month == now_before.month
    assert existing_record.punch_out.day == now_before.day
    assert now_before <= existing_record.punch_out <= now_after


@pytest.mark.asyncio
async def test_punch_in_client_timestamp_cannot_spoof_late_status_or_late_minutes():
    """Verify that a client cannot send an early timestamp to avoid a LATE or HALF_DAY status."""
    mock_db = AsyncMock()
    async def mock_refresh(rec):
        rec.id = uuid.uuid4()
        rec.created_at = datetime.now(timezone.utc)
        rec.updated_at = datetime.now(timezone.utc)
    mock_db.refresh = AsyncMock(side_effect=mock_refresh)
    mock_exec_result = MagicMock()
    mock_exec_result.scalar_one_or_none.return_value = None
    mock_db.execute.return_value = mock_exec_result
    service = HrmsAttendanceService(mock_db)

    user_id = uuid.uuid4()
    # Client sends an early 08:00 AM timestamp claiming to be on-time
    spoofed_early_time = datetime(2026, 10, 29, 2, 30, 0, tzinfo=timezone.utc)  # 08:00 AM IST

    # Shift started at 06:00 AM IST (so current time in IST is guaranteed to be later than 06:15)
    mock_policy = MagicMock()
    mock_policy.shift_start_time = "06:00"
    mock_policy.geofence_radius_meters = 500
    mock_policy.enable_grace = True
    mock_policy.grace_period_minutes = 15
    mock_policy.enable_late_marks = False
    mock_policy.enable_direct_half_day = False
    mock_policy.flexible_shift = False

    mock_office = MagicMock(spec=HrmsLocation)
    mock_office.id = uuid.uuid4()
    mock_office.name = "Thane Main Office"
    mock_office.address = "123 Business Park, Thane"
    mock_office.latitude = 19.199824
    mock_office.longitude = 72.956795
    mock_office.radius_meters = 200

    service.get_policy = AsyncMock(return_value=mock_policy)
    service.get_assigned_office = AsyncMock(return_value=mock_office)
    service.get_today_attendance = AsyncMock(return_value=None)

    payload = PunchInRequest(
        latitude=19.199824,
        longitude=72.956795,
        timestamp=spoofed_early_time,
    )

    await service.punch_in(user_id, payload)

    added_record = mock_db.add.call_args[0][0]
    now_ist = datetime.now(IST)
    expected_late_mins = (now_ist.hour * 60 + now_ist.minute) - (6 * 60)

    # Status must be LATE because server time is evaluated, ignoring the client's spoofed timestamp
    assert added_record.status == "LATE"
    assert added_record.late_minutes >= expected_late_mins - 1
    assert added_record.is_irregular is True


@pytest.mark.asyncio
async def test_punch_out_client_timestamp_cannot_inflate_working_minutes():
    """Verify that a client cannot send a future timestamp to artificially inflate working minutes."""
    mock_db = AsyncMock()
    service = HrmsAttendanceService(mock_db)

    user_id = uuid.uuid4()
    now_ist = datetime.now(IST)
    # User punched in 20 minutes ago
    actual_punch_in = now_ist.replace(minute=max(0, now_ist.minute - 20))
    # Client sends timestamp 10 hours in the future
    spoofed_future_time = datetime(2030, 1, 1, 23, 0, 0, tzinfo=timezone.utc)

    mock_policy = MagicMock()
    mock_policy.shift_end_time = "19:00"
    mock_policy.auto_mark_irregular = False

    mock_office = MagicMock(spec=HrmsLocation)
    mock_office.id = uuid.uuid4()
    mock_office.name = "Thane Main Office"
    mock_office.address = "123 Business Park, Thane"
    mock_office.latitude = 19.199824
    mock_office.longitude = 72.956795
    mock_office.radius_meters = 200

    existing_record = HrmsAttendance(
        id=uuid.uuid4(),
        employee_id=user_id,
        attendance_date=now_ist.date(),
        punch_in=actual_punch_in,
        punch_out=None,
        status="PRESENT",
        working_minutes=0,
        late_minutes=0,
        early_exit_minutes=0,
        office_location_id=mock_office.id,
        latitude=19.199824,
        longitude=72.956795,
        punch_in_distance=10.0,
        is_irregular=False,
        regularization_status="NONE",
        created_at=actual_punch_in,
        updated_at=actual_punch_in,
    )

    service.get_policy = AsyncMock(return_value=mock_policy)
    service.get_assigned_office = AsyncMock(return_value=mock_office)

    mock_exec_result = MagicMock()
    mock_exec_result.scalar_one_or_none.return_value = existing_record
    mock_db.execute.return_value = mock_exec_result

    payload = PunchOutRequest(
        latitude=19.199824,
        longitude=72.956795,
        timestamp=spoofed_future_time,
    )

    await service.punch_out(user_id, payload)

    # Working minutes must reflect server time (~20 minutes), NOT the spoofed future year
    assert existing_record.working_minutes < 60
    assert existing_record.punch_out.year == now_ist.year
    assert existing_record.punch_out.year != spoofed_future_time.year


# ==============================================================================
# BATCH 1A: Direct Calendar Regularization Security & Self-Approval Prevention
# ==============================================================================

@pytest.mark.asyncio
async def test_admin_direct_self_regularization_route_rejected_with_400():
    """Verify that an Administrator attempting direct calendar regularization for themselves is rejected with HTTP 400."""
    admin_id = uuid.uuid4()
    mock_ctx = MagicMock(spec=HrmsUserContext)
    mock_ctx.user_id = admin_id
    mock_ctx.is_admin = True
    mock_ctx.is_hr = False
    mock_ctx.require_module_access = MagicMock()

    mock_service = AsyncMock()
    payload = RegularizationRequest(
        date="2026-10-29",
        reason="Client Meeting",
        direct_regularize=True,
        # Either no employee_id or explicitly setting own ID
        employee_id=admin_id,
    )

    with pytest.raises(HTTPException) as exc_info:
        await submit_regularization(
            payload=payload,
            ctx=mock_ctx,
            service=mock_service,
        )

    assert exc_info.value.status_code == status.HTTP_400_BAD_REQUEST
    assert "Self-approval is not permitted" in exc_info.value.detail
    mock_service.submit_regularization.assert_not_called()


@pytest.mark.asyncio
async def test_ordinary_employee_direct_regularization_rejected_with_403():
    """Verify that a non-admin employee attempting direct regularization is rejected with HTTP 403."""
    emp_id = uuid.uuid4()
    mock_ctx = MagicMock(spec=HrmsUserContext)
    mock_ctx.user_id = emp_id
    mock_ctx.is_admin = False
    mock_ctx.is_hr = False
    mock_ctx.require_module_access = MagicMock()

    mock_service = AsyncMock()
    payload = RegularizationRequest(
        date="2026-10-29",
        reason="Traffic Delay",
        direct_regularize=True,
    )

    with pytest.raises(HTTPException) as exc_info:
        await submit_regularization(
            payload=payload,
            ctx=mock_ctx,
            service=mock_service,
        )

    assert exc_info.value.status_code == status.HTTP_403_FORBIDDEN
    assert "Permission denied. Only administrators" in exc_info.value.detail
    mock_service.submit_regularization.assert_not_called()


@pytest.mark.asyncio
async def test_admin_direct_regularization_for_another_employee_succeeds():
    """Verify that an Administrator CAN directly regularize attendance for another employee."""
    admin_id = uuid.uuid4()
    subordinate_id = uuid.uuid4()

    mock_ctx = MagicMock(spec=HrmsUserContext)
    mock_ctx.user_id = admin_id
    mock_ctx.is_admin = True
    mock_ctx.is_hr = False
    mock_ctx.require_module_access = MagicMock()

    mock_service = AsyncMock()
    mock_record = MagicMock()
    mock_record.model_dump.return_value = {
        "id": str(uuid.uuid4()),
        "employee_id": str(subordinate_id),
        "status": "PRESENT",
        "regularization_status": "APPROVED",
    }
    mock_service.submit_regularization.return_value = mock_record

    payload = RegularizationRequest(
        date="2026-10-29",
        reason="Official Onsite Visit",
        direct_regularize=True,
        employee_id=subordinate_id,
    )

    response = await submit_regularization(
        payload=payload,
        ctx=mock_ctx,
        service=mock_service,
    )

    mock_service.submit_regularization.assert_called_once_with(
        subordinate_id,
        payload,
        is_admin=True,
        actor_id=admin_id,
    )
    assert response["data"]["status"] == "PRESENT"
    assert response["data"]["regularization_status"] == "APPROVED"


@pytest.mark.asyncio
async def test_admin_standard_non_direct_regularization_for_self_succeeds():
    """Verify that an Administrator submitting a standard (non-direct) request for themselves is routed to standard approval."""
    admin_id = uuid.uuid4()
    mock_ctx = MagicMock(spec=HrmsUserContext)
    mock_ctx.user_id = admin_id
    mock_ctx.is_admin = True
    mock_ctx.is_hr = False
    mock_ctx.require_module_access = MagicMock()

    mock_service = AsyncMock()
    mock_record = MagicMock()
    mock_record.model_dump.return_value = {
        "id": str(uuid.uuid4()),
        "employee_id": str(admin_id),
        "status": "ABSENT",
        "regularization_status": "PENDING",
    }
    mock_service.submit_regularization.return_value = mock_record

    payload = RegularizationRequest(
        date="2026-10-29",
        reason="Family Emergency",
        direct_regularize=False,  # Standard request
    )

    response = await submit_regularization(
        payload=payload,
        ctx=mock_ctx,
        service=mock_service,
    )

    mock_service.submit_regularization.assert_called_once_with(
        admin_id,
        payload,
        is_admin=True,
        actor_id=admin_id,
    )
    assert response["data"]["regularization_status"] == "PENDING"


@pytest.mark.asyncio
async def test_attendance_service_submit_regularization_blocks_self_direct_regularization():
    """Verify that HrmsAttendanceService.submit_regularization directly blocks self direct-regularization when actor_id == user_id."""
    mock_db = AsyncMock()
    service = HrmsAttendanceService(mock_db)

    admin_id = uuid.uuid4()
    payload = RegularizationRequest(
        date="2026-10-29",
        reason="Test Reason",
        direct_regularize=True,
    )

    with pytest.raises(BadRequestException) as exc_info:
        await service.submit_regularization(
            user_id=admin_id,
            payload=payload,
            is_admin=True,
            actor_id=admin_id,  # Self action
        )

    assert "Self-approval is not permitted" in str(exc_info.value)


