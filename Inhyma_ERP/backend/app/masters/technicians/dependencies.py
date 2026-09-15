"""FastAPI dependency injection for the Technician master module."""

from __future__ import annotations

from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.cache.dependency import get_cache_manager
from app.cache.manager import CacheManager
from app.database.session import get_db_session
from app.masters.technicians.repository import TechnicianRepository
from app.masters.technicians.service import TechnicianService


async def get_technician_service(
    session: AsyncSession = Depends(get_db_session),
    cache_manager: CacheManager = Depends(get_cache_manager),
) -> TechnicianService:
    """Return a :class:`TechnicianService` wired to the current DB session and cache."""
    repository = TechnicianRepository(session)
    return TechnicianService(repository, cache_manager)
