"""
Comprehensive Test Suite for CRM Phase 6: Sales Follow-up & Lead Lifecycle.

Covers:
1. Activity logging (calls, meetings, notes) and automatic last_contacted_at updates.
2. Follow-up scheduling and dynamic lead.next_follow_up_at recalculation.
3. Follow-up completion logging automatic activity and recalculating remaining pending.
4. Business-local date-boundary filtering (overdue, today, upcoming).
5. Stage transitions with won_at / lost_at timestamps, mandatory lost reasons, and history.
6. Cross-pipeline stage transition prevention.
7. RBAC scoping: Salesperson cross-lead mutation forbidden, Manager team scope, Admin company-wide.
8. Unified chronological lead timeline combining all 4 event sources.
"""

from __future__ import annotations

import asyncio
import random
import uuid
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo
from typing import Any
import pytest
from httpx import AsyncClient
from sqlalchemy import delete, select

from app.auth.security import create_access_token
from app.crm.models import (
    CrmActivity,
    CrmAssignmentHistory,
    CrmFollowUp,
    CrmImportBatch,
    CrmLead,
    CrmPipeline,
    CrmPipelineStage,
    CrmSalespersonConfig,
    CrmStageHistory,
)
from app.database.engine import get_sessionmaker
from app.users.models import User, UserStatus

ADMIN_ID = uuid.UUID("ea2b5763-5a4d-4f21-8bff-adc3e6cb8235")
MANAGER_ID = uuid.UUID("70b70538-2188-4a7a-8aab-b34c7243db05")
REP_A_ID = uuid.UUID("0c0d89b7-5105-4dc6-945b-301a049f4502")
REP_B_ID = uuid.UUID("b04e86e1-6f74-4c51-a247-2440adaf38df")

try:
    BUSINESS_TZ = ZoneInfo("Asia/Kolkata")
except Exception:
    BUSINESS_TZ = timezone(timedelta(hours=5, minutes=30))


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
async def setup_lifecycle_env(client: AsyncClient):
    """Setup clean pipeline with stages (open, won, lost), second pipeline, and active users."""
    sessionmaker = get_sessionmaker()
    pipeline_id = uuid.uuid4()
    stage_initial_id = uuid.uuid4()
    stage_qualified_id = uuid.uuid4()
    stage_won_id = uuid.uuid4()
    stage_lost_id = uuid.uuid4()

    other_pipeline_id = uuid.uuid4()
    other_stage_id = uuid.uuid4()

    async with sessionmaker() as session:
        # Clean existing CRM records
        await session.execute(delete(CrmActivity))
        await session.execute(delete(CrmFollowUp))
        await session.execute(delete(CrmStageHistory))
        await session.execute(delete(CrmAssignmentHistory))
        await session.execute(delete(CrmLead))
        await session.execute(delete(CrmPipelineStage))
        await session.execute(delete(CrmPipeline))

        # Primary Pipeline
        pipeline = CrmPipeline(
            id=pipeline_id,
            name=f"Primary Sales {uuid.uuid4().hex[:4]}",
            is_active=True,
            is_default=True,
            created_by=ADMIN_ID,
        )
        session.add(pipeline)

        s_init = CrmPipelineStage(
            id=stage_initial_id,
            pipeline_id=pipeline_id,
            name="New Lead",
            stage_order=0,
            stage_type="open",
            is_initial=True,
            is_active=True,
        )
        s_qual = CrmPipelineStage(
            id=stage_qualified_id,
            pipeline_id=pipeline_id,
            name="Qualified",
            stage_order=1,
            stage_type="open",
            is_initial=False,
            is_active=True,
        )
        s_won = CrmPipelineStage(
            id=stage_won_id,
            pipeline_id=pipeline_id,
            name="Closed Won",
            stage_order=2,
            stage_type="won",
            is_initial=False,
            is_active=True,
        )
        s_lost = CrmPipelineStage(
            id=stage_lost_id,
            pipeline_id=pipeline_id,
            name="Closed Lost",
            stage_order=3,
            stage_type="lost",
            is_initial=False,
            is_active=True,
        )
        session.add_all([s_init, s_qual, s_won, s_lost])

        # Other Pipeline (for cross-pipeline rejection test)
        other_pipe = CrmPipeline(
            id=other_pipeline_id,
            name=f"Partner Pipeline {uuid.uuid4().hex[:4]}",
            is_active=True,
            is_default=False,
            created_by=ADMIN_ID,
        )
        session.add(other_pipe)
        other_st = CrmPipelineStage(
            id=other_stage_id,
            pipeline_id=other_pipeline_id,
            name="Partner Stage",
            stage_order=0,
            stage_type="open",
            is_initial=True,
            is_active=True,
        )
        session.add(other_st)

        # Users
        users_meta = [
            (ADMIN_ID, "admin_user", "Admin", None),
            (MANAGER_ID, "manager_user", "Manager", None),
            (REP_A_ID, "rep_a_user", "Rep A", MANAGER_ID),
            (REP_B_ID, "rep_b_user", "Rep B", MANAGER_ID),
        ]
        for u_id, uname, disp, mgr_id in users_meta:
            u = await session.get(User, u_id)
            if not u:
                u = User(
                    id=u_id,
                    username=f"{uname}_{uuid.uuid4().hex[:4]}",
                    email=f"{uname}_{uuid.uuid4().hex[:4]}@example.com",
                    first_name=disp,
                    last_name="Test",
                    display_name=f"{disp} Test",
                    status=UserStatus.ACTIVE,
                    is_active=True,
                    has_login=True,
                    password_hash="test_pw_hash",
                    manager_id=mgr_id,
                )
                session.add(u)
            else:
                u.manager_id = mgr_id
                u.is_active = True
                u.status = UserStatus.ACTIVE

        await session.commit()

    return {
        "pipeline_id": pipeline_id,
        "stage_initial_id": stage_initial_id,
        "stage_qualified_id": stage_qualified_id,
        "stage_won_id": stage_won_id,
        "stage_lost_id": stage_lost_id,
        "other_pipeline_id": other_pipeline_id,
        "other_stage_id": other_stage_id,
    }


