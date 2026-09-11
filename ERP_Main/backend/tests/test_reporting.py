"""
Global Reporting / Search Tests (Phase 7).

Covers: event-driven projection consumption + idempotency (Section
64), authorization-scoped search (Section 12/13/52/62 -- the most
security-critical property this phase introduces: an empty
authorization scope must yield zero results, never "everything"), the
platform dashboard and per-ERP health (Section 14/15/35), reconciliation
(Section 48/65), projection rebuild (Section 23), and export permission
gating (Section 25/26/66).
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

import pytest

pytestmark = pytest.mark.asyncio


async def _create_role(admin_client, *, role_key: str, permission_keys: list[str]):
    """Create a role and grant it the given permissions. Returns role dict."""
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
        "/api/v1/global/user-auth/register", json={"display_name": "Test User", "email": email, "password": password}
    )
    assert register_resp.status_code == 201, register_resp.text
    user_id = register_resp.json()["data"]["id"]
    login_resp = await client.post("/api/v1/global/user-auth/login", json={"email": email, "password": password})
    assert login_resp.status_code == 200, login_resp.text
    return user_id, login_resp.json()["data"]["access_token"]


async def _create_erp(admin_client, *, key: str, status: str = "ACTIVE"):
    """Create an ERP instance and return its id."""
    resp = await admin_client.post(
        "/api/v1/global/erps", json={"key": key, "name": key, "display_name": key, "status": status}
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["data"]["id"]


async def _issue_credential(admin_client, erp_id: str) -> str:
    """Issue a service credential for an ERP and return its plaintext bearer_token."""
    resp = await admin_client.post(f"/api/v1/global/erps/{erp_id}/credentials", json={})
    assert resp.status_code == 201, resp.text
    return resp.json()["data"]["bearer_token"]


async def _add_active_membership(admin_client, *, user_id: str, erp_id: str, local_user_id: str = "local-1") -> None:
    """Link a GlobalUser to an ERP and immediately verify (ACTIVE) the membership."""
    create_resp = await admin_client.post(
        f"/api/v1/global/users/{user_id}/memberships/{erp_id}", json={"local_user_id": local_user_id}
    )
    assert create_resp.status_code == 201, create_resp.text
    membership_id = create_resp.json()["data"]["id"]
    verify_resp = await admin_client.post(f"/api/v1/global/memberships/{membership_id}/verify")
    assert verify_resp.status_code == 200, verify_resp.text


async def _ingest_buyer_created(
    client, *, source_erp_key: str, token: str, company_name: str, buyer_id: str | None = None
):
    """Ingest one buyer.created event as an authenticated producer ERP. Returns the envelope used."""
    envelope = {
        "event_id": str(uuid.uuid4()),
        "event_type": "buyer.created",
        "event_version": 1,
        "occurred_at": datetime.now(timezone.utc).isoformat(),
        "source_erp": source_erp_key,
        "source_entity_type": "buyer",
        "source_entity_id": buyer_id or str(uuid.uuid4()),
        "correlation_id": str(uuid.uuid4()),
        "causation_id": None,
        "actor_type": "user",
        "actor_id": str(uuid.uuid4()),
        "target": "broadcast",
        "payload": {"buyer_id": "x", "company_name": company_name, "status": "active"},
        "metadata": {},
    }
    client.headers["Authorization"] = f"Bearer {token}"
    resp = await client.post("/api/v1/internal/integration/events", json=envelope)
    assert resp.status_code == 201, resp.text
    return envelope


async def test_rebuild_projects_buyer_created_events(admin_client, client):
    """Rebuilding the projection picks up an ingested buyer.created event and creates a projection row."""
    erp_id = await _create_erp(admin_client, key="proj_erp1")
    token = await _issue_credential(admin_client, erp_id)
    await _ingest_buyer_created(client, source_erp_key="proj_erp1", token=token, company_name="Acme Corp")

    rebuild_resp = await admin_client.post("/api/v1/global/projections/buyers/rebuild")
    assert rebuild_resp.status_code == 200, rebuild_resp.text
    assert rebuild_resp.json()["data"]["processed"] >= 1

    search_resp = await admin_client.get("/api/v1/global/search/buyers", params={"q": "Acme"})
    assert search_resp.status_code == 200
    names = [r["company_name"] for r in search_resp.json()["data"]["results"]]
    assert "Acme Corp" in names


async def test_duplicate_event_does_not_duplicate_projection(admin_client, client):
    """The same source entity projected twice yields exactly one projection row, with the latest data."""
    erp_id = await _create_erp(admin_client, key="proj_erp2")
    token = await _issue_credential(admin_client, erp_id)
    buyer_id = str(uuid.uuid4())

    await _ingest_buyer_created(
        client, source_erp_key="proj_erp2", token=token, company_name="DupCo", buyer_id=buyer_id
    )
    await admin_client.post("/api/v1/global/projections/buyers/rebuild")

    await _ingest_buyer_created(
        client, source_erp_key="proj_erp2", token=token, company_name="DupCo Renamed", buyer_id=buyer_id
    )
    await admin_client.post("/api/v1/global/projections/buyers/rebuild")

    search_resp = await admin_client.get("/api/v1/global/search/buyers", params={"q": "DupCo"})
    results = search_resp.json()["data"]["results"]
    assert len(results) == 1
    assert results[0]["company_name"] == "DupCo Renamed"


async def test_projection_rebuild_requires_permission(client):
    """Rebuilding the projection without authentication is rejected."""
    resp = await client.post("/api/v1/global/projections/buyers/rebuild")
    assert resp.status_code in (401, 403)


async def test_global_user_with_no_membership_sees_zero_results(admin_client, client):
    """A GlobalUser with NO ERP membership and NO platform grant sees zero search results, never everything."""
    erp_id = await _create_erp(admin_client, key="scope_erp1")
    token = await _issue_credential(admin_client, erp_id)
    await _ingest_buyer_created(client, source_erp_key="scope_erp1", token=token, company_name="Hidden Co")
    await admin_client.post("/api/v1/global/projections/buyers/rebuild")

    user_id, user_token = await _register_global_user_and_login(client, email="noscope1@example.com")
    client.headers["Authorization"] = f"Bearer {user_token}"
    resp = await client.get("/api/v1/global/search/buyers", params={"q": "Hidden"})
    assert resp.status_code == 200
    assert resp.json()["data"]["results"] == []
    assert resp.json()["data"]["total"] == 0


async def test_global_user_with_membership_sees_only_that_erp(admin_client, client):
    """A GlobalUser with an ACTIVE membership in ERP A sees ERP A's data but not ERP B's."""
    erp_a_id = await _create_erp(admin_client, key="scope_erp_a")
    erp_b_id = await _create_erp(admin_client, key="scope_erp_b")
    token_a = await _issue_credential(admin_client, erp_a_id)
    token_b = await _issue_credential(admin_client, erp_b_id)

    await _ingest_buyer_created(client, source_erp_key="scope_erp_a", token=token_a, company_name="VisibleCo")
    await _ingest_buyer_created(client, source_erp_key="scope_erp_b", token=token_b, company_name="InvisibleCo")
    await admin_client.post("/api/v1/global/projections/buyers/rebuild")

    user_id, user_token = await _register_global_user_and_login(client, email="scoped1@example.com")
    await _add_active_membership(admin_client, user_id=user_id, erp_id=erp_a_id)

    client.headers["Authorization"] = f"Bearer {user_token}"
    resp = await client.get("/api/v1/global/search/buyers")
    names = [r["company_name"] for r in resp.json()["data"]["results"]]
    assert "VisibleCo" in names
    assert "InvisibleCo" not in names


async def test_global_scoped_platform_permission_sees_every_erp(admin_client, client):
    """A GlobalUser with a GLOBAL-scoped platform.search.read grant sees every ERP, with no memberships needed."""
    erp_id = await _create_erp(admin_client, key="scope_erp_global")
    token = await _issue_credential(admin_client, erp_id)
    await _ingest_buyer_created(
        client, source_erp_key="scope_erp_global", token=token, company_name="GlobalVisibleCo"
    )
    await admin_client.post("/api/v1/global/projections/buyers/rebuild")

    await _create_role(admin_client, role_key="SEARCH_ALL", permission_keys=["platform.search.read"])
    user_id, user_token = await _register_global_user_and_login(client, email="globalsearch1@example.com")
    await admin_client.post(
        f"/api/v1/global/authz/users/{user_id}/roles", json={"role_key": "SEARCH_ALL", "scope": "GLOBAL"}
    )

    client.headers["Authorization"] = f"Bearer {user_token}"
    resp = await client.get("/api/v1/global/search/buyers", params={"q": "GlobalVisibleCo"})
    names = [r["company_name"] for r in resp.json()["data"]["results"]]
    assert "GlobalVisibleCo" in names


async def test_platform_admin_sees_every_erp(admin_client, client):
    """A PlatformAdmin's own search sees every ERP without needing any membership or platform grant."""
    erp_id = await _create_erp(admin_client, key="scope_erp_admin")
    token = await _issue_credential(admin_client, erp_id)
    await _ingest_buyer_created(client, source_erp_key="scope_erp_admin", token=token, company_name="AdminVisibleCo")
    await admin_client.post("/api/v1/global/projections/buyers/rebuild")

    resp = await admin_client.get("/api/v1/global/search/buyers", params={"q": "AdminVisibleCo"})
    names = [r["company_name"] for r in resp.json()["data"]["results"]]
    assert "AdminVisibleCo" in names


