"""
Seed the Platform Authorization catalog (Phase 5).

Creates the platform permission catalog (Section 6) and four starter
roles (Section 47) with sensible, least-privilege permission grants:

    PLATFORM_SUPER_ADMIN -- every permission in the catalog.
    PLATFORM_ADMIN       -- everything except the most destructive/
                             irreversible operations (ERP decommission,
                             signing-key rotation, service-identity
                             revocation) and role/permission
                             administration itself.
    PLATFORM_OPERATOR    -- day-to-day read/create/update operations,
                             no destructive or admin-catalog actions.
    PLATFORM_VIEWER      -- read-only across every domain.

Deliberately does NOT create any user account, PlatformAdmin, or
GlobalUser, and does NOT assign any role to anyone (Section 47/48: "Do
not create production admin accounts with hard-coded passwords"). This
script only makes the roles/permissions available for an existing
PlatformAdmin to assign via POST /global/authz/users/{id}/roles.

Idempotent -- safe to re-run; existing roles/permissions/grants are
left as-is, matching scripts/seed_registry.py's own convention.

Run with:
    cd backend && python -m scripts.seed_platform_authz
"""

from __future__ import annotations

import asyncio
import uuid

from app.database.base import Base
from app.database.engine import dispose_engine, get_engine, get_sessionmaker
from app.erp_registry.repository import ErpInstanceRepository
from app.global_audit.repository import GlobalAuditRepository
from app.global_audit.service import GlobalAuditService
from app.global_users.repository import GlobalUserRepository
from app.platform_authz.repository import (
    PlatformPermissionRepository,
    PlatformRoleAssignmentRepository,
    PlatformRoleRepository,
)
from app.platform_authz.schemas import PlatformPermissionCreate, PlatformRoleCreate
from app.platform_authz.service import PlatformAuthzService

# A fixed, deterministic nil-UUID actor id for audit rows this script
# writes -- there is no real PlatformAdmin/GlobalUser "running" a
# one-off seed script, so this makes seed-authored audit entries
# recognizable as such rather than pointing at a real (or fabricated)
# account id.
_SEED_ACTOR_ID = uuid.UUID(int=0)
_SEED_ACTOR_LABEL = "seed_platform_authz script"

# The full platform permission catalog (Phase 5 Section 6). Every entry
# here is created if missing; nothing is ever deleted by this script.
_PERMISSION_CATALOG: list[tuple[str, str]] = [
    ("platform.audit.view", "View the audit module and platform audit logs."),
    ("platform.user.read", "View Global User accounts."),
    ("platform.user.create", "Create a Global User account."),
    ("platform.user.update", "Update a Global User account."),
    ("platform.user.disable", "Disable a Global User account."),
    (
        "platform.system.manage",
        "Administer platform roles, permissions, and role assignments (create/update/delete a role, "
        "grant/revoke a permission, assign/revoke a role). Also used by app.integration and "
        "app.sync_policy for their own admin-only operations -- this is the one existing, shared "
        "'system administration' permission key, not a new one introduced here.",
    ),
]

# role_key -> list of permission_keys granted.
#
# PLATFORM_SUPER_ADMIN's own grant list is computed in seed() as "every
# permission in the catalog" rather than duplicated here, so it can never
# silently drift out of sync with _PERMISSION_CATALOG as new permissions
# are added over time.
#
# PLATFORM_ADMIN's list below is deliberately its OWN explicit list, not
# derived from the full catalog: per this module's own docstring, Admin
# gets "everything except... role/permission administration itself" --
# platform.system.manage is intentionally excluded here (only
# PLATFORM_SUPER_ADMIN holds it). Keep this list in sync by hand when a
# new non-system-admin permission is added to the catalog; deriving it
# automatically would silently re-grant every future permission
# (including any future destructive/system one) to PLATFORM_ADMIN,
# exactly the bug this fix corrects for platform.system.manage itself.
_ADMIN_PERMISSIONS: list[str] = [
    "platform.audit.view",
    "platform.user.read",
    "platform.user.create",
    "platform.user.update",
    "platform.user.disable",
]

