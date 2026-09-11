"""
Durable Event Worker (Phase 3).

Mirrors `app.queue.worker.BackgroundWorker`'s exact start/stop/adaptive-
poll-interval shape (Section 15/24: reuse the proven pattern) with one
addition: a `NotifyListener` (see `notify.py`) that wakes the poll loop
immediately on a NOTIFY, rather than waiting for its own backoff
interval to elapse -- while never depending on that NOTIFY actually
arriving for correctness (see `notify.py`'s own docstring).

Dispatch is pluggable per consumer via `_CONSUMER_HANDLERS` -- adding a
new consumer means registering it (see
`service.bootstrap_default_consumers`) and adding one handler function
here, not modifying the claim/retry machinery itself.
"""

from __future__ import annotations

import asyncio
import socket
from datetime import datetime, timedelta, timezone

from app.core.logging import get_logger
from app.database.engine import get_sessionmaker
from app.durable_events.models import EventDelivery
from app.durable_events.notify import NotifyListener
from app.durable_events.repository import DeadLetterEventRepository, DurableEventRepository, EventDeliveryRepository
from app.durable_events.service import WEBSOCKET_CONSUMER_KEY

logger = get_logger(__name__)

_IDLE_POLL_INTERVAL = 5.0
_ACTIVE_POLL_INTERVAL = 0.5
_MAX_IDLE_POLL_INTERVAL = 30.0
_LEASE_SECONDS = 60
_BASE_RETRY_DELAY_SECONDS = 5
_MAX_RETRY_DELAY_SECONDS = 300

_WORKER_IDENTITY = f"{socket.gethostname()}:{id(object())}"


async def _dispatch_to_websocket(delivery: EventDelivery) -> None:
    """
    Handler for `WEBSOCKET_CONSUMER_KEY`: broadcast via the EXISTING `EventDispatcher`/`ConnectionManager`.

    This is the bridge Section 27 calls for ("do not rewrite the
    frontend WebSocket client") -- the durable event is converted to
    exactly the `Event` shape the current dispatcher already knows how
    to broadcast (`DurableEvent.to_envelope_dict()` matches
    `Event.to_dict()` field-for-field), so nothing downstream of this
    call needs to change.
    """
    from app.events.channels import module_channel
    from app.events.dispatcher import event_dispatcher
    from app.events.models import Event

    envelope = delivery.event.to_envelope_dict()
    event = Event(
        event_id=envelope["event_id"],
        event_type=envelope["event_type"],
        entity=envelope["entity"],
        entity_id=envelope["entity_id"],
        version=envelope["version"],
        user_id=envelope["user_id"],
        changes=envelope["changes"],
    )
    await event_dispatcher.publish(module_channel(delivery.event.entity), event)


_CONSUMER_HANDLERS = {
    WEBSOCKET_CONSUMER_KEY: _dispatch_to_websocket,
}


