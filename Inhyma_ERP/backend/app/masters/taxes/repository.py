"""Tax Repository."""

from __future__ import annotations

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.common.base_repository import BaseRepository
from app.masters.taxes.models import Tax


class TaxRepository(BaseRepository[Tax]):
    """Repository for tax / HSN master rows."""

    searchable_fields = ("hsn_number",)
    sortable_fields = ("hsn_number", "gst_percent", "import_duty_percent", "created_at", "updated_at")
    filterable_fields = ("status",)

    def __init__(self, session: AsyncSession) -> None:
        """Bind to a DB session, operating on the ``Tax`` model."""
        super().__init__(session, Tax)

    async def get_by_hsn(self, hsn_number: str) -> Tax | None:
        """Fetch a tax record by unique HSN number."""
        stmt = self._base_select().where(Tax.hsn_number == hsn_number)
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()

    async def hsn_exists(self, hsn_number: str, *, exclude_id: uuid.UUID | None = None) -> bool:
        """Return True if another active/non-deleted tax entry uses this HSN number."""
        stmt = self._base_select().with_only_columns(Tax.id).where(Tax.hsn_number == hsn_number)
        if exclude_id is not None:
            stmt = stmt.where(Tax.id != exclude_id)
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none() is not None
