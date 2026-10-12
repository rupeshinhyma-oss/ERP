"""Guard against schema drift: the migrations alone must build the database the app expects.

Two checks:
  * ``test_single_migration_head`` always runs (no database needed).
  * ``test_empty_database_builds_from_migrations_and_matches_models`` runs only when
    ``ERP_MIGRATION_TEST_DB_URL`` points at an EMPTY PostgreSQL database, e.g.
        createdb erp_chain_test
        ERP_MIGRATION_TEST_DB_URL=postgresql://user:pw@localhost:5432/erp_chain_test pytest tests/test_migrations_match_models.py
    It applies the whole Alembic chain, then fails if any model table or column is missing from the result.
    (This is what would have caught tables that existed only because the app created them at startup.)
"""

from __future__ import annotations

import importlib
import os
import subprocess
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.config import Config
from alembic.script import ScriptDirectory

BACKEND = Path(__file__).resolve().parents[1]
DB_URL = os.environ.get("ERP_MIGRATION_TEST_DB_URL", "").strip()


def test_single_migration_head():
    cfg = Config(str(BACKEND / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND / "alembic"))
    heads = ScriptDirectory.from_config(cfg).get_heads()
    assert len(heads) == 1, f"migration chain has several heads (needs a merge migration): {heads}"


def _load_models() -> sa.MetaData:
    import sys

    if str(BACKEND) not in sys.path:
        sys.path.insert(0, str(BACKEND))
    for path in sorted((BACKEND / "app").rglob("models.py")):
        importlib.import_module(".".join(path.relative_to(BACKEND).with_suffix("").parts))
    from app.database.base import Base

    return Base.metadata


@pytest.mark.skipif(not DB_URL, reason="set ERP_MIGRATION_TEST_DB_URL to an EMPTY PostgreSQL database to run this check")
def test_empty_database_builds_from_migrations_and_matches_models():
    sync_url = DB_URL.replace("postgresql+asyncpg://", "postgresql+psycopg2://")
    if sync_url.startswith("postgresql://"):
        sync_url = sync_url.replace("postgresql://", "postgresql+psycopg2://", 1)
    engine = sa.create_engine(sync_url)
    try:
        assert not sa.inspect(engine).get_table_names(), "ERP_MIGRATION_TEST_DB_URL must point at an EMPTY database"

        plain = sync_url.replace("postgresql+psycopg2://", "postgresql://", 1)
        env = {
            **os.environ,
            "ENVIRONMENT": "development",
            "DIRECT_URL": plain,
            "DATABASE_URL": plain.replace("postgresql://", "postgresql+asyncpg://", 1),
        }
        run = subprocess.run(
            ["alembic", "-c", "alembic.ini", "upgrade", "head"],
            cwd=BACKEND, env=env, capture_output=True, text=True, timeout=900,
        )
        assert run.returncode == 0, "the migration chain failed on an empty database:\n" + (run.stderr or run.stdout)[-1800:]

        metadata = _load_models()
        inspector = sa.inspect(engine)
        db_tables = set(inspector.get_table_names())
        missing_tables = sorted(t for t in metadata.tables if t not in db_tables)
        missing_columns = {}
        for name, table in metadata.tables.items():
            if name in db_tables:
                have = {c["name"] for c in inspector.get_columns(name)}
                gone = sorted(c.name for c in table.columns if c.name not in have)
                if gone:
                    missing_columns[name] = gone
        assert not missing_tables, f"tables the models need but no migration creates: {missing_tables}"
        assert not missing_columns, f"columns the models need but no migration adds: {missing_columns}"
    finally:
        engine.dispose()
