"""
Integration Control-Plane ORM Models (Phase 6).

ERP_Main's role in cross-ERP integration is the CONTROL PLANE only
(Section 33/70): it does not become a business database. What it owns
here is metadata ABOUT the flow of events between ERPs -- routing rules,
received-event bookkeeping (for deduplication and dead-letter recovery),
cross-ERP identifier mappings, and dead letters -- never the business
payload's authoritative copy. Yinglima and Inhyma each keep their own
`integration_outbox` table (their own repo, their own migration) as the
producer side; this file is the consumer/control side.

Four tables:

- `IntegrationSubscription` -- "which event_type, from which source ERP,
  should be routed to which target ERP" (Section 48). Purely
  configuration; does not itself deliver anything.
- `IntegrationInboxEvent` -- every event ERP_Main has received from a
  producer ERP, keyed by `event_id` for at-least-once deduplication
  (Section 15/16). This is the landing table an authenticated producer
  POSTs into; a background step (or a synchronous forward, depending on
  the subscription) then routes it onward.
- `IntegrationEntityMapping` -- explicit cross-ERP identity mapping
  (Section 30): "Yinglima buyer UUID X" <-> "Inhyma buyer UUID Y" is
  never assumed equal and is never inferred; it is one row here,
  written only when synchronization actually establishes the link.
- `IntegrationDeadLetter` -- events that exhausted retries, retained for
  operator inspection and authorized replay (Section 18/19), never
  silently discarded.

None of these four tables has a cross-database foreign key to Yinglima
or Inhyma's own schema (Section 3/31) -- every reference to "the other
side" is a plain UUID + ERP key column, resolved only via HTTP at
replay/lookup time, exactly like `ErpMembership.local_user_id` already
does not FK into the target ERP's `users` table.
"""

from __future__ import annotations

import re
import uuid
from datetime import datetime
from enum import Enum

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy import Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship, validates

from app.database.base import GUID, Base, TimestampMixin, UUIDPrimaryKeyMixin
from app.erp_registry.models import ErpInstance

_EVENT_TYPE_PATTERN = re.compile(r"^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$")


class IntegrationTarget(str, Enum):
    """A subscription's or event's destination classification (Phase 6 Section 23)."""

    SPECIFIC_ERP = "SPECIFIC_ERP"
    BROADCAST = "BROADCAST"


class InboxEventStatus(str, Enum):
    """
    Lifecycle of a received integration event (Phase 6 Section 11).

    A state machine, not an arbitrary string: RECEIVED is the only
    entry point; ROUTED and IGNORED are the only ways out of RECEIVED
    for a first attempt; FAILED is reachable only from an actual
    routing attempt, and DEAD_LETTER only after retries are exhausted
    (enforced in the service layer, not the DB, mirroring how
    `PlatformRoleAssignment`'s scope/erp_instance_id consistency is
    enforced in `platform_authz.service` rather than as a raw column
    constraint).
    """

    RECEIVED = "RECEIVED"
    ROUTED = "ROUTED"
    IGNORED = "IGNORED"
    FAILED = "FAILED"
    DEAD_LETTER = "DEAD_LETTER"


