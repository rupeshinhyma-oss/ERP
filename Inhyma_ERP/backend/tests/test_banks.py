"""
Unit & Integration Tests for Bank Master Module.

Tests cover:
- Row validation for CSV/Excel imports
- Pydantic schemas (BankCreate, BankUpdate, BankRead)
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
from app.common.pagination import PageParams
from app.common.search import SearchParams
from app.common.sorting import SortParams
from app.core.constants import RecordStatus
from app.core.exceptions import BadRequestException, ConflictException, NotFoundException
from app.masters.banks.models import Bank
from app.masters.banks.schemas import (
    BankCreate,
    BankRead,
    BankUpdate,
)
from app.masters.banks.service import BankService
from app.masters.banks.validators import validate_bank_row


# ---------------------------------------------------------------------------
# 1. Validator Tests
# ---------------------------------------------------------------------------

def test_validate_bank_row_valid():
    row = {
        "Bank Name": "HDFC BANK",
        "Account Number": "50200117491557",
        "Account Holder Name": "INHYMA SOLUTIONS LLP (GUJARAT)",
        "IFSC Code": "HDFC0000118",
        "Branch": "PARMESHWARI PLAZA MULUND (W)",
        "Status": "ACTIVE",
    }
    result = validate_bank_row(row, 1)
    assert result["bank_name"] == "HDFC BANK"
    assert result["account_number"] == "50200117491557"
    assert result["account_holder_name"] == "INHYMA SOLUTIONS LLP (GUJARAT)"
    assert result["ifsc_code"] == "HDFC0000118"
    assert result["branch"] == "PARMESHWARI PLAZA MULUND (W)"
    assert result["status"] == RecordStatus.ACTIVE


def test_validate_bank_row_missing_bank_name():
    row = {
        "Bank Name": "",
        "Account Number": "50200117491557",
        "Account Holder Name": "INHYMA SOLUTIONS LLP (GUJARAT)",
        "IFSC Code": "HDFC0000118",
        "Branch": "PARMESHWARI PLAZA MULUND (W)",
    }
    with pytest.raises(BadRequestException) as exc_info:
        validate_bank_row(row, 2)
    assert "Bank Name is required" in str(exc_info.value)


def test_validate_bank_row_missing_account_number():
    row = {
        "Bank Name": "HDFC BANK",
        "Account Number": "",
        "Account Holder Name": "INHYMA SOLUTIONS LLP (GUJARAT)",
        "IFSC Code": "HDFC0000118",
        "Branch": "PARMESHWARI PLAZA MULUND (W)",
    }
    with pytest.raises(BadRequestException) as exc_info:
        validate_bank_row(row, 3)
    assert "Account Number is required" in str(exc_info.value)


def test_validate_bank_row_missing_holder_name():
    row = {
        "Bank Name": "HDFC BANK",
        "Account Number": "50200117491557",
        "Account Holder Name": "",
        "IFSC Code": "HDFC0000118",
        "Branch": "PARMESHWARI PLAZA MULUND (W)",
    }
    with pytest.raises(BadRequestException) as exc_info:
        validate_bank_row(row, 4)
    assert "Account Holder Name is required" in str(exc_info.value)


# ---------------------------------------------------------------------------
# 2. Schema Tests
# ---------------------------------------------------------------------------

def test_bank_create_schema():
    payload = {
        "bank_name": "HDFC BANK",
        "account_number": "50200117491557",
        "account_holder_name": "INHYMA SOLUTIONS LLP (GUJARAT)",
        "ifsc_code": "HDFC0000118",
        "branch": "PARMESHWARI PLAZA MULUND (W)",
    }
    schema = BankCreate(**payload)
    assert schema.bank_name == "HDFC BANK"
    assert schema.account_number == "50200117491557"
    assert schema.status == RecordStatus.ACTIVE


def test_bank_update_schema():
    schema = BankUpdate(branch="ANDHERI EAST")
    assert schema.branch == "ANDHERI EAST"
    assert schema.bank_name is None


def test_bank_read_schema():
    now = datetime.now(timezone.utc)
    bid = uuid.uuid4()
    read = BankRead(
        id=bid,
        bank_name="HDFC BANK",
        account_number="50200117491557",
        account_holder_name="INHYMA SOLUTIONS LLP (GUJARAT)",
        ifsc_code="HDFC0000118",
        branch="PARMESHWARI PLAZA MULUND (W)",
        status=RecordStatus.ACTIVE,
        created_at=now,
        updated_at=now,
        version=1,
    )
    assert read.id == bid
    assert read.account_number == "50200117491557"


# ---------------------------------------------------------------------------
# 3. Model Tests
# ---------------------------------------------------------------------------

def test_bank_model_repr():
    bank = Bank(
        id=uuid.uuid4(),
        bank_name="HDFC BANK",
        account_number="50200117491557",
        account_holder_name="INHYMA SOLUTIONS LLP (GUJARAT)",
        ifsc_code="HDFC0000118",
        branch="PARMESHWARI PLAZA MULUND (W)",
        status=RecordStatus.ACTIVE,
    )
    assert "<Bank bank_name='HDFC BANK' account_number='50200117491557'>" in repr(bank)


# ---------------------------------------------------------------------------
# 4. Service Tests
# ---------------------------------------------------------------------------

@pytest.fixture
def mock_bank_repo():
    repo = AsyncMock()
    return repo


@pytest.fixture
def mock_cache_mgr():
    mgr = AsyncMock()
    mgr.get_dropdown.return_value = None
    return mgr


@pytest.fixture
def bank_service(mock_bank_repo, mock_cache_mgr):
    return BankService(repository=mock_bank_repo, cache_manager=mock_cache_mgr)


@pytest.mark.asyncio
async def test_bank_service_create(bank_service, mock_bank_repo, mock_cache_mgr):
    bid = uuid.uuid4()
    mock_bank_repo.get_by_account_number.return_value = None
    mock_bank_repo.create.return_value = Bank(
        id=bid,
        bank_name="HDFC BANK",
        account_number="50200117491557",
        account_holder_name="INHYMA SOLUTIONS LLP (GUJARAT)",
        ifsc_code="HDFC0000118",
        branch="PARMESHWARI PLAZA MULUND (W)",
        status=RecordStatus.ACTIVE,
    )

    created = await bank_service.create(
        bank_name="HDFC BANK",
        account_number="50200117491557",
        account_holder_name="INHYMA SOLUTIONS LLP (GUJARAT)",
        ifsc_code="HDFC0000118",
        branch="PARMESHWARI PLAZA MULUND (W)",
    )
    assert created.id == bid
    assert created.account_number == "50200117491557"
    mock_cache_mgr.invalidate_dropdown.assert_awaited_once()


@pytest.mark.asyncio
async def test_bank_service_create_duplicate_account_number(bank_service, mock_bank_repo):
    mock_bank_repo.get_by_account_number.return_value = Bank(
        id=uuid.uuid4(),
        bank_name="HDFC BANK",
        account_number="50200117491557",
        account_holder_name="INHYMA SOLUTIONS LLP (GUJARAT)",
        ifsc_code="HDFC0000118",
        branch="PARMESHWARI PLAZA MULUND (W)",
        status=RecordStatus.ACTIVE,
    )

    with pytest.raises(ConflictException) as exc_info:
        await bank_service.create(
            bank_name="HDFC BANK",
            account_number="50200117491557",
            account_holder_name="INHYMA SOLUTIONS LLP (GUJARAT)",
            ifsc_code="HDFC0000118",
            branch="PARMESHWARI PLAZA MULUND (W)",
        )
    assert "already in use" in str(exc_info.value)


@pytest.mark.asyncio
async def test_bank_service_get_by_id_or_raise_not_found(bank_service, mock_bank_repo):
    mock_bank_repo.get_by_id.return_value = None
    bid = uuid.uuid4()
    with pytest.raises(NotFoundException):
        await bank_service.get_by_id_or_raise(bid)


@pytest.mark.asyncio
async def test_bank_service_activate_deactivate(bank_service, mock_bank_repo):
    bid = uuid.uuid4()
    item = Bank(
        id=bid,
        bank_name="HDFC BANK",
        account_number="50200117491557",
        account_holder_name="INHYMA SOLUTIONS LLP (GUJARAT)",
        ifsc_code="HDFC0000118",
        branch="PARMESHWARI PLAZA MULUND (W)",
        status=RecordStatus.ACTIVE,
    )
    mock_bank_repo.get_by_id.return_value = item
    mock_bank_repo.get_by_account_number.return_value = None

    await bank_service.deactivate(bid)
    mock_bank_repo.update.assert_awaited_with(item, status=RecordStatus.INACTIVE)

    await bank_service.activate(bid)
    mock_bank_repo.update.assert_awaited_with(item, status=RecordStatus.ACTIVE)


@pytest.mark.asyncio
async def test_bank_service_list_paginated(bank_service, mock_bank_repo):
    bid = uuid.uuid4()
    item = Bank(
        id=bid,
        bank_name="HDFC BANK",
        account_number="50200117491557",
        account_holder_name="INHYMA SOLUTIONS LLP (GUJARAT)",
        ifsc_code="HDFC0000118",
        branch="PARMESHWARI PLAZA MULUND (W)",
        status=RecordStatus.ACTIVE,
    )
    mock_bank_repo.paginated_list.return_value = ([item], 1)

    query = ListQueryParams(
        page=PageParams(page=1, page_size=50),
        search=SearchParams(),
        sort=SortParams(),
        filters=FilterParams(),
    )
    items, total = await bank_service.list_paginated(query)
    assert len(items) == 1
    assert total == 1


# ---------------------------------------------------------------------------
# 5. Repository & Dependency Tests
# ---------------------------------------------------------------------------

def test_bank_repository_initialization():
    """Verify BankRepository instantiates correctly with session and attaches Bank model."""
    from unittest.mock import MagicMock
    from app.masters.banks.repository import BankRepository

    session = MagicMock()
    repo = BankRepository(session)
    assert repo.session is session
    assert repo.model is Bank


@pytest.mark.asyncio
async def test_get_bank_service_dependency():
    """Verify get_bank_service dependency builds service with BankRepository."""
    from unittest.mock import MagicMock
    from app.masters.banks.dependencies import get_bank_service
    from app.masters.banks.repository import BankRepository

    session = MagicMock()
    cache_manager = MagicMock()
    service = await get_bank_service(session=session, cache_manager=cache_manager)
    assert isinstance(service.repository, BankRepository)
    assert service.repository.model is Bank

