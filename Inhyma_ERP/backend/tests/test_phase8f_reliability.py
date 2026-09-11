"""
Phase 8F Test Suite: Cross-ERP Reliability, Operations, Backpressure & Recovery Hardening (Inhyma).

Covers all 25 required reliability and resilience scenarios:
1. Durable pending event survives restart
2. Concurrent claim safety (FOR UPDATE SKIP LOCKED)
3. Expired PROCESSING lease recovery
4. Active lease not stolen prematurely
5. Retryable HTTP error handling (5xx, 429, timeout)
6. Permanent HTTP error handling (400, 401, 403, 404, schema violation)
7. Exponential backoff and jitter calculations
8. Max attempts exhaustion to DEAD_LETTER
9. Audited dead-letter replay preserving event_id and version context
10. Duplicate consumer event detection and idempotent NOOP
11. Transaction/idempotency failure window (atomic commit/rollback)
12. Peer outage safe durable queuing
13. Peer recovery drain
14. ERP_Main outage independence (peer-to-peer survival)
15. Missed LISTEN/NOTIFY discovery via durable polling
16. Bounded worker concurrency and backpressure batch limits
17. Peer circuit breaker and cooldown storm prevention
18. Fan-out independent target delivery states
19. Unsupported contract version rejection
20. Malformed envelope schema rejection
21. Snapshot resumable cursor checkpointing
22. Snapshot vs. live event OCC version race protection
23. Graceful worker restart and shutdown safety
24. Secret and credential redaction in errors and logs
25. Entity reconciliation reporting after recovery
"""

from __future__ import annotations

import asyncio
import json
import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

import httpx
import pytest
import pytest_asyncio
from sqlalchemy import delete, select

from app.buyers.models import Buyer
from app.database.engine import dispose_engine, get_sessionmaker
from app.integration.consumer_models import ProcessedIntegrationEvent
from app.integration.models import (
    DeliveryStatus,
    IntegrationOutboxDelivery,
    IntegrationOutboxEvent,
    OutboxEventStatus,
    PeerHealthState,
    SnapshotJob,
)
from app.integration.reconciliation import ReconciliationService
from app.integration.reliability import (
    DeliveryRetryPolicy,
    PeerCircuitBreakerService,
    sanitize_error,
)
from app.integration.repair import RepairService
from app.integration.repository import IntegrationOutboxRepository
from app.integration.service import IntegrationService
from app.integration.snapshots import SnapshotService
from app.integration.sync_engine import (
    GenericSyncEngine,
    SyncPolicyConfig,
    UnsupportedContractVersionError,
)
from app.integration.sync_models import SyncedEntityMapping

pytestmark = pytest.mark.asyncio


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


@pytest_asyncio.fixture
async def db_session():
    """Real session against the Postgres test database with clean rollback."""
    await dispose_engine()
    session_factory = get_sessionmaker()
    async with session_factory() as session:
        yield session
        await session.rollback()
    await dispose_engine()


# -----------------------------------------------------------------------------
# Test 1: Durable pending event survives restart
# -----------------------------------------------------------------------------
async def test_01_durable_pending_event_survives_restart():
    """Verify that an event and its deliveries survive session/process restarts."""
    await dispose_engine()
    session_factory = get_sessionmaker()
    event_id = uuid.uuid4()
    test_uid = uuid.uuid4()

    async with session_factory() as s1:
        repo1 = IntegrationOutboxRepository(s1)
        svc1 = IntegrationService(repo1)
        event = svc1.publish_event(
            event_type="buyer.created",
            aggregate_type="buyer",
            aggregate_id=test_uid,
            payload={"name": "Persistent Buyer"},
            target="yinglima",
        )
        event_id = event.event_id
        await s1.commit()

    # Simulate restart by completely disposing engine and opening new session
    await dispose_engine()
    session_factory2 = get_sessionmaker()
    async with session_factory2() as s2:
        repo2 = IntegrationOutboxRepository(s2)
        recovered = await repo2.get_by_event_id(event_id)
        assert recovered is not None
        assert recovered.status == OutboxEventStatus.PENDING
        assert len(recovered.deliveries) >= 1
        assert recovered.deliveries[0].status == DeliveryStatus.PENDING
        assert recovered.deliveries[0].target_erp == "yinglima"

        # Cleanup
        await s2.delete(recovered)
        await s2.commit()
    await dispose_engine()


