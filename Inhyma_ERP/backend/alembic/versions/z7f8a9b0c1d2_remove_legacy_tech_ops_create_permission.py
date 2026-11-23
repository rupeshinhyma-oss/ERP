"""remove legacy technician_operations.create permission

Revision ID: z7f8a9b0c1d2
Revises: z6e7f8a9b0c1
Create Date: 2026-11-20 13:20:00.000000

Removes the broad legacy `technician_operations.create` permission now that
all six create actions (+ Issue Outward Gatepass, Record Wallet Transaction,
Register Machine Warranty, Wallet + Collect, Wallet Handover, and Wallet Expense)
have independent granular permissions.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Sequence, Union
import uuid

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


# revision identifiers, used by Alembic.
revision: str = "z7f8a9b0c1d2"
down_revision: Union[str, None] = "z6e7f8a9b0c1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TARGET_CODE = "technician_operations.create"


def upgrade() -> None:
    bind = op.get_bind()
    insp = inspect(bind)

    if not insp.has_table("permissions"):
        return

    for link_table in ("role_permissions", "user_permissions", "user_permission_overrides"):
        if insp.has_table(link_table):
            bind.execute(
                sa.text(
                    f"DELETE FROM {link_table} WHERE permission_id IN (SELECT id FROM permissions WHERE code = :code)"
                ),
                {"code": TARGET_CODE},
            )

    bind.execute(
        sa.text("DELETE FROM permissions WHERE code = :code"),
        {"code": TARGET_CODE},
    )


def downgrade() -> None:
    bind = op.get_bind()
    insp = inspect(bind)

    if not insp.has_table("permissions"):
        return

    now = datetime.now(timezone.utc)
    existing = bind.execute(sa.text("SELECT id FROM permissions WHERE code = :code"), {"code": TARGET_CODE}).fetchone()
    if existing:
        perm_id = existing[0]
    else:
        perm_id = uuid.uuid4()
        bind.execute(
            sa.text(
                "INSERT INTO permissions (id, code, module, page, action, scope, description, created_at, updated_at) "
                "VALUES (:id, :code, :module, :page, :action, :scope, :description, :created_at, :updated_at)"
            ),
            {
                "id": perm_id,
                "code": TARGET_CODE,
                "module": "technician_operations",
                "page": "technician-operations",
                "action": "create",
                "scope": "ALL",
                "description": "Legacy all-tabs create permission (gatepasses, wallet transactions, and machine warranties).",
                "created_at": now,
                "updated_at": now,
            },
        )

    if insp.has_table("roles") and insp.has_table("role_permissions"):
        rows = bind.execute(
            sa.text("SELECT id FROM roles WHERE LOWER(name) IN ('super_admin', 'admin') AND deleted_at IS NULL")
        ).fetchall()
        for (role_id,) in rows:
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
