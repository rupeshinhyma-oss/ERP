"""
ERP Membership Tests.

Covers Phase 3 Step 57: create, retrieve, list-by-user, list-by-erp,
duplicate ERP membership rejected, duplicate local-user binding
rejected, unknown GlobalUser, unknown ERP, invalid local user
identifier, suspend, restore, revoke, membership with DECOMMISSIONED
ERP rejected, unauthorized linking.
"""

from __future__ import annotations

import uuid

import pytest


async def _create_user_and_erp(admin_client, *, email: str, erp_key: str):
    """Shared setup: one Global User and one ERP instance, both created via the API."""
    user_resp = await admin_client.post(
        "/api/v1/global/users", json={"display_name": "Test User", "primary_email": email}
    )
    erp_resp = await admin_client.post(
        "/api/v1/global/erps", json={"key": erp_key, "name": erp_key, "display_name": erp_key, "status": "ACTIVE"}
    )
    return user_resp.json()["data"]["id"], erp_resp.json()["data"]["id"]


@pytest.mark.asyncio
async def test_create_membership(admin_client):
    """POST creates a new membership, starting PENDING."""
    user_id, erp_id = await _create_user_and_erp(admin_client, email="m1@example.com", erp_key="erp_m1")

    resp = await admin_client.post(
        f"/api/v1/global/users/{user_id}/memberships/{erp_id}", json={"local_user_id": "local-17"}
    )
    assert resp.status_code == 201
    data = resp.json()["data"]
    assert data["status"] == "PENDING"
    assert data["local_user_id"] == "local-17"
    assert data["global_user_id"] == user_id
    assert data["erp_instance_id"] == erp_id


@pytest.mark.asyncio
async def test_retrieve_membership(admin_client):
    """GET /global/memberships/{id} retrieves a membership by its own id."""
    user_id, erp_id = await _create_user_and_erp(admin_client, email="m2@example.com", erp_key="erp_m2")
    created = await admin_client.post(
        f"/api/v1/global/users/{user_id}/memberships/{erp_id}", json={"local_user_id": "local-2"}
    )
    membership_id = created.json()["data"]["id"]

    resp = await admin_client.get(f"/api/v1/global/memberships/{membership_id}")
    assert resp.status_code == 200
    assert resp.json()["data"]["local_user_id"] == "local-2"


@pytest.mark.asyncio
async def test_list_user_memberships_across_two_erps(admin_client):
    """The same Global User can hold one membership in Yinglima and another in Inhyma."""
    user_resp = await admin_client.post(
        "/api/v1/global/users", json={"display_name": "Cross ERP User", "primary_email": "cross@example.com"}
    )
    user_id = user_resp.json()["data"]["id"]

    yinglima = await admin_client.post(
        "/api/v1/global/erps", json={"key": "yinglima", "name": "Y", "display_name": "Y", "status": "ACTIVE"}
    )
    inhyma = await admin_client.post(
        "/api/v1/global/erps", json={"key": "inhyma", "name": "I", "display_name": "I", "status": "ACTIVE"}
    )
    yinglima_id = yinglima.json()["data"]["id"]
    inhyma_id = inhyma.json()["data"]["id"]

    await admin_client.post(f"/api/v1/global/users/{user_id}/memberships/{yinglima_id}", json={"local_user_id": "y-17"})
    await admin_client.post(f"/api/v1/global/users/{user_id}/memberships/{inhyma_id}", json={"local_user_id": "i-93"})

    resp = await admin_client.get(f"/api/v1/global/users/{user_id}/memberships")
    assert resp.status_code == 200
    memberships = resp.json()["data"]
    assert len(memberships) == 2
    erp_ids = {m["erp_instance_id"] for m in memberships}
    assert erp_ids == {yinglima_id, inhyma_id}


@pytest.mark.asyncio
async def test_list_erp_members(admin_client):
    """GET /global/erps/{id}/members lists Global Users with a membership in that ERP."""
    user_id, erp_id = await _create_user_and_erp(admin_client, email="m3@example.com", erp_key="erp_m3")
    await admin_client.post(f"/api/v1/global/users/{user_id}/memberships/{erp_id}", json={"local_user_id": "local-3"})

    resp = await admin_client.get(f"/api/v1/global/erps/{erp_id}/members")
    assert resp.status_code == 200
    assert len(resp.json()["data"]) == 1


@pytest.mark.asyncio
async def test_duplicate_erp_membership_rejected(admin_client):
    """A Global User cannot have two memberships in the same ERP (Phase 3 Step 11)."""
    user_id, erp_id = await _create_user_and_erp(admin_client, email="m4@example.com", erp_key="erp_m4")
    first = await admin_client.post(
        f"/api/v1/global/users/{user_id}/memberships/{erp_id}", json={"local_user_id": "local-a"}
    )
    assert first.status_code == 201

    second = await admin_client.post(
        f"/api/v1/global/users/{user_id}/memberships/{erp_id}", json={"local_user_id": "local-b"}
    )
    assert second.status_code == 409


