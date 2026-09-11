"""
Consumer Handler Registry + Service (Phase 6, consumer side).

Mirrors `app.queue.registry`'s own design deliberately (a simple global
dict populated at import time, looked up by key at processing time) --
see that module's own docstring for the reasoning; the same shape is
reused here for `event_type -> handler` rather than `job_name ->
handler`.

An event_type with NO registered handler is not an error -- it means
this ERP has nothing to do with that kind of event yet (Section 6's own
spirit: don't invent consumers for events nothing here cares about). It
is still marked processed (so it is never re-fetched), just with no
business effect.
"""

from __future__ import annotations

import json
import uuid
from collections.abc import Awaitable, Callable
from typing import Any

import httpx

from app.core.config import settings
from app.core.logging import get_logger
from app.integration.consumer_repository import ProcessedEventRepository

logger = get_logger(__name__)

_CONSUMER_ID = "default"

# Type alias for a consumer handler: an async function receiving the
# integration event's data-minimized payload dict and its source ERP key.
ConsumerHandler = Callable[[dict[str, Any], str], Awaitable[None]]

_registry: dict[str, ConsumerHandler] = {}


def register_consumer(event_type: str) -> Callable[[ConsumerHandler], ConsumerHandler]:
    """Decorator that registers an async function as the consumer handler for `event_type`."""

    def decorator(fn: ConsumerHandler) -> ConsumerHandler:
        if event_type in _registry:
            raise ValueError(f"A consumer handler for {event_type!r} is already registered.")
        _registry[event_type] = fn
        return fn

    return decorator


def get_consumer_handler(event_type: str) -> ConsumerHandler | None:
    """Return the registered handler for `event_type`, or None if this ERP has no consumer for it."""
    return _registry.get(event_type)


class ConsumerPollError(Exception):
    """Raised when polling ERP_Main's inbox itself fails (network error or non-2xx response)."""


class ConsumerService:
    """Polls ERP_Main for routed events and processes each idempotently."""

    def __init__(self, repository: ProcessedEventRepository) -> None:
        """Bind the service to its processed-events repository."""
        self.repository = repository

    async def poll_and_process(self, *, since: str | None = None) -> dict[str, int]:
        """
        Poll ERP_Main's inbox once and process every event not already handled.

        Returns a small summary dict (`fetched`, `processed`,
        `skipped_duplicate`) for logging/observability (Section 44).
        Raises `ConsumerPollError` only if the POLL ITSELF fails --
        an individual event's handler raising is caught and logged per-
        event (Section 76: "same event twice/10 times -> one logical
        business effect" implies one bad event must not block every
        other event in the same poll from being processed).
        """
        url = f"{settings.ERP_MAIN_API_BASE_URL}/internal/integration/inbox"
        headers = {"Authorization": f"Bearer {settings.FEDERATION_SERVICE_CREDENTIAL}"}
        params = {"since": since} if since else {}

        try:
            async with httpx.AsyncClient(timeout=10.0) as http_client:
                response = await http_client.get(url, headers=headers, params=params)
        except Exception as exc:  # noqa: BLE001 - any failure to reach ERP_Main must be reported, not crash the poller
            raise ConsumerPollError(f"Could not reach ERP_Main for inbox poll: {exc}") from exc

        if response.status_code != 200:
            raise ConsumerPollError(
                f"ERP_Main inbox poll failed with status {response.status_code}: {response.text[:300]}"
            )

        events = response.json().get("data", [])
        processed = 0
        skipped = 0

        for event in events:
            event_id = uuid.UUID(event["event_id"])
            if await self.repository.already_processed(event_id, _CONSUMER_ID):
                skipped += 1
                continue

            handler = get_consumer_handler(event["event_type"])
            if handler is not None:
                payload = event.get("payload", {})
                if isinstance(payload, str):
                    payload = json.loads(payload)
                try:
                    await handler(payload, event.get("source_erp_id", ""))
                except Exception:  # noqa: BLE001 - one bad event's handler must not stop the rest of this poll
                    logger.exception(
                        "Consumer handler failed for integration event; NOT marking processed so it is retried.",
                        extra={"event_id": str(event_id), "event_type": event["event_type"]},
                    )
                    continue  # do NOT mark processed -- let the next poll retry this one

            self.repository.mark_processed(event_id, _CONSUMER_ID, event["event_type"])
            processed += 1

        return {"fetched": len(events), "processed": processed, "skipped_duplicate": skipped}
