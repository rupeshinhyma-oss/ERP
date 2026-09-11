"""
Phase 8E Test Suite: Generic Cross-ERP Synchronization Framework (Inhyma).

Verifies:
1. Contract validation & error handling (malformed envelopes, unsupported versions, unknown entity types).
2. Direction enforcement (BIDIRECTIONAL, TARGET_TO_SOURCE rejection, disabled policy rejection).
3. Monotonic versioning (newer version applied, stale version rejected, duplicate version skipped).
4. Deduplication by event ID (idempotent no-op).
5. Formal data ownership (SOURCE_AUTHORITATIVE, TARGET_AUTHORITATIVE, field-level ownership).
6. Conflict arbitration (TARGET_WINS, MANUAL, REJECT_QUARANTINE).
7. Delete/archive semantics (PROPAGATE_ARCHIVE, IGNORE_DELETE).
8. Snapshot export & ingestion for initial sync.
9. Repair & replay service (missing mapping linking, outbox retry).
10. Generic entity reconciliation reporting.
11. Direct peer dispatch without ERP_Main runtime dependency.
"""

from __future__ import annotations

import uuid
from unittest.mock import AsyncMock, patch

import pytest
import pytest_asyncio
from sqlalchemy import delete, select

from app.buyers.models import Buyer
from app.database.engine import dispose_engine, get_sessionmaker
from app.integration.consumer_models import ProcessedIntegrationEvent, SyncedBuyerSource
from app.integration.models import IntegrationOutboxEvent, OutboxEventStatus
from app.integration.reconciliation import ReconciliationService
from app.integration.repair import RepairService
from app.integration.service import IntegrationService
from app.integration.snapshots import SnapshotService
from app.integration.sync_engine import (
    AdapterNotFoundError,
    GenericSyncEngine,
    PolicyDirectionViolationError,
    SyncConflictError,
    SyncPolicyConfig,
    UnsupportedContractVersionError,
)
from app.integration.sync_models import SyncedEntityMapping
from app.masters.countries.models import Country

pytestmark = pytest.mark.asyncio


@pytest_asyncio.fixture
async def db_session():
    """Real session against the test Postgres database."""
    await dispose_engine()
    session_factory = get_sessionmaker()
    async with session_factory() as session:
        yield session
        await session.rollback()
    await dispose_engine()


@pytest_asyncio.fixture
async def seeded_country(db_session):
    """Seed a real Country row with a unique ISO code."""
    unique_suffix = uuid.uuid4().hex[:4].upper()
    code = f"W{unique_suffix}"
    country = Country(name=f"Test Country {uuid.uuid4().hex}", code=code)
    db_session.add(country)
    await db_session.commit()
    yield country

    try:
        await db_session.rollback()
        result = await db_session.execute(select(Buyer).where(Buyer.country_id == country.id))
        for buyer in result.scalars().all():
            await db_session.delete(buyer)
        await db_session.flush()

        existing = await db_session.get(Country, country.id)
        if existing is not None:
            await db_session.delete(existing)
            await db_session.commit()
    except Exception:
        await db_session.rollback()


@pytest_asyncio.fixture(autouse=True)
async def cleanup_integration_tables(db_session):
    """Clean up integration tables before each test."""
    await db_session.execute(delete(ProcessedIntegrationEvent))
    await db_session.execute(delete(SyncedEntityMapping))
    await db_session.execute(delete(SyncedBuyerSource))
    await db_session.execute(delete(IntegrationOutboxEvent))
    await db_session.commit()


