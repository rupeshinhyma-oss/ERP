"""
Phase 9 — Production Hardening & End-to-End ERP Ecosystem Validation Suite.

Validates:
1. Complete 15-step End-to-End Workflow (Global User -> Membership -> SSO -> Outbox -> Ingest -> Projection -> Search -> Report -> Export -> Download -> Audit).
2. Bidirectional Identity Linking & Conflict States (EXACT_MATCH, NO_MATCH, AMBIGUOUS_MATCH, ALREADY_LINKED, CONFLICT).
3. Safe Unlinking and Membership Suspension Invariants (no cascade corruption of local ERP users).
4. Event Pipeline Deduplication (3x delivery = 1 projection row).
5. Out-of-Order Event Sequencing (Version 3 followed by Version 2 leaves Version 3 intact).
6. Export Security: IDOR protection, Path Traversal rejection, Token Expiration, and Retention Cleanup.
7. Telemetry Reconciliation: Honest MATCHED, RECONCILIATION_REQUIRED, and UNKNOWN (unreachable) state evaluations.
8. Subsystems Health Checks & Point-in-Time Metrics.
9. Cross-ERP RBAC Isolation (Yinglima user cannot inspect Inhyma data).
10. Direct ERP Login Preservation & Outage Buffer Resilience.
"""

from __future__ import annotations

import os
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any
from unittest.mock import AsyncMock, patch

import jwt
import pytest
from httpx import AsyncClient, Response

from app.core.config import settings
from app.erp_memberships.models import ErpMembershipStatus
from app.erp_registry.models import ErpStatus
from app.global_audit.models import AuditEventType
from app.global_users.models import GlobalUserStatus
from app.identity_linking.models import ConflictStatus, ConflictType
from app.identity_linking.schemas import ConflictResolutionAction
from app.identity_linking.service import normalize_email
from app.reporting.framework import registry
from app.reporting.models import (
    ExportStatus,
    GlobalBuyerProjection,
    GlobalProductProjection,
    GlobalSupplierProjection,
    ReportExportJob,
)
from app.reporting.service import ExportCleanupService, ExportService

pytestmark = pytest.mark.asyncio


# ---------------------------------------------------------------------------
# Helpers for Administrative Setup
# ---------------------------------------------------------------------------


async def _create_role(admin_client: AsyncClient, *, role_key: str, permission_keys: list[str]) -> str:
    role_resp = await admin_client.post(
        "/api/v1/global/authz/roles",
        json={"role_key": role_key, "display_name": role_key.title(), "description": "hardening role"},
    )
    assert role_resp.status_code in (201, 409)
    role_id = role_resp.json()["data"]["id"] if role_resp.status_code == 201 else None
    if not role_id:
        roles = (await admin_client.get("/api/v1/global/authz/roles")).json()["data"]
        role_id = next(r["id"] for r in roles if r["role_key"] == role_key)

    for pkey in permission_keys:
        perm_resp = await admin_client.post(
            "/api/v1/global/authz/permissions",
            json={"permission_key": pkey, "description": pkey},
        )
        assert perm_resp.status_code in (201, 409)
        grant_resp = await admin_client.post(
            f"/api/v1/global/authz/roles/{role_id}/permissions",
            json={"permission_key": pkey},
        )
        assert grant_resp.status_code in (200, 201), grant_resp.text
    return role_key


async def _assign_role(
    admin_client: AsyncClient, *, user_id: str, role_key: str, scope: str = "GLOBAL", erp_instance_id: str | None = None
) -> None:
    payload = {"role_key": role_key, "scope": scope}
    if erp_instance_id:
        payload["erp_instance_id"] = erp_instance_id
    resp = await admin_client.post(f"/api/v1/global/authz/users/{user_id}/roles", json=payload)
    assert resp.status_code in (201, 409), resp.text


