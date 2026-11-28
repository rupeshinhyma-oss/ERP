"""Organizations Pydantic Schemas (request/response contracts)."""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from app.organizations.models import OrganizationStatus


class OrganizationCreate(BaseModel):
    """Payload to create the (single) organization profile."""

    company_name: str = Field(..., min_length=1, max_length=200)
    legal_name: str | None = Field(default=None, max_length=200)
    logo_url: str | None = Field(default=None)
    logo_data: str | None = Field(default=None)
    gst_number: str | None = Field(default=None, max_length=50)
    pan_number: str | None = Field(default=None, max_length=50)
    email: EmailStr | None = None
    phone: str | None = Field(default=None, max_length=30)
    website: str | None = Field(default=None, max_length=255)
    address: str | None = None
    city: str | None = Field(default=None, max_length=100)
    state: str | None = Field(default=None, max_length=100)
    country: str | None = Field(default=None, max_length=100)
    postal_code: str | None = Field(default=None, max_length=20)
    timezone: str = Field(default="UTC", max_length=50)
    currency: str = Field(default="USD", max_length=10)
    business_hours: str | None = Field(default=None, max_length=255)
    status: OrganizationStatus = OrganizationStatus.ACTIVE


class OrganizationUpdate(BaseModel):
    """Payload to update the organization profile. All fields optional (partial update)."""

    company_name: str | None = Field(default=None, min_length=1, max_length=200)
    legal_name: str | None = Field(default=None, max_length=200)
    logo_url: str | None = Field(default=None)
    logo_data: str | None = Field(default=None)
    gst_number: str | None = Field(default=None, max_length=50)
    pan_number: str | None = Field(default=None, max_length=50)
    email: EmailStr | None = None
    phone: str | None = Field(default=None, max_length=30)
    website: str | None = Field(default=None, max_length=255)
    address: str | None = None
    city: str | None = Field(default=None, max_length=100)
    state: str | None = Field(default=None, max_length=100)
    country: str | None = Field(default=None, max_length=100)
    postal_code: str | None = Field(default=None, max_length=20)
    timezone: str | None = Field(default=None, max_length=50)
    currency: str | None = Field(default=None, max_length=10)
    business_hours: str | None = Field(default=None, max_length=255)
    status: OrganizationStatus | None = None


class OrganizationRead(BaseModel):
    """The organization profile, as returned by the API."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    company_name: str
    legal_name: str | None = None
    logo_url: str | None = None
    logo_data: str | None = None
    gst_number: str | None = None
    pan_number: str | None = None
    email: str | None = None
    phone: str | None = None
    website: str | None = None
    address: str | None = None
    city: str | None = None
    state: str | None = None
    country: str | None = None
    postal_code: str | None = None
    timezone: str = "UTC"
    currency: str = "USD"
    business_hours: str | None = None
    status: OrganizationStatus = OrganizationStatus.ACTIVE
    created_at: datetime
    updated_at: datetime
