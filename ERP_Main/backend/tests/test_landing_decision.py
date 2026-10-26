"""Where a person belongs is decided once, on the server: none -> dashboard, one -> that ERP, several -> switch, admin -> all."""

import pytest

from app.global_auth.landing import RegistryErp, compute_landing, invalidate_landing_registry_cache

pytestmark = pytest.mark.asyncio

CP = "https://erp.example.com/dashboard"
REG = [
    RegistryErp("yinglima", "Yinglima ERP", "https://yl.example.com/dashboard"),
    RegistryErp("inhyma", "Inhyma ERP", "https://inh.example.com/dashboard"),
    RegistryErp("erp_03", "Future ERP", "https://f3.example.com/dashboard"),
]


def landing(allowed, user_type="global_user", erps=REG):
    return compute_landing(allowed_erps=allowed, user_type=user_type, erps=erps, control_plane=CP)


# ---------------------------------------------------------------------------------------------- the pure decision
def test_no_access_goes_to_the_dashboard():
    for allowed in ([], ["control-plane"], None):
        out = landing(allowed)
        assert out["mode"] == "dashboard" and out["target"]["url"] == CP and out["erps"] == []


def test_exactly_one_erp_goes_to_that_erp_only():
    out = landing(["inhyma", "control-plane"])
    assert out["mode"] == "single" and out["target"] == {"key": "inhyma", "name": "Inhyma ERP", "url": "https://inh.example.com/dashboard"}
    assert [e["key"] for e in out["erps"]] == ["inhyma"]


def test_a_future_erp_works_without_any_code_change():
    out = landing(["erp_03"])
    assert out["mode"] == "single" and out["target"]["key"] == "erp_03" and out["target"]["url"] == "https://f3.example.com/dashboard"


def test_two_or_more_erps_may_switch_between_exactly_those():
    out = landing(["yinglima", "inhyma", "control-plane"])
    assert out["mode"] == "multi" and out["target"] is None
    assert [e["key"] for e in out["erps"]] == ["inhyma", "yinglima"]
    out3 = landing(["inhyma", "erp_03"])
    assert [e["key"] for e in out3["erps"]] == ["erp_03", "inhyma"]


def test_platform_admins_get_every_erp():
    for allowed, kind in ((["*"], "platform_admin"), ([], "platform_admin")):
        out = landing(allowed, user_type=kind)
        assert out["mode"] == "admin" and out["target"] is None and len(out["erps"]) == 3


def test_an_erp_that_is_not_active_in_the_registry_does_not_count():
    only_inhyma = [e for e in REG if e.key == "inhyma"]                   # yinglima suspended / decommissioned
    out = landing(["yinglima", "inhyma"], erps=only_inhyma)
    assert out["mode"] == "single" and out["target"]["key"] == "inhyma"
    assert landing(["yinglima"], erps=only_inhyma)["mode"] == "dashboard"  # access to a suspended ERP = no usable ERP


def test_spelling_case_and_duplicates_do_not_confuse_it():
    assert landing(["INHYMA", "inhyma", " Inhyma "])["mode"] == "single"


def test_an_erp_without_an_address_is_still_decided_with_no_url():
    out = landing(["inhyma"], erps=[RegistryErp("inhyma", "Inhyma ERP", None)])
    assert out["mode"] == "single" and out["target"]["url"] is None        # the apps fall back to their own configuration


