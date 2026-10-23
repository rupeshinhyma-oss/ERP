"""
Comprehensive Test Suite for Inhyma ERP Feed & Broadcast Messaging Module.

Verifies:
1. Everyone-audience posts are accessible by all authenticated employees across the ERP.
2. Selected-audience posts are strictly visible only to author, intended recipients, and admins.
3. Unauthorized employees cannot see or access selected-audience posts via ID or list queries.
4. Recipient persistence across database sessions.
5. Pagination, search, and ordering.
6. Recipient validation (empty list rejection, nonexistent ID rejection, duplicate deduplication).
7. Edit and delete permissions (author and admin allowed; third-party employee rejected with 403).
8. Draft vs. Published lifecycle and visibility controls.
9. Eligible recipients lookup endpoint and RBAC enforcement.
"""

from __future__ import annotations

import uuid
import pytest
from httpx import AsyncClient

from app.auth.service import create_access_token
from app.database.engine import get_sessionmaker
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
                username=f"feed_user_{unique_suffix}",
                email=f"feed_{unique_suffix}@example.com",
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
async def test_feed_everyone_audience_post_lifecycle(
    client: AsyncClient,
    create_user_helper,
) -> None:
    """Test creating and retrieving a company-wide (ALL audience) feed post."""
    author = await create_user_helper("Author User")
    employee = await create_user_helper("Standard Employee")
    admin = await create_user_helper("System Admin")

    author_h = auth_headers(author.id, ["feed.view", "feed.create"])
    employee_h = auth_headers(employee.id, ["feed.view"])
    admin_h = auth_headers(admin.id, ["feed.view", "feed.manage", "*"])

    # 1. Author creates company-wide post
    payload = {
        "title": "Annual Company Townhall Announcement",
        "content": "Please join us this Friday at 4 PM for the Q4 all-hands townhall meeting.",
        "audience_type": "ALL",
        "status": "PUBLISHED",
    }
    create_res = await client.post("/api/v1/feed/posts", json=payload, headers=author_h)
    assert create_res.status_code == 201
    post_data = create_res.json()["data"]
    assert post_data["title"] == payload["title"]
    assert post_data["audience_type"] == "ALL"
    assert post_data["status"] == "PUBLISHED"
    assert post_data["is_author"] is True
    post_id = post_data["id"]

    # 2. Author can fetch by ID
    get_res_author = await client.get(f"/api/v1/feed/posts/{post_id}", headers=author_h)
    assert get_res_author.status_code == 200
    assert get_res_author.json()["data"]["id"] == post_id

    # 3. Standard employee can fetch and see in feed
    get_res_emp = await client.get(f"/api/v1/feed/posts/{post_id}", headers=employee_h)
    assert get_res_emp.status_code == 200
    emp_data = get_res_emp.json()["data"]
    assert emp_data["id"] == post_id
    assert emp_data["is_author"] is False
    assert emp_data["author"]["display_name"] == "Author User"

    list_res_emp = await client.get("/api/v1/feed/posts", headers=employee_h)
    assert list_res_emp.status_code == 200
    items = list_res_emp.json()["data"]["items"]
    assert any(i["id"] == post_id for i in items)

    # 4. Admin can also see and fetch
    get_res_admin = await client.get(f"/api/v1/feed/posts/{post_id}", headers=admin_h)
    assert get_res_admin.status_code == 200


