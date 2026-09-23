"""
Unit & Regression Tests for Companies Module.

Tests cover:
- CompanyCurrentStatus Enum values (including NEW, EXISTING, ACTIVE, INACTIVE)
- CompanyListItemRead schema validation and serialization
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
import pytest

from app.companies.models import (
    CompanyCurrentStatus,
    CompanyGrade,
    CompanyPotential,
)
from app.companies.schemas import CompanyListItemRead


def test_company_current_status_values():
    """Verify CompanyCurrentStatus supports both existing and legacy/active values."""
    assert CompanyCurrentStatus.NEW == "new"
    assert CompanyCurrentStatus.EXISTING == "existing"
    assert CompanyCurrentStatus.ACTIVE == "active"
    assert CompanyCurrentStatus.INACTIVE == "inactive"


def test_company_list_item_read_with_active_status():
    """Verify CompanyListItemRead serializes with active or existing status."""
    now = datetime.now(timezone.utc)
    item = CompanyListItemRead(
        id=uuid.uuid4(),
        company_name="Test Automation Corp",
        current_status=CompanyCurrentStatus.ACTIVE,
        company_grade=CompanyGrade.A,
        potential=CompanyPotential.YES,
        is_active=True,
        created_at=now,
        updated_at=now,
    )
    dumped = item.model_dump(mode="json")
    assert dumped["company_name"] == "Test Automation Corp"
    assert dumped["current_status"] == "active"
    assert dumped["is_active"] is True
