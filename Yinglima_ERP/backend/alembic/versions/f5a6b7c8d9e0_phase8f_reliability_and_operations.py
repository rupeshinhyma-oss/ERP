"""phase8f reliability, operations, backpressure & recovery hardening

Revision ID: f5a6b7c8d9e0
Revises: e4f5a6b7c8d9
Create Date: 2026-09-10

Phase 8F: Adds:
1. integration_outbox_deliveries: independent per-target delivery tracking for fan-out,
   leased claiming, crash recovery, and exponential backoff retry.
2. peer_health_states: Redis-free persistent circuit breaker and peer cooldown tracking.
3. snapshot_jobs: resumable snapshot sync with cursor checkpointing.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "f5a6b7c8d9e0"
down_revision: Union[str, None] = "e4f5a6b7c8d9"
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

    # 1. integration_outbox_deliveries
    if "integration_outbox_deliveries" not in existing_tables:
        op.create_table(
            "integration_outbox_deliveries",
            sa.Column("id", guid, primary_key=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.Column(
                "outbox_event_id",
                guid,
                sa.ForeignKey("integration_outbox_events.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("target_erp", sa.String(100), nullable=False),
            sa.Column("status", sa.String(30), nullable=False, server_default="PENDING"),
            sa.Column("attempt_count", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("max_attempts", sa.Integer(), nullable=False, server_default="5"),
            sa.Column("worker_id", sa.String(100), nullable=True),
            sa.Column("lease_expires_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("next_attempt_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.Column("last_attempt_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("delivered_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("last_error_code", sa.String(100), nullable=True),
            sa.Column("last_error_message", sa.Text(), nullable=True),
            sa.UniqueConstraint("outbox_event_id", "target_erp", name="uq_outbox_delivery_event_target"),
        )
        op.create_index(
            "ix_outbox_deliveries_status_next",
            "integration_outbox_deliveries",
            ["status", "next_attempt_at"],
        )
        op.create_index(
            "ix_outbox_deliveries_target_status",
            "integration_outbox_deliveries",
            ["target_erp", "status"],
        )
        op.create_index(
            "ix_outbox_deliveries_event_id",
            "integration_outbox_deliveries",
            ["outbox_event_id"],
        )

        # Backfill initial delivery rows for existing outbox events
        if "integration_outbox_events" in existing_tables:
            try:
                op.execute(
                    """
                    INSERT INTO integration_outbox_deliveries (
                        id, created_at, updated_at, outbox_event_id, target_erp,
                        status, attempt_count, max_attempts, next_attempt_at,
                        last_error_message, delivered_at
                    )
                    SELECT
                        id, created_at, updated_at, id, target,
                        CASE
                            WHEN status = 'PUBLISHED' THEN 'DELIVERED'
                            WHEN status = 'DEAD_LETTER' THEN 'DEAD_LETTER'
                            WHEN status = 'FAILED' THEN 'RETRYING'
                            WHEN status = 'DISPATCHING' THEN 'PROCESSING'
                            ELSE 'PENDING'
                        END,
                        attempt_count, max_attempts, created_at,
                        last_error, published_at
                    FROM integration_outbox_events
                    ON CONFLICT DO NOTHING
                    """
                )
            except Exception:
                pass

    # 2. peer_health_states
    if "peer_health_states" not in existing_tables:
        op.create_table(
            "peer_health_states",
            sa.Column("peer_id", sa.String(100), primary_key=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.Column("circuit_state", sa.String(20), nullable=False, server_default="CLOSED"),
            sa.Column("consecutive_failures", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("consecutive_successes", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("cooldown_until", sa.DateTime(timezone=True), nullable=True),
            sa.Column("last_failure_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("last_success_at", sa.DateTime(timezone=True), nullable=True),
        )

    # 3. snapshot_jobs
    if "snapshot_jobs" not in existing_tables:
        op.create_table(
            "snapshot_jobs",
            sa.Column("id", guid, primary_key=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.Column("entity_type", sa.String(100), nullable=False),
            sa.Column("source_erp", sa.String(100), nullable=False),
            sa.Column("target_erp", sa.String(100), nullable=False),
            sa.Column("cursor_offset", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("batch_size", sa.Integer(), nullable=False, server_default="100"),
            sa.Column("total_records", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("records_processed", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("records_failed", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("status", sa.String(30), nullable=False, server_default="IN_PROGRESS"),
            sa.Column("last_error", sa.Text(), nullable=True),
            sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        )
        op.create_index(
            "ix_snapshot_jobs_type_status",
            "snapshot_jobs",
            ["entity_type", "status"],
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_tables = set(inspector.get_table_names())

    if "snapshot_jobs" in existing_tables:
        op.drop_index("ix_snapshot_jobs_type_status", table_name="snapshot_jobs")
        op.drop_table("snapshot_jobs")

    if "peer_health_states" in existing_tables:
        op.drop_table("peer_health_states")

    if "integration_outbox_deliveries" in existing_tables:
        op.drop_index("ix_outbox_deliveries_event_id", table_name="integration_outbox_deliveries")
        op.drop_index("ix_outbox_deliveries_target_status", table_name="integration_outbox_deliveries")
        op.drop_index("ix_outbox_deliveries_status_next", table_name="integration_outbox_deliveries")
        op.drop_table("integration_outbox_deliveries")
