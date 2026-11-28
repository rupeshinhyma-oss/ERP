"""
Regression tests for BUG-005: Pytest test-database isolation safety guard.

Verifies that Yinglima_ERP's test harness never loads live Supabase credentials
from ``backend/.env`` and explicitly refuses any hosted/production/non-local DB URL.
"""

from __future__ import annotations

import pytest

from app.core.config import settings
from tests.conftest import assert_safe_test_database_url


@pytest.mark.parametrize(
    "unsafe_url",
    [
        "postgresql+asyncpg://user:pass@aws-0-ap-south-1.pooler.supabase.com:6543/postgres",
        "postgresql+asyncpg://postgres:secret@db.exampleproject.supabase.co:5432/postgres",
        "postgresql+asyncpg://user:pass@dpg-12345.oregon-postgres.render.com:5432/yinglima",
        "postgresql+asyncpg://user:pass@ep-cool-host.us-east-2.aws.neon.tech/neondb",
        "postgresql+asyncpg://user:pass@mydb.abc123.us-east-1.rds.amazonaws.com:5432/erp",
        "postgresql+asyncpg://user:pass@10.0.1.50:5432/yinglima_prod",
        "postgresql+asyncpg://postgres:pass@127.0.0.1:5432/postgres",
        "postgresql+asyncpg://postgres:pass@127.0.0.1:5432/production",
        "",
    ],
)
def test_unsafe_database_urls_are_rejected(unsafe_url: str) -> None:
    """Hosted, remote, empty, or system/production DB URLs must raise RuntimeError."""
    with pytest.raises(RuntimeError, match="SAFETY BLOCK|empty DATABASE_URL"):
        assert_safe_test_database_url(unsafe_url)


@pytest.mark.parametrize(
    "safe_url",
    [
        "sqlite+aiosqlite:///:memory:",
        "postgresql+asyncpg://postgres:root@127.0.0.1:5432/yinglima_test_db",
        "postgresql+asyncpg://postgres:root@localhost:5432/erp_db",
    ],
)
def test_isolated_local_database_urls_are_allowed(safe_url: str) -> None:
    """In-memory SQLite and dedicated local disposable PG test DBs are permitted."""
    assert_safe_test_database_url(safe_url)


def test_active_settings_database_url_is_isolated() -> None:
    """Running pytest without env vars must never connect to Supabase from .env."""
    active_url = str(settings.DATABASE_URL).lower()
    assert "supabase.com" not in active_url
    assert "supabase.co" not in active_url
    assert_safe_test_database_url(active_url)
