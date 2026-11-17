"""Integration tests for the Cargo Overview module (migration, RBAC, CRUD, gallery, checklist, extractor)."""

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

from app.auth.dependencies import get_current_user  # noqa: E402
from app.auth.service import CurrentUser  # noqa: E402
from app.cargo_overview.extractor import CargoDataExtractor, ExtractedCargoRecord  # noqa: E402
from app.cargo_overview.routes import router as cargo_overview_router  # noqa: E402
from app.cargo_overview.schemas import CargoFinanceLine, CargoProductLine  # noqa: E402
from app.cargo_overview.service import CargoOverviewService  # noqa: E402
from app.core.constants import RecordStatus  # noqa: E402
from app.core.exception_handlers import register_exception_handlers  # noqa: E402
from app.database.base import Base  # noqa: E402
from app.database.session import get_db_session  # noqa: E402
from app.masters.warehouses.models import Warehouse  # noqa: E402

VERSIONS = Path(__file__).resolve().parents[1] / "alembic" / "versions"
CARGO_MIGRATION = "z9a0b1c2d3e4_create_cargo_overviews.py"

TABLES = [
    Warehouse.__table__,
]

REPORT_USER = CurrentUser(id=uuid.uuid4(), username="cargo_mgr", permissions={"report.view"})
GRANULAR_VIEW_ONLY = CurrentUser(
    id=uuid.uuid4(),
    username="cargo_viewer",
    permissions={"cargo_overview.view", "cargo_overview.gallery.view"},
)
UNPRIVILEGED = CurrentUser(id=uuid.uuid4(), username="guest", permissions=set())


def _migrate(sync_conn, filename: str, direction: str = "upgrade") -> None:
    spec = importlib.util.spec_from_file_location(filename[:-3], VERSIONS / filename)
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    with Operations.context(MigrationContext.configure(sync_conn)):
        getattr(module, direction)()


