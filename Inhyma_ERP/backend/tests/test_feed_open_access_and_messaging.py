"""
Phase 5 Comprehensive Acceptance & Security Test Suite for Open Broadcasting and Direct Messaging.

Tests:
1. Every employee (from different departments, zero feed permissions) can publish company-wide announcements.
2. Every employee can publish department-targeted, individual-targeted, and combined-targeted announcements.
3. Authors can edit and soft-delete their own announcements; other users cannot.
4. Employees can start 1-to-1 private conversations and send messages; unrelated third parties & admin cannot access.
5. Only sender can edit/delete their own private messages; recipient cannot edit or delete.
6. Unread direct message count tracking and mark-as-read updates correctly.
7. Security: invalid IDs, non-existent recipients, self-messaging, and cross-access rejected safely.
8. Existing reactions and comments continue working without regression.
"""

from __future__ import annotations

import uuid
import pytest
from httpx import AsyncClient

from app.auth.service import create_access_token
from app.database.engine import get_sessionmaker
from app.users.models import User, UserStatus
from app.rbac.models import Role, UserRole, RoleAssignmentStatus, RoleAssignmentType


def auth_headers(user_id: uuid.UUID, permissions: list[str] | None = None) -> dict[str, str]:
    tok_obj = create_access_token(user_id, permissions=permissions or [])
    token_str = getattr(tok_obj, "token", tok_obj)
    return {"Authorization": f"Bearer {token_str}"}


def unpack(res) -> dict:
    body = res.json()
    if isinstance(body, dict) and "data" in body:
        return body["data"]
    return body


@pytest.fixture
async def setup_test_users():
    """
    Creates 3 ordinary employees across 3 different departments (with ZERO feed permissions)
    and 1 Admin user.
    """
    async with get_sessionmaker()() as session:
        # Create 3 departments / roles
        role_eng = Role(
            id=uuid.uuid4(),
            name=f"Engineering_{uuid.uuid4().hex[:4]}",
            code=f"ENG_{uuid.uuid4().hex[:4]}",
            is_system=False,
        )
        role_sales = Role(
            id=uuid.uuid4(),
            name=f"Sales_{uuid.uuid4().hex[:4]}",
            code=f"SAL_{uuid.uuid4().hex[:4]}",
            is_system=False,
        )
        role_hr = Role(
            id=uuid.uuid4(),
            name=f"HR_{uuid.uuid4().hex[:4]}",
            code=f"HR_{uuid.uuid4().hex[:4]}",
            is_system=False,
        )
        role_admin = Role(
            id=uuid.uuid4(),
            name=f"Admin_{uuid.uuid4().hex[:4]}",
            code=f"ADM_{uuid.uuid4().hex[:4]}",
            is_system=True,
        )
        session.add_all([role_eng, role_sales, role_hr, role_admin])
        await session.flush()

        # Employee 1: Engineering (no feed permissions)
        emp1 = User(
            id=uuid.uuid4(),
            username=f"emp_eng_{uuid.uuid4().hex[:6]}",
            email=f"emp1_{uuid.uuid4().hex[:6]}@example.com",
            display_name="Alice Engineer",
            employee_code=f"ENG-{uuid.uuid4().hex[:4].upper()}",
            status=UserStatus.ACTIVE,
            is_active=True,
        )
        # Employee 2: Sales (no feed permissions)
        emp2 = User(
            id=uuid.uuid4(),
            username=f"emp_sales_{uuid.uuid4().hex[:6]}",
            email=f"emp2_{uuid.uuid4().hex[:6]}@example.com",
            display_name="Bob Sales",
            employee_code=f"SAL-{uuid.uuid4().hex[:4].upper()}",
            status=UserStatus.ACTIVE,
            is_active=True,
        )
        # Employee 3: HR (no feed permissions)
        emp3 = User(
            id=uuid.uuid4(),
            username=f"emp_hr_{uuid.uuid4().hex[:6]}",
            email=f"emp3_{uuid.uuid4().hex[:6]}@example.com",
            display_name="Charlie HR",
            employee_code=f"HR-{uuid.uuid4().hex[:4].upper()}",
            status=UserStatus.ACTIVE,
            is_active=True,
        )
        # Admin user
        admin = User(
            id=uuid.uuid4(),
            username=f"admin_{uuid.uuid4().hex[:6]}",
            email=f"admin_{uuid.uuid4().hex[:6]}@example.com",
            display_name="Diana Admin",
            employee_code=f"ADM-{uuid.uuid4().hex[:4].upper()}",
            status=UserStatus.ACTIVE,
            is_active=True,
        )
        session.add_all([emp1, emp2, emp3, admin])
        await session.flush()

        # Assign roles to users
        session.add_all([
            UserRole(
                id=uuid.uuid4(),
                user_id=emp1.id,
                role_id=role_eng.id,
                status=RoleAssignmentStatus.ACTIVE,
                assignment_type=RoleAssignmentType.PRIMARY,
                is_primary=True,
            ),
            UserRole(
                id=uuid.uuid4(),
                user_id=emp2.id,
                role_id=role_sales.id,
                status=RoleAssignmentStatus.ACTIVE,
                assignment_type=RoleAssignmentType.PRIMARY,
                is_primary=True,
            ),
            UserRole(
                id=uuid.uuid4(),
                user_id=emp3.id,
                role_id=role_hr.id,
                status=RoleAssignmentStatus.ACTIVE,
                assignment_type=RoleAssignmentType.PRIMARY,
                is_primary=True,
            ),
            UserRole(
                id=uuid.uuid4(),
                user_id=admin.id,
                role_id=role_admin.id,
                status=RoleAssignmentStatus.ACTIVE,
                assignment_type=RoleAssignmentType.PRIMARY,
                is_primary=True,
            ),
        ])
        await session.commit()

        return {
            "emp1": emp1,
            "emp2": emp2,
            "emp3": emp3,
            "admin": admin,
            "role_eng": role_eng,
            "role_sales": role_sales,
            "role_hr": role_hr,
        }