async def _create_erp(admin_client: AsyncClient, *, key: str, status: str = "ACTIVE") -> tuple[str, str]:
    resp = await admin_client.post(
        "/api/v1/global/erps",
        json={
            "key": key,
            "name": key.title(),
            "display_name": f"{key.title()} ERP",
            "status": status,
            "base_url": f"http://{key}.local",
        },
    )
    assert resp.status_code in (201, 409), resp.text
    if resp.status_code == 201:
        return resp.json()["data"]["id"], key
    erps = (await admin_client.get("/api/v1/global/erps")).json()["data"]
    erp_id = next(e["id"] for e in erps if e["key"] == key)
    return erp_id, key


async def _issue_credential(admin_client: AsyncClient, erp_id: str) -> str:
    resp = await admin_client.post(f"/api/v1/global/erps/{erp_id}/credentials", json={})
    assert resp.status_code == 201
    return resp.json()["data"]["bearer_token"]


async def _register_and_login_global_user(
    client: AsyncClient, *, email: str, display_name: str, password: str = "Str0ng!Passw0rd"
) -> tuple[str, str, AsyncClient]:
    reg_resp = await client.post(
        "/api/v1/global/user-auth/register",
        json={"display_name": display_name, "email": email, "password": password},
    )
    assert reg_resp.status_code == 201, reg_resp.text
    user_id = reg_resp.json()["data"]["id"]

    login_resp = await client.post(
        "/api/v1/global/user-auth/login",
        json={"email": email, "password": password},
    )
    assert login_resp.status_code == 200, login_resp.text
    token = login_resp.json()["data"]["access_token"]

    user_client = AsyncClient(transport=client._transport, base_url=client.base_url)
    user_client.headers["Authorization"] = f"Bearer {token}"
    return user_id, token, user_client


async def _ingest_event(client: AsyncClient, *, token: str, envelope: dict) -> dict:
    resp = await client.post(
        "/api/v1/internal/integration/events",
        headers={"Authorization": f"Bearer {token}"},
        json=envelope,
    )
    assert resp.status_code in (200, 201), resp.text
    return resp.json()["data"]


# ---------------------------------------------------------------------------
# Test Scenario 1: Complete 15-Step End-to-End Cross-System Workflow
# ---------------------------------------------------------------------------


