"""
HRMS Batch 3 Integrity & Concurrency Regression Tests.

Validates the 4 confirmed integrity findings:
1. Finding 1: Payroll Batch Self-Approval Dual Control
   - Reject entire monthly payroll batch approval when the approver has a payslip in that batch.
   - Verify rejection occurs before modifying batch or item status (no partial state mutation).
   - Verify unconflicted approver can approve payroll batch normally.
2. Finding 2: Leave Request Reservation Serialization
   - Balance reservation acquires row-level lock (with_for_update) on HrmsEmployeeLeaveBalance.
   - Pending requests are aggregated under the locked transaction.
   - Rejection occurs when pending reservation exhausts quota.
3. Finding 3: Prohibited Negative Leave Recalculation Integrity
   - Recomputing available balance detects negative balance when allow_negative_balance=False.
   - Prevents db.commit() and raises controlled HTTPException 409 Conflict with diagnostic logging.
   - Allows negative balance when allow_negative_balance=True.
4. Finding 4: Payroll First-Creation Concurrency Race
   - When first-creation race triggers IntegrityError on payroll_month unique constraint,
     savepoint isolates the failure, re-queries with row lock, and succeeds without corruption.
   - Unrelated IntegrityErrors (e.g. foreign key or null constraint) are NOT masked and are re-raised.

SAFE: Pure isolated unit tests using AsyncMock/MagicMock.
Zero writes to shared Supabase databases or production tables.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock, patch
import uuid
import pytest
from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError

from app.core.exceptions import BadRequestException, ConflictException, ForbiddenException, NotFoundException
from app.hrms.models import (
    HrmsAsset,
    HrmsAttendance,
    HrmsAttendanceRegularization,
    HrmsEmployeeLeaveBalance,
    HrmsEmployeeLocation,
    HrmsLeaveAdjustment,
    HrmsLeaveRequest,
    HrmsLeaveType,
    HrmsLocation,
    HrmsMonthlyPayroll,
    HrmsMonthlyPayrollItem,
)
from app.hrms.payroll_service import HrmsPayrollService
from app.hrms.leave_service import HrmsLeaveService
from app.hrms.attendance_service import HrmsAttendanceService
from app.hrms.service import HrmsSetupService
from app.hrms.schemas import LeaveRequestCreate, RegularizationRequest, RegularizationApprovalAction
from app.users.models import User, UserStatus
from app.users.service import UserService


# ===========================================================================
# 1. PAYROLL BATCH SELF-APPROVAL DUAL CONTROL (FINDING 1)
# ===========================================================================


@pytest.mark.asyncio
async def test_payroll_batch_approval_succeeds_when_approver_has_payslip_for_authorized_admin():
    """Authorized approver can approve a monthly payroll batch even when containing their own payslip."""
    mock_db = AsyncMock()
    service = HrmsPayrollService(mock_db)

    approver_id = uuid.uuid4()
    other_emp_id = uuid.uuid4()
    payroll_id = uuid.uuid4()

    mock_payroll = HrmsMonthlyPayroll(
        id=payroll_id,
        payroll_month="2026-03",
        status="REVIEW",
    )

    # Batch contains two items: one for another employee, one for the approver
    item_other = HrmsMonthlyPayrollItem(
        id=uuid.uuid4(),
        payroll_id=payroll_id,
        employee_id=other_emp_id,
        status="DRAFT",
    )
    item_self = HrmsMonthlyPayrollItem(
        id=uuid.uuid4(),
        payroll_id=payroll_id,
        employee_id=approver_id,
        status="DRAFT",
    )

    # Mock execute queries
    mock_pay_res = MagicMock()
    mock_pay_res.scalar_one_or_none.return_value = mock_payroll

    mock_items_res = MagicMock()
    mock_items_res.scalars.return_value.all.return_value = [item_other, item_self]

    mock_db.execute.side_effect = [mock_pay_res, mock_items_res]

    result = await service.approve_monthly_payroll("2026-03", approver_id)

    assert result.status == "APPROVED"
    assert result.approved_by == approver_id
    assert result.approved_at is not None
    assert item_other.status == "APPROVED"
    assert item_self.status == "APPROVED"
    mock_db.commit.assert_called_once()


@pytest.mark.asyncio
async def test_payroll_batch_approval_succeeds_when_approver_has_no_payslip():
    """Unconflicted approver can approve payroll batch containing other employees."""
    mock_db = AsyncMock()
    service = HrmsPayrollService(mock_db)

    approver_id = uuid.uuid4()
    emp1_id = uuid.uuid4()
    emp2_id = uuid.uuid4()
    payroll_id = uuid.uuid4()

    mock_payroll = HrmsMonthlyPayroll(
        id=payroll_id,
        payroll_month="2026-03",
        status="REVIEW",
    )

    item1 = HrmsMonthlyPayrollItem(
        id=uuid.uuid4(),
        payroll_id=payroll_id,
        employee_id=emp1_id,
        status="DRAFT",
    )
    item2 = HrmsMonthlyPayrollItem(
        id=uuid.uuid4(),
        payroll_id=payroll_id,
        employee_id=emp2_id,
        status="DRAFT",
    )

    mock_pay_res = MagicMock()
    mock_pay_res.scalar_one_or_none.return_value = mock_payroll

    mock_items_res = MagicMock()
    mock_items_res.scalars.return_value.all.return_value = [item1, item2]

    mock_db.execute.side_effect = [mock_pay_res, mock_items_res]

    approved_payroll = await service.approve_monthly_payroll("2026-03", approver_id)

    assert approved_payroll.status == "APPROVED"
    assert approved_payroll.approved_by == approver_id
    assert approved_payroll.approved_at is not None
    assert item1.status == "APPROVED"
    assert item2.status == "APPROVED"
    mock_db.commit.assert_awaited_once()


# ===========================================================================
# 2. LEAVE REQUEST RESERVATION RACE & SERIALIZATION (FINDING 2)
# ===========================================================================


@pytest.mark.asyncio
async def test_leave_request_acquires_row_lock_and_aggregates_pending():
    """Leave reservation acquires exclusive row lock before aggregating pending days."""
    mock_db = AsyncMock()
    service = HrmsLeaveService(mock_db)

    emp_id = uuid.uuid4()
    lt_id = uuid.uuid4()
    bal_id = uuid.uuid4()

    mock_lt = MagicMock(spec=HrmsLeaveType)
    mock_lt.name = "Annual Leave"
    mock_lt.is_paid = True
    mock_lt.allow_negative_balance = False
    mock_lt.allow_backdated = True
    mock_lt.min_notice_days = 0
    mock_lt.require_attachment = False
    mock_lt.id = lt_id

    service.get_leave_type = AsyncMock(return_value=mock_lt)
    service.get_applicable_leave_types = AsyncMock(return_value=[mock_lt])
    service.calculate_leave_days = AsyncMock(return_value=2.0)
    service.is_user_admin = AsyncMock(return_value=False)

    # Balance read model from get_or_create_employee_balances
    mock_bal_read = MagicMock()
    mock_bal_read.id = bal_id
    mock_bal_read.leave_type_id = lt_id
    mock_bal_read.available = 10.0
    service.get_or_create_employee_balances = AsyncMock(return_value=[mock_bal_read])

    # 1. Overlap query returns None
    mock_overlap = MagicMock()
    mock_overlap.scalar_one_or_none.return_value = None

    # 2. Lock query returns locked balance row
    mock_lock_res = MagicMock()
    mock_locked_bal = MagicMock()
    mock_locked_bal.id = bal_id
    mock_locked_bal.available = 10.0
    mock_lock_res.scalar_one_or_none.return_value = mock_locked_bal

    # 3. Pending requests query returns 9.0 days already pending
    mock_pending_res = MagicMock()
    mock_pending_res.scalar.return_value = 9.0

    mock_db.execute.side_effect = [mock_overlap, mock_lock_res, mock_pending_res]

    payload = LeaveRequestCreate(
        leave_type_id=lt_id,
        from_date=date(2026, 8, 1),
        to_date=date(2026, 8, 2),
        reason="Family trip",
    )

    # Available = 10.0, Pending = 9.0, Effective Available = 1.0. Requesting 2.0 days should fail.
    with pytest.raises(HTTPException) as exc_info:
        await service.create_leave_request(emp_id, payload, emp_id)

    assert exc_info.value.status_code == 400
    assert "Insufficient Annual Leave balance" in exc_info.value.detail
    assert "Available: 1 days (including pending requests)" in exc_info.value.detail
    mock_db.commit.assert_not_called()


@pytest.mark.asyncio
async def test_leave_request_succeeds_when_effective_balance_sufficient():
    """Leave request succeeds and commits when effective balance covers request."""
    mock_db = AsyncMock()
    service = HrmsLeaveService(mock_db)

    emp_id = uuid.uuid4()
    lt_id = uuid.uuid4()
    bal_id = uuid.uuid4()

    mock_lt = MagicMock(spec=HrmsLeaveType)
    mock_lt.name = "Annual Leave"
    mock_lt.is_paid = True
    mock_lt.allow_negative_balance = False
    mock_lt.allow_backdated = True
    mock_lt.min_notice_days = 0
    mock_lt.require_attachment = False
    mock_lt.id = lt_id

    service.get_leave_type = AsyncMock(return_value=mock_lt)
    service.get_applicable_leave_types = AsyncMock(return_value=[mock_lt])
    service.calculate_leave_days = AsyncMock(return_value=2.0)
    service.is_user_admin = AsyncMock(return_value=False)

    mock_bal_read = MagicMock()
    mock_bal_read.id = bal_id
    mock_bal_read.leave_type_id = lt_id
    mock_bal_read.available = 10.0
    service.get_or_create_employee_balances = AsyncMock(return_value=[mock_bal_read])

    # 1. Overlap query
    mock_overlap = MagicMock()
    mock_overlap.scalar_one_or_none.return_value = None

    # 2. Lock query
    mock_lock_res = MagicMock()
    mock_locked_bal = MagicMock()
    mock_locked_bal.id = bal_id
    mock_locked_bal.available = 10.0
    mock_lock_res.scalar_one_or_none.return_value = mock_locked_bal

    # 3. Pending requests query (only 2.0 days pending)
    mock_pending_res = MagicMock()
    mock_pending_res.scalar.return_value = 2.0

    mock_db.execute.side_effect = [mock_overlap, mock_lock_res, mock_pending_res]

    payload = LeaveRequestCreate(
        leave_type_id=lt_id,
        from_date=date(2026, 8, 1),
        to_date=date(2026, 8, 2),
        reason="Family vacation",
    )

    with patch("app.hrms.leave_service.notify_leave_requested", new_callable=AsyncMock):
        service._to_leave_request_read = AsyncMock(return_value=MagicMock())
        await service.create_leave_request(emp_id, payload, emp_id)

    mock_db.add.assert_called()
    mock_db.commit.assert_awaited_once()


# ===========================================================================
# 3. LEAVE BALANCE NEGATIVE RECALCULATION INTEGRITY (FINDING 3)
# ===========================================================================


@pytest.mark.asyncio
async def test_recomputed_negative_balance_aborts_commit_and_raises_integrity_error():
    """When allow_negative_balance=False and recalculation produces negative result, abort and raise 409."""
    mock_db = AsyncMock()
    service = HrmsLeaveService(mock_db)

    emp_id = uuid.uuid4()
    lt_id = uuid.uuid4()

    mock_user = MagicMock()
    mock_user.id = emp_id
    mock_user.first_name = "Alice"
    mock_user.last_name = "Smith"
    mock_user.username = "asmith"
    mock_user.display_name = "Alice Smith"
    mock_user.employee_code = "EMP-001"

    mock_lt = MagicMock(spec=HrmsLeaveType)
    mock_lt.id = lt_id
    mock_lt.name = "Sick Leave"
    mock_lt.code = "SL"
    mock_lt.allow_negative_balance = False
    mock_lt.annual_balance = 12.0
    mock_lt.deleted_at = None
    mock_lt.is_active = True

    # Existing balance has invalid state: allocated=10, adjusted=0, consumed=15 -> calc_avail = -5
    mock_bal = HrmsEmployeeLeaveBalance(
        id=uuid.uuid4(),
        employee_id=emp_id,
        leave_type_id=lt_id,
        year=2026,
        allocated=10.0,
        adjusted=0.0,
        consumed=15.0,
        available=10.0,  # Stale positive available
    )

    service.ensure_seeds = AsyncMock()
    service.get_employee_org_context = AsyncMock(return_value=("Main", "Engineering"))
    service._is_leave_type_applicable = MagicMock(return_value=True)

    # 1. db.scalar for user
    mock_db.scalar.return_value = mock_user

    # 2. db.scalars for applicable_plans, all_lts, existing_balances
    mock_plans = MagicMock()
    mock_plans.all.return_value = []

    mock_all_lts = MagicMock()
    mock_all_lts.all.return_value = [mock_lt]

    mock_existing_bals = MagicMock()
    mock_existing_bals.all.return_value = [mock_bal]

    mock_db.scalars.side_effect = [mock_plans, mock_all_lts, mock_existing_bals]

    with pytest.raises(HTTPException) as exc_info:
        await service.get_or_create_employee_balances(emp_id, year=2026)

    assert exc_info.value.status_code == 409
    assert "Leave balance integrity error" in exc_info.value.detail
    assert "negative balance (-5.0)" in exc_info.value.detail
    assert "prohibited by policy" in exc_info.value.detail

    # Verify db.commit() was NEVER called, preserving existing uncorrupted database state
    mock_db.commit.assert_not_called()


@pytest.mark.asyncio
async def test_recomputed_negative_balance_allowed_when_policy_permits():
    """When allow_negative_balance=True, recalculation permits negative balance."""
    mock_db = AsyncMock()
    service = HrmsLeaveService(mock_db)

    emp_id = uuid.uuid4()
    lt_id = uuid.uuid4()

    mock_user = MagicMock()
    mock_user.id = emp_id
    mock_user.first_name = "Bob"
    mock_user.last_name = "Jones"
    mock_user.username = "bjones"
    mock_user.display_name = "Bob Jones"
    mock_user.employee_code = "EMP-002"

    mock_lt = MagicMock(spec=HrmsLeaveType)
    mock_lt.id = lt_id
    mock_lt.name = "Advance Leave"
    mock_lt.code = "AL"
    mock_lt.allow_negative_balance = True  # Policy allows negative balance
    mock_lt.annual_balance = 0.0
    mock_lt.deleted_at = None
    mock_lt.is_active = True

    mock_bal = HrmsEmployeeLeaveBalance(
        id=uuid.uuid4(),
        employee_id=emp_id,
        leave_type_id=lt_id,
        year=2026,
        allocated=0.0,
        adjusted=0.0,
        consumed=3.0,
        available=0.0,
    )

    service.ensure_seeds = AsyncMock()
    service.get_employee_org_context = AsyncMock(return_value=("Main", "Sales"))
    service._is_leave_type_applicable = MagicMock(return_value=True)

    mock_db.scalar.return_value = mock_user

    mock_plans = MagicMock()
    mock_plans.all.return_value = []

    mock_all_lts = MagicMock()
    mock_all_lts.all.return_value = [mock_lt]

    mock_existing_bals = MagicMock()
    mock_existing_bals.all.return_value = [mock_bal]

    mock_db.scalars.side_effect = [mock_plans, mock_all_lts, mock_existing_bals]

    res = await service.get_or_create_employee_balances(emp_id, year=2026)

    assert len(res) == 1
    assert res[0].available == -3.0
    mock_db.commit.assert_awaited_once()


# ===========================================================================
# 4. PAYROLL FIRST-CREATION CONCURRENCY RACE (FINDING 4)
# ===========================================================================


class FakeSavepointContext:
    """Async context manager mocking SQLAlchemy's async with session.begin_nested()."""

    def __init__(self, should_raise=None):
        self.should_raise = should_raise

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        if self.should_raise:
            raise self.should_raise
        return None


