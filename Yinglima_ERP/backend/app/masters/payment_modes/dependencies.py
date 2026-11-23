"""PaymentMode Dependencies."""

from __future__ import annotations

from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.cache.dependency import get_cache_manager
from app.cache.manager import CacheManager
from app.database.session import get_db_session
from app.masters.payment_modes.repository import PaymentModeRepository
from app.masters.payment_modes.service import PaymentModeService


def get_payment_mode_service(
    db: AsyncSession = Depends(get_db_session),
    cache_manager: CacheManager = Depends(get_cache_manager),
) -> PaymentModeService:
    return PaymentModeService(PaymentModeRepository(db), cache_manager)
