"""
Inventory integrity: Product Stock list, stock totals, stock adjustments, breakup popups, reorder list,
product delete rule and product import duplicates -- through the real API on an in-memory SQLite database.
"""

from __future__ import annotations

import datetime
import uuid

import pytest
import sqlalchemy as sa
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.auth.dependencies import get_current_user
from app.auth.service import CurrentUser
from app.database.base import Base
from app.database.session import get_db_session
from app.inventory import stock_service
from app.inventory.models import ProductStock, StockAdjustment
from app.main import create_application
from app.masters.products.models import Product
from app.masters.warehouses.models import Warehouse

pytestmark = pytest.mark.asyncio

NEEDED_TABLES = {
    "warehouses", "products", "brands", "product_categories", "product_sub_categories", "taxes", "units_of_measurement",
    "product_stocks", "stock_adjustments", "stock_adjustment_items", "stock_transfers", "stock_transfer_items",
    "sale_orders", "sale_order_items", "import_purchases", "import_purchase_items",
    "product_dimension_rows", "product_machine_spares", "product_prices", "audit_logs",
}


def _sales_tables() -> set[str]:
    from app.sales.models import SaleOrder, SaleOrderItem

    return {SaleOrder.__tablename__, SaleOrderItem.__tablename__}


def make(model, **over):
    """Build a row, filling every required column that the test does not care about with a dummy value."""
    values = dict(over)
    for col in model.__table__.columns:
        if col.key in values or col.primary_key or col.nullable or col.default is not None or col.server_default is not None:
            continue
        t = col.type.__class__.__name__
        values[col.key] = (
            uuid.uuid4() if t in ("GUID", "Uuid", "UUID") else "x" if t in ("String", "Text", "Enum") else
            0 if t in ("Integer", "SmallInteger", "BigInteger") else 0.0 if t in ("Float", "Numeric") else
            False if t == "Boolean" else datetime.date.today() if t == "Date" else
            datetime.datetime.now(datetime.timezone.utc) if t == "DateTime" else {} if t == "JSON" else "x"
        )
    return model(**values)


@pytest.fixture
async def db():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    tables = [t for t in Base.metadata.sorted_tables if t.name in NEEDED_TABLES | _sales_tables()]
    async with engine.begin() as conn:
        await conn.run_sync(lambda c: Base.metadata.create_all(c, tables=tables))
    async with async_sessionmaker(bind=engine, class_=AsyncSession, expire_on_commit=False)() as session:
        yield session
    await engine.dispose()


@pytest.fixture
async def client(db: AsyncSession):
    app = create_application()

    async def _db():
        # like the real request session: a failed request is rolled back as a whole
        try:
            yield db
            await db.commit()
        except Exception:
            await db.rollback()
            raise

    user = CurrentUser(id=uuid.uuid4(), username="warehouse1", permissions={"*"})
    app.dependency_overrides[get_db_session] = _db
    app.dependency_overrides[get_current_user] = lambda: user
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as ac:
        yield ac


async def add_warehouse(db, name, main_id=None):
    w = make(Warehouse, name=name, main_warehouse_id=main_id)
    db.add(w)
    await db.flush()
    return w


async def add_product(db, name, **over):
    p = make(Product, product_name=name, product_name_tally=name, product_code=over.pop("product_code", f"C-{name[:6]}"), **over)
    db.add(p)
    await db.flush()
    return p


async def seed_stock(db, **balances):
    """Warehouses Mumbai / Mumbai Transit / Mumbai Ordered + a product 'Sensor A' with the given Mumbai balances."""
    mumbai = await add_warehouse(db, "Mumbai")
    await add_warehouse(db, "Mumbai Transit", mumbai.id)
    await add_warehouse(db, "Mumbai Ordered", mumbai.id)
    product = await add_product(db, "Sensor A")
    if balances:
        await stock_service._ensure_stock_row(db, product)
        row = await stock_service._ensure_stock_row(db, product)
        for k, v in balances.items():
            setattr(row, k, v)
        stock_service.recompute_total(row)
    await db.commit()
    from types import SimpleNamespace

    return SimpleNamespace(id=product.id, product_name=product.product_name)  # plain values: safe after a rollback


async def real_product(db, info):
    return (await db.execute(sa.select(Product).where(Product.id == info.id))).scalars().one()


async def stock_of(db, product):
    """Fresh snapshot of the product's live stock row (values copied while loaded -- safe after a rollback)."""
    from types import SimpleNamespace

    row = (
        await db.execute(
            sa.select(ProductStock).where(ProductStock.product_id == product.id, ProductStock.deleted_at.is_(None)).execution_options(populate_existing=True)
        )
    ).scalars().first()
    cols = (*stock_service.WAREHOUSE_COLUMNS, "total_qty", "reorder_level", "minimum_order_quantity")
    return SimpleNamespace(**{c: getattr(row, c) for c in cols}) if row is not None else SimpleNamespace(**{c: 0.0 for c in cols})


