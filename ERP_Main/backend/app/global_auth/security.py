"""
Global Authentication Security Primitives.

Password hashing/validation (Argon2id, mirroring Yinglima_ERP's own
`app.auth.security` policy shape) and short-lived access-token issuance
for Global Users. Uses its own signing secret (`GLOBAL_AUTH_JWT_SECRET_KEY`),
distinct from `PLATFORM_JWT_SECRET_KEY` (platform admins) and from the
RSA keys in `app.federation` (federation tokens issued to ERPs) -- three
separate signing domains for three separate purposes, so a token from one
can never be replayed as another.
"""

from __future__ import annotations

import re
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerifyMismatchError

from app.core.config import settings

_password_hasher = PasswordHasher()

_SPECIAL_CHARS_PATTERN = re.compile(r"[!@#$%^&*()\-_=+\[\]{};:'\",.<>/?\\|`~]")


def hash_password(plain_password: str) -> str:
    """Hash a plaintext password with Argon2id."""
    return _password_hasher.hash(plain_password)


def verify_password(plain_password: str, password_hash: str) -> bool:
    """Verify a plaintext password against a stored Argon2 hash, without raising on mismatch."""
    try:
        return _password_hasher.verify(password_hash, plain_password)
    except (VerifyMismatchError, InvalidHashError):
        return False


def validate_password_strength(password: str) -> list[str]:
    """Validate a plaintext password against the configured policy (Phase 4 Step 10)."""
    violations: list[str] = []
    if len(password) < settings.GLOBAL_PASSWORD_MIN_LENGTH:
        violations.append(f"Password must be at least {settings.GLOBAL_PASSWORD_MIN_LENGTH} characters long.")
    if settings.GLOBAL_PASSWORD_REQUIRE_UPPERCASE and not re.search(r"[A-Z]", password):
        violations.append("Password must contain at least one uppercase letter.")
    if settings.GLOBAL_PASSWORD_REQUIRE_LOWERCASE and not re.search(r"[a-z]", password):
        violations.append("Password must contain at least one lowercase letter.")
    if settings.GLOBAL_PASSWORD_REQUIRE_DIGIT and not re.search(r"\d", password):
        violations.append("Password must contain at least one digit.")
    if settings.GLOBAL_PASSWORD_REQUIRE_SPECIAL and not _SPECIAL_CHARS_PATTERN.search(password):
        violations.append("Password must contain at least one special character.")
    return violations


@dataclass(frozen=True)
class IssuedGlobalToken:
    """The encoded JWT string plus its expiry, for a Global User's session access token."""

    token: str
    expires_at: datetime


class InvalidGlobalTokenError(Exception):
    """Raised when a Global User access token fails signature verification, has expired, or is malformed."""


def create_global_access_token(*, global_user_id: uuid.UUID, session_id: uuid.UUID) -> IssuedGlobalToken:
    """
    Issue a short-lived Global User session access token.

    `jti` carries the `GlobalSession.id` so `verify_global_access_token`'s
    caller can look up the session row and check `revoked_at`/`expires_at`
    there -- the JWT's own `exp` is a ceiling, not the sole source of
    truth, which is what makes the session actually revocable (Step 12).
    """
    now = datetime.now(timezone.utc)
    expires_at = now + timedelta(minutes=settings.GLOBAL_ACCESS_TOKEN_EXPIRE_MINUTES)
    payload: dict[str, Any] = {
        "sub": str(global_user_id),
        "jti": str(session_id),
        "iat": now,
        "exp": expires_at,
        "iss": settings.GLOBAL_AUTH_JWT_ISSUER,
        "type": "global_access",
    }
    token = jwt.encode(payload, settings.GLOBAL_AUTH_JWT_SECRET_KEY, algorithm=settings.GLOBAL_AUTH_JWT_ALGORITHM)
    return IssuedGlobalToken(token=token, expires_at=expires_at)


def decode_global_access_token(token: str) -> dict[str, Any]:
    """Decode and verify a Global User access token, enforcing signature, expiry, issuer, and token type."""
    try:
        payload = jwt.decode(
            token,
            settings.GLOBAL_AUTH_JWT_SECRET_KEY,
            algorithms=[settings.GLOBAL_AUTH_JWT_ALGORITHM],
            issuer=settings.GLOBAL_AUTH_JWT_ISSUER,
            options={"require": ["exp", "iat", "sub", "jti", "type"]},
        )
    except jwt.PyJWTError as exc:
        raise InvalidGlobalTokenError(str(exc)) from exc

    if payload.get("type") != "global_access":
        raise InvalidGlobalTokenError(f"Expected a global_access token, got {payload.get('type')!r}.")
    return payload