async def test_unauthenticated_search_rejected(client):
    """Search requires authentication."""
    resp = await client.get("/api/v1/global/search/buyers")
    assert resp.status_code in (401, 403)


async def test_search_pagination(admin_client):
    """Search respects limit/offset."""
    resp = await admin_client.get("/api/v1/global/search/buyers", params={"limit": 1, "offset": 0})
    assert resp.status_code == 200
    assert resp.json()["data"]["limit"] == 1
    assert resp.json()["data"]["offset"] == 0
    assert len(resp.json()["data"]["results"]) <= 1


async def test_dashboard_requires_authentication(client):
    """The dashboard requires authentication."""
    resp = await client.get("/api/v1/global/dashboard")
    assert resp.status_code in (401, 403)


async def test_dashboard_reflects_registered_erps(admin_client):
    """The dashboard's total_erps grows when a new ERP is registered."""
    before = await admin_client.get("/api/v1/global/dashboard")
    before_total = before.json()["data"]["total_erps"]

    await _create_erp(admin_client, key="dash_erp1")

    after = await admin_client.get("/api/v1/global/dashboard")
    assert after.json()["data"]["total_erps"] == before_total + 1


async def test_erp_health_for_unknown_erp_returns_404(admin_client):
    """Requesting health for a nonexistent ERP id returns 404."""
    resp = await admin_client.get(f"/api/v1/global/health/erps/{uuid.uuid4()}")
    assert resp.status_code == 404


