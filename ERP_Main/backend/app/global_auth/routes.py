"""
Global Auth Routes.

Mounted at `/global/user-auth` (distinct from `/global/auth` which is
Phase 3's platform-admin auth) -- two entirely separate login surfaces
for two entirely separate principals, never sharing a path prefix so
neither can be confused for the other in routing/logs.
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Request, status

from app.core.exceptions import ForbiddenException
from app.core.responses import build_success_response
from app.global_auth.dependencies import get_client_ip, get_global_auth_service, require_global_user
from app.global_auth.schemas import (
    GlobalChangePasswordRequest,
    GlobalLoginRequest,
    GlobalLoginResponse,
    GlobalPasswordResetConfirmPayload,
    GlobalPasswordResetRequestPayload,
    GlobalRegisterRequest,
    GlobalSessionRead,
    GlobalUserProfile,
)
from app.global_auth.service import GlobalAuthService
from app.global_users.models import GlobalUser

router = APIRouter(prefix="/global/user-auth", tags=["Global User Authentication"])


def _request_id(request: Request) -> str:
    """Return the request's correlation ID set by `RequestIdMiddleware`."""
    return getattr(request.state, "request_id", "")


def _require_feature_enabled() -> None:
    """Reject every route in this router if GLOBAL_AUTH_ENABLED is off (Phase 4 Step 67)."""
    from app.core.config import settings

    if not settings.GLOBAL_AUTH_ENABLED:
        raise ForbiddenException("Global authentication is currently disabled.")


@router.post("/register", status_code=status.HTTP_201_CREATED, summary="Self-register a new Global User")
async def register(
    request: Request,
    payload: GlobalRegisterRequest,
    service: GlobalAuthService = Depends(get_global_auth_service),
) -> dict:
    """Create a new Global User with a global password credential."""
    _require_feature_enabled()
    user = await service.register(payload)
    return build_success_response(
        GlobalUserProfile.model_validate(user).model_dump(mode="json"),
        request_id=_request_id(request),
        message="Global User registered.",
    )


@router.post("/login", summary="Global User login")
async def login(
    request: Request,
    payload: GlobalLoginRequest,
    service: GlobalAuthService = Depends(get_global_auth_service),
) -> dict:
    """Authenticate a Global User and issue a short-lived, revocable session access token."""
    _require_feature_enabled()
    _user, token, expires_at, session_id = await service.login(
        payload, ip_address=get_client_ip(request), user_agent=request.headers.get("user-agent")
    )
    response = GlobalLoginResponse(access_token=token, expires_at=expires_at, session_id=session_id)
    return build_success_response(response.model_dump(mode="json"), request_id=_request_id(request))


@router.get("/me", summary="Fetch the currently authenticated Global User")
async def get_me(
    request: Request, user_and_session: tuple[GlobalUser, uuid.UUID] = Depends(require_global_user)
) -> dict:
    """Return the authenticated Global User's own profile."""
    user, _session_id = user_and_session
    return build_success_response(
        GlobalUserProfile.model_validate(user).model_dump(mode="json"), request_id=_request_id(request)
    )


@router.post("/logout", summary="Global logout (revokes the current session)")
async def logout(
    request: Request,
    user_and_session: tuple[GlobalUser, uuid.UUID] = Depends(require_global_user),
    service: GlobalAuthService = Depends(get_global_auth_service),
) -> dict:
    """
    Revoke the current global session.

    Distinct from any ERP's own local logout (Step 29) -- this never
    reaches into, and has no way to reach into, Yinglima's or Inhyma's
    own session state.
    """
    user, session_id = user_and_session
    await service.logout(session_id, global_user_id=user.id)
    return build_success_response({"status": "logged_out"}, request_id=_request_id(request))


@router.get("/sessions", summary="List the authenticated Global User's own sessions")
async def list_sessions(
    request: Request,
    user_and_session: tuple[GlobalUser, uuid.UUID] = Depends(require_global_user),
    service: GlobalAuthService = Depends(get_global_auth_service),
) -> dict:
    """List every session (active or not) belonging to the authenticated Global User."""
    user, _session_id = user_and_session
    sessions = await service.list_sessions(user.id)
    data = [GlobalSessionRead.model_validate(s).model_dump(mode="json") for s in sessions]
    return build_success_response(data, request_id=_request_id(request))


@router.post("/sessions/{session_id}/revoke", summary="Revoke a specific session")
async def revoke_session(
    request: Request,
    session_id: uuid.UUID,
    user_and_session: tuple[GlobalUser, uuid.UUID] = Depends(require_global_user),
    service: GlobalAuthService = Depends(get_global_auth_service),
) -> dict:
    """Revoke one of the authenticated Global User's own sessions (e.g. 'log out of that device')."""
    user, _current_session_id = user_and_session
    session = await service.revoke_session(session_id, global_user_id=user.id)
    return build_success_response(
        GlobalSessionRead.model_validate(session).model_dump(mode="json"), request_id=_request_id(request)
    )


@router.post("/change-password", summary="Change the authenticated Global User's own password")
async def change_password(
    request: Request,
    payload: GlobalChangePasswordRequest,
    user_and_session: tuple[GlobalUser, uuid.UUID] = Depends(require_global_user),
    service: GlobalAuthService = Depends(get_global_auth_service),
) -> dict:
    """Change the authenticated Global User's password, verifying the current one first."""
    user, _session_id = user_and_session
    await service.change_password(user.id, current_password=payload.current_password, new_password=payload.new_password)
    return build_success_response({"status": "password_changed"}, request_id=_request_id(request))


@router.post("/password-reset/request", summary="Request a password reset")
async def request_password_reset(
    request: Request,
    payload: GlobalPasswordResetRequestPayload,
    service: GlobalAuthService = Depends(get_global_auth_service),
) -> dict:
    """
    Request a password reset token.

    Always returns the same generic response whether or not the email is
    registered, to prevent email enumeration (Phase 4 Step 43).
    """
    await service.request_password_reset(payload.email, ip_address=get_client_ip(request))
    return build_success_response(
        {"status": "if_registered_reset_instructions_sent"}, request_id=_request_id(request)
    )


@router.post("/password-reset/confirm", summary="Complete a password reset")
async def confirm_password_reset(
    request: Request,
    payload: GlobalPasswordResetConfirmPayload,
    service: GlobalAuthService = Depends(get_global_auth_service),
) -> dict:
    """Complete a password reset using a single-use token from `/password-reset/request`."""
    await service.confirm_password_reset(raw_token=payload.token, new_password=payload.new_password)
    return build_success_response({"status": "password_reset"}, request_id=_request_id(request))
