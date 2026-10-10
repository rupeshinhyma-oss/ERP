"""
Rules from the product owner:
  * Arriving at ERP_Main from another ERP signs in THAT person -- never a hard-coded admin.
  * One password per person across ERP_Main and every ERP they may use (changed on either side).
  * The user list and membership lookups stay cheap with thousands of users.
"""
from __future__ import annotations

import pytest
from sqlalchemy import select

import app.database.engine as engine_module
from app.core.config import settings
from app.global_auth import ecosystem_session as es
from app.global_users.models import GlobalUser
from app.identity_linking.adapters.registry import get_adapter_registry
from tests.test_identity_linking import InMemoryTestProvisioningAdapter

EST = "/api/v1/global/ecosystem-session/establish"
EXCH = "/api/v1/global/ecosystem-session/exchange"
PW = "Str0ng!Passw0rd"


@pytest.fixture(autouse=True)
def adapter():
    es._ECOSYSTEM_SESSION_STORE.clear()
    reg = get_adapter_registry(); a = InMemoryTestProvisioningAdapter(); orig = reg.get_adapter
    reg.get_adapter = lambda erp: a
    yield a
    reg.get_adapter = orig


async def _erp(c, key):
    r = await c.post("/api/v1/global/erps", json={"key": key, "name": key, "display_name": key, "status": "ACTIVE", "base_url": f"https://{key}.example.internal"})
    return r.json()["data"]["id"]


async def _user(c, email, pw=PW):
    r = await c.post("/api/v1/global/users", json={"display_name": "U", "primary_email": email})
    uid = r.json()["data"]["id"]
    await c.patch(f"/api/v1/global/users/{uid}", json={"metadata": {"default_password": pw}})
    return uid


async def _session(client, email, pw=PW):
    r = await client.post(EST, json={"email": email, "password": pw, "source_erp": "inhyma"})
    assert r.status_code == 200, r.text
    return r.json()["data"]["session_id"]


# ------------------------------------------------------------------ handover into ERP_Main
@pytest.mark.asyncio
async def test_normal_user_arriving_from_an_erp_gets_their_own_token_not_admin(admin_client, client):
    y = await _erp(admin_client, "yinglima"); i = await _erp(admin_client, "inhyma")
    uid = await _user(admin_client, "userb@example.com")
    for e in (y, i):
        await admin_client.post(f"/api/v1/global/users/{uid}/provision", json={"erp_instance_id": e})
    sid = await _session(client, "userb@example.com")

    r = await client.post(EXCH, json={"session_id": sid, "email": "userb@example.com"})
    assert r.status_code == 200, r.text
    data = r.json()["data"]
    assert data["principal_type"] == "global_user"  # a normal user, NOT platform_admin
    me = await client.get("/api/v1/global/user-auth/me", headers={"Authorization": f"Bearer {data['access_token']}"})
    assert me.status_code == 200 and me.json()["data"]["primary_email"] == "userb@example.com"
    admin_me = await client.get("/api/v1/global/auth/me", headers={"Authorization": f"Bearer {data['access_token']}"})
    assert admin_me.status_code in (401, 403), "a normal user's token must not work as an admin token"


@pytest.mark.asyncio
async def test_exchange_rejects_wrong_email_unknown_session_and_suspended_user(admin_client, client):
    uid = await _user(admin_client, "ex@example.com")
    sid = await _session(client, "ex@example.com")
    assert (await client.post(EXCH, json={"session_id": sid, "email": "someone.else@example.com"})).status_code == 401
    assert (await client.post(EXCH, json={"session_id": "11111111-1111-4111-8111-111111111111", "email": "ex@example.com"})).status_code == 401
    await admin_client.patch(f"/api/v1/global/users/{uid}/status", json={"status": "SUSPENDED"})
    assert (await client.post(EXCH, json={"session_id": sid, "email": "ex@example.com"})).status_code == 401


