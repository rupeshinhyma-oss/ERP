"""
Pydantic Schemas for Technician Master Module.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.core.constants import RecordStatus


class TechnicianBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    mobile: str = Field(..., min_length=1, max_length=20)
    city: str = Field(..., min_length=1, max_length=100)
    status: RecordStatus = RecordStatus.ACTIVE


class TechnicianCreate(TechnicianBase):
    password: str | None = Field(None, max_length=128)


class TechnicianUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=100)
    mobile: str | None = Field(None, min_length=1, max_length=20)
    city: str | None = Field(None, min_length=1, max_length=100)
    password: str | None = Field(None, max_length=128)
    status: RecordStatus | None = None


class TechnicianRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    mobile: str
    city: str
    status: RecordStatus
    created_at: datetime | None = None
    updated_at: datetime | None = None
    version: int | None = 1


class TechnicianLookup(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    mobile: str
    city: str
    status: RecordStatus


class ImportSummaryRead(BaseModel):
    total_rows: int
    created: int
    failed: int
    duplicate_count: int = 0
    duplicates: list[dict] = []
    errors: list[dict] = []
