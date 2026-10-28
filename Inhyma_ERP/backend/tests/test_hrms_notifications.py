"""
Unit Tests for HRMS Central Notification Integration (Phase 4).

Covers:
1. Leave request notification: manager-first routing and HR fallback.
2. Leave approval and rejection notifications to requesting employee.
3. Attendance regularization request notification: manager-first and HR fallback.
4. Attendance regularization approval and rejection notifications to employee.
5. Expense claim submission notification: manager-first and HR fallback.
6. Expense claim approval and rejection notifications to employee.
7. Asset assignment notification to assigned employee.
8. Self-notification exclusion.
9. Deduplication via has_recent_notification within 24 hours.
10. SAVEPOINT isolation: notification persistence failure does not poison outer transaction.
11. Core entity failure before savepoint propagates normally.
"""

from __future__ import annotations

import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.hrms.notifications import (
    notify_asset_assigned,
    notify_expense_decision,
    notify_expense_submitted,
    notify_leave_decision,
    notify_leave_requested,
    notify_regularization_decision,
    notify_regularization_requested,
    resolve_hrms_approvers,
    send_isolated_hrms_notification,
)
from app.users.models import User


def make_mock_session():
    """Create a mock SQLAlchemy AsyncSession with SAVEPOINT (begin_nested) support."""
    session = MagicMock()
    session.get = AsyncMock(return_value=None)
    session.add = MagicMock()
    session.flush = AsyncMock()
    session.commit = AsyncMock()
    session.rollback = AsyncMock()

    nested_savepoint = MagicMock()
    nested_savepoint.__aenter__ = AsyncMock(return_value=nested_savepoint)
    nested_savepoint.__aexit__ = AsyncMock(return_value=None)
    session.begin_nested.return_value = nested_savepoint

    fallback_res = MagicMock()
    fallback_res.scalars.return_value.all.return_value = []
    fallback_res.scalar_one_or_none.return_value = None
    session.execute = AsyncMock(return_value=fallback_res)
    return session, nested_savepoint


# ---------------------------------------------------------------------------
# Approver Resolution: Manager-First vs HR Fallback
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_resolve_approvers_manager_available():
    """When manager is assigned and available, only the manager is returned."""
    session, _ = make_mock_session()
    emp_id = uuid.uuid4()
    mgr_id = uuid.uuid4()

    mock_emp = MagicMock(spec=User)
    mock_emp.id = emp_id
    mock_emp.manager_id = mgr_id
    session.get.return_value = mock_emp

    with patch("app.hrms.notifications.check_manager_availability", new_callable=AsyncMock) as mock_chk:
        mock_chk.return_value = (True, "AVAILABLE")
        approvers = await resolve_hrms_approvers(session, emp_id)

        assert approvers == [mgr_id]
        mock_chk.assert_awaited_once_with(session, mgr_id)


@pytest.mark.asyncio
async def test_resolve_approvers_manager_unavailable_routes_to_hr():
    """When manager is on leave or unassigned, routes to active HR/Admin users."""
    session, _ = make_mock_session()
    emp_id = uuid.uuid4()
    mgr_id = uuid.uuid4()
    hr_user_id = uuid.uuid4()

    mock_emp = MagicMock(spec=User)
    mock_emp.id = emp_id
    mock_emp.manager_id = mgr_id
    session.get.return_value = mock_emp

    # Mock HR query result
    hr_res = MagicMock()
    hr_res.scalars.return_value.all.return_value = [hr_user_id]
    session.execute.return_value = hr_res

    with patch("app.hrms.notifications.check_manager_availability", new_callable=AsyncMock) as mock_chk:
        mock_chk.return_value = (False, "MANAGER_ON_LEAVE")
        approvers = await resolve_hrms_approvers(session, emp_id)

        assert approvers == [hr_user_id]


