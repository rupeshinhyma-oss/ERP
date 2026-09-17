"""
Pydantic Schemas for Technical Tasks.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class TechnicalTaskBase(BaseModel):
    company_name: str = Field(..., min_length=1, max_length=255)
    task_type: str = Field(default="In-House", max_length=100)
    city: str = Field(..., min_length=1, max_length=100)
    third_party: str | None = Field(default=None, max_length=100)
    priority: str = Field(default="A", max_length=10)
    machine_model: str = Field(..., min_length=1, max_length=255)
    task_description: str = Field(default="")

    contact_person_name: str | None = Field(default=None, max_length=150)
    contact_designation: str | None = Field(default=None, max_length=100)
    contact_phone: str | None = Field(default=None, max_length=50)

    service_type: str = Field(default="Free", max_length=50)
    service_charge: Decimal | None = None
    call_type: str = Field(default="Demo", max_length=50)

    task_approved_by: str | None = Field(default=None, max_length=100)
    task_approved_date: date | None = None
    task_allotted_to: str | None = Field(default=None, max_length=100)

    payment_status: str | None = Field(default=None, max_length=50)
    status: str = Field(default="Pending", max_length=50)
    completed_date: date | None = None


class TechnicalTaskCreate(TechnicalTaskBase):
    created_by_name: str | None = None
    task_created_date: date | None = None


class TechnicalTaskUpdate(BaseModel):
    company_name: str | None = None
    task_type: str | None = None
    city: str | None = None
    third_party: str | None = None
    priority: str | None = None
    machine_model: str | None = None
    task_description: str | None = None

    contact_person_name: str | None = None
    contact_designation: str | None = None
    contact_phone: str | None = None

    service_type: str | None = None
    service_charge: Decimal | None = None
    call_type: str | None = None

    task_approved_by: str | None = None
    task_approved_date: date | None = None
    task_allotted_to: str | None = None

    payment_status: str | None = None
    status: str | None = None
    completed_date: date | None = None


class TechnicalTaskStatusUpdate(BaseModel):
    status: str
    task_approved_by: str | None = None
    task_approved_date: date | None = None
    task_allotted_to: str | None = None
    completed_date: date | None = None


class TechnicalTaskRead(TechnicalTaskBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    created_by_name: str
    task_created_date: date
    version: int
    created_at: datetime
    updated_at: datetime


class TechnicalTaskCountsResponse(BaseModel):
    all: int
    pending: int
    approved: int
    completed: int
    cancel: int


class TechnicalTaskBulkDeleteRequest(BaseModel):
    ids: list[uuid.UUID]
