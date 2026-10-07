"""
Lead Pydantic Schemas.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class LeadBase(BaseModel):
    company_name: str = Field(..., min_length=1, max_length=255)
    business_type: str | None = None
    source: str | None = None
    contact_person: str | None = None
    designation: str | None = None
    contact_phone: str | None = None
    contact_email: str | None = None
    priority: str = Field(default="Medium", max_length=50)
    address: str | None = None
    area: str | None = None
    city: str | None = None
    district: str | None = None
    state: str | None = None
    requirements: str | None = None
    allotted_to: str | None = None
    created_by: str | None = None
    lead_status: str = Field(default="New", max_length=50)
    call_type: str | None = None
    notes: str | None = None
    added_on: date | None = None


class LeadCreate(LeadBase):
    pass


class LeadUpdate(BaseModel):
    company_name: str | None = None
    business_type: str | None = None
    source: str | None = None
    contact_person: str | None = None
    designation: str | None = None
    contact_phone: str | None = None
    contact_email: str | None = None
    priority: str | None = None
    address: str | None = None
    area: str | None = None
    city: str | None = None
    district: str | None = None
    state: str | None = None
    requirements: str | None = None
    allotted_to: str | None = None
    created_by: str | None = None
    lead_status: str | None = None
    call_type: str | None = None
    notes: str | None = None
    added_on: date | None = None


class LeadRead(LeadBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    created_at: datetime
    updated_at: datetime


class LeadBulkDeleteRequest(BaseModel):
    ids: list[uuid.UUID] = Field(..., min_length=1)
