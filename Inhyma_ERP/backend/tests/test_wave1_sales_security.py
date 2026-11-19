"""Wave 1 regression tests for BUG-001: Sales Discount Payments & Deleted Orders security.

Verifies:
- Unauthenticated GET, POST, PATCH, and restore requests return HTTP 401.
- Authenticated users without required Sales/Reports permissions receive HTTP 403.
- Read-only report viewers can view lists (HTTP 200) but cannot create, settle, or restore (HTTP 403).
- Authorized Sales/Accounts/Admin users retain full access (create, list, settle, view deleted, restore).
- Empty database returns zero hardcoded seed records (`_DELETED_ORDERS_SEED` absent, `items == []`).
- OpenAPI schema registers bearer security on all discount-payments and deleted-orders operations.
"""

from __future__ import annotations

import importlib
import uuid
from datetime import datetime, timezone
from pathlib import Path

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

from app.auth.dependencies import get_current_user  # noqa: E402
from app.auth.service import CurrentUser  # noqa: E402
from app.companies.models import Company  # noqa: E402
from app.core.exception_handlers import register_exception_handlers  # noqa: E402
from app.database.base import Base  # noqa: E402
from app.database.session import get_db_session  # noqa: E402
from app.sales.models import DiscountPayment, GatePass, SaleOrder, SaleOrderItem  # noqa: E402
from app.sales.routes import router as sales_router  # noqa: E402
from app.users.models import User  # noqa: E402

TABLES = [
    User.__table__,
    Company.__table__,
    SaleOrder.__table__,
    SaleOrderItem.__table__,
    DiscountPayment.__table__,
    GatePass.__table__,
]

UNPRIVILEGED_EMPLOYEE = CurrentUser(
    id=uuid.uuid4(),
    username="employee_basic",
    permissions={"user.view", "task.view", "feed.view", "hrms.attendance"},
)
READ_ONLY_REPORT_USER = CurrentUser(
    id=uuid.uuid4(),
    username="report_viewer",
    permissions={"report.view"},
)
ACCOUNTS_USER = CurrentUser(
    id=uuid.uuid4(),
    username="accounts_exec",
    display_name="Accounts Executive",
    permissions={"saleorder.accounts"},
)
APPROVER_USER = CurrentUser(
    id=uuid.uuid4(),
    username="sales_approver",
    display_name="Sales Approver",
    permissions={"saleorder.approve"},
)
ADMIN_USER = CurrentUser(
    id=uuid.uuid4(),
    username="superadmin",
    display_name="System Admin",
    is_super_admin=True,
)


@pytest_asyncio.fixture
async def sales_sec_env():
    engine = create_async_engine(
        "sqlite+aiosqlite://",
        poolclass=StaticPool,
        connect_args={"check_same_thread": False},
    )
    async with engine.begin() as conn:
        await conn.run_sync(lambda c: Base.metadata.create_all(c, tables=TABLES))

    maker = async_sessionmaker(engine, expire_on_commit=False)

    app = FastAPI()
    register_exception_handlers(app)
    app.include_router(sales_router, prefix="/api/v1")

    state: dict[str, CurrentUser | None] = {"user": None}

    async def _db():
        async with maker() as session:
            try:
                yield session
                await session.commit()
            except BaseException:
                await session.rollback()
                raise

    app.dependency_overrides[get_db_session] = _db

    def _set_user(user: CurrentUser | None) -> None:
        state["user"] = user
        if user is None:
            app.dependency_overrides.pop(get_current_user, None)
        else:
            app.dependency_overrides[get_current_user] = lambda: state["user"]  # type: ignore[return-value]

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        yield {"app": app, "client": client, "maker": maker, "set_user": _set_user}

    await engine.dispose()


