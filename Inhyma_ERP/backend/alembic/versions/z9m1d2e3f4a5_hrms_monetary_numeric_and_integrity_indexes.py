"""hrms_monetary_numeric_and_integrity_indexes

Revision ID: z9m1d2e3f4a5
Revises: z9l0c1d2e3f4
Create Date: 2026-11-20 15:00:00.000000

Wave 3 HRMS P2/P3 Schema Hardening:
1. HRMS-BUG-28 (Monetary Precision):
   Convert all 18 HRMS monetary columns from IEEE-754 DOUBLE PRECISION to exact
   NUMERIC(14, 2) using ROUND(col::numeric, 2), safely dropping and restoring
   typed PostgreSQL server defaults on both upgrade and downgrade.
2. Concurrency Integrity (Section 5 Partial Unique Indexes):
   - uq_hrms_tracking_sessions_active_employee: at most one ACTIVE live tracking
     session per employee (complements Wave 2 pg_advisory_xact_lock).
   - uq_hrms_geofence_violations_open_employee: at most one open geofence
     violation (status IN ('ACTIVE_EXIT', 'EXPIRED') AND return_time IS NULL)
     per employee (complements Wave 2 pg_advisory_xact_lock).
3. W3-13 / HRMS-BUG-34 (Reversible Deprecation Notice):
   Mark unused legacy table ``hrms_wfh_requests`` as DEPRECATED via PostgreSQL
   COMMENT ON TABLE (staged reversible deprecation; never drops blindly).
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "z9m1d2e3f4a5"
down_revision: Union[str, Sequence[str], None] = "z9l0c1d2e3f4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# (table_name, column_name, nullable, numeric_default_sql, float_default_sql)
MONETARY_COLUMNS: list[tuple[str, str, bool, str | None, str | None]] = [
    ("hrms_expense_settings", "max_claim_amount", False, "50000.00", "'50000'::double precision"),
    ("hrms_expense_settings", "auto_approval_limit", False, "500.00", "'500'::double precision"),
    ("hrms_assets", "purchase_cost", True, None, None),
    ("hrms_asset_maintenance", "cost", True, None, None),
    ("hrms_expenses", "amount", False, None, None),
    ("hrms_payroll_components", "value", False, None, None),
    ("hrms_employee_salaries", "annual_ctc", False, None, None),
    ("hrms_employee_salaries", "monthly_ctc", False, None, None),
    ("hrms_monthly_payrolls", "total_gross", False, "0.00", "'0'::double precision"),
    ("hrms_monthly_payrolls", "total_deductions", False, "0.00", "'0'::double precision"),
    ("hrms_monthly_payrolls", "total_net", False, "0.00", "'0'::double precision"),
    ("hrms_monthly_payroll_items", "annual_ctc", False, None, None),
    ("hrms_monthly_payroll_items", "monthly_ctc", False, None, None),
    ("hrms_monthly_payroll_items", "lop_deduction", False, "0.00", "'0'::double precision"),
    ("hrms_monthly_payroll_items", "gross_amount", False, None, None),
    ("hrms_monthly_payroll_items", "total_deductions", False, None, None),
    ("hrms_monthly_payroll_items", "net_salary", False, None, None),
    ("hrms_payroll_adjustments", "amount", False, None, None),
]

WFH_DEPRECATION_COMMENT = (
    "DEPRECATED (HRMS-BUG-34 / Wave 3): Legacy unused table with zero ORM, "
    "backend, frontend, or FK references. Verify zero rows in production backup "
    "before scheduling a controlled DROP TABLE migration."
)


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    dialect = bind.dialect.name

    # 1. HRMS-BUG-28: Convert monetary columns DOUBLE PRECISION -> NUMERIC(14, 2)
    for table_name, col_name, nullable, num_default, _float_default in MONETARY_COLUMNS:
        if not insp.has_table(table_name):
            continue
        existing_cols = {c["name"] for c in insp.get_columns(table_name)}
        if col_name not in existing_cols:
            continue

        if dialect == "postgresql":
            if num_default is not None:
                op.alter_column(
                    table_name,
                    col_name,
                    existing_type=sa.Float(),
                    existing_nullable=nullable,
                    server_default=None,
                )
            op.alter_column(
                table_name,
                col_name,
                existing_type=sa.Float(),
                type_=sa.Numeric(14, 2),
                existing_nullable=nullable,
                postgresql_using=f'ROUND(("{col_name}")::numeric, 2)',
            )
            if num_default is not None:
                op.alter_column(
                    table_name,
                    col_name,
                    existing_type=sa.Numeric(14, 2),
                    existing_nullable=nullable,
                    server_default=sa.text(num_default),
                )
        else:
            with op.batch_alter_table(table_name) as batch_op:
                batch_op.alter_column(
                    col_name,
                    existing_type=sa.Float(),
                    type_=sa.Numeric(14, 2),
                    existing_nullable=nullable,
                    server_default=sa.text(num_default) if num_default is not None else None,
                )

    # 2. Section 5: Partial unique index on active live tracking sessions per employee
    if insp.has_table("hrms_tracking_sessions"):
        if dialect == "postgresql":
            # Non-destructively close any historical duplicate ACTIVE sessions (keep newest)
            bind.execute(
                sa.text(
                    """
                    WITH ranked AS (
                        SELECT
                            id,
                            ROW_NUMBER() OVER (
                                PARTITION BY employee_id
                                ORDER BY start_time DESC, created_at DESC, id DESC
                            ) AS rn
                        FROM hrms_tracking_sessions
                        WHERE status = 'ACTIVE'
                    )
                    UPDATE hrms_tracking_sessions s
                    SET status = 'COMPLETED',
                        end_time = COALESCE(s.end_time, s.updated_at, s.start_time)
                    FROM ranked r
                    WHERE s.id = r.id
                      AND r.rn > 1
                    """
                )
            )
            bind.execute(
                sa.text(
                    """
                    CREATE UNIQUE INDEX IF NOT EXISTS uq_hrms_tracking_sessions_active_employee
                    ON hrms_tracking_sessions (employee_id)
                    WHERE status = 'ACTIVE'
                    """
                )
            )
        else:
            existing_idx = {i["name"] for i in insp.get_indexes("hrms_tracking_sessions") if i.get("name")}
            if "uq_hrms_tracking_sessions_active_employee" not in existing_idx:
                op.create_index(
                    "uq_hrms_tracking_sessions_active_employee",
                    "hrms_tracking_sessions",
                    ["employee_id"],
                    unique=True,
                    sqlite_where=sa.text("status = 'ACTIVE'"),
                )

    # 3. Section 5: Partial unique index on open geofence violations per employee
    if insp.has_table("hrms_geofence_violations"):
        if dialect == "postgresql":
            # Non-destructively close any historical duplicate open violations (keep newest)
            bind.execute(
                sa.text(
                    """
                    WITH ranked AS (
                        SELECT
                            id,
                            ROW_NUMBER() OVER (
                                PARTITION BY employee_id
                                ORDER BY exit_time DESC, created_at DESC, id DESC
                            ) AS rn
                        FROM hrms_geofence_violations
                        WHERE status IN ('ACTIVE_EXIT', 'EXPIRED')
                          AND return_time IS NULL
                    )
                    UPDATE hrms_geofence_violations v
                    SET return_time = COALESCE(v.updated_at, v.exit_time),
                        status = CASE WHEN v.status = 'ACTIVE_EXIT' THEN 'RESOLVED_RETURNED' ELSE v.status END
                    FROM ranked r
                    WHERE v.id = r.id
                      AND r.rn > 1
                    """
                )
            )
            bind.execute(
                sa.text(
                    """
                    CREATE UNIQUE INDEX IF NOT EXISTS uq_hrms_geofence_violations_open_employee
                    ON hrms_geofence_violations (employee_id)
                    WHERE status IN ('ACTIVE_EXIT', 'EXPIRED') AND return_time IS NULL
                    """
                )
            )
        else:
            existing_idx = {i["name"] for i in insp.get_indexes("hrms_geofence_violations") if i.get("name")}
            if "uq_hrms_geofence_violations_open_employee" not in existing_idx:
                op.create_index(
                    "uq_hrms_geofence_violations_open_employee",
                    "hrms_geofence_violations",
                    ["employee_id"],
                    unique=True,
                    sqlite_where=sa.text("status IN ('ACTIVE_EXIT', 'EXPIRED') AND return_time IS NULL"),
                )

    # 4. W3-13 / HRMS-BUG-34: Reversible PostgreSQL table deprecation comment
    if dialect == "postgresql" and insp.has_table("hrms_wfh_requests"):
        escaped = WFH_DEPRECATION_COMMENT.replace("'", "''")
        bind.execute(sa.text(f"COMMENT ON TABLE hrms_wfh_requests IS '{escaped}'"))


def downgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    dialect = bind.dialect.name

    # 4. Remove WFH deprecation comment
    if dialect == "postgresql" and insp.has_table("hrms_wfh_requests"):
        bind.execute(sa.text("COMMENT ON TABLE hrms_wfh_requests IS NULL"))

    # 3. Drop open geofence violations partial unique index
    if insp.has_table("hrms_geofence_violations"):
        if dialect == "postgresql":
            bind.execute(sa.text("DROP INDEX IF EXISTS uq_hrms_geofence_violations_open_employee"))
        else:
            existing_idx = {i["name"] for i in insp.get_indexes("hrms_geofence_violations") if i.get("name")}
            if "uq_hrms_geofence_violations_open_employee" in existing_idx:
                op.drop_index("uq_hrms_geofence_violations_open_employee", table_name="hrms_geofence_violations")

    # 2. Drop active tracking sessions partial unique index
    if insp.has_table("hrms_tracking_sessions"):
        if dialect == "postgresql":
            bind.execute(sa.text("DROP INDEX IF EXISTS uq_hrms_tracking_sessions_active_employee"))
        else:
            existing_idx = {i["name"] for i in insp.get_indexes("hrms_tracking_sessions") if i.get("name")}
            if "uq_hrms_tracking_sessions_active_employee" in existing_idx:
                op.drop_index("uq_hrms_tracking_sessions_active_employee", table_name="hrms_tracking_sessions")

    # 1. Revert monetary columns NUMERIC(14, 2) -> DOUBLE PRECISION
    for table_name, col_name, nullable, _num_default, float_default in reversed(MONETARY_COLUMNS):
        if not insp.has_table(table_name):
            continue
        existing_cols = {c["name"] for c in insp.get_columns(table_name)}
        if col_name not in existing_cols:
            continue

        if dialect == "postgresql":
            if float_default is not None:
                op.alter_column(
                    table_name,
                    col_name,
                    existing_type=sa.Numeric(14, 2),
                    existing_nullable=nullable,
                    server_default=None,
                )
            op.alter_column(
                table_name,
                col_name,
                existing_type=sa.Numeric(14, 2),
                type_=sa.Float(),
                existing_nullable=nullable,
                postgresql_using=f'("{col_name}")::double precision',
            )
            if float_default is not None:
                op.alter_column(
                    table_name,
                    col_name,
                    existing_type=sa.Float(),
                    existing_nullable=nullable,
                    server_default=sa.text(float_default),
                )
        else:
            with op.batch_alter_table(table_name) as batch_op:
                batch_op.alter_column(
                    col_name,
                    existing_type=sa.Numeric(14, 2),
                    type_=sa.Float(),
                    existing_nullable=nullable,
                    server_default=sa.text(float_default) if float_default is not None else None,
                )
