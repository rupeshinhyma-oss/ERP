"""Integration tests for Financial Planning Report live 3-module wiring and persistent overlays."""

from __future__ import annotations

import importlib
import importlib.util
import uuid
from datetime import date, datetime, timezone
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

from app.auth.dependencies import get_current_user  # noqa: E402
from app.auth.service import CurrentUser  # noqa: E402
from app.buyers.models import Buyer  # noqa: E402
from app.core.constants import RecordStatus  # noqa: E402
from app.core.exception_handlers import register_exception_handlers  # noqa: E402
from app.database.base import Base  # noqa: E402
from app.database.session import get_db_session  # noqa: E402
from app.financial_planning.routes import router as financial_planning_router  # noqa: E402
from app.masters.company_list.models import MasterCompany  # noqa: E402
from app.masters.payment_terms.models import PaymentTerm  # noqa: E402
from app.masters.products.models import Product  # noqa: E402
from app.planning.models import PlanningColumn, PlanningRow, PlanningSheet  # noqa: E402
from app.purchase.models import ImportPurchase, ImportPurchaseItem, LocalPurchase, LocalPurchaseItem  # noqa: E402
from app.sales.models import SaleOrder, SaleOrderItem  # noqa: E402
from app.users.models import User  # noqa: E402

VERSIONS = Path(__file__).resolve().parents[1] / "alembic" / "versions"
FP_MIGRATION = "z8f9a0b1c2d3_create_financial_planning_entries.py"

TABLES = [
    User.__table__,
    MasterCompany.__table__,
    Buyer.__table__,
    PaymentTerm.__table__,
    PlanningSheet.__table__,
    PlanningColumn.__table__,
    PlanningRow.__table__,
    Product.__table__,
    LocalPurchase.__table__,
    LocalPurchaseItem.__table__,
    ImportPurchase.__table__,
    ImportPurchaseItem.__table__,
    SaleOrder.__table__,
    SaleOrderItem.__table__,
]

REPORT_USER = CurrentUser(id=uuid.uuid4(), username="finance_mgr", permissions={"report.view"})
UNPRIVILEGED = CurrentUser(id=uuid.uuid4(), username="guest", permissions=set())


def _migrate(sync_conn, filename: str, direction: str = "upgrade") -> None:
    spec = importlib.util.spec_from_file_location(filename[:-3], VERSIONS / filename)
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    with Operations.context(MigrationContext.configure(sync_conn)):
        getattr(module, direction)()


@pytest_asyncio.fixture
async def fp_env():
    engine = create_async_engine(
        "sqlite+aiosqlite://",
        poolclass=StaticPool,
        connect_args={"check_same_thread": False},
    )
    async with engine.begin() as conn:
        await conn.run_sync(lambda c: Base.metadata.create_all(c, tables=TABLES))
        # Apply the real Alembic migration to create financial_planning_entries
        await conn.run_sync(_migrate, FP_MIGRATION, "upgrade")

    maker = async_sessionmaker(engine, expire_on_commit=False)

    app = FastAPI()
    register_exception_handlers(app)
    app.include_router(financial_planning_router, prefix="/api/v1")

    state = {"user": REPORT_USER}

    async def _override_db():
        async with maker() as session:
            yield session
            await session.commit()

    async def _override_user():
        return state["user"]

    app.dependency_overrides[get_db_session] = _override_db
    app.dependency_overrides[get_current_user] = _override_user

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        yield {"client": client, "maker": maker, "state": state}

    await engine.dispose()


@pytest.mark.asyncio
async def test_empty_state_and_rbac_guard(fp_env):
    client: AsyncClient = fp_env["client"]
    maker = fp_env["maker"]

    async with maker() as s:
        s.add(PaymentTerm(name="Net 45 Days", status=RecordStatus.ACTIVE))
        await s.commit()

    resp = await client.get("/api/v1/financial-planning")
    assert resp.status_code == 200
    body = resp.json()["data"]
    assert body["items"] == []
    assert body["kpis"]["inr_all"] == 0.0
    assert body["kpis"]["usd_all"] == 0.0
    assert "Net 45 Days" in body["payment_terms_options"]

    # Unprivileged user blocked with 403
    fp_env["state"]["user"] = UNPRIVILEGED
    resp_forbidden = await client.get("/api/v1/financial-planning")
    assert resp_forbidden.status_code == 403


