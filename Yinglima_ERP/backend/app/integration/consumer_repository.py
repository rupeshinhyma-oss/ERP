"""Processed Events Repository -- the idempotency check every consumer handler goes through (Phase 6)."""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.integration.consumer_models import ProcessedIntegrationEvent


class ProcessedEventRepository:
    """Data access for the `processed_integration_events` table."""

    def __init__(self, db: AsyncSession) -> None:
        """Store the request-scoped `AsyncSession`."""
        self.db = db

    async def already_processed(self, event_id: uuid.UUID, consumer_id: str) -> bool:
        """Return True if this (event_id, consumer_id) pair has already been recorded as processed."""
        result = await self.db.execute(
            select(ProcessedIntegrationEvent.id).where(
                ProcessedIntegrationEvent.event_id == event_id,
                ProcessedIntegrationEvent.consumer_id == consumer_id,
            )
        )
        return result.scalar_one_or_none() is not None

    def mark_processed(self, event_id: uuid.UUID, consumer_id: str, event_type: str) -> ProcessedIntegrationEvent:
        """
        Add a processed-event record to the CURRENT session, without flushing.

        Deliberately mirrors `IntegrationOutboxRepository.add`'s own
        no-flush contract: the caller applies the actual business effect
        of the event AND records it as processed in the SAME
        transaction, so a crash between "applied the effect" and "marked
        processed" cannot happen -- either both happen, or neither does,
        and a retried poll safely reprocesses an event that never
        actually got marked.
        """
        record = ProcessedIntegrationEvent(event_id=event_id, consumer_id=consumer_id, event_type=event_type)
        self.db.add(record)
        return record
