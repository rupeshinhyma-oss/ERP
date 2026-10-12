"""platform_admins.tokens_revoked_before (sign out everywhere for admins)

Revision ID: 0013
Revises: 0012
Create Date: 2026-10-14
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0013"
down_revision: Union[str, None] = "0012"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    cols = {c["name"] for c in sa.inspect(op.get_bind()).get_columns("platform_admins")}
    if "tokens_revoked_before" not in cols:
        op.add_column("platform_admins", sa.Column("tokens_revoked_before", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("platform_admins", "tokens_revoked_before")
