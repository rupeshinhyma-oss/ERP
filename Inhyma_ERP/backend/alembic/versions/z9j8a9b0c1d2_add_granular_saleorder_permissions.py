"""add granular saleorder permissions

Revision ID: z9j8a9b0c1d2
Revises: z9i7a8b9c0d1
Create Date: 2026-11-24 12:00:00.000000

Adds 21 new granular permissions for Sales Process & Orders (plus updates descriptions
of the 4 existing ``saleorder.approve``, ``saleorder.accounts``, ``saleorder.warehouse``,
and ``saleorder.delete`` permissions, totaling 25 permissions):
- saleorder.view, plus 9 stage view permissions (pending, sales_confirmed, admin_approved,
  acc_confirmed, gatepass_created, dispatched, gatepass_cancelled, lr, cancelled)
- saleorder.create, saleorder.export, saleorder.details.view, saleorder.action.view
- saleorder.update, saleorder.duplicate, saleorder.download, saleorder.files
- saleorder.confirm, saleorder.approve, saleorder.accounts, saleorder.warehouse,
  saleorder.cancel, saleorder.delete
- saleorder.manage
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Sequence, Union
import uuid

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision: str = "z9j8a9b0c1d2"
down_revision: Union[str, Sequence[str], None] = "z9i7a8b9c0d1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

EXISTING_CODES = {
    "saleorder.approve",
    "saleorder.accounts",
    "saleorder.warehouse",
    "saleorder.delete",
}

SALEORDER_PERMISSIONS = [
    ("saleorder.view", "saleorder", "sales-process", "view", "ALL", "View Sales Process module, All / Admin Confirmed To LR KPI cards, All tab, and Sales Orders."),
    ("saleorder.pending.view", "saleorder", "sales-process", "pending.view", "ALL", "View the Pending summary card and Pending status tab in Sales Process."),
    ("saleorder.sales_confirmed.view", "saleorder", "sales-process", "sales_confirmed.view", "ALL", "View the Sales Confirmed status tab and orders in Sales Process."),
    ("saleorder.admin_approved.view", "saleorder", "sales-process", "admin_approved.view", "ALL", "View the Admin Approved summary card and Admin Approved status tab in Sales Process."),
    ("saleorder.acc_confirmed.view", "saleorder", "sales-process", "acc_confirmed.view", "ALL", "View the Acc. Confirmed status tab and orders in Sales Process."),
    ("saleorder.gatepass_created.view", "saleorder", "sales-process", "gatepass_created.view", "ALL", "View the Gatepass Created status tab and orders in Sales Process."),
    ("saleorder.dispatched.view", "saleorder", "sales-process", "dispatched.view", "ALL", "View the Dispatched status tab and orders in Sales Process."),
    ("saleorder.gatepass_cancelled.view", "saleorder", "sales-process", "gatepass_cancelled.view", "ALL", "View the Gatepass Cancelled status tab and orders in Sales Process."),
    ("saleorder.lr.view", "saleorder", "sales-process", "lr.view", "ALL", "View the LR summary card and LR status tab in Sales Process."),
    ("saleorder.cancelled.view", "saleorder", "sales-process", "cancelled.view", "ALL", "View the Cancelled summary card and Cancelled status tab in Sales Process."),
    ("saleorder.create", "saleorder", "sales-process", "create", "ALL", "Show + ADD NEW button and create sales orders."),
    ("saleorder.export", "saleorder", "sales-process", "export", "ALL", "Show Export button and export sales orders spreadsheet."),
    ("saleorder.details.view", "saleorder", "sales-process", "details.view", "ALL", "Open Sales Details modal by clicking Order No. and view order details/timeline."),
    ("saleorder.action.view", "saleorder", "sales-process", "action.view", "ALL", "View the Action (3-dots) column in the Sales Process table."),
    ("saleorder.update", "saleorder", "sales-process", "update", "ALL", "Show Edit in the Action menu and edit sales order details (within editable stages)."),
    ("saleorder.duplicate", "saleorder", "sales-process", "duplicate", "ALL", "Show Duplicate in the Action menu (LR stage) and duplicate sales orders."),
    ("saleorder.download", "saleorder", "sales-process", "download", "ALL", "Show Download Gatepass in the Action menu, clickable Gatepass links, and Gatepass/Order PDF viewers."),
    ("saleorder.files", "saleorder", "sales-process", "files", "ALL", "Show SO Files in the Action menu and upload or manage order PO, Tally, E-Way, and LR documents."),
    ("saleorder.confirm", "saleorder", "sales-process", "confirm", "ALL", "Move Pending sales orders to Sales Confirmed stage."),
    ("saleorder.approve", "saleorder", "sales-process", "approve", "ALL", "Move Sales Confirmed orders to Admin Approved stage."),
    ("saleorder.accounts", "saleorder", "sales-process", "accounts", "ALL", "Confirm Admin Approved orders at Acc. Confirmed (Accounts) stage."),
    ("saleorder.warehouse", "saleorder", "sales-process", "warehouse", "ALL", "Manage Gatepass Created, Dispatched, Gatepass Cancelled, and LR warehouse stages."),
    ("saleorder.cancel", "saleorder", "sales-process", "cancel", "ALL", "Cancel sales orders (Action menu Cancel or Status Drawer Cancelled stage)."),
    ("saleorder.delete", "saleorder", "sales-process", "delete", "ALL", "Show Delete in the Action menu and delete sales orders (stage rules apply)."),
    ("saleorder.manage", "saleorder", "sales-process", "manage", "ALL", "Full administrative control over Sales Process & Orders, including View, all 9 stage views, + Add New, Export, Details, Action column, Edit, Duplicate, Download, SO Files, stage transitions, Cancel, Delete, and Restore."),
]

NEW_ONLY_CODES = tuple(row[0] for row in SALEORDER_PERMISSIONS if row[0] not in EXISTING_CODES)


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
    is_sqlite = bind.dialect.name == "sqlite"

    def _bind_id(val: Any) -> Any:
        return str(val) if is_sqlite else val

    for code, module, page, action, scope, desc in SALEORDER_PERMISSIONS:
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

    if not insp.has_table("permissions"):
        return

    placeholders = ", ".join(f":c{i}" for i in range(len(NEW_ONLY_CODES)))
    params = {f"c{i}": code for i, code in enumerate(NEW_ONLY_CODES)}

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
