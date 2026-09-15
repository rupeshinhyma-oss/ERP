"""
Unit & Integration Tests for Social Media Master Module.

Tests cover:
- Row validation for CSV/Excel imports
- Pydantic schemas (SocialMediaCreate, SocialMediaUpdate, SocialMediaRead)
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
from app.masters.social_media.constants import MODULE_NAME
from app.masters.social_media.models import SocialMedia
from app.masters.social_media.schemas import (
    SocialMediaCreate,
    SocialMediaRead,
    SocialMediaUpdate,
)
from app.masters.social_media.service import SocialMediaService
from app.masters.social_media.validators import validate_social_media_row


# ---------------------------------------------------------------------------
# 1. Validator Tests
# ---------------------------------------------------------------------------

def test_validate_social_media_row_valid():
    row = {
        "Name": "Facebook",
        "Status": "active",
    }
    result = validate_social_media_row(row, 1)
    assert result["name"] == "Facebook"
    assert result["status"] == RecordStatus.ACTIVE


def test_validate_social_media_row_missing_name():
    row = {
        "Name": "",
    }
    with pytest.raises(BadRequestException) as exc_info:
        validate_social_media_row(row, 2)
    assert "Name is required" in str(exc_info.value)


def test_validate_social_media_row_name_too_long():
    row = {
        "Name": "X" * 101,
    }
    with pytest.raises(BadRequestException) as exc_info:
        validate_social_media_row(row, 3)
    assert "cannot exceed 100 characters" in str(exc_info.value)


# ---------------------------------------------------------------------------
# 2. Schema Tests
# ---------------------------------------------------------------------------

def test_social_media_create_schema():
    payload = SocialMediaCreate(
        name="YouTube",
        status=RecordStatus.ACTIVE,
    )
    assert payload.name == "YouTube"
    assert payload.status == RecordStatus.ACTIVE


def test_social_media_update_schema():
    update = SocialMediaUpdate(name="Meta Facebook")
    assert update.name == "Meta Facebook"
    assert update.status is None


def test_social_media_read_schema():
    sid = uuid.uuid4()
    now = datetime.now(timezone.utc)
    model = SocialMedia(
        id=sid,
        name="Instagram",
        status=RecordStatus.ACTIVE,
        created_at=now,
        updated_at=now,
    )
    read = SocialMediaRead.model_validate(model)
    assert read.id == sid
    assert read.name == "Instagram"
    assert read.status == RecordStatus.ACTIVE


# ---------------------------------------------------------------------------
# 3. Model Tests
# ---------------------------------------------------------------------------

def test_social_media_model_repr():
    m = SocialMedia(
        id=uuid.uuid4(),
        name="Google",
        status=RecordStatus.ACTIVE,
    )
    repr_str = repr(m)
    assert "Google" in repr_str


# ---------------------------------------------------------------------------
# 4. Service Tests
# ---------------------------------------------------------------------------

@pytest.fixture
def mock_service():
    repo = AsyncMock()
    cache_mgr = AsyncMock()
    service = SocialMediaService(repository=repo, cache_manager=cache_mgr)
    return service, repo, cache_mgr


@pytest.mark.asyncio
async def test_social_media_service_create(mock_service):
    service, repo, cache_mgr = mock_service
    repo.get_by_name.return_value = None

    sid = uuid.uuid4()
    mock_item = SocialMedia(
        id=sid,
        name="TikTok",
        status=RecordStatus.ACTIVE,
    )
    repo.create.return_value = mock_item

    created = await service.create(name="TikTok")

    assert created.id == sid
    assert created.name == "TikTok"
    repo.create.assert_awaited_once()
    cache_mgr.invalidate_dropdown.assert_awaited_once()


@pytest.mark.asyncio
async def test_social_media_service_create_duplicate_name(mock_service):
    service, repo, _ = mock_service
    repo.get_by_name.return_value = SocialMedia(id=uuid.uuid4(), name="Facebook")

    with pytest.raises(ConflictException) as exc_info:
        await service.create(name="Facebook")

    assert "already in use" in str(exc_info.value)


@pytest.mark.asyncio
async def test_social_media_service_get_by_id_or_raise_not_found(mock_service):
    service, repo, _ = mock_service
    repo.get_by_id.return_value = None

    sid = uuid.uuid4()
    with pytest.raises(NotFoundException) as exc_info:
        await service.get_by_id_or_raise(sid)

    assert "not found" in str(exc_info.value)


@pytest.mark.asyncio
async def test_social_media_service_activate_deactivate(mock_service):
    service, repo, _ = mock_service

    sid = uuid.uuid4()
    item = SocialMedia(id=sid, name="LinkedIn")
    repo.get_by_id.return_value = item
    repo.update.side_effect = lambda entity, **kwargs: setattr(entity, "status", kwargs.get("status")) or entity

    deactivated = await service.deactivate(sid)
    assert deactivated.status == RecordStatus.INACTIVE

    activated = await service.activate(sid)
    assert activated.status == RecordStatus.ACTIVE
