"""phase8e generic synced entity mappings (cross-ERP entity mapping registry)

Revision ID: e4f5a6b7c8d9
Revises: d4e5f6a7b8c2
Create Date: 2026-09-10

Phase 8E: Adds synced_entity_mappings table, generalizing cross-ERP entity identity
and version tracking beyond the Phase 6/7 Buyer pilot to arbitrary master-data entities.
Backfills existing rows from synced_buyer_sources into synced_entity_mappings with
entity_type='buyer'. Purely additive.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "e4f5a6b7c8d9"
down_revision: Union[str, None] = "d4e5f6a7b8c2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _guid():
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        return postgresql.UUID(as_uuid=True)
    return sa.CHAR(36)


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_tables = set(inspector.get_table_names())
    guid = _guid()

    if "synced_entity_mappings" not in existing_tables:
        op.create_table(
            "synced_entity_mappings",
            sa.Column("id", guid, primary_key=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("source_erp_id", sa.String(100), nullable=False),
            sa.Column("entity_type", sa.String(100), nullable=False),
            sa.Column("source_entity_id", sa.String(100), nullable=False),
            sa.Column("local_entity_id", guid, nullable=False),
            sa.Column("source_version", sa.Integer(), nullable=False, server_default="1"),
            sa.Column("local_version", sa.Integer(), nullable=False, server_default="1"),
            sa.Column("sync_status", sa.String(30), nullable=False, server_default="ACTIVE"),
            sa.Column("last_synced_at", sa.DateTime(timezone=True), nullable=False),
            sa.UniqueConstraint("source_erp_id", "entity_type", "source_entity_id", name="uq_synced_entity_mapping"),
        )
        op.create_index(
            "ix_synced_entity_mappings_local_entity",
            "synced_entity_mappings",
            ["local_entity_id"],
        )
        op.create_index(
            "ix_synced_entity_mappings_type_status",
            "synced_entity_mappings",
            ["entity_type", "sync_status"],
        )

        # Backfill existing buyer mappings if table exists
        if "synced_buyer_sources" in existing_tables:
            try:
                op.execute(
                    """
                    INSERT INTO synced_entity_mappings (
                        id, created_at, updated_at, source_erp_id, entity_type,
                        source_entity_id, local_entity_id, source_version,
                        local_version, sync_status, last_synced_at
                    )
                    SELECT
                        id, created_at, updated_at, source_erp_id, 'buyer',
                        source_buyer_id, local_buyer_id, 1,
                        1, 'ACTIVE', updated_at
                    FROM synced_buyer_sources
                    """
                )
            except Exception:
                pass


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_tables = set(inspector.get_table_names())

    if "synced_entity_mappings" in existing_tables:
        op.drop_index("ix_synced_entity_mappings_type_status", table_name="synced_entity_mappings")
        op.drop_index("ix_synced_entity_mappings_local_entity", table_name="synced_entity_mappings")
        op.drop_table("synced_entity_mappings")
