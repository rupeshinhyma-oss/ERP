"""
Provision dedicated synthetic staging accounts for HRMS comprehensive RBAC and Security Testing.

Personas:
1. Super Admin: qa_super_admin@inhyma.test (Full system access)
2. HR Full: qa_hr_full@inhyma.test (All HRMS modules & approvals)
3. HR Restricted: qa_hr_restricted@inhyma.test (Attendance & Leave only; Denied Assets, Expenses, Payroll, Site Visits)
4. HR Payroll Configure Only: qa_hr_payroll_cfg@inhyma.test (Payroll view & configure only; Denied payroll.approve)
5. HR Payroll Approve Only: qa_hr_payroll_app@inhyma.test (Payroll view & approve only; Denied payroll.configure)
6. Sales Manager: qa_mgr_sales@inhyma.test (Manager with reportees Emp A and Emp B)
7. Solo Manager: qa_mgr_solo@inhyma.test (Manager without reportees / fallback manager)
8. Employee A: qa_emp_a@inhyma.test (Sales employee reporting to qa_mgr_sales)
9. Employee B: qa_emp_b@inhyma.test (Sales employee reporting to qa_mgr_sales)
10. Cross-Department Employee: qa_emp_other@inhyma.test (Engineering employee, no assigned manager)
"""

import asyncio
import os
import sys
import uuid
from datetime import datetime, timezone

# Add backend directory to sys.path
backend_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, backend_dir)
from dotenv import load_dotenv
load_dotenv(os.path.join(backend_dir, ".env"), override=True)

from sqlalchemy import delete, select
from app.database.engine import get_sessionmaker, dispose_engine
from app.users.models import User, UserStatus
from app.rbac.models import (
    Role,
    UserRole,
    Permission,
    UserPermission,
    RoleAssignmentType,
    RoleAssignmentStatus,
)
from app.auth.security import hash_password

PASSWORD_TEST = "QAPassword123!"
HASHED_PASSWORD = hash_password(PASSWORD_TEST)


