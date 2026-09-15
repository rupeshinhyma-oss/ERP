"""
Unit & Integration Tests for Warehouses Master Module.

Tests cover:
- Row validation for CSV/Excel imports
- Pydantic schemas (WarehouseCreate, WarehouseUpdate, WarehouseRead)
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
from app.masters.warehouses.models import Warehouse
from app.masters.warehouses.schemas import (
    WarehouseCreate,
    WarehouseRead,
    WarehouseUpdate,
)
from app.masters.warehouses.service import WarehouseService
from app.masters.warehouses.validators import validate_warehouse_row


# ---------------------------------------------------------------------------
# 1. Validator Tests
# ---------------------------------------------------------------------------

def test_validate_warehouse_row_valid():
    row = {
        "Name": "Mumbai",
        "Address": "Mumbai Main Logistics Hub",
        "Billing Company": "INHYMA SOLUTIONS LLP (M)",
        "Over Selling": "No",
        "Is Primary": "Yes",
        "Color": "#2563EB",
        "Status": "active",
    }
    result = validate_warehouse_row(row, 1)
    assert result["name"] == "Mumbai"
    assert result["address"] == "Mumbai Main Logistics Hub"
    assert result["billing_company"] == "INHYMA SOLUTIONS LLP (M)"
    assert result["over_selling"] is False
    assert result["is_primary"] is True
    assert result["color"] == "#2563EB"
    assert result["status"] == RecordStatus.ACTIVE


def test_validate_warehouse_row_missing_name():
    row = {
        "Name": "",
        "Address": "Some Address",
    }
    with pytest.raises(BadRequestException) as exc_info:
        validate_warehouse_row(row, 2)
    assert "Name is required" in str(exc_info.value)


def test_validate_warehouse_row_missing_address():
    row = {
        "Name": "Ahmedabad",
        "Address": "",
    }
    with pytest.raises(BadRequestException) as exc_info:
        validate_warehouse_row(row, 3)
    assert "Address is required" in str(exc_info.value)


# ---------------------------------------------------------------------------
# 2. Schema Tests
# ---------------------------------------------------------------------------

def test_warehouse_create_schema():
    payload = WarehouseCreate(
        name="Indore",
        address="Indore Central Hub",
        billing_company="INHYMA SOLUTIONS LLP (MP)",
        over_selling=False,
        is_primary=True,
        color="#6366F1",
        status=RecordStatus.ACTIVE,
    )
    assert payload.name == "Indore"
    assert payload.address == "Indore Central Hub"
    assert payload.is_primary is True
    assert payload.color == "#6366F1"


def test_warehouse_update_schema():
    update = WarehouseUpdate(name="Indore Transit Hub", over_selling=True)
    assert update.name == "Indore Transit Hub"
    assert update.over_selling is True
    assert update.address is None


def test_warehouse_read_schema():
    wid = uuid.uuid4()
    now = datetime.now(timezone.utc)
    model = Warehouse(
        id=wid,
        name="Mumbai Transit",
        address="Mumbai Transit Facility",
        billing_company="INHYMA SOLUTIONS LLP (M)",
        over_selling=True,
        is_primary=False,
        color="#F59E0B",
        status=RecordStatus.ACTIVE,
        created_at=now,
        updated_at=now,
    )
    read = WarehouseRead.model_validate(model)
    assert read.id == wid
    assert read.name == "Mumbai Transit"
    assert read.over_selling is True
    assert read.is_primary is False


# ---------------------------------------------------------------------------
# 3. Model Tests
# ---------------------------------------------------------------------------

def test_warehouse_model_repr():
    m = Warehouse(
        id=uuid.uuid4(),
        name="Mumbai",
        billing_company="INHYMA SOLUTIONS LLP (M)",
        is_primary=True,
        status=RecordStatus.ACTIVE,
    )
    repr_str = repr(m)
    assert "Mumbai" in repr_str
    assert "INHYMA SOLUTIONS LLP (M)" in repr_str


# ---------------------------------------------------------------------------
# 4. Service Tests
# ---------------------------------------------------------------------------

@pytest.fixture
def mock_service():
    repo = AsyncMock()
    cache_mgr = AsyncMock()
    service = WarehouseService(repository=repo, cache_manager=cache_mgr)
    return service, repo, cache_mgr


@pytest.mark.asyncio
async def test_warehouse_service_create(mock_service):
    service, repo, cache_mgr = mock_service
    repo.get_by_name.return_value = None

    wid = uuid.uuid4()
    mock_item = Warehouse(
        id=wid,
        name="Ahmedabad Ordered",
        address="Ahmedabad Inbound Staging",
        billing_company="INHYMA SOLUTIONS LLP (G)",
        status=RecordStatus.ACTIVE,
    )
    repo.create.return_value = mock_item

    created = await service.create(
        name="Ahmedabad Ordered",
        address="Ahmedabad Inbound Staging",
        billing_company="INHYMA SOLUTIONS LLP (G)",
    )

    assert created.id == wid
    assert created.name == "Ahmedabad Ordered"
    repo.create.assert_awaited_once()
    cache_mgr.invalidate_dropdown.assert_awaited_once()


@pytest.mark.asyncio
async def test_warehouse_service_create_duplicate_name(mock_service):
    service, repo, _ = mock_service
    repo.get_by_name.return_value = Warehouse(id=uuid.uuid4(), name="Mumbai")

    with pytest.raises(ConflictException) as exc_info:
        await service.create(name="Mumbai", address="Address", billing_company="Company")

    assert "already in use" in str(exc_info.value)


@pytest.mark.asyncio
async def test_warehouse_service_get_by_id_or_raise_not_found(mock_service):
    service, repo, _ = mock_service
    repo.get_by_id.return_value = None

    wid = uuid.uuid4()
    with pytest.raises(NotFoundException) as exc_info:
        await service.get_by_id_or_raise(wid)

    assert "not found" in str(exc_info.value)


@pytest.mark.asyncio
async def test_warehouse_service_activate_deactivate(mock_service):
    service, repo, _ = mock_service

    wid = uuid.uuid4()
    item = Warehouse(id=wid, name="Indore")
    repo.get_by_id.return_value = item
    repo.update.side_effect = lambda entity, **kwargs: setattr(entity, "status", kwargs.get("status")) or entity

    deactivated = await service.deactivate(wid)
    assert deactivated.status == RecordStatus.INACTIVE

    activated = await service.activate(wid)
    assert activated.status == RecordStatus.ACTIVE
