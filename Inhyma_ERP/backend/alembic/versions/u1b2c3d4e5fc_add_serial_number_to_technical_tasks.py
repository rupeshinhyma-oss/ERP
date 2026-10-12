"""add_serial_number_to_technical_tasks

Revision ID: u1b2c3d4e5fc
Revises: t1b2c3d4e5fb
Create Date: 2026-10-08 13:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'u1b2c3d4e5fc'
down_revision: Union[str, None] = 't1b2c3d4e5fb'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)

    if insp.has_table('technical_tasks'):
        columns = [c['name'] for c in insp.get_columns('technical_tasks')]
        if 'serial_number' not in columns:
            op.add_column('technical_tasks', sa.Column('serial_number', sa.String(100), nullable=True))
            op.create_index('ix_technical_tasks_serial_number', 'technical_tasks', ['serial_number'], unique=False)


def downgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)

    if insp.has_table('technical_tasks'):
        columns = [c['name'] for c in insp.get_columns('technical_tasks')]
        if 'serial_number' in columns:
            op.drop_index('ix_technical_tasks_serial_number', table_name='technical_tasks')
            op.drop_column('technical_tasks', 'serial_number')
