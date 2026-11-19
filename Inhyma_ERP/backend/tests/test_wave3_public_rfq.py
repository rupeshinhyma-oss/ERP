"""Wave 3 regression tests for BUG-004 (Public RFQ signed token validation & supplier isolation).

Verifies using synthetic data only:
- Valid signed and unexpired token loads RFQ details and submits a quotation cleanly.
- Unsigned `<rfq_uuid>_<supplier_uuid>` slug is rejected with HTTP 400 (no DB lookup).
- Random synthetic identifier is rejected with HTTP 400.
- Invalid signature (wrong secret / tampered payload) is rejected with HTTP 400.
- Expired token is rejected with HTTP 410 Gone.
- Unauthorized supplier cannot view or submit against an RFQ restricted to another supplier (HTTP 403),
  and on shared RFQs cannot view another supplier's submitted quotation.
"""

from __future__ import annotations

import importlib
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import AsyncMock

import jwt
import pytest
import pytest_asyncio
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool


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
from app.inquiries.models import ConsignmentCode, Inquiry, InquiryItem, Quotation, RFQ  # noqa: E402
from app.inquiries.public_quotes import (  # noqa: E402
    RFQ_TOKEN_AUDIENCE,
    RFQ_TOKEN_ISSUER,
    RFQ_TOKEN_PURPOSE,
    generate_rfq_token,
    router as public_quotes_router,
)
from app.masters.products.models import Product  # noqa: E402
from app.masters.taxes.models import Tax  # noqa: E402
from app.masters.uom.models import UnitOfMeasurement  # noqa: E402
from app.suppliers.models import Supplier  # noqa: E402
from app.users.models import User  # noqa: E402

TABLES = [
    User.__table__,
    Buyer.__table__,
    Supplier.__table__,
    UnitOfMeasurement.__table__,
    Tax.__table__,
    Product.__table__,
    ConsignmentCode.__table__,
    Inquiry.__table__,
    InquiryItem.__table__,
    RFQ.__table__,
    Quotation.__table__,
]


