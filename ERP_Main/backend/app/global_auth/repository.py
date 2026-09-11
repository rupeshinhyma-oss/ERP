"""Global Authentication Repository -- pure DB access, no business rules."""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.global_auth.models import GlobalSession, GlobalUserCredential


class GlobalUserCredentialRepository:
    """Data access for the `global_user_credentials` table."""

    def __init__(self, db: AsyncSession) -> None:
        """Store the request-scoped `AsyncSession`."""
        self.db = db

    async def get_by_global_user_id(self, global_user_id: uuid.UUID) -> GlobalUserCredential | None:
        """Fetch a Global User's credential row, or None if they have never set one."""
        result = await self.db.execute(
            select(GlobalUserCredential).where(GlobalUserCredential.global_user_id == global_user_id)
        )
        return result.scalar_one_or_none()

    async def create(self, credential: GlobalUserCredential) -> GlobalUserCredential:
        """Persist a new credential row and flush so its generated id is available."""
        self.db.add(credential)
        await self.db.flush()
        await self.db.refresh(credential)
        return credential


class GlobalSessionRepository:
    """Data access for the `global_sessions` table."""

    def __init__(self, db: AsyncSession) -> None:
        """Store the request-scoped `AsyncSession`."""
        self.db = db

    async def get_by_id(self, session_id: uuid.UUID) -> GlobalSession | None:
        """Fetch a single session by id, or None if not found."""
        result = await self.db.execute(select(GlobalSession).where(GlobalSession.id == session_id))
        return result.scalar_one_or_none()

    async def list_for_user(self, global_user_id: uuid.UUID) -> list[GlobalSession]:
        """List every session (active or not) belonging to a Global User, newest first."""
        result = await self.db.execute(
            select(GlobalSession)
            .where(GlobalSession.global_user_id == global_user_id)
            .order_by(GlobalSession.created_at.desc())
        )
        return list(result.scalars().all())

    async def create(self, session: GlobalSession) -> GlobalSession:
        """Persist a new session row and flush so its generated id is available."""
        self.db.add(session)
        await self.db.flush()
        await self.db.refresh(session)
        return session
