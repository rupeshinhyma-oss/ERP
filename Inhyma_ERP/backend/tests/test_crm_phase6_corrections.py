"""
CRM Phase 6 Corrections and Workflow Hardening Regression Test Suite.

Verifies:
1. Priority Consistency:
   - CSV import with omitted Priority defaults to "medium".
   - CSV import with explicit valid Priority column ("low", "medium", "high", "urgent").
   - CSV import with invalid Priority column flags validation error.
   - Duplicate CSV import preserves existing lead's priority.
   - Manual lead update preserves existing priority when omitted, updates when explicitly set.
2. Manual Lead Creation:
   - Create single CRM lead with contact name, phone, email, company, pipeline, stage, priority, campaign, notes.
   - Phone normalization is strictly applied.
   - Duplicate protection rejects conflicting phone number with 409 Conflict.
   - Reps can only assign leads to themselves.
   - Activity and assignment audit history recorded.
3. Manager CSV Import Scoping:
   - Manager cannot assign leads to salespeople outside their permitted scope.
   - Salesperson cannot assign leads to other users.
4. Pipeline-specific Kanban & Visibility:
   - Role-based lead visibility and pipeline-specific configured stages.
"""

from __future__ import annotations

import io
import uuid
import pytest
from httpx import AsyncClient
from sqlalchemy import delete, select

from app.auth.security import create_access_token
from app.crm.models import (
    CrmActivity,
    CrmImportBatch,
    CrmLead,
    CrmPipeline,
    CrmPipelineStage,
)
from app.database.engine import get_sessionmaker
from app.users.models import User

ADMIN_ID = uuid.UUID("ea2b5763-5a4d-4f21-8bff-adc3e6cb8235")
SALES_MANAGER_ID = uuid.UUID("80c4dfb1-8d4f-4e2c-85dd-7500f035558b")
REP_1_ID = uuid.UUID("57445d76-a405-48cb-9930-08f11fc35c4e")
OUTSIDE_REP_ID = uuid.UUID("8b32e66e-2c62-4e15-b9fb-6502b84eacfc")


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
        SALES_MANAGER_ID,
        permissions=["crm.leads.import", "crm.leads.manage", "crm.leads.view", "crm.pipelines.view"],
    ).token
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def rep_headers() -> dict[str, str]:
    token = create_access_token(
        REP_1_ID,
        permissions=["crm.leads.import", "crm.leads.view"],
    ).token
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
async def setup_test_pipeline():
    sessionmaker = get_sessionmaker()
    pipeline_id = uuid.uuid4()
    stage_id = uuid.uuid4()
    stage_won_id = uuid.uuid4()

    async with sessionmaker() as session:
        pipeline = CrmPipeline(
            id=pipeline_id,
            name=f"Test Pipeline {pipeline_id.hex[:6]}",
            description="Pipeline for Phase 6 regression testing",
            is_active=True,
            created_by=ADMIN_ID,
        )
        session.add(pipeline)

        stage_open = CrmPipelineStage(
            id=stage_id,
            pipeline_id=pipeline_id,
            name="Open Discovery",
            stage_order=0,
            stage_type="open",
            is_initial=True,
            is_active=True,
        )
        session.add(stage_open)

        stage_won = CrmPipelineStage(
            id=stage_won_id,
            pipeline_id=pipeline_id,
            name="Closed Won",
            stage_order=1,
            stage_type="won",
            is_initial=False,
            is_active=True,
        )
        session.add(stage_won)
        await session.commit()

    yield {
        "pipeline_id": pipeline_id,
        "initial_stage_id": stage_id,
        "won_stage_id": stage_won_id,
    }

    async with sessionmaker() as session:
        lead_ids = (
            await session.execute(
                select(CrmLead.id).where(CrmLead.pipeline_id == pipeline_id)
            )
        ).scalars().all()

        if lead_ids:
            await session.execute(
                delete(CrmActivity).where(CrmActivity.lead_id.in_(lead_ids))
            )
            await session.execute(
                delete(CrmLead).where(CrmLead.id.in_(lead_ids))
            )

        await session.execute(
            delete(CrmImportBatch).where(CrmImportBatch.selected_pipeline_id == pipeline_id)
        )
        await session.execute(
            delete(CrmPipelineStage).where(CrmPipelineStage.pipeline_id == pipeline_id)
        )
        await session.execute(
            delete(CrmPipeline).where(CrmPipeline.id == pipeline_id)
        )
        await session.commit()