class IntegrationSubscription(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """
    A configured routing rule: "events of this type, from this source ERP, go to this target" (Section 48).

    Deliberately data-driven (Section 24/72): adding a new routing rule
    is a new row, never a new `if erp_key == ...` branch anywhere in the
    codebase. `enabled=False` disables the rule without losing its
    configuration history.
    """

    __tablename__ = "integration_subscriptions"
    __table_args__ = (
        UniqueConstraint(
            "event_type", "source_erp_id", "target_erp_id", name="uq_integration_subscription_type_source_target"
        ),
    )

    event_type: Mapped[str] = mapped_column(
        String(150), nullable=False, index=True, doc="Machine-readable event type this subscription matches, e.g. 'buyer.created'."
    )
    source_erp_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("erp_instances.id", ondelete="CASCADE"), nullable=False, index=True
    )
    target_erp_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(),
        ForeignKey("erp_instances.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
        doc="Required when target_kind=SPECIFIC_ERP, null when target_kind=BROADCAST (validated in the service layer).",
    )
    target_kind: Mapped[IntegrationTarget] = mapped_column(
        SAEnum(IntegrationTarget, name="integration_target_kind", native_enum=False, length=20),
        nullable=False,
        default=IntegrationTarget.SPECIFIC_ERP,
    )
    required_capability: Mapped[str | None] = mapped_column(
        String(100),
        nullable=True,
        doc="If set, the target ERP must have declared this module_key in its ErpModule capability list "
        "(Section 25) or this subscription is skipped at routing time, not an error.",
    )
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    source_erp: Mapped[ErpInstance] = relationship(foreign_keys=[source_erp_id])
    target_erp: Mapped[ErpInstance | None] = relationship(foreign_keys=[target_erp_id])

    @validates("event_type")
    def _validate_event_type(self, _key: str, value: str) -> str:
        """Enforce the lowercase-dotted event_type shape every example in the brief uses (e.g. 'buyer.created')."""
        if not value or not _EVENT_TYPE_PATTERN.match(value):
            raise ValueError(
                "event_type must be lowercase-dotted with at least one dot, e.g. 'buyer.created', 'erp.suspended'."
            )
        return value

    def __repr__(self) -> str:
        """Return a debug-friendly representation."""
        return f"<IntegrationSubscription event_type={self.event_type!r} enabled={self.enabled}>"


class IntegrationInboxEvent(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """
    An integration event received from a producer ERP (Phase 6 Section 4/15).

    `event_id` (the producer's own globally-unique ID, NOT this row's own
    primary key) is unique per this table -- a duplicate delivery of the
    same `event_id` (at-least-once delivery, Section 16) is recognized
    and short-circuited here rather than routed twice, which is the
    dedup boundary Section 15 calls for at the consumer.
    """

    __tablename__ = "integration_inbox_events"
    __table_args__ = (UniqueConstraint("event_id", name="uq_integration_inbox_event_id"),)

    event_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), nullable=False, index=True, doc="The producer's own globally-unique event_id (envelope field, not this row's PK)."
    )
    event_type: Mapped[str] = mapped_column(String(150), nullable=False, index=True)
    event_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    source_erp_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("erp_instances.id", ondelete="CASCADE"), nullable=False, index=True
    )
    source_entity_type: Mapped[str] = mapped_column(String(100), nullable=False)
    source_entity_id: Mapped[uuid.UUID] = mapped_column(GUID(), nullable=False, index=True)
    correlation_id: Mapped[uuid.UUID] = mapped_column(GUID(), nullable=False, index=True)
    causation_id: Mapped[uuid.UUID | None] = mapped_column(GUID(), nullable=True)
    actor_type: Mapped[str] = mapped_column(String(20), nullable=False, doc="'user' | 'service' | 'system'.")
    actor_id: Mapped[uuid.UUID | None] = mapped_column(GUID(), nullable=True)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    payload: Mapped[str] = mapped_column(Text, nullable=False, doc="JSON-encoded integration event payload (data-minimized, Section 41).")
    status: Mapped[InboxEventStatus] = mapped_column(
        SAEnum(InboxEventStatus, name="integration_inbox_status", native_enum=False, length=20),
        nullable=False,
        default=InboxEventStatus.RECEIVED,
        index=True,
    )
    routed_to: Mapped[str | None] = mapped_column(
        Text, nullable=True, doc="JSON-encoded list of target ERP keys this event was actually routed to."
    )
    attempt_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)

    source_erp: Mapped[ErpInstance] = relationship()

    def __repr__(self) -> str:
        """Return a debug-friendly representation."""
        return f"<IntegrationInboxEvent event_id={self.event_id} event_type={self.event_type!r} status={self.status.value}>"


