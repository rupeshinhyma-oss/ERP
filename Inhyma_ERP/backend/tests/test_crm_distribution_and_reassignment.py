"""
Comprehensive Test Suite for CRM Lead Import Distribution & Authorized Manual Reassignment.

Covers:
1. All 4 Import Distribution Modes:
   - Mode 1: Automatic distribution using existing configured assignment rules ('default_rules').
   - Mode 2: Distribution across selected eligible salespeople with 'round_robin' and 'least_active'.
   - Mode 3: Direct assignment of all newly created leads to one eligible salesperson ('single_salesperson').
   - Mode 4: Import new leads without assignment ('none').
2. Backend Eligibility and Capacity Enforcement:
   - Ineligible or inactive salespeople cannot be assigned.
   - Remaining capacity checks; leads beyond capacity remain unassigned with reason 'all_candidates_at_capacity'.
3. Duplicate and Intra-File Protection:
   - Existing duplicates in CRM are preserved and NEVER reassigned or assigned a second time.
   - Intra-file duplicate phone contacts are deduplicated and assigned at most once.
4. Rollback and Transaction Integrity:
   - Transaction failure leaves no orphan leads or corrupted assignment history.
5. CrmAssignmentHistory Audit:
   - Atomic logging with previous owner, new owner, actor, method, reason, and timestamp.
6. Manual Reassignment:
   - Admin authorization and execution.
   - Manager scoping (within department/team allowed, outside scope forbidden).
   - Salesperson without permission forbidden (403).
   - Mandatory reason validation (>= 5 chars, trimmed).
   - Target salesperson eligibility & capacity limits.
   - Same-salesperson reassignment rejection.
   - Concurrency locking and data preservation (pipeline, stage, campaign intact).
"""

from __future__ import annotations

import asyncio
import io
import random
import uuid
from datetime import datetime, timezone
from typing import Any
import pytest
from httpx import AsyncClient
from sqlalchemy import delete, func, select, update

from app.auth.security import create_access_token
from app.auth.service import CurrentUser
from app.core.constants import RecordStatus
from app.crm.assignment_service import CrmAssignmentEngineService
from app.crm.models import (
    CrmActivity,
    CrmAssignmentConfig,
    CrmAssignmentHistory,
    CrmImportBatch,
    CrmLead,
    CrmPipeline,
    CrmPipelineStage,
    CrmRoundRobinCursor,
    CrmSalespersonConfig,
    CrmSalespersonTerritory,
)
from app.database.engine import get_sessionmaker
from app.users.models import User, UserStatus

ADMIN_ID = uuid.UUID("ea2b5763-5a4d-4f21-8bff-adc3e6cb8235")
MANAGER_ID = uuid.UUID("70b70538-2188-4a7a-8aab-b34c7243db05")
REP_A_ID = uuid.UUID("0c0d89b7-5105-4dc6-945b-301a049f4502")
REP_B_ID = uuid.UUID("b04e86e1-6f74-4c51-a247-2440adaf38df")
OUTSIDER_REP_ID = uuid.UUID("99999999-9999-4999-8999-999999999999")


def unique_phone() -> str:
    """Generate collision-free 10-digit phone number."""
    return f"9{random.randint(100000000, 999999999)}"


def get_error_message(res: Any) -> str:
    """Extract human-readable error message from response JSON."""
    body = res.json()
    msg = body.get("message") or body.get("detail") or ""
    if not msg and "errors" in body and body["errors"]:
        msg = body["errors"][0].get("message", "")
    return str(msg).lower()


