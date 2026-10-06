"""cleanup_duplicate_test_leave_types_and_balances

Revision ID: 22587cfecf8c
Revises: fd777e9bef39
Create Date: 2026-10-03 15:15:26.856251

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '22587cfecf8c'
down_revision = 'fd777e9bef39'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Remap historical records and deactivate duplicate test leave types."""
    # 1. Canonical UUIDs
    cl_id = "'a2b9d359-8aec-44f0-9816-11102efc0602'"
    sl_id = "'d0bdd4e5-908d-447f-8102-61b1056842d3'"
    el_id = "'b4cf619e-230f-4db4-aa86-cfd2ba1d81f2'"
    pl_id = "'a404cf1c-75c5-4728-8c0a-08a5ebf1602f'"
    co_id = "'f154382f-7688-4435-87fa-41a7a4a1c16b'"
    lwp_id = "'e61ce124-9092-4ddc-b2ce-b55a0edf2933'"
    ml_id = "'c55abcd0-36a1-42f5-9c78-8e0e0d05f893'"
    ptl_id = "'4235386b-5654-4055-ba94-25b557877da8'"
    sbl_id = "'d7def19d-622e-4c1c-af22-380cc7d8a0c7'"

    canonical_ids = f"({cl_id}, {sl_id}, {el_id}, {pl_id}, {co_id}, {lwp_id}, {ml_id}, {ptl_id}, {sbl_id})"

    # Remap leave requests
    op.execute(f"""
        UPDATE hrms_leave_requests r
        SET leave_type_id = CASE
            WHEN LOWER(t.name) LIKE '%sick%' THEN {sl_id}::uuid
            WHEN LOWER(t.name) LIKE '%earned%' THEN {el_id}::uuid
            WHEN LOWER(t.name) LIKE '%privilege%' THEN {pl_id}::uuid
            WHEN LOWER(t.name) LIKE '%paternity%' THEN {ptl_id}::uuid
            WHEN LOWER(t.name) LIKE '%maternity%' THEN {ml_id}::uuid
            WHEN LOWER(t.name) LIKE '%sabbatical%' THEN {sbl_id}::uuid
            WHEN LOWER(t.name) LIKE '%without pay%' OR LOWER(t.name) LIKE '%lwp%' THEN {lwp_id}::uuid
            WHEN LOWER(t.name) LIKE '%compensatory%' THEN {co_id}::uuid
            ELSE {cl_id}::uuid
        END
        FROM hrms_leave_types t
        WHERE r.leave_type_id = t.id AND t.id NOT IN {canonical_ids}
    """)

    # Remap leave adjustments
    op.execute(f"""
        UPDATE hrms_leave_adjustments a
        SET leave_type_id = CASE
            WHEN LOWER(t.name) LIKE '%sick%' THEN {sl_id}::uuid
            WHEN LOWER(t.name) LIKE '%earned%' THEN {el_id}::uuid
            WHEN LOWER(t.name) LIKE '%privilege%' THEN {pl_id}::uuid
            WHEN LOWER(t.name) LIKE '%paternity%' THEN {ptl_id}::uuid
            WHEN LOWER(t.name) LIKE '%maternity%' THEN {ml_id}::uuid
            WHEN LOWER(t.name) LIKE '%sabbatical%' THEN {sbl_id}::uuid
            WHEN LOWER(t.name) LIKE '%without pay%' OR LOWER(t.name) LIKE '%lwp%' THEN {lwp_id}::uuid
            WHEN LOWER(t.name) LIKE '%compensatory%' THEN {co_id}::uuid
            ELSE {cl_id}::uuid
        END
        FROM hrms_leave_types t
        WHERE a.leave_type_id = t.id AND t.id NOT IN {canonical_ids}
    """)

    # Delete bloated balances of non-canonical duplicate types
    op.execute(f"""
        DELETE FROM hrms_employee_leave_balances
        WHERE leave_type_id NOT IN {canonical_ids}
    """)

    # Soft-delete & deactivate all duplicate test types
    op.execute(f"""
        UPDATE hrms_leave_types
        SET is_active = FALSE, deleted_at = NOW()
        WHERE id NOT IN {canonical_ids}
    """)

    # Ensure canonical 9 are active and not deleted
    op.execute(f"""
        UPDATE hrms_leave_types
        SET is_active = TRUE, deleted_at = NULL
        WHERE id IN {canonical_ids}
    """)


def downgrade() -> None:
    """Revert this migration's schema changes."""
    pass
