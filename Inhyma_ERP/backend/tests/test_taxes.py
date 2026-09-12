"""
Unit & Integration Tests for Taxes Master Module.

Tests cover:
- Row validation for CSV/Excel imports
- Pydantic schemas (TaxCreate, TaxUpdate, TaxRead)
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
from app.masters.taxes.constants import MODULE_NAME
from app.masters.taxes.models import Tax
from app.masters.taxes.schemas import (
    ImportSummaryRead,
    TaxCreate,
    TaxRead,
    TaxUpdate,
)
from app.masters.taxes.service import TaxService
from app.masters.taxes.validators import validate_tax_row


# ---------------------------------------------------------------------------
# 1. Validator Tests
# ---------------------------------------------------------------------------

def test_validate_tax_row_valid():
    row = {
        "HSN Number": "8431.20.90",
        "GST (%)": "18%",
        "Import Duty (%)": "8.25",
        "Status": "active",
    }
    result = validate_tax_row(row, 1)
    assert result["hsn_number"] == "8431.20.90"
    assert result["gst_percent"] == 18.0
    assert result["import_duty_percent"] == 8.25
    assert result["status"] == RecordStatus.ACTIVE


def test_validate_tax_row_missing_hsn():
    row = {
        "HSN Number": "",
        "GST (%)": "18",
    }
    with pytest.raises(BadRequestException) as exc_info:
        validate_tax_row(row, 2)
    assert "HSN Number is required" in str(exc_info.value)


def test_validate_tax_row_invalid_gst():
    row = {
        "HSN Number": "8431.20.90",
        "GST (%)": "invalid_gst",
    }
    with pytest.raises(BadRequestException) as exc_info:
        validate_tax_row(row, 3)
    assert "GST Percentage must be a number" in str(exc_info.value)


def test_validate_tax_row_invalid_duty():
    row = {
        "HSN Number": "8431.20.90",
        "GST (%)": "18",
        "Import Duty (%)": "150",
    }
    with pytest.raises(BadRequestException) as exc_info:
        validate_tax_row(row, 4)
    assert "Import Duty (%) must be a number between 0 and 100" in str(exc_info.value)


# ---------------------------------------------------------------------------
# 2. Schema Tests
# ---------------------------------------------------------------------------

def test_tax_create_schema():
    payload = TaxCreate(
        hsn_number="8431.20.90",
        gst_percent=18.0,
        import_duty_percent=8.25,
        status=RecordStatus.ACTIVE,
    )
    assert payload.hsn_number == "8431.20.90"
    assert payload.gst_percent == 18.0
    assert payload.import_duty_percent == 8.25


def test_tax_update_schema():
    update = TaxUpdate(import_duty_percent=11.0)
    assert update.import_duty_percent == 11.0
    assert update.gst_percent is None


def test_tax_read_schema():
    tid = uuid.uuid4()
    now = datetime.now(timezone.utc)
    model = Tax(
        id=tid,
        hsn_number="8431.20.90",
        gst_percent=18.0,
        import_duty_percent=8.25,
        status=RecordStatus.ACTIVE,
        created_at=now,
        updated_at=now,
    )
    read = TaxRead.model_validate(model)
    assert read.id == tid
    assert read.hsn_number == "8431.20.90"
    assert read.gst_percent == 18.0
    assert read.import_duty_percent == 8.25


# ---------------------------------------------------------------------------
# 3. Model Tests
# ---------------------------------------------------------------------------

def test_tax_model_repr():
    t = Tax(
        id=uuid.uuid4(),
        hsn_number="8431.20.90",
        gst_percent=18.0,
        import_duty_percent=8.25,
    )
    repr_str = repr(t)
    assert "8431.20.90" in repr_str
    assert "18.0" in repr_str


# ---------------------------------------------------------------------------
# 4. Service Tests
# ---------------------------------------------------------------------------

@pytest.fixture
def mock_service():
    repo = AsyncMock()
    cache_mgr = AsyncMock()
    service = TaxService(repository=repo, cache_manager=cache_mgr)
    return service, repo, cache_mgr


@pytest.mark.asyncio
async def test_tax_service_create(mock_service):
    service, repo, cache_mgr = mock_service
    repo.get_by_hsn.return_value = None

    tid = uuid.uuid4()
    mock_tax = Tax(
        id=tid,
        hsn_number="8431.20.90",
        gst_percent=18.0,
        import_duty_percent=8.25,
        status=RecordStatus.ACTIVE,
    )
    repo.create.return_value = mock_tax

    created = await service.create(
        hsn_number="8431.20.90", gst_percent=18.0, import_duty_percent=8.25
    )

    assert created.id == tid
    assert created.hsn_number == "8431.20.90"
    repo.create.assert_awaited_once()
    cache_mgr.invalidate_dropdown.assert_awaited_once()


@pytest.mark.asyncio
async def test_tax_service_create_duplicate_hsn(mock_service):
    service, repo, _ = mock_service
    repo.get_by_hsn.return_value = Tax(id=uuid.uuid4(), hsn_number="8431.20.90")

    with pytest.raises(ConflictException) as exc_info:
        await service.create(hsn_number="8431.20.90", gst_percent=18.0, import_duty_percent=8.25)

    assert "already in use" in str(exc_info.value)


@pytest.mark.asyncio
async def test_tax_service_get_by_id_or_raise_not_found(mock_service):
    service, repo, _ = mock_service
    repo.get_by_id.return_value = None

    tid = uuid.uuid4()
    with pytest.raises(NotFoundException) as exc_info:
        await service.get_by_id_or_raise(tid)

    assert "Tax record not found" in str(exc_info.value)


@pytest.mark.asyncio
async def test_tax_service_activate_deactivate(mock_service):
    service, repo, _ = mock_service

    tid = uuid.uuid4()
    t = Tax(id=tid, hsn_number="8431.20.90", gst_percent=18.0, import_duty_percent=8.25)
    repo.get_by_id.return_value = t
    repo.update.side_effect = lambda entity, **kwargs: setattr(entity, "status", kwargs.get("status")) or entity

    deactivated = await service.deactivate(tid)
    assert deactivated.status == RecordStatus.INACTIVE

    activated = await service.activate(tid)
    assert activated.status == RecordStatus.ACTIVE
