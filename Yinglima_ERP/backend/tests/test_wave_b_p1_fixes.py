"""
Wave B P1 Regression Tests for Yinglima_ERP
(BUG-008, BUG-011, BUG-012, BUG-014, BUG-015).

Runs strictly on isolated in-memory SQLite.
"""

from __future__ import annotations

import inspect
import uuid
from datetime import datetime, timezone

import pytest
from fastapi import FastAPI, Request
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.auth.dependencies import verify_websocket_token
from app.auth.security import TokenType, create_access_token, decode_token, hash_password
from app.core.config import EnvironmentEnum, Settings, settings
from app.core.exception_handlers import register_exception_handlers
from app.database.base import Base
from app.database.session import get_db_session
from app.durable_events.models import DeadLetterEvent, DeliveryStatus, DurableEvent, EventConsumer, EventDelivery
from app.durable_events.routes import router as durable_events_router
from app.events import routes as events_routes
from app.integration.routes import router as integration_router
from app.planning import routes as planning_routes
from app.rbac.models import Role, UserRole
from app.users.models import User, UserStatus

pytestmark = pytest.mark.asyncio


@pytest.fixture
async def isolated_db():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(bind=engine, class_=AsyncSession, expire_on_commit=False)
    async with factory() as session:
        yield session
    await engine.dispose()


async def _seed_super_admin(db: AsyncSession) -> tuple[User, dict[str, str]]:
    sa = User(
        id=uuid.uuid4(),
        email="sa-ylm-wb@example.com",
        username="sa_ylm_wb",
        first_name="Super",
        last_name="Admin",
        password_hash=hash_password("Pass!123456"),
        status=UserStatus.ACTIVE,
        has_login=True,
    )
    role = Role(id=uuid.uuid4(), name="super_admin", description="Super Admin", is_system=True)
    db.add_all([sa, role])
    await db.flush()
    db.add(UserRole(user_id=sa.id, role_id=role.id))
    await db.commit()
    tok = create_access_token(sa.id, permissions=["*"]).token
    return sa, {"Authorization": f"Bearer {tok}"}


async def test_bug008_yinglima_durable_events_routes_return_200(isolated_db: AsyncSession):
    _, sa_hdr = await _seed_super_admin(isolated_db)
    now = datetime.now(timezone.utc)
    ev = DurableEvent(
        id=uuid.uuid4(),
        event_type="order.created",
        source="yinglima",
        entity="sale_order",
        entity_id=str(uuid.uuid4()),
        payload="{}",
        correlation_id=uuid.uuid4(),
        occurred_at=now,
    )
    cons = EventConsumer(id=uuid.uuid4(), consumer_key="yinglima.test_consumer", description="test")
    isolated_db.add_all([ev, cons])
    await isolated_db.flush()
    deliv = EventDelivery(
        id=uuid.uuid4(),
        event_id=ev.id,
        consumer_id=cons.id,
        status=DeliveryStatus.DEAD_LETTER,
        attempt_count=3,
        max_attempts=3,
        available_at=now,
        last_error="err",
    )
    isolated_db.add(deliv)
    await isolated_db.flush()
    dl = DeadLetterEvent(
        id=uuid.uuid4(),
        delivery_id=deliv.id,
        event_id=ev.id,
        consumer_id=cons.id,
        event_type="order.created",
        attempt_count=3,
        first_failed_at=now,
        last_failed_at=now,
        failure_reason="err",
    )
    isolated_db.add(dl)
    await isolated_db.commit()

    test_app = FastAPI()
    register_exception_handlers(test_app)

    @test_app.middleware("http")
    async def _req_id(request: Request, call_next):
        request.state.request_id = str(uuid.uuid4())
        return await call_next(request)

    test_app.include_router(durable_events_router, prefix="/api/v1")

    async def _ov():
        yield isolated_db

    test_app.dependency_overrides[get_db_session] = _ov

    async with AsyncClient(transport=ASGITransport(app=test_app), base_url="http://testserver") as client:
        r1 = await client.get("/api/v1/durable-events/dead-letters", headers=sa_hdr)
        assert r1.status_code == 200 and len(r1.json()["data"]) == 1

        r2 = await client.get(f"/api/v1/durable-events/deliveries/{ev.id}", headers=sa_hdr)
        assert r2.status_code == 200 and len(r2.json()["data"]) == 1

        r3 = await client.post(f"/api/v1/durable-events/dead-letters/{dl.id}/replay", headers=sa_hdr)
        assert r3.status_code == 200 and r3.json()["data"]["status"].upper() == "PENDING"


