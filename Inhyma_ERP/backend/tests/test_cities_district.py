"""Tests for City master with district_id integration."""

import uuid
import pytest
from httpx import AsyncClient

from app.core.constants import RecordStatus
from app.masters.cities.schemas import CityCreate, CityUpdate, CityRead


def test_city_schemas_with_district_id():
    """Verify City schemas accept and validate district_id."""
    c_id = uuid.uuid4()
    s_id = uuid.uuid4()
    d_id = uuid.uuid4()

    # Create schema with district_id
    create_payload = CityCreate(
        country_id=c_id,
        state_id=s_id,
        district_id=d_id,
        name="Test City",
        status=RecordStatus.ACTIVE,
    )
    assert create_payload.district_id == d_id
    assert create_payload.name == "Test City"

    # Create schema without district_id (backward compatible)
    create_payload_no_district = CityCreate(
        country_id=c_id,
        state_id=s_id,
        name="Test City No District",
    )
    assert create_payload_no_district.district_id is None

    # Update schema
    update_payload = CityUpdate(district_id=d_id, name="Updated City")
    assert update_payload.district_id == d_id
    assert update_payload.name == "Updated City"
