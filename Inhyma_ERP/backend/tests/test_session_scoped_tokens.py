"""
Every login gets ITS OWN session id (sid), carried by every token of that login.  Signing out revokes that one sid:
this login ends, the same person's other logins, other devices and other people do not.

Fallbacks: if ERP_Main cannot be reached at login, the ERP issues a clearly labelled LOCAL session (mode "local");
a lost "revoked" message is caught by the periodic central check (fail-open when ERP_Main is unreachable).
"""
from __future__ import annotations

import uuid

import pytest

from app.auth import routes as auth_routes
from app.auth.security import TokenType, create_access_token, create_refresh_token, decode_token, hash_password
from app.core.config import settings
from app.federation import erp_main_client
from tests.test_internal_users_foreign_keys import CRED, AUTH, client, db  # noqa: F401  (fixtures + credential helpers)

pytestmark = pytest.mark.asyncio
PW = "Passw0rd!Aa1"


async def _person(db, username="alice"):
    from datetime import datetime, timezone

    from app.users.models import User, UserStatus

    u = User(
        id=uuid.uuid4(), username=username, email=f"{username}@example.com", password_hash=hash_password(PW),
        status=UserStatus.ACTIVE, is_active=True, has_login=True, must_change_password=False,
        failed_login_count=0, created_at=datetime.now(timezone.utc),
    )
    db.add(u); await db.commit()
    return u


async def _login(client, username="alice"):
    r = await client.post("/api/v1/auth/login", json={"identifier": username, "password": PW})
    assert r.status_code == 200, r.text
    return r.json()["data"]


def _h(tok): return {"Authorization": f"Bearer {tok}"}
async def _alive(client, tok): return (await client.get("/api/v1/auth/profile", headers=_h(tok))).status_code == 200


@pytest.fixture(autouse=True)
def _no_real_central(monkeypatch):
    monkeypatch.setattr(auth_routes, "open_central_session", _central_down)
    monkeypatch.setattr(erp_main_client, "_central_configured", lambda: False)


async def _central_down(email): return None


# ------------------------------------------------------------------------------------------ tokens carry a session id
async def test_every_login_gets_its_own_session_id_inside_both_tokens(client, db):
    await _person(db)
    a = await _login(client); b = await _login(client)
    assert a["session_id"] and b["session_id"] and a["session_id"] != b["session_id"]
    for d in (a, b):
        assert decode_token(d["access_token"], expected_type=TokenType.ACCESS)["sid"] == d["session_id"]
        assert decode_token(d["refresh_token"], expected_type=TokenType.REFRESH)["sid"] == d["session_id"]


async def test_login_when_erp_main_is_unreachable_falls_back_to_a_labelled_local_session(client, db):
    await _person(db)
    d = await _login(client)
    assert d["session_mode"] == "local" and d["session_id"].startswith("loc-")
    assert await _alive(client, d["access_token"])


async def test_login_with_erp_main_available_uses_the_central_session_id(client, db, monkeypatch):
    await _person(db)
    central = str(uuid.uuid4())

    async def _ok(email): return {"session_id": central, "email": email}

    monkeypatch.setattr(auth_routes, "open_central_session", _ok)
    d = await _login(client)
    assert d["session_mode"] == "central" and d["session_id"] == central


async def test_a_failure_while_opening_the_central_session_never_blocks_the_login(client, db, monkeypatch):
    await _person(db)

    async def _boom(email): raise RuntimeError("central exploded")

    monkeypatch.setattr(auth_routes, "open_central_session", _boom)
    d = await _login(client)
    assert d["session_mode"] == "local" and await _alive(client, d["access_token"])


async def test_a_wrong_password_never_opens_a_session(client, db, monkeypatch):
    await _person(db); opened = []

    async def _spy(email): opened.append(email); return {"session_id": str(uuid.uuid4())}

    monkeypatch.setattr(auth_routes, "open_central_session", _spy)
    r = await client.post("/api/v1/auth/login", json={"identifier": "alice", "password": "wrong"})
    assert r.status_code == 401 and opened == []


# ------------------------------------------------------------------------------------------ revoking ONE session
async def test_revoking_one_session_ends_only_that_login(client, db):
    await _person(db)
    a = await _login(client); b = await _login(client)
    r = await client.post(f"/api/v1/internal/sessions/{a['session_id']}/revoke", headers=AUTH, json={})
    assert r.status_code == 200
    assert not await _alive(client, a["access_token"]), "the revoked session must stop working"
    assert await _alive(client, b["access_token"]), "another login of the same person must keep working"


async def test_a_revoked_sessions_refresh_token_cannot_bring_it_back(client, db):
    await _person(db)
    a = await _login(client); b = await _login(client)
    await client.post(f"/api/v1/internal/sessions/{a['session_id']}/revoke", headers=AUTH, json={})
    assert (await client.post("/api/v1/auth/refresh", json={"refresh_token": a["refresh_token"]})).status_code == 401
    ok = await client.post("/api/v1/auth/refresh", json={"refresh_token": b["refresh_token"]})
    assert ok.status_code == 200 and ok.json()["data"]["session_id"] == b["session_id"], "refresh keeps the same session id"


