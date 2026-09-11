"""
Federation Token Verification (Relying Party side).

Yinglima acts as an OIDC Relying Party to ERP_Main's Identity Provider
(Phase 4 Step 3). This module fetches and caches ERP_Main's public JWKS,
then verifies incoming federation ID tokens: signature, issuer, audience,
expiration, and token type (Step 23) -- independently, using only the
PUBLIC key material ERP_Main publishes. This ERP never sees, stores, or
needs ERP_Main's private signing key.

Nothing here trusts a claim merely because "ERP_Main issued the request"
(Step 23's own explicit instruction) -- every field is checked every time.
"""

from __future__ import annotations

import time
from typing import Any

import httpx
import jwt
from jwt.algorithms import RSAAlgorithm

from app.core.config import settings


class InvalidFederationTokenError(Exception):
    """Raised when a federation ID token fails any verification check."""


class _JwksCache:
    """A tiny TTL cache for ERP_Main's JWKS document, keyed by `kid`."""

    def __init__(self) -> None:
        """Initialize an empty cache."""
        self._keys_by_kid: dict[str, Any] = {}
        self._fetched_at: float = 0.0

    def _is_stale(self) -> bool:
        """Return True if the cache has never been populated or has exceeded its TTL."""
        return (time.monotonic() - self._fetched_at) > settings.FEDERATION_JWKS_CACHE_TTL_SECONDS

    async def get_public_key(self, kid: str) -> Any:
        """Return the public key object for a given `kid`, refreshing the cache if stale or the kid is unknown."""
        if self._is_stale() or kid not in self._keys_by_kid:
            await self._refresh()
        if kid not in self._keys_by_kid:
            raise InvalidFederationTokenError(f"Unknown signing key kid={kid!r} (not found in ERP_Main's JWKS).")
        return self._keys_by_kid[kid]

    async def _refresh(self) -> None:
        """Fetch the current JWKS document from ERP_Main and rebuild the kid -> public key map."""
        async with httpx.AsyncClient(timeout=10.0) as http_client:
            response = await http_client.get(settings.ERP_MAIN_JWKS_URL)
            response.raise_for_status()
            document = response.json()

        self._keys_by_kid = {jwk["kid"]: RSAAlgorithm.from_jwk(jwk) for jwk in document.get("keys", [])}
        self._fetched_at = time.monotonic()


_jwks_cache = _JwksCache()


async def verify_federation_id_token(token: str) -> dict[str, Any]:
    """
    Verify a federation ID token issued by ERP_Main and return its claims.

    Validates (Phase 4 Step 23): signature (via the kid-selected public
    key from ERP_Main's JWKS), issuer, audience (must equal THIS ERP's
    own `FEDERATION_CLIENT_ID`), expiration, and token type. Raises
    `InvalidFederationTokenError` for every failure mode so callers have
    exactly one exception to handle and never learn which specific check
    failed from the exception alone (fail-closed, Step 53).
    """
    if not settings.FEDERATION_CLIENT_ID:
        raise InvalidFederationTokenError("This ERP has no FEDERATION_CLIENT_ID configured; SSO is not set up.")

    try:
        unverified_header = jwt.get_unverified_header(token)
    except jwt.PyJWTError as exc:
        raise InvalidFederationTokenError(f"Malformed token header: {exc}") from exc

    kid = unverified_header.get("kid")
    if not kid:
        raise InvalidFederationTokenError("Token header is missing 'kid'.")

    try:
        public_key = await _jwks_cache.get_public_key(kid)
    except httpx.HTTPError as exc:
        raise InvalidFederationTokenError(f"Could not fetch ERP_Main's JWKS: {exc}") from exc

    try:
        payload = jwt.decode(
            token,
            public_key,
            algorithms=["RS256"],
            issuer=settings.ERP_MAIN_ISSUER,
            audience=settings.FEDERATION_CLIENT_ID,
            options={"require": ["exp", "iat", "iss", "aud", "sub", "jti", "type"]},
        )
    except jwt.PyJWTError as exc:
        raise InvalidFederationTokenError(str(exc)) from exc

    if payload.get("type") != "federation_id_token":
        raise InvalidFederationTokenError(f"Expected a federation_id_token, got {payload.get('type')!r}.")

    return payload
