"""
FastAPI Dependencies for Identity Linking (Prompt 2).
"""

from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.database.session import get_db_session
from app.erp_memberships.repository import ErpMembershipRepository
from app.erp_registry.repository import ErpInstanceRepository
from app.global_audit.dependencies import get_global_audit_service
from app.global_audit.service import GlobalAuditService
from app.global_users.repository import GlobalUserRepository
from app.identity_linking.adapters.registry import ErpAdapterRegistry, get_adapter_registry
from app.identity_linking.repository import IdentityConflictRepository
from app.identity_linking.service import IdentityLinkingService


def get_identity_linking_service(
    db: AsyncSession = Depends(get_db_session),
    audit_service: GlobalAuditService | None = Depends(get_global_audit_service),
) -> IdentityLinkingService:
    """Build a request-scoped IdentityLinkingService instance."""
    if audit_service is None or not isinstance(audit_service, GlobalAuditService):
        from app.global_audit.repository import GlobalAuditRepository
        audit_service = GlobalAuditService(GlobalAuditRepository(db))

    return IdentityLinkingService(
        db=db,
        global_user_repository=GlobalUserRepository(db),
        membership_repository=ErpMembershipRepository(db),
        erp_instance_repository=ErpInstanceRepository(db),
        conflict_repository=IdentityConflictRepository(db),
        audit_service=audit_service,
        adapter_registry=get_adapter_registry(),
    )
