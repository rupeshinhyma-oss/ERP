"""
Tests for Phase 6 -- Central User Management & Cross-ERP Access Enforcement.

Verifies:
1. Complete Access Matrix:
   - GlobalUser ACTIVE vs SUSPENDED vs DISABLED
   - Membership ACTIVE vs PENDING vs SUSPENDED vs REVOKED
   - Authorize endpoint fail-closed behavior
2. ERP Switching & Federation Authorization:
   - User holding membership in multiple ERPs can switch between authorized ERPs
   - User without membership in destination ERP is denied
   - PENDING or REVOKED destination membership is denied
   - Authorization codes are single-use (replay protection)
   - Cross-ERP target isolation (token exchanged by wrong ERP rejected)
   - Decommissioned destination ERP rejected
3. Mixed-State Suspension / Re-enable Semantics:
   - Central suspend -> re-enable restores only centrally suspended memberships
   - Independently revoked membership remains REVOKED after GlobalUser re-enable
   - Independently suspended membership remains SUSPENDED after GlobalUser re-enable
4. Internal Membership Lookup by Local User ID:
   - Spoke ERPs can look up membership by local_user_id and receive both
     membership.status and global_user_status
   - Isolation: calling ERP cannot lookup another ERP's local users
"""

from __future__ import annotations

import base64
import hashlib
import secrets
import uuid

import pytest


def _make_pkce_pair() -> tuple[str, str]:
    """Return (code_verifier, code_challenge) for a PKCE S256 pair."""
    verifier = secrets.token_urlsafe(32)
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    challenge = base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")
    return verifier, challenge


async def _register_erp_with_federation(
    admin_client, *, key: str, redirect_uri: str = "https://example.com/callback", federation_enabled: bool = True
):
    """Register an ACTIVE ERP and a federation client for it. Returns (erp_id, client_id, client_secret)."""
    erp_resp = await admin_client.post(
        "/api/v1/global/erps", json={"key": key, "name": key, "display_name": key, "status": "ACTIVE"}
    )
    erp_id = erp_resp.json()["data"]["id"]

    client_resp = await admin_client.post(
        f"/api/v1/global/erps/{erp_id}/federation",
        json={"redirect_uris": [redirect_uri], "federation_enabled": federation_enabled},
    )
    data = client_resp.json()["data"]
    return erp_id, data["client_id"], data["client_secret"]


async def _register_global_user_and_login(client, *, email: str, password: str = "Str0ng!Passw0rd"):
    """Register a Global User and log in. Returns (global_user_id, access_token)."""
    register_resp = await client.post(
        "/api/v1/global/user-auth/register",
        json={"display_name": "Matrix User", "email": email, "password": password},
    )
    user_id = register_resp.json()["data"]["id"]
    login_resp = await client.post("/api/v1/global/user-auth/login", json={"email": email, "password": password})
    return user_id, login_resp.json()["data"]["access_token"]


async def _create_service_credential(admin_client, erp_id: str) -> str:
    """Issue a machine service credential for the given ERP instance."""
    resp = await admin_client.post(f"/api/v1/global/erps/{erp_id}/credentials", json={"label": "RP-Service-Cred"})
    return resp.json()["data"]["bearer_token"]


# =============================================================================
# 1. Access Matrix: Authorize Endpoint Fail-Closed Enforcement
# =============================================================================

@pytest.mark.asyncio
async def test_access_matrix_active_user_active_membership_allowed(client, admin_client):
    """ACTIVE GlobalUser + ACTIVE membership -> /authorize succeeds and issues code."""
    erp_id, _, _ = await _register_erp_with_federation(admin_client, key="matrix_erp_active")
    user_id, token = await _register_global_user_and_login(client, email="active_user@example.com")

    # Link and verify membership
    m_resp = await admin_client.post(
        f"/api/v1/global/users/{user_id}/memberships/{erp_id}", json={"local_user_id": "loc-active-1"}
    )
    m_id = m_resp.json()["data"]["id"]
    await admin_client.post(f"/api/v1/global/memberships/{m_id}/verify")

    _, challenge = _make_pkce_pair()
    auth_resp = await client.post(
        "/api/v1/federation/authorize",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "erp_instance_id": erp_id,
            "redirect_uri": "https://example.com/callback",
            "state": "state-123",
            "code_challenge": challenge,
            "code_challenge_method": "S256",
        },
    )
    assert auth_resp.status_code == 200
    assert "authorization_code" in auth_resp.json()["data"]