@pytest.mark.asyncio
async def test_resolve_approvers_unassigned_manager_routes_to_hr():
    """When employee has no assigned manager, falls back to HR/Admin."""
    session, _ = make_mock_session()
    emp_id = uuid.uuid4()
    hr_user_id = uuid.uuid4()

    mock_emp = MagicMock(spec=User)
    mock_emp.id = emp_id
    mock_emp.manager_id = None
    session.get.return_value = mock_emp

    hr_res = MagicMock()
    hr_res.scalars.return_value.all.return_value = [hr_user_id, emp_id]
    session.execute.return_value = hr_res

    approvers = await resolve_hrms_approvers(session, emp_id)
    # Employee themself is excluded from approver list
    assert approvers == [hr_user_id]


# ---------------------------------------------------------------------------
# Leave Notifications
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_notify_leave_requested_dispatches_to_approver():
    session, savepoint = make_mock_session()
    emp_id = uuid.uuid4()
    mgr_id = uuid.uuid4()

    mock_emp = MagicMock(spec=User)
    mock_emp.id = emp_id
    mock_emp.first_name = "Jane"
    mock_emp.last_name = "Doe"
    session.get.return_value = mock_emp

    with (
        patch("app.hrms.notifications.resolve_hrms_approvers", new_callable=AsyncMock) as mock_res,
        patch("app.hrms.notifications.NotificationService") as mock_svc_cls,
        patch("app.hrms.notifications.NotificationRepository") as mock_repo_cls,
    ):
        mock_res.return_value = [mgr_id]
        mock_svc = MagicMock()
        mock_svc.has_recent_notification = AsyncMock(return_value=False)
        mock_svc.notify_user = AsyncMock()
        mock_svc_cls.return_value = mock_svc

        await notify_leave_requested(
            session,
            employee_id=emp_id,
            from_date="2026-11-01",
            to_date="2026-11-03",
            number_of_days=3.0,
            actor_id=emp_id,
        )

        session.begin_nested.assert_called_once()
        mock_svc.notify_user.assert_awaited_once_with(
            user_id=mgr_id,
            type="hrms_leave_requested",
            title="Leave Request Submitted",
            message="Jane Doe submitted a leave request (3 day(s), 2026-11-01 to 2026-11-03).",
            link="/hrms/leave",
        )


@pytest.mark.asyncio
async def test_notify_leave_decision_approved_and_rejected():
    session, _ = make_mock_session()
    emp_id = uuid.uuid4()
    reviewer_id = uuid.uuid4()

    with (
        patch("app.hrms.notifications.NotificationService") as mock_svc_cls,
        patch("app.hrms.notifications.NotificationRepository") as mock_repo_cls,
    ):
        mock_svc = MagicMock()
        mock_svc.has_recent_notification = AsyncMock(return_value=False)
        mock_svc.notify_user = AsyncMock()
        mock_svc_cls.return_value = mock_svc

        # 1. Approval
        await notify_leave_decision(
            session,
            employee_id=emp_id,
            decision="APPROVED",
            from_date="2026-11-01",
            to_date="2026-11-03",
            number_of_days=3.0,
            actor_id=reviewer_id,
        )
        mock_svc.notify_user.assert_awaited_with(
            user_id=emp_id,
            type="hrms_leave_approved",
            title="Leave Request Approved",
            message="Your leave request for 3 day(s) from 2026-11-01 to 2026-11-03 has been approved.",
            link="/hrms/leave",
        )

        mock_svc.notify_user.reset_mock()

        # 2. Rejection
        await notify_leave_decision(
            session,
            employee_id=emp_id,
            decision="REJECTED",
            from_date="2026-11-01",
            to_date="2026-11-03",
            number_of_days=3.0,
            actor_id=reviewer_id,
        )
        mock_svc.notify_user.assert_awaited_with(
            user_id=emp_id,
            type="hrms_leave_rejected",
            title="Leave Request Rejected",
            message="Your leave request for 3 day(s) from 2026-11-01 to 2026-11-03 was rejected.",
            link="/hrms/leave",
        )


