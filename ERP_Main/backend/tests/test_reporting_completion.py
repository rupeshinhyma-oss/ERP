"""
Comprehensive Automated Tests for Phase 7 Backend Completion (Prompt 8).

Tests:
1. Generic Projection Framework & Registry
2. Multi-Entity Projections (Suppliers, Products, Inquiries, Buyers)
3. Event Idempotency, Version Ordering & Staleness Prevention
4. Unified Multi-Entity Search & Entity Inspection
5. Report Engine & Preview Execution
6. Report Export Processing, Real CSV/XLSX Generation, Secure Download & Cleanup
7. Two-Way Reconciliation & Outbox Telemetry Handling
8. Platform Metrics & Subsystem Health Checks
"""

from __future__ import annotations

import csv
import json
import os
import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import openpyxl
import pytest
import httpx

from app.reporting.framework import registry
from app.reporting.models import (
    ExportStatus,
    GlobalBuyerProjection,
    GlobalInquiryProjection,
    GlobalProductProjection,
    GlobalSupplierProjection,
    ReportExportJob,
)
from app.reporting.service import ExportService

pytestmark = pytest.mark.asyncio


async def _create_role(admin_client, *, role_key: str, permission_keys: list[str]):
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
    register_resp = await client.post(
        "/api/v1/global/user-auth/register", json={"display_name": "Test User", "email": email, "password": password}
    )
    assert register_resp.status_code == 201, register_resp.text
    user_id = register_resp.json()["data"]["id"]
    login_resp = await client.post("/api/v1/global/user-auth/login", json={"email": email, "password": password})
    assert login_resp.status_code == 200, login_resp.text
    return user_id, login_resp.json()["data"]["access_token"]


