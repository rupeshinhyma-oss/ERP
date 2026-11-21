"""
Wave 5 Remediation Regression Tests — BUG-008 (Inbound Quotation Webhook Security).

Verifies strictly with synthetic data in an isolated SQLite database (zero live emails/messages):
1. Missing signature is rejected (401).
2. Invalid signature is rejected (401).
3. Valid HMAC-SHA256 signature (both X-Webhook-Signature + X-Webhook-Timestamp and Meta X-Hub-Signature-256)
   is accepted and processes expected quotation ingestion cleanly.
4. Tampered payload is rejected (401).
5. Replay protection rejects stale timestamps (401) and replayed deliveries (409).
6. Unmatched sender messages never hijack an unrelated customer's latest InquiryItem.
7. Never logs secrets or raw signature digests.
"""

from __future__ import annotations

import hashlib
import hmac
import importlib
import json
import logging
from pathlib import Path
import time
import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI, Request
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine


def _import_all_models() -> None:
    root = Path(__file__).resolve().parents[1]
    for path in sorted((root / "app").rglob("models.py")):
        importlib.import_module(".".join(path.relative_to(root).with_suffix("").parts))


_import_all_models()

from app.buyers.models import Buyer  # noqa: E402
from app.core.config import settings  # noqa: E402
from app.core.exception_handlers import register_exception_handlers  # noqa: E402
from app.database.base import Base  # noqa: E402
from app.database.session import get_db_session  # noqa: E402
from app.events.dependencies import get_event_dispatcher  # noqa: E402
from app.inquiries.models import ConsignmentCode, Inquiry, InquiryItem, InquiryMessage, Quotation, RFQ  # noqa: E402
from app.inquiries.routes import _WEBHOOK_REPLAY_CACHE, router as inquiries_router  # noqa: E402
from app.masters.countries.models import Country  # noqa: E402
from app.masters.product_categories.models import ProductCategory  # noqa: E402
from app.masters.products.models import Product  # noqa: E402
from app.masters.uom.models import UnitOfMeasurement  # noqa: E402
from app.suppliers.models import Supplier, SupplierEmail  # noqa: E402
from app.users.models import User  # noqa: E402

pytestmark = pytest.mark.asyncio

_SYNTHETIC_WEBHOOK_SECRET = "synthetic-test-only-webhook-hmac-secret-do-not-use"


def _sign_body(secret: str, raw_body: bytes, timestamp: str | None = None) -> str:
    msg = (timestamp.encode("utf-8") + b"." + raw_body) if timestamp else raw_body
    return "sha256=" + hmac.new(secret.encode("utf-8"), msg, hashlib.sha256).hexdigest()


@pytest.fixture
async def webhook_env():
    _WEBHOOK_REPLAY_CACHE.clear()
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(bind=engine, class_=AsyncSession, expire_on_commit=False)

    async with factory() as db:
        creator_id = uuid.uuid4()
        user = User(
            id=creator_id,
            username="synth_webhook_proc",
            email="proc_webhook@example.test",
            password_hash="x",
        )
        country = Country(name="Synthetic Country", code="SY")
        cat = ProductCategory(name="Synthetic Cat", code="SYNCAT")
        uom = UnitOfMeasurement(name="Pieces", code="PCS", short_name="Pc")
        db.add_all([user, country, cat, uom])
        await db.flush()

        buyer = Buyer(company_name="Synthetic Buyer Ltd", country_id=country.id, is_active=True)
        supplier = Supplier(
            company_name="Synthetic Invited Supplier Co",
            country_id=country.id,
            state_id=uuid.uuid4(),
            city_id=uuid.uuid4(),
            contact_full_name="Synthetic Contact",
            contact_calling_number="86100000099",
            is_active=True,
        )
        product = Product(
            product_name="Synthetic Pump",
            product_name_tally="Synthetic Pump",
            product_code="SYN-PUMP-01",
            category_id=cat.id,
            uom_id=uom.id,
            packaging_gross_weight=5.0,
            packaging_unit_cbm=0.1,
            packaging_quantity=1,
        )
        db.add_all([buyer, supplier, product])
        await db.flush()

        cons_code = ConsignmentCode(code="SYN-CONS-500", buyer_id=buyer.id)
        db.add(cons_code)
        await db.flush()

        supp_email = SupplierEmail(supplier_id=supplier.id, email="quotes@synthetic-supplier.test")
        inquiry = Inquiry(consignment_code_id=cons_code.id, buyer_id=buyer.id, created_by=creator_id)
        db.add_all([supp_email, inquiry])
        await db.flush()

        item = InquiryItem(
            inquiry_id=inquiry.id,
            product_id=product.id,
            uom_id=uom.id,
            quantity=10.0,
            proposed_by=creator_id,
        )
        db.add(item)
        await db.flush()

        rfq = RFQ(
            inquiry_item_id=item.id,
            supplier_type="selected",
            supplier_ids=[str(supplier.id)],
            status="sent",
            created_by=creator_id,
        )
        db.add(rfq)
        await db.commit()

        app = FastAPI()

        @app.middleware("http")
        async def _req_id_mw(request: Request, call_next):
            request.state.request_id = "test-wave5-req"
            return await call_next(request)

        register_exception_handlers(app)
        app.include_router(inquiries_router, prefix="/api/v1")

        async def _override_db():
            yield db

        mock_dispatcher = SimpleNamespace(
            publish=AsyncMock(),
            publish_lifecycle_event=AsyncMock(),
        )
        app.dependency_overrides[get_db_session] = _override_db
        app.dependency_overrides[get_event_dispatcher] = lambda: mock_dispatcher

        yield {
            "app": app,
            "db": db,
            "item": item,
            "supplier": supplier,
        }

    _WEBHOOK_REPLAY_CACHE.clear()
    await engine.dispose()


