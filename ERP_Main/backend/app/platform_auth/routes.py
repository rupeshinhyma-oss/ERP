"""
Platform Auth Routes.

Mounted at `/global/auth`, separate from `/global/erps` (Phase 2) --
purely a namespacing choice so authentication concerns don't live under
the registry's own path prefix.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request, status

from app.core.responses import build_success_response
from app.platform_auth.dependencies import (
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
    _admin, token, expires_at = await service.login(email=payload.email, password=payload.password)
    response = PlatformLoginResponse(access_token=token, expires_at=expires_at)
    return build_success_response(response.model_dump(mode="json"), request_id=_request_id(request))


@router.get("/me", summary="Fetch the currently authenticated platform admin")
async def get_me(request: Request, admin: PlatformAdmin = Depends(require_platform_admin)) -> dict:
    """Return the authenticated platform admin's own profile."""
    return build_success_response(
        PlatformAdminRead.model_validate(admin).model_dump(mode="json"), request_id=_request_id(request)
    )


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
