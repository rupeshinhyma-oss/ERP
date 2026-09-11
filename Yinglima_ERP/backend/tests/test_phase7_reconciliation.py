"""
Phase 7 Test: Buyer Sync Reconciliation.

Tests the actual reconciliation logic: comparing processed events
against synced buyers to detect and report divergence, without
querying the source ERP directly.
"""

from __future__ import annotations

import uuid

import pytest
import pytest_asyncio

from app.database.engine import dispose_engine, get_sessionmaker
from app.integration.consumer_models import ProcessedIntegrationEvent, SyncedBuyerSource
from app.integration.reconciliation import ReconciliationService

pytestmark = pytest.mark.asyncio


@pytest_asyncio.fixture
async def db_session():
    """A real session against the test Postgres database, disposed before/after for event-loop isolation."""
    await dispose_engine()
    session_factory = get_sessionmaker()
    async with session_factory() as session:
        yield session
        await session.rollback()
    await dispose_engine()


class TestBuyerSyncReconciliation:
    """The reconciliation comparison logic."""

    async def test_matched_when_every_processed_event_has_a_synced_buyer(self, db_session):
        from sqlalchemy import delete

        await db_session.execute(delete(ProcessedIntegrationEvent).where(ProcessedIntegrationEvent.event_type == "buyer.created"))
        await db_session.execute(delete(SyncedBuyerSource))
        await db_session.commit()

        event_id = uuid.uuid4()
        local_buyer_id = uuid.uuid4()

        db_session.add(
            ProcessedIntegrationEvent(event_id=event_id, consumer_id="default", event_type="buyer.created")
        )
        db_session.add(
            SyncedBuyerSource(
                source_erp_id="yinglima", source_buyer_id=str(uuid.uuid4()), local_buyer_id=local_buyer_id
            )
        )
        await db_session.commit()

        report = await ReconciliationService(db_session).reconcile_buyer_sync()

        assert report.processed_count == 1
        assert report.synced_count == 1
        assert report.unaccounted_count == 0
        assert report.status == "MATCHED"

    async def test_divergence_is_detected_and_reported(self, db_session):
        """A processed event with NO corresponding synced buyer must be reported as divergence, not silently hidden."""
        # Fully self-contained: clear both tables first so this test's
        # assertions are exact, not dependent on whatever unrelated rows
        # a different test run may have left in the shared test
        # database (a real, recurring hygiene issue across this
        # project's test suites -- see PHASE7_SYNC.md's known
        # limitations for the broader note on this).
        from sqlalchemy import delete

        await db_session.execute(delete(ProcessedIntegrationEvent).where(ProcessedIntegrationEvent.event_type == "buyer.created"))
        await db_session.execute(delete(SyncedBuyerSource))
        await db_session.commit()

        db_session.add(
            ProcessedIntegrationEvent(event_id=uuid.uuid4(), consumer_id="default", event_type="buyer.created")
        )
        db_session.add(
            SyncedBuyerSource(source_erp_id="yinglima", source_buyer_id=str(uuid.uuid4()), local_buyer_id=uuid.uuid4())
        )
        db_session.add(
            ProcessedIntegrationEvent(event_id=uuid.uuid4(), consumer_id="default", event_type="buyer.created")
        )
        await db_session.commit()

        report = await ReconciliationService(db_session).reconcile_buyer_sync()

        assert report.processed_count == 2
        assert report.synced_count == 1
        assert report.unaccounted_count == 1
        assert report.status == "DIVERGENT"

    async def test_report_to_dict_has_expected_shape(self, db_session):
        report = await ReconciliationService(db_session).reconcile_buyer_sync()
        data = report.to_dict()
        assert set(data.keys()) == {"event_type", "processed_count", "synced_count", "unaccounted_count", "status"}
        assert data["event_type"] == "buyer.created"
        assert data["status"] in ("MATCHED", "DIVERGENT")