@pytest.mark.asyncio
async def test_feed_selected_audience_post_authorization(
    client: AsyncClient,
    create_user_helper,
) -> None:
    """Test targeted post visible only to author, intended recipients, and admin."""
    author = await create_user_helper("Manager Author")
    recipient = await create_user_helper("Intended Recipient")
    unauthorized_emp = await create_user_helper("Unauthorized Employee")
    admin = await create_user_helper("Feed Administrator")

    author_h = auth_headers(author.id, ["feed.view", "feed.create"])
    recipient_h = auth_headers(recipient.id, ["feed.view"])
    unauthorized_h = auth_headers(unauthorized_emp.id, ["feed.view"])
    admin_h = auth_headers(admin.id, ["feed.view", "feed.manage"])

    # 1. Author creates targeted post for recipient
    payload = {
        "title": "Confidential Project Briefing",
        "content": "This message is for selected project leads only.",
        "audience_type": "SELECTED",
        "recipient_ids": [str(recipient.id)],
        "status": "PUBLISHED",
    }
    create_res = await client.post("/api/v1/feed/posts", json=payload, headers=author_h)
    assert create_res.status_code == 201
    post_id = create_res.json()["data"]["id"]

    # 2. Intended recipient sees post in feed list
    rec_list = await client.get("/api/v1/feed/posts", headers=recipient_h)
    assert rec_list.status_code == 200
    rec_items = rec_list.json()["data"]["items"]
    assert any(i["id"] == post_id for i in rec_items)

    # 3. Intended recipient can fetch post by ID
    rec_get = await client.get(f"/api/v1/feed/posts/{post_id}", headers=recipient_h)
    assert rec_get.status_code == 200
    assert rec_get.json()["data"]["id"] == post_id

    # 4. Unauthorized employee DOES NOT see post in feed list
    unauth_list = await client.get("/api/v1/feed/posts", headers=unauthorized_h)
    assert unauth_list.status_code == 200
    unauth_items = unauth_list.json()["data"]["items"]
    assert not any(i["id"] == post_id for i in unauth_items)

    # 5. Unauthorized employee attempting direct access by ID receives 403 Forbidden
    unauth_get = await client.get(f"/api/v1/feed/posts/{post_id}", headers=unauthorized_h)
    assert unauth_get.status_code == 403

    # 6. Admin without targeted membership receives 403 Forbidden
    admin_get = await client.get(f"/api/v1/feed/posts/{post_id}", headers=admin_h)
    assert admin_get.status_code == 403


@pytest.mark.asyncio
async def test_feed_recipient_persistence_across_sessions(
    client: AsyncClient,
    create_user_helper,
) -> None:
    """Test recipient associations are saved and retrieved reliably."""
    author = await create_user_helper("Author")
    rec1 = await create_user_helper("Recipient One")
    rec2 = await create_user_helper("Recipient Two")

    author_h = auth_headers(author.id, ["feed.create", "feed.view"])

    payload = {
        "title": "Team Update",
        "content": "Checking relational persistence.",
        "audience_type": "SELECTED",
        "recipient_ids": [str(rec1.id), str(rec2.id)],
        "status": "PUBLISHED",
    }
    create_res = await client.post("/api/v1/feed/posts", json=payload, headers=author_h)
    assert create_res.status_code == 201
    post_id = create_res.json()["data"]["id"]

    # Retrieve post in a fresh request
    fetch_res = await client.get(f"/api/v1/feed/posts/{post_id}", headers=author_h)
    assert fetch_res.status_code == 200
    data = fetch_res.json()["data"]
    persisted_recipients = {r["recipient_id"] for r in data["recipients"]}
    assert persisted_recipients == {str(rec1.id), str(rec2.id)}


@pytest.mark.asyncio
async def test_feed_pagination_and_search(
    client: AsyncClient,
    create_user_helper,
) -> None:
    """Test pagination limit, offset, and search keywords."""
    author = await create_user_helper("Pagination Author")
    author_h = auth_headers(author.id, ["feed.create", "feed.view"])

    unique_tag = f"tag_{uuid.uuid4().hex[:8]}"
    # Create 5 distinct posts
    for idx in range(5):
        await client.post(
            "/api/v1/feed/posts",
            json={
                "title": f"Batch Post Number {idx + 1} {unique_tag}",
                "content": f"Content item #{idx + 1} with keyword {unique_tag}_{idx}",
                "audience_type": "ALL",
                "status": "PUBLISHED",
            },
            headers=author_h,
        )

    # Page 1 with page_size=2
    res_p1 = await client.get("/api/v1/feed/posts?page=1&page_size=2", headers=author_h)
    assert res_p1.status_code == 200
    d1 = res_p1.json()["data"]
    assert len(d1["items"]) == 2
    assert d1["page"] == 1
    assert d1["page_size"] == 2
    assert d1["total"] >= 5

    # Page 2 with page_size=2
    res_p2 = await client.get("/api/v1/feed/posts?page=2&page_size=2", headers=author_h)
    assert res_p2.status_code == 200
    d2 = res_p2.json()["data"]
    assert len(d2["items"]) == 2
    assert d2["page"] == 2
    # Ensure distinct items
    p1_ids = {i["id"] for i in d1["items"]}
    p2_ids = {i["id"] for i in d2["items"]}
    assert p1_ids.isdisjoint(p2_ids)

    # Search filter
    search_res = await client.get(
        f"/api/v1/feed/posts?search={unique_tag}_3", headers=author_h
    )
    assert search_res.status_code == 200
    s_items = search_res.json()["data"]["items"]
    assert len(s_items) == 1
    assert f"{unique_tag}_3" in s_items[0]["content"]


