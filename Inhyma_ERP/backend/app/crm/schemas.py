"""
CRM Pydantic Schemas.

Contracts for CRM Pipelines and Stages setup and management.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.core.exceptions import BadRequestException

VALID_STAGE_TYPES = {"open", "won", "lost"}


def _strip_str(val: Any) -> str | None:
    if val is None:
        return None
    if isinstance(val, str):
        cleaned = val.strip()
        return cleaned if cleaned else None
    return str(val).strip()


class CrmStageCreate(BaseModel):
    """Payload to create a stage in a pipeline."""

    name: str = Field(..., min_length=1, max_length=100)
    stage_order: int = Field(default=0, ge=0)
    stage_type: str = Field(default="open")
    is_initial: bool = False
    is_active: bool = True

    @field_validator("name", mode="before")
    @classmethod
    def _validate_name(cls, v: Any) -> str:
        s = _strip_str(v)
        if not s:
            raise ValueError("Stage name is required and cannot be blank.")
        if len(s) > 100:
            raise ValueError("Stage name cannot exceed 100 characters.")
        return s

    @field_validator("stage_type")
    @classmethod
    def _validate_stage_type(cls, v: str) -> str:
        t = v.strip().lower()
        if t not in VALID_STAGE_TYPES:
            raise ValueError(f"stage_type must be one of: {', '.join(sorted(VALID_STAGE_TYPES))}")
        return t


class CrmStageUpdate(BaseModel):
    """Payload to update an existing stage."""

    name: str | None = Field(default=None, max_length=100)
    stage_order: int | None = Field(default=None, ge=0)
    stage_type: str | None = None
    is_initial: bool | None = None
    is_active: bool | None = None

    @field_validator("name", mode="before")
    @classmethod
    def _validate_name(cls, v: Any) -> str | None:
        if v is None:
            return None
        s = _strip_str(v)
        if not s:
            raise ValueError("Stage name cannot be empty.")
        if len(s) > 100:
            raise ValueError("Stage name cannot exceed 100 characters.")
        return s

    @field_validator("stage_type")
    @classmethod
    def _validate_stage_type(cls, v: str | None) -> str | None:
        if v is None:
            return None
        t = v.strip().lower()
        if t not in VALID_STAGE_TYPES:
            raise ValueError(f"stage_type must be one of: {', '.join(sorted(VALID_STAGE_TYPES))}")
        return t


class CrmStageReorderItem(BaseModel):
    """Single stage order entry."""

    id: uuid.UUID
    stage_order: int = Field(..., ge=0)


class CrmStageReorderRequest(BaseModel):
    """Payload to reorder stages within a pipeline."""

    stages: list[CrmStageReorderItem] = Field(..., min_length=1)


class CrmStageRead(BaseModel):
    """Serialized pipeline stage."""

    id: uuid.UUID
    pipeline_id: uuid.UUID
    name: str
    stage_order: int
    stage_type: str
    is_initial: bool
    is_active: bool
    lead_count: int = 0
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class CrmPipelineCreate(BaseModel):
    """Payload to create a new CRM pipeline."""

    name: str = Field(..., min_length=1, max_length=150)
    description: str | None = Field(default=None, max_length=2000)
    is_default: bool = False
    is_active: bool = True
    stages: list[CrmStageCreate] | None = None

    @field_validator("name", mode="before")
    @classmethod
    def _validate_name(cls, v: Any) -> str:
        s = _strip_str(v)
        if not s:
            raise ValueError("Pipeline name is required and cannot be blank.")
        if len(s) > 150:
            raise ValueError("Pipeline name cannot exceed 150 characters.")
        return s

    @field_validator("description", mode="before")
    @classmethod
    def _validate_desc(cls, v: Any) -> str | None:
        return _strip_str(v)


class CrmPipelineUpdate(BaseModel):
    """Payload to update pipeline attributes."""

    name: str | None = Field(default=None, max_length=150)
    description: str | None = Field(default=None, max_length=2000)
    is_default: bool | None = None
    is_active: bool | None = None

    @field_validator("name", mode="before")
    @classmethod
    def _validate_name(cls, v: Any) -> str | None:
        if v is None:
            return None
        s = _strip_str(v)
        if not s:
            raise ValueError("Pipeline name cannot be empty.")
        if len(s) > 150:
            raise ValueError("Pipeline name cannot exceed 150 characters.")
        return s

    @field_validator("description", mode="before")
    @classmethod
    def _validate_desc(cls, v: Any) -> str | None:
        return _strip_str(v)


class CrmPipelineListItemRead(BaseModel):
    """Pipeline item for list views."""

    id: uuid.UUID
    name: str
    description: str | None = None
    is_default: bool
    is_active: bool
    stage_count: int = 0
    lead_count: int = 0
    created_by: uuid.UUID | None = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class CrmPipelineDetailRead(BaseModel):
    """Complete pipeline detail with ordered stages."""

    id: uuid.UUID
    name: str
    description: str | None = None
    is_default: bool
    is_active: bool
    created_by: uuid.UUID | None = None
    created_at: datetime
    updated_at: datetime
    stages: list[CrmStageRead] = []

    model_config = ConfigDict(from_attributes=True)
