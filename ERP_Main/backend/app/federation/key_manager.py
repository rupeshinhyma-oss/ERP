"""
Federation Signing Key Manager.

Generates, persists, loads, and rotates RSA keypairs used to sign
federation tokens (Phase 4 Steps 5-7). Private key material is written
to disk under `settings.FEDERATION_SIGNING_KEY_DIR` as PEM files named
by `kid`; only the `SigningKey` metadata row (status, timestamps) lives
in the database -- the private key itself is never written to any
database table, logged, or returned from any API response.

Rotation model (Step 6): calling `rotate()` generates a new key,
marks it ACTIVE, and demotes the previous ACTIVE key to RETIRING (not
RETIRED) -- a RETIRING key's public key stays in JWKS so tokens it
already signed keep validating until they naturally expire. An operator
(or a scheduled job, not built in this phase) later calls `retire()` on
a RETIRING key once enough time has passed that no token it signed could
still be unexpired, fully removing it from JWKS.
"""

from __future__ import annotations

import base64
import secrets
import uuid
from datetime import datetime, timezone
from pathlib import Path

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.federation.models import SigningKey, SigningKeyStatus
from app.federation.repository import SigningKeyRepository
from app.global_audit.models import AuditActorType, AuditEventType
from app.global_audit.service import GlobalAuditService


def _b64url_uint(value: int) -> str:
    """Base64url-encode a non-negative integer without padding, per RFC 7518 JWK key encoding."""
    byte_length = (value.bit_length() + 7) // 8 or 1
    return base64.urlsafe_b64encode(value.to_bytes(byte_length, "big")).rstrip(b"=").decode("ascii")


def _key_dir() -> Path:
    """Return the signing key directory, creating it if necessary."""
    path = settings.federation_signing_key_path
    path.mkdir(parents=True, exist_ok=True)
    return path


def _private_key_path(kid: str) -> Path:
    """Return the on-disk path for a given key's private key PEM file."""
    return _key_dir() / f"{kid}.private.pem"


def generate_kid() -> str:
    """Generate a new, non-secret, unique-enough key identifier."""
    return f"key-{datetime.now(timezone.utc):%Y%m}-{secrets.token_hex(4)}"


class SigningKeyManager:
    """Generates, persists, loads, and rotates RSA signing keys."""

    def __init__(self, repository: SigningKeyRepository, audit: GlobalAuditService) -> None:
        """Wire the manager to its repository and the global audit service."""
        self.repository = repository
        self.audit = audit

    def _generate_and_store_keypair(self, kid: str) -> None:
        """Generate a new RSA keypair and write only the private key to disk (never to the database)."""
        private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        pem = private_key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.PKCS8,
            encryption_algorithm=serialization.NoEncryption(),
        )
        _private_key_path(kid).write_bytes(pem)

    def load_private_key_pem(self, kid: str) -> bytes:
        """Load a key's private PEM bytes from disk by its `kid`."""
        path = _private_key_path(kid)
        if not path.is_file():
            raise FileNotFoundError(f"No private key file found for kid={kid!r}.")
        return path.read_bytes()

    def load_public_key_pem(self, kid: str) -> bytes:
        """Derive and return a key's public PEM bytes from its on-disk private key."""
        private_pem = self.load_private_key_pem(kid)
        private_key = serialization.load_pem_private_key(private_pem, password=None)
        return private_key.public_key().public_bytes(
            encoding=serialization.Encoding.PEM, format=serialization.PublicFormat.SubjectPublicKeyInfo
        )

    async def ensure_active_key(self) -> SigningKey:
        """Return the current ACTIVE signing key, generating the very first one if none exists yet or if on-disk key is absent."""
        active = await self.repository.get_active()
        if active is not None and _private_key_path(active.kid).is_file():
            return active
        if active is not None:
            # Active key in DB lacks on-disk private PEM (e.g. fresh deployment without committed keys).
            # Retire the orphan key row and generate a fresh active keypair on disk.
            active.status = SigningKeyStatus.RETIRED
            await self.repository.create(active)
        return await self._create_key()

    async def _create_key(self) -> SigningKey:
        """Generate a brand-new keypair and persist its metadata row as ACTIVE."""
        kid = generate_kid()
        self._generate_and_store_keypair(kid)
        key_row = SigningKey(kid=kid, status=SigningKeyStatus.ACTIVE)
        created = await self.repository.create(key_row)
        await self.audit.record(
            event_type=AuditEventType.SIGNING_KEY_GENERATED,
            actor_type=AuditActorType.SYSTEM,
            target_type="federation_signing_key",
            target_id=created.id,
            details={"kid": kid},
        )
        return created

    async def rotate(self, *, actor_id: uuid.UUID | None, actor_label: str) -> SigningKey:
        """
        Generate a new ACTIVE key, demoting the previous ACTIVE key to RETIRING.

        Never invalidates existing sessions/tokens signed by the
        previous key (Step 6) -- RETIRING keys stay in JWKS until
        explicitly `retire()`-d.
        """
        previous_active = await self.repository.get_active()
        new_key = await self._create_key()
        if previous_active is not None and previous_active.id != new_key.id:
            previous_active.status = SigningKeyStatus.RETIRING
            await self.repository.create(previous_active)  # flush + refresh
        await self.audit.record(
            event_type=AuditEventType.SIGNING_KEY_GENERATED,
            actor_type=AuditActorType.HUMAN_ADMIN,
            actor_id=actor_id,
            actor_label=actor_label,
            target_type="federation_signing_key",
            target_id=new_key.id,
            details={"kid": new_key.kid, "action": "rotate"},
        )
        return new_key

    async def retire(self, kid: str, *, actor_id: uuid.UUID | None, actor_label: str) -> SigningKey:
        """Fully retire a RETIRING key, removing its public key from JWKS."""
        key_row = await self.repository.get_by_kid(kid)
        if key_row is None:
            raise FileNotFoundError(f"No signing key found for kid={kid!r}.")
        key_row.status = SigningKeyStatus.RETIRED
        key_row.retired_at = datetime.now(timezone.utc)
        updated = await self.repository.create(key_row)  # flush + refresh
        await self.audit.record(
            event_type=AuditEventType.SIGNING_KEY_RETIRED,
            actor_type=AuditActorType.HUMAN_ADMIN,
            actor_id=actor_id,
            actor_label=actor_label,
            target_type="federation_signing_key",
            target_id=updated.id,
            details={"kid": kid},
        )
        return updated

    async def build_jwks(self) -> dict:
        """Build the JWKS document: every non-RETIRED key's PUBLIC material only (Step 7)."""
        keys = await self.repository.list_publishable()
        jwk_entries = []
        for key_row in keys:
            if not _private_key_path(key_row.kid).is_file():
                continue
            public_pem = self.load_public_key_pem(key_row.kid)
            public_key = serialization.load_pem_public_key(public_pem)
            numbers = public_key.public_numbers()
            jwk_entries.append(
                {
                    "kty": "RSA",
                    "use": "sig",
                    "alg": key_row.algorithm,
                    "kid": key_row.kid,
                    "n": _b64url_uint(numbers.n),
                    "e": _b64url_uint(numbers.e),
                }
            )
        return {"keys": jwk_entries}