async def test_the_revoke_endpoint_requires_the_service_credential(client, db):
    await _person(db); a = await _login(client)
    sid = a["session_id"]
    assert (await client.post(f"/api/v1/internal/sessions/{sid}/revoke", json={})).status_code == 401
    assert (await client.post(f"/api/v1/internal/sessions/{sid}/revoke", json={}, headers={"Authorization": "Bearer nope"})).status_code == 401
    assert await _alive(client, a["access_token"]), "rejected calls must change nothing"


async def test_revoking_twice_or_an_unknown_session_is_harmless(client, db):
    await _person(db); a = await _login(client)
    for sid in (a["session_id"], a["session_id"], str(uuid.uuid4())):
        assert (await client.post(f"/api/v1/internal/sessions/{sid}/revoke", headers=AUTH, json={})).status_code == 200


# ------------------------------------------------------------------------------------------ logout button
async def test_logout_ends_this_login_only_and_reports_it_to_erp_main(client, db, monkeypatch):
    await _person(db)
    central = str(uuid.uuid4()); other = str(uuid.uuid4()); reported = []
    seq = iter([central, other])

    async def _open(email): return {"session_id": next(seq)}

    async def _report(sid): reported.append(sid); return True

    monkeypatch.setattr(auth_routes, "open_central_session", _open)
    monkeypatch.setattr(auth_routes, "push_session_signout_to_erp_main", _report)
    a = await _login(client); b = await _login(client)
    out = await client.post("/api/v1/auth/logout", headers=_h(a["access_token"]), json={"refresh_token": a["refresh_token"]})
    assert out.status_code == 200
    assert reported == [central], "ERP_Main is told about exactly this session"
    assert not await _alive(client, a["access_token"]) and await _alive(client, b["access_token"])


async def test_logout_of_a_local_only_session_still_works_when_erp_main_is_down(client, db, monkeypatch):
    await _person(db)

    async def _down(sid): return False

    monkeypatch.setattr(auth_routes, "push_session_signout_to_erp_main", _down)
    a = await _login(client)
    out = await client.post("/api/v1/auth/logout", headers=_h(a["access_token"]), json={"refresh_token": a["refresh_token"]})
    assert out.status_code == 200 and not await _alive(client, a["access_token"])


# ------------------------------------------------------------------------------------------ safety net + older tokens
async def test_a_signout_whose_push_was_lost_is_caught_by_the_central_check(client, db, monkeypatch):
    await _person(db)
    central = str(uuid.uuid4())

    async def _open(email): return {"session_id": central}

    monkeypatch.setattr(auth_routes, "open_central_session", _open)
    monkeypatch.setattr(erp_main_client, "_central_configured", lambda: True)
    state = {"v": "active"}

    async def _state(sid): return state["v"]

    monkeypatch.setattr(erp_main_client, "central_session_state", _state)
    a = await _login(client)
    assert await _alive(client, a["access_token"])
    state["v"] = "revoked"                              # ERP_Main says: signed out (our push never arrived)
    assert not await _alive(client, a["access_token"])
    state["v"] = "active"                               # and it stays ended even if the answer changes later
    assert not await _alive(client, a["access_token"]), "once detected, the revocation is durable"


async def test_erp_main_being_unreachable_does_not_log_anybody_out(client, db, monkeypatch):
    await _person(db)
    central = str(uuid.uuid4())

    async def _open(email): return {"session_id": central}

    async def _unknown(sid): return "unknown"

    monkeypatch.setattr(auth_routes, "open_central_session", _open)
    monkeypatch.setattr(erp_main_client, "central_session_state", _unknown)
    a = await _login(client)
    assert await _alive(client, a["access_token"])


async def test_a_token_from_before_session_ids_existed_still_works(client, db):
    u = await _person(db)
    legacy = create_access_token(u.id, permissions=[]).token
    assert "sid" not in decode_token(legacy, expected_type=TokenType.ACCESS)
    assert await _alive(client, legacy)


async def test_central_session_state_is_cached_and_fails_open(monkeypatch):
    monkeypatch.setattr(erp_main_client, "_central_configured", lambda: True)
    erp_main_client._SESSION_STATE_CACHE.clear()
    calls = []

    async def _verify(sid):
        calls.append(sid)
        if len(calls) == 1:
            return {"active": True}
        raise erp_main_client.EcosystemSessionError("down")

    monkeypatch.setattr(erp_main_client, "verify_ecosystem_session", _verify)
    sid = str(uuid.uuid4())
    assert await erp_main_client.central_session_state(sid) == "active"
    assert await erp_main_client.central_session_state(sid) == "active" and len(calls) == 1, "answers are cached"
    other = str(uuid.uuid4())
    assert await erp_main_client.central_session_state(other) == "unknown", "unreachable ERP_Main -> fail open"
    assert await erp_main_client.central_session_state("loc-abc") == "unknown"


async def test_open_central_session_and_signout_report_never_raise(monkeypatch):
    monkeypatch.setattr(settings, "ERP_MAIN_SERVICE_CREDENTIAL", "shared-secret-0123456789")
    monkeypatch.setattr(settings, "ERP_MAIN_API_BASE_URL", "http://127.0.0.1:9/api/v1")   # nothing listens here
    assert await erp_main_client.open_central_session("a@example.com") is None
    assert await erp_main_client.push_session_signout_to_erp_main(str(uuid.uuid4())) is False
    assert await erp_main_client.push_session_signout_to_erp_main("loc-xyz") is False
