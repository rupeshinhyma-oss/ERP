"""Lead Source Repository layer."""

from __future__ import annotations

import uuid
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.common.base_repository import BaseRepository
from app.masters.lead_sources.models import LeadSource


class LeadSourceRepository(BaseRepository[LeadSource]):
    """Repository handling database operations for LeadSource."""

    model = LeadSource
    searchable_fields = ("name",)
    sortable_fields = ("created_at", "updated_at", "name", "status")
    filterable_fields = ("status", "name")

    def __init__(self, session: AsyncSession) -> None:
        """Bind to a DB session, operating on the ``LeadSource`` model."""
        super().__init__(session, LeadSource)

    async def get_by_name(self, name: str) -> LeadSource | None:
        """Find an active or non-deleted lead source by exact name."""
        stmt = (
            select(LeadSource)
            .where(LeadSource.name == name, LeadSource.deleted_at.is_(None))
            .limit(1)
        )
        result = await self.session.execute(stmt)
        return result.scalars().first()

    async def name_exists(self, name: str, *, exclude_id: uuid.UUID | None = None) -> bool:
        """Return True if another active/non-deleted lead source uses this name."""
        stmt = select(LeadSource.id).where(
            LeadSource.deleted_at.is_(None),
            LeadSource.name == name,
        )
        if exclude_id is not None:
            stmt = stmt.where(LeadSource.id != exclude_id)
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none() is not None

    async def list_all(self) -> list[LeadSource]:
        """Return every non-deleted lead source, ordered by name."""
        stmt = self._base_select().order_by(LeadSource.name)
        result = await self.session.execute(stmt)
        return list(result.scalars().all())