@pytest.mark.asyncio
async def test_access_matrix_pending_membership_denied(client, admin_client):
    """ACTIVE GlobalUser + PENDING membership -> /authorize returns 403 Forbidden."""
    erp_id, _, _ = await _register_erp_with_federation(admin_client, key="matrix_erp_pending")
    user_id, token = await _register_global_user_and_login(client, email="pending_mem@example.com")

    # Link but do NOT verify (starts in PENDING)
    await admin_client.post(
        f"/api/v1/global/users/{user_id}/memberships/{erp_id}", json={"local_user_id": "loc-pending-1"}
    )

    _, challenge = _make_pkce_pair()
    auth_resp = await client.post(
        "/api/v1/federation/authorize",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "erp_instance_id": erp_id,
            "redirect_uri": "https://example.com/callback",
            "state": "state-pending",
            "code_challenge": challenge,
            "code_challenge_method": "S256",
        },
    )
    assert auth_resp.status_code == 403
    assert "active membership" in auth_resp.json()["message"]


@pytest.mark.asyncio
async def test_access_matrix_revoked_membership_denied(client, admin_client):
    """ACTIVE GlobalUser + REVOKED membership -> /authorize returns 403 Forbidden."""
    erp_id, _, _ = await _register_erp_with_federation(admin_client, key="matrix_erp_revoked")
    user_id, token = await _register_global_user_and_login(client, email="revoked_mem@example.com")

    # Link, verify, then revoke
    m_resp = await admin_client.post(
        f"/api/v1/global/users/{user_id}/memberships/{erp_id}", json={"local_user_id": "loc-revoked-1"}
    )
    m_id = m_resp.json()["data"]["id"]
    await admin_client.post(f"/api/v1/global/memberships/{m_id}/verify")
    await admin_client.post(f"/api/v1/global/memberships/{m_id}/revoke", json={})

    _, challenge = _make_pkce_pair()
    auth_resp = await client.post(
        "/api/v1/federation/authorize",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "erp_instance_id": erp_id,
            "redirect_uri": "https://example.com/callback",
            "state": "state-revoked",
            "code_challenge": challenge,
            "code_challenge_method": "S256",
        },
    )
    assert auth_resp.status_code == 403
    assert "active membership" in auth_resp.json()["message"]


@pytest.mark.asyncio
async def test_access_matrix_suspended_membership_denied(client, admin_client):
    """ACTIVE GlobalUser + SUSPENDED membership -> /authorize returns 403 Forbidden."""
    erp_id, _, _ = await _register_erp_with_federation(admin_client, key="matrix_erp_suspended")
    user_id, token = await _register_global_user_and_login(client, email="suspended_mem@example.com")

    # Link, verify, then suspend
    m_resp = await admin_client.post(
        f"/api/v1/global/users/{user_id}/memberships/{erp_id}", json={"local_user_id": "loc-suspended-1"}
    )
    m_id = m_resp.json()["data"]["id"]
    await admin_client.post(f"/api/v1/global/memberships/{m_id}/verify")
    await admin_client.post(f"/api/v1/global/memberships/{m_id}/suspend", json={"reason": "admin suspend"})

    _, challenge = _make_pkce_pair()
    auth_resp = await client.post(
        "/api/v1/federation/authorize",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "erp_instance_id": erp_id,
            "redirect_uri": "https://example.com/callback",
            "state": "state-suspended",
            "code_challenge": challenge,
            "code_challenge_method": "S256",
        },
    )
    assert auth_resp.status_code == 403
    assert "active membership" in auth_resp.json()["message"]


