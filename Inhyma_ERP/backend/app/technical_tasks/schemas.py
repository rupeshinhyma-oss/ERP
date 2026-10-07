"""
Pydantic Schemas for Technical Tasks.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class TechnicalTaskCallLogBase(BaseModel):
    call_date: date = Field(default_factory=date.today)
    call_type: str = Field(default="Telecall", max_length=50)
    remarks: str = Field(..., min_length=1)


class TechnicalTaskCallLogCreate(TechnicalTaskCallLogBase):
    pass


class TechnicalTaskCallLogRead(TechnicalTaskCallLogBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    task_id: uuid.UUID
    created_by: str
    created_at: datetime


class TechnicalTaskBase(BaseModel):
    company_name: str = Field(..., min_length=1, max_length=255)
    task_type: str = Field(default="In-House", max_length=100)
    city: str = Field(..., min_length=1, max_length=100)
    third_party: str | None = Field(default=None, max_length=100)
    third_party_city: str | None = Field(default=None, max_length=100)
    third_party_contact_name: str | None = Field(default=None, max_length=150)
    third_party_contact_phone: str | None = Field(default=None, max_length=50)

    priority: str = Field(default="A", max_length=10)
    machine_model: str = Field(..., min_length=1, max_length=255)
    task_description: str = Field(default="")

    contact_person_name: str | None = Field(default=None, max_length=150)
    contact_designation: str | None = Field(default=None, max_length=100)
    contact_phone: str | None = Field(default=None, max_length=50)

    service_type: str = Field(default="Free", max_length=50)
    service_charge: Decimal | None = None
    payment_terms: str | None = None
    call_type: str = Field(default="Demo", max_length=50)

    creator_remarks: str | None = None
    task_approved_by: str | None = Field(default=None, max_length=100)
    task_approved_date: date | None = None
    task_allotted_to: str | None = Field(default=None, max_length=100)
    approver_remarks: str | None = None
    scheduled_visit_date: date | None = None

    payment_status: str | None = Field(default=None, max_length=50)
    payment_mode: str | None = Field(default=None, max_length=50)
    payment_screenshot: str | None = Field(default=None, max_length=500)
    status: str = Field(default="Pending", max_length=50)
    cancel_remarks: str | None = None
    completed_date: date | None = None


class TechnicalTaskCreate(TechnicalTaskBase):
    created_by_name: str | None = None
    task_created_date: date | None = None


class TechnicalTaskUpdate(BaseModel):
    company_name: str | None = None
    task_type: str | None = None
    city: str | None = None
    third_party: str | None = None
    third_party_city: str | None = None
    third_party_contact_name: str | None = None
    third_party_contact_phone: str | None = None

    priority: str | None = None
    machine_model: str | None = None
    task_description: str | None = None

    contact_person_name: str | None = None
    contact_designation: str | None = None
    contact_phone: str | None = None

    service_type: str | None = None
    service_charge: Decimal | None = None
    payment_terms: str | None = None
    call_type: str | None = None

    creator_remarks: str | None = None
    task_approved_by: str | None = None
    task_approved_date: date | None = None
    task_allotted_to: str | None = None
    approver_remarks: str | None = None
    scheduled_visit_date: date | None = None

    payment_status: str | None = None
    payment_mode: str | None = None
    payment_screenshot: str | None = None
    status: str | None = None
    cancel_remarks: str | None = None
    completed_date: date | None = None


class TechnicalTaskStatusUpdate(BaseModel):
    status: str
    task_approved_by: str | None = None
    task_approved_date: date | None = None
    task_allotted_to: str | None = None
    scheduled_visit_date: date | None = None
    payment_status: str | None = None
    payment_mode: str | None = None
    payment_screenshot: str | None = None
    completed_date: date | None = None
    remarks: str | None = None
    cancel_remarks: str | None = None


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
    payment_pending: int = 0
    completed: int
    cancel: int


class TechnicalTaskBulkDeleteRequest(BaseModel):
    ids: list[uuid.UUID]