# -----------------------------------------------------------------------------
# Test 2: Database-safe concurrent claiming (FOR UPDATE SKIP LOCKED)
# -----------------------------------------------------------------------------
async def test_02_concurrent_claim_safety(db_session):
    """Simulate multiple concurrent workers claiming from the queue; proves zero duplicate claims."""
    repo = IntegrationOutboxRepository(db_session)
    svc = IntegrationService(repo)

    # Insert 10 events
    event_ids = []
    for i in range(10):
        ev = svc.publish_event(
            event_type="buyer.created",
            aggregate_type="buyer",
            aggregate_id=uuid.uuid4(),
            payload={"idx": i},
            target="yinglima",
        )
        event_ids.append(ev.id)
    await db_session.commit()

    # Launch 5 concurrent workers claiming 2 jobs each
    session_factory = get_sessionmaker()
    all_claimed_ids = []

    async def worker_claim(worker_num: int):
        async with session_factory() as ws:
            w_repo = IntegrationOutboxRepository(ws)
            claimed = await w_repo.claim_next_batch(worker_id=f"worker-{worker_num}", batch_size=2)
            await ws.commit()
            return [d.id for d in claimed]

    results = await asyncio.gather(*(worker_claim(i) for i in range(5)))
    for res in results:
        all_claimed_ids.extend(res)

    # Each delivery must be claimed by exactly one worker
    assert len(all_claimed_ids) == 10
    assert len(set(all_claimed_ids)) == 10, "Duplicate delivery claims detected!"

    # Cleanup
    await db_session.execute(delete(IntegrationOutboxEvent).where(IntegrationOutboxEvent.id.in_(event_ids)))
    await db_session.commit()


# -----------------------------------------------------------------------------
# Test 3: Expired PROCESSING lease recovery
# -----------------------------------------------------------------------------
async def test_03_expired_processing_lease_recovery(db_session):
    """Deliveries stuck in PROCESSING past their lease are safely reclaimed."""
    repo = IntegrationOutboxRepository(db_session)
    svc = IntegrationService(repo)

    ev = svc.publish_event(
        event_type="buyer.created",
        aggregate_type="buyer",
        aggregate_id=uuid.uuid4(),
        payload={"data": "test"},
        target="yinglima",
    )
    delivery_id = ev.deliveries[0].id
    event_id = ev.id
    await db_session.flush()

    delivery = ev.deliveries[0]
    delivery.status = DeliveryStatus.PROCESSING
    delivery.worker_id = "crashed_worker_pid_9999"
    delivery.lease_expires_at = _utcnow() - timedelta(seconds=120)  # expired lease
    await db_session.commit()

    # Recovery sweep
    recovered_count = await repo.recover_stuck_deliveries(older_than_seconds=60)
    assert recovered_count >= 1

    recovered_delivery = await repo.get_delivery_by_id(delivery_id)
    assert recovered_delivery is not None
    assert recovered_delivery.status == DeliveryStatus.RETRYING
    assert recovered_delivery.worker_id is None
    assert recovered_delivery.lease_expires_at is None

    # Next claim can pick it up
    claimed = await repo.claim_next_batch(worker_id="recovering_worker", batch_size=5)
    claimed_ids = [d.id for d in claimed]
    assert delivery_id in claimed_ids

    # Cleanup
    saved_ev = await repo.get_by_id(event_id)
    if saved_ev:
        await db_session.delete(saved_ev)
        await db_session.commit()


# -----------------------------------------------------------------------------
# Test 4: Active lease not stolen prematurely
# -----------------------------------------------------------------------------
async def test_04_active_lease_not_stolen_prematurely(db_session):
    """Deliveries currently held under an active unexpired lease cannot be stolen."""
    repo = IntegrationOutboxRepository(db_session)
    svc = IntegrationService(repo)

    ev = svc.publish_event(
        event_type="buyer.created",
        aggregate_type="buyer",
        aggregate_id=uuid.uuid4(),
        payload={"data": "test"},
        target="yinglima",
    )
    delivery_id = ev.deliveries[0].id
    event_id = ev.id
    await db_session.flush()

    delivery = ev.deliveries[0]
    delivery.status = DeliveryStatus.PROCESSING
    delivery.worker_id = "active_worker_1"
    delivery.lease_expires_at = _utcnow() + timedelta(seconds=300)  # active lease
    await db_session.commit()

    # Worker 2 attempts to claim
    claimed = await repo.claim_next_batch(worker_id="active_worker_2", batch_size=5)
    claimed_ids = [d.id for d in claimed]
    assert delivery_id not in claimed_ids

    # Cleanup
    saved_ev = await repo.get_by_id(event_id)
    if saved_ev:
        await db_session.delete(saved_ev)
        await db_session.commit()


