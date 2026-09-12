"""Tax Pydantic Schemas (request/response contracts)."""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.core.constants import RecordStatus


class TaxCreate(BaseModel):
    """Payload to create a new tax / HSN entry."""

    hsn_number: str = Field(..., min_length=1, max_length=50)
    gst_percent: float = Field(default=0.0, ge=0, le=100)
    import_duty_percent: float = Field(default=0.0, ge=0, le=100)
    status: RecordStatus = RecordStatus.ACTIVE


class TaxUpdate(BaseModel):
    """Payload to update an existing tax entry. All fields optional."""

    hsn_number: str | None = Field(default=None, min_length=1, max_length=50)
    gst_percent: float | None = Field(default=None, ge=0, le=100)
    import_duty_percent: float | None = Field(default=None, ge=0, le=100)
    status: RecordStatus | None = None


class TaxRead(BaseModel):
    """A tax entry as returned by the API."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    hsn_number: str
    gst_percent: float
    import_duty_percent: float
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
