"""
Company Feed Employee Interaction RBAC Remediation (KNOWN-01) — Real PG18 Regression Suite.

Validates separation of `feed.interact` from `feed.create`:
- Seed bootstrap contract: `feed.interact` exists in `BOOTSTRAP_PERMISSIONS` and
  `USER_ROLE_PERMISSION_CODES`, while `feed.create` and `feed.manage` remain strictly
  excluded from `USER_ROLE_PERMISSION_CODES`.
- Employee (`feed.view` + `feed.interact`, NO `feed.create`, NO `feed.manage`):
  - CAN react (LIKE/CELEBRATE/SUPPORT + unlike) and comment (add/edit own/delete own)
    on authorized visible announcements.
  - CAN reply, edit own reply, and delete own reply inside their own authorized 1:1 DM
    conversation.
  - CANNOT create/edit/delete announcements (`feed.create`), CANNOT query eligible
    recipients/departments, CANNOT initiate brand-new DM threads (`POST /conversations`),
    CANNOT delete other users' comments (`feed.manage`), CANNOT react/comment on
    confidential untargeted posts, and CANNOT read/reply/edit/delete other users' DMs.
- Manager (`feed.view` + `feed.create`), HR (with & without `feed.manage`),
  Admin (`super_admin`), Read-Only (`feed.view` ONLY), Explicit Deny (`deny:feed.interact`,
  `deny:feed.view`), and Unauthorized users (no perms / unauthenticated) are all verified.

Safety:
- Runs strictly against isolated local PostgreSQL `inhyma_test_db`, never Supabase.
- Cleans up 100% of synthetic records in `finally:`.
"""

from __future__ import annotations

import os
import uuid

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine

from app.auth.security import create_access_token, hash_password
from app.core.config import settings
from app.feed.models import FeedConversation, FeedPost
from app.main import create_application
from app.notifications.models import Notification
from app.rbac.models import Permission, Role, RoleAssignmentStatus, RolePermission, UserPermission, UserRole
from app.rbac.repository import RoleRepository
from app.users.models import EmploymentStatus, EmploymentType, User, UserStatus
from scripts.seed import BOOTSTRAP_PERMISSIONS, USER_ROLE_PERMISSION_CODES

PG_TEST_URL = os.environ.get(
    "FEED_PG_TEST_URL",
    os.environ.get("TEST_DATABASE_URL", "postgresql+asyncpg://postgres:root@127.0.0.1:5432/inhyma_test_db"),
)


def _ensure_safe_local_pg(url: str) -> None:
    lower = url.lower()
    if "supabase.com" in lower or "supabase.co" in lower:
        pytest.skip("Refusing to execute Feed PostgreSQL tests against Supabase.")
    if not lower.startswith("postgresql"):
        pytest.skip("Feed PostgreSQL integration suite requires PostgreSQL DATABASE_URL.")


def test_seed_grants_feed_interact_without_feed_create_to_default_user_role():
    """Verify default `user` role grants `feed.view` + `feed.interact` and NOT `feed.create`/`feed.manage`."""
    bootstrap_codes = {row[0] for row in BOOTSTRAP_PERMISSIONS}
    assert "feed.view" in bootstrap_codes
    assert "feed.interact" in bootstrap_codes
    assert "feed.create" in bootstrap_codes
    assert "feed.manage" in bootstrap_codes

    assert "feed.view" in USER_ROLE_PERMISSION_CODES
    assert "feed.interact" in USER_ROLE_PERMISSION_CODES
    assert "feed.create" not in USER_ROLE_PERMISSION_CODES
    assert "feed.manage" not in USER_ROLE_PERMISSION_CODES


