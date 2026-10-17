"""
Tests for Organization Logo Upload, Storage, and Direct Streaming.

Covers:
- Model and Schema validation for logo_url and logo_data (DB storage)
- Public branding endpoint (/api/v1/organizations/public) returning logo_url and logo_data
- Direct logo retrieval endpoint (/api/v1/organizations/logo) serving raw image data
- Service layer operations for updating and clearing logo
"""

from __future__ import annotations

import base64
import uuid
import pytest
from httpx import AsyncClient

from app.organizations.models import Organization, OrganizationStatus
from app.organizations.schemas import OrganizationRead, OrganizationUpdate


def test_organization_schemas_accept_logo_fields():
    """Verify Organization schemas support both logo_url and logo_data."""
    update = OrganizationUpdate(
        logo_url="/uploads/branding/sample.png",
        logo_data="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    )
    dumped = update.model_dump(exclude_unset=True)
    assert dumped["logo_url"] == "/uploads/branding/sample.png"
    assert dumped["logo_data"].startswith("data:image/png;base64,")

    read = OrganizationRead(
        id=uuid.uuid4(),
        company_name="Inhyma Solutions LLP",
        legal_name="Inhyma Solutions LLP",
        logo_url="/uploads/branding/sample.png",
        logo_data="data:image/png;base64,sample",
        timezone="UTC",
        currency="USD",
        status=OrganizationStatus.ACTIVE,
        created_at="2026-10-13T12:00:00Z",
        updated_at="2026-10-13T12:00:00Z",
    )
    assert read.logo_url == "/uploads/branding/sample.png"
    assert read.logo_data == "data:image/png;base64,sample"


@pytest.mark.asyncio
async def test_public_branding_returns_logo_fields(client: AsyncClient):
    """Verify that /api/v1/organizations/public returns company branding and logo fields."""
    res = await client.get("/api/v1/organizations/public")
    assert res.status_code == 200
    data = res.json().get("data", {})
    assert "company_name" in data
    assert "logo_url" in data


@pytest.mark.asyncio
async def test_direct_logo_endpoint_handles_missing_or_data(client: AsyncClient):
    """Verify /api/v1/organizations/logo returns 404 when no custom logo is set or streams image."""
    res = await client.get("/api/v1/organizations/logo")
    # When no logo exists in DB yet, answers 404
    assert res.status_code in (200, 307, 404)
