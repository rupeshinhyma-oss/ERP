"""
Federation SSO Route.

Implements the Relying Party side of the federation adapter (Phase 4
Step 27):

    Federation ID token (from ERP_Main)
        -> verify signature/issuer/audience/expiry (app.federation.token_verification)
        -> resolve local_user_id via ERP_Main's trusted membership lookup (app.federation.erp_main_client)
        -> resolve the actual local User row
        -> AuthService.issue_session_for_federated_user (existing local session/JWT/RBAC, unchanged)

This is an ADDITIVE login path (Phase 4 Step 28) -- `POST /auth/login`
(direct username/password) is completely untouched and remains fully
functional. Nothing in `app.auth`, `app.users`, or `app.rbac` was
modified to make this work, aside from the one small, clearly-scoped
`AuthService.issue_session_for_federated_user` method added specifically
for this purpose (see that method's own docstring).
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_auth_service, get_login_context
from app.auth.routes import _token_response
from app.auth.schemas import ProfileResponse
from app.auth.service import AuthService, LoginContext
from app.core.config import settings
from app.core.exceptions import ForbiddenException, UnauthorizedException
from app.core.responses import build_success_response
from app.database.session import get_db_session
from app.federation.erp_main_client import MembershipLookupError, lookup_membership
from app.federation.schemas import FederationSsoLoginRequest
from app.federation.token_verification import InvalidFederationTokenError, verify_federation_id_token
from app.rbac.dependencies import get_rbac_service
from app.rbac.service import RBACService
from app.users.repository import UserRepository

router = APIRouter(prefix="/federation", tags=["Federation SSO"])


@router.post("/sso-login", summary="Establish a local session from an ERP_Main federation ID token")
async def sso_login(
    payload: FederationSsoLoginRequest,
    request: Request,
    db: AsyncSession = Depends(get_db_session),
    auth_service: AuthService = Depends(get_auth_service),
    rbac_service: RBACService = Depends(get_rbac_service),
    context: LoginContext = Depends(get_login_context),
) -> dict:
    """
    Exchange a verified ERP_Main federation ID token for a local Inhyma session.

    Fail-closed at every step (Phase 4 Step 53): a bad token, an
    unreachable/negative membership lookup, a non-ACTIVE membership, or a
    local user that can't log in (Step 25) all result in a plain,
    generic-shaped rejection -- never a fallback "allow anyway."
    """
    if not settings.INHYMA_SSO_ENABLED:
        raise ForbiddenException("SSO login is currently disabled for this ERP.")

    try:
        claims = await verify_federation_id_token(payload.id_token)
    except InvalidFederationTokenError as exc:
        raise UnauthorizedException("Invalid or expired federation token.") from exc

    global_user_id = uuid.UUID(claims["sub"])

    try:
        membership = await lookup_membership(global_user_id)
    except MembershipLookupError as exc:
        raise ForbiddenException("You do not have an active membership for this ERP.") from exc

    if membership.get("status") != "ACTIVE":
        # Deliberately the same rejection shape regardless of whether the
        # membership is PENDING/SUSPENDED/REVOKED (Step 53: fail-closed,
        # don't leak which specific state it's in).
        raise ForbiddenException("You do not have an active membership for this ERP.")

    try:
        local_user_id = uuid.UUID(membership["local_user_id"])
    except (KeyError, ValueError) as exc:
        raise ForbiddenException("This membership's local account reference is invalid.") from exc

    user = await UserRepository(db).get_by_id(local_user_id)
    if user is None:
        # Local user status remains authoritative (Step 25/26) -- a
        # membership pointing at a local account that no longer exists
        # is exactly as invalid as one pointing at a disabled account.
        raise ForbiddenException("The local account for this membership no longer exists.")

    access_token, refresh_token = await auth_service.issue_session_for_federated_user(user, context)

    roles = await rbac_service.list_roles_for_user(user.id)
    permissions = await auth_service.get_user_effective_permissions(user.id)
    profile = ProfileResponse(
        id=user.id,
        first_name=user.first_name,
        last_name=user.last_name,
        employee_code=user.employee_code,
        username=user.username,
        email=user.email,
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

    data = _token_response(access_token, refresh_token, user=profile).model_dump(mode="json")
    return build_success_response(data=data, request_id=request.state.request_id)
