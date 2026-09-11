"""
Integration Queue Job Handler (Phase 6, producer side).

Registers `dispatch_integration_event` with the existing job registry
(`app.queue.registry`) -- this is the ONE new job handler Phase 6 adds,
reusing `app.queue`'s own worker, retry/backoff, and priority ordering
wholesale rather than building a second dispatch loop (Section 12).

A business service calls `enqueue_dispatch(...)` (this module) right
after `IntegrationService.publish_event(...)` inside the SAME request/
transaction -- enqueuing the job is itself just another row in the same
session (`QueueService.create_job` uses the same `AsyncSession`), so the
business write, the outbox write, AND the job enqueue all commit
together atomically. The job then runs later, in the worker's own
process loop, with its own fresh session -- by which point the outbox
row is guaranteed to be visible (the transaction that created it has
already committed).
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

from app.core.logging import get_logger
from app.database.engine import get_sessionmaker
from app.integration.consumer_repository import ProcessedEventRepository
from app.integration.consumer_service import ConsumerPollError, ConsumerService
from app.integration.repository import IntegrationOutboxRepository
from app.integration.service import IntegrationService
from app.queue.constants import JobPriority
from app.queue.registry import register
from app.queue.service import QueueService

logger = get_logger(__name__)

_JOB_NAME = "dispatch_integration_event"
_MODULE_NAME = "integration"


async def enqueue_dispatch(queue_service, *, outbox_event_id: uuid.UUID) -> None:
    """
    Enqueue a queue job to dispatch one outbox event.

    Call this with the SAME `QueueService` (and therefore the same
    `AsyncSession`/transaction) as the business write and the
    `publish_event(...)` call that created `outbox_event_id` -- all
    three become one atomic unit.
    """
    await queue_service.create_job(
        job_name=_JOB_NAME,
        module=_MODULE_NAME,
        payload={"outbox_event_id": str(outbox_event_id)},
        priority=JobPriority.NORMAL,
        max_retries=5,
    )


@register(_JOB_NAME)
async def dispatch_integration_event(payload: dict) -> None:
    """
    Worker-invoked handler: dispatch one outbox event to ERP_Main.

    Opens its OWN session (the worker calls handlers with only a
    payload dict, never a session -- see `app.queue.worker`), separate
    from whatever session created the outbox row in the first place.
    Raises on failure so the worker's own existing retry/backoff
    (`QueueService.mark_job_failed_or_retry`) takes over -- this handler
    itself does not implement a second retry loop; `IntegrationService.
    dispatch_event` already recorded the specific outbox-row failure
    reason before this re-raises for the queue's benefit.
    """
    outbox_event_id = uuid.UUID(payload["outbox_event_id"])
    session_factory = get_sessionmaker()
    async with session_factory() as session:
        service = IntegrationService(IntegrationOutboxRepository(session))
        await service.dispatch_event(outbox_event_id)
        await session.commit()

    # Re-fetch the row's final status in a fresh, short-lived session to
    # decide whether the QUEUE job itself should also be considered
    # failed (and thus retried by the worker) -- `dispatch_event` already
    # recorded FAILED/DEAD_LETTER on the outbox row; raising here as well
    # is what makes the *queue job* retry, which is what actually
    # schedules the next dispatch attempt.
    async with session_factory() as session:
        outbox_row = await IntegrationOutboxRepository(session).get_by_id(outbox_event_id)
        if outbox_row is not None and outbox_row.status.value in ("FAILED", "DEAD_LETTER"):
            raise RuntimeError(f"Integration event dispatch failed: {outbox_row.last_error}")


_POLL_JOB_NAME = "poll_integration_inbox"
_POLL_INTERVAL_SECONDS = 15


async def enqueue_poll(queue_service, *, run_at=None) -> None:
    """
    Enqueue (or re-enqueue) the recurring inbox-poll job.

    Guards against duplicate pending poll jobs piling up across
    restarts (Section 51: backpressure) -- if a PENDING
    `poll_integration_inbox` job already exists, this is a no-op rather
    than adding a second one. The self-perpetuating job (see
    `poll_integration_inbox` below) only ever has one PENDING instance
    in flight at a time by construction (it enqueues its own next run
    only after finishing), so this check only matters for the one-time
    startup call in `app.main.lifespan`.
    """
    from sqlalchemy import select

    from app.queue.constants import JobStatus
    from app.queue.models import QueueJob

    existing = await queue_service.session.execute(
        select(QueueJob.id).where(QueueJob.job_name == _POLL_JOB_NAME, QueueJob.status == JobStatus.PENDING).limit(1)
    )
    if existing.scalar_one_or_none() is not None:
        return

    await queue_service.create_job(
        job_name=_POLL_JOB_NAME,
        module=_MODULE_NAME,
        payload={},
        priority=JobPriority.LOW,
        run_at=run_at,
        max_retries=1,  # a failed poll just waits for the next scheduled one; no point retrying immediately
    )


@register(_POLL_JOB_NAME)
async def poll_integration_inbox(payload: dict) -> None:
    """
    Worker-invoked handler: poll ERP_Main once for routed events, process idempotently, then reschedule itself.

    This is a SELF-PERPETUATING job (Section 12: reuse the existing
    queue rather than build a second scheduler) -- `app.queue` has no
    native cron/recurring-job concept, so the handler re-enqueues its
    own next run at the end of every execution, whether this run
    succeeded or failed. A failed poll (ERP_Main unreachable) does NOT
    raise -- raising would mark this one-shot job FAILED and, per
    `max_retries=1`, permanently so, silently ending the polling loop.
    Instead the failure is logged and the loop continues on schedule
    (Section 56: "When the target becomes available... events must
    resume" -- the loop must keep running through an outage, not stop).
    """
    session_factory = get_sessionmaker()
    async with session_factory() as session:
        service = ConsumerService(ProcessedEventRepository(session))
        try:
            await service.poll_and_process()
        except ConsumerPollError as exc:
            # Logged, not raised -- see docstring: the loop must survive an outage.
            logger.warning("Integration inbox poll failed: %s", exc)
        await session.commit()

        queue_service = QueueService(session)
        await enqueue_poll(
            queue_service, run_at=datetime.now(timezone.utc) + timedelta(seconds=_POLL_INTERVAL_SECONDS)
        )
        await session.commit()