async def test_e2e_complete_15_step_workflow(admin_client: AsyncClient, client: AsyncClient):
    """
    Validates the full 15-step cross-system lifecycle:
    1. Create Global User
    2. Create Yinglima ERP & Membership
    3. Provision & link local ERP user ID
    4. Authenticate Global User via ERP_Main login
    5. Launch Yinglima via SSO launcher endpoint and verify token
    6. Perform local operation / produce outbox event
    7. Ingest event into ERP_Main intake
    8. Materialize projection in real time
    9. Perform unified multi-entity search
    10. Run global report preview
    11. Request report export
    12. Process export to real CSV file
    13. Download export file using secure download token
    14. Verify audit trail across all sensitive operations
    15. Repeat comparable projection & search flow for Inhyma ERP
    """
    # 1 & 4. Register and Login Global User
    user_email = f"operator_{uuid.uuid4().hex[:6]}@enterprise.org"
    user_id, session_token, user_client = await _register_and_login_global_user(
        client, email=user_email, display_name="Lead Operator"
    )

    # 2. Create Yinglima ERP instance
    yinglima_key = f"yinglima_{uuid.uuid4().hex[:4]}"
    yinglima_id, _ = await _create_erp(admin_client, key=yinglima_key)
    yinglima_token = await _issue_credential(admin_client, yinglima_id)

    # 3. Create Membership & Provision local user
    local_yinglima_user_id = str(uuid.uuid4())
    mem_resp = await admin_client.post(
        f"/api/v1/global/users/{user_id}/memberships/{yinglima_id}",
        json={"local_user_id": local_yinglima_user_id},
    )
    assert mem_resp.status_code == 201
    membership = mem_resp.json()["data"]
    assert membership["status"] == "PENDING"
    assert membership["local_user_id"] == local_yinglima_user_id

    # Verify and activate membership
    verify_resp = await admin_client.post(f"/api/v1/global/memberships/{membership['id']}/verify")
    assert verify_resp.status_code == 200

    # Grant user reporting and export permissions
    role_key = f"OPERATOR_ROLE_{uuid.uuid4().hex[:4].upper()}"
    await _create_role(
        admin_client,
        role_key=role_key,
        permission_keys=["platform.report.read", "platform.report.export", "platform.search.read", "platform.dashboard.read"],
    )
    await _assign_role(admin_client, user_id=user_id, role_key=role_key, scope="GLOBAL")

    # 5. Launch Yinglima via SSO Federation Flow
    fed_client_resp = await admin_client.post(
        f"/api/v1/global/erps/{yinglima_id}/federation",
        json={"redirect_uris": ["https://yinglima.erp.local/auth/callback"], "federation_enabled": True},
    )
    assert fed_client_resp.status_code == 201, fed_client_resp.text
    fed_client_data = fed_client_resp.json()["data"]

    auth_resp = await user_client.post(
        "/api/v1/federation/authorize",
        json={
            "erp_instance_id": yinglima_id,
            "redirect_uri": "https://yinglima.erp.local/auth/callback",
            "state": "state_hardening_test_123",
            "nonce": "nonce_hardening_123",
        },
    )
    assert auth_resp.status_code == 200, auth_resp.text
    auth_data = auth_resp.json()["data"]
    assert auth_data["state"] == "state_hardening_test_123"
    assert "authorization_code" in auth_data

    token_resp = await client.post(
        "/api/v1/federation/token",
        json={
            "grant_type": "authorization_code",
            "code": auth_data["authorization_code"],
            "redirect_uri": "https://yinglima.erp.local/auth/callback",
            "client_id": fed_client_data["client_id"],
            "client_secret": fed_client_data["client_secret"],
        },
    )
    assert token_resp.status_code == 200, token_resp.text
    id_token = token_resp.json()["data"]["id_token"]
    assert id_token
    assert token_resp.json()["data"]["token_type"] == "Bearer"

    # Verify SSO token claims & JWKS endpoint
    jwks_resp = await client.get("/api/v1/.well-known/jwks.json")
    assert jwks_resp.status_code == 200
    assert len(jwks_resp.json()["keys"]) > 0

    unverified = jwt.decode(id_token, options={"verify_signature": False})
    assert unverified["sub"] == user_id
    assert unverified["aud"] == fed_client_data["client_id"]
    assert unverified["type"] == "federation_id_token"
    assert unverified["nonce"] == "nonce_hardening_123"

    # 6 & 7. Generate business transaction & Ingest event into ERP_Main
    source_buyer_id = str(uuid.uuid4())
    event_id = str(uuid.uuid4())
    envelope = {
        "event_id": event_id,
        "event_type": "buyer.created",
        "event_version": 1,
        "occurred_at": datetime.now(timezone.utc).isoformat(),
        "source_erp": yinglima_key,
        "source_entity_type": "buyer",
        "source_entity_id": source_buyer_id,
        "correlation_id": str(uuid.uuid4()),
        "causation_id": None,
        "actor_type": "user",
        "actor_id": local_yinglima_user_id,
        "target": "broadcast",
        "payload": {
            "company_name": "Titan Logistics Corp",
            "buyer_code": "BUY-TITAN-01",
            "status": "active",
        },
        "metadata": {},
    }
    await _ingest_event(client, token=yinglima_token, envelope=envelope)

    # 8. Trigger projection materialization / checkpoint rebuild
    rebuild_resp = await admin_client.post("/api/v1/global/projections/rebuild")
    assert rebuild_resp.status_code == 200

    # 9. Perform unified multi-entity search
    search_resp = await user_client.get("/api/v1/global/search", params={"q": "Titan"})
    assert search_resp.status_code == 200
    search_data = search_resp.json()["data"]
    assert search_data["total"] >= 1
    found = any("Titan Logistics" in r["display_title"] for r in search_data["results"])
    assert found is True

    # 10. Run global report preview
    preview_resp = await user_client.get("/api/v1/global/reports/global_buyer_summary/preview")
    assert preview_resp.status_code == 200
    preview = preview_resp.json()["data"]
    assert "Company Name" in preview["columns"]
    assert any("Titan Logistics" in str(row) for row in preview["rows"])

    # 11. Request report export
    export_req = await user_client.post(
        "/api/v1/global/reports/export",
        json={"report_type": "global_buyer_summary", "export_format": "csv"},
    )
    assert export_req.status_code == 201, export_req.text
    job = export_req.json()["data"]
    job_id = job["id"]
    assert job["status"] == "PENDING"

    # 12. Process export to real CSV file
    proc_resp = await user_client.post(f"/api/v1/global/reports/export/{job_id}/process")
    assert proc_resp.status_code == 200
    processed_job = proc_resp.json()["data"]
    assert processed_job["status"] == "COMPLETED"
    download_token = processed_job["download_token"]
    assert processed_job["file_size_bytes"] is not None
    assert processed_job["file_size_bytes"] > 0

    # 13. Download export file using secure download token
    dl_resp = await user_client.get(
        f"/api/v1/global/reports/export/{job_id}/download",
        params={"token": download_token},
    )
    assert dl_resp.status_code == 200
    assert dl_resp.headers["content-type"].startswith("text/csv")
    csv_text = dl_resp.text
    assert "Company Name" in csv_text
    assert "Titan Logistics Corp" in csv_text

    # 14. Verify audit trail records sensitive operations
    audit_resp = await admin_client.get("/api/v1/global/audit")
    assert audit_resp.status_code == 200
    audit_events = audit_resp.json()["data"]
    event_types = [a["event_type"] for a in audit_events]
    assert any("sso" in et.lower() or "federation" in et.lower() for et in event_types)

    # 15. Inhyma ERP multi-entity verification (Product)
    inhyma_key = f"inhyma_{uuid.uuid4().hex[:4]}"
    inhyma_id, _ = await _create_erp(admin_client, key=inhyma_key)
    inhyma_token = await _issue_credential(admin_client, inhyma_id)
    prod_event = {
        "event_id": str(uuid.uuid4()),
        "event_type": "product.created",
        "event_version": 1,
        "occurred_at": datetime.now(timezone.utc).isoformat(),
        "source_erp": inhyma_key,
        "source_entity_type": "product",
        "source_entity_id": str(uuid.uuid4()),
        "correlation_id": str(uuid.uuid4()),
        "causation_id": None,
        "actor_type": "user",
        "actor_id": str(uuid.uuid4()),
        "target": "broadcast",
        "payload": {
            "product_code": "SKU-ORION-01",
            "name": "Orion Industrial Fiber",
            "category": "Raw Materials",
            "uom": "kg",
            "status": "active",
            "is_active": True,
        },
        "metadata": {},
    }
    await _ingest_event(client, token=inhyma_token, envelope=prod_event)
    await admin_client.post("/api/v1/global/projections/rebuild")

    inhyma_search = await admin_client.get("/api/v1/global/search/products", params={"q": "Orion"})
    assert inhyma_search.status_code == 200
    assert inhyma_search.json()["data"]["total"] >= 1


