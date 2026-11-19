"""remove technicaltask.export permission

Revision ID: y1d2e3f4a5b6
Revises: x1c2d3e4f5a6
Create Date: 2026-11-18 13:10:00.000000

Removes obsolete ``technicaltask.export`` permission since Export was removed
from the Technical Tasks module.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Sequence, Union
import uuid

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision: str = "y1d2e3f4a5b6"
down_revision: Union[str, None] = "x1c2d3e4f5a6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = inspect(bind)

    if not insp.has_table("permissions"):
        return

    if insp.has_table("user_permissions"):
        bind.execute(
            sa.text(
                "DELETE FROM user_permissions WHERE permission_id IN ("
                "  SELECT id FROM permissions WHERE code = 'technicaltask.export'"
                ")"
            )
        )

    if insp.has_table("role_permissions"):
        bind.execute(
            sa.text(
                "DELETE FROM role_permissions WHERE permission_id IN ("
                "  SELECT id FROM permissions WHERE code = 'technicaltask.export'"
                ")"
            )
        )

    bind.execute(sa.text("DELETE FROM permissions WHERE code = 'technicaltask.export'"))


def downgrade() -> None:
    bind = op.get_bind()
    insp = inspect(bind)

    if not insp.has_table("permissions"):
        return

    existing = bind.execute(
        sa.text("SELECT id FROM permissions WHERE code = 'technicaltask.export'")
    ).fetchone()
    if existing:
        return

    now = datetime.now(timezone.utc)
    perm_id = uuid.uuid4()
    bind.execute(
        sa.text(
            "INSERT INTO permissions (id, code, module, page, action, scope, description, created_at, updated_at) "
            "VALUES (:id, 'technicaltask.export', 'technicaltask', 'technical-tasks', 'export', 'ALL', "
            "'Export technical tasks to CSV.', :created_at, :updated_at)"
        ),
        {"id": perm_id, "created_at": now, "updated_at": now},
    )
