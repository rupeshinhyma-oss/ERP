"""Adjustment Purpose Repository layer."""

from __future__ import annotations

import uuid
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.common.base_repository import BaseRepository
from app.masters.adjustment_purposes.models import AdjustmentPurpose


class AdjustmentPurposeRepository(BaseRepository[AdjustmentPurpose]):
    """Repository handling database operations for AdjustmentPurpose."""

    model = AdjustmentPurpose
    searchable_fields = ("name",)
    sortable_fields = ("created_at", "updated_at", "name", "status")
    filterable_fields = ("status", "name")

    def __init__(self, session: AsyncSession) -> None:
        """Bind to a DB session, operating on the ``AdjustmentPurpose`` model."""
        super().__init__(session, AdjustmentPurpose)

    async def get_by_name(self, name: str) -> AdjustmentPurpose | None:
        """Find an active or non-deleted adjustment purpose by exact name."""
        stmt = (
            select(AdjustmentPurpose)
            .where(AdjustmentPurpose.name == name, AdjustmentPurpose.deleted_at.is_(None))
            .limit(1)
        )
        result = await self.session.execute(stmt)
        return result.scalars().first()

    async def name_exists(self, name: str, *, exclude_id: uuid.UUID | None = None) -> bool:
        """Return True if another active/non-deleted adjustment purpose uses this name."""
        stmt = select(AdjustmentPurpose.id).where(
            AdjustmentPurpose.deleted_at.is_(None),
            AdjustmentPurpose.name == name,
        )
        if exclude_id is not None:
            stmt = stmt.where(AdjustmentPurpose.id != exclude_id)
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none() is not None

    async def list_all(self) -> list[AdjustmentPurpose]:
        """Return every non-deleted adjustment purpose, ordered by name."""
        stmt = self._base_select().order_by(AdjustmentPurpose.name)
        result = await self.session.execute(stmt)
        return list(result.scalars().all())
