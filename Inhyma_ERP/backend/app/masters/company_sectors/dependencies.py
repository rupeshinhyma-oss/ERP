"""Company Sectors Dependencies. FastAPI DI wiring for the company sectors module."""

from __future__ import annotations

from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.cache.dependency import get_cache_manager
from app.cache.manager import CacheManager
from app.database.session import get_db_session
from app.masters.company_sectors.repository import CompanySectorRepository
from app.masters.company_sectors.service import CompanySectorService


def get_company_sector_repository(db: AsyncSession = Depends(get_db_session)) -> CompanySectorRepository:
    """Build a request-scoped :class:`CompanySectorRepository`."""
    return CompanySectorRepository(db)


def get_company_sector_service(
    db: AsyncSession = Depends(get_db_session),
    cache_manager: CacheManager = Depends(get_cache_manager),
) -> CompanySectorService:
    """Build a request-scoped :class:`CompanySectorService`."""
    return CompanySectorService(CompanySectorRepository(db), cache_manager)