@pytest.mark.asyncio
async def test_01_all_employees_can_publish_company_wide_announcements(client: AsyncClient, setup_test_users):
    """
    Verify every ordinary employee without feed.create or feed.manage can publish
    company-wide announcements.
    """
    users = setup_test_users
    for emp_key in ["emp1", "emp2", "emp3"]:
        emp = users[emp_key]
        headers = auth_headers(emp.id)

        res = await client.post(
            "/api/v1/feed/posts",
            headers=headers,
            json={
                "title": f"Broadcast from {emp.display_name}",
                "content": f"Hello ERP from {emp.display_name} in their department.",
                "audience_type": "ALL",
                "status": "PUBLISHED",
            },
        )
        assert res.status_code == 201, f"{emp_key} failed to publish broadcast: {res.text}"
        data = unpack(res)
        assert data["title"] == f"Broadcast from {emp.display_name}"
        assert data["audience_type"] == "ALL"
        assert data["author_id"] == str(emp.id)


@pytest.mark.asyncio
async def test_02_all_employees_can_publish_targeted_announcements(client: AsyncClient, setup_test_users):
    """
    Verify employees can target one or more departments, specific employees, and combined.
    """
    users = setup_test_users
    emp1 = users["emp1"]
    emp2 = users["emp2"]
    emp3 = users["emp3"]
    role_sales = users["role_sales"]

    headers_emp1 = auth_headers(emp1.id)

    # 1. Department-targeted post
    res_dept = await client.post(
        "/api/v1/feed/posts",
        headers=headers_emp1,
        json={
            "title": "Engineering to Sales Update",
            "content": "Sales team, new feature deployed.",
            "audience_type": "SELECTED",
            "department_ids": [str(role_sales.id)],
            "status": "PUBLISHED",
        },
    )
    assert res_dept.status_code == 201, res_dept.text
    post_dept = unpack(res_dept)
    assert len(post_dept["targeted_departments"]) == 1

    # 2. Individual-targeted post
    res_indiv = await client.post(
        "/api/v1/feed/posts",
        headers=headers_emp1,
        json={
            "title": "Private Announcement to Bob",
            "content": "Bob, please review the sales document.",
            "audience_type": "SELECTED",
            "recipient_ids": [str(emp2.id)],
            "status": "PUBLISHED",
        },
    )
    assert res_indiv.status_code == 201, res_indiv.text
    post_indiv = unpack(res_indiv)
    assert len(post_indiv["recipients"]) == 1

    # 3. Combined department + individual targeting
    res_comb = await client.post(
        "/api/v1/feed/posts",
        headers=headers_emp1,
        json={
            "title": "Combined Target Announcement",
            "content": "To Sales team plus Charlie in HR.",
            "audience_type": "SELECTED",
            "department_ids": [str(role_sales.id)],
            "recipient_ids": [str(emp3.id)],
            "status": "PUBLISHED",
        },
    )
    assert res_comb.status_code == 201, res_comb.text
    post_comb = unpack(res_comb)
    assert len(post_comb["targeted_departments"]) == 1
    assert len(post_comb["recipients"]) >= 1


