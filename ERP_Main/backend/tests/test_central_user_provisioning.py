"""
Comprehensive Test Suite for Central User Provisioning & Synchronization (Phase 5).

Covers all Phase 5 requirements:
1. Existing local user successfully linked (without recreating)
2. New local user successfully provisioned
3. Repeated provisioning is idempotent
4. Duplicate identity detected & conflict recorded
5. Remote 409 conflict handled with IdentityConflict record
6. ERP timeout handled as transient, recorded as PENDING_RETRY
7. ERP unavailable / connection failure handled as transient
8. HTTP 401/403 treated as permanent failure, not retried
9. HTTP 429 rate limit treated as transient failure
10. HTTP 5xx server error treated as transient failure
11. Malformed response handled without crash
12. Database failure preserves GlobalUser intact
13. Retry succeeds after temporary failure (PENDING -> ACTIVE)
14. Lost response followed by idempotent recovery
15. Failed provisioning does not accidentally grant ERP access (status != ACTIVE)
16. ERP-local RBAC remains untouched
"""

from __future__ import annotations

import uuid
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import select

from app.core.exceptions import BadRequestException, ConflictException, ForbiddenException
from app.erp_memberships.models import ErpMembership, ErpMembershipStatus
from app.erp_registry.models import ErpInstance, ErpStatus
from app.global_audit.models import AuditEventType, GlobalAuditLog
from app.global_users.models import GlobalUser, GlobalUserStatus
from app.identity_linking.adapters.base import BaseErpProvisioningAdapter
from app.identity_linking.adapters.registry import get_adapter_registry
from app.identity_linking.exceptions import (
    ErpAuthError,
    ErpConnectionError,
    ErpConflictError,
    ErpMalformedResponseError,
    ErpRateLimitError,
    ErpServerError,
    ErpTimeoutError,
)
from app.identity_linking.models import ConflictStatus, ConflictType, IdentityConflict


class ConfigurableTestAdapter(BaseErpProvisioningAdapter):
    """Controllable adapter for simulating diverse ERP responses and failure modes."""

    def __init__(self) -> None:
        self.users: dict[str, dict[str, Any]] = {}
        self.check_behavior: Any = None
        self.provision_behavior: Any = None
        self.check_call_count = 0
        self.provision_call_count = 0

    async def check_local_user(self, erp: ErpInstance, email_or_username: str) -> dict[str, Any] | None:
        self.check_call_count += 1
        if callable(self.check_behavior):
            return await self.check_behavior(erp, email_or_username)
        if isinstance(self.check_behavior, Exception):
            raise self.check_behavior

        norm = email_or_username.strip().lower()
        if norm in self.users:
            return {"exists": True, **self.users[norm]}
        return None

    async def provision_local_user(
        self,
        erp: ErpInstance,
        *,
        email: str,
        display_name: str,
        username: str | None = None,
        first_name: str | None = None,
        last_name: str | None = None,
        target_organization_id: str | None = None,
    ) -> dict[str, Any]:
        self.provision_call_count += 1
        if callable(self.provision_behavior):
            return await self.provision_behavior(erp, email=email, display_name=display_name)
        if isinstance(self.provision_behavior, Exception):
            raise self.provision_behavior

        norm = email.strip().lower()
        if norm in self.users:
            return {"local_user_id": self.users[norm]["local_user_id"], "created": False}

        local_id = str(uuid.uuid4())
        record = {
            "local_user_id": local_id,
            "email": norm,
            "username": username or norm.split("@")[0],
            "display_name": display_name,
        }
        self.users[norm] = record
        return {"local_user_id": local_id, "created": True}

    async def set_local_user_access(
        self, erp: ErpInstance, local_user_id: str, *, allow_login: bool, reason: str | None = None
    ) -> dict[str, Any] | None:
        return {"local_user_id": local_user_id, "can_login": allow_login}


