"""
Unit & Integration Tests for Company Categories Master Module.

Tests cover:
- Row validation for CSV/Excel imports
- Pydantic schemas (CompanyCategoryCreate, CompanyCategoryUpdate, CompanyCategoryRead)
- ORM model representation
- Service layer operations (CRUD, duplicate validation, activation/deactivation)
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from unittest.mock import AsyncMock

import pytest

from app.core.constants import RecordStatus
from app.core.exceptions import BadRequestException, ConflictException, NotFoundException
from app.masters.company_categories.models import CompanyCategory
from app.masters.company_categories.schemas import (
    CompanyCategoryCreate,
    CompanyCategoryRead,
    CompanyCategoryUpdate,
)
from app.masters.company_categories.service import CompanyCategoryService
from app.masters.company_categories.validators import validate_company_category_row


# ---------------------------------------------------------------------------
# 1. Validator Tests
# ---------------------------------------------------------------------------

def test_validate_company_category_row_valid():
    row = {
        "Name": "Traditional",
        "Business Type": "B2B",
        "Description": "Traditional B2B category",
        "Status": "active",
    }
    result = validate_company_category_row(row, 1)
    assert result["name"] == "Traditional"
    assert result["business_type"] == "B2B"
    assert result["description"] == "Traditional B2B category"
    assert result["status"] == RecordStatus.ACTIVE


def test_validate_company_category_row_default_business_type():
    row = {
        "Name": "Corporate",
        "Status": "active",
    }
    result = validate_company_category_row(row, 1)
    assert result["name"] == "Corporate"
    assert result["business_type"] == "B2B"
    assert result["status"] == RecordStatus.ACTIVE


def test_validate_company_category_row_missing_name():
    row = {
        "Name": "",
    }
    with pytest.raises(BadRequestException) as exc_info:
        validate_company_category_row(row, 2)
    assert "Name is required" in str(exc_info.value)


def test_validate_company_category_row_name_too_long():
    row = {
        "Name": "X" * 101,
    }
    with pytest.raises(BadRequestException) as exc_info:
        validate_company_category_row(row, 3)
    assert "cannot exceed 100 characters" in str(exc_info.value)


# ---------------------------------------------------------------------------
# 2. Schema Tests
# ---------------------------------------------------------------------------

def test_company_category_create_schema():
    payload = CompanyCategoryCreate(
        name="SME",
        business_type="B2C",
        description="Small and Medium Enterprises",
        status=RecordStatus.ACTIVE,
    )
    assert payload.name == "SME"
    assert payload.business_type == "B2C"
    assert payload.description == "Small and Medium Enterprises"
    assert payload.status == RecordStatus.ACTIVE


def test_company_category_update_schema():
    update = CompanyCategoryUpdate(name="Large Corporate", business_type="B2B")
    assert update.name == "Large Corporate"
    assert update.business_type == "B2B"
    assert update.description is None
    assert update.status is None


def test_company_category_read_schema():
    cid = uuid.uuid4()
    now = datetime.now(timezone.utc)
    model = CompanyCategory(
        id=cid,
        name="Non Traditional",
        business_type="B2B",
        description="Modern high-velocity B2B accounts",
        status=RecordStatus.ACTIVE,
        created_at=now,
        updated_at=now,
    )
    read = CompanyCategoryRead.model_validate(model)
    assert read.id == cid
    assert read.name == "Non Traditional"
    assert read.business_type == "B2B"
    assert read.status == RecordStatus.ACTIVE


# ---------------------------------------------------------------------------
# 3. Model Tests
# ---------------------------------------------------------------------------

def test_company_category_model_repr():
    m = CompanyCategory(
        id=uuid.uuid4(),
        name="Traditional",
        business_type="B2B",
        status=RecordStatus.ACTIVE,
    )
    repr_str = repr(m)
    assert "Traditional" in repr_str
    assert "B2B" in repr_str


# ---------------------------------------------------------------------------
# 4. Service Tests
# ---------------------------------------------------------------------------

@pytest.fixture
def mock_service():
    repo = AsyncMock()
    cache_mgr = AsyncMock()
    service = CompanyCategoryService(repository=repo, cache_manager=cache_mgr)
    return service, repo, cache_mgr


@pytest.mark.asyncio
async def test_company_category_service_create(mock_service):
    service, repo, cache_mgr = mock_service
    repo.get_by_name.return_value = None

    cid = uuid.uuid4()
    mock_item = CompanyCategory(
        id=cid,
        name="Corporate",
        business_type="B2C",
        status=RecordStatus.ACTIVE,
    )
    repo.create.return_value = mock_item

    created = await service.create(name="Corporate", business_type="B2C")

    assert created.id == cid
    assert created.name == "Corporate"
    assert created.business_type == "B2C"
    repo.create.assert_awaited_once()
    cache_mgr.invalidate_dropdown.assert_awaited_once()


@pytest.mark.asyncio
async def test_company_category_service_create_duplicate_name(mock_service):
    service, repo, _ = mock_service
    repo.get_by_name.return_value = CompanyCategory(id=uuid.uuid4(), name="Corporate", business_type="B2C")

    with pytest.raises(ConflictException) as exc_info:
        await service.create(name="Corporate", business_type="B2C")

    assert "already in use" in str(exc_info.value)


@pytest.mark.asyncio
async def test_company_category_service_get_by_id_or_raise_not_found(mock_service):
    service, repo, _ = mock_service
    repo.get_by_id.return_value = None

    cid = uuid.uuid4()
    with pytest.raises(NotFoundException) as exc_info:
        await service.get_by_id_or_raise(cid)

    assert "not found" in str(exc_info.value)


@pytest.mark.asyncio
async def test_company_category_service_activate_deactivate(mock_service):
    service, repo, _ = mock_service

    cid = uuid.uuid4()
    item = CompanyCategory(id=cid, name="SME", business_type="B2C")
    repo.get_by_id.return_value = item
    repo.update.side_effect = lambda entity, **kwargs: setattr(entity, "status", kwargs.get("status")) or entity

    deactivated = await service.deactivate(cid)
    assert deactivated.status == RecordStatus.INACTIVE

    activated = await service.activate(cid)
    assert activated.status == RecordStatus.ACTIVE
