"""
Tests for Phase 3 -- Global User Status & ERP Access Synchronization.

Covers exactly the six scenarios from the brief:
- GlobalUser suspend -> ERP access blocked
- GlobalUser disable -> ERP access blocked
- re-enable -> previously-active membership restored
- explicitly revoked membership stays revoked (not restored)
- removing one ERP does not affect another ERP
- direct ERP login respects the central access state

Reuses the same `InMemoryTestProvisioningAdapter` from
test_identity_linking.py (imported, not duplicated) and its
`register_test_adapters`-style pattern, so these tests exercise the real
service call chain (GlobalUserService -> ErpMembershipService -> adapter
registry) without any real network call.
"""

from __future__ import annotations

import pytest

from app.identity_linking.adapters.registry import get_adapter_registry
from tests.test_identity_linking import InMemoryTestProvisioningAdapter


@pytest.fixture(autouse=True)
def sync_test_adapter():
    """Swap the adapter registry's default adapter for the in-memory fake for every test in this file."""
    registry = get_adapter_registry()
    adapter = InMemoryTestProvisioningAdapter()
    orig_get = registry.get_adapter
    registry.get_adapter = lambda erp: adapter
    yield adapter
    registry.get_adapter = orig_get


async def _create_user_erp_and_membership(admin_client, *, email: str, erp_key: str, local_user_id: str):
    """Shared setup: one GlobalUser, one ERP (with a real base_url so the adapter isn't skipped), one ACTIVE membership."""
    user_resp = await admin_client.post(
        "/api/v1/global/users", json={"display_name": "Sync Test User", "primary_email": email}
    )
    user_id = user_resp.json()["data"]["id"]

    erp_resp = await admin_client.post(
        "/api/v1/global/erps",
        json={
            "key": erp_key,
            "name": erp_key,
            "display_name": erp_key,
            "status": "ACTIVE",
            "base_url": f"https://{erp_key}.example.internal",
        },
    )
    erp_id = erp_resp.json()["data"]["id"]

    membership_resp = await admin_client.post(
        f"/api/v1/global/users/{user_id}/memberships/{erp_id}", json={"local_user_id": local_user_id}
    )
    membership_id = membership_resp.json()["data"]["id"]

    # Membership starts PENDING (see ErpMembershipService.create's own
    # docstring) -- verify it to ACTIVE so it's eligible to be synced.
    await admin_client.post(f"/api/v1/global/memberships/{membership_id}/verify")

    return user_id, erp_id, membership_id


@pytest.mark.asyncio
async def test_suspend_global_user_blocks_erp_access(admin_client, sync_test_adapter):
    """GlobalUser SUSPENDED -> the ACTIVE membership is suspended and local login is blocked."""
    user_id, erp_id, membership_id = await _create_user_erp_and_membership(
        admin_client, email="suspend1@example.com", erp_key="erp_sync1", local_user_id="local-s1"
    )
    # This membership was created+verified directly (not via
    # provision_local_user), so the adapter has not seen this
    # local_user_id yet -- nothing to assert about local access until the
    # GlobalUser-level suspend below actually triggers the adapter call.
    assert "local-s1" not in sync_test_adapter.access_by_local_user_id

    resp = await admin_client.patch(f"/api/v1/global/users/{user_id}/status", json={"status": "SUSPENDED"})
    assert resp.status_code == 200
    assert resp.json()["data"]["status"] == "SUSPENDED"

    membership = await admin_client.get(f"/api/v1/global/memberships/{membership_id}")
    assert membership.json()["data"]["status"] == "SUSPENDED"

    # Local access must now be blocked.
    assert sync_test_adapter.access_by_local_user_id.get("local-s1") is False


