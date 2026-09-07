"""
ERP Service Identity Dependencies.

FastAPI DI wiring for service-credential issuance/management (human-admin
gated) and for `require_erp_service`, the dependency the heartbeat route
(and any future internal service-to-service route) uses to authenticate
an ERP's backend as a machine caller.
"""

from __future__ import annotations

from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.database.session import get_db_session
from app.erp_registry.repository import ErpInstanceRepository
from app.global_audit.dependencies import get_global_audit_service
from app.global_audit.service import GlobalAuditService
from app.service_identity.models import ErpServiceCredential
from app.service_identity.repository import ErpServiceCredentialRepository
from app.service_identity.service import ErpServiceIdentityService

_service_bearer_scheme = HTTPBearer(
    auto_error=True, description="ERP service credential ('<identifier>.<secret>'), never a human session token."
)


def get_service_identity_service(
    db: AsyncSession = Depends(get_db_session),
    audit: GlobalAuditService = Depends(get_global_audit_service),
) -> ErpServiceIdentityService:
    """Build a request-scoped `ErpServiceIdentityService`."""
    return ErpServiceIdentityService(
        credential_repository=ErpServiceCredentialRepository(db),
        instance_repository=ErpInstanceRepository(db),
        audit=audit,
    )


async def require_erp_service(
    credentials: HTTPAuthorizationCredentials = Depends(_service_bearer_scheme),
    service: ErpServiceIdentityService = Depends(get_service_identity_service),
) -> ErpServiceCredential:
    """
    Authenticate the caller as a specific ERP's backend via its service credential.

    This is the ONLY way anything in this codebase establishes "which ERP
    is this request from" for a machine caller (Step 26) -- never a UUID
    or key taken from the request body/path at face value.
    """
    return await service.verify_bearer_credential(credentials.credentials)
