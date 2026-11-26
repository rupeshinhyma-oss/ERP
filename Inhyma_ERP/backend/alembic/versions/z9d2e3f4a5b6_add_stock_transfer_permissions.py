"""Add granular RBAC permissions for Inventory Stock Transfer.

Revision ID: z9d2e3f4a5b6
Revises: z9c1d2e3f4a5
Create Date: 2026-11-21 16:40:00.000000
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Sequence, Union
import uuid

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision: str = "z9d2e3f4a5b6"
down_revision: Union[str, Sequence[str], None] = "z9c1d2e3f4a5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


NEW_PERMISSIONS = [
    ("stock_transfer.view", "stock_transfer", "stock-transfer", "view", "ALL", "View the Stock Transfer list (All tab) and transfer details."),
    ("stock_transfer.create", "stock_transfer", "stock-transfer", "create", "ALL", "Show + ADD NEW and create new stock transfers."),
    ("stock_transfer.export", "stock_transfer", "stock-transfer", "export", "ALL", "Show Export and Export Selected buttons and export Stock Transfer records to CSV."),
    ("stock_transfer.bulk_action", "stock_transfer", "stock-transfer", "bulk_action", "ALL", "Enable row selection checkboxes and the Bulk Actions dropdown on Stock Transfer."),
    ("stock_transfer.cancel", "stock_transfer", "stock-transfer", "cancel", "ALL", "Show Cancel action (row menu & Bulk Cancel) and cancel stock transfers."),
    ("stock_transfer.download", "stock_transfer", "stock-transfer", "download", "ALL", "Show Download action and download Stock Transfer PDF orders."),
    ("stock_transfer.pending.view", "stock_transfer", "stock-transfer", "pending.view", "ALL", "View the Pending status tab on Stock Transfer."),
    ("stock_transfer.confirmed.view", "stock_transfer", "stock-transfer", "confirmed.view", "ALL", "View the Confirmed status tab on Stock Transfer."),
    ("stock_transfer.received.view", "stock_transfer", "stock-transfer", "received.view", "ALL", "View the Received status tab on Stock Transfer."),
    ("stock_transfer.cancel.view", "stock_transfer", "stock-transfer", "cancel.view", "ALL", "View the Cancel status tab on Stock Transfer."),
    ("stock_transfer.pending", "stock_transfer", "stock-transfer", "pending", "ALL", "Transition or mark Stock Transfer stage as Pending."),
    ("stock_transfer.confirmed", "stock_transfer", "stock-transfer", "confirmed", "ALL", "Transition or confirm Stock Transfer stage as Confirmed."),
    ("stock_transfer.received", "stock_transfer", "stock-transfer", "received", "ALL", "Transition or receive Stock Transfer stage into destination physical warehouse (Received)."),
    ("stock_transfer.manage", "stock_transfer", "stock-transfer", "manage", "ALL", "Full administrative control over Stock Transfer, including View, Add New, Export, Bulk Actions, Cancel, Download, and all stages & stage views."),
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

    for code, module, page, action, scope, description in NEW_PERMISSIONS:
        existing = bind.execute(
            sa.text("SELECT id FROM permissions WHERE code = :code"),
            {"code": code},
        ).scalar()
        if existing:
            bind.execute(
                sa.text(
                    "UPDATE permissions "
                    "SET module = :module, page = :page, action = :action, "
                    "scope = :scope, description = :description, updated_at = :updated_at "
                    "WHERE id = :id"
                ),
                {
                    "id": existing,
                    "module": module,
                    "page": page,
                    "action": action,
                    "scope": scope,
                    "description": description,
                    "updated_at": now,
                },
            )
            perm_id = existing
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
                    "description": description,
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
                    f"DELETE FROM {link_table} WHERE permission_id IN ("
                    f"SELECT id FROM permissions WHERE code IN ({placeholders}))"
                ),
                params,
            )

    bind.execute(sa.text(f"DELETE FROM permissions WHERE code IN ({placeholders})"), params)
