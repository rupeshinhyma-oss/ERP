"""add_district_id_to_cities

Revision ID: n4e5f6a7b8c9
Revises: m3d4e5f6a7b8
Create Date: 2026-09-12 16:30:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
import app.database.base

# revision identifiers, used by Alembic.
revision: str = 'n4e5f6a7b8c9'
down_revision: Union[str, None] = 'm3d4e5f6a7b8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add district_id to cities table."""
    bind = op.get_bind()
    insp = sa.inspect(bind)

    columns = [c['name'] for c in insp.get_columns('cities')]
    if 'district_id' not in columns:
        op.add_column(
            'cities',
            sa.Column(
                'district_id',
                app.database.base.GUID(),
                sa.ForeignKey('districts.id', ondelete='SET NULL'),
                nullable=True,
            ),
        )
        op.create_index('ix_cities_district_id', 'cities', ['district_id'])


def downgrade() -> None:
    """Remove district_id from cities table."""
    bind = op.get_bind()
    insp = sa.inspect(bind)

    columns = [c['name'] for c in insp.get_columns('cities')]
    if 'district_id' in columns:
        op.drop_index('ix_cities_district_id', table_name='cities')
        op.drop_column('cities', 'district_id')
