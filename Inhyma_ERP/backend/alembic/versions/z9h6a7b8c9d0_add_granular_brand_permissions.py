"""add granular brand.manage and brand.status_edit permissions

Revision ID: z9h6a7b8c9d0
Revises: z9g5a6b7c8d9
Create Date: 2026-11-23 16:30:00.000000

Adds granular permissions for the Brands module:
- brand.status_edit: Toggle the inline Status switch (active/inactive) in Brands.
- brand.manage: Full administrative control over Brands, including View,
  Add New, Import (Sample + Import), Export, Bulk Actions, Status toggle, Action Edit,
  and Action Delete.
Updates descriptions (and brand.bulk_action action field) on existing brand.*
permissions for clarity.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Sequence, Union
import uuid

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision: str = "z9h6a7b8c9d0"
down_revision: Union[str, Sequence[str], None] = "z9g5a6b7c8d9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

NEW_PERMISSIONS = [
    (
        "brand.status_edit",
        "brand",
        "masters-brands",
        "status_edit",
        "ALL",
        "Toggle the inline Status switch (active/inactive) in Brands.",
    ),
    (
        "brand.manage",
        "brand",
        "masters-brands",
        "manage",
        "ALL",
        "Full administrative control over Brands, including View, Add New, Import, Export, Bulk Actions, Status toggle, Action Edit, and Action Delete.",
    ),
]

UPDATED_METADATA = {
    "brand.view": (
        "view",
        "View brands; use search, filters, and the Active/Inactive tabs.",
    ),
    "brand.create": (
        "create",
        "Show + ADD NEW button and create brands.",
    ),
    "brand.update": (
        "update",
        "Show Action column Edit button and edit brands.",
    ),
    "brand.delete": (
        "delete",
        "Show Action column Delete button and Bulk Delete option, and delete brands.",
    ),
    "brand.export": (
        "export",
        "Show EXPORT option in Imp / Exp menu and export brand data.",
    ),
    "brand.import": (
        "import",
        "Show SAMPLE FILE and IMPORT options in Imp / Exp menu and import brand data.",
    ),
    "brand.bulk_action": (
        "bulk_action",
        "Show selection checkboxes and Bulk Actions menu (Bulk Activate / Bulk Inactive) in the brand list.",
    ),
}

NEW_CODES = tuple(row[0] for row in NEW_PERMISSIONS)


def upgrade() -> None:
    bind = op.get_bind()
    insp = inspect(bind)

    if not insp.has_table("permissions"):
        return

    now = datetime.now(timezone.utc)

    for code, (action, desc) in UPDATED_METADATA.items():
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
