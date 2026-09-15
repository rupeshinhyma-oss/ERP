"""Agent Types Dependencies. FastAPI DI wiring for the agent types module."""

from __future__ import annotations

from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.cache.dependency import get_cache_manager
from app.cache.manager import CacheManager
from app.database.session import get_db_session
from app.masters.agent_types.repository import AgentTypeRepository
from app.masters.agent_types.service import AgentTypeService


def get_agent_type_repository(db: AsyncSession = Depends(get_db_session)) -> AgentTypeRepository:
    """Build a request-scoped :class:`AgentTypeRepository`."""
    return AgentTypeRepository(db)


def get_agent_type_service(
    db: AsyncSession = Depends(get_db_session),
    cache_manager: CacheManager = Depends(get_cache_manager),
) -> AgentTypeService:
    """Build a request-scoped :class:`AgentTypeService`."""
    return AgentTypeService(AgentTypeRepository(db), cache_manager)
