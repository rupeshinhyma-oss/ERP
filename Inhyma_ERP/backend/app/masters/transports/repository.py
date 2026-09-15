"""Transport Repository layer."""

from __future__ import annotations

import uuid
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.common.base_repository import BaseRepository
from app.masters.transports.models import Transport


class TransportRepository(BaseRepository[Transport]):
    """Repository handling database operations for Transport."""

    model = Transport
    searchable_fields = ("name", "gst_number", "mobile")
    sortable_fields = ("created_at", "updated_at", "name", "gst_number", "mobile", "status")
    filterable_fields = ("status", "name")

    def __init__(self, session: AsyncSession) -> None:
        """Bind to a DB session, operating on the ``Transport`` model."""
        super().__init__(session, Transport)

    async def get_by_name(self, name: str) -> Transport | None:
        """Find an active or non-deleted transport by exact name."""
        stmt = (
            select(Transport)
            .where(Transport.name == name, Transport.deleted_at.is_(None))
            .limit(1)
        )
        result = await self.session.execute(stmt)
        return result.scalars().first()

    async def name_exists(self, name: str, *, exclude_id: uuid.UUID | None = None) -> bool:
        """Return True if another active/non-deleted transport uses this name."""
        stmt = select(Transport.id).where(
            Transport.deleted_at.is_(None),
            Transport.name == name,
        )
        if exclude_id is not None:
            stmt = stmt.where(Transport.id != exclude_id)
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none() is not None

    async def list_all(self) -> list[Transport]:
        """Return every non-deleted transport, ordered by name."""
        stmt = self._base_select().order_by(Transport.name)
        result = await self.session.execute(stmt)
        return list(result.scalars().all())