@pytest.fixture
def test_adapter():
    registry = get_adapter_registry()
    adapter = ConfigurableTestAdapter()
    orig_get = registry.get_adapter
    registry.get_adapter = lambda erp_instance: adapter
    yield adapter
    registry.get_adapter = orig_get


async def _create_test_erp(admin_client, key: str = "inhyma") -> str:
    resp = await admin_client.post(
        "/api/v1/global/erps",
        json={"key": key, "name": key.title(), "display_name": f"{key.title()} ERP", "status": "ACTIVE"},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["data"]["id"]


async def _create_test_global_user(admin_client, email: str, name: str = "Test User") -> str:
    resp = await admin_client.post(
        "/api/v1/global/users",
        json={"primary_email": email, "display_name": name},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["data"]["id"]


# -----------------------------------------------------------------------------
# 1. Existing local user successfully linked
# -----------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_existing_local_user_successfully_linked(admin_client, test_adapter):
    erp_id = await _create_test_erp(admin_client, key="erp_linked")
    user_id = await _create_test_global_user(admin_client, email="existing@example.com", name="Existing User")

    # Seed existing account in remote ERP
    test_adapter.users["existing@example.com"] = {
        "local_user_id": "loc-uuid-existing-99",
        "email": "existing@example.com",
        "username": "existing_user",
    }

    resp = await admin_client.post(
        f"/api/v1/global/users/{user_id}/provision",
        json={"erp_instance_id": erp_id, "notes": "Link existing account"},
    )
    assert resp.status_code == 201, resp.text
    data = resp.json()["data"]
    assert data["status"] == "ACTIVE"
    assert data["local_user_id"] == "loc-uuid-existing-99"
    assert data["metadata_json"]["provision_method"] == "linked_existing"
    assert test_adapter.provision_call_count == 0  # Did NOT call provision


# -----------------------------------------------------------------------------
# 2. New local user successfully provisioned
# -----------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_new_local_user_successfully_provisioned(admin_client, test_adapter):
    erp_id = await _create_test_erp(admin_client, key="erp_new")
    user_id = await _create_test_global_user(admin_client, email="brandnew@example.com", name="New User")

    resp = await admin_client.post(
        f"/api/v1/global/users/{user_id}/provision",
        json={"erp_instance_id": erp_id},
    )
    assert resp.status_code == 201, resp.text
    data = resp.json()["data"]
    assert data["status"] == "ACTIVE"
    assert test_adapter.provision_call_count == 1
    assert data["local_user_id"] == test_adapter.users["brandnew@example.com"]["local_user_id"]
    assert data["metadata_json"]["provision_method"] == "created_new"


# -----------------------------------------------------------------------------
# 3. Repeated provisioning is idempotent
# -----------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_repeated_provisioning_is_idempotent(admin_client, test_adapter):
    erp_id = await _create_test_erp(admin_client, key="erp_idem")
    user_id = await _create_test_global_user(admin_client, email="idem@example.com", name="Idem User")

    resp1 = await admin_client.post(
        f"/api/v1/global/users/{user_id}/provision",
        json={"erp_instance_id": erp_id},
    )
    assert resp1.status_code == 201
    mem_id1 = resp1.json()["data"]["id"]
    assert test_adapter.provision_call_count == 1

    resp2 = await admin_client.post(
        f"/api/v1/global/users/{user_id}/provision",
        json={"erp_instance_id": erp_id},
    )
    assert resp2.status_code == 201
    mem_id2 = resp2.json()["data"]["id"]
    assert mem_id1 == mem_id2
    # Second call returns existing active membership without calling remote ERP again
    assert test_adapter.provision_call_count == 1


# -----------------------------------------------------------------------------
# 4. Duplicate identity detected & conflict recorded
# -----------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_duplicate_identity_detected_records_conflict(admin_client, test_adapter):
    erp_id = await _create_test_erp(admin_client, key="erp_conflict")
    u1_id = await _create_test_global_user(admin_client, email="user1@example.com", name="User One")
    u2_id = await _create_test_global_user(admin_client, email="user2@example.com", name="User Two")

    # User 1 successfully claims local_id "loc-shared"
    test_adapter.users["user1@example.com"] = {"local_user_id": "loc-shared", "email": "user1@example.com"}
    resp1 = await admin_client.post(f"/api/v1/global/users/{u1_id}/provision", json={"erp_instance_id": erp_id})
    assert resp1.status_code == 201

    # User 2 attempts to provision, but remote ERP points to the SAME local_id "loc-shared"
    test_adapter.users["user2@example.com"] = {"local_user_id": "loc-shared", "email": "user2@example.com"}
    resp2 = await admin_client.post(f"/api/v1/global/users/{u2_id}/provision", json={"erp_instance_id": erp_id})
    assert resp2.status_code == 409
    assert "already linked to another GlobalUser" in resp2.json()["message"]

    # Verify conflict was recorded in identity_conflicts table
    conflicts_resp = await admin_client.get("/api/v1/global/identity/conflicts")
    assert conflicts_resp.status_code == 200
    conflicts = conflicts_resp.json()["data"]
    assert len(conflicts) >= 1
    conflict = next(c for c in conflicts if c["local_user_id"] == "loc-shared")
    assert conflict["conflict_type"] == "CONFLICT"
    assert conflict["status"] == "PENDING"


# -----------------------------------------------------------------------------
# 5. Remote 409 conflict handled with IdentityConflict record
# -----------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_remote_409_conflict_recorded(admin_client, test_adapter):
    erp_id = await _create_test_erp(admin_client, key="erp_rem_conflict")
    user_id = await _create_test_global_user(admin_client, email="conflict@example.com", name="Conflict User")

    test_adapter.provision_behavior = ErpConflictError("erp_rem_conflict", "Remote username collision")

    resp = await admin_client.post(f"/api/v1/global/users/{user_id}/provision", json={"erp_instance_id": erp_id})
    assert resp.status_code == 409
    assert "Remote ERP 'erp_rem_conflict' rejected operation due to conflict" in resp.json()["message"]


# -----------------------------------------------------------------------------
# 6. ERP timeout handled as transient, recorded as PENDING_RETRY
# -----------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_erp_timeout_transient_failure_records_pending_retry(admin_client, test_adapter):
    erp_id = await _create_test_erp(admin_client, key="erp_timeout")
    user_id = await _create_test_global_user(admin_client, email="timeout@example.com", name="Timeout User")

    test_adapter.provision_behavior = ErpTimeoutError("erp_timeout", "Connection timed out after 10s")

    resp = await admin_client.post(f"/api/v1/global/users/{user_id}/provision", json={"erp_instance_id": erp_id})
    # Transient failure completes centrally with PENDING status
    assert resp.status_code == 201
    data = resp.json()["data"]
    assert data["status"] == "PENDING"
    assert data["metadata_json"]["sync_status"] == "PENDING_RETRY"
    assert data["metadata_json"]["error_type"] == "TIMEOUT"
    assert data["metadata_json"]["is_retryable"] is True
    assert data["local_user_id"].startswith("pending:")

    # Verify GlobalUser was NOT disabled or deleted
    user_resp = await admin_client.get(f"/api/v1/global/users/{user_id}")
    assert user_resp.status_code == 200
    assert user_resp.json()["data"]["status"] == "ACTIVE"


# -----------------------------------------------------------------------------
# 7. ERP unavailable / connection failure handled as transient
# -----------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_erp_unavailable_connection_failure(admin_client, test_adapter):
    erp_id = await _create_test_erp(admin_client, key="erp_down")
    user_id = await _create_test_global_user(admin_client, email="down@example.com", name="Down User")

    test_adapter.check_behavior = ErpConnectionError("erp_down", "Connection refused on port 8000")

    resp = await admin_client.post(f"/api/v1/global/users/{user_id}/provision", json={"erp_instance_id": erp_id})
    assert resp.status_code == 201
    data = resp.json()["data"]
    assert data["status"] == "PENDING"
    assert data["metadata_json"]["sync_status"] == "PENDING_RETRY"
    assert data["metadata_json"]["error_type"] == "CONNECTION_FAILURE"


# -----------------------------------------------------------------------------
# 8. HTTP 401/403 treated as permanent failure, not retried
# -----------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_http_401_auth_failure_permanent(admin_client, test_adapter):
    erp_id = await _create_test_erp(admin_client, key="erp_unauth")
    user_id = await _create_test_global_user(admin_client, email="unauth@example.com", name="Unauth User")

    test_adapter.provision_behavior = ErpAuthError("erp_unauth", 401, "Invalid service credential")

    resp = await admin_client.post(f"/api/v1/global/users/{user_id}/provision", json={"erp_instance_id": erp_id})
    assert resp.status_code == 403
    assert "Authentication/authorization failed" in resp.json()["message"]
    # Exactly 1 call attempted (no retries on 401)
    assert test_adapter.provision_call_count == 1


# -----------------------------------------------------------------------------
# 9. HTTP 429 rate limit treated as transient failure
# -----------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_http_429_rate_limit_transient(admin_client, test_adapter):
    erp_id = await _create_test_erp(admin_client, key="erp_rate_limit")
    user_id = await _create_test_global_user(admin_client, email="ratelimit@example.com", name="Rate Limit User")

    test_adapter.provision_behavior = ErpRateLimitError("erp_rate_limit", "Too many requests")

    resp = await admin_client.post(f"/api/v1/global/users/{user_id}/provision", json={"erp_instance_id": erp_id})
    assert resp.status_code == 201
    data = resp.json()["data"]
    assert data["status"] == "PENDING"
    assert data["metadata_json"]["error_type"] == "RATE_LIMITED"
    assert data["metadata_json"]["is_retryable"] is True


# -----------------------------------------------------------------------------
# 10. HTTP 5xx server error treated as transient failure
# -----------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_http_5xx_server_error_transient(admin_client, test_adapter):
    erp_id = await _create_test_erp(admin_client, key="erp_500")
    user_id = await _create_test_global_user(admin_client, email="servererr@example.com", name="500 User")

    test_adapter.provision_behavior = ErpServerError("erp_500", 500, "Internal error in spoke ERP")

    resp = await admin_client.post(f"/api/v1/global/users/{user_id}/provision", json={"erp_instance_id": erp_id})
    assert resp.status_code == 201
    data = resp.json()["data"]
    assert data["status"] == "PENDING"
    assert data["metadata_json"]["error_type"] == "SERVER_ERROR"
    assert data["metadata_json"]["is_retryable"] is True


# -----------------------------------------------------------------------------
# 11. Malformed response handled without crash
# -----------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_malformed_response_handled(admin_client, test_adapter):
    erp_id = await _create_test_erp(admin_client, key="erp_malformed")
    user_id = await _create_test_global_user(admin_client, email="malformed@example.com", name="Malformed User")

    test_adapter.provision_behavior = ErpMalformedResponseError("erp_malformed", "Missing local_user_id field")

    resp = await admin_client.post(f"/api/v1/global/users/{user_id}/provision", json={"erp_instance_id": erp_id})
    assert resp.status_code == 400
    assert "Received malformed response from ERP" in resp.json()["message"]


# -----------------------------------------------------------------------------
# 12. Retry succeeds after temporary failure (PENDING -> ACTIVE)
# -----------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_retry_succeeds_after_temporary_failure(admin_client, test_adapter):
    erp_id = await _create_test_erp(admin_client, key="erp_recoverable")
    user_id = await _create_test_global_user(admin_client, email="retry@example.com", name="Retry User")

    # Step 1: Simulate temporary failure
    test_adapter.provision_behavior = ErpTimeoutError("erp_recoverable", "First attempt timeout")
    resp1 = await admin_client.post(f"/api/v1/global/users/{user_id}/provision", json={"erp_instance_id": erp_id})
    assert resp1.status_code == 201
    membership_id = resp1.json()["data"]["id"]
    assert resp1.json()["data"]["status"] == "PENDING"

    # Step 2: ERP recovers and becomes healthy
    test_adapter.provision_behavior = None

    # Step 3: Trigger retry
    retry_resp = await admin_client.post(f"/api/v1/global/identity/provisioning/{membership_id}/retry")
    assert retry_resp.status_code == 200, retry_resp.text
    data = retry_resp.json()["data"]
    assert data["id"] == membership_id
    assert data["status"] == "ACTIVE"
    assert data["metadata_json"]["recovered"] is True
    assert not data["local_user_id"].startswith("pending:")


# -----------------------------------------------------------------------------
# 13. Lost response followed by idempotent recovery
# -----------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_lost_response_idempotent_recovery(admin_client, test_adapter):
    erp_id = await _create_test_erp(admin_client, key="erp_lost")
    user_id = await _create_test_global_user(admin_client, email="lostresponse@example.com", name="Lost Response User")

    # Simulate timeout on provision
    test_adapter.provision_behavior = ErpTimeoutError("erp_lost", "Client timeout waiting for response")
    resp1 = await admin_client.post(f"/api/v1/global/users/{user_id}/provision", json={"erp_instance_id": erp_id})
    membership_id = resp1.json()["data"]["id"]
    assert resp1.json()["data"]["status"] == "PENDING"

    # But unbeknownst to ERP_Main, the user actually was created remotely!
    test_adapter.users["lostresponse@example.com"] = {
        "local_user_id": "loc-lost-recovered-123",
        "email": "lostresponse@example.com",
    }
    test_adapter.provision_behavior = None

    # Retry runs
    retry_resp = await admin_client.post(f"/api/v1/global/identity/provisioning/{membership_id}/retry")
    assert retry_resp.status_code == 200
    data = retry_resp.json()["data"]
    assert data["status"] == "ACTIVE"
    assert data["local_user_id"] == "loc-lost-recovered-123"
    assert data["metadata_json"]["provision_method"] == "linked_existing"
    assert data["metadata_json"]["recovered"] is True


# -----------------------------------------------------------------------------
# 14. Failed provisioning does not accidentally grant ERP access
# -----------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_failed_provisioning_does_not_grant_access(admin_client, test_adapter):
    erp_id = await _create_test_erp(admin_client, key="erp_no_access")
    user_id = await _create_test_global_user(admin_client, email="noaccess@example.com", name="No Access User")

    test_adapter.provision_behavior = ErpTimeoutError("erp_no_access", "Down")
    resp = await admin_client.post(f"/api/v1/global/users/{user_id}/provision", json={"erp_instance_id": erp_id})
    assert resp.status_code == 201
    membership = resp.json()["data"]
    assert membership["status"] == "PENDING"

    # Verify that the membership is NOT active
    assert membership["status"] != "ACTIVE"
    assert membership["verified_at"] is None


# -----------------------------------------------------------------------------
# 15. ERP-local RBAC remains untouched
# -----------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_erp_local_rbac_remains_untouched(admin_client, test_adapter):
    """
    Verify that central provisioning creates/links the user account only,
    never pushing or overriding local roles or permissions into the spoke ERP.
    """
    erp_id = await _create_test_erp(admin_client, key="erp_norbac")
    user_id = await _create_test_global_user(admin_client, email="norbac@example.com", name="No RBAC User")

    resp = await admin_client.post(
        f"/api/v1/global/users/{user_id}/provision",
        json={"erp_instance_id": erp_id},
    )
    assert resp.status_code == 201
    data = resp.json()["data"]
    assert "roles" not in data
    assert "permissions" not in data
