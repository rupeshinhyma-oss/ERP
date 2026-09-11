"""
Platform Authorization Routes.

All routes here require `platform.system.manage` (satisfied by any
active PlatformAdmin, or a GlobalUser holding that permission) -- role/
permission/assignment administration is itself a privileged operation,
not open to every authenticated caller (Phase 5 Section 17).
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Request, status

from app.core.responses import build_success_response
from app.platform_authz.dependencies import (
    AuthorizedPrincipal,
    get_platform_authz_service,
    require_platform_permission,
)
from app.platform_authz.schemas import (
    EffectivePermissionsResponse,
    PlatformPermissionCreate,
    PlatformPermissionRead,
    PlatformRoleAssignmentCreate,
    PlatformRoleAssignmentRead,
    PlatformRoleCreate,
    PlatformRoleRead,
    PlatformRoleUpdate,
    RolePermissionAssign,
)
from app.platform_authz.service import PlatformAuthzService

router = APIRouter(prefix="/global/authz", tags=["Platform Authorization"])

_MANAGE = "platform.system.manage"


def _request_id(request: Request) -> str:
    """Return the request's correlation ID set by `RequestIdMiddleware`."""
    return getattr(request.state, "request_id", "")


def _role_to_dict(role) -> dict:
    """Build a role response dict including its currently-granted permission keys."""
    return {
        "id": str(role.id),
        "role_key": role.role_key,
        "display_name": role.display_name,
        "description": role.description,
        "is_active": role.is_active,
        "permission_keys": sorted(link.permission.permission_key for link in role.permission_links),
        "created_at": role.created_at.isoformat(),
        "updated_at": role.updated_at.isoformat(),
    }


def _assignment_to_dict(assignment) -> dict:
    """Build an assignment response dict, resolving the role's own key for readability."""
    return {
        "id": str(assignment.id),
        "global_user_id": str(assignment.global_user_id),
        "role_id": str(assignment.role_id),
        "role_key": assignment.role.role_key,
        "scope": assignment.scope.value,
        "erp_instance_id": str(assignment.erp_instance_id) if assignment.erp_instance_id else None,
        "is_active": assignment.is_active,
        "assigned_by": str(assignment.assigned_by) if assignment.assigned_by else None,
        "revoked_at": assignment.revoked_at.isoformat() if assignment.revoked_at else None,
        "revoked_by": str(assignment.revoked_by) if assignment.revoked_by else None,
        "expires_at": assignment.expires_at.isoformat() if assignment.expires_at else None,
        "created_at": assignment.created_at.isoformat(),
    }


@router.post("/permissions", status_code=status.HTTP_201_CREATED, summary="Define a new platform permission")
async def create_permission(
    request: Request,
    payload: PlatformPermissionCreate,
    principal: AuthorizedPrincipal = Depends(require_platform_permission(_MANAGE)),
    service: PlatformAuthzService = Depends(get_platform_authz_service),
) -> dict:
    """Define a new platform permission key."""
    permission = await service.create_permission(
        payload, actor_id=principal.principal_id, actor_label=principal.principal_label
    )
    return build_success_response(
        PlatformPermissionRead.model_validate(permission).model_dump(mode="json"), request_id=_request_id(request)
    )


@router.get("/permissions", summary="List every defined platform permission")
async def list_permissions(
    request: Request,
    principal: AuthorizedPrincipal = Depends(require_platform_permission(_MANAGE)),
    service: PlatformAuthzService = Depends(get_platform_authz_service),
) -> dict:
    """List every defined platform permission."""
    permissions = await service.list_permissions()
    data = [PlatformPermissionRead.model_validate(p).model_dump(mode="json") for p in permissions]
    return build_success_response(data, request_id=_request_id(request))


@router.post("/roles", status_code=status.HTTP_201_CREATED, summary="Create a new platform role")
async def create_role(
    request: Request,
    payload: PlatformRoleCreate,
    principal: AuthorizedPrincipal = Depends(require_platform_permission(_MANAGE)),
    service: PlatformAuthzService = Depends(get_platform_authz_service),
) -> dict:
    """Create a new platform role. Starts with no permissions granted -- use POST .../permissions to grant them."""
    role = await service.create_role(payload, actor_id=principal.principal_id, actor_label=principal.principal_label)
    return build_success_response(_role_to_dict(role), request_id=_request_id(request))


@router.get("/roles", summary="List every defined platform role")
async def list_roles(
    request: Request,
    principal: AuthorizedPrincipal = Depends(require_platform_permission(_MANAGE)),
    service: PlatformAuthzService = Depends(get_platform_authz_service),
) -> dict:
    """List every defined platform role, including each one's granted permission keys."""
    roles = await service.list_roles()
    return build_success_response([_role_to_dict(r) for r in roles], request_id=_request_id(request))


@router.get("/roles/{role_id}", summary="Fetch a single platform role")
async def get_role(
    request: Request,
    role_id: uuid.UUID,
    principal: AuthorizedPrincipal = Depends(require_platform_permission(_MANAGE)),
    service: PlatformAuthzService = Depends(get_platform_authz_service),
) -> dict:
    """Fetch a single platform role by id."""
    role = await service.get_role(role_id)
    return build_success_response(_role_to_dict(role), request_id=_request_id(request))


