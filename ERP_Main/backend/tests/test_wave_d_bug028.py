"""Wave D regression tests for ERP_Main (BUG-028)."""

from __future__ import annotations

import pytest

from app.main import create_application


def test_bug028_openapi_has_zero_duplicate_operation_ids():
    """BUG-028: Every OpenAPI operationId in ERP_Main must be unique (no HEAD/GET collisions)."""
    app = create_application()
    schema = app.openapi()
    seen: dict[str, tuple[str, str]] = {}
    duplicates: list[tuple[str, tuple[str, str], tuple[str, str]]] = []
    for path, methods in schema.get("paths", {}).items():
        for method, spec in methods.items():
            if not isinstance(spec, dict):
                continue
            op_id = spec.get("operationId")
            if not op_id:
                continue
            if op_id in seen:
                duplicates.append((op_id, seen[op_id], (method.upper(), path)))
            else:
                seen[op_id] = (method.upper(), path)
    assert duplicates == [], f"Duplicate OpenAPI operationIds detected: {duplicates}"


@pytest.mark.asyncio
async def test_bug028_health_dependencies_gates_internal_diagnostics(client, admin_client):
    """BUG-028: /health/dependencies returns minimal status anonymously and full diagnostics to admins."""
    anon = await client.get("/api/v1/health/dependencies")
    assert anon.status_code == 200
    anon_data = anon.json()["data"]
    assert anon_data["status"] in {"healthy", "degraded"}
    assert anon_data["service"] == "erp_main"
    assert "federation_credentials" not in anon_data
    assert "background_reconciliation" not in anon_data

    authed = await admin_client.get("/api/v1/health/dependencies")
    assert authed.status_code == 200
    authed_data = authed.json()["data"]
    assert "federation_credentials" in authed_data
    assert "background_reconciliation" in authed_data
    assert authed_data["database"] == "healthy"


@pytest.mark.asyncio
async def test_bug028_erp_registry_minimizes_internal_metadata_when_unauthenticated(client, admin_client):
    """BUG-028: /global/erps redacts internal deployment metadata anonymously while preserving full view for admins."""
    created = await admin_client.post(
        "/api/v1/global/erps",
        json={
            "key": "yinglima_meta",
            "name": "Yinglima ERP",
            "display_name": "Yinglima ERP",
            "description": "Internal China ops stack",
            "status": "ACTIVE",
            "base_url": "https://internal-yinglima.example.com",
            "environment": "production",
            "version": "2.4.1",
        },
    )
    assert created.status_code == 201
    erp_id = created.json()["data"]["id"]

    # Unauthenticated read preserves directory identity but strips operational metadata
    anon_list = await client.get("/api/v1/global/erps")
    assert anon_list.status_code == 200
    anon_item = next(e for e in anon_list.json()["data"] if e["id"] == erp_id)
    assert anon_item["key"] == "yinglima_meta"
    assert anon_item["status"] == "ACTIVE"
    assert anon_item["base_url"] is None
    assert anon_item["environment"] is None
    assert anon_item["version"] is None
    assert anon_item["description"] is None

    anon_by_id = await client.get(f"/api/v1/global/erps/{erp_id}")
    assert anon_by_id.status_code == 200
    assert anon_by_id.json()["data"]["base_url"] is None

    # Authenticated admin receives complete operational metadata
    admin_by_id = await admin_client.get(f"/api/v1/global/erps/{erp_id}")
    assert admin_by_id.status_code == 200
    admin_data = admin_by_id.json()["data"]
    assert admin_data["base_url"] == "https://internal-yinglima.example.com"
    assert admin_data["environment"] == "production"
    assert admin_data["version"] == "2.4.1"
