"""crm_import_batch_status_cleanup

Revision ID: l3b4c5d6e7f8
Revises: k2a3b4c5d6e7
Create Date: 2026-10-13 16:30:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'l3b4c5d6e7f8'
down_revision = 'k2a3b4c5d6e7'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """
    1. Auditable correction of historical crm_import_batches records:
       Normalize legacy 'partially_completed' status to honest binary status:
       - If failed_count > 0: set status to 'failed'
       - If failed_count == 0: set status to 'completed'
    2. Add check constraint enforcing valid statuses: ('pending', 'processing', 'completed', 'failed').
    """
    conn = op.get_bind()

    # 1. Auditable data correction
    conn.execute(sa.text("""
        UPDATE crm_import_batches
        SET status = CASE
            WHEN failed_count > 0 THEN 'failed'
            ELSE 'completed'
        END
        WHERE status = 'partially_completed'
    """))

    # 2. Add check constraint if not already present
    # Check if constraint exists
    insp = sa.inspect(conn)
    check_constraints = [c['name'] for c in insp.get_check_constraints('crm_import_batches')]
    if 'ck_crm_import_batch_status' not in check_constraints:
        op.create_check_constraint(
            'ck_crm_import_batch_status',
            'crm_import_batches',
            "status IN ('pending', 'processing', 'completed', 'failed')"
        )


def downgrade() -> None:
    """Drop the check constraint."""
    op.drop_constraint('ck_crm_import_batch_status', 'crm_import_batches', type_='check')
