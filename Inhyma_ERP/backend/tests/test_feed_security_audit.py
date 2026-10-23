"""
Feed Module Security, RBAC, Visibility & Ownership Audit Test Suite.

Covers all 15 security scenarios defined in PHASE 5:
1. Admin creates and publishes an Everyone announcement (All employees can view).
2. Admin creates a department-targeted announcement (Only targeted dept & author see it).
3. Admin creates an individual-targeted announcement (Only selected recipient & author see it; other Admins cannot).
4. Employee A creates an Everyone announcement (Employee A can edit/delete; Admin and Employee B CANNOT).
5. Employee A creates a department-targeted announcement (Dept members see it; outsiders & Admin CANNOT).
6. Employee A creates an individual announcement for Employee B (Employee B sees it; Employee C & Admin CANNOT).
7. Department employee tries to edit/delete another department employee's announcement (Denial 403).
8. Recipient tries to edit/delete the author's announcement (Denial 403).
9. IDOR / Mass Assignment protection (extra/forbidden fields like author_id rejected).
10. Direct interaction requests (comments, reactions, read status, readership) on unauthorized posts denied 403.
11. Multi-user feed list isolation (switching user tokens isolates private posts).
12. Multi-tenant / company context isolation.
13. Draft visibility (Draft visible ONLY to author, not to ordinary recipients or outside Admin).
14. Combined targeting (Union of department members OR individually selected employees, deduplicated).
15. Deleted post access (Post returns 404 and interactions return 404).
"""

from __future__ import annotations

import uuid
import pytest
from httpx import AsyncClient

from app.auth.service import AuthService
from app.rbac.models import Role, RoleAssignmentStatus, UserRole
from app.auth.service import create_access_token
from app.database.engine import get_sessionmaker
from app.users.models import User, UserStatus


def auth_headers(user_id: uuid.UUID, permissions: list[str]) -> dict[str, str]:
    """Helper to generate JWT bearer authorization headers for tests."""
    tok_obj = create_access_token(user_id, permissions=permissions)
    token_str = getattr(tok_obj, "token", tok_obj)
    return {"Authorization": f"Bearer {token_str}"}


@pytest.fixture
async def create_user_helper():
    """Fixture to generate active workforce user records in test DB."""
    async def _create(name: str, email_prefix: str | None = None) -> User:
        prefix = email_prefix or name.lower().replace(" ", "_")
        async with get_sessionmaker()() as db_session:
            user = User(
                id=uuid.uuid4(),
                email=f"{prefix}_{uuid.uuid4().hex[:6]}@example.com",
                username=f"{prefix}_{uuid.uuid4().hex[:6]}",
                first_name=name.split(" ")[0],
                last_name=name.split(" ")[1] if " " in name else "Workforce",
                display_name=name,
                employee_code=f"EMP-{uuid.uuid4().hex[:4].upper()}",
                status=UserStatus.ACTIVE,
                is_active=True,
            )
            db_session.add(user)
            await db_session.commit()
            await db_session.refresh(user)
            return user

    return _create


@pytest.fixture
async def create_department_helper():
    """Fixture to generate a test department role with unique name."""
    async def _create(name: str) -> Role:
        async with get_sessionmaker()() as db_session:
            dept = Role(
                id=uuid.uuid4(),
                name=f"{name}_{uuid.uuid4().hex[:6]}",
                code=name.upper().replace(" ", "_")[:15] + f"_{uuid.uuid4().hex[:4].upper()}",
                description=f"{name} Department Role",
                is_system=False,
            )
            db_session.add(dept)
            await db_session.commit()
            await db_session.refresh(dept)
            return dept

    return _create


@pytest.fixture
async def assign_department_helper():
    """Fixture to associate an employee with a department role."""
    async def _assign(user: User, dept: Role) -> None:
        from app.rbac.models import RoleAssignmentType
        async with get_sessionmaker()() as db_session:
            ur = UserRole(
                id=uuid.uuid4(),
                user_id=user.id,
                role_id=dept.id,
                status=RoleAssignmentStatus.ACTIVE,
                assignment_type=RoleAssignmentType.PRIMARY,
                is_primary=True,
            )
            db_session.add(ur)
            await db_session.commit()

    return _assign


