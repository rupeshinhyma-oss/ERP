"""
Durable Events Test Suite (Phase 3).

Runs against a REAL PostgreSQL database -- `event_deliveries.claim_next`
relies on `SELECT ... FOR UPDATE SKIP LOCKED`, a genuine PostgreSQL
row-locking behavior no SQLite-backed test could meaningfully exercise
(matching this repo's own existing precedent: Yinglima's tests already
require Postgres).
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest
import pytest_asyncio

from sqlalchemy import select

from app.database.engine import dispose_engine, get_sessionmaker
from app.durable_events.models import DeadLetterEvent, EventConsumer
from app.durable_events.repository import (
    DeadLetterEventRepository,
    EventConsumerRepository,
    EventDeliveryRepository,
)
from app.durable_events.service import DurableEventService

pytestmark = pytest.mark.asyncio


@pytest_asyncio.fixture
async def db_session():
    """
    A real session against the test Postgres database, rolled back after each test for isolation.

    Disposes the process-wide async engine both before and after each
    test: `pytest.ini`'s own `asyncio_default_fixture_loop_scope =
    function` gives every test a FRESH event loop, but
    `app.database.engine`'s engine/connection-pool are deliberately
    process-wide singletons (by design, for the running application) --
    without disposal, a connection created on test N's event loop is
    reused on test N+1's DIFFERENT event loop and asyncpg raises
    "attached to a different loop". This is a test-harness-only
    concern; the actual running application only ever has one event
    loop for its whole process lifetime and never hits this.
    """
    await dispose_engine()
    session_factory = get_sessionmaker()
    async with session_factory() as session:
        yield session
        await session.rollback()

    # Final safety net: some tests intentionally open extra sessions of
    # their own (e.g. the concurrent-claim test), which can leave a
    # dependent fixture's own per-test cleanup (see registered_consumer)
    # unable to run cleanly on this test's specific event-loop/session
    # lifecycle. Sweeping here, in db_session's own teardown -- the
    # single fixture every test in this file already depends on --
    # guarantees the cleanup runs exactly once per test regardless of
    # which other fixtures a given test used.
    try:
        async with get_sessionmaker()() as cleanup_session:
            result = await cleanup_session.execute(
                select(EventConsumer).where(EventConsumer.consumer_key.like("test.consumer.%"))
            )
            for consumer in result.scalars().all():
                await cleanup_session.delete(consumer)
            await cleanup_session.commit()
    except Exception:  # noqa: BLE001 - best-effort test hygiene; never fail the test itself over cleanup
        pass

    await dispose_engine()


@pytest_asyncio.fixture
async def registered_consumer(db_session):
    """Ensure a uniquely-named test consumer is registered, returning its key. Cleaned up by db_session's own teardown."""
    consumer_key = f"test.consumer.{uuid.uuid4()}"
    repo = EventConsumerRepository(db_session)
    await repo.create(EventConsumer(consumer_key=consumer_key, description="test", enabled=True))
    await db_session.commit()
    return consumer_key


class TestPublishDurableEvent:
    """Publishing: durability, transactionality, idempotency."""

    async def test_publish_creates_event_and_fans_out_to_enabled_consumers(self, db_session, registered_consumer):
        service = DurableEventService(db_session)
        event, created = await service.publish_durable_event(
            event_type="buyer.updated", source="yinglima", entity="buyer", entity_id=str(uuid.uuid4())
        )
        await db_session.commit()

        assert created is True
        deliveries = await EventDeliveryRepository(db_session).list_for_event(event.id)
        assert any(d.consumer.consumer_key == registered_consumer for d in deliveries)

    async def test_idempotency_key_deduplicates_across_calls(self, db_session, registered_consumer):
        key = f"idem-{uuid.uuid4()}"
        service = DurableEventService(db_session)

        event1, created1 = await service.publish_durable_event(
            event_type="buyer.created", source="yinglima", entity="buyer", entity_id="b1", idempotency_key=key
        )
        await db_session.commit()

        event2, created2 = await service.publish_durable_event(
            event_type="buyer.created", source="yinglima", entity="buyer", entity_id="b1", idempotency_key=key
        )
        await db_session.commit()

        assert event1.id == event2.id
        assert created1 is True
        assert created2 is False

    async def test_no_idempotency_key_always_creates_a_new_event(self, db_session, registered_consumer):
        service = DurableEventService(db_session)
        event1, _ = await service.publish_durable_event(
            event_type="buyer.created", source="yinglima", entity="buyer", entity_id="b1"
        )
        event2, _ = await service.publish_durable_event(
            event_type="buyer.created", source="yinglima", entity="buyer", entity_id="b1"
        )
        await db_session.commit()
        assert event1.id != event2.id

    async def test_publish_with_zero_enabled_consumers_still_creates_the_event(self, db_session):
        """An event can exist with no fan-out yet -- never an error."""
        service = DurableEventService(db_session)
        event, created = await service.publish_durable_event(
            event_type="isolated.test.event", source="yinglima", entity="isolated", entity_id="x1"
        )
        await db_session.commit()
        assert created is True
        assert event.id is not None


class TestClaimAndDeliveryLifecycle:
    """The atomic claim/success/retry/dead-letter state machine."""

    async def test_claim_next_marks_delivery_processing_and_sets_a_lease(self, db_session, registered_consumer):
        service = DurableEventService(db_session)
        event, _ = await service.publish_durable_event(
            event_type="buyer.updated", source="yinglima", entity="buyer", entity_id="b1"
        )
        await db_session.commit()

        delivery_repo = EventDeliveryRepository(db_session)
        claimed = await delivery_repo.claim_next(registered_consumer, claimed_by="test-worker")
        await db_session.commit()

        assert claimed is not None
        assert claimed.status.value == "PROCESSING"
        assert claimed.claimed_by == "test-worker"
        assert claimed.lease_expires_at is not None

    async def test_claim_next_returns_none_when_nothing_is_claimable(self, db_session, registered_consumer):
        delivery_repo = EventDeliveryRepository(db_session)
        claimed = await delivery_repo.claim_next(registered_consumer, claimed_by="test-worker")
        assert claimed is None

    async def test_two_concurrent_claims_never_return_the_same_delivery(self, db_session, registered_consumer):
        """The core SELECT FOR UPDATE SKIP LOCKED guarantee: two independent sessions claiming concurrently never collide."""
        service = DurableEventService(db_session)
        event, _ = await service.publish_durable_event(
            event_type="buyer.updated", source="yinglima", entity="buyer", entity_id="b1"
        )
        await db_session.commit()

        session_factory = get_sessionmaker()
        async with session_factory() as session_a, session_factory() as session_b:
            claim_a = await EventDeliveryRepository(session_a).claim_next(registered_consumer, claimed_by="worker-a")
            claim_b = await EventDeliveryRepository(session_b).claim_next(registered_consumer, claimed_by="worker-b")
            await session_a.commit()
            await session_b.commit()

        results = [claim_a, claim_b]
        successful = [c for c in results if c is not None]
        assert len(successful) == 1

    async def test_mark_success_sets_status_and_processed_at(self, db_session, registered_consumer):
        service = DurableEventService(db_session)
        event, _ = await service.publish_durable_event(
            event_type="buyer.updated", source="yinglima", entity="buyer", entity_id="b1"
        )
        await db_session.commit()

        delivery_repo = EventDeliveryRepository(db_session)
        claimed = await delivery_repo.claim_next(registered_consumer, claimed_by="test-worker")
        await delivery_repo.mark_success(claimed.id)
        await db_session.commit()

        updated = await delivery_repo.get_by_id(claimed.id)
        assert updated.status.value == "SUCCESS"
        assert updated.processed_at is not None

    async def test_mark_retry_increments_attempt_count_and_schedules_future_availability(
        self, db_session, registered_consumer
    ):
        service = DurableEventService(db_session)
        event, _ = await service.publish_durable_event(
            event_type="buyer.updated", source="yinglima", entity="buyer", entity_id="b1"
        )
        await db_session.commit()

        delivery_repo = EventDeliveryRepository(db_session)
        claimed = await delivery_repo.claim_next(registered_consumer, claimed_by="test-worker")
        future = datetime.now(timezone.utc) + timedelta(seconds=30)
        updated = await delivery_repo.mark_retry(claimed.id, available_at=future, error="temporary failure")
        await db_session.commit()

        assert updated.status.value == "RETRY"
        assert updated.attempt_count == 1
        assert updated.available_at > datetime.now(timezone.utc)

    async def test_mark_dead_letter_sets_terminal_status(self, db_session, registered_consumer):
        service = DurableEventService(db_session)
        event, _ = await service.publish_durable_event(
            event_type="buyer.updated", source="yinglima", entity="buyer", entity_id="b1"
        )
        await db_session.commit()

        delivery_repo = EventDeliveryRepository(db_session)
        claimed = await delivery_repo.claim_next(registered_consumer, claimed_by="test-worker")
        updated = await delivery_repo.mark_dead_letter(claimed.id, error="permanent failure")
        await db_session.commit()

        assert updated.status.value == "DEAD_LETTER"


class TestDeadLetterReplay:
    """Authorized replay of a dead-lettered delivery."""

    async def test_replay_resets_delivery_to_pending_with_fresh_attempts(self, db_session, registered_consumer):
        service = DurableEventService(db_session)
        event, _ = await service.publish_durable_event(
            event_type="buyer.updated", source="yinglima", entity="buyer", entity_id="b1"
        )
        await db_session.commit()

        delivery_repo = EventDeliveryRepository(db_session)
        claimed = await delivery_repo.claim_next(registered_consumer, claimed_by="test-worker")
        dead = await delivery_repo.mark_dead_letter(claimed.id, error="boom")

        dl_repo = DeadLetterEventRepository(db_session)
        now = datetime.now(timezone.utc)
        dead_letter_record = await dl_repo.create(
            DeadLetterEvent(
                delivery_id=dead.id,
                event_id=event.id,
                consumer_id=dead.consumer_id,
                event_type=event.event_type,
                attempt_count=dead.attempt_count,
                first_failed_at=now,
                last_failed_at=now,
                failure_reason="boom",
            )
        )
        await db_session.commit()

        replayed = await service.replay_dead_letter(dead_letter_record.id, replayed_by="admin-user")
        await db_session.commit()

        assert replayed.status.value == "PENDING"
        assert replayed.attempt_count == 0

        refreshed_dl = await dl_repo.get_by_delivery_id(dead.id)
        assert refreshed_dl.replayed_at is not None
        assert refreshed_dl.replayed_by == "admin-user"

    async def test_replaying_an_already_successful_delivery_is_a_safe_noop(self, db_session, registered_consumer):
        service = DurableEventService(db_session)
        event, _ = await service.publish_durable_event(
            event_type="buyer.updated", source="yinglima", entity="buyer", entity_id="b1"
        )
        await db_session.commit()

        delivery_repo = EventDeliveryRepository(db_session)
        claimed = await delivery_repo.claim_next(registered_consumer, claimed_by="test-worker")

        dl_repo = DeadLetterEventRepository(db_session)
        now = datetime.now(timezone.utc)
        dead_letter_record = await dl_repo.create(
            DeadLetterEvent(
                delivery_id=claimed.id,
                event_id=event.id,
                consumer_id=claimed.consumer_id,
                event_type=event.event_type,
                attempt_count=1,
                first_failed_at=now,
                last_failed_at=now,
                failure_reason="boom",
            )
        )
        await delivery_repo.mark_success(claimed.id)  # a concurrent worker recovered it first
        await db_session.commit()

        result = await service.replay_dead_letter(dead_letter_record.id, replayed_by="admin-user")
        assert result.status.value == "SUCCESS"  # untouched, not reset to PENDING


class TestModelValidation:
    """Model-level invariants."""

    async def test_event_delivery_unique_constraint_prevents_duplicate_fanout(self, db_session, registered_consumer):
        service = DurableEventService(db_session)
        event, _ = await service.publish_durable_event(
            event_type="buyer.updated", source="yinglima", entity="buyer", entity_id="b1"
        )
        await db_session.commit()

        consumer = await EventConsumerRepository(db_session).get_by_key(registered_consumer)
        delivery_repo = EventDeliveryRepository(db_session)
        created = await delivery_repo.create_for_fanout(event.id, [consumer.id])
        assert created == []  # already existed from the original publish's own fan-out
