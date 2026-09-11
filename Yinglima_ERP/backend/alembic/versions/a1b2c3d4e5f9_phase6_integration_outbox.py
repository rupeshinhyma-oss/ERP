"""phase6 integration outbox events

Revision ID: a1b2c3d4e5f9
Revises: j5e6f7g8h9i0
Create Date: 2026-09-08

Phase 6: adds the producer-side Transactional Outbox table
(`integration_outbox_events`) for cross-ERP integration events. Purely
additive -- does not alter, rename, or drop any existing column/table.
No foreign key to any other ERP's database (Section 3/31); every
cross-ERP reference here is a plain UUID column, resolved only via
HTTP at dispatch time.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "a1b2c3d4e5f9"
down_revision: Union[str, None] = "j5e6f7g8h9i0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    if not insp.has_table("integration_outbox_events"):
        op.create_table(
            "integration_outbox_events",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("event_id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column("event_type", sa.String(150), nullable=False),
            sa.Column("event_version", sa.Integer(), nullable=False, server_default="1"),
            sa.Column("aggregate_type", sa.String(100), nullable=False),
            sa.Column("aggregate_id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column("correlation_id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column("causation_id", postgresql.UUID(as_uuid=True), nullable=True),
            sa.Column("actor_type", sa.String(20), nullable=False),
            sa.Column("actor_id", postgresql.UUID(as_uuid=True), nullable=True),
            sa.Column("target", sa.String(50), nullable=False, server_default="broadcast"),
            sa.Column("payload", sa.Text(), nullable=False),
            sa.Column("status", sa.String(20), nullable=False, server_default="PENDING"),
            sa.Column("attempt_count", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("max_attempts", sa.Integer(), nullable=False, server_default="5"),
            sa.Column("last_error", sa.Text(), nullable=True),
            sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False),
            sa.UniqueConstraint("event_id", name="uq_integration_outbox_event_id"),
        )
        op.create_index("ix_integration_outbox_events_event_id", "integration_outbox_events", ["event_id"])
        op.create_index("ix_integration_outbox_events_event_type", "integration_outbox_events", ["event_type"])
        op.create_index("ix_integration_outbox_events_aggregate_id", "integration_outbox_events", ["aggregate_id"])
        op.create_index("ix_integration_outbox_events_correlation_id", "integration_outbox_events", ["correlation_id"])
        op.create_index("ix_integration_outbox_events_status", "integration_outbox_events", ["status"])


def downgrade() -> None:
    op.drop_index("ix_integration_outbox_events_status", table_name="integration_outbox_events")
    op.drop_index("ix_integration_outbox_events_correlation_id", table_name="integration_outbox_events")
    op.drop_index("ix_integration_outbox_events_aggregate_id", table_name="integration_outbox_events")
    op.drop_index("ix_integration_outbox_events_event_type", table_name="integration_outbox_events")
    op.drop_index("ix_integration_outbox_events_event_id", table_name="integration_outbox_events")
    op.drop_table("integration_outbox_events")