@pytest.mark.asyncio
async def test_import_local_and_sales_acc_confirmed_stage_wiring(fp_env):
    client: AsyncClient = fp_env["client"]
    maker = fp_env["maker"]

    imp_id = uuid.uuid4()
    loc_id = uuid.uuid4()
    so_id = uuid.uuid4()

    async with maker() as s:
        # 1. Import Purchase starts in 'pending'
        imp = ImportPurchase(
            id=imp_id,
            consignment_no="SBC-HH2026041412",
            supplier_name="SHANDONG RUIDESHENG INTERNATIONAL TRADE CO.,LIMITED",
            warehouse="Mumbai",
            ordered_date=date(2026, 6, 1),
            expected_arrival_date=date(2026, 6, 23),
            invoice_total_usd=14148.0,
            invoice_total_inr=1202580.0,
            total_import_duty=105000.0,
            stamp_duty=5000.0,
            bill_file_url="/uploads/private/purchases/imp_inv.pdf",
            bill_file_name="imp_inv.pdf",
            status="pending",
            created_by="Admin",
        )
        # 2. Local Purchase starts in 'pending'
        loc = LocalPurchase(
            id=loc_id,
            supplier_name="SHREE BALAJI PACKAGING",
            warehouse="Mumbai",
            invoice_no="LP-INV-2026-09",
            invoice_date=date(2026, 7, 1),
            invoice_value_ex_gst=50000.0,
            invoice_value_inc_gst=59000.0,
            status="pending",
            created_by="Admin",
        )
        # 3. SaleOrder starts in 'pending'
        so = SaleOrder(
            id=so_id,
            order_no="SO-2026-0042",
            buyer_name="ACME GLOBAL PACKAGING PVT LTD",
            company_name="ACME GLOBAL PACKAGING PVT LTD",
            warehouse="Mumbai",
            order_date="02-07-2026",
            invoice_no="TI/26-27/108",
            invoice_date="04-07-2026",
            payment_terms="30 Days Credit",
            tally_bill_url="/uploads/private/sales_tally_bills/tally_108.pdf",
            tally_bill_name="tally_108.pdf",
            currency="INR",
            amount_inc_gst=236000.0,
            total_amount=236000.0,
            status="pending",
        )
        s.add_all([imp, loc, so])
        await s.commit()

    # None of the pending records should appear
    r0 = (await client.get("/api/v1/financial-planning")).json()["data"]
    assert r0["items"] == []

    # Advance SaleOrder through pre-Accounts stages (sales_confirmed -> admin_approved): MUST STILL NOT APPEAR
    for pre_stage in ("sales_confirmed", "confirmed", "admin_approved"):
        async with maker() as s:
            so_obj = await s.get(SaleOrder, so_id)
            assert so_obj is not None
            so_obj.status = pre_stage
            await s.commit()
        r_pre = (await client.get("/api/v1/financial-planning")).json()["data"]
        assert r_pre["items"] == [], f"Stage {pre_stage} should not appear before Acc. Confirmed"

    # Now transition ImportPurchase -> confirmed, LocalPurchase -> confirmed, SaleOrder -> acc_confirmed
    async with maker() as s:
        imp_obj = await s.get(ImportPurchase, imp_id)
        loc_obj = await s.get(LocalPurchase, loc_id)
        so_obj = await s.get(SaleOrder, so_id)
        assert imp_obj and loc_obj and so_obj
        imp_obj.status = "confirmed"
        imp_obj.confirmed_at = datetime(2026, 7, 4, 10, 0, tzinfo=timezone.utc)
        loc_obj.status = "confirmed"
        loc_obj.confirmed_at = datetime(2026, 7, 4, 11, 0, tzinfo=timezone.utc)
        so_obj.status = "acc_confirmed"
        await s.commit()

    r1 = (await client.get("/api/v1/financial-planning")).json()["data"]
    items = r1["items"]
    assert len(items) == 4  # Import Supplier (USD) + Import Taxes (INR) + Local Supplier (INR) + Sales Customer (INR)

    by_key = {row["entry_key"]: row for row in items}
    imp_sup = by_key[f"import_purchase:{imp_id}:supplier"]
    imp_tax = by_key[f"import_purchase:{imp_id}:taxes"]
    loc_sup = by_key[f"local_purchase:{loc_id}:supplier"]
    so_cli = by_key[f"sales_process:{so_id}:client"]

    # Verify Import Supplier (USD)
    assert imp_sup["party_name"] == "SHANDONG RUIDESHENG INTERNATIONAL TRADE CO.,LIMITED"
    assert imp_sup["party_type"] == "Supplier"
    assert imp_sup["currency"] == "USD"
    assert imp_sup["total_amount"] == 14148.0
    assert imp_sup["due_date"] == "23-06-2026"
    assert imp_sup["invoice_attachment_url"] == f"/api/v1/purchase/import-orders/{imp_id}/bill-file"

    # Verify Import Taxes (INR default, never UGX)
    assert imp_tax["party_name"] == "Total Taxes (INR)"
    assert imp_tax["party_type"] == "Taxes"
    assert imp_tax["currency"] == "INR"
    assert imp_tax["total_amount"] == 110000.0  # 105000 duty + 5000 stamp

    # Verify Local Purchase Supplier (INR)
    assert loc_sup["party_name"] == "SHREE BALAJI PACKAGING"
    assert loc_sup["party_type"] == "Supplier"
    assert loc_sup["currency"] == "INR"
    assert loc_sup["total_amount"] == 59000.0
    assert loc_sup["due_date"] == "01-07-2026"

    # Verify Sales Process Customer (Acc. Confirmed, INR)
    assert so_cli["party_name"] == "ACME GLOBAL PACKAGING PVT LTD"
    assert so_cli["party_type"] == "Customer"
    assert so_cli["currency"] == "INR"
    assert so_cli["invoice_no"] == "TI/26-27/108"
    assert so_cli["payment_terms"] == "30 Days Credit"
    assert so_cli["total_amount"] == 236000.0
    assert so_cli["source_stage"] == "Acc. Confirmed"
    assert so_cli["invoice_attachment_url"] == "/uploads/private/sales_tally_bills/tally_108.pdf"

    # Verify KPI totals: INR = 110000 + 59000 + 236000 = 405000 (3 rows); USD = 14148 (1 row)
    kpis = r1["kpis"]
    assert kpis["inr_all"] == 405000.0
    assert kpis["inr_count"] == 3
    assert kpis["usd_all"] == 14148.0
    assert kpis["usd_count"] == 1
    assert kpis["pending_count"] == 4
    assert kpis["cleared_count"] == 0

    # Advancing ImportPurchase -> received and SaleOrder -> dispatched keeps them in Financial Planning Report
    async with maker() as s:
        imp_obj = await s.get(ImportPurchase, imp_id)
        so_obj = await s.get(SaleOrder, so_id)
        assert imp_obj and so_obj
        imp_obj.status = "received"
        so_obj.status = "dispatched"
        await s.commit()

    r2 = (await client.get("/api/v1/financial-planning")).json()["data"]
    assert len(r2["items"]) == 4

    # Persistence: Update Payment Terms, Attach Tax Voucher, and Record Payment to Cleared
    imp_sup_key = f"import_purchase:{imp_id}:supplier"
    terms_resp = await client.patch(
        f"/api/v1/financial-planning/entries/{imp_sup_key}/terms",
        json={"payment_terms": "100% Advance", "due_date": "2026-06-30", "remarks": "TT Swift planned"},
    )
    assert terms_resp.status_code == 200
    assert terms_resp.json()["data"]["payment_terms"] == "100% Advance"
    assert terms_resp.json()["data"]["due_date"] == "30-06-2026"

    # Attach invoice voucher on Taxes row
    tax_key = f"import_purchase:{imp_id}:taxes"
    att_resp = await client.patch(
        f"/api/v1/financial-planning/entries/{tax_key}/attachment",
        json={
            "attachment_type": "invoice",
            "file_url": "/uploads/private/financial_planning/boe_challan.pdf",
            "file_name": "boe_challan.pdf",
        },
    )
    assert att_resp.status_code == 200
    assert att_resp.json()["data"]["invoice_attachment_url"] == "/uploads/private/financial_planning/boe_challan.pdf"

    # Overpayment rejected
    over_resp = await client.post(
        f"/api/v1/financial-planning/entries/{imp_sup_key}/record-payment",
        json={"amount": 20000.0},
    )
    assert over_resp.status_code == 400

    # Full payment transitions status Pending -> Cleared
    pay_resp = await client.post(
        f"/api/v1/financial-planning/entries/{imp_sup_key}/record-payment",
        json={"amount": 14148.0, "payment_mode": "Wire Transfer", "reference_no": "UTR-9988"},
    )
    assert pay_resp.status_code == 200
    paid_row = pay_resp.json()["data"]
    assert paid_row["paid_amount"] == 14148.0
    assert paid_row["balance_amount"] == 0.0
    assert paid_row["status"] == "Cleared"
    assert len(paid_row["payments_history"]) == 1

    # Reload report and verify Cleared count & USD KPIs persisted
    r3 = (await client.get("/api/v1/financial-planning")).json()["data"]
    assert r3["kpis"]["usd_paid"] == 14148.0
    assert r3["kpis"]["usd_balance"] == 0.0
    assert r3["kpis"]["cleared_count"] == 1
    assert r3["kpis"]["pending_count"] == 3

