"""
RBAC & Security System Tests.

Tests permission hierarchy, multi-source permission inheritance,
Super Admin protections, user account status rules, and forced password change.
"""

from __future__ import annotations

import uuid
import pytest
from app.rbac.models import Permission, Role, UserPermission
from app.users.models import User, UserStatus
from app.auth.service import CurrentUser

pytestmark = pytest.mark.asyncio


async def test_permission_model_hierarchy():
    """Verify Permission model has module, page, action, scope fields."""
    perm = Permission(
        code="employee.view",
        module="employee",
        page="teams",
        action="view",
        scope="ALL",
        description="View employee records",
    )
    assert perm.code == "employee.view"
    assert perm.module == "employee"
    assert perm.page == "teams"
    assert perm.action == "view"
    assert perm.scope == "ALL"


async def test_current_user_must_change_password_flag():
    """Verify CurrentUser carries must_change_password flag."""
    user_id = uuid.uuid4()
    user = CurrentUser(
        id=user_id,
        username="testuser",
        permissions={"employee.view"},
        must_change_password=True,
    )
    assert user.must_change_password is True


async def test_user_account_status_can_login():
    """Verify User.can_login status restrictions."""
    user = User(
        username="active_user",
        email="active@example.com",
        password_hash="hash",
        status=UserStatus.ACTIVE,
        is_active=True,
    )
    assert user.can_login is True

    inactive_user = User(
        username="inactive_user",
        email="inactive@example.com",
        password_hash="hash",
        status=UserStatus.INACTIVE,
        is_active=False,
    )
    assert inactive_user.can_login is False

    suspended_user = User(
        username="suspended_user",
        email="suspended@example.com",
        password_hash="hash",
        status=UserStatus.SUSPENDED,
        is_active=False,
    )
    assert suspended_user.can_login is False

    locked_user = User(
        username="locked_user",
        email="locked@example.com",
        password_hash="hash",
        status=UserStatus.LOCKED,
        is_active=True,
    )
    assert locked_user.can_login is False

    pwd_change_user = User(
        username="pwd_change_user",
        email="pwdchange@example.com",
        password_hash="hash",
        status=UserStatus.PASSWORD_CHANGE_REQUIRED,
        is_active=True,
    )
    assert pwd_change_user.can_login is True


async def test_user_permission_override_model():
    """Verify UserPermission override fields."""
    user_id = uuid.uuid4()
    perm_id = uuid.uuid4()
    grant_override = UserPermission(user_id=user_id, permission_id=perm_id, is_granted=True)
    deny_override = UserPermission(user_id=user_id, permission_id=perm_id, is_granted=False)
    assert grant_override.is_granted is True
    assert deny_override.is_granted is False


async def test_effective_permissions_source_tracing():
    """Verify source resolution priority mapping (Role Permissions + User Overrides)."""
    user_grants = {"supplier.export"}
    user_denies = {"user.delete"}
    role_perms = {"user.read", "user.delete", "supplier.view"}

    effective = (role_perms | user_grants) - user_denies

    permission_sources = []
    for code in sorted(list(effective)):
        if code in user_grants:
            src = "Individual User"
        else:
            src = "System Role"
        permission_sources.append({"code": code, "source": src})

    sources_dict = {item["code"]: item["source"] for item in permission_sources}
    assert sources_dict["supplier.export"] == "Individual User"
    assert sources_dict["supplier.view"] == "System Role"
    assert sources_dict["user.read"] == "System Role"
    assert "user.delete" not in sources_dict


async def test_user_override_audit_actions():
    """Verify AuditAction enum contains USER_OVERRIDE_ADDED and USER_OVERRIDE_REMOVED."""
    from app.audit.constants import AuditAction
    assert AuditAction.USER_OVERRIDE_ADDED == "USER_OVERRIDE_ADDED"
    assert AuditAction.USER_OVERRIDE_REMOVED == "USER_OVERRIDE_REMOVED"


