"""remove discount_payment.action.view permission in favor of action-implied column

Revision ID: z9s7c8d9e0f1
Revises: z9r6b7c8d9e0
Create Date: 2026-11-27 13:50:00.000000

Retires ``discount_payment.action.view`` so Discount Payments has the clean
6-permission set (``discount_payment.view``, ``discount_payment.pending.view``,
``discount_payment.completed.view``, ``discount_payment.adjust``,
``discount_payment.payments.view``, ``discount_payment.manage``) and displays
the Action (⋮) column automatically whenever Adjust Discount, List Payments,
or Manage All is granted.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Sequence, Union
import uuid

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision: str = "z9s7c8d9e0f1"
down_revision: Union[str, Sequence[str], None] = "z9r6b7c8d9e0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TARGET_CODE = "discount_payment.action.view"


def upgrade() -> None:
    bind = op.get_bind()
    insp = inspect(bind)

    if not insp.has_table("permissions"):
        return

    for link_table in ("role_permissions", "user_permissions", "user_permission_overrides"):
        if insp.has_table(link_table):
            bind.execute(
                sa.text(
                    f"DELETE FROM {link_table} WHERE permission_id IN ("
                    "SELECT id FROM permissions WHERE code = :code)"
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
    is_sqlite = bind.dialect.name == "sqlite"

    def _bind_id(val: Any) -> Any:
        return str(val) if is_sqlite else val

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
                "id": _bind_id(perm_id),
                "code": TARGET_CODE,
                "module": "discount_payment",
                "page": "discount-payments",
                "action": "action.view",
                "scope": "ALL",
                "description": "View the Action (3-dots) column in the Discount Payments table.",
                "created_at": now,
                "updated_at": now,
            },
        )

    if insp.has_table("roles") and insp.has_table("role_permissions"):
        admin_rows = bind.execute(
            sa.text("SELECT id FROM roles WHERE LOWER(name) IN ('super_admin', 'admin') AND deleted_at IS NULL")
        ).fetchall()
        for (role_id,) in admin_rows:
            exists = bind.execute(
                sa.text(
                    "SELECT 1 FROM role_permissions WHERE role_id = :rid AND permission_id = :pid"
                ),
                {"rid": _bind_id(role_id), "pid": _bind_id(perm_id)},
            ).fetchone()
            if not exists:
                bind.execute(
                    sa.text(
                        "INSERT INTO role_permissions (id, role_id, permission_id, created_at) "
                        "VALUES (:id, :rid, :pid, :created_at)"
                    ),
                    {
                        "id": _bind_id(uuid.uuid4()),
                        "rid": _bind_id(role_id),
                        "pid": _bind_id(perm_id),
                        "created_at": now,
                    },
                )
