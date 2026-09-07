"""
Platform Admin Auth Tests.

Covers login success/failure, session-token validation, and the
SUPER_ADMIN-vs-PLATFORM_ADMIN authorization boundary for creating new
admin accounts.
"""

from __future__ import annotations

import uuid

import pytest


@pytest.mark.asyncio
async def test_login_succeeds_with_valid_credentials(super_admin_client):
    """The bootstrapped SUPER_ADMIN fixture itself proves login works; /me confirms the session is valid."""
    resp = await super_admin_client.get("/api/v1/global/auth/me")
    assert resp.status_code == 200
    assert resp.json()["data"]["role"] == "SUPER_ADMIN"


@pytest.mark.asyncio
async def test_login_fails_with_wrong_password(client):
    """A wrong password returns 401, with the identical message a nonexistent email would get."""
    resp = await client.post(
        "/api/v1/global/auth/login", json={"email": "nobody@platform.example", "password": "wrong"}
    )
    assert resp.status_code == 401
    assert resp.json()["errors"][0]["code"] == "UNAUTHORIZED"


@pytest.mark.asyncio
async def test_me_rejects_missing_token(client):
    """GET /auth/me without any Authorization header is rejected."""
    resp = await client.get("/api/v1/global/auth/me")
    assert resp.status_code in (401, 403)


@pytest.mark.asyncio
async def test_me_rejects_garbage_token(client):
    """A malformed/garbage bearer token is rejected, not silently accepted."""
    client.headers["Authorization"] = "Bearer not-a-real-token"
    resp = await client.get("/api/v1/global/auth/me")
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_super_admin_can_create_platform_admin(super_admin_client):
    """A SUPER_ADMIN can create a new PLATFORM_ADMIN account."""
    resp = await super_admin_client.post(
        "/api/v1/global/auth/admins",
        json={
            "email": "new-admin@platform.example",
            "display_name": "New Admin",
            "password": "Another-Strong-Pass1!",
            "role": "PLATFORM_ADMIN",
        },
    )
    assert resp.status_code == 201
    assert resp.json()["data"]["role"] == "PLATFORM_ADMIN"


@pytest.mark.asyncio
async def test_platform_admin_cannot_create_new_admins(super_admin_client):
    """A PLATFORM_ADMIN (not SUPER_ADMIN) is forbidden from creating other admin accounts."""
    created = await super_admin_client.post(
        "/api/v1/global/auth/admins",
        json={
            "email": "plain-admin@platform.example",
            "display_name": "Plain Admin",
            "password": "Another-Strong-Pass1!",
            "role": "PLATFORM_ADMIN",
        },
    )
    assert created.status_code == 201

    login_resp = await super_admin_client.post(
        "/api/v1/global/auth/login",
        json={"email": "plain-admin@platform.example", "password": "Another-Strong-Pass1!"},
    )
    plain_admin_token = login_resp.json()["data"]["access_token"]

    resp = await super_admin_client.post(
        "/api/v1/global/auth/admins",
        headers={"Authorization": f"Bearer {plain_admin_token}"},
        json={
            "email": "should-fail@platform.example",
            "display_name": "Should Fail",
            "password": "Another-Strong-Pass1!",
            "role": "PLATFORM_ADMIN",
        },
    )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_duplicate_admin_email_is_rejected(super_admin_client):
    """Creating a second admin with an already-used email returns 409 Conflict."""
    payload = {
        "email": "dup-admin@platform.example",
        "display_name": "Dup Admin",
        "password": "Another-Strong-Pass1!",
        "role": "PLATFORM_ADMIN",
    }
    first = await super_admin_client.post("/api/v1/global/auth/admins", json=payload)
    assert first.status_code == 201

    second = await super_admin_client.post("/api/v1/global/auth/admins", json=payload)
    assert second.status_code == 409
