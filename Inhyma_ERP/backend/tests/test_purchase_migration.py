"""The purchase tables migration creates exactly the tables and columns the models define."""

from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy.pool import StaticPool

from app.purchase import models as pm

VERSIONS = Path(__file__).resolve().parents[1] / "alembic" / "versions"
TABLES = [pm.LocalPurchase.__table__, pm.LocalPurchaseItem.__table__, pm.ImportPurchase.__table__, pm.ImportPurchaseItem.__table__]


def _run(sync_conn, fn: str) -> None:
    spec = importlib.util.spec_from_file_location("l1", VERSIONS / "l1a2b3c4d5e9_create_purchase_tables.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    with Operations.context(MigrationContext.configure(sync_conn)):
        getattr(module, fn)()


@pytest.mark.asyncio
async def test_migration_matches_the_models_and_is_idempotent_and_reversible():
    engine = create_async_engine("sqlite+aiosqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
    async with engine.begin() as conn:
        await conn.run_sync(_run, "upgrade")
        await conn.run_sync(_run, "upgrade")                    # running it twice changes nothing
        insp = await conn.run_sync(lambda c: sa.inspect(c))
        for table in TABLES:
            created = {c["name"]: c for c in await conn.run_sync(lambda c, t=table: sa.inspect(c).get_columns(t.name))}
            assert set(created) == {c.name for c in table.columns}, table.name
            for col in table.columns:
                assert created[col.name]["nullable"] == col.nullable or col.primary_key, (table.name, col.name)
        indexed = await conn.run_sync(lambda c: {i["name"] for i in sa.inspect(c).get_indexes("local_purchases")})
        assert "ix_local_purchases_warehouse" in indexed and "ix_local_purchases_status" in indexed
        await conn.run_sync(_run, "downgrade")
        left = await conn.run_sync(lambda c: set(sa.inspect(c).get_table_names()))
        assert not left & {t.name for t in TABLES}
    await engine.dispose()
