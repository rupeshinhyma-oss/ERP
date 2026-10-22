"""
Unit & Integration Test for Part 1 RBAC Permissions:
1. Sale Process (sale_process.*)
2. Stock Movements (stock_movement.*)
3. Notification Rules (notification_settings.*)
4. Positions (position.*)
"""

import asyncio
import sys
import uuid
import pytest
from httpx import AsyncClient, ASGITransport

sys.path.insert(0, r"D:\Om work1\ERP\Yinglima_ERP\backend")

import app.users.models  # noqa: F401
from app.main import app
from app.database.engine import get_sessionmaker
from app.rbac.repository import PermissionRepository, RoleRepository
from app.auth.service import CurrentUser
from app.rbac.dependencies import require_permission
from app.core.exceptions import ForbiddenException


@pytest.mark.asyncio
async def test_db_permissions_seeded():
    """Verify all Part 1 permissions are present in the database."""
    session_factory = get_sessionmaker()
    async with session_factory() as session:
        repo = PermissionRepository(session)
        perms = await repo.list_all()
        codes = {p.code for p in perms}

        expected = [
            "sale_process.view",
            "sale_process.create",
            "sale_process.update",
            "sale_process.approve",
            "sale_process.delete",
            "sale_process.export",
            "stock_movement.view",
            "stock_movement.create",
            "stock_movement.cancel",
            "stock_movement.delete",
            "notification_settings.view",
            "notification_settings.manage",
            "position.view",
            "position.create",
            "position.update",
            "position.delete",
        ]

        for exp in expected:
            assert exp in codes, f"Permission {exp} was not found in DB!"


@pytest.mark.asyncio
async def test_permission_checker_dependency_logic():
    """Verify require_permission dependency accurately grants or denies access."""
    # 1. User with NO permissions
    user_no_perms = CurrentUser(
        id=uuid.uuid4(),
        username="test_restricted",
        permissions=set(),
    )

    # Testing sale_process
    checker_sale_view = require_permission("sale_process.view")
    with pytest.raises(ForbiddenException):
        await checker_sale_view(user_no_perms)

    checker_sale_create = require_permission("sale_process.create")
    with pytest.raises(ForbiddenException):
        await checker_sale_create(user_no_perms)

    # Testing stock_movement
    checker_stock_view = require_permission("stock_movement.view")
    with pytest.raises(ForbiddenException):
        await checker_stock_view(user_no_perms)

    checker_stock_create = require_permission("stock_movement.create")
    with pytest.raises(ForbiddenException):
        await checker_stock_create(user_no_perms)

    # Testing notification_settings
    checker_notif_view = require_permission("notification_settings.view")
    with pytest.raises(ForbiddenException):
        await checker_notif_view(user_no_perms)

    checker_notif_manage = require_permission("notification_settings.manage")
    with pytest.raises(ForbiddenException):
        await checker_notif_manage(user_no_perms)

    # 2. User with VIEW ONLY permissions
    user_view_only = CurrentUser(
        id=uuid.uuid4(),
        username="test_viewer",
        permissions={"sale_process.view", "stock_movement.view", "notification_settings.view"},
    )

    # View should pass
    res_sale = await checker_sale_view(user_view_only)
    assert res_sale.username == "test_viewer"

    res_stock = await checker_stock_view(user_view_only)
    assert res_stock.username == "test_viewer"

    res_notif = await checker_notif_view(user_view_only)
    assert res_notif.username == "test_viewer"

    # Action / Create / Manage MUST be forbidden
    with pytest.raises(ForbiddenException):
        await checker_sale_create(user_view_only)

    with pytest.raises(ForbiddenException):
        await checker_stock_create(user_view_only)

    with pytest.raises(ForbiddenException):
        await checker_notif_manage(user_view_only)

    # 3. User with FULL permissions
    user_full = CurrentUser(
        id=uuid.uuid4(),
        username="test_manager",
        permissions={
            "sale_process.view",
            "sale_process.create",
            "stock_movement.view",
            "stock_movement.create",
            "notification_settings.view",
            "notification_settings.manage",
        },
    )

    assert (await checker_sale_create(user_full)).username == "test_manager"
    assert (await checker_stock_create(user_full)).username == "test_manager"
    assert (await checker_notif_manage(user_full)).username == "test_manager"


