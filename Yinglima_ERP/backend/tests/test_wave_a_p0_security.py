"""
Wave A P0 Security & Financial Accuracy Tests for Yinglima_ERP
(BUG-001, BUG-002, BUG-004, BUG-006).

Runs strictly on isolated in-memory SQLite — never touches live Supabase.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import logging
import time
import uuid
from unittest.mock import patch

import pytest
from fastapi import FastAPI, Request
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.auth.repository import PasswordHistoryRepository, SessionRepository, TokenBlacklistRepository
from app.auth.security import hash_password, is_argon2_hash, needs_rehash, verify_password
from app.auth.service import AuthService, LoginContext
from app.cache.in_memory import InMemoryCacheBackend
from app.common.email import _is_smtp_configured, _send_smtp_sync
from app.common.rate_limit import webhook_limiter
from app.core.config import EnvironmentEnum, Settings, settings
from app.core.exception_handlers import register_exception_handlers
from app.database.base import Base
from app.database.session import get_db_session
from app.finance.schemas import SaleOrderFinanceRow
from app.finance.service import compute_sale_order_kpi
from app.inquiries import routes as inquiry_routes
from app.inquiries.models import Inquiry, InquiryItem, InquiryMessage, Quotation
from app.rbac.repository import RoleRepository
from app.users.models import User, UserStatus
from app.users.repository import UserRepository

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


# ---------------------------------------------------------------------------
# BUG-001: Argon2id Hashing & Conditional Legacy Rehash
# ---------------------------------------------------------------------------


async def test_bug001_argon2id_hashing_and_legacy_rehash(isolated_db: AsyncSession):
    pw = "YinglimaStrong!2026"
    hashed = hash_password(pw)
    assert hashed != pw
    assert is_argon2_hash(hashed) is True
    assert verify_password(pw, hashed) is True
    assert verify_password("Wrong!Password1", hashed) is False
    assert needs_rehash(hashed) is False
    assert needs_rehash(pw) is True

    user = User(
        id=uuid.uuid4(),
        email="legacy-ylm@example.com",
        username="legacy_ylm",
        first_name="Legacy",
        last_name="Ylm",
        password_hash="LegacyYlm#2026!",
        status=UserStatus.ACTIVE,
        has_login=True,
    )
    isolated_db.add(user)
    await isolated_db.commit()

    svc = AuthService(
        user_repository=UserRepository(isolated_db),
        session_repository=SessionRepository(isolated_db),
        token_blacklist_repository=TokenBlacklistRepository(isolated_db),
        password_history_repository=PasswordHistoryRepository(isolated_db),
        role_repository=RoleRepository(isolated_db),
        cache=InMemoryCacheBackend(),
    )

    # Wrong password must never trigger rehash
    with pytest.raises(Exception):
        await svc.login(identifier="legacy-ylm@example.com", password="WrongPass!99", context=LoginContext())
    await isolated_db.commit()
    assert (await isolated_db.get(User, user.id)).password_hash == "LegacyYlm#2026!"

    # Valid login upgrades legacy plaintext to Argon2id
    logged_user, access_tok, refresh_tok = await svc.login(
        identifier="legacy-ylm@example.com", password="LegacyYlm#2026!", context=LoginContext()
    )
    await isolated_db.commit()
    assert logged_user.id == user.id and access_tok and refresh_tok
    upgraded = await isolated_db.get(User, user.id)
    assert upgraded.password_hash != "LegacyYlm#2026!"
    assert is_argon2_hash(upgraded.password_hash) is True
    assert verify_password("LegacyYlm#2026!", upgraded.password_hash) is True

    # Conditional update safety: stale old_hash cannot overwrite a concurrent update
    concurrent_hash = hash_password("Concurrent!Pass#2026")
    await isolated_db.execute(update(User).where(User.id == user.id).values(password_hash=concurrent_hash))
    await isolated_db.commit()
    stale = await isolated_db.execute(
        update(User)
        .where(User.id == user.id, User.password_hash == "LegacyYlm#2026!")
        .values(password_hash=hash_password("Overwrite!Attempt"))
    )
    await isolated_db.commit()
    assert stale.rowcount == 0
    assert (await isolated_db.get(User, user.id)).password_hash == concurrent_hash


# ---------------------------------------------------------------------------
# BUG-002: No Hardcoded SMTP Credentials + Safe Failure + Secret Redaction
# ---------------------------------------------------------------------------


async def test_bug002_no_hardcoded_smtp_and_secret_redaction(monkeypatch, caplog):
    # Verify Settings field defaults themselves have zero hardcoded SMTP secrets
    assert Settings.model_fields["SMTP_USER"].default == ""
    assert Settings.model_fields["SMTP_PASSWORD"].default == ""
    assert Settings.model_fields["SMTP_FROM_EMAIL"].default == ""
    monkeypatch.delenv("SMTP_USER", raising=False)
    monkeypatch.delenv("SMTP_PASSWORD", raising=False)
    monkeypatch.delenv("SMTP_FROM_EMAIL", raising=False)
    fresh = Settings(_env_file=None)
    assert fresh.SMTP_USER == ""
    assert fresh.SMTP_PASSWORD == ""
    assert fresh.SMTP_FROM_EMAIL == ""

    monkeypatch.setattr(settings, "SMTP_USER", "")
    monkeypatch.setattr(settings, "SMTP_PASSWORD", "")
    monkeypatch.setattr(settings, "SMTP_FROM_EMAIL", "")
    monkeypatch.setattr(settings, "ENVIRONMENT", EnvironmentEnum.PRODUCTION)
    assert _is_smtp_configured() is False
    assert _send_smtp_sync(["buyer@example.com"], "Subject", "<p>Body</p>") is False

    synthetic_secret = "SYNTHETIC_YLM_SMTP_SECRET_54321"
    monkeypatch.setattr(settings, "SMTP_USER", "proc@example.com")
    monkeypatch.setattr(settings, "SMTP_PASSWORD", synthetic_secret)
    monkeypatch.setattr(settings, "SMTP_FROM_EMAIL", "proc@example.com")
    with caplog.at_level(logging.ERROR, logger="app.common.email"):
        with patch("app.common.email.smtplib.SMTP", side_effect=RuntimeError(f"SMTP rejected {synthetic_secret}")):
            ok = _send_smtp_sync(["buyer@example.com"], "Subject", "<p>Body</p>")
    assert ok is False
    assert synthetic_secret not in caplog.text


# ---------------------------------------------------------------------------
# BUG-004: Signed Inbound Webhook (HMAC, Timestamp, Replay, Schema, Rate Limit, No Blind Attach)
# ---------------------------------------------------------------------------


def _sign_webhook(secret: str, ts: str, raw_body: bytes) -> str:
    digest = hmac.new(secret.encode("utf-8"), ts.encode("utf-8") + b"." + raw_body, hashlib.sha256).hexdigest()
    return f"sha256={digest}"


async def test_bug004_inbound_webhook_security_and_no_blind_attachment(isolated_db: AsyncSession, monkeypatch):
    test_app = FastAPI()
    register_exception_handlers(test_app)

    @test_app.middleware("http")
    async def _attach_request_id(request: Request, call_next):
        request.state.request_id = str(uuid.uuid4())
        return await call_next(request)

    test_app.include_router(inquiry_routes.router, prefix="/api/v1")

    async def _override_db():
        yield isolated_db

    test_app.dependency_overrides[get_db_session] = _override_db

    # Seed an Inquiry + InquiryItem to prove unmatched webhook NEVER blindly attaches to latest InquiryItem
    uid = uuid.uuid4()
    bid = uuid.uuid4()
    cid = uuid.uuid4()
    pid = uuid.uuid4()
    uom_id = uuid.uuid4()
    inq = Inquiry(id=uuid.uuid4(), buyer_id=bid, consignment_code_id=cid, created_by=uid)
    item = InquiryItem(
        id=uuid.uuid4(),
        inquiry_id=inq.id,
        product_id=pid,
        uom_id=uom_id,
        quantity=10,
        proposed_by=uid,
    )
    isolated_db.add_all([inq, item])
    await isolated_db.commit()

    inquiry_routes._WEBHOOK_REPLAY_CACHE.clear()
    webhook_limiter._attempts.clear()

    secret = "test-yinglima-webhook-hmac-secret-2026"
    monkeypatch.setattr(settings, "INBOUND_WEBHOOK_SECRET", secret)
    monkeypatch.setattr(settings, "INBOUND_WEBHOOK_REQUIRE_SIGNATURE", True)
    monkeypatch.setattr(settings, "INBOUND_WEBHOOK_MAX_SKEW_SECONDS", 300)

    body_dict = {
        "channel": "whatsapp",
        "sender": "unmatched-sender@example.com",
        "text": "Price is USD 12.50 per piece for 100 pcs",
    }
    raw_body = json.dumps(body_dict).encode("utf-8")
    now_ts = str(int(time.time()))

    async with AsyncClient(transport=ASGITransport(app=test_app), base_url="http://testserver") as client:
        # 1. Missing signature -> 401
        r_unsigned = await client.post(
            "/api/v1/inquiries/inbound-webhook",
            content=raw_body,
            headers={"Content-Type": "application/json"},
        )
        assert r_unsigned.status_code == 401

        # 2. Invalid signature -> 401
        r_bad_sig = await client.post(
            "/api/v1/inquiries/inbound-webhook",
            content=raw_body,
            headers={
                "Content-Type": "application/json",
                "X-Webhook-Timestamp": now_ts,
                "X-Webhook-Signature": "sha256=" + ("0" * 64),
            },
        )
        assert r_bad_sig.status_code == 401

        # 3. Expired timestamp -> 401
        expired_ts = str(int(time.time()) - 600)
        r_expired = await client.post(
            "/api/v1/inquiries/inbound-webhook",
            content=raw_body,
            headers={
                "Content-Type": "application/json",
                "X-Webhook-Timestamp": expired_ts,
                "X-Webhook-Signature": _sign_webhook(secret, expired_ts, raw_body),
            },
        )
        assert r_expired.status_code == 401

        # 4. Malformed payload (bad channel / bad UUID item_id) -> 422
        bad_payload = json.dumps({"channel": "sms_untrusted", "sender": "a@b.com", "text": "hi"}).encode()
        r_malformed = await client.post(
            "/api/v1/inquiries/inbound-webhook",
            content=bad_payload,
            headers={
                "Content-Type": "application/json",
                "X-Webhook-Timestamp": now_ts,
                "X-Webhook-Signature": _sign_webhook(secret, now_ts, bad_payload),
            },
        )
        assert r_malformed.status_code == 422

        # 5. Valid signed request with unmatched sender MUST NOT blindly attach to latest InquiryItem
        valid_headers = {
            "Content-Type": "application/json",
            "X-Webhook-Timestamp": now_ts,
            "X-Webhook-Id": "delivery-001",
            "X-Webhook-Signature": _sign_webhook(secret, now_ts, raw_body),
        }
        r_valid = await client.post("/api/v1/inquiries/inbound-webhook", content=raw_body, headers=valid_headers)
        assert r_valid.status_code == 200
        assert r_valid.json()["data"]["created"] is False

        # Verify zero InquiryMessage and zero Quotation created for unmatched sender
        msgs = (await isolated_db.execute(select(InquiryMessage))).scalars().all()
        quotes = (await isolated_db.execute(select(Quotation))).scalars().all()
        assert len(msgs) == 0
        assert len(quotes) == 0

        # 6. Exact replay of delivery-001 MUST be rejected with 409 Conflict
        r_replay = await client.post("/api/v1/inquiries/inbound-webhook", content=raw_body, headers=valid_headers)
        assert r_replay.status_code == 409

        # 7. Rate limit enforcement -> 429
        orig_max = webhook_limiter.max_attempts
        try:
            webhook_limiter._attempts.clear()
            webhook_limiter.max_attempts = 2
            for idx in range(2):
                h = {
                    "Content-Type": "application/json",
                    "X-Webhook-Timestamp": now_ts,
                    "X-Webhook-Id": f"rl-delivery-{idx}",
                    "X-Webhook-Signature": _sign_webhook(secret, now_ts, raw_body),
                }
                assert (await client.post("/api/v1/inquiries/inbound-webhook", content=raw_body, headers=h)).status_code == 200
            h3 = {
                "Content-Type": "application/json",
                "X-Webhook-Timestamp": now_ts,
                "X-Webhook-Id": "rl-delivery-3",
                "X-Webhook-Signature": _sign_webhook(secret, now_ts, raw_body),
            }
            assert (await client.post("/api/v1/inquiries/inbound-webhook", content=raw_body, headers=h3)).status_code == 429
        finally:
            webhook_limiter.max_attempts = orig_max
            webhook_limiter._attempts.clear()


# ---------------------------------------------------------------------------
# BUG-006: Financial Report Currency Accuracy
# ---------------------------------------------------------------------------


def _make_so_row(
    *,
    currency: str,
    total: float,
    paid: float = 0.0,
    rate: float | None = None,
    stage: str = "pending",
) -> SaleOrderFinanceRow:
    return SaleOrderFinanceRow(
        source_id=uuid.uuid4(),
        order_no=f"SO-{uuid.uuid4().hex[:6]}",
        buyer_name="Test Buyer",
        source_status="confirmed",
        currency=currency,
        total_amount=total,
        paid_amount=paid,
        balance_amount=round(total - paid, 2),
        usd_exchange_rate=rate,
        stage=stage,
    )


async def test_bug006_rmb_only_orders_never_labeled_usd_or_multiplied():
    # Exact reproduction of the live audit bug: ¥100,000 RMB order at 6.66
    rows = [_make_so_row(currency="RMB", total=100000.0, paid=0.0, rate=6.66)]
    kpi = compute_sale_order_kpi(rows, report_usd_to_rmb=6.66)

    assert kpi.currency == "RMB"
    assert kpi.total_amount == 100000.0
    assert kpi.balance_amount == 100000.0
    assert kpi.secondary_currency == "USD"
    # RMB -> USD MUST DIVIDE by 6.66 (100000 / 6.66 = 15015.02), NEVER multiply (666000.00)!
    assert kpi.total_amount_secondary == 15015.02
    assert kpi.balance_amount_secondary == 15015.02
    assert kpi.conversion_unavailable is False
    assert kpi.is_mixed_currency is False


async def test_bug006_usd_only_orders_convert_correctly_to_rmb():
    rows = [
        _make_so_row(currency="USD", total=10000.0, paid=4000.0, rate=7.20),
        _make_so_row(currency="USD", total=2500.50, paid=2500.50, rate=7.20, stage="cleared"),
    ]
    kpi = compute_sale_order_kpi(rows, report_usd_to_rmb=7.20)

    assert kpi.currency == "USD"
    assert kpi.total_amount == 12500.50
    assert kpi.paid_amount == 6500.50
    assert kpi.balance_amount == 6000.00
    assert kpi.secondary_currency == "RMB"
    assert kpi.total_amount_secondary == 90003.60
    assert kpi.paid_amount_secondary == 46803.60
    assert kpi.balance_amount_secondary == 43200.00
    assert kpi.conversion_unavailable is False


async def test_bug006_mixed_currency_orders_normalized_with_valid_rate_and_breakdown():
    rows = [
        _make_so_row(currency="USD", total=1000.00, paid=500.00, rate=7.20),
        _make_so_row(currency="RMB", total=7200.00, paid=3600.00, rate=7.20),
    ]
    kpi = compute_sale_order_kpi(rows, report_usd_to_rmb=7.20)

    assert kpi.is_mixed_currency is True
    assert kpi.conversion_unavailable is False
    assert kpi.currency == "USD"
    assert kpi.total_amount == 2000.00  # $1,000 + (¥7,200 / 7.20) = $2,000
    assert kpi.paid_amount == 1000.00
    assert kpi.balance_amount == 1000.00
    assert kpi.secondary_currency == "RMB"
    assert kpi.total_amount_secondary == 14400.00  # ($1,000 * 7.20) + ¥7,200 = ¥14,400
    assert kpi.currency_breakdown["USD"].total_amount == 1000.00
    assert kpi.currency_breakdown["RMB"].total_amount == 7200.00


async def test_bug006_missing_or_invalid_rates_preserve_native_and_never_mix_raw():
    # Single native currency with missing rate -> keep native, secondary None + unavailable
    rmb_only = [_make_so_row(currency="CNY", total=50000.0, rate=None)]
    kpi_rmb = compute_sale_order_kpi(rmb_only, report_usd_to_rmb=None)
    assert kpi_rmb.currency == "RMB"
    assert kpi_rmb.total_amount == 50000.0
    assert kpi_rmb.total_amount_secondary is None
    assert kpi_rmb.conversion_unavailable is True

    # Mixed currency with invalid/zero/negative/NaN rate -> NEVER add raw USD + RMB!
    mixed = [
        _make_so_row(currency="USD", total=1000.0, rate=0.0),
        _make_so_row(currency="RMB", total=7200.0, rate=-5.0),
    ]
    for bad_rate in (None, 0.0, -7.2, float("nan"), float("inf")):
        kpi_mixed = compute_sale_order_kpi(mixed, report_usd_to_rmb=bad_rate)
        assert kpi_mixed.currency == "MIXED"
        assert kpi_mixed.total_amount is None
        assert kpi_mixed.total_amount_secondary is None
        assert kpi_mixed.conversion_unavailable is True
        assert kpi_mixed.currency_breakdown["USD"].total_amount == 1000.0
        assert kpi_mixed.currency_breakdown["RMB"].total_amount == 7200.0


async def test_bug006_decimal_precision_and_rounding():
    # Decimal precision: 0.10 + 0.20 = 0.30 exactly; 100.00 RMB / 3.00 = 33.33 USD
    rows = [
        _make_so_row(currency="RMB", total=0.10, paid=0.05, rate=3.0),
        _make_so_row(currency="RMB", total=0.20, paid=0.10, rate=3.0),
        _make_so_row(currency="RMB", total=99.70, paid=0.0, rate=3.0),
    ]
    kpi = compute_sale_order_kpi(rows, report_usd_to_rmb=3.0)
    assert kpi.total_amount == 100.00
    assert kpi.paid_amount == 0.15
    assert kpi.balance_amount == 99.85
    assert kpi.total_amount_secondary == 33.33
    assert kpi.paid_amount_secondary == 0.05
    assert kpi.balance_amount_secondary == 33.28