async def test_erp_health_reflects_capabilities(admin_client):
    """An ERP's health summary lists its declared, enabled capabilities."""
    erp_id = await _create_erp(admin_client, key="health_erp1")
    await admin_client.post(
        f"/api/v1/global/erps/{erp_id}/modules", json={"module_key": "buyers", "module_name": "Buyers"}
    )

    resp = await admin_client.get(f"/api/v1/global/health/erps/{erp_id}")
    assert resp.status_code == 200
    assert "buyers" in resp.json()["data"]["enabled_capabilities"]


async def test_erp_health_unknown_status_when_never_seen(admin_client):
    """An ERP that has never sent a heartbeat shows UNKNOWN api_health, not a false HEALTHY."""
    erp_id = await _create_erp(admin_client, key="health_erp2")
    resp = await admin_client.get(f"/api/v1/global/health/erps/{erp_id}")
    assert resp.json()["data"]["api_health"] == "UNKNOWN"


async def test_reconciliation_requires_specific_permission(client):
    """Reconciliation is rejected for an unauthenticated caller."""
    resp = await client.post(f"/api/v1/global/reconciliation/erps/{uuid.uuid4()}")
    assert resp.status_code in (401, 403)


async def test_reconciliation_for_unknown_erp_returns_404(admin_client):
    """Reconciling a nonexistent ERP id returns 404."""
    resp = await admin_client.post(f"/api/v1/global/reconciliation/erps/{uuid.uuid4()}")
    assert resp.status_code == 404


async def test_reconciliation_reports_projection_count_honestly(admin_client, client):
    """Reconciliation reports the actual projection count and an honest UNKNOWN status (no fabricated match)."""
    erp_id = await _create_erp(admin_client, key="recon_erp1")
    token = await _issue_credential(admin_client, erp_id)
    await _ingest_buyer_created(client, source_erp_key="recon_erp1", token=token, company_name="ReconCo")
    await admin_client.post("/api/v1/global/projections/buyers/rebuild")

    resp = await admin_client.post(f"/api/v1/global/reconciliation/erps/{erp_id}")
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["projection_count"] >= 1
    assert data["outbox_published_count"] is None
    assert data["status"] == "UNKNOWN"


