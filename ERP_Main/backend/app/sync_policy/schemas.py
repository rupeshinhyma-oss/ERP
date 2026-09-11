"""
Entity Synchronization Policy Pydantic Schemas (Phase 8A).

Defines validation rules and API request/response structures for the
EntitySyncPolicy control-plane registry.
"""

from __future__ import annotations

import json
import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.sync_policy.enums import (
    APPROVED_ENTITY_TYPES,
    FORBIDDEN_ENTITY_TYPES,
    SyncConflictStrategy,
    SyncDeleteStrategy,
    SyncDirection,
    SyncOwnershipStrategy,
    SyncPolicyStatus,
    SyncVersionStrategy,
)


class EntitySyncPolicyBase(BaseModel):
    """Base fields shared across request and response schemas."""

    source_erp_id: uuid.UUID = Field(..., description="Originating ERP node UUID.")
    target_erp_id: uuid.UUID = Field(..., description="Destination ERP node UUID.")
    source_module: str | None = Field(default=None, max_length=100, description="Optional capability scope on source ERP.")
    target_module: str | None = Field(default=None, max_length=100, description="Optional capability scope on target ERP.")
    entity_type: str = Field(..., max_length=100, description="Domain entity type, e.g. 'buyer', 'supplier'.")
    authoritative_owner_erp_id: uuid.UUID | None = Field(
        default=None, description="ERP holding golden-record authority (defaults according to ownership_strategy)."
    )
    ownership_strategy: SyncOwnershipStrategy = Field(
        default=SyncOwnershipStrategy.SOURCE_OWNED, description="Authoritative ownership model."
    )
    direction: SyncDirection = Field(
        default=SyncDirection.SOURCE_TO_TARGET, description="Allowed synchronization flow direction."
    )
    conflict_strategy: SyncConflictStrategy = Field(
        default=SyncConflictStrategy.SOURCE_WINS, description="Conflict resolution behavior."
    )
    delete_strategy: SyncDeleteStrategy = Field(
        default=SyncDeleteStrategy.IGNORE_DELETE, description="Propagation behavior on deletion/archival."
    )
    version_strategy: SyncVersionStrategy = Field(
        default=SyncVersionStrategy.EVENT_VERSION, description="Version/order sequencing approach."
    )
    status: SyncPolicyStatus = Field(default=SyncPolicyStatus.ACTIVE, description="Lifecycle status.")
    enabled: bool = Field(default=True, description="Whether policy is actively operational.")
    description: str | None = Field(default=None, description="Human-readable rationale or operational notes.")
    custom_config: dict[str, Any] | None = Field(default=None, description="Custom JSON configuration parameters.")

    @field_validator("entity_type")
    @classmethod
    def validate_entity_type(cls, value: str) -> str:
        norm = value.strip().lower()
        if not norm:
            raise ValueError("entity_type cannot be empty.")
        if norm in FORBIDDEN_ENTITY_TYPES:
            raise ValueError(
                f"Entity type '{norm}' is classified as a high-risk entity and is forbidden from synchronization in this pilot."
            )
        if norm not in APPROVED_ENTITY_TYPES:
            allowed = ", ".join(sorted(APPROVED_ENTITY_TYPES))
            raise ValueError(f"Entity type '{norm}' is not an approved master-data entity type. Allowed: {allowed}")
        return norm

    @model_validator(mode="after")
    def validate_cross_field_rules(self) -> EntitySyncPolicyBase:
        if self.source_erp_id == self.target_erp_id:
            raise ValueError("source_erp_id and target_erp_id must be distinct ERP nodes.")

        # Validate ownership consistency
        if self.ownership_strategy == SyncOwnershipStrategy.SOURCE_OWNED:
            if self.authoritative_owner_erp_id is not None and self.authoritative_owner_erp_id != self.source_erp_id:
                raise ValueError("When ownership_strategy is SOURCE_OWNED, authoritative_owner_erp_id must match source_erp_id.")
        elif self.ownership_strategy == SyncOwnershipStrategy.TARGET_OWNED:
            if self.authoritative_owner_erp_id is not None and self.authoritative_owner_erp_id != self.target_erp_id:
                raise ValueError("When ownership_strategy is TARGET_OWNED, authoritative_owner_erp_id must match target_erp_id.")

        # Validate direction and enabled combinations
        if self.enabled and not self.direction:
            raise ValueError("An enabled policy must specify a valid synchronization direction.")

        return self


class EntitySyncPolicyCreate(EntitySyncPolicyBase):
    """Payload for creating a new EntitySyncPolicy."""

    pass


class EntitySyncPolicyUpdate(BaseModel):
    """Payload for modifying an existing EntitySyncPolicy."""

    source_module: str | None = None
    target_module: str | None = None
    authoritative_owner_erp_id: uuid.UUID | None = None
    ownership_strategy: SyncOwnershipStrategy | None = None
    direction: SyncDirection | None = None
    conflict_strategy: SyncConflictStrategy | None = None
    delete_strategy: SyncDeleteStrategy | None = None
    version_strategy: SyncVersionStrategy | None = None
    status: SyncPolicyStatus | None = None
    enabled: bool | None = None
    description: str | None = None
    custom_config: dict[str, Any] | None = None


class EntitySyncPolicyStateUpdate(BaseModel):
    """Payload for toggling policy enabled state or status."""

    enabled: bool = Field(..., description="Target enabled state.")
    status: SyncPolicyStatus | None = Field(default=None, description="Optional new lifecycle status.")
    reason: str | None = Field(default=None, description="Optional operator comment for audit log.")


class EntitySyncPolicyRead(BaseModel):
    """API view model for an EntitySyncPolicy."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    source_erp_id: uuid.UUID
    target_erp_id: uuid.UUID
    source_erp_key: str | None = None
    target_erp_key: str | None = None
    source_module: str | None = None
    target_module: str | None = None
    entity_type: str
    authoritative_owner_erp_id: uuid.UUID | None = None
    authoritative_owner_erp_key: str | None = None
    ownership_strategy: SyncOwnershipStrategy
    direction: SyncDirection
    conflict_strategy: SyncConflictStrategy
    delete_strategy: SyncDeleteStrategy
    version_strategy: SyncVersionStrategy
    status: SyncPolicyStatus
    enabled: bool
    description: str | None = None
    custom_config: dict[str, Any] | None = None
    created_by: uuid.UUID | None = None
    updated_by: uuid.UUID | None = None
    created_at: datetime
    updated_at: datetime


class AuthoritativeOwnerResolution(BaseModel):
    """Resolution query result describing authoritative ownership for an entity type."""

    entity_type: str
    source_erp_id: uuid.UUID
    target_erp_id: uuid.UUID
    has_active_policy: bool
    policy_id: uuid.UUID | None = None
    authoritative_owner_erp_id: uuid.UUID | None = None
    authoritative_owner_erp_key: str | None = None
    ownership_strategy: SyncOwnershipStrategy | None = None
    direction: SyncDirection | None = None
    conflict_strategy: SyncConflictStrategy | None = None
    delete_strategy: SyncDeleteStrategy | None = None
    version_strategy: SyncVersionStrategy | None = None
    enabled: bool = False
