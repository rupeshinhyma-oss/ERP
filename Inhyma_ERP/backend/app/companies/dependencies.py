"""Company Dependencies. FastAPI DI wiring for the companies module."""

from __future__ import annotations

from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.cache.dependency import get_cache_manager
from app.cache.manager import CacheManager
from app.database.session import get_db_session
from app.masters.cities.repository import CityRepository
from app.masters.countries.repository import CountryRepository
from app.masters.product_categories.repository import ProductCategoryRepository
from app.masters.product_sub_categories.repository import ProductSubCategoryRepository
from app.masters.products.repository import ProductRepository
from app.masters.states.repository import StateRepository
from app.companies.repository import CompanyContactRepository, CompanyRepository
from app.companies.service import CompanyService


def get_company_service(
    db: AsyncSession = Depends(get_db_session),
    cache_manager: CacheManager = Depends(get_cache_manager),
) -> CompanyService:
    """Build a request-scoped :class:`CompanyService`, wired to every master it references."""
    return CompanyService(
        CompanyRepository(db),
        CompanyContactRepository(db),
        CountryRepository(db),
        StateRepository(db),
        CityRepository(db),
        ProductCategoryRepository(db),
        ProductSubCategoryRepository(db),
        cache_manager,
        product_repository=ProductRepository(db),
    )
