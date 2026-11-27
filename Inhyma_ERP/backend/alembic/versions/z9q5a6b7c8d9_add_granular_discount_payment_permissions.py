"""add granular discount_payment permissions

Revision ID: z9q5a6b7c8d9
Revises: z9o3f4a5b6c7
Create Date: 2026-11-27 12:45:00.000000

Decouples Discount Payments from ``saleorder.*``, ``crm.leads.*``, and
``report.view`` by seeding 7 dedicated granular permissions under module
``discount_payment`` (``page="discount-payments"``):
- discount_payment.view
- discount_payment.pending.view
- discount_payment.completed.view
- discount_payment.action.view
- discount_payment.adjust
- discount_payment.payments.view
- discount_payment.manage
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Sequence, Union
import uuid

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision: str = "z9q5a6b7c8d9"
down_revision: Union[str, Sequence[str], None] = "z9o3f4a5b6c7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

DISCOUNT_PAYMENT_PERMISSIONS = [
    ("discount_payment.view", "discount_payment", "discount-payments", "view", "ALL", "View Discount Payments module, KPI cards, All tab, and discount payment records."),
    ("discount_payment.pending.view", "discount_payment", "discount-payments", "pending.view", "ALL", "View the Pending tab and pending discount payment records."),
    ("discount_payment.completed.view", "discount_payment", "discount-payments", "completed.view", "ALL", "View the Completed tab and settled discount payment records."),
    ("discount_payment.action.view", "discount_payment", "discount-payments", "action.view", "ALL", "View the Action (3-dots) column in the Discount Payments table."),
    ("discount_payment.adjust", "discount_payment", "discount-payments", "adjust", "ALL", "Show Adjust Discount in Action menu and record partial/full discount settlements."),
    ("discount_payment.payments.view", "discount_payment", "discount-payments", "payments.view", "ALL", "Show List Payments in Action menu and inspect installment settlement history."),
    ("discount_payment.manage", "discount_payment", "discount-payments", "manage", "ALL", "Full administrative control over Discount Payments, including View, Pending/Completed tabs, Action column, Adjust Discount, and List Payments."),
]

CODES = tuple(row[0] for row in DISCOUNT_PAYMENT_PERMISSIONS)


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

    for code, module, page, action, scope, desc in DISCOUNT_PAYMENT_PERMISSIONS:
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

    placeholders = ", ".join(f":c{i}" for i in range(len(CODES)))
    params = {f"c{i}": code for i, code in enumerate(CODES)}

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
