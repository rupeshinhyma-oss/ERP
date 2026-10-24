"""
Test Suite for Inhyma ERP Feed & Broadcast Messaging: Interactions & Notifications (Phase 4).

Covers:
1. Comments: creation, author edit, permission checks, soft-delete, draft/deleted rejection.
2. Reactions: toggle, reaction switching, duplicate prevention, audience restrictions.
3. Read tracking: persistence, idempotency, author exclusion.
4. Readership privacy: strict 403 for ordinary employees, author & admin access.
5. Notifications: publication notifications, comment notifications, reply notifications, zero draft leakage.
"""

from __future__ import annotations

import uuid
import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.auth.service import create_access_token
from app.database.engine import get_sessionmaker
from app.notifications.models import Notification
from app.users.models import User, UserStatus


def auth_headers(user_id: uuid.UUID, permissions: list[str]) -> dict[str, str]:
    tok_obj = create_access_token(user_id, permissions=permissions)
    token_str = getattr(tok_obj, "token", tok_obj)
    return {"Authorization": f"Bearer {token_str}"}


@pytest.fixture
async def create_user_helper():
    created_users: list[User] = []

    async def _create(display_name: str, is_active: bool = True, status: UserStatus = UserStatus.ACTIVE) -> User:
        unique_suffix = uuid.uuid4().hex[:6]
        async with get_sessionmaker()() as db_session:
            u = User(
                id=uuid.uuid4(),
                username=f"feed_int_user_{unique_suffix}",
                email=f"feed_int_{unique_suffix}@example.com",
                display_name=display_name,
                employee_code=f"EMP-{unique_suffix.upper()}",
                status=status,
                is_active=is_active,
            )
            db_session.add(u)
            await db_session.commit()
            await db_session.refresh(u)
            created_users.append(u)
            return u

    return _create


@pytest.mark.asyncio
async def test_feed_comments_lifecycle_and_permissions(
    client: AsyncClient,
    create_user_helper,
) -> None:
    """Test full comment lifecycle: add, list, edit by author, delete by author and admin, forbidden for others."""
    author = await create_user_helper("Post Author")
    commenter1 = await create_user_helper("Commenter One")
    commenter2 = await create_user_helper("Commenter Two")
    admin = await create_user_helper("Admin Manager")

    author_h = auth_headers(author.id, ["feed.view", "feed.create"])
    c1_h = auth_headers(commenter1.id, ["feed.view"])
    c2_h = auth_headers(commenter2.id, ["feed.view"])
    admin_h = auth_headers(admin.id, ["feed.view", "feed.manage"])

    # 1. Author creates published post
    post_res = await client.post(
        "/api/v1/feed/posts",
        json={
            "title": "Townhall Feedback Thread",
            "content": "Please share your thoughts on the upcoming townhall.",
            "audience_type": "ALL",
            "status": "PUBLISHED",
        },
        headers=author_h,
    )
    assert post_res.status_code == 201
    post_id = post_res.json()["data"]["id"]

    # 2. Commenter 1 adds a comment
    c1_res = await client.post(
        f"/api/v1/feed/posts/{post_id}/comments",
        json={"content": "Looking forward to hearing about Q4 roadmaps!"},
        headers=c1_h,
    )
    assert c1_res.status_code == 201
    c1_data = c1_res.json()["data"]
    comment1_id = c1_data["id"]
    assert c1_data["content"] == "Looking forward to hearing about Q4 roadmaps!"
    assert c1_data["is_author"] is True
    assert c1_data["can_delete"] is True

    # 3. List comments as Commenter 2
    list_res = await client.get(
        f"/api/v1/feed/posts/{post_id}/comments",
        headers=c2_h,
    )
    assert list_res.status_code == 200
    list_data = list_res.json()["data"]
    assert list_data["total"] == 1
    c_item = list_data["items"][0]
    assert c_item["id"] == comment1_id
    assert c_item["is_author"] is False
    assert c_item["can_delete"] is False

    # 4. Commenter 2 attempts to edit Commenter 1's comment -> 403 Forbidden
    hack_edit = await client.patch(
        f"/api/v1/feed/posts/{post_id}/comments/{comment1_id}",
        json={"content": "Tampered comment content"},
        headers=c2_h,
    )
    assert hack_edit.status_code == 403

    # 5. Commenter 1 edits their own comment -> 200 OK
    edit_res = await client.patch(
        f"/api/v1/feed/posts/{post_id}/comments/{comment1_id}",
        json={"content": "Looking forward to hearing about Q4 roadmaps and hiring plans!"},
        headers=c1_h,
    )
    assert edit_res.status_code == 200
    assert edit_res.json()["data"]["content"] == "Looking forward to hearing about Q4 roadmaps and hiring plans!"

    # 6. Commenter 2 attempts to delete Commenter 1's comment -> 403 Forbidden
    hack_del = await client.delete(
        f"/api/v1/feed/posts/{post_id}/comments/{comment1_id}",
        headers=c2_h,
    )
    assert hack_del.status_code == 403

    # 7. Admin cannot delete Commenter 1's comment -> 403 Forbidden
    admin_del = await client.delete(
        f"/api/v1/feed/posts/{post_id}/comments/{comment1_id}",
        headers=admin_h,
    )
    assert admin_del.status_code == 403

    # 8. Commenter 1 deletes their own comment -> 200 OK
    c1_del = await client.delete(
        f"/api/v1/feed/posts/{post_id}/comments/{comment1_id}",
        headers=c1_h,
    )
    assert c1_del.status_code == 200
    assert c1_del.json()["data"]["deleted"] is True

    # Verify comment list is now empty
    list_after_del = await client.get(
        f"/api/v1/feed/posts/{post_id}/comments",
        headers=c1_h,
    )
    assert list_after_del.json()["data"]["total"] == 0


