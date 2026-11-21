"""
Wave 4 Remediation Regression Tests — BUG-006 (Yinglima Integration Reliability & Idempotency).

Validates strictly with synthetic test messages in an isolated SQLite database:
1. Outbound credential resolution never emits placeholder 'CHANGE-ME' when ERP_MAIN_SERVICE_CREDENTIAL
   or PEER_SERVICE_CREDENTIALS is configured.
2. Circuit breaker cooldown recovery (OPEN -> HALF_OPEN -> CLOSED / OPEN) and selective peer-failure
   tripping (5xx/401/network trip circuit; single-message 400/422 payload errors do not).
3. Dead-letter preservation (drain_batch never auto-replays DEAD_LETTER rows) + explicit operator
   replay enqueues QueueJob and preserves event_id for idempotent consumer processing.
4. ImportPurchase natural-key deduplication prevents both duplicate creation on replay and substring
   false-matching (e.g. SO-1 vs SO-10).
5. Direct peer ingestion endpoint (/api/v1/integration/events) enforces service auth (401), returns 400
   for malformed envelopes, and cleanly acknowledges unsubscribed broadcast entity types (200 NOOP)
   instead of crashing with HTTP 500.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

import httpx
import pytest
from fastapi import FastAPI, Request
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import Settings, settings
from app.core.exception_handlers import register_exception_handlers
from app.database.base import Base
from app.database.session import get_db_session
from app.integration.adapters.import_purchase import ImportPurchaseSyncAdapter
from app.integration.models import DeliveryStatus, OutboxEventStatus, PeerHealthState
from app.integration.reliability import PeerCircuitBreakerService
from app.integration.repair import RepairService
from app.integration.repository import IntegrationOutboxRepository
from app.integration.routes import router as integration_router
from app.integration.service import IntegrationService
from app.integration.sync_engine import GenericSyncEngine
from app.purchase.models import ImportPurchase
from app.queue.models import QueueJob

pytestmark = pytest.mark.asyncio


@pytest.fixture
async def isolated_db():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(bind=engine, class_=AsyncSession, expire_on_commit=False)
    async with factory() as session:
        yield session
    await engine.dispose()


async def test_outbound_service_credential_skips_placeholder() -> None:
    cfg = Settings(
        FEDERATION_SERVICE_CREDENTIAL="CHANGE-ME-IN-PRODUCTION-erp-main-service-credential",
        ERP_MAIN_SERVICE_CREDENTIAL="synthetic-valid-erp-main-token-001",
        PEER_SERVICE_CREDENTIALS="synthetic-peer-token-002",
    )
    assert cfg.get_outbound_service_credential() == "synthetic-valid-erp-main-token-001"

    cfg_both_set = Settings(
        FEDERATION_SERVICE_CREDENTIAL="synthetic-legacy-fed-cred",
        ERP_MAIN_SERVICE_CREDENTIAL="synthetic-valid-erp-main-token-001",
        PEER_SERVICE_CREDENTIALS="synthetic-peer-token-002",
    )
    # Must prioritize ERP_MAIN_SERVICE_CREDENTIAL matching render.yaml and peer receiver priority
    assert cfg_both_set.get_outbound_service_credential() == "synthetic-valid-erp-main-token-001"
    assert "synthetic-legacy-fed-cred" in cfg_both_set.get_expected_erp_main_credentials()

    cfg_peer_only = Settings(
        FEDERATION_SERVICE_CREDENTIAL="CHANGE-ME-IN-PRODUCTION-erp-main-service-credential",
        ERP_MAIN_SERVICE_CREDENTIAL="",
        PEER_SERVICE_CREDENTIALS="synthetic-peer-token-002",
    )
    assert cfg_peer_only.get_outbound_service_credential() == "synthetic-peer-token-002"


async def test_circuit_breaker_cooldown_recovery_and_selective_tripping(isolated_db: AsyncSession) -> None:
    cb = PeerCircuitBreakerService(isolated_db)
    peer = "yinglima"

    # Single-message 400/422 payload errors must NOT trip the peer circuit
    assert PeerCircuitBreakerService.should_trip_on_status(400) is False
    assert PeerCircuitBreakerService.should_trip_on_status(422) is False
    assert PeerCircuitBreakerService.should_trip_on_status(401) is True
    assert PeerCircuitBreakerService.should_trip_on_status(503) is True

    for _ in range(5):
        await cb.record_failure(peer, "HTTP_503")
    await isolated_db.commit()

    allowed, state_name = await cb.can_attempt_delivery(peer)
    assert allowed is False
    assert state_name == "OPEN_COOLDOWN"

    # Simulate cooldown expiration -> list_all_states and can_attempt_delivery transition to HALF_OPEN
    row = await cb.get_or_create(peer)
    row.cooldown_until = datetime.now(timezone.utc) - timedelta(seconds=5)
    await isolated_db.commit()

    states = await cb.list_all_states()
    assert states[0].circuit_state == "HALF_OPEN"

    # Failed probe in HALF_OPEN immediately re-opens circuit
    await cb.record_failure(peer, "HTTP_503")
    row = await cb.get_or_create(peer)
    assert row.circuit_state == "OPEN"

    # Expire cooldown again -> probe succeeds -> circuit closes cleanly
    row.cooldown_until = datetime.now(timezone.utc) - timedelta(seconds=5)
    allowed2, state2 = await cb.can_attempt_delivery(peer)
    assert allowed2 is True
    assert state2 == "HALF_OPEN"
    await cb.record_success(peer)
    row = await cb.get_or_create(peer)
    assert row.circuit_state == "CLOSED"
    assert row.consecutive_failures == 0


async def test_dead_letters_never_auto_replayed_and_explicit_replay_is_idempotent(
    isolated_db: AsyncSession,
) -> None:
    repo = IntegrationOutboxRepository(isolated_db)
    svc = IntegrationService(repo)

    with patch.object(
        type(settings),
        "peer_erp_endpoints_map",
        property(lambda self: {"yinglima": "https://synthetic-yinglima.example/api/v1"}),
    ):
        dead_ev = svc.publish_event(
            event_type="buyer.created",
            aggregate_type="buyer",
            aggregate_id=uuid.uuid4(),
            payload={"company_name": "Synthetic DeadLetter Co"},
            target="yinglima",
        )
        pending_ev = svc.publish_event(
            event_type="buyer.created",
            aggregate_type="buyer",
            aggregate_id=uuid.uuid4(),
            payload={"company_name": "Synthetic Pending Co"},
            target="yinglima",
        )
        await isolated_db.flush()

        dead_delivery = dead_ev.deliveries[0]
        dead_delivery.status = DeliveryStatus.DEAD_LETTER
        dead_ev.status = OutboxEventStatus.DEAD_LETTER
        original_dead_event_id = dead_ev.event_id
        await isolated_db.commit()

        # Periodic drain_batch processes ONLY the PENDING delivery and leaves DEAD_LETTER untouched
        with patch("httpx.AsyncClient.post", new_callable=AsyncMock) as mock_post:
            mock_post.return_value = httpx.Response(status_code=200, json={"status": "PROCESSED"})
            drained = await svc.drain_batch(worker_id="test-drain", batch_size=10)
            await isolated_db.commit()

        assert drained == 1
        assert (await repo.get_delivery_by_id(pending_ev.deliveries[0].id)).status == DeliveryStatus.DELIVERED
        assert (await repo.get_delivery_by_id(dead_delivery.id)).status == DeliveryStatus.DEAD_LETTER

        # Explicit operator replay schedules QueueJob while preserving original event_id
        repair = RepairService(isolated_db)
        replayed = await repair.replay_dead_letter_delivery(dead_delivery.id, actor_id=uuid.uuid4())
        assert replayed is True
        refreshed_dead = await repo.get_delivery_by_id(dead_delivery.id)
        assert refreshed_dead.status == DeliveryStatus.PENDING
        assert refreshed_dead.outbox_event.event_id == original_dead_event_id

        jobs = (
            await isolated_db.execute(
                select(QueueJob).where(QueueJob.job_name == "dispatch_integration_event")
            )
        ).scalars().all()
        assert len(jobs) == 1


async def test_import_purchase_replay_dedup_and_no_substring_collision(
    isolated_db: AsyncSession,
) -> None:
    engine = GenericSyncEngine()
    adapter = ImportPurchaseSyncAdapter()

    source_order_10_id = str(uuid.uuid4())
    env_10 = {
        "event_id": str(uuid.uuid4()),
        "event_type": "import_purchase.created",
        "event_version": 1,
        "source_erp": "yinglima",
        "entity_type": "import_purchase",
        "source_entity_id": source_order_10_id,
        "payload": {
            "order_no": "SO-10",
            "consignment_code": "SYN-CONS-10",
            "buyer_name": "Inhyma",
            "branch_name": "Inhyma Mumbai",
            "conversion_rate": 85.0,
            "total_amount_usd": 1000.0,
            "total_cbm": 2.0,
            "items": [
                {
                    "product_name": "Synthetic Sealer",
                    "product_code": "SYN-10",
                    "quantity": 2.0,
                    "unit_price_usd": 500.0,
                    "pkg_unit_cbm": 1.0,
                    "pkg_qty": 1.0,
                }
            ],
        },
    }
    res1 = await engine.process_event(isolated_db, env_10)
    await isolated_db.commit()
    assert res1.status == "PROCESSED"
    assert res1.action == "CREATED"

    # Replaying exact same event_id is a strict duplicate NOOP (zero duplicate ImportPurchase rows)
    res_dup = await engine.process_event(isolated_db, env_10)
    assert res_dup.status == "SKIPPED_DUPLICATE"
    assert res_dup.action == "NOOP"

    # Substring check: 'SO-1' must NOT false-match existing 'SO-10'
    match_so1 = await adapter.find_existing_by_natural_key(isolated_db, {"order_no": "SO-1"})
    assert match_so1 is None

    # Exact match: 'SO-10' DOES match existing 'SO-10'
    match_so10 = await adapter.find_existing_by_natural_key(isolated_db, {"order_no": "SO-10"})
    assert match_so10 is not None
    assert match_so10[0] == res1.local_entity_id

    all_imports = (await isolated_db.execute(select(ImportPurchase))).scalars().all()
    assert len(all_imports) == 1


async def test_ingest_direct_event_auth_and_unsubscribed_entity_handling(
    isolated_db: AsyncSession,
) -> None:
    app = FastAPI()

    @app.middleware("http")
    async def _attach_req_id(request: Request, call_next):
        request.state.request_id = "test-wave4-req"
        return await call_next(request)

    register_exception_handlers(app)
    app.include_router(integration_router, prefix="/api/v1")

    async def _override_db():
        yield isolated_db

    app.dependency_overrides[get_db_session] = _override_db

    valid_cred = settings.get_outbound_service_credential()
    auth_headers = {"Authorization": f"Bearer {valid_cred}"}

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        # 1. Missing auth -> 401
        r_unauth = await client.post("/api/v1/integration/events", json={})
        assert r_unauth.status_code == 401

        # 2. Malformed envelope -> 400 (not 500)
        r_bad = await client.post(
            "/api/v1/integration/events",
            headers=auth_headers,
            json={"event_id": str(uuid.uuid4())},
        )
        assert r_bad.status_code == 400

        # 3. Unsubscribed broadcast entity (e.g. inquiry.created) -> 200 REJECTED/NOOP (no 500 retry storm)
        r_unsub = await client.post(
            "/api/v1/integration/events",
            headers=auth_headers,
            json={
                "event_id": str(uuid.uuid4()),
                "event_type": "inquiry.created",
                "event_version": 1,
                "source_erp": "yinglima",
                "entity_type": "inquiry",
                "source_entity_id": str(uuid.uuid4()),
                "payload": {"inquiry_no": "SYN-INQ-1"},
            },
        )
        assert r_unsub.status_code == 200
        assert r_unsub.json()["data"]["status"] == "REJECTED"
        assert r_unsub.json()["data"]["action"] == "NOOP"
