"""
Unit & Integration Tests for Billing Company Master Module.

Tests cover:
- Row validation for CSV/Excel imports
- Pydantic schemas (BillingCompanyCreate, BillingCompanyUpdate, BillingCompanyRead)
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
from app.masters.billing_companies.models import BillingCompany
from app.masters.billing_companies.schemas import (
    BillingCompanyCreate,
    BillingCompanyRead,
    BillingCompanyUpdate,
)
from app.masters.billing_companies.service import BillingCompanyService
from app.masters.billing_companies.validators import validate_billing_company_row


# ---------------------------------------------------------------------------
# 1. Validator Tests
# ---------------------------------------------------------------------------

def test_validate_billing_company_row_valid():
    row = {
        "Billing Company Name": "INHYMA SOLUTIONS LLP (MP)",
        "Email": "Payment.Darsh@Gmail.Com",
        "Mobile": "9876543210",
        "Address": "Indore, MP",
        "City": "Indore",
        "Zip Code": "452001",
        "GST No": "23AABCI1234F1Z5",
        "Pancard": "AABCI1234F",
        "Sale Order Prefix": "IN/MP/SO/",
        "Proforma Invoice Prefix": "IN/MP/PI/",
        "Select Bank": "HDFC Bank",
        "Sale Order Term And Condition": "Payment terms apply",
        "Status": "active",
    }
    result = validate_billing_company_row(row, 1)
    assert result["name"] == "INHYMA SOLUTIONS LLP (MP)"
    assert result["email"] == "Payment.Darsh@Gmail.Com"
    assert result["mobile"] == "9876543210"
    assert result["city"] == "Indore"
    assert result["so_prefix"] == "IN/MP/SO/"
    assert result["pi_prefix"] == "IN/MP/PI/"
    assert result["bank_name"] == "HDFC Bank"
    assert result["status"] == RecordStatus.ACTIVE


def test_validate_billing_company_row_missing_name():
    row = {
        "Billing Company Name": "",
        "City": "Indore",
    }
    with pytest.raises(BadRequestException) as exc_info:
        validate_billing_company_row(row, 2)
    assert "Billing Company Name is required" in str(exc_info.value)


def test_validate_billing_company_row_missing_city():
    row = {
        "Billing Company Name": "INHYMA SOLUTIONS LLP",
        "City": "",
    }
    with pytest.raises(BadRequestException) as exc_info:
        validate_billing_company_row(row, 3)
    assert "City is required" in str(exc_info.value)


# ---------------------------------------------------------------------------
# 2. Schema Tests
# ---------------------------------------------------------------------------

def test_billing_company_create_schema():
    payload = BillingCompanyCreate(
        name="INHYMA SOLUTIONS LLP (G)",
        email="Payment.Darsh@Gmail.Com",
        city="Ahmedabad",
        so_prefix="IN/G/SO/",
        pi_prefix="IN/G/PI/",
        bank_name="HDFC Bank",
        status=RecordStatus.ACTIVE,
    )
    assert payload.name == "INHYMA SOLUTIONS LLP (G)"
    assert payload.city == "Ahmedabad"
    assert payload.so_prefix == "IN/G/SO/"
    assert payload.bank_name == "HDFC Bank"


def test_billing_company_update_schema():
    update = BillingCompanyUpdate(name="INHYMA SOLUTIONS NEW", mobile="9999999999")
    assert update.name == "INHYMA SOLUTIONS NEW"
    assert update.mobile == "9999999999"
    assert update.city is None


def test_billing_company_read_schema():
    cid = uuid.uuid4()
    now = datetime.now(timezone.utc)
    model = BillingCompany(
        id=cid,
        name="INHYMA SOLUTIONS LLP (M)",
        email="Payment.Darsh@Gmail.Com",
        city="Mumbai",
        so_prefix="IN/M/SO/",
        pi_prefix="IN/M/PI/",
        bank_name="HDFC Bank",
        status=RecordStatus.ACTIVE,
        created_at=now,
        updated_at=now,
    )
    read = BillingCompanyRead.model_validate(model)
    assert read.id == cid
    assert read.name == "INHYMA SOLUTIONS LLP (M)"
    assert read.city == "Mumbai"
    assert read.so_prefix == "IN/M/SO/"


# ---------------------------------------------------------------------------
# 3. Model Tests
# ---------------------------------------------------------------------------

def test_billing_company_model_repr():
    m = BillingCompany(
        id=uuid.uuid4(),
        name="INHYMA SOLUTIONS LLP (M)",
        email="Payment.Darsh@Gmail.Com",
        status=RecordStatus.ACTIVE,
    )
    repr_str = repr(m)
    assert "INHYMA SOLUTIONS LLP (M)" in repr_str
    assert "Payment.Darsh@Gmail.Com" in repr_str


# ---------------------------------------------------------------------------
# 4. Service Tests
# ---------------------------------------------------------------------------

@pytest.fixture
def mock_service():
    repo = AsyncMock()
    cache_mgr = AsyncMock()
    service = BillingCompanyService(repository=repo, cache_manager=cache_mgr)
    return service, repo, cache_mgr


@pytest.mark.asyncio
async def test_billing_company_service_create(mock_service):
    service, repo, cache_mgr = mock_service
    repo.get_by_name.return_value = None

    cid = uuid.uuid4()
    mock_item = BillingCompany(
        id=cid,
        name="INHYMA SOLUTIONS LLP (MP)",
        city="Indore",
        so_prefix="IN/MP/SO/",
        pi_prefix="IN/MP/PI/",
        bank_name="HDFC Bank",
        status=RecordStatus.ACTIVE,
    )
    repo.create.return_value = mock_item

    created = await service.create(
        name="INHYMA SOLUTIONS LLP (MP)",
        city="Indore",
        so_prefix="IN/MP/SO/",
        pi_prefix="IN/MP/PI/",
        bank_name="HDFC Bank",
    )

    assert created.id == cid
    assert created.name == "INHYMA SOLUTIONS LLP (MP)"
    repo.create.assert_awaited_once()
    cache_mgr.invalidate_dropdown.assert_awaited_once()


@pytest.mark.asyncio
async def test_billing_company_service_create_duplicate_name(mock_service):
    service, repo, _ = mock_service
    repo.get_by_name.return_value = BillingCompany(id=uuid.uuid4(), name="INHYMA SOLUTIONS LLP (M)")

    with pytest.raises(ConflictException) as exc_info:
        await service.create(name="INHYMA SOLUTIONS LLP (M)", city="Mumbai", so_prefix="SO/", pi_prefix="PI/", bank_name="Bank")

    assert "already in use" in str(exc_info.value)


@pytest.mark.asyncio
async def test_billing_company_service_get_by_id_or_raise_not_found(mock_service):
    service, repo, _ = mock_service
    repo.get_by_id.return_value = None

    cid = uuid.uuid4()
    with pytest.raises(NotFoundException) as exc_info:
        await service.get_by_id_or_raise(cid)

    assert "not found" in str(exc_info.value)


@pytest.mark.asyncio
async def test_billing_company_service_activate_deactivate(mock_service):
    service, repo, _ = mock_service

    cid = uuid.uuid4()
    item = BillingCompany(id=cid, name="INHYMA SOLUTIONS LLP (M)")
    repo.get_by_id.return_value = item
    repo.update.side_effect = lambda entity, **kwargs: setattr(entity, "status", kwargs.get("status")) or entity

    deactivated = await service.deactivate(cid)
    assert deactivated.status == RecordStatus.INACTIVE

    activated = await service.activate(cid)
    assert activated.status == RecordStatus.ACTIVE


@pytest.mark.asyncio
async def test_billing_company_service_list_paginated(mock_service):
    from app.common.filtering import FilterParams
    from app.common.list_query import ListQueryParams
    from app.common.pagination import PageMeta, PageParams
    from app.common.search import SearchParams
    from app.common.sorting import SortParams

    service, repo, _ = mock_service
    cid = uuid.uuid4()
    item = BillingCompany(id=cid, name="INHYMA SOLUTIONS LLP (M)", city="Mumbai", status=RecordStatus.ACTIVE)
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