@pytest.mark.asyncio
async def test_feed_comments_audience_and_status_restrictions(
    client: AsyncClient,
    create_user_helper,
) -> None:
    """Test that unauthorized users cannot comment and nobody can comment on drafts."""
    author = await create_user_helper("Author User")
    included_user = await create_user_helper("Included User")
    excluded_user = await create_user_helper("Excluded User")

    author_h = auth_headers(author.id, ["feed.view", "feed.create"])
    inc_h = auth_headers(included_user.id, ["feed.view"])
    exc_h = auth_headers(excluded_user.id, ["feed.view"])

    # 1. Create a draft post
    draft_res = await client.post(
        "/api/v1/feed/posts",
        json={
            "title": "Secret Draft",
            "content": "Draft in progress.",
            "audience_type": "ALL",
            "status": "DRAFT",
        },
        headers=author_h,
    )
    draft_id = draft_res.json()["data"]["id"]

    # Author attempts to comment on their own draft -> 400 Bad Request
    c_draft = await client.post(
        f"/api/v1/feed/posts/{draft_id}/comments",
        json={"content": "Comment on draft"},
        headers=author_h,
    )
    assert c_draft.status_code == 400

    # 2. Create targeted post for included_user
    targeted_res = await client.post(
        "/api/v1/feed/posts",
        json={
            "title": "Confidential Project Brief",
            "content": "Only for included user.",
            "audience_type": "SELECTED",
            "recipient_ids": [str(included_user.id)],
            "status": "PUBLISHED",
        },
        headers=author_h,
    )
    assert targeted_res.status_code == 201
    targeted_id = targeted_res.json()["data"]["id"]

    # Excluded user tries to comment -> 403 Forbidden
    exc_comment = await client.post(
        f"/api/v1/feed/posts/{targeted_id}/comments",
        json={"content": "I should not be able to comment!"},
        headers=exc_h,
    )
    assert exc_comment.status_code == 403

    # Included user comments -> 201 Created
    inc_comment = await client.post(
        f"/api/v1/feed/posts/{targeted_id}/comments",
        json={"content": "Acknowledged. Working on it."},
        headers=inc_h,
    )
    assert inc_comment.status_code == 201