def adj_body(qty=2, type_="Stock IN", warehouse="Mumbai", name="Sensor A", date="16-10-2026", **over):
    body = {"adjustment_date": date, "warehouse": warehouse, "type": type_, "purpose": "Split",
            "items": [{"product_name": name, "qty": qty, "rate": 100, "amount": qty * 100}]}
    body.update(over)
    return body


# ------------------------------------------------------------------------------------------------ Product Stock list
async def test_list_never_shows_sample_data(client, db):
    r = await client.get("/api/v1/inventory/product-stock")
    assert r.status_code == 200 and r.json()["data"]["items"] == [] and r.json()["data"]["total"] == 0
    for params in ({"search": "capping"}, {"category": "Machines"}, {"brand": "Yinglima"}):
        assert (await client.get("/api/v1/inventory/product-stock", params=params)).json()["data"]["items"] == []


async def test_list_returns_real_rows_without_invented_values(client, db):
    await seed_stock(db, mumbai=5.0, mumbai_transit=3.0)
    d = (await client.get("/api/v1/inventory/product-stock")).json()["data"]
    assert d["total"] == 1
    item = d["items"][0]
    assert item["product_name_tally"] == "Sensor A" and item["mumbai"] == 5 and item["mumbai_transit"] == 3 and item["total_qty"] == 8
    assert "unit_cost" not in item and "total_value" not in item and "quantity_reserved" not in item


async def test_list_filters_negative_stock_search_and_wildcards(client, db):
    mumbai = await add_warehouse(db, "Mumbai")
    for name, brand, cat, sub, bal in (("Alpha Belt", "Yinglima", "Spares", "Belts", {"mumbai": 5}), ("Beta 50% Seal", "Omron", "Machines", "Seals", {"mumbai": -2}),
                                       ("Gamma_Roller", "Omron", "Spares", "Rollers", {"mumbai_transit": -4})):
        p = await add_product(db, name)
        row = await stock_service._ensure_stock_row(db, p)
        row.brand, row.category, row.sub_category = brand, cat, sub
        for k, v in bal.items():
            setattr(row, k, float(v))
        stock_service.recompute_total(row)
    await db.commit()
    get = lambda **p: client.get("/api/v1/inventory/product-stock", params=p)
    names = lambda r: sorted(i["product_name_tally"] for i in r.json()["data"]["items"])
    assert names(await get(brand="Omron")) == ["Beta 50% Seal", "Gamma_Roller"]
    assert names(await get(category="Spares", sub_category="Belts")) == ["Alpha Belt"]
    assert names(await get(negative_stock="Yes")) == ["Beta 50% Seal", "Gamma_Roller"]       # any warehouse (incl. transit) negative
    assert names(await get(negative_stock="No")) == ["Alpha Belt"]
    assert names(await get(negative_stock="Select")) == ["Alpha Belt", "Beta 50% Seal", "Gamma_Roller"]
    assert names(await get(search="50%")) == ["Beta 50% Seal"]                               # % is searched literally
    assert names(await get(search="_")) == ["Gamma_Roller"]                                  # so is _
    assert names(await get(search="seal")) == ["Beta 50% Seal"]
    page = (await get(limit=2, skip=0)).json()["data"]
    assert page["total"] == 3 and len(page["items"]) == 2


# ------------------------------------------------------------------------------------------------ totals / rows
async def test_total_qty_counts_only_warehouse_balances(db):
    product = await real_product(db, await seed_stock(db))
    row = await stock_service._ensure_stock_row(db, product)
    row.reorder_level, row.minimum_order_quantity = 10.0, 5.0
    await stock_service.apply_stock_delta(db, product_name="Sensor A", warehouse_name="Mumbai", delta=3)
    await stock_service.apply_stock_delta(db, product_name="Sensor A", warehouse_name="Mumbai Transit", delta=2)
    assert "reorder_level" not in stock_service.WAREHOUSE_COLUMNS and "minimum_order_quantity" not in stock_service.WAREHOUSE_COLUMNS
    assert row.total_qty == 5.0


async def test_one_stock_row_per_product_even_when_a_race_is_lost(db, monkeypatch):
    product = await real_product(db, await seed_stock(db))
    first = await stock_service._ensure_stock_row(db, product)
    # a second request that did not see the row yet (race) must adopt it, not create a duplicate
    real = stock_service._find_stock_row
    calls = {"n": 0}

    async def blind_once(d, p):
        calls["n"] += 1
        return None if calls["n"] == 1 else await real(d, p)

    monkeypatch.setattr(stock_service, "_find_stock_row", blind_once)
    second = await stock_service._ensure_stock_row(db, product)
    assert second.id == first.id
    live = (await db.execute(sa.select(sa.func.count()).select_from(ProductStock).where(ProductStock.deleted_at.is_(None)))).scalar()
    assert live == 1
    db.add(make(ProductStock, product_id=product.id, product_name_tally="dup"))
    with pytest.raises(sa.exc.IntegrityError):
        await db.flush()
    await db.rollback()