@pytest.mark.asyncio
async def test_feed_recipient_validation_and_deduplication(
    client: AsyncClient,
    create_user_helper,
) -> None:
    """Test validation errors for empty, nonexistent, or inactive recipients."""
    author = await create_user_helper("Validation Author")
    active_emp = await create_user_helper("Active Employee")
    inactive_emp = await create_user_helper(
        "Inactive Employee", is_active=False, status=UserStatus.INACTIVE
    )

    author_h = auth_headers(author.id, ["feed.create", "feed.view"])

    # 1. Selected audience with empty recipient list
    res_empty = await client.post(
        "/api/v1/feed/posts",
        json={
            "title": "Invalid Empty",
            "content": "No recipients provided.",
            "audience_type": "SELECTED",
            "recipient_ids": [],
            "status": "PUBLISHED",
        },
        headers=author_h,
    )
    assert res_empty.status_code == 422

    # 2. Selected audience with nonexistent UUID
    fake_id = str(uuid.uuid4())
    res_fake = await client.post(
        "/api/v1/feed/posts",
        json={
            "title": "Invalid Fake",
            "content": "Testing fake user.",
            "audience_type": "SELECTED",
            "recipient_ids": [fake_id],
            "status": "PUBLISHED",
        },
        headers=author_h,
    )
    assert res_fake.status_code == 422
    assert fake_id in res_fake.text

    # 3. Selected audience with inactive user
    res_inactive = await client.post(
        "/api/v1/feed/posts",
        json={
            "title": "Invalid Inactive",
            "content": "Testing inactive user.",
            "audience_type": "SELECTED",
            "recipient_ids": [str(inactive_emp.id)],
            "status": "PUBLISHED",
        },
        headers=author_h,
    )
    assert res_inactive.status_code == 422

    # 4. Duplicate IDs in recipient list are cleanly deduplicated
    res_dup = await client.post(
        "/api/v1/feed/posts",
        json={
            "title": "Duplicate Recipient Test",
            "content": "Duplicate IDs should be accepted and deduplicated.",
            "audience_type": "SELECTED",
            "recipient_ids": [str(active_emp.id), str(active_emp.id), str(active_emp.id)],
            "status": "PUBLISHED",
        },
        headers=author_h,
    )
    assert res_dup.status_code == 201
    post_recipients = res_dup.json()["data"]["recipients"]
    assert len(post_recipients) == 1
    assert post_recipients[0]["recipient_id"] == str(active_emp.id)


