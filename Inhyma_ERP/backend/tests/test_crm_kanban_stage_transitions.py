"""
CRM Phase 2: Pipeline-Specific Drag-and-Drop Kanban Tests.

Tests:
1. Dynamic columns and stage ordering for two pipelines with different stage definitions.
2. Filtering leads strictly to the selected pipeline.
3. Role and scope boundaries (Admin company-wide, Manager team-wide, Salesperson own-lead only).
4. Rejection of cross-pipeline stage transitions and non-existent lead IDs.
5. Won and Lost lifecycle validations (mandatory lost reason >= 3 chars, timestamp tracking, and reset on reopening).
6. Atomic persistence of CrmStageHistory and CrmActivity records.
"""

from __future__ import annotations

import random
import uuid
from datetime import datetime, timezone
import pytest
from httpx import AsyncClient
from sqlalchemy import delete, select

from app.auth.security import create_access_token
from app.crm.models import (
    CrmActivity,
    CrmAssignmentHistory,
    CrmFollowUp,
    CrmLead,
    CrmPipeline,
    CrmPipelineStage,
    CrmStageHistory,
)
from app.database.engine import get_sessionmaker
from app.users.models import User, UserStatus

ADMIN_ID = uuid.UUID("ea2b5763-5a4d-4f21-8bff-adc3e6cb8235")
MANAGER_ID = uuid.UUID("70b70538-2188-4a7a-8aab-b34c7243db05")
REP_A_ID = uuid.UUID("0c0d89b7-5105-4dc6-945b-301a049f4502")
REP_B_ID = uuid.UUID("b04e86e1-6f74-4c51-a247-2440adaf38df")


def unique_phone() -> str:
    return f"9{random.randint(100000000, 999999999)}"