async def test_export_requires_specific_permission(client):
    """Requesting an export without authentication is rejected."""
    resp = await client.post(
        "/api/v1/global/reports/export", json={"report_type": "global_buyer_summary", "export_format": "csv"}
    )
    assert resp.status_code in (401, 403)


async def test_dashboard_read_permission_does_not_grant_export(admin_client, client):
    """Holding platform.dashboard.read (view access) does NOT imply platform.report.export (Section 26)."""
    await _create_role(admin_client, role_key="DASH_VIEW_ONLY", permission_keys=["platform.dashboard.read"])
    user_id, token = await _register_global_user_and_login(client, email="dashonly1@example.com")
    await admin_client.post(
        f"/api/v1/global/authz/users/{user_id}/roles", json={"role_key": "DASH_VIEW_ONLY", "scope": "GLOBAL"}
    )

    client.headers["Authorization"] = f"Bearer {token}"
    resp = await client.post(
        "/api/v1/global/reports/export", json={"report_type": "global_buyer_summary", "export_format": "csv"}
    )
    assert resp.status_code == 403


async def test_export_with_permission_succeeds_and_is_pending(admin_client):
    """A caller holding platform.report.export can request an export, which starts PENDING."""
    resp = await admin_client.post(
        "/api/v1/global/reports/export", json={"report_type": "global_buyer_summary", "export_format": "csv"}
    )
    assert resp.status_code == 201, resp.text
    assert resp.json()["data"]["status"] == "PENDING"


async def test_export_job_owned_by_different_user_is_forbidden(admin_client, client):
    """A user cannot fetch another user's export job (Section 26: no cross-user access)."""
    await _create_role(admin_client, role_key="EXPORTER", permission_keys=["platform.report.export"])
    user_a_id, token_a = await _register_global_user_and_login(client, email="exporter_a@example.com")
    await admin_client.post(
        f"/api/v1/global/authz/users/{user_a_id}/roles", json={"role_key": "EXPORTER", "scope": "GLOBAL"}
    )

    client.headers["Authorization"] = f"Bearer {token_a}"
    create_resp = await client.post(
        "/api/v1/global/reports/export", json={"report_type": "global_buyer_summary", "export_format": "csv"}
    )
    job_id = create_resp.json()["data"]["id"]

    _user_b_id, token_b = await _register_global_user_and_login(client, email="exporter_b@example.com")
    client.headers["Authorization"] = f"Bearer {token_b}"
    get_resp = await client.get(f"/api/v1/global/reports/export/{job_id}")
    assert get_resp.status_code == 403


async def test_invalid_export_format_rejected(admin_client):
    """An export_format other than csv/xlsx is rejected at the schema layer."""
    resp = await admin_client.post(
        "/api/v1/global/reports/export", json={"report_type": "global_buyer_summary", "export_format": "pdf_exe"}
    )
    assert resp.status_code == 422


async def test_report_definitions_catalog(admin_client):
    """Catalog of available and planned report definitions is returned."""
    resp = await admin_client.get("/api/v1/global/reports/definitions")
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert len(data) >= 3
    buyer_report = next((r for r in data if r["report_key"] == "global_buyer_summary"), None)
    assert buyer_report is not None
    assert buyer_report["is_available"] is True
    assert buyer_report["status"] == "AVAILABLE"
    supplier_report = next((r for r in data if r["report_key"] == "global_supplier_summary"), None)
    assert supplier_report is not None
    assert supplier_report["is_available"] is False


async def test_list_my_export_jobs(admin_client):
    """Listing export jobs returns caller's requested export jobs."""
    await admin_client.post(
        "/api/v1/global/reports/export", json={"report_type": "global_buyer_summary", "export_format": "xlsx"}
    )
    resp = await admin_client.get("/api/v1/global/reports/export")
    assert resp.status_code == 200
    jobs = resp.json()["data"]
    assert isinstance(jobs, list)
    assert len(jobs) >= 1
    assert jobs[0]["status"] == "PENDING"


async def test_get_single_buyer_projection(admin_client):
    """Single buyer projection detail is returned with projection metadata."""
    search_resp = await admin_client.get("/api/v1/global/search/buyers")
    assert search_resp.status_code == 200
    results = search_resp.json()["data"]["results"]
    if results:
        proj_id = results[0]["id"]
        detail_resp = await admin_client.get(f"/api/v1/global/projections/buyers/{proj_id}")
        assert detail_resp.status_code == 200
        detail = detail_resp.json()["data"]
        assert detail["id"] == proj_id
        assert "last_event_id" in detail
        assert "synced_at" in detail
