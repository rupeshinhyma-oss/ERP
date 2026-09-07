"""
ERP Service Credential ORM Model.

Owns the `erp_service_credentials` table: machine-to-machine credentials
that let an ERP's own backend (not a human) authenticate to ERP_Main --
for the heartbeat endpoint today, and for any future service-to-service
call (e.g. local-user verification, Phase 3 Step 36).

Security model (Phase 3 Steps 22-25)
-------------------------------------
- A credential belongs to exactly one `ErpInstance`, never to a
  GlobalUser or a PlatformAdmin -- humans and ERP servers are different
  security principals (Step 22), and this table is how that's expressed:
  there's simply no column here that could point at a person.
- The plaintext secret is generated once, returned to the caller exactly
  once (at creation/rotation time, in the API response only -- never
  logged, never in `global_audit_logs.details`), and never stored.
- Only `secret_hash` (Argon2id, peppered with `settings.
  SERVICE_CREDENTIAL_PEPPER`) is persisted. See `security.py`.
- `revoked_at` is how a credential is invalidated -- rows are never
  deleted, so "when was this credential revoked and by whom" stays
  answerable from the row itself plus the audit log.
- Multiple credentials can exist per ERP (old + new, during a rotation
  window) -- `is_active` on each row is what verification actually
  checks, not "the one credential this ERP has".
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.base import GUID, Base, TimestampMixin, UUIDPrimaryKeyMixin
from app.erp_registry.models import ErpInstance


class ErpServiceCredential(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """A single machine credential belonging to one ERP instance."""

    __tablename__ = "erp_service_credentials"

    erp_instance_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("erp_instances.id", ondelete="CASCADE"), nullable=False, index=True
    )
    credential_identifier: Mapped[str] = mapped_column(
        String(50),
        unique=True,
        nullable=False,
        index=True,
        doc="Short public identifier included in the bearer value so verification can look up the "
        "right row's hash directly, instead of scanning/re-hashing against every credential in the "
        "table. Not secret by itself -- knowing it grants nothing without the secret half.",
    )
    secret_hash: Mapped[str] = mapped_column(
        String(255), nullable=False, doc="Argon2id hash of the secret, peppered. The plaintext is never stored."
    )
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    erp_instance: Mapped[ErpInstance] = relationship()

    @property
    def is_active(self) -> bool:
        """Return True if this credential is currently usable (not revoked, not expired)."""
        if self.revoked_at is not None:
            return False
        if self.expires_at is not None:
            expires_at = self.expires_at
            if expires_at.tzinfo is None:
                expires_at = expires_at.replace(tzinfo=timezone.utc)
            if expires_at <= datetime.now(timezone.utc):
                return False
        return True

    def __repr__(self) -> str:
        """Return a debug-friendly representation (never includes the secret hash)."""
        return f"<ErpServiceCredential id={self.id} erp_instance_id={self.erp_instance_id}>"
