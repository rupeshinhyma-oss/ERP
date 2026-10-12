"""durable access-sync retry tasks (access_sync_tasks)

Revision ID: 0011
Revises: 0010
Create Date: 2026-10-09

Adds the access_sync_tasks table so that suspend / restore / revoke decisions made in
ERP_Main are retried until the target ERP confirms them.
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0011"
down_revision: Union[str, None] = "0010"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _guid():
    bind = op.get_bind()
    return postgresql.UUID(as_uuid=True) if bind.dialect.name == "postgresql" else sa.CHAR(36)


def upgrade() -> None:
    bind = op.get_bind()
    if "access_sync_tasks" in set(sa.inspect(bind).get_table_names()):
        return
    guid = _guid()
    op.create_table(
        "access_sync_tasks",
        sa.Column("id", guid, primary_key=True),
        sa.Column("membership_id", guid, sa.ForeignKey("erp_memberships.id", ondelete="CASCADE"), nullable=False),
        sa.Column("erp_instance_id", guid, sa.ForeignKey("erp_instances.id", ondelete="CASCADE"), nullable=False),
        sa.Column("local_user_id", sa.String(255), nullable=False),
        sa.Column("requested_allow_login", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("reason", sa.String(500), nullable=True),
        sa.Column("status", sa.String(20), nullable=False, server_default="PENDING_RETRY"),
        sa.Column("retry_count", sa.Integer, nullable=False, server_default="0"),
        sa.Column("max_retries", sa.Integer, nullable=False, server_default="10"),
        sa.Column("next_retry_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("lease_expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("claimed_by", sa.String(255), nullable=True),
        sa.Column("last_error", sa.String(500), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_access_sync_tasks_membership_id", "access_sync_tasks", ["membership_id"], unique=True)
    op.create_index("ix_access_sync_tasks_erp_instance_id", "access_sync_tasks", ["erp_instance_id"])
    op.create_index("ix_access_sync_eligible", "access_sync_tasks", ["status", "next_retry_at", "lease_expires_at"])


def downgrade() -> None:
    op.drop_index("ix_access_sync_eligible", table_name="access_sync_tasks")
    op.drop_index("ix_access_sync_tasks_erp_instance_id", table_name="access_sync_tasks")
    op.drop_index("ix_access_sync_tasks_membership_id", table_name="access_sync_tasks")
    op.drop_table("access_sync_tasks")
