"""create_hrms_expenses_table

Revision ID: a0b1c2d3e4f5
Revises: f9a0b1c2d3e4
Create Date: 2026-10-05 11:10:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision = 'a0b1c2d3e4f5'
down_revision = 'f9a0b1c2d3e4'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Create persistent table for employee expense claims if not exists."""
    conn = op.get_bind()
    insp = sa.inspect(conn)
    existing_tables = insp.get_table_names()

    if "hrms_expenses" not in existing_tables:
        op.create_table(
            "hrms_expenses",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
            sa.Column("expense_code", sa.String(50), nullable=False, unique=True, index=True),
            sa.Column("employee_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True),
            sa.Column("expense_date", sa.Date(), nullable=False, index=True),
            sa.Column("category", sa.String(100), nullable=False, index=True),
            sa.Column("amount", sa.Float(), nullable=False),
            sa.Column("currency", sa.String(10), server_default="INR", nullable=False),
            sa.Column("description", sa.Text(), nullable=False),
            sa.Column("location_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("hrms_locations.id", ondelete="SET NULL"), nullable=True, index=True),
            sa.Column("receipt_url", sa.String(1000), nullable=True),
            sa.Column("receipt_filename", sa.String(255), nullable=True),
            sa.Column("status", sa.String(50), server_default="DRAFT", nullable=False, index=True),
            sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("reviewed_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("rejection_reason", sa.Text(), nullable=True),
            sa.Column("reimbursed_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("reimbursed_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("reimbursement_notes", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
            sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("version", sa.Integer(), server_default="1", nullable=False),
        )
    else:
        # Table exists; ensure new columns are added if missing
        cols = [c["name"] for c in insp.get_columns("hrms_expenses")]
        if "reimbursed_at" not in cols:
            op.add_column("hrms_expenses", sa.Column("reimbursed_at", sa.DateTime(timezone=True), nullable=True))
        if "reimbursed_by" not in cols:
            op.add_column("hrms_expenses", sa.Column("reimbursed_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True))
        if "reimbursement_notes" not in cols:
            op.add_column("hrms_expenses", sa.Column("reimbursement_notes", sa.Text(), nullable=True))
        if "receipt_filename" not in cols:
            op.add_column("hrms_expenses", sa.Column("receipt_filename", sa.String(255), nullable=True))


def downgrade() -> None:
    conn = op.get_bind()
    insp = sa.inspect(conn)
    existing_tables = insp.get_table_names()
    if "hrms_expenses" in existing_tables:
        op.drop_table("hrms_expenses")
