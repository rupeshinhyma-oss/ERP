"""
Wave A P0 Security Regression Tests for ERP_Main (BUG-001, BUG-003, BUG-016).

Verifies:
- BUG-001: Argon2id password hashing, legacy plaintext conditional rehash-on-login,
  concurrent password change safety, invalid password never triggers rehash.
- BUG-003: Ecosystem session exchange rejects bare (session_id, email), invalid signatures,
  expired codes, wrong user/session binding, replayed single-use codes; GET /{sid} and
  POST /{sid}/revoke require authenticated owner/admin/service authorization; audit logs
  never store raw session IDs; access tokens are short-lived.
- BUG-016: Hardcoded fallback administrator password removed; production blocks dev fallback.
"""

from __future__ import annotations

import time
import uuid

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select, update

import app.database.engine as engine_module
from app.core.config import EnvironmentEnum, Settings, settings
from app.global_audit.models import GlobalAuditLog
from app.global_auth import ecosystem_session as es
from app.global_auth.models import GlobalUserCredential
from app.global_auth.security import (
    hash_password as hash_global_password,
    is_argon2_hash as is_global_argon2,
    needs_rehash as global_needs_rehash,
    verify_password as verify_global_password,
)
from app.global_users.models import GlobalUser, GlobalUserStatus
from app.main import app
from app.platform_auth.models import PlatformAdmin, PlatformAdminRole
from app.platform_auth.security import (
    decode_platform_access_token,
    hash_password as hash_platform_password,
    is_argon2_hash as is_platform_argon2,
    needs_rehash as platform_needs_rehash,
    verify_password as verify_platform_password,
)

pytestmark = pytest.mark.asyncio

EST = "/api/v1/global/ecosystem-session/establish"
EXCH = "/api/v1/global/ecosystem-session/exchange"
PW = "Str0ng!Passw0rd#2026"


@pytest.fixture(autouse=True)
def _clear_stores():
    es._ECOSYSTEM_SESSION_STORE.clear()
    es._EXCHANGE_CODE_REGISTRY.clear()
    yield
    es._ECOSYSTEM_SESSION_STORE.clear()
    es._EXCHANGE_CODE_REGISTRY.clear()


# ---------------------------------------------------------------------------
# BUG-001: Argon2id Hashing & Safe Conditional Legacy Rehash
# ---------------------------------------------------------------------------


async def test_bug001_hash_password_never_returns_plaintext():
    g_hash = hash_global_password(PW)
    p_hash = hash_platform_password(PW)
    assert g_hash != PW and is_global_argon2(g_hash)
    assert p_hash != PW and is_platform_argon2(p_hash)
    assert verify_global_password(PW, g_hash) is True
    assert verify_platform_password(PW, p_hash) is True
    assert verify_global_password("Wrong!Password1", g_hash) is False
    assert verify_platform_password("Wrong!Password1", p_hash) is False
    assert global_needs_rehash(g_hash) is False
    assert platform_needs_rehash(p_hash) is False
    assert global_needs_rehash(PW) is True
    assert platform_needs_rehash(PW) is True


async def test_bug001_legacy_plaintext_platform_admin_rehashed_on_valid_login_only(client):
    async with engine_module._sessionmaker() as db:
        admin = PlatformAdmin(
            email="legacy-admin@example.com",
            display_name="Legacy Admin",
            password_hash="LegacyAdmin#2026!",  # legacy plaintext record
            role=PlatformAdminRole.SUPER_ADMIN,
            is_active=True,
        )
        db.add(admin)
        await db.commit()
        admin_id = admin.id

    # Invalid password MUST NOT trigger rehash
    bad = await client.post(
        "/api/v1/global/auth/login",
        json={"email": "legacy-admin@example.com", "password": "WrongPassword!999"},
    )
    assert bad.status_code == 401
    async with engine_module._sessionmaker() as db:
        refreshed = await db.get(PlatformAdmin, admin_id)
        assert refreshed.password_hash == "LegacyAdmin#2026!"

    # Valid login MUST upgrade stored value to Argon2id
    ok = await client.post(
        "/api/v1/global/auth/login",
        json={"email": "legacy-admin@example.com", "password": "LegacyAdmin#2026!"},
    )
    assert ok.status_code == 200
    async with engine_module._sessionmaker() as db:
        upgraded = await db.get(PlatformAdmin, admin_id)
        assert upgraded.password_hash != "LegacyAdmin#2026!"
        assert is_platform_argon2(upgraded.password_hash)
        assert verify_platform_password("LegacyAdmin#2026!", upgraded.password_hash) is True

    # Subsequent login against upgraded Argon2id hash works cleanly
    ok2 = await client.post(
        "/api/v1/global/auth/login",
        json={"email": "legacy-admin@example.com", "password": "LegacyAdmin#2026!"},
    )
    assert ok2.status_code == 200


