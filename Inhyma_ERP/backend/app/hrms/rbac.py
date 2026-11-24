"""
HRMS Centralized Role-Based Access Control (RBAC).

Enforces the HRMS Access Model:
- ADMIN: Company-wide access across all modules, all employees, all departments.
- HR: Company-wide access within HRMS modules (Attendance, Leave, Assets, Expenses, Site Visits, Payroll).
      Admin can block/grant HR's access to individual HRMS modules.
      Salary Configuration and Payroll Approval permitted only if Admin granted.
      No User Management or ERP-wide admin access.
- DEPARTMENT MANAGER: Scope restricted strictly to employees belonging to their department or reporting to them.
- EMPLOYEE: Scope restricted strictly to their own records. Cannot access other employees' data.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
import uuid
from dataclasses import dataclass, field
from typing import Optional, Set

IST = timezone(timedelta(hours=5, minutes=30))

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_auth_service
from app.auth.service import AuthService
from app.database.session import get_db_session
from app.rbac.models import Role, RoleAssignmentStatus, UserRole
from app.users.models import EmploymentStatus, User, UserStatus


@dataclass
class HrmsUserContext:
    user_id: uuid.UUID
    username: str
    email: str
    display_name: str
    is_super_admin: bool
    is_admin: bool
    is_hr: bool
    is_manager: bool
    department: Optional[str]
    roles: list[str] = field(default_factory=list)
    permissions: Set[str] = field(default_factory=set)
    managed_employee_ids: Set[uuid.UUID] = field(default_factory=set)

    def can_access_module(self, module_name: str) -> bool:
        """Verify whether user is allowed to access this HRMS module."""
        if self.is_admin:
            return True

        mod = module_name.lower().replace("-", "_")
        if mod == "site_visit":
            mod = "site_visits"
        elif mod == "asset":
            mod = "assets"
        elif mod == "expense":
            mod = "expenses"

        # Explicit deny / blocked tag (module-specific or global HRMS view deny)
        blocked_perms = {
            f"deny:hrms.{mod}",
            f"block:hrms.{mod}",
            f"deny:hrms.{mod}s",
            f"block:hrms.{mod}s",
            "deny:hrms.view",
            "block:hrms.view",
            "deny:hrms",
            "block:hrms",
        }
        if any(b in self.permissions for b in blocked_perms):
            return False

        # HR Role module check:
        # HR has permissions seeded in role_permissions (hrms.attendance, hrms.leave, hrms.assets, hrms.expenses, hrms.site_visits, hrms.payroll).
        # If Admin explicitly revoked a module permission from HR, it is subtracted from self.permissions.
        if self.is_hr:
            if mod in ("setup", "payroll_setup"):
                mod_perms = {"hrms.setup", "hrms.setup.view", "hrms.manage", "hrms.view"}
            elif mod == "payroll":
                mod_perms = {"hrms.payroll", "hrms.payroll.view", "hrms.payroll.configure", "hrms.payroll.approve"}
            else:
                mod_perms = {f"hrms.{mod}", f"hrms.{mod}.view", f"hrms.{mod}s"}
            if not any(p in self.permissions for p in mod_perms):
                return False
            return True

        # Department Manager and Normal Employee can access self-service / department modules:
        # Attendance, Leave, Assets, Expenses, Site Visits, Payroll (payslips)
        if mod in ("attendance", "leave", "assets", "expenses", "site_visits", "payroll"):
            return True

        # Setup / Global Configuration is strictly Admin / HR with setup/manage
        if mod in ("setup", "payroll_setup"):
            return False

        return False

    def require_module_access(self, module_name: str) -> None:
        """Raise 403 Forbidden if user cannot access the module."""
        if not self.can_access_module(module_name):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Permission denied. You do not have access to the {module_name.replace('_', ' ').title()} module.",
            )

    def can_write_hrms(self, module_name: str, action: str = "create") -> bool:
        """Verify whether caller can create/update/delete within an HRMS module (blocks read-only & explicit write denies)."""
        if self.is_admin:
            return True
        if not self.can_access_module(module_name):
            return False

        mod = module_name.lower().replace("-", "_")
        act = action.lower().strip()
        write_denies = {
            f"deny:hrms.{act}",
            f"block:hrms.{act}",
            f"deny:hrms.{mod}.{act}",
            f"block:hrms.{mod}.{act}",
        }
        if act == "delete":
            write_denies.update({"deny:hrms.update", "block:hrms.update"})
        if any(d in self.permissions for d in write_denies):
            return False

        if any(r.lower() in ("read_only", "readonly", "viewer", "auditor", "hrms_viewer") for r in self.roles):
            return False

        # Users explicitly scoped to hrms.view without write permissions are read-only
        if "hrms.view" in self.permissions and not any(
            p in self.permissions for p in ("hrms.create", "hrms.update", "hrms.manage", "hrms.approve", "*")
        ):
            return False

        return True

    def require_write_access(self, module_name: str, action: str = "create") -> None:
        """Raise 403 Forbidden if caller is read-only or explicitly denied write operations."""
        if not self.can_write_hrms(module_name, action=action):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Permission denied. Read-only accounts cannot {action} records in {module_name.replace('_', ' ').title()}.",
            )

    def can_access_employee(self, target_employee_id: uuid.UUID) -> bool:
        """Verify whether caller can view/modify records for target_employee_id."""
        if self.is_admin or self.is_hr:
            return True
        if target_employee_id == self.user_id:
            return True
        if self.is_manager and target_employee_id in self.managed_employee_ids:
            return True
        return False

    def require_employee_access(self, target_employee_id: uuid.UUID) -> None:
        """Raise 403 Forbidden if caller cannot access this employee's records."""
        if not self.can_access_employee(target_employee_id):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Permission denied. You cannot view or modify another employee's records.",
            )

    def can_configure_salary(self) -> bool:
        """Only Admin or HR with granted salary configuration permission."""
        if self.is_admin:
            return True
        if (
            "deny:hrms.payroll" in self.permissions
            or "block:hrms.payroll" in self.permissions
            or "deny:hrms.payroll.configure" in self.permissions
            or "block:hrms.payroll.configure" in self.permissions
        ):
            return False
        if self.is_hr and (
            "hrms.payroll.configure" in self.permissions or "hrms.manage" in self.permissions
        ):
            return True
        return False

    def can_approve_payroll(self) -> bool:
        """Only Admin or HR with granted payroll approval permission."""
        if self.is_admin:
            return True
        if (
            "deny:hrms.payroll" in self.permissions
            or "block:hrms.payroll" in self.permissions
            or "deny:hrms.payroll.approve" in self.permissions
            or "block:hrms.payroll.approve" in self.permissions
        ):
            return False
        if self.is_hr and (
            "hrms.payroll.approve" in self.permissions or "hrms.manage" in self.permissions
        ):
            return True
        return False

    def can_manage_location_assignments(self) -> bool:
        """
        Only Admin / Super Admin, or users explicitly granted hrms.location_assignments.manage.
        HR and Managers do NOT have this permission by default unless explicitly granted.
        """
        if self.is_admin:
            return True
        if "deny:hrms.location_assignments.manage" in self.permissions:
            return False
        return "hrms.location_assignments.manage" in self.permissions