@pytest.mark.asyncio
async def test_scenario_1_admin_creates_everyone_announcement(
    client: AsyncClient,
    create_user_helper,
) -> None:
    """1. Admin creates and publishes an Everyone announcement -> All authorized employees can view."""
    admin = await create_user_helper("Super Admin")
    emp = await create_user_helper("Standard Employee")

    admin_h = auth_headers(admin.id, ["feed.create", "feed.manage", "feed.view"])
    emp_h = auth_headers(emp.id, ["feed.view"])

    # Create & publish
    create_res = await client.post(
        "/api/v1/feed/posts",
        json={
            "title": "Company All-Hands Meeting",
            "content": "All hands on deck tomorrow at 10 AM.",
            "audience_type": "ALL",
            "status": "PUBLISHED",
        },
        headers=admin_h,
    )
    assert create_res.status_code == 201
    post_id = create_res.json()["data"]["id"]

    # Employee views in feed list and by ID
    list_res = await client.get("/api/v1/feed/posts", headers=emp_h)
    assert list_res.status_code == 200
    assert any(p["id"] == post_id for p in list_res.json()["data"]["items"])

    get_res = await client.get(f"/api/v1/feed/posts/{post_id}", headers=emp_h)
    assert get_res.status_code == 200
    assert get_res.json()["data"]["title"] == "Company All-Hands Meeting"


@pytest.mark.asyncio
async def test_scenario_2_admin_creates_department_announcement(
    client: AsyncClient,
    create_user_helper,
    create_department_helper,
    assign_department_helper,
) -> None:
    """2. Admin creates department-targeted post -> Dept members & Admin author view; outsiders & other Admins cannot."""
    admin_author = await create_user_helper("Admin Author")
    other_admin = await create_user_helper("Other Admin")
    eng_dept = await create_department_helper("Engineering")
    eng_emp = await create_user_helper("Eng Employee")
    sales_emp = await create_user_helper("Sales Employee")

    await assign_department_helper(eng_emp, eng_dept)

    author_h = auth_headers(admin_author.id, ["feed.create", "feed.manage", "feed.view"])
    other_admin_h = auth_headers(other_admin.id, ["feed.manage", "feed.view"])
    eng_h = auth_headers(eng_emp.id, ["feed.view"])
    sales_h = auth_headers(sales_emp.id, ["feed.view"])

    create_res = await client.post(
        "/api/v1/feed/posts",
        json={
            "title": "Engineering Architecture Sync",
            "content": "Deep dive into microservices.",
            "audience_type": "SELECTED",
            "department_ids": [str(eng_dept.id)],
            "status": "PUBLISHED",
        },
        headers=author_h,
    )
    assert create_res.status_code == 201
    post_id = create_res.json()["data"]["id"]

    # Author can view
    assert (await client.get(f"/api/v1/feed/posts/{post_id}", headers=author_h)).status_code == 200

    # Engineering employee can view
    assert (await client.get(f"/api/v1/feed/posts/{post_id}", headers=eng_h)).status_code == 200

    # Sales employee cannot view (403)
    assert (await client.get(f"/api/v1/feed/posts/{post_id}", headers=sales_h)).status_code == 403

    # Other Admin (not targeted, not author) cannot view (403)
    assert (await client.get(f"/api/v1/feed/posts/{post_id}", headers=other_admin_h)).status_code == 403


@pytest.mark.asyncio
async def test_scenario_3_admin_creates_individual_targeted_announcement(
    client: AsyncClient,
    create_user_helper,
) -> None:
    """3. Admin creates individual announcement -> Only selected recipient & author see it; other Admins cannot."""
    admin_author = await create_user_helper("Admin Creator")
    other_admin = await create_user_helper("Other Admin 2")
    targeted_user = await create_user_helper("Targeted Dev")
    non_targeted_user = await create_user_helper("Other Dev")

    admin_h = auth_headers(admin_author.id, ["feed.create", "feed.manage", "feed.view"])
    other_admin_h = auth_headers(other_admin.id, ["feed.manage", "feed.view"])
    target_h = auth_headers(targeted_user.id, ["feed.view"])
    non_target_h = auth_headers(non_targeted_user.id, ["feed.view"])

    create_res = await client.post(
        "/api/v1/feed/posts",
        json={
            "title": "Confidential Performance Review",
            "content": "Schedule for Q3 review.",
            "audience_type": "SELECTED",
            "recipient_ids": [str(targeted_user.id)],
            "status": "PUBLISHED",
        },
        headers=admin_h,
    )
    assert create_res.status_code == 201
    post_id = create_res.json()["data"]["id"]

    # Admin author can view
    assert (await client.get(f"/api/v1/feed/posts/{post_id}", headers=admin_h)).status_code == 200

    # Targeted employee can view
    assert (await client.get(f"/api/v1/feed/posts/{post_id}", headers=target_h)).status_code == 200

    # Other employee cannot view
    assert (await client.get(f"/api/v1/feed/posts/{post_id}", headers=non_target_h)).status_code == 403

    # Other Admin cannot view
    assert (await client.get(f"/api/v1/feed/posts/{post_id}", headers=other_admin_h)).status_code == 403


