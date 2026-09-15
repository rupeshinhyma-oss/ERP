"""
Unit & Integration Tests for Technicians Master Module.

Tests cover:
- Row validation for CSV/Excel imports
- Pydantic schemas (TechnicianCreate, TechnicianUpdate, TechnicianRead)
- ORM model representation
- Service layer operations (CRUD, duplicate validation, activation/deactivation, paginated listing)
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from unittest.mock import AsyncMock

import pytest

from app.common.filtering import FilterParams
from app.common.list_query import ListQueryParams
from app.common.pagination import PageMeta, PageParams
from app.common.search import SearchParams
from app.common.sorting import SortParams
from app.core.constants import RecordStatus
from app.core.exceptions import BadRequestException, ConflictException, NotFoundException
from app.masters.technicians.models import Technician
from app.masters.technicians.schemas import (
    TechnicianCreate,
    TechnicianRead,
    TechnicianUpdate,
)
from app.masters.technicians.service import TechnicianService
from app.masters.technicians.validators import validate_technician_row


# ---------------------------------------------------------------------------
# 1. Validator Tests
# ---------------------------------------------------------------------------

def test_validate_technician_row_valid():
    row = {
        "Name": "Mangal Pandey",
        "Mobile": "7420960969",
        "City": "Mumbai",
        "Status": "active",
    }
    result = validate_technician_row(row, 1)
    assert result["name"] == "Mangal Pandey"
    assert result["mobile"] == "7420960969"
    assert result["city"] == "Mumbai"
    assert result["status"] == RecordStatus.ACTIVE


def test_validate_technician_row_missing_name():
    row = {
        "Name": "",
        "Mobile": "7420960969",
        "City": "Mumbai",
    }
    with pytest.raises(BadRequestException) as exc_info:
        validate_technician_row(row, 2)
    assert "Name is required" in str(exc_info.value)


def test_validate_technician_row_missing_mobile():
    row = {
        "Name": "Mangal Pandey",
        "Mobile": "",
        "City": "Mumbai",
    }
    with pytest.raises(BadRequestException) as exc_info:
        validate_technician_row(row, 3)
    assert "Mobile is required" in str(exc_info.value)


def test_validate_technician_row_missing_city():
    row = {
        "Name": "Mangal Pandey",
        "Mobile": "7420960969",
        "City": "",
    }
    with pytest.raises(BadRequestException) as exc_info:
        validate_technician_row(row, 4)
    assert "City is required" in str(exc_info.value)


# ---------------------------------------------------------------------------
# 2. Schema Tests
# ---------------------------------------------------------------------------

def test_technician_create_schema():
    payload = TechnicianCreate(
        name="Devendra Pandey",
        mobile="9987987923",
        city="Mumbai",
        password="securepassword123",
        status=RecordStatus.ACTIVE,
    )
    assert payload.name == "Devendra Pandey"
    assert payload.mobile == "9987987923"
    assert payload.city == "Mumbai"
    assert payload.password == "securepassword123"


def test_technician_update_schema():
    update = TechnicianUpdate(name="Devendra P.", mobile="9987987999")
    assert update.name == "Devendra P."
    assert update.mobile == "9987987999"
    assert update.city is None


def test_technician_read_schema():
    tid = uuid.uuid4()
    now = datetime.now(timezone.utc)
    model = Technician(
        id=tid,
        name="Devendra Marade",
        mobile="8657041027",
        city="Mumbai",
        status=RecordStatus.ACTIVE,
        created_at=now,
        updated_at=now,
    )
    read = TechnicianRead.model_validate(model)
    assert read.id == tid
    assert read.name == "Devendra Marade"
    assert read.mobile == "8657041027"
    assert read.city == "Mumbai"


# ---------------------------------------------------------------------------
# 3. Model Tests
# ---------------------------------------------------------------------------

def test_technician_model_repr():
    m = Technician(
        id=uuid.uuid4(),
        name="Mukesh Paudwal",
        mobile="9833390364",
        city="Mumbai",
        status=RecordStatus.ACTIVE,
    )
    repr_str = repr(m)
    assert "Mukesh Paudwal" in repr_str
    assert "9833390364" in repr_str
    assert "Mumbai" in repr_str


# ---------------------------------------------------------------------------
# 4. Service Tests
# ---------------------------------------------------------------------------

@pytest.fixture
def mock_service():
    repo = AsyncMock()
    cache_mgr = AsyncMock()
    service = TechnicianService(repository=repo, cache_manager=cache_mgr)
    return service, repo, cache_mgr


@pytest.mark.asyncio
async def test_technician_service_create(mock_service):
    service, repo, cache_mgr = mock_service
    repo.get_by_mobile.return_value = None

    tid = uuid.uuid4()
    mock_item = Technician(
        id=tid,
        name="Mangal Pandey",
        mobile="7420960969",
        city="Mumbai",
        status=RecordStatus.ACTIVE,
    )
    repo.create.return_value = mock_item

    created = await service.create(
        name="Mangal Pandey",
        mobile="7420960969",
        city="Mumbai",
        password="secretpassword",
    )

    assert created.id == tid
    assert created.name == "Mangal Pandey"
    repo.create.assert_awaited_once()
    cache_mgr.invalidate_dropdown.assert_awaited_once()


@pytest.mark.asyncio
async def test_technician_service_create_duplicate_mobile(mock_service):
    service, repo, _ = mock_service
    repo.get_by_mobile.return_value = Technician(id=uuid.uuid4(), name="Devendra", mobile="7420960969", city="Mumbai")

    with pytest.raises(ConflictException) as exc_info:
        await service.create(name="Mangal", mobile="7420960969", city="Mumbai")

    assert "already in use" in str(exc_info.value)


@pytest.mark.asyncio
async def test_technician_service_get_by_id_or_raise_not_found(mock_service):
    service, repo, _ = mock_service
    repo.get_by_id.return_value = None

    tid = uuid.uuid4()
    with pytest.raises(NotFoundException) as exc_info:
        await service.get_by_id_or_raise(tid)

    assert "not found" in str(exc_info.value)


@pytest.mark.asyncio
async def test_technician_service_activate_deactivate(mock_service):
    service, repo, _ = mock_service

    tid = uuid.uuid4()
    item = Technician(id=tid, name="Mangal", mobile="7420960969", city="Mumbai")
    repo.get_by_id.return_value = item
    repo.update.side_effect = lambda entity, **kwargs: setattr(entity, "status", kwargs.get("status")) or entity

    deactivated = await service.deactivate(tid)
    assert deactivated.status == RecordStatus.INACTIVE

    activated = await service.activate(tid)
    assert activated.status == RecordStatus.ACTIVE


@pytest.mark.asyncio
async def test_technician_service_list_paginated(mock_service):
    service, repo, _ = mock_service
    tid = uuid.uuid4()
    item = Technician(id=tid, name="Mangal Pandey", mobile="7420960969", city="Mumbai", status=RecordStatus.ACTIVE)
    repo.paginated_list.return_value = ([item], 1)

    query = ListQueryParams(
        page=PageParams(page=1, page_size=50),
        search=SearchParams(),
        sort=SortParams(),
        filters=FilterParams(),
    )
    items, total = await service.list_paginated(query)
    meta = PageMeta.build(page=query.page.page, page_size=query.page.page_size, total_records=total).as_meta_dict()

    assert len(items) == 1
    assert total == 1
    assert meta["pagination"]["current_page"] == 1
    assert meta["pagination"]["page_size"] == 50
    assert meta["pagination"]["total_records"] == 1