async def check_manager_availability(
    db: AsyncSession, manager_id: uuid.UUID | None, on_date: Optional[date] = None
) -> tuple[bool, str]:
    """
    Check if manager is assigned and available based on real system data:
    1. Manager ID is assigned
    2. Manager user is active and not soft-deleted
    3. Manager does not have an active approved leave on the given date (default today)
    Returns: (is_available: bool, reason: str)
    """
    if not manager_id:
        return False, "NO_MANAGER_ASSIGNED"

    manager = await db.get(User, manager_id)
    if (
        not manager
        or manager.deleted_at is not None
        or not manager.is_active
        or manager.status in (UserStatus.INACTIVE, UserStatus.SUSPENDED)
        or manager.employment_status in (EmploymentStatus.TERMINATED, EmploymentStatus.RESIGNED)
    ):
        return False, "MANAGER_INACTIVE"

    check_date = on_date or datetime.now(IST).date()
    from app.hrms.models import HrmsLeaveRequest
    leave_stmt = (
        select(func.count(HrmsLeaveRequest.id))
        .where(
            HrmsLeaveRequest.employee_id == manager_id,
            HrmsLeaveRequest.approval_status == "APPROVED",
            HrmsLeaveRequest.from_date <= check_date,
            HrmsLeaveRequest.to_date >= check_date,
        )
    )
    leave_count = (await db.execute(leave_stmt)).scalar() or 0
    if leave_count > 0:
        return False, "MANAGER_ON_LEAVE"

    return True, "AVAILABLE"