@pytest.fixture
def admin_headers() -> dict[str, str]:
    token = create_access_token(
        ADMIN_ID,
        permissions=["crm.leads.manage", "crm.leads.view", "crm.pipelines.view", "*"],
    ).token
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def manager_headers() -> dict[str, str]:
    token = create_access_token(
        MANAGER_ID,
        permissions=["crm.leads.manage", "crm.leads.view", "crm.pipelines.view"],
    ).token
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def rep_a_headers() -> dict[str, str]:
    token = create_access_token(
        REP_A_ID,
        permissions=["crm.leads.view"],
    ).token
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def rep_b_headers() -> dict[str, str]:
    token = create_access_token(
        REP_B_ID,
        permissions=["crm.leads.view"],
    ).token
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
async def setup_two_pipelines_env(client: AsyncClient):
    """Set up two distinct pipelines with different stage structures, plus users."""
    sessionmaker = get_sessionmaker()

    pipe_a_id = uuid.uuid4()
    pipe_a_stages = [
        {"id": uuid.uuid4(), "name": "Prospecting", "order": 0, "type": "open", "initial": True},
        {"id": uuid.uuid4(), "name": "Technical Validation", "order": 1, "type": "open", "initial": False},
        {"id": uuid.uuid4(), "name": "Proposal Delivered", "order": 2, "type": "open", "initial": False},
        {"id": uuid.uuid4(), "name": "Deal Won", "order": 3, "type": "won", "initial": False},
        {"id": uuid.uuid4(), "name": "Deal Lost", "order": 4, "type": "lost", "initial": False},
    ]

    pipe_b_id = uuid.uuid4()
    pipe_b_stages = [
        {"id": uuid.uuid4(), "name": "Inbound Lead", "order": 0, "type": "open", "initial": True},
        {"id": uuid.uuid4(), "name": "Contract Review", "order": 1, "type": "open", "initial": False},
        {"id": uuid.uuid4(), "name": "Won FastTrack", "order": 2, "type": "won", "initial": False},
        {"id": uuid.uuid4(), "name": "Disqualified", "order": 3, "type": "lost", "initial": False},
    ]

    async with sessionmaker() as session:
        # Clean existing CRM tables
        await session.execute(delete(CrmActivity))
        await session.execute(delete(CrmFollowUp))
        await session.execute(delete(CrmStageHistory))
        await session.execute(delete(CrmAssignmentHistory))
        await session.execute(delete(CrmLead))
        await session.execute(delete(CrmPipelineStage))
        await session.execute(delete(CrmPipeline))

        # Ensure users exist
        users_to_ensure = [
            (ADMIN_ID, "admin_user", "admin@inhyma.com", None),
            (MANAGER_ID, "sales_manager", "manager@inhyma.com", None),
            (REP_A_ID, "sales_rep_a", "repa@inhyma.com", MANAGER_ID),
            (REP_B_ID, "sales_rep_b", "repb@inhyma.com", None),
        ]
        for uid, uname, uemail, mgr_id in users_to_ensure:
            existing = await session.get(User, uid)
            if not existing:
                u = User(
                    id=uid,
                    username=uname,
                    email=uemail,
                    hashed_password="hashed_pw_test",
                    status=UserStatus.ACTIVE,
                    manager_id=mgr_id,
                )
                session.add(u)
            else:
                existing.manager_id = mgr_id
                existing.status = UserStatus.ACTIVE

        # Pipeline A
        pipe_a = CrmPipeline(
            id=pipe_a_id,
            name="Direct Sales Pipeline",
            is_active=True,
            is_default=True,
            created_by=ADMIN_ID,
        )
        session.add(pipe_a)
        for s in pipe_a_stages:
            session.add(
                CrmPipelineStage(
                    id=s["id"],
                    pipeline_id=pipe_a_id,
                    name=s["name"],
                    stage_order=s["order"],
                    stage_type=s["type"],
                    is_initial=s["initial"],
                    is_active=True,
                )
            )

        # Pipeline B
        pipe_b = CrmPipeline(
            id=pipe_b_id,
            name="Channel Partner Pipeline",
            is_active=True,
            is_default=False,
            created_by=ADMIN_ID,
        )
        session.add(pipe_b)
        for s in pipe_b_stages:
            session.add(
                CrmPipelineStage(
                    id=s["id"],
                    pipeline_id=pipe_b_id,
                    name=s["name"],
                    stage_order=s["order"],
                    stage_type=s["type"],
                    is_initial=s["initial"],
                    is_active=True,
                )
            )

        await session.commit()

    return {
        "pipeline_a_id": pipe_a_id,
        "pipeline_a_stages": pipe_a_stages,
        "pipeline_b_id": pipe_b_id,
        "pipeline_b_stages": pipe_b_stages,
    }


async def _create_test_lead(
    pipeline_id: uuid.UUID,
    stage_id: uuid.UUID,
    name: str = "Test Corp",
    assigned_to: uuid.UUID | None = None,
    created_by: uuid.UUID | None = None,
) -> CrmLead:
    sessionmaker = get_sessionmaker()
    async with sessionmaker() as session:
        lead = CrmLead(
            id=uuid.uuid4(),
            name=name,
            original_phone=unique_phone(),
            normalized_phone=unique_phone(),
            email=f"{uuid.uuid4().hex[:6]}@example.com",
            pipeline_id=pipeline_id,
            stage_id=stage_id,
            assigned_to=assigned_to,
            created_by=created_by,
            status="in_progress",
            priority="medium",
        )
        session.add(lead)
        await session.commit()
        await session.refresh(lead)
        return lead