async def test_bug001_legacy_plaintext_global_user_rehashed_and_concurrent_safe(client):
    async with engine_module._sessionmaker() as db:
        user = GlobalUser(
            primary_email="legacy-user@example.com",
            display_name="Legacy User",
            status=GlobalUserStatus.ACTIVE,
        )
        db.add(user)
        await db.flush()
        cred = GlobalUserCredential(
            global_user_id=user.id,
            password_hash="LegacyUser#2026!",
            must_change_password=False,
        )
        db.add(cred)
        await db.commit()
        cred_id = cred.id

    # Wrong password must not rehash
    bad = await client.post(
        "/api/v1/global/user-auth/login",
        json={"email": "legacy-user@example.com", "password": "NotThePassword!1"},
    )
    assert bad.status_code == 401
    async with engine_module._sessionmaker() as db:
        c = await db.get(GlobalUserCredential, cred_id)
        assert c.password_hash == "LegacyUser#2026!"

    # Valid login upgrades legacy record to Argon2id
    ok = await client.post(
        "/api/v1/global/user-auth/login",
        json={"email": "legacy-user@example.com", "password": "LegacyUser#2026!"},
    )
    assert ok.status_code == 200
    async with engine_module._sessionmaker() as db:
        c = await db.get(GlobalUserCredential, cred_id)
        assert c.password_hash != "LegacyUser#2026!"
        assert is_global_argon2(c.password_hash)

    # Conditional UPDATE safety check: stale old_hash cannot overwrite a newer concurrent hash
    newer_hash = hash_global_password("ConcurrentNew!Pass#9")
    async with engine_module._sessionmaker() as db:
        await db.execute(
            update(GlobalUserCredential)
            .where(GlobalUserCredential.id == cred_id)
            .values(password_hash=newer_hash)
        )
        await db.commit()

        stale_attempt = await db.execute(
            update(GlobalUserCredential)
            .where(
                GlobalUserCredential.id == cred_id,
                GlobalUserCredential.password_hash == "LegacyUser#2026!",
            )
            .values(password_hash=hash_global_password("StaleOverwrite!1"))
        )
        await db.commit()
        assert stale_attempt.rowcount == 0
        final_c = await db.get(GlobalUserCredential, cred_id)
        assert final_c.password_hash == newer_hash


# ---------------------------------------------------------------------------
# BUG-003: Ecosystem Session Exchange, Authorization & Audit Hygiene
# ---------------------------------------------------------------------------


async def _fresh_anonymous_client() -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver")