class DurableEventWorker:
    """Claims and processes durable-event deliveries for every registered consumer this process handles."""

    def __init__(self) -> None:
        """Initialize worker state. Does not start anything until `start()` is called."""
        self._stop_event = asyncio.Event()
        self._task: asyncio.Task | None = None
        self._notify_listener = NotifyListener(self._wake_up)
        self._wake_signal = asyncio.Event()

    @property
    def is_running(self) -> bool:
        """True if the worker's background task is currently active."""
        return self._task is not None and not self._task.done()

    async def start(self) -> None:
        """Launch the poll loop and the NOTIFY listener. Called once from `app.main.lifespan`. Idempotent."""
        if self.is_running:
            logger.warning("DurableEventWorker.start() called but worker is already running.")
            return
        self._stop_event.clear()
        await self._notify_listener.start()
        self._task = asyncio.create_task(self._run(), name="durable-events-worker")
        self._task.add_done_callback(self._on_task_done)
        logger.info("Durable events worker started.")

    async def stop(self) -> None:
        """Signal the poll loop to stop and wait for the current delivery (if any) to finish. Called at shutdown."""
        if not self.is_running:
            return
        logger.info("Stopping durable events worker (graceful)...")
        self._stop_event.set()
        await self._notify_listener.stop()
        if self._task is not None:
            try:
                await asyncio.wait_for(self._task, timeout=30.0)
            except asyncio.TimeoutError:
                logger.warning("Durable events worker did not stop within 30s; cancelling task.")
                self._task.cancel()
            except asyncio.CancelledError:
                pass
        logger.info("Durable events worker stopped.")

    def _wake_up(self) -> None:
        """Callback invoked by `NotifyListener` on each NOTIFY -- sets the wake signal the poll loop is waiting on."""
        self._wake_signal.set()

    def _on_task_done(self, task: asyncio.Task) -> None:
        """Log unexpected task completion (mirrors `BackgroundWorker`'s own crash-visibility behavior)."""
        exc = task.exception() if not task.cancelled() else None
        if exc is not None:
            logger.exception("Durable events worker task exited with an unexpected exception.", exc_info=exc)

    async def _run(self) -> None:
        """Main poll loop: claim and process one delivery per consumer this process handles, until stop() is called."""
        poll_interval = _IDLE_POLL_INTERVAL

        while not self._stop_event.is_set():
            any_processed = False
            for consumer_key in _CONSUMER_HANDLERS:
                processed = await self._process_one_delivery(consumer_key)
                any_processed = any_processed or processed

            poll_interval = _ACTIVE_POLL_INTERVAL if any_processed else min(poll_interval * 2, _MAX_IDLE_POLL_INTERVAL)

            self._wake_signal.clear()
            try:
                await asyncio.wait_for(asyncio.shield(self._race_stop_or_wake()), timeout=poll_interval)
            except asyncio.TimeoutError:
                pass
            if self._stop_event.is_set():
                break

    async def _race_stop_or_wake(self) -> None:
        """Return as soon as either stop() is called or a NOTIFY wake-up arrives, whichever is first."""
        stop_waiter = asyncio.create_task(self._stop_event.wait())
        wake_waiter = asyncio.create_task(self._wake_signal.wait())
        done, pending = await asyncio.wait({stop_waiter, wake_waiter}, return_when=asyncio.FIRST_COMPLETED)
        for task in pending:
            task.cancel()

    async def _process_one_delivery(self, consumer_key: str) -> bool:
        """
        Claim and process a single delivery for one consumer.

        Returns True if a delivery was claimed and processed (success,
        retry, or dead-letter all count as "there may be more work"),
        False if nothing was claimable.
        """
        session_factory = get_sessionmaker()
        async with session_factory() as session:
            delivery_repo = EventDeliveryRepository(session)

            try:
                delivery = await delivery_repo.claim_next(
                    consumer_key, claimed_by=_WORKER_IDENTITY, lease_seconds=_LEASE_SECONDS
                )
            except Exception:
                logger.exception(
                    "Error while claiming next durable-event delivery.", extra={"consumer_key": consumer_key}
                )
                await session.rollback()
                return False

            if delivery is None:
                return False

            await session.commit()  # commit the claim before any (possibly slow) dispatch work

        handler = _CONSUMER_HANDLERS.get(consumer_key)
        try:
            if handler is not None:
                await handler(delivery)
            await self._mark_success(delivery.id)
        except Exception as exc:  # noqa: BLE001 - any handler failure must be recorded via retry/dead-letter, never crash the worker
            await self._handle_failure(delivery, str(exc))

        return True

    async def _mark_success(self, delivery_id) -> None:
        """Mark a delivery successfully processed, in its own fresh session."""
        session_factory = get_sessionmaker()
        async with session_factory() as session:
            await EventDeliveryRepository(session).mark_success(delivery_id)
            await session.commit()

    async def _handle_failure(self, delivery: EventDelivery, error: str) -> None:
        """Schedule a retry (with exponential backoff) or dead-letter, in a fresh session."""
        session_factory = get_sessionmaker()
        async with session_factory() as session:
            delivery_repo = EventDeliveryRepository(session)

            if delivery.attempt_count + 1 >= delivery.max_attempts:
                updated = await delivery_repo.mark_dead_letter(delivery.id, error=error)
                await self._create_dead_letter_record(session, updated, error)
            else:
                delay_seconds = min(_BASE_RETRY_DELAY_SECONDS * (2**delivery.attempt_count), _MAX_RETRY_DELAY_SECONDS)
                available_at = datetime.now(timezone.utc) + timedelta(seconds=delay_seconds)
                await delivery_repo.mark_retry(delivery.id, available_at=available_at, error=error)

            await session.commit()

    async def _create_dead_letter_record(self, session, delivery: EventDelivery, error: str) -> None:
        """Create the diagnostic `DeadLetterEvent` row for a delivery that just exhausted its retries."""
        from app.durable_events.models import DeadLetterEvent

        now = datetime.now(timezone.utc)
        dead_letter_repo = DeadLetterEventRepository(session)
        existing = await dead_letter_repo.get_by_delivery_id(delivery.id)
        if existing is not None:
            return
        source_event = await DurableEventRepository(session).get_by_id(delivery.event_id)
        await dead_letter_repo.create(
            DeadLetterEvent(
                delivery_id=delivery.id,
                event_id=delivery.event_id,
                consumer_id=delivery.consumer_id,
                event_type=source_event.event_type if source_event else "unknown",
                attempt_count=delivery.attempt_count,
                first_failed_at=delivery.claimed_at or now,
                last_failed_at=now,
                failure_reason=error[:2000],
            )
        )


_worker: DurableEventWorker | None = None


def get_durable_event_worker() -> DurableEventWorker:
    """Return the process-wide `DurableEventWorker` singleton, creating it on first use."""
    global _worker
    if _worker is None:
        _worker = DurableEventWorker()
    return _worker
