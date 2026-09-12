"""
Seed missing district and company permissions:
- Districts (district.view, district.create, district.update, district.delete, district.export, district.import, district.bulk_action)
- Companies (company.view, company.create, company.update, company.delete, company.export, company.import, company.bulk_action, company.grade_edit, company.potential_edit)

Grants all these permissions to the super_admin role, and view permissions to the user role.
Also invalidates cached user permissions so active sessions immediately pick up the changes.
"""

from __future__ import annotations

import asyncio

from sqlalchemy import select

from app.cache.dependency import get_cache
from app.core.config import settings
from app.core.logging import configure_logging, get_logger
from app.database.engine import dispose_engine, get_sessionmaker
from app.rbac.models import Permission, Role, RolePermission
from app.rbac.repository import PermissionRepository, RoleRepository
from app.users.models import User

logger = get_logger(__name__)

PERMISSIONS_TO_SEED = [
    # Districts
    ("district.view", "district", "masters-districts", "view", "ALL", "View districts."),
    ("district.create", "district", "masters-districts", "create", "ALL", "Create districts."),
    ("district.update", "district", "masters-districts", "update", "ALL", "Update districts."),
    ("district.delete", "district", "masters-districts", "delete", "ALL", "Delete districts."),
    ("district.export", "district", "masters-districts", "export", "ALL", "Export district data."),
    ("district.import", "district", "masters-districts", "import", "ALL", "Import district data."),
    ("district.bulk_action", "district", "masters-districts", "manage", "ALL", "Use Bulk Actions in the district list."),
    # Companies
    ("company.view", "company", "companies", "view", "ALL", "View the company list and contacts; use search, filters, and the Active/Inactive tabs."),
    ("company.create", "company", "companies", "create", "ALL", "Create companies via Quick Add or Add New, and add company contacts."),
    ("company.update", "company", "companies", "update", "ALL", "Edit companies (Action > Edit), activate/deactivate, and edit contacts."),
    ("company.delete", "company", "companies", "delete", "ALL", "Delete companies (Action > Delete) and remove company contacts."),
    ("company.export", "company", "companies", "export", "ALL", "Export company data."),
    ("company.import", "company", "companies", "import", "ALL", "Import company data."),
    ("company.bulk_action", "company", "companies", "manage", "ALL", "Use Bulk Actions in the company list."),
    ("company.grade_edit", "company", "companies", "update", "ALL", "Edit the Grade dropdown in the company list (read-only without this)."),
    ("company.potential_edit", "company", "companies", "update", "ALL", "Edit the Potential dropdown in the company list (read-only without this)."),
]

USER_VIEW_PERMS = {"district.view", "company.view"}


async def seed_district_and_company_permissions() -> None:
    configure_logging()
    session_factory = get_sessionmaker()

    async with session_factory() as session:
        permission_repo = PermissionRepository(session)
        role_repo = RoleRepository(session)

        # 1. Ensure permissions exist
        created_perms: list[Permission] = []
        for code, module, page, action, scope, description in PERMISSIONS_TO_SEED:
            existing = await permission_repo.get_by_code(code)
            if existing is None:
                perm = Permission(
                    code=code,
                    module=module,
                    page=page,
                    action=action,
                    scope=scope,
                    description=description,
                )
                session.add(perm)
                created_perms.append(perm)
                print(f"Created permission: {code}")
            else:
                created_perms.append(existing)

        await session.flush()

        # 2. Grant all to super_admin role
        super_admin_role = await role_repo.get_by_name("super_admin")
        if super_admin_role:
            for perm in created_perms:
                existing_grant = (await session.execute(
                    select(RolePermission).where(
                        RolePermission.role_id == super_admin_role.id,
                        RolePermission.permission_id == perm.id,
                    )
                )).scalar_one_or_none()
                if existing_grant is None:
                    session.add(RolePermission(role_id=super_admin_role.id, permission_id=perm.id))
                    print(f"Granted '{perm.code}' to super_admin")

        # 3. Grant view perms to user role
        user_role = await role_repo.get_by_name("user")
        if user_role:
            for perm in created_perms:
                if perm.code in USER_VIEW_PERMS:
                    existing_grant = (await session.execute(
                        select(RolePermission).where(
                            RolePermission.role_id == user_role.id,
                            RolePermission.permission_id == perm.id,
                        )
                    )).scalar_one_or_none()
                    if existing_grant is None:
                        session.add(RolePermission(role_id=user_role.id, permission_id=perm.id))
                        print(f"Granted '{perm.code}' to user role")

        await session.commit()

        # 4. Invalidate cache for all users
        try:
            cache = get_cache()
            users = (await session.execute(select(User.id))).scalars().all()
            for uid in users:
                await cache.delete(f"user_perms:{uid}")
            print(f"Invalidated permission cache for {len(users)} users.")
        except Exception as e:
            print(f"Cache invalidation note: {e}")

    await dispose_engine()
    print("\nSuccessfully seeded district and company permissions.")


if __name__ == "__main__":
    asyncio.run(seed_district_and_company_permissions())
