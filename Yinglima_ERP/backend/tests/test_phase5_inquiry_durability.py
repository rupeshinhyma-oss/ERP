"""
Phase 5 Test: Inquiry Message Event Durability Fix (Yinglima).

Tests the actual bug Phase 5 fixed: two `inquiry.message.created` call
sites bypassed durability entirely by calling `dispatcher.publish()`
directly instead of going through `publish_lifecycle_event`.
`_publish_inquiry_message_event` closes that gap.
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
from app.inquiries.routes import _publish_inquiry_message_event

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
    """The two inquiry.message.created call sites, now durable."""

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

    async def test_message_event_failure_never_raises(self, db_session, monkeypatch):
        """A durable-event write failure must never block the (already-committed) business write's caller."""
        monkeypatch.setattr("app.inquiries.routes.settings.DURABLE_EVENTS_ENABLED", True)

        async def _broken_publish(*args, **kwargs):
            raise RuntimeError("simulated failure")

        monkeypatch.setattr("app.durable_events.service.DurableEventService.publish_durable_event", _broken_publish)

        dispatcher = EventDispatcher()
        await _publish_inquiry_message_event(db=db_session, dispatcher=dispatcher, inquiry_id=uuid.uuid4())
