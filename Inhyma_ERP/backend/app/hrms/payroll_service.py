"""
HRMS Payroll Service.
Handles Payroll Component Setup, Employee Salary assignment & revision history,
Attendance/Leave/Holiday/LOP integrated Monthly Payroll Calculation, Approval, and Payslips.
Uses AsyncSession for complete consistency with the application architecture.
"""

from __future__ import annotations

import calendar
from decimal import Decimal, ROUND_HALF_UP
import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Any, Optional

from sqlalchemy import select, and_, or_, desc, func, delete
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from fastapi import HTTPException, status

from app.hrms.models import (
    HrmsPayrollComponent,
    HrmsEmployeeLocation,
    HrmsEmployeeSalary,
    HrmsLocation,
    HrmsMonthlyPayroll,
    HrmsMonthlyPayrollItem,
    HrmsPayrollAdjustment,
    HrmsHoliday,
    HrmsAttendance,
    HrmsLeaveRequest,
    HrmsLeaveType,
)
from app.hrms.schemas import (
    PayrollComponentCreate,
    PayrollComponentUpdate,
    SalaryPreviewResponse,
    SalaryBreakdownItem,
    EmployeeSalaryAssignRequest,
    PayrollAdjustmentCreate,
    MonthlyPayrollItemEditRequest,
)
from app.hrms.attendance_service import HrmsAttendanceService, IST
from app.rbac.models import Role, UserRole
from app.users.models import EmploymentStatus, User, UserStatus

TWO_DP = Decimal("0.01")
ZERO_DEC = Decimal("0.00")
TWELVE_DEC = Decimal("12")
HUNDRED_DEC = Decimal("100")


def _to_dec(val: Any) -> Decimal:
    if isinstance(val, Decimal):
        return val
    if val is None:
        return Decimal("0")
    return Decimal(str(val))


def _q2(val: Decimal) -> Decimal:
    return val.quantize(TWO_DP, rounding=ROUND_HALF_UP)


