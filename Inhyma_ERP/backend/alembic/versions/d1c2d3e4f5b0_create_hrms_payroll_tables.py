"""create_hrms_payroll_tables

Revision ID: d1c2d3e4f5b0
Revises: b1c2d3e4f5a9
Create Date: 2026-10-05 17:30:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
import uuid


# revision identifiers, used by Alembic.
revision = 'd1c2d3e4f5b0'
down_revision = 'b1c2d3e4f5a9'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Create persistent tables for payroll setup components, employee salaries, monthly payrolls, and adjustments."""
    conn = op.get_bind()
    insp = sa.inspect(conn)
    existing_tables = insp.get_table_names()

    # 1. Global Payroll Components Setup Table
    if "hrms_payroll_components" not in existing_tables:
        op.create_table(
            "hrms_payroll_components",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
            sa.Column("name", sa.String(100), nullable=False),
            sa.Column("code", sa.String(50), nullable=False, unique=True, index=True),
            sa.Column("component_type", sa.String(20), nullable=False, index=True), # EARNING / DEDUCTION
            sa.Column("calculation_type", sa.String(30), nullable=False), # PERCENTAGE_OF_CTC / PERCENTAGE_OF_BASIC / REMAINING_ALLOWANCE / FIXED
            sa.Column("value", sa.Float(), nullable=False, default=0.0),
            sa.Column("is_taxable", sa.Boolean(), default=True, nullable=False),
            sa.Column("is_statutory", sa.Boolean(), default=False, nullable=False),
            sa.Column("display_order", sa.Integer(), default=1, nullable=False),
            sa.Column("is_active", sa.Boolean(), default=True, nullable=False, index=True),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
            sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("version", sa.Integer(), server_default="1", nullable=False),
        )

        # Seed default salary components
        default_components = [
            {
                "id": uuid.uuid4(),
                "name": "Basic Salary",
                "code": "BASIC",
                "component_type": "EARNING",
                "calculation_type": "PERCENTAGE_OF_CTC",
                "value": 50.0,
                "is_taxable": True,
                "is_statutory": False,
                "display_order": 1,
                "is_active": True,
                "description": "50% of Monthly CTC",
            },
            {
                "id": uuid.uuid4(),
                "name": "House Rent Allowance (HRA)",
                "code": "HRA",
                "component_type": "EARNING",
                "calculation_type": "PERCENTAGE_OF_BASIC",
                "value": 40.0,
                "is_taxable": True,
                "is_statutory": False,
                "display_order": 2,
                "description": "40% of Basic Salary",
            },
            {
                "id": uuid.uuid4(),
                "name": "Special Allowance",
                "code": "SPECIAL_ALLOWANCE",
                "component_type": "EARNING",
                "calculation_type": "REMAINING_ALLOWANCE",
                "value": 0.0,
                "is_taxable": True,
                "is_statutory": False,
                "display_order": 3,
                "description": "Balancing allowance to match Monthly CTC",
            },
            {
                "id": uuid.uuid4(),
                "name": "Provident Fund (PF)",
                "code": "PF",
                "component_type": "DEDUCTION",
                "calculation_type": "PERCENTAGE_OF_BASIC",
                "value": 12.0,
                "is_taxable": False,
                "is_statutory": True,
                "display_order": 1,
                "description": "12% of Basic Salary",
            },
            {
                "id": uuid.uuid4(),
                "name": "Professional Tax (PT)",
                "code": "PT",
                "component_type": "DEDUCTION",
                "calculation_type": "FIXED",
                "value": 200.0,
                "is_taxable": False,
                "is_statutory": True,
                "display_order": 2,
                "description": "Fixed ₹200 per month",
            },
        ]
        comp_table = sa.table(
            "hrms_payroll_components",
            sa.column("id", postgresql.UUID),
            sa.column("name", sa.String),
            sa.column("code", sa.String),
            sa.column("component_type", sa.String),
            sa.column("calculation_type", sa.String),
            sa.column("value", sa.Float),
            sa.column("is_taxable", sa.Boolean),
            sa.column("is_statutory", sa.Boolean),
            sa.column("display_order", sa.Integer),
            sa.column("is_active", sa.Boolean),
            sa.column("description", sa.Text),
        )
        op.bulk_insert(comp_table, default_components)

    # 2. Employee Salaries (Structure & Revisions with Effective Dates)
    if "hrms_employee_salaries" not in existing_tables:
        op.create_table(
            "hrms_employee_salaries",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
            sa.Column("employee_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True),
            sa.Column("annual_ctc", sa.Float(), nullable=False),
            sa.Column("monthly_ctc", sa.Float(), nullable=False),
            sa.Column("effective_from", sa.Date(), nullable=False, index=True),
            sa.Column("is_active", sa.Boolean(), default=True, nullable=False, index=True),
            sa.Column("structure_breakdown", sa.JSON(), nullable=True),
            sa.Column("notes", sa.Text(), nullable=True),
            sa.Column("created_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("updated_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
            sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("version", sa.Integer(), server_default="1", nullable=False),
        )

    # 3. Monthly Payroll Cycles Header
    if "hrms_monthly_payrolls" not in existing_tables:
        op.create_table(
            "hrms_monthly_payrolls",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
            sa.Column("payroll_month", sa.String(7), nullable=False, unique=True, index=True), # e.g. "2026-10"
            sa.Column("payroll_year", sa.Integer(), nullable=False, index=True),
            sa.Column("month_number", sa.Integer(), nullable=False, index=True),
            sa.Column("status", sa.String(30), server_default="DRAFT", nullable=False, index=True), # DRAFT / PROCESSED / APPROVED
            sa.Column("total_employees", sa.Integer(), server_default="0", nullable=False),
            sa.Column("total_gross", sa.Float(), server_default="0", nullable=False),
            sa.Column("total_deductions", sa.Float(), server_default="0", nullable=False),
            sa.Column("total_net", sa.Float(), server_default="0", nullable=False),
            sa.Column("working_days", sa.Integer(), server_default="0", nullable=False),
            sa.Column("weekend_days", sa.Integer(), server_default="0", nullable=False),
            sa.Column("holiday_days", sa.Integer(), server_default="0", nullable=False),
            sa.Column("processed_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("processed_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("approved_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("notes", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
            sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("version", sa.Integer(), server_default="1", nullable=False),
        )

    # 4. Monthly Payroll Items (Employee Payslip Snapshot)
    if "hrms_monthly_payroll_items" not in existing_tables:
        op.create_table(
            "hrms_monthly_payroll_items",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
            sa.Column("payroll_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("hrms_monthly_payrolls.id", ondelete="CASCADE"), nullable=False, index=True),
            sa.Column("employee_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True),
            sa.Column("salary_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("hrms_employee_salaries.id", ondelete="SET NULL"), nullable=True),
            sa.Column("annual_ctc", sa.Float(), nullable=False),
            sa.Column("monthly_ctc", sa.Float(), nullable=False),
            sa.Column("working_days", sa.Integer(), nullable=False),
            sa.Column("present_days", sa.Float(), nullable=False),
            sa.Column("paid_leave_days", sa.Float(), nullable=False),
            sa.Column("holiday_days", sa.Integer(), nullable=False),
            sa.Column("weekend_days", sa.Integer(), nullable=False),
            sa.Column("lop_days", sa.Float(), nullable=False),
            sa.Column("earnings_breakdown", sa.JSON(), nullable=True),
            sa.Column("deductions_breakdown", sa.JSON(), nullable=True),
            sa.Column("additions_breakdown", sa.JSON(), nullable=True),
            sa.Column("lop_deduction", sa.Float(), server_default="0", nullable=False),
            sa.Column("gross_amount", sa.Float(), nullable=False),
            sa.Column("total_deductions", sa.Float(), nullable=False),
            sa.Column("net_salary", sa.Float(), nullable=False),
            sa.Column("status", sa.String(30), server_default="DRAFT", nullable=False, index=True), # DRAFT / PROCESSED / APPROVED
            sa.Column("calculation_details", sa.JSON(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
            sa.UniqueConstraint("payroll_id", "employee_id", name="uq_hrms_payroll_item_emp"),
        )

    # 5. Exceptional Monthly Adjustments Table (One-off Bonus / Deductions)
    if "hrms_payroll_adjustments" not in existing_tables:
        op.create_table(
            "hrms_payroll_adjustments",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
            sa.Column("employee_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True),
            sa.Column("payroll_month", sa.String(7), nullable=False, index=True),
            sa.Column("adjustment_type", sa.String(20), nullable=False), # ADDITION / DEDUCTION
            sa.Column("title", sa.String(150), nullable=False),
            sa.Column("amount", sa.Float(), nullable=False),
            sa.Column("reason", sa.Text(), nullable=False),
            sa.Column("created_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        )


def downgrade() -> None:
    """Drop payroll tables in reverse dependency order."""
    op.drop_table("hrms_payroll_adjustments", if_exists=True)
    op.drop_table("hrms_monthly_payroll_items", if_exists=True)
    op.drop_table("hrms_monthly_payrolls", if_exists=True)
    op.drop_table("hrms_employee_salaries", if_exists=True)
    op.drop_table("hrms_payroll_components", if_exists=True)
