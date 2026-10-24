"""allow_nullable_buyer_id_in_sales_orders

Revision ID: b3c4d5e6f7a8
Revises: a2b3c4d5e6f7
Create Date: 2026-10-21 11:30:00.000000

"""
from alembic import op
import sqlalchemy as sa


revision = 'b3c4d5e6f7a8'
down_revision = 'a2b3c4d5e6f7'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE sales_orders ALTER COLUMN buyer_id DROP NOT NULL")


def downgrade() -> None:
    op.execute("ALTER TABLE sales_orders ALTER COLUMN buyer_id SET NOT NULL")