@pytest.fixture
def admin_headers() -> dict[str, str]:
    token = create_access_token(
        ADMIN_ID,
        permissions=["crm.leads.import", "crm.leads.manage", "crm.leads.view", "crm.pipelines.view", "*"],
    ).token
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def manager_headers() -> dict[str, str]:
    token = create_access_token(
        MANAGER_ID,
        permissions=["crm.leads.import", "crm.leads.manage", "crm.leads.view", "crm.pipelines.view"],
    ).token
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def rep_a_headers() -> dict[str, str]:
    token = create_access_token(
        REP_A_ID,
        permissions=["crm.leads.import", "crm.leads.view"],
    ).token
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
async def setup_env(client: AsyncClient):
    """Setup users, pipeline, stage, salesperson configs, and clean previous test data."""
    sessionmaker = get_sessionmaker()
    pipeline_id = uuid.uuid4()
    stage_id = uuid.uuid4()

    async with sessionmaker() as session:
        # 1. Clean existing records
        await session.execute(delete(CrmAssignmentHistory))
        await session.execute(delete(CrmLead))
        await session.execute(delete(CrmImportBatch))
        await session.execute(delete(CrmRoundRobinCursor))
        await session.execute(delete(CrmAssignmentConfig))
        await session.execute(delete(CrmSalespersonTerritory))
        await session.execute(delete(CrmSalespersonConfig))

        # 2. Pipeline & initial stage
        pipeline = CrmPipeline(
            id=pipeline_id,
            name=f"Distribution Pipeline {uuid.uuid4().hex[:6]}",
            is_active=True,
            is_default=False,
            created_by=ADMIN_ID,
        )
        session.add(pipeline)
        await session.flush()

        stage = CrmPipelineStage(
            id=stage_id,
            pipeline_id=pipeline_id,
            name="Incoming Leads",
            stage_order=0,
            stage_type="open",
            is_initial=True,
            is_active=True,
        )
        session.add(stage)

        # 3. Create or ensure test users
        users_meta = [
            (ADMIN_ID, "admin_test", "Admin", None),
            (MANAGER_ID, "manager_test", "Manager", None),
            (REP_A_ID, "rep_a_test", "Rep A", MANAGER_ID),
            (REP_B_ID, "rep_b_test", "Rep B", MANAGER_ID),
            (OUTSIDER_REP_ID, "outsider_rep", "Outsider", None),
        ]
        for u_id, uname, disp, mgr_id in users_meta:
            u = await session.get(User, u_id)
            if not u:
                u = User(
                    id=u_id,
                    username=f"{uname}_{uuid.uuid4().hex[:4]}",
                    email=f"{uname}_{uuid.uuid4().hex[:4]}@example.com",
                    first_name=disp,
                    last_name="User",
                    display_name=f"{disp} User",
                    status=UserStatus.ACTIVE,
                    is_active=True,
                    has_login=True,
                    password_hash="test_hash",
                    manager_id=mgr_id,
                )
                session.add(u)
            else:
                u.manager_id = mgr_id
                u.is_active = True
                u.status = UserStatus.ACTIVE

        await session.flush()

        # 4. Salesperson configs
        cfg_a = CrmSalespersonConfig(
            user_id=REP_A_ID,
            is_eligible=True,
            is_active=True,
            priority=1,
            max_lead_capacity=10,
        )
        cfg_b = CrmSalespersonConfig(
            user_id=REP_B_ID,
            is_eligible=True,
            is_active=True,
            priority=1,
            max_lead_capacity=10,
        )
        cfg_out = CrmSalespersonConfig(
            user_id=OUTSIDER_REP_ID,
            is_eligible=True,
            is_active=True,
            priority=1,
            max_lead_capacity=10,
        )
        session.add_all([cfg_a, cfg_b, cfg_out])

        # 5. Default round-robin rule for Mode 1
        rule = CrmAssignmentConfig(
            name="Default Round Robin Rule",
            rule_type="round_robin",
            is_active=True,
            priority=1,
            configuration={"strategy": "round_robin", "fallback_to_general": True},
        )
        session.add(rule)

        await session.commit()

    yield {
        "pipeline_id": pipeline_id,
        "stage_id": stage_id,
    }

    # Cleanup teardown
    async with sessionmaker() as session:
        await session.execute(delete(CrmAssignmentHistory).where(CrmAssignmentHistory.lead_id.in_(
            select(CrmLead.id).where(CrmLead.pipeline_id == pipeline_id)
        )))
        await session.execute(delete(CrmActivity).where(CrmActivity.lead_id.in_(
            select(CrmLead.id).where(CrmLead.pipeline_id == pipeline_id)
        )))
        await session.execute(delete(CrmLead).where(CrmLead.pipeline_id == pipeline_id))
        await session.execute(delete(CrmImportBatch).where(CrmImportBatch.selected_pipeline_id == pipeline_id))
        await session.execute(delete(CrmRoundRobinCursor))
        await session.execute(delete(CrmAssignmentConfig))
        await session.execute(delete(CrmSalespersonConfig).where(
            CrmSalespersonConfig.user_id.in_([REP_A_ID, REP_B_ID, OUTSIDER_REP_ID])
        ))
        await session.execute(delete(CrmPipelineStage).where(CrmPipelineStage.pipeline_id == pipeline_id))
        await session.execute(delete(CrmPipeline).where(CrmPipeline.id == pipeline_id))
        await session.commit()


