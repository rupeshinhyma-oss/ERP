"""
Integration Service (Phase 6 & Phase 8F).

Manages transactional outbox publishing, independent per-target fan-out delivery,
safe leased claims, circuit breaker evaluation, bounded exponential retry backoff,
and secret-redacted error logging.
"""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx

from app.core.config import settings
from app.core.logging import get_logger
from app.integration.models import (
    DeliveryStatus,
    IntegrationOutboxDelivery,
    IntegrationOutboxEvent,
    OutboxEventStatus,
)
from app.integration.reliability import (
    DeliveryRetryPolicy,
    PeerCircuitBreakerService,
    sanitize_error,
)
from app.integration.repository import IntegrationOutboxRepository

logger = get_logger(__name__)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class IntegrationService:
    """Publishes outbox events and dispatches deliveries directly to peer ERPs."""

    def __init__(self, repository: IntegrationOutboxRepository) -> None:
        self.repository = repository

    def publish_event(
        self,
        *,
        event_type: str,
        aggregate_type: str,
        aggregate_id: uuid.UUID,
        payload: dict[str, Any],
        correlation_id: uuid.UUID | None = None,
        causation_id: uuid.UUID | None = None,
        actor_type: str = "user",
        actor_id: uuid.UUID | None = None,
        target: str = "broadcast",
        event_version: int = 1,
    ) -> IntegrationOutboxEvent:
        """
        Add one outbox event and initialize its independent fan-out deliveries
        in the caller's transaction.
        """
        resolved_correlation_id = correlation_id or uuid.uuid4()
        event = IntegrationOutboxEvent(
            id=uuid.uuid4(),
            event_id=uuid.uuid4(),
            event_type=event_type,
            event_version=event_version,
            aggregate_type=aggregate_type,
            aggregate_id=aggregate_id,
            correlation_id=resolved_correlation_id,
            causation_id=causation_id,
            actor_type=actor_type,
            actor_id=actor_id,
            target=target,
            payload=json.dumps(payload),
            occurred_at=_utcnow(),
            status=OutboxEventStatus.PENDING,
        )
        self.repository.add(event)

        # Resolve destination targets for fan-out (Phase 8F Section 12)
        peer_endpoints = settings.peer_erp_endpoints_map
        target_key = target.lower().strip() if target else "broadcast"
        target_erps: list[str] = []

        if target_key in peer_endpoints and target_key != settings.ERP_KEY.lower():
            target_erps.append(target_key)
        elif target_key == "broadcast":
            for peer_key in peer_endpoints:
                if peer_key != settings.ERP_KEY.lower():
                    target_erps.append(peer_key)

        if not target_erps:
            target_erps.append(target_key if target_key != "broadcast" else "erp_main")

        # Create independent delivery rows
        deliveries = []
        for tgt in target_erps:
            delivery = IntegrationOutboxDelivery(
                id=uuid.uuid4(),
                outbox_event_id=event.id,
                target_erp=tgt,
                status=DeliveryStatus.PENDING,
                attempt_count=0,
                max_attempts=5,
                next_attempt_at=_utcnow(),
            )
            delivery.outbox_event = event
            self.repository.db.add(delivery)
            deliveries.append(delivery)
        event.deliveries = deliveries

        return event

    async def dispatch_delivery(self, delivery_id: uuid.UUID) -> bool:
        """
        Dispatch one specific delivery over HTTPS to its target ERP.
        Applies circuit breaker check, bounded retry, and structured logging.
        """
        delivery = await self.repository.get_delivery_by_id(delivery_id)
        if delivery is None:
            logger.error("dispatch_delivery called for nonexistent delivery id: %s", delivery_id)
            return False

        if delivery.status == DeliveryStatus.DELIVERED:
            return True

        event = delivery.outbox_event
        if event is None:
            event = await self.repository.get_by_id(delivery.outbox_event_id)

        if event is None:
            logger.error("dispatch_delivery found orphan delivery with no outbox event: %s", delivery_id)
            return False

        circuit_service = PeerCircuitBreakerService(self.repository.db)
        can_attempt, circuit_state = await circuit_service.can_attempt_delivery(delivery.target_erp)

        if not can_attempt:
            logger.warning(
                "Target peer '%s' is in circuit breaker cooldown (%s). Deferring delivery %s.",
                delivery.target_erp,
                circuit_state,
                delivery_id,
                extra={"correlation_id": str(event.correlation_id), "target_erp": delivery.target_erp},
            )
            backoff_sec = DeliveryRetryPolicy.calculate_backoff(delivery.attempt_count + 1)
            await self.repository.mark_delivery_failure(
                delivery_id,
                retryable=True,
                next_attempt_at=_utcnow() + timedelta(seconds=backoff_sec),
                error_code="CIRCUIT_BREAKER_COOLDOWN",
                error_msg=f"Target peer '{delivery.target_erp}' is in circuit cooldown ({circuit_state}).",
            )
            return False

        destination_url = self._resolve_target_url(delivery.target_erp)
        headers = {
            "Authorization": f"Bearer {settings.FEDERATION_SERVICE_CREDENTIAL}",
            "X-Correlation-ID": str(event.correlation_id),
            "Content-Type": "application/json",
        }

        envelope = {
            "event_id": str(event.event_id),
            "event_type": event.event_type,
            "event_version": event.event_version,
            "occurred_at": event.occurred_at.isoformat(),
            "source_erp": settings.ERP_KEY,
            "target_erp": delivery.target_erp,
            "entity_type": event.aggregate_type,
            "source_entity_type": event.aggregate_type,
            "entity_id": str(event.aggregate_id),
            "source_entity_id": str(event.aggregate_id),
            "correlation_id": str(event.correlation_id),
            "causation_id": str(event.causation_id) if event.causation_id else None,
            "actor_type": event.actor_type,
            "actor_id": str(event.actor_id) if event.actor_id else None,
            "payload": json.loads(event.payload),
            "metadata": {},
        }

        start_time = datetime.now(timezone.utc)
        try:
            timeout_config = httpx.Timeout(15.0, connect=5.0, read=10.0)
            async with httpx.AsyncClient(timeout=timeout_config) as http_client:
                response = await http_client.post(destination_url, headers=headers, json=envelope)

            duration_ms = (datetime.now(timezone.utc) - start_time).total_seconds() * 1000

            if response.status_code in (200, 201):
                await circuit_service.record_success(delivery.target_erp)
                await self.repository.mark_delivery_success(delivery_id)
                logger.info(
                    "Delivered cross-ERP event %s to %s in %.1fms.",
                    event.event_id,
                    delivery.target_erp,
                    duration_ms,
                    extra={
                        "event_id": str(event.event_id),
                        "correlation_id": str(event.correlation_id),
                        "source_erp": settings.ERP_KEY,
                        "target_erp": delivery.target_erp,
                        "duration_ms": duration_ms,
                    },
                )
                return True
            else:
                status_code = response.status_code
                error_msg = f"Target {destination_url} responded {status_code}: {response.text[:300]}"
                is_retriable = DeliveryRetryPolicy.is_retryable(status_code=status_code)
                backoff_sec = DeliveryRetryPolicy.calculate_backoff(delivery.attempt_count + 1)
                next_attempt = _utcnow() + timedelta(seconds=backoff_sec) if is_retriable else None

                await circuit_service.record_failure(delivery.target_erp, f"HTTP_{status_code}")
                await self.repository.mark_delivery_failure(
                    delivery_id,
                    retryable=is_retriable,
                    next_attempt_at=next_attempt,
                    error_code=f"HTTP_{status_code}",
                    error_msg=error_msg,
                )
                logger.warning(
                    "Delivery failed for event %s to %s: HTTP %d. Retriable=%s.",
                    event.event_id,
                    delivery.target_erp,
                    status_code,
                    is_retriable,
                    extra={
                        "event_id": str(event.event_id),
                        "correlation_id": str(event.correlation_id),
                        "target_erp": delivery.target_erp,
                        "status_code": status_code,
                        "is_retriable": is_retriable,
                    },
                )
                return False

        except Exception as exc:  # noqa: BLE001
            duration_ms = (datetime.now(timezone.utc) - start_time).total_seconds() * 1000
            error_msg = f"Connection error reaching target ERP {delivery.target_erp}: {exc}"
            is_retriable = DeliveryRetryPolicy.is_retryable(exc=exc)
            backoff_sec = DeliveryRetryPolicy.calculate_backoff(delivery.attempt_count + 1)
            next_attempt = _utcnow() + timedelta(seconds=backoff_sec) if is_retriable else None

            await circuit_service.record_failure(delivery.target_erp, exc.__class__.__name__)
            await self.repository.mark_delivery_failure(
                delivery_id,
                retryable=is_retriable,
                next_attempt_at=next_attempt,
                error_code=exc.__class__.__name__,
                error_msg=error_msg,
            )
            logger.warning(
                "Delivery exception for event %s to %s: %s. Retriable=%s.",
                event.event_id,
                delivery.target_erp,
                exc,
                is_retriable,
                extra={
                    "event_id": str(event.event_id),
                    "correlation_id": str(event.correlation_id),
                    "target_erp": delivery.target_erp,
                    "error": str(exc),
                    "is_retriable": is_retriable,
                },
            )
            return False

    def _resolve_target_url(self, target_erp: str) -> str:
        """Resolve the HTTPS endpoint for the destination ERP."""
        target_norm = target_erp.lower().strip()
        peer_endpoints = settings.peer_erp_endpoints_map

        if target_norm in peer_endpoints:
            base = peer_endpoints[target_norm].rstrip("/")
            return f"{base}/integration/events"

        # Default fallback to ERP_Main internal ingest
        main_base = settings.ERP_MAIN_API_BASE_URL.rstrip("/")
        return f"{main_base}/internal/integration/events"

    async def dispatch_event(self, outbox_event_id: uuid.UUID) -> None:
        """
        Dispatches all deliveries associated with an outbox event.
        Backward-compatible entry point for QueueJob handlers.
        """
        event = await self.repository.get_by_id(outbox_event_id)
        if event is None:
            logger.error("dispatch_event called for nonexistent outbox event id: %s", outbox_event_id)
            return

        if event.status == OutboxEventStatus.PUBLISHED:
            return

        if not event.deliveries:
            target_key = event.target.lower().strip() if event.target else "broadcast"
            peer_endpoints = settings.peer_erp_endpoints_map
            targets = []
            if target_key in peer_endpoints and target_key != settings.ERP_KEY.lower():
                targets.append(target_key)
            elif target_key == "broadcast":
                targets = [k for k in peer_endpoints if k != settings.ERP_KEY.lower()]
            if not targets:
                targets.append(target_key if target_key != "broadcast" else "erp_main")
            await self.repository.create_deliveries_for_event(
                event.id,
                targets,
                initial_attempt_count=event.attempt_count or 0,
                max_attempts=event.max_attempts or 5,
            )
            await self.repository.save(event)
        else:
            for delivery in event.deliveries:
                if event.attempt_count and delivery.attempt_count < event.attempt_count:
                    delivery.attempt_count = event.attempt_count
                if event.max_attempts and delivery.max_attempts != event.max_attempts:
                    delivery.max_attempts = event.max_attempts

        event.status = OutboxEventStatus.DISPATCHING
        await self.repository.save(event)

        for delivery in event.deliveries:
            if delivery.status in (DeliveryStatus.PENDING, DeliveryStatus.RETRYING, DeliveryStatus.PROCESSING):
                await self.dispatch_delivery(delivery.id)

    async def drain_batch(
        self,
        worker_id: str,
        batch_size: int = 10,
        lease_seconds: int = 60,
    ) -> int:
        """
        Claim and dispatch a batch of due deliveries using PostgreSQL row locks.
        Returns the number of deliveries processed.
        """
        deliveries = await self.repository.claim_next_batch(
            worker_id=worker_id,
            batch_size=batch_size,
            lease_seconds=lease_seconds,
        )
        if not deliveries:
            return 0

        for delivery in deliveries:
            await self.dispatch_delivery(delivery.id)

        return len(deliveries)

    async def list_pending(self, *, limit: int = 50) -> list[IntegrationOutboxEvent]:
        """List events awaiting dispatch."""
        return await self.repository.list_pending(limit=limit)
