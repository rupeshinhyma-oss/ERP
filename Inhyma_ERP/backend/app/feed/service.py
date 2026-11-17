"""
Feed and Broadcast Messaging Service Layer.

Implements business logic, Feed RBAC enforcement, dynamic department audience
access control, explicit recipient isolation, bounded comment/post pagination,
concurrency-safe reactions and 1:1 direct messaging, deleted-content redaction,
and batched notification delivery.
"""

from __future__ import annotations

import math
import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Any, Sequence

from sqlalchemy import and_, delete, func, or_, select, text, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth.service import CurrentUser
from app.core.exceptions import (
    BadRequestException,
    ForbiddenException,
    NotFoundException,
    ValidationException,
)
from app.events.channels import user_channel
from app.events.dispatcher import EventDispatcher
from app.events.models import Event
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
from app.feed.rbac import (
    evaluate_feed_permission,
    extract_raw_permissions,
    load_explicit_feed_denies,
)
from app.feed.schemas import (
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
    MAX_DIRECT_MESSAGE_LENGTH,
    MAX_FEED_COMMENT_LENGTH,
    MAX_FEED_POST_CONTENT_LENGTH,
)
from app.notifications.models import Notification
from app.rbac.models import Permission, Role, RoleAssignmentStatus, RolePermission, UserPermission, UserRole
from app.users.models import User, UserStatus


def _canonical_pair(u1: uuid.UUID, u2: uuid.UUID) -> tuple[uuid.UUID, uuid.UUID]:
    """Return deterministic ordered `(low_id, high_id)` matching PostgreSQL `MIN(uuid::text)`/`MAX(uuid::text)`."""
    return (u1, u2) if str(u1) < str(u2) else (u2, u1)


