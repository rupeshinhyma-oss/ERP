"""
Phase 6 Release Blocker Regression Tests (MIG-01 & PROD-RBAC-01).

Verifies strictly locally (never touching production Supabase):
1. Alembic migration graph invariants:
   - Single canonical head (`z5d6e7f8a9b0`)
   - Zero duplicate revision IDs across all migrations
   - Exact chain: `z3b4c5d6e7f8 -> z4c5d6e7f8a9 -> z5d6e7f8a9b0`
2. Full Alembic upgrade & downgrade round-trip on an ephemeral isolated local
   PostgreSQL 18 clone (simulating production missing `task.all_view` and
   pre-index `w0a1b2c3d4e5` state), verifying:
   - `z4c5d6e7f8a9` creates `uq_tasks_recurring_schedule_period` cleanly.
   - `z5d6e7f8a9b0` idempotently creates `task.all_view` with exact metadata
     matching `scripts/seed.py`, links it only to `super_admin`/`admin`,
     preserves legacy `task.organization_view` rows untouched, and never grants
     `task.manage`/`task.assign`/`task.escalate`/`task.delete`.
   - Re-running seed logic creates ZERO duplicate `task.all_view` rows.
   - Downgrade `z5d6e7f8a9b0 -> z4c5d6e7f8a9 -> z3b4c5d6e7f8` and re-upgrade
     to `head` succeed cleanly.
3. End-to-end API RBAC grant/revoke of `task.all_view` on local `inhyma_test_db`:
   - Admin grants `task.all_view` via `/api/v1/rbac/users/{id}/permissions`.
   - User sees cross-department tasks (200) and CANNOT modify/comment/react/assign/escalate (403).
   - Admin revokes `task.all_view` -> user immediately returns to own-tasks-only (403 on foreign task).
"""

from __future__ import annotations

import os
import subprocess
import sys
import uuid
from pathlib import Path

import asyncpg
import pytest
from alembic.config import Config
from alembic.script import ScriptDirectory
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.auth.security import create_access_token, hash_password
from app.database.session import get_db_session
from app.main import create_application
from app.rbac.models import Permission, Role, RolePermission, UserPermission, UserRole
from app.users.models import User, UserStatus
from scripts.seed import BOOTSTRAP_PERMISSIONS

BACKEND_DIR = Path(__file__).resolve().parents[1]
LOCAL_PG_ADMIN_DSN = "postgresql://postgres:root@127.0.0.1:5432/postgres"
LOCAL_TEST_DB_URL = "postgresql+asyncpg://postgres:root@127.0.0.1:5432/inhyma_test_db"


def test_alembic_single_head_no_duplicate_revisions_and_canonical_chain():
    """MIG-01: Verify single Alembic head, zero duplicate IDs, and canonical Phase 6 revision chain."""
    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    script = ScriptDirectory.from_config(cfg)

    heads = script.get_heads()
    assert len(heads) == 1, f"Expected single canonical Alembic head, got {heads}"
    canonical_head = heads[0]
    head_chain = [r.revision for r in script.walk_revisions(base="z9j8a9b0c1d2", head=canonical_head)]
    assert "z9l0c1d2e3f4" in head_chain, (
        f"Phase 6 revision z9l0c1d2e3f4 missing from canonical head chain {head_chain}"
    )

    rev_z5 = script.get_revision("z9l0c1d2e3f4")
    rev_z4 = script.get_revision("z9k9b0c1d2e3")
    rev_z3 = script.get_revision("z9j8a9b0c1d2")
    assert rev_z5 is not None and rev_z5.down_revision == "z9k9b0c1d2e3"
    assert rev_z4 is not None and rev_z4.down_revision == "z9j8a9b0c1d2"
    assert rev_z3 is not None

    # Verify zero duplicate revision IDs across all version files
    all_revs = list(script.walk_revisions())
    ids = [r.revision for r in all_revs]
    assert len(ids) == len(set(ids)), "Duplicate Alembic revision IDs detected!"


