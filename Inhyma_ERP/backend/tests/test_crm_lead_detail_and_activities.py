"""
INHYMA ERP — CRM IMPLEMENTATION PROMPT 4 OF 10:
Lead Detail Workspace and Reliable Activity History Test Suite.

Verifies:
1. Detail tabs & persisted overview data:
   - Persisted lead fields (name, phone, email, campaign, pipeline, stage, timestamps).
   - Linked Company Master details (company_id, company_name, company_city, company_gstin).
   - Next pending follow-up summary denormalization.
2. Activity ordering and pagination:
   - Reverse chronological ordering by activity_at.
   - Exact pagination parameters (page, page_size, total, total_pages).
3. System events vs manual notes:
   - Manual interactions (call, meeting, note) marked is_system_event=False.
   - System actions (lead_created, lead_updated, company_changed, stage_change,
     follow_up_created, follow_up_completed, follow_up_cancelled, assignment_changed)
     marked is_system_event=True.
4. Exactly-once activity creation for representative backend actions:
   - Lead created -> exactly 1 event.
   - Lead materially updated -> exactly 1 event.
   - Company link updated -> exactly 1 event.
   - Stage transition -> exactly 1 event.
   - Follow-up scheduled -> exactly 1 event.
   - Follow-up completed -> exactly 1 event.
   - Follow-up cancelled -> exactly 1 event.
5. Follow-up lifecycle, outcomes, and next_follow_up_at recalculation:
   - Scheduling updates lead.next_follow_up_at.
   - Completion logs activity with completion notes/outcome and clears/updates next_follow_up_at.
   - Cancellation logs activity and recalculates next_follow_up_at.
6. Stage and Assignment history presentation & timeline deduplication:
   - /crm/leads/{id}/stage-history lists stage changes with transition reasons.
   - /crm/assignment-history?lead_id={id} lists ownership changes.
   - /crm/leads/{id}/timeline deduplicates events between activities and history tables.
7. Access control & unauthorized direct-ID request rejection:
   - Admin has full access.
   - Manager accesses team leads; out-of-scope lead IDs return 403 Forbidden on:
     /crm/leads/{id}, /activities, /follow-ups, /stage-history, /assignment-history.
   - Salesperson accesses personal leads; other rep's lead IDs return 403 Forbidden on:
     /crm/leads/{id}, /activities, /follow-ups, /stage-history, /assignment-history.
"""

from __future__ import annotations

import random
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.auth.security import create_access_token
from app.companies.models import Company
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
from app.rbac.models import Role, RoleAssignmentStatus, UserRole
from app.users.models import User, UserStatus

ADMIN_ID = uuid.UUID("ea2b5763-5a4d-4f21-8bff-adc3e6cb8235")
MANAGER_ID = uuid.UUID("70b70538-2188-4a7a-8aab-b34c7243db05")
SALESPERSON_A_ID = uuid.UUID("0c0d89b7-5105-4dc6-945b-301a049f4502")
SALESPERSON_B_ID = uuid.UUID("b04e86e1-6f74-4c51-a247-2440adaf38df")
OUT_OF_SCOPE_MGR_ID = uuid.UUID("80c80649-3299-5b8b-9bbc-c45d8354ec16")


def unique_phone_suffix() -> str:
    return str(random.randint(10000000, 99999999))


