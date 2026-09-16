"""FastAPI dependencies for the Adjustment Purposes master module."""

from __future__ import annotations

from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.cache.dependency import get_cache_manager
from app.cache.manager import CacheManager
from app.database.session import get_db_session
from app.masters.adjustment_purposes.repository import AdjustmentPurposeRepository
from app.masters.adjustment_purposes.service import AdjustmentPurposeService


async def get_adjustment_purpose_service(
    session: AsyncSession = Depends(get_db_session),
    cache_manager: CacheManager = Depends(get_cache_manager),
) -> AdjustmentPurposeService:
    """Yield an AdjustmentPurposeService instance scoped to the current database session."""
    repository = AdjustmentPurposeRepository(session)
    return AdjustmentPurposeService(repository, cache_manager)
