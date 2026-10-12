"""
ERP_Main provisions and suspends users in an ERP through /internal/users/*.  The users table has
FOREIGN KEYS (created_by / updated_by -> users.id).  PostgreSQL enforces them; the default SQLite test
database does not -- which is how a made-up 'system user' id slipped through and broke provisioning in
production.  These tests turn FK enforcement ON so the bug can't come back.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import event, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import settings
from app.database.base import Base
from app.database.session import get_db_session
from app.main import create_application
from app.users.models import User, UserStatus

pytestmark = pytest.mark.asyncio
CRED = "unit-test-shared-credential-0123456789"
AUTH = {"Authorization": f"Bearer {CRED}"}


@pytest.fixture
async def db():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")

    @event.listens_for(engine.sync_engine, "connect")
    def _fk_on(dbapi_conn, _rec):  # enforce foreign keys like PostgreSQL does
        cur = dbapi_conn.cursor(); cur.execute("PRAGMA foreign_keys=ON"); cur.close()

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    async with async_sessionmaker(bind=engine, class_=AsyncSession, expire_on_commit=False)() as session:
        yield session
    await engine.dispose()


@pytest.fixture
async def client(db, monkeypatch):
    monkeypatch.setattr(settings, "ERP_MAIN_SERVICE_CREDENTIAL", CRED)
    app = create_application()

    async def _db():
        yield db

    app.dependency_overrides[get_db_session] = _db
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as ac:
        yield ac
    app.dependency_overrides.clear()


async def _admin(db) -> User:
    admin = User(
        id=uuid.uuid4(), username=settings.BOOTSTRAP_ADMIN_USERNAME or "admin", email="admin@example.com",
        password_hash="x", status=UserStatus.ACTIVE, is_active=True, has_login=True,
        must_change_password=False, failed_login_count=0, created_at=datetime.now(timezone.utc),
    )
    db.add(admin); await db.commit()
    return admin


async def test_provisioning_a_new_user_works_with_foreign_keys_enforced_and_no_admin_yet(client):
    r = await client.post("/api/v1/internal/users/provision", headers=AUTH,
                          json={"email": "new1@example.com", "display_name": "New One", "password": "Passw0rd!Aa1"})
    assert r.status_code in (200, 201), r.text
    assert r.json()["data"]["created"] is True


async def test_provisioned_user_is_attributed_to_the_real_admin(client, db):
    admin = await _admin(db)
    r = await client.post("/api/v1/internal/users/provision", headers=AUTH,
                          json={"email": "new2@example.com", "display_name": "New Two", "password": "Passw0rd!Aa1"})
    assert r.status_code in (200, 201), r.text
    created = await db.scalar(select(User).where(User.email == "new2@example.com"))
    assert created.created_by == admin.id


async def test_suspending_and_restoring_through_the_access_endpoint_works(client, db):
    await _admin(db)
    p = await client.post("/api/v1/internal/users/provision", headers=AUTH,
                          json={"email": "new3@example.com", "display_name": "New Three", "password": "Passw0rd!Aa1"})
    lid = p.json()["data"]["local_user_id"]
    off = await client.post(f"/api/v1/internal/users/{lid}/access", headers=AUTH, json={"allow_login": False, "reason": "central"})
    assert off.status_code == 200, off.text
    assert off.json()["data"]["can_login"] is False
    on = await client.post(f"/api/v1/internal/users/{lid}/access", headers=AUTH, json={"allow_login": True})
    assert on.status_code == 200 and on.json()["data"]["can_login"] is True


async def test_internal_logout_endpoint_works(client, db):
    await _admin(db)
    p = await client.post("/api/v1/internal/users/provision", headers=AUTH,
                          json={"email": "logout_test@example.com", "display_name": "Logout Test", "password": "Passw0rd!Aa1"})
    lid = p.json()["data"]["local_user_id"]
    r = await client.post(f"/api/v1/internal/users/{lid}/logout", headers=AUTH, json={"reason": "test_logout"})
    assert r.status_code == 200, r.text
    assert r.json()["data"]["logged_out"] is True

