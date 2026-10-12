"""
Rule: signing out ANYWHERE signs the person out EVERYWHERE they have access.

* Admin: dashboard (every browser/device) + every ERP.
* Normal user: dashboard (every browser/device) + only the ERPs ticked in their ERP Access Grants.
* Signing out is never a block: the person can sign in again.
"""
from __future__ import annotations

import asyncio

import pytest
from sqlalchemy import update

import app.database.engine as engine_module
from app.core.config import settings
from app.global_auth import ecosystem_session as es
from app.global_auth.models import GlobalSession
from app.identity_linking.adapters.registry import get_adapter_registry
from tests.test_identity_linking import InMemoryTestProvisioningAdapter

PW = "Str0ng!Passw0rd"
ADMIN_PW = "Test-Password-123!"
EST = "/api/v1/global/ecosystem-session/establish"


class _Spy:
    calls: list = []

    async def logout_local_user(self, erp, ident, *, reason=None):
        _Spy.calls.append(erp.key)
        return {"logged_out": True}


@pytest.fixture(autouse=True)
def _wiring(monkeypatch):
    es._ECOSYSTEM_SESSION_STORE.clear(); _Spy.calls = []
    reg = get_adapter_registry(); mem = InMemoryTestProvisioningAdapter(); orig = reg.get_adapter
    reg.get_adapter = lambda erp: mem
    monkeypatch.setattr("app.identity_linking.adapters.http_adapter.HttpErpProvisioningAdapter", _Spy)
    yield
    reg.get_adapter = orig


async def _erp(c, key):
    r = await c.post("/api/v1/global/erps", json={"key": key, "name": key, "display_name": key, "status": "ACTIVE", "base_url": f"https://{key}.example.internal"})
    return r.json()["data"]["id"]


async def _user(c, email, erp_ids=()):
    uid = (await c.post("/api/v1/global/users", json={"display_name": "U", "primary_email": email})).json()["data"]["id"]
    await c.patch(f"/api/v1/global/users/{uid}", json={"metadata": {"default_password": PW}})
    for e in erp_ids:
        await c.post(f"/api/v1/global/users/{uid}/provision", json={"erp_instance_id": e})
    return uid


async def _login(client, email):
    return (await client.post("/api/v1/global/user-auth/login", json={"email": email, "password": PW})).json()["data"]


def _h(tok): return {"Authorization": f"Bearer {tok}"}


@pytest.mark.asyncio
async def test_signing_out_one_session_ends_every_dashboard_session_of_that_person(admin_client, client):
    await _user(admin_client, "multi@example.com")
    a = await _login(client, "multi@example.com"); b = await _login(client, "multi@example.com")  # two browsers
    me = lambda d: client.get("/api/v1/global/user-auth/me", headers=_h(d["access_token"]))
    assert (await me(a)).status_code == 200 and (await me(b)).status_code == 200
    r = await client.post(f"/api/v1/global/ecosystem-session/{a['session_id']}/revoke")
    assert r.status_code == 200
    assert (await me(a)).status_code == 401 and (await me(b)).status_code == 401


@pytest.mark.asyncio
async def test_dashboard_logout_button_signs_out_all_devices_and_only_the_granted_erps(admin_client, client):
    y = await _erp(admin_client, "yinglima"); await _erp(admin_client, "inhyma")
    await _user(admin_client, "grant@example.com", [y])              # ticked: Yinglima only
    a = await _login(client, "grant@example.com"); b = await _login(client, "grant@example.com")
    out = await client.post("/api/v1/global/user-auth/logout", headers=_h(a["access_token"]), json={})
    assert out.status_code == 200
    assert (await client.get("/api/v1/global/user-auth/me", headers=_h(b["access_token"]))).status_code == 401
    assert _Spy.calls == ["yinglima"], f"only the ticked ERP is notified, got {_Spy.calls}"


@pytest.mark.asyncio
async def test_a_user_with_no_ticked_erps_triggers_no_erp_calls(admin_client, client):
    await _erp(admin_client, "yinglima"); await _user(admin_client, "none@example.com")
    a = await _login(client, "none@example.com")
    await client.post(f"/api/v1/global/ecosystem-session/{a['session_id']}/revoke")
    assert _Spy.calls == []


