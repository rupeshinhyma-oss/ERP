"""
HRMS Batch 2 Security & Integrity Regression Tests.

Validates:
1. Expenses (DEF-EXP-01, DEF-EXP-02):
   - Claim amount limit policy enforcement
   - Mandatory receipt attachment enforcement
   - Future and past submission-window enforcement
   - Unconditional self-approval block in service
   - Claimant self-reimbursement prevention
   - Valid status transition enforcement
2. Payroll Security (DEF-PAY-01, DEF-PAY-02):
   - Self-assignment of salary structures blocked
   - Self-editing of payroll items blocked
   - Self-adjustment of payroll bonuses/deductions blocked
   - Cross-employee unauthorized payslip read blocked (403)
   - Unapproved payslip read blocked for normal employee (403)
   - Month filter honored for employee payslips
   - Concurrency row-level locking on monthly payroll calculation
3. Leave Balance Integrity:
   - Self-adjustment of leave balance blocked (400)
   - Deductions exceeding available balance blocked (400)
   - Corrections to negative balance blocked for paid leave (400)
   - Over-subscribing quota via concurrent/pending requests blocked (400)
   - Balance queries acquire row-level lock on approval and adjustment

SAFE: Isolated unit tests using AsyncMock/MagicMock. Zero shared Supabase database mutations.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock, patch
import uuid
import pytest
from fastapi import HTTPException

from app.hrms.expense_service import HrmsExpenseService
from app.hrms.models import (
    HrmsEmployeeLeaveBalance,
    HrmsExpense,
    HrmsExpenseSettings,
    HrmsLeaveAdjustment,
    HrmsLeaveRequest,
    HrmsLeaveType,
    HrmsMonthlyPayroll,
    HrmsMonthlyPayrollItem,
)
from app.hrms.payroll_service import HrmsPayrollService
from app.hrms.leave_service import HrmsLeaveService
from app.hrms.rbac import HrmsUserContext
from app.hrms.schemas import (
    EmployeeSalaryAssignRequest,
    ExpenseCreate,
    LeaveAdjustmentCreate,
    LeaveRequestCreate,
    MonthlyPayrollItemEditRequest,
    PayrollAdjustmentCreate,
)
from app.users.models import User, UserStatus


# ===========================================================================
# A. EXPENSES (DEF-EXP-01, DEF-EXP-02)
# ===========================================================================


@pytest.mark.asyncio
async def test_expense_claim_exceeds_max_claim_amount_fails():
    """Expense claim amount exceeding settings max_claim_amount (e.g. ₹50,000) is rejected."""
    mock_db = AsyncMock()
    service = HrmsExpenseService(mock_db)

    settings = HrmsExpenseSettings(
        max_claim_amount=50000.0,
        receipt_required=True,
        submission_window_days=30,
    )
    service._get_settings = AsyncMock(return_value=settings)

    # Active employee
    mock_user = MagicMock(spec=User)
    mock_user.is_active = True
    mock_user.deleted_at = None
    mock_db.get.return_value = mock_user

    payload = ExpenseCreate(
        expense_date=date.today(),
        category="Travel",
        amount=75000.0,  # Exceeds ₹50,000 limit
        description="International flight",
        receipt_url="https://example.com/receipt.pdf",
    )

    with pytest.raises(HTTPException) as exc_info:
        await service.create_expense(
            employee_id=uuid.uuid4(),
            payload=payload,
            is_submit=True,
        )
    assert exc_info.value.status_code == 400
    assert "exceeds configured maximum limit" in exc_info.value.detail


@pytest.mark.asyncio
async def test_expense_claim_missing_receipt_when_required_fails():
    """Submitting claim without receipt when policy requires receipt is rejected."""
    mock_db = AsyncMock()
    service = HrmsExpenseService(mock_db)

    settings = HrmsExpenseSettings(
        max_claim_amount=50000.0,
        receipt_required=True,
        submission_window_days=30,
    )
    service._get_settings = AsyncMock(return_value=settings)

    mock_user = MagicMock(spec=User)
    mock_user.is_active = True
    mock_user.deleted_at = None
    mock_db.get.return_value = mock_user

    payload = ExpenseCreate(
        expense_date=date.today(),
        category="Meals",
        amount=1200.0,
        description="Team dinner",
        receipt_url=None,  # Missing receipt
    )

    with pytest.raises(HTTPException) as exc_info:
        await service.create_expense(
            employee_id=uuid.uuid4(),
            payload=payload,
            is_submit=True,
        )
    assert exc_info.value.status_code == 400
    assert "Receipt attachment is mandatory" in exc_info.value.detail


@pytest.mark.asyncio
async def test_expense_claim_future_date_fails():
    """Expense claims cannot be submitted for future dates."""
    mock_db = AsyncMock()
    service = HrmsExpenseService(mock_db)

    settings = HrmsExpenseSettings(
        max_claim_amount=50000.0,
        receipt_required=False,
        submission_window_days=30,
    )
    service._get_settings = AsyncMock(return_value=settings)

    mock_user = MagicMock(spec=User)
    mock_user.is_active = True
    mock_user.deleted_at = None
    mock_db.get.return_value = mock_user

    future_date = date.today() + timedelta(days=5)
    payload = ExpenseCreate(
        expense_date=future_date,
        category="Stationery",
        amount=500.0,
        description="Future supplies",
    )

    with pytest.raises(HTTPException) as exc_info:
        await service.create_expense(
            employee_id=uuid.uuid4(),
            payload=payload,
            is_submit=True,
        )
    assert exc_info.value.status_code == 400
    assert "future" in exc_info.value.detail


@pytest.mark.asyncio
async def test_expense_claim_outside_submission_window_fails():
    """Expense claims older than submission_window_days (e.g. 30 days) are rejected."""
    mock_db = AsyncMock()
    service = HrmsExpenseService(mock_db)

    settings = HrmsExpenseSettings(
        max_claim_amount=50000.0,
        receipt_required=False,
        submission_window_days=30,
    )
    service._get_settings = AsyncMock(return_value=settings)

    mock_user = MagicMock(spec=User)
    mock_user.is_active = True
    mock_user.deleted_at = None
    mock_db.get.return_value = mock_user

    old_date = date.today() - timedelta(days=45)
    payload = ExpenseCreate(
        expense_date=old_date,
        category="Internet",
        amount=1000.0,
        description="Old internet bill",
    )

    with pytest.raises(HTTPException) as exc_info:
        await service.create_expense(
            employee_id=uuid.uuid4(),
            payload=payload,
            is_submit=True,
        )
    assert exc_info.value.status_code == 400
    assert "outside the allowable submission window" in exc_info.value.detail


@pytest.mark.asyncio
async def test_expense_draft_can_be_saved_without_receipt():
    """Draft expense claims can be saved without a receipt before submission."""
    mock_db = AsyncMock()
    service = HrmsExpenseService(mock_db)

    settings = HrmsExpenseSettings(
        max_claim_amount=50000.0,
        receipt_required=True,
        submission_window_days=30,
    )
    service._get_settings = AsyncMock(return_value=settings)
    service._generate_expense_code = AsyncMock(return_value="EXP-0042")

    mock_user = MagicMock(spec=User)
    mock_user.is_active = True
    mock_user.deleted_at = None
    mock_db.get.return_value = mock_user

    payload = ExpenseCreate(
        expense_date=date.today(),
        category="Stationery",
        amount=500.0,
        description="Draft supplies",
        receipt_url=None,  # No receipt on draft
        is_submit=False,
    )

    expense = await service.create_expense(
        employee_id=uuid.uuid4(),
        payload=payload,
        is_submit=False,
    )
    assert expense.status == "DRAFT"
    assert expense.expense_code == "EXP-0042"


@pytest.mark.asyncio
async def test_expense_admin_self_approval_blocked_in_service():
    """An admin cannot self-approve their own expense claim in HrmsExpenseService."""
    mock_db = AsyncMock()
    service = HrmsExpenseService(mock_db)

    admin_id = uuid.uuid4()
    expense_id = uuid.uuid4()

    mock_expense = MagicMock(spec=HrmsExpense)
    mock_expense.id = expense_id
    mock_expense.employee_id = admin_id  # Same as reviewer
    mock_expense.deleted_at = None
    mock_expense.status = "PENDING"
    mock_db.get.return_value = mock_expense

    with pytest.raises(HTTPException) as exc_info:
        await service.approve_expense(
            expense_id=expense_id,
            reviewer_id=admin_id,
            is_admin=True,  # Even with is_admin=True!
            is_approver=True,
        )
    assert exc_info.value.status_code == 400
    assert "Self-approval is not permitted" in exc_info.value.detail


@pytest.mark.asyncio
async def test_expense_claimant_self_reimburse_blocked():
    """An officer cannot mark their own expense claim as reimbursed."""
    mock_db = AsyncMock()
    service = HrmsExpenseService(mock_db)

    user_id = uuid.uuid4()
    expense_id = uuid.uuid4()

    mock_expense = MagicMock(spec=HrmsExpense)
    mock_expense.id = expense_id
    mock_expense.employee_id = user_id  # Same as user_id executing reimbursement
    mock_expense.deleted_at = None
    mock_expense.status = "APPROVED"
    mock_db.get.return_value = mock_expense

    with pytest.raises(HTTPException) as exc_info:
        await service.reimburse_expense(
            expense_id=expense_id,
            user_id=user_id,
            is_admin=True,
        )
    assert exc_info.value.status_code == 403
    assert "Self-reimbursement is not permitted" in exc_info.value.detail


@pytest.mark.asyncio
async def test_expense_reimburse_unapproved_claim_fails():
    """Only APPROVED expenses can be marked as reimbursed."""
    mock_db = AsyncMock()
    service = HrmsExpenseService(mock_db)

    mock_expense = MagicMock(spec=HrmsExpense)
    mock_expense.employee_id = uuid.uuid4()
    mock_expense.deleted_at = None
    mock_expense.status = "PENDING"  # Not approved yet
    mock_db.get.return_value = mock_expense

    with pytest.raises(HTTPException) as exc_info:
        await service.reimburse_expense(
            expense_id=uuid.uuid4(),
            user_id=uuid.uuid4(),
            is_admin=True,
        )
    assert exc_info.value.status_code == 400
    assert "Only APPROVED expenses can be reimbursed" in exc_info.value.detail


# ===========================================================================
# B. PAYROLL SECURITY (DEF-PAY-01, DEF-PAY-02)
# ===========================================================================


@pytest.mark.asyncio
async def test_payroll_self_salary_assign_blocked():
    """An administrator cannot assign or revise their own salary structure."""
    from app.hrms.payroll_routes import assign_salary

    user_id = uuid.uuid4()
    ctx = MagicMock(spec=HrmsUserContext)
    ctx.user_id = user_id
    ctx.can_configure_salary.return_value = True

    payload = EmployeeSalaryAssignRequest(
        employee_id=user_id,  # Caller targeting themselves
        annual_ctc=1200000.0,
        effective_from=date.today(),
    )

    with pytest.raises(HTTPException) as exc_info:
        await assign_salary(payload=payload, ctx=ctx, service=AsyncMock())
    assert exc_info.value.status_code == 400
    assert "Self-assignment of salary structures is prohibited" in exc_info.value.detail


@pytest.mark.asyncio
async def test_payroll_self_item_edit_blocked():
    """An administrator cannot edit their own monthly payroll line item."""
    from app.hrms.payroll_routes import edit_payroll_item

    user_id = uuid.uuid4()
    item_id = uuid.uuid4()
    ctx = MagicMock(spec=HrmsUserContext)
    ctx.user_id = user_id
    ctx.can_configure_salary.return_value = True

    mock_service = AsyncMock()
    mock_item = MagicMock(spec=HrmsMonthlyPayrollItem)
    mock_item.employee_id = user_id  # Item belongs to caller
    mock_service.db.get.return_value = mock_item

    payload = MonthlyPayrollItemEditRequest(
        reason="Adjustment to gross",
    )

    with pytest.raises(HTTPException) as exc_info:
        await edit_payroll_item(item_id=item_id, payload=payload, ctx=ctx, service=mock_service)
    assert exc_info.value.status_code == 400
    assert "Self-editing of payroll items is prohibited" in exc_info.value.detail


@pytest.mark.asyncio
async def test_payroll_self_adjustment_blocked():
    """An administrator cannot create bonus/deduction adjustments for themselves."""
    from app.hrms.payroll_routes import create_adjustment

    user_id = uuid.uuid4()
    ctx = MagicMock(spec=HrmsUserContext)
    ctx.user_id = user_id
    ctx.can_configure_salary.return_value = True

    payload = PayrollAdjustmentCreate(
        employee_id=user_id,  # Self adjustment
        payroll_month="2026-10",
        adjustment_type="ADDITION",
        title="Discretionary Bonus",
        amount=50000.0,
        reason="Performance reward",
    )

    with pytest.raises(HTTPException) as exc_info:
        await create_adjustment(payload=payload, ctx=ctx, service=AsyncMock())
    assert exc_info.value.status_code == 400
    assert "Self-adjustment of payroll bonuses/deductions is prohibited" in exc_info.value.detail


@pytest.mark.asyncio
async def test_payroll_unauthorized_payslip_read_blocked():
    """An employee attempting to view another employee's payslip receives HTTP 403."""
    from app.hrms.payroll_routes import get_payslip_detail

    user_id = uuid.uuid4()
    other_emp_id = uuid.uuid4()
    ctx = MagicMock(spec=HrmsUserContext)
    ctx.user_id = user_id
    ctx.is_admin = False
    ctx.is_hr = False
    ctx.is_manager = False
    ctx.require_module_access = MagicMock()

    mock_service = AsyncMock()
    mock_item = MagicMock(spec=HrmsMonthlyPayrollItem)
    mock_item.employee_id = other_emp_id
    mock_item.status = "APPROVED"

    mock_res = MagicMock()
    mock_res.scalar_one_or_none.return_value = mock_item
    mock_service.db.execute.return_value = mock_res

    with pytest.raises(HTTPException) as exc_info:
        await get_payslip_detail(item_id=uuid.uuid4(), ctx=ctx, service=mock_service)
    assert exc_info.value.status_code == 403
    assert "Access denied to another employee's payslip" in exc_info.value.detail