class HrmsPayrollService:
    def __init__(self, db: AsyncSession):
        self.db = db

    # ---------------------------------------------------------------------------
    # TAB 1: Setup - Global Payroll Components
    # ---------------------------------------------------------------------------

    async def get_components(self, include_inactive: bool = False) -> list[HrmsPayrollComponent]:
        """Retrieve all payroll components ordered by display_order."""
        query = select(HrmsPayrollComponent).where(HrmsPayrollComponent.deleted_at.is_(None))
        if not include_inactive:
            query = query.where(HrmsPayrollComponent.is_active == True)
        query = query.order_by(HrmsPayrollComponent.display_order.asc(), HrmsPayrollComponent.created_at.asc())
        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def create_component(self, comp_in: PayrollComponentCreate) -> HrmsPayrollComponent:
        """Create a new global salary component."""
        # Check code uniqueness
        query = select(HrmsPayrollComponent).where(
            func.upper(HrmsPayrollComponent.code) == comp_in.code.strip().upper(),
            HrmsPayrollComponent.deleted_at.is_(None),
        )
        existing = (await self.db.execute(query)).scalar_one_or_none()
        if existing:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Payroll component with code '{comp_in.code}' already exists.",
            )

        calc_basis = comp_in.calculation_basis.strip().upper() if comp_in.calculation_basis else None

        component = HrmsPayrollComponent(
            name=comp_in.name.strip(),
            code=comp_in.code.strip().upper(),
            component_type=comp_in.component_type.strip().upper(),
            calculation_type=comp_in.calculation_type.strip().upper(),
            calculation_basis=calc_basis,
            value=_q2(_to_dec(comp_in.value)),
            is_taxable=comp_in.is_taxable,
            is_statutory=comp_in.is_statutory,
            display_order=comp_in.display_order,
            is_active=comp_in.is_active,
            description=comp_in.description,
        )
        self.db.add(component)
        await self.db.commit()
        await self.db.refresh(component)
        return component

    async def update_component(
        self, comp_id: uuid.UUID, comp_in: PayrollComponentUpdate
    ) -> HrmsPayrollComponent:
        """Update an existing payroll component."""
        query = select(HrmsPayrollComponent).where(
            HrmsPayrollComponent.id == comp_id,
            HrmsPayrollComponent.deleted_at.is_(None),
        )
        component = (await self.db.execute(query)).scalar_one_or_none()
        if not component:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Component not found.")

        if comp_in.code is not None:
            new_code = comp_in.code.strip().upper()
            code_query = select(HrmsPayrollComponent).where(
                func.upper(HrmsPayrollComponent.code) == new_code,
                HrmsPayrollComponent.id != comp_id,
                HrmsPayrollComponent.deleted_at.is_(None),
            )
            existing = (await self.db.execute(code_query)).scalar_one_or_none()
            if existing:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Component code '{new_code}' already exists.",
                )
            component.code = new_code

        if comp_in.name is not None:
            component.name = comp_in.name.strip()
        if comp_in.component_type is not None:
            component.component_type = comp_in.component_type.strip().upper()
        if comp_in.calculation_type is not None:
            component.calculation_type = comp_in.calculation_type.strip().upper()
        if comp_in.calculation_basis is not None:
            component.calculation_basis = comp_in.calculation_basis.strip().upper() if comp_in.calculation_basis else None
        if comp_in.value is not None:
            component.value = _q2(_to_dec(comp_in.value))
        if comp_in.is_taxable is not None:
            component.is_taxable = comp_in.is_taxable
        if comp_in.is_statutory is not None:
            component.is_statutory = comp_in.is_statutory
        if comp_in.display_order is not None:
            component.display_order = comp_in.display_order
        if comp_in.is_active is not None:
            component.is_active = comp_in.is_active
        if comp_in.description is not None:
            component.description = comp_in.description

        await self.db.commit()
        await self.db.refresh(component)
        return component

    async def delete_component(self, comp_id: uuid.UUID) -> dict:
        """Soft delete a payroll component."""
        query = select(HrmsPayrollComponent).where(
            HrmsPayrollComponent.id == comp_id,
            HrmsPayrollComponent.deleted_at.is_(None),
        )
        component = (await self.db.execute(query)).scalar_one_or_none()
        if not component:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Component not found.")

        component.deleted_at = datetime.now(timezone.utc)
        component.is_active = False
        await self.db.commit()
        return {"message": "Component deleted successfully"}

    # ---------------------------------------------------------------------------
    # TAB 1 & 2: Dynamic Live Salary Preview Calculation
    # ---------------------------------------------------------------------------

    async def calculate_preview(
        self, annual_ctc: float | Any, custom_components: list[HrmsPayrollComponent] | None = None
    ) -> SalaryPreviewResponse:
        """
        Computes a live monthly salary preview based dynamically and strictly on configured
        active global Payroll Setup components.
        Does NOT inject or assume default components (Basic/HRA/Special Allowance) unless
        they are actively configured in the database.
        """
        if hasattr(annual_ctc, "annual_ctc"):
            annual_ctc_dec = _to_dec(getattr(annual_ctc, "annual_ctc"))
        else:
            annual_ctc_dec = _to_dec(annual_ctc)

        if annual_ctc_dec <= Decimal("0"):
            return SalaryPreviewResponse(
                annual_ctc=0.0,
                monthly_ctc=0.0,
                earnings=[],
                deductions=[],
                monthly_gross=0.0,
                total_deductions=0.0,
                estimated_net_salary=0.0,
                annual_gross=0.0,
                annual_net=0.0,
            )

        monthly_ctc_dec = _q2(annual_ctc_dec / TWELVE_DEC)
        components = custom_components if custom_components is not None else await self.get_components(include_inactive=False)

        earnings_list: list[SalaryBreakdownItem] = []
        deductions_list: list[SalaryBreakdownItem] = []

        earning_comps = [c for c in components if c.component_type.upper() == "EARNING" and c.is_active]
        deduction_comps = [c for c in components if c.component_type.upper() == "DEDUCTION" and c.is_active]

        comp_amounts: dict[str, Decimal] = {}

        if not earning_comps:
            # If no earning components are configured, gross salary is simply the monthly CTC
            monthly_gross_dec = monthly_ctc_dec
        else:
            # 1. First pass: fixed earnings and percentages based on CTC
            allocated = ZERO_DEC
            remaining_comp: HrmsPayrollComponent | None = None
            deferred_earnings: list[HrmsPayrollComponent] = []

            for comp in earning_comps:
                ctype = comp.calculation_type.upper()
                cbasis = (comp.calculation_basis or "").upper()
                code_up = comp.code.upper()
                val_dec = _to_dec(comp.value)

                if ctype in ("REMAINING", "REMAINING_ALLOWANCE"):
                    remaining_comp = comp
                    continue
                elif ctype == "FIXED":
                    amt_dec = _q2(val_dec)
                    comp_amounts[code_up] = amt_dec
                    allocated += amt_dec
                    earnings_list.append(
                        SalaryBreakdownItem(
                            component_id=str(comp.id) if getattr(comp, "id", None) else None,
                            code=comp.code,
                            name=comp.name,
                            type="EARNING",
                            calculation_type=comp.calculation_type,
                            calculation_basis=comp.calculation_basis,
                            rate_or_pct=comp.value,
                            monthly_amount=float(amt_dec),
                            annual_amount=float(_q2(amt_dec * TWELVE_DEC)),
                        )
                    )
                elif ctype in ("PERCENTAGE", "PERCENTAGE_OF_CTC") and (not cbasis or cbasis == "CTC"):
                    amt_dec = _q2(monthly_ctc_dec * (val_dec / HUNDRED_DEC))
                    comp_amounts[code_up] = amt_dec
                    allocated += amt_dec
                    earnings_list.append(
                        SalaryBreakdownItem(
                            component_id=str(comp.id) if getattr(comp, "id", None) else None,
                            code=comp.code,
                            name=comp.name,
                            type="EARNING",
                            calculation_type=comp.calculation_type,
                            calculation_basis=comp.calculation_basis,
                            rate_or_pct=comp.value,
                            monthly_amount=float(amt_dec),
                            annual_amount=float(_q2(amt_dec * TWELVE_DEC)),
                        )
                    )
                else:
                    deferred_earnings.append(comp)

            # 2. Second pass: percentage of another earning (e.g. HRA as % of BASIC)
            for comp in deferred_earnings:
                ctype = comp.calculation_type.upper()
                cbasis = (comp.calculation_basis or "").upper()
                code_up = comp.code.upper()
                val_dec = _to_dec(comp.value)

                if ctype == "PERCENTAGE_OF_BASIC" or cbasis == "BASIC":
                    basis_amt = comp_amounts.get("BASIC", ZERO_DEC)
                elif cbasis in comp_amounts:
                    basis_amt = comp_amounts[cbasis]
                else:
                    basis_amt = monthly_ctc_dec

                amt_dec = _q2(basis_amt * (val_dec / HUNDRED_DEC))
                comp_amounts[code_up] = amt_dec
                allocated += amt_dec
                earnings_list.append(
                    SalaryBreakdownItem(
                        component_id=str(comp.id) if getattr(comp, "id", None) else None,
                        code=comp.code,
                        name=comp.name,
                        type="EARNING",
                        calculation_type=comp.calculation_type,
                        calculation_basis=comp.calculation_basis,
                        rate_or_pct=comp.value,
                        monthly_amount=float(amt_dec),
                        annual_amount=float(_q2(amt_dec * TWELVE_DEC)),
                    )
                )

            # 3. Third pass: Remaining allowance if and ONLY IF explicitly configured
            if remaining_comp:
                rem_amt = max(ZERO_DEC, _q2(monthly_ctc_dec - allocated))
                comp_amounts[remaining_comp.code.upper()] = rem_amt
                earnings_list.append(
                    SalaryBreakdownItem(
                        component_id=str(remaining_comp.id) if getattr(remaining_comp, "id", None) else None,
                        code=remaining_comp.code,
                        name=remaining_comp.name,
                        type="EARNING",
                        calculation_type=remaining_comp.calculation_type,
                        calculation_basis=remaining_comp.calculation_basis,
                        rate_or_pct=remaining_comp.value,
                        monthly_amount=float(rem_amt),
                        annual_amount=float(_q2(rem_amt * TWELVE_DEC)),
                    )
                )

            monthly_gross_dec = _q2(sum((_to_dec(e.monthly_amount) for e in earnings_list), ZERO_DEC))

        # 4. Deductions calculation
        total_deductions_dec = ZERO_DEC
        for comp in deduction_comps:
            ctype = comp.calculation_type.upper()
            cbasis = (comp.calculation_basis or "").upper()
            code_up = comp.code.upper()
            val_dec = _to_dec(comp.value)

            if ctype == "FIXED":
                monthly_amt_dec = _q2(val_dec)
            elif ctype == "PERCENTAGE_OF_BASIC" or cbasis == "BASIC":
                basis_val = comp_amounts.get("BASIC", monthly_gross_dec)
                monthly_amt_dec = _q2(basis_val * (val_dec / HUNDRED_DEC))
            elif ctype in ("PERCENTAGE_OF_CTC",) or cbasis == "CTC":
                monthly_amt_dec = _q2(monthly_ctc_dec * (val_dec / HUNDRED_DEC))
            elif cbasis == "GROSS":
                monthly_amt_dec = _q2(monthly_gross_dec * (val_dec / HUNDRED_DEC))
            elif cbasis in comp_amounts:
                monthly_amt_dec = _q2(comp_amounts[cbasis] * (val_dec / HUNDRED_DEC))
            else:
                monthly_amt_dec = _q2(monthly_gross_dec * (val_dec / HUNDRED_DEC))

            comp_amounts[code_up] = monthly_amt_dec
            deductions_list.append(
                SalaryBreakdownItem(
                    component_id=str(comp.id) if getattr(comp, "id", None) else None,
                    code=comp.code,
                    name=comp.name,
                    type="DEDUCTION",
                    calculation_type=comp.calculation_type,
                    calculation_basis=comp.calculation_basis,
                    rate_or_pct=comp.value,
                    monthly_amount=float(monthly_amt_dec),
                    annual_amount=float(_q2(monthly_amt_dec * TWELVE_DEC)),
                )
            )
            total_deductions_dec += monthly_amt_dec

        total_deductions_dec = _q2(total_deductions_dec)
        estimated_net_dec = max(ZERO_DEC, _q2(monthly_gross_dec - total_deductions_dec))

        return SalaryPreviewResponse(
            annual_ctc=float(_q2(annual_ctc_dec)),
            monthly_ctc=float(monthly_ctc_dec),
            earnings=earnings_list,
            deductions=deductions_list,
            monthly_gross=float(monthly_gross_dec),
            total_deductions=float(total_deductions_dec),
            estimated_net_salary=float(estimated_net_dec),
            annual_gross=float(_q2(monthly_gross_dec * TWELVE_DEC)),
            annual_net=float(_q2(estimated_net_dec * TWELVE_DEC)),
        )

    # ---------------------------------------------------------------------------
    # TAB 2: Employee Salary Assignment & Revision History
    # ---------------------------------------------------------------------------

    async def assign_employee_salary(
        self, req: EmployeeSalaryAssignRequest, admin_id: uuid.UUID
    ) -> HrmsEmployeeSalary:
        """
        Assigns or revises an employee's salary structure with effective date.
        Preserves historical revisions without overwriting old salary data.
        """
        emp_query = select(User).where(User.id == req.employee_id, User.deleted_at.is_(None))
        emp = (await self.db.execute(emp_query)).scalar_one_or_none()
        if not emp:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Employee not found.")

        # Calculate structure breakdown from global setup
        preview = await self.calculate_preview(req.annual_ctc)

        monthly_ctc = preview.monthly_ctc
        structure_breakdown = {
            "annual_ctc": req.annual_ctc,
            "monthly_ctc": monthly_ctc,
            "earnings": [item.model_dump() for item in preview.earnings],
            "deductions": [item.model_dump() for item in preview.deductions],
            "monthly_gross": preview.monthly_gross,
            "total_deductions": preview.total_deductions,
            "estimated_net_salary": preview.estimated_net_salary,
        }

        # Mark existing active salaries for this employee as not current if new effective date >= existing
        ex_query = select(HrmsEmployeeSalary).where(
            HrmsEmployeeSalary.employee_id == req.employee_id,
            HrmsEmployeeSalary.deleted_at.is_(None),
        )
        existing_salaries = list((await self.db.execute(ex_query)).scalars().all())

        for sal in existing_salaries:
            if sal.effective_from <= req.effective_from:
                sal.is_active = False

        new_salary = HrmsEmployeeSalary(
            employee_id=req.employee_id,
            annual_ctc=_q2(_to_dec(req.annual_ctc)),
            monthly_ctc=_q2(_to_dec(monthly_ctc)),
            effective_from=req.effective_from,
            is_active=True,
            structure_breakdown=structure_breakdown,
            notes=req.notes,
            created_by=admin_id,
            updated_by=admin_id,
        )
        self.db.add(new_salary)
        await self.db.commit()
        await self.db.refresh(new_salary)
        return new_salary

    async def get_employee_salaries(
        self, allowed_employee_ids: Optional[set[uuid.UUID]] = None
    ) -> list[dict]:
        """
        Returns employees from users table along with their current active salary structure.
        """
        users_query = (
            select(User)
            .where(
                User.deleted_at.is_(None),
                User.is_active.is_(True),
                User.status == UserStatus.ACTIVE,
                or_(
                    User.employment_status.is_(None),
                    User.employment_status.notin_([EmploymentStatus.TERMINATED, EmploymentStatus.RESIGNED]),
                ),
            )
            .order_by(User.first_name.asc(), User.username.asc())
        )
        if allowed_employee_ids is not None:
            users_query = users_query.where(User.id.in_(allowed_employee_ids))

        users = list((await self.db.execute(users_query)).scalars().all())

        if not users:
            return []

        uids = [u.id for u in users]

        # 1. Active salaries map
        sal_query = (
            select(HrmsEmployeeSalary)
            .where(
                HrmsEmployeeSalary.employee_id.in_(uids),
                HrmsEmployeeSalary.deleted_at.is_(None),
                HrmsEmployeeSalary.is_active.is_(True),
            )
            .order_by(HrmsEmployeeSalary.effective_from.desc())
        )
        sal_rows = list((await self.db.execute(sal_query)).scalars().all())
        salary_map: dict[uuid.UUID, HrmsEmployeeSalary] = {}
        for s in sal_rows:
            if s.employee_id not in salary_map:
                salary_map[s.employee_id] = s

        # 2. Revision counts map
        rev_query = (
            select(HrmsEmployeeSalary.employee_id, func.count(HrmsEmployeeSalary.id))
            .where(
                HrmsEmployeeSalary.employee_id.in_(uids),
                HrmsEmployeeSalary.deleted_at.is_(None),
            )
            .group_by(HrmsEmployeeSalary.employee_id)
        )
        rev_rows = (await self.db.execute(rev_query)).all()
        rev_map: dict[uuid.UUID, int] = {uid: cnt for uid, cnt in rev_rows}

        # 3. Department resolution from UserRole -> Role
        from app.rbac.models import UserRole, Role
        from app.org_structure.models import EmployeePositionAssignment, Position

        dept_map: dict[uuid.UUID, str] = {}
        try:
            r_stmt = (
                select(UserRole.user_id, Role.name)
                .join(Role, Role.id == UserRole.role_id)
                .where(UserRole.user_id.in_(uids))
            )
            roles_res = (await self.db.execute(r_stmt)).all()
            for uid, rname in roles_res:
                if rname.lower() not in ("user", "employee") and uid not in dept_map:
                    dept_map[uid] = rname
        except Exception:
            pass

        # 4. Designation resolution from EmployeePositionAssignment -> Position
        pos_map: dict[uuid.UUID, str] = {}
        try:
            p_stmt = (
                select(EmployeePositionAssignment.employee_id, Position.name)
                .join(Position, Position.id == EmployeePositionAssignment.position_id)
                .where(EmployeePositionAssignment.employee_id.in_(uids))
            )
            pos_res = (await self.db.execute(p_stmt)).all()
            for uid, pname in pos_res:
                if uid not in pos_map:
                    pos_map[uid] = pname
        except Exception:
            pass

        # Single source of truth: compute structure breakdown strictly from active DB components
        active_comps = await self.get_components(include_inactive=False)

        results = []
        for user in users:
            current_salary = salary_map.get(user.id)
            rev_res = rev_map.get(user.id, 0)
            dept = dept_map.get(user.id) or getattr(user, "department", None) or "General"
            desig = (
                pos_map.get(user.id)
                or (user.employment_type.value if hasattr(user.employment_type, "value") else str(user.employment_type or ""))
                or getattr(user, "designation", None)
                or "Staff"
            )
            if not desig or desig.strip() == "None":
                desig = "Staff"
            code = user.employee_code or f"EMP-{str(user.id)[:6].upper()}"

            dynamic_breakdown = None
            if current_salary and current_salary.annual_ctc:
                preview = await self.calculate_preview(current_salary.annual_ctc, custom_components=active_comps)
                dynamic_breakdown = preview.model_dump()

            results.append(
                {
                    "employee_id": str(user.id),
                    "employee_name": user.full_name,
                    "employee_code": code,
                    "department": dept,
                    "designation": desig,
                    "annual_ctc": float(current_salary.annual_ctc) if current_salary else None,
                    "monthly_ctc": float(current_salary.monthly_ctc) if current_salary else None,
                    "effective_from": str(current_salary.effective_from) if current_salary else None,
                    "has_salary": current_salary is not None,
                    "salary_id": str(current_salary.id) if current_salary else None,
                    "revision_count": rev_res,
                    "structure_breakdown": dynamic_breakdown,
                    "status": "Configured" if current_salary else "Not Set",
                }
            )

        return results

    async def get_employee_salary_history(self, employee_id: uuid.UUID) -> list[HrmsEmployeeSalary]:
        """Retrieve complete revision history for an employee's salary."""
        query = (
            select(HrmsEmployeeSalary)
            .where(
                HrmsEmployeeSalary.employee_id == employee_id,
                HrmsEmployeeSalary.deleted_at.is_(None),
            )
            .order_by(HrmsEmployeeSalary.effective_from.desc(), HrmsEmployeeSalary.created_at.desc())
        )
        result = await self.db.execute(query)
        return list(result.scalars().all())

    get_salary_history = get_employee_salary_history

    # ---------------------------------------------------------------------------
    # Manual Monthly Adjustments
    # ---------------------------------------------------------------------------

    async def create_adjustment(
        self, adj_in: PayrollAdjustmentCreate, admin_id: uuid.UUID
    ) -> HrmsPayrollAdjustment:
        """Create a month-specific adjustment (Bonus or Deduction)."""
        emp_query = select(User).where(User.id == adj_in.employee_id, User.deleted_at.is_(None))
        emp = (await self.db.execute(emp_query)).scalar_one_or_none()
        if not emp:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Employee not found.")

        adj = HrmsPayrollAdjustment(
            employee_id=adj_in.employee_id,
            payroll_month=adj_in.payroll_month,
            adjustment_type=adj_in.adjustment_type.strip().upper(),
            title=adj_in.title.strip(),
            amount=_q2(_to_dec(adj_in.amount)),
            reason=adj_in.reason.strip(),
            created_by=admin_id,
        )
        self.db.add(adj)
        await self.db.commit()
        await self.db.refresh(adj)
        return adj

    async def get_adjustments(
        self, payroll_month: str | None = None, employee_id: uuid.UUID | None = None
    ) -> list[HrmsPayrollAdjustment]:
        """Retrieve adjustments filtered by month and/or employee."""
        query = select(HrmsPayrollAdjustment).order_by(HrmsPayrollAdjustment.created_at.desc())
        if payroll_month:
            query = query.where(HrmsPayrollAdjustment.payroll_month == payroll_month)
        if employee_id:
            query = query.where(HrmsPayrollAdjustment.employee_id == employee_id)
        result = await self.db.execute(query)
        return list(result.scalars().all())

    # ---------------------------------------------------------------------------
    # TAB 3: Monthly Payroll Processing & Calculation
    # ---------------------------------------------------------------------------

    async def _calculate_calendar_metrics(self, year: int, month: int) -> dict:
        """
        Computes total days, weekend days (Sundays), and holidays falling on weekdays for the given month.
        Weekends and holidays do NOT reduce salary.
        """
        total_days = calendar.monthrange(year, month)[1]
        start_date = date(year, month, 1)
        end_date = date(year, month, total_days)

        # Count Sundays
        sunday_count = 0
        all_sundays = set()
        for d in range(1, total_days + 1):
            dt = date(year, month, d)
            if dt.weekday() == 6:  # Sunday
                sunday_count += 1
                all_sundays.add(dt)

        # Fetch corporate holidays within the month
        hol_query = select(HrmsHoliday).where(
            HrmsHoliday.is_active == True,
            HrmsHoliday.holiday_date >= start_date,
            HrmsHoliday.holiday_date <= end_date,
        )
        holidays = list((await self.db.execute(hol_query)).scalars().all())

        # Holidays falling on working weekdays (not on Sundays)
        holiday_dates = set()
        for h in holidays:
            if h.holiday_date not in all_sundays:
                holiday_dates.add(h.holiday_date)
        holiday_weekday_count = len(holiday_dates)

        working_days = max(0, total_days - sunday_count - holiday_weekday_count)

        return {
            "total_days": total_days,
            "start_date": start_date,
            "end_date": end_date,
            "weekend_days": sunday_count,
            "holiday_days": holiday_weekday_count,
            "working_days": working_days,
            "all_sundays": all_sundays,
            "holiday_dates": holiday_dates,
        }

    async def calculate_monthly_payroll(
        self, payroll_month: str, admin_id: uuid.UUID
    ) -> HrmsMonthlyPayroll:
        """
        Calculates monthly payroll snapshot for all employees having active salary structures.
        Uses:
          - Effective salary structure for that payroll month
          - Actual attendance records
          - Approved paid leaves
          - Corporate holidays and weekends (which do NOT reduce salary)
          - LOP deduction logic: (monthly_gross / working_days) * lop_days
          - Manual monthly adjustments
        Saves snapshot with status PROCESSED.
        """
        parts = payroll_month.split("-")
        if len(parts) != 2:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid month format. Expected YYYY-MM."
            )
        try:
            year = int(parts[0])
            month = int(parts[1])
        except ValueError:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid year or month numbers.")

        # Check if payroll exists and is already APPROVED (with row-level lock for concurrency safety)
        pay_query = (
            select(HrmsMonthlyPayroll)
            .where(HrmsMonthlyPayroll.payroll_month == payroll_month)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        existing_payroll = (await self.db.execute(pay_query)).scalar_one_or_none()
        if existing_payroll and existing_payroll.status == "APPROVED":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Payroll for {payroll_month} is already APPROVED and locked. Reopen it first to recalculate.",
            )

        cal = await self._calculate_calendar_metrics(year, month)
        start_date = cal["start_date"]
        end_date = cal["end_date"]
        working_days = cal["working_days"]
        weekend_days = cal["weekend_days"]
        holiday_days = cal["holiday_days"]

        # Retrieve only active, non-deleted users
        users_query = (
            select(User)
            .where(
                User.deleted_at.is_(None),
                User.is_active.is_(True),
                User.status == UserStatus.ACTIVE,
                or_(
                    User.employment_status.is_(None),
                    User.employment_status.notin_([EmploymentStatus.TERMINATED, EmploymentStatus.RESIGNED]),
                ),
            )
            .order_by(User.first_name.asc(), User.username.asc())
        )
        users = list((await self.db.execute(users_query)).scalars().all())

        if not existing_payroll:
            new_payroll = HrmsMonthlyPayroll(
                payroll_month=payroll_month,
                payroll_year=year,
                month_number=month,
                status="PROCESSED",
                working_days=working_days,
                weekend_days=weekend_days,
                holiday_days=holiday_days,
                processed_at=datetime.now(timezone.utc),
                processed_by=admin_id,
            )
            try:
                # Use a savepoint so that if concurrent execution triggers a unique constraint IntegrityError,
                # the savepoint rolls back without invalidating the parent transaction context.
                async with self.db.begin_nested():
                    self.db.add(new_payroll)
                    await self.db.flush()
                existing_payroll = new_payroll
            except IntegrityError as exc:
                # Concurrent worker created the monthly payroll row in the race window.
                # Check driver constraint metadata or exact constraint name to ensure we only
                # recover from the specific payroll_month unique conflict on hrms_monthly_payrolls.
                orig = getattr(exc, "orig", None)
                constraint_name = (
                    getattr(orig, "constraint_name", None)
                    or getattr(getattr(orig, "diag", None), "constraint_name", None)
                )

                err_msg = str(orig or exc).lower()
                is_exact_month_conflict = False

                if constraint_name and str(constraint_name).lower() in (
                    "hrms_monthly_payrolls_payroll_month_key",
                    "uq_hrms_monthly_payrolls_payroll_month",
                    "ix_hrms_monthly_payrolls_payroll_month",
                ):
                    is_exact_month_conflict = True
                elif "payroll_month" in err_msg and (
                    "hrms_monthly_payrolls_payroll_month_key" in err_msg
                    or "uq_hrms_monthly_payrolls_payroll_month" in err_msg
                    or "ix_hrms_monthly_payrolls_payroll_month" in err_msg
                    or "key (payroll_month)" in err_msg
                    or "duplicate key" in err_msg
                ):
                    is_exact_month_conflict = True

                if not is_exact_month_conflict:
                    raise exc

                # Re-query existing payroll row with row lock now that the concurrent worker created it
                pay_query = (
                    select(HrmsMonthlyPayroll)
                    .where(HrmsMonthlyPayroll.payroll_month == payroll_month)
                    .with_for_update()
                    .execution_options(populate_existing=True)
                )
                existing_payroll = (await self.db.execute(pay_query)).scalar_one_or_none()
                if not existing_payroll:
                    raise exc

                if existing_payroll.status == "APPROVED":
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail=f"Payroll for {payroll_month} is already APPROVED and locked. Reopen it first to recalculate.",
                    )

                existing_payroll.working_days = working_days
                existing_payroll.weekend_days = weekend_days
                existing_payroll.holiday_days = holiday_days
                existing_payroll.status = "PROCESSED"
                existing_payroll.processed_at = datetime.now(timezone.utc)
                existing_payroll.processed_by = admin_id
        else:
            existing_payroll.working_days = working_days
            existing_payroll.weekend_days = weekend_days
            existing_payroll.holiday_days = holiday_days
            existing_payroll.status = "PROCESSED"
            existing_payroll.processed_at = datetime.now(timezone.utc)
            existing_payroll.processed_by = admin_id

        # Purge any orphaned items in existing_payroll for users that are no longer active/eligible
        valid_user_ids = [u.id for u in users]
        if existing_payroll.id:
            await self.db.execute(
                delete(HrmsMonthlyPayrollItem).where(
                    HrmsMonthlyPayrollItem.payroll_id == existing_payroll.id,
                    HrmsMonthlyPayrollItem.employee_id.not_in(valid_user_ids),
                )
            )

        total_gross_dec = ZERO_DEC
        total_deductions_dec = ZERO_DEC
        total_net_dec = ZERO_DEC
        employee_count = 0

        if users:
            # Batch-load all payroll calculation inputs in constant O(1) queries (eliminates N+1 storm: HRMS-BUG-27)
            sal_rows = (
                await self.db.execute(
                    select(HrmsEmployeeSalary)
                    .where(
                        HrmsEmployeeSalary.employee_id.in_(valid_user_ids),
                        HrmsEmployeeSalary.effective_from <= end_date,
                        HrmsEmployeeSalary.deleted_at.is_(None),
                    )
                    .order_by(HrmsEmployeeSalary.employee_id.asc(), HrmsEmployeeSalary.effective_from.desc())
                )
            ).scalars().all()
            salary_by_emp: dict[uuid.UUID, HrmsEmployeeSalary] = {}
            for s in sal_rows:
                if s.employee_id not in salary_by_emp:
                    salary_by_emp[s.employee_id] = s

            unsalaried_ids = [uid for uid in valid_user_ids if uid not in salary_by_emp]
            if existing_payroll.id and unsalaried_ids:
                await self.db.execute(
                    delete(HrmsMonthlyPayrollItem).where(
                        HrmsMonthlyPayrollItem.payroll_id == existing_payroll.id,
                        HrmsMonthlyPayrollItem.employee_id.in_(unsalaried_ids),
                    )
                )

            salaried_ids = list(salary_by_emp.keys())
            if salaried_ids:
                active_comps = await self.get_components(include_inactive=False)
                att_service = HrmsAttendanceService(self.db)
                policy = await att_service.get_policy()
                weekly_off_raw = (policy.weekly_off or "Sunday").strip()
                weekly_off_days = {d.strip().capitalize() for d in weekly_off_raw.split(",") if d.strip()} or {"Sunday"}
                today_ist = datetime.now(IST).date()
                month_dates = [date(year, month, d_num) for d_num in range(1, cal["total_days"] + 1)]

                # Holidays active in month
                month_holidays = list(
                    (
                        await self.db.execute(
                            select(HrmsHoliday).where(
                                HrmsHoliday.deleted_at.is_(None),
                                HrmsHoliday.is_active.is_(True),
                                HrmsHoliday.holiday_date >= start_date,
                                HrmsHoliday.holiday_date <= end_date,
                            )
                        )
                    )
                    .scalars()
                    .all()
                )

                # Employee primary branches
                loc_rows = (
                    await self.db.execute(
                        select(HrmsEmployeeLocation.user_id, HrmsLocation.name)
                        .join(HrmsLocation, HrmsLocation.id == HrmsEmployeeLocation.location_id)
                        .where(
                            HrmsEmployeeLocation.user_id.in_(salaried_ids),
                            HrmsLocation.deleted_at.is_(None),
                        )
                        .order_by(HrmsEmployeeLocation.is_primary.desc())
                    )
                ).all()
                emp_branch_map: dict[uuid.UUID, str] = {}
                for uid, lname in loc_rows:
                    if uid not in emp_branch_map:
                        emp_branch_map[uid] = lname

                # Employee primary departments
                role_rows = (
                    await self.db.execute(
                        select(UserRole.user_id, Role.name)
                        .join(Role, Role.id == UserRole.role_id)
                        .where(UserRole.user_id.in_(salaried_ids))
                        .order_by(UserRole.is_primary.desc())
                    )
                ).all()
                emp_dept_map: dict[uuid.UUID, str] = {}
                for uid, rname in role_rows:
                    if uid not in emp_dept_map:
                        emp_dept_map[uid] = rname

                # All attendance records in month
                att_rows = (
                    await self.db.execute(
                        select(HrmsAttendance).where(
                            HrmsAttendance.employee_id.in_(salaried_ids),
                            HrmsAttendance.attendance_date >= start_date,
                            HrmsAttendance.attendance_date <= end_date,
                        )
                    )
                ).scalars().all()
                att_by_emp: dict[uuid.UUID, dict[date, HrmsAttendance]] = {}
                for r in att_rows:
                    att_by_emp.setdefault(r.employee_id, {})[r.attendance_date] = r

                # All approved leave requests overlapping month (preserving HrmsLeaveType.is_paid)
                lv_rows = (
                    await self.db.execute(
                        select(HrmsLeaveRequest, HrmsLeaveType.name, HrmsLeaveType.is_paid)
                        .join(HrmsLeaveType, HrmsLeaveType.id == HrmsLeaveRequest.leave_type_id)
                        .where(
                            HrmsLeaveRequest.employee_id.in_(salaried_ids),
                            HrmsLeaveRequest.approval_status == "APPROVED",
                            HrmsLeaveRequest.from_date <= end_date,
                            HrmsLeaveRequest.to_date >= start_date,
                        )
                    )
                ).all()
                leaves_by_emp: dict[uuid.UUID, dict[date, tuple[str, bool, Decimal]]] = {}
                for req, lt_name, lt_is_paid in lv_rows:
                    is_half = (
                        req.from_date == req.to_date
                        and abs(float(req.number_of_days or 1.0) - 0.5) < 1e-6
                    )
                    lv_weight = Decimal("0.5") if is_half else Decimal("1")
                    cur_d = max(req.from_date, start_date)
                    req_end = min(req.to_date, end_date)
                    lmap = leaves_by_emp.setdefault(req.employee_id, {})
                    while cur_d <= req_end:
                        lmap[cur_d] = (lt_name, bool(lt_is_paid), lv_weight)
                        cur_d += timedelta(days=1)

                # All manual adjustments for payroll_month
                adj_rows = (
                    await self.db.execute(
                        select(HrmsPayrollAdjustment).where(
                            HrmsPayrollAdjustment.employee_id.in_(salaried_ids),
                            HrmsPayrollAdjustment.payroll_month == payroll_month,
                        )
                    )
                ).scalars().all()
                adj_by_emp: dict[uuid.UUID, list[HrmsPayrollAdjustment]] = {}
                for a in adj_rows:
                    adj_by_emp.setdefault(a.employee_id, []).append(a)

                # Existing monthly payroll items
                existing_items_by_emp: dict[uuid.UUID, HrmsMonthlyPayrollItem] = {}
                if existing_payroll.id:
                    ex_items = (
                        await self.db.execute(
                            select(HrmsMonthlyPayrollItem).where(
                                HrmsMonthlyPayrollItem.payroll_id == existing_payroll.id,
                                HrmsMonthlyPayrollItem.employee_id.in_(salaried_ids),
                            )
                        )
                    ).scalars().all()
                    existing_items_by_emp = {it.employee_id: it for it in ex_items}

                for user in users:
                    effective_salary = salary_by_emp.get(user.id)
                    if not effective_salary:
                        continue

                    record_map = att_by_emp.get(user.id, {})
                    leave_map = leaves_by_emp.get(user.id, {})
                    has_attendance_data = bool(record_map) or bool(leave_map)
                    emp_join_date = getattr(user, "date_of_joining", None)

                    working_days_count = 0
                    present_days_dec = Decimal("0")
                    paid_leave_days_dec = Decimal("0")
                    unpaid_leave_days_dec = Decimal("0")
                    future_days_count = 0
                    emp_holidays = 0
                    emp_weekends = 0
                    lop_days_dec = Decimal("0")
                    payable_days_dec = Decimal("0")

                    if not has_attendance_data:
                        emp_working_days = working_days
                        emp_holidays = holiday_days
                        emp_weekends = weekend_days
                        payable_days_dec = Decimal(str(working_days))
                    else:
                        emp_branch = (emp_branch_map.get(user.id) or "Thane").lower()
                        emp_dept = (emp_dept_map.get(user.id) or "General").lower()
                        holiday_dates_emp: set[date] = set()
                        for h in month_holidays:
                            app_b = (h.branch_applicability or "All Branches").lower()
                            app_d = (getattr(h, "department_scope", None) or "All Departments").lower()
                            if ("all" in app_b or emp_branch in app_b) and ("all" in app_d or emp_dept in app_d):
                                holiday_dates_emp.add(h.holiday_date)

                        for cur_date in month_dates:
                            if emp_join_date and cur_date < emp_join_date:
                                continue

                            rec = record_map.get(cur_date)
                            is_weekend = cur_date.strftime("%A") in weekly_off_days

                            if cur_date in holiday_dates_emp:
                                emp_holidays += 1
                                payable_days_dec += Decimal("1")
                            elif cur_date in leave_map:
                                _, lt_is_paid, lv_weight = leave_map[cur_date]
                                working_days_count += 1
                                if lt_is_paid is False:
                                    unpaid_leave_days_dec += lv_weight
                                    lop_days_dec += lv_weight
                                else:
                                    paid_leave_days_dec += lv_weight
                                    payable_days_dec += lv_weight

                                # For approved half-day leave (0.5), evaluate the remaining 0.5 working half
                                if lv_weight == Decimal("0.5"):
                                    has_worked_half = bool(
                                        rec
                                        and (
                                            rec.punch_in
                                            or (rec.regularization_status or "").upper() == "APPROVED"
                                            or (rec.status or "").upper()
                                            in ("PRESENT", "LATE", "HALF_DAY", "IN_PROGRESS", "WORK_FROM_HOME", "ON_DUTY")
                                        )
                                    )
                                    if has_worked_half:
                                        present_days_dec += Decimal("0.5")
                                        payable_days_dec += Decimal("0.5")
                                    elif cur_date < today_ist:
                                        lop_days_dec += Decimal("0.5")
                                    else:
                                        payable_days_dec += Decimal("0.5")
                            elif rec and (
                                rec.punch_in
                                or rec.status in ("PRESENT", "LATE", "HALF_DAY", "IN_PROGRESS", "MISSING_PUNCH")
                                or rec.regularization_status in ("PENDING", "APPROVED")
                            ):
                                c_status = (rec.status or "").upper()
                                if cur_date == today_ist and rec.punch_in and not rec.punch_out and c_status == "PRESENT":
                                    c_status = "IN_PROGRESS"
                                c_reg = (rec.regularization_status or "").upper()
                                if c_reg == "APPROVED" or c_status in ("PRESENT", "LATE", "IN_PROGRESS", "WORK_FROM_HOME", "ON_DUTY"):
                                    present_days_dec += Decimal("1")
                                    working_days_count += 1
                                    payable_days_dec += Decimal("1")
                                elif c_status == "HALF_DAY":
                                    present_days_dec += Decimal("0.5")
                                    lop_days_dec += Decimal("0.5")
                                    working_days_count += 1
                                    payable_days_dec += Decimal("0.5")
                                else:
                                    lop_days_dec += Decimal("1")
                                    working_days_count += 1
                            elif is_weekend:
                                emp_weekends += 1
                                payable_days_dec += Decimal("1")
                            elif rec:
                                c_status = (rec.status or "").upper()
                                c_reg = (rec.regularization_status or "").upper()
                                if c_reg == "APPROVED" or c_status in ("PRESENT", "LATE", "IN_PROGRESS", "WORK_FROM_HOME", "ON_DUTY"):
                                    present_days_dec += Decimal("1")
                                    working_days_count += 1
                                    payable_days_dec += Decimal("1")
                                elif c_status == "HALF_DAY":
                                    present_days_dec += Decimal("0.5")
                                    lop_days_dec += Decimal("0.5")
                                    working_days_count += 1
                                    payable_days_dec += Decimal("0.5")
                                else:
                                    lop_days_dec += Decimal("1")
                                    working_days_count += 1
                            else:
                                if cur_date < today_ist:
                                    lop_days_dec += Decimal("1")
                                    working_days_count += 1
                                else:
                                    future_days_count += 1
                                    working_days_count += 1
                                    payable_days_dec += Decimal("1")

                        emp_working_days = working_days_count if working_days_count > 0 else working_days

                    present_days = float(present_days_dec)
                    paid_leave_days = float(paid_leave_days_dec)
                    lop_days = float(lop_days_dec)
                    payable_days = float(payable_days_dec)

                    # 2. Earnings Breakdown & Monthly Gross using pre-loaded active components (0 SQL queries!)
                    calc_preview = await self.calculate_preview(effective_salary.annual_ctc, custom_components=active_comps)
                    earnings = [item.model_dump() for item in calc_preview.earnings]
                    deductions = [item.model_dump() for item in calc_preview.deductions]
                    monthly_ctc = calc_preview.monthly_ctc
                    annual_ctc = calc_preview.annual_ctc
                    monthly_gross_dec = _to_dec(calc_preview.monthly_gross)
                    monthly_gross = float(monthly_gross_dec)

                    # 3. LOP Deduction using exact Decimal arithmetic
                    if emp_working_days > 0 and lop_days_dec > Decimal("0") and monthly_gross_dec > Decimal("0"):
                        lop_deduction_dec = _q2((monthly_gross_dec / Decimal(str(emp_working_days))) * lop_days_dec)
                    else:
                        lop_deduction_dec = ZERO_DEC
                    lop_deduction = float(lop_deduction_dec)

                    # 4. Manual Adjustments (pre-loaded)
                    adjustments = adj_by_emp.get(user.id, [])
                    additions_breakdown = []
                    extra_additions_dec = ZERO_DEC
                    extra_deductions_dec = ZERO_DEC

                    for adj in adjustments:
                        adj_amt_dec = _q2(_to_dec(adj.amount))
                        if adj.adjustment_type.upper() == "ADDITION":
                            extra_additions_dec += adj_amt_dec
                            additions_breakdown.append(
                                {"title": adj.title, "amount": float(adj_amt_dec), "reason": adj.reason}
                            )
                        elif adj.adjustment_type.upper() == "DEDUCTION":
                            extra_deductions_dec += adj_amt_dec

                    standard_deductions_dec = _to_dec(calc_preview.total_deductions)
                    total_emp_deductions_dec = _q2(standard_deductions_dec + lop_deduction_dec + extra_deductions_dec)
                    emp_gross_dec = _q2(monthly_gross_dec + extra_additions_dec)
                    net_salary_dec = max(ZERO_DEC, _q2(emp_gross_dec - total_emp_deductions_dec))

                    total_emp_deductions = float(total_emp_deductions_dec)
                    emp_gross = float(emp_gross_dec)
                    net_salary = float(net_salary_dec)
                    daily_rate_val = (
                        float(_q2(monthly_gross_dec / Decimal(str(emp_working_days))))
                        if emp_working_days > 0 and monthly_gross_dec > Decimal("0")
                        else 0.0
                    )

                    existing_item = existing_items_by_emp.get(user.id)

                    calc_details = {
                        "calendar_days": cal["total_days"],
                        "working_days": emp_working_days,
                        "weekend_days": emp_weekends,
                        "holiday_days": emp_holidays,
                        "present_days": present_days,
                        "paid_leave_days": paid_leave_days,
                        "unpaid_leave_days": float(unpaid_leave_days_dec),
                        "future_days": future_days_count,
                        "payable_days": payable_days,
                        "lop_days": lop_days,
                        "lop_deduction": lop_deduction,
                        "attendance_available": has_attendance_data,
                        "daily_rate": daily_rate_val,
                        "base_gross": monthly_gross,
                        "date_of_joining": emp_join_date.isoformat() if emp_join_date else None,
                        "adjustments": [
                            {"title": a.title, "type": a.adjustment_type, "amount": float(a.amount), "reason": a.reason}
                            for a in adjustments
                        ],
                    }

                    annual_ctc_dec = _q2(_to_dec(annual_ctc))
                    monthly_ctc_dec = _q2(_to_dec(monthly_ctc))

                    if existing_item:
                        existing_item.salary_id = effective_salary.id
                        existing_item.annual_ctc = annual_ctc_dec
                        existing_item.monthly_ctc = monthly_ctc_dec
                        existing_item.working_days = emp_working_days
                        existing_item.present_days = present_days
                        existing_item.paid_leave_days = paid_leave_days
                        existing_item.holiday_days = emp_holidays
                        existing_item.weekend_days = emp_weekends
                        existing_item.lop_days = lop_days
                        existing_item.earnings_breakdown = earnings
                        existing_item.deductions_breakdown = deductions
                        existing_item.additions_breakdown = additions_breakdown
                        existing_item.lop_deduction = lop_deduction_dec
                        existing_item.gross_amount = emp_gross_dec
                        existing_item.total_deductions = total_emp_deductions_dec
                        existing_item.net_salary = net_salary_dec
                        existing_item.status = "DRAFT"
                        existing_item.calculation_details = calc_details
                        existing_item.edit_history = existing_item.edit_history or []
                    else:
                        new_item = HrmsMonthlyPayrollItem(
                            payroll_id=existing_payroll.id,
                            employee_id=user.id,
                            salary_id=effective_salary.id,
                            annual_ctc=annual_ctc_dec,
                            monthly_ctc=monthly_ctc_dec,
                            working_days=emp_working_days,
                            present_days=present_days,
                            paid_leave_days=paid_leave_days,
                            holiday_days=emp_holidays,
                            weekend_days=emp_weekends,
                            lop_days=lop_days,
                            earnings_breakdown=earnings,
                            deductions_breakdown=deductions,
                            additions_breakdown=additions_breakdown,
                            lop_deduction=lop_deduction_dec,
                            gross_amount=emp_gross_dec,
                            total_deductions=total_emp_deductions_dec,
                            net_salary=net_salary_dec,
                            status="DRAFT",
                            calculation_details=calc_details,
                            edit_history=[],
                        )
                        self.db.add(new_item)

                    total_gross_dec += emp_gross_dec
                    total_deductions_dec += total_emp_deductions_dec
                    total_net_dec += net_salary_dec
                    employee_count += 1

        existing_payroll.total_employees = employee_count
        existing_payroll.total_gross = _q2(total_gross_dec)
        existing_payroll.total_deductions = _q2(total_deductions_dec)
        existing_payroll.total_net = _q2(total_net_dec)
        existing_payroll.status = "REVIEW"

        await self.db.commit()
        await self.db.refresh(existing_payroll)
        return existing_payroll

    async def edit_payroll_item(
        self, item_id: uuid.UUID, edit_in: MonthlyPayrollItemEditRequest, admin_id: uuid.UUID
    ) -> HrmsMonthlyPayrollItem:
        """
        Admin/HR manual correction of an employee line item while payroll is in Draft/Review status.
        Records an audit trail of previous value, new value, reason, changed_by, and timestamp.
        Recalculates gross, deductions, and net salary.
        """
        query = (
            select(HrmsMonthlyPayrollItem)
            .options(
                selectinload(HrmsMonthlyPayrollItem.payroll),
                selectinload(HrmsMonthlyPayrollItem.employee),
            )
            .where(HrmsMonthlyPayrollItem.id == item_id)
        )
        item = (await self.db.execute(query)).scalar_one_or_none()
        if not item:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Payroll item not found.")

        if item.payroll.status == "APPROVED":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot edit an approved and locked payroll record. Reopen it first if corrections are required.",
            )

        admin_user = await self.db.get(User, admin_id)
        admin_name = (admin_user.display_name or f"{admin_user.first_name or ''} {admin_user.last_name or ''}".strip() or admin_user.username or "Admin") if admin_user else "Admin"

        changes_list = []

        # Attendance is authoritative from Attendance module and strictly read-only in Payroll.
        # Payroll adjustments allow corrections to earnings/deductions only.

        # 1. Earnings updates
        current_earnings = list(item.earnings_breakdown or [])
        if edit_in.earnings_updates:
            for code, new_val in edit_in.earnings_updates.items():
                found = False
                for e in current_earnings:
                    if e.get("code", "").upper() == code.upper():
                        old_v = e.get("monthly_amount", 0.0)
                        if old_v != new_val:
                            changes_list.append({"field": f"earnings.{code}", "old_value": old_v, "new_value": new_val})
                            e["monthly_amount"] = new_val
                            e["annual_amount"] = round(new_val * 12.0, 2)
                        found = True
                        break
                if not found:
                    changes_list.append({"field": f"earnings.{code}", "old_value": 0.0, "new_value": new_val})
                    current_earnings.append({
                        "code": code.upper(),
                        "name": code.title(),
                        "type": "EARNING",
                        "monthly_amount": new_val,
                        "annual_amount": round(new_val * 12.0, 2),
                    })
            item.earnings_breakdown = current_earnings
            item.gross_amount = _q2(sum((_to_dec(e.get("monthly_amount", 0.0)) for e in current_earnings), ZERO_DEC))

        # 3. Deductions updates
        current_deductions = list(item.deductions_breakdown or [])
        if edit_in.deductions_updates:
            for code, new_val in edit_in.deductions_updates.items():
                found = False
                for d in current_deductions:
                    if d.get("code", "").upper() == code.upper():
                        old_v = d.get("monthly_amount", 0.0)
                        if old_v != new_val:
                            changes_list.append({"field": f"deductions.{code}", "old_value": old_v, "new_value": new_val})
                            d["monthly_amount"] = new_val
                            d["annual_amount"] = round(new_val * 12.0, 2)
                        found = True
                        break
                if not found:
                    changes_list.append({"field": f"deductions.{code}", "old_value": 0.0, "new_value": new_val})
                    current_deductions.append({
                        "code": code.upper(),
                        "name": code.title(),
                        "type": "DEDUCTION",
                        "monthly_amount": new_val,
                        "annual_amount": round(new_val * 12.0, 2),
                    })
            item.deductions_breakdown = current_deductions

        # 4. Recalculate LOP deduction and Net using exact Decimal arithmetic
        gross_dec = _q2(_to_dec(item.gross_amount))
        if item.working_days > 0 and item.lop_days > 0 and gross_dec > Decimal("0"):
            lop_dec = _q2((gross_dec / Decimal(str(item.working_days))) * _to_dec(item.lop_days))
        else:
            lop_dec = ZERO_DEC
        item.lop_deduction = lop_dec

        comp_ded_dec = sum((_to_dec(d.get("monthly_amount", 0.0)) for d in current_deductions), ZERO_DEC)
        total_ded_dec = _q2(comp_ded_dec + lop_dec)
        item.total_deductions = total_ded_dec
        net_dec = max(ZERO_DEC, _q2(gross_dec - total_ded_dec))
        item.net_salary = net_dec

        # 5. Append audit entry
        changes_dict = {
            c["field"]: {"old": c.get("old_value"), "new": c.get("new_value")}
            for c in changes_list
        }
        iso_now = datetime.now(timezone.utc).isoformat()
        audit_entry = {
            "id": str(uuid.uuid4()),
            "edited_by": str(admin_id),
            "edited_by_id": str(admin_id),
            "edited_by_name": admin_name,
            "edited_at": iso_now,
            "timestamp": iso_now,
            "reason": edit_in.reason,
            "changes": changes_dict,
            "changes_list": changes_list,
            "notes": edit_in.notes,
        }
        history = list(item.edit_history or [])
        history.append(audit_entry)
        item.edit_history = history

        # 6. Recalculate parent payroll totals
        payroll_stmt = select(HrmsMonthlyPayrollItem).where(HrmsMonthlyPayrollItem.payroll_id == item.payroll_id)
        all_items = list((await self.db.execute(payroll_stmt)).scalars().all())
        item.payroll.total_gross = _q2(
            sum((_to_dec(i.gross_amount) for i in all_items if i.id != item.id), ZERO_DEC) + gross_dec
        )
        item.payroll.total_deductions = _q2(
            sum((_to_dec(i.total_deductions) for i in all_items if i.id != item.id), ZERO_DEC) + total_ded_dec
        )
        item.payroll.total_net = _q2(
            sum((_to_dec(i.net_salary) for i in all_items if i.id != item.id), ZERO_DEC) + net_dec
        )

        await self.db.commit()
        reloaded = (
            await self.db.execute(
                select(HrmsMonthlyPayrollItem)
                .options(
                    selectinload(HrmsMonthlyPayrollItem.payroll),
                    selectinload(HrmsMonthlyPayrollItem.employee),
                )
                .where(HrmsMonthlyPayrollItem.id == item.id)
            )
        ).scalar_one()
        return reloaded

    async def approve_monthly_payroll(
        self, payroll_month: str, admin_id: uuid.UUID
    ) -> HrmsMonthlyPayroll:
        """
        Approves monthly payroll, locking it from editing and making payslips available to employees.
        Enforces dual-control approval: an approver cannot approve a payroll batch containing their own payslip.
        """
        pay_query = (
            select(HrmsMonthlyPayroll)
            .where(HrmsMonthlyPayroll.payroll_month == payroll_month)
            .with_for_update()
        )
        payroll = (await self.db.execute(pay_query)).scalar_one_or_none()
        if not payroll:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Payroll for {payroll_month} not found. Please calculate first.",
            )

        if payroll.status == "APPROVED":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Payroll for {payroll_month} is already approved.",
            )

        # Retrieve all items in the batch and enforce dual-control BEFORE mutating statuses
        item_query = select(HrmsMonthlyPayrollItem).where(HrmsMonthlyPayrollItem.payroll_id == payroll.id)
        items = list((await self.db.execute(item_query)).scalars().all())

        if any(it.employee_id == admin_id for it in items):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    "Self-approval of payroll is prohibited. An approver cannot approve a monthly payroll "
                    "batch containing their own payslip."
                ),
            )

        payroll.status = "APPROVED"
        payroll.approved_at = datetime.now(timezone.utc)
        payroll.approved_by = admin_id

        # Update all items to APPROVED
        for it in items:
            it.status = "APPROVED"

        await self.db.commit()
        await self.db.refresh(payroll)
        return payroll

    async def reopen_monthly_payroll(
        self, payroll_month: str, admin_id: uuid.UUID, reason: str = "Reopened for review and corrections"
    ) -> HrmsMonthlyPayroll:
        """
        Reopens an approved monthly payroll back to REVIEW so adjustments can be made, recording audit trail.
        """
        pay_query = (
            select(HrmsMonthlyPayroll)
            .where(HrmsMonthlyPayroll.payroll_month == payroll_month)
            .with_for_update()
        )
        payroll = (await self.db.execute(pay_query)).scalar_one_or_none()
        if not payroll:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Payroll not found.")

        admin_user = await self.db.get(User, admin_id)
        admin_name = (admin_user.display_name or f"{admin_user.first_name or ''} {admin_user.last_name or ''}".strip() or admin_user.username or "Admin") if admin_user else "Admin"

        payroll.status = "REVIEW"
        payroll.approved_at = None
        payroll.approved_by = None
        reopen_note = f"[{datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC')}] Reopened by {admin_name}. Reason: {reason}"
        payroll.notes = f"{payroll.notes}\n{reopen_note}".strip() if payroll.notes else reopen_note

        item_query = select(HrmsMonthlyPayrollItem).where(HrmsMonthlyPayrollItem.payroll_id == payroll.id)
        items = list((await self.db.execute(item_query)).scalars().all())
        for it in items:
            it.status = "DRAFT"

        await self.db.commit()
        await self.db.refresh(payroll)
        return payroll

    async def get_monthly_payroll(self, payroll_month: str) -> HrmsMonthlyPayroll | None:
        """Retrieve monthly payroll and all line items with employee details."""
        query = (
            select(HrmsMonthlyPayroll)
            .options(
                selectinload(HrmsMonthlyPayroll.items).selectinload(HrmsMonthlyPayrollItem.employee),
                selectinload(HrmsMonthlyPayroll.items).selectinload(HrmsMonthlyPayrollItem.salary),
            )
            .where(HrmsMonthlyPayroll.payroll_month == payroll_month)
        )
        return (await self.db.execute(query)).scalar_one_or_none()

    async def get_employee_payslips(
        self,
        employee_id: uuid.UUID,
        is_admin: bool = False,
        payroll_month: str | None = None,
    ) -> list[HrmsMonthlyPayrollItem]:
        """
        Retrieves payslips for an employee. Non-admins ONLY see their own APPROVED slips.
        Admins can see any employee or all slips.
        """
        query = (
            select(HrmsMonthlyPayrollItem)
            .options(
                selectinload(HrmsMonthlyPayrollItem.employee),
                selectinload(HrmsMonthlyPayrollItem.payroll),
            )
            .join(HrmsMonthlyPayroll, HrmsMonthlyPayrollItem.payroll_id == HrmsMonthlyPayroll.id)
            .order_by(HrmsMonthlyPayroll.payroll_month.desc())
        )

        if not is_admin:
            query = query.where(
                HrmsMonthlyPayrollItem.employee_id == employee_id,
                HrmsMonthlyPayrollItem.status == "APPROVED",
            )
        else:
            if employee_id:
                query = query.where(HrmsMonthlyPayrollItem.employee_id == employee_id)

        if payroll_month:
            query = query.where(HrmsMonthlyPayroll.payroll_month == payroll_month)

        result = await self.db.execute(query)
        return list(result.scalars().all())
