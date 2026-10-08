"""add_reason_for_won_loss_to_leads

Revision ID: v1b2c3d4e5fe
Revises: v1b2c3d4e5fd
Create Date: 2026-10-08 14:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'v1b2c3d4e5fe'
down_revision: Union[str, None] = 'v1b2c3d4e5fd'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)

    if insp.has_table('leads'):
        columns = [c['name'] for c in insp.get_columns('leads')]
        if 'reason_for_won_loss' not in columns:
            op.add_column('leads', sa.Column('reason_for_won_loss', sa.Text(), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)

    if insp.has_table('leads'):
        columns = [c['name'] for c in insp.get_columns('leads')]
        if 'reason_for_won_loss' in columns:
            op.drop_column('leads', 'reason_for_won_loss')