async def create_test_lead(pipeline_id: uuid.UUID, stage_id: uuid.UUID, assigned_to: uuid.UUID | None = None) -> CrmLead:
    """Helper to insert a single test lead."""
    sessionmaker = get_sessionmaker()
    phone = unique_phone()
    async with sessionmaker() as session:
        lead = CrmLead(
            id=uuid.uuid4(),
            lead_code=f"CRM-20261015-{uuid.uuid4().hex[:6].upper()}",
            name=f"Lead {uuid.uuid4().hex[:4]}",
            original_phone=phone,
            normalized_phone=f"+91{phone}",
            email=f"lead_{uuid.uuid4().hex[:4]}@corp.in",
            company_name="Apex Global",
            source_type="csv_import",
            pipeline_id=pipeline_id,
            stage_id=stage_id,
            assigned_to=assigned_to,
            status="new",
            priority="medium",
            created_by=ADMIN_ID,
        )
        session.add(lead)
        await session.commit()
        await session.refresh(lead)
        return lead


# =============================================================================
# 1. Activity Logging & last_contacted_at Updates
# =============================================================================


@pytest.mark.asyncio
async def test_activity_logging_and_last_contacted_update(
    client: AsyncClient, admin_headers: dict[str, str], setup_lifecycle_env: dict
):
    pipe_id = setup_lifecycle_env["pipeline_id"]
    stage_id = setup_lifecycle_env["stage_initial_id"]
    lead = await create_test_lead(pipe_id, stage_id, assigned_to=REP_A_ID)

    # 1. Log a phone call activity
    payload = {
        "activity_type": "call",
        "subject": "Introductory Discovery Call",
        "description": "Discussed client requirements, very interested in ERP modules.",
        "outcome": "interested",
    }
    res = await client.post(
        f"/api/v1/crm/leads/{lead.id}/activities",
        json=payload,
        headers=admin_headers,
    )
    assert res.status_code == 201
    act_data = res.json()["data"]
    assert act_data["activity_type"] == "call"
    assert act_data["subject"] == "Introductory Discovery Call"
    assert act_data["outcome"] == "interested"

    # Verify lead state: last_contacted_at updated, status advanced to contacted
    sessionmaker = get_sessionmaker()
    async with sessionmaker() as session:
        updated_lead = await session.get(CrmLead, lead.id)
        assert updated_lead is not None
        assert updated_lead.last_contacted_at is not None
        assert updated_lead.status == "contacted"

    # 2. List activities
    res_list = await client.get(
        f"/api/v1/crm/leads/{lead.id}/activities",
        headers=admin_headers,
    )
    assert res_list.status_code == 200
    list_body = res_list.json()["data"]
    assert list_body["total"] >= 1
    assert list_body["items"][0]["subject"] == "Introductory Discovery Call"


# =============================================================================
# 2. Follow-Up Scheduling & next_follow_up_at Recalculation
# =============================================================================


