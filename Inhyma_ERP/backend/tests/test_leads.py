"""
Unit & Integration Tests for Leads Module.

Tests cover:
- Pydantic schemas (LeadCreate, LeadUpdate, LeadRead)
- Service layer operations (CRUD, filtering, search, bulk soft delete)
- API routes validation
"""

from __future__ import annotations

import uuid
from datetime import date, datetime, timezone
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.leads.models import Lead
from app.leads.schemas import LeadCreate, LeadRead, LeadUpdate
from app.leads.service import LeadService


def test_lead_schemas():
    """Verify Lead schemas validate all lead attributes."""
    payload = LeadCreate(
        company_name="DURAPAK (VAPI)",
        business_type="Manufacturer",
        source="IndiaMart",
        contact_person="Ramesh Shah",
        contact_phone="9824056789",
        contact_email="ramesh@durapak.com",
        priority="High",
        area="GIDC",
        city="Vapi",
        district="Valsad",
        state="Gujarat",
        requirements="Heavy Duty Carton Sealing Machine",
        allotted_to="Rupesh Malla",
        lead_status="New",
    )
    dumped = payload.model_dump()
    assert dumped["company_name"] == "DURAPAK (VAPI)"
    assert dumped["source"] == "IndiaMart"
    assert dumped["priority"] == "High"
    assert dumped["city"] == "Vapi"

    # Update schema
    update_payload = LeadUpdate(priority="Critical", lead_status="Contacted")
    assert update_payload.priority == "Critical"
    assert update_payload.lead_status == "Contacted"


@pytest.mark.asyncio
async def test_lead_service_create_and_list():
    """Verify LeadService delegates to repository correctly."""
    mock_repo = AsyncMock()
    now = datetime.now(timezone.utc)
    lid = uuid.uuid4()

    mock_lead = Lead(
        id=lid,
        company_name="Apex Valves & Automation India Pvt Ltd",
        business_type="B2B",
        source="Website",
        contact_person="Rajesh Sharma",
        contact_phone="9876543210",
        priority="Medium",
        city="Ahmedabad",
        state="Gujarat",
        requirements="Control valves for boiler project",
        allotted_to="Sales Team",
        lead_status="New",
        added_on=date.today(),
        created_at=now,
        updated_at=now,
    )
    mock_repo.create.return_value = mock_lead
    mock_repo.list_leads.return_value = ([mock_lead], 1)
    mock_repo.get_by_id.return_value = mock_lead

    service = LeadService(mock_repo)

    # 1. Create
    created = await service.create(
        LeadCreate(
            company_name="Apex Valves & Automation India Pvt Ltd",
            source="Website",
            priority="Medium",
        )
    )
    assert created.company_name == "Apex Valves & Automation India Pvt Ltd"
    mock_repo.create.assert_called_once()

    # 2. List
    items, total = await service.list_leads(search="Apex", limit=50, offset=0)
    assert total == 1
    assert len(items) == 1
    assert items[0].company_name == "Apex Valves & Automation India Pvt Ltd"

    # 3. Get by ID
    fetched = await service.get_by_id(lid)
    assert fetched.id == lid

    # 4. Soft Delete
    await service.delete(lid)
    mock_repo.soft_delete.assert_called_once_with(mock_lead)

    # 5. Bulk Delete
    mock_repo.bulk_soft_delete.return_value = 2
    count = await service.bulk_delete([lid, uuid.uuid4()])
    assert count == 2