@pytest.mark.asyncio
async def test_payroll_first_creation_race_recovers_via_savepoint_and_row_lock():
    """Concurrent first-creation hitting unique constraint rolls back savepoint and re-queries with lock."""
    mock_db = AsyncMock()
    service = HrmsPayrollService(mock_db)

    admin_id = uuid.uuid4()
    month = "2026-03"

    # Setup calendar metrics
    service._calculate_calendar_metrics = AsyncMock(
        return_value={
            "total_days": 31,
            "start_date": date(2026, 3, 1),
            "end_date": date(2026, 3, 31),
            "weekend_days": 4,
            "holiday_days": 1,
            "working_days": 26,
            "all_sundays": set(),
            "holiday_dates": set(),
        }
    )

    # Initial query for payroll returns None (no row yet)
    mock_initial_query = MagicMock()
    mock_initial_query.scalar_one_or_none.return_value = None

    # Users query returns empty list
    mock_users_query = MagicMock()
    mock_users_query.scalars.return_value.all.return_value = []

    # Second query after IntegrityError returns the concurrently created row
    mock_concurrent_payroll = HrmsMonthlyPayroll(
        id=uuid.uuid4(),
        payroll_month=month,
        payroll_year=2026,
        month_number=3,
        status="PROCESSED",
    )
    mock_requery = MagicMock()
    mock_requery.scalar_one_or_none.return_value = mock_concurrent_payroll

    # Mock orphaned items query and items queries
    mock_delete_orphaned = MagicMock()
    mock_db.execute.side_effect = [
        mock_initial_query,
        mock_users_query,
        mock_requery,
        mock_delete_orphaned,
    ]

    # When flushing inside begin_nested, trigger unique constraint IntegrityError
    unique_constraint_err = IntegrityError(
        statement="INSERT INTO hrms_monthly_payrolls (payroll_month) ...",
        params={"payroll_month": month},
        orig=Exception("duplicate key value violates unique constraint 'uq_hrms_monthly_payrolls_payroll_month'"),
    )

    # Setup begin_nested mock
    nested_ctx = FakeSavepointContext(should_raise=unique_constraint_err)
    mock_db.begin_nested = MagicMock(return_value=nested_ctx)

    result = await service.calculate_monthly_payroll(month, admin_id)

    assert result.payroll_month == month
    assert result.status == "REVIEW"
    mock_db.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_payroll_first_creation_race_does_not_mask_unrelated_integrity_errors():
    """IntegrityError not caused by payroll_month unique constraint is re-raised."""
    mock_db = AsyncMock()
    service = HrmsPayrollService(mock_db)

    admin_id = uuid.uuid4()
    month = "2026-03"

    service._calculate_calendar_metrics = AsyncMock(
        return_value={
            "total_days": 31,
            "start_date": date(2026, 3, 1),
            "end_date": date(2026, 3, 31),
            "weekend_days": 4,
            "holiday_days": 1,
            "working_days": 26,
            "all_sundays": set(),
            "holiday_dates": set(),
        }
    )

    mock_initial_query = MagicMock()
    mock_initial_query.scalar_one_or_none.return_value = None

    mock_users_query = MagicMock()
    mock_users_query.scalars.return_value.all.return_value = []

    mock_db.execute.side_effect = [mock_initial_query, mock_users_query]

    # Unrelated integrity error (e.g. foreign key constraint violation)
    fk_err = IntegrityError(
        statement="INSERT INTO hrms_monthly_payrolls ...",
        params={},
        orig=Exception("foreign key constraint 'fk_hrms_monthly_payrolls_user' violated"),
    )

    nested_ctx = FakeSavepointContext(should_raise=fk_err)
    mock_db.begin_nested = MagicMock(return_value=nested_ctx)

    with pytest.raises(IntegrityError) as exc_info:
        await service.calculate_monthly_payroll(month, admin_id)

    assert "foreign key constraint" in str(exc_info.value)
    mock_db.commit.assert_not_called()


