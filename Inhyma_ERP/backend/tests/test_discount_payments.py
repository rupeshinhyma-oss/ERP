"""Discount Payments module tests: SaleOrder -> DiscountPayment auto-sync,
multi-installment Discount Adjustment ledger, validation, and Pending/Completed tabs.
"""

from __future__ import annotations

import importlib
import importlib.util
import uuid
from datetime import date
from pathlib import Path

import pytest
import pytest_asyncio
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

from app.auth.dependencies import get_auth_service, get_current_user  # noqa: E402
from app.auth.service import CurrentUser  # noqa: E402
from app.companies.models import Company  # noqa: E402
from app.core.exception_handlers import register_exception_handlers  # noqa: E402
from app.database.base import Base  # noqa: E402
from app.database.session import get_db_session  # noqa: E402
from app.inventory import stock_service  # noqa: E402
from app.inventory.models import ProductStock  # noqa: E402
from app.masters.brands.models import Brand  # noqa: E402
from app.masters.cities.models import City  # noqa: E402
from app.masters.countries.models import Country  # noqa: E402
from app.masters.districts.models import District  # noqa: E402
from app.masters.option_lists.models import OptionList  # noqa: E402
from app.masters.product_categories.models import ProductCategory  # noqa: E402
from app.masters.product_sub_categories.models import ProductSubCategory  # noqa: E402
from app.masters.products.models import Product, ProductDimensionRow  # noqa: E402
from app.masters.states.models import State  # noqa: E402
from app.masters.taxes.models import Tax  # noqa: E402
from app.masters.uom.models import UnitOfMeasurement  # noqa: E402
from app.masters.warehouses.models import Warehouse  # noqa: E402
from app.sales.models import DiscountPayment, GatePass, SaleOrder, SaleOrderItem  # noqa: E402
from app.sales.routes import router as sales_router  # noqa: E402
from app.users.models import User  # noqa: E402