@pytest.mark.asyncio
async def test_set_user_permissions_bulk_service():
    """Verify bulk user permission overrides updates repository and invalidates cache."""
    from unittest.mock import AsyncMock, MagicMock
    from app.rbac.service import RBACService

    user_id = uuid.uuid4()
    p1 = uuid.uuid4()
    p2 = uuid.uuid4()

    mock_perm_repo = AsyncMock()
    mock_perm_repo.get_by_id.return_value = MagicMock(id=p1)
    mock_user_perm_repo = AsyncMock()

    service = RBACService(
        role_repository=AsyncMock(),
        permission_repository=mock_perm_repo,
        user_permission_repository=mock_user_perm_repo,
        user_role_repository=AsyncMock(),
    )

    count = await service.set_user_permissions_bulk(
        user_id,
        overrides=[(p1, True), (p2, False)],
        granted_by=uuid.uuid4(),
    )

    assert count == 2
    mock_user_perm_repo.set_user_permissions_bulk.assert_awaited_once()


@pytest.mark.asyncio
async def test_role_deletion_impact_and_reassignment():
    """Verify get_role_deletion_impact lists assigned users and delete_role reassigns them."""
    from unittest.mock import AsyncMock, MagicMock
    from app.rbac.service import RBACService
    from app.core.exceptions import ConflictException, ForbiddenException

    role_id = uuid.uuid4()
    target_role_id = uuid.uuid4()
    user_id = uuid.uuid4()

    mock_role_repo = AsyncMock()
    mock_perm_repo = AsyncMock()
    mock_user_perm_repo = AsyncMock()
    mock_user_role_repo = AsyncMock()

    custom_role = Role(name="Editor", is_system=False)
    custom_role.id = role_id
    target_role = Role(name="user", is_system=False)
    target_role.id = target_role_id
    system_role = Role(name="super_admin", is_system=True)
    system_role.id = role_id

    mock_user = MagicMock()
    mock_user.id = user_id
    mock_user.username = "alice"
    mock_user.display_name = "Alice W"
    mock_user.full_name = "Alice Wonderland"
    mock_link = MagicMock(user_id=user_id, role_id=role_id, user=mock_user, assigned_at=None)

    service = RBACService(
        role_repository=mock_role_repo,
        permission_repository=mock_perm_repo,
        user_permission_repository=mock_user_perm_repo,
        user_role_repository=mock_user_role_repo,
    )

    # 1. Test get_role_deletion_impact with assigned user
    mock_role_repo.get_by_id.return_value = custom_role
    mock_user_role_repo.list_for_role.return_value = [mock_link]

    impact = await service.get_role_deletion_impact(role_id)
    assert impact["role_id"] == str(role_id)
    assert impact["role_name"] == "Editor"
    assert impact["affected_user_count"] == 1
    assert impact["affected_users"][0]["username"] == "alice"

    # 2. Test delete_role fails if users attached and no reassignment target provided
    with pytest.raises(ConflictException, match="user\\(s\\) are still assigned"):
        await service.delete_role(role_id)

    # 3. Test delete_role succeeds with reassignment
    mock_role_repo.get_by_id.side_effect = lambda rid: custom_role if rid == role_id else target_role
    mock_user_role_repo.get.return_value = None  # user doesn't already have target role

    reassigned = await service.delete_role(role_id, reassign_to_role_id=target_role_id)
    assert reassigned == 1
    mock_user_role_repo.create.assert_awaited_once()
    mock_user_role_repo.delete.assert_awaited_once_with(mock_link)
    mock_role_repo.delete.assert_awaited_once_with(custom_role)

    # 4. Test delete_role on system role raises ForbiddenException
    mock_role_repo.get_by_id.side_effect = None
    mock_role_repo.get_by_id.return_value = system_role
    with pytest.raises(ForbiddenException, match="System roles cannot be deleted"):
        await service.delete_role(role_id)


