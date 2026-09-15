"""
Seed bank permissions:
- bank.view
- bank.create
- bank.update
- bank.delete
- bank.export
- bank.import
- bank.bulk_action

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
    ("bank.view", "bank", "masters-banks", "view", "ALL", "View banks; use search, filters, and status tabs."),
    ("bank.create", "bank", "masters-banks", "create", "ALL", "Create bank accounts."),
    ("bank.update", "bank", "masters-banks", "update", "ALL", "Edit and activate/deactivate banks."),
    ("bank.delete", "bank", "masters-banks", "delete", "ALL", "Delete banks."),
    ("bank.export", "bank", "masters-banks", "export", "ALL", "Export bank data."),
    ("bank.import", "bank", "masters-banks", "import", "ALL", "Import bank data."),
    ("bank.bulk_action", "bank", "masters-banks", "manage", "ALL", "Use Bulk Actions in the bank list."),
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
                print(f"Permission already exists: {code}")

        await session.flush()

        role_repo = RoleRepository(session)
        super_admin_role = await role_repo.get_by_name("super_admin")
        admin_role = await role_repo.get_by_name("admin")

        target_roles = [r for r in [super_admin_role, admin_role] if r is not None]

        for role in target_roles:
            stmt = select(RolePermission.permission_id).where(RolePermission.role_id == role.id)
            existing_perm_ids = set((await session.execute(stmt)).scalars().all())

            for perm in created_perms:
                if perm.id not in existing_perm_ids:
                    rp = RolePermission(role_id=role.id, permission_id=perm.id)
                    session.add(rp)
                    print(f"Granted {perm.code} to role {role.name}")

        await session.commit()
        print("Bank permissions successfully seeded and granted to roles.")

    await dispose_engine()


if __name__ == "__main__":
    asyncio.run(seed_permissions())
