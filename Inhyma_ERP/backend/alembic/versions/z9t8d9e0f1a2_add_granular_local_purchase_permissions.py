"""add granular local_purchase 10-permission rbac matrix

Revision ID: z9t8d9e0f1a2
Revises: z9s7c8d9e0f1
Create Date: 2026-11-27 15:45:00.000000

Adds granular Local Purchase permissions (`localpurchase.view`,
`localpurchase.create`, `localpurchase.import`, `localpurchase.export`,
`localpurchase.bulk_action`, `localpurchase.download`, `localpurchase.delete`,
`localpurchase.manage`) alongside existing `localpurchase.update` and
`localpurchase.confirm` (10 total permissions) and updates `option_lists`
(`purchase.local.status` pending rule) so `localpurchase.delete` grants
delete capability on pending local purchases.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any, Sequence, Union
import uuid

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision: str = "z9t8d9e0f1a2"
down_revision: Union[str, Sequence[str], None] = "z9s7c8d9e0f1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

NEW_PERMISSIONS = [
    ("localpurchase.view", "localpurchase", "purchase-local", "view", "ALL", "View Local Purchase module, orders table, and order details modal."),
    ("localpurchase.create", "localpurchase", "purchase-local", "create", "ALL", "Show + ADD NEW button and create new local purchase orders."),
    ("localpurchase.import", "localpurchase", "purchase-local", "import", "ALL", "Show Sample File and Import options in Imp / Exp menu and import local purchases from CSV/Excel."),
    ("localpurchase.export", "localpurchase", "purchase-local", "export", "ALL", "Show Export option in Imp / Exp menu and export local purchases to CSV."),
    ("localpurchase.bulk_action", "localpurchase", "purchase-local", "bulk_action", "ALL", "Show row selection checkboxes and Bulk Actions dropdown on Local Purchase."),
    ("localpurchase.download", "localpurchase", "purchase-local", "download", "ALL", "Show Download Purchase in Action menu, clickable Bill File links, and Local Purchase PDF/bill viewer."),
    ("localpurchase.delete", "localpurchase", "purchase-local", "delete", "ALL", "Show Delete in Action menu (pending stage) / Bulk Actions and delete pending local purchases."),
    ("localpurchase.manage", "localpurchase", "purchase-local", "manage", "ALL", "Full administrative control over Local Purchase, including View, Add New, Import + Sample, Export, Bulk Actions, Download Purchase, Edit, Confirm, and Delete."),
]

UPDATED_EXISTING = {
    "localpurchase.update": ("update", "Show Edit in Action menu (pending stage) and update pending local purchases and bill attachments."),
    "localpurchase.confirm": ("confirm", "Show Confirm in Action menu / Bulk Actions and confirm local purchases (adds physical warehouse stock)."),
}

NEW_CODES = tuple(row[0] for row in NEW_PERMISSIONS)


def upgrade() -> None:
    bind = op.get_bind()
    insp = inspect(bind)
    now = datetime.now(timezone.utc)

    # 1. Update purchase.local.status pending rule so localpurchase.delete can delete pending orders
    if insp.has_table("option_lists"):
        pending_row = bind.execute(
            sa.text(
                "SELECT id, meta FROM option_lists "
                "WHERE group_key = 'purchase.local.status' AND value = 'pending' AND deleted_at IS NULL"
            )
        ).fetchone()
        if pending_row is not None:
            raw_meta = pending_row[1]
            meta_dict = json.loads(raw_meta) if isinstance(raw_meta, str) else dict(raw_meta or {})
            meta_dict["delete"] = "perm:localpurchase.delete"
            bind.execute(
                sa.text("UPDATE option_lists SET meta = :meta, updated_at = :now WHERE id = :id"),
                {"meta": json.dumps(meta_dict), "now": now, "id": pending_row[0]},
            )

    if not insp.has_table("permissions"):
        return

    for code, (action, desc) in UPDATED_EXISTING.items():
        bind.execute(
            sa.text(
                "UPDATE permissions SET action = :action, description = :desc, updated_at = :updated_at WHERE code = :code"
            ),
            {"code": code, "action": action, "desc": desc, "updated_at": now},
        )

    admin_role_ids: list[uuid.UUID] = []
    if insp.has_table("roles"):
        rows = bind.execute(
            sa.text("SELECT id FROM roles WHERE LOWER(name) IN ('super_admin', 'admin') AND deleted_at IS NULL")
        ).fetchall()
        admin_role_ids = [r[0] for r in rows]

    has_role_permissions = insp.has_table("role_permissions")
    is_sqlite = bind.dialect.name == "sqlite"

    def _bind_id(val: Any) -> Any:
        return str(val) if is_sqlite else val

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
                    "id": _bind_id(perm_id),
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
                    "id": _bind_id(perm_id),
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
                    {"role_id": _bind_id(role_id), "perm_id": _bind_id(perm_id)},
                ).fetchone()
                if not existing_rp:
                    bind.execute(
                        sa.text(
                            "INSERT INTO role_permissions (id, role_id, permission_id, granted_at) "
                            "VALUES (:id, :role_id, :perm_id, :granted_at)"
                        ),
                        {"id": _bind_id(uuid.uuid4()), "role_id": _bind_id(role_id), "perm_id": _bind_id(perm_id), "granted_at": now},
                    )


def downgrade() -> None:
    bind = op.get_bind()
    insp = inspect(bind)
    now = datetime.now(timezone.utc)

    if insp.has_table("option_lists"):
        pending_row = bind.execute(
            sa.text(
                "SELECT id, meta FROM option_lists "
                "WHERE group_key = 'purchase.local.status' AND value = 'pending' AND deleted_at IS NULL"
            )
        ).fetchone()
        if pending_row is not None:
            raw_meta = pending_row[1]
            meta_dict = json.loads(raw_meta) if isinstance(raw_meta, str) else dict(raw_meta or {})
            meta_dict["delete"] = "admin"
            bind.execute(
                sa.text("UPDATE option_lists SET meta = :meta, updated_at = :now WHERE id = :id"),
                {"meta": json.dumps(meta_dict), "now": now, "id": pending_row[0]},
            )

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