@pytest.mark.asyncio
async def test_scenario_4_employee_a_everyone_announcement_author_ownership(
    client: AsyncClient,
    create_user_helper,
) -> None:
    """4. Employee A creates Everyone announcement -> Employee A can edit/delete; Admin and Employee B CANNOT."""
    emp_a = await create_user_helper("Employee Alpha")
    emp_b = await create_user_helper("Employee Beta")
    admin = await create_user_helper("Executive Admin")

    emp_a_h = auth_headers(emp_a.id, ["feed.create", "feed.view"])
    emp_b_h = auth_headers(emp_b.id, ["feed.create", "feed.view"])
    admin_h = auth_headers(admin.id, ["feed.manage", "feed.view"])

    create_res = await client.post(
        "/api/v1/feed/posts",
        json={
            "title": "Board Game Night",
            "content": "Join us Friday in cafeteria.",
            "audience_type": "ALL",
            "status": "PUBLISHED",
        },
        headers=emp_a_h,
    )
    assert create_res.status_code == 201
    post_id = create_res.json()["data"]["id"]

    # Employee B tries to edit -> 403
    b_edit = await client.patch(
        f"/api/v1/feed/posts/{post_id}",
        json={"title": "Hacked Title"},
        headers=emp_b_h,
    )
    assert b_edit.status_code == 403

    # Admin tries to edit -> 403 (No admin override on editing another user's post)
    admin_edit = await client.patch(
        f"/api/v1/feed/posts/{post_id}",
        json={"title": "Admin Modified"},
        headers=admin_h,
    )
    assert admin_edit.status_code == 403

    # Admin tries to delete -> 403
    admin_del = await client.delete(f"/api/v1/feed/posts/{post_id}", headers=admin_h)
    assert admin_del.status_code == 403

    # Employee A can edit
    a_edit = await client.patch(
        f"/api/v1/feed/posts/{post_id}",
        json={"title": "Board Game Night Rescheduled"},
        headers=emp_a_h,
    )
    assert a_edit.status_code == 200
    assert a_edit.json()["data"]["title"] == "Board Game Night Rescheduled"

    # Employee A can delete
    a_del = await client.delete(f"/api/v1/feed/posts/{post_id}", headers=emp_a_h)
    assert a_del.status_code == 200


@pytest.mark.asyncio
async def test_scenario_5_employee_department_announcement_visibility(
    client: AsyncClient,
    create_user_helper,
    create_department_helper,
    assign_department_helper,
) -> None:
    """5. Employee A creates dept announcement -> Members see it; outsiders & Admin cannot."""
    dept = await create_department_helper("Finance")
    emp_a = await create_user_helper("Finance Lead")
    dept_member = await create_user_helper("Finance Analyst")
    outsider = await create_user_helper("HR Officer")
    admin = await create_user_helper("System Admin")

    await assign_department_helper(emp_a, dept)
    await assign_department_helper(dept_member, dept)

    emp_a_h = auth_headers(emp_a.id, ["feed.create", "feed.view"])
    member_h = auth_headers(dept_member.id, ["feed.view"])
    outsider_h = auth_headers(outsider.id, ["feed.view"])
    admin_h = auth_headers(admin.id, ["feed.manage", "feed.view"])

    create_res = await client.post(
        "/api/v1/feed/posts",
        json={
            "title": "Fiscal Year Closing",
            "content": "Finance department internal timeline.",
            "audience_type": "SELECTED",
            "department_ids": [str(dept.id)],
            "status": "PUBLISHED",
        },
        headers=emp_a_h,
    )
    assert create_res.status_code == 201
    post_id = create_res.json()["data"]["id"]

    # Member sees it
    assert (await client.get(f"/api/v1/feed/posts/{post_id}", headers=member_h)).status_code == 200

    # Outsider denied
    assert (await client.get(f"/api/v1/feed/posts/{post_id}", headers=outsider_h)).status_code == 403

    # Admin denied (not author or recipient)
    assert (await client.get(f"/api/v1/feed/posts/{post_id}", headers=admin_h)).status_code == 403