async def verify_approval_authorization(
    db: AsyncSession,
    ctx: HrmsUserContext,
    target_employee_id: uuid.UUID,
    module_name: str,
    action_label: str = "approve",
) -> None:
    """
    Enforce Manager-First Approval with HR Fallback / Admin full control:
    1. Caller cannot approve their own request (including Administrators).
    2. Admin/Super Admin has authorized full company-wide approval access for other employees.
    3. If employee's manager is assigned and available, ONLY that manager (or Admin) can approve.
       HR fallback cannot act while assigned manager is available.
    4. If manager is unassigned, inactive, or unavailable (on leave), authorized HR fallback can act.
       HR must hold both module permission (e.g. hrms.expenses, hrms.leave) and hrms.approve (or hrms.manage).
    5. Cross-department or unassigned managers cannot approve other employees' requests.
    """
    if ctx.user_id == target_employee_id:
        if module_name == "attendance":
            # Attendance Regularization Self-Approval:
            # 1. Admin / Super Admin can self-approve / self-reject.
            # 2. Explicitly authorized HRMS personnel holding approval permissions
            #    (hrms.approve, hrms.manage, hrms:approval, hrms.attendance.approve)
            #    without explicit denial can self-approve / self-reject.
            # 3. Regular employees and ordinary managers without explicit approval permission remain blocked.
            has_explicit_approval_perm = any(
                p in ctx.permissions
                for p in ("hrms.approve", "hrms.manage", "hrms:approval", "hrms.attendance.approve")
            )
            has_denial = any(
                d in ctx.permissions
                for d in ("deny:hrms.approve", "deny:hrms.attendance", "block:hrms.attendance")
            )
            can_self_regularize = (
                (ctx.is_admin or (ctx.is_hr and has_explicit_approval_perm) or has_explicit_approval_perm)
                and not has_denial
                and ctx.can_access_module("attendance")
            )
            if can_self_regularize:
                return

        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Self-approval is not permitted. You cannot {action_label} your own {module_name} request.",
        )

    # 1. Admin/Super Admin full company-wide override
    if ctx.is_admin:
        return

    # 2. Check Manager-First chain:
    #    - If caller IS emp.manager_id (assigned direct manager) -> authorized immediately.
    #    - If emp.manager_id is assigned and AVAILABLE, ONLY emp.manager_id (or Admin) can act
    #      (secondary department managers and HR fallback cannot bypass the available assigned manager).
    #    - If emp.manager_id is unassigned or unavailable, a Department Manager covering the employee
    #      or authorized HR fallback can act.
    emp = await db.get(User, target_employee_id)
    if not emp:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Employee record not found for approval validation.",
        )

    if emp.manager_id == ctx.user_id:
        return

    mgr_available = False
    if emp.manager_id:
        mgr_available, _ = await check_manager_availability(db, emp.manager_id)
        if mgr_available:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"This request is routed to the employee's assigned manager first. Other managers or HR fallback can only act if the assigned manager is unassigned or unavailable.",
            )

    # Assigned manager is either unassigned or unavailable -> allow covering Dept Manager in scope
    if ctx.is_manager and target_employee_id in ctx.managed_employee_ids:
        return

    # 3. Caller is NOT the manager. Check if caller qualifies as authorized HR Fallback.
    is_hr_fallback = (
        ctx.is_hr
        and ("hrms.approve" in ctx.permissions or "hrms.manage" in ctx.permissions)
        and ("deny:hrms.approve" not in ctx.permissions)
        and ctx.can_access_module(module_name)
    )

    if not is_hr_fallback:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Permission denied. You are not authorized to {action_label} {module_name} requests for this employee.",
        )

    # Manager is unavailable / unassigned -> HR Fallback is authorized!
    return