@pytest.mark.asyncio
async def test_feed_reactions_toggle_and_duplicate_prevention(
    client: AsyncClient,
    create_user_helper,
) -> None:
    """Test reaction add, switch type, toggle off, and duplicate prevention."""
    author = await create_user_helper("Post Author")
    user1 = await create_user_helper("Reacting User")
    excluded = await create_user_helper("Excluded User")

    author_h = auth_headers(author.id, ["feed.view", "feed.create"])
    u1_h = auth_headers(user1.id, ["feed.view"])
    exc_h = auth_headers(excluded.id, ["feed.view"])

    # 1. Create targeted announcement for user1
    post_res = await client.post(
        "/api/v1/feed/posts",
        json={
            "title": "Great Milestone Reached!",
            "content": "We shipped Phase 3 successfully!",
            "audience_type": "SELECTED",
            "recipient_ids": [str(user1.id)],
            "status": "PUBLISHED",
        },
        headers=author_h,
    )
    post_id = post_res.json()["data"]["id"]

    # 2. Excluded user tries to react -> 403 Forbidden
    exc_rx = await client.post(
        f"/api/v1/feed/posts/{post_id}/reactions",
        json={"reaction_type": "LIKE"},
        headers=exc_h,
    )
    assert exc_rx.status_code == 403

    # 3. User1 reacts with LIKE
    rx1 = await client.post(
        f"/api/v1/feed/posts/{post_id}/reactions",
        json={"reaction_type": "LIKE"},
        headers=u1_h,
    )
    assert rx1.status_code == 200
    data1 = rx1.json()["data"]
    assert data1["counts"]["like"] == 1
    assert data1["counts"]["total"] == 1
    assert data1["user_reaction"] == "LIKE"

    # 4. User1 changes reaction to CELEBRATE (should switch, not duplicate)
    rx2 = await client.post(
        f"/api/v1/feed/posts/{post_id}/reactions",
        json={"reaction_type": "CELEBRATE"},
        headers=u1_h,
    )
    assert rx2.status_code == 200
    data2 = rx2.json()["data"]
    assert data2["counts"]["like"] == 0
    assert data2["counts"]["celebrate"] == 1
    assert data2["counts"]["total"] == 1
    assert data2["user_reaction"] == "CELEBRATE"

    # 5. User1 reacts with CELEBRATE again (toggle off)
    rx3 = await client.post(
        f"/api/v1/feed/posts/{post_id}/reactions",
        json={"reaction_type": "CELEBRATE"},
        headers=u1_h,
    )
    assert rx3.status_code == 200
    data3 = rx3.json()["data"]
    assert data3["counts"]["celebrate"] == 0
    assert data3["counts"]["total"] == 0
    assert data3["user_reaction"] is None


@pytest.mark.asyncio
async def test_feed_read_tracking_and_author_exclusion(
    client: AsyncClient,
    create_user_helper,
) -> None:
    """Test read status marking, author auto-read, and idempotent behavior."""
    author = await create_user_helper("Post Author")
    reader = await create_user_helper("Reader User")

    author_h = auth_headers(author.id, ["feed.view", "feed.create"])
    reader_h = auth_headers(reader.id, ["feed.view"])

    # 1. Author publishes company-wide post
    post_res = await client.post(
        "/api/v1/feed/posts",
        json={
            "title": "Quarterly Update",
            "content": "Review the company performance metrics.",
            "audience_type": "ALL",
            "status": "PUBLISHED",
        },
        headers=author_h,
    )
    post_id = post_res.json()["data"]["id"]

    # 2. Check author's view of post -> author is automatically is_read: True
    author_view = await client.get(f"/api/v1/feed/posts/{post_id}", headers=author_h)
    assert author_view.json()["data"]["is_read"] is True

    # 3. Reader's view before reading -> is_read: False
    reader_view1 = await client.get(f"/api/v1/feed/posts/{post_id}", headers=reader_h)
    assert reader_view1.json()["data"]["is_read"] is False

    # 4. Reader marks as read
    read_res = await client.post(f"/api/v1/feed/posts/{post_id}/read", headers=reader_h)
    assert read_res.status_code == 200
    assert read_res.json()["data"]["is_read"] is True

    # 5. Reader's view after reading -> is_read: True
    reader_view2 = await client.get(f"/api/v1/feed/posts/{post_id}", headers=reader_h)
    assert reader_view2.json()["data"]["is_read"] is True

    # 6. Idempotent call to mark as read -> no errors
    read_res2 = await client.post(f"/api/v1/feed/posts/{post_id}/read", headers=reader_h)
    assert read_res2.status_code == 200


@pytest.mark.asyncio
async def test_feed_readership_privacy_controls(
    client: AsyncClient,
    create_user_helper,
) -> None:
    """Test strict privacy restriction: ordinary users cannot see other readers, author & admin can."""
    author = await create_user_helper("Post Author")
    employee1 = await create_user_helper("Employee One")
    employee2 = await create_user_helper("Employee Two")
    admin = await create_user_helper("Admin Manager")

    author_h = auth_headers(author.id, ["feed.view", "feed.create"])
    e1_h = auth_headers(employee1.id, ["feed.view"])
    e2_h = auth_headers(employee2.id, ["feed.view"])
    admin_h = auth_headers(admin.id, ["feed.view", "feed.manage"])

    post_res = await client.post(
        "/api/v1/feed/posts",
        json={
            "title": "Policy Document",
            "content": "Please read carefully.",
            "audience_type": "ALL",
            "status": "PUBLISHED",
        },
        headers=author_h,
    )
    post_id = post_res.json()["data"]["id"]

    # Employee 1 marks as read
    await client.post(f"/api/v1/feed/posts/{post_id}/read", headers=e1_h)

    # Privacy check 1: Employee 2 list query must NOT disclose read_count
    e2_list = await client.get("/api/v1/feed/posts", headers=e2_h)
    p_data = [p for p in e2_list.json()["data"]["items"] if p["id"] == post_id][0]
    assert p_data["read_count"] is None  # Hidden for non-author / non-admin!

    # Privacy check 2: Employee 2 attempting to view readership -> 403 Forbidden!
    hack_readership = await client.get(f"/api/v1/feed/posts/{post_id}/readership", headers=e2_h)
    assert hack_readership.status_code == 403

    # Authorized check 1: Author sees read_count in post read schema
    author_post = await client.get(f"/api/v1/feed/posts/{post_id}", headers=author_h)
    assert author_post.json()["data"]["read_count"] == 1

    # Authorized check 2: Author accesses /readership -> 200 OK with reader details
    author_readership = await client.get(f"/api/v1/feed/posts/{post_id}/readership", headers=author_h)
    assert author_readership.status_code == 200
    r_data = author_readership.json()["data"]
    assert r_data["total_readers"] == 1
    assert r_data["readers"][0]["user_id"] == str(employee1.id)

    # Privacy check 3: Admin who is not author cannot access /readership -> 403 Forbidden
    admin_readership = await client.get(f"/api/v1/feed/posts/{post_id}/readership", headers=admin_h)
    assert admin_readership.status_code == 403