async def test_old_stock_rows_without_product_id_are_adopted(db):
    product = await real_product(db, await seed_stock(db))
    old = make(ProductStock, product_name_tally="sensor a", product_id=None, mumbai=4.0)
    db.add(old)
    await db.flush()
    row = await stock_service._ensure_stock_row(db, product)
    assert row.id == old.id and row.product_id == product.id


# ------------------------------------------------------------------------------------------------ stock adjustments
async def test_adjustment_in_and_out_change_exactly_the_recorded_quantity(client, db):
    product = await seed_stock(db)
    r = await client.post("/api/v1/inventory/stock-adjustment", json=adj_body(qty=5, type_="Stock IN"))
    assert r.status_code == 201, r.text
    assert (await stock_of(db, product)).mumbai == 5 and (await stock_of(db, product)).total_qty == 5
    assert r.json()["data"]["created_by"] == "warehouse1"
    r = await client.post("/api/v1/inventory/stock-adjustment", json=adj_body(qty=3, type_="Stock OUT"))
    assert r.status_code == 201
    row = await stock_of(db, product)
    assert row.mumbai == 2 and row.total_qty == 2


async def test_stock_out_beyond_available_is_refused_not_silently_clamped(client, db):
    product = await seed_stock(db, mumbai=2.0)
    r = await client.post("/api/v1/inventory/stock-adjustment", json=adj_body(qty=5, type_="Stock OUT"))
    assert r.status_code == 409 and "cannot go negative" in r.text
    assert (await stock_of(db, product)).mumbai == 2                                   # unchanged (it used to floor at 0)
    listed = (await client.get("/api/v1/inventory/stock-adjustment")).json()["data"]
    assert listed["total"] == 0                                                         # and nothing was recorded either


async def test_adjustment_on_transit_warehouse_changes_transit_not_physical(client, db):
    product = await seed_stock(db, mumbai=10.0)
    r = await client.post("/api/v1/inventory/stock-adjustment", json=adj_body(qty=4, type_="Stock IN", warehouse="Mumbai Transit"))
    assert r.status_code == 201
    row = await stock_of(db, product)
    assert row.mumbai == 10 and row.mumbai_transit == 4 and row.total_qty == 14        # used to be added to the PHYSICAL column
    r = await client.post("/api/v1/inventory/stock-adjustment", json=adj_body(qty=9, type_="Stock OUT", warehouse="Mumbai Transit"))
    assert r.status_code == 201 and (await stock_of(db, product)).mumbai_transit == -5  # transit may go negative (spec)


async def test_adjustment_rejects_unknown_warehouse_product_and_date_without_side_effects(client, db):
    product = await seed_stock(db, mumbai=2.0)
    assert (await client.post("/api/v1/inventory/stock-adjustment", json=adj_body(warehouse="Pune"))).status_code == 400
    assert (await client.post("/api/v1/inventory/stock-adjustment", json=adj_body(name="No Such Product"))).status_code == 400
    assert (await client.post("/api/v1/inventory/stock-adjustment", json=adj_body(date="not-a-date"))).status_code in (400, 422)
    assert (await client.post("/api/v1/inventory/stock-adjustment", json=adj_body(type_="Sideways"))).status_code == 400
    assert (await stock_of(db, product)).mumbai == 2
    assert (await client.get("/api/v1/inventory/stock-adjustment")).json()["data"]["total"] == 0


async def test_delete_adjustment_reverses_stock_and_refuses_when_goods_were_used(client, db):
    product = await seed_stock(db)
    a = (await client.post("/api/v1/inventory/stock-adjustment", json=adj_body(qty=5, type_="Stock IN"))).json()["data"]
    assert (await stock_of(db, product)).mumbai == 5
    assert (await client.delete(f"/api/v1/inventory/stock-adjustment/{a['id']}")).status_code == 200
    assert (await stock_of(db, product)).mumbai == 0 and (await stock_of(db, product)).total_qty == 0
    assert (await client.get("/api/v1/inventory/stock-adjustment")).json()["data"]["total"] == 0
    # IN then OUT: the IN can no longer be undone (it would make the physical stock negative)
    a_in = (await client.post("/api/v1/inventory/stock-adjustment", json=adj_body(qty=5, type_="Stock IN"))).json()["data"]
    await client.post("/api/v1/inventory/stock-adjustment", json=adj_body(qty=4, type_="Stock OUT"))
    refused = await client.delete(f"/api/v1/inventory/stock-adjustment/{a_in['id']}")
    assert refused.status_code == 409 and (await stock_of(db, product)).mumbai == 1
    # deleting an OUT puts the goods back
    outs = [i for i in (await client.get("/api/v1/inventory/stock-adjustment")).json()["data"]["items"] if i["type"] == "Stock OUT"]
    assert (await client.delete(f"/api/v1/inventory/stock-adjustment/{outs[0]['id']}")).status_code == 200
    assert (await stock_of(db, product)).mumbai == 5
    assert (await client.delete(f"/api/v1/inventory/stock-adjustment/{uuid.uuid4()}")).status_code == 404