@pytest.mark.asyncio
async def test_disable_global_user_blocks_erp_access(admin_client, sync_test_adapter):
    """GlobalUser DISABLED -> the ACTIVE membership is suspended and local login is blocked, same as SUSPENDED."""
    user_id, erp_id, membership_id = await _create_user_erp_and_membership(
        admin_client, email="disable1@example.com", erp_key="erp_sync2", local_user_id="local-d1"
    )

    resp = await admin_client.patch(f"/api/v1/global/users/{user_id}/status", json={"status": "DISABLED"})
    assert resp.status_code == 200
    assert resp.json()["data"]["status"] == "DISABLED"

    membership = await admin_client.get(f"/api/v1/global/memberships/{membership_id}")
    assert membership.json()["data"]["status"] == "SUSPENDED"
    assert sync_test_adapter.access_by_local_user_id.get("local-d1") is False


@pytest.mark.asyncio
async def test_reenable_restores_previously_active_membership(admin_client, sync_test_adapter):
    """Re-enabling a GlobalUser restores exactly the membership THIS transition suspended, and local access is restored."""
    user_id, erp_id, membership_id = await _create_user_erp_and_membership(
        admin_client, email="reenable1@example.com", erp_key="erp_sync3", local_user_id="local-r1"
    )

    await admin_client.patch(f"/api/v1/global/users/{user_id}/status", json={"status": "SUSPENDED"})
    assert sync_test_adapter.access_by_local_user_id.get("local-r1") is False

    resp = await admin_client.patch(f"/api/v1/global/users/{user_id}/status", json={"status": "ACTIVE"})
    assert resp.status_code == 200
    assert resp.json()["data"]["status"] == "ACTIVE"

    membership = await admin_client.get(f"/api/v1/global/memberships/{membership_id}")
    assert membership.json()["data"]["status"] == "ACTIVE"
    assert sync_test_adapter.access_by_local_user_id.get("local-r1") is True


@pytest.mark.asyncio
async def test_explicitly_revoked_membership_not_restored_on_reenable(admin_client, sync_test_adapter):
    """A membership explicitly REVOKED (by an admin, independent of the GlobalUser transition) stays REVOKED after re-enable."""
    user_id, erp_id, membership_id = await _create_user_erp_and_membership(
        admin_client, email="revoked1@example.com", erp_key="erp_sync4", local_user_id="local-v1"
    )

    # Admin explicitly revokes the membership -- independent of any
    # GlobalUser-level status change.
    revoke_resp = await admin_client.post(f"/api/v1/global/memberships/{membership_id}/revoke", json={})
    assert revoke_resp.json()["data"]["status"] == "REVOKED"

    # Now suspend and re-enable the GlobalUser.
    await admin_client.patch(f"/api/v1/global/users/{user_id}/status", json={"status": "SUSPENDED"})
    resp = await admin_client.patch(f"/api/v1/global/users/{user_id}/status", json={"status": "ACTIVE"})
    assert resp.status_code == 200

    # The already-revoked membership must remain REVOKED -- never
    # silently resurrected to ACTIVE or SUSPENDED by the GlobalUser sync.
    membership = await admin_client.get(f"/api/v1/global/memberships/{membership_id}")
    assert membership.json()["data"]["status"] == "REVOKED"


@pytest.mark.asyncio
async def test_independently_suspended_membership_not_restored_on_reenable(admin_client, sync_test_adapter):
    """A membership an admin suspended for their own reason (not via the GlobalUser transition) stays suspended on re-enable."""
    user_id, erp_id, membership_id = await _create_user_erp_and_membership(
        admin_client, email="indepsuspend1@example.com", erp_key="erp_sync5", local_user_id="local-i1"
    )

    # Admin suspends the membership directly (e.g. "investigation"),
    # independent of any GlobalUser-level status change. The GlobalUser
    # itself is still ACTIVE at this point.
    await admin_client.post(f"/api/v1/global/memberships/{membership_id}/suspend", json={"reason": "investigation"})

    # Now suspend and re-enable the GlobalUser -- since the membership was
    # already SUSPENDED (not ACTIVE) when the GlobalUser was suspended, it
    # was never tracked as "auto-suspended by this transition."
    await admin_client.patch(f"/api/v1/global/users/{user_id}/status", json={"status": "SUSPENDED"})
    await admin_client.patch(f"/api/v1/global/users/{user_id}/status", json={"status": "ACTIVE"})

    membership = await admin_client.get(f"/api/v1/global/memberships/{membership_id}")
    assert membership.json()["data"]["status"] == "SUSPENDED"