@pytest.mark.asyncio
async def test_follow_up_scheduling_and_recalculation(
    client: AsyncClient, admin_headers: dict[str, str], setup_lifecycle_env: dict
):
    pipe_id = setup_lifecycle_env["pipeline_id"]
    stage_id = setup_lifecycle_env["stage_initial_id"]
    lead = await create_test_lead(pipe_id, stage_id, assigned_to=REP_A_ID)

    now_utc = datetime.now(timezone.utc)
    t_tomorrow = now_utc + timedelta(days=1)
    t_today = now_utc + timedelta(hours=2)

    # 1. Schedule follow-up for tomorrow
    res1 = await client.post(
        f"/api/v1/crm/leads/{lead.id}/follow-ups",
        json={
            "due_at": t_tomorrow.isoformat(),
            "follow_up_type": "meeting",
            "notes": "Product demo meeting",
            "assigned_to": str(REP_A_ID),
        },
        headers=admin_headers,
    )
    assert res1.status_code == 201

    sessionmaker = get_sessionmaker()
    async with sessionmaker() as session:
        l1 = await session.get(CrmLead, lead.id)
        assert l1 is not None
        assert l1.next_follow_up_at is not None
        # Difference within seconds of t_tomorrow
        assert abs((l1.next_follow_up_at - t_tomorrow).total_seconds()) < 5

    # 2. Schedule earlier follow-up for today
    res2 = await client.post(
        f"/api/v1/crm/leads/{lead.id}/follow-ups",
        json={
            "due_at": t_today.isoformat(),
            "follow_up_type": "call",
            "notes": "Quick check-in call",
            "assigned_to": str(REP_A_ID),
        },
        headers=admin_headers,
    )
    assert res2.status_code == 201

    # Lead.next_follow_up_at should recalculate to the earlier today follow-up!
    async with sessionmaker() as session:
        l2 = await session.get(CrmLead, lead.id)
        assert l2 is not None
        assert abs((l2.next_follow_up_at - t_today).total_seconds()) < 5


# =============================================================================
# 3. Follow-Up Completion & Cancellation Dynamics
# =============================================================================


@pytest.mark.asyncio
async def test_follow_up_completion_creates_activity_and_recalculates(
    client: AsyncClient, admin_headers: dict[str, str], setup_lifecycle_env: dict
):
    pipe_id = setup_lifecycle_env["pipeline_id"]
    stage_id = setup_lifecycle_env["stage_initial_id"]
    lead = await create_test_lead(pipe_id, stage_id, assigned_to=REP_A_ID)

    now_utc = datetime.now(timezone.utc)
    earlier_due = now_utc + timedelta(hours=1)
    later_due = now_utc + timedelta(days=2)

    # Schedule follow-up 1 (earlier)
    res_fu1 = await client.post(
        f"/api/v1/crm/leads/{lead.id}/follow-ups",
        json={"due_at": earlier_due.isoformat(), "follow_up_type": "call", "notes": "Call 1"},
        headers=admin_headers,
    )
    fu1_id = res_fu1.json()["data"]["id"]

    # Schedule follow-up 2 (later)
    res_fu2 = await client.post(
        f"/api/v1/crm/leads/{lead.id}/follow-ups",
        json={"due_at": later_due.isoformat(), "follow_up_type": "demo", "notes": "Demo 2"},
        headers=admin_headers,
    )
    fu2_id = res_fu2.json()["data"]["id"]

    # 1. Complete follow-up 1
    res_comp = await client.patch(
        f"/api/v1/crm/follow-ups/{fu1_id}/status",
        json={"status": "completed", "completion_notes": "Completed discovery call successfully", "outcome": "connected"},
        headers=admin_headers,
    )
    assert res_comp.status_code == 200
    comp_body = res_comp.json()["data"]
    assert comp_body["status"] == "completed"
    assert comp_body["completed_at"] is not None

    sessionmaker = get_sessionmaker()
    async with sessionmaker() as session:
        # Check automatic activity touchpoint
        act = (
            await session.execute(
                select(CrmActivity).where(CrmActivity.lead_id == lead.id, CrmActivity.subject.contains("Completed"))
            )
        ).scalar_one_or_none()
        assert act is not None
        assert "Completed discovery call" in act.description

        # Next follow-up should now point to later_due (follow-up 2)
        l = await session.get(CrmLead, lead.id)
        assert l is not None
        assert abs((l.next_follow_up_at - later_due).total_seconds()) < 5

    # 2. Cancel follow-up 2
    res_canc = await client.patch(
        f"/api/v1/crm/follow-ups/{fu2_id}/status",
        json={"status": "cancelled"},
        headers=admin_headers,
    )
    assert res_canc.status_code == 200
    assert res_canc.json()["data"]["status"] == "cancelled"

    # Since no pending follow-ups remain, next_follow_up_at must be None
    async with sessionmaker() as session:
        l_none = await session.get(CrmLead, lead.id)
        assert l_none is not None
        assert l_none.next_follow_up_at is None


# =============================================================================
# 4. Business-Local Date-Boundary Filtering
# =============================================================================


