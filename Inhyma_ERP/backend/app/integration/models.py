"""
Integration Outbox ORM Models (Phase 6 & Phase 8F).

Phase 8F additions:
- IntegrationOutboxDelivery: independent per-target delivery tracking for fan-out,
  leased claiming, crash recovery, and bounded exponential backoff.
- PeerHealthState: Redis-free persistent circuit breaker and peer cooldown tracking.
- SnapshotJob: resumable snapshot sync with cursor checkpointing.
"""

from __future__ import annotations

import re
import uuid
from datetime import datetime, timezone
from enum import Enum

from sqlalchemy import DateTime, Enum as SAEnum, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship, validates

from app.database.base import GUID, Base, TimestampMixin, UUIDPrimaryKeyMixin

_EVENT_TYPE_PATTERN = re.compile(r"^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$")


def _utcnow() -> datetime:
    """Return the current UTC time."""
    return datetime.now(timezone.utc)


class OutboxEventStatus(str, Enum):
    """Lifecycle of one parent outbox row."""

    PENDING = "PENDING"
    DISPATCHING = "DISPATCHING"
    PUBLISHED = "PUBLISHED"
    FAILED = "FAILED"
    DEAD_LETTER = "DEAD_LETTER"


class DeliveryStatus(str, Enum):
    """
    Independent lifecycle of one outbound delivery to a specific target ERP (Phase 8F).
    """

    PENDING = "PENDING"
    PROCESSING = "PROCESSING"
    DELIVERED = "DELIVERED"
    RETRYING = "RETRYING"
    DEAD_LETTER = "DEAD_LETTER"
    CANCELLED = "CANCELLED"


class IntegrationOutboxEvent(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """
    One integration event produced by this ERP.
    """

    __tablename__ = "integration_outbox_events"

    event_id: Mapped[uuid.UUID] = mapped_column(
        GUID(),
        nullable=False,
        unique=True,
        index=True,
        doc="Globally unique event id (envelope field). Generated once at publish_event() call time, never reused.",
    )
    event_type: Mapped[str] = mapped_column(String(150), nullable=False, index=True)
    event_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    aggregate_type: Mapped[str] = mapped_column(String(100), nullable=False, doc="e.g. 'buyer', 'supplier'.")
    aggregate_id: Mapped[uuid.UUID] = mapped_column(GUID(), nullable=False, index=True, doc="The local entity's own UUID.")
    correlation_id: Mapped[uuid.UUID] = mapped_column(GUID(), nullable=False, index=True)
    causation_id: Mapped[uuid.UUID | None] = mapped_column(GUID(), nullable=True)
    actor_type: Mapped[str] = mapped_column(String(20), nullable=False, doc="'user' | 'service' | 'system'.")
    actor_id: Mapped[uuid.UUID | None] = mapped_column(GUID(), nullable=True)
    target: Mapped[str] = mapped_column(String(50), nullable=False, default="broadcast")
    payload: Mapped[str] = mapped_column(
        Text, nullable=False, doc="JSON-encoded, data-minimized integration payload."
    )
    status: Mapped[OutboxEventStatus] = mapped_column(
        SAEnum(OutboxEventStatus, name="outbox_event_status", native_enum=False, length=20),
        nullable=False,
        default=OutboxEventStatus.PENDING,
        index=True,
    )
    attempt_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    max_attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=5)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow)

    deliveries: Mapped[list[IntegrationOutboxDelivery]] = relationship(
        "IntegrationOutboxDelivery",
        back_populates="outbox_event",
        cascade="all, delete-orphan",
        lazy="selectin",
    )

    @property
    def contract_version(self) -> int:
        return self.event_version

    @validates("event_type")
    def _validate_event_type(self, _key: str, value: str) -> str:
        if not value or not _EVENT_TYPE_PATTERN.match(value):
            raise ValueError("event_type must be lowercase-dotted with at least one dot, e.g. 'buyer.created'.")
        return value

    @property
    def is_retriable(self) -> bool:
        return self.attempt_count < self.max_attempts

    def __repr__(self) -> str:
        return f"<IntegrationOutboxEvent event_type={self.event_type!r} status={self.status.value}>"


class IntegrationOutboxDelivery(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """
    Per-(event, target_erp) delivery tracking (Phase 8F fan-out & recovery).
    """

    __tablename__ = "integration_outbox_deliveries"
    __table_args__ = (
        UniqueConstraint("outbox_event_id", "target_erp", name="uq_outbox_delivery_event_target"),
        Index("ix_outbox_deliveries_status_next", "status", "next_attempt_at"),
        Index("ix_outbox_deliveries_target_status", "target_erp", "status"),
    )

    outbox_event_id: Mapped[uuid.UUID] = mapped_column(
        GUID(),
        ForeignKey("integration_outbox_events.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    target_erp: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    status: Mapped[DeliveryStatus] = mapped_column(
        SAEnum(DeliveryStatus, name="delivery_status", native_enum=False, length=30),
        nullable=False,
        default=DeliveryStatus.PENDING,
        index=True,
    )
    attempt_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    max_attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=5)
    worker_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    lease_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    next_attempt_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow, index=True
    )
    last_attempt_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    delivered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_error_code: Mapped[str | None] = mapped_column(String(100), nullable=True)
    last_error_message: Mapped[str | None] = mapped_column(Text, nullable=True)

    outbox_event: Mapped[IntegrationOutboxEvent] = relationship(
        "IntegrationOutboxEvent",
        back_populates="deliveries",
    )

    @property
    def is_retriable(self) -> bool:
        return self.attempt_count < self.max_attempts

    def __repr__(self) -> str:
        return f"<IntegrationOutboxDelivery target={self.target_erp} status={self.status.value} attempt={self.attempt_count}>"


class PeerHealthState(Base, TimestampMixin):
    """
    Persistent, Redis-free peer circuit breaker and peer cooldown state (Phase 8F).
    """

    __tablename__ = "peer_health_states"

    peer_id: Mapped[str] = mapped_column(String(100), primary_key=True)
    circuit_state: Mapped[str] = mapped_column(String(20), nullable=False, default="CLOSED")
    consecutive_failures: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    consecutive_successes: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    cooldown_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_failure_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_success_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    def __repr__(self) -> str:
        return f"<PeerHealthState peer={self.peer_id} state={self.circuit_state} failures={self.consecutive_failures}>"


class SnapshotJob(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """
    Resumable snapshot job with cursor-based checkpointing (Phase 8F).
    """

    __tablename__ = "snapshot_jobs"
    __table_args__ = (Index("ix_snapshot_jobs_type_status", "entity_type", "status"),)

    entity_type: Mapped[str] = mapped_column(String(100), nullable=False)
    source_erp: Mapped[str] = mapped_column(String(100), nullable=False)
    target_erp: Mapped[str] = mapped_column(String(100), nullable=False)
    cursor_offset: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    batch_size: Mapped[int] = mapped_column(Integer, nullable=False, default=100)
    total_records: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    records_processed: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    records_failed: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    status: Mapped[str] = mapped_column(String(30), nullable=False, default="IN_PROGRESS")
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    def __repr__(self) -> str:
        return f"<SnapshotJob {self.entity_type} {self.source_erp}->{self.target_erp} offset={self.cursor_offset} status={self.status}>"
