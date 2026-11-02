"""
Unit and route tests for Display Name primary identity & internal-only username governance.

Covers:
- ProfileResponse and CurrentUser display_name / full_name / actor_label resolution.
- Best-effort push_profile_to_erp_main sync to ERP_Main (/internal/users/profile).
- POST /api/v1/internal/users/provision syncing display_name on existing users while preserving username.
- PATCH /api/v1/users/{user_id} preserving internal username when omitted/None and pushing display_name to ERP_Main.
- GET /api/v1/companies/sales-persons prioritizing display_name first in full_name.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

import httpx
import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.auth.dependencies import get_current_user
from app.auth.schemas import ProfileResponse
from app.auth.service import CurrentUser
from app.core.config import settings
from app.database.base import Base
from app.database.session import get_db_session
from app.federation import erp_main_client
from app.main import create_application
from app.users import routes as user_routes
from app.users.models import User, UserStatus


def test_profile_response_and_current_user_display_name_defaults_and_priority():
    uid = uuid.uuid4()
    now = datetime.now(timezone.utc)

    profile = ProfileResponse(
        id=uid,
        first_name="First",
        last_name="Last",
        display_name="Primary Display",
        full_name="Primary Display",
        employee_code="EMP-01",
        username="internal_u",
        email="u@example.com",
        phone=None,
        status="ACTIVE",
        is_active=True,
        must_change_password=False,
        last_login_at=None,
        password_changed_at=None,
        created_at=now,
        roles=["user"],
        permissions=[],
    )
    dumped = profile.model_dump(mode="json")
    assert dumped["display_name"] == "Primary Display"
    assert dumped["full_name"] == "Primary Display"

    # Safe default instantiation for tests that omit display_name / full_name
    cu_legacy = CurrentUser(id=uid, username="legacy_handle")
    assert cu_legacy.display_name == ""
    assert cu_legacy.full_name == ""
    assert cu_legacy.actor_label == "legacy_handle"

    # Display name takes precedence over full_name and username
    cu_named = CurrentUser(
        id=uid,
        username="legacy_handle",
        display_name="Rupesh Malla",
        full_name="First Last",
    )
    assert cu_named.actor_label == "Rupesh Malla"


@pytest.mark.asyncio
async def test_push_profile_to_erp_main_best_effort(monkeypatch):
    seen: dict = {}

    class _Resp:
        def __init__(self, status_code: int):
            self.status_code = status_code

    class FakeClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        async def post(self, url, json=None, headers=None):
            if seen.get("boom"):
                raise httpx.ConnectError("offline")
            seen["url"] = url
            seen["json"] = json
            seen["headers"] = headers
            return _Resp(seen.get("status", 200))

    monkeypatch.setattr(erp_main_client.httpx, "AsyncClient", FakeClient)
    monkeypatch.setattr(settings, "ERP_MAIN_SERVICE_CREDENTIAL", "shared-secret-0123456789")
    monkeypatch.setattr(settings, "ERP_MAIN_API_BASE_URL", "https://main.example/api/v1/")

    ok = await erp_main_client.push_profile_to_erp_main("Sales@Example.com", "  Sales Lead  ")
    assert ok is True
    assert seen["url"] == "https://main.example/api/v1/internal/users/profile"
    assert seen["json"] == {"email": "Sales@Example.com", "display_name": "Sales Lead"}
    assert seen["headers"]["Authorization"] == "Bearer shared-secret-0123456789"
    assert seen["headers"]["X-ERP-Key"] == settings.ERP_KEY

    # Never raises if ERP_Main is down
    seen["boom"] = True
    assert await erp_main_client.push_profile_to_erp_main("Sales@Example.com", "Sales Lead") is False


@pytest.fixture
async def isolated_db():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    factory = async_sessionmaker(bind=engine, class_=AsyncSession, expire_on_commit=False)
    async with factory() as session:
        yield session

    await engine.dispose()


@pytest.mark.asyncio
async def test_internal_provision_syncs_display_name_and_patch_preserves_username(
    isolated_db: AsyncSession,
    monkeypatch,
):
    app = create_application()

    async def _override_db():
        yield isolated_db

    app.dependency_overrides[get_db_session] = _override_db

    synced_profiles: list[tuple[str, str]] = []

    async def _fake_push_profile(email: str, display_name: str) -> bool:
        synced_profiles.append((email, display_name))
        return True

    monkeypatch.setattr(user_routes, "push_profile_to_erp_main", _fake_push_profile)
    monkeypatch.setattr(settings, "ERP_MAIN_SERVICE_CREDENTIAL", "test-service-secret-0123456789")

    auth_header = {"Authorization": "Bearer test-service-secret-0123456789"}

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        # 1. Provision initial user
        r1 = await client.post(
            "/api/v1/internal/users/provision",
            json={
                "email": "person.one@example.com",
                "display_name": "Initial Display",
                "username": "internal_person_one",
            },
            headers=auth_header,
        )
        assert r1.status_code == 201
        user_id = uuid.UUID(r1.json()["data"]["local_user_id"])

        # 2. Re-provision same user with updated display_name -> updates display_name & preserves username
        r2 = await client.post(
            "/api/v1/internal/users/provision",
            json={
                "email": "person.one@example.com",
                "display_name": "Central Updated Display",
            },
            headers=auth_header,
        )
        assert r2.status_code == 201
        assert r2.json()["data"]["created"] is False
        assert r2.json()["data"]["display_name"] == "Central Updated Display"

        db_user = await isolated_db.get(User, user_id)
        assert db_user is not None
        assert db_user.display_name == "Central Updated Display"
        assert db_user.username == "internal_person_one"

        # 3. PATCH /api/v1/users/{id} without username (and with username=None) preserves internal username
        app.dependency_overrides[get_current_user] = lambda: CurrentUser(
            id=user_id,
            username="internal_person_one",
            display_name="Central Updated Display",
            full_name="Central Updated Display",
            permissions={"user.action", "company.view"},
            is_super_admin=True,
        )

        r_patch = await client.patch(
            f"/api/v1/users/{user_id}",
            json={
                "display_name": "  Local Primary Name  ",
                "first_name": "Person",
                "last_name": "One",
                "username": None,
            },
        )
        assert r_patch.status_code == 200
        patched_data = r_patch.json()["data"]
        assert patched_data["display_name"] == "Local Primary Name"
        assert patched_data["username"] == "internal_person_one"
        assert synced_profiles == [("person.one@example.com", "Local Primary Name")]

        # 4. GET /api/v1/companies/sales-persons returns Display Name first in full_name
        second_user = User(
            id=uuid.uuid4(),
            username="fallback_handle",
            email="person.two@example.com",
            first_name="Fallback",
            last_name="Name",
            display_name=None,
            password_hash="h",
            has_login=True,
            status=UserStatus.ACTIVE,
            is_active=True,
        )
        isolated_db.add(second_user)
        await isolated_db.commit()

        r_sp = await client.get("/api/v1/companies/sales-persons")
        assert r_sp.status_code == 200
        sp_by_id = {row["id"]: row for row in r_sp.json()["data"]}
        assert sp_by_id[str(user_id)]["display_name"] == "Local Primary Name"
        assert sp_by_id[str(user_id)]["full_name"] == "Local Primary Name"
        assert sp_by_id[str(second_user.id)]["full_name"] == "Fallback Name"

    app.dependency_overrides.clear()
