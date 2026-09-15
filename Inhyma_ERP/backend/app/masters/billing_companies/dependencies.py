"""FastAPI dependency injection for the Billing Company master module."""

from __future__ import annotations

from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.cache.dependency import get_cache_manager
from app.cache.manager import CacheManager
from app.database.session import get_db_session
from app.masters.billing_companies.repository import BillingCompanyRepository
from app.masters.billing_companies.service import BillingCompanyService


async def get_billing_company_service(
    session: AsyncSession = Depends(get_db_session),
    cache_manager: CacheManager = Depends(get_cache_manager),
) -> BillingCompanyService:
    """Return a :class:`BillingCompanyService` wired to the current DB session and cache."""
    repository = BillingCompanyRepository(session)
    return BillingCompanyService(repository, cache_manager)
