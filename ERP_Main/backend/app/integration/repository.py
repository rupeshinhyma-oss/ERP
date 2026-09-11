"""Integration Control-Plane Repository -- pure DB access, no business rules (Phase 6)."""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.integration.models import (
    InboxEventStatus,
    IntegrationDeadLetter,
    IntegrationEntityMapping,
    IntegrationInboxEvent,
    IntegrationSubscription,
)


class IntegrationSubscriptionRepository:
    """Data access for the `integration_subscriptions` table."""

    def __init__(self, db: AsyncSession) -> None:
        """Store the request-scoped `AsyncSession`."""
        self.db = db

    async def get_by_id(self, subscription_id: uuid.UUID) -> IntegrationSubscription | None:
        """Fetch a subscription by id, or None if not found."""
        result = await self.db.execute(
            select(IntegrationSubscription).where(IntegrationSubscription.id == subscription_id)
        )
        return result.scalar_one_or_none()

    async def get_existing(
        self, event_type: str, source_erp_id: uuid.UUID, target_erp_id: uuid.UUID | None
    ) -> IntegrationSubscription | None:
        """Fetch the exact (event_type, source, target) subscription if one already exists."""
        result = await self.db.execute(
            select(IntegrationSubscription).where(
                IntegrationSubscription.event_type == event_type,
                IntegrationSubscription.source_erp_id == source_erp_id,
                IntegrationSubscription.target_erp_id == target_erp_id,
            )
        )
        return result.scalar_one_or_none()

    async def list_matching(self, event_type: str, source_erp_id: uuid.UUID) -> list[IntegrationSubscription]:
        """List every ENABLED subscription matching this event_type + source ERP (routing candidates)."""
        result = await self.db.execute(
            select(IntegrationSubscription).where(
                IntegrationSubscription.event_type == event_type,
                IntegrationSubscription.source_erp_id == source_erp_id,
                IntegrationSubscription.enabled.is_(True),
            )
        )
        return list(result.scalars().all())

    async def list_all(self) -> list[IntegrationSubscription]:
        """List every configured subscription, regardless of enabled state."""
        result = await self.db.execute(select(IntegrationSubscription).order_by(IntegrationSubscription.event_type))
        return list(result.scalars().all())

    async def create(self, subscription: IntegrationSubscription) -> IntegrationSubscription:
        """Persist a new subscription row and flush so its generated id is available."""
        self.db.add(subscription)
        await self.db.flush()
        await self.db.refresh(subscription)
        return subscription


class IntegrationInboxRepository:
    """Data access for the `integration_inbox_events` table."""

    def __init__(self, db: AsyncSession) -> None:
        """Store the request-scoped `AsyncSession`."""
        self.db = db

    async def get_by_id(self, inbox_event_id: uuid.UUID) -> IntegrationInboxEvent | None:
        """Fetch an inbox event by its own row id, or None if not found."""
        result = await self.db.execute(
            select(IntegrationInboxEvent).where(IntegrationInboxEvent.id == inbox_event_id)
        )
        return result.scalar_one_or_none()

    async def get_by_event_id(self, event_id: uuid.UUID) -> IntegrationInboxEvent | None:
        """Fetch an inbox event by the producer's own event_id (the dedup boundary), or None if not found."""
        result = await self.db.execute(
            select(IntegrationInboxEvent).where(IntegrationInboxEvent.event_id == event_id)
        )
        return result.scalar_one_or_none()

    async def list_recent(
        self,
        *,
        limit: int = 100,
        status: str | None = None,
        event_type: str | None = None,
        correlation_id: uuid.UUID | None = None,
    ) -> list[IntegrationInboxEvent]:
        """List recent inbox events, optionally filtered by status, event_type, or correlation_id."""
        query = select(IntegrationInboxEvent).order_by(IntegrationInboxEvent.created_at.desc()).limit(limit)
        if status is not None:
            query = query.where(IntegrationInboxEvent.status == status)
        if event_type is not None:
            query = query.where(IntegrationInboxEvent.event_type == event_type)
        if correlation_id is not None:
            query = query.where(IntegrationInboxEvent.correlation_id == correlation_id)
        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def list_routed_since(self, *, since_created_at, limit: int = 200) -> list[IntegrationInboxEvent]:
        """
        List every ROUTED event created after `since_created_at`, oldest first, for consumer polling.

        Fetches broadly by status/time and lets the caller (a target
        ERP's own consumer route) filter by whether its own key appears
        in `routed_to` -- `routed_to` is stored as a JSON-encoded text
        column, not a normalized join table, so filtering "is target X
        in this event's routed_to list" happens in Python, not SQL. At
        this phase's scale this is an accepted simplification (a known
        limitation, not an oversight); a high-volume deployment would
        want a normalized `integration_inbox_targets` table instead.
        """
        result = await self.db.execute(
            select(IntegrationInboxEvent)
            .where(
                IntegrationInboxEvent.status == InboxEventStatus.ROUTED,
                IntegrationInboxEvent.created_at > since_created_at,
            )
            .order_by(IntegrationInboxEvent.created_at.asc())
            .limit(limit)
        )
        return list(result.scalars().all())

    async def create(self, event: IntegrationInboxEvent) -> IntegrationInboxEvent:
        """Persist a new inbox event row and flush so its generated id is available."""
        self.db.add(event)
        await self.db.flush()
        await self.db.refresh(event)
        return event


