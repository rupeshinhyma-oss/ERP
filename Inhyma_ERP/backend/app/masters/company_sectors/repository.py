"""Company Sectors Repository."""

from __future__ import annotations

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.common.base_repository import BaseRepository
from app.masters.company_sectors.models import CompanySector


class CompanySectorRepository(BaseRepository[CompanySector]):
    """Repository for company sector master rows."""

    searchable_fields = ("name", "description")
    sortable_fields = ("name", "created_at", "updated_at")
    filterable_fields = ("status",)

    def __init__(self, session: AsyncSession) -> None:
        """Bind to a DB session, operating on the ``CompanySector`` model."""
        super().__init__(session, CompanySector)

    async def get_by_name(self, name: str) -> CompanySector | None:
        """Fetch a company sector by unique name."""
        stmt = self._base_select().where(CompanySector.name == name)
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()

    async def name_exists(self, name: str, *, exclude_id: uuid.UUID | None = None) -> bool:
        """Return True if another active/non-deleted company sector uses this name."""
        stmt = self._base_select().with_only_columns(CompanySector.id).where(CompanySector.name == name)
        if exclude_id is not None:
            stmt = stmt.where(CompanySector.id != exclude_id)
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none() is not None
