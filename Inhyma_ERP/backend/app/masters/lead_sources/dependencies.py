"""FastAPI dependencies for the Lead Sources master module."""

from __future__ import annotations

from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.cache.dependency import get_cache_manager
from app.cache.manager import CacheManager
from app.database.session import get_db_session
from app.masters.lead_sources.repository import LeadSourceRepository
from app.masters.lead_sources.service import LeadSourceService


async def get_lead_source_service(
    session: AsyncSession = Depends(get_db_session),
    cache_manager: CacheManager = Depends(get_cache_manager),
) -> LeadSourceService:
    """Yield a LeadSourceService instance scoped to the current database session."""
    repository = LeadSourceRepository(session)
    return LeadSourceService(repository, cache_manager)
