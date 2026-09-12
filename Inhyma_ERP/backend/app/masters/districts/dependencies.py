"""District Dependencies. FastAPI DI wiring for the districts module."""

from __future__ import annotations

from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.cache.dependency import get_cache_manager
from app.cache.manager import CacheManager
from app.database.session import get_db_session
from app.masters.countries.repository import CountryRepository
from app.masters.districts.repository import DistrictRepository
from app.masters.districts.service import DistrictService
from app.masters.states.repository import StateRepository


def get_district_repository(db: AsyncSession = Depends(get_db_session)) -> DistrictRepository:
    """Build a request-scoped :class:`DistrictRepository`."""
    return DistrictRepository(db)


def get_district_service(
    db: AsyncSession = Depends(get_db_session),
    cache_manager: CacheManager = Depends(get_cache_manager),
) -> DistrictService:
    """Build a request-scoped :class:`DistrictService`."""
    return DistrictService(
        DistrictRepository(db), StateRepository(db), CountryRepository(db), cache_manager
    )