class TestGenericSyncEngineContractValidation:
    """1. Envelope & contract version validation."""

    async def test_malformed_envelope_raises_value_error(self, db_session):
        engine = GenericSyncEngine()
        envelope = {"event_id": str(uuid.uuid4())}
        with pytest.raises(ValueError, match="Malformed cross-ERP event envelope"):
            await engine.process_event(db_session, envelope)

    async def test_unsupported_contract_version_raises(self, db_session):
        engine = GenericSyncEngine()
        envelope = {
            "event_id": str(uuid.uuid4()),
            "event_type": "buyer.created",
            "event_version": 0,
            "source_erp": "yinglima",
            "entity_type": "buyer",
            "source_entity_id": str(uuid.uuid4()),
            "payload": {"company_name": "Acme Inc."},
        }
        with pytest.raises(UnsupportedContractVersionError, match="Unsupported contract version"):
            await engine.process_event(db_session, envelope)

    async def test_unknown_entity_type_raises_adapter_not_found(self, db_session):
        engine = GenericSyncEngine()
        envelope = {
            "event_id": str(uuid.uuid4()),
            "event_type": "unknown_entity.created",
            "event_version": 1,
            "source_erp": "yinglima",
            "entity_type": "unknown_entity",
            "source_entity_id": str(uuid.uuid4()),
            "payload": {"name": "Test"},
        }
        with pytest.raises(AdapterNotFoundError, match="No sync adapter registered"):
            await engine.process_event(db_session, envelope)


class TestGenericSyncEngineDirectionPolicy:
    """2. Direction & enablement policy enforcement."""

    async def test_prohibited_direction_raises_policy_error(self, db_session, seeded_country):
        engine = GenericSyncEngine()
        engine.set_policy(
            source_erp="yinglima",
            entity_type="buyer",
            policy=SyncPolicyConfig(direction="TARGET_TO_SOURCE"),
        )
        envelope = {
            "event_id": str(uuid.uuid4()),
            "event_type": "buyer.created",
            "event_version": 1,
            "source_erp": "yinglima",
            "entity_type": "buyer",
            "source_entity_id": str(uuid.uuid4()),
            "payload": {"company_name": "Forbidden Buyer", "country_code": seeded_country.code},
        }
        with pytest.raises(PolicyDirectionViolationError, match="prohibits inbound sync"):
            await engine.process_event(db_session, envelope)

    async def test_disabled_policy_returns_rejected(self, db_session, seeded_country):
        engine = GenericSyncEngine()
        engine.set_policy(
            source_erp="yinglima",
            entity_type="buyer",
            policy=SyncPolicyConfig(enabled=False),
        )
        envelope = {
            "event_id": str(uuid.uuid4()),
            "event_type": "buyer.created",
            "event_version": 1,
            "source_erp": "yinglima",
            "entity_type": "buyer",
            "source_entity_id": str(uuid.uuid4()),
            "payload": {"company_name": "Disabled Policy Buyer", "country_code": seeded_country.code},
        }
        res = await engine.process_event(db_session, envelope)
        assert res.status == "REJECTED"


