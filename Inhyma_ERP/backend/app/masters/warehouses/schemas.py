"""
Pydantic Schemas for Warehouse Master Module.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.core.constants import RecordStatus


class WarehouseBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    address: str = Field(..., min_length=1)
    billing_company: str = Field(..., min_length=1, max_length=150)
    over_selling: bool = Field(default=False)
    is_primary: bool = Field(default=False)
    main_warehouse_id: uuid.UUID | None = None
    color: str = Field(default="#2563EB", max_length=20)
    status: RecordStatus = RecordStatus.ACTIVE


class WarehouseCreate(WarehouseBase):
    pass


class WarehouseUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=100)
    address: str | None = Field(None, min_length=1)
    billing_company: str | None = Field(None, min_length=1, max_length=150)
    over_selling: bool | None = None
    is_primary: bool | None = None
    main_warehouse_id: uuid.UUID | None = None
    color: str | None = Field(None, max_length=20)
    status: RecordStatus | None = None


class WarehouseRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    address: str
    billing_company: str
    over_selling: bool
    is_primary: bool
    main_warehouse_id: uuid.UUID | None = None
    main_warehouse_name: str | None = None
    color: str
    status: RecordStatus
    created_at: datetime | None = None
    updated_at: datetime | None = None
    version: int | None = 1


class WarehouseLookup(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    billing_company: str
    is_primary: bool
    status: RecordStatus


class ImportSummaryRead(BaseModel):
    total_rows: int
    created: int
    failed: int
    duplicate_count: int = 0
    duplicates: list[dict] = []
    errors: list[dict] = []
