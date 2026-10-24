"""
Inhyma ERP — Feed Phase 5 E2E Verification & Security Test Suite.

Tests:
1. Real authentication login for Test Accounts A, B, and C with temporary credentials.
2. Company-wide broadcast (audience=ALL):
   - A publishes, B and C see, A gets no self-notification, B and C get notifications without duplicate.
3. Individual targeting (audience=SELECTED with Account B):
   - B can see and open; C cannot see in feed, direct ID returns 403 Forbidden, comments/reactions/read endpoints return 403.
   - Notification delivered only to B.
4. Department & Combined broadcasting:
   - A publishes to Engineering department (contains B). B can access; C (Marketing) is blocked with 403.
   - Combined department + individual B targeting deduplicates recipients cleanly.
5. Interactions & Readership Privacy:
   - B can comment and react; A receives comment notification.
   - B marks as read; read status persists across requests.
   - Author A can inspect readership history; B and C are rejected with 403 Forbidden.
   - Draft post generates zero notifications; publishing draft generates notifications to intended audience.
6. Security boundaries:
   - B and C cannot create posts (403 Forbidden).
   - B and C cannot list eligible recipients or departments (403 Forbidden).
   - Publishing with non-existent employee UUID is rejected with validation error.
"""

from __future__ import annotations

import json
import uuid
from pathlib import Path
import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.database.engine import get_sessionmaker
from app.notifications.models import Notification
from app.rbac.models import Role


CREDENTIALS_FILE = Path(r"C:\Users\om\.gemini\antigravity-ide\brain\ebb88f84-2dc6-4288-85f9-b7611491681b\scratch\feed_phase5_credentials.json")


def load_test_accounts() -> dict[str, dict]:
    with open(CREDENTIALS_FILE, encoding="utf-8") as f:
        data = json.load(f)
    return {acc["account_key"]: acc for acc in data}


async def login_user(client: AsyncClient, identifier: str, password: str) -> tuple[str, dict]:
    """Helper to perform genuine HTTP login and return (token, user_dict)."""
    resp = await client.post(
        "/api/v1/auth/login",
        json={"identifier": identifier, "password": password},
    )
    assert resp.status_code == 200, f"Login failed for {identifier}: {resp.text}"
    body = resp.json()["data"]
    token = body["access_token"]
    user = body["user"]
    return token, user


