"""Additional Charge Pydantic Schemas (request/response contracts)."""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.core.constants import RecordStatus


class AdditionalChargeCreate(BaseModel):
    """Payload to create a new additional charge entry."""

    name: str = Field(..., min_length=1, max_length=150)
    hsn_number: str | None = Field(default=None, max_length=50)
    gst_percent: float = Field(default=0.0, ge=0, le=100)
    description: str | None = None
    status: RecordStatus = RecordStatus.ACTIVE


class AdditionalChargeUpdate(BaseModel):
    """Payload to update an existing additional charge entry. All fields optional."""

    name: str | None = Field(default=None, min_length=1, max_length=150)
    hsn_number: str | None = Field(default=None, max_length=50)
    gst_percent: float | None = Field(default=None, ge=0, le=100)
    description: str | None = None
    status: RecordStatus | None = None


class AdditionalChargeRead(BaseModel):
    """An additional charge entry as returned by the API."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    hsn_number: str | None = None
    gst_percent: float
    description: str | None = None
    status: RecordStatus
    created_at: datetime
    updated_at: datetime


class ImportSummaryRead(BaseModel):
    """Result summary returned after a CSV/Excel import."""

    total_rows: int
    created: int
    failed: int
    duplicate_count: int = 0
    duplicates: list[dict] = []
    errors: list[dict] = []
