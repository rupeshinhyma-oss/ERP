"""
Federation Token Security Primitives.

Issues and decodes the RS256-signed federation ID tokens ERP_Main hands
to Yinglima/Inhyma after a successful authorization-code exchange (Phase
4 Steps 13-15, 22-23), and verifies PKCE code verifiers (Step 21).

Claims are deliberately minimal (Step 13): `iss`, `sub` (the GlobalUser's
own id -- Step 14, never email), `aud` (the target ERP's `client_id` --
Step 15), `exp`, `iat`, `jti`, and `nonce` if the authorization request
carried one. No local RBAC permission tree, no password, no unnecessary
personal data ever goes into this token.
"""

from __future__ import annotations

import base64
import hashlib
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any

import jwt

from app.core.config import settings
from app.federation.key_manager import SigningKeyManager


class InvalidFederationTokenError(Exception):
    """Raised when a federation ID token fails signature verification, has expired, or is malformed."""


@dataclass(frozen=True)
class IssuedIdToken:
    """The encoded RS256 ID token string plus its expiry and jti."""

    token: str
    jti: str
    expires_at: datetime


async def create_id_token(
    *,
    key_manager: SigningKeyManager,
    global_user_id: uuid.UUID,
    audience_client_id: str,
    nonce: str | None,
) -> IssuedIdToken:
    """
    Sign a new federation ID token with the current ACTIVE signing key.

    `kid` is embedded in the JWT header (not a claim) so a verifying ERP
    can pick the right JWKS entry without first decoding/trusting the
    payload -- standard JWS/JWKS practice.
    """
    active_key = await key_manager.ensure_active_key()
    private_pem = key_manager.load_private_key_pem(active_key.kid)

    now = datetime.now(timezone.utc)
    expires_at = now + timedelta(minutes=settings.FEDERATION_ID_TOKEN_EXPIRE_MINUTES)
    jti = uuid.uuid4().hex

    payload: dict[str, Any] = {
        "iss": settings.FEDERATION_ISSUER,
        "sub": str(global_user_id),
        "aud": audience_client_id,
        "exp": expires_at,
        "iat": now,
        "jti": jti,
        "type": "federation_id_token",
    }
    if nonce is not None:
        payload["nonce"] = nonce

    token = jwt.encode(payload, private_pem, algorithm=active_key.algorithm, headers={"kid": active_key.kid})
    return IssuedIdToken(token=token, jti=jti, expires_at=expires_at)


async def decode_id_token(
    token: str, *, key_manager: SigningKeyManager, expected_audience: str
) -> dict[str, Any]:
    """
    Decode and verify a federation ID token (for ERP_Main's own internal use, e.g. tests/introspection).

    Real verification by Yinglima/Inhyma happens in THEIR OWN codebases
    against ERP_Main's public JWKS endpoint, independently -- this
    function exists so ERP_Main itself (and this test suite) can verify
    a token the same way an ERP would, without duplicating logic.
    Validates: signature (via the kid-selected public key), issuer,
    audience, expiration, and token type (Phase 4 Step 23).
    """
    try:
        unverified_header = jwt.get_unverified_header(token)
    except jwt.PyJWTError as exc:
        raise InvalidFederationTokenError(f"Malformed token header: {exc}") from exc

    kid = unverified_header.get("kid")
    if not kid:
        raise InvalidFederationTokenError("Token header is missing 'kid'.")

    try:
        public_pem = key_manager.load_public_key_pem(kid)
    except FileNotFoundError as exc:
        raise InvalidFederationTokenError(f"Unknown signing key kid={kid!r}.") from exc

    try:
        payload = jwt.decode(
            token,
            public_pem,
            algorithms=["RS256"],
            issuer=settings.FEDERATION_ISSUER,
            audience=expected_audience,
            options={"require": ["exp", "iat", "iss", "aud", "sub", "jti", "type"]},
        )
    except jwt.PyJWTError as exc:
        raise InvalidFederationTokenError(str(exc)) from exc

    if payload.get("type") != "federation_id_token":
        raise InvalidFederationTokenError(f"Expected a federation_id_token, got {payload.get('type')!r}.")

    return payload


def verify_pkce(*, code_verifier: str, code_challenge: str, method: str) -> bool:
    """
    Verify a PKCE code_verifier against its stored code_challenge (Phase 4 Step 21).

    Only S256 is accepted -- `plain` is explicitly rejected regardless of
    what the caller claims `method` is, per the brief's own instruction
    ("Do not use plain PKCE").
    """
    if method != "S256":
        return False
    digest = hashlib.sha256(code_verifier.encode("ascii")).digest()
    computed_challenge = base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")
    return computed_challenge == code_challenge
