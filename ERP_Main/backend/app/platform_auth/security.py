"""
Platform Admin Security Primitives.

Pure, framework-agnostic functions for password hashing/verification and
JWT issuance/decoding for the control plane's human administrators.
Mirrors the shape of Yinglima_ERP's `app.auth.security`, using a
completely separate signing secret (`PLATFORM_JWT_SECRET_KEY`) so a
platform-admin token can never be confused with, or verified against, any
local ERP's own JWTs.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerifyMismatchError

from app.core.config import settings

_password_hasher = PasswordHasher()


def hash_password(plain_password: str) -> str:
    """Hash a plaintext password with Argon2id. Never call this with an already-hashed value."""
    return _password_hasher.hash(plain_password)


def verify_password(plain_password: str, password_hash: str) -> bool:
    """Verify a plaintext password against a stored Argon2 hash, without raising on mismatch."""
    try:
        return _password_hasher.verify(password_hash, plain_password)
    except (VerifyMismatchError, InvalidHashError):
        return False


@dataclass(frozen=True)
class IssuedPlatformToken:
    """The encoded JWT string plus its expiry, for a platform-admin session token."""

    token: str
    expires_at: datetime


class InvalidPlatformTokenError(Exception):
    """Raised when a platform-admin JWT fails signature verification, has expired, or is malformed."""


def create_platform_access_token(admin_id: uuid.UUID, *, role: str) -> IssuedPlatformToken:
    """
    Issue a short-lived control-plane session token for a platform admin.

    The `role` claim is a read-through cache of `PlatformAdmin.role` at
    issuance time, exactly as Yinglima's `perms` claim caches permissions
    -- the database row remains the source of truth; a role change takes
    effect on the admin's next login, which is an acceptable trade-off for
    a short (60-minute default) token lifetime on a low-traffic admin
    console.
    """
    now = datetime.now(timezone.utc)
    expires_at = now + timedelta(minutes=settings.PLATFORM_ACCESS_TOKEN_EXPIRE_MINUTES)
    payload: dict[str, Any] = {
        "sub": str(admin_id),
        "role": role,
        "iat": now,
        "exp": expires_at,
        "iss": settings.PLATFORM_JWT_ISSUER,
        "type": "platform_access",
    }
    token = jwt.encode(payload, settings.PLATFORM_JWT_SECRET_KEY, algorithm=settings.PLATFORM_JWT_ALGORITHM)
    return IssuedPlatformToken(token=token, expires_at=expires_at)


def decode_platform_access_token(token: str) -> dict[str, Any]:
    """Decode and verify a platform-admin JWT, enforcing signature, expiry, issuer, and token type."""
    try:
        payload = jwt.decode(
            token,
            settings.PLATFORM_JWT_SECRET_KEY,
            algorithms=[settings.PLATFORM_JWT_ALGORITHM],
            issuer=settings.PLATFORM_JWT_ISSUER,
            options={"require": ["exp", "iat", "sub", "type"]},
        )
    except jwt.PyJWTError as exc:
        raise InvalidPlatformTokenError(str(exc)) from exc

    if payload.get("type") != "platform_access":
        raise InvalidPlatformTokenError(f"Expected a platform_access token, got {payload.get('type')!r}.")

    return payload
