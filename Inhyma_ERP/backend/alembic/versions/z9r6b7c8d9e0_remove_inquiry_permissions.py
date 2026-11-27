"""remove unused inquiry and quotation permissions from inhyma_erp

Revision ID: z9r6b7c8d9e0
Revises: z9q5a6b7c8d9
Create Date: 2026-11-27 13:20:00.000000

Removes the 8 unused Inquiries & Quotations (``inquiry.*``, ``quotation.*``)
permissions from the Inhyma_ERP RBAC catalog (``permissions``,
``role_permissions``, ``user_permissions``, ``user_permission_overrides``).
Inhyma_ERP does not expose an Inquiries module (`/inquiries` redirects to
`/proforma-invoice/list`), so removing these legacy permissions removes the
dead INQUIRIES & QUOTATIONS card under SALE on `/rbac` and Override modals.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Sequence, Union
import uuid

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision: str = "z9r6b7c8d9e0"
down_revision: Union[str, Sequence[str], None] = "z9q5a6b7c8d9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

INQUIRY_PERMISSIONS = [
    ("inquiry.view", "inquiry", "inquiries", "view", "ALL", "View inquiries and consignment lists."),
    ("inquiry.create", "inquiry", "inquiries", "create", "ALL", "Create new inquiries and consignments."),
    ("inquiry.update", "inquiry", "inquiries", "update", "ALL", "Edit inquiries, items, statuses, and send messages."),
    ("inquiry.delete", "inquiry", "inquiries", "delete", "ALL", "Delete inquiries and consignment items."),
    ("inquiry.approve", "inquiry", "inquiries", "manage", "ALL", "Approve inquiry quotes and confirm consignments."),
    ("quotation.create", "inquiry", "inquiries", "create", "ALL", "Add and upload quotations for inquiry items."),
    ("quotation.approve", "inquiry", "inquiries", "manage", "ALL", "Approve quotations for inquiry items."),
    ("quotation.delete", "inquiry", "inquiries", "delete", "ALL", "Delete quotations and quotation attachments."),
]

INQUIRY_CODES = tuple(row[0] for row in INQUIRY_PERMISSIONS)


def upgrade() -> None:
    bind = op.get_bind()
    insp = inspect(bind)

    if not insp.has_table("permissions"):
        return

    placeholders = ", ".join(f":c{i}" for i in range(len(INQUIRY_CODES)))
    params = {f"c{i}": code for i, code in enumerate(INQUIRY_CODES)}

    for link_table in ("role_permissions", "user_permissions", "user_permission_overrides"):
        if insp.has_table(link_table):
            bind.execute(
                sa.text(
                    f"DELETE FROM {link_table} WHERE permission_id IN ("
                    f"SELECT id FROM permissions WHERE code IN ({placeholders}))"
                ),
                params,
            )

    bind.execute(
        sa.text(f"DELETE FROM permissions WHERE code IN ({placeholders})"),
        params,
    )


def downgrade() -> None:
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

    for code, module, page, action, scope, desc in INQUIRY_PERMISSIONS:
        existing = bind.execute(sa.text("SELECT id FROM permissions WHERE code = :code"), {"code": code}).fetchone()
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