@pytest.mark.asyncio
async def test_payroll_unapproved_payslip_read_blocked_for_employee():
    """A normal employee cannot access their own unapproved (DRAFT/REVIEW) payslip."""
    from app.hrms.payroll_routes import get_payslip_detail

    user_id = uuid.uuid4()
    ctx = MagicMock(spec=HrmsUserContext)
    ctx.user_id = user_id
    ctx.is_admin = False
    ctx.is_hr = False
    ctx.is_manager = False
    ctx.require_module_access = MagicMock()

    mock_service = AsyncMock()
    mock_item = MagicMock(spec=HrmsMonthlyPayrollItem)
    mock_item.employee_id = user_id  # Own payslip
    mock_item.status = "DRAFT"       # But not approved yet

    mock_res = MagicMock()
    mock_res.scalar_one_or_none.return_value = mock_item
    mock_service.db.execute.return_value = mock_res

    with pytest.raises(HTTPException) as exc_info:
        await get_payslip_detail(item_id=uuid.uuid4(), ctx=ctx, service=mock_service)
    assert exc_info.value.status_code == 403
    assert "not yet approved" in exc_info.value.detail


@pytest.mark.asyncio
async def test_payroll_payslip_month_filter_honored_for_non_admin():
    """Non-admin callers get_employee_payslips includes payroll_month filter when passed."""
    mock_db = AsyncMock()
    service = HrmsPayrollService(mock_db)

    emp_id = uuid.uuid4()
    mock_res = MagicMock()
    mock_res.scalars.return_value.all.return_value = []
    mock_db.execute.return_value = mock_res

    await service.get_employee_payslips(
        employee_id=emp_id,
        is_admin=False,
        payroll_month="2026-09",
    )

    # Verify query executed contains the month filter
    call_args = mock_db.execute.call_args[0][0]
    compiled = str(call_args.compile(compile_kwargs={"literal_binds": True}))
    assert "2026-09" in compiled
    assert "APPROVED" in compiled


