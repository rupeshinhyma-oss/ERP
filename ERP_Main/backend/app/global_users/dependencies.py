"""Global User Dependencies -- FastAPI DI wiring."""

from __future__ import annotations

from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.database.session import get_db_session
from app.global_audit.dependencies import get_global_audit_service
from app.global_audit.service import GlobalAuditService
from app.global_users.repository import GlobalUserRepository
from app.global_users.service import GlobalUserService


def get_global_user_service(
    db: AsyncSession = Depends(get_db_session),
    audit: GlobalAuditService = Depends(get_global_audit_service),
) -> GlobalUserService:
    """Build a request-scoped `GlobalUserService`."""
    return GlobalUserService(repository=GlobalUserRepository(db), audit=audit)
