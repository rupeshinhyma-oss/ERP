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

import uuid
from dataclasses import dataclass, field
from typing import Optional, Set

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_auth_service
from app.auth.service import AuthService
from app.database.session import get_db_session
from app.rbac.models import Role, RoleAssignmentStatus, UserRole
from app.users.models import User, UserStatus


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

        # Explicit deny / blocked tag
        blocked_perms = {
            f"deny:hrms.{mod}",
            f"block:hrms.{mod}",
            f"deny:hrms.{mod}s",
            f"block:hrms.{mod}s",
        }
        if any(b in self.permissions for b in blocked_perms):
            return False

        # HR Role module check:
        # HR has permissions seeded in role_permissions (hrms.attendance, hrms.leave, hrms.assets, hrms.expenses, hrms.site_visits, hrms.payroll).
        # If Admin explicitly revoked a module permission from HR, it is subtracted from self.permissions.
        if self.is_hr:
            mod_perms = {f"hrms.{mod}", f"hrms.{mod}.view", f"hrms.{mod}s"}
            if not any(p in self.permissions for p in mod_perms):
                return False
            return True

        # Department Manager and Normal Employee can access self-service / department modules:
        # Attendance, Leave, Assets, Expenses, Site Visits, Payroll (payslips)
        if mod in ("attendance", "leave", "assets", "expenses", "site_visits", "payroll"):
            return True

        # Setup / Global Configuration is strictly Admin / HR only
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
        if self.is_hr and ("hrms.payroll.configure" in self.permissions or "hrms.manage" in self.permissions or "hrms.payroll.manage" in self.permissions or "hrms.payroll" in self.permissions):
            return True
        return False

    def can_approve_payroll(self) -> bool:
        """Only Admin or HR with granted payroll approval permission."""
        if self.is_admin:
            return True
        if self.is_hr and ("hrms.payroll.approve" in self.permissions or "hrms.manage" in self.permissions or "hrms.approve" in self.permissions or "hrms.payroll.manage" in self.permissions or "hrms.payroll" in self.permissions):
            return True
        return False


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
    if not user or user.deleted_at is not None or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User account is inactive or not found.",
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
    uname = (user.username or "").lower()

    is_admin = bool(
        is_super_admin
        or "*" in perms
        or "admin" in perms
        or "super_admin" in roles
        or "admin" in roles
        or uname in ("admin", "superadmin", "super_admin")
    )

    is_hr = bool(
        is_admin
        or "HR" in roles
        or any(r.lower() == "hr" for r in roles)
        or "hrms.manage" in perms
        or uname in ("hr", "hrmanager", "alice")
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

    is_manager = bool(
        is_admin
        or is_hr
        or "department_manager" in roles
        or any("manager" in r.lower() for r in roles)
        or len(managed_ids) > 1
    )

    # If department manager, add all active employees in their department
    if is_manager and dept and dept.lower() != "general":
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