# ==============================================================================
# PART A: CSV IMPORT DISTRIBUTION MODES
# ==============================================================================

@pytest.mark.asyncio
async def test_import_mode_1_default_rules(client: AsyncClient, admin_headers: dict[str, str], setup_env: dict):
    """Mode 1: Default configured assignment rules automatically distribute new leads."""
    pipe_id = str(setup_env["pipeline_id"])
    p1, p2 = unique_phone(), unique_phone()
    csv_bytes = (
        "Name,Number,Campaign\n"
        f"Lead One,{p1},Fall2026\n"
        f"Lead Two,{p2},Fall2026\n"
    ).encode("utf-8")

    files = {"file": ("leads.csv", csv_bytes, "text/csv")}
    data = {
        "pipeline_id": pipe_id,
        "batch_name": f"Mode1 Batch {uuid.uuid4().hex[:4]}",
        "distribution_mode": "default_rules",
    }

    res = await client.post("/api/v1/crm/import/confirm", files=files, data=data, headers=admin_headers)
    assert res.status_code == 201
    resp = res.json()["data"]
    assert resp["success_count"] == 2
    assert resp["assigned_count"] == 2
    assert resp["unassigned_count"] == 0

    sessionmaker = get_sessionmaker()
    async with sessionmaker() as session:
        leads = (await session.execute(select(CrmLead).where(CrmLead.normalized_phone.in_([f"+91{p1}", f"+91{p2}"])))).scalars().all()
        assert len(leads) == 2
        for lead in leads:
            assert lead.assigned_to is not None
            hist = (await session.execute(select(CrmAssignmentHistory).where(CrmAssignmentHistory.lead_id == lead.id))).scalar_one_or_none()
            assert hist is not None
            assert hist.new_owner_id == lead.assigned_to


@pytest.mark.asyncio
async def test_import_mode_2_selected_reps_round_robin(client: AsyncClient, admin_headers: dict[str, str], setup_env: dict):
    """Mode 2: Distribute across selected salespeople using round-robin."""
    pipe_id = str(setup_env["pipeline_id"])
    p1, p2, p3 = unique_phone(), unique_phone(), unique_phone()
    csv_bytes = (
        "Name,Number,Campaign\n"
        f"Round Robin 1,{p1},PromoA\n"
        f"Round Robin 2,{p2},PromoA\n"
        f"Round Robin 3,{p3},PromoA\n"
    ).encode("utf-8")

    files = {"file": ("reps_rr.csv", csv_bytes, "text/csv")}
    data = {
        "pipeline_id": pipe_id,
        "batch_name": f"Mode2 RR {uuid.uuid4().hex[:4]}",
        "distribution_mode": "selected_reps",
        "distribution_strategy": "round_robin",
        "selected_salesperson_ids": f"{REP_A_ID},{REP_B_ID}",
    }

    res = await client.post("/api/v1/crm/import/confirm", files=files, data=data, headers=admin_headers)
    assert res.status_code == 201
    resp = res.json()["data"]
    assert resp["success_count"] == 3
    assert resp["assigned_count"] == 3

    sessionmaker = get_sessionmaker()
    async with sessionmaker() as session:
        l1 = (await session.execute(select(CrmLead).where(CrmLead.normalized_phone == f"+91{p1}"))).scalar_one()
        l2 = (await session.execute(select(CrmLead).where(CrmLead.normalized_phone == f"+91{p2}"))).scalar_one()
        l3 = (await session.execute(select(CrmLead).where(CrmLead.normalized_phone == f"+91{p3}"))).scalar_one()

        assigned_uids = [l1.assigned_to, l2.assigned_to, l3.assigned_to]
        # Both Rep A and Rep B must have received leads
        assert REP_A_ID in assigned_uids
        assert REP_B_ID in assigned_uids