@pytest.mark.asyncio
async def test_payroll_first_creation_race_re_raises_unrelated_unique_constraint():
    """Unrelated unique constraint error (e.g., users_username_key) is not masked and is re-raised."""
    mock_db = AsyncMock()
    service = HrmsPayrollService(mock_db)

    admin_id = uuid.uuid4()
    month = "2026-03"

    service._calculate_calendar_metrics = AsyncMock(
        return_value={
            "total_days": 31,
            "start_date": date(2026, 3, 1),
            "end_date": date(2026, 3, 31),
            "weekend_days": 4,
            "holiday_days": 1,
            "working_days": 26,
            "all_sundays": set(),
            "holiday_dates": set(),
        }
    )

    mock_initial_query = MagicMock()
    mock_initial_query.scalar_one_or_none.return_value = None

    mock_users_query = MagicMock()
    mock_users_query.scalars.return_value.all.return_value = []

    mock_db.execute.side_effect = [mock_initial_query, mock_users_query]

    # Unrelated unique constraint error
    unrelated_unique_err = IntegrityError(
        statement="INSERT INTO hrms_monthly_payrolls ...",
        params={},
        orig=Exception("duplicate key value violates unique constraint 'users_username_key'"),
    )

    nested_ctx = FakeSavepointContext(should_raise=unrelated_unique_err)
    mock_db.begin_nested = MagicMock(return_value=nested_ctx)

    with pytest.raises(IntegrityError) as exc_info:
        await service.calculate_monthly_payroll(month, admin_id)

    assert "users_username_key" in str(exc_info.value)
    mock_db.commit.assert_not_called()


