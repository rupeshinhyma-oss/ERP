"""
Feed and Broadcast Messaging API Routes.

Enforces authentication and Feed RBAC permissions (`feed.view`, `feed.interact`,
`feed.create`, `feed.manage`, with strict `deny:feed.*` override precedence) across
all announcement, interaction, audience-lookup, and 1:1 direct-messaging endpoints.
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.service import CurrentUser
from app.core.responses import build_success_response
from app.database.session import get_db_session
from app.feed.rbac import require_feed_any_permission, require_feed_permission
from app.feed.schemas import (
    ConversationCreate,
    DirectMessageCreate,
    DirectMessageUpdate,
    FeedCommentCreate,
    FeedCommentUpdate,
    FeedPostCreate,
    FeedPostUpdate,
    FeedReactionToggle,
)
from app.feed.service import FeedService

router = APIRouter(prefix="/feed", tags=["feed"])


def get_feed_service(session: AsyncSession = Depends(get_db_session)) -> FeedService:
    """Dependency injection helper for FeedService."""
    return FeedService(session)


# ==============================================================================
# Announcements & Broadcast Posts Endpoints
# ==============================================================================


@router.post("/posts", summary="Create a new feed post", status_code=201)
async def create_feed_post(
    request: Request,
    payload: FeedPostCreate,
    service: FeedService = Depends(get_feed_service),
    current_user: CurrentUser = Depends(require_feed_permission("feed.create")),
) -> dict:
    post = await service.create_post(actor=current_user, data=payload)
    return build_success_response(
        data=post.model_dump(mode="json"),
        request_id=getattr(request.state, "request_id", "-"),
        message="Feed post created successfully.",
    )


@router.get("/posts", summary="List accessible feed posts")
async def list_feed_posts(
    request: Request,
    page: int = Query(default=1, ge=1, description="Page number"),
    page_size: int = Query(default=20, ge=1, le=100, description="Items per page"),
    status: str | None = Query(default=None, description="Optional status filter: PUBLISHED or DRAFT"),
    search: str | None = Query(default=None, description="Optional keyword search"),
    service: FeedService = Depends(get_feed_service),
    current_user: CurrentUser = Depends(require_feed_permission("feed.view")),
) -> dict:
    response_data = await service.list_posts(
        actor=current_user,
        page=page,
        page_size=page_size,
        status=status,
        search=search,
    )
    return build_success_response(
        data=response_data.model_dump(mode="json"),
        request_id=getattr(request.state, "request_id", "-"),
    )


@router.get("/posts/{post_id}", summary="Get a specific feed post by ID")
async def get_feed_post(
    request: Request,
    post_id: uuid.UUID,
    service: FeedService = Depends(get_feed_service),
    current_user: CurrentUser = Depends(require_feed_permission("feed.view")),
) -> dict:
    post = await service.get_post_by_id(actor=current_user, post_id=post_id)
    return build_success_response(
        data=post.model_dump(mode="json"),
        request_id=getattr(request.state, "request_id", "-"),
    )


@router.patch("/posts/{post_id}", summary="Update an existing feed post")
async def update_feed_post(
    request: Request,
    post_id: uuid.UUID,
    payload: FeedPostUpdate,
    service: FeedService = Depends(get_feed_service),
    current_user: CurrentUser = Depends(require_feed_permission("feed.create")),
) -> dict:
    post = await service.update_post(actor=current_user, post_id=post_id, data=payload)
    return build_success_response(
        data=post.model_dump(mode="json"),
        request_id=getattr(request.state, "request_id", "-"),
        message="Feed post updated successfully.",
    )


@router.delete("/posts/{post_id}", summary="Delete a feed post")
async def delete_feed_post(
    request: Request,
    post_id: uuid.UUID,
    service: FeedService = Depends(get_feed_service),
    current_user: CurrentUser = Depends(require_feed_any_permission("feed.create", "feed.manage")),
) -> dict:
    await service.delete_post(actor=current_user, post_id=post_id)
    return build_success_response(
        data={"id": str(post_id), "deleted": True},
        request_id=getattr(request.state, "request_id", "-"),
        message="Feed post deleted successfully.",
    )


@router.get("/recipients/eligible", summary="List eligible workforce recipients for audience selection")
async def list_eligible_recipients(
    request: Request,
    query: str | None = Query(default=None, description="Optional search string"),
    limit: int = Query(default=30, ge=1, le=100, description="Maximum eligible recipients returned"),
    service: FeedService = Depends(get_feed_service),
    current_user: CurrentUser = Depends(require_feed_any_permission("feed.create", "feed.manage")),
) -> dict:
    recipients = await service.list_eligible_recipients(actor=current_user, query=query, limit=limit)
    return build_success_response(
        data=[r.model_dump(mode="json") for r in recipients],
        request_id=getattr(request.state, "request_id", "-"),
    )


@router.get("/departments/eligible", summary="List eligible departments for audience targeting")
async def list_eligible_departments(
    request: Request,
    service: FeedService = Depends(get_feed_service),
    current_user: CurrentUser = Depends(require_feed_any_permission("feed.create", "feed.manage")),
) -> dict:
    departments = await service.list_eligible_departments(actor=current_user)
    return build_success_response(
        data=[d.model_dump(mode="json") for d in departments],
        request_id=getattr(request.state, "request_id", "-"),
    )


# --- Comments Endpoints ---


@router.post("/posts/{post_id}/comments", summary="Add a comment to an announcement", status_code=201)
async def add_post_comment(
    request: Request,
    post_id: uuid.UUID,
    payload: FeedCommentCreate,
    service: FeedService = Depends(get_feed_service),
    current_user: CurrentUser = Depends(require_feed_permission("feed.interact")),
) -> dict:
    comment = await service.add_comment(actor=current_user, post_id=post_id, data=payload)
    return build_success_response(
        data=comment.model_dump(mode="json"),
        request_id=getattr(request.state, "request_id", "-"),
        message="Comment added successfully.",
    )


@router.get("/posts/{post_id}/comments", summary="List comments for an announcement")
async def list_post_comments(
    request: Request,
    post_id: uuid.UUID,
    page: int = Query(default=1, ge=1, description="Comment page number"),
    page_size: int = Query(default=50, ge=1, le=100, description="Comments per page"),
    service: FeedService = Depends(get_feed_service),
    current_user: CurrentUser = Depends(require_feed_permission("feed.view")),
) -> dict:
    response_data = await service.list_comments(
        actor=current_user, post_id=post_id, page=page, page_size=page_size
    )
    return build_success_response(
        data=response_data.model_dump(mode="json"),
        request_id=getattr(request.state, "request_id", "-"),
    )


@router.patch("/posts/{post_id}/comments/{comment_id}", summary="Update a comment")
async def update_post_comment(
    request: Request,
    post_id: uuid.UUID,
    comment_id: uuid.UUID,
    payload: FeedCommentUpdate,
    service: FeedService = Depends(get_feed_service),
    current_user: CurrentUser = Depends(require_feed_permission("feed.interact")),
) -> dict:
    updated = await service.update_comment(
        actor=current_user, post_id=post_id, comment_id=comment_id, data=payload
    )
    return build_success_response(
        data=updated.model_dump(mode="json"),
        request_id=getattr(request.state, "request_id", "-"),
        message="Comment updated successfully.",
    )


@router.delete("/posts/{post_id}/comments/{comment_id}", summary="Delete a comment")
async def delete_post_comment(
    request: Request,
    post_id: uuid.UUID,
    comment_id: uuid.UUID,
    service: FeedService = Depends(get_feed_service),
    current_user: CurrentUser = Depends(
        require_feed_any_permission("feed.interact", "feed.create", "feed.manage")
    ),
) -> dict:
    await service.delete_comment(actor=current_user, post_id=post_id, comment_id=comment_id)
    return build_success_response(
        data={"id": str(comment_id), "deleted": True},
        request_id=getattr(request.state, "request_id", "-"),
        message="Comment deleted successfully.",
    )


# --- Reactions Endpoints ---


@router.post("/posts/{post_id}/reactions", summary="Toggle a reaction on an announcement")
async def toggle_post_reaction(
    request: Request,
    post_id: uuid.UUID,
    payload: FeedReactionToggle,
    service: FeedService = Depends(get_feed_service),
    current_user: CurrentUser = Depends(require_feed_permission("feed.interact")),
) -> dict:
    summary = await service.toggle_reaction(actor=current_user, post_id=post_id, data=payload)
    return build_success_response(
        data=summary.model_dump(mode="json"),
        request_id=getattr(request.state, "request_id", "-"),
        message="Reaction updated successfully.",
    )


# --- Read Tracking & Readership Endpoints ---


@router.post("/posts/{post_id}/read", summary="Mark an announcement as read")
async def mark_post_as_read(
    request: Request,
    post_id: uuid.UUID,
    service: FeedService = Depends(get_feed_service),
    current_user: CurrentUser = Depends(require_feed_permission("feed.view")),
) -> dict:
    result = await service.mark_as_read(actor=current_user, post_id=post_id)
    return build_success_response(
        data=result,
        request_id=getattr(request.state, "request_id", "-"),
        message="Post marked as read.",
    )


@router.get("/posts/{post_id}/readership", summary="Get announcement readership list")
async def get_post_readership(
    request: Request,
    post_id: uuid.UUID,
    service: FeedService = Depends(get_feed_service),
    current_user: CurrentUser = Depends(require_feed_permission("feed.view")),
) -> dict:
    readership = await service.get_readership(actor=current_user, post_id=post_id)
    return build_success_response(
        data=readership.model_dump(mode="json"),
        request_id=getattr(request.state, "request_id", "-"),
    )


# ==============================================================================
# Direct Messaging & Private Conversations Endpoints
# ==============================================================================


@router.post("/conversations", summary="Start or get direct conversation with an employee", status_code=201)
async def start_or_get_conversation(
    request: Request,
    payload: ConversationCreate,
    service: FeedService = Depends(get_feed_service),
    current_user: CurrentUser = Depends(require_feed_permission("feed.create")),
) -> dict:
    conversation = await service.get_or_create_conversation(
        actor=current_user, recipient_id=payload.recipient_id
    )
    return build_success_response(
        data=conversation.model_dump(mode="json"),
        request_id=getattr(request.state, "request_id", "-"),
        message="Conversation initialized.",
    )


@router.get("/conversations", summary="List private conversations for current employee")
async def list_conversations(
    request: Request,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=100),
    service: FeedService = Depends(get_feed_service),
    current_user: CurrentUser = Depends(require_feed_permission("feed.view")),
) -> dict:
    conversations = await service.list_conversations(
        actor=current_user, page=page, page_size=page_size
    )
    return build_success_response(
        data=conversations.model_dump(mode="json"),
        request_id=getattr(request.state, "request_id", "-"),
    )


@router.get("/conversations/unread-count", summary="Get total unread private messages count")
async def get_unread_messages_count(
    request: Request,
    service: FeedService = Depends(get_feed_service),
    current_user: CurrentUser = Depends(require_feed_permission("feed.view")),
) -> dict:
    unread_total = await service.get_unread_messages_count(actor=current_user)
    return build_success_response(
        data={"unread_count": unread_total},
        request_id=getattr(request.state, "request_id", "-"),
    )


@router.get("/conversations/{conversation_id}", summary="Get conversation details")
async def get_conversation(
    request: Request,
    conversation_id: uuid.UUID,
    service: FeedService = Depends(get_feed_service),
    current_user: CurrentUser = Depends(require_feed_permission("feed.view")),
) -> dict:
    conversation = await service.get_conversation(
        actor=current_user, conversation_id=conversation_id
    )
    return build_success_response(
        data=conversation.model_dump(mode="json"),
        request_id=getattr(request.state, "request_id", "-"),
    )


@router.get("/conversations/{conversation_id}/messages", summary="List messages in conversation")
async def list_conversation_messages(
    request: Request,
    conversation_id: uuid.UUID,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=100, ge=1, le=500),
    limit: int | None = Query(default=None, ge=1, le=500),
    service: FeedService = Depends(get_feed_service),
    current_user: CurrentUser = Depends(require_feed_permission("feed.view")),
) -> dict:
    effective_size = limit if limit is not None else page_size
    messages = await service.list_messages(
        actor=current_user,
        conversation_id=conversation_id,
        page=page,
        page_size=effective_size,
    )
    return build_success_response(
        data=messages.model_dump(mode="json"),
        request_id=getattr(request.state, "request_id", "-"),
    )


@router.post("/conversations/{conversation_id}/messages", summary="Send message in conversation", status_code=201)
async def send_conversation_message(
    request: Request,
    conversation_id: uuid.UUID,
    payload: DirectMessageCreate,
    service: FeedService = Depends(get_feed_service),
    current_user: CurrentUser = Depends(require_feed_permission("feed.interact")),
) -> dict:
    message = await service.send_message(
        actor=current_user, conversation_id=conversation_id, data=payload
    )
    return build_success_response(
        data=message.model_dump(mode="json"),
        request_id=getattr(request.state, "request_id", "-"),
        message="Message sent successfully.",
    )


@router.patch("/messages/{message_id}", summary="Edit own direct message")
async def update_direct_message(
    request: Request,
    message_id: uuid.UUID,
    payload: DirectMessageUpdate,
    service: FeedService = Depends(get_feed_service),
    current_user: CurrentUser = Depends(require_feed_permission("feed.interact")),
) -> dict:
    updated = await service.update_message(
        actor=current_user, message_id=message_id, data=payload
    )
    return build_success_response(
        data=updated.model_dump(mode="json"),
        request_id=getattr(request.state, "request_id", "-"),
        message="Message updated successfully.",
    )


@router.delete("/messages/{message_id}", summary="Delete own direct message")
async def delete_direct_message(
    request: Request,
    message_id: uuid.UUID,
    service: FeedService = Depends(get_feed_service),
    current_user: CurrentUser = Depends(require_feed_permission("feed.interact")),
) -> dict:
    await service.delete_message(actor=current_user, message_id=message_id)
    return build_success_response(
        data={"id": str(message_id), "deleted": True},
        request_id=getattr(request.state, "request_id", "-"),
        message="Message deleted successfully.",
    )


@router.post("/conversations/{conversation_id}/read", summary="Mark conversation as read")
async def mark_conversation_read(
    request: Request,
    conversation_id: uuid.UUID,
    service: FeedService = Depends(get_feed_service),
    current_user: CurrentUser = Depends(require_feed_permission("feed.view")),
) -> dict:
    await service.mark_conversation_read(actor=current_user, conversation_id=conversation_id)
    return build_success_response(
        data={"conversation_id": str(conversation_id), "is_read": True},
        request_id=getattr(request.state, "request_id", "-"),
        message="Conversation marked as read.",
    )
