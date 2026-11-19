"""separate technical task, payments, and technician operations permissions

Revision ID: w0b1c2d3e4f5
Revises: v9a0b1c2d3e4
Create Date: 2026-11-18 12:20:00.000000

Splits Payments (`payment.*`) and Technician Gatepass & Wallet Management
(`technician_operations.*`) out of `technicaltask.*` so granting
`technicaltask.view` grants access exclusively to Technical Tasks.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Sequence, Union
import uuid

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


# revision identifiers, used by Alembic.
revision: str = "w0b1c2d3e4f5"
down_revision: Union[str, None] = "v9a0b1c2d3e4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

NEW_PERMISSIONS = [
    # Payments Module
    ("payment.view", "payment", "payments", "view", "ALL", "View Payments dashboard, KPIs, payment tabs, and payment details."),
    ("payment.create", "payment", "payments", "create", "ALL", "Create new chargeable payment records in Payments."),
    ("payment.update", "payment", "payments", "update", "ALL", "Record payments and upload payment receipts in Payments."),
    ("payment.delete", "payment", "payments", "delete", "ALL", "Delete pending payment records in Payments."),
    ("payment.manage", "payment", "payments", "manage", "ALL", "Full administrative control over Payments, including deleting records at any stage."),
    # Technician Gatepass & Wallet Management Module
    ("technician_operations.view", "technician_operations", "technician-operations", "view", "ALL", "View Technician Gatepass & Wallet Management (gatepasses, technician wallets, and machine warranties)."),
    ("technician_operations.create", "technician_operations", "technician-operations", "create", "ALL", "Issue outward spare parts gatepasses, record wallet transactions, and register machine warranties."),
    ("technician_operations.update", "technician_operations", "technician-operations", "update", "ALL", "Record spare parts returns and link Sales Orders to gatepasses."),
    ("technician_operations.manage", "technician_operations", "technician-operations", "manage", "ALL", "Full administrative control over Technician Gatepass, Wallet & Warranty Management."),
]

NEW_CODES = tuple(row[0] for row in NEW_PERMISSIONS)


def upgrade() -> None:
    bind = op.get_bind()
    insp = inspect(bind)

    if not insp.has_table("permissions"):
        return

    now = datetime.now(timezone.utc)

    # Update technicaltask.update description to reflect module separation
    bind.execute(
        sa.text(
            "UPDATE permissions SET description = :desc, updated_at = :updated_at "
            "WHERE code = 'technicaltask.update'"
        ),
        {
            "desc": "Edit technical tasks, record call logs, and complete/cancel tasks.",
            "updated_at": now,
        },
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