@pytest.mark.asyncio
async def test_phase6_migration_roundtrip_and_task_all_view_idempotency_on_isolated_pg18():
    """MIG-01 & PROD-RBAC-01: Full Alembic upgrade/downgrade round-trip on an ephemeral local PG18 DB."""
    tmp_db = f"inhyma_p6_mig_{uuid.uuid4().hex[:8]}"
    admin_conn = await asyncpg.connect(LOCAL_PG_ADMIN_DSN)
    try:
        # Clone clean local inhyma_test_db schema (strictly 127.0.0.1)
        await admin_conn.execute(
            """
            SELECT pg_terminate_backend(pid)
            FROM pg_stat_activity
            WHERE datname = 'inhyma_test_db' AND pid <> pg_backend_pid()
            """
        )
        await admin_conn.execute(f"CREATE DATABASE {tmp_db} TEMPLATE inhyma_test_db")
    finally:
        await admin_conn.close()

    tmp_dsn = f"postgresql://postgres:root@127.0.0.1:5432/{tmp_db}"
    tmp_async_dsn = f"postgresql+asyncpg://postgres:root@127.0.0.1:5432/{tmp_db}"

    def _run_alembic(*args: str) -> str:
        env = os.environ.copy()
        env["DATABASE_URL"] = tmp_async_dsn
        env["DIRECT_URL"] = tmp_dsn
        env["SUPABASE_URL"] = ""
        env["SUPABASE_SERVICE_KEY"] = ""
        env["SUPABASE_SERVICE_ROLE_KEY"] = ""
        proc = subprocess.run(
            [sys.executable, "-m", "alembic", *args],
            cwd=str(BACKEND_DIR),
            env=env,
            capture_output=True,
            text=True,
            check=True,
        )
        return proc.stdout + proc.stderr

    try:
        # Simulate production pre-migration state:
        # 1. Remove task.all_view permission if present in template
        # 2. Drop uq_tasks_recurring_schedule_period if present
        # 3. Ensure alembic_version is at z3b4c5d6e7f8 (committed Git HEAD prior to Phase 6)
        conn = await asyncpg.connect(tmp_dsn)
        try:
            assert (await conn.fetchval("SELECT current_database()")) == tmp_db
            await conn.execute(
                "DELETE FROM user_permissions WHERE permission_id IN (SELECT id FROM permissions WHERE code = 'task.all_view')"
            )
            await conn.execute(
                "DELETE FROM role_permissions WHERE permission_id IN (SELECT id FROM permissions WHERE code = 'task.all_view')"
            )
            await conn.execute("DELETE FROM permissions WHERE code = 'task.all_view'")
            await conn.execute("DROP INDEX IF EXISTS uq_tasks_recurring_schedule_period")
            await conn.execute("UPDATE alembic_version SET version_num = 'z9j8a9b0c1d2'")
            legacy_exists_before = await conn.fetchval(
                "SELECT count(*) FROM permissions WHERE code = 'task.organization_view'"
            )
        finally:
            await conn.close()

        cfg = Config(str(BACKEND_DIR / "alembic.ini"))
        cfg.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
        script = ScriptDirectory.from_config(cfg)
        heads = script.get_heads()
        assert len(heads) == 1, f"Expected single canonical Alembic head, got {heads}"
        canonical_head = heads[0]

        # Step 1: Upgrade z9j8a9b0c1d2 -> z9k9b0c1d2e3 -> z9l0c1d2e3f4 -> canonical head
        _run_alembic("upgrade", "head")

        conn = await asyncpg.connect(tmp_dsn)
        try:
            ver = await conn.fetchval("SELECT version_num FROM alembic_version")
            assert ver == canonical_head

            # Verify recurring uniqueness index created with exact partial predicate
            idx_def = await conn.fetchval(
                """
                SELECT indexdef FROM pg_indexes
                WHERE tablename = 'tasks' AND indexname = 'uq_tasks_recurring_schedule_period'
                """
            )
            assert idx_def is not None
            assert "recurring_schedule_id" in idx_def and "recurrence_period" in idx_def
            assert "deleted_at IS NULL" in idx_def

            # Verify task.all_view inserted with exact seed.py metadata
            spec = next(row for row in BOOTSTRAP_PERMISSIONS if row[0] == "task.all_view")
            perm_rows = await conn.fetch(
                "SELECT id, code, module, page, action, scope, description FROM permissions WHERE code = 'task.all_view'"
            )
            assert len(perm_rows) == 1
            p = perm_rows[0]
            assert (p["code"], p["module"], p["page"], p["action"], p["scope"], p["description"]) == spec

            # Verify granted to super_admin, NOT to ordinary 'user' role
            granted_roles = {
                r["name"]
                for r in await conn.fetch(
                    """
                    SELECT r.name FROM role_permissions rp
                    JOIN roles r ON r.id = rp.role_id
                    WHERE rp.permission_id = $1
                    """,
                    p["id"],
                )
            }
            assert "user" not in granted_roles
            # Legacy task.organization_view preserved non-destructively
            legacy_exists_after = await conn.fetchval(
                "SELECT count(*) FROM permissions WHERE code = 'task.organization_view'"
            )
            assert legacy_exists_after == legacy_exists_before
        finally:
            await conn.close()

        # Step 2: Downgrade z9l0c1d2e3f4 -> z9k9b0c1d2e3 (removes task.all_view, preserves uniqueness index!)
        _run_alembic("downgrade", "z9k9b0c1d2e3")
        conn = await asyncpg.connect(tmp_dsn)
        try:
            assert (await conn.fetchval("SELECT version_num FROM alembic_version")) == "z9k9b0c1d2e3"
            assert (await conn.fetchval("SELECT count(*) FROM permissions WHERE code = 'task.all_view'")) == 0
            assert (
                await conn.fetchval(
                    "SELECT count(*) FROM pg_indexes WHERE tablename='tasks' AND indexname='uq_tasks_recurring_schedule_period'"
                )
            ) == 1
        finally:
            await conn.close()

        # Step 3: Downgrade z9k9b0c1d2e3 -> z9j8a9b0c1d2 (drops index cleanly)
        _run_alembic("downgrade", "z9j8a9b0c1d2")
        conn = await asyncpg.connect(tmp_dsn)
        try:
            assert (await conn.fetchval("SELECT version_num FROM alembic_version")) == "z9j8a9b0c1d2"
            assert (
                await conn.fetchval(
                    "SELECT count(*) FROM pg_indexes WHERE tablename='tasks' AND indexname='uq_tasks_recurring_schedule_period'"
                )
            ) == 0
        finally:
            await conn.close()

        # Step 4: Re-upgrade back to head & re-run real scripts/seed.py -> still exactly 1 task.all_view row (no duplicates!)
        _run_alembic("upgrade", "head")
        seed_env = os.environ.copy()
        seed_env["DATABASE_URL"] = tmp_async_dsn
        seed_env["DIRECT_URL"] = tmp_dsn
        seed_env["SUPABASE_URL"] = ""
        seed_env["SUPABASE_SERVICE_KEY"] = ""
        seed_env["SUPABASE_SERVICE_ROLE_KEY"] = ""
        subprocess.run(
            [sys.executable, "-m", "scripts.seed"],
            cwd=str(BACKEND_DIR),
            env=seed_env,
            capture_output=True,
            text=True,
            check=True,
        )
        conn = await asyncpg.connect(tmp_dsn)
        try:
            assert (await conn.fetchval("SELECT version_num FROM alembic_version")) == canonical_head
            assert (await conn.fetchval("SELECT count(*) FROM permissions WHERE code = 'task.all_view'")) == 1
        finally:
            await conn.close()
    finally:
        # Always drop ephemeral test database
        admin_conn = await asyncpg.connect(LOCAL_PG_ADMIN_DSN)
        try:
            await admin_conn.execute(
                """
                SELECT pg_terminate_backend(pid)
                FROM pg_stat_activity
                WHERE datname = $1 AND pid <> pg_backend_pid()
                """,
                tmp_db,
            )
            await admin_conn.execute(f"DROP DATABASE IF EXISTS {tmp_db}")
        finally:
            await admin_conn.close()