@pytest.mark.asyncio
async def test_platform_admin_session_exchanges_for_an_admin_token(super_admin_client, client):
    me = await super_admin_client.get("/api/v1/global/auth/me")
    email = me.json()["data"]["email"]
    r = await client.post(EST, json={"email": email, "password": "Test-Password-123!", "source_erp": "inhyma"})
    assert r.status_code == 200, r.text
    assert r.json()["data"]["allowed_erps"] == ["*"]
    sid = r.json()["data"]["session_id"]
    x = await client.post(EXCH, json={"session_id": sid, "email": email})
    assert x.status_code == 200 and x.json()["data"]["principal_type"] == "platform_admin"
    tok = x.json()["data"]["access_token"]
    assert (await client.get("/api/v1/global/auth/me", headers={"Authorization": f"Bearer {tok}"})).status_code == 200


# ------------------------------------------------------------------ one password everywhere
@pytest.mark.asyncio
async def test_password_changed_in_erp_main_is_pushed_to_the_users_erps(admin_client, adapter):
    y = await _erp(admin_client, "yinglima")
    uid = await _user(admin_client, "pw1@example.com")
    await admin_client.post(f"/api/v1/global/users/{uid}/provision", json={"erp_instance_id": y})
    seen = []
    orig = adapter.provision_local_user
    async def spy(erp, **kw):
        seen.append(kw.get("password")); return await orig(erp, **kw)
    adapter.provision_local_user = spy
    r = await admin_client.patch(f"/api/v1/global/users/{uid}", json={"metadata": {"default_password": "NewPass#2026"}})
    assert r.status_code == 200
    assert "NewPass#2026" in seen, "the ERP must receive the new password"


@pytest.mark.asyncio
async def test_password_changed_in_an_erp_is_stored_centrally_and_pushed_to_the_other_erp(admin_client, client, adapter, monkeypatch):
    monkeypatch.setattr(settings, "ERP_MAIN_TO_YINGLIMA_SERVICE_CREDENTIAL", "yinglima-shared-secret-123456")
    y = await _erp(admin_client, "yinglima"); i = await _erp(admin_client, "inhyma")
    uid = await _user(admin_client, "pw2@example.com")
    for e in (y, i):
        await admin_client.post(f"/api/v1/global/users/{uid}/provision", json={"erp_instance_id": e})
    seen = {}
    orig = adapter.provision_local_user
    async def spy(erp, **kw):
        seen[erp.key] = kw.get("password"); return await orig(erp, **kw)
    adapter.provision_local_user = spy

    hdr = {"Authorization": "Bearer yinglima-shared-secret-123456", "X-ERP-Key": "yinglima"}
    r = await client.post("/api/v1/internal/users/password", json={"email": "pw2@example.com", "new_password": "FromYinglima#1"}, headers=hdr)
    assert r.status_code == 200, r.text
    assert r.json()["data"]["stored"] is True
    assert seen.get("inhyma") == "FromYinglima#1" and "yinglima" not in seen  # fan-out skips the source ERP
    async with engine_module._sessionmaker() as s:
        u = await s.scalar(select(GlobalUser).where(GlobalUser.primary_email == "pw2@example.com"))
        assert u.metadata_json["default_password"] == "FromYinglima#1"
    # and the new central password is what signs the user in now
    es._ECOSYSTEM_SESSION_STORE.clear()
    assert (await client.post(EST, json={"email": "pw2@example.com", "password": "FromYinglima#1", "source_erp": "x"})).status_code == 200


@pytest.mark.asyncio
async def test_internal_password_endpoint_rejects_bad_or_missing_credentials(client, monkeypatch):
    monkeypatch.setattr(settings, "ERP_MAIN_TO_INHYMA_SERVICE_CREDENTIAL", "inhyma-shared-secret-123456")
    body = {"email": "x@example.com", "new_password": "Abc#12345"}
    assert (await client.post("/api/v1/internal/users/password", json=body)).status_code == 401
    assert (await client.post("/api/v1/internal/users/password", json=body, headers={"Authorization": "Bearer wrong", "X-ERP-Key": "inhyma"})).status_code == 401
    assert (await client.post("/api/v1/internal/users/password", json=body, headers={"Authorization": "Bearer inhyma-shared-secret-123456"})).status_code == 401  # no ERP key


