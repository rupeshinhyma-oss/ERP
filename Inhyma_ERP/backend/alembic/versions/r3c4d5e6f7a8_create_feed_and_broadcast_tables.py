"""create_feed_and_broadcast_tables

Revision ID: r3c4d5e6f7a8
Revises: m9c0d1e2f3a4, q2c3d4e5f6a7
Create Date: 2026-10-22 15:30:00.000000

Creates feed_posts and feed_post_recipients tables for the Feed / Broadcast Messaging module.
"""

from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from app.database.base import GUID

# revision identifiers, used by Alembic.
revision: str = "r3c4d5e6f7a8"
down_revision: Union[str, Sequence[str], None] = ("m9c0d1e2f3a4", "q2c3d4e5f6a7")
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    insp = sa.inspect(conn)

    # 1. Create feed_posts table if not exists
    if "feed_posts" not in insp.get_table_names():
        op.create_table(
            "feed_posts",
            sa.Column("id", GUID(), primary_key=True),
            sa.Column("author_id", GUID(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("title", sa.String(255), nullable=True),
            sa.Column("content", sa.Text(), nullable=False),
            sa.Column("audience_type", sa.String(20), nullable=False, server_default="ALL"),
            sa.Column("status", sa.String(20), nullable=False, server_default="PUBLISHED"),
            sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        )
        op.create_index("ix_feed_posts_author_id", "feed_posts", ["author_id"])
        op.create_index("ix_feed_posts_audience_type", "feed_posts", ["audience_type"])
        op.create_index("ix_feed_posts_status", "feed_posts", ["status"])
        op.create_index("ix_feed_posts_published_at", "feed_posts", ["published_at"])
        op.create_index("ix_feed_posts_deleted_at", "feed_posts", ["deleted_at"])
        op.create_index("ix_feed_posts_status_published_at", "feed_posts", ["status", "published_at"])
        op.create_index("ix_feed_posts_author_status", "feed_posts", ["author_id", "status"])

    # 2. Create feed_post_recipients table if not exists
    if "feed_post_recipients" not in insp.get_table_names():
        op.create_table(
            "feed_post_recipients",
            sa.Column("id", GUID(), primary_key=True),
            sa.Column("post_id", GUID(), sa.ForeignKey("feed_posts.id", ondelete="CASCADE"), nullable=False),
            sa.Column("recipient_id", GUID(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.UniqueConstraint("post_id", "recipient_id", name="uq_feed_post_recipients_post_user"),
        )
        op.create_index("ix_feed_post_recipients_post_id", "feed_post_recipients", ["post_id"])
        op.create_index("ix_feed_post_recipients_recipient_id", "feed_post_recipients", ["recipient_id"])
        op.create_index("ix_feed_post_recipients_recipient_post", "feed_post_recipients", ["recipient_id", "post_id"])


def downgrade() -> None:
    conn = op.get_bind()
    insp = sa.inspect(conn)

    if "feed_post_recipients" in insp.get_table_names():
        op.drop_table("feed_post_recipients")

    if "feed_posts" in insp.get_table_names():
        op.drop_table("feed_posts")