async def test_bug011_yinglima_integration_events_handles_unsubscribed_and_malformed(
    isolated_db: AsyncSession, monkeypatch
):
    test_app = FastAPI()
    register_exception_handlers(test_app)

    @test_app.middleware("http")
    async def _req_id(request: Request, call_next):
        request.state.request_id = str(uuid.uuid4())
        return await call_next(request)

    test_app.include_router(integration_router, prefix="/api/v1")

    async def _ov():
        yield isolated_db

    test_app.dependency_overrides[get_db_session] = _ov
    monkeypatch.setattr(settings, "ERP_MAIN_SERVICE_CREDENTIAL", "synthetic-svc-token-ylm")
    hdr = {"Authorization": "Bearer synthetic-svc-token-ylm"}

    async with AsyncClient(transport=ASGITransport(app=test_app), base_url="http://testserver") as client:
        # 1. Missing auth -> 401
        assert (await client.post("/api/v1/integration/events", json={})).status_code == 401

        # 2. Malformed envelope -> 400 (NOT 500!)
        r_bad = await client.post("/api/v1/integration/events", json={"event_id": "bad"}, headers=hdr)
        assert r_bad.status_code == 400

        # 3. Unsubscribed entity type broadcast -> 200 NOOP (NOT 500!)
        r_unsub = await client.post(
            "/api/v1/integration/events",
            json={
                "event_id": str(uuid.uuid4()),
                "event_type": "unsubscribed_entity.updated",
                "event_version": 1,
                "source_erp": "inhyma",
                "entity_type": "unsubscribed_entity",
                "entity_id": str(uuid.uuid4()),
                "payload": {"name": "Test"},
            },
            headers=hdr,
        )
        assert r_unsub.status_code == 200, r_unsub.text
        assert r_unsub.json()["data"]["action"] == "NOOP"


async def test_bug012_yinglima_access_token_short_lived():
    cfg = Settings(_env_file=None)
    assert cfg.ACCESS_TOKEN_EXPIRE_MINUTES == 30
    assert cfg.REFRESH_TOKEN_EXPIRE_DAYS == 30

    clamped = Settings(_env_file=None, ACCESS_TOKEN_EXPIRE_MINUTES=5256000)
    assert clamped.ACCESS_TOKEN_EXPIRE_MINUTES == 30

    issued = create_access_token(uuid.uuid4(), permissions=[])
    claims = decode_token(issued.token, expected_type=TokenType.ACCESS)
    assert 60 <= (claims["exp"] - claims["iat"]) <= 7200


async def test_bug014_websocket_does_not_hold_db_dependency_and_pool_bounded():
    # Verify neither WebSocket handler injects long-lived Depends(get_auth_service) / Depends(get_db_session)
    sig_events = inspect.signature(events_routes.live_events)
    assert "auth_service" not in sig_events.parameters
    assert "db" not in sig_events.parameters

    sig_plan = inspect.signature(planning_routes.sheet_live_updates)
    assert "auth_service" not in sig_plan.parameters
    assert "db" not in sig_plan.parameters

    # verify_websocket_token is callable and available
    assert callable(verify_websocket_token)

    # Pool size bounded to safe defaults (10 + 10, down from 50 + 50)
    cfg = Settings(_env_file=None)
    assert cfg.DATABASE_POOL_SIZE <= 15
    assert cfg.DATABASE_MAX_OVERFLOW <= 15


async def test_bug015_production_startup_guards_reject_unsafe_config():
    base_kwargs = dict(
        ENVIRONMENT=EnvironmentEnum.PRODUCTION,
        DATABASE_URL="postgresql+asyncpg://u:p@db.example.com:5432/yinglima",
        CORS_ALLOWED_ORIGINS="https://yinglima.example.com",
        JWT_SECRET_KEY="prod-jwt-secret-strong-value-1",
        MEMBER_PASSWORD_ENCRYPTION_KEY="prod-member-key-strong-value-2",
        ERP_MAIN_SERVICE_CREDENTIAL="prod-erp-main-cred-3",
        BOOTSTRAP_ADMIN_PASSWORD="StrongProdBootstrap!2026",
    )
    # Valid production config passes
    Settings(_env_file=None, **base_kwargs).validate_production_secrets()

    # Wildcard CORS rejected
    with pytest.raises(RuntimeError, match="CORS_ALLOWED_ORIGINS"):
        Settings(_env_file=None, **{**base_kwargs, "CORS_ALLOWED_ORIGINS": "*"}).validate_production_secrets()

    # SQLite rejected in production
    with pytest.raises(RuntimeError, match="SQLite"):
        Settings(_env_file=None, **{**base_kwargs, "DATABASE_URL": "sqlite+aiosqlite:///./prod.db"}).validate_production_secrets()

    # Default bootstrap admin password rejected in production
    with pytest.raises(RuntimeError, match="BOOTSTRAP_ADMIN_PASSWORD"):
        Settings(_env_file=None, **{**base_kwargs, "BOOTSTRAP_ADMIN_PASSWORD": "ChangeMe!12345"}).validate_production_secrets()

    # Equal JWT & Member keys rejected in production
    with pytest.raises(RuntimeError, match="MEMBER_PASSWORD_ENCRYPTION_KEY"):
        Settings(
            _env_file=None,
            **{**base_kwargs, "MEMBER_PASSWORD_ENCRYPTION_KEY": base_kwargs["JWT_SECRET_KEY"]},
        ).validate_production_secrets()
