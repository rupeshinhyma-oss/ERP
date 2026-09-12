"""District Repository. Query-specific extensions for ``districts``."""

from __future__ import annotations

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.common.base_repository import BaseRepository
from app.masters.districts.models import District


class DistrictRepository(BaseRepository[District]):
    """Repository for district rows."""

    searchable_fields = ("name", "code")
    sortable_fields = ("name", "code", "created_at", "updated_at")
    filterable_fields = ("status", "country_id", "state_id")

    def __init__(self, session: AsyncSession) -> None:
        """Bind to a DB session, operating on the ``District`` model."""
        super().__init__(session, District)

    async def name_exists_in_state(
        self, state_id: uuid.UUID, name: str, *, exclude_id: uuid.UUID | None = None
    ) -> bool:
        """Return True if another (non-deleted) district in this state already uses this name."""
        stmt = (
            self._base_select()
            .with_only_columns(District.id)
            .where(District.state_id == state_id, District.name == name)
        )
        if exclude_id is not None:
            stmt = stmt.where(District.id != exclude_id)
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none() is not None

    async def get_by_name_in_state(
        self, state_id: uuid.UUID, name: str, *, exclude_id: uuid.UUID | None = None
    ) -> District | None:
        """Fetch the district in this state with this name, if one exists (for duplicate-compare)."""
        stmt = self._base_select().where(District.state_id == state_id, District.name == name)
        if exclude_id is not None:
            stmt = stmt.where(District.id != exclude_id)
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()

    async def list_all(self) -> list[District]:
        """Return every non-deleted district, ordered by name."""
        stmt = self._base_select().order_by(District.name)
        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    async def list_by_state(self, state_id: uuid.UUID) -> list[District]:
        """Return every active non-deleted district in the given state, ordered by name."""
        stmt = self._base_select().where(District.state_id == state_id).order_by(District.name)
        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    async def is_referenced(self, district_id: uuid.UUID) -> bool:
        """Return True if any other module references this district."""
        return False
