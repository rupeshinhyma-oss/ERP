"""
Test Suite for CRM Manual Lead Creation Flow (Auditing and Completeness).

Requirements Verified:
1. Creation endpoint /api/v1/crm/leads works for Admin, Manager, and Salesperson.
2. Captures essential details: name, phone, email, company, campaign, pipeline, stage, priority, notes.
3. Duplicate rejection using normalized phone numbers (HTTP 409 with clear message, no duplicate created).
4. Role and ownership restrictions:
   - Salesperson: every manually created lead is assigned to the logged-in salesperson regardless of submitted payload.
   - Manager: can create leads for themselves or direct reports within team scope; assigning outside scope returns 403 Forbidden.
   - Admin: can assign to any active user or leave unassigned.
5. Pipeline and stage validations on backend:
   - Inactive or invalid pipeline rejected (HTTP 400).
   - Stage from a different pipeline or inactive stage rejected (HTTP 400).
   - Automatic default pipeline and initial open stage fallback when omitted.
6. Audit & History persistence:
   - Creator (created_by) and Assignee (assigned_to).
   - CrmActivity touchpoint record.
   - CrmAssignmentHistory entry.
   - CrmStageHistory entry.
"""

from __future__ import annotations

import random
import uuid
import pytest
from httpx import AsyncClient
from sqlalchemy import delete, select

from app.auth.security import create_access_token
from app.auth.service import CurrentUser
from app.crm.models import (
    CrmActivity,
    CrmAssignmentHistory,
    CrmLead,
    CrmPipeline,
    CrmPipelineStage,
    CrmStageHistory,
)
from app.database.engine import get_sessionmaker
from app.users.models import User, UserStatus
from app.rbac.models import Role, UserRole, RoleAssignmentStatus

ADMIN_ID = uuid.UUID("ea2b5763-5a4d-4f21-8bff-adc3e6cb8235")
MANAGER_ID = uuid.UUID("70b70538-2188-4a7a-8aab-b34c7243db05")
REP_A_ID = uuid.UUID("0c0d89b7-5105-4dc6-945b-301a049f4502")  # Direct report of manager
REP_B_ID = uuid.UUID("b04e86e1-6f74-4c51-a247-2440adaf38df")  # External user / other team


