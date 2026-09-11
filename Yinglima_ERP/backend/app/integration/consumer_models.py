"""
Processed Events ORM Model (Phase 6, consumer side).

The dedup boundary Section 15 calls for: `event_id` + `consumer_id` as
the uniqueness key, so a repeated delivery of the same event (Section
16: at-least-once, never exactly-once) is recognized and skipped rather
than reprocessed. `consumer_id` exists (rather than assuming "one
consumer per ERP") because a single ERP could in principle run more
than one independent consumer for different event types later --
keeping the key two-part from the start avoids a schema change if that
ever happens.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.database.base import GUID, Base, TimestampMixin, UUIDPrimaryKeyMixin


def _utcnow() -> datetime:
    """Return the current UTC time."""
    return datetime.now(timezone.utc)


class ProcessedIntegrationEvent(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """
    A record that this ERP's consumer has already handled a given `event_id`.

    A repeated poll returning the same `event_id` (Section 16) is
    recognized by the presence of a row here and skipped -- the
    consumer never reprocesses an event it has already applied, no
    matter how many times ERP_Main's inbox includes it in a poll
    response.
    """

    __tablename__ = "processed_integration_events"
    __table_args__ = (UniqueConstraint("event_id", "consumer_id", name="uq_processed_integration_event"),)

    event_id: Mapped[uuid.UUID] = mapped_column(GUID(), nullable=False, index=True)
    consumer_id: Mapped[str] = mapped_column(
        String(100), nullable=False, doc="Which local consumer handled this event, e.g. 'buyer_sync'."
    )
    event_type: Mapped[str] = mapped_column(String(150), nullable=False)
    processed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow)

    def __repr__(self) -> str:
        """Return a debug-friendly representation."""
        return f"<ProcessedIntegrationEvent event_id={self.event_id} consumer_id={self.consumer_id!r}>"


class SyncedBuyerSource(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """
    Tracks which local Buyer row a given SOURCE buyer has already been synchronized into (Phase 7 bidirectional pilot).

    Deliberately keyed by `(source_erp_id, source_buyer_id)` rather than
    by `event_id` -- unlike `ProcessedIntegrationEvent` (which dedupes
    one specific EVENT delivery), this table answers "has this SOURCE
    ENTITY already been synced, regardless of which event or how many
    times", which is what actually prevents a dead-letter REPLAY (a new
    `event_id` for the same logical source buyer) from creating a
    duplicate local Buyer.

    Mirrors Inhyma's own `SyncedBuyerSource` (introduced there in
    Phase 6, for the Yinglima -> Inhyma direction) exactly -- Phase 7
    adds the same table here for the reverse direction (Inhyma ->
    Yinglima), since each ERP is independently the system of record for
    the buyers IT creates; this is two symmetric one-way pilots sharing
    one consumer implementation shape, not one bidirectionally-owned
    entity requiring field-level conflict resolution (see
    PHASE7_SYNC.md for the full ownership reasoning).
    """

    __tablename__ = "synced_buyer_sources"
    __table_args__ = (UniqueConstraint("source_erp_id", "source_buyer_id", name="uq_synced_buyer_source"),)

    source_erp_id: Mapped[str] = mapped_column(String(100), nullable=False, doc="The producer ERP's registry UUID, as a string (matches the inbox event's own source_erp_id field type).")
    source_buyer_id: Mapped[str] = mapped_column(String(100), nullable=False, doc="The source ERP's own local buyer id, as received in the event payload.")
    local_buyer_id: Mapped[uuid.UUID] = mapped_column(GUID(), nullable=False, doc="The resulting local Buyer.id this source buyer was synchronized into.")

    def __repr__(self) -> str:
        """Return a debug-friendly representation."""
        return f"<SyncedBuyerSource source_buyer_id={self.source_buyer_id!r} local_buyer_id={self.local_buyer_id}>"
