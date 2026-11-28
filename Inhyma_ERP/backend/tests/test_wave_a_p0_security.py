"""
Wave A P0 Security Regression Tests for Inhyma_ERP (BUG-001, BUG-002, BUG-007).

Verifies strictly in isolated in-memory SQLite:
- BUG-001: Argon2id password hashing, legacy plaintext migration on valid login only,
  existing hash compatibility, concurrent conditional-update safety.
- BUG-002: Zero hardcoded SMTP credentials in default Settings, safe failure when SMTP
  credentials missing/placeholder, secret redaction in error logs.
- BUG-007: /api/v1/queue/* and /api/v1/cache/* require Super Admin (anonymous 401,
  0-permission employee 403, normal employee 403, super admin 200).
"""

from __future__ import annotations

import logging
import uuid
from unittest.mock import patch

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.auth.repository import PasswordHistoryRepository, SessionRepository, TokenBlacklistRepository
from app.auth.security import (
    create_access_token,
    hash_password,
    is_argon2_hash,
    needs_rehash,
    verify_password,
)
from app.auth.service import AuthService, LoginContext
from app.cache.in_memory import InMemoryCacheBackend
from app.cache.routes import router as cache_router
from app.common.email import _is_smtp_configured, _send_smtp_sync
from app.core.config import EnvironmentEnum, Settings, settings
from app.core.exception_handlers import register_exception_handlers
from app.database.base import Base
from app.database.session import get_db_session
from app.queue.routes import router as queue_router
from app.rbac.models import Role, UserRole
from app.rbac.repository import RoleRepository
from app.users.models import User, UserStatus
from app.users.repository import UserRepository

pytestmark = pytest.mark.asyncio


@pytest.fixture
async def isolated_db():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(bind=engine, class_=AsyncSession, expire_on_commit=False)
    async with factory() as session:
        yield session
    await engine.dispose()


# ---------------------------------------------------------------------------
# BUG-001: Argon2id Hashing & Safe Conditional Legacy Rehash
# ---------------------------------------------------------------------------


async def test_bug001_argon2id_hashing_and_legacy_rehash(isolated_db: AsyncSession):
    pw = "InhymaStrong!2026"
    hashed = hash_password(pw)
    assert hashed != pw
    assert is_argon2_hash(hashed) is True
    assert verify_password(pw, hashed) is True
    assert verify_password("Wrong!Pass123", hashed) is False
    assert needs_rehash(hashed) is False
    assert needs_rehash(pw) is True

    # Create user with legacy plaintext password_hash
    user = User(
        id=uuid.uuid4(),
        email="legacy-inhyma@example.com",
        username="legacy_inhyma",
        first_name="Legacy",
        last_name="User",
        password_hash="LegacyInhyma#2026!",
        status=UserStatus.ACTIVE,
        has_login=True,
    )
    isolated_db.add(user)
    await isolated_db.commit()

    cache = InMemoryCacheBackend()
    svc = AuthService(
        user_repository=UserRepository(isolated_db),
        session_repository=SessionRepository(isolated_db),
        token_blacklist_repository=TokenBlacklistRepository(isolated_db),
        password_history_repository=PasswordHistoryRepository(isolated_db),
        role_repository=RoleRepository(isolated_db),
        cache=cache,
    )

    # Invalid password MUST NOT trigger rehash
    with pytest.raises(Exception):
        await svc.login(identifier="legacy-inhyma@example.com", password="WrongPass#1", context=LoginContext())
    await isolated_db.commit()
    refreshed = await isolated_db.get(User, user.id)
    assert refreshed.password_hash == "LegacyInhyma#2026!"

    # Valid legacy login MUST upgrade password_hash to Argon2id
    logged_user, access_tok, refresh_tok = await svc.login(
        identifier="legacy-inhyma@example.com", password="LegacyInhyma#2026!", context=LoginContext()
    )
    await isolated_db.commit()
    assert logged_user.id == user.id and access_tok and refresh_tok
    upgraded = await isolated_db.get(User, user.id)
    assert upgraded.password_hash != "LegacyInhyma#2026!"
    assert is_argon2_hash(upgraded.password_hash) is True
    assert verify_password("LegacyInhyma#2026!", upgraded.password_hash) is True

    # Subsequent login against Argon2id succeeds
    logged_user2, _, _ = await svc.login(
        identifier="legacy-inhyma@example.com", password="LegacyInhyma#2026!", context=LoginContext()
    )
    assert logged_user2.id == user.id

    # Conditional update safety: stale old_hash cannot overwrite a concurrent password change
    concurrent_hash = hash_password("Concurrent!Changed#9")
    await isolated_db.execute(update(User).where(User.id == user.id).values(password_hash=concurrent_hash))
    await isolated_db.commit()
    stale = await isolated_db.execute(
        update(User)
        .where(User.id == user.id, User.password_hash == "LegacyInhyma#2026!")
        .values(password_hash=hash_password("ShouldNotApply!1"))
    )
    await isolated_db.commit()
    assert stale.rowcount == 0
    final_u = await isolated_db.get(User, user.id)
    assert final_u.password_hash == concurrent_hash


