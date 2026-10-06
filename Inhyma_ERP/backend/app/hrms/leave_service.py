"""
HRMS Leave Management Service (Phase 1).

Handles:
- Leave Types Master & Defaults
- Leave Plans (Branch + Department applicability and assigned leave types)
- Holiday Master (Branch-specific and global holidays)
- Employee Leave Balances (Quota allocation, consumption tracking, available calculation)
- Leave Adjustments with audit trail
- Leave Requests (Date validation, overlap blocking, consecutive days rule)
- Leave Approvals (Manager/HR reviews, balance deduction on approval, balance restoration on cancel/reversal)
"""

from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta, timezone
from typing import List, Optional

from fastapi import HTTPException, status
from sqlalchemy import func, select, or_, and_, not_
from sqlalchemy.ext.asyncio import AsyncSession

from app.hrms.models import (
    HrmsAttendancePolicy,
    HrmsEmployeeLeaveBalance,
    HrmsEmployeeLocation,
    HrmsHoliday,
    HrmsLeaveAdjustment,
    HrmsLeavePlan,
    HrmsLeavePlanType,
    HrmsLeaveRequest,
    HrmsLeaveType,
    HrmsLocation,
)
from app.hrms.schemas import (
    EmployeeLeaveAdjustmentRow,
    EmployeeLeaveBalanceRead,
    HolidayCreate,
    HolidayRead,
    HolidayUpdate,
    LeaveAdjustmentCreate,
    LeaveAdjustmentHistoryRead,
    LeaveBalanceSummary,
    LeavePlanCreate,
    LeavePlanRead,
    LeavePlanUpdate,
    LeaveRequestCreate,
    LeaveRequestRead,
    LeaveTypeCreate,
    LeaveTypeRead,
    LeaveTypeUpdate,
)
from app.rbac.models import Permission, Role, RolePermission, UserRole
from app.users.models import User