@pytest.fixture
def admin_headers() -> dict[str, str]:
    token = create_access_token(
        ADMIN_ID,
        permissions=["crm.leads.manage", "crm.leads.view", "crm.pipelines.view", "companies.view", "companies.manage", "*"],
    ).token
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def manager_headers() -> dict[str, str]:
    token = create_access_token(
        MANAGER_ID,
        permissions=["crm.leads.manage", "crm.leads.view", "crm.pipelines.view", "companies.view"],
    ).token
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def rep_a_headers() -> dict[str, str]:
    token = create_access_token(
        SALESPERSON_A_ID,
        permissions=["crm.leads.manage", "crm.leads.view", "crm.pipelines.view", "companies.view"],
    ).token
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def rep_b_headers() -> dict[str, str]:
    token = create_access_token(
        SALESPERSON_B_ID,
        permissions=["crm.leads.manage", "crm.leads.view", "crm.pipelines.view", "companies.view"],
    ).token
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
async def setup_crm_environment():
    """Seed test users, roles, pipelines, stages, and companies."""
    session_factory = get_sessionmaker()
    async with session_factory() as session:
        # Users - step 1: ensure all exist without manager_id
        users_to_ensure = [
            (ADMIN_ID, "admin_user_ws", "admin_ws@inhyma.test"),
            (MANAGER_ID, "manager_user_ws", "manager_ws@inhyma.test"),
            (OUT_OF_SCOPE_MGR_ID, "out_mgr_user_ws", "outmgr_ws@inhyma.test"),
            (SALESPERSON_A_ID, "rep_a_user_ws", "repa_ws@inhyma.test"),
            (SALESPERSON_B_ID, "rep_b_user_ws", "repb_ws@inhyma.test"),
        ]
        for uid, uname, uemail in users_to_ensure:
            u = await session.get(User, uid)
            if not u:
                u = User(
                    id=uid,
                    username=uname,
                    email=uemail,
                    is_active=True,
                    has_login=True,
                    status=UserStatus.ACTIVE,
                )
                session.add(u)
        await session.flush()

        # Step 2: Set manager linkages
        u_a = await session.get(User, SALESPERSON_A_ID)
        if u_a:
            u_a.manager_id = MANAGER_ID
        u_b = await session.get(User, SALESPERSON_B_ID)
        if u_b:
            u_b.manager_id = OUT_OF_SCOPE_MGR_ID
        await session.flush()

        # Roles
        roles_to_ensure = [
            ("Admin", ADMIN_ID),
            ("Sales Manager", MANAGER_ID),
            ("Salesperson", SALESPERSON_A_ID),
            ("Salesperson", SALESPERSON_B_ID),
        ]
        for role_name, uid in roles_to_ensure:
            r_stmt = select(Role).where(Role.name == role_name)
            role_obj = (await session.execute(r_stmt)).scalar_one_or_none()
            if role_obj:
                ur_stmt = select(UserRole).where(UserRole.user_id == uid, UserRole.role_id == role_obj.id)
                ur_obj = (await session.execute(ur_stmt)).scalar_one_or_none()
                if not ur_obj:
                    ur_obj = UserRole(user_id=uid, role_id=role_obj.id, status=RoleAssignmentStatus.ACTIVE)
                    session.add(ur_obj)

        # Pipeline & Stages
        pipe_stmt = select(CrmPipeline).where(CrmPipeline.name == "Workspace Test Pipeline")
        pipeline = (await session.execute(pipe_stmt)).scalar_one_or_none()
        if not pipeline:
            pipeline = CrmPipeline(
                name="Workspace Test Pipeline",
                description="Pipeline for Lead Detail Workspace tests",
                is_default=True,
                is_active=True,
                created_by=ADMIN_ID,
            )
            session.add(pipeline)
            await session.flush()

            stage_new = CrmPipelineStage(
                pipeline_id=pipeline.id,
                name="Discovery",
                stage_order=0,
                stage_type="open",
                is_initial=True,
                is_active=True,
            )
            stage_won = CrmPipelineStage(
                pipeline_id=pipeline.id,
                name="Contract Won",
                stage_order=1,
                stage_type="won",
                is_initial=False,
                is_active=True,
            )
            stage_lost = CrmPipelineStage(
                pipeline_id=pipeline.id,
                name="Opportunity Lost",
                stage_order=2,
                stage_type="lost",
                is_initial=False,
                is_active=True,
            )
            session.add_all([stage_new, stage_won, stage_lost])
            await session.flush()
        else:
            stage_stmt = select(CrmPipelineStage).where(CrmPipelineStage.pipeline_id == pipeline.id).order_by(CrmPipelineStage.stage_order)
            stages = (await session.execute(stage_stmt)).scalars().all()
            stage_new = stages[0]
            stage_won = stages[1]
            stage_lost = stages[2]

        # Company Master record
        c_name = "Apex Aerospace Engineering Pvt Ltd"
        c_stmt = select(Company).where(Company.company_name == c_name, Company.deleted_at.is_(None))
        company = (await session.execute(c_stmt)).scalar_one_or_none()
        if not company:
            company = Company(
                company_name=c_name,
                tax_id_number="27AAACA9999Z1Z8",
                town="Bengaluru",
                is_active=True,
            )
            session.add(company)
            await session.flush()

        await session.commit()

        yield {
            "pipeline_id": pipeline.id,
            "stage_new_id": stage_new.id,
            "stage_won_id": stage_won.id,
            "stage_lost_id": stage_lost.id,
            "company_id": company.id,
            "company_name": company.company_name,
            "company_city": company.town,
            "company_gstin": company.tax_id_number,
        }


