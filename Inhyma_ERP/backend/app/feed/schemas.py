"""
Feed and Broadcast Messaging Pydantic Schemas.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.feed.models import FeedAudienceType, FeedPostStatus

MAX_FEED_POST_TITLE_LENGTH = 255
MAX_FEED_POST_CONTENT_LENGTH = 20_000
MAX_FEED_COMMENT_LENGTH = 5_000
MAX_DIRECT_MESSAGE_LENGTH = 5_000


class FeedAuthorRead(BaseModel):
    """Author identity for feed presentation."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    display_name: str | None = None
    full_name: str
    email: str | None = None
    employee_code: str | None = None
    profile_picture_url: str | None = None


class FeedRecipientRead(BaseModel):
    """Explicitly selected recipient identity for targeted post author view."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID | None = None
    recipient_id: uuid.UUID
    display_name: str | None = None
    full_name: str
    email: str | None = None
    employee_code: str | None = None
    department_name: str | None = None


class FeedDepartmentRead(BaseModel):
    """Department summary for targeted post view."""

    model_config = ConfigDict(from_attributes=True)

    department_id: uuid.UUID
    name: str
    code: str | None = None


class EligibleDepartmentRead(BaseModel):
    """Department option for recipient targeting."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    code: str | None = None
    description: str | None = None
    member_count: int = 0


class FeedPostCreate(BaseModel):
    """Payload to create a new feed post."""

    model_config = ConfigDict(extra="forbid")

    title: str | None = Field(default=None, max_length=MAX_FEED_POST_TITLE_LENGTH)
    content: str = Field(
        ...,
        min_length=1,
        max_length=MAX_FEED_POST_CONTENT_LENGTH,
        description="Message content supporting formatted text (max 20,000 characters)",
    )
    audience_type: FeedAudienceType = Field(
        default=FeedAudienceType.ALL,
        description="'ALL' for company-wide, 'SELECTED' for specific departments/employees",
    )
    department_ids: list[uuid.UUID] = Field(
        default_factory=list, description="Target department role IDs"
    )
    recipient_ids: list[uuid.UUID] = Field(
        default_factory=list, description="Explicit target recipient user IDs"
    )
    status: FeedPostStatus = Field(
        default=FeedPostStatus.PUBLISHED, description="'DRAFT' or 'PUBLISHED'"
    )


class FeedPostUpdate(BaseModel):
    """Payload to update an existing feed post."""

    model_config = ConfigDict(extra="forbid")

    title: str | None = Field(default=None, max_length=MAX_FEED_POST_TITLE_LENGTH)
    content: str | None = Field(
        default=None,
        min_length=1,
        max_length=MAX_FEED_POST_CONTENT_LENGTH,
    )
    audience_type: FeedAudienceType | None = None
    department_ids: list[uuid.UUID] | None = None
    recipient_ids: list[uuid.UUID] | None = None
    status: FeedPostStatus | None = None


class FeedReactionCounts(BaseModel):
    """Counts broken down by reaction type."""

    like: int = 0
    celebrate: int = 0
    support: int = 0
    total: int = 0


class FeedReactionSummary(BaseModel):
    """Reaction aggregates and current user's reaction."""

    counts: FeedReactionCounts = Field(default_factory=FeedReactionCounts)
    user_reaction: str | None = None


class FeedReactionToggle(BaseModel):
    """Payload to toggle a reaction on a post."""

    model_config = ConfigDict(extra="forbid")

    reaction_type: str = Field(..., description="LIKE, CELEBRATE, or SUPPORT")


class FeedCommentCreate(BaseModel):
    """Payload to create a comment."""

    model_config = ConfigDict(extra="forbid")

    content: str = Field(..., min_length=1, max_length=MAX_FEED_COMMENT_LENGTH)


class FeedCommentUpdate(BaseModel):
    """Payload to update an existing comment."""

    model_config = ConfigDict(extra="forbid")

    content: str = Field(..., min_length=1, max_length=MAX_FEED_COMMENT_LENGTH)


