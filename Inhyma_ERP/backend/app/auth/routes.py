from __future__ import annotations

"""
Authentication Routes.

Implements the six public authentication endpoints:

    POST /api/v1/auth/login
    POST /api/v1/auth/logout
    POST /api/v1/auth/refresh
    POST /api/v1/auth/change-password
    POST /api/v1/auth/forgot-password
    GET  /api/v1/auth/profile

Routes are intentionally thin: they parse input, delegate to
``AuthService``, and shape the standard response envelope.
"""

import uuid
from pydantic import BaseModel, EmailStr
from sqlalchemy import select, func
from app.users.models import User

from fastapi import APIRouter, Depends, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.audit.constants import AuditAction
from app.audit.dependencies import get_audit_service
from app.audit.service import AuditService
from app.auth.dependencies import get_auth_service, get_current_user, get_login_context
from app.auth.schemas import (
    ChangePasswordRequest,
    ForgotPasswordRequest,
    LoginRequest,
    LogoutRequest,
    ProfileResponse,
    RefreshRequest,
    TokenResponse,
)
from app.auth.security import InvalidTokenError, TokenType, decode_token
from app.auth.service import AuthService, CurrentUser, LoginContext
from app.core.config import settings
from app.core.exceptions import UnauthorizedException, ServiceUnavailableException
from app.federation.erp_main_client import (
    EcosystemSessionError,
    EcosystemSessionUnavailable,
    open_central_session,
    push_password_to_erp_main,
    push_session_signout_to_erp_main,
    verify_ecosystem_session,
)
from app.common.rate_limit import enforce_rate_limit, forgot_password_limiter
from app.core.responses import build_success_response
from app.rbac.dependencies import get_rbac_service
from app.rbac.service import RBACService
from app.users.repository import UserRepository
from app.database.session import get_db_session
from sqlalchemy.ext.asyncio import AsyncSession

router = APIRouter(prefix="/auth", tags=["Authentication"])

_bearer_scheme = HTTPBearer(auto_error=True)


def _token_response(
    access_token: str, refresh_token: str, user: ProfileResponse | None = None
) -> TokenResponse:
    """Build the standard token-pair response payload (including which login/session these tokens belong to)."""
    sid: str | None = None
    try:
        sid = decode_token(access_token, expected_type=TokenType.ACCESS).get("sid")
    except Exception:
        sid = None
    return TokenResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        expires_in=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        user=user,
        session_id=str(sid) if sid else None,
        session_mode=("local" if str(sid).startswith("loc-") else "central") if sid else None,
    )


@router.post("/login", summary="Authenticate and receive an access/refresh token pair")
async def login(
    payload: LoginRequest,
    request: Request,
    auth_service: AuthService = Depends(get_auth_service),
    rbac_service: RBACService = Depends(get_rbac_service),
    context: LoginContext = Depends(get_login_context),
    audit_service: AuditService = Depends(get_audit_service),
) -> dict:
    """Verify credentials and issue a new token pair, tracked as a new session."""
    async def _open_central_session(authenticated_user) -> str | None:
        # Only reached AFTER the password was verified here.  ERP_Main decides whether this person may use this ERP and
        # opens the ONE session of this login; None -> a clearly labelled local-only session (never blocks the login).
        info = await open_central_session(authenticated_user.email)
        return str(info["session_id"]) if info else None

    user, access_token, refresh_token = await auth_service.login(
        identifier=payload.identifier,
        password=payload.password,
        context=context,
        session_resolver=_open_central_session,
    )
    roles = await rbac_service.list_roles_for_user(user.id)
    permissions = await auth_service.get_user_effective_permissions(user.id, force_refresh=True)
    profile = ProfileResponse(
        id=user.id,
        first_name=user.first_name,
        last_name=user.last_name,
        employee_code=user.employee_code,
        username=user.username or "",
        email=user.email or "",
        phone=user.phone,
        status=user.status.value,
        is_active=user.is_active,
        must_change_password=user.must_change_password,
        last_login_at=user.last_login_at,
        password_changed_at=user.password_changed_at,
        created_at=user.created_at,
        roles=[role.name for role in roles],
        permissions=sorted(permissions),
    )

    await audit_service.record(
        action=AuditAction.LOGIN,
        module="auth",
        user_id=user.id,
        username_snapshot=user.username,
        entity_type="User",
        entity_id=str(user.id),
        ip_address=context.ip_address,
        user_agent=context.user_agent,
        request_id=request.state.request_id,
        http_method=request.method,
        endpoint=request.url.path,
        response_status=status.HTTP_200_OK,
        description="Successful login.",
    )
    request.state.audit_logged = True
    data = _token_response(access_token, refresh_token, user=profile).model_dump(mode="json")
    return build_success_response(data=data, request_id=request.state.request_id)


