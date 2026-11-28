"""
Tests for Organization Logo Upload, Replacement, Removal, and Direct Streaming.

Covers:
- Model and Schema validation for logo_url and logo_data (DB storage)
- Public branding endpoint (/api/v1/organizations/public) returning logo_url and logo_data
- Direct logo retrieval endpoint (/api/v1/organizations/logo) serving raw image data or 404
- Uploading, replacing (deleting previous stored file), and deleting logo cleanly
"""

from __future__ import annotations

import base64
from types import SimpleNamespace
import uuid
from unittest.mock import AsyncMock, patch

from fastapi import FastAPI, Request
from httpx import ASGITransport, AsyncClient
import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.audit.dependencies import get_audit_service
from app.auth.dependencies import get_current_user
from app.core.exception_handlers import register_exception_handlers
from app.database.base import Base
from app.organizations.dependencies import get_organization_service
from app.organizations.models import Organization, OrganizationStatus
from app.organizations.repository import OrganizationRepository
from app.organizations.routes import router as org_router
from app.organizations.schemas import OrganizationRead, OrganizationUpdate
from app.organizations.service import OrganizationService
from app.rbac.dependencies import require_permission

_TINY_PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
_TINY_PNG_BYTES = base64.b64decode(_TINY_PNG_B64)


class _DummyCache:
    async def get_setting(self, _key: str):
        return None

    async def set_setting(self, _key: str, _value):
        return None

    async def invalidate_settings(self):
        return None


def test_organization_schemas_accept_logo_fields():
    """Verify Organization schemas support both logo_url and logo_data."""
    update = OrganizationUpdate(
        logo_url="/uploads/branding/sample.png",
        logo_data=f"data:image/png;base64,{_TINY_PNG_B64}",
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
    assert res.status_code in (200, 307, 404)


@pytest.mark.asyncio
async def test_logo_upload_replace_and_remove_lifecycle():
    """Verify uploading, replacing (deletes old file), and removing logo leaves DB columns & /public empty."""
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(bind=engine, class_=AsyncSession, expire_on_commit=False)

    async with factory() as db:
        repo = OrganizationRepository(db)
        org = await repo.create(company_name="Inhyma Solutions LLP", legal_name="Inhyma Solutions LLP")
        await db.commit()

        service = OrganizationService(repo, _DummyCache())  # type: ignore[arg-type]
        audit_service = SimpleNamespace(record=AsyncMock())
        actor = SimpleNamespace(
            id=uuid.uuid4(),
            username="admin",
            is_super_admin=True,
            permissions={"organization.manage", "*"},
        )

        app = FastAPI()

        @app.middleware("http")
        async def _req_id(request: Request, call_next):
            request.state.request_id = "test-org-logo-lifecycle"
            return await call_next(request)

        register_exception_handlers(app)
        app.include_router(org_router, prefix="/api/v1")
        app.dependency_overrides[get_organization_service] = lambda: service
        app.dependency_overrides[get_audit_service] = lambda: audit_service
        app.dependency_overrides[get_current_user] = lambda: actor
        for route in list(app.routes) + list(org_router.routes):
            dependant = getattr(route, "dependant", None)
            if dependant:
                for dep in getattr(dependant, "dependencies", []):
                    if getattr(dep.call, "__name__", "") == "_checker":
                        app.dependency_overrides[dep.call] = lambda: actor

        save_mock = AsyncMock(
            side_effect=[
                ("/uploads/branding/first.png", "first.png"),
                ("/uploads/branding/second.png", "second.png"),
            ]
        )
        delete_mock = AsyncMock(return_value=True)

        with (
            patch("app.organizations.routes.save_uploaded_file", save_mock),
            patch("app.organizations.routes.delete_stored_file", delete_mock),
        ):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
                # 1. Initial state: no logo
                pub_initial = await client.get("/api/v1/organizations/public")
                assert pub_initial.status_code == 200
                assert pub_initial.json()["data"]["logo_url"] is None
                assert (await client.get("/api/v1/organizations/logo")).status_code == 404

                # 2. Upload first logo
                up1 = await client.post(
                    "/api/v1/organizations/logo",
                    files={"file": ("logo1.png", _TINY_PNG_BYTES, "image/png")},
                )
                assert up1.status_code == 200
                assert up1.json()["data"]["logo_url"] == "/uploads/branding/first.png"
                assert delete_mock.await_count == 0

                # 3. Replace with second logo -> old logo file deleted
                up2 = await client.post(
                    "/api/v1/organizations/logo",
                    files={"file": ("logo2.png", _TINY_PNG_BYTES, "image/png")},
                )
                assert up2.status_code == 200
                assert up2.json()["data"]["logo_url"] == "/uploads/branding/second.png"
                assert delete_mock.await_count == 1
                assert delete_mock.await_args_list[0].args[0] == "/uploads/branding/first.png"

                # 4. PATCH company_name alone keeps logo intact
                patch_res = await client.patch("/api/v1/organizations", json={"company_name": "Updated Co"})
                assert patch_res.status_code == 200
                assert patch_res.json()["data"]["logo_url"] == "/uploads/branding/second.png"
                assert patch_res.json()["data"]["logo_data"] is not None

                # 5. Remove logo -> clears both logo_url & logo_data and deletes stored file
                del_res = await client.delete("/api/v1/organizations/logo")
                assert del_res.status_code == 200
                assert del_res.json()["data"]["logo_url"] is None
                assert del_res.json()["data"]["logo_data"] is None
                assert delete_mock.await_count == 2
                assert delete_mock.await_args_list[1].args[0] == "/uploads/branding/second.png"

                # 6. Subsequent public & /logo checks reflect blank removed state
                pub_after = await client.get("/api/v1/organizations/public")
                assert pub_after.status_code == 200
                assert pub_after.json()["data"]["logo_url"] is None
                assert pub_after.json()["data"]["logo_data"] is None
                assert (await client.get("/api/v1/organizations/logo")).status_code == 404

        assert org.id is not None
    await engine.dispose()
