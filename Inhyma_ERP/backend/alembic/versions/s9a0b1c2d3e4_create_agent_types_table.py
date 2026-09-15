"""create_agent_types_table

Revision ID: s9a0b1c2d3e4
Revises: r8a9b0c1d2e3
Create Date: 2026-09-12 18:05:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
import app.database.base

# revision identifiers, used by Alembic.
revision: str = 's9a0b1c2d3e4'
down_revision: Union[str, None] = 'r8a9b0c1d2e3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Create agent_types table."""
    bind = op.get_bind()
    insp = sa.inspect(bind)

    if not insp.has_table('agent_types'):
        op.create_table(
            'agent_types',
            sa.Column('id', app.database.base.GUID(), primary_key=True),
            sa.Column('name', sa.String(100), nullable=False),
            sa.Column('description', sa.Text(), nullable=True),
            sa.Column('status', sa.String(20), nullable=False, server_default='ACTIVE'),
            sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now(), nullable=False),
            sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
            sa.Column('version', sa.Integer(), server_default='1', nullable=False),
        )
        op.create_index('ix_agent_types_name', 'agent_types', ['name'], unique=True)
        op.create_index('ix_agent_types_status', 'agent_types', ['status'])


def downgrade() -> None:
    """Drop agent_types table."""
    bind = op.get_bind()
    insp = sa.inspect(bind)
    if insp.has_table('agent_types'):
        op.drop_index('ix_agent_types_status', table_name='agent_types')
        op.drop_index('ix_agent_types_name', table_name='agent_types')
        op.drop_table('agent_types')