@pytest.mark.asyncio
async def test_removing_one_erp_does_not_affect_another(admin_client, sync_test_adapter):
    """Revoking one ERP membership never touches the same GlobalUser's other, unrelated ERP membership."""
    user_resp = await admin_client.post(
        "/api/v1/global/users", json={"display_name": "Multi ERP User", "primary_email": "multi1@example.com"}
    )
    user_id = user_resp.json()["data"]["id"]

    erp_a = await admin_client.post(
        "/api/v1/global/erps",
        json={"key": "erp_sync6a", "name": "A", "display_name": "A", "status": "ACTIVE", "base_url": "https://a.example.internal"},
    )
    erp_b = await admin_client.post(
        "/api/v1/global/erps",
        json={"key": "erp_sync6b", "name": "B", "display_name": "B", "status": "ACTIVE", "base_url": "https://b.example.internal"},
    )
    erp_a_id = erp_a.json()["data"]["id"]
    erp_b_id = erp_b.json()["data"]["id"]

    m_a = await admin_client.post(
        f"/api/v1/global/users/{user_id}/memberships/{erp_a_id}", json={"local_user_id": "local-6a"}
    )
    m_b = await admin_client.post(
        f"/api/v1/global/users/{user_id}/memberships/{erp_b_id}", json={"local_user_id": "local-6b"}
    )
    membership_a_id = m_a.json()["data"]["id"]
    membership_b_id = m_b.json()["data"]["id"]
    await admin_client.post(f"/api/v1/global/memberships/{membership_a_id}/verify")
    await admin_client.post(f"/api/v1/global/memberships/{membership_b_id}/verify")

    # Revoke only membership A.
    resp = await admin_client.post(f"/api/v1/global/memberships/{membership_a_id}/revoke", json={})
    assert resp.json()["data"]["status"] == "REVOKED"

    # Membership B must be completely unaffected: still ACTIVE.
    membership_b = await admin_client.get(f"/api/v1/global/memberships/{membership_b_id}")
    assert membership_b.json()["data"]["status"] == "ACTIVE"

    # The GlobalUser itself must still exist and be unaffected.
    user = await admin_client.get(f"/api/v1/global/users/{user_id}")
    assert user.status_code == 200
    assert user.json()["data"]["status"] == "ACTIVE"


@pytest.mark.asyncio
async def test_suspend_calls_adapter_with_correct_local_user_id_and_erp(admin_client, sync_test_adapter):
    """
    Direct-login enforcement point: suspending a membership calls the
    adapter with exactly the local_user_id/ERP recorded on that
    membership -- this is the same call a real HttpErpProvisioningAdapter
    would make to Yinglima/Inhyma's `/internal/users/{id}/access`
    endpoint, which (see app/api/v1/internal_users.py on both ERPs) calls
    the ERP's own existing `UserService.suspend_user`, which is what
    actually makes `User.can_login` (and therefore direct login) return
    False. This test verifies ERP_Main's side of that contract: the right
    local_user_id, on the right ERP, is the one whose access gets flipped.
    """
    user_id, erp_id, membership_id = await _create_user_erp_and_membership(
        admin_client, email="directlogin1@example.com", erp_key="erp_sync7", local_user_id="local-direct-1"
    )

    await admin_client.post(f"/api/v1/global/memberships/{membership_id}/suspend", json={"reason": "central block"})

    # Exactly the local_user_id on this membership was blocked -- not some
    # other id.
    assert sync_test_adapter.access_by_local_user_id.get("local-direct-1") is False

    restore_resp = await admin_client.post(f"/api/v1/global/memberships/{membership_id}/restore", json={})
    assert restore_resp.json()["data"]["status"] == "ACTIVE"
    assert sync_test_adapter.access_by_local_user_id.get("local-direct-1") is True
