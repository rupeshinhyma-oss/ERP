"""
ERP Membership Routes.

Two route groups (Phase 3 Steps 33-35):
- Nested under a Global User (`/global/users/{user_id}/memberships...`):
  create a link, list a user's memberships.
- Nested under an ERP (`/global/erps/{erp_id}/members`): list who has a
  membership in this ERP, paged.
Plus flat `/global/memberships/{membership_id}` for lookup and the
status-transition actions, since those operate on a membership by its own
id and don't need either parent's id repeated in the path.

All routes require an authenticated platform admin, EXCEPT
`internal_router` below (Phase 4 Step 24/36), which is gated by
`require_erp_service` instead -- it exists for an ERP's own backend to
resolve a federation ID token's GlobalUser id into ITS OWN local_user_id,
never a human-admin action.

Phase 5 (Section 22): every human-gated route now uses
`require_platform_permission(...)` instead of `require_platform_admin`
directly. Additive, not a narrowing -- a PlatformAdmin still satisfies
every check exactly as before; a GlobalUser holding the matching
`platform.membership.*` permission can now reach these routes too.
`internal_router` is untouched -- it is a machine-to-machine, service-
credential-gated boundary, not a human/GlobalUser authorization concern.
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Query, Request, status

from app.core.exceptions import ForbiddenException
from app.core.responses import build_success_response
from app.erp_memberships.dependencies import get_erp_membership_service
from app.erp_memberships.schemas import (
    ErpMembershipCreate,
    ErpMembershipRead,
    ErpMembershipStatusUpdate,
    InternalMembershipLookupResponse,
)
from app.erp_memberships.service import ErpMembershipService
from app.platform_authz.dependencies import (
    AuthorizedPrincipal,
    get_platform_authz_service,
    require_authenticated_principal,
    require_platform_permission,
)
from app.platform_authz.service import PlatformAuthzService
from app.service_identity.dependencies import require_erp_service
from app.service_identity.models import ErpServiceCredential

user_memberships_router = APIRouter(prefix="/global/users/{user_id}/memberships", tags=["ERP Memberships"])
erp_members_router = APIRouter(prefix="/global/erps/{erp_id}/members", tags=["ERP Memberships"])
membership_router = APIRouter(prefix="/global/memberships", tags=["ERP Memberships"])
internal_router = APIRouter(prefix="/internal/federation", tags=["ERP Memberships (internal)"])


def _request_id(request: Request) -> str:
    """Return the request's correlation ID set by `RequestIdMiddleware`."""
    return getattr(request.state, "request_id", "")


@user_memberships_router.post(
    "/{erp_id}", status_code=status.HTTP_201_CREATED, summary="Link a Global User to an ERP's local account"
)
async def create_membership(
    request: Request,
    user_id: uuid.UUID,
    erp_id: uuid.UUID,
    payload: ErpMembershipCreate,
    principal: AuthorizedPrincipal = Depends(
        require_platform_permission("platform.membership.create", erp_scope_param="erp_id")
    ),
    service: ErpMembershipService = Depends(get_erp_membership_service),
) -> dict:
    """Create a new ERP Membership, linking a Global User to a local account in a specific ERP. Starts PENDING."""
    membership = await service.create(user_id, erp_id, payload, actor=principal)
    return build_success_response(
        ErpMembershipRead.model_validate(membership).model_dump(mode="json"),
        request_id=_request_id(request),
        message="ERP Membership created (PENDING verification).",
    )


@user_memberships_router.get("", summary="List a Global User's ERP memberships")
async def list_user_memberships(
    request: Request,
    user_id: uuid.UUID,
    principal: AuthorizedPrincipal = Depends(require_authenticated_principal),
    service: ErpMembershipService = Depends(get_erp_membership_service),
    authz_service: PlatformAuthzService = Depends(get_platform_authz_service),
) -> dict:
    """List every ERP membership held by a Global User (Phase 3 Step 34). Self-service permitted for own user_id."""
    is_self = principal.global_user is not None and principal.global_user.id == user_id
    if not (principal.is_platform_admin or is_self):
        allowed = await authz_service.has_permission(principal.global_user.id, "platform.membership.read")
        if not allowed:
            raise ForbiddenException("This action requires the 'platform.membership.read' permission.")

    memberships = await service.list_for_user(user_id)
    data = [ErpMembershipRead.model_validate(m).model_dump(mode="json") for m in memberships]
    return build_success_response(data, request_id=_request_id(request))


@erp_members_router.get("", summary="List Global Users with a membership in this ERP")
async def list_erp_members(
    request: Request,
    erp_id: uuid.UUID,
    limit: int = Query(default=100, ge=1, le=1000),
    offset: int = Query(default=0, ge=0),
    _principal: AuthorizedPrincipal = Depends(
        require_platform_permission("platform.membership.read", erp_scope_param="erp_id")
    ),
    service: ErpMembershipService = Depends(get_erp_membership_service),
) -> dict:
    """List Global Users with a membership in this ERP, paged (Phase 3 Step 35)."""
    memberships = await service.list_for_erp(erp_id, limit=limit, offset=offset)
    data = [ErpMembershipRead.model_validate(m).model_dump(mode="json") for m in memberships]
    return build_success_response(data, request_id=_request_id(request))


