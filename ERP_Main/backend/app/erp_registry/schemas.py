"""
ERP Registry Pydantic Schemas.

Request/response contracts for the `erp_registry` API. Kept intentionally
narrow, matching what `models.py` actually stores in Phase 2.
"""

from __future__ import annotations

import re
import uuid
from datetime import datetime

from pydantic import BaseModel, Field, field_validator

from app.core.url_validator import validate_external_url
from app.erp_registry.models import ErpStatus

_KEY_PATTERN = re.compile(r"^[a-z][a-z0-9_]*$")


class ErpModuleCreate(BaseModel):
    """Payload for declaring a single module/capability on an ERP instance."""

    module_key: str = Field(..., min_length=1, max_length=100, description="Machine-readable key, e.g. 'crm'.")
    module_name: str = Field(..., min_length=1, max_length=150, description="Human-readable module name.")
    enabled: bool = True


class ErpModuleRead(ErpModuleCreate):
    """A module/capability as stored, including its own id."""

    id: uuid.UUID
    erp_instance_id: uuid.UUID

    model_config = {"from_attributes": True}


class ErpInstanceCreate(BaseModel):
    """Payload to register a new ERP instance."""

    key: str = Field(
        ...,
        min_length=1,
        max_length=50,
        description="Stable machine-readable key (e.g. 'yinglima'). Lowercase, letters/digits/underscore only.",
    )
    name: str = Field(..., min_length=1, max_length=200)
    display_name: str = Field(..., min_length=1, max_length=200)
    description: str | None = None
    status: ErpStatus = ErpStatus.INACTIVE
    base_url: str | None = Field(default=None, max_length=500)
    environment: str | None = Field(default=None, max_length=50)
    version: str | None = Field(default=None, max_length=50)

    @field_validator("key")
    @classmethod
    def _validate_key_format(cls, value: str) -> str:
        """Reject a key that isn't URL/config-safe before it ever reaches the service layer."""
        if not _KEY_PATTERN.match(value):
            raise ValueError(
                "key must be lowercase, start with a letter, and contain only letters, digits, and underscores."
            )
        return value

    @field_validator("base_url")
    @classmethod
    def _validate_base_url(cls, value: str | None) -> str | None:
        """Reject invalid URLs or SSRF targets for base_url."""
        if value is None:
            return None
        return validate_external_url(value)


class ErpInstanceUpdate(BaseModel):
    """
    Payload to update ERP instance metadata.

    `key` is deliberately absent: Phase 2 Step 4 requires the key to be
    stable and never changed once assigned. Renaming `display_name` never
    touches `key` (also required by Step 4).
    """

    name: str | None = Field(default=None, min_length=1, max_length=200)
    display_name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = None
    base_url: str | None = Field(default=None, max_length=500)
    environment: str | None = Field(default=None, max_length=50)
    version: str | None = Field(default=None, max_length=50)
    last_seen_at: datetime | None = None

    @field_validator("base_url")
    @classmethod
    def _validate_base_url(cls, value: str | None) -> str | None:
        """Reject invalid URLs or SSRF targets for base_url."""
        if value is None:
            return None
        return validate_external_url(value)


class ErpStatusUpdate(BaseModel):
    """Payload for the dedicated status-change endpoint."""

    status: ErpStatus


class ErpInstanceRead(BaseModel):
    """An ERP instance as returned by the API."""

    id: uuid.UUID
    key: str
    name: str
    display_name: str
    description: str | None
    status: ErpStatus
    base_url: str | None
    environment: str | None
    version: str | None
    last_seen_at: datetime | None
    created_at: datetime
    updated_at: datetime
    modules: list[ErpModuleRead] = Field(default_factory=list)

    model_config = {"from_attributes": True}