async def provision_hrms_personas():
    session_factory = get_sessionmaker()

    async with session_factory() as session:
        print("[+] Resolving roles and permissions...", flush=True)

        # 1. Ensure required roles exist
        role_names = ["super_admin", "admin", "HR", "department_manager", "employee", "Sales", "Operations", "Engineering"]
        roles: dict[str, Role] = {}
        for rname in role_names:
            role = (await session.execute(select(Role).where(Role.name == rname))).scalars().first()
            if not role:
                role = Role(name=rname, description=rname.replace("_", " ").title())
                session.add(role)
                await session.flush()
                print(f"[+] Created role: {rname}", flush=True)
            else:
                role.deleted_at = None
                await session.flush()
            roles[rname] = role

        # 2. Ensure all 13 canonical HRMS permissions exist
        hrms_permissions = [
            ("hrms.view", "View HRMS records and self-service dashboards"),
            ("hrms.create", "Create HRMS records"),
            ("hrms.update", "Update HRMS records"),
            ("hrms.approve", "Approve HRMS requests and workflows"),
            ("hrms.manage", "Administrative control over HRMS settings and policies"),
            ("hrms.attendance", "Attendance tracking and regularization module"),
            ("hrms.leave", "Leave management and entitlement module"),
            ("hrms.assets", "Asset tracking and assignment module"),
            ("hrms.expenses", "Expense claims and reimbursement module"),
            ("hrms.site_visits", "Site visits and live tracking module"),
            ("hrms.payroll", "Payroll viewing and summary access"),
            ("hrms.payroll.configure", "Salary structure configuration and revision"),
            ("hrms.payroll.approve", "Monthly payroll calculation and final approval"),
        ]

        all_perms: dict[str, Permission] = {}
        for code, desc in hrms_permissions:
            perm = (await session.execute(select(Permission).where(Permission.code == code))).scalars().first()
            if not perm:
                perm = Permission(code=code, description=desc, module="hrms")
                session.add(perm)
                await session.flush()
                print(f"[+] Created permission: {code}", flush=True)
            all_perms[code] = perm

        # Fetch any other existing permissions
        existing_perms = (await session.execute(select(Permission))).scalars().all()
        perm_map = {p.code: p for p in existing_perms}

        # 3. Helper to upsert a user
        async def upsert_user(
            username: str,
            email: str,
            first_name: str,
            last_name: str,
            primary_role: Role,
            extra_roles: list[Role] | None = None,
            manager_id: uuid.UUID | None = None,
            department: str | None = None,
            employee_code: str | None = None,
        ) -> User:
            stmt = select(User).where(User.email == email)
            user = (await session.execute(stmt)).scalars().first()
            if not user:
                user = User(
                    username=username,
                    email=email,
                    password_hash=HASHED_PASSWORD,
                    first_name=first_name,
                    last_name=last_name,
                    status=UserStatus.ACTIVE,
                    is_active=True,
                    has_login=True,
                    must_change_password=False,
                    manager_id=manager_id,
                    employee_code=employee_code,
                )
                session.add(user)
                await session.flush()
                print(f"[+] Created user: {email} (id={user.id})", flush=True)
            else:
                user.username = username
                user.password_hash = HASHED_PASSWORD
                user.first_name = first_name
                user.last_name = last_name
                user.status = UserStatus.ACTIVE
                user.is_active = True
                user.deleted_at = None
                user.manager_id = manager_id
                if employee_code:
                    user.employee_code = employee_code
                await session.flush()
                print(f"[+] Updated user: {email} (id={user.id})", flush=True)

            # Assign roles
            target_roles = [primary_role] + (extra_roles or [])
            for r in target_roles:
                existing_ur = (
                    await session.execute(
                        select(UserRole).where(
                            UserRole.user_id == user.id,
                            UserRole.role_id == r.id,
                        )
                    )
                ).scalars().first()
                if not existing_ur:
                    ur = UserRole(
                        user_id=user.id,
                        role_id=r.id,
                        assignment_type=RoleAssignmentType.PRIMARY,
                        status=RoleAssignmentStatus.ACTIVE,
                    )
                    session.add(ur)
                else:
                    existing_ur.status = RoleAssignmentStatus.ACTIVE

            return user

        # 4. Helper to configure explicit user permissions (Grants & Denies)
        async def configure_user_permissions(
            user_id: uuid.UUID,
            grants: list[str],
            denies: list[str],
        ):
            # Clear existing overrides for this user
            await session.execute(
                delete(UserPermission).where(UserPermission.user_id == user_id)
            )
            # Add explicit grants
            for g in grants:
                if g in perm_map:
                    up = UserPermission(
                        user_id=user_id,
                        permission_id=perm_map[g].id,
                        is_granted=True,
                    )
                    session.add(up)
            # Add explicit denies
            for d in denies:
                if d in perm_map:
                    up = UserPermission(
                        user_id=user_id,
                        permission_id=perm_map[d].id,
                        is_granted=False,
                    )
                    session.add(up)
            await session.flush()

        # Provision personas:
        # A. Super Admin
        super_admin = await upsert_user(
            username="qa_super_admin",
            email="qa_super_admin@inhyma.test",
            first_name="Super",
            last_name="Admin",
            primary_role=roles["super_admin"],
            extra_roles=[roles["admin"]],
            employee_code="QA-SA-001",
        )

        # Also ensure qa_admin@inhyma.test remains fully active
        await upsert_user(
            username="qa_admin",
            email="qa_admin@inhyma.test",
            first_name="QA",
            last_name="Admin",
            primary_role=roles["super_admin"],
            extra_roles=[roles["admin"]],
            employee_code="QA-ADM-001",
        )

        # B. Managers
        mgr_sales = await upsert_user(
            username="qa_mgr_sales",
            email="qa_mgr_sales@inhyma.test",
            first_name="Sales",
            last_name="Manager",
            primary_role=roles["department_manager"],
            extra_roles=[roles["Sales"]],
            employee_code="QA-MGR-001",
        )

        mgr_solo = await upsert_user(
            username="qa_mgr_solo",
            email="qa_mgr_solo@inhyma.test",
            first_name="Solo",
            last_name="Manager",
            primary_role=roles["department_manager"],
            extra_roles=[roles["Operations"]],
            employee_code="QA-MGR-002",
        )

        # C. Employees
        emp_a = await upsert_user(
            username="qa_emp_a",
            email="qa_emp_a@inhyma.test",
            first_name="Alice",
            last_name="Sales",
            primary_role=roles["employee"],
            extra_roles=[roles["Sales"]],
            manager_id=mgr_sales.id,
            employee_code="QA-EMP-001",
        )

        emp_b = await upsert_user(
            username="qa_emp_b",
            email="qa_emp_b@inhyma.test",
            first_name="Bob",
            last_name="Sales",
            primary_role=roles["employee"],
            extra_roles=[roles["Sales"]],
            manager_id=mgr_sales.id,
            employee_code="QA-EMP-002",
        )

        emp_other = await upsert_user(
            username="qa_emp_other",
            email="qa_emp_other@inhyma.test",
            first_name="Charlie",
            last_name="Engineering",
            primary_role=roles["employee"],
            extra_roles=[roles["Engineering"]],
            manager_id=None,  # No manager -> HR fallback testing
            employee_code="QA-EMP-003",
        )

        # D. HR Personas
        # D1. HR Full
        hr_full = await upsert_user(
            username="qa_hr_full",
            email="qa_hr_full@inhyma.test",
            first_name="Full",
            last_name="HR",
            primary_role=roles["HR"],
            employee_code="QA-HR-001",
        )
        await configure_user_permissions(
            user_id=hr_full.id,
            grants=[code for code, _ in hrms_permissions],
            denies=[],
        )

        # D2. HR Restricted (Attendance & Leave only; Denied Assets, Expenses, Site Visits, Payroll)
        hr_restricted = await upsert_user(
            username="qa_hr_restricted",
            email="qa_hr_restricted@inhyma.test",
            first_name="Restricted",
            last_name="HR",
            primary_role=roles["HR"],
            employee_code="QA-HR-002",
        )
        await configure_user_permissions(
            user_id=hr_restricted.id,
            grants=["hrms.view", "hrms.attendance", "hrms.leave", "hrms.approve"],
            denies=[
                "hrms.assets",
                "hrms.expenses",
                "hrms.site_visits",
                "hrms.payroll",
                "hrms.payroll.configure",
                "hrms.payroll.approve",
                "hrms.manage",
            ],
        )

        # D3. HR Payroll Configure Only (Configure salary, NO payroll approval)
        hr_payroll_cfg = await upsert_user(
            username="qa_hr_payroll_cfg",
            email="qa_hr_payroll_cfg@inhyma.test",
            first_name="PayrollCfg",
            last_name="HR",
            primary_role=roles["HR"],
            employee_code="QA-HR-003",
        )
        await configure_user_permissions(
            user_id=hr_payroll_cfg.id,
            grants=["hrms.view", "hrms.payroll", "hrms.payroll.configure"],
            denies=["hrms.payroll.approve", "hrms.manage"],
        )

        # D4. HR Payroll Approve Only (Approve monthly payroll, NO salary configuration)
        hr_payroll_app = await upsert_user(
            username="qa_hr_payroll_app",
            email="qa_hr_payroll_app@inhyma.test",
            first_name="PayrollApp",
            last_name="HR",
            primary_role=roles["HR"],
            employee_code="QA-HR-004",
        )
        await configure_user_permissions(
            user_id=hr_payroll_app.id,
            grants=["hrms.view", "hrms.payroll", "hrms.payroll.approve"],
            denies=["hrms.payroll.configure", "hrms.manage"],
        )

        await session.commit()
        print("[+] All 10 HRMS QA personas successfully provisioned!", flush=True)
    await dispose_engine()


if __name__ == "__main__":
    asyncio.run(provision_hrms_personas())
