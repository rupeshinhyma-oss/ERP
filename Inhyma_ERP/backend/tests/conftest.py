"""
Shared Pytest Fixtures.

Provides an ``httpx.AsyncClient`` bound directly to the FastAPI ASGI app
(no real network socket needed) for fast, isolated endpoint tests.

Safety Policy:
- NEVER load ``.env`` with ``override=True`` during pytest.
- Unless ``ALLOW_LIVE_DB_TESTS=1`` is explicitly set, local test runs are
  strictly isolated onto an in-memory SQLite database so ``pytest`` can never
  connect to or insert synthetic test data into a live Supabase database.
- Ephemeral non-Supabase PostgreSQL test containers (e.g. GitHub Actions CI
  ``localhost:5432/erp_db``) remain supported when explicitly provided via
  ``DATABASE_URL``.
"""

from __future__ import annotations

import os
from collections.abc import AsyncGenerator

_configured_db_url = os.environ.get("DATABASE_URL", "").strip()
if os.environ.get("ALLOW_LIVE_DB_TESTS") != "1" and (
    not _configured_db_url
    or "supabase.com" in _configured_db_url.lower()
    or "supabase.co" in _configured_db_url.lower()
):
    os.environ["DATABASE_URL"] = "sqlite+aiosqlite:///:memory:"
    os.environ["DIRECT_URL"] = ""
    os.environ.setdefault("ENVIRONMENT", "test")

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

import app.database.engine as engine_module
from app.core.config import settings
from app.core.legacy_qa_guard import purge_retired_qa_files
from app.main import create_application

# Automatically remove any retired live-DB QA test/script files that might
# still exist as untracked copies on a developer/colleague machine.
purge_retired_qa_files()

# Also enforce isolation if Settings was imported before conftest ran.
if os.environ.get("ALLOW_LIVE_DB_TESTS") != "1" and (
    "supabase.com" in str(settings.DATABASE_URL).lower()
    or "supabase.co" in str(settings.DATABASE_URL).lower()
):
    object.__setattr__(settings, "DATABASE_URL", "sqlite+aiosqlite:///:memory:")


@pytest_asyncio.fixture(autouse=True)
async def isolate_sqlite_test_engine() -> AsyncGenerator[None, None]:
    """Dispose any lazily created SQLite test engine between tests."""
    is_sqlite = str(settings.DATABASE_URL).lower().startswith("sqlite")
    yield
    if is_sqlite and engine_module._engine is not None:
        await engine_module.dispose_engine()


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
    from app.cache import dependency as c_dep
    from app.durable_events import notify as d_notify
    from app.durable_events import worker as d_worker
    from app.queue import worker as q_worker

    q_worker._worker = None
    c_dep._cleanup_worker = None
    d_worker._worker = None
    d_notify._listener = None
    yield
    q_worker._worker = None
    c_dep._cleanup_worker = None
    d_worker._worker = None
    d_notify._listener = None