@pytest.mark.asyncio
async def test_duplicate_local_user_binding_rejected(admin_client):
    """One ERP-local account cannot be linked to two different Global Users (Phase 3 Step 11)."""
    erp_resp = await admin_client.post(
        "/api/v1/global/erps", json={"key": "erp_m5", "name": "E", "display_name": "E", "status": "ACTIVE"}
    )
    erp_id = erp_resp.json()["data"]["id"]

    user1 = await admin_client.post(
        "/api/v1/global/users", json={"display_name": "U1", "primary_email": "u1@example.com"}
    )
    user2 = await admin_client.post(
        "/api/v1/global/users", json={"display_name": "U2", "primary_email": "u2@example.com"}
    )
    user1_id = user1.json()["data"]["id"]
    user2_id = user2.json()["data"]["id"]

    first = await admin_client.post(
        f"/api/v1/global/users/{user1_id}/memberships/{erp_id}", json={"local_user_id": "shared-local-id"}
    )
    assert first.status_code == 201

    second = await admin_client.post(
        f"/api/v1/global/users/{user2_id}/memberships/{erp_id}", json={"local_user_id": "shared-local-id"}
    )
    assert second.status_code == 409


@pytest.mark.asyncio
async def test_unknown_global_user_rejected(admin_client):
    """Linking a nonexistent Global User id returns 404."""
    erp_resp = await admin_client.post(
        "/api/v1/global/erps", json={"key": "erp_m6", "name": "E", "display_name": "E", "status": "ACTIVE"}
    )
    erp_id = erp_resp.json()["data"]["id"]

    resp = await admin_client.post(
        f"/api/v1/global/users/{uuid.uuid4()}/memberships/{erp_id}", json={"local_user_id": "local-x"}
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_unknown_erp_rejected(admin_client):
    """Linking a nonexistent ERP id returns 404."""
    user_resp = await admin_client.post(
        "/api/v1/global/users", json={"display_name": "U", "primary_email": "u-unknown-erp@example.com"}
    )
    user_id = user_resp.json()["data"]["id"]

    resp = await admin_client.post(
        f"/api/v1/global/users/{user_id}/memberships/{uuid.uuid4()}", json={"local_user_id": "local-x"}
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_invalid_local_user_identifier_rejected(admin_client):
    """An empty/invalid-shaped local_user_id is rejected at the schema layer."""
    user_id, erp_id = await _create_user_and_erp(admin_client, email="m7@example.com", erp_key="erp_m7")

    resp = await admin_client.post(f"/api/v1/global/users/{user_id}/memberships/{erp_id}", json={"local_user_id": ""})
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_membership_suspend_and_restore(admin_client):
    """Suspend moves status to SUSPENDED; restore moves it back to ACTIVE."""
    user_id, erp_id = await _create_user_and_erp(admin_client, email="m8@example.com", erp_key="erp_m8")
    created = await admin_client.post(
        f"/api/v1/global/users/{user_id}/memberships/{erp_id}", json={"local_user_id": "local-8"}
    )
    membership_id = created.json()["data"]["id"]

    suspend_resp = await admin_client.post(
        f"/api/v1/global/memberships/{membership_id}/suspend", json={"reason": "investigation"}
    )
    assert suspend_resp.status_code == 200
    assert suspend_resp.json()["data"]["status"] == "SUSPENDED"

    restore_resp = await admin_client.post(
        f"/api/v1/global/memberships/{membership_id}/restore", json={"reason": "cleared"}
    )
    assert restore_resp.status_code == 200
    assert restore_resp.json()["data"]["status"] == "ACTIVE"


@pytest.mark.asyncio
async def test_membership_revoke_does_not_delete_row(admin_client):
    """Revoke sets status to REVOKED; the row remains fully retrievable (Phase 3 Step 48)."""
    user_id, erp_id = await _create_user_and_erp(admin_client, email="m9@example.com", erp_key="erp_m9")
    created = await admin_client.post(
        f"/api/v1/global/users/{user_id}/memberships/{erp_id}", json={"local_user_id": "local-9"}
    )
    membership_id = created.json()["data"]["id"]

    resp = await admin_client.post(f"/api/v1/global/memberships/{membership_id}/revoke", json={})
    assert resp.status_code == 200
    assert resp.json()["data"]["status"] == "REVOKED"

    follow_up = await admin_client.get(f"/api/v1/global/memberships/{membership_id}")
    assert follow_up.status_code == 200
    assert follow_up.json()["data"]["status"] == "REVOKED"


@pytest.mark.asyncio
async def test_membership_with_decommissioned_erp_rejected(admin_client):
    """A DECOMMISSIONED ERP cannot accept new memberships (Phase 3 Step 38)."""
    user_id, erp_id = await _create_user_and_erp(admin_client, email="m10@example.com", erp_key="erp_m10")
    await admin_client.delete(f"/api/v1/global/erps/{erp_id}")  # decommission

    resp = await admin_client.post(
        f"/api/v1/global/users/{user_id}/memberships/{erp_id}", json={"local_user_id": "local-10"}
    )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_verify_membership_activates_it(admin_client):
    """POST /verify moves a PENDING membership to ACTIVE and stamps verified_at."""
    user_id, erp_id = await _create_user_and_erp(admin_client, email="m11@example.com", erp_key="erp_m11")
    created = await admin_client.post(
        f"/api/v1/global/users/{user_id}/memberships/{erp_id}", json={"local_user_id": "local-11"}
    )
    membership_id = created.json()["data"]["id"]

    resp = await admin_client.post(f"/api/v1/global/memberships/{membership_id}/verify")
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["status"] == "ACTIVE"
    assert data["verified_at"] is not None


@pytest.mark.asyncio
async def test_unauthorized_linking_rejected(admin_client, client):
    """Creating a membership without authentication is rejected (Phase 3 Step 57)."""
    user_id, erp_id = await _create_user_and_erp(admin_client, email="m12@example.com", erp_key="erp_m12")

    resp = await client.post(
        f"/api/v1/global/users/{user_id}/memberships/{erp_id}", json={"local_user_id": "local-12"}
    )
    assert resp.status_code in (401, 403)
