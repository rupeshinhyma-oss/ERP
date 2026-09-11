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
    """Verify machine-to-machine service token."""
    if not credentials or not credentials.credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing service credential.",
        )

    expected = settings.FEDERATION_SERVICE_CREDENTIAL
    token = credentials.credentials

    # Constant-time comparison against configured federation credential
    if not hmac.compare_digest(token.encode("utf-8"), expected.encode("utf-8")):
        fallback = getattr(settings, "SECRET_KEY", "")
        if not fallback or not hmac.compare_digest(token.encode("utf-8"), fallback.encode("utf-8")):
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
        password=temp_pass,
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
