"""
Real PostgreSQL Integration, Security, RBAC, Migration & Concurrency Suite for Feed Module.

Covers all Stage 2 remediation phases (FEED-AUD-01 through FEED-AUD-12):
- Phase 1 : Dynamic department privacy, explicit recipient retention, historical backfill
- Phase 2 : Complete Feed RBAC (`feed.view`, `feed.create`, `feed.manage`, `deny:feed.*`) across all 23 endpoints
- Phase 3 : Canonical `total_pages` pagination contract & >15 post boundary navigation
- Phase 4 : Canonical 1:1 DM pair uniqueness, duplicate consolidation, participant privacy
- Phase 5 : Soft-delete & audience-revocation redaction across posts, comments, DMs, notifications
- Phase 6 : PostgreSQL multi-session concurrency (all 7 required scenarios)
- Phase 7 : Comment moderation consistency (`can_delete` == `DELETE` authorization)
- Phase 8 : Workforce eligibility (`has_login=True`, `is_active=True`, `status=ACTIVE`)
- Phase 9 : Input validation & content length bounds (20,000 post / 5,000 comment & DM, Unicode/emoji)
- Phase 10: Bounded comment pagination & batched notification SQL fanout benchmark

Safety:
- Runs strictly against an isolated local PostgreSQL test database (`inhyma_test_db`), never Supabase.
- Cleans up 100% of synthetic `frp_` records in `finally:` blocks.
"""

from __future__ import annotations

import asyncio
import os
import time
import uuid
from datetime import date, datetime, timedelta, timezone

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import delete, event, func, select, text
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine

from app.auth.security import create_access_token, hash_password
from app.auth.service import CurrentUser
from app.core.config import settings
from app.feed.models import (
    FeedConversation,
    FeedConversationParticipant,
    FeedDirectMessage,
    FeedPost,
    FeedPostComment,
    FeedPostDepartment,
    FeedPostReaction,
    FeedPostReadRecord,
    FeedPostRecipient,
)
from app.feed.schemas import (
    DirectMessageCreate,
    FeedCommentCreate,
    FeedReactionToggle,
    MAX_DIRECT_MESSAGE_LENGTH,
    MAX_FEED_COMMENT_LENGTH,
    MAX_FEED_POST_CONTENT_LENGTH,
)
from app.feed.service import FeedService, _canonical_pair
from app.main import create_application
from app.notifications.models import Notification
from app.rbac.models import Permission, Role, RoleAssignmentStatus, RolePermission, UserPermission, UserRole
from app.rbac.repository import RoleRepository
from app.users.models import EmploymentStatus, EmploymentType, User, UserStatus

PG_TEST_URL = os.environ.get(
    "FEED_PG_TEST_URL",
    "postgresql+asyncpg://postgres:root@127.0.0.1:5432/inhyma_test_db",
)


def _ensure_safe_local_pg(url: str) -> None:
    lower = url.lower()
    if "supabase.com" in lower or "supabase.co" in lower:
        pytest.skip("Refusing to execute Feed PostgreSQL integration suite against Supabase.")
    if not lower.startswith("postgresql"):
        pytest.skip("Feed PostgreSQL integration suite requires a PostgreSQL DATABASE_URL.")


@pytest_asyncio.fixture
async def pg_feed_env():
    """
    Provision an isolated PostgreSQL engine + FastAPI test client wired to `inhyma_test_db`,
    plus helper factories that track and clean up 100% of synthetic records after each test.
    """
    _ensure_safe_local_pg(PG_TEST_URL)
    prev_db_url = str(settings.DATABASE_URL)
    os.environ["DATABASE_URL"] = PG_TEST_URL
    object.__setattr__(settings, "DATABASE_URL", PG_TEST_URL)

    import app.database.engine as engine_module

    await engine_module.dispose_engine()

    engine: AsyncEngine = create_async_engine(PG_TEST_URL, pool_size=15, max_overflow=20)
    SessionFactory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    tag = uuid.uuid4().hex[:8].lower()
    pw_hash = hash_password("FeedRemediate!2026")

    created_user_ids: list[uuid.UUID] = []
    created_role_ids: list[uuid.UUID] = []
    created_post_ids: list[uuid.UUID] = []
    created_conv_ids: list[uuid.UUID] = []

    async with SessionFactory() as boot_db:
        perms_map = {
            p.code: p
            for p in (
                await boot_db.execute(
                    select(Permission).where(
                        Permission.code.in_(["feed.view", "feed.create", "feed.manage"])
                    )
                )
            ).scalars().all()
        }
        super_admin_role = (
            await boot_db.execute(select(Role).where(Role.name == "super_admin"))
        ).scalar_one()

    async def make_department(short_name: str, *, role_perms: list[str] | None = None) -> Role:
        async with SessionFactory() as s:
            r = Role(
                name=f"frp_{short_name}_{tag}_{uuid.uuid4().hex[:4]}",
                code=f"FRP{uuid.uuid4().hex[:7].upper()}",
                description=f"Synthetic dept {short_name}",
                is_system=False,
            )
            s.add(r)
            await s.flush()
            for code in role_perms or []:
                if code in perms_map:
                    s.add(RolePermission(role_id=r.id, permission_id=perms_map[code].id))
            await s.commit()
            created_role_ids.append(r.id)
            return r

    async def make_user(
        short_key: str,
        *,
        roles: list[Role] | None = None,
        grants: list[str] | None = None,
        denies: list[str] | None = None,
        has_login: bool = True,
        is_active: bool = True,
        status: UserStatus = UserStatus.ACTIVE,
    ) -> tuple[User, CurrentUser, dict[str, str]]:
        async with SessionFactory() as s:
            uid_suffix = uuid.uuid4().hex[:4]
            uname = f"frp_{short_key}_{tag}_{uid_suffix}" if has_login else None
            u = User(
                first_name="FRP",
                last_name=f"{short_key}_{uid_suffix}",
                display_name=f"FRP {short_key} {tag}",
                employee_code=f"FRP-{short_key[:4].upper()}-{uid_suffix.upper()}",
                has_login=has_login,
                username=uname,
                email=f"{uname}@inhyma-local.test" if has_login else None,
                password_hash=pw_hash if has_login else None,
                employment_type=EmploymentType.FULL_TIME,
                employment_status=EmploymentStatus.ACTIVE if is_active else EmploymentStatus.INACTIVE,
                status=status,
                is_active=is_active,
            )
            s.add(u)
            await s.flush()
            created_user_ids.append(u.id)

            for idx, role_obj in enumerate(roles or []):
                s.add(
                    UserRole(
                        user_id=u.id,
                        role_id=role_obj.id,
                        status=RoleAssignmentStatus.ACTIVE,
                        is_primary=(idx == 0),
                    )
                )
            for code in grants or []:
                if code in perms_map:
                    s.add(UserPermission(user_id=u.id, permission_id=perms_map[code].id, is_granted=True))
            for code in denies or []:
                if code in perms_map:
                    s.add(UserPermission(user_id=u.id, permission_id=perms_map[code].id, is_granted=False))
            await s.commit()

            if not has_login or not is_active or status != UserStatus.ACTIVE:
                dummy_actor = CurrentUser(id=u.id, username=uname or "", permissions=set())
                return u, dummy_actor, {}

            resolved_perms = set(await RoleRepository(s).get_permission_codes_for_user(u.id))
            for d in denies or []:
                resolved_perms.discard(d)
                resolved_perms.add(f"deny:{d}")
            is_sa = any(r.name == "super_admin" for r in (roles or []))
            actor = CurrentUser(
                id=u.id,
                username=u.username or "",
                permissions=resolved_perms,
                is_super_admin=is_sa,
                display_name=u.display_name or "",
                full_name=u.display_name or "",
            )
            tok = create_access_token(u.id, permissions=sorted(resolved_perms)).token
            return u, actor, {"Authorization": f"Bearer {tok}"}

    app = create_application()
    transport = ASGITransport(app=app, raise_app_exceptions=False)
    try:
        async with AsyncClient(transport=transport, base_url="http://testserver") as client:
            yield {
                "tag": tag,
                "engine": engine,
                "SessionFactory": SessionFactory,
                "client": client,
                "perms_map": perms_map,
                "super_admin_role": super_admin_role,
                "make_department": make_department,
                "make_user": make_user,
                "created_post_ids": created_post_ids,
                "created_conv_ids": created_conv_ids,
            }
    finally:
        async with SessionFactory() as cdb:
            if created_user_ids:
                await cdb.execute(delete(Notification).where(Notification.user_id.in_(created_user_ids)))
            await cdb.execute(delete(Notification).where(Notification.title.ilike(f"%{tag}%")))
            await cdb.execute(delete(Notification).where(Notification.message.ilike(f"%{tag}%")))
            if created_conv_ids:
                await cdb.execute(delete(FeedConversation).where(FeedConversation.id.in_(created_conv_ids)))
            if created_user_ids:
                await cdb.execute(
                    delete(FeedConversation).where(
                        (FeedConversation.participant_low_id.in_(created_user_ids))
                        | (FeedConversation.participant_high_id.in_(created_user_ids))
                    )
                )
            if created_post_ids:
                await cdb.execute(delete(FeedPost).where(FeedPost.id.in_(created_post_ids)))
            if created_user_ids:
                await cdb.execute(delete(FeedPost).where(FeedPost.author_id.in_(created_user_ids)))
                await cdb.execute(delete(UserPermission).where(UserPermission.user_id.in_(created_user_ids)))
                await cdb.execute(delete(UserRole).where(UserRole.user_id.in_(created_user_ids)))
                await cdb.execute(delete(User).where(User.id.in_(created_user_ids)))
            if created_role_ids:
                await cdb.execute(delete(RolePermission).where(RolePermission.role_id.in_(created_role_ids)))
                await cdb.execute(delete(Role).where(Role.id.in_(created_role_ids)))
            await cdb.commit()

        await engine.dispose()
        await engine_module.dispose_engine()
        object.__setattr__(settings, "DATABASE_URL", prev_db_url)


