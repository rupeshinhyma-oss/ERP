"""create_social_media_table

Revision ID: r8a9b0c1d2e3
Revises: q7a8b9c0d1e2
Create Date: 2026-09-12 17:55:00.000000

"""
import uuid
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
import app.database.base

# revision identifiers, used by Alembic.
revision: str = 'r8a9b0c1d2e3'
down_revision: Union[str, None] = 'q7a8b9c0d1e2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

INITIAL_SOCIAL_MEDIA = [
    "Facebook",
    "Instagram",
    "YouTube",
    "Google",
]


def upgrade() -> None:
    """Create social_media table and seed initial records."""
    bind = op.get_bind()
    insp = sa.inspect(bind)

    if not insp.has_table('social_media'):
        op.create_table(
            'social_media',
            sa.Column('id', app.database.base.GUID(), primary_key=True),
            sa.Column('name', sa.String(100), nullable=False),
            sa.Column('status', sa.String(20), nullable=False, server_default='ACTIVE'),
            sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now(), nullable=False),
            sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
            sa.Column('version', sa.Integer(), server_default='1', nullable=False),
        )
        op.create_index('ix_social_media_name', 'social_media', ['name'], unique=True)
        op.create_index('ix_social_media_status', 'social_media', ['status'])

        # Seed initial records from legacy system
        social_media_table = sa.table(
            'social_media',
            sa.column('id', app.database.base.GUID()),
            sa.column('name', sa.String()),
            sa.column('status', sa.String()),
            sa.column('version', sa.Integer()),
        )

        rows = [
            {
                "id": uuid.uuid4(),
                "name": name,
                "status": "ACTIVE",
                "version": 1,
            }
            for name in INITIAL_SOCIAL_MEDIA
        ]
        op.bulk_insert(social_media_table, rows)


def downgrade() -> None:
    """Drop social_media table."""
    bind = op.get_bind()
    insp = sa.inspect(bind)
    if insp.has_table('social_media'):
        op.drop_index('ix_social_media_status', table_name='social_media')
        op.drop_index('ix_social_media_name', table_name='social_media')
        op.drop_table('social_media')