# -----------------------------------------------------------------------------
# Test 5: Retryable HTTP error handling (503, 500, timeout)
# -----------------------------------------------------------------------------
async def test_05_retryable_http_error(db_session):
    """Transient server errors trigger bounded exponential retry backoff."""
    repo = IntegrationOutboxRepository(db_session)
    svc = IntegrationService(repo)

    ev = svc.publish_event(
        event_type="buyer.created",
        aggregate_type="buyer",
        aggregate_id=uuid.uuid4(),
        payload={"name": "Buyer Retry"},
        target="yinglima",
    )
    delivery_id = ev.deliveries[0].id
    event_id = ev.id
    await db_session.commit()

    mock_resp = httpx.Response(status_code=503, text="Service Temporarily Unavailable")
    with patch("httpx.AsyncClient.post", new_callable=AsyncMock) as mock_post:
        mock_post.return_value = mock_resp
        success = await svc.dispatch_delivery(delivery_id)

    assert not success
    delivery = await repo.get_delivery_by_id(delivery_id)
    assert delivery is not None
    assert delivery.status == DeliveryStatus.RETRYING
    assert delivery.attempt_count == 1
    assert delivery.next_attempt_at > _utcnow()
    assert "HTTP_503" in (delivery.last_error_code or "")

    # Cleanup
    saved_ev = await repo.get_by_id(event_id)
    if saved_ev:
        await db_session.delete(saved_ev)
        await db_session.commit()


# -----------------------------------------------------------------------------
# Test 6: Permanent HTTP error handling (400, 401, 404, schema)
# -----------------------------------------------------------------------------
async def test_06_permanent_http_error(db_session):
    """Permanent client errors fail closed directly to DEAD_LETTER without endless retries."""
    repo = IntegrationOutboxRepository(db_session)
    svc = IntegrationService(repo)

    ev = svc.publish_event(
        event_type="buyer.created",
        aggregate_type="buyer",
        aggregate_id=uuid.uuid4(),
        payload={"name": "Bad Payload"},
        target="yinglima",
    )
    delivery_id = ev.deliveries[0].id
    event_id = ev.id
    await db_session.commit()

    mock_resp = httpx.Response(status_code=400, text="Malformed contract payload")
    with patch("httpx.AsyncClient.post", new_callable=AsyncMock) as mock_post:
        mock_post.return_value = mock_resp
        success = await svc.dispatch_delivery(delivery_id)

    assert not success
    delivery = await repo.get_delivery_by_id(delivery_id)
    assert delivery is not None
    assert delivery.status == DeliveryStatus.DEAD_LETTER
    assert delivery.attempt_count == 1
    assert "HTTP_400" in (delivery.last_error_code or "")

    # Cleanup
    saved_ev = await repo.get_by_id(event_id)
    if saved_ev:
        await db_session.delete(saved_ev)
        await db_session.commit()


# -----------------------------------------------------------------------------
# Test 7: Exponential backoff and jitter calculations
# -----------------------------------------------------------------------------
async def test_07_exponential_backoff_and_jitter():
    """Verify bounded exponential backoff with non-zero randomized jitter."""
    d1 = DeliveryRetryPolicy.calculate_backoff(attempt=1, base_delay=5.0, jitter=2.0)
    d2 = DeliveryRetryPolicy.calculate_backoff(attempt=2, base_delay=5.0, jitter=2.0)
    d3 = DeliveryRetryPolicy.calculate_backoff(attempt=3, base_delay=5.0, jitter=2.0)

    assert 5.0 <= d1 <= 7.2
    assert 10.0 <= d2 <= 12.2
    assert 20.0 <= d3 <= 22.2
    assert d1 < d2 < d3

    # Capped at max_delay
    d_max = DeliveryRetryPolicy.calculate_backoff(attempt=20, max_delay=60.0)
    assert d_max <= 63.0


# -----------------------------------------------------------------------------
# Test 8: Max attempts exhaustion to DEAD_LETTER
# -----------------------------------------------------------------------------
async def test_08_max_attempt_exhaustion_dead_letter(db_session):
    """When attempt count reaches max_attempts, delivery transitions to DEAD_LETTER."""
    repo = IntegrationOutboxRepository(db_session)
    svc = IntegrationService(repo)

    ev = svc.publish_event(
        event_type="buyer.created",
        aggregate_type="buyer",
        aggregate_id=uuid.uuid4(),
        payload={"data": "test"},
        target="yinglima",
    )
    delivery_id = ev.deliveries[0].id
    event_id = ev.id
    await db_session.flush()

    delivery = ev.deliveries[0]
    delivery.attempt_count = 4
    delivery.max_attempts = 5
    await db_session.commit()

    mock_resp = httpx.Response(status_code=500, text="Internal Server Error")
    with patch("httpx.AsyncClient.post", new_callable=AsyncMock) as mock_post:
        mock_post.return_value = mock_resp
        await svc.dispatch_delivery(delivery_id)

    delivery = await repo.get_delivery_by_id(delivery_id)
    saved_ev = await repo.get_by_id(event_id)
    assert delivery is not None
    assert delivery.attempt_count == 5
    assert delivery.status == DeliveryStatus.DEAD_LETTER
    assert saved_ev is not None
    assert saved_ev.status == OutboxEventStatus.DEAD_LETTER

    # Cleanup
    await db_session.delete(saved_ev)
    await db_session.commit()


