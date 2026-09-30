"""
FollowUp Pydantic Schemas.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class FollowUpBase(BaseModel):
    company_name: str = Field(..., min_length=1, max_length=255)
    contact_person: str | None = None
    contact_phone: str | None = None
    contact_email: str | None = None
    designation: str | None = None

    business_type: str | None = None
    client_grade: str | None = None
    potential_type: str | None = None
    business_category: str | None = None
    category: str | None = None

    call_type: str | None = None
    call_category: str | None = None
    marketing_person: str | None = None
    current_status: str = Field(default="New", max_length=50)
    feedback: str | None = None

    address: str | None = None
    area: str | None = None
    city: str | None = None
    district: str | None = None
    state: str | None = None

    followup_date: date | None = None
    added_on: date | None = None
    notes: str | None = None


class FollowUpCreate(FollowUpBase):
    pass


class FollowUpUpdate(BaseModel):
    company_name: str | None = None
    contact_person: str | None = None
    contact_phone: str | None = None
    contact_email: str | None = None
    designation: str | None = None

    business_type: str | None = None
    client_grade: str | None = None
    potential_type: str | None = None
    business_category: str | None = None
    category: str | None = None

    call_type: str | None = None
    call_category: str | None = None
    marketing_person: str | None = None
    current_status: str | None = None
    feedback: str | None = None

    address: str | None = None
    area: str | None = None
    city: str | None = None
    district: str | None = None
    state: str | None = None

    followup_date: date | None = None
    added_on: date | None = None
    notes: str | None = None


class FollowUpRead(FollowUpBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    created_at: datetime
    updated_at: datetime


class FollowUpBulkDeleteRequest(BaseModel):
    ids: list[uuid.UUID] = Field(..., min_length=1)