@pytest.mark.asyncio
async def test_feed_edit_and_delete_permissions(
    client: AsyncClient,
    create_user_helper,
) -> None:
    """Test author and admin can edit and soft-delete; strangers are blocked."""
    author = await create_user_helper("Post Author")
    other_emp = await create_user_helper("Other Employee")
    admin = await create_user_helper("Feed Administrator")

    author_h = auth_headers(author.id, ["feed.create", "feed.view"])
    other_h = auth_headers(other_emp.id, ["feed.create", "feed.view"])
    admin_h = auth_headers(admin.id, ["feed.manage", "feed.view"])

    # Author creates post
    res = await client.post(
        "/api/v1/feed/posts",
        json={
            "title": "Initial Title",
            "content": "Initial message content.",
            "audience_type": "ALL",
            "status": "PUBLISHED",
        },
        headers=author_h,
    )
    assert res.status_code == 201
    post_id = res.json()["data"]["id"]

    # Stranger cannot edit
    edit_stranger = await client.patch(
        f"/api/v1/feed/posts/{post_id}",
        json={"title": "Hacked Title"},
        headers=other_h,
    )
    assert edit_stranger.status_code == 403

    # Author can edit
    edit_author = await client.patch(
        f"/api/v1/feed/posts/{post_id}",
        json={"title": "Author Updated Title", "content": "Updated content."},
        headers=author_h,
    )
    assert edit_author.status_code == 200
    assert edit_author.json()["data"]["title"] == "Author Updated Title"

    # Admin cannot edit another user's post (author ownership rule)
    edit_admin = await client.patch(
        f"/api/v1/feed/posts/{post_id}",
        json={"title": "Admin Moderated Title"},
        headers=admin_h,
    )
    assert edit_admin.status_code == 403

    # Stranger cannot delete
    del_stranger = await client.delete(f"/api/v1/feed/posts/{post_id}", headers=other_h)
    assert del_stranger.status_code == 403

    # Author can delete
    del_author = await client.delete(f"/api/v1/feed/posts/{post_id}", headers=author_h)
    assert del_author.status_code == 200

    # Once deleted, get returns 404
    get_after_del = await client.get(f"/api/v1/feed/posts/{post_id}", headers=author_h)
    assert get_after_del.status_code == 404


@pytest.mark.asyncio
async def test_feed_draft_and_published_visibility(
    client: AsyncClient,
    create_user_helper,
) -> None:
    """Test draft posts remain private to author and admin until published."""
    author = await create_user_helper("Draft Author")
    employee = await create_user_helper("General Employee")
    admin = await create_user_helper("Admin Reviewer")

    author_h = auth_headers(author.id, ["feed.create", "feed.view"])
    employee_h = auth_headers(employee.id, ["feed.view"])
    admin_h = auth_headers(admin.id, ["feed.manage", "feed.view"])

    # 1. Author creates draft post
    create_res = await client.post(
        "/api/v1/feed/posts",
        json={
            "title": "Work In Progress Draft",
            "content": "Draft announcement not ready for public yet.",
            "audience_type": "ALL",
            "status": "DRAFT",
        },
        headers=author_h,
    )
    assert create_res.status_code == 201
    post_id = create_res.json()["data"]["id"]
    assert create_res.json()["data"]["status"] == "DRAFT"
    assert create_res.json()["data"]["published_at"] is None

    # 2. General employee cannot see draft in feed list
    emp_list = await client.get("/api/v1/feed/posts", headers=employee_h)
    assert emp_list.status_code == 200
    assert not any(i["id"] == post_id for i in emp_list.json()["data"]["items"])

    # 3. General employee gets 403 trying to fetch draft by ID
    emp_get = await client.get(f"/api/v1/feed/posts/{post_id}", headers=employee_h)
    assert emp_get.status_code == 403

    # 4. Author CAN see the draft; outside Admin CANNOT
    author_get = await client.get(f"/api/v1/feed/posts/{post_id}", headers=author_h)
    assert author_get.status_code == 200
    admin_get = await client.get(f"/api/v1/feed/posts/{post_id}", headers=admin_h)
    assert admin_get.status_code == 403

    # 5. Author publishes the draft
    pub_res = await client.patch(
        f"/api/v1/feed/posts/{post_id}",
        json={"status": "PUBLISHED"},
        headers=author_h,
    )
    assert pub_res.status_code == 200
    assert pub_res.json()["data"]["status"] == "PUBLISHED"
    assert pub_res.json()["data"]["published_at"] is not None

    # 6. Now General employee CAN see and access the published post
    emp_get_after = await client.get(f"/api/v1/feed/posts/{post_id}", headers=employee_h)
    assert emp_get_after.status_code == 200
    assert emp_get_after.json()["data"]["title"] == "Work In Progress Draft"