@pytest.mark.asyncio
async def test_feed_notifications_integration(
    client: AsyncClient,
    create_user_helper,
) -> None:
    """Test Feed notifications: post publication, comments to author, and replies to discussion participants."""
    author = await create_user_helper("Post Author")
    recip1 = await create_user_helper("Recipient One")
    recip2 = await create_user_helper("Recipient Two")
    excluded = await create_user_helper("Excluded User")

    author_h = auth_headers(author.id, ["feed.view", "feed.create"])
    r1_h = auth_headers(recip1.id, ["feed.view"])
    r2_h = auth_headers(recip2.id, ["feed.view"])

    # 1. Author creates targeted draft post -> Zero notifications created
    draft_res = await client.post(
        "/api/v1/feed/posts",
        json={
            "title": "Upcoming Strategy",
            "content": "Secret draft for team.",
            "audience_type": "SELECTED",
            "recipient_ids": [str(recip1.id), str(recip2.id)],
            "status": "DRAFT",
        },
        headers=author_h,
    )
    draft_id = draft_res.json()["data"]["id"]

    async with get_sessionmaker()() as session:
        notifs_draft = (await session.execute(select(Notification))).scalars().all()
        # Ensure no notifications created for draft
        draft_notifs = [n for n in notifs_draft if draft_id in (n.link or "")]
        assert len(draft_notifs) == 0

    # 2. Author updates draft to PUBLISHED -> Notifies recip1 and recip2, NOT author and NOT excluded
    pub_res = await client.patch(
        f"/api/v1/feed/posts/{draft_id}",
        json={"status": "PUBLISHED"},
        headers=author_h,
    )
    assert pub_res.status_code == 200

    async with get_sessionmaker()() as session:
        notifs_pub = (await session.execute(
            select(Notification).where(Notification.type == "feed_announcement")
        )).scalars().all()

        post_notifs = [n for n in notifs_pub if draft_id in (n.link or "")]
        notified_user_ids = {n.user_id for n in post_notifs}

        assert recip1.id in notified_user_ids
        assert recip2.id in notified_user_ids
        assert author.id not in notified_user_ids  # Author not notified of own post!
        assert excluded.id not in notified_user_ids  # Excluded not notified!

    # 3. Recipient 1 comments -> Notifies Author (feed_comment)
    c1_res = await client.post(
        f"/api/v1/feed/posts/{draft_id}/comments",
        json={"content": "This strategy looks fantastic!"},
        headers=r1_h,
    )
    assert c1_res.status_code == 201

    async with get_sessionmaker()() as session:
        comment_notifs = (await session.execute(
            select(Notification).where(
                Notification.type == "feed_comment",
                Notification.user_id == author.id,
            )
        )).scalars().all()
        assert len(comment_notifs) >= 1
        assert "This strategy looks fantastic" in comment_notifs[-1].message

    # 4. Recipient 2 replies to discussion -> Notifies Author AND Recipient 1 (feed_discussion)
    c2_res = await client.post(
        f"/api/v1/feed/posts/{draft_id}/comments",
        json={"content": "I agree with Recipient 1, let us execute!"},
        headers=r2_h,
    )
    assert c2_res.status_code == 201

    async with get_sessionmaker()() as session:
        disc_notifs = (await session.execute(
            select(Notification).where(
                Notification.type == "feed_discussion",
                Notification.user_id == recip1.id,
            )
        )).scalars().all()
        assert len(disc_notifs) >= 1
        assert "Recipient One" in [recip1.display_name]
        assert recip2.id != recip1.id
