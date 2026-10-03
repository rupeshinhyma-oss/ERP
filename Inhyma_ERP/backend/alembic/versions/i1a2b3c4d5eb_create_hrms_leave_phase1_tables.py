"""create_hrms_leave_phase1_tables

Creates hrms_leave_plans, hrms_leave_plan_types, hrms_holidays,
hrms_employee_leave_balances, hrms_leave_adjustments, and hrms_leave_requests tables.
Adds carry_forward_allowed column to hrms_leave_types if missing.

Revision ID: i1a2b3c4d5eb
Revises: h1a2b3c4d5ea
Create Date: 2026-10-01 17:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import app.database.base

# revision identifiers, used by Alembic.
revision: str = "i1a2b3c4d5eb"
down_revision: Union[str, None] = "h1a2b3c4d5ea"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)

    # 1. Update hrms_leave_types with carry_forward_allowed
    if insp.has_table("hrms_leave_types"):
        cols = {c["name"] for c in insp.get_columns("hrms_leave_types")}
        if "carry_forward_allowed" not in cols:
            op.add_column(
                "hrms_leave_types",
                sa.Column("carry_forward_allowed", sa.Boolean(), server_default=sa.text("false"), nullable=False),
            )

    # 2. hrms_leave_plans
    if not insp.has_table("hrms_leave_plans"):
        op.create_table(
            "hrms_leave_plans",
            sa.Column("id", app.database.base.GUID(), nullable=False),
            sa.Column("name", sa.String(length=150), nullable=False),
            sa.Column("effective_from", sa.Date(), nullable=False),
            sa.Column("effective_to", sa.Date(), nullable=False),
            sa.Column("branch", sa.String(length=100), server_default="All Branches", nullable=False),
            sa.Column("department", sa.String(length=100), server_default="All Departments", nullable=False),
            sa.Column("is_active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
            sa.Column("created_by", app.database.base.GUID(), nullable=True),
            sa.Column("updated_by", app.database.base.GUID(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
            sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("version", sa.Integer(), server_default="1", nullable=False),
            sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(["updated_by"], ["users.id"], ondelete="SET NULL"),
            sa.PrimaryKeyConstraint("id", name=op.f("pk_hrms_leave_plans")),
        )
        op.create_index(op.f("ix_hrms_leave_plans_name"), "hrms_leave_plans", ["name"], unique=False)
        op.create_index(op.f("ix_hrms_leave_plans_is_active"), "hrms_leave_plans", ["is_active"], unique=False)

    # 3. hrms_leave_plan_types
    if not insp.has_table("hrms_leave_plan_types"):
        op.create_table(
            "hrms_leave_plan_types",
            sa.Column("id", app.database.base.GUID(), nullable=False),
            sa.Column("plan_id", app.database.base.GUID(), nullable=False),
            sa.Column("leave_type_id", app.database.base.GUID(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
            sa.ForeignKeyConstraint(["plan_id"], ["hrms_leave_plans.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["leave_type_id"], ["hrms_leave_types.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id", name=op.f("pk_hrms_leave_plan_types")),
            sa.UniqueConstraint("plan_id", "leave_type_id", name="uq_hrms_leave_plan_types_plan_leave"),
        )
        op.create_index(op.f("ix_hrms_leave_plan_types_plan_id"), "hrms_leave_plan_types", ["plan_id"], unique=False)
        op.create_index(op.f("ix_hrms_leave_plan_types_leave_type_id"), "hrms_leave_plan_types", ["leave_type_id"], unique=False)

    # 4. hrms_holidays
    if not insp.has_table("hrms_holidays"):
        op.create_table(
            "hrms_holidays",
            sa.Column("id", app.database.base.GUID(), nullable=False),
            sa.Column("name", sa.String(length=150), nullable=False),
            sa.Column("holiday_date", sa.Date(), nullable=False),
            sa.Column("number_of_days", sa.Integer(), server_default="1", nullable=False),
            sa.Column("branch_applicability", sa.String(length=255), server_default="All Branches", nullable=False),
            sa.Column("is_active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
            sa.Column("created_by", app.database.base.GUID(), nullable=True),
            sa.Column("updated_by", app.database.base.GUID(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
            sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("version", sa.Integer(), server_default="1", nullable=False),
            sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(["updated_by"], ["users.id"], ondelete="SET NULL"),
            sa.PrimaryKeyConstraint("id", name=op.f("pk_hrms_holidays")),
        )
        op.create_index(op.f("ix_hrms_holidays_name"), "hrms_holidays", ["name"], unique=False)
        op.create_index(op.f("ix_hrms_holidays_holiday_date"), "hrms_holidays", ["holiday_date"], unique=False)
        op.create_index(op.f("ix_hrms_holidays_is_active"), "hrms_holidays", ["is_active"], unique=False)

    # 5. hrms_employee_leave_balances
    if not insp.has_table("hrms_employee_leave_balances"):
        op.create_table(
            "hrms_employee_leave_balances",
            sa.Column("id", app.database.base.GUID(), nullable=False),
            sa.Column("employee_id", app.database.base.GUID(), nullable=False),
            sa.Column("leave_type_id", app.database.base.GUID(), nullable=False),
            sa.Column("year", sa.Integer(), server_default="2026", nullable=False),
            sa.Column("allocated", sa.Float(), server_default="0.0", nullable=False),
            sa.Column("consumed", sa.Float(), server_default="0.0", nullable=False),
            sa.Column("adjusted", sa.Float(), server_default="0.0", nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
            sa.ForeignKeyConstraint(["employee_id"], ["users.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["leave_type_id"], ["hrms_leave_types.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id", name=op.f("pk_hrms_employee_leave_balances")),
            sa.UniqueConstraint("employee_id", "leave_type_id", "year", name="uq_hrms_emp_leave_balance_year"),
        )
        op.create_index(op.f("ix_hrms_employee_leave_balances_employee_id"), "hrms_employee_leave_balances", ["employee_id"], unique=False)
        op.create_index(op.f("ix_hrms_employee_leave_balances_leave_type_id"), "hrms_employee_leave_balances", ["leave_type_id"], unique=False)
        op.create_index(op.f("ix_hrms_employee_leave_balances_year"), "hrms_employee_leave_balances", ["year"], unique=False)

    # 6. hrms_leave_adjustments
    if not insp.has_table("hrms_leave_adjustments"):
        op.create_table(
            "hrms_leave_adjustments",
            sa.Column("id", app.database.base.GUID(), nullable=False),
            sa.Column("employee_id", app.database.base.GUID(), nullable=False),
            sa.Column("leave_type_id", app.database.base.GUID(), nullable=False),
            sa.Column("adjustment_type", sa.String(length=20), nullable=False),
            sa.Column("amount", sa.Float(), nullable=False),
            sa.Column("previous_balance", sa.Float(), nullable=False),
            sa.Column("new_balance", sa.Float(), nullable=False),
            sa.Column("reason", sa.Text(), nullable=False),
            sa.Column("adjusted_by", app.database.base.GUID(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
            sa.ForeignKeyConstraint(["employee_id"], ["users.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["leave_type_id"], ["hrms_leave_types.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["adjusted_by"], ["users.id"], ondelete="SET NULL"),
            sa.PrimaryKeyConstraint("id", name=op.f("pk_hrms_leave_adjustments")),
        )
        op.create_index(op.f("ix_hrms_leave_adjustments_employee_id"), "hrms_leave_adjustments", ["employee_id"], unique=False)
        op.create_index(op.f("ix_hrms_leave_adjustments_leave_type_id"), "hrms_leave_adjustments", ["leave_type_id"], unique=False)

    # 7. hrms_leave_requests
    if not insp.has_table("hrms_leave_requests"):
        op.create_table(
            "hrms_leave_requests",
            sa.Column("id", app.database.base.GUID(), nullable=False),
            sa.Column("employee_id", app.database.base.GUID(), nullable=False),
            sa.Column("leave_type_id", app.database.base.GUID(), nullable=False),
            sa.Column("from_date", sa.Date(), nullable=False),
            sa.Column("to_date", sa.Date(), nullable=False),
            sa.Column("number_of_days", sa.Float(), nullable=False),
            sa.Column("reason", sa.Text(), nullable=False),
            sa.Column("attachment", sa.String(length=500), nullable=True),
            sa.Column("status", sa.String(length=50), server_default="PENDING", nullable=False),
            sa.Column("approval_status", sa.String(length=50), server_default="PENDING", nullable=False),
            sa.Column("created_by", app.database.base.GUID(), nullable=True),
            sa.Column("updated_by", app.database.base.GUID(), nullable=True),
            sa.Column("approved_by", app.database.base.GUID(), nullable=True),
            sa.Column("approval_remarks", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
            sa.ForeignKeyConstraint(["employee_id"], ["users.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["leave_type_id"], ["hrms_leave_types.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(["updated_by"], ["users.id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(["approved_by"], ["users.id"], ondelete="SET NULL"),
            sa.PrimaryKeyConstraint("id", name=op.f("pk_hrms_leave_requests")),
        )
        op.create_index(op.f("ix_hrms_leave_requests_employee_id"), "hrms_leave_requests", ["employee_id"], unique=False)
        op.create_index(op.f("ix_hrms_leave_requests_leave_type_id"), "hrms_leave_requests", ["leave_type_id"], unique=False)
        op.create_index(op.f("ix_hrms_leave_requests_from_date"), "hrms_leave_requests", ["from_date"], unique=False)
        op.create_index(op.f("ix_hrms_leave_requests_to_date"), "hrms_leave_requests", ["to_date"], unique=False)
        op.create_index(op.f("ix_hrms_leave_requests_status"), "hrms_leave_requests", ["status"], unique=False)
        op.create_index(op.f("ix_hrms_leave_requests_approval_status"), "hrms_leave_requests", ["approval_status"], unique=False)


def downgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)

    if insp.has_table("hrms_leave_requests"):
        op.drop_table("hrms_leave_requests")
    if insp.has_table("hrms_leave_adjustments"):
        op.drop_table("hrms_leave_adjustments")
    if insp.has_table("hrms_employee_leave_balances"):
        op.drop_table("hrms_employee_leave_balances")
    if insp.has_table("hrms_holidays"):
        op.drop_table("hrms_holidays")
    if insp.has_table("hrms_leave_plan_types"):
        op.drop_table("hrms_leave_plan_types")
    if insp.has_table("hrms_leave_plans"):
        op.drop_table("hrms_leave_plans")
    if insp.has_table("hrms_leave_types"):
        cols = {c["name"] for c in insp.get_columns("hrms_leave_types")}
        if "carry_forward_allowed" in cols:
            op.drop_column("hrms_leave_types", "carry_forward_allowed")
