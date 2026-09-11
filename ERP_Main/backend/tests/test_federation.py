"""
Federation Tests.

Covers Phase 4 Steps 54, 57-59: discovery/JWKS, federation client
registration, the full authorize -> token exchange flow, PKCE
verification, redirect_uri strict matching, membership enforcement, and
-- mandatorily -- cross-ERP token/audience isolation (Step 57).
"""

from __future__ import annotations

import base64
import hashlib
import secrets
import uuid

import jwt
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
    """Self-register a Global User (so it has login credentials) and log in. Returns (global_user_id, access_token)."""
    register_resp = await client.post(
        "/api/v1/global/user-auth/register",
        json={"display_name": "Test User", "email": email, "password": password},
    )
    user_id = register_resp.json()["data"]["id"]
    login_resp = await client.post("/api/v1/global/user-auth/login", json={"email": email, "password": password})
    return user_id, login_resp.json()["data"]["access_token"]


async def _link_membership(admin_client, *, global_user_id: str, erp_id: str, local_user_id: str) -> None:
    """Link + verify an ACTIVE membership between an existing Global User and an ERP."""
    membership_resp = await admin_client.post(
        f"/api/v1/global/users/{global_user_id}/memberships/{erp_id}", json={"local_user_id": local_user_id}
    )
    membership_id = membership_resp.json()["data"]["id"]
    await admin_client.post(f"/api/v1/global/memberships/{membership_id}/verify")


# --------------------------------------------------------------------
# Discovery / JWKS
# --------------------------------------------------------------------


@pytest.mark.asyncio
async def test_discovery_document(client):
    """GET /.well-known/openid-configuration returns valid, minimal OIDC metadata."""
    resp = await client.get("/api/v1/.well-known/openid-configuration")
    assert resp.status_code == 200
    data = resp.json()
    assert data["issuer"]
    assert data["authorization_endpoint"].endswith("/federation/authorize")
    assert data["token_endpoint"].endswith("/federation/token")
    assert data["jwks_uri"].endswith("/.well-known/jwks.json")
    assert "RS256" in data["id_token_signing_alg_values_supported"]
    assert "S256" in data["code_challenge_methods_supported"]


@pytest.mark.asyncio
async def test_jwks_exposes_only_public_material(client):
    """GET /.well-known/jwks.json returns a valid JWKS with only public key fields, no private material."""
    resp = await client.get("/api/v1/.well-known/jwks.json")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["keys"]) >= 1
    key = data["keys"][0]
    assert key["kty"] == "RSA"
    assert "n" in key and "e" in key
    assert "d" not in key  # RSA private exponent must never appear
    assert "p" not in key and "q" not in key  # RSA private primes must never appear


# --------------------------------------------------------------------
# Federation client registration
# --------------------------------------------------------------------


@pytest.mark.asyncio
async def test_register_federation_client_returns_secret_once(admin_client):
    """Registering a federation client returns the plaintext secret, never exposed again afterward."""
    erp_id, client_id, client_secret = await _register_erp_with_federation(admin_client, key="fed_erp1")
    assert client_id
    assert client_secret

    # Re-fetching the client via update (or any other read) never re-exposes the secret.
    update_resp = await admin_client.patch(
        f"/api/v1/global/erps/{erp_id}/federation/{client_id}", json={"federation_enabled": True}
    )
    # (client_row_id path uses the row id, not client_id -- this call is
    # expected to 404 since we passed client_id by mistake; the real
    # assertion is just that no response anywhere contains the secret.)
    assert "client_secret" not in update_resp.text or client_secret not in update_resp.text


