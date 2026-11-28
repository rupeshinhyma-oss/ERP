"""
Shared Pytest Fixtures.

Provides an ``httpx.AsyncClient`` bound directly to the FastAPI ASGI app
(no real network socket needed) for fast, isolated endpoint tests.

Safety Policy (BUG-005):
- NEVER load ``backend/.env`` during pytest (``.env`` holds live Supabase credentials).
- Explicitly refuse test execution if any configured database URL points to a
  hosted, shared, or non-local database (Supabase, Render, Neon, RDS, etc.).
- Default to an isolated in-memory SQLite database unless a verified local test
  PostgreSQL URL is explicitly provided via ``TEST_DATABASE_URL`` or ``DATABASE_URL``.
"""

from __future__ import annotations

from collections.abc import AsyncGenerator
import os
import shutil
import tempfile
from urllib.parse import urlparse

_TEMP_SQLITE_DIR: str | None = None

_FORBIDDEN_DB_HOST_FRAGMENTS: tuple[str, ...] = (
    "supabase.com",
    "supabase.co",
    "pooler.supabase",
    "render.com",
    "neon.tech",
    "rds.amazonaws.com",
    "database.azure.com",
    "cloudsql",
    "aivencloud.com",
    "elephantsql.com",
    "railway.app",
    "heroku.com",
)
_ALLOWED_LOCAL_PG_HOSTS: set[str] = {"localhost", "127.0.0.1", "::1", "postgres", "db"}


def assert_safe_test_database_url(url: str) -> None:
    """Refuse to run tests against any hosted, shared, or non-local database URL."""
    raw = (url or "").strip()
    if not raw:
        raise RuntimeError("Refusing to run pytest with an empty DATABASE_URL.")

    lowered = raw.lower()
    if lowered.startswith("sqlite"):
        return

    for fragment in _FORBIDDEN_DB_HOST_FRAGMENTS:
        if fragment in lowered:
            raise RuntimeError(
                f"SAFETY BLOCK (BUG-005): Refusing to run pytest against hosted/production "
                f"database host matching {fragment!r}. Configure an isolated local test database."
            )

    parsed = urlparse(raw)
    host = (parsed.hostname or "").lower()
    if host not in _ALLOWED_LOCAL_PG_HOSTS:
        raise RuntimeError(
            f"SAFETY BLOCK (BUG-005): Refusing to run pytest against non-local database host "
            f"{host!r}. Only isolated local PostgreSQL ({sorted(_ALLOWED_LOCAL_PG_HOSTS)}) or SQLite is allowed."
        )

    db_name = (parsed.path or "").lstrip("/").lower()
    if db_name in {"", "postgres", "template0", "template1", "production", "prod", "main"}:
        raise RuntimeError(
            f"SAFETY BLOCK (BUG-005): Refusing to run pytest against system/production database "
            f"name {db_name!r}. Use a dedicated disposable local test database."
        )


def _configure_isolated_test_database() -> str:
    """Resolve and validate the isolated database URL BEFORE importing app settings."""
    explicit_test_url = os.environ.get("TEST_DATABASE_URL", "").strip()
    explicit_db_url = os.environ.get("DATABASE_URL", "").strip()

    if explicit_test_url:
        assert_safe_test_database_url(explicit_test_url)
        target_url = explicit_test_url
    elif explicit_db_url:
        assert_safe_test_database_url(explicit_db_url)
        target_url = explicit_db_url
    else:
        global _TEMP_SQLITE_DIR
        _TEMP_SQLITE_DIR = tempfile.mkdtemp(prefix="yinglima_pytest_sqlite_")
        db_file = os.path.join(_TEMP_SQLITE_DIR, "test.db").replace("\\", "/")
        target_url = f"sqlite+aiosqlite:///{db_file}"

    os.environ["DATABASE_URL"] = target_url
    os.environ["DIRECT_URL"] = ""
    os.environ["ENVIRONMENT"] = "test"
    return target_url


_ISOLATED_TEST_DB_URL = _configure_isolated_test_database()

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

import app.database.engine as engine_module
from app.core.config import settings
from app.main import create_application

# Double-check after Settings loads so pydantic-settings can NEVER sneak in `.env` Supabase URLs.
assert_safe_test_database_url(str(settings.DATABASE_URL))


@pytest_asyncio.fixture
async def client() -> AsyncGenerator[AsyncClient, None]:
    """Yield an async test client wired to a fresh application instance."""
    assert_safe_test_database_url(str(settings.DATABASE_URL))
    app = create_application()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as ac:
        async with app.router.lifespan_context(app):
            yield ac


@pytest.fixture
def anyio_backend() -> str:
    """Restrict async tests to the asyncio backend only."""
    return "asyncio"


def pytest_runtest_setup(item: pytest.Item) -> None:
    """Skip @pytest.mark.postgres tests when running under SQLite without an explicit local PG test DB."""
    if "postgres" in item.keywords:
        db_url = str(settings.DATABASE_URL).lower()
        pg_override = os.environ.get("TEST_DATABASE_URL", "").strip().lower()
        if db_url.startswith("sqlite") and not pg_override.startswith("postgresql"):
            pytest.skip(
                "PostgreSQL-only test skipped on SQLite (run with isolated local PostgreSQL DATABASE_URL / TEST_DATABASE_URL)."
            )


@pytest_asyncio.fixture(autouse=True)
async def isolate_test_engine_and_peer_health() -> AsyncGenerator[None, None]:
    """Verify isolated DB identity, initialize SQLite schema when needed, and clean up cleanly."""
    assert_safe_test_database_url(str(settings.DATABASE_URL))
    is_sqlite = str(settings.DATABASE_URL).lower().startswith("sqlite")
    if is_sqlite:
        from app.database.base import Base
        # Ensure all ORM models are registered on Base.metadata before create_all
        import app.integration.models  # noqa: F401
        import app.integration.consumer_models  # noqa: F401
        import app.integration.sync_models  # noqa: F401
        import app.durable_events.models  # noqa: F401
        import app.sales.models  # noqa: F401
        import app.purchases.local.models  # noqa: F401
        import app.stock.models  # noqa: F401
        import app.finance.models  # noqa: F401
        import app.notifications.models  # noqa: F401
        async with engine_module.get_engine().begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
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
    if is_sqlite and engine_module._engine is not None:
        await engine_module.dispose_engine()


def pytest_sessionfinish(session: pytest.Session, exitstatus: int) -> None:
    """Remove disposable per-session SQLite temp directory cleanly."""
    global _TEMP_SQLITE_DIR
    if _TEMP_SQLITE_DIR and os.path.isdir(_TEMP_SQLITE_DIR):
        shutil.rmtree(_TEMP_SQLITE_DIR, ignore_errors=True)
        _TEMP_SQLITE_DIR = None
