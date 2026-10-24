"""
Provisioning Script for Feed Phase 5 Test Accounts.

Creates or updates three dedicated test employee login accounts in the development environment:
- Account A: Test Publisher (Engineering department, permissions: feed.view, feed.create)
- Account B: Test Recipient (Engineering department, permissions: feed.view)
- Account C: Test Unauthorized Recipient (Marketing department, permissions: feed.view)

Usage:
    python -m scripts.provision_feed_test_accounts
"""

from __future__ import annotations

import asyncio
import json
import sys
import uuid
from datetime import datetime, timezone

from sqlalchemy import delete, select, text

from app.auth.security import (
    generate_temporary_password,
    hash_password,
    validate_password_strength,
)
from app.auth.service import AuthService, LoginContext
from app.cache.dependency import get_cache
from app.core.config import settings
from app.core.logging import get_logger
from app.database.engine import dispose_engine, get_sessionmaker
from app.rbac.models import (
    Permission,
    Role,
    RoleAssignmentStatus,
    RoleAssignmentType,
    UserPermission,
    UserRole,
)
from app.users.models import EmploymentStatus, EmploymentType, Gender, User, UserStatus
from app.auth.repository import PasswordHistoryRepository, SessionRepository, TokenBlacklistRepository
from app.rbac.repository import RoleRepository
from app.users.repository import UserRepository

logger = get_logger(__name__)

FEED_PERMISSIONS_DEF = [
    ("feed.view", "feed", "feed", "view", "ALL", "View accessible announcements and broadcast messages."),
    ("feed.create", "feed", "feed", "create", "ALL", "Create and publish feed announcements to all or selected employees."),
    ("feed.manage", "feed", "feed", "manage", "ALL", "Full administrative management of all feed announcements, drafts, and recipients."),
]

TEST_DEPARTMENTS = [
    {"name": "Engineering", "code": "ENG", "description": "Software Engineering & Technology"},
    {"name": "Marketing", "code": "MKT", "description": "Marketing & Public Relations"},
]

TEST_ACCOUNTS_DEF = [
    {
        "key": "A",
        "role_title": "Publisher",
        "first_name": "Test",
        "last_name": "Publisher",
        "display_name": "Test Publisher",
        "username": "feed_test_publisher",
        "email": "publisher.feed@inhyma.local",
        "employee_code": "EMP-FEED-A01",
        "department_name": "Engineering",
        "permissions": ["feed.view", "feed.create"],
    },
    {
        "key": "B",
        "role_title": "Employee",
        "first_name": "Test",
        "last_name": "Recipient",
        "display_name": "Test Recipient",
        "username": "feed_test_recipient",
        "email": "recipient.feed@inhyma.local",
        "employee_code": "EMP-FEED-B02",
        "department_name": "Engineering",
        "permissions": ["feed.view"],
    },
    {
        "key": "C",
        "role_title": "Employee",
        "first_name": "Test",
        "last_name": "Unauthorized Recipient",
        "display_name": "Test Unauthorized Recipient",
        "username": "feed_test_unauthorized",
        "email": "unauthorized.feed@inhyma.local",
        "employee_code": "EMP-FEED-C03",
        "department_name": "Marketing",
        "permissions": ["feed.view"],
    },
]


