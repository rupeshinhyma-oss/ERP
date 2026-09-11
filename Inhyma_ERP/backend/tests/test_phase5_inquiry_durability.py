"""
Phase 5 Test: Inquiry Message/Quotation Durability Fix (Inhyma).

Tests the actual bug Phase 5 fixed in this repo: four
`inquiry.message.created` call sites and three `quotation.*` call
sites bypassed durability entirely by calling
`dispatcher.publish()`/`event_dispatcher.publish()` directly, instead
of going through `_publish_inquiry_event`'s
`publish_lifecycle_event`-based path like every other inquiry event.
`_publish_inquiry_message_event`/`_publish_inquiry_post_commit_event`
close that gap.
"""

from __future__ import annotations

import uuid

import pytest
import pytest_asyncio
from sqlalchemy import select

from app.database.engine import dispose_engine, get_sessionmaker
from app.durable_events.models import DurableEvent
from app.durable_events.service import bootstrap_default_consumers
from app.events.dispatcher import EventDispatcher
from app.inquiries.routes import _publish_inquiry_message_event, _publish_inquiry_post_commit_event

pytestmark = pytest.mark.asyncio


@pytest_asyncio.fixture
async def db_session():
    """A real session against the test Postgres database, disposed before/after for event-loop isolation."""
    await dispose_engine()
    session_factory = get_sessionmaker()
    async with session_factory() as session:
        await bootstrap_default_consumers(session)
        yield session
        await session.rollback()
    await dispose_engine()


class TestInquiryMessageEventDurability:
    """The four inquiry.message.created call sites, now durable."""

    async def test_message_event_creates_a_durable_event(self, db_session, monkeypatch):
        monkeypatch.setattr("app.inquiries.routes.settings.DURABLE_EVENTS_ENABLED", True)
        dispatcher = EventDispatcher()
        inquiry_id = uuid.uuid4()

        await _publish_inquiry_message_event(db=db_session, dispatcher=dispatcher, inquiry_id=inquiry_id)

        async with get_sessionmaker()() as verify_session:
            result = await verify_session.execute(
                select(DurableEvent).where(DurableEvent.entity_id == str(inquiry_id))
            )
            event = result.scalar_one_or_none()
            assert event is not None
            assert event.event_type == "inquiry.message.created"
            assert event.entity == "inquiry"

    async def test_message_event_merges_extra_payload(self, db_session, monkeypatch):
        monkeypatch.setattr("app.inquiries.routes.settings.DURABLE_EVENTS_ENABLED", True)
        dispatcher = EventDispatcher()
        inquiry_id = uuid.uuid4()

        await _publish_inquiry_message_event(
            db=db_session, dispatcher=dispatcher, inquiry_id=inquiry_id, extra_payload={"item_id": "item-123"}
        )

        async with get_sessionmaker()() as verify_session:
            result = await verify_session.execute(
                select(DurableEvent).where(DurableEvent.entity_id == str(inquiry_id))
            )
            event = result.scalar_one()
            assert "item-123" in event.payload
            assert str(inquiry_id) in event.payload

    async def test_message_event_does_not_create_durable_event_when_flag_off(self, db_session, monkeypatch):
        monkeypatch.setattr("app.inquiries.routes.settings.DURABLE_EVENTS_ENABLED", False)
        dispatcher = EventDispatcher()
        inquiry_id = uuid.uuid4()

        await _publish_inquiry_message_event(db=db_session, dispatcher=dispatcher, inquiry_id=inquiry_id)

        async with get_sessionmaker()() as verify_session:
            result = await verify_session.execute(
                select(DurableEvent).where(DurableEvent.entity_id == str(inquiry_id))
            )
            assert result.scalar_one_or_none() is None


class TestQuotationPostCommitEventDurability:
    """The three quotation.* call sites in the WeChat inbound flow, now durable."""

    async def test_quotation_created_event_creates_a_durable_event(self, db_session, monkeypatch):
        monkeypatch.setattr("app.inquiries.routes.settings.DURABLE_EVENTS_ENABLED", True)
        dispatcher = EventDispatcher()
        item_id = uuid.uuid4()

        await _publish_inquiry_post_commit_event(
            db=db_session,
            dispatcher=dispatcher,
            event_type="quotation.created",
            entity_id=item_id,
            changes={"id": "quote-1", "quote_number": "Q-001"},
        )

        async with get_sessionmaker()() as verify_session:
            result = await verify_session.execute(select(DurableEvent).where(DurableEvent.entity_id == str(item_id)))
            event = result.scalar_one_or_none()
            assert event is not None
            assert event.event_type == "quotation.created"

    async def test_quotation_updated_event_creates_a_durable_event(self, db_session, monkeypatch):
        monkeypatch.setattr("app.inquiries.routes.settings.DURABLE_EVENTS_ENABLED", True)
        dispatcher = EventDispatcher()
        item_id = uuid.uuid4()

        await _publish_inquiry_post_commit_event(
            db=db_session,
            dispatcher=dispatcher,
            event_type="quotation.updated",
            entity_id=item_id,
            changes={"id": "quote-1", "unit_price": 12.5},
        )

        async with get_sessionmaker()() as verify_session:
            result = await verify_session.execute(select(DurableEvent).where(DurableEvent.entity_id == str(item_id)))
            event = result.scalar_one()
            assert event.event_type == "quotation.updated"
            assert "12.5" in event.payload

    async def test_post_commit_event_failure_never_raises(self, db_session, monkeypatch):
        """A durable-event write failure must never block the (already-committed) business write's caller."""
        monkeypatch.setattr("app.inquiries.routes.settings.DURABLE_EVENTS_ENABLED", True)

        async def _broken_publish(*args, **kwargs):
            raise RuntimeError("simulated failure")

        monkeypatch.setattr("app.durable_events.service.DurableEventService.publish_durable_event", _broken_publish)

        dispatcher = EventDispatcher()
        await _publish_inquiry_post_commit_event(
            db=db_session,
            dispatcher=dispatcher,
            event_type="quotation.created",
            entity_id=uuid.uuid4(),
            changes={},
        )
