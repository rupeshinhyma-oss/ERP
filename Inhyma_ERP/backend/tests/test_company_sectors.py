"""
Unit & Integration Tests for Company Sectors Master Module.

Tests cover:
- Row validation for CSV/Excel imports
- Pydantic schemas (CompanySectorCreate, CompanySectorUpdate, CompanySectorRead)
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
from app.masters.company_sectors.models import CompanySector
from app.masters.company_sectors.schemas import (
    CompanySectorCreate,
    CompanySectorRead,
    CompanySectorUpdate,
)
from app.masters.company_sectors.service import CompanySectorService
from app.masters.company_sectors.validators import validate_company_sector_row


# ---------------------------------------------------------------------------
# 1. Validator Tests
# ---------------------------------------------------------------------------

def test_validate_company_sector_row_valid():
    row = {
        "Name": "Agriculture",
        "Description": "Agricultural sector and farming goods",
        "Status": "active",
    }
    result = validate_company_sector_row(row, 1)
    assert result["name"] == "Agriculture"
    assert result["description"] == "Agricultural sector and farming goods"
    assert result["status"] == RecordStatus.ACTIVE


def test_validate_company_sector_row_minimal():
    row = {
        "Name": "Chemical",
        "Status": "active",
    }
    result = validate_company_sector_row(row, 1)
    assert result["name"] == "Chemical"
    assert result["description"] is None
    assert result["status"] == RecordStatus.ACTIVE


def test_validate_company_sector_row_missing_name():
    row = {
        "Name": "",
    }
    with pytest.raises(BadRequestException) as exc_info:
        validate_company_sector_row(row, 2)
    assert "Name is required" in str(exc_info.value)


def test_validate_company_sector_row_name_too_long():
    row = {
        "Name": "X" * 101,
    }
    with pytest.raises(BadRequestException) as exc_info:
        validate_company_sector_row(row, 3)
    assert "cannot exceed 100 characters" in str(exc_info.value)


# ---------------------------------------------------------------------------
# 2. Schema Tests
# ---------------------------------------------------------------------------

def test_company_sector_create_schema():
    payload = CompanySectorCreate(
        name="Pharma & Healthcare",
        description="Pharmaceutical and medical supply goods",
        status=RecordStatus.ACTIVE,
    )
    assert payload.name == "Pharma & Healthcare"
    assert payload.description == "Pharmaceutical and medical supply goods"
    assert payload.status == RecordStatus.ACTIVE


def test_company_sector_update_schema():
    update = CompanySectorUpdate(name="Heavy Metals & Mining")
    assert update.name == "Heavy Metals & Mining"
    assert update.description is None
    assert update.status is None


def test_company_sector_read_schema():
    sid = uuid.uuid4()
    now = datetime.now(timezone.utc)
    model = CompanySector(
        id=sid,
        name="Textile",
        description="Textile and garments",
        status=RecordStatus.ACTIVE,
        created_at=now,
        updated_at=now,
    )
    read = CompanySectorRead.model_validate(model)
    assert read.id == sid
    assert read.name == "Textile"
    assert read.status == RecordStatus.ACTIVE


# ---------------------------------------------------------------------------
# 3. Model Tests
# ---------------------------------------------------------------------------

def test_company_sector_model_repr():
    m = CompanySector(
        id=uuid.uuid4(),
        name="Automobile",
        status=RecordStatus.ACTIVE,
    )
    repr_str = repr(m)
    assert "Automobile" in repr_str
    assert "ACTIVE" in repr_str


# ---------------------------------------------------------------------------
# 4. Service Tests
# ---------------------------------------------------------------------------

@pytest.fixture
def mock_service():
    repo = AsyncMock()
    cache_mgr = AsyncMock()
    service = CompanySectorService(repository=repo, cache_manager=cache_mgr)
    return service, repo, cache_mgr


@pytest.mark.asyncio
async def test_company_sector_service_create(mock_service):
    service, repo, cache_mgr = mock_service
    repo.get_by_name.return_value = None

    sid = uuid.uuid4()
    mock_item = CompanySector(
        id=sid,
        name="Packaging",
        status=RecordStatus.ACTIVE,
    )
    repo.create.return_value = mock_item

    created = await service.create(name="Packaging")

    assert created.id == sid
    assert created.name == "Packaging"
    repo.create.assert_awaited_once()
    cache_mgr.invalidate_dropdown.assert_awaited_once()


@pytest.mark.asyncio
async def test_company_sector_service_create_duplicate_name(mock_service):
    service, repo, _ = mock_service
    repo.get_by_name.return_value = CompanySector(id=uuid.uuid4(), name="Packaging")

    with pytest.raises(ConflictException) as exc_info:
        await service.create(name="Packaging")

    assert "already in use" in str(exc_info.value)


@pytest.mark.asyncio
async def test_company_sector_service_get_by_id_or_raise_not_found(mock_service):
    service, repo, _ = mock_service
    repo.get_by_id.return_value = None

    sid = uuid.uuid4()
    with pytest.raises(NotFoundException) as exc_info:
        await service.get_by_id_or_raise(sid)

    assert "not found" in str(exc_info.value)


@pytest.mark.asyncio
async def test_company_sector_service_activate_deactivate(mock_service):
    service, repo, _ = mock_service

    sid = uuid.uuid4()
    item = CompanySector(id=sid, name="Electronics")
    repo.get_by_id.return_value = item
    repo.update.side_effect = lambda entity, **kwargs: setattr(entity, "status", kwargs.get("status")) or entity

    deactivated = await service.deactivate(sid)
    assert deactivated.status == RecordStatus.INACTIVE

    activated = await service.activate(sid)
    assert activated.status == RecordStatus.ACTIVE