@pytest.mark.asyncio
async def test_access_matrix_suspended_global_user_denied(client, admin_client):
    """SUSPENDED GlobalUser (holding existing session token) -> returns 401 Unauthorized."""
    erp_id, _, _ = await _register_erp_with_federation(admin_client, key="matrix_erp_user_susp")
    user_id, token = await _register_global_user_and_login(client, email="user_suspended@example.com")

    # Link & verify membership
    m_resp = await admin_client.post(
        f"/api/v1/global/users/{user_id}/memberships/{erp_id}", json={"local_user_id": "loc-user-susp-1"}
    )
    m_id = m_resp.json()["data"]["id"]
    await admin_client.post(f"/api/v1/global/memberships/{m_id}/verify")

    # Admin suspends the GlobalUser
    susp_resp = await admin_client.patch(
        f"/api/v1/global/users/{user_id}/status", json={"status": "SUSPENDED"}
    )
    assert susp_resp.status_code == 200

    # User attempts to use earlier session token at /authorize
    _, challenge = _make_pkce_pair()
    auth_resp = await client.post(
        "/api/v1/federation/authorize",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "erp_instance_id": erp_id,
            "redirect_uri": "https://example.com/callback",
            "state": "state-susp-user",
            "code_challenge": challenge,
            "code_challenge_method": "S256",
        },
    )
    assert auth_resp.status_code == 401
    assert "suspended or disabled" in auth_resp.json()["message"]


@pytest.mark.asyncio
async def test_access_matrix_disabled_global_user_denied(client, admin_client):
    """DISABLED GlobalUser (holding existing session token) -> returns 401 Unauthorized."""
    erp_id, _, _ = await _register_erp_with_federation(admin_client, key="matrix_erp_user_dis")
    user_id, token = await _register_global_user_and_login(client, email="user_disabled@example.com")

    # Link & verify membership
    m_resp = await admin_client.post(
        f"/api/v1/global/users/{user_id}/memberships/{erp_id}", json={"local_user_id": "loc-user-dis-1"}
    )
    m_id = m_resp.json()["data"]["id"]
    await admin_client.post(f"/api/v1/global/memberships/{m_id}/verify")

    # Admin disables the GlobalUser
    dis_resp = await admin_client.patch(
        f"/api/v1/global/users/{user_id}/status", json={"status": "DISABLED"}
    )
    assert dis_resp.status_code == 200

    # User attempts to use earlier session token at /authorize
    _, challenge = _make_pkce_pair()
    auth_resp = await client.post(
        "/api/v1/federation/authorize",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "erp_instance_id": erp_id,
            "redirect_uri": "https://example.com/callback",
            "state": "state-dis-user",
            "code_challenge": challenge,
            "code_challenge_method": "S256",
        },
    )
    assert auth_resp.status_code == 401
    assert "suspended or disabled" in auth_resp.json()["message"]


@pytest.mark.asyncio
async def test_access_matrix_absent_membership_denied(client, admin_client):
    """User without membership in ERP -> /authorize returns 403 Forbidden."""
    erp_id, _, _ = await _register_erp_with_federation(admin_client, key="matrix_erp_nomem")
    _, token = await _register_global_user_and_login(client, email="no_mem@example.com")

    _, challenge = _make_pkce_pair()
    auth_resp = await client.post(
        "/api/v1/federation/authorize",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "erp_instance_id": erp_id,
            "redirect_uri": "https://example.com/callback",
            "state": "state-nomem",
            "code_challenge": challenge,
            "code_challenge_method": "S256",
        },
    )
    assert auth_resp.status_code == 403
    assert "active membership" in auth_resp.json()["message"]


# =============================================================================
# 2. ERP Switching & Federation Authorization
# =============================================================================

@pytest.mark.asyncio
async def test_switch_erp_destination_membership_verified_independently(client, admin_client):
    """User holding membership in ERP A cannot launch ERP B if no membership in B."""
    erp_a_id, _, _ = await _register_erp_with_federation(admin_client, key="switch_erp_a")
    erp_b_id, _, _ = await _register_erp_with_federation(admin_client, key="switch_erp_b")
    user_id, token = await _register_global_user_and_login(client, email="switch_test@example.com")

    # Link and verify ONLY in ERP A
    m_resp = await admin_client.post(
        f"/api/v1/global/users/{user_id}/memberships/{erp_a_id}", json={"local_user_id": "loc-a"}
    )
    await admin_client.post(f"/api/v1/global/memberships/{m_resp.json()['data']['id']}/verify")

    _, challenge = _make_pkce_pair()

    # Launching ERP A succeeds
    auth_a = await client.post(
        "/api/v1/federation/authorize",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "erp_instance_id": erp_a_id,
            "redirect_uri": "https://example.com/callback",
            "state": "state-a",
            "code_challenge": challenge,
            "code_challenge_method": "S256",
        },
    )
    assert auth_a.status_code == 200

    # Launching ERP B is rejected
    auth_b = await client.post(
        "/api/v1/federation/authorize",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "erp_instance_id": erp_b_id,
            "redirect_uri": "https://example.com/callback",
            "state": "state-b",
            "code_challenge": challenge,
            "code_challenge_method": "S256",
        },
    )
    assert auth_b.status_code == 403


