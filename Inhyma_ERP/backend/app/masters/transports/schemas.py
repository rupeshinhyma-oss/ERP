"""Transport Pydantic Schemas."""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.core.constants import RecordStatus


class TransportCreate(BaseModel):
    """Payload to create a new transport entry."""

    name: str = Field(..., min_length=1, max_length=200)
    gst_number: str = Field(..., min_length=1, max_length=50)
    mobile: str | None = Field(None, max_length=50)
    status: RecordStatus = RecordStatus.ACTIVE


class TransportUpdate(BaseModel):
    """Payload to update an existing transport entry."""

    name: str | None = Field(None, min_length=1, max_length=200)
    gst_number: str | None = Field(None, min_length=1, max_length=50)
    mobile: str | None = Field(None, max_length=50)
    status: RecordStatus | None = None


class TransportRead(BaseModel):
    """A transport record as returned by the API."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    gst_number: str
    mobile: str | None = None
    status: RecordStatus
    created_at: datetime
    updated_at: datetime
    version: int


class TransportLookup(BaseModel):
    """Lightweight lookup representation for dropdowns."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    gst_number: str
    mobile: str | None = None


class ImportSummaryRead(BaseModel):
    """Summary result of a bulk import."""

    total_rows: int
    imported_rows: int
    duplicate_rows: int
    error_rows: int
    errors: list[str] = []
