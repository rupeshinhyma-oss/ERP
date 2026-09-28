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
