"""add_payments_history_to_discount_payments

Adds ``payments`` JSON column to ``discount_payments`` to store individual
discount adjustment installments (Date, Title/Remarks, Amount, Adjustment By)
for the Discount Adjustment Payment List modal, and widens ``status`` to
String(50) so Sale Order workflow stages (e.g. ``Gatepass Created``, ``LR``,
``Dispatched``, ``Acc. Confirmed``) fit cleanly.

Revision ID: z1e2f3a4b5c6
Revises: y0d1e2f3a4b5
Create Date: 2026-10-28 16:40:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "z1e2f3a4b5c6"
down_revision: Union[str, None] = "y0d1e2f3a4b5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)

    if insp.has_table("discount_payments"):
        cols = {c["name"]: c for c in insp.get_columns("discount_payments")}
        if "payments" not in cols:
            op.add_column("discount_payments", sa.Column("payments", sa.JSON(), nullable=True))
        if "status" in cols and bind.dialect.name == "postgresql":
            op.alter_column(
                "discount_payments",
                "status",
                existing_type=sa.String(30),
                type_=sa.String(50),
                existing_nullable=False,
            )


def downgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)

    if insp.has_table("discount_payments"):
        cols = {c["name"] for c in insp.get_columns("discount_payments")}
        if "payments" in cols:
            op.drop_column("discount_payments", "payments")

