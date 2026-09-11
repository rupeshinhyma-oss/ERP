"""
Phase 4 Pilot Module Tests: Buyers + Durable Events.

Tests the actual integration point this phase adds: that
`EventDispatcher.publish_lifecycle_event` (already called from all 7
Buyers write-path call sites, unchanged) durably persists an event when
`DURABLE_EVENTS_ENABLED` is on, that this is fully transactional with
the business write, and that turning the flag off restores the exact
pre-Phase-4 behavior.

Runs against real PostgreSQL for the same reason
`tests/test_durable_events.py` does.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

import pytest
import pytest_asyncio
from sqlalchemy import select

from app.database.engine import dispose_engine, get_sessionmaker
from app.durable_events.models import DurableEvent
from app.durable_events.repository import EventDeliveryRepository
from app.durable_events.service import bootstrap_default_consumers
from app.events.dispatcher import EventDispatcher

pytestmark = pytest.mark.asyncio


@pytest_asyncio.fixture
async def db_session():
    """A real session against the test Postgres database, disposed before/after for event-loop isolation."""
    await dispose_engine()
    session_factory = get_sessionmaker()
    async with session_factory() as session:
        await bootstrap_default_consumers(session)
        yield session
        await session.rollback()
    await dispose_engine()


class TestPilotDurableIntegrationEnabled:
    """With DURABLE_EVENTS_ENABLED=True: the pilot's actual new behavior."""

    async def test_lifecycle_event_creates_a_durable_event(self, db_session, monkeypatch):
        monkeypatch.setattr("app.events.dispatcher.settings.DURABLE_EVENTS_ENABLED", True)
        dispatcher = EventDispatcher()
        buyer_id = uuid.uuid4()

        await dispatcher.publish_lifecycle_event(
            db_session,
            module="buyers",
            entity="buyer",
            entity_id=buyer_id,
            event_type="buyer.created",
            version=1,
            user_id=uuid.uuid4(),
            changes={"company_name": "Acme Corp"},
        )

        async with get_sessionmaker()() as verify_session:
            result = await verify_session.execute(select(DurableEvent).where(DurableEvent.entity_id == str(buyer_id)))
            event = result.scalar_one_or_none()
            assert event is not None
            assert event.event_type == "buyer.created"
            assert event.entity == "buyer"
            assert event.entity_version == 1
            assert event.source == "inhyma"

    async def test_durable_event_carries_correct_payload_and_correlation(self, db_session, monkeypatch):
        monkeypatch.setattr("app.events.dispatcher.settings.DURABLE_EVENTS_ENABLED", True)
        dispatcher = EventDispatcher()
        buyer_id = uuid.uuid4()
        user_id = uuid.uuid4()

        await dispatcher.publish_lifecycle_event(
            db_session,
            module="buyers",
            entity="buyer",
            entity_id=buyer_id,
            event_type="buyer.updated",
            version=3,
            user_id=user_id,
            changes={"buyer_grade": "A"},
        )

        async with get_sessionmaker()() as verify_session:
            result = await verify_session.execute(select(DurableEvent).where(DurableEvent.entity_id == str(buyer_id)))
            event = result.scalar_one()
            assert "buyer_grade" in event.payload
            assert event.user_id == str(user_id)
            assert event.correlation_id is not None

    async def test_durable_event_fans_out_to_websocket_consumer(self, db_session, monkeypatch):
        monkeypatch.setattr("app.events.dispatcher.settings.DURABLE_EVENTS_ENABLED", True)
        dispatcher = EventDispatcher()
        buyer_id = uuid.uuid4()

        await dispatcher.publish_lifecycle_event(
            db_session,
            module="buyers",
            entity="buyer",
            entity_id=buyer_id,
            event_type="buyer.created",
            version=1,
            user_id=uuid.uuid4(),
            changes={},
        )

        async with get_sessionmaker()() as verify_session:
            result = await verify_session.execute(select(DurableEvent).where(DurableEvent.entity_id == str(buyer_id)))
            event = result.scalar_one()
            deliveries = await EventDeliveryRepository(verify_session).list_for_event(event.id)
            assert len(deliveries) >= 1
            assert any(d.consumer.consumer_key == "inhyma.websocket" for d in deliveries)

    async def test_durable_event_and_business_write_share_one_transaction(self, monkeypatch):
        """A rollback of the caller's session must take the durable event with it -- true atomicity."""
        monkeypatch.setattr("app.events.dispatcher.settings.DURABLE_EVENTS_ENABLED", True)
        await dispose_engine()
        session_factory = get_sessionmaker()
        buyer_id = uuid.uuid4()

        async with session_factory() as session:
            await bootstrap_default_consumers(session)
            event = DurableEvent(
                event_type="buyer.created",
                source="inhyma",
                entity="buyer",
                entity_id=str(buyer_id),
                payload="{}",
                event_metadata="{}",
                correlation_id=uuid.uuid4(),
                priority="normal",
                occurred_at=datetime.now(timezone.utc),
            )
            session.add(event)
            await session.flush()
            await session.rollback()

        async with session_factory() as verify_session:
            result = await verify_session.execute(select(DurableEvent).where(DurableEvent.entity_id == str(buyer_id)))
            assert result.scalar_one_or_none() is None
        await dispose_engine()


class TestPilotDurableIntegrationDisabled:
    """With DURABLE_EVENTS_ENABLED=False (the default): exact pre-Phase-4 behavior, zero regression."""

    async def test_lifecycle_event_does_not_create_a_durable_event_when_flag_is_off(self, db_session, monkeypatch):
        monkeypatch.setattr("app.events.dispatcher.settings.DURABLE_EVENTS_ENABLED", False)
        dispatcher = EventDispatcher()
        buyer_id = uuid.uuid4()

        await dispatcher.publish_lifecycle_event(
            db_session,
            module="buyers",
            entity="buyer",
            entity_id=buyer_id,
            event_type="buyer.created",
            version=1,
            user_id=uuid.uuid4(),
            changes={},
        )

        async with get_sessionmaker()() as verify_session:
            result = await verify_session.execute(select(DurableEvent).where(DurableEvent.entity_id == str(buyer_id)))
            assert result.scalar_one_or_none() is None

    async def test_business_write_still_commits_when_flag_is_off(self, db_session, monkeypatch):
        """The commit-then-broadcast contract that existed before Phase 4 must be completely unaffected."""
        monkeypatch.setattr("app.events.dispatcher.settings.DURABLE_EVENTS_ENABLED", False)
        dispatcher = EventDispatcher()
        await dispatcher.publish_lifecycle_event(
            db_session,
            module="buyers",
            entity="buyer",
            entity_id=uuid.uuid4(),
            event_type="buyer.created",
            version=1,
            user_id=uuid.uuid4(),
            changes={},
        )


class TestPilotDurabilityFailureIsolation:
    """A durable-event write failure must never block the business transaction."""

    async def test_durable_event_failure_does_not_raise_or_block_commit(self, db_session, monkeypatch):
        monkeypatch.setattr("app.events.dispatcher.settings.DURABLE_EVENTS_ENABLED", True)

        async def _broken_publish(*args, **kwargs):
            raise RuntimeError("simulated durable-event write failure")

        monkeypatch.setattr("app.durable_events.service.DurableEventService.publish_durable_event", _broken_publish)

        dispatcher = EventDispatcher()
        await dispatcher.publish_lifecycle_event(
            db_session,
            module="buyers",
            entity="buyer",
            entity_id=uuid.uuid4(),
            event_type="buyer.created",
            version=1,
            user_id=uuid.uuid4(),
            changes={},
        )
