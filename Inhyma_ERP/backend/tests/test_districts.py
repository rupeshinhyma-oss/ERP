"""
Unit & Integration Tests for Districts Master Module.

Tests cover:
- Row validation for CSV/Excel imports
- Pydantic schemas (DistrictCreate, DistrictUpdate, DistrictRead, DistrictLookupRead)
- ORM model defaults and behaviors
- Service layer operations (CRUD, duplicate validation, lookup filtering)
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock

import pytest
from pydantic import ValidationError

from app.core.constants import RecordStatus
from app.core.exceptions import BadRequestException, ConflictException, NotFoundException
from app.masters.districts.constants import MODULE_NAME
from app.masters.districts.models import District
from app.masters.districts.schemas import (
    DistrictCreate,
    DistrictLookupRead,
    DistrictRead,
    DistrictUpdate,
    ImportSummaryRead,
)
from app.masters.districts.service import DistrictService
from app.masters.districts.validators import validate_district_row
from app.masters.states.models import State


# ---------------------------------------------------------------------------
# 1. Validator Tests
# ---------------------------------------------------------------------------

def test_validate_district_row_valid():
    raw = {
        "name": "  Patna  ",
        "code": "  PAT  ",
        "country_code": "  in  ",
        "state_name": "  Bihar  ",
        "status": "active",
    }
    cleaned = validate_district_row(raw, row_number=2)
    assert cleaned["name"] == "Patna"
    assert cleaned["code"] == "PAT"
    assert cleaned["country_code"] == "IN"
    assert cleaned["state_name"] == "Bihar"
    assert cleaned["status"] == RecordStatus.ACTIVE


def test_validate_district_row_defaults_and_inactive():
    raw = {
        "name": "Gaya",
        "country_code": "IN",
        "state_name": "Bihar",
        "status": "inactive",
    }
    cleaned = validate_district_row(raw, row_number=3)
    assert cleaned["name"] == "Gaya"
    assert cleaned["code"] is None
    assert cleaned["status"] == RecordStatus.INACTIVE


def test_validate_district_row_missing_name():
    raw = {"name": "", "country_code": "IN", "state_name": "Bihar"}
    with pytest.raises(BadRequestException) as exc_info:
        validate_district_row(raw, row_number=4)
    assert "'name' is required" in str(exc_info.value)


def test_validate_district_row_missing_country():
    raw = {"name": "Patna", "country_code": "", "state_name": "Bihar"}
    with pytest.raises(BadRequestException) as exc_info:
        validate_district_row(raw, row_number=5)
    assert "'country_code' is required" in str(exc_info.value)


def test_validate_district_row_missing_state():
    raw = {"name": "Patna", "country_code": "IN", "state_name": ""}
    with pytest.raises(BadRequestException) as exc_info:
        validate_district_row(raw, row_number=6)
    assert "'state_name' is required" in str(exc_info.value)


def test_validate_district_row_invalid_status():
    raw = {"name": "Patna", "country_code": "IN", "state_name": "Bihar", "status": "pending"}
    with pytest.raises(BadRequestException) as exc_info:
        validate_district_row(raw, row_number=7)
    assert "invalid status" in str(exc_info.value)


# ---------------------------------------------------------------------------
# 2. Schema Tests
# ---------------------------------------------------------------------------

def test_district_create_schema():
    cid = uuid.uuid4()
    sid = uuid.uuid4()
    payload = DistrictCreate(country_id=cid, state_id=sid, name="Nalanda", code="NL")
    assert payload.name == "Nalanda"
    assert payload.code == "NL"
    assert payload.status == RecordStatus.ACTIVE
    assert payload.country_id == cid
    assert payload.state_id == sid


def test_district_create_schema_validation():
    with pytest.raises(ValidationError):
        DistrictCreate(name="", country_id=uuid.uuid4(), state_id=uuid.uuid4())  # empty name


def test_district_update_schema():
    payload = DistrictUpdate(name="Nalanda New", status=RecordStatus.INACTIVE)
    assert payload.name == "Nalanda New"
    assert payload.status == RecordStatus.INACTIVE
    assert payload.code is None
    assert payload.state_id is None


def test_district_lookup_read():
    sid = uuid.uuid4()
    did = uuid.uuid4()
    lookup = DistrictLookupRead(id=did, name="Rohtas", state_id=sid)
    assert lookup.id == did
    assert lookup.name == "Rohtas"
    assert lookup.state_id == sid


def test_district_read():
    now = datetime.now(timezone.utc)
    cid = uuid.uuid4()
    sid = uuid.uuid4()
    did = uuid.uuid4()
    read_obj = DistrictRead(
        id=did,
        country_id=cid,
        state_id=sid,
        name="Aurangabad",
        code="AUR",
        status=RecordStatus.ACTIVE,
        created_at=now,
        updated_at=now,
    )
    assert read_obj.id == did
    assert read_obj.name == "Aurangabad"
    assert read_obj.code == "AUR"


# ---------------------------------------------------------------------------
# 3. Model Tests
# ---------------------------------------------------------------------------

def test_district_model_instance():
    cid = uuid.uuid4()
    sid = uuid.uuid4()
    d = District(
        country_id=cid,
        state_id=sid,
        name="Muzaffarpur",
        code="MUZ",
        status=RecordStatus.ACTIVE,
    )
    assert d.name == "Muzaffarpur"
    assert d.code == "MUZ"
    assert d.status == RecordStatus.ACTIVE
    assert "District" in repr(d)
    assert "Muzaffarpur" in repr(d)


# ---------------------------------------------------------------------------
# 4. Service Unit Tests with AsyncMock
# ---------------------------------------------------------------------------

@pytest.fixture
def mock_service():
    repo = AsyncMock()
    state_repo = AsyncMock()
    country_repo = AsyncMock()
    cache_manager = AsyncMock()
    service = DistrictService(
        repository=repo,
        state_repository=state_repo,
        country_repository=country_repo,
        cache_manager=cache_manager,
    )
    return service, repo, state_repo, country_repo, cache_manager


@pytest.mark.asyncio
async def test_district_service_duplicate_name_conflict(mock_service):
    service, repo, state_repo, _, _ = mock_service

    cid = uuid.uuid4()
    sid = uuid.uuid4()

    # Mock state exists and belongs to country
    state_repo.get_by_id.return_value = State(id=sid, country_id=cid, name="Bihar")

    # Mock name already exists
    repo.name_exists_in_state.return_value = True

    with pytest.raises(ConflictException) as exc_info:
        await service.create(country_id=cid, state_id=sid, name="Patna")

    assert "already exists in this State" in str(exc_info.value)


@pytest.mark.asyncio
async def test_district_service_state_does_not_exist(mock_service):
    service, _, state_repo, _, _ = mock_service

    cid = uuid.uuid4()
    sid = uuid.uuid4()

    state_repo.get_by_id.return_value = None

    with pytest.raises(BadRequestException) as exc_info:
        await service.create(country_id=cid, state_id=sid, name="Patna")

    assert "The specified State does not exist" in str(exc_info.value)


@pytest.mark.asyncio
async def test_district_service_create_success(mock_service):
    service, repo, state_repo, _, cache_mgr = mock_service

    cid = uuid.uuid4()
    sid = uuid.uuid4()
    did = uuid.uuid4()

    state_repo.get_by_id.return_value = State(id=sid, country_id=cid, name="Bihar")
    repo.name_exists_in_state.return_value = False

    mock_district = District(
        id=did,
        country_id=cid,
        state_id=sid,
        name="Patna",
        code="PAT",
        status=RecordStatus.ACTIVE,
    )
    repo.create.return_value = mock_district

    created = await service.create(
        country_id=cid, state_id=sid, name="Patna", code="PAT"
    )

    assert created.id == did
    assert created.name == "Patna"
    repo.create.assert_awaited_once()
    cache_mgr.invalidate_dropdown.assert_awaited_once()


@pytest.mark.asyncio
async def test_district_service_list_by_state(mock_service):
    service, repo, _, _, _ = mock_service

    sid = uuid.uuid4()
    mock_district = District(
        id=uuid.uuid4(),
        country_id=uuid.uuid4(),
        state_id=sid,
        name="Bhojpur",
        status=RecordStatus.ACTIVE,
    )
    repo.list_by_state.return_value = [mock_district]

    result = await service.list_by_state(state_id=sid)
    assert len(result) == 1
    assert result[0].name == "Bhojpur"
    assert result[0].state_id == sid
    repo.list_by_state.assert_awaited_once_with(sid)


@pytest.mark.asyncio
async def test_district_service_get_by_id_or_raise_not_found(mock_service):
    service, repo, _, _, _ = mock_service
    repo.get_by_id.return_value = None

    did = uuid.uuid4()
    with pytest.raises(NotFoundException) as exc_info:
        await service.get_by_id_or_raise(did)

    assert "District not found" in str(exc_info.value)


@pytest.mark.asyncio
async def test_district_service_activate_deactivate(mock_service):
    service, repo, _, _, _ = mock_service

    did = uuid.uuid4()
    d = District(id=did, country_id=uuid.uuid4(), state_id=uuid.uuid4(), name="Purnia")
    repo.get_by_id.return_value = d
    repo.update.side_effect = lambda entity, **kwargs: setattr(entity, "status", kwargs.get("status")) or entity

    # Deactivate
    deactivated = await service.deactivate(did)
    assert deactivated.status == RecordStatus.INACTIVE

    # Activate
    activated = await service.activate(did)
    assert activated.status == RecordStatus.ACTIVE


# ---------------------------------------------------------------------------
# 5. Endpoint Integration Test
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_district_lookup_endpoint():
    """Verify the /lookup endpoint responds with success envelope for authenticated users."""
    from app.auth.dependencies import get_current_user
    from app.auth.service import CurrentUser
    from app.main import create_application
    from app.masters.districts.dependencies import get_district_service
    from httpx import ASGITransport, AsyncClient

    app = create_application()
    user = CurrentUser(
        id=uuid.uuid4(),
        username="test_district_user",
        permissions={"district.view"},
    )
    app.dependency_overrides[get_current_user] = lambda: user

    did = uuid.uuid4()
    sid = uuid.uuid4()
    cid = uuid.uuid4()
    mock_district = District(
        id=did,
        country_id=cid,
        state_id=sid,
        name="Patna",
        code="PAT",
        status=RecordStatus.ACTIVE,
    )

    mock_service = AsyncMock()
    mock_service.list_all_cached.return_value = [mock_district]
    mock_service.list_by_state.return_value = [mock_district]
    app.dependency_overrides[get_district_service] = lambda: mock_service

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as ac:
        response = await ac.get("/api/v1/masters/districts/lookup")
        assert response.status_code == 200
        body = response.json()
        assert body["success"] is True
        assert isinstance(body["data"], list)
        assert len(body["data"]) == 1
        item = body["data"][0]
        assert item["id"] == str(did)
        assert item["name"] == "Patna"
        assert item["state_id"] == str(sid)

        # Test filtered by state_id
        response_filtered = await ac.get(f"/api/v1/masters/districts/lookup?state_id={sid}")
        assert response_filtered.status_code == 200
        body_filtered = response_filtered.json()
        assert body_filtered["success"] is True
        assert len(body_filtered["data"]) == 1
        assert body_filtered["data"][0]["name"] == "Patna"


@pytest.mark.asyncio
async def test_list_districts_permission_enforcement():
    """Verify GET /api/v1/masters/districts requires district.view permission."""
    from app.auth.dependencies import get_current_user
    from app.auth.service import CurrentUser
    from app.main import create_application
    from app.masters.districts.dependencies import get_district_service
    from httpx import ASGITransport, AsyncClient

    app = create_application()

    # 1. User without district.view -> 403
    unauth_user = CurrentUser(
        id=uuid.uuid4(),
        username="no_district_perm_user",
        permissions={"city.view"},
    )
    app.dependency_overrides[get_current_user] = lambda: unauth_user

    mock_service = AsyncMock()
    mock_service.list_paginated.return_value = ([], 0)
    app.dependency_overrides[get_district_service] = lambda: mock_service

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as ac:
        res = await ac.get("/api/v1/masters/districts")
        assert res.status_code == 403
        assert "district.view" in res.json()["errors"][0]["message"]

    # 2. User with district.view -> 200
    auth_user = CurrentUser(
        id=uuid.uuid4(),
        username="district_perm_user",
        permissions={"district.view"},
    )
    app.dependency_overrides[get_current_user] = lambda: auth_user

    async with AsyncClient(transport=transport, base_url="http://testserver") as ac:
        res2 = await ac.get("/api/v1/masters/districts")
        assert res2.status_code == 200
        assert res2.json()["success"] is True