@pytest.mark.asyncio
async def test_admin_token_dies_everywhere_and_every_erp_is_notified(super_admin_client, client):
    await _erp(super_admin_client, "yinglima"); await _erp(super_admin_client, "inhyma")
    email = (await super_admin_client.get("/api/v1/global/auth/me")).json()["data"]["email"]
    second = (await client.post("/api/v1/global/auth/login", json={"email": email, "password": ADMIN_PW})).json()["data"]["access_token"]
    sid = (await client.post(EST, json={"email": email, "password": ADMIN_PW, "source_erp": "inhyma"})).json()["data"]["session_id"]
    assert (await super_admin_client.get("/api/v1/global/auth/me")).status_code == 200

    r = await client.post(f"/api/v1/global/ecosystem-session/{sid}/revoke")      # e.g. logged out from an ERP
    assert r.status_code == 200
    assert (await super_admin_client.get("/api/v1/global/auth/me")).status_code == 401, "the dashboard token must stop working"
    assert (await client.get("/api/v1/global/auth/me", headers=_h(second))).status_code == 401, "...on every browser too"
    assert sorted(_Spy.calls) == ["inhyma", "yinglima"], "an admin is signed out of ALL ERPs"
    await asyncio.sleep(1.1)  # tokens carry whole-second issue times; a human re-login is always later than this
    again = await client.post("/api/v1/global/auth/login", json={"email": email, "password": ADMIN_PW})
    assert again.status_code == 200
    assert (await client.get("/api/v1/global/auth/me", headers=_h(again.json()["data"]["access_token"]))).status_code == 200


@pytest.mark.asyncio
async def test_admin_logout_route_signs_the_admin_out_everywhere(super_admin_client, client):
    await _erp(super_admin_client, "yinglima")
    email = (await super_admin_client.get("/api/v1/global/auth/me")).json()["data"]["email"]
    other = (await client.post("/api/v1/global/auth/login", json={"email": email, "password": ADMIN_PW})).json()["data"]["access_token"]
    r = await super_admin_client.post("/api/v1/global/auth/logout")
    assert r.status_code == 200 and r.json()["data"]["admin_tokens_invalidated"] is True
    assert (await client.get("/api/v1/global/auth/me", headers=_h(other))).status_code == 401
    assert _Spy.calls == ["yinglima"]


@pytest.mark.asyncio
async def test_a_revocation_made_by_another_worker_is_honoured_here(admin_client, client, monkeypatch):
    """Multi-worker safety: this worker still has the session cached as active; the DB row was revoked elsewhere."""
    monkeypatch.setattr(settings, "ECOSYSTEM_SESSION_REVALIDATE_TTL_SECONDS", 0.0)
    await _user(admin_client, "worker@example.com")
    sid = (await client.post(EST, json={"email": "worker@example.com", "password": PW, "source_erp": "x"})).json()["data"]["session_id"]
    assert (await client.get(f"/api/v1/global/ecosystem-session/{sid}")).json()["data"]["active"] is True
    import uuid
    from datetime import datetime, timezone
    async with engine_module._sessionmaker() as s:   # what ANOTHER process would have done
        await s.execute(update(GlobalSession).where(GlobalSession.id == uuid.UUID(sid)).values(revoked_at=datetime.now(timezone.utc)))
        await s.commit()
    assert es._ECOSYSTEM_SESSION_STORE[sid].get("revoked_at") is None      # this process never heard about it
    assert (await client.get(f"/api/v1/global/ecosystem-session/{sid}")).json()["data"]["active"] is False


@pytest.mark.asyncio
async def test_an_erp_can_report_a_signout_server_to_server(admin_client, client, monkeypatch):
    monkeypatch.setattr(settings, "ERP_MAIN_TO_INHYMA_SERVICE_CREDENTIAL", "inhyma-shared-secret-123456")
    i = await _erp(admin_client, "inhyma"); await _user(admin_client, "s2s@example.com", [i])
    a = await _login(client, "s2s@example.com")
    body = {"email": "s2s@example.com"}
    assert (await client.post("/api/v1/internal/users/signout", json=body)).status_code == 401
    assert (await client.post("/api/v1/internal/users/signout", json=body, headers={"Authorization": "Bearer nope", "X-ERP-Key": "inhyma"})).status_code == 401
    assert (await client.get("/api/v1/global/user-auth/me", headers=_h(a["access_token"]))).status_code == 200  # rejected calls did nothing
    ok = await client.post("/api/v1/internal/users/signout", json=body, headers={"Authorization": "Bearer inhyma-shared-secret-123456", "X-ERP-Key": "inhyma"})
    assert ok.status_code == 200 and ok.json()["data"]["dashboard_sessions_revoked"] >= 1
    assert (await client.get("/api/v1/global/user-auth/me", headers=_h(a["access_token"]))).status_code == 401
