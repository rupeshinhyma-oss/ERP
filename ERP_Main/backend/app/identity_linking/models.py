"""
Identity Conflict & Linking ORM Models (Prompt 2).

Owns the `identity_conflicts` table for tracking ambiguous or conflicting
identity matches requiring administrator decision.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from enum import Enum

from sqlalchemy import JSON, DateTime, ForeignKey, String
from sqlalchemy import Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.base import GUID, Base, TimestampMixin, UUIDPrimaryKeyMixin
from app.erp_registry.models import ErpInstance
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
