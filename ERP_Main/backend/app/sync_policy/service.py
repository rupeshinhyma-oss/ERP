"""
Entity Synchronization Policy Service (Phase 8A).

Enforces business rules, invariant validation, conflict detection,
and audit trail generation for the EntitySyncPolicy registry.
"""

from __future__ import annotations

import json
import uuid
from collections.abc import Sequence

from app.core.exceptions import (
    BadRequestException,
    ConflictException,
    NotFoundException,
    ValidationException,
)
from app.erp_registry.repository import ErpInstanceRepository
from app.global_audit.models import AuditActorType, AuditEventType
from app.global_audit.service import GlobalAuditService
from app.sync_policy.enums import (
    APPROVED_ENTITY_TYPES,
    FORBIDDEN_ENTITY_TYPES,
    SyncDirection,
    SyncOwnershipStrategy,
    SyncPolicyStatus,
)
from app.sync_policy.models import EntitySyncPolicy
from app.sync_policy.repository import EntitySyncPolicyRepository
from app.sync_policy.schemas import (
    AuthoritativeOwnerResolution,
    EntitySyncPolicyCreate,
    EntitySyncPolicyRead,
    EntitySyncPolicyStateUpdate,
    EntitySyncPolicyUpdate,
)


class EntitySyncPolicyService:
    """Service layer coordinating EntitySyncPolicy lifecycle and domain rules."""

    def __init__(
        self,
        repository: EntitySyncPolicyRepository,
        erp_instance_repository: ErpInstanceRepository,
        audit: GlobalAuditService | None = None,
    ) -> None:
        self.repository = repository
        self.erp_instance_repository = erp_instance_repository
        self.audit = audit

    async def create_policy(
        self,
        payload: EntitySyncPolicyCreate,
        *,
        actor_id: uuid.UUID | None = None,
        actor_label: str | None = None,
    ) -> EntitySyncPolicy:
        """Create and persist a new synchronization policy after invariant verification."""
        # 1. Reject source == target
        if payload.source_erp_id == payload.target_erp_id:
            raise BadRequestException("source_erp_id and target_erp_id cannot refer to the same ERP node.")

        # 2. Verify source and target ERP nodes exist in registry
        source_erp = await self.erp_instance_repository.get_by_id(payload.source_erp_id)
        if source_erp is None:
            raise NotFoundException(f"Source ERP node with ID {payload.source_erp_id} not found.")

        target_erp = await self.erp_instance_repository.get_by_id(payload.target_erp_id)
        if target_erp is None:
            raise NotFoundException(f"Target ERP node with ID {payload.target_erp_id} not found.")

        # 3. Entity type boundary enforcement
        norm_entity = payload.entity_type.strip().lower()
        if norm_entity in FORBIDDEN_ENTITY_TYPES:
            raise ValidationException(
                f"Entity type '{norm_entity}' is a high-risk financial/accounting entity and is forbidden in this pilot."
            )
        if norm_entity not in APPROVED_ENTITY_TYPES:
            allowed = ", ".join(sorted(APPROVED_ENTITY_TYPES))
            raise ValidationException(
                f"Entity type '{norm_entity}' is not an approved master-data entity. Allowed: {allowed}"
            )

        # 4. Resolve authoritative owner ERP ID according to ownership strategy
        authoritative_owner_id = payload.authoritative_owner_erp_id
        if payload.ownership_strategy in (SyncOwnershipStrategy.SOURCE_OWNED, SyncOwnershipStrategy.SOURCE_AUTHORITATIVE):
            authoritative_owner_id = payload.source_erp_id
        elif payload.ownership_strategy in (SyncOwnershipStrategy.TARGET_OWNED, SyncOwnershipStrategy.TARGET_AUTHORITATIVE):
            authoritative_owner_id = payload.target_erp_id
        elif payload.ownership_strategy in (SyncOwnershipStrategy.SHARED_MANUAL, SyncOwnershipStrategy.SHARED, SyncOwnershipStrategy.MANUAL_CONFLICT):
            if authoritative_owner_id is not None:
                owner_erp = await self.erp_instance_repository.get_by_id(authoritative_owner_id)
                if owner_erp is None:
                    raise NotFoundException(f"Authoritative referee ERP with ID {authoritative_owner_id} not found.")

        # 5. Active policy uniqueness and conflict prevention
        if payload.enabled and payload.status == SyncPolicyStatus.ACTIVE:
            conflicting = await self.repository.find_conflicting_active_policy(
                source_erp_id=payload.source_erp_id,
                target_erp_id=payload.target_erp_id,
                entity_type=norm_entity,
            )
            if conflicting is not None:
                raise ConflictException(
                    f"An active synchronization policy already exists between these ERP nodes for entity type "
                    f"'{norm_entity}' (conflicting policy id: {conflicting.id}). Disable the existing active policy first."
                )

        # 6. Prepare custom config
        custom_cfg_str = None
        if payload.custom_config is not None:
            custom_cfg_str = json.dumps(payload.custom_config)

        # 7. Construct and persist model
        policy = EntitySyncPolicy(
            source_erp_id=payload.source_erp_id,
            target_erp_id=payload.target_erp_id,
            source_module=payload.source_module,
            target_module=payload.target_module,
            entity_type=norm_entity,
            authoritative_owner_erp_id=authoritative_owner_id,
            ownership_strategy=payload.ownership_strategy,
            direction=payload.direction,
            conflict_strategy=payload.conflict_strategy,
            delete_strategy=payload.delete_strategy,
            version_strategy=payload.version_strategy,
            status=payload.status,
            enabled=payload.enabled,
            description=payload.description,
            custom_config=custom_cfg_str,
            created_by=actor_id,
            updated_by=actor_id,
        )
        policy.source_erp = source_erp
        policy.target_erp = target_erp
        if authoritative_owner_id == payload.source_erp_id:
            policy.authoritative_owner_erp = source_erp
        elif authoritative_owner_id == payload.target_erp_id:
            policy.authoritative_owner_erp = target_erp
        elif authoritative_owner_id is not None:
            policy.authoritative_owner_erp = await self.erp_instance_repository.get_by_id(authoritative_owner_id)

        saved = await self.repository.create(policy)

        # 8. Record audit log
        if self.audit is not None:
            await self.audit.record(
                event_type=AuditEventType.SYNC_POLICY_CREATED,
                actor_type=AuditActorType.HUMAN_ADMIN if actor_id else AuditActorType.SYSTEM,
                actor_id=actor_id,
                actor_label=actor_label or "system",
                target_type="entity_sync_policy",
                target_id=saved.id,
                details={
                    "entity_type": saved.entity_type,
                    "source_erp_id": str(saved.source_erp_id),
                    "target_erp_id": str(saved.target_erp_id),
                    "ownership_strategy": saved.ownership_strategy.value,
                    "direction": saved.direction.value,
                    "conflict_strategy": saved.conflict_strategy.value,
                    "delete_strategy": saved.delete_strategy.value,
                    "version_strategy": saved.version_strategy.value,
                    "status": saved.status.value,
                    "enabled": saved.enabled,
                },
            )

        return saved

    async def get_policy(self, policy_id: uuid.UUID) -> EntitySyncPolicy:
        """Retrieve a policy by ID or raise NotFoundException."""
        policy = await self.repository.get_by_id(policy_id)
        if policy is None:
            raise NotFoundException(f"EntitySyncPolicy with ID {policy_id} not found.")
        return policy

    async def list_policies(
        self,
        *,
        source_erp_id: uuid.UUID | None = None,
        target_erp_id: uuid.UUID | None = None,
        entity_type: str | None = None,
        status: SyncPolicyStatus | None = None,
        enabled: bool | None = None,
        limit: int = 100,
        offset: int = 0,
    ) -> Sequence[EntitySyncPolicy]:
        """List policies matching criteria."""
        return await self.repository.list_policies(
            source_erp_id=source_erp_id,
            target_erp_id=target_erp_id,
            entity_type=entity_type,
            status=status,
            enabled=enabled,
            limit=limit,
            offset=offset,
        )

    async def count_policies(
        self,
        *,
        source_erp_id: uuid.UUID | None = None,
        target_erp_id: uuid.UUID | None = None,
        entity_type: str | None = None,
        status: SyncPolicyStatus | None = None,
        enabled: bool | None = None,
    ) -> int:
        """Count total policies matching criteria."""
        return await self.repository.count_policies(
            source_erp_id=source_erp_id,
            target_erp_id=target_erp_id,
            entity_type=entity_type,
            status=status,
            enabled=enabled,
        )

    async def update_policy(
        self,
        policy_id: uuid.UUID,
        payload: EntitySyncPolicyUpdate,
        *,
        actor_id: uuid.UUID | None = None,
        actor_label: str | None = None,
    ) -> EntitySyncPolicy:
        """Update an existing policy with conflict and state invariant validation."""
        policy = await self.get_policy(policy_id)

        target_enabled = payload.enabled if payload.enabled is not None else policy.enabled
        target_status = payload.status if payload.status is not None else policy.status

        # If policy is/becomes active and enabled, check for contradictory active policies
        if target_enabled and target_status == SyncPolicyStatus.ACTIVE:
            conflicting = await self.repository.find_conflicting_active_policy(
                source_erp_id=policy.source_erp_id,
                target_erp_id=policy.target_erp_id,
                entity_type=policy.entity_type,
                exclude_id=policy.id,
            )
            if conflicting is not None:
                raise ConflictException(
                    f"Updating this policy to active conflicts with existing active policy {conflicting.id} "
                    f"for entity '{policy.entity_type}' between these ERP nodes."
                )

        if payload.source_module is not None:
            policy.source_module = payload.source_module
        if payload.target_module is not None:
            policy.target_module = payload.target_module

        if payload.ownership_strategy is not None:
            policy.ownership_strategy = payload.ownership_strategy
            if policy.ownership_strategy in (SyncOwnershipStrategy.SOURCE_OWNED, SyncOwnershipStrategy.SOURCE_AUTHORITATIVE):
                policy.authoritative_owner_erp_id = policy.source_erp_id
            elif policy.ownership_strategy in (SyncOwnershipStrategy.TARGET_OWNED, SyncOwnershipStrategy.TARGET_AUTHORITATIVE):
                policy.authoritative_owner_erp_id = policy.target_erp_id
            elif payload.authoritative_owner_erp_id is not None:
                policy.authoritative_owner_erp_id = payload.authoritative_owner_erp_id

        if payload.direction is not None:
            policy.direction = payload.direction
        if payload.conflict_strategy is not None:
            policy.conflict_strategy = payload.conflict_strategy
        if payload.delete_strategy is not None:
            policy.delete_strategy = payload.delete_strategy
        if payload.version_strategy is not None:
            policy.version_strategy = payload.version_strategy
        if payload.status is not None:
            policy.status = payload.status
        if payload.enabled is not None:
            policy.enabled = payload.enabled
        if payload.description is not None:
            policy.description = payload.description
        if payload.custom_config is not None:
            policy.custom_config = json.dumps(payload.custom_config)

        policy.updated_by = actor_id
        updated = await self.repository.update(policy)

        if self.audit is not None:
            await self.audit.record(
                event_type=AuditEventType.SYNC_POLICY_UPDATED,
                actor_type=AuditActorType.HUMAN_ADMIN if actor_id else AuditActorType.SYSTEM,
                actor_id=actor_id,
                actor_label=actor_label or "system",
                target_type="entity_sync_policy",
                target_id=updated.id,
                details={
                    "status": updated.status.value,
                    "enabled": updated.enabled,
                    "ownership_strategy": updated.ownership_strategy.value,
                    "direction": updated.direction.value,
                },
            )

        return updated

    async def set_policy_state(
        self,
        policy_id: uuid.UUID,
        payload: EntitySyncPolicyStateUpdate,
        *,
        actor_id: uuid.UUID | None = None,
        actor_label: str | None = None,
    ) -> EntitySyncPolicy:
        """Enable or disable a policy with active conflict checking."""
        policy = await self.get_policy(policy_id)

        target_status = payload.status or (SyncPolicyStatus.ACTIVE if payload.enabled else SyncPolicyStatus.INACTIVE)

        if payload.enabled and target_status == SyncPolicyStatus.ACTIVE:
            conflicting = await self.repository.find_conflicting_active_policy(
                source_erp_id=policy.source_erp_id,
                target_erp_id=policy.target_erp_id,
                entity_type=policy.entity_type,
                exclude_id=policy.id,
            )
            if conflicting is not None:
                raise ConflictException(
                    f"Cannot enable policy: conflicting active policy {conflicting.id} already exists "
                    f"for entity '{policy.entity_type}'."
                )

        policy.enabled = payload.enabled
        policy.status = target_status
        policy.updated_by = actor_id
        updated = await self.repository.update(policy)

        if self.audit is not None:
            await self.audit.record(
                event_type=AuditEventType.SYNC_POLICY_STATE_CHANGED,
                actor_type=AuditActorType.HUMAN_ADMIN if actor_id else AuditActorType.SYSTEM,
                actor_id=actor_id,
                actor_label=actor_label or "system",
                target_type="entity_sync_policy",
                target_id=updated.id,
                details={
                    "enabled": updated.enabled,
                    "status": updated.status.value,
                    "reason": payload.reason,
                },
            )

        return updated

    def determine_authoritative_owner(self, policy: EntitySyncPolicy) -> uuid.UUID | None:
        """Return the authoritative ERP node UUID for an entity synchronization policy."""
        if policy.ownership_strategy == SyncOwnershipStrategy.SOURCE_OWNED:
            return policy.source_erp_id
        if policy.ownership_strategy == SyncOwnershipStrategy.TARGET_OWNED:
            return policy.target_erp_id
        return policy.authoritative_owner_erp_id

    async def resolve_sync_policy(
        self,
        source_erp_id: uuid.UUID,
        target_erp_id: uuid.UUID,
        entity_type: str,
    ) -> AuthoritativeOwnerResolution:
        """
        Query the active policy between two ERP nodes for a given entity type,
        determining authoritative ownership, flow direction, and conflict rules.
        """
        norm_entity = entity_type.strip().lower()
        active = await self.repository.find_active_policy(
            source_erp_id=source_erp_id,
            target_erp_id=target_erp_id,
            entity_type=norm_entity,
        )

        # If no forward policy, check if there is a reverse bidirectional policy
        if active is None:
            reverse = await self.repository.find_active_policy(
                source_erp_id=target_erp_id,
                target_erp_id=source_erp_id,
                entity_type=norm_entity,
            )
            if reverse is not None and reverse.direction == SyncDirection.BIDIRECTIONAL:
                active = reverse

        if active is None:
            return AuthoritativeOwnerResolution(
                entity_type=norm_entity,
                source_erp_id=source_erp_id,
                target_erp_id=target_erp_id,
                has_active_policy=False,
                enabled=False,
            )

        owner_id = self.determine_authoritative_owner(active)
        owner_key = None
        if active.authoritative_owner_erp:
            owner_key = active.authoritative_owner_erp.key
        elif owner_id == active.source_erp_id and active.source_erp:
            owner_key = active.source_erp.key
        elif owner_id == active.target_erp_id and active.target_erp:
            owner_key = active.target_erp.key

        return AuthoritativeOwnerResolution(
            entity_type=norm_entity,
            source_erp_id=source_erp_id,
            target_erp_id=target_erp_id,
            has_active_policy=True,
            policy_id=active.id,
            authoritative_owner_erp_id=owner_id,
            authoritative_owner_erp_key=owner_key,
            ownership_strategy=active.ownership_strategy,
            direction=active.direction,
            conflict_strategy=active.conflict_strategy,
            delete_strategy=active.delete_strategy,
            version_strategy=active.version_strategy,
            enabled=active.enabled,
        )
