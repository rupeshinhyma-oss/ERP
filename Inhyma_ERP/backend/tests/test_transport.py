"""
Unit & Integration Tests for Transport Master Module.

Tests cover:
- Row validation for CSV/Excel imports
- Pydantic schemas (TransportCreate, TransportUpdate, TransportRead)
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
from app.masters.transports.models import Transport
from app.masters.transports.schemas import (
    TransportCreate,
    TransportRead,
    TransportUpdate,
)
from app.masters.transports.service import TransportService
from app.masters.transports.validators import validate_transport_row
from app.masters.transports.repository import TransportRepository
from app.masters.transports.dependencies import get_transport_service


# ---------------------------------------------------------------------------
# 1. Validator Tests
# ---------------------------------------------------------------------------

def test_validate_transport_row_valid():
    row = {
        "Name": "JETHABHAI DOONGARSHI TRANSPORT COMPANY",
        "GST Number": "24AABFJ1234F1Z1",
        "Mobile": "9825012345",
        "Status": "ACTIVE",
    }
    result = validate_transport_row(row, 1)
    assert result["name"] == "JETHABHAI DOONGARSHI TRANSPORT COMPANY"
    assert result["gst_number"] == "24AABFJ1234F1Z1"
    assert result["mobile"] == "9825012345"
    assert result["status"] == RecordStatus.ACTIVE


def test_validate_transport_row_missing_name():
    row = {
        "Name": "",
        "GST Number": "24AABFJ1234F1Z1",
        "Mobile": "9825012345",
    }
    with pytest.raises(BadRequestException) as exc_info:
        validate_transport_row(row, 2)
    assert "Name is required" in str(exc_info.value)


def test_validate_transport_row_missing_gst():
    row = {
        "Name": "JETHABHAI DOONGARSHI TRANSPORT COMPANY",
        "GST Number": "",
        "Mobile": "9825012345",
    }
    with pytest.raises(BadRequestException) as exc_info:
        validate_transport_row(row, 3)
    assert "GST Number is required" in str(exc_info.value)


# ---------------------------------------------------------------------------
# 2. Schema Tests
# ---------------------------------------------------------------------------

def test_transport_create_schema():
    payload = TransportCreate(
        name="M. P. Transport (Indore)",
        gst_number="23AABFM5678M1Z2",
        mobile="9826023456",
    )
    assert payload.name == "M. P. Transport (Indore)"
    assert payload.gst_number == "23AABFM5678M1Z2"
    assert payload.status == RecordStatus.ACTIVE


def test_transport_update_schema():
    payload = TransportUpdate(name="Updated Transport", status=RecordStatus.INACTIVE)
    assert payload.name == "Updated Transport"
    assert payload.status == RecordStatus.INACTIVE
    assert payload.gst_number is None


def test_transport_read_schema():
    tid = uuid.uuid4()
    now = datetime.now(timezone.utc)
    item = Transport(
        id=tid,
        name="GUJARAT TRAVELS",
        gst_number="24AABCG9012G1Z8",
        mobile="9824089012",
        status=RecordStatus.ACTIVE,
        created_at=now,
        updated_at=now,
        version=1,
    )
    read = TransportRead.model_validate(item)
    assert read.id == tid
    assert read.name == "GUJARAT TRAVELS"
    assert read.gst_number == "24AABCG9012G1Z8"


# ---------------------------------------------------------------------------
# 3. Model Tests
# ---------------------------------------------------------------------------

def test_transport_model_repr():
    item = Transport(
        id=uuid.uuid4(),
        name="Sadanand Carriers",
        gst_number="27AABCS5678S1Z7",
        mobile="9821078901",
    )
    assert "Sadanand Carriers" in repr(item)
    assert "27AABCS5678S1Z7" in repr(item)


# ---------------------------------------------------------------------------
# 4. Repository & Dependency Tests
# ---------------------------------------------------------------------------

def test_transport_repository_initialization():
    session = MagicMock()
    repo = TransportRepository(session)
    assert repo.session is session
    assert repo.model is Transport


@pytest.mark.asyncio
async def test_get_transport_service_dependency():
    session = MagicMock()
    cache_mgr = MagicMock()
    svc = await get_transport_service(session=session, cache_manager=cache_mgr)
    assert isinstance(svc.repository, TransportRepository)
    assert svc.repository.model is Transport


# ---------------------------------------------------------------------------
# 5. Service Tests
# ---------------------------------------------------------------------------

@pytest.fixture
def mock_transport_repo():
    repo = MagicMock()
    repo.get_by_id = AsyncMock()
    repo.get_by_name = AsyncMock()
    repo.paginated_list = AsyncMock()
    repo.list_all = AsyncMock()
    repo.create = AsyncMock()
    repo.update = AsyncMock()
    repo.delete = AsyncMock()
    return repo


@pytest.fixture
def mock_cache_mgr():
    mgr = MagicMock()
    mgr.get_dropdown = AsyncMock(return_value=None)
    mgr.set_dropdown = AsyncMock()
    mgr.invalidate_dropdown = AsyncMock()
    return mgr


@pytest.fixture
def transport_service(mock_transport_repo, mock_cache_mgr):
    return TransportService(mock_transport_repo, mock_cache_mgr)


@pytest.mark.asyncio
async def test_transport_service_create(transport_service, mock_transport_repo):
    mock_transport_repo.get_by_name.return_value = None
    tid = uuid.uuid4()
    item = Transport(id=tid, name="New Transport", gst_number="24AABB1234Z1")
    mock_transport_repo.create.return_value = item

    created = await transport_service.create(name="New Transport", gst_number="24AABB1234Z1")
    assert created.id == tid
    mock_transport_repo.create.assert_awaited_once_with(name="New Transport", gst_number="24AABB1234Z1")


@pytest.mark.asyncio
async def test_transport_service_create_duplicate_conflict(transport_service, mock_transport_repo):
    existing = Transport(id=uuid.uuid4(), name="Existing Transport", gst_number="24AABB1234Z1")
    mock_transport_repo.get_by_name.return_value = existing

    with pytest.raises(ConflictException) as exc_info:
        await transport_service.create(name="Existing Transport", gst_number="24AABB1234Z1")
    assert "already in use" in str(exc_info.value)


@pytest.mark.asyncio
async def test_transport_service_get_by_id_or_raise_not_found(transport_service, mock_transport_repo):
    mock_transport_repo.get_by_id.return_value = None
    with pytest.raises(NotFoundException):
        await transport_service.get_by_id_or_raise(uuid.uuid4())


@pytest.mark.asyncio
async def test_transport_service_activate_deactivate(transport_service, mock_transport_repo):
    tid = uuid.uuid4()
    item = Transport(id=tid, name="Turanth Logistic", gst_number="24AABCT3456T1Z9", status=RecordStatus.ACTIVE)
    mock_transport_repo.get_by_id.return_value = item
    mock_transport_repo.get_by_name.return_value = None

    await transport_service.deactivate(tid)
    mock_transport_repo.update.assert_awaited_with(item, status=RecordStatus.INACTIVE)

    await transport_service.activate(tid)
    mock_transport_repo.update.assert_awaited_with(item, status=RecordStatus.ACTIVE)


@pytest.mark.asyncio
async def test_transport_service_list_paginated(transport_service, mock_transport_repo):
    item = Transport(id=uuid.uuid4(), name="Bombay Andhra Transport PS", gst_number="27AABFB9012B1Z3")
    mock_transport_repo.paginated_list.return_value = ([item], 1)

    query = ListQueryParams(
        page=PageParams(page=1, page_size=50),
        search=SearchParams(),
        sort=SortParams(),
        filters=FilterParams(),
    )
    items, total = await transport_service.list_paginated(query)
    assert len(items) == 1
    assert total == 1
