"""FastAPI dependencies for the Payment Terms master module."""

from __future__ import annotations

from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.cache.dependency import get_cache_manager
from app.cache.manager import CacheManager
from app.database.session import get_db_session
from app.masters.payment_terms.repository import PaymentTermRepository
from app.masters.payment_terms.service import PaymentTermService


async def get_payment_term_service(
    session: AsyncSession = Depends(get_db_session),
    cache_manager: CacheManager = Depends(get_cache_manager),
) -> PaymentTermService:
    """Yield a PaymentTermService instance scoped to the current database session."""
    repository = PaymentTermRepository(session)
    return PaymentTermService(repository, cache_manager)
