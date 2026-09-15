"""
Seed company sector permissions:
- companysector.view
- companysector.create
- companysector.update
- companysector.delete
- companysector.export
- companysector.import
- companysector.bulk_action

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
    ("companysector.view", "companysector", "masters-company-sectors", "view", "ALL", "View company sectors; use search, filters, and the Active/Inactive tabs."),
    ("companysector.create", "companysector", "masters-company-sectors", "create", "ALL", "Create company sectors."),
    ("companysector.update", "companysector", "masters-company-sectors", "update", "ALL", "Edit and activate/deactivate company sectors."),
    ("companysector.delete", "companysector", "masters-company-sectors", "delete", "ALL", "Delete company sectors."),
    ("companysector.export", "companysector", "masters-company-sectors", "export", "ALL", "Export company sectors data."),
    ("companysector.import", "companysector", "masters-company-sectors", "import", "ALL", "Import company sectors data."),
    ("companysector.bulk_action", "companysector", "masters-company-sectors", "manage", "ALL", "Use Bulk Actions in the company sectors list."),
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
        print("Company sector permissions seeded successfully.")


async def main() -> None:
    try:
        await seed_permissions()
    finally:
        await dispose_engine()


if __name__ == "__main__":
    asyncio.run(main())