@pytest_asyncio.fixture
async def pg_feed_interact_env():
    _ensure_safe_local_pg(PG_TEST_URL)
    prev_db_url = str(settings.DATABASE_URL)
    os.environ["DATABASE_URL"] = PG_TEST_URL
    object.__setattr__(settings, "DATABASE_URL", PG_TEST_URL)

    import app.database.engine as engine_module

    await engine_module.dispose_engine()

    engine: AsyncEngine = create_async_engine(PG_TEST_URL, pool_size=15, max_overflow=20)
    SessionFactory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    tag = uuid.uuid4().hex[:8].lower()
    pw_hash = hash_password("FeedInteract!2026")

    created_user_ids: list[uuid.UUID] = []
    created_role_ids: list[uuid.UUID] = []
    created_post_ids: list[uuid.UUID] = []
    created_conv_ids: list[uuid.UUID] = []
    created_interact_perm_id: uuid.UUID | None = None

    async with SessionFactory() as boot_db:
        existing_interact = (
            await boot_db.execute(select(Permission).where(Permission.code == "feed.interact"))
        ).scalar_one_or_none()
        if existing_interact is None:
            new_perm = Permission(
                code="feed.interact",
                module="feed",
                page="feed",
                action="interact",
                scope="ALL",
                description="React to and comment on visible feed announcements and reply in own direct message conversations.",
            )
            boot_db.add(new_perm)
            await boot_db.commit()
            await boot_db.refresh(new_perm)
            created_interact_perm_id = new_perm.id

        perms_map = {
            p.code: p
            for p in (
                await boot_db.execute(
                    select(Permission).where(
                        Permission.code.in_(["feed.view", "feed.interact", "feed.create", "feed.manage"])
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
                name=f"fi_{short_name}_{tag}_{uuid.uuid4().hex[:4]}",
                code=f"FI{uuid.uuid4().hex[:7].upper()}",
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
    ) -> tuple[User, dict[str, str]]:
        async with SessionFactory() as s:
            sfx = uuid.uuid4().hex[:4]
            uname = f"fi_{short_key}_{tag}_{sfx}"
            u = User(
                first_name="FI",
                last_name=f"{short_key}_{sfx}",
                display_name=f"FI {short_key} {tag}",
                employee_code=f"FI-{short_key[:4].upper()}-{sfx.upper()}",
                has_login=True,
                username=uname,
                email=f"{uname}@inhyma-local.test",
                password_hash=pw_hash,
                employment_type=EmploymentType.FULL_TIME,
                employment_status=EmploymentStatus.ACTIVE,
                status=UserStatus.ACTIVE,
                is_active=True,
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

            resolved_perms = set(await RoleRepository(s).get_permission_codes_for_user(u.id))
            for d in denies or []:
                resolved_perms.discard(d)
                resolved_perms.add(f"deny:{d}")
            tok = create_access_token(u.id, permissions=sorted(resolved_perms)).token
            return u, {"Authorization": f"Bearer {tok}"}

    app = create_application()
    transport = ASGITransport(app=app, raise_app_exceptions=False)
    try:
        async with AsyncClient(transport=transport, base_url="http://testserver") as client:
            yield {
                "tag": tag,
                "client": client,
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
            if created_interact_perm_id is not None:
                await cdb.execute(delete(Permission).where(Permission.id == created_interact_perm_id))
            await cdb.commit()

        await engine.dispose()
        await engine_module.dispose_engine()
        object.__setattr__(settings, "DATABASE_URL", prev_db_url)


@pytest.mark.asyncio
async def test_feed_interact_multi_role_matrix_employee_manager_hr_admin_unauthorized(pg_feed_interact_env):
    """
    Comprehensive 5-role + deny precedence + privacy isolation matrix for `feed.interact`.
    """
    client: AsyncClient = pg_feed_interact_env["client"]
    tag = pg_feed_interact_env["tag"]
    sa_role = pg_feed_interact_env["super_admin_role"]

    dept_ops = await pg_feed_interact_env["make_department"]("ops")
    dept_sales = await pg_feed_interact_env["make_department"]("sales")

    # 1. Employee (natural seeded `user` permissions: feed.view + feed.interact, NO feed.create)
    u_emp, h_emp = await pg_feed_interact_env["make_user"](
        "emp", roles=[dept_ops], grants=["feed.view", "feed.interact"]
    )
    # 2. Peer Employee (same dept, also feed.view + feed.interact)
    u_peer, h_peer = await pg_feed_interact_env["make_user"](
        "peer", roles=[dept_ops], grants=["feed.view", "feed.interact"]
    )
    # 3. Manager (feed.view + feed.create — no explicit feed.interact needed, no feed.manage)
    u_mgr, h_mgr = await pg_feed_interact_env["make_user"](
        "mgr", roles=[dept_ops], grants=["feed.view", "feed.create"]
    )
    # 4. HR Moderator (feed.view + feed.create + feed.manage)
    u_hr, h_hr = await pg_feed_interact_env["make_user"](
        "hr", roles=[dept_sales], grants=["feed.view", "feed.create", "feed.manage"]
    )
    # 5. Super Admin (`*`)
    u_admin, h_admin = await pg_feed_interact_env["make_user"]("admin", roles=[sa_role])
    # 6. Super Admin with explicit `deny:feed.interact`
    _, h_admin_deny_interact = await pg_feed_interact_env["make_user"](
        "admdenyint", roles=[sa_role], denies=["feed.interact"]
    )
    # 7. Strictly read-only user (`feed.view` ONLY, without `feed.interact`)
    _, h_readonly = await pg_feed_interact_env["make_user"]("readonly", roles=[dept_ops], grants=["feed.view"])
    # 8. User with `feed.view` + `feed.create` + explicit `deny:feed.interact`
    _, h_deny_interact = await pg_feed_interact_env["make_user"](
        "denyint", roles=[dept_ops], grants=["feed.view", "feed.create"], denies=["feed.interact"]
    )
    # 9. Unauthorized users (no perms, and explicit `deny:feed.view`)
    _, h_none = await pg_feed_interact_env["make_user"]("none", roles=[dept_ops])
    _, h_deny_view = await pg_feed_interact_env["make_user"](
        "denyview", roles=[dept_ops], grants=["feed.interact"], denies=["feed.view"]
    )

    # Manager publishes an ALL announcement + HR publishes a confidential Sales-only announcement
    r_all = await client.post(
        "/api/v1/feed/posts",
        json={"title": f"Ops Townhall {tag}", "content": "Open to all staff", "audience_type": "ALL"},
        headers=h_mgr,
    )
    assert r_all.status_code == 201
    all_post_id = r_all.json()["data"]["id"]
    pg_feed_interact_env["created_post_ids"].append(uuid.UUID(all_post_id))

    r_sales = await client.post(
        "/api/v1/feed/posts",
        json={
            "title": f"Confidential Sales {tag}",
            "content": "Sales department eyes only",
            "audience_type": "SELECTED",
            "department_ids": [str(dept_sales.id)],
        },
        headers=h_hr,
    )
    assert r_sales.status_code == 201
    sales_post_id = r_sales.json()["data"]["id"]
    pg_feed_interact_env["created_post_ids"].append(uuid.UUID(sales_post_id))

    # --- A. EMPLOYEE (`feed.view` + `feed.interact`, NO `feed.create`) ---
    # Can react (3x retry consistency) and toggle off
    for _ in range(3):
        rx = await client.post(
            f"/api/v1/feed/posts/{all_post_id}/reactions",
            json={"reaction_type": "LIKE"},
            headers=h_emp,
        )
        assert rx.status_code == 200, rx.text
    rx_cel = await client.post(
        f"/api/v1/feed/posts/{all_post_id}/reactions",
        json={"reaction_type": "CELEBRATE"},
        headers=h_emp,
    )
    assert rx_cel.status_code == 200
    assert rx_cel.json()["data"]["user_reaction"] == "CELEBRATE"

    # Can comment, edit own comment, and delete own comment (with `can_delete == True`)
    r_c = await client.post(
        f"/api/v1/feed/posts/{all_post_id}/comments",
        json={"content": "Employee acknowledgment"},
        headers=h_emp,
    )
    assert r_c.status_code == 201, r_c.text
    emp_cmt_id = r_c.json()["data"]["id"]
    assert r_c.json()["data"]["can_delete"] is True

    r_ce = await client.patch(
        f"/api/v1/feed/posts/{all_post_id}/comments/{emp_cmt_id}",
        json={"content": "Employee acknowledgment (edited)"},
        headers=h_emp,
    )
    assert r_ce.status_code == 200
    assert r_ce.json()["data"]["content"] == "Employee acknowledgment (edited)"

    # Peer employee cannot edit or delete `u_emp`'s comment (`can_delete == False`, 403)
    r_peer_cmts = await client.get(f"/api/v1/feed/posts/{all_post_id}/comments", headers=h_peer)
    assert r_peer_cmts.status_code == 200
    assert r_peer_cmts.json()["data"]["items"][0]["can_delete"] is False
    assert (
        await client.patch(
            f"/api/v1/feed/posts/{all_post_id}/comments/{emp_cmt_id}",
            json={"content": "Hijack"},
            headers=h_peer,
        )
    ).status_code == 403
    assert (
        await client.delete(f"/api/v1/feed/posts/{all_post_id}/comments/{emp_cmt_id}", headers=h_peer)
    ).status_code == 403

    # Employee deletes own comment cleanly
    assert (
        await client.delete(f"/api/v1/feed/posts/{all_post_id}/comments/{emp_cmt_id}", headers=h_emp)
    ).status_code == 200

    # Employee STILL CANNOT publish/edit/delete broadcasts or enumerate directory or start unsolicited DMs
    assert (
        await client.post(
            "/api/v1/feed/posts",
            json={"title": "Unauth Broadcast", "content": "No!", "audience_type": "ALL"},
            headers=h_emp,
        )
    ).status_code == 403
    assert (
        await client.patch(f"/api/v1/feed/posts/{all_post_id}", json={"content": "Tamper"}, headers=h_emp)
    ).status_code == 403
    assert (await client.delete(f"/api/v1/feed/posts/{all_post_id}", headers=h_emp)).status_code == 403
    assert (await client.get("/api/v1/feed/recipients/eligible", headers=h_emp)).status_code == 403
    assert (await client.get("/api/v1/feed/departments/eligible", headers=h_emp)).status_code == 403
    assert (
        await client.post("/api/v1/feed/conversations", json={"recipient_id": str(u_peer.id)}, headers=h_emp)
    ).status_code == 403

    # Employee CANNOT view, like, or comment on confidential Sales-only post!
    assert (await client.get(f"/api/v1/feed/posts/{sales_post_id}", headers=h_emp)).status_code == 403
    assert (
        await client.post(
            f"/api/v1/feed/posts/{sales_post_id}/reactions",
            json={"reaction_type": "LIKE"},
            headers=h_emp,
        )
    ).status_code == 403
    assert (
        await client.post(
            f"/api/v1/feed/posts/{sales_post_id}/comments",
            json={"content": "Sneak comment"},
            headers=h_emp,
        )
    ).status_code == 403

    # --- B. 1:1 DIRECT MESSAGE REPLY & PRIVACY ---
    # Manager starts 1:1 DM with Employee and sends a message
    r_conv = await client.post(
        "/api/v1/feed/conversations",
        json={"recipient_id": str(u_emp.id)},
        headers=h_mgr,
    )
    assert r_conv.status_code == 201
    conv_id = r_conv.json()["data"]["id"]
    pg_feed_interact_env["created_conv_ids"].append(uuid.UUID(conv_id))

    r_m1 = await client.post(
        f"/api/v1/feed/conversations/{conv_id}/messages",
        json={"content": "Hi Rohan, please confirm shift handover."},
        headers=h_mgr,
    )
    assert r_m1.status_code == 201
    mgr_msg_id = r_m1.json()["data"]["id"]

    # Employee (`feed.view` + `feed.interact`) CAN reply, edit own reply, and delete own reply (3x retry check!)
    emp_msg_ids = []
    for i in range(3):
        r_rep = await client.post(
            f"/api/v1/feed/conversations/{conv_id}/messages",
            json={"content": f"Confirmed handover #{i + 1}"},
            headers=h_emp,
        )
        assert r_rep.status_code == 201, r_rep.text
        emp_msg_ids.append(r_rep.json()["data"]["id"])

    r_edit_m = await client.patch(
        f"/api/v1/feed/messages/{emp_msg_ids[0]}",
        json={"content": "Confirmed handover #1 (updated)"},
        headers=h_emp,
    )
    assert r_edit_m.status_code == 200
    assert (await client.delete(f"/api/v1/feed/messages/{emp_msg_ids[2]}", headers=h_emp)).status_code == 200

    # Employee CANNOT edit or delete Manager's message in the same conversation
    assert (
        await client.patch(
            f"/api/v1/feed/messages/{mgr_msg_id}", json={"content": "Tamper mgr"}, headers=h_emp
        )
    ).status_code == 403
    assert (await client.delete(f"/api/v1/feed/messages/{mgr_msg_id}", headers=h_emp)).status_code == 403

    # Private DM isolation: Peer Employee, HR Moderator, AND Super Admin are ALL blocked (403) from reading or replying!
    for label, hdr in [("peer", h_peer), ("hr", h_hr), ("admin", h_admin)]:
        assert (
            await client.get(f"/api/v1/feed/conversations/{conv_id}/messages", headers=hdr)
        ).status_code == 403, f"{label} should not read private DM"
        assert (
            await client.post(
                f"/api/v1/feed/conversations/{conv_id}/messages",
                json={"content": f"{label} intrusion"},
                headers=hdr,
            )
        ).status_code == 403, f"{label} should not post into private DM"

    # --- C. MANAGER, HR MODERATOR & ADMIN INTERACTION / MODERATION ---
    # Manager (feed.create without explicit feed.interact) can react & comment
    assert (
        await client.post(
            f"/api/v1/feed/posts/{all_post_id}/reactions",
            json={"reaction_type": "SUPPORT"},
            headers=h_mgr,
        )
    ).status_code == 200
    r_mgr_c = await client.post(
        f"/api/v1/feed/posts/{all_post_id}/comments",
        json={"content": "Manager follow-up"},
        headers=h_mgr,
    )
    assert r_mgr_c.status_code == 201
    mgr_cmt_id = r_mgr_c.json()["data"]["id"]

    # HR Moderator (`feed.manage`) can moderate/delete Manager's comment on visible ALL post
    assert (
        await client.delete(f"/api/v1/feed/posts/{all_post_id}/comments/{mgr_cmt_id}", headers=h_hr)
    ).status_code == 200
    # Admin (`super_admin`) can react on visible ALL post, STILL blocked 403 on untargeted Sales-only post!
    assert (
        await client.post(
            f"/api/v1/feed/posts/{all_post_id}/reactions",
            json={"reaction_type": "LIKE"},
            headers=h_admin,
        )
    ).status_code == 200
    assert (
        await client.post(
            f"/api/v1/feed/posts/{sales_post_id}/reactions",
            json={"reaction_type": "LIKE"},
            headers=h_admin,
        )
    ).status_code == 403

    # --- D. UNAUTHORIZED, STRICTLY READ-ONLY, AND EXPLICIT DENY PRECEDENCE ---
    # Strictly read-only (`feed.view` ONLY) -> can read 200, blocked 403 on react/comment/DM reply
    assert (await client.get(f"/api/v1/feed/posts/{all_post_id}", headers=h_readonly)).status_code == 200
    assert (
        await client.post(
            f"/api/v1/feed/posts/{all_post_id}/reactions",
            json={"reaction_type": "LIKE"},
            headers=h_readonly,
        )
    ).status_code == 403
    assert (
        await client.post(
            f"/api/v1/feed/posts/{all_post_id}/comments",
            json={"content": "Readonly blocked"},
            headers=h_readonly,
        )
    ).status_code == 403

    # Explicit `deny:feed.interact` blocks reactions & comments EVEN with `feed.create` or `super_admin`!
    for label, hdr in [("create+deny_interact", h_deny_interact), ("superadmin+deny_interact", h_admin_deny_interact)]:
        assert (await client.get(f"/api/v1/feed/posts/{all_post_id}", headers=hdr)).status_code == 200
        assert (
            await client.post(
                f"/api/v1/feed/posts/{all_post_id}/reactions",
                json={"reaction_type": "LIKE"},
                headers=hdr,
            )
        ).status_code == 403, f"{label} should be blocked from reacting"
        assert (
            await client.post(
                f"/api/v1/feed/posts/{all_post_id}/comments",
                json={"content": "Denied interact"},
                headers=hdr,
            )
        ).status_code == 403, f"{label} should be blocked from commenting"

    # Unauthenticated -> 401; No perms -> 403; `deny:feed.view` (even with `feed.interact`) -> 403
    assert (
        await client.post(
            f"/api/v1/feed/posts/{all_post_id}/reactions", json={"reaction_type": "LIKE"}
        )
    ).status_code == 401
    for hdr in (h_none, h_deny_view):
        assert (await client.get(f"/api/v1/feed/posts/{all_post_id}", headers=hdr)).status_code == 403
        assert (
            await client.post(
                f"/api/v1/feed/posts/{all_post_id}/reactions",
                json={"reaction_type": "LIKE"},
                headers=hdr,
            )
        ).status_code == 403
        assert (
            await client.post(
                f"/api/v1/feed/posts/{all_post_id}/comments",
                json={"content": "No access"},
                headers=hdr,
            )
        ).status_code == 403