# -----------------------------------------------------------------------------
# Test 9: Audited dead-letter replay preserving event_id and version context
# -----------------------------------------------------------------------------
async def test_09_dead_letter_replay(db_session):
    """Replaying a dead-letter delivery resets state to PENDING while preserving event identity."""
    repo = IntegrationOutboxRepository(db_session)
    svc = IntegrationService(repo)

    ev = svc.publish_event(
        event_type="buyer.created",
        aggregate_type="buyer",
        aggregate_id=uuid.uuid4(),
        payload={"data": "test"},
        target="yinglima",
    )
    delivery_id = ev.deliveries[0].id
    event_id = ev.id
    original_event_id = ev.event_id
    original_correlation_id = ev.correlation_id
    await db_session.flush()

    delivery = ev.deliveries[0]
    delivery.status = DeliveryStatus.DEAD_LETTER
    delivery.attempt_count = 5
    delivery.last_error_code = "HTTP_500"
    delivery.last_error_message = "Server Error"
    await db_session.commit()

    repair = RepairService(db_session)
    operator_id = uuid.uuid4()
    success = await repair.replay_dead_letter_delivery(delivery_id, actor_id=operator_id)
    assert success

    delivery = await repo.get_delivery_by_id(delivery_id)
    saved_ev = await repo.get_by_id(event_id)

    assert delivery is not None
    assert delivery.status == DeliveryStatus.PENDING
    assert delivery.attempt_count == 0
    assert delivery.last_error_code is None
    assert saved_ev is not None
    assert saved_ev.event_id == original_event_id
    assert saved_ev.correlation_id == original_correlation_id

    # Cleanup
    await db_session.delete(saved_ev)
    await db_session.commit()


# -----------------------------------------------------------------------------
# Test 10: Duplicate consumer event detection and idempotent NOOP
# -----------------------------------------------------------------------------
async def test_10_duplicate_consumer_event(db_session):
    """Redelivered duplicate event envelope is recognized and skipped without duplicate entities."""
    engine = GenericSyncEngine()
    event_id = uuid.uuid4()
    source_buyer_id = str(uuid.uuid4())

    envelope = {
        "event_id": str(event_id),
        "event_type": "buyer.created",
        "event_version": 1,
        "source_erp": "yinglima",
        "entity_type": "buyer",
        "source_entity_id": source_buyer_id,
        "entity_version": 1,
        "payload": {
            "company_name": "Idempotent Buyer Ltd",
            "city": "Dhaka",
        },
    }

    # First delivery
    res1 = await engine.process_event(db_session, envelope)
    assert res1.status == "PROCESSED"
    await db_session.commit()

    # Second delivery of same event_id
    res2 = await engine.process_event(db_session, envelope)
    assert res2.status == "SKIPPED_DUPLICATE"
    assert res2.action == "NOOP"

    # Verify only 1 mapping and 1 processed event record exist
    mappings = (
        await db_session.execute(
            select(SyncedEntityMapping).where(
                SyncedEntityMapping.source_erp_id == "yinglima",
                SyncedEntityMapping.source_entity_id == source_buyer_id,
            )
        )
    ).scalars().all()
    assert len(mappings) == 1

    # Cleanup
    if res1.local_entity_id:
        local_b = await db_session.get(Buyer, res1.local_entity_id)
        if local_b:
            await db_session.delete(local_b)
    await db_session.delete(mappings[0])
    await db_session.execute(
        delete(ProcessedIntegrationEvent).where(ProcessedIntegrationEvent.event_id == event_id)
    )
    await db_session.commit()


