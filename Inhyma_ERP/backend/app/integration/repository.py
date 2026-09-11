"""
Integration Outbox & Delivery Repository (Phase 6 & Phase 8F).

Provides atomic PostgreSQL row-level locking (SELECT ... FOR UPDATE SKIP LOCKED),
lease expiration recovery, multi-target fan-out creation, and delivery state tracking.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Sequence

from sqlalchemy import and_, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.integration.models import (
    DeliveryStatus,
    IntegrationOutboxDelivery,
    IntegrationOutboxEvent,
    OutboxEventStatus,
)
from app.integration.reliability import sanitize_error


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class IntegrationOutboxRepository:
    """Data access for outbox events and their independent target deliveries."""

    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def get_by_id(self, outbox_event_id: uuid.UUID) -> IntegrationOutboxEvent | None:
        """Fetch an outbox event by its own row id."""
        result = await self.db.execute(
            select(IntegrationOutboxEvent)
            .options(selectinload(IntegrationOutboxEvent.deliveries))
            .where(IntegrationOutboxEvent.id == outbox_event_id)
        )
        return result.scalar_one_or_none()

    async def get_by_event_id(self, event_id: uuid.UUID) -> IntegrationOutboxEvent | None:
        """Fetch an outbox event by its domain envelope event_id."""
        result = await self.db.execute(
            select(IntegrationOutboxEvent)
            .options(selectinload(IntegrationOutboxEvent.deliveries))
            .where(IntegrationOutboxEvent.event_id == event_id)
        )
        return result.scalar_one_or_none()

    async def get_delivery_by_id(self, delivery_id: uuid.UUID) -> IntegrationOutboxDelivery | None:
        """Fetch an outbox delivery by its row id with parent outbox event loaded."""
        result = await self.db.execute(
            select(IntegrationOutboxDelivery)
            .options(selectinload(IntegrationOutboxDelivery.outbox_event))
            .where(IntegrationOutboxDelivery.id == delivery_id)
        )
        return result.scalar_one_or_none()

    def add(self, event: IntegrationOutboxEvent) -> IntegrationOutboxEvent:
        """Add an outbox event to the current session without flushing."""
        self.db.add(event)
        return event

    async def save(self, event: IntegrationOutboxEvent) -> IntegrationOutboxEvent:
        """Flush and refresh an outbox event."""
        await self.db.flush()
        await self.db.refresh(event)
        return event

    async def create_deliveries_for_event(
        self,
        outbox_event_id: uuid.UUID,
        targets: Sequence[str],
        *,
        initial_attempt_count: int = 0,
        max_attempts: int = 5,
    ) -> list[IntegrationOutboxDelivery]:
        """
        Create independent PENDING delivery rows for each destination target (fan-out).
        """
        now = _utcnow()
        created: list[IntegrationOutboxDelivery] = []
        for target in targets:
            delivery = IntegrationOutboxDelivery(
                id=uuid.uuid4(),
                outbox_event_id=outbox_event_id,
                target_erp=target.lower().strip(),
                status=DeliveryStatus.PENDING,
                attempt_count=initial_attempt_count,
                max_attempts=max_attempts,
                next_attempt_at=now,
            )
            self.db.add(delivery)
            created.append(delivery)
        await self.db.flush()
        return created

    async def claim_next_batch(
        self,
        worker_id: str,
        batch_size: int = 10,
        lease_seconds: int = 60,
    ) -> list[IntegrationOutboxDelivery]:
        """
        Atomically claim due deliveries using PostgreSQL SELECT ... FOR UPDATE SKIP LOCKED.
        Claims due PENDING/RETRYING deliveries OR expired PROCESSING deliveries.
        """
        now = _utcnow()
        lease_expires_at = now + timedelta(seconds=lease_seconds)

        stmt = (
            select(IntegrationOutboxDelivery)
            .options(selectinload(IntegrationOutboxDelivery.outbox_event))
            .where(
                or_(
                    and_(
                        IntegrationOutboxDelivery.status.in_([DeliveryStatus.PENDING, DeliveryStatus.RETRYING]),
                        IntegrationOutboxDelivery.next_attempt_at <= now,
                    ),
                    and_(
                        IntegrationOutboxDelivery.status == DeliveryStatus.PROCESSING,
                        IntegrationOutboxDelivery.lease_expires_at < now,
                    ),
                )
            )
            .order_by(IntegrationOutboxDelivery.next_attempt_at.asc())
            .limit(batch_size)
            .with_for_update(skip_locked=True)
        )

        res = await self.db.execute(stmt)
        deliveries = list(res.scalars().all())

        if not deliveries:
            return []

        delivery_ids = [d.id for d in deliveries]
        await self.db.execute(
            update(IntegrationOutboxDelivery)
            .where(IntegrationOutboxDelivery.id.in_(delivery_ids))
            .values(
                status=DeliveryStatus.PROCESSING,
                worker_id=worker_id,
                lease_expires_at=lease_expires_at,
                last_attempt_at=now,
            )
        )
        await self.db.flush()

        for d in deliveries:
            d.status = DeliveryStatus.PROCESSING
            d.worker_id = worker_id
            d.lease_expires_at = lease_expires_at
            d.last_attempt_at = now

        return deliveries

    async def recover_stuck_deliveries(self, older_than_seconds: int = 60) -> int:
        """
        Safety crash recovery: reset PROCESSING deliveries with expired leases back to RETRYING.
        """
        now = _utcnow()
        cutoff = now - timedelta(seconds=older_than_seconds)

        stmt = (
            update(IntegrationOutboxDelivery)
            .where(
                and_(
                    IntegrationOutboxDelivery.status == DeliveryStatus.PROCESSING,
                    or_(
                        IntegrationOutboxDelivery.lease_expires_at < now,
                        and_(
                            IntegrationOutboxDelivery.lease_expires_at.is_(None),
                            IntegrationOutboxDelivery.last_attempt_at <= cutoff,
                        ),
                    ),
                )
            )
            .values(
                status=DeliveryStatus.RETRYING,
                worker_id=None,
                lease_expires_at=None,
                next_attempt_at=now,
            )
            .returning(IntegrationOutboxDelivery.id)
        )
        res = await self.db.execute(stmt)
        recovered_ids = res.fetchall()
        await self.db.flush()
        return len(recovered_ids)

    async def mark_delivery_success(self, delivery_id: uuid.UUID) -> IntegrationOutboxDelivery | None:
        """
        Mark delivery as DELIVERED. If all sibling deliveries for the event succeeded,
        update parent IntegrationOutboxEvent to PUBLISHED.
        """
        now = _utcnow()
        delivery = await self.get_delivery_by_id(delivery_id)
        if delivery is None:
            return None

        delivery.status = DeliveryStatus.DELIVERED
        delivery.delivered_at = now
        delivery.lease_expires_at = None
        delivery.worker_id = None
        await self.db.flush()

        # Check all sibling deliveries
        pending_siblings_stmt = select(func.count(IntegrationOutboxDelivery.id)).where(
            IntegrationOutboxDelivery.outbox_event_id == delivery.outbox_event_id,
            IntegrationOutboxDelivery.status != DeliveryStatus.DELIVERED,
        )
        pending_count = (await self.db.execute(pending_siblings_stmt)).scalar_one()

        if pending_count == 0 and delivery.outbox_event:
            delivery.outbox_event.status = OutboxEventStatus.PUBLISHED
            delivery.outbox_event.published_at = now
            delivery.outbox_event.attempt_count = delivery.attempt_count
            await self.db.flush()

        return delivery

    async def mark_delivery_failure(
        self,
        delivery_id: uuid.UUID,
        *,
        retryable: bool,
        next_attempt_at: datetime | None,
        error_code: str = "",
        error_msg: str = "",
    ) -> IntegrationOutboxDelivery | None:
        """
        Record delivery failure, applying bounded retry or moving to DEAD_LETTER.
        """
        now = _utcnow()
        delivery = await self.get_delivery_by_id(delivery_id)
        if delivery is None:
            return None

        delivery.attempt_count += 1
        delivery.last_error_code = error_code[:100] if error_code else None
        delivery.last_error_message = sanitize_error(error_msg)
        delivery.lease_expires_at = None
        delivery.worker_id = None

        if delivery.outbox_event:
            delivery.outbox_event.attempt_count = delivery.attempt_count
            delivery.outbox_event.last_error = delivery.last_error_message

        if not retryable or delivery.attempt_count >= delivery.max_attempts:
            delivery.status = DeliveryStatus.DEAD_LETTER
            if delivery.outbox_event:
                delivery.outbox_event.status = OutboxEventStatus.DEAD_LETTER
        else:
            delivery.status = DeliveryStatus.RETRYING
            delivery.next_attempt_at = next_attempt_at or now
            if delivery.outbox_event:
                delivery.outbox_event.status = OutboxEventStatus.FAILED

        await self.db.flush()
        return delivery

    async def list_dead_letters(
        self,
        limit: int = 100,
        target_erp: str | None = None,
    ) -> list[IntegrationOutboxDelivery]:
        """List dead-letter deliveries for operator diagnosis and replay."""
        stmt = (
            select(IntegrationOutboxDelivery)
            .options(selectinload(IntegrationOutboxDelivery.outbox_event))
            .where(IntegrationOutboxDelivery.status == DeliveryStatus.DEAD_LETTER)
        )
        if target_erp:
            stmt = stmt.where(IntegrationOutboxDelivery.target_erp == target_erp.lower().strip())
        stmt = stmt.order_by(IntegrationOutboxDelivery.created_at.desc()).limit(limit)
        res = await self.db.execute(stmt)
        return list(res.scalars().all())

    async def list_pending(self, *, limit: int = 50) -> list[IntegrationOutboxEvent]:
        """Backward-compatible helper listing parent events with active pending status."""
        result = await self.db.execute(
            select(IntegrationOutboxEvent)
            .options(selectinload(IntegrationOutboxEvent.deliveries))
            .where(IntegrationOutboxEvent.status.in_([OutboxEventStatus.PENDING, OutboxEventStatus.FAILED]))
            .order_by(IntegrationOutboxEvent.created_at.asc())
            .limit(limit)
        )
        return list(result.scalars().all())
