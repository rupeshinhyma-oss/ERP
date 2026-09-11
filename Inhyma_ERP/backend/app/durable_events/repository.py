"""Durable Event Repository -- pure DB access, no business rules (Phase 3)."""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import and_, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.durable_events.models import DeadLetterEvent, DeliveryStatus, DurableEvent, EventConsumer, EventDelivery

_DEFAULT_LEASE_SECONDS = 60


class DurableEventRepository:
    """Data access for `durable_events`."""

    def __init__(self, session: AsyncSession) -> None:
        """Store the request-scoped `AsyncSession`."""
        self.session = session

    async def get_by_idempotency_key(self, idempotency_key: str) -> DurableEvent | None:
        """Fetch an existing event by its caller-supplied dedup key (Section 8/21), or None if not found."""
        result = await self.session.execute(
            select(DurableEvent).where(DurableEvent.idempotency_key == idempotency_key)
        )
        return result.scalar_one_or_none()

    async def get_by_id(self, event_id: uuid.UUID) -> DurableEvent | None:
        """Fetch an event by its own id."""
        result = await self.session.execute(select(DurableEvent).where(DurableEvent.id == event_id))
        return result.scalar_one_or_none()

    async def create(self, event: DurableEvent) -> DurableEvent:
        """Persist a new event row and flush so its generated id is available."""
        self.session.add(event)
        await self.session.flush()
        await self.session.refresh(event)
        return event


class EventConsumerRepository:
    """Data access for `event_consumers`."""

    def __init__(self, session: AsyncSession) -> None:
        """Store the request-scoped `AsyncSession`."""
        self.session = session

    async def get_by_key(self, consumer_key: str) -> EventConsumer | None:
        """Fetch a registered consumer by its stable key, or None if not registered."""
        result = await self.session.execute(select(EventConsumer).where(EventConsumer.consumer_key == consumer_key))
        return result.scalar_one_or_none()

    async def list_enabled(self) -> list[EventConsumer]:
        """List every currently-enabled consumer (Section 22) -- what a new event fans out to."""
        result = await self.session.execute(select(EventConsumer).where(EventConsumer.enabled.is_(True)))
        return list(result.scalars().all())

    async def create(self, consumer: EventConsumer) -> EventConsumer:
        """Persist a new consumer row and flush so its generated id is available."""
        self.session.add(consumer)
        await self.session.flush()
        await self.session.refresh(consumer)
        return consumer


