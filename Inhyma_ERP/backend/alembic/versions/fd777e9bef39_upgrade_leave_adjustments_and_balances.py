"""upgrade_leave_adjustments_and_balances

Revision ID: fd777e9bef39
Revises: ff2303e833bb
Create Date: 2026-10-03 13:57:04.911134

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'fd777e9bef39'
down_revision = 'ff2303e833bb'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Apply this migration's schema changes."""
    conn = op.get_bind()
    insp = sa.inspect(conn)

    # 1. hrms_leave_adjustments columns
    adj_cols = [c["name"] for c in insp.get_columns("hrms_leave_adjustments")]
    if "remarks" not in adj_cols:
        op.add_column("hrms_leave_adjustments", sa.Column("remarks", sa.Text(), nullable=True))
    if "source" not in adj_cols:
        op.add_column("hrms_leave_adjustments", sa.Column("source", sa.String(length=50), server_default="MANUAL", nullable=False))
    if "effective_date" not in adj_cols:
        op.add_column("hrms_leave_adjustments", sa.Column("effective_date", sa.Date(), nullable=True))

    # 2. hrms_employee_leave_balances columns
    bal_cols = [c["name"] for c in insp.get_columns("hrms_employee_leave_balances")]
    if "available" not in bal_cols:
        op.add_column("hrms_employee_leave_balances", sa.Column("available", sa.Float(), server_default="0.0", nullable=False))
        # Backfill available = allocated + adjusted - consumed
        op.execute("UPDATE hrms_employee_leave_balances SET available = ROUND((allocated + adjusted - consumed)::numeric, 2)")


def downgrade() -> None:
    """Revert this migration's schema changes."""
    conn = op.get_bind()
    insp = sa.inspect(conn)

    adj_cols = [c["name"] for c in insp.get_columns("hrms_leave_adjustments")]
    if "remarks" in adj_cols:
        op.drop_column("hrms_leave_adjustments", "remarks")
    if "source" in adj_cols:
        op.drop_column("hrms_leave_adjustments", "source")
    if "effective_date" in adj_cols:
        op.drop_column("hrms_leave_adjustments", "effective_date")

    bal_cols = [c["name"] for c in insp.get_columns("hrms_employee_leave_balances")]
    if "available" in bal_cols:
        op.drop_column("hrms_employee_leave_balances", "available")