async def provision_test_accounts() -> list[dict]:
    # 0. Safety check: ensure not in production
    env = getattr(settings, "ENVIRONMENT", "").lower()
    if env in ("production", "prod"):
        raise RuntimeError("Safety check failed: cannot provision test accounts in production environment.")

    sessionmaker = get_sessionmaker()
    cache = get_cache()
    provisioned_credentials = []

    async with sessionmaker() as session:
        # 1. Ensure Feed permissions exist
        perm_map: dict[str, Permission] = {}
        for code, module, page, action, scope, desc in FEED_PERMISSIONS_DEF:
            stmt = select(Permission).where(Permission.code == code)
            perm = (await session.execute(stmt)).scalar_one_or_none()
            if not perm:
                perm = Permission(
                    code=code,
                    module=module,
                    page=page,
                    action=action,
                    scope=scope,
                    description=desc,
                )
                session.add(perm)
                await session.flush()
            perm_map[code] = perm

        # 2. Ensure test departments (roles) exist
        dept_map: dict[str, Role] = {}
        for dept_def in TEST_DEPARTMENTS:
            stmt = select(Role).where(Role.name == dept_def["name"], Role.deleted_at.is_(None))
            dept_role = (await session.execute(stmt)).scalar_one_or_none()
            if not dept_role:
                dept_role = Role(
                    name=dept_def["name"],
                    code=dept_def["code"],
                    description=dept_def["description"],
                    is_system=False,
                )
                session.add(dept_role)
                await session.flush()
            dept_map[dept_def["name"]] = dept_role

        # 3. Create or update test accounts
        for acc in TEST_ACCOUNTS_DEF:
            # Generate a strong, policy-compliant temporary password
            temp_password = generate_temporary_password(16)
            violations = validate_password_strength(temp_password)
            while violations:
                temp_password = generate_temporary_password(16)
                violations = validate_password_strength(temp_password)

            # Check if user already exists by username or email
            stmt = select(User).where(
                (User.username == acc["username"]) | (User.email == acc["email"])
            )
            user = (await session.execute(stmt)).scalar_one_or_none()

            if user is None:
                user = User(
                    username=acc["username"],
                    email=acc["email"],
                    first_name=acc["first_name"],
                    last_name=acc["last_name"],
                    display_name=acc["display_name"],
                    employee_code=acc["employee_code"],
                    password_hash=hash_password(temp_password),
                    has_login=True,
                    is_active=True,
                    status=UserStatus.ACTIVE,
                    must_change_password=False,
                    employment_status=EmploymentStatus.ACTIVE,
                    employment_type=EmploymentType.FULL_TIME,
                    password_changed_at=datetime.now(timezone.utc),
                )
                session.add(user)
                await session.flush()
            else:
                user.first_name = acc["first_name"]
                user.last_name = acc["last_name"]
                user.display_name = acc["display_name"]
                user.employee_code = acc["employee_code"]
                user.password_hash = hash_password(temp_password)
                user.has_login = True
                user.is_active = True
                user.status = UserStatus.ACTIVE
                user.must_change_password = False
                user.employment_status = EmploymentStatus.ACTIVE
                user.locked_until = None
                user.failed_login_count = 0
                user.deleted_at = None
                await session.flush()

            # Assign Department Role
            target_dept = dept_map[acc["department_name"]]
            # Remove any previous role links to avoid stray permissions or multiple departments
            await session.execute(delete(UserRole).where(UserRole.user_id == user.id))
            ur = UserRole(
                user_id=user.id,
                role_id=target_dept.id,
                assignment_type=RoleAssignmentType.PRIMARY,
                is_primary=True,
                status=RoleAssignmentStatus.ACTIVE,
            )
            session.add(ur)

            # Assign User Permissions explicitly
            await session.execute(delete(UserPermission).where(UserPermission.user_id == user.id))
            for pcode in acc["permissions"]:
                perm_obj = perm_map[pcode]
                up = UserPermission(
                    user_id=user.id,
                    permission_id=perm_obj.id,
                    is_granted=True,
                )
                session.add(up)

            await session.flush()

            # Invalidate any cached user permissions
            cache_key = f"user_perms:{user.id}"
            await cache.delete(cache_key)

            provisioned_credentials.append(
                {
                    "account_key": acc["key"],
                    "employee_name": acc["display_name"],
                    "username": acc["username"],
                    "email": acc["email"],
                    "temporary_password": temp_password,
                    "role_title": acc["role_title"],
                    "department": acc["department_name"],
                    "employee_code": acc["employee_code"],
                    "permissions": acc["permissions"],
                    "user_id": str(user.id),
                }
            )

        await session.commit()

    # 4. Verify login for all three accounts against AuthService
    async with sessionmaker() as verify_session:
        auth_svc = AuthService(
            user_repository=UserRepository(verify_session),
            role_repository=RoleRepository(verify_session),
            session_repository=SessionRepository(verify_session),
            token_blacklist_repository=TokenBlacklistRepository(verify_session),
            password_history_repository=PasswordHistoryRepository(verify_session),
            cache=cache,
        )

        for cred in provisioned_credentials:
            logged_in_user, access_token, _ = await auth_svc.login(
                identifier=cred["email"],
                password=cred["temporary_password"],
                context=LoginContext(ip_address="127.0.0.1", user_agent="Phase5-QA-Verifier", device_info="Test-Runner"),
            )
            assert logged_in_user is not None
            assert access_token is not None
            effective_perms = await auth_svc.get_user_effective_permissions(logged_in_user.id, force_refresh=True)
            for expected_p in cred["permissions"]:
                assert expected_p in effective_perms, f"Missing permission {expected_p} for {cred['username']}"
            if "feed.create" not in cred["permissions"]:
                assert "feed.create" not in effective_perms, f"Unexpected permission feed.create on {cred['username']}"
            if "feed.manage" not in cred["permissions"]:
                assert "feed.manage" not in effective_perms, f"Unexpected permission feed.manage on {cred['username']}"

    return provisioned_credentials


async def main():
    print("=" * 70)
    print("Inhyma ERP — Provisioning Feed Phase 5 Test Accounts")
    print("=" * 70)
    creds = await provision_test_accounts()
    print("\nSuccessfully provisioned and verified 3 test employee login accounts:\n")
    for c in creds:
        print(f"Account {c['account_key']} [{c['role_title']}]:")
        print(f"  Name:               {c['employee_name']} ({c['employee_code']})")
        print(f"  Department:         {c['department']}")
        print(f"  Email:              {c['email']}")
        print(f"  Username:           {c['username']}")
        print(f"  Temporary Password: {c['temporary_password']}")
        print(f"  Permissions:        {', '.join(c['permissions'])}")
        print(f"  User ID:            {c['user_id']}")
        print("-" * 50)

    # Save credentials securely to a scratch file outside git/source control for test execution
    out_file = r"C:\Users\om\.gemini\antigravity-ide\brain\ebb88f84-2dc6-4288-85f9-b7611491681b\scratch\feed_phase5_credentials.json"
    with open(out_file, "w", encoding="utf-8") as f:
        json.dump(creds, f, indent=2)
    print(f"\nSaved credentials artifact to: {out_file}")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    finally:
        asyncio.run(dispose_engine())
