"""
HRMS Asset Service.

Handles business logic for Asset Management:
- Asset CRUD operations (Create, Read, Update, Status Change, Soft-Delete)
- Persistent Assignment & Return workflows (hrms_asset_assignments)
- One active assignment enforcement at DB and service levels
- Maintenance tracking (hrms_asset_maintenance)
- Branch transfer & movement tracking
- Database-backed summary metrics
- Audit history logging
- Real employee & location validation
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Any, List, Optional
import uuid

from sqlalchemy import delete, desc, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.exceptions import BadRequestException, ConflictException, NotFoundException
from app.hrms.models import (
    HrmsAsset,
    HrmsAssetAssignment,
    HrmsAssetHistory,
    HrmsAssetMaintenance,
    HrmsEmployeeLocation,
    HrmsLocation,
)
from app.hrms.schemas import (
    AssetAssign,
    AssetAssignmentRead,
    AssetCreate,
    AssetHistoryRead,
    AssetMaintenanceCreate,
    AssetMaintenanceRead,
    AssetMaintenanceUpdate,
    AssetMove,
    AssetRead,
    AssetReturn,
    AssetStatusUpdate,
    AssetSummaryRead,
    AssetUpdate,
)
from app.rbac.models import Role, UserRole
from app.users.models import User


VALID_ASSET_STATUSES = {
    "AVAILABLE",
    "ASSIGNED",
    "IN_USE",
    "MAINTENANCE",
    "UNDER_MAINTENANCE",
    "DAMAGED",
    "LOST",
    "RETIRED",
}


class HrmsAssetService:
    """Service layer managing hardware, device, and office assets."""

    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def _resolve_employee_department(self, user_id: uuid.UUID) -> str | None:
        """Resolve primary department name for an employee from assigned roles."""
        role_stmt = (
            select(Role.name)
            .join(UserRole, UserRole.role_id == Role.id)
            .where(UserRole.user_id == user_id)
        )
        role_res = await self.db.execute(role_stmt)
        roles = role_res.scalars().all()
        if not roles:
            return None
        # Prioritize functional department roles
        priority_roles = ["Sales", "HR", "Accounts", "Management", "Operations"]
        for pr in priority_roles:
            for r in roles:
                if pr.lower() in r.lower():
                    return pr
        # Fallback to mapped names
        r0 = roles[0]
        if r0.lower() == "super_admin":
            return "Admin"
        if r0.lower() == "user":
            return "User"
        return r0

    async def _resolve_employee_branch(self, user_id: uuid.UUID) -> str | None:
        """Resolve assigned primary office branch for an employee."""
        stmt = (
            select(HrmsLocation.name)
            .join(HrmsEmployeeLocation, HrmsEmployeeLocation.location_id == HrmsLocation.id)
            .where(
                HrmsEmployeeLocation.user_id == user_id,
                HrmsLocation.deleted_at.is_(None),
            )
            .order_by(HrmsEmployeeLocation.is_primary.desc())
        )
        res = await self.db.execute(stmt)
        return res.scalar_one_or_none()

    async def _to_assignment_read(self, a: HrmsAssetAssignment) -> AssetAssignmentRead:
        """Transform an ORM HrmsAssetAssignment into AssetAssignmentRead schema."""
        emp_name = None
        emp_code = None
        emp_dept = None
        emp_branch = None

        emp = a.employee
        if not emp and a.employee_id:
            emp_res = await self.db.execute(select(User).where(User.id == a.employee_id))
            emp = emp_res.scalar_one_or_none()

        if emp:
            first = emp.first_name or ""
            last = emp.last_name or ""
            emp_name = f"{first} {last}".strip() or emp.username or "Employee"
            emp_code = emp.employee_code
            emp_dept = await self._resolve_employee_department(emp.id)
            emp_branch = await self._resolve_employee_branch(emp.id)

        assigner_name = None
        if a.assigner:
            first = a.assigner.first_name or ""
            last = a.assigner.last_name or ""
            assigner_name = f"{first} {last}".strip() or a.assigner.username
        elif a.assigned_by:
            u_res = await self.db.execute(select(User).where(User.id == a.assigned_by))
            u = u_res.scalar_one_or_none()
            if u:
                first = u.first_name or ""
                last = u.last_name or ""
                assigner_name = f"{first} {last}".strip() or u.username

        returner_name = None
        if a.returner:
            first = a.returner.first_name or ""
            last = a.returner.last_name or ""
            returner_name = f"{first} {last}".strip() or a.returner.username
        elif a.returned_by:
            u_res = await self.db.execute(select(User).where(User.id == a.returned_by))
            u = u_res.scalar_one_or_none()
            if u:
                first = u.first_name or ""
                last = u.last_name or ""
                returner_name = f"{first} {last}".strip() or u.username

        return AssetAssignmentRead(
            id=a.id,
            asset_id=a.asset_id,
            employee_id=a.employee_id,
            employee_name=emp_name,
            employee_code=emp_code,
            employee_department=emp_dept,
            employee_branch=emp_branch,
            assigned_at=a.assigned_at,
            returned_at=a.returned_at,
            expected_return_date=a.expected_return_date,
            assignment_status=a.assignment_status,
            condition_at_assignment=a.condition_at_assignment,
            condition_at_return=a.condition_at_return,
            assignment_notes=a.assignment_notes,
            return_notes=a.return_notes,
            assigned_by=a.assigned_by,
            assigned_by_name=assigner_name,
            returned_by=a.returned_by,
            returned_by_name=returner_name,
            created_at=a.created_at,
            updated_at=a.updated_at,
        )

    async def _to_maintenance_read(self, m: HrmsAssetMaintenance) -> AssetMaintenanceRead:
        """Transform an ORM HrmsAssetMaintenance into AssetMaintenanceRead schema."""
        c_name = None
        if m.creator:
            first = m.creator.first_name or ""
            last = m.creator.last_name or ""
            c_name = f"{first} {last}".strip() or m.creator.username
        elif m.created_by:
            u_res = await self.db.execute(select(User).where(User.id == m.created_by))
            u = u_res.scalar_one_or_none()
            if u:
                first = u.first_name or ""
                last = u.last_name or ""
                c_name = f"{first} {last}".strip() or u.username

        u_name = None
        if m.updater:
            first = m.updater.first_name or ""
            last = m.updater.last_name or ""
            u_name = f"{first} {last}".strip() or m.updater.username
        elif m.updated_by:
            u_res = await self.db.execute(select(User).where(User.id == m.updated_by))
            u = u_res.scalar_one_or_none()
            if u:
                first = u.first_name or ""
                last = u.last_name or ""
                u_name = f"{first} {last}".strip() or u.username

        return AssetMaintenanceRead(
            id=m.id,
            asset_id=m.asset_id,
            issue=m.issue,
            reported_date=m.reported_date,
            maintenance_start=m.maintenance_start,
            maintenance_end=m.maintenance_end,
            vendor_technician=m.vendor_technician,
            cost=m.cost,
            status=m.status,
            notes=m.notes,
            created_by=m.created_by,
            created_by_name=c_name,
            updated_by=m.updated_by,
            updated_by_name=u_name,
            created_at=m.created_at,
            updated_at=m.updated_at,
        )

    async def _to_asset_read(self, asset: HrmsAsset, include_history: bool = True) -> AssetRead:
        """Transform an ORM HrmsAsset into the AssetRead schema with enriched relations."""
        assigned_name = None
        assigned_code = None
        assigned_dept = None
        assigned_branch = None

        assigned_user = asset.assigned_to
        if not assigned_user and asset.assigned_to_user_id:
            user_res = await self.db.execute(select(User).where(User.id == asset.assigned_to_user_id))
            assigned_user = user_res.scalar_one_or_none()

        if assigned_user:
            first = assigned_user.first_name or ""
            last = assigned_user.last_name or ""
            assigned_name = f"{first} {last}".strip() or assigned_user.username or "Employee"
            assigned_code = assigned_user.employee_code
            assigned_dept = await self._resolve_employee_department(assigned_user.id)
            assigned_branch = await self._resolve_employee_branch(assigned_user.id)

        location_obj = asset.location
        if not location_obj and asset.location_id:
            loc_res = await self.db.execute(select(HrmsLocation).where(HrmsLocation.id == asset.location_id))
            location_obj = loc_res.scalar_one_or_none()
        location_name = location_obj.name if location_obj else None

        created_by_name = None
        if asset.creator:
            c_first = asset.creator.first_name or ""
            c_last = asset.creator.last_name or ""
            created_by_name = f"{c_first} {c_last}".strip() or asset.creator.username

        updated_by_name = None
        if asset.updater:
            u_first = asset.updater.first_name or ""
            u_last = asset.updater.last_name or ""
            updated_by_name = f"{u_first} {u_last}".strip() or asset.updater.username

        history_items: list[AssetHistoryRead] = []
        if include_history and asset.history:
            for h in asset.history:
                perf_name = None
                if h.performer:
                    p_first = h.performer.first_name or ""
                    p_last = h.performer.last_name or ""
                    perf_name = f"{p_first} {p_last}".strip() or h.performer.username or "System User"

                user_name = None
                if h.user:
                    u_first = h.user.first_name or ""
                    u_last = h.user.last_name or ""
                    user_name = f"{u_first} {u_last}".strip() or h.user.username or "Employee"

                history_items.append(
                    AssetHistoryRead(
                        id=h.id,
                        asset_id=h.asset_id,
                        action=h.action,
                        previous_value=h.previous_value,
                        new_value=h.new_value,
                        user_id=h.user_id,
                        user_name=user_name,
                        performed_by=h.performed_by,
                        performed_by_name=perf_name,
                        notes=h.notes,
                        created_at=h.created_at,
                    )
                )

        # Active assignment
        active_assignment_dto = None
        expected_ret_date = None
        assign_count = 0
        if hasattr(asset, "assignments") and asset.assignments:
            assign_count = len(asset.assignments)
            active_assign = next((a for a in asset.assignments if a.assignment_status == "ACTIVE"), None)
            if active_assign:
                expected_ret_date = active_assign.expected_return_date
                active_assignment_dto = await self._to_assignment_read(active_assign)
        elif asset.assigned_to_user_id:
            act_stmt = select(HrmsAssetAssignment).where(
                HrmsAssetAssignment.asset_id == asset.id,
                HrmsAssetAssignment.assignment_status == "ACTIVE",
            )
            act_res = await self.db.execute(act_stmt)
            active_assign = act_res.scalar_one_or_none()
            if active_assign:
                expected_ret_date = active_assign.expected_return_date
                active_assignment_dto = await self._to_assignment_read(active_assign)

        maint_count = 0
        if hasattr(asset, "maintenance_records") and asset.maintenance_records:
            maint_count = len(asset.maintenance_records)
        else:
            m_cnt_stmt = select(func.count(HrmsAssetMaintenance.id)).where(HrmsAssetMaintenance.asset_id == asset.id)
            m_cnt_res = await self.db.execute(m_cnt_stmt)
            maint_count = m_cnt_res.scalar() or 0

        return AssetRead(
            id=asset.id,
            asset_code=asset.asset_code,
            asset_name=asset.asset_name,
            asset_category=asset.asset_category,
            brand=asset.brand,
            model=asset.model,
            serial_number=asset.serial_number,
            purchase_date=asset.purchase_date,
            purchase_cost=asset.purchase_cost,
            vendor=asset.vendor,
            warranty_expiry=asset.warranty_expiry,
            condition=asset.condition,
            status=asset.status,
            location_id=asset.location_id,
            location_name=location_name,
            branch_name=location_name,
            description=asset.description,
            assigned_to_user_id=asset.assigned_to_user_id,
            assigned_to_name=assigned_name,
            assigned_to_code=assigned_code,
            assigned_to_department=assigned_dept,
            assigned_to_branch=assigned_branch,
            assigned_date=asset.assigned_date,
            expected_return_date=expected_ret_date,
            created_by=asset.created_by,
            created_by_name=created_by_name,
            updated_by=asset.updated_by,
            updated_by_name=updated_by_name,
            created_at=asset.created_at,
            updated_at=asset.updated_at,
            history=history_items,
            assignments_count=assign_count,
            maintenance_count=maint_count,
            active_assignment=active_assignment_dto,
        )

    # -----------------------------------------------------------------------
    # Asset List & Search & Summary
    # -----------------------------------------------------------------------

    async def list_assets(
        self,
        search: Optional[str] = None,
        status: Optional[str] = None,
        category: Optional[str] = None,
        assigned_to_user_id: Optional[uuid.UUID] = None,
        location_id: Optional[uuid.UUID] = None,
        assigned_status: Optional[str] = None,
        warranty_status: Optional[str] = None,
        page: Optional[int] = None,
        page_size: Optional[int] = None,
    ) -> list[AssetRead]:
        """Query and return active company assets matching search and filter parameters."""
        query = (
            select(HrmsAsset)
            .where(HrmsAsset.deleted_at.is_(None))
            .options(
                selectinload(HrmsAsset.assigned_to),
                selectinload(HrmsAsset.location),
                selectinload(HrmsAsset.creator),
                selectinload(HrmsAsset.updater),
                selectinload(HrmsAsset.history).selectinload(HrmsAssetHistory.performer),
                selectinload(HrmsAsset.history).selectinload(HrmsAssetHistory.user),
                selectinload(HrmsAsset.assignments).selectinload(HrmsAssetAssignment.employee),
                selectinload(HrmsAsset.assignments).selectinload(HrmsAssetAssignment.assigner),
                selectinload(HrmsAsset.assignments).selectinload(HrmsAssetAssignment.returner),
                selectinload(HrmsAsset.maintenance_records).selectinload(HrmsAssetMaintenance.creator),
                selectinload(HrmsAsset.maintenance_records).selectinload(HrmsAssetMaintenance.updater),
            )
            .order_by(HrmsAsset.asset_code.asc())
        )

        if status and status.upper() != "ALL":
            s_up = status.upper()
            if s_up == "MAINTENANCE":
                query = query.where(func.upper(HrmsAsset.status).in_(["MAINTENANCE", "UNDER_MAINTENANCE"]))
            else:
                query = query.where(func.upper(HrmsAsset.status) == s_up)

        if category and category.upper() != "ALL":
            query = query.where(func.upper(HrmsAsset.asset_category) == category.upper())

        if location_id:
            query = query.where(HrmsAsset.location_id == location_id)

        if assigned_to_user_id:
            query = query.where(HrmsAsset.assigned_to_user_id == assigned_to_user_id)

        if assigned_status:
            ast = assigned_status.upper()
            if ast == "ASSIGNED":
                query = query.where(
                    or_(
                        HrmsAsset.assigned_to_user_id.isnot(None),
                        func.upper(HrmsAsset.status).in_(["ASSIGNED", "IN_USE"]),
                    )
                )
            elif ast == "UNASSIGNED":
                query = query.where(
                    HrmsAsset.assigned_to_user_id.is_(None),
                    ~func.upper(HrmsAsset.status).in_(["ASSIGNED", "IN_USE"]),
                )

        if warranty_status:
            w_up = warranty_status.upper()
            today = date.today()
            if w_up == "ACTIVE":
                query = query.where(HrmsAsset.warranty_expiry >= today)
            elif w_up in ("EXPIRING_SOON", "EXPIRING"):
                thirty_days = today + timedelta(days=30)
                query = query.where(HrmsAsset.warranty_expiry >= today, HrmsAsset.warranty_expiry <= thirty_days)
            elif w_up == "EXPIRED":
                query = query.where(HrmsAsset.warranty_expiry < today)
            elif w_up in ("NO_WARRANTY", "NONE"):
                query = query.where(HrmsAsset.warranty_expiry.is_(None))

        if search and search.strip():
            term = f"%{search.strip().lower()}%"
            query = query.outerjoin(HrmsAsset.assigned_to).where(
                or_(
                    func.lower(HrmsAsset.asset_name).like(term),
                    func.lower(HrmsAsset.asset_code).like(term),
                    func.lower(HrmsAsset.serial_number).like(term),
                    func.lower(HrmsAsset.brand).like(term),
                    func.lower(HrmsAsset.model).like(term),
                    func.lower(HrmsAsset.vendor).like(term),
                    func.lower(User.first_name).like(term),
                    func.lower(User.last_name).like(term),
                    func.lower(User.username).like(term),
                    func.lower(User.employee_code).like(term),
                )
            )

        if page and page_size and page > 0 and page_size > 0:
            query = query.offset((page - 1) * page_size).limit(page_size)

        res = await self.db.execute(query)
        assets = res.scalars().all()
        return [await self._to_asset_read(a) for a in assets]

    async def get_summary(self) -> AssetSummaryRead:
        """Compute aggregate counts directly from PostgreSQL database."""
        base_filter = HrmsAsset.deleted_at.is_(None)

        total_stmt = select(func.count(HrmsAsset.id)).where(base_filter)
        avail_stmt = select(func.count(HrmsAsset.id)).where(base_filter, func.upper(HrmsAsset.status) == "AVAILABLE")
        assigned_stmt = select(func.count(HrmsAsset.id)).where(
            base_filter,
            or_(
                func.upper(HrmsAsset.status).in_(["ASSIGNED", "IN_USE"]),
                HrmsAsset.assigned_to_user_id.isnot(None),
            ),
        )
        maint_stmt = select(func.count(HrmsAsset.id)).where(
            base_filter,
            func.upper(HrmsAsset.status).in_(["MAINTENANCE", "UNDER_MAINTENANCE"]),
        )
        damaged_stmt = select(func.count(HrmsAsset.id)).where(base_filter, func.upper(HrmsAsset.status) == "DAMAGED")
        lost_stmt = select(func.count(HrmsAsset.id)).where(base_filter, func.upper(HrmsAsset.status) == "LOST")
        retired_stmt = select(func.count(HrmsAsset.id)).where(base_filter, func.upper(HrmsAsset.status) == "RETIRED")

        total = (await self.db.execute(total_stmt)).scalar() or 0
        avail = (await self.db.execute(avail_stmt)).scalar() or 0
        assigned = (await self.db.execute(assigned_stmt)).scalar() or 0
        maint = (await self.db.execute(maint_stmt)).scalar() or 0
        damaged = (await self.db.execute(damaged_stmt)).scalar() or 0
        lost = (await self.db.execute(lost_stmt)).scalar() or 0
        retired = (await self.db.execute(retired_stmt)).scalar() or 0

        return AssetSummaryRead(
            total_assets=total,
            available=avail,
            assigned=assigned,
            in_maintenance=maint,
            damaged=damaged,
            lost=lost,
            retired=retired,
        )

    # -----------------------------------------------------------------------
    # Asset Detail by ID
    # -----------------------------------------------------------------------

    async def get_asset(self, asset_id: uuid.UUID) -> AssetRead:
        """Fetch a single asset by UUID with full relations, history, assignments, and maintenance."""
        query = (
            select(HrmsAsset)
            .where(HrmsAsset.id == asset_id, HrmsAsset.deleted_at.is_(None))
            .options(
                selectinload(HrmsAsset.assigned_to),
                selectinload(HrmsAsset.location),
                selectinload(HrmsAsset.creator),
                selectinload(HrmsAsset.updater),
                selectinload(HrmsAsset.history).selectinload(HrmsAssetHistory.performer),
                selectinload(HrmsAsset.history).selectinload(HrmsAssetHistory.user),
                selectinload(HrmsAsset.assignments).selectinload(HrmsAssetAssignment.employee),
                selectinload(HrmsAsset.assignments).selectinload(HrmsAssetAssignment.assigner),
                selectinload(HrmsAsset.assignments).selectinload(HrmsAssetAssignment.returner),
                selectinload(HrmsAsset.maintenance_records).selectinload(HrmsAssetMaintenance.creator),
                selectinload(HrmsAsset.maintenance_records).selectinload(HrmsAssetMaintenance.updater),
            )
        )
        res = await self.db.execute(query)
        asset = res.scalar_one_or_none()
        if not asset:
            raise NotFoundException("Asset not found.")
        return await self._to_asset_read(asset, include_history=True)

    # -----------------------------------------------------------------------
    # Create Asset
    # -----------------------------------------------------------------------

    async def _generate_asset_code(self) -> str:
        """Generate a sequential unique AST-XXXX identifier based on total asset count."""
        count_query = select(func.count(HrmsAsset.id))
        count_res = await self.db.execute(count_query)
        cnt = (count_res.scalar() or 0) + 1

        while True:
            candidate = f"AST-{cnt:04d}"
            exist_query = select(HrmsAsset.id).where(HrmsAsset.asset_code == candidate)
            exist_res = await self.db.execute(exist_query)
            if not exist_res.scalar_one_or_none():
                return candidate
            cnt += 1

    async def create_asset(
        self,
        payload: AssetCreate,
        actor_id: Optional[uuid.UUID] = None,
    ) -> AssetRead:
        """Register a new asset in the system."""
        # 1. Determine & Validate Asset Code
        asset_code = payload.asset_code.strip() if payload.asset_code else None
        if not asset_code:
            asset_code = await self._generate_asset_code()
        else:
            code_check = await self.db.execute(
                select(HrmsAsset).where(
                    HrmsAsset.asset_code == asset_code,
                    HrmsAsset.deleted_at.is_(None),
                )
            )
            if code_check.scalar_one_or_none():
                raise ConflictException(f"Asset code '{asset_code}' is already registered.")

        # 2. Check Serial Number Uniqueness if provided
        clean_serial = payload.serial_number.strip() if payload.serial_number else None
        if clean_serial:
            sn_check = await self.db.execute(
                select(HrmsAsset).where(
                    HrmsAsset.serial_number == clean_serial,
                    HrmsAsset.deleted_at.is_(None),
                )
            )
            if sn_check.scalar_one_or_none():
                raise ConflictException(f"Asset with serial number '{clean_serial}' already exists.")

        # 3. Check Location ID if provided
        if payload.location_id:
            loc_check = await self.db.execute(
                select(HrmsLocation.id).where(
                    HrmsLocation.id == payload.location_id,
                    HrmsLocation.deleted_at.is_(None),
                )
            )
            if not loc_check.scalar_one_or_none():
                raise BadRequestException("Office branch / location not found.")

        # 4. Status validation
        status = (payload.status or "AVAILABLE").upper()
        if status not in VALID_ASSET_STATUSES:
            raise BadRequestException(f"Invalid status '{payload.status}'. Valid statuses: {VALID_ASSET_STATUSES}")

        new_asset = HrmsAsset(
            asset_code=asset_code,
            asset_name=payload.asset_name.strip(),
            asset_category=payload.asset_category.strip(),
            brand=payload.brand.strip() if payload.brand else None,
            model=payload.model.strip() if payload.model else None,
            serial_number=clean_serial,
            purchase_date=payload.purchase_date,
            purchase_cost=payload.purchase_cost,
            vendor=payload.vendor.strip() if payload.vendor else None,
            warranty_expiry=payload.warranty_expiry,
            condition=payload.condition or "GOOD",
            status=status,
            location_id=payload.location_id,
            description=payload.description.strip() if payload.description else None,
            created_by=actor_id,
            updated_by=actor_id,
        )
        self.db.add(new_asset)
        await self.db.flush()

        # Audit History Entry
        history = HrmsAssetHistory(
            asset_id=new_asset.id,
            action="CREATED",
            previous_value=None,
            new_value=f"Code: {asset_code}, Category: {new_asset.asset_category}, Status: {new_asset.status}",
            performed_by=actor_id,
            notes="Asset created and registered into enterprise inventory.",
        )
        self.db.add(history)

        await self.db.commit()
        return await self.get_asset(new_asset.id)

    # -----------------------------------------------------------------------
    # Update Asset Metadata
    # -----------------------------------------------------------------------

    async def update_asset(
        self,
        asset_id: uuid.UUID,
        payload: AssetUpdate,
        actor_id: Optional[uuid.UUID] = None,
    ) -> AssetRead:
        """Update asset metadata, description, and conditions."""
        query = (
            select(HrmsAsset)
            .where(HrmsAsset.id == asset_id, HrmsAsset.deleted_at.is_(None))
        )
        res = await self.db.execute(query)
        asset = res.scalar_one_or_none()
        if not asset:
            raise NotFoundException("Asset not found.")

        # Check serial number conflict if changed
        if payload.serial_number is not None:
            clean_sn = payload.serial_number.strip() if payload.serial_number else None
            if clean_sn and clean_sn != asset.serial_number:
                sn_check = await self.db.execute(
                    select(HrmsAsset).where(
                        HrmsAsset.serial_number == clean_sn,
                        HrmsAsset.id != asset.id,
                        HrmsAsset.deleted_at.is_(None),
                    )
                )
                if sn_check.scalar_one_or_none():
                    raise ConflictException(f"Serial number '{clean_sn}' is already registered to another asset.")
            asset.serial_number = clean_sn

        # Check location
        if payload.location_id is not None:
            if payload.location_id:
                loc_check = await self.db.execute(
                    select(HrmsLocation.id).where(
                        HrmsLocation.id == payload.location_id,
                        HrmsLocation.deleted_at.is_(None),
                    )
                )
                if not loc_check.scalar_one_or_none():
                    raise BadRequestException("Office branch / location not found.")
            asset.location_id = payload.location_id

        # Status validation if updated directly
        if payload.status is not None:
            s_up = payload.status.upper()
            if s_up not in VALID_ASSET_STATUSES:
                raise BadRequestException(f"Invalid status '{payload.status}'. Valid statuses: {VALID_ASSET_STATUSES}")
            asset.status = s_up

        changes: list[str] = []
        if payload.asset_name is not None and payload.asset_name.strip() != asset.asset_name:
            changes.append(f"Name: {asset.asset_name} -> {payload.asset_name.strip()}")
            asset.asset_name = payload.asset_name.strip()

        if payload.asset_category is not None and payload.asset_category.strip() != asset.asset_category:
            changes.append(f"Category: {asset.asset_category} -> {payload.asset_category.strip()}")
            asset.asset_category = payload.asset_category.strip()

        if payload.brand is not None:
            asset.brand = payload.brand.strip() if payload.brand else None
        if payload.model is not None:
            asset.model = payload.model.strip() if payload.model else None
        if payload.purchase_date is not None:
            asset.purchase_date = payload.purchase_date
        if payload.purchase_cost is not None:
            asset.purchase_cost = payload.purchase_cost
        if payload.vendor is not None:
            asset.vendor = payload.vendor.strip() if payload.vendor else None
        if payload.warranty_expiry is not None:
            asset.warranty_expiry = payload.warranty_expiry
        if payload.condition is not None:
            asset.condition = payload.condition
        if payload.description is not None:
            asset.description = payload.description.strip() if payload.description else None

        asset.updated_by = actor_id

        if changes:
            history = HrmsAssetHistory(
                asset_id=asset.id,
                action="METADATA_UPDATED",
                previous_value=None,
                new_value="; ".join(changes),
                performed_by=actor_id,
                notes="Asset fields updated via admin management console.",
            )
            self.db.add(history)

        await self.db.commit()
        return await self.get_asset(asset.id)

    # -----------------------------------------------------------------------
    # Status Update
    # -----------------------------------------------------------------------

    async def update_asset_status(
        self,
        asset_id: uuid.UUID,
        payload: AssetStatusUpdate,
        actor_id: Optional[uuid.UUID] = None,
    ) -> AssetRead:
        """Direct status transition (e.g. Under Maintenance, Damaged, Lost, Retired)."""
        query = (
            select(HrmsAsset)
            .where(HrmsAsset.id == asset_id, HrmsAsset.deleted_at.is_(None))
        )
        res = await self.db.execute(query)
        asset = res.scalar_one_or_none()
        if not asset:
            raise NotFoundException("Asset not found.")

        new_status = payload.status.upper()
        if new_status not in VALID_ASSET_STATUSES:
            raise BadRequestException(f"Invalid status '{payload.status}'. Valid statuses: {VALID_ASSET_STATUSES}")

        if new_status in ("ASSIGNED", "IN_USE") and not asset.assigned_to_user_id:
            raise BadRequestException("Cannot transition status to ASSIGNED without an active employee assignment.")

        old_status = asset.status
        if old_status == new_status:
            return await self.get_asset(asset.id)

        asset.status = new_status
        asset.updated_by = actor_id

        # If retiring or marking lost, unassign employee automatically and close active assignment
        if new_status in ("RETIRED", "LOST") and asset.assigned_to_user_id:
            act_assign_stmt = select(HrmsAssetAssignment).where(
                HrmsAssetAssignment.asset_id == asset.id,
                HrmsAssetAssignment.assignment_status == "ACTIVE",
            )
            act_res = await self.db.execute(act_assign_stmt)
            act_assign = act_res.scalar_one_or_none()
            if act_assign:
                act_assign.returned_at = date.today()
                act_assign.condition_at_return = "LOST" if new_status == "LOST" else asset.condition
                act_assign.return_notes = f"Closed due to asset transition to {new_status}"
                act_assign.assignment_status = "RETURNED"
                act_assign.returned_by = actor_id
            asset.assigned_to_user_id = None
            asset.assigned_date = None

        history = HrmsAssetHistory(
            asset_id=asset.id,
            action="STATUS_CHANGED",
            previous_value=old_status,
            new_value=new_status,
            performed_by=actor_id,
            notes=payload.notes or f"Status changed from {old_status} to {new_status}",
        )
        self.db.add(history)
        await self.db.commit()

        return await self.get_asset(asset.id)

    # -----------------------------------------------------------------------
    # Employee Assignment & Return Workflows (hrms_asset_assignments)
    # -----------------------------------------------------------------------

    async def assign_asset(
        self,
        asset_id: uuid.UUID,
        payload: AssetAssign,
        actor_id: Optional[uuid.UUID] = None,
    ) -> AssetRead:
        """Assign asset to a real employee. Enforces one active assignment rule."""
        query = (
            select(HrmsAsset)
            .where(HrmsAsset.id == asset_id, HrmsAsset.deleted_at.is_(None))
        )
        res = await self.db.execute(query)
        asset = res.scalar_one_or_none()
        if not asset:
            raise NotFoundException("Asset not found.")

        # Business check: disallow assigning retired, lost, damaged, or maintenance assets
        if asset.status in ("RETIRED", "LOST", "DAMAGED", "MAINTENANCE", "UNDER_MAINTENANCE"):
            raise BadRequestException(f"Cannot assign asset in '{asset.status}' status. Update status first.")

        # Check ONE ACTIVE ASSIGNMENT rule at the service level
        existing_assign_query = select(HrmsAssetAssignment).where(
            HrmsAssetAssignment.asset_id == asset.id,
            HrmsAssetAssignment.assignment_status == "ACTIVE",
        )
        existing_assign_res = await self.db.execute(existing_assign_query)
        existing_assign = existing_assign_res.scalar_one_or_none()
        if existing_assign or asset.assigned_to_user_id is not None:
            raise ConflictException("Asset is already assigned to an employee. Return it first before reassigning.")

        # Validate employee from real users table
        emp_query = (
            select(User)
            .where(
                User.id == payload.employee_id,
                User.deleted_at.is_(None),
                User.is_active.is_(True),
            )
        )
        emp_res = await self.db.execute(emp_query)
        employee = emp_res.scalar_one_or_none()
        if not employee:
            raise BadRequestException("Employee not found or inactive in the database.")

        target_location_id = payload.assigned_location_id or payload.location_id
        if target_location_id:
            loc_check = await self.db.execute(
                select(HrmsLocation.id).where(
                    HrmsLocation.id == target_location_id,
                    HrmsLocation.deleted_at.is_(None),
                )
            )
            if not loc_check.scalar_one_or_none():
                raise BadRequestException("Assigned office location not found.")
            asset.location_id = target_location_id

        assigned_condition = payload.condition_at_assignment or payload.condition or asset.condition or "GOOD"
        asset.condition = assigned_condition

        emp_full_name = f"{employee.first_name or ''} {employee.last_name or ''}".strip() or employee.username or "Employee"
        emp_display = f"{emp_full_name} ({employee.employee_code or 'No Code'})"

        # Update Asset master
        prev_user_id = asset.assigned_to_user_id
        asset.assigned_to_user_id = employee.id
        asset.assigned_date = payload.assigned_date
        asset.status = "ASSIGNED"
        asset.updated_by = actor_id

        # Create persistent HrmsAssetAssignment record
        assignment_record = HrmsAssetAssignment(
            asset_id=asset.id,
            employee_id=employee.id,
            assigned_at=payload.assigned_date,
            expected_return_date=payload.expected_return_date,
            assignment_status="ACTIVE",
            condition_at_assignment=assigned_condition,
            assignment_notes=payload.notes,
            assigned_by=actor_id,
        )
        self.db.add(assignment_record)

        # Record History audit
        history = HrmsAssetHistory(
            asset_id=asset.id,
            action="ASSIGNED",
            previous_value=f"Previous user ID: {prev_user_id}" if prev_user_id else "Unassigned",
            new_value=f"Assigned to {emp_display}",
            user_id=employee.id,
            performed_by=actor_id,
            notes=payload.notes,
        )
        self.db.add(history)

        await self.db.commit()
        return await self.get_asset(asset.id)

    async def return_asset(
        self,
        asset_id: uuid.UUID,
        payload: AssetReturn,
        actor_id: Optional[uuid.UUID] = None,
    ) -> AssetRead:
        """Return an assigned asset back to AVAILABLE status with atomic transaction logging."""
        query = (
            select(HrmsAsset)
            .where(HrmsAsset.id == asset_id, HrmsAsset.deleted_at.is_(None))
            .options(selectinload(HrmsAsset.assigned_to))
        )
        res = await self.db.execute(query)
        asset = res.scalar_one_or_none()
        if not asset:
            raise NotFoundException("Asset not found.")

        if not asset.assigned_to_user_id:
            raise BadRequestException("Asset is not currently assigned to any employee.")

        # Identify previous assignee
        prev_user_id = asset.assigned_to_user_id
        prev_name = "Employee"
        if asset.assigned_to:
            first = asset.assigned_to.first_name or ""
            last = asset.assigned_to.last_name or ""
            prev_name = f"{first} {last}".strip() or asset.assigned_to.username or "Employee"

        ret_condition = payload.condition_after_return or payload.condition or "GOOD"
        asset.condition = ret_condition

        ret_loc = payload.return_location_id or payload.location_id
        if ret_loc:
            loc_check = await self.db.execute(
                select(HrmsLocation.id).where(
                    HrmsLocation.id == ret_loc,
                    HrmsLocation.deleted_at.is_(None),
                )
            )
            if not loc_check.scalar_one_or_none():
                raise BadRequestException("Return office location not found.")
            asset.location_id = ret_loc

        # Close active assignment in HrmsAssetAssignment table
        active_assign_query = select(HrmsAssetAssignment).where(
            HrmsAssetAssignment.asset_id == asset.id,
            HrmsAssetAssignment.assignment_status == "ACTIVE",
        )
        active_assign_res = await self.db.execute(active_assign_query)
        active_assignment = active_assign_res.scalar_one_or_none()
        if active_assignment:
            active_assignment.returned_at = payload.return_date
            active_assignment.condition_at_return = ret_condition
            active_assignment.return_notes = payload.notes
            active_assignment.returned_by = actor_id
            active_assignment.assignment_status = "RETURNED"

        # Update Asset status based on return condition
        if ret_condition.upper() in ("DAMAGED", "POOR"):
            asset.status = "DAMAGED"
        elif ret_condition.upper() == "LOST":
            asset.status = "LOST"
        else:
            asset.status = "AVAILABLE"

        asset.assigned_to_user_id = None
        asset.assigned_date = None
        asset.updated_by = actor_id

        # Record History audit
        history = HrmsAssetHistory(
            asset_id=asset.id,
            action="RETURNED",
            previous_value=f"Assigned to {prev_name}",
            new_value=f"Returned to {asset.status} (Condition: {ret_condition})",
            user_id=prev_user_id,
            performed_by=actor_id,
            notes=payload.notes,
        )
        self.db.add(history)

        await self.db.commit()
        return await self.get_asset(asset.id)

    async def list_assignments(self, asset_id: uuid.UUID) -> list[AssetAssignmentRead]:
        """Fetch complete assignment lifecycle history for an asset."""
        query = (
            select(HrmsAssetAssignment)
            .where(HrmsAssetAssignment.asset_id == asset_id)
            .options(
                selectinload(HrmsAssetAssignment.employee),
                selectinload(HrmsAssetAssignment.assigner),
                selectinload(HrmsAssetAssignment.returner),
            )
            .order_by(desc(HrmsAssetAssignment.assigned_at))
        )
        res = await self.db.execute(query)
        records = res.scalars().all()
        return [await self._to_assignment_read(r) for r in records]

    # -----------------------------------------------------------------------
    # Maintenance Workflow (hrms_asset_maintenance)
    # -----------------------------------------------------------------------

    async def create_maintenance(
        self,
        asset_id: uuid.UUID,
        payload: AssetMaintenanceCreate,
        actor_id: Optional[uuid.UUID] = None,
    ) -> AssetMaintenanceRead:
        """Log a new maintenance / servicing record for an asset."""
        query = (
            select(HrmsAsset)
            .where(HrmsAsset.id == asset_id, HrmsAsset.deleted_at.is_(None))
        )
        res = await self.db.execute(query)
        asset = res.scalar_one_or_none()
        if not asset:
            raise NotFoundException("Asset not found.")

        maint = HrmsAssetMaintenance(
            asset_id=asset.id,
            issue=payload.issue.strip(),
            reported_date=payload.reported_date,
            maintenance_start=payload.maintenance_start,
            maintenance_end=payload.maintenance_end,
            vendor_technician=payload.vendor_technician.strip() if payload.vendor_technician else None,
            cost=payload.cost,
            status=payload.status.upper(),
            notes=payload.notes.strip() if payload.notes else None,
            created_by=actor_id,
            updated_by=actor_id,
        )
        self.db.add(maint)

        # If maintenance is active, set asset status to MAINTENANCE
        if payload.status.upper() in ("OPEN", "IN_PROGRESS"):
            asset.status = "MAINTENANCE"
            asset.updated_by = actor_id

        history = HrmsAssetHistory(
            asset_id=asset.id,
            action="MAINTENANCE_LOGGED",
            previous_value=None,
            new_value=f"Issue: {payload.issue} (Status: {payload.status.upper()})",
            performed_by=actor_id,
            notes=payload.notes,
        )
        self.db.add(history)

        await self.db.commit()
        await self.db.refresh(maint)
        return await self._to_maintenance_read(maint)

    async def list_maintenance(self, asset_id: uuid.UUID) -> list[AssetMaintenanceRead]:
        """Fetch all maintenance and service records for an asset."""
        query = (
            select(HrmsAssetMaintenance)
            .where(HrmsAssetMaintenance.asset_id == asset_id)
            .options(
                selectinload(HrmsAssetMaintenance.creator),
                selectinload(HrmsAssetMaintenance.updater),
            )
            .order_by(desc(HrmsAssetMaintenance.reported_date))
        )
        res = await self.db.execute(query)
        records = res.scalars().all()
        return [await self._to_maintenance_read(r) for r in records]

    # -----------------------------------------------------------------------
    # Branch / Location Movement
    # -----------------------------------------------------------------------

    async def move_branch(
        self,
        asset_id: uuid.UUID,
        payload: AssetMove,
        actor_id: Optional[uuid.UUID] = None,
    ) -> AssetRead:
        """Transfer an asset to a new office branch / location."""
        query = (
            select(HrmsAsset)
            .where(HrmsAsset.id == asset_id, HrmsAsset.deleted_at.is_(None))
            .options(selectinload(HrmsAsset.location))
        )
        res = await self.db.execute(query)
        asset = res.scalar_one_or_none()
        if not asset:
            raise NotFoundException("Asset not found.")

        # Check target location
        loc_res = await self.db.execute(
            select(HrmsLocation).where(HrmsLocation.id == payload.location_id, HrmsLocation.deleted_at.is_(None))
        )
        new_loc = loc_res.scalar_one_or_none()
        if not new_loc:
            raise BadRequestException("Target office branch / location not found.")

        old_loc_name = asset.location.name if asset.location else "None"
        new_loc_name = new_loc.name

        asset.location_id = new_loc.id
        asset.location = new_loc
        asset.updated_by = actor_id

        history = HrmsAssetHistory(
            asset_id=asset.id,
            action="BRANCH_TRANSFER",
            previous_value=f"Branch: {old_loc_name}",
            new_value=f"Branch: {new_loc_name}",
            performed_by=actor_id,
            notes=payload.reason or f"Transferred from {old_loc_name} to {new_loc_name}",
        )
        self.db.add(history)

        await self.db.commit()
        return await self.get_asset(asset.id)

    # -----------------------------------------------------------------------
    # Audit & History Fetch
    # -----------------------------------------------------------------------

    async def get_asset_history(self, asset_id: uuid.UUID) -> list[AssetHistoryRead]:
        """Fetch audit trail for a specific asset."""
        query = (
            select(HrmsAssetHistory)
            .where(HrmsAssetHistory.asset_id == asset_id)
            .options(
                selectinload(HrmsAssetHistory.performer),
                selectinload(HrmsAssetHistory.user),
            )
            .order_by(desc(HrmsAssetHistory.created_at))
        )
        res = await self.db.execute(query)
        records = res.scalars().all()

        history_items: list[AssetHistoryRead] = []
        for h in records:
            perf_name = None
            if h.performer:
                p_first = h.performer.first_name or ""
                p_last = h.performer.last_name or ""
                perf_name = f"{p_first} {p_last}".strip() or h.performer.username or "System User"

            user_name = None
            if h.user:
                u_first = h.user.first_name or ""
                u_last = h.user.last_name or ""
                user_name = f"{u_first} {u_last}".strip() or h.user.username or "Employee"

            history_items.append(
                AssetHistoryRead(
                    id=h.id,
                    asset_id=h.asset_id,
                    action=h.action,
                    previous_value=h.previous_value,
                    new_value=h.new_value,
                    user_id=h.user_id,
                    user_name=user_name,
                    performed_by=h.performed_by,
                    performed_by_name=perf_name,
                    notes=h.notes,
                    created_at=h.created_at,
                )
            )
        return history_items

    # -----------------------------------------------------------------------
    # Soft-Delete / Retire Asset
    # -----------------------------------------------------------------------

    async def delete_asset(
        self,
        asset_id: uuid.UUID,
        actor_id: Optional[uuid.UUID] = None,
    ) -> None:
        """Retire an asset by soft-deletion and record audit history."""
        query = (
            select(HrmsAsset)
            .where(HrmsAsset.id == asset_id, HrmsAsset.deleted_at.is_(None))
        )
        res = await self.db.execute(query)
        asset = res.scalar_one_or_none()
        if not asset:
            raise NotFoundException("Asset not found.")

        # Business rule: disallow deleting an asset with an active employee assignment
        if asset.assigned_to_user_id:
            raise BadRequestException("Cannot delete or retire an asset with an active employee assignment. Return it first.")

        asset.status = "RETIRED"
        asset.deleted_at = datetime.now(timezone.utc)
        asset.updated_by = actor_id

        history = HrmsAssetHistory(
            asset_id=asset.id,
            action="RETIRED",
            previous_value=f"Code: {asset.asset_code}",
            new_value="Asset soft-deleted and retired from service.",
            performed_by=actor_id,
            notes="Asset marked as permanently retired.",
        )
        self.db.add(history)
        await self.db.commit()
