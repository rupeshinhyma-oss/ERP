"""
Global User Routes.

All mutating routes require an authenticated platform admin (Phase 3
Step 19/32). Read routes require it too, unlike the ERP Registry's -- a
Global User's email/metadata is personal information about a real human,
not public registry topology, so it does not get the same "open reads"
treatment `erp_registry` gets.

Phase 5 (Section 22): every route now uses
`require_platform_permission(...)` instead of `require_platform_admin`
directly. Additive, not a narrowing -- a PlatformAdmin still satisfies
every check exactly as before. `AuthorizedPrincipal` exposes `.id`/
`.email` aliases so it can be passed straight into `service.create(...,
actor=...)` etc. without changing any service signature.
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Query, Request, status

from app.core.responses import build_success_response
from app.global_users.dependencies import get_global_user_service
from app.global_users.schemas import GlobalUserCreate, GlobalUserRead, GlobalUserStatusUpdate, GlobalUserUpdate
from app.global_users.service import GlobalUserService
from app.platform_authz.dependencies import AuthorizedPrincipal, require_platform_permission

router = APIRouter(prefix="/global/users", tags=["Global Users"])


def _request_id(request: Request) -> str:
    """Return the request's correlation ID set by `RequestIdMiddleware`."""
    return getattr(request.state, "request_id", "")


@router.post("", status_code=status.HTTP_201_CREATED, summary="Create a new Global User")
async def create_global_user(
    request: Request,
    payload: GlobalUserCreate,
    principal: AuthorizedPrincipal = Depends(require_platform_permission("platform.user.create")),
    service: GlobalUserService = Depends(get_global_user_service),
) -> dict:
    """Create a new Global User. Requires platform.user.create (or PlatformAdmin)."""
    user = await service.create(payload, actor=principal)
    return build_success_response(
        GlobalUserRead.model_validate(user).model_dump(mode="json", by_alias=True),
        request_id=_request_id(request),
        message="Global User created.",
    )


@router.get("", summary="List Global Users")
async def list_global_users(
    request: Request,
    limit: int = Query(default=100, ge=1, le=1000),
    offset: int = Query(default=0, ge=0),
    _principal: AuthorizedPrincipal = Depends(require_platform_permission("platform.user.read")),
    service: GlobalUserService = Depends(get_global_user_service),
) -> dict:
    """List Global Users, paged."""
    users = await service.list_all(limit=limit, offset=offset)
    data = [GlobalUserRead.model_validate(u).model_dump(mode="json", by_alias=True) for u in users]
    return build_success_response(data, request_id=_request_id(request))


@router.get("/{user_id}", summary="Fetch a Global User by id")
async def get_global_user(
    request: Request,
    user_id: uuid.UUID,
    _principal: AuthorizedPrincipal = Depends(require_platform_permission("platform.user.read")),
    service: GlobalUserService = Depends(get_global_user_service),
) -> dict:
    """Fetch a single Global User by internal id."""
    user = await service.get(user_id)
    return build_success_response(
        GlobalUserRead.model_validate(user).model_dump(mode="json", by_alias=True), request_id=_request_id(request)
    )


@router.patch("/{user_id}", summary="Update Global User metadata")
async def update_global_user(
    request: Request,
    user_id: uuid.UUID,
    payload: GlobalUserUpdate,
    principal: AuthorizedPrincipal = Depends(require_platform_permission("platform.user.update")),
    service: GlobalUserService = Depends(get_global_user_service),
) -> dict:
    """Update a Global User's display name, email, or metadata. Status is changed via the dedicated endpoint."""
    user = await service.update(user_id, payload, actor=principal)
    return build_success_response(
        GlobalUserRead.model_validate(user).model_dump(mode="json", by_alias=True),
        request_id=_request_id(request),
        message="Global User updated.",
    )


@router.patch("/{user_id}/status", summary="Change a Global User's status")
async def change_global_user_status(
    request: Request,
    user_id: uuid.UUID,
    payload: GlobalUserStatusUpdate,
    principal: AuthorizedPrincipal = Depends(require_platform_permission("platform.user.disable")),
    service: GlobalUserService = Depends(get_global_user_service),
) -> dict:
    """Change a Global User's status (ACTIVE/SUSPENDED/DISABLED). Never affects any local ERP account."""
    user = await service.set_status(user_id, payload.status, actor=principal)
    return build_success_response(
        GlobalUserRead.model_validate(user).model_dump(mode="json", by_alias=True),
        request_id=_request_id(request),
        message="Global User status updated.",
    )
