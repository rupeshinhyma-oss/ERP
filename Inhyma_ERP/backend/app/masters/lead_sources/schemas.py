"""Lead Source Pydantic Schemas."""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.core.constants import RecordStatus


class LeadSourceCreate(BaseModel):
    """Payload to create a new lead source."""

    name: str = Field(..., min_length=1, max_length=100)
    status: RecordStatus = RecordStatus.ACTIVE


class LeadSourceUpdate(BaseModel):
    """Payload to update an existing lead source."""

    name: str | None = Field(None, min_length=1, max_length=100)
    status: RecordStatus | None = None


class LeadSourceRead(BaseModel):
    """A lead source record as returned by the API."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    status: RecordStatus
    created_at: datetime
    updated_at: datetime
    version: int


class LeadSourceLookup(BaseModel):
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
