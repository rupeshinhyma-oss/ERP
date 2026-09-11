"""phase6 synced buyer sources (local idempotency for buyer.created cross-ERP sync)

Revision ID: d4e5f6a7b8c2
Revises: c3d4e5f6a7b1
Create Date: 2026-09-10

Phase 6: adds synced_buyer_sources, tracking which local Buyer row a
given (source_erp_id, source_buyer_id) has already been synchronized
into. Prevents a scenario ProcessedIntegrationEvent alone cannot catch:
a dead-letter replay (a new event_id for the same logical source
buyer) resolving to the same local row rather than a duplicate.
Purely additive.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "d4e5f6a7b8c2"
down_revision: Union[str, None] = "c3d4e5f6a7b1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "synced_buyer_sources",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("source_erp_id", sa.String(100), nullable=False),
        sa.Column("source_buyer_id", sa.String(100), nullable=False),
        sa.Column("local_buyer_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.UniqueConstraint("source_erp_id", "source_buyer_id", name="uq_synced_buyer_source"),
    )
    op.create_index("ix_synced_buyer_sources_local_buyer_id", "synced_buyer_sources", ["local_buyer_id"])


def downgrade() -> None:
    op.drop_index("ix_synced_buyer_sources_local_buyer_id", table_name="synced_buyer_sources")
    op.drop_table("synced_buyer_sources")
