"""remove unused shipment planning permissions from inhyma_erp

Revision ID: z6e7f8a9b0c1
Revises: z5d6e7f8a9b0
Create Date: 2026-11-20 12:30:00.000000

Removes the 9 unused Shipment Planning (`planning.*`) permissions from the
Inhyma_ERP RBAC catalog (`permissions`, `role_permissions`, `user_permissions`,
`user_permission_overrides`). The Shipment Planning UI and API router are not
enabled in Inhyma_ERP; removing these permissions removes the unused
SHIPMENT PLANNING card from `/rbac` and User Direct Permission Overrides.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Sequence, Union
import uuid

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


# revision identifiers, used by Alembic.
revision: str = "z6e7f8a9b0c1"
down_revision: Union[str, None] = "z5d6e7f8a9b0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

PLANNING_PERMISSIONS = [
    ("planning.view", "planning", "planning", "view", "ALL", "View planning sheets, grids, and change history."),
    ("planning.sheet.manage", "planning", "planning", "manage", "ALL", "Create, rename, and delete planning sheets (branch tabs); create custom status tags."),
    ("planning.column.manage", "planning", "planning", "manage", "ALL", "Add, rename, move, and delete planning columns (unlimited, admin-named)."),
    ("planning.row.manage", "planning", "planning", "manage", "ALL", "Add, rename, move, and delete planning rows (unlimited)."),
    ("planning.cell.edit", "planning", "planning", "update", "ALL", "Edit the Mum group value cells and their Remarks cells, and set Blue/Custom status tags or clear a tag."),
    ("planning.textyn.edit", "planning", "planning", "update", "ALL", "Edit the TEST(Y/N) column specifically, independent of planning.cell.edit."),
    ("planning.approvaldate.edit", "planning", "planning", "update", "ALL", "Edit the APPROVAL DATE column specifically, independent of planning.cell.edit."),
    ("planning.colorstatusred.edit", "planning", "planning", "update", "ALL", "Set a cell's status color to Red (Requirement), independent of planning.cell.edit."),
    ("planning.colorstatusgreen.edit", "planning", "planning", "update", "ALL", "Set a cell's status color to Green (Purchased), independent of planning.cell.edit."),
]

PLANNING_CODES = tuple(row[0] for row in PLANNING_PERMISSIONS)


def upgrade() -> None:
    bind = op.get_bind()
    insp = inspect(bind)

    if not insp.has_table("permissions"):
        return

    placeholders = ", ".join(f":c{i}" for i in range(len(PLANNING_CODES)))
    params = {f"c{i}": code for i, code in enumerate(PLANNING_CODES)}

    for link_table in ("role_permissions", "user_permissions", "user_permission_overrides"):
        if insp.has_table(link_table):
            bind.execute(
                sa.text(
                    f"DELETE FROM {link_table} WHERE permission_id IN (SELECT id FROM permissions WHERE code IN ({placeholders}))"
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

    for code, module, page, action, scope, desc in PLANNING_PERMISSIONS:
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
