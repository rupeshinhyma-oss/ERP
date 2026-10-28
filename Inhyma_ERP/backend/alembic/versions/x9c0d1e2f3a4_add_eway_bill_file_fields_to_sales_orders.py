"""add_eway_bill_file_fields_to_sales_orders

Adds ``eway_bill_url`` and ``eway_bill_name`` columns to ``sales_orders`` to support
mandatory E-Way Bill document attachment when ``E-Way Bill`` is set to ``Yes`` during
the ``Admin Approved`` -> ``Acc. Confirmed`` workflow transition.

Revision ID: x9c0d1e2f3a4
Revises: w8b9c0d1e2f3
Create Date: 2026-10-28 15:44:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "x9c0d1e2f3a4"
down_revision: Union[str, None] = "w8b9c0d1e2f3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)

    if insp.has_table("sales_orders"):
        cols = {c["name"] for c in insp.get_columns("sales_orders")}
        if "eway_bill_url" not in cols:
            op.add_column("sales_orders", sa.Column("eway_bill_url", sa.String(length=500), nullable=True))
        if "eway_bill_name" not in cols:
            op.add_column("sales_orders", sa.Column("eway_bill_name", sa.String(length=255), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)

    if insp.has_table("sales_orders"):
        cols = {c["name"] for c in insp.get_columns("sales_orders")}
        for col_name in ("eway_bill_name", "eway_bill_url"):
            if col_name in cols:
                op.drop_column("sales_orders", col_name)

