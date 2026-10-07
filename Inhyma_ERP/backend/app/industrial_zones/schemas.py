"""
Industrial Zone Pydantic Schemas.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class IndustrialZoneBase(BaseModel):
    zone_name: str = Field(..., min_length=1, max_length=255)
    state: str = Field(..., min_length=1, max_length=100)
    district: str = Field(..., min_length=1, max_length=100)
    nearby_city: str | None = None
    distance_km: float | None = None
    num_industries: int | None = None
    zone_grade: str | None = None  # "A" or "B"
    industry_types: str | None = None
    potential_machine_categories: str | None = None
    remarks: str | None = None


class IndustrialZoneCreate(IndustrialZoneBase):
    pass


class IndustrialZoneUpdate(BaseModel):
    zone_name: str | None = None
    state: str | None = None
    district: str | None = None
    nearby_city: str | None = None
    distance_km: float | None = None
    num_industries: int | None = None
    zone_grade: str | None = None
    industry_types: str | None = None
    potential_machine_categories: str | None = None
    remarks: str | None = None


class IndustrialZoneRead(IndustrialZoneBase):
    id: uuid.UUID
    created_at: datetime
    updated_at: datetime
    model_config = ConfigDict(from_attributes=True)


class IndustrialZoneBulkDeleteRequest(BaseModel):
    ids: list[uuid.UUID] = Field(..., min_length=1)
