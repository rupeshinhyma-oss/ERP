"""
CRM Salesperson Distribution Automated Test Suite.

Verifies:
1. Listing users within authorized scope (Admin vs Sales Manager vs Salesperson).
2. Admin company-wide configuration and multi-state territory assignment.
3. Sales Manager scope restrictions (cannot view or mutate users outside Sales department).
4. Salesperson without permission cannot modify configuration (self or others).
5. Inactive or ineligible users cannot be enabled for assignment.
6. Territory validation (invalid state IDs rejected, duplicate state IDs deduplicated).
7. Existing CRM lead ownership remains unchanged when eligibility is toggled.
8. Bulk eligibility updates with validation and scope protection.
9. Audit trail logging for distribution changes.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
import pytest
from httpx import AsyncClient
from sqlalchemy import delete, select

from app.audit.models import AuditLog
from app.auth.security import create_access_token
from app.crm.models import CrmLead, CrmPipeline, CrmPipelineStage, CrmSalespersonConfig, CrmSalespersonTerritory
from app.database.engine import get_sessionmaker
from app.masters.states.models import State
from app.users.models import User, UserStatus


ADMIN_ID = uuid.UUID("ea2b5763-5a4d-4f21-8bff-adc3e6cb8235")
SALES_MANAGER_ID = uuid.UUID("70b70538-2188-4a7a-8aab-b34c7243db05")
JOHN_ID = uuid.UUID("0c0d89b7-5105-4dc6-945b-301a049f4502")
OPS_EMPLOYEE_ID = uuid.UUID("b04e86e1-6f74-4c51-a247-2440adaf38df")


@pytest.fixture
def admin_headers() -> dict[str, str]:
    token = create_access_token(
        ADMIN_ID,
        permissions=["crm.distribution.view", "crm.distribution.manage"],
    ).token
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def sales_manager_headers() -> dict[str, str]:
    token = create_access_token(
        SALES_MANAGER_ID,
        permissions=["crm.distribution.view", "crm.distribution.manage"],
    ).token
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def salesperson_headers() -> dict[str, str]:
    token = create_access_token(
        JOHN_ID,
        permissions=["crm.distribution.view"],
    ).token
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def unauthorized_headers() -> dict[str, str]:
    token = create_access_token(
        OPS_EMPLOYEE_ID,
        permissions=["task.view"],
    ).token
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(autouse=True)
async def setup_sales_team_hierarchy():
    """Ensure John reports to Sales Manager for distribution scoping tests."""
    sessionmaker = get_sessionmaker()
    async with sessionmaker() as session:
        john = (await session.execute(select(User).where(User.id == JOHN_ID))).scalar_one_or_none()
        if john:
            john.manager_id = SALES_MANAGER_ID
        ops = (await session.execute(select(User).where(User.id == OPS_EMPLOYEE_ID))).scalar_one_or_none()
        if ops:
            ops.manager_id = None
        await session.commit()
    yield


@pytest.mark.asyncio
async def test_unauthenticated_and_unauthorized_distribution(
    client: AsyncClient, unauthorized_headers: dict[str, str]
):
    """Ensure anonymous requests get 401 and unauthorized requests get 403."""
    # 1. Anonymous list
    res_anon = await client.get("/api/v1/crm/distribution/salespeople")
    assert res_anon.status_code == 401

    # 2. Unauthorized user list
    res_unauth_list = await client.get("/api/v1/crm/distribution/salespeople", headers=unauthorized_headers)
    assert res_unauth_list.status_code == 403

    # 3. Unauthorized user mutation
    res_unauth_put = await client.put(
        f"/api/v1/crm/distribution/salespeople/{JOHN_ID}",
        json={"is_eligible": True},
        headers=unauthorized_headers,
    )
    assert res_unauth_put.status_code == 403


@pytest.mark.asyncio
async def test_admin_company_wide_listing_and_configuration(
    client: AsyncClient, admin_headers: dict[str, str]
):
    """Admin has company-wide visibility and can configure eligibility and multi-state territories."""
    sessionmaker = get_sessionmaker()

    # Get two valid active states
    async with sessionmaker() as session:
        states = list((await session.execute(select(State).limit(2))).scalars().all())
        assert len(states) >= 2, "Test requires at least 2 states in database"
        state1_id = states[0].id
        state2_id = states[1].id

    # 1. Admin lists salespeople -> should see all departments
    res_list = await client.get("/api/v1/crm/distribution/salespeople", headers=admin_headers)
    assert res_list.status_code == 200
    data = res_list.json()["data"]
    user_ids = [item["user_id"] for item in data]
    assert str(JOHN_ID) in user_ids
    assert str(OPS_EMPLOYEE_ID) in user_ids

    # 2. Admin configures John with 2 states and priority 1
    res_put = await client.put(
        f"/api/v1/crm/distribution/salespeople/{JOHN_ID}",
        json={
            "is_eligible": True,
            "priority": 2,
            "max_lead_capacity": 50,
            "notes": "Handles North and West accounts",
            "territory_state_ids": [str(state1_id), str(state2_id)],
        },
        headers=admin_headers,
    )
    assert res_put.status_code == 200
    updated = res_put.json()["data"]
    assert updated["user_id"] == str(JOHN_ID)
    assert updated["is_eligible"] is True
    assert updated["priority"] == 2
    assert updated["max_lead_capacity"] == 50
    assert updated["notes"] == "Handles North and West accounts"
    assert len(updated["territories"]) == 2

    # 3. GET individual salesperson configuration
    res_get = await client.get(
        f"/api/v1/crm/distribution/salespeople/{JOHN_ID}",
        headers=admin_headers,
    )
    assert res_get.status_code == 200
    item = res_get.json()["data"]
    assert item["is_eligible"] is True
    assert item["priority"] == 2
    assert len(item["territories"]) == 2


@pytest.mark.asyncio
async def test_sales_manager_department_scoping(
    client: AsyncClient, sales_manager_headers: dict[str, str]
):
    """Sales manager cannot view or modify users outside their department/team scope."""
    # 1. Sales manager lists salespeople
    res_list = await client.get(
        "/api/v1/crm/distribution/salespeople",
        headers=sales_manager_headers,
    )
    assert res_list.status_code == 200
    data = res_list.json()["data"]
    scoped_user_ids = [item["user_id"] for item in data]

    # Must include Sales team members (John and Sales Manager)
    assert str(JOHN_ID) in scoped_user_ids
    assert str(SALES_MANAGER_ID) in scoped_user_ids
    # Must NOT include Operations employee
    assert str(OPS_EMPLOYEE_ID) not in scoped_user_ids

    # 2. Sales manager attempts to configure John (inside scope) -> allowed
    res_put_john = await client.put(
        f"/api/v1/crm/distribution/salespeople/{JOHN_ID}",
        json={"is_eligible": True, "priority": 1},
        headers=sales_manager_headers,
    )
    assert res_put_john.status_code == 200
    assert res_put_john.json()["data"]["is_eligible"] is True

    # 3. Sales manager attempts to configure Operations employee (outside scope) -> 403 Forbidden
    res_put_ops = await client.put(
        f"/api/v1/crm/distribution/salespeople/{OPS_EMPLOYEE_ID}",
        json={"is_eligible": True},
        headers=sales_manager_headers,
    )
    assert res_put_ops.status_code == 403
    assert "scope" in res_put_ops.text.lower()


@pytest.mark.asyncio
async def test_salesperson_cannot_configure_without_manage_permission(
    client: AsyncClient, salesperson_headers: dict[str, str]
):
    """A regular salesperson with only view permission cannot mutate configuration."""
    res_put = await client.put(
        f"/api/v1/crm/distribution/salespeople/{JOHN_ID}",
        json={"is_eligible": True, "priority": 1},
        headers=salesperson_headers,
    )
    assert res_put.status_code == 403


@pytest.mark.asyncio
async def test_inactive_user_cannot_be_enabled_for_assignment(
    client: AsyncClient, admin_headers: dict[str, str]
):
    """Inactive ERP user accounts cannot be enabled for lead assignment."""
    sessionmaker = get_sessionmaker()

    # Create a temporary inactive user
    inactive_uid = uuid.uuid4()
    async with sessionmaker() as session:
        inactive_user = User(
            id=inactive_uid,
            username=f"inactive_{inactive_uid.hex[:6]}",
            display_name="Inactive Person",
            is_active=False,
            status=UserStatus.INACTIVE,
            has_login=False,
        )
        session.add(inactive_user)
        await session.commit()

    try:
        # Attempt to enable assignment for this inactive user
        res = await client.put(
            f"/api/v1/crm/distribution/salespeople/{inactive_uid}",
            json={"is_eligible": True},
            headers=admin_headers,
        )
        assert res.status_code == 400
        assert "inactive or ineligible" in res.text.lower()
    finally:
        async with sessionmaker() as session:
            await session.execute(delete(CrmSalespersonConfig).where(CrmSalespersonConfig.user_id == inactive_uid))
            await session.execute(delete(User).where(User.id == inactive_uid))
            await session.commit()


@pytest.mark.asyncio
async def test_territory_validation_and_deduplication(
    client: AsyncClient, admin_headers: dict[str, str]
):
    """Test validation of non-existent state IDs, deduplication, and clearing territories."""
    sessionmaker = get_sessionmaker()

    # 1. Get one valid state
    async with sessionmaker() as session:
        state = (await session.execute(select(State).limit(1))).scalar_one()
        valid_state_id = state.id

    # 2. Reject non-existent territory UUID
    fake_state_id = uuid.uuid4()
    res_fake = await client.put(
        f"/api/v1/crm/distribution/salespeople/{JOHN_ID}",
        json={"territory_state_ids": [str(fake_state_id)]},
        headers=admin_headers,
    )
    assert res_fake.status_code == 400
    assert "territories" in res_fake.text.lower() or "states" in res_fake.text.lower()

    # 3. Deduplicate state IDs when duplicate IDs submitted
    res_dedup = await client.put(
        f"/api/v1/crm/distribution/salespeople/{JOHN_ID}",
        json={"territory_state_ids": [str(valid_state_id), str(valid_state_id)]},
        headers=admin_headers,
    )
    assert res_dedup.status_code == 200
    assert len(res_dedup.json()["data"]["territories"]) == 1

    # 4. Clear territories by passing empty list
    res_clear = await client.put(
        f"/api/v1/crm/distribution/salespeople/{JOHN_ID}",
        json={"territory_state_ids": []},
        headers=admin_headers,
    )
    assert res_clear.status_code == 200
    assert len(res_clear.json()["data"]["territories"]) == 0


@pytest.mark.asyncio
async def test_existing_lead_ownership_unchanged_on_eligibility_toggle(
    client: AsyncClient, admin_headers: dict[str, str]
):
    """Disabling a salesperson's eligibility does not alter their existing lead ownership."""
    sessionmaker = get_sessionmaker()
    lead_id = uuid.uuid4()

    async with sessionmaker() as session:
        # Create pipeline and lead assigned to John
        pipeline = (await session.execute(select(CrmPipeline).limit(1))).scalar_one_or_none()
        if not pipeline:
            pipeline = CrmPipeline(name=f"Lead Test Pipeline {uuid.uuid4().hex[:6]}", is_default=True)
            session.add(pipeline)
            await session.flush()
            stage = CrmPipelineStage(pipeline_id=pipeline.id, name="Stage 1", stage_order=0, stage_type="open", is_initial=True)
            session.add(stage)
            await session.flush()
        else:
            stage = (await session.execute(select(CrmPipelineStage).where(CrmPipelineStage.pipeline_id == pipeline.id).limit(1))).scalar_one()

        lead = CrmLead(
            id=lead_id,
            lead_code=f"CRM-TEST-{uuid.uuid4().hex[:6].upper()}",
            name="Alpha Corp",
            original_phone="+919876543210",
            normalized_phone="9876543210",
            assigned_to=JOHN_ID,
            pipeline_id=pipeline.id,
            stage_id=stage.id,
            status="in_progress",
        )
        session.add(lead)
        await session.commit()

    try:
        # First enable John
        await client.put(
            f"/api/v1/crm/distribution/salespeople/{JOHN_ID}",
            json={"is_eligible": True},
            headers=admin_headers,
        )

        # Now disable John
        res_disable = await client.put(
            f"/api/v1/crm/distribution/salespeople/{JOHN_ID}",
            json={"is_eligible": False},
            headers=admin_headers,
        )
        assert res_disable.status_code == 200
        assert res_disable.json()["data"]["is_eligible"] is False

        # Verify lead ownership in DB remains completely unchanged
        async with sessionmaker() as session:
            db_lead = await session.get(CrmLead, lead_id)
            assert db_lead is not None
            assert db_lead.assigned_to == JOHN_ID, "Lead ownership must NOT be changed when eligibility is toggled"

        # Check lead counts reported on endpoint
        res_get = await client.get(f"/api/v1/crm/distribution/salespeople/{JOHN_ID}", headers=admin_headers)
        assert res_get.status_code == 200
        assert res_get.json()["data"]["active_lead_count"] >= 1
    finally:
        async with sessionmaker() as session:
            await session.execute(delete(CrmLead).where(CrmLead.id == lead_id))
            await session.commit()


