"""add item_width_px to planning_sheets

Revision ID: d5e6f7a8b9c0
Revises: c4d5e6f7a8b9
Create Date: 2026-10-21 17:15:00.000000

Adds a server-persisted column width (in pixels) to planning_sheets for the
built-in first (ITEM) column, matching PlanningColumn.width_px so that dragging
to resize the ITEM column is shared across every user viewing that sheet.

NULL means "not manually resized yet" -- falls back to default 240px.
"""
from alembic import op
import sqlalchemy as sa


revision = 'd5e6f7a8b9c0'
down_revision = 'c4d5e6f7a8b9'
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    existing_cols = [c["name"] for c in inspector.get_columns("planning_sheets")]
    if "item_width_px" not in existing_cols:
        op.add_column("planning_sheets", sa.Column("item_width_px", sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column("planning_sheets", "item_width_px")