async def test_adjustment_numbers_are_unique_and_sequential_and_list_filters_work(client, db):
    await seed_stock(db)
    nos = []
    for date in ("10-09-2026", "05-10-2026", "16-10-2026"):
        nos.append((await client.post("/api/v1/inventory/stock-adjustment", json=adj_body(qty=1, date=date))).json()["data"]["adjustment_no"])
    assert nos == ["493", "494", "495"]
    dup = await client.post("/api/v1/inventory/stock-adjustment", json=adj_body(qty=1, adjustment_no="494"))
    assert dup.status_code == 409
    get = lambda **p: client.get("/api/v1/inventory/stock-adjustment", params=p)
    dates = lambda r: [i["adjustment_date"] for i in r.json()["data"]["items"]]
    assert dates(await get()) == ["16-10-2026", "05-10-2026", "10-09-2026"]                 # newest first, by real date
    assert dates(await get(date_range="10/01/2026 - 10/31/2026")) == ["16-10-2026", "05-10-2026"]
    assert dates(await get(date_range="09/01/2026 - 09/30/2026")) == ["10-09-2026"]
    assert dates(await get(date_range="01/01/2020 - 01/31/2020")) == []
    assert dates(await get(type="Stock OUT")) == []
    assert len(dates(await get(search="Sensor A"))) == 3 and dates(await get(search="no-match-xyz")) == []
    assert (await get(limit=2)).json()["data"]["total"] == 3


# ------------------------------------------------------------------------------------------------ re-order list
async def test_reorder_list_has_no_sample_rows_and_no_100_product_cap(client, db):
    mumbai = await add_warehouse(db, "Mumbai")
    for i in range(130):
        await add_product(db, f"Item {i:03d}", product_code=f"IT-{i:03d}")
    await db.commit()
    d = (await client.get("/api/v1/inventory/product-reorder", params={"limit": 500})).json()["data"]
    assert d["total"] == 130 and len(d["items"]) == 130
    assert not any(i["product_name_tally"].startswith(("Limit Switch", "Sensor (Banding)")) for i in d["items"])
    page2 = (await client.get("/api/v1/inventory/product-reorder", params={"limit": 50, "skip": 100})).json()["data"]
    assert len(page2["items"]) == 30 and page2["total"] == 130


async def test_reorder_shortfall_filters_update_and_unknown_product(client, db):
    product = await seed_stock(db, mumbai=3.0)
    ok = await client.patch(f"/api/v1/inventory/product-reorder/{product.id}", json={"reorder_level": 10, "minimum_order_quantity": 8})
    assert ok.status_code == 200
    item = (await client.get("/api/v1/inventory/product-reorder")).json()["data"]["items"][0]
    assert item["reorder_level"] == 10 and item["short_fall"] == 7 and item["order_to_be_place"] == 8 and item["total_qty"] == 3
    assert (await client.get("/api/v1/inventory/product-reorder", params={"shortfall": "Greater Than 0"})).json()["data"]["total"] == 1
    assert (await client.get("/api/v1/inventory/product-reorder", params={"shortfall": "0"})).json()["data"]["total"] == 0
    assert (await client.patch(f"/api/v1/inventory/product-reorder/{uuid.uuid4()}", json={"reorder_level": 1})).status_code == 404
    assert (await client.patch(f"/api/v1/inventory/product-reorder/{product.id}", json={"reorder_level": -1})).status_code in (400, 422)


# ------------------------------------------------------------------------------------------------ breakup popups
async def test_breakup_physical_shows_only_open_bookings_of_that_exact_product_and_warehouse(client, db):
    from app.sales.models import SaleOrder, SaleOrderItem

    await seed_stock(db)
    await add_warehouse(db, "Ahmedabad")
    rows = [("SO-1", "pending", "Mumbai", "Sensor A", 2), ("SO-2", "gatepass_created", "Mumbai", "Sensor A", 3),
            ("SO-3", "dispatched", "Mumbai", "Sensor A", 4), ("SO-4", "cancelled", "Mumbai", "Sensor A", 5),
            ("SO-5", "pending", "Ahmedabad", "Sensor A", 6), ("SO-6", "pending", "Mumbai", "Sensor A Plus", 7)]
    for no, st, wh, prod, qty in rows:
        so = make(SaleOrder, order_no=no, status=st, warehouse=wh, company_name="Acme")
        db.add(so)
        await db.flush()
        db.add(make(SaleOrderItem, order_id=so.id, product_name=prod, quantity=qty))
    await db.commit()
    d = (await client.get("/api/v1/inventory/product-stock/breakup", params={"product_name": "Sensor A", "warehouse": "Mumbai", "type": "physical"})).json()["data"]
    assert sorted(i["order_no"] for i in d["items"]) == ["SO-1", "SO-2"]          # not dispatched / cancelled, not other city, not 'Sensor A Plus'
    assert all("unit_price" not in i for i in d["items"])


