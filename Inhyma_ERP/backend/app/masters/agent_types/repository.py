"""Agent Types Repository."""

from __future__ import annotations

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.common.base_repository import BaseRepository
from app.masters.agent_types.models import AgentType


class AgentTypeRepository(BaseRepository[AgentType]):
    """Repository for agent type master rows."""

    searchable_fields = ("name", "description")
    sortable_fields = ("name", "created_at", "updated_at")
    filterable_fields = ("status",)

    def __init__(self, session: AsyncSession) -> None:
        """Bind to a DB session, operating on the ``AgentType`` model."""
        super().__init__(session, AgentType)

    async def get_by_name(self, name: str) -> AgentType | None:
        """Fetch an agent type by unique name."""
        stmt = self._base_select().where(AgentType.name == name)
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()

    async def name_exists(self, name: str, *, exclude_id: uuid.UUID | None = None) -> bool:
        """Return True if another active/non-deleted agent type uses this name."""
        stmt = self._base_select().with_only_columns(AgentType.id).where(AgentType.name == name)
        if exclude_id is not None:
            stmt = stmt.where(AgentType.id != exclude_id)
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none() is not None