async def get_hrms_user_context(
    request: Request,
    db: AsyncSession = Depends(get_db_session),
    auth_service: AuthService = Depends(get_auth_service),
) -> HrmsUserContext:
    """
    Resolve and validate authenticated HRMS user context.
    Strictly verifies Bearer token against PostgreSQL auth service.
    """
    auth_header = request.headers.get("Authorization")
    if not auth_header or not auth_header.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required. Please provide a valid Bearer token.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    token = auth_header.split(" ", 1)[1].strip()
    try:
        current_user = await auth_service.verify_access_token(token)
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired access token.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    user = await db.get(User, current_user.id)
    if (
        not user
        or user.deleted_at is not None
        or not user.is_active
        or user.status in (UserStatus.INACTIVE, UserStatus.SUSPENDED)
        or user.employment_status in (EmploymentStatus.TERMINATED, EmploymentStatus.RESIGNED)
        or not user.can_login
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User account is inactive, terminated, or not found.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Fetch active roles
    roles_stmt = (
        select(Role.name)
        .join(UserRole, UserRole.role_id == Role.id)
        .where(
            UserRole.user_id == user.id,
            UserRole.status == RoleAssignmentStatus.ACTIVE,
            Role.deleted_at.is_(None),
        )
    )
    roles = list((await db.execute(roles_stmt)).scalars().all())
    perms = set(current_user.permissions or [])

    is_super_admin = bool(current_user.is_super_admin or getattr(user, "is_super_admin", False))

    is_admin = bool(
        is_super_admin
        or "*" in perms
        or "admin" in perms
        or "super_admin" in roles
        or "admin" in roles
    )

    is_hr = bool(
        is_admin
        or "HR" in roles
        or any(r.upper() == "HR" or r.lower() == "human_resources" for r in roles)
        or "hrms.manage" in perms
    )

    # Primary Department resolution:
    # First active role that is an organizational department (not a generic system role)
    dept = None
    for r in roles:
        if r.lower() not in ("user", "super_admin", "admin", "department_manager", "employee"):
            dept = r
            break
    if not dept:
        dept = getattr(user, "department", None) or "General"

    # Compute managed employees for department managers and team leaders
    managed_ids: set[uuid.UUID] = {user.id}
    # Direct reports
    reports_stmt = select(User.id).where(User.manager_id == user.id, User.deleted_at.is_(None))
    for uid in (await db.execute(reports_stmt)).scalars().all():
        managed_ids.add(uid)

    # Distinguish genuine Department Managers (role-based) from employees who merely have direct reports:
    # An employee with 1+ direct reports can manage ONLY their direct reports, NEVER the whole department!
    is_dept_manager = bool(
        "department_manager" in roles
        or any("manager" in r.lower() for r in roles)
    )
    is_manager = bool(is_dept_manager or len(managed_ids) > 1)

    # ONLY expand to department peers when caller holds an explicit Department Manager role
    if is_dept_manager and dept and dept.lower() != "general":
        dept_roles_stmt = select(Role.id).where(func.lower(Role.name) == dept.lower(), Role.deleted_at.is_(None))
        dept_role_ids = list((await db.execute(dept_roles_stmt)).scalars().all())
        if dept_role_ids:
            dept_users_stmt = select(UserRole.user_id).where(
                UserRole.role_id.in_(dept_role_ids),
                UserRole.status == RoleAssignmentStatus.ACTIVE,
            )
            for uid in (await db.execute(dept_users_stmt)).scalars().all():
                managed_ids.add(uid)

    return HrmsUserContext(
        user_id=user.id,
        username=user.username or "",
        email=user.email or "",
        display_name=user.full_name,
        is_super_admin=is_super_admin,
        is_admin=is_admin,
        is_hr=is_hr,
        is_manager=is_manager,
        department=dept,
        roles=roles,
        permissions=perms,
        managed_employee_ids=managed_ids,
    )


async def resolve_hrms_employee(
    db: AsyncSession, identifier: str | uuid.UUID | None
) -> Optional[User]:
    """
    Authoritatively resolve an employee identifier to a PostgreSQL User record.
    Supports:
    - uuid.UUID instance
    - UUID string (e.g. 'ea2b5763-5a4d-4f21-8bff-adc3e6cb8235')
    - Employee code (e.g. 'EMP-000', 'EMP-001')
    - Username (e.g. 'john', 'admin')
    Returns User if active and non-deleted, otherwise None.
    """
    if identifier is None:
        return None

    if isinstance(identifier, uuid.UUID):
        stmt = select(User).where(User.id == identifier, User.deleted_at.is_(None))
        return (await db.execute(stmt)).scalar_one_or_none()

    str_val = str(identifier).strip()
    if not str_val or str_val.upper() == "ALL":
        return None

    # 1. Try UUID parse
    try:
        uid = uuid.UUID(str_val)
        stmt = select(User).where(User.id == uid, User.deleted_at.is_(None))
        user = (await db.execute(stmt)).scalar_one_or_none()
        if user:
            return user
    except (ValueError, AttributeError):
        pass

    # 2. Try employee_code or username lookup (case-insensitive)
    stmt = (
        select(User)
        .where(
            User.deleted_at.is_(None),
            (func.lower(User.employee_code) == str_val.lower())
            | (func.lower(User.username) == str_val.lower()),
        )
    )
    return (await db.execute(stmt)).scalar_one_or_none()


async def resolve_hrms_employee_or_404(
    db: AsyncSession, identifier: str | uuid.UUID | None, error_label: str = "Employee"
) -> User:
    """
    Resolve identifier to User or raise HTTP 404 with a clear user-facing error message.
    """
    user = await resolve_hrms_employee(db, identifier)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No linked HRMS employee record found for {error_label.lower()} '{identifier}'.",
        )
    return user


def require_location_assignments_manage(
    ctx: HrmsUserContext = Depends(get_hrms_user_context),
) -> HrmsUserContext:
    """
    Enforce hrms.location_assignments.manage permission:
    - Admin / Super Admin: Full access
    - HR / Manager / Other authorized person: Only if explicitly granted
    - Employee: No assignment-management access
    """
    if not ctx.can_manage_location_assignments():
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Permission denied. Administrative or explicitly granted location assignment permissions required.",
        )
    return ctx