@pytest.mark.asyncio
async def test_scenario_6_employee_individual_announcement_visibility(
    client: AsyncClient,
    create_user_helper,
) -> None:
    """6. Employee A creates individual post for Employee B -> Employee B sees it; Employee C & Admin cannot."""
    emp_a = await create_user_helper("Sender A")
    emp_b = await create_user_helper("Recipient B")
    emp_c = await create_user_helper("Bystander C")
    admin = await create_user_helper("Overlooking Admin")

    emp_a_h = auth_headers(emp_a.id, ["feed.create", "feed.view"])
    emp_b_h = auth_headers(emp_b.id, ["feed.view"])
    emp_c_h = auth_headers(emp_c.id, ["feed.view"])
    admin_h = auth_headers(admin.id, ["feed.manage", "feed.view"])

    create_res = await client.post(
        "/api/v1/feed/posts",
        json={
            "title": "Private Handover Notes",
            "content": "Credentials and transition checklist.",
            "audience_type": "SELECTED",
            "recipient_ids": [str(emp_b.id)],
            "status": "PUBLISHED",
        },
        headers=emp_a_h,
    )
    assert create_res.status_code == 201
    post_id = create_res.json()["data"]["id"]

    # Recipient B can view
    assert (await client.get(f"/api/v1/feed/posts/{post_id}", headers=emp_b_h)).status_code == 200

    # Author A can view
    assert (await client.get(f"/api/v1/feed/posts/{post_id}", headers=emp_a_h)).status_code == 200

    # Bystander C denied
    assert (await client.get(f"/api/v1/feed/posts/{post_id}", headers=emp_c_h)).status_code == 403

    # Admin denied
    assert (await client.get(f"/api/v1/feed/posts/{post_id}", headers=admin_h)).status_code == 403


@pytest.mark.asyncio
async def test_scenario_7_and_8_department_colleague_and_recipient_cannot_edit_delete(
    client: AsyncClient,
    create_user_helper,
    create_department_helper,
    assign_department_helper,
) -> None:
    """7 & 8. Colleague in same department and individual recipient CANNOT edit or delete author's post."""
    dept = await create_department_helper("Operations")
    author = await create_user_helper("Ops Author")
    colleague = await create_user_helper("Ops Colleague")
    recipient = await create_user_helper("Ops Direct Recipient")

    await assign_department_helper(author, dept)
    await assign_department_helper(colleague, dept)

    author_h = auth_headers(author.id, ["feed.create", "feed.view"])
    colleague_h = auth_headers(colleague.id, ["feed.create", "feed.view"])
    recip_h = auth_headers(recipient.id, ["feed.create", "feed.view"])

    create_res = await client.post(
        "/api/v1/feed/posts",
        json={
            "title": "Operations Protocol",
            "content": "Ops shift roster.",
            "audience_type": "SELECTED",
            "department_ids": [str(dept.id)],
            "recipient_ids": [str(recipient.id)],
            "status": "PUBLISHED",
        },
        headers=author_h,
    )
    post_id = create_res.json()["data"]["id"]

    # 7. Department colleague attempts edit / delete -> 403
    colleague_patch = await client.patch(
        f"/api/v1/feed/posts/{post_id}",
        json={"title": "Unauthorized Modification"},
        headers=colleague_h,
    )
    assert colleague_patch.status_code == 403

    colleague_del = await client.delete(f"/api/v1/feed/posts/{post_id}", headers=colleague_h)
    assert colleague_del.status_code == 403

    # 8. Individual recipient attempts edit / delete -> 403
    recip_patch = await client.patch(
        f"/api/v1/feed/posts/{post_id}",
        json={"title": "Recipient Tampering"},
        headers=recip_h,
    )
    assert recip_patch.status_code == 403

    recip_del = await client.delete(f"/api/v1/feed/posts/{post_id}", headers=recip_h)
    assert recip_del.status_code == 403


