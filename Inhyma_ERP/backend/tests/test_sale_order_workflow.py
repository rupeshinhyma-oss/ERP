"""Sale Order workflow: database-driven rules, mandatory fields, stock, delete/restore and visibility.

Runs the real router on an in-memory database. The workflow rules come from the same migration production uses.
"""

from __future__ import annotations

import importlib
import importlib.util
import uuid
from datetime import date
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


def _import_all_models() -> None:
    root = Path(__file__).resolve().parents[1]
    for path in sorted((root / "app").rglob("models.py")):
        importlib.import_module(".".join(path.relative_to(root).with_suffix("").parts))


_import_all_models()

from app.auth.dependencies import get_current_user  # noqa: E402
from app.auth.service import CurrentUser  # noqa: E402
from app.core.exception_handlers import register_exception_handlers  # noqa: E402
from app.database.base import Base  # noqa: E402
from app.database.session import get_db_session  # noqa: E402
from app.inventory import stock_service  # noqa: E402
from app.inventory.models import ProductStock  # noqa: E402
from app.masters.brands.models import Brand  # noqa: E402
from app.masters.option_lists.models import OptionList  # noqa: E402
from app.masters.product_categories.models import ProductCategory  # noqa: E402
from app.masters.product_sub_categories.models import ProductSubCategory  # noqa: E402
from app.masters.products.models import Product, ProductDimensionRow  # noqa: E402
from app.masters.taxes.models import Tax  # noqa: E402
from app.masters.uom.models import UnitOfMeasurement  # noqa: E402
from app.masters.warehouses.models import Warehouse  # noqa: E402
from app.sales.models import SaleOrder, SaleOrderItem  # noqa: E402
from app.sales.process_routes import router as sale_router  # noqa: E402

VERSIONS = Path(__file__).resolve().parents[1] / "alembic" / "versions"
SEED = "s1b2c3d4e5fa_sale_order_workflow.py"
TABLES = [
    SaleOrder.__table__, SaleOrderItem.__table__, OptionList.__table__, ProductStock.__table__, Product.__table__,
    Tax.__table__, UnitOfMeasurement.__table__, Warehouse.__table__, Brand.__table__, ProductCategory.__table__,
    ProductSubCategory.__table__, ProductDimensionRow.__table__,
]

SALES = CurrentUser(id=uuid.uuid4(), username="marketing")
APPROVER = CurrentUser(id=uuid.uuid4(), username="manager", permissions={"saleorder.approve"})
ACCOUNTS = CurrentUser(id=uuid.uuid4(), username="accounts", permissions={"saleorder.accounts"})
WAREHOUSE = CurrentUser(id=uuid.uuid4(), username="godown", permissions={"saleorder.warehouse"})
DELETER = CurrentUser(id=uuid.uuid4(), username="lead", permissions={"saleorder.delete"})
ADMIN = CurrentUser(id=uuid.uuid4(), username="boss", is_super_admin=True)


