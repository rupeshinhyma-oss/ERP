"""
Global User Tests.

Covers Phase 3 Step 56: create, get, update, list, status transition,
invalid id, duplicate identity (email), unauthorized creation,
unauthorized update.
"""

from __future__ import annotations

import uuid

import pytest


@pytest.mark.asyncio
async def test_create_global_user(admin_client):
    """POST /global/users creates a new Global User."""
    resp = await admin_client.post(
        "/api/v1/global/users", json={"display_name": "Raj Kumar", "primary_email": "raj@example.com"}
    )
    assert resp.status_code == 201
    body = resp.json()["data"]
    assert body["display_name"] == "Raj Kumar"
    assert body["primary_email"] == "raj@example.com"
    assert body["status"] == "ACTIVE"
    uuid.UUID(body["id"])


@pytest.mark.asyncio
async def test_get_global_user(admin_client):
    """GET /global/users/{id} retrieves a previously created Global User."""
    created = await admin_client.post(
        "/api/v1/global/users", json={"display_name": "Priya", "primary_email": "priya@example.com"}
    )
    user_id = created.json()["data"]["id"]

    resp = await admin_client.get(f"/api/v1/global/users/{user_id}")
    assert resp.status_code == 200
    assert resp.json()["data"]["primary_email"] == "priya@example.com"


@pytest.mark.asyncio
async def test_update_global_user(admin_client):
    """PATCH /global/users/{id} updates display_name without touching status."""
    created = await admin_client.post(
        "/api/v1/global/users", json={"display_name": "Old Name", "primary_email": "user1@example.com"}
    )
    user_id = created.json()["data"]["id"]

    resp = await admin_client.patch(f"/api/v1/global/users/{user_id}", json={"display_name": "New Name"})
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["display_name"] == "New Name"
    assert data["status"] == "ACTIVE"  # unchanged


@pytest.mark.asyncio
async def test_list_global_users(admin_client):
    """GET /global/users lists every created Global User."""
    await admin_client.post("/api/v1/global/users", json={"display_name": "A", "primary_email": "a@example.com"})
    await admin_client.post("/api/v1/global/users", json={"display_name": "B", "primary_email": "b@example.com"})

    resp = await admin_client.get("/api/v1/global/users")
    assert resp.status_code == 200
    emails = {u["primary_email"] for u in resp.json()["data"]}
    assert emails == {"a@example.com", "b@example.com"}


@pytest.mark.asyncio
async def test_status_transition(admin_client):
    """PATCH /global/users/{id}/status changes status via its own dedicated action."""
    created = await admin_client.post(
        "/api/v1/global/users", json={"display_name": "C", "primary_email": "c@example.com"}
    )
    user_id = created.json()["data"]["id"]

    resp = await admin_client.patch(f"/api/v1/global/users/{user_id}/status", json={"status": "SUSPENDED"})
    assert resp.status_code == 200
    assert resp.json()["data"]["status"] == "SUSPENDED"


@pytest.mark.asyncio
async def test_invalid_id_returns_404(admin_client):
    """A well-formed but nonexistent Global User id returns 404."""
    resp = await admin_client.get(f"/api/v1/global/users/{uuid.uuid4()}")
    assert resp.status_code == 404
    assert resp.json()["errors"][0]["code"] == "NOT_FOUND"


@pytest.mark.asyncio
async def test_duplicate_email_is_rejected(admin_client):
    """Creating a second Global User with an already-used email returns 409 Conflict (Phase 3 Step 56)."""
    payload = {"display_name": "Dup", "primary_email": "dup@example.com"}
    first = await admin_client.post("/api/v1/global/users", json=payload)
    assert first.status_code == 201

    second = await admin_client.post("/api/v1/global/users", json=payload)
    assert second.status_code == 409


@pytest.mark.asyncio
async def test_unauthorized_creation_is_rejected(client):
    """Creating a Global User without authentication is rejected."""
    resp = await client.post(
        "/api/v1/global/users", json={"display_name": "Nobody", "primary_email": "nobody@example.com"}
    )
    assert resp.status_code in (401, 403)


@pytest.mark.asyncio
async def test_unauthorized_update_is_rejected(admin_client, client):
    """Updating a Global User without authentication is rejected."""
    created = await admin_client.post(
        "/api/v1/global/users", json={"display_name": "D", "primary_email": "d@example.com"}
    )
    user_id = created.json()["data"]["id"]

    resp = await client.patch(f"/api/v1/global/users/{user_id}", json={"display_name": "Hijacked"})
    assert resp.status_code in (401, 403)


@pytest.mark.asyncio
async def test_global_user_read_routes_require_authentication(client):
    """Unlike the ERP Registry's reads, Global User reads are NOT open -- they hold personal data."""
    resp = await client.get("/api/v1/global/users")
    assert resp.status_code in (401, 403)
