"""Workflow rules live only in the database: if they are missing the API says so, it never invents them."""

from __future__ import annotations

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from app.auth.dependencies import get_current_user
from app.core.exception_handlers import register_exception_handlers
from app.database.base import Base
from app.database.session import get_db_session
from app.purchase.routes import router as purchase_router
from app.sales.routes import router as sales_router
from tests.test_purchase_routes import ADMIN, TABLES, _import, _local, factory  # noqa: F401  (factory = seeded DB fixture)


def _client(maker, user) -> AsyncClient:
    """Both the purchase and the sales (Proforma) routers, on the given database."""
    app = FastAPI()
    register_exception_handlers(app)
    app.include_router(purchase_router)
    app.include_router(sales_router)

    async def _db():
        async with maker() as session:
            try:
                yield session
                await session.commit()
            except BaseException:
                await session.rollback()
                raise

    app.dependency_overrides[get_db_session] = _db
    app.dependency_overrides[get_current_user] = lambda: user
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")

URLS = ["/proforma-invoice/list", "/purchase/local-orders", "/purchase/import-orders"]


@pytest_asyncio.fixture
async def unseeded():
    """Tables exist but the seed migrations were never run: no workflow rules at all."""
    engine = create_async_engine("sqlite+aiosqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
    async with engine.begin() as conn:
        await conn.run_sync(lambda c: Base.metadata.create_all(c, tables=TABLES))
    yield async_sessionmaker(engine, expire_on_commit=False)
    await engine.dispose()


@pytest.mark.asyncio
@pytest.mark.parametrize("url", URLS)
async def test_missing_rules_give_a_clear_error_not_invented_rules(unseeded, url):
    async with _client(unseeded, ADMIN) as c:
        res = await c.get(url)
    assert res.status_code == 503, res.text
    assert "not configured" in res.text


@pytest.mark.asyncio
async def test_creating_without_rules_is_refused(unseeded):
    async with _client(unseeded, ADMIN) as c:
        assert (await c.post("/purchase/local-orders", json=_local())).status_code in (400, 503)
        assert (await c.post("/purchase/import-orders", json=_import())).status_code in (400, 503)
        assert (await c.post("/proforma-invoice", json={"proforma_date": "01-01-2026", "warehouse": "Mumbai", "company_name": "X",
                                                          "items": [{"product_name": "A", "quantity": 1, "unit_price": 1}]})).status_code in (400, 503)


@pytest.mark.asyncio
async def test_all_count_is_the_real_total_and_status_keys_are_only_real_statuses(factory):  # noqa: F811
    async with _client(factory, ADMIN) as c:
        for n in (1, 2, 3):
            assert (await c.post("/purchase/local-orders", json=_local(invoice_no=f"INV-{n}"))).status_code == 201
            assert (await c.post("/purchase/import-orders", json=_import(consignment_no=f"EXP-{n}"))).status_code == 201
        for url, statuses in (("/purchase/local-orders", {"pending", "confirmed"}),
                              ("/purchase/import-orders", {"pending", "confirmed", "received", "closed"})):
            data = (await c.get(url)).json()["data"]
            assert data["tab_counts"]["all"]["count"] == 3
            assert set(data["tab_counts"]) == {"all"} | statuses          # no fake 'all' status among the rules
            assert "all" not in data["status_rules"]
