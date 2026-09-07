"""Global User Repository -- pure DB access, no business rules."""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.global_users.models import GlobalUser


class GlobalUserRepository:
    """Data access for the `global_users` table."""

    def __init__(self, db: AsyncSession) -> None:
        """Store the request-scoped `AsyncSession`."""
        self.db = db

    async def get_by_id(self, user_id: uuid.UUID) -> GlobalUser | None:
        """Fetch a single Global User by id, or None if not found."""
        result = await self.db.execute(select(GlobalUser).where(GlobalUser.id == user_id))
        return result.scalar_one_or_none()

    async def get_by_email(self, primary_email: str) -> GlobalUser | None:
        """Fetch a single Global User by primary email, or None if not found."""
        result = await self.db.execute(select(GlobalUser).where(GlobalUser.primary_email == primary_email))
        return result.scalar_one_or_none()

    async def list_all(self, *, limit: int = 100, offset: int = 0) -> list[GlobalUser]:
        """List Global Users, paged, ordered by creation time."""
        result = await self.db.execute(
            select(GlobalUser).order_by(GlobalUser.created_at).limit(limit).offset(offset)
        )
        return list(result.scalars().all())

    async def create(self, user: GlobalUser) -> GlobalUser:
        """Persist a new `GlobalUser` row and flush so its generated id is available."""
        self.db.add(user)
        await self.db.flush()
        await self.db.refresh(user)
        return user
