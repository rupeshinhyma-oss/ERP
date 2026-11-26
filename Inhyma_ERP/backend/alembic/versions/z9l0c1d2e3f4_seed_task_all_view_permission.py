"""seed_task_all_view_permission

Revision ID: z9l0c1d2e3f4
Revises: z9k9b0c1d2e3
Create Date: 2026-11-19 17:25:00.000000

Idempotently seeds the dedicated read-only ``task.all_view`` permission in
``permissions`` and links it to active ``super_admin`` / ``admin`` roles
(PROD-RBAC-01).

Preserves legacy ``task.organization_view`` rows untouched (ignored by
authorization) and never grants ``task.all_view`` to ordinary user/department
roles or grants ``task.manage`` / ``task.assign`` / ``task.escalate`` /
``task.delete``.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision: str = "z9l0c1d2e3f4"
down_revision: Union[str, Sequence[str], None] = "z9k9b0c1d2e3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TASK_ALL_VIEW_SPEC = (
    "task.all_view",
    "task",
    "tasks",
    "view",
    "ALL",
    "View all tasks across all departments (read-only visibility without task management rights).",
)


def upgrade() -> None:
    bind = op.get_bind()
    insp = inspect(bind)

    if not insp.has_table("permissions"):
        return

    now = datetime.now(timezone.utc)
    code, module, page, action, scope, desc = TASK_ALL_VIEW_SPEC

    perm_row = bind.execute(
        sa.text("SELECT id FROM permissions WHERE code = :code"),
        {"code": code},
    ).fetchone()

    if perm_row:
        perm_id = perm_row[0]
        bind.execute(
            sa.text(
                "UPDATE permissions "
                "SET module = :module, page = :page, action = :action, "
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

    if insp.has_table("roles") and insp.has_table("role_permissions"):
        admin_roles = bind.execute(
            sa.text(
                "SELECT id FROM roles "
                "WHERE LOWER(name) IN ('super_admin', 'admin') AND deleted_at IS NULL"
            )
        ).fetchall()
        for (role_id,) in admin_roles:
            link_exists = bind.execute(
                sa.text(
                    "SELECT 1 FROM role_permissions "
                    "WHERE role_id = :role_id AND permission_id = :perm_id"
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

    code = TASK_ALL_VIEW_SPEC[0]

    if insp.has_table("user_permissions"):
        bind.execute(
            sa.text(
                "DELETE FROM user_permissions "
                "WHERE permission_id IN (SELECT id FROM permissions WHERE code = :code)"
            ),
            {"code": code},
        )

    if insp.has_table("role_permissions"):
        bind.execute(
            sa.text(
                "DELETE FROM role_permissions "
                "WHERE permission_id IN (SELECT id FROM permissions WHERE code = :code)"
            ),
            {"code": code},
        )

    bind.execute(
        sa.text("DELETE FROM permissions WHERE code = :code"),
        {"code": code},
    )
