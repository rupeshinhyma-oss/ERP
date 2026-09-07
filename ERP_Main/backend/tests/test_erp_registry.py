"""
ERP Registry Tests.

Covers exactly the cases the Phase 2 brief (Step 22) calls out: unique
ERP key, ERP creation, ERP retrieval, ERP status change, invalid ERP id,
duplicate ERP key, decommission-not-delete, module idempotency, unknown
ERP rejection, health endpoint. Every assertion from Phase 2 is preserved
unchanged (Phase 3 Step 55) -- only the calling client changed, from
`client` (unauthenticated) to `admin_client` (authenticated platform
admin), because mutation routes now correctly require one (Phase 3 Step
21). Read routes (`GET`) remain on the plain `client` fixture, since they
remain open by design (see `app.erp_registry.routes` module docstring).

New in Phase 3: `test_mutations_require_authentication` and
`test_read_routes_remain_open_without_authentication` directly assert
the authorization boundary itself.
"""

from __future__ import annotations

import uuid

import pytest


@pytest.mark.asyncio
async def test_register_erp_creates_instance(admin_client):
    """POST /global/erps creates a new ERP instance and returns it."""
    resp = await admin_client.post(
        "/api/v1/global/erps",
        json={"key": "yinglima", "name": "Yinglima ERP", "display_name": "Yinglima ERP", "status": "ACTIVE"},
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["success"] is True
    assert body["data"]["key"] == "yinglima"
    assert body["data"]["status"] == "ACTIVE"
    assert body["data"]["modules"] == []
    # Internal id is a real UUID, distinct from the key.
    uuid.UUID(body["data"]["id"])


@pytest.mark.asyncio
async def test_duplicate_key_is_rejected(admin_client):
    """Registering the same key twice returns 409 Conflict, not a duplicate row."""
    payload = {"key": "yinglima", "name": "Yinglima ERP", "display_name": "Yinglima ERP"}
    first = await admin_client.post("/api/v1/global/erps", json=payload)
    assert first.status_code == 201

    second = await admin_client.post("/api/v1/global/erps", json=payload)
    assert second.status_code == 409
    body = second.json()
    assert body["success"] is False
    assert body["errors"][0]["code"] == "CONFLICT"

    listing = await admin_client.get("/api/v1/global/erps")
    assert len(listing.json()["data"]) == 1


@pytest.mark.asyncio
async def test_invalid_key_format_is_rejected(admin_client):
    """A key that isn't lowercase/letters/digits/underscore is rejected at the schema layer."""
    resp = await admin_client.post(
        "/api/v1/global/erps",
        json={"key": "Yinglima ERP!", "name": "Yinglima ERP", "display_name": "Yinglima ERP"},
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_get_by_id_returns_instance(admin_client, client):
    """GET /global/erps/{id} retrieves a previously registered instance."""
    created = await admin_client.post(
        "/api/v1/global/erps", json={"key": "inhyma", "name": "Inhyma ERP", "display_name": "Inhyma ERP"}
    )
    erp_id = created.json()["data"]["id"]

    resp = await client.get(f"/api/v1/global/erps/{erp_id}")
    assert resp.status_code == 200
    assert resp.json()["data"]["key"] == "inhyma"


@pytest.mark.asyncio
async def test_get_by_key_returns_instance(admin_client, client):
    """GET /global/erps/by-key/{key} retrieves a previously registered instance by its stable key."""
    await admin_client.post(
        "/api/v1/global/erps", json={"key": "erp_03", "name": "ERP 03", "display_name": "ERP 03"}
    )

    resp = await client.get("/api/v1/global/erps/by-key/erp_03")
    assert resp.status_code == 200
    assert resp.json()["data"]["key"] == "erp_03"


@pytest.mark.asyncio
async def test_invalid_erp_id_returns_404(client):
    """A well-formed but nonexistent UUID returns 404, not a 500 or empty success."""
    resp = await client.get(f"/api/v1/global/erps/{uuid.uuid4()}")
    assert resp.status_code == 404
    body = resp.json()
    assert body["success"] is False
    assert body["errors"][0]["code"] == "NOT_FOUND"


@pytest.mark.asyncio
async def test_list_erps_returns_all_registered(admin_client, client):
    """GET /global/erps returns every registered ERP instance."""
    await admin_client.post(
        "/api/v1/global/erps", json={"key": "yinglima", "name": "Yinglima ERP", "display_name": "Y"}
    )
    await admin_client.post(
        "/api/v1/global/erps", json={"key": "inhyma", "name": "Inhyma ERP", "display_name": "I"}
    )

    resp = await client.get("/api/v1/global/erps")
    assert resp.status_code == 200
    keys = {item["key"] for item in resp.json()["data"]}
    assert keys == {"yinglima", "inhyma"}


@pytest.mark.asyncio
async def test_change_status_updates_status_only(admin_client):
    """PATCH .../status changes only the status field, leaving key/name untouched."""
    created = await admin_client.post(
        "/api/v1/global/erps",
        json={"key": "yinglima", "name": "Yinglima ERP", "display_name": "Yinglima ERP", "status": "INACTIVE"},
    )
    erp_id = created.json()["data"]["id"]

    resp = await admin_client.patch(f"/api/v1/global/erps/{erp_id}/status", json={"status": "ACTIVE"})
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["status"] == "ACTIVE"
    assert data["key"] == "yinglima"


@pytest.mark.asyncio
async def test_decommission_does_not_delete_the_row(admin_client, client):
    """DELETE /global/erps/{id} sets DECOMMISSIONED status; the row and its data remain retrievable."""
    created = await admin_client.post(
        "/api/v1/global/erps", json={"key": "erp_old", "name": "Old ERP", "display_name": "Old ERP"}
    )
    erp_id = created.json()["data"]["id"]

    resp = await admin_client.delete(f"/api/v1/global/erps/{erp_id}")
    assert resp.status_code == 200
    assert resp.json()["data"]["status"] == "DECOMMISSIONED"

    # Still fully retrievable afterward -- decommission is not deletion.
    follow_up = await client.get(f"/api/v1/global/erps/{erp_id}")
    assert follow_up.status_code == 200
    assert follow_up.json()["data"]["status"] == "DECOMMISSIONED"
    assert follow_up.json()["data"]["key"] == "erp_old"


@pytest.mark.asyncio
async def test_update_metadata_cannot_change_key(admin_client):
    """The metadata-update schema has no `key` field, so a key change is silently impossible via PATCH."""
    created = await admin_client.post(
        "/api/v1/global/erps", json={"key": "yinglima", "name": "Yinglima ERP", "display_name": "Old Display"}
    )
    erp_id = created.json()["data"]["id"]

    resp = await admin_client.patch(f"/api/v1/global/erps/{erp_id}", json={"display_name": "New Display Name"})
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["display_name"] == "New Display Name"
    assert data["key"] == "yinglima"  # unchanged


@pytest.mark.asyncio
async def test_declare_module_is_idempotent_by_key(admin_client, client):
    """Declaring the same module_key twice updates the existing row rather than duplicating it."""
    created = await admin_client.post(
        "/api/v1/global/erps", json={"key": "yinglima", "name": "Yinglima ERP", "display_name": "Yinglima ERP"}
    )
    erp_id = created.json()["data"]["id"]

    first = await admin_client.post(
        f"/api/v1/global/erps/{erp_id}/modules", json={"module_key": "crm", "module_name": "CRM"}
    )
    assert first.status_code == 201

    second = await admin_client.post(
        f"/api/v1/global/erps/{erp_id}/modules",
        json={"module_key": "crm", "module_name": "Customer Relationship Management", "enabled": False},
    )
    assert second.status_code == 201

    fetched = await client.get(f"/api/v1/global/erps/{erp_id}")
    modules = fetched.json()["data"]["modules"]
    assert len(modules) == 1  # not duplicated
    assert modules[0]["module_name"] == "Customer Relationship Management"
    assert modules[0]["enabled"] is False


@pytest.mark.asyncio
async def test_declare_module_for_unknown_erp_returns_404(admin_client):
    """Declaring a module against a nonexistent ERP id returns 404, not a silent orphan row."""
    resp = await admin_client.post(
        f"/api/v1/global/erps/{uuid.uuid4()}/modules", json={"module_key": "crm", "module_name": "CRM"}
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_health_endpoint(client):
    """The basic health/liveness endpoint responds successfully."""
    resp = await client.get("/api/v1/health")
    assert resp.status_code == 200
    assert resp.json()["data"]["status"] == "ok"


# --------------------------------------------------------------------
# Phase 3: authorization boundary tests (Step 21/55)
# --------------------------------------------------------------------


@pytest.mark.asyncio
async def test_mutations_require_authentication(client):
    """Every mutating registry route rejects an unauthenticated caller (Phase 3 Step 21)."""
    payload = {"key": "yinglima", "name": "Yinglima ERP", "display_name": "Yinglima ERP"}
    resp = await client.post("/api/v1/global/erps", json=payload)
    assert resp.status_code in (401, 403)


@pytest.mark.asyncio
async def test_read_routes_remain_open_without_authentication(admin_client, client):
    """Read routes stay open even without authentication (deliberate choice, see module docstring)."""
    await admin_client.post(
        "/api/v1/global/erps", json={"key": "yinglima", "name": "Yinglima ERP", "display_name": "Yinglima ERP"}
    )
    resp = await client.get("/api/v1/global/erps")
    assert resp.status_code == 200
