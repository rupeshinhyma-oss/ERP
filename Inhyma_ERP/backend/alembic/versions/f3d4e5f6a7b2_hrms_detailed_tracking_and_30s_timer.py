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
    # Safe to run whether or not the columns already exist.  They can already be present when the database was
    # changed outside Alembic (a manual ALTER TABLE, another environment, a hot-fix); a plain ADD COLUMN would then
    # fail with DuplicateColumn and the deploy would loop forever on this migration.
    op.execute(
        "ALTER TABLE hrms_tracking_settings "
        "ADD COLUMN IF NOT EXISTS is_detailed_tracking_enabled BOOLEAN NOT NULL DEFAULT false"
    )
    op.execute(
        "ALTER TABLE hrms_tracking_settings "
        "ADD COLUMN IF NOT EXISTS detailed_interval_minutes INTEGER NOT NULL DEFAULT 5"
    )

    # Set organization default return timer to 30 seconds
    op.execute(
        "UPDATE hrms_tracking_settings SET return_timer_seconds = 30 WHERE employee_id IS NULL;"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE hrms_tracking_settings DROP COLUMN IF EXISTS detailed_interval_minutes")
    op.execute("ALTER TABLE hrms_tracking_settings DROP COLUMN IF EXISTS is_detailed_tracking_enabled")