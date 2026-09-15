"""Bank Pydantic Schemas."""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.core.constants import RecordStatus


class BankCreate(BaseModel):
    """Payload to create a new bank account."""

    bank_name: str = Field(..., min_length=1, max_length=150)
    account_number: str = Field(..., min_length=1, max_length=50)
    account_holder_name: str = Field(..., min_length=1, max_length=200)
    ifsc_code: str = Field(..., min_length=1, max_length=20)
    branch: str = Field(..., min_length=1, max_length=150)
    status: RecordStatus = RecordStatus.ACTIVE


class BankUpdate(BaseModel):
    """Payload to update an existing bank account."""

    bank_name: str | None = Field(None, min_length=1, max_length=150)
    account_number: str | None = Field(None, min_length=1, max_length=50)
    account_holder_name: str | None = Field(None, min_length=1, max_length=200)
    ifsc_code: str | None = Field(None, min_length=1, max_length=20)
    branch: str | None = Field(None, min_length=1, max_length=150)
    status: RecordStatus | None = None


class BankRead(BaseModel):
    """A bank account as returned by the API."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    bank_name: str
    account_number: str
    account_holder_name: str
    ifsc_code: str
    branch: str
    status: RecordStatus
    created_at: datetime
    updated_at: datetime
    version: int


class BankLookup(BaseModel):
    """Lightweight lookup representation for dropdowns."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    bank_name: str
    account_number: str
    account_holder_name: str


class ImportSummaryRead(BaseModel):
    """Summary result of a bulk import."""

    total_rows: int
    imported_rows: int
    duplicate_rows: int
    error_rows: int
    errors: list[str] = []