# ------------------------------------------------------------------ scale
@pytest.mark.asyncio
async def test_user_list_supports_search_status_and_paging(admin_client):
    for n in range(7):
        await _user(admin_client, f"person{n}@acme.com")
    await _user(admin_client, "other@zzz.com")
    page1 = (await admin_client.get("/api/v1/global/users?limit=5&offset=0&search=acme")).json()["data"]
    page2 = (await admin_client.get("/api/v1/global/users?limit=5&offset=5&search=acme")).json()["data"]
    assert len(page1) == 5 and len(page2) == 2
    assert all("acme" in u["primary_email"] for u in page1 + page2)
    assert len({u["id"] for u in page1 + page2}) == 7  # stable paging, no duplicates
    none = (await admin_client.get("/api/v1/global/users?status=SUSPENDED&search=acme")).json()["data"]
    assert none == []


@pytest.mark.asyncio
async def test_memberships_can_be_fetched_for_just_one_page_of_users(admin_client):
    y = await _erp(admin_client, "yinglima")
    ids = []
    for n in range(3):
        uid = await _user(admin_client, f"m{n}@example.com"); ids.append(uid)
        await admin_client.post(f"/api/v1/global/users/{uid}/provision", json={"erp_instance_id": y})
    got = (await admin_client.get(f"/api/v1/global/memberships?user_ids={ids[0]},{ids[1]}")).json()["data"]
    assert {m["global_user_id"] for m in got} == {ids[0], ids[1]}


@pytest.mark.asyncio
async def test_validated_session_is_cached_and_store_is_bounded(admin_client, client, monkeypatch):
    await _user(admin_client, "cache@example.com")
    monkeypatch.setattr(settings, "ECOSYSTEM_SESSION_REVALIDATE_TTL_SECONDS", 60.0)
    sid = await _session(client, "cache@example.com")
    calls = {"n": 0}
    orig = es._revalidate_cached
    async def counting(*a, **k):
        calls["n"] += 1; return await orig(*a, **k)
    monkeypatch.setattr(es, "_revalidate_cached", counting)
    for _ in range(5):
        assert (await client.get(f"/api/v1/global/ecosystem-session/{sid}")).json()["data"]["active"] is True
    assert calls["n"] == 0, "within the TTL no database re-validation should happen"

    monkeypatch.setattr(settings, "ECOSYSTEM_SESSION_STORE_MAX", 10)
    for n in range(30):
        es._ECOSYSTEM_SESSION_STORE[f"fake-{n}"] = {"email": "x", "created_at": f"2026-01-01T00:00:{n:02d}", "revoked_at": None}
    from datetime import datetime, timezone
    es._prune_store(datetime.now(timezone.utc))
    assert len(es._ECOSYSTEM_SESSION_STORE) <= 10


@pytest.mark.asyncio
async def test_user_list_filters_by_erp_no_erp_and_multiple_statuses(admin_client):
    y = await _erp(admin_client, "yinglima")
    with_erp = await _user(admin_client, "has-erp@example.com")
    await admin_client.post(f"/api/v1/global/users/{with_erp}/provision", json={"erp_instance_id": y})
    await _user(admin_client, "no-erp@example.com")
    susp = await _user(admin_client, "suspended@example.com")
    await admin_client.patch(f"/api/v1/global/users/{susp}/status", json={"status": "SUSPENDED"})

    in_erp = (await admin_client.get(f"/api/v1/global/users?erp_id={y}")).json()["data"]
    assert [u["primary_email"] for u in in_erp] == ["has-erp@example.com"]
    none = {u["primary_email"] for u in (await admin_client.get("/api/v1/global/users?no_erp=true")).json()["data"]}
    assert "no-erp@example.com" in none and "has-erp@example.com" not in none
    inactive = {u["primary_email"] for u in (await admin_client.get("/api/v1/global/users?status=DISABLED,SUSPENDED")).json()["data"]}
    assert inactive == {"suspended@example.com"}
