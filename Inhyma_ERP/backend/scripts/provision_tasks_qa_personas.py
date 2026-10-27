"""
Provision isolated staging QA personas for Tasks RBAC and Security Testing.

Personas:
1. Super Admin:
   - email: qa_admin@inhyma.test
   - username: qa_admin
   - role: super_admin

2. Sales Department Manager:
   - email: qa_sales_mgr@inhyma.test
   - username: qa_sales_mgr
   - role: Sales
   - Leadership: Primary Manager over Sales department
   - Task permissions: task.view, task.create, task.assign, task.department_view, task.escalate

3. Sales Employee:
   - email: qa_sales_emp@inhyma.test
   - username: qa_sales_emp
   - role: Sales
   - Reports to: Sales Department Manager
   - Task permissions: task.view, task.create
"""

import asyncio
import os
import sys
from datetime import datetime, timezone
import uuid

# Add backend directory to sys.path
backend_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, backend_dir)
from dotenv import load_dotenv
load_dotenv(os.path.join(backend_dir, ".env"), override=True)

from sqlalchemy import select
from app.database.engine import get_sessionmaker, dispose_engine
from app.rbac.models import (
    Role,
    UserRole,
    Permission,
    UserPermission,
    RoleAssignmentType,
    RoleAssignmentStatus,
)
from app.users.models import User, UserStatus
from app.auth.security import hash_password
from app.org_structure.models import (
    DepartmentLeadershipAssignment,
    EmployeeReportingRelationship,
    LeadershipType,
    OrgRecordStatus,
    ReportingRelationshipType,
)
from app.auth.service import AuthService


PASSWORD_TEST = "QAPassword123!"


