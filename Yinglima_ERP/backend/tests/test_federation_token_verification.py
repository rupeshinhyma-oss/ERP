"""
Federation Token Verification Tests (Relying Party side).

Unit-level tests for `app.federation.token_verification`, using a
locally-generated RSA keypair to build real, correctly-signed (and
deliberately malformed/mismatched) tokens -- no live ERP_Main instance or
live database is required, since these tests exercise pure verification
logic and bypass the JWKS HTTP fetch by pre-populating the module's
in-memory cache directly.

(Route-level integration tests for `/api/v1/federation/sso-login` are
not included here: Yinglima's existing `tests/conftest.py` `client`
fixture invokes the real application lifespan against the configured
`DATABASE_URL`, which in this environment is a live external Postgres
instance -- the exact same pre-existing limitation documented for
`tests/test_health.py`/`tests/test_public_rfq.py` since Phase 1. These
unit tests cover everything that can be verified without that
dependency; see the Phase 4 delivery report for what remains
integration-untested here and why.)
"""

from __future__ import annotations

import time
from datetime import datetime, timedelta, timezone

import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from jwt.algorithms import RSAAlgorithm

from app.core.config import settings
from app.federation import token_verification as tv


@pytest.fixture
def rsa_keypair():
    """Generate a real RSA keypair for signing test tokens."""
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    private_pem = private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    )
    return private_key, private_pem


@pytest.fixture(autouse=True)
def _reset_jwks_cache():
    """Reset the module-level JWKS cache before and after every test, so tests never leak state to each other."""
    tv._jwks_cache._keys_by_kid = {}
    tv._jwks_cache._fetched_at = 0.0
    yield
    tv._jwks_cache._keys_by_kid = {}
    tv._jwks_cache._fetched_at = 0.0


@pytest.fixture(autouse=True)
def _set_federation_client_id(monkeypatch):
    """Ensure FEDERATION_CLIENT_ID is set for every test in this file (verification refuses to run without it)."""
    monkeypatch.setattr(settings, "FEDERATION_CLIENT_ID", "yinglima-test-client")


def _populate_cache_with_key(kid: str, private_key) -> None:
    """Bypass the JWKS HTTP fetch entirely by injecting the public key directly into the module's cache."""
    tv._jwks_cache._keys_by_kid[kid] = private_key.public_key()
    tv._jwks_cache._fetched_at = time.monotonic()


def _make_token(private_key, *, kid: str, **claim_overrides) -> str:
    """Build a signed token with sane defaults, overridable per-test."""
    now = datetime.now(timezone.utc)
    claims = {
        "iss": settings.ERP_MAIN_ISSUER,
        "sub": "11111111-1111-1111-1111-111111111111",
        "aud": "yinglima-test-client",
        "exp": now + timedelta(minutes=5),
        "iat": now,
        "jti": "some-jti",
        "type": "federation_id_token",
    }
    claims.update(claim_overrides)
    private_pem = private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    )
    return jwt.encode(claims, private_pem, algorithm="RS256", headers={"kid": kid})


@pytest.mark.asyncio
async def test_valid_token_verifies_successfully(rsa_keypair):
    """A correctly-signed token with matching issuer/audience/kid verifies and returns its claims."""
    private_key, _pem = rsa_keypair
    _populate_cache_with_key("key-1", private_key)
    token = _make_token(private_key, kid="key-1")

    claims = await tv.verify_federation_id_token(token)
    assert claims["sub"] == "11111111-1111-1111-1111-111111111111"
    assert claims["aud"] == "yinglima-test-client"


@pytest.mark.asyncio
async def test_wrong_audience_rejected(rsa_keypair):
    """A token whose aud does not match this ERP's own FEDERATION_CLIENT_ID is rejected (Step 15/57)."""
    private_key, _pem = rsa_keypair
    _populate_cache_with_key("key-2", private_key)
    token = _make_token(private_key, kid="key-2", aud="some-other-erps-client-id")

    with pytest.raises(tv.InvalidFederationTokenError):
        await tv.verify_federation_id_token(token)