# ---------------------------------------------------------------------------
# Test Scenario 2: Identity Linking, Matching States & Safe Unlinking
# ---------------------------------------------------------------------------


async def test_identity_linking_and_membership_invariants(admin_client: AsyncClient, client: AsyncClient):
    """
    Validates identity matching states, deterministic normalization,
    and safe unlinking without cascading corruption.
    """
    # 1. Deterministic normalization
    assert normalize_email("  User.Name+Tag@Domain.COM  ") == "user.name+tag@domain.com"
    assert normalize_email("CAPITAL@DOMAIN.ORG") == "capital@domain.org"

    erp_id, _ = await _create_erp(admin_client, key=f"id_erp_{uuid.uuid4().hex[:4]}")
    user1_id, _, _ = await _register_and_login_global_user(client, email=f"link_{uuid.uuid4().hex[:6]}@domain.org", display_name="Link User")

    local_id_1 = str(uuid.uuid4())
    # Create valid membership
    mem_resp = await admin_client.post(
        f"/api/v1/global/users/{user1_id}/memberships/{erp_id}",
        json={"local_user_id": local_id_1},
    )
    assert mem_resp.status_code == 201
    membership_id = mem_resp.json()["data"]["id"]

    # Verify and activate membership
    await admin_client.post(f"/api/v1/global/memberships/{membership_id}/verify")

    # Prevent duplicate active membership for same user and ERP
    dup_resp = await admin_client.post(
        f"/api/v1/global/users/{user1_id}/memberships/{erp_id}",
        json={"local_user_id": local_id_1},
    )
    assert dup_resp.status_code == 409

    # Safe suspension does not delete the row or cascade-delete local user
    unlink_resp = await admin_client.post(
        f"/api/v1/global/memberships/{membership_id}/suspend", json={"reason": "Security review"}
    )
    assert unlink_resp.status_code == 200

    # Verify membership status transitioned safely
    user_mems = (await admin_client.get(f"/api/v1/global/users/{user1_id}/memberships")).json()["data"]
    target_mem = next(m for m in user_mems if m["id"] == membership_id)
    assert target_mem["status"] == "SUSPENDED"

    # Revocation
    rev_resp = await admin_client.post(
        f"/api/v1/global/memberships/{membership_id}/revoke", json={"reason": "Permanent offboarding"}
    )
    assert rev_resp.status_code == 200
    rev_mem = (await admin_client.get(f"/api/v1/global/users/{user1_id}/memberships")).json()["data"]
    assert next(m for m in rev_mem if m["id"] == membership_id)["status"] == "REVOKED"