class FeedCommentRead(BaseModel):
    """Comment presentation model."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    post_id: uuid.UUID
    author_id: uuid.UUID
    author: FeedAuthorRead
    content: str
    created_at: datetime
    updated_at: datetime
    is_author: bool = False
    can_delete: bool = False


class FeedCommentListResponse(BaseModel):
    """Paginated list of comments for a feed post."""

    items: list[FeedCommentRead]
    total: int
    page: int = 1
    page_size: int = 50
    total_pages: int = 1
    has_more: bool = False


class FeedReaderRead(BaseModel):
    """Audience member who viewed/read the post."""

    model_config = ConfigDict(from_attributes=True)

    user_id: uuid.UUID
    display_name: str | None = None
    full_name: str
    email: str | None = None
    employee_code: str | None = None
    read_at: datetime


class FeedReadershipResponse(BaseModel):
    """Full readership report accessible strictly to the post author."""

    post_id: uuid.UUID
    total_readers: int
    readers: list[FeedReaderRead]


class FeedPostRead(BaseModel):
    """Single feed post representation."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    author_id: uuid.UUID
    author: FeedAuthorRead
    title: str | None = None
    content: str
    audience_type: str
    status: str
    published_at: datetime | None = None
    created_at: datetime
    updated_at: datetime
    targeted_departments: list[FeedDepartmentRead] = Field(default_factory=list)
    recipients: list[FeedRecipientRead] = Field(default_factory=list)
    is_author: bool = False
    can_edit: bool = False
    can_delete: bool = False
    comments_count: int = 0
    reactions_summary: FeedReactionSummary = Field(default_factory=FeedReactionSummary)
    is_read: bool = False
    read_count: int | None = None


class FeedPostListResponse(BaseModel):
    """Paginated response wrapper for feed posts."""

    items: list[FeedPostRead]
    total: int
    page: int
    page_size: int
    total_pages: int


class EligibleRecipientRead(BaseModel):
    """Eligible workforce member candidate for recipient selection."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    display_name: str | None = None
    full_name: str
    email: str | None = None
    employee_code: str | None = None
    department_name: str | None = None
    profile_picture_url: str | None = None


# ==============================================================================
# Direct Messaging Pydantic Schemas
# ==============================================================================


class ConversationCreate(BaseModel):
    """Payload to start a private conversation with an employee."""

    model_config = ConfigDict(extra="forbid")

    recipient_id: uuid.UUID = Field(..., description="Target employee user ID")


class DirectMessageCreate(BaseModel):
    """Payload to send a private message in a conversation."""

    model_config = ConfigDict(extra="forbid")

    content: str = Field(
        ...,
        min_length=1,
        max_length=MAX_DIRECT_MESSAGE_LENGTH,
        description="Message content (max 5,000 characters)",
    )


class DirectMessageUpdate(BaseModel):
    """Payload to edit an existing private message."""

    model_config = ConfigDict(extra="forbid")

    content: str = Field(
        ...,
        min_length=1,
        max_length=MAX_DIRECT_MESSAGE_LENGTH,
        description="Updated message content (max 5,000 characters)",
    )


class ConversationParticipantRead(BaseModel):
    """Participant information for conversation details."""

    model_config = ConfigDict(from_attributes=True)

    user_id: uuid.UUID
    display_name: str | None = None
    full_name: str
    email: str | None = None
    employee_code: str | None = None
    department_name: str | None = None
    profile_picture_url: str | None = None
    last_read_at: datetime | None = None
    unread_count: int = 0


class DirectMessageRead(BaseModel):
    """Single direct message representation."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    conversation_id: uuid.UUID
    sender_id: uuid.UUID
    sender: FeedAuthorRead
    sender_display_name: str | None = None
    sender_email: str | None = None
    content: str
    is_sender: bool = False
    is_edited: bool = False
    created_at: datetime
    updated_at: datetime | None = None


class ConversationRead(BaseModel):
    """Conversation summary and participants representation."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    participants: list[ConversationParticipantRead] = Field(default_factory=list)
    other_participant: ConversationParticipantRead | None = None
    last_message_at: datetime | None = None
    last_message_preview: str | None = None
    last_message_sender_id: uuid.UUID | None = None
    unread_count: int = 0
    created_at: datetime
    updated_at: datetime


class ConversationListResponse(BaseModel):
    """List of conversations for the current employee."""

    items: list[ConversationRead]
    total: int


class DirectMessageListResponse(BaseModel):
    """List of private messages in a conversation."""

    items: list[DirectMessageRead]
    total: int
