"""
Entity Synchronization Policy Admin Routes (Phase 8A).

Administrative control-plane endpoints for creating, listing, inspecting, updating,
and enabling/disabling cross-ERP EntitySyncPolicy records, and resolving authoritative
ownership for synchronization pipelines.
"""

from __future__ import annotations

import json
import uuid

from fastapi import APIRouter, Depends, Query, Request, status

from app.core.responses import build_success_response
from app.platform_authz.dependencies import AuthorizedPrincipal, require_platform_permission
from app.sync_policy.dependencies import get_sync_policy_service
from app.sync_policy.enums import SyncPolicyStatus
from app.sync_policy.models import EntitySyncPolicy
from app.sync_policy.schemas import (
    AuthoritativeOwnerResolution,
    EntitySyncPolicyCreate,
    EntitySyncPolicyRead,
    EntitySyncPolicyStateUpdate,
    EntitySyncPolicyUpdate,
)
from app.sync_policy.service import EntitySyncPolicyService

router = APIRouter(prefix="/global/sync-policies", tags=["Entity Sync Policy Administration"])

_MANAGE = "platform.system.manage"


def _request_id(request: Request) -> str:
    """Return the request correlation ID set by RequestIdMiddleware."""
    return getattr(request.state, "request_id", "")


def _to_read_dto(policy: EntitySyncPolicy) -> dict:
    """Map an EntitySyncPolicy ORM instance into an API dictionary representation."""
    custom_cfg = None
    if policy.custom_config:
        try:
            custom_cfg = json.loads(policy.custom_config)
        except Exception:
            custom_cfg = {"raw": policy.custom_config}

    source_key = None
    if "source_erp" in policy.__dict__ and policy.source_erp:
        source_key = policy.source_erp.key
    target_key = None
    if "target_erp" in policy.__dict__ and policy.target_erp:
        target_key = policy.target_erp.key
    owner_key = None
    if "authoritative_owner_erp" in policy.__dict__ and policy.authoritative_owner_erp:
        owner_key = policy.authoritative_owner_erp.key
    elif policy.authoritative_owner_erp_id == policy.source_erp_id:
        owner_key = source_key
    elif policy.authoritative_owner_erp_id == policy.target_erp_id:
        owner_key = target_key

    dto = EntitySyncPolicyRead(
        id=policy.id,
        source_erp_id=policy.source_erp_id,
        target_erp_id=policy.target_erp_id,
        source_erp_key=source_key,
        target_erp_key=target_key,
        source_module=policy.source_module,
        target_module=policy.target_module,
        entity_type=policy.entity_type,
        authoritative_owner_erp_id=policy.authoritative_owner_erp_id,
        authoritative_owner_erp_key=owner_key,
        ownership_strategy=policy.ownership_strategy,
        direction=policy.direction,
        conflict_strategy=policy.conflict_strategy,
        delete_strategy=policy.delete_strategy,
        version_strategy=policy.version_strategy,
        status=policy.status,
        enabled=policy.enabled,
        description=policy.description,
        custom_config=custom_cfg,
        created_by=policy.created_by,
        updated_by=policy.updated_by,
        created_at=policy.created_at,
        updated_at=policy.updated_at,
    )
    return dto.model_dump(mode="json")


@router.post(
    "",
    status_code=status.HTTP_201_CREATED,
    summary="Create a cross-ERP entity synchronization policy",
)
async def create_policy(
    request: Request,
    payload: EntitySyncPolicyCreate,
    principal: AuthorizedPrincipal = Depends(require_platform_permission(_MANAGE)),
    service: EntitySyncPolicyService = Depends(get_sync_policy_service),
) -> dict:
    """
    Create an authoritative synchronization policy between two ERP nodes.

    Requires platform administrator authorization (`platform.system.manage`).
    Prevents duplicate active policies between the same nodes for the given entity type.
    """
    policy = await service.create_policy(
        payload,
        actor_id=principal.principal_id,
        actor_label=principal.principal_label,
    )
    return build_success_response(
        _to_read_dto(policy),
        request_id=_request_id(request),
        message="Entity synchronization policy created successfully.",
    )


