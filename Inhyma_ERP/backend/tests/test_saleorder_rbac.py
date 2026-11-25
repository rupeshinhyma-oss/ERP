"""Regression tests for granular Sales Process RBAC (`z9j8a9b0c1d2`)."""

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
from app.rbac.models import Permission, Role, RolePermission  # noqa: E402
from app.sales.models import SaleOrder, SaleOrderItem  # noqa: E402
from app.sales.process_routes import router as sale_router  # noqa: E402

VERSIONS = Path(__file__).resolve().parents[1] / "alembic" / "versions"
SEED_RULES = "s1b2c3d4e5fa_sale_order_workflow.py"
MIGRATION_RBAC = "z9j8a9b0c1d2_add_granular_saleorder_permissions.py"

TABLES = [
    Permission.__table__,
    Role.__table__,
    RolePermission.__table__,
    SaleOrder.__table__,
    SaleOrderItem.__table__,
    OptionList.__table__,
    ProductStock.__table__,
    Product.__table__,
    Tax.__table__,
    UnitOfMeasurement.__table__,
    Warehouse.__table__,
    Brand.__table__,
    ProductCategory.__table__,
    ProductSubCategory.__table__,
    ProductDimensionRow.__table__,
]

NO_PERM_USER = CurrentUser(id=uuid.uuid4(), username="noperm", permissions=set())
VIEW_ONLY_USER = CurrentUser(id=uuid.uuid4(), username="viewer", permissions={"saleorder.view"})
PENDING_VIEWER = CurrentUser(id=uuid.uuid4(), username="pending_viewer", permissions={"saleorder.pending.view"})
CREATOR_USER = CurrentUser(id=uuid.uuid4(), username="creator", permissions={"saleorder.view", "saleorder.create"})
EXPORTER_USER = CurrentUser(id=uuid.uuid4(), username="exporter", permissions={"saleorder.view", "saleorder.export"})
FILES_USER = CurrentUser(id=uuid.uuid4(), username="filer", permissions={"saleorder.view", "saleorder.files"})
CONFIRMER_USER = CurrentUser(id=uuid.uuid4(), username="confirmer", permissions={"saleorder.view", "saleorder.confirm"})
CANCELLER_USER = CurrentUser(id=uuid.uuid4(), username="canceller", permissions={"saleorder.view", "saleorder.cancel"})
MANAGE_USER = CurrentUser(id=uuid.uuid4(), username="manager", permissions={"saleorder.manage"})


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
        await conn.run_sync(_migrate, SEED_RULES)
    maker = async_sessionmaker(engine, expire_on_commit=False)
    async with maker() as s:
        uom = UnitOfMeasurement(code="NOS", name="Numbers", short_name="Nos")
        tax = Tax(hsn_number="84223000", gst_percent=18, import_duty_percent=10)
        s.add_all([uom, tax])
        await s.flush()
        mumbai = Warehouse(name="Mumbai", address="x", billing_company="Inhyma")
        s.add(mumbai)
        await s.flush()
        cat = uuid.uuid4()
        s.add(
            Product(
                product_name="Band Sealer",
                product_name_tally="Band Sealer",
                category_id=cat,
                uom_id=uom.id,
                hsn_id=tax.id,
                packaging_unit_cbm=0.5,
                packaging_quantity=1,
            )
        )
        await s.commit()
        await stock_service.apply_stock_delta(s, product_name="Band Sealer", warehouse_name="Mumbai", delta=50)
        await s.commit()
    yield maker
    await engine.dispose()


def _client(maker, user: CurrentUser) -> AsyncClient:
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
    app.dependency_overrides[get_current_user] = lambda: user
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


def _order_payload():
    return {
        "buyer_name": "Acme Packaging",
        "order_date": date.today().isoformat(),
        "warehouse": "Mumbai",
        "sales_person": "tester",
        "items": [{"product_name": "Band Sealer", "quantity": 1, "unit_rate": 1000, "tax_percent": 18}],
    }