def _migrate(sync_conn, filename: str, direction: str = "upgrade") -> None:
    spec = importlib.util.spec_from_file_location(filename[:-3], VERSIONS / filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    with Operations.context(MigrationContext.configure(sync_conn)):
        getattr(module, direction)()


@pytest_asyncio.fixture
async def factory():
    engine = create_async_engine("sqlite+aiosqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
    async with engine.begin() as conn:
        await conn.run_sync(lambda c: Base.metadata.create_all(c, tables=TABLES))
        await conn.run_sync(_migrate, SEED)
    maker = async_sessionmaker(engine, expire_on_commit=False)
    async with maker() as s:
        uom = UnitOfMeasurement(code="NOS", name="Numbers", short_name="Nos")
        tax = Tax(hsn_number="84223000", gst_percent=18, import_duty_percent=10)
        s.add_all([uom, tax])
        await s.flush()
        mumbai = Warehouse(name="Mumbai", address="x", billing_company="Inhyma")
        s.add(mumbai)
        await s.flush()
        s.add_all([
            Warehouse(name="Ahmedabad", address="x", billing_company="Inhyma"),
            Warehouse(name="Mumbai Ordered", address="x", billing_company="Inhyma", main_warehouse_id=mumbai.id),
        ])
        cat = uuid.uuid4()
        s.add(Product(product_name="Band Sealer", product_name_tally="Band Sealer", category_id=cat, uom_id=uom.id, hsn_id=tax.id,
                      packaging_unit_cbm=0.5, packaging_quantity=1))
        await s.commit()
        await stock_service.apply_stock_delta(s, product_name="Band Sealer", warehouse_name="Mumbai", delta=10)
        await s.commit()
    yield maker
    await engine.dispose()


def _client(maker, user) -> AsyncClient:
    app = FastAPI()
    register_exception_handlers(app)
    app.include_router(sale_router)

    async def _db():
        async with maker() as session:
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


async def _stock(maker, column: str = "mumbai") -> float:
    async with maker() as s:
        row = (await s.execute(sa.select(ProductStock).where(ProductStock.product_name_tally == "Band Sealer"))).scalars().first()
        return float(getattr(row, column) or 0)


def _order(**over):
    body = {
        "buyer_name": "Acme Packaging", "order_date": date.today().isoformat(), "warehouse": "Mumbai", "sales_person": "marketing",
        "items": [{"product_name": "Band Sealer", "quantity": 3, "unit_rate": 1000, "tax_percent": 18}],
    }
    body.update(over)
    return body


async def _create(client, **over):
    res = await client.post("/sales/orders", json=_order(**over))
    assert res.status_code == 201, res.text
    return res.json()["data"]


async def _status(client, order_id, status, **extra):
    return await client.patch(f"/sales/orders/{order_id}/status", json={"status": status, **extra})


# ------------------------------------------------------------------ creation and stock
@pytest.mark.asyncio
async def test_create_starts_pending_whatever_the_client_sends_and_takes_stock(factory):
    async with _client(factory, SALES) as c:
        order = await _create(c, status="lr")                      # a client cannot start an order half-way through
    assert order["status"] == "pending"
    assert order["stock_applied"] is True and order["order_no"]
    assert await _stock(factory) == 7.0


@pytest.mark.asyncio
async def test_physical_warehouse_cannot_go_negative_but_ordered_warehouse_can(factory):
    async with _client(factory, SALES) as c:
        too_many = await c.post("/sales/orders", json=_order(items=[{"product_name": "Band Sealer", "quantity": 11, "unit_rate": 1}]))
        assert too_many.status_code == 409 and "Not enough stock" in too_many.text
        assert await _stock(factory) == 10.0                       # nothing was taken, nothing saved
        assert (await c.get("/sales/orders")).json()["data"]["total"] == 0

        booked = await _create(c, warehouse="Mumbai Ordered", items=[{"product_name": "Band Sealer", "quantity": 12, "unit_rate": 1}])
    assert booked["stock_applied"] is True
    assert await _stock(factory, "mumbai_ordered") == -12.0         # transit / ordered stock may go negative (spec)


@pytest.mark.asyncio
async def test_unknown_product_or_warehouse_is_refused_not_silently_skipped(factory):
    async with _client(factory, SALES) as c:
        bad_product = await c.post("/sales/orders", json=_order(items=[{"product_name": "Nope", "quantity": 1, "unit_rate": 1}]))
        assert bad_product.status_code == 400 and "not in the Product Master" in bad_product.text
        bad_wh = await c.post("/sales/orders", json=_order(warehouse="Atlantis"))
        assert bad_wh.status_code == 400 and "does not exist" in bad_wh.text


# ------------------------------------------------------------------ transitions, permissions, mandatory fields
@pytest.mark.asyncio
async def test_full_flow_with_who_may_do_what_and_the_mandatory_fields(factory):
    async with _client(factory, SALES) as sales, _client(factory, APPROVER) as approver, _client(factory, ACCOUNTS) as accounts, \
            _client(factory, WAREHOUSE) as warehouse:
        o = await _create(sales)
        oid = o["id"]
        assert (await _status(sales, oid, "lr")).status_code == 409                         # no skipping ahead
        assert (await _status(sales, oid, "Sales Confirmed")).status_code == 200             # display name is understood

        assert (await _status(sales, oid, "admin_approved")).status_code == 403              # only an approver
        assert (await _status(approver, oid, "admin_approved")).status_code == 200

        assert (await _status(sales, oid, "acc_confirmed", invoice_no="INV-1")).status_code == 403   # accounts only
        missing_invoice = await _status(accounts, oid, "acc_confirmed")
        assert missing_invoice.status_code == 400 and "Invoice number is required" in missing_invoice.text
        assert (await _status(accounts, oid, "acc_confirmed", invoice_no="INV-1", invoice_date="2026-10-08")).status_code == 200

        assert (await _status(accounts, oid, "gatepass_created")).status_code == 403          # warehouse only
        assert (await _status(warehouse, oid, "gatepass_created", gatepass_no="GP-1")).status_code == 200
        assert (await _status(warehouse, oid, "dispatched")).status_code == 200
        no_lr = await _status(warehouse, oid, "lr")
        assert no_lr.status_code == 400 and "LR number" in no_lr.text
        done = (await _status(warehouse, oid, "lr", lr_no="LR-77")).json()["data"]
        assert done["status"] == "lr" and done["invoice_no"] == "INV-1" and done["lr_no"] == "LR-77"
        assert (await _status(approver, oid, "cancelled", remarks="x")).status_code == 409     # LR is final


@pytest.mark.asyncio
async def test_third_party_delivery_needs_the_third_party_invoice_at_accounts(factory):
    async with _client(factory, SALES) as sales, _client(factory, APPROVER) as approver, _client(factory, ACCOUNTS) as accounts:
        oid = (await _create(sales, third_party_delivery="Yes"))["id"]
        await _status(sales, oid, "sales_confirmed")
        await _status(approver, oid, "admin_approved")
        refused = await _status(accounts, oid, "acc_confirmed", invoice_no="INV-9")
        assert refused.status_code == 400 and "third-party invoice" in refused.text
        ok = await _status(accounts, oid, "acc_confirmed", invoice_no="INV-9", third_party_invoice="tally-bill.pdf")
        assert ok.status_code == 200


@pytest.mark.asyncio
async def test_transit_or_ordered_warehouse_orders_can_only_be_cancelled(factory):
    async with _client(factory, SALES) as sales, _client(factory, APPROVER) as approver:
        oid = (await _create(sales, warehouse="Mumbai Ordered"))["id"]
        assert (await _status(sales, oid, "sales_confirmed")).status_code == 200
        blocked = await _status(approver, oid, "admin_approved")
        assert blocked.status_code == 409 and "transit / ordered" in blocked.text
        assert (await _status(sales, oid, "cancelled", remarks="client changed mind")).status_code == 200


@pytest.mark.asyncio
async def test_cancel_needs_a_reason_returns_stock_and_is_final(factory):
    async with _client(factory, SALES) as c:
        oid = (await _create(c))["id"]
        assert await _stock(factory) == 7.0
        no_reason = await _status(c, oid, "cancelled")
        assert no_reason.status_code == 400
        assert await _stock(factory) == 7.0
        cancelled = (await _status(c, oid, "cancelled", remarks="Client postponed")).json()["data"]
        assert cancelled["status"] == "cancelled" and cancelled["cancel_reason"] == "Client postponed"
        assert cancelled["stock_applied"] is False
        assert await _stock(factory) == 10.0                       # the stock is back
        assert (await _status(c, oid, "pending")).status_code == 409


# ------------------------------------------------------------------ editing
@pytest.mark.asyncio
async def test_editing_quantities_adjusts_stock_by_the_difference_and_refuses_overdraw(factory):
    async with _client(factory, SALES) as c:
        oid = (await _create(c))["id"]                              # 3 taken -> 7 left
        up = await c.patch(f"/sales/orders/{oid}", json={"items": [{"product_name": "Band Sealer", "quantity": 5, "unit_rate": 1}]})
        assert up.status_code == 200 and await _stock(factory) == 5.0
        down = await c.patch(f"/sales/orders/{oid}", json={"items": [{"product_name": "Band Sealer", "quantity": 1, "unit_rate": 1}]})
        assert down.status_code == 200 and await _stock(factory) == 9.0
        over = await c.patch(f"/sales/orders/{oid}", json={"items": [{"product_name": "Band Sealer", "quantity": 99, "unit_rate": 1}]})
        assert over.status_code == 409
        assert await _stock(factory) == 9.0                         # the failed edit changed nothing
        moved = await c.patch(f"/sales/orders/{oid}", json={"warehouse": "Ahmedabad"})
        assert moved.status_code == 409                             # Ahmedabad has no stock: refused, not silently ignored
        assert await _stock(factory) == 9.0


@pytest.mark.asyncio
async def test_edit_stops_once_admin_approved_and_the_status_cannot_be_set_through_edit(factory):
    async with _client(factory, SALES) as sales, _client(factory, APPROVER) as approver:
        oid = (await _create(sales))["id"]
        sneaky = (await sales.patch(f"/sales/orders/{oid}", json={"status": "dispatched", "remarks": "hi"})).json()["data"]
        assert sneaky["status"] == "pending"                        # the status back door is closed
        await _status(sales, oid, "sales_confirmed")
        assert (await sales.patch(f"/sales/orders/{oid}", json={"remarks": "still editable"})).status_code == 200
        await _status(approver, oid, "admin_approved")
        locked = await sales.patch(f"/sales/orders/{oid}", json={"remarks": "too late"})
        assert locked.status_code == 409


# ------------------------------------------------------------------ delete / restore
@pytest.mark.asyncio
async def test_delete_rules_by_stage_stock_goes_back_and_restore_is_admin_only(factory):
    async with _client(factory, SALES) as sales, _client(factory, DELETER) as deleter, _client(factory, ADMIN) as admin, \
            _client(factory, APPROVER) as approver:
        pending = (await _create(sales))["id"]
        assert (await sales.delete(f"/sales/orders/{pending}")).status_code == 403          # marketing cannot delete
        assert (await deleter.delete(f"/sales/orders/{pending}")).status_code == 200
        assert await _stock(factory) == 10.0                                                # stock returned

        confirmed = (await _create(sales))["id"]
        await _status(sales, confirmed, "sales_confirmed")
        assert (await deleter.delete(f"/sales/orders/{confirmed}")).status_code == 403      # later stages: admin only
        assert (await admin.delete(f"/sales/orders/{confirmed}")).status_code == 200
        assert await _stock(factory) == 10.0

        assert (await sales.post(f"/sales/orders/{confirmed}/restore")).status_code == 403
        assert (await admin.post(f"/sales/orders/{confirmed}/restore")).status_code == 200
        assert await _stock(factory) == 7.0                                                 # restored order holds stock again

        final = (await _create(sales))["id"]                                                # nobody deletes an LR-stage order
        await _status(sales, final, "sales_confirmed")
        await _status(approver, final, "admin_approved")
        # (set directly: the accounts / warehouse steps are covered above)
        async with factory() as s:
            order = await s.get(SaleOrder, uuid.UUID(final))
            order.status = "lr"
            await s.commit()
        assert (await admin.delete(f"/sales/orders/{final}")).status_code == 409


# ------------------------------------------------------------------ list, rules, visibility, auth
@pytest.mark.asyncio
async def test_list_carries_the_status_rules(factory):
    async with _client(factory, SALES) as c:
        await _create(c)
        data = (await c.get("/sales/orders")).json()["data"]
    assert set(data["status_rules"]) == {"pending", "sales_confirmed", "admin_approved", "acc_confirmed", "gatepass_created",
                                         "dispatched", "gatepass_cancelled", "lr", "cancelled"}
    assert data["status_rules"]["pending"]["initial"] is True


@pytest.mark.asyncio
async def test_accounts_staff_see_only_confirmed_orders_in_physical_warehouses(factory):
    async with _client(factory, SALES) as sales, _client(factory, ACCOUNTS) as accounts, _client(factory, ADMIN) as admin:
        pending = (await _create(sales))["id"]
        confirmed = (await _create(sales))["id"]
        await _status(sales, confirmed, "sales_confirmed")
        ordered = (await _create(sales, warehouse="Mumbai Ordered"))["id"]
        await _status(sales, ordered, "sales_confirmed")

        seen = {o["id"] for o in (await accounts.get("/sales/orders")).json()["data"]["items"]}
        assert seen == {confirmed}                                                           # no pending, no transit / ordered
        assert (await accounts.get(f"/sales/orders/{pending}")).status_code == 404
        assert (await accounts.get(f"/sales/orders/{ordered}")).status_code == 404
        assert (await accounts.get(f"/sales/orders/{confirmed}")).status_code == 200
        assert {o["id"] for o in (await admin.get("/sales/orders")).json()["data"]["items"]} == {pending, confirmed, ordered}


@pytest.mark.asyncio
async def test_routes_require_authentication(factory):
    async with _client(factory, None) as anon:
        for method, url in (("get", "/sales/orders"), ("post", "/sales/orders"), ("delete", f"/sales/orders/{uuid.uuid4()}")):
            res = await getattr(anon, method)(url, **({"json": {}} if method == "post" else {}))
            assert res.status_code in (401, 403), (method, url, res.status_code)


# ------------------------------------------------------------------ the migration itself
@pytest.mark.asyncio
async def test_migration_seeds_the_rules_idempotently_and_backfills_stock_applied():
    engine = create_async_engine("sqlite+aiosqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
    async with engine.begin() as conn:
        await conn.run_sync(lambda c: Base.metadata.create_all(c, tables=[OptionList.__table__, Warehouse.__table__]))
        # an "old" sales_orders table: no cancel_reason / stock_applied yet, with orders already on file
        await conn.execute(sa.text("CREATE TABLE sales_orders (id TEXT PRIMARY KEY, warehouse TEXT, deleted_at TEXT)"))
    maker = async_sessionmaker(engine, expire_on_commit=False)
    async with maker() as session:
        main = Warehouse(name="Mumbai", address="x", billing_company="b")
        session.add(main)
        await session.flush()
        session.add(Warehouse(name="Mumbai Ordered", address="x", billing_company="b", main_warehouse_id=main.id))
        await session.commit()
    async with engine.begin() as conn:
        for oid, wh, deleted in (("a", "Mumbai", None), ("b", "Mumbai Ordered", None), ("c", "Mumbai", "2026-01-01")):
            await conn.execute(sa.text("INSERT INTO sales_orders (id, warehouse, deleted_at) VALUES (:i,:w,:d)"), {"i": oid, "w": wh, "d": deleted})
        await conn.run_sync(_migrate, SEED)
        await conn.run_sync(_migrate, SEED)                         # running it twice changes nothing
        applied = dict((await conn.execute(sa.text("SELECT id, stock_applied FROM sales_orders"))).all())
        rules = (await conn.execute(sa.text("SELECT count(*) FROM option_lists WHERE group_key='sale.order.status'"))).scalar()
    await engine.dispose()
    assert rules == 9
    assert bool(applied["a"]) is True                               # was deducted at creation (physical)
    assert bool(applied["b"]) is False                              # ordered warehouse: nothing was ever deducted
    assert bool(applied["c"]) is False                              # deleted: unknown, left alone


# ------------------------------------------------------------------ the real form payload, priced on the server
FORM_PAYLOAD = {
    # exactly the keys SaleProcessForm.tsx sends (note: no buyer_name, no order_date)
    "warehouse": "Mumbai", "expected_delivery_date": "15-10-2026", "payment_terms": "100% Advance", "sales_person": "marketing",
    "transport_name": "VRL Logistics", "third_party_delivery": "No", "third_party": "No", "transport_destination": "Pune",
    "delivery_type": "Godown", "delivery_charge": "To Pay", "company_name": "Acme Packaging",
    "billing_address": "1 Mill Rd, Mumbai", "shipping_address": "2 Dock Rd, Pune", "terms_and_conditions": "Subject to Mumbai jurisdiction",
    "remarks": "", "booking_remarks": "Reserve for Friday dispatch", "additional_charges_enabled": True,
    # client-side totals: deliberately wrong, the server must ignore them
    "total_basic": 1, "total_discount": 1, "total_taxable_amount": 1, "total_tax": 1, "total_including_tax": 1, "total_amount": 1,
    "amount_inc_gst": 1, "amount_exc_gst": 1, "amount_in_words": "one",
    "items": [
        {"product_name": "Band Sealer", "hsn": "84223000", "quantity": 2, "unit_price": 1000, "unit_rate": 1000, "unit_discount": 100,
         "gst_percent": 18, "tax_percent": 18, "taxable_amount": 1, "gst_amount": 1, "tax_amount": 1, "total": 1, "item_total": 1,
         "is_additional_charge": False, "charge_type": None},
        {"product_name": "Freight", "hsn": "", "quantity": 1, "unit_price": 500, "unit_rate": 500, "unit_discount": 0,
         "gst_percent": 18, "tax_percent": 18, "total": 1, "item_total": 1, "is_additional_charge": True, "charge_type": "Freight"},
    ],
}


@pytest.mark.asyncio
async def test_the_sales_process_form_payload_saves_and_the_server_does_the_pricing(factory):
    async with _client(factory, SALES) as c:
        res = await c.post("/sales/orders", json=FORM_PAYLOAD)
        assert res.status_code == 201, res.text                       # this used to be a 422 (no buyer_name / order_date)
        order = res.json()["data"]
        assert order["buyer_name"] == order["company_name"] == "Acme Packaging"
        assert order["order_date"] == date.today().isoformat()
        assert str(order["delivery_date"]).startswith("2026-10-15")
        assert order["transporter_name"] == "VRL Logistics"
        assert order["terms_and_conditions"] == "Subject to Mumbai jurisdiction"
        assert order["booking_remarks"] == "Reserve for Friday dispatch"

        # product: (1000 - 100) x 2 = 1800 taxable, +18% = 2124 ; freight: 500 + 18% = 590
        assert order["total_tax"] == 414.0                             # 324 + 90
        assert order["total_amount"] == order["amount_inc_gst"] == 2714.0
        assert order["discount"] == 200.0
        goods, freight = order["items"]
        assert (goods["taxable_amount"], goods["gst_amount"], goods["item_total"]) == (1800.0, 324.0, 2124.0)
        assert (freight["is_additional_charge"], freight["charge_type"], freight["item_total"]) == (True, "Freight", 590.0)
        assert order["total_quantity"] == 2.0                          # the freight line is not goods
        assert await _stock(factory) == 8.0                            # only the product moved stock

        # editing re-prices on the server and moves stock by the difference; the freight line still doesn't touch stock
        body = {**FORM_PAYLOAD, "items": [{**FORM_PAYLOAD["items"][0], "quantity": 4}, FORM_PAYLOAD["items"][1]]}
        edit = (await c.patch(f"/sales/orders/{order['id']}", json=body)).json()["data"]
        assert edit["total_amount"] == 2 * 2124.0 + 590.0
        assert await _stock(factory) == 6.0


@pytest.mark.asyncio
async def test_bad_dates_and_missing_company_are_clear_validation_errors(factory):
    async with _client(factory, SALES) as c:
        bad_date = await c.post("/sales/orders", json={**FORM_PAYLOAD, "expected_delivery_date": "31-31-2026"})
        assert bad_date.status_code == 422 and "valid date" in bad_date.text
        no_company = await c.post("/sales/orders", json={**{k: v for k, v in FORM_PAYLOAD.items() if k != "company_name"}})
        assert no_company.status_code == 422 and "Company" in no_company.text
        assert await _stock(factory) == 10.0


@pytest.mark.asyncio
async def test_migration_downgrade_removes_only_the_rules_and_keeps_the_data_columns(factory):
    async with factory() as s:
        await s.execute(sa.text("DELETE FROM option_lists WHERE group_key = 'other'"))  # unrelated rows must survive
        await s.commit()
    engine = factory.kw["bind"]
    async with engine.begin() as conn:
        await conn.run_sync(_migrate, SEED, "downgrade")
        rules = (await conn.execute(sa.text("SELECT count(*) FROM option_lists WHERE group_key='sale.order.status'"))).scalar()
        cols = {r[1] for r in (await conn.execute(sa.text("PRAGMA table_info(sales_orders)"))).all()}
    assert rules == 0
    assert {"stock_applied", "cancel_reason"} <= cols          # stock bookkeeping is never dropped
