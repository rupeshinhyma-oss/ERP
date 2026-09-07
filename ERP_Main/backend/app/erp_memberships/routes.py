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

All routes require an authenticated platform admin.
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Query, Request, status

from app.core.responses import build_success_response
from app.erp_memberships.dependencies import get_erp_membership_service
from app.erp_memberships.schemas import ErpMembershipCreate, ErpMembershipRead, ErpMembershipStatusUpdate
from app.erp_memberships.service import ErpMembershipService
from app.platform_auth.dependencies import require_platform_admin
from app.platform_auth.models import PlatformAdmin

user_memberships_router = APIRouter(prefix="/global/users/{user_id}/memberships", tags=["ERP Memberships"])
erp_members_router = APIRouter(prefix="/global/erps/{erp_id}/members", tags=["ERP Memberships"])
membership_router = APIRouter(prefix="/global/memberships", tags=["ERP Memberships"])


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
    admin: PlatformAdmin = Depends(require_platform_admin),
    service: ErpMembershipService = Depends(get_erp_membership_service),
) -> dict:
    """Create a new ERP Membership, linking a Global User to a local account in a specific ERP. Starts PENDING."""
    membership = await service.create(user_id, erp_id, payload, actor=admin)
    return build_success_response(
        ErpMembershipRead.model_validate(membership).model_dump(mode="json"),
        request_id=_request_id(request),
        message="ERP Membership created (PENDING verification).",
    )


@user_memberships_router.get("", summary="List a Global User's ERP memberships")
async def list_user_memberships(
    request: Request,
    user_id: uuid.UUID,
    _admin: PlatformAdmin = Depends(require_platform_admin),
    service: ErpMembershipService = Depends(get_erp_membership_service),
) -> dict:
    """List every ERP membership held by a Global User (Phase 3 Step 34)."""
    memberships = await service.list_for_user(user_id)
    data = [ErpMembershipRead.model_validate(m).model_dump(mode="json") for m in memberships]
    return build_success_response(data, request_id=_request_id(request))


@erp_members_router.get("", summary="List Global Users with a membership in this ERP")
async def list_erp_members(
    request: Request,
    erp_id: uuid.UUID,
    limit: int = Query(default=100, ge=1, le=1000),
    offset: int = Query(default=0, ge=0),
    _admin: PlatformAdmin = Depends(require_platform_admin),
    service: ErpMembershipService = Depends(get_erp_membership_service),
) -> dict:
    """List Global Users with a membership in this ERP, paged (Phase 3 Step 35)."""
    memberships = await service.list_for_erp(erp_id, limit=limit, offset=offset)
    data = [ErpMembershipRead.model_validate(m).model_dump(mode="json") for m in memberships]
    return build_success_response(data, request_id=_request_id(request))


@membership_router.get("/{membership_id}", summary="Fetch a single ERP Membership")
async def get_membership(
    request: Request,
    membership_id: uuid.UUID,
    _admin: PlatformAdmin = Depends(require_platform_admin),
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
    admin: PlatformAdmin = Depends(require_platform_admin),
    service: ErpMembershipService = Depends(get_erp_membership_service),
) -> dict:
    """Mark a membership as verified against its local ERP account and set it ACTIVE."""
    membership = await service.verify(membership_id, actor=admin)
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
    admin: PlatformAdmin = Depends(require_platform_admin),
    service: ErpMembershipService = Depends(get_erp_membership_service),
) -> dict:
    """Suspend a membership. Reversible via `/restore`. Never affects the local ERP account."""
    membership = await service.suspend(membership_id, actor=admin, reason=payload.reason)
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
    admin: PlatformAdmin = Depends(require_platform_admin),
    service: ErpMembershipService = Depends(get_erp_membership_service),
) -> dict:
    """Restore a suspended membership back to ACTIVE."""
    membership = await service.restore(membership_id, actor=admin, reason=payload.reason)
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
    admin: PlatformAdmin = Depends(require_platform_admin),
    service: ErpMembershipService = Depends(get_erp_membership_service),
) -> dict:
    """Revoke a membership. Closes the GlobalUser<->ERP link only -- never deletes the local ERP user."""
    membership = await service.revoke(membership_id, actor=admin, reason=payload.reason)
    return build_success_response(
        ErpMembershipRead.model_validate(membership).model_dump(mode="json"),
        request_id=_request_id(request),
        message="Membership revoked.",
    )