@pytest_asyncio.fixture
async def rfq_env():
    engine = create_async_engine(
        "sqlite+aiosqlite://",
        poolclass=StaticPool,
        connect_args={"check_same_thread": False},
    )
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    maker = async_sessionmaker(engine, expire_on_commit=False)

    creator_id = uuid.uuid4()
    country_id = uuid.uuid4()
    state_id = uuid.uuid4()
    city_id = uuid.uuid4()
    buyer_id = uuid.uuid4()
    supplier_a_id = uuid.uuid4()
    supplier_b_id = uuid.uuid4()
    supplier_c_uninvited_id = uuid.uuid4()
    rfq_id = uuid.uuid4()
    item_id = uuid.uuid4()

    async with maker() as s:
        user = User(
            id=creator_id,
            username="synth_proc",
            email="proc@example.test",
            password_hash="x",
        )
        buyer = Buyer(
            id=buyer_id,
            company_name="Synthetic Buyer Ltd",
            country_id=country_id,
            is_active=True,
        )
        sup_a = Supplier(
            id=supplier_a_id,
            company_name="Synthetic Supplier Alpha",
            country_id=country_id,
            state_id=state_id,
            city_id=city_id,
            contact_full_name="Alpha Contact",
            contact_calling_number="86100000001",
            is_active=True,
        )
        sup_b = Supplier(
            id=supplier_b_id,
            company_name="Synthetic Supplier Beta",
            country_id=country_id,
            state_id=state_id,
            city_id=city_id,
            contact_full_name="Beta Contact",
            contact_calling_number="86100000002",
            is_active=True,
        )
        sup_c = Supplier(
            id=supplier_c_uninvited_id,
            company_name="Synthetic Supplier Uninvited",
            country_id=country_id,
            state_id=state_id,
            city_id=city_id,
            contact_full_name="Uninvited Contact",
            contact_calling_number="86100000003",
            is_active=True,
        )
        uom = UnitOfMeasurement(code="SETS", name="Sets", short_name="Set")
        tax = Tax(hsn_number="84224000", gst_percent=18, import_duty_percent=10)
        s.add_all([user, buyer, sup_a, sup_b, sup_c, uom, tax])
        await s.flush()

        prod = Product(
            product_name="SyntheticShrinkTunnel",
            product_name_tally="SyntheticShrinkTunnel",
            product_code="SYN-ST-01",
            category_id=uuid.uuid4(),
            uom_id=uom.id,
            hsn_id=tax.id,
            packaging_unit_cbm=1.2,
            packaging_quantity=1,
        )
        cc = ConsignmentCode(code="SYN-C1", buyer_id=buyer_id)
        s.add_all([prod, cc])
        await s.flush()

        inq = Inquiry(buyer_id=buyer_id, consignment_code_id=cc.id, created_by=creator_id)
        s.add(inq)
        await s.flush()

        item = InquiryItem(
            id=item_id,
            inquiry_id=inq.id,
            product_id=prod.id,
            uom_id=uom.id,
            quantity=4.0,
            product_specs_remarks="Synthetic 380V specification",
            proposed_by=creator_id,
        )
        s.add(item)
        await s.flush()

        rfq = RFQ(
            id=rfq_id,
            inquiry_item_id=item_id,
            supplier_type="selected",
            supplier_ids=[str(supplier_a_id), str(supplier_b_id)],
            notes="Synthetic RFQ note",
            status="sent",
            created_by=creator_id,
        )
        s.add(rfq)
        await s.commit()

    app = FastAPI()

    @app.middleware("http")
    async def _attach_req_id(request, call_next):
        request.state.request_id = "test-req-wave3"
        return await call_next(request)

    register_exception_handlers(app)
    app.include_router(public_quotes_router, prefix="/api/v1")

    async def _db():
        async with maker() as session:
            yield session

    mock_dispatcher = AsyncMock()
    app.dependency_overrides[get_db_session] = _db
    app.dependency_overrides[get_event_dispatcher] = lambda: mock_dispatcher

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        yield {
            "client": client,
            "rfq_id": rfq_id,
            "item_id": item_id,
            "supplier_a_id": supplier_a_id,
            "supplier_b_id": supplier_b_id,
            "supplier_c_uninvited_id": supplier_c_uninvited_id,
        }

    await engine.dispose()


@pytest.mark.asyncio
async def test_bug004_rejects_unsigned_uuid_pair_random_invalid_signature_and_expired_tokens(rfq_env):
    client: AsyncClient = rfq_env["client"]
    rfq_id = rfq_env["rfq_id"]
    item_id = rfq_env["item_id"]
    sup_a_id = rfq_env["supplier_a_id"]

    # 1. Unsigned compact <rfq_uuid>_<supplier_uuid> pair MUST be rejected with 400 (even when both UUIDs exist!)
    unsigned_real_pair = f"{rfq_id}_{sup_a_id}"
    res_unsigned = await client.get(f"/api/v1/public/rfq/{unsigned_real_pair}")
    assert res_unsigned.status_code == 400
    assert res_unsigned.headers["content-type"].startswith("application/json")

    unsigned_zero_pair = f"{uuid.UUID(int=0)}_{uuid.UUID(int=0)}"
    assert (await client.get(f"/api/v1/public/rfq/{unsigned_zero_pair}")).status_code == 400

    # 2. Random synthetic identifier -> 400
    assert (await client.get("/api/v1/public/rfq/synthetic_random_identifier_probe")).status_code == 400

    # 3. Invalid signature (forged secret) -> 400
    now = datetime.now(timezone.utc)
    forged_token = jwt.encode(
        {
            "sub": RFQ_TOKEN_PURPOSE,
            "aud": RFQ_TOKEN_AUDIENCE,
            "iss": RFQ_TOKEN_ISSUER,
            "rfq_id": str(rfq_id),
            "item_id": str(item_id),
            "supplier_id": str(sup_a_id),
            "iat": int(now.timestamp()),
            "exp": int((now + timedelta(days=7)).timestamp()),
        },
        "wrong-forged-secret-key-for-test-only-0123456789",
        algorithm="HS256",
    )
    assert (await client.get(f"/api/v1/public/rfq/{forged_token}")).status_code == 400
    assert (
        await client.post(f"/api/v1/public/rfq/{forged_token}/submit", json={"unit_price": 1200.0, "currency": "CNY"})
    ).status_code == 400

    # 4. Expired token -> 410 Gone
    expired_token = jwt.encode(
        {
            "sub": RFQ_TOKEN_PURPOSE,
            "aud": RFQ_TOKEN_AUDIENCE,
            "iss": RFQ_TOKEN_ISSUER,
            "rfq_id": str(rfq_id),
            "item_id": str(item_id),
            "supplier_id": str(sup_a_id),
            "iat": int((now - timedelta(days=10)).timestamp()),
            "exp": int((now - timedelta(days=1)).timestamp()),
        },
        settings.JWT_SECRET_KEY,
        algorithm="HS256",
    )
    exp_res = await client.get(f"/api/v1/public/rfq/{expired_token}")
    assert exp_res.status_code == 410


