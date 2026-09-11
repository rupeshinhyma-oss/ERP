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

    # Phase 4: Global User authentication (Step 40)
    GLOBAL_USER_REGISTERED = "GLOBAL_USER_REGISTERED"
    GLOBAL_LOGIN_SUCCESS = "GLOBAL_LOGIN_SUCCESS"
    GLOBAL_LOGIN_FAILURE = "GLOBAL_LOGIN_FAILURE"
    GLOBAL_LOGOUT = "GLOBAL_LOGOUT"
    GLOBAL_PASSWORD_CHANGED = "GLOBAL_PASSWORD_CHANGED"
    GLOBAL_PASSWORD_RESET_REQUESTED = "GLOBAL_PASSWORD_RESET_REQUESTED"
    GLOBAL_PASSWORD_RESET_COMPLETED = "GLOBAL_PASSWORD_RESET_COMPLETED"
    GLOBAL_SESSION_REVOKED = "GLOBAL_SESSION_REVOKED"

    # Phase 4: Federation (Steps 40-41)
    FEDERATION_STARTED = "FEDERATION_STARTED"
    FEDERATION_SUCCESS = "FEDERATION_SUCCESS"
    FEDERATION_FAILURE = "FEDERATION_FAILURE"
    ERP_SESSION_CREATED = "ERP_SESSION_CREATED"
    ERP_SESSION_REJECTED = "ERP_SESSION_REJECTED"
    TOKEN_ISSUED = "TOKEN_ISSUED"
    TOKEN_REFRESHED = "TOKEN_REFRESHED"
    TOKEN_REVOKED = "TOKEN_REVOKED"
    MEMBERSHIP_ACCESS_DENIED = "MEMBERSHIP_ACCESS_DENIED"

    # Phase 4: Federation client / signing-key lifecycle
    FEDERATION_CLIENT_REGISTERED = "FEDERATION_CLIENT_REGISTERED"
    FEDERATION_CLIENT_UPDATED = "FEDERATION_CLIENT_UPDATED"
    SIGNING_KEY_GENERATED = "SIGNING_KEY_GENERATED"
    SIGNING_KEY_RETIRED = "SIGNING_KEY_RETIRED"

    # Phase 4: security events worth flagging to admins (Step 41)
    SECURITY_INVALID_REDIRECT_URI = "SECURITY_INVALID_REDIRECT_URI"
    SECURITY_INVALID_STATE = "SECURITY_INVALID_STATE"
    SECURITY_INVALID_NONCE = "SECURITY_INVALID_NONCE"
    SECURITY_INVALID_AUDIENCE = "SECURITY_INVALID_AUDIENCE"
    SECURITY_INVALID_ISSUER = "SECURITY_INVALID_ISSUER"
    SECURITY_EXPIRED_TOKEN = "SECURITY_EXPIRED_TOKEN"
    SECURITY_INVALID_CLIENT = "SECURITY_INVALID_CLIENT"
    SECURITY_REPLAY_ATTEMPT = "SECURITY_REPLAY_ATTEMPT"

    # Phase 5: Platform Authorization (RBAC for GlobalUsers)
    PLATFORM_ROLE_CREATED = "PLATFORM_ROLE_CREATED"
    PLATFORM_ROLE_UPDATED = "PLATFORM_ROLE_UPDATED"
    PLATFORM_PERMISSION_CREATED = "PLATFORM_PERMISSION_CREATED"
    PLATFORM_ROLE_PERMISSION_GRANTED = "PLATFORM_ROLE_PERMISSION_GRANTED"
    PLATFORM_ROLE_PERMISSION_REVOKED = "PLATFORM_ROLE_PERMISSION_REVOKED"
    PLATFORM_ROLE_ASSIGNED = "PLATFORM_ROLE_ASSIGNED"
    PLATFORM_ROLE_REVOKED = "PLATFORM_ROLE_REVOKED"
    PLATFORM_AUTHORIZATION_DENIED = "PLATFORM_AUTHORIZATION_DENIED"

    # Phase 6: Cross-ERP Integration Events
    INTEGRATION_EVENT_RECEIVED = "INTEGRATION_EVENT_RECEIVED"
    INTEGRATION_EVENT_DUPLICATE = "INTEGRATION_EVENT_DUPLICATE"
    INTEGRATION_EVENT_ROUTED = "INTEGRATION_EVENT_ROUTED"
    INTEGRATION_EVENT_DEAD_LETTERED = "INTEGRATION_EVENT_DEAD_LETTERED"
    INTEGRATION_EVENT_REPLAYED = "INTEGRATION_EVENT_REPLAYED"
    INTEGRATION_SUBSCRIPTION_CREATED = "INTEGRATION_SUBSCRIPTION_CREATED"
    INTEGRATION_SUBSCRIPTION_UPDATED = "INTEGRATION_SUBSCRIPTION_UPDATED"
    INTEGRATION_ENTITY_MAPPING_CREATED = "INTEGRATION_ENTITY_MAPPING_CREATED"

    # Phase 7: Global Reporting, Search & Reconciliation
    RECONCILIATION_EXECUTED = "RECONCILIATION_EXECUTED"
    PROJECTION_REBUILD_EXECUTED = "PROJECTION_REBUILD_EXECUTED"
    REPORT_EXPORT_REQUESTED = "REPORT_EXPORT_REQUESTED"

    # Bidirectional Identity Linking (Prompt 2)
    GLOBAL_USER_LINKED = "GLOBAL_USER_LINKED"
    GLOBAL_USER_UNLINKED = "GLOBAL_USER_UNLINKED"
    LOCAL_USER_PROVISIONED = "LOCAL_USER_PROVISIONED"
    IDENTITY_MATCH_DETECTED = "IDENTITY_MATCH_DETECTED"
    IDENTITY_CONFLICT_CREATED = "IDENTITY_CONFLICT_CREATED"
    IDENTITY_CONFLICT_RESOLVED = "IDENTITY_CONFLICT_RESOLVED"
    IDENTITY_LINK_REJECTED = "IDENTITY_LINK_REJECTED"

    # Phase 8A: Entity Synchronization Policy Registry
    SYNC_POLICY_CREATED = "SYNC_POLICY_CREATED"
    SYNC_POLICY_UPDATED = "SYNC_POLICY_UPDATED"
    SYNC_POLICY_STATE_CHANGED = "SYNC_POLICY_STATE_CHANGED"


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
