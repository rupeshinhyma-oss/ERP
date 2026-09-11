"""
Generic Cross-ERP Synced Entity Mapping ORM Model (Phase 8E).

Generalizes the Phase 6/7 Buyer-specific mapping (SyncedBuyerSource) to support
arbitrary master-data entities (buyers, suppliers, products, etc.) across
autonomous ERP nodes.

Tracks:
- source_erp_id: the peer ERP node key/id
- entity_type: domain entity type (e.g. 'buyer', 'supplier', 'product')
- source_entity_id: string/UUID of the entity on the source ERP
- local_entity_id: UUID of the local entity in this ERP
- source_version: integer version of the source entity when last synced
- local_version: integer OCC version of the local entity when last synced
- sync_status: 'ACTIVE' | 'CONFLICT' | 'STALE' | 'ARCHIVED'
- last_synced_at: timestamp of last successful synchronization
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, Index, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.database.base import GUID, Base, TimestampMixin, UUIDPrimaryKeyMixin


def _utcnow() -> datetime:
    """Return the current UTC time."""
    return datetime.now(timezone.utc)


class SyncedEntityMapping(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """
    Explicit cross-ERP identity and version tracking mapping for domain entities.
    """

    __tablename__ = "synced_entity_mappings"
    __table_args__ = (
        UniqueConstraint("source_erp_id", "entity_type", "source_entity_id", name="uq_synced_entity_mapping"),
        Index("ix_synced_entity_mappings_local_entity", "local_entity_id"),
        Index("ix_synced_entity_mappings_type_status", "entity_type", "sync_status"),
    )

    source_erp_id: Mapped[str] = mapped_column(
        String(100), nullable=False, doc="Producer ERP node key or ID."
    )
    entity_type: Mapped[str] = mapped_column(
        String(100), nullable=False, doc="Canonical entity type, e.g. 'buyer'."
    )
    source_entity_id: Mapped[str] = mapped_column(
        String(100), nullable=False, doc="Source ERP's local entity ID as a string."
    )
    local_entity_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), nullable=False, doc="Local entity UUID in this ERP."
    )
    source_version: Mapped[int] = mapped_column(
        Integer, nullable=False, default=1, doc="Source entity version recorded during last sync."
    )
    local_version: Mapped[int] = mapped_column(
        Integer, nullable=False, default=1, doc="Local entity version recorded during last sync."
    )
    sync_status: Mapped[str] = mapped_column(
        String(30), nullable=False, default="ACTIVE", doc="'ACTIVE' | 'CONFLICT' | 'STALE' | 'ARCHIVED'"
    )
    last_synced_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow, doc="Timestamp of last synchronization."
    )

    def __repr__(self) -> str:
        return (
            f"<SyncedEntityMapping {self.entity_type}:{self.source_entity_id} -> {self.local_entity_id} "
            f"source_ver={self.source_version} local_ver={self.local_version} status={self.sync_status}>"
        )