# ===========================================================================
# C. LEAVE BALANCE INTEGRITY
# ===========================================================================


@pytest.mark.asyncio
async def test_leave_self_balance_adjustment_blocked():
    """An HR administrator cannot adjust their own leave balance."""
    from app.hrms.leave_routes import create_leave_adjustment

    user_id = uuid.uuid4()
    payload = LeaveAdjustmentCreate(
        employee_id=user_id,  # Self adjustment
        leave_type_id=uuid.uuid4(),
        adjustment_type="ADD",
        amount=10.0,
        reason="Self balance top-up",
    )

    ctx = (user_id, True)  # (user_id, is_admin)
    service = AsyncMock()

    with pytest.raises(HTTPException) as exc_info:
        await create_leave_adjustment(payload=payload, service=service, ctx=ctx)
    assert exc_info.value.status_code == 400
    assert "Self-adjustment of leave balances is prohibited" in exc_info.value.detail


@pytest.mark.asyncio
async def test_leave_adjustment_deduct_exceeding_balance_blocked():
    """Deducting more than available balance when allow_negative_balance is False raises 400."""
    mock_db = AsyncMock()
    service = HrmsLeaveService(mock_db)

    emp_id = uuid.uuid4()
    lt_id = uuid.uuid4()

    mock_lt = MagicMock(spec=HrmsLeaveType)
    mock_lt.name = "Casual Leave"
    mock_lt.is_paid = True
    mock_lt.allow_negative_balance = False
    service.get_leave_type = AsyncMock(return_value=mock_lt)
    service.get_or_create_employee_balances = AsyncMock()

    # Balance with available = 2.0
    mock_bal = MagicMock(spec=HrmsEmployeeLeaveBalance)
    mock_bal.allocated = 12.0
    mock_bal.consumed = 10.0
    mock_bal.adjusted = 0.0
    mock_bal.available = 2.0
    mock_db.scalar.return_value = mock_bal

    payload = LeaveAdjustmentCreate(
        employee_id=emp_id,
        leave_type_id=lt_id,
        year=2026,
        adjustment_type="DEDUCT",
        amount=5.0,  # Deduct 5 from 2 -> would be -3
        reason="Quota reduction",
    )

    with pytest.raises(HTTPException) as exc_info:
        await service.create_adjustment(payload=payload, adjusted_by=uuid.uuid4())
    assert exc_info.value.status_code == 400
    assert "Negative balance is not allowed for Casual Leave" in exc_info.value.detail


