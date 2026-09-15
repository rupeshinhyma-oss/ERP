"""Company Categories Repository."""

from __future__ import annotations

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.common.base_repository import BaseRepository
from app.masters.company_categories.models import CompanyCategory


class CompanyCategoryRepository(BaseRepository[CompanyCategory]):
    """Repository for company category master rows."""

    searchable_fields = ("name", "business_type", "description")
    sortable_fields = ("name", "business_type", "created_at", "updated_at")
    filterable_fields = ("status", "business_type")

    def __init__(self, session: AsyncSession) -> None:
        """Bind to a DB session, operating on the ``CompanyCategory`` model."""
        super().__init__(session, CompanyCategory)

    async def get_by_name(self, name: str) -> CompanyCategory | None:
        """Fetch a company category by unique name."""
        stmt = self._base_select().where(CompanyCategory.name == name)
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()

    async def name_exists(self, name: str, *, exclude_id: uuid.UUID | None = None) -> bool:
        """Return True if another active/non-deleted company category uses this name."""
        stmt = self._base_select().with_only_columns(CompanyCategory.id).where(CompanyCategory.name == name)
        if exclude_id is not None:
            stmt = stmt.where(CompanyCategory.id != exclude_id)
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none() is not None