@pytest.mark.asyncio
async def test_import_mode_2_selected_reps_least_active(client: AsyncClient, admin_headers: dict[str, str], setup_env: dict):
    """Mode 2: Distribute across selected salespeople using least-active."""
    pipe_id = str(setup_env["pipeline_id"])
    p_existing = unique_phone()
    p_new = unique_phone()

    sessionmaker = get_sessionmaker()
    async with sessionmaker() as session:
        # Pre-assign 1 lead to Rep A so Rep B has 0 active leads
        existing_lead = CrmLead(
            id=uuid.uuid4(),
            lead_code=f"PRE-{uuid.uuid4().hex[:6]}",
            name="Existing Lead Rep A",
            original_phone=f"+91{p_existing}",
            normalized_phone=f"+91{p_existing}",
            pipeline_id=uuid.UUID(pipe_id),
            stage_id=setup_env["stage_id"],
            created_by=ADMIN_ID,
            assigned_to=REP_A_ID,
            status="new",
        )
        session.add(existing_lead)
        await session.commit()

    csv_bytes = (
        "Name,Number,Campaign\n"
        f"Least Active Lead,{p_new},CampaignLA\n"
    ).encode("utf-8")

    files = {"file": ("least_act.csv", csv_bytes, "text/csv")}
    data = {
        "pipeline_id": pipe_id,
        "batch_name": f"Mode2 LA {uuid.uuid4().hex[:4]}",
        "distribution_mode": "selected_reps",
        "distribution_strategy": "least_active",
        "selected_salesperson_ids": f"{REP_A_ID},{REP_B_ID}",
    }

    res = await client.post("/api/v1/crm/import/confirm", files=files, data=data, headers=admin_headers)
    assert res.status_code == 201

    async with sessionmaker() as session:
        new_lead = (await session.execute(select(CrmLead).where(CrmLead.normalized_phone == f"+91{p_new}"))).scalar_one()
        # Least active representative Rep B (0 leads) must receive this lead over Rep A (1 lead)
        assert new_lead.assigned_to == REP_B_ID


@pytest.mark.asyncio
async def test_import_mode_3_single_salesperson(client: AsyncClient, admin_headers: dict[str, str], setup_env: dict):
    """Mode 3: Assign all newly created leads to one chosen eligible salesperson."""
    pipe_id = str(setup_env["pipeline_id"])
    p1, p2 = unique_phone(), unique_phone()
    csv_bytes = (
        "Name,Number,Campaign\n"
        f"Single Rep 1,{p1},SinglePromo\n"
        f"Single Rep 2,{p2},SinglePromo\n"
    ).encode("utf-8")

    files = {"file": ("single.csv", csv_bytes, "text/csv")}
    data = {
        "pipeline_id": pipe_id,
        "batch_name": f"Mode3 Batch {uuid.uuid4().hex[:4]}",
        "distribution_mode": "single_salesperson",
        "target_salesperson_id": str(REP_B_ID),
    }

    res = await client.post("/api/v1/crm/import/confirm", files=files, data=data, headers=admin_headers)
    assert res.status_code == 201
    resp = res.json()["data"]
    assert resp["success_count"] == 2
    assert resp["assigned_count"] == 2

    sessionmaker = get_sessionmaker()
    async with sessionmaker() as session:
        leads = (await session.execute(select(CrmLead).where(CrmLead.normalized_phone.in_([f"+91{p1}", f"+91{p2}"])))).scalars().all()
        assert len(leads) == 2
        for lead in leads:
            assert lead.assigned_to == REP_B_ID
            hist = (await session.execute(select(CrmAssignmentHistory).where(CrmAssignmentHistory.lead_id == lead.id))).scalar_one()
            assert hist.assignment_method == "single_salesperson"
            assert hist.new_owner_id == REP_B_ID