@pytest.mark.asyncio
async def test_03_author_can_edit_delete_own_announcement_others_cannot(client: AsyncClient, setup_test_users):
    """
    Verify author can edit/delete their own announcement, but another employee cannot.
    """
    users = setup_test_users
    emp1 = users["emp1"]
    emp2 = users["emp2"]

    # Emp1 creates announcement
    res = await client.post(
        "/api/v1/feed/posts",
        headers=auth_headers(emp1.id),
        json={"title": "Original Title", "content": "Original content", "audience_type": "ALL", "status": "PUBLISHED"},
    )
    assert res.status_code == 201
    post_id = unpack(res)["id"]

    # Emp2 attempts to edit Emp1's announcement -> 403 Forbidden
    res_edit_emp2 = await client.patch(
        f"/api/v1/feed/posts/{post_id}",
        headers=auth_headers(emp2.id),
        json={"title": "Hacked Title"},
    )
    assert res_edit_emp2.status_code == 403

    # Emp2 attempts to delete Emp1's announcement -> 403 Forbidden
    res_del_emp2 = await client.delete(
        f"/api/v1/feed/posts/{post_id}",
        headers=auth_headers(emp2.id),
    )
    assert res_del_emp2.status_code == 403

    # Emp1 edits own announcement -> 200 OK
    res_edit_emp1 = await client.patch(
        f"/api/v1/feed/posts/{post_id}",
        headers=auth_headers(emp1.id),
        json={"title": "Updated Title By Author"},
    )
    assert res_edit_emp1.status_code == 200
    assert unpack(res_edit_emp1)["title"] == "Updated Title By Author"

    # Emp1 deletes own announcement -> 200 OK
    res_del_emp1 = await client.delete(
        f"/api/v1/feed/posts/{post_id}",
        headers=auth_headers(emp1.id),
    )
    assert res_del_emp1.status_code == 200


@pytest.mark.asyncio
async def test_04_direct_messaging_lifecycle_and_privacy(client: AsyncClient, setup_test_users):
    """
    Verify direct messaging:
    - Start conversation between emp1 and emp2.
    - Emp1 sends a private message to emp2.
    - Emp2 can see and list the message.
    - Emp3 (unrelated employee) CANNOT access the conversation or messages (403 Forbidden).
    - Admin CANNOT automatically access the private conversation or messages (403 Forbidden).
    """
    users = setup_test_users
    emp1 = users["emp1"]
    emp2 = users["emp2"]
    emp3 = users["emp3"]
    admin = users["admin"]

    # 1. Emp1 starts conversation with Emp2
    res_conv = await client.post(
        "/api/v1/feed/conversations",
        headers=auth_headers(emp1.id),
        json={"recipient_id": str(emp2.id)},
    )
    assert res_conv.status_code == 201, res_conv.text
    conv = unpack(res_conv)
    conv_id = conv["id"]
    assert conv["other_participant"]["user_id"] == str(emp2.id)

    # 2. Emp1 sends message to Emp2
    res_msg = await client.post(
        f"/api/v1/feed/conversations/{conv_id}/messages",
        headers=auth_headers(emp1.id),
        json={"content": "Confidential quarterly engineering notes."},
    )
    assert res_msg.status_code == 201, res_msg.text
    msg = unpack(res_msg)
    msg_id = msg["id"]
    assert msg["sender_id"] == str(emp1.id)
    assert msg["content"] == "Confidential quarterly engineering notes."

    # 3. Emp2 lists messages in the conversation -> 200 OK with message
    res_list_emp2 = await client.get(
        f"/api/v1/feed/conversations/{conv_id}/messages",
        headers=auth_headers(emp2.id),
    )
    assert res_list_emp2.status_code == 200
    items_emp2 = unpack(res_list_emp2)["items"]
    assert len(items_emp2) == 1
    assert items_emp2[0]["id"] == msg_id

    # 4. Emp3 (third party) tries to list conversation messages -> 403 Forbidden
    res_list_emp3 = await client.get(
        f"/api/v1/feed/conversations/{conv_id}/messages",
        headers=auth_headers(emp3.id),
    )
    assert res_list_emp3.status_code == 403

    # 5. Emp3 tries to get conversation details -> 403 Forbidden
    res_get_emp3 = await client.get(
        f"/api/v1/feed/conversations/{conv_id}",
        headers=auth_headers(emp3.id),
    )
    assert res_get_emp3.status_code == 403

    # 6. Admin tries to list conversation messages -> 403 Forbidden (Strict privacy)
    res_list_admin = await client.get(
        f"/api/v1/feed/conversations/{conv_id}/messages",
        headers=auth_headers(admin.id, ["system.admin"]),
    )
    assert res_list_admin.status_code == 403

    # 7. Admin tries to send message in unjoined conversation -> 403 Forbidden
    res_send_admin = await client.post(
        f"/api/v1/feed/conversations/{conv_id}/messages",
        headers=auth_headers(admin.id, ["system.admin"]),
        json={"content": "Admin trying to inject"},
    )
    assert res_send_admin.status_code == 403


