"""create_feed_direct_messaging_tables

Revision ID: u6f7a8b9c0d1
Revises: t5e6f7a8b9c0
Create Date: 2026-10-26 12:00:00.000000

"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from app.database.base import GUID


# revision identifiers, used by Alembic.
revision: str = 'u6f7a8b9c0d1'
down_revision: Union[str, Sequence[str], None] = 't5e6f7a8b9c0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)

    # 1. feed_conversations
    if not insp.has_table('feed_conversations'):
        op.create_table(
            'feed_conversations',
            sa.Column('id', GUID(), nullable=False),
            sa.Column('last_message_at', sa.DateTime(timezone=True), nullable=True),
            sa.Column('last_message_preview', sa.Text(), nullable=True),
            sa.Column('last_message_sender_id', GUID(), nullable=True),
            sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
            sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
            sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
            sa.ForeignKeyConstraint(['last_message_sender_id'], ['users.id'], ondelete='SET NULL'),
            sa.PrimaryKeyConstraint('id'),
        )

    insp = sa.inspect(bind)
    conv_idx = {idx['name'] for idx in insp.get_indexes('feed_conversations')} if insp.has_table('feed_conversations') else set()
    if 'ix_feed_conversations_last_message_at' not in conv_idx:
        op.create_index(op.f('ix_feed_conversations_last_message_at'), 'feed_conversations', ['last_message_at'], unique=False)

    # 2. feed_conversation_participants
    if not insp.has_table('feed_conversation_participants'):
        op.create_table(
            'feed_conversation_participants',
            sa.Column('id', GUID(), nullable=False),
            sa.Column('conversation_id', GUID(), nullable=False),
            sa.Column('user_id', GUID(), nullable=False),
            sa.Column('last_read_at', sa.DateTime(timezone=True), nullable=True),
            sa.Column('unread_count', sa.Integer(), nullable=False, server_default='0'),
            sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(['conversation_id'], ['feed_conversations.id'], ondelete='CASCADE'),
            sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
            sa.PrimaryKeyConstraint('id'),
            sa.UniqueConstraint('conversation_id', 'user_id', name='uq_feed_conv_participant'),
        )

    insp = sa.inspect(bind)
    part_idx = {idx['name'] for idx in insp.get_indexes('feed_conversation_participants')} if insp.has_table('feed_conversation_participants') else set()
    if 'ix_feed_conversation_participants_conversation_id' not in part_idx:
        op.create_index(op.f('ix_feed_conversation_participants_conversation_id'), 'feed_conversation_participants', ['conversation_id'], unique=False)
    if 'ix_feed_conversation_participants_user_id' not in part_idx:
        op.create_index(op.f('ix_feed_conversation_participants_user_id'), 'feed_conversation_participants', ['user_id'], unique=False)
    if 'ix_feed_conv_participants_user_conv' not in part_idx:
        op.create_index('ix_feed_conv_participants_user_conv', 'feed_conversation_participants', ['user_id', 'conversation_id'], unique=False)

    # 3. feed_direct_messages
    if not insp.has_table('feed_direct_messages'):
        op.create_table(
            'feed_direct_messages',
            sa.Column('id', GUID(), nullable=False),
            sa.Column('conversation_id', GUID(), nullable=False),
            sa.Column('sender_id', GUID(), nullable=False),
            sa.Column('content', sa.Text(), nullable=False),
            sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
            sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
            sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
            sa.ForeignKeyConstraint(['conversation_id'], ['feed_conversations.id'], ondelete='CASCADE'),
            sa.ForeignKeyConstraint(['sender_id'], ['users.id'], ondelete='CASCADE'),
            sa.PrimaryKeyConstraint('id'),
        )

    insp = sa.inspect(bind)
    msg_idx = {idx['name'] for idx in insp.get_indexes('feed_direct_messages')} if insp.has_table('feed_direct_messages') else set()
    if 'ix_feed_direct_messages_conversation_id' not in msg_idx:
        op.create_index(op.f('ix_feed_direct_messages_conversation_id'), 'feed_direct_messages', ['conversation_id'], unique=False)
    if 'ix_feed_direct_messages_sender_id' not in msg_idx:
        op.create_index(op.f('ix_feed_direct_messages_sender_id'), 'feed_direct_messages', ['sender_id'], unique=False)
    if 'ix_feed_direct_messages_conv_created' not in msg_idx:
        op.create_index('ix_feed_direct_messages_conv_created', 'feed_direct_messages', ['conversation_id', 'created_at'], unique=False)


def downgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)

    if insp.has_table('feed_direct_messages'):
        msg_idx = {idx['name'] for idx in insp.get_indexes('feed_direct_messages')}
        if 'ix_feed_direct_messages_conv_created' in msg_idx:
            op.drop_index('ix_feed_direct_messages_conv_created', table_name='feed_direct_messages')
        if 'ix_feed_direct_messages_sender_id' in msg_idx:
            op.drop_index(op.f('ix_feed_direct_messages_sender_id'), table_name='feed_direct_messages')
        if 'ix_feed_direct_messages_conversation_id' in msg_idx:
            op.drop_index(op.f('ix_feed_direct_messages_conversation_id'), table_name='feed_direct_messages')
        op.drop_table('feed_direct_messages')

    if insp.has_table('feed_conversation_participants'):
        part_idx = {idx['name'] for idx in insp.get_indexes('feed_conversation_participants')}
        if 'ix_feed_conv_participants_user_conv' in part_idx:
            op.drop_index('ix_feed_conv_participants_user_conv', table_name='feed_conversation_participants')
        if 'ix_feed_conversation_participants_user_id' in part_idx:
            op.drop_index(op.f('ix_feed_conversation_participants_user_id'), table_name='feed_conversation_participants')
        if 'ix_feed_conversation_participants_conversation_id' in part_idx:
            op.drop_index(op.f('ix_feed_conversation_participants_conversation_id'), table_name='feed_conversation_participants')
        op.drop_table('feed_conversation_participants')

    if insp.has_table('feed_conversations'):
        conv_idx = {idx['name'] for idx in insp.get_indexes('feed_conversations')}
        if 'ix_feed_conversations_last_message_at' in conv_idx:
            op.drop_index(op.f('ix_feed_conversations_last_message_at'), table_name='feed_conversations')
        op.drop_table('feed_conversations')