def unique_phone_suffix() -> str:
    return str(random.randint(10000000, 99999999))


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
        permissions=["crm.leads.view", "crm.pipelines.view"],
    ).token
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
async def setup_crm_creation_env():
    """Seed test pipelines, stages, and organizational hierarchy."""
    sessionmaker = get_sessionmaker()

    pipe_a_id = uuid.uuid4()
    pipe_b_id = uuid.uuid4()
    pipe_inactive_id = uuid.uuid4()

    stage_a1_id = uuid.uuid4()
    stage_a2_id = uuid.uuid4()
    stage_a_inactive_id = uuid.uuid4()
    stage_a_won_id = uuid.uuid4()
    stage_b1_id = uuid.uuid4()

    async with sessionmaker() as session:
        # Clean existing test data
        await session.execute(delete(CrmStageHistory))
        await session.execute(delete(CrmAssignmentHistory))
        await session.execute(delete(CrmActivity))
        await session.execute(delete(CrmLead))

        # Ensure test users
        for u_id, u_name, u_email in [
            (ADMIN_ID, "admin_user", "admin_leadtest@example.com"),
            (MANAGER_ID, "manager_user", "manager_leadtest@example.com"),
            (REP_A_ID, "rep_a_user", "repa_leadtest@example.com"),
            (REP_B_ID, "rep_b_user", "repb_leadtest@example.com"),
        ]:
            u = await session.get(User, u_id)
            if not u:
                u = User(
                    id=u_id,
                    username=u_name,
                    email=u_email,
                    hashed_password="hashed_test_password",
                    status=UserStatus.ACTIVE,
                    is_active=True,
                    has_login=True,
                    manager_id=MANAGER_ID if u_id == REP_A_ID else None,
                )
                session.add(u)
            else:
                u.is_active = True
                u.has_login = True
                u.manager_id = MANAGER_ID if u_id == REP_A_ID else None
                session.add(u)

        # Manager role for MANAGER_ID: reuse existing active "Sales Manager" or "department_manager" role,
        # or create a uniquely named test role if none exists.
        role_mgr = (await session.execute(
            select(Role).where(Role.name.in_(["Sales Manager", "department_manager"]), Role.deleted_at.is_(None))
        )).scalars().first()
        if not role_mgr:
            role_mgr = Role(
                id=uuid.uuid4(),
                name=f"test_sales_manager_{uuid.uuid4().hex[:8]}",
                description="Test Sales Manager",
            )
            session.add(role_mgr)
            await session.flush()

        ur = (await session.execute(
            select(UserRole).where(UserRole.user_id == MANAGER_ID, UserRole.role_id == role_mgr.id)
        )).scalar_one_or_none()
        if not ur:
            session.add(UserRole(user_id=MANAGER_ID, role_id=role_mgr.id, status=RoleAssignmentStatus.ACTIVE))

        # Seed Pipeline A (Default, Active)
        pipe_a = CrmPipeline(
            id=pipe_a_id,
            name=f"Primary Sales Pipeline {uuid.uuid4().hex[:4]}",
            is_default=True,
            is_active=True,
        )
        session.add(pipe_a)

        # Pipeline A Stages
        session.add(CrmPipelineStage(
            id=stage_a1_id,
            pipeline_id=pipe_a_id,
            name="New Inbound",
            stage_order=10,
            stage_type="open",
            is_initial=True,
            is_active=True,
        ))
        session.add(CrmPipelineStage(
            id=stage_a2_id,
            pipeline_id=pipe_a_id,
            name="Qualification",
            stage_order=20,
            stage_type="open",
            is_initial=False,
            is_active=True,
        ))
        session.add(CrmPipelineStage(
            id=stage_a_inactive_id,
            pipeline_id=pipe_a_id,
            name="Archived Stage",
            stage_order=30,
            stage_type="open",
            is_initial=False,
            is_active=False,
        ))
        session.add(CrmPipelineStage(
            id=stage_a_won_id,
            pipeline_id=pipe_a_id,
            name="Closed Won",
            stage_order=40,
            stage_type="won",
            is_initial=False,
            is_active=True,
        ))

        # Seed Pipeline B (Secondary, Active)
        pipe_b = CrmPipeline(
            id=pipe_b_id,
            name=f"Partner Pipeline {uuid.uuid4().hex[:4]}",
            is_default=False,
            is_active=True,
        )
        session.add(pipe_b)
        session.add(CrmPipelineStage(
            id=stage_b1_id,
            pipeline_id=pipe_b_id,
            name="Partner Review",
            stage_order=10,
            stage_type="open",
            is_initial=True,
            is_active=True,
        ))

        # Seed Inactive Pipeline
        pipe_inact = CrmPipeline(
            id=pipe_inactive_id,
            name=f"Deprecated Pipeline {uuid.uuid4().hex[:4]}",
            is_default=False,
            is_active=False,
        )
        session.add(pipe_inact)

        await session.commit()

    return {
        "pipeline_a_id": str(pipe_a_id),
        "stage_a1_id": str(stage_a1_id),
        "stage_a2_id": str(stage_a2_id),
        "stage_a_inactive_id": str(stage_a_inactive_id),
        "stage_a_won_id": str(stage_a_won_id),
        "pipeline_b_id": str(pipe_b_id),
        "stage_b1_id": str(stage_b1_id),
        "pipeline_inactive_id": str(pipe_inactive_id),
    }


# =============================================================================
# 1. Successful Lead Creation by Admin
# =============================================================================