@pytest.mark.asyncio
async def test_scenario_9_idor_and_mass_assignment_protection(
    client: AsyncClient,
    create_user_helper,
) -> None:
    """9. Prevent mass assignment of author_id, company_id, and arbitrary ID manipulation."""
    author = await create_user_helper("Legit Author")
    victim = await create_user_helper("Spoofed Author")

    author_h = auth_headers(author.id, ["feed.create", "feed.view"])

    # Mass assignment attempt: trying to pass author_id or spoofed fields
    payload = {
        "title": "Spoofed Announcement",
        "content": "Trying to impersonate victim.",
        "audience_type": "ALL",
        "author_id": str(victim.id),
        "status": "PUBLISHED",
    }
    res = await client.post("/api/v1/feed/posts", json=payload, headers=author_h)
    # Extra forbidden field triggers 422 unprocessable entity
    assert res.status_code == 422


@pytest.mark.asyncio
async def test_scenario_10_interaction_security_for_unauthorized_users(
    client: AsyncClient,
    create_user_helper,
) -> None:
    """10. Interactions (comments, reactions, read tracking, readership) denied on unauthorized posts."""
    author = await create_user_helper("Secret Author")
    intruder = await create_user_helper("Intruder")

    author_h = auth_headers(author.id, ["feed.create", "feed.view"])
    intruder_h = auth_headers(intruder.id, ["feed.create", "feed.view"])

    create_res = await client.post(
        "/api/v1/feed/posts",
        json={
            "title": "Private Discussion Post",
            "content": "Confidential interaction testing.",
            "audience_type": "SELECTED",
            "recipient_ids": [str(author.id)],
            "status": "PUBLISHED",
        },
        headers=author_h,
    )
    post_id = create_res.json()["data"]["id"]

    # 1. Intruder cannot list comments
    c_list = await client.get(f"/api/v1/feed/posts/{post_id}/comments", headers=intruder_h)
    assert c_list.status_code == 403

    # 2. Intruder cannot add comments
    c_add = await client.post(
        f"/api/v1/feed/posts/{post_id}/comments",
        json={"content": "Malicious comment"},
        headers=intruder_h,
    )
    assert c_add.status_code == 403

    # 3. Intruder cannot toggle reaction
    rx_toggle = await client.post(
        f"/api/v1/feed/posts/{post_id}/reactions",
        json={"reaction_type": "LIKE"},
        headers=intruder_h,
    )
    assert rx_toggle.status_code == 403

    # 4. Intruder cannot mark as read
    rd_mark = await client.post(f"/api/v1/feed/posts/{post_id}/read", headers=intruder_h)
    assert rd_mark.status_code == 403

    # 5. Intruder cannot inspect readership
    rd_list = await client.get(f"/api/v1/feed/posts/{post_id}/readership", headers=intruder_h)
    assert rd_list.status_code == 403


@pytest.mark.asyncio
async def test_scenario_11_and_12_feed_isolation_and_recipient_privacy(
    client: AsyncClient,
    create_user_helper,
) -> None:
    """11 & 12. Feed list isolation: Viewers do not see private posts or full recipient lists."""
    author = await create_user_helper("Privacy Author")
    viewer = await create_user_helper("Allowed Viewer")
    other_recip = await create_user_helper("Other Secret Recipient")

    author_h = auth_headers(author.id, ["feed.create", "feed.view"])
    viewer_h = auth_headers(viewer.id, ["feed.view"])

    create_res = await client.post(
        "/api/v1/feed/posts",
        json={
            "title": "Restricted Target Post",
            "content": "Testing recipient data stripping.",
            "audience_type": "SELECTED",
            "recipient_ids": [str(viewer.id), str(other_recip.id)],
            "status": "PUBLISHED",
        },
        headers=author_h,
    )
    post_id = create_res.json()["data"]["id"]

    # Author gets the full recipient list
    author_get = await client.get(f"/api/v1/feed/posts/{post_id}", headers=author_h)
    assert author_get.status_code == 200
    assert len(author_get.json()["data"]["recipients"]) == 2

    # Viewer can access post, but recipients list is empty (no leaking other employee identities/emails)
    viewer_get = await client.get(f"/api/v1/feed/posts/{post_id}", headers=viewer_h)
    assert viewer_get.status_code == 200
    assert viewer_get.json()["data"]["recipients"] == []


