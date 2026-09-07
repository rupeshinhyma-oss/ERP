"""
Shared pytest fixtures for ERP_Main's test suite.

Each test gets a fresh in-memory SQLite database (via StaticPool so the
single in-memory DB survives across the multiple connections FastAPI's
async test client opens) and a fresh ASGI test client, so tests never
share state and never touch a real Postgres instance.

Phase 3 adds `admin_client` and `super_admin_client`: authenticated
variants of `client`, since every mutating registry/global-user/
membership/credential route now requires a platform admin (Phase 3 Step
19/21). Plain `client` remains for exercising the still-open read routes
and for explicitly testing the unauthenticated-caller rejection path.
"""

from __future__ import annotations

import os
import uuid

os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///:memory:")

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.database.base import Base
import app.database.engine as engine_module
from app.main import create_application


@pytest.fixture
async def test_app():
    """Build a fresh FastAPI app wired to a fresh in-memory SQLite database."""
    test_engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    test_sessionmaker = async_sessionmaker(bind=test_engine, expire_on_commit=False)

    # Point the shared engine/sessionmaker module-level singletons at this
    # test's isolated engine, so every dependency in the app (which all
    # resolve the engine via get_engine()/get_sessionmaker()) uses it.
    engine_module._engine = test_engine
    engine_module._sessionmaker = test_sessionmaker

    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    app = create_application()
    yield app

    await test_engine.dispose()
    engine_module._engine = None
    engine_module._sessionmaker = None


@pytest.fixture
async def client(test_app):
    """Return an httpx AsyncClient bound directly to the test app (no real network), unauthenticated."""
    transport = ASGITransport(app=test_app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


async def _bootstrap_admin_and_login(client: AsyncClient, *, role: str) -> str:
    """Create the first platform admin directly (bypassing the API's own auth-required routes) and log in."""
    from app.database.session import get_db_session
    from app.global_audit.repository import GlobalAuditRepository
    from app.global_audit.service import GlobalAuditService
    from app.platform_auth.models import PlatformAdminRole
    from app.platform_auth.repository import PlatformAdminRepository
    from app.platform_auth.schemas import PlatformAdminCreate
    from app.platform_auth.service import PlatformAuthService

    email = f"{uuid.uuid4().hex[:12]}@platform.example"
    password = "Test-Password-123!"

    # `get_db_session()` is a generator dependency whose commit happens
    # AFTER the `yield` resumes -- breaking out of an `async for` early
    # (as an earlier version of this helper did) sends the generator a
    # `GeneratorExit`, which its `except BaseException` block treats as a
    # failure and rolls back instead of committing. Driving it to
    # exhaustion with two `anext()` calls lets it complete normally past
    # its own `yield`, so the write actually commits.
    gen = get_db_session()
    db = await anext(gen)
    service = PlatformAuthService(
        repository=PlatformAdminRepository(db), audit=GlobalAuditService(GlobalAuditRepository(db))
    )
    await service.bootstrap_first_admin(
        PlatformAdminCreate(email=email, display_name="Test Admin", password=password, role=PlatformAdminRole(role))
    )
    try:
        await anext(gen)  # drives past the `yield`, triggering commit() + close()
    except StopAsyncIteration:
        pass  # expected: the generator has nothing left to yield after commit()

    response = await client.post("/api/v1/global/auth/login", json={"email": email, "password": password})
    return response.json()["data"]["access_token"]


@pytest.fixture
async def super_admin_client(test_app):
    """An httpx AsyncClient authenticated as a freshly-bootstrapped SUPER_ADMIN."""
    transport = ASGITransport(app=test_app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        token = await _bootstrap_admin_and_login(ac, role="SUPER_ADMIN")
        ac.headers["Authorization"] = f"Bearer {token}"
        yield ac


@pytest.fixture
async def admin_client(super_admin_client):
    """
    An httpx AsyncClient authenticated as a platform admin.

    Reuses the SUPER_ADMIN bootstrap for simplicity -- SUPER_ADMIN is a
    superset of PLATFORM_ADMIN's access for every route tested here
    (only `POST /global/auth/admins` and credential issuance actually
    require SUPER_ADMIN specifically; see test_platform_auth.py for a
    dedicated PLATFORM_ADMIN-vs-SUPER_ADMIN authorization test).
    """
    yield super_admin_client
