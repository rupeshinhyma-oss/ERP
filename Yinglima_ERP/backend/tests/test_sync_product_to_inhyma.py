"""
Unit test for Yinglima -> Inhyma Product Sync trigger and payload builder.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch

import pytest
import pytest_asyncio
from sqlalchemy import select

from app.core.constants import RecordStatus
from app.database.engine import dispose_engine, get_sessionmaker
from app.integration.models import IntegrationOutboxDelivery, IntegrationOutboxEvent
from app.masters.product_categories.models import ProductCategory
from app.masters.products.models import Product
from app.masters.products.sync_inhyma import (
    INHYMA_KNOWN_UUID,
    build_product_sync_payload,
    is_inhyma_organization,
    sync_product_to_inhyma,
)
from app.masters.uom.models import UnitOfMeasurement

pytestmark = pytest.mark.asyncio


@pytest_asyncio.fixture
async def db_session():
    await dispose_engine()
    session_factory = get_sessionmaker()
    async with session_factory() as session:
        yield session
        await session.rollback()
    await dispose_engine()


async def test_is_inhyma_organization_detection(db_session):
    # Direct UUID check
    assert await is_inhyma_organization(db_session, organization_id=INHYMA_KNOWN_UUID) is True
    assert await is_inhyma_organization(db_session, organization_ids=[str(INHYMA_KNOWN_UUID)]) is True

    # Unknown ID check
    random_id = uuid.uuid4()
    assert await is_inhyma_organization(db_session, organization_id=random_id) is False


async def test_sync_product_to_inhyma_outbox_and_delivery(db_session):
    cat = (await db_session.execute(select(ProductCategory).limit(1))).scalar_one_or_none()
    uom = (await db_session.execute(select(UnitOfMeasurement).limit(1))).scalar_one_or_none()
    if not cat:
        cat = ProductCategory(name="Machinery", code="CAT-MACH", status=RecordStatus.ACTIVE)
        db_session.add(cat)
        await db_session.flush()
    if not uom:
        uom = UnitOfMeasurement(name="Pieces", code="PCS", status=RecordStatus.ACTIVE)
        db_session.add(uom)
        await db_session.flush()

    test_id = uuid.uuid4()
    product = Product(
        id=test_id,
        category_id=cat.id,
        uom_id=uom.id,
        product_code=f"YL-{test_id.hex[:6].upper()}",
        product_name="Yinglima Machine 500",
        product_name_tally="Yinglima Machine 500",
        organization_id=INHYMA_KNOWN_UUID,
        organization_ids=[str(INHYMA_KNOWN_UUID)],
        status=RecordStatus.ACTIVE,
        packaging_gross_weight=8.5,
        packaging_unit_cbm=0.03,
    )
    db_session.add(product)
    await db_session.flush()

    # Mock dispatch_delivery to simulate peer connection
    with patch("app.integration.service.IntegrationService.dispatch_delivery", new_callable=AsyncMock) as mock_dispatch:
        mock_dispatch.return_value = True

        synced = await sync_product_to_inhyma(db_session, product, event_type="product.created")
        assert synced is True

        # Check outbox event created
        outbox = (
            await db_session.execute(
                select(IntegrationOutboxEvent).where(
                    IntegrationOutboxEvent.aggregate_id == test_id,
                    IntegrationOutboxEvent.aggregate_type == "product",
                )
            )
        ).scalar_one_or_none()

        assert outbox is not None
        assert outbox.target == "inhyma"
        assert outbox.event_type == "product.created"

        # Check outbox delivery
        delivery = (
            await db_session.execute(
                select(IntegrationOutboxDelivery).where(
                    IntegrationOutboxDelivery.outbox_event_id == outbox.id
                )
            )
        ).scalar_one_or_none()

        assert delivery is not None
        assert delivery.target_erp == "inhyma"