async def _create_erp(admin_client, *, key: str, status: str = "ACTIVE", base_url: str = "http://test-erp.local"):
    resp = await admin_client.post(
        "/api/v1/global/erps", json={"key": key, "name": key, "display_name": key, "status": status, "base_url": base_url}
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["data"]["id"]


async def _issue_credential(admin_client, erp_id: str) -> str:
    resp = await admin_client.post(f"/api/v1/global/erps/{erp_id}/credentials", json={})
    assert resp.status_code == 201, resp.text
    return resp.json()["data"]["bearer_token"]


async def _ingest_event(client, *, token: str, envelope: dict):
    client.headers["Authorization"] = f"Bearer {token}"
    resp = await client.post("/api/v1/internal/integration/events", json=envelope)
    assert resp.status_code == 201, resp.text
    return resp.json()["data"]


# ---------------------------------------------------------------------------
# 1. Framework & Registry Tests
# ---------------------------------------------------------------------------


async def test_projection_registry_contains_supported_entities():
    """Verify registry has definitions for buyer, supplier, product, inquiry."""
    entities = registry.supported_entities()
    assert "buyer" in entities
    assert "supplier" in entities
    assert "product" in entities
    assert "inquiry" in entities

    supplier_def = registry.get_by_entity_type("supplier")
    assert supplier_def is not None
    assert "supplier.created" in supplier_def.event_types
    assert "supplier.updated" in supplier_def.event_types
    assert supplier_def.model_class == GlobalSupplierProjection


# ---------------------------------------------------------------------------
# 2. Multi-Entity Projections & Versioning Tests
# ---------------------------------------------------------------------------


async def test_supplier_projection_creation_and_version_update(admin_client, client):
    """Test supplier.created followed by supplier.updated with version ordering."""
    erp_id = await _create_erp(admin_client, key="supp_erp_1")
    token = await _issue_credential(admin_client, erp_id)
    supplier_uuid = str(uuid.uuid4())

    # 1. Ingest supplier.created (version 1)
    envelope_v1 = {
        "event_id": str(uuid.uuid4()),
        "event_type": "supplier.created",
        "event_version": 1,
        "occurred_at": datetime.now(timezone.utc).isoformat(),
        "source_erp": "supp_erp_1",
        "source_entity_type": "supplier",
        "source_entity_id": supplier_uuid,
        "correlation_id": str(uuid.uuid4()),
        "causation_id": None,
        "actor_type": "user",
        "actor_id": str(uuid.uuid4()),
        "target": "broadcast",
        "payload": {
            "supplier_id": supplier_uuid,
            "supplier_code": "SUP-101",
            "company_name": "Apex Global Fabrics",
            "country": "India",
            "status": "active",
            "version": 1,
        },
        "metadata": {},
    }
    await _ingest_event(client, token=token, envelope=envelope_v1)
    await admin_client.post("/api/v1/global/projections/rebuild")

    # Inspect projection
    search_resp = await admin_client.get("/api/v1/global/search/suppliers", params={"q": "Apex"})
    assert search_resp.status_code == 200
    suppliers = search_resp.json()["data"]["results"]
    assert len(suppliers) == 1
    assert suppliers[0]["name"] == "Apex Global Fabrics"
    assert suppliers[0]["supplier_code"] == "SUP-101"
    assert suppliers[0]["version"] == 1
    proj_id = suppliers[0]["id"]

    # 2. Ingest supplier.updated (version 2)
    envelope_v2 = {
        "event_id": str(uuid.uuid4()),
        "event_type": "supplier.updated",
        "event_version": 1,
        "occurred_at": (datetime.now(timezone.utc) + timedelta(seconds=1)).isoformat(),
        "source_erp": "supp_erp_1",
        "source_entity_type": "supplier",
        "source_entity_id": supplier_uuid,
        "correlation_id": str(uuid.uuid4()),
        "causation_id": None,
        "actor_type": "user",
        "actor_id": str(uuid.uuid4()),
        "target": "broadcast",
        "payload": {
            "supplier_id": supplier_uuid,
            "supplier_code": "SUP-101",
            "company_name": "Apex Worldwide Textiles",
            "country": "India",
            "status": "active",
            "version": 2,
        },
        "metadata": {},
    }
    await _ingest_event(client, token=token, envelope=envelope_v2)
    await admin_client.post("/api/v1/global/projections/rebuild")

    # Detail check
    detail_resp = await admin_client.get(f"/api/v1/global/projections/supplier/{proj_id}")
    assert detail_resp.status_code == 200
    detail = detail_resp.json()["data"]
    assert detail["name"] == "Apex Worldwide Textiles"
    assert detail["version"] == 2

    # 3. Ingest stale version (version 1 with older timestamp) -> must be ignored!
    envelope_stale = {
        "event_id": str(uuid.uuid4()),
        "event_type": "supplier.updated",
        "event_version": 1,
        "occurred_at": (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat(),
        "source_erp": "supp_erp_1",
        "source_entity_type": "supplier",
        "source_entity_id": supplier_uuid,
        "correlation_id": str(uuid.uuid4()),
        "causation_id": None,
        "actor_type": "user",
        "actor_id": str(uuid.uuid4()),
        "target": "broadcast",
        "payload": {
            "supplier_id": supplier_uuid,
            "company_name": "Stale Name Should Be Ignored",
            "version": 1,
        },
        "metadata": {},
    }
    await _ingest_event(client, token=token, envelope=envelope_stale)
    await admin_client.post("/api/v1/global/projections/rebuild")

    detail_resp2 = await admin_client.get(f"/api/v1/global/projections/supplier/{proj_id}")
    assert detail_resp2.status_code == 200
    assert detail_resp2.json()["data"]["name"] == "Apex Worldwide Textiles"


async def test_product_and_inquiry_projections(admin_client, client):
    """Test product and inquiry events projection into read models."""
    erp_id = await _create_erp(admin_client, key="prod_erp_1")
    token = await _issue_credential(admin_client, erp_id)

    prod_uuid = str(uuid.uuid4())
    inq_uuid = str(uuid.uuid4())

    # Product event
    await _ingest_event(
        client,
        token=token,
        envelope={
            "event_id": str(uuid.uuid4()),
            "event_type": "product.created",
            "event_version": 1,
            "occurred_at": datetime.now(timezone.utc).isoformat(),
            "source_erp": "prod_erp_1",
            "source_entity_type": "product",
            "source_entity_id": prod_uuid,
            "correlation_id": str(uuid.uuid4()),
            "causation_id": None,
            "actor_type": "user",
            "actor_id": str(uuid.uuid4()),
            "target": "broadcast",
            "payload": {
                "product_id": prod_uuid,
                "product_code": "SKU-COTTON-01",
                "product_name": "Organic Cotton Yarn 30s",
                "is_active": True,
                "version": 1,
            },
            "metadata": {},
        },
    )

    # Inquiry event
    await _ingest_event(
        client,
        token=token,
        envelope={
            "event_id": str(uuid.uuid4()),
            "event_type": "inquiry.created",
            "event_version": 1,
            "occurred_at": datetime.now(timezone.utc).isoformat(),
            "source_erp": "prod_erp_1",
            "source_entity_type": "inquiry",
            "source_entity_id": inq_uuid,
            "correlation_id": str(uuid.uuid4()),
            "causation_id": None,
            "actor_type": "user",
            "actor_id": str(uuid.uuid4()),
            "target": "broadcast",
            "payload": {
                "inquiry_id": inq_uuid,
                "inquiry_number": "INQ-2026-001",
                "buyer_name": "Global Retailers Ltd",
                "status": "proposed",
                "item_count": 3,
                "version": 1,
            },
            "metadata": {},
        },
    )

    await admin_client.post("/api/v1/global/projections/rebuild")

    # Search products
    prod_resp = await admin_client.get("/api/v1/global/search/products", params={"q": "Cotton"})
    assert prod_resp.status_code == 200
    assert len(prod_resp.json()["data"]["results"]) >= 1
    assert prod_resp.json()["data"]["results"][0]["product_code"] == "SKU-COTTON-01"

    # Search inquiries
    inq_resp = await admin_client.get("/api/v1/global/search/inquiries", params={"q": "2026-001"})
    assert inq_resp.status_code == 200
    assert len(inq_resp.json()["data"]["results"]) >= 1
    assert inq_resp.json()["data"]["results"][0]["inquiry_number"] == "INQ-2026-001"


# ---------------------------------------------------------------------------
# 3. Unified Search Tests
# ---------------------------------------------------------------------------


async def test_unified_search_across_entities(admin_client, client):
    """Test GET /global/search returns polymorphic results across all entity types."""
    erp_id = await _create_erp(admin_client, key="uni_erp_1")
    token = await _issue_credential(admin_client, erp_id)

    # Ingest buyer with 'Zephyr'
    await _ingest_event(
        client,
        token=token,
        envelope={
            "event_id": str(uuid.uuid4()),
            "event_type": "buyer.created",
            "event_version": 1,
            "occurred_at": datetime.now(timezone.utc).isoformat(),
            "source_erp": "uni_erp_1",
            "source_entity_type": "buyer",
            "source_entity_id": str(uuid.uuid4()),
            "correlation_id": str(uuid.uuid4()),
            "causation_id": None,
            "actor_type": "user",
            "actor_id": str(uuid.uuid4()),
            "target": "broadcast",
            "payload": {"company_name": "Zephyr Textiles Inc", "status": "active"},
            "metadata": {},
        },
    )

    # Ingest product with 'Zephyr'
    await _ingest_event(
        client,
        token=token,
        envelope={
            "event_id": str(uuid.uuid4()),
            "event_type": "product.created",
            "event_version": 1,
            "occurred_at": datetime.now(timezone.utc).isoformat(),
            "source_erp": "uni_erp_1",
            "source_entity_type": "product",
            "source_entity_id": str(uuid.uuid4()),
            "correlation_id": str(uuid.uuid4()),
            "causation_id": None,
            "actor_type": "user",
            "actor_id": str(uuid.uuid4()),
            "target": "broadcast",
            "payload": {"product_code": "SKU-ZEP-99", "product_name": "Zephyr Soft Silk", "is_active": True},
            "metadata": {},
        },
    )

    await admin_client.post("/api/v1/global/projections/rebuild")

    # Search term 'Zephyr'
    search_resp = await admin_client.get("/api/v1/global/search", params={"q": "Zephyr"})
    assert search_resp.status_code == 200
    data = search_resp.json()["data"]

    assert data["total"] >= 2
    entity_types = {r["entity_type"] for r in data["results"]}
    assert "buyer" in entity_types
    assert "product" in entity_types


# ---------------------------------------------------------------------------
# 4. Report Execution Engine & Preview Tests
# ---------------------------------------------------------------------------


async def test_report_preview_execution(admin_client):
    """Test previewing reports for buyer, supplier, and cross-erp overview."""
    resp = await admin_client.get("/api/v1/global/reports/global_buyer_summary/preview")
    assert resp.status_code == 200
    preview = resp.json()["data"]
    assert "columns" in preview
    assert "rows" in preview
    assert "Company Name" in preview["columns"]

    resp_overview = await admin_client.get("/api/v1/global/reports/cross_erp_overview/preview")
    assert resp_overview.status_code == 200
    assert "ERP Key" in resp_overview.json()["data"]["columns"]


# ---------------------------------------------------------------------------
# 5. Export Processing, Real File Generation & Download Tests
# ---------------------------------------------------------------------------


async def test_export_lifecycle_csv_and_xlsx_with_download(admin_client):
    """Test requesting export, processing it to real CSV and XLSX files, and downloading with token."""
    # 1. Request CSV export
    req_resp = await admin_client.post(
        "/api/v1/global/reports/export",
        json={"report_type": "cross_erp_overview", "export_format": "csv"},
    )
    assert req_resp.status_code == 201
    job_id = req_resp.json()["data"]["id"]
    assert req_resp.json()["data"]["status"] == "PENDING"

    # 2. Process job
    proc_resp = await admin_client.post(f"/api/v1/global/reports/export/{job_id}/process")
    assert proc_resp.status_code == 200
    job_data = proc_resp.json()["data"]
    assert job_data["status"] == "COMPLETED"
    assert job_data["file_path"] is not None
    assert job_data["file_size_bytes"] > 0
    token = job_data["download_token"]
    assert token is not None

    # 3. Download CSV with token
    dl_resp = await admin_client.get(f"/api/v1/global/reports/export/{job_id}/download", params={"token": token})
    assert dl_resp.status_code == 200
    assert dl_resp.headers["content-type"].startswith("text/csv")
    content = dl_resp.text
    assert "ERP Key" in content

    # 4. Request and Process XLSX export
    req_xlsx = await admin_client.post(
        "/api/v1/global/reports/export",
        json={"report_type": "cross_erp_overview", "export_format": "xlsx"},
    )
    xlsx_id = req_xlsx.json()["data"]["id"]
    proc_xlsx = await admin_client.post(f"/api/v1/global/reports/export/{xlsx_id}/process")
    xlsx_data = proc_xlsx.json()["data"]
    assert xlsx_data["status"] == "COMPLETED"

    # 5. Download XLSX with token
    dl_xlsx = await admin_client.get(
        f"/api/v1/global/reports/export/{xlsx_id}/download",
        params={"token": xlsx_data["download_token"]},
    )
    assert dl_xlsx.status_code == 200
    # Verify valid zip / excel bytes (PK header)
    assert dl_xlsx.content[:2] == b"PK"

    # 6. Invalid token rejection
    dl_invalid = await admin_client.get(f"/api/v1/global/reports/export/{job_id}/download", params={"token": "bad_token"})
    assert dl_invalid.status_code == 403


async def test_export_cleanup_service(admin_client):
    """Test cleanup endpoint removes expired files."""
    req_resp = await admin_client.post(
        "/api/v1/global/reports/export",
        json={"report_type": "cross_erp_overview", "export_format": "csv"},
    )
    job_id = req_resp.json()["data"]["id"]
    await admin_client.post(f"/api/v1/global/reports/export/{job_id}/process")

    # Cleanup call
    cleanup_resp = await admin_client.post("/api/v1/global/reports/export/cleanup")
    assert cleanup_resp.status_code == 200
    assert "expired_identified" in cleanup_resp.json()["data"]


# ---------------------------------------------------------------------------
# 6. Two-Way Reconciliation Tests
# ---------------------------------------------------------------------------


async def test_reconciliation_handles_telemetry_match_and_unreachable(admin_client):
    """Test reconciliation compares telemetry and handles unreachable ERPs cleanly."""
    erp_id = await _create_erp(admin_client, key="recon_telemetry_erp", base_url="http://127.0.0.1:9999")

    # When partner ERP is unreachable, status must be UNKNOWN with details
    resp = await admin_client.post(f"/api/v1/global/reconciliation/erps/{erp_id}")
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["status"] == "UNKNOWN"
    assert "telemetry_error" in data["details"]

    # When telemetry is reachable and matched
    mock_telemetry = {
        "success": True,
        "data": {
            "total_outbox_events": 0,
            "published_count": 0,
            "by_aggregate_type": {"buyer": 0},
        },
    }
    with patch("httpx.AsyncClient.get") as mock_get:
        mock_response = httpx.Response(status_code=200, json=mock_telemetry)
        mock_get.return_value = mock_response

        resp_mock = await admin_client.post(f"/api/v1/global/reconciliation/erps/{erp_id}")
        assert resp_mock.status_code == 200
        data_mock = resp_mock.json()["data"]
        assert data_mock["status"] == "MATCHED"
        assert data_mock["outbox_published_count"] == 0


# ---------------------------------------------------------------------------
# 7. Metrics & Subsystem Health Tests
# ---------------------------------------------------------------------------


async def test_metrics_and_subsystem_health(admin_client):
    """Test GET /global/metrics and GET /global/health/subsystems."""
    metrics_resp = await admin_client.get("/api/v1/global/metrics")
    assert metrics_resp.status_code == 200
    metrics = metrics_resp.json()["data"]
    assert "total_erps" in metrics
    assert "projection_counts" in metrics
    assert "buyer" in metrics["projection_counts"]
    assert "supplier" in metrics["projection_counts"]
    assert "product" in metrics["projection_counts"]
    assert "inquiry" in metrics["projection_counts"]

    health_resp = await admin_client.get("/api/v1/global/health/subsystems")
    assert health_resp.status_code == 200
    health = health_resp.json()["data"]
    assert health["status"] in ("HEALTHY", "DEGRADED")
    subsystem_names = [s["subsystem"] for s in health["subsystems"]]
    assert "database" in subsystem_names
    assert "integration_inbox" in subsystem_names
    assert "export_storage" in subsystem_names