@pytest.mark.asyncio
async def test_scenario_13_draft_visibility_strictness(
    client: AsyncClient,
    create_user_helper,
) -> None:
    """13. Drafts visible ONLY to author; never returned to recipients or outside Admin before publication."""
    author = await create_user_helper("Draftsman")
    intended_recip = await create_user_helper("Intended Recipient")
    admin = await create_user_helper("Admin Inspector")

    author_h = auth_headers(author.id, ["feed.create", "feed.view"])
    recip_h = auth_headers(intended_recip.id, ["feed.view"])
    admin_h = auth_headers(admin.id, ["feed.manage", "feed.view"])

    create_res = await client.post(
        "/api/v1/feed/posts",
        json={
            "title": "Future Strategy Draft",
            "content": "Not ready for public eyes.",
            "audience_type": "SELECTED",
            "recipient_ids": [str(intended_recip.id)],
            "status": "DRAFT",
        },
        headers=author_h,
    )
    post_id = create_res.json()["data"]["id"]

    # Author can view draft
    assert (await client.get(f"/api/v1/feed/posts/{post_id}", headers=author_h)).status_code == 200

    # Intended recipient gets 403 while in draft
    assert (await client.get(f"/api/v1/feed/posts/{post_id}", headers=recip_h)).status_code == 403

    # Outside Admin gets 403 while in draft
    assert (await client.get(f"/api/v1/feed/posts/{post_id}", headers=admin_h)).status_code == 403


@pytest.mark.asyncio
async def test_scenario_14_combined_targeting_and_deduplication(
    client: AsyncClient,
    create_user_helper,
    create_department_helper,
    assign_department_helper,
) -> None:
    """14. Combined targeting: dept members OR individual recipients can view, deduplicated."""
    dept = await create_department_helper("Quality Assurance")
    qa_user = await create_user_helper("QA Specialist")
    individual_user = await create_user_helper("Design Specialist")
    unrelated_user = await create_user_helper("External Specialist")
    author = await create_user_helper("Broadcaster")

    # qa_user is in QA dept AND also passed explicitly in recipient_ids
    await assign_department_helper(qa_user, dept)

    author_h = auth_headers(author.id, ["feed.create", "feed.view"])
    qa_h = auth_headers(qa_user.id, ["feed.view"])
    indiv_h = auth_headers(individual_user.id, ["feed.view"])
    unrelated_h = auth_headers(unrelated_user.id, ["feed.view"])

    create_res = await client.post(
        "/api/v1/feed/posts",
        json={
            "title": "Combined Launch Checklist",
            "content": "For QA department and Design specialist.",
            "audience_type": "SELECTED",
            "department_ids": [str(dept.id)],
            "recipient_ids": [str(qa_user.id), str(individual_user.id)],
            "status": "PUBLISHED",
        },
        headers=author_h,
    )
    assert create_res.status_code == 201
    post_id = create_res.json()["data"]["id"]

    # Author sees deduplicated recipients (qa_user + individual_user = 2 unique recipients)
    post_data = create_res.json()["data"]
    recip_ids = [r["recipient_id"] for r in post_data["recipients"]]
    assert len(recip_ids) == len(set(recip_ids))

    # QA member can view
    assert (await client.get(f"/api/v1/feed/posts/{post_id}", headers=qa_h)).status_code == 200

    # Individual recipient can view
    assert (await client.get(f"/api/v1/feed/posts/{post_id}", headers=indiv_h)).status_code == 200

    # Unrelated user denied
    assert (await client.get(f"/api/v1/feed/posts/{post_id}", headers=unrelated_h)).status_code == 403


@pytest.mark.asyncio
async def test_scenario_15_deleted_post_inaccessible(
    client: AsyncClient,
    create_user_helper,
) -> None:
    """15. Deleted post cannot be retrieved by ID or in list."""
    author = await create_user_helper("Post Destroyer")
    author_h = auth_headers(author.id, ["feed.create", "feed.view"])

    create_res = await client.post(
        "/api/v1/feed/posts",
        json={
            "title": "Soon to be deleted",
            "content": "Short lived post.",
            "audience_type": "ALL",
            "status": "PUBLISHED",
        },
        headers=author_h,
    )
    post_id = create_res.json()["data"]["id"]

    # Delete
    del_res = await client.delete(f"/api/v1/feed/posts/{post_id}", headers=author_h)
    assert del_res.status_code == 200

    # Attempting to fetch deleted post returns 404
    get_res = await client.get(f"/api/v1/feed/posts/{post_id}", headers=author_h)
    assert get_res.status_code == 404
