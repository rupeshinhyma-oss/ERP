"""
Wave B P1 Regression Tests for Inhyma_ERP (BUG-008, BUG-009, BUG-011, BUG-012).
Runs strictly on isolated in-memory SQLite.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

import pytest
from fastapi import FastAPI, Request
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.api.v1.health import router as health_router
from app.auth.security import create_access_token, decode_token, hash_password, TokenType
from app.core.config import Settings
from app.core.constants import RecordStatus
from app.core.exception_handlers import register_exception_handlers
from app.database.base import Base
from app.database.session import get_db_session
from app.durable_events.models import DeadLetterEvent, DeliveryStatus, DurableEvent, EventConsumer, EventDelivery
from app.durable_events.routes import router as durable_events_router
from app.masters.products.models import Product, ProductDimensionRow
from app.masters.products.repository import ProductRepository
from app.masters.products.service import ProductService
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
        email="sa-waveb@example.com",
        username="sa_waveb",
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


async def test_bug008_durable_events_routes_return_200(isolated_db: AsyncSession):
    _, sa_hdr = await _seed_super_admin(isolated_db)
    now = datetime.now(timezone.utc)
    ev = DurableEvent(
        id=uuid.uuid4(),
        event_type="test.created",
        source="inhyma",
        entity="product",
        entity_id=str(uuid.uuid4()),
        payload="{}",
        correlation_id=uuid.uuid4(),
        occurred_at=now,
    )
    cons = EventConsumer(id=uuid.uuid4(), consumer_key="inhyma.test_consumer", description="test")
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
        last_error="boom",
    )
    isolated_db.add(deliv)
    await isolated_db.flush()
    dl = DeadLetterEvent(
        id=uuid.uuid4(),
        delivery_id=deliv.id,
        event_id=ev.id,
        consumer_id=cons.id,
        event_type="test.created",
        attempt_count=3,
        first_failed_at=now,
        last_failed_at=now,
        failure_reason="boom",
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
        assert r1.status_code == 200, r1.text
        assert len(r1.json()["data"]) == 1

        r2 = await client.get(f"/api/v1/durable-events/deliveries/{ev.id}", headers=sa_hdr)
        assert r2.status_code == 200, r2.text
        assert len(r2.json()["data"]) == 1

        r3 = await client.post(f"/api/v1/durable-events/dead-letters/{dl.id}/replay", headers=sa_hdr)
        assert r3.status_code == 200, r3.text
        assert r3.json()["data"]["status"].upper() == "PENDING"


async def test_bug009_package_dimensions_report_filters_soft_deleted_products(isolated_db: AsyncSession):
    from app.masters.product_categories.models import ProductCategory
    from app.masters.uom.models import UnitOfMeasurement

    cat = ProductCategory(id=uuid.uuid4(), name="Machines", code="MACH", status=RecordStatus.ACTIVE)
    uom = UnitOfMeasurement(id=uuid.uuid4(), name="Piece", code="PCS", status=RecordStatus.ACTIVE)
    isolated_db.add_all([cat, uom])
    await isolated_db.flush()

    active_p = Product(
        id=uuid.uuid4(),
        product_code="ACT-01",
        product_name="Active Machine",
        product_name_tally="Active Machine",
        category_id=cat.id,
        uom_id=uom.id,
        status=RecordStatus.ACTIVE,
        deleted_at=None,
    )
    deleted_p = Product(
        id=uuid.uuid4(),
        product_code="DEL-01",
        product_name="Deleted Machine",
        product_name_tally="Deleted Machine",
        category_id=cat.id,
        uom_id=uom.id,
        status=RecordStatus.ACTIVE,
        deleted_at=datetime.now(timezone.utc),
    )
    isolated_db.add_all([active_p, deleted_p])
    await isolated_db.flush()
    isolated_db.add_all([
        ProductDimensionRow(id=uuid.uuid4(), product_id=active_p.id, package_name="Box A", sort_order=1, cbm=1.5),
        ProductDimensionRow(id=uuid.uuid4(), product_id=deleted_p.id, package_name="Box B", sort_order=1, cbm=2.5),
    ])
    await isolated_db.commit()

    svc = ProductService(
        repository=ProductRepository(isolated_db),
        category_repository=None,
        sub_category_repository=None,
        brand_repository=None,
        uom_repository=None,
        cache_manager=None,
    )
    report = await svc.get_package_dimensions_report()
    assert len(report) == 1
    assert report[0]["product_code"] == "ACT-01"
    assert report[0]["package_name"] == "Box A"


async def test_bug011_health_integration_recognizes_super_admin_jwt(isolated_db: AsyncSession):
    _, sa_hdr = await _seed_super_admin(isolated_db)
    test_app = FastAPI()
    register_exception_handlers(test_app)

    @test_app.middleware("http")
    async def _req_id(request: Request, call_next):
        request.state.request_id = str(uuid.uuid4())
        return await call_next(request)

    test_app.include_router(health_router, prefix="/api/v1")

    async def _ov():
        yield isolated_db

    test_app.dependency_overrides[get_db_session] = _ov

    async with AsyncClient(transport=ASGITransport(app=test_app), base_url="http://testserver") as client:
        # Anonymous gets minimal probe
        r_anon = await client.get("/api/v1/health/integration")
        assert r_anon.status_code == 200
        assert "deliveries" not in r_anon.json()["data"]

        # Super Admin JWT gets full integration diagnostics (no swallowed ImportError!)
        r_sa = await client.get("/api/v1/health/integration", headers=sa_hdr)
        assert r_sa.status_code == 200, r_sa.text
        assert "deliveries" in r_sa.json()["data"]
        assert "peer_circuits" in r_sa.json()["data"]


async def test_bug012_inhyma_access_token_short_lived():
    cfg = Settings(_env_file=None)
    assert cfg.ACCESS_TOKEN_EXPIRE_MINUTES == 30
    assert cfg.REFRESH_TOKEN_EXPIRE_DAYS == 30

    clamped = Settings(_env_file=None, ACCESS_TOKEN_EXPIRE_MINUTES=5256000, REFRESH_TOKEN_EXPIRE_DAYS=3650)
    assert clamped.ACCESS_TOKEN_EXPIRE_MINUTES == 30
    assert clamped.REFRESH_TOKEN_EXPIRE_DAYS == 30

    issued = create_access_token(uuid.uuid4(), permissions=[])
    claims = decode_token(issued.token, expected_type=TokenType.ACCESS)
    assert 60 <= (claims["exp"] - claims["iat"]) <= 7200