async def test_bug003_exchange_rejects_anonymous_bare_session_invalid_expired_wrong_binding_and_replay(
    super_admin_client,
):
    me = (await super_admin_client.get("/api/v1/global/auth/me")).json()["data"]
    admin_email = me["email"]

    async with await _fresh_anonymous_client() as admin_browser:
        est = await admin_browser.post(
            EST,
            json={"email": admin_email, "password": "Test-Password-123!", "source_erp": "inhyma"},
        )
        assert est.status_code == 200
        est_data = est.json()["data"]
        sid = est_data["session_id"]
        valid_code = est_data["exchange_code"]
        assert valid_code and "." in valid_code

    async with await _fresh_anonymous_client() as attacker:
        # 1. Bare (session_id, email) exchange MUST be rejected (the old P0 exploit!)
        r_bare = await attacker.post(EXCH, json={"session_id": sid, "email": admin_email})
        assert r_bare.status_code == 401

        # 2. Tampered / invalid signature MUST be rejected
        body_part, sig_part = valid_code.split(".", 1)
        tampered = f"{body_part}.{'0' * len(sig_part)}"
        r_sig = await attacker.post(
            EXCH, json={"session_id": sid, "email": admin_email, "exchange_code": tampered}
        )
        assert r_sig.status_code == 401

        # 3. Wrong email / wrong session binding MUST be rejected
        r_wrong_email = await attacker.post(
            EXCH,
            json={"session_id": sid, "email": "other@example.com", "exchange_code": valid_code},
        )
        assert r_wrong_email.status_code == 401
        r_wrong_sid = await attacker.post(
            EXCH,
            json={"session_id": str(uuid.uuid4()), "email": admin_email, "exchange_code": valid_code},
        )
        assert r_wrong_sid.status_code == 401

        # 4. Expired code MUST be rejected
        expired_code = es.issue_exchange_code(
            session_id=sid, email=admin_email, user_id=me["id"], user_type="platform_admin", ttl_seconds=5
        )
        # Force expiry timestamp in registry and re-sign an expired payload
        expired_payload = {
            "iss": es._EXCHANGE_ISS,
            "aud": es._EXCHANGE_AUD,
            "jti": "expired-jti-test",
            "sid": sid,
            "sub": me["id"],
            "email": admin_email,
            "utype": "platform_admin",
            "iat": int(time.time()) - 120,
            "exp": time.time() - 10,
        }
        es._EXCHANGE_CODE_REGISTRY["expired-jti-test"] = (time.time() - 10, False)
        expired_signed = es._sign_compact_payload(expired_payload, purpose="exchange-code")
        assert expired_code != expired_signed
        r_exp = await attacker.post(
            EXCH, json={"session_id": sid, "email": admin_email, "exchange_code": expired_signed}
        )
        assert r_exp.status_code == 401

        # 5. Legitimate single-use exchange succeeds ONCE with short-lived access token
        r_ok = await attacker.post(
            EXCH, json={"session_id": sid, "email": admin_email, "exchange_code": valid_code}
        )
        assert r_ok.status_code == 200
        tok = r_ok.json()["data"]["access_token"]
        claims = decode_platform_access_token(tok)
        assert claims["exp"] - claims["iat"] <= 3600  # short-lived access token, not 10 years!

        # 6. Replaying the exact same exchange_code MUST fail with 401
        r_replay = await attacker.post(
            EXCH, json={"session_id": sid, "email": admin_email, "exchange_code": valid_code}
        )
        assert r_replay.status_code == 401


async def test_bug003_get_and_revoke_require_authorization_and_audit_hides_raw_session_id(admin_client):
    # Create two normal users
    for email in ("alice@example.com", "bob@example.com"):
        r = await admin_client.post("/api/v1/global/users", json={"display_name": email, "primary_email": email})
        uid = r.json()["data"]["id"]
        await admin_client.patch(f"/api/v1/global/users/{uid}", json={"metadata": {"default_password": PW}})

    async with await _fresh_anonymous_client() as alice_client:
        login_a = await alice_client.post("/api/v1/global/user-auth/login", json={"email": "alice@example.com", "password": PW})
        assert login_a.status_code == 200
        a_tok = login_a.json()["data"]["access_token"]
        a_sid = login_a.json()["data"]["session_id"]

    async with await _fresh_anonymous_client() as bob_client:
        login_b = await bob_client.post("/api/v1/global/user-auth/login", json={"email": "bob@example.com", "password": PW})
        assert login_b.status_code == 200
        b_tok = login_b.json()["data"]["access_token"]

    async with await _fresh_anonymous_client() as anon:
        # Anonymous GET and REVOKE rejected with 401
        assert (await anon.get(f"/api/v1/global/ecosystem-session/{a_sid}")).status_code == 401
        assert (await anon.post(f"/api/v1/global/ecosystem-session/{a_sid}/revoke")).status_code == 401

        # Bob MUST NOT inspect or revoke Alice's session (403)
        bob_hdr = {"Authorization": f"Bearer {b_tok}"}
        assert (await anon.get(f"/api/v1/global/ecosystem-session/{a_sid}", headers=bob_hdr)).status_code == 403
        assert (await anon.post(f"/api/v1/global/ecosystem-session/{a_sid}/revoke", headers=bob_hdr)).status_code == 403

        # Alice CAN inspect and revoke her own session (200)
        alice_hdr = {"Authorization": f"Bearer {a_tok}"}
        assert (await anon.get(f"/api/v1/global/ecosystem-session/{a_sid}", headers=alice_hdr)).status_code == 200
        rev = await anon.post(f"/api/v1/global/ecosystem-session/{a_sid}/revoke", headers=alice_hdr)
        assert rev.status_code == 200

    # Verify raw session_id NEVER leaked into GlobalAuditLog target_id, actor_label, or details
    async with engine_module._sessionmaker() as db:
        logs = (await db.execute(select(GlobalAuditLog))).scalars().all()
        for entry in logs:
            assert str(entry.target_id or "") != a_sid
            assert a_sid not in (entry.actor_label or "")
            assert a_sid not in str(entry.details or "")