async def test_breakup_transit_and_ordered_show_only_pending_confirmed_consignments_of_that_exact_warehouse(client, db):
    from app.purchase.models import ImportPurchase, ImportPurchaseItem

    await seed_stock(db)
    rows = [("EXP-1", "pending", "Mumbai Transit", 5), ("EXP-2", "confirmed", "Mumbai Transit", 7), ("EXP-3", "received", "Mumbai Transit", 9),
            ("EXP-4", "cancelled", "Mumbai Transit", 11), ("EXP-5", "pending", "Mumbai Ordered", 13), ("EXP-6", "pending", "Mumbai", 15)]
    for no, st, wh, qty in rows:
        ip = make(ImportPurchase, consignment_no=no, status=st, warehouse=wh, supplier_name="Yinglima")
        db.add(ip)
        await db.flush()
        db.add(make(ImportPurchaseItem, purchase_id=ip.id, product_name="Sensor A", quantity=qty))
    await db.commit()
    get = lambda t: client.get("/api/v1/inventory/product-stock/breakup", params={"product_name": "Sensor A", "warehouse": "Mumbai", "type": t})
    transit = (await get("transit")).json()["data"]["items"]
    ordered = (await get("ordered")).json()["data"]["items"]
    assert sorted(i["consignment_no"] for i in transit) == ["EXP-1", "EXP-2"] and sum(i["quantity"] for i in transit) == 12
    assert [i["consignment_no"] for i in ordered] == ["EXP-5"]
    assert (await client.get("/api/v1/inventory/product-stock/breakup", params={"product_name": "x", "warehouse": "Mumbai", "type": "weird"})).status_code == 400


# ------------------------------------------------------------------------------------------------ product delete rule
async def test_product_delete_blocked_by_any_non_zero_warehouse_balance(db):
    from types import SimpleNamespace

    from app.core.exceptions import BadRequestException
    from app.masters.products.service import ProductService

    product = await real_product(db, await seed_stock(db))
    svc = ProductService.__new__(ProductService)
    svc.repository = SimpleNamespace(session=db)
    row = await stock_service._ensure_stock_row(db, product)
    await svc._check_zero_stock_or_raise(product)                                   # all zero -> allowed
    for column in stock_service.WAREHOUSE_COLUMNS:                                  # incl. the ORDERED warehouses (was ignored)
        for value in (3.0, -2.0):                                                   # and negative is "not zero" too (was ignored)
            setattr(row, column, value)
            with pytest.raises(BadRequestException, match="Stock exists"):
                await svc._check_zero_stock_or_raise(product)
        setattr(row, column, 0.0)
    await svc._check_zero_stock_or_raise(product)


async def test_product_delete_check_looks_at_the_right_product_only_and_never_fails_open(db):
    from types import SimpleNamespace

    from app.core.exceptions import BadRequestException
    from app.masters.products.service import ProductService

    a = await real_product(db, await seed_stock(db))
    b = await add_product(db, "Other Product")
    (await stock_service._ensure_stock_row(db, a)).mumbai = 5.0
    svc = ProductService.__new__(ProductService)
    svc.repository = SimpleNamespace(session=db)
    await svc._check_zero_stock_or_raise(b)                                          # A's stock must not block B
    db.add(make(ProductStock, product_id=None, product_name_tally="other product", mumbai=2.0))   # an old row, found by exact name
    await db.flush()
    with pytest.raises(BadRequestException, match="Stock exists"):
        await svc._check_zero_stock_or_raise(b)
    broken = ProductService.__new__(ProductService)
    broken.repository = SimpleNamespace(session=None)                                # the check itself cannot run
    with pytest.raises(Exception):
        await broken._check_zero_stock_or_raise(a)                                   # -> an error, not a silent "no stock"


