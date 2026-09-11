"""
Federation ORM Models.

Owns three tables for the OIDC-flavored federation layer (Phase 4):

- `federation_signing_keys`: metadata for RSA keypairs used to sign
  federation tokens (Steps 5-7). Private key material lives on disk
  (`app.federation.key_manager`), never in this table.
- `federation_clients`: one row per ERP registered as an OIDC relying
  party (Steps 16-17) -- `client_id`, hashed `client_secret`, registered
  redirect URIs, and a `federation_enabled` flag kept deliberately
  separate from `ErpInstance.status` (Step 38: "ERP status: ACTIVE,
  Federation: DISABLED" must be independently expressible).
- `federation_authorization_requests`: short-lived, single-use rows
  representing one in-flight authorization-code-flow transaction
  (Steps 19-22) -- `state`, `nonce`, PKCE challenge, target client,
  Global User, and the issued authorization code, consumed exactly once
  by the token endpoint.

None of these tables hold any local ERP business data, and
`FederationClient` is a genuinely separate table from `ErpInstance`
(linked by FK) rather than new columns bolted onto it -- client secrets
and redirect URIs are a distinct concern from "does this ERP exist,"
and keeping them separate means `erp_registry`'s existing model/service
(Phase 2, untouched since) never needs to know federation exists.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from enum import Enum

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, String
from sqlalchemy import Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.base import GUID, Base, TimestampMixin, UUIDPrimaryKeyMixin
from app.erp_registry.models import ErpInstance
from app.global_users.models import GlobalUser


class SigningKeyStatus(str, Enum):
    """
    Lifecycle status of a signing key (Phase 4 Step 6).

    ACTIVE: the current key used to sign NEW tokens. Exactly one key
    should be ACTIVE at a time (enforced in `key_manager.py`'s rotation
    logic, not a DB constraint, since "exactly one" is a business rule
    about a mutable set, not a structural one).
    RETIRING: no longer used to sign new tokens, but its public key
    remains published in JWKS so tokens it already signed (which may
    still be unexpired) continue to validate -- this is what makes
    rotation not invalidate every active session at once.
    RETIRED: fully removed from JWKS; kept here only for historical audit.
    """

    ACTIVE = "ACTIVE"
    RETIRING = "RETIRING"
    RETIRED = "RETIRED"


class SigningKey(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """Metadata for one RSA signing keypair. The private key itself lives on disk, never in this table."""

    __tablename__ = "federation_signing_keys"

    kid: Mapped[str] = mapped_column(
        String(50), unique=True, nullable=False, index=True, doc="Key identifier embedded in every token's header."
    )
    status: Mapped[SigningKeyStatus] = mapped_column(
        SAEnum(SigningKeyStatus, name="signing_key_status", native_enum=False, length=20),
        default=SigningKeyStatus.ACTIVE,
        nullable=False,
        index=True,
    )
    algorithm: Mapped[str] = mapped_column(String(20), default="RS256", nullable=False)
    retired_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    def __repr__(self) -> str:
        """Return a debug-friendly representation."""
        return f"<SigningKey kid={self.kid!r} status={self.status.value}>"


class FederationClient(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """
    One ERP registered as an OIDC relying party (federation client).

    `client_secret_hash` is Argon2id, hashed the same way
    `app.service_identity` hashes ERP service credentials (a different
    pepper, `FEDERATION_CLIENT_SECRET_PEPPER`, so the two secret domains
    stay independent) -- the plaintext secret is shown to the operator
    exactly once, at registration/rotation time, then never again.
    """

    __tablename__ = "federation_clients"

    erp_instance_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("erp_instances.id", ondelete="CASCADE"), nullable=False, unique=True, index=True
    )
    client_id: Mapped[str] = mapped_column(String(100), unique=True, nullable=False, index=True)
    client_secret_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    redirect_uris: Mapped[list[str]] = mapped_column(
        JSON, nullable=False, doc="Exact, pre-registered allowed redirect URIs (Phase 4 Step 17). No wildcards."
    )
    federation_enabled: Mapped[bool] = mapped_column(
        Boolean,
        default=False,
        nullable=False,
        doc="Independent of ErpInstance.status (Phase 4 Step 38) -- an ERP can be operationally ACTIVE "
        "with federation still DISABLED, e.g. during rollout.",
    )

    erp_instance: Mapped[ErpInstance] = relationship()

    def __repr__(self) -> str:
        """Return a debug-friendly representation (never includes the client secret hash)."""
        return f"<FederationClient client_id={self.client_id!r} federation_enabled={self.federation_enabled}>"


class AuthorizationRequest(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """
    One in-flight authorization-code-flow transaction (Phase 4 Steps 19-22).

    Created when a Global User selects an ERP to launch
    (`POST /federation/authorize`), consumed exactly once by
    `POST /federation/token` -- `code_used_at` being set makes a second
    use of the same code rejected outright (replay protection, Step 41's
    "replay attempt" security event).
    """

    __tablename__ = "federation_authorization_requests"

    global_user_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("global_users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    federation_client_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("federation_clients.id", ondelete="CASCADE"), nullable=False, index=True
    )
    authorization_code: Mapped[str] = mapped_column(String(100), unique=True, nullable=False, index=True)
    redirect_uri: Mapped[str] = mapped_column(String(500), nullable=False)
    state: Mapped[str] = mapped_column(String(255), nullable=False)
    nonce: Mapped[str | None] = mapped_column(String(255), nullable=True)
    code_challenge: Mapped[str | None] = mapped_column(
        String(255), nullable=True, doc="PKCE code_challenge (Phase 4 Step 21). S256 method only."
    )
    code_challenge_method: Mapped[str | None] = mapped_column(String(10), nullable=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    code_used_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, doc="Set the first (and only allowed) time this code is exchanged."
    )

    global_user: Mapped[GlobalUser] = relationship()
    federation_client: Mapped[FederationClient] = relationship()

    def __repr__(self) -> str:
        """Return a debug-friendly representation."""
        return f"<AuthorizationRequest id={self.id} federation_client_id={self.federation_client_id}>"