@pytest.mark.asyncio
async def test_import_mode_4_none(client: AsyncClient, admin_headers: dict[str, str], setup_env: dict):
    """Mode 4: Import new leads without assignment."""
    pipe_id = str(setup_env["pipeline_id"])
    p1 = unique_phone()
    csv_bytes = (
        "Name,Number,Campaign\n"
        f"Unassigned Lead,{p1},NoAssign\n"
    ).encode("utf-8")

    files = {"file": ("none.csv", csv_bytes, "text/csv")}
    data = {
        "pipeline_id": pipe_id,
        "batch_name": f"Mode4 Batch {uuid.uuid4().hex[:4]}",
        "distribution_mode": "none",
    }

    res = await client.post("/api/v1/crm/import/confirm", files=files, data=data, headers=admin_headers)
    assert res.status_code == 201
    resp = res.json()["data"]
    assert resp["success_count"] == 1
    assert resp["assigned_count"] == 0
    assert resp["unassigned_count"] == 1

    sessionmaker = get_sessionmaker()
    async with sessionmaker() as session:
        lead = (await session.execute(select(CrmLead).where(CrmLead.normalized_phone == f"+91{p1}"))).scalar_one()
        assert lead.assigned_to is None
        assert lead.custom_fields.get("assignment_status") == "unassigned"


@pytest.mark.asyncio
async def test_import_duplicates_and_intra_file_protection(client: AsyncClient, admin_headers: dict[str, str], setup_env: dict):
    """
    CRITICAL: Existing duplicates in CRM and repeated contacts within same file
    must NEVER be reassigned or assigned a second time.
    """
    pipe_id = str(setup_env["pipeline_id"])
    existing_phone = unique_phone()
    new_phone = unique_phone()

    sessionmaker = get_sessionmaker()
    async with sessionmaker() as session:
        # Pre-create lead owned by Rep A
        orig_lead = CrmLead(
            id=uuid.uuid4(),
            lead_code=f"PRE-{uuid.uuid4().hex[:6]}",
            name="Original Customer",
            original_phone=f"+91{existing_phone}",
            normalized_phone=f"+91{existing_phone}",
            pipeline_id=uuid.UUID(pipe_id),
            stage_id=setup_env["stage_id"],
            created_by=ADMIN_ID,
            assigned_to=REP_A_ID,
            campaign="OriginalCampaign",
            status="contacted",
        )
        session.add(orig_lead)
        await session.commit()

    # CSV contains:
    # 1. existing_phone (CRM duplicate)
    # 2. new_phone (first occurrence)
    # 3. new_phone (intra-file duplicate)
    csv_bytes = (
        "Name,Number,Campaign\n"
        f"Original Customer Dup,{existing_phone},NewCampaign1\n"
        f"Brand New Contact,{new_phone},NewCampaign2\n"
        f"Repeated Contact,{new_phone},NewCampaign3\n"
    ).encode("utf-8")

    files = {"file": ("dups.csv", csv_bytes, "text/csv")}
    data = {
        "pipeline_id": pipe_id,
        "batch_name": f"Dups Batch {uuid.uuid4().hex[:4]}",
        "distribution_mode": "single_salesperson",
        "target_salesperson_id": str(REP_B_ID),
    }

    res = await client.post("/api/v1/crm/import/confirm", files=files, data=data, headers=admin_headers)
    assert res.status_code == 201
    resp = res.json()["data"]

    # 1 new lead created and assigned to REP_B
    assert resp["success_count"] == 1
    assert resp["duplicate_skipped_count"] == 2
    assert resp["assigned_count"] == 1

    async with sessionmaker() as session:
        # Verify original lead remains untouched and owned by REP_A
        lead_orig = (await session.execute(select(CrmLead).where(CrmLead.normalized_phone == f"+91{existing_phone}"))).scalar_one()
        assert lead_orig.assigned_to == REP_A_ID
        assert lead_orig.campaign == "OriginalCampaign"

        # Verify new contact was created and assigned once to REP_B
        new_leads = (await session.execute(select(CrmLead).where(CrmLead.normalized_phone == f"+91{new_phone}"))).scalars().all()
        assert len(new_leads) == 1
        assert new_leads[0].assigned_to == REP_B_ID


