"""Federation Dependencies -- FastAPI DI wiring."""

from __future__ import annotations

from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.database.session import get_db_session
from app.erp_memberships.repository import ErpMembershipRepository
from app.erp_registry.repository import ErpInstanceRepository
from app.federation.key_manager import SigningKeyManager
from app.federation.repository import (
    AuthorizationRequestRepository,
    FederationClientRepository,
    SigningKeyRepository,
)
from app.federation.service import FederationService
from app.global_audit.dependencies import get_global_audit_service
from app.global_audit.service import GlobalAuditService


def get_signing_key_manager(
    db: AsyncSession = Depends(get_db_session),
    audit: GlobalAuditService = Depends(get_global_audit_service),
) -> SigningKeyManager:
    """Build a request-scoped `SigningKeyManager`."""
    return SigningKeyManager(repository=SigningKeyRepository(db), audit=audit)


def get_federation_service(
    db: AsyncSession = Depends(get_db_session),
    audit: GlobalAuditService = Depends(get_global_audit_service),
    key_manager: SigningKeyManager = Depends(get_signing_key_manager),
) -> FederationService:
    """Build a request-scoped `FederationService`."""
    return FederationService(
        client_repository=FederationClientRepository(db),
        erp_instance_repository=ErpInstanceRepository(db),
        membership_repository=ErpMembershipRepository(db),
        authorization_repository=AuthorizationRequestRepository(db),
        key_manager=key_manager,
        audit=audit,
    )