@membership_router.get("", summary="List every ERP membership across the platform, paged")
async def list_all_memberships(
    request: Request,
    limit: int = Query(default=100, ge=1, le=1000),
    offset: int = Query(default=0, ge=0),
    erp_id: uuid.UUID | None = Query(default=None),
    status: str | None = Query(default=None),
    _principal: AuthorizedPrincipal = Depends(require_platform_permission("platform.membership.read")),
    service: ErpMembershipService = Depends(get_erp_membership_service),
) -> dict:
    """List ERP memberships with optional ERP and status filtering, paged."""
    from app.erp_memberships.models import ErpMembershipStatus
    parsed_status = None
    if status:
        try:
            parsed_status = ErpMembershipStatus(status.upper())
        except ValueError:
            parsed_status = None
    memberships = await service.list_all(
        limit=limit, offset=offset, erp_instance_id=erp_id, status=parsed_status
    )
    data = [ErpMembershipRead.model_validate(m).model_dump(mode="json") for m in memberships]
    return build_success_response(data, request_id=_request_id(request))


@membership_router.get("/{membership_id}", summary="Fetch a single ERP Membership")
async def get_membership(
    request: Request,
    membership_id: uuid.UUID,
    _principal: AuthorizedPrincipal = Depends(require_platform_permission("platform.membership.read")),
    service: ErpMembershipService = Depends(get_erp_membership_service),
) -> dict:
    """Fetch a single ERP Membership by its id."""
    membership = await service.get(membership_id)
    return build_success_response(
        ErpMembershipRead.model_validate(membership).model_dump(mode="json"), request_id=_request_id(request)
    )


@membership_router.post("/{membership_id}/verify", summary="Mark a PENDING membership as verified/ACTIVE")
async def verify_membership(
    request: Request,
    membership_id: uuid.UUID,
    principal: AuthorizedPrincipal = Depends(require_platform_permission("platform.membership.update")),
    service: ErpMembershipService = Depends(get_erp_membership_service),
) -> dict:
    """Mark a membership as verified against its local ERP account and set it ACTIVE."""
    membership = await service.verify(membership_id, actor=principal)
    return build_success_response(
        ErpMembershipRead.model_validate(membership).model_dump(mode="json"),
        request_id=_request_id(request),
        message="Membership verified and activated.",
    )


@membership_router.post("/{membership_id}/suspend", summary="Suspend an ERP Membership")
async def suspend_membership(
    request: Request,
    membership_id: uuid.UUID,
    payload: ErpMembershipStatusUpdate,
    principal: AuthorizedPrincipal = Depends(require_platform_permission("platform.membership.update")),
    service: ErpMembershipService = Depends(get_erp_membership_service),
) -> dict:
    """Suspend a membership. Reversible via `/restore`. Never affects the local ERP account."""
    membership = await service.suspend(membership_id, actor=principal, reason=payload.reason)
    return build_success_response(
        ErpMembershipRead.model_validate(membership).model_dump(mode="json"),
        request_id=_request_id(request),
        message="Membership suspended.",
    )


@membership_router.post("/{membership_id}/restore", summary="Restore a suspended ERP Membership")
async def restore_membership(
    request: Request,
    membership_id: uuid.UUID,
    payload: ErpMembershipStatusUpdate,
    principal: AuthorizedPrincipal = Depends(require_platform_permission("platform.membership.update")),
    service: ErpMembershipService = Depends(get_erp_membership_service),
) -> dict:
    """Restore a suspended membership back to ACTIVE."""
    membership = await service.restore(membership_id, actor=principal, reason=payload.reason)
    return build_success_response(
        ErpMembershipRead.model_validate(membership).model_dump(mode="json"),
        request_id=_request_id(request),
        message="Membership restored.",
    )


@membership_router.post("/{membership_id}/revoke", summary="Revoke an ERP Membership")
async def revoke_membership(
    request: Request,
    membership_id: uuid.UUID,
    payload: ErpMembershipStatusUpdate,
    principal: AuthorizedPrincipal = Depends(require_platform_permission("platform.membership.revoke")),
    service: ErpMembershipService = Depends(get_erp_membership_service),
) -> dict:
    """Revoke a membership. Closes the GlobalUser<->ERP link only -- never deletes the local ERP user."""
    membership = await service.revoke(membership_id, actor=principal, reason=payload.reason)
    return build_success_response(
        ErpMembershipRead.model_validate(membership).model_dump(mode="json"),
        request_id=_request_id(request),
        message="Membership revoked.",
    )


@internal_router.get(
    "/memberships/{global_user_id}",
    summary="Resolve a GlobalUser's membership for the CALLING ERP (service-credential authenticated)",
)
async def internal_lookup_membership(
    request: Request,
    global_user_id: uuid.UUID,
    credential: ErpServiceCredential = Depends(require_erp_service),
    service: ErpMembershipService = Depends(get_erp_membership_service),
) -> dict:
    """
    Resolve a GlobalUser's membership for the calling ERP only (Phase 4 Step 24/36).

    The caller's own identity comes entirely from its verified service
    credential (`credential.erp_instance_id`) -- never from a path/query
    parameter -- so this endpoint can only ever answer "what is MY OWN
    membership for this GlobalUser," never look up another ERP's
    membership data (Step 58: "Neither ERP receives the other ERP's
    local user identity unless explicitly required"). Returns 404 if no
    membership exists, so an ERP can't distinguish "PENDING" from
    "doesn't exist" any more granularly than the membership row itself
    already exposes via `status`.
    """
    membership = await service.get_for_user_and_erp(global_user_id, credential.erp_instance_id)
    response = InternalMembershipLookupResponse(
        global_user_id=membership.global_user_id,
        local_user_id=membership.local_user_id,
        status=membership.status,
    )
    return build_success_response(response.model_dump(mode="json"), request_id=_request_id(request))
