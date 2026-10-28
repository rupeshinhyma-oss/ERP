"""
Feed and Broadcast Messaging API Routes.

Provides open access for all authenticated ERP employees:
- Company-wide and targeted announcements (create, view, edit/delete own, comments, reactions, readership)
- Individual 1-to-1 employee direct messaging and private conversations
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_user
from app.auth.service import CurrentUser
from app.core.responses import build_success_response
from app.database.session import get_db_session
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
# Announcements & Broadcast Posts Endpoints (Open Access to All Authenticated Employees)
# ==============================================================================

@router.post("/posts", summary="Create a new feed post", status_code=201)
async def create_feed_post(
    request: Request,
    payload: FeedPostCreate,
    service: FeedService = Depends(get_feed_service),
    current_user: CurrentUser = Depends(get_current_user),
) -> dict:
    """
    Create a new feed announcement or message.
    Available to all authenticated employees without administrative barriers.
    Supports 'ALL' audience for company-wide broadcast or 'SELECTED' for targeted recipients/departments.
    """
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
    current_user: CurrentUser = Depends(get_current_user),
) -> dict:
    """
    Retrieve paginated feed posts accessible to the current user.
    Open to all authenticated employees.
    """
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
    current_user: CurrentUser = Depends(get_current_user),
) -> dict:
    """
    Retrieve a specific post. Access is denied if the user is not in the post's audience.
    """
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
    current_user: CurrentUser = Depends(get_current_user),
) -> dict:
    """
    Update post content, title, audience, or publication state.
    Only the post author may update their announcement.
    """
    post = await service.update_post(actor=current_user, post_id=post_id, data=payload)
    return build_success_response(
        data=post.model_dump(mode="json"),
        request_id=getattr(request.state, "request_id", "-"),
        message="Feed post updated successfully.",
    )


@router.delete("/posts/{post_id}", summary="Delete or archive a feed post")
async def delete_feed_post(
    request: Request,
    post_id: uuid.UUID,
    service: FeedService = Depends(get_feed_service),
    current_user: CurrentUser = Depends(get_current_user),
) -> dict:
    """
    Soft-delete a post. Only the author may delete their announcement.
    """
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
    service: FeedService = Depends(get_feed_service),
    current_user: CurrentUser = Depends(get_current_user),
) -> dict:
    """
    List active workforce members for targeted audience selection or direct messaging.
    Available to all authenticated employees.
    """
    recipients = await service.list_eligible_recipients(actor=current_user, query=query)
    return build_success_response(
        data=[r.model_dump(mode="json") for r in recipients],
        request_id=getattr(request.state, "request_id", "-"),
    )


@router.get("/departments/eligible", summary="List eligible departments for audience targeting")
async def list_eligible_departments(
    request: Request,
    service: FeedService = Depends(get_feed_service),
    current_user: CurrentUser = Depends(get_current_user),
) -> dict:
    """
    List active departments and their eligible member counts for audience selection.
    Available to all authenticated employees.
    """
    departments = await service.list_eligible_departments()
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
    current_user: CurrentUser = Depends(get_current_user),
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
    service: FeedService = Depends(get_feed_service),
    current_user: CurrentUser = Depends(get_current_user),
) -> dict:
    response_data = await service.list_comments(actor=current_user, post_id=post_id)
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
    current_user: CurrentUser = Depends(get_current_user),
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
    current_user: CurrentUser = Depends(get_current_user),
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
    current_user: CurrentUser = Depends(get_current_user),
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
    current_user: CurrentUser = Depends(get_current_user),
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
    current_user: CurrentUser = Depends(get_current_user),
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
    current_user: CurrentUser = Depends(get_current_user),
) -> dict:
    """
    Retrieve or create a 1-to-1 conversation with the selected employee.
    Enforces that self-messaging is prohibited.
    """
    conversation = await service.get_or_create_conversation(actor=current_user, recipient_id=payload.recipient_id)
    return build_success_response(
        data=conversation.model_dump(mode="json"),
        request_id=getattr(request.state, "request_id", "-"),
        message="Conversation initialized.",
    )


@router.get("/conversations", summary="List private conversations for current employee")
async def list_conversations(
    request: Request,
    service: FeedService = Depends(get_feed_service),
    current_user: CurrentUser = Depends(get_current_user),
) -> dict:
    """
    Retrieve all direct messaging conversations for the current employee.
    Strictly restricted to conversations the user is a participant of.
    """
    conversations = await service.list_conversations(actor=current_user)
    return build_success_response(
        data=conversations.model_dump(mode="json"),
        request_id=getattr(request.state, "request_id", "-"),
    )


@router.get("/conversations/unread-count", summary="Get total unread private messages count")
async def get_unread_messages_count(
    request: Request,
    service: FeedService = Depends(get_feed_service),
    current_user: CurrentUser = Depends(get_current_user),
) -> dict:
    """
    Return total unread message count across all conversations for badge indicator.
    """
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
    current_user: CurrentUser = Depends(get_current_user),
) -> dict:
    """
    Get conversation details. Access is denied if the user is not a participant.
    """
    conversation = await service.get_conversation(actor=current_user, conversation_id=conversation_id)
    return build_success_response(
        data=conversation.model_dump(mode="json"),
        request_id=getattr(request.state, "request_id", "-"),
    )


@router.get("/conversations/{conversation_id}/messages", summary="List messages in conversation")
async def list_conversation_messages(
    request: Request,
    conversation_id: uuid.UUID,
    limit: int = Query(default=100, ge=1, le=500),
    service: FeedService = Depends(get_feed_service),
    current_user: CurrentUser = Depends(get_current_user),
) -> dict:
    """
    List messages in conversation and automatically mark conversation as read for the user.
    Access strictly restricted to conversation participants.
    """
    messages = await service.list_messages(actor=current_user, conversation_id=conversation_id, limit=limit)
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
    current_user: CurrentUser = Depends(get_current_user),
) -> dict:
    """
    Send a direct message in a conversation.
    Sender is validated strictly from authentication.
    """
    message = await service.send_message(actor=current_user, conversation_id=conversation_id, data=payload)
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
    current_user: CurrentUser = Depends(get_current_user),
) -> dict:
    """
    Update a direct message. Strictly restricted to the original sender.
    """
    updated = await service.update_message(actor=current_user, message_id=message_id, data=payload)
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
    current_user: CurrentUser = Depends(get_current_user),
) -> dict:
    """
    Soft-delete a direct message. Strictly restricted to the original sender.
    """
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
    current_user: CurrentUser = Depends(get_current_user),
) -> dict:
    """
    Explicitly reset unread count and update last_read_at timestamp for current user.
    """
    await service.mark_conversation_read(actor=current_user, conversation_id=conversation_id)
    return build_success_response(
        data={"conversation_id": str(conversation_id), "is_read": True},
        request_id=getattr(request.state, "request_id", "-"),
        message="Conversation marked as read.",
    )
