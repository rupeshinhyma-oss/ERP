"""indexes for large user counts

Revision ID: 0012
Revises: 0011
Create Date: 2026-10-09

Case-insensitive email lookups (sign-in, central session checks, password sync) and membership
look-ups by user/status stay index-backed with tens of thousands of users.
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0012"
down_revision: Union[str, None] = "0011"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("CREATE INDEX IF NOT EXISTS ix_global_users_primary_email_lower ON global_users (lower(primary_email))")
    op.execute("CREATE INDEX IF NOT EXISTS ix_erp_memberships_user_status ON erp_memberships (global_user_id, status)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_erp_memberships_erp_status ON erp_memberships (erp_instance_id, status)")


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_erp_memberships_erp_status")
    op.execute("DROP INDEX IF EXISTS ix_erp_memberships_user_status")
    op.execute("DROP INDEX IF EXISTS ix_global_users_primary_email_lower")
