"""add product_stock granular permissions

Revision ID: z9b0c1d2e3f4
Revises: z8a9b0c1d2e3
Create Date: 2026-11-21 15:55:00.000000

Adds granular permissions for the Product Stock module:
- product_stock.view: View the Product Stock page, warehouse balances, and stock breakup details.
- product_stock.export: Show Export button and export Product Stock data to Excel.
- product_stock.manage: Full administrative control over Product Stock, including viewing balances, breakup details, and exporting.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Sequence, Union
import uuid

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


# revision identifiers, used by Alembic.
revision: str = "z9b0c1d2e3f4"
down_revision: Union[str, None] = "z8a9b0c1d2e3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

NEW_PERMISSIONS = [
    (
        "product_stock.view",
        "product_stock",
        "product-stock",
        "view",
        "ALL",
        "View the Product Stock page, warehouse balances, and stock breakup details.",
    ),
    (
        "product_stock.export",
        "product_stock",
        "product-stock",
        "export",
        "ALL",
        "Show Export button and export Product Stock data to Excel.",
    ),
    (
        "product_stock.manage",
        "product_stock",
        "product-stock",
        "manage",
        "ALL",
        "Full administrative control over Product Stock, including viewing balances, breakup details, and exporting.",
    ),
]

NEW_CODES = tuple(row[0] for row in NEW_PERMISSIONS)


def upgrade() -> None:
    bind = op.get_bind()
    insp = inspect(bind)

    if not insp.has_table("permissions"):
        return

    now = datetime.now(timezone.utc)

    admin_role_ids: list[uuid.UUID] = []
    if insp.has_table("roles"):
        rows = bind.execute(
            sa.text("SELECT id FROM roles WHERE LOWER(name) IN ('super_admin', 'admin') AND deleted_at IS NULL")
        ).fetchall()
        admin_role_ids = [r[0] for r in rows]

    has_role_permissions = insp.has_table("role_permissions")

    for code, module, page, action, scope, desc in NEW_PERMISSIONS:
        perm_row = bind.execute(
            sa.text("SELECT id FROM permissions WHERE code = :code"),
            {"code": code},
        ).fetchone()

        if perm_row:
            perm_id = perm_row[0]
            bind.execute(
                sa.text(
                    "UPDATE permissions SET module = :module, page = :page, action = :action, "
                    "scope = :scope, description = :description, updated_at = :updated_at WHERE id = :id"
                ),
                {
                    "id": perm_id,
                    "module": module,
                    "page": page,
                    "action": action,
                    "scope": scope,
                    "description": desc,
                    "updated_at": now,
                },
            )
        else:
            perm_id = uuid.uuid4()
            bind.execute(
                sa.text(
                    "INSERT INTO permissions (id, code, module, page, action, scope, description, created_at, updated_at) "
                    "VALUES (:id, :code, :module, :page, :action, :scope, :description, :created_at, :updated_at)"
                ),
                {
                    "id": perm_id,
                    "code": code,
                    "module": module,
                    "page": page,
                    "action": action,
                    "scope": scope,
                    "description": desc,
                    "created_at": now,
                    "updated_at": now,
                },
            )

        if has_role_permissions and admin_role_ids:
            for role_id in admin_role_ids:
                existing_rp = bind.execute(
                    sa.text("SELECT id FROM role_permissions WHERE role_id = :role_id AND permission_id = :perm_id"),
                    {"role_id": role_id, "perm_id": perm_id},
                ).fetchone()
                if not existing_rp:
                    bind.execute(
                        sa.text(
                            "INSERT INTO role_permissions (id, role_id, permission_id, granted_at) "
                            "VALUES (:id, :role_id, :perm_id, :granted_at)"
                        ),
                        {"id": uuid.uuid4(), "role_id": role_id, "perm_id": perm_id, "granted_at": now},
                    )


def downgrade() -> None:
    bind = op.get_bind()
    insp = inspect(bind)

    if not insp.has_table("permissions"):
        return

    placeholders = ", ".join(f":c{i}" for i in range(len(NEW_CODES)))
    params = {f"c{i}": code for i, code in enumerate(NEW_CODES)}

    for link_table in ("role_permissions", "user_permissions", "user_permission_overrides"):
        if insp.has_table(link_table):
            bind.execute(
                sa.text(
                    f"DELETE FROM {link_table} WHERE permission_id IN (SELECT id FROM permissions WHERE code IN ({placeholders}))"
                ),
                params,
            )

    bind.execute(sa.text(f"DELETE FROM permissions WHERE code IN ({placeholders})"), params)