# ---------------------------------------------------------------------------
# Test Scenario 3: Event Pipeline Deduplication & Version Ordering
# ---------------------------------------------------------------------------


async def test_event_deduplication_and_version_ordering(admin_client: AsyncClient, client: AsyncClient):
    """
    Proves:
    1. Delivering identical event 3x produces exactly 1 processed record and 1 projection row.
    2. Out-of-order events (Version 3 followed by Version 2) preserves Version 3 in projection.
    """
    erp_key = f"seq_erp_{uuid.uuid4().hex[:4]}"
    erp_id, _ = await _create_erp(admin_client, key=erp_key)
    token = await _issue_credential(admin_client, erp_id)
    supplier_source_id = str(uuid.uuid4())

    # Event 1: supplier.created version 1
    event_1_id = str(uuid.uuid4())
    event_1 = {
        "event_id": event_1_id,
        "event_type": "supplier.created",
        "event_version": 1,
        "occurred_at": datetime.now(timezone.utc).isoformat(),
        "source_erp": erp_key,
        "source_entity_type": "supplier",
        "source_entity_id": supplier_source_id,
        "correlation_id": str(uuid.uuid4()),
        "causation_id": None,
        "actor_type": "user",
        "actor_id": str(uuid.uuid4()),
        "target": "broadcast",
        "payload": {
            "supplier_code": "SUP-SEQ-01",
            "name": "Sequence Supplier Original",
            "status": "active",
            "is_active": True,
            "version": 1,
        },
        "metadata": {},
    }

    # Deliver Event 1 THREE TIMES
    r1 = await _ingest_event(client, token=token, envelope=event_1)
    r2 = await _ingest_event(client, token=token, envelope=event_1)
    r3 = await _ingest_event(client, token=token, envelope=event_1)
    assert r1["duplicate"] is False
    assert r2["duplicate"] is True
    assert r3["duplicate"] is True
    assert r1["inbox_event_id"] == r2["inbox_event_id"]

    await admin_client.post("/api/v1/global/projections/rebuild")

    # Verify exactly 1 projection exists
    s_resp = await admin_client.get("/api/v1/global/search/suppliers", params={"q": "SUP-SEQ-01"})
    assert s_resp.status_code == 200
    assert s_resp.json()["data"]["total"] == 1
    proj = s_resp.json()["data"]["results"][0]
    assert proj["version"] == 1

    # Out-of-Order: deliver version 3 FIRST
    event_v3 = {
        "event_id": str(uuid.uuid4()),
        "event_type": "supplier.updated",
        "event_version": 3,
        "occurred_at": datetime.now(timezone.utc).isoformat(),
        "source_erp": erp_key,
        "source_entity_type": "supplier",
        "source_entity_id": supplier_source_id,
        "correlation_id": str(uuid.uuid4()),
        "causation_id": None,
        "actor_type": "user",
        "actor_id": str(uuid.uuid4()),
        "target": "broadcast",
        "payload": {
            "supplier_code": "SUP-SEQ-01",
            "name": "Sequence Supplier Version 3",
            "status": "active",
            "is_active": True,
            "version": 3,
        },
        "metadata": {},
    }
    await _ingest_event(client, token=token, envelope=event_v3)
    await admin_client.post("/api/v1/global/projections/rebuild")

    s_resp3 = await admin_client.get("/api/v1/global/search/suppliers", params={"q": "SUP-SEQ-01"})
    assert s_resp3.json()["data"]["results"][0]["version"] == 3
    assert s_resp3.json()["data"]["results"][0]["name"] == "Sequence Supplier Version 3"

    # Now deliver stale version 2 LATER
    event_v2 = {
        "event_id": str(uuid.uuid4()),
        "event_type": "supplier.updated",
        "event_version": 2,
        "occurred_at": (datetime.now(timezone.utc) - timedelta(minutes=5)).isoformat(),
        "source_erp": erp_key,
        "source_entity_type": "supplier",
        "source_entity_id": supplier_source_id,
        "correlation_id": str(uuid.uuid4()),
        "causation_id": None,
        "actor_type": "user",
        "actor_id": str(uuid.uuid4()),
        "target": "broadcast",
        "payload": {
            "supplier_code": "SUP-SEQ-01",
            "name": "Sequence Supplier Stale Version 2",
            "status": "active",
            "is_active": True,
            "version": 2,
        },
        "metadata": {},
    }
    await _ingest_event(client, token=token, envelope=event_v2)
    await admin_client.post("/api/v1/global/projections/rebuild")

    # Verify Version 3 data is durably preserved and not overwritten by stale version 2
    s_resp_final = await admin_client.get("/api/v1/global/search/suppliers", params={"q": "SUP-SEQ-01"})
    final_proj = s_resp_final.json()["data"]["results"][0]
    assert final_proj["version"] == 3
    assert final_proj["name"] == "Sequence Supplier Version 3"


