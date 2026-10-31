"""Tests for retired synthetic-QA file sweeper and engine-level Supabase pytest guard."""

from __future__ import annotations

from pathlib import Path

import pytest

import app.database.engine as engine_module
from app.core.config import settings
from app.core.legacy_qa_guard import RETIRED_SYNTHETIC_QA_FILES, purge_retired_qa_files


def test_purge_retired_qa_files_deletes_lingering_untracked_qa_files(tmp_path: Path):
    """Verify retired live-DB QA test/script files are deleted if lingering on a colleague machine."""
    sample_retired = tmp_path / "backend" / "tests" / "test_tasks_recurring.py"
    sample_retired.parent.mkdir(parents=True, exist_ok=True)
    sample_retired.write_text("# legacy live-db test\n", encoding="utf-8")

    sample_script = tmp_path / "backend" / "scripts" / "provision_tasks_qa_personas.py"
    sample_script.parent.mkdir(parents=True, exist_ok=True)
    sample_script.write_text("# legacy qa script\n", encoding="utf-8")

    keep_valid_test = tmp_path / "backend" / "tests" / "test_valid_isolated.py"
    keep_valid_test.write_text("# active isolated test\n", encoding="utf-8")

    removed = purge_retired_qa_files(inhyma_root=tmp_path)

    assert "backend/tests/test_tasks_recurring.py" in removed
    assert "backend/scripts/provision_tasks_qa_personas.py" in removed
    assert not sample_retired.exists()
    assert not sample_script.exists()
    assert keep_valid_test.exists()
    assert len(RETIRED_SYNTHETIC_QA_FILES) == 45


@pytest.mark.asyncio
async def test_engine_blocks_supabase_url_during_pytest_even_if_settings_mutated(monkeypatch: pytest.MonkeyPatch):
    """Verify get_engine() forces in-memory SQLite even if settings.DATABASE_URL holds a Supabase URL."""
    await engine_module.dispose_engine()
    monkeypatch.delenv("ALLOW_LIVE_DB_TESTS", raising=False)
    prev_url = settings.DATABASE_URL
    try:
        object.__setattr__(
            settings,
            "DATABASE_URL",
            "postgresql+asyncpg://postgres.kkqxkgdrmvnnvptpjpmi:secret@aws-0-ap-south-1.pooler.supabase.com:6543/postgres",
        )
        eng = engine_module.get_engine()
        assert str(eng.url).startswith("sqlite")
    finally:
        object.__setattr__(settings, "DATABASE_URL", prev_url)
        await engine_module.dispose_engine()