class IntegrationEntityMappingRepository:
    """Data access for the `integration_entity_mappings` table."""

    def __init__(self, db: AsyncSession) -> None:
        """Store the request-scoped `AsyncSession`."""
        self.db = db

    async def get_existing(
        self,
        source_erp_id: uuid.UUID,
        source_entity_type: str,
        source_entity_id: uuid.UUID,
        target_erp_id: uuid.UUID,
        target_entity_type: str,
    ) -> IntegrationEntityMapping | None:
        """Fetch the exact mapping row if one already exists for this (source, target) pair."""
        result = await self.db.execute(
            select(IntegrationEntityMapping).where(
                IntegrationEntityMapping.source_erp_id == source_erp_id,
                IntegrationEntityMapping.source_entity_type == source_entity_type,
                IntegrationEntityMapping.source_entity_id == source_entity_id,
                IntegrationEntityMapping.target_erp_id == target_erp_id,
                IntegrationEntityMapping.target_entity_type == target_entity_type,
            )
        )
        return result.scalar_one_or_none()

    async def list_for_source_entity(
        self, source_erp_id: uuid.UUID, source_entity_type: str, source_entity_id: uuid.UUID
    ) -> list[IntegrationEntityMapping]:
        """List every mapping for a given source entity, across all target ERPs."""
        result = await self.db.execute(
            select(IntegrationEntityMapping).where(
                IntegrationEntityMapping.source_erp_id == source_erp_id,
                IntegrationEntityMapping.source_entity_type == source_entity_type,
                IntegrationEntityMapping.source_entity_id == source_entity_id,
            )
        )
        return list(result.scalars().all())

    async def create(self, mapping: IntegrationEntityMapping) -> IntegrationEntityMapping:
        """Persist a new mapping row and flush so its generated id is available."""
        self.db.add(mapping)
        await self.db.flush()
        await self.db.refresh(mapping)
        return mapping


class IntegrationDeadLetterRepository:
    """Data access for the `integration_dead_letters` table."""

    def __init__(self, db: AsyncSession) -> None:
        """Store the request-scoped `AsyncSession`."""
        self.db = db

    async def get_by_id(self, dead_letter_id: uuid.UUID) -> IntegrationDeadLetter | None:
        """Fetch a dead letter by id, or None if not found."""
        result = await self.db.execute(
            select(IntegrationDeadLetter).where(IntegrationDeadLetter.id == dead_letter_id)
        )
        return result.scalar_one_or_none()

    async def get_by_inbox_event_id(self, inbox_event_id: uuid.UUID) -> IntegrationDeadLetter | None:
        """Fetch the dead letter for a given inbox event, or None if it was never dead-lettered."""
        result = await self.db.execute(
            select(IntegrationDeadLetter).where(IntegrationDeadLetter.inbox_event_id == inbox_event_id)
        )
        return result.scalar_one_or_none()

    async def list_unreplayed(self, *, limit: int = 100) -> list[IntegrationDeadLetter]:
        """List dead letters that have not yet been successfully replayed, most recent first."""
        result = await self.db.execute(
            select(IntegrationDeadLetter)
            .where(IntegrationDeadLetter.replayed_at.is_(None))
            .order_by(IntegrationDeadLetter.failed_at.desc())
            .limit(limit)
        )
        return list(result.scalars().all())

    async def create(self, dead_letter: IntegrationDeadLetter) -> IntegrationDeadLetter:
        """Persist a new dead-letter row and flush so its generated id is available."""
        self.db.add(dead_letter)
        await self.db.flush()
        await self.db.refresh(dead_letter)
        return dead_letter
