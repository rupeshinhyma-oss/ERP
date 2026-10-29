"""add_timeline_to_sales_orders

Adds ``timeline`` JSON column to ``sales_orders`` to persist full chronological
Sale Order Timeline events (Pending -> Sales Confirmed -> Admin Approval ->
Account Confirmed -> Gatepass Created -> Dispatched -> LR Mandatory, plus
Gatepass Cancelled / Cancelled) with timestamps, actor names, remarks, and
stage attachments (Invoice No, Invoice Date, E-Way Bill, Tally Bill).

Revision ID: y0d1e2f3a4b5
Revises: x9c0d1e2f3a4
Create Date: 2026-10-28 16:05:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "y0d1e2f3a4b5"
down_revision: Union[str, None] = "x9c0d1e2f3a4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)

    if insp.has_table("sales_orders"):
        cols = {c["name"] for c in insp.get_columns("sales_orders")}
        if "timeline" not in cols:
            op.add_column("sales_orders", sa.Column("timeline", sa.JSON(), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)

    if insp.has_table("sales_orders"):
        cols = {c["name"] for c in insp.get_columns("sales_orders")}
        if "timeline" in cols:
            op.drop_column("sales_orders", "timeline")

