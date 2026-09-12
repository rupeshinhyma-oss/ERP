"""District Pydantic Schemas (request/response contracts)."""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.core.constants import RecordStatus


class DistrictCreate(BaseModel):
    """Payload to create a new district."""

    country_id: uuid.UUID
    state_id: uuid.UUID
    name: str = Field(..., min_length=1, max_length=150)
    code: str | None = Field(default=None, max_length=50)
    status: RecordStatus = RecordStatus.ACTIVE


class DistrictUpdate(BaseModel):
    """Payload to update an existing district. All fields optional (partial update)."""

    country_id: uuid.UUID | None = None
    state_id: uuid.UUID | None = None
    name: str | None = Field(default=None, min_length=1, max_length=150)
    code: str | None = Field(default=None, max_length=50)
    status: RecordStatus | None = None


class DistrictLookupRead(BaseModel):
    """Bare id/name pair, for the permission-free ``/lookup`` endpoint."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    state_id: uuid.UUID


class DistrictRead(BaseModel):
    """A district, as returned by the API."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    country_id: uuid.UUID
    state_id: uuid.UUID
    name: str
    code: str | None = None
    status: RecordStatus
    created_at: datetime
    updated_at: datetime


class ImportSummaryRead(BaseModel):
    """Result summary returned after a CSV/Excel import."""

    total_rows: int
    created: int
    updated: int
    skipped: int
    failed: int
    errors: list[str] = []
    duplicates: list[dict] = []
