"""phase6 processed integration events (consumer idempotency)

Revision ID: b2c3d4e5f6a9
Revises: a1b2c3d4e5f9
Create Date: 2026-09-08

Phase 6: adds the consumer-side idempotency table
(`processed_integration_events`) so a repeated delivery of the same
integration event (at-least-once delivery, Section 16) is never
reprocessed. Purely additive.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "b2c3d4e5f6a9"
down_revision: Union[str, None] = "a1b2c3d4e5f9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "processed_integration_events",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("event_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("consumer_id", sa.String(100), nullable=False),
        sa.Column("event_type", sa.String(150), nullable=False),
        sa.Column("processed_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("event_id", "consumer_id", name="uq_processed_integration_event"),
    )
    op.create_index("ix_processed_integration_events_event_id", "processed_integration_events", ["event_id"])


def downgrade() -> None:
    op.drop_index("ix_processed_integration_events_event_id", table_name="processed_integration_events")
    op.drop_table("processed_integration_events")
