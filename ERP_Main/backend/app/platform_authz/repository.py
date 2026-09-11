"""Platform Authorization Repository -- pure DB access, no business rules."""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.platform_authz.models import PlatformPermission, PlatformRole, PlatformRoleAssignment, RolePermission


class PlatformPermissionRepository:
    """Data access for the `platform_permissions` table."""

    def __init__(self, db: AsyncSession) -> None:
        """Store the request-scoped `AsyncSession`."""
        self.db = db

    async def get_by_key(self, permission_key: str) -> PlatformPermission | None:
        """Fetch a permission by its key, or None if not found."""
        result = await self.db.execute(
            select(PlatformPermission).where(PlatformPermission.permission_key == permission_key)
        )
        return result.scalar_one_or_none()

    async def list_all(self) -> list[PlatformPermission]:
        """List every defined platform permission."""
        result = await self.db.execute(select(PlatformPermission).order_by(PlatformPermission.permission_key))
        return list(result.scalars().all())

    async def create(self, permission: PlatformPermission) -> PlatformPermission:
        """Persist a new permission row and flush so its generated id is available."""
        self.db.add(permission)
        await self.db.flush()
        await self.db.refresh(permission)
        return permission


class PlatformRoleRepository:
    """Data access for the `platform_roles` table."""

    def __init__(self, db: AsyncSession) -> None:
        """Store the request-scoped `AsyncSession`."""
        self.db = db

    async def get_by_id(self, role_id: uuid.UUID) -> PlatformRole | None:
        """Fetch a role by id, or None if not found."""
        result = await self.db.execute(select(PlatformRole).where(PlatformRole.id == role_id))
        return result.scalar_one_or_none()

    async def get_by_key(self, role_key: str) -> PlatformRole | None:
        """Fetch a role by its stable key, or None if not found."""
        result = await self.db.execute(select(PlatformRole).where(PlatformRole.role_key == role_key))
        return result.scalar_one_or_none()

    async def list_all(self) -> list[PlatformRole]:
        """List every defined platform role."""
        result = await self.db.execute(select(PlatformRole).order_by(PlatformRole.role_key))
        return list(result.scalars().all())

    async def create(self, role: PlatformRole) -> PlatformRole:
        """Persist a new role row and flush so its generated id is available."""
        self.db.add(role)
        await self.db.flush()
        await self.db.refresh(role)
        return role

    async def get_role_permission_link(self, role_id: uuid.UUID, permission_id: uuid.UUID) -> RolePermission | None:
        """Fetch a specific RolePermission link, or None if the role doesn't already have that permission."""
        result = await self.db.execute(
            select(RolePermission).where(
                RolePermission.role_id == role_id, RolePermission.permission_id == permission_id
            )
        )
        return result.scalar_one_or_none()

    async def create_role_permission_link(self, link: RolePermission) -> RolePermission:
        """Persist a new RolePermission link and flush so its generated id is available."""
        self.db.add(link)
        await self.db.flush()
        await self.db.refresh(link)
        role = await self.get_by_id(link.role_id)
        if role is not None:
            await self.db.refresh(role, ["permission_links"])
        return link

    async def delete_role_permission_link(self, role_id: uuid.UUID, permission_id: uuid.UUID) -> bool:
        """Delete an existing RolePermission link, returning True if deleted, False if none found."""
        link = await self.get_role_permission_link(role_id, permission_id)
        if link is None:
            return False
        await self.db.delete(link)
        await self.db.flush()
        role = await self.get_by_id(role_id)
        if role is not None:
            await self.db.refresh(role, ["permission_links"])
        return True


class PlatformRoleAssignmentRepository:
    """Data access for the `platform_role_assignments` table."""

    def __init__(self, db: AsyncSession) -> None:
        """Store the request-scoped `AsyncSession`."""
        self.db = db

    async def get_by_id(self, assignment_id: uuid.UUID) -> PlatformRoleAssignment | None:
        """Fetch an assignment by id, or None if not found."""
        result = await self.db.execute(
            select(PlatformRoleAssignment).where(PlatformRoleAssignment.id == assignment_id)
        )
        return result.scalar_one_or_none()

    async def get_existing(
        self, global_user_id: uuid.UUID, role_id: uuid.UUID, erp_instance_id: uuid.UUID | None
    ) -> PlatformRoleAssignment | None:
        """Fetch the exact (user, role, erp) assignment if one already exists, active or not."""
        result = await self.db.execute(
            select(PlatformRoleAssignment).where(
                PlatformRoleAssignment.global_user_id == global_user_id,
                PlatformRoleAssignment.role_id == role_id,
                PlatformRoleAssignment.erp_instance_id == erp_instance_id,
            )
        )
        return result.scalar_one_or_none()

    async def list_active_for_user(self, global_user_id: uuid.UUID) -> list[PlatformRoleAssignment]:
        """List every currently-active assignment for a GlobalUser (expiry/revocation checked by the caller)."""
        result = await self.db.execute(
            select(PlatformRoleAssignment).where(
                PlatformRoleAssignment.global_user_id == global_user_id,
                PlatformRoleAssignment.is_active.is_(True),
            )
        )
        return list(result.scalars().all())

    async def list_for_user(self, global_user_id: uuid.UUID) -> list[PlatformRoleAssignment]:
        """List every assignment (active or not) for a GlobalUser, for audit/inspection purposes."""
        result = await self.db.execute(
            select(PlatformRoleAssignment)
            .where(PlatformRoleAssignment.global_user_id == global_user_id)
            .order_by(PlatformRoleAssignment.created_at.desc())
        )
        return list(result.scalars().all())

    async def create(self, assignment: PlatformRoleAssignment) -> PlatformRoleAssignment:
        """Persist a new assignment row and flush so its generated id is available."""
        self.db.add(assignment)
        await self.db.flush()
        await self.db.refresh(assignment)
        return assignment