@pytest.mark.asyncio
async def test_wave3_valid_signed_token_workflow_and_cross_supplier_isolation(rfq_env):
    client: AsyncClient = rfq_env["client"]
    rfq_id = rfq_env["rfq_id"]
    item_id = rfq_env["item_id"]
    sup_a_id = rfq_env["supplier_a_id"]
    sup_b_id = rfq_env["supplier_b_id"]
    sup_c_uninvited_id = rfq_env["supplier_c_uninvited_id"]

    token_a = generate_rfq_token(rfq_id, item_id, sup_a_id)
    token_b = generate_rfq_token(rfq_id, item_id, sup_b_id)
    token_c_uninvited = generate_rfq_token(rfq_id, item_id, sup_c_uninvited_id)

    # Uninvited Supplier C is rejected with 403 Forbidden
    assert (await client.get(f"/api/v1/public/rfq/{token_c_uninvited}")).status_code == 403
    assert (
        await client.post(
            f"/api/v1/public/rfq/{token_c_uninvited}/submit",
            json={"unit_price": 900.0, "currency": "CNY"},
        )
    ).status_code == 403

    # Supplier A loads valid RFQ JSON and submits quotation
    details_a = await client.get(f"/api/v1/public/rfq/{token_a}")
    assert details_a.status_code == 200
    assert details_a.headers["content-type"].startswith("application/json")
    body_a = details_a.json()["data"]
    assert body_a["supplier_name"] == "Synthetic Supplier Alpha"
    assert body_a["product_code"] == "SYN-ST-01"
    assert body_a["already_submitted"] is False

    submit_a = await client.post(
        f"/api/v1/public/rfq/{token_a}/submit",
        json={
            "unit_price": 1500.0,
            "quantity": 4.0,
            "currency": "CNY",
            "terms_and_conditions": "30% advance",
            "remarks": "Synthetic quote A",
        },
    )
    assert submit_a.status_code == 201, submit_a.text
    assert submit_a.json()["data"]["total_cost"] == 6000.0

    # Supplier A sees own submitted quotation
    reload_a = (await client.get(f"/api/v1/public/rfq/{token_a}")).json()["data"]
    assert reload_a["already_submitted"] is True
    assert reload_a["submitted_quote"]["unit_price"] == 1500.0

    # Supplier B CANNOT see Supplier A's quotation
    details_b = (await client.get(f"/api/v1/public/rfq/{token_b}")).json()["data"]
    assert details_b["supplier_name"] == "Synthetic Supplier Beta"
    assert details_b["already_submitted"] is False
    assert details_b["submitted_quote"] is None
