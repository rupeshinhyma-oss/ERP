"""
Authentication and revalidation guarantees for ERP_Main's ecosystem session API.

The ecosystem session is what lets the other ERPs trust "this person is signed
in centrally and may use ERP X".  So it must (a) never be created without proof
of identity, (b) never be hijackable, and (c) reflect a suspension/disable done
in ERP_Main immediately -- not whenever the in-memory cache happens to expire.
"""

from __future__ import annotations

import pytest

from app.global_auth import ecosystem_session as es

EST = "/api/v1/global/ecosystem-session/establish"
GET = "/api/v1/global/ecosystem-session"
PW = "Str0ng!Passw0rd"


async def _register(client, email: str) -> str:
    r = await client.post(
        "/api/v1/global/user-auth/register",
        json={"display_name": "T", "email": email, "password": PW},
    )
    assert r.status_code == 201, r.text
    return r.json()["data"]["id"]


@pytest.fixture(autouse=True)
def _clean_store():
    es._ECOSYSTEM_SESSION_STORE.clear()
    yield
    es._ECOSYSTEM_SESSION_STORE.clear()


# --- (a) no session without proof of identity --------------------------------

@pytest.mark.asyncio
async def test_platform_admin_session_requires_password(super_admin_client, client):
    me = await super_admin_client.get("/api/v1/global/auth/me")
    email = me.json()["data"]["email"]
    r = await client.post(EST, json={"email": email, "source_erp": "inhyma"})
    assert r.status_code == 401, "passwordless request must not mint a super-admin session"


@pytest.mark.asyncio
async def test_global_user_session_requires_password(client):
    await _register(client, "nopass@example.com")
    r = await client.post(EST, json={"email": "nopass@example.com", "source_erp": "inhyma"})
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_empty_password_does_not_trigger_default_admin_fallback(client):
    r = await client.post(EST, json={"email": "admin@example.com", "password": "", "source_erp": "inhyma"})
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_global_user_with_password_gets_session(client):
    await _register(client, "ok@example.com")
    r = await client.post(EST, json={"email": "ok@example.com", "password": PW, "source_erp": "control-plane"})
    assert r.status_code == 200
    data = r.json()["data"]
    assert data["active"] is True and data["user_type"] == "global_user"
    assert data["allowed_erps"] == ["control-plane"]  # no memberships => no ERP access


# --- recovery after a restart is allowed only from a real stored session -----

@pytest.mark.asyncio
async def test_recovery_after_restart_needs_a_stored_session(client):
    await _register(client, "rec@example.com")
    login = await client.post("/api/v1/global/user-auth/login", json={"email": "rec@example.com", "password": PW})
    sid = login.json()["data"]["session_id"]

    es._ECOSYSTEM_SESSION_STORE.clear()  # simulate the Render instance restarting
    ok = await client.post(EST, json={"email": "rec@example.com", "existing_session_id": sid, "source_erp": "inhyma"})
    assert ok.status_code == 200 and ok.json()["data"]["session_id"] == sid

    es._ECOSYSTEM_SESSION_STORE.clear()
    bogus = await client.post(
        EST,
        json={"email": "rec@example.com", "existing_session_id": "11111111-1111-4111-8111-111111111111", "source_erp": "x"},
    )
    assert bogus.status_code == 401


@pytest.mark.asyncio
async def test_recovery_rejects_a_session_belonging_to_someone_else(client):
    await _register(client, "a@example.com")
    await _register(client, "b@example.com")
    login_a = await client.post("/api/v1/global/user-auth/login", json={"email": "a@example.com", "password": PW})
    sid_a = login_a.json()["data"]["session_id"]
    es._ECOSYSTEM_SESSION_STORE.clear()
    r = await client.post(EST, json={"email": "b@example.com", "existing_session_id": sid_a, "source_erp": "x"})
    assert r.status_code == 401


# --- (b) no hijacking ---------------------------------------------------------

@pytest.mark.asyncio
async def test_cannot_overwrite_another_users_session_id(client):
    await _register(client, "victim@example.com")
    await _register(client, "mallory@example.com")
    v = await client.post(EST, json={"email": "victim@example.com", "password": PW, "source_erp": "x"})
    victim_sid = v.json()["data"]["session_id"]

    m = await client.post(
        EST, json={"email": "mallory@example.com", "password": PW, "source_erp": "x", "existing_session_id": victim_sid}
    )
    assert m.status_code == 200
    assert m.json()["data"]["session_id"] != victim_sid
    still = await client.get(f"{GET}/{victim_sid}")
    assert still.json()["data"]["email"] == "victim@example.com"


# --- (c) central changes take effect immediately ------------------------------

@pytest.mark.asyncio
async def test_suspending_a_user_deactivates_their_session_immediately(client, admin_client):
    uid = await _register(client, "susp@example.com")
    est = await client.post(EST, json={"email": "susp@example.com", "password": PW, "source_erp": "x"})
    sid = est.json()["data"]["session_id"]
    assert (await client.get(f"{GET}/{sid}")).json()["data"]["active"] is True

    r = await admin_client.patch(f"/api/v1/global/users/{uid}/status", json={"status": "SUSPENDED"})
    assert r.status_code == 200, r.text
    after = (await client.get(f"{GET}/{sid}")).json()["data"]
    assert after["active"] is False


@pytest.mark.asyncio
async def test_unknown_user_session_is_never_treated_as_admin(client):
    """A stored session whose user vanished must be inactive, not fall back to super admin."""
    await _register(client, "ghost@example.com")
    est = await client.post(EST, json={"email": "ghost@example.com", "password": PW, "source_erp": "x"})
    sid = est.json()["data"]["session_id"]
    es._ECOSYSTEM_SESSION_STORE[sid]["email"] = "vanished@example.com"  # cache says someone who no longer exists
    got = (await client.get(f"{GET}/{sid}")).json()["data"]
    assert got["active"] is False
    assert "*" not in (got.get("allowed_erps") or [])


# --- requirement 1: users are created only by ERP_Main administrators ---------

@pytest.mark.asyncio
async def test_public_self_registration_is_disabled_by_default(client, monkeypatch):
    from app.core.config import settings

    monkeypatch.setattr(settings, "GLOBAL_SELF_REGISTRATION_ENABLED", False)
    r = await client.post(
        "/api/v1/global/user-auth/register",
        json={"display_name": "X", "email": "squat@example.com", "password": PW},
    )
    assert r.status_code == 403
