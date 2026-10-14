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


def admin_token_was_signed_out(admin, payload: dict) -> bool:
    """True if the admin signed out (anywhere) at or after this token was issued."""
    cutoff = getattr(admin, "tokens_revoked_before", None)
    if cutoff is None:
        return False
    if cutoff.tzinfo is None:
        from datetime import timezone
        cutoff = cutoff.replace(tzinfo=timezone.utc)
    try:
        issued_at = int(payload.get("iat"))
    except (TypeError, ValueError):
        return True  # a token with no issue time cannot be proven newer than the sign-out
    return issued_at <= int(cutoff.timestamp())


async def admin_session_is_live(db: AsyncSession, admin, payload: dict) -> bool:
    """
    Is this admin token still allowed?

    * Token with a `sid`: it is valid only while THAT session is live (not revoked, not expired).  Another login of
      the same admin has a different `sid` and is completely unaffected.
    * Older token without a `sid`: fall back to the account-wide sign-out marker (`tokens_revoked_before`).
    """
    sid = payload.get("sid")
    if sid:
        from app.global_auth.session_ops import session_is_live

        return await session_is_live(db, sid)
    return not admin_token_was_signed_out(admin, payload)


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
    if not await admin_session_is_live(db, admin, payload):
        raise UnauthorizedException("This session was signed out. Please sign in again.")
    return admin


async def require_super_admin(admin: PlatformAdmin = Depends(require_platform_admin)) -> PlatformAdmin:
    """Additionally require the SUPER_ADMIN role (e.g. for creating other admins, service credentials)."""
    if admin.role != PlatformAdminRole.SUPER_ADMIN:
        raise ForbiddenException("This action requires the SUPER_ADMIN role.")
    return admin