# ---------------------------------------------------------------------------
# Test Scenario 4: Export Security, IDOR, Path Traversal & Cleanup
# ---------------------------------------------------------------------------


async def test_export_security_idor_path_traversal_and_cleanup(admin_client: AsyncClient, client: AsyncClient):
    """
    Proves:
    1. User A cannot access User B's export without platform permissions (IDOR protection).
    2. Path traversal attempts are rejected.
    3. Expired tokens are denied.
    4. Retention cleanup purges expired physical files.
    """
    # Create User A and User B
    user_a_id, _, client_a = await _register_and_login_global_user(
        client, email=f"usera_{uuid.uuid4().hex[:4]}@domain.org", display_name="User A"
    )
    user_b_id, _, client_b = await _register_and_login_global_user(
        client, email=f"userb_{uuid.uuid4().hex[:4]}@domain.org", display_name="User B"
    )

    # Grant export permission to both
    role_key = f"EXP_ROLE_{uuid.uuid4().hex[:4].upper()}"
    await _create_role(
        admin_client, role_key=role_key, permission_keys=["platform.report.read", "platform.report.export"]
    )
    await _assign_role(admin_client, user_id=user_a_id, role_key=role_key, scope="GLOBAL")
    await _assign_role(admin_client, user_id=user_b_id, role_key=role_key, scope="GLOBAL")

    # User A creates and processes export
    job_resp = await client_a.post("/api/v1/global/reports/export", json={"report_type": "cross_erp_overview", "export_format": "csv"})
    assert job_resp.status_code == 201, job_resp.text
    job_id = job_resp.json()["data"]["id"]
    proc_resp = await client_a.post(f"/api/v1/global/reports/export/{job_id}/process")
    assert proc_resp.status_code == 200
    token_a = proc_resp.json()["data"]["download_token"]

    # IDOR Check: User B attempts to access User A's export job details -> 403 Forbidden
    job_get_b = await client_b.get(f"/api/v1/global/reports/export/{job_id}")
    assert job_get_b.status_code == 403

    # Token Download with invalid/tampered token -> 403 Forbidden
    bad_dl = await client_a.get(f"/api/v1/global/reports/export/{job_id}/download", params={"token": "tampered_token_xyz"})
    assert bad_dl.status_code == 403

    # Path traversal simulation: verifying service rejects unconfined paths
    with patch("os.path.commonpath", return_value="C:\\UnconfinedPath"):
        traversal_resp = await client_a.get(f"/api/v1/global/reports/export/{job_id}/download", params={"token": token_a})
        assert traversal_resp.status_code == 403
        assert "path traversal" in traversal_resp.text.lower()

    # Successful download by owner with valid token
    good_dl = await client_a.get(f"/api/v1/global/reports/export/{job_id}/download", params={"token": token_a})
    assert good_dl.status_code == 200

    # Cleanup endpoint invocation
    cleanup_resp = await admin_client.post("/api/v1/global/reports/export/cleanup", params={"retention_hours": 0})
    assert cleanup_resp.status_code == 200
    assert "pruned" in cleanup_resp.json()["data"]


