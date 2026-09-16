"""Adjustment Purpose Pydantic Schemas."""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.core.constants import RecordStatus


class AdjustmentPurposeCreate(BaseModel):
    """Payload to create a new adjustment purpose."""

    name: str = Field(..., min_length=1, max_length=100)
    status: RecordStatus = RecordStatus.ACTIVE


class AdjustmentPurposeUpdate(BaseModel):
    """Payload to update an existing adjustment purpose."""

    name: str | None = Field(None, min_length=1, max_length=100)
    status: RecordStatus | None = None


class AdjustmentPurposeRead(BaseModel):
    """An adjustment purpose record as returned by the API."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    status: RecordStatus
    created_at: datetime
    updated_at: datetime
    version: int


class AdjustmentPurposeLookup(BaseModel):
    """Lightweight lookup representation for dropdowns."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str


class ImportSummaryRead(BaseModel):
    """Summary result of a bulk import."""

    total_rows: int
    imported_rows: int
    duplicate_rows: int
    error_rows: int
    errors: list[str] = []
