"""create_feed_post_departments_table

Revision ID: s4d5e6f7a8b9
Revises: r3c4d5e6f7a8
Create Date: 2026-10-22 17:00:00.000000

"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from app.database.base import GUID


# revision identifiers, used by Alembic.
revision: str = 's4d5e6f7a8b9'
down_revision: Union[str, Sequence[str], None] = 'r3c4d5e6f7a8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    if not insp.has_table('feed_post_departments'):
        op.create_table(
            'feed_post_departments',
            sa.Column('id', GUID(), nullable=False),
            sa.Column('post_id', GUID(), nullable=False),
            sa.Column('department_id', GUID(), nullable=False),
            sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(['department_id'], ['roles.id'], ondelete='CASCADE'),
            sa.ForeignKeyConstraint(['post_id'], ['feed_posts.id'], ondelete='CASCADE'),
            sa.PrimaryKeyConstraint('id'),
            sa.UniqueConstraint('post_id', 'department_id', name='uq_feed_post_department')
        )

    insp = sa.inspect(bind)
    existing_indexes = {idx['name'] for idx in insp.get_indexes('feed_post_departments')} if insp.has_table('feed_post_departments') else set()
    if 'ix_feed_post_departments_department_id' not in existing_indexes:
        op.create_index(op.f('ix_feed_post_departments_department_id'), 'feed_post_departments', ['department_id'], unique=False)
    if 'ix_feed_post_departments_post_id' not in existing_indexes:
        op.create_index(op.f('ix_feed_post_departments_post_id'), 'feed_post_departments', ['post_id'], unique=False)


def downgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    if insp.has_table('feed_post_departments'):
        existing_indexes = {idx['name'] for idx in insp.get_indexes('feed_post_departments')}
        if 'ix_feed_post_departments_post_id' in existing_indexes:
            op.drop_index(op.f('ix_feed_post_departments_post_id'), table_name='feed_post_departments')
        if 'ix_feed_post_departments_department_id' in existing_indexes:
            op.drop_index(op.f('ix_feed_post_departments_department_id'), table_name='feed_post_departments')
        op.drop_table('feed_post_departments')
