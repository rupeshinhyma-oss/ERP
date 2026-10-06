"""add_hrms_assets_and_history

Revision ID: c7e4a1f89b2d
Revises: 22587cfecf8c
Create Date: 2026-10-03 16:30:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision = 'c7e4a1f89b2d'
down_revision = '22587cfecf8c'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Create hrms_assets and hrms_asset_history tables."""
    conn = op.get_bind()
    insp = sa.inspect(conn)
    existing_tables = insp.get_table_names()

    # 1. Create hrms_assets table if not exists
    if "hrms_assets" not in existing_tables:
        op.create_table(
            "hrms_assets",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
            sa.Column("asset_code", sa.String(length=50), nullable=False),
            sa.Column("asset_name", sa.String(length=150), nullable=False),
            sa.Column("asset_category", sa.String(length=100), nullable=False),
            sa.Column("brand", sa.String(length=100), nullable=True),
            sa.Column("model", sa.String(length=100), nullable=True),
            sa.Column("serial_number", sa.String(length=100), nullable=True),
            sa.Column("purchase_date", sa.Date(), nullable=True),
            sa.Column("purchase_cost", sa.Float(), nullable=True),
            sa.Column("status", sa.String(length=50), server_default="AVAILABLE", nullable=False),
            sa.Column("condition", sa.String(length=50), server_default="GOOD", nullable=False),
            sa.Column(
                "location_id",
                postgresql.UUID(as_uuid=True),
                sa.ForeignKey("hrms_locations.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column(
                "assigned_to_user_id",
                postgresql.UUID(as_uuid=True),
                sa.ForeignKey("users.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column("assigned_date", sa.Date(), nullable=True),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("version", sa.Integer(), server_default="1", nullable=False),
            sa.UniqueConstraint("asset_code", name="uq_hrms_assets_asset_code"),
        )
        op.create_index("ix_hrms_assets_asset_code", "hrms_assets", ["asset_code"])
        op.create_index("ix_hrms_assets_asset_name", "hrms_assets", ["asset_name"])
        op.create_index("ix_hrms_assets_asset_category", "hrms_assets", ["asset_category"])
        op.create_index("ix_hrms_assets_serial_number", "hrms_assets", ["serial_number"])
        op.create_index("ix_hrms_assets_status", "hrms_assets", ["status"])
        op.create_index("ix_hrms_assets_location_id", "hrms_assets", ["location_id"])
        op.create_index("ix_hrms_assets_assigned_to_user_id", "hrms_assets", ["assigned_to_user_id"])
        op.create_index("ix_hrms_assets_deleted_at", "hrms_assets", ["deleted_at"])

    # 2. Create hrms_asset_history table if not exists
    if "hrms_asset_history" not in existing_tables:
        op.create_table(
            "hrms_asset_history",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
            sa.Column(
                "asset_id",
                postgresql.UUID(as_uuid=True),
                sa.ForeignKey("hrms_assets.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("action", sa.String(length=50), nullable=False),
            sa.Column("previous_value", sa.Text(), nullable=True),
            sa.Column("new_value", sa.Text(), nullable=True),
            sa.Column(
                "performed_by",
                postgresql.UUID(as_uuid=True),
                sa.ForeignKey("users.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column("notes", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        )
        op.create_index("ix_hrms_asset_history_asset_id", "hrms_asset_history", ["asset_id"])
        op.create_index("ix_hrms_asset_history_action", "hrms_asset_history", ["action"])
        op.create_index("ix_hrms_asset_history_performed_by", "hrms_asset_history", ["performed_by"])


def downgrade() -> None:
    """Drop hrms_asset_history and hrms_assets tables."""
    conn = op.get_bind()
    insp = sa.inspect(conn)
    existing_tables = insp.get_table_names()

    if "hrms_asset_history" in existing_tables:
        op.drop_table("hrms_asset_history")
    if "hrms_assets" in existing_tables:
        op.drop_table("hrms_assets")
