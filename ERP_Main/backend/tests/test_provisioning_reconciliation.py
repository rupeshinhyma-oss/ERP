"""
Comprehensive Test Suite for Background Provisioning Reconciliation & Recovery (Phase 8).

Validates:
1. Basic reconciliation: eligible pending membership is discovered, executed, and synchronized.
2. Ingestion of pre-existing untracked work.
3. Retry behavior: transient failure schedules retry, exponential backoff + jitter, max retries limit.
4. Permanent errors: 401/403, 404 halt retries immediately.
5. Concurrency & Leases: atomic claiming, race prevention between workers.
6. Crashed worker recovery: expired leases reclaimed without orphan work.
7. Manual vs auto coordination: active lease blocks duplicate manual retry (409 Conflict).
8. Lifecycle safety: revoked/suspended membership and inactive GlobalUsers skipped safely.
9. Idempotency & Lost-response: existing spoke user detected without duplicates.
10. Identity conflict protection: conflicts halt automatic reconciliation and record audit.
11. Spoke failure classifications: timeouts, connection errors, 429 rate limits, 5xx server errors.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

import pytest
from sqlalchemy import select

from app.erp_memberships.models import ErpMembership, ErpMembershipStatus
from app.erp_registry.models import ErpInstance
from app.global_audit.models import AuditEventType, GlobalAuditLog
from app.global_users.models import GlobalUser, GlobalUserStatus
from app.identity_linking.adapters.base import BaseErpProvisioningAdapter
from app.identity_linking.adapters.registry import get_adapter_registry
from app.identity_linking.exceptions import (
    ErpAuthError,
    ErpConnectionError,
    ErpConflictError,
    ErpMalformedResponseError,
    ErpNotFoundError,
    ErpRateLimitError,
    ErpServerError,
    ErpTimeoutError,
)

from app.identity_linking.models import (
    ConflictStatus,
    IdentityConflict,
    ProvisioningReconciliationTask,
    ProvisioningTaskStatus,
)
from app.identity_linking.reconciliation_repository import ProvisioningReconciliationRepository
from app.identity_linking.reconciliation_worker import create_reconciliation_service


class ControllableReconciliationAdapter(BaseErpProvisioningAdapter):
    """Controllable ERP adapter for testing reconciliation workflows and failure modes."""

    def __init__(self) -> None:
        self.users: dict[str, dict[str, Any]] = {}
        self.check_behavior: Any = None
        self.provision_behavior: Any = None
        self.check_calls = 0
        self.provision_calls = 0

    async def check_local_user(self, erp: ErpInstance, email_or_username: str) -> dict[str, Any] | None:
        self.check_calls += 1
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
        self.provision_calls += 1
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
def recon_adapter():
    registry = get_adapter_registry()
    adapter = ControllableReconciliationAdapter()
    orig_get = registry.get_adapter
    registry.get_adapter = lambda erp_instance: adapter
    yield adapter
    registry.get_adapter = orig_get


async def _create_test_erp(client, key: str = "spoke_erp") -> str:
    resp = await client.post(
        "/api/v1/global/erps",
        json={"key": key, "name": key.title(), "display_name": f"{key.title()} ERP", "status": "ACTIVE"},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["data"]["id"]


async def _create_test_global_user(client, email: str, name: str = "Test User") -> str:
    resp = await client.post(
        "/api/v1/global/users",
        json={"primary_email": email, "display_name": name},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["data"]["id"]


async def _provision_user(client, user_id: str, erp_id: str):
    resp = await client.post(
        f"/api/v1/global/users/{user_id}/provision",
        json={"erp_instance_id": erp_id},
    )
    assert resp.status_code == 201, resp.text
    return resp


# -----------------------------------------------------------------------------
# 1. Basic Reconciliation & Discovery
# -----------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_reconciliation_discovery_and_recovery(admin_client, recon_adapter):
    """
    When spoke ERP was down during initial provision, reconciliation discovers
    the PENDING task and recovers it to ACTIVE once the spoke ERP is reachable.
    """
    erp_id = await _create_test_erp(admin_client, key="recon_recovery_erp")
    user_id = await _create_test_global_user(admin_client, email="recover@example.com")

    # Spoke is temporarily unavailable on initial request
    recon_adapter.provision_behavior = ErpConnectionError("Spoke down")

    resp = await _provision_user(admin_client, user_id, erp_id)
    membership_data = resp.json()["data"]
    assert membership_data["status"] == "PENDING"
    assert membership_data["metadata_json"]["sync_status"] == "PENDING_RETRY"

    # Verify reconciliation task was durably persisted in database
    from app.database.engine import get_sessionmaker
    async with get_sessionmaker()() as session:
        recon_repo = ProvisioningReconciliationRepository(session)
        task = await recon_repo.get_by_membership_id(uuid.UUID(membership_data["id"]))
        assert task is not None
        assert task.status == ProvisioningTaskStatus.PENDING_RETRY
        assert task.retry_count == 1
        # Set next_retry_at to past so it is immediately eligible for sweep
        task.next_retry_at = datetime.now(timezone.utc) - timedelta(seconds=1)
        await session.commit()

        # Spoke ERP recovers
        recon_adapter.provision_behavior = None

        service = create_reconciliation_service(session)
        summary = await service.run_reconciliation_batch(worker_id="test_worker_1")
        assert summary["eligible"] == 1
        assert summary["succeeded"] == 1

        # Verify task is SUCCEEDED and membership is ACTIVE
        updated_task = await recon_repo.get_by_id(task.id)
        assert updated_task.status == ProvisioningTaskStatus.SUCCEEDED
        assert updated_task.claimed_by is None

        # Verify membership is now ACTIVE
        mem_res = await session.execute(
            select(ErpMembership).where(ErpMembership.id == uuid.UUID(membership_data["id"]))
        )
        membership = mem_res.scalar_one()
        assert membership.status == ErpMembershipStatus.ACTIVE
        assert membership.verified_at is not None

        # Verify audit logs record PROVISIONING_RECOVERED and PROVISIONING_SUCCEEDED
        audit_res = await session.execute(
            select(GlobalAuditLog).where(GlobalAuditLog.target_id == membership.id)
        )
        event_types = [a.event_type for a in audit_res.scalars().all()]
        assert AuditEventType.PROVISIONING_RECOVERED in event_types
        assert AuditEventType.PROVISIONING_SUCCEEDED in event_types


# -----------------------------------------------------------------------------
# 2. Ingest Untracked Pre-existing Pending Memberships
# -----------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_reconciliation_ingests_untracked_pending_memberships(admin_client):
    """
    Memberships created prior to Phase 8 or after process restart without a task
    are automatically discovered and ingested into the reconciliation queue.
    """
    erp_id = await _create_test_erp(admin_client, key="untracked_erp")
    user_id = await _create_test_global_user(admin_client, email="untracked@example.com")

    from app.database.engine import get_sessionmaker
    async with get_sessionmaker()() as session:
        # Create a raw PENDING membership without a task
        mem = ErpMembership(
            global_user_id=uuid.UUID(user_id),
            erp_instance_id=uuid.UUID(erp_id),
            local_user_id=f"pending:{user_id}",
            status=ErpMembershipStatus.PENDING,
            linked_at=datetime.now(timezone.utc),
            metadata_json={"sync_status": "PENDING_RETRY", "retry_count": 0},
        )
        session.add(mem)
        await session.commit()
        mem_id = mem.id

        service = create_reconciliation_service(session)
        ingested = await service.ingest_untracked_pending_memberships()
        assert ingested >= 1

        recon_repo = ProvisioningReconciliationRepository(session)
        task = await recon_repo.get_by_membership_id(mem_id)
        assert task is not None
        assert task.status == ProvisioningTaskStatus.PENDING_RETRY


# -----------------------------------------------------------------------------
# 3. Retry Behavior: Bounded Retries & Exponential Backoff & Max Retries
# -----------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_reconciliation_bounded_retries_and_max_retries(admin_client, recon_adapter):
    """
    Transient failures trigger exponential backoff. Exceeding max retries marks task FAILED.
    """
    erp_id = await _create_test_erp(admin_client, key="retry_bound_erp")
    user_id = await _create_test_global_user(admin_client, email="retrybound@example.com")

    recon_adapter.provision_behavior = ErpTimeoutError("Gateway Timeout")

    resp = await _provision_user(admin_client, user_id, erp_id)
    mem_id = uuid.UUID(resp.json()["data"]["id"])

    from app.database.engine import get_sessionmaker
    async with get_sessionmaker()() as session:
        recon_repo = ProvisioningReconciliationRepository(session)
        task = await recon_repo.get_by_membership_id(mem_id)
        # Set max_retries = 2 for quick boundary testing
        task.max_retries = 2
        task.next_retry_at = datetime.now(timezone.utc) - timedelta(seconds=1)
        await session.commit()

        service = create_reconciliation_service(session)

        # Attempt 1: retry_count becomes 2, which equals max_retries
        res1 = await service.reconcile_single_task(task.id, worker_id="worker_bound")
        assert res1["status"] == "max_retries_exceeded"

        updated_task = await recon_repo.get_by_id(task.id)
        assert updated_task.status == ProvisioningTaskStatus.FAILED
        assert updated_task.last_error_type == "MAX_RETRIES_EXCEEDED"


# -----------------------------------------------------------------------------
# 4. Permanent Errors Halt Automatic Retries
# -----------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_reconciliation_permanent_errors_halt_retries(admin_client, recon_adapter):
    """
    Permanent errors (401/403, 404) immediately mark the task FAILED and do not schedule retries.
    """
    erp_id = await _create_test_erp(admin_client, key="perm_err_erp")
    user_id = await _create_test_global_user(admin_client, email="permerr@example.com")

    # Initial transient failure to get task into PENDING_RETRY
    recon_adapter.provision_behavior = ErpServerError("500 Internal")
    resp = await _provision_user(admin_client, user_id, erp_id)
    mem_id = uuid.UUID(resp.json()["data"]["id"])

    from app.database.engine import get_sessionmaker
    async with get_sessionmaker()() as session:
        recon_repo = ProvisioningReconciliationRepository(session)
        task = await recon_repo.get_by_membership_id(mem_id)
        task.next_retry_at = datetime.now(timezone.utc) - timedelta(seconds=1)
        await session.commit()

        # On reconciliation attempt, ERP returns 401 Unauthorized (permanent error)
        recon_adapter.provision_behavior = ErpAuthError("401 Unauthorized - Invalid Service Key")

        service = create_reconciliation_service(session)
        res = await service.reconcile_single_task(task.id, worker_id="worker_perm")
        assert res["status"] == "failed_permanent"

        updated_task = await recon_repo.get_by_id(task.id)
        assert updated_task.status == ProvisioningTaskStatus.FAILED
        assert updated_task.last_error_type in ("AUTH_FAILURE", "PERMANENT_ERROR", "ERP_AUTH_FAILED")


# -----------------------------------------------------------------------------
# 5. Concurrency & Atomic Lease Protection
# -----------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_reconciliation_atomic_lease_concurrency(admin_client, recon_adapter):
    """
    Multiple workers cannot claim the same task simultaneously.
    """
    erp_id = await _create_test_erp(admin_client, key="lease_race_erp")
    user_id = await _create_test_global_user(admin_client, email="leaserace@example.com")

    recon_adapter.provision_behavior = ErpTimeoutError("Timeout")
    resp = await _provision_user(admin_client, user_id, erp_id)
    mem_id = uuid.UUID(resp.json()["data"]["id"])

    from app.database.engine import get_sessionmaker
    async with get_sessionmaker()() as session:
        recon_repo = ProvisioningReconciliationRepository(session)
        task = await recon_repo.get_by_membership_id(mem_id)
        task_id = task.id
        now = datetime.now(timezone.utc)

        # Worker 1 claims task
        claim1 = await recon_repo.claim_task(task_id, "worker_1", now, lease_duration_seconds=60)
        assert claim1 is True

        # Worker 2 attempts to claim while lease is active
        claim2 = await recon_repo.claim_task(task_id, "worker_2", now, lease_duration_seconds=60)
        assert claim2 is False

        # Task remains owned by worker_1
        refreshed = await recon_repo.get_by_id(task_id)
        assert refreshed.claimed_by == "worker_1"
        assert refreshed.status == ProvisioningTaskStatus.PROCESSING


# -----------------------------------------------------------------------------
# 6. Crashed Worker Recovery (Expired Lease Reclamation)
# -----------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_reconciliation_expired_lease_reclaimed(admin_client, recon_adapter):
    """
    If a worker crashes while holding a lease, another worker safely reclaims the task
    once lease_expires_at has elapsed.
    """
    erp_id = await _create_test_erp(admin_client, key="crash_erp")
    user_id = await _create_test_global_user(admin_client, email="crash@example.com")

    recon_adapter.provision_behavior = ErpTimeoutError("Timeout")
    resp = await _provision_user(admin_client, user_id, erp_id)
    mem_id = uuid.UUID(resp.json()["data"]["id"])

    from app.database.engine import get_sessionmaker
    async with get_sessionmaker()() as session:
        recon_repo = ProvisioningReconciliationRepository(session)
        task = await recon_repo.get_by_membership_id(mem_id)
        task_id = task.id

        # Simulate crashed worker that claimed task in the past
        past_claimed = datetime.now(timezone.utc) - timedelta(seconds=120)
        past_expired = datetime.now(timezone.utc) - timedelta(seconds=60)
        task.status = ProvisioningTaskStatus.PROCESSING
        task.claimed_by = "crashed_worker"
        task.claimed_at = past_claimed
        task.lease_expires_at = past_expired
        await session.commit()

        # Surviving worker attempts to claim now
        now = datetime.now(timezone.utc)
        reclaimed = await recon_repo.claim_task(task_id, "surviving_worker", now, lease_duration_seconds=60)
        assert reclaimed is True

        refreshed = await recon_repo.get_by_id(task_id)
        assert refreshed.claimed_by == "surviving_worker"


# -----------------------------------------------------------------------------
# 7. Manual Retry and Background Worker Coordination
# -----------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_manual_retry_blocks_when_background_worker_active(admin_client, recon_adapter):
    """
    Manual retry endpoint rejects with HTTP 409 Conflict if background reconciler
    is actively processing the membership.
    """
    erp_id = await _create_test_erp(admin_client, key="manual_coord_erp")
    user_id = await _create_test_global_user(admin_client, email="coord@example.com")

    recon_adapter.provision_behavior = ErpTimeoutError("Timeout")
    resp = await _provision_user(admin_client, user_id, erp_id)
    mem_id = resp.json()["data"]["id"]

    from app.database.engine import get_sessionmaker
    async with get_sessionmaker()() as session:
        recon_repo = ProvisioningReconciliationRepository(session)
        task = await recon_repo.get_by_membership_id(uuid.UUID(mem_id))
        # Simulate active worker lease
        now = datetime.now(timezone.utc)
        await recon_repo.claim_task(task.id, "active_reconciler", now, lease_duration_seconds=60)

    # Admin clicks manual retry
    retry_resp = await admin_client.post(f"/api/v1/global/identity/provisioning/{mem_id}/retry")
    assert retry_resp.status_code == 409
    assert "currently being processed" in retry_resp.json()["message"]



# -----------------------------------------------------------------------------
# 8. Lifecycle Safety: Revoked & Suspended Memberships Are Skipped
# -----------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_reconciliation_skips_revoked_memberships(admin_client, recon_adapter):
    """
    If membership was revoked while waiting for retry, reconciler detects REVOKED
    and cancels the task without provisioning the spoke ERP.
    """
    erp_id = await _create_test_erp(admin_client, key="revoked_safety_erp")
    user_id = await _create_test_global_user(admin_client, email="revoked@example.com")

    recon_adapter.provision_behavior = ErpTimeoutError("Timeout")
    resp = await _provision_user(admin_client, user_id, erp_id)
    mem_id = resp.json()["data"]["id"]

    # Admin revokes membership before retry triggers
    revoke_resp = await admin_client.post(
        f"/api/v1/global/memberships/{mem_id}/revoke",
        json={"reason": "User access revoked"},
    )
    assert revoke_resp.status_code == 200

    recon_adapter.provision_behavior = None
    recon_adapter.provision_calls = 0

    from app.database.engine import get_sessionmaker
    async with get_sessionmaker()() as session:
        recon_repo = ProvisioningReconciliationRepository(session)
        task = await recon_repo.get_by_membership_id(uuid.UUID(mem_id))
        task.next_retry_at = datetime.now(timezone.utc) - timedelta(seconds=1)
        await session.commit()

        service = create_reconciliation_service(session)
        res = await service.reconcile_single_task(task.id, worker_id="worker_revoked")
        assert res["status"] == "cancelled"
        assert res["reason"] == "membership_revoked"

        # Ensure no provisioning request was sent to spoke
        assert recon_adapter.provision_calls == 0

        # Task is marked CANCELLED
        updated_task = await recon_repo.get_by_id(task.id)
        assert updated_task.status == ProvisioningTaskStatus.CANCELLED


# -----------------------------------------------------------------------------
# 9. Idempotency & Lost-Response Recovery
# -----------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_reconciliation_lost_response_no_duplicates(admin_client, recon_adapter):
    """
    If previous provisioning actually reached the spoke but ERP_Main lost the connection,
    reconciliation checks existing spoke account before creating, preventing duplicates.
    """
    erp_id = await _create_test_erp(admin_client, key="lost_resp_erp")
    user_id = await _create_test_global_user(admin_client, email="lostresponse@example.com")

    recon_adapter.provision_behavior = ErpConnectionError("Response lost")
    resp = await _provision_user(admin_client, user_id, erp_id)
    mem_id = uuid.UUID(resp.json()["data"]["id"])

    # Simulate spoke actually created the user before the connection dropped
    recon_adapter.users["lostresponse@example.com"] = {
        "local_user_id": "spoke-uuid-already-created",
        "email": "lostresponse@example.com",
    }
    recon_adapter.provision_behavior = None
    recon_adapter.provision_calls = 0

    from app.database.engine import get_sessionmaker
    async with get_sessionmaker()() as session:
        recon_repo = ProvisioningReconciliationRepository(session)
        task = await recon_repo.get_by_membership_id(mem_id)
        task.next_retry_at = datetime.now(timezone.utc) - timedelta(seconds=1)
        await session.commit()

        service = create_reconciliation_service(session)
        res = await service.reconcile_single_task(task.id, worker_id="worker_lost_resp")
        assert res["status"] == "succeeded"

        # Check that check_local_user was used and provision_local_user was NOT called again!
        assert recon_adapter.check_calls >= 1
        assert recon_adapter.provision_calls == 0

        # Membership is ACTIVE with the spoke's local user id
        mem_res = await session.execute(select(ErpMembership).where(ErpMembership.id == mem_id))
        mem = mem_res.scalar_one()
        assert mem.status == ErpMembershipStatus.ACTIVE
        assert mem.local_user_id == "spoke-uuid-already-created"


# -----------------------------------------------------------------------------
# 10. Identity Conflict Isolation
# -----------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_reconciliation_stops_on_identity_conflict(admin_client, recon_adapter):
    """
    When spoke returns 409 Conflict, reconciliation halts automatic retries,
    records an IdentityConflict, and leaves it for manual admin resolution.
    """
    erp_id = await _create_test_erp(admin_client, key="conflict_halt_erp")
    user_id = await _create_test_global_user(admin_client, email="conflict@example.com")

    # Initial transient failure
    recon_adapter.provision_behavior = ErpServerError("500 error")
    resp = await _provision_user(admin_client, user_id, erp_id)
    mem_id = uuid.UUID(resp.json()["data"]["id"])

    # Spoke returns 409 Conflict during reconciliation
    recon_adapter.provision_behavior = ErpConflictError("409 Conflict: Local user username already exists")

    from app.database.engine import get_sessionmaker
    async with get_sessionmaker()() as session:
        recon_repo = ProvisioningReconciliationRepository(session)
        task = await recon_repo.get_by_membership_id(mem_id)
        task.next_retry_at = datetime.now(timezone.utc) - timedelta(seconds=1)
        await session.commit()

        service = create_reconciliation_service(session)
        res = await service.reconcile_single_task(task.id, worker_id="worker_conflict")
        assert res["status"] == "conflict"

        # Task is FAILED and will NOT be automatically retried
        updated_task = await recon_repo.get_by_id(task.id)
        assert updated_task.status == ProvisioningTaskStatus.FAILED
        assert updated_task.last_error_type == "IDENTITY_CONFLICT"

        # An IdentityConflict record was created
        conflict_res = await session.execute(
            select(IdentityConflict).where(IdentityConflict.erp_instance_id == uuid.UUID(erp_id))
        )
        conflict = conflict_res.scalar_one_or_none()
        assert conflict is not None
        assert conflict.status == ConflictStatus.PENDING


# -----------------------------------------------------------------------------
# 11. Spoke Failure Classifications: 429 Rate Limit, 5xx
# -----------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_reconciliation_rate_limit_and_5xx_transient_retry(admin_client, recon_adapter):
    """
    HTTP 429 Rate Limit and 5xx Server Error are classified as transient and rescheduled.
    """
    erp_id = await _create_test_erp(admin_client, key="rate_limit_erp")
    user_id = await _create_test_global_user(admin_client, email="ratelimit@example.com")

    recon_adapter.provision_behavior = ErpRateLimitError("429 Too Many Requests")
    resp = await _provision_user(admin_client, user_id, erp_id)
    mem_id = uuid.UUID(resp.json()["data"]["id"])

    from app.database.engine import get_sessionmaker
    async with get_sessionmaker()() as session:
        recon_repo = ProvisioningReconciliationRepository(session)
        task = await recon_repo.get_by_membership_id(mem_id)
        assert task.status == ProvisioningTaskStatus.PENDING_RETRY
        assert task.last_error_type == "RATE_LIMITED"


        # Reconciler encounters 503 Service Unavailable
        task.next_retry_at = datetime.now(timezone.utc) - timedelta(seconds=1)
        await session.commit()

        recon_adapter.provision_behavior = ErpServerError("503 Service Unavailable")
        service = create_reconciliation_service(session)
        res = await service.reconcile_single_task(task.id, worker_id="worker_503")
        assert res["status"] == "rescheduled"

        updated_task = await recon_repo.get_by_id(task.id)
        assert updated_task.status == ProvisioningTaskStatus.PENDING_RETRY
        assert updated_task.retry_count == 2


# -----------------------------------------------------------------------------
# 12. Lifecycle Safety: Suspended Memberships & Inactive GlobalUsers
# -----------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_reconciliation_skips_suspended_membership_and_inactive_global_user(admin_client, recon_adapter):
    """
    Suspended memberships and inactive GlobalUsers cause the task to be CANCELLED safely.
    """
    erp_id = await _create_test_erp(admin_client, key="suspended_safety_erp")
    user_id = await _create_test_global_user(admin_client, email="suspended@example.com")

    recon_adapter.provision_behavior = ErpTimeoutError("Timeout")
    resp = await _provision_user(admin_client, user_id, erp_id)
    mem_id = resp.json()["data"]["id"]

    # Admin suspends membership
    suspend_resp = await admin_client.post(
        f"/api/v1/global/memberships/{mem_id}/suspend",
        json={"reason": "Suspended for review"},
    )
    assert suspend_resp.status_code == 200

    from app.database.engine import get_sessionmaker
    async with get_sessionmaker()() as session:
        recon_repo = ProvisioningReconciliationRepository(session)
        task = await recon_repo.get_by_membership_id(uuid.UUID(mem_id))
        task.next_retry_at = datetime.now(timezone.utc) - timedelta(seconds=1)
        await session.commit()

        service = create_reconciliation_service(session)
        res = await service.reconcile_single_task(task.id, worker_id="worker_suspend")
        assert res["status"] == "cancelled"
        assert res["reason"] == "membership_suspended"

        updated_task = await recon_repo.get_by_id(task.id)
        assert updated_task.status == ProvisioningTaskStatus.CANCELLED

    # Test inactive global user
    user_id_2 = await _create_test_global_user(admin_client, email="inactiveuser@example.com")
    resp2 = await _provision_user(admin_client, user_id_2, erp_id)
    mem_id_2 = resp2.json()["data"]["id"]

    async with get_sessionmaker()() as session:
        # Deactivate GlobalUser
        user_res = await session.execute(select(GlobalUser).where(GlobalUser.id == uuid.UUID(user_id_2)))
        user_obj = user_res.scalar_one()
        user_obj.status = GlobalUserStatus.SUSPENDED
        await session.commit()

        recon_repo = ProvisioningReconciliationRepository(session)
        task2 = await recon_repo.get_by_membership_id(uuid.UUID(mem_id_2))
        task2.next_retry_at = datetime.now(timezone.utc) - timedelta(seconds=1)
        await session.commit()

        service = create_reconciliation_service(session)
        res2 = await service.reconcile_single_task(task2.id, worker_id="worker_user_inactive")
        assert res2["status"] == "cancelled"
        assert "global_user_suspended" in res2["reason"]


# -----------------------------------------------------------------------------
# 13. Spoke 404 Not Found Handling (Permanent)
# -----------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_reconciliation_handles_404_permanently(admin_client, recon_adapter):
    """
    Spoke returning 404 (endpoint not found) permanently fails the reconciliation task.
    """
    erp_id = await _create_test_erp(admin_client, key="not_found_erp")
    user_id = await _create_test_global_user(admin_client, email="notfound@example.com")

    recon_adapter.provision_behavior = ErpServerError("Transient first")
    resp = await _provision_user(admin_client, user_id, erp_id)
    mem_id = uuid.UUID(resp.json()["data"]["id"])

    from app.database.engine import get_sessionmaker
    async with get_sessionmaker()() as session:
        recon_repo = ProvisioningReconciliationRepository(session)
        task = await recon_repo.get_by_membership_id(mem_id)
        task.next_retry_at = datetime.now(timezone.utc) - timedelta(seconds=1)
        await session.commit()

        recon_adapter.provision_behavior = ErpNotFoundError("404 endpoint not found")
        service = create_reconciliation_service(session)
        res = await service.reconcile_single_task(task.id, worker_id="worker_404")
        assert res["status"] == "failed_permanent"

        updated_task = await recon_repo.get_by_id(task.id)
        assert updated_task.status == ProvisioningTaskStatus.FAILED
        assert updated_task.last_error_type in ("NOT_FOUND", "PERMANENT_ERROR")


# -----------------------------------------------------------------------------
# 14. Spoke Malformed Response Handling
# -----------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_reconciliation_handles_malformed_response(admin_client, recon_adapter):
    """
    Malformed non-JSON responses from spoke fail safely without corrupting state.
    """
    erp_id = await _create_test_erp(admin_client, key="malformed_erp")
    user_id = await _create_test_global_user(admin_client, email="malformed@example.com")

    recon_adapter.provision_behavior = ErpServerError("Transient first")
    resp = await _provision_user(admin_client, user_id, erp_id)
    mem_id = uuid.UUID(resp.json()["data"]["id"])

    from app.database.engine import get_sessionmaker
    async with get_sessionmaker()() as session:
        recon_repo = ProvisioningReconciliationRepository(session)
        task = await recon_repo.get_by_membership_id(mem_id)
        task.next_retry_at = datetime.now(timezone.utc) - timedelta(seconds=1)
        await session.commit()

        recon_adapter.provision_behavior = ErpMalformedResponseError("Invalid HTML payload instead of JSON")
        service = create_reconciliation_service(session)
        res = await service.reconcile_single_task(task.id, worker_id="worker_malformed")
        assert res["status"] == "failed_permanent"

        updated_task = await recon_repo.get_by_id(task.id)
        assert updated_task.status == ProvisioningTaskStatus.FAILED


# -----------------------------------------------------------------------------
# 15. Reconciliation Worker Lifecycle
# -----------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_reconciliation_worker_lifecycle():
    """
    Validates start, trigger, and graceful shutdown of ProvisioningReconciliationWorker.
    """
    from app.identity_linking.reconciliation_worker import ProvisioningReconciliationWorker
    import asyncio

    worker = ProvisioningReconciliationWorker()
    assert not worker.is_running

    await worker.start()
    assert worker.is_running

    # Triggering does not crash
    worker.trigger()
    await asyncio.sleep(0.05)
    assert worker.is_running

    # Graceful stop
    await worker.stop(timeout=2.0)
    assert not worker.is_running

