"""Proforma Invoice: persistence, pricing, numbering, workflow rules, auth and migrations.

Runs the real sales router against an in-memory SQLite database (no Postgres needed).
The workflow rules / numbering / defaults come from the same seed migration production uses.
"""

from __future__ import annotations

import importlib.util
import uuid
from pathlib import Path

import pytest
import pytest_asyncio
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.auth.dependencies import get_current_user
from app.auth.service import CurrentUser
from app.core.exception_handlers import register_exception_handlers
from app.database.base import Base
from app.database.session import get_db_session
from app.masters.option_lists.models import OptionList
from app.masters.products.models import Product
from app.masters.uom.models import UnitOfMeasurement
from app.sales.models import ProformaInvoice, ProformaInvoiceLineItem
from app.sales.routes import router as sales_router

def _import_all_models() -> None:
    """Load every ``app.**.models`` module so foreign-key targets (brands, categories, ...) resolve."""
    root = Path(__file__).resolve().parents[1]
    for path in sorted((root / "app").rglob("models.py")):
        importlib.import_module(".".join(path.relative_to(root).with_suffix("").parts))


_import_all_models()

VERSIONS = Path(__file__).resolve().parents[1] / "alembic" / "versions"
TABLES = [
    ProformaInvoice.__table__,
    ProformaInvoiceLineItem.__table__,
    OptionList.__table__,
    Product.__table__,
    UnitOfMeasurement.__table__,
]

NORMAL = CurrentUser(id=uuid.uuid4(), username="marketing")
ADMIN = CurrentUser(id=uuid.uuid4(), username="boss", is_super_admin=True)


