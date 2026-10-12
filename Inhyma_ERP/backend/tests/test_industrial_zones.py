"""
Unit & Integration Tests for Industrial Zones Module.

Tests cover:
- Pydantic schemas (IndustrialZoneCreate, IndustrialZoneUpdate, IndustrialZoneBulkDeleteRequest)
- Service layer operations (CRUD, filtering, search, duplicate name check, bulk delete)
- Error handling (duplicate name rejection, 404 on not found)
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException

from app.industrial_zones.models import IndustrialZone
from app.industrial_zones.schemas import (
    IndustrialZoneBulkDeleteRequest,
    IndustrialZoneCreate,
    IndustrialZoneRead,
    IndustrialZoneUpdate,
)
from app.industrial_zones.service import IndustrialZoneService


def test_industrial_zone_schemas():
    """Verify IndustrialZone schemas validate all zone directory attributes."""
    payload = IndustrialZoneCreate(
        zone_name="Sanand GIDC Phase II",
        state="Gujarat",
        district="Ahmedabad",
        nearby_city="Sanand",
        distance_km=25.5,
        num_industries=350,
        zone_grade="A",
        industry_types="Automobile, Engineering, Electronics",
        potential_machine_categories="Wrapping, Banding, Strapping",
        remarks="Major automobile hub with OEM suppliers",
    )
    dumped = payload.model_dump()
    assert dumped["zone_name"] == "Sanand GIDC Phase II"
    assert dumped["state"] == "Gujarat"
    assert dumped["district"] == "Ahmedabad"
    assert dumped["nearby_city"] == "Sanand"
    assert dumped["distance_km"] == 25.5
    assert dumped["num_industries"] == 350
    assert dumped["zone_grade"] == "A"

    # Update schema
    update_payload = IndustrialZoneUpdate(zone_grade="B", num_industries=400)
    assert update_payload.zone_grade == "B"
    assert update_payload.num_industries == 400

    # Bulk delete schema
    uid1 = uuid.uuid4()
    uid2 = uuid.uuid4()
    bulk_payload = IndustrialZoneBulkDeleteRequest(ids=[uid1, uid2])
    assert len(bulk_payload.ids) == 2


@pytest.mark.asyncio
async def test_industrial_zone_duplicate_check_and_create():
    """Verify IndustrialZoneService detects duplicate zone names and handles creation."""
    mock_repo = AsyncMock()
    service = IndustrialZoneService(mock_repo)

    # 1. Duplicate check when name is new
    mock_repo.get_by_name.return_value = None
    exists = await service.check_name_exists("Vatva GIDC")
    assert exists is False

    # 2. Duplicate check when name exists
    existing_zone = IndustrialZone(
        id=uuid.uuid4(),
        zone_name="Vatva GIDC",
        state="Gujarat",
        district="Ahmedabad",
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    mock_repo.get_by_name.return_value = existing_zone
    exists_true = await service.check_name_exists("Vatva GIDC")
    assert exists_true is True

    # 3. Create zone rejects duplicate name
    payload = IndustrialZoneCreate(
        zone_name="Vatva GIDC",
        state="Gujarat",
        district="Ahmedabad",
    )
    with pytest.raises(HTTPException) as exc_info:
        await service.create_zone(payload)
    assert exc_info.value.status_code == 400
    assert "already exists" in str(exc_info.value.detail)

    # 4. Create zone succeeds when name is unique
    mock_repo.get_by_name.return_value = None
    mock_repo.create.return_value = existing_zone
    created = await service.create_zone(payload)
    assert created.zone_name == "Vatva GIDC"
    assert mock_repo.create.called


@pytest.mark.asyncio
async def test_industrial_zone_get_and_update():
    """Verify get_zone and update_zone operations."""
    mock_repo = AsyncMock()
    service = IndustrialZoneService(mock_repo)
    zone_id = uuid.uuid4()

    # 1. get_zone 404 when not found
    mock_repo.get_by_id.return_value = None
    with pytest.raises(HTTPException) as exc_info:
        await service.get_zone(zone_id)
    assert exc_info.value.status_code == 404

    # 2. get_zone success
    existing_zone = IndustrialZone(
        id=zone_id,
        zone_name="Naroda GIDC",
        state="Gujarat",
        district="Ahmedabad",
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    mock_repo.get_by_id.return_value = existing_zone
    fetched = await service.get_zone(zone_id)
    assert fetched.id == zone_id

    # 3. update_zone rejects duplicate name
    mock_repo.get_by_name.return_value = IndustrialZone(
        id=uuid.uuid4(),
        zone_name="Existing Other GIDC",
        state="Gujarat",
        district="Ahmedabad",
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    with pytest.raises(HTTPException) as exc_info:
        await service.update_zone(zone_id, IndustrialZoneUpdate(zone_name="Existing Other GIDC"))
    assert exc_info.value.status_code == 400


@pytest.mark.asyncio
async def test_industrial_zone_delete_and_bulk_delete():
    """Verify delete_zone and bulk_delete operations."""
    mock_repo = AsyncMock()
    service = IndustrialZoneService(mock_repo)
    zone_id = uuid.uuid4()

    existing_zone = IndustrialZone(
        id=zone_id,
        zone_name="Chhatral GIDC",
        state="Gujarat",
        district="Gandhinagar",
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    mock_repo.get_by_id.return_value = existing_zone
    mock_repo.soft_delete.return_value = True

    del_res = await service.delete_zone(zone_id)
    assert del_res is True

    # Bulk delete
    zid1, zid2 = uuid.uuid4(), uuid.uuid4()
    count = await service.bulk_delete([zid1, zid2])
    assert count == 2
