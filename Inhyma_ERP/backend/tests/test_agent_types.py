"""
Unit & Integration Tests for Agent Types Master Module.

Tests cover:
- Row validation for CSV/Excel imports
- Pydantic schemas (AgentTypeCreate, AgentTypeUpdate, AgentTypeRead)
- ORM model representation
- Service layer operations (CRUD, duplicate validation, activation/deactivation)
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.core.constants import RecordStatus
from app.core.exceptions import BadRequestException, ConflictException, NotFoundException
from app.masters.agent_types.constants import MODULE_NAME
from app.masters.agent_types.models import AgentType
from app.masters.agent_types.schemas import (
    AgentTypeCreate,
    AgentTypeRead,
    AgentTypeUpdate,
)
from app.masters.agent_types.service import AgentTypeService
from app.masters.agent_types.validators import validate_agent_type_row


# ---------------------------------------------------------------------------
# 1. Validator Tests
# ---------------------------------------------------------------------------

def test_validate_agent_type_row_valid():
    row = {
        "Name": "Sourcing Agent",
        "Description": "Assists with overseas procurement",
        "Status": "active",
    }
    result = validate_agent_type_row(row, 1)
    assert result["name"] == "Sourcing Agent"
    assert result["description"] == "Assists with overseas procurement"
    assert result["status"] == RecordStatus.ACTIVE


def test_validate_agent_type_row_missing_name():
    row = {
        "Name": "",
    }
    with pytest.raises(BadRequestException) as exc_info:
        validate_agent_type_row(row, 2)
    assert "Name is required" in str(exc_info.value)


def test_validate_agent_type_row_name_too_long():
    row = {
        "Name": "X" * 101,
    }
    with pytest.raises(BadRequestException) as exc_info:
        validate_agent_type_row(row, 3)
    assert "cannot exceed 100 characters" in str(exc_info.value)


# ---------------------------------------------------------------------------
# 2. Schema Tests
# ---------------------------------------------------------------------------

def test_agent_type_create_schema():
    payload = AgentTypeCreate(
        name="Sales Representative",
        description="Handles direct sales outreach",
        status=RecordStatus.ACTIVE,
    )
    assert payload.name == "Sales Representative"
    assert payload.description == "Handles direct sales outreach"
    assert payload.status == RecordStatus.ACTIVE


def test_agent_type_update_schema():
    update = AgentTypeUpdate(name="Senior Sourcing Agent")
    assert update.name == "Senior Sourcing Agent"
    assert update.description is None
    assert update.status is None


def test_agent_type_read_schema():
    aid = uuid.uuid4()
    now = datetime.now(timezone.utc)
    model = AgentType(
        id=aid,
        name="Export Partner",
        description="Key export partner",
        status=RecordStatus.ACTIVE,
        created_at=now,
        updated_at=now,
    )
    read = AgentTypeRead.model_validate(model)
    assert read.id == aid
    assert read.name == "Export Partner"
    assert read.status == RecordStatus.ACTIVE


# ---------------------------------------------------------------------------
# 3. Model Tests
# ---------------------------------------------------------------------------

def test_agent_type_model_repr():
    m = AgentType(
        id=uuid.uuid4(),
        name="Broker",
        status=RecordStatus.ACTIVE,
    )
    repr_str = repr(m)
    assert "Broker" in repr_str


# ---------------------------------------------------------------------------
# 4. Service Tests
# ---------------------------------------------------------------------------

@pytest.fixture
def mock_service():
    repo = AsyncMock()
    cache_mgr = AsyncMock()
    service = AgentTypeService(repository=repo, cache_manager=cache_mgr)
    return service, repo, cache_mgr


@pytest.mark.asyncio
async def test_agent_type_service_create(mock_service):
    service, repo, cache_mgr = mock_service
    repo.get_by_name.return_value = None

    aid = uuid.uuid4()
    mock_item = AgentType(
        id=aid,
        name="Broker Agent",
        status=RecordStatus.ACTIVE,
    )
    repo.create.return_value = mock_item

    created = await service.create(name="Broker Agent")

    assert created.id == aid
    assert created.name == "Broker Agent"
    repo.create.assert_awaited_once()
    cache_mgr.invalidate_dropdown.assert_awaited_once()


@pytest.mark.asyncio
async def test_agent_type_service_create_duplicate_name(mock_service):
    service, repo, _ = mock_service
    repo.get_by_name.return_value = AgentType(id=uuid.uuid4(), name="Broker Agent")

    with pytest.raises(ConflictException) as exc_info:
        await service.create(name="Broker Agent")

    assert "already in use" in str(exc_info.value)


@pytest.mark.asyncio
async def test_agent_type_service_get_by_id_or_raise_not_found(mock_service):
    service, repo, _ = mock_service
    repo.get_by_id.return_value = None

    aid = uuid.uuid4()
    with pytest.raises(NotFoundException) as exc_info:
        await service.get_by_id_or_raise(aid)

    assert "not found" in str(exc_info.value)


@pytest.mark.asyncio
async def test_agent_type_service_activate_deactivate(mock_service):
    service, repo, _ = mock_service

    aid = uuid.uuid4()
    item = AgentType(id=aid, name="Broker Agent")
    repo.get_by_id.return_value = item
    repo.update.side_effect = lambda entity, **kwargs: setattr(entity, "status", kwargs.get("status")) or entity

    deactivated = await service.deactivate(aid)
    assert deactivated.status == RecordStatus.INACTIVE

    activated = await service.activate(aid)
    assert activated.status == RecordStatus.ACTIVE
