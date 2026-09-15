"""
Pydantic Schemas for Billing Company Master Module.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.core.constants import RecordStatus


class BillingCompanyBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=150)
    email: str | None = Field(None, max_length=100)
    mobile: str | None = Field(None, max_length=20)
    logo_url: str | None = None
    signature_url: str | None = None
    address: str | None = None
    city: str = Field(..., min_length=1, max_length=100)
    zip_code: str | None = Field(None, max_length=20)
    gst_no: str | None = Field(None, max_length=30)
    pan_no: str | None = Field(None, max_length=30)
    so_prefix: str = Field(..., min_length=1, max_length=30)
    pi_prefix: str = Field(..., min_length=1, max_length=30)
    bank_name: str = Field(..., min_length=1, max_length=100)
    terms_and_conditions: str | None = None
    status: RecordStatus = RecordStatus.ACTIVE


class BillingCompanyCreate(BillingCompanyBase):
    pass


class BillingCompanyUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=150)
    email: str | None = Field(None, max_length=100)
    mobile: str | None = Field(None, max_length=20)
    logo_url: str | None = None
    signature_url: str | None = None
    address: str | None = None
    city: str | None = Field(None, min_length=1, max_length=100)
    zip_code: str | None = Field(None, max_length=20)
    gst_no: str | None = Field(None, max_length=30)
    pan_no: str | None = Field(None, max_length=30)
    so_prefix: str | None = Field(None, min_length=1, max_length=30)
    pi_prefix: str | None = Field(None, min_length=1, max_length=30)
    bank_name: str | None = Field(None, min_length=1, max_length=100)
    terms_and_conditions: str | None = None
    status: RecordStatus | None = None


class BillingCompanyRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    email: str | None = None
    mobile: str | None = None
    logo_url: str | None = None
    signature_url: str | None = None
    address: str | None = None
    city: str
    zip_code: str | None = None
    gst_no: str | None = None
    pan_no: str | None = None
    so_prefix: str
    pi_prefix: str
    bank_name: str
    terms_and_conditions: str | None = None
    status: RecordStatus
    created_at: datetime | None = None
    updated_at: datetime | None = None
    version: int | None = 1


class BillingCompanyLookup(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    city: str | None = None
    status: RecordStatus


class ImportSummaryRead(BaseModel):
    total_rows: int
    created: int
    failed: int
    duplicate_count: int = 0
    duplicates: list[dict] = []
    errors: list[dict] = []