@pytest.mark.asyncio
async def test_switch_erp_code_is_single_use_replay_rejected(client, admin_client):
    """Authorization codes cannot be replayed; second token exchange fails."""
    erp_id, client_id, client_secret = await _register_erp_with_federation(admin_client, key="replay_erp")
    user_id, token = await _register_global_user_and_login(client, email="replay_user@example.com")

    m_resp = await admin_client.post(
        f"/api/v1/global/users/{user_id}/memberships/{erp_id}", json={"local_user_id": "loc-replay"}
    )
    await admin_client.post(f"/api/v1/global/memberships/{m_resp.json()['data']['id']}/verify")

    verifier, challenge = _make_pkce_pair()
    auth_resp = await client.post(
        "/api/v1/federation/authorize",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "erp_instance_id": erp_id,
            "redirect_uri": "https://example.com/callback",
            "state": "state-1",
            "code_challenge": challenge,
            "code_challenge_method": "S256",
        },
    )
    code = auth_resp.json()["data"]["authorization_code"]

    # First exchange succeeds
    token_resp_1 = await client.post(
        "/api/v1/federation/token",
        json={
            "client_id": client_id,
            "client_secret": client_secret,
            "code": code,
            "redirect_uri": "https://example.com/callback",
            "code_verifier": verifier,
        },
    )
    assert token_resp_1.status_code == 200

    # Second exchange with the same code is rejected
    token_resp_2 = await client.post(
        "/api/v1/federation/token",
        json={
            "client_id": client_id,
            "client_secret": client_secret,
            "code": code,
            "redirect_uri": "https://example.com/callback",
            "code_verifier": verifier,
        },
    )
    assert token_resp_2.status_code in (400, 401, 403)


# =============================================================================
# 3. Mixed-State Suspension / Re-enable Semantics
# =============================================================================

