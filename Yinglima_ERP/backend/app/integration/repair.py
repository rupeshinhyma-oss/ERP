"""
Replay and Repair Service (Phase 8E & Phase 8F).

Provides audit-safe mechanisms to:
1. Repair missing entity mappings where matching local records exist.
2. Re-resolve conflicting mappings.
3. Replay failed or dead-letter outbox deliveries, preserving original event IDs,
   correlation IDs, and version contexts for idempotent consumer processing.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.logging import get_logger
from app.integration.adapters.buyer import BuyerSyncAdapter
from app.integration.models import (
    DeliveryStatus,
    IntegrationOutboxDelivery,
    IntegrationOutboxEvent,
    OutboxEventStatus,
)
from app.integration.sync_models import SyncedEntityMapping

logger = get_logger(__name__)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class RepairService:
    """Provides administrative repair and replay actions for cross-ERP synchronization."""

    def __init__(self, db: AsyncSession) -> None:
        self.db = db
        self._adapters = {"buyer": BuyerSyncAdapter()}

    async def repair_missing_mapping(
        self,
        source_erp_id: str,
        entity_type: str,
        source_entity_id: str,
        payload: dict[str, Any],
    ) -> SyncedEntityMapping | None:
        """
        Attempt to discover and establish a missing identity mapping without creating duplicate records.
        """
        norm_type = entity_type.strip().lower()

        # Check if already mapped
        existing = await self.db.execute(
            select(SyncedEntityMapping).where(
                SyncedEntityMapping.source_erp_id == source_erp_id,
                SyncedEntityMapping.entity_type == norm_type,
                SyncedEntityMapping.source_entity_id == source_entity_id,
            )
        )
        existing_obj = existing.scalar_one_or_none()
        if existing_obj is not None:
            return existing_obj

        adapter = self._adapters.get(norm_type)
        if adapter is None:
            raise ValueError(f"No adapter available for entity type '{entity_type}'.")

        matched = await adapter.find_existing_by_natural_key(self.db, payload)
        if matched is None:
            logger.info("Repair mapping: no matching local entity found for natural key.", extra={"payload": payload})
            return None

        local_id, local_ver = matched
        mapping = SyncedEntityMapping(
            source_erp_id=source_erp_id,
            entity_type=norm_type,
            source_entity_id=source_entity_id,
            local_entity_id=local_id,
            source_version=payload.get("version", 1),
            local_version=local_ver,
            sync_status="ACTIVE",
            last_synced_at=_utcnow(),
        )
        self.db.add(mapping)
        await self.db.commit()
        logger.info(
            "Successfully repaired missing entity mapping.",
            extra={"source_entity_id": source_entity_id, "local_id": str(local_id)},
        )
        return mapping

    async def retry_outbox_event(self, outbox_event_id: uuid.UUID) -> bool:
        """Reset a dead-letter or failed outbox event and its deliveries back to PENDING."""
        stmt = (
            select(IntegrationOutboxEvent)
            .options(selectinload(IntegrationOutboxEvent.deliveries))
            .where(IntegrationOutboxEvent.id == outbox_event_id)
        )
        res = await self.db.execute(stmt)
        event = res.scalar_one_or_none()
        if event is None:
            return False

        event.status = OutboxEventStatus.PENDING
        event.attempt_count = 0
        event.last_error = None

        now = _utcnow()
        for d in event.deliveries:
            d.status = DeliveryStatus.PENDING
            d.attempt_count = 0
            d.next_attempt_at = now
            d.last_error_code = None
            d.last_error_message = None

        await self.db.commit()
        logger.info("Reset outbox event and deliveries for retry.", extra={"outbox_event_id": str(outbox_event_id)})
        return True

    async def replay_dead_letter_delivery(
        self,
        delivery_id: uuid.UUID,
        actor_id: uuid.UUID | None = None,
    ) -> bool:
        """
        Safely replay one dead-lettered delivery (Phase 8F).
        Preserves original event_id, correlation_id, and OCC version context.
        """
        stmt = (
            select(IntegrationOutboxDelivery)
            .options(selectinload(IntegrationOutboxDelivery.outbox_event))
            .where(IntegrationOutboxDelivery.id == delivery_id)
        )
        res = await self.db.execute(stmt)
        delivery = res.scalar_one_or_none()
        if delivery is None:
            return False

        now = _utcnow()
        delivery.status = DeliveryStatus.PENDING
        delivery.attempt_count = 0
        delivery.next_attempt_at = now
        delivery.last_error_code = None
        delivery.last_error_message = None
        delivery.worker_id = None
        delivery.lease_expires_at = None

        if delivery.outbox_event:
            delivery.outbox_event.status = OutboxEventStatus.PENDING
            delivery.outbox_event.last_error = None

        await self.db.commit()
        logger.info(
            "Replayed dead-letter delivery %s (event_id=%s, target=%s). Action by actor=%s.",
            delivery_id,
            delivery.outbox_event.event_id if delivery.outbox_event else "unknown",
            delivery.target_erp,
            actor_id,
            extra={
                "delivery_id": str(delivery_id),
                "target_erp": delivery.target_erp,
                "actor_id": str(actor_id) if actor_id else None,
            },
        )
        return True

    async def bulk_replay_dead_letters(
        self,
        target_erp: str | None = None,
        limit: int = 50,
        actor_id: uuid.UUID | None = None,
    ) -> int:
        """
        Bounded bulk replay of dead-letter deliveries with operator audit.
        """
        safe_limit = min(max(1, limit), 100)
        stmt = (
            select(IntegrationOutboxDelivery)
            .options(selectinload(IntegrationOutboxDelivery.outbox_event))
            .where(IntegrationOutboxDelivery.status == DeliveryStatus.DEAD_LETTER)
        )
        if target_erp:
            stmt = stmt.where(IntegrationOutboxDelivery.target_erp == target_erp.lower().strip())
        stmt = stmt.order_by(IntegrationOutboxDelivery.created_at.asc()).limit(safe_limit)

        res = await self.db.execute(stmt)
        deliveries = list(res.scalars().all())

        now = _utcnow()
        for d in deliveries:
            d.status = DeliveryStatus.PENDING
            d.attempt_count = 0
            d.next_attempt_at = now
            d.last_error_code = None
            d.last_error_message = None
            d.worker_id = None
            d.lease_expires_at = None
            if d.outbox_event:
                d.outbox_event.status = OutboxEventStatus.PENDING
                d.outbox_event.last_error = None

        await self.db.commit()
        logger.info(
            "Bulk replayed %d dead-letter deliveries for target_erp=%s. Action by actor=%s.",
            len(deliveries),
            target_erp,
            actor_id,
        )
        return len(deliveries)
