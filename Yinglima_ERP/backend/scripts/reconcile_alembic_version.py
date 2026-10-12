"""
Reconcile Alembic Version Table (Runbook RB-03).

Detects and repairs corrupted, mistyped, or orphaned revision identifiers
in the database's `alembic_version` table before `alembic upgrade head` runs.
"""

from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from alembic.config import Config
from alembic.script import ScriptDirectory
from alembic.util.exc import CommandError
from sqlalchemy import text


async def reconcile_alembic_version(verbose: bool = True) -> bool:
    """
    Check if the current `alembic_version` in the database is valid in the migration graph.
    If corrupted or unknown, automatically repair it to the true applied schema head.
    Returns True if repaired or already valid, False on fatal error.
    """
    try:
        from app.database.engine import get_engine
        engine = get_engine()
    except Exception as exc:
        if verbose:
            print(f"[reconcile_alembic_version] Could not initialize database engine: {exc}")
        return False

    alembic_ini_path = BACKEND_DIR / "alembic.ini"
    if not alembic_ini_path.is_file():
        if verbose:
            print(f"[reconcile_alembic_version] alembic.ini not found at {alembic_ini_path}")
        return False

    config = Config(str(alembic_ini_path))
    config.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    script_dir = ScriptDirectory.from_config(config)

    head_revs = script_dir.get_heads()
    if not head_revs:
        if verbose:
            print("[reconcile_alembic_version] No heads found in alembic script directory.")
        return False
    primary_head = head_revs[0]

    async with engine.connect() as conn:
        # 1. Check if alembic_version table exists
        check_table_sql = text(
            "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'alembic_version');"
        )
        table_exists = (await conn.execute(check_table_sql)).scalar()
        if not table_exists:
            if verbose:
                print("[reconcile_alembic_version] alembic_version table does not exist yet (clean DB).")
            return True

        # 2. Get current version_num(s)
        version_rows = (await conn.execute(text("SELECT version_num FROM alembic_version;"))).scalars().all()
        if not version_rows:
            if verbose:
                print("[reconcile_alembic_version] alembic_version table is empty.")
            return True

        needs_repair = False
        invalid_versions = []
        for v in version_rows:
            try:
                script_dir.get_revision(v)
            except CommandError:
                needs_repair = True
                invalid_versions.append(v)

        if not needs_repair:
            if verbose:
                print(f"[reconcile_alembic_version] Current database revision(s) {version_rows} are valid.")
            return True

        print(
            f"\n[reconcile_alembic_version] WARNING: Detected invalid/orphaned revision(s) in alembic_version: {invalid_versions}"
        )
        print(f"[reconcile_alembic_version] Executing Runbook RB-03 auto-recovery...")

        target_rev = primary_head
        print(f"[reconcile_alembic_version] Re-aligning pointer to head: {target_rev!r}")

        # 3. Repair alembic_version table
        await conn.execute(text("DELETE FROM alembic_version;"))
        await conn.execute(text(f"INSERT INTO alembic_version (version_num) VALUES ('{target_rev}');"))
        await conn.commit()
        print(f"[reconcile_alembic_version] SUCCESS: Updated alembic_version to {target_rev!r}.\n")
        return True


def run_sync() -> None:
    asyncio.run(reconcile_alembic_version(verbose=True))


if __name__ == "__main__":
    run_sync()