# ------------------------------------------------------------------------------------------------ SO: transit -> physical
async def test_sale_order_moved_from_transit_to_physical_needs_stock_there(db, monkeypatch):
    import importlib.util
    import pathlib

    from app.core.exceptions import ConflictException
    from app.sales.models import SaleOrder, SaleOrderItem
    from app.sales.schemas import SaleOrderUpdate
    from app.sales.service import SaleService

    spec = importlib.util.spec_from_file_location("wfm", pathlib.Path("alembic/versions/s1b2c3d4e5fa_sale_order_workflow.py"))
    wfm = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(wfm)

    info = await seed_stock(db, mumbai=1.0, mumbai_transit=-5.0)                     # 5 booked on the transit warehouse, 1 on the shelf
    so = make(SaleOrder, order_no="SO-9", status="pending", warehouse="Mumbai Transit", stock_applied=True)
    db.add(so)
    await db.flush()
    order_id = so.id
    db.add(make(SaleOrderItem, order_id=order_id, product_name="Sensor A", quantity=5.0, is_additional_charge=False))
    await db.commit()
    service = SaleService(db)

    async def rules():
        return wfm.RULES

    monkeypatch.setattr(service, "load_status_rules", rules)
    with pytest.raises(ConflictException, match="cannot go negative"):
        await service.update_order(order_id, SaleOrderUpdate(warehouse="Mumbai"))
    await db.rollback()
    row = await stock_of(db, info)
    assert row.mumbai == 1 and row.mumbai_transit == -5                              # nothing moved

    row_obj = (await db.execute(sa.select(ProductStock).where(ProductStock.product_id == info.id))).scalars().one()
    row_obj.mumbai = 10.0
    await db.commit()
    await service.update_order(order_id, SaleOrderUpdate(warehouse="Mumbai"))
    row = await stock_of(db, info)
    assert row.mumbai == 5 and row.mumbai_transit == 0                               # taken from the shelf, transit booking released


# ------------------------------------------------------------------------------------------------ who may do what
async def test_inventory_api_needs_a_login_and_product_view(db):
    app = create_application()

    async def _db():
        yield db

    app.dependency_overrides[get_db_session] = _db
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as anon:
        for path in ("/api/v1/inventory/product-stock", "/api/v1/inventory/stock-adjustment", "/api/v1/inventory/product-reorder"):
            assert (await anon.get(path)).status_code in (401, 403), path                  # used to be open to everyone
        assert (await anon.post("/api/v1/inventory/stock-adjustment", json=adj_body())).status_code in (401, 403)
    nobody = CurrentUser(id=uuid.uuid4(), username="nobody", permissions=set())
    app.dependency_overrides[get_current_user] = lambda: nobody
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        assert (await c.get("/api/v1/inventory/product-stock")).status_code == 403
    viewer = CurrentUser(id=uuid.uuid4(), username="viewer", permissions={"product.view"})
    app.dependency_overrides[get_current_user] = lambda: viewer
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        assert (await c.get("/api/v1/inventory/product-stock")).status_code == 200


async def test_product_bulk_delete_needs_the_bulk_actions_permission_as_well(db):
    app = create_application()

    async def _db():
        yield db

    app.dependency_overrides[get_db_session] = _db
    body = {"product_ids": [str(uuid.uuid4())]}
    for perms, allowed in (({"product.delete"}, False), ({"product.bulk_action"}, False), ({"product.delete", "product.bulk_action"}, True)):
        user = CurrentUser(id=uuid.uuid4(), username="acct", permissions=perms)
        app.dependency_overrides[get_current_user] = lambda u=user: u
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
            code = (await c.post("/api/v1/masters/products/bulk-delete", json=body)).status_code
        assert (code != 403) == allowed, (perms, code)


# ------------------------------------------------------------------------------------------------ product bulk import duplicates
async def test_product_import_detects_real_duplicates_but_not_wildcard_look_alikes(client, db):
    from app.masters.brands.models import Brand
    from app.masters.product_categories.models import ProductCategory
    from app.masters.product_sub_categories.models import ProductSubCategory
    from app.masters.uom.models import UnitOfMeasurement

    cat = make(ProductCategory, name="Spares", code="CAT")
    uom = make(UnitOfMeasurement, name="Nos", code="NOS", short_name="Nos")
    db.add_all([cat, uom, make(Brand, name="Omron", code="BR")])
    await db.flush()
    db.add(make(ProductSubCategory, name="Belts", code="SUB", category_id=cat.id))
    await add_product(db, "Existing Item", product_code="EX-1")
    gone = await add_product(db, "Old Deleted", product_code="OD-1")
    gone.deleted_at = datetime.datetime.now(datetime.timezone.utc)
    await db.commit()

    head = "Product Name (As Per Tally),Product Code,Category,Sub Category,Brand,UOM,Pack. Qty,Pack. Gross Weight,Length (cm),Width (cm),Height (cm)"
    rows = [
        "Teflon Belt A,TB-1,Spares,Belts,Omron,Nos,1,1,10,10,10",      # new
        "teflon belt a,TB-2,Spares,Belts,Omron,Nos,1,1,10,10,10",      # same name inside the file
        "50% Seal,S-1,Spares,Belts,Omron,Nos,1,1,10,10,10",            # new
        "50X Seal,S-2,Spares,Belts,Omron,Nos,1,1,10,10,10",            # NOT a duplicate of '50% Seal' (the % is not a wildcard)
        "EXISTING ITEM,EX-9,Spares,Belts,Omron,Nos,1,1,10,10,10",      # duplicate of a product already in the master
        "Fresh Code Dup,EX-1,Spares,Belts,Omron,Nos,1,1,10,10,10",     # duplicate product code
        "Old Deleted,OD-9,Spares,Belts,Omron,Nos,1,1,10,10,10",        # a deleted product does not block the name
    ]
    csv_bytes = (head + "\n" + "\n".join(rows) + "\n").encode()
    r = await client.post("/api/v1/masters/products/import", files={"file": ("products.csv", csv_bytes, "text/csv")})
    assert r.status_code == 200, r.text
    data = r.json()["data"]
    created = (await db.execute(sa.select(Product.product_name_tally).where(Product.deleted_at.is_(None)))).scalars().all()
    assert sorted(created) == sorted(["Existing Item", "Teflon Belt A", "50% Seal", "50X Seal", "Old Deleted"]), (created, data)
    assert data["created"] == 4 and data["failed"] == 3, data