@pytest.mark.asyncio
async def test_follow_up_date_boundary_filtering(
    client: AsyncClient, admin_headers: dict[str, str], setup_lifecycle_env: dict
):
    pipe_id = setup_lifecycle_env["pipeline_id"]
    stage_id = setup_lifecycle_env["stage_initial_id"]
    lead = await create_test_lead(pipe_id, stage_id, assigned_to=REP_A_ID)

    now_utc = datetime.now(timezone.utc)
    local_now = now_utc.astimezone(BUSINESS_TZ)
    local_today = local_now.date()
    local_today_start = datetime(
        local_today.year, local_today.month, local_today.day, 0, 0, 0, tzinfo=BUSINESS_TZ
    ).astimezone(timezone.utc)
    local_today_end = datetime(
        local_today.year, local_today.month, local_today.day, 23, 59, 59, 999999, tzinfo=BUSINESS_TZ
    ).astimezone(timezone.utc)

    # 1. Overdue (yesterday, 2 hours prior to local today start)
    dt_overdue = local_today_start - timedelta(hours=2)
    # 2. Today (mid-day today in local time)
    dt_today = local_today_start + timedelta(hours=5)
    # 3. Upcoming (tomorrow, 2 hours past local today end)
    dt_upcoming = local_today_end + timedelta(hours=2)

    await client.post(
        f"/api/v1/crm/leads/{lead.id}/follow-ups",
        json={"due_at": dt_overdue.isoformat(), "notes": "Overdue task", "assigned_to": str(REP_A_ID)},
        headers=admin_headers,
    )
    await client.post(
        f"/api/v1/crm/leads/{lead.id}/follow-ups",
        json={"due_at": dt_today.isoformat(), "notes": "Today task", "assigned_to": str(REP_A_ID)},
        headers=admin_headers,
    )
    await client.post(
        f"/api/v1/crm/leads/{lead.id}/follow-ups",
        json={"due_at": dt_upcoming.isoformat(), "notes": "Upcoming task", "assigned_to": str(REP_A_ID)},
        headers=admin_headers,
    )

    # Filter overdue
    res_ov = await client.get("/api/v1/crm/follow-ups?due_filter=overdue", headers=admin_headers)
    assert res_ov.status_code == 200
    ov_items = res_ov.json()["data"]["items"]
    assert any("Overdue task" in item["notes"] for item in ov_items)
    assert not any("Today task" in item["notes"] for item in ov_items)
    assert not any("Upcoming task" in item["notes"] for item in ov_items)

    # Filter today
    res_td = await client.get("/api/v1/crm/follow-ups?due_filter=today", headers=admin_headers)
    assert res_td.status_code == 200
    td_items = res_td.json()["data"]["items"]
    assert any("Today task" in item["notes"] for item in td_items)
    assert not any("Overdue task" in item["notes"] for item in td_items)
    assert not any("Upcoming task" in item["notes"] for item in td_items)

    # Filter upcoming
    res_up = await client.get("/api/v1/crm/follow-ups?due_filter=upcoming", headers=admin_headers)
    assert res_up.status_code == 200
    up_items = res_up.json()["data"]["items"]
    assert any("Upcoming task" in item["notes"] for item in up_items)
    assert not any("Today task" in item["notes"] for item in up_items)
    assert not any("Overdue task" in item["notes"] for item in up_items)


# =============================================================================
# 5. Stage Transitions: Won, Lost, and Mandatory Lost Reason
# =============================================================================


