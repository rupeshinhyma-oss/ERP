"""
Rule: every login has its OWN session id (sid).  Signing out ends THAT session -- in the dashboard and in the ERPs it
used -- and nobody else's: not another login of the same account, not another device, not another admin.

"Sign out everywhere" is a separate, explicit action that ends all sessions of the account.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import update

import app.database.engine as engine_module
from app.core.config import settings
from app.global_auth import ecosystem_session as es
from app.global_auth.models import GlobalSession
from app.identity_linking.adapters.registry import get_adapter_registry
from app.platform_auth.security import create_platform_access_token, decode_platform_access_token
from tests.test_identity_linking import InMemoryTestProvisioningAdapter

PW = "Str0ng!Passw0rd"
ADMIN_PW = "Test-Password-123!"
ADMIN2_PW = "Second!Admin-2026"
CRED = "yinglima-shared-secret-0123456789"


class _Spy:
    revoked: list = []      # (erp key, session id)
    kicked: list = []       # whole-person force logouts (used only by explicit admin actions)

    async def revoke_session(self, erp, session_id, *, reason=None):
        _Spy.revoked.append((erp.key, session_id)); return True

    async def logout_local_user(self, erp, ident, *, reason=None):
        _Spy.kicked.append(erp.key); return {"logged_out": True}


@pytest.fixture(autouse=True)
def _wiring(monkeypatch):
    es._ECOSYSTEM_SESSION_STORE.clear(); _Spy.revoked = []; _Spy.kicked = []
    reg = get_adapter_registry(); mem = InMemoryTestProvisioningAdapter(); orig = reg.get_adapter
    reg.get_adapter = lambda erp: mem
    monkeypatch.setattr("app.identity_linking.adapters.http_adapter.HttpErpProvisioningAdapter", _Spy)
    monkeypatch.setattr(settings, "ERP_MAIN_TO_YINGLIMA_SERVICE_CREDENTIAL", CRED)
    yield
    reg.get_adapter = orig


def _h(tok): return {"Authorization": f"Bearer {tok}"}
async def _erp(c, key):
    return (await c.post("/api/v1/global/erps", json={"key": key, "name": key, "display_name": key, "status": "ACTIVE", "base_url": f"https://{key}.example.internal"})).json()["data"]["id"]


async def _user(c, email, erp_ids=()):
    uid = (await c.post("/api/v1/global/users", json={"display_name": "U", "primary_email": email})).json()["data"]["id"]
    await c.patch(f"/api/v1/global/users/{uid}", json={"metadata": {"default_password": PW}})
    for e in erp_ids:
        await c.post(f"/api/v1/global/users/{uid}/provision", json={"erp_instance_id": e})
    return uid


async def _ulogin(client, email): return (await client.post("/api/v1/global/user-auth/login", json={"email": email, "password": PW})).json()["data"]
async def _alogin(client, email, pw): return (await client.post("/api/v1/global/auth/login", json={"email": email, "password": pw})).json()["data"]
async def _admin_email(c): return (await c.get("/api/v1/global/auth/me")).json()["data"]["email"]
async def _user_alive(client, tok): return (await client.get("/api/v1/global/user-auth/me", headers=_h(tok))).status_code == 200
async def _admin_alive(client, tok): return (await client.get("/api/v1/global/auth/me", headers=_h(tok))).status_code == 200


# ----------------------------------------------------------------------------- normal users
@pytest.mark.asyncio
async def test_two_logins_of_one_user_are_independent_logging_out_of_one_keeps_the_other(admin_client, client):
    y = await _erp(admin_client, "yinglima"); await _erp(admin_client, "inhyma")
    await _user(admin_client, "two@example.com", [y])                      # ticked: Yinglima only
    a = await _ulogin(client, "two@example.com"); b = await _ulogin(client, "two@example.com")
    assert a["session_id"] != b["session_id"]
    assert (await client.post("/api/v1/global/user-auth/logout", headers=_h(a["access_token"]), json={})).status_code == 200
    assert not await _user_alive(client, a["access_token"]), "the session that logged out must end"
    assert await _user_alive(client, b["access_token"]), "the OTHER login of the same person must keep working"
    assert _Spy.revoked == [("yinglima", a["session_id"])], "only this session id, only the ticked ERP"
    assert _Spy.kicked == [], "a normal logout must never force-logout the whole person"


@pytest.mark.asyncio
async def test_central_revoke_by_session_id_ends_only_that_session(admin_client, client):
    await _user(admin_client, "rv@example.com")
    a = await _ulogin(client, "rv@example.com"); b = await _ulogin(client, "rv@example.com")
    assert (await client.post(f"/api/v1/global/ecosystem-session/{a['session_id']}/revoke")).status_code == 200
    assert not await _user_alive(client, a["access_token"]) and await _user_alive(client, b["access_token"])
    assert (await client.get(f"/api/v1/global/ecosystem-session/{b['session_id']}")).json()["data"]["active"] is True


@pytest.mark.asyncio
async def test_a_user_with_no_ticked_erps_triggers_no_erp_calls(admin_client, client):
    await _erp(admin_client, "yinglima"); await _user(admin_client, "none@example.com")
    a = await _ulogin(client, "none@example.com")
    await client.post(f"/api/v1/global/ecosystem-session/{a['session_id']}/revoke")
    assert _Spy.revoked == []


@pytest.mark.asyncio
async def test_signing_out_twice_or_an_unknown_session_is_harmless(admin_client, client):
    await _user(admin_client, "twice@example.com"); a = await _ulogin(client, "twice@example.com")
    for _ in range(2):
        assert (await client.post(f"/api/v1/global/ecosystem-session/{a['session_id']}/revoke")).status_code == 200
    assert (await client.post(f"/api/v1/global/ecosystem-session/{uuid.uuid4()}/revoke")).status_code == 200
    assert (await client.post("/api/v1/global/ecosystem-session/ihm-sess-123/revoke")).status_code == 200


# ----------------------------------------------------------------------------- admins
@pytest.mark.asyncio
async def test_admin_login_returns_a_session_id_and_the_token_carries_it(super_admin_client, client):
    email = await _admin_email(super_admin_client)
    a = await _alogin(client, email, ADMIN_PW); b = await _alogin(client, email, ADMIN_PW)
    assert a["session_id"] and b["session_id"] and a["session_id"] != b["session_id"]
    assert decode_platform_access_token(a["access_token"])["sid"] == a["session_id"]


@pytest.mark.asyncio
async def test_same_admin_logged_in_twice_logging_out_of_one_keeps_the_other(super_admin_client, client):
    await _erp(super_admin_client, "yinglima"); await _erp(super_admin_client, "inhyma")
    email = await _admin_email(super_admin_client)
    a = await _alogin(client, email, ADMIN_PW); b = await _alogin(client, email, ADMIN_PW)
    out = await client.post("/api/v1/global/auth/logout", headers=_h(a["access_token"]))
    assert out.status_code == 200 and out.json()["data"]["mode"] == "session"
    assert not await _admin_alive(client, a["access_token"])
    assert await _admin_alive(client, b["access_token"]), "the other device of the same admin must keep working"
    assert sorted(k for k, _ in _Spy.revoked) == ["inhyma", "yinglima"], "an admin's session is revoked in ALL ERPs"
    assert {s for _, s in _Spy.revoked} == {a["session_id"]}


@pytest.mark.asyncio
async def test_two_different_admins_are_independent(super_admin_client, client):
    e1 = await _admin_email(super_admin_client)
    r = await super_admin_client.post("/api/v1/global/auth/admins", json={"email": "admin2@example.com", "display_name": "Admin Two", "password": ADMIN2_PW, "role": "SUPER_ADMIN"})
    assert r.status_code == 201
    a1 = await _alogin(client, e1, ADMIN_PW); a2 = await _alogin(client, "admin2@example.com", ADMIN2_PW)
    await client.post("/api/v1/global/auth/logout", headers=_h(a1["access_token"]))
    assert not await _admin_alive(client, a1["access_token"]) and await _admin_alive(client, a2["access_token"])


@pytest.mark.asyncio
async def test_an_older_admin_token_without_a_session_id_still_works_and_cannot_be_revoked_individually(super_admin_client, client):
    me = (await super_admin_client.get("/api/v1/global/auth/me")).json()["data"]
    legacy = create_platform_access_token(uuid.UUID(me["id"]), role="SUPER_ADMIN").token
    assert await _admin_alive(client, legacy)
    out = await client.post("/api/v1/global/auth/logout", headers=_h(legacy))
    assert out.status_code == 200 and out.json()["data"]["mode"] == "legacy_token"


@pytest.mark.asyncio
async def test_an_admin_session_revoked_by_another_process_is_honoured(super_admin_client, client):
    email = await _admin_email(super_admin_client)
    a = await _alogin(client, email, ADMIN_PW)
    assert await _admin_alive(client, a["access_token"])
    async with engine_module._sessionmaker() as s:      # what ANOTHER worker would have done
        await s.execute(update(GlobalSession).where(GlobalSession.id == uuid.UUID(a["session_id"])).values(revoked_at=datetime.now(timezone.utc)))
        await s.commit()
    assert not await _admin_alive(client, a["access_token"])


@pytest.mark.asyncio
async def test_an_expired_admin_session_is_refused(super_admin_client, client):
    email = await _admin_email(super_admin_client); a = await _alogin(client, email, ADMIN_PW)
    async with engine_module._sessionmaker() as s:
        await s.execute(update(GlobalSession).where(GlobalSession.id == uuid.UUID(a["session_id"])).values(expires_at=datetime.now(timezone.utc) - timedelta(minutes=1)))
        await s.commit()
    assert not await _admin_alive(client, a["access_token"])


# ----------------------------------------------------------------------------- explicit "sign out everywhere"
@pytest.mark.asyncio
async def test_sign_out_everywhere_ends_all_sessions_of_the_account_only_when_asked(super_admin_client, admin_client, client):
    await _user(admin_client, "all@example.com")            # set up first: signing the admin out everywhere also ends this fixture's session
    u1 = await _ulogin(client, "all@example.com"); u2 = await _ulogin(client, "all@example.com")
    assert (await client.post("/api/v1/global/user-auth/sign-out-everywhere", headers=_h(u1["access_token"]), json={})).status_code == 200
    assert not await _user_alive(client, u1["access_token"]) and not await _user_alive(client, u2["access_token"])

    email = await _admin_email(super_admin_client)
    a = await _alogin(client, email, ADMIN_PW); b = await _alogin(client, email, ADMIN_PW)
    out = await client.post("/api/v1/global/auth/sign-out-everywhere", headers=_h(a["access_token"]))
    assert out.status_code == 200
    assert not await _admin_alive(client, a["access_token"]) and not await _admin_alive(client, b["access_token"])


# ----------------------------------------------------------------------------- multi-worker safety
@pytest.mark.asyncio
async def test_a_revocation_made_by_another_worker_is_honoured_here(admin_client, client, monkeypatch):
    monkeypatch.setattr(settings, "ECOSYSTEM_SESSION_REVALIDATE_TTL_SECONDS", 0.0)
    await _user(admin_client, "worker@example.com")
    sid = (await client.post("/api/v1/global/ecosystem-session/establish", json={"email": "worker@example.com", "password": PW, "source_erp": "x"})).json()["data"]["session_id"]
    assert (await client.get(f"/api/v1/global/ecosystem-session/{sid}")).json()["data"]["active"] is True
    async with engine_module._sessionmaker() as s:
        await s.execute(update(GlobalSession).where(GlobalSession.id == uuid.UUID(sid)).values(revoked_at=datetime.now(timezone.utc)))
        await s.commit()
    assert es._ECOSYSTEM_SESSION_STORE[sid].get("revoked_at") is None
    assert (await client.get(f"/api/v1/global/ecosystem-session/{sid}")).json()["data"]["active"] is False


# ----------------------------------------------------------------------------- server-to-server (ERPs)
AUTHN = {"Authorization": f"Bearer {CRED}", "X-ERP-Key": "yinglima"}


@pytest.mark.asyncio
async def test_an_erp_can_open_a_central_session_for_a_person_it_authenticated(admin_client, client):
    y = await _erp(admin_client, "yinglima"); i = await _erp(admin_client, "inhyma")
    await _user(admin_client, "granted@example.com", [y]); await _user(admin_client, "notgranted@example.com", [i])
    assert (await client.post("/api/v1/internal/sessions/open", json={"email": "granted@example.com"})).status_code == 401
    assert (await client.post("/api/v1/internal/sessions/open", json={"email": "granted@example.com"}, headers={"Authorization": "Bearer nope", "X-ERP-Key": "yinglima"})).status_code == 401
    ok = await client.post("/api/v1/internal/sessions/open", json={"email": "granted@example.com"}, headers=AUTHN)
    assert ok.status_code == 200
    d = ok.json()["data"]; assert d["active"] and "yinglima" in d["allowed_erps"]
    assert (await client.get(f"/api/v1/global/ecosystem-session/{d['session_id']}")).json()["data"]["active"] is True
    second = await client.post("/api/v1/internal/sessions/open", json={"email": "granted@example.com"}, headers=AUTHN)
    assert second.json()["data"]["session_id"] != d["session_id"], "every login gets its own session id"
    refused = await client.post("/api/v1/internal/sessions/open", json={"email": "notgranted@example.com"}, headers=AUTHN)
    assert refused.status_code == 403, "no access grant for the calling ERP -> the ERP falls back to a local session"
    assert (await client.post("/api/v1/internal/sessions/open", json={"email": "ghost@example.com"}, headers=AUTHN)).status_code == 404


@pytest.mark.asyncio
async def test_an_erp_reports_a_signout_for_exactly_one_session(admin_client, client):
    y = await _erp(admin_client, "yinglima"); await _user(admin_client, "s2s@example.com", [y])
    s1 = (await client.post("/api/v1/internal/sessions/open", json={"email": "s2s@example.com"}, headers=AUTHN)).json()["data"]["session_id"]
    s2 = (await client.post("/api/v1/internal/sessions/open", json={"email": "s2s@example.com"}, headers=AUTHN)).json()["data"]["session_id"]
    assert (await client.post(f"/api/v1/internal/sessions/{s1}/signout")).status_code == 401
    assert (await client.post(f"/api/v1/internal/sessions/{s1}/signout", headers=AUTHN)).status_code == 200
    assert (await client.get(f"/api/v1/global/ecosystem-session/{s1}")).json()["data"]["active"] is False
    assert (await client.get(f"/api/v1/global/ecosystem-session/{s2}")).json()["data"]["active"] is True
    assert {s for _, s in _Spy.revoked} == {s1}


# ----------------------------------------------------------------------------- arriving at the dashboard from an ERP
@pytest.mark.asyncio
async def test_the_dashboard_token_minted_when_arriving_from_an_erp_is_bound_to_that_session(super_admin_client, client):
    email = await _admin_email(super_admin_client)
    sid = (await client.post("/api/v1/global/ecosystem-session/establish", json={"email": email, "password": ADMIN_PW, "source_erp": "inhyma"})).json()["data"]["session_id"]
    other = await _alogin(client, email, ADMIN_PW)                       # the same admin's OTHER login
    ex = await client.post("/api/v1/global/ecosystem-session/exchange", json={"session_id": sid, "email": email})
    assert ex.status_code == 200 and ex.json()["data"]["principal_type"] == "platform_admin"
    tok = ex.json()["data"]["access_token"]
    assert decode_platform_access_token(tok)["sid"] == sid
    assert await _admin_alive(client, tok)
    await client.post(f"/api/v1/global/ecosystem-session/{sid}/revoke")
    assert not await _admin_alive(client, tok), "signing out of that session ends the dashboard token it minted"
    assert await _admin_alive(client, other["access_token"]), "the same admin's other login is untouched"
    assert (await client.post("/api/v1/global/ecosystem-session/exchange", json={"session_id": sid, "email": email})).status_code == 401
