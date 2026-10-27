"""
Feed and Broadcast Messaging Service Layer.

Implements business logic, recipient validation, audience access control,
department resolution, and publication lifecycle management for Feed posts.
"""

from __future__ import annotations

import math
import uuid
from datetime import datetime, timezone
from typing import Sequence

from sqlalchemy import delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth.service import CurrentUser
from app.core.exceptions import BadRequestException, ForbiddenException, NotFoundException, ValidationException
from app.feed.models import (
    FeedAudienceType,
    FeedConversation,
    FeedConversationParticipant,
    FeedDirectMessage,
    FeedPost,
    FeedPostComment,
    FeedPostDepartment,
    FeedPostReaction,
    FeedPostReadRecord,
    FeedPostRecipient,
    FeedPostStatus,
    FeedReactionType,
)
from app.feed.schemas import (
    ConversationCreate,
    ConversationListResponse,
    ConversationParticipantRead,
    ConversationRead,
    DirectMessageCreate,
    DirectMessageListResponse,
    DirectMessageRead,
    DirectMessageUpdate,
    EligibleDepartmentRead,
    EligibleRecipientRead,
    FeedAuthorRead,
    FeedCommentCreate,
    FeedCommentListResponse,
    FeedCommentRead,
    FeedCommentUpdate,
    FeedDepartmentRead,
    FeedPostCreate,
    FeedPostListResponse,
    FeedPostRead,
    FeedPostUpdate,
    FeedReactionCounts,
    FeedReactionSummary,
    FeedReactionToggle,
    FeedReaderRead,
    FeedReadershipResponse,
    FeedRecipientRead,
)
from app.notifications.repository import NotificationRepository
from app.notifications.service import NotificationService
from app.rbac.models import Role, RoleAssignmentStatus, UserRole
from app.users.models import User, UserStatus


