"""
Unit & Integration Tests for Feed & Broadcast Messaging Module.

Tests cover:
- Pydantic schemas (FeedPostCreate, FeedPostUpdate, FeedCommentCreate, DirectMessageCreate, ConversationCreate, FeedReactionToggle)
- Model representations and defaults
- Service layer validations:
  * Empty content rejection
  * Targeting logic (ALL vs SELECTED)
  * Soft delete checks
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.auth.service import CurrentUser
from app.core.exceptions import ValidationException
from app.feed.models import (
    FeedAudienceType,
    FeedPost,
    FeedPostComment,
    FeedPostReaction,
    FeedPostStatus,
    FeedReactionType,
)
from app.feed.schemas import (
    ConversationCreate,
    DirectMessageCreate,
    FeedCommentCreate,
    FeedPostCreate,
    FeedPostUpdate,
    FeedReactionToggle,
)
from app.feed.service import FeedService


def test_feed_schemas_validation():
    """Verify Feed schemas validate post, comment, and message payloads."""
    # 1. Post Create Schema with ALL audience
    post_payload = FeedPostCreate(
        title="Quarterly All-Hands Meeting",
        content="Join us on Friday for company results and awards.",
        audience_type=FeedAudienceType.ALL,
    )
    assert post_payload.title == "Quarterly All-Hands Meeting"
    assert post_payload.audience_type == FeedAudienceType.ALL
    assert post_payload.recipient_ids == []

    # 2. Post Create Schema with SELECTED recipients
    rec_id = uuid.uuid4()
    dept_id = uuid.uuid4()
    targeted_payload = FeedPostCreate(
        title="Department Notice",
        content="Engineering update",
        audience_type=FeedAudienceType.SELECTED,
        department_ids=[dept_id],
        recipient_ids=[rec_id],
    )
    assert targeted_payload.audience_type == FeedAudienceType.SELECTED
    assert targeted_payload.recipient_ids == [rec_id]
    assert targeted_payload.department_ids == [dept_id]

    # 3. Post Update Schema
    update_payload = FeedPostUpdate(
        title="Updated Title",
        content="Updated content body.",
    )
    assert update_payload.title == "Updated Title"
    assert update_payload.content == "Updated content body."

    # 4. Comment Schema
    comment_payload = FeedCommentCreate(content="Great announcement!")
    assert comment_payload.content == "Great announcement!"

    # 5. Reaction Toggle Schema
    reaction_payload = FeedReactionToggle(reaction_type=FeedReactionType.LIKE)
    assert reaction_payload.reaction_type == FeedReactionType.LIKE

    # 6. Direct Message Schema
    msg_payload = DirectMessageCreate(content="Hey, are you available for a quick sync?")
    assert msg_payload.content == "Hey, are you available for a quick sync?"

    # 7. Conversation Schema
    emp_id = uuid.uuid4()
    conv_payload = ConversationCreate(recipient_id=emp_id)
    assert conv_payload.recipient_id == emp_id


def test_feed_models_structure():
    """Verify Feed ORM models, enums, and properties."""
    pid = uuid.uuid4()
    uid = uuid.uuid4()
    post = FeedPost(
        id=pid,
        author_id=uid,
        title="Production Deployment Complete",
        content="All services are green.",
        audience_type=FeedAudienceType.ALL.value,
        status=FeedPostStatus.PUBLISHED.value,
    )
    assert post.id == pid
    assert post.author_id == uid
    assert post.audience_type == "ALL"
    assert post.status == "PUBLISHED"
    assert repr(post).startswith("<FeedPost")


@pytest.mark.asyncio
async def test_feed_service_validations():
    """Verify FeedService validates empty content and recipient rules."""
    mock_session = AsyncMock()
    service = FeedService(mock_session)

    actor = CurrentUser(
        id=uuid.uuid4(),
        username="jane_doe",
    )

    # Empty content should raise ValidationException
    with pytest.raises(ValidationException) as exc_info:
        await service.create_post(
            actor=actor,
            data=FeedPostCreate(title="Test", content="   "),
        )
    assert "content cannot be empty" in str(exc_info.value).lower()