@pytest.mark.asyncio
async def test_05_message_edit_and_delete_permissions(client: AsyncClient, setup_test_users):
    """
    Verify:
    - Sender can edit/delete their own message.
    - Recipient cannot edit or delete sender's message.
    - Third party cannot edit or delete sender's message.
    """
    users = setup_test_users
    emp1 = users["emp1"]
    emp2 = users["emp2"]
    emp3 = users["emp3"]

    # Start conversation and send message
    res_conv = await client.post(
        "/api/v1/feed/conversations",
        headers=auth_headers(emp1.id),
        json={"recipient_id": str(emp2.id)},
    )
    conv_id = unpack(res_conv)["id"]

    res_msg = await client.post(
        f"/api/v1/feed/conversations/{conv_id}/messages",
        headers=auth_headers(emp1.id),
        json={"content": "Draft thought"},
    )
    msg_id = unpack(res_msg)["id"]

    # Recipient Emp2 attempts to edit -> 403 Forbidden
    res_edit_recip = await client.patch(
        f"/api/v1/feed/messages/{msg_id}",
        headers=auth_headers(emp2.id),
        json={"content": "Tampered content"},
    )
    assert res_edit_recip.status_code == 403

    # Third-party Emp3 attempts to edit -> 403 Forbidden
    res_edit_third = await client.patch(
        f"/api/v1/feed/messages/{msg_id}",
        headers=auth_headers(emp3.id),
        json={"content": "Tampered content"},
    )
    assert res_edit_third.status_code == 403

    # Recipient Emp2 attempts to delete -> 403 Forbidden
    res_del_recip = await client.delete(
        f"/api/v1/feed/messages/{msg_id}",
        headers=auth_headers(emp2.id),
    )
    assert res_del_recip.status_code == 403

    # Sender Emp1 edits message -> 200 OK
    res_edit_sender = await client.patch(
        f"/api/v1/feed/messages/{msg_id}",
        headers=auth_headers(emp1.id),
        json={"content": "Polished final thought"},
    )
    assert res_edit_sender.status_code == 200
    assert unpack(res_edit_sender)["content"] == "Polished final thought"
    assert unpack(res_edit_sender)["is_edited"] is True

    # Sender Emp1 deletes message -> 200 OK
    res_del_sender = await client.delete(
        f"/api/v1/feed/messages/{msg_id}",
        headers=auth_headers(emp1.id),
    )
    assert res_del_sender.status_code == 200
    assert unpack(res_del_sender)["deleted"] is True

    # After deletion, message no longer in list
    res_list = await client.get(
        f"/api/v1/feed/conversations/{conv_id}/messages",
        headers=auth_headers(emp1.id),
    )
    assert len(unpack(res_list)["items"]) == 0


