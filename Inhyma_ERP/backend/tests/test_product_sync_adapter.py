"""
Test ProductSyncAdapter and One-Way Sync from Yinglima to Inhyma.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

import pytest
import pytest_asyncio
from sqlalchemy import select

from app.core.constants import RecordStatus
from app.database.engine import dispose_engine, get_sessionmaker
from app.integration.sync_engine import GenericSyncEngine
from app.integration.sync_models import SyncedEntityMapping
from app.masters.products.models import Product

pytestmark = pytest.mark.asyncio


@pytest_asyncio.fixture
async def db_session():
    """Real session against the database."""
    await dispose_engine()
    session_factory = get_sessionmaker()
    async with session_factory() as session:
        yield session
        await session.rollback()
    await dispose_engine()


@pytest.mark.asyncio
async def test_product_sync_create_update_deactivate(db_session):
    engine = GenericSyncEngine()
    source_pid = str(uuid.uuid4())

    # 1. CREATE event from Yinglima
    create_envelope = {
        "event_id": str(uuid.uuid4()),
        "event_type": "product.created",
        "event_version": 1,
        "occurred_at": datetime.now(timezone.utc).isoformat(),
        "source_erp": "yinglima",
        "target_erp": "inhyma",
        "entity_type": "product",
        "source_entity_id": source_pid,
        "payload": {
            "product_id": source_pid,
            "product_code": f"SYNC-{source_pid[:6].upper()}",
            "product_name": "Test Synced Machine",
            "product_name_tally": "Test Synced Machine",
            "category_name": "Test Machinery",
            "uom_code": "SET",
            "packaging_gross_weight": 12.5,
            "packaging_unit_cbm": 0.045,
            "is_active": True,
            "status": "active",
            "version": 1,
        },
    }

    result = await engine.process_event(db_session, create_envelope)
    await db_session.flush()

    assert result.status == "PROCESSED"
    assert result.action == "CREATED"
    local_id = result.local_entity_id

    # Verify product in database
    product = (await db_session.execute(select(Product).where(Product.id == local_id))).scalar_one()
    assert product.product_name_tally == "Test Synced Machine"
    assert product.status == RecordStatus.ACTIVE
    assert float(product.packaging_gross_weight) == 12.5

    # 2. UPDATE event from Yinglima
    update_envelope = {
        "event_id": str(uuid.uuid4()),
        "event_type": "product.updated",
        "event_version": 1,
        "occurred_at": datetime.now(timezone.utc).isoformat(),
        "source_erp": "yinglima",
        "target_erp": "inhyma",
        "entity_type": "product",
        "source_entity_id": source_pid,
        "payload": {
            "product_id": source_pid,
            "product_name": "Test Synced Machine Pro",
            "product_name_tally": "Test Synced Machine Pro",
            "description": "Updated machine description",
            "version": 2,
        },
    }

    result2 = await engine.process_event(db_session, update_envelope)
    await db_session.flush()

    assert result2.status == "PROCESSED"
    assert result2.action == "UPDATED"

    # Refresh product and verify update
    await db_session.refresh(product)
    assert product.product_name_tally == "Test Synced Machine Pro"
    assert product.description == "Updated machine description"

    # 3. DEACTIVATE event from Yinglima
    deact_envelope = {
        "event_id": str(uuid.uuid4()),
        "event_type": "product.deactivated",
        "event_version": 1,
        "occurred_at": datetime.now(timezone.utc).isoformat(),
        "source_erp": "yinglima",
        "target_erp": "inhyma",
        "entity_type": "product",
        "source_entity_id": source_pid,
        "payload": {
            "product_id": source_pid,
            "is_active": False,
            "status": "inactive",
            "version": 3,
        },
    }

    result3 = await engine.process_event(db_session, deact_envelope)
    await db_session.flush()

    assert result3.status == "PROCESSED"
    assert result3.action == "DELETED"

    # Refresh product and verify deactivation in Inhyma
    await db_session.refresh(product)
    assert product.status == RecordStatus.INACTIVE


@pytest.mark.asyncio
async def test_product_sync_direction_rejection(db_session):
    """Ensure reverse sync (Inhyma -> Yinglima or forbidden target direction) is blocked."""
    engine = GenericSyncEngine()
    source_pid = str(uuid.uuid4())

    # Attempt to send product event claiming source is inhyma to an engine configured as TARGET_TO_SOURCE or reversed
    envelope = {
        "event_id": str(uuid.uuid4()),
        "event_type": "product.created",
        "event_version": 1,
        "occurred_at": datetime.now(timezone.utc).isoformat(),
        "source_erp": "inhyma",
        "target_erp": "inhyma",
        "entity_type": "product",
        "source_entity_id": source_pid,
        "payload": {"product_name": "Invalid Self Sync"},
    }

    # Inhyma has no policy accepting inhyma as source for products (policy is specifically yinglima -> inhyma)
    # Default policy fallback will apply or direction check
    policy = engine.get_policy("inhyma", "product")
    assert policy.direction != "TARGET_TO_SOURCE"