class TestGenericSyncEngineVersioningAndDedup:
    """3. Monotonic versioning & deduplication."""

    async def test_create_and_update_with_monotonic_versioning(self, db_session, seeded_country):
        engine = GenericSyncEngine()
        source_id = str(uuid.uuid4())
        event1_id = uuid.uuid4()

        # Step 1: Create event at version 1
        env1 = {
            "event_id": str(event1_id),
            "event_type": "buyer.created",
            "event_version": 1,
            "source_erp": "yinglima",
            "entity_type": "buyer",
            "source_entity_id": source_id,
            "payload": {
                "buyer_id": source_id,
                "company_name": "Beta Corp",
                "country_code": seeded_country.code,
                "version": 1,
            },
        }
        res1 = await engine.process_event(db_session, env1)
        assert res1.status == "PROCESSED"
        assert res1.action == "CREATED"
        local_id = res1.local_entity_id
        assert local_id is not None

        mapping = (
            await db_session.execute(
                select(SyncedEntityMapping).where(
                    SyncedEntityMapping.source_erp_id == "yinglima",
                    SyncedEntityMapping.entity_type == "buyer",
                    SyncedEntityMapping.source_entity_id == source_id,
                )
            )
        ).scalar_one()
        assert mapping.local_entity_id == local_id
        assert mapping.source_version == 1
        assert mapping.sync_status == "ACTIVE"

        # Step 2: Update event at version 2 (newer version accepted)
        event2_id = uuid.uuid4()
        env2 = {
            "event_id": str(event2_id),
            "event_type": "buyer.updated",
            "event_version": 1,
            "source_erp": "yinglima",
            "entity_type": "buyer",
            "source_entity_id": source_id,
            "payload": {
                "buyer_id": source_id,
                "company_name": "Beta Corp Updated",
                "city": "Gotham",
                "version": 2,
            },
        }
        res2 = await engine.process_event(db_session, env2)
        assert res2.status == "PROCESSED"
        assert res2.action == "UPDATED"
        assert res2.source_version == 2
        assert mapping.source_version == 2

        # Step 3: Stale out-of-order event at version 1 (rejected/skipped)
        event3_id = uuid.uuid4()
        env3 = {
            "event_id": str(event3_id),
            "event_type": "buyer.updated",
            "event_version": 1,
            "source_erp": "yinglima",
            "entity_type": "buyer",
            "source_entity_id": source_id,
            "payload": {
                "buyer_id": source_id,
                "company_name": "Beta Stale",
                "version": 1,
            },
        }
        res3 = await engine.process_event(db_session, env3)
        assert res3.status == "SKIPPED_OUT_OF_ORDER"
        assert res3.action == "NOOP"

        # Step 4: Duplicate version delivery (version 2 again)
        event4_id = uuid.uuid4()
        env4 = {
            "event_id": str(event4_id),
            "event_type": "buyer.updated",
            "event_version": 1,
            "source_erp": "yinglima",
            "entity_type": "buyer",
            "source_entity_id": source_id,
            "payload": {
                "buyer_id": source_id,
                "company_name": "Beta Corp Duplicate",
                "version": 2,
            },
        }
        res4 = await engine.process_event(db_session, env4)
        assert res4.status == "SKIPPED_DUPLICATE"
        assert res4.action == "NOOP"

        # Step 5: Duplicate event ID delivery
        res5 = await engine.process_event(db_session, env2)
        assert res5.status == "SKIPPED_DUPLICATE"