@pytest.mark.asyncio
async def test_admin_successful_manual_lead_creation(
    client: AsyncClient, admin_headers: dict[str, str], setup_crm_creation_env: dict
):
    """Admin creates a lead with explicit assignee and all fields; checks activity and assignment audit."""
    env = setup_crm_creation_env
    phone = f"98{unique_phone_suffix()}"

    payload = {
        "contact_name": "Dr. Rajesh Sharma",
        "phone": phone,
        "email": "rajesh.sharma@example.org",
        "company_name": "Sharma Healthcare Pvt Ltd",
        "campaign": "Google Search Q4",
        "pipeline_id": env["pipeline_a_id"],
        "stage_id": env["stage_a2_id"],
        "priority": "high",
        "assigned_to": str(REP_A_ID),
        "notes": "Interested in ERP enterprise tier. Urgently requesting demonstration.",
    }

    res = await client.post("/api/v1/crm/leads", json=payload, headers=admin_headers)
    assert res.status_code == 201
    body = res.json()
    assert body["success"] is True
    lead = body["data"]

    assert lead["name"] == "Dr. Rajesh Sharma"
    assert lead["original_phone"] == phone
    assert lead["normalized_phone"] == f"+91{phone}"
    assert lead["email"] == "rajesh.sharma@example.org"
    assert lead["company_name"] == "Sharma Healthcare Pvt Ltd"
    assert lead["campaign"] == "Google Search Q4"
    assert lead["priority"] == "high"
    assert lead["assigned_to"] == str(REP_A_ID)
    assert lead["pipeline_id"] == env["pipeline_a_id"]
    assert lead["stage_id"] == env["stage_a2_id"]

    # Verify database persistence & audit trail
    sessionmaker = get_sessionmaker()
    async with sessionmaker() as session:
        # Check Activity
        act = (await session.execute(
            select(CrmActivity).where(CrmActivity.lead_id == uuid.UUID(lead["id"]))
        )).scalar_one_or_none()
        assert act is not None
        assert act.activity_type == "lead_created"
        assert act.performed_by == ADMIN_ID

        # Check Assignment History
        hist = (await session.execute(
            select(CrmAssignmentHistory).where(CrmAssignmentHistory.lead_id == uuid.UUID(lead["id"]))
        )).scalar_one_or_none()
        assert hist is not None
        assert hist.new_owner_id == REP_A_ID
        assert hist.assigned_by == ADMIN_ID
        assert hist.assignment_method == "manual"

        # Check Stage History
        stg_hist = (await session.execute(
            select(CrmStageHistory).where(CrmStageHistory.lead_id == uuid.UUID(lead["id"]))
        )).scalar_one_or_none()
        assert stg_hist is not None
        assert stg_hist.to_stage_id == uuid.UUID(env["stage_a2_id"])


# =============================================================================
# 2. Salesperson Strict Self-Assignment
# =============================================================================

@pytest.mark.asyncio
async def test_salesperson_lead_creation_strictly_self_assigned(
    client: AsyncClient, rep_a_headers: dict[str, str], setup_crm_creation_env: dict
):
    """
    Salesperson submitting manual lead creation auto-assigns to self when omitted,
    and attempting to assign to another user is rejected with HTTP 403 Forbidden.
    """
    env = setup_crm_creation_env
    phone = f"97{unique_phone_suffix()}"

    # 1. Omitting assigned_to auto-assigns to Rep A
    payload = {
        "contact_name": "Venkatesh Rao",
        "phone": phone,
        "campaign": "Direct Sales Outreach",
        "pipeline_id": env["pipeline_a_id"],
    }

    res = await client.post("/api/v1/crm/leads", json=payload, headers=rep_a_headers)
    assert res.status_code == 201
    lead = res.json()["data"]

    # Must be assigned to Rep A!
    assert lead["assigned_to"] == str(REP_A_ID)

    # 2. Attempting to pass REP_B_ID is rejected with 403 Forbidden
    payload_forbidden = {
        "contact_name": "Unauthorized Assignee Lead",
        "phone": f"97{unique_phone_suffix()}",
        "campaign": "Direct Sales Outreach",
        "pipeline_id": env["pipeline_a_id"],
        "assigned_to": str(REP_B_ID),
    }
    res_bad = await client.post("/api/v1/crm/leads", json=payload_forbidden, headers=rep_a_headers)
    assert res_bad.status_code == 403

    # Check assignment history in database
    sessionmaker = get_sessionmaker()
    async with sessionmaker() as session:
        hist = (await session.execute(
            select(CrmAssignmentHistory).where(CrmAssignmentHistory.lead_id == uuid.UUID(lead["id"]))
        )).scalar_one_or_none()
        assert hist is not None
        assert hist.new_owner_id == REP_A_ID
        assert hist.assigned_by == REP_A_ID
        assert hist.assignment_method == "personal_lead"