@router.patch("/roles/{role_id}", summary="Update a platform role's metadata or active flag")
async def update_role(
    request: Request,
    role_id: uuid.UUID,
    payload: PlatformRoleUpdate,
    principal: AuthorizedPrincipal = Depends(require_platform_permission(_MANAGE)),
    service: PlatformAuthzService = Depends(get_platform_authz_service),
) -> dict:
    """Update a role's display name, description, or active flag."""
    role = await service.update_role(
        role_id, payload, actor_id=principal.principal_id, actor_label=principal.principal_label
    )
    return build_success_response(
        _role_to_dict(role), request_id=_request_id(request), message="Platform role updated."
    )


@router.post("/roles/{role_id}/permissions", summary="Grant a permission to a role")
async def grant_permission_to_role(
    request: Request,
    role_id: uuid.UUID,
    payload: RolePermissionAssign,
    principal: AuthorizedPrincipal = Depends(require_platform_permission(_MANAGE)),
    service: PlatformAuthzService = Depends(get_platform_authz_service),
) -> dict:
    """Grant a permission to a role. Idempotent -- granting an already-held permission succeeds without change."""
    await service.grant_permission_to_role(
        role_id, payload.permission_key, actor_id=principal.principal_id, actor_label=principal.principal_label
    )
    role = await service.get_role(role_id)
    return build_success_response(
        _role_to_dict(role), request_id=_request_id(request), message="Permission granted to role."
    )


@router.delete("/roles/{role_id}/permissions/{permission_key}", summary="Revoke a permission from a role")
async def revoke_permission_from_role(
    request: Request,
    role_id: uuid.UUID,
    permission_key: str,
    principal: AuthorizedPrincipal = Depends(require_platform_permission(_MANAGE)),
    service: PlatformAuthzService = Depends(get_platform_authz_service),
) -> dict:
    """Revoke a permission from a role. Idempotent."""
    await service.revoke_permission_from_role(
        role_id, permission_key, actor_id=principal.principal_id, actor_label=principal.principal_label
    )
    role = await service.get_role(role_id)
    return build_success_response(
        _role_to_dict(role), request_id=_request_id(request), message="Permission revoked from role."
    )


@router.post(
    "/users/{global_user_id}/roles",
    status_code=status.HTTP_201_CREATED,
    summary="Assign a platform role to a Global User",
)
async def assign_role(
    request: Request,
    global_user_id: uuid.UUID,
    payload: PlatformRoleAssignmentCreate,
    principal: AuthorizedPrincipal = Depends(require_platform_permission(_MANAGE)),
    service: PlatformAuthzService = Depends(get_platform_authz_service),
) -> dict:
    """Assign a platform role to a Global User, optionally scoped to one ERP."""
    assignment = await service.assign_role(
        global_user_id, payload, actor_id=principal.principal_id, actor_label=principal.principal_label
    )
    return build_success_response(_assignment_to_dict(assignment), request_id=_request_id(request))


@router.get("/users/{global_user_id}/roles", summary="List a Global User's platform role assignments")
async def list_user_assignments(
    request: Request,
    global_user_id: uuid.UUID,
    principal: AuthorizedPrincipal = Depends(require_platform_permission(_MANAGE)),
    service: PlatformAuthzService = Depends(get_platform_authz_service),
) -> dict:
    """List every platform role assignment (active or not) for a Global User."""
    assignments = await service.list_assignments_for_user(global_user_id)
    return build_success_response([_assignment_to_dict(a) for a in assignments], request_id=_request_id(request))


@router.post("/assignments/{assignment_id}/revoke", summary="Revoke a platform role assignment")
async def revoke_assignment(
    request: Request,
    assignment_id: uuid.UUID,
    principal: AuthorizedPrincipal = Depends(require_platform_permission(_MANAGE)),
    service: PlatformAuthzService = Depends(get_platform_authz_service),
) -> dict:
    """Revoke a platform role assignment. The row is kept for audit history; only its active flag changes."""
    assignment = await service.revoke_assignment(
        assignment_id, actor_id=principal.principal_id, actor_label=principal.principal_label
    )
    return build_success_response(
        _assignment_to_dict(assignment), request_id=_request_id(request), message="Role assignment revoked."
    )


@router.get(
    "/users/{global_user_id}/effective-permissions",
    summary="Compute a Global User's effective platform permissions",
)
async def get_effective_permissions(
    request: Request,
    global_user_id: uuid.UUID,
    principal: AuthorizedPrincipal = Depends(require_platform_permission(_MANAGE)),
    service: PlatformAuthzService = Depends(get_platform_authz_service),
) -> dict:
    """Compute and return a Global User's currently-effective platform permissions (global + per-ERP)."""
    global_permissions, erp_permissions = await service.compute_effective_permissions(global_user_id)
    response = EffectivePermissionsResponse(
        global_user_id=global_user_id,
        global_permissions=sorted(global_permissions),
        erp_permissions={str(erp_id): sorted(perms) for erp_id, perms in erp_permissions.items()},
    )
    return build_success_response(response.model_dump(mode="json"), request_id=_request_id(request))
