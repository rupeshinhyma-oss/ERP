"""
Seed inquiry and quotation permissions into the database:
- inquiry.view
- inquiry.create
- inquiry.update
- inquiry.delete
- inquiry.approve
- quotation.create
- quotation.approve
- quotation.delete

Grants all these permissions to the 'super_admin' role, and grants 'inquiry.view' to the 'user' role.

Usage:
    python -m scripts.seed_inquiry_permissions
"""

from __future__ import annotations

import asyncio
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import select

from app.core.logging import configure_logging, get_logger
from app.database.engine import dispose_engine, get_sessionmaker
from app.rbac.models import Permission, Role, RolePermission
from app.rbac.repository import PermissionRepository, RoleRepository
import app.users.models  # noqa: F401

logger = get_logger(__name__)

INQUIRY_PERMISSIONS = [
    # (code, module, page, action, scope, description)
    ("inquiry.view", "inquiry", "inquiries", "view", "ALL", "View inquiries and consignment lists."),
    ("inquiry.create", "inquiry", "inquiries", "create", "ALL", "Create new inquiries and consignments."),
    ("inquiry.update", "inquiry", "inquiries", "update", "ALL", "Edit inquiries, items, statuses, and send messages."),
    ("inquiry.delete", "inquiry", "inquiries", "delete", "ALL", "Delete inquiries and consignment items."),
    ("inquiry.approve", "inquiry", "inquiries", "manage", "ALL", "Approve inquiry quotes and confirm consignments."),
    ("quotation.create", "inquiry", "inquiries", "create", "ALL", "Add and upload quotations for inquiry items."),
    ("quotation.approve", "inquiry", "inquiries", "manage", "ALL", "Approve quotations for inquiry items."),
    ("quotation.delete", "inquiry", "inquiries", "delete", "ALL", "Delete quotations and quotation attachments."),
]


async def seed_inquiry_permissions() -> None:
    configure_logging()
    session_factory = get_sessionmaker()

    async with session_factory() as session:
        permission_repo = PermissionRepository(session)
        role_repo = RoleRepository(session)

        # 1. Ensure permissions exist
        created_perms: list[Permission] = []
        for code, module, page, action, scope, description in INQUIRY_PERMISSIONS:
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

        # 2. Grant to super_admin and user roles
        role_stmt = select(Role)
        all_roles = (await session.execute(role_stmt)).scalars().all()
        for role in all_roles:
            if role.name == "super_admin":
                for perm in created_perms:
                    existing_grant_stmt = select(RolePermission).where(
                        RolePermission.role_id == role.id,
                        RolePermission.permission_id == perm.id,
                    )
                    existing_grant = (await session.execute(existing_grant_stmt)).scalar_one_or_none()
                    if existing_grant is None:
                        session.add(RolePermission(role_id=role.id, permission_id=perm.id))
                        print(f"  Granted '{perm.code}' to super_admin role '{role.name}'")
            elif role.name == "user":
                inquiry_view = next((p for p in created_perms if p.code == "inquiry.view"), None)
                if inquiry_view:
                    existing_grant_stmt = select(RolePermission).where(
                        RolePermission.role_id == role.id,
                        RolePermission.permission_id == inquiry_view.id,
                    )
                    existing_grant = (await session.execute(existing_grant_stmt)).scalar_one_or_none()
                    if existing_grant is None:
                        session.add(RolePermission(role_id=role.id, permission_id=inquiry_view.id))
                        print(f"  Granted 'inquiry.view' to user role '{role.name}'")

        await session.commit()

    await dispose_engine()
    print("\nSuccessfully seeded all inquiry and quotation permissions.")


if __name__ == "__main__":
    asyncio.run(seed_inquiry_permissions())
