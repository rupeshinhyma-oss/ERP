"""Unit and full async workflow integration tests for Technician Ops, Gatepass Stock, Linked SO, Wallet & Warranty."""

from __future__ import annotations

import importlib
import importlib.util
import uuid
from datetime import date, timedelta
from pathlib import Path

import pytest
import pytest_asyncio
from alembic.migration import MigrationContext
from alembic.operations import Operations
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool


def _import_all_models() -> None:
    root = Path(__file__).resolve().parents[1]
    for path in sorted((root / "app").rglob("models.py")):
        importlib.import_module(".".join(path.relative_to(root).with_suffix("").parts))


_import_all_models()

from app.auth.dependencies import get_current_user  # noqa: E402
from app.auth.service import CurrentUser  # noqa: E402
from app.buyers.models import Buyer  # noqa: E402
from app.companies.models import (  # noqa: E402
    Company,
    CompanyCategoryLink,
    CompanyContact,
    CompanyEmail,
    CompanyProductLink,
    CompanySubCategoryLink,
)
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
from app.masters.products.models import Product, ProductDimensionRow, ProductMachineSpare  # noqa: E402
from app.masters.states.models import State  # noqa: E402
from app.masters.taxes.models import Tax  # noqa: E402
from app.masters.technicians.models import Technician  # noqa: E402
from app.masters.uom.models import UnitOfMeasurement  # noqa: E402
from app.masters.warehouses.models import Warehouse  # noqa: E402
from app.sales.models import SaleOrder, SaleOrderItem  # noqa: E402
from app.sales.process_routes import router as sale_router  # noqa: E402
from app.technical_tasks.models import TechnicalTask, TechnicalTaskCallLog, TechnicalTaskLog  # noqa: E402
from app.technical_tasks.routes import router as technical_task_router  # noqa: E402
from app.technician_operations.models import (  # noqa: E402
    MachineWarranty,
    TechnicianGatepass,
    TechnicianGatepassItem,
    TechnicianWalletTransaction,
)
from app.technician_operations.routes import router as tech_ops_router  # noqa: E402
from app.technician_operations.schemas import (  # noqa: E402
    DraftSOGenerationResponse,
    GatepassCreate,
    GatepassItemCreate,
    GatepassItemReturnPayload,
    GatepassLinkSOPayload,
    GatepassReturnPayload,
    TechnicianWalletSummary,
    WalletTransactionCreate,
)
from app.users.models import User  # noqa: E402

VERSIONS = Path(__file__).resolve().parents[1] / "alembic" / "versions"
SALE_WORKFLOW_SEED = "s1b2c3d4e5fa_sale_order_workflow.py"

TABLES = [
    User.__table__,
    Country.__table__,
    State.__table__,
    District.__table__,
    City.__table__,
    Buyer.__table__,
    Company.__table__,
    CompanyEmail.__table__,
    CompanyContact.__table__,
    CompanyCategoryLink.__table__,
    CompanySubCategoryLink.__table__,
    CompanyProductLink.__table__,
    Technician.__table__,
    OptionList.__table__,
    Brand.__table__,
    ProductCategory.__table__,
    ProductSubCategory.__table__,
    UnitOfMeasurement.__table__,
    Tax.__table__,
    Warehouse.__table__,
    Product.__table__,
    ProductDimensionRow.__table__,
    ProductMachineSpare.__table__,
    ProductStock.__table__,
    SaleOrder.__table__,
    SaleOrderItem.__table__,
    TechnicalTask.__table__,
    TechnicalTaskCallLog.__table__,
    TechnicalTaskLog.__table__,
    TechnicianGatepass.__table__,
    TechnicianGatepassItem.__table__,
    TechnicianWalletTransaction.__table__,
    MachineWarranty.__table__,
]

ADMIN = CurrentUser(id=uuid.uuid4(), username="admin", is_super_admin=True, permissions={"*"})
TECH_VIEWER = CurrentUser(id=uuid.uuid4(), username="viewer", permissions={"technicaltask.view"})
UNPRIVILEGED = CurrentUser(id=uuid.uuid4(), username="guest", permissions=set())


