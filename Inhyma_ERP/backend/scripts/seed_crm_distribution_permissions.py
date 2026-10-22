"""
Seed CRM distribution permissions:
- crm.distribution.view
- crm.distribution.manage

Grants:
- super_admin / admin roles: crm.distribution.view and crm.distribution.manage
- Sales Manager role: crm.distribution.view (scoped view of department salespeople)

Restricts:
- Salesperson role: does NOT receive distribution permissions.
- user role: does NOT receive distribution permissions.

Usage:
    python -m scripts.seed_crm_distribution_permissions
"""

from __future__ import annotations

import asyncio
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import select

from app.cache.dependency import get_cache
from app.core.logging import configure_logging, get_logger
from app.database.engine import dispose_engine, get_sessionmaker
import app.users.models  # noqa: F401
from app.rbac.models import Permission, Role, RolePermission
from app.rbac.repository import PermissionRepository, RoleRepository

logger = get_logger(__name__)

CRM_DISTRIBUTION_PERMISSIONS = [
    (
        "crm.distribution.view",
        "crm",
        "crm-distribution",
        "view",
        "ALL",
        "View CRM salesperson distribution and territory assignments.",
    ),
    (
        "crm.distribution.manage",
        "crm",
        "crm-distribution",
        "manage",
        "ALL",
        "Configure salesperson lead assignment eligibility, territories, and priorities.",
    ),
]


async def seed_crm_distribution_permissions() -> None:
    configure_logging()
    session_factory = get_sessionmaker()

    async with session_factory() as session:
        permission_repo = PermissionRepository(session)
        created_perms: dict[str, Permission] = {}

        # 1. Ensure permissions exist
        for code, module, page, action, scope, description in CRM_DISTRIBUTION_PERMISSIONS:
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
                created_perms[code] = perm
                logger.info(f"Created permission: {code}")
            else:
                created_perms[code] = existing
                logger.info(f"Permission already exists: {code}")

        await session.flush()

        view_perm = created_perms["crm.distribution.view"]
        manage_perm = created_perms["crm.distribution.manage"]

        # 2. Grant permissions to intended roles
        role_stmt = select(Role).where(Role.deleted_at.is_(None))
        all_roles = (await session.execute(role_stmt)).scalars().all()

        for role in all_roles:
            role_name_lower = role.name.lower()

            # Super Admin & Admin: grant both view and manage
            if role_name_lower in ("super_admin", "admin") or "admin" in role_name_lower:
                for perm in [view_perm, manage_perm]:
                    existing_grant_stmt = select(RolePermission).where(
                        RolePermission.role_id == role.id,
                        RolePermission.permission_id == perm.id,
                    )
                    existing_grant = (await session.execute(existing_grant_stmt)).scalar_one_or_none()
                    if existing_grant is None:
                        session.add(RolePermission(role_id=role.id, permission_id=perm.id))
                        logger.info(f"Granted {perm.code} to role '{role.name}'")

            # Sales Manager: grant view ONLY (service layer enforces department/team scoping)
            elif role.name == "Sales Manager":
                existing_grant_stmt = select(RolePermission).where(
                    RolePermission.role_id == role.id,
                    RolePermission.permission_id == view_perm.id,
                )
                existing_grant = (await session.execute(existing_grant_stmt)).scalar_one_or_none()
                if existing_grant is None:
                    session.add(RolePermission(role_id=role.id, permission_id=view_perm.id))
                    logger.info(f"Granted {view_perm.code} to role '{role.name}'")

        await session.commit()

        # Invalidate permission cache
        try:
            cache = get_cache()
            await cache.delete_namespace("user_perms")
            logger.info("Invalidated user_perms cache namespace.")
        except Exception as e:
            logger.warning(f"Could not invalidate cache namespace: {e}")

        logger.info("CRM distribution permissions successfully seeded.")


if __name__ == "__main__":
    try:
        asyncio.run(seed_crm_distribution_permissions())
    finally:
        asyncio.run(dispose_engine())
