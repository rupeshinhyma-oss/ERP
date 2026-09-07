"""Global Audit Dependencies -- FastAPI DI wiring."""

from __future__ import annotations

from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.database.session import get_db_session
from app.global_audit.repository import GlobalAuditRepository
from app.global_audit.service import GlobalAuditService


def get_global_audit_service(db: AsyncSession = Depends(get_db_session)) -> GlobalAuditService:
    """Build a request-scoped `GlobalAuditService`."""
    return GlobalAuditService(repository=GlobalAuditRepository(db))