@pytest.mark.asyncio
async def test_stage_transition_won_and_lost_semantics(
    client: AsyncClient, admin_headers: dict[str, str], setup_lifecycle_env: dict
):
    pipe_id = setup_lifecycle_env["pipeline_id"]
    s_init = setup_lifecycle_env["stage_initial_id"]
    s_won = setup_lifecycle_env["stage_won_id"]
    s_lost = setup_lifecycle_env["stage_lost_id"]
    s_qual = setup_lifecycle_env["stage_qualified_id"]

    lead = await create_test_lead(pipe_id, s_init, assigned_to=REP_A_ID)

    # 1. Move to Won stage
    res_won = await client.post(
        f"/api/v1/crm/leads/{lead.id}/stage",
        json={"stage_id": str(s_won), "reason": "Customer accepted contract"},
        headers=admin_headers,
    )
    assert res_won.status_code == 200
    won_data = res_won.json()["data"]
    assert won_data["stage_type"] == "won"
    assert won_data["status"] == "won"

    sessionmaker = get_sessionmaker()
    async with sessionmaker() as session:
        l_won = await session.get(CrmLead, lead.id)
        assert l_won is not None
        assert l_won.won_at is not None
        assert l_won.lost_at is None

        # Verify CrmStageHistory record
        sh_won = (
            await session.execute(
                select(CrmStageHistory).where(CrmStageHistory.lead_id == lead.id, CrmStageHistory.to_stage_id == s_won)
            )
        ).scalar_one_or_none()
        assert sh_won is not None
        assert "Customer accepted contract" in sh_won.reason

    # 2. Reject transition to Lost stage if lost_reason is missing or too short
    res_invalid_lost = await client.post(
        f"/api/v1/crm/leads/{lead.id}/stage",
        json={"stage_id": str(s_lost), "lost_reason": " "},
        headers=admin_headers,
    )
    assert res_invalid_lost.status_code == 400
    assert "lost_reason" in res_invalid_lost.text.lower()

    # 3. Move to Lost with valid lost reason
    res_lost = await client.post(
        f"/api/v1/crm/leads/{lead.id}/stage",
        json={"stage_id": str(s_lost), "lost_reason": "Competitor gave 40% discount"},
        headers=admin_headers,
    )
    assert res_lost.status_code == 200
    lost_data = res_lost.json()["data"]
    assert lost_data["stage_type"] == "lost"
    assert lost_data["status"] == "lost"

    async with sessionmaker() as session:
        l_lost = await session.get(CrmLead, lead.id)
        assert l_lost is not None
        assert l_lost.lost_at is not None
        assert l_lost.won_at is None
        assert l_lost.lost_reason == "Competitor gave 40% discount"

    # 4. Reopen lead by moving to an open stage
    res_reopen = await client.post(
        f"/api/v1/crm/leads/{lead.id}/stage",
        json={"stage_id": str(s_qual), "reason": "Client returned for negotiation"},
        headers=admin_headers,
    )
    assert res_reopen.status_code == 200
    reopen_data = res_reopen.json()["data"]
    assert reopen_data["stage_type"] == "open"
    assert reopen_data["status"] == "in_progress"

    async with sessionmaker() as session:
        l_reopened = await session.get(CrmLead, lead.id)
        assert l_reopened is not None
        assert l_reopened.won_at is None
        assert l_reopened.lost_at is None
        assert l_reopened.lost_reason is None


# =============================================================================
# 6. Cross-Pipeline Protection
# =============================================================================


@pytest.mark.asyncio
async def test_cross_pipeline_stage_transition_rejected(
    client: AsyncClient, admin_headers: dict[str, str], setup_lifecycle_env: dict
):
    pipe_id = setup_lifecycle_env["pipeline_id"]
    s_init = setup_lifecycle_env["stage_initial_id"]
    other_stage_id = setup_lifecycle_env["other_stage_id"]

    lead = await create_test_lead(pipe_id, s_init, assigned_to=REP_A_ID)

    # Attempt cross-pipeline stage assignment
    res = await client.post(
        f"/api/v1/crm/leads/{lead.id}/stage",
        json={"stage_id": str(other_stage_id), "reason": "Attempt cross pipeline"},
        headers=admin_headers,
    )
    assert res.status_code == 400
    assert "cross-pipeline" in res.text.lower()


# =============================================================================
# 7. RBAC Scoping & Cross-User Mutation Prevention
# =============================================================================