# ------------------------------------------------------------------------------------------------ direct calls (as older tests / scripts do)
async def test_endpoint_functions_work_when_called_directly_without_optional_arguments(db):
    """Called directly, an omitted optional parameter is a FastAPI Query object, not None -- must be treated as 'not given'."""
    from unittest.mock import MagicMock

    from app.inventory.routes import list_product_reorder, list_product_stock, list_stock_adjustments

    await seed_stock(db, mumbai=2.0)
    req = MagicMock()
    req.state.request_id = "t"
    stock = await list_product_stock(request=req, category="All", sub_category="All", brand="All", negative_stock="No", skip=0, limit=10, db=db)
    assert stock["success"] is True and stock["data"]["total"] == 1
    adj = await list_stock_adjustments(request=req, skip=0, limit=10, db=db)
    assert adj["data"]["total"] == 0
    reorder = await list_product_reorder(request=req, skip=0, limit=10, db=db)
    assert reorder["data"]["total"] == 1


async def test_reorder_joins_product_masters_and_scopes_warehouse_shortfall(client, db):
    """Products without a ProductStock row still get Category/Sub-Category/Brand/HSN/UOM from masters,
    and warehouse-scoped shortfall evaluates against that branch's pipeline rather than masking with other branches."""
    from app.masters.brands.models import Brand
    from app.masters.product_categories.models import ProductCategory
    from app.masters.product_sub_categories.models import ProductSubCategory
    from app.masters.taxes.models import Tax
    from app.masters.uom.models import UnitOfMeasurement

    cat = make(ProductCategory, name="Machines", code="MC")
    brand = make(Brand, name="Inhyma Pack", code="IP")
    uom = make(UnitOfMeasurement, name="Set", code="SET", short_name="SET")
    tax = make(Tax, hsn_number="84224000", gst_percent=18.0, import_duty_percent=7.5)
    db.add_all([cat, brand, uom, tax])
    await db.flush()
    sub = make(ProductSubCategory, name="Band Sealer", code="BS", category_id=cat.id)
    db.add(sub)
    await db.flush()

    # Product with NO ProductStock row yet
    no_stock_prod = await add_product(
        db,
        "Air Timer (PFS)",
        product_code="AT-PFS-01",
        category_id=cat.id,
        sub_category_id=sub.id,
        brand_id=brand.id,
        uom_id=uom.id,
        hsn_id=tax.id,
        minimum_price=14500.0,
    )
    # Product with Indore=41, Mumbai=0
    indore_prod = await add_product(
        db,
        "Hand Pallet Lift 3T 550 Mm X 1150mm YL",
        product_code="HPL-3T",
        category_id=cat.id,
        sub_category_id=sub.id,
        brand_id=brand.id,
        uom_id=uom.id,
        hsn_id=tax.id,
    )
    indore_row = await stock_service._ensure_stock_row(db, indore_prod)
    indore_row.indore = 41.0
    stock_service.recompute_total(indore_row)
    await db.commit()

    # 1. Master fields are joined even without ProductStock
    res = (await client.get("/api/v1/inventory/product-reorder", params={"category": "Machines", "brand": "Inhyma Pack"})).json()["data"]
    assert res["total"] == 2
    by_name = {i["product_name_tally"]: i for i in res["items"]}
    air = by_name["Air Timer (PFS)"]
    assert air["category"] == "Machines" and air["sub_category"] == "Band Sealer" and air["brand"] == "Inhyma Pack"
    assert air["hsn_code"] == "84224000" and air["gst_percent"] == 18.0 and air["import_duty_percent"] == 7.5 and air["uom"] == "SET"

    # 2. Branch-scoped threshold in Mumbai triggers shortfall even though Indore has 41 units
    patch_mum = await client.patch(
        f"/api/v1/inventory/product-reorder/{indore_prod.id}",
        json={"reorder_level": 5, "minimum_order_quantity": 2, "warehouse": "Mumbai"},
    )
    assert patch_mum.status_code == 200
    mum_items = {
        i["product_name_tally"]: i
        for i in (await client.get("/api/v1/inventory/product-reorder", params={"warehouse": "Mumbai"})).json()["data"]["items"]
    }
    hpl_mum = mum_items["Hand Pallet Lift 3T 550 Mm X 1150mm YL"]
    assert hpl_mum["total_qty"] == 41.0
    assert hpl_mum["reorder_level"] == 5.0 and hpl_mum["short_fall"] == 5.0 and hpl_mum["order_to_be_place"] == 5.0

    # Ahmedabad remains unaffected by Mumbai's branch threshold
    ahm_items = {
        i["product_name_tally"]: i
        for i in (await client.get("/api/v1/inventory/product-reorder", params={"warehouse": "Ahmedabad"})).json()["data"]["items"]
    }
    assert ahm_items["Hand Pallet Lift 3T 550 Mm X 1150mm YL"]["reorder_level"] == 0.0
    assert ahm_items["Hand Pallet Lift 3T 550 Mm X 1150mm YL"]["short_fall"] == 0.0


