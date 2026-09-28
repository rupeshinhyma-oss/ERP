"""create_hrms_setup_tables

Creates hrms_locations, hrms_employee_locations, hrms_leave_types,
hrms_expense_categories, and hrms_expense_settings tables.

Revision ID: e1a2b3c4d5e7
Revises: d1a2b3c4d5e6
Create Date: 2026-09-26 12:45:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import app.database.base

# revision identifiers, used by Alembic.
revision: str = "e1a2b3c4d5e7"
down_revision: Union[str, None] = "d1a2b3c4d5e6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)

    # 1. hrms_locations
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

    # 2. hrms_employee_locations
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

    # 3. hrms_leave_types
    if not insp.has_table("hrms_leave_types"):
        op.create_table(
            "hrms_leave_types",
            sa.Column("id", app.database.base.GUID(), nullable=False),
            sa.Column("name", sa.String(length=100), nullable=False),
            sa.Column("code", sa.String(length=50), nullable=True),
            sa.Column("leave_type", sa.String(length=50), server_default="REGULAR", nullable=False),
            sa.Column("is_paid", sa.Boolean(), server_default=sa.text("true"), nullable=False),
            sa.Column("annual_balance", sa.Float(), server_default="12.0", nullable=False),
            sa.Column("carry_forward_days", sa.Float(), server_default="0.0", nullable=False),
            sa.Column("max_consecutive_days", sa.Integer(), server_default="5", nullable=False),
            sa.Column("monthly_accrual", sa.Boolean(), server_default=sa.text("false"), nullable=False),
            sa.Column("is_active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
            sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("version", sa.Integer(), server_default="1", nullable=False),
            sa.PrimaryKeyConstraint("id", name=op.f("pk_hrms_leave_types")),
        )
        op.create_index(op.f("ix_hrms_leave_types_name"), "hrms_leave_types", ["name"], unique=False)
        op.create_index(op.f("ix_hrms_leave_types_is_active"), "hrms_leave_types", ["is_active"], unique=False)

    # 4. hrms_expense_categories
    if not insp.has_table("hrms_expense_categories"):
        op.create_table(
            "hrms_expense_categories",
            sa.Column("id", app.database.base.GUID(), nullable=False),
            sa.Column("name", sa.String(length=100), nullable=False),
            sa.Column("code", sa.String(length=50), nullable=True),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("is_active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
            sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("version", sa.Integer(), server_default="1", nullable=False),
            sa.PrimaryKeyConstraint("id", name=op.f("pk_hrms_expense_categories")),
        )
        op.create_index(op.f("ix_hrms_expense_categories_name"), "hrms_expense_categories", ["name"], unique=False)
        op.create_index(op.f("ix_hrms_expense_categories_is_active"), "hrms_expense_categories", ["is_active"], unique=False)

    # 5. hrms_expense_settings
    if not insp.has_table("hrms_expense_settings"):
        op.create_table(
            "hrms_expense_settings",
            sa.Column("id", app.database.base.GUID(), nullable=False),
            sa.Column("approval_team_lead", sa.Boolean(), server_default=sa.text("true"), nullable=False),
            sa.Column("approval_manager", sa.Boolean(), server_default=sa.text("true"), nullable=False),
            sa.Column("approval_accounts", sa.Boolean(), server_default=sa.text("true"), nullable=False),
            sa.Column("max_claim_amount", sa.Float(), server_default="50000.0", nullable=False),
            sa.Column("receipt_required", sa.Boolean(), server_default=sa.text("true"), nullable=False),
            sa.Column("auto_approval_limit", sa.Float(), server_default="500.0", nullable=False),
            sa.Column("submission_window_days", sa.Integer(), server_default="30", nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
            sa.PrimaryKeyConstraint("id", name=op.f("pk_hrms_expense_settings")),
        )


def downgrade() -> None:
    op.drop_table("hrms_expense_settings")
    op.drop_table("hrms_expense_categories")
    op.drop_table("hrms_leave_types")
    op.drop_table("hrms_employee_locations")
    op.drop_table("hrms_locations")