async def provision_qa_personas():
    session_factory = get_sessionmaker()

    async with session_factory() as session:
        print("[+] Resolving roles and permissions...")
        # 1. Ensure 'super_admin' and 'Sales' roles exist
        admin_role = (
            await session.execute(select(Role).where(Role.name == "super_admin"))
        ).scalars().first()
        if not admin_role:
            raise RuntimeError("super_admin role not found in database.")

        sales_role = (
            await session.execute(select(Role).where(Role.name == "Sales"))
        ).scalars().first()
        if not sales_role:
            sales_role = Role(name="Sales", display_name="Sales Department")
            session.add(sales_role)
            await session.flush()
            print("[+] Created 'Sales' role/department.")

        # Ensure permissions dictionary
        all_perms = (await session.execute(select(Permission))).scalars().all()
        perm_map = {p.code: p.id for p in all_perms}

        async def ensure_user(username: str, email: str, role_obj: Role) -> User:
            stmt = select(User).where(User.email == email)
            user = (await session.execute(stmt)).scalars().first()
            if not user:
                user = User(
                    username=username,
                    email=email,
                    password_hash=hash_password(PASSWORD_TEST),
                    first_name=username.replace("_", " ").title(),
                    last_name="QA",
                    status=UserStatus.ACTIVE,
                    is_active=True,
                    has_login=True,
                    must_change_password=False,
                    password_changed_at=datetime.now(timezone.utc),
                )
                session.add(user)
                await session.flush()
                print(f"[+] Created user: {email} (ID: {user.id})")
            else:
                user.password_hash = hash_password(PASSWORD_TEST)
                user.status = UserStatus.ACTIVE
                user.is_active = True
                user.has_login = True
                user.failed_login_count = 0
                user.locked_until = None
                await session.flush()
                print(f"[+] User {email} already exists. Updated password and active status.")

            # Assign role
            ur_stmt = select(UserRole).where(UserRole.user_id == user.id, UserRole.role_id == role_obj.id)
            ur = (await session.execute(ur_stmt)).scalars().first()
            if not ur:
                session.add(
                    UserRole(
                        user_id=user.id,
                        role_id=role_obj.id,
                        assignment_type=RoleAssignmentType.PRIMARY,
                        is_primary=True,
                        status=RoleAssignmentStatus.ACTIVE,
                        assigned_at=datetime.now(timezone.utc),
                    )
                )
                await session.flush()
                print(f"[+] Assigned {role_obj.name} role to {email}.")
            return user

        async def grant_user_perms(user_id: uuid.UUID, perm_codes: list[str]):
            for code in perm_codes:
                if code not in perm_map:
                    print(f"[-] Warning: permission code '{code}' not found in DB.")
                    continue
                p_id = perm_map[code]
                up_stmt = select(UserPermission).where(
                    UserPermission.user_id == user_id,
                    UserPermission.permission_id == p_id,
                )
                up = (await session.execute(up_stmt)).scalars().first()
                if not up:
                    session.add(
                        UserPermission(
                            user_id=user_id,
                            permission_id=p_id,
                            is_granted=True,
                            granted_at=datetime.now(timezone.utc),
                        )
                    )
                else:
                    up.is_granted = True
            await session.flush()

        # 1. Super Admin
        admin_user = await ensure_user("qa_admin", "qa_admin@inhyma.test", admin_role)

        # 2. Sales Department Manager
        sales_mgr = await ensure_user("qa_sales_mgr", "qa_sales_mgr@inhyma.test", sales_role)
        # Leadership assignment for Sales Manager
        ldr_stmt = select(DepartmentLeadershipAssignment).where(
            DepartmentLeadershipAssignment.department_id == sales_role.id,
            DepartmentLeadershipAssignment.employee_id == sales_mgr.id,
        )
        ldr = (await session.execute(ldr_stmt)).scalars().first()
        if not ldr:
            session.add(
                DepartmentLeadershipAssignment(
                    department_id=sales_role.id,
                    employee_id=sales_mgr.id,
                    leadership_type=LeadershipType.PRIMARY_MANAGER,
                    is_primary=True,
                    status=OrgRecordStatus.ACTIVE,
                )
            )
            await session.flush()
            print("[+] Assigned qa_sales_mgr as PRIMARY_MANAGER for Sales department.")
        await grant_user_perms(
            sales_mgr.id,
            ["task.view", "task.create", "task.assign", "task.department_view", "task.escalate"],
        )

        # 3. Sales Employee
        sales_emp = await ensure_user("qa_sales_emp", "qa_sales_emp@inhyma.test", sales_role)
        sales_emp.manager_id = sales_mgr.id
        await session.flush()

        # Reporting relationship
        rep_stmt = select(EmployeeReportingRelationship).where(
            EmployeeReportingRelationship.employee_id == sales_emp.id,
            EmployeeReportingRelationship.manager_employee_id == sales_mgr.id,
        )
        rep = (await session.execute(rep_stmt)).scalars().first()
        if not rep:
            session.add(
                EmployeeReportingRelationship(
                    employee_id=sales_emp.id,
                    manager_employee_id=sales_mgr.id,
                    relationship_type=ReportingRelationshipType.PRIMARY_REPORTING,
                    department_id=sales_role.id,
                    is_primary=True,
                )
            )
            await session.flush()
            print("[+] Assigned qa_sales_emp reporting to qa_sales_mgr.")
        await grant_user_perms(
            sales_emp.id,
            ["task.view", "task.create"],
        )

        await session.commit()
        print("[+] Staging QA personas committed successfully.")

        # Verify Authentication
        print("[+] Testing authentication for each persona...")
        from app.auth.repository import SessionRepository, TokenBlacklistRepository, PasswordHistoryRepository
        from app.users.repository import UserRepository
        from app.rbac.repository import RoleRepository
        from app.cache.in_memory import InMemoryCacheBackend
        from app.auth.service import LoginContext

        auth_service = AuthService(
            user_repository=UserRepository(session),
            role_repository=RoleRepository(session),
            session_repository=SessionRepository(session),
            token_blacklist_repository=TokenBlacklistRepository(session),
            password_history_repository=PasswordHistoryRepository(session),
            cache=InMemoryCacheBackend(),
        )

        for name, email in [
            ("Super Admin", "qa_admin@inhyma.test"),
            ("Sales Manager", "qa_sales_mgr@inhyma.test"),
            ("Sales Employee", "qa_sales_emp@inhyma.test"),
        ]:
            user, access_token, refresh_token = await auth_service.login(
                identifier=email,
                password=PASSWORD_TEST,
                context=LoginContext(ip_address="127.0.0.1", user_agent="QA-Staging-Test"),
            )
            perms = await auth_service.get_user_effective_permissions(user.id)
            print(f"[SUCCESS] {name} ({email}) authenticated successfully!")
            print(f"          User ID: {user.id}")
            print(f"          Effective permissions count: {len(perms)}")
            print(f"          Access token issued (first 20 chars): {access_token[:20]}...")

    await dispose_engine()


if __name__ == "__main__":
    asyncio.run(provision_qa_personas())
