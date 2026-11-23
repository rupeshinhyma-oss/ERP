"""PaymentMode Pydantic Schemas."""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.core.constants import RecordStatus


class PaymentModeCreate(BaseModel):
    """Payload to create a new payment mode / bank account."""

    name: str = Field(..., min_length=1, max_length=150)
    code: str | None = Field(default=None, max_length=50)
    account_type: str | None = Field(default=None, max_length=80)
    currency_code: str | None = Field(default=None, max_length=20)
    description: str | None = None
    status: RecordStatus = RecordStatus.ACTIVE


class PaymentModeUpdate(BaseModel):
    """Payload to update an existing payment mode / bank account."""

    name: str | None = Field(default=None, min_length=1, max_length=150)
    code: str | None = Field(default=None, min_length=1, max_length=50)
    account_type: str | None = Field(default=None, max_length=80)
    currency_code: str | None = Field(default=None, max_length=20)
    description: str | None = None
    status: RecordStatus | None = None


class PaymentModeRead(BaseModel):
    """A payment mode / bank account, as returned by the API."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    code: str
    account_type: str | None
    currency_code: str | None
    description: str | None
    status: RecordStatus
    created_at: datetime
    updated_at: datetime


class ImportSummaryRead(BaseModel):
    """Result summary returned after import."""

    total_rows: int
    created: int
    updated: int = 0
    unchanged: int = 0
    failed: int
    duplicate_count: int = 0
    errors: list[dict]
    duplicates: list[dict] = []
    in_file_duplicate_count: int = 0
    in_file_duplicates: list[dict] = []
