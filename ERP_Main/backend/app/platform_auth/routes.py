"""
Platform Auth Routes.

Mounted at `/global/auth`, separate from `/global/erps` (Phase 2) --
purely a namespacing choice so authentication concerns don't live under
the registry's own path prefix.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request, status
from fastapi.security import HTTPAuthorizationCredentials
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.responses import build_success_response
from app.database.session import get_db_session
from app.platform_auth.dependencies import (
    _bearer_scheme,
    get_platform_auth_service,
    require_platform_admin,
    require_super_admin,
)
from app.platform_auth.models import PlatformAdmin
from app.platform_auth.schemas import (
    PlatformAdminCreate,
    PlatformAdminRead,
    PlatformLoginRequest,
    PlatformLoginResponse,
)
from app.platform_auth.security import decode_platform_access_token
from app.platform_auth.service import PlatformAuthService

router = APIRouter(prefix="/global/auth", tags=["Platform Admin Auth"])


def _request_id(request: Request) -> str:
    """Return the request's correlation ID set by `RequestIdMiddleware`."""
    return getattr(request.state, "request_id", "")


@router.post("/login", summary="Platform admin login")
async def login(
    request: Request,
    payload: PlatformLoginRequest,
    service: PlatformAuthService = Depends(get_platform_auth_service),
) -> dict:
    """Authenticate a platform admin and issue a short-lived control-plane session token."""
    _admin, token, expires_at, session_id = await service.login_with_session(
        email=payload.email,
        password=payload.password,
        ip=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    response = PlatformLoginResponse(access_token=token, expires_at=expires_at, session_id=session_id)
    return build_success_response(response.model_dump(mode="json"), request_id=_request_id(request))


@router.post("/logout", summary="Platform admin sign-out: ends THIS login (this session) everywhere it was used")
async def logout(
    request: Request,
    admin: PlatformAdmin = Depends(require_platform_admin),
    credentials: HTTPAuthorizationCredentials = Depends(_bearer_scheme),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    """
    Revoke the session this token belongs to.  The same admin logged in elsewhere (another browser, another
    device) keeps working: use `sign-out-everywhere` for that.  A token from before sessions existed has no
    session id and cannot be revoked individually; the client simply discards it.
    """
    from app.global_auth.ecosystem_session import sign_out_session

    sid = decode_platform_access_token(credentials.credentials).get("sid")
    if not sid:
        return build_success_response({"status": "logged_out", "mode": "legacy_token"}, request_id=_request_id(request))
    summary = await sign_out_session(db, str(sid))
    return build_success_response({"status": "logged_out", "mode": "session", **summary}, request_id=_request_id(request))


@router.post("/sign-out-everywhere", summary="Platform admin: end EVERY login of this admin account, on every device")
async def sign_out_everywhere_route(
    request: Request,
    admin: PlatformAdmin = Depends(require_platform_admin),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    """Explicit security action (lost laptop, shared account): all sessions of this admin everywhere."""
    from app.global_auth.ecosystem_session import sign_out_everywhere

    summary = await sign_out_everywhere(db, admin.email)
    return build_success_response({"status": "signed_out_everywhere", **summary}, request_id=_request_id(request))


@router.get("/me", summary="Fetch the currently authenticated platform admin")
async def get_me(request: Request, admin: PlatformAdmin = Depends(require_platform_admin)) -> dict:
    """Return the authenticated platform admin's own profile."""
    data = PlatformAdminRead.model_validate(admin).model_dump(mode="json")
    role_str = getattr(admin.role, "value", str(admin.role))
    if role_str == "SUPER_ADMIN":
        data["permissions"] = ["*"]
    elif role_str == "PLATFORM_ADMIN":
        data["permissions"] = [
            "platform.audit.view",
            "platform.user.read",
            "platform.user.create",
            "platform.user.update",
            "platform.user.disable",
        ]
    elif role_str == "OPERATOR":
        data["permissions"] = [
            "platform.audit.view",
            "platform.user.read",
            "platform.user.create",
            "platform.user.update",
        ]
    elif role_str == "AUDITOR":
        data["permissions"] = ["platform.audit.view", "platform.user.read"]
    return build_success_response(data, request_id=_request_id(request))


@router.post("/admins", status_code=status.HTTP_201_CREATED, summary="Create a new platform admin (SUPER_ADMIN only)")
async def create_admin(
    request: Request,
    payload: PlatformAdminCreate,
    caller: PlatformAdmin = Depends(require_super_admin),
    service: PlatformAuthService = Depends(get_platform_auth_service),
) -> dict:
    """Create a new platform admin account. Requires an authenticated SUPER_ADMIN caller."""
    created = await service.create_admin(payload, created_by=caller)
    return build_success_response(
        PlatformAdminRead.model_validate(created).model_dump(mode="json"),
        request_id=_request_id(request),
        message="Platform admin created.",
    )