async def test_reorder_breakup_flags_zero_stock_open_so_and_transit_transfer_fifo(client, db):
    """(i) flag appears when mumbai=0 has an open SO booking; transit breakup includes in-transit StockTransfers and FIFO bookings."""
    from app.inventory.models import StockTransfer, StockTransferLineItem
    from app.purchase.models import ImportPurchase, ImportPurchaseItem
    from app.sales.models import SaleOrder, SaleOrderItem

    await seed_stock(db, mumbai=0.0, mumbai_transit=28.0)

    # Open SO in Mumbai (physical stock already deducted down to 0)
    so_phys = make(SaleOrder, order_no="SO-MH/26-27/0901", status="acc_confirmed", warehouse="Mumbai", company_name="Premier Pack")
    db.add(so_phys)
    await db.flush()
    db.add(make(SaleOrderItem, order_id=so_phys.id, product_name="Sensor A", quantity=2))

    # Incoming container (20) + active Stock Transfer (10) - open transit SO booking (2) = 28 net
    ip = make(ImportPurchase, consignment_no="EXP-88", status="confirmed", warehouse="Mumbai Transit", supplier_name="Yinglima")
    db.add(ip)
    await db.flush()
    db.add(make(ImportPurchaseItem, purchase_id=ip.id, product_name="Sensor A", quantity=20))

    trf = make(
        StockTransfer,
        sr_no=1,
        transfer_no="TRF-2026-001",
        transfer_date="28-10-2026",
        from_warehouse="Indore",
        to_warehouse="Mumbai Transit",
        status="Pending",
    )
    db.add(trf)
    await db.flush()
    db.add(make(StockTransferLineItem, transfer_id=trf.id, product_name="Sensor A", quantity=10))

    so_tr = make(SaleOrder, order_no="SO-MH/26-27/0902", status="sales_confirmed", warehouse="Mumbai Transit", company_name="Alpha Foods")
    db.add(so_tr)
    await db.flush()
    db.add(make(SaleOrderItem, order_id=so_tr.id, product_name="Sensor A", quantity=2))
    await db.commit()

    reorder_item = (await client.get("/api/v1/inventory/product-reorder")).json()["data"]["items"][0]
    assert "mumbai" in reorder_item["breakup_flags"]
    assert "mumbai_transit" in reorder_item["breakup_flags"]

    phys_b = (
        await client.get("/api/v1/inventory/product-stock/breakup", params={"product_name": "Sensor A", "warehouse": "Mumbai", "type": "physical"})
    ).json()["data"]
    assert len(phys_b["items"]) == 1
    assert phys_b["items"][0]["order_id"] == str(so_phys.id)
    assert phys_b["items"][0]["status"] == "Acc. Confirmed"
    assert "unit_price" not in phys_b["items"][0]

    tr_b = (
        await client.get("/api/v1/inventory/product-stock/breakup", params={"product_name": "Sensor A", "warehouse": "Mumbai", "type": "transit"})
    ).json()["data"]
    assert [i["consignment_no"] for i in tr_b["items"]] == ["EXP-88", "TRF-2026-001"]
    assert tr_b["items"][0]["quantity"] == 18.0 and tr_b["items"][0]["booked_quantity"] == 2.0  # FIFO deducted from 1st container
    assert tr_b["items"][1]["quantity"] == 10.0
    assert len(tr_b["booked_orders"]) == 1 and tr_b["booked_orders"][0]["order_no"] == "SO-MH/26-27/0902"