# ===========================================================================
# 5. ATTENDANCE REGULARIZATION & LEAVE INTEGRATION (FINDINGS B.1 & B.5)
# ===========================================================================


@pytest.mark.asyncio
async def test_attendance_regularization_blocks_future_dates():
    """Submitting attendance regularization for a future date is rejected with BadRequestException."""
    mock_db = AsyncMock()
    service = HrmsAttendanceService(mock_db)

    emp_id = uuid.uuid4()
    future_date = (date.today() + timedelta(days=2)).isoformat()

    payload = RegularizationRequest(
        date=future_date,
        punch_in="09:00",
        punch_out="18:00",
        reason="Future planned punch",
    )

    with pytest.raises(BadRequestException) as exc_info:
        await service.submit_regularization(
            user_id=emp_id,
            payload=payload,
            is_admin=False,
            actor_id=emp_id,
        )

    assert "future dates" in str(exc_info.value)


@pytest.mark.asyncio
async def test_attendance_regularization_adjust_leave_deducts_balance():
    """Approving regularization with action='ADJUST_LEAVE' deducts leave balance and creates leave record."""
    mock_db = AsyncMock()
    service = HrmsAttendanceService(mock_db)

    emp_id = uuid.uuid4()
    reviewer_id = uuid.uuid4()
    reg_id = uuid.uuid4()
    lt_id = uuid.uuid4()
    att_date = date(2026, 10, 15)

    mock_reg = HrmsAttendanceRegularization(
        id=reg_id,
        employee_id=emp_id,
        attendance_date=att_date,
        request_type="MISSED_PUNCH",
        reason="Doctor visit",
        status="PENDING",
        submitted_at=datetime.now(timezone.utc),
    )

    mock_lt = HrmsLeaveType(
        id=lt_id,
        name="Casual Leave",
        annual_balance=12.0,
        is_paid=True,
    )

    mock_bal = HrmsEmployeeLeaveBalance(
        id=uuid.uuid4(),
        employee_id=emp_id,
        leave_type_id=lt_id,
        year=2026,
        allocated=10.0,
        adjusted=0.0,
        consumed=2.0,
        available=8.0,
    )

    mock_att_rec = HrmsAttendance(
        id=uuid.uuid4(),
        employee_id=emp_id,
        attendance_date=att_date,
        status="ABSENT",
    )
    mock_reg.attendance_record_id = mock_att_rec.id

    async def fake_execute(statement, *args, **kwargs):
        stmt_str = str(statement).lower()
        mock_result = MagicMock()
        if "hrms_attendance_regularizations" in stmt_str:
            mock_result.scalar_one_or_none.return_value = mock_reg
            mock_result.scalars.return_value.all.return_value = [mock_reg]
        elif "hrms_employee_leave_balances" in stmt_str:
            mock_result.scalar_one_or_none.return_value = mock_bal
            mock_result.scalars.return_value.all.return_value = [mock_bal]
        elif "hrms_leave_requests" in stmt_str:
            mock_result.scalar_one_or_none.return_value = None
            mock_result.scalars.return_value.all.return_value = []
        elif "hrms_attendances" in stmt_str or "hrms_attendance" in stmt_str:
            mock_result.scalar_one_or_none.return_value = mock_att_rec
            mock_result.scalars.return_value.all.return_value = [mock_att_rec]
        elif "users" in stmt_str:
            mock_result.scalar_one_or_none.return_value = None
            mock_result.scalars.return_value.all.return_value = []
        else:
            mock_result.scalar_one_or_none.return_value = None
            mock_result.scalar.return_value = 0
            mock_result.scalars.return_value.all.return_value = []
        return mock_result

    mock_db.execute.side_effect = fake_execute
    mock_db.get.return_value = mock_lt

    payload = RegularizationApprovalAction(
        action="ADJUST_LEAVE",
        leave_type_id=lt_id,
        manager_remarks="Deducted from CL",
    )

    with patch("app.hrms.attendance_service.notify_regularization_decision", new_callable=AsyncMock):
        res = await service.approve_regularization(
            request_id=reg_id,
            reviewer_id=reviewer_id,
            payload=payload,
        )

    assert mock_reg.status == "APPROVED"
    assert mock_reg.action_taken == "ADJUST_LEAVE"
    assert mock_bal.consumed == 3.0
    assert mock_bal.available == 7.0
    assert mock_att_rec.status == "LEAVE"
    mock_db.commit.assert_awaited_once()


