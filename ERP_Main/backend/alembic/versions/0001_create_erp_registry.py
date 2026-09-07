"""create erp_registry tables (erp_instances, erp_modules)

Revision ID: 0001
Revises:
Create Date: 2026-09-07

Phase 2: introduces the ERP Registry foundation only. Does not touch, and
has no foreign keys into, any other database -- this migration runs
exclusively against ERP_Main's own database.
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "0001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _guid():
    """Return a UUID column type: native Postgres UUID, or CHAR(36) elsewhere."""
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        return postgresql.UUID(as_uuid=True)
    return sa.CHAR(36)


def upgrade() -> None:
    """Create erp_instances and erp_modules."""
    guid = _guid()

    op.create_table(
        "erp_instances",
        sa.Column("id", guid, primary_key=True, nullable=False),
        sa.Column("key", sa.String(length=50), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("display_name", sa.String(length=200), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column(
            "status",
            sa.Enum(
                "ACTIVE",
                "INACTIVE",
                "MAINTENANCE",
                "SUSPENDED",
                "DECOMMISSIONED",
                name="erp_status",
                native_enum=False,
                length=20,
            ),
            nullable=False,
            server_default="INACTIVE",
        ),
        sa.Column("base_url", sa.String(length=500), nullable=True),
        sa.Column("environment", sa.String(length=50), nullable=True),
        sa.Column("version", sa.String(length=50), nullable=True),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("key", name="uq_erp_instances_key"),
    )
    op.create_index("ix_erp_instances_key", "erp_instances", ["key"])
    op.create_index("ix_erp_instances_status", "erp_instances", ["status"])

    op.create_table(
        "erp_modules",
        sa.Column("id", guid, primary_key=True, nullable=False),
        sa.Column("erp_instance_id", guid, nullable=False),
        sa.Column("module_key", sa.String(length=100), nullable=False),
        sa.Column("module_name", sa.String(length=150), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["erp_instance_id"], ["erp_instances.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("erp_instance_id", "module_key", name="uq_erp_modules_instance_key"),
    )
    op.create_index("ix_erp_modules_erp_instance_id", "erp_modules", ["erp_instance_id"])


def downgrade() -> None:
    """Drop erp_modules and erp_instances (reversible, no data outside these two tables is touched)."""
    op.drop_index("ix_erp_modules_erp_instance_id", table_name="erp_modules")
    op.drop_table("erp_modules")
    op.drop_index("ix_erp_instances_status", table_name="erp_instances")
    op.drop_index("ix_erp_instances_key", table_name="erp_instances")
    op.drop_table("erp_instances")
