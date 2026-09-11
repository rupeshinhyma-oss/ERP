"""
Entity Synchronization Policy ORM Model (Phase 8A).

Defines the control-plane metadata describing how a domain entity synchronizes
across autonomous ERP nodes: authoritative ownership, synchronization direction,
conflict resolution strategy, delete/archive propagation, and version sequencing.

Strict boundary:
- This is CONTROL-PLANE METADATA ONLY.
- It is NOT an integration subscription ("who receives which event").
- It is NOT an entity mapping ("which record maps to which record").
- It does not turn ERP_Main into a runtime event relay.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, ForeignKey, Index, Integer, String, Text
from sqlalchemy import Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.base import GUID, Base, TimestampMixin, UUIDPrimaryKeyMixin
from app.sync_policy.enums import (
    SyncConflictStrategy,
    SyncDeleteStrategy,
    SyncDirection,
    SyncOwnershipStrategy,
    SyncPolicyStatus,
    SyncVersionStrategy,
)

if TYPE_CHECKING:
    from app.erp_registry.models import ErpInstance


class EntitySyncPolicy(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """
    Control-plane synchronization policy specifying ownership, direction,
    conflict arbitration, and versioning rules for an entity type across two ERPs.
    """

    __tablename__ = "entity_sync_policies"
    __table_args__ = (
        Index(
            "ix_entity_sync_policies_lookup",
            "source_erp_id",
            "target_erp_id",
            "entity_type",
        ),
        Index(
            "ix_entity_sync_policies_entity_status",
            "entity_type",
            "status",
        ),
    )

    source_erp_id: Mapped[uuid.UUID] = mapped_column(
        GUID(),
        ForeignKey("erp_instances.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
        doc="ERP node originating the synchronization path.",
    )
    target_erp_id: Mapped[uuid.UUID] = mapped_column(
        GUID(),
        ForeignKey("erp_instances.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
        doc="ERP node receiving or participating in synchronization.",
    )
    source_module: Mapped[str | None] = mapped_column(
        String(100),
        nullable=True,
        doc="Optional capability/module scope on the source ERP (e.g. 'crm', 'sales').",
    )
    target_module: Mapped[str | None] = mapped_column(
        String(100),
        nullable=True,
        doc="Optional capability/module scope on the target ERP (e.g. 'crm', 'sales').",
    )
    entity_type: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
        index=True,
        doc="Canonical domain entity type, e.g. 'buyer', 'supplier', 'product'.",
    )
    authoritative_owner_erp_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(),
        ForeignKey("erp_instances.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
        doc="ERP instance holding golden-record authority for this entity type (null if shared/manual).",
    )
    ownership_strategy: Mapped[SyncOwnershipStrategy] = mapped_column(
        SAEnum(SyncOwnershipStrategy, name="sync_ownership_strategy", native_enum=False, length=30),
        nullable=False,
        default=SyncOwnershipStrategy.SOURCE_OWNED,
    )
    direction: Mapped[SyncDirection] = mapped_column(
        SAEnum(SyncDirection, name="sync_direction", native_enum=False, length=30),
        nullable=False,
        default=SyncDirection.SOURCE_TO_TARGET,
    )
    conflict_strategy: Mapped[SyncConflictStrategy] = mapped_column(
        SAEnum(SyncConflictStrategy, name="sync_conflict_strategy", native_enum=False, length=30),
        nullable=False,
        default=SyncConflictStrategy.SOURCE_WINS,
    )
    delete_strategy: Mapped[SyncDeleteStrategy] = mapped_column(
        SAEnum(SyncDeleteStrategy, name="sync_delete_strategy", native_enum=False, length=30),
        nullable=False,
        default=SyncDeleteStrategy.IGNORE_DELETE,
    )
    version_strategy: Mapped[SyncVersionStrategy] = mapped_column(
        SAEnum(SyncVersionStrategy, name="sync_version_strategy", native_enum=False, length=30),
        nullable=False,
        default=SyncVersionStrategy.EVENT_VERSION,
    )
    status: Mapped[SyncPolicyStatus] = mapped_column(
        SAEnum(SyncPolicyStatus, name="sync_policy_status", native_enum=False, length=20),
        nullable=False,
        default=SyncPolicyStatus.ACTIVE,
        index=True,
    )
    enabled: Mapped[bool] = mapped_column(
        Boolean,
        default=True,
        nullable=False,
        index=True,
        doc="Whether this synchronization policy is actively operational.",
    )
    description: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
        doc="Human-readable operational notes or justification for this policy.",
    )
    custom_config: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
        doc="JSON-encoded configuration object for future custom transformation/filtering rules.",
    )
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        GUID(),
        nullable=True,
        doc="Platform principal ID who created this policy.",
    )
    updated_by: Mapped[uuid.UUID | None] = mapped_column(
        GUID(),
        nullable=True,
        doc="Platform principal ID who last modified this policy.",
    )

    source_erp: Mapped[ErpInstance] = relationship(
        "ErpInstance",
        foreign_keys=[source_erp_id],
        lazy="joined",
    )
    target_erp: Mapped[ErpInstance] = relationship(
        "ErpInstance",
        foreign_keys=[target_erp_id],
        lazy="joined",
    )
    authoritative_owner_erp: Mapped[ErpInstance | None] = relationship(
        "ErpInstance",
        foreign_keys=[authoritative_owner_erp_id],
        lazy="joined",
    )

    def __repr__(self) -> str:
        return (
            f"<EntitySyncPolicy id={self.id} entity={self.entity_type!r} "
            f"source={self.source_erp_id} -> target={self.target_erp_id} "
            f"owner={self.ownership_strategy.value} status={self.status.value} enabled={self.enabled}>"
        )
