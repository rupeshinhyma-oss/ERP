"""create_districts_table

Revision ID: m3d4e5f6a7b8
Revises: l2d3e4f5a6b7
Create Date: 2026-09-12 15:30:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
import app.database.base

# revision identifiers, used by Alembic.
revision: str = 'm3d4e5f6a7b8'
down_revision: Union[str, None] = 'l2d3e4f5a6b7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Create districts table."""
    bind = op.get_bind()
    insp = sa.inspect(bind)

    if not insp.has_table('districts'):
        op.create_table(
            'districts',
            sa.Column('id', app.database.base.GUID(), primary_key=True),
            sa.Column('country_id', app.database.base.GUID(), sa.ForeignKey('countries.id', ondelete='RESTRICT'), nullable=False),
            sa.Column('state_id', app.database.base.GUID(), sa.ForeignKey('states.id', ondelete='RESTRICT'), nullable=False),
            sa.Column('name', sa.String(150), nullable=False),
            sa.Column('code', sa.String(50), nullable=True),
            sa.Column('status', sa.String(20), nullable=False, server_default='ACTIVE'),
            sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now(), nullable=False),
            sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
            sa.Column('version', sa.Integer(), server_default='1', nullable=False),
            sa.UniqueConstraint('state_id', 'name', name='uq_district_state_name'),
        )
        op.create_index('ix_districts_country_id', 'districts', ['country_id'])
        op.create_index('ix_districts_state_id', 'districts', ['state_id'])
        op.create_index('ix_districts_name', 'districts', ['name'])
        op.create_index('ix_districts_status', 'districts', ['status'])


def downgrade() -> None:
    """Drop districts table."""
    bind = op.get_bind()
    insp = sa.inspect(bind)

    if insp.has_table('districts'):
        op.drop_index('ix_districts_status', table_name='districts')
        op.drop_index('ix_districts_name', table_name='districts')
        op.drop_index('ix_districts_state_id', table_name='districts')
        op.drop_index('ix_districts_country_id', table_name='districts')
        op.drop_table('districts')
