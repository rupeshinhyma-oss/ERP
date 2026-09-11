"""
Tests for Central Ecosystem Session Management.

Verifies:
- Session establishment with shared session_id across applications.
- Session lookup / validation.
- Session revocation (Global Single Sign-Out).
"""

from __future__ import annotations

import pytest


@pytest.mark.asyncio
async def test_establish_ecosystem_session_for_super_admin(client):
    """Super admin establishes an ecosystem session and receives shared session_id."""
    resp = await client.post(
        "/api/v1/global/ecosystem-session/establish",
        json={
            "email": "admin@example.com",
            "password": "ChangeMe!12345",
            "source_erp": "inhyma",
        },
    )
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["active"] is True
    assert "session_id" in data
    assert data["role"] in ("super_admin", "admin")
    assert "*" in data["allowed_erps"]

    session_id = data["session_id"]

    # Verify session lookup
    get_resp = await client.get(f"/api/v1/global/ecosystem-session/{session_id}")
    assert get_resp.status_code == 200
    get_data = get_resp.json()["data"]
    assert get_data["active"] is True
    assert get_data["session_id"] == session_id

    # Verify global logout / revocation
    revoke_resp = await client.post(f"/api/v1/global/ecosystem-session/{session_id}/revoke")
    assert revoke_resp.status_code == 200
    assert revoke_resp.json()["data"]["status"] == "revoked"

    # Verify session is now inactive
    check_resp = await client.get(f"/api/v1/global/ecosystem-session/{session_id}")
    assert check_resp.status_code == 200
    assert check_resp.json()["data"]["active"] is False
    assert check_resp.json()["data"]["revoked"] is True


@pytest.mark.asyncio
async def test_establish_ecosystem_session_rejects_bad_credentials(client):
    """Invalid credentials return 401."""
    resp = await client.post(
        "/api/v1/global/ecosystem-session/establish",
        json={
            "email": "unknown@example.com",
            "password": "WrongPassword!999",
            "source_erp": "yinglima",
        },
    )
    assert resp.status_code == 401