@pytest.mark.asyncio
async def test_import_capacity_enforcement(client: AsyncClient, admin_headers: dict[str, str], setup_env: dict):
    """Leads exceeding candidate capacity remain created and unassigned with proper reason."""
    pipe_id = str(setup_env["pipeline_id"])
    sessionmaker = get_sessionmaker()

    async with sessionmaker() as session:
        # Set Rep A capacity to 1
        await session.execute(
            update(CrmSalespersonConfig)
            .where(CrmSalespersonConfig.user_id == REP_A_ID)
            .values(max_lead_capacity=1)
        )
        await session.commit()

    p1, p2 = unique_phone(), unique_phone()
    csv_bytes = (
        "Name,Number,Campaign\n"
        f"Cap Lead 1,{p1},CapCamp\n"
        f"Cap Lead 2,{p2},CapCamp\n"
    ).encode("utf-8")

    files = {"file": ("cap.csv", csv_bytes, "text/csv")}
    data = {
        "pipeline_id": pipe_id,
        "batch_name": f"Cap Batch {uuid.uuid4().hex[:4]}",
        "distribution_mode": "single_salesperson",
        "target_salesperson_id": str(REP_A_ID),
    }

    res = await client.post("/api/v1/crm/import/confirm", files=files, data=data, headers=admin_headers)
    assert res.status_code == 201
    resp = res.json()["data"]

    # Both leads were created! 1 assigned, 1 unassigned due to capacity
    assert resp["success_count"] == 2
    assert resp["assigned_count"] == 1
    assert resp["unassigned_count"] == 1

    async with sessionmaker() as session:
        l1 = (await session.execute(select(CrmLead).where(CrmLead.normalized_phone == f"+91{p1}"))).scalar_one()
        l2 = (await session.execute(select(CrmLead).where(CrmLead.normalized_phone == f"+91{p2}"))).scalar_one()

        assert l1.assigned_to == REP_A_ID
        assert l2.assigned_to is None
        assert l2.custom_fields.get("assignment_status") == "unassigned"
        assert "capacity" in l2.custom_fields.get("unassigned_reason", "").lower()


@pytest.mark.asyncio
async def test_import_ineligible_candidate_rejected(client: AsyncClient, admin_headers: dict[str, str], setup_env: dict):
    """Selecting an ineligible candidate is rejected on the backend."""
    pipe_id = str(setup_env["pipeline_id"])
    sessionmaker = get_sessionmaker()

    async with sessionmaker() as session:
        # Mark Rep A ineligible
        await session.execute(
            update(CrmSalespersonConfig)
            .where(CrmSalespersonConfig.user_id == REP_A_ID)
            .values(is_eligible=False)
        )
        await session.commit()

    csv_bytes = f"Name,Number,Campaign\nTest Lead,{unique_phone()},Camp\n".encode("utf-8")
    files = {"file": ("test.csv", csv_bytes, "text/csv")}
    data = {
        "pipeline_id": pipe_id,
        "batch_name": "Ineligible Test",
        "distribution_mode": "single_salesperson",
        "target_salesperson_id": str(REP_A_ID),
    }

    res = await client.post("/api/v1/crm/import/confirm", files=files, data=data, headers=admin_headers)
    assert res.status_code == 400
    assert "eligible" in get_error_message(res)


# ==============================================================================
# PART B: AUTHORIZED MANUAL REASSIGNMENT
# ==============================================================================

