"""phase3 durable events (durable_events, event_consumers, event_deliveries, dead_letter_events)

Revision ID: c3d4e5f6a7b1
Revises: b2c3d4e5f6a9
Create Date: 2026-09-09

Phase 3: adds the durable event/queue system -- the SQL source of truth
underneath the existing in-memory `app.events` WebSocket dispatch, plus
per-consumer claim/lease/retry state for reliable fan-out to multiple
independent consumers. Purely additive. Does not touch
`integration_outbox_events` (Phase 6), a separate mechanism.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "c3d4e5f6a7b1"
down_revision: Union[str, None] = "b2c3d4e5f6a9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    if not insp.has_table("durable_events"):
        op.create_table(
            "durable_events",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("event_type", sa.String(150), nullable=False),
            sa.Column("event_version", sa.Integer(), nullable=False, server_default="1"),
            sa.Column("source", sa.String(50), nullable=False),
            sa.Column("target", sa.String(50), nullable=True),
            sa.Column("entity", sa.String(100), nullable=False),
            sa.Column("entity_id", sa.String(150), nullable=False),
            sa.Column("entity_version", sa.Integer(), nullable=True),
            sa.Column("payload", sa.Text(), nullable=False, server_default="{}"),
            sa.Column("event_metadata", sa.Text(), nullable=False, server_default="{}"),
            sa.Column("idempotency_key", sa.String(255), nullable=True),
            sa.Column("correlation_id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column("causation_id", postgresql.UUID(as_uuid=True), nullable=True),
            sa.Column("user_id", sa.String(150), nullable=True),
            sa.Column("priority", sa.String(20), nullable=False, server_default="normal"),
            sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False),
            sa.UniqueConstraint("idempotency_key", name="uq_durable_event_idempotency_key"),
        )
        op.create_index("ix_durable_events_event_type", "durable_events", ["event_type"])
        op.create_index("ix_durable_events_entity", "durable_events", ["entity"])
        op.create_index("ix_durable_events_entity_id", "durable_events", ["entity_id"])
        op.create_index("ix_durable_events_idempotency_key", "durable_events", ["idempotency_key"])
        op.create_index("ix_durable_events_correlation_id", "durable_events", ["correlation_id"])

        op.create_table(
            "event_consumers",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("consumer_key", sa.String(150), nullable=False),
            sa.Column("description", sa.String(500), nullable=True),
            sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.UniqueConstraint("consumer_key", name="uq_event_consumer_key"),
        )
        op.create_index("ix_event_consumers_consumer_key", "event_consumers", ["consumer_key"])

        op.create_table(
            "event_deliveries",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("event_id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column("consumer_id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column(
                "status",
                sa.Enum(
                    "PENDING", "PROCESSING", "SUCCESS", "RETRY", "DEAD_LETTER", "CANCELLED",
                    name="event_delivery_status", native_enum=False, length=20,
                ),
                nullable=False,
                server_default="PENDING",
            ),
            sa.Column("available_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("claimed_by", sa.String(100), nullable=True),
            sa.Column("claimed_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("lease_expires_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("attempt_count", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("max_attempts", sa.Integer(), nullable=False, server_default="8"),
            sa.Column("last_error", sa.Text(), nullable=True),
            sa.Column("processed_at", sa.DateTime(timezone=True), nullable=True),
            sa.ForeignKeyConstraint(["event_id"], ["durable_events.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["consumer_id"], ["event_consumers.id"], ondelete="CASCADE"),
            sa.UniqueConstraint("event_id", "consumer_id", name="uq_event_delivery_event_consumer"),
        )
        op.create_index("ix_event_deliveries_event_id", "event_deliveries", ["event_id"])
        op.create_index("ix_event_deliveries_consumer_id", "event_deliveries", ["consumer_id"])
        op.create_index("ix_event_deliveries_status", "event_deliveries", ["status"])
        op.create_index("ix_event_deliveries_available_at", "event_deliveries", ["available_at"])
        op.create_index("ix_event_deliveries_lease_expires_at", "event_deliveries", ["lease_expires_at"])

        op.create_table(
            "dead_letter_events",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("delivery_id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column("event_id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column("consumer_id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column("event_type", sa.String(150), nullable=False),
            sa.Column("attempt_count", sa.Integer(), nullable=False),
            sa.Column("first_failed_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("last_failed_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("failure_reason", sa.Text(), nullable=False),
            sa.Column("replayed_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("replayed_by", sa.String(150), nullable=True),
            sa.ForeignKeyConstraint(["delivery_id"], ["event_deliveries.id"], ondelete="CASCADE"),
            sa.UniqueConstraint("delivery_id", name="uq_dead_letter_delivery_id"),
        )
        op.create_index("ix_dead_letter_events_delivery_id", "dead_letter_events", ["delivery_id"])
        op.create_index("ix_dead_letter_events_event_id", "dead_letter_events", ["event_id"])
        op.create_index("ix_dead_letter_events_consumer_id", "dead_letter_events", ["consumer_id"])
        op.create_index("ix_dead_letter_events_event_type", "dead_letter_events", ["event_type"])


def downgrade() -> None:
    op.drop_index("ix_dead_letter_events_event_type", table_name="dead_letter_events")
    op.drop_index("ix_dead_letter_events_consumer_id", table_name="dead_letter_events")
    op.drop_index("ix_dead_letter_events_event_id", table_name="dead_letter_events")
    op.drop_index("ix_dead_letter_events_delivery_id", table_name="dead_letter_events")
    op.drop_table("dead_letter_events")

    op.drop_index("ix_event_deliveries_lease_expires_at", table_name="event_deliveries")
    op.drop_index("ix_event_deliveries_available_at", table_name="event_deliveries")
    op.drop_index("ix_event_deliveries_status", table_name="event_deliveries")
    op.drop_index("ix_event_deliveries_consumer_id", table_name="event_deliveries")
    op.drop_index("ix_event_deliveries_event_id", table_name="event_deliveries")
    op.drop_table("event_deliveries")

    op.drop_index("ix_event_consumers_consumer_key", table_name="event_consumers")
    op.drop_table("event_consumers")

    op.drop_index("ix_durable_events_correlation_id", table_name="durable_events")
    op.drop_index("ix_durable_events_idempotency_key", table_name="durable_events")
    op.drop_index("ix_durable_events_entity_id", table_name="durable_events")
    op.drop_index("ix_durable_events_entity", table_name="durable_events")
    op.drop_index("ix_durable_events_event_type", table_name="durable_events")
    op.drop_table("durable_events")
