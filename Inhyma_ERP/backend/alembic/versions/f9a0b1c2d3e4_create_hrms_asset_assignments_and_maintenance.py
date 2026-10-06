"""create_hrms_asset_assignments_and_maintenance

Revision ID: f9a0b1c2d3e4
Revises: e8f5b2a91c3d
Create Date: 2026-10-03 18:10:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision = 'f9a0b1c2d3e4'
down_revision = 'e8f5b2a91c3d'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Create persistent tables for asset assignments and asset maintenance."""
    conn = op.get_bind()
    insp = sa.inspect(conn)
    existing_tables = insp.get_table_names()

    # 1. hrms_asset_assignments
    if "hrms_asset_assignments" not in existing_tables:
        op.create_table(
            "hrms_asset_assignments",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
            sa.Column(
                "asset_id",
                postgresql.UUID(as_uuid=True),
                sa.ForeignKey("hrms_assets.id", ondelete="CASCADE"),
                nullable=False,
                index=True,
            ),
            sa.Column(
                "employee_id",
                postgresql.UUID(as_uuid=True),
                sa.ForeignKey("users.id", ondelete="CASCADE"),
                nullable=False,
                index=True,
            ),
            sa.Column("assigned_at", sa.Date(), nullable=False, index=True),
            sa.Column("returned_at", sa.Date(), nullable=True, index=True),
            sa.Column("expected_return_date", sa.Date(), nullable=True),
            sa.Column("assignment_status", sa.String(length=50), nullable=False, server_default="ACTIVE", index=True),
            sa.Column("condition_at_assignment", sa.String(length=50), nullable=True),
            sa.Column("condition_at_return", sa.String(length=50), nullable=True),
            sa.Column("assignment_notes", sa.Text(), nullable=True),
            sa.Column("return_notes", sa.Text(), nullable=True),
            sa.Column(
                "assigned_by",
                postgresql.UUID(as_uuid=True),
                sa.ForeignKey("users.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column(
                "returned_by",
                postgresql.UUID(as_uuid=True),
                sa.ForeignKey("users.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        )

        # Enforce ONE active assignment per asset at the database level
        op.create_index(
            "uq_hrms_asset_active_assignment",
            "hrms_asset_assignments",
            ["asset_id"],
            unique=True,
            postgresql_where=sa.text("assignment_status = 'ACTIVE'"),
        )

    # 2. hrms_asset_maintenance
    if "hrms_asset_maintenance" not in existing_tables:
        op.create_table(
            "hrms_asset_maintenance",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
            sa.Column(
                "asset_id",
                postgresql.UUID(as_uuid=True),
                sa.ForeignKey("hrms_assets.id", ondelete="CASCADE"),
                nullable=False,
                index=True,
            ),
            sa.Column("issue", sa.String(length=255), nullable=False),
            sa.Column("reported_date", sa.Date(), nullable=False, index=True),
            sa.Column("maintenance_start", sa.Date(), nullable=True),
            sa.Column("maintenance_end", sa.Date(), nullable=True),
            sa.Column("vendor_technician", sa.String(length=150), nullable=True),
            sa.Column("cost", sa.Float(), nullable=True),
            sa.Column("status", sa.String(length=50), nullable=False, server_default="OPEN", index=True),
            sa.Column("notes", sa.Text(), nullable=True),
            sa.Column(
                "created_by",
                postgresql.UUID(as_uuid=True),
                sa.ForeignKey("users.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column(
                "updated_by",
                postgresql.UUID(as_uuid=True),
                sa.ForeignKey("users.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        )


def downgrade() -> None:
    """Drop asset assignments and maintenance tables."""
    conn = op.get_bind()
    insp = sa.inspect(conn)
    existing_tables = insp.get_table_names()

    if "hrms_asset_maintenance" in existing_tables:
        op.drop_table("hrms_asset_maintenance")

    if "hrms_asset_assignments" in existing_tables:
        op.drop_index("uq_hrms_asset_active_assignment", table_name="hrms_asset_assignments")
        op.drop_table("hrms_asset_assignments")