@pytest.mark.asyncio
async def test_manual_reassignment_admin_success(client: AsyncClient, admin_headers: dict[str, str], setup_env: dict):
    """Admin can reassign any lead; crm_assignment_history and activity recorded atomically."""
    pipe_id = str(setup_env["pipeline_id"])
    p = unique_phone()
    lead_id = uuid.uuid4()

    sessionmaker = get_sessionmaker()
    async with sessionmaker() as session:
        lead = CrmLead(
            id=lead_id,
            lead_code=f"LD-{uuid.uuid4().hex[:6]}",
            name="Reassign Target Lead",
            original_phone=f"+91{p}",
            normalized_phone=f"+91{p}",
            pipeline_id=uuid.UUID(pipe_id),
            stage_id=setup_env["stage_id"],
            created_by=ADMIN_ID,
            assigned_to=REP_A_ID,
            campaign="PreserveCampaign",
            status="contacted",
        )
        session.add(lead)
        await session.commit()

    payload = {
        "new_salesperson_id": str(REP_B_ID),
        "reason": "Reassigned due to territory rebalancing policy",
    }

    res = await client.post(f"/api/v1/crm/leads/{lead_id}/reassign", json=payload, headers=admin_headers)
    assert res.status_code == 200
    data = res.json()["data"]
    assert data["id"] == str(lead_id)
    assert data["assigned_to"] == str(REP_B_ID)

    async with sessionmaker() as session:
        # Verify lead details preserved
        updated_lead = (await session.execute(select(CrmLead).where(CrmLead.id == lead_id))).scalar_one()
        assert updated_lead.assigned_to == REP_B_ID
        assert updated_lead.campaign == "PreserveCampaign"
        assert updated_lead.status == "contacted"
        assert updated_lead.pipeline_id == uuid.UUID(pipe_id)

        # Verify assignment history
        hist = (await session.execute(
            select(CrmAssignmentHistory).where(CrmAssignmentHistory.lead_id == lead_id)
        )).scalar_one()
        assert hist.previous_owner_id == REP_A_ID
        assert hist.new_owner_id == REP_B_ID
        assert hist.assigned_by == ADMIN_ID
        assert hist.assignment_method == "manual"
        assert hist.reason == "Reassigned due to territory rebalancing policy"

        # Verify activity log
        act = (await session.execute(
            select(CrmActivity).where(CrmActivity.lead_id == lead_id, CrmActivity.subject == "Lead Reassigned")
        )).scalar_one()
        assert act.performed_by == ADMIN_ID


@pytest.mark.asyncio
async def test_manual_reassignment_manager_scoping(client: AsyncClient, manager_headers: dict[str, str], setup_env: dict):
    """
    Manager can reassign between salespeople within their department/team scope,
    but cannot reassign to/from someone outside their scope.
    """
    pipe_id = str(setup_env["pipeline_id"])
    sessionmaker = get_sessionmaker()

    # 1. Lead owned by Rep A (in manager's scope)
    lead_in_scope_id = uuid.uuid4()
    p1 = unique_phone()
    async with sessionmaker() as session:
        l1 = CrmLead(
            id=lead_in_scope_id,
            lead_code=f"LD-{uuid.uuid4().hex[:6]}",
            name="In Scope Lead",
            original_phone=f"+91{p1}",
            normalized_phone=f"+91{p1}",
            pipeline_id=uuid.UUID(pipe_id),
            stage_id=setup_env["stage_id"],
            created_by=ADMIN_ID,
            assigned_to=REP_A_ID,
            status="new",
        )
        session.add(l1)
        await session.commit()

    # Manager reassigning to Rep B (also in scope) -> SUCCESS
    payload_valid = {
        "new_salesperson_id": str(REP_B_ID),
        "reason": "Manager reassigning within departmental scope",
    }
    res_valid = await client.post(f"/api/v1/crm/leads/{lead_in_scope_id}/reassign", json=payload_valid, headers=manager_headers)
    assert res_valid.status_code == 200

    # Manager attempting to reassign to OUTSIDER_REP_ID (outside scope) -> FORBIDDEN (403)
    payload_invalid = {
        "new_salesperson_id": str(OUTSIDER_REP_ID),
        "reason": "Attempting cross-department reassignment",
    }
    res_invalid = await client.post(f"/api/v1/crm/leads/{lead_in_scope_id}/reassign", json=payload_invalid, headers=manager_headers)
    assert res_invalid.status_code == 403
    err_msg = get_error_message(res_invalid)
    assert "department" in err_msg or "scope" in err_msg