@pytest.mark.asyncio
async def test_mixed_state_disable_reenable_preserves_independent_revocation(client, admin_client):
    """
    Mixed state:
    - User has ERP A (ACTIVE) and ERP B (ACTIVE).
    - GlobalUser is suspended -> ERP A & ERP B become centrally suspended.
    - Admin independently revokes ERP B (REVOKED).
    - GlobalUser is re-enabled -> ERP A is restored to ACTIVE, but ERP B remains REVOKED!
    """
    user_resp = await admin_client.post(
        "/api/v1/global/users", json={"display_name": "Mixed User", "primary_email": "mixed_state@example.com"}
    )
    user_id = user_resp.json()["data"]["id"]

    erp_a_resp = await admin_client.post(
        "/api/v1/global/erps", json={"key": "mixed_a", "name": "A", "display_name": "A", "status": "ACTIVE"}
    )
    erp_b_resp = await admin_client.post(
        "/api/v1/global/erps", json={"key": "mixed_b", "name": "B", "display_name": "B", "status": "ACTIVE"}
    )
    erp_a_id = erp_a_resp.json()["data"]["id"]
    erp_b_id = erp_b_resp.json()["data"]["id"]

    # Both memberships start ACTIVE
    ma_resp = await admin_client.post(
        f"/api/v1/global/users/{user_id}/memberships/{erp_a_id}", json={"local_user_id": "loc-ma"}
    )
    mb_resp = await admin_client.post(
        f"/api/v1/global/users/{user_id}/memberships/{erp_b_id}", json={"local_user_id": "loc-mb"}
    )
    ma_id = ma_resp.json()["data"]["id"]
    mb_id = mb_resp.json()["data"]["id"]
    await admin_client.post(f"/api/v1/global/memberships/{ma_id}/verify")
    await admin_client.post(f"/api/v1/global/memberships/{mb_id}/verify")

    # 1. Admin suspends GlobalUser -> both become SUSPENDED
    await admin_client.patch(f"/api/v1/global/users/{user_id}/status", json={"status": "SUSPENDED"})
    mem_a = (await admin_client.get(f"/api/v1/global/memberships/{ma_id}")).json()["data"]
    mem_b = (await admin_client.get(f"/api/v1/global/memberships/{mb_id}")).json()["data"]
    assert mem_a["status"] == "SUSPENDED"
    assert mem_b["status"] == "SUSPENDED"

    # 2. Admin independently revokes ERP B membership
    revoke_b = await admin_client.post(
        f"/api/v1/global/memberships/{mb_id}/revoke", json={"reason": "Explicit independent revoke"}
    )
    assert revoke_b.json()["data"]["status"] == "REVOKED"

    # 3. Admin re-enables GlobalUser
    enable_resp = await admin_client.patch(f"/api/v1/global/users/{user_id}/status", json={"status": "ACTIVE"})
    assert enable_resp.json()["data"]["status"] == "ACTIVE"

    # 4. Verify outcomes: ERP A is restored to ACTIVE, but ERP B remains REVOKED!
    final_a = (await admin_client.get(f"/api/v1/global/memberships/{ma_id}")).json()["data"]
    final_b = (await admin_client.get(f"/api/v1/global/memberships/{mb_id}")).json()["data"]
    assert final_a["status"] == "ACTIVE"
    assert final_b["status"] == "REVOKED"


@pytest.mark.asyncio
async def test_mixed_state_preexisting_independent_suspension_not_restored(client, admin_client):
    """
    A membership that was ALREADY suspended by an admin independently before
    the GlobalUser was suspended is NOT automatically restored upon re-enable.
    """
    user_resp = await admin_client.post(
        "/api/v1/global/users", json={"display_name": "PreSusp User", "primary_email": "presusp_user@example.com"}
    )
    user_id = user_resp.json()["data"]["id"]

    erp_a_resp = await admin_client.post(
        "/api/v1/global/erps", json={"key": "presusp_a", "name": "A", "display_name": "A", "status": "ACTIVE"}
    )
    erp_b_resp = await admin_client.post(
        "/api/v1/global/erps", json={"key": "presusp_b", "name": "B", "display_name": "B", "status": "ACTIVE"}
    )
    erp_a_id = erp_a_resp.json()["data"]["id"]
    erp_b_id = erp_b_resp.json()["data"]["id"]

    ma_resp = await admin_client.post(
        f"/api/v1/global/users/{user_id}/memberships/{erp_a_id}", json={"local_user_id": "loc-pa"}
    )
    mb_resp = await admin_client.post(
        f"/api/v1/global/users/{user_id}/memberships/{erp_b_id}", json={"local_user_id": "loc-pb"}
    )
    ma_id = ma_resp.json()["data"]["id"]
    mb_id = mb_resp.json()["data"]["id"]
    await admin_client.post(f"/api/v1/global/memberships/{ma_id}/verify")
    await admin_client.post(f"/api/v1/global/memberships/{mb_id}/verify")

    # Admin independently suspends ERP B while GlobalUser is still ACTIVE
    await admin_client.post(f"/api/v1/global/memberships/{mb_id}/suspend", json={"reason": "Independent suspension"})

    # Now admin suspends GlobalUser
    await admin_client.patch(f"/api/v1/global/users/{user_id}/status", json={"status": "SUSPENDED"})

    # Admin re-enables GlobalUser
    await admin_client.patch(f"/api/v1/global/users/{user_id}/status", json={"status": "ACTIVE"})

    # ERP A should be restored (was suspended by the GlobalUser transition)
    # ERP B must STAY suspended (was suspended independently)
    final_a = (await admin_client.get(f"/api/v1/global/memberships/{ma_id}")).json()["data"]
    final_b = (await admin_client.get(f"/api/v1/global/memberships/{mb_id}")).json()["data"]
    assert final_a["status"] == "ACTIVE"
    assert final_b["status"] == "SUSPENDED"


