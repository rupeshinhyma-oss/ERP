"""
Identity Linking Pydantic Schemas (Prompt 2).
"""

from __future__ import annotations

import uuid
from datetime import datetime
from enum import Enum

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from app.identity_linking.models import ConflictStatus, ConflictType


class IdentityMatchingState(str, Enum):
    """Result state of matching a local ERP user against GlobalUser identities."""

    EXACT_MATCH = "EXACT_MATCH"
    NO_MATCH = "NO_MATCH"
    AMBIGUOUS_MATCH = "AMBIGUOUS_MATCH"
    ALREADY_LINKED = "ALREADY_LINKED"
    CONFLICT = "CONFLICT"


class IdentityMatchResult(BaseModel):
    """Result of an identity matching and evaluation attempt."""

    state: IdentityMatchingState
    global_user_id: uuid.UUID | None = None
    membership_id: uuid.UUID | None = None
    conflict_id: uuid.UUID | None = None
    message: str


class IdentityConflictRead(BaseModel):
    """Representation of an identity conflict for administrator review."""

    id: uuid.UUID
    erp_instance_id: uuid.UUID
    local_user_id: str
    normalized_email: str
    status: ConflictStatus
    conflict_type: ConflictType
    candidate_global_user_ids: list[str]
    details_json: dict | None = None
    resolution_action: str | None = None
    resolved_by: uuid.UUID | None = None
    resolved_at: datetime | None = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ConflictResolutionAction(str, Enum):
    """Supported administrator actions for resolving an identity conflict."""

    LINK = "LINK"
    CREATE_NEW = "CREATE_NEW"
    REJECT = "REJECT"


class IdentityConflictResolveRequest(BaseModel):
    """Payload to resolve a pending identity conflict."""

    action: ConflictResolutionAction
    target_global_user_id: uuid.UUID | None = Field(
        default=None,
        description="Required if action is 'LINK': the specific GlobalUser to bind to this local user.",
    )
    notes: str | None = Field(default=None, max_length=500)


class GlobalUserProvisionRequest(BaseModel):
    """Payload to provision a GlobalUser into an ERP instance (Flow A)."""

    erp_instance_id: uuid.UUID
    target_organization_id: uuid.UUID | None = Field(
        default=None, description="Optional target organization context in the destination ERP."
    )
    notes: str | None = Field(default=None, max_length=500)


class DirectIdentityLinkRequest(BaseModel):
    """Payload to explicitly link an existing GlobalUser to an existing local ERP user."""

    global_user_id: uuid.UUID
    erp_instance_id: uuid.UUID
    local_user_id: str = Field(..., min_length=1, max_length=255)


class LinkedIdentityRead(BaseModel):
    """Representation of a linked identity across ERPs."""

    membership_id: uuid.UUID
    global_user_id: uuid.UUID
    erp_instance_id: uuid.UUID
    erp_key: str
    erp_name: str
    local_user_id: str
    status: str
    linked_at: datetime
    verified_at: datetime | None = None

    model_config = ConfigDict(from_attributes=True)