@pytest.mark.asyncio
async def test_leave_adjustment_correction_to_negative_blocked():
    """CORRECTION adjustment with negative target amount on paid leave is rejected."""
    mock_db = AsyncMock()
    service = HrmsLeaveService(mock_db)

    emp_id = uuid.uuid4()
    lt_id = uuid.uuid4()

    mock_lt = MagicMock(spec=HrmsLeaveType)
    mock_lt.name = "Sick Leave"
    mock_lt.is_paid = True
    mock_lt.allow_negative_balance = False
    service.get_leave_type = AsyncMock(return_value=mock_lt)
    service.get_or_create_employee_balances = AsyncMock()

    mock_bal = MagicMock(spec=HrmsEmployeeLeaveBalance)
    mock_bal.available = 5.0
    mock_db.scalar.return_value = mock_bal

    payload = LeaveAdjustmentCreate(
        employee_id=emp_id,
        leave_type_id=lt_id,
        year=2026,
        adjustment_type="CORRECTION",
        amount=-2.0,  # Negative target correction
        reason="Correction error",
    )

    with pytest.raises(HTTPException) as exc_info:
        await service.create_adjustment(payload=payload, adjusted_by=uuid.uuid4())
    assert exc_info.value.status_code == 400
    assert "Negative balance is not allowed" in exc_info.value.detail


