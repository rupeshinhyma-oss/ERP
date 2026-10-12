"""Local and Import Purchases: validation, landing cost, stock effects and the DB-driven workflow rules.

Runs the real routers against in-memory SQLite. The workflow rules come from the same seed
migration production uses, so these tests also prove that configuration is sufficient.
"""

from __future__ import annotations

import importlib
import importlib.util
import uuid
from datetime import date, timedelta
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


def _import_all_models() -> None:
    root = Path(__file__).resolve().parents[1]
    for path in sorted((root / "app").rglob("models.py")):
        importlib.import_module(".".join(path.relative_to(root).with_suffix("").parts))


_import_all_models()

from app.inventory.models import ProductStock  # noqa: E402
from app.masters.billing_companies.models import BillingCompany  # noqa: E402
from app.masters.brands.models import Brand  # noqa: E402
from app.masters.cities.models import City  # noqa: E402
from app.masters.states.models import State  # noqa: E402
from app.masters.option_lists.models import OptionList  # noqa: E402
from app.masters.product_categories.models import ProductCategory  # noqa: E402
from app.masters.product_sub_categories.models import ProductSubCategory  # noqa: E402
from app.masters.products.models import Product, ProductDimensionRow  # noqa: E402
from app.masters.taxes.models import Tax  # noqa: E402
from app.masters.uom.models import UnitOfMeasurement  # noqa: E402
from app.masters.warehouses.models import Warehouse  # noqa: E402
from app.purchase import models as pm  # noqa: E402
from app.purchase.routes import router as purchase_router  # noqa: E402
from app.suppliers.models import Supplier, SupplierEmail  # noqa: E402

VERSIONS = Path(__file__).resolve().parents[1] / "alembic" / "versions"
TABLES = [
    pm.LocalPurchase.__table__, pm.LocalPurchaseItem.__table__, pm.ImportPurchase.__table__, pm.ImportPurchaseItem.__table__,
    ProductStock.__table__, OptionList.__table__, Product.__table__, Tax.__table__, UnitOfMeasurement.__table__,
    Warehouse.__table__, Supplier.__table__, ProductDimensionRow.__table__, Brand.__table__, ProductCategory.__table__,
    ProductSubCategory.__table__, BillingCompany.__table__, City.__table__, State.__table__, SupplierEmail.__table__,
]

NORMAL = CurrentUser(id=uuid.uuid4(), username="marketing")
ACCOUNTS = CurrentUser(id=uuid.uuid4(), username="accounts", permissions={"localpurchase.update", "localpurchase.confirm"})
ADMIN = CurrentUser(id=uuid.uuid4(), username="boss", is_super_admin=True)

TODAY = date.today()
FUTURE = (TODAY + timedelta(days=20)).strftime("%d-%m-%Y")
PAST = (TODAY - timedelta(days=5)).strftime("%d-%m-%Y")


