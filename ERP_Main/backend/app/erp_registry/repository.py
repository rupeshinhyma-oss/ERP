"""
ERP Registry Repository.

Pure async SQLAlchemy query building for `ErpInstance` / `ErpModule`. No
business rules live here (uniqueness policy, decommission semantics, etc.
belong to `service.py`) -- this module only knows how to read and write
rows.
"""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.erp_registry.models import ErpInstance, ErpModule


class ErpInstanceRepository:
    """Data access for the `erp_instances` table."""

    def __init__(self, db: AsyncSession) -> None:
        """Store the request-scoped `AsyncSession`."""
        self.db = db

    async def get_by_id(self, erp_id: uuid.UUID) -> ErpInstance | None:
        """Fetch a single ERP instance by its internal UUID, or None if not found."""
        result = await self.db.execute(select(ErpInstance).where(ErpInstance.id == erp_id))
        return result.scalar_one_or_none()

    async def get_by_key(self, key: str) -> ErpInstance | None:
        """Fetch a single ERP instance by its stable machine-readable key, or None if not found."""
        result = await self.db.execute(select(ErpInstance).where(ErpInstance.key == key))
        return result.scalar_one_or_none()

    async def list_all(self) -> list[ErpInstance]:
        """Return every registered ERP instance, ordered by key for stable listing."""
        result = await self.db.execute(select(ErpInstance).order_by(ErpInstance.key))
        return list(result.scalars().all())

    async def create(self, erp_instance: ErpInstance) -> ErpInstance:
        """Persist a new `ErpInstance` row and flush so its generated id is available."""
        self.db.add(erp_instance)
        await self.db.flush()
        await self.db.refresh(erp_instance)
        return erp_instance


class ErpModuleRepository:
    """Data access for the `erp_modules` table."""

    def __init__(self, db: AsyncSession) -> None:
        """Store the request-scoped `AsyncSession`."""
        self.db = db

    async def get_by_instance_and_key(self, erp_instance_id: uuid.UUID, module_key: str) -> ErpModule | None:
        """Fetch a single module row for an ERP instance by its module_key, or None if not found."""
        result = await self.db.execute(
            select(ErpModule).where(
                ErpModule.erp_instance_id == erp_instance_id,
                ErpModule.module_key == module_key,
            )
        )
        return result.scalar_one_or_none()

    async def create(self, module: ErpModule) -> ErpModule:
        """Persist a new `ErpModule` row and flush so its generated id is available."""
        self.db.add(module)
        await self.db.flush()
        await self.db.refresh(module)
        return module
