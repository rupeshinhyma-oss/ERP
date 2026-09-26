"""
HRMS Setup Database Models.

Permanent PostgreSQL schema for:
- Office Locations (Geofencing parameters & office boundaries)
- Employee Location Assignments
- Leave Types & Entitlements
- Expense Categories
- Expense Approval Configuration & Claim Rules
"""

from __future__ import annotations

import uuid
from sqlalchemy import Boolean, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database.base import (
    Base,
    GUID,
    SoftDeleteMixin,
    TimestampMixin,
    UUIDPrimaryKeyMixin,
    VersionMixin,
)


class HrmsLocation(Base, UUIDPrimaryKeyMixin, TimestampMixin, SoftDeleteMixin, VersionMixin):
    """
    Office Location master for Attendance geofence validation.

    Stores office coordinates and radius in meters. Soft-deleted locations
    are excluded from active attendance punch verification.
    """

    __tablename__ = "hrms_locations"

    name: Mapped[str] = mapped_column(String(150), nullable=False, index=True)
    location_type: Mapped[str] = mapped_column(String(50), default="OFFICE", nullable=False)
    address: Mapped[str] = mapped_column(Text, nullable=False)
    latitude: Mapped[float] = mapped_column(Float, nullable=False)
    longitude: Mapped[float] = mapped_column(Float, nullable=False)
    radius_meters: Mapped[float] = mapped_column(Float, default=150.0, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False, index=True)


class HrmsEmployeeLocation(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """
    Mapping between employees and authorized office locations.
    """

    __tablename__ = "hrms_employee_locations"

    user_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    location_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("hrms_locations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    is_primary: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)


class HrmsLeaveType(Base, UUIDPrimaryKeyMixin, TimestampMixin, SoftDeleteMixin, VersionMixin):
    """
    Leave types and corporate annual leave allocation policies.
    """

    __tablename__ = "hrms_leave_types"

    name: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    code: Mapped[str | None] = mapped_column(String(50), nullable=True)
    leave_type: Mapped[str] = mapped_column(String(50), default="REGULAR", nullable=False)
    is_paid: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    annual_balance: Mapped[float] = mapped_column(Float, default=12.0, nullable=False)
    carry_forward_days: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    max_consecutive_days: Mapped[int] = mapped_column(Integer, default=5, nullable=False)
    monthly_accrual: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False, index=True)


class HrmsExpenseCategory(Base, UUIDPrimaryKeyMixin, TimestampMixin, SoftDeleteMixin, VersionMixin):
    """
    Expense reimbursement categories (e.g. Travel, Meals, Fuel).
    """

    __tablename__ = "hrms_expense_categories"

    name: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    code: Mapped[str | None] = mapped_column(String(50), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False, index=True)


class HrmsExpenseSettings(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """
    Global Expense approval workflow stages and claim limit rules.
    Singleton record storing organization-wide expense policies.
    """

    __tablename__ = "hrms_expense_settings"

    approval_team_lead: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    approval_manager: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    approval_accounts: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    max_claim_amount: Mapped[float] = mapped_column(Float, default=50000.0, nullable=False)
    receipt_required: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    auto_approval_limit: Mapped[float] = mapped_column(Float, default=500.0, nullable=False)
    submission_window_days: Mapped[int] = mapped_column(Integer, default=30, nullable=False)