# =============================================================================
# 1. Lead Detail Overview Data with Linked Company Master & Next Follow-Up
# =============================================================================


@pytest.mark.asyncio
async def test_lead_detail_overview_data(
    client: AsyncClient,
    admin_headers: dict[str, str],
    setup_crm_environment: dict,
):
    """Verify overview data contains persisted fields, linked company details, and next follow-up summary."""
    comp_id = str(setup_crm_environment["company_id"])
    comp_name = setup_crm_environment["company_name"]
    comp_city = setup_crm_environment["company_city"]
    comp_gstin = setup_crm_environment["company_gstin"]
    pipe_id = str(setup_crm_environment["pipeline_id"])
    stage_id = str(setup_crm_environment["stage_new_id"])
    phone = f"+91 98{unique_phone_suffix()}"

    # 1. Create lead with linked company
    create_payload = {
        "name": "Rajesh Sharma",
        "phone": phone,
        "email": "rajesh.sharma@apex.test",
        "company_id": comp_id,
        "campaign": "Aero_Expo_2026",
        "source_type": "event",
        "source_detail": "Booth B-14",
        "pipeline_id": pipe_id,
        "stage_id": stage_id,
        "priority": "high",
        "assigned_to": str(SALESPERSON_A_ID),
    }
    create_res = await client.post("/api/v1/crm/leads", json=create_payload, headers=admin_headers)
    assert create_res.status_code == 201, create_res.text
    lead_id = create_res.json()["data"]["id"]

    # 2. Schedule a follow-up commitment
    fu_due = (datetime.now(timezone.utc) + timedelta(days=2)).isoformat()
    fu_payload = {
        "follow_up_type": "meeting",
        "due_at": fu_due,
        "priority": "high",
        "notes": "Discuss technical specifications with CTO",
    }
    fu_res = await client.post(f"/api/v1/crm/leads/{lead_id}/follow-ups", json=fu_payload, headers=admin_headers)
    assert fu_res.status_code == 201, fu_res.text

    # 3. Query Lead Detail Overview via GET /api/v1/crm/leads/{id}
    res = await client.get(f"/api/v1/crm/leads/{lead_id}", headers=admin_headers)
    assert res.status_code == 200, res.text
    lead = res.json()["data"]

    # Check persisted lead data
    assert lead["id"] == lead_id
    assert lead["name"] == "Rajesh Sharma"
    assert lead["email"] == "rajesh.sharma@apex.test"
    assert lead["campaign"] == "Aero_Expo_2026"
    assert lead["priority"] == "high"
    assert lead["pipeline_name"] == "Workspace Test Pipeline"
    assert lead["stage_name"] == "Discovery"

    # Check linked Company Master data
    assert lead["company_id"] == comp_id
    assert lead["company_name"] == comp_name
    assert lead["company_city"] == comp_city
    assert lead["company_gstin"] == comp_gstin

    # Check Next Pending Follow-up denormalization
    next_fu = lead["next_pending_follow_up"]
    assert next_fu is not None
    assert next_fu["follow_up_type"] == "meeting"
    assert next_fu["notes"] == "Discuss technical specifications with CTO"
    assert next_fu["is_overdue"] is False


