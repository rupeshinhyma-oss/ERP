"""
Unit & Integration Tests for Adjustment Purposes Master Module.

Tests cover:
- Row validation for CSV/Excel imports
- Pydantic schemas (AdjustmentPurposeCreate, AdjustmentPurposeUpdate, AdjustmentPurposeRead)
- ORM model representation
- Repository & Dependency initialization
- Service layer operations (CRUD, duplicate validation, activation/deactivation, paginated listing)
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.common.filtering import FilterParams
from app.common.list_query import ListQueryParams
from app.common.pagination import PageParams
from app.common.search import SearchParams
from app.common.sorting import SortParams
from app.core.constants import RecordStatus
from app.core.exceptions import BadRequestException, ConflictException, NotFoundException
from app.masters.adjustment_purposes.models import AdjustmentPurpose
from app.masters.adjustment_purposes.schemas import (
    AdjustmentPurposeCreate,
    AdjustmentPurposeRead,
    AdjustmentPurposeUpdate,
)
from app.masters.adjustment_purposes.service import AdjustmentPurposeService
from app.masters.adjustment_purposes.validators import validate_adjustment_purpose_row
from app.masters.adjustment_purposes.repository import AdjustmentPurposeRepository
from app.masters.adjustment_purposes.dependencies import get_adjustment_purpose_service


# ---------------------------------------------------------------------------
# 1. Validator Tests
# ---------------------------------------------------------------------------

def test_validate_adjustment_purpose_row_valid():
    row = {
        "Name": "Return From Client",
        "Status": "ACTIVE",
    }
    result = validate_adjustment_purpose_row(row, 1)
    assert result["name"] == "Return From Client"
    assert result["status"] == RecordStatus.ACTIVE


def test_validate_adjustment_purpose_row_missing_name():
    row = {
        "Name": "",
        "Status": "ACTIVE",
    }
    with pytest.raises(BadRequestException) as exc_info:
        validate_adjustment_purpose_row(row, 2)
    assert "Name is required" in str(exc_info.value)


# ---------------------------------------------------------------------------
# 2. Schema Tests
# ---------------------------------------------------------------------------

def test_adjustment_purpose_create_schema():
    payload = {"name": "Opening Stock", "status": RecordStatus.ACTIVE}
    schema = AdjustmentPurposeCreate(**payload)
    assert schema.name == "Opening Stock"
    assert schema.status == RecordStatus.ACTIVE


def test_adjustment_purpose_update_schema():
    payload = {"name": "Updated Damage"}
    schema = AdjustmentPurposeUpdate(**payload)
    assert schema.name == "Updated Damage"
    assert schema.status is None


def test_adjustment_purpose_read_schema():
    now = datetime.now(timezone.utc)
    uid = uuid.uuid4()
    item = AdjustmentPurpose(
        id=uid,
        name="Scrap",
        status=RecordStatus.ACTIVE,
        created_at=now,
        updated_at=now,
        version=1,
    )
    read = AdjustmentPurposeRead.model_validate(item)
    assert read.id == uid
    assert read.name == "Scrap"
    assert read.status == RecordStatus.ACTIVE


# ---------------------------------------------------------------------------
# 3. Model Tests
# ---------------------------------------------------------------------------

def test_adjustment_purpose_model_repr():
    item = AdjustmentPurpose(name="Self Use", status=RecordStatus.ACTIVE)
    assert repr(item) == "<AdjustmentPurpose name='Self Use' status=<RecordStatus.ACTIVE: 'active'>>"


# ---------------------------------------------------------------------------
# 4. Repository & Dependency Tests
# ---------------------------------------------------------------------------

def test_adjustment_purpose_repository_initialization():
    mock_session = AsyncMock()
    repo = AdjustmentPurposeRepository(mock_session)
    assert repo.model == AdjustmentPurpose
    assert "name" in repo.searchable_fields


@pytest.mark.asyncio
async def test_get_adjustment_purpose_service_dependency():
    mock_session = AsyncMock()
    mock_cache = MagicMock()
    service = await get_adjustment_purpose_service(mock_session, mock_cache)
    assert isinstance(service, AdjustmentPurposeService)
    assert service.repository.session == mock_session
    assert service.cache_manager == mock_cache


# ---------------------------------------------------------------------------
# 5. Service Layer Tests
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_adjustment_purpose_service_create():
    mock_repo = AsyncMock(spec=AdjustmentPurposeRepository)
    mock_cache = AsyncMock()
    mock_repo.get_by_name.return_value = None

    created_item = AdjustmentPurpose(
        id=uuid.uuid4(),
        name="Split",
        status=RecordStatus.ACTIVE,
    )
    mock_repo.create.return_value = created_item

    service = AdjustmentPurposeService(mock_repo, mock_cache)
    res = await service.create(name="Split", status=RecordStatus.ACTIVE)

    assert res.name == "Split"
    mock_repo.get_by_name.assert_called_once_with("Split")
    mock_repo.create.assert_called_once_with(name="Split", status=RecordStatus.ACTIVE)
    mock_cache.invalidate_dropdown.assert_called_once()


@pytest.mark.asyncio
async def test_adjustment_purpose_service_create_duplicate_conflict():
    mock_repo = AsyncMock(spec=AdjustmentPurposeRepository)
    mock_cache = AsyncMock()

    existing = AdjustmentPurpose(id=uuid.uuid4(), name="Free From Supplier", status=RecordStatus.ACTIVE)
    mock_repo.get_by_name.return_value = existing

    service = AdjustmentPurposeService(mock_repo, mock_cache)
    with pytest.raises(ConflictException) as exc_info:
        await service.create(name="Free From Supplier", status=RecordStatus.ACTIVE)

    assert "already exists" in str(exc_info.value)


@pytest.mark.asyncio
async def test_adjustment_purpose_service_get_by_id_or_raise_not_found():
    mock_repo = AsyncMock(spec=AdjustmentPurposeRepository)
    mock_cache = AsyncMock()
    mock_repo.get_by_id.return_value = None

    service = AdjustmentPurposeService(mock_repo, mock_cache)
    with pytest.raises(NotFoundException) as exc_info:
        await service.get_by_id_or_raise(uuid.uuid4())

    assert "not found" in str(exc_info.value)


@pytest.mark.asyncio
async def test_adjustment_purpose_service_activate_deactivate():
    mock_repo = AsyncMock(spec=AdjustmentPurposeRepository)
    mock_cache = AsyncMock()

    uid = uuid.uuid4()
    item = AdjustmentPurpose(id=uid, name="Removed Parts", status=RecordStatus.ACTIVE)
    mock_repo.get_by_id.return_value = item
    mock_repo.get_by_name.return_value = None

    service = AdjustmentPurposeService(mock_repo, mock_cache)
    await service.deactivate(uid)
    mock_repo.update.assert_awaited_with(item, status=RecordStatus.INACTIVE)

    await service.activate(uid)
    mock_repo.update.assert_awaited_with(item, status=RecordStatus.ACTIVE)


@pytest.mark.asyncio
async def test_adjustment_purpose_service_list_paginated():
    mock_repo = AsyncMock(spec=AdjustmentPurposeRepository)
    mock_cache = AsyncMock()

    items = [
        AdjustmentPurpose(id=uuid.uuid4(), name="Non Working (Damage)", status=RecordStatus.ACTIVE),
        AdjustmentPurpose(id=uuid.uuid4(), name="Theft / Loss", status=RecordStatus.ACTIVE),
    ]
    mock_repo.paginated_list.return_value = (items, 2)

    service = AdjustmentPurposeService(mock_repo, mock_cache)
    query = ListQueryParams(
        page=PageParams(page=1, page_size=10),
        search=SearchParams(),
        filters=FilterParams(),
        sort=SortParams(),
    )
    result_items, total = await service.list_paginated(query)

    assert total == 2
    assert len(result_items) == 2
    assert result_items[0].name == "Non Working (Damage)"