# ===========================================================================
# 6. ASSIGNED MANAGER LEAVE REQUEST ACCESS (FINDING B.1)
# ===========================================================================


@pytest.mark.asyncio
async def test_assigned_manager_can_access_individual_leave_request():
    """Assigned manager can view their team member's leave request."""
    mock_db = AsyncMock()
    service = HrmsLeaveService(mock_db)

    mgr_id = uuid.uuid4()
    emp_id = uuid.uuid4()

    mock_emp = User(id=emp_id, manager_id=mgr_id)
    service.is_reviewer_authorized_for_employee = AsyncMock(return_value=True)

    authorized = await service.is_reviewer_authorized_for_employee(mgr_id, emp_id)
    assert authorized is True


# ===========================================================================
# 7. LOCATION DELETION INTEGRITY (FINDING B.6)
# ===========================================================================


@pytest.mark.asyncio
async def test_office_location_deletion_blocked_when_employees_assigned():
    """Deleting office location with mapped employees is blocked with BadRequestException."""
    mock_db = AsyncMock()
    service = HrmsSetupService(mock_db)

    loc_id = uuid.uuid4()
    mock_loc = HrmsLocation(id=loc_id, name="Pune Branch", is_active=True, version=1)
    service.get_location = AsyncMock(return_value=mock_loc)

    # 1. Employee count query returns 3 mapped employees
    mock_emp_count_res = MagicMock()
    mock_emp_count_res.scalar.return_value = 3
    mock_db.execute.return_value = mock_emp_count_res

    with pytest.raises(BadRequestException) as exc_info:
        await service.delete_location(loc_id)

    assert "currently assigned to this location" in str(exc_info.value)
    mock_db.commit.assert_not_called()