class TestGenericSyncEngineOwnershipAndConflict:
    """4. Ownership strategies & conflict arbitration."""

    async def test_target_authoritative_ignores_source_update(self, db_session, seeded_country):
        engine = GenericSyncEngine()
        engine.set_policy(
            source_erp="yinglima",
            entity_type="buyer",
            policy=SyncPolicyConfig(ownership_strategy="TARGET_AUTHORITATIVE"),
        )
        source_id = str(uuid.uuid4())

        env1 = {
            "event_id": str(uuid.uuid4()),
            "event_type": "buyer.created",
            "event_version": 1,
            "source_erp": "yinglima",
            "entity_type": "buyer",
            "source_entity_id": source_id,
            "payload": {"company_name": "Target Auth Buyer", "country_code": seeded_country.code, "version": 1},
        }
        res1 = await engine.process_event(db_session, env1)
        assert res1.action == "CREATED"

        env2 = {
            "event_id": str(uuid.uuid4()),
            "event_type": "buyer.updated",
            "event_version": 1,
            "source_erp": "yinglima",
            "entity_type": "buyer",
            "source_entity_id": source_id,
            "payload": {"company_name": "Overwritten Name", "version": 2},
        }
        res2 = await engine.process_event(db_session, env2)
        assert res2.action == "NOOP"

        buyer = await db_session.get(Buyer, res1.local_entity_id)
        assert buyer.company_name == "Target Auth Buyer"

    async def test_field_level_ownership_masking(self, db_session, seeded_country):
        engine = GenericSyncEngine()
        engine.set_policy(
            source_erp="yinglima",
            entity_type="buyer",
            policy=SyncPolicyConfig(
                ownership_strategy="SHARED",
                field_ownership={"company_name": "TARGET_OWNED"},
            ),
        )
        source_id = str(uuid.uuid4())

        env1 = {
            "event_id": str(uuid.uuid4()),
            "event_type": "buyer.created",
            "event_version": 1,
            "source_erp": "yinglima",
            "entity_type": "buyer",
            "source_entity_id": source_id,
            "payload": {"company_name": "Original Name", "country_code": seeded_country.code, "version": 1},
        }
        res1 = await engine.process_event(db_session, env1)

        env2 = {
            "event_id": str(uuid.uuid4()),
            "event_type": "buyer.updated",
            "event_version": 1,
            "source_erp": "yinglima",
            "entity_type": "buyer",
            "source_entity_id": source_id,
            "payload": {"company_name": "Attempted New Name", "city": "London", "version": 2},
        }
        res2 = await engine.process_event(db_session, env2)
        assert res2.action == "UPDATED"

        buyer = await db_session.get(Buyer, res1.local_entity_id)
        assert buyer.company_name == "Original Name"
        assert buyer.city == "London"

    async def test_conflict_target_wins_preserves_local_state(self, db_session, seeded_country):
        engine = GenericSyncEngine()
        engine.set_policy(
            source_erp="yinglima",
            entity_type="buyer",
            policy=SyncPolicyConfig(conflict_strategy="TARGET_WINS"),
        )
        source_id = str(uuid.uuid4())

        env1 = {
            "event_id": str(uuid.uuid4()),
            "event_type": "buyer.created",
            "event_version": 1,
            "source_erp": "yinglima",
            "entity_type": "buyer",
            "source_entity_id": source_id,
            "payload": {"company_name": "Conflict Co", "country_code": seeded_country.code, "version": 1},
        }
        res1 = await engine.process_event(db_session, env1)

        buyer = await db_session.get(Buyer, res1.local_entity_id)
        buyer.version = 5
        buyer.company_name = "Locally Modified Co"
        await db_session.commit()

        env2 = {
            "event_id": str(uuid.uuid4()),
            "event_type": "buyer.updated",
            "event_version": 1,
            "source_erp": "yinglima",
            "entity_type": "buyer",
            "source_entity_id": source_id,
            "payload": {"company_name": "Source Incoming Co", "version": 2},
        }
        res2 = await engine.process_event(db_session, env2)
        assert res2.status == "PROCESSED"
        assert res2.action == "NOOP"

        refreshed = await db_session.get(Buyer, res1.local_entity_id)
        assert refreshed.company_name == "Locally Modified Co"

    async def test_conflict_manual_flags_conflict_status(self, db_session, seeded_country):
        engine = GenericSyncEngine()
        engine.set_policy(
            source_erp="yinglima",
            entity_type="buyer",
            policy=SyncPolicyConfig(conflict_strategy="MANUAL"),
        )
        source_id = str(uuid.uuid4())

        env1 = {
            "event_id": str(uuid.uuid4()),
            "event_type": "buyer.created",
            "event_version": 1,
            "source_erp": "yinglima",
            "entity_type": "buyer",
            "source_entity_id": source_id,
            "payload": {"company_name": "Manual Co", "country_code": seeded_country.code, "version": 1},
        }
        res1 = await engine.process_event(db_session, env1)

        buyer = await db_session.get(Buyer, res1.local_entity_id)
        buyer.version = 3
        buyer.company_name = "Locally Modified Co"
        await db_session.commit()

        env2 = {
            "event_id": str(uuid.uuid4()),
            "event_type": "buyer.updated",
            "event_version": 1,
            "source_erp": "yinglima",
            "entity_type": "buyer",
            "source_entity_id": source_id,
            "payload": {"company_name": "Incoming Co", "version": 2},
        }
        res2 = await engine.process_event(db_session, env2)
        assert res2.status == "CONFLICT_RECORDED"
        assert res2.action == "CONFLICT"

        mapping = (
            await db_session.execute(
                select(SyncedEntityMapping).where(
                    SyncedEntityMapping.source_erp_id == "yinglima",
                    SyncedEntityMapping.source_entity_id == source_id,
                )
            )
        ).scalar_one()
        assert mapping.sync_status == "CONFLICT"

    async def test_conflict_reject_quarantine_raises_exception(self, db_session, seeded_country):
        engine = GenericSyncEngine()
        engine.set_policy(
            source_erp="yinglima",
            entity_type="buyer",
            policy=SyncPolicyConfig(conflict_strategy="REJECT_QUARANTINE"),
        )
        source_id = str(uuid.uuid4())

        env1 = {
            "event_id": str(uuid.uuid4()),
            "event_type": "buyer.created",
            "event_version": 1,
            "source_erp": "yinglima",
            "entity_type": "buyer",
            "source_entity_id": source_id,
            "payload": {"company_name": "Quarantine Co", "country_code": seeded_country.code, "version": 1},
        }
        res1 = await engine.process_event(db_session, env1)

        buyer = await db_session.get(Buyer, res1.local_entity_id)
        buyer.version = 3
        buyer.company_name = "Locally Modified Quarantine"
        await db_session.commit()

        env2 = {
            "event_id": str(uuid.uuid4()),
            "event_type": "buyer.updated",
            "event_version": 1,
            "source_erp": "yinglima",
            "entity_type": "buyer",
            "source_entity_id": source_id,
            "payload": {"company_name": "Incoming Quarantine", "version": 2},
        }
        with pytest.raises(SyncConflictError, match="Concurrent conflict"):
            await engine.process_event(db_session, env2)


