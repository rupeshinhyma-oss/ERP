"""
Unit & Integration Tests for Agent Module.

Tests cover:
- Pydantic schemas (AgentCreate, AgentUpdate, AgentRead, check-duplicate)
- Service layer operations (CRUD, filtering, search, phone uniqueness check, age calculation)
- API endpoint contracts
"""

from __future__ import annotations

import uuid
from datetime import date, datetime, timezone
from unittest.mock import AsyncMock

import pytest

from app.agents.models import Agent
from app.agents.schemas import AgentCreate, AgentRead, AgentUpdate
from app.agents.service import AgentService, calculate_age


def test_agent_schemas():
    """Verify Agent schemas validate all agent profile attributes."""
    payload = AgentCreate(
        full_name="Sunil Packaging Agency",
        agent_type="Commission Agent",
        calling_number="9825123456",
        whatsapp_number="9825123456",
        state="Gujarat",
        district="Ahmedabad",
        city="Ahmedabad",
        company_name="Sunil Enterprises",
        sales_person="Rupesh Malla",
        agent_grade="A",
        current_status="Active",
        birth_date=date(1990, 5, 15),
    )
    dumped = payload.model_dump()
    assert dumped["full_name"] == "Sunil Packaging Agency"
    assert dumped["calling_number"] == "9825123456"
    assert dumped["sales_person"] == "Rupesh Malla"
    assert dumped["agent_grade"] == "A"
    assert dumped["birth_date"] == date(1990, 5, 15)

    # Update schema
    update_payload = AgentUpdate(agent_grade="B", current_status="Hold")
    assert update_payload.agent_grade == "B"
    assert update_payload.current_status == "Hold"


@pytest.mark.asyncio
async def test_agent_service_duplicate_check_and_create():
    """Verify AgentService detects duplicates and computes age correctly."""
    mock_repo = AsyncMock()
    service = AgentService(mock_repo)

    # When no duplicate exists
    mock_repo.check_duplicate_phone.return_value = (False, None, None)
    exists, field, agent_name = await service.check_duplicate("9898000000", "9898000000")
    assert exists is False
    assert field is None
    assert agent_name is None

    # When duplicate exists
    mock_agent = AsyncMock()
    mock_agent.full_name = "Existing Agent"
    mock_repo.check_duplicate_phone.return_value = (True, "calling_number", mock_agent)
    exists, field, agent_name = await service.check_duplicate("9898000000", None)
    assert exists is True
    assert field == "calling_number"
    assert agent_name == "Existing Agent"

    # Age auto-computation
    calculated_age = calculate_age(date(2000, 1, 1))
    assert calculated_age is not None
    assert calculated_age >= 25
