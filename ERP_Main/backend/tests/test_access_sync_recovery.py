"""
Reliability of central access removal.

When ERP_Main suspends/disables/revokes someone but the target ERP cannot be told
(asleep, offline, rejecting), the decision must NOT be lost: it is stored durably and
retried until the ERP confirms.  A retry must never grant access to someone who has
since been disabled.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

import pytest
from sqlalchemy import select

import app.database.engine as engine_module
from app.global_audit.models import AuditEventType, GlobalAuditLog
from app.global_audit.repository import GlobalAuditRepository
from app.global_audit.service import GlobalAuditService
from app.identity_linking.access_sync_service import AccessSyncService
from app.identity_linking.adapters.registry import get_adapter_registry
from app.identity_linking.models import AccessSyncStatus, AccessSyncTask


class FlakyAdapter:
    """Pretends to be an ERP that can be switched on/off; records every access change it accepts."""

    def __init__(self) -> None:
        self.up = True
        self.calls: list[tuple[str, bool]] = []
        self.access: dict[str, bool] = {}

    async def set_local_user_access(self, erp, local_user_id: str, *, allow_login: bool, reason=None) -> dict[str, Any] | None:
        if not self.up:
            return None  # same soft-fail contract as the real HTTP adapter
        self.calls.append((local_user_id, allow_login))
        self.access[local_user_id] = allow_login
        return {"allow_login": allow_login}

    async def deprovision_local_user(self, erp, local_user_id: str, *, reason=None):
        return {"status": "REMOVED"} if self.up else None


@pytest.fixture(autouse=True)
def flaky():
    registry = get_adapter_registry()
    adapter = FlakyAdapter()
    original = registry.get_adapter
    registry.get_adapter = lambda erp: adapter
    yield adapter
    registry.get_adapter = original


async def _setup(admin_client, email: str, erp_key: str, local_id: str):
    u = await admin_client.post("/api/v1/global/users", json={"display_name": "U", "primary_email": email})
    uid = u.json()["data"]["id"]
    e = await admin_client.post(
        "/api/v1/global/erps",
        json={"key": erp_key, "name": erp_key, "display_name": erp_key, "status": "ACTIVE",
              "base_url": f"https://{erp_key}.example.internal"},
    )
    erp_id = e.json()["data"]["id"]
    m = await admin_client.post(f"/api/v1/global/users/{uid}/memberships/{erp_id}", json={"local_user_id": local_id})
    mid = m.json()["data"]["id"]
    await admin_client.post(f"/api/v1/global/memberships/{mid}/verify")
    return uid, mid


async def _task(mid) -> AccessSyncTask | None:
    async with engine_module._sessionmaker() as s:
        return await s.scalar(select(AccessSyncTask).where(AccessSyncTask.membership_id == __import__("uuid").UUID(mid)))


async def _make_due(mid) -> None:
    async with engine_module._sessionmaker() as s:
        t = await s.scalar(select(AccessSyncTask).where(AccessSyncTask.membership_id == __import__("uuid").UUID(mid)))
        t.next_retry_at = datetime.now(timezone.utc) - timedelta(seconds=1)
        await s.commit()


async def _sweep() -> int:
    async with engine_module._sessionmaker() as s:
        svc = AccessSyncService(s, GlobalAuditService(GlobalAuditRepository(s)), get_adapter_registry())
        return await svc.run_batch("test-worker")


@pytest.mark.asyncio
async def test_successful_sync_leaves_no_pending_task(admin_client, flaky):
    _, mid = await _setup(admin_client, "ok1@example.com", "erp_ok1", "loc-ok1")
    r = await admin_client.post(f"/api/v1/global/memberships/{mid}/suspend", json={"reason": "test"})
    assert r.status_code == 200
    assert flaky.access["loc-ok1"] is False
    t = await _task(mid)
    assert t is None or t.status == AccessSyncStatus.SUCCEEDED


@pytest.mark.asyncio
async def test_suspend_while_erp_down_is_not_lost_and_recovers(admin_client, flaky):
    _, mid = await _setup(admin_client, "down1@example.com", "erp_down1", "loc-d1")
    flaky.up = False
    r = await admin_client.post(f"/api/v1/global/memberships/{mid}/suspend", json={"reason": "test"})
    assert r.status_code == 200 and r.json()["data"]["status"] == "SUSPENDED"

    t = await _task(mid)
    assert t is not None and t.status == AccessSyncStatus.PENDING_RETRY  # remembered, not dropped
    assert "loc-d1" not in flaky.access  # the ERP genuinely never heard about it

    flaky.up = True  # ERP wakes up
    await _make_due(mid)
    assert await _sweep() == 1
    assert flaky.access["loc-d1"] is False  # the removal finally reached the ERP
    assert (await _task(mid)).status == AccessSyncStatus.SUCCEEDED


@pytest.mark.asyncio
async def test_retry_backs_off_while_erp_stays_down(admin_client, flaky):
    _, mid = await _setup(admin_client, "down2@example.com", "erp_down2", "loc-d2")
    flaky.up = False
    await admin_client.post(f"/api/v1/global/memberships/{mid}/suspend", json={"reason": "test"})
    await _make_due(mid)
    before = datetime.now(timezone.utc)
    assert await _sweep() == 1
    t = await _task(mid)
    assert t.status == AccessSyncStatus.PENDING_RETRY and t.retry_count == 1
    nxt = t.next_retry_at if t.next_retry_at.tzinfo else t.next_retry_at.replace(tzinfo=timezone.utc)
    assert nxt > before  # scheduled into the future, not hammered every sweep
    assert await _sweep() == 0  # not due yet


@pytest.mark.asyncio
async def test_recovery_never_restores_a_user_who_was_disabled_meanwhile(admin_client, flaky):
    uid, mid = await _setup(admin_client, "race@example.com", "erp_race", "loc-race")
    flaky.up = False
    await admin_client.post(f"/api/v1/global/memberships/{mid}/suspend", json={"reason": "test"})
    await admin_client.post(f"/api/v1/global/memberships/{mid}/restore", json={"reason": "test"})  # admin changes their mind (ERP still down)
    t = await _task(mid)
    assert t.requested_allow_login is True  # latest intent was "allow"

    r = await admin_client.patch(f"/api/v1/global/users/{uid}/status", json={"status": "DISABLED"})
    assert r.status_code == 200  # ...then the whole user is disabled centrally

    flaky.up = True
    await _make_due(mid)
    await _sweep()
    assert flaky.access["loc-race"] is False, "a stale 'allow' must never re-enable a disabled user"


@pytest.mark.asyncio
async def test_exhausted_retries_end_in_failed_with_an_audit_event(admin_client, flaky):
    _, mid = await _setup(admin_client, "fail@example.com", "erp_fail", "loc-f")
    flaky.up = False
    await admin_client.post(f"/api/v1/global/memberships/{mid}/suspend", json={"reason": "test"})
    async with engine_module._sessionmaker() as s:
        t = await s.scalar(select(AccessSyncTask).where(AccessSyncTask.membership_id == __import__("uuid").UUID(mid)))
        t.max_retries = 1
        await s.commit()
    await _make_due(mid)
    await _sweep()
    assert (await _task(mid)).status == AccessSyncStatus.FAILED
    async with engine_module._sessionmaker() as s:
        ev = (await s.scalars(select(GlobalAuditLog).where(GlobalAuditLog.event_type == AuditEventType.ACCESS_SYNC_FAILED))).all()
    assert len(ev) == 1


@pytest.mark.asyncio
async def test_only_one_worker_can_claim_a_task(admin_client, flaky):
    _, mid = await _setup(admin_client, "lease@example.com", "erp_lease", "loc-l")
    flaky.up = False
    await admin_client.post(f"/api/v1/global/memberships/{mid}/suspend", json={"reason": "test"})
    await _make_due(mid)
    t = await _task(mid)
    now = datetime.now(timezone.utc)
    async with engine_module._sessionmaker() as s1, engine_module._sessionmaker() as s2:
        a = AccessSyncService(s1, GlobalAuditService(GlobalAuditRepository(s1)), get_adapter_registry())
        b = AccessSyncService(s2, GlobalAuditService(GlobalAuditRepository(s2)), get_adapter_registry())
        assert await a._claim(t.id, "w1", now) is True
        assert await b._claim(t.id, "w2", now) is False
