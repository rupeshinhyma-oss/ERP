"""
Phase 6 Integration (Outbox) Tests.

Two layers, matching this repo's own test conventions (see
`test_queue.py`'s own docstring: "in-memory / mock objects" for pure
unit tests):

- Real-SQLite-backed tests for `publish_event`/`dispatch_event`'s
  actual database behavior (transactionality, status transitions,
  idempotent re-dispatch) -- mocks cannot prove atomic commit/rollback,
  so these use a genuine (in-memory) SQLite engine.
- Mock-based tests for the HTTP dispatch logic (success, network
  failure, non-2xx response, retry-vs-dead-letter), mirroring
  `test_queue.py`'s own `unittest.mock` style exactly.
"""

from __future__ import annotations

import json
import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.database.base import Base
from app.integration.models import IntegrationOutboxEvent, OutboxEventStatus
from app.integration.repository import IntegrationOutboxRepository
from app.integration.service import IntegrationService

pytestmark = pytest.mark.asyncio


@pytest.fixture
async def db_session():
    """A fresh, isolated in-memory SQLite session with every table created (Base.metadata)."""
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    session_factory = async_sessionmaker(bind=engine, class_=AsyncSession, expire_on_commit=False)
    async with session_factory() as session:
        yield session
    await engine.dispose()


class TestPublishEvent:
    """Tests for `IntegrationService.publish_event` -- the transactional outbox write."""

    async def test_publish_event_adds_row_without_flushing(self, db_session):
        """publish_event() must add to the session but not flush/commit -- callers control the transaction boundary."""
        service = IntegrationService(IntegrationOutboxRepository(db_session))
        event = service.publish_event(
            event_type="buyer.created",
            aggregate_type="buyer",
            aggregate_id=uuid.uuid4(),
            payload={"buyer_id": "x"},
        )
        assert event in db_session.new  # pending in the session, not yet flushed to the DB

    async def test_publish_event_generates_unique_event_id(self, db_session):
        """Each call generates a fresh, never-reused event_id (Section 5)."""
        service = IntegrationService(IntegrationOutboxRepository(db_session))
        event1 = service.publish_event(
            event_type="buyer.created", aggregate_type="buyer", aggregate_id=uuid.uuid4(), payload={}
        )
        event2 = service.publish_event(
            event_type="buyer.created", aggregate_type="buyer", aggregate_id=uuid.uuid4(), payload={}
        )
        assert event1.event_id != event2.event_id

    async def test_publish_event_rolls_back_with_business_transaction(self, db_session):
        """
        If the surrounding transaction rolls back, the outbox row must roll back with it (Section 9).

        Simulates "business write + outbox write, then something fails
        before commit" by never committing at all and instead rolling
        back -- the row must not be visible afterward.
        """
        service = IntegrationService(IntegrationOutboxRepository(db_session))
        event = service.publish_event(
            event_type="buyer.created", aggregate_type="buyer", aggregate_id=uuid.uuid4(), payload={}
        )
        await db_session.flush()
        event_id = event.id
        await db_session.rollback()

        found = await IntegrationOutboxRepository(db_session).get_by_id(event_id)
        assert found is None

    async def test_publish_event_commits_with_business_transaction(self, db_session):
        """If the surrounding transaction commits, the outbox row must persist and be independently queryable."""
        service = IntegrationService(IntegrationOutboxRepository(db_session))
        event = service.publish_event(
            event_type="buyer.created", aggregate_type="buyer", aggregate_id=uuid.uuid4(), payload={"x": 1}
        )
        await db_session.commit()

        found = await IntegrationOutboxRepository(db_session).get_by_id(event.id)
        assert found is not None
        assert found.status == OutboxEventStatus.PENDING
        assert json.loads(found.payload) == {"x": 1}


