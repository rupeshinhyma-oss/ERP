"""add granular technical task tab, action column, and stage action permissions

Revision ID: x1c2d3e4f5a6
Revises: w0b1c2d3e4f5
Create Date: 2026-11-18 12:45:00.000000

Adds granular UI/action permissions to Technical Tasks:
- Status tab views: technicaltask.pending.view, technicaltask.approved.view,
  technicaltask.completed.view, technicaltask.cancel.view
- Action column & menu views: technicaltask.action.view, technicaltask.call_logs.view
- Stage-specific transitions: technicaltask.complete, technicaltask.cancel, technicaltask.reopen
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Sequence, Union
import uuid

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


# revision identifiers, used by Alembic.
revision: str = "x1c2d3e4f5a6"
down_revision: Union[str, None] = "w0b1c2d3e4f5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

NEW_PERMISSIONS = [
    ("technicaltask.pending.view", "technicaltask", "technical-tasks", "view", "ALL", "View the Pending status tab in Technical Tasks."),
    ("technicaltask.approved.view", "technicaltask", "technical-tasks", "view", "ALL", "View the Approved status tab in Technical Tasks."),
    ("technicaltask.completed.view", "technicaltask", "technical-tasks", "view", "ALL", "View the Completed status tab in Technical Tasks."),
    ("technicaltask.cancel.view", "technicaltask", "technical-tasks", "view", "ALL", "View the Cancel status tab in Technical Tasks."),
    ("technicaltask.action.view", "technicaltask", "technical-tasks", "view", "ALL", "View the Action (3-dots) column in the Technical Tasks table."),
    ("technicaltask.call_logs.view", "technicaltask", "technical-tasks", "view", "ALL", "View Call Logs in Action menu and access the Call & Task Logs detail page."),
    ("technicaltask.complete", "technicaltask", "technical-tasks", "update", "ALL", "View/use Completed action (Approved stage) and bulk mark completed."),
    ("technicaltask.cancel", "technicaltask", "technical-tasks", "update", "ALL", "View/use Cancel action (Approved stage) in Technical Tasks."),
    ("technicaltask.reopen", "technicaltask", "technical-tasks", "approve", "ALL", "View/use Reopen / Reassign action (Cancel stage) in Technical Tasks."),
]

NEW_CODES = tuple(row[0] for row in NEW_PERMISSIONS)


def upgrade() -> None:
    bind = op.get_bind()
    insp = inspect(bind)

    if not insp.has_table("permissions"):
        return

    now = datetime.now(timezone.utc)

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