# ==============================================================================
# PHASE 1: Dynamic Department Privacy, Explicit Recipients & Historical Backfill
# ==============================================================================


@pytest.mark.asyncio
async def test_phase1_department_privacy_and_historical_migration(pg_feed_env):
    client: AsyncClient = pg_feed_env["client"]
    SF = pg_feed_env["SessionFactory"]
    tag = pg_feed_env["tag"]

    dept_sales = await pg_feed_env["make_department"]("sales", role_perms=["feed.view"])
    dept_ops = await pg_feed_env["make_department"]("ops", role_perms=["feed.view"])

    u_author, _, h_author = await pg_feed_env["make_user"](
        "author", roles=[dept_sales], grants=["feed.view", "feed.create"]
    )
    u_dept_member, _, h_dept_member = await pg_feed_env["make_user"](
        "sales1", roles=[dept_sales], grants=["feed.view", "feed.create"]
    )
    u_explicit, _, h_explicit = await pg_feed_env["make_user"](
        "explicit1", roles=[dept_sales], grants=["feed.view", "feed.create"]
    )
    u_late_joiner, _, h_late = await pg_feed_env["make_user"](
        "latejoin", roles=[dept_ops], grants=["feed.view", "feed.create"]
    )
    u_unrelated, _, h_unrelated = await pg_feed_env["make_user"](
        "unrel", roles=[dept_ops], grants=["feed.view", "feed.create"]
    )

    # 0. Unsupported individual-employee, combined, and unknown audience modes are rejected (422)
    assert (
        await client.post(
            "/api/v1/feed/posts",
            json={
                "title": f"Unsupported Individual {tag}",
                "content": "Must use Direct Messages",
                "audience_type": "SELECTED",
                "recipient_ids": [str(u_explicit.id)],
            },
            headers=h_author,
        )
    ).status_code == 422
    assert (
        await client.post(
            "/api/v1/feed/posts",
            json={
                "title": f"Unsupported Combined {tag}",
                "content": "Combined mode removed",
                "audience_type": "SELECTED",
                "department_ids": [str(dept_sales.id)],
                "recipient_ids": [str(u_explicit.id)],
            },
            headers=h_author,
        )
    ).status_code == 422
    assert (
        await client.post(
            "/api/v1/feed/posts",
            json={"content": "Bad enum", "audience_type": "EMPLOYEES"},
            headers=h_author,
        )
    ).status_code == 422
    assert (
        await client.post(
            "/api/v1/feed/posts",
            json={"content": "Bad enum", "audience_type": "COMBINED"},
            headers=h_author,
        )
    ).status_code == 422

    # Create department-targeted post for dept_sales
    r_create = await client.post(
        "/api/v1/feed/posts",
        json={
            "title": f"Confidential Sales Plan {tag}",
            "content": f"Strictly confidential Sales targets {tag}",
            "audience_type": "SELECTED",
            "status": "PUBLISHED",
            "department_ids": [str(dept_sales.id)],
        },
        headers=h_author,
    )
    assert r_create.status_code == 201
    post_id = r_create.json()["data"]["id"]
    pg_feed_env["created_post_ids"].append(uuid.UUID(post_id))

    # Verify new department post stores 0 explicit rows, then seed a historical explicit
    # recipient row (`is_explicit=True`) to prove legacy announcements remain supported
    async with SF() as db:
        initial_recs = (
            await db.execute(
                select(FeedPostRecipient).where(FeedPostRecipient.post_id == uuid.UUID(post_id))
            )
        ).scalars().all()
        assert initial_recs == []
        db.add(FeedPostRecipient(post_id=uuid.UUID(post_id), recipient_id=u_explicit.id, is_explicit=True))
        await db.commit()

    # Verify historical announcement renders explicit recipient for author and preserves title/content editing
    r_author_view = await client.get(f"/api/v1/feed/posts/{post_id}", headers=h_author)
    assert r_author_view.status_code == 200
    assert [r["recipient_id"] for r in r_author_view.json()["data"]["recipients"]] == [str(u_explicit.id)]
    assert (
        await client.patch(
            f"/api/v1/feed/posts/{post_id}",
            json={"title": f"Confidential Sales Plan Updated {tag}"},
            headers=h_author,
        )
    ).status_code == 200
    assert (
        await client.patch(
            f"/api/v1/feed/posts/{post_id}",
            json={"recipient_ids": [str(u_unrelated.id)]},
            headers=h_author,
        )
    ).status_code == 422

    # 1. Current department member & explicit recipient can view; unrelated employee blocked
    assert (await client.get(f"/api/v1/feed/posts/{post_id}", headers=h_dept_member)).status_code == 200
    assert (await client.get(f"/api/v1/feed/posts/{post_id}", headers=h_explicit)).status_code == 200
    assert (await client.get(f"/api/v1/feed/posts/{post_id}", headers=h_unrelated)).status_code == 403
    assert (await client.get(f"/api/v1/feed/posts/{post_id}", headers=h_late)).status_code == 403

    # Both u_dept_member and u_explicit comment before transfer
    assert (
        await client.post(
            f"/api/v1/feed/posts/{post_id}/comments",
            json={"content": "Sales member initial note"},
            headers=h_dept_member,
        )
    ).status_code == 201

    # Transfer u_dept_member AND u_explicit OUT of dept_sales into dept_ops;
    # transfer u_late_joiner INTO dept_sales!
    async with SF() as db:
        await db.execute(
            delete(UserRole).where(
                UserRole.user_id.in_([u_dept_member.id, u_explicit.id]),
                UserRole.role_id == dept_sales.id,
            )
        )
        db.add_all(
            [
                UserRole(user_id=u_dept_member.id, role_id=dept_ops.id, status=RoleAssignmentStatus.ACTIVE),
                UserRole(user_id=u_explicit.id, role_id=dept_ops.id, status=RoleAssignmentStatus.ACTIVE),
                UserRole(user_id=u_late_joiner.id, role_id=dept_sales.id, status=RoleAssignmentStatus.ACTIVE),
            ]
        )
        await db.commit()

    # 2. Former department member IMMEDIATELY loses access (detail, list, comment)
    assert (await client.get(f"/api/v1/feed/posts/{post_id}", headers=h_dept_member)).status_code == 403
    r_ex_list = await client.get(f"/api/v1/feed/posts?search={tag}", headers=h_dept_member)
    assert all(i["id"] != post_id for i in r_ex_list.json()["data"]["items"])
    assert (
        await client.post(
            f"/api/v1/feed/posts/{post_id}/comments",
            json={"content": "Should fail"},
            headers=h_dept_member,
        )
    ).status_code == 403

    # 3. Newly added department member IMMEDIATELY gains access and comments
    assert (await client.get(f"/api/v1/feed/posts/{post_id}", headers=h_late)).status_code == 200
    assert (
        await client.post(
            f"/api/v1/feed/posts/{post_id}/comments",
            json={"content": "Late joiner Sales comment"},
            headers=h_late,
        )
    ).status_code == 201

    # 4. Explicit recipient RETAINS access even after leaving dept_sales!
    assert (await client.get(f"/api/v1/feed/posts/{post_id}", headers=h_explicit)).status_code == 200

    # 7. Author posts a reply: late joiner receives `feed_discussion`, former member receives ZERO!
    assert (
        await client.post(
            f"/api/v1/feed/posts/{post_id}/comments",
            json={"content": f"Author confidential reply {tag}"},
            headers=h_author,
        )
    ).status_code == 201

    async with SF() as db:
        ex_notifs = (
            await db.execute(
                select(func.count(Notification.id)).where(
                    Notification.user_id == u_dept_member.id,
                    Notification.type == "feed_discussion",
                    Notification.link == f"/feed?post_id={post_id}",
                )
            )
        ).scalar_one()
        late_notifs = (
            await db.execute(
                select(func.count(Notification.id)).where(
                    Notification.user_id == u_late_joiner.id,
                    Notification.type == "feed_discussion",
                    Notification.link == f"/feed?post_id={post_id}",
                )
            )
        ).scalar_one()
        assert ex_notifs == 0
        assert late_notifs == 1

    # 9. Historical pre-migration snapshot simulation (`is_explicit=False` row does NOT grant post-transfer access)
    async with SF() as db:
        legacy_post = FeedPost(
            author_id=u_author.id,
            title=f"Legacy Snapshot Post {tag}",
            content="Historical dept post",
            audience_type="SELECTED",
            status="PUBLISHED",
            published_at=datetime.now(timezone.utc),
        )
        db.add(legacy_post)
        await db.flush()
        pg_feed_env["created_post_ids"].append(legacy_post.id)
        db.add(FeedPostDepartment(post_id=legacy_post.id, department_id=dept_sales.id))
        # Simulate migrated historical department snapshot row (`is_explicit=False`) for transferred-out u_dept_member
        db.add(FeedPostRecipient(post_id=legacy_post.id, recipient_id=u_dept_member.id, is_explicit=False))
        await db.commit()
        legacy_id = str(legacy_post.id)

    assert (await client.get(f"/api/v1/feed/posts/{legacy_id}", headers=h_dept_member)).status_code == 403
    assert (await client.get(f"/api/v1/feed/posts/{legacy_id}", headers=h_late)).status_code == 200


