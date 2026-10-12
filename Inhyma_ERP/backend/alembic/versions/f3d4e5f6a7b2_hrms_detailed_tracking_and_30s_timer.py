"""hrms detailed tracking flags and 30s return timer default

Revision ID: f3d4e5f6a7b2
Revises: e2c3d4e5f6b1
Create Date: 2026-10-09 17:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'f3d4e5f6a7b2'
down_revision = 'e2c3d4e5f6b1'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add detailed tracking columns to hrms_tracking_settings
    op.add_column(
        'hrms_tracking_settings',
        sa.Column('is_detailed_tracking_enabled', sa.Boolean(), server_default='false', nullable=False)
    )
    op.add_column(
        'hrms_tracking_settings',
        sa.Column('detailed_interval_minutes', sa.Integer(), server_default='5', nullable=False)
    )

    # Set organization default return timer to 30 seconds
    op.execute(
        "UPDATE hrms_tracking_settings SET return_timer_seconds = 30 WHERE employee_id IS NULL;"
    )


def downgrade() -> None:
    op.drop_column('hrms_tracking_settings', 'detailed_interval_minutes')
    op.drop_column('hrms_tracking_settings', 'is_detailed_tracking_enabled')
