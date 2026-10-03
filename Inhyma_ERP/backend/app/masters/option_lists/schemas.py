"""Option List Pydantic Schemas."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from app.core.constants import RecordStatus


class OptionListCreate(BaseModel):
    """Payload to create an option."""

    group_key: str = Field(..., min_length=1, max_length=100)
    value: str = Field(..., min_length=1, max_length=200)
    label: str | None = Field(None, max_length=200)
    sort_order: int = 0
    meta: dict[str, Any] | None = None
    status: RecordStatus = RecordStatus.ACTIVE


class OptionListUpdate(BaseModel):
    """Payload to update an option."""

    value: str | None = Field(None, min_length=1, max_length=200)
    label: str | None = Field(None, min_length=1, max_length=200)
    sort_order: int | None = None
    meta: dict[str, Any] | None = None
    status: RecordStatus | None = None


class OptionListRead(BaseModel):
    """An option as returned by the admin API."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    group_key: str
    value: str
    label: str
    sort_order: int
    meta: dict[str, Any] | None = None
    status: RecordStatus
    created_at: datetime
    updated_at: datetime
    version: int


class OptionLookup(BaseModel):
    """Lightweight option for dropdowns."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    value: str
    label: str
    sort_order: int
    meta: dict[str, Any] | None = None
