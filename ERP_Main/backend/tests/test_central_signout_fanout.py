"""
Signing out centrally must end the person's sessions in every ERP they hold an ACTIVE membership in.

The fan-out once referenced a column that does not exist (ErpInstance.is_active); the error was swallowed
and logged as a warning, so central sign-out silently never reached any ERP.  This test makes that failure loud.
"""
from __future__ import annotations

import pytest

from app.global_auth import ecosystem_session as es
from app.identity_linking.adapters.registry import get_adapter_registry
from tests.test_identity_linking import InMemoryTestProvisioningAdapter

PW = "Str0ng!Passw0rd"
EST = "/api/v1/global/ecosystem-session/establish"


class _SpyAdapter:
    calls: list = []

    async def logout_local_user(self, erp, ident, *, reason=None):
        _SpyAdapter.calls.append((erp.key, ident, reason))
        return {"logged_out": True}


@pytest.fixture(autouse=True)
def _wiring(monkeypatch):
    es._ECOSYSTEM_SESSION_STORE.clear()
    _SpyAdapter.calls = []
    reg = get_adapter_registry(); mem = InMemoryTestProvisioningAdapter(); orig = reg.get_adapter
    reg.get_adapter = lambda erp: mem
    monkeypatch.setattr("app.identity_linking.adapters.http_adapter.HttpErpProvisioningAdapter", _SpyAdapter)
    yield
    reg.get_adapter = orig


async def _erp(c, key):
    r = await c.post("/api/v1/global/erps", json={"key": key, "name": key, "display_name": key, "status": "ACTIVE", "base_url": f"https://{key}.example.internal"})
    return r.json()["data"]["id"]


@pytest.mark.asyncio
async def test_signing_out_centrally_notifies_every_erp_with_an_active_membership(admin_client, client):
    y = await _erp(admin_client, "yinglima"); i = await _erp(admin_client, "inhyma"); await _erp(admin_client, "other")
    uid = (await admin_client.post("/api/v1/global/users", json={"display_name": "U", "primary_email": "so@example.com"})).json()["data"]["id"]
    await admin_client.patch(f"/api/v1/global/users/{uid}", json={"metadata": {"default_password": PW}})
    for e in (y, i):
        await admin_client.post(f"/api/v1/global/users/{uid}/provision", json={"erp_instance_id": e})
    sid = (await client.post(EST, json={"email": "so@example.com", "password": PW, "source_erp": "x"})).json()["data"]["session_id"]

    r = await client.post(f"/api/v1/global/ecosystem-session/{sid}/revoke")
    assert r.status_code == 200
    notified = sorted(k for k, _, _ in _SpyAdapter.calls)
    assert notified == ["inhyma", "yinglima"], f"expected both ERPs notified, got {notified}"  # not 'other': no membership
    after = (await client.get(f"/api/v1/global/ecosystem-session/{sid}")).json()["data"]
    assert after.get("active") is False


@pytest.mark.asyncio
async def test_a_suspended_membership_is_not_notified(admin_client, client):
    y = await _erp(admin_client, "yinglima")
    uid = (await admin_client.post("/api/v1/global/users", json={"display_name": "U", "primary_email": "so2@example.com"})).json()["data"]["id"]
    await admin_client.patch(f"/api/v1/global/users/{uid}", json={"metadata": {"default_password": PW}})
    mem = (await admin_client.post(f"/api/v1/global/users/{uid}/provision", json={"erp_instance_id": y})).json()["data"]["id"]
    sid = (await client.post(EST, json={"email": "so2@example.com", "password": PW, "source_erp": "x"})).json()["data"]["session_id"]
    await admin_client.post(f"/api/v1/global/memberships/{mem}/suspend", json={"reason": "t"})
    _SpyAdapter.calls.clear()
    await client.post(f"/api/v1/global/ecosystem-session/{sid}/revoke")
    assert _SpyAdapter.calls == []