VERSIONS = Path(__file__).resolve().parents[1] / "alembic" / "versions"
SEED = "s1b2c3d4e5fa_sale_order_workflow.py"
TABLES = [
    User.__table__,
    Country.__table__,
    State.__table__,
    District.__table__,
    City.__table__,
    Company.__table__,
    SaleOrder.__table__,
    SaleOrderItem.__table__,
    DiscountPayment.__table__,
    GatePass.__table__,
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

ADMIN_ID = uuid.uuid4()
ADMIN = CurrentUser(id=ADMIN_ID, username="archana", is_super_admin=True)


class _DummyAuthService:
    async def verify_access_token(self, token: str) -> CurrentUser:
        return ADMIN


def _migrate(sync_conn, filename: str, direction: str = "upgrade") -> None:
    spec = importlib.util.spec_from_file_location(filename[:-3], VERSIONS / filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    with Operations.context(MigrationContext.configure(sync_conn)):
        getattr(module, direction)()


@pytest_asyncio.fixture
async def factory():
    engine = create_async_engine(
        "sqlite+aiosqlite://",
        poolclass=StaticPool,
        connect_args={"check_same_thread": False},
    )
    async with engine.begin() as conn:
        await conn.run_sync(lambda c: Base.metadata.create_all(c, tables=TABLES))
        await conn.run_sync(_migrate, SEED)
    maker = async_sessionmaker(engine, expire_on_commit=False)
    async with maker() as s:
        user = User(
            id=ADMIN_ID,
            username="archana",
            email="archana@inhyma.com",
            password_hash="x",
            first_name="Archana",
            last_name="Bhure",
            display_name="Archana Bhure",
        )
        comp = Company(
            company_name="GLOBAL IMPEX MACHINERY",
            contact_salutation="Mr",
            contact_full_name="Hitesh Rajput",
            contact_calling_number="7984942878",
            tax_id_number="24AAACG8890K1ZP",
            address="Shed 12, Phase 3",
            area="GIDC Naroda",
            town="Ahmedabad",
            district="Ahmedabad",
        )
        uom = UnitOfMeasurement(code="NOS", name="Numbers", short_name="Nos")
        tax = Tax(hsn_number="84223000", gst_percent=18, import_duty_percent=10)
        s.add_all([user, comp, uom, tax])
        await s.flush()
        ahd = Warehouse(name="Ahmedabad", address="x", billing_company="Inhyma")
        s.add(ahd)
        await s.flush()
        s.add(
            Product(
                product_name="Band Sealer",
                product_name_tally="Band Sealer",
                category_id=uuid.uuid4(),
                uom_id=uom.id,
                hsn_id=tax.id,
                packaging_unit_cbm=0.5,
                packaging_quantity=1,
            )
        )
        await s.commit()
        await stock_service.apply_stock_delta(
            s, product_name="Band Sealer", warehouse_name="Ahmedabad", delta=25
        )
        await s.commit()
    yield maker
    await engine.dispose()


def _client(maker) -> AsyncClient:
    app = FastAPI()
    register_exception_handlers(app)
    app.include_router(sales_router, prefix="/api/v1")

    async def _db():
        async with maker() as session:
            try:
                yield session
                await session.commit()
            except BaseException:
                await session.rollback()
                raise

    app.dependency_overrides[get_db_session] = _db
    app.dependency_overrides[get_current_user] = lambda: ADMIN
    app.dependency_overrides[get_auth_service] = lambda: _DummyAuthService()
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


@pytest.mark.asyncio
async def test_sale_order_discount_sync_and_multi_installment_settlement(factory):
    async with _client(factory) as client:
        # 1. Create a SaleOrder with unit_discount (2 * 28,000 = 56,000 discount)
        create_res = await client.post(
            "/api/v1/sales/orders",
            json={
                "buyer_name": "GLOBAL IMPEX MACHINERY",
                "company_name": "GLOBAL IMPEX MACHINERY",
                "warehouse": "Ahmedabad",
                "sales_person": "Dhairya Shah",
                "order_date": str(date(2026, 7, 29)),
                "booking_remarks": "Special machinery discount approved",
                "items": [
                    {
                        "product_name": "Band Sealer",
                        "quantity": 2,
                        "unit_rate": 100000,
                        "unit_discount": 28000,
                        "tax_percent": 18,
                    }
                ],
            },
        )
        assert create_res.status_code == 201, create_res.text
        so_data = create_res.json()["data"]
        order_id = so_data["id"]
        order_no = so_data["order_no"]
        assert so_data["discount"] == 56000.0

        # 2. Verify DiscountPayment record was automatically created & enriched from SaleOrder + Company
        list_res = await client.get("/api/v1/sales/discount-payments")
        assert list_res.status_code == 200
        items = list_res.json()["data"]["items"]
        assert len(items) == 1
        dp = items[0]
        dp_id = dp["id"]
        assert dp["order_no"] == order_no
        assert dp["order_id"] == order_id
        assert dp["company_name"] == "GLOBAL IMPEX MACHINERY"
        assert dp["contact_name"] == "Mr Hitesh Rajput"
        assert dp["contact_person_name"] == "Hitesh Rajput"
        assert dp["contact_person_mobile"] == "7984942878"
        assert dp["warehouse"] == "Ahmedabad"
        assert dp["total_discount"] == 56000.0
        assert dp["paid_discount"] == 0.0
        assert dp["due_discount"] == 56000.0
        assert dp["settled"] is False
        assert dp["status"] == "Pending"
        assert dp["payments"] == []

        # 3. Advance SaleOrder workflow all the way to LR and verify status + gatepass sync onto DiscountPayment
        for step_payload in [
            {"status": "sales_confirmed"},
            {"status": "admin_approved"},
            {"status": "acc_confirmed", "invoice_no": "INV-0560", "invoice_date": "29-07-2026"},
            {"status": "gatepass_created", "gatepass_no": "3149", "gatepass_date": "29-07-2026"},
            {"status": "dispatched"},
            {"status": "lr", "lr_no": "LR-9988"},
        ]:
            st_res = await client.patch(f"/api/v1/sales/orders/{order_id}/status", json=step_payload)
            assert st_res.status_code == 200, st_res.text

        list_lr = (await client.get("/api/v1/sales/discount-payments")).json()["data"]["items"][0]
        assert list_lr["status"] == "LR"
        assert list_lr["gatepass_id"] == "3149"
        assert list_lr["gatepass_date"] == "29-07-2026"

        # 4. Validate amount bounds on PATCH /sales/discount-payments/{id}
        bad_zero = await client.patch(
            f"/api/v1/sales/discount-payments/{dp_id}",
            json={"amount": 0, "settle_date": "12-08-2026"},
        )
        assert bad_zero.status_code == 400

        bad_over = await client.patch(
            f"/api/v1/sales/discount-payments/{dp_id}",
            json={"amount": 60000, "settle_date": "12-08-2026"},
        )
        assert bad_over.status_code == 400

        # 5. Record Installment #1 (₹ 20,000) with Bearer token -> adjusted_by resolves to "Archana Bhure"
        p1_res = await client.patch(
            f"/api/v1/sales/discount-payments/{dp_id}",
            headers={"Authorization": "Bearer test-token"},
            json={
                "amount": 20000,
                "settle_date": "12-08-2026",
                "settle_remarks": "GPAY 20000 /- Inhyma MP",
            },
        )
        assert p1_res.status_code == 200, p1_res.text
        p1 = p1_res.json()["data"]
        assert p1["paid_discount"] == 20000.0
        assert p1["due_discount"] == 36000.0
        assert p1["settled"] is False
        assert p1["status"] == "LR"
        assert len(p1["payments"]) == 1
        assert p1["payments"][0]["date"] == "12-08-2026"
        assert p1["payments"][0]["title"] == "GPAY 20000 /- Inhyma MP"
        assert p1["payments"][0]["amount"] == 20000.0
        assert p1["payments"][0]["adjusted_by"] == "Archana Bhure"

        # 6. Record Installment #2 (₹ 34,000) -> Paid 54,000, Due 2,000 (still Pending)
        p2_res = await client.patch(
            f"/api/v1/sales/discount-payments/{dp_id}",
            headers={"Authorization": "Bearer test-token"},
            json={
                "amount": 34000,
                "settle_date": "13-08-2026",
                "settle_remarks": "34000/- Recvd Inhyma Gujarat Account Dhairya Shaha",
            },
        )
        assert p2_res.status_code == 200
        p2 = p2_res.json()["data"]
        assert p2["paid_discount"] == 54000.0
        assert p2["due_discount"] == 2000.0
        assert p2["settled"] is False
        assert len(p2["payments"]) == 2

        pending_check = await client.get("/api/v1/sales/discount-payments?status=pending")
        assert len(pending_check.json()["data"]["items"]) == 1
        completed_check = await client.get("/api/v1/sales/discount-payments?status=completed")
        assert len(completed_check.json()["data"]["items"]) == 0

        # 7. Record Final Installment #3 (₹ 2,000) -> Paid 56,000, Due 0, settled=True (moves to Completed, keeps LR status!)
        p3_res = await client.patch(
            f"/api/v1/sales/discount-payments/{dp_id}",
            headers={"Authorization": "Bearer test-token"},
            json={
                "amount": 2000,
                "settle_date": "28-10-2026",
                "settle_remarks": "Final balance settled",
            },
        )
        assert p3_res.status_code == 200
        p3 = p3_res.json()["data"]
        assert p3["paid_discount"] == 56000.0
        assert p3["due_discount"] == 0.0
        assert p3["settled"] is True
        assert p3["status"] == "LR"
        assert len(p3["payments"]) == 3
        assert [row["amount"] for row in p3["payments"]] == [20000.0, 34000.0, 2000.0]

        pending_after = await client.get("/api/v1/sales/discount-payments?status=pending")
        assert len(pending_after.json()["data"]["items"]) == 0
        completed_after = await client.get("/api/v1/sales/discount-payments?status=completed")
        assert len(completed_after.json()["data"]["items"]) == 1