class TestGenericSyncEngineDeletions:
    """5. Deletion & archive propagation semantics."""

    async def test_propagate_archive_deactivates_local_record(self, db_session, seeded_country):
        engine = GenericSyncEngine()
        engine.set_policy(
            source_erp="yinglima",
            entity_type="buyer",
            policy=SyncPolicyConfig(delete_strategy="PROPAGATE_ARCHIVE"),
        )
        source_id = str(uuid.uuid4())

        env1 = {
            "event_id": str(uuid.uuid4()),
            "event_type": "buyer.created",
            "event_version": 1,
            "source_erp": "yinglima",
            "entity_type": "buyer",
            "source_entity_id": source_id,
            "payload": {"company_name": "To Archive Co", "country_code": seeded_country.code, "version": 1},
        }
        res1 = await engine.process_event(db_session, env1)

        env2 = {
            "event_id": str(uuid.uuid4()),
            "event_type": "buyer.deleted",
            "event_version": 1,
            "source_erp": "yinglima",
            "entity_type": "buyer",
            "source_entity_id": source_id,
            "payload": {"version": 2},
        }
        res2 = await engine.process_event(db_session, env2)
        assert res2.action == "DELETED"

        buyer = await db_session.get(Buyer, res1.local_entity_id)
        assert buyer.is_active is False

        mapping = (
            await db_session.execute(
                select(SyncedEntityMapping).where(
                    SyncedEntityMapping.source_erp_id == "yinglima",
                    SyncedEntityMapping.source_entity_id == source_id,
                )
            )
        ).scalar_one()
        assert mapping.sync_status == "ARCHIVED"


class TestSnapshotService:
    """6. Snapshot export & ingestion."""

    async def test_export_and_ingest_snapshot(self, db_session, seeded_country):
        b = Buyer(
            company_name="Snapshot Export Co",
            country_id=seeded_country.id,
            city="Paris",
            is_active=True,
            version=1,
        )
        db_session.add(b)
        await db_session.commit()

        snapshot_service = SnapshotService(db_session)
        export_data = await snapshot_service.export_snapshot("buyer")
        assert export_data["entity_type"] == "buyer"
        assert export_data["total_count"] >= 1
        assert len(export_data["records"]) >= 1

        await db_session.execute(delete(SyncedEntityMapping))
        await db_session.execute(delete(ProcessedIntegrationEvent))
        await db_session.commit()

        engine = GenericSyncEngine()
        import_payload = {
            "source_erp": "yinglima",
            "entity_type": "buyer",
            "records": [
                {
                    "entity_id": str(uuid.uuid4()),
                    "company_name": f"Imported Co {uuid.uuid4().hex[:6]}",
                    "country_code": seeded_country.code,
                    "city": "Lyon",
                    "version": 1,
                }
            ],
        }
        ingest_res = await snapshot_service.ingest_snapshot(engine, import_payload)
        assert ingest_res["processed"] == 1
        assert ingest_res["conflicts"] == 0


