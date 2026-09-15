"""
Unit & Integration Tests for Additional Charges Master Module.

Tests cover:
- Row validation for CSV/Excel imports
- Pydantic schemas (AdditionalChargeCreate, AdditionalChargeUpdate, AdditionalChargeRead)
- ORM model representation
- Service layer operations (CRUD, duplicate validation, activation/deactivation)
- Endpoint routing with FastAPI test client
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock

import pytest
from httpx import ASGITransport, AsyncClient
from pydantic import ValidationError

from app.core.constants import RecordStatus
from app.core.exceptions import BadRequestException, ConflictException, NotFoundException
from app.masters.additional_charges.constants import MODULE_NAME
from app.masters.additional_charges.models import AdditionalCharge
from app.masters.additional_charges.schemas import (
    AdditionalChargeCreate,
    AdditionalChargeRead,
    AdditionalChargeUpdate,
    ImportSummaryRead,
)
from app.masters.additional_charges.service import AdditionalChargeService
from app.masters.additional_charges.validators import validate_additional_charge_row


# ---------------------------------------------------------------------------
# 1. Validator Tests
# ---------------------------------------------------------------------------

def test_validate_additional_charge_row_valid():
    row = {
        "Name": "Transport Charges",
        "HSN": "996511",
        "GST Percentage": "18%",
        "Description": "Road freight",
        "Status": "active",
    }
    result = validate_additional_charge_row(row, 1)
    assert result["name"] == "Transport Charges"
    assert result["hsn_number"] == "996511"
    assert result["gst_percent"] == 18.0
    assert result["description"] == "Road freight"
    assert result["status"] == RecordStatus.ACTIVE


def test_validate_additional_charge_row_missing_name():
    row = {
        "Name": "",
        "GST Percentage": "18",
    }
    with pytest.raises(BadRequestException) as exc_info:
        validate_additional_charge_row(row, 2)
    assert "Name is required" in str(exc_info.value)


def test_validate_additional_charge_row_invalid_gst():
    row = {
        "Name": "Packing Charges",
        "GST Percentage": "invalid_gst",
    }
    with pytest.raises(BadRequestException) as exc_info:
        validate_additional_charge_row(row, 3)
    assert "GST Percentage must be a number" in str(exc_info.value)


def test_validate_additional_charge_row_out_of_bounds_gst():
    row = {
        "Name": "Packing Charges",
        "GST Percentage": "150",
    }
    with pytest.raises(BadRequestException) as exc_info:
        validate_additional_charge_row(row, 4)
    assert "between 0 and 100" in str(exc_info.value)


# ---------------------------------------------------------------------------
# 2. Schema Tests
# ---------------------------------------------------------------------------

def test_additional_charge_create_schema():
    payload = AdditionalChargeCreate(
        name="Transport Charges",
        hsn_number="996511",
        gst_percent=18.0,
        description="Standard logistics rate",
        status=RecordStatus.ACTIVE,
    )
    assert payload.name == "Transport Charges"
    assert payload.hsn_number == "996511"
    assert payload.gst_percent == 18.0
    assert payload.status == RecordStatus.ACTIVE


def test_additional_charge_update_schema():
    update = AdditionalChargeUpdate(gst_percent=12.0)
    assert update.gst_percent == 12.0
    assert update.name is None


def test_additional_charge_read_schema():
    cid = uuid.uuid4()
    now = datetime.now(timezone.utc)
    model = AdditionalCharge(
        id=cid,
        name="Packing & Forwarding Charges",
        hsn_number="996713",
        gst_percent=18.0,
        description=None,
        status=RecordStatus.ACTIVE,
        created_at=now,
        updated_at=now,
    )
    read = AdditionalChargeRead.model_validate(model)
    assert read.id == cid
    assert read.name == "Packing & Forwarding Charges"
    assert read.hsn_number == "996713"
    assert read.gst_percent == 18.0


# ---------------------------------------------------------------------------
# 3. Model Tests
# ---------------------------------------------------------------------------

def test_additional_charge_model_repr():
    c = AdditionalCharge(
        id=uuid.uuid4(),
        name="Transport Charges",
        hsn_number="996511",
        gst_percent=18.0,
    )
    repr_str = repr(c)
    assert "Transport Charges" in repr_str
    assert "996511" in repr_str


# ---------------------------------------------------------------------------
# 4. Service Tests
# ---------------------------------------------------------------------------

@pytest.fixture
def mock_service():
    repo = AsyncMock()
    cache_mgr = AsyncMock()
    service = AdditionalChargeService(repository=repo, cache_manager=cache_mgr)
    return service, repo, cache_mgr


@pytest.mark.asyncio
async def test_additional_charge_service_create(mock_service):
    service, repo, cache_mgr = mock_service
    repo.get_by_name.return_value = None

    cid = uuid.uuid4()
    mock_charge = AdditionalCharge(
        id=cid,
        name="Freight",
        hsn_number="996511",
        gst_percent=18.0,
        status=RecordStatus.ACTIVE,
    )
    repo.create.return_value = mock_charge

    created = await service.create(
        name="Freight", hsn_number="996511", gst_percent=18.0
    )

    assert created.id == cid
    assert created.name == "Freight"
    repo.create.assert_awaited_once()
    cache_mgr.invalidate_dropdown.assert_awaited_once()


@pytest.mark.asyncio
async def test_additional_charge_service_create_duplicate_name(mock_service):
    service, repo, _ = mock_service
    repo.get_by_name.return_value = AdditionalCharge(id=uuid.uuid4(), name="Freight")

    with pytest.raises(ConflictException) as exc_info:
        await service.create(name="Freight", gst_percent=18.0)

    assert "already in use" in str(exc_info.value)


@pytest.mark.asyncio
async def test_additional_charge_service_get_by_id_or_raise_not_found(mock_service):
    service, repo, _ = mock_service
    repo.get_by_id.return_value = None

    cid = uuid.uuid4()
    with pytest.raises(NotFoundException) as exc_info:
        await service.get_by_id_or_raise(cid)

    assert "not found" in str(exc_info.value)


@pytest.mark.asyncio
async def test_additional_charge_service_activate_deactivate(mock_service):
    service, repo, _ = mock_service

    cid = uuid.uuid4()
    c = AdditionalCharge(id=cid, name="Freight", gst_percent=18.0)
    repo.get_by_id.return_value = c
    repo.update.side_effect = lambda entity, **kwargs: setattr(entity, "status", kwargs.get("status")) or entity

    deactivated = await service.deactivate(cid)
    assert deactivated.status == RecordStatus.INACTIVE

    activated = await service.activate(cid)
    assert activated.status == RecordStatus.ACTIVE