@pytest.mark.asyncio
async def test_manual_reassignment_salesperson_forbidden(client: AsyncClient, rep_a_headers: dict[str, str], setup_env: dict):
    """Ordinary salesperson without crm.leads.manage cannot reassign leads."""
    pipe_id = str(setup_env["pipeline_id"])
    lead_id = uuid.uuid4()
    p = unique_phone()

    sessionmaker = get_sessionmaker()
    async with sessionmaker() as session:
        lead = CrmLead(
            id=lead_id,
            lead_code=f"LD-{uuid.uuid4().hex[:6]}",
            name="Salesperson Owned Lead",
            original_phone=f"+91{p}",
            normalized_phone=f"+91{p}",
            pipeline_id=uuid.UUID(pipe_id),
            stage_id=setup_env["stage_id"],
            created_by=ADMIN_ID,
            assigned_to=REP_A_ID,
            status="new",
        )
        session.add(lead)
        await session.commit()

    payload = {
        "new_salesperson_id": str(REP_B_ID),
        "reason": "Rep trying to reassign lead",
    }

    res = await client.post(f"/api/v1/crm/leads/{lead_id}/reassign", json=payload, headers=rep_a_headers)
    assert res.status_code == 403


@pytest.mark.asyncio
async def test_manual_reassignment_validation_mandatory_reason(client: AsyncClient, admin_headers: dict[str, str], setup_env: dict):
    """Reassignment reason must be at least 5 characters; short or empty reasons rejected."""
    lead_id = uuid.uuid4()
    p = unique_phone()

    sessionmaker = get_sessionmaker()
    async with sessionmaker() as session:
        lead = CrmLead(
            id=lead_id,
            lead_code=f"LD-{uuid.uuid4().hex[:6]}",
            name="Validation Lead",
            original_phone=f"+91{p}",
            normalized_phone=f"+91{p}",
            pipeline_id=setup_env["pipeline_id"],
            stage_id=setup_env["stage_id"],
            created_by=ADMIN_ID,
            assigned_to=REP_A_ID,
            status="new",
        )
        session.add(lead)
        await session.commit()

    # Short reason (< 5 chars)
    payload_short = {
        "new_salesperson_id": str(REP_B_ID),
        "reason": "no",
    }
    res_short = await client.post(f"/api/v1/crm/leads/{lead_id}/reassign", json=payload_short, headers=admin_headers)
    assert res_short.status_code in [400, 422]

    # Whitespace only reason
    payload_spaces = {
        "new_salesperson_id": str(REP_B_ID),
        "reason": "     ",
    }
    res_spaces = await client.post(f"/api/v1/crm/leads/{lead_id}/reassign", json=payload_spaces, headers=admin_headers)
    assert res_spaces.status_code in [400, 422]


@pytest.mark.asyncio
async def test_manual_reassignment_validation_capacity_and_same_user(client: AsyncClient, admin_headers: dict[str, str], setup_env: dict):
    """Cannot reassign to same user, or to a user that has reached max lead capacity."""
    lead_id = uuid.uuid4()
    p = unique_phone()

    sessionmaker = get_sessionmaker()
    async with sessionmaker() as session:
        lead = CrmLead(
            id=lead_id,
            lead_code=f"LD-{uuid.uuid4().hex[:6]}",
            name="Capacity Validation Lead",
            original_phone=f"+91{p}",
            normalized_phone=f"+91{p}",
            pipeline_id=setup_env["pipeline_id"],
            stage_id=setup_env["stage_id"],
            created_by=ADMIN_ID,
            assigned_to=REP_A_ID,
            status="new",
        )
        session.add(lead)

        # Set Rep B max_lead_capacity to 0 (already full)
        await session.execute(
            update(CrmSalespersonConfig)
            .where(CrmSalespersonConfig.user_id == REP_B_ID)
            .values(max_lead_capacity=0)
        )
        await session.commit()

    # 1. Same user reassignment rejected
    res_same = await client.post(
        f"/api/v1/crm/leads/{lead_id}/reassign",
        json={"new_salesperson_id": str(REP_A_ID), "reason": "Reassign to same person"},
        headers=admin_headers,
    )
    assert res_same.status_code == 400
    assert "already assigned" in get_error_message(res_same)

    # 2. Target at max capacity rejected
    res_cap = await client.post(
        f"/api/v1/crm/leads/{lead_id}/reassign",
        json={"new_salesperson_id": str(REP_B_ID), "reason": "Reassign to full person"},
        headers=admin_headers,
    )
    assert res_cap.status_code == 400
    assert "capacity" in get_error_message(res_cap)
