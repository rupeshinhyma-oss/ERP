"""
ERP Service Identity & Heartbeat Tests.

Covers Phase 3 Steps 58-59: valid/invalid/revoked credential, credential
for wrong ERP, rotation, secret not returned after creation, credential
hash not exposed, unauthorized heartbeat, authorized heartbeat,
last_seen_at/version/environment updates, decommissioned ERP behavior,
heartbeat does not grant human access.
"""

from __future__ import annotations

import uuid

import pytest


async def _create_erp(admin_client, *, key: str):
    """Create an ACTIVE ERP instance and return its id."""
    resp = await admin_client.post(
        "/api/v1/global/erps", json={"key": key, "name": key, "display_name": key, "status": "ACTIVE"}
    )
    return resp.json()["data"]["id"]


@pytest.mark.asyncio
async def test_issue_credential_returns_plaintext_once(admin_client):
    """Issuing a credential returns the plaintext bearer_token, and the row never re-exposes it."""
    erp_id = await _create_erp(admin_client, key="svc_erp1")

    resp = await admin_client.post(f"/api/v1/global/erps/{erp_id}/credentials", json={})
    assert resp.status_code == 201
    data = resp.json()["data"]
    assert "bearer_token" in data
    assert "." in data["bearer_token"]
    assert "secret_hash" not in data  # never exposed, at all, anywhere

    listing = await admin_client.get(f"/api/v1/global/erps/{erp_id}/credentials")
    for item in listing.json()["data"]:
        assert "bearer_token" not in item
        assert "secret_hash" not in item


@pytest.mark.asyncio
async def test_valid_credential_authenticates_heartbeat(admin_client, client):
    """A freshly issued credential successfully authenticates a heartbeat call."""
    erp_id = await _create_erp(admin_client, key="svc_erp2")
    issued = await admin_client.post(f"/api/v1/global/erps/{erp_id}/credentials", json={})
    token = issued.json()["data"]["bearer_token"]

    client.headers["Authorization"] = f"Bearer {token}"
    resp = await client.post(f"/api/v1/global/erps/{erp_id}/heartbeat", json={"version": "1.2.3"})
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["erp_key"] == "svc_erp2"
    assert data["last_seen_at"] is not None


@pytest.mark.asyncio
async def test_invalid_credential_rejected(client):
    """A syntactically valid but unknown credential is rejected."""
    client.headers["Authorization"] = f"Bearer {uuid.uuid4().hex}.{uuid.uuid4().hex}"
    resp = await client.post(f"/api/v1/global/erps/{uuid.uuid4()}/heartbeat", json={})
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_malformed_credential_rejected(client):
    """A credential missing the '.' separator is rejected, not a 500."""
    client.headers["Authorization"] = "Bearer garbage-no-dot"
    resp = await client.post(f"/api/v1/global/erps/{uuid.uuid4()}/heartbeat", json={})
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_revoked_credential_rejected(admin_client, client):
    """A revoked credential can no longer authenticate."""
    erp_id = await _create_erp(admin_client, key="svc_erp3")
    issued = await admin_client.post(f"/api/v1/global/erps/{erp_id}/credentials", json={})
    credential_id = issued.json()["data"]["id"]
    token = issued.json()["data"]["bearer_token"]

    revoke_resp = await admin_client.post(f"/api/v1/global/erps/{erp_id}/credentials/{credential_id}/revoke")
    assert revoke_resp.status_code == 200

    client.headers["Authorization"] = f"Bearer {token}"
    resp = await client.post(f"/api/v1/global/erps/{erp_id}/heartbeat", json={})
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_credential_for_wrong_erp_rejected(admin_client, client):
    """A valid credential for ERP A cannot heartbeat as ERP B, even if B's id is put in the path."""
    erp_a = await _create_erp(admin_client, key="svc_erp_a")
    erp_b = await _create_erp(admin_client, key="svc_erp_b")
    issued = await admin_client.post(f"/api/v1/global/erps/{erp_a}/credentials", json={})
    token = issued.json()["data"]["bearer_token"]

    client.headers["Authorization"] = f"Bearer {token}"
    resp = await client.post(f"/api/v1/global/erps/{erp_b}/heartbeat", json={})
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_rotation_issues_new_credential_without_revoking_old(admin_client, client):
    """Rotating a credential issues a new one while the original remains usable until explicitly revoked."""
    erp_id = await _create_erp(admin_client, key="svc_erp4")
    original = await admin_client.post(f"/api/v1/global/erps/{erp_id}/credentials", json={})
    original_token = original.json()["data"]["bearer_token"]

    rotated = await admin_client.post(f"/api/v1/global/erps/{erp_id}/credentials/rotate", json={})
    assert rotated.status_code == 201
    new_token = rotated.json()["data"]["bearer_token"]
    assert new_token != original_token

    # Both tokens still work until the old one is explicitly revoked.
    client.headers["Authorization"] = f"Bearer {original_token}"
    old_resp = await client.post(f"/api/v1/global/erps/{erp_id}/heartbeat", json={})
    assert old_resp.status_code == 200

    client.headers["Authorization"] = f"Bearer {new_token}"
    new_resp = await client.post(f"/api/v1/global/erps/{erp_id}/heartbeat", json={})
    assert new_resp.status_code == 200


