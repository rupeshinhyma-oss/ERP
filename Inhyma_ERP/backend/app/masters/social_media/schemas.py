"""Social Media Pydantic Schemas."""

from __future__ import annotations

import uuid
from datetime import datetime
from pydantic import BaseModel, ConfigDict, Field

from app.core.constants import RecordStatus


class SocialMediaBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=100, description="Platform name")
    status: RecordStatus = Field(default=RecordStatus.ACTIVE, description="Record status")


class SocialMediaCreate(SocialMediaBase):
    pass


class SocialMediaUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=100)
    status: RecordStatus | None = None


class SocialMediaRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    status: RecordStatus
    created_at: datetime | None = None
    updated_at: datetime | None = None
    version: int | None = 1


class ImportSummaryRead(BaseModel):
    total_rows: int
    created: int
    failed: int
    errors: list[dict] = []