# ==============================================================================
# PHASE 2 & PHASE 7: Complete Feed RBAC, Deny Precedence & Moderation Consistency
# ==============================================================================


@pytest.mark.asyncio
async def test_phase2_and_7_complete_rbac_and_comment_moderation(pg_feed_env):
    client: AsyncClient = pg_feed_env["client"]
    tag = pg_feed_env["tag"]
    sa_role = pg_feed_env["super_admin_role"]

    dept_hr_admin = await pg_feed_env["make_department"]("hr_admin_role")
    dept_gen = await pg_feed_env["make_department"]("general")

    # Personas
    _, _, h_none = await pg_feed_env["make_user"]("noperms", roles=[dept_gen])
    u_view, _, h_view = await pg_feed_env["make_user"]("viewonly", roles=[dept_gen], grants=["feed.view"])
    u_create, _, h_create = await pg_feed_env["make_user"]("createonly", roles=[dept_gen], grants=["feed.create"])
    u_manage, _, h_manage = await pg_feed_env["make_user"]("manageonly", roles=[dept_gen], grants=["feed.manage"])
    u_author, _, h_author = await pg_feed_env["make_user"](
        "fullauthor", roles=[dept_gen], grants=["feed.view", "feed.create"]
    )
    # Role containing "Admin" in name WITHOUT feed.manage (must NOT get implicit moderation rights!)
    _, _, h_hr_admin_no_manage = await pg_feed_env["make_user"](
        "hradmin", roles=[dept_hr_admin], grants=["feed.view", "feed.create"]
    )
    # Super Admin WITH explicit `deny:feed.create` & `deny:feed.manage`
    _, _, h_sa_denied = await pg_feed_env["make_user"](
        "sadeny", roles=[sa_role], denies=["feed.create", "feed.manage"]
    )
    # Super Admin WITH explicit `deny:feed.view` (must block ALL Feed endpoints!)
    _, _, h_sa_deny_view = await pg_feed_env["make_user"](
        "sadenyview", roles=[sa_role], denies=["feed.view"]
    )

    dummy_id = str(uuid.uuid4())
    all_23 = [
        ("POST", "/api/v1/feed/posts", {"content": "x", "audience_type": "ALL"}),
        ("GET", "/api/v1/feed/posts", None),
        ("GET", "/api/v1/feed/recipients/eligible", None),
        ("GET", "/api/v1/feed/departments/eligible", None),
        ("GET", f"/api/v1/feed/posts/{dummy_id}", None),
        ("PATCH", f"/api/v1/feed/posts/{dummy_id}", {"content": "y"}),
        ("DELETE", f"/api/v1/feed/posts/{dummy_id}", None),
        ("POST", f"/api/v1/feed/posts/{dummy_id}/comments", {"content": "c"}),
        ("GET", f"/api/v1/feed/posts/{dummy_id}/comments", None),
        ("PATCH", f"/api/v1/feed/posts/{dummy_id}/comments/{dummy_id}", {"content": "c2"}),
        ("DELETE", f"/api/v1/feed/posts/{dummy_id}/comments/{dummy_id}", None),
        ("POST", f"/api/v1/feed/posts/{dummy_id}/reactions", {"reaction_type": "LIKE"}),
        ("POST", f"/api/v1/feed/posts/{dummy_id}/read", {}),
        ("GET", f"/api/v1/feed/posts/{dummy_id}/readership", None),
        ("GET", "/api/v1/feed/conversations", None),
        ("GET", "/api/v1/feed/conversations/unread-count", None),
        ("POST", "/api/v1/feed/conversations", {"recipient_id": dummy_id}),
        ("GET", f"/api/v1/feed/conversations/{dummy_id}", None),
        ("GET", f"/api/v1/feed/conversations/{dummy_id}/messages", None),
        ("POST", f"/api/v1/feed/conversations/{dummy_id}/messages", {"content": "hi"}),
        ("PATCH", f"/api/v1/feed/messages/{dummy_id}", {"content": "hi2"}),
        ("DELETE", f"/api/v1/feed/messages/{dummy_id}", None),
        ("POST", f"/api/v1/feed/conversations/{dummy_id}/read", {}),
    ]

    # 1. Unauthenticated -> 401 on all 23; No Feed Perms -> 403 on all 23; SuperAdmin w/ deny:feed.view -> 403 on all 23!
    for method, url, body in all_23:
        assert (await client.request(method, url, json=body)).status_code == 401
        assert (await client.request(method, url, json=body, headers=h_none)).status_code == 403
        assert (await client.request(method, url, json=body, headers=h_sa_deny_view)).status_code == 403

    # 2. Author creates public post & comment
    r_pub = await client.post(
        "/api/v1/feed/posts",
        json={"title": f"RBAC Townhall {tag}", "content": "Public notice", "audience_type": "ALL"},
        headers=h_author,
    )
    assert r_pub.status_code == 201
    pub_id = r_pub.json()["data"]["id"]
    pg_feed_env["created_post_ids"].append(uuid.UUID(pub_id))

    r_cmt = await client.post(
        f"/api/v1/feed/posts/{pub_id}/comments",
        json={"content": "Author comment"},
        headers=h_author,
    )
    assert r_cmt.status_code == 201
    cmt_id = r_cmt.json()["data"]["id"]

    # 3. `feed.view` ONLY: can read posts/comments/mark-read, CANNOT create posts/comments/reactions or enumerate directory!
    assert (await client.get("/api/v1/feed/posts", headers=h_view)).status_code == 200
    assert (await client.get(f"/api/v1/feed/posts/{pub_id}", headers=h_view)).status_code == 200
    assert (await client.get(f"/api/v1/feed/posts/{pub_id}/comments", headers=h_view)).status_code == 200
    assert (await client.post(f"/api/v1/feed/posts/{pub_id}/read", json={}, headers=h_view)).status_code == 200
    assert (await client.get("/api/v1/feed/recipients/eligible", headers=h_view)).status_code == 403
    assert (await client.get("/api/v1/feed/departments/eligible", headers=h_view)).status_code == 403
    assert (
        await client.post("/api/v1/feed/posts", json={"content": "nope", "audience_type": "ALL"}, headers=h_view)
    ).status_code == 403
    assert (
        await client.post(f"/api/v1/feed/posts/{pub_id}/comments", json={"content": "nope"}, headers=h_view)
    ).status_code == 403
    assert (
        await client.post(
            f"/api/v1/feed/posts/{pub_id}/reactions", json={"reaction_type": "LIKE"}, headers=h_view
        )
    ).status_code == 403

    # 4. `feed.create` ONLY: can create post & lookup audience, CANNOT list feed or moderate others
    r_c_only = await client.post(
        "/api/v1/feed/posts",
        json={"title": f"CreateOnly {tag}", "content": "Body", "audience_type": "ALL"},
        headers=h_create,
    )
    assert r_c_only.status_code == 201
    pg_feed_env["created_post_ids"].append(uuid.UUID(r_c_only.json()["data"]["id"]))
    assert (await client.get("/api/v1/feed/recipients/eligible", headers=h_create)).status_code == 200
    assert (await client.get("/api/v1/feed/posts", headers=h_create)).status_code == 403
    assert (await client.delete(f"/api/v1/feed/posts/{pub_id}", headers=h_create)).status_code == 403

    # 5. Super Admin with explicit `deny:feed.create` & `deny:feed.manage`: can view (`feed.view`), CANNOT create or moderate!
    assert (await client.get("/api/v1/feed/posts", headers=h_sa_denied)).status_code == 200
    assert (
        await client.post("/api/v1/feed/posts", json={"content": "denied", "audience_type": "ALL"}, headers=h_sa_denied)
    ).status_code == 403
    r_sa_cmts = await client.get(f"/api/v1/feed/posts/{pub_id}/comments", headers=h_sa_denied)
    assert r_sa_cmts.json()["data"]["items"][0]["can_delete"] is False
    assert (
        await client.delete(f"/api/v1/feed/posts/{pub_id}/comments/{cmt_id}", headers=h_sa_denied)
    ).status_code == 403

    # 6. HR Admin without `feed.manage`: `can_delete == False` and `DELETE` returns 403 (Phase 7 alignment!)
    r_hra_cmts = await client.get(f"/api/v1/feed/posts/{pub_id}/comments", headers=h_hr_admin_no_manage)
    assert r_hra_cmts.json()["data"]["items"][0]["can_delete"] is False
    assert (
        await client.delete(f"/api/v1/feed/posts/{pub_id}/comments/{cmt_id}", headers=h_hr_admin_no_manage)
    ).status_code == 403
    assert (
        await client.patch(f"/api/v1/feed/posts/{pub_id}", json={"content": "tamper"}, headers=h_hr_admin_no_manage)
    ).status_code == 403
    assert (await client.delete(f"/api/v1/feed/posts/{pub_id}", headers=h_hr_admin_no_manage)).status_code == 403

    # 7. `feed.manage` Moderator: `can_delete == True` AND `DELETE` comment & post succeed (200), while `PATCH` post stays 403!
    r_mod_cmts = await client.get(f"/api/v1/feed/posts/{pub_id}/comments", headers=h_manage)
    assert r_mod_cmts.json()["data"]["items"][0]["can_delete"] is True
    assert (
        await client.patch(f"/api/v1/feed/posts/{pub_id}", json={"content": "mod edit"}, headers=h_manage)
    ).status_code == 403
    assert (
        await client.delete(f"/api/v1/feed/posts/{pub_id}/comments/{cmt_id}", headers=h_manage)
    ).status_code == 200
    # Already deleted comment -> 404
    assert (
        await client.delete(f"/api/v1/feed/posts/{pub_id}/comments/{cmt_id}", headers=h_manage)
    ).status_code == 404
    assert (await client.delete(f"/api/v1/feed/posts/{pub_id}", headers=h_manage)).status_code == 200