class FeedService:
    """Service providing Feed, Broadcast, Interaction, and Direct Messaging operations."""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self._rbac_cache: dict[uuid.UUID, tuple[set[str], set[str]]] = {}

    # ==========================================================================
    # RBAC, Eligibility & PostgreSQL Concurrency Primitives
    # ==========================================================================

    def _is_real_db_session(self) -> bool:
        return isinstance(self.session, AsyncSession)

    async def _get_actor_rbac(self, actor: CurrentUser) -> tuple[set[str], set[str]]:
        cached = self._rbac_cache.get(actor.id)
        if cached is not None:
            return cached
        raw_perms = extract_raw_permissions(actor)
        denies = await load_explicit_feed_denies(
            self.session if self._is_real_db_session() else None,
            actor.id,
            raw_perms,
        )
        state = (raw_perms, denies)
        self._rbac_cache[actor.id] = state
        return state

    async def _has_permission(self, actor: CurrentUser, code: str) -> bool:
        raw_perms, denies = await self._get_actor_rbac(actor)
        return evaluate_feed_permission(raw_perms, denies, code)

    async def _require_permission(self, actor: CurrentUser, code: str) -> None:
        if not self._is_real_db_session() and not actor.permissions:
            return
        if not await self._has_permission(actor, code):
            raise ForbiddenException(
                f"Permission denied. This action requires the {code!r} permission."
            )

    async def _require_any_permission(self, actor: CurrentUser, *codes: str) -> None:
        if not self._is_real_db_session() and not actor.permissions:
            return
        for c in codes:
            if await self._has_permission(actor, c):
                return
        joined = " or ".join(repr(c) for c in codes)
        raise ForbiddenException(f"Permission denied. This action requires {joined}.")

    @staticmethod
    def _eligible_user_clauses() -> tuple[Any, ...]:
        """Require active, non-deleted ERP accounts with login access enabled."""
        return (
            User.deleted_at.is_(None),
            User.status == UserStatus.ACTIVE,
            User.is_active.is_(True),
            User.has_login.is_(True),
        )

    @staticmethod
    def _active_user_role_clauses(ref_date: date | None = None) -> tuple[Any, ...]:
        """Require active UserRole assignment within effective date bounds."""
        today = ref_date or date.today()
        return (
            UserRole.status == RoleAssignmentStatus.ACTIVE,
            or_(UserRole.effective_from.is_(None), UserRole.effective_from <= today),
            or_(UserRole.effective_to.is_(None), UserRole.effective_to >= today),
        )

    async def _pg_advisory_xact_lock(self, lock_key: str) -> None:
        """Acquire a PostgreSQL transaction-scoped advisory lock when running on PostgreSQL."""
        if not self._is_real_db_session():
            return
        bind = self.session.get_bind()
        if bind is not None and bind.dialect.name == "postgresql":
            await self.session.execute(
                text("SELECT pg_advisory_xact_lock(hashtext(:k))"),
                {"k": lock_key},
            )

    async def _filter_users_with_feed_view(self, candidate_ids: set[uuid.UUID]) -> set[uuid.UUID]:
        """
        Batch-filter ``candidate_ids`` in SQL to active login users who hold ``feed.view``
        (via role grant, direct grant, ``feed.manage``, or ``super_admin``) and do NOT
        have an explicit ``UserPermission(is_granted=False)`` on ``feed.view``.
        """
        if not candidate_ids or not self._is_real_db_session():
            return set()

        eligible_stmt = select(User.id).where(
            User.id.in_(candidate_ids),
            *self._eligible_user_clauses(),
        )
        eligible_ids = set((await self.session.execute(eligible_stmt)).scalars().all())
        if not eligible_ids:
            return set()

        # Exclude explicit per-user denies on feed.view
        deny_stmt = (
            select(UserPermission.user_id)
            .join(Permission, Permission.id == UserPermission.permission_id)
            .where(
                UserPermission.user_id.in_(eligible_ids),
                UserPermission.is_granted.is_(False),
                Permission.code == "feed.view",
            )
        )
        denied_ids = set((await self.session.execute(deny_stmt)).scalars().all())
        remaining_ids = eligible_ids - denied_ids
        if not remaining_ids:
            return set()

        active_role_clauses = self._active_user_role_clauses()

        # 1. Granted via RolePermission (feed.view or feed.manage) or super_admin/admin system role
        role_grant_stmt = (
            select(UserRole.user_id)
            .join(Role, (Role.id == UserRole.role_id) & (Role.deleted_at.is_(None)))
            .outerjoin(RolePermission, RolePermission.role_id == Role.id)
            .outerjoin(Permission, Permission.id == RolePermission.permission_id)
            .where(
                UserRole.user_id.in_(remaining_ids),
                *active_role_clauses,
                or_(
                    Role.name.in_(["super_admin", "admin"]),
                    Permission.code.in_(["feed.view", "feed.manage", "feed.read"]),
                ),
            )
            .distinct()
        )
        granted_ids = set((await self.session.execute(role_grant_stmt)).scalars().all())

        # 2. Granted via direct UserPermission(is_granted=True)
        still_unchecked = remaining_ids - granted_ids
        if still_unchecked:
            direct_grant_stmt = (
                select(UserPermission.user_id)
                .join(Permission, Permission.id == UserPermission.permission_id)
                .where(
                    UserPermission.user_id.in_(still_unchecked),
                    UserPermission.is_granted.is_(True),
                    Permission.code.in_(["feed.view", "feed.manage", "feed.read"]),
                )
            )
            granted_ids.update((await self.session.execute(direct_grant_stmt)).scalars().all())

        return granted_ids

    # ==========================================================================
    # Audience Visibility & Dynamic Department Resolution
    # ==========================================================================

    async def _can_actor_view_post(self, actor: CurrentUser, post: FeedPost) -> bool:
        """
        Check whether ``actor`` is authorized to view ``post`` right now.
        - Soft-deleted posts: never accessible (`False`).
        - Drafts: strictly author-only.
        - Published ALL: any eligible Feed user.
        - Published SELECTED: author, explicitly selected recipient (`is_explicit=True`),
          or current active member of a targeted department (`FeedPostDepartment` + `UserRole`).
        - Administrators have NO read bypass for private targeted posts or other users' drafts.
        """
        if post.deleted_at is not None:
            return False

        _, denies = await self._get_actor_rbac(actor)
        if "feed.view" in denies:
            return False

        if post.author_id == actor.id:
            return True

        if post.status != FeedPostStatus.PUBLISHED.value:
            return False

        if post.audience_type == FeedAudienceType.ALL.value:
            return True

        if post.audience_type == FeedAudienceType.SELECTED.value:
            # 1. Explicit individual recipient check (`is_explicit=True` only)
            explicit_ids = {
                r.recipient_id
                for r in (post.recipients or [])
                if getattr(r, "is_explicit", True)
            }
            if actor.id in explicit_ids:
                return True

            # 2. Dynamic current department membership check
            dept_ids = {d.department_id for d in (post.targeted_departments or [])}
            if dept_ids and self._is_real_db_session():
                dept_stmt = (
                    select(UserRole.id)
                    .join(Role, (Role.id == UserRole.role_id) & (Role.deleted_at.is_(None)))
                    .where(
                        UserRole.user_id == actor.id,
                        UserRole.role_id.in_(dept_ids),
                        *self._active_user_role_clauses(),
                    )
                    .limit(1)
                )
                res = await self.session.execute(dept_stmt)
                if res.scalar_one_or_none() is not None:
                    return True

        return False

    async def _resolve_current_authorized_audience_ids(self, post: FeedPost) -> set[uuid.UUID]:
        """
        Resolve the live set of eligible, ``feed.view``-authorized user IDs for ``post``
        (excluding ``post.author_id``), reflecting current department memberships.
        """
        if post.deleted_at is not None or post.status != FeedPostStatus.PUBLISHED.value:
            return set()

        candidate_ids: set[uuid.UUID] = set()
        if post.audience_type == FeedAudienceType.ALL.value:
            stmt = select(User.id).where(
                User.id != post.author_id,
                *self._eligible_user_clauses(),
            )
            candidate_ids = set((await self.session.execute(stmt)).scalars().all())
        else:
            # 1. Explicit individual recipients (`is_explicit=True`)
            exp_stmt = (
                select(FeedPostRecipient.recipient_id)
                .join(User, User.id == FeedPostRecipient.recipient_id)
                .where(
                    FeedPostRecipient.post_id == post.id,
                    FeedPostRecipient.is_explicit.is_(True),
                    FeedPostRecipient.recipient_id != post.author_id,
                    *self._eligible_user_clauses(),
                )
            )
            candidate_ids.update((await self.session.execute(exp_stmt)).scalars().all())

            # 2. Current active members of targeted departments
            dept_stmt = (
                select(UserRole.user_id)
                .join(FeedPostDepartment, FeedPostDepartment.department_id == UserRole.role_id)
                .join(Role, (Role.id == UserRole.role_id) & (Role.deleted_at.is_(None)))
                .join(User, User.id == UserRole.user_id)
                .where(
                    FeedPostDepartment.post_id == post.id,
                    UserRole.user_id != post.author_id,
                    *self._active_user_role_clauses(),
                    *self._eligible_user_clauses(),
                )
            )
            candidate_ids.update((await self.session.execute(dept_stmt)).scalars().all())

        return await self._filter_users_with_feed_view(candidate_ids)

    async def _resolve_targeted_audience(
        self,
        department_ids: Sequence[uuid.UUID] | None,
        recipient_ids: Sequence[uuid.UUID] | None,
    ) -> tuple[list[Role], list[User], list[User]]:
        """
        Validate targeted departments and explicitly selected employees separately.

        Returns ``(validated_departments, explicit_users, union_eligible_users)``.
        Only ``explicit_users`` are persisted in ``feed_post_recipients`` (`is_explicit=True`).
        """
        dept_ids_clean = [d for d in (department_ids or []) if d is not None]
        rec_ids_clean = [r for r in (recipient_ids or []) if r is not None]

        if not dept_ids_clean and not rec_ids_clean:
            raise ValidationException(
                "Selected audience posts must specify at least one department or recipient employee."
            )

        validated_departments: list[Role] = []
        dept_users: list[User] = []
        if dept_ids_clean:
            unique_dept_ids = list(dict.fromkeys(dept_ids_clean))
            dept_stmt = select(Role).where(
                Role.id.in_(unique_dept_ids),
                Role.deleted_at.is_(None),
                Role.is_system.is_(False),
            )
            dept_res = await self.session.execute(dept_stmt)
            found_depts = list(dept_res.scalars().all())
            found_dept_ids = {d.id for d in found_depts}
            missing_depts = [str(did) for did in unique_dept_ids if did not in found_dept_ids]
            if missing_depts:
                raise ValidationException(
                    f"The following department IDs are invalid, system-only, or do not exist: {', '.join(missing_depts)}"
                )
            validated_departments = found_depts

            user_stmt = (
                select(User)
                .join(UserRole, UserRole.user_id == User.id)
                .where(
                    UserRole.role_id.in_(unique_dept_ids),
                    *self._active_user_role_clauses(),
                    *self._eligible_user_clauses(),
                )
                .distinct()
            )
            user_res = await self.session.execute(user_stmt)
            dept_users = list(user_res.scalars().all())

        validated_indiv_users: list[User] = []
        if rec_ids_clean:
            unique_rec_ids = list(dict.fromkeys(rec_ids_clean))
            rec_stmt = select(User).where(
                User.id.in_(unique_rec_ids),
                *self._eligible_user_clauses(),
            )
            rec_res = await self.session.execute(rec_stmt)
            found_rec_users = list(rec_res.scalars().all())
            found_rec_ids = {u.id for u in found_rec_users}
            missing_recs = [str(uid) for uid in unique_rec_ids if uid not in found_rec_ids]
            if missing_recs:
                raise ValidationException(
                    f"The following recipient IDs are invalid, inactive, lack ERP login access, or do not exist: {', '.join(missing_recs)}"
                )
            validated_indiv_users = found_rec_users

        union_dict: dict[uuid.UUID, User] = {u.id: u for u in dept_users}
        for u in validated_indiv_users:
            union_dict[u.id] = u

        union_users = list(union_dict.values())
        if not union_users:
            raise ValidationException(
                "The selected audience resolves to zero active eligible employees with login access."
            )

        return validated_departments, validated_indiv_users, union_users

    # ==========================================================================
    # Presentation & Metadata Builders
    # ==========================================================================

    def _can_actor_edit_post(
        self, post: FeedPost, actor: CurrentUser, raw_perms: set[str], denies: set[str]
    ) -> bool:
        if post.deleted_at is not None or post.author_id != actor.id:
            return False
        return evaluate_feed_permission(raw_perms, denies, "feed.create")

    def _can_actor_delete_post(
        self, post: FeedPost, actor: CurrentUser, raw_perms: set[str], denies: set[str]
    ) -> bool:
        if post.deleted_at is not None:
            return False
        if post.author_id == actor.id:
            return evaluate_feed_permission(raw_perms, denies, "feed.create") or evaluate_feed_permission(
                raw_perms, denies, "feed.manage"
            )
        if post.status == FeedPostStatus.PUBLISHED.value:
            return evaluate_feed_permission(raw_perms, denies, "feed.manage")
        return False

    def _can_actor_delete_comment(
        self, comment: FeedPostComment, actor: CurrentUser, raw_perms: set[str], denies: set[str]
    ) -> bool:
        if comment.deleted_at is not None:
            return False
        if comment.author_id == actor.id:
            return evaluate_feed_permission(raw_perms, denies, "feed.create") or evaluate_feed_permission(
                raw_perms, denies, "feed.manage"
            )
        return evaluate_feed_permission(raw_perms, denies, "feed.manage")

    def _build_post_read(
        self,
        post: FeedPost,
        actor: CurrentUser,
        raw_perms: set[str],
        denies: set[str],
        dept_map: dict[uuid.UUID, str] | None = None,
    ) -> FeedPostRead:
        """Convert a FeedPost ORM object into a FeedPostRead DTO."""
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
            if d.department is not None and d.department.deleted_at is None
        ]

        explicit_recs = [
            r
            for r in (post.recipients or [])
            if getattr(r, "is_explicit", True) and r.recipient is not None
        ]
        recipients_read = (
            [
                FeedRecipientRead(
                    id=r.id,
                    recipient_id=r.recipient.id,
                    display_name=r.recipient.display_name,
                    full_name=r.recipient.full_name,
                    email=r.recipient.email,
                    employee_code=r.recipient.employee_code,
                    department_name=(dept_map or {}).get(r.recipient.id),
                )
                for r in explicit_recs
            ]
            if post.author_id == actor.id
            else []
        )

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
            is_author=(post.author_id == actor.id),
            can_edit=self._can_actor_edit_post(post, actor, raw_perms, denies),
            can_delete=self._can_actor_delete_post(post, actor, raw_perms, denies),
            comments_count=0,
            reactions_summary=FeedReactionSummary(),
            is_read=(post.author_id == actor.id),
            read_count=None,
        )

    async def _populate_posts_metadata(
        self, post_reads: list[FeedPostRead], actor_id: uuid.UUID
    ) -> None:
        """Enrich FeedPostRead items in batch with comment counts, reactions, and read status."""
        if not post_reads:
            return

        post_ids = [p.id for p in post_reads]

        c_stmt = (
            select(FeedPostComment.post_id, func.count(FeedPostComment.id))
            .where(FeedPostComment.post_id.in_(post_ids), FeedPostComment.deleted_at.is_(None))
            .group_by(FeedPostComment.post_id)
        )
        comments_map: dict[uuid.UUID, int] = dict((await self.session.execute(c_stmt)).all())

        r_stmt = (
            select(FeedPostReaction.post_id, FeedPostReaction.reaction_type, func.count(FeedPostReaction.id))
            .where(FeedPostReaction.post_id.in_(post_ids))
            .group_by(FeedPostReaction.post_id, FeedPostReaction.reaction_type)
        )
        reactions_map: dict[uuid.UUID, dict[str, int]] = {}
        for pid, rx_type, count in (await self.session.execute(r_stmt)).all():
            reactions_map.setdefault(pid, {})[rx_type] = count

        ur_stmt = select(FeedPostReaction.post_id, FeedPostReaction.reaction_type).where(
            FeedPostReaction.post_id.in_(post_ids), FeedPostReaction.user_id == actor_id
        )
        user_reactions_map: dict[uuid.UUID, str] = dict((await self.session.execute(ur_stmt)).all())

        rd_stmt = select(FeedPostReadRecord.post_id).where(
            FeedPostReadRecord.post_id.in_(post_ids), FeedPostReadRecord.user_id == actor_id
        )
        read_post_ids = set((await self.session.execute(rd_stmt)).scalars().all())

        eligible_read_count_posts = [p.id for p in post_reads if p.author_id == actor_id]
        read_counts_map: dict[uuid.UUID, int] = {}
        if eligible_read_count_posts:
            rc_stmt = (
                select(FeedPostReadRecord.post_id, func.count(FeedPostReadRecord.id))
                .where(FeedPostReadRecord.post_id.in_(eligible_read_count_posts))
                .group_by(FeedPostReadRecord.post_id)
            )
            read_counts_map = dict((await self.session.execute(rc_stmt)).all())

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
            p.is_read = (p.author_id == actor_id) or (p.id in read_post_ids)
            p.read_count = read_counts_map.get(p.id, 0) if p.author_id == actor_id else None

    # ==========================================================================
    # Batched Notification Delivery & Redaction Helpers
    # ==========================================================================

    async def _batch_create_notifications(
        self,
        *,
        user_ids: Sequence[uuid.UUID],
        notif_type: str,
        title: str,
        message: str,
        link: str,
        deduplicate_hours: int | None = None,
    ) -> int:
        """
        Insert Notification rows in batched SQL statements without N+1 per-recipient queries,
        then publish best-effort WebSocket events.
        """
        if not user_ids or not self._is_real_db_session():
            return 0

        unique_ids = set(user_ids)
        if deduplicate_hours is not None and deduplicate_hours > 0:
            since = datetime.now(timezone.utc) - timedelta(hours=deduplicate_hours)
            existing_stmt = select(Notification.user_id).where(
                Notification.user_id.in_(unique_ids),
                Notification.type == notif_type,
                Notification.link == link,
                Notification.created_at >= since,
            )
            already = set((await self.session.execute(existing_stmt)).scalars().all())
            unique_ids -= already

        if not unique_ids:
            return 0

        ordered_ids = sorted(unique_ids, key=str)
        created_notifs: list[Notification] = []
        chunk_size = 500
        for start in range(0, len(ordered_ids), chunk_size):
            batch = [
                Notification(
                    user_id=uid,
                    type=notif_type,
                    title=title,
                    message=message,
                    link=link,
                    is_read=False,
                )
                for uid in ordered_ids[start : start + chunk_size]
            ]
            self.session.add_all(batch)
            created_notifs.extend(batch)

        await self.session.flush()
        await self.session.commit()

        dispatcher = EventDispatcher()
        for notif in created_notifs:
            try:
                ev = Event(
                    event_type="NOTIFICATION_RECEIVED",
                    entity="notification",
                    entity_id=str(notif.id),
                    changes={
                        "id": str(notif.id),
                        "type": notif.type,
                        "title": notif.title,
                        "message": notif.message,
                        "link": notif.link,
                        "created_at": notif.created_at.isoformat() if notif.created_at else None,
                    },
                )
                await dispatcher.publish(user_channel(notif.user_id), ev)
            except Exception:
                pass

        return len(created_notifs)

    async def _redact_post_notifications(
        self,
        post_id: uuid.UUID,
        *,
        only_outside_user_ids: set[uuid.UUID] | None = None,
    ) -> None:
        """
        Sanitize stored Notification payloads when a post is soft-deleted or when
        audience changes revoke a recipient's access, preventing plaintext leakage.
        """
        if not self._is_real_db_session():
            return
        post_link = f"/feed?post_id={post_id}"
        if only_outside_user_ids is None:
            stmt = (
                update(Notification)
                .where(
                    Notification.link == post_link,
                    Notification.type.in_(["feed_announcement", "feed_comment", "feed_discussion"]),
                )
                .values(
                    title="Announcement removed",
                    message="This announcement has been removed and is no longer available.",
                )
            )
        else:
            stmt = (
                update(Notification)
                .where(
                    Notification.link == post_link,
                    Notification.type.in_(["feed_announcement", "feed_comment", "feed_discussion"]),
                    Notification.user_id.notin_(only_outside_user_ids),
                )
                .values(
                    title="Announcement unavailable",
                    message="You no longer have access to this announcement.",
                )
            )
        await self.session.execute(stmt)

    async def _notify_post_publication(self, post: FeedPost) -> None:
        """Send batched deduplicated notifications to currently authorized recipients."""
        if post.deleted_at is not None or post.status != FeedPostStatus.PUBLISHED.value:
            return
        try:
            target_user_ids = await self._resolve_current_authorized_audience_ids(post)
            if not target_user_ids:
                return
            post_link = f"/feed?post_id={post.id}"
            title = f"Announcement: {post.title}" if post.title else "New Company Announcement"
            snippet = post.content[:120] + ("..." if len(post.content) > 120 else "")
            await self._batch_create_notifications(
                user_ids=list(target_user_ids),
                notif_type="feed_announcement",
                title=title,
                message=snippet,
                link=post_link,
                deduplicate_hours=24,
            )
        except Exception:
            await self.session.rollback()

    async def _notify_comment_added(
        self,
        post: FeedPost,
        comment_content: str,
        commenter: CurrentUser,
    ) -> None:
        """Notify post author and currently authorized discussion participants in batch."""
        if post.deleted_at is not None or post.status != FeedPostStatus.PUBLISHED.value:
            return
        try:
            post_link = f"/feed?post_id={post.id}"
            commenter_name = (
                getattr(commenter, "display_name", None)
                or getattr(commenter, "full_name", None)
                or getattr(commenter, "username", None)
                or "A colleague"
            )
            snippet = comment_content[:100] + ("..." if len(comment_content) > 100 else "")

            # 1. Notify post author (if eligible and not commenting on own post)
            if post.author_id != commenter.id:
                author_ok = await self._filter_users_with_feed_view({post.author_id})
                if author_ok:
                    await self._batch_create_notifications(
                        user_ids=list(author_ok),
                        notif_type="feed_comment",
                        title=f"{commenter_name} commented on your announcement",
                        message=f'"{snippet}"',
                        link=post_link,
                    )

            # 2. Notify previous commenters who STILL currently have access to the post
            prev_stmt = (
                select(FeedPostComment.author_id)
                .where(
                    FeedPostComment.post_id == post.id,
                    FeedPostComment.deleted_at.is_(None),
                    FeedPostComment.author_id != commenter.id,
                    FeedPostComment.author_id != post.author_id,
                )
                .distinct()
            )
            prev_commenters = set((await self.session.execute(prev_stmt)).scalars().all())
            if not prev_commenters:
                return

            authorized_audience = await self._resolve_current_authorized_audience_ids(post)
            valid_prev = prev_commenters.intersection(authorized_audience)
            if valid_prev:
                await self._batch_create_notifications(
                    user_ids=list(valid_prev),
                    notif_type="feed_discussion",
                    title=f"New reply on announcement: {post.title or 'Broadcast'}",
                    message=f'{commenter_name}: "{snippet}"',
                    link=post_link,
                )
        except Exception:
            await self.session.rollback()

    # ==========================================================================
    # Posts CRUD & Read Operations
    # ==========================================================================

    async def _load_post_read_internal(self, actor: CurrentUser, post_id: uuid.UUID) -> FeedPostRead:
        stmt = (
            select(FeedPost)
            .where(FeedPost.id == post_id, FeedPost.deleted_at.is_(None))
            .options(
                selectinload(FeedPost.author),
                selectinload(FeedPost.recipients).selectinload(FeedPostRecipient.recipient),
                selectinload(FeedPost.targeted_departments).selectinload(FeedPostDepartment.department),
            )
        )
        post = (await self.session.execute(stmt)).scalar_one_or_none()
        if not post:
            raise NotFoundException("Feed post not found.")

        raw_perms, denies = await self._get_actor_rbac(actor)
        rec_uids = [
            r.recipient_id
            for r in (post.recipients or [])
            if getattr(r, "is_explicit", True)
        ]
        dept_map = await self._get_users_department_map(rec_uids) if post.author_id == actor.id else {}
        post_read = self._build_post_read(post, actor, raw_perms, denies, dept_map=dept_map)
        await self._populate_posts_metadata([post_read], actor.id)
        return post_read

    async def create_post(self, actor: CurrentUser, data: FeedPostCreate) -> FeedPostRead:
        """Create a draft or published announcement with strict explicit vs department separation."""
        content_clean = data.content.strip() if data.content else ""
        if not content_clean:
            raise ValidationException("Post content cannot be empty.")
        if len(data.content) > MAX_FEED_POST_CONTENT_LENGTH:
            raise ValidationException(
                f"Post content must not exceed {MAX_FEED_POST_CONTENT_LENGTH:,} characters."
            )

        await self._require_permission(actor, "feed.create")

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

        if audience_type == FeedAudienceType.SELECTED.value:
            validated_depts, explicit_users, _ = await self._resolve_targeted_audience(
                department_ids=data.department_ids,
                recipient_ids=data.recipient_ids,
            )
            for dept in validated_depts:
                self.session.add(FeedPostDepartment(post_id=post.id, department_id=dept.id))
            for recipient in explicit_users:
                self.session.add(
                    FeedPostRecipient(
                        post_id=post.id,
                        recipient_id=recipient.id,
                        is_explicit=True,
                    )
                )
            await self.session.flush()

        await self.session.commit()

        if post.status == FeedPostStatus.PUBLISHED.value:
            await self._notify_post_publication(post)

        return await self._load_post_read_internal(actor, post.id)

    async def list_posts(
        self,
        actor: CurrentUser,
        page: int = 1,
        page_size: int = 20,
        status: str | None = None,
        search: str | None = None,
    ) -> FeedPostListResponse:
        """Retrieve paginated accessible feed posts with dynamic department membership enforcement."""
        if page < 1:
            raise ValidationException("Page number must be at least 1.")
        if page_size < 1 or page_size > 100:
            page_size = 20

        await self._require_permission(actor, "feed.view")
        raw_perms, denies = await self._get_actor_rbac(actor)

        base_conditions = [FeedPost.deleted_at.is_(None)]

        if search and search.strip():
            term = f"%{search.strip()}%"
            base_conditions.append(or_(FeedPost.title.ilike(term), FeedPost.content.ilike(term)))

        explicit_recipient_subquery = select(FeedPostRecipient.post_id).where(
            FeedPostRecipient.recipient_id == actor.id,
            FeedPostRecipient.is_explicit.is_(True),
        )

        dept_subquery = (
            select(FeedPostDepartment.post_id)
            .join(Role, (Role.id == FeedPostDepartment.department_id) & (Role.deleted_at.is_(None)))
            .join(UserRole, UserRole.role_id == Role.id)
            .where(
                UserRole.user_id == actor.id,
                *self._active_user_role_clauses(),
            )
        )

        published_visible = (FeedPost.status == FeedPostStatus.PUBLISHED.value) & (
            (FeedPost.audience_type == FeedAudienceType.ALL.value)
            | (FeedPost.author_id == actor.id)
            | (FeedPost.id.in_(explicit_recipient_subquery))
            | (FeedPost.id.in_(dept_subquery))
        )

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

        count_stmt = select(func.count(FeedPost.id)).where(*base_conditions)
        total = int((await self.session.execute(count_stmt)).scalar_one() or 0)
        total_pages = math.ceil(total / page_size) if total > 0 else 1

        items_stmt = (
            select(FeedPost)
            .where(*base_conditions)
            .order_by(
                FeedPost.published_at.desc().nullslast(),
                FeedPost.created_at.desc(),
                FeedPost.id.desc(),
            )
            .offset((page - 1) * page_size)
            .limit(page_size)
            .options(
                selectinload(FeedPost.author),
                selectinload(FeedPost.recipients).selectinload(FeedPostRecipient.recipient),
                selectinload(FeedPost.targeted_departments).selectinload(FeedPostDepartment.department),
            )
        )
        posts = list((await self.session.execute(items_stmt)).scalars().all())

        authored_rec_uids: list[uuid.UUID] = []
        for p in posts:
            if p.author_id == actor.id:
                for r in (p.recipients or []):
                    if getattr(r, "is_explicit", True):
                        authored_rec_uids.append(r.recipient_id)
        dept_map = await self._get_users_department_map(authored_rec_uids) if authored_rec_uids else {}

        items_read = [
            self._build_post_read(p, actor, raw_perms, denies, dept_map=dept_map)
            for p in posts
        ]
        await self._populate_posts_metadata(items_read, actor.id)

        return FeedPostListResponse(
            items=items_read,
            total=total,
            page=page,
            page_size=page_size,
            total_pages=total_pages,
        )

    async def get_post_by_id(self, actor: CurrentUser, post_id: uuid.UUID) -> FeedPostRead:
        """Retrieve a single post after verifying `feed.view` and object-level audience access."""
        await self._require_permission(actor, "feed.view")

        stmt = (
            select(FeedPost)
            .where(FeedPost.id == post_id, FeedPost.deleted_at.is_(None))
            .options(
                selectinload(FeedPost.author),
                selectinload(FeedPost.recipients).selectinload(FeedPostRecipient.recipient),
                selectinload(FeedPost.targeted_departments).selectinload(FeedPostDepartment.department),
            )
        )
        post = (await self.session.execute(stmt)).scalar_one_or_none()
        if not post:
            raise NotFoundException("Feed post not found.")

        if not await self._can_actor_view_post(actor, post):
            raise ForbiddenException("You do not have access to this post.")

        raw_perms, denies = await self._get_actor_rbac(actor)
        rec_uids = [
            r.recipient_id
            for r in (post.recipients or [])
            if getattr(r, "is_explicit", True)
        ]
        dept_map = await self._get_users_department_map(rec_uids) if post.author_id == actor.id else {}
        post_read = self._build_post_read(post, actor, raw_perms, denies, dept_map=dept_map)
        await self._populate_posts_metadata([post_read], actor.id)
        return post_read

    async def update_post(
        self, actor: CurrentUser, post_id: uuid.UUID, data: FeedPostUpdate
    ) -> FeedPostRead:
        """Update own post details, explicit recipients, departments, or publication state."""
        if data.content is not None:
            content_clean = data.content.strip()
            if not content_clean:
                raise ValidationException("Post content cannot be empty.")
            if len(data.content) > MAX_FEED_POST_CONTENT_LENGTH:
                raise ValidationException(
                    f"Post content must not exceed {MAX_FEED_POST_CONTENT_LENGTH:,} characters."
                )

        await self._require_permission(actor, "feed.create")

        stmt = (
            select(FeedPost)
            .where(FeedPost.id == post_id, FeedPost.deleted_at.is_(None))
            .options(
                selectinload(FeedPost.author),
                selectinload(FeedPost.recipients).selectinload(FeedPostRecipient.recipient),
                selectinload(FeedPost.targeted_departments).selectinload(FeedPostDepartment.department),
            )
        )
        post = (await self.session.execute(stmt)).scalar_one_or_none()
        if not post:
            raise NotFoundException("Feed post not found.")

        if post.author_id != actor.id:
            raise ForbiddenException("Only the author can edit this post.")

        prev_status = post.status
        prev_audience = post.audience_type

        if data.title is not None:
            post.title = data.title.strip() if data.title.strip() else None

        if data.content is not None:
            post.content = data.content.strip()

        now_utc = datetime.now(timezone.utc)
        if data.status is not None:
            new_status = data.status.value if isinstance(data.status, FeedPostStatus) else data.status
            if new_status == FeedPostStatus.PUBLISHED.value and post.published_at is None:
                post.published_at = now_utc
            post.status = new_status

        target_audience = (
            data.audience_type.value
            if isinstance(data.audience_type, FeedAudienceType)
            else (data.audience_type or post.audience_type)
        )
        audience_modified = False

        if data.audience_type is not None and target_audience != prev_audience:
            post.audience_type = target_audience
            audience_modified = True

        if target_audience == FeedAudienceType.ALL.value:
            if prev_audience != FeedAudienceType.ALL.value or data.department_ids is not None or data.recipient_ids is not None:
                await self.session.execute(
                    delete(FeedPostRecipient).where(FeedPostRecipient.post_id == post.id)
                )
                await self.session.execute(
                    delete(FeedPostDepartment).where(FeedPostDepartment.post_id == post.id)
                )
        elif (
            data.department_ids is not None
            or data.recipient_ids is not None
            or (
                data.audience_type == FeedAudienceType.SELECTED
                and not any(getattr(r, "is_explicit", True) for r in post.recipients)
                and not post.targeted_departments
            )
        ):
            audience_modified = True
            depts_to_resolve = (
                data.department_ids
                if data.department_ids is not None
                else [d.department_id for d in post.targeted_departments]
            )
            recs_to_resolve = (
                data.recipient_ids
                if data.recipient_ids is not None
                else [r.recipient_id for r in post.recipients if getattr(r, "is_explicit", True)]
            )

            validated_depts, explicit_users, _ = await self._resolve_targeted_audience(
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
            for rec in explicit_users:
                self.session.add(
                    FeedPostRecipient(post_id=post.id, recipient_id=rec.id, is_explicit=True)
                )
            await self.session.flush()

        post.updated_at = now_utc

        # If audience was narrowed on a published post, redact notifications for revoked users
        if audience_modified and post.status == FeedPostStatus.PUBLISHED.value:
            still_allowed = await self._resolve_current_authorized_audience_ids(post)
            still_allowed.add(post.author_id)
            await self._redact_post_notifications(post.id, only_outside_user_ids=still_allowed)

        await self.session.commit()

        if prev_status == FeedPostStatus.DRAFT.value and post.status == FeedPostStatus.PUBLISHED.value:
            await self._notify_post_publication(post)

        return await self._load_post_read_internal(actor, post.id)

    async def delete_post(self, actor: CurrentUser, post_id: uuid.UUID) -> None:
        """
        Soft-delete a post and sanitize associated notifications.
        Permitted for:
        - Post author holding ``feed.create`` or ``feed.manage``.
        - Authorized moderator holding ``feed.manage`` on visible published posts.
        """
        await self._require_any_permission(actor, "feed.create", "feed.manage")
        raw_perms, denies = await self._get_actor_rbac(actor)

        stmt = (
            select(FeedPost)
            .where(FeedPost.id == post_id, FeedPost.deleted_at.is_(None))
            .options(
                selectinload(FeedPost.recipients),
                selectinload(FeedPost.targeted_departments),
            )
        )
        post = (await self.session.execute(stmt)).scalar_one_or_none()
        if not post:
            raise NotFoundException("Feed post not found.")

        if post.author_id == actor.id:
            if not (
                evaluate_feed_permission(raw_perms, denies, "feed.create")
                or evaluate_feed_permission(raw_perms, denies, "feed.manage")
            ):
                raise ForbiddenException("You do not have permission to delete this post.")
        else:
            if not evaluate_feed_permission(raw_perms, denies, "feed.manage"):
                raise ForbiddenException("Only the author or an authorized Feed moderator can delete this post.")
            if post.status != FeedPostStatus.PUBLISHED.value or not await self._can_actor_view_post(actor, post):
                raise ForbiddenException("You do not have access to moderate this private or unpublished post.")

        post.deleted_at = datetime.now(timezone.utc)
        await self._redact_post_notifications(post.id)
        await self.session.commit()

    # ==========================================================================
    # Audience Directory Lookups (Employee Privacy & Login Eligibility Enforced)
    # ==========================================================================

    async def list_eligible_recipients(
        self,
        actor: CurrentUser,
        query: str | None = None,
        limit: int = 30,
    ) -> list[EligibleRecipientRead]:
        """List active, login-enabled workforce members for audience or DM selection."""
        await self._require_any_permission(actor, "feed.create", "feed.manage")

        bounded_limit = max(1, min(limit, 100))
        stmt = (
            select(User)
            .where(*self._eligible_user_clauses())
            .order_by(User.display_name, User.first_name, User.username)
            .limit(bounded_limit)
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

        users = list((await self.session.execute(stmt)).scalars().all())
        if not users:
            return []

        dept_map = await self._get_users_department_map([u.id for u in users])
        return [
            EligibleRecipientRead(
                id=u.id,
                display_name=u.display_name,
                full_name=u.full_name,
                email=u.email,
                employee_code=u.employee_code,
                department_name=dept_map.get(u.id),
                profile_picture_url=u.profile_picture_url,
            )
            for u in users
        ]

    async def list_eligible_departments(
        self, actor: CurrentUser | None = None
    ) -> list[EligibleDepartmentRead]:
        """List active non-system departments and live eligible (`has_login=True`) member counts."""
        if actor is not None:
            await self._require_any_permission(actor, "feed.create", "feed.manage")

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
                and_(
                    UserRole.role_id == Role.id,
                    *self._active_user_role_clauses(),
                ),
            )
            .outerjoin(
                User,
                and_(
                    User.id == UserRole.user_id,
                    *self._eligible_user_clauses(),
                ),
            )
            .where(
                Role.deleted_at.is_(None),
                Role.is_system.is_(False),
            )
            .group_by(Role.id, Role.name, Role.code, Role.description)
            .order_by(Role.name)
        )
        rows = (await self.session.execute(stmt)).all()

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

    # ==========================================================================
    # Comments, Reactions & Readership
    # ==========================================================================

    def _build_comment_read(
        self,
        comment: FeedPostComment,
        actor: CurrentUser,
        raw_perms: set[str],
        denies: set[str],
    ) -> FeedCommentRead:
        is_comment_author = comment.author_id == actor.id
        can_del = self._can_actor_delete_comment(comment, actor, raw_perms, denies)
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
        content_clean = data.content.strip() if data.content else ""
        if not content_clean:
            raise ValidationException("Comment content cannot be empty.")
        if len(data.content) > MAX_FEED_COMMENT_LENGTH:
            raise ValidationException(
                f"Comment content must not exceed {MAX_FEED_COMMENT_LENGTH:,} characters."
            )

        await self._require_permission(actor, "feed.create")
        raw_perms, denies = await self._get_actor_rbac(actor)

        stmt = (
            select(FeedPost)
            .where(FeedPost.id == post_id, FeedPost.deleted_at.is_(None))
            .options(
                selectinload(FeedPost.author),
                selectinload(FeedPost.recipients),
                selectinload(FeedPost.targeted_departments),
            )
        )
        post = (await self.session.execute(stmt)).scalar_one_or_none()
        if not post:
            raise NotFoundException("Feed post not found.")

        if post.status != FeedPostStatus.PUBLISHED.value:
            raise BadRequestException("Cannot comment on a draft or unpublished post.")

        if not await self._can_actor_view_post(actor, post):
            raise ForbiddenException("You do not have access to this announcement.")

        comment = FeedPostComment(
            post_id=post.id,
            author_id=actor.id,
            content=content_clean,
        )
        self.session.add(comment)
        await self.session.flush()
        await self.session.commit()

        await self._notify_comment_added(post=post, comment_content=content_clean, commenter=actor)

        c_stmt = (
            select(FeedPostComment)
            .where(FeedPostComment.id == comment.id)
            .options(selectinload(FeedPostComment.author))
        )
        saved_comment = (await self.session.execute(c_stmt)).scalar_one()
        return self._build_comment_read(saved_comment, actor, raw_perms, denies)

    async def list_comments(
        self,
        actor: CurrentUser,
        post_id: uuid.UUID,
        page: int = 1,
        page_size: int = 50,
    ) -> FeedCommentListResponse:
        """List active comments for a published feed announcement with bounded pagination."""
        if page < 1:
            raise ValidationException("Page number must be at least 1.")
        bounded_size = max(1, min(page_size, 100))

        await self._require_permission(actor, "feed.view")
        raw_perms, denies = await self._get_actor_rbac(actor)

        stmt = (
            select(FeedPost)
            .where(FeedPost.id == post_id, FeedPost.deleted_at.is_(None))
            .options(
                selectinload(FeedPost.recipients),
                selectinload(FeedPost.targeted_departments),
            )
        )
        post = (await self.session.execute(stmt)).scalar_one_or_none()
        if not post:
            raise NotFoundException("Feed post not found.")

        if not await self._can_actor_view_post(actor, post):
            raise ForbiddenException("You do not have access to this announcement.")

        count_stmt = select(func.count(FeedPostComment.id)).where(
            FeedPostComment.post_id == post_id,
            FeedPostComment.deleted_at.is_(None),
        )
        total = int((await self.session.execute(count_stmt)).scalar_one() or 0)
        total_pages = math.ceil(total / bounded_size) if total > 0 else 1

        c_stmt = (
            select(FeedPostComment)
            .where(FeedPostComment.post_id == post_id, FeedPostComment.deleted_at.is_(None))
            .order_by(FeedPostComment.created_at.asc(), FeedPostComment.id.asc())
            .offset((page - 1) * bounded_size)
            .limit(bounded_size)
            .options(selectinload(FeedPostComment.author))
        )
        comments = list((await self.session.execute(c_stmt)).scalars().all())
        items = [self._build_comment_read(c, actor, raw_perms, denies) for c in comments]

        return FeedCommentListResponse(
            items=items,
            total=total,
            page=page,
            page_size=bounded_size,
            total_pages=total_pages,
            has_more=(page < total_pages),
        )

    async def update_comment(
        self, actor: CurrentUser, post_id: uuid.UUID, comment_id: uuid.UUID, data: FeedCommentUpdate
    ) -> FeedCommentRead:
        """Update an existing comment after revalidating active post visibility and author ownership."""
        content_clean = data.content.strip() if data.content else ""
        if not content_clean:
            raise ValidationException("Comment content cannot be empty.")
        if len(data.content) > MAX_FEED_COMMENT_LENGTH:
            raise ValidationException(
                f"Comment content must not exceed {MAX_FEED_COMMENT_LENGTH:,} characters."
            )

        await self._require_permission(actor, "feed.create")
        raw_perms, denies = await self._get_actor_rbac(actor)

        post_stmt = (
            select(FeedPost)
            .where(FeedPost.id == post_id, FeedPost.deleted_at.is_(None))
            .options(
                selectinload(FeedPost.recipients),
                selectinload(FeedPost.targeted_departments),
            )
        )
        post = (await self.session.execute(post_stmt)).scalar_one_or_none()
        if not post:
            raise NotFoundException("Feed post not found.")
        if post.status != FeedPostStatus.PUBLISHED.value:
            raise BadRequestException("Cannot edit comments on an unpublished post.")
        if not await self._can_actor_view_post(actor, post):
            raise ForbiddenException("You do not have access to this announcement.")

        c_stmt = (
            select(FeedPostComment)
            .where(
                FeedPostComment.id == comment_id,
                FeedPostComment.post_id == post_id,
                FeedPostComment.deleted_at.is_(None),
            )
            .options(selectinload(FeedPostComment.author))
        )
        comment = (await self.session.execute(c_stmt)).scalar_one_or_none()
        if not comment:
            raise NotFoundException("Comment not found.")

        if comment.author_id != actor.id:
            raise ForbiddenException("You can only edit your own comment.")

        comment.content = content_clean
        comment.updated_at = datetime.now(timezone.utc)
        await self.session.commit()

        return self._build_comment_read(comment, actor, raw_perms, denies)

    async def delete_comment(
        self, actor: CurrentUser, post_id: uuid.UUID, comment_id: uuid.UUID
    ) -> None:
        """
        Soft-delete a comment after revalidating parent post state/visibility.
        Authorized for the comment author (`feed.create` or `feed.manage`) or a
        Feed moderator (`feed.manage`), matching `FeedCommentRead.can_delete`.
        """
        await self._require_any_permission(actor, "feed.create", "feed.manage")
        raw_perms, denies = await self._get_actor_rbac(actor)

        post_stmt = (
            select(FeedPost)
            .where(FeedPost.id == post_id, FeedPost.deleted_at.is_(None))
            .options(
                selectinload(FeedPost.recipients),
                selectinload(FeedPost.targeted_departments),
            )
        )
        post = (await self.session.execute(post_stmt)).scalar_one_or_none()
        if not post:
            raise NotFoundException("Feed post not found.")
        if post.status != FeedPostStatus.PUBLISHED.value:
            raise BadRequestException("Cannot delete comments on an unpublished post.")
        if not await self._can_actor_view_post(actor, post):
            raise ForbiddenException("You do not have access to this announcement.")

        c_stmt = select(FeedPostComment).where(
            FeedPostComment.id == comment_id,
            FeedPostComment.post_id == post_id,
            FeedPostComment.deleted_at.is_(None),
        )
        comment = (await self.session.execute(c_stmt)).scalar_one_or_none()
        if not comment:
            raise NotFoundException("Comment not found.")

        if not self._can_actor_delete_comment(comment, actor, raw_perms, denies):
            raise ForbiddenException("You are not authorized to delete this comment.")

        old_snippet = comment.content[:100]
        comment.deleted_at = datetime.now(timezone.utc)

        if old_snippet and self._is_real_db_session():
            post_link = f"/feed?post_id={post_id}"
            await self.session.execute(
                update(Notification)
                .where(
                    Notification.link == post_link,
                    Notification.type.in_(["feed_comment", "feed_discussion"]),
                    Notification.message.contains(old_snippet),
                )
                .values(message="A comment on this announcement was removed.")
            )

        await self.session.commit()

    async def toggle_reaction(
        self, actor: CurrentUser, post_id: uuid.UUID, data: FeedReactionToggle
    ) -> FeedReactionSummary:
        """Concurrency-safe reaction toggle on an accessible published post."""
        rx_type = data.reaction_type.strip().upper()
        if rx_type not in (
            FeedReactionType.LIKE.value,
            FeedReactionType.CELEBRATE.value,
            FeedReactionType.SUPPORT.value,
        ):
            raise ValidationException(
                f"Invalid reaction type '{data.reaction_type}'. Must be LIKE, CELEBRATE, or SUPPORT."
            )

        await self._require_permission(actor, "feed.create")

        stmt = (
            select(FeedPost)
            .where(FeedPost.id == post_id, FeedPost.deleted_at.is_(None))
            .options(
                selectinload(FeedPost.recipients),
                selectinload(FeedPost.targeted_departments),
            )
        )
        post = (await self.session.execute(stmt)).scalar_one_or_none()
        if not post:
            raise NotFoundException("Feed post not found.")

        if post.status != FeedPostStatus.PUBLISHED.value:
            raise BadRequestException("Cannot react to a draft or unpublished post.")

        if not await self._can_actor_view_post(actor, post):
            raise ForbiddenException("You do not have access to this announcement.")

        # Serialize concurrent reaction toggles for the same (post_id, user_id)
        await self._pg_advisory_xact_lock(f"feed_rx:{post_id}:{actor.id}")

        r_stmt = (
            select(FeedPostReaction)
            .where(FeedPostReaction.post_id == post_id, FeedPostReaction.user_id == actor.id)
            .with_for_update()
        )
        existing = (await self.session.execute(r_stmt)).scalar_one_or_none()

        if existing:
            if existing.reaction_type == rx_type:
                await self.session.delete(existing)
            else:
                existing.reaction_type = rx_type
            await self.session.flush()
        else:
            try:
                async with self.session.begin_nested():
                    new_rx = FeedPostReaction(
                        post_id=post_id,
                        user_id=actor.id,
                        reaction_type=rx_type,
                    )
                    self.session.add(new_rx)
                    await self.session.flush()
            except IntegrityError:
                existing_retry = (await self.session.execute(r_stmt)).scalar_one_or_none()
                if existing_retry:
                    if existing_retry.reaction_type == rx_type:
                        await self.session.delete(existing_retry)
                    else:
                        existing_retry.reaction_type = rx_type
                    await self.session.flush()

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
        counts_dict = dict((await self.session.execute(stmt)).all())

        user_rx_stmt = select(FeedPostReaction.reaction_type).where(
            FeedPostReaction.post_id == post_id, FeedPostReaction.user_id == user_id
        )
        user_rx = (await self.session.execute(user_rx_stmt)).scalar_one_or_none()

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
        """Concurrency-safe mark-as-read on an accessible published post."""
        await self._require_permission(actor, "feed.view")

        stmt = (
            select(FeedPost)
            .where(FeedPost.id == post_id, FeedPost.deleted_at.is_(None))
            .options(
                selectinload(FeedPost.recipients),
                selectinload(FeedPost.targeted_departments),
            )
        )
        post = (await self.session.execute(stmt)).scalar_one_or_none()
        if not post:
            raise NotFoundException("Feed post not found.")

        if post.status != FeedPostStatus.PUBLISHED.value:
            raise BadRequestException("Cannot track read status on a draft or unpublished post.")

        if not await self._can_actor_view_post(actor, post):
            raise ForbiddenException("You do not have access to this announcement.")

        chk_stmt = select(FeedPostReadRecord.id).where(
            FeedPostReadRecord.post_id == post_id, FeedPostReadRecord.user_id == actor.id
        )
        existing = (await self.session.execute(chk_stmt)).scalar_one_or_none()
        if existing is None:
            try:
                async with self.session.begin_nested():
                    self.session.add(FeedPostReadRecord(post_id=post_id, user_id=actor.id))
                    await self.session.flush()
                await self.session.commit()
            except IntegrityError:
                pass

        return {"post_id": str(post_id), "is_read": True}

    async def get_readership(
        self, actor: CurrentUser, post_id: uuid.UUID
    ) -> FeedReadershipResponse:
        """Retrieve announcement readership details (strictly author-only)."""
        await self._require_permission(actor, "feed.view")

        stmt = select(FeedPost).where(FeedPost.id == post_id, FeedPost.deleted_at.is_(None))
        post = (await self.session.execute(stmt)).scalar_one_or_none()
        if not post:
            raise NotFoundException("Feed post not found.")

        if post.author_id != actor.id:
            raise ForbiddenException("Only the post author can view announcement readership.")

        r_stmt = (
            select(FeedPostReadRecord)
            .where(FeedPostReadRecord.post_id == post_id)
            .order_by(FeedPostReadRecord.read_at.desc())
            .options(selectinload(FeedPostReadRecord.user))
        )
        records = list((await self.session.execute(r_stmt)).scalars().all())

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
    # Employee-to-Employee 1:1 Direct Messaging Service Methods
    # ==========================================================================

    async def _get_users_department_map(self, user_ids: Sequence[uuid.UUID]) -> dict[uuid.UUID, str]:
        if not user_ids or not self._is_real_db_session():
            return {}
        clean_ids = [uid for uid in user_ids if uid is not None]
        if not clean_ids:
            return {}
        role_stmt = (
            select(UserRole.user_id, Role.name, UserRole.is_primary)
            .join(
                Role,
                and_(
                    Role.id == UserRole.role_id,
                    Role.deleted_at.is_(None),
                    Role.is_system.is_(False),
                ),
            )
            .where(
                UserRole.user_id.in_(clean_ids),
                *self._active_user_role_clauses(),
            )
            .order_by(UserRole.is_primary.desc())
        )
        user_dept_map: dict[uuid.UUID, str] = {}
        for uid, rname, is_pri in (await self.session.execute(role_stmt)).all():
            if uid not in user_dept_map or is_pri:
                user_dept_map[uid] = rname
        return user_dept_map

    @staticmethod
    def _build_direct_message_read(m: FeedDirectMessage, actor_id: uuid.UUID) -> DirectMessageRead:
        sender_author = FeedAuthorRead(
            id=m.sender.id,
            display_name=m.sender.display_name,
            full_name=m.sender.full_name,
            email=m.sender.email,
            employee_code=m.sender.employee_code,
            profile_picture_url=m.sender.profile_picture_url,
        )
        return DirectMessageRead(
            id=m.id,
            conversation_id=m.conversation_id,
            sender_id=m.sender_id,
            sender=sender_author,
            sender_display_name=m.sender.display_name or m.sender.full_name,
            sender_email=m.sender.email,
            content=m.content,
            is_sender=(m.sender_id == actor_id),
            is_edited=bool(m.updated_at is not None and m.created_at is not None and m.updated_at > m.created_at),
            created_at=m.created_at,
            updated_at=m.updated_at,
        )

    async def _build_conversation_read(
        self, conv: FeedConversation, current_user_id: uuid.UUID
    ) -> ConversationRead:
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
        Concurrency-safe canonical 1:1 conversation lookup/creation.
        Enforces `feed.create`, rejects self-chat and inactive/`has_login=False` targets,
        and serializes concurrent pair creation via PostgreSQL advisory lock + unique index.
        """
        await self._require_permission(actor, "feed.create")

        if actor.id == recipient_id:
            raise BadRequestException("Cannot start a conversation with yourself.")

        user_row = (
            await self.session.execute(
                select(User).where(User.id == recipient_id, User.deleted_at.is_(None))
            )
        ).scalar_one_or_none()
        if not user_row:
            raise NotFoundException("Recipient employee not found.")
        if (
            not user_row.has_login
            or not user_row.is_active
            or user_row.status != UserStatus.ACTIVE
        ):
            raise BadRequestException(
                "Selected workforce record is inactive or does not have ERP login access."
            )

        low_id, high_id = _canonical_pair(actor.id, recipient_id)
        await self._pg_advisory_xact_lock(f"feed_dm_pair:{low_id}:{high_id}")

        def _pair_select():
            p1 = select(FeedConversationParticipant.conversation_id).where(
                FeedConversationParticipant.user_id == low_id
            )
            p2 = select(FeedConversationParticipant.conversation_id).where(
                FeedConversationParticipant.user_id == high_id
            )
            return (
                select(FeedConversation)
                .where(
                    FeedConversation.deleted_at.is_(None),
                    or_(
                        and_(
                            FeedConversation.participant_low_id == low_id,
                            FeedConversation.participant_high_id == high_id,
                        ),
                        and_(
                            FeedConversation.id.in_(p1),
                            FeedConversation.id.in_(p2),
                        ),
                    ),
                )
                .order_by(FeedConversation.created_at.asc(), FeedConversation.id.asc())
                .limit(1)
                .options(
                    selectinload(FeedConversation.participants).selectinload(
                        FeedConversationParticipant.user
                    ),
                )
            )

        conv = (await self.session.execute(_pair_select())).scalar_one_or_none()
        if conv is not None:
            if conv.participant_low_id != low_id or conv.participant_high_id != high_id:
                conv.participant_low_id = low_id
                conv.participant_high_id = high_id
                await self.session.commit()
            return await self._build_conversation_read(conv, actor.id)

        now_utc = datetime.now(timezone.utc)
        created_id: uuid.UUID | None = None
        try:
            async with self.session.begin_nested():
                new_conv = FeedConversation(
                    id=uuid.uuid4(),
                    participant_low_id=low_id,
                    participant_high_id=high_id,
                    last_message_at=None,
                    last_message_preview=None,
                    last_message_sender_id=None,
                    created_at=now_utc,
                    updated_at=now_utc,
                )
                self.session.add(new_conv)
                await self.session.flush()
                self.session.add_all(
                    [
                        FeedConversationParticipant(
                            conversation_id=new_conv.id,
                            user_id=actor.id,
                            unread_count=0,
                            created_at=now_utc,
                        ),
                        FeedConversationParticipant(
                            conversation_id=new_conv.id,
                            user_id=recipient_id,
                            unread_count=0,
                            created_at=now_utc,
                        ),
                    ]
                )
                await self.session.flush()
                created_id = new_conv.id
            await self.session.commit()
        except IntegrityError:
            pass

        if created_id is not None:
            reload_stmt = (
                select(FeedConversation)
                .where(FeedConversation.id == created_id)
                .options(
                    selectinload(FeedConversation.participants).selectinload(
                        FeedConversationParticipant.user
                    ),
                )
            )
            loaded = (await self.session.execute(reload_stmt)).scalar_one()
            return await self._build_conversation_read(loaded, actor.id)

        winner = (await self.session.execute(_pair_select())).scalar_one()
        return await self._build_conversation_read(winner, actor.id)

    async def list_conversations(
        self,
        actor: CurrentUser,
        page: int = 1,
        page_size: int = 50,
    ) -> ConversationListResponse:
        """List active 1:1 conversations strictly where the caller is a participant."""
        await self._require_permission(actor, "feed.view")

        bounded_size = max(1, min(page_size, 100))
        base_where = (
            FeedConversation.deleted_at.is_(None),
            FeedConversationParticipant.user_id == actor.id,
        )
        total_stmt = (
            select(func.count(FeedConversation.id))
            .join(
                FeedConversationParticipant,
                FeedConversationParticipant.conversation_id == FeedConversation.id,
            )
            .where(*base_where)
        )
        total = int((await self.session.execute(total_stmt)).scalar_one() or 0)

        stmt = (
            select(FeedConversation)
            .join(
                FeedConversationParticipant,
                FeedConversationParticipant.conversation_id == FeedConversation.id,
            )
            .where(*base_where)
            .order_by(
                FeedConversation.last_message_at.desc().nullslast(),
                FeedConversation.created_at.desc(),
                FeedConversation.id.desc(),
            )
            .offset((max(1, page) - 1) * bounded_size)
            .limit(bounded_size)
            .options(
                selectinload(FeedConversation.participants).selectinload(
                    FeedConversationParticipant.user
                ),
            )
        )
        convs = list((await self.session.execute(stmt)).scalars().all())
        items = [await self._build_conversation_read(c, actor.id) for c in convs]
        return ConversationListResponse(items=items, total=total)

    async def get_conversation(
        self, actor: CurrentUser, conversation_id: uuid.UUID
    ) -> ConversationRead:
        """Get conversation details, strictly enforcing participant isolation."""
        await self._require_permission(actor, "feed.view")

        stmt = (
            select(FeedConversation)
            .where(
                FeedConversation.id == conversation_id,
                FeedConversation.deleted_at.is_(None),
            )
            .options(
                selectinload(FeedConversation.participants).selectinload(
                    FeedConversationParticipant.user
                ),
            )
        )
        conv = (await self.session.execute(stmt)).scalar_one_or_none()
        if not conv:
            raise NotFoundException("Conversation not found.")

        is_participant = any(p.user_id == actor.id for p in (conv.participants or []))
        if not is_participant:
            raise ForbiddenException("You do not have access to this conversation.")

        return await self._build_conversation_read(conv, actor.id)

    async def list_messages(
        self,
        actor: CurrentUser,
        conversation_id: uuid.UUID,
        page: int = 1,
        page_size: int = 100,
    ) -> DirectMessageListResponse:
        """
        List non-deleted messages in a conversation and race-safely mark the
        conversation as read for the caller.
        """
        await self._require_permission(actor, "feed.view")

        # Lock conversation row so mark-read is linearizable with concurrent send_message
        conv_stmt = (
            select(FeedConversation)
            .where(
                FeedConversation.id == conversation_id,
                FeedConversation.deleted_at.is_(None),
            )
            .with_for_update()
        )
        conv = (await self.session.execute(conv_stmt)).scalar_one_or_none()
        if not conv:
            raise NotFoundException("Conversation not found.")

        part_stmt = select(FeedConversationParticipant).where(
            FeedConversationParticipant.conversation_id == conversation_id,
            FeedConversationParticipant.user_id == actor.id,
        )
        participant = (await self.session.execute(part_stmt)).scalar_one_or_none()
        if not participant:
            raise ForbiddenException("You do not have access to this conversation.")

        now_utc = datetime.now(timezone.utc)
        if conv.last_message_at is not None and now_utc < conv.last_message_at:
            now_utc = conv.last_message_at

        await self.session.execute(
            update(FeedConversationParticipant)
            .where(
                FeedConversationParticipant.conversation_id == conversation_id,
                FeedConversationParticipant.user_id == actor.id,
            )
            .values(unread_count=0, last_read_at=now_utc)
        )
        await self.session.commit()

        bounded_size = max(1, min(page_size, 500))
        total_stmt = select(func.count(FeedDirectMessage.id)).where(
            FeedDirectMessage.conversation_id == conversation_id,
            FeedDirectMessage.deleted_at.is_(None),
        )
        total = int((await self.session.execute(total_stmt)).scalar_one() or 0)

        msg_stmt = (
            select(FeedDirectMessage)
            .where(
                FeedDirectMessage.conversation_id == conversation_id,
                FeedDirectMessage.deleted_at.is_(None),
            )
            .order_by(FeedDirectMessage.created_at.asc(), FeedDirectMessage.id.asc())
            .offset((max(1, page) - 1) * bounded_size)
            .limit(bounded_size)
            .options(selectinload(FeedDirectMessage.sender))
        )
        messages = list((await self.session.execute(msg_stmt)).scalars().all())
        items = [self._build_direct_message_read(m, actor.id) for m in messages]
        return DirectMessageListResponse(items=items, total=total)

    async def send_message(
        self, actor: CurrentUser, conversation_id: uuid.UUID, data: DirectMessageCreate
    ) -> DirectMessageRead:
        """
        Send a private message with atomic PostgreSQL `unread_count` increments
        and linearizable ordering against concurrent `mark_conversation_read`.
        """
        clean_content = data.content.strip() if data.content else ""
        if not clean_content:
            raise ValidationException("Message content cannot be empty.")
        if len(data.content) > MAX_DIRECT_MESSAGE_LENGTH:
            raise ValidationException(
                f"Message content must not exceed {MAX_DIRECT_MESSAGE_LENGTH:,} characters."
            )

        await self._require_permission(actor, "feed.create")

        conv_stmt = (
            select(FeedConversation)
            .where(
                FeedConversation.id == conversation_id,
                FeedConversation.deleted_at.is_(None),
            )
            .with_for_update()
            .options(selectinload(FeedConversation.participants))
        )
        conv = (await self.session.execute(conv_stmt)).scalar_one_or_none()
        if not conv:
            raise NotFoundException("Conversation not found.")

        is_participant = any(p.user_id == actor.id for p in (conv.participants or []))
        if not is_participant:
            raise ForbiddenException("You do not have access to this conversation.")

        now_utc = datetime.now(timezone.utc)
        max_existing_ts = conv.last_message_at
        for p in conv.participants or []:
            if p.last_read_at is not None and (max_existing_ts is None or p.last_read_at >= max_existing_ts):
                max_existing_ts = p.last_read_at
        if max_existing_ts is not None and now_utc <= max_existing_ts:
            now_utc = max_existing_ts + timedelta(microseconds=1)

        message = FeedDirectMessage(
            id=uuid.uuid4(),
            conversation_id=conversation_id,
            sender_id=actor.id,
            content=clean_content,
            created_at=now_utc,
        )
        self.session.add(message)
        await self.session.flush()

        conv.last_message_at = now_utc
        conv.last_message_preview = clean_content[:150]
        conv.last_message_sender_id = actor.id
        conv.updated_at = now_utc

        # Atomic SQL increment for recipient(s) only -- never read-modify-write in Python
        await self.session.execute(
            update(FeedConversationParticipant)
            .where(
                FeedConversationParticipant.conversation_id == conversation_id,
                FeedConversationParticipant.user_id != actor.id,
            )
            .values(unread_count=FeedConversationParticipant.unread_count + 1)
        )

        recipient_ids_to_notify = [
            p.user_id for p in (conv.participants or []) if p.user_id != actor.id
        ]
        await self.session.commit()

        # Notify eligible recipient(s) without embedding confidential DM plaintext
        allowed_notify_ids = await self._filter_users_with_feed_view(set(recipient_ids_to_notify))
        if allowed_notify_ids:
            sender_name = (
                getattr(actor, "display_name", None)
                or getattr(actor, "full_name", None)
                or getattr(actor, "username", "A colleague")
            )
            conv_link = f"/feed?tab=messages&conversation_id={conversation_id}"
            try:
                await self._batch_create_notifications(
                    user_ids=list(allowed_notify_ids),
                    notif_type="feed_message",
                    title=f"New message from {sender_name}",
                    message=f"{sender_name} sent you a private message.",
                    link=conv_link,
                )
            except Exception:
                await self.session.rollback()

        m_stmt = (
            select(FeedDirectMessage)
            .where(FeedDirectMessage.id == message.id)
            .options(selectinload(FeedDirectMessage.sender))
        )
        m_loaded = (await self.session.execute(m_stmt)).scalar_one()
        return self._build_direct_message_read(m_loaded, actor.id)

    async def _recompute_conversation_preview_and_unread(self, conv: FeedConversation) -> None:
        """Recompute `last_message_*` and participant `unread_count` from live non-deleted messages."""
        latest_stmt = (
            select(FeedDirectMessage)
            .where(
                FeedDirectMessage.conversation_id == conv.id,
                FeedDirectMessage.deleted_at.is_(None),
            )
            .order_by(FeedDirectMessage.created_at.desc(), FeedDirectMessage.id.desc())
            .limit(1)
        )
        latest = (await self.session.execute(latest_stmt)).scalar_one_or_none()
        if latest is not None:
            conv.last_message_at = latest.created_at
            conv.last_message_preview = latest.content[:150]
            conv.last_message_sender_id = latest.sender_id
        else:
            conv.last_message_at = None
            conv.last_message_preview = None
            conv.last_message_sender_id = None
        conv.updated_at = datetime.now(timezone.utc)

        parts_stmt = select(FeedConversationParticipant).where(
            FeedConversationParticipant.conversation_id == conv.id
        )
        participants = list((await self.session.execute(parts_stmt)).scalars().all())
        for part in participants:
            unread_clauses = [
                FeedDirectMessage.conversation_id == conv.id,
                FeedDirectMessage.deleted_at.is_(None),
                FeedDirectMessage.sender_id != part.user_id,
            ]
            if part.last_read_at is not None:
                unread_clauses.append(FeedDirectMessage.created_at > part.last_read_at)
            cnt_stmt = select(func.count(FeedDirectMessage.id)).where(*unread_clauses)
            part.unread_count = int((await self.session.execute(cnt_stmt)).scalar_one() or 0)

    async def update_message(
        self, actor: CurrentUser, message_id: uuid.UUID, data: DirectMessageUpdate
    ) -> DirectMessageRead:
        """Edit own private message and synchronize `last_message_preview` if needed."""
        clean_content = data.content.strip() if data.content else ""
        if not clean_content:
            raise ValidationException("Message content cannot be empty.")
        if len(data.content) > MAX_DIRECT_MESSAGE_LENGTH:
            raise ValidationException(
                f"Message content must not exceed {MAX_DIRECT_MESSAGE_LENGTH:,} characters."
            )

        await self._require_permission(actor, "feed.create")

        stmt = (
            select(FeedDirectMessage)
            .where(FeedDirectMessage.id == message_id, FeedDirectMessage.deleted_at.is_(None))
            .options(selectinload(FeedDirectMessage.sender))
        )
        msg = (await self.session.execute(stmt)).scalar_one_or_none()
        if not msg:
            raise NotFoundException("Message not found.")

        if msg.sender_id != actor.id:
            raise ForbiddenException("Only the sender can edit this message.")

        conv_stmt = (
            select(FeedConversation)
            .where(
                FeedConversation.id == msg.conversation_id,
                FeedConversation.deleted_at.is_(None),
            )
            .with_for_update()
            .options(selectinload(FeedConversation.participants))
        )
        conv = (await self.session.execute(conv_stmt)).scalar_one_or_none()
        if not conv:
            raise NotFoundException("Conversation not found.")
        if not any(p.user_id == actor.id for p in (conv.participants or [])):
            raise ForbiddenException("You do not have access to this conversation.")

        now_utc = datetime.now(timezone.utc)
        if now_utc <= msg.created_at:
            now_utc = msg.created_at + timedelta(microseconds=1)
        msg.content = clean_content
        msg.updated_at = now_utc
        await self.session.flush()

        await self._recompute_conversation_preview_and_unread(conv)
        await self.session.commit()

        return self._build_direct_message_read(msg, actor.id)

    async def delete_message(self, actor: CurrentUser, message_id: uuid.UUID) -> None:
        """
        Soft-delete own direct message and immediately recompute
        `conversation.last_message_preview` and participant unread counters so
        deleted message plaintext never lingers in conversation summaries.
        """
        await self._require_any_permission(actor, "feed.create", "feed.view")
        _, denies = await self._get_actor_rbac(actor)
        if "feed.create" in denies:
            raise ForbiddenException("Permission denied. Direct message modification is restricted.")

        stmt = select(FeedDirectMessage).where(
            FeedDirectMessage.id == message_id,
            FeedDirectMessage.deleted_at.is_(None),
        )
        msg = (await self.session.execute(stmt)).scalar_one_or_none()
        if not msg:
            raise NotFoundException("Message not found.")

        if msg.sender_id != actor.id:
            raise ForbiddenException("Only the sender can delete this message.")

        conv_stmt = (
            select(FeedConversation)
            .where(
                FeedConversation.id == msg.conversation_id,
                FeedConversation.deleted_at.is_(None),
            )
            .with_for_update()
            .options(selectinload(FeedConversation.participants))
        )
        conv = (await self.session.execute(conv_stmt)).scalar_one_or_none()
        if not conv:
            raise NotFoundException("Conversation not found.")
        if not any(p.user_id == actor.id for p in (conv.participants or [])):
            raise ForbiddenException("You do not have access to this conversation.")

        msg.deleted_at = datetime.now(timezone.utc)
        await self.session.flush()

        await self._recompute_conversation_preview_and_unread(conv)
        await self.session.commit()

    async def mark_conversation_read(
        self, actor: CurrentUser, conversation_id: uuid.UUID
    ) -> None:
        """Race-safely mark a conversation as read under row lock."""
        await self._require_permission(actor, "feed.view")

        conv_stmt = (
            select(FeedConversation)
            .where(
                FeedConversation.id == conversation_id,
                FeedConversation.deleted_at.is_(None),
            )
            .with_for_update()
        )
        conv = (await self.session.execute(conv_stmt)).scalar_one_or_none()
        if not conv:
            raise NotFoundException("Conversation not found.")

        part_stmt = select(FeedConversationParticipant.id).where(
            FeedConversationParticipant.conversation_id == conversation_id,
            FeedConversationParticipant.user_id == actor.id,
        )
        if (await self.session.execute(part_stmt)).scalar_one_or_none() is None:
            raise ForbiddenException("You do not have access to this conversation.")

        now_utc = datetime.now(timezone.utc)
        if conv.last_message_at is not None and now_utc < conv.last_message_at:
            now_utc = conv.last_message_at

        await self.session.execute(
            update(FeedConversationParticipant)
            .where(
                FeedConversationParticipant.conversation_id == conversation_id,
                FeedConversationParticipant.user_id == actor.id,
            )
            .values(unread_count=0, last_read_at=now_utc)
        )
        await self.session.commit()

    async def get_unread_messages_count(self, actor: CurrentUser) -> int:
        """Return sum of unread direct messages across active conversations for the user."""
        await self._require_permission(actor, "feed.view")

        stmt = (
            select(func.coalesce(func.sum(FeedConversationParticipant.unread_count), 0))
            .join(
                FeedConversation,
                FeedConversation.id == FeedConversationParticipant.conversation_id,
            )
            .where(
                FeedConversationParticipant.user_id == actor.id,
                FeedConversation.deleted_at.is_(None),
            )
        )
        count = (await self.session.execute(stmt)).scalar() or 0
        return int(count)
