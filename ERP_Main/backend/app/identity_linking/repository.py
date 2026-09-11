"""
Identity Conflict Database Repository (Prompt 2).
"""

from __future__ import annotations

import uuid
from typing import Sequence

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.identity_linking.models import ConflictStatus, IdentityConflict


class IdentityConflictRepository:
    """Manages persistence and queries for IdentityConflict entities."""

    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def create(self, conflict: IdentityConflict) -> IdentityConflict:
        """Persist or update an identity conflict and refresh."""
        self.db.add(conflict)
        await self.db.flush()
        await self.db.refresh(conflict)
        return conflict

    async def get_by_id(self, conflict_id: uuid.UUID) -> IdentityConflict | None:
        """Fetch a conflict by its UUID."""
        stmt = select(IdentityConflict).where(IdentityConflict.id == conflict_id)
        result = await self.db.execute(stmt)
        return result.scalar_one_or_none()

    async def get_pending_by_erp_and_local_user(
        self, erp_instance_id: uuid.UUID, local_user_id: str
    ) -> IdentityConflict | None:
        """Find an existing PENDING conflict for this ERP and local user."""
        stmt = select(IdentityConflict).where(
            IdentityConflict.erp_instance_id == erp_instance_id,
            IdentityConflict.local_user_id == local_user_id,
            IdentityConflict.status == ConflictStatus.PENDING,
        )
        result = await self.db.execute(stmt)
        return result.scalar_one_or_none()

    async def list_conflicts(
        self,
        *,
        erp_instance_id: uuid.UUID | None = None,
        status: ConflictStatus | None = None,
        limit: int = 100,
        offset: int = 0,
    ) -> Sequence[IdentityConflict]:
        """List conflicts with optional filtering and pagination."""
        stmt = select(IdentityConflict)
        if erp_instance_id is not None:
            stmt = stmt.where(IdentityConflict.erp_instance_id == erp_instance_id)
        if status is not None:
            stmt = stmt.where(IdentityConflict.status == status)
        stmt = stmt.order_by(IdentityConflict.created_at.desc()).limit(limit).offset(offset)
        result = await self.db.execute(stmt)
        return result.scalars().all()

    async def count_conflicts(
        self,
        *,
        erp_instance_id: uuid.UUID | None = None,
        status: ConflictStatus | None = None,
    ) -> int:
        """Count conflicts with optional filtering."""
        stmt = select(func.count()).select_from(IdentityConflict)
        if erp_instance_id is not None:
            stmt = stmt.where(IdentityConflict.erp_instance_id == erp_instance_id)
        if status is not None:
            stmt = stmt.where(IdentityConflict.status == status)
        result = await self.db.execute(stmt)
        return result.scalar() or 0