class FeedService:
    """Service providing Feed and Broadcast operations."""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    def _is_manager_or_admin(self, actor: CurrentUser) -> bool:
        """Check if actor holds administrative feed permissions."""
        return bool(
            actor.is_super_admin
            or actor.username == "admin"
            or "*" in actor.permissions
            or "feed.manage" in actor.permissions
        )

    async def _can_actor_view_post(self, actor: CurrentUser, post: FeedPost) -> bool:
        """
        Check if actor is authorized to view the post.
        Strict visibility rules:
        - Soft-deleted posts are not accessible (returns False).
        - Drafts: visible ONLY to post author.
        - Published ALL: visible to any authenticated employee with feed.view.
        - Published SELECTED: visible ONLY to post author, targeted department members, or explicit individual recipients.
        - Admin has NO automatic bypass for private posts.
        """
        if post.deleted_at is not None:
            return False

        if post.author_id == actor.id:
            return True

        if post.status != FeedPostStatus.PUBLISHED.value:
            return False

        if post.audience_type == FeedAudienceType.ALL.value:
            return True

        if post.audience_type == FeedAudienceType.SELECTED.value:
            recip_ids = {r.recipient_id for r in (post.recipients or [])}
            if actor.id in recip_ids:
                return True

            dept_ids = {d.department_id for d in (post.targeted_departments or [])}
            if dept_ids:
                dept_stmt = select(UserRole.id).where(
                    UserRole.user_id == actor.id,
                    UserRole.role_id.in_(dept_ids),
                    UserRole.status == RoleAssignmentStatus.ACTIVE,
                )
                res = await self.session.execute(dept_stmt)
                if res.scalar_one_or_none() is not None:
                    return True

        return False

    async def _resolve_targeted_audience(
        self,
        department_ids: Sequence[uuid.UUID] | None,
        recipient_ids: Sequence[uuid.UUID] | None,
    ) -> tuple[list[Role], list[User]]:
        """
        Validate departments and individually selected employees, resolve department members,
        and deduplicate all users into a final recipient list.
        """
        dept_ids_clean = [d for d in (department_ids or []) if d is not None]
        rec_ids_clean = [r for r in (recipient_ids or []) if r is not None]

        if not dept_ids_clean and not rec_ids_clean:
            raise ValidationException(
                "Selected audience posts must specify at least one department or recipient employee."
            )

        # 1. Validate departments
        validated_departments: list[Role] = []
        dept_users: list[User] = []
        if dept_ids_clean:
            unique_dept_ids = list(dict.fromkeys(dept_ids_clean))
            dept_stmt = select(Role).where(
                Role.id.in_(unique_dept_ids),
                Role.deleted_at.is_(None),
            )
            dept_res = await self.session.execute(dept_stmt)
            found_depts = list(dept_res.scalars().all())
            found_dept_ids = {d.id for d in found_depts}
            missing_depts = [str(did) for did in unique_dept_ids if did not in found_dept_ids]
            if missing_depts:
                raise ValidationException(
                    f"The following department IDs are invalid, inactive, or do not exist: {', '.join(missing_depts)}"
                )
            validated_departments = found_depts

            # Query active members of these departments
            user_stmt = (
                select(User)
                .join(UserRole, UserRole.user_id == User.id)
                .where(
                    UserRole.role_id.in_(unique_dept_ids),
                    UserRole.status == RoleAssignmentStatus.ACTIVE,
                    User.deleted_at.is_(None),
                    User.status == UserStatus.ACTIVE,
                )
            )
            user_res = await self.session.execute(user_stmt)
            dept_users = list(user_res.scalars().all())

        # 2. Validate individual recipients
        validated_indiv_users: list[User] = []
        if rec_ids_clean:
            unique_rec_ids = list(dict.fromkeys(rec_ids_clean))
            rec_stmt = select(User).where(
                User.id.in_(unique_rec_ids),
                User.deleted_at.is_(None),
                User.status == UserStatus.ACTIVE,
            )
            rec_res = await self.session.execute(rec_stmt)
            found_rec_users = list(rec_res.scalars().all())
            found_rec_ids = {u.id for u in found_rec_users}
            missing_recs = [str(uid) for uid in unique_rec_ids if uid not in found_rec_ids]
            if missing_recs:
                raise ValidationException(
                    f"The following recipient IDs are invalid, inactive, or do not exist: {', '.join(missing_recs)}"
                )
            validated_indiv_users = found_rec_users

        # 3. Combine and Deduplicate
        all_users_dict: dict[uuid.UUID, User] = {}
        for u in dept_users:
            all_users_dict[u.id] = u
        for u in validated_indiv_users:
            all_users_dict[u.id] = u

        final_users = list(all_users_dict.values())
        if not final_users:
            raise ValidationException(
                "The selected audience resolves to zero active eligible recipients."
            )

        return validated_departments, final_users

    def _build_post_read(self, post: FeedPost, current_user_id: uuid.UUID) -> FeedPostRead:
        """Convert a FeedPost model into a FeedPostRead schema."""
        author_read = FeedAuthorRead(
            id=post.author.id,
            display_name=post.author.display_name,
            full_name=post.author.full_name,
            email=post.author.email,
            employee_code=post.author.employee_code,
            profile_picture_url=post.author.profile_picture_url,
        )

        dept_reads = [
            FeedDepartmentRead(
                department_id=d.department.id,
                name=d.department.name,
                code=d.department.code,
            )
            for d in (post.targeted_departments or [])
            if d.department is not None
        ]

        recipients_read = [
            FeedRecipientRead(
                recipient_id=r.recipient.id,
                display_name=r.recipient.display_name,
                full_name=r.recipient.full_name,
                email=r.recipient.email,
                employee_code=r.recipient.employee_code,
            )
            for r in (post.recipients or [])
            if r.recipient is not None
        ] if (post.author_id == current_user_id) else []

        return FeedPostRead(
            id=post.id,
            author_id=post.author_id,
            author=author_read,
            title=post.title,
            content=post.content,
            audience_type=post.audience_type,
            status=post.status,
            published_at=post.published_at,
            created_at=post.created_at,
            updated_at=post.updated_at,
            targeted_departments=dept_reads,
            recipients=recipients_read,
            is_author=(post.author_id == current_user_id),
            comments_count=0,
            reactions_summary=FeedReactionSummary(),
            is_read=(post.author_id == current_user_id),
            read_count=None,
        )

    async def _populate_posts_metadata(
        self, post_reads: list[FeedPostRead], actor_id: uuid.UUID
    ) -> None:
        """Enrich FeedPostRead items in batch with comments count, reactions breakdown, and read status."""
        if not post_reads:
            return

        post_ids = [p.id for p in post_reads]

        # 1. Comments counts
        c_stmt = (
            select(FeedPostComment.post_id, func.count(FeedPostComment.id))
            .where(FeedPostComment.post_id.in_(post_ids), FeedPostComment.deleted_at.is_(None))
            .group_by(FeedPostComment.post_id)
        )
        c_res = await self.session.execute(c_stmt)
        comments_map: dict[uuid.UUID, int] = dict(c_res.all())

        # 2. Reactions totals by type
        r_stmt = (
            select(FeedPostReaction.post_id, FeedPostReaction.reaction_type, func.count(FeedPostReaction.id))
            .where(FeedPostReaction.post_id.in_(post_ids))
            .group_by(FeedPostReaction.post_id, FeedPostReaction.reaction_type)
        )
        r_res = await self.session.execute(r_stmt)
        reactions_map: dict[uuid.UUID, dict[str, int]] = {}
        for pid, rx_type, count in r_res.all():
            if pid not in reactions_map:
                reactions_map[pid] = {}
            reactions_map[pid][rx_type] = count

        # 3. User reactions
        ur_stmt = (
            select(FeedPostReaction.post_id, FeedPostReaction.reaction_type)
            .where(FeedPostReaction.post_id.in_(post_ids), FeedPostReaction.user_id == actor_id)
        )
        ur_res = await self.session.execute(ur_stmt)
        user_reactions_map: dict[uuid.UUID, str] = dict(ur_res.all())

        # 4. User read status
        rd_stmt = (
            select(FeedPostReadRecord.post_id)
            .where(FeedPostReadRecord.post_id.in_(post_ids), FeedPostReadRecord.user_id == actor_id)
        )
        rd_res = await self.session.execute(rd_stmt)
        read_post_ids = set(rd_res.scalars().all())

        # 5. Readership total counts (only for posts where user is author)
        eligible_read_count_posts = [p.id for p in post_reads if p.author_id == actor_id]
        read_counts_map: dict[uuid.UUID, int] = {}
        if eligible_read_count_posts:
            rc_stmt = (
                select(FeedPostReadRecord.post_id, func.count(FeedPostReadRecord.id))
                .where(FeedPostReadRecord.post_id.in_(eligible_read_count_posts))
                .group_by(FeedPostReadRecord.post_id)
            )
            rc_res = await self.session.execute(rc_stmt)
            read_counts_map = dict(rc_res.all())

        # Map onto each FeedPostRead
        for p in post_reads:
            p.comments_count = comments_map.get(p.id, 0)

            rx_types = reactions_map.get(p.id, {})
            l_cnt = rx_types.get(FeedReactionType.LIKE.value, 0)
            c_cnt = rx_types.get(FeedReactionType.CELEBRATE.value, 0)
            s_cnt = rx_types.get(FeedReactionType.SUPPORT.value, 0)
            p.reactions_summary = FeedReactionSummary(
                counts=FeedReactionCounts(
                    like=l_cnt,
                    celebrate=c_cnt,
                    support=s_cnt,
                    total=l_cnt + c_cnt + s_cnt,
                ),
                user_reaction=user_reactions_map.get(p.id),
            )

            # Author is always counted as having read their post
            p.is_read = (p.author_id == actor_id) or (p.id in read_post_ids)

            # Privacy restriction: Only author can view total read count
            if p.author_id == actor_id:
                p.read_count = read_counts_map.get(p.id, 0)
            else:
                p.read_count = None

    async def _notify_post_publication(
        self, post: FeedPost, recipients: list[User] | None = None
    ) -> None:
        """Send notifications to intended recipients upon post publication."""
        if post.status != FeedPostStatus.PUBLISHED.value:
            return

        notif_service = NotificationService(NotificationRepository(self.session))
        post_link = f"/feed?post_id={post.id}"
        title = f"Announcement: {post.title}" if post.title else "New Company Announcement"
        snippet = post.content[:120] + ("..." if len(post.content) > 120 else "")

        target_user_ids: set[uuid.UUID] = set()
        if post.audience_type == FeedAudienceType.ALL.value:
            # Query all active users excluding author
            users_stmt = select(User.id).where(
                User.id != post.author_id,
                User.status == UserStatus.ACTIVE,
                User.deleted_at.is_(None),
            )
            u_res = await self.session.execute(users_stmt)
            target_user_ids = set(u_res.scalars().all())
        else:
            # Selected audience
            if recipients is not None:
                target_user_ids = {u.id for u in recipients if u.id != post.author_id}
            else:
                target_user_ids = {
                    r.recipient_id for r in post.recipients if r.recipient_id != post.author_id
                }

        for uid in target_user_ids:
            try:
                already_notified = await notif_service.has_recent_notification(
                    uid, type="feed_announcement", link=post_link, within_hours=24
                )
                if not already_notified:
                    await notif_service.notify_user(
                        user_id=uid,
                        type="feed_announcement",
                        title=title,
                        message=snippet,
                        link=post_link,
                    )
            except Exception:
                pass

        await self.session.commit()

    async def _notify_comment_added(
        self,
        post_id: uuid.UUID,
        post_author_id: uuid.UUID,
        post_title: str | None,
        post_audience_type: str,
        allowed_recipients: set[uuid.UUID],
        comment_content: str,
        commenter: CurrentUser,
    ) -> None:
        """Send notifications to post author and previous discussion participants."""
        notif_service = NotificationService(NotificationRepository(self.session))
        post_link = f"/feed?post_id={post_id}"
        commenter_name = (
            getattr(commenter, "display_name", None)
            or getattr(commenter, "username", None)
            or "A colleague"
        )
        snippet = comment_content[:100] + ("..." if len(comment_content) > 100 else "")

        # 1. Notify post author (if not commenting on own post)
        if post_author_id != commenter.id:
            try:
                await notif_service.notify_user(
                    user_id=post_author_id,
                    type="feed_comment",
                    title=f"{commenter_name} commented on your announcement",
                    message=f'"{snippet}"',
                    link=post_link,
                )
            except Exception:
                pass

        # 2. Notify previous commenters (excluding commenter and author)
        stmt = (
            select(FeedPostComment.author_id)
            .where(
                FeedPostComment.post_id == post_id,
                FeedPostComment.deleted_at.is_(None),
                FeedPostComment.author_id != commenter.id,
                FeedPostComment.author_id != post_author_id,
            )
            .distinct()
        )
        res = await self.session.execute(stmt)
        prev_commenters = set(res.scalars().all())

        # If post is SELECTED, ensure commenters are still authorized recipients
        if post_audience_type == FeedAudienceType.SELECTED.value:
            prev_commenters = prev_commenters.intersection(allowed_recipients)

        for uid in prev_commenters:
            try:
                await notif_service.notify_user(
                    user_id=uid,
                    type="feed_discussion",
                    title=f"New reply on announcement: {post_title or 'Broadcast'}",
                    message=f'{commenter_name}: "{snippet}"',
                    link=post_link,
                )
            except Exception:
                pass

        await self.session.commit()

    async def create_post(self, actor: CurrentUser, data: FeedPostCreate) -> FeedPostRead:
        """
        Create a new feed post either as a draft or published announcement.
        Supports company-wide, department-based, individual, or combined targeting.
        """
        content_clean = data.content.strip() if data.content else ""
        if not content_clean:
            raise ValidationException("Post content cannot be empty.")

        now_utc = datetime.now(timezone.utc)
        post_status = data.status.value if isinstance(data.status, FeedPostStatus) else data.status
        audience_type = (
            data.audience_type.value
            if isinstance(data.audience_type, FeedAudienceType)
            else data.audience_type
        )

        published_at = now_utc if post_status == FeedPostStatus.PUBLISHED.value else None

        post = FeedPost(
            author_id=actor.id,
            title=data.title.strip() if data.title and data.title.strip() else None,
            content=content_clean,
            audience_type=audience_type,
            status=post_status,
            published_at=published_at,
        )
        self.session.add(post)
        await self.session.flush()

        final_recipients_list: list[User] | None = None
        # Handle targeted audience resolution for SELECTED
        if audience_type == FeedAudienceType.SELECTED.value:
            validated_depts, final_recipients = await self._resolve_targeted_audience(
                department_ids=data.department_ids,
                recipient_ids=data.recipient_ids,
            )
            final_recipients_list = final_recipients
            for dept in validated_depts:
                self.session.add(FeedPostDepartment(post_id=post.id, department_id=dept.id))
            for recipient in final_recipients:
                self.session.add(FeedPostRecipient(post_id=post.id, recipient_id=recipient.id))
            await self.session.flush()

        await self.session.commit()

        if post.status == FeedPostStatus.PUBLISHED.value:
            await self._notify_post_publication(post, final_recipients_list)

        # Reload complete post with relations
        return await self.get_post_by_id(actor, post.id)

    async def list_posts(
        self,
        actor: CurrentUser,
        page: int = 1,
        page_size: int = 20,
        status: str | None = None,
        search: str | None = None,
    ) -> FeedPostListResponse:
        """
        Retrieve paginated feed posts accessible to the current user.
        Enforces strict audience isolation and draft visibility in SQL.
        """
        if page < 1:
            page = 1
        if page_size < 1 or page_size > 100:
            page_size = 20

        is_admin = self._is_manager_or_admin(actor)

        base_conditions = [FeedPost.deleted_at.is_(None)]

        # Search filter
        if search and search.strip():
            term = f"%{search.strip()}%"
            base_conditions.append(or_(FeedPost.title.ilike(term), FeedPost.content.ilike(term)))

        # Status & audience visibility conditions (enforced for all users including admin)
        recipient_subquery = select(FeedPostRecipient.post_id).where(
            FeedPostRecipient.recipient_id == actor.id
        )

        dept_subquery = (
            select(FeedPostDepartment.post_id)
            .join(UserRole, UserRole.role_id == FeedPostDepartment.department_id)
            .where(
                UserRole.user_id == actor.id,
                UserRole.status == RoleAssignmentStatus.ACTIVE,
            )
        )

        published_visible = (FeedPost.status == FeedPostStatus.PUBLISHED.value) & (
            (FeedPost.audience_type == FeedAudienceType.ALL.value)
            | (FeedPost.author_id == actor.id)
            | (FeedPost.id.in_(recipient_subquery))
            | (FeedPost.id.in_(dept_subquery))
        )

        # Authors see their own drafts; everyone else only sees published
        draft_visible = (FeedPost.status == FeedPostStatus.DRAFT.value) & (
            FeedPost.author_id == actor.id
        )

        if status:
            st_upper = status.upper()
            if st_upper == FeedPostStatus.DRAFT.value:
                base_conditions.append(draft_visible)
            elif st_upper == FeedPostStatus.PUBLISHED.value:
                base_conditions.append(published_visible)
            else:
                base_conditions.append(FeedPost.status == st_upper)
                base_conditions.append(or_(published_visible, draft_visible))
        else:
            base_conditions.append(or_(published_visible, draft_visible))

        # Total count query
        count_stmt = select(func.count(FeedPost.id)).where(*base_conditions)
        count_res = await self.session.execute(count_stmt)
        total = count_res.scalar_one() or 0

        # Items query
        items_stmt = (
            select(FeedPost)
            .where(*base_conditions)
            .order_by(FeedPost.published_at.desc().nullslast(), FeedPost.created_at.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
            .options(
                selectinload(FeedPost.author),
                selectinload(FeedPost.recipients).selectinload(FeedPostRecipient.recipient),
                selectinload(FeedPost.targeted_departments).selectinload(FeedPostDepartment.department),
            )
        )
        items_res = await self.session.execute(items_stmt)
        posts = items_res.scalars().all()

        pages = math.ceil(total / page_size) if total > 0 else 1
        items_read = [self._build_post_read(p, actor.id) for p in posts]
        await self._populate_posts_metadata(items_read, actor.id)

        return FeedPostListResponse(
            items=items_read,
            total=total,
            page=page,
            page_size=page_size,
            pages=pages,
        )

    async def get_post_by_id(self, actor: CurrentUser, post_id: uuid.UUID) -> FeedPostRead:
        """
        Retrieve a single post with audience authorization verification.
        """
        stmt = (
            select(FeedPost)
            .where(FeedPost.id == post_id, FeedPost.deleted_at.is_(None))
            .options(
                selectinload(FeedPost.author),
                selectinload(FeedPost.recipients).selectinload(FeedPostRecipient.recipient),
                selectinload(FeedPost.targeted_departments).selectinload(FeedPostDepartment.department),
            )
        )
        res = await self.session.execute(stmt)
        post = res.scalar_one_or_none()

        if not post:
            raise NotFoundException("Feed post not found.")

        # Audience & status check without administrative bypass for targeted posts or drafts
        if not await self._can_actor_view_post(actor, post):
            raise ForbiddenException("You do not have access to this post.")

        post_read = self._build_post_read(post, actor.id)
        await self._populate_posts_metadata([post_read], actor.id)
        return post_read

    async def update_post(
        self, actor: CurrentUser, post_id: uuid.UUID, data: FeedPostUpdate
    ) -> FeedPostRead:
        """
        Update post details, recipients, departments, or publication state.
        Only the author may edit their own announcement.
        """
        stmt = (
            select(FeedPost)
            .where(FeedPost.id == post_id, FeedPost.deleted_at.is_(None))
            .options(
                selectinload(FeedPost.author),
                selectinload(FeedPost.recipients).selectinload(FeedPostRecipient.recipient),
                selectinload(FeedPost.targeted_departments).selectinload(FeedPostDepartment.department),
            )
        )
        res = await self.session.execute(stmt)
        post = res.scalar_one_or_none()

        if not post:
            raise NotFoundException("Feed post not found.")

        if post.author_id != actor.id:
            raise ForbiddenException("Only the author can edit this post.")

        prev_status = post.status

        # Update text fields
        if data.title is not None:
            post.title = data.title.strip() if data.title.strip() else None

        if data.content is not None:
            content_clean = data.content.strip()
            if not content_clean:
                raise ValidationException("Post content cannot be empty.")
            post.content = content_clean

        # Update status
        now_utc = datetime.now(timezone.utc)
        if data.status is not None:
            new_status = data.status.value if isinstance(data.status, FeedPostStatus) else data.status
            if new_status == FeedPostStatus.PUBLISHED.value and post.published_at is None:
                post.published_at = now_utc
            post.status = new_status

        # Update audience & recipients
        target_audience = (
            data.audience_type.value
            if isinstance(data.audience_type, FeedAudienceType)
            else (data.audience_type or post.audience_type)
        )

        if data.audience_type is not None:
            post.audience_type = target_audience

        if target_audience == FeedAudienceType.ALL.value:
            # Clear existing recipients and departments if ALL
            await self.session.execute(
                delete(FeedPostRecipient).where(FeedPostRecipient.post_id == post.id)
            )
            await self.session.execute(
                delete(FeedPostDepartment).where(FeedPostDepartment.post_id == post.id)
            )
        elif (
            data.department_ids is not None
            or data.recipient_ids is not None
            or (data.audience_type == FeedAudienceType.SELECTED and not post.recipients)
        ):
            # Re-resolve targeted audience
            depts_to_resolve = (
                data.department_ids
                if data.department_ids is not None
                else [d.department_id for d in post.targeted_departments]
            )
            recs_to_resolve = (
                data.recipient_ids
                if data.recipient_ids is not None
                else [r.recipient_id for r in post.recipients]
            )

            validated_depts, final_recipients = await self._resolve_targeted_audience(
                department_ids=depts_to_resolve,
                recipient_ids=recs_to_resolve,
            )

            await self.session.execute(
                delete(FeedPostRecipient).where(FeedPostRecipient.post_id == post.id)
            )
            await self.session.execute(
                delete(FeedPostDepartment).where(FeedPostDepartment.post_id == post.id)
            )

            for dept in validated_depts:
                self.session.add(FeedPostDepartment(post_id=post.id, department_id=dept.id))
            for rec in final_recipients:
                self.session.add(FeedPostRecipient(post_id=post.id, recipient_id=rec.id))

        post.updated_at = now_utc
        await self.session.commit()

        if prev_status == FeedPostStatus.DRAFT.value and post.status == FeedPostStatus.PUBLISHED.value:
            await self._notify_post_publication(post)

        return await self.get_post_by_id(actor, post.id)

    async def delete_post(self, actor: CurrentUser, post_id: uuid.UUID) -> None:
        """
        Soft-delete a post. Only the author can delete their own post.
        """
        stmt = select(FeedPost).where(FeedPost.id == post_id, FeedPost.deleted_at.is_(None))
        res = await self.session.execute(stmt)
        post = res.scalar_one_or_none()

        if not post:
            raise NotFoundException("Feed post not found.")

        if post.author_id != actor.id:
            raise ForbiddenException("Only the author can delete this post.")

        post.deleted_at = datetime.now(timezone.utc)
        await self.session.commit()

    async def list_eligible_recipients(
        self, actor: CurrentUser, query: str | None = None
    ) -> list[EligibleRecipientRead]:
        """
        List active workforce members for audience selection.
        Populates real department membership from UserRole and Role.
        """
        stmt = (
            select(User)
            .where(User.deleted_at.is_(None), User.status == UserStatus.ACTIVE)
            .order_by(User.display_name, User.first_name, User.username)
        )

        if query and query.strip():
            term = f"%{query.strip()}%"
            stmt = stmt.where(
                or_(
                    User.display_name.ilike(term),
                    User.first_name.ilike(term),
                    User.last_name.ilike(term),
                    User.email.ilike(term),
                    User.employee_code.ilike(term),
                    User.username.ilike(term),
                )
            )

        res = await self.session.execute(stmt)
        users = res.scalars().all()
        if not users:
            return []

        user_ids = [u.id for u in users]
        role_stmt = (
            select(UserRole.user_id, Role.name, UserRole.is_primary)
            .join(Role, (Role.id == UserRole.role_id) & (Role.deleted_at.is_(None)))
            .where(
                UserRole.user_id.in_(user_ids),
                UserRole.status == RoleAssignmentStatus.ACTIVE,
            )
            .order_by(UserRole.is_primary.desc())
        )
        role_res = await self.session.execute(role_stmt)
        user_dept_map: dict[uuid.UUID, str] = {}
        for uid, rname, is_pri in role_res.all():
            if uid not in user_dept_map or is_pri:
                user_dept_map[uid] = rname

        return [
            EligibleRecipientRead(
                id=u.id,
                display_name=u.display_name,
                full_name=u.full_name,
                email=u.email,
                employee_code=u.employee_code,
                department_name=user_dept_map.get(u.id),
                profile_picture_url=u.profile_picture_url,
            )
            for u in users
        ]

    async def list_eligible_departments(self) -> list[EligibleDepartmentRead]:
        """
        List active departments and live member counts for flexible audience selection.
        """
        stmt = (
            select(
                Role.id,
                Role.name,
                Role.code,
                Role.description,
                func.count(func.distinct(User.id)).label("member_count"),
            )
            .outerjoin(
                UserRole,
                (UserRole.role_id == Role.id) & (UserRole.status == RoleAssignmentStatus.ACTIVE),
            )
            .outerjoin(
                User,
                (User.id == UserRole.user_id)
                & (User.deleted_at.is_(None))
                & (User.status == UserStatus.ACTIVE),
            )
            .where(Role.deleted_at.is_(None))
            .group_by(Role.id, Role.name, Role.code, Role.description)
            .order_by(Role.name)
        )
        res = await self.session.execute(stmt)
        rows = res.all()

        return [
            EligibleDepartmentRead(
                id=r.id,
                name=r.name,
                code=r.code,
                description=r.description,
                member_count=int(r.member_count or 0),
            )
            for r in rows
        ]

    def _build_comment_read(self, comment: FeedPostComment, actor: CurrentUser) -> FeedCommentRead:
        """Convert a FeedPostComment model into a FeedCommentRead schema."""
        is_comment_author = comment.author_id == actor.id
        can_del = is_comment_author or self._is_manager_or_admin(actor)
        author_read = FeedAuthorRead(
            id=comment.author.id,
            display_name=comment.author.display_name,
            full_name=comment.author.full_name,
            email=comment.author.email,
            employee_code=comment.author.employee_code,
            profile_picture_url=comment.author.profile_picture_url,
        )
        return FeedCommentRead(
            id=comment.id,
            post_id=comment.post_id,
            author_id=comment.author_id,
            author=author_read,
            content=comment.content,
            created_at=comment.created_at,
            updated_at=comment.updated_at,
            is_author=is_comment_author,
            can_delete=can_del,
        )

    async def add_comment(
        self, actor: CurrentUser, post_id: uuid.UUID, data: FeedCommentCreate
    ) -> FeedCommentRead:
        """Add a comment to an accessible published feed announcement."""
        content_clean = data.content.strip()
        if not content_clean:
            raise ValidationException("Comment content cannot be empty.")

        stmt = (
            select(FeedPost)
            .where(FeedPost.id == post_id, FeedPost.deleted_at.is_(None))
            .options(
                selectinload(FeedPost.author),
                selectinload(FeedPost.recipients),
                selectinload(FeedPost.targeted_departments),
            )
        )
        res = await self.session.execute(stmt)
        post = res.scalar_one_or_none()
        if not post:
            raise NotFoundException("Feed post not found.")

        if post.status != FeedPostStatus.PUBLISHED.value:
            raise BadRequestException("Cannot comment on a draft or unpublished post.")

        if not await self._can_actor_view_post(actor, post):
            raise ForbiddenException("You do not have access to this announcement.")

        # Capture post variables before commit to avoid detached instance attribute access
        post_id = post.id
        post_author_id = post.author_id
        post_title = post.title
        post_audience_type = post.audience_type
        allowed_recipients = {r.recipient_id for r in (post.recipients or [])}

        comment = FeedPostComment(
            post_id=post.id,
            author_id=actor.id,
            content=content_clean,
        )
        self.session.add(comment)
        await self.session.flush()
        await self.session.commit()

        await self._notify_comment_added(
            post_id=post_id,
            post_author_id=post_author_id,
            post_title=post_title,
            post_audience_type=post_audience_type,
            allowed_recipients=allowed_recipients,
            comment_content=content_clean,
            commenter=actor,
        )

        c_stmt = (
            select(FeedPostComment)
            .where(FeedPostComment.id == comment.id)
            .options(selectinload(FeedPostComment.author))
        )
        c_res = await self.session.execute(c_stmt)
        saved_comment = c_res.scalar_one()

        return self._build_comment_read(saved_comment, actor)

    async def list_comments(
        self, actor: CurrentUser, post_id: uuid.UUID
    ) -> FeedCommentListResponse:
        """List active comments for a published feed announcement."""
        stmt = (
            select(FeedPost)
            .where(FeedPost.id == post_id, FeedPost.deleted_at.is_(None))
            .options(
                selectinload(FeedPost.recipients),
                selectinload(FeedPost.targeted_departments),
            )
        )
        res = await self.session.execute(stmt)
        post = res.scalar_one_or_none()
        if not post:
            raise NotFoundException("Feed post not found.")

        if not await self._can_actor_view_post(actor, post):
            raise ForbiddenException("You do not have access to this announcement.")

        c_stmt = (
            select(FeedPostComment)
            .where(FeedPostComment.post_id == post_id, FeedPostComment.deleted_at.is_(None))
            .order_by(FeedPostComment.created_at.asc())
            .options(selectinload(FeedPostComment.author))
        )
        c_res = await self.session.execute(c_stmt)
        comments = list(c_res.scalars().all())

        items = [self._build_comment_read(c, actor) for c in comments]
        return FeedCommentListResponse(items=items, total=len(items))

    async def update_comment(
        self, actor: CurrentUser, post_id: uuid.UUID, comment_id: uuid.UUID, data: FeedCommentUpdate
    ) -> FeedCommentRead:
        """Update an existing comment. Only the author may edit."""
        content_clean = data.content.strip()
        if not content_clean:
            raise ValidationException("Comment content cannot be empty.")

        c_stmt = (
            select(FeedPostComment)
            .where(
                FeedPostComment.id == comment_id,
                FeedPostComment.post_id == post_id,
                FeedPostComment.deleted_at.is_(None),
            )
        )
        c_res = await self.session.execute(c_stmt)
        comment = c_res.scalar_one_or_none()
        if not comment:
            raise NotFoundException("Comment not found.")

        if comment.author_id != actor.id:
            raise ForbiddenException("You can only edit your own comment.")

        comment.content = content_clean
        comment.updated_at = datetime.now(timezone.utc)
        await self.session.commit()

        return self._build_comment_read(comment, actor)

    async def delete_comment(
        self, actor: CurrentUser, post_id: uuid.UUID, comment_id: uuid.UUID
    ) -> None:
        """Soft-delete a comment. Only the comment author can delete."""
        c_stmt = (
            select(FeedPostComment)
            .where(
                FeedPostComment.id == comment_id,
                FeedPostComment.post_id == post_id,
                FeedPostComment.deleted_at.is_(None),
            )
        )
        c_res = await self.session.execute(c_stmt)
        comment = c_res.scalar_one_or_none()
        if not comment:
            raise NotFoundException("Comment not found.")

        if comment.author_id != actor.id:
            raise ForbiddenException("You are not authorized to delete this comment.")

        comment.deleted_at = datetime.now(timezone.utc)
        await self.session.commit()

    async def toggle_reaction(
        self, actor: CurrentUser, post_id: uuid.UUID, data: FeedReactionToggle
    ) -> FeedReactionSummary:
        """Toggle a reaction on an announcement (LIKE, CELEBRATE, SUPPORT)."""
        rx_type = data.reaction_type.strip().upper()
        if rx_type not in (
            FeedReactionType.LIKE.value,
            FeedReactionType.CELEBRATE.value,
            FeedReactionType.SUPPORT.value,
        ):
            raise ValidationException(
                f"Invalid reaction type '{data.reaction_type}'. Must be LIKE, CELEBRATE, or SUPPORT."
            )

        stmt = (
            select(FeedPost)
            .where(FeedPost.id == post_id, FeedPost.deleted_at.is_(None))
            .options(
                selectinload(FeedPost.recipients),
                selectinload(FeedPost.targeted_departments),
            )
        )
        res = await self.session.execute(stmt)
        post = res.scalar_one_or_none()
        if not post:
            raise NotFoundException("Feed post not found.")

        if post.status != FeedPostStatus.PUBLISHED.value:
            raise BadRequestException("Cannot react to a draft or unpublished post.")

        if not await self._can_actor_view_post(actor, post):
            raise ForbiddenException("You do not have access to this announcement.")

        r_stmt = select(FeedPostReaction).where(
            FeedPostReaction.post_id == post_id, FeedPostReaction.user_id == actor.id
        )
        r_res = await self.session.execute(r_stmt)
        existing = r_res.scalar_one_or_none()

        if existing:
            if existing.reaction_type == rx_type:
                await self.session.delete(existing)
            else:
                existing.reaction_type = rx_type
        else:
            new_rx = FeedPostReaction(
                post_id=post_id,
                user_id=actor.id,
                reaction_type=rx_type,
            )
            self.session.add(new_rx)

        await self.session.commit()
        return await self.get_reactions_summary(post_id, actor.id)

    async def get_reactions_summary(
        self, post_id: uuid.UUID, user_id: uuid.UUID
    ) -> FeedReactionSummary:
        """Compute aggregated reaction counts and current user's reaction for a post."""
        stmt = (
            select(FeedPostReaction.reaction_type, func.count(FeedPostReaction.id))
            .where(FeedPostReaction.post_id == post_id)
            .group_by(FeedPostReaction.reaction_type)
        )
        res = await self.session.execute(stmt)
        counts_dict = dict(res.all())

        user_rx_stmt = select(FeedPostReaction.reaction_type).where(
            FeedPostReaction.post_id == post_id, FeedPostReaction.user_id == user_id
        )
        user_rx_res = await self.session.execute(user_rx_stmt)
        user_rx = user_rx_res.scalar_one_or_none()

        l_cnt = counts_dict.get(FeedReactionType.LIKE.value, 0)
        c_cnt = counts_dict.get(FeedReactionType.CELEBRATE.value, 0)
        s_cnt = counts_dict.get(FeedReactionType.SUPPORT.value, 0)

        return FeedReactionSummary(
            counts=FeedReactionCounts(
                like=l_cnt,
                celebrate=c_cnt,
                support=s_cnt,
                total=l_cnt + c_cnt + s_cnt,
            ),
            user_reaction=user_rx,
        )

    async def mark_as_read(self, actor: CurrentUser, post_id: uuid.UUID) -> dict[str, Any]:
        """Mark an announcement as read by the current user."""
        stmt = (
            select(FeedPost)
            .where(FeedPost.id == post_id, FeedPost.deleted_at.is_(None))
            .options(
                selectinload(FeedPost.recipients),
                selectinload(FeedPost.targeted_departments),
            )
        )
        res = await self.session.execute(stmt)
        post = res.scalar_one_or_none()
        if not post:
            raise NotFoundException("Feed post not found.")

        if post.status != FeedPostStatus.PUBLISHED.value:
            raise BadRequestException("Cannot track read status on a draft or unpublished post.")

        if not await self._can_actor_view_post(actor, post):
            raise ForbiddenException("You do not have access to this announcement.")

        chk_stmt = select(FeedPostReadRecord).where(
            FeedPostReadRecord.post_id == post_id, FeedPostReadRecord.user_id == actor.id
        )
        chk_res = await self.session.execute(chk_stmt)
        existing = chk_res.scalar_one_or_none()
        if not existing:
            read_rec = FeedPostReadRecord(post_id=post_id, user_id=actor.id)
            self.session.add(read_rec)
            try:
                await self.session.commit()
            except Exception:
                await self.session.rollback()

        return {"post_id": str(post_id), "is_read": True}

    async def get_readership(
        self, actor: CurrentUser, post_id: uuid.UUID
    ) -> FeedReadershipResponse:
        """
        Get announcement readership details.
        Strict privacy: Accessible only to the post author.
        """
        stmt = select(FeedPost).where(FeedPost.id == post_id, FeedPost.deleted_at.is_(None))
        res = await self.session.execute(stmt)
        post = res.scalar_one_or_none()
        if not post:
            raise NotFoundException("Feed post not found.")

        if post.author_id != actor.id:
            raise ForbiddenException(
                "Only the post author can view announcement readership."
            )

        r_stmt = (
            select(FeedPostReadRecord)
            .where(FeedPostReadRecord.post_id == post_id)
            .order_by(FeedPostReadRecord.read_at.desc())
            .options(selectinload(FeedPostReadRecord.user))
        )
        r_res = await self.session.execute(r_stmt)
        records = list(r_res.scalars().all())

        readers = [
            FeedReaderRead(
                user_id=r.user_id,
                display_name=r.user.display_name if r.user else None,
                full_name=r.user.full_name if r.user else "Unknown User",
                email=r.user.email if r.user else None,
                employee_code=r.user.employee_code if r.user else None,
                read_at=r.read_at,
            )
            for r in records
        ]

        return FeedReadershipResponse(
            post_id=post.id,
            total_readers=len(readers),
            readers=readers,
        )

    # ==========================================================================
    # Employee-to-Employee Direct Messaging Service Methods
    # ==========================================================================

    async def _get_users_department_map(self, user_ids: Sequence[uuid.UUID]) -> dict[uuid.UUID, str]:
        """Fetch primary department names for the given users."""
        if not user_ids:
            return {}
        clean_ids = [uid for uid in user_ids if uid is not None]
        if not clean_ids:
            return {}
        role_stmt = (
            select(UserRole.user_id, Role.name, UserRole.is_primary)
            .join(Role, (Role.id == UserRole.role_id) & (Role.deleted_at.is_(None)))
            .where(
                UserRole.user_id.in_(clean_ids),
                UserRole.status == RoleAssignmentStatus.ACTIVE,
            )
            .order_by(UserRole.is_primary.desc())
        )
        role_res = await self.session.execute(role_stmt)
        user_dept_map: dict[uuid.UUID, str] = {}
        for uid, rname, is_pri in role_res.all():
            if uid not in user_dept_map or is_pri:
                user_dept_map[uid] = rname
        return user_dept_map

    async def _build_conversation_read(
        self, conv: FeedConversation, current_user_id: uuid.UUID
    ) -> ConversationRead:
        """Convert a FeedConversation model into a ConversationRead schema."""
        user_ids = [p.user_id for p in (conv.participants or [])]
        dept_map = await self._get_users_department_map(user_ids)

        part_reads: list[ConversationParticipantRead] = []
        other_read: ConversationParticipantRead | None = None
        my_unread = 0

        for p in (conv.participants or []):
            u = p.user
            pread = ConversationParticipantRead(
                user_id=p.user_id,
                display_name=u.display_name if u else None,
                full_name=u.full_name if u else "Unknown Employee",
                email=u.email if u else None,
                employee_code=u.employee_code if u else None,
                department_name=dept_map.get(p.user_id),
                profile_picture_url=u.profile_picture_url if u else None,
                last_read_at=p.last_read_at,
                unread_count=p.unread_count,
            )
            part_reads.append(pread)
            if p.user_id != current_user_id:
                other_read = pread
            else:
                my_unread = p.unread_count

        return ConversationRead(
            id=conv.id,
            participants=part_reads,
            other_participant=other_read,
            last_message_at=conv.last_message_at,
            last_message_preview=conv.last_message_preview,
            last_message_sender_id=conv.last_message_sender_id,
            unread_count=my_unread,
            created_at=conv.created_at,
            updated_at=conv.updated_at,
        )

    async def get_or_create_conversation(
        self, actor: CurrentUser, recipient_id: uuid.UUID
    ) -> ConversationRead:
        """
        Start or retrieve a direct conversation between actor and recipient.
        Strictly enforces that self-conversations are prohibited and recipient must be an active employee.
        """
        if actor.id == recipient_id:
            raise BadRequestException("Cannot start a conversation with yourself.")

        recip_stmt = select(User).where(
            User.id == recipient_id,
            User.deleted_at.is_(None),
            User.status == UserStatus.ACTIVE,
        )
        recip_res = await self.session.execute(recip_stmt)
        recipient = recip_res.scalar_one_or_none()
        if not recipient:
            raise NotFoundException("Recipient employee not found or inactive.")

        # Find existing conversation with both participants
        p1 = select(FeedConversationParticipant.conversation_id).where(
            FeedConversationParticipant.user_id == actor.id
        )
        p2 = select(FeedConversationParticipant.conversation_id).where(
            FeedConversationParticipant.user_id == recipient_id
        )

        conv_stmt = (
            select(FeedConversation)
            .where(
                FeedConversation.id.in_(p1),
                FeedConversation.id.in_(p2),
                FeedConversation.deleted_at.is_(None),
            )
            .options(
                selectinload(FeedConversation.participants).selectinload(FeedConversationParticipant.user),
            )
        )
        conv_res = await self.session.execute(conv_stmt)
        conv = conv_res.scalar_one_or_none()

        if conv is not None:
            return await self._build_conversation_read(conv, actor.id)

        # Create new conversation
        now_utc = datetime.now(timezone.utc)
        new_conv = FeedConversation(
            id=uuid.uuid4(),
            last_message_at=None,
            last_message_preview=None,
            last_message_sender_id=None,
            created_at=now_utc,
            updated_at=now_utc,
        )
        self.session.add(new_conv)
        await self.session.flush()

        part_actor = FeedConversationParticipant(
            conversation_id=new_conv.id,
            user_id=actor.id,
            unread_count=0,
            created_at=now_utc,
        )
        part_recip = FeedConversationParticipant(
            conversation_id=new_conv.id,
            user_id=recipient_id,
            unread_count=0,
            created_at=now_utc,
        )
        self.session.add(part_actor)
        self.session.add(part_recip)
        await self.session.commit()

        # Reload with relationships
        reload_stmt = (
            select(FeedConversation)
            .where(FeedConversation.id == new_conv.id)
            .options(
                selectinload(FeedConversation.participants).selectinload(FeedConversationParticipant.user),
            )
        )
        reload_res = await self.session.execute(reload_stmt)
        loaded = reload_res.scalar_one()
        return await self._build_conversation_read(loaded, actor.id)

    async def list_conversations(self, actor: CurrentUser) -> ConversationListResponse:
        """
        List all direct conversations for the current employee.
        Private conversations are strictly confined to participants; other users and admins cannot view.
        """
        stmt = (
            select(FeedConversation)
            .join(FeedConversationParticipant, FeedConversationParticipant.conversation_id == FeedConversation.id)
            .where(
                FeedConversation.deleted_at.is_(None),
                FeedConversationParticipant.user_id == actor.id,
            )
            .order_by(FeedConversation.last_message_at.desc().nullslast(), FeedConversation.created_at.desc())
            .options(
                selectinload(FeedConversation.participants).selectinload(FeedConversationParticipant.user),
            )
        )
        res = await self.session.execute(stmt)
        convs = list(res.scalars().all())

        items = [await self._build_conversation_read(c, actor.id) for c in convs]
        return ConversationListResponse(items=items, total=len(items))

    async def get_conversation(
        self, actor: CurrentUser, conversation_id: uuid.UUID
    ) -> ConversationRead:
        """
        Get details of a specific conversation, strictly verifying participant membership.
        """
        stmt = (
            select(FeedConversation)
            .where(
                FeedConversation.id == conversation_id,
                FeedConversation.deleted_at.is_(None),
            )
            .options(
                selectinload(FeedConversation.participants).selectinload(FeedConversationParticipant.user),
            )
        )
        res = await self.session.execute(stmt)
        conv = res.scalar_one_or_none()

        if not conv:
            raise NotFoundException("Conversation not found.")

        is_participant = any(p.user_id == actor.id for p in (conv.participants or []))
        if not is_participant:
            raise ForbiddenException("You do not have access to this conversation.")

        return await self._build_conversation_read(conv, actor.id)

    async def list_messages(
        self, actor: CurrentUser, conversation_id: uuid.UUID, limit: int = 100
    ) -> DirectMessageListResponse:
        """
        List messages in a conversation.
        Verifies participant membership and automatically clears unread count for current user.
        """
        # Verify access
        part_stmt = select(FeedConversationParticipant).where(
            FeedConversationParticipant.conversation_id == conversation_id,
            FeedConversationParticipant.user_id == actor.id,
        )
        part_res = await self.session.execute(part_stmt)
        participant = part_res.scalar_one_or_none()

        if not participant:
            raise ForbiddenException("You do not have access to this conversation.")

        # Mark read
        now_utc = datetime.now(timezone.utc)
        participant.unread_count = 0
        participant.last_read_at = now_utc
        await self.session.commit()

        # Query messages
        msg_stmt = (
            select(FeedDirectMessage)
            .where(
                FeedDirectMessage.conversation_id == conversation_id,
                FeedDirectMessage.deleted_at.is_(None),
            )
            .order_by(FeedDirectMessage.created_at.asc())
            .limit(limit)
            .options(selectinload(FeedDirectMessage.sender))
        )
        msg_res = await self.session.execute(msg_stmt)
        messages = list(msg_res.scalars().all())

        items = [
            DirectMessageRead(
                id=m.id,
                conversation_id=m.conversation_id,
                sender_id=m.sender_id,
                sender=FeedAuthorRead(
                    id=m.sender.id,
                    display_name=m.sender.display_name,
                    full_name=m.sender.full_name,
                    email=m.sender.email,
                    employee_code=m.sender.employee_code,
                    profile_picture_url=m.sender.profile_picture_url,
                ),
                content=m.content,
                is_sender=(m.sender_id == actor.id),
                is_edited=(m.updated_at is not None and m.created_at is not None and m.updated_at > m.created_at),
                created_at=m.created_at,
                updated_at=m.updated_at,
            )
            for m in messages
        ]
        return DirectMessageListResponse(items=items, total=len(items))

    async def send_message(
        self, actor: CurrentUser, conversation_id: uuid.UUID, data: DirectMessageCreate
    ) -> DirectMessageRead:
        """
        Send a private message to a conversation.
        Updates unread counter and notifies other participant via system notification.
        """
        # Verify participant
        conv_stmt = (
            select(FeedConversation)
            .where(
                FeedConversation.id == conversation_id,
                FeedConversation.deleted_at.is_(None),
            )
            .options(
                selectinload(FeedConversation.participants),
            )
        )
        conv_res = await self.session.execute(conv_stmt)
        conv = conv_res.scalar_one_or_none()

        if not conv:
            raise NotFoundException("Conversation not found.")

        is_participant = any(p.user_id == actor.id for p in (conv.participants or []))
        if not is_participant:
            raise ForbiddenException("You do not have access to this conversation.")

        clean_content = data.content.strip()
        if not clean_content:
            raise ValidationException("Message content cannot be empty.")

        now_utc = datetime.now(timezone.utc)
        message = FeedDirectMessage(
            id=uuid.uuid4(),
            conversation_id=conversation_id,
            sender_id=actor.id,
            content=clean_content,
            created_at=now_utc,
        )
        self.session.add(message)

        # Update conversation preview and participant unread counts
        conv.last_message_at = now_utc
        conv.last_message_preview = clean_content[:150]
        conv.last_message_sender_id = actor.id
        conv.updated_at = now_utc

        recipient_ids_to_notify: list[uuid.UUID] = []
        for p in conv.participants:
            if p.user_id != actor.id:
                p.unread_count += 1
                recipient_ids_to_notify.append(p.user_id)

        await self.session.commit()

        # Send notification to intended recipient(s) without leaking message content
        notif_service = NotificationService(NotificationRepository(self.session))
        sender_name = (
            getattr(actor, "display_name", None)
            or getattr(actor, "full_name", None)
            or getattr(actor, "username", "A colleague")
        )
        conv_link = f"/feed?tab=messages&conversation_id={conversation_id}"

        for r_id in recipient_ids_to_notify:
            try:
                await notif_service.notify_user(
                    user_id=r_id,
                    type="feed_message",
                    title=f"New message from {sender_name}",
                    message=f"{sender_name} sent you a private message.",
                    link=conv_link,
                )
            except Exception:
                pass

        await self.session.commit()

        # Reload with sender
        m_stmt = (
            select(FeedDirectMessage)
            .where(FeedDirectMessage.id == message.id)
            .options(selectinload(FeedDirectMessage.sender))
        )
        m_res = await self.session.execute(m_stmt)
        m_loaded = m_res.scalar_one()

        return DirectMessageRead(
            id=m_loaded.id,
            conversation_id=m_loaded.conversation_id,
            sender_id=m_loaded.sender_id,
            sender=FeedAuthorRead(
                id=m_loaded.sender.id,
                display_name=m_loaded.sender.display_name,
                full_name=m_loaded.sender.full_name,
                email=m_loaded.sender.email,
                employee_code=m_loaded.sender.employee_code,
                profile_picture_url=m_loaded.sender.profile_picture_url,
            ),
            content=m_loaded.content,
            is_sender=True,
            is_edited=False,
            created_at=m_loaded.created_at,
            updated_at=m_loaded.updated_at,
        )

    async def update_message(
        self, actor: CurrentUser, message_id: uuid.UUID, data: DirectMessageUpdate
    ) -> DirectMessageRead:
        """
        Edit an existing message. Strictly verifies that only the sender can edit.
        """
        stmt = (
            select(FeedDirectMessage)
            .where(FeedDirectMessage.id == message_id, FeedDirectMessage.deleted_at.is_(None))
            .options(selectinload(FeedDirectMessage.sender))
        )
        res = await self.session.execute(stmt)
        msg = res.scalar_one_or_none()

        if not msg:
            raise NotFoundException("Message not found.")

        if msg.sender_id != actor.id:
            raise ForbiddenException("Only the sender can edit this message.")

        clean_content = data.content.strip()
        if not clean_content:
            raise ValidationException("Message content cannot be empty.")

        msg.content = clean_content
        msg.updated_at = datetime.now(timezone.utc)
        await self.session.commit()

        return DirectMessageRead(
            id=msg.id,
            conversation_id=msg.conversation_id,
            sender_id=msg.sender_id,
            sender=FeedAuthorRead(
                id=msg.sender.id,
                display_name=msg.sender.display_name,
                full_name=msg.sender.full_name,
                email=msg.sender.email,
                employee_code=msg.sender.employee_code,
                profile_picture_url=msg.sender.profile_picture_url,
            ),
            content=msg.content,
            is_sender=True,
            is_edited=True,
            created_at=msg.created_at,
            updated_at=msg.updated_at,
        )

    async def delete_message(self, actor: CurrentUser, message_id: uuid.UUID) -> None:
        """
        Soft-delete a message. Strictly verifies that only the sender can delete.
        """
        stmt = (
            select(FeedDirectMessage)
            .where(FeedDirectMessage.id == message_id, FeedDirectMessage.deleted_at.is_(None))
        )
        res = await self.session.execute(stmt)
        msg = res.scalar_one_or_none()

        if not msg:
            raise NotFoundException("Message not found.")

        if msg.sender_id != actor.id:
            raise ForbiddenException("Only the sender can delete this message.")

        msg.deleted_at = datetime.now(timezone.utc)
        await self.session.commit()

    async def mark_conversation_read(
        self, actor: CurrentUser, conversation_id: uuid.UUID
    ) -> None:
        """Mark a conversation as read and reset its unread counter for the current user."""
        stmt = select(FeedConversationParticipant).where(
            FeedConversationParticipant.conversation_id == conversation_id,
            FeedConversationParticipant.user_id == actor.id,
        )
        res = await self.session.execute(stmt)
        participant = res.scalar_one_or_none()

        if not participant:
            raise ForbiddenException("You do not have access to this conversation.")

        participant.unread_count = 0
        participant.last_read_at = datetime.now(timezone.utc)
        await self.session.commit()

    async def get_unread_messages_count(self, actor: CurrentUser) -> int:
        """Return the sum of unread direct messages across all conversations for the user."""
        stmt = (
            select(func.coalesce(func.sum(FeedConversationParticipant.unread_count), 0))
            .join(FeedConversation, FeedConversation.id == FeedConversationParticipant.conversation_id)
            .where(
                FeedConversationParticipant.user_id == actor.id,
                FeedConversation.deleted_at.is_(None),
            )
        )
        res = await self.session.execute(stmt)
        count = res.scalar() or 0
        return int(count)

