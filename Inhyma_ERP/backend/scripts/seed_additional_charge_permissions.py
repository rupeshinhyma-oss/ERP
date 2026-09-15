"""
Seed additional charges permissions:
- additionalcharge.view
- additionalcharge.create
- additionalcharge.update
- additionalcharge.delete
- additionalcharge.export
- additionalcharge.import
- additionalcharge.bulk_action

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
    ("additionalcharge.view", "additionalcharge", "masters-additional-charges", "view", "ALL", "View additional charges; use search, filters, and the Active/Inactive tabs."),
    ("additionalcharge.create", "additionalcharge", "masters-additional-charges", "create", "ALL", "Create additional charges."),
    ("additionalcharge.update", "additionalcharge", "masters-additional-charges", "update", "ALL", "Edit and activate/deactivate additional charges."),
    ("additionalcharge.delete", "additionalcharge", "masters-additional-charges", "delete", "ALL", "Delete additional charges."),
    ("additionalcharge.export", "additionalcharge", "masters-additional-charges", "export", "ALL", "Export additional charges data."),
    ("additionalcharge.import", "additionalcharge", "masters-additional-charges", "import", "ALL", "Import additional charges data."),
    ("additionalcharge.bulk_action", "additionalcharge", "masters-additional-charges", "manage", "ALL", "Use Bulk Actions in the additional charges list."),
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
        print("Additional charges permissions seeded successfully.")


async def main() -> None:
    try:
        await seed_permissions()
    finally:
        await dispose_engine()


if __name__ == "__main__":
    asyncio.run(main())
