"""Additional Charges Dependencies. FastAPI DI wiring for the additional charges module."""

from __future__ import annotations

from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.cache.dependency import get_cache_manager
from app.cache.manager import CacheManager
from app.database.session import get_db_session
from app.masters.additional_charges.repository import AdditionalChargeRepository
from app.masters.additional_charges.service import AdditionalChargeService


def get_additional_charge_repository(db: AsyncSession = Depends(get_db_session)) -> AdditionalChargeRepository:
    """Build a request-scoped :class:`AdditionalChargeRepository`."""
    return AdditionalChargeRepository(db)


def get_additional_charge_service(
    db: AsyncSession = Depends(get_db_session),
    cache_manager: CacheManager = Depends(get_cache_manager),
) -> AdditionalChargeService:
    """Build a request-scoped :class:`AdditionalChargeService`."""
    return AdditionalChargeService(AdditionalChargeRepository(db), cache_manager)