# ---------------------------------------------------------------------------
# BUG-002: No Hardcoded SMTP Credentials + Safe Failure + No Secret Logging
# ---------------------------------------------------------------------------


async def test_bug002_no_hardcoded_smtp_defaults_and_safe_failure(monkeypatch, caplog):
    fresh = Settings(_env_file=None)
    assert fresh.SMTP_USER == ""
    assert fresh.SMTP_PASSWORD == ""
    assert fresh.SMTP_FROM_EMAIL == ""

    # Missing creds fail safely
    monkeypatch.setattr(settings, "SMTP_USER", "")
    monkeypatch.setattr(settings, "SMTP_PASSWORD", "")
    monkeypatch.setattr(settings, "SMTP_FROM_EMAIL", "")
    monkeypatch.setattr(settings, "ENVIRONMENT", EnvironmentEnum.PRODUCTION)
    assert _is_smtp_configured() is False
    assert _send_smtp_sync(["recipient@example.com"], "Test", "<p>Hi</p>") is False

    # Placeholder creds fail safely
    monkeypatch.setattr(settings, "SMTP_USER", "your-smtp-user@example.com")
    monkeypatch.setattr(settings, "SMTP_PASSWORD", "your-smtp-app-password")
    monkeypatch.setattr(settings, "SMTP_FROM_EMAIL", "your-smtp-user@example.com")
    assert _is_smtp_configured() is False

    # Exception logs MUST redact SMTP_PASSWORD
    synthetic_secret = "SYNTHETIC_SMTP_SECRET_DO_NOT_LOG_98765"
    monkeypatch.setattr(settings, "SMTP_USER", "mailer@example.com")
    monkeypatch.setattr(settings, "SMTP_PASSWORD", synthetic_secret)
    monkeypatch.setattr(settings, "SMTP_FROM_EMAIL", "mailer@example.com")
    with caplog.at_level(logging.ERROR, logger="app.common.email"):
        with patch("app.common.email.smtplib.SMTP", side_effect=RuntimeError(f"auth failed for {synthetic_secret}")):
            ok = _send_smtp_sync(["recipient@example.com"], "Test", "<p>Hi</p>")
    assert ok is False
    assert synthetic_secret not in caplog.text


# ---------------------------------------------------------------------------
# BUG-007: Queue & Cache Endpoints Require Super Admin RBAC
# ---------------------------------------------------------------------------