@pytest.mark.asyncio
async def test_kanban_dynamic_columns_and_ordering(
    client: AsyncClient, admin_headers: dict[str, str], setup_two_pipelines_env: dict
):
    """Verify dynamic columns and ordering reflect each pipeline's configuration."""
    pipe_a_id = setup_two_pipelines_env["pipeline_a_id"]
    pipe_b_id = setup_two_pipelines_env["pipeline_b_id"]

    # Pipeline A
    res_a = await client.get(f"/api/v1/crm/pipelines/{pipe_a_id}", headers=admin_headers)
    assert res_a.status_code == 200
    data_a = res_a.json()["data"]
    stages_a = data_a["stages"]
    assert len(stages_a) == 5
    assert [s["name"] for s in sorted(stages_a, key=lambda x: x["stage_order"])] == [
        "Prospecting",
        "Technical Validation",
        "Proposal Delivered",
        "Deal Won",
        "Deal Lost",
    ]

    # Pipeline B
    res_b = await client.get(f"/api/v1/crm/pipelines/{pipe_b_id}", headers=admin_headers)
    assert res_b.status_code == 200
    data_b = res_b.json()["data"]
    stages_b = data_b["stages"]
    assert len(stages_b) == 4
    assert [s["name"] for s in sorted(stages_b, key=lambda x: x["stage_order"])] == [
        "Inbound Lead",
        "Contract Review",
        "Won FastTrack",
        "Disqualified",
    ]


@pytest.mark.asyncio
async def test_kanban_pipeline_leads_isolation(
    client: AsyncClient, admin_headers: dict[str, str], setup_two_pipelines_env: dict
):
    """Verify leads are filtered strictly to the selected pipeline."""
    pipe_a_id = setup_two_pipelines_env["pipeline_a_id"]
    stage_a_id = setup_two_pipelines_env["pipeline_a_stages"][0]["id"]

    pipe_b_id = setup_two_pipelines_env["pipeline_b_id"]
    stage_b_id = setup_two_pipelines_env["pipeline_b_stages"][0]["id"]

    lead_a = await _create_test_lead(pipe_a_id, stage_a_id, name="Pipeline A Alpha Lead")
    lead_b = await _create_test_lead(pipe_b_id, stage_b_id, name="Pipeline B Beta Lead")

    # Query Pipeline A
    res_a = await client.get(f"/api/v1/crm/leads?pipeline_id={pipe_a_id}", headers=admin_headers)
    assert res_a.status_code == 200
    items_a = res_a.json()["data"]["items"]
    lead_ids_a = [item["id"] for item in items_a]
    assert str(lead_a.id) in lead_ids_a
    assert str(lead_b.id) not in lead_ids_a

    # Query Pipeline B
    res_b = await client.get(f"/api/v1/crm/leads?pipeline_id={pipe_b_id}", headers=admin_headers)
    assert res_b.status_code == 200
    items_b = res_b.json()["data"]["items"]
    lead_ids_b = [item["id"] for item in items_b]
    assert str(lead_b.id) in lead_ids_b
    assert str(lead_a.id) not in lead_ids_b


@pytest.mark.asyncio
async def test_kanban_cross_pipeline_transition_rejected(
    client: AsyncClient, admin_headers: dict[str, str], setup_two_pipelines_env: dict
):
    """Verify attempting to drop a lead into a stage belonging to another pipeline is rejected with 400."""
    pipe_a_id = setup_two_pipelines_env["pipeline_a_id"]
    stage_a_id = setup_two_pipelines_env["pipeline_a_stages"][0]["id"]
    stage_b_id = setup_two_pipelines_env["pipeline_b_stages"][1]["id"]

    lead_a = await _create_test_lead(pipe_a_id, stage_a_id, name="Cross Pipeline Test Lead")

    # Attempt moving lead from Pipeline A into stage belonging to Pipeline B
    res = await client.post(
        f"/api/v1/crm/leads/{lead_a.id}/stage",
        json={"stage_id": str(stage_b_id), "reason": "Accidental cross-pipeline drop"},
        headers=admin_headers,
    )
    assert res.status_code == 400
    assert "cross-pipeline" in res.text.lower()


