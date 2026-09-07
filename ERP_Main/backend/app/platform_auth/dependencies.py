"""
Platform Auth Dependencies.

FastAPI DI wiring: how to build a `PlatformAuthService` per request, how
to resolve the authenticated `PlatformAdmin` from the `Authorization`
header, and role-gated variants for routes that require SUPER_ADMIN.

`require_platform_admin` is the single dependency every mutating registry/
global-user/membership/credential route in this codebase depends on
(Phase 3 Step 19/21) -- Phase 2 left these endpoints open; this closes
that gap without introducing a full RBAC system (Step 20).
"""

from __future__ import annotations

import uuid

from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import ForbiddenException, UnauthorizedException
from app.database.session import get_db_session
from app.global_audit.dependencies import get_global_audit_service
from app.global_audit.service import GlobalAuditService
from app.platform_auth.models import PlatformAdmin, PlatformAdminRole
from app.platform_auth.repository import PlatformAdminRepository
from app.platform_auth.security import InvalidPlatformTokenError, decode_platform_access_token
from app.platform_auth.service import PlatformAuthService

_bearer_scheme = HTTPBearer(auto_error=True, description="Platform-admin session token issued by POST /auth/login")


def get_platform_auth_service(
    db: AsyncSession = Depends(get_db_session),
    audit: GlobalAuditService = Depends(get_global_audit_service),
) -> PlatformAuthService:
    """Build a request-scoped `PlatformAuthService`."""
    return PlatformAuthService(repository=PlatformAdminRepository(db), audit=audit)


async def require_platform_admin(
    credentials: HTTPAuthorizationCredentials = Depends(_bearer_scheme),
    db: AsyncSession = Depends(get_db_session),
) -> PlatformAdmin:
    """
    Resolve the authenticated `PlatformAdmin` from the `Authorization: Bearer` header.

    Any authenticated, active platform admin (either role) satisfies this
    dependency -- it is the floor, not a role check. Use
    `require_super_admin` for routes that need more than that.
    """
    try:
        payload = decode_platform_access_token(credentials.credentials)
    except InvalidPlatformTokenError as exc:
        raise UnauthorizedException("Invalid or expired session token.") from exc

    try:
        admin_id = uuid.UUID(payload["sub"])
    except (KeyError, ValueError) as exc:
        raise UnauthorizedException("Invalid session token subject.") from exc

    admin = await PlatformAdminRepository(db).get_by_id(admin_id)
    if admin is None or not admin.is_active:
        raise UnauthorizedException("This platform admin account no longer exists or is inactive.")
    return admin


async def require_super_admin(admin: PlatformAdmin = Depends(require_platform_admin)) -> PlatformAdmin:
    """Additionally require the SUPER_ADMIN role (e.g. for creating other admins, service credentials)."""
    if admin.role != PlatformAdminRole.SUPER_ADMIN:
        raise ForbiddenException("This action requires the SUPER_ADMIN role.")
    return admin