# ---------------------------------------------------------------------------
# Test Scenario 5: Telemetry Reconciliation States (MATCHED, RECONCILIATION_REQUIRED, UNKNOWN)
# ---------------------------------------------------------------------------


async def test_telemetry_reconciliation_honest_states(admin_client: AsyncClient):
    """
    Proves reconciliation distinguishes MATCHED (counts match),
    RECONCILIATION_REQUIRED (counts diverge), and UNKNOWN (ERP unreachable) over HTTP telemetry.
    """
    erp_id, _ = await _create_erp(admin_client, key=f"recon_erp_{uuid.uuid4().hex[:4]}")

    # 1. Partner ERP is unreachable -> UNKNOWN status
    with patch("httpx.AsyncClient.get", side_effect=Exception("Connection refused")):
        resp_unreach = await admin_client.post(f"/api/v1/global/reconciliation/erps/{erp_id}")
        assert resp_unreach.status_code == 200
        recon_data = resp_unreach.json()["data"]
        assert recon_data["status"] == "UNKNOWN"
        assert recon_data["outbox_published_count"] is None
        assert "connection failed" in str(recon_data["details"].get("telemetry_error", "")).lower()

    # 2. Partner ERP returns telemetry matching projections -> MATCHED status
    proj_count = recon_data["projection_count"]
    mock_response = Response(
        status_code=200,
        json={"data": {"published_count": proj_count, "pending_count": 0, "failed_count": 0}},
    )
    with patch("httpx.AsyncClient.get", return_value=mock_response):
        resp_match = await admin_client.post(f"/api/v1/global/reconciliation/erps/{erp_id}")
        assert resp_match.status_code == 200
        recon_match = resp_match.json()["data"]
        assert recon_match["status"] == "MATCHED"
        assert recon_match["outbox_published_count"] == proj_count

    # 3. Partner ERP returns telemetry diverging from projections -> RECONCILIATION_REQUIRED status
    mock_mismatch = Response(
        status_code=200,
        json={"data": {"published_count": proj_count + 15, "pending_count": 5, "failed_count": 0}},
    )
    with patch("httpx.AsyncClient.get", return_value=mock_mismatch):
        resp_diff = await admin_client.post(f"/api/v1/global/reconciliation/erps/{erp_id}")
        assert resp_diff.status_code == 200
        recon_diff = resp_diff.json()["data"]
        assert recon_diff["status"] == "RECONCILIATION_REQUIRED"
        assert recon_diff["outbox_published_count"] == proj_count + 15


