"""sales orders: add ETD/ETA dates and normalize status to 'confirmed'

Revision ID: e6f7a8b9c0d1
Revises: d5e6f7a8b9c0
Create Date: 2026-10-30 16:15:00.000000

- Adds nullable `etd_origin_date` and `eta_port_date` (DATE) to sales_orders.
- Status workflow simplification: the 'Admin Approved' stage was removed and
  'Sales Confirmed' was renamed to 'Confirmed'. Existing rows with status
  'sales_confirmed' or 'admin_approved' are migrated to 'confirmed' so they
  remain visible under the CONFIRMED tab and stay eligible for dispatch.
"""
from alembic import op
import sqlalchemy as sa


revision = 'e6f7a8b9c0d1'
down_revision = 'd5e6f7a8b9c0'
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    existing_cols = [c["name"] for c in inspector.get_columns("sales_orders")]
    if "etd_origin_date" not in existing_cols:
        op.add_column("sales_orders", sa.Column("etd_origin_date", sa.Date(), nullable=True))
    if "eta_port_date" not in existing_cols:
        op.add_column("sales_orders", sa.Column("eta_port_date", sa.Date(), nullable=True))

    op.execute(
        "UPDATE sales_orders SET status = 'confirmed' "
        "WHERE status IN ('sales_confirmed', 'admin_approved')"
    )


def downgrade() -> None:
    op.execute("UPDATE sales_orders SET status = 'sales_confirmed' WHERE status = 'confirmed'")
    op.drop_column("sales_orders", "eta_port_date")
    op.drop_column("sales_orders", "etd_origin_date")

