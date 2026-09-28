"""
Internal ERP Service Endpoints for Identity Provisioning (Prompt 2).

Protected by service credentials. Used by ERP_Main control plane to inspect
and provision minimal local accounts without direct DB access.
"""

from __future__ import annotations

import hmac
import secrets
import uuid

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, EmailStr
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_auth_service
from app.auth.service import AuthService
from app.core.config import settings
from app.core.responses import build_success_response
from app.database.session import get_db_session
from app.rbac.dependencies import get_rbac_service
from app.rbac.service import RBACService
from app.users.models import User
from app.users.repository import UserRepository
from app.users.service import UserService

router = APIRouter(prefix="/internal/users", tags=["Internal User Provisioning"])

_bearer_scheme = HTTPBearer(auto_error=False)


def require_internal_service_auth(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer_scheme),
) -> None:
    """Verify machine-to-machine service token with rotation support and zero insecure fallbacks."""
    if not credentials or not credentials.credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing service credential.",
        )

    valid_credentials = settings.get_expected_erp_main_credentials()
    if not valid_credentials:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Service authentication is not configured on this server.",
        )

    token = credentials.credentials
    token_bytes = token.encode("utf-8")

    matched = False
    for expected in valid_credentials:
        if hmac.compare_digest(token_bytes, expected.encode("utf-8")):
            matched = True
            break

    if not matched:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid service credential.",
        )


class UserCheckRequest(BaseModel):
    identifier: str


class UserProvisionRequest(BaseModel):
    email: EmailStr
    display_name: str
    username: str | None = None
    first_name: str | None = None
    last_name: str | None = None
    phone: str | None = None
    target_organization_id: str | None = None
    password: str | None = None


class UserAccessRequest(BaseModel):
    """Set whether a local account may authenticate, driven by ERP_Main's central access decision."""

    allow_login: bool
    reason: str | None = None