@pytest.mark.asyncio
async def test_rbac_scoping_and_cross_user_forbidden(
    client: AsyncClient,
    rep_a_headers: dict[str, str],
    rep_b_headers: dict[str, str],
    manager_headers: dict[str, str],
    setup_lifecycle_env: dict,
):
    pipe_id = setup_lifecycle_env["pipeline_id"]
    s_init = setup_lifecycle_env["stage_initial_id"]
    s_qual = setup_lifecycle_env["stage_qualified_id"]

    # Lead strictly assigned to Rep A
    lead_a = await create_test_lead(pipe_id, s_init, assigned_to=REP_A_ID)

    # 1. Rep B cannot log activity on Rep A's lead
    res_act = await client.post(
        f"/api/v1/crm/leads/{lead_a.id}/activities",
        json={"activity_type": "call", "subject": "Sneak call"},
        headers=rep_b_headers,
    )
    assert res_act.status_code == 403

    # 2. Rep B cannot schedule follow-up on Rep A's lead
    res_fu = await client.post(
        f"/api/v1/crm/leads/{lead_a.id}/follow-ups",
        json={"due_at": (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()},
        headers=rep_b_headers,
    )
    assert res_fu.status_code == 403

    # 3. Rep B cannot transition stage on Rep A's lead
    res_st = await client.post(
        f"/api/v1/crm/leads/{lead_a.id}/stage",
        json={"stage_id": str(s_qual)},
        headers=rep_b_headers,
    )
    assert res_st.status_code == 403

    # 4. Rep A CAN log activity and schedule follow-up on their own lead
    res_rep_a = await client.post(
        f"/api/v1/crm/leads/{lead_a.id}/activities",
        json={"activity_type": "note", "subject": "Rep A personal note"},
        headers=rep_a_headers,
    )
    assert res_rep_a.status_code == 201

    # 5. Manager of Rep A CAN view and log activity on Rep A's lead
    res_mgr = await client.post(
        f"/api/v1/crm/leads/{lead_a.id}/activities",
        json={"activity_type": "note", "subject": "Manager review note"},
        headers=manager_headers,
    )
    assert res_mgr.status_code == 201

    # 6. Rep B querying another rep's follow-ups gets 403
    res_query_other = await client.get(
        f"/api/v1/crm/follow-ups?assigned_to={REP_A_ID}",
        headers=rep_b_headers,
    )
    assert res_query_other.status_code == 403


# =============================================================================
# 8. Unified Chronological Lead Timeline
# =============================================================================


@pytest.mark.asyncio
async def test_unified_lead_timeline(
    client: AsyncClient, admin_headers: dict[str, str], setup_lifecycle_env: dict
):
    pipe_id = setup_lifecycle_env["pipeline_id"]
    s_init = setup_lifecycle_env["stage_initial_id"]
    s_qual = setup_lifecycle_env["stage_qualified_id"]

    lead = await create_test_lead(pipe_id, s_init, assigned_to=REP_A_ID)

    # 1. Activity
    await client.post(
        f"/api/v1/crm/leads/{lead.id}/activities",
        json={"activity_type": "call", "subject": "Intro Phone Call"},
        headers=admin_headers,
    )

    # 2. Follow-up
    res_fu = await client.post(
        f"/api/v1/crm/leads/{lead.id}/follow-ups",
        json={"due_at": (datetime.now(timezone.utc) + timedelta(days=1)).isoformat(), "notes": "Contract review"},
        headers=admin_headers,
    )
    fu_id = res_fu.json()["data"]["id"]
    await client.patch(
        f"/api/v1/crm/follow-ups/{fu_id}/status",
        json={"status": "completed", "completion_notes": "Contract review completed"},
        headers=admin_headers,
    )

    # 3. Stage transition
    await client.post(
        f"/api/v1/crm/leads/{lead.id}/stage",
        json={"stage_id": str(s_qual), "reason": "Requirements verified"},
        headers=admin_headers,
    )

    # 4. Query Unified Timeline
    res_tl = await client.get(
        f"/api/v1/crm/leads/{lead.id}/timeline",
        headers=admin_headers,
    )
    assert res_tl.status_code == 200
    body = res_tl.json()["data"]
    assert body["lead_id"] == str(lead.id)
    items = body["items"]

    # Verify event types present
    timeline_types = {item["timeline_type"] for item in items}
    assert "activity" in timeline_types
    assert "follow_up" in timeline_types
    assert "stage_history" in timeline_types

    # Verify chronological ordering (descending)
    timestamps = [datetime.fromisoformat(item["timestamp"].replace("Z", "+00:00")) for item in items]
    assert timestamps == sorted(timestamps, reverse=True)


# =============================================================================
# 9. Phase 6, Step 3: Daily Work Metrics & Business Date Boundaries
# =============================================================================


@pytest.mark.asyncio
async def test_daily_work_summary_metrics_and_boundaries(
    client: AsyncClient,
    admin_headers: dict[str, str],
    rep_a_headers: dict[str, str],
    setup_lifecycle_env: dict,
):
    pipe_id = setup_lifecycle_env["pipeline_id"]
    s_init = setup_lifecycle_env["stage_initial_id"]
    s_won = setup_lifecycle_env["stage_won_id"]

    now_utc = datetime.now(timezone.utc)
    local_now = now_utc.astimezone(BUSINESS_TZ)
    local_today = local_now.date()
    local_today_start = datetime(
        local_today.year, local_today.month, local_today.day, 0, 0, 0, tzinfo=BUSINESS_TZ
    ).astimezone(timezone.utc)
    local_today_end = datetime(
        local_today.year, local_today.month, local_today.day, 23, 59, 59, 999999, tzinfo=BUSINESS_TZ
    ).astimezone(timezone.utc)

    # 1. Create Active Leads for Rep A
    lead_active_1 = await create_test_lead(pipe_id, s_init, assigned_to=REP_A_ID)
    lead_active_2 = await create_test_lead(pipe_id, s_init, assigned_to=REP_A_ID)

    # 2. Create Won Lead for Rep A (must not count towards active leads)
    lead_won = await create_test_lead(pipe_id, s_init, assigned_to=REP_A_ID)
    await client.post(
        f"/api/v1/crm/leads/{lead_won.id}/stage",
        json={"stage_id": str(s_won), "reason": "Won deal"},
        headers=admin_headers,
    )

    # 3. Create Follow-ups for Rep A
    sessionmaker = get_sessionmaker()
    async with sessionmaker() as session:
        # Overdue: due yesterday (pending)
        fu_overdue = CrmFollowUp(
            lead_id=lead_active_1.id,
            assigned_to=REP_A_ID,
            due_at=local_today_start - timedelta(hours=5),
            follow_up_type="call",
            notes="Overdue follow-up",
            status="pending",
            created_by=ADMIN_ID,
            created_at=now_utc,
            updated_at=now_utc,
        )
        # Due Today: noon today (pending)
        fu_today = CrmFollowUp(
            lead_id=lead_active_1.id,
            assigned_to=REP_A_ID,
            due_at=local_today_start + timedelta(hours=6),
            follow_up_type="meeting",
            notes="Today follow-up",
            status="pending",
            created_by=ADMIN_ID,
            created_at=now_utc,
            updated_at=now_utc,
        )
        # Upcoming: 2 days in future (pending)
        fu_upcoming = CrmFollowUp(
            lead_id=lead_active_2.id,
            assigned_to=REP_A_ID,
            due_at=local_today_end + timedelta(days=2),
            follow_up_type="demo",
            notes="Upcoming follow-up",
            status="pending",
            created_by=ADMIN_ID,
            created_at=now_utc,
            updated_at=now_utc,
        )
        # Completed Overdue (must not count towards overdue count)
        fu_completed = CrmFollowUp(
            lead_id=lead_active_2.id,
            assigned_to=REP_A_ID,
            due_at=local_today_start - timedelta(days=2),
            follow_up_type="call",
            notes="Already completed",
            status="completed",
            completed_at=now_utc,
            created_by=ADMIN_ID,
            created_at=now_utc,
            updated_at=now_utc,
        )
        session.add_all([fu_overdue, fu_today, fu_upcoming, fu_completed])
        await session.commit()

    # Query Daily Work Summary as Rep A
    res = await client.get("/api/v1/crm/daily-work/summary", headers=rep_a_headers)
    assert res.status_code == 200
    data = res.json()["data"]
    assert data["salesperson_id"] == str(REP_A_ID)
    assert data["overdue_follow_ups"] == 1
    assert data["due_today_follow_ups"] == 1
    assert data["upcoming_follow_ups"] == 1
    assert data["active_leads"] == 2  # lead_active_1 and lead_active_2, won lead excluded


# =============================================================================
# 10. Phase 6, Step 3: Salesperson API Isolation against Manipulated Queries
# =============================================================================


@pytest.mark.asyncio
async def test_salesperson_isolation_on_daily_work_and_team_oversight(
    client: AsyncClient,
    rep_a_headers: dict[str, str],
    setup_lifecycle_env: dict,
):
    # 1. Salesperson querying another rep's daily work summary -> 403 Forbidden
    res_dw_other = await client.get(
        f"/api/v1/crm/daily-work/summary?salesperson_id={REP_B_ID}",
        headers=rep_a_headers,
    )
    assert res_dw_other.status_code == 403
    assert "salespeople can only view their own" in res_dw_other.text.lower()

    # 2. Salesperson querying team oversight -> 403 Forbidden
    res_oversight = await client.get(
        "/api/v1/crm/team-oversight",
        headers=rep_a_headers,
    )
    assert res_oversight.status_code == 403
    assert "not authorized" in res_oversight.text.lower()

    # 3. Salesperson querying other rep's leads -> 403 Forbidden
    res_leads_other = await client.get(
        f"/api/v1/crm/leads?assigned_to={REP_B_ID}",
        headers=rep_a_headers,
    )
    assert res_leads_other.status_code == 403
    assert "salespeople can only query their own" in res_leads_other.text.lower()

    # 4. Salesperson querying other rep's follow-ups -> 403 Forbidden
    res_fu_other = await client.get(
        f"/api/v1/crm/follow-ups?assigned_to={REP_B_ID}",
        headers=rep_a_headers,
    )
    assert res_fu_other.status_code == 403
    assert "salespeople can only query their own" in res_fu_other.text.lower()


# =============================================================================
# 11. Phase 6, Step 3: Manager Team Oversight Scoping & Monthly Won/Lost
# =============================================================================


@pytest.mark.asyncio
async def test_manager_team_oversight_scoping_and_monthly_counts(
    client: AsyncClient,
    admin_headers: dict[str, str],
    manager_headers: dict[str, str],
    setup_lifecycle_env: dict,
):
    pipe_id = setup_lifecycle_env["pipeline_id"]
    s_init = setup_lifecycle_env["stage_initial_id"]
    s_qual = setup_lifecycle_env["stage_qualified_id"]
    s_won = setup_lifecycle_env["stage_won_id"]
    s_lost = setup_lifecycle_env["stage_lost_id"]

    now_utc = datetime.now(timezone.utc)
    local_now = now_utc.astimezone(BUSINESS_TZ)
    local_today = local_now.date()
    local_today_start = datetime(
        local_today.year, local_today.month, local_today.day, 0, 0, 0, tzinfo=BUSINESS_TZ
    ).astimezone(timezone.utc)

    # 1. Rep A: 1 active in New Lead, 1 active in Qualified, 1 Won in current month
    lead_a1 = await create_test_lead(pipe_id, s_init, assigned_to=REP_A_ID)
    lead_a2 = await create_test_lead(pipe_id, s_qual, assigned_to=REP_A_ID)
    lead_a_won = await create_test_lead(pipe_id, s_init, assigned_to=REP_A_ID)
    await client.post(
        f"/api/v1/crm/leads/{lead_a_won.id}/stage",
        json={"stage_id": str(s_won), "reason": "Contract signed"},
        headers=admin_headers,
    )

    # Follow-up for Rep A: 1 overdue
    sessionmaker = get_sessionmaker()
    async with sessionmaker() as session:
        fu_a_overdue = CrmFollowUp(
            lead_id=lead_a1.id,
            assigned_to=REP_A_ID,
            due_at=local_today_start - timedelta(hours=3),
            follow_up_type="call",
            notes="Overdue for Rep A",
            status="pending",
            created_by=ADMIN_ID,
            created_at=now_utc,
            updated_at=now_utc,
        )
        session.add(fu_a_overdue)
        await session.commit()

    # 2. Rep B: 1 active in Qualified, 1 Lost in current month
    lead_b1 = await create_test_lead(pipe_id, s_qual, assigned_to=REP_B_ID)
    lead_b_lost = await create_test_lead(pipe_id, s_init, assigned_to=REP_B_ID)
    await client.post(
        f"/api/v1/crm/leads/{lead_b_lost.id}/stage",
        json={"stage_id": str(s_lost), "lost_reason": "Budget eliminated"},
        headers=admin_headers,
    )

    # Follow-up for Rep B: 1 due today
    async with sessionmaker() as session:
        fu_b_today = CrmFollowUp(
            lead_id=lead_b1.id,
            assigned_to=REP_B_ID,
            due_at=local_today_start + timedelta(hours=4),
            follow_up_type="whatsapp",
            notes="Due today for Rep B",
            status="pending",
            created_by=ADMIN_ID,
            created_at=now_utc,
            updated_at=now_utc,
        )
        session.add(fu_b_today)
        await session.commit()

    # 3. Manager queries team oversight
    res_mgr = await client.get("/api/v1/crm/team-oversight", headers=manager_headers)
    assert res_mgr.status_code == 200
    mgr_body = res_mgr.json()["data"]
    assert mgr_body["scope_type"] == "team"
    reps = mgr_body["reps"]
    reps_by_id = {r["salesperson_id"]: r for r in reps}

    # Verify Rep A
    assert str(REP_A_ID) in reps_by_id
    rep_a_data = reps_by_id[str(REP_A_ID)]
    assert rep_a_data["active_lead_count"] == 2
    assert rep_a_data["overdue_follow_up_count"] == 1
    assert rep_a_data["due_today_follow_up_count"] == 0
    assert rep_a_data["month_won_count"] == 1
    assert rep_a_data["month_lost_count"] == 0
    # Stage distribution: 1 in New Lead, 1 in Qualified
    stage_names_a = {s["stage_name"]: s["count"] for s in rep_a_data["stage_distribution"]}
    assert stage_names_a.get("New Lead") == 1
    assert stage_names_a.get("Qualified") == 1

    # Verify Rep B
    assert str(REP_B_ID) in reps_by_id
    rep_b_data = reps_by_id[str(REP_B_ID)]
    assert rep_b_data["active_lead_count"] == 1
    assert rep_b_data["overdue_follow_up_count"] == 0
    assert rep_b_data["due_today_follow_up_count"] == 1
    assert rep_b_data["month_won_count"] == 0
    assert rep_b_data["month_lost_count"] == 1

    # Verify team totals
    assert mgr_body["total_active_leads"] >= 3
    assert mgr_body["total_overdue_follow_ups"] >= 1
    assert mgr_body["total_due_today_follow_ups"] >= 1
    assert mgr_body["total_month_won"] >= 1
    assert mgr_body["total_month_lost"] >= 1

    # 4. Manager queries scoped daily work for Rep A (succeeds)
    res_mgr_rep_a = await client.get(
        f"/api/v1/crm/daily-work/summary?salesperson_id={REP_A_ID}",
        headers=manager_headers,
    )
    assert res_mgr_rep_a.status_code == 200
    assert res_mgr_rep_a.json()["data"]["salesperson_id"] == str(REP_A_ID)

    # 5. Manager queries daily work for out-of-scope user (fails with 403)
    res_mgr_admin = await client.get(
        f"/api/v1/crm/daily-work/summary?salesperson_id={ADMIN_ID}",
        headers=manager_headers,
    )
    assert res_mgr_admin.status_code == 403
    assert "outside your departmental scope" in res_mgr_admin.text.lower()

    # 6. Admin queries company-wide team oversight
    res_admin = await client.get("/api/v1/crm/team-oversight", headers=admin_headers)
    assert res_admin.status_code == 200
    assert res_admin.json()["data"]["scope_type"] == "company_wide"