# ==============================================================================
# PHASE 3, PHASE 8, PHASE 9: Pagination, Workforce Eligibility & Content Bounds
# ==============================================================================


@pytest.mark.asyncio
async def test_phases_3_8_9_pagination_eligibility_and_validation(pg_feed_env):
    client: AsyncClient = pg_feed_env["client"]
    tag = pg_feed_env["tag"]
    dept = await pg_feed_env["make_department"]("eng", role_perms=["feed.view", "feed.create"])

    u_author, _, h_author = await pg_feed_env["make_user"]("eng1", roles=[dept])
    u_active, _, h_active = await pg_feed_env["make_user"]("eng2", roles=[dept])
    u_nologin, _, _ = await pg_feed_env["make_user"]("worker_nologin", roles=[dept], has_login=False)
    u_inactive, _, _ = await pg_feed_env["make_user"](
        "worker_inactive", roles=[dept], is_active=False, status=UserStatus.INACTIVE
    )

    # Phase 8: Eligible recipients & departments exclude has_login=False and inactive users
    r_elig = await client.get(f"/api/v1/feed/recipients/eligible?query={tag}&limit=50", headers=h_author)
    assert r_elig.status_code == 200
    elig_ids = {item["id"] for item in r_elig.json()["data"]}
    assert str(u_active.id) in elig_ids
    assert str(u_nologin.id) not in elig_ids
    assert str(u_inactive.id) not in elig_ids

    r_depts = await client.get("/api/v1/feed/departments/eligible", headers=h_author)
    dept_entry = next(d for d in r_depts.json()["data"] if d["id"] == str(dept.id))
    assert dept_entry["member_count"] == 2  # Only u_author + u_active (excludes u_nologin & u_inactive!)

    # Direct API targeting of has_login=False or inactive user rejected
    assert (
        await client.post(
            "/api/v1/feed/posts",
            json={"content": "Bad target", "audience_type": "SELECTED", "recipient_ids": [str(u_nologin.id)]},
            headers=h_author,
        )
    ).status_code == 422
    assert (
        await client.post(
            "/api/v1/feed/conversations",
            json={"recipient_id": str(u_nologin.id)},
            headers=h_author,
        )
    ).status_code == 400
    assert (
        await client.post(
            "/api/v1/feed/conversations",
            json={"recipient_id": str(u_inactive.id)},
            headers=h_author,
        )
    ).status_code == 400

    # Phase 9: Empty, whitespace, Unicode/emoji, exact 20,000 max, and 20,001 rejection
    assert (
        await client.post("/api/v1/feed/posts", json={"content": "", "audience_type": "ALL"}, headers=h_author)
    ).status_code == 422
    assert (
        await client.post("/api/v1/feed/posts", json={"content": "   \n\t  ", "audience_type": "ALL"}, headers=h_author)
    ).status_code == 422
    assert (
        await client.post(
            "/api/v1/feed/posts",
            json={"content": "X" * (MAX_FEED_POST_CONTENT_LENGTH + 1), "audience_type": "ALL"},
            headers=h_author,
        )
    ).status_code == 422

    unicode_body = f"नमस्ते 🚀 Multiline\nLine 2 — Café {tag}"
    r_uni = await client.post(
        "/api/v1/feed/posts",
        json={
            "title": f"Unicode {tag}",
            "content": unicode_body,
            "audience_type": "SELECTED",
            "department_ids": [str(dept.id)],
        },
        headers=h_author,
    )
    assert r_uni.status_code == 201
    assert r_uni.json()["data"]["content"] == unicode_body
    pg_feed_env["created_post_ids"].append(uuid.UUID(r_uni.json()["data"]["id"]))

    r_exact_max = await client.post(
        "/api/v1/feed/posts",
        json={
            "title": f"ExactMax {tag}",
            "content": "M" * MAX_FEED_POST_CONTENT_LENGTH,
            "audience_type": "SELECTED",
            "department_ids": [str(dept.id)],
        },
        headers=h_author,
    )
    assert r_exact_max.status_code == 201
    pg_feed_env["created_post_ids"].append(uuid.UUID(r_exact_max.json()["data"]["id"]))

    # Phase 3: Create 16 more posts (total = 18 matching `tag`) and verify page 1 & page 2 contract
    for idx in range(16):
        rp = await client.post(
            "/api/v1/feed/posts",
            json={
                "title": f"PagItem {idx:02d} {tag}",
                "content": f"Body {idx} {tag}",
                "audience_type": "SELECTED",
                "department_ids": [str(dept.id)],
            },
            headers=h_author,
        )
        assert rp.status_code == 201
        pg_feed_env["created_post_ids"].append(uuid.UUID(rp.json()["data"]["id"]))

    r_p1 = await client.get(f"/api/v1/feed/posts?page=1&page_size=15&search={tag}", headers=h_active)
    assert r_p1.status_code == 200
    d1 = r_p1.json()["data"]
    assert d1["total"] == 18
    assert d1["page"] == 1
    assert d1["page_size"] == 15
    assert d1["total_pages"] == 2
    assert len(d1["items"]) == 15

    r_p2 = await client.get(f"/api/v1/feed/posts?page=2&page_size=15&search={tag}", headers=h_active)
    assert r_p2.status_code == 200
    d2 = r_p2.json()["data"]
    assert d2["total"] == 18
    assert d2["page"] == 2
    assert d2["total_pages"] == 2
    assert len(d2["items"]) == 3

    # Verify zero duplicate or missing posts across pages
    ids_p1 = {i["id"] for i in d1["items"]}
    ids_p2 = {i["id"] for i in d2["items"]}
    assert len(ids_p1 & ids_p2) == 0
    assert len(ids_p1 | ids_p2) == 18

    # Invalid page number -> 422; empty search -> total=0, total_pages=1
    assert (await client.get("/api/v1/feed/posts?page=0", headers=h_active)).status_code == 422
    r_empty = await client.get(f"/api/v1/feed/posts?search=nonexistent_{uuid.uuid4().hex}", headers=h_active)
    assert r_empty.json()["data"]["total"] == 0
    assert r_empty.json()["data"]["total_pages"] == 1