async def test_webhook_rejects_missing_invalid_tampered_and_replayed_signatures(
    webhook_env, caplog
) -> None:
    app = webhook_env["app"]
    item = webhook_env["item"]

    body_dict = {
        "channel": "whatsapp",
        "sender": "quotes@synthetic-supplier.test",
        "text": "Unit price USD 120.00 FOB Shanghai, delivery 15 days",
        "item_id": str(item.id),
    }
    raw_bytes = json.dumps(body_dict).encode("utf-8")

    with (
        patch.object(settings, "INBOUND_WEBHOOK_SECRET", _SYNTHETIC_WEBHOOK_SECRET),
        patch.object(settings, "INBOUND_WEBHOOK_REQUIRE_SIGNATURE", True),
        patch.object(settings, "INBOUND_WEBHOOK_MAX_SKEW_SECONDS", 300),
    ):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            # 1. Missing signature rejected (401)
            r_missing = await client.post(
                "/api/v1/inquiries/inbound-webhook",
                content=raw_bytes,
                headers={"Content-Type": "application/json"},
            )
            assert r_missing.status_code == 401

            # 2. Invalid signature rejected (401) without leaking secret/signature in logs
            bad_sig = "sha256=" + ("a" * 64)
            with caplog.at_level(logging.WARNING):
                r_invalid = await client.post(
                    "/api/v1/inquiries/inbound-webhook",
                    content=raw_bytes,
                    headers={
                        "Content-Type": "application/json",
                        "X-Webhook-Timestamp": str(int(time.time())),
                        "X-Webhook-Signature": bad_sig,
                    },
                )
            assert r_invalid.status_code == 401
            for rec in caplog.records:
                assert _SYNTHETIC_WEBHOOK_SECRET not in rec.getMessage()
                assert ("a" * 64) not in rec.getMessage()

            # 3. Tampered payload rejected (401): signed original body, sent modified price
            now_str = str(int(time.time()))
            valid_sig = _sign_body(_SYNTHETIC_WEBHOOK_SECRET, raw_bytes, timestamp=now_str)
            tampered_bytes = json.dumps({**body_dict, "text": "Unit price USD 1.00"}).encode("utf-8")
            r_tampered = await client.post(
                "/api/v1/inquiries/inbound-webhook",
                content=tampered_bytes,
                headers={
                    "Content-Type": "application/json",
                    "X-Webhook-Timestamp": now_str,
                    "X-Webhook-Signature": valid_sig,
                },
            )
            assert r_tampered.status_code == 401

            # 4. Stale timestamp rejected (401)
            stale_ts = str(int(time.time()) - 900)
            stale_sig = _sign_body(_SYNTHETIC_WEBHOOK_SECRET, raw_bytes, timestamp=stale_ts)
            r_stale = await client.post(
                "/api/v1/inquiries/inbound-webhook",
                content=raw_bytes,
                headers={
                    "Content-Type": "application/json",
                    "X-Webhook-Timestamp": stale_ts,
                    "X-Webhook-Signature": stale_sig,
                },
            )
            assert r_stale.status_code == 401