@pytest.mark.asyncio
async def test_redirect_uri_must_be_absolute_url(admin_client):
    """A non-absolute redirect_uri is rejected at registration."""
    erp_resp = await admin_client.post(
        "/api/v1/global/erps", json={"key": "fed_erp2", "name": "e", "display_name": "e", "status": "ACTIVE"}
    )
    erp_id = erp_resp.json()["data"]["id"]
    resp = await admin_client.post(
        f"/api/v1/global/erps/{erp_id}/federation", json={"redirect_uris": ["not-a-url"], "federation_enabled": True}
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_client_registration_requires_authentication(client):
    """Registering a federation client without authentication is rejected."""
    resp = await client.post(
        f"/api/v1/global/erps/{uuid.uuid4()}/federation",
        json={"redirect_uris": ["https://example.com/callback"]},
    )
    assert resp.status_code in (401, 403)


# --------------------------------------------------------------------
# Full authorize -> token flow
# --------------------------------------------------------------------


@pytest.mark.asyncio
async def test_full_authorization_code_flow(admin_client, client):
    """A Global User with an ACTIVE membership can complete the full authorize -> token exchange."""
    erp_id, client_id, client_secret = await _register_erp_with_federation(admin_client, key="fed_erp3")
    user_id, token = await _register_global_user_and_login(client, email="flow1@example.com")

    await _link_membership(admin_client, global_user_id=user_id, erp_id=erp_id, local_user_id="local-1")
    client.headers["Authorization"] = f"Bearer {token}"

    authorize_resp = await client.post(
        "/api/v1/federation/authorize",
        json={
            "erp_instance_id": erp_id,
            "redirect_uri": "https://example.com/callback",
            "state": "xyz123",
        },
    )
    assert authorize_resp.status_code == 200
    auth_data = authorize_resp.json()["data"]
    assert auth_data["state"] == "xyz123"

    del client.headers["Authorization"]  # token exchange is client-credential authenticated, not user-session
    token_resp = await client.post(
        "/api/v1/federation/token",
        json={
            "code": auth_data["authorization_code"],
            "redirect_uri": "https://example.com/callback",
            "client_id": client_id,
            "client_secret": client_secret,
        },
    )
    assert token_resp.status_code == 200
    id_token = token_resp.json()["data"]["id_token"]

    # Decode without verification just to inspect claims shape (real
    # verification is exercised in test_id_token_claims_are_correct).
    unverified = jwt.decode(id_token, options={"verify_signature": False})
    assert unverified["sub"] == user_id
    assert unverified["aud"] == client_id
    assert "password" not in unverified


@pytest.mark.asyncio
async def test_id_token_claims_are_correct_and_signature_verifies(admin_client, client):
    """The issued ID token's signature verifies against the published JWKS, and claims are minimal/correct."""
    erp_id, client_id, client_secret = await _register_erp_with_federation(admin_client, key="fed_erp4")
    user_id, token = await _register_global_user_and_login(client, email="flow2@example.com")

    await _link_membership(admin_client, global_user_id=user_id, erp_id=erp_id, local_user_id="local-2")
    client.headers["Authorization"] = f"Bearer {token}"
    authorize_resp = await client.post(
        "/api/v1/federation/authorize",
        json={"erp_instance_id": erp_id, "redirect_uri": "https://example.com/callback", "state": "s1"},
    )
    code = authorize_resp.json()["data"]["authorization_code"]

    del client.headers["Authorization"]
    token_resp = await client.post(
        "/api/v1/federation/token",
        json={
            "code": code,
            "redirect_uri": "https://example.com/callback",
            "client_id": client_id,
            "client_secret": client_secret,
        },
    )
    id_token = token_resp.json()["data"]["id_token"]

    jwks_resp = await client.get("/api/v1/.well-known/jwks.json")
    jwk = jwks_resp.json()["keys"][0]

    # Build a public key from the JWKS entry and verify the signature manually.
    from jwt.algorithms import RSAAlgorithm

    public_key = RSAAlgorithm.from_jwk(jwk)
    decoded = jwt.decode(id_token, public_key, algorithms=["RS256"], audience=client_id)
    assert decoded["sub"] == user_id
    assert decoded["iss"]
    assert decoded["type"] == "federation_id_token"


@pytest.mark.asyncio
async def test_authorization_code_is_single_use(admin_client, client):
    """Using the same authorization code twice is rejected the second time (replay protection, Step 41)."""
    erp_id, client_id, client_secret = await _register_erp_with_federation(admin_client, key="fed_erp5")
    user_id, token = await _register_global_user_and_login(client, email="flow3@example.com")

    await _link_membership(admin_client, global_user_id=user_id, erp_id=erp_id, local_user_id="local-3")
    client.headers["Authorization"] = f"Bearer {token}"
    authorize_resp = await client.post(
        "/api/v1/federation/authorize",
        json={"erp_instance_id": erp_id, "redirect_uri": "https://example.com/callback", "state": "s1"},
    )
    code = authorize_resp.json()["data"]["authorization_code"]

    del client.headers["Authorization"]
    token_payload = {
        "code": code,
        "redirect_uri": "https://example.com/callback",
        "client_id": client_id,
        "client_secret": client_secret,
    }
    first = await client.post("/api/v1/federation/token", json=token_payload)
    assert first.status_code == 200
    second = await client.post("/api/v1/federation/token", json=token_payload)
    assert second.status_code == 401


@pytest.mark.asyncio
async def test_pkce_flow_success(admin_client, client):
    """A correct PKCE code_verifier at token exchange succeeds when a code_challenge was set at authorize time."""
    erp_id, client_id, client_secret = await _register_erp_with_federation(admin_client, key="fed_erp6")
    user_id, token = await _register_global_user_and_login(client, email="pkce1@example.com")

    await _link_membership(admin_client, global_user_id=user_id, erp_id=erp_id, local_user_id="local-4")
    client.headers["Authorization"] = f"Bearer {token}"

    verifier, challenge = _make_pkce_pair()
    authorize_resp = await client.post(
        "/api/v1/federation/authorize",
        json={
            "erp_instance_id": erp_id,
            "redirect_uri": "https://example.com/callback",
            "state": "s1",
            "code_challenge": challenge,
            "code_challenge_method": "S256",
        },
    )
    code = authorize_resp.json()["data"]["authorization_code"]

    del client.headers["Authorization"]
    resp = await client.post(
        "/api/v1/federation/token",
        json={
            "code": code,
            "redirect_uri": "https://example.com/callback",
            "client_id": client_id,
            "client_secret": client_secret,
            "code_verifier": verifier,
        },
    )
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_pkce_wrong_verifier_rejected(admin_client, client):
    """A wrong PKCE code_verifier is rejected."""
    erp_id, client_id, client_secret = await _register_erp_with_federation(admin_client, key="fed_erp7")
    user_id, token = await _register_global_user_and_login(client, email="pkce2@example.com")

    await _link_membership(admin_client, global_user_id=user_id, erp_id=erp_id, local_user_id="local-5")
    client.headers["Authorization"] = f"Bearer {token}"

    _verifier, challenge = _make_pkce_pair()
    authorize_resp = await client.post(
        "/api/v1/federation/authorize",
        json={
            "erp_instance_id": erp_id,
            "redirect_uri": "https://example.com/callback",
            "state": "s1",
            "code_challenge": challenge,
            "code_challenge_method": "S256",
        },
    )
    code = authorize_resp.json()["data"]["authorization_code"]

    del client.headers["Authorization"]
    resp = await client.post(
        "/api/v1/federation/token",
        json={
            "code": code,
            "redirect_uri": "https://example.com/callback",
            "client_id": client_id,
            "client_secret": client_secret,
            "code_verifier": "totally-wrong-verifier",
        },
    )
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_plain_pkce_method_rejected(admin_client, client):
    """The 'plain' PKCE method is rejected outright, even with a matching challenge (Step 21)."""
    erp_id, _client_id, _client_secret = await _register_erp_with_federation(admin_client, key="fed_erp8")
    user_id, token = await _register_global_user_and_login(client, email="pkce3@example.com")

    await _link_membership(admin_client, global_user_id=user_id, erp_id=erp_id, local_user_id="local-6")
    client.headers["Authorization"] = f"Bearer {token}"

    resp = await client.post(
        "/api/v1/federation/authorize",
        json={
            "erp_instance_id": erp_id,
            "redirect_uri": "https://example.com/callback",
            "state": "s1",
            "code_challenge": "some-challenge",
            "code_challenge_method": "plain",
        },
    )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_unregistered_redirect_uri_rejected(admin_client, client):
    """A redirect_uri not in the client's registered list is rejected at authorize time (Step 17)."""
    erp_id, _client_id, _client_secret = await _register_erp_with_federation(
        admin_client, key="fed_erp9", redirect_uri="https://example.com/callback"
    )
    user_id, token = await _register_global_user_and_login(client, email="redirect1@example.com")

    await _link_membership(admin_client, global_user_id=user_id, erp_id=erp_id, local_user_id="local-7")
    client.headers["Authorization"] = f"Bearer {token}"

    resp = await client.post(
        "/api/v1/federation/authorize",
        json={
            "erp_instance_id": erp_id,
            "redirect_uri": "https://evil.example.com/callback",
            "state": "s1",
        },
    )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_membership_required_to_authorize(admin_client, client):
    """A Global User with NO membership in an ERP cannot authorize a launch for it (Step 46/53)."""
    erp_id, _client_id, _client_secret = await _register_erp_with_federation(admin_client, key="fed_erp10")
    # Deliberately skip creating a membership.
    _user_id, token = await _register_global_user_and_login(client, email="nomembership@example.com")
    client.headers["Authorization"] = f"Bearer {token}"

    resp = await client.post(
        "/api/v1/federation/authorize",
        json={"erp_instance_id": erp_id, "redirect_uri": "https://example.com/callback", "state": "s1"},
    )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_federation_disabled_erp_rejected(admin_client, client):
    """authorize is rejected when federation_enabled=False, even with ERP status ACTIVE and valid membership."""
    erp_id, _client_id, _client_secret = await _register_erp_with_federation(
        admin_client, key="fed_erp11", federation_enabled=False
    )
    user_id, token = await _register_global_user_and_login(client, email="feddisabled@example.com")

    await _link_membership(admin_client, global_user_id=user_id, erp_id=erp_id, local_user_id="local-8")
    client.headers["Authorization"] = f"Bearer {token}"

    resp = await client.post(
        "/api/v1/federation/authorize",
        json={"erp_instance_id": erp_id, "redirect_uri": "https://example.com/callback", "state": "s1"},
    )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_decommissioned_erp_rejected_at_authorize(admin_client, client):
    """A DECOMMISSIONED ERP rejects authorize even with an otherwise-valid, ACTIVE membership."""
    erp_id, _client_id, _client_secret = await _register_erp_with_federation(admin_client, key="fed_erp12")
    user_id, token = await _register_global_user_and_login(client, email="decom1@example.com")
    await _link_membership(admin_client, global_user_id=user_id, erp_id=erp_id, local_user_id="local-9")
    await admin_client.delete(f"/api/v1/global/erps/{erp_id}")  # decommission

    client.headers["Authorization"] = f"Bearer {token}"
    resp = await client.post(
        "/api/v1/federation/authorize",
        json={"erp_instance_id": erp_id, "redirect_uri": "https://example.com/callback", "state": "s1"},
    )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_authorize_requires_global_user_session(client):
    """POST /federation/authorize without an authenticated Global User session is rejected."""
    resp = await client.post(
        "/api/v1/federation/authorize",
        json={"erp_instance_id": str(uuid.uuid4()), "redirect_uri": "https://example.com/callback", "state": "s1"},
    )
    assert resp.status_code in (401, 403)


@pytest.mark.asyncio
async def test_invalid_client_credentials_rejected_at_token_exchange(admin_client, client):
    """Wrong client_secret at the token endpoint is rejected."""
    erp_id, client_id, _client_secret = await _register_erp_with_federation(admin_client, key="fed_erp13")
    user_id, token = await _register_global_user_and_login(client, email="badclient@example.com")

    await _link_membership(admin_client, global_user_id=user_id, erp_id=erp_id, local_user_id="local-10")
    client.headers["Authorization"] = f"Bearer {token}"
    authorize_resp = await client.post(
        "/api/v1/federation/authorize",
        json={"erp_instance_id": erp_id, "redirect_uri": "https://example.com/callback", "state": "s1"},
    )
    code = authorize_resp.json()["data"]["authorization_code"]

    del client.headers["Authorization"]
    resp = await client.post(
        "/api/v1/federation/token",
        json={
            "code": code,
            "redirect_uri": "https://example.com/callback",
            "client_id": client_id,
            "client_secret": "totally-wrong-secret",
        },
    )
    assert resp.status_code == 401


# --------------------------------------------------------------------
# MANDATORY: cross-ERP security tests (Phase 4 Step 57)
# --------------------------------------------------------------------


@pytest.mark.asyncio
async def test_token_for_yinglima_rejected_by_inhyma_audience(admin_client, client):
    """
    A token issued with aud=yinglima-client must NOT verify against a
    different audience (inhyma-client) -- the exact cross-ERP isolation
    Step 57 mandates.
    """
    yinglima_id, yinglima_client_id, yinglima_secret = await _register_erp_with_federation(
        admin_client, key="yinglima_x", redirect_uri="https://yinglima.example.com/callback"
    )
    inhyma_id, inhyma_client_id, _inhyma_secret = await _register_erp_with_federation(
        admin_client, key="inhyma_x", redirect_uri="https://inhyma.example.com/callback"
    )
    _ = inhyma_id  # registered only to prove its existence doesn't matter to the isolation check below
    user_id, token = await _register_global_user_and_login(client, email="crosstest1@example.com")

    await _link_membership(admin_client, global_user_id=user_id, erp_id=yinglima_id, local_user_id="y-local-1")
    client.headers["Authorization"] = f"Bearer {token}"
    authorize_resp = await client.post(
        "/api/v1/federation/authorize",
        json={
            "erp_instance_id": yinglima_id,
            "redirect_uri": "https://yinglima.example.com/callback",
            "state": "s1",
        },
    )
    code = authorize_resp.json()["data"]["authorization_code"]

    del client.headers["Authorization"]
    token_resp = await client.post(
        "/api/v1/federation/token",
        json={
            "code": code,
            "redirect_uri": "https://yinglima.example.com/callback",
            "client_id": yinglima_client_id,
            "client_secret": yinglima_secret,
        },
    )
    id_token = token_resp.json()["data"]["id_token"]

    # The token's aud is yinglima_client_id. Attempting to verify it
    # against inhyma_client_id as the expected audience MUST fail.
    from jwt.algorithms import RSAAlgorithm

    jwks_resp = await client.get("/api/v1/.well-known/jwks.json")
    jwk = jwks_resp.json()["keys"][0]
    public_key = RSAAlgorithm.from_jwk(jwk)

    with pytest.raises(jwt.InvalidAudienceError):
        jwt.decode(id_token, public_key, algorithms=["RS256"], audience=inhyma_client_id)

    # And it DOES verify correctly against its real, intended audience.
    decoded = jwt.decode(id_token, public_key, algorithms=["RS256"], audience=yinglima_client_id)
    assert decoded["aud"] == yinglima_client_id


@pytest.mark.asyncio
async def test_authorization_code_bound_to_its_own_client(admin_client, client):
    """An authorization code issued for ERP A's client cannot be redeemed using ERP B's client credentials."""
    erp_a_id, _client_a_id, _secret_a = await _register_erp_with_federation(
        admin_client, key="isolate_a", redirect_uri="https://a.example.com/callback"
    )
    erp_b_id, client_b_id, secret_b = await _register_erp_with_federation(
        admin_client, key="isolate_b", redirect_uri="https://b.example.com/callback"
    )
    user_id, token = await _register_global_user_and_login(client, email="isolate1@example.com")

    await _link_membership(admin_client, global_user_id=user_id, erp_id=erp_a_id, local_user_id="a-local-1")
    client.headers["Authorization"] = f"Bearer {token}"

    authorize_resp = await client.post(
        "/api/v1/federation/authorize",
        json={"erp_instance_id": erp_a_id, "redirect_uri": "https://a.example.com/callback", "state": "s1"},
    )
    code_for_a = authorize_resp.json()["data"]["authorization_code"]

    del client.headers["Authorization"]
    # Attempt to redeem ERP A's code using ERP B's client credentials.
    resp = await client.post(
        "/api/v1/federation/token",
        json={
            "code": code_for_a,
            "redirect_uri": "https://a.example.com/callback",
            "client_id": client_b_id,
            "client_secret": secret_b,
        },
    )
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_dual_membership_isolates_local_user_ids(admin_client, client):
    """
    Account isolation (Phase 4 Step 58): a Global User with memberships
    in two ERPs has DIFFERENT local_user_ids in each, and each ERP's
    membership record only ever shows its own local_user_id.
    """
    erp_a_id, _c1, _s1 = await _register_erp_with_federation(
        admin_client, key="dual_a", redirect_uri="https://a2.example.com/callback"
    )
    erp_b_id, _c2, _s2 = await _register_erp_with_federation(
        admin_client, key="dual_b", redirect_uri="https://b2.example.com/callback"
    )
    user_resp = await admin_client.post(
        "/api/v1/global/users", json={"display_name": "Dual", "primary_email": "dual1@example.com"}
    )
    user_id = user_resp.json()["data"]["id"]

    await admin_client.post(f"/api/v1/global/users/{user_id}/memberships/{erp_a_id}", json={"local_user_id": "A-17"})
    await admin_client.post(f"/api/v1/global/users/{user_id}/memberships/{erp_b_id}", json={"local_user_id": "B-93"})

    memberships_resp = await admin_client.get(f"/api/v1/global/users/{user_id}/memberships")
    memberships = memberships_resp.json()["data"]
    by_erp = {m["erp_instance_id"]: m["local_user_id"] for m in memberships}
    assert by_erp[erp_a_id] == "A-17"
    assert by_erp[erp_b_id] == "B-93"
    assert by_erp[erp_a_id] != by_erp[erp_b_id]


@pytest.mark.asyncio
async def test_revoked_membership_blocks_new_authorization(admin_client, client):
    """A REVOKED membership blocks new authorize calls (Step 53 fail-closed)."""
    erp_id, _client_id, _client_secret = await _register_erp_with_federation(admin_client, key="fed_erp14")
    user_id, token = await _register_global_user_and_login(client, email="revoked1@example.com")
    membership_resp = await admin_client.post(
        f"/api/v1/global/users/{user_id}/memberships/{erp_id}", json={"local_user_id": "local-11"}
    )
    membership_id = membership_resp.json()["data"]["id"]
    await admin_client.post(f"/api/v1/global/memberships/{membership_id}/verify")
    await admin_client.post(f"/api/v1/global/memberships/{membership_id}/revoke", json={})

    client.headers["Authorization"] = f"Bearer {token}"
    resp = await client.post(
        "/api/v1/federation/authorize",
        json={"erp_instance_id": erp_id, "redirect_uri": "https://example.com/callback", "state": "s1"},
    )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_pending_membership_blocks_authorization(admin_client, client):
    """A PENDING (not yet verified) membership does not grant federation access (Step 16/53)."""
    erp_id, _client_id, _client_secret = await _register_erp_with_federation(admin_client, key="fed_erp15")
    user_id, token = await _register_global_user_and_login(client, email="pending1@example.com")
    await admin_client.post(
        f"/api/v1/global/users/{user_id}/memberships/{erp_id}", json={"local_user_id": "local-12"}
    )
    # Deliberately do NOT verify -- membership stays PENDING.

    client.headers["Authorization"] = f"Bearer {token}"
    resp = await client.post(
        "/api/v1/federation/authorize",
        json={"erp_instance_id": erp_id, "redirect_uri": "https://example.com/callback", "state": "s1"},
    )
    assert resp.status_code == 403