@pytest.mark.asyncio
async def test_06_unread_count_and_read_status(client: AsyncClient, setup_test_users):
    """
    Verify unread direct message count tracking and mark conversation read endpoint.
    """
    users = setup_test_users
    emp1 = users["emp1"]
    emp2 = users["emp2"]

    # Start conversation
    res_conv = await client.post(
        "/api/v1/feed/conversations",
        headers=auth_headers(emp1.id),
        json={"recipient_id": str(emp2.id)},
    )
    conv_id = unpack(res_conv)["id"]

    # Check Emp2's unread count initially
    res_init_unread = await client.get(
        "/api/v1/feed/conversations/unread-count",
        headers=auth_headers(emp2.id),
    )
    initial_unread = unpack(res_init_unread)["unread_count"]

    # Emp1 sends 2 messages to Emp2
    await client.post(f"/api/v1/feed/conversations/{conv_id}/messages", headers=auth_headers(emp1.id), json={"content": "Msg 1"})
    await client.post(f"/api/v1/feed/conversations/{conv_id}/messages", headers=auth_headers(emp1.id), json={"content": "Msg 2"})

    # Emp2 unread count must increase by 2
    res_after_unread = await client.get(
        "/api/v1/feed/conversations/unread-count",
        headers=auth_headers(emp2.id),
    )
    assert unpack(res_after_unread)["unread_count"] == initial_unread + 2

    # Emp2 marks conversation read
    res_mark_read = await client.post(
        f"/api/v1/feed/conversations/{conv_id}/read",
        headers=auth_headers(emp2.id),
    )
    assert res_mark_read.status_code == 200
    assert unpack(res_mark_read)["is_read"] is True

    # Emp2 unread count decreases back
    res_final_unread = await client.get(
        "/api/v1/feed/conversations/unread-count",
        headers=auth_headers(emp2.id),
    )
    assert unpack(res_final_unread)["unread_count"] == initial_unread


@pytest.mark.asyncio
async def test_07_invalid_ids_and_non_existent_recipients(client: AsyncClient, setup_test_users):
    """
    Verify robust security checks for invalid IDs and non-existent recipients:
    - Starting conversation with self rejected.
    - Starting conversation with non-existent user rejected.
    - Accessing non-existent conversation returns 404.
    - Accessing non-existent message returns 404.
    """
    users = setup_test_users
    emp1 = users["emp1"]
    fake_id = str(uuid.uuid4())

    # Conversation with self -> 400 Bad Request
    res_self = await client.post(
        "/api/v1/feed/conversations",
        headers=auth_headers(emp1.id),
        json={"recipient_id": str(emp1.id)},
    )
    assert res_self.status_code == 400

    # Conversation with non-existent user -> 404 Not Found
    res_fake = await client.post(
        "/api/v1/feed/conversations",
        headers=auth_headers(emp1.id),
        json={"recipient_id": fake_id},
    )
    assert res_fake.status_code == 404

    # Accessing non-existent conversation -> 404 Not Found
    res_conv_404 = await client.get(
        f"/api/v1/feed/conversations/{fake_id}",
        headers=auth_headers(emp1.id),
    )
    assert res_conv_404.status_code == 404

    # Accessing non-existent message -> 404 Not Found
    res_msg_404 = await client.patch(
        f"/api/v1/feed/messages/{fake_id}",
        headers=auth_headers(emp1.id),
        json={"content": "test"},
    )
    assert res_msg_404.status_code == 404


@pytest.mark.asyncio
async def test_08_existing_reactions_and_comments_continue_working(client: AsyncClient, setup_test_users):
    """
    Verify existing feed functionality (reactions, comments) continues working cleanly.
    """
    users = setup_test_users
    emp1 = users["emp1"]
    emp2 = users["emp2"]

    # Emp1 posts announcement
    res_post = await client.post(
        "/api/v1/feed/posts",
        headers=auth_headers(emp1.id),
        json={"title": "Team Update", "content": "Great milestone achieved!", "audience_type": "ALL", "status": "PUBLISHED"},
    )
    post_id = unpack(res_post)["id"]

    # Emp2 reacts CELEBRATE
    res_react = await client.post(
        f"/api/v1/feed/posts/{post_id}/reactions",
        headers=auth_headers(emp2.id),
        json={"reaction_type": "CELEBRATE"},
    )
    assert res_react.status_code == 200
    assert unpack(res_react)["counts"]["celebrate"] == 1

    # Emp2 comments on post
    res_comment = await client.post(
        f"/api/v1/feed/posts/{post_id}/comments",
        headers=auth_headers(emp2.id),
        json={"content": "Congratulations team!"},
    )
    assert res_comment.status_code == 201
    comment_id = unpack(res_comment)["id"]

    # List comments
    res_list_comments = await client.get(
        f"/api/v1/feed/posts/{post_id}/comments",
        headers=auth_headers(emp1.id),
    )
    assert res_list_comments.status_code == 200
    assert any(c["id"] == comment_id for c in unpack(res_list_comments)["items"])
