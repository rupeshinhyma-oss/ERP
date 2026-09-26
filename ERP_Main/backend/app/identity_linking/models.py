"""
Identity Conflict & Linking ORM Models (Prompt 2).

Owns the `identity_conflicts` table for tracking ambiguous or conflicting
identity matches requiring administrator decision.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from enum import Enum

from sqlalchemy import JSON, DateTime, ForeignKey, Index, Integer, String
from sqlalchemy import Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.base import GUID, Base, TimestampMixin, UUIDPrimaryKeyMixin
from app.erp_memberships.models import ErpMembership
from app.erp_registry.models import ErpInstance
from app.global_users.models import GlobalUser
from app.platform_auth.models import PlatformAdmin



class ConflictStatus(str, Enum):
    """Lifecycle status of an identity conflict."""

    PENDING = "PENDING"
    RESOLVED = "RESOLVED"
    REJECTED = "REJECTED"


class ConflictType(str, Enum):
    """Reason the identity could not be automatically linked."""

    AMBIGUOUS_MATCH = "AMBIGUOUS_MATCH"
    CONFLICT = "CONFLICT"


class IdentityConflict(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """A record of an ambiguous or conflicting identity link requiring operator resolution."""

    __tablename__ = "identity_conflicts"

    erp_instance_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("erp_instances.id", ondelete="CASCADE"), nullable=False, index=True
    )
    local_user_id: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    normalized_email: Mapped[str] = mapped_column(String(255), nullable=False, index=True)

    status: Mapped[ConflictStatus] = mapped_column(
        SAEnum(ConflictStatus, name="conflict_status", native_enum=False, length=20),
        default=ConflictStatus.PENDING,
        nullable=False,
        index=True,
    )
    conflict_type: Mapped[ConflictType] = mapped_column(
        SAEnum(ConflictType, name="conflict_type", native_enum=False, length=20),
        nullable=False,
    )

    candidate_global_user_ids: Mapped[list[str]] = mapped_column(
        JSON, default=list, nullable=False, doc="List of candidate GlobalUser UUID strings."
    )
    details_json: Mapped[dict | None] = mapped_column(
        JSON, nullable=True, doc="Original event payload and conflict diagnostic metadata."
    )

    resolution_action: Mapped[str | None] = mapped_column(String(50), nullable=True)
    resolved_by: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("platform_admins.id", ondelete="SET NULL"), nullable=True
    )
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    erp_instance: Mapped[ErpInstance] = relationship()
    resolver: Mapped[PlatformAdmin | None] = relationship()

    def __repr__(self) -> str:
        return (
            f"<IdentityConflict id={self.id} erp_id={self.erp_instance_id} "
            f"local_user={self.local_user_id!r} email={self.normalized_email!r} status={self.status.value}>"
        )


class ProvisioningTaskStatus(str, Enum):
    """Lifecycle status of a background provisioning reconciliation task (Phase 8)."""

    PENDING_RETRY = "PENDING_RETRY"
    PROCESSING = "PROCESSING"
    SUCCEEDED = "SUCCEEDED"
    FAILED = "FAILED"
    CANCELLED = "CANCELLED"


class ProvisioningReconciliationTask(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """
    Durable background reconciliation task for ERP membership provisioning (Phase 8).

    Tracks retry schedules, leases/claims across distributed workers, attempt counts,
    and failure diagnostics without depending on in-memory state or external queues.
    """

    __tablename__ = "provisioning_reconciliation_tasks"
    __table_args__ = (
        Index("ix_prov_recon_eligible", "status", "next_retry_at", "lease_expires_at"),
    )

    membership_id: Mapped[uuid.UUID] = mapped_column(
        GUID(),
        ForeignKey("erp_memberships.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
        index=True,
        doc="The ERP membership requiring background provisioning recovery.",
    )
    global_user_id: Mapped[uuid.UUID] = mapped_column(
        GUID(),
        ForeignKey("global_users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    erp_instance_id: Mapped[uuid.UUID] = mapped_column(
        GUID(),
        ForeignKey("erp_instances.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    status: Mapped[ProvisioningTaskStatus] = mapped_column(
        SAEnum(ProvisioningTaskStatus, name="provisioning_task_status", native_enum=False, length=20),
        default=ProvisioningTaskStatus.PENDING_RETRY,
        nullable=False,
        index=True,
    )

    retry_count: Mapped[int] = mapped_column(
        Integer,
        default=0,
        nullable=False,
        doc="Number of retry attempts executed so far.",
    )
    max_retries: Mapped[int] = mapped_column(
        Integer,
        default=10,
        nullable=False,
        doc="Upper bound on retry attempts before marking terminal failure.",
    )

    next_retry_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        index=True,
        doc="Earliest timestamp when this task may be claimed by a reconciler worker.",
    )
    last_attempt_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        doc="Timestamp of the most recent provisioning attempt.",
    )

    claimed_by: Mapped[str | None] = mapped_column(
        String(255),
        nullable=True,
        doc="Worker identifier or manual admin principal holding the active lease.",
    )
    claimed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        doc="When the active lease was acquired.",
    )
    lease_expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        index=True,
        doc="When the active lease expires if the worker crashes or hangs.",
    )

    last_error_type: Mapped[str | None] = mapped_column(
        String(100),
        nullable=True,
        doc="Standardized error classification (e.g. ERP_UNREACHABLE, ERP_TIMEOUT).",
    )
    last_error_message: Mapped[str | None] = mapped_column(
        String(1000),
        nullable=True,
        doc="Safe error message for operational diagnostics (secrets scrubbed).",
    )

    membership: Mapped[ErpMembership] = relationship()
    global_user: Mapped[GlobalUser] = relationship()
    erp_instance: Mapped[ErpInstance] = relationship()

    def __repr__(self) -> str:
        return (
            f"<ProvisioningReconciliationTask id={self.id} membership_id={self.membership_id} "
            f"status={self.status.value} retry_count={self.retry_count}>"
        )

