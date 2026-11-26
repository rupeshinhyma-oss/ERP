"""Drop redundant ix_lead_sources_name unique index (uq_lead_sources_name already enforces unique btree index on name).

Revision ID: z9o3f4a5b6c7
Revises: z9n2e3f4a5b6
Create Date: 2026-11-21
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "z9o3f4a5b6c7"
down_revision = "z9n2e3f4a5b6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    # Confirm the canonical unique constraint uq_lead_sources_name exists before dropping redundant index
    unique_constraints = {uc.get("name") for uc in inspector.get_unique_constraints("lead_sources")}
    existing_indexes = {idx.get("name") for idx in inspector.get_indexes("lead_sources")}

    if "uq_lead_sources_name" not in unique_constraints:
        op.create_unique_constraint("uq_lead_sources_name", "lead_sources", ["name"])

    if "ix_lead_sources_name" in existing_indexes:
        op.drop_index("ix_lead_sources_name", table_name="lead_sources")


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_indexes = {idx.get("name") for idx in inspector.get_indexes("lead_sources")}

    if "ix_lead_sources_name" not in existing_indexes:
        op.create_index("ix_lead_sources_name", "lead_sources", ["name"], unique=True)