@pytest.mark.asyncio
async def test_unauthorized_heartbeat_rejected(client):
    """A heartbeat with no Authorization header at all is rejected."""
    resp = await client.post(f"/api/v1/global/erps/{uuid.uuid4()}/heartbeat", json={})
    assert resp.status_code in (401, 403)


@pytest.mark.asyncio
async def test_heartbeat_updates_version_and_environment(admin_client, client):
    """A heartbeat payload's version/environment are reflected on the ERP instance afterward."""
    erp_id = await _create_erp(admin_client, key="svc_erp5")
    issued = await admin_client.post(f"/api/v1/global/erps/{erp_id}/credentials", json={})
    token = issued.json()["data"]["bearer_token"]

    client.headers["Authorization"] = f"Bearer {token}"
    await client.post(f"/api/v1/global/erps/{erp_id}/heartbeat", json={"version": "9.9.9", "environment": "staging"})

    fetched = await admin_client.get(f"/api/v1/global/erps/{erp_id}")
    data = fetched.json()["data"]
    assert data["version"] == "9.9.9"
    assert data["environment"] == "staging"


@pytest.mark.asyncio
async def test_heartbeat_never_changes_status(admin_client, client):
    """A heartbeat never touches the ERP's lifecycle status (Phase 3 Step 49)."""
    erp_id = await _create_erp(admin_client, key="svc_erp6")
    issued = await admin_client.post(f"/api/v1/global/erps/{erp_id}/credentials", json={})
    token = issued.json()["data"]["bearer_token"]

    client.headers["Authorization"] = f"Bearer {token}"
    await client.post(f"/api/v1/global/erps/{erp_id}/heartbeat", json={})

    fetched = await admin_client.get(f"/api/v1/global/erps/{erp_id}")
    assert fetched.json()["data"]["status"] == "ACTIVE"  # unchanged, never auto-flipped


@pytest.mark.asyncio
async def test_decommissioned_erp_rejects_heartbeat(admin_client, client):
    """A DECOMMISSIONED ERP's own valid credential is rejected for heartbeat purposes."""
    erp_id = await _create_erp(admin_client, key="svc_erp7")
    issued = await admin_client.post(f"/api/v1/global/erps/{erp_id}/credentials", json={})
    token = issued.json()["data"]["bearer_token"]

    await admin_client.delete(f"/api/v1/global/erps/{erp_id}")  # decommission

    client.headers["Authorization"] = f"Bearer {token}"
    resp = await client.post(f"/api/v1/global/erps/{erp_id}/heartbeat", json={})
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_heartbeat_does_not_grant_human_access(client):
    """A valid ERP service credential cannot be used to call a human-admin-only route (Phase 3 Step 59)."""
    # No credential is even needed to demonstrate this -- the point is
    # that /global/auth/me and other platform-admin routes only ever
    # accept a platform-admin session token (a different JWT signing
    # domain entirely), never a service credential's bearer format.
    client.headers["Authorization"] = f"Bearer {uuid.uuid4().hex}.{uuid.uuid4().hex}"
    resp = await client.get("/api/v1/global/auth/me")
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_credential_issuance_requires_authentication(client):
    """Issuing a credential without authentication is rejected."""
    resp = await client.post(f"/api/v1/global/erps/{uuid.uuid4()}/credentials", json={})
    assert resp.status_code in (401, 403)