class HrmsLeaveService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    # -----------------------------------------------------------------------
    # Bootstrap Seeds
    # -----------------------------------------------------------------------
    async def ensure_seeds(self) -> None:
        """
        Idempotent bootstrap for Leave Types, sample Holidays, and Default Plan.
        """
        # 1. Leave Types (all 8 standard corporate types + Privilege Leave)
        existing_types_res = await self.db.execute(
            select(HrmsLeaveType.name).where(HrmsLeaveType.deleted_at.is_(None))
        )
        existing_names = {row[0].strip().lower() for row in existing_types_res.all()}

        default_types = [
            HrmsLeaveType(
                name="Casual Leave",
                code="CL",
                leave_type="REGULAR",
                is_paid=True,
                annual_balance=12.0,
                carry_forward_allowed=False,
                carry_forward_days=0.0,
                max_consecutive_days=3,
                monthly_accrual=False,
                is_active=True,
            ),
            HrmsLeaveType(
                name="Compensatory Off",
                code="CO",
                leave_type="REGULAR",
                is_paid=True,
                annual_balance=0.0,
                carry_forward_allowed=False,
                carry_forward_days=0.0,
                max_consecutive_days=2,
                monthly_accrual=False,
                is_active=True,
            ),
            HrmsLeaveType(
                name="Earned Leave",
                code="EL",
                leave_type="REGULAR",
                is_paid=True,
                annual_balance=18.0,
                carry_forward_allowed=True,
                carry_forward_days=15.0,
                max_consecutive_days=15,
                monthly_accrual=True,
                is_active=True,
            ),
            HrmsLeaveType(
                name="Leave Without Pay",
                code="LWP",
                leave_type="SPECIAL",
                is_paid=False,
                annual_balance=0.0,
                carry_forward_allowed=False,
                carry_forward_days=0.0,
                max_consecutive_days=30,
                monthly_accrual=False,
                is_active=True,
            ),
            HrmsLeaveType(
                name="Maternity Leave",
                code="ML",
                leave_type="SPECIAL",
                is_paid=True,
                annual_balance=180.0,
                carry_forward_allowed=False,
                carry_forward_days=0.0,
                max_consecutive_days=180,
                monthly_accrual=False,
                is_active=True,
            ),
            HrmsLeaveType(
                name="Paternity Leave",
                code="PL",
                leave_type="SPECIAL",
                is_paid=True,
                annual_balance=15.0,
                carry_forward_allowed=False,
                carry_forward_days=0.0,
                max_consecutive_days=15,
                monthly_accrual=False,
                is_active=True,
            ),
            HrmsLeaveType(
                name="Sabbatical Leave",
                code="SL",
                leave_type="SPECIAL",
                is_paid=False,
                annual_balance=365.0,
                carry_forward_allowed=False,
                carry_forward_days=0.0,
                max_consecutive_days=365,
                monthly_accrual=False,
                is_active=True,
            ),
            HrmsLeaveType(
                name="Sick Leave",
                code="SKL",
                leave_type="REGULAR",
                is_paid=True,
                annual_balance=12.0,
                carry_forward_allowed=False,
                carry_forward_days=0.0,
                max_consecutive_days=7,
                monthly_accrual=False,
                is_active=True,
            ),
            HrmsLeaveType(
                name="Privilege Leave",
                code="PLV",
                leave_type="REGULAR",
                is_paid=True,
                annual_balance=18.0,
                carry_forward_allowed=True,
                carry_forward_days=10.0,
                max_consecutive_days=15,
                monthly_accrual=False,
                is_active=True,
            ),
        ]

        to_add_types = [t for t in default_types if t.name.strip().lower() not in existing_names]
        if to_add_types:
            self.db.add_all(to_add_types)
            await self.db.flush()

        # 2. Default Holidays
        holiday_count_res = await self.db.execute(
            select(func.count(HrmsHoliday.id)).where(HrmsHoliday.deleted_at.is_(None))
        )
        if (holiday_count_res.scalar() or 0) == 0:
            sample_holidays = [
                HrmsHoliday(
                    name="Republic Day",
                    holiday_date=date(2026, 1, 26),
                    number_of_days=1,
                    branch_applicability="All Branches",
                    is_active=True,
                ),
                HrmsHoliday(
                    name="Independence Day",
                    holiday_date=date(2026, 8, 15),
                    number_of_days=1,
                    branch_applicability="All Branches",
                    is_active=True,
                ),
                HrmsHoliday(
                    name="Mahatma Gandhi Jayanti",
                    holiday_date=date(2026, 10, 2),
                    number_of_days=1,
                    branch_applicability="All Branches",
                    is_active=True,
                ),
                HrmsHoliday(
                    name="Diwali",
                    holiday_date=date(2026, 11, 8),
                    number_of_days=1,
                    branch_applicability="All Branches",
                    is_active=True,
                ),
            ]
            self.db.add_all(sample_holidays)

        # 3. Default Leave Plan
        plan_count_res = await self.db.execute(
            select(func.count(HrmsLeavePlan.id)).where(HrmsLeavePlan.deleted_at.is_(None))
        )
        if (plan_count_res.scalar() or 0) == 0:
            default_plan = HrmsLeavePlan(
                name="Employee Standard Leave Plan 2026",
                effective_from=date(2026, 1, 1),
                effective_to=date(2026, 12, 31),
                branch="All Branches",
                department="All Departments",
                is_active=True,
            )
            self.db.add(default_plan)
            await self.db.flush()

            # Assign active leave types to default plan
            all_lts = await self.db.scalars(
                select(HrmsLeaveType).where(HrmsLeaveType.deleted_at.is_(None))
            )
            for lt in all_lts.all():
                self.db.add(HrmsLeavePlanType(plan_id=default_plan.id, leave_type_id=lt.id))

        await self.db.commit()

    # -----------------------------------------------------------------------
    # Helper: Resolve Employee Branch & Department
    # -----------------------------------------------------------------------
    async def get_employee_org_context(self, employee_id: uuid.UUID) -> tuple[str, str]:
        """
        Derive employee's branch and department for plan and holiday applicability.
        """
        # Branch via primary or first assigned location
        loc_res = await self.db.execute(
            select(HrmsLocation.name)
            .join(HrmsEmployeeLocation, HrmsEmployeeLocation.location_id == HrmsLocation.id)
            .where(
                HrmsEmployeeLocation.user_id == employee_id,
                HrmsLocation.deleted_at.is_(None),
            )
            .order_by(HrmsEmployeeLocation.is_primary.desc())
            .limit(1)
        )
        branch = loc_res.scalar_one_or_none() or "Thane"

        # Department via primary or first assigned role
        role_res = await self.db.execute(
            select(Role.name)
            .join(UserRole, UserRole.role_id == Role.id)
            .where(UserRole.user_id == employee_id)
            .order_by(Role.is_system.asc(), UserRole.is_primary.desc())
            .limit(1)
        )
        rname = role_res.scalar_one_or_none()
        department = "Admin" if rname == "super_admin" else ("User" if rname == "user" else (rname or "General"))
        return branch, department

    # -----------------------------------------------------------------------
    # Applicable Leave Types for Employee
    # -----------------------------------------------------------------------
    def _is_leave_type_applicable(self, lt: HrmsLeaveType, branch: str, department: str) -> bool:
        app_to = (getattr(lt, "applicable_to", "ALL") or "ALL").upper()
        if app_to == "ALL":
            return True
        elif app_to == "DEPARTMENT":
            dept_rule = (getattr(lt, "applicable_departments", "ALL") or "ALL").strip().lower()
            if "all" in dept_rule or (department and department.lower() in [d.strip() for d in dept_rule.split(",")]):
                return True
            return False
        elif app_to == "BRANCH":
            branch_rule = (getattr(lt, "applicable_branches", "ALL") or "ALL").strip().lower()
            if "all" in branch_rule or (branch and branch.lower() in [b.strip() for b in branch_rule.split(",")]):
                return True
            return False
        return True

    async def get_applicable_leave_types(
        self, employee_id: uuid.UUID, target_date: Optional[date] = None
    ) -> List[HrmsLeaveType]:
        """
        Derive active leave types assigned to the employee's active leave plans
        matching employee branch and department.
        """
        await self.ensure_seeds()
        branch, department = await self.get_employee_org_context(employee_id)
        ref_date = target_date or date.today()

        applicable_plans = (
            await self.db.scalars(
                select(HrmsLeavePlan).where(
                    HrmsLeavePlan.deleted_at.is_(None),
                    HrmsLeavePlan.is_active.is_(True),
                    HrmsLeavePlan.effective_from <= ref_date,
                    HrmsLeavePlan.effective_to >= ref_date,
                    or_(
                        HrmsLeavePlan.branch == "All Branches",
                        func.lower(HrmsLeavePlan.branch) == branch.lower(),
                    ),
                    or_(
                        HrmsLeavePlan.department == "All Departments",
                        func.lower(HrmsLeavePlan.department) == department.lower(),
                    ),
                )
            )
        ).all()

        applicable_lt_ids = set()
        for p in applicable_plans:
            plan_types = (
                await self.db.scalars(
                    select(HrmsLeavePlanType.leave_type_id).where(HrmsLeavePlanType.plan_id == p.id)
                )
            ).all()
            applicable_lt_ids.update(plan_types)

        filter_cond = and_(
            HrmsLeaveType.id.notin_(select(HrmsLeavePlanType.leave_type_id)),
            not_(func.lower(HrmsLeaveType.name).like("%unassigned%")),
        )
        if applicable_plans and applicable_lt_ids:
            filter_cond = or_(HrmsLeaveType.id.in_(applicable_lt_ids), filter_cond)

        all_lts = (
            await self.db.scalars(
                select(HrmsLeaveType).where(
                    HrmsLeaveType.deleted_at.is_(None),
                    HrmsLeaveType.is_active.is_(True),
                    filter_cond,
                ).order_by(HrmsLeaveType.name.asc())
            )
        ).all()

        return [lt for lt in all_lts if self._is_leave_type_applicable(lt, branch, department)]

    # -----------------------------------------------------------------------
    # Leave Types CRUD
    # -----------------------------------------------------------------------
    async def list_leave_types(self) -> List[HrmsLeaveType]:
        await self.ensure_seeds()
        query = (
            select(HrmsLeaveType)
            .where(HrmsLeaveType.deleted_at.is_(None))
            .order_by(HrmsLeaveType.name.asc())
        )
        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def create_leave_type(self, payload: LeaveTypeCreate) -> HrmsLeaveType:
        # Check uniqueness by name
        existing = await self.db.scalar(
            select(HrmsLeaveType).where(
                func.lower(HrmsLeaveType.name) == payload.name.strip().lower(),
                HrmsLeaveType.deleted_at.is_(None),
            )
        )
        if existing:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Leave type '{payload.name}' already exists.",
            )

        leave_type = HrmsLeaveType(
            name=payload.name.strip(),
            code=payload.code.strip() if payload.code else None,
            description=payload.description.strip() if payload.description else None,
            leave_type=payload.leave_type,
            is_paid=payload.is_paid,
            annual_balance=payload.annual_balance,
            carry_forward_allowed=payload.carry_forward_allowed or (payload.carry_forward_days > 0),
            carry_forward_days=payload.carry_forward_days,
            max_consecutive_days=payload.max_consecutive_days,
            monthly_accrual=payload.monthly_accrual,
            accrual_amount=payload.accrual_amount,
            min_notice_days=payload.min_notice_days,
            allow_half_day=payload.allow_half_day,
            allow_backdated=payload.allow_backdated,
            require_attachment=payload.require_attachment,
            attendance_based_accrual=payload.attendance_based_accrual,
            attendance_based_condition=payload.attendance_based_condition,
            attendance_based_reward=payload.attendance_based_reward,
            attendance_based_departments=payload.attendance_based_departments,
            min_attendance_percentage=payload.min_attendance_percentage,
            min_working_days=payload.min_working_days,
            allocation_unit=payload.allocation_unit or "DAYS",
            accrual_frequency=payload.accrual_frequency or "MONTHLY",
            applicable_to=payload.applicable_to or "ALL",
            applicable_departments=payload.applicable_departments or "ALL",
            applicable_branches=payload.applicable_branches or "ALL",
            count_weekends_as_leave=payload.count_weekends_as_leave,
            count_holidays_as_leave=payload.count_holidays_as_leave,
            allow_negative_balance=payload.allow_negative_balance,
            is_active=payload.is_active,
        )
        self.db.add(leave_type)
        await self.db.commit()
        await self.db.refresh(leave_type)
        return leave_type

    async def get_leave_type(self, leave_type_id: uuid.UUID) -> HrmsLeaveType:
        leave = await self.db.scalar(
            select(HrmsLeaveType).where(
                HrmsLeaveType.id == leave_type_id,
                HrmsLeaveType.deleted_at.is_(None),
            )
        )
        if not leave:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Leave type not found.")
        return leave

    async def update_leave_type(self, leave_type_id: uuid.UUID, payload: LeaveTypeUpdate) -> HrmsLeaveType:
        leave = await self.get_leave_type(leave_type_id)

        if payload.name is not None and payload.name.strip():
            dup = await self.db.scalar(
                select(HrmsLeaveType).where(
                    func.lower(HrmsLeaveType.name) == payload.name.strip().lower(),
                    HrmsLeaveType.id != leave_type_id,
                    HrmsLeaveType.deleted_at.is_(None),
                )
            )
            if dup:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Another leave type named '{payload.name}' already exists.",
                )
            leave.name = payload.name.strip()

        if payload.code is not None:
            leave.code = payload.code.strip() if payload.code else None
        if payload.description is not None:
            leave.description = payload.description.strip() if payload.description else None
        if payload.leave_type is not None:
            leave.leave_type = payload.leave_type
        if payload.is_paid is not None:
            leave.is_paid = payload.is_paid
        if payload.annual_balance is not None:
            leave.annual_balance = payload.annual_balance
        if payload.carry_forward_allowed is not None:
            leave.carry_forward_allowed = payload.carry_forward_allowed
        if payload.carry_forward_days is not None:
            leave.carry_forward_days = payload.carry_forward_days
            if payload.carry_forward_days > 0:
                leave.carry_forward_allowed = True
        if payload.max_consecutive_days is not None:
            leave.max_consecutive_days = payload.max_consecutive_days
        if payload.monthly_accrual is not None:
            leave.monthly_accrual = payload.monthly_accrual
        if payload.accrual_amount is not None:
            leave.accrual_amount = payload.accrual_amount
        if payload.min_notice_days is not None:
            leave.min_notice_days = payload.min_notice_days
        if payload.allow_half_day is not None:
            leave.allow_half_day = payload.allow_half_day
        if payload.allow_backdated is not None:
            leave.allow_backdated = payload.allow_backdated
        if payload.require_attachment is not None:
            leave.require_attachment = payload.require_attachment
        if payload.attendance_based_accrual is not None:
            leave.attendance_based_accrual = payload.attendance_based_accrual
        if payload.attendance_based_condition is not None:
            leave.attendance_based_condition = payload.attendance_based_condition
        if payload.attendance_based_reward is not None:
            leave.attendance_based_reward = payload.attendance_based_reward
        if payload.attendance_based_departments is not None:
            leave.attendance_based_departments = payload.attendance_based_departments
        if payload.min_attendance_percentage is not None:
            leave.min_attendance_percentage = payload.min_attendance_percentage
        if payload.min_working_days is not None:
            leave.min_working_days = payload.min_working_days
        if payload.allocation_unit is not None:
            leave.allocation_unit = payload.allocation_unit
        if payload.accrual_frequency is not None:
            leave.accrual_frequency = payload.accrual_frequency
        if payload.applicable_to is not None:
            leave.applicable_to = payload.applicable_to
        if payload.applicable_departments is not None:
            leave.applicable_departments = payload.applicable_departments
        if payload.applicable_branches is not None:
            leave.applicable_branches = payload.applicable_branches
        if payload.count_weekends_as_leave is not None:
            leave.count_weekends_as_leave = payload.count_weekends_as_leave
        if payload.count_holidays_as_leave is not None:
            leave.count_holidays_as_leave = payload.count_holidays_as_leave
        if payload.allow_negative_balance is not None:
            leave.allow_negative_balance = payload.allow_negative_balance
        if payload.is_active is not None:
            leave.is_active = payload.is_active

        leave.version = (leave.version or 1) + 1
        await self.db.commit()
        await self.db.refresh(leave)
        return leave

    async def set_leave_type_status(self, leave_type_id: uuid.UUID, is_active: bool) -> HrmsLeaveType:
        leave = await self.get_leave_type(leave_type_id)
        leave.is_active = is_active
        leave.version = (leave.version or 1) + 1
        await self.db.commit()
        await self.db.refresh(leave)
        return leave

    async def delete_leave_type(self, leave_type_id: uuid.UUID) -> None:
        leave = await self.get_leave_type(leave_type_id)
        leave.deleted_at = datetime.now(timezone.utc)
        await self.db.commit()

    # -----------------------------------------------------------------------
    # Leave Plans CRUD
    # -----------------------------------------------------------------------
    async def list_leave_plans(self) -> List[LeavePlanRead]:
        await self.ensure_seeds()
        plans = (
            await self.db.scalars(
                select(HrmsLeavePlan)
                .where(HrmsLeavePlan.deleted_at.is_(None))
                .order_by(HrmsLeavePlan.created_at.desc())
            )
        ).all()

        user_ids = {p.created_by for p in plans if p.created_by} | {p.updated_by for p in plans if p.updated_by}
        user_names: dict[uuid.UUID, str] = {}
        if user_ids:
            users = (await self.db.scalars(select(User).where(User.id.in_(user_ids)))).all()
            user_names = {u.id: (u.display_name or f"{u.first_name or ''} {u.last_name or ''}".strip() or u.username or "User") for u in users}

        out: List[LeavePlanRead] = []
        for plan in plans:
            # Query junction leave types
            types_res = await self.db.scalars(
                select(HrmsLeaveType)
                .join(HrmsLeavePlanType, HrmsLeavePlanType.leave_type_id == HrmsLeaveType.id)
                .where(HrmsLeavePlanType.plan_id == plan.id, HrmsLeaveType.deleted_at.is_(None))
            )
            lts = types_res.all()
            out.append(
                LeavePlanRead(
                    id=plan.id,
                    name=plan.name,
                    effective_from=plan.effective_from,
                    effective_to=plan.effective_to,
                    branch=plan.branch,
                    department=plan.department,
                    is_active=plan.is_active,
                    leave_type_ids=[t.id for t in lts],
                    leave_types=[LeaveTypeRead.model_validate(t) for t in lts],
                    created_by=plan.created_by,
                    created_by_name=user_names.get(plan.created_by) if plan.created_by else None,
                    updated_by=plan.updated_by,
                    updated_by_name=user_names.get(plan.updated_by) if plan.updated_by else None,
                    created_at=plan.created_at,
                    updated_at=plan.updated_at,
                    version=plan.version,
                )
            )
        return out

    async def create_leave_plan(self, payload: LeavePlanCreate, user_id: uuid.UUID | None = None) -> LeavePlanRead:
        if payload.effective_from > payload.effective_to:
            raise HTTPException(status_code=400, detail="Effective From cannot be after Effective To date.")

        plan = HrmsLeavePlan(
            name=payload.name.strip(),
            effective_from=payload.effective_from,
            effective_to=payload.effective_to,
            branch=payload.branch.strip() or "All Branches",
            department=payload.department.strip() or "All Departments",
            is_active=payload.is_active,
            created_by=user_id,
            updated_by=user_id,
        )
        self.db.add(plan)
        await self.db.flush()

        # Add leave type mappings
        for ltid in payload.leave_type_ids:
            self.db.add(HrmsLeavePlanType(plan_id=plan.id, leave_type_id=ltid))

        await self.db.commit()
        await self.db.refresh(plan)

        plans = await self.list_leave_plans()
        for p in plans:
            if p.id == plan.id:
                return p
        raise HTTPException(status_code=500, detail="Failed to retrieve created leave plan.")

    async def get_leave_plan(self, plan_id: uuid.UUID) -> LeavePlanRead:
        plans = await self.list_leave_plans()
        for p in plans:
            if p.id == plan_id:
                return p
        raise HTTPException(status_code=404, detail="Leave plan not found.")

    async def update_leave_plan(
        self, plan_id: uuid.UUID, payload: LeavePlanUpdate, user_id: uuid.UUID | None = None
    ) -> LeavePlanRead:
        plan = await self.db.scalar(
            select(HrmsLeavePlan).where(HrmsLeavePlan.id == plan_id, HrmsLeavePlan.deleted_at.is_(None))
        )
        if not plan:
            raise HTTPException(status_code=404, detail="Leave plan not found.")

        if payload.name is not None:
            plan.name = payload.name.strip()
        if payload.effective_from is not None:
            plan.effective_from = payload.effective_from
        if payload.effective_to is not None:
            plan.effective_to = payload.effective_to
        if plan.effective_from > plan.effective_to:
            raise HTTPException(status_code=400, detail="Effective From cannot be after Effective To date.")

        if payload.branch is not None:
            plan.branch = payload.branch.strip() or "All Branches"
        if payload.department is not None:
            plan.department = payload.department.strip() or "All Departments"
        if payload.is_active is not None:
            plan.is_active = payload.is_active

        plan.updated_by = user_id
        plan.version = (plan.version or 1) + 1

        if payload.leave_type_ids is not None:
            # Replace mappings
            existing_maps = (
                await self.db.scalars(
                    select(HrmsLeavePlanType).where(HrmsLeavePlanType.plan_id == plan.id)
                )
            ).all()
            for m in existing_maps:
                await self.db.delete(m)
            await self.db.flush()

            for ltid in payload.leave_type_ids:
                self.db.add(HrmsLeavePlanType(plan_id=plan.id, leave_type_id=ltid))

        await self.db.commit()
        return await self.get_leave_plan(plan_id)

    async def set_leave_plan_status(self, plan_id: uuid.UUID, is_active: bool) -> LeavePlanRead:
        plan = await self.db.scalar(
            select(HrmsLeavePlan).where(HrmsLeavePlan.id == plan_id, HrmsLeavePlan.deleted_at.is_(None))
        )
        if not plan:
            raise HTTPException(status_code=404, detail="Leave plan not found.")
        plan.is_active = is_active
        plan.version = (plan.version or 1) + 1
        await self.db.commit()
        return await self.get_leave_plan(plan_id)

    async def delete_leave_plan(self, plan_id: uuid.UUID) -> None:
        plan = await self.db.scalar(
            select(HrmsLeavePlan).where(HrmsLeavePlan.id == plan_id, HrmsLeavePlan.deleted_at.is_(None))
        )
        if not plan:
            raise HTTPException(status_code=404, detail="Leave plan not found.")
        plan.deleted_at = datetime.now(timezone.utc)
        await self.db.commit()

    # -----------------------------------------------------------------------
    # Holiday Master CRUD
    # -----------------------------------------------------------------------
    async def list_holidays(self, branch: Optional[str] = None) -> List[HolidayRead]:
        await self.ensure_seeds()
        query = (
            select(HrmsHoliday)
            .where(HrmsHoliday.deleted_at.is_(None))
            .order_by(HrmsHoliday.holiday_date.asc())
        )
        holidays = (await self.db.scalars(query)).all()

        user_ids = {h.created_by for h in holidays if h.created_by} | {h.updated_by for h in holidays if h.updated_by}
        user_names: dict[uuid.UUID, str] = {}
        if user_ids:
            users = (await self.db.scalars(select(User).where(User.id.in_(user_ids)))).all()
            user_names = {u.id: (u.display_name or f"{u.first_name or ''} {u.last_name or ''}".strip() or u.username or "User") for u in users}

        out: List[HolidayRead] = []
        for h in holidays:
            if branch and branch != "All Branches":
                # Check branch applicability
                app = (h.branch_applicability or "All Branches").lower()
                if "all" not in app and branch.lower() not in app:
                    continue

            out.append(
                HolidayRead(
                    id=h.id,
                    name=h.name,
                    holiday_date=h.holiday_date,
                    number_of_days=h.number_of_days,
                    branch_applicability=h.branch_applicability,
                    is_active=h.is_active,
                    created_by=h.created_by,
                    created_by_name=user_names.get(h.created_by) if h.created_by else None,
                    updated_by=h.updated_by,
                    updated_by_name=user_names.get(h.updated_by) if h.updated_by else None,
                    created_at=h.created_at,
                    updated_at=h.updated_at,
                    version=h.version,
                )
            )
        return out

    async def create_holiday(self, payload: HolidayCreate, user_id: uuid.UUID | None = None) -> HolidayRead:
        holiday = HrmsHoliday(
            name=payload.name.strip(),
            holiday_date=payload.holiday_date,
            number_of_days=payload.number_of_days,
            branch_applicability=payload.branch_applicability.strip() or "All Branches",
            is_active=payload.is_active,
            created_by=user_id,
            updated_by=user_id,
        )
        self.db.add(holiday)
        await self.db.commit()
        await self.db.refresh(holiday)

        holidays = await self.list_holidays()
        for h in holidays:
            if h.id == holiday.id:
                return h
        raise HTTPException(status_code=500, detail="Failed to retrieve created holiday.")

    async def get_holiday(self, holiday_id: uuid.UUID) -> HolidayRead:
        holidays = await self.list_holidays()
        for h in holidays:
            if h.id == holiday_id:
                return h
        raise HTTPException(status_code=404, detail="Holiday not found.")

    async def update_holiday(
        self, holiday_id: uuid.UUID, payload: HolidayUpdate, user_id: uuid.UUID | None = None
    ) -> HolidayRead:
        holiday = await self.db.scalar(
            select(HrmsHoliday).where(HrmsHoliday.id == holiday_id, HrmsHoliday.deleted_at.is_(None))
        )
        if not holiday:
            raise HTTPException(status_code=404, detail="Holiday not found.")

        if payload.name is not None:
            holiday.name = payload.name.strip()
        if payload.holiday_date is not None:
            holiday.holiday_date = payload.holiday_date
        if payload.number_of_days is not None:
            holiday.number_of_days = payload.number_of_days
        if payload.branch_applicability is not None:
            holiday.branch_applicability = payload.branch_applicability.strip() or "All Branches"
        if payload.is_active is not None:
            holiday.is_active = payload.is_active

        holiday.updated_by = user_id
        holiday.version = (holiday.version or 1) + 1
        await self.db.commit()
        return await self.get_holiday(holiday_id)

    async def delete_holiday(self, holiday_id: uuid.UUID) -> None:
        holiday = await self.db.scalar(
            select(HrmsHoliday).where(HrmsHoliday.id == holiday_id, HrmsHoliday.deleted_at.is_(None))
        )
        if not holiday:
            raise HTTPException(status_code=404, detail="Holiday not found.")
        holiday.deleted_at = datetime.now(timezone.utc)
        await self.db.commit()

    # -----------------------------------------------------------------------
    # Date Validation & Day Calculation
    # -----------------------------------------------------------------------
    async def calculate_leave_days(
        self,
        from_date: date,
        to_date: date,
        employee_id: Optional[uuid.UUID] = None,
        leave_type_id: Optional[uuid.UUID] = None,
    ) -> float:
        """
        Calculates working leave duration between from_date and to_date inclusive.
        Evaluates holidays by employee branch and weekly off days.
        """
        if from_date > to_date:
            raise HTTPException(status_code=400, detail="From Date cannot be after To Date.")

        # Resolve employee branch
        branch = "Thane"
        if employee_id:
            branch, _ = await self.get_employee_org_context(employee_id)

        # Get leave type properties
        is_paid = True
        max_consecutive = 365
        is_special = False
        lt = None
        if leave_type_id:
            lt = await self.get_leave_type(leave_type_id)
            is_paid = lt.is_paid
            max_consecutive = lt.max_consecutive_days
            is_special = lt.leave_type == "SPECIAL" or not is_paid

        # Weekly off (default Sunday)
        policy_res = await self.db.execute(select(HrmsAttendancePolicy).limit(1))
        policy = policy_res.scalar_one_or_none()
        weekly_off_day = (policy.weekly_off if policy else "Sunday").strip().lower()
        weekday_map = {
            "monday": 0, "tuesday": 1, "wednesday": 2, "thursday": 3,
            "friday": 4, "saturday": 5, "sunday": 6
        }
        off_day_idx = weekday_map.get(weekly_off_day, 6)

        # Active holidays in range applicable to branch
        holidays_res = await self.db.execute(
            select(HrmsHoliday).where(
                HrmsHoliday.deleted_at.is_(None),
                HrmsHoliday.is_active.is_(True),
                HrmsHoliday.holiday_date >= from_date,
                HrmsHoliday.holiday_date <= to_date,
            )
        )
        holidays = holidays_res.scalars().all()
        holiday_dates = set()
        for h in holidays:
            app = (h.branch_applicability or "All Branches").lower()
            if "all" in app or branch.lower() in app:
                holiday_dates.add(h.holiday_date)

        total_calendar_days = (to_date - from_date).days + 1
        if is_special:
            # Special leaves (Maternity, Sabbatical, LWP) count calendar days
            leave_days = float(total_calendar_days)
        else:
            # Standard paid leaves count working days, respecting weekend & holiday configuration
            count_weekends = getattr(lt, "count_weekends_as_leave", False) if lt else False
            count_holidays = getattr(lt, "count_holidays_as_leave", False) if lt else False

            working_days = 0
            curr = from_date
            while curr <= to_date:
                is_weekend = (curr.weekday() == off_day_idx)
                is_holiday = (curr in holiday_dates)
                if is_weekend and not count_weekends:
                    curr += timedelta(days=1)
                    continue
                if is_holiday and not count_holidays:
                    curr += timedelta(days=1)
                    continue
                working_days += 1
                curr += timedelta(days=1)

            # If all days are weekend/holidays, warn user or default 1 if same day
            if working_days == 0:
                raise HTTPException(
                    status_code=400,
                    detail="The selected date range falls entirely on holidays or weekly off days.",
                )
            leave_days = float(working_days)

        if max_consecutive and max_consecutive > 0 and leave_days > max_consecutive:
            lt_name = lt.name if lt else "this leave type"
            raise HTTPException(
                status_code=400,
                detail=f"Maximum {max_consecutive} consecutive days are allowed for {lt_name}.",
            )

        return leave_days

    # -----------------------------------------------------------------------
    # Employee Leave Balances
    # -----------------------------------------------------------------------
    async def get_or_create_employee_balances(
        self, employee_id: uuid.UUID, year: int = 2026
    ) -> List[EmployeeLeaveBalanceRead]:
        """
        Retrieves or initializes employee leave balances for the given year.
        Applicable leave types are derived from matching Leave Plan for branch + dept.
        """
        await self.ensure_seeds()

        user = await self.db.scalar(select(User).where(User.id == employee_id))
        if not user:
            raise HTTPException(status_code=404, detail="Employee not found.")

        branch, department = await self.get_employee_org_context(employee_id)

        # Match applicable leave plans
        today = date.today()
        applicable_plans = (
            await self.db.scalars(
                select(HrmsLeavePlan).where(
                    HrmsLeavePlan.deleted_at.is_(None),
                    HrmsLeavePlan.is_active.is_(True),
                    HrmsLeavePlan.effective_from <= today,
                    HrmsLeavePlan.effective_to >= today,
                    or_(
                        HrmsLeavePlan.branch == "All Branches",
                        func.lower(HrmsLeavePlan.branch) == branch.lower(),
                    ),
                    or_(
                        HrmsLeavePlan.department == "All Departments",
                        func.lower(HrmsLeavePlan.department) == department.lower(),
                    ),
                )
            )
        ).all()

        applicable_lt_ids = set()
        for p in applicable_plans:
            plan_types = (
                await self.db.scalars(
                    select(HrmsLeavePlanType.leave_type_id).where(HrmsLeavePlanType.plan_id == p.id)
                )
            ).all()
            applicable_lt_ids.update(plan_types)

        all_lts = (
            await self.db.scalars(
                select(HrmsLeaveType).where(HrmsLeaveType.deleted_at.is_(None), HrmsLeaveType.is_active.is_(True))
            )
        ).all()

        # All active leave types apply (filtered by departmental applicability rules)
        target_lts = [lt for lt in all_lts if self._is_leave_type_applicable(lt, branch, department)]

        # Fetch existing balances
        existing_balances = (
            await self.db.scalars(
                select(HrmsEmployeeLeaveBalance).where(
                    HrmsEmployeeLeaveBalance.employee_id == employee_id,
                    HrmsEmployeeLeaveBalance.year == year,
                )
            )
        ).all()
        bal_by_lt = {b.leave_type_id: b for b in existing_balances}

        # Initialize any missing leave balance records
        for lt in target_lts:
            if lt.id not in bal_by_lt:
                new_bal = HrmsEmployeeLeaveBalance(
                    employee_id=employee_id,
                    leave_type_id=lt.id,
                    year=year,
                    allocated=lt.annual_balance,
                    consumed=0.0,
                    adjusted=0.0,
                    available=lt.annual_balance,
                )
                self.db.add(new_bal)
                await self.db.flush()
                bal_by_lt[lt.id] = new_bal

        # Ensure all balances have accurate available synchronized
        for bal in bal_by_lt.values():
            calc_avail = round(bal.allocated + bal.adjusted - bal.consumed, 2)
            if bal.available != calc_avail:
                bal.available = calc_avail

        await self.db.commit()

        lt_map = {lt.id: lt for lt in all_lts}
        emp_name = user.display_name or f"{user.first_name or ''} {user.last_name or ''}".strip() or user.username or "Employee"

        out: List[EmployeeLeaveBalanceRead] = []
        for lt_id, bal in bal_by_lt.items():
            lt = lt_map.get(lt_id)
            if not lt or lt.deleted_at is not None:
                continue
            avail_val = bal.available if bal.available is not None else round(bal.allocated + bal.adjusted - bal.consumed, 2)
            out.append(
                EmployeeLeaveBalanceRead(
                    id=bal.id,
                    employee_id=employee_id,
                    employee_name=emp_name,
                    employee_code=user.employee_code,
                    branch=branch,
                    department=department,
                    leave_type_id=lt.id,
                    leave_type_name=lt.name,
                    leave_type_code=lt.code,
                    year=bal.year,
                    allocated=bal.allocated,
                    consumed=bal.consumed,
                    adjusted=bal.adjusted,
                    available=avail_val,
                    created_at=bal.created_at,
                    updated_at=bal.updated_at,
                )
            )
        out.sort(key=lambda x: x.leave_type_name)
        return out

    # -----------------------------------------------------------------------
    # Leave Adjustment Matrix Screen
    # -----------------------------------------------------------------------
    # Leave Adjustment Matrix Screen
    # -----------------------------------------------------------------------
    async def get_leave_adjustment_matrix(
        self,
        year: int = 2026,
        search: Optional[str] = None,
        department: Optional[str] = None,
        branch: Optional[str] = None,
        employee_id: Optional[uuid.UUID] = None,
        user_id: Optional[uuid.UUID] = None,
        is_admin: bool = True,
    ) -> List[EmployeeLeaveAdjustmentRow]:
        """
        Generates employee-wise balance matrix for Leave Adjustment screen with role scoping.
        """
        await self.ensure_seeds()

        # Role scoping
        if not is_admin and user_id:
            user_is_admin = await self.is_user_admin(user_id)
            if not user_is_admin:
                managed_ids = await self.get_managed_employee_ids(user_id)
                perm_codes = (
                    await self.db.scalars(
                        select(Permission.code)
                        .join(RolePermission, RolePermission.permission_id == Permission.id)
                        .join(UserRole, UserRole.role_id == RolePermission.role_id)
                        .where(UserRole.user_id == user_id)
                    )
                ).all()
                perm_set = set(perm_codes)
                can_adjust = any(p in perm_set for p in ("hrms.adjust", "hrms.manage", "hrms:admin", "hrms.approve"))
                if not can_adjust and managed_ids == {user_id}:
                    raise HTTPException(
                        status_code=403,
                        detail="Employees cannot access organization-wide Leave Adjustment.",
                    )
                emp_query = (
                    select(User)
                    .where(
                        User.id.in_(managed_ids),
                        User.deleted_at.is_(None),
                        User.is_active.is_(True),
                    )
                    .order_by(User.first_name.asc(), User.last_name.asc())
                )
            else:
                emp_query = (
                    select(User)
                    .where(User.deleted_at.is_(None), User.is_active.is_(True))
                    .order_by(User.first_name.asc(), User.last_name.asc())
                )
        else:
            emp_query = (
                select(User)
                .where(User.deleted_at.is_(None), User.is_active.is_(True))
                .order_by(User.first_name.asc(), User.last_name.asc())
            )

        if employee_id:
            emp_query = emp_query.where(User.id == employee_id)

        all_employees = (await self.db.scalars(emp_query)).all()

        # Pre-filter search in memory
        filtered_employees: List[User] = []
        for emp in all_employees:
            emp_name = emp.display_name or f"{emp.first_name or ''} {emp.last_name or ''}".strip() or emp.username or "Employee"
            if search:
                s = search.lower()
                code = (emp.employee_code or "").lower()
                if s not in emp_name.lower() and s not in code:
                    continue
            filtered_employees.append(emp)

        if not filtered_employees:
            return []

        # 1. Batch load all active leave types
        all_lts = (
            await self.db.scalars(
                select(HrmsLeaveType).where(
                    HrmsLeaveType.deleted_at.is_(None),
                    HrmsLeaveType.is_active.is_(True),
                )
            )
        ).all()
        lt_map = {lt.id: lt for lt in all_lts}

        # 2. Batch load all existing balances for filtered employees in one query
        emp_ids = [e.id for e in filtered_employees]
        existing_balances = (
            await self.db.scalars(
                select(HrmsEmployeeLeaveBalance).where(
                    HrmsEmployeeLeaveBalance.employee_id.in_(emp_ids),
                    HrmsEmployeeLeaveBalance.year == year,
                )
            )
        ).all()

        bal_by_emp_lt = {(b.employee_id, b.leave_type_id): b for b in existing_balances}
        to_create: List[HrmsEmployeeLeaveBalance] = []

        for emp in filtered_employees:
            for lt in all_lts:
                if (emp.id, lt.id) not in bal_by_emp_lt:
                    new_bal = HrmsEmployeeLeaveBalance(
                        employee_id=emp.id,
                        leave_type_id=lt.id,
                        year=year,
                        allocated=lt.annual_balance,
                        consumed=0.0,
                        adjusted=0.0,
                        available=lt.annual_balance,
                    )
                    to_create.append(new_bal)
                    bal_by_emp_lt[(emp.id, lt.id)] = new_bal

        if to_create:
            self.db.add_all(to_create)
            await self.db.commit()

        # Batch load departments for all filtered employees
        role_links = (
            await self.db.execute(
                select(UserRole.user_id, Role.name, Role.is_system, UserRole.is_primary)
                .join(Role, Role.id == UserRole.role_id)
                .where(
                    UserRole.user_id.in_(emp_ids),
                    Role.deleted_at.is_(None),
                )
                .order_by(
                    Role.is_system.asc(),
                    UserRole.is_primary.desc(),
                )
            )
        ).all()
        dept_by_emp: dict[uuid.UUID, str] = {}
        for uid, rname, _, _ in role_links:
            if uid not in dept_by_emp:
                display_rname = "Admin" if rname == "super_admin" else ("User" if rname == "user" else rname)
                dept_by_emp[uid] = display_rname

        # Batch load branch/locations for all filtered employees
        loc_links = (
            await self.db.execute(
                select(HrmsEmployeeLocation.user_id, HrmsLocation.name, HrmsEmployeeLocation.is_primary)
                .join(HrmsLocation, HrmsLocation.id == HrmsEmployeeLocation.location_id)
                .where(
                    HrmsEmployeeLocation.user_id.in_(emp_ids),
                    HrmsLocation.deleted_at.is_(None),
                )
                .order_by(HrmsEmployeeLocation.is_primary.desc())
            )
        ).all()
        branch_by_emp: dict[uuid.UUID, str] = {}
        for uid, lname, _ in loc_links:
            if uid not in branch_by_emp:
                branch_by_emp[uid] = lname

        out: List[EmployeeLeaveAdjustmentRow] = []
        for emp in filtered_employees:
            emp_name = emp.display_name or f"{emp.first_name or ''} {emp.last_name or ''}".strip() or emp.username or "Employee"
            emp_dept = dept_by_emp.get(emp.id) or "Unassigned"
            emp_branch = branch_by_emp.get(emp.id) or (emp.city if emp.city else "All Branches")

            if department and department.upper() != "ALL":
                target_dept = department.lower().strip()
                emp_dept_lower = emp_dept.lower().strip()
                is_dept_match = (
                    emp_dept_lower == target_dept
                    or (target_dept in ("admin", "super_admin") and emp_dept_lower in ("admin", "super_admin"))
                    or (target_dept in ("user") and emp_dept_lower in ("user"))
                )
                if not is_dept_match:
                    continue

            if branch and branch.upper() != "ALL" and emp_branch.lower() != branch.lower():
                continue

            bal_dict: dict[str, LeaveBalanceSummary] = {}
            for lt in all_lts:
                b = bal_by_emp_lt.get((emp.id, lt.id))
                if not b:
                    continue
                available_val = b.available if b.available is not None else round(b.allocated + b.adjusted - b.consumed, 2)
                summary = LeaveBalanceSummary(
                    allocated=b.allocated,
                    consumed=b.consumed,
                    adjusted=b.adjusted,
                    available=available_val,
                    total_leave=round(b.allocated + b.adjusted, 2),
                )
                bal_dict[str(lt.id)] = summary
                bal_dict[lt.name] = summary

            out.append(
                EmployeeLeaveAdjustmentRow(
                    employee_id=emp.id,
                    employee_name=emp_name,
                    employee_code=emp.employee_code,
                    branch=emp_branch,
                    department=emp_dept,
                    balances=bal_dict,
                )
            )
        return out

    async def create_adjustment(
        self, payload: LeaveAdjustmentCreate, adjusted_by: Optional[uuid.UUID] = None
    ) -> LeaveAdjustmentHistoryRead:
        """
        Modifies employee leave balance and records non-destructive audit history.
        available = allocated + adjusted - consumed
        """
        if not payload.reason or not payload.reason.strip():
            raise HTTPException(status_code=400, detail="A reason is required for every manual balance adjustment.")

        # Ensure employee balance exists
        await self.get_or_create_employee_balances(payload.employee_id, year=payload.year)

        balance = await self.db.scalar(
            select(HrmsEmployeeLeaveBalance).where(
                HrmsEmployeeLeaveBalance.employee_id == payload.employee_id,
                HrmsEmployeeLeaveBalance.leave_type_id == payload.leave_type_id,
                HrmsEmployeeLeaveBalance.year == payload.year,
            )
        )
        if not balance:
            lt = await self.get_leave_type(payload.leave_type_id)
            balance = HrmsEmployeeLeaveBalance(
                employee_id=payload.employee_id,
                leave_type_id=payload.leave_type_id,
                year=payload.year,
                allocated=lt.annual_balance if lt else 0.0,
                consumed=0.0,
                adjusted=0.0,
                available=lt.annual_balance if lt else 0.0,
            )
            self.db.add(balance)
            await self.db.flush()

        prev_available = balance.available
        adj_type = payload.adjustment_type.upper().strip()

        if adj_type in ("ADD", "CREDIT", "MANUAL_CREDIT"):
            delta = abs(payload.amount)
            audit_type = "MANUAL_CREDIT" if "CREDIT" in adj_type else "ADD"
        elif adj_type in ("DEDUCT", "DEBIT", "MANUAL_DEBIT"):
            delta = -abs(payload.amount)
            audit_type = "MANUAL_DEBIT" if "DEBIT" in adj_type else "DEDUCT"
        elif adj_type == "CORRECTION":
            # Target is payload.amount
            delta = payload.amount - prev_available
            audit_type = "CORRECTION"
        else:
            raise HTTPException(
                status_code=400,
                detail="Invalid adjustment type. Must be 'ADD', 'CREDIT', 'DEDUCT', 'DEBIT', or 'CORRECTION'.",
            )

        # Check negative balance restriction
        lt = await self.get_leave_type(payload.leave_type_id)
        if delta < 0 and lt and not getattr(lt, "allow_negative_balance", False):
            if round(prev_available + delta, 2) < 0:
                raise HTTPException(
                    status_code=400,
                    detail=f"Negative balance is not allowed for {lt.name}. Current available is {prev_available}, cannot deduct {abs(delta)}.",
                )

        balance.adjusted = round(balance.adjusted + delta, 2)
        new_available = round(balance.allocated + balance.adjusted - balance.consumed, 2)
        balance.available = new_available

        audit = HrmsLeaveAdjustment(
            employee_id=payload.employee_id,
            leave_type_id=payload.leave_type_id,
            adjustment_type=audit_type,
            amount=delta,
            previous_balance=prev_available,
            new_balance=new_available,
            reason=payload.reason.strip(),
            remarks=payload.remarks.strip() if payload.remarks else None,
            source="MANUAL",
            effective_date=payload.effective_date or date.today(),
            adjusted_by=adjusted_by,
        )
        self.db.add(audit)
        await self.db.commit()
        await self.db.refresh(audit)

        emp = await self.db.scalar(select(User).where(User.id == payload.employee_id))
        adj_user = await self.db.scalar(select(User).where(User.id == adjusted_by)) if adjusted_by else None

        emp_name = (
            emp.display_name
            or f"{emp.first_name or ''} {emp.last_name or ''}".strip()
            or emp.username
            or "Employee"
        ) if emp else "Employee"

        return LeaveAdjustmentHistoryRead(
            id=audit.id,
            employee_id=audit.employee_id,
            employee_name=emp_name,
            leave_type_id=audit.leave_type_id,
            leave_type_name=lt.name if lt else "Leave",
            adjustment_type=audit.adjustment_type,
            amount=audit.amount,
            previous_balance=audit.previous_balance,
            new_balance=audit.new_balance,
            reason=audit.reason,
            remarks=audit.remarks,
            source=audit.source,
            effective_date=audit.effective_date,
            adjusted_by=audit.adjusted_by,
            adjusted_by_name=adj_user.display_name if adj_user else "Admin",
            created_at=audit.created_at,
        )

    async def get_adjustment_history(
        self,
        employee_id: Optional[uuid.UUID] = None,
        leave_type_id: Optional[uuid.UUID] = None,
        limit: int = 200,
    ) -> List[LeaveAdjustmentHistoryRead]:
        query = (
            select(HrmsLeaveAdjustment)
            .order_by(HrmsLeaveAdjustment.created_at.desc())
            .limit(limit)
        )
        if employee_id:
            query = query.where(HrmsLeaveAdjustment.employee_id == employee_id)
        if leave_type_id:
            query = query.where(HrmsLeaveAdjustment.leave_type_id == leave_type_id)

        audits = (await self.db.scalars(query)).all()
        if not audits:
            return []

        emp_ids = {a.employee_id for a in audits}
        emps = (await self.db.scalars(select(User).where(User.id.in_(emp_ids)))).all()
        emp_names = {
            e.id: (e.display_name or f"{e.first_name or ''} {e.last_name or ''}".strip() or e.username or "Employee")
            for e in emps
        }

        lt_ids = {a.leave_type_id for a in audits}
        lts = (await self.db.scalars(select(HrmsLeaveType).where(HrmsLeaveType.id.in_(lt_ids)))).all()
        lt_names = {lt.id: lt.name for lt in lts}

        user_ids = {a.adjusted_by for a in audits if a.adjusted_by}
        user_names: dict[uuid.UUID, str] = {}
        if user_ids:
            users = (await self.db.scalars(select(User).where(User.id.in_(user_ids)))).all()
            user_names = {u.id: (u.display_name or u.username or "Admin") for u in users}

        return [
            LeaveAdjustmentHistoryRead(
                id=a.id,
                employee_id=a.employee_id,
                employee_name=emp_names.get(a.employee_id, "Employee"),
                leave_type_id=a.leave_type_id,
                leave_type_name=lt_names.get(a.leave_type_id, "Leave"),
                adjustment_type=a.adjustment_type,
                amount=a.amount,
                previous_balance=a.previous_balance,
                new_balance=a.new_balance,
                reason=a.reason,
                remarks=a.remarks,
                source=a.source or "MANUAL",
                effective_date=a.effective_date,
                adjusted_by=a.adjusted_by,
                adjusted_by_name=user_names.get(a.adjusted_by, "Admin") if a.adjusted_by else "Admin",
                created_at=a.created_at,
            )
            for a in audits
        ]

    # -----------------------------------------------------------------------
    # Leave Requests & Approvals
    # -----------------------------------------------------------------------
    async def create_leave_request(
        self, employee_id: uuid.UUID, payload: LeaveRequestCreate, user_id: uuid.UUID
    ) -> LeaveRequestRead:
        if payload.from_date > payload.to_date:
            raise HTTPException(status_code=400, detail="From Date cannot be after To Date.")

        # Validate that leave type is applicable to the employee's active leave plan
        applicable_types = await self.get_applicable_leave_types(employee_id, target_date=payload.from_date)
        applicable_ids = {t.id for t in applicable_types}
        if payload.leave_type_id not in applicable_ids:
            raise HTTPException(
                status_code=400,
                detail="This leave type is not currently available under your active leave plan.",
            )

        # Overlapping leave validation
        overlap_res = await self.db.execute(
            select(HrmsLeaveRequest).where(
                HrmsLeaveRequest.employee_id == employee_id,
                HrmsLeaveRequest.status.in_(["PENDING", "APPROVED"]),
                HrmsLeaveRequest.from_date <= payload.to_date,
                HrmsLeaveRequest.to_date >= payload.from_date,
            )
        )
        if overlap_res.scalar_one_or_none():
            raise HTTPException(
                status_code=400,
                detail="You already have an overlapping leave request covering part of this period.",
            )

        num_days = await self.calculate_leave_days(
            payload.from_date, payload.to_date, employee_id=employee_id, leave_type_id=payload.leave_type_id
        )

        lt = await self.get_leave_type(payload.leave_type_id)

        # Configurable leave rules validation
        is_admin_caller = await self.is_user_admin(user_id)
        if not is_admin_caller:
            today = date.today()
            if getattr(lt, "allow_backdated", True) is False and payload.from_date < today:
                raise HTTPException(
                    status_code=400,
                    detail=f"Backdated leave requests are not permitted for {lt.name}.",
                )
            if getattr(lt, "min_notice_days", 0) > 0 and (payload.from_date - today).days < lt.min_notice_days:
                raise HTTPException(
                    status_code=400,
                    detail=f"Minimum {lt.min_notice_days} days advance notice is required for {lt.name}.",
                )
            if getattr(lt, "require_attachment", False) and not payload.attachment:
                raise HTTPException(
                    status_code=400,
                    detail=f"Supporting document attachment is required for {lt.name}.",
                )

        # Validate available balance for paid leave
        if lt.is_paid and not getattr(lt, "allow_negative_balance", False):
            balances = await self.get_or_create_employee_balances(employee_id, year=payload.from_date.year)
            cur_bal = next((b for b in balances if b.leave_type_id == payload.leave_type_id), None)
            cur_available = cur_bal.available if cur_bal else 0.0
            if cur_available < num_days:
                avail_disp = int(cur_available) if cur_available.is_integer() else cur_available
                raise HTTPException(
                    status_code=400,
                    detail=f"Insufficient {lt.name} balance. Available: {avail_disp} days.",
                )

        req = HrmsLeaveRequest(
            employee_id=employee_id,
            leave_type_id=payload.leave_type_id,
            from_date=payload.from_date,
            to_date=payload.to_date,
            number_of_days=num_days,
            reason=payload.reason.strip(),
            attachment=payload.attachment,
            status="PENDING",
            approval_status="PENDING",
            created_by=user_id,
            updated_by=user_id,
        )
        self.db.add(req)
        await self.db.commit()
        await self.db.refresh(req)

        return await self._to_leave_request_read(req)

    async def get_leave_request(self, request_id: uuid.UUID) -> LeaveRequestRead:
        req = await self.db.scalar(select(HrmsLeaveRequest).where(HrmsLeaveRequest.id == request_id))
        if not req:
            raise HTTPException(status_code=404, detail="Leave request not found.")
        return await self._to_leave_request_read(req)

    async def list_leave_requests(
        self, employee_id: Optional[uuid.UUID] = None, status_filter: Optional[str] = None
    ) -> List[LeaveRequestRead]:
        query = select(HrmsLeaveRequest).order_by(HrmsLeaveRequest.created_at.desc())
        if employee_id:
            query = query.where(HrmsLeaveRequest.employee_id == employee_id)
        if status_filter and status_filter.upper() != "ALL":
            query = query.where(HrmsLeaveRequest.status == status_filter.upper())

        requests = (await self.db.scalars(query)).all()
        return [await self._to_leave_request_read(r) for r in requests]

    async def is_user_admin(self, user_id: uuid.UUID) -> bool:
        user = await self.db.scalar(select(User).where(User.id == user_id))
        if not user:
            return False
        uname = (user.username or "").lower()
        if getattr(user, "is_super_admin", False) or uname in ("admin", "super_admin") or uname.startswith("admin"):
            return True
        # Check permissions via user's roles
        perm_codes = (
            await self.db.scalars(
                select(Permission.code)
                .join(RolePermission, RolePermission.permission_id == Permission.id)
                .join(UserRole, UserRole.role_id == RolePermission.role_id)
                .where(UserRole.user_id == user_id)
            )
        ).all()
        perm_set = set(perm_codes)
        if any(p in perm_set for p in ("*", "hrms.manage", "hrms:admin")):
            return True
        # Check role names
        role_names = (
            await self.db.scalars(
                select(Role.name)
                .join(UserRole, UserRole.role_id == Role.id)
                .where(UserRole.user_id == user_id)
            )
        ).all()
        if any(r.lower() in ("admin", "super_admin", "super admin", "hrms admin") for r in role_names):
            return True
        return False

    async def is_user_authorized_to_adjust(self, user_id: uuid.UUID) -> bool:
        if await self.is_user_admin(user_id):
            return True
        perm_codes = (
            await self.db.scalars(
                select(Permission.code)
                .join(RolePermission, RolePermission.permission_id == Permission.id)
                .join(UserRole, UserRole.role_id == RolePermission.role_id)
                .where(UserRole.user_id == user_id)
            )
        ).all()
        perm_set = set(perm_codes)
        return any(p in perm_set for p in ("hrms.adjust", "hrms.manage", "hrms:admin"))

    async def get_managed_employee_ids(self, manager_user_id: uuid.UUID) -> set[uuid.UUID]:
        """Return IDs of employees reporting to this manager or in their department."""
        direct_reports = (
            await self.db.scalars(
                select(User.id).where(User.manager_id == manager_user_id, User.deleted_at.is_(None))
            )
        ).all()
        managed_ids = set(direct_reports)

        _, dept = await self.get_employee_org_context(manager_user_id)
        if dept and dept.lower() != "general":
            dept_roles = (
                await self.db.scalars(
                    select(Role.id).where(func.lower(Role.name) == dept.lower())
                )
            ).all()
            if dept_roles:
                dept_users = (
                    await self.db.scalars(
                        select(UserRole.user_id).where(UserRole.role_id.in_(dept_roles))
                    )
                ).all()
                managed_ids.update(dept_users)

        managed_ids.add(manager_user_id)
        return managed_ids

    async def is_reviewer_authorized_for_employee(self, reviewer_id: uuid.UUID, employee_id: uuid.UUID) -> bool:
        emp = await self.db.scalar(select(User).where(User.id == employee_id))
        if emp and emp.manager_id == reviewer_id:
            return True
        managed_ids = await self.get_managed_employee_ids(reviewer_id)
        if employee_id in managed_ids:
            return True
        perm_codes = (
            await self.db.scalars(
                select(Permission.code)
                .join(RolePermission, RolePermission.permission_id == Permission.id)
                .join(UserRole, UserRole.role_id == RolePermission.role_id)
                .where(UserRole.user_id == reviewer_id)
            )
        ).all()
        perm_set = set(perm_codes)
        if any(p in perm_set for p in ("hrms.approve", "hrms:approval", "hrms.manage")):
            return True
        return False

    async def list_leave_approvals(
        self,
        employee_id: Optional[uuid.UUID] = None,
        leave_type_id: Optional[uuid.UUID] = None,
        status_filter: Optional[str] = None,
        from_date: Optional[date] = None,
        to_date: Optional[date] = None,
        reviewer_id: Optional[uuid.UUID] = None,
        is_admin: bool = True,
    ) -> List[LeaveRequestRead]:
        query = select(HrmsLeaveRequest).order_by(HrmsLeaveRequest.created_at.desc())

        # If not organization admin, filter by manager scope
        if not is_admin and reviewer_id:
            reviewer_is_admin = await self.is_user_admin(reviewer_id)
            if not reviewer_is_admin:
                managed_ids = await self.get_managed_employee_ids(reviewer_id)
                query = query.where(HrmsLeaveRequest.employee_id.in_(managed_ids))

        if employee_id:
            query = query.where(HrmsLeaveRequest.employee_id == employee_id)
        if leave_type_id:
            query = query.where(HrmsLeaveRequest.leave_type_id == leave_type_id)
        if status_filter and status_filter.upper() != "ALL":
            query = query.where(HrmsLeaveRequest.approval_status == status_filter.upper())
        if from_date:
            query = query.where(HrmsLeaveRequest.to_date >= from_date)
        if to_date:
            query = query.where(HrmsLeaveRequest.from_date <= to_date)

        requests = (await self.db.scalars(query)).all()
        return [await self._to_leave_request_read(r) for r in requests]

    async def approve_leave_request(
        self,
        request_id: uuid.UUID,
        reviewer_id: uuid.UUID,
        remarks: Optional[str] = None,
        is_admin: Optional[bool] = None,
    ) -> LeaveRequestRead:
        req = await self.db.scalar(select(HrmsLeaveRequest).where(HrmsLeaveRequest.id == request_id))
        if not req:
            raise HTTPException(status_code=404, detail="Leave request not found.")

        # Check admin or authorization
        if is_admin is not None:
            reviewer_is_admin = is_admin
        else:
            reviewer_is_admin = await self.is_user_admin(reviewer_id)

        if not reviewer_is_admin:
            # Non-admin cannot self-approve
            if req.employee_id == reviewer_id:
                raise HTTPException(status_code=400, detail="Employees cannot approve their own leave request.")
            # Verify manager authorization for this employee
            is_authorized = await self.is_reviewer_authorized_for_employee(reviewer_id, req.employee_id)
            if not is_authorized:
                raise HTTPException(status_code=403, detail="You do not have permission to approve this leave request.")

        if req.approval_status == "APPROVED":
            return await self._to_leave_request_read(req)

        # Deduct balance on approval: increase consumed
        balances = await self.get_or_create_employee_balances(req.employee_id, year=req.from_date.year)
        bal = next((b for b in balances if b.leave_type_id == req.leave_type_id), None)
        if bal:
            raw_bal = await self.db.scalar(
                select(HrmsEmployeeLeaveBalance).where(HrmsEmployeeLeaveBalance.id == bal.id)
            )
            if raw_bal:
                lt = await self.get_leave_type(req.leave_type_id)
                new_avail = round(raw_bal.allocated + raw_bal.adjusted - (raw_bal.consumed + req.number_of_days), 2)
                if lt and not getattr(lt, "allow_negative_balance", False) and new_avail < 0:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Approval would result in negative leave balance ({new_avail}) for {lt.name}, which is not permitted.",
                    )
                prev_available = raw_bal.available
                raw_bal.consumed = round(raw_bal.consumed + req.number_of_days, 2)
                raw_bal.available = round(raw_bal.allocated + raw_bal.adjusted - raw_bal.consumed, 2)

                audit = HrmsLeaveAdjustment(
                    employee_id=req.employee_id,
                    leave_type_id=req.leave_type_id,
                    adjustment_type="LEAVE_APPROVED",
                    amount=-req.number_of_days,
                    previous_balance=prev_available,
                    new_balance=raw_bal.available,
                    reason=f"Leave Request #{req.id} approved ({req.number_of_days} days)",
                    remarks=remarks,
                    source="LEAVE_APPROVAL",
                    effective_date=req.from_date,
                    adjusted_by=reviewer_id,
                )
                self.db.add(audit)

        req.approval_status = "APPROVED"
        req.status = "APPROVED"
        req.approved_by = reviewer_id
        req.approval_remarks = remarks
        req.updated_by = reviewer_id
        await self.db.commit()
        await self.db.refresh(req)
        return await self._to_leave_request_read(req)

    async def reject_leave_request(
        self,
        request_id: uuid.UUID,
        reviewer_id: uuid.UUID,
        remarks: Optional[str] = None,
        is_admin: Optional[bool] = None,
    ) -> LeaveRequestRead:
        req = await self.db.scalar(select(HrmsLeaveRequest).where(HrmsLeaveRequest.id == request_id))
        if not req:
            raise HTTPException(status_code=404, detail="Leave request not found.")

        if is_admin is not None:
            reviewer_is_admin = is_admin
        else:
            reviewer_is_admin = await self.is_user_admin(reviewer_id)

        if not reviewer_is_admin:
            if req.employee_id == reviewer_id:
                raise HTTPException(status_code=400, detail="Employees cannot reject their own leave request.")
            is_authorized = await self.is_reviewer_authorized_for_employee(reviewer_id, req.employee_id)
            if not is_authorized:
                raise HTTPException(status_code=403, detail="You do not have permission to reject this leave request.")

        # If previously APPROVED, reverse consumed balance
        if req.approval_status == "APPROVED":
            raw_bal = await self.db.scalar(
                select(HrmsEmployeeLeaveBalance).where(
                    HrmsEmployeeLeaveBalance.employee_id == req.employee_id,
                    HrmsEmployeeLeaveBalance.leave_type_id == req.leave_type_id,
                    HrmsEmployeeLeaveBalance.year == req.from_date.year,
                )
            )
            if raw_bal:
                prev_available = raw_bal.available
                raw_bal.consumed = max(0.0, round(raw_bal.consumed - req.number_of_days, 2))
                raw_bal.available = round(raw_bal.allocated + raw_bal.adjusted - raw_bal.consumed, 2)

                reversal_audit = HrmsLeaveAdjustment(
                    employee_id=req.employee_id,
                    leave_type_id=req.leave_type_id,
                    adjustment_type="LEAVE_REVERSED",
                    amount=req.number_of_days,
                    previous_balance=prev_available,
                    new_balance=raw_bal.available,
                    reason=f"Reversal of approved Leave Request #{req.id} (Rejected)",
                    remarks=remarks,
                    source="LEAVE_REVERSAL",
                    effective_date=req.from_date,
                    adjusted_by=reviewer_id,
                )
                self.db.add(reversal_audit)

        req.approval_status = "REJECTED"
        req.status = "REJECTED"
        req.approved_by = reviewer_id
        req.approval_remarks = remarks
        req.updated_by = reviewer_id
        await self.db.commit()
        await self.db.refresh(req)
        return await self._to_leave_request_read(req)

    async def cancel_leave_request(
        self, request_id: uuid.UUID, user_id: uuid.UUID, is_admin: bool = False
    ) -> LeaveRequestRead:
        req = await self.db.scalar(select(HrmsLeaveRequest).where(HrmsLeaveRequest.id == request_id))
        if not req:
            raise HTTPException(status_code=404, detail="Leave request not found.")

        user_is_admin = is_admin or (await self.is_user_admin(user_id))
        if not user_is_admin and req.employee_id != user_id:
            raise HTTPException(status_code=403, detail="You cannot cancel another employee's leave request.")

        if req.status == "CANCELLED":
            return await self._to_leave_request_read(req)

        # Employee cannot cancel APPROVED request (Section 18 & Test 13), Admin CAN cancel
        if not user_is_admin and req.status == "APPROVED":
            raise HTTPException(status_code=400, detail="Cannot cancel an approved leave request.")

        # If previously approved, restore consumed balance
        if req.approval_status == "APPROVED":
            raw_bal = await self.db.scalar(
                select(HrmsEmployeeLeaveBalance).where(
                    HrmsEmployeeLeaveBalance.employee_id == req.employee_id,
                    HrmsEmployeeLeaveBalance.leave_type_id == req.leave_type_id,
                    HrmsEmployeeLeaveBalance.year == req.from_date.year,
                )
            )
            if raw_bal:
                prev_available = raw_bal.available
                raw_bal.consumed = max(0.0, round(raw_bal.consumed - req.number_of_days, 2))
                raw_bal.available = round(raw_bal.allocated + raw_bal.adjusted - raw_bal.consumed, 2)

                reversal_audit = HrmsLeaveAdjustment(
                    employee_id=req.employee_id,
                    leave_type_id=req.leave_type_id,
                    adjustment_type="LEAVE_REVERSED",
                    amount=req.number_of_days,
                    previous_balance=prev_available,
                    new_balance=raw_bal.available,
                    reason=f"Reversal of approved Leave Request #{req.id} (Cancelled)",
                    remarks=None,
                    source="LEAVE_REVERSAL",
                    effective_date=req.from_date,
                    adjusted_by=user_id,
                )
                self.db.add(reversal_audit)

        req.status = "CANCELLED"
        req.approval_status = "CANCELLED"
        req.updated_by = user_id
        await self.db.commit()
        await self.db.refresh(req)
        return await self._to_leave_request_read(req)

    async def evaluate_attendance_based_accrual(
        self, employee_id: Optional[uuid.UUID] = None, year: int = 2026, month: int = 10
    ) -> dict:
        """
        Evaluate configurable attendance-based leave accrual (e.g. +1 extra leave for full month present).
        Creates audit records in HrmsLeaveAdjustment.
        """
        import calendar
        from app.hrms.models import HrmsAttendance

        _, num_days = calendar.monthrange(year, month)
        start_date = date(year, month, 1)
        end_date = date(year, month, num_days)

        lts = (
            await self.db.scalars(
                select(HrmsLeaveType).where(
                    HrmsLeaveType.deleted_at.is_(None),
                    HrmsLeaveType.is_active.is_(True),
                    HrmsLeaveType.attendance_based_accrual.is_(True),
                )
            )
        ).all()
        if not lts:
            return {"status": "success", "message": "No leave types configured for attendance-based accrual.", "awarded_count": 0}

        if employee_id:
            emp_ids = [employee_id]
        else:
            all_users = (
                await self.db.scalars(
                    select(User.id).where(User.is_active.is_(True), User.deleted_at.is_(None))
                )
            ).all()
            emp_ids = list(all_users)

        policy_res = await self.db.execute(select(HrmsAttendancePolicy).limit(1))
        policy = policy_res.scalar_one_or_none()
        weekly_off_raw = (policy.weekly_off if policy else "Sunday").strip()
        weekly_off_days = {d.strip().capitalize() for d in weekly_off_raw.split(",") if d.strip()} or {"Sunday"}

        holidays_res = await self.db.execute(
            select(HrmsHoliday).where(
                HrmsHoliday.deleted_at.is_(None),
                HrmsHoliday.is_active.is_(True),
                HrmsHoliday.holiday_date >= start_date,
                HrmsHoliday.holiday_date <= end_date,
            )
        )
        holidays = holidays_res.scalars().all()
        holiday_dates = {h.holiday_date for h in holidays}

        working_days = 0
        cur = start_date
        while cur <= end_date:
            if cur.strftime("%A") not in weekly_off_days and cur not in holiday_dates:
                working_days += 1
            cur += timedelta(days=1)

        awarded_total = 0
        details = []

        for eid in emp_ids:
            _, dept = await self.get_employee_org_context(eid)
            att_records = (
                await self.db.scalars(
                    select(HrmsAttendance).where(
                        HrmsAttendance.employee_id == eid,
                        HrmsAttendance.attendance_date >= start_date,
                        HrmsAttendance.attendance_date <= end_date,
                    )
                )
            ).all()
            present_days = sum(
                1 for r in att_records if r.status in ("PRESENT", "LATE") or (r.punch_in is not None and r.status != "ABSENT")
            )
            half_days = sum(0.5 for r in att_records if r.status == "HALF_DAY")
            effective_present = present_days + half_days
            attendance_pct = (effective_present / working_days * 100.0) if working_days > 0 else 0.0

            for lt in lts:
                app_depts = (lt.attendance_based_departments or "ALL").strip()
                if app_depts.upper() != "ALL":
                    dept_list = [d.strip().lower() for d in app_depts.split(",") if d.strip()]
                    if dept.lower() not in dept_list:
                        continue

                condition = (lt.attendance_based_condition or "FULL_MONTH_PRESENT").strip().upper()
                is_eligible = False
                if condition == "FULL_MONTH_PRESENT":
                    is_eligible = (effective_present >= working_days and working_days > 0)
                elif condition == "MIN_PERCENTAGE":
                    min_pct = lt.min_attendance_percentage or 100.0
                    is_eligible = (attendance_pct >= min_pct)
                elif condition == "MIN_DAYS":
                    min_d = lt.min_working_days or working_days
                    is_eligible = (effective_present >= min_d)

                if is_eligible:
                    reward = lt.attendance_based_reward if (lt.attendance_based_reward and lt.attendance_based_reward > 0) else 1.0
                    existing_adj = await self.db.scalar(
                        select(HrmsLeaveAdjustment).where(
                            HrmsLeaveAdjustment.employee_id == eid,
                            HrmsLeaveAdjustment.leave_type_id == lt.id,
                            HrmsLeaveAdjustment.reason.like(f"%Attendance-based accrual for {year}-{month:02d}%"),
                        )
                    )
                    if not existing_adj:
                        balances = await self.get_or_create_employee_balances(eid, year=year)
                        bal = next((b for b in balances if b.leave_type_id == lt.id), None)
                        prev_bal = bal.available if bal else 0.0
                        new_bal = prev_bal + reward

                        raw_bal = await self.db.scalar(
                            select(HrmsEmployeeLeaveBalance).where(
                                HrmsEmployeeLeaveBalance.employee_id == eid,
                                HrmsEmployeeLeaveBalance.leave_type_id == lt.id,
                                HrmsEmployeeLeaveBalance.year == year,
                            )
                        )
                        if raw_bal:
                            raw_bal.accrued = round(raw_bal.accrued + reward, 2)

                        adj = HrmsLeaveAdjustment(
                            employee_id=eid,
                            leave_type_id=lt.id,
                            adjustment_type="CREDIT",
                            amount=reward,
                            previous_balance=prev_bal,
                            new_balance=new_bal,
                            reason=f"Attendance-based accrual for {year}-{month:02d} ({condition})",
                            adjusted_by=None,
                        )
                        self.db.add(adj)
                        awarded_total += 1
                        details.append({"employee_id": str(eid), "leave_type": lt.name, "reward_days": reward})

        await self.db.commit()
        return {
            "status": "success",
            "message": f"Evaluated attendance accrual. {awarded_total} rewards awarded.",
            "awarded_count": awarded_total,
            "details": details,
        }

    async def _to_leave_request_read(self, req: HrmsLeaveRequest) -> LeaveRequestRead:
        emp = await self.db.scalar(select(User).where(User.id == req.employee_id))
        lt = await self.db.scalar(select(HrmsLeaveType).where(HrmsLeaveType.id == req.leave_type_id))

        user_ids = {u for u in [req.created_by, req.updated_by, req.approved_by] if u}
        user_names: dict[uuid.UUID, str] = {}
        if user_ids:
            users = (await self.db.scalars(select(User).where(User.id.in_(user_ids)))).all()
            user_names = {u.id: (u.display_name or f"{u.first_name or ''} {u.last_name or ''}".strip() or u.username or "User") for u in users}

        branch, dept = await self.get_employee_org_context(req.employee_id)
        emp_name = (
            emp.display_name
            or f"{emp.first_name or ''} {emp.last_name or ''}".strip()
            or emp.username
            or "Employee"
        ) if emp else "Employee"

        return LeaveRequestRead(
            id=req.id,
            employee_id=req.employee_id,
            employee_name=emp_name,
            employee_code=emp.employee_code if emp else None,
            branch=branch,
            department=dept,
            leave_type_id=req.leave_type_id,
            leave_type_name=lt.name if lt else "Leave",
            leave_type_code=lt.code if lt else None,
            from_date=req.from_date,
            to_date=req.to_date,
            number_of_days=req.number_of_days,
            reason=req.reason,
            attachment=req.attachment,
            status=req.status,
            approval_status=req.approval_status,
            created_by=req.created_by,
            created_by_name=user_names.get(req.created_by) if req.created_by else None,
            updated_by=req.updated_by,
            updated_by_name=user_names.get(req.updated_by) if req.updated_by else None,
            approved_by=req.approved_by,
            approved_by_name=user_names.get(req.approved_by) if req.approved_by else None,
            approval_remarks=req.approval_remarks,
            created_at=req.created_at,
            updated_at=req.updated_at,
        )