_OPERATOR_PERMISSIONS: list[str] = [
    "platform.audit.view",
    "platform.user.read",
    "platform.user.create",
    "platform.user.update",
]

_VIEWER_PERMISSIONS: list[str] = [
    "platform.audit.view",
    "platform.user.read",
]

_ROLES: list[tuple[str, str, str]] = [
    ("PLATFORM_SUPER_ADMIN", "Platform Super Admin", "Unrestricted platform-wide access to every operation."),
    (
        "PLATFORM_ADMIN",
        "Platform Admin",
        "Broad platform administration, excluding the most destructive/irreversible actions and "
        "role/permission administration itself.",
    ),
    (
        "PLATFORM_OPERATOR",
        "Platform Operator",
        "Day-to-day read/create/update operations across ERP registry, users, memberships, and federation.",
    ),
    ("PLATFORM_VIEWER", "Platform Viewer", "Read-only visibility across every platform domain."),
]


async def _ensure_permission(service: PlatformAuthzService, permission_key: str, description: str) -> None:
    """Create a permission if it doesn't already exist. Idempotent -- safe to re-run."""
    existing = await service.permission_repository.get_by_key(permission_key)
    if existing is not None:
        return
    await service.create_permission(
        PlatformPermissionCreate(permission_key=permission_key, description=description),
        actor_id=_SEED_ACTOR_ID,
        actor_label=_SEED_ACTOR_LABEL,
    )
    print(f"Created permission: {permission_key}")


async def _ensure_role(
    service: PlatformAuthzService, role_key: str, display_name: str, description: str, grants: list[str]
):
    """Create a role if it doesn't already exist, then ensure every listed permission is granted. Idempotent."""
    role = await service.role_repository.get_by_key(role_key)
    if role is None:
        role = await service.create_role(
            PlatformRoleCreate(role_key=role_key, display_name=display_name, description=description),
            actor_id=_SEED_ACTOR_ID,
            actor_label=_SEED_ACTOR_LABEL,
        )
        print(f"Created role: {role_key}")
    else:
        print(f"Role already exists: {role_key} (is_active={role.is_active})")

    for permission_key in grants:
        await service.grant_permission_to_role(
            role.id, permission_key, actor_id=_SEED_ACTOR_ID, actor_label=_SEED_ACTOR_LABEL
        )
    print(f"  Ensured {len(grants)} permission grant(s) for {role_key}.")


async def seed() -> None:
    """Create tables if needed (local/dev only), then seed the permission catalog and four starter roles."""
    engine = get_engine()
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    session_factory = get_sessionmaker()
    async with session_factory() as db:
        audit = GlobalAuditService(repository=GlobalAuditRepository(db))
        service = PlatformAuthzService(
            role_repository=PlatformRoleRepository(db),
            permission_repository=PlatformPermissionRepository(db),
            assignment_repository=PlatformRoleAssignmentRepository(db),
            global_user_repository=GlobalUserRepository(db),
            erp_instance_repository=ErpInstanceRepository(db),
            audit=audit,
        )

        for permission_key, description in _PERMISSION_CATALOG:
            await _ensure_permission(service, permission_key, description)

        all_permission_keys = [key for key, _ in _PERMISSION_CATALOG]
        role_grants = {
            "PLATFORM_SUPER_ADMIN": all_permission_keys,
            "PLATFORM_ADMIN": _ADMIN_PERMISSIONS,
            "PLATFORM_OPERATOR": _OPERATOR_PERMISSIONS,
            "PLATFORM_VIEWER": _VIEWER_PERMISSIONS,
        }

        for role_key, display_name, description in _ROLES:
            await _ensure_role(service, role_key, display_name, description, role_grants[role_key])

        await db.commit()

    await dispose_engine()
    print("\nDone. No user, PlatformAdmin, or GlobalUser was created or assigned a role by this script.")
    print("Assign a role with: POST /api/v1/global/authz/users/{global_user_id}/roles")


if __name__ == "__main__":
    asyncio.run(seed())