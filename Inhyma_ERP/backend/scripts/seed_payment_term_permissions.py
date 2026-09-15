"""
Seed payment terms permissions:
- payment_term.view
- payment_term.create
- payment_term.update
- payment_term.delete
- payment_term.export
- payment_term.import
- payment_term.bulk_action

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
    ("payment_term.view", "payment_term", "masters-payment-terms", "view", "ALL", "View payment terms; use search, filters, and status tabs."),
    ("payment_term.create", "payment_term", "masters-payment-terms", "create", "ALL", "Create payment terms."),
    ("payment_term.update", "payment_term", "masters-payment-terms", "update", "ALL", "Edit and activate/deactivate payment terms."),
    ("payment_term.delete", "payment_term", "masters-payment-terms", "delete", "ALL", "Delete payment terms."),
    ("payment_term.export", "payment_term", "masters-payment-terms", "export", "ALL", "Export payment terms data."),
    ("payment_term.import", "payment_term", "masters-payment-terms", "import", "ALL", "Import payment terms data."),
    ("payment_term.bulk_action", "payment_term", "masters-payment-terms", "manage", "ALL", "Use Bulk Actions in the payment terms list."),
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
        print("Payment terms permissions successfully seeded and granted to roles.")

    await dispose_engine()


if __name__ == "__main__":
    asyncio.run(seed_permissions())
