"""phase6 integration control plane (integration_subscriptions, integration_inbox_events, integration_entity_mappings, integration_dead_letters)

Revision ID: 0005
Revises: 0004
Create Date: 2026-09-08

Phase 6: adds ERP_Main's control-plane side of cross-ERP integration --
routing subscriptions, the received-event inbox (dedup + routing
bookkeeping), explicit cross-ERP entity identity mappings, and dead
letters. Purely additive -- does not alter, rename, or drop any column
on any table created by 0001-0004. No foreign key here ever points
outside ERP_Main's own database (mirrors every prior phase's own
migration note); Yinglima and Inhyma's own `integration_outbox` tables
are separate migrations in their own repositories.
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "0005"
down_revision: Union[str, None] = "0004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _guid():
    """Return a UUID column type: native Postgres UUID, or CHAR(36) elsewhere."""
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        return postgresql.UUID(as_uuid=True)
    return sa.CHAR(36)


def upgrade() -> None:
    """Create integration_subscriptions, integration_inbox_events, integration_entity_mappings, integration_dead_letters."""
    guid = _guid()

    op.create_table(
        "integration_subscriptions",
        sa.Column("id", guid, primary_key=True, nullable=False),
        sa.Column("event_type", sa.String(length=150), nullable=False),
        sa.Column("source_erp_id", guid, nullable=False),
        sa.Column("target_erp_id", guid, nullable=True),
        sa.Column(
            "target_kind",
            sa.Enum("SPECIFIC_ERP", "BROADCAST", name="integration_target_kind", native_enum=False, length=20),
            nullable=False,
            server_default="SPECIFIC_ERP",
        ),
        sa.Column("required_capability", sa.String(length=100), nullable=True),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["source_erp_id"], ["erp_instances.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["target_erp_id"], ["erp_instances.id"], ondelete="CASCADE"),
        sa.UniqueConstraint(
            "event_type", "source_erp_id", "target_erp_id", name="uq_integration_subscription_type_source_target"
        ),
    )
    op.create_index("ix_integration_subscriptions_event_type", "integration_subscriptions", ["event_type"])
    op.create_index("ix_integration_subscriptions_source_erp_id", "integration_subscriptions", ["source_erp_id"])
    op.create_index("ix_integration_subscriptions_target_erp_id", "integration_subscriptions", ["target_erp_id"])

    op.create_table(
        "integration_inbox_events",
        sa.Column("id", guid, primary_key=True, nullable=False),
        sa.Column("event_id", guid, nullable=False),
        sa.Column("event_type", sa.String(length=150), nullable=False),
        sa.Column("event_version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("source_erp_id", guid, nullable=False),
        sa.Column("source_entity_type", sa.String(length=100), nullable=False),
        sa.Column("source_entity_id", guid, nullable=False),
        sa.Column("correlation_id", guid, nullable=False),
        sa.Column("causation_id", guid, nullable=True),
        sa.Column("actor_type", sa.String(length=20), nullable=False),
        sa.Column("actor_id", guid, nullable=True),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("payload", sa.Text(), nullable=False),
        sa.Column(
            "status",
            sa.Enum(
                "RECEIVED", "ROUTED", "IGNORED", "FAILED", "DEAD_LETTER",
                name="integration_inbox_status", native_enum=False, length=20,
            ),
            nullable=False,
            server_default="RECEIVED",
        ),
        sa.Column("routed_to", sa.Text(), nullable=True),
        sa.Column("attempt_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["source_erp_id"], ["erp_instances.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("event_id", name="uq_integration_inbox_event_id"),
    )
    op.create_index("ix_integration_inbox_events_event_id", "integration_inbox_events", ["event_id"])
    op.create_index("ix_integration_inbox_events_event_type", "integration_inbox_events", ["event_type"])
    op.create_index("ix_integration_inbox_events_source_erp_id", "integration_inbox_events", ["source_erp_id"])
    op.create_index("ix_integration_inbox_events_source_entity_id", "integration_inbox_events", ["source_entity_id"])
    op.create_index("ix_integration_inbox_events_correlation_id", "integration_inbox_events", ["correlation_id"])
    op.create_index("ix_integration_inbox_events_status", "integration_inbox_events", ["status"])

    op.create_table(
        "integration_entity_mappings",
        sa.Column("id", guid, primary_key=True, nullable=False),
        sa.Column("source_erp_id", guid, nullable=False),
        sa.Column("source_entity_type", sa.String(length=100), nullable=False),
        sa.Column("source_entity_id", guid, nullable=False),
        sa.Column("target_erp_id", guid, nullable=False),
        sa.Column("target_entity_type", sa.String(length=100), nullable=False),
        sa.Column("target_entity_id", guid, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["source_erp_id"], ["erp_instances.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["target_erp_id"], ["erp_instances.id"], ondelete="CASCADE"),
        sa.UniqueConstraint(
            "source_erp_id", "source_entity_type", "source_entity_id", "target_erp_id", "target_entity_type",
            name="uq_integration_entity_mapping",
        ),
    )
    op.create_index("ix_integration_entity_mappings_source_erp_id", "integration_entity_mappings", ["source_erp_id"])
    op.create_index("ix_integration_entity_mappings_source_entity_id", "integration_entity_mappings", ["source_entity_id"])
    op.create_index("ix_integration_entity_mappings_target_erp_id", "integration_entity_mappings", ["target_erp_id"])
    op.create_index("ix_integration_entity_mappings_target_entity_id", "integration_entity_mappings", ["target_entity_id"])

    op.create_table(
        "integration_dead_letters",
        sa.Column("id", guid, primary_key=True, nullable=False),
        sa.Column("inbox_event_id", guid, nullable=False),
        sa.Column("event_id", guid, nullable=False),
        sa.Column("event_type", sa.String(length=150), nullable=False),
        sa.Column("source_erp_id", guid, nullable=False),
        sa.Column("attempt_count", sa.Integer(), nullable=False),
        sa.Column("last_error", sa.Text(), nullable=False),
        sa.Column("failed_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("replayed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("replayed_by", guid, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["inbox_event_id"], ["integration_inbox_events.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["source_erp_id"], ["erp_instances.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("inbox_event_id", name="uq_integration_dead_letter_inbox_event_id"),
    )
    op.create_index("ix_integration_dead_letters_inbox_event_id", "integration_dead_letters", ["inbox_event_id"])
    op.create_index("ix_integration_dead_letters_event_id", "integration_dead_letters", ["event_id"])
    op.create_index("ix_integration_dead_letters_event_type", "integration_dead_letters", ["event_type"])
    op.create_index("ix_integration_dead_letters_source_erp_id", "integration_dead_letters", ["source_erp_id"])


def downgrade() -> None:
    """Drop every Phase 6 table, in FK-safe reverse order. Leaves all Phase 2-5 tables completely untouched."""
    op.drop_index("ix_integration_dead_letters_source_erp_id", table_name="integration_dead_letters")
    op.drop_index("ix_integration_dead_letters_event_type", table_name="integration_dead_letters")
    op.drop_index("ix_integration_dead_letters_event_id", table_name="integration_dead_letters")
    op.drop_index("ix_integration_dead_letters_inbox_event_id", table_name="integration_dead_letters")
    op.drop_table("integration_dead_letters")

    op.drop_index("ix_integration_entity_mappings_target_entity_id", table_name="integration_entity_mappings")
    op.drop_index("ix_integration_entity_mappings_target_erp_id", table_name="integration_entity_mappings")
    op.drop_index("ix_integration_entity_mappings_source_entity_id", table_name="integration_entity_mappings")
    op.drop_index("ix_integration_entity_mappings_source_erp_id", table_name="integration_entity_mappings")
    op.drop_table("integration_entity_mappings")

    op.drop_index("ix_integration_inbox_events_status", table_name="integration_inbox_events")
    op.drop_index("ix_integration_inbox_events_correlation_id", table_name="integration_inbox_events")
    op.drop_index("ix_integration_inbox_events_source_entity_id", table_name="integration_inbox_events")
    op.drop_index("ix_integration_inbox_events_source_erp_id", table_name="integration_inbox_events")
    op.drop_index("ix_integration_inbox_events_event_type", table_name="integration_inbox_events")
    op.drop_index("ix_integration_inbox_events_event_id", table_name="integration_inbox_events")
    op.drop_table("integration_inbox_events")

    op.drop_index("ix_integration_subscriptions_target_erp_id", table_name="integration_subscriptions")
    op.drop_index("ix_integration_subscriptions_source_erp_id", table_name="integration_subscriptions")
    op.drop_index("ix_integration_subscriptions_event_type", table_name="integration_subscriptions")
    op.drop_table("integration_subscriptions")