# ---------------------------------------------------------------------------
# Attendance Regularization Notifications
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_notify_regularization_requested_and_decision():
    session, _ = make_mock_session()
    emp_id = uuid.uuid4()
    mgr_id = uuid.uuid4()

    mock_emp = MagicMock(spec=User)
    mock_emp.id = emp_id
    mock_emp.first_name = "Alex"
    mock_emp.last_name = "Smith"
    session.get.return_value = mock_emp

    with (
        patch("app.hrms.notifications.resolve_hrms_approvers", new_callable=AsyncMock) as mock_res,
        patch("app.hrms.notifications.NotificationService") as mock_svc_cls,
        patch("app.hrms.notifications.NotificationRepository") as mock_repo_cls,
    ):
        mock_res.return_value = [mgr_id]
        mock_svc = MagicMock()
        mock_svc.has_recent_notification = AsyncMock(return_value=False)
        mock_svc.notify_user = AsyncMock()
        mock_svc_cls.return_value = mock_svc

        # Submitter request
        await notify_regularization_requested(
            session,
            employee_id=emp_id,
            attendance_date="2026-10-25",
            reason="Traffic jam on highway",
            actor_id=emp_id,
        )
        mock_svc.notify_user.assert_awaited_once_with(
            user_id=mgr_id,
            type="hrms_regularization_requested",
            title="Attendance Regularization Requested",
            message="Alex Smith requested attendance regularization for 2026-10-25.",
            link="/hrms/attendance",
        )

        mock_svc.notify_user.reset_mock()

        # Decision
        await notify_regularization_decision(
            session,
            employee_id=emp_id,
            decision="APPROVED",
            attendance_date="2026-10-25",
            actor_id=mgr_id,
        )
        mock_svc.notify_user.assert_awaited_once_with(
            user_id=emp_id,
            type="hrms_regularization_approved",
            title="Regularization Request Approved",
            message="Your attendance regularization request for 2026-10-25 has been approved.",
            link="/hrms/attendance",
        )


# ---------------------------------------------------------------------------
# Expense Notifications
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_notify_expense_submitted_and_decision():
    session, _ = make_mock_session()
    emp_id = uuid.uuid4()
    mgr_id = uuid.uuid4()

    mock_emp = MagicMock(spec=User)
    mock_emp.id = emp_id
    mock_emp.first_name = "Carlos"
    mock_emp.last_name = "Ray"
    session.get.return_value = mock_emp

    with (
        patch("app.hrms.notifications.resolve_hrms_approvers", new_callable=AsyncMock) as mock_res,
        patch("app.hrms.notifications.NotificationService") as mock_svc_cls,
        patch("app.hrms.notifications.NotificationRepository") as mock_repo_cls,
    ):
        mock_res.return_value = [mgr_id]
        mock_svc = MagicMock()
        mock_svc.has_recent_notification = AsyncMock(return_value=False)
        mock_svc.notify_user = AsyncMock()
        mock_svc_cls.return_value = mock_svc

        await notify_expense_submitted(
            session,
            employee_id=emp_id,
            expense_code="EXP-0042",
            category="Travel",
            amount=1500.50,
            currency="INR",
            actor_id=emp_id,
        )
        mock_svc.notify_user.assert_awaited_once_with(
            user_id=mgr_id,
            type="hrms_expense_submitted",
            title="Expense Claim Submitted",
            message="Carlos Ray submitted expense claim EXP-0042 (Travel, INR 1500.50).",
            link="/hrms/expenses",
        )

        mock_svc.notify_user.reset_mock()

        await notify_expense_decision(
            session,
            employee_id=emp_id,
            decision="APPROVED",
            expense_code="EXP-0042",
            category="Travel",
            actor_id=mgr_id,
        )
        mock_svc.notify_user.assert_awaited_once_with(
            user_id=emp_id,
            type="hrms_expense_approved",
            title="Expense Claim Approved",
            message="Your expense claim EXP-0042 (Travel) has been approved.",
            link="/hrms/expenses",
        )


