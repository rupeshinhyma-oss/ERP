"""
Seed billing company permissions:
- billingcompany.view
- billingcompany.create
- billingcompany.update
- billingcompany.delete
- billingcompany.export
- billingcompany.import
- billingcompany.bulk_action

Grants these permissions to super_admin and admin roles.
"""

from __future__ import annotations

import asyncio
from sqlalchemy import select

from app.core.logging import configure_logging, get_logger
from app.database.engine import dispose_engine, get_sessionmaker
import app.users.models  # noqa: F401
from app.rbac.models import Permission, Role, RolePermission
from app.rbac.repository import PermissionRepository, RoleRepository

logger = get_logger(__name__)

NEW_PERMISSIONS = [
    ("billingcompany.view", "billingcompany", "masters-billing-company", "view", "ALL", "View billing companies; use search, filters, and status tabs."),
    ("billingcompany.create", "billingcompany", "masters-billing-company", "create", "ALL", "Create billing companies."),
    ("billingcompany.update", "billingcompany", "masters-billing-company", "update", "ALL", "Edit and activate/deactivate billing companies."),
    ("billingcompany.delete", "billingcompany", "masters-billing-company", "delete", "ALL", "Delete billing companies."),
    ("billingcompany.export", "billingcompany", "masters-billing-company", "export", "ALL", "Export billing company data."),
    ("billingcompany.import", "billingcompany", "masters-billing-company", "import", "ALL", "Import billing company data."),
    ("billingcompany.bulk_action", "billingcompany", "masters-billing-company", "manage", "ALL", "Use Bulk Actions in the billing company list."),
]


async def seed_permissions() -> None:
    configure_logging()
    session_factory = get_sessionmaker()

    async with session_factory() as session:
        permission_repo = PermissionRepository(session)
        created_perms: list[Permission] = []

        for code, module, page, action, scope, description in NEW_PERMISSIONS:
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

        # Grant to super_admin and any admin role
        role_stmt = select(Role)
        all_roles = (await session.execute(role_stmt)).scalars().all()
        for role in all_roles:
            if role.name in ("super_admin", "admin") or "admin" in role.name.lower():
                for perm in created_perms:
                    existing_grant_stmt = select(RolePermission).where(
                        RolePermission.role_id == role.id,
                        RolePermission.permission_id == perm.id,
                    )
                    has_perm = (await session.execute(existing_grant_stmt)).scalar_one_or_none()
                    if has_perm is None:
                        session.add(
                            RolePermission(
                                role_id=role.id,
                                permission_id=perm.id,
                            )
                        )
                        print(f"Granted {perm.code} to {role.name}")

        await session.commit()
        print("Billing company permissions seeded successfully.")


async def main() -> None:
    try:
        await seed_permissions()
    finally:
        await dispose_engine()


if __name__ == "__main__":
    asyncio.run(main())