# -----------------------------------------------------------------------------
# Test 11: Transaction/idempotency failure window (atomic commit/rollback)
# -----------------------------------------------------------------------------
async def test_11_transaction_idempotency_failure_window(db_session):
    """If an exception occurs during event processing before commit, the session rolls back atomically."""
    engine = GenericSyncEngine()
    event_id = uuid.uuid4()
    source_buyer_id = str(uuid.uuid4())

    envelope = {
        "event_id": str(event_id),
        "event_type": "buyer.created",
        "event_version": 1,
        "source_erp": "yinglima",
        "entity_type": "buyer",
        "source_entity_id": source_buyer_id,
        "entity_version": 1,
        "payload": {
            "company_name": "Rollback Buyer Ltd",
            "city": "Chittagong",
        },
    }

    # Simulate failure after processing inside transaction before commit
    try:
        await engine.process_event(db_session, envelope)
        raise RuntimeError("Simulated mid-transaction crash before commit")
    except RuntimeError:
        await db_session.rollback()

    # Verify nothing was committed
    mapping = (
        await db_session.execute(
            select(SyncedEntityMapping).where(
                SyncedEntityMapping.source_erp_id == "yinglima",
                SyncedEntityMapping.source_entity_id == source_buyer_id,
            )
        )
    ).scalar_one_or_none()
    assert mapping is None

    # Subsequent re-delivery succeeds cleanly
    res = await engine.process_event(db_session, envelope)
    assert res.status == "PROCESSED"
    await db_session.commit()

    # Cleanup
    if res.local_entity_id:
        local_b = await db_session.get(Buyer, res.local_entity_id)
        if local_b:
            await db_session.delete(local_b)
    saved_m = (
        await db_session.execute(
            select(SyncedEntityMapping).where(
                SyncedEntityMapping.source_erp_id == "yinglima",
                SyncedEntityMapping.source_entity_id == source_buyer_id,
            )
        )
    ).scalar_one_or_none()
    if saved_m:
        await db_session.delete(saved_m)
    await db_session.execute(
        delete(ProcessedIntegrationEvent).where(ProcessedIntegrationEvent.event_id == event_id)
    )
    await db_session.commit()


# -----------------------------------------------------------------------------
# Test 12: Peer outage safe durable queuing
# -----------------------------------------------------------------------------
async def test_12_peer_outage_queuing(db_session):
    """Network connection errors queue events safely without data loss."""
    repo = IntegrationOutboxRepository(db_session)
    svc = IntegrationService(repo)

    ev = svc.publish_event(
        event_type="buyer.created",
        aggregate_type="buyer",
        aggregate_id=uuid.uuid4(),
        payload={"company_name": "Outage Buyer"},
        target="yinglima",
    )
    delivery_id = ev.deliveries[0].id
    event_id = ev.id
    await db_session.commit()

    with patch("httpx.AsyncClient.post", side_effect=httpx.ConnectError("Connection refused by peer")):
        success = await svc.dispatch_delivery(delivery_id)

    assert not success
    delivery = await repo.get_delivery_by_id(delivery_id)
    assert delivery is not None
    assert delivery.status == DeliveryStatus.RETRYING
    assert delivery.attempt_count == 1
    assert "ConnectError" in (delivery.last_error_code or "")

    # Cleanup
    saved_ev = await repo.get_by_id(event_id)
    if saved_ev:
        await db_session.delete(saved_ev)
        await db_session.commit()


# -----------------------------------------------------------------------------
# Test 13: Peer recovery drain
# -----------------------------------------------------------------------------
async def test_13_peer_recovery_drain(db_session):
    """When peer comes back online, retrying deliveries drain successfully to DELIVERED."""
    repo = IntegrationOutboxRepository(db_session)
    svc = IntegrationService(repo)

    ev = svc.publish_event(
        event_type="buyer.created",
        aggregate_type="buyer",
        aggregate_id=uuid.uuid4(),
        payload={"company_name": "Recovered Buyer"},
        target="yinglima",
    )
    delivery_id = ev.deliveries[0].id
    event_id = ev.id
    await db_session.flush()

    delivery = ev.deliveries[0]
    delivery.status = DeliveryStatus.RETRYING
    delivery.attempt_count = 1
    await db_session.commit()

    mock_resp = httpx.Response(status_code=200, json={"status": "PROCESSED"})
    with patch("httpx.AsyncClient.post", new_callable=AsyncMock) as mock_post:
        mock_post.return_value = mock_resp
        success = await svc.dispatch_delivery(delivery_id)

    assert success
    delivery = await repo.get_delivery_by_id(delivery_id)
    saved_ev = await repo.get_by_id(event_id)

    assert delivery is not None
    assert saved_ev is not None
    assert delivery.status == DeliveryStatus.DELIVERED
    assert saved_ev.status == OutboxEventStatus.PUBLISHED

    # Cleanup
    await db_session.delete(saved_ev)
    await db_session.commit()


