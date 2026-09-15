"""FastAPI dependency injection for the Warehouse master module."""

from __future__ import annotations

from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.cache.dependency import get_cache_manager
from app.cache.manager import CacheManager
from app.database.session import get_db_session
from app.masters.warehouses.repository import WarehouseRepository
from app.masters.warehouses.service import WarehouseService


async def get_warehouse_service(
    session: AsyncSession = Depends(get_db_session),
    cache_manager: CacheManager = Depends(get_cache_manager),
) -> WarehouseService:
    """Return a :class:`WarehouseService` wired to the current DB session and cache."""
    repository = WarehouseRepository(session)
    return WarehouseService(repository, cache_manager)
