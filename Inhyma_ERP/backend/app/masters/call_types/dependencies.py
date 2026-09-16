"""FastAPI dependencies for the Call Types master module."""

from __future__ import annotations

from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.cache.dependency import get_cache_manager
from app.cache.manager import CacheManager
from app.database.session import get_db_session
from app.masters.call_types.repository import CallTypeRepository
from app.masters.call_types.service import CallTypeService


async def get_call_type_service(
    session: AsyncSession = Depends(get_db_session),
    cache_manager: CacheManager = Depends(get_cache_manager),
) -> CallTypeService:
    """Yield a CallTypeService instance scoped to the current database session."""
    repository = CallTypeRepository(session)
    return CallTypeService(repository, cache_manager)