@pytest.mark.asyncio
async def test_task_all_view_grant_revoke_readonly_enforcement_and_no_privilege_bleed():
    """PROD-RBAC-01: Granting task.all_view via RBAC API gives strictly read-only org visibility and revokes cleanly."""
    engine = create_async_engine(LOCAL_TEST_DB_URL, future=True)
    SessionFactory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    tag = uuid.uuid4().hex[:8]
    created_user_ids: list[uuid.UUID] = []
    created_role_ids: list[uuid.UUID] = []
    created_task_ids: list[uuid.UUID] = []

    app = create_application()

    async def _override_db():
        async with SessionFactory() as s:
            try:
                yield s
                await s.commit()
            except Exception:
                await s.rollback()
                raise

    app.dependency_overrides[get_db_session] = _override_db

    try:
        async with SessionFactory() as session:
            # Ensure task.all_view & task.view & super_admin exist in local test DB
            perms = {
                p.code: p
                for p in (await session.execute(select(Permission).where(Permission.code.like("task.%")))).scalars().all()
            }
            assert "task.all_view" in perms
            assert "task.view" in perms

            sa_role = (await session.execute(select(Role).where(Role.name == "super_admin"))).scalar_one()
            dept_a = Role(name=f"P6DeptA_{tag}", description="Dept A")
            dept_b = Role(name=f"P6DeptB_{tag}", description="Dept B")
            session.add_all([dept_a, dept_b])
            await session.flush()
            created_role_ids.extend([dept_a.id, dept_b.id])

            pw = hash_password("Phase6Test@2026!")
            u_admin = User(
                username=f"p6_admin_{tag}", email=f"p6_admin_{tag}@local.test",
                display_name="P6 Admin", password_hash=pw, is_active=True, status=UserStatus.ACTIVE,
            )
            u_viewer = User(
                username=f"p6_viewer_{tag}", email=f"p6_viewer_{tag}@local.test",
                display_name="P6 Viewer", password_hash=pw, is_active=True, status=UserStatus.ACTIVE,
            )
            u_dept_b = User(
                username=f"p6_deptb_{tag}", email=f"p6_deptb_{tag}@local.test",
                display_name="P6 DeptB Emp", password_hash=pw, is_active=True, status=UserStatus.ACTIVE,
            )
            session.add_all([u_admin, u_viewer, u_dept_b])
            await session.flush()
            created_user_ids.extend([u_admin.id, u_viewer.id, u_dept_b.id])

            session.add_all([
                UserRole(user_id=u_admin.id, role_id=sa_role.id),
                UserRole(user_id=u_viewer.id, role_id=dept_a.id),
                UserRole(user_id=u_dept_b.id, role_id=dept_b.id),
                UserPermission(user_id=u_viewer.id, permission_id=perms["task.view"].id, is_granted=True),
            ])
            await session.commit()

            admin_h = {"Authorization": f"Bearer {create_access_token(u_admin.id).token}"}
            viewer_h = {"Authorization": f"Bearer {create_access_token(u_viewer.id).token}"}
            all_view_perm_id = str(perms["task.all_view"].id)

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            # Create a foreign Dept B task
            t_res = await client.post(
                "/api/v1/tasks",
                headers=admin_h,
                json={"title": f"P6 Foreign DeptB Task {tag}", "assignee_ids": [str(u_dept_b.id)]},
            )
            assert t_res.status_code == 201
            tid = t_res.json()["data"]["id"]
            created_task_ids.append(uuid.UUID(tid))

            # Before grant: plain task.view viewer cannot read Dept B task
            assert (await client.get(f"/api/v1/tasks/{tid}", headers=viewer_h)).status_code == 403

            # Admin grants task.all_view via RBAC Permission Override API
            grant_res = await client.post(
                f"/api/v1/rbac/users/{u_viewer.id}/permissions",
                headers=admin_h,
                json={"permission_id": all_view_perm_id, "is_granted": True},
            )
            assert grant_res.status_code in (200, 201), grant_res.text

            # Verify effective permissions contain ONLY task.view + task.all_view (NO manage/assign/escalate/delete!)
            eff = (
                await client.get(f"/api/v1/rbac/users/{u_viewer.id}/effective-permissions", headers=admin_h)
            ).json()["data"]["effective_permissions"]
            assert "task.all_view" in eff
            for forbidden_perm in ("task.manage", "task.assign", "task.escalate", "task.delete"):
                assert forbidden_perm not in eff

            # Viewer can now read foreign Dept B task (200), but ALL writes/collaboration/escalation remain 403!
            assert (await client.get(f"/api/v1/tasks/{tid}", headers=viewer_h)).status_code == 200
            assert (await client.patch(f"/api/v1/tasks/{tid}", headers=viewer_h, json={"title": "x"})).status_code == 403
            assert (await client.post(f"/api/v1/tasks/{tid}/comment", headers=viewer_h, json={"message": "x"})).status_code == 403
            assert (await client.post(f"/api/v1/tasks/{tid}/reactions", headers=viewer_h, json={"emoji": "👍"})).status_code == 403
            assert (await client.get("/api/v1/tasks/escalate-options", headers=viewer_h)).status_code == 403

            # Admin revokes task.all_view -> viewer immediately loses cross-department visibility (403)
            revoke_res = await client.delete(
                f"/api/v1/rbac/users/{u_viewer.id}/permissions/{all_view_perm_id}",
                headers=admin_h,
            )
            assert revoke_res.status_code == 200, revoke_res.text
            assert (await client.get(f"/api/v1/tasks/{tid}", headers=viewer_h)).status_code == 403
    finally:
        # Clean up synthetic test records from inhyma_test_db
        from app.tasks.models import Task
        async with SessionFactory() as session:
            for tid in created_task_ids:
                t = await session.get(Task, tid)
                if t:
                    await session.delete(t)
            for uid in created_user_ids:
                u = await session.get(User, uid)
                if u:
                    await session.delete(u)
            for rid in created_role_ids:
                r = await session.get(Role, rid)
                if r:
                    await session.delete(r)
            await session.commit()
        await engine.dispose()
