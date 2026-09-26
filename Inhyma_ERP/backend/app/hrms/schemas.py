"""
HRMS Setup Pydantic Schemas.
Request and response validation models for HRMS Setup endpoints.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from pydantic import BaseModel, Field, ConfigDict


# ---------------------------------------------------------------------------
# Location (Geo Fencing) Schemas
# ---------------------------------------------------------------------------

class LocationBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=150, description="Office location name")
    location_type: str = Field(default="OFFICE", max_length=50)
    address: str = Field(..., min_length=1, description="Full office physical address")
    latitude: float = Field(..., ge=-90.0, le=90.0, description="GPS latitude")
    longitude: float = Field(..., ge=-180.0, le=180.0, description="GPS longitude")
    radius_meters: float = Field(default=150.0, gt=0, le=10000, description="Geofence boundary radius in meters")
    is_active: bool = Field(default=True)


class LocationCreate(LocationBase):
    pass


class LocationUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=150)
    location_type: str | None = Field(default=None, max_length=50)
    address: str | None = Field(default=None, min_length=1)
    latitude: float | None = Field(default=None, ge=-90.0, le=90.0)
    longitude: float | None = Field(default=None, ge=-180.0, le=180.0)
    radius_meters: float | None = Field(default=None, gt=0, le=10000)
    is_active: bool | None = None


class LocationStatusUpdate(BaseModel):
    is_active: bool


class LocationRead(LocationBase):
    id: uuid.UUID
    employees_assigned: int = 0
    created_at: datetime
    updated_at: datetime
    version: int

    model_config = ConfigDict(from_attributes=True)


# ---------------------------------------------------------------------------
# Leave Type Schemas
# ---------------------------------------------------------------------------

class LeaveTypeBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=100, description="Leave name e.g. Casual Leave")
    code: str | None = Field(default=None, max_length=50)
    leave_type: str = Field(default="REGULAR", max_length=50)
    is_paid: bool = Field(default=True, description="True for paid, False for unpaid")
    annual_balance: float = Field(default=12.0, ge=0)
    carry_forward_days: float = Field(default=0.0, ge=0)
    max_consecutive_days: int = Field(default=5, ge=1)
    monthly_accrual: bool = Field(default=False)
    is_active: bool = Field(default=True)


class LeaveTypeCreate(LeaveTypeBase):
    pass


class LeaveTypeUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    code: str | None = None
    leave_type: str | None = None
    is_paid: bool | None = None
    annual_balance: float | None = Field(default=None, ge=0)
    carry_forward_days: float | None = Field(default=None, ge=0)
    max_consecutive_days: int | None = Field(default=None, ge=1)
    monthly_accrual: bool | None = None
    is_active: bool | None = None


class LeaveTypeStatusUpdate(BaseModel):
    is_active: bool


class LeaveTypeRead(LeaveTypeBase):
    id: uuid.UUID
    created_at: datetime
    updated_at: datetime
    version: int

    model_config = ConfigDict(from_attributes=True)


# ---------------------------------------------------------------------------
# Expense Category Schemas
# ---------------------------------------------------------------------------

class ExpenseCategoryBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=100, description="Category name e.g. Travel, Meals")
    code: str | None = Field(default=None, max_length=50)
    description: str | None = None
    is_active: bool = Field(default=True)


class ExpenseCategoryCreate(ExpenseCategoryBase):
    pass


class ExpenseCategoryUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    code: str | None = None
    description: str | None = None
    is_active: bool | None = None


class ExpenseCategoryStatusUpdate(BaseModel):
    is_active: bool


class ExpenseCategoryRead(ExpenseCategoryBase):
    id: uuid.UUID
    created_at: datetime
    updated_at: datetime
    version: int

    model_config = ConfigDict(from_attributes=True)


# ---------------------------------------------------------------------------
# Expense Settings & Approval Workflow Schemas
# ---------------------------------------------------------------------------

class ExpenseSettingsBase(BaseModel):
    approval_team_lead: bool = Field(default=True)
    approval_manager: bool = Field(default=True)
    approval_accounts: bool = Field(default=True)

    max_claim_amount: float = Field(default=50000.0, ge=0)
    receipt_required: bool = Field(default=True)
    auto_approval_limit: float = Field(default=500.0, ge=0)
    submission_window_days: int = Field(default=30, ge=1)


class ExpenseSettingsUpdate(ExpenseSettingsBase):
    pass


class ExpenseSettingsRead(ExpenseSettingsBase):
    id: uuid.UUID
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)
