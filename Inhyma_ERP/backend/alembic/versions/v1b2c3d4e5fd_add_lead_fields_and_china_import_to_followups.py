"""add_lead_fields_and_china_import_to_followups

Revision ID: v1b2c3d4e5fd
Revises: u1b2c3d4e5fc
Create Date: 2026-10-08 14:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'v1b2c3d4e5fd'
down_revision: Union[str, None] = 'u1b2c3d4e5fc'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)

    if insp.has_table('follow_ups'):
        columns = [c['name'] for c in insp.get_columns('follow_ups')]
        if 'direct_import_from_china' not in columns:
            op.add_column('follow_ups', sa.Column('direct_import_from_china', sa.String(20), nullable=True))
            op.create_index('ix_follow_ups_direct_import_from_china', 'follow_ups', ['direct_import_from_china'], unique=False)
        if 'monthly_import_volume' not in columns:
            op.add_column('follow_ups', sa.Column('monthly_import_volume', sa.String(100), nullable=True))
            op.create_index('ix_follow_ups_monthly_import_volume', 'follow_ups', ['monthly_import_volume'], unique=False)
        if 'lead_status' not in columns:
            op.add_column('follow_ups', sa.Column('lead_status', sa.String(50), nullable=True))
            op.create_index('ix_follow_ups_lead_status', 'follow_ups', ['lead_status'], unique=False)
        if 'reason_for_won_loss' not in columns:
            op.add_column('follow_ups', sa.Column('reason_for_won_loss', sa.Text(), nullable=True))
        if 'entry_source' not in columns:
            op.add_column('follow_ups', sa.Column('entry_source', sa.String(50), nullable=True, server_default='Outside'))
            op.create_index('ix_follow_ups_entry_source', 'follow_ups', ['entry_source'], unique=False)


def downgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)

    if insp.has_table('follow_ups'):
        columns = [c['name'] for c in insp.get_columns('follow_ups')]
        if 'entry_source' in columns:
            op.drop_index('ix_follow_ups_entry_source', table_name='follow_ups')
            op.drop_column('follow_ups', 'entry_source')
        if 'reason_for_won_loss' in columns:
            op.drop_column('follow_ups', 'reason_for_won_loss')
        if 'lead_status' in columns:
            op.drop_index('ix_follow_ups_lead_status', table_name='follow_ups')
            op.drop_column('follow_ups', 'lead_status')
        if 'monthly_import_volume' in columns:
            op.drop_index('ix_follow_ups_monthly_import_volume', table_name='follow_ups')
            op.drop_column('follow_ups', 'monthly_import_volume')
        if 'direct_import_from_china' in columns:
            op.drop_index('ix_follow_ups_direct_import_from_china', table_name='follow_ups')
            op.drop_column('follow_ups', 'direct_import_from_china')
