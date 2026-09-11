"""
Tests for Local ERP User Identity Sync & Provisioning (Prompt 2).

Tests cover:
- Internal machine-to-machine service credential authentication.
- Internal check endpoint: POST /api/v1/internal/users/check.
- Internal provision endpoint: POST /api/v1/internal/users/provision.
- Idempotency of local user provisioning.
- Outbox event publication on local user creation (user.created) with data minimization.
"""

from __future__ import annotations

import json
import uuid

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import settings
from app.database.base import Base
from app.database.session import get_db_session
from app.integration.models import IntegrationOutboxEvent
from app.main import create_application
from app.users.models import User, UserStatus
from app.users.routes import _publish_user_integration_event

pytestmark = pytest.mark.asyncio


@pytest.fixture
async def test_db():
    """Isolated SQLite database with schema created."""
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    session_factory = async_sessionmaker(bind=engine, class_=AsyncSession, expire_on_commit=False)
    async with session_factory() as session:
        yield session

    await engine.dispose()


@pytest.fixture
async def test_client(test_db: AsyncSession):
    """AsyncClient wired with db dependency override."""
    app = create_application()

    async def _override_db():
        yield test_db

    app.dependency_overrides[get_db_session] = _override_db

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as ac:
        yield ac

    app.dependency_overrides.clear()


# --- Internal Service Endpoint Security ---------------------------------------


async def test_internal_users_unauthorized_without_token(test_client: AsyncClient):
    """Calling /internal/users/* without Authorization header must fail with 401."""
    resp_check = await test_client.post(
        "/api/v1/internal/users/check",
        json={"identifier": "admin@example.com"},
    )
    assert resp_check.status_code == 401

    resp_prov = await test_client.post(
        "/api/v1/internal/users/provision",
        json={"email": "new@example.com", "display_name": "New Person"},
    )
    assert resp_prov.status_code == 401


async def test_internal_users_unauthorized_with_wrong_token(test_client: AsyncClient):
    """Calling /internal/users/* with bad service token must fail with 401."""
    headers = {"Authorization": "Bearer invalid-service-credential-123"}
    resp = await test_client.post(
        "/api/v1/internal/users/check",
        json={"identifier": "admin@example.com"},
        headers=headers,
    )
    assert resp.status_code == 401


# --- Internal User Check & Provision Flow -------------------------------------


async def test_internal_user_check_and_provision(test_client: AsyncClient):
    """Verify check -> provision -> check sequence with service credential."""
    auth_header = {"Authorization": f"Bearer {settings.FEDERATION_SERVICE_CREDENTIAL}"}

    # 1. Check non-existent user
    check1 = await test_client.post(
        "/api/v1/internal/users/check",
        json={"identifier": "worker.sync@example.com"},
        headers=auth_header,
    )
    assert check1.status_code == 200
    assert check1.json()["data"]["exists"] is False

    # 2. Provision local user
    prov = await test_client.post(
        "/api/v1/internal/users/provision",
        json={
            "email": "worker.sync@example.com",
            "display_name": "Worker Sync",
            "username": "worker_sync",
        },
        headers=auth_header,
    )
    assert prov.status_code == 201
    prov_data = prov.json()["data"]
    assert prov_data["created"] is True
    assert "local_user_id" in prov_data
    local_id = prov_data["local_user_id"]

    # 3. Check again -> now exists
    check2 = await test_client.post(
        "/api/v1/internal/users/check",
        json={"identifier": "worker.sync@example.com"},
        headers=auth_header,
    )
    assert check2.status_code == 200
    assert check2.json()["data"]["exists"] is True
    assert check2.json()["data"]["local_user_id"] == local_id

    # 4. Idempotent re-provision returns existing record with created=False
    prov2 = await test_client.post(
        "/api/v1/internal/users/provision",
        json={
            "email": "worker.sync@example.com",
            "display_name": "Worker Sync",
        },
        headers=auth_header,
    )
    assert prov2.status_code == 201
    assert prov2.json()["data"]["created"] is False
    assert prov2.json()["data"]["local_user_id"] == local_id


# --- Outbox Publication on Local User Creation --------------------------------


async def test_publish_user_integration_event_outbox(test_db: AsyncSession):
    """Local user creation publishes user.created event with data-minimized payload."""
    actor_id = uuid.uuid4()
    user = User(
        id=uuid.uuid4(),
        first_name="Jane",
        last_name="Doe",
        display_name="Jane Doe",
        username="janedoe",
        email="  Jane.Doe@Example.COM  ",
        employee_code="EMP-9901",
        password_hash="secret-salted-hash-never-leak",
        status=UserStatus.ACTIVE,
        is_active=True,
    )
    test_db.add(user)
    await test_db.flush()

    # Call outbox publication helper
    await _publish_user_integration_event(db=test_db, user=user, actor_id=actor_id)
    await test_db.commit()

    # Verify outbox event row
    stmt = select(IntegrationOutboxEvent).where(IntegrationOutboxEvent.aggregate_id == user.id)
    outbox_event = (await test_db.execute(stmt)).scalars().first()

    assert outbox_event is not None
    assert outbox_event.event_type == "user.created"
    assert outbox_event.aggregate_type == "user"

    payload = json.loads(outbox_event.payload)
    assert payload["local_user_id"] == str(user.id)
    # Email must be stripped and lowercased
    assert payload["email"] == "jane.doe@example.com"
    assert payload["username"] == "janedoe"
    assert payload["display_name"] == "Jane Doe"
    assert payload["employee_code"] == "EMP-9901"

    # Strict check: NEVER leak passwords or password hashes
    assert "password" not in payload
    assert "password_hash" not in payload
    assert "secret-salted-hash-never-leak" not in outbox_event.payload
