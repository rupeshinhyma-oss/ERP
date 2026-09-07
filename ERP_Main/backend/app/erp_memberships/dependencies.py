"""ERP Membership Dependencies -- FastAPI DI wiring."""

from __future__ import annotations

from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.database.session import get_db_session
from app.erp_memberships.repository import ErpMembershipRepository
from app.erp_memberships.service import ErpMembershipService
from app.erp_registry.repository import ErpInstanceRepository
from app.global_audit.dependencies import get_global_audit_service
from app.global_audit.service import GlobalAuditService
from app.global_users.repository import GlobalUserRepository


def get_erp_membership_service(
    db: AsyncSession = Depends(get_db_session),
    audit: GlobalAuditService = Depends(get_global_audit_service),
) -> ErpMembershipService:
    """Build a request-scoped `ErpMembershipService`."""
    return ErpMembershipService(
        membership_repository=ErpMembershipRepository(db),
        global_user_repository=GlobalUserRepository(db),
        erp_instance_repository=ErpInstanceRepository(db),
        audit=audit,
    )
