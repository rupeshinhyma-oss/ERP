"""add_phase2_asset_fields

Revision ID: e8f5b2a91c3d
Revises: c7e4a1f89b2d
Create Date: 2026-10-03 17:45:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision = 'e8f5b2a91c3d'
down_revision = 'c7e4a1f89b2d'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Add Phase 2 fields to hrms_assets and hrms_asset_history."""
    conn = op.get_bind()
    insp = sa.inspect(conn)
    existing_asset_cols = [c["name"] for c in insp.get_columns("hrms_assets")]

    if "vendor" not in existing_asset_cols:
        op.add_column("hrms_assets", sa.Column("vendor", sa.String(length=150), nullable=True))

    if "warranty_expiry" not in existing_asset_cols:
        op.add_column("hrms_assets", sa.Column("warranty_expiry", sa.Date(), nullable=True))

    if "created_by" not in existing_asset_cols:
        op.add_column(
            "hrms_assets",
            sa.Column("created_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
        )

    if "updated_by" not in existing_asset_cols:
        op.add_column(
            "hrms_assets",
            sa.Column("updated_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
        )

    existing_hist_cols = [c["name"] for c in insp.get_columns("hrms_asset_history")]
    if "user_id" not in existing_hist_cols:
        op.add_column(
            "hrms_asset_history",
            sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
        )


def downgrade() -> None:
    """Downgrade Phase 2 columns."""
    conn = op.get_bind()
    insp = sa.inspect(conn)
    existing_hist_cols = [c["name"] for c in insp.get_columns("hrms_asset_history")]
    if "user_id" in existing_hist_cols:
        op.drop_column("hrms_asset_history", "user_id")

    existing_asset_cols = [c["name"] for c in insp.get_columns("hrms_assets")]
    if "updated_by" in existing_asset_cols:
        op.drop_column("hrms_assets", "updated_by")
    if "created_by" in existing_asset_cols:
        op.drop_column("hrms_assets", "created_by")
    if "warranty_expiry" in existing_asset_cols:
        op.drop_column("hrms_assets", "warranty_expiry")
    if "vendor" in existing_asset_cols:
        op.drop_column("hrms_assets", "vendor")