@router.post("/check", summary="Check if a local user exists")
async def check_local_user(
    payload: UserCheckRequest,
    request: Request,
    _auth: None = Depends(require_internal_service_auth),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    """Inspect if a user exists by email or username."""
    req_id = getattr(request.state, "request_id", "-")
    ident = payload.identifier.strip().lower()
    stmt = select(User).where(
        (func.lower(User.email) == ident) | (func.lower(User.username) == ident),
        User.deleted_at.is_(None),
    )
    user = (await db.execute(stmt)).scalars().first()

    if user:
        return build_success_response(
            data={
                "exists": True,
                "local_user_id": str(user.id),
                "username": user.username,
                "email": user.email,
                "display_name": user.display_name,
            },
            request_id=req_id,
        )

    return build_success_response(data={"exists": False}, request_id=req_id)


@router.post("/provision", status_code=status.HTTP_201_CREATED, summary="Provision a minimal local user")
async def provision_local_user(
    payload: UserProvisionRequest,
    request: Request,
    _auth: None = Depends(require_internal_service_auth),
    db: AsyncSession = Depends(get_db_session),
    rbac_service: RBACService = Depends(get_rbac_service),
) -> dict:
    """Provision a minimal local user record or return existing."""
    req_id = getattr(request.state, "request_id", "-")
    email_clean = payload.email.strip().lower()
    stmt = select(User).where(func.lower(User.email) == email_clean, User.deleted_at.is_(None))
    existing = (await db.execute(stmt)).scalars().first()
    if existing:
        if payload.password:
            from app.auth.security import hash_password
            existing.password_hash = hash_password(payload.password)
        existing.must_change_password = False
        from app.users.models import UserStatus
        if existing.status == UserStatus.PASSWORD_CHANGE_REQUIRED:
            existing.status = UserStatus.ACTIVE
        await db.flush()
        return build_success_response(
            data={
                "local_user_id": str(existing.id),
                "username": existing.username,
                "email": existing.email,
                "created": False,
            },
            request_id=req_id,
        )

    from app.auth.dependencies import get_auth_service

    auth_service = get_auth_service(db)
    user_service = UserService(
        user_repository=UserRepository(db),
        user_role_repository=rbac_service.user_role_repository,
        rbac_service=rbac_service,
        auth_service=auth_service,
    )

    first = payload.first_name or payload.display_name.split()[0]
    last = payload.last_name or (payload.display_name.split()[-1] if len(payload.display_name.split()) > 1 else None)
    dummy_phone = payload.phone or f"+0000{secrets.randbelow(900000) + 100000}"
    temp_pass = f"Tmp!{secrets.token_urlsafe(12)}"

    system_actor_id = uuid.UUID("00000000-0000-0000-0000-000000000001")

    user, _temp_pass = await user_service.create_user(
        first_name=first,
        last_name=last,
        display_name=payload.display_name,
        email=email_clean,
        username=payload.username,
        phone=dummy_phone,
        password=payload.password or temp_pass,
        has_login=True,
        created_by=system_actor_id,
    )

    return build_success_response(
        data={
            "local_user_id": str(user.id),
            "username": user.username,
            "email": user.email,
            "created": True,
        },
        request_id=req_id,
    )


@router.post("/{local_user_id}/access", summary="Set whether a local account may authenticate")
async def set_local_user_access(
    local_user_id: uuid.UUID,
    payload: UserAccessRequest,
    request: Request,
    _auth: None = Depends(require_internal_service_auth),
    db: AsyncSession = Depends(get_db_session),
    rbac_service: RBACService = Depends(get_rbac_service),
    auth_service: AuthService = Depends(get_auth_service),
) -> dict:
    """
    Block or restore a local account's ability to authenticate, driven by
    ERP_Main's central GlobalUser/ErpMembership access decision (Phase 3
    Global User Status & ERP Access Synchronization).

    Reuses the existing `UserService.suspend_user`/`activate_user` --
    already force-logs-out active sessions and invalidates in-flight
    tokens on suspend (see `AuthService.force_logout_user`) -- rather
    than introducing a second, parallel access-blocking mechanism.
    Never touches roles/permissions, and never deletes the account.

    `auth_service` is resolved through FastAPI's own dependency injection
    (`Depends(get_auth_service)`) rather than called directly the way
    `provision_local_user` above calls it -- a direct call leaves
    `AuthService.cache` bound to its own unresolved `Depends(get_cache)`
    default instead of a real cache backend, which is harmless for
    provisioning (that path never touches `.cache`) but breaks
    `suspend_user`'s call to `force_logout_user`, which does.
    """
    req_id = getattr(request.state, "request_id", "-")

    user_service = UserService(
        user_repository=UserRepository(db),
        user_role_repository=rbac_service.user_role_repository,
        rbac_service=rbac_service,
        auth_service=auth_service,
    )

    # Same system-actor convention already used by provision_local_user
    # above for calls that originate from ERP_Main's service credential
    # rather than a logged-in local admin.
    system_actor_id = uuid.UUID("00000000-0000-0000-0000-000000000001")

    # NotFoundException (unknown local_user_id) and ForbiddenException
    # (e.g. "cannot suspend the last active Super Administrator" -- a
    # real, pre-existing local safety rule this endpoint must still
    # respect) are left to propagate to the app's existing global
    # AppException handler, which already maps each to its correct
    # status code -- catching and re-wrapping them here would incorrectly
    # collapse a 403 safety rejection into a generic 400/404.
    if payload.allow_login:
        user = await user_service.activate_user(local_user_id, updated_by=system_actor_id)
    else:
        user = await user_service.suspend_user(local_user_id, updated_by=system_actor_id)

    return build_success_response(
        data={
            "local_user_id": str(user.id),
            "status": user.status.value,
            "can_login": user.can_login,
        },
        request_id=req_id,
    )


class UserDeprovisionRequest(BaseModel):
    reason: str | None = None


@router.post("/{local_user_id}/deprovision", summary="Remove a local user when access is removed in ERP_Main")
@router.delete("/{local_user_id}", summary="Remove a local user when access is removed in ERP_Main")
async def deprovision_local_user(
    local_user_id: str,
    request: Request,
    payload: UserDeprovisionRequest | None = None,
    _auth: None = Depends(require_internal_service_auth),
    db: AsyncSession = Depends(get_db_session),
    auth_service: AuthService = Depends(get_auth_service),
) -> dict:
    """
    Remove/deprovision a local user account when access is unlinked or removed in ERP_Main.
    Permanently revokes active sessions and soft-deletes the user record so they no longer
    appear in the spoke ERP user list or have any system access.
    """
    from datetime import datetime, timezone
    from app.users.models import UserStatus

    req_id = getattr(request.state, "request_id", "-")

    # Resolve user by UUID or email/username
    ident = local_user_id.strip()
    stmt = select(User)
    try:
        user_uuid = uuid.UUID(ident)
        stmt = stmt.where(User.id == user_uuid)
    except ValueError:
        stmt = stmt.where((func.lower(User.email) == ident.lower()) | (func.lower(User.username) == ident.lower()))

    user = (await db.execute(stmt)).scalars().first()
    if not user or user.deleted_at is not None:
        # Idempotent success: user does not exist or already removed
        return build_success_response(
            data={"removed": True, "local_user_id": ident, "already_removed": True}, request_id=req_id
        )

    # Safety: Never deprovision the hardcoded bootstrap admin account
    if user.username and user.username.lower() == settings.BOOTSTRAP_ADMIN_USERNAME.lower():
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot deprovision root admin account.")

    # Invalidate sessions & tokens
    try:
        await auth_service.force_logout_user(user.id, reason="central_deprovision")
    except Exception:
        pass

    # Soft delete and deactivate
    user.deleted_at = datetime.now(timezone.utc)
    user.is_active = False
    user.status = UserStatus.INACTIVE
    await db.commit()

    return build_success_response(
        data={
            "local_user_id": str(user.id),
            "removed": True,
            "status": "REMOVED",
        },
        request_id=req_id,
    )