"""Social Media Repository."""

from __future__ import annotations

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.common.base_repository import BaseRepository
from app.masters.social_media.models import SocialMedia


class SocialMediaRepository(BaseRepository[SocialMedia]):
    """Repository for social media platform master rows."""

    searchable_fields = ("name",)
    sortable_fields = ("name", "created_at", "updated_at")
    filterable_fields = ("status",)

    def __init__(self, session: AsyncSession) -> None:
        """Bind to a DB session, operating on the ``SocialMedia`` model."""
        super().__init__(session, SocialMedia)

    async def get_by_name(self, name: str) -> SocialMedia | None:
        """Fetch a social media platform by unique name."""
        stmt = self._base_select().where(SocialMedia.name == name)
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()

    async def name_exists(self, name: str, *, exclude_id: uuid.UUID | None = None) -> bool:
        """Return True if another active/non-deleted social media platform uses this name."""
        stmt = self._base_select().with_only_columns(SocialMedia.id).where(SocialMedia.name == name)
        if exclude_id is not None:
            stmt = stmt.where(SocialMedia.id != exclude_id)
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none() is not None