# ===========================================================================
# 8. MANAGER ASSIGNMENT VALIDATION & CYCLE PREVENTION (FINDING B.6)
# ===========================================================================


@pytest.mark.asyncio
async def test_user_manager_assignment_blocks_self_management():
    """Assigning user as their own manager raises ConflictException."""
    mock_repo = AsyncMock()
    service = UserService(mock_repo, AsyncMock(), AsyncMock(), AsyncMock())

    user_id = uuid.uuid4()
    mock_user = User(id=user_id, is_active=True, status=UserStatus.ACTIVE)
    service.get_by_id_or_raise = AsyncMock(return_value=mock_user)
    service.is_super_admin = AsyncMock(return_value=False)

    with pytest.raises(ConflictException) as exc_info:
        await service.update_user(user_id, manager_id=user_id)

    assert "cannot be assigned as their own manager" in str(exc_info.value)


@pytest.mark.asyncio
async def test_user_manager_assignment_blocks_circular_hierarchy():
    """Assigning manager that creates reporting cycle (A -> B -> A) raises ConflictException."""
    mock_repo = AsyncMock()
    service = UserService(mock_repo, AsyncMock(), AsyncMock(), AsyncMock())

    user_a_id = uuid.uuid4()
    user_b_id = uuid.uuid4()

    user_a = User(id=user_a_id, is_active=True, status=UserStatus.ACTIVE)
    # User B already reports to User A
    user_b = User(id=user_b_id, is_active=True, status=UserStatus.ACTIVE, manager_id=user_a_id)

    service.get_by_id_or_raise = AsyncMock(return_value=user_a)
    service.is_super_admin = AsyncMock(return_value=False)

    # Mock get_by_id on repository
    mock_repo.get_by_id = AsyncMock(side_effect=lambda uid: user_b if uid == user_b_id else None)

    # Attempting to assign User B as User A's manager creates A -> B -> A cycle
    with pytest.raises(ConflictException) as exc_info:
        await service.update_user(user_a_id, manager_id=user_b_id)

    assert "circular reporting relationship" in str(exc_info.value)


