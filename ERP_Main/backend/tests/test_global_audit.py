"""Regression tests for Global Audit Log listing without artificial row caps."""

from __future__ import annotations

import pytest

from app.database.session import get_db_session
from app.global_audit.models import AuditActorType, AuditEventType, GlobalAuditLog


@pytest.mark.asyncio
async def test_list_audit_entries_returns_all_rows_by_default(super_admin_client):
    """GET /api/v1/global/audit returns all DB audit rows when no limit query parameter is passed."""
    gen = get_db_session()
    db = await anext(gen)
    db.add_all(
        [
            GlobalAuditLog(
                event_type=AuditEventType.GLOBAL_LOGIN_SUCCESS,
                actor_type=AuditActorType.SYSTEM,
                actor_label=f"user-{idx}@example.com",
                target_type="global_session",
            )
            for idx in range(250)
        ]
    )
    try:
        await anext(gen)
    except StopAsyncIteration:
        pass

    resp = await super_admin_client.get("/api/v1/global/audit")
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert len(data) >= 252  # 250 seeded + bootstrap admin creation + login

    limited_resp = await super_admin_client.get("/api/v1/global/audit", params={"limit": 10})
    assert limited_resp.status_code == 200
    assert len(limited_resp.json()["data"]) == 10