@pytest.mark.asyncio
async def test_kanban_admin_manager_salesperson_role_boundaries(
    client: AsyncClient,
    admin_headers: dict[str, str],
    manager_headers: dict[str, str],
    rep_a_headers: dict[str, str],
    rep_b_headers: dict[str, str],
    setup_two_pipelines_env: dict,
):
    """
    Verify role ownership boundaries:
    - Salesperson can move their own lead.
    - Salesperson CANNOT move another salesperson's lead (403).
    - Sales Manager can move their team member's lead.
    - Admin can move any lead company-wide.
    """
    pipe_a_id = setup_two_pipelines_env["pipeline_a_id"]
    stage_0_id = setup_two_pipelines_env["pipeline_a_stages"][0]["id"]
    stage_1_id = setup_two_pipelines_env["pipeline_a_stages"][1]["id"]
    stage_2_id = setup_two_pipelines_env["pipeline_a_stages"][2]["id"]

    # Lead assigned to Rep A (who reports to Manager)
    lead_rep_a = await _create_test_lead(pipe_a_id, stage_0_id, name="Rep A Lead", assigned_to=REP_A_ID)

    # 1. Rep B (unrelated salesperson) cannot move Rep A's lead
    res_b = await client.post(
        f"/api/v1/crm/leads/{lead_rep_a.id}/stage",
        json={"stage_id": str(stage_1_id)},
        headers=rep_b_headers,
    )
    assert res_b.status_code == 403

    # 2. Rep A CAN move their own lead
    res_a = await client.post(
        f"/api/v1/crm/leads/{lead_rep_a.id}/stage",
        json={"stage_id": str(stage_1_id), "reason": "Moved to tech validation by rep A"},
        headers=rep_a_headers,
    )
    assert res_a.status_code == 200
    assert res_a.json()["data"]["stage_id"] == str(stage_1_id)

    # 3. Manager CAN move Rep A's lead
    res_mgr = await client.post(
        f"/api/v1/crm/leads/{lead_rep_a.id}/stage",
        json={"stage_id": str(stage_2_id), "reason": "Manager approved proposal"},
        headers=manager_headers,
    )
    assert res_mgr.status_code == 200
    assert res_mgr.json()["data"]["stage_id"] == str(stage_2_id)

    # 4. Admin CAN move any lead
    res_admin = await client.post(
        f"/api/v1/crm/leads/{lead_rep_a.id}/stage",
        json={"stage_id": str(stage_0_id), "reason": "Admin reset to prospecting"},
        headers=admin_headers,
    )
    assert res_admin.status_code == 200
    assert res_admin.json()["data"]["stage_id"] == str(stage_0_id)


@pytest.mark.asyncio
async def test_kanban_won_and_lost_lifecycle_rules(
    client: AsyncClient, admin_headers: dict[str, str], setup_two_pipelines_env: dict
):
    """
    Verify:
    - Moving to Won stage sets won_at, clears lost fields, sets status = 'won'.
    - Moving to Lost stage requires non-empty lost_reason (>= 3 chars).
    - Moving to Lost stage sets lost_at, lost_reason, clears won_at, sets status = 'lost'.
    - Moving back to Open stage clears won and lost timestamps and resets status = 'in_progress'.
    """
    pipe_a_id = setup_two_pipelines_env["pipeline_a_id"]
    stage_init_id = setup_two_pipelines_env["pipeline_a_stages"][0]["id"]
    stage_won_id = setup_two_pipelines_env["pipeline_a_stages"][3]["id"]
    stage_lost_id = setup_two_pipelines_env["pipeline_a_stages"][4]["id"]
    stage_qual_id = setup_two_pipelines_env["pipeline_a_stages"][1]["id"]

    lead = await _create_test_lead(pipe_a_id, stage_init_id, name="Lifecycle Target Lead")

    # 1. Move to Won
    res_won = await client.post(
        f"/api/v1/crm/leads/{lead.id}/stage",
        json={"stage_id": str(stage_won_id), "reason": "Signed contract"},
        headers=admin_headers,
    )
    assert res_won.status_code == 200
    won_body = res_won.json()["data"]
    assert won_body["status"] == "won"
    assert won_body["won_at"] is not None
    assert won_body["lost_at"] is None
    assert won_body["lost_reason"] is None

    # 2. Reject Lost stage without valid lost reason
    res_bad_lost = await client.post(
        f"/api/v1/crm/leads/{lead.id}/stage",
        json={"stage_id": str(stage_lost_id), "lost_reason": "no"},
        headers=admin_headers,
    )
    assert res_bad_lost.status_code == 400
    assert "lost_reason" in res_bad_lost.text.lower()

    # 3. Move to Lost with valid lost reason
    res_lost = await client.post(
        f"/api/v1/crm/leads/{lead.id}/stage",
        json={"stage_id": str(stage_lost_id), "lost_reason": "Project cancelled by client leadership"},
        headers=admin_headers,
    )
    assert res_lost.status_code == 200
    lost_body = res_lost.json()["data"]
    assert lost_body["status"] == "lost"
    assert lost_body["lost_at"] is not None
    assert lost_body["lost_reason"] == "Project cancelled by client leadership"
    assert lost_body["won_at"] is None

    # 4. Reopen lead by moving to an open stage
    res_reopen = await client.post(
        f"/api/v1/crm/leads/{lead.id}/stage",
        json={"stage_id": str(stage_qual_id), "reason": "Re-engaged in new quarter"},
        headers=admin_headers,
    )
    assert res_reopen.status_code == 200
    reopen_body = res_reopen.json()["data"]
    assert reopen_body["status"] == "in_progress"
    assert reopen_body["won_at"] is None
    assert reopen_body["lost_at"] is None
    assert reopen_body["lost_reason"] is None