@pytest.mark.asyncio
async def test_bug001_unauthenticated_requests_rejected_401(sales_sec_env):
    client: AsyncClient = sales_sec_env["client"]
    sales_sec_env["set_user"](None)

    # Read endpoints must reject unauthenticated callers with 401
    for path in (
        "/api/v1/sales/discount-payments",
        "/api/v1/sales/discount-payments?limit=1",
        "/api/v1/sales/deleted-orders",
        "/api/v1/delete_order_report/list",
        "/api/v1/delete-order-report/list",
    ):
        res = await client.get(path)
        assert res.status_code == 401, f"Expected 401 for GET {path}, got {res.status_code}: {res.text}"

    # Write & restore endpoints must reject unauthenticated callers with 401
    post_dp = await client.post(
        "/api/v1/sales/discount-payments",
        json={
            "order_ref": "SO-SYNTH-0001",
            "customer_name": "Synthetic QA Corp",
            "sales_person": "QA",
            "total_order_amount": 10000.0,
            "discount_percent": 5.0,
        },
    )
    assert post_dp.status_code == 401

    patch_dp = await client.patch(
        f"/api/v1/sales/discount-payments/{uuid.uuid4()}",
        json={"amount": 100.0},
    )
    assert patch_dp.status_code == 401

    for restore_path in (
        f"/api/v1/sales/deleted-orders/{uuid.uuid4()}/restore",
        f"/api/v1/delete_order_report/{uuid.uuid4()}/restore",
        f"/api/v1/delete-order-report/{uuid.uuid4()}/restore",
    ):
        restore_res = await client.post(restore_path)
        assert restore_res.status_code == 401, f"Expected 401 for POST {restore_path}, got {restore_res.status_code}"


@pytest.mark.asyncio
async def test_bug001_authenticated_without_permission_rejected_403(sales_sec_env):
    client: AsyncClient = sales_sec_env["client"]
    sales_sec_env["set_user"](UNPRIVILEGED_EMPLOYEE)

    for path in (
        "/api/v1/sales/discount-payments",
        "/api/v1/sales/deleted-orders",
        "/api/v1/delete_order_report/list",
        "/api/v1/delete-order-report/list",
    ):
        res = await client.get(path)
        assert res.status_code == 403, f"Expected 403 for GET {path}, got {res.status_code}"

    assert (
        await client.post(
            "/api/v1/sales/discount-payments",
            json={
                "order_ref": "SO-SYNTH-0002",
                "customer_name": "Synthetic QA Corp",
                "sales_person": "QA",
                "total_order_amount": 10000.0,
                "discount_percent": 5.0,
            },
        )
    ).status_code == 403

    assert (
        await client.patch(
            f"/api/v1/sales/discount-payments/{uuid.uuid4()}",
            json={"amount": 100.0},
        )
    ).status_code == 403

    assert (
        await client.post(f"/api/v1/sales/deleted-orders/{uuid.uuid4()}/restore")
    ).status_code == 403


@pytest.mark.asyncio
async def test_bug001_readonly_viewer_can_read_but_cannot_mutate_or_restore(sales_sec_env):
    client: AsyncClient = sales_sec_env["client"]
    sales_sec_env["set_user"](READ_ONLY_REPORT_USER)

    # Empty DB: zero hardcoded seed records returned
    dp_list = await client.get("/api/v1/sales/discount-payments")
    assert dp_list.status_code == 200
    assert dp_list.json()["data"]["items"] == []
    assert dp_list.json()["meta"]["total"] == 0

    del_list = await client.get("/api/v1/sales/deleted-orders")
    assert del_list.status_code == 200
    assert del_list.json()["data"]["items"] == []
    assert del_list.json()["data"]["total"] == 0

    # Mutations rejected for read-only report viewer
    assert (
        await client.post(
            "/api/v1/sales/discount-payments",
            json={
                "order_ref": "SO-SYNTH-0003",
                "customer_name": "Synthetic QA Corp",
                "sales_person": "QA",
                "total_order_amount": 10000.0,
                "discount_percent": 5.0,
            },
        )
    ).status_code == 403
    assert (
        await client.patch(
            f"/api/v1/sales/discount-payments/{uuid.uuid4()}",
            json={"amount": 100.0},
        )
    ).status_code == 403
    assert (
        await client.post(f"/api/v1/sales/deleted-orders/{uuid.uuid4()}/restore")
    ).status_code == 403