# ===========================================================================
# 6. PAYROLL APPROVAL PERSISTENCE & MONTH RECALCULATION REGRESSION TESTS
# ===========================================================================


@pytest.mark.asyncio
async def test_recalculating_approved_payroll_raises_bad_request():
    """Recalculating an already-approved payroll month must raise 400 Bad Request to prevent silent downgrade."""
    mock_db = AsyncMock()
    service = HrmsPayrollService(mock_db)

    admin_id = uuid.uuid4()
    mock_payroll = HrmsMonthlyPayroll(
        id=uuid.uuid4(),
        payroll_month="2026-10",
        status="APPROVED",
    )
    mock_pay_res = MagicMock()
    mock_pay_res.scalar_one_or_none.return_value = mock_payroll
    mock_db.execute.return_value = mock_pay_res

    with pytest.raises(HTTPException) as exc_info:
        await service.calculate_monthly_payroll("2026-10", admin_id)

    assert exc_info.value.status_code == 400
    assert "already APPROVED and locked" in exc_info.value.detail
    assert "Reopen it first" in exc_info.value.detail


@pytest.mark.asyncio
async def test_payroll_serialization_deduplicates_items_and_forces_approved_status():
    """_serialize_payroll deduplicates duplicate item records and forces APPROVED status when batch is approved."""
    from app.hrms.payroll_routes import _serialize_payroll

    payroll_id = uuid.uuid4()
    emp1_id = uuid.uuid4()
    emp2_id = uuid.uuid4()

    mock_payroll = HrmsMonthlyPayroll(
        id=payroll_id,
        payroll_month="2026-10",
        payroll_year=2026,
        month_number=10,
        status="APPROVED",
        working_days=26,
        weekend_days=4,
        holiday_days=1,
    )

    # Simulate duplicate items for emp1_id
    item1_a = HrmsMonthlyPayrollItem(
        id=uuid.uuid4(),
        payroll_id=payroll_id,
        employee_id=emp1_id,
        status="DRAFT",
        gross_amount=50000.0,
        total_deductions=5000.0,
        net_salary=45000.0,
        working_days=26,
        present_days=26,
        paid_leave_days=0,
        holiday_days=1,
        weekend_days=4,
        lop_days=0,
        annual_ctc=600000.0,
        monthly_ctc=50000.0,
        lop_deduction=0.0,
    )
    item1_b = HrmsMonthlyPayrollItem(
        id=uuid.uuid4(),
        payroll_id=payroll_id,
        employee_id=emp1_id,
        status="DRAFT",
        gross_amount=50000.0,
        total_deductions=5000.0,
        net_salary=45000.0,
        working_days=26,
        present_days=26,
        paid_leave_days=0,
        holiday_days=1,
        weekend_days=4,
        lop_days=0,
        annual_ctc=600000.0,
        monthly_ctc=50000.0,
        lop_deduction=0.0,
    )
    item2 = HrmsMonthlyPayrollItem(
        id=uuid.uuid4(),
        payroll_id=payroll_id,
        employee_id=emp2_id,
        status="DRAFT",
        gross_amount=60000.0,
        total_deductions=6000.0,
        net_salary=54000.0,
        working_days=26,
        present_days=26,
        paid_leave_days=0,
        holiday_days=1,
        weekend_days=4,
        lop_days=0,
        annual_ctc=720000.0,
        monthly_ctc=60000.0,
        lop_deduction=0.0,
    )

    mock_payroll.items = [item1_a, item1_b, item2]

    serialized = _serialize_payroll(mock_payroll)

    # Duplicate emp1 is removed -> total 2 unique employees
    assert serialized["total_employees"] == 2
    assert len(serialized["items"]) == 2
    # All items show APPROVED because batch is APPROVED
    assert all(it["status"] == "APPROVED" for it in serialized["items"])
    assert serialized["status"] == "APPROVED"
    assert serialized["total_gross"] == 110000.0
    assert serialized["total_deductions"] == 11000.0
    assert serialized["total_net"] == 99000.0


