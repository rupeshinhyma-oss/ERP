"""
HRMS Canonical Employee Resolution Endpoint.

Mounts under ``/api/v1/hrms/employees``:
- GET /hrms/employees: Returns canonical active employee records from PostgreSQL,
  strictly scoped by caller's RBAC role:
  * Admin / HR: Company-wide active employees.
  * Department Manager: Active employees belonging to their managed department / reports.
  * Normal Employee: Strictly their own user record.
"""

from __future__ import annotations

import uuid
from typing import List, Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.responses import build_success_response
from app.database.session import get_db_session
from app.hrms.rbac import HrmsUserContext, get_hrms_user_context
from app.org_structure.models import EmployeePositionAssignment, Position
from app.rbac.models import Role, UserRole
from app.users.models import User, UserStatus

router = APIRouter(prefix="/hrms/employees", tags=["HRMS - Employees"])


@router.get("", summary="List active employees for HRMS dropdowns and selectors (RBAC scoped)")
async def list_hrms_employees(
    department: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db_session),
    ctx: HrmsUserContext = Depends(get_hrms_user_context),
):
    """
    Returns real PostgreSQL employees scoped to caller:
    - Admin / HR: all active employees
    - Department Manager: department employees
    - Employee: self only
    """
    stmt = (
        select(User)
        .where(
            User.deleted_at.is_(None),
            User.is_active.is_(True),
            User.status == UserStatus.ACTIVE,
        )
        .order_by(User.first_name.asc(), User.username.asc())
    )

    if not (ctx.is_admin or ctx.is_hr):
        if ctx.is_manager:
            stmt = stmt.where(User.id.in_(ctx.managed_employee_ids))
        else:
            stmt = stmt.where(User.id == ctx.user_id)

    users = list((await db.execute(stmt)).scalars().all())
    if not users:
        return build_success_response(data=[], message="No employees found.")

    uids = [u.id for u in users]

    # Department resolution from UserRole -> Role
    dept_map: dict[uuid.UUID, str] = {}
    try:
        r_stmt = (
            select(UserRole.user_id, Role.name)
            .join(Role, Role.id == UserRole.role_id)
            .where(UserRole.user_id.in_(uids))
        )
        roles_res = (await db.execute(r_stmt)).all()
        for uid, rname in roles_res:
            if rname.lower() not in ("user", "employee", "department_manager", "super_admin", "admin") and uid not in dept_map:
                dept_map[uid] = rname
    except Exception:
        pass

    # Designation resolution from EmployeePositionAssignment -> Position
    pos_map: dict[uuid.UUID, str] = {}
    try:
        p_stmt = (
            select(EmployeePositionAssignment.employee_id, Position.name)
            .join(Position, Position.id == EmployeePositionAssignment.position_id)
            .where(EmployeePositionAssignment.employee_id.in_(uids))
        )
        pos_res = (await db.execute(p_stmt)).all()
        for uid, pname in pos_res:
            if uid not in pos_map:
                pos_map[uid] = pname
    except Exception:
        pass

    items = []
    for u in users:
        resolved_dept = dept_map.get(u.id) or getattr(u, "department", None) or "General"
        resolved_desig = pos_map.get(u.id) or getattr(u, "designation", None) or "Staff"

        # Optional search filter
        if search and search.strip():
            term = search.strip().lower()
            match_str = f"{u.first_name or ''} {u.last_name or ''} {u.username or ''} {u.email or ''} {u.employee_code or ''}".lower()
            if term not in match_str:
                continue

        # Optional department filter
        if department and department.strip().upper() != "ALL":
            if resolved_dept.lower() != department.strip().lower():
                continue

        items.append(
            {
                "id": str(u.id),
                "employee_code": u.employee_code or f"EMP-{str(u.id)[:6].upper()}",
                "full_name": u.full_name,
                "first_name": u.first_name or "",
                "last_name": u.last_name or "",
                "username": u.username or "",
                "email": u.email or "",
                "department": resolved_dept,
                "designation": resolved_desig,
                "is_active": u.is_active,
            }
        )

    return build_success_response(data=items, message="Employees retrieved successfully.")