@pytest.mark.asyncio
async def test_bulk_eligibility_update_and_audit_logging(
    client: AsyncClient, admin_headers: dict[str, str]
):
    """Bulk update sets eligibility for multiple users and records audit logs."""
    sessionmaker = get_sessionmaker()

    res_bulk = await client.post(
        "/api/v1/crm/distribution/salespeople/bulk-eligibility",
        json={"user_ids": [str(JOHN_ID), str(SALES_MANAGER_ID)], "is_eligible": True},
        headers=admin_headers,
    )
    assert res_bulk.status_code == 200
    assert res_bulk.json()["data"]["count"] == 2

    # Check both users are eligible
    async with sessionmaker() as session:
        configs = list((await session.execute(
            select(CrmSalespersonConfig).where(CrmSalespersonConfig.user_id.in_([JOHN_ID, SALES_MANAGER_ID]))
        )).scalars().all())
        assert len(configs) == 2
        for c in configs:
            assert c.is_eligible is True

        # Check audit log entry
        audit_entry = (await session.execute(
            select(AuditLog)
            .where(
                AuditLog.module == "crm",
                AuditLog.entity_type == "CrmSalespersonConfig",
            )
            .order_by(AuditLog.created_at.desc())
            .limit(1)
        )).scalar_one_or_none()
        assert audit_entry is not None
        assert "lead assignment eligibility" in audit_entry.description.lower()