class TestRepairAndReconciliationServices:
    """7. Repair service & generic reconciliation."""

    async def test_repair_missing_mapping_by_natural_key(self, db_session, seeded_country):
        company_name = f"Unmapped Corp {uuid.uuid4().hex[:6]}"
        b = Buyer(
            company_name=company_name,
            country_id=seeded_country.id,
            version=1,
        )
        db_session.add(b)
        await db_session.commit()

        repair = RepairService(db_session)
        source_id = str(uuid.uuid4())
        mapping = await repair.repair_missing_mapping(
            source_erp_id="yinglima",
            entity_type="buyer",
            source_entity_id=source_id,
            payload={"company_name": company_name, "version": 1},
        )
        assert mapping is not None
        assert mapping.local_entity_id == b.id
        assert mapping.source_erp_id == "yinglima"
        assert mapping.source_entity_id == source_id

    async def test_retry_outbox_event(self, db_session):
        import json
        outbox = IntegrationOutboxEvent(
            event_id=uuid.uuid4(),
            correlation_id=uuid.uuid4(),
            actor_type="system",
            aggregate_type="buyer",
            aggregate_id=uuid.uuid4(),
            event_type="buyer.created",
            payload=json.dumps({"company_name": "Test"}),
            status=OutboxEventStatus.FAILED,
            attempt_count=5,
            last_error="Network timeout",
        )
        db_session.add(outbox)
        await db_session.commit()

        repair = RepairService(db_session)
        success = await repair.retry_outbox_event(outbox.id)
        assert success is True

        await db_session.refresh(outbox)
        assert outbox.status == OutboxEventStatus.PENDING
        assert outbox.attempt_count == 0
        assert outbox.last_error is None

    async def test_generic_reconciliation_report(self, db_session, seeded_country):
        reconciliation = ReconciliationService(db_session)

        ev_id = uuid.uuid4()
        db_session.add(
            ProcessedIntegrationEvent(
                event_id=ev_id,
                consumer_id="sync_engine",
                event_type="buyer.created",
            )
        )
        db_session.add(
            SyncedEntityMapping(
                source_erp_id="yinglima",
                entity_type="buyer",
                source_entity_id=str(uuid.uuid4()),
                local_entity_id=uuid.uuid4(),
                source_version=1,
                local_version=1,
                sync_status="ACTIVE",
            )
        )
        await db_session.commit()

        report = await reconciliation.reconcile_entity("buyer")
        assert report.entity_type == "buyer"
        assert report.processed_count == 1
        assert report.synced_count == 1
        assert report.status == "MATCHED"


class TestPeerDirectDispatchWithoutControlPlane:
    """8. Peer direct delivery without ERP_Main online."""

    async def test_dispatch_event_calls_peer_directly(self, db_session):
        import json
        from app.core.config import settings
        from app.integration.repository import IntegrationOutboxRepository

        svc = IntegrationService(IntegrationOutboxRepository(db_session))
        outbox_event = IntegrationOutboxEvent(
            event_id=uuid.uuid4(),
            correlation_id=uuid.uuid4(),
            actor_type="system",
            aggregate_type="buyer",
            aggregate_id=uuid.uuid4(),
            event_type="buyer.created",
            target="yinglima",
            payload=json.dumps({"company_name": "Peer Test Co"}),
            status=OutboxEventStatus.PENDING,
        )
        db_session.add(outbox_event)
        await db_session.commit()

        mock_endpoints = {"yinglima": "http://yinglima-peer:8001/api/v1"}
        with patch.object(type(settings), "peer_erp_endpoints_map", property(lambda self: mock_endpoints)):
            with patch("httpx.AsyncClient.post", new_callable=AsyncMock) as mock_post:
                mock_resp = AsyncMock()
                mock_resp.status_code = 200
                mock_resp.json = AsyncMock(return_value={"status": "PROCESSED"})
                mock_post.return_value = mock_resp

                await svc.dispatch_event(outbox_event.id)
                await db_session.refresh(outbox_event)
                assert outbox_event.status == OutboxEventStatus.PUBLISHED

                call_args = mock_post.call_args
                url = call_args[0][0]
                assert url == "http://yinglima-peer:8001/api/v1/integration/events"
