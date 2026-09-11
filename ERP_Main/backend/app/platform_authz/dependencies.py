"""
Platform Authorization Dependencies.

The key design decision this module resolves (Phase 5 Section 21/22):
how do existing `PlatformAdmin`-gated routes (Phase 3: ERP registry,
memberships, federation, service identity, global users, audit) also
accept a GlobalUser holding an equivalent platform permission, WITHOUT
requiring both credential types at once and without breaking any of the
routes' existing behavior for PlatformAdmin callers?

FastAPI's normal `Depends(a), Depends(b)` composes as AND (both must
succeed). What Section 22 actually wants is OR: either a valid
PlatformAdmin session OR a GlobalUser session holding the needed
permission should satisfy the route. So `require_platform_permission`
below reads the bearer token itself exactly once and tries each
principal type in turn, rather than stacking two separate `HTTPBearer`
dependencies -- there is exactly one place this branching happens, not
one per route.

PlatformAdmin's role maps to an implicit "grant everything" for this
purpose: Phase 3's SUPER_ADMIN/PLATFORM_ADMIN tiers predate per-
permission granularity, and Section 63's "existing ERP functionality
remains backward compatible" requirement means every route already
gated by `require_platform_admin` must keep working for existing
PlatformAdmin accounts exactly as before -- this module does not take
away access any PlatformAdmin already had.
"""

from __future__ import annotations

import uuid

from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import ForbiddenException, UnauthorizedException
from app.database.session import get_db_session
from app.erp_registry.repository import ErpInstanceRepository
from app.global_audit.dependencies import get_global_audit_service
from app.global_audit.models import AuditActorType, AuditEventType
from app.global_audit.repository import GlobalAuditRepository
from app.global_audit.service import GlobalAuditService
from app.global_auth.repository import GlobalSessionRepository, GlobalUserCredentialRepository
from app.global_auth.security import InvalidGlobalTokenError, decode_global_access_token
from app.global_auth.service import GlobalAuthService
from app.global_users.models import GlobalUser
from app.global_users.repository import GlobalUserRepository
from app.platform_auth.models import PlatformAdmin
from app.platform_auth.repository import PlatformAdminRepository
from app.platform_auth.security import InvalidPlatformTokenError, decode_platform_access_token
from app.platform_authz.repository import (
    PlatformPermissionRepository,
    PlatformRoleAssignmentRepository,
    PlatformRoleRepository,
)
from app.platform_authz.service import PlatformAuthzService

_bearer_scheme = HTTPBearer(
    auto_error=True, description="Either a PlatformAdmin session token or a Global User session token."
)


def get_platform_authz_service(
    db: AsyncSession = Depends(get_db_session),
    audit: GlobalAuditService = Depends(get_global_audit_service),
) -> PlatformAuthzService:
    """Build a request-scoped `PlatformAuthzService`."""
    return PlatformAuthzService(
        role_repository=PlatformRoleRepository(db),
        permission_repository=PlatformPermissionRepository(db),
        assignment_repository=PlatformRoleAssignmentRepository(db),
        global_user_repository=GlobalUserRepository(db),
        erp_instance_repository=ErpInstanceRepository(db),
        audit=audit,
    )


class AuthorizedPrincipal:
    """
    The resolved caller of a platform-authorized request: either a PlatformAdmin or a GlobalUser.

    Exactly one of `platform_admin` / `global_user` is set. Route
    handlers that need to know which can check `is_platform_admin`;
    most callers only need `principal_id`/`principal_label` for
    audit-trail purposes and don't need to branch on which it is.
    """

    def __init__(self, *, platform_admin: PlatformAdmin | None = None, global_user: GlobalUser | None = None) -> None:
        """Store exactly one resolved principal."""
        self.platform_admin = platform_admin
        self.global_user = global_user

    @property
    def is_platform_admin(self) -> bool:
        """Return True if this request was authenticated as a PlatformAdmin."""
        return self.platform_admin is not None

    @property
    def principal_id(self) -> uuid.UUID:
        """Return the resolved principal's id, whichever type it is."""
        return self.platform_admin.id if self.platform_admin is not None else self.global_user.id

    @property
    def principal_label(self) -> str:
        """Return a human-readable label for audit purposes."""
        if self.platform_admin is not None:
            return self.platform_admin.email
        return self.global_user.primary_email

    @property
    def id(self) -> uuid.UUID:  # noqa: A003 - intentional duck-typing alias, see docstring below
        """
        Alias for `principal_id`.

        Several pre-existing services (Phase 3: erp_memberships,
        federation, global_users, service_identity) accept an
        `actor: PlatformAdmin` parameter and read only `actor.id` /
        `actor.email` from it for audit purposes. Exposing the same two
        attribute names here lets an `AuthorizedPrincipal` be passed to
        those exact same `actor=...` call sites unmodified -- no service
        signature needs to change, and PlatformAdmin callers keep
        working through the identical code path as before.
        """
        return self.principal_id

    @property
    def email(self) -> str:  # noqa: A003 - intentional duck-typing alias, see `id` above
        """Alias for `principal_label`, for the same duck-typing reason as `id` above."""
        return self.principal_label


