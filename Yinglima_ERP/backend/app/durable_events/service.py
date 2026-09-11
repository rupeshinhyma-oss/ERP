"""
Durable Event Service (Phase 3).

`publish_durable_event` is the new entry point a route/service calls to
durably record an event before it is ever broadcast. It:

1. Deduplicates by `idempotency_key` if the caller supplies one
   (Section 8/21) -- a retried call with the SAME key returns the
   already-created event rather than creating a duplicate.
2. Writes the `DurableEvent` row AND fans it out to every currently-
   enabled `EventConsumer` (one `EventDelivery` row each) IN THE SAME
   TRANSACTION as the caller's own business write -- this is what
   Section 6/13 actually requires: the event's existence is exactly as
   durable as the business change that caused it.
3. Sends a best-effort `NOTIFY` (Section 24) so any listening worker
   wakes up immediately; delivery still happens on that worker's own
   next poll if the NOTIFY is missed.

This module does NOT broadcast to WebSockets itself -- that remains
`app.events.dispatcher.EventDispatcher`'s job, invoked by `worker.py`'s
own dispatch for the built-in WEBSOCKET_CONSUMER_KEY consumer.
"""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.durable_events.models import DeadLetterEvent, DeliveryStatus, DurableEvent, EventConsumer, EventDelivery
from app.durable_events.notify import notify_event_ready
from app.durable_events.repository import (
    DeadLetterEventRepository,
    DurableEventRepository,
    EventConsumerRepository,
    EventDeliveryRepository,
)

WEBSOCKET_CONSUMER_KEY = "yinglima.websocket"


class DurableEventService:
    """Publishing (producer side) and delivery-lifecycle operations (consumer side) over the durable event store."""

    def __init__(self, session: AsyncSession) -> None:
        """Wire the service to its repositories, all sharing the caller's own session/transaction."""
        self.session = session
        self.events = DurableEventRepository(session)
        self.consumers = EventConsumerRepository(session)
        self.deliveries = EventDeliveryRepository(session)
        self.dead_letters = DeadLetterEventRepository(session)

    async def publish_durable_event(
        self,
        *,
        event_type: str,
        source: str,
        entity: str,
        entity_id: str,
        entity_version: int | None = None,
        payload: dict[str, Any] | None = None,
        metadata: dict[str, Any] | None = None,
        idempotency_key: str | None = None,
        correlation_id: uuid.UUID | None = None,
        causation_id: uuid.UUID | None = None,
        user_id: str | None = None,
        target: str | None = None,
        priority: str = "normal",
    ) -> tuple[DurableEvent, bool]:
        """
        Durably record one event and fan it out to every enabled consumer.

        Returns `(event, was_newly_created)`. `was_newly_created=False`
        means an event with this exact `idempotency_key` already existed
        and was returned as-is (Section 8/21) -- the caller's retried
        publish attempt is safe to make freely.

        Does NOT call `session.commit()` -- the caller's own business
        transaction is what commits this row; publishing an event that
        then gets rolled back alongside a failed business write is the
        correct behavior (Section 6: the event must be at least as
        durable as, never MORE durable than, the change it describes).
        """
        if idempotency_key:
            existing = await self.events.get_by_idempotency_key(idempotency_key)
            if existing is not None:
                return existing, False

        event = DurableEvent(
            event_type=event_type,
            source=source,
            target=target,
            entity=entity,
            entity_id=entity_id,
            entity_version=entity_version,
            payload=json.dumps(payload or {}),
            event_metadata=json.dumps(metadata or {}),
            idempotency_key=idempotency_key,
            correlation_id=correlation_id or uuid.uuid4(),
            causation_id=causation_id,
            user_id=user_id,
            priority=priority,
            occurred_at=datetime.now(timezone.utc),
        )
        created = await self.events.create(event)

        enabled_consumers = await self.consumers.list_enabled()
        if enabled_consumers:
            await self.deliveries.create_for_fanout(created.id, [c.id for c in enabled_consumers])

        await notify_event_ready(self.session)
        return created, True

    async def replay_dead_letter(self, dead_letter_id: uuid.UUID, *, replayed_by: str) -> EventDelivery:
        """
        Reset a dead-lettered delivery back to PENDING with a fresh attempt budget (Section 20).

        Idempotent: replaying an already-SUCCESS delivery (e.g. a
        concurrent worker recovered it first) is a safe no-op.
        """
        dead_letter = await self.session.get(DeadLetterEvent, dead_letter_id)
        if dead_letter is None:
            raise ValueError(f"No dead letter found with id {dead_letter_id}.")

        delivery = await self.deliveries.get_by_id(dead_letter.delivery_id)
        if delivery is None:
            raise ValueError("The original delivery for this dead letter no longer exists.")

        if delivery.status.value == "SUCCESS":
            return delivery

        now = datetime.now(timezone.utc)
        await self.session.execute(
            update(EventDelivery)
            .where(EventDelivery.id == delivery.id)
            .values(
                status=DeliveryStatus.PENDING,
                attempt_count=0,
                available_at=now,
                last_error=None,
                claimed_by=None,
                lease_expires_at=None,
            )
        )
        dead_letter.replayed_at = now
        dead_letter.replayed_by = replayed_by
        await self.session.flush()
        await notify_event_ready(self.session)

        result = await self.session.execute(select(EventDelivery).where(EventDelivery.id == delivery.id))
        return result.scalar_one()


async def bootstrap_default_consumers(session: AsyncSession) -> None:
    """
    Ensure the built-in WebSocket consumer is registered (Section 22).

    Called once at application startup. Idempotent, safe to call on
    every boot. A future module registers its own consumer the same
    way, typically from its own startup code.
    """
    repo = EventConsumerRepository(session)
    existing = await repo.get_by_key(WEBSOCKET_CONSUMER_KEY)
    if existing is None:
        await repo.create(
            EventConsumer(
                consumer_key=WEBSOCKET_CONSUMER_KEY,
                description="Dispatches durable events to connected WebSocket clients via the existing app.events.dispatcher.",
                enabled=True,
            )
        )
        await session.commit()
