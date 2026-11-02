"""Surgical tests for display_name as primary user/salesperson identity in Yinglima_ERP."""

from __future__ import annotations

import uuid

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.auth.dependencies import get_auth_service
from app.cache.dependency import get_cache
from app.auth.security import hash_password
from app.auth.service import CurrentUser
from app.core.config import settings
from app.database.base import Base
from app.database.session import get_db_session
from app.main import create_application
from app.users import routes as user_routes
from app.users.models import User, UserStatus

pytestmark = pytest.mark.asyncio


@pytest.fixture
async def test_db():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    session_factory = async_sessionmaker(bind=engine, class_=AsyncSession, expire_on_commit=False)
    async with session_factory() as session:
        yield session

    await engine.dispose()


@pytest.fixture
async def test_client(test_db: AsyncSession):
    app = create_application()

    async def _override_db():
        yield test_db

    app.dependency_overrides[get_db_session] = _override_db
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as ac:
        yield ac
    app.dependency_overrides.clear()


async def test_current_user_defaults_keep_existing_callers_working():
    uid = uuid.uuid4()
    cu = CurrentUser(id=uid, username="internal_user")
    assert cu.display_name == ""
    assert cu.full_name == ""


async def test_batch_users_with_roles_resolves_manager_display_name(test_db: AsyncSession):
    manager = User(
        id=uuid.uuid4(),
        first_name="Rajesh",
        last_name="Verma",
        display_name="Rajesh V. (Sales Head)",
        username="rajesh_internal",
        email="rajesh@example.com",
        password_hash=hash_password("StrongPass#123"),
        status=UserStatus.ACTIVE,
        is_active=True,
    )
    reportee = User(
        id=uuid.uuid4(),
        first_name="Anita",
        last_name="Desai",
        display_name="Anita Desai",
        username="anita_internal",
        email="anita@example.com",
        manager_id=manager.id,
        password_hash=hash_password("StrongPass#123"),
        status=UserStatus.ACTIVE,
        is_active=True,
    )
    test_db.add_all([manager, reportee])
    await test_db.commit()

    items = await user_routes._batch_users_with_roles([manager, reportee], db=test_db)
    by_id = {item["id"]: item for item in items}
    assert by_id[str(reportee.id)]["manager_name"] == "Rajesh V. (Sales Head)"
    assert by_id[str(reportee.id)]["employee_name"] == "Anita Desai"


async def test_login_profile_and_patch_preserve_username_and_sync_display_name(
    test_client: AsyncClient, test_db: AsyncSession, monkeypatch
):
    synced_calls: list[tuple[str, str]] = []

    async def _fake_push_profile(email: str | None, display_name: str | None) -> bool:
        synced_calls.append((email or "", display_name or ""))
        return True

    async def _fake_open_session(email: str | None):
        return None

    monkeypatch.setattr(user_routes, "push_profile_to_erp_main", _fake_push_profile)
    monkeypatch.setattr("app.auth.routes.open_central_session", _fake_open_session)

    user = User(
        id=uuid.uuid4(),
        first_name="Kiran",
        last_name="Rao",
        display_name="Kiran Rao",
        username="kiran_internal_99",
        email="kiran@example.com",
        phone="+919999999999",
        password_hash=hash_password("ValidPass!2026"),
        status=UserStatus.ACTIVE,
        is_active=True,
        must_change_password=False,
    )
    test_db.add(user)
    await test_db.commit()

    # 1. Login returns display_name and full_name in ProfileResponse
    login_resp = await test_client.post(
        "/api/v1/auth/login",
        json={"identifier": "kiran@example.com", "password": "ValidPass!2026"},
    )
    assert login_resp.status_code == 200
    token_data = login_resp.json()["data"]
    access_token = token_data["access_token"]
    assert token_data["user"]["display_name"] == "Kiran Rao"
    assert token_data["user"]["full_name"] == "Kiran Rao"

    # 2. verify_access_token populates CurrentUser.display_name and full_name
    auth_service = get_auth_service(test_db, get_cache())
    cu = await auth_service.verify_access_token(access_token)
    assert cu.display_name == "Kiran Rao"
    assert cu.full_name == "Kiran Rao"
    assert cu.username == "kiran_internal_99"

    # 3. GET /api/v1/auth/profile returns display_name
    prof_resp = await test_client.get(
        "/api/v1/auth/profile",
        headers={"Authorization": f"Bearer {access_token}"},
    )
    assert prof_resp.status_code == 200
    assert prof_resp.json()["data"]["display_name"] == "Kiran Rao"

    # 4. PATCH /api/v1/users/{id} without username updates display_name, preserves username, and syncs ERP_Main
    patch_resp = await test_client.patch(
        f"/api/v1/users/{user.id}",
        json={"display_name": "Kiran K. Rao", "first_name": "Kiran"},
        headers={"Authorization": f"Bearer {access_token}"},
    )
    assert patch_resp.status_code == 200
    patched = patch_resp.json()["data"]
    assert patched["display_name"] == "Kiran K. Rao"
    assert patched["username"] == "kiran_internal_99"
    assert synced_calls == [("kiran@example.com", "Kiran K. Rao")]


async def test_internal_provision_updates_display_name_on_existing_user(test_client: AsyncClient):
    auth_header = {"Authorization": f"Bearer {settings.FEDERATION_SERVICE_CREDENTIAL}"}

    prov1 = await test_client.post(
        "/api/v1/internal/users/provision",
        json={"email": "sync.dn@example.com", "display_name": "Initial Name"},
        headers=auth_header,
    )
    assert prov1.status_code == 201
    assert prov1.json()["data"]["created"] is True
    assert prov1.json()["data"]["display_name"] == "Initial Name"
    kept_username = prov1.json()["data"]["username"]

    prov2 = await test_client.post(
        "/api/v1/internal/users/provision",
        json={"email": "sync.dn@example.com", "display_name": "Updated Central Name"},
        headers=auth_header,
    )
    assert prov2.status_code == 201
    data2 = prov2.json()["data"]
    assert data2["created"] is False
    assert data2["display_name"] == "Updated Central Name"
    assert data2["username"] == kept_username
