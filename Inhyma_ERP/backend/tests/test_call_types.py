"""
Unit & Integration Tests for Call Types Master Module.

Tests cover:
- Row validation for CSV/Excel imports
- Pydantic schemas (CallTypeCreate, CallTypeUpdate, CallTypeRead)
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
from app.masters.call_types.models import CallType
from app.masters.call_types.schemas import (
    CallTypeCreate,
    CallTypeRead,
    CallTypeUpdate,
)
from app.masters.call_types.service import CallTypeService
from app.masters.call_types.validators import validate_call_type_row
from app.masters.call_types.repository import CallTypeRepository
from app.masters.call_types.dependencies import get_call_type_service


# ---------------------------------------------------------------------------
# 1. Validator Tests
# ---------------------------------------------------------------------------

def test_validate_call_type_row_valid():
    row = {
        "Name": "Repair",
        "Status": "ACTIVE",
    }
    result = validate_call_type_row(row, 1)
    assert result["name"] == "Repair"
    assert result["status"] == RecordStatus.ACTIVE


def test_validate_call_type_row_missing_name():
    row = {
        "Name": "",
        "Status": "ACTIVE",
    }
    with pytest.raises(BadRequestException) as exc_info:
        validate_call_type_row(row, 2)
    assert "Name is required" in str(exc_info.value)


# ---------------------------------------------------------------------------
# 2. Schema Tests
# ---------------------------------------------------------------------------

def test_call_type_create_schema():
    payload = {"name": "Demo", "status": RecordStatus.ACTIVE}
    schema = CallTypeCreate(**payload)
    assert schema.name == "Demo"
    assert schema.status == RecordStatus.ACTIVE


def test_call_type_update_schema():
    payload = {"name": "Updated Demo"}
    schema = CallTypeUpdate(**payload)
    assert schema.name == "Updated Demo"
    assert schema.status is None


def test_call_type_read_schema():
    now = datetime.now(timezone.utc)
    uid = uuid.uuid4()
    item = CallType(
        id=uid,
        name="Trial",
        status=RecordStatus.ACTIVE,
        created_at=now,
        updated_at=now,
        version=1,
    )
    read = CallTypeRead.model_validate(item)
    assert read.id == uid
    assert read.name == "Trial"
    assert read.status == RecordStatus.ACTIVE


# ---------------------------------------------------------------------------
# 3. Model Tests
# ---------------------------------------------------------------------------

def test_call_type_model_repr():
    item = CallType(name="Demo", status=RecordStatus.ACTIVE)
    assert repr(item) == "<CallType name='Demo' status=<RecordStatus.ACTIVE: 'active'>>"


# ---------------------------------------------------------------------------
# 4. Repository & Dependency Tests
# ---------------------------------------------------------------------------

def test_call_type_repository_initialization():
    mock_session = AsyncMock()
    repo = CallTypeRepository(mock_session)
    assert repo.model == CallType
    assert "name" in repo.searchable_fields


@pytest.mark.asyncio
async def test_get_call_type_service_dependency():
    mock_session = AsyncMock()
    mock_cache = MagicMock()
    service = await get_call_type_service(mock_session, mock_cache)
    assert isinstance(service, CallTypeService)
    assert service.repository.session == mock_session
    assert service.cache_manager == mock_cache


# ---------------------------------------------------------------------------
# 5. Service Layer Tests
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_call_type_service_create():
    mock_repo = AsyncMock(spec=CallTypeRepository)
    mock_cache = AsyncMock()
    mock_repo.get_by_name.return_value = None

    created_item = CallType(
        id=uuid.uuid4(),
        name="Repair",
        status=RecordStatus.ACTIVE,
    )
    mock_repo.create.return_value = created_item

    service = CallTypeService(mock_repo, mock_cache)
    res = await service.create(name="Repair", status=RecordStatus.ACTIVE)

    assert res.name == "Repair"
    mock_repo.get_by_name.assert_called_once_with("Repair")
    mock_repo.create.assert_called_once_with(name="Repair", status=RecordStatus.ACTIVE)
    mock_cache.invalidate_dropdown.assert_called_once()


@pytest.mark.asyncio
async def test_call_type_service_create_duplicate_conflict():
    mock_repo = AsyncMock(spec=CallTypeRepository)
    mock_cache = AsyncMock()

    existing = CallType(id=uuid.uuid4(), name="Demo", status=RecordStatus.ACTIVE)
    mock_repo.get_by_name.return_value = existing

    service = CallTypeService(mock_repo, mock_cache)
    with pytest.raises(ConflictException) as exc_info:
        await service.create(name="Demo", status=RecordStatus.ACTIVE)

    assert "already exists" in str(exc_info.value)


@pytest.mark.asyncio
async def test_call_type_service_get_by_id_or_raise_not_found():
    mock_repo = AsyncMock(spec=CallTypeRepository)
    mock_cache = AsyncMock()
    mock_repo.get_by_id.return_value = None

    service = CallTypeService(mock_repo, mock_cache)
    with pytest.raises(NotFoundException) as exc_info:
        await service.get_by_id_or_raise(uuid.uuid4())

    assert "not found" in str(exc_info.value)


@pytest.mark.asyncio
async def test_call_type_service_activate_deactivate():
    mock_repo = AsyncMock(spec=CallTypeRepository)
    mock_cache = AsyncMock()

    uid = uuid.uuid4()
    item = CallType(id=uid, name="Trial", status=RecordStatus.ACTIVE)
    mock_repo.get_by_id.return_value = item
    mock_repo.get_by_name.return_value = None

    service = CallTypeService(mock_repo, mock_cache)
    await service.deactivate(uid)
    mock_repo.update.assert_awaited_with(item, status=RecordStatus.INACTIVE)

    await service.activate(uid)
    mock_repo.update.assert_awaited_with(item, status=RecordStatus.ACTIVE)


@pytest.mark.asyncio
async def test_call_type_service_list_paginated():
    mock_repo = AsyncMock(spec=CallTypeRepository)
    mock_cache = AsyncMock()

    items = [
        CallType(id=uuid.uuid4(), name="Repair", status=RecordStatus.ACTIVE),
        CallType(id=uuid.uuid4(), name="Demo", status=RecordStatus.ACTIVE),
    ]
    mock_repo.paginated_list.return_value = (items, 2)

    service = CallTypeService(mock_repo, mock_cache)
    query = ListQueryParams(
        page=PageParams(page=1, page_size=10),
        search=SearchParams(),
        filters=FilterParams(),
        sort=SortParams(),
    )
    result_items, total = await service.list_paginated(query)

    assert total == 2
    assert len(result_items) == 2
    assert result_items[0].name == "Repair"