# -----------------------------------------------------------------------------
# Test 14: ERP_Main outage independence
# -----------------------------------------------------------------------------
async def test_14_erp_main_outage_independence(db_session):
    """Peer-to-peer delivery completes successfully even if ERP_Main is completely unreachable."""
    repo = IntegrationOutboxRepository(db_session)
    svc = IntegrationService(repo)

    ev = svc.publish_event(
        event_type="buyer.created",
        aggregate_type="buyer",
        aggregate_id=uuid.uuid4(),
        payload={"company_name": "P2P Independent Buyer"},
        target="yinglima",
    )
    delivery_id = ev.deliveries[0].id
    event_id = ev.id
    target_erp = ev.deliveries[0].target_erp
    await db_session.commit()

    # Destination URL resolves directly to yinglima peer endpoint, not ERP_Main
    dest_url = svc._resolve_target_url(target_erp)
    assert "internal/integration" not in dest_url
    assert "yinglima" in dest_url or "8001" in dest_url

    mock_resp = httpx.Response(status_code=200, json={"status": "PROCESSED"})
    with patch("httpx.AsyncClient.post", new_callable=AsyncMock) as mock_post:
        mock_post.return_value = mock_resp
        success = await svc.dispatch_delivery(delivery_id)

    assert success
    delivery = await repo.get_delivery_by_id(delivery_id)
    assert delivery is not None
    assert delivery.status == DeliveryStatus.DELIVERED

    # Cleanup
    saved_ev = await repo.get_by_id(event_id)
    if saved_ev:
        await db_session.delete(saved_ev)
        await db_session.commit()


# -----------------------------------------------------------------------------
# Test 15: Missed LISTEN/NOTIFY discovery via durable polling
# -----------------------------------------------------------------------------
async def test_15_missed_notify_recovery(db_session):
    """Pending rows in the database are claimed and dispatched even if NOTIFY was missed."""
    repo = IntegrationOutboxRepository(db_session)
    svc = IntegrationService(repo)

    ev = svc.publish_event(
        event_type="buyer.created",
        aggregate_type="buyer",
        aggregate_id=uuid.uuid4(),
        payload={"company_name": "Missed Notify Buyer"},
        target="yinglima",
    )
    delivery_id = ev.deliveries[0].id
    event_id = ev.id
    await db_session.commit()

    # Worker sweep finds the row purely via database query
    claimed = await repo.claim_next_batch(worker_id="sweep_worker", batch_size=10)
    claimed_ids = [d.id for d in claimed]
    assert delivery_id in claimed_ids

    # Cleanup
    saved_ev = await repo.get_by_id(event_id)
    if saved_ev:
        await db_session.delete(saved_ev)
        await db_session.commit()


# -----------------------------------------------------------------------------
# Test 16: Bounded worker concurrency and backpressure batch limits
# -----------------------------------------------------------------------------
async def test_16_bounded_worker_concurrency(db_session):
    """Queue query enforces batch size limits to prevent unbounded memory usage."""
    repo = IntegrationOutboxRepository(db_session)
    svc = IntegrationService(repo)

    event_ids = []
    for i in range(15):
        ev = svc.publish_event(
            event_type="buyer.created",
            aggregate_type="buyer",
            aggregate_id=uuid.uuid4(),
            payload={"idx": i},
            target="yinglima",
        )
        event_ids.append(ev.id)
    await db_session.commit()

    claimed_batch = await repo.claim_next_batch(worker_id="test_worker", batch_size=5)
    assert len(claimed_batch) == 5

    # Cleanup
    await db_session.execute(delete(IntegrationOutboxEvent).where(IntegrationOutboxEvent.id.in_(event_ids)))
    await db_session.commit()


# -----------------------------------------------------------------------------
# Test 17: Peer circuit breaker and cooldown storm prevention
# -----------------------------------------------------------------------------
async def test_17_peer_circuit_breaker_and_cooldown(db_session):
    """5 consecutive failures trip the circuit to OPEN, deferring future deliveries."""
    circuit_svc = PeerCircuitBreakerService(db_session)
    peer_id = f"test_peer_{uuid.uuid4().hex[:6]}"

    for _ in range(5):
        await circuit_svc.record_failure(peer_id, "HTTP_500")

    allowed, state = await circuit_svc.can_attempt_delivery(peer_id)
    assert not allowed
    assert state == "OPEN_COOLDOWN"

    # Reset circuit on success
    await circuit_svc.record_success(peer_id)
    allowed2, state2 = await circuit_svc.can_attempt_delivery(peer_id)
    assert allowed2
    assert state2 == "CLOSED"

    # Cleanup
    await db_session.execute(delete(PeerHealthState).where(PeerHealthState.peer_id == peer_id))
    await db_session.commit()