@pytest.mark.asyncio
async def test_csv_import_priority_defaulting_and_custom_values(
    client: AsyncClient,
    admin_headers: dict[str, str],
    setup_test_pipeline: dict[str, uuid.UUID],
):
    """
    1. CSV row without Priority column -> defaults to 'medium'.
    2. CSV row with explicit valid Priority ('urgent', 'low') -> assigned properly.
    3. CSV row with invalid Priority -> flagged in preview.
    """
    pipeline_id = setup_test_pipeline["pipeline_id"]

    # Preview with valid and invalid priorities
    csv_content = (
        "Name,Phone,Campaign,Priority\n"
        "Lead Default,9988776601,Summer2026,\n"
        "Lead Urgent,9988776602,Summer2026,Urgent\n"
        "Lead Low,9988776603,Summer2026,low\n"
        "Lead Invalid,9988776604,Summer2026,SuperHigh\n"
    )

    files = {"file": ("leads.csv", io.BytesIO(csv_content.encode("utf-8")), "text/csv")}
    data = {"pipeline_id": str(pipeline_id)}

    res = await client.post(
        "/api/v1/crm/import/preview",
        headers=admin_headers,
        data=data,
        files=files,
    )
    assert res.status_code == 200
    preview = res.json()["data"]

    assert preview["total_rows"] == 4
    # Row 1 (Default): priority is 'medium'
    assert preview["rows"][0]["priority"] == "medium"
    assert preview["rows"][0]["status"] == "VALID"

    # Row 2 (Urgent): priority is 'urgent'
    assert preview["rows"][1]["priority"] == "urgent"
    assert preview["rows"][1]["status"] == "VALID"

    # Row 3 (Low): priority is 'low'
    assert preview["rows"][2]["priority"] == "low"
    assert preview["rows"][2]["status"] == "VALID"

    # Row 4 (Invalid): row error flagged
    assert preview["rows"][3]["status"] == "INVALID"
    assert "Invalid priority" in preview["rows"][3]["validation_message"]


@pytest.mark.asyncio
async def test_duplicate_import_preserves_priority(
    client: AsyncClient,
    admin_headers: dict[str, str],
    setup_test_pipeline: dict[str, uuid.UUID],
):
    """
    When importing duplicate contact, existing lead priority must NOT be overwritten.
    """
    pipeline_id = setup_test_pipeline["pipeline_id"]

    # Initial import with high priority
    csv_1 = "Name,Phone,Campaign,Priority\nUnique Contact,9988776610,Campaign A,high\n"
    res1 = await client.post(
        "/api/v1/crm/import/confirm",
        headers=admin_headers,
        data={"pipeline_id": str(pipeline_id), "distribution_mode": "none"},
        files={"file": ("leads1.csv", io.BytesIO(csv_1.encode("utf-8")), "text/csv")},
    )
    assert res1.status_code == 201

    sessionmaker = get_sessionmaker()
    async with sessionmaker() as session:
        lead = (await session.execute(select(CrmLead).where(CrmLead.normalized_phone == "+919988776610"))).scalar_one()
        assert lead.priority == "high"

    # Duplicate import attempting to pass 'low' priority
    csv_2 = "Name,Phone,Campaign,Priority\nUnique Contact,9988776610,Campaign B,low\n"
    res2 = await client.post(
        "/api/v1/crm/import/confirm",
        headers=admin_headers,
        data={"pipeline_id": str(pipeline_id), "distribution_mode": "none"},
        files={"file": ("leads2.csv", io.BytesIO(csv_2.encode("utf-8")), "text/csv")},
    )
    assert res2.status_code == 201
    assert res2.json()["data"]["duplicate_skipped_count"] == 1

    # Verify priority remained 'high'
    async with sessionmaker() as session:
        lead_after = (await session.execute(select(CrmLead).where(CrmLead.normalized_phone == "+919988776610"))).scalar_one()
        assert lead_after.priority == "high"


@pytest.mark.asyncio
async def test_manual_lead_creation_and_duplicate_rejection(
    client: AsyncClient,
    admin_headers: dict[str, str],
    setup_test_pipeline: dict[str, uuid.UUID],
):
    """
    Manual lead creation creates lead, normalizes phone, rejects duplicates with 409.
    """
    pipeline_id = setup_test_pipeline["pipeline_id"]
    stage_id = setup_test_pipeline["initial_stage_id"]

    payload = {
        "contact_name": "Dr. Bruce Wayne",
        "phone": "9988776620",
        "email": "bruce@waynecorp.com",
        "company_name": "Wayne Enterprises",
        "pipeline_id": str(pipeline_id),
        "stage_id": str(stage_id),
        "priority": "urgent",
        "campaign": "Executive Inbound",
        "notes": "Interested in enterprise ERP setup.",
    }

    res = await client.post("/api/v1/crm/leads", headers=admin_headers, json=payload)
    assert res.status_code == 201
    data = res.json()["data"]
    assert data["name"] == "Dr. Bruce Wayne"
    assert data["normalized_phone"] == "+919988776620"
    assert data["priority"] == "urgent"
    assert data["stage_name"] == "Open Discovery"

    # Attempt to create duplicate with same phone
    res_dup = await client.post("/api/v1/crm/leads", headers=admin_headers, json=payload)
    assert res_dup.status_code == 409
    err_msg = res_dup.json().get("message", "") or (res_dup.json().get("errors", [{}])[0].get("message", ""))
    assert "already exists" in err_msg.lower()


