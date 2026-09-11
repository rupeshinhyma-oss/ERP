"""
Global Auth Dependencies.

FastAPI DI wiring: building a `GlobalAuthService` per request, and
`require_global_user`, the dependency any route needing an authenticated
Global User depends on (e.g. `/auth/me`, session management, and the
federation authorization endpoint's "who is asking").
"""

from __future__ import annotations

import uuid

from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import UnauthorizedException
from app.database.session import get_db_session
from app.global_audit.dependencies import get_global_audit_service
from app.global_audit.service import GlobalAuditService
from app.global_auth.repository import GlobalSessionRepository, GlobalUserCredentialRepository
from app.global_auth.security import InvalidGlobalTokenError, decode_global_access_token
from app.global_auth.service import GlobalAuthService
from app.global_users.models import GlobalUser
from app.global_users.repository import GlobalUserRepository

_bearer_scheme = HTTPBearer(auto_error=True, description="Global User session access token issued by POST /auth/login")


def get_global_auth_service(
    db: AsyncSession = Depends(get_db_session),
    audit: GlobalAuditService = Depends(get_global_audit_service),
) -> GlobalAuthService:
    """Build a request-scoped `GlobalAuthService`."""
    return GlobalAuthService(
        user_repository=GlobalUserRepository(db),
        credential_repository=GlobalUserCredentialRepository(db),
        session_repository=GlobalSessionRepository(db),
        audit=audit,
    )


def get_client_ip(request: Request) -> str | None:
    """Best-effort client IP extraction, honoring a trusted reverse proxy's `X-Forwarded-For`."""
    forwarded_for = request.headers.get("x-forwarded-for")
    if forwarded_for:
        return forwarded_for.split(",")[0].strip()
    if request.client:
        return request.client.host
    return None


async def require_global_user(
    credentials: HTTPAuthorizationCredentials = Depends(_bearer_scheme),
    db: AsyncSession = Depends(get_db_session),
    service: GlobalAuthService = Depends(get_global_auth_service),
) -> tuple[GlobalUser, uuid.UUID]:
    """
    Resolve the authenticated `GlobalUser` (and their session id) from the `Authorization: Bearer` header.

    Checks BOTH the JWT's own validity (signature/issuer/expiry/type) AND
    the referenced `GlobalSession` row's live revocation state (Step 12) --
    a still-unexpired JWT for an already-revoked session is rejected.
    """
    try:
        payload = decode_global_access_token(credentials.credentials)
    except InvalidGlobalTokenError as exc:
        raise UnauthorizedException("Invalid or expired session token.") from exc

    try:
        global_user_id = uuid.UUID(payload["sub"])
        session_id = uuid.UUID(payload["jti"])
    except (KeyError, ValueError) as exc:
        raise UnauthorizedException("Invalid session token.") from exc

    await service.resolve_session(session_id)  # raises UnauthorizedException if revoked/expired

    user = await GlobalUserRepository(db).get_by_id(global_user_id)
    if user is None:
        raise UnauthorizedException("This Global User account no longer exists.")
    return user, session_id
