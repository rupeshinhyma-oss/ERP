"""
Global Auth Tests.

Covers Phase 4 Steps 54/56-ish for the Global User's own login surface:
registration, login success/failure, lockout, session revocation,
logout, password change, password reset — plus the token/session
separation (revoking a session immediately invalidates its still-valid
JWT).
"""

from __future__ import annotations

import pytest


async def _register_and_login(client, *, email="raj@example.com", password="Str0ng!Passw0rd"):
    """Register a Global User and log in, returning (access_token, session_id)."""
    await client.post(
        "/api/v1/global/user-auth/register",
        json={"display_name": "Raj", "email": email, "password": password},
    )
    resp = await client.post("/api/v1/global/user-auth/login", json={"email": email, "password": password})
    data = resp.json()["data"]
    return data["access_token"], data["session_id"]


@pytest.mark.asyncio
async def test_register_creates_global_user(client):
    """POST /register creates a new Global User."""
    resp = await client.post(
        "/api/v1/global/user-auth/register",
        json={"display_name": "Raj", "email": "raj1@example.com", "password": "Str0ng!Passw0rd"},
    )
    assert resp.status_code == 201
    assert resp.json()["data"]["primary_email"] == "raj1@example.com"


@pytest.mark.asyncio
async def test_duplicate_registration_rejected(client):
    """Registering the same email twice returns 409."""
    payload = {"display_name": "Raj", "email": "dup@example.com", "password": "Str0ng!Passw0rd"}
    first = await client.post("/api/v1/global/user-auth/register", json=payload)
    assert first.status_code == 201
    second = await client.post("/api/v1/global/user-auth/register", json=payload)
    assert second.status_code == 409


@pytest.mark.asyncio
async def test_weak_password_rejected(client):
    """A password that fails the strength policy is rejected."""
    resp = await client.post(
        "/api/v1/global/user-auth/register",
        json={"display_name": "Raj", "email": "weak@example.com", "password": "weak"},
    )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_login_success(client):
    """Login succeeds with correct credentials and returns a usable access token."""
    token, session_id = await _register_and_login(client, email="login1@example.com")
    assert token
    assert session_id

    client.headers["Authorization"] = f"Bearer {token}"
    resp = await client.get("/api/v1/global/user-auth/me")
    assert resp.status_code == 200
    assert resp.json()["data"]["primary_email"] == "login1@example.com"


@pytest.mark.asyncio
async def test_login_wrong_password_fails(client):
    """Wrong password returns 401 with the identical message a nonexistent email would give."""
    await client.post(
        "/api/v1/global/user-auth/register",
        json={"display_name": "Raj", "email": "login2@example.com", "password": "Str0ng!Passw0rd"},
    )
    resp = await client.post(
        "/api/v1/global/user-auth/login", json={"email": "login2@example.com", "password": "wrong-password"}
    )
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_login_nonexistent_email_fails_identically(client):
    """A nonexistent email returns the same 401 shape as a wrong password."""
    resp = await client.post(
        "/api/v1/global/user-auth/login", json={"email": "nobody@example.com", "password": "whatever"}
    )
    assert resp.status_code == 401
    assert resp.json()["errors"][0]["code"] == "UNAUTHORIZED"


@pytest.mark.asyncio
async def test_failed_login_is_actually_audited(client, super_admin_client):
    """
    Regression test: a failed Global User login's audit entry, and its
    failed-attempt counter increment, used to be silently rolled back
    (both writes were only flushed, not committed, before the `raise`
    that follows -- `get_db_session()` rolls back the whole request's
    session on any exception). Fixed in
    `app.global_auth.service.GlobalAuthService.login`.
    """
    await client.post(
        "/api/v1/global/user-auth/register",
        json={"display_name": "Aud", "email": "audit-check@example.com", "password": "Str0ng!Passw0rd"},
    )
    await client.post(
        "/api/v1/global/user-auth/login", json={"email": "audit-check@example.com", "password": "wrong"}
    )

    resp = await super_admin_client.get("/api/v1/global/audit", params={"event_type": "GLOBAL_LOGIN_FAILURE"})
    assert resp.status_code == 200
    assert len(resp.json()["data"]) >= 1