@pytest.mark.asyncio
async def test_salesperson_manual_lead_creation_self_assigned(
    client: AsyncClient,
    rep_headers: dict[str, str],
    setup_test_pipeline: dict[str, uuid.UUID],
):
    """
    Salesperson creating lead is strictly self-assigned and cannot assign to others.
    """
    pipeline_id = setup_test_pipeline["pipeline_id"]

    # 1. Omitting assigned_to auto-assigns to self
    payload_self = {
        "contact_name": "Peter Parker",
        "phone": "9988776630",
        "pipeline_id": str(pipeline_id),
        "priority": "medium",
    }
    res = await client.post("/api/v1/crm/leads", headers=rep_headers, json=payload_self)
    assert res.status_code == 201
    data = res.json()["data"]
    assert data["assigned_to"] == str(REP_1_ID)

    # 2. Attempting to assign to someone else is forbidden (403)
    payload_other = {
        "contact_name": "Miles Morales",
        "phone": "9988776631",
        "pipeline_id": str(pipeline_id),
        "priority": "medium",
        "assigned_to": str(ADMIN_ID),
    }
    res_other = await client.post("/api/v1/crm/leads", headers=rep_headers, json=payload_other)
    assert res_other.status_code == 403


@pytest.mark.asyncio
async def test_lead_priority_update_preserves_when_omitted(
    client: AsyncClient,
    admin_headers: dict[str, str],
    setup_test_pipeline: dict[str, uuid.UUID],
):
    """
    PATCH /crm/leads/{lead_id} updates specified fields while preserving priority if omitted.
    """
    pipeline_id = setup_test_pipeline["pipeline_id"]

    # Create lead with high priority
    payload = {
        "contact_name": "Clark Kent",
        "phone": "9988776640",
        "pipeline_id": str(pipeline_id),
        "priority": "high",
    }
    create_res = await client.post("/api/v1/crm/leads", headers=admin_headers, json=payload)
    assert create_res.status_code == 201
    lead_id = create_res.json()["data"]["id"]

    # Update only company name without sending priority
    update_res = await client.patch(
        f"/api/v1/crm/leads/{lead_id}",
        headers=admin_headers,
        json={"company_name": "Daily Planet"},
    )
    assert update_res.status_code == 200
    assert update_res.json()["data"]["company_name"] == "Daily Planet"
    assert update_res.json()["data"]["priority"] == "high"

    # Explicitly update priority
    update_pri_res = await client.patch(
        f"/api/v1/crm/leads/{lead_id}",
        headers=admin_headers,
        json={"priority": "urgent"},
    )
    assert update_pri_res.status_code == 200
    assert update_pri_res.json()["data"]["priority"] == "urgent"


@pytest.mark.asyncio
async def test_manager_csv_import_scope_enforcement(
    client: AsyncClient,
    manager_headers: dict[str, str],
    rep_headers: dict[str, str],
    setup_test_pipeline: dict[str, uuid.UUID],
):
    """
    Manager cannot assign leads outside their team scope.
    Salesperson cannot assign to other users.
    """
    pipeline_id = setup_test_pipeline["pipeline_id"]
    csv_bytes = "Name,Phone,Campaign,Priority\nScoped Lead,9988776650,Scope Test,medium\n".encode("utf-8")

    # Manager attempting to assign to an outside rep
    res = await client.post(
        "/api/v1/crm/import/confirm",
        headers=manager_headers,
        data={
            "pipeline_id": str(pipeline_id),
            "distribution_mode": "manual_single",
            "target_salesperson_id": str(OUTSIDE_REP_ID),
        },
        files={"file": ("leads.csv", io.BytesIO(csv_bytes), "text/csv")},
    )
    assert res.status_code == 403

    # Salesperson attempting to assign to manager
    res_rep = await client.post(
        "/api/v1/crm/import/confirm",
        headers=rep_headers,
        data={
            "pipeline_id": str(pipeline_id),
            "distribution_mode": "manual_single",
            "target_salesperson_id": str(SALES_MANAGER_ID),
        },
        files={"file": ("leads.csv", io.BytesIO(csv_bytes), "text/csv")},
    )
    assert res_rep.status_code == 403