def _run_migration(sync_conn, filename: str, fn: str = "upgrade") -> None:
    spec = importlib.util.spec_from_file_location(filename[:-3], VERSIONS / filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    with Operations.context(MigrationContext.configure(sync_conn)):
        getattr(module, fn)()


@pytest_asyncio.fixture
async def factory():
    engine = create_async_engine(
        "sqlite+aiosqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False}
    )
    async with engine.begin() as conn:
        await conn.run_sync(lambda c: Base.metadata.create_all(c, tables=TABLES))
        await conn.run_sync(_run_migration, "k1a2b3c4d5e8_seed_proforma_rules.py")
    yield async_sessionmaker(engine, expire_on_commit=False)
    await engine.dispose()


def _client(factory, user: CurrentUser | None) -> AsyncClient:
    app = FastAPI()
    register_exception_handlers(app)
    app.include_router(sales_router)

    async def _db():
        async with factory() as session:
            try:
                yield session
                await session.commit()
            except BaseException:
                await session.rollback()
                raise

    app.dependency_overrides[get_db_session] = _db
    if user is not None:
        app.dependency_overrides[get_current_user] = lambda: user
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


def _payload(**over):
    body = {
        "proforma_date": "05-10-2026",
        "expected_delivery_date": "10-10-2026",
        "warehouse": "Mumbai",
        "lead_source": "Website",
        "company_name": "Acme Packaging",
        "city": "Pune",
        "state": "Maharashtra",
        "sales_person": "Asha",
        "payment_terms": "100% Advance",
        "transport_name": "Not Sure",
        "transport_destination": "Pune",
        "delivery_type": "Godown",
        "delivery_charge": "To Pay",
        "third_party_delivery": "No",
        "billing_address": "1 Billing Rd",
        "shipping_address": "2 Shipping Rd",
        "terms_and_conditions": "Pay in 7 days",
        "remark": "urgent",
        "items": [
            {"product_name": "Band Sealer", "hsn": "84223000", "quantity": 2, "unit_price": 1000,
             "unit_discount": 100, "gst_percent": 18},
            {"product_name": "Transport Charges", "hsn": "996511", "quantity": 1, "unit_price": 500,
             "gst_percent": 18, "is_additional_charge": True, "charge_type": "Transport Charges"},
        ],
        # client-supplied totals / status / author must be ignored
        "amount_inc_gst": 1, "discount": 999, "status": "confirmed", "created_by": "hacker",
    }
    body.update(over)
    return body


async def _create(client, **over):
    res = await client.post("/proforma-invoice", json=_payload(**over))
    assert res.status_code == 201, res.text
    return res.json()["data"]


# ------------------------------------------------------------------ persistence & pricing
@pytest.mark.asyncio
async def test_create_persists_every_field_and_prices_on_the_server(factory):
    async with _client(factory, NORMAL) as c:
        pi = await _create(c)
        got = (await c.get(f"/proforma-invoice/{pi['id']}")).json()["data"]

    for key in ("payment_terms", "transport_name", "transport_destination", "delivery_type", "delivery_charge",
                "third_party_delivery", "billing_address", "shipping_address", "terms_and_conditions", "remark",
                "warehouse", "lead_source", "company_name", "sales_person"):
        assert got[key] == _payload()[key], key

    assert got["status"] == "pending"            # client tried to send 'confirmed'
    assert got["created_by"] == "marketing"      # client tried to send 'hacker'
    # (1000-100)*2 = 1800 taxable + 18% = 2124 ; charge 500 + 18% = 590 ; total 2714
    assert got["taxable_amount"] == 2300.0
    assert got["gst_amount"] == 414.0
    assert got["amount_inc_gst"] == 2714.0
    assert got["discount"] == 200.0              # unit discount x qty, not the client's 999
    line = got["items"][0]
    assert (line["unit_discount"], line["taxable_amount"], line["gst_amount"], line["total"]) == (100.0, 1800.0, 324.0, 2124.0)
    charge = next(i for i in got["items"] if i["is_additional_charge"])
    assert charge["charge_type"] == "Transport Charges" and charge["hsn_code"] == "996511"


@pytest.mark.asyncio
async def test_numbering_is_five_digits_and_continues_from_legacy_numbers(factory):
    async with factory() as s:
        s.add(ProformaInvoice(proforma_no="PI-0007", proforma_date="01-01-2026", warehouse="Mumbai",
                              company_name="Legacy"))
        await s.commit()
    async with _client(factory, NORMAL) as c:
        assert (await _create(c))["proforma_no"] == "PI-00008"
        assert (await _create(c))["proforma_no"] == "PI-00009"


@pytest.mark.asyncio
async def test_minimum_price_flag_and_uom_come_from_the_product_master(factory):
    async with factory() as s:
        uom = UnitOfMeasurement(code="NOS", name="Numbers", short_name="Nos")
        s.add(uom)
        await s.flush()
        s.add(Product(product_name="Band Sealer", product_name_tally="Band Sealer", category_id=uuid.uuid4(),
                      uom_id=uom.id, standard_price=1000.0))
        await s.commit()
    async with _client(factory, NORMAL) as c:
        below = await _create(c, items=[{"product_name": "Band Sealer", "quantity": 1, "unit_price": 900, "gst_percent": 18}])
        ok = await _create(c, items=[{"product_name": "Band Sealer", "quantity": 1, "unit_price": 1000, "gst_percent": 18}])
    assert below["below_min_price"] is True
    assert ok["below_min_price"] is False
    assert ok["items"][0]["uom"] == "Nos"        # resolved from the UOM master, not hardcoded


@pytest.mark.asyncio
async def test_validation(factory):
    async with _client(factory, NORMAL) as c:
        assert (await c.post("/proforma-invoice", json=_payload(items=[]))).status_code == 400
        bad = _payload(items=[{"product_name": "X", "quantity": 1, "unit_price": 100, "unit_discount": 150}])
        assert (await c.post("/proforma-invoice", json=bad)).status_code == 400


# ------------------------------------------------------------------ workflow
@pytest.mark.asyncio
async def test_workflow_transitions_permissions_and_reasons(factory):
    async with _client(factory, NORMAL) as user, _client(factory, ADMIN) as admin:
        pi = await _create(user)
        pid = pi["id"]
        url = f"/proforma-invoice/{pid}/status"

        assert (await user.patch(url, json={"status": "admin_approved"})).status_code == 403   # admin-only step
        assert (await admin.patch(url, json={"status": "confirmed"})).status_code == 409        # cannot skip approval
        assert (await admin.patch(url, json={"status": "bogus"})).status_code == 400

        ok = (await admin.patch(url, json={"status": "admin_approved"})).json()["data"]
        assert ok["status"] == "admin_approved" and ok["approved_by"] == "boss" and ok["approved_at"]

        assert (await user.patch(url, json={"status": "cancelled"})).status_code == 400          # reason required
        cancelled = (await user.patch(url, json={"status": "cancelled", "reason": "client declined"})).json()["data"]
        assert cancelled["status"] == "cancelled" and cancelled["cancel_reason"] == "client declined"
        assert cancelled["cancelled_by"] == "marketing"

        assert (await admin.patch(url, json={"status": "pending"})).status_code == 409           # terminal

        # status is persisted, not just returned
        assert (await user.get(f"/proforma-invoice/{pid}")).json()["data"]["status"] == "cancelled"

        # happy path to confirmed
        pi2 = await _create(user)
        u2 = f"/proforma-invoice/{pi2['id']}/status"
        await admin.patch(u2, json={"status": "admin_approved"})
        done = (await user.patch(u2, json={"status": "confirmed"})).json()["data"]
        assert done["status"] == "confirmed" and done["confirmed_by"] == "marketing"


@pytest.mark.asyncio
async def test_edit_rules_by_stage(factory):
    async with _client(factory, NORMAL) as user, _client(factory, ADMIN) as admin:
        pid = (await _create(user))["id"]
        edit = {"company_name": "Renamed", "items": [{"product_name": "Y", "quantity": 1, "unit_price": 100, "gst_percent": 0}],
                "status": "confirmed"}

        res = (await user.patch(f"/proforma-invoice/{pid}", json=edit)).json()["data"]
        assert res["company_name"] == "Renamed" and res["amount_inc_gst"] == 100.0 and len(res["items"]) == 1
        assert res["status"] == "pending"                       # status cannot be changed through edit

        await admin.patch(f"/proforma-invoice/{pid}/status", json={"status": "admin_approved"})
        assert (await user.patch(f"/proforma-invoice/{pid}", json={"remark": "x"})).status_code == 403
        assert (await admin.patch(f"/proforma-invoice/{pid}", json={"remark": "admin edit"})).status_code == 200

        await user.patch(f"/proforma-invoice/{pid}/status", json={"status": "confirmed"})
        assert (await admin.patch(f"/proforma-invoice/{pid}", json={"remark": "late"})).status_code == 409


@pytest.mark.asyncio
async def test_delete_rules_by_stage(factory):
    async with _client(factory, NORMAL) as user, _client(factory, ADMIN) as admin:
        pending = (await _create(user))["id"]
        assert (await user.delete(f"/proforma-invoice/{pending}")).status_code == 200
        assert (await user.get(f"/proforma-invoice/{pending}")).status_code == 404

        approved = (await _create(user))["id"]
        await admin.patch(f"/proforma-invoice/{approved}/status", json={"status": "admin_approved"})
        assert (await user.delete(f"/proforma-invoice/{approved}")).status_code == 409

        await user.patch(f"/proforma-invoice/{approved}/status", json={"status": "cancelled", "reason": "no"})
        assert (await user.delete(f"/proforma-invoice/{approved}")).status_code == 200


@pytest.mark.asyncio
async def test_list_counts_come_from_db_rules_and_deleted_rows_are_hidden(factory):
    async with _client(factory, NORMAL) as user, _client(factory, ADMIN) as admin:
        a = (await _create(user))["id"]
        b = (await _create(user))["id"]
        await admin.patch(f"/proforma-invoice/{b}/status", json={"status": "admin_approved"})
        gone = (await _create(user))["id"]
        await user.delete(f"/proforma-invoice/{gone}")

        data = (await user.get("/proforma-invoice/list")).json()["data"]
        assert set(data["tab_counts"]) == {"all", "pending", "admin_approved", "confirmed", "cancelled"}
        assert data["tab_counts"]["all"]["count"] == 2
        assert data["tab_counts"]["pending"]["count"] == 1 and data["tab_counts"]["admin_approved"]["count"] == 1
        assert {i["id"] for i in data["items"]} == {a, b}
        only = (await user.get("/proforma-invoice/list", params={"status": "admin_approved"})).json()["data"]["items"]
        assert [i["id"] for i in only] == [b]


@pytest.mark.asyncio
async def test_routes_require_authentication(factory):
    async with _client(factory, None) as anon:           # no auth override -> real dependency
        for method, url in (("get", "/proforma-invoice/list"), ("post", "/proforma-invoice"),
                            ("patch", f"/proforma-invoice/{uuid.uuid4()}/status")):
            res = await getattr(anon, method)(url, **({"json": {}} if method != "get" else {}))
            assert res.status_code in (401, 403), (method, url, res.status_code)


# ------------------------------------------------------------------ migrations
@pytest.mark.asyncio
async def test_seed_migration_is_idempotent_and_aligns_delivery_options(factory):
    async with factory() as s:
        before = (await s.execute(sa.select(sa.func.count()).select_from(OptionList))).scalar()
        s.add(OptionList(group_key="delivery.type", value="Courier", label="Courier", sort_order=9))
        await s.commit()
    engine = factory.kw["bind"]
    async with engine.begin() as conn:
        await conn.run_sync(_run_migration, "k1a2b3c4d5e8_seed_proforma_rules.py")   # second run
    async with factory() as s:
        rows = (await s.execute(sa.select(OptionList).where(OptionList.deleted_at.is_(None)))).scalars().all()
        keys = [(r.group_key, r.value) for r in rows]
        assert len(keys) == len(set(keys)), "seed migration created duplicates"
        assert len(rows) == before + 1
        active = {r.value for r in rows if r.group_key == "delivery.type" and r.status.name == "ACTIVE"}
        assert active == {"Godown", "Door"}                  # 'Courier' hidden, spec values active
        defaults = {r.value: r.label for r in rows if r.group_key == "proforma.defaults"}
        assert defaults["payment_terms"] == "100% Advance" and defaults["delivery_charge"] == "To Pay"


@pytest.mark.asyncio
async def test_column_migration_adds_missing_columns_to_old_tables():
    engine = create_async_engine("sqlite+aiosqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
    async with engine.begin() as conn:
        await conn.execute(sa.text("CREATE TABLE proforma_invoices (id CHAR(36) PRIMARY KEY, proforma_no VARCHAR(50))"))
        await conn.execute(sa.text("CREATE TABLE proforma_invoice_items (id CHAR(36) PRIMARY KEY, product_name VARCHAR(255))"))
        await conn.run_sync(_run_migration, "j1a2b3c4d5e7_extend_proforma_invoice.py")
        await conn.run_sync(_run_migration, "j1a2b3c4d5e7_extend_proforma_invoice.py")   # idempotent
        cols = await conn.run_sync(lambda c: {x["name"] for x in sa.inspect(c).get_columns("proforma_invoices")})
        item_cols = await conn.run_sync(lambda c: {x["name"] for x in sa.inspect(c).get_columns("proforma_invoice_items")})
    await engine.dispose()
    assert {"payment_terms", "billing_address", "below_min_price", "cancel_reason", "approved_at"} <= cols
    assert {"unit_discount", "gst_amount", "is_additional_charge", "charge_type"} <= item_cols


@pytest.mark.asyncio
async def test_company_lookup_returns_address_city_and_state_for_prefill():
    """The PI page prefills billing/shipping address, city and state from the selected company."""
    from app.companies.models import Company
    from app.companies.routes import router as companies_router
    from app.masters.cities.models import City
    from app.masters.states.models import State

    engine = create_async_engine("sqlite+aiosqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
    async with engine.begin() as conn:
        await conn.run_sync(lambda c: Base.metadata.create_all(c, tables=[Company.__table__, City.__table__, State.__table__]))
    maker = async_sessionmaker(engine, expire_on_commit=False)
    async with maker() as s:
        country_id = uuid.uuid4()
        state = State(name="Maharashtra", country_id=country_id)
        s.add(state)
        await s.flush()
        city = City(name="Pune", state_id=state.id, country_id=country_id)
        s.add(city)
        await s.flush()
        s.add(Company(company_name="Acme Packaging", address="12 MG Road", pincode="411001",
                      city_id=city.id, state_id=state.id))
        await s.commit()

    app = FastAPI()
    register_exception_handlers(app)
    app.include_router(companies_router)

    @app.middleware("http")
    async def _request_id(request, call_next):  # the real app sets this in RequestIdMiddleware
        request.state.request_id = "test"
        return await call_next(request)

    async def _db():
        async with maker() as session:
            yield session

    app.dependency_overrides[get_db_session] = _db
    app.dependency_overrides[get_current_user] = lambda: ADMIN
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        res = await c.get("/companies/lookup", params={"q": "acme"})
    await engine.dispose()
    assert res.status_code == 200, res.text
    row = res.json()["data"][0]
    assert (row["address"], row["pincode"], row["city_name"], row["state_name"]) == ("12 MG Road", "411001", "Pune", "Maharashtra")
