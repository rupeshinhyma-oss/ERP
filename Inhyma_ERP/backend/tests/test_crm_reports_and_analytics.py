"""
Regression Test Suite for CRM Reports & Analytics Removal.

Verifies:
1. Endpoints /api/v1/crm/reports/analytics and /api/v1/crm/analytics return HTTP 404 (Not Found)
   for all roles (Administrator, Sales Manager, Salesperson, and unauthenticated users).
2. CRM Lead Database (/api/v1/crm/leads) loads normally for all roles.
3. Operational rep oversight (/api/v1/crm/reps/oversight) remains functional.
"""

from __future__ import annotations

import uuid
import pytest
from httpx import AsyncClient

from app.auth.security import create_access_token

ADMIN_ID = uuid.UUID("ea2b5763-5a4d-4f21-8bff-adc3e6cb8235")
MANAGER_ID = uuid.UUID("70b70538-2188-4a7a-8aab-b34c7243db05")
REP_A_ID = uuid.UUID("0c0d89b7-5105-4dc6-945b-301a049f4502")


@pytest.fixture
def admin_headers() -> dict[str, str]:
    token = create_access_token(
        ADMIN_ID,
        permissions=["crm.leads.view", "crm.leads.manage", "*"],
    ).token
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def manager_headers() -> dict[str, str]:
    token = create_access_token(
        MANAGER_ID,
        permissions=["crm.leads.view", "crm.leads.manage"],
    ).token
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def rep_headers() -> dict[str, str]:
    token = create_access_token(
        REP_A_ID,
        permissions=["crm.leads.view"],
    ).token
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.asyncio
async def test_crm_reports_endpoints_return_404_for_all_roles(
    client: AsyncClient,
    admin_headers: dict[str, str],
    manager_headers: dict[str, str],
    rep_headers: dict[str, str],
):
    """
    Ensure neither /api/v1/crm/reports/analytics nor /api/v1/crm/analytics
    exist for Administrator, Sales Manager, Salesperson, or Anonymous.
    """
    for path in ["/api/v1/crm/reports/analytics", "/api/v1/crm/analytics"]:
        # Admin
        res_admin = await client.get(path, headers=admin_headers)
        assert res_admin.status_code == 404

        # Manager
        res_mgr = await client.get(path, headers=manager_headers)
        assert res_mgr.status_code == 404

        # Salesperson
        res_rep = await client.get(path, headers=rep_headers)
        assert res_rep.status_code == 404

        # Anonymous
        res_anon = await client.get(path)
        assert res_anon.status_code == 404


@pytest.mark.asyncio
async def test_crm_leads_database_loads_normally_without_reports(
    client: AsyncClient,
    admin_headers: dict[str, str],
    manager_headers: dict[str, str],
    rep_headers: dict[str, str],
):
    """
    CRM Lead Database list loads normally and is completely unaffected
    by the removal of reports and analytics.
    """
    res_admin = await client.get("/api/v1/crm/leads", headers=admin_headers)
    assert res_admin.status_code == 200
    assert "items" in res_admin.json()["data"]

    res_mgr = await client.get("/api/v1/crm/leads", headers=manager_headers)
    assert res_mgr.status_code == 200
    assert "items" in res_mgr.json()["data"]

    res_rep = await client.get("/api/v1/crm/leads", headers=rep_headers)
    assert res_rep.status_code == 200
    assert "items" in res_rep.json()["data"]


@pytest.mark.asyncio
async def test_crm_team_oversight_remains_functional(
    client: AsyncClient,
    admin_headers: dict[str, str],
):
    """
    Operational team oversight (workload distribution) remains functional.
    """
    res = await client.get("/api/v1/crm/team-oversight", headers=admin_headers)
    assert res.status_code == 200
    data = res.json()["data"]
    assert "reps" in data
    assert "total_active_leads" in data
