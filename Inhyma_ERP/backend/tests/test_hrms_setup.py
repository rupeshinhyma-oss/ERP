"""
Tests for HRMS Setup Module (Day 2).

Validates:
- Office Locations (Geofencing parameters & soft delete)
- Leave Types CRUD & Status toggling
- Expense Categories CRUD
- Expense Approval Workflow & Claim Rules persistence
"""

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_hrms_setup_locations_flow(client: AsyncClient):
    # 1. List locations (default seed should be present)
    res = await client.get("/api/v1/hrms/setup/locations")
    assert res.status_code == 200
    data = res.json()["data"]
    assert len(data) >= 1
    assert any(loc["name"] == "Inhyma Thane Office" for loc in data)
    default_office = next(loc for loc in data if loc["name"] == "Inhyma Thane Office")
    assert default_office["radius_meters"] == 150.0
    assert default_office["is_active"] is True

    # 2. Create new location
    create_payload = {
        "name": "Branch Office Pune",
        "location_type": "BRANCH",
        "address": "Baner Road, Pune, Maharashtra 411045",
        "latitude": 18.5590,
        "longitude": 73.7868,
        "radius_meters": 200.0,
        "is_active": True,
    }
    create_res = await client.post("/api/v1/hrms/setup/locations", json=create_payload)
    assert create_res.status_code == 201
    created_loc = create_res.json()["data"]
    loc_id = created_loc["id"]
    assert created_loc["name"] == "Branch Office Pune"
    assert created_loc["radius_meters"] == 200.0

    # 3. Update location
    update_res = await client.put(
        f"/api/v1/hrms/setup/locations/{loc_id}",
        json={"name": "Branch Office Pune (West)", "radius_meters": 250.0},
    )
    assert update_res.status_code == 200
    assert update_res.json()["data"]["name"] == "Branch Office Pune (West)"
    assert update_res.json()["data"]["radius_meters"] == 250.0

    # 4. Status toggle (Disable)
    status_res = await client.patch(
        f"/api/v1/hrms/setup/locations/{loc_id}/status",
        json={"is_active": False},
    )
    assert status_res.status_code == 200
    assert status_res.json()["data"]["is_active"] is False

    # 5. Soft delete
    del_res = await client.delete(f"/api/v1/hrms/setup/locations/{loc_id}")
    assert del_res.status_code == 200

    # 6. Verify deleted location is no longer in active list
    list_again = await client.get("/api/v1/hrms/setup/locations")
    ids = [loc["id"] for loc in list_again.json()["data"]]
    assert loc_id not in ids


@pytest.mark.asyncio
async def test_hrms_setup_leave_types_flow(client: AsyncClient):
    # 1. List leave types (seeds should be present)
    res = await client.get("/api/v1/hrms/setup/leave-types")
    assert res.status_code == 200
    leaves = res.json()["data"]
    names = [l["name"] for l in leaves]
    assert "Casual Leave" in names
    assert "Sick Leave" in names
    assert "Privilege Leave" in names

    # 2. Add leave type
    payload = {
        "name": "Maternity Leave",
        "code": "ML",
        "leave_type": "SPECIAL",
        "is_paid": True,
        "annual_balance": 180.0,
        "carry_forward_days": 0.0,
        "max_consecutive_days": 180,
        "monthly_accrual": False,
        "is_active": True,
    }
    create_res = await client.post("/api/v1/hrms/setup/leave-types", json=payload)
    assert create_res.status_code == 201
    leave_id = create_res.json()["data"]["id"]

    # 3. Edit leave type
    edit_res = await client.put(
        f"/api/v1/hrms/setup/leave-types/{leave_id}",
        json={"annual_balance": 182.0},
    )
    assert edit_res.status_code == 200
    assert edit_res.json()["data"]["annual_balance"] == 182.0

    # 4. Disable leave type
    dis_res = await client.patch(
        f"/api/v1/hrms/setup/leave-types/{leave_id}/status",
        json={"is_active": False},
    )
    assert dis_res.status_code == 200
    assert dis_res.json()["data"]["is_active"] is False

    # 5. Soft delete
    del_res = await client.delete(f"/api/v1/hrms/setup/leave-types/{leave_id}")
    assert del_res.status_code == 200


@pytest.mark.asyncio
async def test_hrms_setup_expense_settings_and_categories_flow(client: AsyncClient):
    # 1. List categories (seeds present)
    res = await client.get("/api/v1/hrms/setup/expense-categories")
    assert res.status_code == 200
    cats = res.json()["data"]
    cat_names = [c["name"] for c in cats]
    for expected in ["Travel", "Meals", "Fuel", "Office Supplies", "Accommodation", "Miscellaneous"]:
        assert expected in cat_names

    # 2. Create custom category
    create_res = await client.post(
        "/api/v1/hrms/setup/expense-categories",
        json={"name": "Client Entertainment", "code": "ENT", "description": "Gifts and hosting"},
    )
    assert create_res.status_code == 201
    cat_id = create_res.json()["data"]["id"]

    # 3. Update category
    up_res = await client.put(
        f"/api/v1/hrms/setup/expense-categories/{cat_id}",
        json={"description": "Client entertainment & corporate dinners"},
    )
    assert up_res.status_code == 200
    assert up_res.json()["data"]["description"] == "Client entertainment & corporate dinners"

    # 4. Expense Settings (Approval Workflow + Claim Rules)
    # Ensure known baseline for idempotent test runs on persistent DB
    await client.put(
        "/api/v1/hrms/setup/expense-settings",
        json={
            "approval_team_lead": True,
            "approval_manager": True,
            "approval_accounts": True,
            "max_claim_amount": 50000.0,
            "receipt_required": True,
            "auto_approval_limit": 500.0,
            "submission_window_days": 30,
        },
    )
    settings_res = await client.get("/api/v1/hrms/setup/expense-settings")
    assert settings_res.status_code == 200
    settings = settings_res.json()["data"]
    assert settings["approval_team_lead"] is True
    assert settings["approval_manager"] is True
    assert settings["approval_accounts"] is True
    assert settings["max_claim_amount"] == 50000.0

    # 5. Update Expense Settings
    update_payload = {
        "approval_team_lead": True,
        "approval_manager": False,
        "approval_accounts": True,
        "max_claim_amount": 75000.0,
        "receipt_required": True,
        "auto_approval_limit": 1000.0,
        "submission_window_days": 45,
    }
    put_res = await client.put("/api/v1/hrms/setup/expense-settings", json=update_payload)
    assert put_res.status_code == 200
    saved = put_res.json()["data"]
    assert saved["approval_manager"] is False
    assert saved["max_claim_amount"] == 75000.0
    assert saved["auto_approval_limit"] == 1000.0
    assert saved["submission_window_days"] == 45
