"""phase8a entity sync policy registry (entity_sync_policies)

Revision ID: 0008
Revises: 0007
Create Date: 2026-09-10

Phase 8A: Adds the queryable EntitySyncPolicy control-plane registry to ERP_Main.
Specifies authoritative ownership, synchronization direction, conflict resolution,
delete propagation, and version sequencing across autonomous partner ERP nodes.

Purely additive -- does not alter, rename, or drop any column on any table created
by 0001-0007. No foreign key here points outside ERP_Main's own database.
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "0008"
down_revision: Union[str, None] = "0007"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _guid():
    """Return a UUID column type: native Postgres UUID, or CHAR(36) elsewhere."""
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        return postgresql.UUID(as_uuid=True)
    return sa.CHAR(36)


def upgrade() -> None:
    """Create entity_sync_policies table, foreign keys, and indexes idempotently."""
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_tables = set(inspector.get_table_names())

    guid = _guid()

    if "entity_sync_policies" not in existing_tables:
        op.create_table(
            "entity_sync_policies",
            sa.Column("id", guid, primary_key=True, nullable=False),
            sa.Column("source_erp_id", guid, nullable=False),
            sa.Column("target_erp_id", guid, nullable=False),
            sa.Column("source_module", sa.String(length=100), nullable=True),
            sa.Column("target_module", sa.String(length=100), nullable=True),
            sa.Column("entity_type", sa.String(length=100), nullable=False),
            sa.Column("authoritative_owner_erp_id", guid, nullable=True),
            sa.Column(
                "ownership_strategy",
                sa.Enum(
                    "SOURCE_OWNED", "TARGET_OWNED", "SHARED_MANUAL",
                    name="sync_ownership_strategy", native_enum=False, length=30,
                ),
                nullable=False,
                server_default="SOURCE_OWNED",
            ),
            sa.Column(
                "direction",
                sa.Enum(
                    "SOURCE_TO_TARGET", "TARGET_TO_SOURCE", "BIDIRECTIONAL",
                    name="sync_direction", native_enum=False, length=30,
                ),
                nullable=False,
                server_default="SOURCE_TO_TARGET",
            ),
            sa.Column(
                "conflict_strategy",
                sa.Enum(
                    "SOURCE_WINS", "TARGET_WINS", "MANUAL", "REJECT_QUARANTINE", "LATEST_TIMESTAMP",
                    name="sync_conflict_strategy", native_enum=False, length=30,
                ),
                nullable=False,
                server_default="SOURCE_WINS",
            ),
            sa.Column(
                "delete_strategy",
                sa.Enum(
                    "PROPAGATE_DELETE", "PROPAGATE_ARCHIVE", "IGNORE_DELETE", "MANUAL_REVIEW",
                    name="sync_delete_strategy", native_enum=False, length=30,
                ),
                nullable=False,
                server_default="IGNORE_DELETE",
            ),
            sa.Column(
                "version_strategy",
                sa.Enum(
                    "EVENT_VERSION", "SOURCE_UPDATED_AT", "MONOTONIC_SEQUENCE", "MANUAL",
                    name="sync_version_strategy", native_enum=False, length=30,
                ),
                nullable=False,
                server_default="EVENT_VERSION",
            ),
            sa.Column(
                "status",
                sa.Enum(
                    "ACTIVE", "INACTIVE", "DRAFT", "DEPRECATED",
                    name="sync_policy_status", native_enum=False, length=20,
                ),
                nullable=False,
                server_default="ACTIVE",
            ),
            sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("custom_config", sa.Text(), nullable=True),
            sa.Column("created_by", guid, nullable=True),
            sa.Column("updated_by", guid, nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(["source_erp_id"], ["erp_instances.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["target_erp_id"], ["erp_instances.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["authoritative_owner_erp_id"], ["erp_instances.id"], ondelete="SET NULL"),
        )

    # Re-inspect to get current indexes on the table
    existing_indexes: set[str] = set()
    try:
        existing_indexes = {
            ix["name"] for ix in inspector.get_indexes("entity_sync_policies") if ix.get("name")
        }
    except Exception:
        pass

    indexes_to_create = [
        ("ix_entity_sync_policies_source_erp_id", ["source_erp_id"]),
        ("ix_entity_sync_policies_target_erp_id", ["target_erp_id"]),
        ("ix_entity_sync_policies_entity_type", ["entity_type"]),
        ("ix_entity_sync_policies_status", ["status"]),
        ("ix_entity_sync_policies_enabled", ["enabled"]),
        ("ix_entity_sync_policies_authoritative_owner", ["authoritative_owner_erp_id"]),
        ("ix_entity_sync_policies_lookup", ["source_erp_id", "target_erp_id", "entity_type"]),
        ("ix_entity_sync_policies_entity_status", ["entity_type", "status"]),
    ]

    for index_name, columns in indexes_to_create:
        if index_name not in existing_indexes:
            op.create_index(index_name, "entity_sync_policies", columns)


def downgrade() -> None:
    """Drop indexes and table in FK-safe reverse order idempotently."""
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_tables = set(inspector.get_table_names())

    if "entity_sync_policies" in existing_tables:
        existing_indexes: set[str] = set()
        try:
            existing_indexes = {
                ix["name"] for ix in inspector.get_indexes("entity_sync_policies") if ix.get("name")
            }
        except Exception:
            pass

        indexes_to_drop = [
            "ix_entity_sync_policies_entity_status",
            "ix_entity_sync_policies_lookup",
            "ix_entity_sync_policies_authoritative_owner",
            "ix_entity_sync_policies_enabled",
            "ix_entity_sync_policies_status",
            "ix_entity_sync_policies_entity_type",
            "ix_entity_sync_policies_target_erp_id",
            "ix_entity_sync_policies_source_erp_id",
        ]

        for index_name in indexes_to_drop:
            if index_name in existing_indexes:
                op.drop_index(index_name, table_name="entity_sync_policies")

        op.drop_table("entity_sync_policies")