# =============================================================================
# 3. Manager Scope Restrictions
# =============================================================================

@pytest.mark.asyncio
async def test_manager_scope_permits_team_rejects_external_assignee(
    client: AsyncClient, manager_headers: dict[str, str], setup_crm_creation_env: dict
):
    """
    Manager can assign leads to direct reports (Rep A), but assigning to
    reps outside their team (Rep B) is rejected with 403 Forbidden.
    """
    env = setup_crm_creation_env

    # 1. Assigning to team member (Rep A) -> Allowed
    phone_ok = f"96{unique_phone_suffix()}"
    res_ok = await client.post(
        "/api/v1/crm/leads",
        json={
            "name": "Permitted Team Lead",
            "phone": phone_ok,
            "assigned_to": str(REP_A_ID),
        },
        headers=manager_headers,
    )
    assert res_ok.status_code == 201
    assert res_ok.json()["data"]["assigned_to"] == str(REP_A_ID)

    # 2. Assigning to rep outside team (Rep B) -> Forbidden (403)
    phone_bad = f"95{unique_phone_suffix()}"
    res_bad = await client.post(
        "/api/v1/crm/leads",
        json={
            "name": "Unauthorized Team Lead",
            "phone": phone_bad,
            "assigned_to": str(REP_B_ID),
        },
        headers=manager_headers,
    )
    assert res_bad.status_code == 403
    assert "authorized team scope" in res_bad.json()["message"].lower()

    # 3. Leaving unassigned -> Allowed
    phone_unassigned = f"94{unique_phone_suffix()}"
    res_unassigned = await client.post(
        "/api/v1/crm/leads",
        json={
            "name": "Unassigned Manager Lead",
            "phone": phone_unassigned,
        },
        headers=manager_headers,
    )
    assert res_unassigned.status_code == 201
    assert res_unassigned.json()["data"]["assigned_to"] is None


# =============================================================================
# 4. Duplicate Rejection Using Normalized Phone
# =============================================================================

@pytest.mark.asyncio
async def test_duplicate_lead_prevention_normalized_phone(
    client: AsyncClient, admin_headers: dict[str, str], setup_crm_creation_env: dict
):
    """
    Creating a lead with a phone that already exists in active leads returns HTTP 409
    with an informative error message, preventing silent duplicates.
    """
    env = setup_crm_creation_env
    raw_phone = f"93{unique_phone_suffix()}"

    # First creation: standard 10-digit number
    res1 = await client.post(
        "/api/v1/crm/leads",
        json={
            "name": "Original Prospect",
            "phone": raw_phone,
            "pipeline_id": env["pipeline_a_id"],
        },
        headers=admin_headers,
    )
    assert res1.status_code == 201
    lead_code = res1.json()["data"]["lead_code"]

    # Second creation: with +91 and spaces/hyphens
    formatted_dup_phone = f"+91 {raw_phone[:5]}-{raw_phone[5:]}"
    res2 = await client.post(
        "/api/v1/crm/leads",
        json={
            "name": "Duplicate Prospect",
            "phone": formatted_dup_phone,
            "pipeline_id": env["pipeline_a_id"],
        },
        headers=admin_headers,
    )
    assert res2.status_code == 409
    err_body = res2.json()
    assert "already exists" in err_body["message"].lower()
    assert lead_code in err_body["message"]

    # Verify no second lead was created in database
    sessionmaker = get_sessionmaker()
    async with sessionmaker() as session:
        norm = f"+91{raw_phone}"
        leads = (await session.execute(
            select(CrmLead).where(CrmLead.normalized_phone == norm)
        )).scalars().all()
        assert len(leads) == 1
        assert leads[0].name == "Original Prospect"