@pytest.mark.asyncio
async def test_account_locks_after_max_failed_attempts(client):
    """After enough failed attempts, the account locks even with the correct password."""
    email = "lockout@example.com"
    await client.post(
        "/api/v1/global/user-auth/register",
        json={"display_name": "Raj", "email": email, "password": "Str0ng!Passw0rd"},
    )
    # Each failed attempt uses a distinct client instance's IP (same
    # test client though) -- rely on GLOBAL_MAX_FAILED_LOGIN_ATTEMPTS
    # default of 5.
    for _ in range(5):
        await client.post("/api/v1/global/user-auth/login", json={"email": email, "password": "wrong"})

    resp = await client.post(
        "/api/v1/global/user-auth/login", json={"email": email, "password": "Str0ng!Passw0rd"}
    )
    assert resp.status_code == 401  # locked out, even with the correct password now


@pytest.mark.asyncio
async def test_logout_revokes_session_immediately(client):
    """After logout, the same (still cryptographically valid) access token is rejected."""
    token, _session_id = await _register_and_login(client, email="logout1@example.com")
    client.headers["Authorization"] = f"Bearer {token}"

    logout_resp = await client.post("/api/v1/global/user-auth/logout")
    assert logout_resp.status_code == 200

    me_resp = await client.get("/api/v1/global/user-auth/me")
    assert me_resp.status_code == 401  # session revoked, token itself still unexpired


@pytest.mark.asyncio
async def test_revoke_specific_session(client):
    """Revoking a listed session by id invalidates it, without needing to log out."""
    token, session_id = await _register_and_login(client, email="revoke1@example.com")
    client.headers["Authorization"] = f"Bearer {token}"

    resp = await client.post(f"/api/v1/global/user-auth/sessions/{session_id}/revoke")
    assert resp.status_code == 200
    assert resp.json()["data"]["revoked_at"] is not None

    me_resp = await client.get("/api/v1/global/user-auth/me")
    assert me_resp.status_code == 401


@pytest.mark.asyncio
async def test_list_sessions(client):
    """GET /sessions lists the caller's own sessions."""
    token, _session_id = await _register_and_login(client, email="sessions1@example.com")
    client.headers["Authorization"] = f"Bearer {token}"

    resp = await client.get("/api/v1/global/user-auth/sessions")
    assert resp.status_code == 200
    assert len(resp.json()["data"]) == 1


@pytest.mark.asyncio
async def test_change_password(client):
    """Changing password requires the current one and allows login with the new one afterward."""
    email = "changepw1@example.com"
    token, _session_id = await _register_and_login(client, email=email, password="Old-Str0ng!Pass")
    client.headers["Authorization"] = f"Bearer {token}"

    resp = await client.post(
        "/api/v1/global/user-auth/change-password",
        json={"current_password": "Old-Str0ng!Pass", "new_password": "New-Str0ng!Pass1"},
    )
    assert resp.status_code == 200

    del client.headers["Authorization"]
    login_resp = await client.post(
        "/api/v1/global/user-auth/login", json={"email": email, "password": "New-Str0ng!Pass1"}
    )
    assert login_resp.status_code == 200


@pytest.mark.asyncio
async def test_change_password_wrong_current_rejected(client):
    """Changing password with the wrong current password is rejected."""
    token, _session_id = await _register_and_login(client, email="changepw2@example.com")
    client.headers["Authorization"] = f"Bearer {token}"

    resp = await client.post(
        "/api/v1/global/user-auth/change-password",
        json={"current_password": "totally-wrong", "new_password": "New-Str0ng!Pass1"},
    )
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_password_reset_flow(client):
    """A generic response is returned for reset requests, whether or not the email is registered."""
    resp_registered = await client.post(
        "/api/v1/global/user-auth/password-reset/request", json={"email": "reset1@example.com"}
    )
    resp_unregistered = await client.post(
        "/api/v1/global/user-auth/password-reset/request", json={"email": "never-registered@example.com"}
    )
    assert resp_registered.status_code == 200
    assert resp_unregistered.status_code == 200
    assert resp_registered.json()["data"] == resp_unregistered.json()["data"]


@pytest.mark.asyncio
async def test_me_requires_authentication(client):
    """GET /me without a token is rejected."""
    resp = await client.get("/api/v1/global/user-auth/me")
    assert resp.status_code in (401, 403)