async def test_technician_system_department_reserved_and_lookup():
    """Verify 'technician' is a reserved system department and lists active members cleanly."""
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
    from sqlalchemy.pool import StaticPool
    from app.database.base import Base
    from app.rbac.models import DepartmentHierarchy, RolePermission, UserRole
    from app.rbac.repository import PermissionRepository, RoleRepository, UserRoleRepository
    from app.rbac.service import RESERVED_ROLE_NAMES, RBACService
    from app.core.exceptions import ConflictException, ForbiddenException

    assert "technician" in RESERVED_ROLE_NAMES

    engine = create_async_engine(
        "sqlite+aiosqlite://",
        poolclass=StaticPool,
        connect_args={"check_same_thread": False},
    )
    async with engine.begin() as conn:
        await conn.run_sync(
            lambda c: Base.metadata.create_all(
                c,
                tables=[
                    User.__table__,
                    Permission.__table__,
                    Role.__table__,
                    DepartmentHierarchy.__table__,
                    RolePermission.__table__,
                    UserRole.__table__,
                ],
            )
        )

    maker = async_sessionmaker(engine, expire_on_commit=False)
    async with maker() as s:
        tech_role = Role(name="technician", description="Technician Dept", is_system=True)
        other_role = Role(name="sales", description="Sales", is_system=False)
        active_tech = User(
            username="ravi.tech",
            email="ravi@example.com",
            password_hash="x",
            first_name="Ravi",
            last_name="Patel",
            display_name="Ravi Patel",
            phone="9876543210",
            city="Indore",
            is_active=True,
            status=UserStatus.ACTIVE,
        )
        inactive_tech = User(
            username="old.tech",
            email="old@example.com",
            password_hash="x",
            first_name="Old",
            last_name="Tech",
            display_name="Old Tech",
            phone="9000000000",
            is_active=False,
            status=UserStatus.INACTIVE,
        )
        sales_user = User(
            username="sales.rep",
            email="sales@example.com",
            password_hash="x",
            first_name="Sales",
            last_name="Rep",
            display_name="Sales Rep",
            is_active=True,
            status=UserStatus.ACTIVE,
        )
        s.add_all([tech_role, other_role, active_tech, inactive_tech, sales_user])
        await s.flush()
        s.add_all([
            UserRole(user_id=active_tech.id, role_id=tech_role.id),
            UserRole(user_id=inactive_tech.id, role_id=tech_role.id),
            UserRole(user_id=sales_user.id, role_id=other_role.id),
        ])
        await s.commit()

        service = RBACService(
            role_repository=RoleRepository(s),
            permission_repository=PermissionRepository(s),
            user_role_repository=UserRoleRepository(s),
        )
        with pytest.raises(ConflictException, match="reserved"):
            await service.create_role(name="Technician", description="", permission_codes=[])
        with pytest.raises(ForbiddenException, match="System roles cannot be deleted"):
            await service.delete_role(tech_role.id)

        rows = await service.list_active_technician_users()
        assert len(rows) == 1
        assert rows[0]["name"] == "Ravi Patel"
        assert rows[0]["mobile"] == "9876543210"
        assert rows[0]["city"] == "Indore"
    await engine.dispose()


