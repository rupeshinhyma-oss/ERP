"""
Unit & Integration Tests for HRMS Attendance Regularization Self-Approval Workflow.

Test Matrix from Specification:
1. Admin submits own request -> Allowed
2. Admin approves own request -> Allowed
3. Authorized HRMS user submits own request -> Allowed
4. Authorized HRMS user approves own request -> Allowed
5. Unauthorized employee approves own request -> Rejected (400)
6. Unauthorized manager approves own request -> Rejected (400)
7. Manager approves assigned employee request -> Existing behavior preserved (Allowed)
8. Admin approves another employee request -> Existing permissions preserved (Allowed)
9. User attempts API authorization bypass -> Rejected (403)
10. User tries to approve an already processed request -> Rejected (400)
11. Admin & Authorized HRMS user rejects own request -> Allowed
12. Leave/Expenses/Assets self-approval remains strictly blocked for all users
"""

from __future__ import annotations

import uuid
from datetime import date, datetime, timezone
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import HTTPException, status

from app.hrms.attendance_routes import approve_regularization, reject_regularization, submit_regularization
from app.hrms.attendance_service import HrmsAttendanceService, IST
from app.hrms.models import HrmsAttendanceRegularization
from app.hrms.rbac import HrmsUserContext, verify_approval_authorization
from app.hrms.schemas import RegularizationApprovalAction, RegularizationRejectAction, RegularizationRequest
from app.users.models import User


@pytest.fixture
def sample_ids():
    return {
        "admin_id": uuid.uuid4(),
        "hr_id": uuid.uuid4(),
        "manager_id": uuid.uuid4(),
        "employee_id": uuid.uuid4(),
        "request_id": uuid.uuid4(),
    }


# ==============================================================================
# 1 & 3: Submitting Own Request
# ==============================================================================