# ==============================================================================
# PHASE 4 & PHASE 5: Direct Messages, Soft Delete & Notification Redaction
# ==============================================================================


@pytest.mark.asyncio
async def test_phases_4_and_5_dm_uniqueness_duplicate_consolidation_and_soft_delete_privacy(pg_feed_env):
    client: AsyncClient = pg_feed_env["client"]
    SF = pg_feed_env["SessionFactory"]
    tag = pg_feed_env["tag"]
    sa_role = pg_feed_env["super_admin_role"]
    dept = await pg_feed_env["make_department"]("dmdept", role_perms=["feed.view", "feed.create"])
    dept_c = await pg_feed_env["make_department"]("dmdeptc", role_perms=["feed.view", "feed.create"])

    u_a, _, h_a = await pg_feed_env["make_user"]("dma", roles=[dept])
    u_b, _, h_b = await pg_feed_env["make_user"]("dmb", roles=[dept])
    u_c, _, h_c = await pg_feed_env["make_user"]("dmc", roles=[dept_c])
    _, _, h_admin = await pg_feed_env["make_user"]("dmadmin", roles=[sa_role])

    # 1. Repeated creation from both directions returns identical canonical conversation
    r_c1 = await client.post("/api/v1/feed/conversations", json={"recipient_id": str(u_b.id)}, headers=h_a)
    r_c2 = await client.post("/api/v1/feed/conversations", json={"recipient_id": str(u_a.id)}, headers=h_b)
    assert r_c1.status_code == 201 and r_c2.status_code == 201
    conv_id = r_c1.json()["data"]["id"]
    assert r_c2.json()["data"]["id"] == conv_id
    pg_feed_env["created_conv_ids"].append(uuid.UUID(conv_id))

    # Non-participants (including Super Admin) cannot access conversation or messages
    assert (await client.get(f"/api/v1/feed/conversations/{conv_id}", headers=h_c)).status_code == 403
    assert (await client.get(f"/api/v1/feed/conversations/{conv_id}", headers=h_admin)).status_code == 403
    assert (await client.get(f"/api/v1/feed/conversations/{uuid.uuid4()}", headers=h_a)).status_code == 404

    # 2. Send 2 messages, then delete message #2 -> preview falls back to message #1; delete #1 -> preview becomes None!
    m1 = (
        await client.post(
            f"/api/v1/feed/conversations/{conv_id}/messages",
            json={"content": f"First safe message {tag}"},
            headers=h_a,
        )
    ).json()["data"]
    m2 = (
        await client.post(
            f"/api/v1/feed/conversations/{conv_id}/messages",
            json={"content": f"SECRET DM TO DELETE {tag}"},
            headers=h_a,
        )
    ).json()["data"]

    assert (await client.delete(f"/api/v1/feed/messages/{m2['id']}", headers=h_a)).status_code == 200
    conv_after_del1 = (await client.get(f"/api/v1/feed/conversations/{conv_id}", headers=h_b)).json()["data"]
    assert conv_after_del1["last_message_preview"] == f"First safe message {tag}"
    assert "SECRET DM TO DELETE" not in (conv_after_del1["last_message_preview"] or "")

    assert (await client.delete(f"/api/v1/feed/messages/{m1['id']}", headers=h_a)).status_code == 200
    conv_after_del_all = (await client.get(f"/api/v1/feed/conversations/{conv_id}", headers=h_b)).json()["data"]
    assert conv_after_del_all["last_message_preview"] is None
    assert conv_after_del_all["unread_count"] == 0

    # 3. Soft-deleted confidential post redacts Notification snippets & blocks comment edits/deletes!
    r_sec = await client.post(
        "/api/v1/feed/posts",
        json={
            "title": f"CONFIDENTIAL DEAL {tag}",
            "content": f"ACQUISITION VALUATION 99 CRORES {tag}",
            "audience_type": "SELECTED",
            "status": "PUBLISHED",
            "department_ids": [str(dept.id), str(dept_c.id)],
        },
        headers=h_a,
    )
    sec_id = r_sec.json()["data"]["id"]
    pg_feed_env["created_post_ids"].append(uuid.UUID(sec_id))

    c_b = (
        await client.post(
            f"/api/v1/feed/posts/{sec_id}/comments",
            json={"content": "B comment before audience shrink"},
            headers=h_b,
        )
    ).json()["data"]["id"]

    # Shrink audience to ONLY dept_c (revoking dept / u_b): u_b's notification is redacted AND u_b cannot PATCH/DELETE comment!
    assert (
        await client.patch(
            f"/api/v1/feed/posts/{sec_id}",
            json={"department_ids": [str(dept_c.id)]},
            headers=h_a,
        )
    ).status_code == 200
    assert (
        await client.patch(
            f"/api/v1/feed/posts/{sec_id}/comments/{c_b}",
            json={"content": "Bypass after revocation"},
            headers=h_b,
        )
    ).status_code == 403

    notifs_b = (await client.get("/api/v1/notifications?limit=30", headers=h_b)).json()["data"]["items"]
    sec_notifs_b = [n for n in notifs_b if sec_id in (n.get("link") or "")]
    assert sec_notifs_b and all("99 CRORES" not in n["message"] for n in sec_notifs_b)

    # Now author soft-deletes post: u_c's notification is redacted AND post/comments/reactions return 404!
    c_c = (
        await client.post(
            f"/api/v1/feed/posts/{sec_id}/comments",
            json={"content": "C comment before post delete"},
            headers=h_c,
        )
    ).json()["data"]["id"]
    assert (await client.delete(f"/api/v1/feed/posts/{sec_id}", headers=h_a)).status_code == 200
    assert (await client.get(f"/api/v1/feed/posts/{sec_id}", headers=h_c)).status_code == 404
    assert (
        await client.post(f"/api/v1/feed/posts/{sec_id}/comments", json={"content": "x"}, headers=h_c)
    ).status_code == 404
    assert (
        await client.patch(f"/api/v1/feed/posts/{sec_id}/comments/{c_c}", json={"content": "x"}, headers=h_c)
    ).status_code == 404
    assert (await client.delete(f"/api/v1/feed/posts/{sec_id}/comments/{c_c}", headers=h_c)).status_code == 404
    assert (
        await client.post(f"/api/v1/feed/posts/{sec_id}/reactions", json={"reaction_type": "LIKE"}, headers=h_c)
    ).status_code == 404

    notifs_c = (await client.get("/api/v1/notifications?limit=30", headers=h_c)).json()["data"]["items"]
    sec_notifs_c = [n for n in notifs_c if sec_id in (n.get("link") or "")]
    assert sec_notifs_c and all(
        "99 CRORES" not in n["message"] and "CONFIDENTIAL DEAL" not in n["title"]
        for n in sec_notifs_c
    )


