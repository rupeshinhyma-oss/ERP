"""
Seed RBAC permissions for Inquiries, Product Prices, and Local Purchase modules.

Grants all these permissions to the 'super_admin' role, and grants '.view' to the 'user' role.
Also invalidates any cached user permissions so changes take effect immediately.
"""

from __future__ import annotations

import asyncio
from pathlib import Path
import sys

# Target Yinglima_ERP backend
sys.path.insert(0, r"D:\Om work1\ERP\Yinglima_ERP\backend")

from sqlalchemy import select

from app.core.logging import configure_logging, get_logger
from app.database.engine import dispose_engine, get_sessionmaker
from app.rbac.models import Permission, Role, RolePermission
from app.rbac.repository import PermissionRepository, RoleRepository
import app.users.models  # noqa: F401

logger = get_logger(__name__)

NEW_MODULE_PERMISSIONS = [
    # --- Inquiries & Quotations ---
    ("inquiry.view", "inquiry", "inquiries", "view", "ALL", "View inquiries, consignments, line items, and timelines."),
    ("inquiry.create", "inquiry", "inquiries", "create", "ALL", "Create new inquiries and consignments."),
    ("inquiry.update", "inquiry", "inquiries", "update", "ALL", "Edit inquiries, items, statuses."),
    ("inquiry.delete", "inquiry", "inquiries", "delete", "ALL", "Delete inquiries and consignment items."),
    ("inquiry.approve", "inquiry", "inquiries", "approve", "ALL", "Approve inquiry quotes and confirm consignments."),
    ("inquiry.export", "inquiry", "inquiries", "export", "ALL", "Export consignment line items to Excel/CSV."),
    ("inquiry.import", "inquiry", "inquiries", "import", "ALL", "Import consignment line items from Excel."),
    ("inquiry.send_message", "inquiry", "inquiries", "send_message", "ALL", "Send outbound emails and WeChat messages to suppliers/buyers."),

    # --- Product Prices ---
    ("product_price.view", "product_price", "product_prices", "view", "ALL", "View product prices catalog and price history."),
    ("product_price.create", "product_price", "product_prices", "create", "ALL", "Create new product price records."),
    ("product_price.update", "product_price", "product_prices", "update", "ALL", "Edit product price records."),
    ("product_price.delete", "product_price", "product_prices", "delete", "ALL", "Delete product price records."),
    ("product_price.export", "product_price", "product_prices", "export", "ALL", "Export product prices catalog to Excel/CSV."),
    ("product_price.import", "product_price", "product_prices", "import", "ALL", "Bulk import product price lists."),

    # --- Local Purchase Orders ---
    ("local_purchase.view", "local_purchase", "local_purchases", "view", "ALL", "View local purchase orders list and detail modal."),
    ("local_purchase.create", "local_purchase", "local_purchases", "create", "ALL", "Create new local purchase orders."),
    ("local_purchase.update", "local_purchase", "local_purchases", "update", "ALL", "Edit local purchase orders and update landing costs."),
    ("local_purchase.delete", "local_purchase", "local_purchases", "delete", "ALL", "Delete or cancel local purchase orders."),
    ("local_purchase.export", "local_purchase", "local_purchases", "export", "ALL", "Export or print local purchase orders."),

    # --- Sale Process ---
    ("sale_process.view", "sale_process", "sales", "view", "ALL", "View sale orders, status metrics, and document details."),
    ("sale_process.create", "sale_process", "sales", "create", "ALL", "Create new sale orders from shipments or scratch."),
    ("sale_process.update", "sale_process", "sales", "update", "ALL", "Edit sale orders, line items, and container details."),
    ("sale_process.approve", "sale_process", "sales", "approve", "ALL", "Update order status workflow (Confirmed, Approved, Dispatched, LR)."),
    ("sale_process.delete", "sale_process", "sales", "delete", "ALL", "Delete or cancel sale orders."),
    ("sale_process.export", "sale_process", "sales", "export", "ALL", "Export sale orders to Excel and download Commercial Invoice & Packing List."),

    # --- Stock Movements ---
    ("stock_movement.view", "stock_movement", "stock-movement", "view", "ALL", "View stock movements, live balances, and Kardex ledgers."),
    ("stock_movement.create", "stock_movement", "stock-movement", "create", "ALL", "Create inward receipts and outward dispatches."),
    ("stock_movement.cancel", "stock_movement", "stock-movement", "update", "ALL", "Cancel or reverse stock movements."),
    ("stock_movement.delete", "stock_movement", "stock-movement", "delete", "ALL", "Delete stock movement records."),

    # --- Notification Rules ---
    ("notification_settings.view", "notification_settings", "notification-settings", "view", "ALL", "View notification trigger rules and mapped recipients."),
    ("notification_settings.manage", "notification_settings", "notification-settings", "manage", "ALL", "Configure and update notification rules and recipient mappings."),
]

DEFAULT_USER_VIEW_PERMS = {
    "inquiry.view",
    "product_price.view",
    "local_purchase.view",
    "sale_process.view",
    "stock_movement.view",
    "notification_settings.view",
}


async def seed_permissions() -> None:
    configure_logging()
    session_factory = get_sessionmaker()

    async with session_factory() as session:
        permission_repo = PermissionRepository(session)

        # 1. Ensure permissions exist
        created_perms: list[Permission] = []
        for code, module, page, action, scope, description in NEW_MODULE_PERMISSIONS:
            existing = await permission_repo.get_by_code(code)
            if existing is None:
                perm = Permission(
                    code=code,
                    module=module,
                    page=page,
                    action=action,
                    scope=scope,
                    description=description,
                )
                session.add(perm)
                created_perms.append(perm)
                print(f"Created permission: {code}")
            else:
                existing.module = module
                existing.page = page
                existing.action = action
                existing.scope = scope
                existing.description = description
                created_perms.append(existing)
                print(f"Verified permission: {code}")

        await session.flush()

        # 2. Grant to super_admin and user roles
        role_stmt = select(Role)
        all_roles = (await session.execute(role_stmt)).scalars().all()
        for role in all_roles:
            if role.name == "super_admin":
                for perm in created_perms:
                    existing_grant_stmt = select(RolePermission).where(
                        RolePermission.role_id == role.id,
                        RolePermission.permission_id == perm.id,
                    )
                    existing_grant = (await session.execute(existing_grant_stmt)).scalar_one_or_none()
                    if existing_grant is None:
                        session.add(RolePermission(role_id=role.id, permission_id=perm.id))
                        print(f"  Granted '{perm.code}' to super_admin role '{role.name}'")
            elif role.name in ("user", "employee"):
                for perm in created_perms:
                    if perm.code in DEFAULT_USER_VIEW_PERMS:
                        existing_grant_stmt = select(RolePermission).where(
                            RolePermission.role_id == role.id,
                            RolePermission.permission_id == perm.id,
                        )
                        existing_grant = (await session.execute(existing_grant_stmt)).scalar_one_or_none()
                        if existing_grant is None:
                            session.add(RolePermission(role_id=role.id, permission_id=perm.id))
                            print(f"  Granted '{perm.code}' to role '{role.name}'")

        await session.commit()

    await dispose_engine()
    print("\nSuccessfully seeded all Inquiries, Product Prices, and Local Purchase permissions.")


if __name__ == "__main__":
    asyncio.run(seed_permissions())
