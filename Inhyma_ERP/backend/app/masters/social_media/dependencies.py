"""Social Media Dependencies. FastAPI DI wiring for the social media module."""

from __future__ import annotations

from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.cache.dependency import get_cache_manager
from app.cache.manager import CacheManager
from app.database.session import get_db_session
from app.masters.social_media.repository import SocialMediaRepository
from app.masters.social_media.service import SocialMediaService


def get_social_media_repository(db: AsyncSession = Depends(get_db_session)) -> SocialMediaRepository:
    """Build a request-scoped :class:`SocialMediaRepository`."""
    return SocialMediaRepository(db)


def get_social_media_service(
    db: AsyncSession = Depends(get_db_session),
    cache_manager: CacheManager = Depends(get_cache_manager),
) -> SocialMediaService:
    """Build a request-scoped :class:`SocialMediaService`."""
    return SocialMediaService(SocialMediaRepository(db), cache_manager)
