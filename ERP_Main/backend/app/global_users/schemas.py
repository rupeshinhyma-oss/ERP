"""Global User Pydantic Schemas."""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, EmailStr, Field

from app.global_users.models import GlobalUserStatus


class GlobalUserCreate(BaseModel):
    """Payload to create a new Global User."""

    display_name: str = Field(..., min_length=1, max_length=200)
    primary_email: EmailStr
    external_identity_id: str | None = Field(default=None, max_length=255)
    metadata: dict | None = None


class GlobalUserUpdate(BaseModel):
    """
    Payload to update Global User metadata.

    `primary_email` IS updatable here (unlike an ERP's `key`, an email is
    not meant to be a permanent identifier) -- but status is changed only
    via the dedicated status-transition endpoints, not this general
    update, keeping status changes auditable as a distinct action.
    """

    display_name: str | None = Field(default=None, min_length=1, max_length=200)
    primary_email: EmailStr | None = None
    external_identity_id: str | None = Field(default=None, max_length=255)
    metadata: dict | None = None


class GlobalUserStatusUpdate(BaseModel):
    """Payload for the dedicated status-change endpoint."""

    status: GlobalUserStatus


class GlobalUserRead(BaseModel):
    """A Global User as returned by the API."""

    id: uuid.UUID
    display_name: str
    primary_email: str
    status: GlobalUserStatus
    external_identity_id: str | None
    metadata: dict | None = Field(validation_alias="metadata_json", serialization_alias="metadata")
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True, "populate_by_name": True}
