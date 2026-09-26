"""phase8 durable background provisioning reconciliation (provisioning_reconciliation_tasks)

Revision ID: 0010
Revises: 0009
Create Date: 2026-09-24

Phase 8: Adds the provisioning_reconciliation_tasks table for durable, distributed
background reconciliation, automatic retry recovery, and atomic leasing without Redis.
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "0010"
down_revision: Union[str, None] = "0009"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _guid():
    """Return a UUID column type: native Postgres UUID, or CHAR(36) elsewhere."""
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        return postgresql.UUID(as_uuid=True)
    return sa.CHAR(36)


def upgrade() -> None:
    """Create provisioning_reconciliation_tasks table and indexes idempotently."""
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    guid = _guid()

    if "provisioning_reconciliation_tasks" not in tables:
        op.create_table(
            "provisioning_reconciliation_tasks",
            sa.Column("id", guid, primary_key=True),
            sa.Column(
                "membership_id",
                guid,
                sa.ForeignKey("erp_memberships.id", ondelete="CASCADE"),
                nullable=False,
                unique=True,
            ),
            sa.Column(
                "global_user_id",
                guid,
                sa.ForeignKey("global_users.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column(
                "erp_instance_id",
                guid,
                sa.ForeignKey("erp_instances.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column(
                "status",
                sa.String(20),
                server_default="PENDING_RETRY",
                nullable=False,
            ),
            sa.Column(
                "retry_count",
                sa.Integer(),
                server_default="0",
                nullable=False,
            ),
            sa.Column(
                "max_retries",
                sa.Integer(),
                server_default="10",
                nullable=False,
            ),
            sa.Column(
                "next_retry_at",
                sa.DateTime(timezone=True),
                nullable=False,
            ),
            sa.Column(
                "last_attempt_at",
                sa.DateTime(timezone=True),
                nullable=True,
            ),
            sa.Column(
                "claimed_by",
                sa.String(255),
                nullable=True,
            ),
            sa.Column(
                "claimed_at",
                sa.DateTime(timezone=True),
                nullable=True,
            ),
            sa.Column(
                "lease_expires_at",
                sa.DateTime(timezone=True),
                nullable=True,
            ),
            sa.Column(
                "last_error_type",
                sa.String(100),
                nullable=True,
            ),
            sa.Column(
                "last_error_message",
                sa.String(1000),
                nullable=True,
            ),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                server_default=sa.func.now(),
                nullable=False,
            ),
            sa.Column(
                "updated_at",
                sa.DateTime(timezone=True),
                server_default=sa.func.now(),
                nullable=False,
            ),
        )

        op.create_index(
            "ix_prov_recon_membership_id",
            "provisioning_reconciliation_tasks",
            ["membership_id"],
            unique=True,
        )
        op.create_index(
            "ix_prov_recon_global_user_id",
            "provisioning_reconciliation_tasks",
            ["global_user_id"],
        )
        op.create_index(
            "ix_prov_recon_erp_instance_id",
            "provisioning_reconciliation_tasks",
            ["erp_instance_id"],
        )
        op.create_index(
            "ix_prov_recon_status",
            "provisioning_reconciliation_tasks",
            ["status"],
        )
        op.create_index(
            "ix_prov_recon_next_retry_at",
            "provisioning_reconciliation_tasks",
            ["next_retry_at"],
        )
        op.create_index(
            "ix_prov_recon_lease_expires_at",
            "provisioning_reconciliation_tasks",
            ["lease_expires_at"],
        )
        op.create_index(
            "ix_prov_recon_eligible",
            "provisioning_reconciliation_tasks",
            ["status", "next_retry_at", "lease_expires_at"],
        )


def downgrade() -> None:
    """Drop provisioning_reconciliation_tasks table idempotently."""
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    if "provisioning_reconciliation_tasks" in tables:
        op.drop_table("provisioning_reconciliation_tasks")