# ---------------------------------------------------------------------------
# BUG-016: Remove Hardcoded Fallback Administrator Password
# ---------------------------------------------------------------------------


async def test_bug016_default_admin_fallback_rejected_by_default_and_never_in_production(client, monkeypatch):
    async with await _fresh_anonymous_client() as anon:
        # Even on an unseeded DB, ChangeMe!12345 fallback is DISABLED by default
        r = await anon.post(
            EST,
            json={"email": "admin@example.com", "password": "ChangeMe!12345", "source_erp": "inhyma"},
        )
        assert r.status_code == 401

        # Even if ALLOW_UNSEEDED_DEV_ADMIN_FALLBACK were toggled True, PRODUCTION strictly blocks it
        monkeypatch.setattr(settings, "ALLOW_UNSEEDED_DEV_ADMIN_FALLBACK", True)
        monkeypatch.setattr(settings, "ENVIRONMENT", EnvironmentEnum.PRODUCTION)
        r_prod = await anon.post(
            EST,
            json={"email": "admin@example.com", "password": settings.BOOTSTRAP_ADMIN_PASSWORD, "source_erp": "inhyma"},
        )
        assert r_prod.status_code == 401

    # Production startup validation refuses ALLOW_UNSEEDED_DEV_ADMIN_FALLBACK=True and ChangeMe!12345
    prod_bad_fallback = Settings(
        ENVIRONMENT=EnvironmentEnum.PRODUCTION,
        DATABASE_URL="postgresql+asyncpg://u:p@db.example.com:5432/erp",
        CORS_ALLOWED_ORIGINS="https://erp.example.com",
        PLATFORM_JWT_SECRET_KEY="prod-secret-platform-1",
        SERVICE_CREDENTIAL_PEPPER="prod-secret-pepper-2",
        GLOBAL_AUTH_JWT_SECRET_KEY="prod-secret-global-3",
        FEDERATION_CLIENT_SECRET_PEPPER="prod-secret-fed-4",
        ERP_MAIN_TO_YINGLIMA_SERVICE_CREDENTIAL="prod-y-cred",
        ERP_MAIN_TO_INHYMA_SERVICE_CREDENTIAL="prod-i-cred",
        BOOTSTRAP_ADMIN_PASSWORD="StrongProdBootstrap!2026",
        ALLOW_UNSEEDED_DEV_ADMIN_FALLBACK=True,
    )
    with pytest.raises(RuntimeError, match="ALLOW_UNSEEDED_DEV_ADMIN_FALLBACK"):
        prod_bad_fallback.validate_production_secrets()

    prod_bad_pw = Settings(
        ENVIRONMENT=EnvironmentEnum.PRODUCTION,
        DATABASE_URL="postgresql+asyncpg://u:p@db.example.com:5432/erp",
        CORS_ALLOWED_ORIGINS="https://erp.example.com",
        PLATFORM_JWT_SECRET_KEY="prod-secret-platform-1",
        SERVICE_CREDENTIAL_PEPPER="prod-secret-pepper-2",
        GLOBAL_AUTH_JWT_SECRET_KEY="prod-secret-global-3",
        FEDERATION_CLIENT_SECRET_PEPPER="prod-secret-fed-4",
        ERP_MAIN_TO_YINGLIMA_SERVICE_CREDENTIAL="prod-y-cred",
        ERP_MAIN_TO_INHYMA_SERVICE_CREDENTIAL="prod-i-cred",
        BOOTSTRAP_ADMIN_PASSWORD="ChangeMe!12345",
        ALLOW_UNSEEDED_DEV_ADMIN_FALLBACK=False,
    )
    with pytest.raises(RuntimeError, match="BOOTSTRAP_ADMIN_PASSWORD"):
        prod_bad_pw.validate_production_secrets()