def _migrate(sync_conn, filename: str) -> None:
    spec = importlib.util.spec_from_file_location(filename[:-3], VERSIONS / filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    with Operations.context(MigrationContext.configure(sync_conn)):
        module.upgrade()


@pytest_asyncio.fixture
async def factory():
    engine = create_async_engine("sqlite+aiosqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
    async with engine.begin() as conn:
        await conn.run_sync(lambda c: Base.metadata.create_all(c, tables=TABLES))
        await conn.run_sync(_migrate, "m1a2b3c4d5ea_seed_purchase_rules.py")
    maker = async_sessionmaker(engine, expire_on_commit=False)
    async with maker() as s:
        uom = UnitOfMeasurement(code="NOS", name="Numbers", short_name="Nos")
        tax = Tax(hsn_number="84223000", gst_percent=18, import_duty_percent=10)
        s.add_all([uom, tax])
        await s.flush()
        s.add(BillingCompany(name="Inhyma Solutions LLP (M)", email="accounts@inhyma.test", mobile="9000000001", address="4th Floor, Wagle Estate",
                             city="Thane", zip_code="400604", gst_no="27AAKFI9869H1ZL", so_prefix="SO", pi_prefix="PI",
                             bank_name="HDFC"))
        country = uuid.uuid4()
        state = State(name="Gujarat", country_id=country)
        s.add(state)
        await s.flush()
        city = City(name="Ahmedabad", state_id=state.id, country_id=country)
        s.add(city)
        await s.flush()
        mumbai = Warehouse(name="Mumbai", address="x", billing_company="Inhyma Solutions LLP (M)")
        s.add(mumbai)
        await s.flush()
        s.add_all([
            Warehouse(name="Ahmedabad", address="x", billing_company="Inhyma"),
            Warehouse(name="Mumbai Ordered", address="x", billing_company="Inhyma", main_warehouse_id=mumbai.id),
        ])
        cat = uuid.uuid4()
        s.add_all([
            Product(product_name="Band Sealer", product_name_tally="Band Sealer", category_id=cat, uom_id=uom.id, hsn_id=tax.id,
                    packaging_unit_cbm=0.5, packaging_quantity=1),
            Product(product_name="Teflon Belt", product_name_tally="Teflon Belt", category_id=cat, uom_id=uom.id,
                    packaging_unit_cbm=0.0, packaging_quantity=1),
        ])
        for name in ("Yinglima Packaging Machinery Co., Ltd.", "Local Traders"):
            sup = Supplier(company_name=name, country_id=country, state_id=state.id, city_id=city.id, tax_id_number=name[:3].upper(),
                           address="6/7 Ripal Complex", town="Bodakdev", contact_calling_number="8799513908")
            s.add(sup)
            await s.flush()
            s.add(SupplierEmail(supplier_id=sup.id, email=f"{name.split()[0].lower()}@supplier.test"))
        await s.commit()
    yield maker
    await engine.dispose()


def _client(factory, user):
    app = FastAPI()
    register_exception_handlers(app)
    app.include_router(purchase_router)

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


async def _stock(factory, product: str = "Band Sealer") -> dict:
    async with factory() as s:
        row = (await s.execute(sa.select(ProductStock).where(ProductStock.product_name_tally == product))).scalars().first()
        if row is None:
            return {}
        return {c: getattr(row, c) for c in ("mumbai", "ahmedabad", "mumbai_ordered", "total_qty")}


async def _set_stock(factory, product: str, **cols) -> None:
    async with factory() as s:
        row = (await s.execute(sa.select(ProductStock).where(ProductStock.product_name_tally == product))).scalars().first()
        for k, v in cols.items():
            setattr(row, k, v)
        await s.commit()


# ------------------------------------------------------------------------------------ local
def _local(**over):
    body = {
        "supplier_name": "Local Traders", "warehouse": "Mumbai", "invoice_no": "INV-1", "invoice_date": PAST,
        "invoice_value_ex_gst": 10000, "invoice_value_inc_gst": 11800,
        "packing_forwarding": 200, "transport": 300, "offloading": 500, "remarks": "first lot",
        "items": [{"product_name": "Band Sealer", "quantity": 10, "unit_rate": 100}, {"product_name": "Teflon Belt", "quantity": 36, "unit_rate": 250}],
    }
    body.update(over)
    return body


async def _new_local(client, **over):
    res = await client.post("/purchase/local-orders", json=_local(**over))
    assert res.status_code == 201, res.text
    return res.json()["data"]


@pytest.mark.asyncio
async def test_local_create_prices_lines_and_adds_no_stock_until_confirmed(factory):
    async with _client(factory, NORMAL) as c:
        po = await _new_local(c)
    assert po["status"] == "pending" and po["created_by"] == "marketing" and po["stock_applied"] is False
    assert (po["total_expenses"], po["loading_percent"]) == (1000.0, 10.0)
    roller = po["items"][0]
    assert (roller["item_total"], roller["expense_per_unit"], roller["unit_landing_value"], roller["uom"]) == (1000.0, 10.0, 110.0, "Nos")
    assert po["invoice_date"] == PAST                      # dates are exchanged as DD-MM-YYYY
    assert await _stock(factory) == {}


@pytest.mark.asyncio
@pytest.mark.parametrize("override,fragment", [
    ({"warehouse": "Mumbai Ordered"}, "physical warehouse"),
    ({"warehouse": "Nowhere"}, "does not exist"),
    ({"supplier_name": "Ghost Co"}, "Supplier master"),
    ({"items": [{"product_name": "Ghost Part", "quantity": 1, "unit_rate": 1}]}, "Product Master"),
])
async def test_local_validates_against_the_masters(factory, override, fragment):
    async with _client(factory, NORMAL) as c:
        res = await c.post("/purchase/local-orders", json=_local(**override))
    assert res.status_code == 400 and fragment in res.text


@pytest.mark.asyncio
async def test_local_duplicate_invoice_for_a_supplier_is_refused(factory):
    async with _client(factory, NORMAL) as c:
        await _new_local(c)
        again = await c.post("/purchase/local-orders", json=_local())
        other_supplier = await c.post("/purchase/local-orders", json=_local(supplier_name="Yinglima"))
    assert again.status_code == 409 and "already recorded" in again.text
    assert other_supplier.status_code == 201


@pytest.mark.asyncio
async def test_local_confirm_needs_permission_and_then_adds_stock(factory):
    async with _client(factory, NORMAL) as user, _client(factory, ACCOUNTS) as accounts:
        po = await _new_local(user)
        url = f"/purchase/local-orders/{po['id']}/status"
        assert (await user.patch(url, json={"status": "confirmed"})).status_code == 403

        done = (await accounts.patch(url, json={"status": "confirmed"})).json()["data"]
    assert done["status"] == "confirmed" and done["stock_applied"] and done["confirmed_by"] == "accounts"
    assert (await _stock(factory))["mumbai"] == 10.0 and (await _stock(factory, "Teflon Belt"))["mumbai"] == 36.0

    # the stock row was created from the Product Master
    async with factory() as s:
        row = (await s.execute(sa.select(ProductStock).where(ProductStock.product_name_tally == "Band Sealer"))).scalars().first()
    assert (row.hsn_code, row.gst_rate, row.uom) == ("84223000", "18%", "Nos")


@pytest.mark.asyncio
async def test_local_edit_rules(factory):
    async with _client(factory, NORMAL) as user, _client(factory, ACCOUNTS) as accounts, _client(factory, ADMIN) as admin:
        po = await _new_local(user)
        url = f"/purchase/local-orders/{po['id']}"
        edit = _local(remarks="changed", items=[{"product_name": "Band Sealer", "quantity": 4, "unit_rate": 100}], invoice_value_ex_gst=400)
        assert (await user.put(url, json=edit)).status_code == 403          # edit is for accounts / admin
        res = (await accounts.put(url, json=edit)).json()["data"]
        assert res["remarks"] == "changed" and len(res["items"]) == 1 and res["items"][0]["quantity"] == 4

        await accounts.patch(f"{url}/status", json={"status": "confirmed"})
        assert (await admin.put(url, json=edit)).status_code == 409          # nobody edits a confirmed purchase


@pytest.mark.asyncio
async def test_local_delete_rules_and_stock_reversal(factory):
    async with _client(factory, ACCOUNTS) as accounts, _client(factory, ADMIN) as admin:
        pending = await _new_local(accounts)
        assert (await accounts.delete(f"/purchase/local-orders/{pending['id']}")).status_code == 403   # admin only
        assert (await admin.delete(f"/purchase/local-orders/{pending['id']}")).status_code == 200

        confirmed = await _new_local(accounts, invoice_no="INV-2")
        await accounts.patch(f"/purchase/local-orders/{confirmed['id']}/status", json={"status": "confirmed"})
        assert (await _stock(factory))["mumbai"] == 10.0

        # stock already used elsewhere: cannot delete (a physical warehouse cannot go negative)
        await _set_stock(factory, "Band Sealer", mumbai=3.0, total_qty=3.0)
        blocked = await admin.delete(f"/purchase/local-orders/{confirmed['id']}")
        assert blocked.status_code == 409 and "Not enough stock" in blocked.text

        await _set_stock(factory, "Band Sealer", mumbai=10.0, total_qty=10.0)
        assert (await admin.delete(f"/purchase/local-orders/{confirmed['id']}")).status_code == 200
        assert (await _stock(factory))["mumbai"] == 0.0


@pytest.mark.asyncio
async def test_local_list_counts_and_authentication(factory):
    async with _client(factory, ACCOUNTS) as c:
        a = await _new_local(c)
        await _new_local(c, invoice_no="INV-9")
        await c.patch(f"/purchase/local-orders/{a['id']}/status", json={"status": "confirmed"})
        data = (await c.get("/purchase/local-orders")).json()["data"]
        only = (await c.get("/purchase/local-orders", params={"status": "confirmed"})).json()["data"]["items"]
    assert {k: v["count"] for k, v in data["tab_counts"].items()} == {"all": 2, "pending": 1, "confirmed": 1}
    assert [i["id"] for i in only] == [a["id"]]
    async with _client(factory, None) as anon:
        assert (await anon.get("/purchase/local-orders")).status_code in (401, 403)


# ----------------------------------------------------------------------------------- import
def _import(**over):
    body = {
        "consignment_no": "EXP-86", "supplier_name": "Yinglima", "warehouse": "Mumbai Ordered",
        "ordered_date": PAST, "etd_origin_date": FUTURE, "eta_port_date": FUTURE, "expected_arrival_date": FUTURE,
        "conversion_rate": 80, "customs_conversion_rate": 82, "invoice_total_usd": 1000, "total_cbm": 20,
        "total_import_duty": 6000, "freight": 4000, "insurance": 400, "stamp_duty": 100, "shipping_line_charges": 1000,
        "cfs_charges": 1500, "clearing_transport": 2000, "offloading": 500, "misc_charges": 500,
        "items": [
            {"product_name": "Band Sealer", "quantity": 10, "unit_rate_usd": 60},
            {"product_name": "Teflon Belt", "quantity": 20, "unit_rate_usd": 40, "pkg_unit_cbm": 1.5, "pkg_qty": 2},
        ],
    }
    body.update(over)
    return body


async def _new_import(client, **over):
    res = await client.post("/purchase/import-orders", json=_import(**over))
    assert res.status_code == 201, res.text
    return res.json()["data"]


@pytest.mark.asyncio
async def test_import_create_uses_the_spec_formulas_and_adds_stock_immediately(factory):
    async with _client(factory, NORMAL) as c:
        po = await _new_import(c)
    assert (po["invoice_total_inr"], po["total_expenses"], po["loading_percent_vb"], po["loading_amount_per_cbm"]) == (80000.0, 10000.0, 12.5, 500.0)
    assert po["gross_total_landing"] == 96000.0
    sealer, belt = po["items"]
    # duty % and packaging come from the Product Master (Band Sealer: HSN duty 10 %, 0.5 CBM per package of 1)
    assert (sealer["duty_percent"], sealer["pkg_unit_cbm"], sealer["unit_landing_vb"], sealer["unit_landing_cb"]) == (10.0, 0.5, 5892.0, 5542.0)
    assert (belt["pkg_unit_cbm"], belt["unit_landing_vb"], belt["unit_landing_cb"]) == (1.5, 3600.0, 3575.0)
    assert (po["sum_cbm"], po["sum_usd"]) == (20.0, 1400.0)       # table totals may differ from the header (allowed)
    assert po["status"] == "pending" and po["stock_applied"] is True
    assert (await _stock(factory))["mumbai_ordered"] == 10.0
    assert (await _stock(factory, "Teflon Belt"))["mumbai_ordered"] == 20.0


@pytest.mark.asyncio
async def test_import_date_rules_and_duplicates(factory):
    async with _client(factory, NORMAL) as c:
        assert (await c.post("/purchase/import-orders", json=_import(ordered_date=FUTURE))).status_code == 400   # ordered: past only
        res = await c.post("/purchase/import-orders", json=_import(etd_origin_date=PAST))
        assert res.status_code == 400 and "ETD" in res.text                                                  # ETD: not in the past
        await _new_import(c)
        assert (await c.post("/purchase/import-orders", json=_import())).status_code == 409                  # same consignment
        for rate in (0, -1):
            assert (await c.post("/purchase/import-orders", json=_import(conversion_rate=rate))).status_code == 422


@pytest.mark.asyncio
async def test_import_edit_adjusts_stock_by_the_net_change(factory):
    async with _client(factory, NORMAL) as c:
        po = await _new_import(c)
        url = f"/purchase/import-orders/{po['id']}"
        edit = _import(items=[{"product_name": "Band Sealer", "quantity": 25, "unit_rate_usd": 60}])
        res = (await c.put(url, json=edit)).json()["data"]
    assert len(res["items"]) == 1 and res["items"][0]["quantity"] == 25
    assert (await _stock(factory))["mumbai_ordered"] == 25.0                        # 10 -> 25
    assert (await _stock(factory, "Teflon Belt"))["mumbai_ordered"] == 0.0          # removed line gives its 20 back


@pytest.mark.asyncio
async def test_import_negative_stock_rules_and_physical_warehouse_lock(factory):
    async with _client(factory, NORMAL) as c:
        # an ordered warehouse may go negative ...
        po = await _new_import(c)
        await _set_stock(factory, "Band Sealer", mumbai_ordered=2.0, total_qty=2.0)
        shrink = _import(items=[{"product_name": "Band Sealer", "quantity": 1, "unit_rate_usd": 60}])
        assert (await c.put(f"/purchase/import-orders/{po['id']}", json=shrink)).status_code == 200
        assert (await _stock(factory))["mumbai_ordered"] == -7.0

        # ... but received into a physical warehouse it cannot, and the warehouse is then locked
        phys = await _new_import(c, consignment_no="EXP-87", warehouse="Mumbai",
                                 items=[{"product_name": "Teflon Belt", "quantity": 5, "unit_rate_usd": 10}])
        await _set_stock(factory, "Teflon Belt", mumbai=1.0, total_qty=1.0)
        lower = _import(consignment_no="EXP-87", warehouse="Mumbai", items=[{"product_name": "Teflon Belt", "quantity": 2, "unit_rate_usd": 10}])
        blocked = await c.put(f"/purchase/import-orders/{phys['id']}", json=lower)
        assert blocked.status_code == 409 and "Not enough stock" in blocked.text
        moved = _import(consignment_no="EXP-87", warehouse="Ahmedabad", items=[{"product_name": "Teflon Belt", "quantity": 5, "unit_rate_usd": 10}])
        locked = await c.put(f"/purchase/import-orders/{phys['id']}", json=moved)
        assert locked.status_code == 409 and "warehouse cannot be changed" in locked.text


@pytest.mark.asyncio
async def test_import_status_flow_and_who_may_do_what(factory):
    async with _client(factory, NORMAL) as user, _client(factory, ADMIN) as admin:
        po = await _new_import(user)
        url = f"/purchase/import-orders/{po['id']}"
        assert (await user.patch(f"{url}/status", json={"status": "received"})).status_code == 409      # cannot skip Confirm
        c1 = (await user.patch(f"{url}/status", json={"status": "confirmed"})).json()["data"]
        assert c1["confirmed_by"] == "marketing"

        assert (await user.put(url, json=_import())).status_code == 403          # after Confirm only an admin edits
        assert (await admin.put(url, json=_import())).status_code == 200
        assert (await user.delete(url)).status_code == 403                        # after Confirm only an admin deletes

        r = (await user.patch(f"{url}/status", json={"status": "received"})).json()["data"]
        assert r["received_at"]
        assert (await user.patch(f"{url}/status", json={"status": "closed"})).status_code == 403          # close is admin only
        closed = (await admin.patch(f"{url}/status", json={"status": "closed"})).json()["data"]
        assert closed["closed_at"] and closed["status"] == "closed"
        assert (await admin.put(url, json=_import())).status_code == 200         # late expense inward editing is allowed on closed
        assert (await admin.delete(url)).status_code == 409


@pytest.mark.asyncio
async def test_import_delete_reverses_the_stock(factory):
    async with _client(factory, NORMAL) as c:
        po = await _new_import(c)
        assert (await _stock(factory))["mumbai_ordered"] == 10.0
        assert (await c.delete(f"/purchase/import-orders/{po['id']}")).status_code == 200
    assert (await _stock(factory))["mumbai_ordered"] == 0.0
    async with _client(factory, NORMAL) as c:
        assert (await c.get(f"/purchase/import-orders/{po['id']}")).status_code == 404


@pytest.mark.asyncio
async def test_documents_carry_real_supplier_and_buyer_details_from_the_masters(factory):
    async with _client(factory, NORMAL) as c:
        local = await _new_local(c)
        imp = await _new_import(c)
        listed = (await c.get("/purchase/local-orders")).json()["data"]["items"][0]
    assert local["supplier_address"] == "6/7 Ripal Complex, Bodakdev, Ahmedabad, Gujarat"
    assert (local["supplier_email"], local["supplier_phone"], local["supplier_gst"]) == ("local@supplier.test", "8799513908", "LOC")
    assert local["to_name"] == "Inhyma Solutions LLP (M)"            # the billing company of the Mumbai warehouse
    assert (local["to_gst"], local["to_email"], local["to_phone"]) == ("27AAKFI9869H1ZL", "accounts@inhyma.test", "9000000001")
    assert local["to_address"] == "4th Floor, Wagle Estate, Thane, 400604"
    assert listed["supplier_gst"] == "LOC"                            # list rows carry them too
    # 'Mumbai Ordered' has no billing company configured: blank, never made up
    assert imp["to_name"] == "" and imp["to_gst"] == "" and imp["supplier_gst"] == "YIN"


@pytest.mark.asyncio
async def test_import_preview_returns_exactly_what_a_save_would_store(factory):
    """The form's live figures come from the same code as the saved record, so they can never disagree."""
    body = _import()
    preview_body = {k: v for k, v in body.items() if k in {
        "conversion_rate", "customs_conversion_rate", "invoice_total_usd", "total_cbm", "total_import_duty", "freight", "insurance",
        "stamp_duty", "shipping_line_charges", "cfs_charges", "clearing_transport", "offloading", "misc_charges", "items"}}
    async with _client(factory, NORMAL) as c:
        res = await c.post("/purchase/import-orders/preview", json=preview_body)
        assert res.status_code == 200, res.text
        preview = res.json()["data"]
        saved = await _new_import(c)
    assert preview["loading_percent_vb"] == saved["loading_percent_vb"] == 12.5
    assert preview["gross_total_landing"] == saved["gross_total_landing"] == 96000.0
    assert (preview["sum_cbm"], preview["sum_usd"], preview["sum_duty"]) == (saved["sum_cbm"], saved["sum_usd"], saved["sum_duty"])
    for p_item, s_item in zip(preview["items"], saved["items"]):
        for field in ("item_total_cbm", "unit_rate_inr", "unit_import_duty", "exp_per_unit_vb", "exp_per_unit_cb",
                      "unit_landing_vb", "unit_landing_cb", "landing_diff"):
            assert p_item[field] == s_item[field], field
    assert await _stock(factory) != {} and (await _stock(factory))["mumbai_ordered"] == 10.0     # only the save moved stock


@pytest.mark.asyncio
async def test_import_preview_saves_nothing_needs_login_and_ignores_blank_rows(factory):
    async with _client(factory, NORMAL) as c:
        res = await c.post("/purchase/import-orders/preview", json={"conversion_rate": 80, "items": [{"product_name": " ", "quantity": 1, "unit_rate_usd": 1}]})
        assert res.status_code == 200 and res.json()["data"]["items"] == []
        assert (await c.get("/purchase/import-orders")).json()["meta"]["total"] == 0
        assert (await _stock(factory)) == {}
    async with _client(factory, None) as anon:
        assert (await anon.post("/purchase/import-orders/preview", json={})).status_code in (401, 403)


@pytest.mark.asyncio
async def test_supplier_flexible_matching_for_yinglima(factory):
    async with _client(factory, NORMAL) as c:
        # 1. Prefix match 'Yinglima' -> 'Yinglima Packaging Machinery Co., Ltd.'
        imp1 = await _new_import(c, consignment_no="EXP-Y1", supplier_name="Yinglima")
        assert imp1["supplier_name"] == "Yinglima Packaging Machinery Co., Ltd."

        # 2. Exact match 'Yinglima Packaging Machinery Co., Ltd.'
        imp2 = await _new_import(c, consignment_no="EXP-Y2", supplier_name="Yinglima Packaging Machinery Co., Ltd.")
        assert imp2["supplier_name"] == "Yinglima Packaging Machinery Co., Ltd."

        # 3. Case-insensitive substring match 'packaging machinery'
        imp3 = await _new_import(c, consignment_no="EXP-Y3", supplier_name="packaging machinery")
        assert imp3["supplier_name"] == "Yinglima Packaging Machinery Co., Ltd."

        # 4. Unknown supplier raises 400
        res = await c.post("/purchase/import-orders", json=_import(consignment_no="EXP-Y4", supplier_name="NonExistent Corp"))
        assert res.status_code == 400 and "not in the Supplier master" in res.text


@pytest.mark.asyncio
async def test_late_expense_editing_after_inward_and_partial_sales(factory):
    async with _client(factory, NORMAL) as user, _client(factory, ADMIN) as admin:
        # Create an import purchase with 10 units of Band Sealer into physical warehouse "Mumbai"
        order = await _new_import(
            user,
            consignment_no="EXP-LATE-1",
            warehouse="Mumbai",
            items=[{"product_name": "Band Sealer", "quantity": 10, "unit_rate_usd": 60}],
            freight=4000,
            insurance=400,
            clearing_transport=2000,
        )
        url = f"/purchase/import-orders/{order['id']}"

        # Transition: pending -> confirmed -> received
        await user.patch(f"{url}/status", json={"status": "confirmed"})
        r = (await user.patch(f"{url}/status", json={"status": "received"})).json()["data"]
        assert r["status"] == "received"
        assert (await _stock(factory))["mumbai"] == 10.0

        # Simulate partial sales against this consignment: 6 units sold, only 4 units remain in warehouse
        await _set_stock(factory, "Band Sealer", mumbai=4.0, total_qty=4.0)
        assert (await _stock(factory))["mumbai"] == 4.0

        # Now edit container expenses on the received consignment (Late Expense Inward Editing)
        edit_payload = _import(
            consignment_no="EXP-LATE-1",
            warehouse="Mumbai",
            items=[{"product_name": "Band Sealer", "quantity": 10, "unit_rate_usd": 60}],
            freight=8000,
            insurance=800,
            clearing_transport=5000,
        )
        res = await admin.put(url, json=edit_payload)
        assert res.status_code == 200, res.text
        updated = res.json()["data"]

        # Physical stock in warehouse must be preserved exactly at 4.0 (no negative stock error or delta collision)
        assert (await _stock(factory))["mumbai"] == 4.0

        # Verify container expenses and landing rates recalculated properly
        assert updated["freight"] == 8000.0
        assert updated["insurance"] == 800.0
        assert updated["clearing_transport"] == 5000.0
        assert updated["total_expenses"] > order["total_expenses"]
        assert updated["gross_total_landing"] > order["gross_total_landing"]

        # Move to closed status
        closed = (await admin.patch(f"{url}/status", json={"status": "closed"})).json()["data"]
        assert closed["status"] == "closed"

        # Late expense edit on closed consignment also succeeds
        close_edit = _import(
            consignment_no="EXP-LATE-1",
            warehouse="Mumbai",
            items=[{"product_name": "Band Sealer", "quantity": 10, "unit_rate_usd": 60}],
            freight=8000,
            insurance=800,
            clearing_transport=5000,
            misc_charges=1200,
            misc_remarks="Late port clearance fee",
        )
        res_closed = await admin.put(url, json=close_edit)
        assert res_closed.status_code == 200, res_closed.text
        final = res_closed.json()["data"]
        assert final["misc_charges"] == 1200.0
        assert final["misc_remarks"] == "Late port clearance fee"
        assert (await _stock(factory))["mumbai"] == 4.0

