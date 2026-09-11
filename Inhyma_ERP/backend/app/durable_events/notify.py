"""
Postgres LISTEN/NOTIFY Wake-Up Signal (Phase 3, Section 24).

CRITICAL invariant this whole file exists to protect: NOTIFY is a
best-effort wake-up nudge, NEVER the source of truth for whether an
event exists or was delivered. `durable_events`/`event_deliveries`
(see `models.py`/`repository.py`) are the only durable truth; every
worker that misses a NOTIFY (not listening yet, connection dropped,
notification coalesced/lost) still finds the same work via its own
periodic `claim_next()` poll (see `worker.py`) -- NOTIFY only makes
that poll happen sooner than its own backoff interval would.

Requires a DIRECT (non-pooled) database connection, NOT the app's
normal pooled SQLAlchemy engine. `app.database.engine.get_engine()`
deliberately supports running through a transaction-mode PgBouncer/
Supabase-pooler (see its own `DATABASE_DISABLE_STATEMENT_CACHE`
handling) -- such a pooler can hand the underlying TCP connection to a
completely different client between statements, so a LISTEN issued on
a pooled connection can silently stop receiving notifications at any
moment with no error. This module therefore opens its own raw
`asyncpg` connection using `settings.DIRECT_URL` (already present in
this codebase for exactly this "bypass the pooler" reason, previously
used only by Alembic) rather than borrowing a connection from the
pooled engine.

If `DIRECT_URL` is not configured (a valid setup for a
small/single-instance deployment against a database with no pooler in
front of it, or for local development), this module degrades to a
no-op: `NotifyListener.start()` logs a warning and returns without
raising, and every worker simply falls back to polling on its own
interval -- correctness never depends on this file actually working.
"""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable

import asyncpg

from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)

NOTIFY_CHANNEL = "durable_events_ready"


def _asyncpg_dsn() -> str | None:
    """
    Build a plain DSN `asyncpg.connect()` accepts, from `settings.DIRECT_URL`.

    Returns `None` if `DIRECT_URL` isn't configured -- callers must
    treat that as "LISTEN/NOTIFY unavailable, fall back to polling
    only", never as an error.
    """
    if not settings.DIRECT_URL:
        return None
    return settings.DIRECT_URL.replace("postgresql+psycopg2://", "postgresql://")


async def notify_event_ready(connection_or_session) -> None:
    """
    Send a lightweight NOTIFY on the shared channel, using the SAME
    connection/session as the caller's just-committed transaction.

    Deliberately takes whatever connection the caller already has
    (typically the SQLAlchemy `AsyncSession` used to insert the
    `DurableEvent` row) rather than opening a new one -- `NOTIFY` from
    the same session that just committed the row it's about to announce
    is what makes "the event is already visible to any new connection
    when consumers wake up" trivially true (Section 24), with no
    separate coordination needed.

    The NOTIFY payload deliberately carries NO event data (Section 24:
    "NOTIFY is only a wake-up signal") -- every worker still queries
    `event_deliveries` itself via `claim_next()` for what to actually do.
    """
    from sqlalchemy import text

    try:
        await connection_or_session.execute(text(f"NOTIFY {NOTIFY_CHANNEL}"))
    except Exception:  # noqa: BLE001 - a failed NOTIFY must never fail the business transaction that triggered it
        logger.warning("Failed to send durable-event NOTIFY; workers will still find this via their own poll.")


class NotifyListener:
    """
    Maintains one direct `asyncpg` connection subscribed to `NOTIFY_CHANNEL`
    and invokes `on_notify` (typically "wake up and poll now") whenever a
    notification arrives.

    Auto-reconnects with backoff if the direct connection drops (Section
    24: workers must recover automatically) -- reconnection here only
    restores the wake-up nudge; it never risks losing work, since the
    poll loop it wakes up re-derives everything from `event_deliveries`.
    """

    def __init__(self, on_notify: Callable[[], Awaitable[None] | None]) -> None:
        """Store the callback to invoke on each notification."""
        self._on_notify = on_notify
        self._connection: asyncpg.Connection | None = None
        self._task: asyncio.Task | None = None
        self._stop_event = asyncio.Event()
        self._reconnect_delay = 1.0
        self._max_reconnect_delay = 30.0

    async def start(self) -> None:
        """Start listening. A no-op (with a logged warning) if DIRECT_URL isn't configured."""
        if _asyncpg_dsn() is None:
            logger.warning(
                "DIRECT_URL not configured; durable-events LISTEN/NOTIFY disabled. "
                "Workers will rely solely on polling (correctness is unaffected, only latency)."
            )
            return
        self._stop_event.clear()
        self._task = asyncio.create_task(self._run(), name="durable-events-listener")

    async def stop(self) -> None:
        """Stop listening and close the direct connection."""
        self._stop_event.set()
        if self._task is not None:
            try:
                await asyncio.wait_for(self._task, timeout=10.0)
            except (asyncio.TimeoutError, asyncio.CancelledError):
                self._task.cancel()
        if self._connection is not None:
            try:
                await self._connection.close()
            except Exception:  # noqa: BLE001 - best-effort cleanup on shutdown
                pass
            self._connection = None

    async def _run(self) -> None:
        """Connect, LISTEN, and reconnect with backoff on any drop, until stop() is called."""
        while not self._stop_event.is_set():
            try:
                dsn = _asyncpg_dsn()
                if dsn is None:
                    return
                self._connection = await asyncpg.connect(dsn)
                await self._connection.add_listener(NOTIFY_CHANNEL, self._handle_notification)
                logger.info("Durable-events NOTIFY listener connected.")
                self._reconnect_delay = 1.0

                while not self._stop_event.is_set():
                    if self._connection.is_closed():
                        raise ConnectionError("Direct listener connection closed unexpectedly.")
                    await asyncio.sleep(1.0)

            except asyncio.CancelledError:
                break
            except Exception:  # noqa: BLE001 - any connection failure must trigger reconnect-with-backoff, not crash the worker
                logger.warning(
                    "Durable-events NOTIFY listener connection lost; reconnecting in %.1fs.",
                    self._reconnect_delay,
                )
                if self._connection is not None:
                    try:
                        await self._connection.close()
                    except Exception:  # noqa: BLE001
                        pass
                    self._connection = None
                await asyncio.sleep(self._reconnect_delay)
                self._reconnect_delay = min(self._reconnect_delay * 2, self._max_reconnect_delay)

    def _handle_notification(self, connection, pid, channel, payload) -> None:
        """asyncpg's synchronous listener callback -- schedules the (possibly async) `on_notify` callback."""
        result = self._on_notify()
        if asyncio.iscoroutine(result):
            asyncio.create_task(result)