def auth_header(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.asyncio
async def test_01_real_login_and_credentials_verification(client: AsyncClient):
    """Verify that all three test accounts can authenticate through /api/v1/auth/login."""
    accounts = load_test_accounts()

    # 1. Login Account A (Publisher)
    acc_a = accounts["A"]
    token_a, user_a = await login_user(client, acc_a["email"], acc_a["temporary_password"])
    assert token_a is not None
    assert "feed.view" in user_a["permissions"]
    assert "feed.create" in user_a["permissions"]
    assert "feed.manage" not in user_a["permissions"]

    # 2. Login Account B (Recipient)
    acc_b = accounts["B"]
    token_b, user_b = await login_user(client, acc_b["email"], acc_b["temporary_password"])
    assert token_b is not None
    assert "feed.view" in user_b["permissions"]
    assert "feed.create" not in user_b["permissions"]
    assert "feed.manage" not in user_b["permissions"]

    # 3. Login Account C (Unauthorized Recipient)
    acc_c = accounts["C"]
    token_c, user_c = await login_user(client, acc_c["email"], acc_c["temporary_password"])
    assert token_c is not None
    assert "feed.view" in user_c["permissions"]
    assert "feed.create" not in user_c["permissions"]
    assert "feed.manage" not in user_c["permissions"]
    assert "super_admin" not in user_c["roles"]
    assert "Admin" not in user_c["roles"]


@pytest.mark.asyncio
async def test_02_company_wide_broadcasting(client: AsyncClient):
    """
    Test Account A creates a company-wide announcement.
    Verify:
    - Successfully published.
    - Test Account A can see it.
    - Test Account B can see it.
    - Test Account C can see it.
    - Author (A) receives no self-notification.
    - Recipients B & C receive notifications without duplicates.
    """
    accounts = load_test_accounts()
    token_a, _ = await login_user(client, accounts["A"]["email"], accounts["A"]["temporary_password"])
    token_b, _ = await login_user(client, accounts["B"]["email"], accounts["B"]["temporary_password"])
    token_c, _ = await login_user(client, accounts["C"]["email"], accounts["C"]["temporary_password"])

    post_title = f"Phase 5 All-Hands Broadcast {uuid.uuid4().hex[:6]}"
    post_payload = {
        "title": post_title,
        "content": "Important quarterly company-wide update for all Inhyma ERP staff.",
        "audience_type": "ALL",
        "status": "PUBLISHED",
    }

    create_resp = await client.post("/api/v1/feed/posts", json=post_payload, headers=auth_header(token_a))
    assert create_resp.status_code == 201, f"Failed to create post: {create_resp.text}"
    created_post = create_resp.json()["data"]
    post_id = created_post["id"]
    assert created_post["title"] == post_title
    assert created_post["audience_type"] == "ALL"

    # A sees post
    list_a = await client.get("/api/v1/feed/posts", headers=auth_header(token_a))
    assert list_a.status_code == 200
    assert any(p["id"] == post_id for p in list_a.json()["data"]["items"])

    # B sees post in list and by ID
    list_b = await client.get("/api/v1/feed/posts", headers=auth_header(token_b))
    assert list_b.status_code == 200
    assert any(p["id"] == post_id for p in list_b.json()["data"]["items"])

    get_b = await client.get(f"/api/v1/feed/posts/{post_id}", headers=auth_header(token_b))
    assert get_b.status_code == 200
    assert get_b.json()["data"]["id"] == post_id

    # C sees post in list and by ID
    list_c = await client.get("/api/v1/feed/posts", headers=auth_header(token_c))
    assert list_c.status_code == 200
    assert any(p["id"] == post_id for p in list_c.json()["data"]["items"])

    get_c = await client.get(f"/api/v1/feed/posts/{post_id}", headers=auth_header(token_c))
    assert get_c.status_code == 200
    assert get_c.json()["data"]["id"] == post_id

    # Verify notification records in DB
    async with get_sessionmaker()() as session:
        notif_stmt = select(Notification).where(Notification.link == f"/feed?post_id={post_id}")
        notifs = (await session.execute(notif_stmt)).scalars().all()
        notified_user_ids = [str(n.user_id) for n in notifs]

        # Author A must not receive self-notification
        assert accounts["A"]["user_id"] not in notified_user_ids, "Author received unnecessary self-notification!"
        # B and C must receive notification
        assert accounts["B"]["user_id"] in notified_user_ids, "Recipient B did not receive notification!"
        assert accounts["C"]["user_id"] in notified_user_ids, "Recipient C did not receive notification!"
        # No duplicates for B or C
        assert notified_user_ids.count(accounts["B"]["user_id"]) == 1
        assert notified_user_ids.count(accounts["C"]["user_id"]) == 1


@pytest.mark.asyncio
async def test_03_individual_employee_targeting(client: AsyncClient):
    """
    Test Account A creates an announcement targeted strictly to Test Account B.
    Verify:
    - B can see and open the announcement.
    - C cannot see the announcement in Feed.
    - C cannot access it by direct post ID (403 Forbidden).
    - C cannot access comments, reactions, or readership (403 Forbidden).
    - B can comment and react.
    - Announcement notification delivered only to B.
    """
    accounts = load_test_accounts()
    token_a, _ = await login_user(client, accounts["A"]["email"], accounts["A"]["temporary_password"])
    token_b, _ = await login_user(client, accounts["B"]["email"], accounts["B"]["temporary_password"])
    token_c, _ = await login_user(client, accounts["C"]["email"], accounts["C"]["temporary_password"])

    post_title = f"Confidential Briefing for Account B {uuid.uuid4().hex[:6]}"
    post_payload = {
        "title": post_title,
        "content": "Confidential technical details intended solely for Test Recipient B.",
        "audience_type": "SELECTED",
        "recipient_ids": [accounts["B"]["user_id"]],
        "department_ids": [],
        "category": "UPDATE",
        "priority": "MEDIUM",
        "status": "PUBLISHED",
    }

    create_resp = await client.post("/api/v1/feed/posts", json=post_payload, headers=auth_header(token_a))
    assert create_resp.status_code == 201
    post_id = create_resp.json()["data"]["id"]

    # Account B can see in feed and open directly
    list_b = await client.get("/api/v1/feed/posts", headers=auth_header(token_b))
    assert any(p["id"] == post_id for p in list_b.json()["data"]["items"])

    get_b = await client.get(f"/api/v1/feed/posts/{post_id}", headers=auth_header(token_b))
    assert get_b.status_code == 200
    assert get_b.json()["data"]["title"] == post_title

    # Account C CANNOT see in feed list
    list_c = await client.get("/api/v1/feed/posts", headers=auth_header(token_c))
    assert not any(p["id"] == post_id for p in list_c.json()["data"]["items"])

    # Account C direct ID access is blocked with 403 Forbidden
    get_c = await client.get(f"/api/v1/feed/posts/{post_id}", headers=auth_header(token_c))
    assert get_c.status_code == 403, f"Expected 403 Forbidden for unauthorized user, got {get_c.status_code}"

    # Account C cannot read or add comments
    get_comments_c = await client.get(f"/api/v1/feed/posts/{post_id}/comments", headers=auth_header(token_c))
    assert get_comments_c.status_code == 403

    add_comment_c = await client.post(
        f"/api/v1/feed/posts/{post_id}/comments",
        json={"content": "Unauthorized attempt"},
        headers=auth_header(token_c),
    )
    assert add_comment_c.status_code == 403

    # Account C cannot react
    react_c = await client.post(
        f"/api/v1/feed/posts/{post_id}/reactions",
        json={"reaction_type": "LIKE"},
        headers=auth_header(token_c),
    )
    assert react_c.status_code == 403

    # Account C cannot mark read or check readership
    read_c = await client.post(f"/api/v1/feed/posts/{post_id}/read", json={}, headers=auth_header(token_c))
    assert read_c.status_code == 403

    readership_c = await client.get(f"/api/v1/feed/posts/{post_id}/readership", headers=auth_header(token_c))
    assert readership_c.status_code == 403

    # Account B CAN comment and react
    add_comment_b = await client.post(
        f"/api/v1/feed/posts/{post_id}/comments",
        json={"content": "Received and acknowledged."},
        headers=auth_header(token_b),
    )
    assert add_comment_b.status_code == 201

    react_b = await client.post(
        f"/api/v1/feed/posts/{post_id}/reactions",
        json={"reaction_type": "LIKE"},
        headers=auth_header(token_b),
    )
    assert react_b.status_code == 200

    # Verify notifications: delivered ONLY to B
    async with get_sessionmaker()() as session:
        notif_stmt = select(Notification).where(
            Notification.link == f"/feed?post_id={post_id}",
            Notification.type == "feed_announcement",
        )
        notifs = (await session.execute(notif_stmt)).scalars().all()
        notified_ids = [str(n.user_id) for n in notifs]

        assert accounts["B"]["user_id"] in notified_ids
        assert accounts["C"]["user_id"] not in notified_ids
        assert accounts["A"]["user_id"] not in notified_ids


@pytest.mark.asyncio
async def test_04_department_and_combined_broadcasting(client: AsyncClient):
    """
    Test Account A publishes:
    1. To Engineering department (contains Account B, but not Account C).
    2. To a combination of Engineering department + Account B individual recipient.
    Verify:
    - B receives both.
    - C is unauthorized and blocked for both.
    - Deduplication ensures Account B is not notified multiple times for the combined announcement.
    - Final audience is persisted correctly.
    """
    accounts = load_test_accounts()
    token_a, _ = await login_user(client, accounts["A"]["email"], accounts["A"]["temporary_password"])
    token_b, _ = await login_user(client, accounts["B"]["email"], accounts["B"]["temporary_password"])
    token_c, _ = await login_user(client, accounts["C"]["email"], accounts["C"]["temporary_password"])

    # Retrieve Engineering department ID
    async with get_sessionmaker()() as session:
        stmt = select(Role.id).where(Role.name == "Engineering", Role.deleted_at.is_(None))
        eng_dept_id = str((await session.execute(stmt)).scalar_one())

    # 1. Department announcement
    dept_post_payload = {
        "title": f"Engineering Sprint Planning {uuid.uuid4().hex[:6]}",
        "content": "Engineering team announcement regarding Q4 priorities.",
        "audience_type": "SELECTED",
        "department_ids": [eng_dept_id],
        "recipient_ids": [],
        "status": "PUBLISHED",
    }
    resp1 = await client.post("/api/v1/feed/posts", json=dept_post_payload, headers=auth_header(token_a))
    assert resp1.status_code == 201
    post1_id = resp1.json()["data"]["id"]

    # Verify B can view, C is blocked
    get_b1 = await client.get(f"/api/v1/feed/posts/{post1_id}", headers=auth_header(token_b))
    assert get_b1.status_code == 200
    get_c1 = await client.get(f"/api/v1/feed/posts/{post1_id}", headers=auth_header(token_c))
    assert get_c1.status_code == 403

    # 2. Combined announcement (Department + individual recipient already in that dept)
    combined_payload = {
        "title": f"Engineering & Lead Architect Sync {uuid.uuid4().hex[:6]}",
        "content": "Combined broadcast to Engineering Department and individual recipient B.",
        "audience_type": "SELECTED",
        "department_ids": [eng_dept_id],
        "recipient_ids": [accounts["B"]["user_id"]],
        "status": "PUBLISHED",
    }
    resp2 = await client.post("/api/v1/feed/posts", json=combined_payload, headers=auth_header(token_a))
    assert resp2.status_code == 201
    post2_data = resp2.json()["data"]
    post2_id = post2_data["id"]

    # Check recipient deduplication in persisted post
    recipient_ids = [r["recipient_id"] for r in post2_data["recipients"]]
    assert recipient_ids.count(accounts["B"]["user_id"]) == 1

    # Check notification deduplication in DB
    async with get_sessionmaker()() as session:
        notif_stmt = select(Notification).where(
            Notification.link == f"/feed?post_id={post2_id}",
            Notification.type == "feed_announcement",
        )
        notifs = (await session.execute(notif_stmt)).scalars().all()
        notified_ids = [str(n.user_id) for n in notifs]

        assert notified_ids.count(accounts["B"]["user_id"]) == 1, "Recipient B received duplicate notifications!"
        assert accounts["C"]["user_id"] not in notified_ids


@pytest.mark.asyncio
async def test_05_interactions_read_tracking_and_privacy(client: AsyncClient):
    """
    Verify:
    - Authorized comments and comment author notification to post author A.
    - Reactions can be added, changed, and removed.
    - Read status persists after login.
    - Author can view readership; recipient B cannot inspect other employees' readership (403 Forbidden).
    - Draft announcements generate no notifications; publishing sends notifications.
    """
    accounts = load_test_accounts()
    token_a, _ = await login_user(client, accounts["A"]["email"], accounts["A"]["temporary_password"])
    token_b, _ = await login_user(client, accounts["B"]["email"], accounts["B"]["temporary_password"])

    # 1. Author A publishes post targeted to B
    post_payload = {
        "title": f"Interaction & Privacy QA {uuid.uuid4().hex[:6]}",
        "content": "Testing comment notification and readership privacy.",
        "audience_type": "SELECTED",
        "recipient_ids": [accounts["B"]["user_id"]],
        "status": "PUBLISHED",
    }
    post_resp = await client.post("/api/v1/feed/posts", json=post_payload, headers=auth_header(token_a))
    post_id = post_resp.json()["data"]["id"]

    # 2. Account B comments
    c_resp = await client.post(
        f"/api/v1/feed/posts/{post_id}/comments",
        json={"content": "Looks good from my side."},
        headers=auth_header(token_b),
    )
    assert c_resp.status_code == 201

    # Verify author A received comment notification
    async with get_sessionmaker()() as session:
        notif_stmt = select(Notification).where(
            Notification.link == f"/feed?post_id={post_id}",
            Notification.type == "feed_comment",
        )
        c_notifs = (await session.execute(notif_stmt)).scalars().all()
        assert any(str(n.user_id) == accounts["A"]["user_id"] for n in c_notifs), "Author A did not receive comment notification!"

    # 3. Reactions: add -> change -> remove
    r1 = await client.post(
        f"/api/v1/feed/posts/{post_id}/reactions",
        json={"reaction_type": "LIKE"},
        headers=auth_header(token_b),
    )
    assert r1.status_code == 200
    assert r1.json()["data"]["user_reaction"] == "LIKE"

    # Change to CELEBRATE
    r2 = await client.post(
        f"/api/v1/feed/posts/{post_id}/reactions",
        json={"reaction_type": "CELEBRATE"},
        headers=auth_header(token_b),
    )
    assert r2.status_code == 200
    assert r2.json()["data"]["user_reaction"] == "CELEBRATE"

    # Remove reaction
    r3 = await client.post(
        f"/api/v1/feed/posts/{post_id}/reactions",
        json={"reaction_type": "CELEBRATE"},
        headers=auth_header(token_b),
    )
    assert r3.status_code == 200
    assert r3.json()["data"]["user_reaction"] is None

    # 4. Mark as read & persistence
    read_resp = await client.post(f"/api/v1/feed/posts/{post_id}/read", json={}, headers=auth_header(token_b))
    assert read_resp.status_code == 200
    assert read_resp.json()["data"]["is_read"] is True

    # Re-login as Account B to verify persistence
    token_b2, _ = await login_user(client, accounts["B"]["email"], accounts["B"]["temporary_password"])
    get_post_b = await client.get(f"/api/v1/feed/posts/{post_id}", headers=auth_header(token_b2))
    assert get_post_b.status_code == 200
    assert get_post_b.json()["data"]["is_read"] is True

    # 5. Readership privacy
    # Author A can view readership
    readers_a = await client.get(f"/api/v1/feed/posts/{post_id}/readership", headers=auth_header(token_a))
    assert readers_a.status_code == 200
    assert readers_a.json()["data"]["total_readers"] >= 1
    reader_ids = [r["user_id"] for r in readers_a.json()["data"]["readers"]]
    assert accounts["B"]["user_id"] in reader_ids

    # Recipient B CANNOT inspect other employees' readership
    readers_b = await client.get(f"/api/v1/feed/posts/{post_id}/readership", headers=auth_header(token_b2))
    assert readers_b.status_code == 403, "Recipient was allowed to inspect readership history!"

    # 6. Draft lifecycle: Draft generates NO notifications; publishing sends notifications
    draft_payload = {
        "title": f"Draft Policy Memo {uuid.uuid4().hex[:6]}",
        "content": "Work in progress draft content.",
        "audience_type": "SELECTED",
        "recipient_ids": [accounts["B"]["user_id"]],
        "status": "DRAFT",
    }
    draft_resp = await client.post("/api/v1/feed/posts", json=draft_payload, headers=auth_header(token_a))
    assert draft_resp.status_code == 201
    draft_id = draft_resp.json()["data"]["id"]

    # Verify 0 notifications while draft
    async with get_sessionmaker()() as session:
        notif_stmt = select(Notification).where(Notification.link == f"/feed?post_id={draft_id}")
        d_notifs = (await session.execute(notif_stmt)).scalars().all()
        assert len(d_notifs) == 0, "Draft post erroneously generated notifications!"

    # Publish the draft
    pub_resp = await client.patch(
        f"/api/v1/feed/posts/{draft_id}",
        json={"status": "PUBLISHED"},
        headers=auth_header(token_a),
    )
    assert pub_resp.status_code == 200
    assert pub_resp.json()["data"]["status"] == "PUBLISHED"

    # Verify notifications generated upon publishing
    async with get_sessionmaker()() as session:
        notif_stmt = select(Notification).where(
            Notification.link == f"/feed?post_id={draft_id}",
            Notification.type == "feed_announcement",
        )
        pub_notifs = (await session.execute(notif_stmt)).scalars().all()
        assert any(str(n.user_id) == accounts["B"]["user_id"] for n in pub_notifs)


@pytest.mark.asyncio
async def test_06_security_privilege_boundaries(client: AsyncClient):
    """
    Verify security controls:
    - Account B and C cannot create posts (403 Forbidden).
    - Account B and C cannot view eligible recipients or departments (403 Forbidden).
    - Publishing to non-existent employee UUID is rejected with validation error.
    """
    accounts = load_test_accounts()
    token_a, _ = await login_user(client, accounts["A"]["email"], accounts["A"]["temporary_password"])
    token_b, _ = await login_user(client, accounts["B"]["email"], accounts["B"]["temporary_password"])
    token_c, _ = await login_user(client, accounts["C"]["email"], accounts["C"]["temporary_password"])

    post_body = {
        "title": "Unauthorized attempt",
        "content": "Should not be created.",
        "audience_type": "ALL",
        "status": "PUBLISHED",
    }

    # B cannot create
    b_create = await client.post("/api/v1/feed/posts", json=post_body, headers=auth_header(token_b))
    assert b_create.status_code == 403

    # C cannot create
    c_create = await client.post("/api/v1/feed/posts", json=post_body, headers=auth_header(token_c))
    assert c_create.status_code == 403

    # B and C cannot list eligible recipients or departments
    assert (await client.get("/api/v1/feed/recipients/eligible", headers=auth_header(token_b))).status_code == 403
    assert (await client.get("/api/v1/feed/recipients/eligible", headers=auth_header(token_c))).status_code == 403
    assert (await client.get("/api/v1/feed/departments/eligible", headers=auth_header(token_b))).status_code == 403
    assert (await client.get("/api/v1/feed/departments/eligible", headers=auth_header(token_c))).status_code == 403

    # Non-existent recipient validation error
    invalid_uuid = str(uuid.uuid4())
    invalid_payload = {
        "title": "Invalid Recipient Post",
        "content": "Targeting non-existent recipient.",
        "audience_type": "SELECTED",
        "recipient_ids": [invalid_uuid],
        "status": "PUBLISHED",
    }
    inv_resp = await client.post("/api/v1/feed/posts", json=invalid_payload, headers=auth_header(token_a))
    assert inv_resp.status_code in (400, 422), f"Expected validation error, got {inv_resp.status_code}"
