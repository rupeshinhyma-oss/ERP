"""
Unit & Integration Tests for Payment Terms Master Module.

Tests cover:
- Row validation for CSV/Excel imports
- Pydantic schemas (PaymentTermCreate, PaymentTermUpdate, PaymentTermRead)
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
from app.masters.payment_terms.models import PaymentTerm
from app.masters.payment_terms.schemas import (
    PaymentTermCreate,
    PaymentTermRead,
    PaymentTermUpdate,
)
from app.masters.payment_terms.service import PaymentTermService
from app.masters.payment_terms.validators import validate_payment_term_row
from app.masters.payment_terms.repository import PaymentTermRepository
from app.masters.payment_terms.dependencies import get_payment_term_service


# ---------------------------------------------------------------------------
# 1. Validator Tests
# ---------------------------------------------------------------------------

def test_validate_payment_term_row_valid():
    row = {
        "Name": "30 Days Credit",
        "Status": "ACTIVE",
    }
    result = validate_payment_term_row(row, 1)
    assert result["name"] == "30 Days Credit"
    assert result["status"] == RecordStatus.ACTIVE


def test_validate_payment_term_row_missing_name():
    row = {
        "Name": "",
        "Status": "ACTIVE",
    }
    with pytest.raises(BadRequestException) as exc_info:
        validate_payment_term_row(row, 2)
    assert "Name is required" in str(exc_info.value)


# ---------------------------------------------------------------------------
# 2. Schema Tests
# ---------------------------------------------------------------------------

def test_payment_term_create_schema():
    payload = PaymentTermCreate(name="15 Days Credit")
    assert payload.name == "15 Days Credit"
    assert payload.status == RecordStatus.ACTIVE


def test_payment_term_update_schema():
    payload = PaymentTermUpdate(name="45 Days Credit", status=RecordStatus.INACTIVE)
    assert payload.name == "45 Days Credit"
    assert payload.status == RecordStatus.INACTIVE


def test_payment_term_read_schema():
    tid = uuid.uuid4()
    now = datetime.now(timezone.utc)
    item = PaymentTerm(
        id=tid,
        name="100% Advance",
        status=RecordStatus.ACTIVE,
        created_at=now,
        updated_at=now,
        version=1,
    )
    read = PaymentTermRead.model_validate(item)
    assert read.id == tid
    assert read.name == "100% Advance"
    assert read.status == RecordStatus.ACTIVE


# ---------------------------------------------------------------------------
# 3. Model Tests
# ---------------------------------------------------------------------------

def test_payment_term_model_repr():
    item = PaymentTerm(
        id=uuid.uuid4(),
        name="Partial Credit",
        status=RecordStatus.INACTIVE,
    )
    assert "Partial Credit" in repr(item)


# ---------------------------------------------------------------------------
# 4. Repository & Dependency Tests
# ---------------------------------------------------------------------------

def test_payment_term_repository_initialization():
    session = MagicMock()
    repo = PaymentTermRepository(session)
    assert repo.session is session
    assert repo.model is PaymentTerm


@pytest.mark.asyncio
async def test_get_payment_term_service_dependency():
    session = MagicMock()
    cache_mgr = MagicMock()
    svc = await get_payment_term_service(session=session, cache_manager=cache_mgr)
    assert isinstance(svc.repository, PaymentTermRepository)
    assert svc.repository.model is PaymentTerm


# ---------------------------------------------------------------------------
# 5. Service Tests
# ---------------------------------------------------------------------------

@pytest.fixture
def mock_term_repo():
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
def term_service(mock_term_repo, mock_cache_mgr):
    return PaymentTermService(mock_term_repo, mock_cache_mgr)


@pytest.mark.asyncio
async def test_payment_term_service_create(term_service, mock_term_repo):
    mock_term_repo.get_by_name.return_value = None
    tid = uuid.uuid4()
    item = PaymentTerm(id=tid, name="60 Days Credit")
    mock_term_repo.create.return_value = item

    created = await term_service.create(name="60 Days Credit")
    assert created.id == tid
    mock_term_repo.create.assert_awaited_once_with(name="60 Days Credit")


@pytest.mark.asyncio
async def test_payment_term_service_create_duplicate_conflict(term_service, mock_term_repo):
    existing = PaymentTerm(id=uuid.uuid4(), name="Existing Credit")
    mock_term_repo.get_by_name.return_value = existing

    with pytest.raises(ConflictException) as exc_info:
        await term_service.create(name="Existing Credit")
    assert "already exists" in str(exc_info.value)


@pytest.mark.asyncio
async def test_payment_term_service_get_by_id_or_raise_not_found(term_service, mock_term_repo):
    mock_term_repo.get_by_id.return_value = None
    with pytest.raises(NotFoundException):
        await term_service.get_by_id_or_raise(uuid.uuid4())


@pytest.mark.asyncio
async def test_payment_term_service_activate_deactivate(term_service, mock_term_repo):
    tid = uuid.uuid4()
    item = PaymentTerm(id=tid, name="Full Credit", status=RecordStatus.INACTIVE)
    mock_term_repo.get_by_id.return_value = item
    mock_term_repo.get_by_name.return_value = None

    await term_service.activate(tid)
    mock_term_repo.update.assert_awaited_with(item, status=RecordStatus.ACTIVE)

    await term_service.deactivate(tid)
    mock_term_repo.update.assert_awaited_with(item, status=RecordStatus.INACTIVE)


@pytest.mark.asyncio
async def test_payment_term_service_list_paginated(term_service, mock_term_repo):
    item = PaymentTerm(id=uuid.uuid4(), name="7 Days Credit")
    mock_term_repo.paginated_list.return_value = ([item], 1)

    query = ListQueryParams(
        page=PageParams(page=1, page_size=50),
        search=SearchParams(),
        sort=SortParams(),
        filters=FilterParams(),
    )
    items, total = await term_service.list_paginated(query)
    assert len(items) == 1
    assert total == 1