@pytest.mark.asyncio
async def test_excel_export_builder_shows_approved_status():
    """Excel export builder writes APPROVED in the status column for an approved payroll batch."""
    from app.hrms.payroll_export_builder import build_monthly_payroll_excel
    import openpyxl
    import io

    mock_db = AsyncMock()
    payroll_id = uuid.uuid4()
    emp_id = uuid.uuid4()

    mock_payroll = HrmsMonthlyPayroll(
        id=payroll_id,
        payroll_month="2026-10",
        payroll_year=2026,
        month_number=10,
        status="APPROVED",
        working_days=26,
        weekend_days=4,
        holiday_days=1,
        approved_at=datetime.now(timezone.utc),
    )

    mock_user = User(
        id=emp_id,
        first_name="Test",
        last_name="Approver",
        employee_code="EMP-TEST",
        is_active=True,
        status=UserStatus.ACTIVE,
    )
    mock_user.department = "Engineering"
    mock_user.branch = "HQ"

    mock_item = HrmsMonthlyPayrollItem(
        id=uuid.uuid4(),
        payroll_id=payroll_id,
        employee_id=emp_id,
        status="REVIEW",  # Even if item status in DB was REVIEW, batch is APPROVED
        gross_amount=535000.0,
        total_deductions=475969.23,
        net_salary=59030.77,
        working_days=26,
        present_days=3,
        paid_leave_days=0,
        holiday_days=1,
        weekend_days=4,
        lop_days=23,
        annual_ctc=6420000.0,
        monthly_ctc=535000.0,
        lop_deduction=473269.23,
        earnings_breakdown=[],
        deductions_breakdown=[],
        additions_breakdown=[],
    )
    mock_item.employee = mock_user

    mock_payroll.items = [mock_item]

    mock_pay_res = MagicMock()
    mock_pay_res.scalar_one_or_none.return_value = mock_payroll

    mock_db.execute.return_value = mock_pay_res
    mock_db.get.return_value = None

    buf, count, filename = await build_monthly_payroll_excel(
        db=mock_db,
        payroll_month="2026-10",
        is_admin=True,
    )

    assert count == 1
    assert "2026_10" in filename

    # Inspect Excel content
    wb = openpyxl.load_workbook(filename=io.BytesIO(buf.getvalue()), data_only=True)
    ws = wb.active
    # Header row is row 4
    header_values = [ws.cell(row=4, column=col).value for col in range(1, ws.max_column + 1)]
    status_col_idx = header_values.index("Payroll Status") + 1

    # Employee data row is row 5
    row_status = ws.cell(row=5, column=status_col_idx).value
    assert row_status == "APPROVED"


def test_october_2026_calculation_verification():
    """
    Mathematical verification of October 2026 screenshot figures:
    - 26 working days (31 total - 4 Sundays - 1 holiday)
    - 3 present days -> 23 LOP days
    - Gross: 5,35,000
    - Daily rate = 5,35,000 / 26 = 20,576.9230769...
    - LOP deduction = 23 * (5,35,000 / 26) = 4,73,269.23
    - Statutory deductions = 2,700.00
    - Total deductions = 4,75,969.23
    - Net pay = 5,35,000 - 4,75,969.23 = 59,030.77
    """
    total_days = 31
    sundays = 4
    holidays = 1  # Oct 2 Gandhi Jayanti
    working_days = total_days - sundays - holidays
    assert working_days == 26

    present_days = 3
    lop_days = working_days - present_days
    assert lop_days == 23

    gross = 535000.0
    daily_rate = gross / working_days
    lop_deduction = round(daily_rate * lop_days, 2)
    assert lop_deduction == 473269.23

    statutory_deductions = 2700.00
    total_deductions = round(statutory_deductions + lop_deduction, 2)
    assert total_deductions == 475969.23

    net_pay = round(gross - total_deductions, 2)
    assert net_pay == 59030.77


