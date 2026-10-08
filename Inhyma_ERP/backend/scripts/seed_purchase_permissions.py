"""
Seed the permissions the Proforma and Local Purchase workflows check:
- proforma.approve        approve a proforma invoice (otherwise admins only)
- localpurchase.update    edit a pending local purchase (accounts)
- localpurchase.confirm   confirm a local purchase, which adds its stock (accounts)

Grants them to super_admin and admin roles. Give them to the Accounts role from the RBAC screen.
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
    ("proforma.approve", "proforma", "proforma-invoice", "approve", "ALL", "Approve proforma invoices."),
    ("localpurchase.update", "localpurchase", "purchase-local", "update", "ALL", "Edit pending local purchases."),
    ("localpurchase.confirm", "localpurchase", "purchase-local", "confirm", "ALL", "Confirm local purchases (adds stock)."),
    ("saleorder.approve", "saleorder", "sales-process", "approve", "ALL", "Admin-approve a sale order."),
    ("saleorder.accounts", "saleorder", "sales-process", "accounts", "ALL", "Confirm a sale order at the accounts stage (invoice)."),
    ("saleorder.warehouse", "saleorder", "sales-process", "warehouse", "ALL", "Create gatepass, dispatch and attach LR (warehouse)."),
    ("saleorder.delete", "saleorder", "sales-process", "delete", "ALL", "Delete a pending sale order."),
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
        print("Proforma / purchase permissions seeded successfully.")


async def main() -> None:
    try:
        await seed_permissions()
    finally:
        await dispose_engine()


if __name__ == "__main__":
    asyncio.run(main())