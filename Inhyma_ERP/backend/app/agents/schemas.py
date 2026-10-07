"""
Agent Pydantic Schemas.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class AgentBase(BaseModel):
    full_name: str = Field(..., min_length=1, max_length=150)
    agent_type: str = Field(..., min_length=1, max_length=100)
    company_name: str | None = None
    work_description: str | None = None
    calling_number: str = Field(..., min_length=1, max_length=50)
    whatsapp_number: str | None = None
    state: str = Field(..., min_length=1, max_length=100)
    district: str = Field(..., min_length=1, max_length=100)
    city: str = Field(..., min_length=1, max_length=100)
    area: str | None = None
    address: str | None = None
    birth_date: date | None = None
    age: int | None = None
    agent_grade: str | None = None
    current_status: str = Field(default="Select", max_length=50)
    potential: str = Field(default="Select", max_length=50)
    sales_person: str | None = None
    remarks: str | None = None
    added_on: date | None = None


class AgentCreate(AgentBase):
    pass


class AgentUpdate(BaseModel):
    full_name: str | None = None
    agent_type: str | None = None
    company_name: str | None = None
    work_description: str | None = None
    calling_number: str | None = None
    whatsapp_number: str | None = None
    state: str | None = None
    district: str | None = None
    city: str | None = None
    area: str | None = None
    address: str | None = None
    birth_date: date | None = None
    age: int | None = None
    agent_grade: str | None = None
    current_status: str | None = None
    potential: str | None = None
    sales_person: str | None = None
    remarks: str | None = None
    added_on: date | None = None


class AgentRead(AgentBase):
    id: uuid.UUID
    created_at: datetime
    updated_at: datetime
    model_config = ConfigDict(from_attributes=True)


class AgentBulkDeleteRequest(BaseModel):
    ids: list[uuid.UUID] = Field(..., min_length=1)


class AgentDuplicateCheckResponse(BaseModel):
    exists: bool
    field: str | None = None
    agent_name: str | None = None