# ---------------------------------------------------------------------------------------------- through the real API
async def _setup(client, admin_client, monkeypatch, grants):
    from app.core.config import settings

    monkeypatch.setattr(settings, "FRONTEND_URL", "https://erp.example.com")
    invalidate_landing_registry_cache()
    erps = {}
    for key, url in (("yinglima", "https://yl.example.com/dashboard"), ("inhyma", "https://inh.example.com/dashboard")):
        r = await admin_client.post("/api/v1/global/erps", json={"key": key, "name": key, "display_name": key.title() + " ERP", "status": "ACTIVE", "base_url": url})
        erps[key] = r.json()["data"]["id"]
    u = await admin_client.post("/api/v1/global/users", json={"display_name": "User B", "primary_email": "userb@gmail.com", "external_identity_id": None})
    uid = u.json()["data"]["id"]
    await admin_client.patch(f"/api/v1/global/users/{uid}", json={"metadata": {"default_password": "Str0ng!Passw0rd", "role": ""}})
    for key in grants:
        m = await admin_client.post(f"/api/v1/global/users/{uid}/memberships/{erps[key]}", json={"local_user_id": f"loc-{key}"})
        await admin_client.post(f"/api/v1/global/memberships/{m.json()['data']['id']}/verify")
    return uid, erps


async def _login(client):
    r = await client.post("/api/v1/global/ecosystem-session/establish", json={"email": "userb@gmail.com", "password": "Str0ng!Passw0rd"})
    return r.json()["data"]


async def test_the_decision_travels_with_the_session_for_zero_one_and_two_erps(client, admin_client, monkeypatch):
    uid, erps = await _setup(client, admin_client, monkeypatch, grants=[])
    s0 = await _login(client)
    assert s0["landing"]["mode"] == "dashboard" and s0["landing"]["target"]["url"] == "https://erp.example.com/dashboard"

    m = await admin_client.post(f"/api/v1/global/users/{uid}/memberships/{erps['inhyma']}", json={"local_user_id": "loc-inhyma"})
    await admin_client.post(f"/api/v1/global/memberships/{m.json()['data']['id']}/verify")
    # the session opened BEFORE the grant is corrected at once -- no re-login needed
    seen = (await client.get(f"/api/v1/global/ecosystem-session/{s0['session_id']}")).json()["data"]
    assert seen["landing"]["mode"] == "single" and seen["landing"]["target"] == {"key": "inhyma", "name": "Inhyma ERP", "url": "https://inh.example.com/dashboard"}

    m2 = await admin_client.post(f"/api/v1/global/users/{uid}/memberships/{erps['yinglima']}", json={"local_user_id": "loc-yinglima"})
    await admin_client.post(f"/api/v1/global/memberships/{m2.json()['data']['id']}/verify")
    s2 = (await client.get(f"/api/v1/global/ecosystem-session/{s0['session_id']}")).json()["data"]
    assert s2["landing"]["mode"] == "multi" and [e["key"] for e in s2["landing"]["erps"]] == ["inhyma", "yinglima"]


async def test_revoking_the_only_erp_sends_the_person_back_to_the_dashboard(client, admin_client, monkeypatch):
    uid, erps = await _setup(client, admin_client, monkeypatch, grants=["inhyma"])
    s = await _login(client)
    assert s["landing"]["mode"] == "single"
    mem = (await admin_client.get(f"/api/v1/global/users/{uid}/memberships")).json()["data"][0]
    rv = await admin_client.post(f"/api/v1/global/memberships/{mem['id']}/revoke", json={"reason": "no longer needed"})
    assert rv.status_code == 200
    after = (await client.get(f"/api/v1/global/ecosystem-session/{s['session_id']}")).json()["data"]
    assert after["landing"]["mode"] == "dashboard"


async def test_a_suspended_erp_stops_counting_immediately(client, admin_client, monkeypatch):
    uid, erps = await _setup(client, admin_client, monkeypatch, grants=["inhyma", "yinglima"])
    s = await _login(client)
    assert s["landing"]["mode"] == "multi"
    await admin_client.patch(f"/api/v1/global/erps/{erps['yinglima']}/status", json={"status": "SUSPENDED"})
    after = (await client.get(f"/api/v1/global/ecosystem-session/{s['session_id']}")).json()["data"]
    assert after["landing"]["mode"] == "single" and after["landing"]["target"]["key"] == "inhyma"