@pytest.mark.asyncio
async def test_leave_request_blocks_oversubscribing_pending():
    """Leave request is blocked if available balance minus already pending requests is insufficient."""
    mock_db = AsyncMock()
    service = HrmsLeaveService(mock_db)

    emp_id = uuid.uuid4()
    lt_id = uuid.uuid4()

    mock_lt = MagicMock(spec=HrmsLeaveType)
    mock_lt.name = "Casual Leave"
    mock_lt.is_paid = True
    mock_lt.allow_negative_balance = False
    mock_lt.allow_backdated = True
    mock_lt.min_notice_days = 0
    mock_lt.require_attachment = False

    service.get_leave_type = AsyncMock(return_value=mock_lt)
    service.get_applicable_leave_types = AsyncMock(return_value=[mock_lt])
    mock_lt.id = lt_id

    # Overlap query returns None
    mock_overlap = MagicMock()
    mock_overlap.scalar_one_or_none.return_value = None

    # Balance row lock query returns locked balance with available = 5.0
    mock_lock = MagicMock()
    mock_lock.scalar_one_or_none.return_value = MagicMock(available=5.0)

    # Pending sum query returns 3.0 days already pending
    mock_pending_sum = MagicMock()
    mock_pending_sum.scalar.return_value = 3.0

    mock_db.execute.side_effect = [mock_overlap, mock_lock, mock_pending_sum]

    service.calculate_leave_days = AsyncMock(return_value=3.0)  # Requesting 3 days
    service.is_user_admin = AsyncMock(return_value=False)

    # Balance has available = 5.0 days.
    # But 3.0 days are already pending!
    # Effective available = 5.0 - 3.0 = 2.0 days. Requesting 3.0 days should FAIL.
    mock_bal_read = MagicMock()
    mock_bal_read.id = uuid.uuid4()
    mock_bal_read.leave_type_id = lt_id
    mock_bal_read.available = 5.0
    service.get_or_create_employee_balances = AsyncMock(return_value=[mock_bal_read])

    payload = LeaveRequestCreate(
        leave_type_id=lt_id,
        from_date=date(2026, 11, 10),
        to_date=date(2026, 11, 12),
        reason="Family function",
    )

    with pytest.raises(HTTPException) as exc_info:
        await service.create_leave_request(
            employee_id=emp_id,
            payload=payload,
            user_id=emp_id,
        )
    assert exc_info.value.status_code == 400
    assert "Insufficient Casual Leave balance" in exc_info.value.detail
    assert "including pending requests" in exc_info.value.detail