class IntegrationEntityMapping(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """
    Explicit cross-ERP identity mapping (Phase 6 Section 30).

    Never assume `source_entity_id == target_entity_id` -- they are
    separate systems with independently-generated UUIDs. A row here is
    the only authoritative link between "Yinglima buyer X" and "Inhyma
    buyer Y", written only when a synchronization consumer actually
    establishes it (never inferred, never guessed).
    """

    __tablename__ = "integration_entity_mappings"
    __table_args__ = (
        UniqueConstraint(
            "source_erp_id",
            "source_entity_type",
            "source_entity_id",
            "target_erp_id",
            "target_entity_type",
            name="uq_integration_entity_mapping",
        ),
    )

    source_erp_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("erp_instances.id", ondelete="CASCADE"), nullable=False, index=True
    )
    source_entity_type: Mapped[str] = mapped_column(String(100), nullable=False)
    source_entity_id: Mapped[uuid.UUID] = mapped_column(GUID(), nullable=False, index=True)
    target_erp_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("erp_instances.id", ondelete="CASCADE"), nullable=False, index=True
    )
    target_entity_type: Mapped[str] = mapped_column(String(100), nullable=False)
    target_entity_id: Mapped[uuid.UUID] = mapped_column(GUID(), nullable=False, index=True)
    status: Mapped[str] = mapped_column(
        String(30), nullable=False, default="ACTIVE", doc="'ACTIVE' | 'STALE' | 'CONFLICT' | 'ARCHIVED'"
    )
    source_version: Mapped[int | None] = mapped_column(Integer, nullable=True)
    target_version: Mapped[int | None] = mapped_column(Integer, nullable=True)
    last_synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    correlation_id: Mapped[uuid.UUID | None] = mapped_column(GUID(), nullable=True)

    source_erp: Mapped[ErpInstance] = relationship(foreign_keys=[source_erp_id])
    target_erp: Mapped[ErpInstance] = relationship(foreign_keys=[target_erp_id])

    def __repr__(self) -> str:
        """Return a debug-friendly representation."""
        return (
            f"<IntegrationEntityMapping {self.source_entity_type}:{self.source_entity_id} -> "
            f"{self.target_entity_type}:{self.target_entity_id} status={self.status}>"
        )


class IntegrationDeadLetter(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """
    A permanently-failed integration event, retained for inspection and authorized replay (Section 18/19).

    Created only when an `IntegrationInboxEvent`'s routing attempts are
    exhausted (never on the first failure -- retries happen first, see
    `service.py::IntegrationService.record_routing_failure`). `replayed_at`/
    `replayed_by` are set when an operator triggers a replay (Section 19:
    "require authorization," "be audited") without deleting the row --
    a dead letter's history is kept even after a successful replay.
    """

    __tablename__ = "integration_dead_letters"

    inbox_event_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("integration_inbox_events.id", ondelete="CASCADE"), nullable=False, index=True, unique=True
    )
    event_id: Mapped[uuid.UUID] = mapped_column(GUID(), nullable=False, index=True)
    event_type: Mapped[str] = mapped_column(String(150), nullable=False, index=True)
    source_erp_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("erp_instances.id", ondelete="CASCADE"), nullable=False, index=True
    )
    attempt_count: Mapped[int] = mapped_column(Integer, nullable=False)
    last_error: Mapped[str] = mapped_column(Text, nullable=False)
    failed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    replayed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    replayed_by: Mapped[uuid.UUID | None] = mapped_column(GUID(), nullable=True)

    inbox_event: Mapped[IntegrationInboxEvent] = relationship()
    source_erp: Mapped[ErpInstance] = relationship()

    def __repr__(self) -> str:
        """Return a debug-friendly representation."""
        return f"<IntegrationDeadLetter event_id={self.event_id} event_type={self.event_type!r}>"
