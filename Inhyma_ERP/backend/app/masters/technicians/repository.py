"""Technician Repository."""

from __future__ import annotations

import uuid
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.common.base_repository import BaseRepository
from app.masters.technicians.models import Technician


class TechnicianRepository(BaseRepository[Technician]):
    """Repository for technician master rows."""

    searchable_fields = ("name", "mobile", "city")
    sortable_fields = ("name", "mobile", "city", "status", "created_at", "updated_at")
    filterable_fields = ("status", "city")

    def __init__(self, session: AsyncSession) -> None:
        """Bind to a DB session, operating on the ``Technician`` model."""
        super().__init__(session, Technician)

    async def get_by_mobile(self, mobile: str) -> Technician | None:
        """Fetch a technician by unique mobile number."""
        stmt = select(Technician).where(
            Technician.deleted_at.is_(None),
            Technician.mobile == mobile,
        )
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()

    async def mobile_exists(self, mobile: str, *, exclude_id: uuid.UUID | None = None) -> bool:
        """Return True if another active/non-deleted technician uses this mobile number."""
        stmt = select(Technician.id).where(
            Technician.deleted_at.is_(None),
            Technician.mobile == mobile,
        )
        if exclude_id is not None:
            stmt = stmt.where(Technician.id != exclude_id)
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none() is not None