@router.post("/refresh", summary="Exchange a refresh token for a new token pair")
async def refresh(
    payload: RefreshRequest,
    request: Request,
    auth_service: AuthService = Depends(get_auth_service),
    context: LoginContext = Depends(get_login_context),
) -> dict:
    """Rotate the given refresh token, revoking it and issuing a brand new pair."""
    access_token, new_refresh_token = await auth_service.refresh(
        refresh_token=payload.refresh_token, context=context
    )
    data = _token_response(access_token, new_refresh_token).model_dump(mode="json")
    return build_success_response(data=data, request_id=request.state.request_id)


@router.post("/logout", summary="End the current session")
async def logout(
    payload: LogoutRequest,
    request: Request,
    credentials: HTTPAuthorizationCredentials = Depends(_bearer_scheme),
    auth_service: AuthService = Depends(get_auth_service),
    audit_service: AuditService = Depends(get_audit_service),
) -> dict:
    """Blacklist the current access token and revoke the session behind the given refresh token."""
    try:
        access_payload = decode_token(credentials.credentials, expected_type=TokenType.ACCESS)
    except InvalidTokenError as exc:
        raise UnauthorizedException("Invalid or expired access token.") from exc

    from datetime import datetime, timezone

    exp = datetime.fromtimestamp(access_payload["exp"], tz=timezone.utc)
    await auth_service.logout(
        access_token_jti=access_payload["jti"], access_token_exp=exp, refresh_token=payload.refresh_token
    )
    # End THIS login everywhere it was used -- not the person's other logins: block its session id here, then tell
    # ERP_Main (server-to-server) so the dashboard and the other ERPs of the same session end too.
    signed_out_sid = access_payload.get("sid")
    if signed_out_sid:
        try:
            await auth_service.revoke_session(str(signed_out_sid), reason="logout")
        except Exception:
            pass
        await push_session_signout_to_erp_main(str(signed_out_sid))
    await audit_service.record(
        action=AuditAction.LOGOUT,
        module="auth",
        user_id=uuid.UUID(access_payload["sub"]),
        entity_type="User",
        entity_id=access_payload["sub"],
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
        request_id=request.state.request_id,
        http_method=request.method,
        endpoint=request.url.path,
        response_status=status.HTTP_200_OK,
        description="User logged out.",
    )
    request.state.audit_logged = True
    return build_success_response(data={"logged_out": True}, request_id=request.state.request_id)


@router.post("/change-password", summary="Change your own password")
async def change_password(
    payload: ChangePasswordRequest,
    request: Request,
    current_user: CurrentUser = Depends(get_current_user),
    auth_service: AuthService = Depends(get_auth_service),
    db: AsyncSession = Depends(get_db_session),
    audit_service: AuditService = Depends(get_audit_service),
) -> dict:
    """Change the authenticated user's password, then revoke all of their sessions."""
    user_repository = UserRepository(db)
    user = await user_repository.get_by_id(current_user.id)
    if user is None:
        raise UnauthorizedException("User account no longer exists.")

    await auth_service.change_password(
        user, current_password=payload.current_password, new_password=payload.new_password
    )
    # One password per person across ERP_Main and every ERP (best effort; never fails the change).
    if user.email:
        await push_password_to_erp_main(user.email, payload.new_password)
    await audit_service.record(
        action=AuditAction.PASSWORD_CHANGE,
        module="auth",
        user_id=current_user.id,
        username_snapshot=current_user.username,
        entity_type="User",
        entity_id=str(current_user.id),
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
        request_id=request.state.request_id,
        http_method=request.method,
        endpoint=request.url.path,
        response_status=status.HTTP_200_OK,
        description="User changed their own password; all sessions revoked.",
    )
    request.state.audit_logged = True
    return build_success_response(
        data={"message": "Password changed successfully. Please log in again."},
        request_id=request.state.request_id,
    )


