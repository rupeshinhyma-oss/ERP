"""
Automated Periodic Background Worker for Recurring Tasks.

Executes periodic recurring task generation, reminder dispatch,
and manager escalations in the background without requiring frontend user navigation.

Features:
- Runs automatically on an hourly interval.
- Generates due recurring task instances idempotently across all active schedules.
- Evaluates deadline warnings (reminders) and manager escalations.
- Enforces hold period suppression and non-overlapping executions.
- Exposes `trigger_now()` for immediate manual or test execution.
"""

from __future__ import annotations

import asyncio
from datetime import date, datetime, timezone
import logging
from typing import Any

from app.audit.repository import AuditRepository
from app.audit.service import AuditService
from app.database.engine import get_sessionmaker
from app.notifications.repository import NotificationRepository
from app.notifications.service import NotificationService
from app.tasks.repository import TaskRepository
from app.tasks.service import TaskService

logger = logging.getLogger(__name__)

DEFAULT_INTERVAL_SECONDS = 3600  # 1 hour


class RecurringTaskWorker:
    """Manages periodic execution of recurring task generation and reminder/escalation checks."""

    def __init__(self, interval_seconds: int = DEFAULT_INTERVAL_SECONDS) -> None:
        self.interval_seconds = interval_seconds
        self._running = False
        self._task: asyncio.Task | None = None
        self._lock = asyncio.Lock()
        self.last_run_at: datetime | None = None
        self.last_stats: dict[str, Any] = {}

    async def start(self) -> None:
        """Start the background worker task."""
        if self._running:
            return
        self._running = True
        self._task = asyncio.create_task(self._worker_loop(), name="recurring_tasks_worker")
        logger.info("Recurring Task Background Worker started (interval=%ds).", self.interval_seconds)

    async def stop(self) -> None:
        """Stop the background worker task gracefully."""
        if not self._running:
            return
        self._running = False
        if self._task and not self._task.done():
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        logger.info("Recurring Task Background Worker stopped.")

    async def trigger_now(self, as_of_date: date | None = None) -> dict[str, Any]:
        """Manually trigger an execution pass immediately."""
        async with self._lock:
            return await self._run_once(as_of_date=as_of_date)

    async def _worker_loop(self) -> None:
        """Main periodic worker loop."""
        # Initial boot delay to let server initialize
        await asyncio.sleep(5)
        while self._running:
            try:
                async with self._lock:
                    await self._run_once()
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error("Error in recurring task worker pass: %s", str(e), exc_info=True)

            try:
                await asyncio.sleep(self.interval_seconds)
            except asyncio.CancelledError:
                break

    async def _run_once(self, as_of_date: date | None = None) -> dict[str, Any]:
        """Execute a single pass of recurring task generation and reminder/escalation check."""
        ref_date = as_of_date or date.today()
        logger.info("Running recurring task worker pass for date %s...", ref_date)
        sessionmaker = get_sessionmaker()

        generated_count = 0
        reminders_sent = 0
        escalations_triggered = 0

        async with sessionmaker() as session:
            repo = TaskRepository(session)
            audit = AuditService(AuditRepository(session))
            notif = NotificationService(NotificationRepository(session))
            service = TaskService(repository=repo, audit_service=audit, notification_service=notif)

            try:
                # 1. Generate due task instances
                tasks = await service.generate_recurring_tasks(as_of_date=ref_date)
                generated_count = len(tasks)

                # 2. Check and process reminders and escalations
                check_stats = await service.check_recurring_reminders_and_escalations(as_of_date=ref_date)
                reminders_sent = check_stats.get("reminders_sent", 0)
                escalations_triggered = check_stats.get("escalations_triggered", 0)

            except Exception as e:
                logger.error("Failed executing recurring task cycle: %s", str(e), exc_info=True)
                raise

        self.last_run_at = datetime.now(timezone.utc)
        self.last_stats = {
            "run_at": self.last_run_at.isoformat(),
            "as_of_date": ref_date.isoformat(),
            "generated_count": generated_count,
            "reminders_sent": reminders_sent,
            "escalations_triggered": escalations_triggered,
        }
        logger.info(
            "Recurring task worker pass completed: %d generated, %d reminders, %d escalations.",
            generated_count,
            reminders_sent,
            escalations_triggered,
        )
        return self.last_stats


# Global worker instance
recurring_task_worker = RecurringTaskWorker()