# ---------------------------------------------------------------------------
# Asset Assignment Notification
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_notify_asset_assigned():
    session, _ = make_mock_session()
    emp_id = uuid.uuid4()
    admin_id = uuid.uuid4()

    with (
        patch("app.hrms.notifications.NotificationService") as mock_svc_cls,
        patch("app.hrms.notifications.NotificationRepository") as mock_repo_cls,
    ):
        mock_svc = MagicMock()
        mock_svc.has_recent_notification = AsyncMock(return_value=False)
        mock_svc.notify_user = AsyncMock()
        mock_svc_cls.return_value = mock_svc

        await notify_asset_assigned(
            session,
            employee_id=emp_id,
            asset_name="MacBook Pro 16",
            asset_code="AST-0091",
            actor_id=admin_id,
        )
        mock_svc.notify_user.assert_awaited_once_with(
            user_id=emp_id,
            type="hrms_asset_assigned",
            title="Asset Assigned",
            message="Asset MacBook Pro 16 (AST-0091) has been assigned to you.",
            link="/hrms/assets",
        )


# ---------------------------------------------------------------------------
# Self-Notification Exclusion & Deduplication
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_self_notification_exclusion():
    """Actor assigning asset to themself or approving their own record does not send notification."""
    session, _ = make_mock_session()
    actor_id = uuid.uuid4()

    with (
        patch("app.hrms.notifications.NotificationService") as mock_svc_cls,
        patch("app.hrms.notifications.NotificationRepository") as mock_repo_cls,
    ):
        mock_svc = MagicMock()
        mock_svc.notify_user = AsyncMock()
        mock_svc_cls.return_value = mock_svc

        await notify_asset_assigned(
            session,
            employee_id=actor_id,
            asset_name="Mouse",
            asset_code="AST-001",
            actor_id=actor_id,
        )
        mock_svc.notify_user.assert_not_awaited()


@pytest.mark.asyncio
async def test_deduplication_prevents_duplicate_notifications():
    session, _ = make_mock_session()
    recipient_id = uuid.uuid4()

    with (
        patch("app.hrms.notifications.NotificationService") as mock_svc_cls,
        patch("app.hrms.notifications.NotificationRepository") as mock_repo_cls,
    ):
        mock_svc = MagicMock()
        mock_svc.has_recent_notification = AsyncMock(return_value=True)  # Already sent
        mock_svc.notify_user = AsyncMock()
        mock_svc_cls.return_value = mock_svc

        await send_isolated_hrms_notification(
            session,
            recipient_id=recipient_id,
            type="hrms_leave_approved",
            title="Title",
            message="Msg",
            link="/hrms/leave",
        )
        mock_svc.notify_user.assert_not_awaited()


# ---------------------------------------------------------------------------
# SAVEPOINT Isolation & Transaction Integrity
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_notification_failure_inside_savepoint_does_not_abort_outer_session():
    """A database error during notification insert rolls back only savepoint and outer session can commit."""
    session, savepoint = make_mock_session()
    recipient_id = uuid.uuid4()

    with (
        patch("app.hrms.notifications.NotificationService") as mock_svc_cls,
        patch("app.hrms.notifications.NotificationRepository") as mock_repo_cls,
    ):
        mock_svc = MagicMock()
        mock_svc.has_recent_notification = AsyncMock(return_value=False)
        mock_svc.notify_user = AsyncMock(side_effect=RuntimeError("DB constraint violation on notifications"))
        mock_svc_cls.return_value = mock_svc

        # Should not raise exception
        await send_isolated_hrms_notification(
            session,
            recipient_id=recipient_id,
            type="hrms_leave_requested",
            title="Title",
            message="Msg",
            link="/hrms/leave",
        )

        # Savepoint __aexit__ handled the rollback
        savepoint.__aexit__.assert_awaited_once()

        # Outer session rollback was NOT triggered
        session.rollback.assert_not_called()

        # Outer session can now cleanly commit
        await session.commit()
        session.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_core_flush_failure_before_savepoint_propagates_normally():
    """If core HRMS entity flush fails before savepoint, it raises immediately."""
    session, _ = make_mock_session()
    session.flush = AsyncMock(side_effect=ValueError("Core entity check constraint failed"))

    with pytest.raises(ValueError, match="Core entity check constraint failed"):
        await send_isolated_hrms_notification(
            session,
            recipient_id=uuid.uuid4(),
            type="hrms_leave_requested",
            title="Title",
            message="Msg",
            link="/hrms/leave",
        )

    # Savepoint was never initiated
    session.begin_nested.assert_not_called()