@pytest.mark.asyncio
async def test_admin_submits_own_request_allowed(sample_ids):
    """Admin submits standard attendance regularization for themselves."""
    admin_id = sample_ids["admin_id"]
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
        "regularization_status": "PENDING",
    }
    mock_service.submit_regularization.return_value = mock_record

    payload = RegularizationRequest(
        date="2026-11-10",
        reason="Client Meeting",
        punch_in="09:30 AM",
        punch_out="06:30 PM",
        note="Met client at BKC",
        direct_regularize=False,
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
async def test_authorized_hrms_user_submits_own_request_allowed(sample_ids):
    """Authorized HRMS user submits standard regularization for themselves."""
    hr_id = sample_ids["hr_id"]
    mock_ctx = MagicMock(spec=HrmsUserContext)
    mock_ctx.user_id = hr_id
    mock_ctx.is_admin = False
    mock_ctx.is_hr = True
    mock_ctx.permissions = {"hrms.attendance", "hrms.approve"}
    mock_ctx.require_module_access = MagicMock()

    mock_service = AsyncMock()
    mock_record = MagicMock()
    mock_record.model_dump.return_value = {
        "id": str(uuid.uuid4()),
        "employee_id": str(hr_id),
        "regularization_status": "PENDING",
    }
    mock_service.submit_regularization.return_value = mock_record

    payload = RegularizationRequest(
        date="2026-11-10",
        reason="Work From Home",
        punch_in="09:00 AM",
        punch_out="06:00 PM",
        note="Approved remote day",
        direct_regularize=False,
    )

    response = await submit_regularization(
        payload=payload,
        ctx=mock_ctx,
        service=mock_service,
    )

    mock_service.submit_regularization.assert_called_once_with(
        hr_id,
        payload,
        is_admin=False,
        actor_id=hr_id,
    )
    assert response["data"]["regularization_status"] == "PENDING"


# ==============================================================================
# 2 & 4: Self-Approval Allowed for Admin & Authorized HRMS
# ==============================================================================

@pytest.mark.asyncio
async def test_admin_approves_own_request_allowed(sample_ids):
    """Admin verifies and approves their own attendance regularization request."""
    admin_id = sample_ids["admin_id"]
    req_id = sample_ids["request_id"]

    mock_db = AsyncMock()
    mock_ctx = MagicMock(spec=HrmsUserContext)
    mock_ctx.user_id = admin_id
    mock_ctx.is_admin = True
    mock_ctx.permissions = {"hrms:admin"}
    mock_ctx.can_access_module.return_value = True

    # 1. verify_approval_authorization must not raise
    await verify_approval_authorization(
        db=mock_db,
        ctx=mock_ctx,
        target_employee_id=admin_id,
        module_name="attendance",
        action_label="approve",
    )


@pytest.mark.asyncio
async def test_authorized_hrms_user_approves_own_request_allowed(sample_ids):
    """Explicitly authorized HRMS personnel verifies and approves own attendance request."""
    hr_id = sample_ids["hr_id"]

    mock_db = AsyncMock()
    mock_ctx = MagicMock(spec=HrmsUserContext)
    mock_ctx.user_id = hr_id
    mock_ctx.is_admin = False
    mock_ctx.is_hr = True
    mock_ctx.permissions = {"hrms.attendance", "hrms.approve"}
    mock_ctx.can_access_module.return_value = True

    # 1. verify_approval_authorization must not raise
    await verify_approval_authorization(
        db=mock_db,
        ctx=mock_ctx,
        target_employee_id=hr_id,
        module_name="attendance",
        action_label="approve",
    )


@pytest.mark.asyncio
async def test_admin_and_hr_can_reject_own_request(sample_ids):
    """Admin and authorized HRMS user can reject their own attendance regularization request."""
    admin_id = sample_ids["admin_id"]
    hr_id = sample_ids["hr_id"]
    mock_db = AsyncMock()

    # Admin
    admin_ctx = MagicMock(spec=HrmsUserContext)
    admin_ctx.user_id = admin_id
    admin_ctx.is_admin = True
    admin_ctx.permissions = {"hrms:admin"}
    admin_ctx.can_access_module.return_value = True
    await verify_approval_authorization(
        db=mock_db,
        ctx=admin_ctx,
        target_employee_id=admin_id,
        module_name="attendance",
        action_label="reject",
    )

    # HR
    hr_ctx = MagicMock(spec=HrmsUserContext)
    hr_ctx.user_id = hr_id
    hr_ctx.is_admin = False
    hr_ctx.is_hr = True
    hr_ctx.permissions = {"hrms.attendance", "hrms.manage"}
    hr_ctx.can_access_module.return_value = True
    await verify_approval_authorization(
        db=mock_db,
        ctx=hr_ctx,
        target_employee_id=hr_id,
        module_name="attendance",
        action_label="reject",
    )


# ==============================================================================
# 5 & 6: Self-Approval Blocked for Unauthorized Employee & Manager
# ==============================================================================

@pytest.mark.asyncio
async def test_unauthorized_employee_approves_own_request_rejected(sample_ids):
    """Unauthorized normal employee attempting self-approval is rejected with HTTP 400."""
    emp_id = sample_ids["employee_id"]

    mock_db = AsyncMock()
    mock_ctx = MagicMock(spec=HrmsUserContext)
    mock_ctx.user_id = emp_id
    mock_ctx.is_admin = False
    mock_ctx.is_hr = False
    mock_ctx.is_manager = False
    mock_ctx.permissions = {"hrms.attendance"}
    mock_ctx.can_access_module.return_value = True

    with pytest.raises(HTTPException) as exc_info:
        await verify_approval_authorization(
            db=mock_db,
            ctx=mock_ctx,
            target_employee_id=emp_id,
            module_name="attendance",
            action_label="approve",
        )

    assert exc_info.value.status_code == status.HTTP_400_BAD_REQUEST
    assert "Self-approval is not permitted" in exc_info.value.detail


@pytest.mark.asyncio
async def test_unauthorized_manager_approves_own_request_rejected(sample_ids):
    """Department manager without explicit approval permission attempting self-approval is rejected."""
    manager_id = sample_ids["manager_id"]

    mock_db = AsyncMock()
    mock_ctx = MagicMock(spec=HrmsUserContext)
    mock_ctx.user_id = manager_id
    mock_ctx.is_admin = False
    mock_ctx.is_hr = False
    mock_ctx.is_manager = True
    # Manager has managed employees but NO hrms.approve or hrms.manage
    mock_ctx.permissions = {"hrms.attendance"}
    mock_ctx.managed_employee_ids = {manager_id, sample_ids["employee_id"]}
    mock_ctx.can_access_module.return_value = True

    with pytest.raises(HTTPException) as exc_info:
        await verify_approval_authorization(
            db=mock_db,
            ctx=mock_ctx,
            target_employee_id=manager_id,
            module_name="attendance",
            action_label="approve",
        )

    assert exc_info.value.status_code == status.HTTP_400_BAD_REQUEST
    assert "Self-approval is not permitted" in exc_info.value.detail


# ==============================================================================
# 7 & 8: Existing Approval Rights Preserved
# ==============================================================================

@pytest.mark.asyncio
async def test_manager_approves_assigned_employee_request_allowed(sample_ids):
    """Manager approving an assigned employee's attendance request remains allowed."""
    manager_id = sample_ids["manager_id"]
    emp_id = sample_ids["employee_id"]

    mock_db = AsyncMock()
    mock_emp = MagicMock(spec=User)
    mock_emp.id = emp_id
    mock_emp.manager_id = manager_id
    mock_db.get.return_value = mock_emp

    mock_ctx = MagicMock(spec=HrmsUserContext)
    mock_ctx.user_id = manager_id
    mock_ctx.is_admin = False
    mock_ctx.is_manager = True
    mock_ctx.managed_employee_ids = {emp_id}
    mock_ctx.permissions = set()

    await verify_approval_authorization(
        db=mock_db,
        ctx=mock_ctx,
        target_employee_id=emp_id,
        module_name="attendance",
        action_label="approve",
    )


@pytest.mark.asyncio
async def test_admin_approves_another_employee_request_allowed(sample_ids):
    """Admin approving any other employee's request remains allowed."""
    admin_id = sample_ids["admin_id"]
    emp_id = sample_ids["employee_id"]

    mock_db = AsyncMock()
    mock_ctx = MagicMock(spec=HrmsUserContext)
    mock_ctx.user_id = admin_id
    mock_ctx.is_admin = True
    mock_ctx.permissions = {"hrms:admin"}

    await verify_approval_authorization(
        db=mock_db,
        ctx=mock_ctx,
        target_employee_id=emp_id,
        module_name="attendance",
        action_label="approve",
    )


# ==============================================================================
# 9 & 10: Authorization Bypass & Already Processed Request Protections
# ==============================================================================

@pytest.mark.asyncio
async def test_unauthorized_user_api_bypass_rejected_with_403(sample_ids):
    """Ordinary employee attempting to approve another employee's request is rejected with 403."""
    emp1_id = sample_ids["employee_id"]
    emp2_id = uuid.uuid4()

    mock_db = AsyncMock()
    mock_emp2 = MagicMock(spec=User)
    mock_emp2.id = emp2_id
    mock_emp2.manager_id = sample_ids["manager_id"]
    mock_db.get.return_value = mock_emp2

    mock_ctx = MagicMock(spec=HrmsUserContext)
    mock_ctx.user_id = emp1_id
    mock_ctx.is_admin = False
    mock_ctx.is_hr = False
    mock_ctx.is_manager = False
    mock_ctx.managed_employee_ids = set()
    mock_ctx.permissions = set()
    mock_ctx.can_access_module.return_value = True

    with pytest.raises(HTTPException) as exc_info:
        await verify_approval_authorization(
            db=mock_db,
            ctx=mock_ctx,
            target_employee_id=emp2_id,
            module_name="attendance",
            action_label="approve",
        )

    assert exc_info.value.status_code == status.HTTP_403_FORBIDDEN
    assert "Permission denied" in exc_info.value.detail


@pytest.mark.asyncio
async def test_user_tries_to_approve_already_processed_request_rejected(sample_ids):
    """Calling approve endpoint on an already approved or rejected request raises HTTP 400."""
    admin_id = sample_ids["admin_id"]
    req_id = sample_ids["request_id"]

    mock_db = AsyncMock()
    mock_reg = MagicMock(spec=HrmsAttendanceRegularization)
    mock_reg.id = req_id
    mock_reg.employee_id = admin_id
    mock_reg.status = "APPROVED"  # Already processed

    mock_res = MagicMock()
    mock_res.scalar_one_or_none.return_value = mock_reg
    mock_db.execute.return_value = mock_res

    mock_ctx = MagicMock(spec=HrmsUserContext)
    mock_ctx.user_id = admin_id
    mock_ctx.is_admin = True
    mock_ctx.require_module_access = MagicMock()

    mock_service = AsyncMock()

    with pytest.raises(HTTPException) as exc_info:
        await approve_regularization(
            request_id=req_id,
            payload=RegularizationApprovalAction(action="APPROVE"),
            ctx=mock_ctx,
            service=mock_service,
            db=mock_db,
        )

    assert exc_info.value.status_code == status.HTTP_400_BAD_REQUEST
    assert "already APPROVED" in exc_info.value.detail
    mock_service.approve_regularization.assert_not_called()


# ==============================================================================
# 11: Non-Attendance Modules Self-Approval Remains Strictly Blocked
# ==============================================================================

@pytest.mark.asyncio
async def test_non_attendance_modules_self_approval_remains_blocked_for_all(sample_ids):
    """Leave, Expenses, Assets, and other modules still strictly block self-approval even for Admin."""
    admin_id = sample_ids["admin_id"]
    mock_db = AsyncMock()

    mock_ctx = MagicMock(spec=HrmsUserContext)
    mock_ctx.user_id = admin_id
    mock_ctx.is_admin = True
    mock_ctx.permissions = {"hrms:admin"}

    for mod in ("leave", "expenses", "assets"):
        with pytest.raises(HTTPException) as exc_info:
            await verify_approval_authorization(
                db=mock_db,
                ctx=mock_ctx,
                target_employee_id=admin_id,
                module_name=mod,
                action_label="approve",
            )
        assert exc_info.value.status_code == status.HTTP_400_BAD_REQUEST
        assert "Self-approval is not permitted" in exc_info.value.detail

