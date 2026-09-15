"""Additional Charges Repository."""

from __future__ import annotations

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.common.base_repository import BaseRepository
from app.masters.additional_charges.models import AdditionalCharge


class AdditionalChargeRepository(BaseRepository[AdditionalCharge]):
    """Repository for additional charge master rows."""

    searchable_fields = ("name", "hsn_number", "description")
    sortable_fields = ("name", "hsn_number", "gst_percent", "created_at", "updated_at")
    filterable_fields = ("status",)

    def __init__(self, session: AsyncSession) -> None:
        """Bind to a DB session, operating on the ``AdditionalCharge`` model."""
        super().__init__(session, AdditionalCharge)

    async def get_by_name(self, name: str) -> AdditionalCharge | None:
        """Fetch an additional charge record by unique name."""
        stmt = self._base_select().where(AdditionalCharge.name == name)
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()

    async def name_exists(self, name: str, *, exclude_id: uuid.UUID | None = None) -> bool:
        """Return True if another active/non-deleted charge entry uses this name."""
        stmt = self._base_select().with_only_columns(AdditionalCharge.id).where(AdditionalCharge.name == name)
        if exclude_id is not None:
            stmt = stmt.where(AdditionalCharge.id != exclude_id)
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none() is not None