@pytest.mark.asyncio
async def test_kanban_stage_history_and_activity_persistence(
    client: AsyncClient, admin_headers: dict[str, str], setup_two_pipelines_env: dict
):
    """Verify each stage transition atomically writes CrmStageHistory and CrmActivity records."""
    pipe_a_id = setup_two_pipelines_env["pipeline_a_id"]
    stage_0_id = setup_two_pipelines_env["pipeline_a_stages"][0]["id"]
    stage_1_id = setup_two_pipelines_env["pipeline_a_stages"][1]["id"]

    lead = await _create_test_lead(pipe_a_id, stage_0_id, name="Audit Target Lead")

    res = await client.post(
        f"/api/v1/crm/leads/{lead.id}/stage",
        json={"stage_id": str(stage_1_id), "reason": "Technical scoping meeting completed"},
        headers=admin_headers,
    )
    assert res.status_code == 200

    sessionmaker = get_sessionmaker()
    async with sessionmaker() as session:
        # Check CrmStageHistory
        sh_stmt = select(CrmStageHistory).where(
            CrmStageHistory.lead_id == lead.id,
            CrmStageHistory.to_stage_id == stage_1_id,
        )
        sh = (await session.execute(sh_stmt)).scalar_one_or_none()
        assert sh is not None
        assert sh.from_stage_id == stage_0_id
        assert sh.changed_by == ADMIN_ID
        assert "Technical scoping meeting completed" in sh.reason

        # Check CrmActivity
        act_stmt = select(CrmActivity).where(
            CrmActivity.lead_id == lead.id,
            CrmActivity.activity_type == "stage_change",
        )
        act = (await session.execute(act_stmt)).scalar_one_or_none()
        assert act is not None
        assert act.performed_by == ADMIN_ID
        assert "Technical Validation" in act.subject


@pytest.mark.asyncio
async def test_kanban_invalid_lead_id_rejected(
    client: AsyncClient, admin_headers: dict[str, str], setup_two_pipelines_env: dict
):
    """Verify non-existent lead UUID returns 404."""
    random_lead_id = uuid.uuid4()
    stage_id = setup_two_pipelines_env["pipeline_a_stages"][0]["id"]

    res = await client.post(
        f"/api/v1/crm/leads/{random_lead_id}/stage",
        json={"stage_id": str(stage_id)},
        headers=admin_headers,
    )
    assert res.status_code == 404