@router.post("/forgot-password", summary="Request a password reset", status_code=status.HTTP_200_OK)
async def forgot_password(
    payload: ForgotPasswordRequest,
    request: Request,
    auth_service: AuthService = Depends(get_auth_service),
) -> dict:
    """
    Request a password reset.

    Always returns the same generic response, whether or not the identifier
    matches a real account, to avoid leaking which usernames/emails exist.
    Password resets in this system are admin-generated (see
    ``POST /users/{id}/reset-password``); this endpoint only flags the
    account and notifies administrators out-of-band.
    """
    enforce_rate_limit(forgot_password_limiter, request, key_suffix=payload.identifier)
    await auth_service.forgot_password(payload.identifier)
    return build_success_response(
        data={
            "message": (
                "If an account matches that username or email, an administrator has been "
                "notified to reset your password."
            )
        },
        request_id=request.state.request_id,
    )


@router.get("/profile", summary="Get the authenticated user's profile")
async def get_profile(
    request: Request,
    current_user: CurrentUser = Depends(get_current_user),
    rbac_service: RBACService = Depends(get_rbac_service),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    """Return the authenticated user's own profile, including resolved roles and permissions."""
    user_repository = UserRepository(db)
    user = await user_repository.get_by_id(current_user.id)
    if user is None:
        raise UnauthorizedException("User account no longer exists.")

    roles = await rbac_service.list_roles_for_user(user.id)
    profile = ProfileResponse(
        id=user.id,
        first_name=user.first_name,
        last_name=user.last_name,
        employee_code=user.employee_code,
        username=user.username or "",
        email=user.email or "",
        phone=user.phone,
        status=user.status.value,
        is_active=user.is_active,
        must_change_password=user.must_change_password,
        last_login_at=user.last_login_at,
        password_changed_at=user.password_changed_at,
        created_at=user.created_at,
        roles=[role.name for role in roles],
        permissions=sorted(current_user.permissions),
    )
    return build_success_response(data=profile.model_dump(mode="json"), request_id=request.state.request_id)


class SsoHandoverRequest(BaseModel):
    email: EmailStr
    sso_token: str
    target_erp: str | None = None


@router.post("/sso-handover", summary="Authenticate via verified cross-ERP SSO handover")
async def sso_handover_login(
    payload: SsoHandoverRequest,
    request: Request,
    db: AsyncSession = Depends(get_db_session),
    auth_service: AuthService = Depends(get_auth_service),
    rbac_service: RBACService = Depends(get_rbac_service),
    context: LoginContext = Depends(get_login_context),
    audit_service: AuditService = Depends(get_audit_service),
) -> dict:
    """Verify cross-ERP SSO token, enforce ERP access isolation, and establish local session for specific user."""
    import base64
    import json
    import time
    from app.core.exceptions import ForbiddenException

    # 1. Decode token
    try:
        token_json = base64.b64decode(payload.sso_token).decode("utf-8")
        token_data = json.loads(token_json)
    except Exception as exc:
        raise UnauthorizedException("Invalid or malformed SSO handover token.") from exc

    if token_data.get("sig") != "ihm_erp_sso_v1":
        raise UnauthorizedException("Invalid SSO handover signature.")

    # 10 minute validity window
    ts = token_data.get("ts", 0)
    if abs(time.time() * 1000 - ts) > 10 * 60 * 1000:
        raise UnauthorizedException("SSO handover token has expired. Please re-authenticate.")

    token_email = (token_data.get("email") or "").strip().lower()
    req_email = payload.email.strip().lower()
    if token_email != req_email:
        raise UnauthorizedException("Identity mismatch in SSO token.")

    # ERP Isolation Enforcement
    my_erp_keys = {
        getattr(settings, "ERP_KEY", "inhyma").lower(),
        getattr(settings, "ERP_INSTANCE_ID", "erp-01").lower(),
        "inhyma",
        "erp-01",
    }
    my_erp_keys = {k for k in my_erp_keys if k}
    allowed_erps = [str(k).lower() for k in (token_data.get("allowed_erps") or ["*"])]
    if "*" not in allowed_erps and not my_erp_keys.intersection(allowed_erps):
        raise ForbiddenException(f"User '{req_email}' is not authorized to access this ERP.")

    # Central verification: the handover token is built in the browser, so it proves nothing by itself.
    # ERP_Main (the authority on who may use which ERP) must confirm the central session.
    if settings.SSO_HANDOVER_REQUIRE_CENTRAL_VERIFICATION:
        session_id = str(token_data.get("session_id") or "")
        if not session_id or session_id.startswith("ihm-sess-"):
            raise UnauthorizedException("SSO handover requires an active central session. Please sign in again.")
        try:
            central = await verify_ecosystem_session(session_id)
        except EcosystemSessionUnavailable as exc:
            # ERP_Main is temporarily unreachable: a retryable 503, NOT "your session ended" (401).
            raise ServiceUnavailableException(
                "The control plane is not reachable right now. Please try again in a moment."
            ) from exc
        except EcosystemSessionError as exc:
            raise UnauthorizedException(
                "Could not confirm your session with ERP_Main. Please try again in a moment."
            ) from exc
        if not central.get("active") or (central.get("revoked") and not central.get("notFound")):
            raise UnauthorizedException("Your central session is no longer active. Please sign in again.")
        if central.get("notFound") and not central.get("active"):
            raise UnauthorizedException("SSO handover requires an active central session. Please sign in again.")
        if (central.get("email") or "").strip().lower() != req_email:
            raise UnauthorizedException("Identity mismatch in SSO session.")
        central_allowed = [str(k).lower() for k in (central.get("allowed_erps") or [])]
        central_role = str(central.get("role") or "").lower()
        if central_role != "super_admin" and "*" not in central_allowed and not my_erp_keys.intersection(central_allowed):
            raise ForbiddenException(f"User '{req_email}' is not authorized to access this ERP.")

    # The central session this handover verified (None when central verification is switched off: then the tokens
    # get a local-only session id instead of an unverified central one).
    handover_sid: str | None = None
    if settings.SSO_HANDOVER_REQUIRE_CENTRAL_VERIFICATION:
        _verified_sid = str(token_data.get("session_id") or "")
        if _verified_sid and not _verified_sid.startswith("ihm-sess-"):
            handover_sid = _verified_sid

    # Resolve local user
    stmt = select(User).where(func.lower(User.email) == req_email)
    user = (await db.execute(stmt)).scalars().first()
    if user:
        if user.deleted_at is not None or not user.is_active or not user.can_login:
            from app.users.models import UserStatus
            user.deleted_at = None
            user.is_active = True
            user.status = UserStatus.ACTIVE
            await db.flush()
    else:
        # Auto-provision minimal local user on confirmed central handover
        from app.api.v1.internal_users import _system_actor_id
        from app.users.repository import UserRepository
        from app.users.service import UserService
        import secrets

        user_service = UserService(
            user_repository=UserRepository(db),
            user_role_repository=rbac_service.user_role_repository,
            rbac_service=rbac_service,
            auth_service=auth_service,
        )
        system_actor_id = await _system_actor_id(db)
        display_name = str(token_data.get("user") or req_email.split("@")[0])
        first = display_name.split()[0]
        last = display_name.split()[-1] if len(display_name.split()) > 1 else None
        dummy_phone = f"+0000{secrets.randbelow(900000) + 100000}"
        temp_pass = f"Tmp!{secrets.token_urlsafe(12)}"
        user, _ = await user_service.create_user(
            first_name=first,
            last_name=last,
            display_name=display_name,
            email=req_email,
            username=req_email.split("@")[0],
            phone=dummy_phone,
            password=temp_pass,
            has_login=True,
            created_by=system_actor_id,
        )
        await db.flush()

    access_token, refresh_token = await auth_service.issue_session_for_federated_user(
        user, context, session_id=handover_sid
    )
    roles = await rbac_service.list_roles_for_user(user.id)
    permissions = await auth_service.get_user_effective_permissions(user.id)

    profile = ProfileResponse(
        id=user.id,
        first_name=user.first_name,
        last_name=user.last_name,
        employee_code=user.employee_code,
        username=user.username or "",
        email=user.email or "",
        phone=user.phone,
        status=user.status.value,
        is_active=user.is_active,
        must_change_password=user.must_change_password,
        last_login_at=user.last_login_at,
        password_changed_at=user.password_changed_at,
        created_at=user.created_at,
        roles=[role.name for role in roles],
        permissions=sorted(permissions),
    )

    await audit_service.record(
        action=AuditAction.LOGIN,
        module="auth",
        user_id=user.id,
        username_snapshot=user.username,
        entity_type="User",
        entity_id=str(user.id),
        ip_address=context.ip_address,
        user_agent=context.user_agent,
        request_id=request.state.request_id,
        http_method=request.method,
        endpoint=request.url.path,
        response_status=status.HTTP_200_OK,
        description=f"SSO handover login successful for {user.email}",
    )
    request.state.audit_logged = True

    data = _token_response(access_token, refresh_token, user=profile).model_dump(mode="json")
    return build_success_response(data=data, request_id=request.state.request_id)