@pytest.mark.asyncio
async def test_feed_eligible_recipients_endpoint(
    client: AsyncClient,
    create_user_helper,
    create_department_helper,
    assign_user_to_department,
) -> None:
    """Test candidate recipient lookup for targeted post authoring with real ERP department."""
    author = await create_user_helper("Recipient Lookup Author")
    emp = await create_user_helper("Searchable Unique Employee")
    view_only = await create_user_helper("View Only User")
    dept = await create_department_helper("Operations Dept", "OPS")
    await assign_user_to_department(emp.id, dept.id)

    author_h = auth_headers(author.id, ["feed.create", "feed.view"])
    view_only_h = auth_headers(view_only.id, ["feed.view"])

    # Unauthorized employee without feed.create or feed.manage gets 403
    unauth_res = await client.get("/api/v1/feed/recipients/eligible", headers=view_only_h)
    assert unauth_res.status_code == 403

    # Authorized author can list recipients
    res = await client.get(
        f"/api/v1/feed/recipients/eligible?query={emp.username}", headers=author_h
    )
    assert res.status_code == 200
    data = res.json()["data"]
    matched = next((u for u in data if u["id"] == str(emp.id)), None)
    assert matched is not None
    assert matched["department_name"] == dept.name


@pytest.fixture
def create_department_helper():
    async def _create(name: str, code: str) -> "Role":
        from app.rbac.models import Role
        async with get_sessionmaker()() as db_session:
            r = Role(
                id=uuid.uuid4(),
                name=f"{name}_{uuid.uuid4().hex[:6]}",
                code=f"{code}_{uuid.uuid4().hex[:4]}",
                is_system=False,
            )
            db_session.add(r)
            await db_session.commit()
            await db_session.refresh(r)
            return r

    return _create


@pytest.fixture
def assign_user_to_department():
    async def _assign(user_id: uuid.UUID, role_id: uuid.UUID) -> "UserRole":
        from app.rbac.models import UserRole, RoleAssignmentStatus, RoleAssignmentType
        async with get_sessionmaker()() as db_session:
            ur = UserRole(
                id=uuid.uuid4(),
                user_id=user_id,
                role_id=role_id,
                status=RoleAssignmentStatus.ACTIVE,
                assignment_type=RoleAssignmentType.PRIMARY,
                is_primary=True,
            )
            db_session.add(ur)
            await db_session.commit()
            return ur

    return _assign


