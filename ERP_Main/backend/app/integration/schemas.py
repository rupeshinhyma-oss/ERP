"""Integration Control-Plane Pydantic Schemas (Phase 6)."""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, Field, model_validator

from app.integration.models import InboxEventStatus, IntegrationTarget


class IntegrationSubscriptionCreate(BaseModel):
    """Payload to create a routing subscription (Phase 6 Section 48)."""

    event_type: str = Field(..., min_length=1, max_length=150)
    source_erp_id: uuid.UUID
    target_kind: IntegrationTarget = IntegrationTarget.SPECIFIC_ERP
    target_erp_id: uuid.UUID | None = None
    required_capability: str | None = Field(default=None, max_length=100)

    @model_validator(mode="after")
    def _validate_target_consistency(self) -> "IntegrationSubscriptionCreate":
        """Enforce target_erp_id presence/absence matches the declared target_kind."""
        if self.target_kind == IntegrationTarget.SPECIFIC_ERP and self.target_erp_id is None:
            raise ValueError("target_erp_id is required when target_kind=SPECIFIC_ERP.")
        if self.target_kind == IntegrationTarget.BROADCAST and self.target_erp_id is not None:
            raise ValueError("target_erp_id must be omitted when target_kind=BROADCAST.")
        return self


class IntegrationSubscriptionUpdate(BaseModel):
    """Payload to update a subscription's enabled flag or required capability."""

    enabled: bool | None = None
    required_capability: str | None = Field(default=None, max_length=100)


class IntegrationSubscriptionRead(BaseModel):
    """A subscription as returned by the API."""

    id: uuid.UUID
    event_type: str
    source_erp_id: uuid.UUID
    target_kind: IntegrationTarget
    target_erp_id: uuid.UUID | None
    required_capability: str | None
    enabled: bool
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class IncomingEventEnvelope(BaseModel):
    """
    The standard cross-ERP event envelope (Phase 6 Section 4), as POSTed by a producer ERP.

    `source_erp` in the wire payload is NEVER trusted directly (Section
    22: "Do not infer source solely from the HTTP endpoint. Validate it
    server-side.") -- the route handler re-derives the actual source ERP
    from the caller's verified service credential and rejects the
    request if the two disagree; see `routes.py::receive_event`.
    """

    event_id: uuid.UUID
    event_type: str = Field(..., min_length=1, max_length=150)
    event_version: int = Field(default=1, ge=1)
    occurred_at: datetime
    source_erp: str = Field(..., min_length=1, max_length=50)
    source_entity_type: str = Field(..., min_length=1, max_length=100)
    source_entity_id: uuid.UUID
    correlation_id: uuid.UUID
    causation_id: uuid.UUID | None = None
    actor_type: str = Field(..., pattern="^(user|service|system)$")
    actor_id: uuid.UUID | None = None
    target: str = Field(default="broadcast", max_length=50)
    payload: dict = Field(default_factory=dict)
    event_metadata: dict = Field(default_factory=dict, alias="metadata")

    model_config = {"populate_by_name": True}


class IngestResult(BaseModel):
    """Result of ingesting one event: whether it was newly recorded, and its resolved routing status."""

    event_id: uuid.UUID
    inbox_event_id: uuid.UUID
    duplicate: bool
    status: InboxEventStatus
    routed_to: list[str] = Field(default_factory=list)


class InboxEventRead(BaseModel):
    """An inbox event as returned by the admin API."""

    id: uuid.UUID
    event_id: uuid.UUID
    event_type: str
    event_version: int
    source_erp_id: uuid.UUID
    source_entity_type: str
    source_entity_id: uuid.UUID
    correlation_id: uuid.UUID
    causation_id: uuid.UUID | None
    status: InboxEventStatus
    routed_to: list[str] = Field(default_factory=list)
    attempt_count: int
    last_error: str | None
    created_at: datetime

    model_config = {"from_attributes": True}


class EntityMappingCreate(BaseModel):
    """Payload to create an explicit cross-ERP entity identity mapping (Phase 6/8 Section 30)."""

    source_erp_id: uuid.UUID
    source_entity_type: str = Field(..., min_length=1, max_length=100)
    source_entity_id: uuid.UUID
    target_erp_id: uuid.UUID
    target_entity_type: str = Field(..., min_length=1, max_length=100)
    target_entity_id: uuid.UUID
    status: str = Field(default="ACTIVE", max_length=30)
    source_version: int | None = None
    target_version: int | None = None
    last_synced_at: datetime | None = None
    correlation_id: uuid.UUID | None = None


class EntityMappingRead(BaseModel):
    """An entity mapping as returned by the API."""

    id: uuid.UUID
    source_erp_id: uuid.UUID
    source_entity_type: str
    source_entity_id: uuid.UUID
    target_erp_id: uuid.UUID
    target_entity_type: str
    target_entity_id: uuid.UUID
    status: str = "ACTIVE"
    source_version: int | None = None
    target_version: int | None = None
    last_synced_at: datetime | None = None
    correlation_id: uuid.UUID | None = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class DeadLetterRead(BaseModel):
    """A dead-letter entry as returned by the admin API."""

    id: uuid.UUID
    inbox_event_id: uuid.UUID
    event_id: uuid.UUID
    event_type: str
    source_erp_id: uuid.UUID
    attempt_count: int
    last_error: str
    failed_at: datetime
    replayed_at: datetime | None
    replayed_by: uuid.UUID | None

    model_config = {"from_attributes": True}
