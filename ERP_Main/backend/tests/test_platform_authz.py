"""
Platform Authorization Tests.

Covers Phase 5 Sections 49-51: role/permission CRUD, assignment
(including expired/inactive), scope (global/ERP/wrong-ERP/missing),
authorization allow/deny, privilege escalation protection, and
cross-ERP isolation (a grant scoped to one ERP must never authorize
an equivalent operation on a different ERP).

Uses `super_admin_client` (a PlatformAdmin) to perform administrative
setup -- creating roles/permissions/assignments -- since PlatformAdmin
always satisfies `require_platform_permission` (backward compatibility,
see `app.platform_authz.dependencies`'s own docstring). The actual
GlobalUser-based authorization checks are exercised by minting a real
Global User session and testing what IT can/cannot do.
"""

from __future__ import annotations

import uuid

import pytest

pytestmark = pytest.mark.asyncio


async def _create_role(admin_client, *, role_key: str, permission_keys: list[str]):
    """Create a role and grant it the given permissions (creating each permission if needed). Returns role dict."""
    role_resp = await admin_client.post(
        "/api/v1/global/authz/roles",
        json={"role_key": role_key, "display_name": role_key.title(), "description": "test role"},
    )
    assert role_resp.status_code == 201, role_resp.text
    role = role_resp.json()["data"]

    for permission_key in permission_keys:
        await admin_client.post(
            "/api/v1/global/authz/permissions", json={"permission_key": permission_key, "description": "test"}
        )
        grant_resp = await admin_client.post(
            f"/api/v1/global/authz/roles/{role['id']}/permissions", json={"permission_key": permission_key}
        )
        assert grant_resp.status_code == 200, grant_resp.text

    role_resp = await admin_client.get(f"/api/v1/global/authz/roles/{role['id']}")
    return role_resp.json()["data"]


async def _register_global_user_and_login(client, *, email: str, password: str = "Str0ngPassw0rd!123"):
    """Self-register a Global User and log in. Returns (global_user_id, access_token)."""
    register_resp = await client.post(
        "/api/v1/global/user-auth/register",
        json={"display_name": "Test User", "email": email, "password": password},
    )
    assert register_resp.status_code == 201, register_resp.text
    user_id = register_resp.json()["data"]["id"]
    login_resp = await client.post(
        "/api/v1/global/user-auth/login", json={"email": email, "password": password}
    )
    assert login_resp.status_code == 200, login_resp.text
    return user_id, login_resp.json()["data"]["access_token"]