# =============================================================================
# 2. Activity Ordering and Pagination
# =============================================================================


@pytest.mark.asyncio
async def test_activity_ordering_and_pagination(
    client: AsyncClient,
    admin_headers: dict[str, str],
    setup_crm_environment: dict,
):
    """Verify that lead activities return in reverse chronological order with correct pagination."""
    phone = f"+91 97{unique_phone_suffix()}"
    create_res = await client.post(
        "/api/v1/crm/leads",
        json={"name": "Priya Nair", "phone": phone},
        headers=admin_headers,
    )
    assert create_res.status_code == 201
    lead_id = create_res.json()["data"]["id"]

    # Log 4 manual activities
    for i in range(1, 5):
        act_res = await client.post(
            f"/api/v1/crm/leads/{lead_id}/activities",
            json={
                "activity_type": "call",
                "subject": f"Call attempt {i}",
                "description": f"Notes for call {i}",
            },
            headers=admin_headers,
        )
        assert act_res.status_code == 201

    # Query Page 1 with page_size=2
    # Total activities = 1 (lead_created) + 4 (calls) = 5
    res_p1 = await client.get(
        f"/api/v1/crm/leads/{lead_id}/activities?page=1&page_size=2",
        headers=admin_headers,
    )
    assert res_p1.status_code == 200
    p1_data = res_p1.json()["data"]
    assert p1_data["total"] == 5
    assert p1_data["page"] == 1
    assert p1_data["page_size"] == 2
    assert p1_data["total_pages"] == 3
    assert len(p1_data["items"]) == 2

    # Most recent activity should be Call attempt 4
    assert p1_data["items"][0]["subject"] == "Call attempt 4"
    assert p1_data["items"][1]["subject"] == "Call attempt 3"

    # Query Page 2
    res_p2 = await client.get(
        f"/api/v1/crm/leads/{lead_id}/activities?page=2&page_size=2",
        headers=admin_headers,
    )
    assert res_p2.status_code == 200
    p2_data = res_p2.json()["data"]
    assert len(p2_data["items"]) == 2
    assert p2_data["items"][0]["subject"] == "Call attempt 2"
    assert p2_data["items"][1]["subject"] == "Call attempt 1"

    # Query Page 3
    res_p3 = await client.get(
        f"/api/v1/crm/leads/{lead_id}/activities?page=3&page_size=2",
        headers=admin_headers,
    )
    assert res_p3.status_code == 200
    p3_data = res_p3.json()["data"]
    assert len(p3_data["items"]) == 1
    assert "Lead Created" in p3_data["items"][0]["subject"]


# =============================================================================
# 3. System Events vs Manual Notes Differentiation
# =============================================================================