async def test_webhook_valid_signature_processes_quote_and_blocks_replay_and_hijack(
    webhook_env,
) -> None:
    app = webhook_env["app"]
    db: AsyncSession = webhook_env["db"]
    item = webhook_env["item"]
    supplier = webhook_env["supplier"]

    fake_ai = SimpleNamespace(
        is_quotation_detected=True,
        unit_price=120.0,
        quantity=10.0,
        currency="USD",
        earliest_available_date="2026-12-15",
        price_terms="FOB",
        payment_terms="T/T",
        remarks="Synthetic test quote",
        provider_used="synthetic-mock",
    )

    body_dict = {
        "channel": "whatsapp",
        "sender": "quotes@synthetic-supplier.test",
        "text": "Unit price USD 120.00 FOB, 10 units",
        "item_id": str(item.id),
    }
    raw_bytes = json.dumps(body_dict).encode("utf-8")
    now_str = str(int(time.time()))
    valid_sig = _sign_body(_SYNTHETIC_WEBHOOK_SECRET, raw_bytes, timestamp=now_str)

    with (
        patch.object(settings, "INBOUND_WEBHOOK_SECRET", _SYNTHETIC_WEBHOOK_SECRET),
        patch.object(settings, "INBOUND_WEBHOOK_REQUIRE_SIGNATURE", True),
        patch("app.inquiries.routes.extract_supplier_quotation", new=AsyncMock(return_value=fake_ai)),
        patch("app.inquiries.routes._publish_inquiry_message_event", new=AsyncMock()),
        patch("app.inquiries.routes._publish_inquiry_post_commit_event", new=AsyncMock()),
    ):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            # 1. Valid signed delivery succeeds and creates Quotation for matched supplier
            r_ok = await client.post(
                "/api/v1/inquiries/inbound-webhook",
                content=raw_bytes,
                headers={
                    "Content-Type": "application/json",
                    "X-Webhook-Timestamp": now_str,
                    "X-Webhook-Signature": valid_sig,
                    "X-Webhook-Id": "syn-delivery-001",
                },
            )
            assert r_ok.status_code == 200
            assert r_ok.json()["data"]["created"] is True

            quotes = (await db.execute(select(Quotation))).scalars().all()
            assert len(quotes) == 1
            assert quotes[0].supplier_id == supplier.id
            assert quotes[0].inquiry_item_id == item.id

            # 2. Exact replay of same signed delivery is rejected (409)
            r_replay = await client.post(
                "/api/v1/inquiries/inbound-webhook",
                content=raw_bytes,
                headers={
                    "Content-Type": "application/json",
                    "X-Webhook-Timestamp": now_str,
                    "X-Webhook-Signature": valid_sig,
                    "X-Webhook-Id": "syn-delivery-001",
                },
            )
            assert r_replay.status_code == 409

            # 3. Unmatched stranger sender (Meta X-Hub-Signature-256 format) does NOT hijack latest InquiryItem
            stranger_bytes = json.dumps(
                {
                    "channel": "whatsapp",
                    "sender": "stranger@uninvited.test",
                    "text": "Unit price USD 5.00",
                }
            ).encode("utf-8")
            hub_sig = _sign_body(_SYNTHETIC_WEBHOOK_SECRET, stranger_bytes, timestamp=None)
            r_stranger = await client.post(
                "/api/v1/inquiries/inbound-webhook",
                content=stranger_bytes,
                headers={
                    "Content-Type": "application/json",
                    "X-Hub-Signature-256": hub_sig,
                    "X-Webhook-Id": "syn-delivery-002",
                },
            )
            assert r_stranger.status_code == 200
            assert r_stranger.json()["data"]["created"] is False

            # Confirm stranger message was NOT attached to item's timeline
            msgs = (await db.execute(select(InquiryMessage))).scalars().all()
            assert len(msgs) == 1
            assert msgs[0].sender_contact == "quotes@synthetic-supplier.test"