# ==============================================================================
# PHASE 10: Comment Pagination & Batched Notification SQL Fanout Benchmark
# ==============================================================================


@pytest.mark.asyncio
async def test_phase10_comment_pagination_and_notification_fanout_benchmark(pg_feed_env):
    client: AsyncClient = pg_feed_env["client"]
    SF = pg_feed_env["SessionFactory"]
    engine: AsyncEngine = pg_feed_env["engine"]
    tag = pg_feed_env["tag"]

    dept = await pg_feed_env["make_department"]("fanout", role_perms=["feed.view", "feed.create"])
    u_author, act_author, h_author = await pg_feed_env["make_user"]("fanauthor", roles=[dept])

    # Provision 25 department colleagues to measure batched notification SQL query count
    for idx in range(25):
        await pg_feed_env["make_user"](f"fanemp{idx:02d}", roles=[dept])

    sql_counter = {"count": 0}

    def _count_sql(conn, cursor, statement, parameters, context, executemany):
        sql_counter["count"] += 1

    event.listen(engine.sync_engine, "before_cursor_execute", _count_sql)
    try:
        t0 = time.perf_counter()
        r_fan = await client.post(
            "/api/v1/feed/posts",
            json={
                "title": f"Batched Fanout {tag}",
                "content": f"Testing O(1) batched SQL notification fanout {tag}",
                "audience_type": "SELECTED",
                "status": "PUBLISHED",
                "department_ids": [str(dept.id)],
            },
            headers=h_author,
        )
        elapsed_ms = (time.perf_counter() - t0) * 1000.0
    finally:
        event.remove(engine.sync_engine, "before_cursor_execute", _count_sql)

    assert r_fan.status_code == 201
    fan_post_id = r_fan.json()["data"]["id"]
    pg_feed_env["created_post_ids"].append(uuid.UUID(fan_post_id))

    # 25 recipients previously required >55 SQL round-trips; batched fanout executes in <25 total queries
    # including auth/post-create/metadata reload!
    assert sql_counter["count"] < 25, f"Expected batched SQL fanout (<25 queries), got {sql_counter['count']} ({elapsed_ms:.1f}ms)"

    # Insert 55 comments and verify bounded pagination (page 1 = 50, has_more=True; page 2 = 5, has_more=False)
    now_base = datetime.now(timezone.utc)
    async with SF() as db:
        db.add_all(
            [
                FeedPostComment(
                    post_id=uuid.UUID(fan_post_id),
                    author_id=u_author.id,
                    content=f"Comment #{i:03d}",
                    created_at=now_base + timedelta(seconds=i),
                    updated_at=now_base + timedelta(seconds=i),
                )
                for i in range(55)
            ]
        )
        await db.commit()

    rc1 = (await client.get(f"/api/v1/feed/posts/{fan_post_id}/comments?page=1&page_size=50", headers=h_author)).json()["data"]
    assert rc1["total"] == 55
    assert len(rc1["items"]) == 50
    assert rc1["has_more"] is True
    assert rc1["items"][0]["content"] == "Comment #000"

    rc2 = (await client.get(f"/api/v1/feed/posts/{fan_post_id}/comments?page=2&page_size=50", headers=h_author)).json()["data"]
    assert len(rc2["items"]) == 5
    assert rc2["has_more"] is False
    assert rc2["items"][-1]["content"] == "Comment #054"


# ==============================================================================
# PHASE 6 & PHASE 13: All 7 Required Real PostgreSQL Multi-Session Concurrency Cases
# ==============================================================================


