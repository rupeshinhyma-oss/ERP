"""
Seed Technical Tasks permissions (`technicaltask.*`).

Grants these permissions to super_admin and admin roles, and invalidates
cached user permissions so changes take effect immediately.
"""

from __future__ import annotations

import asyncio
from sqlalchemy import select

from app.cache.dependency import get_cache
from app.core.logging import configure_logging, get_logger
from app.database.engine import dispose_engine, get_sessionmaker
import app.users.models  # noqa: F401
from app.rbac.models import Permission, Role, RolePermission
from app.rbac.repository import PermissionRepository

logger = get_logger(__name__)

NEW_PERMISSIONS = [
    ("technicaltask.view", "technicaltask", "technical-tasks", "view", "ALL", "View Technical Tasks module and All tab."),
    ("technicaltask.pending.view", "technicaltask", "technical-tasks", "view", "ALL", "View the Pending status tab in Technical Tasks."),
    ("technicaltask.approved.view", "technicaltask", "technical-tasks", "view", "ALL", "View the Approved status tab in Technical Tasks."),
    ("technicaltask.completed.view", "technicaltask", "technical-tasks", "view", "ALL", "View the Completed status tab in Technical Tasks."),
    ("technicaltask.cancel.view", "technicaltask", "technical-tasks", "view", "ALL", "View the Cancel status tab in Technical Tasks."),
    ("technicaltask.create", "technicaltask", "technical-tasks", "create", "ALL", "Show + ADD NEW button and create new technical tasks."),
    ("technicaltask.bulk_action", "technicaltask", "technical-tasks", "manage", "ALL", "Show Bulk Actions menu (bulk approve, bulk complete, bulk delete) in Technical Tasks."),
    ("technicaltask.action.view", "technicaltask", "technical-tasks", "view", "ALL", "View the Action (3-dots) column in the Technical Tasks table."),
    ("technicaltask.call_logs.view", "technicaltask", "technical-tasks", "view", "ALL", "View Call Logs in Action menu and access the Call & Task Logs detail page."),
    ("technicaltask.approve", "technicaltask", "technical-tasks", "approve", "ALL", "View/use Approved action (Pending stage), allot technicians, and override service/charge details."),
    ("technicaltask.complete", "technicaltask", "technical-tasks", "update", "ALL", "View/use Completed action (Approved stage) and bulk mark completed."),
    ("technicaltask.cancel", "technicaltask", "technical-tasks", "update", "ALL", "View/use Cancel action (Approved stage) in Technical Tasks."),
    ("technicaltask.reopen", "technicaltask", "technical-tasks", "approve", "ALL", "View/use Reopen / Reassign action (Cancel stage) in Technical Tasks."),
    ("technicaltask.update", "technicaltask", "technical-tasks", "update", "ALL", "View/use Edit action in Technical Tasks and add call logs."),
    ("technicaltask.delete", "technicaltask", "technical-tasks", "delete", "ALL", "View/use Delete action in Technical Tasks."),
    ("technicaltask.manage", "technicaltask", "technical-tasks", "manage", "ALL", "Full administrative control over technical tasks, including all tabs, action menu items, editing/deleting approved tasks, and reopening cancelled tasks."),
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
                existing.module = module
                existing.page = page
                existing.action = action
                existing.scope = scope
                existing.description = description
                created_perms.append(existing)

        await session.flush()

        # Grant to super_admin and any admin role
        role_stmt = select(Role).where(Role.deleted_at.is_(None))
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

    try:
        cache = get_cache()
        await cache.delete_namespace("user_perms")
        await cache.delete_namespace("permissions")
    except Exception:
        pass

    print("Technical Tasks permissions seeded successfully.")


async def main() -> None:
    try:
        await seed_permissions()
    finally:
        await dispose_engine()


if __name__ == "__main__":
    asyncio.run(main())

