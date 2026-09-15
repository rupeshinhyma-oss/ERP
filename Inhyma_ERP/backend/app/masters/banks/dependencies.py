"""FastAPI dependencies for the Bank master module."""

from __future__ import annotations

from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.cache.dependency import get_cache_manager
from app.cache.manager import CacheManager
from app.database.session import get_db_session
from app.masters.banks.repository import BankRepository
from app.masters.banks.service import BankService


async def get_bank_service(
    session: AsyncSession = Depends(get_db_session),
    cache_manager: CacheManager = Depends(get_cache_manager),
) -> BankService:
    """Yield a BankService instance scoped to the current database session."""
    repository = BankRepository(session)
    return BankService(repository, cache_manager)