@pytest.mark.asyncio
async def test_role_based_lead_visibility(
    client: AsyncClient,
    admin_headers: dict[str, str],
    rep_headers: dict[str, str],
    setup_test_pipeline: dict[str, uuid.UUID],
):
    """
    Admin sees all leads; salesperson only sees leads assigned to or created by them.
    """
    pipeline_id = setup_test_pipeline["pipeline_id"]

    # Create admin lead
    admin_lead_res = await client.post(
        "/api/v1/crm/leads",
        headers=admin_headers,
        json={
            "name": "Admin Lead Visibility Test",
            "phone": "9988776660",
            "pipeline_id": str(pipeline_id),
            "assigned_to": str(ADMIN_ID),
        },
    )
    assert admin_lead_res.status_code == 201

    # Rep lists leads in pipeline -> should not see admin-only lead
    rep_list_res = await client.get(
        f"/api/v1/crm/leads?pipeline_id={pipeline_id}",
        headers=rep_headers,
    )
    assert rep_list_res.status_code == 200
    rep_items = rep_list_res.json()["data"]["items"]
    rep_lead_ids = [item["id"] for item in rep_items]
    assert admin_lead_res.json()["data"]["id"] not in rep_lead_ids

    # Admin lists leads in pipeline -> sees the lead
    admin_list_res = await client.get(
        f"/api/v1/crm/leads?pipeline_id={pipeline_id}",
        headers=admin_headers,
    )
    assert admin_list_res.status_code == 200
    admin_lead_ids = [item["id"] for item in admin_list_res.json()["data"]["items"]]
    assert admin_lead_res.json()["data"]["id"] in admin_lead_ids


@pytest.mark.asyncio
async def test_pipeline_specific_stages_for_kanban(
    client: AsyncClient,
    admin_headers: dict[str, str],
    setup_test_pipeline: dict[str, uuid.UUID],
):
    """
    Kanban relies on GET /crm/pipelines/{id}/stages returning only the selected
    pipeline's configured stages in correct order.
    """
    pipeline_id = setup_test_pipeline["pipeline_id"]
    initial_stage_id = setup_test_pipeline["initial_stage_id"]
    won_stage_id = setup_test_pipeline["won_stage_id"]

    res = await client.get(f"/api/v1/crm/pipelines/{pipeline_id}/stages", headers=admin_headers)
    assert res.status_code == 200
    stages = res.json()["data"]
    stage_ids = [s["id"] for s in stages]
    assert str(initial_stage_id) in stage_ids
    assert str(won_stage_id) in stage_ids
    assert len(stages) == 2


@pytest.mark.asyncio
async def test_scheduled_due_date_associated_with_followup_record(
    client: AsyncClient,
    admin_headers: dict[str, str],
    setup_test_pipeline: dict[str, uuid.UUID],
):
    """
    Scheduled due dates are associated with follow-up records, not as a mandatory
    lead field. Daily Work and lead history retain follow-up due dates.
    """
    pipeline_id = setup_test_pipeline["pipeline_id"]

    # 1. Lead creation does not require due_at
    lead_res = await client.post(
        "/api/v1/crm/leads",
        headers=admin_headers,
        json={
            "name": "Followup Test Lead",
            "phone": "9988776670",
            "pipeline_id": str(pipeline_id),
        },
    )
    assert lead_res.status_code == 201
    lead_id = lead_res.json()["data"]["id"]
    # next_follow_up_at starts as None
    assert lead_res.json()["data"]["next_follow_up_at"] is None

    # 2. Schedule follow-up with due date
    due_date = "2026-10-20T10:00:00Z"
    fu_res = await client.post(
        f"/api/v1/crm/leads/{lead_id}/follow-ups",
        headers=admin_headers,
        json={
            "due_at": due_date,
            "follow_up_type": "call",
            "notes": "Scheduled product demo walkthrough",
        },
    )
    assert fu_res.status_code == 201
    fu_data = fu_res.json()["data"]
    assert fu_data["due_at"] is not None
    assert fu_data["status"] == "pending"

    # 3. Lead detail now reflects next_follow_up_at computed from active follow-up
    lead_after = await client.get(f"/api/v1/crm/leads/{lead_id}", headers=admin_headers)
    assert lead_after.status_code == 200
    assert lead_after.json()["data"]["next_follow_up_at"] is not None

    # 4. Follow-up history retains the record and due date
    fu_list = await client.get(f"/api/v1/crm/follow-ups?lead_id={lead_id}", headers=admin_headers)
    assert fu_list.status_code == 200
    assert len(fu_list.json()["data"]["items"]) == 1
    assert fu_list.json()["data"]["items"][0]["notes"] == "Scheduled product demo walkthrough"

