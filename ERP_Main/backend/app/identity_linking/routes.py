"""
Identity Linking & Conflict Resolution Routes (Prompt 2).

Control plane API for:
- Flow A provisioning (GlobalUser -> ERP local user)
- Identity conflict inspection & resolution
- Explicit identity linking & unlinking
- Viewing linked identities
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Query, Request, status

from app.core.responses import build_success_response
from app.erp_memberships.schemas import ErpMembershipRead
from app.identity_linking.dependencies import get_identity_linking_service
from app.identity_linking.models import ConflictStatus
from app.identity_linking.schemas import (
    DirectIdentityLinkRequest,
    GlobalUserProvisionRequest,
    IdentityConflictRead,
    IdentityConflictResolveRequest,
    LinkedIdentityRead,
)
from app.identity_linking.service import IdentityLinkingService
from app.platform_authz.dependencies import AuthorizedPrincipal, require_platform_permission

identity_router = APIRouter(prefix="/global/identity", tags=["Identity Linking"])
user_provision_router = APIRouter(prefix="/global/users/{user_id}", tags=["Identity Linking"])


def _request_id(request: Request) -> str:
    """Return the correlation ID from request state."""
    return getattr(request.state, "request_id", "")


# -----------------------------------------------------------------------------
# FLOW A: Provision GlobalUser -> ERP
# -----------------------------------------------------------------------------
@user_provision_router.post(
    "/provision",
    status_code=status.HTTP_201_CREATED,
    summary="Provision a GlobalUser into an ERP instance",
)
async def provision_user_to_erp(
    request: Request,
    user_id: uuid.UUID,
    payload: GlobalUserProvisionRequest,
    principal: AuthorizedPrincipal = Depends(
        require_platform_permission("platform.membership.create")
    ),
    service: IdentityLinkingService = Depends(get_identity_linking_service),
) -> dict:
    """
    Provision a GlobalUser into a target ERP instance.

    Creates the minimal required local ERP user account via adapter if not already present,
    and establishes an active ErpMembership. Idempotent: repeated calls safely return existing membership.
    """
    membership = await service.provision_global_user_to_erp(
        global_user_id=user_id,
        erp_instance_id=payload.erp_instance_id,
        target_organization_id=payload.target_organization_id,
        notes=payload.notes,
        actor=principal,
    )
    return build_success_response(
        ErpMembershipRead.model_validate(membership).model_dump(mode="json"),
        request_id=_request_id(request),
        message="User successfully provisioned and linked to ERP instance.",
    )


# -----------------------------------------------------------------------------
# LINK & UNLINK
# -----------------------------------------------------------------------------
@identity_router.post("/link", status_code=status.HTTP_201_CREATED, summary="Explicitly link a GlobalUser and local ERP user")
async def link_identity(
    request: Request,
    payload: DirectIdentityLinkRequest,
    principal: AuthorizedPrincipal = Depends(
        require_platform_permission("platform.membership.create")
    ),
    service: IdentityLinkingService = Depends(get_identity_linking_service),
) -> dict:
    """Explicitly link a GlobalUser to an existing local ERP user."""
    from app.erp_memberships.schemas import ErpMembershipCreate
    from app.erp_memberships.dependencies import get_erp_membership_service
    from app.erp_memberships.service import ErpMembershipService

    # Use membership service directly for direct link
    mem_service: ErpMembershipService = get_erp_membership_service(
        db=service.db, audit=service.audit
    )
    membership = await mem_service.create(
        global_user_id=payload.global_user_id,
        erp_instance_id=payload.erp_instance_id,
        payload=ErpMembershipCreate(local_user_id=payload.local_user_id),
        actor=principal,
    )
    return build_success_response(
        ErpMembershipRead.model_validate(membership).model_dump(mode="json"),
        request_id=_request_id(request),
        message="Identity link created successfully.",
    )


@identity_router.delete(
    "/memberships/{membership_id}/link",
    summary="Unlink a GlobalUser from an ERP instance",
)
async def unlink_identity(
    request: Request,
    membership_id: uuid.UUID,
    reason: str | None = Query(default=None),
    principal: AuthorizedPrincipal = Depends(
        require_platform_permission("platform.membership.revoke")
    ),
    service: IdentityLinkingService = Depends(get_identity_linking_service),
) -> dict:
    """Safely unlink a GlobalUser from an ERP without deleting the local ERP account."""
    revoked = await service.unlink_membership(membership_id, actor=principal, reason=reason)
    return build_success_response(
        ErpMembershipRead.model_validate(revoked).model_dump(mode="json"),
        request_id=_request_id(request),
        message="Identity unlinked successfully. Local account preserved.",
    )


@user_provision_router.get(
    "/identities",
    summary="List all linked ERP accounts for a GlobalUser",
)
async def list_user_identities(
    request: Request,
    user_id: uuid.UUID,
    principal: AuthorizedPrincipal = Depends(
        require_platform_permission("platform.global_user.read")
    ),
    service: IdentityLinkingService = Depends(get_identity_linking_service),
) -> dict:
    """Fetch all linked ERP accounts, local user IDs, and statuses for a GlobalUser."""
    identities = await service.list_identities_for_user(user_id)
    return build_success_response(
        identities,
        request_id=_request_id(request),
    )


# -----------------------------------------------------------------------------
# CONFLICT MANAGEMENT
# -----------------------------------------------------------------------------
@identity_router.get("/conflicts", summary="List identity conflicts")
async def list_conflicts(
    request: Request,
    erp_id: uuid.UUID | None = Query(default=None),
    status: ConflictStatus | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    principal: AuthorizedPrincipal = Depends(
        require_platform_permission("platform.global_user.read")
    ),
    service: IdentityLinkingService = Depends(get_identity_linking_service),
) -> dict:
    """List ambiguous or conflicting identity matches."""
    conflicts = await service.conflict_repo.list_conflicts(
        erp_instance_id=erp_id, status=status, limit=limit, offset=offset
    )
    total = await service.conflict_repo.count_conflicts(erp_instance_id=erp_id, status=status)
    return build_success_response(
        [IdentityConflictRead.model_validate(c).model_dump(mode="json") for c in conflicts],
        meta={"total": total, "limit": limit, "offset": offset},
        request_id=_request_id(request),
    )


@identity_router.get("/conflicts/{conflict_id}", summary="Get identity conflict details")
async def get_conflict(
    request: Request,
    conflict_id: uuid.UUID,
    principal: AuthorizedPrincipal = Depends(
        require_platform_permission("platform.global_user.read")
    ),
    service: IdentityLinkingService = Depends(get_identity_linking_service),
) -> dict:
    """Fetch a specific identity conflict by ID."""
    from app.core.exceptions import NotFoundException

    conflict = await service.conflict_repo.get_by_id(conflict_id)
    if conflict is None:
        raise NotFoundException(f"IdentityConflict {conflict_id} not found.")
    return build_success_response(
        IdentityConflictRead.model_validate(conflict).model_dump(mode="json"),
        request_id=_request_id(request),
    )


@identity_router.post(
    "/conflicts/{conflict_id}/resolve",
    summary="Resolve an identity conflict (LINK, CREATE_NEW, or REJECT)",
)
async def resolve_conflict(
    request: Request,
    conflict_id: uuid.UUID,
    payload: IdentityConflictResolveRequest,
    principal: AuthorizedPrincipal = Depends(
        require_platform_permission("platform.membership.create")
    ),
    service: IdentityLinkingService = Depends(get_identity_linking_service),
) -> dict:
    """
    Resolve an identity conflict.

    - LINK: bind to a specific candidate GlobalUser
    - CREATE_NEW: create a new distinct GlobalUser and link
    - REJECT: reject the link attempt
    """
    resolved = await service.resolve_conflict(
        conflict_id,
        action=payload.action,
        target_global_user_id=payload.target_global_user_id,
        notes=payload.notes,
        actor=principal,
    )
    return build_success_response(
        IdentityConflictRead.model_validate(resolved).model_dump(mode="json"),
        request_id=_request_id(request),
        message=f"Identity conflict resolved via {payload.action.value}.",
    )
