"""add company.manage and company.quick_add granular permissions

Revision ID: z8a9b0c1d2e3
Revises: z7f8a9b0c1d2
Create Date: 2026-11-20 16:30:00.000000

Adds granular permissions for the Companies module:
- company.manage: Full administrative control over Companies
- company.quick_add: + QUICK ADD button and quick add drawer (independent of company.create + ADD NEW)
Updates descriptions on existing company.* permissions for clarity.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Sequence, Union
import uuid

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


# revision identifiers, used by Alembic.
revision: str = "z8a9b0c1d2e3"
down_revision: Union[str, None] = "z7f8a9b0c1d2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

NEW_PERMISSIONS = [
    ("company.quick_add", "company", "companies", "create", "ALL", "Show + QUICK ADD button and create companies via Quick Add drawer."),
    ("company.manage", "company", "companies", "manage", "ALL", "Full administrative control over Companies, including Quick Add, Add New, Grade/Potential edits, Import, Export, Bulk Actions, Action Edit, and Delete."),
]

UPDATED_DESCRIPTIONS = {
    "company.view": "View the company list and contacts; use search, filters, and the Active/Inactive tabs.",
    "company.create": "Show + ADD NEW button and create companies via full Add Company form.",
    "company.update": "Show Action column Edit button, edit companies (Action > Edit), activate/deactivate, and edit contacts.",
    "company.delete": "Delete companies (Bulk Actions > Bulk Delete) and remove company contacts.",
    "company.export": "Show EXPORT option in Imp / Exp menu and export company data.",
    "company.import": "Show SAMPLE FILE and IMPORT options in Imp / Exp menu and import company data.",
    "company.bulk_action": "Show selection checkboxes and Bulk Actions menu (Bulk Activate / Bulk Deactivate) in the company list.",
    "company.grade_edit": "Edit the Grade dropdown in the company list (read-only without this).",
    "company.potential_edit": "Edit the Potential dropdown in the company list (read-only without this).",
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
            sa.text("UPDATE permissions SET description = :desc, updated_at = :updated_at WHERE code = :code"),
            {"code": code, "desc": desc, "updated_at": now},
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
                    f"DELETE FROM {link_table} WHERE permission_id IN (SELECT id FROM permissions WHERE code IN ({placeholders}))"
                ),
                params,
            )

    bind.execute(sa.text(f"DELETE FROM permissions WHERE code IN ({placeholders})"), params)