async def _create_erp(admin_client, *, key: str):
    """Register an ACTIVE ERP. Returns its id."""
    resp = await admin_client.post(
        "/api/v1/global/erps",
        json={"key": key, "name": key, "display_name": key, "status": "ACTIVE"},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["data"]["id"]


# --------------------------------------------------------------------
# Role CRUD
# --------------------------------------------------------------------


async def test_create_role(super_admin_client):
    """POST /roles creates a new platform role."""
    role = await _create_role(super_admin_client, role_key="TEST_ROLE_1", permission_keys=[])
    assert role["role_key"] == "TEST_ROLE_1"
    assert role["is_active"] is True
    assert role["permission_keys"] == []


async def test_duplicate_role_key_rejected(super_admin_client):
    """Creating a role with an already-used role_key returns 409."""
    await _create_role(super_admin_client, role_key="TEST_ROLE_DUP", permission_keys=[])
    resp = await super_admin_client.post(
        "/api/v1/global/authz/roles",
        json={"role_key": "TEST_ROLE_DUP", "display_name": "Dup", "description": None},
    )
    assert resp.status_code == 409


async def test_role_key_must_be_uppercase(super_admin_client):
    """A lowercase role_key is rejected by the model's own validator."""
    resp = await super_admin_client.post(
        "/api/v1/global/authz/roles",
        json={"role_key": "lowercase_role", "display_name": "Bad", "description": None},
    )
    assert resp.status_code >= 400


async def test_update_role_deactivate(super_admin_client):
    """PATCH /roles/{id} can deactivate a role."""
    role = await _create_role(super_admin_client, role_key="TEST_ROLE_DEACTIVATE", permission_keys=[])
    resp = await super_admin_client.patch(f"/api/v1/global/authz/roles/{role['id']}", json={"is_active": False})
    assert resp.status_code == 200
    assert resp.json()["data"]["is_active"] is False


# --------------------------------------------------------------------
# Permission CRUD
# --------------------------------------------------------------------


async def test_create_permission(super_admin_client):
    """POST /permissions defines a new permission."""
    resp = await super_admin_client.post(
        "/api/v1/global/authz/permissions", json={"permission_key": "platform.test.read", "description": "d"}
    )
    assert resp.status_code == 201
    assert resp.json()["data"]["permission_key"] == "platform.test.read"


async def test_duplicate_permission_key_rejected(super_admin_client):
    """Creating a permission with an already-used key returns 409."""
    await super_admin_client.post(
        "/api/v1/global/authz/permissions", json={"permission_key": "platform.test.dup", "description": None}
    )
    resp = await super_admin_client.post(
        "/api/v1/global/authz/permissions", json={"permission_key": "platform.test.dup", "description": None}
    )
    assert resp.status_code == 409


async def test_permission_key_must_be_lowercase_dotted(super_admin_client):
    """An uppercase or malformed permission_key is rejected."""
    resp = await super_admin_client.post(
        "/api/v1/global/authz/permissions", json={"permission_key": "PLATFORM.BAD", "description": None}
    )
    assert resp.status_code >= 400


async def test_grant_permission_to_role_idempotent(super_admin_client):
    """Granting the same permission to a role twice succeeds both times without duplicating the grant."""
    role = await _create_role(
        super_admin_client, role_key="TEST_ROLE_IDEMPOTENT", permission_keys=["platform.test.idempotent"]
    )
    role_id = role["id"]
    resp = await super_admin_client.post(
        f"/api/v1/global/authz/roles/{role_id}/permissions", json={"permission_key": "platform.test.idempotent"}
    )
    assert resp.status_code == 200
    assert resp.json()["data"]["permission_keys"].count("platform.test.idempotent") == 1


# --------------------------------------------------------------------
# Assignment: create / list / revoke, scope validation
# --------------------------------------------------------------------


async def test_assign_global_scope_role(super_admin_client, client):
    """Assigning a GLOBAL-scoped role succeeds and is reflected in effective permissions."""
    await _create_role(super_admin_client, role_key="TEST_GLOBAL_ROLE", permission_keys=["platform.test.global1"])
    user_id, _token = await _register_global_user_and_login(client, email="assign1@example.com")

    resp = await super_admin_client.post(
        f"/api/v1/global/authz/users/{user_id}/roles",
        json={"role_key": "TEST_GLOBAL_ROLE", "scope": "GLOBAL"},
    )
    assert resp.status_code == 201, resp.text
    assert resp.json()["data"]["scope"] == "GLOBAL"

    perms_resp = await super_admin_client.get(f"/api/v1/global/authz/users/{user_id}/effective-permissions")
    assert "platform.test.global1" in perms_resp.json()["data"]["global_permissions"]


async def test_erp_scope_requires_erp_instance_id(super_admin_client, client):
    """scope=ERP without erp_instance_id is rejected (schema-level validation)."""
    await _create_role(super_admin_client, role_key="TEST_ERP_ROLE_NO_ID", permission_keys=[])
    user_id, _token = await _register_global_user_and_login(client, email="assign2@example.com")

    resp = await super_admin_client.post(
        f"/api/v1/global/authz/users/{user_id}/roles",
        json={"role_key": "TEST_ERP_ROLE_NO_ID", "scope": "ERP"},
    )
    assert resp.status_code == 422


async def test_global_scope_forbids_erp_instance_id(super_admin_client, client):
    """scope=GLOBAL with erp_instance_id set is rejected (schema-level validation)."""
    await _create_role(super_admin_client, role_key="TEST_GLOBAL_ROLE_WITH_ID", permission_keys=[])
    user_id, _token = await _register_global_user_and_login(client, email="assign3@example.com")
    erp_id = await _create_erp(super_admin_client, key="scope_test_erp")

    resp = await super_admin_client.post(
        f"/api/v1/global/authz/users/{user_id}/roles",
        json={"role_key": "TEST_GLOBAL_ROLE_WITH_ID", "scope": "GLOBAL", "erp_instance_id": erp_id},
    )
    assert resp.status_code == 422


async def test_erp_scoped_assignment_only_grants_for_that_erp(super_admin_client, client):
    """An ERP-scoped assignment grants the permission only for that ERP, not globally, not for another ERP."""
    await _create_role(super_admin_client, role_key="TEST_ERP_SCOPED", permission_keys=["platform.test.erpscoped"])
    user_id, _token = await _register_global_user_and_login(client, email="assign4@example.com")
    erp_a = await _create_erp(super_admin_client, key="erp_scoped_a")
    erp_b = await _create_erp(super_admin_client, key="erp_scoped_b")

    resp = await super_admin_client.post(
        f"/api/v1/global/authz/users/{user_id}/roles",
        json={"role_key": "TEST_ERP_SCOPED", "scope": "ERP", "erp_instance_id": erp_a},
    )
    assert resp.status_code == 201, resp.text

    perms_resp = await super_admin_client.get(f"/api/v1/global/authz/users/{user_id}/effective-permissions")
    data = perms_resp.json()["data"]
    assert "platform.test.erpscoped" not in data["global_permissions"]
    assert "platform.test.erpscoped" in data["erp_permissions"].get(erp_a, [])
    assert "platform.test.erpscoped" not in data["erp_permissions"].get(erp_b, [])


async def test_revoke_assignment(super_admin_client, client):
    """Revoking an assignment removes its permissions from the effective-permissions computation."""
    await _create_role(super_admin_client, role_key="TEST_REVOKE_ROLE", permission_keys=["platform.test.revoke"])
    user_id, _token = await _register_global_user_and_login(client, email="revoke1@example.com")

    assign_resp = await super_admin_client.post(
        f"/api/v1/global/authz/users/{user_id}/roles", json={"role_key": "TEST_REVOKE_ROLE", "scope": "GLOBAL"}
    )
    assignment_id = assign_resp.json()["data"]["id"]

    before = await super_admin_client.get(f"/api/v1/global/authz/users/{user_id}/effective-permissions")
    assert "platform.test.revoke" in before.json()["data"]["global_permissions"]

    revoke_resp = await super_admin_client.post(f"/api/v1/global/authz/assignments/{assignment_id}/revoke")
    assert revoke_resp.status_code == 200
    assert revoke_resp.json()["data"]["is_active"] is False

    after = await super_admin_client.get(f"/api/v1/global/authz/users/{user_id}/effective-permissions")
    assert "platform.test.revoke" not in after.json()["data"]["global_permissions"]


async def test_duplicate_active_assignment_rejected(super_admin_client, client):
    """Assigning the identical (user, role, scope) a second time while still active returns 409."""
    await _create_role(super_admin_client, role_key="TEST_DUP_ASSIGN", permission_keys=[])
    user_id, _token = await _register_global_user_and_login(client, email="dupassign1@example.com")

    first = await super_admin_client.post(
        f"/api/v1/global/authz/users/{user_id}/roles", json={"role_key": "TEST_DUP_ASSIGN", "scope": "GLOBAL"}
    )
    assert first.status_code == 201
    second = await super_admin_client.post(
        f"/api/v1/global/authz/users/{user_id}/roles", json={"role_key": "TEST_DUP_ASSIGN", "scope": "GLOBAL"}
    )
    assert second.status_code == 409


async def test_reassign_after_revoke_reactivates(super_admin_client, client):
    """Assigning again after a revoke re-activates the same row rather than erroring."""
    await _create_role(super_admin_client, role_key="TEST_REASSIGN", permission_keys=["platform.test.reassign"])
    user_id, _token = await _register_global_user_and_login(client, email="reassign1@example.com")

    first = await super_admin_client.post(
        f"/api/v1/global/authz/users/{user_id}/roles", json={"role_key": "TEST_REASSIGN", "scope": "GLOBAL"}
    )
    assignment_id = first.json()["data"]["id"]
    await super_admin_client.post(f"/api/v1/global/authz/assignments/{assignment_id}/revoke")

    reassign = await super_admin_client.post(
        f"/api/v1/global/authz/users/{user_id}/roles", json={"role_key": "TEST_REASSIGN", "scope": "GLOBAL"}
    )
    assert reassign.status_code == 201
    assert reassign.json()["data"]["is_active"] is True

    perms = await super_admin_client.get(f"/api/v1/global/authz/users/{user_id}/effective-permissions")
    assert "platform.test.reassign" in perms.json()["data"]["global_permissions"]


async def test_assign_nonexistent_role_rejected(super_admin_client, client):
    """Assigning a role_key that doesn't exist returns 404."""
    user_id, _token = await _register_global_user_and_login(client, email="norole1@example.com")
    resp = await super_admin_client.post(
        f"/api/v1/global/authz/users/{user_id}/roles", json={"role_key": "NO_SUCH_ROLE", "scope": "GLOBAL"}
    )
    assert resp.status_code == 404


async def test_assign_inactive_role_rejected(super_admin_client, client):
    """Assigning a role that has been deactivated is rejected."""
    role = await _create_role(super_admin_client, role_key="TEST_INACTIVE_ASSIGN", permission_keys=[])
    await super_admin_client.patch(f"/api/v1/global/authz/roles/{role['id']}", json={"is_active": False})
    user_id, _token = await _register_global_user_and_login(client, email="inactive1@example.com")

    resp = await super_admin_client.post(
        f"/api/v1/global/authz/users/{user_id}/roles", json={"role_key": "TEST_INACTIVE_ASSIGN", "scope": "GLOBAL"}
    )
    assert resp.status_code == 403


async def test_deactivating_role_voids_existing_assignments(super_admin_client, client):
    """Deactivating a role instantly removes its permissions from every holder's effective permissions."""
    role = await _create_role(
        super_admin_client, role_key="TEST_VOID_ON_DEACTIVATE", permission_keys=["platform.test.void"]
    )
    user_id, _token = await _register_global_user_and_login(client, email="voidtest1@example.com")
    await super_admin_client.post(
        f"/api/v1/global/authz/users/{user_id}/roles",
        json={"role_key": "TEST_VOID_ON_DEACTIVATE", "scope": "GLOBAL"},
    )

    before = await super_admin_client.get(f"/api/v1/global/authz/users/{user_id}/effective-permissions")
    assert "platform.test.void" in before.json()["data"]["global_permissions"]

    await super_admin_client.patch(f"/api/v1/global/authz/roles/{role['id']}", json={"is_active": False})

    after = await super_admin_client.get(f"/api/v1/global/authz/users/{user_id}/effective-permissions")
    assert "platform.test.void" not in after.json()["data"]["global_permissions"]


async def test_expired_assignment_excluded_from_effective_permissions(super_admin_client, client):
    """An assignment with expires_at in the past is excluded from effective permissions."""
    await _create_role(super_admin_client, role_key="TEST_EXPIRED", permission_keys=["platform.test.expired"])
    user_id, _token = await _register_global_user_and_login(client, email="expired1@example.com")

    resp = await super_admin_client.post(
        f"/api/v1/global/authz/users/{user_id}/roles",
        json={"role_key": "TEST_EXPIRED", "scope": "GLOBAL", "expires_at": "2020-01-01T00:00:00Z"},
    )
    assert resp.status_code == 201, resp.text

    perms = await super_admin_client.get(f"/api/v1/global/authz/users/{user_id}/effective-permissions")
    assert "platform.test.expired" not in perms.json()["data"]["global_permissions"]


# --------------------------------------------------------------------
# Authorization allow/deny via a real GlobalUser session
# --------------------------------------------------------------------


async def test_global_user_without_permission_denied(client):
    """A GlobalUser with no relevant role assignment is denied access to a platform_authz admin route."""
    _user_id, token = await _register_global_user_and_login(client, email="noperm1@example.com")
    client.headers["Authorization"] = f"Bearer {token}"
    resp = await client.get("/api/v1/global/authz/roles")
    assert resp.status_code == 403


async def test_global_user_with_permission_allowed(super_admin_client, client):
    """A GlobalUser holding platform.system.manage globally CAN reach a platform_authz admin route."""
    await _create_role(super_admin_client, role_key="TEST_MANAGER", permission_keys=["platform.system.manage"])
    user_id, token = await _register_global_user_and_login(client, email="hasperm1@example.com")
    await super_admin_client.post(
        f"/api/v1/global/authz/users/{user_id}/roles", json={"role_key": "TEST_MANAGER", "scope": "GLOBAL"}
    )

    client.headers["Authorization"] = f"Bearer {token}"
    resp = await client.get("/api/v1/global/authz/roles")
    assert resp.status_code == 200


async def test_unauthenticated_request_rejected(client):
    """A request with no credentials at all is rejected (401/403), never silently allowed."""
    resp = await client.get("/api/v1/global/authz/roles")
    assert resp.status_code in (401, 403)


# --------------------------------------------------------------------
# Privilege escalation protection (Section 18/50)
# --------------------------------------------------------------------


async def test_viewer_cannot_manage_roles(super_admin_client, client):
    """A GlobalUser holding an unrelated, low-privilege permission cannot manage roles."""
    await _create_role(super_admin_client, role_key="TEST_VIEWER_ONLY", permission_keys=["platform.audit.read"])
    user_id, token = await _register_global_user_and_login(client, email="viewer1@example.com")
    await super_admin_client.post(
        f"/api/v1/global/authz/users/{user_id}/roles", json={"role_key": "TEST_VIEWER_ONLY", "scope": "GLOBAL"}
    )

    client.headers["Authorization"] = f"Bearer {token}"
    resp = await client.post(
        "/api/v1/global/authz/roles", json={"role_key": "SELF_PROMOTED", "display_name": "x", "description": None}
    )
    assert resp.status_code == 403


async def test_erp_scoped_admin_cannot_manage_platform_wide(super_admin_client, client):
    """A role granted only for ERP A cannot be used to manage platform-wide (global-scope) resources."""
    await _create_role(super_admin_client, role_key="TEST_ERP_ADMIN_ONLY", permission_keys=["platform.system.manage"])
    user_id, token = await _register_global_user_and_login(client, email="erpadmin1@example.com")
    erp_a = await _create_erp(super_admin_client, key="escalation_erp_a")

    await super_admin_client.post(
        f"/api/v1/global/authz/users/{user_id}/roles",
        json={"role_key": "TEST_ERP_ADMIN_ONLY", "scope": "ERP", "erp_instance_id": erp_a},
    )

    # Role management here is a GLOBAL operation with no ERP context in
    # its path, so an ERP-scoped grant must NOT satisfy it -- only a
    # GLOBAL-scoped grant (or PlatformAdmin) should.
    client.headers["Authorization"] = f"Bearer {token}"
    resp = await client.get("/api/v1/global/authz/roles")
    assert resp.status_code == 403


# --------------------------------------------------------------------
# Cross-ERP isolation (Section 28/51) -- mandatory
# --------------------------------------------------------------------


async def test_erp_scoped_grant_does_not_authorize_other_erp(super_admin_client, client):
    """A permission scoped to one ERP must not be usable for a different ERP's equivalent operation."""
    await _create_role(
        super_admin_client, role_key="TEST_CROSS_ERP_ROLE", permission_keys=["platform.erp.manage_test"]
    )
    user_id, _token = await _register_global_user_and_login(client, email="crosserp1@example.com")
    erp_a = await _create_erp(super_admin_client, key="cross_erp_a")
    erp_b = await _create_erp(super_admin_client, key="cross_erp_b")

    await super_admin_client.post(
        f"/api/v1/global/authz/users/{user_id}/roles",
        json={"role_key": "TEST_CROSS_ERP_ROLE", "scope": "ERP", "erp_instance_id": erp_a},
    )

    perms = await super_admin_client.get(f"/api/v1/global/authz/users/{user_id}/effective-permissions")
    data = perms.json()["data"]
    assert "platform.erp.manage_test" in data["erp_permissions"].get(erp_a, [])
    assert "platform.erp.manage_test" not in data["erp_permissions"].get(erp_b, [])
    assert "platform.erp.manage_test" not in data["global_permissions"]


async def test_global_scope_grant_satisfies_any_erp(super_admin_client, client):
    """A GLOBAL-scoped grant of a permission satisfies a check for ANY erp_instance_id (Section 9)."""
    await _create_role(
        super_admin_client, role_key="TEST_GLOBAL_SATISFIES_ALL", permission_keys=["platform.erp.manage_test2"]
    )
    user_id, _token = await _register_global_user_and_login(client, email="globalsatisfies1@example.com")

    await super_admin_client.post(
        f"/api/v1/global/authz/users/{user_id}/roles",
        json={"role_key": "TEST_GLOBAL_SATISFIES_ALL", "scope": "GLOBAL"},
    )

    perms = await super_admin_client.get(f"/api/v1/global/authz/users/{user_id}/effective-permissions")
    assert "platform.erp.manage_test2" in perms.json()["data"]["global_permissions"]


# --------------------------------------------------------------------
# Deny-by-default sanity checks
# --------------------------------------------------------------------


async def test_unknown_permission_key_denies(super_admin_client, client):
    """Checking a permission key that no role grants anyone results in deny, never an error masking allow."""
    user_id, _token = await _register_global_user_and_login(client, email="unknownperm1@example.com")
    perms = await super_admin_client.get(f"/api/v1/global/authz/users/{user_id}/effective-permissions")
    assert perms.json()["data"]["global_permissions"] == []
    assert perms.json()["data"]["erp_permissions"] == {}


async def test_nonexistent_global_user_effective_permissions_returns_empty(super_admin_client):
    """Computing effective permissions for a nonexistent GlobalUser returns empty sets, not an error or a crash."""
    fake_id = uuid.uuid4()
    resp = await super_admin_client.get(f"/api/v1/global/authz/users/{fake_id}/effective-permissions")
    assert resp.status_code == 200
    assert resp.json()["data"]["global_permissions"] == []


# --------------------------------------------------------------------
# Cross-module integration: a GlobalUser holding a platform_authz-granted
# permission can now reach an existing (Phase 2/3) erp_registry route
# that used to be PlatformAdmin-only -- proving require_platform_permission
# genuinely extends, rather than merely re-implements, the old gate.
# --------------------------------------------------------------------


async def test_global_user_with_erp_create_permission_can_register_erp(super_admin_client, client):
    """A GlobalUser holding platform.erp.create can call the existing POST /global/erps route (Section 22)."""
    await _create_role(super_admin_client, role_key="TEST_ERP_CREATOR", permission_keys=["platform.erp.create"])
    user_id, token = await _register_global_user_and_login(client, email="erpcreator1@example.com")
    await super_admin_client.post(
        f"/api/v1/global/authz/users/{user_id}/roles", json={"role_key": "TEST_ERP_CREATOR", "scope": "GLOBAL"}
    )

    client.headers["Authorization"] = f"Bearer {token}"
    resp = await client.post(
        "/api/v1/global/erps",
        json={"key": "integration_test_erp", "name": "x", "display_name": "x", "status": "ACTIVE"},
    )
    assert resp.status_code == 201, resp.text


async def test_global_user_without_erp_create_permission_cannot_register_erp(client):
    """A GlobalUser with no platform_authz grant at all is still rejected by the pre-existing erp_registry route."""
    _user_id, token = await _register_global_user_and_login(client, email="noerpcreator1@example.com")
    client.headers["Authorization"] = f"Bearer {token}"
    resp = await client.post(
        "/api/v1/global/erps",
        json={"key": "should_not_be_created", "name": "x", "display_name": "x", "status": "ACTIVE"},
    )
    assert resp.status_code == 403


async def test_revoke_permission_from_role(super_admin_client):
    """DELETE /global/authz/roles/{role_id}/permissions/{key} removes permission from role."""
    role = await _create_role(
        super_admin_client, role_key="REVOKE_TEST_ROLE", permission_keys=["platform.user.read", "platform.user.create"]
    )
    role_id = role["id"]
    assert "platform.user.create" in role["permission_keys"]

    del_resp = await super_admin_client.delete(
        f"/api/v1/global/authz/roles/{role_id}/permissions/platform.user.create"
    )
    assert del_resp.status_code == 200
    updated_role = del_resp.json()["data"]
    assert "platform.user.create" not in updated_role["permission_keys"]
    assert "platform.user.read" in updated_role["permission_keys"]

    # Idempotent re-delete
    del_resp2 = await super_admin_client.delete(
        f"/api/v1/global/authz/roles/{role_id}/permissions/platform.user.create"
    )
    assert del_resp2.status_code == 200

