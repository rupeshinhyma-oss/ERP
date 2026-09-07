"""
ERP Service Credential Security Primitives.

Pure, framework-agnostic functions for generating, hashing, and verifying
ERP service credentials (Phase 3 Steps 23-25).

Format
------
A full bearer credential looks like:

    <credential_identifier>.<secret>

`credential_identifier` (public, stored in plaintext, unique) lets
verification fetch the right `ErpServiceCredential` row directly by an
indexed lookup instead of re-hashing against every stored credential in
the table. `secret` (never stored) is the actual proof of possession --
only its peppered Argon2id hash is persisted, and verification re-hashes
the caller's claimed secret and compares.
"""

from __future__ import annotations

import secrets

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerifyMismatchError

from app.core.config import settings

_password_hasher = PasswordHasher()

_IDENTIFIER_BYTES = 9  # -> 12 base64url chars, plenty of entropy for a non-secret lookup key
_SECRET_BYTES = 32  # -> 43 base64url chars of the actual secret material


def generate_credential_identifier() -> str:
    """Generate a new, non-secret, unique-enough public credential identifier."""
    return secrets.token_urlsafe(_IDENTIFIER_BYTES)


def generate_service_secret() -> str:
    """Generate a new, cryptographically random plaintext service secret."""
    return secrets.token_urlsafe(_SECRET_BYTES)


def hash_service_secret(plain_secret: str) -> str:
    """
    Hash a plaintext service secret with Argon2id, peppered.

    The pepper (`settings.SERVICE_CREDENTIAL_PEPPER`, a server-side-only
    value never stored alongside the hash) is concatenated before
    hashing, so a stolen database dump alone is insufficient to verify
    guesses against these hashes -- the attacker would also need the
    pepper, which lives only in server configuration.
    """
    return _password_hasher.hash(plain_secret + settings.SERVICE_CREDENTIAL_PEPPER)


def verify_service_secret(plain_secret: str, secret_hash: str) -> bool:
    """Verify a plaintext service secret against a stored peppered Argon2 hash, without raising on mismatch."""
    try:
        return _password_hasher.verify(secret_hash, plain_secret + settings.SERVICE_CREDENTIAL_PEPPER)
    except (VerifyMismatchError, InvalidHashError):
        return False


def split_bearer_credential(bearer_value: str) -> tuple[str, str] | None:
    """
    Split a `<credential_identifier>.<secret>` bearer value into its two parts.

    Returns None (rather than raising) on malformed input, so callers can
    treat "malformed" and "invalid" identically as an authentication
    failure without a separate exception-handling path.
    """
    parts = bearer_value.split(".", 1)
    if len(parts) != 2 or not parts[0] or not parts[1]:
        return None
    return parts[0], parts[1]
