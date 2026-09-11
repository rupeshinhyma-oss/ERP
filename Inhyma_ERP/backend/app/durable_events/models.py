"""
Durable Event & Queue Models (Phase 3).

Four tables, deliberately distinct from two existing systems this phase
must not conflate with (Section 4/13):

- `app.events.models.Event` (existing, Phase 1) is an in-memory-only
  dataclass with NO persistence -- `EventDispatcher.publish` broadcasts
  it directly to whichever WebSocket connections this one process
  happens to hold, then discards it. If the process crashes between a
  business transaction's commit and that broadcast call, or if a
  different worker holds the browser's connection, the event is simply
  gone. This module is what gives that same `Event` shape (see
  `to_envelope_dict` below, matching `Event.to_dict()` field-for-field)
  a durable home in SQL BEFORE it is ever broadcast, so a crash or a
  different worker can no longer lose it.
- `app.integration.models.IntegrationOutboxEvent` (existing, Phase 6) is
  a single-destination outbox purpose-built for one thing: dispatching
  to ERP_Main's HTTP endpoint. It has no notion of multiple independent
  consumers each needing their own claim/lease/ack state, which is
  exactly what THIS module adds. It is not touched, extended, or
  duplicated by anything below -- cross-ERP dispatch keeps using it
  exactly as Phase 6 built it.

Table roles:

- `DurableEvent` -- the single source of truth (Section 24: "the SQL
  event table is durable truth; NOTIFY is only a wake-up signal"). One
  row per event, independent of how many consumers will eventually
  process it.
- `EventConsumer` -- a registered, named recipient of events (Section
  22), e.g. `"yinglima.websocket"`. Purely a lookup/registry row; it
  does not itself track per-event state.
- `EventDelivery` -- per-(event, consumer) claim/lease/retry/ack state
  (Section 15/16/17/21). This is what lets N independent consumers each
  process the SAME `DurableEvent` exactly once each, with independent
  retry timelines, without contending on the same row lock.
- `DeadLetterEvent` -- a permanently-failed delivery, retained for
  diagnosis (Section 20), never silently discarded.

No table here has a foreign key into another ERP's database (Section
32/34) -- this is a wholly local, single-ERP durability mechanism per
Phase 3's own scope; cross-ERP dispatch remains Phase 6's
`IntegrationOutboxEvent`'s job.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from enum import Enum

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy import Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.base import GUID, Base, TimestampMixin, UUIDPrimaryKeyMixin


class DeliveryStatus(str, Enum):
    """
    Per-consumer delivery state machine (Phase 3 Section 14).

    PENDING -> PROCESSING -> SUCCESS is the happy path.
    PROCESSING -(temporary failure)-> RETRY -(due again)-> PROCESSING -> ...
    RETRY -(attempts exhausted)-> DEAD_LETTER
    PROCESSING -(permanent failure)-> DEAD_LETTER
    PENDING -(consumer disabled/event superseded)-> CANCELLED

    Deliberately merges the brief's suggested PENDING/CLAIMED/PROCESSING
    into a lean set: CLAIMED and PROCESSING are the same moment in this
    implementation (the atomic claim UPDATE sets both `claimed_by` and
    `status=PROCESSING` in one statement -- see
    `EventDeliveryRepository.claim_next`), so a separate CLAIMED state
    would never actually be observable between two different rows'
    lifecycles.
    """

    PENDING = "PENDING"
    PROCESSING = "PROCESSING"
    SUCCESS = "SUCCESS"
    RETRY = "RETRY"
    DEAD_LETTER = "DEAD_LETTER"
    CANCELLED = "CANCELLED"


class DurableEvent(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """
    The durable record of one event occurrence -- the SQL source of truth (Section 24).

    Field names and shapes deliberately mirror `app.events.models.Event`
    (see that model's own docstring) plus the envelope fields Section 12
    asks for (`source`, `target`, `correlation_id`, `causation_id`,
    `event_version`) that the in-memory `Event` dataclass has no need
    for today. `to_envelope_dict()` below produces exactly the shape
    `Event.to_dict()` already produces for the fields both share, so the
    EXISTING dispatcher/WebSocket client-side code needs zero changes to
    consume an event that originated here (Section 27: "do not rewrite
    the frontend WebSocket client").
    """

    __tablename__ = "durable_events"
    __table_args__ = (UniqueConstraint("idempotency_key", name="uq_durable_event_idempotency_key"),)

    event_type: Mapped[str] = mapped_column(String(150), nullable=False, index=True)
    event_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    source: Mapped[str] = mapped_column(String(50), nullable=False, doc="Originating app, e.g. 'yinglima'.")
    target: Mapped[str | None] = mapped_column(
        String(50), nullable=True, doc="Specific destination app, or NULL for 'broadcast to whoever is subscribed'."
    )
    entity: Mapped[str] = mapped_column(String(100), nullable=False, index=True, doc="Module/domain, e.g. 'buyer'.")
    entity_id: Mapped[str] = mapped_column(String(150), nullable=False, index=True)
    entity_version: Mapped[int | None] = mapped_column(
        Integer, nullable=True, doc="The entity's own version AFTER this change, if the module tracks one."
    )
    payload: Mapped[str] = mapped_column(
        Text, nullable=False, default="{}", doc="JSON-encoded `changes` (Section 45: keep small)."
    )
    event_metadata: Mapped[str] = mapped_column(Text, nullable=False, default="{}", doc="JSON-encoded free-form metadata.")
    idempotency_key: Mapped[str | None] = mapped_column(
        String(255),
        nullable=True,
        index=True,
        doc="Optional caller-supplied dedup key (Section 8/21) -- unique when present.",
    )
    correlation_id: Mapped[uuid.UUID] = mapped_column(GUID(), nullable=False, index=True)
    causation_id: Mapped[uuid.UUID | None] = mapped_column(GUID(), nullable=True)
    user_id: Mapped[str | None] = mapped_column(String(150), nullable=True)
    priority: Mapped[str] = mapped_column(String(20), nullable=False, default="normal")
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    deliveries: Mapped[list["EventDelivery"]] = relationship(back_populates="event", cascade="all, delete-orphan")

    def to_envelope_dict(self) -> dict:
        """
        Render exactly the shape `app.events.models.Event.to_dict()` already
        produces (same field names, same ISO-8601 timestamp format) so the
        EXISTING WebSocket dispatch/frontend client needs no changes to
        consume an event that originated from this durable store.
        """
        import json

        return {
            "event_id": str(self.id),
            "event_type": self.event_type,
            "entity": self.entity,
            "entity_id": self.entity_id,
            "version": self.entity_version,
            "timestamp": self.occurred_at.isoformat(),
            "user_id": self.user_id,
            "changes": json.loads(self.payload) if self.payload else {},
        }

    def __repr__(self) -> str:
        """Return a debug-friendly representation."""
        return f"<DurableEvent event_type={self.event_type!r} entity={self.entity}:{self.entity_id}>"


class EventConsumer(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """
    A registered, named recipient of events (Section 22).

    Purely a lookup row (`consumer_key` -> human-readable metadata) --
    it does NOT track per-event state itself; see `EventDelivery` for
    that. Registering a consumer here is what makes it eligible to
    receive deliveries at all (Section 37: the backend, not an arbitrary
    caller, owns which consumers exist).
    """

    __tablename__ = "event_consumers"

    consumer_key: Mapped[str] = mapped_column(
        String(150), unique=True, nullable=False, index=True, doc="e.g. 'yinglima.websocket', 'yinglima.inhyma_sync'."
    )
    description: Mapped[str | None] = mapped_column(String(500), nullable=True)
    enabled: Mapped[bool] = mapped_column(nullable=False, default=True)

    def __repr__(self) -> str:
        """Return a debug-friendly representation."""
        return f"<EventConsumer consumer_key={self.consumer_key!r} enabled={self.enabled}>"


class EventDelivery(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """
    Per-(event, consumer) claim/lease/retry/acknowledgement state (Section 15-17/21).

    This is the row `EventDeliveryRepository.claim_next` locks with
    `SELECT ... FOR UPDATE SKIP LOCKED` (mirroring
    `app.queue.repository.QueueRepository.claim_next_job` exactly) --
    NOT `DurableEvent` itself, since one event fanning out to 3
    consumers must let all 3 be claimed/processed/retried completely
    independently, with no contention between them.

    `UNIQUE(event_id, consumer_id)` is the idempotency boundary Section
    21 asks for at the infrastructure level: a given consumer can only
    ever have ONE delivery row per event, so redundant delivery-row
    creation cannot itself create a duplicate delivery.
    """

    __tablename__ = "event_deliveries"
    __table_args__ = (UniqueConstraint("event_id", "consumer_id", name="uq_event_delivery_event_consumer"),)

    event_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("durable_events.id", ondelete="CASCADE"), nullable=False, index=True
    )
    consumer_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("event_consumers.id", ondelete="CASCADE"), nullable=False, index=True
    )
    status: Mapped[DeliveryStatus] = mapped_column(
        SAEnum(DeliveryStatus, name="event_delivery_status", native_enum=False, length=20),
        nullable=False,
        default=DeliveryStatus.PENDING,
        index=True,
    )
    available_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, index=True, doc="Not claimable before this time (scheduled retries)."
    )
    claimed_by: Mapped[str | None] = mapped_column(
        String(100), nullable=True, doc="Opaque worker identifier, for diagnostics only -- never used for authorization."
    )
    claimed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    lease_expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        index=True,
        doc="Section 16: when a stale claim (worker crashed) becomes eligible for another worker.",
    )
    attempt_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    max_attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=8)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    processed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    event: Mapped[DurableEvent] = relationship(back_populates="deliveries")
    consumer: Mapped[EventConsumer] = relationship()

    @property
    def is_retriable(self) -> bool:
        """True if this delivery has remaining retry attempts."""
        return self.attempt_count < self.max_attempts

    def __repr__(self) -> str:
        """Return a debug-friendly representation."""
        return f"<EventDelivery event_id={self.event_id} consumer_id={self.consumer_id} status={self.status.value}>"


class DeadLetterEvent(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """
    A permanently-failed delivery, retained for diagnosis (Section 20).

    One row per failed `EventDelivery` -- NOT per `DurableEvent`, since
    a single event dead-lettering for one consumer while succeeding for
    another must be representable independently.
    """

    __tablename__ = "dead_letter_events"

    delivery_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("event_deliveries.id", ondelete="CASCADE"), nullable=False, unique=True, index=True
    )
    event_id: Mapped[uuid.UUID] = mapped_column(GUID(), nullable=False, index=True)
    consumer_id: Mapped[uuid.UUID] = mapped_column(GUID(), nullable=False, index=True)
    event_type: Mapped[str] = mapped_column(String(150), nullable=False, index=True)
    attempt_count: Mapped[int] = mapped_column(Integer, nullable=False)
    first_failed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    last_failed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    failure_reason: Mapped[str] = mapped_column(Text, nullable=False)
    replayed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    replayed_by: Mapped[str | None] = mapped_column(String(150), nullable=True)

    def __repr__(self) -> str:
        """Return a debug-friendly representation."""
        return f"<DeadLetterEvent event_type={self.event_type!r} attempt_count={self.attempt_count}>"