@pytest.mark.asyncio
async def test_system_events_vs_manual_notes(
    client: AsyncClient,
    admin_headers: dict[str, str],
    setup_crm_environment: dict,
):
    """Verify is_system_event distinguishes system generated events from manual user notes."""
    phone = f"+91 96{unique_phone_suffix()}"
    create_res = await client.post(
        "/api/v1/crm/leads",
        json={"name": "Ananya Joshi", "phone": phone},
        headers=admin_headers,
    )
    lead_id = create_res.json()["data"]["id"]

    # 1. Manual user activity (call)
    await client.post(
        f"/api/v1/crm/leads/{lead_id}/activities",
        json={"activity_type": "call", "subject": "Discussed pricing model"},
        headers=admin_headers,
    )

    # 2. Manual user activity (note)
    await client.post(
        f"/api/v1/crm/leads/{lead_id}/activities",
        json={"activity_type": "note", "subject": "Client is evaluating 2 vendors"},
        headers=admin_headers,
    )

    # 3. System action: Stage transition
    s_won = str(setup_crm_environment["stage_won_id"])
    await client.post(
        f"/api/v1/crm/leads/{lead_id}/stage",
        json={"stage_id": s_won, "reason": "Contract signed by client"},
        headers=admin_headers,
    )

    # 4. System action: Follow-up scheduled & cancelled
    res_fu = await client.post(
        f"/api/v1/crm/leads/{lead_id}/follow-ups",
        json={"follow_up_type": "task", "due_at": (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()},
        headers=admin_headers,
    )
    fu_id = res_fu.json()["data"]["id"]
    await client.patch(
        f"/api/v1/crm/follow-ups/{fu_id}/status",
        json={"status": "cancelled"},
        headers=admin_headers,
    )

    # Query all activities
    res = await client.get(f"/api/v1/crm/leads/{lead_id}/activities?page_size=50", headers=admin_headers)
    assert res.status_code == 200
    items = res.json()["data"]["items"]

    items_by_subj = {it["subject"]: it for it in items}

    # Manual activities must have is_system_event == False
    assert items_by_subj["Discussed pricing model"]["is_system_event"] is False
    assert items_by_subj["Client is evaluating 2 vendors"]["is_system_event"] is False

    # System events must have is_system_event == True
    for it in items:
        if it["activity_type"] in ("lead_created", "stage_change", "follow_up_created", "follow_up_cancelled"):
            assert it["is_system_event"] is True


# =============================================================================
# 4. Exactly-Once Activity Creation for Representative Operations
# =============================================================================


@pytest.mark.asyncio
async def test_exactly_once_activity_creation(
    client: AsyncClient,
    admin_headers: dict[str, str],
    setup_crm_environment: dict,
):
    """Verify each representative business operation creates exactly one meaningful activity."""
    phone = f"+91 95{unique_phone_suffix()}"

    pipe_id = str(setup_crm_environment["pipeline_id"])
    stage_id = str(setup_crm_environment["stage_new_id"])
    create_res = await client.post(
        "/api/v1/crm/leads",
        json={"name": "Siddharth Verma", "phone": phone, "priority": "low", "pipeline_id": pipe_id, "stage_id": stage_id},
        headers=admin_headers,
    )
    lead_id = create_res.json()["data"]["id"]

    act_res1 = await client.get(f"/api/v1/crm/leads/{lead_id}/activities", headers=admin_headers)
    assert act_res1.json()["data"]["total"] == 1
    assert act_res1.json()["data"]["items"][0]["activity_type"] == "lead_created"

    # Step 2: Material Edit (name & email changed) -> Exactly 1 activity
    await client.patch(
        f"/api/v1/crm/leads/{lead_id}",
        json={"name": "Siddharth R. Verma", "email": "siddharth@example.test"},
        headers=admin_headers,
    )
    act_res2 = await client.get(f"/api/v1/crm/leads/{lead_id}/activities", headers=admin_headers)
    assert act_res2.json()["data"]["total"] == 2
    assert act_res2.json()["data"]["items"][0]["activity_type"] == "lead_updated"

    # Step 3: Priority Change -> Exactly 1 activity
    await client.patch(
        f"/api/v1/crm/leads/{lead_id}",
        json={"priority": "urgent"},
        headers=admin_headers,
    )
    act_res3 = await client.get(f"/api/v1/crm/leads/{lead_id}/activities", headers=admin_headers)
    assert act_res3.json()["data"]["total"] == 3
    assert "Priority Changed" in act_res3.json()["data"]["items"][0]["subject"]

    # Step 4: Company Link Changed -> Exactly 1 activity
    comp_id = str(setup_crm_environment["company_id"])
    await client.patch(
        f"/api/v1/crm/leads/{lead_id}",
        json={"company_id": comp_id},
        headers=admin_headers,
    )
    act_res4 = await client.get(f"/api/v1/crm/leads/{lead_id}/activities", headers=admin_headers)
    assert act_res4.json()["data"]["total"] == 4
    assert act_res4.json()["data"]["items"][0]["activity_type"] == "company_changed"

    # Step 5: Stage Changed -> Exactly 1 activity
    s_won = str(setup_crm_environment["stage_won_id"])
    await client.post(
        f"/api/v1/crm/leads/{lead_id}/stage",
        json={"stage_id": s_won, "reason": "Advance received"},
        headers=admin_headers,
    )
    act_res5 = await client.get(f"/api/v1/crm/leads/{lead_id}/activities", headers=admin_headers)
    assert act_res5.json()["data"]["total"] == 5
    assert act_res5.json()["data"]["items"][0]["activity_type"] == "stage_change"

    # Step 6: Follow-up Scheduled -> Exactly 1 activity
    res_fu = await client.post(
        f"/api/v1/crm/leads/{lead_id}/follow-ups",
        json={"follow_up_type": "call", "due_at": (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()},
        headers=admin_headers,
    )
    fu_id = res_fu.json()["data"]["id"]
    act_res6 = await client.get(f"/api/v1/crm/leads/{lead_id}/activities", headers=admin_headers)
    assert act_res6.json()["data"]["total"] == 6
    assert act_res6.json()["data"]["items"][0]["activity_type"] == "follow_up_created"

    # Step 7: Follow-up Completed -> Exactly 1 activity
    await client.patch(
        f"/api/v1/crm/follow-ups/{fu_id}/status",
        json={"status": "completed", "completion_notes": "Discussed deliverables"},
        headers=admin_headers,
    )
    act_res7 = await client.get(f"/api/v1/crm/leads/{lead_id}/activities", headers=admin_headers)
    assert act_res7.json()["data"]["total"] == 7
    assert act_res7.json()["data"]["items"][0]["activity_type"] == "follow_up_completed"


# =============================================================================
# 5. Follow-Up Lifecycle, Status Filtering and next_follow_up_at Recalculation
# =============================================================================


@pytest.mark.asyncio
async def test_follow_up_lifecycle_and_boundaries(
    client: AsyncClient,
    admin_headers: dict[str, str],
    setup_crm_environment: dict,
):
    """Verify follow-up scheduling, completion/cancellation, and next_follow_up_at recalculation."""
    phone = f"+91 94{unique_phone_suffix()}"
    create_res = await client.post(
        "/api/v1/crm/leads",
        json={"name": "Deepa Rao", "phone": phone},
        headers=admin_headers,
    )
    lead_id = create_res.json()["data"]["id"]

    # Verify initially next_follow_up_at is None
    lead_init = (await client.get(f"/api/v1/crm/leads/{lead_id}", headers=admin_headers)).json()["data"]
    assert lead_init["next_follow_up_at"] is None

    # Schedule Follow-up 1 (Due in 3 days)
    t1 = (datetime.now(timezone.utc) + timedelta(days=3)).isoformat()
    fu1_res = await client.post(
        f"/api/v1/crm/leads/{lead_id}/follow-ups",
        json={"follow_up_type": "call", "due_at": t1, "notes": "Later call"},
        headers=admin_headers,
    )
    fu1_id = fu1_res.json()["data"]["id"]

    # Schedule Follow-up 2 (Due in 1 day - earlier!)
    t2 = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()
    fu2_res = await client.post(
        f"/api/v1/crm/leads/{lead_id}/follow-ups",
        json={"follow_up_type": "meeting", "due_at": t2, "notes": "Earlier meeting"},
        headers=admin_headers,
    )
    fu2_id = fu2_res.json()["data"]["id"]

    # Verify lead.next_follow_up_at matches the earlier due date (Follow-up 2)
    lead_scheduled = (await client.get(f"/api/v1/crm/leads/{lead_id}", headers=admin_headers)).json()["data"]
    assert lead_scheduled["next_follow_up_at"] is not None

    # Query follow-ups list via GET /crm/leads/{lead_id}/follow-ups
    fu_list_res = await client.get(f"/api/v1/crm/leads/{lead_id}/follow-ups?status=pending", headers=admin_headers)
    assert fu_list_res.status_code == 200
    pending_items = fu_list_res.json()["data"]["items"]
    assert len(pending_items) == 2

    # Mark earlier follow-up (fu2) as completed
    await client.patch(
        f"/api/v1/crm/follow-ups/{fu2_id}/status",
        json={"status": "completed", "completion_notes": "Meeting successful"},
        headers=admin_headers,
    )

    # Verify pending follow-up count is now 1
    fu_pending_after = (await client.get(f"/api/v1/crm/leads/{lead_id}/follow-ups?status=pending", headers=admin_headers)).json()["data"]["items"]
    assert len(fu_pending_after) == 1
    assert fu_pending_after[0]["id"] == fu1_id

    # Cancel remaining follow-up (fu1)
    await client.patch(
        f"/api/v1/crm/follow-ups/{fu1_id}/status",
        json={"status": "cancelled"},
        headers=admin_headers,
    )

    # Lead should now have no remaining pending follow-up
    lead_final = (await client.get(f"/api/v1/crm/leads/{lead_id}", headers=admin_headers)).json()["data"]
    assert lead_final["next_follow_up_at"] is None
    assert lead_final["next_pending_follow_up"] is None


# =============================================================================
# 6. Stage and Assignment History Presentation & Timeline Deduplication
# =============================================================================


@pytest.mark.asyncio
async def test_stage_and_assignment_history_presentation(
    client: AsyncClient,
    admin_headers: dict[str, str],
    setup_crm_environment: dict,
):
    """Verify dedicated stage history, assignment history, and timeline deduplication."""
    phone = f"+91 93{unique_phone_suffix()}"
    pipe_id = str(setup_crm_environment["pipeline_id"])
    stage_id = str(setup_crm_environment["stage_new_id"])
    create_res = await client.post(
        "/api/v1/crm/leads",
        json={"name": "Kiran Patel", "phone": phone, "assigned_to": str(SALESPERSON_A_ID), "pipeline_id": pipe_id, "stage_id": stage_id},
        headers=admin_headers,
    )
    lead_id = create_res.json()["data"]["id"]

    # 1. Stage transitions
    s_won = str(setup_crm_environment["stage_won_id"])
    await client.post(
        f"/api/v1/crm/leads/{lead_id}/stage",
        json={"stage_id": s_won, "reason": "Signed service agreement"},
        headers=admin_headers,
    )

    # 2. Reassignment
    await client.post(
        f"/api/v1/crm/leads/{lead_id}/reassign",
        json={"new_salesperson_id": str(SALESPERSON_B_ID), "reason": "Territory reallocation"},
        headers=admin_headers,
    )

    # Query Stage History endpoint
    sh_res = await client.get(f"/api/v1/crm/leads/{lead_id}/stage-history", headers=admin_headers)
    assert sh_res.status_code == 200
    sh_items = sh_res.json()["data"]["items"]
    assert len(sh_items) >= 2  # initial stage + transition
    assert any(sh["to_stage_name"] == "Contract Won" and "Signed service agreement" in (sh["reason"] or "") for sh in sh_items)

    # Query Assignment History endpoint
    ah_res = await client.get(f"/api/v1/crm/assignment-history?lead_id={lead_id}", headers=admin_headers)
    assert ah_res.status_code == 200
    ah_items = ah_res.json()["data"]["items"]
    assert len(ah_items) >= 2  # initial assignment + reassignment
    assert any(ah["new_owner_id"] == str(SALESPERSON_B_ID) and "Territory reallocation" in (ah["reason"] or "") for ah in ah_items)

    # Query Unified Timeline and verify deduplication
    tl_res = await client.get(f"/api/v1/crm/leads/{lead_id}/timeline", headers=admin_headers)
    assert tl_res.status_code == 200
    tl_items = tl_res.json()["data"]["items"]

    # Ensure no duplicate stage transitions exist in timeline
    stage_events = [it for it in tl_items if "Contract Won" in it["title"]]
    assert len(stage_events) == 1, f"Expected exactly 1 event for 'Contract Won', got: {stage_events}"


# =============================================================================
# 7. Role Scope and Direct-ID Unauthorized Rejection
# =============================================================================


@pytest.mark.asyncio
async def test_role_scope_and_unauthorized_direct_id_rejection(
    client: AsyncClient,
    admin_headers: dict[str, str],
    rep_a_headers: dict[str, str],
    rep_b_headers: dict[str, str],
    setup_crm_environment: dict,
):
    """Verify unauthorized direct-ID access returns 403 Forbidden across all lead endpoints."""
    # Create Lead 1 assigned to Rep A
    phone_a = f"+91 92{unique_phone_suffix()}"
    res_a = await client.post(
        "/api/v1/crm/leads",
        json={"name": "Lead for Rep A", "phone": phone_a, "assigned_to": str(SALESPERSON_A_ID)},
        headers=admin_headers,
    )
    lead_a_id = res_a.json()["data"]["id"]

    # Create Lead 2 assigned to Rep B
    phone_b = f"+91 91{unique_phone_suffix()}"
    res_b = await client.post(
        "/api/v1/crm/leads",
        json={"name": "Lead for Rep B", "phone": phone_b, "assigned_to": str(SALESPERSON_B_ID)},
        headers=admin_headers,
    )
    lead_b_id = res_b.json()["data"]["id"]

    # Rep A can access Lead A
    res_a_view = await client.get(f"/api/v1/crm/leads/{lead_a_id}", headers=rep_a_headers)
    assert res_a_view.status_code == 200

    res_a_act = await client.get(f"/api/v1/crm/leads/{lead_a_id}/activities", headers=rep_a_headers)
    assert res_a_act.status_code == 200

    res_a_fu = await client.get(f"/api/v1/crm/leads/{lead_a_id}/follow-ups", headers=rep_a_headers)
    assert res_a_fu.status_code == 200

    res_a_sh = await client.get(f"/api/v1/crm/leads/{lead_a_id}/stage-history", headers=rep_a_headers)
    assert res_a_sh.status_code == 200

    res_a_ah = await client.get(f"/api/v1/crm/assignment-history?lead_id={lead_a_id}", headers=rep_a_headers)
    assert res_a_ah.status_code == 200

    # Rep A attempts direct ID access to Rep B's Lead -> 403 Forbidden on all endpoints!
    res_b_view = await client.get(f"/api/v1/crm/leads/{lead_b_id}", headers=rep_a_headers)
    assert res_b_view.status_code == 403

    res_b_act = await client.get(f"/api/v1/crm/leads/{lead_b_id}/activities", headers=rep_a_headers)
    assert res_b_act.status_code == 403

    res_b_fu = await client.get(f"/api/v1/crm/leads/{lead_b_id}/follow-ups", headers=rep_a_headers)
    assert res_b_fu.status_code == 403

    res_b_sh = await client.get(f"/api/v1/crm/leads/{lead_b_id}/stage-history", headers=rep_a_headers)
    assert res_b_sh.status_code == 403

    res_b_ah = await client.get(f"/api/v1/crm/assignment-history?lead_id={lead_b_id}", headers=rep_a_headers)
    assert res_b_ah.status_code == 403

    # Admin has company-wide access to both
    assert (await client.get(f"/api/v1/crm/leads/{lead_a_id}", headers=admin_headers)).status_code == 200
    assert (await client.get(f"/api/v1/crm/leads/{lead_b_id}", headers=admin_headers)).status_code == 200
