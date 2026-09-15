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


@pytest.fixture(autouse=True)
def reset_singletons():
    """Ensure process-wide worker singletons are cleanly reset between test functions."""
    from app.queue import worker as q_worker
    from app.cache import dependency as c_dep
    from app.durable_events import worker as d_worker
    from app.durable_events import notify as d_notify

    q_worker._worker = None
    c_dep._cleanup_worker = None
    d_worker._worker = None
    d_notify._listener = None
    yield
    q_worker._worker = None
    c_dep._cleanup_worker = None
    d_worker._worker = None
    d_notify._listener = None