async def test_bug007_queue_and_cache_rbac_enforces_super_admin(isolated_db: AsyncSession):
    from fastapi import Request

    test_app = FastAPI()
    register_exception_handlers(test_app)

    @test_app.middleware("http")
    async def _attach_request_id(request: Request, call_next):
        request.state.request_id = str(uuid.uuid4())
        return await call_next(request)

    test_app.include_router(queue_router, prefix="/api/v1")
    test_app.include_router(cache_router, prefix="/api/v1")

    async def _override_db():
        yield isolated_db

    test_app.dependency_overrides[get_db_session] = _override_db

    # Create 0-permission employee, regular employee, and super_admin
    zero_perm_user = User(
        id=uuid.uuid4(),
        email="zeroperm@example.com",
        username="zeroperm",
        first_name="Zero",
        last_name="Perm",
        password_hash=hash_password("Pass!123456"),
        status=UserStatus.ACTIVE,
        has_login=True,
    )
    normal_emp = User(
        id=uuid.uuid4(),
        email="employee@example.com",
        username="employee",
        first_name="Normal",
        last_name="Emp",
        password_hash=hash_password("Pass!123456"),
        status=UserStatus.ACTIVE,
        has_login=True,
    )
    super_admin = User(
        id=uuid.uuid4(),
        email="superadmin@example.com",
        username="superadmin",
        first_name="Super",
        last_name="Admin",
        password_hash=hash_password("Pass!123456"),
        status=UserStatus.ACTIVE,
        has_login=True,
    )
    emp_role = Role(id=uuid.uuid4(), name="employee_standard", description="Standard Employee", is_system=False)
    sa_role = Role(id=uuid.uuid4(), name="super_admin", description="Super Admin", is_system=True)
    isolated_db.add_all([zero_perm_user, normal_emp, super_admin, emp_role, sa_role])
    await isolated_db.flush()
    isolated_db.add_all([
        UserRole(user_id=normal_emp.id, role_id=emp_role.id),
        UserRole(user_id=super_admin.id, role_id=sa_role.id),
    ])
    await isolated_db.commit()

    zero_hdr = {"Authorization": f"Bearer {create_access_token(zero_perm_user.id, permissions=[]).token}"}
    emp_hdr = {"Authorization": f"Bearer {create_access_token(normal_emp.id, permissions=['inquiries:read']).token}"}
    sa_hdr = {"Authorization": f"Bearer {create_access_token(super_admin.id, permissions=['*']).token}"}

    endpoints = [
        ("GET", "/api/v1/queue/jobs"),
        ("GET", "/api/v1/queue/stats"),
        ("GET", "/api/v1/queue/registered-jobs"),
        ("GET", "/api/v1/queue/worker/status"),
        ("POST", "/api/v1/queue/jobs"),
        ("GET", "/api/v1/cache/stats"),
        ("GET", "/api/v1/cache/keys"),
        ("DELETE", "/api/v1/cache/flush"),
        ("DELETE", "/api/v1/cache/namespace/permissions"),
    ]

    async with AsyncClient(transport=ASGITransport(app=test_app), base_url="http://testserver") as client:
        for method, path in endpoints:
            body = {"job_name": "noop", "payload": {}} if (method == "POST" and path == "/api/v1/queue/jobs") else None
            # Anonymous -> 401
            r_anon = await client.request(method, path, json=body)
            assert r_anon.status_code == 401, f"Expected 401 anon on {method} {path}, got {r_anon.status_code}"

            # 0-perm employee -> 403
            r_zero = await client.request(method, path, json=body, headers=zero_hdr)
            assert r_zero.status_code == 403, f"Expected 403 zero-perm on {method} {path}, got {r_zero.status_code}"

            # Normal employee -> 403
            r_emp = await client.request(method, path, json=body, headers=emp_hdr)
            assert r_emp.status_code == 403, f"Expected 403 employee on {method} {path}, got {r_emp.status_code}"

        # Super Admin succeeds (200)
        assert (await client.get("/api/v1/queue/jobs", headers=sa_hdr)).status_code == 200
        assert (await client.get("/api/v1/queue/stats", headers=sa_hdr)).status_code == 200
        assert (await client.get("/api/v1/cache/stats", headers=sa_hdr)).status_code == 200
        assert (await client.get("/api/v1/cache/keys", headers=sa_hdr)).status_code == 200
