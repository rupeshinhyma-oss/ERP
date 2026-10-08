"""
Unit & Integration Tests for Follow-Ups Module.

Tests cover:
- Pydantic schemas (FollowUpCreate, FollowUpUpdate, FollowUpRead)
- Service layer operations (CRUD, filtering, search, bulk soft delete)
"""

from __future__ import annotations

import uuid
from datetime import date, datetime, timezone
from unittest.mock import AsyncMock

import pytest

from app.follow_ups.models import FollowUp
from app.follow_ups.schemas import FollowUpCreate, FollowUpRead, FollowUpUpdate
from app.follow_ups.service import FollowUpService


def test_follow_up_schemas():
    """Verify FollowUp schemas validate all follow-up attributes."""
    payload = FollowUpCreate(
        company_name="DURAPAK (VAPI)",
        contact_person="Ramesh Shah",
        contact_phone="9824056789",
        contact_email="ramesh@durapak.com",
        designation="Plant Head",
        business_type="Manufacturer",
        client_grade="Grade A",
        potential_type="High",
        business_category="Packaging Machinery",
        category="Industrial",
        call_type="Outgoing",
        call_category="Follow Up",
        marketing_person="Pooja Vani",
        current_status="Existing",
        feedback="Discussed quotation for sealing machines; client requested updated pricing by Friday.",
        address="Plot 42, GIDC Industrial Estate",
        area="GIDC",
        city="Vapi",
        district="Valsad",
        state="Gujarat",
        followup_date=date(2026, 10, 5),
    )
    dumped = payload.model_dump()
    assert dumped["company_name"] == "DURAPAK (VAPI)"
    assert dumped["call_type"] == "Outgoing"
    assert dumped["client_grade"] == "Grade A"
    assert dumped["city"] == "Vapi"
    assert dumped["marketing_person"] == "Pooja Vani"

    # Update schema
    update_payload = FollowUpUpdate(current_status="In Progress", feedback="Updated feedback notes.")
    assert update_payload.current_status == "In Progress"
    assert update_payload.feedback == "Updated feedback notes."


@pytest.mark.asyncio
async def test_follow_up_service_create_and_list():
    """Verify FollowUpService delegates to repository correctly."""
    mock_repo = AsyncMock()
    now = datetime.now(timezone.utc)
    item_id = uuid.uuid4()

    mock_item = FollowUp(
        id=item_id,
        company_name="Techno Auto Components Ltd",
        contact_person="Sunil Verma",
        contact_phone="9812345678",
        business_type="Manufacturer",
        client_grade="Grade A",
        call_type="Incoming",
        call_category="Inquiry Discussion",
        marketing_person="Admin",
        current_status="New",
        feedback="Client called regarding spare parts shipment schedule.",
        city="Ahmedabad",
        district="Ahmedabad",
        state="Gujarat",
        added_on=date.today(),
        created_at=now,
        updated_at=now,
    )
    mock_repo.create.return_value = mock_item
    mock_repo.list_follow_ups.return_value = ([mock_item], 1)
    mock_repo.get_by_id.return_value = mock_item

    service = FollowUpService(mock_repo)

    # 1. Create
    created = await service.create(
        FollowUpCreate(
            company_name="Techno Auto Components Ltd",
            call_type="Incoming",
            current_status="New",
        )
    )
    assert created.company_name == "Techno Auto Components Ltd"
    mock_repo.create.assert_called_once()

    # 2. List
    items, total = await service.list_follow_ups(search="Techno", limit=50, offset=0)
    assert total == 1
    assert len(items) == 1
    assert items[0].company_name == "Techno Auto Components Ltd"

    # 3. Get by ID
    found = await service.get_by_id(item_id)
    assert found.id == item_id

    # 4. Update
    mock_repo.update.return_value = mock_item
    updated = await service.update(item_id, FollowUpUpdate(feedback="New notes"))
    mock_repo.update.assert_called_once()

    # 5. Delete
    await service.delete(item_id)
    mock_repo.soft_delete.assert_called_once_with(mock_item)

    # 6. Bulk delete
    mock_repo.bulk_soft_delete.return_value = 2
    count = await service.bulk_delete([item_id, uuid.uuid4()])
    assert count == 2


@pytest.mark.asyncio
async def test_follow_up_lead_and_china_import_fields():
    """Verify lead status, reason for won/loss, and china import fields."""
    lead_payload = FollowUpCreate(
        company_name="Apex Packaging Machine Co",
        call_category="Lead",
        call_type="Telecall",
        lead_status="Won",
        reason_for_won_loss="Superior technical support and prompt quote delivery",
        direct_import_from_china="Yes",
        monthly_import_volume="4 Containers",
        entry_source="Outside",
        current_status="Existing",
    )
    dumped = lead_payload.model_dump()
    assert dumped["call_category"] == "Lead"
    assert dumped["lead_status"] == "Won"
    assert dumped["reason_for_won_loss"] == "Superior technical support and prompt quote delivery"
    assert dumped["direct_import_from_china"] == "Yes"
    assert dumped["monthly_import_volume"] == "4 Containers"
    assert dumped["entry_source"] == "Outside"

    mock_repo = AsyncMock()
    mock_item = FollowUp(
        id=uuid.uuid4(),
        company_name="Apex Packaging Machine Co",
        call_category="Lead",
        lead_status="Won",
        reason_for_won_loss="Superior technical support and prompt quote delivery",
        direct_import_from_china="Yes",
        monthly_import_volume="4 Containers",
        current_status="Existing",
        added_on=date.today(),
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    mock_repo.list_follow_ups.return_value = ([mock_item], 1)
    service = FollowUpService(mock_repo)

    items, total = await service.list_follow_ups(
        call_category="Lead",
        lead_status="Won",
        direct_import_from_china="Yes",
        monthly_import_volume="4 Containers",
    )
    assert total == 1
    assert items[0].lead_status == "Won"
    assert items[0].direct_import_from_china == "Yes"
    assert items[0].monthly_import_volume == "4 Containers"
    mock_repo.list_follow_ups.assert_called_once_with(
        search=None,
        call_type=None,
        marketing_person=None,
        business_type=None,
        state=None,
        district=None,
        city=None,
        current_status=None,
        category=None,
        client_grade=None,
        potential_type=None,
        business_category=None,
        company_name=None,
        call_category="Lead",
        direct_import_from_china="Yes",
        monthly_import_volume="4 Containers",
        lead_status="Won",
        entry_source=None,
        added_date=None,
        date_from=None,
        date_to=None,
        sort_by="created_at",
        sort_dir="desc",
        limit=50,
        offset=0,
    )