async def test_role_permissions_bulk_endpoint_and_guards():
    """Verify PUT /api/v1/rbac/roles/{role_id}/permissions/bulk atomically replaces permissions and preserves RBAC guards."""
    from httpx import ASGITransport, AsyncClient
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
    from app.audit.dependencies import get_audit_service
    from app.audit.models import AuditLog
    from app.auth.dependencies import get_current_user
    from app.cache.dependency import get_cache_manager
    from app.database.base import Base
    from app.database.session import get_db_session
    from app.main import create_application
    from app.rbac.models import DepartmentHierarchy, Permission, Role, RolePermission, UserPermission, UserRole

    class _NoAudit:
        async def record(self, *args, **kwargs):
            return None

    class _NoCache:
        async def delete_pattern(self, *args, **kwargs):
            return 0

        async def delete(self, *args, **kwargs):
            return 0

    engine = create_async_engine("sqlite+aiosqlite:///:memory:", connect_args={"check_same_thread": False})
    async with engine.begin() as conn:
        await conn.run_sync(
            lambda c: Base.metadata.create_all(
                c,
                tables=[
                    User.__table__,
                    Permission.__table__,
                    Role.__table__,
                    DepartmentHierarchy.__table__,
                    RolePermission.__table__,
                    UserRole.__table__,
                    UserPermission.__table__,
                    AuditLog.__table__,
                ],
            )
        )

    maker = async_sessionmaker(engine, expire_on_commit=False)
    async with maker() as s:
        p1 = Permission(code="company.view", module="company", page="companies", action="view", scope="ALL", description="View companies")
        p2 = Permission(code="company.create", module="company", page="companies", action="create", scope="ALL", description="Create companies")
        p3 = Permission(code="company.export", module="company", page="companies", action="export", scope="ALL", description="Export companies")
        custom_role = Role(name="Test Dept", description="Test department", is_system=False)
        super_role = Role(name="super_admin", description="Admin", is_system=True)
        actor = User(username="rbac_mgr", email="mgr@example.com", password_hash="x", is_active=True, status=UserStatus.ACTIVE)
        s.add_all([p1, p2, p3, custom_role, super_role, actor])
        await s.flush()
        s.add(RolePermission(role_id=custom_role.id, permission_id=p1.id))
        await s.commit()

        active_perms: set[str] = set()
        app = create_application()

        async def _db():
            async with maker() as req_session:
                try:
                    yield req_session
                    await req_session.commit()
                except Exception:
                    await req_session.rollback()
                    raise

        app.dependency_overrides[get_db_session] = _db
        app.dependency_overrides[get_current_user] = lambda: CurrentUser(
            id=actor.id, username="rbac_mgr", permissions=set(active_perms)
        )
        app.dependency_overrides[get_audit_service] = lambda: _NoAudit()
        app.dependency_overrides[get_cache_manager] = lambda: _NoCache()

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as ac:
            # Missing roles_permissions.action -> 403
            active_perms.update({"roles_permissions.view"})
            assert (
                await ac.put(
                    f"/api/v1/rbac/roles/{custom_role.id}/permissions/bulk",
                    json={"permission_ids": [str(p2.id)]},
                )
            ).status_code == 403

            # With roles_permissions.action -> atomically replaces [p1] with [p2, p3]
            active_perms.update({"roles_permissions.action"})
            res = await ac.put(
                f"/api/v1/rbac/roles/{custom_role.id}/permissions/bulk",
                json={"permission_ids": [str(p2.id), str(p3.id)]},
            )
            assert res.status_code == 200
            assert res.json()["data"]["count"] == 2

            role_res = await ac.get(f"/api/v1/rbac/roles/{custom_role.id}")
            assert role_res.status_code == 200
            assert set(role_res.json()["data"]["permissions"]) == {"company.create", "company.export"}

            # Non-super_admin cannot bulk-modify super_admin permissions
            assert (
                await ac.put(
                    f"/api/v1/rbac/roles/{super_role.id}/permissions/bulk",
                    json={"permission_ids": [str(p1.id)]},
                )
            ).status_code == 403

    await engine.dispose()


async def test_zero_permission_db_user_never_resurrects_stale_jwt_claims():
    """Verify verify_access_token never restores stale JWT permissions or admin access when DB effective permissions are 0."""
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
    from app.auth.models import Session as AuthSession, TokenBlacklist
    from app.auth.repository import PasswordHistoryRepository, SessionRepository, TokenBlacklistRepository
    from app.auth.security import create_access_token
    from app.auth.service import AuthService
    from app.cache.in_memory import InMemoryCacheBackend
    from app.database.base import Base
    from app.rbac.models import DepartmentHierarchy, Permission, Role, RolePermission, UserPermission, UserRole
    from app.rbac.repository import RoleRepository
    from app.users.repository import UserRepository

    engine = create_async_engine("sqlite+aiosqlite:///:memory:", connect_args={"check_same_thread": False})
    async with engine.begin() as conn:
        await conn.run_sync(
            lambda c: Base.metadata.create_all(
                c,
                tables=[
                    User.__table__,
                    AuthSession.__table__,
                    TokenBlacklist.__table__,
                    Permission.__table__,
                    Role.__table__,
                    DepartmentHierarchy.__table__,
                    RolePermission.__table__,
                    UserRole.__table__,
                    UserPermission.__table__,
                ],
            )
        )

    maker = async_sessionmaker(engine, expire_on_commit=False)
    async with maker() as s:
        empty_dept = Role(name="Test", description="No perms", is_system=False)
        user_a = User(
            username="usera",
            email="usera@gmail.com",
            password_hash="x",
            is_active=True,
            status=UserStatus.ACTIVE,
        )
        s.add_all([empty_dept, user_a])
        await s.flush()
        s.add(UserRole(user_id=user_a.id, role_id=empty_dept.id))
        await s.commit()

        # Stale JWT still carries revoked company.view and "*" from an old login
        stale_jwt = create_access_token(user_a.id, permissions=["company.view", "*"]).token

        auth_service = AuthService(
            user_repository=UserRepository(s),
            role_repository=RoleRepository(s),
            session_repository=SessionRepository(s),
            token_blacklist_repository=TokenBlacklistRepository(s),
            password_history_repository=PasswordHistoryRepository(s),
            cache=InMemoryCacheBackend(),
        )
        resolved = await auth_service.verify_access_token(stale_jwt)
        assert resolved.is_super_admin is False
        assert resolved.permissions == set()

    await engine.dispose()


