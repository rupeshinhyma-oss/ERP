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

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import BadRequestException, NotFoundException
from app.hrms.models import (
    HrmsAsset,
    HrmsEmployeeLocation,
    HrmsLocationAssignmentHistory,
    HrmsExpenseCategory,
    HrmsExpenseSettings,
    HrmsLeaveType,
    HrmsLocation,
    HrmsTrackingSettings,
)
from app.hrms.schemas import (
    DetailedTrackingEmployeeItem,
    EmployeeLocationAssignPayload,
    EmployeeLocationHistoryItem,
    EmployeeLocationItem,
    EmployeeLocationOverview,
    DetailedTrackingEmployeeUpdate,
    EmployeeTrackingSettingsResponse,
    ExpenseCategoryCreate,
    ExpenseCategoryUpdate,
    ExpenseSettingsUpdate,
    LeaveTypeCreate,
    LeaveTypeUpdate,
    LocationCreate,
    LocationRead,
    LocationUpdate,
    ReturnTimerEmployeeItem,
    ReturnTimerEmployeeUpdate,
    TrackingSettingsOverviewResponse,
    TrackingSettingsRead,
    TrackingSettingsUpdate,
)
from app.users.models import User


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
        # 1. Canonical / Seed Office Locations
        existing_locs_res = await self.db.execute(
            select(HrmsLocation.name).where(HrmsLocation.deleted_at.is_(None))
        )
        existing_loc_names = {row[0].strip().lower() for row in existing_locs_res.all()}

        seed_locations = [
            HrmsLocation(
                name="Inhyma Thane Office",
                location_type="HEAD_OFFICE",
                address="Office No 421, 4th Floor, Lodha Supremus, Road Number 22, Wagle Industrial Estate, Thane West, Maharashtra 400604",
                latitude=19.199824,
                longitude=72.956795,
                radius_meters=150.0,
                is_active=True,
            ),
            HrmsLocation(
                name="Mumbai Office",
                location_type="BRANCH",
                address="Bandra Kurla Complex, Bandra East, Mumbai, Maharashtra 400051",
                latitude=19.066000,
                longitude=72.868000,
                radius_meters=150.0,
                is_active=True,
            ),
            HrmsLocation(
                name="Gujarat Office",
                location_type="BRANCH",
                address="SG Highway, Bodakdev, Ahmedabad, Gujarat 380054",
                latitude=23.033000,
                longitude=72.508000,
                radius_meters=150.0,
                is_active=True,
            ),
            HrmsLocation(
                name="MP Office",
                location_type="BRANCH",
                address="AB Road, Vijay Nagar, Indore, Madhya Pradesh 452010",
                latitude=22.753000,
                longitude=75.893000,
                radius_meters=150.0,
                is_active=True,
            ),
            HrmsLocation(
                name="China Central Office",
                location_type="INTERNATIONAL",
                address="Century Avenue, Pudong New Area, Shanghai, China 200120",
                latitude=31.230400,
                longitude=121.473700,
                radius_meters=200.0,
                is_active=True,
            ),
        ]
        for sl in seed_locations:
            if sl.name.strip().lower() not in existing_loc_names:
                self.db.add(sl)

        # 2. Default Leave Types
        existing_types_res = await self.db.execute(
            select(HrmsLeaveType.name)
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
        to_add = seed_leaves if not existing_names else []
        if to_add:
            self.db.add_all(to_add)

        # 3. Default Expense Categories
        cat_res = await self.db.execute(
            select(func.count(HrmsExpenseCategory.id))
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
    async def list_locations(self, *, active_only: bool = False) -> List[LocationRead]:
        await self.ensure_seeds()

        # Query locations
        query = select(HrmsLocation).where(HrmsLocation.deleted_at.is_(None))
        if active_only:
            query = query.where(HrmsLocation.is_active.is_(True))
        query = query.order_by(HrmsLocation.created_at.asc())
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
        """Soft delete office location, preventing deletion if employees or assets are actively mapped."""
        loc = await self.get_location(location_id)

        # Check for active employee mappings to prevent orphaned mappings and silent office fallback
        emp_count_res = await self.db.execute(
            select(func.count(HrmsEmployeeLocation.id)).where(
                HrmsEmployeeLocation.location_id == location_id
            )
        )
        emp_count = emp_count_res.scalar() or 0
        if emp_count > 0:
            raise BadRequestException(
                f"Cannot delete office location '{loc.name}'. There are {emp_count} employee(s) currently assigned to this location. Reassign them before deleting."
            )

        # Check for assets assigned to this location
        asset_count_res = await self.db.execute(
            select(func.count(HrmsAsset.id)).where(
                HrmsAsset.location_id == location_id,
                HrmsAsset.deleted_at.is_(None),
            )
        )
        asset_count = asset_count_res.scalar() or 0
        if asset_count > 0:
            raise BadRequestException(
                f"Cannot delete office location '{loc.name}'. There are {asset_count} asset(s) currently located here. Relocate them before deleting."
            )

        loc.deleted_at = _utcnow()
        loc.is_active = False
        loc.version += 1
        loc.updated_at = _utcnow()
        await self.db.commit()

    # -----------------------------------------------------------------------
    # Leave Types
    # -----------------------------------------------------------------------
    async def list_leave_types(self, *, active_only: bool = False) -> List[HrmsLeaveType]:
        await self.ensure_seeds()
        query = select(HrmsLeaveType).where(HrmsLeaveType.deleted_at.is_(None))
        if active_only:
            query = query.where(HrmsLeaveType.is_active.is_(True))
        query = query.order_by(HrmsLeaveType.created_at.asc())
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
    async def list_expense_categories(self, *, active_only: bool = False) -> List[HrmsExpenseCategory]:
        await self.ensure_seeds()
        query = select(HrmsExpenseCategory).where(HrmsExpenseCategory.deleted_at.is_(None))
        if active_only:
            query = query.where(HrmsExpenseCategory.is_active.is_(True))
        query = query.order_by(HrmsExpenseCategory.created_at.asc())
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

    # -----------------------------------------------------------------------
    # Tracking Settings (Org Defaults & Per-Employee Overrides)
    # -----------------------------------------------------------------------
    async def get_or_create_org_tracking_settings(self) -> HrmsTrackingSettings:
        """Fetch or create organization default tracking settings."""
        stmt = select(HrmsTrackingSettings).where(HrmsTrackingSettings.employee_id.is_(None)).limit(1)
        res = await self.db.execute(stmt)
        setting = res.scalar_one_or_none()
        if not setting:
            setting = HrmsTrackingSettings(
                employee_id=None,
                is_active=True,
                is_detailed_tracking_enabled=False,
                detailed_interval_minutes=5,
                detailed_stop_threshold_minutes=5.0,
                stop_detection_radius_meters=50.0,
                max_gps_accuracy_meters=50.0,
                return_timer_seconds=30,
                is_unlimited_return=False,
            )
            self.db.add(setting)
            await self.db.commit()
            await self.db.refresh(setting)
        return setting

    def _to_tracking_settings_read(self, s: HrmsTrackingSettings) -> TrackingSettingsRead:
        emp_name = None
        emp_code = None
        dept = None
        if s.employee:
            first = s.employee.first_name or ""
            last = s.employee.last_name or ""
            emp_name = f"{first} {last}".strip() or s.employee.username
            emp_code = getattr(s.employee, "employee_code", None)
            dept = getattr(s.employee, "department", None)

        updater_name = None
        if s.updater:
            first = s.updater.first_name or ""
            last = s.updater.last_name or ""
            updater_name = f"{first} {last}".strip() or s.updater.username

        return TrackingSettingsRead(
            id=s.id,
            employee_id=s.employee_id,
            employee_name=emp_name,
            employee_code=emp_code,
            department=dept,
            is_active=s.is_active,
            is_detailed_tracking_enabled=getattr(s, "is_detailed_tracking_enabled", False),
            detailed_interval_minutes=getattr(s, "detailed_interval_minutes", 5),
            detailed_stop_threshold_minutes=s.detailed_stop_threshold_minutes,
            stop_detection_radius_meters=s.stop_detection_radius_meters,
            max_gps_accuracy_meters=s.max_gps_accuracy_meters,
            return_timer_seconds=s.return_timer_seconds,
            is_unlimited_return=s.is_unlimited_return,
            updated_by=s.updated_by,
            updated_by_name=updater_name,
            updated_at=s.updated_at,
            version=s.version,
        )

    async def update_org_tracking_settings(
        self,
        payload: TrackingSettingsUpdate,
        user_id: uuid.UUID,
    ) -> TrackingSettingsRead:
        """Update organization default tracking settings."""
        setting = await self.get_or_create_org_tracking_settings()
        setting.is_active = payload.is_active
        setting.detailed_stop_threshold_minutes = payload.detailed_stop_threshold_minutes
        setting.stop_detection_radius_meters = payload.stop_detection_radius_meters
        setting.max_gps_accuracy_meters = payload.max_gps_accuracy_meters
        setting.return_timer_seconds = payload.return_timer_seconds
        setting.is_unlimited_return = payload.is_unlimited_return
        setting.updated_by = user_id
        setting.updated_at = _utcnow()
        setting.version += 1

        await self.db.commit()
        await self.db.refresh(setting)
        return self._to_tracking_settings_read(setting)

    async def get_employee_tracking_settings(
        self,
        employee_id: uuid.UUID,
    ) -> EmployeeTrackingSettingsResponse:
        """Fetch tracking settings for a specific employee, including override and effective settings."""
        org_def = await self.get_or_create_org_tracking_settings()
        org_read = self._to_tracking_settings_read(org_def)

        # Check for employee-specific override
        stmt = select(HrmsTrackingSettings).where(HrmsTrackingSettings.employee_id == employee_id).limit(1)
        res = await self.db.execute(stmt)
        emp_setting = res.scalar_one_or_none()

        if emp_setting:
            emp_read = self._to_tracking_settings_read(emp_setting)
            return EmployeeTrackingSettingsResponse(
                org_default=org_read,
                override=emp_read,
                effective=emp_read,
                has_override=True,
            )
        else:
            return EmployeeTrackingSettingsResponse(
                org_default=org_read,
                override=None,
                effective=org_read,
                has_override=False,
            )

    async def update_employee_tracking_settings(
        self,
        employee_id: uuid.UUID,
        payload: TrackingSettingsUpdate,
        user_id: uuid.UUID,
    ) -> EmployeeTrackingSettingsResponse:
        """Set employee-specific override for tracking settings."""
        org_def = await self.get_or_create_org_tracking_settings()
        org_read = self._to_tracking_settings_read(org_def)

        stmt = select(HrmsTrackingSettings).where(HrmsTrackingSettings.employee_id == employee_id).limit(1)
        res = await self.db.execute(stmt)
        emp_setting = res.scalar_one_or_none()

        if not emp_setting:
            emp_setting = HrmsTrackingSettings(
                employee_id=employee_id,
                is_active=payload.is_active,
                detailed_stop_threshold_minutes=payload.detailed_stop_threshold_minutes,
                stop_detection_radius_meters=payload.stop_detection_radius_meters,
                max_gps_accuracy_meters=payload.max_gps_accuracy_meters,
                return_timer_seconds=payload.return_timer_seconds,
                is_unlimited_return=payload.is_unlimited_return,
                updated_by=user_id,
            )
            self.db.add(emp_setting)
        else:
            emp_setting.is_active = payload.is_active
            emp_setting.detailed_stop_threshold_minutes = payload.detailed_stop_threshold_minutes
            emp_setting.stop_detection_radius_meters = payload.stop_detection_radius_meters
            emp_setting.max_gps_accuracy_meters = payload.max_gps_accuracy_meters
            emp_setting.return_timer_seconds = payload.return_timer_seconds
            emp_setting.is_unlimited_return = payload.is_unlimited_return
            emp_setting.updated_by = user_id
            emp_setting.updated_at = _utcnow()
            emp_setting.version += 1

        await self.db.commit()
        await self.db.refresh(emp_setting)
        emp_read = self._to_tracking_settings_read(emp_setting)

        return EmployeeTrackingSettingsResponse(
            org_default=org_read,
            override=emp_read,
            effective=emp_read,
            has_override=True,
        )

    async def delete_employee_tracking_settings(
        self,
        employee_id: uuid.UUID,
    ) -> EmployeeTrackingSettingsResponse:
        """Clear employee override so that the employee inherits organization defaults again."""
        stmt = select(HrmsTrackingSettings).where(HrmsTrackingSettings.employee_id == employee_id).limit(1)
        res = await self.db.execute(stmt)
        emp_setting = res.scalar_one_or_none()
        if emp_setting:
            await self.db.delete(emp_setting)
            await self.db.commit()

        org_def = await self.get_or_create_org_tracking_settings()
        org_read = self._to_tracking_settings_read(org_def)

        return EmployeeTrackingSettingsResponse(
            org_default=org_read,
            override=None,
            effective=org_read,
            has_override=False,
        )

    async def get_effective_tracking_settings(self, employee_id: uuid.UUID) -> HrmsTrackingSettings:
        """Fetch effective tracking settings model instance for internal business logic."""
        stmt = select(HrmsTrackingSettings).where(HrmsTrackingSettings.employee_id == employee_id).limit(1)
        res = await self.db.execute(stmt)
        emp_setting = res.scalar_one_or_none()
        if emp_setting:
            return emp_setting
        return await self.get_or_create_org_tracking_settings()

    async def list_all_tracking_settings(self) -> TrackingSettingsOverviewResponse:
        """List organization default tracking settings and all employee overrides."""
        org_def = await self.get_or_create_org_tracking_settings()
        org_read = self._to_tracking_settings_read(org_def)

        stmt = (
            select(HrmsTrackingSettings)
            .where(HrmsTrackingSettings.employee_id.is_not(None))
            .order_by(HrmsTrackingSettings.updated_at.desc())
        )
        res = await self.db.execute(stmt)
        overrides = [self._to_tracking_settings_read(s) for s in res.scalars().all()]

        return TrackingSettingsOverviewResponse(
            org_default=org_read,
            employee_overrides=overrides,
        )

    async def list_detailed_tracking_employees(
        self,
        search: Optional[str] = None,
        allowed_employee_ids: Optional[set[uuid.UUID]] = None,
    ) -> list[DetailedTrackingEmployeeItem]:
        """List active employees with their individual Detailed Tracking ON/OFF status and interval."""
        from app.users.models import UserStatus
        query = select(User).where(User.deleted_at.is_(None), User.is_active.is_(True), User.status == UserStatus.ACTIVE)
        if allowed_employee_ids is not None:
            query = query.where(User.id.in_(allowed_employee_ids))
        if search and search.strip():
            s_term = f"%{search.strip()}%"
            query = query.where(
                or_(
                    User.first_name.ilike(s_term),
                    User.last_name.ilike(s_term),
                    User.username.ilike(s_term),
                    User.email.ilike(s_term),
                    User.employee_code.ilike(s_term),
                )
            )
        query = query.order_by(User.first_name.asc(), User.username.asc())
        users = (await self.db.execute(query)).scalars().all()

        emp_ids = [u.id for u in users]
        dept_map: dict[uuid.UUID, str] = {}
        settings_map: dict[uuid.UUID, HrmsTrackingSettings] = {}
        if emp_ids:
            try:
                from app.rbac.models import UserRole, Role
                r_stmt = (
                    select(UserRole.user_id, Role.name)
                    .join(Role, Role.id == UserRole.role_id)
                    .where(UserRole.user_id.in_(emp_ids))
                )
                roles_res = (await self.db.execute(r_stmt)).all()
                for uid, rname in roles_res:
                    if rname.lower() not in ("user", "employee", "super_admin", "admin") and uid not in dept_map:
                        dept_map[uid] = rname
            except Exception:
                pass

            st_res = await self.db.execute(
                select(HrmsTrackingSettings).where(HrmsTrackingSettings.employee_id.in_(emp_ids))
            )
            for st in st_res.scalars().all():
                if st.employee_id:
                    settings_map[st.employee_id] = st

        items: list[DetailedTrackingEmployeeItem] = []
        for u in users:
            first = u.first_name or ""
            last = u.last_name or ""
            emp_name = f"{first} {last}".strip() or u.username
            dept = dept_map.get(u.id) or "General"
            st = settings_map.get(u.id)
            items.append(
                DetailedTrackingEmployeeItem(
                    employee_id=u.id,
                    employee_name=emp_name,
                    employee_code=getattr(u, "employee_code", None),
                    department=dept,
                    is_detailed_tracking_enabled=st.is_detailed_tracking_enabled if st else False,
                    detailed_interval_minutes=st.detailed_interval_minutes if st else 5,
                    detailed_stop_threshold_minutes=st.detailed_stop_threshold_minutes if st else 5.0,
                    updated_at=st.updated_at if st else None,
                )
            )
        return items

    async def update_employee_detailed_tracking(
        self,
        employee_id: uuid.UUID,
        payload: DetailedTrackingEmployeeUpdate,
        user_id: uuid.UUID,
    ) -> DetailedTrackingEmployeeItem:
        """Update individual employee's detailed tracking toggle and interval."""
        emp = await self.db.get(User, employee_id)
        if not emp or emp.deleted_at:
            raise NotFoundException("Employee not found.")

        stmt = select(HrmsTrackingSettings).where(HrmsTrackingSettings.employee_id == employee_id).limit(1)
        res = await self.db.execute(stmt)
        st = res.scalar_one_or_none()
        if not st:
            org = await self.get_or_create_org_tracking_settings()
            st = HrmsTrackingSettings(
                employee_id=employee_id,
                is_active=True,
                is_detailed_tracking_enabled=payload.is_detailed_tracking_enabled,
                detailed_interval_minutes=payload.detailed_interval_minutes,
                detailed_stop_threshold_minutes=payload.detailed_stop_threshold_minutes,
                stop_detection_radius_meters=org.stop_detection_radius_meters,
                max_gps_accuracy_meters=org.max_gps_accuracy_meters,
                return_timer_seconds=org.return_timer_seconds,
                is_unlimited_return=org.is_unlimited_return,
                updated_by=user_id,
            )
            self.db.add(st)
        else:
            st.is_detailed_tracking_enabled = payload.is_detailed_tracking_enabled
            st.detailed_interval_minutes = payload.detailed_interval_minutes
            st.detailed_stop_threshold_minutes = payload.detailed_stop_threshold_minutes
            st.updated_by = user_id
            st.updated_at = _utcnow()
            st.version += 1

        await self.db.commit()
        await self.db.refresh(st)

        first = emp.first_name or ""
        last = emp.last_name or ""
        emp_name = f"{first} {last}".strip() or emp.username
        return DetailedTrackingEmployeeItem(
            employee_id=emp.id,
            employee_name=emp_name,
            employee_code=getattr(emp, "employee_code", None),
            department=getattr(emp, "department", None),
            is_detailed_tracking_enabled=st.is_detailed_tracking_enabled,
            detailed_interval_minutes=st.detailed_interval_minutes,
            detailed_stop_threshold_minutes=st.detailed_stop_threshold_minutes,
            updated_at=st.updated_at,
        )

    async def list_return_timer_employees(
        self,
        search: Optional[str] = None,
        allowed_employee_ids: Optional[set[uuid.UUID]] = None,
    ) -> list[ReturnTimerEmployeeItem]:
        """List employees with their individual Return Timer overrides and effective durations."""
        org = await self.get_or_create_org_tracking_settings()
        org_secs = org.return_timer_seconds if not org.is_unlimited_return else None

        from app.users.models import UserStatus
        query = select(User).where(User.deleted_at.is_(None), User.is_active.is_(True), User.status == UserStatus.ACTIVE)
        if allowed_employee_ids is not None:
            query = query.where(User.id.in_(allowed_employee_ids))
        if search and search.strip():
            s_term = f"%{search.strip()}%"
            query = query.where(
                or_(
                    User.first_name.ilike(s_term),
                    User.last_name.ilike(s_term),
                    User.username.ilike(s_term),
                    User.email.ilike(s_term),
                    User.employee_code.ilike(s_term),
                )
            )
        query = query.order_by(User.first_name.asc(), User.username.asc())
        users = (await self.db.execute(query)).scalars().all()

        emp_ids = [u.id for u in users]
        dept_map: dict[uuid.UUID, str] = {}
        settings_map: dict[uuid.UUID, HrmsTrackingSettings] = {}
        if emp_ids:
            try:
                from app.rbac.models import UserRole, Role
                r_stmt = (
                    select(UserRole.user_id, Role.name)
                    .join(Role, Role.id == UserRole.role_id)
                    .where(UserRole.user_id.in_(emp_ids))
                )
                roles_res = (await self.db.execute(r_stmt)).all()
                for uid, rname in roles_res:
                    if rname.lower() not in ("user", "employee", "super_admin", "admin") and uid not in dept_map:
                        dept_map[uid] = rname
            except Exception:
                pass

            st_res = await self.db.execute(
                select(HrmsTrackingSettings).where(HrmsTrackingSettings.employee_id.in_(emp_ids))
            )
            for st in st_res.scalars().all():
                if st.employee_id:
                    settings_map[st.employee_id] = st

        items: list[ReturnTimerEmployeeItem] = []
        for u in users:
            first = u.first_name or ""
            last = u.last_name or ""
            emp_name = f"{first} {last}".strip() or u.username
            dept = dept_map.get(u.id) or "General"
            st = settings_map.get(u.id)

            has_override = (st is not None)
            is_unlim = st.is_unlimited_return if st else org.is_unlimited_return
            secs = st.return_timer_seconds if st else org_secs
            eff_secs = None if is_unlim else (st.return_timer_seconds if st else org_secs)

            items.append(
                ReturnTimerEmployeeItem(
                    employee_id=u.id,
                    employee_name=emp_name,
                    employee_code=getattr(u, "employee_code", None),
                    department=dept,
                    use_org_default=not has_override,
                    return_timer_seconds=secs,
                    is_unlimited=is_unlim,
                    effective_seconds=eff_secs,
                    updated_at=st.updated_at if st else None,
                )
            )
        return items

    async def update_employee_return_timer(
        self,
        employee_id: uuid.UUID,
        payload: ReturnTimerEmployeeUpdate,
        user_id: uuid.UUID,
    ) -> ReturnTimerEmployeeItem:
        """Update individual return timer override (or restore org default)."""
        emp = await self.db.get(User, employee_id)
        if not emp or emp.deleted_at:
            raise NotFoundException("Employee not found.")

        org = await self.get_or_create_org_tracking_settings()
        stmt = select(HrmsTrackingSettings).where(HrmsTrackingSettings.employee_id == employee_id).limit(1)
        res = await self.db.execute(stmt)
        st = res.scalar_one_or_none()

        if payload.use_org_default:
            if st:
                if not st.is_detailed_tracking_enabled:
                    await self.db.delete(st)
                    st = None
                else:
                    st.return_timer_seconds = org.return_timer_seconds
                    st.is_unlimited_return = org.is_unlimited_return
                    st.updated_by = user_id
                    st.updated_at = _utcnow()
                    st.version += 1
            await self.db.commit()
        else:
            if not st:
                st = HrmsTrackingSettings(
                    employee_id=employee_id,
                    is_active=True,
                    is_detailed_tracking_enabled=False,
                    detailed_interval_minutes=5,
                    detailed_stop_threshold_minutes=org.detailed_stop_threshold_minutes,
                    stop_detection_radius_meters=org.stop_detection_radius_meters,
                    max_gps_accuracy_meters=org.max_gps_accuracy_meters,
                    return_timer_seconds=None if payload.is_unlimited else payload.return_timer_seconds,
                    is_unlimited_return=payload.is_unlimited,
                    updated_by=user_id,
                )
                self.db.add(st)
            else:
                st.return_timer_seconds = None if payload.is_unlimited else payload.return_timer_seconds
                st.is_unlimited_return = payload.is_unlimited
                st.updated_by = user_id
                st.updated_at = _utcnow()
                st.version += 1
            await self.db.commit()
            if st:
                await self.db.refresh(st)

        first = emp.first_name or ""
        last = emp.last_name or ""
        emp_name = f"{first} {last}".strip() or emp.username

        has_override = (st is not None and not payload.use_org_default)
        is_unlim = st.is_unlimited_return if (st and has_override) else org.is_unlimited_return
        secs = st.return_timer_seconds if (st and has_override) else org.return_timer_seconds
        eff_secs = None if is_unlim else secs

        return ReturnTimerEmployeeItem(
            employee_id=emp.id,
            employee_name=emp_name,
            employee_code=getattr(emp, "employee_code", None),
            department=getattr(emp, "department", None),
            use_org_default=not has_override,
            return_timer_seconds=secs,
            is_unlimited=is_unlim,
            effective_seconds=eff_secs,
            updated_at=st.updated_at if st else None,
        )


    # =======================================================================
    # Employee Location Assignment Sub-Module
    # =======================================================================

    async def list_employee_locations(
        self,
        search: Optional[str] = None,
        department: Optional[str] = None,
        location_id: Optional[uuid.UUID] = None,
        allowed_employee_ids: Optional[set[uuid.UUID]] = None,
    ) -> List[EmployeeLocationOverview]:
        """
        List active employees with their assigned primary and additional permitted locations.
        Filtered by search, department, location_id, and requester's allowed employee scope.
        """
        stmt = (
            select(User)
            .where(User.deleted_at.is_(None), User.is_active == True)
            .order_by(User.first_name.asc(), User.username.asc())
        )
        if allowed_employee_ids is not None:
            stmt = stmt.where(User.id.in_(allowed_employee_ids))

        users = list((await self.db.execute(stmt)).scalars().all())
        if not users:
            return []

        user_ids = [u.id for u in users]

        # Resolve departments and designations
        dept_map: dict[uuid.UUID, str] = {}
        try:
            from app.rbac.models import Role, UserRole
            r_stmt = (
                select(UserRole.user_id, Role.name)
                .join(Role, Role.id == UserRole.role_id)
                .where(UserRole.user_id.in_(user_ids))
                .order_by(UserRole.is_primary.desc())
            )
            for uid, rname in (await self.db.execute(r_stmt)).all():
                if rname.lower() not in ("user", "employee", "department_manager", "super_admin", "admin") and uid not in dept_map:
                    dept_map[uid] = rname
        except Exception:
            pass

        pos_map: dict[uuid.UUID, str] = {}
        try:
            from app.org_structure.models import EmployeePositionAssignment, Position
            p_stmt = (
                select(EmployeePositionAssignment.employee_id, Position.name)
                .join(Position, Position.id == EmployeePositionAssignment.position_id)
                .where(EmployeePositionAssignment.employee_id.in_(user_ids))
            )
            for uid, pname in (await self.db.execute(p_stmt)).all():
                if uid not in pos_map:
                    pos_map[uid] = pname
        except Exception:
            pass

        # Query all assigned locations for these employees
        el_stmt = (
            select(HrmsEmployeeLocation, HrmsLocation)
            .join(HrmsLocation, HrmsLocation.id == HrmsEmployeeLocation.location_id)
            .where(
                HrmsEmployeeLocation.user_id.in_(user_ids),
                HrmsLocation.deleted_at.is_(None),
            )
            .order_by(HrmsEmployeeLocation.is_primary.desc(), HrmsLocation.name.asc())
        )
        el_rows = (await self.db.execute(el_stmt)).all()

        emp_locations_map: dict[uuid.UUID, list[EmployeeLocationItem]] = {u.id: [] for u in users}
        assigner_ids = {el.assigned_by for el, _ in el_rows if el.assigned_by}
        assigner_name_map: dict[uuid.UUID, str] = {}
        if assigner_ids:
            asgn_res = await self.db.execute(select(User.id, User.first_name, User.last_name, User.username).where(User.id.in_(assigner_ids)))
            for au_id, afirst, alast, aun in asgn_res.all():
                name = f"{afirst or ''} {alast or ''}".strip() or aun
                assigner_name_map[au_id] = name

        for el, loc in el_rows:
            asgn_by_name = assigner_name_map.get(el.assigned_by) if el.assigned_by else None
            emp_locations_map[el.user_id].append(
                EmployeeLocationItem(
                    id=el.id,
                    location_id=loc.id,
                    location_name=loc.name,
                    location_type=loc.location_type,
                    address=loc.address,
                    latitude=loc.latitude,
                    longitude=loc.longitude,
                    radius_meters=loc.radius_meters,
                    is_primary=el.is_primary,
                    is_active=loc.is_active,
                    assigned_at=el.created_at,
                    assigned_by=el.assigned_by,
                    assigned_by_name=asgn_by_name,
                )
            )

        items: List[EmployeeLocationOverview] = []
        for u in users:
            resolved_dept = dept_map.get(u.id) or getattr(u, "department", None) or "General"
            resolved_desig = pos_map.get(u.id) or getattr(u, "designation", None) or "Staff"

            # Apply department filter
            if department and department.strip() and department.strip().upper() != "ALL":
                if resolved_dept.lower() != department.strip().lower():
                    continue

            # Apply search filter (name, employee_code, username, email, department)
            if search and search.strip():
                st = search.strip().lower()
                first = u.first_name or ""
                last = u.last_name or ""
                emp_code = getattr(u, "employee_code", "") or ""
                match_txt = f"{first} {last} {u.username} {u.email or ''} {emp_code} {resolved_dept}".lower()
                if st not in match_txt:
                    continue

            loc_items = emp_locations_map.get(u.id, [])
            primary_item = next((item for item in loc_items if item.is_primary), None)
            # If no item is explicitly primary but locations exist, pick the first
            if not primary_item and loc_items:
                primary_item = loc_items[0]

            additional_items = [item for item in loc_items if item != primary_item]

            # Apply location filter
            if location_id:
                has_loc = any(item.location_id == location_id for item in loc_items)
                if not has_loc:
                    continue

            first_n = u.first_name or ""
            last_n = u.last_name or ""
            full_name = f"{first_n} {last_n}".strip() or u.username

            items.append(
                EmployeeLocationOverview(
                    employee_id=u.id,
                    employee_code=getattr(u, "employee_code", None),
                    employee_name=full_name,
                    username=u.username,
                    email=u.email,
                    department=resolved_dept,
                    designation=resolved_desig,
                    primary_location=primary_item,
                    additional_locations=additional_items,
                    total_locations_count=len(loc_items),
                )
            )

        return items

    async def get_employee_location_overview(self, employee_id: uuid.UUID) -> EmployeeLocationOverview:
        """Fetch location assignment overview for an individual employee."""
        emp = await self.db.get(User, employee_id)
        if not emp or emp.deleted_at:
            raise NotFoundException("Employee not found.")

        el_stmt = (
            select(HrmsEmployeeLocation, HrmsLocation)
            .join(HrmsLocation, HrmsLocation.id == HrmsEmployeeLocation.location_id)
            .where(
                HrmsEmployeeLocation.user_id == employee_id,
                HrmsLocation.deleted_at.is_(None),
            )
            .order_by(HrmsEmployeeLocation.is_primary.desc(), HrmsLocation.name.asc())
        )
        el_rows = (await self.db.execute(el_stmt)).all()

        assigner_ids = {el.assigned_by for el, _ in el_rows if el.assigned_by}
        assigner_name_map: dict[uuid.UUID, str] = {}
        if assigner_ids:
            asgn_res = await self.db.execute(select(User.id, User.first_name, User.last_name, User.username).where(User.id.in_(assigner_ids)))
            for au_id, afirst, alast, aun in asgn_res.all():
                name = f"{afirst or ''} {alast or ''}".strip() or aun
                assigner_name_map[au_id] = name

        loc_items: list[EmployeeLocationItem] = []
        for el, loc in el_rows:
            asgn_by_name = assigner_name_map.get(el.assigned_by) if el.assigned_by else None
            loc_items.append(
                EmployeeLocationItem(
                    id=el.id,
                    location_id=loc.id,
                    location_name=loc.name,
                    location_type=loc.location_type,
                    address=loc.address,
                    latitude=loc.latitude,
                    longitude=loc.longitude,
                    radius_meters=loc.radius_meters,
                    is_primary=el.is_primary,
                    is_active=loc.is_active,
                    assigned_at=el.created_at,
                    assigned_by=el.assigned_by,
                    assigned_by_name=asgn_by_name,
                )
            )

        primary_item = next((item for item in loc_items if item.is_primary), None)
        if not primary_item and loc_items:
            primary_item = loc_items[0]
        additional_items = [item for item in loc_items if item != primary_item]

        first_n = emp.first_name or ""
        last_n = emp.last_name or ""
        full_name = f"{first_n} {last_n}".strip() or emp.username

        return EmployeeLocationOverview(
            employee_id=emp.id,
            employee_code=getattr(emp, "employee_code", None),
            employee_name=full_name,
            username=emp.username,
            email=emp.email,
            department=getattr(emp, "department", None) or "General",
            designation=getattr(emp, "designation", None) or "Staff",
            primary_location=primary_item,
            additional_locations=additional_items,
            total_locations_count=len(loc_items),
        )

    async def update_employee_locations(
        self,
        employee_id: uuid.UUID,
        payload: EmployeeLocationAssignPayload,
        actor_id: uuid.UUID,
    ) -> EmployeeLocationOverview:
        """
        Assign primary and additional permitted locations to an employee.
        Enforces:
        - Exactly one primary location when assigning locations.
        - Primary location must be an active, non-deleted HrmsLocation.
        - Additional locations must be active, non-deleted HrmsLocations.
        - Duplicate location assignments are prevented.
        - Audit history is recorded in hrms_location_assignment_history.
        """
        emp = await self.db.get(User, employee_id)
        if not emp or emp.deleted_at:
            raise NotFoundException("Employee not found.")

        # 1. Validate primary location
        primary_loc = await self.db.get(HrmsLocation, payload.primary_location_id)
        if not primary_loc or primary_loc.deleted_at is not None:
            raise BadRequestException("Primary location not found.")
        if not primary_loc.is_active:
            raise BadRequestException(f"Cannot assign inactive location '{primary_loc.name}' as primary.")

        # 2. Validate and deduplicate additional locations
        clean_additional_ids: list[uuid.UUID] = []
        seen = {payload.primary_location_id}
        for loc_id in payload.additional_location_ids:
            if loc_id in seen:
                continue
            seen.add(loc_id)
            clean_additional_ids.append(loc_id)

        for loc_id in clean_additional_ids:
            add_loc = await self.db.get(HrmsLocation, loc_id)
            if not add_loc or add_loc.deleted_at is not None:
                raise BadRequestException(f"Additional location {loc_id} not found.")
            if not add_loc.is_active:
                raise BadRequestException(f"Cannot assign inactive location '{add_loc.name}'.")

        target_permitted_ids = {payload.primary_location_id} | set(clean_additional_ids)

        # 3. Fetch existing mappings
        curr_stmt = select(HrmsEmployeeLocation).where(HrmsEmployeeLocation.user_id == employee_id)
        curr_records = list((await self.db.execute(curr_stmt)).scalars().all())
        curr_by_loc = {r.location_id: r for r in curr_records}

        now = _utcnow()

        # 4. Remove unassigned locations
        for loc_id, r in list(curr_by_loc.items()):
            if loc_id not in target_permitted_ids:
                hist = HrmsLocationAssignmentHistory(
                    user_id=employee_id,
                    location_id=loc_id,
                    action="REMOVED",
                    is_primary=r.is_primary,
                    performed_by=actor_id,
                    notes=payload.notes or "Location unassigned",
                )
                self.db.add(hist)
                await self.db.delete(r)
                del curr_by_loc[loc_id]

        # 5. Handle Primary Location
        if payload.primary_location_id in curr_by_loc:
            prim_rec = curr_by_loc[payload.primary_location_id]
            if not prim_rec.is_primary:
                prim_rec.is_primary = True
                prim_rec.assigned_by = actor_id
                prim_rec.updated_at = now
                hist = HrmsLocationAssignmentHistory(
                    user_id=employee_id,
                    location_id=payload.primary_location_id,
                    action="SET_PRIMARY",
                    is_primary=True,
                    performed_by=actor_id,
                    notes=payload.notes or "Designated as primary office location",
                )
                self.db.add(hist)
        else:
            new_prim = HrmsEmployeeLocation(
                user_id=employee_id,
                location_id=payload.primary_location_id,
                is_primary=True,
                assigned_by=actor_id,
            )
            self.db.add(new_prim)
            hist1 = HrmsLocationAssignmentHistory(
                user_id=employee_id,
                location_id=payload.primary_location_id,
                action="ASSIGNED",
                is_primary=True,
                performed_by=actor_id,
                notes=payload.notes or "Assigned as primary office location",
            )
            hist2 = HrmsLocationAssignmentHistory(
                user_id=employee_id,
                location_id=payload.primary_location_id,
                action="SET_PRIMARY",
                is_primary=True,
                performed_by=actor_id,
                notes=payload.notes or "Designated as primary office location",
            )
            self.db.add(hist1)
            self.db.add(hist2)

        # 6. Handle Additional Locations
        for loc_id in clean_additional_ids:
            if loc_id in curr_by_loc:
                add_rec = curr_by_loc[loc_id]
                if add_rec.is_primary:
                    add_rec.is_primary = False
                    add_rec.assigned_by = actor_id
                    add_rec.updated_at = now
                    hist = HrmsLocationAssignmentHistory(
                        user_id=employee_id,
                        location_id=loc_id,
                        action="UNSET_PRIMARY",
                        is_primary=False,
                        performed_by=actor_id,
                        notes=payload.notes or "Changed from primary to additional location",
                    )
                    self.db.add(hist)
            else:
                new_add = HrmsEmployeeLocation(
                    user_id=employee_id,
                    location_id=loc_id,
                    is_primary=False,
                    assigned_by=actor_id,
                )
                self.db.add(new_add)
                hist = HrmsLocationAssignmentHistory(
                    user_id=employee_id,
                    location_id=loc_id,
                    action="ASSIGNED",
                    is_primary=False,
                    performed_by=actor_id,
                    notes=payload.notes or "Assigned as permitted additional location",
                )
                self.db.add(hist)

        await self.db.commit()
        return await self.get_employee_location_overview(employee_id)

    async def get_employee_location_history(
        self,
        employee_id: uuid.UUID,
    ) -> List[EmployeeLocationHistoryItem]:
        """Fetch audit log history of location assignments for an employee."""
        emp = await self.db.get(User, employee_id)
        if not emp or emp.deleted_at:
            raise NotFoundException("Employee not found.")

        stmt = (
            select(HrmsLocationAssignmentHistory, HrmsLocation.name, User.first_name, User.last_name, User.username)
            .join(HrmsLocation, HrmsLocation.id == HrmsLocationAssignmentHistory.location_id)
            .outerjoin(User, User.id == HrmsLocationAssignmentHistory.performed_by)
            .where(HrmsLocationAssignmentHistory.user_id == employee_id)
            .order_by(HrmsLocationAssignmentHistory.created_at.desc())
        )
        rows = (await self.db.execute(stmt)).all()

        items: List[EmployeeLocationHistoryItem] = []
        for hist, loc_name, pfirst, plast, pun in rows:
            pname = None
            if hist.performed_by:
                pname = f"{pfirst or ''} {plast or ''}".strip() or pun

            items.append(
                EmployeeLocationHistoryItem(
                    id=hist.id,
                    employee_id=hist.user_id,
                    location_id=hist.location_id,
                    location_name=loc_name,
                    action=hist.action,
                    is_primary=hist.is_primary,
                    performed_by=hist.performed_by,
                    performed_by_name=pname,
                    notes=hist.notes,
                    created_at=hist.created_at,
                )
            )

        return items