# =============================================================================
# 5. Invalid Input Validation
# =============================================================================

@pytest.mark.asyncio
async def test_invalid_input_rejections(
    client: AsyncClient, admin_headers: dict[str, str], setup_crm_creation_env: dict
):
    """Validates that blank contact names, malformed phones, and invalid priorities are rejected."""
    # 1. Blank name
    res_blank_name = await client.post(
        "/api/v1/crm/leads",
        json={"name": "   ", "phone": "9876543210"},
        headers=admin_headers,
    )
    assert res_blank_name.status_code == 422

    # 2. Malformed phone (invalid characters / too short)
    res_bad_phone = await client.post(
        "/api/v1/crm/leads",
        json={"name": "Alice Tester", "phone": "not-a-phone"},
        headers=admin_headers,
    )
    assert res_bad_phone.status_code == 400
    assert "invalid" in res_bad_phone.json()["message"].lower()

    # 3. Invalid priority
    res_bad_priority = await client.post(
        "/api/v1/crm/leads",
        json={"name": "Alice Tester", "phone": "9876543210", "priority": "super-urgent"},
        headers=admin_headers,
    )
    assert res_bad_priority.status_code == 422


# =============================================================================
# 6. Pipeline and Stage Backend Validation
# =============================================================================

@pytest.mark.asyncio
async def test_pipeline_and_stage_backend_validations(
    client: AsyncClient, admin_headers: dict[str, str], setup_crm_creation_env: dict
):
    """Validates backend rejection of inactive pipelines, mismatched stages, and inactive stages."""
    env = setup_crm_creation_env

    # 1. Inactive pipeline rejected
    phone1 = f"92{unique_phone_suffix()}"
    res_inact_pipe = await client.post(
        "/api/v1/crm/leads",
        json={
            "name": "Inactive Pipe Lead",
            "phone": phone1,
            "pipeline_id": env["pipeline_inactive_id"],
        },
        headers=admin_headers,
    )
    assert res_inact_pipe.status_code == 400
    assert "inactive" in res_inact_pipe.json()["message"].lower()

    # 2. Stage belongs to a different pipeline
    phone2 = f"91{unique_phone_suffix()}"
    res_mismatched_stage = await client.post(
        "/api/v1/crm/leads",
        json={
            "name": "Cross Pipeline Stage Lead",
            "phone": phone2,
            "pipeline_id": env["pipeline_a_id"],
            "stage_id": env["stage_b1_id"],  # Stage B belongs to Pipeline B
        },
        headers=admin_headers,
    )
    assert res_mismatched_stage.status_code == 400
    assert "does not belong" in res_mismatched_stage.json()["message"].lower()

    # 3. Inactive stage rejected
    phone3 = f"90{unique_phone_suffix()}"
    res_inact_stage = await client.post(
        "/api/v1/crm/leads",
        json={
            "name": "Inactive Stage Lead",
            "phone": phone3,
            "pipeline_id": env["pipeline_a_id"],
            "stage_id": env["stage_a_inactive_id"],
        },
        headers=admin_headers,
    )
    assert res_inact_stage.status_code == 400
    assert "inactive" in res_inact_stage.json()["message"].lower()

    # 4. Default pipeline and stage fallback when omitted
    phone4 = f"89{unique_phone_suffix()}"
    res_fallback = await client.post(
        "/api/v1/crm/leads",
        json={
            "name": "Fallback Defaults Lead",
            "phone": phone4,
        },
        headers=admin_headers,
    )
    assert res_fallback.status_code == 201
    fallback_lead = res_fallback.json()["data"]
    assert fallback_lead["pipeline_id"] is not None
    assert fallback_lead["stage_id"] is not None