@router.get(
    "",
    summary="List entity synchronization policies",
)
async def list_policies(
    request: Request,
    source_erp_id: uuid.UUID | None = Query(default=None, description="Filter by source ERP ID"),
    target_erp_id: uuid.UUID | None = Query(default=None, description="Filter by target ERP ID"),
    entity_type: str | None = Query(default=None, description="Filter by domain entity type"),
    status_filter: SyncPolicyStatus | None = Query(default=None, alias="status", description="Filter by status"),
    enabled: bool | None = Query(default=None, description="Filter by enabled state"),
    limit: int = Query(default=100, ge=1, le=500, description="Page limit"),
    offset: int = Query(default=0, ge=0, description="Page offset"),
    principal: AuthorizedPrincipal = Depends(require_platform_permission(_MANAGE)),
    service: EntitySyncPolicyService = Depends(get_sync_policy_service),
) -> dict:
    """List registered entity synchronization policies with filtering and pagination."""
    policies = await service.list_policies(
        source_erp_id=source_erp_id,
        target_erp_id=target_erp_id,
        entity_type=entity_type,
        status=status_filter,
        enabled=enabled,
        limit=limit,
        offset=offset,
    )
    total = await service.count_policies(
        source_erp_id=source_erp_id,
        target_erp_id=target_erp_id,
        entity_type=entity_type,
        status=status_filter,
        enabled=enabled,
    )
    data = [_to_read_dto(p) for p in policies]
    return build_success_response(
        {"items": data, "total": total, "limit": limit, "offset": offset},
        request_id=_request_id(request),
    )


@router.get(
    "/resolve",
    summary="Resolve active policy and authoritative owner for an entity",
)
async def resolve_policy(
    request: Request,
    source_erp_id: uuid.UUID = Query(..., description="Source ERP UUID"),
    target_erp_id: uuid.UUID = Query(..., description="Target ERP UUID"),
    entity_type: str = Query(..., description="Domain entity type, e.g. 'buyer'"),
    principal: AuthorizedPrincipal = Depends(require_platform_permission(_MANAGE)),
    service: EntitySyncPolicyService = Depends(get_sync_policy_service),
) -> dict:
    """
    Query the active synchronization policy between two nodes for an entity type,
    returning authoritative owner, flow direction, and conflict rules.
    """
    resolution = await service.resolve_sync_policy(
        source_erp_id=source_erp_id,
        target_erp_id=target_erp_id,
        entity_type=entity_type,
    )
    return build_success_response(
        resolution.model_dump(mode="json"),
        request_id=_request_id(request),
    )


@router.get(
    "/{policy_id}",
    summary="Get an entity synchronization policy by ID",
)
async def get_policy(
    request: Request,
    policy_id: uuid.UUID,
    principal: AuthorizedPrincipal = Depends(require_platform_permission(_MANAGE)),
    service: EntitySyncPolicyService = Depends(get_sync_policy_service),
) -> dict:
    """Retrieve details of a single entity synchronization policy."""
    policy = await service.get_policy(policy_id)
    return build_success_response(
        _to_read_dto(policy),
        request_id=_request_id(request),
    )


@router.put(
    "/{policy_id}",
    summary="Update an entity synchronization policy",
)
async def update_policy(
    request: Request,
    policy_id: uuid.UUID,
    payload: EntitySyncPolicyUpdate,
    principal: AuthorizedPrincipal = Depends(require_platform_permission(_MANAGE)),
    service: EntitySyncPolicyService = Depends(get_sync_policy_service),
) -> dict:
    """Update configuration or rules of an existing entity synchronization policy."""
    updated = await service.update_policy(
        policy_id,
        payload,
        actor_id=principal.principal_id,
        actor_label=principal.principal_label,
    )
    return build_success_response(
        _to_read_dto(updated),
        request_id=_request_id(request),
        message="Policy updated successfully.",
    )


@router.patch(
    "/{policy_id}/state",
    summary="Toggle policy enabled state or lifecycle status",
)
async def set_policy_state(
    request: Request,
    policy_id: uuid.UUID,
    payload: EntitySyncPolicyStateUpdate,
    principal: AuthorizedPrincipal = Depends(require_platform_permission(_MANAGE)),
    service: EntitySyncPolicyService = Depends(get_sync_policy_service),
) -> dict:
    """Enable or disable an entity synchronization policy."""
    updated = await service.set_policy_state(
        policy_id,
        payload,
        actor_id=principal.principal_id,
        actor_label=principal.principal_label,
    )
    return build_success_response(
        _to_read_dto(updated),
        request_id=_request_id(request),
        message=f"Policy state updated to enabled={updated.enabled}, status={updated.status.value}.",
    )
