"""Company Categories Dependencies. FastAPI DI wiring for the company categories module."""

from __future__ import annotations

from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.cache.dependency import get_cache_manager
from app.cache.manager import CacheManager
from app.database.session import get_db_session
from app.masters.company_categories.repository import CompanyCategoryRepository
from app.masters.company_categories.service import CompanyCategoryService


def get_company_category_repository(db: AsyncSession = Depends(get_db_session)) -> CompanyCategoryRepository:
    """Build a request-scoped :class:`CompanyCategoryRepository`."""
    return CompanyCategoryRepository(db)


def get_company_category_service(
    db: AsyncSession = Depends(get_db_session),
    cache_manager: CacheManager = Depends(get_cache_manager),
) -> CompanyCategoryService:
    """Build a request-scoped :class:`CompanyCategoryService`."""
    return CompanyCategoryService(CompanyCategoryRepository(db), cache_manager)
