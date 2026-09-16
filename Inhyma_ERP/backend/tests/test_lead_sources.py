"""
Unit & Integration Tests for Lead Sources Master Module.

Tests cover:
- Row validation for CSV/Excel imports
- Pydantic schemas (LeadSourceCreate, LeadSourceUpdate, LeadSourceRead)
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
from app.masters.lead_sources.models import LeadSource
from app.masters.lead_sources.schemas import (
    LeadSourceCreate,
    LeadSourceRead,
    LeadSourceUpdate,
)
from app.masters.lead_sources.service import LeadSourceService
from app.masters.lead_sources.validators import validate_lead_source_row
from app.masters.lead_sources.repository import LeadSourceRepository
from app.masters.lead_sources.dependencies import get_lead_source_service


# ---------------------------------------------------------------------------
# 1. Validator Tests
# ---------------------------------------------------------------------------

def test_validate_lead_source_row_valid():
    row = {
        "Name": "Own Website",
        "Status": "ACTIVE",
    }
    result = validate_lead_source_row(row, 1)
    assert result["name"] == "Own Website"
    assert result["status"] == RecordStatus.ACTIVE


def test_validate_lead_source_row_missing_name():
    row = {
        "Name": "",
        "Status": "ACTIVE",
    }
    with pytest.raises(BadRequestException) as exc_info:
        validate_lead_source_row(row, 2)
    assert "Name is required" in str(exc_info.value)


# ---------------------------------------------------------------------------
# 2. Schema Tests
# ---------------------------------------------------------------------------

def test_lead_source_create_schema():
    payload = LeadSourceCreate(name="Indiamart")
    assert payload.name == "Indiamart"
    assert payload.status == RecordStatus.ACTIVE


def test_lead_source_update_schema():
    payload = LeadSourceUpdate(name="Instagram Marketing", status=RecordStatus.INACTIVE)
    assert payload.name == "Instagram Marketing"
    assert payload.status == RecordStatus.INACTIVE


def test_lead_source_read_schema():
    tid = uuid.uuid4()
    now = datetime.now(timezone.utc)
    item = LeadSource(
        id=tid,
        name="Data Scrapping",
        status=RecordStatus.ACTIVE,
        created_at=now,
        updated_at=now,
        version=1,
    )
    read = LeadSourceRead.model_validate(item)
    assert read.id == tid
    assert read.name == "Data Scrapping"
    assert read.status == RecordStatus.ACTIVE


# ---------------------------------------------------------------------------
# 3. Model Tests
# ---------------------------------------------------------------------------

def test_lead_source_model_repr():
    item = LeadSource(
        id=uuid.uuid4(),
        name="Facebook Ads",
        status=RecordStatus.ACTIVE,
    )
    assert "Facebook Ads" in repr(item)


# ---------------------------------------------------------------------------
# 4. Repository & Dependency Tests
# ---------------------------------------------------------------------------

def test_lead_source_repository_initialization():
    session = MagicMock()
    repo = LeadSourceRepository(session)
    assert repo.session is session
    assert repo.model is LeadSource


@pytest.mark.asyncio
async def test_get_lead_source_service_dependency():
    session = MagicMock()
    cache_mgr = MagicMock()
    svc = await get_lead_source_service(session=session, cache_manager=cache_mgr)
    assert isinstance(svc.repository, LeadSourceRepository)
    assert svc.repository.model is LeadSource


# ---------------------------------------------------------------------------
# 5. Service Tests
# ---------------------------------------------------------------------------

@pytest.fixture
def mock_source_repo():
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
def source_service(mock_source_repo, mock_cache_mgr):
    return LeadSourceService(mock_source_repo, mock_cache_mgr)


@pytest.mark.asyncio
async def test_lead_source_service_create(source_service, mock_source_repo):
    mock_source_repo.get_by_name.return_value = None
    tid = uuid.uuid4()
    item = LeadSource(id=tid, name="Google Ads")
    mock_source_repo.create.return_value = item

    created = await source_service.create(name="Google Ads")
    assert created.id == tid
    mock_source_repo.create.assert_awaited_once_with(name="Google Ads")


@pytest.mark.asyncio
async def test_lead_source_service_create_duplicate_conflict(source_service, mock_source_repo):
    existing = LeadSource(id=uuid.uuid4(), name="Agent")
    mock_source_repo.get_by_name.return_value = existing

    with pytest.raises(ConflictException) as exc_info:
        await source_service.create(name="Agent")
    assert "already exists" in str(exc_info.value)


@pytest.mark.asyncio
async def test_lead_source_service_get_by_id_or_raise_not_found(source_service, mock_source_repo):
    mock_source_repo.get_by_id.return_value = None
    with pytest.raises(NotFoundException):
        await source_service.get_by_id_or_raise(uuid.uuid4())


@pytest.mark.asyncio
async def test_lead_source_service_activate_deactivate(source_service, mock_source_repo):
    tid = uuid.uuid4()
    item = LeadSource(id=tid, name="Other", status=RecordStatus.ACTIVE)
    mock_source_repo.get_by_id.return_value = item
    mock_source_repo.get_by_name.return_value = None

    await source_service.deactivate(tid)
    mock_source_repo.update.assert_awaited_with(item, status=RecordStatus.INACTIVE)

    await source_service.activate(tid)
    mock_source_repo.update.assert_awaited_with(item, status=RecordStatus.ACTIVE)


@pytest.mark.asyncio
async def test_lead_source_service_list_paginated(source_service, mock_source_repo):
    item = LeadSource(id=uuid.uuid4(), name="Indiamart")
    mock_source_repo.paginated_list.return_value = ([item], 1)

    query = ListQueryParams(
        page=PageParams(page=1, page_size=50),
        search=SearchParams(),
        sort=SortParams(),
        filters=FilterParams(),
    )
    items, total = await source_service.list_paginated(query)
    assert len(items) == 1
    assert total == 1