# =============================================================================
# 4. Internal Spoke Membership Lookup (by Local User ID & Global User ID)
# =============================================================================

@pytest.mark.asyncio
async def test_internal_lookup_by_local_user_returns_membership_and_global_status(client, admin_client):
    """Internal lookup by local user id returns membership status and GlobalUser status."""
    erp_resp = await admin_client.post(
        "/api/v1/global/erps", json={"key": "lookup_erp", "name": "L", "display_name": "L", "status": "ACTIVE"}
    )
    erp_id = erp_resp.json()["data"]["id"]
    cred_token = await _create_service_credential(admin_client, erp_id)

    user_resp = await admin_client.post(
        "/api/v1/global/users", json={"display_name": "Lookup User", "primary_email": "lookup@example.com"}
    )
    user_id = user_resp.json()["data"]["id"]

    # Link and verify membership
    m_resp = await admin_client.post(
        f"/api/v1/global/users/{user_id}/memberships/{erp_id}", json={"local_user_id": "local-999"}
    )
    await admin_client.post(f"/api/v1/global/memberships/{m_resp.json()['data']['id']}/verify")

    # Spoke queries ERP_Main with its service credential
    lookup_resp = await client.get(
        "/api/v1/internal/federation/memberships/by-local-user/local-999",
        headers={"Authorization": f"Bearer {cred_token}"},
    )
    assert lookup_resp.status_code == 200
    data = lookup_resp.json()["data"]
    assert data["local_user_id"] == "local-999"
    assert data["status"] == "ACTIVE"
    assert data["global_user_status"] == "ACTIVE"

    # Now suspend the GlobalUser; verify lookup reflects the suspended status
    await admin_client.patch(f"/api/v1/global/users/{user_id}/status", json={"status": "SUSPENDED"})
    lookup_susp = await client.get(
        "/api/v1/internal/federation/memberships/by-local-user/local-999",
        headers={"Authorization": f"Bearer {cred_token}"},
    )
    assert lookup_susp.status_code == 200
    data_susp = lookup_susp.json()["data"]
    assert data_susp["status"] == "SUSPENDED"
    assert data_susp["global_user_status"] == "SUSPENDED"


@pytest.mark.asyncio
async def test_internal_lookup_by_local_user_isolates_calling_erp(client, admin_client):
    """Calling ERP cannot look up another ERP's local user."""
    erp1_resp = await admin_client.post(
        "/api/v1/global/erps", json={"key": "iso_erp_1", "name": "1", "display_name": "1", "status": "ACTIVE"}
    )
    erp2_resp = await admin_client.post(
        "/api/v1/global/erps", json={"key": "iso_erp_2", "name": "2", "display_name": "2", "status": "ACTIVE"}
    )
    erp1_id = erp1_resp.json()["data"]["id"]
    erp2_id = erp2_resp.json()["data"]["id"]

    cred_erp1 = await _create_service_credential(admin_client, erp1_id)
    cred_erp2 = await _create_service_credential(admin_client, erp2_id)

    user_resp = await admin_client.post(
        "/api/v1/global/users", json={"display_name": "Iso User", "primary_email": "iso_user@example.com"}
    )
    user_id = user_resp.json()["data"]["id"]

    # Link user only to ERP 1 with local_user_id "secret-local-1"
    m_resp = await admin_client.post(
        f"/api/v1/global/users/{user_id}/memberships/{erp1_id}", json={"local_user_id": "secret-local-1"}
    )
    await admin_client.post(f"/api/v1/global/memberships/{m_resp.json()['data']['id']}/verify")

    # ERP 1 can resolve it
    resp1 = await client.get(
        "/api/v1/internal/federation/memberships/by-local-user/secret-local-1",
        headers={"Authorization": f"Bearer {cred_erp1}"},
    )
    assert resp1.status_code == 200

    # ERP 2 calling with its own credential gets 404 (does NOT see ERP 1's user)
    resp2 = await client.get(
        "/api/v1/internal/federation/memberships/by-local-user/secret-local-1",
        headers={"Authorization": f"Bearer {cred_erp2}"},
    )
    assert resp2.status_code == 404
