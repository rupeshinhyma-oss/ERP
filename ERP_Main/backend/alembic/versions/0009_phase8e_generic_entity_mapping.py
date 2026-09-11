"""phase8e generic entity mapping metadata (integration_entity_mappings)

Revision ID: 0009
Revises: 0008
Create Date: 2026-09-10

Phase 8E: Generalizes integration_entity_mappings on ERP_Main with metadata:
mapping status, source/target versions, last successful synchronization timestamp,
and correlation identifier.
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "0009"
down_revision: Union[str, None] = "0008"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _guid():
    """Return a UUID column type: native Postgres UUID, or CHAR(36) elsewhere."""
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        return postgresql.UUID(as_uuid=True)
    return sa.CHAR(36)


def upgrade() -> None:
    """Add metadata columns to integration_entity_mappings idempotently."""
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_columns = {col["name"] for col in inspector.get_columns("integration_entity_mappings")}

    guid = _guid()

    if "status" not in existing_columns:
        op.add_column(
            "integration_entity_mappings",
            sa.Column("status", sa.String(30), server_default="ACTIVE", nullable=False),
        )
    if "source_version" not in existing_columns:
        op.add_column(
            "integration_entity_mappings",
            sa.Column("source_version", sa.Integer(), nullable=True),
        )
    if "target_version" not in existing_columns:
        op.add_column(
            "integration_entity_mappings",
            sa.Column("target_version", sa.Integer(), nullable=True),
        )
    if "last_synced_at" not in existing_columns:
        op.add_column(
            "integration_entity_mappings",
            sa.Column("last_synced_at", sa.DateTime(timezone=True), nullable=True),
        )
    if "correlation_id" not in existing_columns:
        op.add_column(
            "integration_entity_mappings",
            sa.Column("correlation_id", guid, nullable=True),
        )


def downgrade() -> None:
    """Drop metadata columns from integration_entity_mappings idempotently."""
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_columns = {col["name"] for col in inspector.get_columns("integration_entity_mappings")}

    for col in ["correlation_id", "last_synced_at", "target_version", "source_version", "status"]:
        if col in existing_columns:
            op.drop_column("integration_entity_mappings", col)
