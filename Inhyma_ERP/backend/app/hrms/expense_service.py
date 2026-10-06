"""
HRMS Expense Management Service.

Handles:
- Sequential unique code generation (EXP-0001, EXP-0002...)
- Expense claim creation (Draft or direct Submission)
- Employee data isolation & self-service scoping
- Approval workflow (Pending -> Approved / Rejected) with self-approval guards
- Rejection reason enforcement
- Reimbursement processing (Approved -> Reimbursed)
- Real-time PostgreSQL summary calculations
"""

from __future__ import annotations

from datetime import date, datetime, timezone
import uuid
from typing import List, Optional

from fastapi import HTTPException, status
from sqlalchemy import func, select, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.hrms.models import HrmsExpense
from app.hrms.schemas import (
    ExpenseCreate,
    ExpenseRead,
    ExpenseSummaryRead,
    ExpenseUpdate,
)
from app.users.models import User


class HrmsExpenseService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def _generate_expense_code(self) -> str:
        """Generate unique sequential expense code e.g. EXP-0005."""
        res = await self.db.execute(
            select(HrmsExpense.expense_code)
            .order_by(HrmsExpense.created_at.desc(), HrmsExpense.id.desc())
            .limit(50)
        )
        codes = res.scalars().all()
        max_num = 0
        for code in codes:
            if code and code.startswith("EXP-"):
                parts = code.split("-")
                if len(parts) >= 2 and parts[1].isdigit():
                    try:
                        max_num = max(max_num, int(parts[1]))
                    except ValueError:
                        pass
        next_num = max_num + 1
        while True:
            candidate = f"EXP-{next_num:04d}"
            exist_res = await self.db.execute(
                select(HrmsExpense.id).where(HrmsExpense.expense_code == candidate)
            )
            if not exist_res.scalar_one_or_none():
                return candidate
            next_num += 1

    def to_read_dto(self, exp: HrmsExpense) -> ExpenseRead:
        """Convert ORM model to ExpenseRead DTO with resolved entity names."""
        emp_name = None
        emp_email = None
        emp_code = None
        if exp.employee:
            full = f"{exp.employee.first_name or ''} {exp.employee.last_name or ''}".strip()
            emp_name = full or exp.employee.username or exp.employee.email
            emp_email = exp.employee.email
            emp_code = getattr(exp.employee, "employee_code", None)

        rev_name = None
        if exp.reviewer:
            full = f"{exp.reviewer.first_name or ''} {exp.reviewer.last_name or ''}".strip()
            rev_name = full or exp.reviewer.username or exp.reviewer.email

        reimb_name = None
        if exp.reimburser:
            full = f"{exp.reimburser.first_name or ''} {exp.reimburser.last_name or ''}".strip()
            reimb_name = full or exp.reimburser.username or exp.reimburser.email

        return ExpenseRead(
            id=exp.id,
            expense_code=exp.expense_code,
            employee_id=exp.employee_id,
            employee_name=emp_name,
            employee_email=emp_email,
            employee_code=emp_code,
            expense_date=exp.expense_date,
            category=exp.category,
            amount=round(float(exp.amount), 2),
            currency=exp.currency or "INR",
            description=exp.description,
            location_id=exp.location_id,
            receipt_url=exp.receipt_url,
            receipt_filename=exp.receipt_filename,
            status=exp.status,
            submitted_at=exp.submitted_at,
            reviewed_at=exp.reviewed_at,
            reviewed_by=exp.reviewed_by,
            reviewer_name=rev_name,
            rejection_reason=exp.rejection_reason,
            reimbursed_at=exp.reimbursed_at,
            reimbursed_by=exp.reimbursed_by,
            reimburser_name=reimb_name,
            reimbursement_notes=exp.reimbursement_notes,
            created_at=exp.created_at,
            updated_at=exp.updated_at,
            version=exp.version,
        )

    async def create_expense(
        self,
        employee_id: uuid.UUID,
        payload: ExpenseCreate,
        is_submit: bool = False,
    ) -> HrmsExpense:
        """Create a new expense claim as Draft or Pending."""
        if payload.amount <= 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Expense amount must be greater than zero.",
            )

        if not payload.description or not payload.description.strip():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Description is required.",
            )

        if not payload.category or not payload.category.strip():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Category is required.",
            )

        # Verify employee exists and is active
        emp = await self.db.get(User, employee_id)
        if not emp or not emp.is_active or emp.deleted_at is not None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid employee account.",
            )

        code = await self._generate_expense_code()
        should_submit = is_submit or payload.is_submit
        initial_status = "PENDING" if should_submit else "DRAFT"
        submitted_at = datetime.now(timezone.utc) if should_submit else None

        expense = HrmsExpense(
            expense_code=code,
            employee_id=employee_id,
            expense_date=payload.expense_date,
            category=payload.category.strip(),
            amount=round(float(payload.amount), 2),
            currency="INR",
            description=payload.description.strip(),
            location_id=payload.location_id,
            receipt_url=payload.receipt_url.strip() if payload.receipt_url else None,
            receipt_filename=payload.receipt_filename.strip() if payload.receipt_filename else None,
            status=initial_status,
            submitted_at=submitted_at,
        )
        self.db.add(expense)
        await self.db.commit()
        await self.db.refresh(expense)
        return expense

    async def list_expenses(
        self,
        current_user_id: uuid.UUID,
        is_admin: bool,
        view_mode: str = "my",
        search: Optional[str] = None,
        status_filter: Optional[str] = None,
        category: Optional[str] = None,
        start_date: Optional[date] = None,
        end_date: Optional[date] = None,
        skip: int = 0,
        limit: int = 100,
        is_approver: bool = False,
        allowed_employee_ids: Optional[set[uuid.UUID]] = None,
    ) -> List[HrmsExpense]:
        """List expenses with strict RBAC scoping and multi-attribute filters."""
        stmt = select(HrmsExpense).where(HrmsExpense.deleted_at.is_(None))

        if view_mode == "approvals":
            if not is_approver:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="You do not have approval permissions.",
                )
            if not is_admin and allowed_employee_ids is not None:
                stmt = stmt.where(HrmsExpense.employee_id.in_(allowed_employee_ids))
            if status_filter and status_filter.upper() != "ALL":
                stmt = stmt.where(HrmsExpense.status == status_filter.upper())
        else:
            # Self-service view: employee sees strictly their own expenses
            stmt = stmt.where(HrmsExpense.employee_id == current_user_id)
            if status_filter and status_filter.upper() != "ALL":
                stmt = stmt.where(HrmsExpense.status == status_filter.upper())

        if category and category.upper() != "ALL":
            stmt = stmt.where(HrmsExpense.category.ilike(f"%{category.strip()}%"))

        if start_date:
            stmt = stmt.where(HrmsExpense.expense_date >= start_date)

        if end_date:
            stmt = stmt.where(HrmsExpense.expense_date <= end_date)

        if search and search.strip():
            term = f"%{search.strip()}%"
            stmt = stmt.where(
                or_(
                    HrmsExpense.expense_code.ilike(term),
                    HrmsExpense.description.ilike(term),
                    HrmsExpense.category.ilike(term),
                )
            )

        stmt = stmt.order_by(HrmsExpense.expense_date.desc(), HrmsExpense.created_at.desc())
        stmt = stmt.offset(skip).limit(limit)

        result = await self.db.execute(stmt)
        return list(result.scalars().all())

    async def get_expense(
        self,
        expense_id: uuid.UUID,
        current_user_id: uuid.UUID,
        is_admin: bool,
        allowed_employee_ids: Optional[set[uuid.UUID]] = None,
    ) -> HrmsExpense:
        """Fetch expense by ID with employee data isolation."""
        stmt = select(HrmsExpense).where(
            HrmsExpense.id == expense_id,
            HrmsExpense.deleted_at.is_(None),
        )
        res = await self.db.execute(stmt)
        expense = res.scalar_one_or_none()
        if not expense:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Expense claim not found.",
            )

        can_view = is_admin or (expense.employee_id == current_user_id) or (
            allowed_employee_ids is not None and expense.employee_id in allowed_employee_ids
        )
        if not can_view:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You do not have permission to view this expense claim.",
            )

        return expense

    async def update_expense(
        self,
        expense_id: uuid.UUID,
        current_user_id: uuid.UUID,
        is_admin: bool,
        payload: ExpenseUpdate,
    ) -> HrmsExpense:
        """Update draft expense fields."""
        expense = await self.get_expense(expense_id, current_user_id, is_admin)

        if expense.employee_id != current_user_id and not is_admin:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You do not have permission to update this expense claim.",
            )

        if expense.status != "DRAFT":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cannot edit an expense with status '{expense.status}'. Only DRAFT expenses can be edited.",
            )

        if payload.amount is not None:
            if payload.amount <= 0:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Expense amount must be greater than zero.",
                )
            expense.amount = round(float(payload.amount), 2)

        if payload.description is not None:
            if not payload.description.strip():
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Description cannot be empty.",
                )
            expense.description = payload.description.strip()

        if payload.category is not None:
            if not payload.category.strip():
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Category cannot be empty.",
                )
            expense.category = payload.category.strip()

        if payload.expense_date is not None:
            expense.expense_date = payload.expense_date

        if payload.location_id is not None:
            expense.location_id = payload.location_id

        if payload.receipt_url is not None:
            expense.receipt_url = payload.receipt_url.strip() if payload.receipt_url else None

        if payload.receipt_filename is not None:
            expense.receipt_filename = payload.receipt_filename.strip() if payload.receipt_filename else None

        await self.db.commit()
        await self.db.refresh(expense)
        return expense

    async def delete_expense(
        self,
        expense_id: uuid.UUID,
        current_user_id: uuid.UUID,
        is_admin: bool,
    ) -> bool:
        """Cancel/soft-delete a draft expense."""
        expense = await self.get_expense(expense_id, current_user_id, is_admin)

        if expense.employee_id != current_user_id and not is_admin:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You do not have permission to delete this expense claim.",
            )

        if expense.status != "DRAFT":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cannot delete an expense with status '{expense.status}'. Only DRAFT expenses can be cancelled or deleted.",
            )

        expense.deleted_at = datetime.now(timezone.utc)
        await self.db.commit()
        return True

    async def submit_expense(
        self,
        expense_id: uuid.UUID,
        current_user_id: uuid.UUID,
        is_admin: bool,
    ) -> HrmsExpense:
        """Submit a draft expense claim for approval."""
        expense = await self.get_expense(expense_id, current_user_id, is_admin)

        if expense.employee_id != current_user_id and not is_admin:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You do not have permission to submit this expense claim.",
            )

        if expense.status != "DRAFT":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cannot submit expense with status '{expense.status}'. Only DRAFT expenses can be submitted.",
            )

        expense.status = "PENDING"
        expense.submitted_at = datetime.now(timezone.utc)
        await self.db.commit()
        await self.db.refresh(expense)
        return expense

    async def approve_expense(
        self,
        expense_id: uuid.UUID,
        reviewer_id: uuid.UUID,
        is_admin: bool,
        is_approver: bool = False,
        allowed_employee_ids: Optional[set[uuid.UUID]] = None,
    ) -> HrmsExpense:
        """Approve a pending expense claim."""
        if not is_approver:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You do not have permission to approve expense claims.",
            )

        expense = await self.db.get(HrmsExpense, expense_id)
        if not expense or expense.deleted_at is not None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Expense claim not found.",
            )

        if not is_admin and allowed_employee_ids is not None and expense.employee_id not in allowed_employee_ids:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You do not have permission to approve expenses for this employee.",
            )

        if not is_admin and expense.employee_id == reviewer_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Self-approval is not permitted.",
            )

        if expense.status != "PENDING":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cannot approve expense with status '{expense.status}'. Only PENDING expenses can be approved.",
            )

        expense.status = "APPROVED"
        expense.reviewed_by = reviewer_id
        expense.reviewed_at = datetime.now(timezone.utc)
        expense.rejection_reason = None
        await self.db.commit()
        await self.db.refresh(expense)
        return expense

    async def reject_expense(
        self,
        expense_id: uuid.UUID,
        reviewer_id: uuid.UUID,
        is_admin: bool,
        rejection_reason: str,
        is_approver: bool = False,
        allowed_employee_ids: Optional[set[uuid.UUID]] = None,
    ) -> HrmsExpense:
        """Reject a pending expense claim with mandatory rejection reason."""
        if not is_approver:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You do not have permission to reject expense claims.",
            )

        if not rejection_reason or not rejection_reason.strip():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Rejection reason is required.",
            )

        expense = await self.db.get(HrmsExpense, expense_id)
        if not expense or expense.deleted_at is not None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Expense claim not found.",
            )

        if not is_admin and allowed_employee_ids is not None and expense.employee_id not in allowed_employee_ids:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You do not have permission to reject expenses for this employee.",
            )

        if expense.status != "PENDING":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cannot reject expense with status '{expense.status}'. Only PENDING expenses can be rejected.",
            )

        expense.status = "REJECTED"
        expense.reviewed_by = reviewer_id
        expense.reviewed_at = datetime.now(timezone.utc)
        expense.rejection_reason = rejection_reason.strip()
        await self.db.commit()
        await self.db.refresh(expense)
        return expense

    async def reimburse_expense(
        self,
        expense_id: uuid.UUID,
        user_id: uuid.UUID,
        is_admin: bool,
        notes: Optional[str] = None,
    ) -> HrmsExpense:
        """Mark an approved expense as reimbursed."""
        if not is_admin:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You do not have permission to mark expenses as reimbursed.",
            )

        expense = await self.db.get(HrmsExpense, expense_id)
        if not expense or expense.deleted_at is not None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Expense claim not found.",
            )

        if expense.status != "APPROVED":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cannot reimburse expense with status '{expense.status}'. Only APPROVED expenses can be reimbursed.",
            )

        expense.status = "REIMBURSED"
        expense.reimbursed_by = user_id
        expense.reimbursed_at = datetime.now(timezone.utc)
        expense.reimbursement_notes = notes.strip() if notes else None
        await self.db.commit()
        await self.db.refresh(expense)
        return expense

    async def get_summary(
        self,
        current_user_id: uuid.UUID,
        is_admin: bool,
        view_mode: str = "my",
        is_approver: bool = False,
        allowed_employee_ids: Optional[set[uuid.UUID]] = None,
    ) -> ExpenseSummaryRead:
        """Calculate real-time database summary statistics."""
        stmt = (
            select(
                HrmsExpense.status,
                func.count(HrmsExpense.id),
                func.coalesce(func.sum(HrmsExpense.amount), 0.0),
            )
            .where(HrmsExpense.deleted_at.is_(None))
            .group_by(HrmsExpense.status)
        )

        if view_mode == "approvals":
            if not is_approver:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="You do not have permission to view approvals summary.",
                )
            if not is_admin and allowed_employee_ids is not None:
                stmt = stmt.where(HrmsExpense.employee_id.in_(allowed_employee_ids))
        else:
            stmt = stmt.where(HrmsExpense.employee_id == current_user_id)

        rows = (await self.db.execute(stmt)).all()

        summary = ExpenseSummaryRead()
        for status_val, count, amount in rows:
            st = (status_val or "").upper()
            cnt = int(count or 0)
            amt = round(float(amount or 0.0), 2)

            summary.total_count += cnt
            summary.total_amount += amt

            if st == "DRAFT":
                summary.draft_count = cnt
                summary.draft_amount = amt
            elif st == "PENDING":
                summary.pending_count = cnt
                summary.pending_amount = amt
            elif st == "APPROVED":
                summary.approved_count = cnt
                summary.approved_amount = amt
            elif st == "REJECTED":
                summary.rejected_count = cnt
                summary.rejected_amount = amt
            elif st == "REIMBURSED":
                summary.reimbursed_count = cnt
                summary.reimbursed_amount = amt

        summary.total_amount = round(summary.total_amount, 2)
        return summary