@pytest.mark.asyncio
async def test_wrong_issuer_rejected(rsa_keypair):
    """A token with an unexpected issuer is rejected (Step 23)."""
    private_key, _pem = rsa_keypair
    _populate_cache_with_key("key-3", private_key)
    token = _make_token(private_key, kid="key-3", iss="https://not-erp-main.example.com")

    with pytest.raises(tv.InvalidFederationTokenError):
        await tv.verify_federation_id_token(token)


@pytest.mark.asyncio
async def test_expired_token_rejected(rsa_keypair):
    """An expired token is rejected."""
    private_key, _pem = rsa_keypair
    _populate_cache_with_key("key-4", private_key)
    now = datetime.now(timezone.utc)
    token = _make_token(private_key, kid="key-4", iat=now - timedelta(minutes=20), exp=now - timedelta(minutes=10))

    with pytest.raises(tv.InvalidFederationTokenError):
        await tv.verify_federation_id_token(token)


@pytest.mark.asyncio
async def test_wrong_token_type_rejected(rsa_keypair):
    """A token that isn't type=federation_id_token is rejected, even if otherwise perfectly valid."""
    private_key, _pem = rsa_keypair
    _populate_cache_with_key("key-5", private_key)
    token = _make_token(private_key, kid="key-5", type="some_other_token_type")

    with pytest.raises(tv.InvalidFederationTokenError):
        await tv.verify_federation_id_token(token)


@pytest.mark.asyncio
async def test_signature_from_wrong_key_rejected(rsa_keypair):
    """A token signed by a DIFFERENT private key than the one published under its kid is rejected."""
    private_key, _pem = rsa_keypair
    _populate_cache_with_key("key-6", private_key)

    # Sign with a completely different keypair, but claim the legitimate kid.
    other_private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    token = _make_token(other_private_key, kid="key-6")

    with pytest.raises(tv.InvalidFederationTokenError):
        await tv.verify_federation_id_token(token)


@pytest.mark.asyncio
async def test_unknown_kid_rejected(rsa_keypair, monkeypatch):
    """A token referencing a kid not present in the (refreshed) JWKS is rejected, not silently accepted."""
    private_key, _pem = rsa_keypair
    _populate_cache_with_key("key-7", private_key)

    # Force the cache to appear stale so a refresh is attempted; patch the
    # refresh to simulate ERP_Main's JWKS no longer containing this kid
    # (e.g. it was retired) rather than actually hitting the network.
    async def _fake_refresh(self):
        self._keys_by_kid = {}
        self._fetched_at = time.monotonic()

    monkeypatch.setattr(tv._JwksCache, "_refresh", _fake_refresh)
    # Force staleness relative to `time.monotonic()`'s own arbitrary epoch
    # (process start, roughly) -- NOT 0.0, which is only "long ago" once
    # the process has been alive longer than the cache TTL, making that
    # version of this test pass or fail depending on how long pytest's
    # own process had already been running (a real bug this test itself
    # had, found and fixed here).
    tv._jwks_cache._fetched_at = time.monotonic() - (settings.FEDERATION_JWKS_CACHE_TTL_SECONDS + 1)

    token = _make_token(private_key, kid="key-7")
    with pytest.raises(tv.InvalidFederationTokenError):
        await tv.verify_federation_id_token(token)


@pytest.mark.asyncio
async def test_malformed_token_rejected():
    """A garbage string is rejected cleanly, not with an unhandled exception."""
    with pytest.raises(tv.InvalidFederationTokenError):
        await tv.verify_federation_id_token("not-a-real-jwt-at-all")


@pytest.mark.asyncio
async def test_missing_client_id_configuration_rejected(rsa_keypair, monkeypatch):
    """If this ERP has no FEDERATION_CLIENT_ID configured, verification refuses to proceed at all."""
    monkeypatch.setattr(settings, "FEDERATION_CLIENT_ID", "")
    private_key, _pem = rsa_keypair
    _populate_cache_with_key("key-8", private_key)
    token = _make_token(private_key, kid="key-8")

    with pytest.raises(tv.InvalidFederationTokenError):
        await tv.verify_federation_id_token(token)