@pytest.mark.asyncio
async def test_bug001_authorized_discount_payment_and_deleted_order_restore_workflows(sales_sec_env):
    client: AsyncClient = sales_sec_env["client"]
    maker = sales_sec_env["maker"]

    # 1. Accounts user creates and settles a synthetic discount payment
    sales_sec_env["set_user"](ACCOUNTS_USER)
    create_res = await client.post(
        "/api/v1/sales/discount-payments",
        json={
            "order_ref": "SO-SYNTH-2026/0099",
            "customer_name": "Synthetic Packaging QA Ltd",
            "sales_person": "QA Rep",
            "total_order_amount": 50000.0,
            "discount_percent": 10.0,
            "remarks": "Synthetic QA test discount",
        },
    )
    assert create_res.status_code == 201, create_res.text
    created = create_res.json()["data"]
    assert created["total_discount"] == 5000.0
    assert created["due_discount"] == 5000.0
    dp_id = created["id"]

    settle_res = await client.patch(
        f"/api/v1/sales/discount-payments/{dp_id}",
        json={"amount": 2000.0, "settle_date": "18-11-2026", "settle_remarks": "Partial QA installment"},
    )
    assert settle_res.status_code == 200, settle_res.text
    settled = settle_res.json()["data"]
    assert settled["paid_discount"] == 2000.0
    assert settled["due_discount"] == 3000.0
    assert settled["payments"][0]["adjusted_by"] == "Accounts Executive"

    # 2. Insert a soft-deleted synthetic SaleOrder and verify authorized view + restore
    order_id = uuid.uuid4()
    deleted_ts = datetime.now(timezone.utc)
    async with maker() as s:
        s.add(
            SaleOrder(
                id=order_id,
                order_no="SO-SYNTH-DEL-0001",
                buyer_name="Synthetic Deleted Buyer",
                company_name="Synthetic Deleted Buyer",
                warehouse="Mumbai",
                order_date="18-11-2026",
                currency="INR",
                status="pending",
                total_basic=10000.0,
                total_tax=1800.0,
                total_amount=11800.0,
                amount_inc_gst=11800.0,
                total_quantity=1.0,
                deleted_at=deleted_ts,
            )
        )
        await s.commit()

    sales_sec_env["set_user"](APPROVER_USER)
    del_list_res = await client.get("/api/v1/sales/deleted-orders")
    assert del_list_res.status_code == 200
    del_items = del_list_res.json()["data"]["items"]
    assert len(del_items) == 1
    assert del_items[0]["order_no"] == "SO-SYNTH-DEL-0001"

    # Nonexistent order returns 404
    missing_restore = await client.post(f"/api/v1/sales/deleted-orders/{uuid.uuid4()}/restore")
    assert missing_restore.status_code == 404

    # Restore deleted order succeeds for authorized user
    restore_res = await client.post(f"/api/v1/sales/deleted-orders/{order_id}/restore")
    assert restore_res.status_code == 200
    assert restore_res.json()["data"]["restored"] is True

    # Deleted orders list is now empty again
    after_list = await client.get("/api/v1/sales/deleted-orders")
    assert after_list.status_code == 200
    assert after_list.json()["data"]["items"] == []


def test_bug001_openapi_declares_security_on_all_sales_discount_and_deleted_order_routes(sales_sec_env):
    schema = sales_sec_env["app"].openapi()
    paths = schema["paths"]

    expected_protected = [
        ("/api/v1/sales/discount-payments", "get"),
        ("/api/v1/sales/discount-payments", "post"),
        ("/api/v1/sales/discount-payments/{payment_id}", "patch"),
        ("/api/v1/sales/deleted-orders", "get"),
        ("/api/v1/delete_order_report/list", "get"),
        ("/api/v1/delete-order-report/list", "get"),
        ("/api/v1/sales/deleted-orders/{order_id}/restore", "post"),
        ("/api/v1/delete_order_report/{order_id}/restore", "post"),
        ("/api/v1/delete-order-report/{order_id}/restore", "post"),
    ]
    for route_path, method in expected_protected:
        op = paths[route_path][method]
        assert op.get("security"), f"OpenAPI missing security on {method.upper()} {route_path}"
