"""
Feed and Broadcast Messaging API Routes.
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.service import CurrentUser
from app.core.responses import build_success_response
from app.database.session import get_db_session
from app.feed.schemas import (
    FeedCommentCreate,
    FeedCommentUpdate,
    FeedPostCreate,
    FeedPostUpdate,
    FeedReactionToggle,
)
from app.feed.service import FeedService
from app.rbac.dependencies import require_any_permission

router = APIRouter(prefix="/feed", tags=["feed"])


def get_feed_service(session: AsyncSession = Depends(get_db_session)) -> FeedService:
    """Dependency injection helper for FeedService."""
    return FeedService(session)


@router.post("/posts", summary="Create a new feed post", status_code=201)
async def create_feed_post(
    request: Request,
    payload: FeedPostCreate,
    service: FeedService = Depends(get_feed_service),
    current_user: CurrentUser = Depends(require_any_permission("feed.create", "feed.manage")),
) -> dict:
    """
    Create a new feed announcement or message.
    Supports 'ALL' audience for company-wide broadcast or 'SELECTED' for targeted recipients.
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
    current_user: CurrentUser = Depends(
        require_any_permission("feed.view", "feed.create", "feed.manage")
    ),
) -> dict:
    """
    Retrieve paginated feed posts accessible to the current user.
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
    current_user: CurrentUser = Depends(
        require_any_permission("feed.view", "feed.create", "feed.manage")
    ),
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
    current_user: CurrentUser = Depends(require_any_permission("feed.create", "feed.manage")),
) -> dict:
    """
    Update post content, title, audience, or publication state.
    Only the post author or an authorized feed administrator may update.
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
    current_user: CurrentUser = Depends(require_any_permission("feed.create", "feed.manage")),
) -> dict:
    """
    Soft-delete a post. Only the author or a feed administrator may delete.
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
    current_user: CurrentUser = Depends(require_any_permission("feed.create", "feed.manage")),
) -> dict:
    """
    List active workforce members for targeted audience selection.
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
    current_user: CurrentUser = Depends(require_any_permission("feed.create", "feed.manage")),
) -> dict:
    """
    List active departments and their eligible member counts for audience selection.
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
    current_user: CurrentUser = Depends(require_any_permission("feed.view", "feed.create", "feed.manage")),
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
    current_user: CurrentUser = Depends(require_any_permission("feed.view", "feed.create", "feed.manage")),
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
    current_user: CurrentUser = Depends(require_any_permission("feed.view", "feed.create", "feed.manage")),
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
    current_user: CurrentUser = Depends(require_any_permission("feed.view", "feed.create", "feed.manage")),
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
    current_user: CurrentUser = Depends(require_any_permission("feed.view", "feed.create", "feed.manage")),
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
    current_user: CurrentUser = Depends(require_any_permission("feed.view", "feed.create", "feed.manage")),
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
    current_user: CurrentUser = Depends(require_any_permission("feed.view", "feed.create", "feed.manage")),
) -> dict:
    readership = await service.get_readership(actor=current_user, post_id=post_id)
    return build_success_response(
        data=readership.model_dump(mode="json"),
        request_id=getattr(request.state, "request_id", "-"),
    )


