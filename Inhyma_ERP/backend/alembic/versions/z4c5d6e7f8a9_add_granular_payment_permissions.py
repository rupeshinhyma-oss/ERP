"""add granular payment tab, action column, and view details permissions

Revision ID: z4c5d6e7f8a9
Revises: z3b4c5d6e7f8
Create Date: 2026-11-19 15:30:00.000000

Adds granular UI/action permissions to the Payments module:
- Status tab views: payment.pending.view, payment.completed.view
- Action column & detail modal: payment.action.view, payment.details.view
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Sequence, Union
import uuid

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


# revision identifiers, used by Alembic.
revision: str = "z4c5d6e7f8a9"
down_revision: Union[str, None] = "z3b4c5d6e7f8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

NEW_PERMISSIONS = [
    ("payment.pending.view", "payment", "payments", "view", "ALL", "View the Pending tab in Payments."),
    ("payment.completed.view", "payment", "payments", "view", "ALL", "View the Completed tab in Payments."),
    ("payment.action.view", "payment", "payments", "view", "ALL", "View the Action (3-dots) column in the Payments table."),
    ("payment.details.view", "payment", "payments", "view", "ALL", "View Details in the Action menu and open the Payment Details modal in Payments."),
]

UPDATED_DESCRIPTIONS = {
    "payment.view": "View Payments dashboard, KPIs, and All tab.",
    "payment.create": "Show + ADD NEW button and create new chargeable payment records in Payments.",
    "payment.update": "View/use Record Payment action (Action menu and Payment Details modal) and upload payment receipts in Payments.",
    "payment.delete": "Show DELETE button and delete pending payment records in Payments.",
    "payment.manage": "Full administrative control over Payments, including all tabs, + ADD NEW, Delete, Action column, View Details, and Record Payment.",
}

NEW_CODES = tuple(row[0] for row in NEW_PERMISSIONS)


def upgrade() -> None:
    bind = op.get_bind()
    insp = inspect(bind)

    if not insp.has_table("permissions"):
        return

    now = datetime.now(timezone.utc)

    for code, desc in UPDATED_DESCRIPTIONS.items():
        bind.execute(
            sa.text(
                "UPDATE permissions SET description = :desc, updated_at = :updated_at WHERE code = :code"
            ),
            {"code": code, "desc": desc, "updated_at": now},
        )

    admin_role_ids: list[uuid.UUID] = []
    if insp.has_table("roles"):
        rows = bind.execute(
            sa.text(
                "SELECT id FROM roles WHERE LOWER(name) IN ('super_admin', 'admin') AND deleted_at IS NULL"
            )
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
                    "scope = :scope, description = :description, updated_at = :updated_at "
                    "WHERE id = :id"
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

        if has_role_permissions:
            for role_id in admin_role_ids:
                link_exists = bind.execute(
                    sa.text(
                        "SELECT 1 FROM role_permissions WHERE role_id = :role_id AND permission_id = :perm_id"
                    ),
                    {"role_id": role_id, "perm_id": perm_id},
                ).fetchone()
                if not link_exists:
                    bind.execute(
                        sa.text(
                            "INSERT INTO role_permissions (id, role_id, permission_id, granted_at) "
                            "VALUES (:id, :role_id, :perm_id, :granted_at)"
                        ),
                        {
                            "id": uuid.uuid4(),
                            "role_id": role_id,
                            "perm_id": perm_id,
                            "granted_at": now,
                        },
                    )


def downgrade() -> None:
    bind = op.get_bind()
    insp = inspect(bind)

    if not insp.has_table("permissions"):
        return

    placeholders = ", ".join(f":c{i}" for i in range(len(NEW_CODES)))
    params = {f"c{i}": code for i, code in enumerate(NEW_CODES)}

    if insp.has_table("user_permissions"):
        bind.execute(
            sa.text(
                f"DELETE FROM user_permissions WHERE permission_id IN ("
                f"  SELECT id FROM permissions WHERE code IN ({placeholders})"
                f")"
            ),
            params,
        )

    if insp.has_table("role_permissions"):
        bind.execute(
            sa.text(
                f"DELETE FROM role_permissions WHERE permission_id IN ("
                f"  SELECT id FROM permissions WHERE code IN ({placeholders})"
                f")"
            ),
            params,
        )

    bind.execute(
        sa.text(f"DELETE FROM permissions WHERE code IN ({placeholders})"),
        params,
    )