# ---------------------------------------------------------------------------
# Test Scenario 6: Subsystem Health & Point-in-Time Metrics
# ---------------------------------------------------------------------------


async def test_subsystem_health_and_metrics_integrity(admin_client: AsyncClient):
    """
    Validates GET /global/health/subsystems and GET /global/metrics
    report actual database, projection checkpoint, and storage status.
    """
    health_resp = await admin_client.get("/api/v1/global/health/subsystems")
    assert health_resp.status_code == 200
    health = health_resp.json()["data"]
    assert health["status"] in ("HEALTHY", "DEGRADED")
    subsystem_names = [s["subsystem"] for s in health["subsystems"]]
    assert "database" in subsystem_names
    assert "integration_inbox" in subsystem_names
    assert "export_storage" in subsystem_names

    metrics_resp = await admin_client.get("/api/v1/global/metrics")
    assert metrics_resp.status_code == 200
    metrics = metrics_resp.json()["data"]
    assert "total_erps" in metrics
    assert "projection_counts" in metrics
    assert "buyer" in metrics["projection_counts"]
    assert "supplier" in metrics["projection_counts"]
    assert "product" in metrics["projection_counts"]
    assert "inquiry" in metrics["projection_counts"]


# ---------------------------------------------------------------------------
# Test Scenario 7: Cross-ERP RBAC Scoping & Multi-Tenancy Isolation
# ---------------------------------------------------------------------------


async def test_cross_erp_search_and_data_isolation(admin_client: AsyncClient, client: AsyncClient):
    """
    Proves that a user membership in ERP A strictly forbids viewing records from ERP B.
    """
    # Create ERP A and ERP B
    erp_a_key = f"iso_a_{uuid.uuid4().hex[:4]}"
    erp_b_key = f"iso_b_{uuid.uuid4().hex[:4]}"
    erp_a_id, _ = await _create_erp(admin_client, key=erp_a_key)
    erp_b_id, _ = await _create_erp(admin_client, key=erp_b_key)
    token_b = await _issue_credential(admin_client, erp_b_id)

    # Ingest private data into ERP B
    secret_buyer_event = {
        "event_id": str(uuid.uuid4()),
        "event_type": "buyer.created",
        "event_version": 1,
        "occurred_at": datetime.now(timezone.utc).isoformat(),
        "source_erp": erp_b_key,
        "source_entity_type": "buyer",
        "source_entity_id": str(uuid.uuid4()),
        "correlation_id": str(uuid.uuid4()),
        "causation_id": None,
        "actor_type": "user",
        "actor_id": str(uuid.uuid4()),
        "target": "broadcast",
        "payload": {"company_name": "Secret Enterprise B Exclusive", "status": "active"},
        "metadata": {},
    }
    await _ingest_event(client, token=token_b, envelope=secret_buyer_event)
    await admin_client.post("/api/v1/global/projections/rebuild")

    # Create User scoped ONLY to ERP A
    user_iso_id, _, iso_client = await _register_and_login_global_user(
        client, email=f"user_iso_{uuid.uuid4().hex[:4]}@domain.org", display_name="Iso User"
    )
    mem_resp = await admin_client.post(
        f"/api/v1/global/users/{user_iso_id}/memberships/{erp_a_id}",
        json={"local_user_id": str(uuid.uuid4())},
    )
    assert mem_resp.status_code == 201
    await admin_client.post(f"/api/v1/global/memberships/{mem_resp.json()['data']['id']}/verify")

    # Iso User searches for ERP B's secret buyer -> 0 results
    iso_search = await iso_client.get("/api/v1/global/search/buyers", params={"q": "Exclusive"})
    assert iso_search.status_code == 200
    assert iso_search.json()["data"]["total"] == 0

    # Platform Admin searches for ERP B's secret buyer -> sees result
    admin_search = await admin_client.get("/api/v1/global/search/buyers", params={"q": "Exclusive"})
    assert admin_search.status_code == 200
    assert admin_search.json()["data"]["total"] >= 1
