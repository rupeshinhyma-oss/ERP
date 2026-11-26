"""add granular proforma invoice permissions

Revision ID: z9i7a8b9c0d1
Revises: z9h6a7b8c9d0
Create Date: 2026-11-23 17:30:00.000000

Adds 14 new granular permissions for Proforma Invoices (plus updates existing ``proforma.approve``):
- proforma.view, proforma.pending.view, proforma.admin_approved.view,
  proforma.confirmed.view, proforma.cancelled.view
- proforma.create, proforma.action.view, proforma.download, proforma.details.view
- proforma.update, proforma.approve, proforma.confirm, proforma.cancel, proforma.delete
- proforma.manage
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Sequence, Union
import uuid

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision: str = "z9i7a8b9c0d1"
down_revision: Union[str, Sequence[str], None] = "z9h6a7b8c9d0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

PROFORMA_PERMISSIONS = [
    ("proforma.view", "proforma", "proforma-invoice", "view", "ALL", "View Proforma Invoices module, All summary card, and All tab."),
    ("proforma.pending.view", "proforma", "proforma-invoice", "pending.view", "ALL", "View the Pending summary card and Pending status tab in Proforma Invoices."),
    ("proforma.admin_approved.view", "proforma", "proforma-invoice", "admin_approved.view", "ALL", "View the Admin Approved summary card and Admin Approved status tab in Proforma Invoices."),
    ("proforma.confirmed.view", "proforma", "proforma-invoice", "confirmed.view", "ALL", "View the Confirmed summary card and Confirmed status tab in Proforma Invoices."),
    ("proforma.cancelled.view", "proforma", "proforma-invoice", "cancelled.view", "ALL", "View the Cancelled summary card and Cancelled status tab in Proforma Invoices."),
    ("proforma.create", "proforma", "proforma-invoice", "create", "ALL", "Show + ADD NEW button and create proforma invoices."),
    ("proforma.action.view", "proforma", "proforma-invoice", "action.view", "ALL", "View the Action (3-dots) column in the Proforma Invoices table."),
    ("proforma.download", "proforma", "proforma-invoice", "download", "ALL", "Show Download / View PDF action, Proforma No. PDF link, and PDF viewer page."),
    ("proforma.details.view", "proforma", "proforma-invoice", "details.view", "ALL", "Show View Details in the Action menu and open the Proforma Detail drawer."),
    ("proforma.update", "proforma", "proforma-invoice", "update", "ALL", "Show Edit in the Action menu and edit proforma invoices (within permitted stages)."),
    ("proforma.approve", "proforma", "proforma-invoice", "approve", "ALL", "Approve proforma invoices (Pending -> Admin Approved stage) and allow admin-stage edits when paired with Edit."),
    ("proforma.confirm", "proforma", "proforma-invoice", "confirm", "ALL", "Confirm proforma invoices and auto-create Sales Order (Admin Approved -> Confirmed stage)."),
    ("proforma.cancel", "proforma", "proforma-invoice", "cancel", "ALL", "Cancel proforma invoices (Pending / Admin Approved -> Cancelled stage)."),
    ("proforma.delete", "proforma", "proforma-invoice", "delete", "ALL", "Show Delete in the Action menu and delete proforma invoices at deletable stages."),
    ("proforma.manage", "proforma", "proforma-invoice", "manage", "ALL", "Full administrative control over Proforma Invoices, including View, all stage views, + Add New, Action column, PDF Download, View Details, Edit, Approve, Confirm, Cancel, and Delete."),
]

NEW_ONLY_CODES = tuple(row[0] for row in PROFORMA_PERMISSIONS if row[0] != "proforma.approve")


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

    for code, module, page, action, scope, desc in PROFORMA_PERMISSIONS:
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