@pytest_asyncio.fixture
async def cargo_env(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    engine = create_async_engine(
        "sqlite+aiosqlite://",
        poolclass=StaticPool,
        connect_args={"check_same_thread": False},
    )
    async with engine.begin() as conn:
        await conn.run_sync(lambda c: Base.metadata.create_all(c, tables=TABLES))
        await conn.run_sync(_migrate, CARGO_MIGRATION, "upgrade")

    maker = async_sessionmaker(engine, expire_on_commit=False)

    app = FastAPI()
    register_exception_handlers(app)
    app.include_router(cargo_overview_router, prefix="/api/v1")

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
        yield {"client": client, "maker": maker, "state": state, "engine": engine}

    await engine.dispose()


@pytest.mark.asyncio
async def test_cargo_overview_empty_state_and_rbac(cargo_env):
    client: AsyncClient = cargo_env["client"]
    maker = cargo_env["maker"]

    async with maker() as s:
        s.add(
            Warehouse(
                id=uuid.uuid4(),
                name="Mumbai Main",
                address="Andheri East",
                billing_company="Inhyma Solutions",
                status=RecordStatus.ACTIVE,
            )
        )
        await s.commit()

    cargo_env["state"]["user"] = UNPRIVILEGED
    forbidden = await client.get("/api/v1/cargo-overview")
    assert forbidden.status_code == 403

    cargo_env["state"]["user"] = REPORT_USER
    resp = await client.get("/api/v1/cargo-overview")
    assert resp.status_code == 200
    payload = resp.json()["data"]
    assert payload["total_consignments"] == 0
    assert payload["warehouses"] == ["Mumbai Main"]
    assert payload["items"] == []

    # Granular viewer can read, but cannot edit checklist
    cargo_env["state"]["user"] = GRANULAR_VIEW_ONLY
    view_resp = await client.get("/api/v1/cargo-overview")
    assert view_resp.status_code == 200
    deny_edit = await client.patch(
        "/api/v1/cargo-overview/checklist?key=MUM-101",
        json={"checklist": {"draft_bl_received": True}},
    )
    assert deny_edit.status_code == 403


@pytest.mark.asyncio
async def test_cargo_overview_crud_checklist_gallery_and_export(cargo_env):
    client: AsyncClient = cargo_env["client"]

    # 1. Create / upsert a Cargo Overview record
    create_resp = await client.post(
        "/api/v1/cargo-overview",
        json={
            "consignment_key": "SBC-HH2026041412",
            "display_title": "SBC-HH2026041412",
            "invoice_or_order_no": "SBC-HH2026041412",
            "batch_no": "201",
            "supplier_name": "SHANDONG RUIDESHENG INTERNATIONAL TRADE CO.,LTD",
            "warehouse": "Mumbai Main",
            "ordered_date": "2026-04-14",
            "etd_origin_date": "2026-05-20",
            "eta_port_date": "2026-06-23",
            "expected_arrival_date": "2026-06-28",
            "forwarder_name": "Maersk Logistics",
            "clearing_agent_name": "Liladhar Pasoo",
            "finance_lines": [
                {
                    "id": "fin-1",
                    "role": "Supplier",
                    "party_name": "SHANDONG RUIDESHENG INTERNATIONAL TRADE CO.,LTD",
                    "doc_no": "SBC-HH2026041412",
                    "payment_terms": "100% Advance",
                    "currency": "USD",
                    "total_amount": 14148.0,
                    "paid_amount": 14148.0,
                    "balance_amount": 0.0,
                    "due_date": "2026-06-23",
                    "stage": "cleared",
                },
                {
                    "id": "fin-2",
                    "role": "Taxes",
                    "party_name": "Total Taxes (INR)",
                    "doc_no": "SBC-HH2026041412",
                    "currency": "INR",
                    "total_amount": 245000.0,
                    "paid_amount": 100000.0,
                    "balance_amount": 145000.0,
                    "due_date": "2026-06-25",
                    "stage": "pending",
                },
            ],
            "products": [
                {
                    "sr_no": 1,
                    "product_name": "Sodium Bicarbonate-25kg",
                    "product_code": "SBC-25",
                    "quantity": 2160,
                    "uom": "BAG",
                    "batch_no": "201",
                }
            ],
        },
    )
    assert create_resp.status_code == 201
    row = create_resp.json()["data"]
    assert row["docs_total_count"] == 22
    assert row["checklist_total_count"] == 12
    assert row["overall_stage"] == "pending"
    assert len(row["finance_rows"]) == 2
    assert len(row["products"]) == 1

    # 2. Toggle checklist items & update cargo remarks
    patch_resp = await client.patch(
        "/api/v1/cargo-overview/checklist?key=SBC-HH2026041412",
        json={
            "checklist": {"draft_bl_received": True, "final_bl_received": True},
            "cargo_remarks": "Container cleared customs at JNPT",
        },
    )
    assert patch_resp.status_code == 200

    # 3. Upload & delete a document in Consignment Gallery
    upload_resp = await client.post(
        "/api/v1/cargo-overview/documents?key=SBC-HH2026041412&slot_key=proforma_invoice",
        files={"file": ("pi_doc.pdf", b"%PDF-1.4 dummy content", "application/pdf")},
    )
    assert upload_resp.status_code == 201
    slot_data = upload_resp.json()["data"]
    assert slot_data["slot_key"] == "proforma_invoice"
    assert slot_data["filename"] == "pi_doc.pdf"
    assert slot_data["file_url"]

    detail_resp = await client.get("/api/v1/cargo-overview/detail?key=SBC-HH2026041412")
    assert detail_resp.status_code == 200
    detail = detail_resp.json()["data"]
    assert detail["checklist_yes_count"] == 2
    assert detail["docs_uploaded_count"] == 1
    assert detail["cargo_remarks"] == "Container cleared customs at JNPT"
    assert detail["pi_file_url"] == slot_data["file_url"]

    del_resp = await client.delete(
        "/api/v1/cargo-overview/documents?key=SBC-HH2026041412&slot_key=proforma_invoice"
    )
    assert del_resp.status_code == 200

    detail_after_del = (
        await client.get("/api/v1/cargo-overview/detail?key=SBC-HH2026041412")
    ).json()["data"]
    assert detail_after_del["docs_uploaded_count"] == 0
    assert detail_after_del["pi_file_url"] is None

    # 4. CSV export
    export_resp = await client.get("/api/v1/cargo-overview/export")
    assert export_resp.status_code == 200
    assert "SBC-HH2026041412" in export_resp.text


@pytest.mark.asyncio
async def test_cargo_overview_pluggable_extractor_merge(cargo_env):
    maker = cargo_env["maker"]

    class MockExtractor(CargoDataExtractor):
        async def extract_all(self, session):
            return [
                ExtractedCargoRecord(
                    consignment_key="IMP-2026-99",
                    display_title="IMP-2026-99",
                    invoice_or_order_summary="IMP-2026-99",
                    source_module="import_purchase",
                    supplier_summary="GLOBAL EXPORTS LTD",
                    warehouse="Mumbai Main",
                    ordered_date=date(2026, 7, 1),
                    auto_linked_docs={
                        "commercial_invoice": {
                            "url": "/api/v1/purchase/import-orders/123/bill-file",
                            "filename": "ci_99.pdf",
                            "source": "Import Purchase",
                        }
                    },
                    finance_rows=[
                        CargoFinanceLine(
                            id="imp-99-sup",
                            role="Supplier",
                            party_name="GLOBAL EXPORTS LTD",
                            doc_no="IMP-2026-99",
                            currency="USD",
                            total_amount=5000.0,
                            paid_amount=5000.0,
                            balance_amount=0.0,
                            stage="cleared",
                        )
                    ],
                    products=[
                        CargoProductLine(
                            sr_no=1,
                            product_name="Auto Shrink Tunnel",
                            quantity=2,
                            uom="PCS",
                            batch_no="B-99",
                        )
                    ],
                )
            ]

    async with maker() as s:
        svc = CargoOverviewService(s, extractor=MockExtractor())
        await svc.update_cargo_status(
            consignment_key="IMP-2026-99",
            payload=type("P", (), {
                "checklist": {"draft_bl_received": True},
                "cargo_remarks": "Merged with overlay",
                "model_dump": lambda self, exclude_unset=True: {"cargo_remarks": "Merged with overlay"},
            })(),
        )
        listed = await svc.list_overviews()
        assert listed.total_consignments == 1
        item = listed.items[0]
        assert item.consignment_key == "IMP-2026-99"
        assert item.overall_stage == "cleared"
        assert item.docs_uploaded_count == 1
        assert item.checklist_yes_count == 1
        assert item.cargo_remarks == "Merged with overlay"
        assert item.products[0].product_name == "Auto Shrink Tunnel"