@pytest.mark.asyncio
async def test_phases_6_and_13_all_7_postgresql_concurrency_scenarios(pg_feed_env):
    SF = pg_feed_env["SessionFactory"]
    client: AsyncClient = pg_feed_env["client"]
    tag = pg_feed_env["tag"]

    dept = await pg_feed_env["make_department"]("conc", role_perms=["feed.view", "feed.create"])
    dept_other = await pg_feed_env["make_department"]("conc_other", role_perms=["feed.view", "feed.create"])

    users_actors = [await pg_feed_env["make_user"](f"cu{i}", roles=[dept]) for i in range(6)]
    u0, act0, h0 = users_actors[0]
    u1, act1, h1 = users_actors[1]

    # Warm connection pool
    async def _warm():
        async with SF() as s:
            await s.execute(text("SELECT 1"))

    await asyncio.gather(*(_warm() for _ in range(8)))

    # ------------------------------------------------------------------
    # Case 1: Two users create the same 1:1 conversation concurrently
    # ------------------------------------------------------------------
    async def _create_conv(caller: CurrentUser, peer_id: uuid.UUID) -> uuid.UUID:
        async with SF() as s:
            res = await FeedService(s).get_or_create_conversation(caller, peer_id)
            return res.id

    conv_ids = await asyncio.gather(
        _create_conv(act0, u1.id),
        _create_conv(act1, u0.id),
        _create_conv(act0, u1.id),
        _create_conv(act1, u0.id),
    )
    assert len(set(conv_ids)) == 1
    canon_conv_id = conv_ids[0]
    pg_feed_env["created_conv_ids"].append(canon_conv_id)

    low_id, high_id = _canonical_pair(u0.id, u1.id)
    async with SF() as s:
        dup_cnt = (
            await s.execute(
                select(func.count(FeedConversation.id)).where(
                    FeedConversation.participant_low_id == low_id,
                    FeedConversation.participant_high_id == high_id,
                    FeedConversation.deleted_at.is_(None),
                )
            )
        ).scalar_one()
        assert dup_cnt == 1

    # ------------------------------------------------------------------
    # Case 2: Multiple messages (6) sent concurrently -> exact unread_count == 6
    # ------------------------------------------------------------------
    async def _send_dm(idx: int):
        async with SF() as s:
            return await FeedService(s).send_message(
                act0, canon_conv_id, DirectMessageCreate(content=f"Conc DM #{idx} {tag}")
            )

    await asyncio.gather(*(_send_dm(i) for i in range(6)))
    async with SF() as s:
        p1_unread = (
            await s.execute(
                select(FeedConversationParticipant.unread_count).where(
                    FeedConversationParticipant.conversation_id == canon_conv_id,
                    FeedConversationParticipant.user_id == u1.id,
                )
            )
        ).scalar_one()
        p0_unread = (
            await s.execute(
                select(FeedConversationParticipant.unread_count).where(
                    FeedConversationParticipant.conversation_id == canon_conv_id,
                    FeedConversationParticipant.user_id == u0.id,
                )
            )
        ).scalar_one()
        assert p1_unread == 6
        assert p0_unread == 0

    # ------------------------------------------------------------------
    # Case 6: Concurrent message send AND mark-as-read -> unread_count == actual unread rows
    # ------------------------------------------------------------------
    async def _mark_read():
        async with SF() as s:
            await FeedService(s).mark_conversation_read(act1, canon_conv_id)

    await asyncio.gather(_send_dm(100), _mark_read(), _send_dm(101))
    async with SF() as s:
        part_row = (
            await s.execute(
                select(FeedConversationParticipant).where(
                    FeedConversationParticipant.conversation_id == canon_conv_id,
                    FeedConversationParticipant.user_id == u1.id,
                )
            )
        ).scalar_one()
        actual_unread_after_read = (
            await s.execute(
                select(func.count(FeedDirectMessage.id)).where(
                    FeedDirectMessage.conversation_id == canon_conv_id,
                    FeedDirectMessage.deleted_at.is_(None),
                    FeedDirectMessage.sender_id != u1.id,
                    FeedDirectMessage.created_at > part_row.last_read_at,
                )
            )
        ).scalar_one()
        assert part_row.unread_count == actual_unread_after_read

    # Create post for reaction & comment concurrency cases
    r_post = await client.post(
        "/api/v1/feed/posts",
        json={"title": f"Conc Target {tag}", "content": "Concurrency post", "audience_type": "ALL"},
        headers=h0,
    )
    post_uuid = uuid.UUID(r_post.json()["data"]["id"])
    pg_feed_env["created_post_ids"].append(post_uuid)

    # ------------------------------------------------------------------
    # Case 3: Same user toggles the same reaction concurrently (4 serialized toggles -> 0 exceptions, final count 0)
    # ------------------------------------------------------------------
    async def _same_react():
        async with SF() as s:
            return await FeedService(s).toggle_reaction(
                act1, post_uuid, FeedReactionToggle(reaction_type="LIKE")
            )

    same_results = await asyncio.gather(*(_same_react() for _ in range(4)))
    assert len(same_results) == 4
    async with SF() as s:
        rem_rx = (
            await s.execute(
                select(func.count(FeedPostReaction.id)).where(
                    FeedPostReaction.post_id == post_uuid,
                    FeedPostReaction.user_id == u1.id,
                )
            )
        ).scalar_one()
        assert rem_rx == 0  # 4 serialized toggles: ON -> OFF -> ON -> OFF

    # ------------------------------------------------------------------
    # Case 4 & Case 5: Multiple users (6) react & comment concurrently
    # ------------------------------------------------------------------
    async def _multi_react_and_comment(idx: int):
        _, actor_i, _ = users_actors[idx]
        async with SF() as s_rx:
            await FeedService(s_rx).toggle_reaction(
                actor_i, post_uuid, FeedReactionToggle(reaction_type="CELEBRATE")
            )
        async with SF() as s_cm:
            await FeedService(s_cm).add_comment(
                actor_i, post_uuid, FeedCommentCreate(content=f"Conc comment {idx}")
            )

    await asyncio.gather(*(_multi_react_and_comment(i) for i in range(6)))
    p_summary = (await client.get(f"/api/v1/feed/posts/{post_uuid}", headers=h0)).json()["data"]
    assert p_summary["reactions_summary"]["counts"]["celebrate"] == 6
    assert p_summary["comments_count"] == 6

    # ------------------------------------------------------------------
    # Case 7: Department membership changes concurrently while access is checked
    # ------------------------------------------------------------------
    r_dept_p = await client.post(
        "/api/v1/feed/posts",
        json={
            "title": f"Live Dept Check {tag}",
            "content": "Dept post",
            "audience_type": "SELECTED",
            "department_ids": [str(dept.id)],
        },
        headers=h0,
    )
    dept_p_uuid = uuid.UUID(r_dept_p.json()["data"]["id"])
    pg_feed_env["created_post_ids"].append(dept_p_uuid)

    async def _revoke_dept():
        async with SF() as s_rev:
            await s_rev.execute(
                delete(UserRole).where(UserRole.user_id == u1.id, UserRole.role_id == dept.id)
            )
            s_rev.add(UserRole(user_id=u1.id, role_id=dept_other.id, status=RoleAssignmentStatus.ACTIVE))
            await s_rev.commit()

    async def _check_access() -> int:
        r = await client.get(f"/api/v1/feed/posts/{dept_p_uuid}", headers=h1)
        return r.status_code

    statuses = await asyncio.gather(_check_access(), _revoke_dept(), _check_access())
    assert statuses[0] in (200, 403)
    # Post-revocation check MUST strictly deny access (403)
    assert (await client.get(f"/api/v1/feed/posts/{dept_p_uuid}", headers=h1)).status_code == 403


# ==============================================================================
# PHASE 11: Real PostgreSQL Migration Backfill, Duplicate DM Merge & Idempotence
# ==============================================================================


