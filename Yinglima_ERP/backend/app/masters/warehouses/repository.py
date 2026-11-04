"""Warehouse Repository."""

from __future__ import annotations

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.common.base_repository import BaseRepository
from app.core.constants import RecordStatus
from app.masters.warehouses.models import Warehouse


class WarehouseRepository(BaseRepository[Warehouse]):
    """Repository for warehouse rows."""

    searchable_fields = ("name", "code", "location")
    sortable_fields = ("name", "code", "location", "created_at", "updated_at")
    filterable_fields = ("status",)

    def __init__(self, session: AsyncSession) -> None:
        """Bind to a DB session."""
        super().__init__(session, Warehouse)

    async def get_by_code(self, code: str) -> Warehouse | None:
        """Fetch a warehouse by its code."""
        stmt = self._base_select().where(Warehouse.code == code)
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()

    async def code_exists(self, code: str, *, exclude_id: uuid.UUID | None = None) -> bool:
        """Check if code exists."""
        stmt = self._base_select().with_only_columns(Warehouse.id).where(Warehouse.code == code)
        if exclude_id is not None:
            stmt = stmt.where(Warehouse.id != exclude_id)
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none() is not None

    async def get_by_name(self, name: str, *, exclude_id: uuid.UUID | None = None) -> Warehouse | None:
        """Fetch by name."""
        stmt = self._base_select().where(Warehouse.name == name)
        if exclude_id is not None:
            stmt = stmt.where(Warehouse.id != exclude_id)
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()

    async def list_all(self, *, active_only: bool = True) -> list[Warehouse]:
        """Return all warehouses, optionally filtering to active only, ordered by name."""
        stmt = self._base_select()
        if active_only:
            stmt = stmt.where(Warehouse.status == RecordStatus.ACTIVE)
        stmt = stmt.order_by(Warehouse.name)
        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    async def is_referenced(self, warehouse_id: uuid.UUID) -> bool:
        """Check if referenced."""
        return False