def _migrate(sync_conn, filename: str, direction: str = "upgrade") -> None:
    spec = importlib.util.spec_from_file_location(filename[:-3], VERSIONS / filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    with Operations.context(MigrationContext.configure(sync_conn)):
        getattr(module, direction)()


@pytest_asyncio.fixture
async def env():
    engine = create_async_engine(
        "sqlite+aiosqlite://",
        poolclass=StaticPool,
        connect_args={"check_same_thread": False},
    )
    async with engine.begin() as conn:
        await conn.run_sync(lambda c: Base.metadata.create_all(c, tables=TABLES))
        await conn.run_sync(_migrate, SALE_WORKFLOW_SEED)

    maker = async_sessionmaker(engine, expire_on_commit=False)
    ids: dict[str, uuid.UUID] = {}

    async with maker() as s:
        country = Country(name="India", code="IN", phone_code="+91")
        s.add(country)
        await s.flush()
        state = State(country_id=country.id, name="Maharashtra", code="MH")
        s.add(state)
        await s.flush()
        city = City(country_id=country.id, state_id=state.id, name="Mumbai")
        s.add(city)
        await s.flush()

        company = Company(
            company_name="Apex Packaging Ltd",
            country_id=country.id,
            state_id=state.id,
            city_id=city.id,
            address="Plot 14, MIDC Andheri East",
            contact_full_name="Rajesh Mehta",
            contact_calling_number="9820011223",
        )
        tech = Technician(name="Ramesh Kumar", mobile="9876543210", city="Mumbai")
        uom = UnitOfMeasurement(code="NOS", name="Numbers", short_name="Nos")
        tax = Tax(hsn_number="84229090", gst_percent=18, import_duty_percent=10)
        wh = Warehouse(name="Mumbai", address="Bhiwandi Hub", billing_company="Inhyma Solutions LLP")
        s.add_all([company, tech, uom, tax, wh])
        await s.flush()

        cat_machine = ProductCategory(name="Machines", code="CAT-M")
        cat_spare = ProductCategory(name="Spare Parts", code="CAT-S")
        s.add_all([cat_machine, cat_spare])
        await s.flush()

        machine = Product(
            product_name="Band Sealer 900",
            product_name_tally="Band Sealer 900",
            product_code="MCH-BS900",
            product_type="Machine",
            category_id=cat_machine.id,
            uom_id=uom.id,
            hsn_id=tax.id,
            standard_price=45000,
        )
        spare_a = Product(
            product_name="Heating Element 240V",
            product_name_tally="Heating Element 240V",
            product_code="SP-HEAT-01",
            product_type="Spare Part",
            category_id=cat_spare.id,
            uom_id=uom.id,
            hsn_id=tax.id,
            standard_price=1250,
        )
        spare_b = Product(
            product_name="PTFE Teflon Belt",
            product_name_tally="PTFE Teflon Belt",
            product_code="SP-TEF-02",
            product_type="Spare Part",
            category_id=cat_spare.id,
            uom_id=uom.id,
            hsn_id=tax.id,
            standard_price=450,
        )
        s.add_all([machine, spare_a, spare_b])
        await s.flush()

        s.add(ProductMachineSpare(spare_part_id=spare_a.id, machine_id=machine.id))
        await stock_service.apply_stock_delta(s, product_name="Band Sealer 900", warehouse_name="Mumbai", delta=3)
        await stock_service.apply_stock_delta(s, product_name="Heating Element 240V", warehouse_name="Mumbai", delta=5)
        await stock_service.apply_stock_delta(s, product_name="PTFE Teflon Belt", warehouse_name="Mumbai", delta=4)
        await s.commit()

        ids = {
            "company_id": company.id,
            "tech_id": tech.id,
            "machine_id": machine.id,
            "spare_a_id": spare_a.id,
            "spare_b_id": spare_b.id,
            "warehouse_id": wh.id,
        }

    def build_app(user: CurrentUser = ADMIN) -> FastAPI:
        app = FastAPI()
        register_exception_handlers(app)
        app.include_router(tech_ops_router, prefix="/api/v1")
        app.include_router(sale_router, prefix="/api/v1")
        app.include_router(technical_task_router, prefix="/api/v1")

        async def _db():
            async with maker() as session:
                try:
                    yield session
                    await session.commit()
                except Exception:
                    await session.rollback()
                    raise

        app.dependency_overrides[get_db_session] = _db
        app.dependency_overrides[get_current_user] = lambda: user
        return app

    yield maker, ids, build_app
    await engine.dispose()


async def _stock_qty(maker: async_sessionmaker[AsyncSession], product_id: uuid.UUID, warehouse: str = "Mumbai") -> int:
    col = stock_service.warehouse_column(warehouse)
    async with maker() as s:
        row = (
            await s.execute(
                select(ProductStock).where(
                    ProductStock.product_id == product_id,
                    ProductStock.deleted_at.is_(None),
                )
            )
        ).scalar_one_or_none()
        return int(getattr(row, col, 0) or 0) if row else 0


# ==============================================================================
# UNIT TESTS (Schema & Domain Calculations)
# ==============================================================================


def test_warranty_lifecycle_under_vs_out_of_warranty():
    """Verify warranty expiration calculation based on machine invoice date and duration."""
    today = date.today()

    recent_invoice = today - timedelta(days=60)
    warranty_under = MachineWarranty(
        serial_number="SN-INHYMA-1001",
        machine_model="SuperSealer 5000",
        company_name="Apex Packaging Ltd",
        invoice_date=recent_invoice,
        warranty_months=12,
        warranty_end_date=recent_invoice + timedelta(days=365),
        status="UNDER_WARRANTY",
    )
    assert warranty_under.is_currently_covered() is True

    old_invoice = today - timedelta(days=500)
    warranty_expired = MachineWarranty(
        serial_number="SN-INHYMA-0082",
        machine_model="CartonMaster 300",
        company_name="Zenith Foods Ltd",
        invoice_date=old_invoice,
        warranty_months=12,
        warranty_end_date=old_invoice + timedelta(days=365),
        status="OUT_OF_WARRANTY",
    )
    assert warranty_expired.is_currently_covered() is False

    warranty_void = MachineWarranty(
        serial_number="SN-INHYMA-0999",
        machine_model="PackBot X",
        company_name="Delta Beverages",
        invoice_date=recent_invoice,
        warranty_months=12,
        warranty_end_date=recent_invoice + timedelta(days=365),
        status="VOIDED",
    )
    assert warranty_void.is_currently_covered() is False


def test_gatepass_create_and_item_schema():
    """Verify Gatepass issuance payload structure."""
    item1 = GatepassItemCreate(
        product_name="Heating Element 240V 1kW",
        product_code="SP-HEAT-01",
        uom="NOS",
        quantity_issued=2.0,
        unit_rate=1250.0,
        remarks="Field replacement for sealing jaw",
    )
    item2 = GatepassItemCreate(
        product_name="PTFE Teflon Tape 10m",
        product_code="SP-TEF-05",
        uom="ROLL",
        quantity_issued=3.0,
        unit_rate=450.0,
    )

    gp_payload = GatepassCreate(
        technician_name="Ramesh Kumar",
        technician_mobile="9876543210",
        warehouse_name="Mumbai",
        customer_name="Apex Packaging Ltd",
        machine_model="Band Sealer 900",
        machine_serial_number="SN-INHYMA-1001",
        purpose="Emergency breakdown service call",
        items=[item1, item2],
    )

    assert gp_payload.technician_name == "Ramesh Kumar"
    assert gp_payload.warehouse_name == "Mumbai"
    assert len(gp_payload.items) == 2


def test_partial_return_consumed_parts_so_requirement():
    """Verify domain math for partial return & SO requirement."""
    gp_id = uuid.uuid4()
    item1_id = uuid.uuid4()
    item1 = TechnicianGatepassItem(
        id=item1_id,
        gatepass_id=gp_id,
        product_name="Heating Element 240V 1kW",
        quantity_issued=2.0,
        quantity_consumed=0.0,
        quantity_returned=0.0,
        unit_rate=1250.0,
        is_warranty_covered=False,
        item_status="ISSUED",
    )
    gatepass = TechnicianGatepass(
        id=gp_id,
        gatepass_number="GP-TECH-2026-0001",
        technician_name="Ramesh Kumar",
        customer_name="Apex Packaging Ltd",
        is_warranty_service=False,
        issue_date=date.today(),
        issued_by_name="Warehouse Manager",
        purpose="Breakdown service call",
        status="ISSUED",
        so_required=False,
        so_created=False,
        items=[item1],
    )
    return_payload = GatepassReturnPayload(
        return_gatepass_number="RGP-TECH-2026-0001",
        items=[
            GatepassItemReturnPayload(
                item_id=item1_id,
                quantity_returned=1.0,
                quantity_consumed=1.0,
                is_warranty_covered=False,
                item_status="CONSUMED_BILLED",
            )
        ],
    )
    assert return_payload.items[0].quantity_consumed == 1.0
    link_so_payload = GatepassLinkSOPayload(sales_order_number="SO-2026-0842")
    gatepass.so_number = link_so_payload.sales_order_number
    assert gatepass.so_number == "SO-2026-0842"


def test_technician_wallet_balance_ledger_math():
    """Net Balance = Collections - Handover Deposits - Approved Field Expenses."""
    transactions = [
        WalletTransactionCreate(technician_name="Ramesh Kumar", transaction_type="COLLECTION", amount=15000.0),
        WalletTransactionCreate(technician_name="Ramesh Kumar", transaction_type="COLLECTION", amount=5000.0),
        WalletTransactionCreate(technician_name="Ramesh Kumar", transaction_type="HANDOVER_DEPOSIT", amount=12000.0),
        WalletTransactionCreate(technician_name="Ramesh Kumar", transaction_type="FIELD_EXPENSE", amount=1500.0),
    ]
    coll = sum(t.amount for t in transactions if t.transaction_type == "COLLECTION")
    dep = sum(t.amount for t in transactions if t.transaction_type == "HANDOVER_DEPOSIT")
    exp = sum(t.amount for t in transactions if t.transaction_type == "FIELD_EXPENSE")
    net_balance = round(coll - dep - exp, 2)
    summary = TechnicianWalletSummary(
        technician_name="Ramesh Kumar",
        total_collected=coll,
        total_deposited=dep,
        total_expenses=exp,
        net_wallet_balance=net_balance,
        status="PENDING_DEPOSIT" if net_balance > 0 else "CLEAR",
    )
    assert summary.net_wallet_balance == 6500.0


def test_draft_so_generation_formatting():
    """Verify draft SO generation response format for salesperson."""
    draft = DraftSOGenerationResponse(
        customer_name="Apex Packaging Ltd",
        warehouse_name="Mumbai",
        machine_serial_number="SN-INHYMA-1001",
        gatepass_number="GP-TECH-2026-0001",
        items_to_bill=[
            {
                "gatepass_item_id": str(uuid.uuid4()),
                "product_code": "SP-001",
                "product_name": "Sealing Blade 400mm",
                "quantity": 2.0,
                "unit_rate": 800.0,
                "line_total": 1600.0,
            }
        ],
        estimated_subtotal=1600.0,
        message="Ready to bill: 1 item(s) consumed.",
    )
    assert draft.estimated_subtotal == 1600.0
    assert draft.warehouse_name == "Mumbai"


# ==============================================================================
# ASYNC INTEGRATION TESTS (Warehouse Stock, Linked SO, Serial Warranty, RBAC)
# ==============================================================================


@pytest.mark.asyncio
async def test_lookups_and_outward_gatepass_stock_deduction(env):
    maker, ids, build_app = env
    async with AsyncClient(transport=ASGITransport(app=build_app(ADMIN)), base_url="http://test") as client:
        # 1. Verify unified master lookups
        r_lookups = await client.get("/api/v1/technician-operations/lookups")
        assert r_lookups.status_code == 200
        lk = r_lookups.json()["data"]
        assert any(t["name"] == "Ramesh Kumar" for t in lk["technicians"])
        assert any(c["company_name"] == "Apex Packaging Ltd" and c["city"] == "Mumbai" for c in lk["companies"])
        assert any(w["name"] == "Mumbai" for w in lk["warehouses"])
        assert any(m["product_name"] == "Band Sealer 900" for m in lk["machines"])
        sp_heat = next(p for p in lk["spare_parts"] if p["product_code"] == "SP-HEAT-01")
        assert sp_heat["stock_by_warehouse"]["Mumbai"] == 5
        assert str(ids["machine_id"]) in sp_heat["compatible_machine_ids"]

        # 2. Reject issuing more spare parts than physically available (6 > 5 -> 409)
        bad_gp = await client.post(
            "/api/v1/technician-operations/gatepasses",
            json={
                "technician_id": str(ids["tech_id"]),
                "technician_name": "Ramesh Kumar",
                "warehouse_name": "Mumbai",
                "company_id": str(ids["company_id"]),
                "customer_name": "Apex Packaging Ltd",
                "machine_model": "Band Sealer 900",
                "purpose": "Over-stock test",
                "items": [
                    {
                        "product_id": str(ids["spare_a_id"]),
                        "product_name": "Heating Element 240V",
                        "product_code": "SP-HEAT-01",
                        "uom": "NOS",
                        "quantity_issued": 6,
                        "unit_rate": 1250,
                    }
                ],
            },
        )
        assert bad_gp.status_code == 409
        assert await _stock_qty(maker, ids["spare_a_id"]) == 5

        # 3. Issue 3 of Spare A and 2 of Spare B -> deducts physical warehouse stock
        ok_gp = await client.post(
            "/api/v1/technician-operations/gatepasses",
            json={
                "technician_id": str(ids["tech_id"]),
                "technician_name": "Ramesh Kumar",
                "warehouse_name": "Mumbai",
                "company_id": str(ids["company_id"]),
                "customer_name": "Apex Packaging Ltd",
                "machine_model": "Band Sealer 900",
                "purpose": "Field breakdown repair",
                "items": [
                    {
                        "product_id": str(ids["spare_a_id"]),
                        "product_name": "Heating Element 240V",
                        "product_code": "SP-HEAT-01",
                        "uom": "NOS",
                        "quantity_issued": 3,
                        "unit_rate": 1250,
                    },
                    {
                        "product_id": str(ids["spare_b_id"]),
                        "product_name": "PTFE Teflon Belt",
                        "product_code": "SP-TEF-02",
                        "uom": "NOS",
                        "quantity_issued": 2,
                        "unit_rate": 450,
                    },
                ],
            },
        )
        assert ok_gp.status_code == 201
        gp_data = ok_gp.json()["data"]
        assert gp_data["stock_deducted"] is True
        assert await _stock_qty(maker, ids["spare_a_id"]) == 2  # 5 - 3
        assert await _stock_qty(maker, ids["spare_b_id"]) == 2  # 4 - 2

        # 4. Verify pagination meta includes both total and total_records
        r_list = await client.get("/api/v1/technician-operations/gatepasses")
        assert r_list.status_code == 200
        pag = r_list.json()["meta"]["pagination"]
        assert pag["total"] == 1
        assert pag["total_records"] == 1


@pytest.mark.asyncio
async def test_partial_return_stock_conservation_and_linked_sales_order_lifecycle(env):
    maker, ids, build_app = env
    async with AsyncClient(transport=ASGITransport(app=build_app(ADMIN)), base_url="http://test") as client:
        # Issue ALL 5 units of Spare A and 2 units of Spare B -> Spare A shelf stock becomes 0!
        res = await client.post(
            "/api/v1/technician-operations/gatepasses",
            json={
                "technician_id": str(ids["tech_id"]),
                "technician_name": "Ramesh Kumar",
                "warehouse_name": "Mumbai",
                "company_id": str(ids["company_id"]),
                "customer_name": "Apex Packaging Ltd",
                "machine_model": "Band Sealer 900",
                "machine_serial_number": "SN-BS900-77",
                "purpose": "Emergency jaw heater replacement",
                "items": [
                    {
                        "product_id": str(ids["spare_a_id"]),
                        "product_name": "Heating Element 240V",
                        "product_code": "SP-HEAT-01",
                        "uom": "NOS",
                        "quantity_issued": 5,
                        "unit_rate": 1250,
                    },
                    {
                        "product_id": str(ids["spare_b_id"]),
                        "product_name": "PTFE Teflon Belt",
                        "product_code": "SP-TEF-02",
                        "uom": "NOS",
                        "quantity_issued": 2,
                        "unit_rate": 450,
                    },
                ],
            },
        )
        assert res.status_code == 201
        gp = res.json()["data"]
        gp_id = gp["id"]
        item_a = next(i for i in gp["items"] if i["product_code"] == "SP-HEAT-01")
        item_b = next(i for i in gp["items"] if i["product_code"] == "SP-TEF-02")

        assert await _stock_qty(maker, ids["spare_a_id"]) == 0  # 5 - 5 = 0 on shelf!
        assert await _stock_qty(maker, ids["spare_b_id"]) == 2  # 4 - 2 = 2 on shelf

        # 1. Reject invalid return where returned + consumed > issued (4 + 2 > 5)
        bad_ret = await client.post(
            f"/api/v1/technician-operations/gatepasses/{gp_id}/return",
            json={
                "items": [
                    {
                        "item_id": item_a["id"],
                        "quantity_returned": 4,
                        "quantity_consumed": 2,
                        "is_warranty_covered": False,
                        "item_status": "CONSUMED_BILLED",
                    }
                ]
            },
        )
        assert bad_ret.status_code == 400

        # 2. Record partial return:
        #    - Item A: 2 RETURNED_GOOD + 3 CONSUMED_BILLED (chargeable) -> restores +2 to Spare A shelf stock!
        #    - Item B: 2 RETURNED_DEFECTIVE + 0 consumed -> does NOT restore defective units to good stock!
        ok_ret = await client.post(
            f"/api/v1/technician-operations/gatepasses/{gp_id}/return",
            json={
                "return_gatepass_number": "RGP-2026-001",
                "notes": "3 heaters used on machine; 2 good heaters returned; 2 teflon belts damaged",
                "items": [
                    {
                        "item_id": item_a["id"],
                        "quantity_returned": 2,
                        "quantity_consumed": 3,
                        "is_warranty_covered": False,
                        "item_status": "RETURNED_GOOD",
                    },
                    {
                        "item_id": item_b["id"],
                        "quantity_returned": 2,
                        "quantity_consumed": 0,
                        "is_warranty_covered": False,
                        "item_status": "RETURNED_DEFECTIVE",
                    },
                ],
            },
        )
        assert ok_ret.status_code == 200
        gp_after_ret = ok_ret.json()["data"]
        assert gp_after_ret["so_required"] is True
        assert gp_after_ret["so_created"] is False
        assert gp_after_ret["status"] == "PARTIALLY_RETURNED"

        # Shelf stock of Spare A is now 2 (0 + 2 good returned). Shelf stock of Spare B stays 2 (defective not added).
        assert await _stock_qty(maker, ids["spare_a_id"]) == 2
        assert await _stock_qty(maker, ids["spare_b_id"]) == 2

        # 3. Verify Draft SO payload contains company metadata + HSN/GST + 3 chargeable units of Spare A
        draft_res = await client.get(f"/api/v1/technician-operations/gatepasses/{gp_id}/draft-so")
        assert draft_res.status_code == 200
        draft = draft_res.json()["data"]
        assert draft["company_id"] == str(ids["company_id"])
        assert draft["city"] == "Mumbai"
        assert draft["warehouse_name"] == "Mumbai"
        assert len(draft["items_to_bill"]) == 1
        assert draft["items_to_bill"][0]["quantity"] == 3.0
        assert draft["items_to_bill"][0]["hsn_code"] == "84229090"

        # 4. Reject linking a non-existent Sales Order number (400/404)
        fake_link = await client.post(
            f"/api/v1/technician-operations/gatepasses/{gp_id}/link-so",
            json={"sales_order_number": "SO-DOES-NOT-EXIST"},
        )
        assert fake_link.status_code in (400, 404)

        # 5. Create a real Sales Order for 3 units of Spare A linked to technician_gatepass_id!
        #    Note: Shelf stock of Spare A is only 2, which would fail a normal 3-unit SO with 409,
        #    but succeeds because 3 units are already held by this technician gatepass (2 + 3 - 3 = 2)!
        so_res = await client.post(
            "/api/v1/sales/orders",
            json={
                "buyer_name": "Apex Packaging Ltd",
                "company_name": "Apex Packaging Ltd",
                "buyer_id": str(ids["company_id"]),
                "order_date": date.today().isoformat(),
                "warehouse": "Mumbai",
                "sales_person": "admin",
                "technician_gatepass_id": gp_id,
                "items": [
                    {
                        "product_id": str(ids["spare_a_id"]),
                        "product_name": "Heating Element 240V",
                        "hsn_code": "84229090",
                        "quantity": 3,
                        "uom": "NOS",
                        "unit_rate": 1250,
                        "tax_percent": 18,
                    }
                ],
            },
        )
        assert so_res.status_code == 201, so_res.text
        so_data = so_res.json()["data"]
        so_id = so_data["id"]
        so_number = so_data["order_no"]
        assert so_data["stock_applied"] is True

        # Gatepass is now auto-linked & CLOSED, and shelf stock stays at 2 (2 + 3 released - 3 taken = 2, no double deduction!)
        gp_linked = (await client.get(f"/api/v1/technician-operations/gatepasses/{gp_id}")).json()["data"]
        assert gp_linked["so_created"] is True
        assert gp_linked["so_number"] == so_number
        assert gp_linked["sale_order_id"] == so_id
        assert gp_linked["status"] == "CLOSED"
        assert await _stock_qty(maker, ids["spare_a_id"]) == 2

        # 6. Confirm Sales Order (pending -> sales_confirmed):
        confirm_res = await client.patch(
            f"/api/v1/sales/orders/{so_id}/status",
            json={"status": "Sales Confirmed"},
        )
        assert confirm_res.status_code == 200, confirm_res.text
        assert await _stock_qty(maker, ids["spare_a_id"]) == 2

        # 7. Cancel the confirmed Sales Order:
        #    SO restores +3, Gatepass re-acquires its 3-unit hold (-3) -> shelf stock stays 2,
        #    and Gatepass reverts to PARTIALLY_RETURNED with so_required=True & so_created=False!
        cancel_res = await client.patch(
            f"/api/v1/sales/orders/{so_id}/status",
            json={"status": "cancelled", "remarks": "Wrong GSTIN on customer PO"},
        )
        assert cancel_res.status_code == 200, cancel_res.text
        assert await _stock_qty(maker, ids["spare_a_id"]) == 2

        gp_unlinked = (await client.get(f"/api/v1/technician-operations/gatepasses/{gp_id}")).json()["data"]
        assert gp_unlinked["so_created"] is False
        assert gp_unlinked["so_number"] is None
        assert gp_unlinked["so_required"] is True
        assert gp_unlinked["status"] == "PARTIALLY_RETURNED"


@pytest.mark.asyncio
async def test_so_serial_numbers_auto_sync_to_warranty_and_serial_lookup(env):
    _, ids, build_app = env
    async with AsyncClient(transport=ASGITransport(app=build_app(ADMIN)), base_url="http://test") as client:
        so_res = await client.post(
            "/api/v1/sales/orders",
            json={
                "buyer_name": "Apex Packaging Ltd",
                "company_name": "Apex Packaging Ltd",
                "buyer_id": str(ids["company_id"]),
                "order_date": date.today().isoformat(),
                "warehouse": "Mumbai",
                "city": "Mumbai",
                "sales_person": "admin",
                "items": [
                    {
                        "product_id": str(ids["machine_id"]),
                        "product_name": "Band Sealer 900",
                        "hsn_code": "84229090",
                        "quantity": 2,
                        "uom": "NOS",
                        "unit_rate": 45000,
                        "tax_percent": 18,
                        "serial_numbers": ["SN-AUTO-9001", "SN-AUTO-9002"],
                    }
                ],
            },
        )
        assert so_res.status_code == 201, so_res.text

        # Validate serial in Technician Ops Warranty Validator
        v1 = await client.get("/api/v1/technician-operations/warranty/validate?serial=SN-AUTO-9001")
        assert v1.status_code == 200
        v1_data = v1.json()["data"]
        assert v1_data["is_registered"] is True
        assert v1_data["is_covered"] is True
        assert v1_data["company_name"] == "Apex Packaging Ltd"
        assert v1_data["machine_model"] == "Band Sealer 900"

        # Validate serial in Technical Task creation serial-lookup endpoint
        v2 = await client.get("/api/v1/technical-tasks/serial-lookup/SN-AUTO-9002")
        assert v2.status_code == 200
        v2_data = v2.json()["data"]
        assert v2_data["serial_number"] == "SN-AUTO-9002"
        assert v2_data["warranty_status"] == "UNDER_WARRANTY"
        assert v2_data["company_name"] == "Apex Packaging Ltd"


@pytest.mark.asyncio
async def test_technical_task_cancel_reverses_self_collect_wallet(env):
    _, _, build_app = env
    async with AsyncClient(transport=ASGITransport(app=build_app(ADMIN)), base_url="http://test") as client:
        # Case A: Partial Self collect on Approved task -> Cancel task -> Wallet reversed to 0
        t_res = await client.post(
            "/api/v1/technical-tasks",
            json={
                "company_name": "Apex Packaging Ltd",
                "contact_phone": "9820011223",
                "task_type": "Outer",
                "city": "Mumbai",
                "machine_model": "Band Sealer 900",
                "task_description": "On-site servicing",
                "service_type": "Chargeable",
                "service_charge": 3500,
                "payment_terms": "On completion",
            },
        )
        assert t_res.status_code == 201
        tid = t_res.json()["data"]["id"]

        await client.patch(
            f"/api/v1/technical-tasks/{tid}/status",
            json={"status": "Approved", "task_allotted_to": "Ramesh Kumar"},
        )
        pay_res = await client.post(
            f"/api/v1/technical-tasks/{tid}/record-payment",
            json={"amount": 2000, "payment_mode": "Self collect", "reference_no": "CASH-ADV-2000"},
        )
        assert pay_res.status_code == 200

        # Wallet shows +2000 cash in hand for Ramesh Kumar (linked to technician_id!)
        bal1 = (await client.get("/api/v1/technician-operations/wallet/summaries")).json()["data"]
        ramesh_bal = next(b for b in bal1 if b["technician_name"] == "Ramesh Kumar")
        assert ramesh_bal["net_wallet_balance"] == 2000.0
        assert ramesh_bal["technician_id"] is not None

        # Cancel the Technical Task -> reverses the Self collect wallet entry
        cancel_res = await client.patch(
            f"/api/v1/technical-tasks/{tid}/status",
            json={"status": "Cancel", "cancel_remarks": "Entered on wrong customer ticket"},
        )
        assert cancel_res.status_code == 200

        bal2 = (await client.get("/api/v1/technician-operations/wallet/summaries")).json()["data"]
        assert all(b["net_wallet_balance"] == 0 for b in bal2)

        # Case B: Completed Self collect task -> Admin Delete -> Wallet reversed to 0
        t2_res = await client.post(
            "/api/v1/technical-tasks",
            json={
                "company_name": "Apex Packaging Ltd",
                "contact_phone": "9820011223",
                "task_type": "Outer",
                "city": "Mumbai",
                "machine_model": "Band Sealer 900",
                "task_description": "Full completion test",
                "service_type": "Chargeable",
                "service_charge": 3500,
                "payment_terms": "On completion",
            },
        )
        tid2 = t2_res.json()["data"]["id"]
        await client.patch(
            f"/api/v1/technical-tasks/{tid2}/status",
            json={"status": "Approved", "task_allotted_to": "Ramesh Kumar"},
        )
        await client.patch(
            f"/api/v1/technical-tasks/{tid2}/status",
            json={"status": "Completed", "payment_collected": True, "payment_mode": "Self collect", "collected_amount": 3500},
        )
        bal3 = (await client.get("/api/v1/technician-operations/wallet/summaries")).json()["data"]
        assert next(b for b in bal3 if b["technician_name"] == "Ramesh Kumar")["net_wallet_balance"] == 3500.0

        del_res = await client.delete(f"/api/v1/technical-tasks/{tid2}")
        assert del_res.status_code in (200, 204)

        bal4 = (await client.get("/api/v1/technician-operations/wallet/summaries")).json()["data"]
        assert all(b["net_wallet_balance"] == 0 for b in bal4)


@pytest.mark.asyncio
async def test_rbac_enforcement_on_technician_operations(env):
    _, _, build_app = env

    # Unprivileged user -> 403 on read and write
    async with AsyncClient(transport=ASGITransport(app=build_app(UNPRIVILEGED)), base_url="http://test") as guest:
        assert (await guest.get("/api/v1/technician-operations/gatepasses")).status_code == 403
        assert (await guest.get("/api/v1/technician-operations/lookups")).status_code == 403
        assert (
            await guest.post(
                "/api/v1/technician-operations/wallet/transactions",
                json={"technician_name": "Ramesh Kumar", "transaction_type": "COLLECTION", "amount": 500},
            )
        ).status_code == 403

    # Read-only viewer (technicaltask.view) -> 200 on GET, 403 on POST mutations
    async with AsyncClient(transport=ASGITransport(app=build_app(TECH_VIEWER)), base_url="http://test") as viewer:
        assert (await viewer.get("/api/v1/technician-operations/gatepasses")).status_code == 200
        assert (await viewer.get("/api/v1/technician-operations/lookups")).status_code == 200
        assert (
            await viewer.post(
                "/api/v1/technician-operations/wallet/transactions",
                json={"technician_name": "Ramesh Kumar", "transaction_type": "COLLECTION", "amount": 500},
            )
        ).status_code == 403