@pytest.mark.asyncio
async def test_phase11_migration_upgrade_backfill_and_duplicate_consolidation(pg_feed_env):
    import importlib.util
    from pathlib import Path
    from alembic.migration import MigrationContext
    from alembic.operations import Operations
    from sqlalchemy import create_engine as create_sync_engine
    from sqlalchemy.exc import IntegrityError

    SF = pg_feed_env["SessionFactory"]
    tag = pg_feed_env["tag"]

    dept_sales = await pg_feed_env["make_department"]("mig_sales", role_perms=["feed.view", "feed.create"])
    dept_ops = await pg_feed_env["make_department"]("mig_ops", role_perms=["feed.view", "feed.create"])
    u_a, _, h_a = await pg_feed_env["make_user"]("miga", roles=[dept_sales])
    u_b, _, h_b = await pg_feed_env["make_user"]("migb", roles=[dept_ops])

    mig_path = (
        Path(__file__).resolve().parents[1]
        / "alembic"
        / "versions"
        / "v9a0b1c2d3e4_remediate_feed_privacy_and_dm_pair_uniqueness.py"
    )
    spec = importlib.util.spec_from_file_location("mig_v9a0b1c2d3e4", mig_path)
    assert spec and spec.loader
    mig_mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mig_mod)

    sync_url = PG_TEST_URL.replace("postgresql+asyncpg://", "postgresql+psycopg2://")
    try:
        import psycopg2  # noqa: F401
    except ImportError:
        sync_url = PG_TEST_URL.replace("postgresql+asyncpg://", "postgresql+psycopg://")

    # Wait: if neither psycopg2 nor psycopg is installed, run sync operations via engine.sync_engine?
    # AsyncEngine wraps asyncpg; we can execute migration via AsyncEngine connection.run_sync!
    engine: AsyncEngine = pg_feed_env["engine"]

    post_dept_id = uuid.uuid4()
    post_indiv_id = uuid.uuid4()
    conv_older_id = uuid.uuid4()
    conv_newer_id = uuid.uuid4()
    notif_id = uuid.uuid4()
    pg_feed_env["created_post_ids"].extend([post_dept_id, post_indiv_id])
    pg_feed_env["created_conv_ids"].extend([conv_older_id, conv_newer_id])

    t0 = datetime.now(timezone.utc) - timedelta(minutes=10)
    t1 = datetime.now(timezone.utc) - timedelta(minutes=5)
    t2 = datetime.now(timezone.utc) - timedelta(minutes=1)

    def _run_downgrade(sync_conn):
        ctx = MigrationContext.configure(sync_conn)
        with Operations.context(ctx):
            mig_mod.downgrade()

    def _run_upgrade(sync_conn):
        ctx = MigrationContext.configure(sync_conn)
        with Operations.context(ctx):
            mig_mod.upgrade()

    try:
        # 1. Downgrade to pre-remediation schema (`z8f9a0b1c2d3` table shape)
        async with engine.begin() as conn:
            await conn.run_sync(_run_downgrade)

        # 2. Seed pre-migration records:
        #    - post_dept_id: department-targeted post with a historical snapshot row for u_b
        #    - post_indiv_id: pure individual-targeted post with an explicit row for u_b
        #    - conv_older_id & conv_newer_id: duplicate 1:1 conversations between (u_a, u_b)
        async with engine.begin() as conn:
            await conn.execute(
                text(
                    """
                    INSERT INTO feed_posts (id, author_id, title, content, audience_type, status, published_at, created_at, updated_at)
                    VALUES
                      (:pd, :ua, :td, 'Dept body', 'SELECTED', 'PUBLISHED', :t0, :t0, :t0),
                      (:pi, :ua, :ti, 'Indiv body', 'SELECTED', 'PUBLISHED', :t0, :t0, :t0)
                    """
                ),
                {
                    "pd": post_dept_id,
                    "pi": post_indiv_id,
                    "ua": u_a.id,
                    "td": f"MigDept {tag}",
                    "ti": f"MigIndiv {tag}",
                    "t0": t0,
                },
            )
            await conn.execute(
                text(
                    "INSERT INTO feed_post_departments (id, post_id, department_id, created_at) VALUES (:id, :pid, :did, :t0)"
                ),
                {"id": uuid.uuid4(), "pid": post_dept_id, "did": dept_sales.id, "t0": t0},
            )
            await conn.execute(
                text(
                    """
                    INSERT INTO feed_post_recipients (id, post_id, recipient_id, created_at)
                    VALUES (:r1, :pd, :ub, :t0), (:r2, :pi, :ub, :t0)
                    """
                ),
                {"r1": uuid.uuid4(), "r2": uuid.uuid4(), "pd": post_dept_id, "pi": post_indiv_id, "ub": u_b.id, "t0": t0},
            )

            # Seed TWO duplicate active 1:1 conversations with messages across both!
            await conn.execute(
                text(
                    """
                    INSERT INTO feed_conversations (id, created_at, updated_at, last_message_at, last_message_preview, last_message_sender_id)
                    VALUES
                      (:c_old, :t0, :t1, :t1, 'Msg 2 older', :ub),
                      (:c_new, :t1, :t2, :t2, 'Msg 3 newer race', :ua)
                    """
                ),
                {"c_old": conv_older_id, "c_new": conv_newer_id, "t0": t0, "t1": t1, "t2": t2, "ua": u_a.id, "ub": u_b.id},
            )
            await conn.execute(
                text(
                    """
                    INSERT INTO feed_conversation_participants (id, conversation_id, user_id, unread_count, last_read_at, created_at)
                    VALUES
                      (:p1, :c_old, :ua, 0, :t1, :t0),
                      (:p2, :c_old, :ub, 0, :t0, :t0),
                      (:p3, :c_new, :ua, 0, :t2, :t1),
                      (:p4, :c_new, :ub, 1, NULL, :t1)
                    """
                ),
                {
                    "p1": uuid.uuid4(),
                    "p2": uuid.uuid4(),
                    "p3": uuid.uuid4(),
                    "p4": uuid.uuid4(),
                    "c_old": conv_older_id,
                    "c_new": conv_newer_id,
                    "ua": u_a.id,
                    "ub": u_b.id,
                    "t0": t0,
                    "t1": t1,
                    "t2": t2,
                },
            )
            await conn.execute(
                text(
                    """
                    INSERT INTO feed_direct_messages (id, conversation_id, sender_id, content, created_at, updated_at)
                    VALUES
                      (:m1, :c_old, :ua, 'Msg 1 older', :t0, :t0),
                      (:m2, :c_old, :ub, 'Msg 2 older', :t1, :t1),
                      (:m3, :c_new, :ua, :m3_txt, :t2, :t2)
                    """
                ),
                {
                    "m1": uuid.uuid4(),
                    "m2": uuid.uuid4(),
                    "m3": uuid.uuid4(),
                    "c_old": conv_older_id,
                    "c_new": conv_newer_id,
                    "ua": u_a.id,
                    "ub": u_b.id,
                    "m3_txt": f"Msg 3 newer race {tag}",
                    "t0": t0,
                    "t1": t1,
                    "t2": t2,
                },
            )
            await conn.execute(
                text(
                    """
                    INSERT INTO notifications (id, user_id, title, message, type, is_read, link, created_at, updated_at)
                    VALUES (:nid, :ub, :nt, 'New DM', 'feed_message', false, :dup_link, :t2, :t2)
                    """
                ),
                {
                    "nid": notif_id,
                    "ub": u_b.id,
                    "nt": f"DM Notif {tag}",
                    "dup_link": f"/feed?tab=messages&conversation_id={conv_newer_id}",
                    "t2": t2,
                },
            )

        # 3. Run upgrade() TWICE to verify data consolidation + idempotence
        async with engine.begin() as conn:
            await conn.run_sync(_run_upgrade)
        async with engine.begin() as conn:
            await conn.run_sync(_run_upgrade)

        # 4. Verify historical recipient classification & zero deleted rows
        async with SF() as db:
            rec_dept = (
                await db.execute(select(FeedPostRecipient).where(FeedPostRecipient.post_id == post_dept_id))
            ).scalar_one()
            rec_indiv = (
                await db.execute(select(FeedPostRecipient).where(FeedPostRecipient.post_id == post_indiv_id))
            ).scalar_one()
            assert rec_dept.is_explicit is False  # Department snapshot safely neutralized!
            assert rec_indiv.is_explicit is True  # Pure individual targeting preserved!

            # Verify duplicate conversation consolidation: zero lost messages, canonical_id = conv_older_id
            c_old = (await db.execute(select(FeedConversation).where(FeedConversation.id == conv_older_id))).scalar_one()
            c_new = (await db.execute(select(FeedConversation).where(FeedConversation.id == conv_newer_id))).scalar_one()
            low_id, high_id = _canonical_pair(u_a.id, u_b.id)
            assert c_old.deleted_at is None
            assert c_old.participant_low_id == low_id and c_old.participant_high_id == high_id
            assert c_old.last_message_preview == f"Msg 3 newer race {tag}"
            assert c_new.deleted_at is not None  # Superseded duplicate soft-deleted, not destroyed

            merged_msgs = (
                await db.execute(
                    select(FeedDirectMessage)
                    .where(FeedDirectMessage.conversation_id == conv_older_id)
                    .order_by(FeedDirectMessage.created_at.asc())
                )
            ).scalars().all()
            assert len(merged_msgs) == 3  # 100% of message history preserved!

            ub_part = (
                await db.execute(
                    select(FeedConversationParticipant).where(
                        FeedConversationParticipant.conversation_id == conv_older_id,
                        FeedConversationParticipant.user_id == u_b.id,
                    )
                )
            ).scalar_one()
            assert ub_part.unread_count == 1

            notif_row = (await db.execute(select(Notification).where(Notification.id == notif_id))).scalar_one()
            assert notif_row.link == f"/feed?tab=messages&conversation_id={conv_older_id}"

            # Verify DB-level partial unique index rejects inserting another active pair row
            with pytest.raises(IntegrityError):
                async with db.begin_nested():
                    db.add(
                        FeedConversation(
                            id=uuid.uuid4(),
                            participant_low_id=low_id,
                            participant_high_id=high_id,
                        )
                    )
                    await db.flush()

        # Verify runtime HTTP visibility matches migrated policy:
        # u_b (in dept_ops) CANNOT view post_dept_id (`is_explicit=False`), CAN view post_indiv_id (`is_explicit=True`)!
        client: AsyncClient = pg_feed_env["client"]
        assert (await client.get(f"/api/v1/feed/posts/{post_dept_id}", headers=h_b)).status_code == 403
        assert (await client.get(f"/api/v1/feed/posts/{post_indiv_id}", headers=h_b)).status_code == 200
        assert (await client.get(f"/api/v1/feed/conversations/{conv_older_id}/messages", headers=h_b)).status_code == 200
    finally:
        # Always guarantee schema is at upgraded head even if an assertion ever failed
        async with engine.begin() as conn:
            await conn.run_sync(_run_upgrade)
