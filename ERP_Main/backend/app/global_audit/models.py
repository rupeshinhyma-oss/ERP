"""
Global Audit Log ORM Model.

Owns the `global_audit_logs` table: an immutable, append-only record of
every security-sensitive control-plane action (Phase 3 Step 41). This is
control-plane audit only -- it has no relationship to, and never receives
events from, Yinglima's or Inhyma's own local `audit` modules, which
continue to own their own business-data audit trails exactly as before.

Design choices
--------------
- **Append-only.** No `update`/`delete` method exists anywhere in
  `service.py` for this table -- a row, once written, is never modified.
- **No secrets ever recorded.** Enforced by convention at every call site
  (`service.py` docstrings name exactly what each event records), not by
  a runtime scrubber -- because scrubbing after the fact is a much weaker
  guarantee than "the caller never had a secret in scope to log in the
  first place" (see `app.service_identity`, which never holds a
  plaintext secret past the moment it's returned to the caller).
"""

from __future__ import annotations

import uuid
from enum import Enum

from sqlalchemy import JSON, ForeignKey, String
from sqlalchemy import Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column

from app.database.base import GUID, Base, TimestampMixin, UUIDPrimaryKeyMixin


class AuditActorType(str, Enum):
    """
    Distinguishes who/what performed an audited action (Phase 3 Step 42).

    This matters because a heartbeat or service-driven registration
    updates control-plane state exactly like a human admin action does,
    but carries very different trust/authorization implications -- a
    reviewer looking at the log needs to know at a glance which is which.
    """

    HUMAN_ADMIN = "HUMAN_ADMIN"
    ERP_SERVICE = "ERP_SERVICE"
    SYSTEM = "SYSTEM"


class AuditEventType(str, Enum):
    """Controlled vocabulary of auditable control-plane events (Phase 3 Step 41)."""

    ERP_REGISTERED = "ERP_REGISTERED"
    ERP_UPDATED = "ERP_UPDATED"
    ERP_STATUS_CHANGED = "ERP_STATUS_CHANGED"
    ERP_DECOMMISSIONED = "ERP_DECOMMISSIONED"

    ERP_CREDENTIAL_CREATED = "ERP_CREDENTIAL_CREATED"
    ERP_CREDENTIAL_ROTATED = "ERP_CREDENTIAL_ROTATED"
    ERP_CREDENTIAL_REVOKED = "ERP_CREDENTIAL_REVOKED"

    GLOBAL_USER_CREATED = "GLOBAL_USER_CREATED"
    GLOBAL_USER_UPDATED = "GLOBAL_USER_UPDATED"
    GLOBAL_USER_SUSPENDED = "GLOBAL_USER_SUSPENDED"

    MEMBERSHIP_CREATED = "MEMBERSHIP_CREATED"
    MEMBERSHIP_VERIFIED = "MEMBERSHIP_VERIFIED"
    MEMBERSHIP_SUSPENDED = "MEMBERSHIP_SUSPENDED"
    MEMBERSHIP_RESTORED = "MEMBERSHIP_RESTORED"
    MEMBERSHIP_REVOKED = "MEMBERSHIP_REVOKED"

    CAPABILITY_UPDATED = "CAPABILITY_UPDATED"

    PLATFORM_ADMIN_CREATED = "PLATFORM_ADMIN_CREATED"
    PLATFORM_ADMIN_LOGIN_SUCCEEDED = "PLATFORM_ADMIN_LOGIN_SUCCEEDED"
    PLATFORM_ADMIN_LOGIN_FAILED = "PLATFORM_ADMIN_LOGIN_FAILED"

    ERP_HEARTBEAT_RECEIVED = "ERP_HEARTBEAT_RECEIVED"


class GlobalAuditLog(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """A single immutable control-plane audit entry."""

    __tablename__ = "global_audit_logs"

    event_type: Mapped[AuditEventType] = mapped_column(
        SAEnum(AuditEventType, name="audit_event_type", native_enum=False, length=50), nullable=False, index=True
    )
    actor_type: Mapped[AuditActorType] = mapped_column(
        SAEnum(AuditActorType, name="audit_actor_type", native_enum=False, length=20), nullable=False, index=True
    )
    actor_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(),
        nullable=True,
        index=True,
        doc="The PlatformAdmin.id or ErpInstance.id responsible, when actor_type identifies one. "
        "Null for actor_type=SYSTEM.",
    )
    actor_label: Mapped[str | None] = mapped_column(
        String(200), nullable=True, doc="Human-readable actor label (email or ERP key) captured at write time."
    )
    target_type: Mapped[str | None] = mapped_column(
        String(50), nullable=True, index=True, doc="Kind of entity affected, e.g. 'erp_instance', 'global_user'."
    )
    target_id: Mapped[uuid.UUID | None] = mapped_column(GUID(), nullable=True, index=True)
    details: Mapped[dict | None] = mapped_column(
        JSON, nullable=True, doc="Non-secret structured context, e.g. {'old_status': 'ACTIVE', 'new_status': ...}."
    )

    def __repr__(self) -> str:
        """Return a debug-friendly representation."""
        return f"<GlobalAuditLog event_type={self.event_type.value} actor_type={self.actor_type.value}>"
