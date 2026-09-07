"""Platform Admin Repository -- pure DB access, no business rules."""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.platform_auth.models import PlatformAdmin


class PlatformAdminRepository:
    """Data access for the `platform_admins` table."""

    def __init__(self, db: AsyncSession) -> None:
        """Store the request-scoped `AsyncSession`."""
        self.db = db

    async def get_by_id(self, admin_id: uuid.UUID) -> PlatformAdmin | None:
        """Fetch a single platform admin by id, or None if not found."""
        result = await self.db.execute(select(PlatformAdmin).where(PlatformAdmin.id == admin_id))
        return result.scalar_one_or_none()

    async def get_by_email(self, email: str) -> PlatformAdmin | None:
        """Fetch a single platform admin by email, or None if not found."""
        result = await self.db.execute(select(PlatformAdmin).where(PlatformAdmin.email == email))
        return result.scalar_one_or_none()

    async def count(self) -> int:
        """Return how many platform admin rows currently exist (used to gate bootstrap)."""
        result = await self.db.execute(select(PlatformAdmin))
        return len(result.scalars().all())

    async def create(self, admin: PlatformAdmin) -> PlatformAdmin:
        """Persist a new `PlatformAdmin` row and flush so its generated id is available."""
        self.db.add(admin)
        await self.db.flush()
        await self.db.refresh(admin)
        return admin
