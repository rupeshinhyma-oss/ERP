"""A Global User signs in with no ERP access, an admin then grants Inhyma: what ERP_Main tells the spokes must reflect it at once."""
import json
import pytest

pytestmark = pytest.mark.asyncio


async def test_granting_inhyma_access_is_seen_by_spokes_immediately_even_for_an_old_session(client, admin_client):
    out = {}
    erps = {}
    for key in ("yinglima", "inhyma"):
        r = await admin_client.post("/api/v1/global/erps", json={"key": key, "name": key, "display_name": key.title() + " ERP", "status": "ACTIVE"})
        erps[key] = r.json()["data"]["id"]
    # create global user B (admin creates) with a password
    r = await admin_client.post("/api/v1/global/users", json={"display_name": "User B", "primary_email": "userb@gmail.com", "external_identity_id": None})
    uid = r.json()["data"]["id"]
    r = await admin_client.patch(f"/api/v1/global/users/{uid}", json={"metadata": {"default_password": "Str0ng!Passw0rd", "role": ""}})
    out["create_user"] = (r.status_code,)
    # 1) B logs in BEFORE any access is granted (zero-grant), exactly like the first login
    r = await client.post("/api/v1/global/ecosystem-session/establish", json={"email": "userb@gmail.com", "password": "Str0ng!Passw0rd"})
    out["establish_zero_grant"] = (r.status_code, r.json().get("data", {}).get("allowed_erps") if r.status_code == 200 else r.text[:200])
    sid_old = (r.json().get("data") or {}).get("session_id")
    # 2) admin grants Inhyma access (link + verify -> ACTIVE)
    m = await admin_client.post(f"/api/v1/global/users/{uid}/memberships/{erps['inhyma']}", json={"local_user_id": "loc-b-1"})
    out["membership_create"] = (m.status_code, m.json()["data"]["status"])
    v = await admin_client.post(f"/api/v1/global/memberships/{m.json()['data']['id']}/verify")
    out["membership_verify"] = (v.status_code, v.json()["data"]["status"])
    # 3) what do spokes see for the OLD session and for a NEW login?
    r = await client.get(f"/api/v1/global/ecosystem-session/{sid_old}")
    out["verify_old_session_after_grant"] = r.json().get("data", {}).get("allowed_erps")
    r = await client.post("/api/v1/global/ecosystem-session/establish", json={"email": "userb@gmail.com", "password": "Str0ng!Passw0rd"})
    sid_new = r.json()["data"]["session_id"]
    out["establish_after_grant"] = r.json()["data"]["allowed_erps"]
    r = await client.get(f"/api/v1/global/ecosystem-session/{sid_new}")
    out["verify_new_session"] = {k: r.json()["data"].get(k) for k in ("active", "email", "role", "user_type", "allowed_erps")}
    # 4) memberships as the ERP_Main UI sees them
    r = await admin_client.get(f"/api/v1/global/users/{uid}/memberships")
    out["memberships_api"] = [{k: x.get(k) for k in ("erp_key", "erp_name", "erp_display_name", "status", "local_user_id")} for x in r.json()["data"]]
    assert out["establish_zero_grant"][1] == ["control-plane"]
    assert out["membership_verify"] == (200, "ACTIVE") or list(out["membership_verify"]) == [200, "ACTIVE"]
    assert out["verify_old_session_after_grant"] == ["inhyma", "control-plane"]   # no re-login needed
    assert out["establish_after_grant"] == ["inhyma", "control-plane"]
    assert out["verify_new_session"]["active"] is True and out["verify_new_session"]["allowed_erps"] == ["inhyma", "control-plane"]
    assert out["memberships_api"][0]["erp_key"] == "inhyma" and out["memberships_api"][0]["status"] == "ACTIVE"