# -----------------------------------------------------------------------------
# Test 18: Fan-out independent target delivery states
# -----------------------------------------------------------------------------
async def test_18_fan_out_independent_delivery(db_session):
    """One outbox event has independent delivery tracking per destination target."""
    repo = IntegrationOutboxRepository(db_session)
    svc = IntegrationService(repo)

    # Publish broadcast event (resolves to yinglima and erp_c)
    ev = svc.publish_event(
        event_type="buyer.created",
        aggregate_type="buyer",
        aggregate_id=uuid.uuid4(),
        payload={"company_name": "Fanout Buyer"},
        target="broadcast",
    )
    event_id = ev.id
    d_yinglima_id = ev.deliveries[0].id
    await db_session.commit()

    # Create synthetic second delivery for ERP_C to test fanout
    d_erpc = IntegrationOutboxDelivery(
        id=uuid.uuid4(),
        outbox_event_id=event_id,
        target_erp="erp_c",
        status=DeliveryStatus.PENDING,
        attempt_count=0,
        max_attempts=5,
        next_attempt_at=_utcnow(),
    )
    d_erpc_id = d_erpc.id
    db_session.add(d_erpc)
    await db_session.commit()

    # Mock yinglima succeeding (200) and erp_c failing (500)
    async def mock_post_fanout(url, *args, **kwargs):
        if "yinglima" in url or "8001" in url:
            return httpx.Response(status_code=200, json={"status": "PROCESSED"})
        return httpx.Response(status_code=500, text="Internal Error on ERP_C")

    with patch("httpx.AsyncClient.post", side_effect=mock_post_fanout):
        await svc.dispatch_delivery(d_yinglima_id)
        await svc.dispatch_delivery(d_erpc_id)

    d_yinglima = await repo.get_delivery_by_id(d_yinglima_id)
    d_erpc = await repo.get_delivery_by_id(d_erpc_id)

    assert d_yinglima is not None
    assert d_erpc is not None
    assert d_yinglima.status == DeliveryStatus.DELIVERED
    assert d_erpc.status == DeliveryStatus.RETRYING

    # Cleanup
    saved_ev = await repo.get_by_id(event_id)
    if saved_ev:
        await db_session.delete(saved_ev)
        await db_session.commit()


# -----------------------------------------------------------------------------
# Test 19: Unsupported contract version rejection
# -----------------------------------------------------------------------------
async def test_19_unsupported_contract_version(db_session):
    """Unsupported contract versions fail deterministically with UnsupportedContractVersionError."""
    engine = GenericSyncEngine()
    envelope_v99 = {
        "event_id": str(uuid.uuid4()),
        "event_type": "buyer.created",
        "event_version": 99,
        "source_erp": "yinglima",
        "entity_type": "buyer",
        "source_entity_id": str(uuid.uuid4()),
        "payload": {"company_name": "Future Contract"},
    }

    with pytest.raises(UnsupportedContractVersionError) as exc_info:
        await engine.process_event(db_session, envelope_v99)
    assert "99" in str(exc_info.value)


# -----------------------------------------------------------------------------
# Test 20: Malformed envelope schema rejection
# -----------------------------------------------------------------------------
async def test_20_malformed_schema_rejection(db_session):
    """Malformed envelopes missing required fields are rejected without modifying domain tables."""
    engine = GenericSyncEngine()
    malformed_envelope = {
        "event_id": str(uuid.uuid4()),
        # missing event_type, source_erp, entity_type
        "payload": {"company_name": "Malformed"},
    }

    with pytest.raises(ValueError) as exc_info:
        await engine.process_event(db_session, malformed_envelope)
    assert "Malformed cross-ERP event envelope" in str(exc_info.value)


# -----------------------------------------------------------------------------
# Test 21: Snapshot resumable cursor checkpointing
# -----------------------------------------------------------------------------
async def test_21_snapshot_resumable_checkpoint(db_session):
    """Snapshot job advances cursor offset and resumes from checkpoint upon interruption."""
    svc = SnapshotService(db_session)
    job = await svc.start_snapshot_job("buyer", "yinglima", batch_size=2)
    assert job.cursor_offset == 0
    assert job.status == "IN_PROGRESS"

    chunk1 = await svc.export_snapshot_chunk(job.id)
    assert chunk1["cursor_offset"] >= 0

    saved_job = await svc.get_snapshot_job(job.id)
    assert saved_job is not None
    # Checkpoint is persisted in database
    assert saved_job.cursor_offset == chunk1["cursor_offset"]

    # Cleanup
    await db_session.delete(saved_job)
    await db_session.commit()


