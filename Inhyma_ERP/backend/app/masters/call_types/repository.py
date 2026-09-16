"""Call Type Repository layer."""

from __future__ import annotations

import uuid
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.common.base_repository import BaseRepository
from app.masters.call_types.models import CallType


class CallTypeRepository(BaseRepository[CallType]):
    """Repository handling database operations for CallType."""

    model = CallType
    searchable_fields = ("name",)
    sortable_fields = ("created_at", "updated_at", "name", "status")
    filterable_fields = ("status", "name")

    def __init__(self, session: AsyncSession) -> None:
        """Bind to a DB session, operating on the ``CallType`` model."""
        super().__init__(session, CallType)

    async def get_by_name(self, name: str) -> CallType | None:
        """Find an active or non-deleted call type by exact name."""
        stmt = (
            select(CallType)
            .where(CallType.name == name, CallType.deleted_at.is_(None))
            .limit(1)
        )
        result = await self.session.execute(stmt)
        return result.scalars().first()

    async def name_exists(self, name: str, *, exclude_id: uuid.UUID | None = None) -> bool:
        """Return True if another active/non-deleted call type uses this name."""
        stmt = select(CallType.id).where(
            CallType.deleted_at.is_(None),
            CallType.name == name,
        )
        if exclude_id is not None:
            stmt = stmt.where(CallType.id != exclude_id)
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none() is not None

    async def list_all(self) -> list[CallType]:
        """Return every non-deleted call type, ordered by name."""
        stmt = self._base_select().order_by(CallType.name)
        result = await self.session.execute(stmt)
        return list(result.scalars().all())