class TestDispatchEvent:
    """Tests for `IntegrationService.dispatch_event` -- HTTP delivery to ERP_Main."""

    async def _create_and_commit_event(self, db_session, **overrides) -> IntegrationOutboxEvent:
        """Create and commit one outbox event, returning it, for dispatch tests to act on."""
        service = IntegrationService(IntegrationOutboxRepository(db_session))
        defaults = dict(
            event_type="buyer.created", aggregate_type="buyer", aggregate_id=uuid.uuid4(), payload={"buyer_id": "x"}
        )
        defaults.update(overrides)
        event = service.publish_event(**defaults)
        await db_session.commit()
        return event

    async def test_dispatch_success_marks_published(self, db_session):
        """A successful POST (2xx) marks the event PUBLISHED and sets published_at."""
        event = await self._create_and_commit_event(db_session)
        service = IntegrationService(IntegrationOutboxRepository(db_session))

        mock_response = MagicMock(status_code=201, text="")
        with patch("httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client.post = AsyncMock(return_value=mock_response)
            mock_client_cls.return_value.__aenter__.return_value = mock_client
            await service.dispatch_event(event.id)

        refreshed = await IntegrationOutboxRepository(db_session).get_by_id(event.id)
        assert refreshed.status == OutboxEventStatus.PUBLISHED
        assert refreshed.published_at is not None

    async def test_dispatch_network_failure_marks_failed_and_retriable(self, db_session):
        """A network error increments attempt_count and marks FAILED (still retriable, well under max_attempts)."""
        event = await self._create_and_commit_event(db_session)
        service = IntegrationService(IntegrationOutboxRepository(db_session))

        import httpx as httpx_module

        with patch("httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client.post = AsyncMock(side_effect=httpx_module.ConnectError("connection refused"))
            mock_client_cls.return_value.__aenter__.return_value = mock_client
            await service.dispatch_event(event.id)

        refreshed = await IntegrationOutboxRepository(db_session).get_by_id(event.id)
        assert refreshed.status == OutboxEventStatus.FAILED
        assert refreshed.attempt_count == 1
        assert refreshed.is_retriable

    async def test_dispatch_non_2xx_response_marks_failed(self, db_session):
        """A non-2xx response (e.g. 500 from ERP_Main) is treated as a failure, not a crash."""
        event = await self._create_and_commit_event(db_session)
        service = IntegrationService(IntegrationOutboxRepository(db_session))

        mock_response = MagicMock(status_code=500, text="internal error")
        with patch("httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client.post = AsyncMock(return_value=mock_response)
            mock_client_cls.return_value.__aenter__.return_value = mock_client
            await service.dispatch_event(event.id)

        refreshed = await IntegrationOutboxRepository(db_session).get_by_id(event.id)
        assert refreshed.status == OutboxEventStatus.FAILED
        assert "500" in refreshed.last_error

    async def test_dispatch_exhausted_retries_dead_letters(self, db_session):
        """Once attempt_count reaches max_attempts, the NEXT failure dead-letters rather than marking FAILED again."""
        event = await self._create_and_commit_event(db_session)
        # Pre-set attempt_count to max_attempts (simulating prior failed attempts) so the NEXT failure exhausts retries.
        event.max_attempts = 2
        event.attempt_count = 2
        await db_session.commit()

        service = IntegrationService(IntegrationOutboxRepository(db_session))
        with patch("httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client.post = AsyncMock(side_effect=Exception("still down"))
            mock_client_cls.return_value.__aenter__.return_value = mock_client
            await service.dispatch_event(event.id)

        refreshed = await IntegrationOutboxRepository(db_session).get_by_id(event.id)
        assert refreshed.status == OutboxEventStatus.DEAD_LETTER
        assert not refreshed.is_retriable

    async def test_dispatch_already_published_is_idempotent_noop(self, db_session):
        """Re-dispatching an already-PUBLISHED event does nothing (no second HTTP call)."""
        event = await self._create_and_commit_event(db_session)
        event.status = OutboxEventStatus.PUBLISHED
        await db_session.commit()

        service = IntegrationService(IntegrationOutboxRepository(db_session))
        with patch("httpx.AsyncClient") as mock_client_cls:
            await service.dispatch_event(event.id)
            mock_client_cls.assert_not_called()

    async def test_dispatch_nonexistent_event_id_does_not_raise(self, db_session):
        """Dispatching a nonexistent outbox_event_id logs and returns, never raises (defensive against stale jobs)."""
        service = IntegrationService(IntegrationOutboxRepository(db_session))
        await service.dispatch_event(uuid.uuid4())  # must not raise


class TestEventTypeValidation:
    """Tests for the event_type shape validator on the ORM model."""

    def test_valid_event_type_accepted(self):
        """A well-formed lowercase-dotted event_type is accepted."""
        event = IntegrationOutboxEvent(
            event_id=uuid.uuid4(),
            event_type="buyer.created",
            aggregate_type="buyer",
            aggregate_id=uuid.uuid4(),
            correlation_id=uuid.uuid4(),
            actor_type="user",
            payload="{}",
        )
        assert event.event_type == "buyer.created"

    def test_malformed_event_type_rejected(self):
        """An event_type with no dot, or uppercase letters, is rejected at construction time."""
        with pytest.raises(ValueError):
            IntegrationOutboxEvent(
                event_id=uuid.uuid4(),
                event_type="BuyerCreated",
                aggregate_type="buyer",
                aggregate_id=uuid.uuid4(),
                correlation_id=uuid.uuid4(),
                actor_type="user",
                payload="{}",
            )


class TestEnqueuePoll:
    """Tests for `enqueue_poll`'s duplicate-pending-job guard."""

    async def test_enqueue_poll_creates_a_job(self, db_session):
        """A fresh call with no existing pending poll job creates one."""
        from app.integration.jobs import enqueue_poll
        from app.queue.service import QueueService
        from app.queue.models import QueueJob
        from sqlalchemy import select

        queue_service = QueueService(db_session)
        await enqueue_poll(queue_service)
        await db_session.commit()

        result = await db_session.execute(select(QueueJob).where(QueueJob.job_name == "poll_integration_inbox"))
        jobs = result.scalars().all()
        assert len(jobs) == 1

    async def test_enqueue_poll_is_a_noop_if_one_already_pending(self, db_session):
        """Calling enqueue_poll twice while one is still PENDING does not create a second job."""
        from app.integration.jobs import enqueue_poll
        from app.queue.service import QueueService
        from app.queue.models import QueueJob
        from sqlalchemy import select

        queue_service = QueueService(db_session)
        await enqueue_poll(queue_service)
        await enqueue_poll(queue_service)
        await db_session.commit()

        result = await db_session.execute(select(QueueJob).where(QueueJob.job_name == "poll_integration_inbox"))
        jobs = result.scalars().all()
        assert len(jobs) == 1


class TestConsumerService:
    """Tests for `ConsumerService.poll_and_process` -- idempotent consumption, handler isolation."""

    async def test_poll_and_process_invokes_registered_handler(self, db_session):
        """An event whose event_type has a registered handler invokes it exactly once."""
        from unittest.mock import AsyncMock
        from app.integration.consumer_repository import ProcessedEventRepository
        from app.integration.consumer_service import ConsumerService, register_consumer, _registry

        _registry.clear()
        mock_handler = AsyncMock()
        register_consumer("buyer.created")(mock_handler)

        event_id = str(uuid.uuid4())
        fake_response_data = {
            "data": [
                {
                    "event_id": event_id,
                    "event_type": "buyer.created",
                    "payload": '{"buyer_id": "x"}',
                    "source_erp_id": "some-erp-id",
                }
            ]
        }
        mock_response = MagicMock(status_code=200)
        mock_response.json = MagicMock(return_value=fake_response_data)

        service = ConsumerService(ProcessedEventRepository(db_session))
        with patch("httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client.get = AsyncMock(return_value=mock_response)
            mock_client_cls.return_value.__aenter__.return_value = mock_client
            summary = await service.poll_and_process()

        assert summary == {"fetched": 1, "processed": 1, "skipped_duplicate": 0}
        mock_handler.assert_awaited_once()
        _registry.clear()

    async def test_poll_and_process_skips_already_processed_event(self, db_session):
        """An event already marked processed is skipped without re-invoking its handler."""
        from unittest.mock import AsyncMock
        from app.integration.consumer_repository import ProcessedEventRepository
        from app.integration.consumer_service import ConsumerService, register_consumer, _registry

        _registry.clear()
        mock_handler = AsyncMock()
        register_consumer("buyer.created")(mock_handler)

        event_id = uuid.uuid4()
        repo = ProcessedEventRepository(db_session)
        repo.mark_processed(event_id, "default", "buyer.created")
        await db_session.commit()

        fake_response_data = {
            "data": [
                {
                    "event_id": str(event_id),
                    "event_type": "buyer.created",
                    "payload": '{"buyer_id": "x"}',
                    "source_erp_id": "some-erp-id",
                }
            ]
        }
        mock_response = MagicMock(status_code=200)
        mock_response.json = MagicMock(return_value=fake_response_data)

        service = ConsumerService(repo)
        with patch("httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client.get = AsyncMock(return_value=mock_response)
            mock_client_cls.return_value.__aenter__.return_value = mock_client
            summary = await service.poll_and_process()

        assert summary == {"fetched": 1, "processed": 0, "skipped_duplicate": 1}
        mock_handler.assert_not_awaited()
        _registry.clear()

    async def test_poll_and_process_event_with_no_handler_is_still_marked_processed(self, db_session):
        """An event_type with no registered handler is marked processed anyway (never re-fetched forever)."""
        from app.integration.consumer_repository import ProcessedEventRepository
        from app.integration.consumer_service import ConsumerService, _registry

        _registry.clear()
        event_id = str(uuid.uuid4())
        fake_response_data = {
            "data": [
                {
                    "event_id": event_id,
                    "event_type": "nothing.registered_for_this",
                    "payload": "{}",
                    "source_erp_id": "some-erp-id",
                }
            ]
        }
        mock_response = MagicMock(status_code=200)
        mock_response.json = MagicMock(return_value=fake_response_data)

        service = ConsumerService(ProcessedEventRepository(db_session))
        with patch("httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client.get = AsyncMock(return_value=mock_response)
            mock_client_cls.return_value.__aenter__.return_value = mock_client
            summary = await service.poll_and_process()

        assert summary["processed"] == 1
        assert await service.repository.already_processed(uuid.UUID(event_id), "default")

    async def test_poll_and_process_handler_failure_does_not_mark_processed(self, db_session):
        """If a handler raises, the event is NOT marked processed, so the next poll retries it."""
        from unittest.mock import AsyncMock
        from app.integration.consumer_repository import ProcessedEventRepository
        from app.integration.consumer_service import ConsumerService, register_consumer, _registry

        _registry.clear()
        failing_handler = AsyncMock(side_effect=RuntimeError("handler bug"))
        register_consumer("buyer.created")(failing_handler)

        event_id = uuid.UUID(str(uuid.uuid4()))
        fake_response_data = {
            "data": [
                {
                    "event_id": str(event_id),
                    "event_type": "buyer.created",
                    "payload": "{}",
                    "source_erp_id": "some-erp-id",
                }
            ]
        }
        mock_response = MagicMock(status_code=200)
        mock_response.json = MagicMock(return_value=fake_response_data)

        service = ConsumerService(ProcessedEventRepository(db_session))
        with patch("httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client.get = AsyncMock(return_value=mock_response)
            mock_client_cls.return_value.__aenter__.return_value = mock_client
            summary = await service.poll_and_process()

        assert summary["processed"] == 0
        assert not await service.repository.already_processed(event_id, "default")
        _registry.clear()

    async def test_poll_failure_raises_consumer_poll_error(self, db_session):
        """If ERP_Main itself is unreachable, poll_and_process raises ConsumerPollError rather than silently doing nothing."""
        from app.integration.consumer_repository import ProcessedEventRepository
        from app.integration.consumer_service import ConsumerPollError, ConsumerService

        service = ConsumerService(ProcessedEventRepository(db_session))
        with patch("httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client.get = AsyncMock(side_effect=Exception("connection refused"))
            mock_client_cls.return_value.__aenter__.return_value = mock_client
            with pytest.raises(ConsumerPollError):
                await service.poll_and_process()