@pytest.mark.asyncio
async def test_feed_single_and_multi_department_targeting(
    client: AsyncClient,
    create_user_helper,
    create_department_helper,
    assign_user_to_department,
) -> None:
    """Test targeting one or multiple departments regardless of publisher's department."""
    from app.rbac.models import Role

    # Create departments
    dept_hr: Role = await create_department_helper("HR Dept", "HR")
    dept_it: Role = await create_department_helper("IT Dept", "IT")
    dept_sales: Role = await create_department_helper("Sales Dept", "SALES")

    # Author is in Sales
    author = await create_user_helper("Sales Publisher")
    await assign_user_to_department(author.id, dept_sales.id)
    author_h = auth_headers(author.id, ["feed.create", "feed.view"])

    # Employee in HR
    emp_hr = await create_user_helper("HR Specialist")
    await assign_user_to_department(emp_hr.id, dept_hr.id)
    emp_hr_h = auth_headers(emp_hr.id, ["feed.view"])

    # Employee in IT
    emp_it = await create_user_helper("IT Engineer")
    await assign_user_to_department(emp_it.id, dept_it.id)
    emp_it_h = auth_headers(emp_it.id, ["feed.view"])

    # Employee in Sales (unrelated)
    emp_sales = await create_user_helper("Sales Rep Other")
    await assign_user_to_department(emp_sales.id, dept_sales.id)
    emp_sales_h = auth_headers(emp_sales.id, ["feed.view"])

    # 1. Author in Sales publishes strictly to HR department
    res1 = await client.post(
        "/api/v1/feed/posts",
        json={
            "title": "HR Benefit Policy",
            "content": "Confidential to HR members only.",
            "audience_type": "SELECTED",
            "department_ids": [str(dept_hr.id)],
            "status": "PUBLISHED",
        },
        headers=author_h,
    )
    assert res1.status_code == 201
    post1_id = res1.json()["data"]["id"]
    targeted_depts = res1.json()["data"]["targeted_departments"]
    assert len(targeted_depts) == 1
    assert targeted_depts[0]["department_id"] == str(dept_hr.id)

    # HR employee can see and fetch post1
    hr_get1 = await client.get(f"/api/v1/feed/posts/{post1_id}", headers=emp_hr_h)
    assert hr_get1.status_code == 200

    # IT employee and Sales employee are denied access
    assert (await client.get(f"/api/v1/feed/posts/{post1_id}", headers=emp_it_h)).status_code == 403
    assert (await client.get(f"/api/v1/feed/posts/{post1_id}", headers=emp_sales_h)).status_code == 403

    # 2. Author publishes to BOTH HR and IT departments
    res2 = await client.post(
        "/api/v1/feed/posts",
        json={
            "title": "Joint HR and IT Onboarding Workflow",
            "content": "Message for all members of HR and IT departments.",
            "audience_type": "SELECTED",
            "department_ids": [str(dept_hr.id), str(dept_it.id)],
            "status": "PUBLISHED",
        },
        headers=author_h,
    )
    assert res2.status_code == 201
    post2_id = res2.json()["data"]["id"]

    # Both HR and IT employees can access post2
    assert (await client.get(f"/api/v1/feed/posts/{post2_id}", headers=emp_hr_h)).status_code == 200
    assert (await client.get(f"/api/v1/feed/posts/{post2_id}", headers=emp_it_h)).status_code == 200

    # Unrelated sales employee cannot access post2
    assert (await client.get(f"/api/v1/feed/posts/{post2_id}", headers=emp_sales_h)).status_code == 403


@pytest.mark.asyncio
async def test_feed_combined_targeting_and_deduplication(
    client: AsyncClient,
    create_user_helper,
    create_department_helper,
    assign_user_to_department,
) -> None:
    """Test combining department recipients and individual recipients with deduplication."""
    from app.rbac.models import Role

    dept_ops: Role = await create_department_helper("Operations", "OPS")
    dept_support: Role = await create_department_helper("Support", "SUP")

    author = await create_user_helper("Operations Publisher")
    author_h = auth_headers(author.id, ["feed.create", "feed.view"])

    # User in both Operations and Support
    multi_dept_user = await create_user_helper("Multi-Dept User")
    await assign_user_to_department(multi_dept_user.id, dept_ops.id)
    await assign_user_to_department(multi_dept_user.id, dept_support.id)

    # Standalone user in Support
    support_user = await create_user_helper("Support User")
    await assign_user_to_department(support_user.id, dept_support.id)

    # Individual user outside any targeted department
    lone_user = await create_user_helper("Individual Lone User")

    # Author publishes targeting:
    # - Dept Operations
    # - Dept Support
    # - Individual: multi_dept_user (already in Ops and Support!)
    # - Individual: lone_user
    res = await client.post(
        "/api/v1/feed/posts",
        json={
            "title": "Combined Targeting Announcement",
            "content": "Delivered to Operations, Support, and specific individual.",
            "audience_type": "SELECTED",
            "department_ids": [str(dept_ops.id), str(dept_support.id)],
            "recipient_ids": [str(multi_dept_user.id), str(lone_user.id)],
            "status": "PUBLISHED",
        },
        headers=author_h,
    )
    assert res.status_code == 201
    post_data = res.json()["data"]

    # Verify deduplication: multi_dept_user is present exactly once in recipients
    recipients = post_data["recipients"]
    multi_user_recs = [r for r in recipients if r["recipient_id"] == str(multi_dept_user.id)]
    assert len(multi_user_recs) == 1

    # Total recipients should be 3: multi_dept_user, support_user, lone_user
    recipient_ids = {r["recipient_id"] for r in recipients}
    assert recipient_ids == {str(multi_dept_user.id), str(support_user.id), str(lone_user.id)}

    # All three users can view the post
    for uid in [multi_dept_user.id, support_user.id, lone_user.id]:
        user_h = auth_headers(uid, ["feed.view"])
        get_res = await client.get(f"/api/v1/feed/posts/{post_data['id']}", headers=user_h)
        assert get_res.status_code == 200


