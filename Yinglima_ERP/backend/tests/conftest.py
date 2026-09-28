"""
Shared Pytest Fixtures.

Provides an ``httpx.AsyncClient`` bound directly to the FastAPI ASGI app
(no real network socket needed) for fast, isolated endpoint tests.
"""

from __future__ import annotations

from collections.abc import AsyncGenerator

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from app.main import create_application


@pytest_asyncio.fixture
async def client() -> AsyncGenerator[AsyncClient, None]:
    """Yield an async test client wired to a fresh application instance."""
    app = create_application()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as ac:
        async with app.router.lifespan_context(app):
            yield ac


@pytest.fixture
def anyio_backend() -> str:
    """Restrict async tests to the asyncio backend only."""
    return "asyncio"


@pytest_asyncio.fixture(autouse=True)
async def reset_peer_health_states() -> AsyncGenerator[None, None]:
    """Ensure circuit breaker peer_health_states table does not contaminate test runs."""
    try:
        from sqlalchemy import update
        from app.database.engine import get_sessionmaker
        from app.integration.models import PeerHealthState
        async with get_sessionmaker()() as session:
            await session.execute(
                update(PeerHealthState).values(circuit_state="CLOSED", consecutive_failures=0, cooldown_until=None)
            )
            await session.commit()
    except Exception:
        pass
    yield


@pytest_asyncio.fixture(autouse=True)
async def cleanup_test_buyer_artifacts() -> AsyncGenerator[None, None]:
    """Ensure any test-generated buyers or countries never persist in the dev database."""
    yield
    try:
        from sqlalchemy import select, delete
        from app.database.engine import get_sessionmaker
        from app.buyers.models import Buyer
        from app.masters.countries.models import Country
        from app.integration.sync_models import SyncedEntityMapping
        from app.integration.consumer_models import SyncedBuyerSource

        async with get_sessionmaker()() as session:
            res_c = await session.execute(select(Country).where(Country.name.ilike("Test Country%")))
            countries = res_c.scalars().all()
            c_ids = [c.id for c in countries]

            res_b = await session.execute(
                select(Buyer).where(
                    (Buyer.company_name.ilike("Locally Modified%"))
                    | (Buyer.country_id.in_(c_ids) if c_ids else False)
                )
            )
            buyers = res_b.scalars().all()
            b_ids = [str(b.id) for b in buyers]

            if b_ids:
                await session.execute(delete(SyncedEntityMapping).where(SyncedEntityMapping.local_entity_id.in_(b_ids)))
                await session.execute(delete(SyncedBuyerSource).where(SyncedBuyerSource.local_buyer_id.in_(b_ids)))
                for b in buyers:
                    await session.delete(b)
                await session.flush()

            for c in countries:
                await session.delete(c)
            await session.commit()
    except Exception:
        pass
