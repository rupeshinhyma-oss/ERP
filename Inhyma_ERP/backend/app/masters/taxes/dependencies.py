"""Tax Dependencies. FastAPI DI wiring for the taxes module."""

from __future__ import annotations

from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.cache.dependency import get_cache_manager
from app.cache.manager import CacheManager
from app.database.session import get_db_session
from app.masters.taxes.repository import TaxRepository
from app.masters.taxes.service import TaxService


def get_tax_repository(db: AsyncSession = Depends(get_db_session)) -> TaxRepository:
    """Build a request-scoped :class:`TaxRepository`."""
    return TaxRepository(db)


def get_tax_service(
    db: AsyncSession = Depends(get_db_session),
    cache_manager: CacheManager = Depends(get_cache_manager),
) -> TaxService:
    """Build a request-scoped :class:`TaxService`."""
    return TaxService(TaxRepository(db), cache_manager)
