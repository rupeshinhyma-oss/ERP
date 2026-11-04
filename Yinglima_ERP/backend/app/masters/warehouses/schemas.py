"""Warehouse Pydantic Schemas."""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.core.constants import RecordStatus


class WarehouseCreate(BaseModel):
    """Payload to create a new warehouse."""

    name: str = Field(..., min_length=1, max_length=150)
    code: str | None = Field(default=None, max_length=50)
    location: str | None = Field(default=None, max_length=200)
    description: str | None = None
    status: RecordStatus = RecordStatus.ACTIVE


class WarehouseUpdate(BaseModel):
    """Payload to update an existing warehouse."""

    name: str | None = Field(default=None, min_length=1, max_length=150)
    code: str | None = Field(default=None, min_length=1, max_length=50)
    location: str | None = Field(default=None, max_length=200)
    description: str | None = None
    status: RecordStatus | None = None


class WarehouseRead(BaseModel):
    """A warehouse, as returned by the API."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    code: str
    location: str | None
    description: str | None
    status: RecordStatus
    created_at: datetime
    updated_at: datetime


class ImportSummaryRead(BaseModel):
    """Result summary returned after import."""

    total_rows: int
    created: int
    updated: int = 0
    unchanged: int = 0
    failed: int
    duplicate_count: int = 0
    errors: list[dict]
    duplicates: list[dict] = []
    in_file_duplicate_count: int = 0
    in_file_duplicates: list[dict] = []