async def _resolve_principal(credentials: HTTPAuthorizationCredentials, db: AsyncSession) -> AuthorizedPrincipal:
    """Try decoding the bearer token as a PlatformAdmin token first, then as a Global User token."""
    token = credentials.credentials

    try:
        payload = decode_platform_access_token(token)
        admin_id = uuid.UUID(payload["sub"])
        admin = await PlatformAdminRepository(db).get_by_id(admin_id)
        if admin is not None and admin.is_active:
            return AuthorizedPrincipal(platform_admin=admin)
    except (InvalidPlatformTokenError, KeyError, ValueError):
        pass

    try:
        payload = decode_global_access_token(token)
        global_user_id = uuid.UUID(payload["sub"])
        session_id = uuid.UUID(payload["jti"])
    except (InvalidGlobalTokenError, KeyError, ValueError) as exc:
        raise UnauthorizedException("Invalid or expired session token.") from exc

    auth_service = GlobalAuthService(
        user_repository=GlobalUserRepository(db),
        credential_repository=GlobalUserCredentialRepository(db),
        session_repository=GlobalSessionRepository(db),
        audit=GlobalAuditService(repository=GlobalAuditRepository(db)),
    )
    await auth_service.resolve_session(session_id)  # raises UnauthorizedException if revoked/expired

    user = await GlobalUserRepository(db).get_by_id(global_user_id)
    if user is None:
        raise UnauthorizedException("This Global User account no longer exists.")
    return AuthorizedPrincipal(global_user=user)


def require_platform_permission(permission_key: str, *, erp_scope_param: str | None = None):
    """
    Build a FastAPI dependency requiring `permission_key`, satisfied by EITHER credential type.

    A PlatformAdmin always satisfies any `require_platform_permission`
    check (backward compatibility, see module docstring). A GlobalUser
    must hold `permission_key` via an active, unexpired
    `PlatformRoleAssignment` -- globally, or scoped to the ERP named by
    the path parameter `erp_scope_param` if one is given (e.g.
    `erp_scope_param="erp_id"` for a route like
    `/global/erps/{erp_id}/federation`).

    Deny-by-default (Section 4): any failure to resolve/verify raises
    403, never falls through to "allow."
    """

    async def _dependency(
        request: Request,
        credentials: HTTPAuthorizationCredentials = Depends(_bearer_scheme),
        db: AsyncSession = Depends(get_db_session),
        audit: GlobalAuditService = Depends(get_global_audit_service),
    ) -> AuthorizedPrincipal:
        principal = await _resolve_principal(credentials, db)
        if principal.is_platform_admin:
            return principal

        erp_instance_id: uuid.UUID | None = None
        if erp_scope_param is not None:
            raw_value = request.path_params.get(erp_scope_param)
            if raw_value is not None:
                try:
                    erp_instance_id = uuid.UUID(str(raw_value))
                except ValueError:
                    erp_instance_id = None

        authz_service = PlatformAuthzService(
            role_repository=PlatformRoleRepository(db),
            permission_repository=PlatformPermissionRepository(db),
            assignment_repository=PlatformRoleAssignmentRepository(db),
            global_user_repository=GlobalUserRepository(db),
            erp_instance_repository=ErpInstanceRepository(db),
            audit=audit,
        )
        allowed = await authz_service.has_permission(
            principal.global_user.id, permission_key, erp_instance_id=erp_instance_id
        )
        if not allowed:
            await audit.record(
                event_type=AuditEventType.PLATFORM_AUTHORIZATION_DENIED,
                actor_type=AuditActorType.SYSTEM,
                actor_id=principal.global_user.id,
                actor_label=principal.global_user.primary_email,
                details={
                    "permission_key": permission_key,
                    "erp_instance_id": str(erp_instance_id) if erp_instance_id else None,
                },
            )
            raise ForbiddenException(f"This action requires the {permission_key!r} permission.")
        return principal

    return _dependency


async def require_authenticated_principal(
    credentials: HTTPAuthorizationCredentials = Depends(_bearer_scheme),
    db: AsyncSession = Depends(get_db_session),
) -> AuthorizedPrincipal:
    """
    Resolve the caller's identity (PlatformAdmin or GlobalUser) with NO specific permission check.

    For routes where "who is this" is enough and the actual access
    scoping happens downstream in the service layer -- e.g. Phase 7's
    global search/dashboard routes, which any authenticated principal
    may call, but whose RESULTS are then filtered to what that specific
    principal is authorized to see (Section 55: a platform user may
    have global, or single-ERP, reporting access; the route itself
    doesn't gate on a single fixed permission, the result set does).
    Deny-by-default still holds: an invalid/missing credential is
    rejected here exactly as `require_platform_permission` rejects one,
    via the same `_resolve_principal`.
    """
    return await _resolve_principal(credentials, db)


def require_platform_role(role_key: str):
    """
    Build a FastAPI dependency requiring an ACTIVE assignment of `role_key` (any scope).

    A coarser-grained alternative to `require_platform_permission` for
    routes that genuinely want "must hold this specific role" rather
    than "must hold this permission, however granted" (Section 21 names
    both as separate reusable dependencies).
    """

    async def _dependency(
        credentials: HTTPAuthorizationCredentials = Depends(_bearer_scheme),
        db: AsyncSession = Depends(get_db_session),
    ) -> AuthorizedPrincipal:
        principal = await _resolve_principal(credentials, db)
        if principal.is_platform_admin:
            return principal

        assignment_repo = PlatformRoleAssignmentRepository(db)
        role_repo = PlatformRoleRepository(db)
        role = await role_repo.get_by_key(role_key)
        if role is None or not role.is_active:
            raise ForbiddenException(f"Role {role_key!r} does not exist or is not active.")

        assignments = await assignment_repo.list_active_for_user(principal.global_user.id)
        for assignment in assignments:
            if assignment.role_id == role.id:
                return principal
        raise ForbiddenException(f"This action requires the {role_key!r} role.")

    return _dependency
