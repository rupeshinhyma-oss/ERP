"""create_hrms_location_and_wfh_tables

Creates hrms_locations, hrms_employee_locations, and hrms_wfh_requests tables.

Revision ID: d1a2b3c4d5e6
Revises: c04a837cccaf
Create Date: 2026-09-22 11:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

import app.database.base

# revision identifiers, used by Alembic.
revision: str = "d1a2b3c4d5e6"
down_revision: Union[str, None] = "c04a837cccaf"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Create hrms_locations, hrms_employee_locations, and hrms_wfh_requests."""
    bind = op.get_bind()
    insp = sa.inspect(bind)

    if not insp.has_table("hrms_locations"):
        op.create_table(
            "hrms_locations",
            sa.Column("id", app.database.base.GUID(), nullable=False),
            sa.Column("name", sa.String(length=150), nullable=False),
            sa.Column("location_type", sa.String(length=50), server_default="OFFICE", nullable=False),
            sa.Column("address", sa.Text(), nullable=False),
            sa.Column("latitude", sa.Float(), nullable=False),
            sa.Column("longitude", sa.Float(), nullable=False),
            sa.Column("radius_meters", sa.Float(), server_default="150", nullable=False),
            sa.Column("is_active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
            sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("version", sa.Integer(), server_default="1", nullable=False),
            sa.PrimaryKeyConstraint("id", name=op.f("pk_hrms_locations")),
        )
        op.create_index(op.f("ix_hrms_locations_name"), "hrms_locations", ["name"], unique=False)
        op.create_index(op.f("ix_hrms_locations_location_type"), "hrms_locations", ["location_type"], unique=False)
        op.create_index(op.f("ix_hrms_locations_is_active"), "hrms_locations", ["is_active"], unique=False)

    if not insp.has_table("hrms_employee_locations"):
        op.create_table(
            "hrms_employee_locations",
            sa.Column("id", app.database.base.GUID(), nullable=False),
            sa.Column("user_id", app.database.base.GUID(), nullable=False),
            sa.Column("location_id", app.database.base.GUID(), nullable=False),
            sa.Column("is_primary", sa.Boolean(), server_default=sa.text("false"), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["location_id"], ["hrms_locations.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id", name=op.f("pk_hrms_employee_locations")),
        )
        op.create_index(op.f("ix_hrms_employee_locations_user_id"), "hrms_employee_locations", ["user_id"], unique=False)
        op.create_index(op.f("ix_hrms_employee_locations_location_id"), "hrms_employee_locations", ["location_id"], unique=False)
        op.create_index(op.f("ix_hrms_employee_locations_is_primary"), "hrms_employee_locations", ["is_primary"], unique=False)

    if not insp.has_table("hrms_wfh_requests"):
        op.create_table(
            "hrms_wfh_requests",
            sa.Column("id", app.database.base.GUID(), nullable=False),
            sa.Column("user_id", app.database.base.GUID(), nullable=False),
            sa.Column("wfh_date", sa.Date(), nullable=False),
            sa.Column("reason", sa.Text(), nullable=False),
            sa.Column("address", sa.Text(), nullable=False),
            sa.Column("latitude", sa.Float(), nullable=False),
            sa.Column("longitude", sa.Float(), nullable=False),
            sa.Column("radius_meters", sa.Float(), server_default="150", nullable=False),
            sa.Column("status", sa.String(length=20), server_default="PENDING", nullable=False),
            sa.Column("manager_id", app.database.base.GUID(), nullable=True),
            sa.Column("manager_remarks", sa.Text(), nullable=True),
            sa.Column("submitted_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
            sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["manager_id"], ["users.id"], ondelete="SET NULL"),
            sa.PrimaryKeyConstraint("id", name=op.f("pk_hrms_wfh_requests")),
        )
        op.create_index(op.f("ix_hrms_wfh_requests_user_id"), "hrms_wfh_requests", ["user_id"], unique=False)
        op.create_index(op.f("ix_hrms_wfh_requests_wfh_date"), "hrms_wfh_requests", ["wfh_date"], unique=False)
        op.create_index(op.f("ix_hrms_wfh_requests_status"), "hrms_wfh_requests", ["status"], unique=False)


def downgrade() -> None:
    """Drop hrms_wfh_requests, hrms_employee_locations, and hrms_locations."""
    op.drop_table("hrms_wfh_requests")
    op.drop_table("hrms_employee_locations")
    op.drop_table("hrms_locations")
