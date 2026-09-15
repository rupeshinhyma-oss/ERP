"""normalize_city_status_values

Revision ID: y5g6h7i8j9k0
Revises: x4f5g6h7i8j9
Create Date: 2026-09-15 13:10:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'y5g6h7i8j9k0'
down_revision: Union[str, None] = 'x4f5g6h7i8j9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Normalize lowercase status values in cities table to uppercase."""
    op.execute("UPDATE cities SET status = 'ACTIVE' WHERE LOWER(status::text) = 'active'")
    op.execute("UPDATE cities SET status = 'INACTIVE' WHERE LOWER(status::text) = 'inactive'")


def downgrade() -> None:
    """No-op downgrade."""
    pass
