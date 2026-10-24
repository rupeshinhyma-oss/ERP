"""
Feed and Broadcast Messaging ORM Models.

Provides models for centralized company-wide and targeted employee feed posts:
- FeedPost: The announcement or message post.
- FeedPostRecipient: Explicit recipient links for SELECTED audience posts.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from enum import Enum
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, Index, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.base import GUID, Base, SoftDeleteMixin, TimestampMixin, UUIDPrimaryKeyMixin, _utcnow

if TYPE_CHECKING:
    from app.users.models import User
    from app.rbac.models import Role


class FeedAudienceType(str, Enum):
    """Audience scope for a feed post."""

    ALL = "ALL"
    SELECTED = "SELECTED"


class FeedPostStatus(str, Enum):
    """Lifecycle state of a feed post."""

    DRAFT = "DRAFT"
    PUBLISHED = "PUBLISHED"
    ARCHIVED = "ARCHIVED"


class FeedReactionType(str, Enum):
    """Supported lightweight reactions for feed posts."""

    LIKE = "LIKE"
    CELEBRATE = "CELEBRATE"
    SUPPORT = "SUPPORT"


class FeedPost(Base, UUIDPrimaryKeyMixin, TimestampMixin, SoftDeleteMixin):
    """
    Feed announcement / broadcast post record.
    """

    __tablename__ = "feed_posts"

    author_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    title: Mapped[str | None] = mapped_column(String(255), nullable=True)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    audience_type: Mapped[str] = mapped_column(
        String(20), default=FeedAudienceType.ALL.value, nullable=False, index=True
    )
    status: Mapped[str] = mapped_column(
        String(20), default=FeedPostStatus.PUBLISHED.value, nullable=False, index=True
    )
    published_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, index=True
    )

    # Relationships
    author: Mapped["User"] = relationship("User", foreign_keys=[author_id], lazy="selectin")
    recipients: Mapped[list["FeedPostRecipient"]] = relationship(
        "FeedPostRecipient",
        back_populates="post",
        cascade="all, delete-orphan",
        lazy="selectin",
        order_by="FeedPostRecipient.created_at",
    )
    targeted_departments: Mapped[list["FeedPostDepartment"]] = relationship(
        "FeedPostDepartment",
        back_populates="post",
        cascade="all, delete-orphan",
        lazy="selectin",
        order_by="FeedPostDepartment.created_at",
    )
    comments: Mapped[list["FeedPostComment"]] = relationship(
        "FeedPostComment",
        back_populates="post",
        cascade="all, delete-orphan",
        lazy="selectin",
        order_by="FeedPostComment.created_at",
    )
    reactions: Mapped[list["FeedPostReaction"]] = relationship(
        "FeedPostReaction",
        back_populates="post",
        cascade="all, delete-orphan",
        lazy="selectin",
    )
    reads: Mapped[list["FeedPostReadRecord"]] = relationship(
        "FeedPostReadRecord",
        back_populates="post",
        cascade="all, delete-orphan",
        lazy="selectin",
    )

    __table_args__ = (
        Index("ix_feed_posts_status_published_at", "status", "published_at"),
        Index("ix_feed_posts_author_status", "author_id", "status"),
    )

    def __repr__(self) -> str:
        return f"<FeedPost id={self.id} author_id={self.author_id} audience={self.audience_type} status={self.status}>"


class FeedPostRecipient(Base, UUIDPrimaryKeyMixin):
    """
    Selected recipient link for a feed post.

    Only populated when post.audience_type == 'SELECTED'.
    """

    __tablename__ = "feed_post_recipients"

    post_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("feed_posts.id", ondelete="CASCADE"), nullable=False, index=True
    )
    recipient_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False
    )

    # Relationships
    post: Mapped["FeedPost"] = relationship("FeedPost", back_populates="recipients")
    recipient: Mapped["User"] = relationship("User", foreign_keys=[recipient_id], lazy="selectin")

    __table_args__ = (
        UniqueConstraint("post_id", "recipient_id", name="uq_feed_post_recipients_post_user"),
        Index("ix_feed_post_recipients_recipient_post", "recipient_id", "post_id"),
    )

    def __repr__(self) -> str:
        return f"<FeedPostRecipient id={self.id} post_id={self.post_id} recipient_id={self.recipient_id}>"


class FeedPostDepartment(Base, UUIDPrimaryKeyMixin):
    """
    Targeted department link for a feed post.
    Records which department(s) were targeted at creation/publication time.
    """

    __tablename__ = "feed_post_departments"

    post_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("feed_posts.id", ondelete="CASCADE"), nullable=False, index=True
    )
    department_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("roles.id", ondelete="CASCADE"), nullable=False, index=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False
    )

    # Relationships
    post: Mapped["FeedPost"] = relationship("FeedPost", back_populates="targeted_departments")
    department: Mapped["Role"] = relationship("app.rbac.models.Role", lazy="selectin")

    __table_args__ = (
        UniqueConstraint("post_id", "department_id", name="uq_feed_post_department"),
        Index("ix_feed_post_departments_department_post", "department_id", "post_id"),
    )

    def __repr__(self) -> str:
        return f"<FeedPostDepartment id={self.id} post_id={self.post_id} department_id={self.department_id}>"


class FeedPostComment(Base, UUIDPrimaryKeyMixin, TimestampMixin, SoftDeleteMixin):
    """
    Comment on a published feed announcement.
    """

    __tablename__ = "feed_post_comments"

    post_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("feed_posts.id", ondelete="CASCADE"), nullable=False, index=True
    )
    author_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    content: Mapped[str] = mapped_column(Text, nullable=False)

    # Relationships
    post: Mapped["FeedPost"] = relationship("FeedPost", back_populates="comments")
    author: Mapped["User"] = relationship("User", foreign_keys=[author_id], lazy="selectin")

    __table_args__ = (
        Index("ix_feed_post_comments_post_created", "post_id", "created_at"),
    )

    def __repr__(self) -> str:
        return f"<FeedPostComment id={self.id} post_id={self.post_id} author_id={self.author_id}>"


class FeedPostReaction(Base, UUIDPrimaryKeyMixin):
    """
    Lightweight reaction on a feed post.
    """

    __tablename__ = "feed_post_reactions"

    post_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("feed_posts.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    reaction_type: Mapped[str] = mapped_column(String(20), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False
    )

    # Relationships
    post: Mapped["FeedPost"] = relationship("FeedPost", back_populates="reactions")
    user: Mapped["User"] = relationship("User", foreign_keys=[user_id], lazy="selectin")

    __table_args__ = (
        UniqueConstraint("post_id", "user_id", name="uq_feed_post_reactions_post_user"),
        Index("ix_feed_post_reactions_post_type", "post_id", "reaction_type"),
    )

    def __repr__(self) -> str:
        return f"<FeedPostReaction id={self.id} post_id={self.post_id} user_id={self.user_id} type={self.reaction_type}>"


class FeedPostReadRecord(Base, UUIDPrimaryKeyMixin):
    """
    Read tracking record for a feed post.
    """

    __tablename__ = "feed_post_reads"

    post_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("feed_posts.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    read_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False
    )

    # Relationships
    post: Mapped["FeedPost"] = relationship("FeedPost", back_populates="reads")
    user: Mapped["User"] = relationship("User", foreign_keys=[user_id], lazy="selectin")

    __table_args__ = (
        UniqueConstraint("post_id", "user_id", name="uq_feed_post_reads_post_user"),
        Index("ix_feed_post_reads_post_read_at", "post_id", "read_at"),
    )

    def __repr__(self) -> str:
        return f"<FeedPostReadRecord id={self.id} post_id={self.post_id} user_id={self.user_id}>"

