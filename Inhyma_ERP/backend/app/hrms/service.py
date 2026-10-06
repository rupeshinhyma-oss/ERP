"""
HRMS Setup Service Layer.

Handles business logic, database queries, and automatic idempotent seed data
initialization for:
- Office Locations (Geofencing parameters)
- Leave Types & Entitlements
- Expense Categories
- Expense Approval Workflow & Claim Rules
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import List, Optional

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import NotFoundException
from app.hrms.models import (
    HrmsEmployeeLocation,
    HrmsExpenseCategory,
    HrmsExpenseSettings,
    HrmsLeaveType,
    HrmsLocation,
)
from app.hrms.schemas import (
    ExpenseCategoryCreate,
    ExpenseCategoryUpdate,
    ExpenseSettingsUpdate,
    LeaveTypeCreate,
    LeaveTypeUpdate,
    LocationCreate,
    LocationRead,
    LocationUpdate,
)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class HrmsSetupService:
    def __init__(self, db: AsyncSession):
        self.db = db

    # -----------------------------------------------------------------------
    # Seed Data Initialization (Idempotent)
    # -----------------------------------------------------------------------
    async def ensure_seeds(self) -> None:
        """Seed default Office, Leave Types, Expense Categories, and Settings if empty."""
        # 1. Default Office Location
        loc_res = await self.db.execute(
            select(func.count(HrmsLocation.id)).where(HrmsLocation.deleted_at.is_(None))
        )
        if loc_res.scalar() == 0:
            default_office = HrmsLocation(
                name="Inhyma Thane Office",
                location_type="OFFICE",
                address="Office No 421, 4th Floor, Lodha Supremus, Road Number 22, Wagle Industrial Estate, Thane West, Maharashtra 400604",
                latitude=19.199824,
                longitude=72.956795,
                radius_meters=150.0,
                is_active=True,
            )
            self.db.add(default_office)

        # 2. Default Leave Types
        existing_types_res = await self.db.execute(
            select(HrmsLeaveType.name).where(HrmsLeaveType.deleted_at.is_(None))
        )
        existing_names = {row[0].strip().lower() for row in existing_types_res.all()}

        seed_leaves = [
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
        to_add = [l for l in seed_leaves if l.name.strip().lower() not in existing_names]
        if to_add:
            self.db.add_all(to_add)

        # 3. Default Expense Categories
        cat_res = await self.db.execute(
            select(func.count(HrmsExpenseCategory.id)).where(HrmsExpenseCategory.deleted_at.is_(None))
        )
        if cat_res.scalar() == 0:
            seed_cats = [
                HrmsExpenseCategory(name="Travel", code="TRV", description="Business travel, train/flight fares, and local transit", is_active=True),
                HrmsExpenseCategory(name="Meals", code="MLS", description="Client dinners, team meals, and working lunches", is_active=True),
                HrmsExpenseCategory(name="Fuel", code="FUL", description="Vehicle fuel allowance and mileage reimbursement", is_active=True),
                HrmsExpenseCategory(name="Office Supplies", code="SUP", description="Stationery, printing, and general administrative supplies", is_active=True),
                HrmsExpenseCategory(name="Accommodation", code="ACC", description="Hotel stays and lodging during outstation visits", is_active=True),
                HrmsExpenseCategory(name="Miscellaneous", code="MISC", description="Incidental work expenses and emergency purchases", is_active=True),
            ]
            self.db.add_all(seed_cats)

        # 4. Default Expense Settings
        settings_res = await self.db.execute(select(HrmsExpenseSettings).limit(1))
        if not settings_res.scalar_one_or_none():
            default_settings = HrmsExpenseSettings(
                approval_team_lead=True,
                approval_manager=True,
                approval_accounts=True,
                max_claim_amount=50000.0,
                receipt_required=True,
                auto_approval_limit=500.0,
                submission_window_days=30,
            )
            self.db.add(default_settings)

        await self.db.commit()

    # -----------------------------------------------------------------------
    # Office Locations (Geo Fencing)
    # -----------------------------------------------------------------------
    async def list_locations(self) -> List[LocationRead]:
        await self.ensure_seeds()

        # Query locations
        query = (
            select(HrmsLocation)
            .where(HrmsLocation.deleted_at.is_(None))
            .order_by(HrmsLocation.created_at.asc())
        )
        result = await self.db.execute(query)
        locations = result.scalars().all()

        # Employee counts by location
        counts_res = await self.db.execute(
            select(
                HrmsEmployeeLocation.location_id,
                func.count(HrmsEmployeeLocation.id).label("cnt"),
            ).group_by(HrmsEmployeeLocation.location_id)
        )
        counts_map = {row[0]: row[1] for row in counts_res.all()}

        return [
            LocationRead(
                id=loc.id,
                name=loc.name,
                location_type=loc.location_type,
                address=loc.address,
                latitude=loc.latitude,
                longitude=loc.longitude,
                radius_meters=loc.radius_meters,
                is_active=loc.is_active,
                employees_assigned=counts_map.get(loc.id, 0),
                created_at=loc.created_at,
                updated_at=loc.updated_at,
                version=loc.version,
            )
            for loc in locations
        ]

    async def get_location(self, location_id: uuid.UUID) -> HrmsLocation:
        result = await self.db.execute(
            select(HrmsLocation).where(
                HrmsLocation.id == location_id, HrmsLocation.deleted_at.is_(None)
            )
        )
        loc = result.scalar_one_or_none()
        if not loc:
            raise NotFoundException("Office location not found.")
        return loc

    async def create_location(self, payload: LocationCreate) -> LocationRead:
        loc = HrmsLocation(
            name=payload.name.strip(),
            location_type=payload.location_type or "OFFICE",
            address=payload.address.strip(),
            latitude=payload.latitude,
            longitude=payload.longitude,
            radius_meters=payload.radius_meters,
            is_active=payload.is_active,
        )
        self.db.add(loc)
        await self.db.commit()
        await self.db.refresh(loc)
        return LocationRead(
            id=loc.id,
            name=loc.name,
            location_type=loc.location_type,
            address=loc.address,
            latitude=loc.latitude,
            longitude=loc.longitude,
            radius_meters=loc.radius_meters,
            is_active=loc.is_active,
            employees_assigned=0,
            created_at=loc.created_at,
            updated_at=loc.updated_at,
            version=loc.version,
        )

    async def update_location(self, location_id: uuid.UUID, payload: LocationUpdate) -> LocationRead:
        loc = await self.get_location(location_id)
        if payload.name is not None:
            loc.name = payload.name.strip()
        if payload.location_type is not None:
            loc.location_type = payload.location_type
        if payload.address is not None:
            loc.address = payload.address.strip()
        if payload.latitude is not None:
            loc.latitude = payload.latitude
        if payload.longitude is not None:
            loc.longitude = payload.longitude
        if payload.radius_meters is not None:
            loc.radius_meters = payload.radius_meters
        if payload.is_active is not None:
            loc.is_active = payload.is_active

        loc.version += 1
        loc.updated_at = _utcnow()
        await self.db.commit()
        await self.db.refresh(loc)

        # Get assigned count
        cnt_res = await self.db.execute(
            select(func.count(HrmsEmployeeLocation.id)).where(
                HrmsEmployeeLocation.location_id == loc.id
            )
        )
        return LocationRead(
            id=loc.id,
            name=loc.name,
            location_type=loc.location_type,
            address=loc.address,
            latitude=loc.latitude,
            longitude=loc.longitude,
            radius_meters=loc.radius_meters,
            is_active=loc.is_active,
            employees_assigned=cnt_res.scalar() or 0,
            created_at=loc.created_at,
            updated_at=loc.updated_at,
            version=loc.version,
        )

    async def set_location_status(self, location_id: uuid.UUID, is_active: bool) -> LocationRead:
        loc = await self.get_location(location_id)
        loc.is_active = is_active
        loc.version += 1
        loc.updated_at = _utcnow()
        await self.db.commit()
        await self.db.refresh(loc)

        cnt_res = await self.db.execute(
            select(func.count(HrmsEmployeeLocation.id)).where(
                HrmsEmployeeLocation.location_id == loc.id
            )
        )
        return LocationRead(
            id=loc.id,
            name=loc.name,
            location_type=loc.location_type,
            address=loc.address,
            latitude=loc.latitude,
            longitude=loc.longitude,
            radius_meters=loc.radius_meters,
            is_active=loc.is_active,
            employees_assigned=cnt_res.scalar() or 0,
            created_at=loc.created_at,
            updated_at=loc.updated_at,
            version=loc.version,
        )

    async def delete_location(self, location_id: uuid.UUID) -> None:
        """Soft delete office location."""
        loc = await self.get_location(location_id)
        loc.deleted_at = _utcnow()
        loc.is_active = False
        loc.version += 1
        loc.updated_at = _utcnow()
        await self.db.commit()

    # -----------------------------------------------------------------------
    # Leave Types
    # -----------------------------------------------------------------------
    async def list_leave_types(self) -> List[HrmsLeaveType]:
        await self.ensure_seeds()
        query = (
            select(HrmsLeaveType)
            .where(HrmsLeaveType.deleted_at.is_(None))
            .order_by(HrmsLeaveType.created_at.asc())
        )
        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def get_leave_type(self, leave_type_id: uuid.UUID) -> HrmsLeaveType:
        result = await self.db.execute(
            select(HrmsLeaveType).where(
                HrmsLeaveType.id == leave_type_id, HrmsLeaveType.deleted_at.is_(None)
            )
        )
        leave = result.scalar_one_or_none()
        if not leave:
            raise NotFoundException("Leave type not found.")
        return leave

    async def create_leave_type(self, payload: LeaveTypeCreate) -> HrmsLeaveType:
        leave = HrmsLeaveType(
            name=payload.name.strip(),
            code=payload.code.strip() if payload.code else None,
            description=payload.description.strip() if payload.description else None,
            leave_type=payload.leave_type or "REGULAR",
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
            is_active=payload.is_active,
        )
        self.db.add(leave)
        await self.db.commit()
        await self.db.refresh(leave)
        return leave

    async def update_leave_type(self, leave_type_id: uuid.UUID, payload: LeaveTypeUpdate) -> HrmsLeaveType:
        leave = await self.get_leave_type(leave_type_id)
        if payload.name is not None:
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
        if payload.is_active is not None:
            leave.is_active = payload.is_active

        leave.version += 1
        leave.updated_at = _utcnow()
        await self.db.commit()
        await self.db.refresh(leave)
        return leave

    async def set_leave_type_status(self, leave_type_id: uuid.UUID, is_active: bool) -> HrmsLeaveType:
        leave = await self.get_leave_type(leave_type_id)
        leave.is_active = is_active
        leave.version += 1
        leave.updated_at = _utcnow()
        await self.db.commit()
        await self.db.refresh(leave)
        return leave

    async def delete_leave_type(self, leave_type_id: uuid.UUID) -> None:
        """Soft delete leave type."""
        leave = await self.get_leave_type(leave_type_id)
        leave.deleted_at = _utcnow()
        leave.is_active = False
        leave.version += 1
        leave.updated_at = _utcnow()
        await self.db.commit()

    # -----------------------------------------------------------------------
    # Expense Categories
    # -----------------------------------------------------------------------
    async def list_expense_categories(self) -> List[HrmsExpenseCategory]:
        await self.ensure_seeds()
        query = (
            select(HrmsExpenseCategory)
            .where(HrmsExpenseCategory.deleted_at.is_(None))
            .order_by(HrmsExpenseCategory.created_at.asc())
        )
        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def get_expense_category(self, category_id: uuid.UUID) -> HrmsExpenseCategory:
        result = await self.db.execute(
            select(HrmsExpenseCategory).where(
                HrmsExpenseCategory.id == category_id,
                HrmsExpenseCategory.deleted_at.is_(None),
            )
        )
        cat = result.scalar_one_or_none()
        if not cat:
            raise NotFoundException("Expense category not found.")
        return cat

    async def create_expense_category(self, payload: ExpenseCategoryCreate) -> HrmsExpenseCategory:
        cat = HrmsExpenseCategory(
            name=payload.name.strip(),
            code=payload.code.strip() if payload.code else None,
            description=payload.description.strip() if payload.description else None,
            is_active=payload.is_active,
        )
        self.db.add(cat)
        await self.db.commit()
        await self.db.refresh(cat)
        return cat

    async def update_expense_category(self, category_id: uuid.UUID, payload: ExpenseCategoryUpdate) -> HrmsExpenseCategory:
        cat = await self.get_expense_category(category_id)
        if payload.name is not None:
            cat.name = payload.name.strip()
        if payload.code is not None:
            cat.code = payload.code.strip() if payload.code else None
        if payload.description is not None:
            cat.description = payload.description.strip() if payload.description else None
        if payload.is_active is not None:
            cat.is_active = payload.is_active

        cat.version += 1
        cat.updated_at = _utcnow()
        await self.db.commit()
        await self.db.refresh(cat)
        return cat

    async def set_expense_category_status(self, category_id: uuid.UUID, is_active: bool) -> HrmsExpenseCategory:
        cat = await self.get_expense_category(category_id)
        cat.is_active = is_active
        cat.version += 1
        cat.updated_at = _utcnow()
        await self.db.commit()
        await self.db.refresh(cat)
        return cat

    async def delete_expense_category(self, category_id: uuid.UUID) -> None:
        """Soft delete expense category."""
        cat = await self.get_expense_category(category_id)
        cat.deleted_at = _utcnow()
        cat.is_active = False
        cat.version += 1
        cat.updated_at = _utcnow()
        await self.db.commit()

    # -----------------------------------------------------------------------
    # Expense Settings (Approval Workflow & Claim Rules)
    # -----------------------------------------------------------------------
    async def get_expense_settings(self) -> HrmsExpenseSettings:
        await self.ensure_seeds()
        result = await self.db.execute(select(HrmsExpenseSettings).limit(1))
        settings = result.scalar_one_or_none()
        if not settings:
            settings = HrmsExpenseSettings(
                approval_team_lead=True,
                approval_manager=True,
                approval_accounts=True,
                max_claim_amount=50000.0,
                receipt_required=True,
                auto_approval_limit=500.0,
                submission_window_days=30,
            )
            self.db.add(settings)
            await self.db.commit()
            await self.db.refresh(settings)
        return settings

    async def update_expense_settings(self, payload: ExpenseSettingsUpdate) -> HrmsExpenseSettings:
        settings = await self.get_expense_settings()
        settings.approval_team_lead = payload.approval_team_lead
        settings.approval_manager = payload.approval_manager
        settings.approval_accounts = payload.approval_accounts
        settings.max_claim_amount = payload.max_claim_amount
        settings.receipt_required = payload.receipt_required
        settings.auto_approval_limit = payload.auto_approval_limit
        settings.submission_window_days = payload.submission_window_days
        settings.updated_at = _utcnow()
        await self.db.commit()
        await self.db.refresh(settings)
        return settings
