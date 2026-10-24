"""create_feed_interactions_and_tracking_tables

Revision ID: t5e6f7a8b9c0
Revises: s4d5e6f7a8b9
Create Date: 2026-10-23 11:00:00.000000

"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from app.database.base import GUID


# revision identifiers, used by Alembic.
revision: str = 't5e6f7a8b9c0'
down_revision: Union[str, Sequence[str], None] = 's4d5e6f7a8b9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. feed_post_comments
    op.create_table(
        'feed_post_comments',
        sa.Column('id', GUID(), nullable=False),
        sa.Column('post_id', GUID(), nullable=False),
        sa.Column('author_id', GUID(), nullable=False),
        sa.Column('content', sa.Text(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['author_id'], ['users.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['post_id'], ['feed_posts.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_feed_post_comments_post_id'), 'feed_post_comments', ['post_id'], unique=False)
    op.create_index(op.f('ix_feed_post_comments_author_id'), 'feed_post_comments', ['author_id'], unique=False)
    op.create_index('ix_feed_post_comments_post_created', 'feed_post_comments', ['post_id', 'created_at'], unique=False)

    # 2. feed_post_reactions
    op.create_table(
        'feed_post_reactions',
        sa.Column('id', GUID(), nullable=False),
        sa.Column('post_id', GUID(), nullable=False),
        sa.Column('user_id', GUID(), nullable=False),
        sa.Column('reaction_type', sa.String(20), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['post_id'], ['feed_posts.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('post_id', 'user_id', name='uq_feed_post_reactions_post_user'),
    )
    op.create_index(op.f('ix_feed_post_reactions_post_id'), 'feed_post_reactions', ['post_id'], unique=False)
    op.create_index(op.f('ix_feed_post_reactions_user_id'), 'feed_post_reactions', ['user_id'], unique=False)
    op.create_index('ix_feed_post_reactions_post_type', 'feed_post_reactions', ['post_id', 'reaction_type'], unique=False)

    # 3. feed_post_reads
    op.create_table(
        'feed_post_reads',
        sa.Column('id', GUID(), nullable=False),
        sa.Column('post_id', GUID(), nullable=False),
        sa.Column('user_id', GUID(), nullable=False),
        sa.Column('read_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['post_id'], ['feed_posts.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('post_id', 'user_id', name='uq_feed_post_reads_post_user'),
    )
    op.create_index(op.f('ix_feed_post_reads_post_id'), 'feed_post_reads', ['post_id'], unique=False)
    op.create_index(op.f('ix_feed_post_reads_user_id'), 'feed_post_reads', ['user_id'], unique=False)
    op.create_index('ix_feed_post_reads_post_read_at', 'feed_post_reads', ['post_id', 'read_at'], unique=False)


def downgrade() -> None:
    op.drop_index('ix_feed_post_reads_post_read_at', table_name='feed_post_reads')
    op.drop_index(op.f('ix_feed_post_reads_user_id'), table_name='feed_post_reads')
    op.drop_index(op.f('ix_feed_post_reads_post_id'), table_name='feed_post_reads')
    op.drop_table('feed_post_reads')

    op.drop_index('ix_feed_post_reactions_post_type', table_name='feed_post_reactions')
    op.drop_index(op.f('ix_feed_post_reactions_user_id'), table_name='feed_post_reactions')
    op.drop_index(op.f('ix_feed_post_reactions_post_id'), table_name='feed_post_reactions')
    op.drop_table('feed_post_reactions')

    op.drop_index('ix_feed_post_comments_post_created', table_name='feed_post_comments')
    op.drop_index(op.f('ix_feed_post_comments_author_id'), table_name='feed_post_comments')
    op.drop_index(op.f('ix_feed_post_comments_post_id'), table_name='feed_post_comments')
    op.drop_table('feed_post_comments')