class EventDeliveryRepository:
    """Data access for `event_deliveries` -- the atomic claim/lease/ack layer (Section 15-17/21)."""

    def __init__(self, session: AsyncSession) -> None:
        """Store the request-scoped `AsyncSession`."""
        self.session = session

    async def create_for_fanout(self, event_id: uuid.UUID, consumer_ids: list[uuid.UUID]) -> list[EventDelivery]:
        """
        Create one PENDING delivery row per consumer for a newly-created event (Section 12: fan-out).

        Each insert is individually guarded against the
        `UNIQUE(event_id, consumer_id)` constraint (Section 21's
        infrastructure-level idempotency boundary) -- if a delivery row
        for this exact (event, consumer) pair already exists, that one
        insert is silently skipped rather than raising, and every OTHER
        consumer's delivery still gets created normally.
        """
        now = datetime.now(timezone.utc)
        created: list[EventDelivery] = []
        for consumer_id in consumer_ids:
            delivery = EventDelivery(event_id=event_id, consumer_id=consumer_id, available_at=now)
            self.session.add(delivery)
            try:
                await self.session.flush()
                created.append(delivery)
            except IntegrityError:
                await self.session.rollback()
        return created

    async def claim_next(
        self, consumer_key: str, *, claimed_by: str, lease_seconds: int = _DEFAULT_LEASE_SECONDS
    ) -> EventDelivery | None:
        """
        Atomically claim the next deliverable delivery for one consumer.

        Mirrors `app.queue.repository.QueueRepository.claim_next_job`'s
        exact `SELECT ... FOR UPDATE SKIP LOCKED` pattern (Section 15) --
        so multiple worker processes for the SAME consumer never claim
        the same delivery, and a slow delivery in one worker never
        blocks another worker from claiming the next one.

        A delivery is claimable if it is PENDING or RETRY and due
        (`available_at <= now`), OR if it is PROCESSING but its lease
        has expired (Section 16: the previous claimant crashed without
        acknowledging).
        """
        now = datetime.now(timezone.utc)
        stmt = (
            select(EventDelivery)
            .join(EventConsumer, EventDelivery.consumer_id == EventConsumer.id)
            .options(selectinload(EventDelivery.event), selectinload(EventDelivery.consumer))
            .where(
                EventConsumer.consumer_key == consumer_key,
                EventConsumer.enabled.is_(True),
                or_(
                    and_(
                        EventDelivery.status.in_([DeliveryStatus.PENDING, DeliveryStatus.RETRY]),
                        EventDelivery.available_at <= now,
                    ),
                    and_(EventDelivery.status == DeliveryStatus.PROCESSING, EventDelivery.lease_expires_at < now),
                ),
            )
            .order_by(EventDelivery.available_at.asc())
            .limit(1)
            .with_for_update(skip_locked=True)
        )
        result = await self.session.execute(stmt)
        delivery = result.scalar_one_or_none()
        if delivery is None:
            return None

        lease_expires_at = now + timedelta(seconds=lease_seconds)
        await self.session.execute(
            update(EventDelivery)
            .where(EventDelivery.id == delivery.id)
            .values(
                status=DeliveryStatus.PROCESSING, claimed_by=claimed_by, claimed_at=now, lease_expires_at=lease_expires_at
            )
        )
        await self.session.flush()
        await self.session.refresh(delivery, attribute_names=["status", "claimed_by", "claimed_at", "lease_expires_at"])
        return delivery

    async def mark_success(self, delivery_id: uuid.UUID) -> None:
        """Mark a delivery as successfully processed (Section 17: acknowledgment)."""
        await self.session.execute(
            update(EventDelivery)
            .where(EventDelivery.id == delivery_id)
            .values(status=DeliveryStatus.SUCCESS, processed_at=datetime.now(timezone.utc), lease_expires_at=None)
        )

    async def mark_retry(self, delivery_id: uuid.UUID, *, available_at: datetime, error: str) -> EventDelivery:
        """Schedule a retry for a temporarily-failed delivery, incrementing its attempt count."""
        await self.session.execute(
            update(EventDelivery)
            .where(EventDelivery.id == delivery_id)
            .values(
                status=DeliveryStatus.RETRY,
                attempt_count=EventDelivery.attempt_count + 1,
                available_at=available_at,
                last_error=error[:2000],
                claimed_by=None,
                lease_expires_at=None,
            )
        )
        await self.session.flush()
        result = await self.session.execute(select(EventDelivery).where(EventDelivery.id == delivery_id))
        return result.scalar_one()

    async def mark_dead_letter(self, delivery_id: uuid.UUID, *, error: str) -> EventDelivery:
        """Mark a delivery permanently failed (attempts exhausted or a non-retriable error)."""
        await self.session.execute(
            update(EventDelivery)
            .where(EventDelivery.id == delivery_id)
            .values(
                status=DeliveryStatus.DEAD_LETTER,
                attempt_count=EventDelivery.attempt_count + 1,
                last_error=error[:2000],
                claimed_by=None,
                lease_expires_at=None,
            )
        )
        await self.session.flush()
        result = await self.session.execute(select(EventDelivery).where(EventDelivery.id == delivery_id))
        return result.scalar_one()

    async def get_by_id(self, delivery_id: uuid.UUID) -> EventDelivery | None:
        """Fetch a delivery by id."""
        result = await self.session.execute(select(EventDelivery).where(EventDelivery.id == delivery_id))
        return result.scalar_one_or_none()

    async def list_for_event(self, event_id: uuid.UUID) -> list[EventDelivery]:
        """
        List every consumer's delivery state for one event (Section 20/38 diagnostics).

        Eagerly loads `.consumer` via `selectinload` -- callers routinely
        read `delivery.consumer.consumer_key` for display purposes, and
        under SQLAlchemy's async engine a lazy-loaded relationship
        accessed after the originating `await` completes (e.g. from a
        route handler's response-building code, or a test's assertions
        after a commit) raises `MissingGreenlet` rather than silently
        working the way sync SQLAlchemy would.
        """
        from sqlalchemy.orm import selectinload

        result = await self.session.execute(
            select(EventDelivery).where(EventDelivery.event_id == event_id).options(selectinload(EventDelivery.consumer))
        )
        return list(result.scalars().all())


class DeadLetterEventRepository:
    """Data access for `dead_letter_events`."""

    def __init__(self, session: AsyncSession) -> None:
        """Store the request-scoped `AsyncSession`."""
        self.session = session

    async def get_by_delivery_id(self, delivery_id: uuid.UUID) -> DeadLetterEvent | None:
        """Fetch the dead-letter row for a given delivery, or None if it was never dead-lettered."""
        result = await self.session.execute(select(DeadLetterEvent).where(DeadLetterEvent.delivery_id == delivery_id))
        return result.scalar_one_or_none()

    async def list_unreplayed(self, *, limit: int = 100) -> list[DeadLetterEvent]:
        """List dead letters not yet successfully replayed, most recent first (Section 20)."""
        result = await self.session.execute(
            select(DeadLetterEvent)
            .where(DeadLetterEvent.replayed_at.is_(None))
            .order_by(DeadLetterEvent.last_failed_at.desc())
            .limit(limit)
        )
        return list(result.scalars().all())

    async def create(self, dead_letter: DeadLetterEvent) -> DeadLetterEvent:
        """Persist a new dead-letter row and flush so its generated id is available."""
        self.session.add(dead_letter)
        await self.session.flush()
        await self.session.refresh(dead_letter)
        return dead_letter
