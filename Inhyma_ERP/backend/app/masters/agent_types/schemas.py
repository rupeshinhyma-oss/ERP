"""Agent Types Pydantic Schemas."""

from __future__ import annotations

import uuid
from datetime import datetime
from pydantic import BaseModel, ConfigDict, Field

from app.core.constants import RecordStatus


class AgentTypeBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=100, description="Agent type name")
    description: str | None = Field(None, max_length=500, description="Optional description")
    status: RecordStatus = Field(default=RecordStatus.ACTIVE, description="Record status")


class AgentTypeCreate(AgentTypeBase):
    pass


class AgentTypeUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=100)
    description: str | None = Field(None, max_length=500)
    status: RecordStatus | None = None


class AgentTypeRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    description: str | None = None
    status: RecordStatus
    created_at: datetime | None = None
    updated_at: datetime | None = None
    version: int | None = 1


class ImportSummaryRead(BaseModel):
    total_rows: int
    created: int
    failed: int
    duplicate_count: int = 0
    duplicates: list[dict] = []
    errors: list[dict] = []