@pytest.mark.asyncio
async def test_migration_seeds_all_25_saleorder_permissions_and_downgrades_cleanly():
    engine = create_async_engine("sqlite+aiosqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
    async with engine.begin() as conn:
        await conn.run_sync(lambda c: Base.metadata.create_all(c, tables=[Permission.__table__, Role.__table__, RolePermission.__table__]))
    maker = async_sessionmaker(engine, expire_on_commit=False)
    async with maker() as s:
        admin_role = Role(name="super_admin", description="Admin", is_system=True)
        s.add(admin_role)
        # Seed legacy saleorder.approve before running migration
        s.add(Permission(code="saleorder.approve", module="saleorder", page="sales-process", action="approve", scope="ALL", description="old"))
        await s.commit()

    async with engine.begin() as conn:
        await conn.run_sync(_migrate, MIGRATION_RBAC, "upgrade")
        await conn.run_sync(_migrate, MIGRATION_RBAC, "upgrade")  # idempotent
        codes = set((await conn.execute(sa.text("SELECT code FROM permissions WHERE module = 'saleorder'"))).scalars().all())
        rp_count = (await conn.execute(sa.text("SELECT count(*) FROM role_permissions"))).scalar()
    assert len(codes) == 25
    assert "saleorder.view" in codes
    assert "saleorder.sales_confirmed.view" in codes
    assert "saleorder.duplicate" in codes
    assert "saleorder.files" in codes
    assert "saleorder.confirm" in codes
    assert "saleorder.cancel" in codes
    assert "saleorder.manage" in codes
    assert rp_count == 25

    async with engine.begin() as conn:
        await conn.run_sync(_migrate, MIGRATION_RBAC, "downgrade")
        remaining = set((await conn.execute(sa.text("SELECT code FROM permissions WHERE module = 'saleorder'"))).scalars().all())
    await engine.dispose()
    assert remaining == {"saleorder.approve", "saleorder.accounts", "saleorder.warehouse", "saleorder.delete"}


@pytest.mark.asyncio
async def test_saleorder_granular_endpoint_and_stage_enforcement(factory, monkeypatch):
    from app.common import storage

    async def _fake_supabase_none(*_args, **_kwargs):
        return None

    monkeypatch.setattr(storage, "upload_to_supabase", _fake_supabase_none)

    async with (
        _client(factory, NO_PERM_USER) as noperm,
        _client(factory, VIEW_ONLY_USER) as viewer,
        _client(factory, PENDING_VIEWER) as pending_viewer,
        _client(factory, CREATOR_USER) as creator,
        _client(factory, EXPORTER_USER) as exporter,
        _client(factory, FILES_USER) as filer,
        _client(factory, CONFIRMER_USER) as confirmer,
        _client(factory, CANCELLER_USER) as canceller,
        _client(factory, MANAGE_USER) as manager,
    ):
        assert (await noperm.get("/sales/orders")).status_code == 403
        assert (await noperm.get("/sales/metrics")).status_code == 403

        # Create 2 orders with creator/manager
        o1 = (await creator.post("/sales/orders", json=_order_payload())).json()["data"]
        o2 = (await manager.post("/sales/orders", json=_order_payload())).json()["data"]
        assert (await creator.get("/sales/export")).status_code == 403
        assert (await exporter.get("/sales/export")).status_code == 200

        # View-only cannot create, update, transition, delete, or upload PO
        assert (await viewer.get("/sales/orders")).status_code == 200
        assert (await viewer.post("/sales/orders", json=_order_payload())).status_code == 403
        assert (await viewer.patch(f"/sales/orders/{o1['id']}", json={"remarks": "x"})).status_code == 403
        assert (await viewer.patch(f"/sales/orders/{o1['id']}/status", json={"status": "sales_confirmed"})).status_code == 403
        assert (await viewer.delete(f"/sales/orders/{o1['id']}")).status_code == 403
        assert (await viewer.post("/sales/upload-po", files={"file": ("po.pdf", b"%PDF", "application/pdf")})).status_code == 403

        # Confirm requires saleorder.confirm (not available to canceller; cancel requires saleorder.cancel)
        assert (await canceller.patch(f"/sales/orders/{o1['id']}/status", json={"status": "sales_confirmed"})).status_code == 403
        assert (await confirmer.patch(f"/sales/orders/{o1['id']}/status", json={"status": "sales_confirmed"})).status_code == 200
        assert (await confirmer.patch(f"/sales/orders/{o2['id']}/status", json={"status": "cancelled", "remarks": "no"})).status_code == 403

        # pending_viewer sees only o2 (pending), NOT o1 (sales_confirmed), and gets 403 on ?status=sales_confirmed
        pv_list = await pending_viewer.get("/sales/orders")
        assert pv_list.status_code == 200
        assert [row["id"] for row in pv_list.json()["data"]["items"]] == [o2["id"]]
        assert (await pending_viewer.get("/sales/orders?status=sales_confirmed")).status_code == 403
        assert (await pending_viewer.get(f"/sales/orders/{o1['id']}")).status_code == 404

        # saleorder.files can upload PO & attach files even after pending/sales_confirmed/admin_approved,
        # but cannot modify commercial/order fields
        assert (await manager.patch(f"/sales/orders/{o1['id']}/status", json={"status": "admin_approved"})).status_code == 200
        assert (await filer.post("/sales/upload-po", files={"file": ("po.pdf", b"%PDF", "application/pdf")})).status_code == 200
        assert (
            await filer.patch(
                f"/sales/orders/{o1['id']}",
                json={"po_file_url": "/uploads/private/sales_po/po.pdf", "po_file_name": "po.pdf"},
            )
        ).status_code == 200
        assert (
            await filer.patch(f"/sales/orders/{o1['id']}", json={"warehouse": "Ahmedabad"})
        ).status_code == 403

        # Manager (saleorder.manage) can cancel, delete, restore
        assert (await canceller.patch(f"/sales/orders/{o1['id']}/status", json={"status": "cancelled", "remarks": "stop"})).status_code == 200
        assert (await manager.delete(f"/sales/orders/{o1['id']}")).status_code == 200
        assert (await confirmer.post(f"/sales/orders/{o1['id']}/restore")).status_code == 403
        assert (await manager.post(f"/sales/orders/{o1['id']}/restore")).status_code == 200