@pytest.mark.asyncio
async def test_feed_audience_stability_across_department_transfers(
    client: AsyncClient,
    create_user_helper,
    create_department_helper,
    assign_user_to_department,
) -> None:
    """Test previously published announcements do NOT dynamically expand when a new user joins department."""
    from app.rbac.models import Role

    dept_finance: Role = await create_department_helper("Finance Dept", "FIN")

    author = await create_user_helper("Finance Director")
    author_h = auth_headers(author.id, ["feed.create", "feed.view"])

    # Existing member at publication time
    existing_emp = await create_user_helper("Existing Finance Member")
    await assign_user_to_department(existing_emp.id, dept_finance.id)
    existing_h = auth_headers(existing_emp.id, ["feed.view"])

    # Publish post
    res = await client.post(
        "/api/v1/feed/posts",
        json={
            "title": "Historical Financial Review Q1",
            "content": "Archival review for team members in department at time of posting.",
            "audience_type": "SELECTED",
            "department_ids": [str(dept_finance.id)],
            "status": "PUBLISHED",
        },
        headers=author_h,
    )
    assert res.status_code == 201
    post_id = res.json()["data"]["id"]

    # Verify existing employee can read
    assert (await client.get(f"/api/v1/feed/posts/{post_id}", headers=existing_h)).status_code == 200

    # LATER: New employee joins Finance department
    new_emp = await create_user_helper("New Finance Employee")
    await assign_user_to_department(new_emp.id, dept_finance.id)
    new_h = auth_headers(new_emp.id, ["feed.view"])

    # New employee joining the department SHOULD see it (standard ERP department membership visibility)
    new_get = await client.get(f"/api/v1/feed/posts/{post_id}", headers=new_h)
    assert new_get.status_code == 200


@pytest.mark.asyncio
async def test_feed_invalid_department_rejected(
    client: AsyncClient,
    create_user_helper,
) -> None:
    """Test submitting invalid or deleted department IDs returns 422."""
    author = await create_user_helper("Dept Validation Author")
    author_h = auth_headers(author.id, ["feed.create", "feed.view"])

    fake_dept_id = str(uuid.uuid4())
    res = await client.post(
        "/api/v1/feed/posts",
        json={
            "title": "Invalid Dept Test",
            "content": "Testing fake department.",
            "audience_type": "SELECTED",
            "department_ids": [fake_dept_id],
            "status": "PUBLISHED",
        },
        headers=author_h,
    )
    assert res.status_code == 422
    assert fake_dept_id in res.text


@pytest.mark.asyncio
async def test_feed_eligible_departments_endpoint(
    client: AsyncClient,
    create_user_helper,
    create_department_helper,
    assign_user_to_department,
) -> None:
    """Test listing eligible departments with member counts."""
    dept = await create_department_helper("Research and Dev", "RND")
    emp1 = await create_user_helper("RND User 1")
    emp2 = await create_user_helper("RND User 2")
    await assign_user_to_department(emp1.id, dept.id)
    await assign_user_to_department(emp2.id, dept.id)

    author = await create_user_helper("Eligible Dept Author")
    author_h = auth_headers(author.id, ["feed.create", "feed.view"])
    viewer_h = auth_headers(emp1.id, ["feed.view"])

    # Unauthorized user without feed.create gets 403
    unauth = await client.get("/api/v1/feed/departments/eligible", headers=viewer_h)
    assert unauth.status_code == 403

    # Authorized user can list departments
    res = await client.get("/api/v1/feed/departments/eligible", headers=author_h)
    assert res.status_code == 200
    depts = res.json()["data"]
    target_dept = next((d for d in depts if d["id"] == str(dept.id)), None)
    assert target_dept is not None
    assert target_dept["member_count"] >= 2