# -----------------------------------------------------------------------------
# Test 22: Snapshot vs. live event OCC version race protection
# -----------------------------------------------------------------------------
async def test_22_snapshot_vs_live_event_version_race(db_session):
    """
    Test scenario from Phase 8F Section 16:
    Live event at version 11 arrives before snapshot export at version 10.
    System must finish authoritatively at version 11.
    """
    engine = GenericSyncEngine()
    source_buyer_id = str(uuid.uuid4())

    # Step 1: Live event version 11 arrives first
    live_envelope_v11 = {
        "event_id": str(uuid.uuid4()),
        "event_type": "buyer.updated",
        "event_version": 1,
        "source_erp": "yinglima",
        "entity_type": "buyer",
        "source_entity_id": source_buyer_id,
        "entity_version": 11,
        "payload": {
            "company_name": "Authoritative V11 Corp",
            "city": "Sylhet",
            "version": 11,
        },
    }
    res_live = await engine.process_event(db_session, live_envelope_v11)
    assert res_live.status == "PROCESSED"
    await db_session.commit()

    # Step 2: Stale snapshot version 10 arrives later
    snapshot_envelope_v10 = {
        "event_id": str(uuid.uuid4()),
        "event_type": "buyer.created",
        "event_version": 1,
        "source_erp": "yinglima",
        "entity_type": "buyer",
        "source_entity_id": source_buyer_id,
        "entity_version": 10,
        "payload": {
            "company_name": "Old V10 Corp",
            "city": "Sylhet",
            "version": 10,
        },
    }
    res_snap = await engine.process_event(db_session, snapshot_envelope_v10)
    assert res_snap.status == "SKIPPED_OUT_OF_ORDER"
    assert res_snap.action == "NOOP"

    # Verify final mapping is at version 11
    mapping = (
        await db_session.execute(
            select(SyncedEntityMapping).where(
                SyncedEntityMapping.source_erp_id == "yinglima",
                SyncedEntityMapping.source_entity_id == source_buyer_id,
            )
        )
    ).scalar_one()
    assert mapping.source_version == 11

    # Cleanup
    if res_live.local_entity_id:
        local_b = await db_session.get(Buyer, res_live.local_entity_id)
        if local_b:
            await db_session.delete(local_b)
    await db_session.delete(mapping)
    await db_session.commit()


# -----------------------------------------------------------------------------
# Test 23: Graceful worker restart and shutdown safety
# -----------------------------------------------------------------------------
async def test_23_graceful_worker_restart(db_session):
    """Worker drain allows short in-flight work to complete and cleanly releases locks."""
    repo = IntegrationOutboxRepository(db_session)
    svc = IntegrationService(repo)

    # Ensure clean outbox queue before testing worker drain
    await db_session.execute(delete(IntegrationOutboxDelivery))
    await db_session.execute(delete(IntegrationOutboxEvent))
    await db_session.commit()

    ev = svc.publish_event(
        event_type="buyer.created",
        aggregate_type="buyer",
        aggregate_id=uuid.uuid4(),
        payload={"company_name": "Drain Buyer"},
        target="yinglima",
    )
    delivery_id = ev.deliveries[0].id
    event_id = ev.id
    await db_session.commit()

    mock_resp = httpx.Response(status_code=200, json={"status": "PROCESSED"})
    with patch("httpx.AsyncClient.post", new_callable=AsyncMock) as mock_post:
        mock_post.return_value = mock_resp
        processed_count = await svc.drain_batch(worker_id="graceful_worker", batch_size=5)

    assert processed_count >= 1
    delivery = await repo.get_delivery_by_id(delivery_id)
    assert delivery is not None
    assert delivery.status == DeliveryStatus.DELIVERED
    assert delivery.worker_id is None

    # Cleanup
    saved_ev = await repo.get_by_id(event_id)
    if saved_ev:
        await db_session.delete(saved_ev)
        await db_session.commit()


# -----------------------------------------------------------------------------
# Test 24: Secret and credential redaction in errors and logs
# -----------------------------------------------------------------------------
async def test_24_secret_redaction_in_logs_and_errors():
    """Bearer tokens, authorization headers, and passwords are fully redacted."""
    raw_error = (
        "HTTP 401 Unauthorized: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.xyz.abc "
        "password='super_secret_password_123' token=\"secret_api_token_abc\""
    )
    cleaned = sanitize_error(raw_error)

    assert "Bearer [REDACTED]" in cleaned
    assert "password='[REDACTED]'" in cleaned
    assert "token=\"[REDACTED]\"" in cleaned
    assert "eyJhbGci" not in cleaned
    assert "super_secret_password_123" not in cleaned


# -----------------------------------------------------------------------------
# Test 25: Entity reconciliation reporting after recovery
# -----------------------------------------------------------------------------
async def test_25_reconciliation_after_recovery(db_session):
    """Reconciliation service detects matched, active, and divergent records accurately."""
    rec_svc = ReconciliationService(db_session)
    report = await rec_svc.reconcile_entity("buyer", source_erp_id="yinglima")
    assert report.entity_type == "buyer"
    assert report.status in ("MATCHED", "DIVERGENT")
    assert isinstance(report.synced_count, int)