@pytest.mark.asyncio
async def test_interface_error_returns_503_and_grant_permission_idempotent_and_audit_isolated():
    """Verify DB InterfaceError maps to 503, add_permission is idempotent, and failed audit flush never poisons session."""
    from fastapi import FastAPI
    from httpx import ASGITransport, AsyncClient
    from sqlalchemy.exc import InterfaceError
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
    from sqlalchemy.pool import StaticPool
    from unittest.mock import AsyncMock

    from app.audit.constants import AuditAction
    from app.audit.repository import AuditRepository
    from app.audit.service import AuditService
    from app.core.exception_handlers import register_exception_handlers
    from app.database.base import Base
    from app.rbac.models import DepartmentHierarchy, Permission, Role, RolePermission
    from app.rbac.repository import RoleRepository

    # 1. InterfaceError maps to 503 Service Unavailable (not raw 500)
    mini_app = FastAPI()
    register_exception_handlers(mini_app)

    @mini_app.get("/boom-interface")
    async def _boom_interface():
        raise InterfaceError("SELECT 1", {}, Exception("connection is closed"))

    async with AsyncClient(transport=ASGITransport(app=mini_app), base_url="http://test") as ac:
        res = await ac.get("/boom-interface")
        assert res.status_code == 503
        assert res.json()["errors"][0]["code"] == "SERVICE_UNAVAILABLE"

    # 2. RoleRepository.add_permission is idempotent and AuditService failure is isolated by savepoint
    engine = create_async_engine(
        "sqlite+aiosqlite://",
        poolclass=StaticPool,
        connect_args={"check_same_thread": False},
    )
    async with engine.begin() as conn:
        await conn.run_sync(
            lambda c: Base.metadata.create_all(
                c,
                tables=[
                    Permission.__table__,
                    Role.__table__,
                    DepartmentHierarchy.__table__,
                    RolePermission.__table__,
                ],
            )
        )

    maker = async_sessionmaker(engine, expire_on_commit=False)
    async with maker() as s:
        role = Role(name="ResilientDept", is_system=False)
        perm = Permission(code="company.create", module="company", page="companies", action="create")
        s.add_all([role, perm])
        await s.flush()

        role_repo = RoleRepository(s)
        link1 = await role_repo.add_permission(role, perm)
        link2 = await role_repo.add_permission(role, perm)
        assert link1.id == link2.id

        audit_repo = AuditRepository(s)
        audit_repo.create = AsyncMock(side_effect=RuntimeError("audit write failed"))  # type: ignore[method-assign]
        audit_service = AuditService(audit_repo)
        recorded = await audit_service.record(
            action=AuditAction.PERMISSION_ASSIGNED,
            module="rbac",
            entity_type="Role",
            entity_id=str(role.id),
        )
        assert recorded is None
        # Session remains healthy and committable after swallowed audit failure
        await s.commit()

    await engine.dispose()