@pytest.mark.asyncio
async def test_api_endpoints_rbac_http():
    """Verify HTTP requests through FastAPI router return 403 Forbidden when permission is missing and 200 when granted."""
    from app.auth.dependencies import get_current_user

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # 1. User with NO permissions
        user_no_perms = CurrentUser(
            id=uuid.uuid4(),
            username="blocked_user",
            permissions=set(),
        )
        app.dependency_overrides[get_current_user] = lambda: user_no_perms

        # Sale Process: expect 403
        r_sales = await client.get("/api/v1/sales/orders")
        assert r_sales.status_code == 403, f"Expected 403 on /sales/orders without permission, got {r_sales.status_code}: {r_sales.text}"

        # Stock Movements: expect 403
        r_stock = await client.get("/api/v1/stock/movements")
        assert r_stock.status_code == 403, f"Expected 403 on /stock/movements without permission, got {r_stock.status_code}: {r_stock.text}"

        # Notification Rules: expect 403
        r_notif = await client.get("/api/v1/notifications/rules")
        assert r_notif.status_code == 403, f"Expected 403 on /notifications/rules without permission, got {r_notif.status_code}: {r_notif.text}"

        # 2. User with VIEW ONLY permissions
        user_view_only = CurrentUser(
            id=uuid.uuid4(),
            username="view_only_user",
            permissions={"sale_process.view", "stock_movement.view", "notification_settings.view"},
        )
        app.dependency_overrides[get_current_user] = lambda: user_view_only

        # Read operations should succeed (200 OK)
        r_sales_view = await client.get("/api/v1/sales/orders")
        assert r_sales_view.status_code == 200, f"Expected 200 on /sales/orders with view permission, got {r_sales_view.status_code}"

        r_stock_view = await client.get("/api/v1/stock/movements")
        assert r_stock_view.status_code == 200, f"Expected 200 on /stock/movements with view permission, got {r_stock_view.status_code}"

        r_notif_view = await client.get("/api/v1/notifications/rules")
        assert r_notif_view.status_code == 200, f"Expected 200 on /notifications/rules with view permission, got {r_notif_view.status_code}"

        # Write operations MUST be strictly blocked with 403 Forbidden!
        r_sales_create = await client.post("/api/v1/sales/orders", json={"order_no": "TEST"})
        assert r_sales_create.status_code == 403, f"Expected 403 on POST /sales/orders without create permission, got {r_sales_create.status_code}"

        r_stock_create = await client.post("/api/v1/stock/movements", json={"movement_type": "inward"})
        assert r_stock_create.status_code == 403, f"Expected 403 on POST /stock/movements without create permission, got {r_stock_create.status_code}"

        r_notif_update = await client.put("/api/v1/notifications/rules/test_event", json={"is_active": True})
        assert r_notif_update.status_code == 403, f"Expected 403 on PUT /notifications/rules without manage permission, got {r_notif_update.status_code}"

    # Clean up override
    app.dependency_overrides.clear()


async def main():
    await test_db_permissions_seeded()
    print("[PASS] Database permissions test passed successfully.")
    await test_permission_checker_dependency_logic()
    print("[PASS] Permission enforcement dependency logic test passed successfully.")
    await test_api_endpoints_rbac_http()
    print("[PASS] HTTP API endpoint permissions test passed successfully (403 when missing, 200 when granted).")
    print("\n>>> ALL PART 1 RBAC VERIFICATION TESTS PASSED SUCCESSFULLY! <<<")


if __name__ == "__main__":
    asyncio.run(main())
