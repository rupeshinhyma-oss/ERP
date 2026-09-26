"""Global User Dependencies -- FastAPI DI wiring."""

from __future__ import annotations

from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.database.session import get_db_session
from app.erp_memberships.dependencies import get_erp_membership_service
from app.erp_memberships.repository import ErpMembershipRepository
from app.erp_memberships.service import ErpMembershipService
from app.global_audit.dependencies import get_global_audit_service
from app.global_audit.service import GlobalAuditService
from app.global_users.repository import GlobalUserRepository
from app.global_users.service import GlobalUserService


def get_global_user_service(
    db: AsyncSession = Depends(get_db_session),
    audit: GlobalAuditService = Depends(get_global_audit_service),
    membership_service: ErpMembershipService = Depends(get_erp_membership_service),
) -> GlobalUserService:
    """Build a request-scoped `GlobalUserService`, wired to sync ErpMembership/local access on status change."""
    return GlobalUserService(
        repository=GlobalUserRepository(db),
        audit=audit,
        membership_repository=ErpMembershipRepository(db),
        membership_service=membership_service,
    )