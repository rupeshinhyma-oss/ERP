"""add_po_and_tally_bill_fields_to_sales_orders

Revision ID: v7a8b9c0d1e2
Revises: u6f7a8b9c0d1
Create Date: 2026-10-28 11:30:00.000000

"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "v7a8b9c0d1e2"
down_revision: Union[str, Sequence[str], None] = "u6f7a8b9c0d1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    if not insp.has_table("sales_orders"):
        return

    cols = {col["name"] for col in insp.get_columns("sales_orders")}

    if "po_file_url" not in cols:
        op.add_column("sales_orders", sa.Column("po_file_url", sa.String(length=500), nullable=True))
    if "po_file_name" not in cols:
        op.add_column("sales_orders", sa.Column("po_file_name", sa.String(length=255), nullable=True))
    if "invoice_no" not in cols:
        op.add_column("sales_orders", sa.Column("invoice_no", sa.String(length=100), nullable=True))
    if "invoice_date" not in cols:
        op.add_column("sales_orders", sa.Column("invoice_date", sa.String(length=50), nullable=True))
    if "tally_bill_url" not in cols:
        op.add_column("sales_orders", sa.Column("tally_bill_url", sa.String(length=500), nullable=True))
    if "tally_bill_name" not in cols:
        op.add_column("sales_orders", sa.Column("tally_bill_name", sa.String(length=255), nullable=True))
    if "eway_bill" not in cols:
        op.add_column(
            "sales_orders",
            sa.Column("eway_bill", sa.String(length=10), server_default="No", nullable=True),
        )


def downgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    if not insp.has_table("sales_orders"):
        return

    cols = {col["name"] for col in insp.get_columns("sales_orders")}
    for col_name in ("eway_bill", "tally_bill_name", "tally_bill_url", "po_file_name", "po_file_url"):
        if col_name in cols:
            op.drop_column("sales_orders", col_name)

