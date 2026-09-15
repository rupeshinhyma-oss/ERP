"""Warehouse Repository."""

from __future__ import annotations

import uuid
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.common.base_repository import BaseRepository
from app.masters.warehouses.models import Warehouse


class WarehouseRepository(BaseRepository[Warehouse]):
    """Repository for warehouse master rows."""

    searchable_fields = ("name", "address", "billing_company")
    sortable_fields = ("name", "billing_company", "over_selling", "is_primary", "status", "created_at", "updated_at")
    filterable_fields = ("status", "billing_company", "is_primary", "over_selling")

    def __init__(self, session: AsyncSession) -> None:
        """Bind to a DB session, operating on the ``Warehouse`` model."""
        super().__init__(session, Warehouse)

    def _base_select(self):
        """Base query preloading related main warehouse."""
        return select(Warehouse).options(selectinload(Warehouse.main_warehouse)).where(Warehouse.deleted_at.is_(None))

    async def get_by_name(self, name: str) -> Warehouse | None:
        """Fetch a warehouse by unique name."""
        stmt = self._base_select().where(Warehouse.name == name)
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()

    async def name_exists(self, name: str, *, exclude_id: uuid.UUID | None = None) -> bool:
        """Return True if another active/non-deleted warehouse uses this name."""
        stmt = select(Warehouse.id).where(Warehouse.deleted_at.is_(None), Warehouse.name == name)
        if exclude_id is not None:
            stmt = stmt.where(Warehouse.id != exclude_id)
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none() is not None

    async def list_primary_warehouses(self) -> list[Warehouse]:
        """Fetch all active primary warehouses."""
        stmt = self._base_select().where(Warehouse.is_primary.is_(True)).order_by(Warehouse.name.asc())
        result = await self.session.execute(stmt)
        return list(result.scalars().all())
