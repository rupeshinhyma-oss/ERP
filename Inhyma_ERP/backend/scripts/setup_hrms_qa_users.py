"""
Seed / ensure real HRMS QA test accounts in PostgreSQL.

Ensures the canonical test accounts exist:
1. ADMIN: username=admin, role=super_admin
2. HR: username=alice, role=HR, department=HR
3. DEPARTMENT MANAGER: username=sales_manager, role=department_manager, department=Sales
4. EMPLOYEE: username=john, role=employee, department=Sales (reports to sales_manager)
5. OTHER DEPT EMPLOYEE: username=ops_employee, role=employee, department=Operations
"""

import asyncio
from datetime import datetime, timezone
import app.users.models
from sqlalchemy import select, and_
from app.auth.security import hash_password
from app.database.engine import get_sessionmaker
from app.users.models import User, UserStatus
from app.rbac.models import Role, UserRole, RoleAssignmentType, RoleAssignmentStatus, Permission, RolePermission

ACCOUNTS = [
    {
        "username": "admin",
        "email": "admin@example.com",
        "first_name": "Admin",
        "last_name": "User",
        "code": "EMP-000",
        "password": "ChangeMe!12345",
        "roles": ["super_admin"],
        "is_manager": True,
        "manager_username": None,
    },
    {
        "username": "alice",
        "email": "alice@example.com",
        "first_name": "Alice",
        "last_name": "HR",
        "code": "EMP-002",
        "password": "password123",
        "roles": ["HR"],
        "is_manager": True,
        "manager_username": None,
    },
    {
        "username": "sales_manager",
        "email": "sales_manager@inhyma.com",
        "first_name": "Sales",
        "last_name": "Manager",
        "code": "EMP-003",
        "password": "password123",
        "roles": ["Sales", "department_manager"],
        "is_manager": True,
        "manager_username": None,
    },
    {
        "username": "john",
        "email": "john@example.com",
        "first_name": "John",
        "last_name": "Doe",
        "code": "EMP-001",
        "password": "password123",
        "roles": ["Sales", "employee"],
        "is_manager": False,
        "manager_username": "sales_manager",
    },
    {
        "username": "ops_employee",
        "email": "ops_employee@inhyma.com",
        "first_name": "Operations",
        "last_name": "Staff",
        "code": "EMP-004",
        "password": "password123",
        "roles": ["Operations", "employee"],
        "is_manager": False,
        "manager_username": None,
    },
]

HRMS_PERMS = [
    ("hrms.view", "hrms", "hrms", "view", "ALL", "View HRMS modules"),
    ("hrms.manage", "hrms", "hrms", "manage", "ALL", "Full administrative control over HRMS"),
    ("hrms.attendance", "hrms", "attendance", "view", "ALL", "Access HRMS Attendance module"),
    ("hrms.leave", "hrms", "leave", "view", "ALL", "Access HRMS Leave module"),
    ("hrms.assets", "hrms", "assets", "view", "ALL", "Access HRMS Asset Management module"),
    ("hrms.expenses", "hrms", "expenses", "view", "ALL", "Access HRMS Expense Management module"),
    ("hrms.site_visits", "hrms", "site_visits", "view", "ALL", "Access HRMS Site Visit module"),
    ("hrms.payroll", "hrms", "payroll", "view", "ALL", "Access HRMS Payroll module"),
    ("hrms.payroll.configure", "hrms", "payroll", "manage", "ALL", "Configure salary structures and payroll setup"),
    ("hrms.payroll.approve", "hrms", "payroll", "approve", "ALL", "Approve and lock monthly payroll"),
]

async def setup():
    session_factory = get_sessionmaker()
    async with session_factory() as db:
        # 1. Ensure HRMS permissions exist
        for code, module, page, action, scope, desc in HRMS_PERMS:
            p = (await db.execute(select(Permission).where(Permission.code == code))).scalar_one_or_none()
            if not p:
                p = Permission(code=code, module=module, page=page, action=action, scope=scope, description=desc)
                db.add(p)
                await db.flush()

        # 2. Ensure roles exist
        needed_roles = ["super_admin", "HR", "Sales", "Operations", "department_manager", "employee"]
        role_map = {}
        for rname in needed_roles:
            r = (await db.execute(select(Role).where(Role.name == rname))).scalar_one_or_none()
            if not r:
                r = Role(name=rname, description=f"{rname} role", is_system=False)
                db.add(r)
                await db.flush()
            role_map[rname] = r

        # 3. Grant HR role all standard HRMS permissions
        hr_role = role_map["HR"]
        for code, _, _, _, _, _ in HRMS_PERMS:
            p = (await db.execute(select(Permission).where(Permission.code == code))).scalar_one_or_none()
            if p:
                link = (await db.execute(select(RolePermission).where(
                    RolePermission.role_id == hr_role.id,
                    RolePermission.permission_id == p.id
                ))).scalar_one_or_none()
                if not link:
                    db.add(RolePermission(role_id=hr_role.id, permission_id=p.id))

        await db.commit()

        # 4. Create or update the users
        user_map = {}
        for acc in ACCOUNTS:
            user = (await db.execute(select(User).where(User.username == acc["username"]))).scalar_one_or_none()
            if not user:
                user = (await db.execute(select(User).where(User.email == acc["email"]))).scalar_one_or_none()
            if not user:
                user = User(
                    username=acc["username"],
                    email=acc["email"],
                    first_name=acc["first_name"],
                    last_name=acc["last_name"],
                    display_name=f"{acc['first_name']} {acc['last_name']}",
                    employee_code=acc["code"],
                    password_hash=hash_password(acc["password"]),
                    status=UserStatus.ACTIVE,
                    is_active=True,
                    has_login=True,
                    must_change_password=False,
                    password_changed_at=datetime.now(timezone.utc),
                )
                db.add(user)
                await db.flush()
                print(f"Created user: {acc['username']}")
            else:
                user.first_name = acc["first_name"]
                user.last_name = acc["last_name"]
                user.display_name = f"{acc['first_name']} {acc['last_name']}"
                user.employee_code = acc["code"]
                user.status = UserStatus.ACTIVE
                user.is_active = True
                user.has_login = True
                user.password_hash = hash_password(acc["password"])
                user.deleted_at = None
                print(f"Updated user: {acc['username']}")

            user_map[acc["username"]] = user

            # Assign roles
            for rname in acc["roles"]:
                r = role_map.get(rname)
                if r:
                    ur = (await db.execute(select(UserRole).where(
                        UserRole.user_id == user.id,
                        UserRole.role_id == r.id
                    ))).scalar_one_or_none()
                    if not ur:
                        ur = UserRole(
                            user_id=user.id,
                            role_id=r.id,
                            assignment_type=RoleAssignmentType.PRIMARY if rname == acc["roles"][0] else RoleAssignmentType.SECONDARY,
                            is_primary=(rname == acc["roles"][0]),
                            status=RoleAssignmentStatus.ACTIVE,
                            assigned_at=datetime.now(timezone.utc),
                        )
                        db.add(ur)
                    else:
                        ur.status = RoleAssignmentStatus.ACTIVE

        # Set managers
        for acc in ACCOUNTS:
            if acc["manager_username"]:
                mgr = user_map.get(acc["manager_username"])
                u = user_map.get(acc["username"])
                if mgr and u:
                    u.manager_id = mgr.id

        await db.commit()
        print("All test accounts and roles initialized successfully!")

if __name__ == "__main__":
    asyncio.run(setup())
