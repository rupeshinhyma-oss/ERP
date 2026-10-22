"""update_batch_status_business_rule

Revision ID: m4c5d6e7f8g9
Revises: l3b4c5d6e7f8
Create Date: 2026-10-13 16:47:00.000000

Update historical CRM import batch statuses according to the Phase 4 business rule:
- SUCCESS ('completed'): at least one new lead committed (success_count > 0)
  OR duplicates safely processed (skipped_count > 0).
- FAILURE ('failed'): only when no new leads committed AND no duplicates processed
  (all attempted rows failed/rejected: success_count == 0 AND skipped_count == 0),
  or when import operation failed / could not be committed safely.
"""

from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "m4c5d6e7f8g9"
down_revision: Union[str, None] = "l3b4c5d6e7f8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Safely update batches where leads were created or duplicates were safely processed
    op.execute(
        sa.text("""
        UPDATE crm_import_batches
        SET status = 'completed'
        WHERE (success_count > 0 OR skipped_count > 0)
          AND status = 'failed'
        """)
    )


def downgrade() -> None:
    # Revert batches with failed rows back to 'failed'
    op.execute(
        sa.text("""
        UPDATE crm_import_batches
        SET status = 'failed'
        WHERE failed_count > 0
          AND status = 'completed'
        """)
    )
